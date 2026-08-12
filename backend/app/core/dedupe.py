"""Deterministic identity keys for publication candidates."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any


def _normalize_doi(value: object) -> str:
    normalized = str(value or "").strip().lower()
    normalized = re.sub(r"^https?://(dx\.)?doi\.org/", "", normalized)
    normalized = re.sub(r"^doi:\s*", "", normalized)
    return normalized.rstrip("/").strip()


def _normalize_title(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def publication_dedupe_key(
    record: Mapping[str, Any] | None = None,
    publication: Mapping[str, Any] | None = None,
    candidate: Mapping[str, Any] | None = None,
    item: Mapping[str, Any] | None = None,
    doi: object = None,
    title: object = None,
    year: object = None,
    publication_year: object = None,
) -> tuple[object, ...]:
    """Prefer normalized DOI, then normalized title plus publication year."""

    source = record or publication or candidate or item or {}
    doi_value = doi or source.get("doi")
    normalized_doi = _normalize_doi(doi_value)
    if normalized_doi:
        return ("doi", normalized_doi)
    title_value = title if title is not None else source.get("title")
    year_value = year if year is not None else publication_year
    if year_value is None:
        year_value = source.get("year", source.get("publication_year"))
    try:
        normalized_year: object = int(year_value) if year_value is not None else None
    except (TypeError, ValueError):
        normalized_year = str(year_value or "").strip()
    return ("title_year", _normalize_title(title_value), normalized_year)


normalize_publication_key = publication_dedupe_key
