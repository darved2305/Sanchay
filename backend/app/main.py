"""FastAPI application factory and platform endpoints."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.base import BaseHTTPMiddleware

from . import __version__
from .api.router import api_router
from .core.config import Settings, get_settings
from .core.db import database
from .core.errors import validation_error_handler
from .core.logging import configure_logging
from .core.request_context import request_id_context
from .core.storage import StorageClient, StorageError

logger = logging.getLogger(__name__)


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        settings = get_settings()
        incoming = request.headers.get(settings.request_id_header)
        try:
            request_id = str(UUID(incoming)) if incoming else str(uuid4())
        except (ValueError, AttributeError):
            request_id = str(uuid4())
        token = request_id_context.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "request_failed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": 500,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            raise
        finally:
            request_id_context.reset(token)
        response.headers[settings.request_id_header] = request_id
        logger.info(
            "request_completed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = getattr(app.state, "runtime_settings", None) or get_settings()
    configure_logging(settings.log_level)
    database.configure(settings)
    logger.info("api_started", extra={"configured": settings.is_configured})
    try:
        yield
    finally:
        await database.close()
        logger.info("api_stopped")


def create_app(settings: Settings | None = None) -> FastAPI:
    # ``get_settings`` remains the dependency source; replacing its cache is
    # intentionally not done here so tests/deployments can use env isolation.
    runtime = settings or get_settings()
    app = FastAPI(
        title=runtime.app_name,
        version=runtime.app_version,
        description="Institution-scoped academic activity and appraisal API",
        lifespan=lifespan,
    )
    app.state.runtime_settings = runtime
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=runtime.cors_origins,
        allow_credentials=runtime.cors_allow_credentials,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", runtime.request_id_header],
        expose_headers=[runtime.request_id_header],
    )
    app.add_exception_handler(RequestValidationError, validation_error_handler)

    @app.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        request_id = request_id_context.get()
        logger.exception("unhandled_api_error", extra={"request_id": request_id, "path": request.url.path})
        return JSONResponse(
            status_code=500,
            content={"detail": "The service encountered an unexpected error.", "request_id": request_id},
        )

    @app.get("/health", tags=["platform"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": runtime.app_version or __version__, "git_sha": runtime.git_sha}

    @app.get("/ready", response_model=None, tags=["platform"])
    async def ready() -> JSONResponse | dict[str, object]:
        missing = runtime.missing_runtime_settings
        if missing:
            return JSONResponse(
                status_code=503,
                content={"detail": f"Runtime configuration is incomplete: {', '.join(missing)}"},
            )
        checks: dict[str, str] = {}
        try:
            database.configure(runtime)
            await database.ping()
            checks["database"] = "ok"
            storage = StorageClient(runtime)
            await storage.check_bucket(runtime.supabase_evidence_bucket)
            await storage.check_bucket(runtime.supabase_generated_bucket)
            checks["storage"] = "ok"
            checks["realtime"] = "configured"
            return {"status": "ready", "checks": checks}
        except (StorageError, SQLAlchemyError, RuntimeError, OSError) as exc:
            logger.error("readiness_check_failed", extra={"error": str(exc)})
            checks.setdefault("database", "unknown")
            checks.setdefault("storage", "failed")
            return JSONResponse(
                status_code=503,
                content={"detail": f"Service dependencies are not ready: {exc}", "checks": checks},
            )

    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
