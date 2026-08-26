"""Regression tests for the assistant's tool-schema and argument handling.

Both bugs covered here presented identically in the UI -- the assistant
replied "I can't reach the assistant service right now" -- despite the model
having routed to the correct tool. They are cheap to reintroduce and
expensive to diagnose, so they are pinned rather than left to a live smoke
test that needs a provider key.
"""

from __future__ import annotations

import json

from app.agent import registry
from app.agent.contracts import _nullable_optionals

registry.load_tools()


def _properties(tool_name: str) -> dict:
    spec = registry.get_tool(tool_name)
    assert spec is not None, f"{tool_name} is not registered"
    return spec.to_openai_tool()["function"]["parameters"]["properties"]


def test_optional_parameters_accept_null() -> None:
    """Groq validates the model's generated tool call against the schema we
    sent and rejects the whole request with HTTP 400 when an optional
    ``"type": "string"`` property comes back as null -- which gpt-oss-20b does
    routinely for optionals it chose not to fill.
    """

    for name, schema in _properties("search_activities").items():
        assert "null" in schema["type"], f"optional {name!r} must accept null"


def test_nullable_enums_list_null() -> None:
    """An ``enum`` constrains values independently of ``type``, so widening the
    type alone still leaves the null rejected."""

    for name, schema in _properties("search_activities").items():
        if "enum" in schema:
            assert None in schema["enum"], f"nullable enum {name!r} must permit null"


def test_required_parameters_stay_strict() -> None:
    """A null in a *required* argument is a genuine routing error. Widening it
    would let a titleless activity reach the handler instead of failing loudly.
    """

    spec = registry.get_tool("create_activity")
    params = spec.to_openai_tool()["function"]["parameters"]
    for name in params.get("required") or ():
        assert params["properties"][name]["type"] == "string", f"required {name!r} must stay strict"


def test_widening_leaves_schemas_without_properties_alone() -> None:
    assert _nullable_optionals({"type": "object"}) == {"type": "object"}


def test_every_tool_schema_is_json_serialisable() -> None:
    """The catalogue is sent as a JSON request body on every single turn."""

    json.dumps(registry.openai_tool_catalogue())


def test_no_tool_exposes_an_identity_parameter() -> None:
    """Identity comes from the verified JWT, never from model-chosen text. A
    tool that accepted ``owner_id`` would let a prompt-injected instruction
    address another teacher's records.
    """

    forbidden = {"owner_id", "profile_id", "institution_id", "user_id", "faculty_id", "principal"}
    for spec in registry.all_tools():
        properties = spec.to_openai_tool()["function"]["parameters"].get("properties") or {}
        assert not (set(properties) & forbidden), f"{spec.name} exposes an identity parameter"
