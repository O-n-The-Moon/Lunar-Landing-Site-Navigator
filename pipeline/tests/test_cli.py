import pytest

from lunarnav import cli


def test_demo_dispatches_to_implementation(monkeypatch):
    calls = []
    monkeypatch.setattr(cli.demo, "main", lambda: calls.append("demo"))
    cli.main(["demo"])
    assert calls == ["demo"]


def test_horizons_requires_a_target():
    with pytest.raises(SystemExit):
        cli.main(["horizons"])


def test_unknown_command_is_rejected():
    with pytest.raises(SystemExit):
        cli.main(["nope"])


def test_fetch_dispatches_to_implementation(monkeypatch):
    calls = []
    monkeypatch.setattr(cli.fetch, "main", lambda: calls.append("fetch"))
    cli.main(["fetch"])
    assert calls == ["fetch"]


def test_horizons_grid_dispatches_to_implementation(monkeypatch):
    calls = []
    monkeypatch.setattr(cli.horizons_grid, "main", lambda: calls.append("grid"))
    cli.main(["horizons", "--grid"])
    assert calls == ["grid"]


def test_golden_dispatches_to_implementation(monkeypatch):
    calls = []
    monkeypatch.setattr(cli.golden, "main", lambda: calls.append("golden"))
    cli.main(["golden"])
    assert calls == ["golden"]
