"""中央競馬: runs.pkl(1頭1行)から、レース前に分かる情報だけで特徴量を作る。

ベンター(香港で成功した競馬の計算屋)の考え方にならい、
「その馬の実力(スピード指数)」「調子・ローテ」「騎手・調教師」「枠・頭数」などの基本情報を並べる。
当日の人気・オッズは使わない(市場との混合は backtest.py の2段目でやる)。
"""
from pathlib import Path

import sys

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import horsefeat as H  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "data" / "jra" / "runs.pkl"
BABA = {"良": 0, "稍重": 1, "重": 2, "不良": 3}
CLS = {"新馬": 0, "未勝利": 1, "1勝クラス": 2, "2勝クラス": 3, "3勝クラス": 4, "オープン": 5}
GRADE = {"": 0, "Ｌ": 1, "（L）": 1, "GⅢ": 2, "GⅡ": 3, "GⅠ": 4}


def load() -> pd.DataFrame:
    d = pd.read_pickle(RUNS)
    d = d[d["date"].notna()].copy()
    d["date"] = pd.to_datetime(d["date"])
    return d


def base(d: pd.DataFrame) -> pd.DataFrame:
    d = d.copy()
    d["ok"] = d["status"].fillna("").eq("") & d["finish"].notna()
    d["n_horses"] = d.groupby("rid")["umaban"].transform("count")
    d["turf"] = (d["surface"] == "芝").astype(int)
    d["baba_c"] = d["baba"].map(BABA)
    d["cls_c"] = d["cls"].map(CLS)
    d["grade_c"] = d["grade"].fillna("").map(GRADE).fillna(0)
    d["sex_c"] = d["sex"].map({"牡": 0, "牝": 1, "セ": 2})
    d["apprentice"] = d["apprentice"].astype(float)
    d["weight_diff"] = d["weight"] - d.groupby("rid")["weight"].transform("mean")
    d["venue_c"] = d["venue"].astype("category")
    d["hour"] = pd.to_numeric(d["post_time"], errors="coerce") // 100
    d["won"] = ((d["finish"] == 1) & d["ok"]).astype(float)
    d["top3"] = ((d["finish"] <= 3) & d["ok"]).astype(float)
    return d


def speed(d: pd.DataFrame, until: str) -> pd.DataFrame:
    """スピード指数(大きいほど速い)。

    レースの勝ちタイムを「同じ場・芝ダ・距離・馬場」の基準タイム(until より前の中央値)と比べ、
    その馬の勝ち馬との差を足す。距離の違いは 1000m あたりの秒に直して吸収する。
    """
    win = d[(d["finish"] == 1) & d["ok"]].groupby("rid")["time"].min()
    d["win_time"] = d["rid"].map(win)
    key = ["venue", "surface", "dist", "baba"]
    ref = (d[(d["date"] < until) & (d["finish"] == 1)]
           .groupby(key)["time"].median().rename("ref_time"))
    d = d.merge(ref, left_on=key, right_index=True, how="left")
    # 基準がない条件は、場・芝ダ・距離だけで
    ref2 = (d[(d["date"] < until) & (d["finish"] == 1)]
            .groupby(key[:3])["time"].median().rename("ref2"))
    d = d.merge(ref2, left_on=key[:3], right_index=True, how="left")
    d["ref_time"] = d["ref_time"].fillna(d["ref2"])
    per = 1000 / d["dist"]
    d["race_speed"] = (d["ref_time"] - d["win_time"]) * per          # レース全体の速さ
    d["behind"] = (d["time"] - d["win_time"]) * per                  # 勝ち馬との差
    d["spd"] = d["race_speed"] - d["behind"]
    d.loc[~d["ok"], "spd"] = np.nan
    # 上がり3Fの速さ(レース内の順位)と、最後のコーナーの位置(脚質)
    d["l3f_rank"] = d.groupby("rid")["last3f"].rank(method="min") / d["n_horses"]
    d["pos_rel"] = d["corner_last"] / d["n_horses"]
    d["fin_rel"] = (d["finish"] - 1) / (d["n_horses"] - 1).clip(lower=1)
    return d.drop(columns=["ref2"])


def history(d: pd.DataFrame) -> pd.DataFrame:
    """その日より前のレースだけから作る特徴量。"""
    d = d.sort_values(["date", "post_time", "rid", "umaban"]).reset_index(drop=True)
    g = d.groupby("horse_id", sort=False)
    for k in (1, 2, 3, 4, 5):
        d[f"spd{k}"] = g["spd"].shift(k)
    sp = d[[f"spd{k}" for k in range(1, 6)]]
    d["spd_best5"] = sp.max(1)
    d["spd_avg3"] = sp.iloc[:, :3].mean(1)
    d["spd_avg5"] = sp.mean(1)
    d["prev1_fin"] = g["fin_rel"].shift(1)
    d["prev2_fin"] = g["fin_rel"].shift(2)
    d["prev1_ninki"] = g["ninki"].shift(1) / g["n_horses"].shift(1)
    d["prev1_odds"] = np.log(g["odds"].shift(1))
    d["prev1_l3f"] = g["l3f_rank"].shift(1)
    d["avg3_pos"] = (g["pos_rel"].shift(1) + g["pos_rel"].shift(2) + g["pos_rel"].shift(3)) / 3
    d["prev1_pos"] = g["pos_rel"].shift(1)
    d["dist_diff"] = d["dist"] - g["dist"].shift(1)
    d["surf_change"] = (d["surface"] != g["surface"].shift(1)).astype(float)
    d["cls_diff"] = d["cls_c"] - g["cls_c"].shift(1)
    d["days_off"] = (d["date"] - g["date"].shift(1)).dt.days
    d["n_hist"] = g.cumcount()
    d["wins_hist"] = g["won"].cumsum() - d["won"]
    d["top3_rate"] = (g["top3"].cumsum() - d["top3"]) / d["n_hist"].replace(0, np.nan)
    d["jockey_same"] = (d["jockey_id"] == g["jockey_id"].shift(1)).astype(float)
    d["body_prev_diff"] = d["body"] - g["body"].shift(1)
    # 同じ芝ダ・近い距離での最高指数
    d["dbin"] = (d["dist"] // 400).astype(int)
    gs = d.groupby(["horse_id", "surface", "dbin"], sort=False)
    d["spd_same_best"] = gs["spd"].transform(lambda s: s.shift(1).cummax())

    # 斤量の増減、休み明けから何戦目か(叩き2戦目など)
    d["kinryo_diff"] = d["weight"] - g["weight"].shift(1)
    rest = (d["days_off"].isna() | (d["days_off"] >= 60)).astype(int)
    d["since_rest"] = rest.groupby(d["horse_id"]).cumsum()
    d["since_rest"] = d.groupby(["horse_id", "since_rest"]).cumcount() + 1  # 1 = 休み明け初戦
    # 輸送: 厩舎の所属(美浦=東 / 栗東=西)を、その調教師がふだん走らせる場から推定し、遠征かどうかを見る
    EAST, WEST = {"中山", "東京", "福島", "新潟"}, {"京都", "阪神", "中京", "小倉"}
    reg = d["venue"].map(lambda v: 1 if v in EAST else (-1 if v in WEST else 0))
    home = reg.groupby(d["trainer_id"]).transform("mean")
    d["trainer_east"] = home
    d["travel"] = np.where(reg == 0, 2, np.where(reg * np.sign(home) < 0, 1, 0)).astype(float)  # 0=地元 1=遠征 2=北海道
    # 騎手×調教師のコンビの過去成績(その日より前)
    gc = d.groupby(["jockey_id", "trainer_id"], sort=False)
    d["combo_runs"] = gc.cumcount()
    d["combo_t3"] = (gc["top3"].cumsum() - d["top3"] + 0.6) / (d["combo_runs"] + 3)

    # 騎手・調教師の直近365日の成績(その日自身は除く)。少数は平均寄せ
    for who in ("jockey_id", "trainer_id"):
        day = d.groupby([who, "date"]).agg(r=("won", "size"), w=("won", "sum"), t=("top3", "sum")).reset_index()
        out = []
        for _, gg in day.sort_values([who, "date"]).groupby(who, sort=False):
            s = gg.set_index("date")[["r", "w", "t"]]
            roll = s.rolling("365D").sum() - s
            out.append(roll.assign(**{who: gg[who].values}).reset_index())
        roll = pd.concat(out).rename(columns={"r": f"{who}_runs", "w": f"{who}_w", "t": f"{who}_t"})
        d = d.merge(roll, on=[who, "date"], how="left")
        d[f"{who}_wr"] = (d[f"{who}_w"] + 0.7) / (d[f"{who}_runs"] + 10)
        d[f"{who}_t3"] = (d[f"{who}_t"] + 2.1) / (d[f"{who}_runs"] + 10)

    # レース内での相対値(ベンターも「レース内で比べる」形にしている)
    for c in ("spd_best5", "spd_avg3", "spd_same_best", "jockey_id_wr", "trainer_id_wr", "avg3_pos"):
        mu = d.groupby("rid")[c].transform("mean")
        d[f"{c}_dev"] = d[c] - mu
        d[f"{c}_rank"] = d.groupby("rid")[c].rank(ascending=c == "avg3_pos", method="min") / d["n_horses"]
    # 前に行く馬の多さ(展開): 先行馬の数
    d["n_front"] = d.groupby("rid")["avg3_pos"].transform(lambda s: (s < 0.3).sum())
    return d


FEATURES = [
    "umaban", "waku", "n_horses", "dist", "turf", "baba_c", "cls_c", "grade_c", "hour", "venue_c",
    "handicap", "female", "outer",
    "age", "sex_c", "apprentice", "weight", "weight_diff", "body", "body_diff", "body_prev_diff",
    "spd1", "spd2", "spd3", "spd_best5", "spd_avg3", "spd_avg5", "spd_same_best",
    "prev1_fin", "prev2_fin", "prev1_ninki", "prev1_odds", "prev1_l3f", "avg3_pos", "prev1_pos",
    "dist_diff", "surf_change", "cls_diff", "days_off", "n_hist", "wins_hist", "top3_rate", "jockey_same",
    "jockey_id_runs", "jockey_id_wr", "jockey_id_t3", "trainer_id_runs", "trainer_id_wr", "trainer_id_t3",
    "spd_best5_dev", "spd_best5_rank", "spd_avg3_dev", "spd_avg3_rank", "spd_same_best_dev",
    "spd_same_best_rank", "jockey_id_wr_dev", "jockey_id_wr_rank", "trainer_id_wr_dev",
    "avg3_pos_dev", "avg3_pos_rank", "n_front",
    "kinryo_diff", "since_rest", "trainer_east", "travel", "combo_runs", "combo_t3",
] + H.FEATS  # 血統・馬主・生産者・全出走歴(horsefeat.py)


def dataset(until: str) -> pd.DataFrame:
    d = H.add(history(speed(base(load()), until)))
    for c in ("handicap", "female", "outer"):
        d[c] = d[c].astype(float)
    return d
