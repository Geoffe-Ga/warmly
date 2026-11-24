"""Typed settings read from the environment.

Development has safe local defaults so the API starts with no configuration.
Production has none: a missing value, or a development default, stops the
process at startup instead of running with the wrong database (PRD §8).
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from ipaddress import ip_address
from typing import Literal
from urllib.parse import parse_qs, urlsplit

Environment = Literal["development", "test", "production"]

ENVIRONMENTS: tuple[Environment, ...] = ("development", "test", "production")

# The database started by docker-compose.dev.yml. It accepts local connections
# without a password, so no credential appears in the code or the repository.
DEV_DATABASE_URL = "postgresql://warmly_admin@127.0.0.1:5432/warmly_dev"

# Names that can only mean "this machine", which production must never use.
_LOCAL_NAMES = frozenset({"localhost", ""})

ENV_VAR = "WARMLY_ENV"
DATABASE_URL_VAR = "WARMLY_DATABASE_URL"

_UNKNOWN_ENVIRONMENT = "WARMLY_ENV must be one of: development, test, production"
_MISSING_DATABASE_URL = "WARMLY_DATABASE_URL is required in production"
_LOCAL_DATABASE_IN_PRODUCTION = (
    "WARMLY_DATABASE_URL must not point at a local database in production"
)


class SettingsError(ValueError):
    """Raised when the environment does not describe a safe configuration."""


@dataclass(frozen=True)
class Settings:
    """Runtime configuration for the API."""

    environment: Environment
    database_url: str


def _environment(env: Mapping[str, str]) -> Environment:
    """Read and validate the environment name."""
    name = env.get(ENV_VAR, "development")
    for environment in ENVIRONMENTS:
        if name == environment:
            return environment
    raise SettingsError(_UNKNOWN_ENVIRONMENT)


def _is_local(database_url: str) -> bool:
    """Report whether a connection URL targets this machine.

    A guard-rail against misconfiguration, not a security boundary. It covers
    a missing host, ``localhost``, any loopback or unspecified IP address, and
    a ``host`` query parameter, which libpq lets override the URL's host.
    """
    parts = urlsplit(database_url)
    if "host" in parse_qs(parts.query):
        return True
    host = parts.hostname or ""
    if host in _LOCAL_NAMES:
        return True
    try:
        address = ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_unspecified


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Build settings from environment variables.

    Args:
        env: Variables to read; defaults to the process environment.

    Returns:
        Validated settings.

    Raises:
        SettingsError: If the environment name is unknown, or production is
            missing a database URL or points at a local database.
    """
    source = os.environ if env is None else env
    environment = _environment(source)
    database_url = source.get(DATABASE_URL_VAR, "")
    if environment == "production":
        if not database_url:
            raise SettingsError(_MISSING_DATABASE_URL)
        if _is_local(database_url):
            raise SettingsError(_LOCAL_DATABASE_IN_PRODUCTION)
    return Settings(
        environment=environment, database_url=database_url or DEV_DATABASE_URL
    )
