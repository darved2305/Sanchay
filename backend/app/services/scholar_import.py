"""Google Scholar paste-import: pasted profile-page text -> extracted
publications, gated on a deterministic identity check before anything is
written (see ``app.connectors.publications.scholar_identity_match``).

There is no live fetch of scholar.google.com anywhere in this product --
Google Scholar disallows automated /scholar and most /citations requests in
its robots.txt, has no official API, and is well known to CAPTCHA/block
requests from datacenter IPs regardless. The user pastes their own profile
page's text (Ctrl+A, copy) instead.
"""

from __future__ import annotations

import re
from typing import Any

from .llm import LLMProvider

_YEAR_RE = re.compile(r"(19|20)\d{2}")
_EXACT_YEAR_RE = re.compile(r"^(19|20)\d{2}$")
_CITED_BY_RE = re.compile(r"^cited by\s+(\d+)$", re.IGNORECASE)
_PURE_NUMBER_RE = re.compile(r"^[\d,]+$")
_BOILERPLATE_LINES = {"title", "cited by", "year", "sort", "co-authors", "follow", "citations", "h-index", "i10-index"}

SCHOLAR_IMPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "person_name": {"type": ["string", "null"]},
        "total_citations": {"type": ["integer", "null"]},
        "h_index": {"type": ["integer", "null"]},
        "i10_index": {"type": ["integer", "null"]},
        "publications": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "authors": {"type": "array", "items": {"type": "string"}},
                    "venue": {"type": ["string", "null"]},
                    "year": {"type": ["integer", "null"]},
                    "citation_count": {"type": ["integer", "null"]},
                    "publication_type": {"type": ["string", "null"]},
                },
                "required": ["title", "authors", "venue", "year", "citation_count", "publication_type"],
            },
        },
    },
    "required": ["person_name", "total_citations", "h_index", "i10_index", "publications"],
}


def _first_int(lines: list[str], start: int) -> int | None:
    """Find the metric value following a "Citations"/"h-index"/"i10-index"
    label line. Real Scholar pages often insert an "All  Since 20XX" header
    line in between -- only a line that is *purely* digits (optionally with
    thousands separators) counts, so that header's own year number is never
    mistaken for the metric.
    """

    for line in lines[start : start + 3]:
        if _PURE_NUMBER_RE.match(line):
            return int(line.replace(",", ""))
    return None


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def _heuristic_extract_scholar(text: str) -> dict[str, Any]:
    """Line-scanning fallback for when no LLM key is configured.

    Google Scholar profile pages have a fairly predictable Ctrl+A text
    layout: the owner's name as the first line, a "Citations / h-index /
    i10-index" metrics block, then one repeating block per publication
    (title, authors, venue+year, and an optional "Cited by N" line). This is
    necessarily coarser than the LLM path -- copied-text layout varies by
    browser -- so it's a fallback, not the primary path.
    """

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    empty: dict[str, Any] = {"person_name": None, "total_citations": None, "h_index": None, "i10_index": None, "publications": []}
    if not lines:
        return empty

    person_name = lines[0]
    total_citations = h_index = i10_index = None
    for index, line in enumerate(lines):
        lowered = line.lower()
        if lowered == "citations" and total_citations is None:
            total_citations = _first_int(lines, index + 1)
        elif lowered == "h-index" and h_index is None:
            h_index = _first_int(lines, index + 1)
        elif lowered == "i10-index" and i10_index is None:
            i10_index = _first_int(lines, index + 1)

    publications: list[dict[str, Any]] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if len(line) < 8 or line.lower() in _BOILERPLATE_LINES or _EXACT_YEAR_RE.match(line):
            index += 1
            continue
        authors_line = lines[index + 1] if index + 1 < len(lines) else ""
        venue_line = lines[index + 2] if index + 2 < len(lines) else ""
        year_match = _YEAR_RE.search(venue_line)
        looks_like_authors = bool(authors_line) and "," in authors_line and not _EXACT_YEAR_RE.match(authors_line)
        if looks_like_authors and year_match:
            lookahead = index + 3
            citation_count = None
            if lookahead < len(lines):
                cited_match = _CITED_BY_RE.match(lines[lookahead])
                if cited_match:
                    citation_count = int(cited_match.group(1))
                    lookahead += 1
            publications.append({
                "title": line,
                "authors": [name.strip() for name in authors_line.split(",") if name.strip()],
                "venue": venue_line,
                "year": int(year_match.group(0)),
                "citation_count": citation_count,
                "publication_type": None,
            })
            index = lookahead
            continue
        index += 1

    return {
        "person_name": person_name,
        "total_citations": total_citations,
        "h_index": h_index,
        "i10_index": i10_index,
        "publications": publications,
    }


def _normalize_extraction(result: dict[str, Any], *, method: str) -> dict[str, Any]:
    """Coerce metric/year fields to int-or-None so a malformed LLM value (e.g.
    a stringified year) fails one field, not the whole import, and record
    which path produced this result -- callers must be able to tell a real
    LLM read from the much rougher regex fallback, not just get silently
    downgraded to it.
    """

    publications = []
    for item in result.get("publications") or []:
        publications.append({
            **item,
            "year": _coerce_int(item.get("year")),
            "citation_count": _coerce_int(item.get("citation_count")),
        })
    return {
        "person_name": result.get("person_name"),
        "total_citations": _coerce_int(result.get("total_citations")),
        "h_index": _coerce_int(result.get("h_index")),
        "i10_index": _coerce_int(result.get("i10_index")),
        "publications": publications,
        "extraction_method": method,
    }


async def extract_scholar_profile(text: str, llm: LLMProvider) -> dict[str, Any] | None:
    """Return the extracted profile dict, or ``None`` if extraction failed.

    ``None`` is a distinct outcome from "no publications found" (an empty
    ``publications`` list on an otherwise-valid extraction) -- callers must
    fail closed on ``None`` rather than treating it as an empty profile.
    The returned dict's ``extraction_method`` ("llm" or "heuristic") tells the
    caller whether the LLM path actually ran -- a transient Groq failure
    (timeout, bad key, malformed response) falls back silently inside
    ``extract_structured``, and callers/UI should surface that, not hide it.
    """

    result = await llm.extract_structured(
        instruction=(
            "This is the pasted text of a person's Google Scholar profile page "
            "(scholar.google.com/citations?user=...). Extract the profile owner's "
            "name exactly as displayed, their total citation count, h-index and "
            "i10-index if shown, and every distinct publication listed: title, "
            "authors, venue/journal, year, and citation count for that paper. "
            "Extract only what is literally present in the pasted text; never "
            "invent a name, author, venue, or number that isn't written there."
        ),
        source_text=text,
        json_schema=SCHOLAR_IMPORT_SCHEMA,
        schema_name="scholar_profile_import",
        max_source_chars=40000,
    )
    if result and result.get("person_name"):
        return _normalize_extraction(result, method="llm")
    heuristic = _heuristic_extract_scholar(text)
    if not heuristic.get("person_name"):
        return None
    return _normalize_extraction(heuristic, method="heuristic")
