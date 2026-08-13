"""USP 4 (Proof Later) — suggest which pending-evidence activity a newly
uploaded file is proof for.

Deterministic title/organization similarity, reusing the same token-overlap
approach as reconstruction correlation (services/reconstruct.py) rather than
a second bespoke algorithm. Never auto-attaches: the caller always presents
this as a one-tap suggestion.
"""

from __future__ import annotations

import re
from typing import Any

MATCH_THRESHOLD = 0.25


def _normalize(value: str) -> set[str]:
    return set(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())


def _similarity(a: str, b: str) -> float:
    tokens_a, tokens_b = _normalize(a), _normalize(b)
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / max(len(tokens_a), len(tokens_b))


def find_evidence_matches(evidence: dict[str, Any], pending_activities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return pending activities this evidence file plausibly proves, best first."""

    evidence_text = " ".join(filter(None, [
        evidence.get("file_name", ""),
        evidence.get("extracted_title") or "",
        evidence.get("organization") or "",
    ]))
    scored: list[tuple[float, dict[str, Any]]] = []
    for activity in pending_activities:
        activity_text = " ".join(filter(None, [activity.get("title", ""), activity.get("organization") or ""]))
        score = _similarity(evidence_text, activity_text)
        if score >= MATCH_THRESHOLD:
            scored.append((score, activity))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [{"activity": activity, "score": round(score, 2)} for score, activity in scored]
