"""Authenticated notification inbox endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, get_current_user
from ..core.db import get_db
from .schemas import NotificationReadRequest
from .utils import rows_to_dicts

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    unread: bool = Query(default=False),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clause = "and read_at is null" if unread else ""
    result = await session.execute(
        text(f"select id, profile_id, kind, title, body, link_path, read_at, created_at from public.notifications where profile_id = :profile_id {clause} order by created_at desc limit 100"),
        {"profile_id": user.user_id},
    )
    items = rows_to_dicts(result.mappings().all())
    return {"items": items, "unread_count": sum(1 for item in items if item.get("read_at") is None)}


@router.post("/read")
async def mark_notifications_read(
    payload: NotificationReadRequest,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    if payload.all:
        result = await session.execute(text("update public.notifications set read_at = coalesce(read_at, now()) where profile_id = :profile_id and read_at is null"), {"profile_id": user.user_id})
    else:
        result = await session.execute(text("update public.notifications set read_at = coalesce(read_at, now()) where profile_id = :profile_id and id = any(cast(:ids as uuid[]))"), {"profile_id": user.user_id, "ids": [str(value) for value in (payload.ids or [])]})
    await session.commit()
    return {"updated": result.rowcount or 0}
