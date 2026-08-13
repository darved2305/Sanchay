"""Gmail / Google Calendar / Google Drive connectors for Reconstruct My Year.

Read-only scopes only; no email is ever sent and no file is ever written back
to a connected account. Real OAuth is implemented up to the ENV boundary --
authorize-URL construction, callback state verification, and the REST calls
each connector makes once a real access token exists -- but a live token
exchange requires ``GOOGLE_OAUTH_CLIENT_ID``/``GOOGLE_OAUTH_CLIENT_SECRET``,
which are not present in this environment. Absent credentials, connectors
report ``not_configured`` instead of raising, and the fixture connector below
lets the rest of the reconstruction pipeline (harvest -> classify ->
correlate -> confirm) be exercised end-to-end without live Google access, per
``RECONSTRUCT_FAKE_SOURCES``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlencode
from uuid import UUID

import httpx
from cryptography.fernet import Fernet, InvalidToken

from ..core.config import Settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

SCOPES = {
    "gmail": "https://www.googleapis.com/auth/gmail.readonly",
    "google_calendar": "https://www.googleapis.com/auth/calendar.readonly",
    "google_drive": "https://www.googleapis.com/auth/drive.readonly",
}
CONNECTOR_PROVIDERS = tuple(SCOPES.keys())

STATE_TTL_SECONDS = 600  # the OAuth consent redirect round-trip must complete within 10 minutes


def _state_secret(settings: Settings) -> bytes:
    # There is no separate "app secret" setting: the OAuth client secret is
    # already a backend-only value that only exists once Google OAuth is
    # configured, so it doubles as the HMAC key for signing the state
    # parameter. No new required env var, no new place for a key to leak.
    if not settings.google_oauth_client_secret:
        raise ValueError("Google OAuth is not configured")
    return settings.google_oauth_client_secret.get_secret_value().encode("utf-8")


def sign_oauth_state(settings: Settings, user_id: UUID, provider: str) -> str:
    """Encode {user_id, provider, expiry, nonce} into a tamper-evident state
    token. Google's redirect back to our callback carries no Authorization
    header, so this is how the callback recovers *which user* started the
    flow without a server-side session store."""

    nonce = secrets.token_urlsafe(8)
    expires_at = int(time.time()) + STATE_TTL_SECONDS
    payload = f"{user_id}:{provider}:{expires_at}:{nonce}"
    signature = hmac.new(_state_secret(settings), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}:{signature}".encode("utf-8")).decode("utf-8")


def verify_oauth_state(settings: Settings, state: str) -> tuple[UUID, str] | None:
    """Return (user_id, provider) if the state is authentic and unexpired, else None."""

    try:
        decoded = base64.urlsafe_b64decode(state.encode("utf-8")).decode("utf-8")
        user_id_str, provider, expires_at_str, nonce, signature = decoded.split(":")
    except (ValueError, UnicodeDecodeError):
        return None
    payload = f"{user_id_str}:{provider}:{expires_at_str}:{nonce}"
    expected_signature = hmac.new(_state_secret(settings), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected_signature):
        return None
    if int(expires_at_str) < int(time.time()):
        return None
    try:
        return UUID(user_id_str), provider
    except ValueError:
        return None


def _fernet(settings: Settings) -> Fernet:
    # Fernet needs a 32-byte urlsafe-base64 key; derive one deterministically
    # from the same backend-only secret used for state signing so token
    # encryption needs no additional configuration either.
    digest = hashlib.sha256(_state_secret(settings)).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_token(settings: Settings, plaintext: str) -> str:
    return _fernet(settings).encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_token(settings: Settings, ciphertext: str) -> str | None:
    try:
        return _fernet(settings).decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


@dataclass
class HarvestedItem:
    """One raw signal from a source, before academic filtering/classification."""

    source_type: str  # gmail | google_calendar | google_drive
    external_id: str
    title: str
    snippet: str
    occurred_on: str | None  # ISO date
    raw: dict[str, Any]


def build_authorize_url(settings: Settings, provider: str, state: str) -> str:
    if not settings.google_oauth_client_id or not settings.google_oauth_redirect_uri:
        raise ValueError("Google OAuth is not configured")
    params = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": SCOPES[provider],
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def generate_oauth_state() -> str:
    return secrets.token_urlsafe(32)


async def exchange_code_for_token(settings: Settings, code: str) -> dict[str, Any]:
    if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
        raise ValueError("Google OAuth is not configured")
    payload = {
        "code": code,
        "client_id": settings.google_oauth_client_id,
        "client_secret": settings.google_oauth_client_secret.get_secret_value(),
        "redirect_uri": settings.google_oauth_redirect_uri,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=settings.external_api_timeout_seconds) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data=payload)
        response.raise_for_status()
        return response.json()


async def refresh_access_token(settings: Settings, refresh_token: str) -> dict[str, Any]:
    if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
        raise ValueError("Google OAuth is not configured")
    payload = {
        "client_id": settings.google_oauth_client_id,
        "client_secret": settings.google_oauth_client_secret.get_secret_value(),
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=settings.external_api_timeout_seconds) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data=payload)
        response.raise_for_status()
        return response.json()


def _parse_email_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).date().isoformat()
    except (TypeError, ValueError):
        return None


# Google's own automated account-notification mail (OAuth consent receipts,
# sign-in alerts, "you shared account data with <app>") is emitted every time
# a user connects a source here, and its subject lines are full of words that
# collide with the academic keyword list ("granted", "review your activity"),
# so it gets misclassified as an academic signal unless filtered up front.
# Google sends these from several first-party addresses on the google.com
# apex domain -- e.g. "no-reply@accounts.google.com" but also
# "noreply-accounts@google.com" -- so match on the domain plus a
# noreply/alert/security marker in the local part rather than one exact
# address, which would only ever catch whichever format was tested last.
_GOOGLE_SENDER_DOMAINS = ("@google.com", "accounts.google.com")
_GOOGLE_AUTOMATED_MARKERS = ("noreply", "no-reply", "security", "alert")


def _is_google_system_notification(sender: str) -> bool:
    sender_lower = sender.lower()
    if not any(domain in sender_lower for domain in _GOOGLE_SENDER_DOMAINS):
        return False
    return any(marker in sender_lower for marker in _GOOGLE_AUTOMATED_MARKERS)


async def fetch_gmail_items(access_token: str, settings: Settings) -> list[HarvestedItem]:
    """List recent messages and return subject/snippet as harvestable items."""

    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=settings.external_api_timeout_seconds) as client:
        list_response = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers=headers,
            params={"maxResults": 50, "q": "newer_than:365d"},
        )
        list_response.raise_for_status()
        message_ids = [item["id"] for item in list_response.json().get("messages", [])]
        items: list[HarvestedItem] = []
        for message_id in message_ids[:50]:
            detail = await client.get(
                f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}",
                headers=headers,
                params={"format": "metadata", "metadataHeaders": ["Subject", "Date", "From"]},
            )
            if detail.status_code != 200:
                continue
            body = detail.json()
            headers_map = {h["name"]: h["value"] for h in body.get("payload", {}).get("headers", [])}
            if _is_google_system_notification(headers_map.get("From", "")):
                continue
            items.append(HarvestedItem(
                source_type="gmail",
                external_id=message_id,
                title=headers_map.get("Subject", ""),
                snippet=body.get("snippet", ""),
                occurred_on=_parse_email_date(headers_map.get("Date")),
                raw=body,
            ))
        return items


async def fetch_calendar_items(access_token: str, settings: Settings) -> list[HarvestedItem]:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=settings.external_api_timeout_seconds) as client:
        response = await client.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers=headers,
            params={"maxResults": 100, "singleEvents": True},
        )
        response.raise_for_status()
        items: list[HarvestedItem] = []
        for event in response.json().get("items", []):
            start = event.get("start", {}).get("date") or event.get("start", {}).get("dateTime", "")
            items.append(HarvestedItem(
                source_type="google_calendar",
                external_id=event.get("id", ""),
                title=event.get("summary", ""),
                snippet=event.get("description", "") or "",
                occurred_on=start[:10] if start else None,
                raw=event,
            ))
        return items


async def fetch_drive_items(access_token: str, settings: Settings) -> list[HarvestedItem]:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=settings.external_api_timeout_seconds) as client:
        response = await client.get(
            "https://www.googleapis.com/drive/v3/files",
            headers=headers,
            params={
                "pageSize": 100,
                "fields": "files(id,name,createdTime,description)",
                "orderBy": "createdTime desc",
                "q": "trashed = false",
            },
        )
        response.raise_for_status()
        items: list[HarvestedItem] = []
        for file_item in response.json().get("files", []):
            items.append(HarvestedItem(
                source_type="google_drive",
                external_id=file_item.get("id", ""),
                title=file_item.get("name", ""),
                snippet=file_item.get("description", "") or "",
                occurred_on=(file_item.get("createdTime") or "")[:10] or None,
                raw=file_item,
            ))
        return items


def fixture_harvest() -> list[HarvestedItem]:
    """The signature reconstruction demo fixture (PROJECT_V2.md USP 1): a
    Calendar invited talk, a Gmail thank-you note, and a Drive certificate
    that all describe the same event and should correlate into one candidate,
    plus a couple of independent single-source signals.
    """

    return [
        HarvestedItem(
            source_type="google_calendar",
            external_id="fixture-cal-1",
            title="IEEE Invited Talk",
            snippet="Invited talk at IEEE Mumbai Section",
            occurred_on="2025-10-14",
            raw={"organizer": "IEEE Mumbai"},
        ),
        HarvestedItem(
            source_type="gmail",
            external_id="fixture-mail-1",
            title="Thank you for delivering the lecture",
            snippet="Thank you for delivering the IEEE Mumbai invited lecture on 14 Oct.",
            occurred_on="2025-10-15",
            raw={"from": "events@ieeemumbai.org"},
        ),
        HarvestedItem(
            source_type="google_drive",
            external_id="fixture-drive-1",
            title="IEEE Mumbai certificate.pdf",
            snippet="Certificate of appreciation, IEEE Mumbai Section, invited talk",
            occurred_on="2025-10-16",
            raw={"mimeType": "application/pdf"},
        ),
        HarvestedItem(
            source_type="gmail",
            external_id="fixture-mail-2",
            title="Thank you for reviewing our submission",
            snippet="Thank you for reviewing manuscript #4471 for Springer.",
            occurred_on="2025-11-02",
            raw={"from": "no-reply@springer.com"},
        ),
        HarvestedItem(
            source_type="google_calendar",
            external_id="fixture-cal-2",
            title="FDP on Generative AI - Day 3",
            snippet="Faculty Development Programme on Generative AI, Day 3 of 5",
            occurred_on="2025-12-05",
            raw={"organizer": "Institution CSE Dept"},
        ),
        HarvestedItem(
            source_type="google_drive",
            external_id="fixture-drive-2",
            title="Weekend trip photos",
            snippet="Personal photo album",
            occurred_on="2025-09-01",
            raw={"mimeType": "image/jpeg"},
        ),
    ]
