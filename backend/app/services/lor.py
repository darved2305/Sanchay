"""USP 10 — LOR Studio: draft a recommendation letter grounded only in real
recorded faculty-student history.

The deterministic template (``draft_letter``) already produces a complete,
factual letter from nothing but retrieved facts -- no LLM is required to
satisfy "no invented achievements." When a provider is configured, it's used
only to smooth the deterministic draft into more natural prose, constrained
to rephrase the same facts, never to add new ones.
"""

from __future__ import annotations

from datetime import date
from typing import Any

PURPOSE_LABELS = {
    "ms": "admission to a Master's program",
    "job": "a professional position",
    "scholarship": "a scholarship",
    "phd": "admission to a PhD program",
}


def _format_date(value: date | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return value.strftime("%B %Y")


def draft_letter(facts: dict[str, Any]) -> str:
    """Deterministic, fully-grounded letter text from retrieved facts alone."""

    student_name = facts["student_name"]
    purpose_label = PURPOSE_LABELS.get(facts["purpose"], facts["purpose"])
    faculty_name = facts["faculty_name"]
    designation = facts.get("designation") or "Faculty"
    institution_name = facts.get("institution_name") or "the institution"
    links = facts.get("links", [])
    achievements = facts.get("achievements", [])

    lines = ["To Whom It May Concern,", ""]
    lines.append(f"I am pleased to write this letter of recommendation for {student_name} in support of their application for {purpose_label}.")
    lines.append("")

    for link in links:
        relationship = link.get("relationship", "mentor")
        course = link.get("course_or_project")
        start = _format_date(link.get("start_date"))
        end = _format_date(link.get("end_date"))
        period = f" from {start} to {end}" if start and end else (f" since {start}" if start else "")
        course_clause = f" for {course}" if course else ""
        lines.append(f"I served as {student_name}'s {relationship}{course_clause}{period}.")
    lines.append("")

    if achievements:
        lines.append(f"During this time, {student_name} demonstrated strong ability, including:")
        for achievement in achievements:
            achieved_on = _format_date(achievement.get("achieved_on"))
            suffix = f" ({achieved_on})" if achieved_on else ""
            lines.append(f"- {achievement['title']}{suffix}: {achievement.get('description') or ''}".rstrip(": "))
        lines.append("")

    notes = [link.get("notes") for link in links if link.get("notes")]
    if notes:
        lines.append(" ".join(notes))
        lines.append("")

    lines.append(f"Based on this experience, I recommend {student_name} without reservation for {purpose_label}.")
    lines.append("")
    lines.append("Sincerely,")
    lines.append(faculty_name)
    lines.append(f"{designation}, {institution_name}")
    return "\n".join(lines)


LOR_POLISH_SCHEMA = {
    "type": "object",
    "properties": {"letter_text": {"type": "string"}},
    "required": ["letter_text"],
}


async def polish_letter(deterministic_draft: str, llm: Any) -> str:
    """Rephrase the deterministic draft into more natural prose, constrained
    to the exact facts already in it. Falls back to the deterministic draft
    verbatim when no provider is configured."""

    result = await llm.extract_structured(
        instruction=(
            "Rewrite this recommendation letter draft in warmer, more natural academic prose. "
            "Do not add, remove, or alter any fact, date, achievement, or claim -- only improve phrasing "
            "and flow. If in doubt, keep the original wording."
        ),
        source_text=deterministic_draft,
        json_schema=LOR_POLISH_SCHEMA,
        schema_name="polished_letter",
    )
    polished = result.get("letter_text") if result else None
    return polished if polished and polished.strip() else deterministic_draft
