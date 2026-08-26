"""Server-side authorisation for assistant tool calls.

This module is the security boundary of the assistant. The agent loop
proposes; nothing here trusts the model or the client:

* Risk class comes from the tool registry, never from the request body. A
  client cannot tell the server that ``delete_activity`` is low risk.
* "Always allow" grants can only ever cover ``WRITE_LOW`` scopes. Deletes,
  profile edits, appraisal submission, and outbound mail always require an
  explicit approval, even if a teacher somehow has a stale grant row for
  their scope.
* Approval is by plan id. Arguments are read back from the persisted plan,
  never from the confirming request, so an approved plan cannot be swapped
  for a different one between staging and execution.

The backend connects to Postgres with a role that bypasses RLS (see
core/db.py), so these checks are the real enforcement, not a second line of
defence behind a policy.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .contracts import NEVER_AUTO_APPROVE, PlanStep, RiskClass, ToolScope

#: Scopes a teacher is allowed to grant "always allow" against. Kept as an
#: explicit allowlist rather than derived from risk class so that adding a
#: high-risk tool to an existing scope can never silently widen a grant that
#: was made before that tool existed.
GRANTABLE_SCOPES: frozenset[ToolScope] = frozenset(
    {ToolScope.ACTIVITIES, ToolScope.EVIDENCE, ToolScope.DOCUMENTS}
)


def scope_is_grantable(scope: ToolScope) -> bool:
    return scope in GRANTABLE_SCOPES


def requires_confirmation(
    risk_class: RiskClass,
    scope: ToolScope,
    granted_scopes: set[ToolScope],
) -> bool:
    """Whether one staged step needs an explicit Allow from the teacher.

    Read tools never reach here -- the loop executes them inline. Of the
    rest, the hard rule fires first: destructive, profile-level, and outbound
    external actions always ask, regardless of any grant.
    """

    if risk_class is RiskClass.READ:
        return False
    if risk_class in NEVER_AUTO_APPROVE:
        return True
    if not scope_is_grantable(scope):
        return True
    return scope not in granted_scopes


async def load_granted_scopes(session: AsyncSession, profile_id: UUID) -> set[ToolScope]:
    """Scopes this teacher has set to ``always_allow``.

    Unknown scope strings (a row written by an older or newer build) are
    ignored rather than raising: an unrecognised grant must fail closed into
    "ask", never into "allow".
    """

    result = await session.execute(
        text(
            """
            select scope
            from public.assistant_tool_permissions
            where profile_id = :profile_id and mode = 'always_allow'
            """
        ),
        {"profile_id": profile_id},
    )
    granted: set[ToolScope] = set()
    for (raw_scope,) in result.all():
        try:
            scope = ToolScope(raw_scope)
        except ValueError:
            continue
        if scope_is_grantable(scope):
            granted.add(scope)
    return granted


async def set_scope_permission(
    session: AsyncSession,
    profile_id: UUID,
    scope: ToolScope,
    mode: str,
) -> bool:
    """Grant or revoke an always-allow scope. Returns False if refused.

    Refuses non-grantable scopes outright so that a client cannot persist an
    ``always_allow`` row for ``profile`` or ``comms`` and have it silently
    sit in the table looking authoritative.
    """

    if mode not in {"ask", "always_allow"}:
        return False
    if mode == "always_allow" and not scope_is_grantable(scope):
        return False
    await session.execute(
        text(
            """
            insert into public.assistant_tool_permissions (profile_id, scope, mode)
            values (:profile_id, :scope, :mode)
            on conflict (profile_id, scope) do update
                set mode = excluded.mode, granted_at = now()
            """
        ),
        {"profile_id": profile_id, "scope": scope.value, "mode": mode},
    )
    return True


def annotate_steps(steps: list[PlanStep], granted_scopes: set[ToolScope]) -> bool:
    """Mark which staged steps are pre-approved; return whether the plan can
    execute without a confirmation round-trip.

    A plan is auto-executable only when *every* step is covered. A mixed plan
    -- three evidence writes plus one email draft -- still stops and asks, and
    the card shows the three as pre-approved so the teacher sees exactly what
    they are agreeing to.
    """

    auto_executable = True
    for step in steps:
        needs = requires_confirmation(step.risk_class, step.scope, granted_scopes)
        step.auto_approved = not needs
        if needs:
            auto_executable = False
    return auto_executable and bool(steps)
