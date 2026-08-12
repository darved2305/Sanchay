"""Pure-helper tests for invariants that must not drift silently."""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from .support import (
    assert_rejected,
    assert_transition,
    invoke,
    normalize_readiness,
    resolve_symbol,
    result_is_allowed,
    scalar,
)


def test_academic_year_uses_july_to_june_boundaries() -> None:
    helper = resolve_symbol(
        (
            "derive_academic_year",
            "academic_year_for_date",
            "get_academic_year",
            "calculate_academic_year",
            "academic_year_from_date",
            "derive_year",
        ),
        purpose="academic-year",
    )

    def derive(value: date) -> str:
        payload = {
            "date": value,
            "start_date": value,
            "activity_date": value,
            "value": value,
        }
        result = invoke(helper.value, payload, value, value.isoformat())
        return str(scalar(result, keys=("academic_year", "year")))

    assert derive(date(2025, 6, 30)) == "2024-25"
    assert derive(date(2025, 7, 1)) == "2025-26"
    assert derive(date(2026, 6, 30)) == "2025-26"
    assert derive(date(2026, 7, 1)) == "2026-27"


DOI_A = "https://doi.org/10.1000/ABC.123"
DOI_B = " 10.1000/abc.123/ "


def _publication_records() -> list[dict[str, Any]]:
    return [
        {
            "id": "doi-first",
            "doi": DOI_A,
            "title": "A Reliable Academic Record",
            "year": 2025,
        },
        {
            "id": "doi-duplicate",
            "doi": DOI_B,
            "title": "A different title from the same DOI",
            "year": 2025,
        },
        {
            "id": "title-first",
            "doi": None,
            "title": "  Evidence-Aware Appraisal Systems ",
            "year": 2025,
        },
        {
            "id": "title-duplicate",
            "doi": None,
            "title": "evidence aware appraisal systems",
            "year": 2025,
        },
        {
            "id": "same-title-new-year",
            "doi": None,
            "title": "Evidence-Aware Appraisal Systems",
            "year": 2026,
        },
    ]


def _publication_key(helper: Any, record: dict[str, Any]) -> Any:
    payload = {
        "record": record,
        "publication": record,
        "candidate": record,
        "item": record,
        "doi": record["doi"],
        "title": record["title"],
        "year": record["year"],
        "publication_year": record["year"],
    }
    return invoke(helper, payload, record)


def test_publication_dedupe_normalizes_doi_and_title_year() -> None:
    helper = resolve_symbol(
        (
            "publication_dedupe_key",
            "publication_identity_key",
            "dedupe_key",
            "get_publication_dedupe_key",
            "get_dedupe_key",
            "publication_key",
            "normalize_publication_key",
            "deduplicate_publications",
            "dedupe_publications",
            "are_duplicate_publications",
            "is_duplicate_publication",
        ),
        purpose="publication DOI/title-year dedupe",
    )
    records = _publication_records()

    if helper.name in {
        "publication_dedupe_key",
        "publication_identity_key",
        "dedupe_key",
        "get_publication_dedupe_key",
        "get_dedupe_key",
        "publication_key",
        "normalize_publication_key",
    }:
        doi_key_a = _publication_key(helper.value, records[0])
        doi_key_b = _publication_key(helper.value, records[1])
        title_key_a = _publication_key(helper.value, records[2])
        title_key_b = _publication_key(helper.value, records[3])
        title_key_other_year = _publication_key(helper.value, records[4])

        assert doi_key_a == doi_key_b
        assert title_key_a == title_key_b
        assert title_key_a != title_key_other_year
        return

    if helper.name in {"are_duplicate_publications", "is_duplicate_publication"}:
        def duplicate(left: dict[str, Any], right: dict[str, Any]) -> bool:
            payload = {
                "left": left,
                "right": right,
                "first": left,
                "second": right,
                "existing": left,
                "candidate": right,
            }
            return bool(invoke(helper.value, payload, left, right))

        assert duplicate(records[0], records[1])
        assert duplicate(records[2], records[3])
        assert not duplicate(records[2], records[4])
        return

    payload = {
        "records": records,
        "publications": records,
        "candidates": records,
        "items": records,
    }
    result = invoke(helper.value, payload, records)
    result = scalar(result, keys=("items", "records", "deduplicated"))
    assert isinstance(result, (list, tuple, set, dict)), repr(result)
    assert len(result) == 3, "DOI and title+year duplicates must collapse"


def _readiness_section(
    section_id: str, *, required: bool, complete: bool, evidence: str
) -> dict[str, Any]:
    item_status = "confirmed" if complete else "proposed"
    return {
        "id": section_id,
        "section_id": section_id,
        "required": required,
        "complete": complete,
        "ready": complete and evidence == "attached",
        "status": "complete" if complete and evidence == "attached" else "incomplete",
        "items": [
            {
                "status": item_status,
                "activity_status": item_status,
                "evidence_status": evidence,
            }
        ],
    }


def _readiness_value(helper: Any, sections: list[dict[str, Any]]) -> float:
    required = [section for section in sections if section["required"]]
    complete = [section for section in required if section["ready"]]
    items = [item for section in sections for item in section["items"]]
    payload = {
        "sections": sections,
        "required_sections": required,
        "section_statuses": sections,
        "items": items,
        "submission_items": items,
        "activities": items,
        "required_count": len(required),
        "total_required": len(required),
        "completed_count": len(complete),
        "complete_count": len(complete),
        "completed_sections": [section["id"] for section in complete],
        "ready_sections": [section["id"] for section in complete],
    }
    return normalize_readiness(invoke(helper, payload, sections))


def test_appraisal_readiness_requires_confirmed_evidence_and_is_monotonic() -> None:
    helper = resolve_symbol(
        (
            "compute_appraisal_readiness",
            "calculate_appraisal_readiness",
            "appraisal_readiness",
            "compute_readiness",
            "calculate_readiness",
            "get_readiness",
        ),
        purpose="appraisal readiness",
    )
    missing = _readiness_value(
        helper.value,
        [_readiness_section("teaching", required=True, complete=False, evidence="pending")],
    )
    complete = _readiness_value(
        helper.value,
        [_readiness_section("teaching", required=True, complete=True, evidence="attached")],
    )
    mixed = _readiness_value(
        helper.value,
        [
            _readiness_section("teaching", required=True, complete=True, evidence="attached"),
            _readiness_section("research", required=True, complete=False, evidence="pending"),
        ],
    )

    assert missing == pytest.approx(0)
    assert complete == pytest.approx(100)
    assert 0 < mixed < complete


@pytest.mark.parametrize(
    ("current", "target"),
    (
        ("draft", "submitted"),
        ("submitted", "under_review"),
        ("under_review", "returned"),
        ("under_review", "approved"),
        ("under_review", "rejected"),
        ("returned", "submitted"),
    ),
)
def test_submission_transition_helper_allows_contract_transitions(
    current: str, target: str
) -> None:
    helper = resolve_symbol(
        (
            "is_valid_submission_transition",
            "can_transition_submission",
            "can_transition",
            "validate_submission_transition",
            "assert_submission_transition",
            "transition_submission",
        ),
        purpose="submission transition",
    )
    assert_transition(helper.value, current, target, expected=True)


@pytest.mark.parametrize(
    ("current", "target"),
    (
        ("draft", "under_review"),
        ("draft", "approved"),
        ("approved", "submitted"),
        ("rejected", "submitted"),
        ("returned", "approved"),
    ),
)
def test_submission_transition_helper_rejects_illegal_transitions(
    current: str, target: str
) -> None:
    helper = resolve_symbol(
        (
            "is_valid_submission_transition",
            "can_transition_submission",
            "can_transition",
            "validate_submission_transition",
            "assert_submission_transition",
            "transition_submission",
        ),
        purpose="submission transition",
    )
    assert_transition(helper.value, current, target, expected=False)


def _query_payload() -> dict[str, Any]:
    return {
        "q": "computer vision",
        "category": "publication",
        "academic_year": "2025-26",
        "status": "confirmed",
        "evidence_status": "attached",
        "source": "manual",
        "department": "CSE",
        "sort": "name",
        "limit": 25,
        "cursor": "opaque-cursor",
    }


def _supported_fields(callable_obj: Any) -> set[str] | None:
    fields = getattr(callable_obj, "model_fields", None) or getattr(
        callable_obj, "__fields__", None
    )
    if isinstance(fields, dict):
        return set(fields)
    try:
        import inspect

        signature = inspect.signature(callable_obj)
    except (TypeError, ValueError):
        return None
    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values()):
        return None
    return set(signature.parameters)


def test_query_filter_validation_accepts_contract_filters_and_rejects_bad_values() -> None:
    helper = resolve_symbol(
        (
            "validate_activity_filters",
            "validate_admin_faculty_filters",
            "validate_admin_filters",
            "validate_query_filters",
            "validate_list_query",
            "parse_query_filters",
            "ActivityFilters",
            "AdminFacultyFilters",
            "AdminFacultyQuery",
            "PaginationParams",
        ),
        purpose="query/filter validation",
    )
    valid = _query_payload()
    invoke(helper.value, valid, valid)

    supported = _supported_fields(helper.value)
    invalid_cases = (
        ("limit", 0),
        ("limit", 101),
        ("academic_year", "2025/26"),
        ("status", "not-a-status"),
        ("sort", "not-a-sort"),
    )
    relevant = [
        (field, value)
        for field, value in invalid_cases
        if supported is None or field in supported
    ]
    assert relevant, f"{helper.name} exposes no recognizable query fields"
    for field, value in relevant:
        invalid = dict(valid)
        invalid[field] = value
        assert_rejected(helper.value, invalid, invalid)


def _permission_result(helper: Any, actor: dict[str, Any], resource: dict[str, Any]) -> bool:
    payload = {
        "actor": actor,
        "user": actor,
        "principal": actor,
        "resource": resource,
        "obj": resource,
        "owner_id": resource.get("owner_id"),
        "user_id": actor["id"],
        "profile_id": actor["id"],
        "role": actor["role"],
        "user_role": actor["role"],
        "institution_id": actor["institution_id"],
        "resource_institution_id": resource.get("institution_id"),
        "action": resource.get("action", "read"),
        "resource_type": resource.get("resource_type", "activity"),
    }
    result = invoke(helper, payload, actor, resource)
    return result_is_allowed(result, validator_style=True)


def test_role_ownership_permission_helpers_enforce_owner_and_institution_scope() -> None:
    owner_helper = resolve_symbol(
        ("is_owner", "owns_resource", "can_access_owned_resource"),
        purpose="ownership permission",
        required=False,
    )
    institution_helper = resolve_symbol(
        (
            "can_access_institution",
            "same_institution",
            "is_institution_scoped",
            "admin_can_access_institution",
        ),
        purpose="institution-scope permission",
        required=False,
    )
    role_helper = resolve_symbol(
        ("is_admin", "has_admin_role", "can_administer"),
        purpose="role permission",
        required=False,
    )
    generic_helper = resolve_symbol(
        (
            "can_access_resource",
            "can_access",
            "authorize_resource",
            "check_resource_permission",
            "is_authorized",
        ),
        purpose="resource permission",
        required=False,
    )
    if not any((owner_helper, institution_helper, role_helper, generic_helper)):
        pytest.skip("no role/ownership permission helper found")

    faculty_a = {"id": "faculty-a", "role": "faculty", "institution_id": "institution-a"}
    faculty_b = {"id": "faculty-b", "role": "faculty", "institution_id": "institution-a"}
    admin_a = {"id": "admin-a", "role": "admin", "institution_id": "institution-a"}
    admin_b = {"id": "admin-b", "role": "admin", "institution_id": "institution-b"}
    activity_a = {
        "owner_id": "faculty-a",
        "institution_id": "institution-a",
        "resource_type": "activity",
    }
    submission_a = {
        "owner_id": "faculty-a",
        "institution_id": "institution-a",
        "resource_type": "submission",
    }

    if owner_helper:
        assert result_is_allowed(
            invoke(
                owner_helper.value,
                {"user_id": "faculty-a", "owner_id": "faculty-a"},
                "faculty-a",
                "faculty-a",
            ),
            validator_style=True,
        )
        assert not result_is_allowed(
            invoke(
                owner_helper.value,
                {"user_id": "faculty-a", "owner_id": "faculty-b"},
                "faculty-a",
                "faculty-b",
            ),
            validator_style=False,
        )

    if institution_helper:
        assert _permission_result(institution_helper.value, admin_a, submission_a)
        assert not _permission_result(
            institution_helper.value,
            admin_b,
            {**submission_a, "institution_id": "institution-a"},
        )

    if role_helper:
        assert result_is_allowed(invoke(role_helper.value, {"role": "admin"}, "admin"), validator_style=True)
        assert not result_is_allowed(
            invoke(role_helper.value, {"role": "faculty"}, "faculty"), validator_style=False
        )

    if generic_helper:
        assert _permission_result(generic_helper.value, faculty_a, activity_a)
        assert not _permission_result(
            generic_helper.value,
            faculty_a,
            {**activity_a, "owner_id": faculty_b["id"]},
        )
        assert _permission_result(generic_helper.value, admin_a, submission_a)
        assert not _permission_result(
            generic_helper.value,
            admin_b,
            {**submission_a, "institution_id": "institution-a"},
        )
