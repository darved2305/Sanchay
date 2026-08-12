"""Authentication, profile, faculty dashboard, and admin overview routes."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, get_current_user, require_admin, require_faculty
from ..core.db import get_db
from .schemas import ProfilePatch
from .utils import institution_id_or_403, rows_to_dicts

router = APIRouter()


@router.get("/auth/me")
async def auth_me(user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "role": user.role,
        "profile_id": user.user_id,
        "onboarding_completed": user.profile.get("onboarding_completed_at") is not None,
        "institution_id": user.institution_id,
        "department_id": user.department_id,
    }


async def _profile_payload(session: AsyncSession, user: CurrentUser) -> dict[str, Any]:
    faculty = await session.execute(
        text(
            """
            select id, employee_code, designation, date_joined, current_academic_year,
                   orcid_id, scholar_url, openalex_author_id, qualifications, phd_status
            from public.faculty_profiles
            where profile_id = :profile_id
            """
        ),
        {"profile_id": user.user_id},
    )
    faculty_profile = faculty.mappings().first()
    org = await session.execute(
        text(
            """
            select i.name as institution_name, d.name as department_name
            from public.profiles p
            left join public.institutions i on i.id = p.institution_id
            left join public.departments d on d.id = p.department_id
            where p.id = :profile_id
            """
        ),
        {"profile_id": user.user_id},
    )
    org_names = org.mappings().first()
    profile = dict(user.profile)
    profile["id"] = user.user_id
    profile["role"] = user.role
    profile["faculty_profile"] = dict(faculty_profile) if faculty_profile else None
    if org_names:
        profile.update(dict(org_names))
    return profile


@router.get("/profile")
async def get_profile(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await _profile_payload(session, user)


@router.patch("/profile")
async def update_profile(
    payload: ProfilePatch,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    values = payload.model_dump(exclude_unset=True)
    profile_fields = {
        "full_name",
        "phone",
        "photo_url",
        "bio",
        "research_interests",
        "teaching_interests",
        "expertise",
        "career_goals",
        "open_to_mentorship",
        "open_to_collaboration",
        "accepting_phd_inquiries",
    }
    faculty_fields = {
        "employee_code",
        "designation",
        "date_joined",
        "current_academic_year",
        "orcid_id",
        "scholar_url",
        "openalex_author_id",
        "qualifications",
        "phd_status",
    }
    institution_name = values.pop("institution_name", None)
    department_name = values.pop("department_name", None)
    institution_id = None
    if institution_name is not None or department_name is not None:
        existing = await session.execute(text("select institution_id, department_id from public.profiles where id = :id"), {"id": user.user_id})
        current = existing.mappings().one()
        institution_id = current["institution_id"]
        department_id = current["department_id"]
        if institution_name:
            institution = await session.execute(text("insert into public.institutions(name) values (:name) on conflict (name) do update set name = excluded.name returning id"), {"name": institution_name.strip()})
            institution_id = institution.scalar_one()
        if department_name and institution_id:
            department = await session.execute(text("insert into public.departments(institution_id, name) values (:institution_id, :name) on conflict (institution_id, name) do update set name = excluded.name returning id"), {"institution_id": institution_id, "name": department_name.strip()})
            department_id = department.scalar_one()
        await session.execute(text("update public.profiles set institution_id = :institution_id, department_id = :department_id, updated_at = now() where id = :id"), {"institution_id": institution_id, "department_id": department_id, "id": user.user_id})
    profile_updates = {key: value for key, value in values.items() if key in profile_fields}
    faculty_updates = {key: value for key, value in values.items() if key in faculty_fields}
    organization_updated = institution_name is not None or department_name is not None
    if not profile_updates and not faculty_updates and not organization_updated:
        return await _profile_payload(session, user)

    if profile_updates:
        assignments: list[str] = []
        params: dict[str, Any] = {"profile_id": user.user_id}
        for index, (key, value) in enumerate(profile_updates.items()):
            bind = f"value_{index}"
            assignments.append(f"{key} = :{bind}")
            params[bind] = value
        await session.execute(
            text(f"update public.profiles set {', '.join(assignments)}, updated_at = now() where id = :profile_id"),
            params,
        )
    if faculty_updates:
        assignments = []
        params = {"profile_id": user.user_id}
        for index, (key, value) in enumerate(faculty_updates.items()):
            bind = f"faculty_value_{index}"
            if key == "qualifications":
                assignments.append(f"{key} = cast(:{bind} as jsonb)")
            else:
                assignments.append(f"{key} = :{bind}")
            params[bind] = value
        result = await session.execute(
            text(
                f"update public.faculty_profiles set {', '.join(assignments)} "
                "where profile_id = :profile_id"
            ),
            params,
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Faculty profile is not provisioned")
    if institution_id is not None:
        await session.execute(text("update public.faculty_profiles set institution_id = :institution_id where profile_id = :profile_id"), {"institution_id": institution_id, "profile_id": user.user_id})
    await session.commit()
    refreshed = await session.execute(
        text(
            """
            select id, role::text as role, full_name, email, phone, photo_url, bio,
                   institution_id, department_id, research_interests, teaching_interests,
                   expertise, career_goals, open_to_mentorship, open_to_collaboration,
                   accepting_phd_inquiries, onboarding_completed_at, created_at, updated_at
            from public.profiles where id = :profile_id
            """
        ),
        {"profile_id": user.user_id},
    )
    profile = dict(refreshed.mappings().one())
    new_user = CurrentUser(user.user_id, user.role, profile)
    return await _profile_payload(session, new_user)


@router.post("/profile/onboarding/complete")
async def complete_onboarding(
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await session.execute(
        text("update public.profiles set onboarding_completed_at = coalesce(onboarding_completed_at, now()), updated_at = now() where id = :id"),
        {"id": user.user_id},
    )
    await session.commit()
    return {"ok": True}


@router.get("/dashboard/faculty")
async def faculty_dashboard(
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    institution_id = institution_id_or_403(user)
    counts = await session.execute(
        text(
            """
            select category::text as category, count(*)::int as count
            from public.academic_activities
            where owner_id = :owner_id and status = 'confirmed'
            group by category order by category
            """
        ),
        {"owner_id": user.user_id},
    )
    pending_evidence_result = await session.execute(
        text(
            """
            select category::text as category, count(*)::int as count,
                   min(id) as id, min(title) as title
            from public.academic_activities
            where owner_id = :owner_id and status = 'confirmed' and evidence_status = 'pending'
            group by category order by category
            """
        ),
        {"owner_id": user.user_id},
    )
    recent = await session.execute(
        text(
            """
            select id, category::text as category, title, academic_year, status::text as status,
                   evidence_status::text as evidence_status, start_date, created_at
            from public.academic_activities
            where owner_id = :owner_id and status <> 'archived'
            order by coalesce(start_date, created_at::date) desc, created_at desc
            limit 8
            """
        ),
        {"owner_id": user.user_id},
    )
    appraisal = await session.execute(
        text(
            """
            select c.id as cycle_id, c.name, c.academic_year, c.due_at,
                   coalesce(s.status::text, 'not_started') as status,
                   coalesce(s.readiness, 0)::numeric as readiness, s.id as submission_id
            from public.appraisal_cycles c
            left join public.appraisal_submissions s
              on s.cycle_id = c.id and s.profile_id = :profile_id
            where c.institution_id = :institution_id and c.status = 'open'
            order by c.due_at nulls last, c.created_at desc
            limit 1
            """
        ),
        {"profile_id": user.user_id, "institution_id": institution_id},
    )
    cycle = appraisal.mappings().first()
    inbox_rows = await session.execute(
        text(
            """
            select kind, count(*)::int as count, min(title) as title, min(body) as body,
                   min(link_path) as link_path
            from public.notifications
            where profile_id = :profile_id and read_at is null
            group by kind order by min(created_at) desc
            limit 10
            """
        ),
        {"profile_id": user.user_id},
    )
    deadlines = await session.execute(
        text(
            """
            select id, name, academic_year, due_at
            from public.appraisal_cycles
            where institution_id = :institution_id and due_at is not null and due_at >= now()
            order by due_at asc limit 5
            """
        ),
        {"institution_id": institution_id},
    )
    category_counts = {str(row["category"]): int(row["count"]) for row in counts.mappings().all()}
    pending_evidence = rows_to_dicts(pending_evidence_result.mappings().all())
    return {
        "full_name": user.profile.get("full_name"),
        "appraisal": dict(cycle) if cycle else None,
        "inbox": rows_to_dicts(inbox_rows.mappings().all()),
        "deadlines": rows_to_dicts(deadlines.mappings().all()),
        "recent_activities": rows_to_dicts(recent.mappings().all()),
        "category_counts": category_counts,
        "activity_count": sum(category_counts.values()),
        "teaching_activity_count": category_counts.get("teaching", 0),
        "research_output_count": category_counts.get("research", 0) + category_counts.get("publication", 0),
        "pending_evidence": pending_evidence,
        "pending_evidence_count": sum(int(item.get("count") or 0) for item in pending_evidence),
    }


@router.get("/admin/overview")
async def admin_overview(
    user: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    institution_id = institution_id_or_403(user)
    result = await session.execute(
        text(
            """
            select
              (select count(*) from public.profiles p where p.institution_id = :institution_id and p.role = 'faculty')::int as faculty_count,
              (select count(*) from public.appraisal_submissions s
                 join public.profiles p on p.id = s.profile_id
                where p.institution_id = :institution_id and s.status in ('submitted','under_review','returned'))::int as review_queue_count,
              (select count(*) from public.appraisal_submissions s
                 join public.profiles p on p.id = s.profile_id
                where p.institution_id = :institution_id and s.status = 'approved')::int as approved_count,
              (select count(*) from public.academic_activities a
                 join public.profiles p on p.id = a.owner_id
                where p.institution_id = :institution_id and a.evidence_status = 'pending')::int as pending_evidence_count,
              (select count(*) from public.notifications n
                 join public.profiles p on p.id = n.profile_id
                where p.institution_id = :institution_id and n.read_at is null)::int as unread_notification_count
            """
        ),
        {"institution_id": institution_id},
    )
    overview = dict(result.mappings().one())
    viewer = await session.execute(text("select p.id, p.full_name, p.email, i.name as institution_name from public.profiles p left join public.institutions i on i.id = p.institution_id where p.id = :id"), {"id": user.user_id})
    overview["viewer"] = dict(viewer.mappings().one())
    return overview
