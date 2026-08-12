"""Database-backed appraisal generation, submission, review, and PDF export."""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_admin, require_faculty, get_current_user
from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..core.storage import StorageClient, StorageError
from ..services.sql import mapping_or_404
from .schemas import ReviewAction, SubmissionItemUpdate, SubmissionItemsPatch, SubmissionReviewRequest
from .utils import institution_id_or_403, rows_to_dicts

router = APIRouter(prefix="/appraisals", tags=["appraisals"])

VALID_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"submitted"},
    # Reviewers may approve directly from the submitted queue or explicitly
    # record an under-review step first. Returns and rejections are also
    # allowed from the queue when a submission is incomplete or ineligible.
    "submitted": {"under_review", "returned", "approved", "rejected"},
    "under_review": {"returned", "approved", "rejected"},
    "returned": {"submitted"},
    "approved": set(),
    "rejected": set(),
}


def is_valid_submission_transition(current: str, target: str) -> bool:
    """Pure state-machine helper used by API code and tests."""

    return target in VALID_TRANSITIONS.get(str(current), set())


def compute_appraisal_readiness(sections: list[dict[str, Any]]) -> float:
    """Percentage of required sections containing confirmed activity items."""

    required = [section for section in sections if section.get("required")]
    if not required:
        return 100.0
    complete = 0
    for section in required:
        items = section.get("items") or []
        if any(
            item.get("status", item.get("activity_status")) == "confirmed"
            and item.get("evidence_status", item.get("activity_evidence_status")) in {None, "attached", "none_needed"}
            for item in items
        ):
            complete += 1
    return round(complete * 100 / len(required), 2)


async def _cycle(session: AsyncSession, cycle_id: UUID, user: CurrentUser) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select c.id, c.name, c.academic_year, c.opens_at, c.due_at, c.status::text as status,
                   c.institution_id, c.template_id, t.name as template_name
            from public.appraisal_cycles c
            join public.appraisal_templates t on t.id = c.template_id
            where c.id = :cycle_id and c.institution_id = :institution_id
            """
        ),
        {"cycle_id": cycle_id, "institution_id": institution_id_or_403(user)},
    )
    return mapping_or_404(result, "Appraisal cycle not found")


async def _open_cycle(session: AsyncSession, user: CurrentUser) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select c.id, c.name, c.academic_year, c.opens_at, c.due_at, c.status::text as status,
                   c.institution_id, c.template_id, t.name as template_name
            from public.appraisal_cycles c
            join public.appraisal_templates t on t.id = c.template_id
            where c.institution_id = :institution_id and c.status = 'open'
            order by c.due_at nulls last, c.created_at desc limit 1
            """
        ),
        {"institution_id": institution_id_or_403(user)},
    )
    return mapping_or_404(result, "No open appraisal cycle is available")


async def _sections(session: AsyncSession, template_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            select id, template_id, position, title, description, categories, required, allow_free_text
            from public.appraisal_sections where template_id = :template_id order by position
            """
        ),
        {"template_id": template_id},
    )
    return [dict(row) for row in result.mappings().all()]


async def _activities_for_cycle(session: AsyncSession, profile_id: UUID, academic_year: str) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            select id, category::text as category, title, description, role, organization, location,
                   start_date, end_date, academic_year, doi, url, metadata, evidence_status::text as evidence_status,
                   status::text as status
            from public.academic_activities
            where owner_id = :profile_id and academic_year = :academic_year and status = 'confirmed'
            order by coalesce(start_date, created_at::date), created_at
            """
        ),
        {"profile_id": profile_id, "academic_year": academic_year},
    )
    return [dict(row) for row in result.mappings().all()]


def _category_matches(section: dict[str, Any], category: str) -> bool:
    categories = section.get("categories") or []
    return category in {str(value).split(".")[-1] for value in categories}


async def _submission(session: AsyncSession, submission_id: UUID, user: CurrentUser, *, lock: bool = False) -> dict[str, Any]:
    query = """
        select s.id, s.cycle_id, s.profile_id, s.status::text as status, s.submitted_at,
               s.decided_at, s.readiness, s.generated_pdf_path, s.created_at, s.updated_at,
               c.name as cycle_name, c.academic_year, c.due_at, c.institution_id,
               p.full_name, p.email, p.department_id, d.name as department,
               fp.employee_code, fp.designation
        from public.appraisal_submissions s
        join public.appraisal_cycles c on c.id = s.cycle_id
        join public.profiles p on p.id = s.profile_id
        left join public.departments d on d.id = p.department_id
        left join public.faculty_profiles fp on fp.profile_id = p.id
        where s.id = :submission_id
    """
    params: dict[str, Any] = {"submission_id": submission_id}
    if user.is_admin:
        query += " and p.institution_id = :institution_id"
        params["institution_id"] = institution_id_or_403(user)
    else:
        query += " and s.profile_id = :profile_id"
        params["profile_id"] = user.user_id
    if lock:
        # Lock only the submission row. PostgreSQL rejects a plain FOR UPDATE
        # here because the detail query also contains nullable LEFT JOINs.
        query += " for update of s"
    result = await session.execute(text(query), params)
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Appraisal submission not found")
    payload = dict(row)
    section_result = await session.execute(
        text(
            """
            select sec.id as section_id, sec.position as section_position, sec.title, sec.description,
                   sec.required, i.id as item_id, i.activity_id, i.free_text, i.position, i.faculty_note,
                   a.category::text as activity_category, a.title as activity_title, a.description as activity_description,
                   a.organization, a.start_date, a.end_date, a.academic_year, a.doi,
                   a.evidence_status::text as activity_evidence_status, a.status::text as activity_status
            from public.appraisal_sections sec
            left join public.appraisal_submission_items i on i.section_id = sec.id and i.submission_id = :submission_id
            left join public.academic_activities a on a.id = i.activity_id
            where sec.template_id = (select c.template_id from public.appraisal_cycles c where c.id = :cycle_id)
            order by sec.position, i.position, a.start_date nulls last
            """
        ),
        {"submission_id": submission_id, "cycle_id": payload["cycle_id"]},
    )
    sections: dict[UUID, dict[str, Any]] = {}
    for row in section_result.mappings().all():
        section_id = row["section_id"]
        section = sections.setdefault(section_id, {
            "id": section_id,
            "position": row["section_position"],
            "title": row["title"],
            "description": row["description"],
            "required": row["required"],
            "items": [],
        })
        if row["item_id"]:
            section["items"].append({
                "id": row["item_id"], "activity_id": row["activity_id"], "free_text": row["free_text"],
                "position": row["position"], "faculty_note": row["faculty_note"],
                "activity": {
                    "id": row["activity_id"], "category": row["activity_category"], "title": row["activity_title"],
                    "description": row["activity_description"], "organization": row["organization"],
                    "start_date": row["start_date"], "end_date": row["end_date"], "academic_year": row["academic_year"],
                    "doi": row["doi"], "evidence_status": row["activity_evidence_status"], "status": row["activity_status"],
                } if row["activity_id"] else None,
            })
    payload["sections"] = list(sections.values())
    reviews = await session.execute(
        text(
            """
            select r.id, r.action::text as action, r.comment, r.section_id, r.created_at,
                   p.id as reviewer_id, p.full_name as reviewer_name, p.email as reviewer_email
            from public.appraisal_reviews r join public.profiles p on p.id = r.reviewer_id
            where r.submission_id = :submission_id order by r.created_at desc
            """
        ),
        {"submission_id": submission_id},
    )
    payload["reviews"] = rows_to_dicts(reviews.mappings().all())
    payload["activity_count"] = sum(len(section["items"]) for section in payload["sections"])
    return payload


@router.get("/cycles")
async def list_cycles(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select c.id, c.name, c.academic_year, c.opens_at, c.due_at, c.status::text as status,
                   s.id as submission_id, coalesce(s.status::text, 'not_started') as submission_status,
                   s.readiness
            from public.appraisal_cycles c
            left join public.appraisal_submissions s on s.cycle_id = c.id and s.profile_id = :profile_id
            where c.institution_id = :institution_id order by c.due_at desc nulls last, c.created_at desc
            """
        ),
        {"profile_id": user.user_id, "institution_id": institution_id_or_403(user)},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.get("/readiness")
async def readiness(
    cycle_id: UUID | None = Query(default=None),
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    cycle = await (_cycle(session, cycle_id, user) if cycle_id else _open_cycle(session, user))
    sections = await _sections(session, cycle["template_id"])
    activities = await _activities_for_cycle(session, user.user_id, cycle["academic_year"])
    for section in sections:
        section["items"] = [activity for activity in activities if _category_matches(section, str(activity["category"]))]
    readiness_value = compute_appraisal_readiness(sections)
    return {"cycle": cycle, "readiness": readiness_value, "sections": sections, "activity_count": len(activities)}


@router.post("/cycles/{cycle_id}/draft")
async def generate_draft(cycle_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    cycle = await _cycle(session, cycle_id, user)
    existing_result = await session.execute(
        text("select id, status::text as status from public.appraisal_submissions where cycle_id = :cycle_id and profile_id = :profile_id for update"),
        {"cycle_id": cycle_id, "profile_id": user.user_id},
    )
    existing = existing_result.mappings().first()
    if existing and existing["status"] in {"submitted", "under_review", "approved", "rejected"}:
        raise HTTPException(status_code=409, detail=f"A submission is already {existing['status']} and cannot be regenerated")
    if existing:
        submission_id = existing["id"]
        await session.execute(text("delete from public.appraisal_submission_items where submission_id = :id"), {"id": submission_id})
        await session.execute(text("update public.appraisal_submissions set status = 'draft', readiness = 0, updated_at = now() where id = :id"), {"id": submission_id})
    else:
        created = await session.execute(
            text("insert into public.appraisal_submissions(cycle_id, profile_id, status) values (:cycle_id, :profile_id, 'draft') returning id"),
            {"cycle_id": cycle_id, "profile_id": user.user_id},
        )
        submission_id = created.scalar_one()
    sections = await _sections(session, cycle["template_id"])
    activities = await _activities_for_cycle(session, user.user_id, cycle["academic_year"])
    readiness_sections: list[dict[str, Any]] = []
    for section in sections:
        matching = [activity for activity in activities if _category_matches(section, str(activity["category"]))]
        readiness_sections.append({**section, "items": matching})
        for position, activity in enumerate(matching):
            await session.execute(
                text(
                    """
                    insert into public.appraisal_submission_items(submission_id, section_id, activity_id, position)
                    values (:submission_id, :section_id, :activity_id, :position)
                    on conflict (submission_id, section_id, activity_id) do update set position = excluded.position
                    """
                ),
                {"submission_id": submission_id, "section_id": section["id"], "activity_id": activity["id"], "position": position},
            )
    readiness_value = compute_appraisal_readiness(readiness_sections)
    await session.execute(text("update public.appraisal_submissions set readiness = :readiness where id = :id"), {"readiness": readiness_value, "id": submission_id})
    await session.commit()
    return await _submission(session, submission_id, user)


@router.get("/submissions/{submission_id}")
async def get_submission(submission_id: UUID, user: CurrentUser = Depends(get_current_user), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _submission(session, submission_id, user)


@router.patch("/submissions/{submission_id}/items")
async def update_submission_items(
    submission_id: UUID,
    payload: SubmissionItemsPatch,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    submission = await _submission(session, submission_id, user, lock=True)
    if submission["status"] not in {"draft", "returned"}:
        raise HTTPException(status_code=409, detail="Only draft or returned submissions can be edited")
    section_ids = {UUID(str(section["id"])) for section in submission["sections"]}
    await session.execute(text("delete from public.appraisal_submission_items where submission_id = :id"), {"id": submission_id})
    for item in payload.items:
        if item.section_id not in section_ids:
            raise HTTPException(status_code=422, detail="Submission item references an invalid appraisal section")
        if item.activity_id:
            activity = await session.execute(text("select id from public.academic_activities where id = :id and owner_id = :owner_id and status = 'confirmed'"), {"id": item.activity_id, "owner_id": user.user_id})
            if activity.scalar_one_or_none() is None:
                raise HTTPException(status_code=403, detail="Submission items may only reference your confirmed activities")
        await session.execute(
            text("insert into public.appraisal_submission_items(submission_id, section_id, activity_id, free_text, faculty_note, position) values (:submission_id, :section_id, :activity_id, :free_text, :faculty_note, :position)"),
            {"submission_id": submission_id, **item.model_dump()},
        )
    await session.commit()
    return await _submission(session, submission_id, user)


@router.post("/submissions/{submission_id}/submit")
async def submit_submission(submission_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    submission = await _submission(session, submission_id, user, lock=True)
    if not is_valid_submission_transition(str(submission["status"]), "submitted"):
        raise HTTPException(status_code=409, detail=f"Submission cannot be submitted from {submission['status']} state")
    await session.execute(text("update public.appraisal_submissions set status = 'submitted', submitted_at = now(), updated_at = now() where id = :id"), {"id": submission_id})
    admins = await session.execute(text("select id from public.profiles where institution_id = :institution_id and role in ('admin','dept_admin','institution_admin','reviewer')"), {"institution_id": submission["institution_id"]})
    for row in admins.mappings().all():
        await session.execute(text("insert into public.notifications(profile_id, kind, title, body, link_path) values (:profile_id, 'submission_status', 'New appraisal submission', :body, :link_path)"), {"profile_id": row["id"], "body": f"{submission['full_name']} submitted {submission['cycle_name']} for review.", "link_path": "/admin"})
    await session.commit()
    return await _submission(session, submission_id, user)


@router.post("/submissions/{submission_id}/review")
async def review_submission(
    submission_id: UUID,
    payload: SubmissionReviewRequest,
    user: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    submission = await _submission(session, submission_id, user, lock=True)
    current = str(submission["status"])
    action = payload.action.value
    if payload.section_id and payload.section_id not in {UUID(str(section["id"])) for section in submission["sections"]}:
        raise HTTPException(status_code=422, detail="Review comment references an invalid appraisal section")
    target = {"comment": "under_review", "return": "returned", "approve": "approved", "reject": "rejected"}[action]
    if action == "comment" and current in {"under_review", "returned"}:
        target = current
    if not is_valid_submission_transition(current, target) and target != current:
        raise HTTPException(status_code=409, detail=f"Cannot {action} a submission in {current} state")
    if action in {"approve", "reject", "return"} and current not in {"submitted", "under_review"}:
        raise HTTPException(status_code=409, detail=f"Cannot {action} a submission in {current} state")
    await session.execute(text("insert into public.appraisal_reviews(submission_id, reviewer_id, action, section_id, comment) values (:submission_id, :reviewer_id, cast(:action as review_action), :section_id, :comment)"), {"submission_id": submission_id, "reviewer_id": user.user_id, "action": action, "section_id": payload.section_id, "comment": payload.comment})
    if target != current:
        decided = "now()" if target in {"approved", "rejected"} else "null"
        await session.execute(text(f"update public.appraisal_submissions set status = cast(:status as appraisal_submission_status), decided_at = {decided}, updated_at = now() where id = :id"), {"status": target, "id": submission_id})
    title = {"comment": "Appraisal review comment", "return": "Appraisal returned for changes", "approve": "Appraisal approved", "reject": "Appraisal rejected"}[action]
    body = payload.comment or f"Your appraisal is now {target.replace('_', ' ')}."
    await session.execute(text("insert into public.notifications(profile_id, kind, title, body, link_path) values (:profile_id, 'review_comment', :title, :body, :link_path)"), {"profile_id": submission["profile_id"], "title": title, "body": body, "link_path": "/dashboard"})
    await session.commit()
    return await _submission(session, submission_id, user)


def _pdf_bytes(submission: dict[str, Any]) -> bytes:
    buffer = io.BytesIO()
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
    story: list[Any] = [Paragraph("Sanchaya — Faculty Self-Appraisal Report", styles["Title"]), Spacer(1, 5 * mm)]
    details = [
        ["Faculty", str(submission.get("full_name") or "")],
        ["Employee code", str(submission.get("employee_code") or "")],
        ["Designation", str(submission.get("designation") or "")],
        ["Department", str(submission.get("department") or "")],
        ["Academic year", str(submission.get("academic_year") or "")],
        ["Status", str(submission.get("status") or "")],
        ["Readiness", f"{submission.get('readiness') or 0}%"],
        ["Generated", datetime.now(UTC).isoformat()],
    ]
    table = Table(details, colWidths=[40 * mm, 135 * mm])
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), "#FFF4F0"), ("GRID", (0, 0), (-1, -1), 0.25, "#CBD5E1"), ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(table)
    story.append(Spacer(1, 7 * mm))
    for section in submission.get("sections", []):
        story.append(Paragraph(str(section.get("title") or "Section"), styles["Heading2"]))
        rows = [["Activity", "Category", "Date", "Evidence"]]
        for item in section.get("items", []):
            activity = item.get("activity") or {}
            rows.append([str(activity.get("title") or item.get("free_text") or "Contribution"), str(activity.get("category") or ""), str(activity.get("start_date") or ""), str(activity.get("evidence_status") or "")])
        if len(rows) == 1:
            rows.append(["No confirmed activities", "", "", ""])
        table = Table(rows, colWidths=[82 * mm, 28 * mm, 30 * mm, 35 * mm], repeatRows=1)
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), "#F1F5F9"), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.25, "#CBD5E1"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(table)
        story.append(Spacer(1, 4 * mm))
    if submission.get("reviews"):
        story.append(Paragraph("Review history", styles["Heading2"]))
        for review in submission["reviews"]:
            story.append(Paragraph(f"{review.get('action')}: {review.get('comment') or 'No comment'} ({review.get('created_at')})", styles["BodyText"]))
    doc.build(story)
    return buffer.getvalue()


@router.post("/submissions/{submission_id}/pdf")
async def generate_pdf(
    submission_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    submission = await _submission(session, submission_id, user)
    try:
        content = _pdf_bytes(submission)
        path = f"{submission['profile_id']}/{submission_id}/{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}.pdf"
        storage = StorageClient(settings)
        await storage.upload_bytes(settings.supabase_generated_bucket, path, content, content_type="application/pdf")
        await session.execute(text("update public.appraisal_submissions set generated_pdf_path = :path, updated_at = now() where id = :id"), {"path": path, "id": submission_id})
        await session.execute(text("insert into public.generated_documents(owner_id, submission_id, storage_path, file_name) values (:owner_id, :submission_id, :path, :file_name)"), {"owner_id": submission["profile_id"], "submission_id": submission_id, "path": path, "file_name": f"self_appraisal_{submission['academic_year']}.pdf"})
        await session.commit()
        signed_url = await storage.create_signed_download_url(settings.supabase_generated_bucket, path, settings.signed_url_ttl_seconds)
        return {"id": submission_id, "storage_path": path, "download_url": signed_url, "generated_at": datetime.now(UTC)}
    except (StorageError, OSError, ValueError) as exc:
        await session.rollback()
        raise HTTPException(status_code=502, detail=f"PDF generation failed: {exc}") from exc
