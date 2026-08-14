"""Private evidence library and signed Supabase Storage routes."""

from __future__ import annotations

import hashlib
import io
import logging
import re
import zipfile
from pathlib import PurePath
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import database, get_db
from ..core.storage import StorageClient, StorageError
from ..services.document_text import extract_text_with_ocr_fallback
from ..services.evidence_match import find_evidence_matches
from ..services.jobs import create_job, get_job, update_job
from ..services.llm import LLMProvider
from ..services.pagination import decode_cursor, page_result
from ..services.repository_classify import classify_document, extract_student_outcome
from ..services.sql import mapping_or_404
from .schemas import EvidenceAttachRequest, EvidenceBulkDownloadRequest, EvidenceClassificationConfirm, EvidenceUploadRequest

router = APIRouter(prefix="/evidence", tags=["evidence"])
logger = logging.getLogger(__name__)

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/jpeg",
    "image/png",
    "image/webp",
}


def _safe_filename(file_name: str) -> str:
    name = PurePath(file_name.replace("\x00", "")).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not name:
        raise HTTPException(status_code=422, detail="file_name is invalid")
    return name[:180]


async def _evidence(session: AsyncSession, evidence_id: UUID, owner_id: UUID) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select id, owner_id, storage_path, file_name, mime_type, size_bytes, sha256,
                   source::text as source, extracted_title, extracted_text_snippet, doc_date,
                   organization, tags, created_at, updated_at,
                   document_category::text as document_category, document_type,
                   classification_confidence, needs_confirmation, proposed_activity_id
            from public.evidence_files where id = :id and owner_id = :owner_id
            """
        ),
        {"id": evidence_id, "owner_id": owner_id},
    )
    return mapping_or_404(result, "Evidence file not found")


@router.post("/upload-url")
async def create_upload_url(
    payload: EvidenceUploadRequest,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    mime = payload.mime.lower().split(";", 1)[0].strip()
    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="File type is not allowed")
    name = _safe_filename(payload.file_name)
    evidence_id = uuid4()
    storage_path = f"{user.user_id}/{evidence_id}/{name}"
    storage = StorageClient(settings)
    try:
        signed = await storage.create_signed_upload_url(settings.supabase_evidence_bucket, storage_path)
    except StorageError as exc:
        raise HTTPException(status_code=503, detail=f"Storage is unavailable: {exc}") from exc
    await session.execute(
        text(
            """
            insert into public.evidence_files (id, owner_id, storage_path, file_name, mime_type, size_bytes, source)
            values (:id, :owner_id, :storage_path, :file_name, :mime_type, :size_bytes, 'upload')
            """
        ),
        {
            "id": evidence_id,
            "owner_id": user.user_id,
            "storage_path": storage_path,
            "file_name": name,
            "mime_type": mime,
            "size_bytes": payload.size,
        },
    )
    await session.commit()
    return {
        "evidence_id": evidence_id,
        "storage_path": storage_path,
        "upload_url": signed["url"],
        "token": signed.get("token"),
        "expires_in": settings.signed_url_ttl_seconds,
    }


@router.post("/{evidence_id}/finalize")
async def finalize_evidence(
    evidence_id: UUID,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    evidence = await _evidence(session, evidence_id, user.user_id)
    try:
        info = await StorageClient(settings).object_info(settings.supabase_evidence_bucket, evidence["storage_path"])
    except StorageError as exc:
        raise HTTPException(status_code=409, detail="Upload is not present in private storage") from exc
    size = info.get("size") or info.get("metadata", {}).get("size")
    if size is not None and int(size) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Stored file exceeds the 25 MB limit")
    if size is not None:
        await session.execute(
            text("update public.evidence_files set size_bytes = :size, updated_at = now() where id = :id and owner_id = :owner_id"),
            {"size": int(size), "id": evidence_id, "owner_id": user.user_id},
        )
        await session.commit()
    # Smart Academic Repository (product expansion §9): classification runs
    # automatically on every finalized upload, not behind a separate manual
    # step -- "upload once, the platform understands the document."
    job_id = await create_job(session, owner_id=user.user_id, kind="evidence_classify")
    background_tasks.add_task(_run_classification, evidence_id, job_id, user.user_id, settings)
    result = await _evidence(session, evidence_id, user.user_id)
    result["classification_job_id"] = job_id
    return result


async def _run_classification(evidence_id: UUID, job_id: UUID, owner_id: UUID, settings: Settings) -> None:
    """Deterministic-first document classification + activity/student-outcome
    matching (product expansion §9-15). Never reprocesses on its own -- this
    only runs once per finalize, matching the source-signal layer's
    never-reprocess-unchanged principle at the endpoint-trigger level rather
    than a persisted hash, since a finalized evidence file's bytes are
    immutable (re-uploading creates a new evidence_id)."""

    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        await update_job(session, job_id, status="running", progress=10, progress_label="Reading document…")
        row = await session.execute(
            text("select storage_path, file_name, mime_type from public.evidence_files where id = :id and owner_id = :owner_id"),
            {"id": evidence_id, "owner_id": owner_id},
        )
        record = row.mappings().first()
        if record is None:
            await update_job(session, job_id, status="failed", error="Evidence file no longer exists")
            return
        try:
            content = await StorageClient(settings).download_object(settings.supabase_evidence_bucket, record["storage_path"])
        except StorageError as exc:
            await update_job(session, job_id, status="failed", error=f"Could not read stored file: {exc}")
            return
        sha256 = hashlib.sha256(content).hexdigest()
        # Duplicate detection (§9): a file with byte-identical content already
        # on record for this owner is flagged, never silently re-classified
        # as if it were new evidence.
        duplicate = await session.execute(
            text("select id, file_name from public.evidence_files where owner_id = :owner_id and sha256 = :sha256 and id <> :id"),
            {"owner_id": owner_id, "sha256": sha256, "id": evidence_id},
        )
        duplicate_row = duplicate.mappings().first()

        await update_job(session, job_id, progress=35, progress_label="Extracting text…")
        llm = LLMProvider(settings)
        extracted_text = await extract_text_with_ocr_fallback(content, record["mime_type"], llm)

        await update_job(session, job_id, progress=60, progress_label="Classifying…")
        classification = await classify_document(record["file_name"], extracted_text, llm)

        await session.execute(
            text(
                """
                update public.evidence_files set
                    sha256 = :sha256,
                    document_category = cast(:document_category as document_category),
                    document_type = :document_type,
                    classification_confidence = :confidence,
                    needs_confirmation = :needs_confirmation,
                    extracted_text_snippet = :snippet,
                    extracted_text_full = :full_text,
                    updated_at = now()
                where id = :id and owner_id = :owner_id
                """
            ),
            {
                "sha256": sha256,
                "document_category": classification.document_category,
                "document_type": classification.document_type,
                "confidence": classification.confidence,
                "needs_confirmation": classification.needs_confirmation,
                "snippet": extracted_text[:500] or None,
                "full_text": extracted_text or None,
                "id": evidence_id,
                "owner_id": owner_id,
            },
        )

        # Activity matching (§12): only ever a suggestion, never auto-attached.
        proposed_activity_id = None
        pending_result = await session.execute(
            text("select id, title, organization from public.academic_activities where owner_id = :owner_id and evidence_status = 'pending' and status <> 'archived'"),
            {"owner_id": owner_id},
        )
        pending_activities = [dict(row) for row in pending_result.mappings().all()]
        evidence_for_match = {"file_name": record["file_name"], "extracted_title": classification.document_type, "organization": None}
        matches = find_evidence_matches(evidence_for_match, pending_activities)
        if matches and matches[0]["score"] >= 0.4:
            proposed_activity_id = matches[0]["activity"]["id"]
            await session.execute(
                text("update public.evidence_files set proposed_activity_id = :activity_id where id = :id"),
                {"activity_id": proposed_activity_id, "id": evidence_id},
            )

        # Student Outcome Intelligence (§15-17): only proposed when the
        # extracted student name matches an existing student_records row this
        # faculty is linked to -- never invents a student.
        student_outcome_created = False
        await update_job(session, job_id, progress=80, progress_label="Checking for student outcomes…")
        outcome = await extract_student_outcome(record["file_name"], extracted_text, llm)
        if outcome and outcome.get("student_name"):
            student_match = await session.execute(
                text(
                    """
                    select sr.id from public.student_records sr
                    join public.faculty_student_links l on l.student_id = sr.id and l.faculty_id = :faculty_id
                    where sr.full_name ilike :name
                    limit 1
                    """
                ),
                {"faculty_id": owner_id, "name": f"%{outcome['student_name']}%"},
            )
            student_id = student_match.scalar_one_or_none()
            if student_id is not None:
                await session.execute(
                    text(
                        """
                        insert into public.student_outcomes
                            (student_id, evidence_id, company, role, outcome_type, offer_date, start_date, end_date, confidence, created_by)
                        values
                            (:student_id, :evidence_id, :company, :role, cast(:outcome_type as outcome_type), :offer_date, :start_date, :end_date, :confidence, :created_by)
                        """
                    ),
                    {
                        "student_id": student_id,
                        "evidence_id": evidence_id,
                        "company": outcome.get("company"),
                        "role": outcome.get("role"),
                        "outcome_type": outcome.get("outcome_type", "other"),
                        "offer_date": outcome.get("offer_date"),
                        "start_date": outcome.get("start_date"),
                        "end_date": outcome.get("end_date"),
                        "confidence": outcome.get("confidence"),
                        "created_by": owner_id,
                    },
                )
                student_outcome_created = True

        await session.commit()
        await update_job(
            session, job_id, status="completed", progress=100,
            progress_label="Classification complete",
            result={
                "document_category": classification.document_category,
                "document_type": classification.document_type,
                "needs_confirmation": classification.needs_confirmation,
                "proposed_activity_id": str(proposed_activity_id) if proposed_activity_id else None,
                "duplicate_of": {"id": str(duplicate_row["id"]), "file_name": duplicate_row["file_name"]} if duplicate_row else None,
                "student_outcome_created": student_outcome_created,
            },
        )


@router.get("")
async def list_evidence(
    q: str | None = Query(default=None, max_length=200),
    year: int | None = Query(default=None, ge=1900, le=2200),
    mime_group: str | None = Query(default=None, max_length=40),
    tag: str | None = Query(default=None, max_length=100),
    activity_id: UUID | None = None,
    org: str | None = Query(default=None, max_length=200),
    document_category: str | None = Query(default=None, max_length=60),
    document_type: str | None = Query(default=None, max_length=120),
    needs_confirmation: bool | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = None,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clauses = ["ef.owner_id = :owner_id"]
    params: dict[str, Any] = {"owner_id": user.user_id, "limit": limit + 1}
    if q:
        clauses.append("(ef.file_name ilike :query or coalesce(ef.extracted_title, '') ilike :query or coalesce(ef.organization, '') ilike :query)")
        params["query"] = f"%{q}%"
    if year:
        clauses.append("extract(year from ef.doc_date) = :year")
        params["year"] = year
    if mime_group:
        clauses.append("ef.mime_type ilike :mime_group")
        params["mime_group"] = f"{mime_group}%"
    if tag:
        clauses.append(":tag = any(ef.tags)")
        params["tag"] = tag
    if activity_id:
        clauses.append("exists (select 1 from public.activity_evidence ae where ae.evidence_id = ef.id and ae.activity_id = :activity_id)")
        params["activity_id"] = activity_id
    if org:
        clauses.append("ef.organization ilike :org")
        params["org"] = f"%{org}%"
    if document_category:
        clauses.append("ef.document_category = cast(:document_category as document_category)")
        params["document_category"] = document_category
    if document_type:
        clauses.append("ef.document_type = :document_type")
        params["document_type"] = document_type
    if needs_confirmation is not None:
        clauses.append("ef.needs_confirmation = :needs_confirmation")
        params["needs_confirmation"] = needs_confirmation
    decoded = decode_cursor(cursor)
    if decoded:
        clauses.append("(ef.created_at, ef.id) < (:cursor_created_at, :cursor_id)")
        params["cursor_created_at"] = decoded.get("created_at")
        params["cursor_id"] = decoded["id"]
    result = await session.execute(
        text(
            """
            select ef.id, ef.owner_id, ef.storage_path, ef.file_name, ef.mime_type,
                   ef.size_bytes, ef.source::text as source, ef.extracted_title,
                   ef.extracted_text_snippet, ef.doc_date, ef.organization, ef.tags,
                   ef.created_at, ef.updated_at,
                   ef.document_category::text as document_category, ef.document_type,
                   ef.classification_confidence, ef.needs_confirmation, ef.proposed_activity_id
            from public.evidence_files ef
            where """
            + " and ".join(clauses)
            + " order by ef.created_at desc, ef.id desc limit :limit"
        ),
        params,
    )
    return page_result([dict(row) for row in result.mappings().all()], limit)


@router.post("/{evidence_id}/attach")
async def attach_evidence(
    evidence_id: UUID,
    payload: EvidenceAttachRequest,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await _evidence(session, evidence_id, user.user_id)
    activity = await session.execute(
        text("select id from public.academic_activities where id = :activity_id and owner_id = :owner_id and status <> 'archived'"),
        {"activity_id": payload.activity_id, "owner_id": user.user_id},
    )
    if activity.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    approved = await session.execute(
        text(
            """
            select exists(
              select 1 from public.appraisal_submission_items i
              join public.appraisal_submissions s on s.id = i.submission_id
              where i.activity_id = :activity_id and s.profile_id = :owner_id and s.status = 'approved'
            )
            """
        ),
        {"activity_id": payload.activity_id, "owner_id": user.user_id},
    )
    if approved.scalar():
        raise HTTPException(status_code=409, detail="Evidence for an approved appraisal cannot be changed")
    await session.execute(
        text("insert into public.activity_evidence (activity_id, evidence_id) values (:activity_id, :evidence_id) on conflict do nothing"),
        {"activity_id": payload.activity_id, "evidence_id": evidence_id},
    )
    await session.execute(
        text("update public.academic_activities set evidence_status = 'attached', updated_at = now() where id = :activity_id and owner_id = :owner_id"),
        {"activity_id": payload.activity_id, "owner_id": user.user_id},
    )
    await session.commit()
    return {"ok": True}


@router.delete("/{evidence_id}/attach/{activity_id}")
async def detach_evidence(
    evidence_id: UUID,
    activity_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await _evidence(session, evidence_id, user.user_id)
    approved = await session.execute(
        text(
            """
            select exists(
              select 1 from public.appraisal_submission_items i
              join public.appraisal_submissions s on s.id = i.submission_id
              where i.activity_id = :activity_id and s.profile_id = :owner_id and s.status = 'approved'
            )
            """
        ),
        {"activity_id": activity_id, "owner_id": user.user_id},
    )
    if approved.scalar():
        raise HTTPException(status_code=409, detail="Evidence for an approved appraisal cannot be changed")
    result = await session.execute(
        text(
            "delete from public.activity_evidence ae using public.academic_activities a "
            "where ae.activity_id = a.id and ae.activity_id = :activity_id and ae.evidence_id = :evidence_id and a.owner_id = :owner_id"
        ),
        {"activity_id": activity_id, "evidence_id": evidence_id, "owner_id": user.user_id},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Evidence attachment not found")
    await session.execute(
        text(
            "update public.academic_activities a set evidence_status = case when exists (select 1 from public.activity_evidence ae where ae.activity_id = a.id) then 'attached' else 'pending' end, updated_at = now() "
            "where a.id = :activity_id and a.owner_id = :owner_id"
        ),
        {"activity_id": activity_id, "owner_id": user.user_id},
    )
    await session.commit()
    return {"ok": True}


@router.get("/{evidence_id}/matches")
async def evidence_pending_matches(
    evidence_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """USP 4 (Proof Later): suggest which evidence-pending activities this file likely proves."""

    evidence = await _evidence(session, evidence_id, user.user_id)
    pending_result = await session.execute(
        text(
            "select id, title, organization from public.academic_activities "
            "where owner_id = :owner_id and evidence_status = 'pending' and status <> 'archived'"
        ),
        {"owner_id": user.user_id},
    )
    pending_activities = [dict(row) for row in pending_result.mappings().all()]
    matches = find_evidence_matches(evidence, pending_activities)
    for match in matches:
        match["activity"]["id"] = str(match["activity"]["id"])
    return {"items": matches}


@router.get("/classification-jobs/{job_id}")
async def get_classification_job(job_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    job = await get_job(session, job_id, user.user_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


@router.post("/{evidence_id}/confirm-classification")
async def confirm_classification(
    evidence_id: UUID,
    payload: EvidenceClassificationConfirm,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Faculty confirms or corrects an automatic classification (§9: 'human
    confirmation when uncertain'). Always clears needs_confirmation, whether
    the machine's guess was accepted as-is or corrected."""

    await _evidence(session, evidence_id, user.user_id)
    if payload.document_category is not None and payload.document_category not in {
        "research", "teaching", "professional_development", "academic_service", "student_mentorship", "administration", "other",
    }:
        raise HTTPException(status_code=422, detail="Unknown document_category")
    assignments = ["needs_confirmation = false", "updated_at = now()"]
    params: dict[str, Any] = {"id": evidence_id, "owner_id": user.user_id}
    if payload.document_category is not None:
        assignments.append("document_category = cast(:document_category as document_category)")
        params["document_category"] = payload.document_category
    if payload.document_type is not None:
        assignments.append("document_type = :document_type")
        params["document_type"] = payload.document_type
    await session.execute(
        text(f"update public.evidence_files set {', '.join(assignments)} where id = :id and owner_id = :owner_id"),
        params,
    )
    await session.commit()
    return await _evidence(session, evidence_id, user.user_id)


@router.post("/bulk-download")
async def start_bulk_download(
    payload: EvidenceBulkDownloadRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """§14: bulk ZIP export (by explicit selection, category, or year), built
    asynchronously with a manifest.csv, reusing the shared background_jobs
    envelope rather than a bespoke export mechanism."""

    job_id = await create_job(session, owner_id=user.user_id, kind="evidence_bulk_zip")
    background_tasks.add_task(
        _run_bulk_download,
        job_id,
        user.user_id,
        settings,
        payload.evidence_ids,
        payload.document_category,
        payload.year,
        payload.tag,
    )
    return {"job_id": job_id, "status": "queued"}


async def _run_bulk_download(
    job_id: UUID,
    owner_id: UUID,
    settings: Settings,
    evidence_ids: list[UUID] | None,
    document_category: str | None,
    year: int | None,
    tag: str | None,
) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        await update_job(session, job_id, status="running", progress=5, progress_label="Finding matching files…")
        clauses = ["owner_id = :owner_id"]
        params: dict[str, Any] = {"owner_id": owner_id}
        if evidence_ids:
            clauses.append("id = any(cast(:ids as uuid[]))")
            params["ids"] = [str(i) for i in evidence_ids]
        if document_category:
            clauses.append("document_category = cast(:document_category as document_category)")
            params["document_category"] = document_category
        if year:
            clauses.append("extract(year from doc_date) = :year")
            params["year"] = year
        if tag:
            clauses.append(":tag = any(tags)")
            params["tag"] = tag
        result = await session.execute(
            text(f"select id, storage_path, file_name, document_category::text as document_category, document_type, doc_date from public.evidence_files where {' and '.join(clauses)}"),
            params,
        )
        files = [dict(row) for row in result.mappings().all()]
        if not files:
            await update_job(session, job_id, status="failed", error="No matching evidence files found")
            return

        storage = StorageClient(settings)
        buffer = io.BytesIO()
        manifest_rows = ["file_name,document_category,document_type,doc_date"]
        used_names: set[str] = set()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            for index, file_row in enumerate(files):
                await update_job(session, job_id, progress=5 + int(85 * index / len(files)), progress_label=f"Adding {file_row['file_name']}…")
                try:
                    content = await storage.download_object(settings.supabase_evidence_bucket, file_row["storage_path"])
                except StorageError:
                    logger.warning("bulk_download_skip_unreadable_object", extra={"evidence_id": str(file_row["id"])})
                    continue
                archive_name = file_row["file_name"]
                suffix = 1
                while archive_name in used_names:
                    stem = PurePath(file_row["file_name"]).stem
                    ext = PurePath(file_row["file_name"]).suffix
                    archive_name = f"{stem}_{suffix}{ext}"
                    suffix += 1
                used_names.add(archive_name)
                archive.writestr(archive_name, content)
                manifest_rows.append(
                    f"{archive_name},{file_row.get('document_category') or ''},{file_row.get('document_type') or ''},{file_row.get('doc_date') or ''}"
                )
            archive.writestr("manifest.csv", "\n".join(manifest_rows))

        await update_job(session, job_id, progress=95, progress_label="Uploading archive…")
        path = f"{owner_id}/exports/{job_id}.zip"
        try:
            await storage.upload_bytes(settings.supabase_generated_bucket, path, buffer.getvalue(), content_type="application/zip")
        except StorageError as exc:
            await update_job(session, job_id, status="failed", error=f"Could not store archive: {exc}")
            return
        signed_url = await storage.create_signed_download_url(settings.supabase_generated_bucket, path, settings.signed_url_ttl_seconds)
        await session.execute(
            text("insert into public.generated_documents(owner_id, storage_path, file_name) values (:owner_id, :storage_path, :file_name)"),
            {"owner_id": owner_id, "storage_path": path, "file_name": f"evidence_export_{job_id}.zip"},
        )
        await session.commit()
        await update_job(
            session, job_id, status="completed", progress=100,
            progress_label=f"{len(files)} file(s) archived",
            result={"storage_path": path, "download_url": signed_url, "file_count": len(files)},
        )


@router.get("/{evidence_id}/download")
async def download_evidence(
    evidence_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    evidence = await _evidence(session, evidence_id, user.user_id)
    try:
        signed_url = await StorageClient(settings).create_signed_download_url(
            settings.supabase_evidence_bucket,
            evidence["storage_path"],
            settings.signed_url_ttl_seconds,
        )
    except StorageError as exc:
        raise HTTPException(status_code=503, detail=f"Storage is unavailable: {exc}") from exc
    return {"url": signed_url, "expires_in": settings.signed_url_ttl_seconds}


@router.delete("/{evidence_id}")
async def delete_evidence(
    evidence_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, bool]:
    evidence = await _evidence(session, evidence_id, user.user_id)
    affected = await session.execute(
        text(
            """
            select ae.activity_id
            from public.activity_evidence ae
            join public.appraisal_submission_items i on i.activity_id = ae.activity_id
            join public.appraisal_submissions s on s.id = i.submission_id
            where ae.evidence_id = :evidence_id and s.profile_id = :owner_id and s.status = 'approved'
            """
        ),
        {"evidence_id": evidence_id, "owner_id": user.user_id},
    )
    if affected.first() is not None:
        raise HTTPException(status_code=409, detail="Evidence for an approved appraisal cannot be changed")
    activity_rows = await session.execute(
        text("select activity_id from public.activity_evidence where evidence_id = :evidence_id"),
        {"evidence_id": evidence_id},
    )
    activity_ids = [row[0] for row in activity_rows.all()]
    try:
        await StorageClient(settings).delete_object(settings.supabase_evidence_bucket, evidence["storage_path"])
    except StorageError as exc:
        # A failed client upload can leave only the metadata row behind. A
        # missing object is already in the desired final state, so clean the
        # row while still surfacing real storage outages.
        if "404" not in str(exc):
            raise HTTPException(status_code=502, detail=f"Storage could not delete the evidence file: {exc}") from exc
    await session.execute(
        text("delete from public.evidence_files where id = :id and owner_id = :owner_id"),
        {"id": evidence_id, "owner_id": user.user_id},
    )
    if activity_ids:
        await session.execute(
            text(
                """
                update public.academic_activities a
                set evidence_status = case when exists (
                  select 1 from public.activity_evidence ae where ae.activity_id = a.id
                ) then 'attached' else 'pending' end,
                updated_at = now()
                where a.id = any(cast(:activity_ids as uuid[])) and a.owner_id = :owner_id
                """
            ),
            {"activity_ids": [str(activity_id) for activity_id in activity_ids], "owner_id": user.user_id},
        )
    await session.commit()
    return {"ok": True}
