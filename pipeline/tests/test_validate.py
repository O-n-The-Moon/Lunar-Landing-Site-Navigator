from lunarnav import validate, validate_horizons


def test_unimplemented_sections_are_null():
    assert validate.build() == {"schemaVersion": 1, "horizons": None, "pgda": None}


def test_implemented_section_is_merged(monkeypatch):
    monkeypatch.setattr(validate_horizons, "run", lambda: {"maxErrDeg": 0.01})
    result = validate.build()
    assert result["horizons"] == {"maxErrDeg": 0.01}
    assert result["pgda"] is None
