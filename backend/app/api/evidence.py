"""Private evidence library and signed Supabase Storage routes."""

from __future__ import annotations

import re
from datetime import date
from pathlib import PurePath
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..core.storage import StorageClient, StorageError
from ..services.evidence_match import find_evidence_matches
from ..services.pagination import decode_cursor, page_result
from ..services.sql import mapping_or_404
from .schemas import EvidenceAttachRequest, EvidenceUploadRequest

router = APIRouter(prefix="/evidence", tags=["evidence"])

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
                   organization, tags, created_at, updated_at
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
    # Extraction/embedding workers can enrich these nullable fields later, but
    # finalization itself only succeeds for a real object in Supabase Storage.
    if size is not None:
        await session.execute(
            text("update public.evidence_files set size_bytes = :size, updated_at = now() where id = :id and owner_id = :owner_id"),
            {"size": int(size), "id": evidence_id, "owner_id": user.user_id},
        )
        await session.commit()
    return await _evidence(session, evidence_id, user.user_id)


@router.get("")
async def list_evidence(
    q: str | None = Query(default=None, max_length=200),
    year: int | None = Query(default=None, ge=1900, le=2200),
    mime_group: str | None = Query(default=None, max_length=40),
    tag: str | None = Query(default=None, max_length=100),
    activity_id: UUID | None = None,
    org: str | None = Query(default=None, max_length=200),
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
                   ef.created_at, ef.updated_at
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
