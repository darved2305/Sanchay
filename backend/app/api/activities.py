"""Canonical academic activity CRUD and confirmation routes."""

from __future__ import annotations

import json
from datetime import date
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..services.jobs import create_job, update_job
from ..services.llm import LLMProvider
from ..services.pagination import decode_cursor, page_result
from ..services.quick_add import parse_quick_add
from ..services.sql import mapping_or_404
from .schemas import ActivityCategory, ActivityCreate, ActivityPatch, ActivitySource, ActivityStatus, BulkConfirmRequest, EvidenceStatus, QuickAddRequest

router = APIRouter(prefix="/activities", tags=["activities"])


ACTIVITY_COLUMNS = """
    id, owner_id, category::text as category, title, description, role, organization, location,
    start_date, end_date, duration_hours, academic_year, doi, url, metadata,
    visibility::text as visibility, status::text as status, source::text as source,
    source_ref, confidence, evidence_status::text as evidence_status,
    confirmed_at, archived_at, created_at, updated_at
"""


async def _get_activity(session: AsyncSession, activity_id: UUID, owner_id: UUID) -> dict[str, Any]:
    result = await session.execute(
        text(f"select {ACTIVITY_COLUMNS} from public.academic_activities where id = :id and owner_id = :owner_id"),
        {"id": activity_id, "owner_id": owner_id},
    )
    return mapping_or_404(result, "Activity not found")


async def _activity_detail(session: AsyncSession, activity_id: UUID, owner_id: UUID) -> dict[str, Any]:
    activity = await _get_activity(session, activity_id, owner_id)
    participants = await session.execute(
        text(
            """
            select ap.profile_id, ap.role, ap.is_owner, p.full_name, p.email
            from public.activity_participants ap
            join public.profiles p on p.id = ap.profile_id
            where ap.activity_id = :activity_id
            order by ap.is_owner desc, p.full_name
            """
        ),
        {"activity_id": activity_id},
    )
    evidence = await session.execute(
        text(
            """
            select ef.id, ef.file_name, ef.mime_type, ef.size_bytes, ef.storage_path,
                   ef.doc_date, ef.organization, ef.tags, ef.source::text as source, ef.created_at
            from public.activity_evidence ae
            join public.evidence_files ef on ef.id = ae.evidence_id
            where ae.activity_id = :activity_id and ef.owner_id = :owner_id
            order by ef.created_at desc
            """
        ),
        {"activity_id": activity_id, "owner_id": owner_id},
    )
    activity["participants"] = [dict(row) for row in participants.mappings().all()]
    activity["evidence"] = [dict(row) for row in evidence.mappings().all()]
    return activity


async def _assert_activity_editable(session: AsyncSession, activity_id: UUID, owner_id: UUID) -> None:
    approved = await session.execute(
        text(
            """
            select exists(
              select 1
              from public.appraisal_submission_items i
              join public.appraisal_submissions s on s.id = i.submission_id
              where i.activity_id = :activity_id and s.profile_id = :owner_id and s.status = 'approved'
            )
            """
        ),
        {"activity_id": activity_id, "owner_id": owner_id},
    )
    if approved.scalar():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Activities in an approved appraisal cannot be edited")


def _validate_activity_dates(current: dict[str, Any], values: dict[str, Any]) -> None:
    """Validate a partial update against the dates already stored in PostgreSQL."""

    start_date = values["start_date"] if "start_date" in values else current.get("start_date")
    end_date = values["end_date"] if "end_date" in values else current.get("end_date")
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date cannot be before start_date")


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_activity(
    payload: ActivityCreate,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            insert into public.academic_activities (
              owner_id, category, title, description, role, organization, location,
              start_date, end_date, duration_hours, academic_year, doi, url, metadata,
              visibility, status, source, evidence_status, confirmed_at
            ) values (
              :owner_id, cast(:category as activity_category), :title, :description, :role,
              :organization, :location, :start_date, :end_date, :duration_hours, :academic_year,
              :doi, :url, cast(:metadata as jsonb), cast(:visibility as visibility_level),
              'confirmed', 'manual', cast(:evidence_status as evidence_status_t), now()
            ) returning id
            """
        ),
        {
            "owner_id": user.user_id,
            "category": payload.category.value,
            "title": payload.title,
            "description": payload.description,
            "role": payload.role,
            "organization": payload.organization,
            "location": payload.location,
            "start_date": payload.start_date,
            "end_date": payload.end_date,
            "duration_hours": payload.duration_hours,
            "academic_year": payload.academic_year,
            "doi": payload.doi,
            "url": payload.url,
            "metadata": json.dumps(payload.metadata),
            "visibility": payload.visibility,
            "evidence_status": payload.evidence_status.value,
        },
    )
    activity_id = result.scalar_one()
    await session.commit()
    return await _activity_detail(session, activity_id, user.user_id)


@router.get("")
async def list_activities(
    category: ActivityCategory | None = None,
    academic_year: str | None = Query(default=None, max_length=30),
    activity_status: ActivityStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=200),
    evidence_status: EvidenceStatus | None = None,
    source: ActivitySource | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = None,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clauses = ["owner_id = :owner_id"]
    params: dict[str, Any] = {"owner_id": user.user_id, "limit": limit + 1}
    if category:
        clauses.append("category = cast(:category as activity_category)")
        params["category"] = category.value
    if academic_year:
        clauses.append("academic_year = :academic_year")
        params["academic_year"] = academic_year
    if activity_status:
        clauses.append("status = cast(:activity_status as activity_status)")
        params["activity_status"] = activity_status.value
    if evidence_status:
        clauses.append("evidence_status = cast(:evidence_status as evidence_status_t)")
        params["evidence_status"] = evidence_status.value
    if source:
        clauses.append("source = cast(:source as activity_source)")
        params["source"] = source.value
    if q:
        clauses.append("(title ilike :query or coalesce(description, '') ilike :query or coalesce(organization, '') ilike :query)")
        params["query"] = f"%{q}%"
    decoded = decode_cursor(cursor)
    if decoded:
        clauses.append("(created_at, id) < (:cursor_created_at, :cursor_id)")
        params["cursor_created_at"] = decoded.get("created_at")
        params["cursor_id"] = decoded["id"]
    result = await session.execute(
        text(
            f"select {ACTIVITY_COLUMNS} from public.academic_activities "
            f"where {' and '.join(clauses)} order by created_at desc, id desc limit :limit"
        ),
        params,
    )
    return page_result([dict(row) for row in result.mappings().all()], limit)


@router.get("/timeline")
async def activity_timeline(
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, list[dict[str, Any]]]:
    result = await session.execute(
        text(
            f"""
            select {ACTIVITY_COLUMNS}
            from public.academic_activities
            where owner_id = :owner_id and status <> 'archived'
            order by coalesce(start_date, created_at::date) desc, created_at desc
            """
        ),
        {"owner_id": user.user_id},
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in result.mappings().all():
        item = dict(row)
        grouped.setdefault(str(item["academic_year"]), []).append(item)
    return grouped


@router.get("/{activity_id}")
async def get_activity(
    activity_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await _activity_detail(session, activity_id, user.user_id)


@router.patch("/{activity_id}")
async def update_activity(
    activity_id: UUID,
    payload: ActivityPatch,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    current = await _get_activity(session, activity_id, user.user_id)
    await _assert_activity_editable(session, activity_id, user.user_id)
    if current["status"] == "archived":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archived activities cannot be edited")
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return await _activity_detail(session, activity_id, user.user_id)
    _validate_activity_dates(current, values)
    assignments: list[str] = []
    params: dict[str, Any] = {"id": activity_id, "owner_id": user.user_id}
    enum_fields = {"category": "activity_category", "visibility": "visibility_level", "evidence_status": "evidence_status_t"}
    for index, (key, value) in enumerate(values.items()):
        bind = f"value_{index}"
        if key == "metadata":
            assignments.append(f"metadata = cast(:{bind} as jsonb)")
            params[bind] = json.dumps(value)
        elif key in enum_fields:
            assignments.append(f"{key} = cast(:{bind} as {enum_fields[key]})")
            params[bind] = value.value if hasattr(value, "value") else value
        else:
            assignments.append(f"{key} = :{bind}")
            params[bind] = value.value if hasattr(value, "value") else value
    await session.execute(
        text(f"update public.academic_activities set {', '.join(assignments)}, updated_at = now() where id = :id and owner_id = :owner_id"),
        params,
    )
    await session.commit()
    return await _activity_detail(session, activity_id, user.user_id)


@router.post("/{activity_id}/confirm")
async def confirm_activity(
    activity_id: UUID,
    payload: ActivityPatch | None = None,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    current = await _get_activity(session, activity_id, user.user_id)
    await _assert_activity_editable(session, activity_id, user.user_id)
    if current["status"] == "archived":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archived activities cannot be confirmed")
    values = payload.model_dump(exclude_unset=True) if payload else {}
    _validate_activity_dates(current, values)
    if current["status"] == "proposed":
        await session.execute(
            text(
                "update public.academic_activities set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), updated_at = now() "
                "where id = :id and owner_id = :owner_id"
            ),
            {"id": activity_id, "owner_id": user.user_id},
        )
    if values:
        # Reuse the normal update path's validation without recursively
        # issuing another HTTP request.
        assignments: list[str] = []
        params: dict[str, Any] = {"id": activity_id, "owner_id": user.user_id}
        enum_fields = {"category": "activity_category", "visibility": "visibility_level", "evidence_status": "evidence_status_t"}
        for index, (key, value) in enumerate(values.items()):
            bind = f"value_{index}"
            if key == "metadata":
                assignments.append(f"metadata = cast(:{bind} as jsonb)")
                params[bind] = json.dumps(value)
            elif key in enum_fields:
                assignments.append(f"{key} = cast(:{bind} as {enum_fields[key]})")
                params[bind] = value.value if hasattr(value, "value") else value
            else:
                assignments.append(f"{key} = :{bind}")
                params[bind] = value.value if hasattr(value, "value") else value
        await session.execute(
            text(f"update public.academic_activities set {', '.join(assignments)}, updated_at = now() where id = :id and owner_id = :owner_id"),
            params,
        )
    await session.commit()
    return await _activity_detail(session, activity_id, user.user_id)


@router.post("/{activity_id}/archive")
async def archive_activity(
    activity_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await _assert_activity_editable(session, activity_id, user.user_id)
    result = await session.execute(
        text("update public.academic_activities set status = 'archived', archived_at = coalesce(archived_at, now()), updated_at = now() where id = :id and owner_id = :owner_id"),
        {"id": activity_id, "owner_id": user.user_id},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Activity not found")
    await session.commit()
    return {"ok": True}


@router.delete("/{activity_id}")
async def delete_activity(
    activity_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    return await archive_activity(activity_id, user, session)


@router.post("/quick-add")
async def quick_add_activity(
    payload: QuickAddRequest,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Parse a natural-language note into one proposed activity for confirmation.

    Shared by the global Quick Add button and Voice Dump (browser
    speech-to-text feeds the same text into this endpoint).
    """

    draft = await parse_quick_add(payload.text, LLMProvider(settings))
    result = await session.execute(
        text(
            """
            insert into public.academic_activities (
              owner_id, category, title, organization, start_date, duration_hours,
              academic_year, metadata, status, source, confidence
            ) values (
              :owner_id, cast(:category as activity_category), :title, :organization, :start_date,
              :duration_hours, :academic_year, cast(:metadata as jsonb), 'proposed', 'quick_capture', 0.6
            ) returning id
            """
        ),
        {
            "owner_id": user.user_id,
            "category": draft["category"],
            "title": draft["title"],
            "organization": draft.get("organization"),
            "start_date": draft["start_date"],
            "duration_hours": draft.get("duration_hours"),
            "academic_year": draft["academic_year"],
            "metadata": json.dumps({"quick_add_text": payload.text}),
        },
    )
    activity_id = result.scalar_one()
    await session.commit()
    return await _activity_detail(session, activity_id, user.user_id)


@router.post("/bulk-confirm")
async def bulk_confirm(
    payload: BulkConfirmRequest,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    result = await session.execute(
        text(
            "update public.academic_activities set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), updated_at = now() "
            "where owner_id = :owner_id and id = any(cast(:ids as uuid[])) and status = 'proposed'"
        ),
        {"owner_id": user.user_id, "ids": [str(item) for item in payload.activity_ids]},
    )
    await session.commit()
    return {"confirmed": result.rowcount or 0}
