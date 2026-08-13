"""USP 2 — Any Form Assistant: upload, analyze (detect + auto-fill), generate."""

from __future__ import annotations

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
from ..services.any_form import compute_coverage, detect_fields_xlsx, fill_workbook, resolve_field_with_llm
from ..services.jobs import create_job, get_job, update_job
from ..services.llm import LLMProvider
from .schemas import EvidenceUploadRequest, FormFieldPatch
from .utils import rows_to_dicts

router = APIRouter(prefix="/forms", tags=["forms"])

ALLOWED_FORM_MIME_TYPES = {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
MAX_FORM_BYTES = 10 * 1024 * 1024


def _safe_filename(file_name: str) -> str:
    name = PurePath(file_name.replace("\x00", "")).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not name:
        raise HTTPException(status_code=422, detail="file_name is invalid")
    return name[:180]


@router.post("/upload-url")
async def create_form_upload_url(
    payload: EvidenceUploadRequest,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    mime = payload.mime.lower().split(";", 1)[0].strip()
    if mime not in ALLOWED_FORM_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Only .xlsx forms are supported in this build")
    if payload.size > MAX_FORM_BYTES:
        raise HTTPException(status_code=413, detail="Form files must be 10 MB or smaller")
    job_id = await create_job(session, owner_id=user.user_id, kind="form_analyze")
    name = _safe_filename(payload.file_name)
    storage_path = f"{user.user_id}/forms/{job_id}/{name}"
    storage = StorageClient(settings)
    try:
        signed = await storage.create_signed_upload_url(settings.supabase_evidence_bucket, storage_path)
    except StorageError as exc:
        raise HTTPException(status_code=503, detail=f"Storage is unavailable: {exc}") from exc
    await session.execute(
        text(
            "insert into public.form_jobs (id, owner_id, job_id, kind, original_file_name, storage_path) "
            "values (:id, :owner_id, :job_id, 'analyze', :file_name, :storage_path)"
        ),
        {"id": job_id, "owner_id": user.user_id, "job_id": job_id, "file_name": name, "storage_path": storage_path},
    )
    await session.commit()
    return {"job_id": job_id, "storage_path": storage_path, "upload_url": signed["url"], "token": signed.get("token")}


async def _faculty_context(session: AsyncSession, owner_id: UUID) -> dict[str, object]:
    profile_result = await session.execute(
        text(
            """
            select p.full_name, p.email, p.phone, i.name as institution_name, d.name as department_name,
                   fp.employee_code, fp.designation, fp.date_joined, fp.current_academic_year, fp.orcid_id
            from public.profiles p
            left join public.institutions i on i.id = p.institution_id
            left join public.departments d on d.id = p.department_id
            left join public.faculty_profiles fp on fp.profile_id = p.id
            where p.id = :owner_id
            """
        ),
        {"owner_id": owner_id},
    )
    context = dict(profile_result.mappings().first() or {})
    counts_result = await session.execute(
        text("select category::text as category, count(*)::int as count from public.academic_activities where owner_id = :owner_id and status = 'confirmed' group by category"),
        {"owner_id": owner_id},
    )
    context["category_counts"] = {row["category"]: row["count"] for row in counts_result.mappings().all()}
    return context


async def _run_form_analysis(form_job_id: UUID, owner_id: UUID, settings: Settings) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        job_row = await session.execute(text("select job_id, storage_path from public.form_jobs where id = :id"), {"id": form_job_id})
        job = job_row.mappings().first()
        if job is None:
            return
        job_id = job["job_id"]
        await update_job(session, job_id, status="running", progress=15, progress_label="Reading spreadsheet…")
        storage = StorageClient(settings)
        try:
            info = await storage.object_info(settings.supabase_evidence_bucket, job["storage_path"])
            size = info.get("size") or info.get("metadata", {}).get("size")
            if size is not None and int(size) > MAX_FORM_BYTES:
                raise StorageError("File exceeds the maximum form size")
            content = await storage.download_object(settings.supabase_evidence_bucket, job["storage_path"])
        except StorageError as exc:
            await update_job(session, job_id, status="failed", error=f"Could not read uploaded file: {exc}")
            return
        detected = detect_fields_xlsx(content)
        await update_job(session, job_id, progress=45, progress_label=f"{len(detected)} fields detected; mapping to your record…")
        context = await _faculty_context(session, owner_id)
        llm = LLMProvider(settings)
        field_rows: list[dict[str, object]] = []
        for detected_field in detected:
            value, confidence, resolve_status = await resolve_field_with_llm(detected_field.label, context, llm)
            field_rows.append({
                "sheet": detected_field.sheet,
                "label": detected_field.label,
                "value_cell": detected_field.value_cell,
                "value": value,
                "confidence": confidence,
                "status": resolve_status,
            })
            await session.execute(
                text(
                    """
                    insert into public.form_fields (form_job_id, field_key, label, cell_ref, value, confidence, status, question)
                    values (:form_job_id, :field_key, :label, :cell_ref, :value, :confidence, :status, :question)
                    """
                ),
                {
                    "form_job_id": form_job_id,
                    "field_key": f"{detected_field.sheet}!{detected_field.value_cell}",
                    "label": detected_field.label,
                    "cell_ref": f"{detected_field.sheet}!{detected_field.value_cell}",
                    "value": str(value) if value is not None else None,
                    "confidence": confidence,
                    "status": resolve_status,
                    "question": None if resolve_status == "auto_filled" else f"What should be entered for \"{detected_field.label}\"?",
                },
            )
        coverage = compute_coverage(field_rows)
        await session.execute(
            text(
                "update public.form_jobs set fields_detected = :fd, fields_auto_filled = :fa, "
                "fields_needs_confirmation = :fc, fields_needs_new_info = :fn where id = :id"
            ),
            {
                "fd": coverage["fields_detected"], "fa": coverage["fields_auto_filled"],
                "fc": coverage["fields_needs_confirmation"], "fn": coverage["fields_needs_new_info"],
                "id": form_job_id,
            },
        )
        await session.commit()
        await update_job(session, job_id, status="completed", progress=100, progress_label="Ready for review", result=coverage)


@router.post("/{form_job_id}/analyze")
async def analyze_form(
    form_job_id: UUID,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    row = await session.execute(text("select job_id from public.form_jobs where id = :id and owner_id = :owner_id"), {"id": form_job_id, "owner_id": user.user_id})
    job_id = row.scalar_one_or_none()
    if job_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form job not found")
    background_tasks.add_task(_run_form_analysis, form_job_id, user.user_id, settings)
    return {"job_id": job_id, "status": "running"}


async def _form_detail(session: AsyncSession, form_job_id: UUID, owner_id: UUID) -> dict[str, object]:
    row = await session.execute(
        text(
            "select id, job_id, kind::text as kind, original_file_name, storage_path, output_storage_path, "
            "fields_detected, fields_auto_filled, fields_needs_confirmation, fields_needs_new_info, created_at, completed_at "
            "from public.form_jobs where id = :id and owner_id = :owner_id"
        ),
        {"id": form_job_id, "owner_id": owner_id},
    )
    form_job = row.mappings().first()
    if form_job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form job not found")
    payload = dict(form_job)
    payload["job"] = await get_job(session, form_job["job_id"], owner_id)
    fields = await session.execute(
        text("select id, label, cell_ref, value, confidence, status, question from public.form_fields where form_job_id = :id order by label"),
        {"id": form_job_id},
    )
    payload["fields"] = rows_to_dicts(fields.mappings().all())
    return payload


@router.get("/{form_job_id}")
async def get_form_job(form_job_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, object]:
    return await _form_detail(session, form_job_id, user.user_id)


@router.patch("/{form_job_id}/fields/{field_id}")
async def update_form_field(
    form_job_id: UUID,
    field_id: UUID,
    payload: FormFieldPatch,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    owned = await session.execute(text("select id from public.form_jobs where id = :id and owner_id = :owner_id"), {"id": form_job_id, "owner_id": user.user_id})
    if owned.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form job not found")
    result = await session.execute(
        text("update public.form_fields set value = :value, status = 'auto_filled', updated_at = now() where id = :id and form_job_id = :form_job_id"),
        {"value": payload.value, "id": field_id, "form_job_id": form_job_id},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form field not found")
    await session.commit()
    return await _form_detail(session, form_job_id, user.user_id)


async def _run_form_generate(form_job_id: UUID, owner_id: UUID, settings: Settings) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        form_row = await session.execute(
            text("select job_id, storage_path, original_file_name from public.form_jobs where id = :id and owner_id = :owner_id"),
            {"id": form_job_id, "owner_id": owner_id},
        )
        form_job = form_row.mappings().first()
        if form_job is None:
            return
        job_id = form_job["job_id"]
        await update_job(session, job_id, status="running", progress=20, progress_label="Filling your form…")
        storage = StorageClient(settings)
        try:
            content = await storage.download_object(settings.supabase_evidence_bucket, form_job["storage_path"])
        except StorageError as exc:
            await update_job(session, job_id, status="failed", error=f"Could not read the original file: {exc}")
            return
        fields_result = await session.execute(
            text("select cell_ref, value from public.form_fields where form_job_id = :id and value is not null"),
            {"id": form_job_id},
        )
        filled_fields = []
        for row in fields_result.mappings().all():
            sheet, _, cell = row["cell_ref"].partition("!")
            filled_fields.append({"sheet": sheet, "value_cell": cell, "value": row["value"]})
        try:
            output_content = fill_workbook(content, filled_fields)
        except (ValueError, KeyError) as exc:
            await update_job(session, job_id, status="failed", error=f"Could not generate the filled form: {exc}")
            return
        output_path = f"{owner_id}/forms/{form_job_id}/completed_{form_job['original_file_name']}"
        await storage.upload_bytes(
            settings.supabase_generated_bucket, output_path, output_content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        await session.execute(text("update public.form_jobs set output_storage_path = :path, completed_at = now() where id = :id"), {"path": output_path, "id": form_job_id})
        await session.execute(
            text("insert into public.generated_documents(owner_id, storage_path, file_name, mime_type) values (:owner_id, :path, :file_name, :mime_type)"),
            {"owner_id": owner_id, "path": output_path, "file_name": f"completed_{form_job['original_file_name']}", "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        )
        await session.commit()
        await update_job(session, job_id, status="completed", progress=100, progress_label="Your completed form is ready")


@router.post("/{form_job_id}/generate")
async def generate_form(
    form_job_id: UUID,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    owned = await session.execute(text("select job_id from public.form_jobs where id = :id and owner_id = :owner_id"), {"id": form_job_id, "owner_id": user.user_id})
    job_id = owned.scalar_one_or_none()
    if job_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form job not found")
    new_job_id = await create_job(session, owner_id=user.user_id, kind="form_generate")
    await session.execute(text("update public.form_jobs set job_id = :job_id, kind = 'generate' where id = :id"), {"job_id": new_job_id, "id": form_job_id})
    await session.commit()
    background_tasks.add_task(_run_form_generate, form_job_id, user.user_id, settings)
    return {"job_id": new_job_id, "status": "running"}


@router.get("/{form_job_id}/download")
async def download_generated_form(
    form_job_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    row = await session.execute(
        text("select output_storage_path from public.form_jobs where id = :id and owner_id = :owner_id"),
        {"id": form_job_id, "owner_id": user.user_id},
    )
    output_path = row.scalar_one_or_none()
    if not output_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generated form is not ready yet")
    try:
        signed_url = await StorageClient(settings).create_signed_download_url(settings.supabase_generated_bucket, output_path, settings.signed_url_ttl_seconds)
    except StorageError as exc:
        raise HTTPException(status_code=503, detail=f"Storage is unavailable: {exc}") from exc
    return {"url": signed_url, "expires_in": settings.signed_url_ttl_seconds}
