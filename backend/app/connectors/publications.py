"""ORCID, OpenAlex, and Crossref clients with deterministic normalisation.

These connectors only return data obtained from the configured providers. They
never manufacture a publication when a provider is unavailable or an author
has no configured identifier.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any
from urllib.parse import quote

import httpx

from ..core.config import Settings

logger = logging.getLogger(__name__)


class ExternalApiError(RuntimeError):
    def __init__(self, provider: str, message: str) -> None:
        super().__init__(f"{provider}: {message}")
        self.provider = provider


def normalize_doi(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    normalized = re.sub(r"^https?://(dx\.)?doi\.org/", "", normalized)
    normalized = normalized.removeprefix("doi:").strip().rstrip(".,; ")
    return normalized or None


def normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def title_year_hash(title: str, year: int | None) -> str:
    basis = f"{normalize_title(title)}|{year or ''}".encode("utf-8")
    return hashlib.sha256(basis).hexdigest()


@dataclass
class PublicationAuthor:
    name: str
    position: int
    orcid_id: str | None = None
    openalex_author_id: str | None = None
    affiliation: str | None = None


@dataclass
class PublicationItem:
    title: str
    doi: str | None = None
    venue: str | None = None
    publisher: str | None = None
    publication_type: str | None = None
    year: int | None = None
    month: int | None = None
    citation_count: int | None = None
    openalex_id: str | None = None
    authors: list[PublicationAuthor] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def normalized_title_hash(self) -> str:
        return title_year_hash(self.title, self.year)


def _year_month(value: dict[str, Any] | None) -> tuple[int | None, int | None]:
    if not value:
        return None, None
    try:
        # ORCID returns an explicit `"month": null` (not a missing key) for
        # works recorded with only a year -- `.get("month", {})` only falls
        # back to `{}` when the key is *absent*, so an explicit null still
        # comes back as None and crashes the next `.get("value")` call.
        year_field = value.get("year") or {}
        month_field = value.get("month") or {}
        year = int(year_field.get("value")) if year_field.get("value") else None
        month = int(month_field.get("value")) if month_field.get("value") else None
        return year, month
    except (TypeError, ValueError):
        return None, None


def _openalex_year_month(value: str | None) -> tuple[int | None, int | None]:
    if not value:
        return None, None
    try:
        parsed = date.fromisoformat(value)
        return parsed.year, parsed.month
    except ValueError:
        try:
            return int(value[:4]), None
        except (TypeError, ValueError):
            return None, None


class _HttpConnector:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def get_json(
        self,
        provider: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.settings.external_api_timeout_seconds) as client:
                response = await client.get(url, headers=headers, params=params)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ExternalApiError(provider, f"request failed: {exc}") from exc
        if not isinstance(payload, dict):
            raise ExternalApiError(provider, "response was not a JSON object")
        return payload


class OrcidClient(_HttpConnector):
    async def works(self, orcid_id: str) -> list[PublicationItem]:
        normalized = orcid_id.strip().removeprefix("https://orcid.org/").removeprefix("http://orcid.org/")
        payload = await self.get_json(
            "ORCID",
            f"{str(self.settings.orcid_api_url).rstrip('/')}/{quote(normalized, safe='')}/works",
            headers={"Accept": "application/json"},
        )
        items: list[PublicationItem] = []
        for group in payload.get("group", []):
            summaries = group.get("work-summary") or []
            summary = summaries[0] if summaries else None
            if not summary:
                continue
            title = ((summary.get("title") or {}).get("title") or {}).get("value")
            if not title:
                continue
            external_ids = ((summary.get("external-ids") or {}).get("external-id") or [])
            doi = next(
                (
                    entry.get("external-id-value")
                    for entry in external_ids
                    if str(entry.get("external-id-type", "")).lower() == "doi"
                ),
                None,
            )
            year, month = _year_month(summary.get("publication-date"))
            items.append(
                PublicationItem(
                    title=str(title).strip(),
                    doi=normalize_doi(str(doi)) if doi else None,
                    venue=((summary.get("journal-title") or {}).get("value")),
                    publication_type=summary.get("type"),
                    year=year,
                    month=month,
                    metadata={"orcid_put_code": summary.get("put-code"), "source": "orcid"},
                )
            )
        return items


class OpenAlexClient(_HttpConnector):
    def _params(self, **params: Any) -> dict[str, Any]:
        if self.settings.openalex_mailto:
            params["mailto"] = self.settings.openalex_mailto
        return params

    async def author_for_orcid(self, orcid_id: str) -> str | None:
        normalized = orcid_id.strip().removeprefix("https://orcid.org/").removeprefix("http://orcid.org/")
        payload = await self.get_json(
            "OpenAlex",
            f"{str(self.settings.openalex_api_url).rstrip('/')}/authors",
            params=self._params(filter=f"orcid:https://orcid.org/{normalized}", **{"per-page": 1}),
        )
        result = payload.get("results") or []
        return str(result[0].get("id")) if result and result[0].get("id") else None

    async def works(self, author_id: str) -> list[PublicationItem]:
        normalized = author_id.strip().rstrip("/").split("/")[-1]
        payload = await self.get_json(
            "OpenAlex",
            f"{str(self.settings.openalex_api_url).rstrip('/')}/authors/{quote(normalized, safe='')}/works",
            params=self._params(**{"per-page": 100, "sort": "publication_date:desc"}),
        )
        items: list[PublicationItem] = []
        for work in payload.get("results", []):
            title = work.get("title")
            if not title:
                continue
            year, month = _openalex_year_month(work.get("publication_date"))
            authors: list[PublicationAuthor] = []
            for position, authorship in enumerate(work.get("authorships") or [], start=1):
                author = authorship.get("author") or {}
                authors.append(
                    PublicationAuthor(
                        name=str(author.get("display_name") or "Unknown author"),
                        position=position,
                        openalex_author_id=author.get("id"),
                        orcid_id=author.get("orcid"),
                        affiliation=((authorship.get("institutions") or [{}])[0] or {}).get("display_name"),
                    )
                )
            items.append(
                PublicationItem(
                    title=str(title).strip(),
                    doi=normalize_doi(work.get("doi")),
                    venue=((work.get("primary_location") or {}).get("source") or {}).get("display_name"),
                    publication_type=work.get("type"),
                    year=year,
                    month=month,
                    citation_count=work.get("cited_by_count"),
                    openalex_id=work.get("id"),
                    authors=authors,
                    metadata={"openalex": work, "source": "openalex"},
                )
            )
        return items


class CrossrefClient(_HttpConnector):
    async def work(self, doi: str) -> dict[str, Any] | None:
        headers: dict[str, str] = {}
        if self.settings.crossref_mailto:
            headers["User-Agent"] = f"AcademicRecordAPI/0.1 (mailto:{self.settings.crossref_mailto})"
        try:
            return await self.get_json(
                "Crossref",
                f"{str(self.settings.crossref_api_url).rstrip('/')}/works/{quote(doi, safe='')}",
                headers=headers,
            )
        except ExternalApiError as exc:
            logger.info("crossref_enrichment_unavailable", extra={"doi": doi, "error": str(exc)})
            return None

    async def normalize_doi_work(self, item: PublicationItem) -> PublicationItem:
        if not item.doi:
            return item
        payload = await self.work(item.doi)
        message = (payload or {}).get("message") or {}
        if not message:
            return item
        item.title = str((message.get("title") or [item.title])[0]).strip() or item.title
        item.venue = item.venue or ((message.get("container-title") or [None])[0])
        item.publisher = item.publisher or message.get("publisher")
        item.year = item.year or ((message.get("published-print") or message.get("published-online") or {}).get("date-parts") or [[None]])[0][0]
        item.citation_count = item.citation_count or message.get("is-referenced-by-count")
        item.metadata = {**item.metadata, "crossref": message}
        if not item.authors:
            item.authors = [
                PublicationAuthor(
                    name=" ".join(filter(None, [author.get("given"), author.get("family")])).strip(),
                    position=position,
                    orcid_id=author.get("ORCID"),
                    affiliation=((author.get("affiliation") or [{}])[0] or {}).get("name"),
                )
                for position, author in enumerate(message.get("author") or [], start=1)
                if " ".join(filter(None, [author.get("given"), author.get("family")])).strip()
            ]
        return item


async def dedupe_publications(
    *,
    orcid_id: str,
    openalex_author_id: str | None,
    settings: Settings,
) -> list[PublicationItem]:
    """Harvest all configured providers and merge by DOI/title-year."""

    orcid_items = await OrcidClient(settings).works(orcid_id)
    provider_items = list(orcid_items)
    resolved_openalex_author_id = openalex_author_id
    if not resolved_openalex_author_id:
        try:
            resolved_openalex_author_id = await OpenAlexClient(settings).author_for_orcid(orcid_id)
        except ExternalApiError as exc:
            logger.info("openalex_author_lookup_unavailable", extra={"error": str(exc)})
    if resolved_openalex_author_id:
        try:
            provider_items.extend(await OpenAlexClient(settings).works(resolved_openalex_author_id))
        except ExternalApiError as exc:
            logger.info("openalex_sync_unavailable", extra={"error": str(exc)})

    merged: dict[tuple[str, str], PublicationItem] = {}
    for item in provider_items:
        item.doi = normalize_doi(item.doi)
        key = ("doi", item.doi) if item.doi else ("title-year", item.normalized_title_hash)
        if key not in merged:
            merged[key] = item
            continue
        existing = merged[key]
        existing.metadata = {**existing.metadata, "merged_sources": sorted({
            str(existing.metadata.get("source", "unknown")), str(item.metadata.get("source", "unknown"))
        })}
        existing.authors = existing.authors or item.authors
        existing.venue = existing.venue or item.venue
        existing.publisher = existing.publisher or item.publisher
        existing.openalex_id = existing.openalex_id or item.openalex_id
        existing.citation_count = existing.citation_count or item.citation_count

    output: list[PublicationItem] = []
    for item in merged.values():
        output.append(await CrossrefClient(settings).normalize_doi_work(item))
    return output


def candidate_match(item: PublicationItem, full_name: str) -> tuple[float, dict[str, Any]]:
    """Return a transparent deterministic identity score, never a confirmation."""

    names = [normalize_title(author.name) for author in item.authors]
    normalized = normalize_title(full_name)
    surname = normalized.split()[-1] if normalized else ""
    surname_match = any(name.split() and name.split()[-1] == surname for name in names)
    score = 0.85 if surname_match else 0.55
    reasons = {
        "author_surname_match": surname_match,
        "sources": sorted({str(item.metadata.get("source", "unknown"))}),
        "identity_rule": "registered profile name compared with normalized author names",
    }
    return score, reasons
