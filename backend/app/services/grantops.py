"""GrantOps (product expansion §18-25): deterministic eligibility, document
readiness, and team-formation reasoning for the research-funding workflow.

Same discipline as career.py's rule evaluation (USP 8) and network.py's
candidate scoring (USP 9): every verdict traces to a plain, human-readable
reason. Never "AI says 81% eligible" (§21) and never an opaque collaborator
rank (§23).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# ---------- Eligibility (§21) ----------

_DESIGNATION_RANK = {
    "assistant professor": 1,
    "associate professor": 2,
    "professor": 3,
    "hod": 3,
    "principal": 4,
    "director": 4,
}


def _designation_rank(designation: str | None) -> int:
    if not designation:
        return 0
    return _DESIGNATION_RANK.get(designation.strip().lower(), 0)


@dataclass
class EligibilityResult:
    status: str  # eligible | possibly_eligible | not_currently_eligible
    reasons: list[str] = field(default_factory=list)


def evaluate_eligibility(
    *,
    rules: dict[str, Any],
    designation: str | None,
    phd_status: str | None,
    publication_count: int,
    grant_count: int,
    disciplines: list[str],
    faculty_research_interests: list[str],
) -> EligibilityResult:
    """Every rule that fails becomes a concrete, stated reason -- a professor
    always sees exactly which criterion is short, never a probability."""

    reasons: list[str] = []
    hard_fail = False
    soft_fail = False

    min_rank = _DESIGNATION_RANK.get((rules.get("min_designation") or "").strip().lower())
    if min_rank:
        candidate_rank = _designation_rank(designation)
        if candidate_rank >= min_rank:
            reasons.append(f"Designation ({designation}) meets the minimum ({rules['min_designation']})")
        else:
            hard_fail = True
            reasons.append(f"Requires designation at or above {rules['min_designation']}; current designation is {designation or 'not set'}")

    if rules.get("requires_phd"):
        if (phd_status or "").strip().lower() in {"completed", "phd", "yes", "awarded"}:
            reasons.append("PhD requirement satisfied")
        else:
            hard_fail = True
            reasons.append("Requires a completed PhD; profile does not show one")

    min_publications = int(rules.get("min_publications") or 0)
    if min_publications:
        if publication_count >= min_publications:
            reasons.append(f"Publication count ({publication_count}) meets the minimum ({min_publications})")
        else:
            soft_fail = True
            reasons.append(f"Requires {min_publications} publication(s); {publication_count} confirmed on record")

    min_grants = int(rules.get("min_grants") or 0)
    if min_grants:
        if grant_count >= min_grants:
            reasons.append(f"Prior grant count ({grant_count}) meets the minimum ({min_grants})")
        else:
            soft_fail = True
            reasons.append(f"Requires {min_grants} prior grant(s); {grant_count} confirmed on record")

    required_disciplines = {d.lower() for d in (rules.get("disciplines") or disciplines or [])}
    if required_disciplines:
        overlap = required_disciplines & {d.lower() for d in faculty_research_interests}
        if overlap:
            reasons.append(f"Research interests overlap the grant's discipline: {', '.join(sorted(overlap))}")
        else:
            soft_fail = True
            reasons.append(f"No overlap found between your research interests and this grant's discipline ({', '.join(sorted(required_disciplines))})")

    if not reasons:
        reasons.append("No specific eligibility rules configured for this grant; review the call text directly")

    if hard_fail:
        status = "not_currently_eligible"
    elif soft_fail:
        status = "possibly_eligible"
    else:
        status = "eligible"
    return EligibilityResult(status=status, reasons=reasons)


# ---------- Readiness: required documents already on file (§22) ----------

@dataclass
class ReadinessResult:
    ready: list[str]
    missing: list[str]
    ready_count: int
    total: int


def evaluate_readiness(required_documents: list[str], evidence_document_types: list[str]) -> ReadinessResult:
    """Never asks for a document that's already in the Repository (§22): a
    required label counts as satisfied if any of the faculty's evidence files
    was classified with that exact document_type."""

    on_file = {d for d in evidence_document_types if d}
    ready = [doc for doc in required_documents if doc in on_file]
    missing = [doc for doc in required_documents if doc not in on_file]
    return ReadinessResult(ready=ready, missing=missing, ready_count=len(ready), total=len(required_documents))


# ---------- Team formation (§23): reuse network scoring, add a discipline reason ----------

def team_suggestion_reason(base_reasons: list[str], shared_disciplines: list[str]) -> list[str]:
    reasons = list(base_reasons)
    if shared_disciplines:
        reasons.append(f"Matches this grant's discipline: {', '.join(shared_disciplines)}")
    return reasons
