"""Incremental sync orchestration: connector -> source_signals, gated by a
persisted cursor in ``source_sync_state`` (product expansion §49-52). First
call for a profile+provider does a bounded backfill and stores a cursor;
every later call asks the provider for changes only. Shared by the Faculty
Action Inbox and (once migrated, product expansion §47-58) Reconstruct My
Year, so neither feature runs its own independent full mailbox scan.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..connectors.google import (
    fetch_calendar_delta,
    fetch_drive_changes,
    fetch_drive_items,
    fetch_drive_start_page_token,
    fetch_gmail_history,
    fetch_gmail_items,
    fetch_gmail_profile_history_id,
)
from ..core.config import Settings
from .signals import upsert_signal

logger = logging.getLogger(__name__)


@dataclass
class SyncSummary:
    provider: str
    mode: str  # "backfill" | "delta"
    fetched: int
    new_or_changed: int


async def _cursor(session: AsyncSession, profile_id: UUID, provider: str) -> str | None:
    result = await session.execute(
        text("select cursor from public.source_sync_state where profile_id = :profile_id and provider = cast(:provider as oauth_provider)"),
        {"profile_id": profile_id, "provider": provider},
    )
    return result.scalar_one_or_none()


async def _store_cursor(session: AsyncSession, profile_id: UUID, provider: str, cursor: str | None, *, is_full_sync: bool) -> None:
    await session.execute(
        text(
            """
            insert into public.source_sync_state (profile_id, provider, cursor, last_full_sync_at, last_delta_sync_at)
            values (:profile_id, cast(:provider as oauth_provider), :cursor,
                    case when :is_full_sync then now() else null end,
                    case when :is_full_sync then null else now() end)
            on conflict (profile_id, provider) do update set
                cursor = excluded.cursor,
                last_full_sync_at = case when :is_full_sync then now() else public.source_sync_state.last_full_sync_at end,
                last_delta_sync_at = case when :is_full_sync then public.source_sync_state.last_delta_sync_at else now() end
            """
        ),
        {"profile_id": profile_id, "provider": provider, "cursor": cursor, "is_full_sync": is_full_sync},
    )


async def sync_gmail_signals(session: AsyncSession, *, profile_id: UUID, access_token: str, settings: Settings) -> SyncSummary:
    """Upsert Gmail messages into ``source_signals``. Backfill on first run
    (bounded to the connector's existing 50-message window -- see
    product expansion §53 on progressive backfill for the full-history case);
    delta (``history.list``) on every later run. Never reprocesses a message
    whose content hasn't changed -- ``upsert_signal`` is the single dedupe gate."""

    cursor = await _cursor(session, profile_id, "gmail")
    if cursor is None:
        items = await fetch_gmail_items(access_token, settings)
        new_history_id = await fetch_gmail_profile_history_id(access_token, settings)
        mode = "backfill"
    else:
        items, new_history_id, resync_required = await fetch_gmail_history(access_token, settings, cursor)
        if resync_required:
            logger.info("gmail_sync_cursor_expired_refetching", extra={"profile_id": str(profile_id)})
            items = await fetch_gmail_items(access_token, settings)
            new_history_id = await fetch_gmail_profile_history_id(access_token, settings)
            mode = "backfill"
        else:
            mode = "delta"

    changed = 0
    for item in items:
        result = await upsert_signal(
            session,
            profile_id=profile_id,
            source="gmail",
            external_id=item.external_id,
            title=item.title,
            snippet=item.snippet,
            sender=(item.raw.get("payload", {}).get("headers") and next(
                (h["value"] for h in item.raw["payload"]["headers"] if h["name"] == "From"), None
            )) if isinstance(item.raw, dict) else None,
            event_date=item.occurred_on,
        )
        if result.changed:
            changed += 1

    if new_history_id:
        await _store_cursor(session, profile_id, "gmail", new_history_id, is_full_sync=(mode == "backfill"))

    return SyncSummary(provider="gmail", mode=mode, fetched=len(items), new_or_changed=changed)


async def _upsert_harvested(session: AsyncSession, profile_id: UUID, source: str, items: list) -> int:
    changed = 0
    for item in items:
        result = await upsert_signal(
            session, profile_id=profile_id, source=source, external_id=item.external_id,
            title=item.title, snippet=item.snippet, event_date=item.occurred_on,
        )
        if result.changed:
            changed += 1
    return changed


async def sync_calendar_signals(session: AsyncSession, *, profile_id: UUID, access_token: str, settings: Settings) -> SyncSummary:
    """Upsert Calendar events into ``source_signals``. Backfill (no stored
    syncToken) on first run; delta (``events.list?syncToken=``) after."""

    cursor = await _cursor(session, profile_id, "google_calendar")
    items, new_sync_token, resync_required = await fetch_calendar_delta(access_token, settings, sync_token=cursor)
    mode = "delta" if cursor else "backfill"
    if resync_required:
        logger.info("calendar_sync_cursor_expired_refetching", extra={"profile_id": str(profile_id)})
        items, new_sync_token, _ = await fetch_calendar_delta(access_token, settings, sync_token=None)
        mode = "backfill"

    changed = await _upsert_harvested(session, profile_id, "google_calendar", items)
    if new_sync_token:
        await _store_cursor(session, profile_id, "google_calendar", new_sync_token, is_full_sync=(mode == "backfill"))
    return SyncSummary(provider="google_calendar", mode=mode, fetched=len(items), new_or_changed=changed)


async def sync_drive_signals(session: AsyncSession, *, profile_id: UUID, access_token: str, settings: Settings) -> SyncSummary:
    """Upsert Drive files into ``source_signals``. Backfill via the existing
    bounded file list on first run (product expansion §53's bounded first
    backfill), establishing a ``startPageToken`` cursor at the same time;
    delta (``changes.list``) on every later run."""

    cursor = await _cursor(session, profile_id, "google_drive")
    if cursor is None:
        items = await fetch_drive_items(access_token, settings)
        new_cursor = await fetch_drive_start_page_token(access_token, settings)
        mode = "backfill"
    else:
        items, new_cursor = await fetch_drive_changes(access_token, settings, cursor)
        mode = "delta"
        if new_cursor is None:
            new_cursor = cursor

    changed = await _upsert_harvested(session, profile_id, "google_drive", items)
    if new_cursor:
        await _store_cursor(session, profile_id, "google_drive", new_cursor, is_full_sync=(mode == "backfill"))
    return SyncSummary(provider="google_drive", mode=mode, fetched=len(items), new_or_changed=changed)
