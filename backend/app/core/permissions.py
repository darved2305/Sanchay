"""Small pure authorization predicates used alongside database scoping."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


ADMIN_ROLES = frozenset({"admin", "dept_admin", "institution_admin", "reviewer"})


def _value(source: object, key: str) -> object:
    if isinstance(source, Mapping):
        return source.get(key)
    return getattr(source, key, None)


def is_owner(user_id: object = None, owner_id: object = None, **_: Any) -> bool:
    return bool(user_id is not None and owner_id is not None and str(user_id) == str(owner_id))


def is_admin(role: object = None, user: object = None, actor: object = None, **_: Any) -> bool:
    principal = user or actor
    role_value = role if role is not None else _value(principal, "role")
    return str(role_value or "") in ADMIN_ROLES


def can_access_institution(
    actor: object = None,
    resource: object = None,
    user: object = None,
    institution_id: object = None,
    resource_institution_id: object = None,
    **_: Any,
) -> bool:
    principal = actor or user
    actor_institution = institution_id if institution_id is not None else _value(principal, "institution_id")
    resource_institution = (
        resource_institution_id
        if resource_institution_id is not None
        else _value(resource, "institution_id")
    )
    return bool(
        actor_institution is not None
        and resource_institution is not None
        and str(actor_institution) == str(resource_institution)
    )

same_institution = can_access_institution


def can_access_resource(
    actor: object = None,
    resource: object = None,
    user: object = None,
    **kwargs: Any,
) -> bool:
    principal = actor or user
    if not can_access_institution(actor=principal, resource=resource, **kwargs):
        return False
    if is_admin(user=principal, **kwargs):
        return True
    return is_owner(
        _value(principal, "id") or _value(principal, "user_id"),
        _value(resource, "owner_id"),
    )
