"""Settings refuse unsafe configurations (PRD §8)."""

import pytest

from warmly.config import DEV_DATABASE_URL, Settings, SettingsError, load_settings

PROD_URL = "postgresql://warmly_api@db.internal.example:5432/warmly?sslmode=require"


def test_development_needs_no_configuration() -> None:
    """With nothing set, the API targets the local development database."""
    assert load_settings({}) == Settings(
        environment="development", database_url=DEV_DATABASE_URL
    )


def test_explicit_values_are_used() -> None:
    """Environment variables override the defaults."""
    settings = load_settings({"WARMLY_ENV": "test", "WARMLY_DATABASE_URL": PROD_URL})

    assert settings == Settings(environment="test", database_url=PROD_URL)


def test_reads_the_process_environment_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Called without arguments it reads os.environ."""
    monkeypatch.setenv("WARMLY_ENV", "test")
    monkeypatch.delenv("WARMLY_DATABASE_URL", raising=False)

    assert load_settings().environment == "test"


def test_unknown_environment_is_rejected() -> None:
    """A typo must not silently become development."""
    with pytest.raises(SettingsError, match="must be one of"):
        load_settings({"WARMLY_ENV": "staging"})


def test_production_requires_a_database_url() -> None:
    """Production never falls back to a default."""
    with pytest.raises(SettingsError, match="required in production"):
        load_settings({"WARMLY_ENV": "production"})


@pytest.mark.parametrize(
    "url",
    [
        DEV_DATABASE_URL,
        "postgresql://warmly_api@localhost:5432/warmly",
        "postgresql://warmly_api@[::1]:5432/warmly",
        "postgresql:///warmly",
        "postgresql://warmly_api@127.0.0.2:5432/warmly",
        "postgresql://warmly_api@0.0.0.0:5432/warmly",
        "postgresql://warmly_api@db.internal.example/warmly?host=/var/run/postgresql",
    ],
)
def test_production_refuses_a_local_database(url: str) -> None:
    """Pointing production at this machine is always a mistake."""
    with pytest.raises(SettingsError, match="local database"):
        load_settings({"WARMLY_ENV": "production", "WARMLY_DATABASE_URL": url})


@pytest.mark.parametrize(
    "query",
    ["", "?sslmode=prefer", "?sslmode=disable", "?sslmode=allow", "?sslmode="],
    ids=["missing", "prefer", "disable", "allow", "empty"],
)
def test_production_requires_an_encrypted_connection(query: str) -> None:
    """Ciphertext and owner IDs must not cross the network in plain text."""
    url = f"postgresql://warmly_api@db.internal.example:5432/warmly{query}"

    with pytest.raises(SettingsError, match="sslmode"):
        load_settings({"WARMLY_ENV": "production", "WARMLY_DATABASE_URL": url})


@pytest.mark.parametrize("mode", ["require", "verify-ca", "verify-full"])
def test_production_accepts_every_encrypting_sslmode(mode: str) -> None:
    """Any mode that guarantees encryption is allowed."""
    url = f"postgresql://warmly_api@db.internal.example/warmly?sslmode={mode}"

    settings = load_settings({"WARMLY_ENV": "production", "WARMLY_DATABASE_URL": url})

    assert settings.database_url == url


def test_a_repeated_sslmode_is_refused_rather_than_guessed() -> None:
    """Two values are ambiguous, so neither is trusted."""
    url = (
        "postgresql://warmly_api@db.internal.example/warmly"
        "?sslmode=require&sslmode=disable"
    )

    with pytest.raises(SettingsError, match="sslmode"):
        load_settings({"WARMLY_ENV": "production", "WARMLY_DATABASE_URL": url})


def test_settings_repr_never_shows_the_database_url() -> None:
    """Settings may be printed in a traceback; the URL can hold a password."""
    settings = load_settings({"WARMLY_DATABASE_URL": PROD_URL})

    assert "db.internal.example" not in repr(settings)
    assert repr(settings) == "Settings(environment='development')"


def test_production_accepts_a_remote_database() -> None:
    """A real host passes validation."""
    settings = load_settings(
        {"WARMLY_ENV": "production", "WARMLY_DATABASE_URL": PROD_URL}
    )

    assert settings == Settings(environment="production", database_url=PROD_URL)


def test_settings_error_messages_never_include_the_url() -> None:
    """A connection URL can hold a password, so errors must not echo it."""
    marker = "CANARYCREDENTIAL"
    url = "postgresql://user:" + marker + "@localhost/warmly"

    with pytest.raises(SettingsError) as excinfo:
        load_settings({"WARMLY_ENV": "production", "WARMLY_DATABASE_URL": url})

    assert marker not in str(excinfo.value)
