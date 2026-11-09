"""特徴量生成.

- 番組表の基本情報(枠・級別・勝率・モーター/ボート2連率 など)
- レース内の相対値(平均との差・順位)
- 過去成績からの履歴特徴(対象日より前の成績のみ使うのでリークしない)
"""

from __future__ import annotations

import pandas as pd

RACE_KEY = ["date", "venue", "race_no"]

BASE_FEATURES = [
    "lane", "venue", "class_num", "age", "weight",
    "nat_win", "nat_2", "loc_win", "loc_2", "motor_2", "boat_2",
]
RELATIVE_COLS = ["class_num", "nat_win", "nat_2", "loc_win", "motor_2", "boat_2"]
HIST_FEATURES = [
    "h_n", "h_win_rate", "h_top3_rate", "h_avg_finish", "h_avg_st",
    "hl_n", "hl_win_rate", "hl_top3_rate",
]
FEATURES = (
    BASE_FEATURES
    + [f"{c}_diff" for c in RELATIVE_COLS]
    + [f"{c}_rank" for c in RELATIVE_COLS]
    + HIST_FEATURES
)
CATEGORICAL = ["venue"]


def add_relative(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    g = df.groupby(RACE_KEY)
    for c in RELATIVE_COLS:
        df[f"{c}_diff"] = df[c] - g[c].transform("mean")
        df[f"{c}_rank"] = g[c].rank(ascending=False, method="min")
    return df


def _daily_cumulative(results: pd.DataFrame, by: list[str], prefix: str) -> pd.DataFrame:
    """by ごとに『その日の終わりまで』の累積成績を作る."""
    r = results.copy()
    r["_win"] = (r["finish"] == 1).astype(float)
    r["_top3"] = (r["finish"] <= 3).astype(float)
    r["_fin"] = r["finish"].fillna(7.0)  # 失格・欠場は 7 着扱い
    r["_st_sum"] = r["st"].fillna(0.0) if "st" in r else 0.0
    r["_st_n"] = r["st"].notna().astype(float) if "st" in r else 0.0
    daily = (
        r.groupby(by + ["date"])
        .agg(n=("_win", "size"), w=("_win", "sum"), t=("_top3", "sum"),
             f=("_fin", "sum"), sts=("_st_sum", "sum"), stn=("_st_n", "sum"))
        .reset_index()
        .sort_values("date")
    )
    cum = daily.groupby(by)[["n", "w", "t", "f", "sts", "stn"]].cumsum()
    out = daily[by + ["date"]].copy()
    out[f"{prefix}_n"] = cum["n"]
    out[f"{prefix}_win_rate"] = cum["w"] / cum["n"]
    out[f"{prefix}_top3_rate"] = cum["t"] / cum["n"]
    if prefix == "h":
        out["h_avg_finish"] = cum["f"] / cum["n"]
        out["h_avg_st"] = cum["sts"] / cum["stn"].where(cum["stn"] > 0)
    return out


def add_history(entries: pd.DataFrame, results: pd.DataFrame) -> pd.DataFrame:
    """entries の各行に、その日より前の成績から作った履歴特徴を付ける."""
    df = entries.copy()
    if results is None or results.empty:
        for c in HIST_FEATURES:
            df[c] = 0.0 if c.endswith("_n") else float("nan")
        return df

    df["_row"] = range(len(df))
    df = df.sort_values("date")
    for by, prefix in ((["reg_no"], "h"), (["reg_no", "lane"], "hl")):
        cum = _daily_cumulative(results, by, prefix).rename(columns={"date": "_hdate"})
        cum = cum.sort_values("_hdate")
        df = pd.merge_asof(
            df, cum, left_on="date", right_on="_hdate", by=by,
            direction="backward", allow_exact_matches=False,
        ).drop(columns="_hdate")
    df["h_n"] = df["h_n"].fillna(0.0)
    df["hl_n"] = df["hl_n"].fillna(0.0)
    return df.sort_values("_row").drop(columns="_row").reset_index(drop=True)


def race_cat(name) -> int:
    """番組表のレース名 -> レースの格 (0:その他 1:一般 2:予選 3:特選・選抜など 4:準優勝戦 5:優勝戦)."""
    s = str(name)
    if "準優" in s:
        return 4
    if "優勝" in s:
        return 5
    if any(k in s for k in ("ドリーム", "選抜", "特選", "特賞", "シード")):
        return 3
    if "予選" in s:
        return 2
    if "一般" in s:
        return 1
    return 0


def add_race_info(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["race_cat"] = df["race_name"].map(race_cat) if "race_name" in df else 0
    df["hour"] = pd.to_numeric(df["deadline"].astype(str).str[:2], errors="coerce") if "deadline" in df else float("nan")
    return df


def build_features(programs: pd.DataFrame, history: pd.DataFrame | None) -> pd.DataFrame:
    df = add_relative(add_race_info(programs))
    df = add_history(df, history)
    return df


def build_training_table(programs: pd.DataFrame, results: pd.DataFrame) -> pd.DataFrame:
    """番組表 + 成績 -> 学習用テーブル(目的変数 finish / win 付き)."""
    df = build_features(programs, results)
    target = results[RACE_KEY + ["lane", "finish"]]
    df = df.merge(target, on=RACE_KEY + ["lane"], how="inner")
    # 6艇そろっていて、1着が確定しているレースのみ使う
    ok = df.groupby(RACE_KEY)["finish"].transform(lambda s: (s == 1).sum() == 1 and len(s) == 6)
    df = df[ok.astype(bool)].copy()
    df["win"] = (df["finish"] == 1).astype(int)
    return df.reset_index(drop=True)
