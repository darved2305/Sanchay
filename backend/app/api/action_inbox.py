"""Faculty Action Inbox (product expansion §3-7): find actionable academic
opportunities hidden in Gmail and turn them into structured, manageable work.
Not Gmail-in-the-app -- classification runs over the shared source_signals
layer (010_signal_layer.sql), and mail is never sent without an explicit
faculty action (§6)."""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..connectors.google import create_gmail_draft, decrypt_token, fetch_gmail_message_full
from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import database, get_db
from ..services.action_inbox import (
    compute_priority,
    draft_replies,
    extract_inbox_item,
    is_actionable_candidate,
    polish_reply,
)
from ..services.jobs import create_job, get_job, update_job
from ..services.llm import LLMProvider
from ..services.signals import mark_classified, unprocessed_signals
from ..services.source_sync import sync_gmail_signals
from .schemas import ActionInboxDraftRequest, ActionInboxStatusUpdate
from .utils import rows_to_dicts

router = APIRouter(prefix="/action-inbox", tags=["action-inbox"])
logger = logging.getLogger(__name__)


@router.get("")
async def list_inbox_items(
    status_filter: str | None = Query(default=None, alias="status"),
    category: str | None = None,
    urgency: str | None = None,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clauses = ["profile_id = :profile_id"]
    params: dict[str, Any] = {"profile_id": user.user_id}
    if status_filter:
        clauses.append("status = cast(:status as inbox_item_status)")
        params["status"] = status_filter
    else:
        # Default view excludes ignored/actioned items -- an inbox, not an archive.
        clauses.append("status = 'new'")
    if category:
        clauses.append("category = cast(:category as inbox_category)")
        params["category"] = category
    if urgency:
        clauses.append("urgency = cast(:urgency as inbox_urgency)")
        params["urgency"] = urgency
    result = await session.execute(
        text(
            f"""
            select id, category::text as category, subject, sender, organization, summary,
                   requested_action, deadline, meeting_date, related_people, related_documents,
                   research_topics, urgency::text as urgency, relevance_reasons, confidence,
                   status::text as status, gmail_draft_id, created_at
            from public.action_inbox_items
            where {' and '.join(clauses)}
            order by
                case urgency when 'high' then 0 when 'medium' then 1 else 2 end,
                deadline nulls last, created_at desc
            limit 200
            """
        ),
        params,
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.get("/{item_id}")
async def get_inbox_item(item_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select id, category::text as category, subject, sender, organization, summary,
                   requested_action, deadline, meeting_date, related_people, related_documents,
                   research_topics, urgency::text as urgency, relevance_reasons, confidence,
                   status::text as status, generated_replies, gmail_message_id, gmail_draft_id, created_at
            from public.action_inbox_items where id = :id and profile_id = :profile_id
            """
        ),
        {"id": item_id, "profile_id": user.user_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inbox item not found")
    return dict(row)


_STATUS_MAP = {
    "save": "saved", "accept": "accepted", "decline": "declined",
    "sent_to_grantops": "sent_to_grantops", "start_collaboration": "collaboration_started", "ignore": "ignored",
}


@router.post("/{item_id}/action")
async def act_on_inbox_item(
    item_id: UUID, payload: ActionInboxStatusUpdate,
    user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    new_status = _STATUS_MAP[payload.action]
    item_result = await session.execute(
        text(
            "select subject, organization, summary, requested_action, deadline, related_documents, category::text as category "
            "from public.action_inbox_items where id = :id and profile_id = :profile_id"
        ),
        {"id": item_id, "profile_id": user.user_id},
    )
    item = item_result.mappings().first()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inbox item not found")

    workspace_id = None
    if payload.action == "sent_to_grantops":
        # §7/§19: routes a detected funding email into GrantOps as a real
        # opportunity + workspace, not just a status flip -- so "Send to
        # GrantOps" actually lands somewhere.
        workspace_id = await _create_grantops_workspace_from_item(session, user.user_id, item)

    await session.execute(
        text(
            "update public.action_inbox_items set status = cast(:status as inbox_item_status), "
            "related_grant_workspace_id = coalesce(:workspace_id, related_grant_workspace_id), updated_at = now() "
            "where id = :id and profile_id = :profile_id"
        ),
        {"status": new_status, "workspace_id": workspace_id, "id": item_id, "profile_id": user.user_id},
    )
    await session.commit()
    return {"id": item_id, "status": new_status, "grant_workspace_id": workspace_id}


async def _create_grantops_workspace_from_item(session: AsyncSession, profile_id: UUID, item: Any) -> UUID:
    opportunity_result = await session.execute(
        text(
            """
            insert into public.grant_opportunities (institution_id, created_by, title, agency, description, deadline, source)
            values ((select institution_id from public.profiles where id = :uid), :uid, :title, :agency, :description, :deadline, 'action_inbox')
            returning id
            """
        ),
        {
            "uid": profile_id, "title": item["subject"] or "Grant opportunity", "agency": item["organization"],
            "description": item["summary"] or item["requested_action"], "deadline": item["deadline"],
        },
    )
    opportunity_id = opportunity_result.scalar_one()
    workspace_result = await session.execute(
        text(
            """
            insert into public.grant_workspaces (grant_opportunity_id, owner_id, stage)
            values (:opportunity_id, :uid, 'discovered')
            on conflict (grant_opportunity_id, owner_id) do update set updated_at = now()
            returning id
            """
        ),
        {"opportunity_id": opportunity_id, "uid": profile_id},
    )
    return workspace_result.scalar_one()


@router.post("/{item_id}/draft")
async def draft_or_polish_reply(
    item_id: UUID, payload: ActionInboxDraftRequest,
    user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Returns reply text for faculty review/edit (§5-6). Never sends. If a
    connected gmail_compose OAuth grant exists, also creates a real Gmail
    draft (not sent); otherwise the caller falls back to copy-to-clipboard /
    in-app editing, which is always available regardless of Gmail permissions."""

    result = await session.execute(
        text("select subject, sender, requested_action, generated_replies from public.action_inbox_items where id = :id and profile_id = :profile_id"),
        {"id": item_id, "profile_id": user.user_id},
    )
    item = result.mappings().first()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inbox item not found")

    if payload.edited_text is not None:
        text_body = payload.edited_text
    else:
        cached = (item["generated_replies"] or {}).get(payload.reply_type)
        if cached is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No generated reply available; run a sync first")
        text_body = cached
        if payload.polish:
            llm = LLMProvider(settings)
            text_body = await polish_reply(text_body, llm)

    draft_id = None
    connection = await session.execute(
        text("select encrypted_access_token from public.oauth_connections where profile_id = :profile_id and provider = 'gmail_compose' and status = 'connected'"),
        {"profile_id": user.user_id},
    )
    connection_row = connection.mappings().first()
    fallback_reason = None
    if connection_row and connection_row["encrypted_access_token"]:
        access_token = decrypt_token(settings, connection_row["encrypted_access_token"])
        if access_token and item["sender"]:
            try:
                draft = await create_gmail_draft(access_token, settings, to=item["sender"], subject=f"Re: {item['subject']}", body_text=text_body)
                draft_id = draft.get("id")
                await session.execute(
                    text("update public.action_inbox_items set gmail_draft_id = :draft_id, updated_at = now() where id = :id"),
                    {"draft_id": draft_id, "id": item_id},
                )
                await session.commit()
            except Exception as exc:  # noqa: BLE001 - a failed draft creation must still return the text for the fallback path
                logger.warning("gmail_draft_create_failed", extra={"error": str(exc)})
                fallback_reason = "Gmail draft creation failed; use copy-to-clipboard."
        else:
            fallback_reason = "No sender email on this item; use copy-to-clipboard."
    else:
        fallback_reason = "Gmail compose permission not connected; use copy-to-clipboard or edit in-app."

    return {"text": text_body, "gmail_draft_id": draft_id, "fallback_reason": fallback_reason}


@router.post("/sync")
async def start_inbox_sync(
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    job_id = await create_job(session, owner_id=user.user_id, kind="action_inbox_sync")
    background_tasks.add_task(_run_inbox_sync, job_id, user.user_id, settings)
    return {"job_id": job_id, "status": "queued"}


@router.get("/sync/{job_id}")
async def get_inbox_sync_job(job_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    job = await get_job(session, job_id, user.user_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


async def _run_inbox_sync(job_id: UUID, profile_id: UUID, settings: Settings) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        await update_job(session, job_id, status="running", progress=5, progress_label="Checking Gmail connection…")
        connection = await session.execute(
            text("select encrypted_access_token from public.oauth_connections where profile_id = :profile_id and provider = 'gmail' and status = 'connected'"),
            {"profile_id": profile_id},
        )
        connection_row = connection.mappings().first()
        if not connection_row or not connection_row["encrypted_access_token"]:
            await update_job(session, job_id, status="failed", error="Gmail is not connected. Connect it from Reconstruct My Year first.")
            return
        access_token = decrypt_token(settings, connection_row["encrypted_access_token"])
        if not access_token:
            await update_job(session, job_id, status="failed", error="Gmail token could not be decrypted; reconnect Gmail.")
            return

        await update_job(session, job_id, progress=20, progress_label="Syncing mailbox (incremental)…")
        summary = await sync_gmail_signals(session, profile_id=profile_id, access_token=access_token, settings=settings)
        await session.commit()
        logger.info("action_inbox_sync: profile=%s mode=%s fetched=%d changed=%d", profile_id, summary.mode, summary.fetched, summary.new_or_changed)

        await update_job(session, job_id, progress=45, progress_label="Finding actionable mail…")
        pending = await unprocessed_signals(session, profile_id=profile_id, source="gmail")

        # Deterministic-first prefilter (product expansion §54): only signals
        # that pass a cheap keyword check reach the LLM/full-body-fetch step.
        candidates = [s for s in pending if is_actionable_candidate(s["title"], s["snippet"])]
        skipped = [s for s in pending if s not in candidates]
        for signal in skipped:
            await mark_classified(session, signal["id"], classification={"category": "ignore_non_actionable"}, entities={})

        llm = LLMProvider(settings)
        profile_result = await session.execute(text("select full_name, research_interests from public.profiles where id = :id"), {"id": profile_id})
        profile_row = profile_result.mappings().first()
        faculty_name = profile_row["full_name"] if profile_row else "Faculty"
        research_interests = {v.lower() for v in (profile_row["research_interests"] or [])} if profile_row else set()

        connections_result = await session.execute(
            text("select p.full_name from public.connections c join public.profiles p on p.id = (case when c.profile_id_a = :id then c.profile_id_b else c.profile_id_a end) where c.profile_id_a = :id or c.profile_id_b = :id"),
            {"id": profile_id},
        )
        known_names = {row[0].lower() for row in connections_result.all() if row[0]}
        orgs_result = await session.execute(
            text("select distinct organization from public.academic_activities where owner_id = :id and organization is not null"),
            {"id": profile_id},
        )
        previous_orgs = {row[0].lower() for row in orgs_result.all() if row[0]}

        created = 0
        for index, signal in enumerate(candidates):
            await update_job(session, job_id, progress=45 + int(45 * index / max(len(candidates), 1)), progress_label=f"Analyzing {signal['title'][:60]}…")
            full_body = signal["snippet"] or ""
            if access_token:
                fetched = await fetch_gmail_message_full(access_token, signal["external_id"], settings)
                if fetched:
                    full_body = fetched[0]
            extracted = await extract_inbox_item(signal["title"], signal["sender"] or "", full_body, llm)
            if extracted is None:
                await mark_classified(session, signal["id"], classification={"category": "ignore_non_actionable"}, entities={})
                continue

            deadline_value = _safe_date(extracted.deadline)
            meeting_value = _safe_date(extracted.meeting_date)
            topic_overlap = [t for t in extracted.research_topics if t.lower() in research_interests]
            priority = compute_priority(
                deadline=deadline_value,
                meeting_date=meeting_value,
                today=datetime.now(UTC).date(),
                known_sender=bool(signal["sender"]) and any(name in (signal["sender"] or "").lower() for name in known_names),
                previous_collaborator_org=bool(extracted.organization) and (extracted.organization or "").lower() in previous_orgs,
                research_topic_overlap=topic_overlap,
                explicit_response_requested=any(p in full_body.lower() for p in ("please respond", "kindly respond", "let us know", "rsvp", "reply by")),
            )
            replies = draft_replies(
                category=extracted.category, sender_name=_sender_display_name(signal["sender"]),
                subject=signal["title"], requested_action=extracted.requested_action,
                faculty_name=faculty_name, today=datetime.now(UTC).date(),
            )
            await session.execute(
                text(
                    """
                    insert into public.action_inbox_items
                        (profile_id, signal_id, category, subject, sender, organization, summary, requested_action,
                         deadline, meeting_date, related_people, related_documents, research_topics, urgency,
                         relevance_reasons, confidence, generated_replies, gmail_message_id, status)
                    values
                        (:profile_id, :signal_id, cast(:category as inbox_category), :subject, :sender, :organization, :summary,
                         :requested_action, :deadline, :meeting_date, cast(:related_people as jsonb), '[]'::jsonb,
                         :research_topics, cast(:urgency as inbox_urgency), :relevance_reasons, :confidence,
                         cast(:generated_replies as jsonb), :gmail_message_id, 'new')
                    on conflict (profile_id, signal_id) do update set
                        category = excluded.category, subject = excluded.subject, sender = excluded.sender,
                        organization = excluded.organization, summary = excluded.summary,
                        requested_action = excluded.requested_action, deadline = excluded.deadline,
                        meeting_date = excluded.meeting_date, related_people = excluded.related_people,
                        research_topics = excluded.research_topics, urgency = excluded.urgency,
                        relevance_reasons = excluded.relevance_reasons, confidence = excluded.confidence,
                        generated_replies = excluded.generated_replies, status = 'new', updated_at = now()
                    """
                ),
                {
                    "profile_id": profile_id,
                    "signal_id": signal["id"],
                    "category": extracted.category,
                    "subject": signal["title"],
                    "sender": signal["sender"],
                    "organization": extracted.organization,
                    "summary": extracted.summary,
                    "requested_action": extracted.requested_action,
                    "deadline": deadline_value,
                    "meeting_date": meeting_value,
                    "related_people": _json(extracted.related_people),
                    "research_topics": extracted.research_topics,
                    "urgency": priority.urgency,
                    "relevance_reasons": priority.reasons,
                    "confidence": extracted.confidence,
                    "generated_replies": _json(replies),
                    "gmail_message_id": signal["external_id"],
                },
            )
            await mark_classified(session, signal["id"], classification={"category": extracted.category}, entities={"organization": extracted.organization})
            created += 1

        await session.commit()
        await update_job(
            session, job_id, status="completed", progress=100,
            progress_label=f"{created} actionable item(s) found",
            result={"mode": summary.mode, "fetched": summary.fetched, "actionable": created},
        )


def _safe_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _sender_display_name(sender: str | None) -> str:
    if not sender:
        return ""
    return sender.split("<")[0].strip().strip('"')


def _json(value: Any) -> str:
    import json

    return json.dumps(value)
