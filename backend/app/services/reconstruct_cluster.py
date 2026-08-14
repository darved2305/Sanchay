"""Reconstruct My Year, migrated onto the shared signal layer (product
expansion §47-58). Every ``source_signals`` row is classified exactly once
and clustered by blocking on (profile, date window) before any fuzzy title
match -- never a full pairwise re-correlation over a year of history.
Reuses the exact deterministic classify/correlate rules already proven by
the old batch pipeline (``services/reconstruct.py``), applied incrementally.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..connectors.google import HarvestedItem
from .llm import LLMProvider
from .reconstruct import _title_similarity, classify_category, is_academic_signal
from .signals import mark_classified

DATE_WINDOW_DAYS = 5
TITLE_THRESHOLD = 0.2


@dataclass
class ClusterOutcome:
    signal_id: UUID
    cluster_id: UUID | None
    is_new_cluster: bool
    actionable: bool


async def _find_or_create_cluster(
    session: AsyncSession, profile_id: UUID, category: str, title: str, organization: str | None, event_date: date | None
) -> tuple[UUID, bool]:
    """Block candidates by profile + date window (product expansion §56)
    before any fuzzy match -- the query below never scans more than a
    handful of recent open/proposed clusters, not the whole year."""

    clauses = ["profile_id = :profile_id", "status = 'proposed'"]
    params: dict[str, Any] = {"profile_id": profile_id}
    if event_date is not None:
        clauses.append("(start_date is null or start_date between :window_start and :window_end)")
        params["window_start"] = event_date - timedelta(days=DATE_WINDOW_DAYS)
        params["window_end"] = event_date + timedelta(days=DATE_WINDOW_DAYS)
    result = await session.execute(
        text(f"select id, normalized_title from public.activity_clusters where {' and '.join(clauses)} order by created_at desc limit 50"),
        params,
    )
    for row in result.mappings().all():
        if _title_similarity(title, row["normalized_title"] or "") >= TITLE_THRESHOLD:
            return row["id"], False

    insert_result = await session.execute(
        text(
            """
            insert into public.activity_clusters (profile_id, predicted_category, normalized_title, organization, start_date, confidence, status)
            values (:profile_id, cast(:category as activity_category), :normalized_title, :organization, :start_date, 0.5, 'proposed')
            returning id
            """
        ),
        {"profile_id": profile_id, "category": category, "normalized_title": title, "organization": organization, "start_date": event_date},
    )
    return insert_result.scalar_one(), True


async def _refresh_cluster_confidence(session: AsyncSession, cluster_id: UUID) -> None:
    """More corroborating sources -> higher confidence (mirrors
    services/reconstruct.py::score_confidence), never touching a cluster a
    faculty member has already confirmed or ignored."""

    result = await session.execute(text("select count(distinct source) from public.source_signals where cluster_id = :id"), {"id": cluster_id})
    distinct_sources = result.scalar_one()
    confidence = {1: 0.5, 2: 0.75}.get(distinct_sources, 0.9)
    await session.execute(
        text("update public.activity_clusters set confidence = :confidence, updated_at = now() where id = :id and status = 'proposed'"),
        {"confidence": confidence, "id": cluster_id},
    )


async def classify_and_cluster_signal(session: AsyncSession, signal: dict[str, Any], llm: LLMProvider) -> ClusterOutcome:
    """Classifies one signal and attaches it to a cluster -- called only for
    signals whose ``upsert_signal`` reported ``changed=True`` (product
    expansion §49/§55: never reclassify unchanged content)."""

    item = HarvestedItem(
        source_type=signal["source"], external_id=signal["external_id"],
        title=signal.get("title") or "", snippet=signal.get("snippet") or "",
        occurred_on=str(signal["event_date"]) if signal.get("event_date") else None, raw={},
    )
    if not is_academic_signal(item):
        await mark_classified(session, signal["id"], classification={"academic": False}, entities={})
        return ClusterOutcome(signal_id=signal["id"], cluster_id=None, is_new_cluster=False, actionable=False)

    category = classify_category(item)
    cluster_id, is_new = await _find_or_create_cluster(
        session, signal["profile_id"], category, item.title or item.snippet[:120], signal.get("organization"), signal.get("event_date")
    )
    await session.execute(
        text("update public.source_signals set cluster_id = :cluster_id, status = 'clustered' where id = :id"),
        {"cluster_id": cluster_id, "id": signal["id"]},
    )
    await mark_classified(session, signal["id"], classification={"academic": True, "category": category}, entities={})
    await _refresh_cluster_confidence(session, cluster_id)
    return ClusterOutcome(signal_id=signal["id"], cluster_id=cluster_id, is_new_cluster=is_new, actionable=True)


async def get_cached_candidates(session: AsyncSession, profile_id: UUID) -> list[dict[str, Any]]:
    """Cache-first read (product expansion §58): a plain database query
    against already-persisted clusters, never a live re-harvest. This is
    what makes opening Reconstruct a read, not a recompute."""

    result = await session.execute(
        text(
            """
            select id, predicted_category::text as predicted_category, normalized_title, organization,
                   start_date, confidence, status::text as status, created_at
            from public.activity_clusters where profile_id = :profile_id and status = 'proposed'
            order by confidence desc, created_at desc limit 100
            """
        ),
        {"profile_id": profile_id},
    )
    clusters = [dict(row) for row in result.mappings().all()]
    for cluster in clusters:
        sources = await session.execute(
            text(
                "select source::text as source, title, snippet, event_date from public.source_signals "
                "where cluster_id = :cluster_id order by event_date"
            ),
            {"cluster_id": cluster["id"]},
        )
        cluster["sources"] = [dict(row) for row in sources.mappings().all()]
    return clusters
