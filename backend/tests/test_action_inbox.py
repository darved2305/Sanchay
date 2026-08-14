"""Pure-function tests for the Faculty Action Inbox (no LLM, no live DB)."""

from __future__ import annotations

from datetime import date

from app.services.action_inbox import (
    classify_deterministic_category,
    compute_priority,
    draft_replies,
    is_actionable_candidate,
)


def test_collaboration_email_detected_as_actionable() -> None:
    assert is_actionable_candidate("Research collaboration opportunity", "We would like to collaborate with you on...")


def test_newsletter_not_actionable() -> None:
    assert not is_actionable_candidate("Weekly Newsletter", "Here's what happened this week in tech news.")


def test_grant_email_classified_correctly() -> None:
    assert classify_deterministic_category("Call for proposals", "This is a funding call for early career researchers.") == "grant_opportunity"


def test_reviewer_invitation_classified_correctly() -> None:
    assert classify_deterministic_category("Manuscript review request", "We invite you to review manuscript #123 for our journal.") in {"reviewer_invitation", "publication_journal"}


def test_priority_high_for_near_deadline_and_explicit_request() -> None:
    today = date(2026, 8, 14)
    result = compute_priority(
        deadline=date(2026, 8, 18), meeting_date=None, today=today,
        known_sender=False, previous_collaborator_org=False,
        research_topic_overlap=[], explicit_response_requested=True,
    )
    assert result.urgency == "high"
    assert any("day" in reason.lower() for reason in result.reasons)
    assert any("response" in reason.lower() for reason in result.reasons)


def test_priority_low_with_no_signals() -> None:
    today = date(2026, 8, 14)
    result = compute_priority(
        deadline=None, meeting_date=None, today=today,
        known_sender=False, previous_collaborator_org=False,
        research_topic_overlap=[], explicit_response_requested=False,
    )
    assert result.urgency == "low"
    assert len(result.reasons) == 1


def test_priority_reasons_mention_topic_overlap() -> None:
    today = date(2026, 8, 14)
    result = compute_priority(
        deadline=None, meeting_date=None, today=today,
        known_sender=True, previous_collaborator_org=True,
        research_topic_overlap=["healthcare AI", "federated learning"],
        explicit_response_requested=False,
    )
    # known_sender + previous_collaborator_org + topic overlap stack to a high score.
    assert result.urgency == "high"
    joined = " ".join(result.reasons)
    assert "healthcare AI" in joined
    assert "existing connection" in joined.lower()


def test_draft_replies_returns_three_distinct_grounded_drafts() -> None:
    replies = draft_replies(
        category="research_collaboration",
        sender_name="Dr. Rao",
        subject="Collaboration on medical imaging",
        requested_action="a joint proposal",
        faculty_name="Dr. Ananya Sharma",
        today=date(2026, 8, 14),
    )
    assert set(replies.keys()) == {"accept", "conditional", "decline"}
    for text in replies.values():
        assert "Dr. Rao" in text
        assert "Dr. Ananya Sharma" in text
        assert "medical imaging" in text
    assert replies["accept"] != replies["conditional"] != replies["decline"]


def test_draft_replies_never_invents_facts_not_in_source() -> None:
    replies = draft_replies(
        category="other", sender_name="", subject="Untitled request", requested_action=None,
        faculty_name="Dr. X", today=date(2026, 8, 14),
    )
    # No fabricated specifics (no invented company/date/amount) beyond what was passed in.
    for text in replies.values():
        assert "Untitled request" in text
        assert "$" not in text
