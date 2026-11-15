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


def _site(site_id: str, lat_deg: float, lon_deg: float) -> dict:
    return {"id": site_id, "latDeg": lat_deg, "lonDeg": lon_deg}


def test_site_clusters_chain_sites_within_the_distance_and_label_by_smallest_id():
    # ~1.7 km per 0.056 deg of latitude: a, b, c chain at ~10 km steps; d is far away.
    sites = [
        _site("c", -89.0 + 0.115, 0.0),
        _site("a", -89.0, 0.0),
        _site("b", -89.0 + 0.0575, 0.0),
        _site("d", -85.0, 90.0),
    ]
    got = demo.site_clusters(sites, max_km=5.0)
    assert got == {"a": "a", "b": "a", "c": "a", "d": "d"}


def test_site_clusters_keep_distant_sites_apart():
    sites = [_site("a", -89.0, 0.0), _site("b", -89.0 + 0.5, 0.0)]  # ~15 km apart
    assert demo.site_clusters(sites, max_km=5.0) == {"a": "a", "b": "b"}


def test_diversify_treats_sites_in_one_cluster_as_the_same_place():
    flips = [_flip("a", "z", 100), _flip("b", "y", 99), _flip("c", "x", 90)]
    near = {"a": "a", "b": "a"}  # a and b are the same place
    got = demo.diversify(flips, 2, near)
    assert [(f.winner_id, f.loser_id) for f in got] == [("a", "z"), ("c", "x")]


def test_diversify_skips_flips_between_two_sites_of_one_cluster():
    flips = [_flip("a", "b", 100), _flip("c", "d", 90)]
    got = demo.diversify(flips, 1, {"a": "a", "b": "a"})
    assert (got[0].winner_id, got[0].loser_id) == ("c", "d")


def test_rank_flips_require_a_real_margin_before_and_after_the_slip():
    # Day 0 is a near-tie (a leads by 1); after the slip b leads by 40.
    both = {"a": np.array([41.0, 0.0]), "b": np.array([40.0, 40.0])}
    assert demo.rank_flips(both, 1, 0, 0, min_gap_pct=5.0) == []
    assert len(demo.rank_flips(both, 1, 0, 0, min_gap_pct=0.5)) == 1


def test_window_pcts_rejects_an_empty_window():
    with pytest.raises(ValueError):
        demo.window_pcts(np.ones(4, dtype=bool), 1, 0, 2)


def test_search_rejects_a_negative_first_day():
    both = {"a": np.array([1.0, 2.0, 3.0]), "b": np.array([3.0, 2.0, 1.0])}
    with pytest.raises(ValueError):
        demo.rank_flips(both, 1, -1, 1)
    with pytest.raises(ValueError):
        demo.site_losses(both, 1, -1, 1)


def _loss(site: str, drop: float) -> demo.SiteLoss:
    return demo.SiteLoss(site, 0, 1, drop, 0.0, drop)


def test_diversify_losses_counts_one_cluster_as_one_place():
    losses = [_loss("a", 100), _loss("b", 99), _loss("c", 90)]
    got = demo.diversify_losses(losses, 2, {"a": "a", "b": "a"})
    assert [r.site_id for r in got] == ["a", "c"]


def test_diversify_prefers_a_fully_distinct_set_over_a_greedy_repeat():
    # Greedy takes (a,b) first, which blocks both (a,c) and (b,d): only 2 flips fit.
    # The best fully distinct triple is (a,c), (b,d), (e,f).
    flips = [
        _flip("a", "b", 100),
        _flip("a", "c", 60),
        _flip("b", "d", 60),
        _flip("e", "f", 50),
    ]
    got = demo.diversify(flips, 3)
    assert {(f.winner_id, f.loser_id) for f in got} == {
        ("a", "c"),
        ("b", "d"),
        ("e", "f"),
    }


def test_diversify_returns_flips_ordered_best_first():
    flips = [_flip("a", "z", 100), _flip("c", "x", 50), _flip("d", "w", 70)]
    got = demo.diversify(flips, 3)
    assert [f.swing_pct for f in got] == [100, 70, 50]


def test_diversify_losses_fills_from_the_next_best_when_places_run_out():
    losses = [_loss("a", 100), _loss("b", 99), _loss("c", 90)]
    got = demo.diversify_losses(losses, 3, {"a": "p", "b": "p", "c": "p"})
    assert [r.site_id for r in got] == ["a", "b", "c"]


def test_rank_flips_min_gap_boundary_is_inclusive():
    both = {"a": np.array([60.0, 40.0]), "b": np.array([50.0, 50.0])}  # +10 -> -10
    assert len(demo.rank_flips(both, 1, 0, 0, min_gap_pct=10.0)) == 1
    assert demo.rank_flips(both, 1, 0, 0, min_gap_pct=10.01) == []


def test_sunset_label_separates_dark_sites_from_no_sunset_events():
    assert demo._sunset({"sunlitPct": 0.0, "firstSunsetH": None}) == "no sunlight"
    assert demo._sunset({"sunlitPct": 40.0, "firstSunsetH": None}) == "no sunset"
    assert demo._sunset({"sunlitPct": 40.0, "firstSunsetH": 12.34}) == "12.3 h"


def test_shared_note_names_the_flips_that_repeat_a_place():
    inputs = _inputs_with_sites(
        [_site("a", -89.0, 0.0), _site("b", -88.0, 90.0), _site("c", -87.0, 180.0)]
    )
    assert demo._shared_note(
        inputs, [_flip("a", "b", 9), _flip("c", "b", 8)]
    ).startswith("; flip 2 shares a place")
    assert demo._shared_note(inputs, [_flip("a", "b", 9)]) == ""


def _inputs_with_sites(sites: list[dict]) -> demo.golden.Inputs:
    return demo.golden.Inputs(None, {"sites": sites}, {})  # type: ignore[arg-type]


@pytest.fixture(scope="module")
def real_scenarios():
    inputs = demo.golden.load_inputs()
    flips, losses = demo.find_scenarios(inputs)
    return inputs, flips, losses


def test_real_data_flips_really_flip_and_meet_the_margins(real_scenarios):
    _, flips, _ = real_scenarios
    assert len(flips) == demo.TOP_N
    for f in flips:
        assert f.base_gap_pct >= demo.MIN_GAP_PCT
        assert f.slip_gap_pct <= -demo.MIN_GAP_PCT
        assert 1 <= f.slip_days <= demo.MAX_SLIP_DAYS


def test_rendered_headline_numbers_match_the_table_rows(real_scenarios):
    import re

    inputs, flips, losses = real_scenarios
    text = demo.render_section(inputs, flips, losses)
    first = text.split("**1. ")[1].split("\n\n")
    swing = float(re.search(r"swing ([\d.]+) points", first[0]).group(1))
    rows = [
        ln for ln in first[1].splitlines() if ln.startswith(("| baseline", "| slip"))
    ]
    both = [float(re.search(r"\*\*([\d.]+)%\*\*", r).group(1)) for r in rows]
    # rows: winner base, loser base, winner slip, loser slip
    assert swing == pytest.approx(
        abs((both[0] - both[1]) - (both[2] - both[3])), abs=0.11
    )


def test_main_regenerates_demo_md_idempotently_and_keeps_other_content(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(demo.io, "REPO_ROOT", tmp_path)
    (tmp_path / "docs").mkdir()
    path = tmp_path / "docs" / "demo.md"
    path.write_text("# Demo\n\nhand written\n", encoding="utf-8")
    demo.main()
    once = path.read_text(encoding="utf-8")
    demo.main()
    assert path.read_text(encoding="utf-8") == once
    assert once.startswith("# Demo\n\nhand written\n")
    assert once.count(demo.START) == 1


def test_diversify_keeps_the_biggest_swing_rather_than_the_biggest_total():
    flips = [
        _flip("a", "b", 100),  # biggest swing, but blocks both 90s below
        _flip("a", "c", 90),
        _flip("b", "d", 90),
        _flip("e", "f", 60),
        _flip("g", "h", 30),
    ]
    got = demo.diversify(flips, 3)
    # (a,c)+(b,d)+(e,f) totals 240 but lacks the 100; (a,b)+(e,f)+(g,h) keeps it.
    assert [f.swing_pct for f in got] == [100, 60, 30]
