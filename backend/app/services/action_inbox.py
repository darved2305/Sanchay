"""Faculty Action Inbox (product expansion §3-7): classify academic mail into
structured actionable objects, explain priority from concrete signals (never
an opaque score), and draft three grounded contextual replies.

Same "deterministic before LLM" shape as the rest of the product
(services/reconstruct.py, services/repository_classify.py): a keyword
prefilter decides whether a signal is worth an LLM call at all; the LLM only
extracts structured fields from text that's already been judged relevant.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .llm import LLMProvider

CATEGORY_KEYWORDS: list[tuple[str, str]] = [
    ("collaborat", "research_collaboration"),
    ("joint proposal", "research_collaboration"),
    ("grant", "grant_opportunity"),
    ("funding call", "grant_opportunity"),
    ("call for proposals", "grant_opportunity"),
    ("manuscript", "publication_journal"),
    ("special issue", "publication_journal"),
    ("journal", "publication_journal"),
    ("review your", "reviewer_invitation"),
    ("reviewer", "reviewer_invitation"),
    ("peer review", "reviewer_invitation"),
    ("conference", "conference"),
    ("call for papers", "conference"),
    ("invited talk", "invited_talk"),
    ("invited lecture", "invited_talk"),
    ("keynote", "invited_talk"),
    ("seminar", "seminar"),
    ("fdp", "fdp_workshop"),
    ("faculty development", "fdp_workshop"),
    ("workshop", "fdp_workshop"),
    ("mentor", "student_mentorship"),
    ("supervis", "student_mentorship"),
    ("internship", "student_mentorship"),
    ("committee", "committee_work"),
    ("board of studies", "committee_work"),
    ("bos", "committee_work"),
    ("submit", "administrative_request"),
    ("form", "administrative_request"),
    ("report", "administrative_request"),
    ("deadline", "deadline"),
    ("opportunity", "academic_opportunity"),
    ("fellowship", "academic_opportunity"),
]

# Broad enough to catch anything category-classifiable, plus generic
# academic-action markers that don't map to one category on their own.
_ACTIONABLE_KEYWORDS = list({kw for kw, _ in CATEGORY_KEYWORDS}) + [
    "please respond", "kindly", "requesting", "invite you", "invited to", "rsvp", "by "
]


def is_actionable_candidate(title: str, snippet: str) -> bool:
    text = f"{title} {snippet}".lower()
    return any(keyword in text for keyword in _ACTIONABLE_KEYWORDS)


def classify_deterministic_category(title: str, body: str) -> str:
    text = f"{title} {body}".lower()
    for keyword, category in CATEGORY_KEYWORDS:
        if keyword in text:
            return category
    return "other"


_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {
            "type": "string",
            "enum": [c for _, c in CATEGORY_KEYWORDS] + ["other", "ignore_non_actionable"],
        },
        "short_summary": {"type": "string"},
        "requested_action": {"type": ["string", "null"]},
        "deadline": {"type": ["string", "null"], "description": "ISO date YYYY-MM-DD if a deadline is explicitly stated, else null"},
        "meeting_date": {"type": ["string", "null"], "description": "ISO date YYYY-MM-DD if a specific meeting/event date is stated, else null"},
        "related_people": {"type": "array", "items": {"type": "string"}},
        "research_topics": {"type": "array", "items": {"type": "string"}},
        "organization": {"type": ["string", "null"]},
    },
    "required": ["category", "short_summary"],
}


@dataclass
class ExtractedInboxItem:
    category: str
    summary: str
    requested_action: str | None = None
    deadline: str | None = None
    meeting_date: str | None = None
    related_people: list[str] = field(default_factory=list)
    research_topics: list[str] = field(default_factory=list)
    organization: str | None = None
    confidence: float = 0.5


async def extract_inbox_item(title: str, sender: str, body: str, llm: LLMProvider) -> ExtractedInboxItem | None:
    """Returns None for mail that isn't actionable (never forces a category
    on genuinely irrelevant mail)."""

    deterministic_category = classify_deterministic_category(title, body)
    if not llm.configured:
        if deterministic_category == "other" and not is_actionable_candidate(title, body):
            return None
        return ExtractedInboxItem(category=deterministic_category, summary=(body or title)[:280], confidence=0.4)

    result = await llm.extract_structured(
        instruction=(
            "This is an email to a university faculty member. Determine whether it is actionable "
            "academic mail (research collaboration, grant/funding, publication/journal, reviewer "
            "invitation, conference, invited talk, seminar, FDP/workshop, student mentorship, "
            "committee work, administrative request, or a deadline) and extract structured fields. "
            "If it is not actionable academic mail (e.g. a newsletter, an automated notification, spam, "
            "purely social mail), set category to 'ignore_non_actionable'. "
            "Only extract facts explicitly present in the email; use null for anything not stated. "
            "Never invent a deadline, date, or person that isn't in the text."
        ),
        source_text=f"Subject: {title}\nFrom: {sender}\n\n{body}",
        json_schema=_EXTRACTION_SCHEMA,
        schema_name="inbox_extraction",
    )
    if not result or result.get("category") == "ignore_non_actionable":
        return None
    category = result.get("category") if result.get("category") in {c for _, c in CATEGORY_KEYWORDS} | {"other"} else deterministic_category
    return ExtractedInboxItem(
        category=category,
        summary=result.get("short_summary") or (body or title)[:280],
        requested_action=result.get("requested_action"),
        deadline=result.get("deadline"),
        meeting_date=result.get("meeting_date"),
        related_people=result.get("related_people") or [],
        research_topics=result.get("research_topics") or [],
        organization=result.get("organization"),
        confidence=0.8,
    )


# ---------- Priority (product expansion §4): explainable, never opaque ----------

@dataclass
class PriorityResult:
    urgency: str  # high | medium | low
    reasons: list[str]


def compute_priority(
    *,
    deadline: date | None,
    meeting_date: date | None,
    today: date,
    known_sender: bool,
    previous_collaborator_org: bool,
    research_topic_overlap: list[str],
    explicit_response_requested: bool,
) -> PriorityResult:
    reasons: list[str] = []
    score = 0

    if deadline is not None:
        days_left = (deadline - today).days
        if days_left <= 7:
            score += 3
            reasons.append(f"Deadline in {max(days_left, 0)} day(s)")
        elif days_left <= 21:
            score += 2
            reasons.append(f"Deadline in {days_left} days")
        else:
            reasons.append(f"Deadline on {deadline.isoformat()}")
    if meeting_date is not None:
        days_left = (meeting_date - today).days
        if 0 <= days_left <= 14:
            score += 2
            reasons.append("Meeting proposed within the next two weeks")
    if explicit_response_requested:
        score += 2
        reasons.append("Sender explicitly requested a response")
    if known_sender:
        score += 1
        reasons.append("From an existing connection")
    if previous_collaborator_org:
        score += 1
        reasons.append("From an organization you've worked with before")
    if research_topic_overlap:
        score += 2
        reasons.append(f"Topic matches your research interests: {', '.join(research_topic_overlap[:3])}")

    if score >= 4:
        urgency = "high"
    elif score >= 2:
        urgency = "medium"
    else:
        urgency = "low"
    if not reasons:
        reasons.append("No urgent signals found; review when convenient")
    return PriorityResult(urgency=urgency, reasons=reasons)


# ---------- Three contextual replies (product expansion §5) ----------

def draft_replies(*, category: str, sender_name: str, subject: str, requested_action: str | None, faculty_name: str, today: date) -> dict[str, str]:
    """Deterministic, fully-grounded reply drafts -- same "no LLM required to
    satisfy no-invented-facts" shape as LOR Studio's draft_letter. Only uses
    facts already extracted from the email plus the faculty's own name and
    today's date; never invents availability, prior commitments, or specifics
    not present in the source mail."""

    action_clause = f" regarding {requested_action.rstrip('.')}" if requested_action else ""
    greeting = f"Dear {sender_name}," if sender_name else "Hello,"

    accept = (
        f"{greeting}\n\n"
        f"Thank you for reaching out about \"{subject}\"{action_clause}. "
        f"I would be glad to proceed and am happy to confirm my participation.\n\n"
        f"Please let me know the next steps.\n\nBest regards,\n{faculty_name}"
    )
    conditional = (
        f"{greeting}\n\n"
        f"Thank you for reaching out about \"{subject}\"{action_clause}. "
        f"I am interested in principle, but would appreciate a few more details "
        f"(scope, expected time commitment, and timeline) before I can confirm.\n\n"
        f"Could we also discuss whether the proposed timing works, or whether an alternative date is possible?\n\n"
        f"Best regards,\n{faculty_name}"
    )
    decline = (
        f"{greeting}\n\n"
        f"Thank you for thinking of me regarding \"{subject}\"{action_clause}. "
        f"Unfortunately I am not able to take this on at present.\n\n"
        f"I appreciate you reaching out and hope there may be an opportunity to work together in the future.\n\n"
        f"Best regards,\n{faculty_name}"
    )
    return {"accept": accept, "conditional": conditional, "decline": decline}


_POLISH_SCHEMA = {"type": "object", "properties": {"reply_text": {"type": "string"}}, "required": ["reply_text"]}


async def polish_reply(deterministic_draft: str, llm: LLMProvider) -> str:
    """Same constrained-rephrasing pattern as lor.py::polish_letter."""

    if not llm.configured:
        return deterministic_draft
    result = await llm.extract_structured(
        instruction=(
            "Rewrite this email reply in warmer, more natural professional academic prose. "
            "Do not add, remove, or alter any fact, commitment, date, or claim -- only improve phrasing."
        ),
        source_text=deterministic_draft,
        json_schema=_POLISH_SCHEMA,
        schema_name="polished_reply",
    )
    polished = result.get("reply_text") if result else None
    return polished if polished and polished.strip() else deterministic_draft
