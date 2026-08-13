"""Private Supabase Storage operations used by evidence and PDF endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from .config import Settings


class StorageError(RuntimeError):
    """Raised when Supabase Storage rejects an operation."""


@dataclass
class StorageClient:
    settings: Settings

    @property
    def base_url(self) -> str:
        if not self.settings.supabase_base_url:
            raise StorageError("SUPABASE_URL is not configured")
        return self.settings.supabase_base_url

    @property
    def headers(self) -> dict[str, str]:
        key = self.settings.supabase_service_role_key
        if key is None:
            raise StorageError("SUPABASE_SERVICE_ROLE_KEY is not configured")
        value = key.get_secret_value()
        return {"Authorization": f"Bearer {value}", "apikey": value}

    def _url(self, path: str) -> str:
        return f"{self.base_url}/storage/v1/{path.lstrip('/')}"

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = dict(self.headers)
        headers.update(kwargs.pop("headers", {}))
        try:
            async with httpx.AsyncClient(timeout=self.settings.external_api_timeout_seconds) as client:
                response = await client.request(method, self._url(path), headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise StorageError(f"Supabase Storage request failed: {exc}") from exc
        if response.is_error:
            detail = response.text[:500] or response.reason_phrase
            raise StorageError(f"Supabase Storage rejected request ({response.status_code}): {detail}")
        return response

    async def check_bucket(self, bucket: str) -> None:
        await self._request("GET", f"bucket/{quote(bucket, safe='')}")

    async def create_signed_upload_url(self, bucket: str, path: str) -> dict[str, Any]:
        response = await self._request(
            "POST",
            f"object/upload/sign/{quote(bucket, safe='')}/{quote(path, safe='/')}" ,
            json={},
            headers={"x-upsert": "false"},
        )
        payload = response.json()
        raw_url = payload.get("url") or payload.get("signedURL") or payload.get("signedUrl")
        if not raw_url:
            raise StorageError("Supabase Storage did not return an upload URL")
        if str(raw_url).startswith("/"):
            raw_url = f"{self.base_url}/storage/v1{raw_url}"
        payload["url"] = raw_url
        return payload

    async def object_info(self, bucket: str, path: str) -> dict[str, Any]:
        response = await self._request(
            "GET",
            f"object/info/{quote(bucket, safe='')}/{quote(path, safe='/')}",
        )
        return response.json()

    async def create_signed_download_url(self, bucket: str, path: str, expires_in: int) -> str:
        response = await self._request(
            "POST",
            f"object/sign/{quote(bucket, safe='')}/{quote(path, safe='/')}",
            json={"expiresIn": expires_in},
        )
        payload = response.json()
        signed = payload.get("signedURL") or payload.get("signedUrl")
        if not signed and isinstance(payload.get("data"), dict):
            signed = payload["data"].get("signedURL") or payload["data"].get("signedUrl")
        if not signed:
            raise StorageError("Supabase Storage did not return a download URL")
        if str(signed).startswith("/"):
            signed = f"{self.base_url}/storage/v1{signed}"
        return str(signed)

    async def upload_bytes(
        self,
        bucket: str,
        path: str,
        content: bytes,
        *,
        content_type: str = "application/octet-stream",
    ) -> dict[str, Any]:
        response = await self._request(
            "POST",
            f"object/{quote(bucket, safe='')}/{quote(path, safe='/')}",
            content=content,
            headers={
                "Content-Type": content_type,
                "x-upsert": "true",
                "cache-control": "private, max-age=0",
            },
        )
        return response.json() if response.content else {"ok": True}

    async def download_object(self, bucket: str, path: str) -> bytes:
        response = await self._request(
            "GET",
            f"object/{quote(bucket, safe='')}/{quote(path, safe='/')}",
        )
        return response.content

    async def delete_object(self, bucket: str, path: str) -> None:
        await self._request(
            "DELETE",
            f"object/{quote(bucket, safe='')}/{quote(path, safe='/')}",
        )
