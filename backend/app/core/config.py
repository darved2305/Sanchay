"""Typed runtime configuration for the API.

The API deliberately does not provide development database or storage defaults.
An instance can still boot far enough to expose ``/health`` while ``/ready``
reports the missing configuration; this makes deployment failures explicit
without hiding them behind an in-memory repository.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import Field, HttpUrl, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed settings used by the API and seed tooling."""

    model_config = SettingsConfigDict(
        env_file=".env",
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

    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    cors_allow_credentials: bool = True
    request_id_header: str = "X-Request-ID"

    orcid_api_url: HttpUrl = "https://pub.orcid.org/v3.0"
    openalex_api_url: HttpUrl = "https://api.openalex.org"
    crossref_api_url: HttpUrl = "https://api.crossref.org"
    external_api_timeout_seconds: float = Field(default=15.0, gt=0)
    openalex_mailto: str | None = None
    crossref_mailto: str | None = None

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
