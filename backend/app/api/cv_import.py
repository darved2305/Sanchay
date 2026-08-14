"""USP 11 — CV Import Bootstrap: upload a CV, get draft activities to review.

Draft activities are inserted directly as ``academic_activities`` rows with
``status = 'proposed'`` and ``source = 'cv_import'`` -- there is no separate
CV-import table. This keeps CV Import a thin producer into the same canonical
record every other USP reads from, and lets it reuse the existing
``/activities/{id}/confirm`` and ``/activities/bulk-confirm`` endpoints for
review instead of a bespoke confirmation flow.
"""

from __future__ import annotations

import json
import re
from pathlib import PurePath
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import database, get_db
from ..core.storage import StorageClient, StorageError
from ..services.cv_import import extract_cv_activities
from ..services.document_text import extract_text_with_ocr_fallback
from ..services.jobs import create_job, get_job, update_job
from ..services.llm import LLMProvider
from .schemas import EvidenceUploadRequest

router = APIRouter(prefix="/cv-import", tags=["cv-import"])

# PDF/DOCX/XLSX are read deterministically (document_text.py). JPEG/PNG have
# no text layer at all -- they only work via the vision-model OCR path in
# extract_text_with_ocr_fallback, so without GROQ_API_KEY configured an image
# upload will cleanly fail the job with "no readable text", not silently
# produce zero activities.
ALLOWED_CV_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg",
    "image/png",
}
MAX_CV_BYTES = 15 * 1024 * 1024


def _safe_filename(file_name: str) -> str:
    name = PurePath(file_name.replace("\x00", "")).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not name:
        raise HTTPException(status_code=422, detail="file_name is invalid")
    return name[:180]


@router.post("/upload-url")
async def create_cv_upload_url(
    payload: EvidenceUploadRequest,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    mime = payload.mime.lower().split(";", 1)[0].strip()
    if mime not in ALLOWED_CV_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Upload a PDF or DOCX CV")
    if payload.size > MAX_CV_BYTES:
        raise HTTPException(status_code=413, detail="CV files must be 15 MB or smaller")
    job_id = await create_job(session, owner_id=user.user_id, kind="cv_import")
    name = _safe_filename(payload.file_name)
    storage_path = f"{user.user_id}/cv-import/{job_id}/{name}"
    storage = StorageClient(settings)
    try:
        signed = await storage.create_signed_upload_url(settings.supabase_evidence_bucket, storage_path)
    except StorageError as exc:
        raise HTTPException(status_code=503, detail=f"Storage is unavailable: {exc}") from exc
    await update_job(
        session, job_id,
        result={"storage_path": storage_path, "file_name": name, "mime_type": mime},
    )
    return {
        "job_id": job_id,
        "storage_path": storage_path,
        "upload_url": signed["url"],
        "token": signed.get("token"),
    }


async def _run_cv_import(job_id: UUID, owner_id: UUID, settings: Settings) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        job = await get_job(session, job_id, owner_id)
        if job is None:
            return
        result = job.get("result") or {}
        storage_path = result.get("storage_path")
        mime_type = result.get("mime_type")
        if not storage_path or not mime_type:
            await update_job(session, job_id, status="failed", error="Upload metadata is missing")
            return
        await update_job(session, job_id, status="running", progress=10, progress_label="Reading document…")
        storage = StorageClient(settings)
        try:
            info = await storage.object_info(settings.supabase_evidence_bucket, storage_path)
            size = info.get("size") or info.get("metadata", {}).get("size")
            if size is not None and int(size) > MAX_CV_BYTES:
                raise StorageError("File exceeds the maximum CV size")
            content = await storage.download_object(settings.supabase_evidence_bucket, storage_path)
        except StorageError as exc:
            await update_job(session, job_id, status="failed", error=f"Could not read uploaded file: {exc}")
            return
        llm = LLMProvider(settings)
        if mime_type in {"image/jpeg", "image/png"} and not llm.configured:
            await update_job(
                session, job_id, status="failed",
                error="This is an image upload -- reading it requires an LLM provider (GROQ_API_KEY) to be configured for OCR",
            )
            return
        if mime_type in {"image/jpeg", "image/png"}:
            await update_job(session, job_id, progress=25, progress_label="Reading text from the image…")
        cv_text = await extract_text_with_ocr_fallback(content, mime_type, llm)
        if not cv_text.strip():
            await update_job(session, job_id, status="failed", error="No readable text was found in this file")
            return
        await update_job(session, job_id, progress=45, progress_label="Extracting activities…")
        drafts = await extract_cv_activities(cv_text, llm)
        created_ids: list[str] = []
        for draft in drafts:
            insert_result = await session.execute(
                text(
                    """
                    insert into public.academic_activities (
                      owner_id, category, title, organization, academic_year, metadata,
                      status, source, confidence
                    ) values (
                      :owner_id, cast(:category as activity_category), :title, :organization,
                      :academic_year, cast(:metadata as jsonb), 'proposed', 'cv_import', 0.5
                    ) returning id
                    """
                ),
                {
                    "owner_id": owner_id,
                    "category": draft["category"],
                    "title": draft["title"],
                    "organization": draft.get("organization"),
                    "academic_year": draft["academic_year"],
                    "metadata": json.dumps({"cv_import_job_id": str(job_id)}),
                },
            )
            created_ids.append(str(insert_result.scalar_one()))
        await session.commit()
        await update_job(
            session, job_id,
            status="completed", progress=100, progress_label=f"{len(created_ids)} activities found",
            result={**result, "activity_ids": created_ids, "draft_count": len(created_ids)},
        )


@router.post("/{job_id}/process")
async def process_cv_import(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    job = await get_job(session, job_id, user.user_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CV import job not found")
    if job["status"] not in {"queued", "failed"}:
        return job
    await update_job(session, job_id, status="running", progress=5, progress_label="Starting…")
    background_tasks.add_task(_run_cv_import, job_id, user.user_id, settings)
    return await get_job(session, job_id, user.user_id)


@router.get("/{job_id}")
async def get_cv_import_job(
    job_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    job = await get_job(session, job_id, user.user_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CV import job not found")
    activity_ids = (job.get("result") or {}).get("activity_ids") or []
    activities: list[dict[str, object]] = []
    if activity_ids:
        rows = await session.execute(
            text(
                """
                select id, category::text as category, title, organization, academic_year, status::text as status, confidence
                from public.academic_activities
                where owner_id = :owner_id and id = any(cast(:ids as uuid[]))
                order by created_at desc
                """
            ),
            {"owner_id": user.user_id, "ids": activity_ids},
        )
        activities = [dict(row) for row in rows.mappings().all()]
    return {**job, "activities": activities}
