"""Pure-function tests for Google Scholar paste-import (no LLM, no live DB).

Mirrors ``test_usp_helpers.py``'s style: the identity gate and extraction
service are exercised directly, the same way ``candidate_match``/heuristic
extractors are tested elsewhere, so these run without a database or a
configured LLM provider.
"""

from __future__ import annotations

import asyncio

from app.api.publications import _title_similarity
from app.connectors.publications import scholar_identity_match
from app.core.config import Settings
from app.services.llm import LLMProvider
from app.services.scholar_import import _coerce_int, _heuristic_extract_scholar, extract_scholar_profile


def test_scholar_identity_match_exact_name() -> None:
    matched, reasons = scholar_identity_match("Rajesh Sharma", "Rajesh Sharma")
    assert matched is True
    assert reasons["surname_match"] is True
    assert reasons["given_name_compatible"] is True


def test_scholar_identity_match_initial_given_name() -> None:
    matched, reasons = scholar_identity_match("J. Smith", "John Smith")
    assert matched is True
    assert reasons["rule_applied"] == "surname_and_given_name_match"


def test_scholar_identity_match_middle_name_ignored() -> None:
    matched, _ = scholar_identity_match("Rajesh Kumar Sharma", "Rajesh Sharma")
    assert matched is True


def test_scholar_identity_match_diacritics() -> None:
    matched, _ = scholar_identity_match("Jurgen Muller", "Jürgen Müller")
    assert matched is True


def test_scholar_identity_match_reversed_order() -> None:
    # Some Scholar profile headers/citation blocks list "Surname, Given".
    matched, reasons = scholar_identity_match("Sharma Rajesh", "Rajesh Sharma")
    assert matched is True
    assert reasons["rule_applied"] == "surname_and_given_name_match_reversed_order"


def test_scholar_identity_match_surname_mismatch_rejected() -> None:
    matched, reasons = scholar_identity_match("Rajesh Gupta", "Rajesh Sharma")
    assert matched is False
    assert reasons["surname_match"] is False
    assert reasons["rule_applied"] == "no_match"


def test_scholar_identity_match_email_derived_name_rejected_distinctly() -> None:
    # profiles.full_name defaults to the email local-part (handle_new_user())
    # when no name was given at signup -- a single token, never a real name.
    matched, reasons = scholar_identity_match("Rajesh Sharma", "rajeshsharma2006")
    assert matched is False
    assert reasons["rule_applied"] == "insufficient_name_tokens"


_SAMPLE_SCHOLAR_TEXT = """Rajesh Sharma
Professor, Department of Computer Science
Verified email at example.edu

Citations
1250

h-index
14

i10-index
19

Title
A Study of Deterministic Extraction Pipelines
Rajesh Sharma, Anita Kumar
IEEE Transactions on Software Engineering, 45, 2020
Cited by 87

Deep Learning for Academic Record Systems
Rajesh Sharma, Priya Nair, Suresh Iyer
ACM Computing Surveys, 12, 2022
Cited by 23
"""


def test_scholar_heuristic_extracts_title_authors_venue_year_citations() -> None:
    extracted = _heuristic_extract_scholar(_SAMPLE_SCHOLAR_TEXT)
    assert extracted["person_name"] == "Rajesh Sharma"
    assert extracted["total_citations"] == 1250
    assert extracted["h_index"] == 14
    assert extracted["i10_index"] == 19
    assert len(extracted["publications"]) == 2
    first = extracted["publications"][0]
    assert first["title"] == "A Study of Deterministic Extraction Pipelines"
    assert first["authors"] == ["Rajesh Sharma", "Anita Kumar"]
    assert first["year"] == 2020
    assert first["citation_count"] == 87


def test_scholar_import_without_llm_key_uses_heuristic() -> None:
    settings = Settings(groq_api_key=None)
    result = asyncio.run(extract_scholar_profile(_SAMPLE_SCHOLAR_TEXT, LLMProvider(settings)))
    assert result is not None
    assert result["person_name"] == "Rajesh Sharma"
    assert len(result["publications"]) == 2
    # Callers (the endpoint, the UI) must be able to tell this wasn't the LLM
    # path -- a transient Groq failure must not silently masquerade as a full
    # AI-quality extraction.
    assert result["extraction_method"] == "heuristic"


def test_scholar_import_no_name_extracted_fails_closed() -> None:
    settings = Settings(groq_api_key=None)
    result = asyncio.run(extract_scholar_profile("   \n\n   ", LLMProvider(settings)))
    assert result is None


def test_scholar_heuristic_metrics_block_ignores_all_since_year_header() -> None:
    # Real Scholar profile pages put an "All  Since 20XX" header between the
    # metric label and its number; a naive "first digit sequence within N
    # lines" scan would grab the header's own year as the citation count.
    text_with_header = "Rajesh Sharma\n\nCitations\nAll  Since 2020\n1250\n\nh-index\nAll  Since 2020\n14\n"
    extracted = _heuristic_extract_scholar(text_with_header)
    assert extracted["total_citations"] == 1250
    assert extracted["h_index"] == 14


def test_title_similarity_short_generic_titles_are_not_flagged_as_duplicates() -> None:
    # These share 3 of 5 raw tokens ("research", "paper", "on") purely from
    # boilerplate phrasing -- they are two different papers, not a duplicate.
    score = _title_similarity("Research paper on Deep Learning", "Research paper on Federated Analytics")
    assert score < 0.6


def test_title_similarity_still_catches_genuine_near_duplicates() -> None:
    score = _title_similarity(
        "Explainable AI Techniques for Clinical Decision Support Systems",
        "Explainable AI Technique for Clinical Decision-Support System",
    )
    assert score >= 0.6


def test_coerce_int_handles_llm_type_drift() -> None:
    assert _coerce_int(2023) == 2023
    assert _coerce_int("2023") == 2023
    assert _coerce_int("circa 2023") is None
    assert _coerce_int(None) is None
    assert _coerce_int(True) is None
