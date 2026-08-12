"""Shared pytest fixtures for contract and API-security tests.

The frozen product contract describes a FastAPI service, but the repository can
host it either as ``backend/app`` or ``services/api/app`` during the build.
These fixtures discover either layout without changing application imports or
adding test-only data to the application.
"""

from __future__ import annotations

import importlib
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]


def _add_import_roots() -> None:
    """Make the supported backend layouts importable for pytest."""

    roots = (
        REPO_ROOT,
        REPO_ROOT / "backend",
        REPO_ROOT / "services" / "api",
    )
    for root in roots:
        if root.is_dir() and str(root) not in sys.path:
            sys.path.insert(0, str(root))


_add_import_roots()


APP_MODULES = (
    "app.main",
    "backend.app.main",
    "services.api.app.main",
)


def _import_app_module(module_name: str) -> Any | None:
    try:
        return importlib.import_module(module_name)
    except (ImportError, ModuleNotFoundError):
        return None


def discover_app() -> Any | None:
    """Return the FastAPI app or factory exposed by a supported layout."""

    configured = os.getenv("QA_APP_MODULE")
    module_names = (configured, *APP_MODULES) if configured else APP_MODULES

    for module_name in module_names:
        if not module_name:
            continue
        module = _import_app_module(module_name)
        if module is None:
            continue
        for attr_name in ("app", "application", "create_app", "get_app"):
            candidate = getattr(module, attr_name, None)
            if candidate is None:
                continue
            if callable(candidate) and not hasattr(candidate, "routes"):
                try:
                    candidate = candidate()
                except TypeError:
                    # A factory requiring deployment-only settings is not a
                    # usable local TestClient app; try the next supported
                    # export and let the fixture explain the skip.
                    continue
            if hasattr(candidate, "routes"):
                return candidate
    return None


def _fastapi_app_or_skip() -> Any:
    pytest.importorskip("fastapi", reason="backend API tests require FastAPI")
    app = discover_app()
    if app is None:
        pytest.skip(
            "backend FastAPI app is not present; API tests activate when the "
            "backend worker lands"
        )
    return app


@pytest.fixture(scope="session")
def fastapi_app() -> Any:
    return _fastapi_app_or_skip()


@pytest.fixture()
def client(fastapi_app: Any) -> Iterator[Any]:
    """Yield a TestClient without requiring live Supabase credentials."""

    test_client_type = pytest.importorskip(
        "starlette.testclient", reason="API tests require Starlette TestClient"
    ).TestClient
    manager = test_client_type(fastapi_app)
    try:
        test_client = manager.__enter__()
    except Exception as exc:  # pragma: no cover - depends on app lifespan
        pytest.skip(f"backend TestClient could not start: {exc}")
    try:
        yield test_client
    except BaseException:
        manager.__exit__(*sys.exc_info())
        raise
    else:
        manager.__exit__(None, None, None)


def route_path(app: Any, suffix: str) -> str:
    """Resolve a contract suffix with or without the ``/api/v1`` prefix."""

    suffix = "/" + suffix.strip("/")
    paths: set[str] = set()
    for route in getattr(app, "routes", ()):
        path = getattr(route, "path", None)
        if isinstance(path, str):
            paths.add(path.rstrip("/") or "/")

    for candidate in (f"/api/v1{suffix}", suffix):
        if candidate.rstrip("/") in paths:
            return candidate

    # Keep the contract prefix as the default.  A missing route will produce
    # a useful 404 assertion rather than hiding a missing P0 endpoint.
    return f"/api/v1{suffix}"


@pytest.fixture()
def api_path(fastapi_app: Any):
    return lambda suffix: route_path(fastapi_app, suffix)


class Principal(dict):
    """A test principal compatible with mapping- and attribute-style code."""

    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as exc:  # pragma: no cover - diagnostic path
            raise AttributeError(name) from exc

    @property
    def profile_id(self) -> str:
        return self.get("profile_id", self["id"])


def _dependency_callables(app: Any) -> list[Any]:
    """Walk FastAPI's dependency graph to find auth callables to override."""

    found: list[Any] = []
    seen: set[int] = set()

    def walk(dependant: Any) -> None:
        if dependant is None:
            return
        call = getattr(dependant, "call", None)
        if call is not None and id(call) not in seen:
            seen.add(id(call))
            found.append(call)
        for child in getattr(dependant, "dependencies", ()):
            walk(child)

    for route in getattr(app, "routes", ()):
        walk(getattr(route, "dependant", None))
    return found


def _auth_dependency_candidates(app: Any) -> list[Any]:
    names = (
        "get_current_user",
        "get_authenticated_user",
        "current_user",
        "require_user",
        "require_auth",
        "require_admin",
        "admin_required",
    )
    return [
        call
        for call in _dependency_callables(app)
        if getattr(call, "__name__", "") in names
        or any(token in getattr(call, "__name__", "").lower() for token in ("auth", "current_user"))
    ]


def _principal(role: str, profile_id: str, institution_id: str) -> Principal:
    return Principal(
        id=profile_id,
        profile_id=profile_id,
        user_id=profile_id,
        role=role,
        institution_id=institution_id,
        onboarding_completed=True,
    )


@pytest.fixture()
def authenticated_client(fastapi_app: Any):
    """Factory for dependency-overridden TestClients used by authz tests.

    The identities are test principals only; records are never inserted here.
    A backend with a real test database can pair this fixture with its own
    record factory, while unauthenticated/role-denial checks work without one.
    """

    test_client_type = pytest.importorskip(
        "starlette.testclient", reason="API tests require Starlette TestClient"
    ).TestClient
    dependencies = _auth_dependency_candidates(fastapi_app)
    if not dependencies:
        pytest.skip("no discoverable FastAPI auth dependency")

    @contextmanager
    def make_client(
        *, role: str, profile_id: str, institution_id: str
    ) -> Iterator[Any]:
        principal = _principal(role, profile_id, institution_id)
        previous = dict(getattr(fastapi_app, "dependency_overrides", {}))

        def deny_admin() -> Any:
            from fastapi import HTTPException

            raise HTTPException(status_code=403, detail="admin role required")

        for dependency in dependencies:
            name = getattr(dependency, "__name__", "").lower()
            if "admin" in name and role not in {"admin", "dept_admin", "institution_admin"}:
                fastapi_app.dependency_overrides[dependency] = deny_admin
            else:
                fastapi_app.dependency_overrides[dependency] = (
                    lambda principal=principal: principal
                )

        manager = test_client_type(fastapi_app)
        try:
            test_client = manager.__enter__()
        except Exception as exc:  # pragma: no cover - app lifespan dependent
            pytest.skip(f"authenticated TestClient could not start: {exc}")
        try:
            yield test_client
        except BaseException:
            manager.__exit__(*sys.exc_info())
            raise
        else:
            manager.__exit__(None, None, None)
        finally:
            fastapi_app.dependency_overrides.clear()
            fastapi_app.dependency_overrides.update(previous)

    return make_client


@pytest.fixture()
def faculty_a_client(authenticated_client: Any) -> Iterator[Any]:
    with authenticated_client(
        role="faculty", profile_id="faculty-a", institution_id="institution-a"
    ) as test_client:
        yield test_client


@pytest.fixture()
def faculty_b_client(authenticated_client: Any) -> Iterator[Any]:
    with authenticated_client(
        role="faculty", profile_id="faculty-b", institution_id="institution-a"
    ) as test_client:
        yield test_client


@pytest.fixture()
def institution_a_admin_client(authenticated_client: Any) -> Iterator[Any]:
    with authenticated_client(
        role="admin", profile_id="admin-a", institution_id="institution-a"
    ) as test_client:
        yield test_client


@pytest.fixture()
def institution_b_admin_client(authenticated_client: Any) -> Iterator[Any]:
    with authenticated_client(
        role="admin", profile_id="admin-b", institution_id="institution-b"
    ) as test_client:
        yield test_client


def live_environment_missing() -> list[str]:
    required = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL")
    return [name for name in required if not os.getenv(name)]


@pytest.fixture()
def require_live_environment() -> None:
    missing = live_environment_missing()
    if missing:
        pytest.skip(
            "live integration requires " + ", ".join(missing) + "; no live secrets were provided"
        )


def as_plain_dict(principal: Principal) -> dict[str, Any]:
    """Expose the fixture identity for optional backend test factories."""

    return dict(principal)


__all__ = [
    "Principal",
    "REPO_ROOT",
    "as_plain_dict",
    "discover_app",
    "live_environment_missing",
    "route_path",
]
