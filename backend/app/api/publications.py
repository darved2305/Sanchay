"""Publication discovery, deterministic dedupe, and explicit confirmation."""

from __future__ import annotations

import json
from datetime import date
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..connectors.publications import (
    ExternalApiError,
    PublicationItem,
    candidate_match,
    dedupe_publications,
    normalize_title,
    scholar_identity_match,
)
from ..core.academic_year import derive_academic_year
from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..services.llm import LLMProvider
from ..services.scholar_import import extract_scholar_profile
from ..services.sql import mapping_or_404
from .schemas import ScholarImportRequest

# Below this similarity threshold on a title's *distinctive* (stopword-free)
# token overlap, a Scholar-pasted publication is treated as a different paper,
# not a duplicate of an existing one.
SCHOLAR_TITLE_DUPLICATE_THRESHOLD = 0.6
# Below this many distinctive tokens, two titles are too short/generic for
# overlap to mean anything -- e.g. "Research paper on Deep Learning" and
# "Research paper on Federated Analytics" share 3 of 5 raw tokens (0.6) but
# only "deep"/"learning" vs "federated"/"analytics" actually distinguish them.
# Below this floor, only the exact title+year hash (in `_upsert_record`)
# decides duplicates -- never the fuzzy check.
SCHOLAR_TITLE_MIN_DISTINCTIVE_TOKENS = 4
_TITLE_STOPWORDS = {
    "a", "an", "the", "of", "on", "in", "to", "for", "and", "or", "with", "from", "by", "at", "as", "is", "using",
}


def _title_similarity(a: str, b: str) -> float:
    tokens_a = set(normalize_title(a).split()) - _TITLE_STOPWORDS
    tokens_b = set(normalize_title(b).split()) - _TITLE_STOPWORDS
    if len(tokens_a) < SCHOLAR_TITLE_MIN_DISTINCTIVE_TOKENS or len(tokens_b) < SCHOLAR_TITLE_MIN_DISTINCTIVE_TOKENS:
        return 0.0
    return len(tokens_a & tokens_b) / max(len(tokens_a), len(tokens_b))

router = APIRouter(prefix="/publications", tags=["publications"])


async def _faculty_identity(session: AsyncSession, user: CurrentUser) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select p.full_name, fp.orcid_id, fp.openalex_author_id
            from public.profiles p
            left join public.faculty_profiles fp on fp.profile_id = p.id
            where p.id = :profile_id
            """
        ),
        {"profile_id": user.user_id},
    )
    identity = result.mappings().first()
    if identity is None:
        raise HTTPException(status_code=403, detail="Faculty profile is not provisioned")
    return dict(identity)


async def _upsert_record(session: AsyncSession, item: PublicationItem, *, create_only: bool = False) -> UUID:
    """Resolve or create a ``publication_records`` row for ``item``.

    ``publication_records``/``publication_authors`` are shared, global tables
    -- not per-user -- so the UPDATE branch below (unconditional on ``title``
    and ``metadata``, unlike the ``coalesce``-guarded columns) must never run
    against data that isn't verified/canonical. Callers whose source data is
    unverified (e.g. an LLM-extracted Google Scholar paste) must pass
    ``create_only=True`` so an existing match is resolved and returned as-is,
    never overwritten.
    """

    existing = await session.execute(
        text(
            """
            select id from public.publication_records
            where (cast(:doi as text) is not null and doi = cast(:doi as text))
               or (cast(:openalex_id as text) is not null and openalex_id = cast(:openalex_id as text))
               or (normalized_title_hash = cast(:title_hash as text) and year is not distinct from cast(:year as int))
            order by (doi = cast(:doi as text)) desc nulls last
            limit 1
            """
        ),
        {
            "doi": item.doi,
            "openalex_id": item.openalex_id,
            "title_hash": item.normalized_title_hash,
            "year": item.year,
        },
    )
    record_id = existing.scalar_one_or_none()
    if record_id:
        if not create_only:
            await session.execute(
                text(
                    """
                    update public.publication_records set
                      title = :title, venue = coalesce(venue, :venue), publisher = coalesce(publisher, :publisher),
                      publication_type = coalesce(publication_type, :publication_type), year = coalesce(year, :year),
                      month = coalesce(month, :month), citation_count = coalesce(:citation_count, citation_count),
                      openalex_id = coalesce(openalex_id, :openalex_id), metadata = cast(:metadata as jsonb)
                    where id = :id
                    """
                ),
                {
                    "id": record_id,
                    "title": item.title,
                    "venue": item.venue,
                    "publisher": item.publisher,
                    "publication_type": item.publication_type,
                    "year": item.year,
                    "month": item.month,
                    "citation_count": item.citation_count,
                    "openalex_id": item.openalex_id,
                    "metadata": json.dumps(item.metadata),
                },
            )
    else:
        inserted = await session.execute(
            text(
                """
                insert into public.publication_records (
                  doi, title, normalized_title_hash, venue, publisher, publication_type,
                  year, month, citation_count, openalex_id, metadata
                ) values (:doi, :title, :title_hash, :venue, :publisher, :publication_type,
                          :year, :month, :citation_count, :openalex_id, cast(:metadata as jsonb))
                on conflict do nothing returning id
                """
            ),
            {
                "doi": item.doi,
                "title": item.title,
                "title_hash": item.normalized_title_hash,
                "venue": item.venue,
                "publisher": item.publisher,
                "publication_type": item.publication_type,
                "year": item.year,
                "month": item.month,
                "citation_count": item.citation_count,
                "openalex_id": item.openalex_id,
                "metadata": json.dumps(item.metadata),
            },
        )
        record_id = inserted.scalar_one_or_none()
        if record_id is None:
            retry = await session.execute(
                text(
                    """
                    select id from public.publication_records
                    where (cast(:doi as text) is not null and doi = cast(:doi as text))
                       or (cast(:openalex_id as text) is not null and openalex_id = cast(:openalex_id as text))
                       or (normalized_title_hash = cast(:title_hash as text) and year is not distinct from cast(:year as int))
                    limit 1
                    """
                ),
                {"doi": item.doi, "openalex_id": item.openalex_id, "title_hash": item.normalized_title_hash, "year": item.year},
            )
            record_id = retry.scalar_one_or_none()
        if record_id is None:
            raise HTTPException(status_code=409, detail="Publication dedupe conflict; please retry sync")

    for author in item.authors:
        await session.execute(
            text(
                """
                insert into public.publication_authors
                  (publication_id, position, author_name, orcid_id, openalex_author_id, affiliation)
                values (:publication_id, :position, :author_name, :orcid_id, :openalex_author_id, :affiliation)
                on conflict (publication_id, position) do update set
                  author_name = excluded.author_name,
                  orcid_id = coalesce(publication_authors.orcid_id, excluded.orcid_id),
                  openalex_author_id = coalesce(publication_authors.openalex_author_id, excluded.openalex_author_id),
                  affiliation = coalesce(publication_authors.affiliation, excluded.affiliation)
                """
            ),
            {
                "publication_id": record_id,
                "position": author.position,
                "author_name": author.name,
                "orcid_id": author.orcid_id,
                "openalex_author_id": author.openalex_author_id,
                "affiliation": author.affiliation,
            },
        )
    return UUID(str(record_id))


async def _candidate_payload(session: AsyncSession, candidate_id: UUID, profile_id: UUID) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select pc.id, pc.profile_id, pc.publication_id, pc.source, pc.match_score,
                   pc.match_reasons, pc.status::text as status, pc.activity_id, pc.created_at,
                   pr.doi, pr.title, pr.venue, pr.publisher, pr.publication_type, pr.year,
                   pr.month, pr.citation_count, pr.openalex_id, pr.metadata
            from public.publication_candidates pc
            join public.publication_records pr on pr.id = pc.publication_id
            where pc.id = :candidate_id and pc.profile_id = :profile_id
            """
        ),
        {"candidate_id": candidate_id, "profile_id": profile_id},
    )
    row = mapping_or_404(result, "Publication candidate not found")
    publication = {
        key: row.pop(key)
        for key in ("doi", "title", "venue", "publisher", "publication_type", "year", "month", "citation_count", "openalex_id", "metadata")
    }
    row["publication"] = publication
    return row


@router.post("/sync")
async def sync_publications(
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    identity = await _faculty_identity(session, user)
    orcid_id = identity.get("orcid_id")
    if not orcid_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No ORCID iD is configured for this faculty profile; add one before syncing publications",
        )
    try:
        publications = await dedupe_publications(
            orcid_id=str(orcid_id),
            openalex_author_id=identity.get("openalex_author_id"),
            settings=settings,
        )
    except ExternalApiError as exc:
        raise HTTPException(status_code=502, detail=f"Publication provider unavailable: {exc}") from exc
    if not publications:
        return {
            "items": [],
            "count": 0,
            "message": "ORCID returned no publication works for this profile",
        }

    candidate_ids: list[UUID] = []
    for item in publications:
        publication_id = await _upsert_record(session, item)
        existing = await session.execute(
            text("select id, status::text as status from public.publication_candidates where profile_id = :profile_id and publication_id = :publication_id"),
            {"profile_id": user.user_id, "publication_id": publication_id},
        )
        candidate = existing.mappings().first()
        if candidate:
            candidate_ids.append(UUID(str(candidate["id"])))
            continue
        score, reasons = candidate_match(item, str(identity.get("full_name") or ""))
        created = await session.execute(
            text(
                """
                insert into public.publication_candidates
                  (profile_id, publication_id, source, match_score, match_reasons, status)
                values (:profile_id, :publication_id, :source, :match_score, cast(:match_reasons as jsonb), 'pending')
                on conflict (profile_id, publication_id) do nothing returning id
                """
            ),
            {
                "profile_id": user.user_id,
                "publication_id": publication_id,
                "source": str(item.metadata.get("source", "orcid")),
                "match_score": score,
                "match_reasons": json.dumps(reasons),
            },
        )
        created_id = created.scalar_one_or_none()
        if created_id:
            candidate_ids.append(UUID(str(created_id)))
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Publication sync conflicted with another sync; retry") from exc
    items = [await _candidate_payload(session, candidate_id, user.user_id) for candidate_id in candidate_ids]
    return {"items": items, "count": len(items), "message": "Publications synced as pending candidates for review"}


@router.get("/candidates")
async def list_candidates(
    candidate_status: str | None = Query(default=None, alias="status", pattern="^(pending|confirmed|rejected)$"),
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clauses = ["pc.profile_id = :profile_id"]
    params: dict[str, Any] = {"profile_id": user.user_id}
    if candidate_status:
        clauses.append("pc.status = cast(:status as publication_candidate_status)")
        params["status"] = candidate_status
    result = await session.execute(
        text(
            """
            select pc.id, pc.profile_id, pc.publication_id, pc.source, pc.match_score,
                   pc.match_reasons, pc.status::text as status, pc.activity_id, pc.created_at,
                   pr.doi, pr.title, pr.venue, pr.publisher, pr.publication_type, pr.year,
                   pr.month, pr.citation_count, pr.openalex_id, pr.metadata
            from public.publication_candidates pc
            join public.publication_records pr on pr.id = pc.publication_id
            where """
            + " and ".join(clauses)
            + " order by pc.match_score desc nulls last, pc.created_at desc"
        ),
        params,
    )
    groups: dict[str, list[dict[str, Any]]] = {"high": [], "medium": [], "low": []}
    items: list[dict[str, Any]] = []
    for raw in result.mappings().all():
        row = dict(raw)
        publication = {key: row.pop(key) for key in ("doi", "title", "venue", "publisher", "publication_type", "year", "month", "citation_count", "openalex_id", "metadata")}
        row["publication"] = publication
        score = float(row.get("match_score") or 0)
        bucket = "high" if score >= 0.8 else "medium" if score >= 0.6 else "low"
        row["confidence_bucket"] = bucket
        groups[bucket].append(row)
        items.append(row)
    return {"items": items, "groups": groups}


async def _confirm_publication_as_activity(
    session: AsyncSession,
    user: CurrentUser,
    candidate: dict[str, Any],
    *,
    source: str = "publication_sync",
    extra_metadata: dict[str, Any] | None = None,
) -> UUID:
    """Insert the ``academic_activities`` row for an already-loaded candidate
    and mark the candidate confirmed. Caller owns the transaction (commit).
    """

    candidate_id = candidate["id"]
    year = candidate.get("year")
    # The academic year runs July-June, so it cannot be derived from the
    # calendar year alone — a March 2026 paper belongs to 2025-26, not 2026-27.
    publication_month = int(candidate.get("month") or 1)
    academic_year = derive_academic_year(date(int(year), publication_month, 1)) if year else "unspecified"
    metadata = {
        "publication_id": str(candidate["publication_id"]),
        "candidate_id": str(candidate_id),
        "citation_count": candidate.get("citation_count"),
        "record": candidate.get("metadata") or {},
    }
    if extra_metadata:
        metadata.update(extra_metadata)
    activity = await session.execute(
        text(
            """
            insert into public.academic_activities
              (owner_id, category, title, description, organization, start_date, academic_year,
               doi, url, metadata, visibility, status, source, confirmed_at)
            values (:owner_id, 'publication', :title, :description, :venue, :start_date, :academic_year,
                    :doi, case when cast(:doi as text) is not null then 'https://doi.org/' || cast(:doi as text) else null end,
                    cast(:metadata as jsonb), 'private', 'confirmed', cast(:source as public.activity_source), now())
            returning id
            """
        ),
        {
            "owner_id": user.user_id,
            "title": candidate["title"],
            "description": f"Confirmed publication from {candidate.get('publisher') or candidate.get('publication_type') or 'publication record'}",
            "venue": candidate.get("venue"),
            "start_date": date(int(year), int(candidate.get("month") or 1), 1) if year else None,
            "academic_year": academic_year,
            "doi": candidate.get("doi"),
            "metadata": json.dumps(metadata),
            "source": source,
        },
    )
    activity_id = activity.scalar_one()
    await session.execute(
        text("update public.publication_candidates set status = 'confirmed', activity_id = :activity_id where id = :candidate_id and profile_id = :profile_id"),
        {"activity_id": activity_id, "candidate_id": candidate_id, "profile_id": user.user_id},
    )
    return UUID(str(activity_id))


@router.post("/candidates/{candidate_id}/confirm")
async def confirm_candidate(
    candidate_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select pc.id, pc.status::text as status, pc.activity_id, pr.id as publication_id,
                   pr.doi, pr.title, pr.venue, pr.publisher, pr.publication_type, pr.year,
                   pr.month, pr.citation_count, pr.metadata
            from public.publication_candidates pc
            join public.publication_records pr on pr.id = pc.publication_id
            where pc.id = :candidate_id and pc.profile_id = :profile_id
            for update of pc
            """
        ),
        {"candidate_id": candidate_id, "profile_id": user.user_id},
    )
    candidate = mapping_or_404(result, "Publication candidate not found")
    if candidate["status"] == "rejected":
        raise HTTPException(status_code=409, detail="Rejected publication candidates cannot be confirmed")
    if candidate["status"] == "confirmed" and candidate.get("activity_id"):
        return await _candidate_payload(session, candidate_id, user.user_id)
    await _confirm_publication_as_activity(session, user, dict(candidate))
    await session.commit()
    return await _candidate_payload(session, candidate_id, user.user_id)


@router.post("/candidates/{candidate_id}/reject")
async def reject_candidate(
    candidate_id: UUID,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    result = await session.execute(
        text("update public.publication_candidates set status = 'rejected' where id = :id and profile_id = :profile_id and status = 'pending'"),
        {"id": candidate_id, "profile_id": user.user_id},
    )
    if result.rowcount == 0:
        existing = await session.execute(text("select status::text from public.publication_candidates where id = :id and profile_id = :profile_id"), {"id": candidate_id, "profile_id": user.user_id})
        status_value = existing.scalar_one_or_none()
        if status_value is None:
            raise HTTPException(status_code=404, detail="Publication candidate not found")
        if status_value == "confirmed":
            raise HTTPException(status_code=409, detail="Confirmed publication candidates cannot be rejected")
    await session.commit()
    return {"ok": True}


async def _load_candidate_by_publication(session: AsyncSession, user: CurrentUser, publication_id: UUID) -> dict[str, Any] | None:
    result = await session.execute(
        text(
            """
            select pc.id, pc.status::text as status, pc.activity_id, pr.id as publication_id,
                   pr.doi, pr.title, pr.venue, pr.publisher, pr.publication_type, pr.year,
                   pr.month, pr.citation_count, pr.metadata
            from public.publication_candidates pc
            join public.publication_records pr on pr.id = pc.publication_id
            where pc.profile_id = :profile_id and pc.publication_id = :publication_id
            for update of pc
            """
        ),
        {"profile_id": user.user_id, "publication_id": publication_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


@router.post("/scholar-import")
async def scholar_import(
    payload: ScholarImportRequest,
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Paste-import from a Google Scholar profile page.

    Unlike ``/sync`` (ORCID/OpenAlex/Crossref, staged as pending candidates
    for manual review), a Scholar import auto-confirms straight into the
    user's record once identity is verified -- there is no per-item review
    step here, by design. Nothing is written at all if the pasted page's
    name doesn't match the caller's profile.
    """

    identity = await _faculty_identity(session, user)
    full_name = str(identity.get("full_name") or "")
    if len(full_name.split()) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Set your full name on your profile before importing from Google Scholar",
        )

    extracted = await extract_scholar_profile(payload.text, LLMProvider(settings))
    if not extracted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not read a Google Scholar profile from the pasted content",
        )

    extracted_name = str(extracted.get("person_name") or "")
    extraction_method = extracted.get("extraction_method", "llm")
    matched, reasons = scholar_identity_match(extracted_name, full_name)
    if not matched:
        return {
            "matched": False,
            "extracted_name": extracted_name,
            "extraction_method": extraction_method,
            "reasons": reasons,
            "items": [],
            "count": 0,
            "skipped": [],
        }

    existing_activities = await session.execute(
        text(
            "select title from public.academic_activities "
            "where owner_id = :owner_id and category = 'publication' and status = 'confirmed'"
        ),
        {"owner_id": user.user_id},
    )
    known_titles = [row[0] for row in existing_activities.all()]

    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for raw in extracted.get("publications") or []:
        title = str(raw.get("title") or "").strip()
        if not title:
            continue

        item = PublicationItem(
            title=title,
            venue=raw.get("venue"),
            year=raw.get("year"),
            publication_type=raw.get("publication_type"),
            authors=[],
            metadata={"source": "scholar"},
        )
        publication_id = await _upsert_record(session, item, create_only=True)
        candidate = await _load_candidate_by_publication(session, user, publication_id)

        if candidate and candidate["status"] == "confirmed":
            skipped.append({"title": title, "reason": "already in your record"})
            continue
        if candidate and candidate["status"] == "rejected":
            skipped.append({"title": title, "reason": "previously rejected by you"})
            continue
        if not candidate:
            duplicate = next(
                (existing for existing in known_titles if _title_similarity(existing, title) >= SCHOLAR_TITLE_DUPLICATE_THRESHOLD),
                None,
            )
            if duplicate:
                skipped.append({"title": title, "reason": "already in your record (similar title)"})
                continue
            await session.execute(
                text(
                    """
                    insert into public.publication_candidates
                      (profile_id, publication_id, source, match_score, match_reasons, status)
                    values (:profile_id, :publication_id, 'scholar', 1.0, cast(:match_reasons as jsonb), 'pending')
                    on conflict (profile_id, publication_id) do nothing
                    """
                ),
                {"profile_id": user.user_id, "publication_id": publication_id, "match_reasons": json.dumps(reasons)},
            )
            # Reload rather than trust the insert: a concurrent request for the
            # same publication may have raced us to the conflict, and could
            # already have confirmed or rejected it before this line runs.
            candidate = await _load_candidate_by_publication(session, user, publication_id)
            if candidate is None:
                skipped.append({"title": title, "reason": "could not stage this publication for import"})
                continue
            if candidate["status"] == "confirmed":
                skipped.append({"title": title, "reason": "already in your record"})
                continue
            if candidate["status"] == "rejected":
                skipped.append({"title": title, "reason": "previously rejected by you"})
                continue

        extra_metadata = {"scholar": {"cited_by": raw.get("citation_count"), "authors": raw.get("authors") or []}}
        activity_id = await _confirm_publication_as_activity(
            session, user, candidate, source="scholar_import", extra_metadata=extra_metadata,
        )
        imported.append({"title": title, "activity_id": str(activity_id)})
        known_titles.append(title)

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Import conflicted with another update; please retry") from exc

    return {
        "matched": True,
        "extracted_name": extracted_name,
        "extraction_method": extraction_method,
        "items": imported,
        "count": len(imported),
        "skipped": skipped,
        "aggregates": {
            "total_citations": extracted.get("total_citations"),
            "h_index": extracted.get("h_index"),
            "i10_index": extracted.get("i10_index"),
        },
    }
