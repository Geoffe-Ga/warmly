"""Tests for the ASGI entry point."""

import pytest
import uvicorn

from warmly import main as main_module


def test_app_is_importable_by_an_asgi_server() -> None:
    """``warmly.main:app`` is the documented entry point."""
    assert main_module.app.title == "Warmly API"


def test_main_serves_on_loopback_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """Local development must not listen on external interfaces."""
    calls: list[tuple[str, str, int, bool]] = []

    def fake_run(target: str, *, host: str, port: int, access_log: bool) -> None:
        """Record how the server would have been started."""
        calls.append((target, host, port, access_log))

    configured: list[bool] = []
    monkeypatch.setattr(uvicorn, "run", fake_run)
    monkeypatch.setattr(
        main_module, "configure_logging", lambda: configured.append(True)
    )

    main_module.main()

    # The access log is off: it would record concrete paths and query strings.
    assert calls == [("warmly.main:app", "127.0.0.1", 8000, False)]
    assert configured == [True]
