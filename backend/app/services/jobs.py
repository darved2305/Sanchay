"""Shared ``background_jobs`` row helpers.

There is no separate task queue in this build (see PROJECT_V2.md §25: choose
the simplest reliable implementation). Long-running USP actions run inline
inside the request via ``fastapi.BackgroundTasks`` and report progress by
updating one row in ``public.background_jobs`` that the frontend polls /
subscribes to over Supabase Realtime. Every USP job (CV import, reconstruction
runs, form analyze/generate, deadline rescue) uses this same envelope so the
frontend has one progress-chip component instead of one per feature.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create_job(session: AsyncSession, *, owner_id: UUID, kind: str) -> UUID:
    job_id = uuid4()
    await session.execute(
        text(
            "insert into public.background_jobs (id, owner_id, kind, status, progress) "
            "values (:id, :owner_id, :kind, 'queued', 0)"
        ),
        {"id": job_id, "owner_id": owner_id, "kind": kind},
    )
    await session.commit()
    return job_id


async def update_job(
    session: AsyncSession,
    job_id: UUID,
    *,
    status: str | None = None,
    progress: float | None = None,
    progress_label: str | None = None,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    assignments: list[str] = []
    params: dict[str, Any] = {"id": job_id}
    if status is not None:
        assignments.append("status = cast(:status as job_status)")
        params["status"] = status
    if progress is not None:
        assignments.append("progress = :progress")
        params["progress"] = progress
    if progress_label is not None:
        assignments.append("progress_label = :progress_label")
        params["progress_label"] = progress_label
    if result is not None:
        import json

        assignments.append("result = cast(:result as jsonb)")
        params["result"] = json.dumps(result)
    if error is not None:
        assignments.append("error = :error")
        params["error"] = error
    if not assignments:
        return
    await session.execute(
        text(f"update public.background_jobs set {', '.join(assignments)}, updated_at = now() where id = :id"),
        params,
    )
    await session.commit()


async def get_job(session: AsyncSession, job_id: UUID, owner_id: UUID) -> dict[str, Any] | None:
    result = await session.execute(
        text(
            "select id, owner_id, kind, status::text as status, progress, progress_label, result, error, created_at, updated_at "
            "from public.background_jobs where id = :id and owner_id = :owner_id"
        ),
        {"id": job_id, "owner_id": owner_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None
