"""Academic-year rules shared by API validation, imports, and tests."""

from __future__ import annotations

from datetime import date, datetime


def derive_academic_year(value: date | datetime | str) -> str:
    """Return the July-to-June academic year for a date-like value."""

    if isinstance(value, datetime):
        current = value.date()
    elif isinstance(value, date):
        current = value
    else:
        current = date.fromisoformat(str(value)[:10])
    start_year = current.year if current.month >= 7 else current.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


academic_year_for_date = derive_academic_year
