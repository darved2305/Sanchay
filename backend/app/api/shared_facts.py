"""USP 5 — Shared Academic Facts: one institutional event, entered once, fans
out an individual confirmable proposal to every affected faculty member.

An admin creates one ``institution_events`` row with a participant roster.
Fanout immediately writes one ``proposed`` ``academic_activities`` row per
participant (never auto-confirmed) plus a realtime notification. Faculty
confirm or decline from their own side; nothing here bypasses the same
confirm/decline discipline every other USP proposal uses.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_admin, require_faculty
from ..core.db import get_db
from .schemas import InstitutionEventCreate
from .utils import institution_id_or_403, rows_to_dicts

admin_router = APIRouter(prefix="/admin/events", tags=["shared-facts"])
faculty_router = APIRouter(prefix="/activities/proposals/events", tags=["shared-facts"])


@admin_router.post("")
async def create_institution_event(
    payload: InstitutionEventCreate,
    user: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    institution_id = institution_id_or_403(user)
    roster = await session.execute(
        text("select id from public.profiles where institution_id = :institution_id and id = any(cast(:ids as uuid[])) and role = 'faculty'"),
        {"institution_id": institution_id, "ids": [str(p.profile_id) for p in payload.participants]},
    )
    valid_ids = {row[0] for row in roster.all()}
    if len(valid_ids) != len(payload.participants):
        raise HTTPException(status_code=422, detail="One or more participants are not faculty in this institution")

    event_result = await session.execute(
        text(
            """
            insert into public.institution_events (institution_id, created_by, category, title, organization, description, start_date, end_date)
            values (:institution_id, :created_by, cast(:category as activity_category), :title, :organization, :description, :start_date, :end_date)
            returning id
            """
        ),
        {
            "institution_id": institution_id,
            "created_by": user.user_id,
            "category": payload.category.value,
            "title": payload.title,
            "organization": payload.organization,
            "description": payload.description,
            "start_date": payload.start_date,
            "end_date": payload.end_date,
        },
    )
    event_id = event_result.scalar_one()

    academic_year_source = payload.start_date or payload.end_date
    for participant in payload.participants:
        from ..core.academic_year import derive_academic_year

        academic_year = derive_academic_year(academic_year_source) if academic_year_source else "unspecified"
        activity_result = await session.execute(
            text(
                """
                insert into public.academic_activities (
                  owner_id, category, title, organization, role, start_date, end_date, academic_year,
                  metadata, status, source, confidence
                ) values (
                  :owner_id, cast(:category as activity_category), :title, :organization, :role,
                  :start_date, :end_date, :academic_year, cast(:metadata as jsonb), 'proposed', 'shared_fact', 0.9
                ) returning id
                """
            ),
            {
                "owner_id": participant.profile_id,
                "category": payload.category.value,
                "title": payload.title,
                "organization": payload.organization,
                "role": participant.role,
                "start_date": payload.start_date,
                "end_date": payload.end_date,
                "academic_year": academic_year,
                "metadata": json.dumps({"institution_event_id": str(event_id)}),
            },
        )
        activity_id = activity_result.scalar_one()
        participant_result = await session.execute(
            text(
                """
                insert into public.event_participants (event_id, profile_id, role, proposal_activity_id)
                values (:event_id, :profile_id, :role, :activity_id)
                returning id
                """
            ),
            {"event_id": event_id, "profile_id": participant.profile_id, "role": participant.role, "activity_id": activity_id},
        )
        participant_id = participant_result.scalar_one()
        await session.execute(
            text(
                "insert into public.notifications (profile_id, kind, title, body, link_path) "
                "values (:profile_id, 'shared_fact', :title, :body, '/faculty/record')"
            ),
            {
                "profile_id": participant.profile_id,
                "title": f"You were added to {payload.title}",
                "body": f"Confirm your role ({participant.role}) in {payload.title} to add it to your record.",
            },
        )
        _ = participant_id
    await session.commit()
    return await _event_detail(session, event_id, institution_id)


async def _event_detail(session: AsyncSession, event_id: UUID, institution_id: UUID) -> dict[str, Any]:
    event_result = await session.execute(
        text(
            "select id, category::text as category, title, organization, description, start_date, end_date, created_at "
            "from public.institution_events where id = :id and institution_id = :institution_id"
        ),
        {"id": event_id, "institution_id": institution_id},
    )
    event = event_result.mappings().first()
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Institution event not found")
    participants_result = await session.execute(
        text(
            """
            select ep.id, ep.profile_id, ep.role, ep.status::text as status, ep.responded_at, p.full_name, p.email
            from public.event_participants ep join public.profiles p on p.id = ep.profile_id
            where ep.event_id = :event_id order by p.full_name
            """
        ),
        {"event_id": event_id},
    )
    participants = rows_to_dicts(participants_result.mappings().all())
    payload = dict(event)
    payload["participants"] = participants
    payload["confirmed_count"] = sum(1 for p in participants if p["status"] == "confirmed")
    payload["pending_count"] = sum(1 for p in participants if p["status"] == "pending")
    payload["declined_count"] = sum(1 for p in participants if p["status"] == "declined")
    return payload


@admin_router.get("")
async def list_institution_events(user: CurrentUser = Depends(require_admin), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    institution_id = institution_id_or_403(user)
    result = await session.execute(
        text(
            """
            select e.id, e.category::text as category, e.title, e.organization, e.start_date, e.end_date, e.created_at,
                   count(ep.id)::int as participant_count,
                   count(*) filter (where ep.status = 'confirmed')::int as confirmed_count,
                   count(*) filter (where ep.status = 'pending')::int as pending_count,
                   count(*) filter (where ep.status = 'declined')::int as declined_count
            from public.institution_events e
            left join public.event_participants ep on ep.event_id = e.id
            where e.institution_id = :institution_id
            group by e.id
            order by e.created_at desc
            """
        ),
        {"institution_id": institution_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@admin_router.get("/{event_id}/participants")
async def get_event_participants(event_id: UUID, user: CurrentUser = Depends(require_admin), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await _event_detail(session, event_id, institution_id_or_403(user))


@faculty_router.get("")
async def list_event_proposals(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select ep.id as participant_id, ep.role, ep.status::text as status, ep.proposal_activity_id,
                   e.title as event_title, e.organization, e.category::text as category, e.start_date, e.end_date,
                   a.title as activity_title, a.status::text as activity_status
            from public.event_participants ep
            join public.institution_events e on e.id = ep.event_id
            left join public.academic_activities a on a.id = ep.proposal_activity_id
            where ep.profile_id = :profile_id and ep.status = 'pending'
            order by ep.created_at desc
            """
        ),
        {"profile_id": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


async def _participant_or_404(session: AsyncSession, participant_id: UUID, profile_id: UUID) -> dict[str, Any]:
    result = await session.execute(
        text("select id, profile_id, proposal_activity_id, status::text as status from public.event_participants where id = :id and profile_id = :profile_id"),
        {"id": participant_id, "profile_id": profile_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event proposal not found")
    return dict(row)


@faculty_router.post("/{participant_id}/confirm")
async def confirm_event_proposal(participant_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    participant = await _participant_or_404(session, participant_id, user.user_id)
    if participant["status"] != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Proposal is already {participant['status']}")
    await session.execute(
        text("update public.academic_activities set status = 'confirmed', confirmed_at = now(), updated_at = now() where id = :id and owner_id = :owner_id"),
        {"id": participant["proposal_activity_id"], "owner_id": user.user_id},
    )
    await session.execute(
        text("update public.event_participants set status = 'confirmed', responded_at = now() where id = :id"),
        {"id": participant_id},
    )
    await session.commit()
    return {"ok": True}


@faculty_router.post("/{participant_id}/decline")
async def decline_event_proposal(participant_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    participant = await _participant_or_404(session, participant_id, user.user_id)
    if participant["status"] != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Proposal is already {participant['status']}")
    await session.execute(
        text("update public.academic_activities set status = 'archived', archived_at = now(), updated_at = now() where id = :id and owner_id = :owner_id"),
        {"id": participant["proposal_activity_id"], "owner_id": user.user_id},
    )
    await session.execute(
        text("update public.event_participants set status = 'declined', responded_at = now() where id = :id"),
        {"id": participant_id},
    )
    await session.commit()
    return {"ok": True}
