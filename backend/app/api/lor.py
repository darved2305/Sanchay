"""USP 10 — LOR Studio: students, achievements, grounded letter drafting, export."""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from docx import Document
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..core.storage import StorageClient, StorageError
from ..services.llm import LLMProvider
from ..services.lor import draft_letter, polish_letter
from .schemas import (
    LetterDraftRequest,
    LetterDraftUpdate,
    StudentAchievementCreate,
    StudentLinkCreate,
)
from .utils import institution_id_or_403, rows_to_dicts

router = APIRouter(prefix="/lor", tags=["lor"])
students_router = APIRouter(prefix="/students", tags=["lor"])


@students_router.post("")
async def create_student(payload: StudentLinkCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    institution_id = institution_id_or_403(user)
    student_result = await session.execute(
        text("insert into public.student_records (institution_id, full_name, roll_number, program, created_by) values (:institution_id, :full_name, :roll_number, :program, :created_by) returning id"),
        {"institution_id": institution_id, "full_name": payload.full_name, "roll_number": payload.roll_number, "program": payload.program, "created_by": user.user_id},
    )
    student_id = student_result.scalar_one()
    await session.execute(
        text(
            "insert into public.faculty_student_links (faculty_id, student_id, relationship, course_or_project, start_date, end_date, notes) "
            "values (:faculty_id, :student_id, :relationship, :course_or_project, :start_date, :end_date, :notes)"
        ),
        {
            "faculty_id": user.user_id, "student_id": student_id, "relationship": payload.relationship,
            "course_or_project": payload.course_or_project, "start_date": payload.start_date, "end_date": payload.end_date, "notes": payload.notes,
        },
    )
    await session.commit()
    return {"student_id": student_id, "full_name": payload.full_name}


@students_router.get("")
async def list_my_students(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select s.id, s.full_name, s.roll_number, s.program, l.relationship, l.course_or_project, l.start_date, l.end_date,
                   (select count(*) from public.student_achievements a where a.student_id = s.id)::int as achievement_count
            from public.faculty_student_links l join public.student_records s on s.id = l.student_id
            where l.faculty_id = :faculty_id order by s.full_name
            """
        ),
        {"faculty_id": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@students_router.post("/{student_id}/achievements")
async def add_student_achievement(
    student_id: UUID,
    payload: StudentAchievementCreate,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    linked = await session.execute(text("select id from public.faculty_student_links where faculty_id = :faculty_id and student_id = :student_id"), {"faculty_id": user.user_id, "student_id": student_id})
    if linked.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You are not linked to this student")
    result = await session.execute(
        text("insert into public.student_achievements (student_id, title, description, achieved_on, created_by) values (:student_id, :title, :description, :achieved_on, :created_by) returning id"),
        {"student_id": student_id, "title": payload.title, "description": payload.description, "achieved_on": payload.achieved_on, "created_by": user.user_id},
    )
    achievement_id = result.scalar_one()
    await session.commit()
    return {"id": achievement_id}


async def _grounding_facts(session: AsyncSession, faculty_id: UUID, student_id: UUID, purpose: str) -> dict[str, Any]:
    student_result = await session.execute(text("select full_name from public.student_records where id = :id"), {"id": student_id})
    student_name = student_result.scalar_one_or_none()
    if student_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    links_result = await session.execute(
        text("select relationship, course_or_project, start_date, end_date, notes from public.faculty_student_links where faculty_id = :faculty_id and student_id = :student_id"),
        {"faculty_id": faculty_id, "student_id": student_id},
    )
    links = rows_to_dicts(links_result.mappings().all())
    if not links:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You have no recorded history with this student")
    achievements_result = await session.execute(text("select title, description, achieved_on from public.student_achievements where student_id = :student_id order by achieved_on"), {"student_id": student_id})
    achievements = rows_to_dicts(achievements_result.mappings().all())
    profile_result = await session.execute(
        text("select p.full_name as faculty_name, fp.designation, i.name as institution_name from public.profiles p left join public.faculty_profiles fp on fp.profile_id = p.id left join public.institutions i on i.id = p.institution_id where p.id = :id"),
        {"id": faculty_id},
    )
    profile = dict(profile_result.mappings().first() or {})
    return {"student_name": student_name, "purpose": purpose, "links": links, "achievements": achievements, **profile}


@router.post("/draft")
async def create_letter_draft(
    payload: LetterDraftRequest,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    facts = await _grounding_facts(session, user.user_id, payload.student_id, payload.purpose.value)
    deterministic_draft = draft_letter(facts)
    final_draft = await polish_letter(deterministic_draft, LLMProvider(settings))
    result = await session.execute(
        text(
            "insert into public.recommendation_letters (profile_id, student_id, purpose, grounding_facts, draft_text) "
            "values (:profile_id, :student_id, cast(:purpose as lor_purpose), cast(:facts as jsonb), :draft_text) returning id, draft_text, status::text as status, created_at"
        ),
        {"profile_id": user.user_id, "student_id": payload.student_id, "purpose": payload.purpose.value, "facts": json.dumps(facts, default=str), "draft_text": final_draft},
    )
    row = result.mappings().first()
    await session.commit()
    return dict(row)


@router.get("")
async def list_letters(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            "select l.id, l.purpose::text as purpose, l.status::text as status, l.created_at, s.full_name as student_name "
            "from public.recommendation_letters l join public.student_records s on s.id = l.student_id "
            "where l.profile_id = :profile_id order by l.created_at desc"
        ),
        {"profile_id": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.get("/{letter_id}")
async def get_letter(letter_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            "select l.id, l.purpose::text as purpose, l.draft_text, l.status::text as status, l.storage_path, l.created_at, s.full_name as student_name "
            "from public.recommendation_letters l join public.student_records s on s.id = l.student_id "
            "where l.id = :id and l.profile_id = :profile_id"
        ),
        {"id": letter_id, "profile_id": user.user_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Letter not found")
    return dict(row)


@router.patch("/{letter_id}")
async def update_letter(letter_id: UUID, payload: LetterDraftUpdate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text("update public.recommendation_letters set draft_text = :draft_text, updated_at = now() where id = :id and profile_id = :profile_id returning id"),
        {"draft_text": payload.draft_text, "id": letter_id, "profile_id": user.user_id},
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Letter not found")
    await session.commit()
    return await get_letter(letter_id, user, session)


def _letter_docx_bytes(student_name: str, draft_text: str) -> bytes:
    document = Document()
    for paragraph_text in draft_text.split("\n"):
        document.add_paragraph(paragraph_text)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


@router.post("/{letter_id}/export")
async def export_letter(letter_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db), settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    letter = await get_letter(letter_id, user, session)
    try:
        content = _letter_docx_bytes(letter["student_name"], letter["draft_text"])
        path = f"{user.user_id}/lor/{letter_id}/{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}.docx"
        storage = StorageClient(settings)
        await storage.upload_bytes(settings.supabase_generated_bucket, path, content, content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        await session.execute(text("update public.recommendation_letters set storage_path = :path, status = 'finalized', updated_at = now() where id = :id"), {"path": path, "id": letter_id})
        await session.execute(
            text("insert into public.generated_documents(owner_id, storage_path, file_name, mime_type) values (:owner_id, :path, :file_name, :mime_type)"),
            {"owner_id": user.user_id, "path": path, "file_name": f"LOR_{letter['student_name'].replace(' ', '_')}.docx", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        )
        await session.commit()
        signed_url = await storage.create_signed_download_url(settings.supabase_generated_bucket, path, settings.signed_url_ttl_seconds)
        return {"download_url": signed_url}
    except (StorageError, OSError, ValueError) as exc:
        await session.rollback()
        raise HTTPException(status_code=502, detail=f"Export failed: {exc}") from exc
