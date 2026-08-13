"""USP 7 — Teaching Change Detector: snapshot courses, compare, review, approve."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from pathlib import PurePath
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.academic_year import derive_academic_year
from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import database, get_db
from ..core.storage import StorageClient, StorageError
from ..services.document_text import extract_text
from ..services.jobs import create_job, get_job, update_job
from ..services.llm import LLMProvider
from ..services.teaching_change import SnapshotFile, diff_snapshots, has_meaningful_changes, summarize_changes
from .schemas import CourseSnapshotCreate, TeachingCompareRequest
from .utils import rows_to_dicts

router = APIRouter(prefix="/teaching", tags=["teaching-change"])

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
}
MAX_COURSE_FILE_BYTES = 15 * 1024 * 1024


def _safe_filename(file_name: str) -> str:
    name = PurePath(file_name.replace("\x00", "")).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not name:
        raise HTTPException(status_code=422, detail="file_name is invalid")
    return name[:180]


@router.post("/snapshots")
async def create_snapshot(payload: CourseSnapshotCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    result = await session.execute(
        text("insert into public.course_snapshots (owner_id, course_title, academic_year) values (:owner_id, :course_title, :academic_year) returning id, course_title, academic_year, created_at"),
        {"owner_id": user.user_id, "course_title": payload.course_title, "academic_year": payload.academic_year},
    )
    row = result.mappings().first()
    await session.commit()
    return dict(row)


@router.get("/snapshots")
async def list_snapshots(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    result = await session.execute(
        text(
            """
            select s.id, s.course_title, s.academic_year, s.created_at, count(f.id)::int as file_count
            from public.course_snapshots s left join public.course_files f on f.snapshot_id = s.id
            where s.owner_id = :owner_id group by s.id order by s.created_at desc
            """
        ),
        {"owner_id": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.post("/snapshots/{snapshot_id}/files/upload-url")
async def create_course_file_upload_url(
    snapshot_id: UUID,
    file_name: str,
    mime: str,
    size: int,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    owned = await session.execute(text("select id from public.course_snapshots where id = :id and owner_id = :owner_id"), {"id": snapshot_id, "owner_id": user.user_id})
    if owned.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course snapshot not found")
    mime = mime.lower().split(";", 1)[0].strip()
    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Upload PDF, DOCX, PPTX or plain text course material")
    if size > MAX_COURSE_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Course files must be 15 MB or smaller")
    name = _safe_filename(file_name)
    storage_path = f"{user.user_id}/course-snapshots/{snapshot_id}/{name}"
    storage = StorageClient(settings)
    try:
        signed = await storage.create_signed_upload_url(settings.supabase_evidence_bucket, storage_path)
    except StorageError as exc:
        raise HTTPException(status_code=503, detail=f"Storage is unavailable: {exc}") from exc
    return {"storage_path": storage_path, "upload_url": signed["url"], "token": signed.get("token"), "mime_type": mime}


@router.post("/snapshots/{snapshot_id}/files/finalize")
async def finalize_course_file(
    snapshot_id: UUID,
    file_name: str,
    storage_path: str,
    mime_type: str,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    owned = await session.execute(text("select id from public.course_snapshots where id = :id and owner_id = :owner_id"), {"id": snapshot_id, "owner_id": user.user_id})
    if owned.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course snapshot not found")
    if not storage_path.startswith(f"{user.user_id}/course-snapshots/{snapshot_id}/"):
        raise HTTPException(status_code=422, detail="storage_path does not belong to this snapshot")
    storage = StorageClient(settings)
    try:
        content = await storage.download_object(settings.supabase_evidence_bucket, storage_path)
    except StorageError as exc:
        raise HTTPException(status_code=409, detail=f"Upload is not present in private storage: {exc}") from exc
    sha256 = hashlib.sha256(content).hexdigest()
    extracted = extract_text(content, mime_type)
    result = await session.execute(
        text(
            "insert into public.course_files (snapshot_id, file_name, storage_path, sha256, extracted_text) "
            "values (:snapshot_id, :file_name, :storage_path, :sha256, :extracted_text) returning id"
        ),
        {"snapshot_id": snapshot_id, "file_name": _safe_filename(file_name), "storage_path": storage_path, "sha256": sha256, "extracted_text": extracted},
    )
    file_id = result.scalar_one()
    await session.commit()
    return {"id": file_id, "file_name": file_name, "sha256": sha256}


async def _load_snapshot_files(session: AsyncSession, snapshot_id: UUID) -> list[SnapshotFile]:
    result = await session.execute(text("select file_name, sha256, extracted_text from public.course_files where snapshot_id = :snapshot_id"), {"snapshot_id": snapshot_id})
    return [SnapshotFile(row["file_name"], row["sha256"], row["extracted_text"]) for row in result.mappings().all()]


async def _run_teaching_compare(run_id: UUID, owner_id: UUID, snapshot_a_id: UUID, snapshot_b_id: UUID, settings: Settings) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        job_id = await create_job(session, owner_id=owner_id, kind="teaching_compare")
        await session.execute(text("update public.teaching_change_runs set job_id = :job_id where id = :id"), {"job_id": job_id, "id": run_id})
        await session.commit()
        await update_job(session, job_id, status="running", progress=20, progress_label="Comparing course materials…")
        files_a = await _load_snapshot_files(session, snapshot_a_id)
        files_b = await _load_snapshot_files(session, snapshot_b_id)
        diff = diff_snapshots(files_a, files_b)
        if not has_meaningful_changes(diff):
            await session.execute(text("update public.teaching_change_runs set completed_at = now() where id = :id"), {"id": run_id})
            await session.commit()
            await update_job(session, job_id, status="completed", progress=100, progress_label="No meaningful changes detected", result={"change_count": 0})
            return
        await update_job(session, job_id, progress=60, progress_label="Interpreting the detected changes…")
        changes = await summarize_changes(diff, LLMProvider(settings))
        for change in changes:
            await session.execute(
                text(
                    "insert into public.teaching_changes (run_id, owner_id, change_type, description, evidence) "
                    "values (:run_id, :owner_id, :change_type, :description, cast(:evidence as jsonb))"
                ),
                {"run_id": run_id, "owner_id": owner_id, "change_type": change["change_type"], "description": change["description"], "evidence": json.dumps(diff)},
            )
        await session.execute(text("update public.teaching_change_runs set completed_at = now() where id = :id"), {"id": run_id})
        await session.commit()
        await update_job(session, job_id, status="completed", progress=100, progress_label=f"{len(changes)} changes detected", result={"change_count": len(changes)})


@router.post("/compare")
async def compare_snapshots(
    payload: TeachingCompareRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    for snapshot_id in (payload.snapshot_a_id, payload.snapshot_b_id):
        owned = await session.execute(text("select id from public.course_snapshots where id = :id and owner_id = :owner_id"), {"id": snapshot_id, "owner_id": user.user_id})
        if owned.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course snapshot not found")
    run_result = await session.execute(
        text("insert into public.teaching_change_runs (owner_id, snapshot_a_id, snapshot_b_id) values (:owner_id, :a, :b) returning id"),
        {"owner_id": user.user_id, "a": payload.snapshot_a_id, "b": payload.snapshot_b_id},
    )
    run_id = run_result.scalar_one()
    await session.commit()
    background_tasks.add_task(_run_teaching_compare, run_id, user.user_id, payload.snapshot_a_id, payload.snapshot_b_id, settings)
    return {"run_id": run_id, "status": "queued"}


@router.get("/runs/{run_id}")
async def get_teaching_run(run_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    result = await session.execute(
        text("select id, job_id, snapshot_a_id, snapshot_b_id, created_at, completed_at from public.teaching_change_runs where id = :id and owner_id = :owner_id"),
        {"id": run_id, "owner_id": user.user_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teaching change run not found")
    payload = dict(row)
    if row["job_id"]:
        payload["job"] = await get_job(session, row["job_id"], user.user_id)
    changes = await session.execute(
        text("select id, change_type, description, status::text as status, activity_id from public.teaching_changes where run_id = :run_id order by created_at"),
        {"run_id": run_id},
    )
    payload["changes"] = rows_to_dicts(changes.mappings().all())
    return payload


@router.post("/changes/{change_id}/approve")
async def approve_teaching_change(change_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    result = await session.execute(
        text("select id, run_id, description, status::text as status from public.teaching_changes where id = :id and owner_id = :owner_id"),
        {"id": change_id, "owner_id": user.user_id},
    )
    change = result.mappings().first()
    if change is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teaching change not found")
    if change["status"] != "proposed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Change is already {change['status']}")
    today_year = derive_academic_year(date.today())
    activity_result = await session.execute(
        text(
            "insert into public.academic_activities (owner_id, category, title, academic_year, status, source, confidence, confirmed_at) "
            "values (:owner_id, 'teaching', :title, :academic_year, 'confirmed', 'teaching_change', 0.85, now()) returning id"
        ),
        {"owner_id": user.user_id, "title": change["description"], "academic_year": today_year},
    )
    activity_id = activity_result.scalar_one()
    await session.execute(text("update public.teaching_changes set status = 'approved', activity_id = :activity_id, updated_at = now() where id = :id"), {"activity_id": activity_id, "id": change_id})
    await session.commit()
    return {"activity_id": activity_id, "change_id": change_id}


@router.post("/changes/{change_id}/dismiss")
async def dismiss_teaching_change(change_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    result = await session.execute(text("update public.teaching_changes set status = 'dismissed', updated_at = now() where id = :id and owner_id = :owner_id and status = 'proposed'"), {"id": change_id, "owner_id": user.user_id})
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teaching change not found or already reviewed")
    await session.commit()
    return {"ok": True}
