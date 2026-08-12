"""Validated query shapes shared by list endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ActivityFilters(BaseModel):
    q: str | None = None
    category: str | None = None
    academic_year: str | None = None
    status: Literal["draft", "confirmed", "archived"] | None = None
    evidence_status: Literal["pending", "attached", "not_required"] | None = None
    source: str | None = None
    department: str | None = None
    sort: Literal["name", "employee_code", "submission_date", "created_at"] = "created_at"
    order: Literal["asc", "desc"] = "desc"
    limit: int = Field(default=50, ge=1, le=100)
    cursor: str | None = None

    @field_validator("academic_year")
    @classmethod
    def valid_academic_year(cls, value: str | None) -> str | None:
        if value is not None and not (len(value) == 7 and value[4] == "-" and value[:4].isdigit() and value[5:].isdigit()):
            raise ValueError("academic_year must use YYYY-YY format")
        return value


validate_query_filters = ActivityFilters
