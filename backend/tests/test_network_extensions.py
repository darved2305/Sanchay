"""Pure-function tests for Professional Network extensions: the two new
discovery intents (grant_collaborator, reviewer) must score without error and
stay explainable, same as the original three (no LLM, no live DB)."""

from __future__ import annotations

from app.services.network import INTENT_FLAGS, rank_candidates, score_candidate


def test_new_intent_flags_registered() -> None:
    assert INTENT_FLAGS["grant_collaborator"] == "open_to_grant_collaboration"
    assert INTENT_FLAGS["reviewer"] == "open_to_reviewing"


def test_grant_collaborator_intent_scores_with_reason() -> None:
    seeker = {"research_interests": [], "expertise": []}
    candidate = {"id": "1", "research_interests": [], "expertise": [], "open_to_grant_collaboration": True}
    result = score_candidate(seeker, candidate, intent="grant_collaborator")
    assert result["score"] >= 3
    assert any("grant collaboration" in r for r in result["reasons"])


def test_reviewer_intent_scores_with_reason() -> None:
    seeker = {"research_interests": [], "expertise": []}
    candidate = {"id": "1", "research_interests": [], "expertise": [], "open_to_reviewing": True}
    result = score_candidate(seeker, candidate, intent="reviewer")
    assert any("reviewing" in r for r in result["reasons"])


def test_rank_candidates_drops_unexplainable_matches() -> None:
    seeker = {"research_interests": [], "expertise": []}
    candidates = [{"id": "1", "research_interests": [], "expertise": [], "open_to_reviewing": False}]
    ranked = rank_candidates(seeker, candidates, intent="reviewer")
    assert ranked == []
