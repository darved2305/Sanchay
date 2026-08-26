"""Read-only assistant tools.

REFERENCE MODULE. Every other tool module follows the shape established
here, so read this one before writing another:

* One ``@tool(...)`` decorator per handler, declaring risk class and scope.
* Handler signature is always ``(session, principal, args) -> ToolResult``.
* ``principal.user_id`` scopes every query. Never take an owner from ``args``
  -- the registry rejects such a schema, but the query is where it matters.
* Expected failures return ``ToolResult.failure(...)``; they do not raise.

Read tools execute inline during the agent loop and are never staged, so
they must be genuinely side-effect free.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.appraisals import (
    _activities_for_cycle,
    _category_matches,
    _sections,
    compute_appraisal_readiness,
)
from ...api.grantops import _eligibility_for
from ...core.auth import CurrentUser
from ..contracts import RiskClass, ToolResult, ToolScope
from ..registry import tool

#: Every faculty-facing destination, keyed by the exact ``currentView``
#: string DashboardApp switches on (DashboardApp.jsx:145-172). The assistant
#: navigates by setting this value, so a typo here is a dead link -- keep it
#: in sync with that file.
PLATFORM_MAP: list[dict[str, str]] = [
    {"view": "dashboard", "name": "Dashboard", "what": "Your appraisal readiness, pending evidence, deadlines and recent activity at a glance."},
    {"view": "activities", "name": "Academic Records", "what": "Every teaching, research, publication, workshop and service activity you have recorded. Confirm publication candidates here."},
    {"view": "evidence", "name": "Evidence Vault", "what": "Your private certificate and document library. Upload proof once and attach it to any activity or appraisal."},
    {"view": "appraisal", "name": "Appraisal", "what": "Your current appraisal cycle: readiness score, generated draft, submission and reviewer feedback."},
    {"view": "action-inbox", "name": "Action Inbox", "what": "Academic email that needs a decision, prioritised, with grounded reply drafts."},
    {"view": "grantops", "name": "GrantOps", "what": "Discover grants you are eligible for, check readiness, and run a proposal workspace with your team."},
    {"view": "reconstruct", "name": "Reconstruct My Year", "what": "Recover activities you forgot to log by scanning your Gmail, Calendar and Drive."},
    {"view": "cv-import", "name": "CV Import", "what": "Upload an existing CV and turn it into confirmed activity records."},
    {"view": "career", "name": "Career Growth", "what": "Promotion-rule progress, goals, matched opportunities and your promotion dossier."},
    {"view": "forms", "name": "Any Form Assistant", "what": "Upload any institutional spreadsheet and have it filled from your record."},
    {"view": "rescue", "name": "Deadline Rescue", "what": "One click before a deadline: sync publications, recover activities, check evidence and draft your appraisal."},
    {"view": "teaching-change", "name": "Teaching Change Detector", "what": "Compare two years of course material and log what actually changed."},
    {"view": "lor-studio", "name": "LOR Studio", "what": "Track students you mentor and draft grounded recommendation letters."},
    {"view": "community", "name": "Community", "what": "Find collaborators, join communities, share opportunities and message peers."},
    {"view": "profile", "name": "Profile", "what": "Your designation, department, ORCID and research interests."},
]

_VALID_VIEWS = {entry["view"] for entry in PLATFORM_MAP}


@tool(
    name="explain_platform",
    description=(
        "Explain what the teacher can do on Sanchaya, or what a particular area is for. "
        "Use this for questions like 'what can I do here', 'where do I put certificates', "
        "or 'what is the Evidence Vault'. Returns the list of areas with descriptions; "
        "mention the relevant ones by name in your reply so they render as links."
    ),
    parameters={
        "type": "object",
        "properties": {
            "topic": {
                "type": "string",
                "description": "Optional area to focus on, e.g. 'evidence' or 'grants'. Omit for a full overview.",
            }
        },
        "required": [],
    },
    risk_class=RiskClass.READ,
    scope=ToolScope.PLATFORM,
)
async def explain_platform(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    topic = (args.get("topic") or "").strip().lower()
    entries = PLATFORM_MAP
    if topic:
        matched = [
            entry for entry in PLATFORM_MAP
            if topic in entry["view"] or topic in entry["name"].lower() or topic in entry["what"].lower()
        ]
        entries = matched or PLATFORM_MAP
    return ToolResult(
        ok=True,
        summary=f"{len(entries)} areas of Sanchaya",
        data={"areas": entries},
        ui_hint="list",
    )


@tool(
    name="navigate_to",
    description=(
        "Open a page of Sanchaya for the teacher. Use when they ask to go to, open, or show "
        "a specific area of the platform. Do not use it to answer questions about data -- "
        "fetch the data with the appropriate tool instead of sending them to a page."
    ),
    parameters={
        "type": "object",
        "properties": {
            "view": {
                "type": "string",
                "enum": sorted(_VALID_VIEWS),
                "description": "Which page to open.",
            }
        },
        "required": ["view"],
    },
    risk_class=RiskClass.READ,
    scope=ToolScope.PLATFORM,
)
async def navigate_to(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    view = str(args.get("view") or "").strip()
    if view not in _VALID_VIEWS:
        return ToolResult.failure(f"There is no page called {view!r}.")
    name = next(entry["name"] for entry in PLATFORM_MAP if entry["view"] == view)
    return ToolResult(
        ok=True,
        summary=f"Opening {name}",
        data={"view": view, "name": name},
        ui_hint="navigate",
        ui_target=view,
    )


@tool(
    name="search_activities",
    description=(
        "Search the teacher's own academic activities: publications, workshops, FDPs, projects, "
        "grants, teaching, service and awards. Use for questions like 'show my publications from "
        "2025', 'what workshops did I attend', or 'list my unconfirmed activities'."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Free-text match against the activity title."},
            "category": {
                "type": "string",
                "enum": [
                    "teaching", "research", "publication", "project", "grant", "workshop_fdp",
                    "seminar", "invited_talk", "mentorship", "committee", "institutional_service",
                    "community_engagement", "award", "patent", "reviewing", "conference", "other",
                ],
                "description": "Restrict to one activity category.",
            },
            "academic_year": {
                "type": "string",
                "description": "Academic year in YYYY-YY form, e.g. '2025-26'. The academic year runs July to June.",
            },
            "status": {
                "type": "string",
                "enum": ["proposed", "confirmed", "archived"],
                "description": "Restrict to one status. 'proposed' means awaiting the teacher's confirmation.",
            },
            "limit": {"type": "integer", "description": "Maximum rows to return (default 20, max 50)."},
        },
        "required": [],
    },
    risk_class=RiskClass.READ,
    scope=ToolScope.ACTIVITIES,
)
async def search_activities(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    clauses = ["a.owner_id = :owner_id"]
    params: dict[str, Any] = {"owner_id": principal.user_id}

    if query := (args.get("query") or "").strip():
        clauses.append("a.title ilike :query")
        params["query"] = f"%{query}%"
    if category := (args.get("category") or "").strip():
        clauses.append("a.category = cast(:category as activity_category)")
        params["category"] = category
    if academic_year := (args.get("academic_year") or "").strip():
        clauses.append("a.academic_year = :academic_year")
        params["academic_year"] = academic_year
    if status := (args.get("status") or "").strip():
        clauses.append("a.status = cast(:status as activity_status)")
        params["status"] = status

    try:
        limit = int(args.get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20
    params["limit"] = min(max(limit, 1), 50)

    result = await session.execute(
        text(
            f"""
            select a.id, a.title, a.category::text as category, a.status::text as status,
                   a.academic_year, a.start_date, a.end_date, a.evidence_status::text as evidence_status
            from public.academic_activities a
            where {' and '.join(clauses)}
            order by a.start_date desc nulls last, a.created_at desc
            limit :limit
            """
        ),
        params,
    )
    rows = [dict(row) for row in result.mappings().all()]
    for row in rows:
        row["id"] = str(row["id"])
        row["start_date"] = str(row["start_date"]) if row["start_date"] else None
        row["end_date"] = str(row["end_date"]) if row["end_date"] else None

    if not rows:
        return ToolResult(ok=True, summary="No matching activities found.", data={"activities": []}, ui_hint="list")
    return ToolResult(
        ok=True,
        summary=f"Found {len(rows)} matching {'activity' if len(rows) == 1 else 'activities'}",
        data={"activities": rows},
        ui_hint="list",
    )


def _as_iso(value: Any) -> str | None:
    """JSON-safe timestamps: ToolResult.data is persisted and serialised."""

    return value.isoformat() if value is not None else None


def _summarise_appraisal_status(args: dict[str, Any]) -> str:
    academic_year = str(args.get("academic_year") or "").strip()
    if academic_year:
        return f"Check appraisal readiness for {academic_year}"
    return "Check your current appraisal readiness"


@tool(
    name="get_appraisal_status",
    description=(
        "Show how ready the teacher's appraisal is for the current cycle: the readiness percentage, "
        "which required sections still lack a confirmed, evidence-backed activity, and whether anything "
        "has been submitted or reviewed yet. Use for questions like 'am I ready for my appraisal', "
        "'how does my appraisal look', or 'what is missing for my appraisal'."
    ),
    parameters={
        "type": "object",
        "properties": {
            "academic_year": {
                "type": "string",
                "description": "Academic year in YYYY-YY form, e.g. '2025-26'. Omit to use the currently open cycle.",
            }
        },
        "required": [],
    },
    risk_class=RiskClass.READ,
    scope=ToolScope.DOCUMENTS,
)
async def get_appraisal_status(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    academic_year = str(args.get("academic_year") or "").strip()
    clauses = ["c.institution_id = (select institution_id from public.profiles where id = :uid)"]
    params: dict[str, Any] = {"uid": principal.user_id}
    if academic_year:
        clauses.append("c.academic_year = :academic_year")
        params["academic_year"] = academic_year
    else:
        clauses.append("c.status = 'open'")

    cycle_result = await session.execute(
        text(
            f"""
            select c.id::text as id, c.name, c.academic_year, c.opens_at, c.due_at, c.status::text as status,
                   c.template_id, coalesce(s.status::text, 'not_started') as submission_status,
                   s.readiness as submission_readiness, s.submitted_at
            from public.appraisal_cycles c
            left join public.appraisal_submissions s on s.cycle_id = c.id and s.profile_id = :uid
            where {' and '.join(clauses)}
            order by c.due_at nulls last, c.created_at desc
            limit 1
            """
        ),
        params,
    )
    cycle_row = cycle_result.mappings().first()
    if cycle_row is None:
        message = (
            f"Your institution has no appraisal cycle open for {academic_year} yet."
            if academic_year
            else "Your institution has no open appraisal cycle right now -- readiness will show here once one opens."
        )
        return ToolResult(ok=True, summary=message, data={"cycle": None}, ui_hint="detail")

    # Same scoring path as GET /appraisals/readiness -- never reimplemented.
    cycle = dict(cycle_row)
    template_sections = await _sections(session, UUID(str(cycle["template_id"])))
    activities = await _activities_for_cycle(session, principal.user_id, str(cycle["academic_year"]))
    scored: list[dict[str, Any]] = []
    breakdown: list[dict[str, Any]] = []
    for section in template_sections:
        items = [activity for activity in activities if _category_matches(section, str(activity["category"]))]
        scored.append({**section, "items": items})
        ready_items = [
            item
            for item in items
            if item.get("status") == "confirmed"
            and item.get("evidence_status") in {None, "attached", "none_needed"}
        ]
        required = bool(section["required"])
        breakdown.append(
            {
                "title": section["title"],
                "required": required,
                "items": len(items),
                "ready_items": len(ready_items),
                "complete": not required or bool(ready_items),
            }
        )

    readiness_value = compute_appraisal_readiness(scored)
    missing = [entry["title"] for entry in breakdown if entry["required"] and not entry["complete"]]
    summary = f"Appraisal readiness {readiness_value:g}% for {cycle['name']}"
    summary += f"; still short: {', '.join(missing)}" if missing else "; all required sections covered"

    return ToolResult(
        ok=True,
        summary=summary,
        data={
            "cycle": {
                "id": cycle["id"],
                "name": cycle["name"],
                "academic_year": cycle["academic_year"],
                "status": cycle["status"],
                "due_at": _as_iso(cycle["due_at"]),
            },
            "submission": {
                "status": cycle["submission_status"],
                "readiness": float(cycle["submission_readiness"]) if cycle["submission_readiness"] is not None else None,
                "submitted_at": _as_iso(cycle["submitted_at"]),
            },
            "readiness": readiness_value,
            "activity_count": len(activities),
            "sections": breakdown,
        },
        ui_hint="detail",
    )


_GRANT_STATUS_ORDER = {"eligible": 0, "possibly_eligible": 1, "not_currently_eligible": 2}
_GRANT_STATUS_LABELS = {
    "eligible": "eligible",
    "possibly_eligible": "possibly eligible",
    "not_currently_eligible": "not currently eligible",
}


def _summarise_find_grants(args: dict[str, Any]) -> str:
    query = str(args.get("query") or "").strip()
    within_days = args.get("within_days")
    bits = []
    if query:
        bits.append(f'matching "{query}"')
    if within_days:
        bits.append(f"closing within {within_days} days")
    suffix = (" " + " ".join(bits)) if bits else ""
    return f"Find grant opportunities{suffix}"


@tool(
    name="find_grants",
    description=(
        "Search grant opportunities the teacher could apply for. Each result carries an eligibility verdict "
        "-- eligible / possibly eligible / not currently eligible -- plus the exact reasons behind it: which "
        "designation, PhD, publication-count, prior-grant or research-interest criterion was met or missed. "
        "Use for 'which grants can I apply for' or 'find grants for my research'. Never quote a bare score; "
        "always relay the reasons."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Free-text match against the grant title, agency or description.",
            },
            "within_days": {
                "type": "integer",
                "description": "Only include grants whose deadline falls within this many days from today.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum grants to return (default 10, max 25). Eligible ones are ranked first.",
            },
        },
        "required": [],
    },
    risk_class=RiskClass.READ,
    scope=ToolScope.PLATFORM,
)
async def find_grants(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    clauses = ["(o.institution_id is null or o.institution_id = (select institution_id from public.profiles where id = :uid))"]
    params: dict[str, Any] = {"uid": principal.user_id}

    if query := str(args.get("query") or "").strip():
        clauses.append("(o.title ilike :query or o.agency ilike :query or o.description ilike :query)")
        params["query"] = f"%{query}%"
    if within_days := args.get("within_days"):
        try:
            days = int(within_days)
        except (TypeError, ValueError):
            days = 0
        if days > 0:
            clauses.append("o.deadline is not null and o.deadline >= now() and o.deadline <= now() + make_interval(days => :within_days)")
            params["within_days"] = min(days, 365)

    try:
        limit = int(args.get("limit") or 10)
    except (TypeError, ValueError):
        limit = 10
    params["limit"] = min(max(limit, 1), 25)

    result = await session.execute(
        text(
            f"""
            select o.id::text as id, o.title, o.agency, o.description, o.url,
                   o.deadline, o.amount::float8 as amount, o.disciplines, o.eligibility_rules
            from public.grant_opportunities o
            where {' and '.join(clauses)}
            order by o.deadline nulls last, o.created_at desc
            limit :limit
            """
        ),
        params,
    )
    opportunities = [dict(row) for row in result.mappings().all()]
    if not opportunities:
        return ToolResult(
            ok=True,
            summary="No grant opportunities matched that search.",
            data={"grants": []},
            ui_hint="list",
        )

    grants: list[dict[str, Any]] = []
    for opportunity in opportunities:
        # Same deterministic verdict + reasons as GET /grantops eligibility.
        outcome = await _eligibility_for(session, principal.user_id, opportunity)
        grants.append(
            {
                "id": opportunity["id"],
                "title": opportunity["title"],
                "agency": opportunity["agency"],
                "deadline": _as_iso(opportunity["deadline"]),
                "amount": opportunity["amount"],
                "url": opportunity["url"],
                "eligibility_status": outcome["status"],
                "eligibility_reasons": outcome["reasons"],
            }
        )
    grants.sort(key=lambda grant: (_GRANT_STATUS_ORDER.get(grant["eligibility_status"], 3), grant["deadline"] or "9999-12-31"))

    eligible_count = sum(1 for grant in grants if grant["eligibility_status"] == "eligible")
    summary = f"Found {len(grants)} opportunit{'y' if len(grants) == 1 else 'ies'}: {eligible_count} eligible"
    return ToolResult(ok=True, summary=summary, data={"grants": grants}, ui_hint="list")
