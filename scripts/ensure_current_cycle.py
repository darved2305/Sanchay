"""Open an appraisal cycle for the current academic year, for every institution.

An appraisal cycle is year-scoped: it only ever shows activities recorded in its
own academic year. So the moment a new session starts, an institution whose most
recent cycle is last year's has an appraisal that cannot see anything anyone
records -- it reads as empty no matter how much work is on file.

This script closes that gap by deriving the current academic year from today's
date (never a hardcoded year) and making sure each institution has an open cycle
for it, reusing the institution's existing template. Safe to re-run: an
institution that already has a cycle for the year is left alone.

    python scripts/ensure_current_cycle.py [--close-older] [--dry-run]

``--close-older`` also marks previous open cycles as closed, so the reviewer
queue does not show two live cycles at once.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import UTC, date, datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import asyncpg
from dotenv import load_dotenv

from app.core.academic_year import derive_academic_year


def _cycle_window(academic_year: str) -> tuple[datetime, datetime]:
    """Opens at the start of the academic year, due at the end of it."""

    start_year = int(academic_year.split("-")[0])
    return (
        datetime(start_year, 7, 1, tzinfo=UTC),
        datetime(start_year + 1, 6, 30, 23, 59, 59, tzinfo=UTC),
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--close-older", action="store_true", help="Close previously open cycles")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change and exit")
    args = parser.parse_args()

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    # Supabase fronts Postgres with pgbouncer in transaction mode, which cannot
    # keep server-side prepared statements across calls.
    connection = await asyncpg.connect(url, statement_cache_size=0)

    academic_year = derive_academic_year(date.today())
    opens_at, due_at = _cycle_window(academic_year)
    print(f"Current academic year: {academic_year}")

    changed = 0
    try:
        institutions = await connection.fetch("select id, name from public.institutions order by name")
        for institution in institutions:
            template = await connection.fetchrow(
                "select id, name from public.appraisal_templates where institution_id = $1 "
                "order by created_at limit 1",
                institution["id"],
            )
            if template is None:
                print(f"  {institution['name']}: no appraisal template, skipped")
                continue

            existing = await connection.fetchrow(
                "select id, status::text as status from public.appraisal_cycles "
                "where institution_id = $1 and academic_year = $2",
                institution["id"],
                academic_year,
            )
            if existing and existing["status"] == "open":
                print(f"  {institution['name']}: already open for {academic_year}")
            elif args.dry_run:
                verb = "reopen" if existing else "create"
                print(f"  {institution['name']}: would {verb} cycle for {academic_year}")
                changed += 1
            elif existing:
                await connection.execute(
                    "update public.appraisal_cycles set status = 'open', opens_at = $2, due_at = $3, "
                    "updated_at = now() where id = $1",
                    existing["id"], opens_at, due_at,
                )
                print(f"  {institution['name']}: reopened cycle for {academic_year}")
                changed += 1
            else:
                await connection.execute(
                    "insert into public.appraisal_cycles "
                    "(institution_id, name, academic_year, opens_at, due_at, status, template_id) "
                    "values ($1, $2, $3, $4, $5, 'open', $6)",
                    institution["id"], f"Annual Appraisal {academic_year}", academic_year,
                    opens_at, due_at, template["id"],
                )
                print(f"  {institution['name']}: created cycle for {academic_year}")
                changed += 1

            if args.close_older and not args.dry_run:
                closed = await connection.execute(
                    "update public.appraisal_cycles set status = 'closed', updated_at = now() "
                    "where institution_id = $1 and academic_year <> $2 and status = 'open'",
                    institution["id"], academic_year,
                )
                if closed != "UPDATE 0":
                    print(f"    closed older open cycles ({closed})")
    finally:
        await connection.close()

    print(f"\n{changed} cycle(s) {'would change' if args.dry_run else 'changed'}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
