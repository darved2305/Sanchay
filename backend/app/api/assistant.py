"""Sanchaya Assistant: a natural-language control layer over the platform.

The teacher types or speaks an instruction; the agent loop decides which
tools to call. Read tools run inline. Anything that writes is *staged* into
an action plan and executed only after an explicit approval -- so the model
proposes and the teacher disposes.

The confirmation round-trip carries a plan id and nothing else. Arguments are
read back from the persisted plan, never from the confirming request, which
is what stops an approved plan being swapped for a different one between
staging and execution. See agent/permissions.py for the rest of the rules.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent import executor, registry
from ..agent.contracts import ToolScope
from ..agent.loop import run_turn
from ..agent.permissions import GRANTABLE_SCOPES, load_granted_scopes, set_scope_permission
from ..agent.tools.read import PLATFORM_MAP
from ..core.auth import CurrentUser, require_faculty
from ..core.config import Settings, get_settings
from ..core.db import get_db
from ..services.llm import LLMProvider

router = APIRouter(prefix="/assistant", tags=["assistant"])

# Tool modules self-register on import; do it once here rather than as an
# package __init__ side effect so a broken module is a loud ImportError at
# startup instead of a tool that silently never registers.
registry.load_tools()


class MessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: UUID | None = None


class ConfirmRequest(BaseModel):
    approve: bool
    #: Optional "always allow this kind of action from now on", applied
    #: before execution so the grant covers this run too.
    always_allow_scope: str | None = None


class PermissionRequest(BaseModel):
    scope: str
    mode: str


async def _ensure_conversation(
    session: AsyncSession, principal: CurrentUser, conversation_id: UUID | None
) -> UUID:
    """Resolve an owned conversation, creating one on first message.

    A supplied id must belong to the caller; an unknown or someone else's id
    is a 404 rather than silently starting a new thread, so a mistyped id
    cannot quietly split a conversation.
    """

    if conversation_id is None:
        result = await session.execute(
            text(
                """
                insert into public.assistant_conversations (profile_id)
                values (:profile_id)
                returning id
                """
            ),
            {"profile_id": principal.user_id},
        )
        return result.scalar_one()

    result = await session.execute(
        text(
            """
            select id from public.assistant_conversations
            where id = :id and profile_id = :profile_id
            """
        ),
        {"id": conversation_id, "profile_id": principal.user_id},
    )
    owned = result.scalar_one_or_none()
    if owned is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return owned


@router.post("/message")
async def send_message(
    payload: MessageRequest,
    principal: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    conversation_id = await _ensure_conversation(session, principal, payload.conversation_id)
    turn = await run_turn(
        session,
        principal,
        LLMProvider(settings=settings),
        str(conversation_id),
        payload.message.strip(),
    )
    await session.commit()
    return turn.as_dict()


@router.post("/plans/{plan_id}/confirm")
async def confirm_plan(
    plan_id: UUID,
    payload: ConfirmRequest,
    principal: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not payload.approve:
        result = await executor.deny_plan(session, principal, str(plan_id))
        await session.commit()
        return result

    if payload.always_allow_scope:
        try:
            scope = ToolScope(payload.always_allow_scope)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown permission scope {payload.always_allow_scope!r}",
            ) from exc
        # Refused for non-grantable scopes -- deletes, profile edits and
        # outbound mail can never be pre-approved, whatever the client asks.
        if not await set_scope_permission(session, principal.user_id, scope, "always_allow"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{scope.value} always require confirmation and cannot be pre-approved",
            )

    return await executor.execute_plan(session, principal, str(plan_id))


@router.get("/conversations")
async def list_conversations(
    principal: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The teacher's past conversations, most recently active first.

    The title is derived from their opening message rather than stored, so it
    is always the real subject even for conversations that predate titling.
    Conversations with no user message are omitted: opening the page creates a
    row, and an empty shell in the history list is noise, not history.
    """

    result = await session.execute(
        text(
            """
            select
              c.id,
              c.title,
              c.updated_at,
              first_message.content as opening_message,
              last_message.content as latest_message,
              (
                select count(*) from public.assistant_messages m
                where m.conversation_id = c.id and m.role in ('user', 'assistant')
              ) as message_count
            from public.assistant_conversations c
            cross join lateral (
              select m.content from public.assistant_messages m
              where m.conversation_id = c.id and m.role = 'user' and m.content is not null
              order by m.created_at asc limit 1
            ) as first_message
            left join lateral (
              select m.content from public.assistant_messages m
              where m.conversation_id = c.id and m.role = 'assistant' and m.content is not null
              order by m.created_at desc limit 1
            ) as last_message on true
            where c.profile_id = :profile_id
            order by c.updated_at desc
            limit 50
            """
        ),
        {"profile_id": principal.user_id},
    )
    conversations = [
        {
            "id": str(row["id"]),
            "title": row["title"] or _derive_title(row["opening_message"]),
            "preview": _preview(row["latest_message"] or row["opening_message"]),
            "message_count": row["message_count"],
            "updated_at": str(row["updated_at"]),
        }
        for row in result.mappings().all()
    ]
    return {"conversations": conversations}


def _derive_title(opening_message: str | None) -> str:
    text_value = " ".join((opening_message or "").split())
    if not text_value:
        return "New conversation"
    return text_value if len(text_value) <= 60 else f"{text_value[:57].rstrip()}..."


def _preview(message: str | None) -> str:
    # Replies are markdown; strip the syntax that reads as noise in one line.
    text_value = re.sub(r"[*_`#>|-]+", " ", message or "")
    text_value = " ".join(text_value.split())
    return text_value if len(text_value) <= 120 else f"{text_value[:117].rstrip()}..."


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: UUID,
    principal: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _ensure_conversation(session, principal, conversation_id)
    result = await session.execute(
        text(
            """
            select role, content, tool_calls, tool_result, created_at
            from public.assistant_messages
            where conversation_id = :conversation_id
            order by created_at asc
            """
        ),
        {"conversation_id": conversation_id},
    )
    messages = [dict(row) for row in result.mappings().all()]
    for message in messages:
        message["created_at"] = str(message["created_at"])
    return {"conversation_id": str(conversation_id), "messages": messages}


@router.get("/permissions")
async def get_permissions(
    principal: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    granted = await load_granted_scopes(session, principal.user_id)
    return {
        "scopes": [
            {
                "scope": scope.value,
                "mode": "always_allow" if scope in granted else "ask",
                "grantable": True,
            }
            for scope in sorted(GRANTABLE_SCOPES, key=lambda s: s.value)
        ],
        # Surfaced so the UI can explain *why* these never appear as
        # always-allow options, rather than just omitting them.
        "always_confirm": [
            scope.value for scope in ToolScope if scope not in GRANTABLE_SCOPES
        ],
    }


@router.put("/permissions")
async def set_permissions(
    payload: PermissionRequest,
    principal: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        scope = ToolScope(payload.scope)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown scope {payload.scope!r}"
        ) from exc
    if not await set_scope_permission(session, principal.user_id, scope, payload.mode):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{scope.value} cannot be set to {payload.mode!r}",
        )
    await session.commit()
    return {"scope": scope.value, "mode": payload.mode}


@router.get("/capabilities")
async def get_capabilities(
    principal: CurrentUser = Depends(require_faculty),
) -> dict[str, Any]:
    """Static platform map plus the live tool catalogue.

    Lets the UI render the suggested prompts and the "what can I do" panel
    without spending an LLM call.
    """

    return {
        "areas": PLATFORM_MAP,
        "tools": [
            {
                "name": spec.name,
                "description": spec.description,
                "risk_class": spec.risk_class.value,
                "scope": spec.scope.value,
            }
            for spec in registry.all_tools()
        ],
    }
