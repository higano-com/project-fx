"""コマンドライン: download / synth / train / predict."""

from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

import pandas as pd


def _date(s: str) -> date:
    return date.fromisoformat(s)


def cmd_download(a):
    from .download import download_range

    files = download_range(a.start, a.end, Path(a.out), sleep=a.sleep)
    print(f"{len(files)} files -> {a.out}")


def cmd_synth(a):
    from .synth import generate

    generate(Path(a.out), a.start, a.days, seed=a.seed)
    print(f"synthetic data ({a.days} days) -> {a.out}")


def cmd_train(a):
    from .backtest import run_backtest
    from .features import build_training_table
    from .model import BoatRaceModel
    from .parse import load_dir

    programs, results, payouts = load_dir(Path(a.data))
    if programs.empty or results.empty:
        raise SystemExit(f"no data in {a.data}")
    table = build_training_table(programs, results)
    dates = sorted(table["date"].unique())
    test_from = pd.Timestamp(a.test_from) if a.test_from else dates[int(len(dates) * 0.8)]
    trainval = table[table["date"] < test_from]
    test = table[table["date"] >= test_from]
    tv_dates = sorted(trainval["date"].unique())
    valid_from = tv_dates[int(len(tv_dates) * 0.85)]
    train, valid = trainval[trainval["date"] < valid_from], trainval[trainval["date"] >= valid_from]
    print(f"races  train={train.groupby(['date','venue','race_no']).ngroups}"
          f"  valid={valid.groupby(['date','venue','race_no']).ngroups}"
          f"  test={test.groupby(['date','venue','race_no']).ngroups}  (test from {test_from.date()})")

    model = BoatRaceModel().fit(train, valid)
    model.save(Path(a.model))
    print(f"model -> {a.model}\n")
    if len(test):
        print(run_backtest(model, test, payouts, train))
    print("\n特徴量重要度 (上位10):")
    print(model.feature_importance().head(10).round(0).to_string())


def cmd_predict(a):
    from .features import build_features
    from .model import BoatRaceModel, race_predictions
    from .parse import date_from_filename, load_dir, parse_program, read_text

    model = BoatRaceModel.load(Path(a.model))
    prog_path = Path(a.program)
    programs = parse_program(read_text(prog_path), date_from_filename(prog_path))
    history = load_dir(Path(a.data))[1] if a.data else None
    df = build_features(programs, history)
    preds = race_predictions(df, model.predict_win(df))
    for (d, venue, race_no), pr in preds.items():
        if a.venue and venue != a.venue:
            continue
        wp = "  ".join(f"{lane}:{p:.0%}" for lane, p in sorted(pr["win_probs"].items()))
        tri = ", ".join(f"{c}({p:.1%})" for c, p in pr["trifecta"].head(a.top).itertuples(index=False))
        print(f"{d.date()} 場{venue:02d} {race_no:2d}R | 1着率 {wp}\n    3連単: {tri}")


def main(argv=None):
    p = argparse.ArgumentParser(prog="boatrace-ai", description="ボートレース着順予測AI")
    sub = p.add_subparsers(required=True)

    s = sub.add_parser("download", help="公式データ(番組表・成績)を取得")
    s.add_argument("--start", type=_date, required=True)
    s.add_argument("--end", type=_date, required=True)
    s.add_argument("--out", default="data/raw")
    s.add_argument("--sleep", type=float, default=1.0)
    s.set_defaults(func=cmd_download)

    s = sub.add_parser("synth", help="動作確認用の合成データを生成")
    s.add_argument("--out", default="data/synth")
    s.add_argument("--start", type=_date, default=date(2024, 1, 1))
    s.add_argument("--days", type=int, default=120)
    s.add_argument("--seed", type=int, default=0)
    s.set_defaults(func=cmd_synth)

    s = sub.add_parser("train", help="学習してテスト期間でバックテスト")
    s.add_argument("--data", default="data/raw")
    s.add_argument("--model", default="models/model.pkl")
    s.add_argument("--test-from", help="この日以降をテスト期間に (YYYY-MM-DD)")
    s.set_defaults(func=cmd_train)

    s = sub.add_parser("predict", help="番組表ファイルから予測")
    s.add_argument("--program", required=True, help="b*.txt")
    s.add_argument("--model", default="models/model.pkl")
    s.add_argument("--data", default="data/raw", help="履歴特徴に使う過去データのディレクトリ")
    s.add_argument("--venue", type=int)
    s.add_argument("--top", type=int, default=5)
    s.set_defaults(func=cmd_predict)

    a = p.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
