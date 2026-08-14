"""Pure-function tests for GrantOps eligibility/readiness/team reasoning (no LLM, no live DB)."""

from __future__ import annotations

from app.services.grantops import evaluate_eligibility, evaluate_readiness, team_suggestion_reason


def test_eligible_when_all_rules_satisfied() -> None:
    result = evaluate_eligibility(
        rules={"min_designation": "assistant professor", "min_publications": 2},
        designation="Associate Professor", phd_status="completed",
        publication_count=3, grant_count=0, disciplines=[], faculty_research_interests=[],
    )
    assert result.status == "eligible"
    assert any("meets the minimum" in r for r in result.reasons)


def test_not_eligible_on_designation_hard_fail() -> None:
    result = evaluate_eligibility(
        rules={"min_designation": "professor"},
        designation="Assistant Professor", phd_status=None,
        publication_count=10, grant_count=5, disciplines=[], faculty_research_interests=[],
    )
    assert result.status == "not_currently_eligible"
    assert any("Requires designation" in r for r in result.reasons)


def test_possibly_eligible_on_soft_publication_gap() -> None:
    result = evaluate_eligibility(
        rules={"min_publications": 5},
        designation="Professor", phd_status="completed",
        publication_count=2, grant_count=0, disciplines=[], faculty_research_interests=[],
    )
    assert result.status == "possibly_eligible"
    assert any("Requires 5 publication" in r for r in result.reasons)


def test_eligibility_reasons_never_a_bare_percentage() -> None:
    result = evaluate_eligibility(
        rules={"requires_phd": True}, designation=None, phd_status=None,
        publication_count=0, grant_count=0, disciplines=[], faculty_research_interests=[],
    )
    for reason in result.reasons:
        assert "%" not in reason


def test_no_rules_configured_defaults_to_review_reason() -> None:
    result = evaluate_eligibility(
        rules={}, designation="Professor", phd_status="completed",
        publication_count=0, grant_count=0, disciplines=[], faculty_research_interests=[],
    )
    assert result.status == "eligible"
    assert "No specific eligibility rules" in result.reasons[0]


def test_readiness_matches_on_file_documents() -> None:
    result = evaluate_readiness(["CV", "Research Proposal", "Budget"], ["CV", "Research Proposal"])
    assert result.ready == ["CV", "Research Proposal"]
    assert result.missing == ["Budget"]
    assert result.ready_count == 2 and result.total == 3


def test_readiness_never_asks_for_document_already_on_file() -> None:
    result = evaluate_readiness(["CV"], ["CV", "CV"])
    assert "CV" not in result.missing


def test_readiness_empty_requirements() -> None:
    result = evaluate_readiness([], ["CV"])
    assert result.total == 0 and result.ready == [] and result.missing == []


def test_team_suggestion_reason_appends_discipline_match() -> None:
    reasons = team_suggestion_reason(["Shared expertise: imaging"], ["medical imaging"])
    assert "Shared expertise: imaging" in reasons
    assert any("medical imaging" in r for r in reasons)


def test_team_suggestion_reason_no_discipline_overlap() -> None:
    reasons = team_suggestion_reason(["Shared expertise: imaging"], [])
    assert reasons == ["Shared expertise: imaging"]
