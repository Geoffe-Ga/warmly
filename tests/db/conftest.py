"""Fixtures for tests that need a real PostgreSQL.

Set ``WARMLY_TEST_DATABASE_URL`` to an administrative connection (one that may
create databases and roles). ``docker-compose.dev.yml`` provides one locally
and CI runs a service container. Each test session gets its own throwaway
database, so runs never share state and can run in parallel.

There is deliberately no skip when the variable is missing: an integration
test that silently does not run proves nothing.
"""

import os
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.rows import TupleRow

from warmly.db.migrate import apply_migrations, discover

ADMIN_URL_VAR = "WARMLY_TEST_DATABASE_URL"
# Roles Supabase gives to browser clients. Created here so the tests can prove
# the baseline migration denies them.
BROWSER_ROLES = ("anon", "authenticated")

_MISSING_URL = (
    f"{ADMIN_URL_VAR} is not set. Start a database with "
    "'docker compose -f docker-compose.dev.yml up -d' and export "
    f"{ADMIN_URL_VAR}=postgresql://warmly_admin@127.0.0.1:5432/postgres"
)


def _with_database(url: str, name: str) -> str:
    """Return ``url`` pointing at the database called ``name``."""
    parts = urlsplit(url)
    return urlunsplit(parts._replace(path=f"/{name}"))


def _ensure_browser_roles(conn: psycopg.Connection[TupleRow]) -> None:
    """Create the browser roles if this cluster does not have them."""
    for role in BROWSER_ROLES:
        try:
            conn.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(role)))
        except psycopg.errors.DuplicateObject:
            continue


@pytest.fixture(scope="session")
def admin_url() -> str:
    """Return the administrative connection URL, or fail with instructions."""
    url = os.environ.get(ADMIN_URL_VAR)
    if not url:
        pytest.fail(_MISSING_URL)
    return url


@contextmanager
def throwaway_database(admin_url: str) -> Iterator[str]:
    """Create an empty database, yield its URL, and drop it afterwards."""
    name = f"warmly_t_{uuid4().hex[:12]}"
    with psycopg.connect(admin_url, autocommit=True) as conn:
        _ensure_browser_roles(conn)
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        yield _with_database(admin_url, name)
    finally:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                    sql.Identifier(name)
                )
            )


@pytest.fixture(scope="session")
def empty_database_url(admin_url: str) -> Iterator[str]:
    """Create a throwaway database with no migrations applied."""
    with throwaway_database(admin_url) as url:
        yield url


@pytest.fixture(scope="session")
def login_database_url(admin_url: str, database_url: str) -> Iterator[str]:
    """Connect to the migrated database the way production must.

    The login role is not a superuser, owns nothing and cannot bypass
    row-level security. Its only privilege is membership of ``warmly_api``,
    which is what lets ``SET LOCAL ROLE warmly_api`` succeed. It is created
    ``NOINHERIT``, so it has none of that role's privileges until it switches
    to it: on its own it cannot even read the schema.
    """
    role = f"warmly_login_{uuid4().hex[:12]}"
    # A random credential for a role that exists for one test session.
    credential = uuid4().hex
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(
            sql.SQL(
                "CREATE ROLE {} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS "
                "NOCREATEDB NOCREATEROLE PASSWORD {}"
            ).format(sql.Identifier(role), sql.Literal(credential))
        )
        conn.execute(sql.SQL("GRANT warmly_api TO {}").format(sql.Identifier(role)))
    parts = urlsplit(database_url)
    host = parts.hostname or "127.0.0.1"
    port = f":{parts.port}" if parts.port else ""
    try:
        yield urlunsplit(parts._replace(netloc=f"{role}:{credential}@{host}{port}"))
    finally:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))


@pytest.fixture(scope="session")
def database_url(empty_database_url: str) -> str:
    """Return a throwaway database with every migration applied."""
    with psycopg.connect(empty_database_url) as conn:
        apply_migrations(conn, discover())
    return empty_database_url
