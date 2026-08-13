"""CV Import Bootstrap (USP 11): CV text -> draft AcademicActivity proposals.

Deterministic-first per PROJECT_V2.md §3.6: a line-scanning heuristic always
produces a usable (if coarse) set of drafts from the extracted CV text. When
an LLM provider is configured, its structured extraction is used instead
because it reads whole sections rather than single lines. Both paths only
ever draw facts from the uploaded document -- nothing is invented.
"""

from __future__ import annotations

import re
from typing import Any

from ..core.academic_year import derive_academic_year
from .llm import LLMProvider

YEAR_RE = re.compile(r"(19|20)\d{2}")

KEYWORD_CATEGORY: list[tuple[str, str]] = [
    ("patent", "patent"),
    ("award", "award"),
    ("grant", "grant"),
    ("fdp", "workshop_fdp"),
    ("faculty development", "workshop_fdp"),
    ("workshop", "workshop_fdp"),
    ("seminar", "seminar"),
    ("invited talk", "invited_talk"),
    ("keynote", "invited_talk"),
    ("conference", "conference"),
    ("published", "publication"),
    ("journal", "publication"),
    ("supervised", "mentorship"),
    ("mentor", "mentorship"),
    ("committee", "committee"),
    ("reviewer", "reviewing"),
    ("project", "project"),
]

CV_IMPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "activities": {
            "type": "array",
            "items": {
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
                    "year": {"type": ["integer", "null"]},
                },
                "required": ["category", "title", "organization", "year"],
            },
        }
    },
    "required": ["activities"],
}


def _heuristic_extract(cv_text: str) -> list[dict[str, Any]]:
    drafts: list[dict[str, Any]] = []
    for raw_line in cv_text.splitlines():
        line = raw_line.strip(" \t•-*")
        if len(line) < 8 or len(line) > 300:
            continue
        lowered = line.lower()
        category = next((cat for keyword, cat in KEYWORD_CATEGORY if keyword in lowered), None)
        if category is None:
            continue
        year_match = YEAR_RE.search(line)
        year = int(year_match.group(0)) if year_match else None
        drafts.append({"category": category, "title": line, "organization": None, "year": year})
    return drafts


async def extract_cv_activities(cv_text: str, llm: LLMProvider) -> list[dict[str, Any]]:
    """Return draft activity dicts: category, title, organization, academic_year."""

    llm_result = await llm.extract_structured(
        instruction=(
            "This is a professor's CV. Extract every distinct academic activity mentioned: "
            "publications, workshops/FDPs attended, invited talks, grants, projects, patents, awards, "
            "committee/service roles, and student supervision. One activity per entry, using the closest "
            "matching category. Extract only what is literally stated in the CV text; never invent an "
            "organization, year, or achievement that isn't written there."
        ),
        source_text=cv_text,
        json_schema=CV_IMPORT_SCHEMA,
        schema_name="cv_import_activities",
        max_source_chars=40000,
    )
    raw_drafts = llm_result.get("activities") if llm_result else None
    if not raw_drafts:
        raw_drafts = _heuristic_extract(cv_text)

    drafts: list[dict[str, Any]] = []
    for item in raw_drafts:
        category = item.get("category") or "other"
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        year = item.get("year")
        academic_year = derive_academic_year(f"{year}-08-01") if isinstance(year, int) and 1900 < year < 2100 else "unspecified"
        drafts.append({
            "category": category,
            "title": title[:300],
            "organization": item.get("organization") or None,
            "academic_year": academic_year,
        })
    return drafts
