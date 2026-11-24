"""Tests for the ASGI entry point."""

import pytest
import uvicorn

from warmly import main as main_module


def test_app_is_importable_by_an_asgi_server() -> None:
    """``warmly.main:app`` is the documented entry point."""
    assert main_module.app.title == "Warmly API"


def test_main_serves_on_loopback_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """Local development must not listen on external interfaces."""
    calls: list[tuple[str, str, int]] = []

    def fake_run(target: str, *, host: str, port: int) -> None:
        calls.append((target, host, port))

    monkeypatch.setattr(uvicorn, "run", fake_run)

    main_module.main()

    assert calls == [("warmly.main:app", "127.0.0.1", 8000)]
