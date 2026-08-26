"""Communication tools.

``draft_email`` creates a Gmail DRAFT and nothing more -- sending stays an
explicit action the teacher takes inside Gmail itself (product expansion §6),
exactly like the Action Inbox reply path in ``app/api/action_inbox.py``. It
reads the same ``gmail_compose`` row in ``public.oauth_connections`` and
reuses ``connectors.google`` for decryption, token refresh and the draft API
call, so there is one token-fetch path in the codebase, not two.

Expected failures (Gmail not configured, no connection, provider error)
return ``ToolResult.failure(...)``; they do not raise.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...connectors.google import create_gmail_draft, decrypt_token, encrypt_token, refresh_access_token
from ...core.auth import CurrentUser
from ...core.config import Settings, get_settings
from ..contracts import RiskClass, ToolResult, ToolScope
from ..registry import tool

logger = logging.getLogger(__name__)


async def _gmail_compose_access_token(
    session: AsyncSession, settings: Settings, profile_id: Any
) -> tuple[str | None, str | None]:
    """Return ``(access_token, error)`` for the teacher's gmail_compose connection.

    Mirrors the fetch/refresh flow in ``app/api/reconstruct.py``, with one
    deliberate difference: a refreshed token is written back but never
    committed here -- the agent executor owns the transaction and persists it
    alongside the rest of the approved plan's steps.
    """

    result = await session.execute(
        text(
            "select encrypted_access_token, encrypted_refresh_token, expires_at "
            "from public.oauth_connections where profile_id = :profile_id and provider = 'gmail_compose' "
            "and status = 'connected'"
        ),
        {"profile_id": profile_id},
    )
    connection = result.mappings().first()
    if connection is None:
        return None, "Your Gmail compose permission is not connected yet."
    expires_at = connection["expires_at"]
    if expires_at is not None and expires_at <= datetime.now(UTC) and connection["encrypted_refresh_token"]:
        refresh_token = decrypt_token(settings, connection["encrypted_refresh_token"])
        if refresh_token:
            try:
                refreshed = await refresh_access_token(settings, refresh_token)
            except Exception as exc:  # noqa: BLE001 - fall back to the stale token rather than aborting
                logger.warning("assistant_draft_email_token_refresh_failed", extra={"error": str(exc)})
                refreshed = None
            if refreshed and refreshed.get("access_token"):
                new_expires_in = refreshed.get("expires_in")
                new_expires_at = datetime.now(UTC) + timedelta(seconds=int(new_expires_in)) if new_expires_in else None
                await session.execute(
                    text(
                        "update public.oauth_connections set encrypted_access_token = :token, expires_at = :expires_at, "
                        "updated_at = now() where profile_id = :profile_id and provider = 'gmail_compose'"
                    ),
                    {
                        "token": encrypt_token(settings, refreshed["access_token"]),
                        "expires_at": new_expires_at,
                        "profile_id": profile_id,
                    },
                )
                return refreshed["access_token"], None
    if not connection["encrypted_access_token"]:
        return None, "Your Gmail connection has no usable token."
    return decrypt_token(settings, connection["encrypted_access_token"]), None


@tool(
    name="draft_email",
    description=(
        "Create a draft email in the teacher's Gmail account. It is saved to Drafts and NEVER sent -- "
        "the teacher reviews and presses send themselves. Use for 'draft a mail to ...' requests such as "
        "replying to a conference organiser or asking an HOD about appraisal deadlines."
    ),
    parameters={
        "type": "object",
        "properties": {
            "to": {
                "type": "string",
                "description": "Recipient email address.",
            },
            "subject": {
                "type": "string",
                "description": "Subject line of the email.",
            },
            "body": {
                "type": "string",
                "description": "Full plain-text body of the email, written and ready to review.",
            },
        },
        "required": ["to", "subject", "body"],
    },
    risk_class=RiskClass.EXTERNAL,
    scope=ToolScope.COMMS,
    summarise=lambda args: f"Create a Gmail draft to {args.get('to')}: “{args.get('subject')}”",
)
async def draft_email(session: AsyncSession, principal: CurrentUser, args: dict[str, Any]) -> ToolResult:
    to = str(args.get("to") or "").strip()
    subject = str(args.get("subject") or "").strip()
    body = str(args.get("body") or "").strip()
    if not to or "@" not in to:
        return ToolResult.failure("I need the recipient's email address.")
    if not subject:
        return ToolResult.failure("Give the email a subject line.")
    if not body:
        return ToolResult.failure("The email needs a body before I can save it as a draft.")

    settings = get_settings()
    if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
        return ToolResult.failure(
            "Google sign-in is not set up on this deployment, so Gmail drafts are unavailable."
        )
    access_token, problem = await _gmail_compose_access_token(session, settings, principal.user_id)
    if access_token is None:
        connect_hint = (
            "Open Reconstruct My Year, connect Gmail with compose permission, then ask me again."
        )
        return ToolResult.failure(f"{problem} {connect_hint}")

    try:
        draft = await create_gmail_draft(access_token, settings, to=to, subject=subject, body_text=body)
    except Exception as exc:  # noqa: BLE001 - provider failures are expected outcomes, not crashes
        logger.warning("assistant_draft_email_failed", extra={"error": str(exc)})
        return ToolResult.failure(
            "Gmail refused the draft -- your connection may have expired. "
            "Reconnect Gmail in Reconstruct My Year and try again."
        )
    return ToolResult(
        ok=True,
        summary=f"Gmail draft created to {to}: “{subject}” — it has NOT been sent",
        data={"draft_id": draft.get("id"), "to": to, "subject": subject},
        ui_hint="none",
    )
