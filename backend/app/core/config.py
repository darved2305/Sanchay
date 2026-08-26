"""Typed runtime configuration for the API.

The API deliberately does not provide development database or storage defaults.
An instance can still boot far enough to expose ``/health`` while ``/ready``
reports the missing configuration; this makes deployment failures explicit
without hiding them behind an in-memory repository.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, HttpUrl, SecretStr, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# A relative ".env" resolves against whatever directory the process happened
# to be launched from, so `cd backend && uvicorn ...` and
# `uvicorn ... --app-dir backend` (run from the repo root) silently load two
# different files. Anchoring to the repo root (three levels up from this
# file: core -> app -> backend -> repo root) makes config loading the same
# regardless of launch cwd. Harmless in production, where no .env file
# exists at that path and real environment variables are used instead.
_REPO_ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    """Environment-backed settings used by the API and seed tooling."""

    model_config = SettingsConfigDict(
        env_file=_REPO_ROOT_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Academic Record API"
    app_version: str = "0.1.0"
    environment: str = "development"
    git_sha: str = "unknown"
    log_level: str = "INFO"

    # A direct pooled connection is used for business queries. Supabase's
    # service key is intentionally not used as a substitute for PostgreSQL.
    database_url: str | None = None
    database_pool_min_size: int = Field(default=1, ge=1)
    database_pool_max_size: int = Field(default=10, ge=1)
    database_command_timeout_seconds: float = Field(default=10.0, gt=0)

    supabase_url: Annotated[HttpUrl | None, Field(default=None)] = None
    supabase_anon_key: SecretStr | None = None
    supabase_service_role_key: SecretStr | None = None
    supabase_jwt_secret: SecretStr | None = None
    supabase_jwt_jwks_url: HttpUrl | None = None
    supabase_jwt_issuer: str | None = None
    supabase_jwt_audience: str | None = "authenticated"
    supabase_evidence_bucket: str = "evidence"
    supabase_generated_bucket: str = "generated"
    signed_url_ttl_seconds: int = Field(default=60, ge=30, le=3600)
    # A link the assistant hands back sits in the conversation, not on a page
    # the user is already looking at: they read the reply, scroll, maybe switch
    # tabs, and come back. The 60s default above is tuned for a link clicked
    # immediately from a document list and expires before it is ever used here.
    assistant_document_url_ttl_seconds: int = Field(default=900, ge=60, le=3600)

    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    cors_allow_credentials: bool = True
    request_id_header: str = "X-Request-ID"

    # Applies to every route by default (slowapi's SlowAPIMiddleware, main.py)
    # regardless of auth state -- there was previously no rate limiting at
    # any layer (no app middleware, no reverse-proxy throttling on Railway),
    # so an unauthenticated route like the OAuth callback, or a scripted
    # client hammering an LLM-backed endpoint, had no limit at all.
    rate_limit_default: str = "120/minute"

    orcid_api_url: HttpUrl = "https://pub.orcid.org/v3.0"
    openalex_api_url: HttpUrl = "https://api.openalex.org"
    crossref_api_url: HttpUrl = "https://api.crossref.org"
    external_api_timeout_seconds: float = Field(default=15.0, gt=0)
    openalex_mailto: str | None = None
    crossref_mailto: str | None = None

    # Optional LLM provider for structured extraction (CV import, teaching
    # change interpretation, LOR letter polish, quick-add parsing). Every
    # caller must work without this key configured, falling back to
    # deterministic heuristics; see app/services/llm.py. Groq's inference is
    # used here specifically for its latency -- these are interactive,
    # in-request calls (a professor is waiting on the result), not batch
    # jobs, so response speed matters more than using the single smartest
    # model available.
    groq_api_key: SecretStr | None = None
    # Groq is decommissioning llama-3.1-8b-instant on 2026-08-16; openai/gpt-oss-20b
    # is Groq's own recommended replacement (confirmed via console.groq.com/docs/models).
    llm_model: str = "openai/gpt-oss-20b"
    # Separate vision-capable model for OCR-by-LLM (scanned/photographed CVs,
    # certificates): text-only models can't take image input at all, and this
    # one is deliberately not the default `llm_model` above so a Groq catalog
    # change to one doesn't silently break the other.
    llm_vision_model: str = "qwen/qwen3.6-27b"
    llm_timeout_seconds: float = Field(default=15.0, gt=0)

    # Optional OpenRouter backend. Both providers speak the OpenAI chat
    # completions dialect, so selecting one only swaps base URL, key and model
    # -- no second client. Groq stays the default because the extraction paths
    # were tuned for its latency; OpenRouter exists mainly so the assistant can
    # reach a stronger tool-calling model than the fast extraction default.
    llm_provider: Literal["groq", "openrouter"] = "groq"
    openrouter_api_key: SecretStr | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "anthropic/claude-sonnet-4.5"
    openrouter_vision_model: str = "anthropic/claude-sonnet-4.5"
    # OpenRouter attributes traffic to an app via these headers; harmless when
    # unset, and only sent on the OpenRouter path.
    openrouter_app_url: str | None = None
    openrouter_app_title: str = "Sanchaya"
    # Decline provider hosts whose p90 latency is already above this (seconds).
    # OpenRouter reorders candidates rather than failing the request.
    openrouter_max_latency_p90: float = Field(default=8.0, gt=0)
    # Ordered fallbacks tried when the primary model is unavailable or rate
    # limited upstream. Free/stealth models share a pool that returns 429 under
    # load, so a demo without a fallback is one shared-pool spike from failing.
    openrouter_fallback_models: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # Optional override so the assistant's agent loop can run a different (and
    # usually stronger) model than the 23 extraction services, whose prompts are
    # tuned for a fast cheap one. Falls back to the active provider's default.
    agent_model: str | None = None

    # Google OAuth (Gmail/Calendar/Drive) for Reconstruct My Year. Read-only
    # scopes only; absent credentials keep the connector in a clean
    # "not configured" state rather than crashing.
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: SecretStr | None = None
    google_oauth_redirect_uri: str | None = None
    reconstruct_fake_sources: bool = False

    @field_validator(
        "llm_model",
        "llm_vision_model",
        "openrouter_model",
        "openrouter_vision_model",
        "openrouter_base_url",
        "agent_model",
        "openrouter_app_url",
        mode="before",
    )
    @classmethod
    def blank_means_unset(cls, value: object, info: ValidationInfo) -> object:
        """Treat ``KEY=`` in a .env file as absent rather than as an empty string.

        Clearing a value is the obvious way to "turn it off", but
        pydantic-settings still sees the key and hands over ``""``, which
        overrides the default. That produced a request with ``"model": ""`` --
        a provider 400 that reads like the assistant is down rather than like a
        config typo. Falling back to the declared default keeps a blank line
        behaving the same as a missing one.
        """

        if isinstance(value, str) and not value.strip():
            field = cls.model_fields.get(info.field_name or "")
            return field.get_default(call_default_factory=True) if field else None
        return value

    @field_validator("openrouter_fallback_models", mode="before")
    @classmethod
    def parse_fallback_models(cls, value: object) -> object:
        if value is None or isinstance(value, list):
            return value or []
        if isinstance(value, str):
            return [model.strip() for model in value.split(",") if model.strip()]
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if value is None or isinstance(value, list):
            return value or []
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def missing_runtime_settings(self) -> list[str]:
        """Return required production settings that are not configured."""

        required: dict[str, object | None] = {
            "DATABASE_URL": self.database_url,
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_SERVICE_ROLE_KEY": self.supabase_service_role_key,
            "SUPABASE_ANON_KEY": self.supabase_anon_key,
        }
        # Either HS256 secret or an asymmetric JWKS endpoint is sufficient for
        # JWT verification. Requiring one here avoids an accidentally open API.
        if self.supabase_jwt_secret is None and self.supabase_jwt_jwks_url is None:
            required["SUPABASE_JWT_SECRET or SUPABASE_JWT_JWKS_URL"] = None
        return [name for name, value in required.items() if value is None]

    @property
    def supabase_base_url(self) -> str | None:
        return str(self.supabase_url).rstrip("/") if self.supabase_url else None

    @property
    def is_configured(self) -> bool:
        return not self.missing_runtime_settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
