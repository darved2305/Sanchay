"""The assistant tool catalogue.

Tools register themselves here via ``@tool(...)``. The registry is what the
agent loop hands to Groq as ``tools[]``, and what the executor resolves a
staged step's name back into -- so a step whose tool has been removed fails
closed rather than executing something else.

Deliberately small. Tool-routing accuracy on an open-weight model degrades
as the catalogue grows and every entry is one more description the model has
to disambiguate; twelve is the working ceiling for this product.
"""

from __future__ import annotations

from typing import Any, Callable

from .contracts import RiskClass, ToolResult, ToolScope, ToolSpec

_REGISTRY: dict[str, ToolSpec] = {}

#: Identity is injected from the authenticated principal, never modelled.
#: A tool whose schema declares one of these is a security bug, so
#: registration rejects it rather than trusting review to catch it.
_FORBIDDEN_PARAMETERS = {
    "owner_id",
    "profile_id",
    "institution_id",
    "user_id",
    "faculty_id",
    "principal",
}


class ToolRegistrationError(RuntimeError):
    pass


def tool(
    *,
    name: str,
    description: str,
    parameters: dict[str, Any],
    risk_class: RiskClass,
    scope: ToolScope,
    summarise: Callable[[dict[str, Any]], str] | None = None,
) -> Callable[[Any], Any]:
    """Register an async handler as an assistant tool.

    The handler signature is fixed::

        async def handler(session, principal, args) -> ToolResult

    ``principal`` is the authenticated ``CurrentUser``; scope every query by
    it. Prefer calling the existing endpoint logic in ``app/api/*`` over
    hand-writing SQL -- this backend bypasses RLS, so the owner predicates
    those endpoints apply manually are the only thing keeping one teacher out
    of another's record.
    """

    def decorator(handler: Any) -> Any:
        if name in _REGISTRY:
            raise ToolRegistrationError(f"Tool {name!r} is already registered")
        if parameters.get("type") != "object":
            raise ToolRegistrationError(f"Tool {name!r} parameters must be a JSON Schema object")
        declared = set(parameters.get("properties") or {})
        leaked = declared & _FORBIDDEN_PARAMETERS
        if leaked:
            raise ToolRegistrationError(
                f"Tool {name!r} must not accept identity parameters {sorted(leaked)}; "
                "these are injected from the authenticated principal"
            )
        _REGISTRY[name] = ToolSpec(
            name=name,
            description=description,
            parameters=parameters,
            risk_class=risk_class,
            scope=scope,
            handler=handler,
            summarise=summarise,
        )
        return handler

    return decorator


def get_tool(name: str) -> ToolSpec | None:
    return _REGISTRY.get(name)


def all_tools() -> list[ToolSpec]:
    return list(_REGISTRY.values())


def openai_tool_catalogue() -> list[dict[str, Any]]:
    """The ``tools[]`` payload for a Groq chat completion."""

    return [spec.to_openai_tool() for spec in _REGISTRY.values()]


def load_tools() -> None:
    """Import every tool module so decorators run.

    Called once at router import. Kept explicit rather than relying on
    package ``__init__`` side effects so that a missing module is a loud
    ImportError instead of a tool that silently never registers.
    """

    from .tools import comms, documents, evidence, read, write  # noqa: F401


__all__ = [
    "ToolRegistrationError",
    "ToolResult",
    "all_tools",
    "get_tool",
    "load_tools",
    "openai_tool_catalogue",
    "tool",
]
