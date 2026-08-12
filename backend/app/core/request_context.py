"""Request-scoped context used by structured logs and service code."""

from __future__ import annotations

from contextvars import ContextVar


request_id_context: ContextVar[str] = ContextVar("request_id", default="-")
