"""Document-generation tools.

``generate_appraisal_pdf`` deliberately reuses the appraisal PDF pipeline in
``app/api/appraisals.py`` -- the same ReportLab builder (``_pdf_bytes``), the
same submission loader, storage bucket and signed-URL flow the endpoint uses.
There is exactly one PDF generator in this codebase; the agent tool differs
only in how the submission is chosen (the teacher's latest one, optionally
pinned to an academic year) and in returning a ``ToolResult`` whose
``ui_hint="download"`` carries the signed URL.

Expected failures (no submission yet, storage unavailable) return
``ToolResult.failure(...)``; they do not raise. The session is never
committed here -- the executor owns the transaction.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.appraisals import _pdf_bytes, _submission
from ...core.auth import CurrentUser
from ...core.config import get_settings
from ...core.storage import StorageClient, StorageError
from ..contracts import RiskClass, ToolResult, ToolScope
from ..registry import tool


@tool(
    name="generate_appraisal_pdf",
    description=(
        "Generate the teacher's self-appraisal PDF from their current appraisal draft and hand back "
        "a download link. Use when they ask for 'my appraisal PDF', 'export my appraisal', or a copy "
        "to submit or print."
    ),
    parameters={
        "type": "object",
        "properties": {
            "academic_year": {
                "type": "string",
                "description": "Optional academic year in YYYY-YY form, e.g. '2025-26'. Omit for the most recent appraisal.",
            }
        },
        "required": [],
    },
    risk_class=RiskClass.WRITE_LOW,
    scope=ToolScope.DOCUMENTS,
    summarise=lambda args: (
        f"Generate your self-appraisal PDF for {args.get('academic_year')}"
        if args.get("academic_year")
        else "Generate your self-appraisal PDF"
    ),
)
async def generate_appraisal_pdf(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    academic_year = str(args.get("academic_year") or "").strip() or None

    clauses = ["s.profile_id = :profile_id"]
    params: dict[str, Any] = {"profile_id": principal.user_id}
    if academic_year:
        clauses.append("c.academic_year = :academic_year")
        params["academic_year"] = academic_year
    found = await session.execute(
        text(
            f"""
            select s.id from public.appraisal_submissions s
            join public.appraisal_cycles c on c.id = s.cycle_id
            where {' and '.join(clauses)}
            order by s.updated_at desc nulls last, s.created_at desc
            limit 1
            """
        ),
        params,
    )
    found_row = found.mappings().first()
    if found_row is None:
        year_note = f" for {academic_year}" if academic_year else ""
        return ToolResult.failure(
            f"You don't have an appraisal{year_note} yet. Generate a draft on the Appraisal page first, then ask me for the PDF."
        )

    submission_id = found_row["id"]
    # Reuse the endpoint's loader verbatim so the PDF sees the identical
    # sections/items/reviews shape it was built for. Its not-found branch
    # cannot trigger here: we just selected this row under the same predicate.
    submission = await _submission(session, UUID(str(submission_id)), principal)

    settings = get_settings()
    try:
        content = _pdf_bytes(submission)
        path = f"{submission['profile_id']}/{submission_id}/{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}.pdf"
        storage = StorageClient(settings)
        await storage.upload_bytes(settings.supabase_generated_bucket, path, content, content_type="application/pdf")
        signed_url = await storage.create_signed_download_url(
            settings.supabase_generated_bucket, path, settings.assistant_document_url_ttl_seconds
        )
    except (StorageError, OSError, ValueError) as exc:
        return ToolResult.failure(f"PDF generation failed: {exc}")

    await session.execute(
        text("update public.appraisal_submissions set generated_pdf_path = :path, updated_at = now() where id = :id"),
        {"path": path, "id": submission_id},
    )
    await session.execute(
        text(
            "insert into public.generated_documents(owner_id, submission_id, storage_path, file_name) "
            "values (:owner_id, :submission_id, :path, :file_name)"
        ),
        {
            "owner_id": submission["profile_id"],
            "submission_id": submission_id,
            "path": path,
            "file_name": f"self_appraisal_{submission['academic_year']}.pdf",
        },
    )
    return ToolResult(
        ok=True,
        summary=f"Generated your self-appraisal PDF for {submission['academic_year']}",
        data={
            "submission_id": str(submission_id),
            "storage_path": path,
            "file_name": f"self_appraisal_{submission['academic_year']}.pdf",
            "expires_in": settings.assistant_document_url_ttl_seconds,
        },
        ui_hint="download",
        ui_target=signed_url,
    )
