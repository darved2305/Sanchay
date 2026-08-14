"""Adaptive Career Navigator (product expansion §26-33): natural-language
career goals, deterministic goal suggestions, milestone progress, and
cross-feature opportunity matching.

Two goal *sources* feed one goal *model* (docs/EXPANSION_ARCHITECTURE_AUDIT.md):
the existing institution-authored ``career_rules``/``career_goals`` catalog
(USP 8, unchanged) stays the promotion-readiness path; ``custom_career_goals``
(016_career_navigator.sql) is the new user-authored/system-suggested path.
Both render through the same "concrete counts, explainable reasons, never a
fake percentage" discipline as ``services/career.py``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from .llm import LLMProvider

_YEAR_PATTERN = re.compile(r"\b(20\d{2})\b")
_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
_MONTH_YEAR_PATTERN = re.compile(r"\b(" + "|".join(_MONTHS) + r")\s+(20\d{2})\b", re.IGNORECASE)
_IN_N_YEARS_PATTERN = re.compile(r"in\s+the\s+next\s+(\d+)\s+years?", re.IGNORECASE)
_COUNT_PATTERN = re.compile(r"\b(\d+)\b")


def _deterministic_target_date(text: str, today: date) -> str | None:
    """Never invents a date -- only extracts one explicitly implied by the
    text (an explicit year, "by <Month> <Year>", or "in the next N years")."""

    month_year = _MONTH_YEAR_PATTERN.search(text)
    if month_year:
        month = _MONTHS[month_year.group(1).lower()]
        year = int(month_year.group(2))
        return date(year, month, 28).isoformat()
    n_years = _IN_N_YEARS_PATTERN.search(text)
    if n_years:
        return date(today.year + int(n_years.group(1)), today.month, min(today.day, 28)).isoformat()
    year_only = _YEAR_PATTERN.search(text)
    if year_only:
        return date(int(year_only.group(1)), 12, 31).isoformat()
    return None


_OUTCOME_CATEGORY_HINTS = [
    ("journal", "publication", "publications"), ("paper", "publication", "publications"),
    ("publish", "publication", "publications"), ("grant", "grant", "grants"),
    ("funding", "grant", "grants"), ("phd", "mentorship", "PhD students supervised"),
    ("mentor", "mentorship", "mentorship activities"), ("collaborat", "collaboration", "collaborations"),
    ("patent", "patent", "patents"),
]


def _deterministic_outcomes(text: str) -> list[dict[str, Any]]:
    """A best-effort single measurable outcome from an explicit count in the
    text (e.g. "3 Q1 journal papers") -- empty if no count is stated, which
    is the honest answer, not a guess."""

    lowered = text.lower()
    for keyword, key, label in _OUTCOME_CATEGORY_HINTS:
        if keyword in lowered:
            count_match = _COUNT_PATTERN.search(lowered)
            target = int(count_match.group(1)) if count_match else 1
            return [{"key": key, "label": label, "target": target}]
    return []


@dataclass
class ParsedGoal:
    title: str
    description: str
    target_date: str | None
    measurable_outcomes: list[dict[str, Any]] = field(default_factory=list)


async def parse_goal_text(raw_text: str, today: date, llm: LLMProvider) -> ParsedGoal:
    """Parses free-text into a structured goal for the faculty to review and
    confirm (§27) -- never auto-saved. Deterministic extraction runs first
    and is always the fallback; the LLM only refines wording/labels."""

    deterministic_date = _deterministic_target_date(raw_text, today)
    deterministic_outcomes = _deterministic_outcomes(raw_text)

    if not llm.configured:
        return ParsedGoal(title=raw_text.strip()[:200], description=raw_text.strip(), target_date=deterministic_date, measurable_outcomes=deterministic_outcomes)

    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "A short goal title, under 15 words"},
            "description": {"type": "string"},
            "measurable_outcomes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "enum": ["publication", "grant", "mentorship", "collaboration", "patent", "other"]},
                        "label": {"type": "string"},
                        "target": {"type": "integer"},
                    },
                    "required": ["key", "label", "target"],
                },
            },
        },
        "required": ["title", "description"],
    }
    result = await llm.extract_structured(
        instruction=(
            "A university faculty member typed a career goal in their own words. Produce a short title, "
            "a one-sentence description, and any explicitly stated measurable outcomes (a count of "
            "publications, grants, mentored students, collaborations, or patents). Only include an outcome "
            "if a specific number is stated or clearly implied (e.g. 'three papers' -> target 3). "
            "Never invent a number that isn't in the text."
        ),
        source_text=raw_text,
        json_schema=schema,
        schema_name="career_goal",
    )
    if not result:
        return ParsedGoal(title=raw_text.strip()[:200], description=raw_text.strip(), target_date=deterministic_date, measurable_outcomes=deterministic_outcomes)
    return ParsedGoal(
        title=(result.get("title") or raw_text.strip()[:200]),
        description=(result.get("description") or raw_text.strip()),
        target_date=deterministic_date,
        measurable_outcomes=result.get("measurable_outcomes") or deterministic_outcomes,
    )


# ---------- System-suggested goals (§28): deterministic gap detection ----------

@dataclass
class SuggestedGoal:
    key: str
    title: str
    description: str
    reasons: list[str]
    measurable_outcomes: list[dict[str, Any]] = field(default_factory=list)


def suggest_goals(
    *,
    activity_counts: dict[str, int],
    connection_count: int,
    top_research_interest: str | None,
    has_active_grant_goal: bool,
) -> list[SuggestedGoal]:
    """Every suggestion traces to concrete counts already on record -- never
    a hidden model score (§28/§67). Nothing here is saved as an active goal;
    the caller only persists one after the faculty explicitly accepts it."""

    suggestions: list[SuggestedGoal] = []
    publications = activity_counts.get("publication", 0)
    grants = activity_counts.get("grant", 0)
    mentorships = activity_counts.get("mentorship", 0)

    if publications >= 3 and grants == 0 and not has_active_grant_goal:
        topic = f" in {top_research_interest}" if top_research_interest else ""
        suggestions.append(SuggestedGoal(
            key="first_grant",
            title=f"Secure your first research grant{topic}",
            description=f"You have {publications} confirmed publications but no funded project yet — a strong base for a grant application.",
            reasons=[f"{publications} confirmed publications on record", "No grant recorded yet", "Active GrantOps opportunities may already match your discipline"],
            measurable_outcomes=[{"key": "grant", "label": "Funded research grant", "target": 1}],
        ))

    if connection_count < 2:
        suggestions.append(SuggestedGoal(
            key="build_network",
            title="Build your research collaboration network",
            description="Connecting with more researchers in your area opens co-authorship, mentorship, and grant-team opportunities.",
            reasons=[f"Only {connection_count} connection(s) in your Professional Network so far"],
            measurable_outcomes=[{"key": "collaboration", "label": "Research connections", "target": 4}],
        ))

    if publications >= 5 and mentorships == 0:
        suggestions.append(SuggestedGoal(
            key="start_mentoring",
            title="Take on student mentorship",
            description="A strong publication record is also a strong foundation to start mentoring students on research projects.",
            reasons=[f"{publications} confirmed publications on record", "No mentorship activity recorded yet"],
            measurable_outcomes=[{"key": "mentorship", "label": "Mentored students", "target": 1}],
        ))

    return suggestions


# ---------- Progress (§32): concrete counts, never a fake percentage ----------

def compute_custom_goal_progress(measurable_outcomes: list[dict[str, Any]], activity_counts: dict[str, int]) -> dict[str, Any]:
    outcomes: list[dict[str, Any]] = []
    for outcome in measurable_outcomes:
        key = outcome.get("key", "other")
        target = int(outcome.get("target") or 0)
        count = activity_counts.get(key, 0)
        outcomes.append({
            "key": key, "label": outcome.get("label", key), "count": count, "target": target,
            "satisfied": count >= target if target else True,
            "tracked": key in activity_counts,
        })
    satisfied = all(o["satisfied"] for o in outcomes) if outcomes else False
    return {"outcomes": outcomes, "satisfied": satisfied}


# ---------- Opportunities for a goal (§31/§34): keyword overlap, reasons only ----------

def _tokenize(*texts: str | None) -> set[str]:
    tokens: set[str] = set()
    for text in texts:
        if not text:
            continue
        tokens |= {w.strip(".,;:()").lower() for w in text.split() if len(w.strip(".,;:()")) > 3}
    return tokens


def match_inbox_items_to_goal(goal_text: str, inbox_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    goal_tokens = _tokenize(goal_text)
    matches = []
    for item in inbox_items:
        topics = item.get("research_topics") or []
        item_tokens = _tokenize(item.get("subject"), item.get("summary"), " ".join(topics))
        overlap = sorted(goal_tokens & item_tokens)
        topic_overlap = [t for t in topics if _tokenize(t) & goal_tokens]
        if topic_overlap or len(overlap) >= 2:
            reasons = []
            if topic_overlap:
                reasons.append(f"Topic matches your goal: {', '.join(topic_overlap)}")
            if overlap and not topic_overlap:
                reasons.append(f"Related terms: {', '.join(overlap[:3])}")
            matches.append({"inbox_item_id": item["id"], "subject": item.get("subject"), "reasons": reasons})
    return matches


def match_grants_to_goal(goal_text: str, grant_opportunities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    goal_tokens = _tokenize(goal_text)
    matches = []
    for grant in grant_opportunities:
        disciplines = grant.get("disciplines") or []
        overlap = [d for d in disciplines if _tokenize(d) & goal_tokens]
        title_tokens = _tokenize(grant.get("title"), grant.get("description"))
        term_overlap = sorted(goal_tokens & title_tokens)
        if overlap or len(term_overlap) >= 2:
            reasons = []
            if overlap:
                reasons.append(f"Discipline matches your goal: {', '.join(overlap)}")
            if term_overlap and not overlap:
                reasons.append(f"Related terms: {', '.join(term_overlap[:3])}")
            matches.append({"grant_opportunity_id": grant["id"], "title": grant.get("title"), "reasons": reasons})
    return matches
