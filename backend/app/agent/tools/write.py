"""Write tools for the assistant.

Every mutation the assistant offers lives here. These differ from the read
tools in one way that matters: they are staged into an action plan and run
by the executor only after the teacher approves, so handlers never call
``session.commit()`` -- the executor owns the transaction, which keeps a
half-approved plan from leaving partial writes behind.

Otherwise the rules are read.py's, restated because they matter more here:

* One ``@tool(...)`` decorator per handler, declaring risk class and scope.
* Handler signature is always ``(session, principal, args) -> ToolResult``.
* ``principal.user_id`` scopes every statement. Never take an owner from
  ``args`` -- the registry rejects such a schema, but the WHERE clause is
  where it matters.
* Expected failures (bad id, unknown category, missing row) return
  ``ToolResult.failure(...)`` with a message a teacher can act on.
* Dynamic SQL builds column names from hardcoded allowlists only; every
  user-supplied value travels as a bound parameter, never an f-string.
"""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import CurrentUser
from ..contracts import RiskClass, ToolResult, ToolScope
from ..registry import tool

#: Same category vocabulary as ``read.search_activities`` -- the LLM routes
#: on both schemas, so they must never drift apart.
_ACTIVITY_CATEGORIES: list[str] = [
    "teaching",
    "research",
    "publication",
    "project",
    "grant",
    "workshop_fdp",
    "seminar",
    "invited_talk",
    "mentorship",
    "committee",
    "institutional_service",
    "community_engagement",
    "award",
    "patent",
    "reviewing",
    "conference",
    "other",
]

_CATEGORY_VALUES = frozenset(_ACTIVITY_CATEGORIES)

#: Hardcoded allowlist of academic_activities columns a staged update may
#: touch, mapped to the SET fragment each one needs (enum/date columns get
#: explicit casts). Anything not in this dict is silently ignored rather
#: than interpolated into SQL.
_ACTIVITY_SET_COLUMNS: dict[str, str] = {
    "title": "title = :set_title",
    "category": "category = cast(:set_category as activity_category)",
    "start_date": "start_date = cast(:set_start_date as date)",
    "end_date": "end_date = cast(:set_end_date as date)",
    "academic_year": "academic_year = :set_academic_year",
    "description": "description = :set_description",
}

#: ProfilePatch's two destinations (app/api/auth_profile.py:update_profile):
#: personal columns live on public.profiles, employment columns on
#: public.faculty_profiles keyed by profile_id. Same split here.
_PROFILE_SET_COLUMNS: dict[str, str] = {
    "bio": "bio = :{bind}",
    "phone": "phone = :{bind}",
    "research_interests": "research_interests = :{bind}",
}

_FACULTY_SET_COLUMNS: dict[str, str] = {
    "designation": "designation = :{bind}",
}


def _clean_text(value: Any) -> str | None:
    """Normalise an optional string argument; blank means absent."""

    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _optional_date(value: Any, label: str) -> tuple[date | None, str | None]:
    """Parse an optional ISO date argument into (value, error_message)."""

    raw = _clean_text(value)
    if raw is None:
        return None, None
    try:
        return date.fromisoformat(raw), None
    except ValueError:
        return None, f"{label} {raw!r} is not a valid date -- use YYYY-MM-DD."


def _summarise_create_activity(args: dict[str, Any]) -> str:
    title = _clean_text(args.get("title")) or "untitled activity"
    category = _clean_text(args.get("category"))
    suffix = f" ({category})" if category else ""
    return f'Add activity "{title}"{suffix}'


@tool(
    name="create_activity",
    description=(
        "Record a new academic activity for the teacher: a publication, workshop/FDP attended, "
        "project, grant, teaching contribution, award, talk or service role. Use when they say "
        "'add/log/record' something they did. It is saved with status 'proposed' -- the teacher "
        "confirms it later -- so never promise it is already part of their confirmed record. "
        "Ask for at least a title and category if either is missing."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Activity title exactly as the teacher stated it, e.g. 'AICTE FDP on AI 2026'.",
            },
            "category": {
                "type": "string",
                "enum": _ACTIVITY_CATEGORIES,
                "description": "One activity category.",
            },
            "start_date": {
                "type": "string",
                "description": "Start date in YYYY-MM-DD form. Optional.",
            },
            "end_date": {
                "type": "string",
                "description": "End date in YYYY-MM-DD form. Omit for single-day or ongoing activities.",
            },
            "academic_year": {
                "type": "string",
                "description": "Academic year in YYYY-YY form, e.g. '2025-26'. The year runs July to June.",
            },
            "description": {
                "type": "string",
                "description": "Free-text detail about the activity. Optional.",
            },
            "organization": {
                "type": "string",
                "description": "Institution, organiser or publisher involved, e.g. 'IIT Bombay'. Optional.",
            },
        },
        "required": ["title", "category"],
    },
    risk_class=RiskClass.WRITE_LOW,
    scope=ToolScope.ACTIVITIES,
    summarise=_summarise_create_activity,
)
async def create_activity(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    title = _clean_text(args.get("title"))
    if not title:
        return ToolResult.failure("An activity needs a title -- what should I call it?")
    category = _clean_text(args.get("category"))
    if not category or category not in _CATEGORY_VALUES:
        return ToolResult.failure(
            f"'{category or 'that'}' is not an activity category I know. Pick one of: {', '.join(_ACTIVITY_CATEGORIES)}."
        )
    start_date, start_error = _optional_date(args.get("start_date"), "Start date")
    if start_error:
        return ToolResult.failure(start_error)
    end_date, end_error = _optional_date(args.get("end_date"), "End date")
    if end_error:
        return ToolResult.failure(end_error)

    result = await session.execute(
        text(
            """
            insert into public.academic_activities (
              owner_id, title, category, start_date, end_date, academic_year, description, organization, status
            ) values (
              :owner_id, :title, cast(:category as activity_category), :start_date, :end_date,
              :academic_year, :description, :organization, 'proposed'
            ) returning id::text as id
            """
        ),
        {
            "owner_id": principal.user_id,
            "title": title,
            "category": category,
            "start_date": start_date,
            "end_date": end_date,
            "academic_year": _clean_text(args.get("academic_year")),
            "description": _clean_text(args.get("description")),
            "organization": _clean_text(args.get("organization")),
        },
    )
    activity_id = result.scalar_one()
    return ToolResult(
        ok=True,
        summary=f'Added "{title}" ({category}) to your record as a proposed activity.',
        data={
            "activity": {
                "id": activity_id,
                "title": title,
                "category": category,
                "status": "proposed",
            }
        },
        ui_hint="detail",
    )


def _summarise_update_activity(args: dict[str, Any]) -> str:
    activity_id = _clean_text(args.get("activity_id")) or "(no id given)"
    changing = [key for key in _ACTIVITY_SET_COLUMNS if args.get(key) is not None]
    fields = ", ".join(sorted(changing)) if changing else "given fields"
    return f"Update activity {activity_id}: change {fields}"


@tool(
    name="update_activity",
    description=(
        "Correct details on one of the teacher's existing academic activities -- fix a typo in the "
        "title, adjust dates, change category or academic year, or rewrite the description. Requires "
        "the activity id, which you get from search_activities; never guess one. Only the fields you "
        "pass are changed."
    ),
    parameters={
        "type": "object",
        "properties": {
            "activity_id": {
                "type": "string",
                "description": "UUID of the activity to edit, taken from search_activities results.",
            },
            "title": {"type": "string", "description": "New title."},
            "category": {
                "type": "string",
                "enum": _ACTIVITY_CATEGORIES,
                "description": "New category.",
            },
            "start_date": {"type": "string", "description": "New start date, YYYY-MM-DD."},
            "end_date": {"type": "string", "description": "New end date, YYYY-MM-DD."},
            "academic_year": {"type": "string", "description": "New academic year, e.g. '2025-26'."},
            "description": {"type": "string", "description": "New free-text description."},
        },
        "required": ["activity_id"],
    },
    risk_class=RiskClass.WRITE_LOW,
    scope=ToolScope.ACTIVITIES,
    summarise=_summarise_update_activity,
)
async def update_activity(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    raw_id = _clean_text(args.get("activity_id"))
    if not raw_id:
        return ToolResult.failure("Which activity should I update? I need its id from search_activities.")
    try:
        activity_id = UUID(raw_id)
    except ValueError:
        return ToolResult.failure(f"{raw_id!r} is not a valid activity id -- take one from search_activities.")

    assignments: list[str] = []
    params: dict[str, Any] = {"activity_id": activity_id, "owner_id": principal.user_id}
    for index, (key, fragment) in enumerate(_ACTIVITY_SET_COLUMNS.items()):
        if args.get(key) is None:
            continue
        if key == "category":
            category = _clean_text(args[key])
            if not category or category not in _CATEGORY_VALUES:
                return ToolResult.failure(
                    f"'{category or 'that'}' is not an activity category I know. Pick one of: {', '.join(_ACTIVITY_CATEGORIES)}."
                )
            bind = f"set_{index}"
            params[bind] = category
            assignments.append(fragment.replace(":set_category", f":{bind}"))
        elif key in ("start_date", "end_date"):
            label = "Start date" if key == "start_date" else "End date"
            parsed, error = _optional_date(args[key], label)
            if error:
                return ToolResult.failure(error)
            if parsed is None:
                continue
            bind = f"set_{index}"
            params[bind] = parsed
            assignments.append(fragment.replace(f":set_{key}", f":{bind}"))
        else:
            value = _clean_text(args[key])
            if value is None:
                continue
            bind = f"set_{index}"
            params[bind] = value
            assignments.append(fragment.replace(f":set_{key}", f":{bind}"))

    if not assignments:
        return ToolResult.failure("Tell me what to change on that activity -- there were no new values in your request.")

    updated = await session.execute(
        text(
            f"""
            update public.academic_activities
               set {', '.join(assignments)}, updated_at = now()
             where id = :activity_id and owner_id = :owner_id
            """
        ),
        params,
    )
    if updated.rowcount == 0:
        return ToolResult.failure(
            f"No activity with id {raw_id} exists in your record, so nothing was changed."
        )

    refreshed = await session.execute(
        text(
            """
            select id::text as id, title, category::text as category, status::text as status,
                   academic_year, start_date, end_date, organization, description
              from public.academic_activities
             where id = :activity_id and owner_id = :owner_id
            """
        ),
        {"activity_id": activity_id, "owner_id": principal.user_id},
    )
    row = refreshed.mappings().first()
    changed = sorted(key for key in _ACTIVITY_SET_COLUMNS if args.get(key) is not None)
    return ToolResult(
        ok=True,
        summary=f"Updated {', '.join(changed)} on \"{row['title']}\"." if row else f"Updated {', '.join(changed)}.",
        data={"activity": dict(row) if row else {"id": raw_id}, "updated_fields": changed},
        ui_hint="detail",
    )


def _summarise_delete_activity(args: dict[str, Any]) -> str:
    activity_id = _clean_text(args.get("activity_id")) or "(no id given)"
    return f"Delete activity {activity_id} permanently (cannot be undone)"


@tool(
    name="delete_activity",
    description=(
        "Permanently remove one of the teacher's own academic activities from their record. This "
        "cannot be undone, so confirm the teacher really wants it gone and have the exact activity "
        "id from search_activities -- if they only described it vaguely, search first and repeat "
        "back what you are about to delete before calling this."
    ),
    parameters={
        "type": "object",
        "properties": {
            "activity_id": {
                "type": "string",
                "description": "UUID of the activity to delete, taken from search_activities results.",
            }
        },
        "required": ["activity_id"],
    },
    risk_class=RiskClass.DESTRUCTIVE,
    scope=ToolScope.ACTIVITIES,
    summarise=_summarise_delete_activity,
)
async def delete_activity(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    raw_id = _clean_text(args.get("activity_id"))
    if not raw_id:
        return ToolResult.failure("Which activity should I delete? I need its id from search_activities.")
    try:
        activity_id = UUID(raw_id)
    except ValueError:
        return ToolResult.failure(f"{raw_id!r} is not a valid activity id -- take one from search_activities.")

    existing = await session.execute(
        text(
            """
            select title, category::text as category
              from public.academic_activities
             where id = :activity_id and owner_id = :owner_id
            """
        ),
        {"activity_id": activity_id, "owner_id": principal.user_id},
    )
    existing_row = existing.mappings().first()
    if existing_row is None:
        return ToolResult.failure(
            f"No activity with id {raw_id} exists in your record, so nothing was deleted."
        )

    await session.execute(
        text("delete from public.academic_activities where id = :activity_id and owner_id = :owner_id"),
        {"activity_id": activity_id, "owner_id": principal.user_id},
    )
    return ToolResult(
        ok=True,
        summary=f'Deleted "{existing_row["title"]}" ({existing_row["category"]}) permanently.',
        data={"deleted": {"id": raw_id, "title": existing_row["title"], "category": existing_row["category"]}},
        ui_hint="detail",
    )


def _clean_research_interests(value: Any) -> tuple[list[str] | None, str | None]:
    """Mirror ProfilePatch.clean_tags: strip, drop empties, dedupe, cap sizes."""

    if value is None:
        return None, None
    if not isinstance(value, list):
        return None, "Research interests must be a list of short phrases, e.g. ['machine learning', 'NLP']."
    cleaned = [str(item).strip() for item in value if str(item).strip()]
    if any(len(item) > 100 for item in cleaned):
        return None, "Each research interest must be at most 100 characters."
    if len(cleaned) > 50:
        return None, "At most 50 research interests can be stored."
    return list(dict.fromkeys(cleaned)), None


def _summarise_update_profile(args: dict[str, Any]) -> str:
    labels: list[tuple[str, str]] = [
        ("designation", "designation"),
        ("department_name", "department"),
        ("bio", "bio"),
        ("research_interests", "research interests"),
        ("phone", "phone"),
    ]
    changing = [label for key, label in labels if args.get(key) is not None]
    fields = ", ".join(changing) if changing else "given fields"
    return f"Update your profile: {fields}"


@tool(
    name="update_profile",
    description=(
        "Change the teacher's own profile: designation (e.g. 'Associate Professor'), department, bio, "
        "research interests, or phone number. Use when they ask to set, update or fix any of these. "
        "Only the fields explicitly provided are touched. Changing designation or department affects "
        "official appraisal documents, so repeat the new value back to the teacher."
    ),
    parameters={
        "type": "object",
        "properties": {
            "designation": {
                "type": "string",
                "description": "Employment designation, e.g. 'Professor' or 'Assistant Professor'. Max 200 chars.",
            },
            "department_name": {
                "type": "string",
                "description": "Department name, matched or created within the teacher's institution. Max 200 chars.",
            },
            "bio": {
                "type": "string",
                "description": "Short professional biography. Max 5000 chars.",
            },
            "research_interests": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of research interest phrases, e.g. ['machine learning', 'signal processing']. Replaces the existing list.",
            },
            "phone": {
                "type": "string",
                "description": "Contact phone number. Max 40 chars.",
            },
        },
        "required": [],
    },
    risk_class=RiskClass.WRITE_HIGH,
    scope=ToolScope.PROFILE,
    summarise=_summarise_update_profile,
)
async def update_profile(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    # Validate everything up front so a rejected field never leaves the other
    # fields half-applied inside this step's transaction slice.
    designation = _clean_text(args.get("designation"))
    if designation and len(designation) > 200:
        return ToolResult.failure("Designation must be at most 200 characters.")
    department_name = _clean_text(args.get("department_name"))
    if department_name and len(department_name) > 200:
        return ToolResult.failure("Department name must be at most 200 characters.")
    bio = _clean_text(args.get("bio"))
    if bio and len(bio) > 5000:
        return ToolResult.failure("Bio must be at most 5000 characters.")
    phone = _clean_text(args.get("phone"))
    if phone and len(phone) > 40:
        return ToolResult.failure("Phone number must be at most 40 characters.")
    research_interests, interests_error = _clean_research_interests(args.get("research_interests"))
    if interests_error:
        return ToolResult.failure(interests_error)

    department_institution_id: UUID | None = None
    if department_name:
        current = await session.execute(
            text("select institution_id from public.profiles where id = :id"),
            {"id": principal.user_id},
        )
        current_row = current.mappings().first()
        department_institution_id = current_row["institution_id"] if current_row else None
        if department_institution_id is None:
            return ToolResult.failure(
                "Your profile has no institution yet, so I can't change your department -- "
                "pick your institution on your profile page first."
            )

    profile_values = {"bio": bio, "phone": phone, "research_interests": research_interests}
    if all(value is None for value in profile_values.values()) and designation is None and not department_name:
        return ToolResult.failure(
            "Tell me which profile field to change -- designation, department, bio, research interests or phone."
        )

    if designation is not None:
        provisioned = await session.execute(
            text("select 1 from public.faculty_profiles where profile_id = :profile_id"),
            {"profile_id": principal.user_id},
        )
        if provisioned.first() is None:
            return ToolResult.failure(
                "Your faculty profile isn't provisioned yet, so I couldn't set the designation."
            )

    changed_labels: list[str] = []

    profile_assignments: list[str] = []
    profile_params: dict[str, Any] = {"profile_id": principal.user_id}
    for index, (key, fragment) in enumerate(_PROFILE_SET_COLUMNS.items()):
        value = profile_values[key]
        if value is None:
            continue
        bind = f"value_{index}"
        profile_params[bind] = value
        profile_assignments.append(fragment.format(bind=bind))
        changed_labels.append({"bio": "bio", "phone": "phone", "research_interests": "research interests"}[key])
    if profile_assignments:
        await session.execute(
            text(
                f"update public.profiles set {', '.join(profile_assignments)}, updated_at = now() "
                "where id = :profile_id"
            ),
            profile_params,
        )

    if designation is not None:
        await session.execute(
            text(
                f"update public.faculty_profiles set {_FACULTY_SET_COLUMNS['designation'].format(bind='faculty_value')} "
                "where profile_id = :profile_id"
            ),
            {"faculty_value": designation, "profile_id": principal.user_id},
        )
        changed_labels.append("designation")

    if department_name:
        # Same insert-or-match behaviour as PATCH /profile: departments belong
        # to an institution, so reuse-or-create within the teacher's own.
        department = await session.execute(
            text(
                "insert into public.departments(institution_id, name) values (:institution_id, :name) "
                "on conflict (institution_id, name) do update set name = excluded.name returning id"
            ),
            {"institution_id": department_institution_id, "name": department_name},
        )
        department_id = department.scalar_one()
        await session.execute(
            text(
                "update public.profiles set department_id = :department_id, updated_at = now() where id = :id"
            ),
            {"department_id": department_id, "id": principal.user_id},
        )
        changed_labels.append("department")

    return ToolResult(
        ok=True,
        summary=f"Updated your profile ({', '.join(changed_labels)})." if changed_labels else "Profile unchanged.",
        data={"updated_fields": changed_labels},
        ui_hint="detail",
    )
