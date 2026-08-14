"""Pure-function tests for Smart Academic Repository classification
(deterministic path only -- no LLM, no live DB)."""

from __future__ import annotations

from app.services.repository_classify import (
    TAXONOMY,
    classify_deterministic,
    looks_like_student_outcome,
    _deterministic_outcome_type,
)


def test_fdp_certificate_detected_from_filename() -> None:
    result = classify_deterministic("FDP_Certificate_IITB.pdf", "")
    assert result.document_category == "professional_development"
    assert result.document_type == "FDP Certificate"


def test_grant_approval_beats_generic_grant_keyword() -> None:
    result = classify_deterministic("letter.pdf", "This is the official Grant Approval order for project X.")
    assert result.document_type == "Grant Approval"
    assert result.confidence >= 0.7
    assert result.needs_confirmation is False


def test_internship_offer_classified_as_student_mentorship() -> None:
    result = classify_deterministic("offer.pdf", "This Internship Offer letter confirms your role at Google.")
    assert result.document_category == "student_mentorship"
    assert result.document_type == "Internship Offer"


def test_unknown_document_falls_back_to_other_and_needs_confirmation() -> None:
    result = classify_deterministic("random_scan_0092.pdf", "")
    assert result.document_category == "other"
    assert result.document_type == "Needs Classification"
    assert result.needs_confirmation is True


def test_filename_only_match_has_lower_confidence_than_text_match() -> None:
    filename_only = classify_deterministic("syllabus.pdf", "")
    with_text = classify_deterministic("syllabus.pdf", "This is the syllabus for CS301, semester 5.")
    assert filename_only.confidence < with_text.confidence


def test_taxonomy_leaves_are_nonempty() -> None:
    # "Project Report" legitimately appears under both research and
    # student_mentorship per the product taxonomy (spec §10) -- classify_deterministic
    # disambiguates it to student_mentorship, so duplication across
    # categories is expected, not a data error.
    assert all(TAXONOMY.values())


def test_looks_like_student_outcome_true_for_placement_letter() -> None:
    assert looks_like_student_outcome("placement_letter.pdf", "We are pleased to offer you a placement at Infosys.")


def test_looks_like_student_outcome_false_for_journal_paper() -> None:
    assert not looks_like_student_outcome("paper.pdf", "This journal article presents a novel approach to X.")


def test_deterministic_outcome_type_prefers_research_internship_over_generic_internship() -> None:
    assert _deterministic_outcome_type("research internship offer at tifr") == "research_internship"
    assert _deterministic_outcome_type("summer internship at google") == "internship"
    assert _deterministic_outcome_type("ojt completion certificate") == "ojt"
