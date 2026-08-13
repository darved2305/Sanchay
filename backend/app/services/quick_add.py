"""Natural-language activity parsing shared by Quick Add and Voice Dump.

Deterministic-first: a keyword/regex pass always produces a usable proposed
activity. When an LLM provider is configured, its structured extraction
replaces the heuristic result only when it returns successfully, per the
product rule "deterministic before ML, ML before LLM" (PROJECT_V2.md §3.6).
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from ..core.academic_year import derive_academic_year
from .llm import LLMProvider

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "teaching": ["lecture", "class", "taught", "teaching", "lab session"],
    "workshop_fdp": ["fdp", "faculty development", "workshop"],
    "seminar": ["seminar"],
    "invited_talk": ["invited talk", "guest lecture", "keynote"],
    "mentorship": ["mentored", "mentoring", "supervised", "guided"],
    "committee": ["committee", "convener", "coordinator duty"],
    "institutional_service": ["institutional duty", "exam duty", "invigilation"],
    "community_engagement": ["outreach", "community engagement", "ngo"],
    "reviewing": ["reviewed a paper", "peer review", "reviewer for"],
    "conference": ["conference", "presented a paper", "paper presentation"],
    "research": ["research", "experiment", "study conducted"],
    "project": ["project work", "project meeting"],
    "award": ["award", "recognition", "won a"],
    "patent": ["patent"],
}

DURATION_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*hour", re.IGNORECASE)

QUICK_ADD_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {
            "type": "string",
            "enum": [
                "teaching", "research", "publication", "project", "grant", "workshop_fdp",
                "seminar", "invited_talk", "mentorship", "committee", "institutional_service",
                "community_engagement", "award", "patent", "reviewing", "conference", "other",
            ],
        },
        "title": {"type": "string"},
        "organization": {"type": ["string", "null"]},
        "duration_hours": {"type": ["number", "null"]},
    },
    "required": ["category", "title", "organization", "duration_hours"],
}


def _heuristic_parse(text_input: str) -> dict[str, Any]:
    lowered = text_input.lower()
    category = "other"
    for candidate, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            category = candidate
            break
    duration_match = DURATION_RE.search(lowered)
    duration_hours = float(duration_match.group(1)) if duration_match else None
    title = text_input.strip()
    if len(title) > 300:
        title = title[:297] + "..."
    return {"category": category, "title": title, "organization": None, "duration_hours": duration_hours}


def _resolve_date(text_input: str) -> date:
    lowered = text_input.lower()
    today = date.today()
    if "yesterday" in lowered:
        return today - timedelta(days=1)
    return today


async def parse_quick_add(text_input: str, llm: LLMProvider) -> dict[str, Any]:
    """Return a draft activity payload: category, title, organization, duration, date, academic_year."""

    parsed = _heuristic_parse(text_input)
    llm_result = await llm.extract_structured(
        instruction=(
            "Extract one academic activity from a professor's short natural-language note. "
            "Pick the closest matching category from the enum. Keep the title concise and factual, "
            "derived only from the note -- never invent an organization or duration that isn't stated."
        ),
        source_text=text_input,
        json_schema=QUICK_ADD_SCHEMA,
        schema_name="quick_add_activity",
    )
    if llm_result and llm_result.get("category") and llm_result.get("title"):
        parsed.update({k: v for k, v in llm_result.items() if v not in (None, "")})
    occurred_on = _resolve_date(text_input)
    parsed["start_date"] = occurred_on
    parsed["academic_year"] = derive_academic_year(occurred_on)
    return parsed
