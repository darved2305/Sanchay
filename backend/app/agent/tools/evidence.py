"""Evidence-vault write tools.

The teacher's files reach Supabase Storage through the normal signed-URL
flow (``POST /evidence/upload-url`` then ``/finalize``); these tools never
touch bytes. They record and classify metadata on rows that already exist in
``public.evidence_files``, and attach evidence to activities exactly the way
``app/api/evidence.py::attach_evidence`` does -- both rows must belong to
``principal.user_id`` before anything is linked.

Expected failures (unknown id, wrong owner, approved appraisal) return
``ToolResult.failure(...)``; they do not raise.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import CurrentUser
from ..contracts import RiskClass, ToolResult, ToolScope
from ..registry import tool

#: Same set app/api/evidence.py validates against when a teacher confirms a
#: classification; keep in sync with the ``document_category`` Postgres enum.
DOCUMENT_CATEGORIES = (
    "research",
    "teaching",
    "professional_development",
    "academic_service",
    "student_mentorship",
    "administration",
    "other",
)


def _parse_uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value or "").strip())
    except ValueError:
        return None


@tool(
    name="upload_evidence",
    description=(
        "Record and classify a document the teacher has ALREADY uploaded to their "
        "Evidence Vault through the upload flow. Use when they describe a file that is "
        "already uploaded -- e.g. 'the FDP certificate I just uploaded is called ...' -- "
        "and you have its evidence id from the vault listing. This labels the file; it "
        "does not transfer one."
    ),
    parameters={
        "type": "object",
        "properties": {
            "evidence_id": {
                "type": "string",
                "description": "Id of the file in the teacher's Evidence Vault (an existing evidence row).",
            },
            "document_category": {
                "type": "string",
                "enum": list(DOCUMENT_CATEGORIES),
                "description": "Which area of academic work this document proves.",
            },
            "document_type": {
                "type": "string",
                "description": "Short label for the kind of document, e.g. 'FDP certificate' or 'acceptance letter'. Optional.",
            },
            "title": {
                "type": "string",
                "description": "Title to record for the document, e.g. its official certificate title.",
            },
        },
        "required": ["evidence_id", "document_category", "title"],
    },
    risk_class=RiskClass.WRITE_LOW,
    scope=ToolScope.EVIDENCE,
    summarise=lambda args: (
        f"Classify “{args.get('title') or 'uploaded document'}” as {args.get('document_category')} in Evidence Vault"
    ),
)
async def upload_evidence(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    evidence_id = _parse_uuid(args.get("evidence_id"))
    if evidence_id is None:
        return ToolResult.failure("I need the id of the uploaded file from your Evidence Vault.")
    category = str(args.get("document_category") or "").strip()
    if category not in DOCUMENT_CATEGORIES:
        return ToolResult.failure(f"{category!r} is not a document category Sanchaya records.")
    title = str(args.get("title") or "").strip()
    if not title:
        return ToolResult.failure("Give the document a title so it stays findable.")
    document_type = str(args.get("document_type") or "").strip() or None

    result = await session.execute(
        text(
            """
            update public.evidence_files set
                document_category = cast(:document_category as document_category),
                document_type = :document_type,
                extracted_title = :title,
                needs_confirmation = false,
                updated_at = now()
            where id = :id and owner_id = :owner_id
            returning file_name, mime_type, document_category::text as document_category, document_type
            """
        ),
        {
            "id": evidence_id,
            "owner_id": principal.user_id,
            "document_category": category,
            "document_type": document_type,
            "title": title,
        },
    )
    row = result.mappings().first()
    if row is None:
        return ToolResult.failure(
            "I could not find that file in your Evidence Vault. Upload it first, then ask me again."
        )
    return ToolResult(
        ok=True,
        summary=f"Recorded {row['file_name']} as {row['document_category']} in your Evidence Vault",
        data={
            "evidence_id": str(evidence_id),
            "file_name": row["file_name"],
            "mime_type": row["mime_type"],
            "title": title,
            "document_category": row["document_category"],
            "document_type": row["document_type"],
        },
        ui_hint="detail",
    )


@tool(
    name="attach_evidence",
    description=(
        "Attach an uploaded Evidence Vault file to one of the teacher's activities so it counts "
        "as proof. Use when they say things like 'attach my IEEE certificate to the invited talk'. "
        "Needs both the evidence id and the activity id."
    ),
    parameters={
        "type": "object",
        "properties": {
            "evidence_id": {
                "type": "string",
                "description": "Id of the file in the teacher's Evidence Vault.",
            },
            "activity_id": {
                "type": "string",
                "description": "Id of the activity in the teacher's Academic Records.",
            },
        },
        "required": ["evidence_id", "activity_id"],
    },
    risk_class=RiskClass.WRITE_LOW,
    scope=ToolScope.EVIDENCE,
    summarise=lambda args: f"Attach evidence {str(args.get('evidence_id'))[:8]}… to activity {str(args.get('activity_id'))[:8]}…",
)
async def attach_evidence(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    evidence_id = _parse_uuid(args.get("evidence_id"))
    if evidence_id is None:
        return ToolResult.failure("I need the id of the file from your Evidence Vault.")
    activity_id = _parse_uuid(args.get("activity_id"))
    if activity_id is None:
        return ToolResult.failure("I need the id of the activity to attach it to.")

    # Two separate ownership checks: the file AND the activity must both
    # belong to the asking teacher before anything is linked.
    evidence_result = await session.execute(
        text("select file_name from public.evidence_files where id = :id and owner_id = :owner_id"),
        {"id": evidence_id, "owner_id": principal.user_id},
    )
    evidence_row = evidence_result.mappings().first()
    if evidence_row is None:
        return ToolResult.failure("That file is not in your Evidence Vault.")
    activity_result = await session.execute(
        text(
            "select title from public.academic_activities "
            "where id = :activity_id and owner_id = :owner_id and status <> 'archived'"
        ),
        {"activity_id": activity_id, "owner_id": principal.user_id},
    )
    activity_row = activity_result.mappings().first()
    if activity_row is None:
        return ToolResult.failure("That activity is not in your Academic Records.")

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
        {"activity_id": activity_id, "owner_id": principal.user_id},
    )
    if approved.scalar():
        return ToolResult.failure("That activity is part of an approved appraisal, so its evidence can no longer be changed.")

    existing = await session.execute(
        text(
            "select 1 from public.activity_evidence where activity_id = :activity_id and evidence_id = :evidence_id"
        ),
        {"activity_id": activity_id, "evidence_id": evidence_id},
    )
    await session.execute(
        text(
            "insert into public.activity_evidence (activity_id, evidence_id) values (:activity_id, :evidence_id) on conflict do nothing"
        ),
        {"activity_id": activity_id, "evidence_id": evidence_id},
    )
    if existing.first() is None:
        await session.execute(
            text(
                "update public.academic_activities set evidence_status = 'attached', updated_at = now() "
                "where id = :activity_id and owner_id = :owner_id"
            ),
            {"activity_id": activity_id, "owner_id": principal.user_id},
        )
        summary = f"Attached {evidence_row['file_name']} to “{activity_row['title']}”"
    else:
        summary = f"{evidence_row['file_name']} was already attached to “{activity_row['title']}”"
    return ToolResult(
        ok=True,
        summary=summary,
        data={"evidence_id": str(evidence_id), "activity_id": str(activity_id), "activity_title": activity_row["title"]},
        ui_hint="detail",
    )
