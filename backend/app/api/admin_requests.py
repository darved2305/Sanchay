"""USP 6 — Admin Request Autopilot + Department Reports.

Two modes, one page in the spec: "Respond to External Request" (upload a
university's request Excel, fill one row per matched faculty member using
the same field resolver as Any Form) and "Generate Department Report"
(stateless aggregate query -> PDF, no upload needed).
"""

from __future__ import annotations

import io
import re
from datetime import UTC, datetime
from pathlib import PurePath
from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_admin
from ..core.config import Settings, get_settings
from ..core.db import database, get_db
from ..core.storage import StorageClient, StorageError
from .forms import _faculty_context
from ..services.admin_request import build_multi_faculty_output, detect_header_row, resolve_row_for_faculty, summarize_gaps
from ..services.jobs import create_job, update_job
from .schemas import AdminRequestProcessRequest, DepartmentReportRequest, EvidenceUploadRequest
from .utils import institution_id_or_403, rows_to_dicts

router = APIRouter(prefix="/admin/requests", tags=["admin-requests"])
reports_router = APIRouter(prefix="/admin/reports", tags=["admin-requests"])

ALLOWED_MIME_TYPES = {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
MAX_REQUEST_BYTES = 10 * 1024 * 1024


def _safe_filename(file_name: str) -> str:
    name = PurePath(file_name.replace("\x00", "")).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not name:
        raise HTTPException(status_code=422, detail="file_name is invalid")
    return name[:180]


@router.post("/upload-url")
async def create_request_upload_url(
    payload: EvidenceUploadRequest,
    user: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    mime = payload.mime.lower().split(";", 1)[0].strip()
    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Upload the request as an .xlsx file")
    if payload.size > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail="Request files must be 10 MB or smaller")
    institution_id = institution_id_or_403(user)
    request_result = await session.execute(
        text(
            "insert into public.admin_requests (institution_id, created_by, original_file_name, storage_path) "
            "values (:institution_id, :created_by, :file_name, '') returning id"
        ),
        {"institution_id": institution_id, "created_by": user.user_id, "file_name": _safe_filename(payload.file_name)},
    )
    request_id = request_result.scalar_one()
    name = _safe_filename(payload.file_name)
    storage_path = f"admin/{institution_id}/requests/{request_id}/{name}"
    storage = StorageClient(settings)
    try:
        signed = await storage.create_signed_upload_url(settings.supabase_evidence_bucket, storage_path)
    except StorageError as exc:
        await session.rollback()
        raise HTTPException(status_code=503, detail=f"Storage is unavailable: {exc}") from exc
    await session.execute(text("update public.admin_requests set storage_path = :path where id = :id"), {"path": storage_path, "id": request_id})
    await session.commit()
    return {"request_id": request_id, "storage_path": storage_path, "upload_url": signed["url"], "token": signed.get("token")}


async def _run_request_processing(request_id: UUID, institution_id: UUID, admin_user_id: UUID, department: str | None, academic_year: str | None, settings: Settings) -> None:
    database.configure(settings)
    if database.session_factory is None:
        return
    async with database.session_factory() as session:
        # background_jobs.owner_id is a profiles FK, so the job belongs to the
        # requesting admin -- an institution_id is never a valid profile id.
        job_id = await create_job(session, owner_id=admin_user_id, kind="admin_request")
        await session.execute(text("update public.admin_requests set job_id = :job_id where id = :id"), {"job_id": job_id, "id": request_id})
        await session.commit()
        await update_job(session, job_id, status="running", progress=10, progress_label="Reading the request…")
        row = await session.execute(text("select storage_path from public.admin_requests where id = :id"), {"id": request_id})
        storage_path = row.scalar_one_or_none()
        if not storage_path:
            await update_job(session, job_id, status="failed", error="Upload is missing")
            return
        storage = StorageClient(settings)
        try:
            content = await storage.download_object(settings.supabase_evidence_bucket, storage_path)
        except StorageError as exc:
            await update_job(session, job_id, status="failed", error=f"Could not read the uploaded file: {exc}")
            return
        header = detect_header_row(content)
        if header is None:
            await update_job(session, job_id, status="failed", error="No table header row was found in this file")
            return
        header_row_index, labels, columns = header
        await update_job(session, job_id, progress=35, progress_label=f"{len(labels)} columns detected; finding matching faculty…")

        clauses = ["p.institution_id = :institution_id", "p.role = 'faculty'"]
        params: dict[str, Any] = {"institution_id": institution_id}
        if department:
            clauses.append("d.name = :department")
            params["department"] = department
        if academic_year:
            clauses.append("coalesce(fp.current_academic_year, '') = :academic_year")
            params["academic_year"] = academic_year
        faculty_result = await session.execute(
            text(
                f"""
                select p.id from public.profiles p
                left join public.departments d on d.id = p.department_id
                left join public.faculty_profiles fp on fp.profile_id = p.id
                where {' and '.join(clauses)}
                order by p.full_name
                """
            ),
            params,
        )
        faculty_ids = [row[0] for row in faculty_result.all()]
        await update_job(session, job_id, progress=55, progress_label=f"Filling {len(faculty_ids)} faculty rows…")

        faculty_rows: list[dict[str, Any]] = []
        for faculty_id in faculty_ids:
            context = await _faculty_context(session, faculty_id)
            resolved = resolve_row_for_faculty(labels, context)
            faculty_rows.append({"faculty_id": str(faculty_id), "fields": resolved})

        try:
            output_content = build_multi_faculty_output(content, header_row_index, labels, faculty_rows, columns)
        except (ValueError, KeyError) as exc:
            await update_job(session, job_id, status="failed", error=f"Could not generate the completed file: {exc}")
            return
        summary = summarize_gaps(faculty_rows)
        output_path = f"admin/{institution_id}/requests/{request_id}/completed.xlsx"
        await storage.upload_bytes(
            settings.supabase_generated_bucket, output_path, output_content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        await session.execute(
            text(
                """
                update public.admin_requests set
                  output_storage_path = :output_path, department_filter = :department, academic_year_filter = :academic_year,
                  faculty_count = :faculty_count, fields_detected = :fields_detected, faculty_with_gaps = :faculty_with_gaps,
                  completed_at = now()
                where id = :id
                """
            ),
            {
                "output_path": output_path, "department": department, "academic_year": academic_year,
                "faculty_count": summary["faculty_count"], "fields_detected": len(labels),
                "faculty_with_gaps": summary["faculty_with_gaps"], "id": request_id,
            },
        )
        await session.commit()
        await update_job(
            session, job_id, status="completed", progress=100,
            progress_label=f"{summary['faculty_count']} faculty rows filled",
            result=summary,
        )


@router.post("/{request_id}/process")
async def process_admin_request(
    request_id: UUID,
    payload: AdminRequestProcessRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    institution_id = institution_id_or_403(user)
    owned = await session.execute(text("select id from public.admin_requests where id = :id and institution_id = :institution_id"), {"id": request_id, "institution_id": institution_id})
    if owned.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin request not found")
    background_tasks.add_task(
        _run_request_processing, request_id, institution_id, user.user_id,
        payload.department, payload.academic_year, settings,
    )
    return {"request_id": request_id, "status": "running"}


async def _job_status_for_institution_request(session: AsyncSession, job_id: UUID) -> dict[str, Any] | None:
    # The admin_requests row is already institution-scoped by the caller, so
    # this looks up the linked job by id alone -- any admin in the same
    # institution may view a request's progress, not only the one who
    # started it.
    result = await session.execute(
        text(
            "select id, owner_id, kind, status::text as status, progress, progress_label, result, error, created_at, updated_at "
            "from public.background_jobs where id = :id"
        ),
        {"id": job_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


@router.get("/{request_id}")
async def get_admin_request(request_id: UUID, user: CurrentUser = Depends(require_admin), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            "select id, job_id, original_file_name, storage_path, output_storage_path, department_filter, "
            "academic_year_filter, faculty_count, fields_detected, faculty_with_gaps, created_at, completed_at "
            "from public.admin_requests where id = :id and institution_id = :institution_id"
        ),
        {"id": request_id, "institution_id": institution_id_or_403(user)},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin request not found")
    payload = dict(row)
    if row["job_id"]:
        payload["job"] = await _job_status_for_institution_request(session, row["job_id"])
    return payload


@router.get("/{request_id}/download")
async def download_admin_request(request_id: UUID, user: CurrentUser = Depends(require_admin), session: AsyncSession = Depends(get_db), settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    row = await session.execute(text("select output_storage_path from public.admin_requests where id = :id and institution_id = :institution_id"), {"id": request_id, "institution_id": institution_id_or_403(user)})
    output_path = row.scalar_one_or_none()
    if not output_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Completed file is not ready yet")
    try:
        signed_url = await StorageClient(settings).create_signed_download_url(settings.supabase_generated_bucket, output_path, settings.signed_url_ttl_seconds)
    except StorageError as exc:
        raise HTTPException(status_code=503, detail=f"Storage is unavailable: {exc}") from exc
    return {"url": signed_url, "expires_in": settings.signed_url_ttl_seconds}


@router.get("")
async def list_admin_requests(user: CurrentUser = Depends(require_admin), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            "select id, original_file_name, department_filter, academic_year_filter, faculty_count, "
            "faculty_with_gaps, created_at, completed_at from public.admin_requests "
            "where institution_id = :institution_id order by created_at desc limit 50"
        ),
        {"institution_id": institution_id_or_403(user)},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


def _department_report_pdf(institution_name: str, department: str | None, academic_year: str | None, rows: list[dict[str, Any]]) -> bytes:
    buffer = io.BytesIO()
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
    subtitle = " / ".join(filter(None, [department, academic_year])) or "All departments, all years"
    story: list[Any] = [
        Paragraph("Sanchaya — Department Report", styles["Title"]),
        Paragraph(f"{institution_name} — {subtitle}", styles["Heading3"]),
        Spacer(1, 5 * mm),
    ]
    table_rows = [["Faculty", "Employee Code", "Confirmed Activities", "Publications", "FDPs/Workshops"]]
    for row in rows:
        table_rows.append([
            row["full_name"], row.get("employee_code") or "", str(row["total_activities"]),
            str(row["publication_count"]), str(row["workshop_fdp_count"]),
        ])
    if len(table_rows) == 1:
        table_rows.append(["No faculty matched these filters", "", "", "", ""])
    table = Table(table_rows, colWidths=[65 * mm, 30 * mm, 35 * mm, 25 * mm, 25 * mm], repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), "#F1F5F9"), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.25, "#CBD5E1")]))
    story.append(table)
    doc.build(story)
    return buffer.getvalue()


@reports_router.post("/department")
async def generate_department_report(
    payload: DepartmentReportRequest,
    user: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    institution_id = institution_id_or_403(user)
    clauses = ["p.institution_id = :institution_id", "p.role = 'faculty'"]
    params: dict[str, Any] = {"institution_id": institution_id}
    if payload.department:
        clauses.append("d.name = :department")
        params["department"] = payload.department
    if payload.academic_year:
        clauses.append("coalesce(fp.current_academic_year, '') = :academic_year")
        params["academic_year"] = payload.academic_year
    faculty_result = await session.execute(
        text(
            f"""
            select p.id, p.full_name, fp.employee_code,
                   count(a.id) filter (where a.status = 'confirmed')::int as total_activities,
                   count(a.id) filter (where a.status = 'confirmed' and a.category = 'publication')::int as publication_count,
                   count(a.id) filter (where a.status = 'confirmed' and a.category = 'workshop_fdp')::int as workshop_fdp_count
            from public.profiles p
            left join public.departments d on d.id = p.department_id
            left join public.faculty_profiles fp on fp.profile_id = p.id
            left join public.academic_activities a on a.owner_id = p.id
            where {' and '.join(clauses)}
            group by p.id, p.full_name, fp.employee_code
            order by p.full_name
            """
        ),
        params,
    )
    rows = rows_to_dicts(faculty_result.mappings().all())
    institution_name_result = await session.execute(text("select name from public.institutions where id = :id"), {"id": institution_id})
    institution_name = institution_name_result.scalar_one_or_none() or "Institution"
    try:
        content = _department_report_pdf(institution_name, payload.department, payload.academic_year, rows)
        path = f"admin/{institution_id}/reports/{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}.pdf"
        storage = StorageClient(settings)
        await storage.upload_bytes(settings.supabase_generated_bucket, path, content, content_type="application/pdf")
        await session.execute(
            text("insert into public.generated_documents(owner_id, storage_path, file_name) values (:owner_id, :path, :file_name)"),
            {"owner_id": user.user_id, "path": path, "file_name": "department_report.pdf"},
        )
        await session.commit()
        signed_url = await storage.create_signed_download_url(settings.supabase_generated_bucket, path, settings.signed_url_ttl_seconds)
        return {"download_url": signed_url, "faculty_count": len(rows), "rows": rows}
    except (StorageError, OSError, ValueError) as exc:
        await session.rollback()
        raise HTTPException(status_code=502, detail=f"Report generation failed: {exc}") from exc
