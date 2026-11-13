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
    n_races = lambda t: int(t.groupby(["date", "venue", "race_no"]).ngroups)
    model.meta = dict(
        trained_at=pd.Timestamp.now().strftime("%Y-%m-%d"),
        data_from=f"{table['date'].min():%Y-%m-%d}", data_to=f"{table['date'].max():%Y-%m-%d}",
        train_races=n_races(train) + n_races(valid), test_races=n_races(test),
    )
    if len(test):
        report = run_backtest(model, test, payouts, train)
        model.meta.update(top1_acc=round(report.top1_acc, 4), lane1_acc=round(report.lane1_acc, 4),
                          win_roi=round(report.win_roi, 4))
        print(report)
    model.save(Path(a.model))
    print(f"\nmodel -> {a.model}")
    print("\n特徴量重要度 (上位10):")
    print(model.feature_importance().head(10).round(0).to_string())


def cmd_predict(a):
    from .model import BoatRaceModel
    from .predict import predict_program
    from .venues import venue_name

    model = BoatRaceModel.load(Path(a.model))
    _, preds = predict_program(model, Path(a.program), Path(a.data) if a.data else None)
    for (d, venue, race_no), pr in preds.items():
        if a.venue and venue != a.venue:
            continue
        wp = "  ".join(f"{lane}:{p:.0%}" for lane, p in sorted(pr["win_probs"].items()))
        tri = ", ".join(f"{c}({p:.1%})" for c, p in pr["trifecta"].head(a.top).itertuples(index=False))
        print(f"{d.date()} {venue_name(venue)} {race_no:2d}R | 1着率 {wp}\n    3連単: {tri}")


def cmd_export(a):
    from .model import BoatRaceModel
    from .predict import predict_program, to_app_json, write_app_json

    model = BoatRaceModel.load(Path(a.model))
    df, preds = predict_program(model, Path(a.program), Path(a.data) if a.data else None)
    write_app_json(to_app_json(df, preds, model), Path(a.out))
    print(f"{len(preds)} races -> {a.out}")


def cmd_site(a):
    from datetime import timedelta

    from .site import build_site

    today = a.date or date.today()
    dates = [today + timedelta(days=i) for i in range(-a.back, a.ahead + 1)]
    for line in build_site(Path(a.model), Path(a.data), Path(a.out), dates, keep_days=a.keep, app_dir=a.app):
        print(line)
    print(f"site -> {a.out}")


def cmd_analyze(a):
    from .analyze import run
    from .parse import load_dir

    programs, results, payouts = load_dir(Path(a.data))
    dates = sorted(programs["date"].unique())
    test_from = pd.Timestamp(a.test_from) if a.test_from else dates[int(len(dates) * 0.6)]
    _, text = run(programs, results, payouts, test_from)
    print(text)
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(text, encoding="utf-8")


def cmd_claude_page(a):
    from .claude_page import build_claude_page

    out = build_claude_page(Path(a.app), Path(a.site), Path(a.out))
    print(f"Claude page -> {out} ({out.stat().st_size // 1024} KB)")


def cmd_watch(a):
    from .watch import watch

    exp = None
    if a.ex_model and a.program:
        from .predict import ExPredictor
        exp = ExPredictor(Path(a.ex_model), Path(a.program), Path(a.history))
    result = watch(Path(a.site), Path(a.app), Path(a.out), day=a.day, ex_predictor=exp)
    print(result)


def cmd_backfill(a):
    from .backfill import backfill_day
    from .claude_page import build_claude_page

    exp = None
    if a.ex_model and a.program:
        from .predict import ExPredictor
        exp = ExPredictor(Path(a.ex_model), Path(a.program), Path(a.history))
    n = backfill_day(Path(a.site), a.day, ex_predictor=exp)
    build_claude_page(Path(a.app), Path(a.site), Path(a.out))
    print(f"{a.day}: {n}レースを埋めた")


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

    s = sub.add_parser("export", help="アプリ用の予測JSONを書き出す")
    s.add_argument("--program", required=True, help="b*.txt")
    s.add_argument("--model", default="models/model.pkl")
    s.add_argument("--data", default="data/raw")
    s.add_argument("--out", default="app/predictions.json")
    s.set_defaults(func=cmd_export)

    s = sub.add_parser("site", help="スマホアプリ(静的サイト)を組み立てる")
    s.add_argument("--model", default="models/model.pkl")
    s.add_argument("--data", default="data/raw")
    s.add_argument("--out", default="site")
    s.add_argument("--date", type=_date, help="基準日 (省略時は今日)")
    s.add_argument("--back", type=int, default=2, help="基準日の何日前から")
    s.add_argument("--ahead", type=int, default=1, help="基準日の何日後まで")
    s.add_argument("--keep", type=int, default=30, help="サイトに残す日数")
    s.add_argument("--app", help="画面ファイル(index.html)のフォルダ (省略時は ./app)")
    s.set_defaults(func=cmd_site)

    s = sub.add_parser("analyze", help="的中率が上がる条件を調べる")
    s.add_argument("--data", default="data/raw")
    s.add_argument("--test-from", help="この日以降で検証 (省略時は後ろ40%%)")
    s.add_argument("--out", help="結果を保存するファイル")
    s.set_defaults(func=cmd_analyze)

    s = sub.add_parser("claude-page", help="データを埋め込んだ Claude のページ用アプリを作る")
    s.add_argument("--app", default="app/index.html")
    s.add_argument("--site", default="site", help="boatrace-ai site の出力フォルダ")
    s.add_argument("--out", default="site/claude.html")
    s.set_defaults(func=cmd_claude_page)

    s = sub.add_parser("watch-exhibit", help="締切が近いレースの展示を取りに行き、アプリを作り直す")
    s.add_argument("--site", default="site")
    s.add_argument("--app", default="app/index.html")
    s.add_argument("--out", default="site/claude.html")
    s.add_argument("--day", help="YYYY-MM-DD (省略時は今日)")
    s.add_argument("--ex-model", help="展示を学習したAI (省略時は展示をあとから足す方式)")
    s.add_argument("--program", help="その日の番組表 b*.txt (--ex-model と一緒に)")
    s.add_argument("--history", default="data/raw", help="過去の成績のフォルダ")
    s.set_defaults(func=cmd_watch)

    s = sub.add_parser("backfill", help="見張りが動いていなかった日の展示・オッズをあとから埋める")
    s.add_argument("--day", required=True, help="YYYY-MM-DD")
    s.add_argument("--site", default="site")
    s.add_argument("--app", default="app/index.html")
    s.add_argument("--out", default="site/claude.html")
    s.add_argument("--ex-model", help="展示を学習したAI")
    s.add_argument("--program", help="その日の番組表 b*.txt (--ex-model と一緒に)")
    s.add_argument("--history", default="data/raw", help="過去の成績のフォルダ")
    s.set_defaults(func=cmd_backfill)

    a = p.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
