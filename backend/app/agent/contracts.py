"""Frozen contracts for the assistant agent layer.

Every tool handler, the agent loop, the executor, and the frontend all key
off the shapes in this module. It is deliberately dependency-light (no DB,
no FastAPI, no LLM) so it can be imported from anywhere without cycles, and
so the whole contract fits on one screen for the people building against it.

Two rules that the rest of the layer depends on, stated once here:

1. Identity is never modelled. A tool's ``parameters`` JSON Schema must not
   contain ``owner_id``/``profile_id``/``institution_id``. Those are injected
   from the authenticated ``CurrentUser`` at execution time, so a prompt-
   injected model is structurally unable to act on another teacher's record.
2. Risk class is a server-side property of the tool, declared in the registry
   and never accepted from the client.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal


class RiskClass(str, Enum):
    """How much ceremony a tool needs before it runs.

    ``READ`` executes inline during the agent loop. Everything else is staged
    into an action plan and executed only after the teacher approves.
    """

    READ = "read"
    WRITE_LOW = "write_low"
    WRITE_HIGH = "write_high"
    DESTRUCTIVE = "destructive"
    EXTERNAL = "external"


#: Risk classes that can never be pre-approved via an "always allow" grant,
#: no matter what scopes the teacher has granted. Enforced in permissions.py.
NEVER_AUTO_APPROVE: frozenset[RiskClass] = frozenset(
    {RiskClass.WRITE_HIGH, RiskClass.DESTRUCTIVE, RiskClass.EXTERNAL}
)


class ToolScope(str, Enum):
    """Permission bucket a tool belongs to.

    Scopes are what a teacher grants "always allow" against, so they are
    coarser than tools: granting ``EVIDENCE`` covers uploading and attaching
    without covering activities. Only scopes whose tools are all
    ``WRITE_LOW`` are ever eligible (see permissions.py).
    """

    ACTIVITIES = "activities"
    EVIDENCE = "evidence"
    DOCUMENTS = "documents"
    PROFILE = "profile"
    COMMS = "comms"
    PLATFORM = "platform"


UiHint = Literal["navigate", "download", "list", "detail", "none"]


@dataclass(slots=True)
class ToolResult:
    """What a tool handler returns.

    Structured on purpose: the chat UI renders ``summary`` as the human line,
    ``data`` as a card/table/link, and ``ui_hint`` decides which. Handlers
    must never return a prose blob and hope the frontend parses it.

    Handlers should not raise for expected failures (not found, nothing to
    do, provider unavailable). Return ``ok=False`` with a teacher-readable
    ``error`` instead -- the executor records it as a failed step and keeps
    the rest of the plan honest rather than aborting the whole run.
    """

    ok: bool
    summary: str
    data: dict[str, Any] | None = None
    ui_hint: UiHint = "none"
    #: For ``ui_hint="navigate"``: the DashboardApp ``currentView`` string.
    #: For ``ui_hint="download"``: the signed URL.
    ui_target: str | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "summary": self.summary,
            "data": self.data,
            "ui_hint": self.ui_hint,
            "ui_target": self.ui_target,
            "error": self.error,
        }

    @classmethod
    def failure(cls, message: str) -> ToolResult:
        return cls(ok=False, summary=message, error=message)


def _nullable_optionals(parameters: dict[str, Any]) -> dict[str, Any]:
    """Let every optional property also accept ``null``.

    Models routinely emit ``{"query": null}`` for an optional argument they
    chose not to fill, rather than omitting the key. Groq validates the
    generated tool call against the schema we sent and rejects the entire
    request with HTTP 400 ``tool_use_failed`` when a ``"type": "string"``
    property comes back null -- so a correctly *routed* call still fails, and
    the whole turn degrades to "assistant unavailable".

    Widening optionals to ``["string", "null"]`` here, rather than in each
    tool's hand-written schema, means no tool module can reintroduce the bug.
    Required properties are left strict on purpose: a null there is a genuine
    routing error worth surfacing.
    """

    properties = parameters.get("properties")
    if not isinstance(properties, dict):
        return parameters

    required = set(parameters.get("required") or ())
    widened: dict[str, Any] = {}
    for name, schema in properties.items():
        declared = schema.get("type") if isinstance(schema, dict) else None
        if name in required or declared is None or not isinstance(declared, str) or declared == "null":
            widened[name] = schema
            continue
        entry = {**schema, "type": [declared, "null"]}
        # An `enum` constrains values independently of `type`, so a nullable
        # enum has to list null explicitly or the null is still rejected.
        if isinstance(entry.get("enum"), list) and None not in entry["enum"]:
            entry["enum"] = [*entry["enum"], None]
        widened[name] = entry
    return {**parameters, "properties": widened}


@dataclass(slots=True)
class ToolSpec:
    """A registered tool: its LLM-facing schema plus its server-side policy.

    ``parameters`` is a JSON Schema object passed straight to Groq as the
    function's parameter schema, so it must be a plain ``{"type": "object",
    ...}`` dict with no identity fields (rule 1 in the module docstring).

    ``summarise`` turns validated arguments into the one-line description the
    permission card shows ("Add FDP_Certificate.pdf to Evidence Vault"). It
    runs before execution, so it must not touch the database.
    """

    name: str
    description: str
    parameters: dict[str, Any]
    risk_class: RiskClass
    scope: ToolScope
    handler: Any  # async (session, principal, args) -> ToolResult
    summarise: Any | None = None

    def to_openai_tool(self) -> dict[str, Any]:
        """Groq/OpenAI ``tools[]`` entry for this tool."""

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": _nullable_optionals(self.parameters),
            },
        }

    def describe(self, args: dict[str, Any]) -> str:
        if self.summarise is None:
            return self.description
        try:
            return self.summarise(args)
        except Exception:  # noqa: BLE001 - a bad summary must never block a plan
            return self.description


StepStatus = Literal["pending", "running", "succeeded", "failed", "skipped"]


@dataclass(slots=True)
class PlanStep:
    """One staged tool call inside an action plan.

    Persisted as JSON in ``assistant_action_plans.steps``; the client only
    ever echoes back a plan id, never these arguments, so this stays the
    server-side source of truth for what was approved.
    """

    tool: str
    args: dict[str, Any]
    risk_class: RiskClass
    scope: ToolScope
    summary: str
    #: True when an "always allow" grant already covers this step. The plan
    #: still requires approval if *any* sibling step needs it.
    auto_approved: bool = False
    status: StepStatus = "pending"
    result: dict[str, Any] | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "tool": self.tool,
            "args": self.args,
            "risk_class": self.risk_class.value,
            "scope": self.scope.value,
            "summary": self.summary,
            "auto_approved": self.auto_approved,
            "status": self.status,
            "result": self.result,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> PlanStep:
        return cls(
            tool=raw["tool"],
            args=raw.get("args") or {},
            risk_class=RiskClass(raw["risk_class"]),
            scope=ToolScope(raw["scope"]),
            summary=raw.get("summary") or raw["tool"],
            auto_approved=bool(raw.get("auto_approved")),
            status=raw.get("status") or "pending",
            result=raw.get("result"),
            error=raw.get("error"),
        )


@dataclass(slots=True)
class AgentTurn:
    """The full result of one ``POST /assistant/message``.

    This is the frozen response contract the frontend builds against -- agree
    it before fan-out, because every component keys off it.
    """

    conversation_id: str
    reply: str
    #: Read-tool results already executed during the loop, in order.
    observations: list[dict[str, Any]] = field(default_factory=list)
    #: Present when the turn staged writes needing approval.
    plan_id: str | None = None
    steps: list[PlanStep] = field(default_factory=list)
    #: True when every staged step was covered by an always-allow grant and
    #: the executor may run without a confirmation round-trip.
    auto_executable: bool = False
    #: Set when the LLM provider is unconfigured or failed; the UI shows a
    #: graceful "assistant unavailable" state instead of a stack trace.
    degraded: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "conversation_id": self.conversation_id,
            "reply": self.reply,
            "observations": self.observations,
            "plan_id": self.plan_id,
            "steps": [step.as_dict() for step in self.steps],
            "auto_executable": self.auto_executable,
            "degraded": self.degraded,
        }
