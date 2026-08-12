"""Supabase access-token verification and profile-backed authorization."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings, get_settings
from .db import get_db

logger = logging.getLogger(__name__)


ADMIN_ROLES = frozenset({"admin", "dept_admin", "institution_admin", "reviewer"})


@dataclass(frozen=True)
class CurrentUser:
    """Authenticated principal plus the role loaded from ``profiles``."""

    user_id: UUID
    role: str
    profile: dict[str, Any]

    @property
    def institution_id(self) -> UUID | None:
        value = self.profile.get("institution_id")
        return UUID(str(value)) if value else None

    @property
    def department_id(self) -> UUID | None:
        value = self.profile.get("department_id")
        return UUID(str(value)) if value else None

    @property
    def is_admin(self) -> bool:
        return self.role in ADMIN_ROLES


async def _jwks_key(settings: Settings, token: str) -> tuple[Any, str]:
    if not settings.supabase_jwt_jwks_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT verification configuration is missing",
        )
    try:
        header = jwt.get_unverified_header(token)
        async with httpx.AsyncClient(timeout=settings.external_api_timeout_seconds) as client:
            response = await client.get(str(settings.supabase_jwt_jwks_url))
            response.raise_for_status()
        keys = response.json().get("keys", [])
        key = next((candidate for candidate in keys if candidate.get("kid") == header.get("kid")), None)
        if key is None and len(keys) == 1:
            key = keys[0]
        if key is None:
            raise ValueError("No matching JWT signing key")
        return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key)), str(header.get("alg", "RS256"))
    except (httpx.HTTPError, ValueError, KeyError, jwt.PyJWTError) as exc:
        logger.warning("jwt_jwks_lookup_failed", extra={"error": str(exc)})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to verify access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def _decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    try:
        if settings.supabase_jwt_secret:
            key: Any = settings.supabase_jwt_secret.get_secret_value()
            algorithms = ["HS256"]
        else:
            key, algorithm = await _jwks_key(settings, token)
            algorithms = [algorithm]
        decode_kwargs: dict[str, Any] = {"algorithms": algorithms}
        if settings.supabase_jwt_audience:
            decode_kwargs["audience"] = settings.supabase_jwt_audience
        if settings.supabase_jwt_issuer:
            decode_kwargs["issuer"] = settings.supabase_jwt_issuer
        claims = jwt.decode(token, key, **decode_kwargs)
        subject = claims.get("sub")
        if not subject:
            raise ValueError("Token has no subject")
        UUID(str(subject))
        return claims
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def get_current_user(
    request: Request,
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer access token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if settings.missing_runtime_settings:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication configuration is incomplete",
        )
    claims = await _decode_access_token(token.strip(), settings)
    user_id = UUID(str(claims["sub"]))
    result = await session.execute(
        text(
            """
            select id, role::text as role, full_name, email, phone, photo_url, bio,
                   institution_id, department_id, research_interests, teaching_interests,
                   expertise, career_goals, open_to_mentorship, open_to_collaboration,
                   accepting_phd_inquiries, onboarding_completed_at, created_at, updated_at
            from public.profiles
            where id = :user_id
            """
        ),
        {"user_id": user_id},
    )
    profile = result.mappings().first()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authenticated profile has not been provisioned",
        )
    profile_data = dict(profile)
    # ``exp`` is normally verified by PyJWT, but keeping this explicit makes
    # behavior clear when verification options change in a future release.
    if claims.get("exp") and datetime.fromtimestamp(int(claims["exp"]), tz=UTC) <= datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Access token has expired")
    return CurrentUser(user_id=user_id, role=str(profile_data.pop("role")), profile=profile_data)


async def require_faculty(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role != "faculty":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Faculty access is required")
    return user


async def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access is required")
    if user.institution_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator has no institution scope")
    return user
