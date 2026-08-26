"""Executes an approved assistant action plan.

This is the second half of the security boundary described in
``permissions.py``: the loop only ever *proposes* a plan, and nothing here
executes a step whose arguments did not come straight off the persisted
``assistant_action_plans`` row. Ownership is re-checked here rather than
trusted from an earlier request, because the backend connects with a role
that bypasses RLS -- this module is the only thing standing between one
teacher's approval and another teacher's data.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser
from . import registry
from .contracts import PlanStep, ToolResult

logger = logging.getLogger(__name__)


async def _load_plan_for_update(
    session: AsyncSession, principal: CurrentUser, plan_id: str
) -> dict[str, Any] | None:
    try:
        plan_uuid = UUID(str(plan_id))
    except ValueError:
        return None
    result = await session.execute(
        text(
            """
            select id, profile_id, status, steps, expires_at
            from public.assistant_action_plans
            where id = :plan_id and profile_id = :profile_id
            for update
            """
        ),
        {"plan_id": plan_uuid, "profile_id": principal.user_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def _save_plan(
    session: AsyncSession,
    plan_id: Any,
    *,
    status: str,
    steps: list[PlanStep] | None = None,
    executed_at: datetime | None = None,
) -> None:
    fields = ["status = :status"]
    params: dict[str, Any] = {"plan_id": plan_id, "status": status}
    if steps is not None:
        fields.append("steps = cast(:steps as jsonb)")
        params["steps"] = json.dumps([step.as_dict() for step in steps])
    if executed_at is not None:
        fields.append("executed_at = :executed_at")
        params["executed_at"] = executed_at
    await session.execute(
        text(f"update public.assistant_action_plans set {', '.join(fields)} where id = :plan_id"),
        params,
    )


async def execute_plan(session: AsyncSession, principal: CurrentUser, plan_id: str) -> dict[str, Any]:
    """Run every staged step of an owned, pending, unexpired plan in order.

    Stops at the first failure and marks the remaining steps ``skipped`` so a
    half-applied plan is visible on the UI timeline rather than silently
    partial. Commits once, after every step has run (or the plan has been
    marked failed) -- tool handlers deliberately do not commit themselves.
    """

    plan_row = await _load_plan_for_update(session, principal, plan_id)
    if plan_row is None:
        return {"plan_id": plan_id, "status": "not_found", "steps": [], "error": "Plan not found."}

    if plan_row["status"] != "pending":
        return {
            "plan_id": plan_id,
            "status": plan_row["status"],
            "steps": plan_row["steps"],
            "error": f"Plan is not pending (status={plan_row['status']!r}).",
        }

    expires_at = plan_row["expires_at"]
    now = datetime.now(UTC)
    if expires_at is not None and expires_at < now:
        await _save_plan(session, plan_row["id"], status="expired")
        await session.commit()
        return {
            "plan_id": plan_id,
            "status": "expired",
            "steps": plan_row["steps"],
            "error": "This plan has expired; ask again to get a fresh one.",
        }

    await _save_plan(session, plan_row["id"], status="executing")

    raw_steps = plan_row["steps"] or []
    if isinstance(raw_steps, str):
        raw_steps = json.loads(raw_steps)
    steps = [PlanStep.from_dict(raw) for raw in raw_steps]

    try:
        failed = False
        for step in steps:
            if failed:
                step.status = "skipped"
                continue

            spec = registry.get_tool(step.tool)
            if spec is None:
                step.status = "failed"
                step.error = f"Tool {step.tool!r} is no longer available."
                failed = True
                continue

            try:
                result: ToolResult = await spec.handler(session, principal, step.args)
            except Exception as exc:  # noqa: BLE001 - a tool crash must not abort bookkeeping
                logger.warning("agent_plan_step_failed", extra={"tool": step.tool, "error": str(exc)})
                step.status = "failed"
                step.error = f"{step.tool} failed unexpectedly."
                failed = True
                continue

            step.result = result.as_dict()
            if result.ok:
                step.status = "succeeded"
            else:
                step.status = "failed"
                step.error = result.error or result.summary
                failed = True

        executed_at = datetime.now(UTC)
        if failed:
            # The teacher approved the plan as a whole, so a partially applied
            # plan must not survive: roll back every write this run made before
            # recording the outcome. Without this, a plan reported as "failed"
            # would still leave the steps that ran before the failure committed,
            # which is exactly the half-applied state the approval card promises
            # cannot happen.
            await session.rollback()
            for step in steps:
                if step.status == "succeeded":
                    step.status = "skipped"
                    step.error = "Rolled back because a later step in this plan failed."
            final_status = "failed"
        else:
            final_status = "completed"
        await _save_plan(session, plan_row["id"], status=final_status, steps=steps, executed_at=executed_at)
        await session.commit()
    except Exception:
        await session.rollback()
        await _save_plan(session, plan_row["id"], status="failed", steps=steps)
        await session.commit()
        final_status = "failed"

    return {
        "plan_id": str(plan_row["id"]),
        "status": final_status,
        "steps": [step.as_dict() for step in steps],
    }


async def deny_plan(session: AsyncSession, principal: CurrentUser, plan_id: str) -> dict[str, Any]:
    """Mark a pending plan denied. Owner-scoped, same as ``execute_plan``."""

    plan_row = await _load_plan_for_update(session, principal, plan_id)
    if plan_row is None:
        return {"plan_id": plan_id, "status": "not_found", "error": "Plan not found."}

    if plan_row["status"] != "pending":
        return {
            "plan_id": plan_id,
            "status": plan_row["status"],
            "error": f"Plan is not pending (status={plan_row['status']!r}).",
        }

    await _save_plan(session, plan_row["id"], status="denied")
    await session.commit()
    return {"plan_id": str(plan_row["id"]), "status": "denied"}
