"""Settings refuse unsafe configurations (PRD §8)."""

import pytest

from warmly.config import (
    DEFAULT_AUTH_AUDIENCE,
    DEV_AUTH_ISSUER,
    DEV_DATABASE_URL,
    Settings,
    SettingsError,
    load_settings,
)

PROD_URL = "postgresql://warmly_api@db.internal.example:5432/warmly?sslmode=require"
PROD_ISSUER = "https://project.auth.example/auth/v1"
PRODUCTION = {
    "WARMLY_ENV": "production",
    "WARMLY_DATABASE_URL": PROD_URL,
    "WARMLY_AUTH_ISSUER": PROD_ISSUER,
}


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

    settings = load_settings(PRODUCTION | {"WARMLY_DATABASE_URL": url})

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
    assert repr(settings) == (
        "Settings(environment='development', "
        f"auth_issuer='{DEV_AUTH_ISSUER}', auth_audience='authenticated')"
    )


def test_production_accepts_a_remote_database() -> None:
    """A real host passes validation."""
    settings = load_settings(PRODUCTION)

    assert settings == Settings(
        environment="production", database_url=PROD_URL, auth_issuer=PROD_ISSUER
    )


def test_settings_error_messages_never_include_the_url() -> None:
    """A connection URL can hold a password, so errors must not echo it."""
    marker = "CANARYCREDENTIAL"
    url = "postgresql://user:" + marker + "@localhost/warmly"

    with pytest.raises(SettingsError) as excinfo:
        load_settings({"WARMLY_ENV": "production", "WARMLY_DATABASE_URL": url})

    assert marker not in str(excinfo.value)


def test_development_trusts_the_local_auth_stack_by_default() -> None:
    """With nothing set, tokens are checked against the Supabase local stack."""
    settings = load_settings({})

    assert settings.auth_issuer == DEV_AUTH_ISSUER
    assert settings.auth_audience == DEFAULT_AUTH_AUDIENCE == "authenticated"
    assert settings.auth_jwks_url == DEV_AUTH_ISSUER + "/.well-known/jwks.json"


def test_auth_settings_are_read_from_the_environment() -> None:
    """The issuer and audience can both be set; a trailing slash is dropped."""
    settings = load_settings(
        PRODUCTION
        | {"WARMLY_AUTH_ISSUER": PROD_ISSUER + "/", "WARMLY_AUTH_AUDIENCE": "warmly"}
    )

    assert settings.auth_issuer == PROD_ISSUER
    assert settings.auth_audience == "warmly"
    assert settings.auth_jwks_url == PROD_ISSUER + "/.well-known/jwks.json"


def test_an_empty_audience_falls_back_to_the_default() -> None:
    """An empty variable must not produce a verifier that accepts no audience."""
    settings = load_settings(PRODUCTION | {"WARMLY_AUTH_AUDIENCE": ""})

    assert settings.auth_audience == DEFAULT_AUTH_AUDIENCE


def test_production_requires_an_auth_issuer() -> None:
    """Production never trusts the development token issuer by default."""
    env = {key: value for key, value in PRODUCTION.items() if "ISSUER" not in key}

    with pytest.raises(SettingsError, match="WARMLY_AUTH_ISSUER is required"):
        load_settings(env)


@pytest.mark.parametrize(
    "issuer",
    [
        "http://project.auth.example/auth/v1",
        DEV_AUTH_ISSUER,
        "https://localhost/auth/v1",
        "https://127.0.0.1:54321/auth/v1",
        "https://[::1]/auth/v1",
    ],
)
def test_production_refuses_an_insecure_or_local_issuer(issuer: str) -> None:
    """Signing keys fetched over plain HTTP could be replaced in transit."""
    with pytest.raises(SettingsError, match="https URL that is not on this machine"):
        load_settings(PRODUCTION | {"WARMLY_AUTH_ISSUER": issuer})


@pytest.mark.parametrize(
    "issuer",
    [
        "project.auth.example/auth/v1",
        "ftp://project.auth.example/auth/v1",
        "https:///auth/v1",
        "https://project.auth.example/auth/v1?x=1",
        "https://project.auth.example/auth/v1#frag",
    ],
)
@pytest.mark.parametrize("environment", ["development", "production"])
def test_a_malformed_issuer_is_refused_everywhere(
    issuer: str, environment: str
) -> None:
    """A typo must stop the process, not produce a verifier that trusts nothing."""
    with pytest.raises(SettingsError, match="must be an http"):
        load_settings(
            PRODUCTION | {"WARMLY_ENV": environment, "WARMLY_AUTH_ISSUER": issuer}
        )


def test_development_may_use_a_plain_http_issuer_on_this_machine() -> None:
    """The local stack has no TLS."""
    settings = load_settings({"WARMLY_AUTH_ISSUER": "http://localhost:54321/auth/v1"})

    assert settings.auth_issuer == "http://localhost:54321/auth/v1"
