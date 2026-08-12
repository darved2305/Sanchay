"""HTTP-level authorization tests for the P0 ownership boundaries."""

from __future__ import annotations

import asyncio
import importlib
import inspect
import json
import os
from collections.abc import Mapping
from typing import Any

import pytest


PROTECTED_ROUTES = (
    "activities",
    "evidence",
    "appraisals/readiness",
    "admin/overview",
)


def _response_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, Mapping):
        for key in ("items", "results", "data", "faculty", "submissions"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, Mapping)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, Mapping)]
    return []


def _status_is_denied(status_code: int) -> bool:
    # 404 is allowed for object-level checks because hiding the existence of a
    # foreign object is stronger than returning a readable 403.
    return status_code in {401, 403, 404}


@pytest.mark.parametrize("suffix", PROTECTED_ROUTES)
def test_unauthenticated_requests_are_rejected(client: Any, api_path: Any, suffix: str) -> None:
    response = client.get(api_path(suffix))
    assert response.status_code in {401, 403}, response.text


def test_faculty_cannot_call_admin_endpoint(faculty_a_client: Any, api_path: Any) -> None:
    response = faculty_a_client.get(api_path("admin/overview"))
    assert response.status_code in {401, 403}, response.text


def _load_dotted(path: str) -> Any:
    module_name, separator, attr_name = path.rpartition(":")
    if not separator:
        module_name, _, attr_name = path.rpartition(".")
    if not module_name or not attr_name:
        raise ValueError(f"invalid dotted factory path: {path!r}")
    return getattr(importlib.import_module(module_name), attr_name)


def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return asyncio.run(value)
    return value


@pytest.fixture()
def security_dataset() -> Mapping[str, Any]:
    """Load explicit test records without creating fake records in the app.

    A backend may provide a transaction-scoped factory through
    ``QA_SECURITY_FIXTURE_FACTORY=package.module:create_dataset``.  A JSON
    mapping is also accepted for a separately provisioned test database.  No
    default IDs are invented, so ownership tests never accidentally exercise
    an unrelated or production database.
    """

    factory_path = os.getenv("QA_SECURITY_FIXTURE_FACTORY")
    dataset_json = os.getenv("QA_SECURITY_DATASET_JSON")
    if factory_path:
        dataset = _maybe_await(_load_dotted(factory_path)())
    elif dataset_json:
        dataset = json.loads(dataset_json)
    else:
        pytest.skip(
            "ownership API tests require QA_SECURITY_FIXTURE_FACTORY or "
            "QA_SECURITY_DATASET_JSON for a real test database"
        )
    if not isinstance(dataset, Mapping):
        pytest.fail("security fixture factory must return a mapping")
    return dataset


def _required_id(dataset: Mapping[str, Any], *names: str) -> str:
    for name in names:
        value = dataset.get(name)
        if value:
            return str(value)
    pytest.fail(f"security fixture is missing one of: {', '.join(names)}")


def _principal_fields(dataset: Mapping[str, Any], prefix: str) -> tuple[str, str]:
    profile_id = _required_id(
        dataset,
        f"{prefix}_profile_id",
        f"{prefix}_id",
        f"{prefix}_user_id",
    )
    institution_id = _required_id(
        dataset,
        f"{prefix}_institution_id",
        "institution_a_id" if prefix.endswith("a") else "institution_b_id",
    )
    return profile_id, institution_id


def test_faculty_a_cannot_read_or_list_faculty_b_data(
    authenticated_client: Any,
    api_path: Any,
    security_dataset: Mapping[str, Any],
) -> None:
    faculty_a, institution_a = _principal_fields(security_dataset, "faculty_a")
    activity_b = _required_id(security_dataset, "activity_b_id")
    faculty_b = _required_id(
        security_dataset, "faculty_b_profile_id", "faculty_b_id", "faculty_b_user_id"
    )
    with authenticated_client(
        role="faculty", profile_id=faculty_a, institution_id=institution_a
    ) as client_a:
        object_response = client_a.get(api_path(f"activities/{activity_b}"))
        assert _status_is_denied(object_response.status_code), object_response.text

        collection_response = client_a.get(api_path("activities"))
        assert collection_response.status_code == 200, collection_response.text
        body = collection_response.json()
        encoded = json.dumps(body)
        marker = str(security_dataset.get("faculty_b_marker", "faculty-b-private"))
        assert marker not in encoded
        assert activity_b not in encoded
        assert faculty_b not in encoded


def test_admin_is_scoped_to_its_own_institution(
    authenticated_client: Any,
    api_path: Any,
    security_dataset: Mapping[str, Any],
) -> None:
    admin_a, institution_a = _principal_fields(security_dataset, "admin_a")
    faculty_b = _required_id(
        security_dataset, "faculty_b_profile_id", "faculty_b_id", "faculty_b_user_id"
    )
    institution_b = _required_id(security_dataset, "institution_b_id")
    institution_b_marker = str(
        security_dataset.get("institution_b_marker", "institution-b-private")
    )
    with authenticated_client(
        role="admin", profile_id=admin_a, institution_id=institution_a
    ) as admin_client:
        response = admin_client.get(api_path("admin/faculty"))
        assert response.status_code == 200, response.text
        body = response.json()
        encoded = json.dumps(body)
        assert institution_b_marker not in encoded
        assert faculty_b not in encoded
        for item in _response_items(body):
            if "institution_id" in item:
                assert str(item["institution_id"]) != institution_b


def test_evidence_cannot_be_read_or_attached_across_owners(
    authenticated_client: Any,
    api_path: Any,
    security_dataset: Mapping[str, Any],
) -> None:
    faculty_b, institution_b = _principal_fields(security_dataset, "faculty_b")
    evidence_a = _required_id(security_dataset, "evidence_a_id")
    activity_a = _required_id(security_dataset, "activity_a_id")
    with authenticated_client(
        role="faculty", profile_id=faculty_b, institution_id=institution_b
    ) as client_b:
        read_response = client_b.get(api_path(f"evidence/{evidence_a}"))
        assert _status_is_denied(read_response.status_code), read_response.text

        attach_response = client_b.post(
            api_path(f"evidence/{evidence_a}/attach"),
            json={"activity_id": activity_a},
        )
        assert _status_is_denied(attach_response.status_code), attach_response.text


def test_appraisal_submission_round_trip_rejects_illegal_transition(
    authenticated_client: Any,
    api_path: Any,
    security_dataset: Mapping[str, Any],
) -> None:
    faculty_a, institution_a = _principal_fields(security_dataset, "faculty_a")
    admin_a, _ = _principal_fields(security_dataset, "admin_a")
    submission_id = _required_id(security_dataset, "submission_a_id")

    with authenticated_client(
        role="faculty", profile_id=faculty_a, institution_id=institution_a
    ) as faculty_client:
        submit = faculty_client.post(api_path(f"appraisals/submissions/{submission_id}/submit"))
        assert submit.status_code in {200, 202}, submit.text

    with authenticated_client(
        role="admin", profile_id=admin_a, institution_id=institution_a
    ) as admin_client:
        under_review = admin_client.post(
            api_path(f"appraisals/submissions/{submission_id}/review"),
            json={"action": "comment", "comment": "QA review"},
        )
        assert under_review.status_code in {200, 201}, under_review.text
        returned = admin_client.post(
            api_path(f"appraisals/submissions/{submission_id}/review"),
            json={"action": "return", "comment": "Please attach the missing evidence."},
        )
        assert returned.status_code in {200, 201}, returned.text

    with authenticated_client(
        role="faculty", profile_id=faculty_a, institution_id=institution_a
    ) as faculty_client:
        resubmit = faculty_client.post(api_path(f"appraisals/submissions/{submission_id}/submit"))
        assert resubmit.status_code in {200, 202}, resubmit.text

    with authenticated_client(
        role="admin", profile_id=admin_a, institution_id=institution_a
    ) as admin_client:
        approve = admin_client.post(
            api_path(f"appraisals/submissions/{submission_id}/review"),
            json={"action": "approve"},
        )
        assert approve.status_code in {200, 201}, approve.text

    with authenticated_client(
        role="faculty", profile_id=faculty_a, institution_id=institution_a
    ) as faculty_client:
        illegal_resubmit = faculty_client.post(
            api_path(f"appraisals/submissions/{submission_id}/submit")
        )
        assert illegal_resubmit.status_code in {400, 409, 422}, illegal_resubmit.text
