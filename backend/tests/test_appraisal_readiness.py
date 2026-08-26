"""Regression tests for appraisal readiness: activity pickup and stale percentages."""

from __future__ import annotations

from typing import Any

from app.api.appraisals import academic_year_digits, compute_appraisal_readiness


def _section(*, required: bool, items: list[dict[str, Any]]) -> dict[str, Any]:
    return {"id": "section", "required": required, "items": items}


def test_academic_year_label_variants_compare_equal() -> None:
    canonical = academic_year_digits("2025-26")
    for variant in ("2025-2026", "2025/26", " 2025 - 26 ", "2025–26", "2025"):
        assert academic_year_digits(variant) == canonical, variant


def test_unrelated_academic_years_stay_distinct() -> None:
    assert academic_year_digits("2025-26") != academic_year_digits("2026-27")
    assert academic_year_digits("unspecified") != academic_year_digits("2025-26")


def test_readiness_counts_activities_nested_under_submission_items() -> None:
    """The submission payload nests the activity, unlike the draft payload."""

    sections = [
        _section(
            required=True,
            items=[{
                "id": "item", "free_text": None,
                "activity": {"status": "confirmed", "evidence_status": "attached"},
            }],
        )
    ]
    assert compute_appraisal_readiness(sections) == 100.0


def test_readiness_ignores_unconfirmed_nested_activities() -> None:
    sections = [
        _section(
            required=True,
            items=[{
                "id": "item", "free_text": None,
                "activity": {"status": "proposed", "evidence_status": "pending"},
            }],
        )
    ]
    assert compute_appraisal_readiness(sections) == 0.0


def test_free_text_entry_completes_a_section() -> None:
    sections = [_section(required=True, items=[{"id": "item", "free_text": "Chaired the exam cell.", "activity": None}])]
    assert compute_appraisal_readiness(sections) == 100.0


def test_blank_free_text_does_not_complete_a_section() -> None:
    sections = [_section(required=True, items=[{"id": "item", "free_text": "   ", "activity": None}])]
    assert compute_appraisal_readiness(sections) == 0.0


def test_flat_activity_rows_still_supported() -> None:
    """The draft/readiness path passes raw academic_activities rows."""

    sections = [_section(required=True, items=[{"status": "confirmed", "evidence_status": "none_needed"}])]
    assert compute_appraisal_readiness(sections) == 100.0
