import json

import numpy as np

from lunarnav import io


def test_write_json_creates_parent_dirs(tmp_path):
    path = tmp_path / "a" / "b.json"
    io.write_json(path, {"schemaVersion": 1})
    assert json.loads(path.read_text()) == {"schemaVersion": 1}


def test_write_f32_is_little_endian(tmp_path):
    path = tmp_path / "x.bin"
    io.write_f32(path, np.array([1.5, -2.0]))
    assert np.frombuffer(path.read_bytes(), dtype="<f4").tolist() == [1.5, -2.0]


def test_write_u8_round_trip(tmp_path):
    path = tmp_path / "x.bin"
    io.write_u8(path, [0, 10, 255])
    assert path.read_bytes() == bytes([0, 10, 255])


def test_write_i16_is_little_endian(tmp_path):
    path = tmp_path / "x.bin"
    io.write_i16(path, [-1, 300])
    assert np.frombuffer(path.read_bytes(), dtype="<i2").tolist() == [-1, 300]


def test_contract_paths_live_under_web_public_data():
    assert io.EPHEMERIS_BIN.parent == io.DATA_DIR
    assert io.DATA_DIR.parts[-3:] == ("web", "public", "data")
    assert io.GOLDEN_JSON.parent.parts[-2:] == ("shared", "fixtures")
