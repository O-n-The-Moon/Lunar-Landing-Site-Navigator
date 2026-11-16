from lunarnav import validate, validate_horizons, validate_pgda


def _unimplemented() -> dict:
    raise NotImplementedError


def test_unimplemented_sections_are_null(monkeypatch):
    # The real validators need the network or raw data, so stand in for them.
    monkeypatch.setattr(validate_horizons, "run", _unimplemented)
    monkeypatch.setattr(validate_pgda, "run", _unimplemented)
    assert validate.build() == {"schemaVersion": 1, "horizons": None, "pgda": None}


def test_implemented_section_is_merged(monkeypatch):
    monkeypatch.setattr(validate_horizons, "run", lambda: {"maxErrDeg": 0.01})
    monkeypatch.setattr(validate_pgda, "run", _unimplemented)
    result = validate.build()
    assert result["horizons"] == {"maxErrDeg": 0.01}
    assert result["pgda"] is None
