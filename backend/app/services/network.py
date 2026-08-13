"""USP 9 — Academic Network: explainable recommendations, never a bare score.

Per PROJECT_V2.md USP 9: recommendations must be explainable ("Works on
medical imaging; supervises PhD scholars; open to mentorship"), not a black-box
rank. This scores candidates by concrete overlap with the searcher's own
tags/intent and returns the specific matching reasons alongside each result --
the reason list *is* the explanation, not a paraphrase of a hidden score.
"""

from __future__ import annotations

from typing import Any

INTENT_FLAGS = {
    "mentor": "open_to_mentorship",
    "phd_supervisor": "accepting_phd_inquiries",
    "collaborator": "open_to_collaboration",
}


def _overlap(a: list[str] | None, b: list[str] | None) -> list[str]:
    set_a = {v.lower() for v in (a or [])}
    set_b = {v.lower() for v in (b or [])}
    return sorted(set_a & set_b)


def score_candidate(seeker: dict[str, Any], candidate: dict[str, Any], intent: str | None = None) -> dict[str, Any]:
    """Return {score, reasons} for one candidate. Higher score = more overlap.
    Every point of score traces to a human-readable reason string."""

    reasons: list[str] = []
    score = 0

    shared_research = _overlap(seeker.get("research_interests"), candidate.get("research_interests"))
    if shared_research:
        score += len(shared_research) * 2
        reasons.append(f"Shared research interests: {', '.join(shared_research)}")

    shared_expertise = _overlap(seeker.get("expertise"), candidate.get("expertise"))
    if shared_expertise:
        score += len(shared_expertise) * 2
        reasons.append(f"Shared expertise: {', '.join(shared_expertise)}")

    if seeker.get("department_name") and seeker.get("department_name") == candidate.get("department_name"):
        score += 1
        reasons.append(f"Same department ({candidate['department_name']})")

    if intent and intent in INTENT_FLAGS and candidate.get(INTENT_FLAGS[intent]):
        score += 3
        label = {"mentor": "open to mentorship", "phd_supervisor": "accepting PhD inquiries", "collaborator": "open to collaboration"}[intent]
        reasons.append(f"Marked {label}")

    return {"profile_id": candidate["id"], "score": score, "reasons": reasons}


def rank_candidates(seeker: dict[str, Any], candidates: list[dict[str, Any]], intent: str | None = None) -> list[dict[str, Any]]:
    """Score and sort candidates, dropping anyone with zero overlap -- an
    empty reason list would mean an unexplainable recommendation, which the
    product spec explicitly forbids."""

    scored = [score_candidate(seeker, c, intent) for c in candidates]
    explainable = [item for item in scored if item["reasons"]]
    explainable.sort(key=lambda item: item["score"], reverse=True)
    return explainable
