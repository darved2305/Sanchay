"""Smart Academic Repository: document taxonomy classification and student
outcome extraction, both deterministic-first (product expansion §9-10, §15).

Same pattern as ``services/reconstruct.py``: a keyword rule pack decides the
category/type first; an LLM, only when configured, may relabel to a closer
leaf in the same fixed taxonomy -- it never invents a category outside it,
and a low-confidence deterministic guess is surfaced to the user for
confirmation (``needs_confirmation=True``) rather than silently forced.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .llm import LLMProvider

# (category, type) leaves, product expansion §10. Kept as plain tuples (not a
# DB enum) so document_type stays free text in the schema -- see
# 011_repository_classification.sql for why.
TAXONOMY: dict[str, list[str]] = {
    "research": [
        "Journal Article", "Conference Paper", "Preprint", "Book Chapter", "Patent",
        "Research Proposal", "Grant Proposal", "Grant Approval", "Project Report",
        "Reviewer Acknowledgement", "Research Statement",
    ],
    "teaching": [
        "Syllabus", "Lecture Material", "Lab Manual", "Assignment", "Question Paper",
        "Assessment Material", "Course Report",
    ],
    "professional_development": [
        "FDP Certificate", "Workshop Certificate", "Seminar Certificate", "Conference Certificate",
    ],
    "academic_service": [
        "Committee Letter", "Examiner Appointment", "Viva Letter", "BOS Letter", "Reviewer Certificate",
    ],
    "student_mentorship": [
        "Project Report", "OJT Letter", "Internship Offer", "Internship Completion",
        "Placement Offer", "Student Achievement",
    ],
    "administration": ["Appraisal", "University Form", "Department Report"],
    "other": ["Needs Classification"],
}

# (keyword, category, type) -- first match wins, most-specific keywords first.
# Matched against "<file_name> <extracted_text[:2000]>".lower().
_KEYWORD_RULES: list[tuple[str, str, str]] = [
    ("grant approval", "research", "Grant Approval"),
    ("grant sanction", "research", "Grant Approval"),
    ("sanction order", "research", "Grant Approval"),
    ("grant proposal", "research", "Grant Proposal"),
    ("research proposal", "research", "Research Proposal"),
    ("preprint", "research", "Preprint"),
    ("patent", "research", "Patent"),
    ("book chapter", "research", "Book Chapter"),
    ("conference paper", "research", "Conference Paper"),
    ("journal article", "research", "Journal Article"),
    ("manuscript", "research", "Journal Article"),
    ("reviewer acknowledgement", "research", "Reviewer Acknowledgement"),
    ("reviewer acknowledgment", "research", "Reviewer Acknowledgement"),
    ("research statement", "research", "Research Statement"),
    ("project report", "student_mentorship", "Project Report"),
    ("ojt", "student_mentorship", "OJT Letter"),
    ("on the job training", "student_mentorship", "OJT Letter"),
    ("internship completion", "student_mentorship", "Internship Completion"),
    ("internship offer", "student_mentorship", "Internship Offer"),
    ("internship", "student_mentorship", "Internship Offer"),
    ("placement offer", "student_mentorship", "Placement Offer"),
    ("placement letter", "student_mentorship", "Placement Offer"),
    ("offer letter", "student_mentorship", "Placement Offer"),
    ("student achievement", "student_mentorship", "Student Achievement"),
    ("syllabus", "teaching", "Syllabus"),
    ("lab manual", "teaching", "Lab Manual"),
    ("question paper", "teaching", "Question Paper"),
    ("assignment", "teaching", "Assignment"),
    ("assessment", "teaching", "Assessment Material"),
    ("course report", "teaching", "Course Report"),
    ("lecture", "teaching", "Lecture Material"),
    ("fdp certificate", "professional_development", "FDP Certificate"),
    ("fdp", "professional_development", "FDP Certificate"),
    ("faculty development", "professional_development", "FDP Certificate"),
    ("workshop certificate", "professional_development", "Workshop Certificate"),
    ("workshop", "professional_development", "Workshop Certificate"),
    ("seminar certificate", "professional_development", "Seminar Certificate"),
    ("seminar", "professional_development", "Seminar Certificate"),
    ("conference certificate", "professional_development", "Conference Certificate"),
    ("certificate of participation", "professional_development", "Conference Certificate"),
    ("bos letter", "academic_service", "BOS Letter"),
    ("board of studies", "academic_service", "BOS Letter"),
    ("examiner appointment", "academic_service", "Examiner Appointment"),
    ("viva", "academic_service", "Viva Letter"),
    ("committee", "academic_service", "Committee Letter"),
    ("reviewer certificate", "academic_service", "Reviewer Certificate"),
    ("appraisal", "administration", "Appraisal"),
    ("department report", "administration", "Department Report"),
    ("university form", "administration", "University Form"),
]


@dataclass
class ClassificationResult:
    document_category: str
    document_type: str
    confidence: float
    needs_confirmation: bool


def classify_deterministic(file_name: str, extracted_text: str) -> ClassificationResult:
    haystack = f"{file_name} {extracted_text[:2000]}".lower()
    for keyword, category, doc_type in _KEYWORD_RULES:
        if keyword in haystack:
            # A single unambiguous keyword hit against real extracted text is
            # already reliable; a filename-only match (no text layer at all,
            # e.g. an image scan pre-OCR) is weaker and should still be
            # confirmed by the faculty member.
            confidence = 0.85 if extracted_text.strip() else 0.55
            return ClassificationResult(category, doc_type, confidence, needs_confirmation=confidence < 0.7)
    return ClassificationResult("other", "Needs Classification", 0.0, needs_confirmation=True)


_LLM_SCHEMA = {
    "type": "object",
    "properties": {
        "document_category": {"type": "string", "enum": list(TAXONOMY.keys())},
        "document_type": {"type": "string"},
    },
    "required": ["document_category", "document_type"],
}


async def classify_document(file_name: str, extracted_text: str, llm: LLMProvider) -> ClassificationResult:
    """Deterministic-first classification; LLM only refines an unconfident
    deterministic guess, and only within the fixed taxonomy leaves."""

    deterministic = classify_deterministic(file_name, extracted_text)
    if not deterministic.needs_confirmation or not llm.configured or not extracted_text.strip():
        return deterministic
    valid_types = {t for types in TAXONOMY.values() for t in types}
    result = await llm.extract_structured(
        instruction=(
            "Classify this academic document into the closest category and type from the fixed "
            f"taxonomy. Valid document_type values: {sorted(valid_types)}. "
            "If genuinely unclear, use category 'other' and type 'Needs Classification'."
        ),
        source_text=f"File name: {file_name}\n\n{extracted_text}",
        json_schema=_LLM_SCHEMA,
        schema_name="document_classification",
    )
    if not result:
        return deterministic
    category = result.get("document_category")
    doc_type = result.get("document_type")
    if category in TAXONOMY and doc_type in TAXONOMY[category]:
        return ClassificationResult(category, doc_type, confidence=0.75, needs_confirmation=False)
    return deterministic


# ---------- Student Outcome extraction (§15) ----------

_OUTCOME_KEYWORDS = ("internship", "placement", "ojt", "on the job training", "apprenticeship", "offer letter", "research internship")

_OUTCOME_TYPE_RULES: list[tuple[str, str]] = [
    ("research internship", "research_internship"),
    ("apprenticeship", "apprenticeship"),
    ("ojt", "ojt"),
    ("on the job training", "ojt"),
    ("placement", "placement"),
    ("internship", "internship"),
]


def looks_like_student_outcome(file_name: str, extracted_text: str) -> bool:
    haystack = f"{file_name} {extracted_text[:2000]}".lower()
    return any(keyword in haystack for keyword in _OUTCOME_KEYWORDS)


def _deterministic_outcome_type(haystack: str) -> str:
    for keyword, outcome_type in _OUTCOME_TYPE_RULES:
        if keyword in haystack:
            return outcome_type
    return "other"


_OUTCOME_SCHEMA = {
    "type": "object",
    "properties": {
        "student_name": {"type": ["string", "null"]},
        "roll_number": {"type": ["string", "null"]},
        "company": {"type": ["string", "null"]},
        "role": {"type": ["string", "null"]},
        "offer_date": {"type": ["string", "null"], "description": "ISO date YYYY-MM-DD if present, else null"},
        "start_date": {"type": ["string", "null"]},
        "end_date": {"type": ["string", "null"]},
    },
    "required": ["student_name", "company", "role"],
}


async def extract_student_outcome(file_name: str, extracted_text: str, llm: LLMProvider) -> dict[str, Any] | None:
    """Return structured student-outcome fields, or None if this document
    doesn't look like a student outcome record or no LLM is configured to
    extract free-text fields from it. Never invents a company/name that
    isn't present in the source text (see LLMProvider's untrusted-input
    framing)."""

    if not looks_like_student_outcome(file_name, extracted_text):
        return None
    haystack = f"{file_name} {extracted_text[:2000]}".lower()
    outcome_type = _deterministic_outcome_type(haystack)
    if not llm.configured or not extracted_text.strip():
        return {"outcome_type": outcome_type, "student_name": None, "company": None, "role": None, "offer_date": None, "start_date": None, "end_date": None, "confidence": 0.4}
    result = await llm.extract_structured(
        instruction=(
            "Extract the student's name, roll number, company/organization, role/position, "
            "and any offer/start/end dates from this internship/placement/OJT document. "
            "Only extract facts explicitly present in the text; use null for anything not stated."
        ),
        source_text=f"File name: {file_name}\n\n{extracted_text}",
        json_schema=_OUTCOME_SCHEMA,
        schema_name="student_outcome",
    )
    if not result:
        return {"outcome_type": outcome_type, "student_name": None, "company": None, "role": None, "offer_date": None, "start_date": None, "end_date": None, "confidence": 0.4}
    return {"outcome_type": outcome_type, "confidence": 0.8, **result}
