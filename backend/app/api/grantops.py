"""GrantOps (product expansion §18-25): the research-funding journey from
opportunity discovery through eligibility, team formation, submission, and
post-award AcademicActivity credit. Reuses the Repository's document
classification for readiness matching and the Professional Network for team
recommendations rather than parallel systems."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_faculty
from ..core.db import get_db
from ..services.grantops import evaluate_eligibility, evaluate_readiness, team_suggestion_reason
from ..services.network import rank_candidates
from .network import PROFILE_COLUMNS
from .schemas import GrantAwardRequest, GrantMemberInvite, GrantOpportunityCreate, GrantStageUpdate, GrantTaskCreate
from .utils import rows_to_dicts

router = APIRouter(prefix="/grantops", tags=["grantops"])

_OPPORTUNITY_COLUMNS = """
    id, title, agency, description, url, deadline, amount, disciplines,
    eligibility_rules, required_documents, source, institution_id, created_by, created_at
"""


@router.get("/opportunities")
async def list_opportunities(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            f"""
            select {_OPPORTUNITY_COLUMNS} from public.grant_opportunities
            where institution_id is null or institution_id = (select institution_id from public.profiles where id = :uid)
            order by deadline nulls last, created_at desc limit 200
            """
        ),
        {"uid": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.post("/opportunities")
async def create_opportunity(
    payload: GrantOpportunityCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            insert into public.grant_opportunities
                (institution_id, created_by, title, agency, description, url, deadline, amount, disciplines, eligibility_rules, required_documents, source)
            values
                ((select institution_id from public.profiles where id = :uid), :uid, :title, :agency, :description, :url, :deadline, :amount,
                 :disciplines, cast(:rules as jsonb), :required_documents, 'manual')
            returning id
            """
        ),
        {
            "uid": user.user_id, "title": payload.title, "agency": payload.agency, "description": payload.description,
            "url": payload.url, "deadline": payload.deadline, "amount": payload.amount, "disciplines": payload.disciplines,
            "rules": json.dumps(payload.eligibility_rules), "required_documents": payload.required_documents,
        },
    )
    opportunity_id = result.scalar_one()
    await session.commit()
    return {"id": opportunity_id}


async def _eligibility_for(session: AsyncSession, user_id: UUID, opportunity: dict[str, Any]) -> dict[str, Any]:
    faculty_result = await session.execute(
        text("select designation, phd_status from public.faculty_profiles where profile_id = :id"), {"id": user_id}
    )
    faculty_row = faculty_result.mappings().first() or {}
    profile_result = await session.execute(text("select research_interests from public.profiles where id = :id"), {"id": user_id})
    profile_row = profile_result.mappings().first() or {}
    counts_result = await session.execute(
        text(
            "select category::text as category, count(*)::int as n from public.academic_activities "
            "where owner_id = :id and status = 'confirmed' and category in ('publication', 'grant') group by category"
        ),
        {"id": user_id},
    )
    counts = {row["category"]: row["n"] for row in counts_result.mappings().all()}
    outcome = evaluate_eligibility(
        rules=opportunity["eligibility_rules"] or {},
        designation=faculty_row.get("designation"),
        phd_status=faculty_row.get("phd_status"),
        publication_count=counts.get("publication", 0),
        grant_count=counts.get("grant", 0),
        disciplines=opportunity.get("disciplines") or [],
        faculty_research_interests=profile_row.get("research_interests") or [],
    )
    return {"status": outcome.status, "reasons": outcome.reasons}


async def _readiness_for(session: AsyncSession, user_id: UUID, required_documents: list[str]) -> dict[str, Any]:
    if not required_documents:
        return {"ready": [], "missing": [], "ready_count": 0, "total": 0}
    docs_result = await session.execute(
        text("select distinct document_type from public.evidence_files where owner_id = :id and document_type is not null"),
        {"id": user_id},
    )
    on_file = [row[0] for row in docs_result.all()]
    outcome = evaluate_readiness(required_documents, on_file)
    return {"ready": outcome.ready, "missing": outcome.missing, "ready_count": outcome.ready_count, "total": outcome.total}


@router.get("/opportunities/{opportunity_id}/eligibility")
async def get_eligibility(opportunity_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    opportunity = await _opportunity_or_404(session, opportunity_id)
    return await _eligibility_for(session, user.user_id, opportunity)


async def _opportunity_or_404(session: AsyncSession, opportunity_id: UUID) -> dict[str, Any]:
    result = await session.execute(text(f"select {_OPPORTUNITY_COLUMNS} from public.grant_opportunities where id = :id"), {"id": opportunity_id})
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grant opportunity not found")
    return dict(row)


@router.get("/workspaces")
async def list_workspaces(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select w.id, w.stage::text as stage, w.notes, w.submitted_at, w.awarded_at, w.award_amount, w.activity_id, w.created_at,
                   o.id as opportunity_id, o.title, o.agency, o.deadline, o.amount
            from public.grant_workspaces w join public.grant_opportunities o on o.id = w.grant_opportunity_id
            where w.owner_id = :uid
            order by o.deadline nulls last, w.created_at desc
            """
        ),
        {"uid": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.post("/opportunities/{opportunity_id}/workspace")
async def start_workspace(opportunity_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    await _opportunity_or_404(session, opportunity_id)
    result = await session.execute(
        text(
            """
            insert into public.grant_workspaces (grant_opportunity_id, owner_id, stage)
            values (:opportunity_id, :owner_id, 'interested')
            on conflict (grant_opportunity_id, owner_id) do update set updated_at = now()
            returning id
            """
        ),
        {"opportunity_id": opportunity_id, "owner_id": user.user_id},
    )
    workspace_id = result.scalar_one()
    await session.commit()
    return {"id": workspace_id}


async def _workspace_or_404(session: AsyncSession, workspace_id: UUID, user_id: UUID) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select w.*, o.title, o.agency, o.description, o.url, o.deadline, o.amount, o.disciplines,
                   o.eligibility_rules, o.required_documents
            from public.grant_workspaces w join public.grant_opportunities o on o.id = w.grant_opportunity_id
            where w.id = :id and (
              w.owner_id = :uid or exists(select 1 from public.grant_workspace_members m where m.workspace_id = w.id and m.profile_id = :uid)
            )
            """
        ),
        {"id": workspace_id, "uid": user_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grant workspace not found")
    return dict(row)


@router.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    workspace = await _workspace_or_404(session, workspace_id, user.user_id)
    eligibility = await _eligibility_for(session, workspace["owner_id"], workspace)
    readiness = await _readiness_for(session, workspace["owner_id"], workspace["required_documents"] or [])

    members_result = await session.execute(
        text(
            """
            select m.id, m.profile_id, m.role, m.status, p.full_name, p.photo_url
            from public.grant_workspace_members m join public.profiles p on p.id = m.profile_id
            where m.workspace_id = :id order by m.created_at
            """
        ),
        {"id": workspace_id},
    )
    tasks_result = await session.execute(
        text("select id, title, done, due_date, created_at from public.grant_workspace_tasks where workspace_id = :id order by due_date nulls last, created_at"),
        {"id": workspace_id},
    )
    emails_result = await session.execute(
        text(
            "select id, subject, sender, summary, deadline, urgency::text as urgency from public.action_inbox_items "
            "where related_grant_workspace_id = :id order by created_at desc"
        ),
        {"id": workspace_id},
    )

    workspace_out = {
        "id": workspace["id"], "stage": workspace["stage"], "notes": workspace["notes"],
        "submitted_at": workspace["submitted_at"], "awarded_at": workspace["awarded_at"],
        "award_amount": workspace["award_amount"], "activity_id": workspace["activity_id"],
        "owner_id": workspace["owner_id"], "opportunity": {
            "id": workspace["grant_opportunity_id"], "title": workspace["title"], "agency": workspace["agency"],
            "description": workspace["description"], "url": workspace["url"], "deadline": workspace["deadline"],
            "amount": workspace["amount"], "disciplines": workspace["disciplines"], "required_documents": workspace["required_documents"],
        },
        "eligibility": eligibility, "readiness": readiness,
        "members": rows_to_dicts(members_result.mappings().all()),
        "tasks": rows_to_dicts(tasks_result.mappings().all()),
        "related_emails": rows_to_dicts(emails_result.mappings().all()),
    }
    return workspace_out


@router.patch("/workspaces/{workspace_id}")
async def update_workspace_stage(
    workspace_id: UUID, payload: GrantStageUpdate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    owned = await session.execute(text("select owner_id from public.grant_workspaces where id = :id"), {"id": workspace_id})
    row = owned.mappings().first()
    if row is None or row["owner_id"] != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grant workspace not found")
    submitted_at_clause = ", submitted_at = case when :stage = 'submitted' and submitted_at is null then now() else submitted_at end"
    await session.execute(
        text(
            f"update public.grant_workspaces set stage = cast(:stage as grant_stage), notes = coalesce(:notes, notes), updated_at = now(){submitted_at_clause} where id = :id"
        ),
        {"stage": payload.stage, "notes": payload.notes, "id": workspace_id},
    )
    await session.commit()
    return {"id": workspace_id, "stage": payload.stage}


@router.post("/workspaces/{workspace_id}/tasks")
async def add_task(workspace_id: UUID, payload: GrantTaskCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    await _workspace_or_404(session, workspace_id, user.user_id)
    result = await session.execute(
        text("insert into public.grant_workspace_tasks (workspace_id, title, due_date) values (:workspace_id, :title, :due_date) returning id"),
        {"workspace_id": workspace_id, "title": payload.title, "due_date": payload.due_date},
    )
    task_id = result.scalar_one()
    await session.commit()
    return {"id": task_id}


@router.post("/tasks/{task_id}/toggle")
async def toggle_task(task_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            update public.grant_workspace_tasks t set done = not t.done
            from public.grant_workspaces w
            where t.id = :id and t.workspace_id = w.id and w.owner_id = :uid
            returning t.id, t.done
            """
        ),
        {"id": task_id, "uid": user.user_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    await session.commit()
    return dict(row)


@router.get("/workspaces/{workspace_id}/team-suggestions")
async def team_suggestions(workspace_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Recommends collaborators for team formation (§23) via the same
    explainable network scoring as Professional Network recommendations,
    with an added reason when the candidate's expertise matches this grant's
    discipline list."""

    workspace = await _workspace_or_404(session, workspace_id, user.user_id)
    seeker_result = await session.execute(text("select research_interests, expertise, department_id from public.profiles where id = :id"), {"id": user.user_id})
    seeker = dict(seeker_result.mappings().first() or {})
    candidates_result = await session.execute(
        text(
            f"""
            select {PROFILE_COLUMNS}
            from public.profiles p
            left join public.institutions i on i.id = p.institution_id
            left join public.departments d on d.id = p.department_id
            left join public.faculty_profiles fp on fp.profile_id = p.id
            where p.id <> :uid and p.role = 'faculty' and p.open_to_collaboration = true
            limit 200
            """
        ),
        {"uid": user.user_id},
    )
    candidates = rows_to_dicts(candidates_result.mappings().all())
    ranked = rank_candidates(seeker, candidates, "collaborator")
    by_id = {str(c["id"]): c for c in candidates}
    disciplines = {d.lower() for d in (workspace.get("disciplines") or [])}
    items = []
    for entry in ranked[:10]:
        profile = by_id.get(str(entry["profile_id"]))
        if not profile:
            continue
        shared = sorted(disciplines & {e.lower() for e in (profile.get("expertise") or [])})
        items.append({**profile, "reasons": team_suggestion_reason(entry["reasons"], shared)})
    return {"items": items}


@router.post("/workspaces/{workspace_id}/members")
async def invite_member(
    workspace_id: UUID, payload: GrantMemberInvite, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    owned = await session.execute(text("select owner_id from public.grant_workspaces where id = :id"), {"id": workspace_id})
    row = owned.mappings().first()
    if row is None or row["owner_id"] != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grant workspace not found")
    result = await session.execute(
        text(
            """
            insert into public.grant_workspace_members (workspace_id, profile_id, role, invited_by)
            values (:workspace_id, :profile_id, :role, :invited_by)
            on conflict (workspace_id, profile_id) do nothing
            returning id
            """
        ),
        {"workspace_id": workspace_id, "profile_id": payload.profile_id, "role": payload.role, "invited_by": user.user_id},
    )
    member_id = result.scalar_one_or_none()
    if member_id is not None:
        await session.execute(
            text(
                "insert into public.notifications (profile_id, kind, title, body, link_path) "
                "values (:profile_id, 'grant_invite', 'Invited to a grant workspace', :body, '/faculty/grantops')"
            ),
            {"profile_id": payload.profile_id, "body": f"You were invited to collaborate on a grant application{f' as {payload.role}' if payload.role else ''}."},
        )
    await session.commit()
    return {"id": member_id}


@router.post("/workspaces/{workspace_id}/award")
async def award_workspace(
    workspace_id: UUID, payload: GrantAwardRequest, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """Marks a grant awarded and proposes (never silently credits, §25) an
    AcademicActivity(category=grant). The faculty confirms it via the
    existing generic POST /activities/{id}/confirm, same as every other
    proposal in the product."""

    workspace = await _workspace_or_404(session, workspace_id, user.user_id)
    if workspace["owner_id"] != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the workspace owner can record an award")
    if workspace["activity_id"] is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This grant already has a proposed/confirmed activity")

    members_result = await session.execute(
        text("select p.full_name from public.grant_workspace_members m join public.profiles p on p.id = m.profile_id where m.workspace_id = :id and m.status = 'accepted'"),
        {"id": workspace_id},
    )
    co_investigators = [row[0] for row in members_result.all()]
    activity_result = await session.execute(
        text(
            """
            insert into public.academic_activities (owner_id, category, title, organization, description, academic_year, metadata, status, source, confidence)
            values (:owner_id, 'grant', :title, :agency, :description, :academic_year, cast(:metadata as jsonb), 'proposed', 'grantops', 0.95)
            returning id
            """
        ),
        {
            "owner_id": user.user_id, "title": f"Grant awarded: {workspace['title']}", "agency": workspace["agency"],
            "description": f"Awarded {payload.award_amount or workspace.get('amount') or ''}".strip(),
            "academic_year": _current_academic_year(),
            "metadata": json.dumps({"grant_workspace_id": str(workspace_id), "co_investigators": co_investigators}),
        },
    )
    activity_id = activity_result.scalar_one()
    await session.execute(
        text(
            "update public.grant_workspaces set stage = 'awarded', awarded_at = now(), award_amount = :amount, activity_id = :activity_id, updated_at = now() where id = :id"
        ),
        {"amount": payload.award_amount, "activity_id": activity_id, "id": workspace_id},
    )
    await session.commit()
    return {"activity_id": activity_id, "stage": "awarded"}


def _current_academic_year() -> str:
    from ..core.academic_year import derive_academic_year
    from datetime import UTC, datetime

    return derive_academic_year(datetime.now(UTC).date())
