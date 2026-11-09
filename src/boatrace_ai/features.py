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


COURSE_HIST = ["hc_n", "hc_win_rate", "hc_top3_rate", "hc_avg_st"]
MOTOR_HIST = ["mh_n", "mh_avg_finish", "mh_top2_rate", "mh_avg_ex"]


def add_course_history(entries: pd.DataFrame, results: pd.DataFrame, course_col: str = "course_ex") -> pd.DataFrame:
    """選手 × 実際の進入コースの過去成績 (その日より前). entries の course_col で引く."""
    df = entries.copy()
    if results is None or results.empty or "course" not in results:
        for c in COURSE_HIST:
            df[c] = 0.0 if c.endswith("_n") else float("nan")
        return df
    r = results.dropna(subset=["course"]).copy()
    r["course"] = r["course"].astype(int)
    cum = _daily_cumulative(r, ["reg_no", "course"], "hc").rename(columns={"date": "_hdate", "course": "_course"})
    cum["hc_avg_st"] = float("nan")
    st = r.dropna(subset=["st"]).groupby(["reg_no", "course", "date"])["st"].agg(["sum", "count"]).reset_index().sort_values("date")
    st[["s", "c"]] = st.groupby(["reg_no", "course"])[["sum", "count"]].cumsum()
    st = st.assign(hc_avg_st=st.s / st.c)[["reg_no", "course", "date", "hc_avg_st"]].rename(columns={"date": "_hdate", "course": "_course"})
    cum = cum.drop(columns="hc_avg_st").merge(st, on=["reg_no", "_course", "_hdate"], how="left").sort_values("_hdate")
    df["_row"] = range(len(df))
    df["_course"] = df[course_col].fillna(df["lane"]).astype(int)
    df = pd.merge_asof(df.sort_values("date"), cum, left_on="date", right_on="_hdate", by=["reg_no", "_course"],
                       direction="backward", allow_exact_matches=False).drop(columns=["_hdate"])
    df["hc_n"] = df["hc_n"].fillna(0.0)
    return df.sort_values("_row").drop(columns=["_row", "_course"]).reset_index(drop=True)


def add_motor_history(entries: pd.DataFrame, results: pd.DataFrame, days: int = 60) -> pd.DataFrame:
    """モーターの最近の調子: 同じ場・同じモーター番号の直近 days 日の成績 (その日より前)."""
    df = entries.copy()
    if results is None or results.empty or "motor_no" not in results:
        for c in MOTOR_HIST:
            df[c] = 0.0 if c.endswith("_n") else float("nan")
        return df
    r = results.dropna(subset=["motor_no"]).copy()
    r["motor_no"] = r["motor_no"].astype(int)
    r["_fin"] = r["finish"].fillna(7.0)
    r["_top2"] = (r["finish"] <= 2).astype(float)
    daily = (r.groupby(["venue", "motor_no", "date"])
              .agg(n=("_fin", "size"), f=("_fin", "sum"), t=("_top2", "sum"), ex=("exhibit", "sum"), exn=("exhibit", "count"))
              .reset_index().sort_values("date"))
    roll = (daily.set_index("date").groupby(["venue", "motor_no"])[["n", "f", "t", "ex", "exn"]]
                 .rolling(f"{days}D").sum().reset_index())
    roll["mh_n"] = roll["n"]
    roll["mh_avg_finish"] = roll["f"] / roll["n"]
    roll["mh_top2_rate"] = roll["t"] / roll["n"]
    roll["mh_avg_ex"] = roll["ex"] / roll["exn"].where(roll["exn"] > 0)
    roll = roll[["venue", "motor_no", "date"] + MOTOR_HIST].rename(columns={"date": "_mdate"}).sort_values("_mdate")
    df["_row"] = range(len(df))
    df = pd.merge_asof(df.sort_values("date"), roll, left_on="date", right_on="_mdate", by=["venue", "motor_no"],
                       direction="backward", allow_exact_matches=False)
    stale = (df["date"] - df["_mdate"]).dt.days > days   # 古すぎる記録(交換前など)は使わない
    df.loc[stale.fillna(True), MOTOR_HIST] = float("nan")
    df["mh_n"] = df["mh_n"].fillna(0.0)
    return df.drop(columns="_mdate").sort_values("_row").drop(columns="_row").reset_index(drop=True)


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
    df = add_motor_history(df, history)              # モーターの最近の調子
    df = add_course_history(df, history, "lane")     # 選手×コース (朝は枠番で代用)
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
