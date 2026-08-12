"""Async SQLAlchemy access to the Supabase PostgreSQL database."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .config import Settings, get_settings


class Database:
    def __init__(self) -> None:
        self.engine: AsyncEngine | None = None
        self.session_factory: async_sessionmaker[AsyncSession] | None = None

    def configure(self, settings: Settings) -> None:
        if self.engine is not None or not settings.database_url:
            return
        database_url = settings.database_url
        if database_url.startswith("postgres://"):
            database_url = "postgresql+asyncpg://" + database_url.removeprefix("postgres://")
        elif database_url.startswith("postgresql://"):
            database_url = "postgresql+asyncpg://" + database_url.removeprefix("postgresql://")
        self.engine = create_async_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=settings.database_pool_max_size,
            max_overflow=max(0, settings.database_pool_max_size - settings.database_pool_min_size),
            pool_timeout=settings.database_command_timeout_seconds,
            # Supabase's transaction pooler (port 6543) can move a transaction
            # between server connections. Disable asyncpg's connection-local
            # prepared-statement cache so the same engine works with either
            # pooler mode.
            connect_args={
                "command_timeout": settings.database_command_timeout_seconds,
                "statement_cache_size": 0,
            },
        )
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)

    async def close(self) -> None:
        if self.engine is not None:
            await self.engine.dispose()
        self.engine = None
        self.session_factory = None

    async def ping(self) -> None:
        if self.engine is None:
            raise RuntimeError("DATABASE_URL is not configured")
        async with self.engine.connect() as connection:
            await connection.execute(text("select 1"))


database = Database()


async def get_db(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> AsyncIterator[AsyncSession]:
    # Every database-backed API route is authenticated. Check for a bearer
    # token before opening/configuring a database connection so an anonymous
    # request consistently receives 401 even when deployment configuration is
    # incomplete or the database is unavailable.
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer access token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    database.configure(settings)
    if database.session_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database configuration is missing",
        )
    async with database.session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def transaction(session: AsyncSession) -> AsyncIterator[AsyncSession]:
    """Commit on success and roll back all writes on failure."""

    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
