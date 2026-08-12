"""Opaque cursor pagination helpers shared by list endpoints."""

from __future__ import annotations

import base64
import json
from datetime import date, datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status


def encode_cursor(*, created_at: datetime | date | None, item_id: UUID | str) -> str:
    value = created_at.isoformat() if created_at is not None else None
    payload = {"created_at": value, "id": str(item_id)}
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    return encoded.rstrip("=")


def decode_cursor(cursor: str | None) -> dict[str, Any] | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        if not isinstance(payload, dict) or "id" not in payload:
            raise ValueError
        UUID(str(payload["id"]))
        if payload.get("created_at"):
            payload["created_at"] = datetime.fromisoformat(str(payload["created_at"]))
        return payload
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid pagination cursor") from exc


def page_result(items: list[dict[str, Any]], limit: int, *, id_field: str = "id") -> dict[str, Any]:
    next_cursor: str | None = None
    if len(items) > limit:
        page_items = items[:limit]
        last = page_items[-1]
        next_cursor = encode_cursor(created_at=last.get("created_at"), item_id=last[id_field])
    else:
        page_items = items
    return {"items": page_items, "next_cursor": next_cursor}
