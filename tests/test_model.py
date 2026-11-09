from datetime import date

import numpy as np
import pandas as pd

from boatrace_ai.backtest import run_backtest
from boatrace_ai.features import add_history, build_training_table
from boatrace_ai.model import BoatRaceModel, harville_trifecta
from boatrace_ai.parse import load_dir
from boatrace_ai.synth import generate


def test_harville_sums_to_one():
    tri = harville_trifecta({1: 0.5, 2: 0.2, 3: 0.1, 4: 0.1, 5: 0.06, 6: 0.04})
    assert len(tri) == 120
    assert np.isclose(tri["prob"].sum(), 1.0)
    assert tri.iloc[0].combo == "1-2-3"


def test_history_uses_only_past_days():
    results = pd.DataFrame(dict(
        date=pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]),
        reg_no=[1, 1, 1], lane=[1, 1, 1], finish=[1.0, 6.0, 1.0], st=[0.1, 0.2, 0.3],
    ))
    entries = pd.DataFrame(dict(
        date=pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]),
        reg_no=[1, 1, 1], lane=[1, 1, 1],
    ))
    h = add_history(entries, results)
    assert list(h["h_n"]) == [0, 1, 2]           # 当日の成績は含まない
    assert h["h_win_rate"].iloc[2] == 0.5
    assert np.isclose(h["h_avg_st"].iloc[2], 0.15)


def test_end_to_end(tmp_path):
    generate(tmp_path, date(2024, 1, 1), days=30, seed=1, venues_per_day=2)
    programs, results, payouts = load_dir(tmp_path)
    assert len(programs) == 30 * 2 * 12 * 6
    assert len(results) == len(programs) and len(payouts) == 30 * 2 * 12
    table = build_training_table(programs, results)
    train = table[table["date"] < "2024-01-25"]
    test = table[table["date"] >= "2024-01-25"]
    model = BoatRaceModel(dict(n_estimators=50)).fit(train)
    p = model.predict_win(test)
    assert np.allclose(p.groupby([test["date"], test["venue"], test["race_no"]]).sum(), 1.0)
    report = run_backtest(model, test, payouts, train)
    assert report.n_races == 6 * 2 * 12
    assert report.logloss < report.lane_baseline_logloss + 0.2


def test_race_cat():
    from boatrace_ai.features import race_cat

    assert race_cat("準優勝戦") == 4 and race_cat("優勝戦") == 5
    assert race_cat("予選特選") == 3 and race_cat("ドリーム戦") == 3
    assert race_cat("予選") == 2 and race_cat("一般戦") == 1 and race_cat("朝1戦") == 0
