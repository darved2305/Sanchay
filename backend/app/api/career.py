"""USP 8 — Promotion Dossier + Next Best Academic Move."""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_admin, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..core.storage import StorageClient, StorageError
from ..services.career import evaluate_career_rules, match_opportunities
from ..services.sql import mapping_or_404
from .schemas import CareerGoalSetRequest, CareerRuleCreate
from .utils import institution_id_or_403, rows_to_dicts

router = APIRouter(prefix="/career", tags=["career"])
opportunities_router = APIRouter(prefix="/opportunities", tags=["career"])


@opportunities_router.get("")
async def list_opportunities(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            "select id, kind, title, description, tags, deadline, url from public.opportunities "
            "where institution_id = :institution_id or institution_id is null order by deadline nulls last"
        ),
        {"institution_id": institution_id_or_403(user)},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


async def _confirmed_activities(session: AsyncSession, owner_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            "select id, category::text as category, evidence_status::text as evidence_status "
            "from public.academic_activities where owner_id = :owner_id and status = 'confirmed'"
        ),
        {"owner_id": owner_id},
    )
    return [dict(row) for row in result.mappings().all()]


async def _active_goal(session: AsyncSession, profile_id: UUID) -> dict[str, Any] | None:
    result = await session.execute(
        text(
            """
            select g.id as goal_id, r.id as career_rule_id, r.goal_key, r.goal_label, r.description, r.rules
            from public.career_goals g
            join public.career_rules r on r.id = g.career_rule_id
            where g.profile_id = :profile_id and g.is_active = true
            order by g.set_at desc limit 1
            """
        ),
        {"profile_id": profile_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


@router.get("/rules")
async def list_career_rules(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text("select id, goal_key, goal_label, description, rules from public.career_rules where institution_id = :institution_id order by goal_label"),
        {"institution_id": institution_id_or_403(user)},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.get("/goals")
async def get_active_goal(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    goal = await _active_goal(session, user.user_id)
    return {"active_goal": goal}


@router.post("/goals")
async def set_career_goal(
    payload: CareerGoalSetRequest,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    owned = await session.execute(
        text("select id from public.career_rules where id = :id and institution_id = :institution_id"),
        {"id": payload.career_rule_id, "institution_id": institution_id_or_403(user)},
    )
    if owned.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Career rule not found")
    await session.execute(
        text("update public.career_goals set is_active = false where profile_id = :profile_id"),
        {"profile_id": user.user_id},
    )
    await session.execute(
        text(
            """
            insert into public.career_goals (profile_id, career_rule_id, is_active)
            values (:profile_id, :career_rule_id, true)
            on conflict (profile_id, career_rule_id) do update set is_active = true, set_at = now()
            """
        ),
        {"profile_id": user.user_id, "career_rule_id": payload.career_rule_id},
    )
    await session.commit()
    return {"active_goal": await _active_goal(session, user.user_id)}


async def _progress(session: AsyncSession, user: CurrentUser) -> dict[str, Any]:
    goal = await _active_goal(session, user.user_id)
    if goal is None:
        return {"active_goal": None, "progress": None}
    activities = await _confirmed_activities(session, user.user_id)
    progress = evaluate_career_rules(goal["rules"], activities)
    return {"active_goal": goal, "progress": progress}


@router.get("/progress")
async def career_progress(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _progress(session, user)


@router.get("/recommendations")
async def career_recommendations(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    goal = await _active_goal(session, user.user_id)
    if goal is None:
        return {"items": []}
    activities = await _confirmed_activities(session, user.user_id)
    progress = evaluate_career_rules(goal["rules"], activities)
    opportunities_result = await session.execute(
        text(
            "select id, kind, title, description, tags, deadline, url from public.opportunities "
            "where institution_id = :institution_id or institution_id is null order by deadline nulls last"
        ),
        {"institution_id": institution_id_or_403(user)},
    )
    opportunities = rows_to_dicts(opportunities_result.mappings().all())
    matches = match_opportunities(progress["rules"], opportunities)
    opportunity_by_id = {str(item["id"]): item for item in opportunities}
    items: list[dict[str, Any]] = []
    for match in matches:
        opportunity_id = match["opportunity_id"]
        insert_result = await session.execute(
            text(
                """
                insert into public.career_recommendations (profile_id, opportunity_id, reason, gap_key)
                values (:profile_id, :opportunity_id, :reason, :gap_key)
                on conflict (profile_id, opportunity_id) do update set reason = excluded.reason, gap_key = excluded.gap_key
                returning id, dismissed
                """
            ),
            {"profile_id": user.user_id, "opportunity_id": opportunity_id, "reason": match["reason"], "gap_key": match["gap_key"]},
        )
        row = insert_result.mappings().first()
        if row and not row["dismissed"]:
            items.append({
                "id": row["id"],
                "reason": match["reason"],
                "gap_key": match["gap_key"],
                "opportunity": opportunity_by_id.get(str(opportunity_id)),
            })
    await session.commit()
    return {"items": items}


@router.post("/recommendations/{recommendation_id}/dismiss")
async def dismiss_recommendation(
    recommendation_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    result = await session.execute(
        text("update public.career_recommendations set dismissed = true where id = :id and profile_id = :profile_id"),
        {"id": recommendation_id, "profile_id": user.user_id},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recommendation not found")
    await session.commit()
    return {"ok": True}


def _dossier_pdf_bytes(profile_name: str, goal_label: str, progress: dict[str, Any], activities: list[dict[str, Any]]) -> bytes:
    buffer = io.BytesIO()
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
    story: list[Any] = [
        Paragraph("Sanchaya — Promotion Dossier", styles["Title"]),
        Paragraph(f"{profile_name} — {goal_label}", styles["Heading3"]),
        Spacer(1, 5 * mm),
    ]
    rule_rows = [["Criterion", "Progress", "Status"]]
    for rule in progress["rules"]:
        rule_rows.append([rule["label"], f"{rule['count']} / {rule['threshold']}", "Met" if rule["satisfied"] else f"Needs {rule['gap']} more"])
    rule_rows.append(["Evidence completeness", f"{progress['evidence_completeness']}%", ""])
    table = Table(rule_rows, colWidths=[80 * mm, 45 * mm, 45 * mm], repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), "#F1F5F9"), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.25, "#CBD5E1")]))
    story.append(table)
    story.append(Spacer(1, 7 * mm))
    story.append(Paragraph("Supporting activities", styles["Heading2"]))
    activity_rows = [["Title", "Category", "Evidence"]]
    for activity in activities:
        activity_rows.append([str(activity.get("title") or ""), str(activity.get("category") or ""), str(activity.get("evidence_status") or "")])
    if len(activity_rows) == 1:
        activity_rows.append(["No confirmed activities yet", "", ""])
    table = Table(activity_rows, colWidths=[95 * mm, 40 * mm, 35 * mm], repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), "#F1F5F9"), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.25, "#CBD5E1")]))
    story.append(table)
    doc.build(story)
    return buffer.getvalue()


@router.post("/dossier")
async def generate_dossier(
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    goal = await _active_goal(session, user.user_id)
    if goal is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Set a career goal before generating a dossier")
    activities_result = await session.execute(
        text(
            "select id, category::text as category, title, evidence_status::text as evidence_status "
            "from public.academic_activities where owner_id = :owner_id and status = 'confirmed' order by created_at desc"
        ),
        {"owner_id": user.user_id},
    )
    activities = rows_to_dicts(activities_result.mappings().all())
    progress = evaluate_career_rules(goal["rules"], activities)
    profile_result = await session.execute(text("select full_name from public.profiles where id = :id"), {"id": user.user_id})
    profile_name = profile_result.scalar_one_or_none() or "Faculty member"
    try:
        content = _dossier_pdf_bytes(profile_name, goal["goal_label"], progress, activities)
        path = f"{user.user_id}/dossiers/{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}.pdf"
        storage = StorageClient(settings)
        await storage.upload_bytes(settings.supabase_generated_bucket, path, content, content_type="application/pdf")
        await session.execute(
            text(
                "insert into public.promotion_dossiers (profile_id, career_rule_id, snapshot, storage_path) "
                "values (:profile_id, :career_rule_id, cast(:snapshot as jsonb), :storage_path)"
            ),
            {"profile_id": user.user_id, "career_rule_id": goal["career_rule_id"], "snapshot": json.dumps(progress), "storage_path": path},
        )
        await session.execute(
            text("insert into public.generated_documents(owner_id, storage_path, file_name) values (:owner_id, :storage_path, :file_name)"),
            {"owner_id": user.user_id, "storage_path": path, "file_name": f"promotion_dossier_{goal['goal_key']}.pdf"},
        )
        await session.commit()
        signed_url = await storage.create_signed_download_url(settings.supabase_generated_bucket, path, settings.signed_url_ttl_seconds)
        return {"storage_path": path, "download_url": signed_url, "progress": progress}
    except (StorageError, OSError, ValueError) as exc:
        await session.rollback()
        raise HTTPException(status_code=502, detail=f"Dossier generation failed: {exc}") from exc


admin_router = APIRouter(prefix="/admin/career-rules", tags=["career"])


@admin_router.get("")
async def admin_list_career_rules(user: CurrentUser = Depends(require_admin), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text("select id, goal_key, goal_label, description, rules from public.career_rules where institution_id = :institution_id order by goal_label"),
        {"institution_id": institution_id_or_403(user)},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@admin_router.post("")
async def admin_create_career_rule(
    payload: CareerRuleCreate,
    user: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            insert into public.career_rules (institution_id, goal_key, goal_label, description, rules)
            values (:institution_id, :goal_key, :goal_label, :description, cast(:rules as jsonb))
            on conflict (institution_id, goal_key) do update set goal_label = excluded.goal_label, description = excluded.description, rules = excluded.rules
            returning id, goal_key, goal_label, description, rules
            """
        ),
        {
            "institution_id": institution_id_or_403(user),
            "goal_key": payload.goal_key,
            "goal_label": payload.goal_label,
            "description": payload.description,
            "rules": json.dumps(payload.rules),
        },
    )
    row = mapping_or_404(result, "Could not create career rule")
    await session.commit()
    return row
