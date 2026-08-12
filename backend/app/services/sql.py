"""Small SQLAlchemy result and exception utilities."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


def mapping_or_404(result: Any, detail: str = "Resource not found") -> dict[str, Any]:
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return dict(row)


async def commit_or_conflict(session: AsyncSession, detail: str = "Resource conflicts with existing data") -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc
