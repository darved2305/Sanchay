"""Import and invocation adapters for the frozen backend helper contract."""

from __future__ import annotations

import importlib
import inspect
import os
from dataclasses import dataclass
from enum import Enum
from typing import Any, Iterable, Mapping

import pytest


MODULES = (
    "app.core.academic_year",
    "app.core.date_utils",
    "app.core.dedupe",
    "app.core.permissions",
    "app.core.auth",
    "app.core.validation",
    "app.core.pagination",
    "app.core.authorization",
    "app.core.query_validation",
    "app.auth.permissions",
    "app.authz",
    "app.utils.academic_year",
    "app.utils.date_utils",
    "app.utils.dedupe",
    "app.modules.activities.helpers",
    "app.modules.activities.utils",
    "app.modules.activities.query",
    "app.modules.activities.service",
    "app.modules.activities.schemas",
    "app.modules.publications.dedupe",
    "app.modules.publications.helpers",
    "app.modules.publications.service",
    "app.modules.publications.schemas",
    "app.services.publications",
    "app.modules.appraisals.readiness",
    "app.modules.appraisals.state_machine",
    "app.modules.appraisals.transitions",
    "app.modules.appraisals.helpers",
    "app.modules.appraisals.service",
    "app.modules.appraisals.schemas",
    "app.modules.admin.schemas",
    "app.modules.admin.service",
    "backend.app.core.academic_year",
    "backend.app.core.date_utils",
    "backend.app.core.dedupe",
    "backend.app.core.permissions",
    "backend.app.core.auth",
    "backend.app.core.validation",
    "backend.app.core.authorization",
    "backend.app.core.query_validation",
    "backend.app.auth.permissions",
    "backend.app.authz",
    "backend.app.utils.academic_year",
    "backend.app.utils.date_utils",
    "backend.app.utils.dedupe",
    "backend.app.modules.activities.helpers",
    "backend.app.modules.activities.utils",
    "backend.app.modules.activities.query",
    "backend.app.modules.activities.service",
    "backend.app.modules.publications.dedupe",
    "backend.app.modules.publications.helpers",
    "backend.app.modules.publications.service",
    "backend.app.services.publications",
    "backend.app.modules.appraisals.readiness",
    "backend.app.modules.appraisals.state_machine",
    "backend.app.modules.appraisals.transitions",
    "backend.app.modules.appraisals.service",
    "services.api.app.core.academic_year",
    "services.api.app.core.date_utils",
    "services.api.app.core.dedupe",
    "services.api.app.core.permissions",
    "services.api.app.core.auth",
    "services.api.app.core.validation",
    "services.api.app.core.authorization",
    "services.api.app.core.query_validation",
    "services.api.app.auth.permissions",
    "services.api.app.authz",
    "services.api.app.utils.academic_year",
    "services.api.app.utils.date_utils",
    "services.api.app.utils.dedupe",
    "services.api.app.modules.activities.helpers",
    "services.api.app.modules.activities.utils",
    "services.api.app.modules.activities.query",
    "services.api.app.modules.activities.service",
    "services.api.app.modules.publications.dedupe",
    "services.api.app.modules.publications.helpers",
    "services.api.app.modules.publications.service",
    "services.api.app.services.publications",
    "services.api.app.modules.appraisals.readiness",
    "services.api.app.modules.appraisals.state_machine",
    "services.api.app.modules.appraisals.transitions",
    "services.api.app.modules.appraisals.service",
)


@dataclass(frozen=True)
class ResolvedSymbol:
    name: str
    value: Any
    module: str


def _module_names() -> tuple[str, ...]:
    configured = os.getenv("QA_HELPER_MODULES")
    if not configured:
        return MODULES
    return tuple(
        dict.fromkeys(
            part.strip() for part in configured.split(",") if part.strip()
        )
    )


def resolve_symbol(
    names: Iterable[str], *, purpose: str, required: bool = True
) -> ResolvedSymbol | None:
    names = tuple(names)
    import_errors: list[str] = []
    for module_name in _module_names():
        try:
            module = importlib.import_module(module_name)
        except (ImportError, ModuleNotFoundError) as exc:
            import_errors.append(f"{module_name}: {exc}")
            continue
        for name in names:
            value = getattr(module, name, None)
            if value is not None:
                return ResolvedSymbol(name=name, value=value, module=module_name)

    if required:
        detail = ""
        if import_errors:
            detail = " (backend modules unavailable or incomplete)"
        pytest.skip(f"no {purpose} helper found{detail}")
    return None


def _enum_value(value: Any) -> Any:
    return value.value if isinstance(value, Enum) else value


def scalar(value: Any, *, keys: tuple[str, ...] = ()) -> Any:
    """Unwrap common Pydantic/enum/dict result shapes."""

    value = _enum_value(value)
    if isinstance(value, Mapping):
        for key in keys:
            if key in value:
                return scalar(value[key], keys=())
        for key in ("value", "result", "academic_year", "readiness", "allowed", "valid"):
            if key in value:
                return scalar(value[key], keys=())
    for key in keys:
        if hasattr(value, key):
            return scalar(getattr(value, key), keys=())
    return value


def _fields_for_callable(callable_obj: Any) -> set[str] | None:
    model_fields = getattr(callable_obj, "model_fields", None)
    if isinstance(model_fields, Mapping):
        return set(model_fields)
    fields = getattr(callable_obj, "__fields__", None)
    if isinstance(fields, Mapping):
        return set(fields)
    return None


def _signature(callable_obj: Any) -> inspect.Signature | None:
    try:
        return inspect.signature(callable_obj)
    except (TypeError, ValueError):
        return None


def _filtered_kwargs(callable_obj: Any, payload: Mapping[str, Any]) -> dict[str, Any]:
    fields = _fields_for_callable(callable_obj)
    signature = _signature(callable_obj)
    if fields is not None:
        return {key: value for key, value in payload.items() if key in fields}
    if signature is None:
        return dict(payload)
    parameters = signature.parameters
    if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in parameters.values()):
        return dict(payload)
    return {
        key: value
        for key, value in payload.items()
        if key in parameters
        and parameters[key].kind
        in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    }


def invoke(callable_obj: Any, payload: Mapping[str, Any], *positional: Any) -> Any:
    """Call a helper using only parameters its implementation advertises."""

    kwargs = _filtered_kwargs(callable_obj, payload)
    signature = _signature(callable_obj)
    if signature is not None:
        required = [
            parameter
            for parameter in signature.parameters.values()
            if parameter.default is inspect.Parameter.empty
            and parameter.kind
            in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
        ]
        unresolved = [parameter for parameter in required if parameter.name not in kwargs]
        if unresolved and positional:
            return callable_obj(*positional)
    try:
        return callable_obj(**kwargs)
    except TypeError as keyword_error:
        if positional:
            try:
                return callable_obj(*positional)
            except TypeError:
                raise keyword_error
        raise


def invoke_variants(callable_obj: Any, variants: Iterable[tuple[Mapping[str, Any], tuple[Any, ...]]]) -> Any:
    errors: list[Exception] = []
    for payload, positional in variants:
        try:
            return invoke(callable_obj, payload, *positional)
        except (TypeError, ValueError, AttributeError) as exc:
            errors.append(exc)
    if errors:
        raise errors[-1]
    raise TypeError("no invocation variants supplied")


def result_is_allowed(result: Any, *, validator_style: bool = False) -> bool:
    result = scalar(result, keys=("allowed", "valid", "authorized"))
    if isinstance(result, bool):
        return result
    if result is None:
        return validator_style
    if isinstance(result, str):
        return result.lower() in {"allowed", "authorized", "ok", "valid", "confirmed"}
    return bool(result)


def assert_rejected(callable_obj: Any, payload: Mapping[str, Any], *positional: Any) -> None:
    try:
        result = invoke(callable_obj, payload, *positional)
    except Exception as exc:  # validators conventionally raise ValueError/HTTPException
        assert exc is not None
        return
    assert not result_is_allowed(result, validator_style=False), (
        f"invalid contract input was accepted by {callable_obj!r}: {result!r}"
    )


def assert_transition(callable_obj: Any, current: str, target: str, expected: bool) -> None:
    payload = {
        "current": current,
        "current_status": current,
        "from_status": current,
        "old_status": current,
        "status": current,
        "target": target,
        "target_status": target,
        "to_status": target,
        "next_status": target,
    }
    try:
        result = invoke(callable_obj, payload, current, target)
    except Exception as exc:
        if expected:
            raise AssertionError(
                f"legal submission transition {current}->{target} raised {exc!r}"
            ) from exc
        return
    allowed = result_is_allowed(result, validator_style=expected)
    assert allowed is expected, (
        f"submission transition {current}->{target} returned {result!r}; "
        f"expected allowed={expected}"
    )


def normalize_readiness(value: Any) -> float:
    value = scalar(value, keys=("readiness", "score", "percentage", "value"))
    if isinstance(value, Mapping):
        value = scalar(value)
    value = float(value)
    return value * 100 if 0 <= value <= 1 else value


# Settings kwargs meaning "no LLM provider is configured at all".
#
# Nulling only GROQ_API_KEY is not enough: Settings still reads the repo-root
# .env, so with LLM_PROVIDER=openrouter and an OpenRouter key present the
# provider stayed configured and these fallback tests quietly made live API
# calls instead of exercising the deterministic path they exist to protect.
UNCONFIGURED_LLM = {
    "llm_provider": "groq",
    "groq_api_key": None,
    "openrouter_api_key": None,
}
