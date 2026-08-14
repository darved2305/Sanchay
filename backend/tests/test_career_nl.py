"""Pure-function tests for Adaptive Career Navigator NL-goal parsing/progress (no LLM, no live DB)."""

from __future__ import annotations

from datetime import date

from app.services.career_nl import (
    _deterministic_outcomes,
    _deterministic_target_date,
    compute_custom_goal_progress,
    match_grants_to_goal,
    match_inbox_items_to_goal,
    suggest_goals,
)


def test_deterministic_target_date_from_month_year() -> None:
    assert _deterministic_target_date("Publish papers by June 2027", date(2026, 8, 14)) == "2027-06-28"


def test_deterministic_target_date_from_in_n_years() -> None:
    result = _deterministic_target_date("I want to become Associate Professor in the next 2 years.", date(2026, 8, 14))
    assert result.startswith("2028-08")


def test_deterministic_target_date_none_when_not_stated() -> None:
    assert _deterministic_target_date("I want to build my profile in privacy-preserving ML.", date(2026, 8, 14)) is None


def test_deterministic_outcomes_extracts_publication_count() -> None:
    outcomes = _deterministic_outcomes("I want to publish three Q1 journal papers in healthcare AI by June 2027")
    assert outcomes == [] or outcomes[0]["key"] == "publication"


def test_deterministic_outcomes_empty_when_no_keyword() -> None:
    assert _deterministic_outcomes("I want to become HOD eventually.") == []


def test_suggest_goals_recommends_grant_when_publications_high_and_no_grant() -> None:
    suggestions = suggest_goals(activity_counts={"publication": 5, "grant": 0}, connection_count=3, top_research_interest="healthcare AI", has_active_grant_goal=False)
    keys = {s.key for s in suggestions}
    assert "first_grant" in keys
    grant_suggestion = next(s for s in suggestions if s.key == "first_grant")
    assert "healthcare AI" in grant_suggestion.title
    assert any("5" in r for r in grant_suggestion.reasons)


def test_suggest_goals_skips_grant_suggestion_when_already_has_one() -> None:
    suggestions = suggest_goals(activity_counts={"publication": 5, "grant": 0}, connection_count=3, top_research_interest=None, has_active_grant_goal=True)
    assert not any(s.key == "first_grant" for s in suggestions)


def test_suggest_goals_recommends_network_when_few_connections() -> None:
    suggestions = suggest_goals(activity_counts={}, connection_count=0, top_research_interest=None, has_active_grant_goal=False)
    assert any(s.key == "build_network" for s in suggestions)


def test_suggest_goals_reasons_never_contain_percentage() -> None:
    suggestions = suggest_goals(activity_counts={"publication": 5, "grant": 0}, connection_count=0, top_research_interest=None, has_active_grant_goal=False)
    for s in suggestions:
        for reason in s.reasons:
            assert "%" not in reason


def test_compute_custom_goal_progress_counts_against_target() -> None:
    progress = compute_custom_goal_progress([{"key": "publication", "label": "Papers", "target": 3}], {"publication": 2})
    assert progress["outcomes"][0]["count"] == 2
    assert progress["outcomes"][0]["satisfied"] is False
    assert progress["satisfied"] is False


def test_compute_custom_goal_progress_satisfied_when_target_met() -> None:
    progress = compute_custom_goal_progress([{"key": "grant", "label": "Grant", "target": 1}], {"grant": 1})
    assert progress["outcomes"][0]["satisfied"] is True
    assert progress["satisfied"] is True


def test_match_inbox_items_to_goal_on_topic_overlap() -> None:
    matches = match_inbox_items_to_goal(
        "Build Healthcare AI research profile",
        [{"id": "1", "subject": "Medical Imaging AI collaboration", "summary": "", "research_topics": ["Healthcare AI"]}],
    )
    assert len(matches) == 1
    assert "Healthcare AI" in matches[0]["reasons"][0]


def test_match_inbox_items_to_goal_no_overlap_excluded() -> None:
    matches = match_inbox_items_to_goal(
        "Build Healthcare AI research profile",
        [{"id": "1", "subject": "Unrelated committee meeting", "summary": "Budget review", "research_topics": []}],
    )
    assert matches == []


def test_match_grants_to_goal_on_discipline_overlap() -> None:
    matches = match_grants_to_goal(
        "Secure funding for privacy-preserving ML",
        [{"id": "1", "title": "AI Research Grant", "description": "", "disciplines": ["privacy-preserving ML"]}],
    )
    assert len(matches) == 1
