"""Opt-in live checks; all tests skip without explicit real test settings."""

from __future__ import annotations

import os
import shlex
import subprocess
import sys
from typing import Any

import pytest

from .conftest import REPO_ROOT


def _seed_command() -> list[str]:
    configured = os.getenv("QA_SEED_COMMAND")
    if configured:
        return shlex.split(configured)

    candidates = (
        REPO_ROOT / "backend" / "scripts" / "seed.py",
        REPO_ROOT / "scripts" / "seed.py",
        REPO_ROOT / "backend" / "seed.py",
        REPO_ROOT / "seed.py",
    )
    for candidate in candidates:
        if candidate.is_file():
            return [sys.executable, str(candidate)]
    pytest.skip("no seed command found; provide QA_SEED_COMMAND for live seed testing")


def _run_seed(command: list[str]) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    return subprocess.run(
        command,
        cwd=REPO_ROOT,
        env=env,
        check=True,
        text=True,
        capture_output=True,
    )


def _connect_database() -> Any:
    dsn = os.environ["DATABASE_URL"]
    normalized_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://").replace(
        "postgresql+psycopg://", "postgresql://"
    )
    try:
        import psycopg  # type: ignore

        return psycopg.connect(normalized_dsn)
    except ImportError:
        try:
            import psycopg2  # type: ignore

            return psycopg2.connect(normalized_dsn)
        except ImportError:
            pytest.skip("live seed test requires psycopg or psycopg2")


def _seed_counts() -> tuple[int, int, int]:
    connection = _connect_database()
    try:
        with connection.cursor() as cursor:
            counts = []
            for table in ("institutions", "profiles", "appraisal_cycles"):
                cursor.execute(f"SELECT count(*) FROM {table}")
                counts.append(int(cursor.fetchone()[0]))
            return tuple(counts)  # type: ignore[return-value]
    finally:
        connection.close()


def test_seed_is_idempotent_on_an_explicit_test_database(require_live_environment: None) -> None:
    """Running the real seed twice must not duplicate canonical rows.

    This test is deliberately opt-in because ``DATABASE_URL`` can point at a
    shared environment.  It never creates fake records and refuses to run
    unless the operator explicitly opts into seed mutation testing.
    """

    if os.getenv("QA_ALLOW_SEED_TEST") != "1":
        pytest.skip("set QA_ALLOW_SEED_TEST=1 only for an isolated seed test database")

    command = _seed_command()
    _run_seed(command)
    first_counts = _seed_counts()
    _run_seed(command)
    second_counts = _seed_counts()

    assert second_counts == first_counts, (
        "seed changed row counts on its second run: "
        f"first={first_counts}, second={second_counts}"
    )
