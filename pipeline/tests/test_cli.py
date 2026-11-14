import pytest

from lunarnav import cli

COMMANDS = [
    ["fetch"],
    ["ephemeris"],
    ["horizons", "--sites"],
    ["horizons", "--grid"],
    ["pgda"],
    ["golden"],
    ["demo"],
    ["build-all"],
]


@pytest.mark.parametrize("argv", COMMANDS)
def test_stub_commands_raise_not_implemented(argv):
    with pytest.raises(NotImplementedError):
        cli.main(argv)


def test_horizons_requires_a_target():
    with pytest.raises(SystemExit):
        cli.main(["horizons"])


def test_unknown_command_is_rejected():
    with pytest.raises(SystemExit):
        cli.main(["nope"])
