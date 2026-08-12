"""HTTP-layer helpers for institution-scoped query composition."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException, status

from ..core.auth import CurrentUser


def institution_id_or_403(user: CurrentUser) -> UUID:
    if user.institution_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Profile has no institution scope")
    return user.institution_id


def safe_limit(value: int) -> int:
    return min(max(value, 1), 100)


def rows_to_dicts(rows: Any) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]
