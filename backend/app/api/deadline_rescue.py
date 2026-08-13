"""USP 3 — Deadline Rescue: one orchestrated run over existing pipelines.

Not a new automation -- a sequencer over publication sync, Reconstruct My
Year's harvest pipeline, evidence-pending detection, and appraisal draft
generation, with one aggregate progress screen. A step that can't run (no
ORCID configured, no open cycle) is reported as an honest partial-completion
line, never silently treated as success (PROJECT_V2.md §37).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..connectors.google import fixture_harvest
from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import database, get_db
from ..services.jobs import create_job, get_job, update_job
from ..services.reconstruct import run_pipeline
from .appraisals import _open_cycle, generate_draft
from .publications import sync_publications
from .utils import institution_id_or_403

router = APIRouter(prefix="/appraisals/rescue", tags=["appraisals"])


async def _run_rescue(job_id: UUID, owner_id: UUID, institution_id: UUID, settings: Settings) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        steps: dict[str, dict[str, Any]] = {}

        await update_job(session, job_id, status="running", progress=10, progress_label="Syncing publications…")
        user = _RescuePrincipal(owner_id, institution_id)
        try:
            sync_result = await sync_publications(user=user, session=session, settings=settings)
            steps["publications_synced"] = {"ok": True, "detail": f"{sync_result['count']} candidates ready for review"}
        except HTTPException as exc:
            steps["publications_synced"] = {"ok": False, "detail": exc.detail}

        await update_job(session, job_id, progress=35, progress_label="Recovering forgotten activities…")
        harvested = fixture_harvest() if settings.reconstruct_fake_sources else []
        drafts = await run_pipeline(harvested)
        recovered_count = 0
        if drafts:
            run_result = await session.execute(
                text("insert into public.reconstruction_runs (profile_id, job_id, academic_year) values (:profile_id, :job_id, 'unspecified') returning id"),
                {"profile_id": owner_id, "job_id": job_id},
            )
            run_id = run_result.scalar_one()
            existing_titles = await session.execute(text("select lower(title) as title from public.academic_activities where owner_id = :owner_id"), {"owner_id": owner_id})
            existing_title_set = {row[0] for row in existing_titles.all()}
            for draft in drafts:
                if draft["title"].lower() in existing_title_set:
                    continue
                await session.execute(
                    text(
                        "insert into public.reconstruction_candidates (run_id, profile_id, category, title, organization, start_date, confidence) "
                        "values (:run_id, :profile_id, cast(:category as activity_category), :title, :organization, :start_date, :confidence)"
                    ),
                    {"run_id": run_id, "profile_id": owner_id, "category": draft["category"], "title": draft["title"], "organization": draft.get("organization"), "start_date": draft.get("start_date"), "confidence": draft["confidence"]},
                )
                recovered_count += 1
            await session.execute(text("update public.reconstruction_runs set candidate_count = :count, completed_at = now() where id = :id"), {"count": recovered_count, "id": run_id})
        steps["activities_recovered"] = {"ok": True, "detail": f"{recovered_count} candidates ready for review" if recovered_count else "No new activities found from connected sources"}

        await update_job(session, job_id, progress=60, progress_label="Checking for missing evidence…")
        pending_result = await session.execute(
            text("select count(*)::int from public.academic_activities where owner_id = :owner_id and evidence_status = 'pending' and status <> 'archived'"),
            {"owner_id": owner_id},
        )
        pending_evidence_count = pending_result.scalar_one()
        steps["evidence_checked"] = {"ok": True, "detail": f"{pending_evidence_count} activities still need evidence"}

        await update_job(session, job_id, progress=80, progress_label="Preparing your appraisal…")
        try:
            cycle = await _open_cycle(session, user)
            submission = await generate_draft(cycle["id"], user, session)
            steps["appraisal_generated"] = {"ok": True, "detail": f"Draft ready at {submission.get('readiness', 0)}% readiness", "submission_id": str(submission["id"])}
        except HTTPException as exc:
            steps["appraisal_generated"] = {"ok": False, "detail": exc.detail}

        things_needing_you = sum([
            1 if not steps["publications_synced"]["ok"] else 0,
            recovered_count,
            pending_evidence_count,
        ])
        await update_job(
            session, job_id, status="completed", progress=100,
            progress_label=f"Only {things_needing_you} things still need you" if things_needing_you else "Everything is ready to review",
            result={"steps": steps, "things_needing_you": things_needing_you},
        )


class _RescuePrincipal:
    """Minimal CurrentUser-shaped object for calling other routers' handlers directly."""

    def __init__(self, user_id: UUID, institution_id: UUID) -> None:
        self.user_id = user_id
        self._institution_id = institution_id
        self.role = "faculty"
        self.profile: dict[str, Any] = {"institution_id": str(institution_id)}

    @property
    def institution_id(self) -> UUID:
        return self._institution_id

    @property
    def is_admin(self) -> bool:
        return False


@router.post("")
async def start_deadline_rescue(
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    job_id = await create_job(session, owner_id=user.user_id, kind="deadline_rescue")
    background_tasks.add_task(_run_rescue, job_id, user.user_id, institution_id_or_403(user), settings)
    return {"job_id": job_id, "status": "queued"}


@router.get("/{job_id}")
async def get_deadline_rescue(job_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    job = await get_job(session, job_id, user.user_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deadline rescue job not found")
    return job
