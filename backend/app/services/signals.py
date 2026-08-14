"""Shared source-signal layer: one persistent, deduped record per raw signal
from any source (Gmail, Calendar, Drive, an uploaded document, a manual
entry). The Faculty Action Inbox, the Smart Academic Repository, and
Reconstruct My Year all upsert into ``source_signals`` instead of each
independently re-fetching/re-classifying the same underlying item.

Never-reprocess rule (product expansion §49): a signal's ``content_hash`` is
derived only from the fields that matter for classification. If a caller
upserts a signal whose hash hasn't changed, ``upsert_signal`` reports
``changed=False`` and callers must skip re-running classification/LLM calls
for it -- this is what makes a delta sync cheap.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def compute_content_hash(*, title: str, snippet: str, sender: str | None, event_date: date | str | None) -> str:
    """A stable hash of the content that would change what classification
    produces. Deliberately excludes volatile/non-semantic fields (fetch
    timestamps, raw envelope bytes) so re-fetching an unchanged item is a
    no-op hash-wise even if the API response wrapper differs byte-for-byte.
    """

    payload = json.dumps(
        {"title": title or "", "snippet": snippet or "", "sender": sender or "", "event_date": str(event_date or "")},
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass
class SignalUpsertResult:
    signal_id: UUID
    is_new: bool
    changed: bool  # True when the content differs from what's already stored (new OR updated)


async def upsert_signal(
    session: AsyncSession,
    *,
    profile_id: UUID,
    source: str,
    external_id: str,
    title: str,
    snippet: str,
    sender: str | None = None,
    organization: str | None = None,
    event_date: date | str | None = None,
    metadata: dict[str, Any] | None = None,
) -> SignalUpsertResult:
    """Insert or refresh one source signal, keyed on (profile_id, source, external_id).

    On conflict, only overwrites content columns when the computed hash
    differs -- this is a plain UPSERT rather than a hash-gated UPDATE because
    Postgres has no "update only if changed" primitive without a trigger, but
    the caller-visible ``changed`` flag is what actually gates re-classification.
    """

    content_hash = compute_content_hash(title=title, snippet=snippet, sender=sender, event_date=event_date)
    # asyncpg binds the `date` column strictly -- it will not implicitly cast
    # a plain string the way psycopg/the SQL text editor would.
    parsed_event_date = date.fromisoformat(event_date) if isinstance(event_date, str) else event_date
    result = await session.execute(
        text(
            """
            insert into public.source_signals
                (profile_id, source, external_id, content_hash, title, snippet, sender, organization, event_date, metadata, status)
            values
                (:profile_id, cast(:source as signal_source), :external_id, :content_hash, :title, :snippet, :sender, :organization, :event_date, cast(:metadata as jsonb), 'new')
            on conflict (profile_id, source, external_id) do update set
                title = excluded.title,
                snippet = excluded.snippet,
                sender = excluded.sender,
                organization = excluded.organization,
                event_date = excluded.event_date,
                metadata = excluded.metadata,
                content_hash = excluded.content_hash,
                -- A changed signal must be reclassified; reset status/classification only when the hash actually moved.
                status = case when public.source_signals.content_hash <> excluded.content_hash then 'new'::signal_status else public.source_signals.status end,
                classification = case when public.source_signals.content_hash <> excluded.content_hash then '{}'::jsonb else public.source_signals.classification end,
                processed_at = case when public.source_signals.content_hash <> excluded.content_hash then null else public.source_signals.processed_at end
            returning id, (xmax = 0) as is_new, status::text as status
            """
        ),
        {
            "profile_id": profile_id,
            "source": source,
            "external_id": external_id,
            "content_hash": content_hash,
            "title": title,
            "snippet": snippet,
            "sender": sender,
            "organization": organization,
            "event_date": parsed_event_date,
            "metadata": json.dumps(metadata or {}),
        },
    )
    row = result.mappings().first()
    assert row is not None
    is_new = bool(row["is_new"])
    # `status` was reset to 'new' by the conflict clause above only when the
    # hash actually changed, so "still new" is the authoritative signal that
    # this signal needs (re)classification, covering both inserts and updates.
    needs_processing = row["status"] == "new"
    return SignalUpsertResult(signal_id=row["id"], is_new=is_new, changed=is_new or needs_processing)


async def mark_classified(
    session: AsyncSession,
    signal_id: UUID,
    *,
    classification: dict[str, Any],
    entities: dict[str, Any] | None = None,
) -> None:
    await session.execute(
        text(
            """
            update public.source_signals
            set classification = cast(:classification as jsonb),
                entities = cast(:entities as jsonb),
                status = 'classified',
                processed_at = now()
            where id = :id
            """
        ),
        {
            "id": signal_id,
            "classification": json.dumps(classification),
            "entities": json.dumps(entities or {}),
        },
    )


async def unprocessed_signals(
    session: AsyncSession, *, profile_id: UUID, source: str | None = None, limit: int = 200
) -> list[dict[str, Any]]:
    """Signals that are new or whose content changed since last classification."""

    clauses = ["profile_id = :profile_id", "status = 'new'"]
    params: dict[str, Any] = {"profile_id": profile_id, "limit": limit}
    if source:
        clauses.append("source = cast(:source as signal_source)")
        params["source"] = source
    result = await session.execute(
        text(
            f"""
            select id, profile_id, source::text as source, external_id, title, snippet, sender,
                   organization, event_date, metadata, created_at
            from public.source_signals
            where {' and '.join(clauses)}
            order by created_at desc
            limit :limit
            """
        ),
        params,
    )
    return [dict(row) for row in result.mappings().all()]
