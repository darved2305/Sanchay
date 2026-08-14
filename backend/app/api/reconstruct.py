"""USP 1 — Reconstruct My Year: source status, run orchestration, candidate review."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..connectors.google import (
    CONNECTOR_PROVIDERS,
    SCOPES,
    HarvestedItem,
    build_authorize_url,
    decrypt_token,
    encrypt_token,
    exchange_code_for_token,
    fetch_calendar_items,
    fetch_drive_items,
    fetch_gmail_items,
    fixture_harvest,
    refresh_access_token,
    sign_oauth_state,
    verify_oauth_state,
)
from ..core.academic_year import derive_academic_year
from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import database, get_db
from ..services.jobs import create_job, get_job, update_job
from ..services.llm import LLMProvider
from ..services.reconstruct import is_academic_signal, run_pipeline
from ..services.reconstruct_cluster import classify_and_cluster_signal, get_cached_candidates
from ..services.signals import unprocessed_signals
from ..services.source_sync import sync_calendar_signals, sync_drive_signals, sync_gmail_signals
from .schemas import ReconstructRunCreate
from .utils import rows_to_dicts

router = APIRouter(prefix="/reconstruct", tags=["reconstruct"])
logger = logging.getLogger(__name__)


@router.get("/sources")
async def list_sources(
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    result = await session.execute(
        text("select provider::text as provider, status, external_account_email, last_synced_at from public.oauth_connections where profile_id = :profile_id"),
        {"profile_id": user.user_id},
    )
    connected = {row["provider"]: dict(row) for row in result.mappings().all()}
    google_configured = bool(settings.google_oauth_client_id and settings.google_oauth_redirect_uri)
    sources = []
    for provider in CONNECTOR_PROVIDERS:
        connection = connected.get(provider)
        sources.append({
            "provider": provider,
            "status": connection["status"] if connection else ("not_configured" if not google_configured else "disconnected"),
            "external_account_email": connection.get("external_account_email") if connection else None,
            "last_synced_at": connection.get("last_synced_at") if connection else None,
        })
    return {
        "sources": sources,
        "google_oauth_configured": google_configured,
        "fixture_mode": settings.reconstruct_fake_sources,
        "publications_available": True,
    }


@router.get("/oauth/{provider}/start")
async def start_google_oauth(
    provider: str,
    user: CurrentUser = Depends(require_faculty),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    # SCOPES (not the narrower CONNECTOR_PROVIDERS) so this same generic
    # authorize/callback machinery also handles the gmail_compose incremental
    # scope the Action Inbox requests separately -- one OAuth implementation,
    # not a second one duplicated for a write-scope connection.
    if provider not in SCOPES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown source")
    try:
        state = sign_oauth_state(settings, user.user_id, provider)
        authorize_url = build_authorize_url(settings, provider, state)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return {"authorize_url": authorize_url}


@router.get("/oauth/callback")
async def google_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    # Google redirects the browser here directly -- there is no Authorization
    # header on this request, so the signed `state` (see connectors/google.py)
    # is the only way to recover which user/provider started the flow.
    frontend_url = (settings.cors_origins[0] if settings.cors_origins else "http://localhost:5173").rstrip("/")
    if error:
        return RedirectResponse(f"{frontend_url}/?google_oauth_error={error}")
    if not code or not state:
        return RedirectResponse(f"{frontend_url}/?google_oauth_error=missing_code_or_state")
    verified = verify_oauth_state(settings, state)
    if verified is None:
        return RedirectResponse(f"{frontend_url}/?google_oauth_error=invalid_or_expired_state")
    user_id, provider = verified
    try:
        token_response = await exchange_code_for_token(settings, code)
    except Exception:  # noqa: BLE001 - any failure here must still redirect cleanly, never 500 to a browser mid-consent
        return RedirectResponse(f"{frontend_url}/?google_oauth_error=token_exchange_failed")
    access_token = token_response.get("access_token")
    refresh_token = token_response.get("refresh_token")
    expires_in = token_response.get("expires_in")
    if not access_token:
        return RedirectResponse(f"{frontend_url}/?google_oauth_error=no_access_token")
    expires_at = datetime.now(UTC) + timedelta(seconds=int(expires_in)) if expires_in else None

    database.configure(settings)
    if database.session_factory is not None:
        async with database.session_factory() as session:
            await session.execute(
                text(
                    """
                    insert into public.oauth_connections (profile_id, provider, status, connected_at, expires_at, encrypted_access_token, encrypted_refresh_token)
                    values (:profile_id, cast(:provider as oauth_provider), 'connected', now(), :expires_at, :access_token, :refresh_token)
                    on conflict (profile_id, provider) do update set
                      status = 'connected', connected_at = now(), expires_at = excluded.expires_at,
                      encrypted_access_token = excluded.encrypted_access_token,
                      encrypted_refresh_token = coalesce(excluded.encrypted_refresh_token, public.oauth_connections.encrypted_refresh_token),
                      updated_at = now()
                    """
                ),
                {
                    "profile_id": user_id,
                    "provider": provider,
                    "expires_at": expires_at,
                    "access_token": encrypt_token(settings, access_token),
                    "refresh_token": encrypt_token(settings, refresh_token) if refresh_token else None,
                },
            )
            await session.commit()
    return RedirectResponse(f"{frontend_url}/?google_oauth_connected={provider}")


@router.post("/oauth/{provider}/disconnect")
async def disconnect_google_oauth(provider: str, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    if provider not in SCOPES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown source")
    await session.execute(
        text(
            "update public.oauth_connections set status = 'disconnected', encrypted_access_token = null, encrypted_refresh_token = null, updated_at = now() "
            "where profile_id = :profile_id and provider = cast(:provider as oauth_provider)"
        ),
        {"profile_id": user.user_id, "provider": provider},
    )
    await session.commit()
    return {"ok": True}


_FETCHERS = {
    "gmail": fetch_gmail_items,
    "google_calendar": fetch_calendar_items,
    "google_drive": fetch_drive_items,
}


async def _access_token_for(
    session: AsyncSession, settings: Settings, profile_id: UUID, provider: str, connection: dict[str, Any]
) -> str | None:
    """Return a usable access token for ``provider``, refreshing it first if expired."""

    expires_at = connection.get("expires_at")
    if expires_at is not None and expires_at <= datetime.now(UTC) and connection.get("encrypted_refresh_token"):
        refresh_token = decrypt_token(settings, connection["encrypted_refresh_token"])
        if refresh_token:
            try:
                refreshed = await refresh_access_token(settings, refresh_token)
            except Exception:  # noqa: BLE001 - a failed refresh should fall back to the stale token, not abort the run
                logger.exception("reconstruct: token refresh failed for provider=%s", provider)
                refreshed = None
            if refreshed and refreshed.get("access_token"):
                new_expires_in = refreshed.get("expires_in")
                new_expires_at = datetime.now(UTC) + timedelta(seconds=int(new_expires_in)) if new_expires_in else None
                await session.execute(
                    text(
                        "update public.oauth_connections set encrypted_access_token = :token, expires_at = :expires_at, updated_at = now() "
                        "where profile_id = :profile_id and provider = cast(:provider as oauth_provider)"
                    ),
                    {
                        "token": encrypt_token(settings, refreshed["access_token"]),
                        "expires_at": new_expires_at,
                        "profile_id": profile_id,
                        "provider": provider,
                    },
                )
                await session.commit()
                return refreshed["access_token"]
    if not connection.get("encrypted_access_token"):
        return None
    return decrypt_token(settings, connection["encrypted_access_token"])


async def _harvest_all(session: AsyncSession, profile_id: UUID, settings: Settings) -> tuple[list[HarvestedItem], list[str]]:
    if settings.reconstruct_fake_sources:
        return fixture_harvest(), ["gmail", "google_calendar", "google_drive"]

    connections = await session.execute(
        text(
            "select provider::text as provider, encrypted_access_token, encrypted_refresh_token, expires_at "
            "from public.oauth_connections where profile_id = :profile_id and status = 'connected'"
        ),
        {"profile_id": profile_id},
    )
    harvested: list[HarvestedItem] = []
    sources_used: list[str] = []
    for connection in connections.mappings().all():
        provider = connection["provider"]
        fetcher = _FETCHERS.get(provider)
        if fetcher is None:
            continue
        access_token = await _access_token_for(session, settings, profile_id, provider, dict(connection))
        if not access_token:
            logger.warning("reconstruct: no usable access token for provider=%s, skipping", provider)
            continue
        try:
            items = await fetcher(access_token, settings)
        except Exception:  # noqa: BLE001 - one provider failing (expired/revoked token, API error) must not fail the whole run
            logger.exception("reconstruct: harvest failed for provider=%s", provider)
            continue
        logger.info("reconstruct: harvested %d item(s) from provider=%s", len(items), provider)
        harvested.extend(items)
        sources_used.append(provider)
    return harvested, sources_used


@router.post("/runs")
async def start_reconstruction_run(
    payload: ReconstructRunCreate,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    job_id = await create_job(session, owner_id=user.user_id, kind="reconstruct")
    run_result = await session.execute(
        text(
            "insert into public.reconstruction_runs (profile_id, job_id, academic_year) values (:profile_id, :job_id, :academic_year) returning id"
        ),
        {"profile_id": user.user_id, "job_id": job_id, "academic_year": payload.academic_year},
    )
    run_id = run_result.scalar_one()
    await session.commit()
    background_tasks.add_task(_run_reconstruction, run_id, job_id, user.user_id, settings)
    return {"run_id": run_id, "job_id": job_id, "status": "queued"}


async def _run_reconstruction(run_id: UUID, job_id: UUID, owner_id: UUID, settings: Settings) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        await update_job(session, job_id, status="running", progress=10, progress_label="Scanning connected sources…")
        harvested, sources_used = await _harvest_all(session, owner_id, settings)
        logger.info(
            "reconstruct: run_id=%s harvested=%d sources_used=%s", run_id, len(harvested), sources_used
        )
        for item in harvested:
            logger.info(
                "reconstruct: run_id=%s harvested_item source=%s title=%r occurred_on=%s academic=%s",
                run_id, item.source_type, item.title, item.occurred_on, is_academic_signal(item),
            )
        await update_job(session, job_id, progress=45, progress_label=f"{len(harvested)} items found; looking for academic signals…")
        drafts = await run_pipeline(harvested, llm=LLMProvider(settings))
        logger.info("reconstruct: run_id=%s drafts_after_pipeline=%d", run_id, len(drafts))
        existing_titles = await session.execute(
            text("select lower(title) as title from public.academic_activities where owner_id = :owner_id"),
            {"owner_id": owner_id},
        )
        existing_title_set = {row[0] for row in existing_titles.all()}
        logger.info("reconstruct: run_id=%s existing_titles=%d draft_titles=%s", run_id, len(existing_title_set), [d["title"] for d in drafts])
        candidate_ids: list[str] = []
        for draft in drafts:
            if draft["title"].lower() in existing_title_set:
                logger.info("reconstruct: run_id=%s skipping draft title=%r (already in record)", run_id, draft["title"])
                continue  # Already in the record; never re-propose a dedupe match.
            candidate_result = await session.execute(
                text(
                    """
                    insert into public.reconstruction_candidates (run_id, profile_id, category, title, organization, start_date, confidence, metadata)
                    values (:run_id, :profile_id, cast(:category as activity_category), :title, :organization, :start_date, :confidence, cast(:metadata as jsonb))
                    returning id
                    """
                ),
                {
                    "run_id": run_id,
                    "profile_id": owner_id,
                    "category": draft["category"],
                    "title": draft["title"],
                    "organization": draft.get("organization"),
                    "start_date": draft.get("start_date"),
                    "confidence": draft["confidence"],
                    "metadata": json.dumps({}),
                },
            )
            candidate_id = candidate_result.scalar_one()
            candidate_ids.append(str(candidate_id))
            for source in draft["sources"]:
                await session.execute(
                    text(
                        "insert into public.candidate_sources (candidate_id, source_type, source_ref, snippet, raw) "
                        "values (:candidate_id, :source_type, :source_ref, :snippet, cast(:raw as jsonb))"
                    ),
                    {
                        "candidate_id": candidate_id,
                        "source_type": source["source_type"],
                        "source_ref": source["source_ref"],
                        "snippet": source["snippet"],
                        "raw": json.dumps(source["raw"]),
                    },
                )
        await session.execute(
            text("update public.reconstruction_runs set sources_used = :sources_used, candidate_count = :count, completed_at = now() where id = :id"),
            {"sources_used": sources_used, "count": len(candidate_ids), "id": run_id},
        )
        await session.commit()
        logger.info("reconstruct: run_id=%s candidates_created=%d", run_id, len(candidate_ids))
        await update_job(
            session, job_id, status="completed", progress=100,
            progress_label=f"{len(candidate_ids)} candidates ready for review",
            result={"run_id": str(run_id), "candidate_count": len(candidate_ids)},
        )


@router.get("/runs/{run_id}")
async def get_reconstruction_run(run_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            "select id, profile_id, job_id, academic_year, sources_used, candidate_count, confirmed_count, created_at, completed_at "
            "from public.reconstruction_runs where id = :id and profile_id = :profile_id"
        ),
        {"id": run_id, "profile_id": user.user_id},
    )
    run = result.mappings().first()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reconstruction run not found")
    payload = dict(run)
    if run["job_id"]:
        payload["job"] = await get_job(session, run["job_id"], user.user_id)
    return payload


@router.get("/runs/{run_id}/candidates")
async def list_run_candidates(
    run_id: UUID,
    candidate_status: str = Query(default="proposed", alias="status"),
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        text(
            "select id, category::text as category, title, organization, start_date, confidence, status::text as status, activity_id "
            "from public.reconstruction_candidates where run_id = :run_id and profile_id = :profile_id and status = cast(:status as reconstruct_candidate_status) "
            "order by confidence desc, created_at"
        ),
        {"run_id": run_id, "profile_id": user.user_id, "status": candidate_status},
    )
    candidates = rows_to_dicts(result.mappings().all())
    for candidate in candidates:
        sources = await session.execute(
            text("select source_type, source_ref, snippet from public.candidate_sources where candidate_id = :candidate_id"),
            {"candidate_id": candidate["id"]},
        )
        candidate["sources"] = rows_to_dicts(sources.mappings().all())
    return {"items": candidates}


async def _candidate_or_404(session: AsyncSession, candidate_id: UUID, profile_id: UUID) -> dict[str, Any]:
    result = await session.execute(
        text("select id, run_id, profile_id, category::text as category, title, organization, start_date, status::text as status, activity_id from public.reconstruction_candidates where id = :id and profile_id = :profile_id"),
        {"id": candidate_id, "profile_id": profile_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reconstruction candidate not found")
    return dict(row)


@router.post("/candidates/{candidate_id}/confirm")
async def confirm_candidate(
    candidate_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    candidate = await _candidate_or_404(session, candidate_id, user.user_id)
    if candidate["status"] != "proposed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Candidate is already {candidate['status']}")
    academic_year = derive_academic_year(candidate["start_date"]) if candidate["start_date"] else "unspecified"
    activity_result = await session.execute(
        text(
            """
            insert into public.academic_activities (owner_id, category, title, organization, start_date, academic_year, status, source, confidence, confirmed_at)
            values (:owner_id, cast(:category as activity_category), :title, :organization, :start_date, :academic_year, 'confirmed', 'reconstruction', 0.9, now())
            returning id
            """
        ),
        {
            "owner_id": user.user_id,
            "category": candidate["category"],
            "title": candidate["title"],
            "organization": candidate.get("organization"),
            "start_date": candidate.get("start_date"),
            "academic_year": academic_year,
        },
    )
    activity_id = activity_result.scalar_one()
    await session.execute(
        text("update public.reconstruction_candidates set status = 'confirmed', activity_id = :activity_id, updated_at = now() where id = :id"),
        {"activity_id": activity_id, "id": candidate_id},
    )
    await session.execute(
        text("update public.reconstruction_runs set confirmed_count = confirmed_count + 1 where id = :run_id"),
        {"run_id": candidate["run_id"]},
    )
    await session.commit()
    return {"activity_id": activity_id, "candidate_id": candidate_id}


@router.post("/candidates/{candidate_id}/ignore")
async def ignore_candidate(candidate_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    candidate = await _candidate_or_404(session, candidate_id, user.user_id)
    if candidate["status"] != "proposed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Candidate is already {candidate['status']}")
    await session.execute(
        text("update public.reconstruction_candidates set status = 'ignored', updated_at = now() where id = :id"),
        {"id": candidate_id},
    )
    await session.commit()
    return {"ok": True}


# ---------- Performance redesign (product expansion §47-59): cache-first read + delta sync ----------
#
# Everything above this line is the original full-rescan-per-run pipeline,
# kept working as-is (the fixture-mode demo path and existing confirmed-run
# history both depend on it) and still available as an explicit manual
# "Start a full run" action. Below is the new default fast path: it shares
# `source_signals`/`activity_clusters`/`source_sync_state` with the Faculty
# Action Inbox (010_signal_layer.sql) instead of re-harvesting/re-classifying
# anything, so opening Reconstruct is a database read, and a sync only ever
# asks Google for what changed since the last cursor.

_SYNC_FUNCTIONS = {"gmail": sync_gmail_signals, "google_calendar": sync_calendar_signals, "google_drive": sync_drive_signals}


@router.get("/candidates")
async def cached_candidates(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Cache-first candidate list (§58): a plain query against persisted
    `activity_clusters`, never a live re-harvest. Call this on page load;
    call `POST /reconstruct/sync` separately/asynchronously to check for
    anything new, exactly like the "database query immediately, then
    'Checking for anything new…' in the background" UX the spec calls for."""

    return {"items": await get_cached_candidates(session, user.user_id)}


@router.post("/sync")
async def start_incremental_sync(
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    job_id = await create_job(session, owner_id=user.user_id, kind="reconstruct_sync")
    background_tasks.add_task(_run_incremental_sync, job_id, user.user_id, settings)
    return {"job_id": job_id, "status": "queued"}


@router.get("/sync/{job_id}")
async def get_incremental_sync_job(job_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    job = await get_job(session, job_id, user.user_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


async def _run_incremental_sync(job_id: UUID, profile_id: UUID, settings: Settings) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        await update_job(session, job_id, status="running", progress=5, progress_label="Checking connected sources…")

        connections = await session.execute(
            text("select provider::text as provider, encrypted_access_token from public.oauth_connections where profile_id = :profile_id and status = 'connected'"),
            {"profile_id": profile_id},
        )
        connected = {row["provider"]: row["encrypted_access_token"] for row in connections.mappings().all()}
        if not connected:
            await update_job(session, job_id, status="completed", progress=100, progress_label="No sources connected", result={"new_items": 0, "sources_checked": []})
            return

        summaries: list[dict[str, Any]] = []
        progress = 10
        for provider, sync_fn in _SYNC_FUNCTIONS.items():
            encrypted_token = connected.get(provider)
            if not encrypted_token:
                continue
            access_token = decrypt_token(settings, encrypted_token)
            if not access_token:
                continue
            await update_job(session, job_id, progress=progress, progress_label=f"Syncing {provider.replace('_', ' ')}…")
            try:
                summary = await sync_fn(session, profile_id=profile_id, access_token=access_token, settings=settings)
                await session.commit()
                summaries.append({"provider": summary.provider, "mode": summary.mode, "fetched": summary.fetched, "changed": summary.new_or_changed})
            except Exception:  # noqa: BLE001 - one provider failing must not abort the whole sync
                logger.exception("reconstruct_sync: provider=%s failed", provider)
                await session.rollback()
            progress += 25

        await update_job(session, job_id, progress=80, progress_label="Correlating new signals…")
        pending = await unprocessed_signals(session, profile_id=profile_id)
        llm = LLMProvider(settings)
        new_clusters = 0
        for signal in pending:
            outcome = await classify_and_cluster_signal(session, signal, llm)
            if outcome.actionable and outcome.is_new_cluster:
                new_clusters += 1
        await session.commit()

        await update_job(
            session, job_id, status="completed", progress=100,
            progress_label=f"{new_clusters} new candidate(s) found" if new_clusters else "Up to date",
            result={"sources": summaries, "signals_processed": len(pending), "new_clusters": new_clusters},
        )


async def _cached_cluster_or_404(session: AsyncSession, cluster_id: UUID, profile_id: UUID) -> dict[str, Any]:
    result = await session.execute(
        text(
            "select id, predicted_category::text as predicted_category, normalized_title, organization, start_date, status::text as status "
            "from public.activity_clusters where id = :id and profile_id = :profile_id"
        ),
        {"id": cluster_id, "profile_id": profile_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    return dict(row)


@router.post("/candidates/cached/{cluster_id}/confirm")
async def confirm_cached_candidate(cluster_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    cluster = await _cached_cluster_or_404(session, cluster_id, user.user_id)
    if cluster["status"] != "proposed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Candidate is already {cluster['status']}")
    existing = await session.execute(
        text("select 1 from public.academic_activities where owner_id = :owner_id and lower(title) = lower(:title)"),
        {"owner_id": user.user_id, "title": cluster["normalized_title"]},
    )
    if existing.scalar_one_or_none() is not None:
        await session.execute(text("update public.activity_clusters set status = 'ignored', updated_at = now() where id = :id"), {"id": cluster_id})
        await session.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already in your record; this candidate has been dismissed as a duplicate")

    academic_year = derive_academic_year(cluster["start_date"]) if cluster["start_date"] else "unspecified"
    activity_result = await session.execute(
        text(
            """
            insert into public.academic_activities (owner_id, category, title, organization, start_date, academic_year, status, source, confidence, confirmed_at)
            values (:owner_id, cast(:category as activity_category), :title, :organization, :start_date, :academic_year, 'confirmed', 'reconstruction', 0.9, now())
            returning id
            """
        ),
        {
            "owner_id": user.user_id, "category": cluster["predicted_category"] or "other", "title": cluster["normalized_title"],
            "organization": cluster.get("organization"), "start_date": cluster.get("start_date"), "academic_year": academic_year,
        },
    )
    activity_id = activity_result.scalar_one()
    await session.execute(
        text("update public.activity_clusters set status = 'confirmed', activity_id = :activity_id, updated_at = now() where id = :id"),
        {"activity_id": activity_id, "id": cluster_id},
    )
    await session.commit()
    return {"activity_id": activity_id, "cluster_id": cluster_id}


@router.post("/candidates/cached/{cluster_id}/ignore")
async def ignore_cached_candidate(cluster_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    cluster = await _cached_cluster_or_404(session, cluster_id, user.user_id)
    if cluster["status"] != "proposed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Candidate is already {cluster['status']}")
    await session.execute(text("update public.activity_clusters set status = 'ignored', updated_at = now() where id = :id"), {"id": cluster_id})
    await session.commit()
    return {"ok": True}
