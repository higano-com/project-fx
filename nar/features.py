"""地方競馬: 公式CSVから1頭1行の特徴量表を作る。

レースの前に分かる情報だけを使う(当日の人気・オッズは使わない。前走の人気は使う)。
馬は「馬名+生年月日」、騎手・調教師は「名前+所属」で同じものとみなす(公式にIDがないため)。
"""
from pathlib import Path

import numpy as np
import pandas as pd

CSV = Path(__file__).resolve().parent.parent / "data" / "nar" / "csv"
EXCLUDE_TRACKS = {"帯広ば"}  # ばんえいは別競技なので外す
BABA = {"良": 0, "稍重": 1, "重": 2, "不良": 3}


def _rec(s: pd.Series):
    """'1-2-0-5' → (勝, 2着, 3着, 着外) の4列。空欄は0。"""
    p = s.fillna("0-0-0-0").str.split("-", expand=True).reindex(columns=range(4))
    return p.apply(pd.to_numeric, errors="coerce").fillna(0).to_numpy()


def _time(s: pd.Series) -> pd.Series:
    """走破タイム '2043' → 124.3秒、'1327' → 87.7秒(分 + 秒3桁の下1桁が0.1秒)。"""
    v = pd.to_numeric(s, errors="coerce")
    return (v // 1000) * 60 + (v % 1000) / 10


def _best(s: pd.Series) -> pd.Series:
    """持ちタイム '1:24.6' / '良2:03.9' → 秒。"""
    t = s.fillna("").str.replace(r"^[^0-9]+", "", regex=True)
    m = t.str.extract(r"^(\d+):(\d+\.\d)$")
    return pd.to_numeric(m[0], errors="coerce") * 60 + pd.to_numeric(m[1], errors="coerce")


def load(months: list[str] | None = None) -> pd.DataFrame:
    hs, rs = [], []
    for f in sorted(CSV.glob("*_horselist.csv")):
        tag = f.name[:6]
        if months and tag not in months:
            continue
        hs.append(pd.read_csv(f, dtype=str))
        rs.append(pd.read_csv(CSV / f"{tag}_racelist.csv", dtype=str))
    h = pd.concat(hs, ignore_index=True)
    r = pd.concat(rs, ignore_index=True)
    key = ["競馬場", "競走年月日", "レース番号"]
    r = r.drop_duplicates(key)
    h = h.drop_duplicates(key + ["馬番"])
    h = h[~h["競馬場"].isin(EXCLUDE_TRACKS)]
    r = r[["競馬場", "競走年月日", "レース番号", "発走時刻", "競走種類名称", "芝ダート区分",
           "距離", "馬場", "頭数", "条件"]]
    return h.merge(r, on=key, how="left")


def build(df: pd.DataFrame) -> pd.DataFrame:
    d = pd.DataFrame()
    d["track"] = df["競馬場"]
    d["date"] = pd.to_datetime(df["競走年月日"], format="%Y%m%d")
    d["race_no"] = pd.to_numeric(df["レース番号"])
    d["rid"] = df["競馬場"] + df["競走年月日"] + df["レース番号"].str.zfill(2)
    d["umaban"] = pd.to_numeric(df["馬番"], errors="coerce")
    d["waku"] = pd.to_numeric(df["枠番"], errors="coerce")
    d["horse"] = df["馬名"].fillna("") + "|" + df["生年月日"].fillna("")
    d["jockey"] = df["騎手名"].fillna("") + "|" + df["騎手所属"].fillna("")
    d["trainer"] = df["調教師"].fillna("") + "|" + df["調教師所属"].fillna("")
    d["finish"] = pd.to_numeric(df["着順"], errors="coerce")
    d["ninki"] = pd.to_numeric(df["人気"], errors="coerce")  # 当日の人気(特徴量には使わない)
    d["time"] = _time(df["タイム"])
    d["last3f"] = pd.to_numeric(df["上がり3F"], errors="coerce")

    # レース条件
    d["dist"] = pd.to_numeric(df["距離"], errors="coerce")
    d["baba"] = df["馬場"].map(BABA)
    d["turf"] = (df["芝ダート区分"] == "芝").astype(int)
    d["n_horses"] = d.groupby("rid")["umaban"].transform("count")
    d["grade"] = df["競走種類名称"].map({"普通": 0, "特別": 1, "準重賞": 2, "重賞": 3}).fillna(0)
    d["hour"] = pd.to_numeric(df["発走時刻"], errors="coerce") // 100
    d["age2"] = df["条件"].fillna("").str.contains("２歳").astype(int)

    # 馬の情報
    d["age"] = pd.to_numeric(df["齢"], errors="coerce")
    d["sex"] = df["性"].map({"牡": 0, "牝": 1, "セン": 2})
    w = df["負担重量"].fillna("")
    d["apprentice"] = w.str.contains(r"[☆▲△◇★]").astype(int)
    d["weight"] = pd.to_numeric(w.str.replace(r"[^0-9.]", "", regex=True), errors="coerce")
    d["body"] = pd.to_numeric(df["馬体重"], errors="coerce")
    d["body_diff"] = pd.to_numeric(df["馬体重増減"].str.replace("+", ""), errors="coerce")
    for col, name in [("全成績", "all"), ("当競馬場成績", "trk"), ("うち当距離成績", "dst"),
                      ("騎手成績", "jh")]:
        a = _rec(df[col])
        n = a.sum(1)
        d[f"{name}_n"] = n
        d[f"{name}_win"] = np.where(n > 0, a[:, 0] / np.maximum(n, 1), np.nan)
        d[f"{name}_top3"] = np.where(n > 0, a[:, :3].sum(1) / np.maximum(n, 1), np.nan)
    bt = _best(df["最高タイム"])
    d["best"] = bt
    d["best_diff"] = bt - d.assign(b=bt).groupby("rid")["b"].transform("min")
    d["best_rank"] = d.assign(b=bt).groupby("rid")["b"].rank(method="min") / d["n_horses"]
    d["weight_diff"] = d["weight"] - d.groupby("rid")["weight"].transform("mean")
    return d


def add_history(d: pd.DataFrame) -> pd.DataFrame:
    """過去レースからの特徴量(その日より前のレースだけを使う)。"""
    d = d.sort_values(["date", "rid", "umaban"]).reset_index(drop=True)
    # 勝ち馬とのタイム差(1着のタイムとの差、距離100mあたり)
    win_t = d[d["finish"] == 1].groupby("rid")["time"].min()
    d["behind"] = (d["time"] - d["rid"].map(win_t)) / d["dist"] * 100
    d["fin_rel"] = (d["finish"] - 1) / (d["n_horses"] - 1).clip(lower=1)
    d["l3f_rank"] = d.groupby("rid")["last3f"].rank(method="min") / d["n_horses"]
    d["won"] = (d["finish"] == 1).astype(float)

    g = d.groupby("horse", sort=False)
    for k in (1, 2, 3):
        d[f"prev{k}_fin"] = g["fin_rel"].shift(k)
        d[f"prev{k}_behind"] = g["behind"].shift(k)
    d["prev1_ninki"] = g["ninki"].shift(1) / g["n_horses"].shift(1)
    d["prev1_l3f"] = g["l3f_rank"].shift(1)
    d["prev1_dist_diff"] = d["dist"] - g["dist"].shift(1)
    d["prev1_same_trk"] = (d["track"] == g["track"].shift(1)).astype(float)
    d["prev1_jockey_same"] = (d["jockey"] == g["jockey"].shift(1)).astype(float)
    d["days_off"] = (d["date"] - g["date"].shift(1)).dt.days
    d["avg3_behind"] = d[["prev1_behind", "prev2_behind", "prev3_behind"]].mean(1)
    d["avg3_fin"] = d[["prev1_fin", "prev2_fin", "prev3_fin"]].mean(1)
    d["best3_behind"] = d[["prev1_behind", "prev2_behind", "prev3_behind"]].min(1)
    d["n_hist"] = g.cumcount()

    # 騎手・調教師の直近365日の勝率(その日より前)。日単位で集計してから累積する
    for who in ("jockey", "trainer"):
        day = d.groupby([who, "date"]).agg(r=("won", "size"), w=("won", "sum")).reset_index()
        day = day.sort_values([who, "date"])
        out = []
        for _, gg in day.groupby(who, sort=False):
            s = gg.set_index("date")[["r", "w"]]
            roll = s.rolling("365D").sum() - s  # その日自身を除く
            out.append(roll.assign(**{who: gg[who].values}).reset_index())
        roll = pd.concat(out)
        d = d.merge(roll.rename(columns={"r": f"{who}_runs", "w": f"{who}_wins"}),
                    on=[who, "date"], how="left")
        d[f"{who}_wr"] = (d[f"{who}_wins"] + 1) / (d[f"{who}_runs"] + 10)  # 少数は平均寄せ

    # レース内での相対値
    for c in ("avg3_behind", "prev1_behind", "jockey_wr", "trainer_wr", "all_win", "best3_behind"):
        higher_better = c.endswith("wr") or c.endswith("win")
        d[f"{c}_r"] = d.groupby("rid")[c].rank(method="min", ascending=not higher_better) / d["n_horses"]
    return d


FEATURES = [
    "umaban", "waku", "n_horses", "dist", "baba", "turf", "grade", "hour", "age2",
    "age", "sex", "apprentice", "weight", "weight_diff", "body", "body_diff",
    "all_n", "all_win", "all_top3", "trk_n", "trk_win", "trk_top3", "dst_n", "dst_win", "dst_top3",
    "jh_n", "jh_win", "jh_top3", "best_diff", "best_rank",
    "prev1_fin", "prev2_fin", "prev3_fin", "prev1_behind", "prev2_behind", "prev3_behind",
    "prev1_ninki", "prev1_l3f", "prev1_dist_diff", "prev1_same_trk", "prev1_jockey_same",
    "days_off", "avg3_behind", "avg3_fin", "best3_behind", "n_hist",
    "jockey_runs", "jockey_wr", "trainer_runs", "trainer_wr",
    "avg3_behind_r", "prev1_behind_r", "jockey_wr_r", "trainer_wr_r", "all_win_r", "best3_behind_r",
    "track_c",
]


def dataset() -> pd.DataFrame:
    d = add_history(build(load()))
    d["track_c"] = d["track"].astype("category")
    return d
