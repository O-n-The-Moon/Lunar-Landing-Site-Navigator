import numpy as np
import pytest

from lunarnav import demo


def test_window_pcts_counts_on_share_of_each_window():
    # 1 sample per "day", 2-sample windows: [1,1] [1,0] [0,0] [0,1]
    on = np.array([1, 1, 0, 0, 1], dtype=bool)
    got = demo.window_pcts(on, samples_per_day=1, window_samples=2, n_days=4)
    assert got.tolist() == [100.0, 50.0, 0.0, 50.0]


def test_window_pcts_rejects_windows_past_the_data():
    on = np.ones(5, dtype=bool)
    with pytest.raises(ValueError):
        demo.window_pcts(on, samples_per_day=1, window_samples=2, n_days=5)


def test_site_losses_rank_by_drop_and_stay_within_max_slip():
    both = {"a": np.array([90.0, 80.0, 10.0, 0.0]), "b": np.array([50.0] * 4)}
    got = demo.site_losses(both, max_slip_days=2, first_day=0, last_base_day=1)
    best = got[0]
    # Day 0 -> day 2 is 80 points; day 0 -> day 3 would be 90 but exceeds max slip.
    assert (best.site_id, best.base_day, best.slip_days) == ("a", 0, 2)
    assert best.drop_pct == pytest.approx(80.0)
    assert all(g.drop_pct <= best.drop_pct for g in got)


def test_rank_flips_finds_pair_whose_order_reverses_after_slip():
    both = {
        "a": np.array([80.0, 60.0, 10.0]),
        "b": np.array([40.0, 40.0, 50.0]),
    }
    flips = demo.rank_flips(both, max_slip_days=2, first_day=0, last_base_day=0)
    assert len(flips) == 1
    f = flips[0]
    assert (f.winner_id, f.loser_id, f.base_day, f.slip_days) == ("a", "b", 0, 2)
    # Gap goes from +40 (a ahead) to -40 (b ahead): a swing of 80.
    assert f.base_gap_pct == pytest.approx(40.0)
    assert f.slip_gap_pct == pytest.approx(-40.0)
    assert f.swing_pct == pytest.approx(80.0)


def test_rank_flips_ignores_pairs_that_never_reverse():
    both = {"a": np.array([80.0, 70.0, 60.0]), "b": np.array([10.0, 10.0, 10.0])}
    assert demo.rank_flips(both, 2, 0, 0) == []


def test_rank_flips_keeps_only_the_best_scenario_per_pair():
    both = {
        "a": np.array([80.0, 80.0, 0.0, 0.0]),
        "b": np.array([40.0, 40.0, 40.0, 40.0]),
    }
    flips = demo.rank_flips(both, max_slip_days=3, first_day=0, last_base_day=1)
    assert len(flips) == 1
    assert flips[0].swing_pct == pytest.approx(80.0)


def test_pair_order_is_unambiguous_when_the_loser_is_ahead_at_baseline():
    both = {"a": np.array([10.0, 60.0]), "b": np.array([50.0, 20.0])}
    f = demo.rank_flips(both, 1, 0, 0)[0]
    assert (f.winner_id, f.loser_id) == ("b", "a")


def test_replace_section_swaps_only_between_markers():
    doc = f"# Demo\n\nintro\n\n{demo.START}\nold\n{demo.END}\n\n## Checklist\n- x\n"
    out = demo.replace_section(doc, "new body")
    assert "old" not in out
    assert f"{demo.START}\nnew body\n{demo.END}" in out
    assert out.startswith("# Demo\n\nintro") and out.endswith("## Checklist\n- x\n")


def test_replace_section_creates_markers_when_missing():
    out = demo.replace_section("# Demo\n", "body")
    assert out.startswith("# Demo\n")
    assert f"{demo.START}\nbody\n{demo.END}" in out


def test_site_losses_respect_first_day_offset():
    both = {"a": np.array([100.0, 0.0, 90.0, 40.0, 0.0])}
    best = demo.site_losses(both, max_slip_days=2, first_day=2, last_base_day=2)[0]
    # Day 0 is excluded: the best drop starting at day 2 is 90 -> 0 (slip 2).
    assert (best.base_day, best.slip_days) == (2, 2)
    assert best.drop_pct == pytest.approx(90.0)


def test_site_losses_skip_sites_that_never_drop():
    both = {"dead": np.zeros(4), "rising": np.array([0.0, 10.0, 20.0, 30.0])}
    assert demo.site_losses(both, 2, 0, 1) == []


def test_rank_flips_clip_last_base_day_to_the_data():
    both = {"a": np.array([80.0, 0.0]), "b": np.array([40.0, 40.0])}
    flips = demo.rank_flips(both, max_slip_days=5, first_day=0, last_base_day=99)
    assert [(f.base_day, f.slip_days) for f in flips] == [(0, 1)]


def test_rank_flips_apply_first_day_offset_and_min_winner_pct():
    both = {
        "a": np.array([30.0, 30.0, 80.0, 0.0]),
        "b": np.array([10.0, 10.0, 40.0, 40.0]),
    }
    got = demo.rank_flips(both, 2, first_day=1, last_base_day=2, min_winner_pct=50.0)
    assert [(f.base_day, f.slip_days) for f in got] == [(2, 1)]
    assert demo.rank_flips(both, 2, 1, 2, min_winner_pct=90.0) == []


def test_replace_section_refuses_a_block_with_a_missing_end_marker():
    with pytest.raises(ValueError):
        demo.replace_section(f"# Demo\n{demo.START}\nhalf edited\n", "body")


def _flip(winner: str, loser: str, swing: float) -> demo.RankFlip:
    return demo.RankFlip(winner, loser, 0, 1, swing / 2, -swing / 2, swing)


def test_diversify_picks_flips_that_share_no_site():
    flips = [_flip("a", "z", 100), _flip("b", "z", 99), _flip("c", "y", 90)]
    got = demo.diversify(flips, 2)
    assert [(f.winner_id, f.loser_id) for f in got] == [("a", "z"), ("c", "y")]


def test_diversify_fills_with_next_best_when_too_few_disjoint_flips():
    flips = [_flip("a", "z", 100), _flip("b", "z", 99), _flip("c", "z", 98)]
    got = demo.diversify(flips, 3)
    assert [f.winner_id for f in got] == ["a", "b", "c"]
