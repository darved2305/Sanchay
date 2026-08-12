"""Institution-scoped admin directory and appraisal queue queries."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_admin
from ..core.db import get_db
from .utils import institution_id_or_403, rows_to_dicts

router = APIRouter(prefix="/admin", tags=["admin"])


def _sort_column(sort: str, *, submissions: bool) -> str:
    if submissions:
        return {
            "name": "p.full_name",
            "employee_code": "fp.employee_code",
            "submission_date": "s.submitted_at",
        }.get(sort, "s.submitted_at")
    return {
        "name": "p.full_name",
        "employee_code": "fp.employee_code",
        "submission_date": "latest.submitted_at",
    }.get(sort, "p.full_name")


@router.get("/faculty")
async def list_faculty(
    q: str | None = Query(default=None, max_length=200),
    department: str | None = Query(default=None, max_length=200),
    academic_year: str | None = Query(default=None, max_length=30),
    status: str | None = Query(default=None, max_length=30),
    sort: Literal["name", "employee_code", "submission_date"] = "name",
    order: Literal["asc", "desc"] = "asc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clauses = ["p.institution_id = :institution_id", "p.role = 'faculty'"]
    params: dict[str, Any] = {"institution_id": institution_id_or_403(user), "limit": page_size, "offset": (page - 1) * page_size}
    if q:
        clauses.append("(p.full_name ilike :q or p.email ilike :q or coalesce(fp.employee_code, '') ilike :q)")
        params["q"] = f"%{q}%"
    if department:
        clauses.append("d.name = :department")
        params["department"] = department
    if academic_year:
        clauses.append("coalesce(fp.current_academic_year, '') = :academic_year")
        params["academic_year"] = academic_year
    if status:
        clauses.append("coalesce(latest.status::text, 'not_started') = :status")
        params["status"] = status
    direction = "desc" if order == "desc" else "asc"
    sort_column = _sort_column(sort, submissions=False)
    result = await session.execute(
        text(
            f"""
            with latest as (
              select distinct on (s.profile_id) s.profile_id, s.id as submission_id, s.status,
                     s.submitted_at, s.readiness, c.academic_year
              from public.appraisal_submissions s join public.appraisal_cycles c on c.id = s.cycle_id
              order by s.profile_id, s.updated_at desc
            )
            select p.id, p.full_name, p.email, p.phone, p.photo_url, p.institution_id, p.department_id,
                   p.created_at, d.name as department, fp.employee_code, fp.designation,
                   fp.current_academic_year as academic_year, fp.orcid_id, fp.openalex_author_id,
                   coalesce(latest.status::text, 'not_started') as appraisal_status,
                   latest.submission_id, latest.submitted_at, latest.readiness,
                   count(*) over()::int as total
            from public.profiles p
            left join public.departments d on d.id = p.department_id
            left join public.faculty_profiles fp on fp.profile_id = p.id
            left join latest on latest.profile_id = p.id
            where {' and '.join(clauses)}
            order by {sort_column} {direction} nulls last, p.id
            limit :limit offset :offset
            """
        ),
        params,
    )
    items = rows_to_dicts(result.mappings().all())
    total = int(items[0]["total"]) if items else 0
    for item in items:
        item.pop("total", None)
    department_rows = await session.execute(
        text("select distinct d.name from public.departments d join public.profiles p on p.department_id = d.id where p.institution_id = :institution_id and p.role = 'faculty' and d.name is not null order by d.name"),
        {"institution_id": institution_id_or_403(user)},
    )
    year_rows = await session.execute(
        text("select distinct fp.current_academic_year from public.faculty_profiles fp join public.profiles p on p.id = fp.profile_id where p.institution_id = :institution_id and p.role = 'faculty' and fp.current_academic_year is not null order by fp.current_academic_year desc"),
        {"institution_id": institution_id_or_403(user)},
    )
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "departments": [row["name"] for row in department_rows.mappings().all()],
        "academic_years": [row["current_academic_year"] for row in year_rows.mappings().all()],
        "statuses": ["not_started", "draft", "submitted", "under_review", "returned", "approved", "rejected"],
    }


@router.get("/submissions")
async def list_submissions(
    q: str | None = Query(default=None, max_length=200),
    department: str | None = Query(default=None, max_length=200),
    academic_year: str | None = Query(default=None, max_length=30),
    status: str | None = Query(default=None, max_length=30),
    sort: Literal["name", "employee_code", "submission_date"] = "submission_date",
    order: Literal["asc", "desc"] = "desc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clauses = ["p.institution_id = :institution_id"]
    params: dict[str, Any] = {"institution_id": institution_id_or_403(user), "limit": page_size, "offset": (page - 1) * page_size}
    if q:
        clauses.append("(p.full_name ilike :q or p.email ilike :q or coalesce(fp.employee_code, '') ilike :q)")
        params["q"] = f"%{q}%"
    if department:
        clauses.append("d.name = :department")
        params["department"] = department
    if academic_year:
        clauses.append("c.academic_year = :academic_year")
        params["academic_year"] = academic_year
    if status:
        clauses.append("s.status::text = :status")
        params["status"] = status
    direction = "desc" if order == "desc" else "asc"
    sort_column = _sort_column(sort, submissions=True)
    result = await session.execute(
        text(
            f"""
            select s.id, s.cycle_id, s.profile_id, s.status::text as status, s.submitted_at, s.decided_at,
                   s.readiness, s.created_at, s.updated_at, c.name as cycle_name, c.academic_year,
                   p.full_name, p.email, p.institution_id, p.department_id, d.name as department,
                   fp.employee_code, fp.designation, count(*) over()::int as total,
                   (select count(*) from public.appraisal_submission_items i where i.submission_id = s.id)::int as activity_count
            from public.appraisal_submissions s
            join public.appraisal_cycles c on c.id = s.cycle_id
            join public.profiles p on p.id = s.profile_id
            left join public.departments d on d.id = p.department_id
            left join public.faculty_profiles fp on fp.profile_id = p.id
            where {' and '.join(clauses)}
            order by {sort_column} {direction} nulls last, s.id
            limit :limit offset :offset
            """
        ),
        params,
    )
    items = rows_to_dicts(result.mappings().all())
    total = int(items[0]["total"]) if items else 0
    for item in items:
        item.pop("total", None)
    department_rows = await session.execute(
        text("select distinct d.name from public.departments d join public.profiles p on p.department_id = d.id where p.institution_id = :institution_id and d.name is not null order by d.name"),
        {"institution_id": institution_id_or_403(user)},
    )
    year_rows = await session.execute(
        text("select distinct c.academic_year from public.appraisal_cycles c where c.institution_id = :institution_id order by c.academic_year desc"),
        {"institution_id": institution_id_or_403(user)},
    )
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "departments": [row["name"] for row in department_rows.mappings().all()],
        "academic_years": [row["academic_year"] for row in year_rows.mappings().all()],
        "statuses": ["draft", "submitted", "under_review", "returned", "approved", "rejected"],
    }
