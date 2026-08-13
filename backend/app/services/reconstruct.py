"""USP 1 — Reconstruct My Year: harvest -> filter -> classify -> correlate -> score.

Pipeline stages are deterministic-first (PROJECT_V2.md §3.6): a keyword rule
pack decides whether a harvested item is academic at all, and a date+title
similarity pass does the cross-source correlation ("Calendar event + Gmail
thank-you + Drive certificate become ONE candidate, not three" -- USP 1's
signature example). An LLM, when configured, only refines the category label
of an already-filtered item; it never decides inclusion.
"""

from __future__ import annotations

import re
from dataclasses import asdict
from datetime import date, datetime, timedelta
from typing import Any

from ..connectors.google import HarvestedItem
from .llm import LLMProvider

REVIEWER_THANKS_KEYWORDS = ["thank you for reviewing", "thanks for reviewing", "review of manuscript"]

CATEGORY_KEYWORDS: list[tuple[str, str]] = [
    ("fdp", "workshop_fdp"),
    ("workshop", "workshop_fdp"),
    ("faculty development", "workshop_fdp"),
    ("seminar", "seminar"),
    ("invited talk", "invited_talk"),
    ("invited lecture", "invited_talk"),
    ("keynote", "invited_talk"),
    ("review", "reviewing"),
    ("manuscript", "reviewing"),
    ("committee", "committee"),
    ("viva", "institutional_service"),
    ("examination duty", "institutional_service"),
    ("mentor", "mentorship"),
    ("supervis", "mentorship"),
    ("conference", "conference"),
    ("certificate", "workshop_fdp"),
]

# Calendar events in particular tend to have nothing but a short title (no
# body/snippet to fall back on), so every term classify_category() knows how
# to label must also be recognized as an academic signal in the first place
# -- otherwise a correctly-classifiable item (e.g. "Keynote: ...") never
# reaches classification because it was filtered out one step earlier.
ACADEMIC_KEYWORDS: list[str] = list({
    "talk", "lecture", "seminar", "workshop", "fdp", "conference", "invited",
    "certificate", "review", "reviewing", "manuscript", "committee", "mentor",
    "supervis", "publication", "paper", "grant", "patent", "award", "viva",
    "examination duty", "convener", "coordinator",
    *(keyword for keyword, _category in CATEGORY_KEYWORDS),
})


def is_academic_signal(item: HarvestedItem) -> bool:
    text = f"{item.title} {item.snippet}".lower()
    return any(keyword in text for keyword in ACADEMIC_KEYWORDS)


def classify_category(item: HarvestedItem) -> str:
    text = f"{item.title} {item.snippet}".lower()
    for keyword, category in CATEGORY_KEYWORDS:
        if keyword in text:
            return category
    return "other"


def _normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _title_similarity(a: str, b: str) -> float:
    tokens_a = set(_normalize_title(a).split())
    tokens_b = set(_normalize_title(b).split())
    if not tokens_a or not tokens_b:
        return 0.0
    overlap = len(tokens_a & tokens_b)
    return overlap / max(len(tokens_a), len(tokens_b))


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def correlate_signals(items: list[HarvestedItem], *, date_window_days: int = 5, title_threshold: float = 0.2) -> list[list[HarvestedItem]]:
    """Group harvested items into candidate clusters.

    Two items correlate when their occurrence dates fall within
    ``date_window_days`` of each other AND their titles/snippets share at
    least ``title_threshold`` token overlap. This is what turns a Calendar
    invite, a thank-you email, and a certificate file into one proposal.
    """

    remaining = list(items)
    clusters: list[list[HarvestedItem]] = []
    while remaining:
        seed = remaining.pop(0)
        cluster = [seed]
        seed_date = _parse_date(seed.occurred_on)
        still_remaining: list[HarvestedItem] = []
        for candidate in remaining:
            candidate_date = _parse_date(candidate.occurred_on)
            within_window = (
                seed_date is not None
                and candidate_date is not None
                and abs((candidate_date - seed_date).days) <= date_window_days
            )
            similar_title = max(
                _title_similarity(seed.title, candidate.title),
                _title_similarity(seed.snippet, candidate.snippet),
                _title_similarity(seed.title, candidate.snippet),
            ) >= title_threshold
            if within_window and similar_title:
                cluster.append(candidate)
            else:
                still_remaining.append(candidate)
        remaining = still_remaining
        clusters.append(cluster)
    return clusters


def score_confidence(cluster: list[HarvestedItem]) -> float:
    """More corroborating sources -> higher confidence. Never auto-confirms."""

    source_types = {item.source_type for item in cluster}
    base = {1: 0.5, 2: 0.75}.get(len(source_types), 0.9)
    return min(0.95, base)


_SOURCE_TITLE_PRIORITY = {"google_calendar": 0, "google_drive": 1, "gmail": 2}


def build_candidate_draft(cluster: list[HarvestedItem]) -> dict[str, Any]:
    # Calendar/Drive titles ("IEEE Invited Talk", "certificate.pdf") tend to
    # name the event itself; Gmail subject lines ("Thank you for...") don't.
    # Prefer the most canonical-looking title, falling back to the longest.
    primary = min(
        cluster,
        key=lambda item: (_SOURCE_TITLE_PRIORITY.get(item.source_type, 9), -len(item.title)),
    )
    dates = [d for d in (_parse_date(item.occurred_on) for item in cluster) if d is not None]
    occurred_on = min(dates) if dates else None
    return {
        "category": classify_category(primary),
        "title": primary.title or primary.snippet[:120],
        "organization": None,
        "start_date": occurred_on,
        "confidence": score_confidence(cluster),
        "sources": [
            {"source_type": item.source_type, "source_ref": item.external_id, "snippet": item.snippet, "raw": item.raw}
            for item in cluster
        ],
    }


_CATEGORY_ENUM = [
    "teaching", "research", "publication", "project", "grant", "workshop_fdp",
    "seminar", "invited_talk", "mentorship", "committee", "institutional_service",
    "community_engagement", "award", "patent", "reviewing", "conference", "other",
]

_CATEGORY_REFINEMENT_SCHEMA = {
    "type": "object",
    "properties": {"category": {"type": "string", "enum": _CATEGORY_ENUM}},
    "required": ["category"],
}


async def _refine_category(cluster: list[HarvestedItem], deterministic_category: str, llm: LLMProvider) -> str:
    """Let the LLM re-pick the category label for an already-filtered, already-clustered
    item -- it never decides whether something is academic or which items correlate,
    only which of the fixed enum labels fits best. Keyword matching alone (classify_category)
    misses activities that don't happen to use one of its exact trigger words."""

    combined = "\n".join(f"[{item.source_type}] {item.title} -- {item.snippet}" for item in cluster)
    result = await llm.extract_structured(
        instruction=(
            "These are correlated signals (calendar/email/drive) describing one academic "
            "activity for a university faculty member. Pick the single closest category "
            "from the enum. If genuinely unclear, choose 'other'."
        ),
        source_text=combined,
        json_schema=_CATEGORY_REFINEMENT_SCHEMA,
        schema_name="reconstruct_category",
    )
    category = result.get("category") if result else None
    return category if category in _CATEGORY_ENUM else deterministic_category


async def run_pipeline(harvested: list[HarvestedItem], llm: LLMProvider | None = None) -> list[dict[str, Any]]:
    """Full harvest -> filter -> correlate -> score pipeline.

    Inclusion (is_academic_signal) and correlation (correlate_signals) stay fully
    deterministic regardless of ``llm`` -- only the category label of an
    already-formed candidate is eligible for LLM refinement.
    """

    academic_items = [item for item in harvested if is_academic_signal(item)]
    clusters = correlate_signals(academic_items)
    drafts = [build_candidate_draft(cluster) for cluster in clusters]
    if llm is not None and llm.configured:
        for draft, cluster in zip(drafts, clusters):
            draft["category"] = await _refine_category(cluster, draft["category"], llm)
    return drafts
