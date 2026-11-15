from lunarnav import validate, validate_horizons


def _unimplemented() -> dict:
    raise NotImplementedError


def test_unimplemented_sections_are_null(monkeypatch):
    # The real Horizons validator needs the network, so stand in for it.
    monkeypatch.setattr(validate_horizons, "run", _unimplemented)
    assert validate.build() == {"schemaVersion": 1, "horizons": None, "pgda": None}


def test_implemented_section_is_merged(monkeypatch):
    monkeypatch.setattr(validate_horizons, "run", lambda: {"maxErrDeg": 0.01})
    result = validate.build()
    assert result["horizons"] == {"maxErrDeg": 0.01}
    assert result["pgda"] is None
