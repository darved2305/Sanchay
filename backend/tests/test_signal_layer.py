"""Pure-function tests for the shared source-signal layer (no live DB).

Live upsert/dedupe/hash-gating behavior against the hosted Supabase project
was verified manually (insert -> identical re-upsert stays "unprocessed" ->
classify -> identical re-upsert reports changed=False -> content change flips
back to changed=True and re-enters the unprocessed queue -> cleanup leaves
zero rows). ``upsert_signal`` requires a live AsyncSession, which this
project's live-DB tests intentionally keep opt-in (``require_live_environment``)
to protect the shared seeded database from test writes, so only the pure hash
function is covered here.
"""

from __future__ import annotations

from app.services.signals import compute_content_hash


def test_content_hash_stable_for_identical_content() -> None:
    a = compute_content_hash(title="Invited Talk", snippet="IEEE Mumbai", sender="x@y.com", event_date="2026-08-01")
    b = compute_content_hash(title="Invited Talk", snippet="IEEE Mumbai", sender="x@y.com", event_date="2026-08-01")
    assert a == b


def test_content_hash_changes_when_snippet_changes() -> None:
    a = compute_content_hash(title="Invited Talk", snippet="IEEE Mumbai", sender="x@y.com", event_date="2026-08-01")
    b = compute_content_hash(title="Invited Talk", snippet="IEEE Mumbai, reply by 30 Aug", sender="x@y.com", event_date="2026-08-01")
    assert a != b


def test_content_hash_ignores_field_order_via_explicit_kwargs() -> None:
    # sort_keys=True means the JSON payload key order can't matter; this
    # guards against a future refactor accidentally making the hash
    # dict-insertion-order-dependent.
    a = compute_content_hash(title="T", snippet="S", sender="s@e.com", event_date=None)
    b = compute_content_hash(sender="s@e.com", event_date=None, title="T", snippet="S")
    assert a == b


def test_content_hash_treats_missing_optional_fields_consistently() -> None:
    a = compute_content_hash(title="T", snippet="S", sender=None, event_date=None)
    b = compute_content_hash(title="T", snippet="S", sender="", event_date="")
    assert a == b
