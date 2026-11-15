"""中央競馬: 競走馬情報(血統・馬主・生産者・全出走歴)から、レース前に分かる特徴量を足す。

未来の情報を混ぜないため、全出走歴から作る数字は必ず「そのレースの日より前」の走りだけで数える。
父・母の父・生産牧場・馬主の成績は、データにいる全馬の全出走歴を使った「その日までの3着内率」(少数は平均に寄せる)。

使い方: horsefeat.add(d)  … d は runs.pkl 形式(rid, horse_id, date, surface, dist がある表)
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
HORSES = ROOT / "data" / "jra" / "horses.pkl"
CAREER = ROOT / "data" / "jra" / "career.pkl"

SHADAI = {"ノーザンファーム", "社台ファーム", "追分ファーム", "白老ファーム", "社台コーポレーション白老ファーム"}
CLUBS = ("サンデーレーシング", "キャロットファーム", "シルクレーシング", "東京ホースレーシング", "社台レースホース",
         "ラフィアン", "ユニオンオーナーズ", "ロードホースクラブ", "ノルマンディーサラブレッドレーシング", "ウイン",
         "グリーンファーム", "ターファイト", "広尾レース", "ＤＭＭドリームクラブ", "ＹＧＧホースクラブ", "インゼル",
         "大樹レーシングクラブ", "ライオンレースホース", "キャピタル・システム", "ローレルレーシング", "Ｇ１レーシング")
FEATS = [
    "sire_t3_surf", "sire_t3_dist", "sire_n_surf", "damsire_t3_surf", "breeder_t3", "owner_t3", "dam_t3",
    "shadai", "club", "sold", "select_sale", "birth_month", "age_days", "center_east",
    "c_runs", "c_t3rate", "c_prev_fin", "c_prev_ninki", "c_days_off", "c_first_surface", "c_dist_change",
    "c_prev_local", "c_surf_t3rate", "c_best_fin",
]


def band(dist):
    return pd.cut(dist, [0, 1400, 1800, 2200, 9999], labels=False)


def prior_rate(c: pd.DataFrame, q: pd.DataFrame, keys: list, name: str, m: float = 20.0):
    """出走歴 c から、keys ごとに「q の日付より前」の3着内率を数えて q に足す(少数は全体平均に寄せる)。"""
    c = c.dropna(subset=keys)
    g = (c.groupby(keys + ["date"]).agg(n=("t3", "size"), t3=("t3", "sum")).reset_index().sort_values("date"))
    g[["n", "t3"]] = g.groupby(keys)[["n", "t3"]].cumsum()
    prior = c.t3.mean()
    qq = q[keys + ["date"]].reset_index().dropna(subset=keys).sort_values("date")
    for k in keys:  # merge_asof の by は同じ型である必要がある
        g[k], qq[k] = g[k].astype(str), qq[k].astype(str)
    r = pd.merge_asof(qq, g, on="date", by=keys, allow_exact_matches=False).set_index("index")
    n, t3 = r.n.fillna(0), r.t3.fillna(0)
    q[name] = ((t3 + prior * m) / (n + m)).reindex(q.index)
    return n.reindex(q.index)


def add(d: pd.DataFrame) -> pd.DataFrame:
    d = d.copy()
    if not (HORSES.exists() and CAREER.exists()):
        for f in FEATS:
            d[f] = np.nan
        return d
    hp = pd.read_pickle(HORSES).drop_duplicates("horse_id").set_index("horse_id")
    c = pd.read_pickle(CAREER)
    c = c[c.date.notna() & (c.surface != "障害")].copy()
    c["t3"] = (c.finish <= 3).astype(float)
    c = c.join(hp[["sire", "damsire", "dam", "breeder", "owner"]], on="horse_id")
    c["band"] = band(c.dist)

    q = d[["horse_id", "date", "surface", "dist"]].join(hp[["sire", "damsire", "dam", "breeder", "owner"]], on="horse_id")
    q["band"] = band(q.dist)
    d["sire_n_surf"] = prior_rate(c, q, ["sire", "surface"], "sire_t3_surf")
    prior_rate(c, q, ["sire", "band"], "sire_t3_dist")
    prior_rate(c, q, ["damsire", "surface"], "damsire_t3_surf")
    prior_rate(c, q, ["breeder"], "breeder_t3")
    prior_rate(c, q, ["owner"], "owner_t3")
    prior_rate(c, q, ["dam"], "dam_t3", m=5)  # 兄弟の成績(母が同じ)。自分の走りも含むので c_ 系と重なる
    for k in ("sire_t3_surf", "sire_t3_dist", "damsire_t3_surf", "breeder_t3", "owner_t3", "dam_t3"):
        d[k] = q[k]

    p = hp.reindex(d.horse_id)
    p.index = d.index
    d["shadai"] = p.breeder.isin(SHADAI).astype(float).where(p.breeder.notna())
    d["club"] = p.owner.fillna("").map(lambda o: any(k in o for k in CLUBS)).astype(float).where(p.owner.notna())
    d["sold"] = p.market_name.notna().astype(float).where(p.breeder.notna())
    d["select_sale"] = p.market_name.fillna("").str.contains("セレクト").astype(float).where(p.breeder.notna())
    d["birth_month"] = p.birth.dt.month
    d["age_days"] = (d.date - p.birth).dt.days
    d["center_east"] = p.center.map({"美浦": 1.0, "栗東": 0.0})

    # その馬自身の全出走歴(そのレースより前だけ)
    c = c.sort_values(["horse_id", "date"])
    c["k"] = c.groupby("horse_id").cumcount() + 1
    c["k_t3"] = c.groupby("horse_id").t3.cumsum()
    c["best"] = c.groupby("horse_id").finish.cummin()
    qq = d[["horse_id", "date"]].reset_index().sort_values("date")
    cc = c[["horse_id", "date", "k", "k_t3", "best", "finish", "ninki", "surface", "dist", "jra"]].sort_values("date")
    qq["horse_id"], cc["horse_id"] = qq.horse_id.astype(str), cc.horse_id.astype(str)
    r = pd.merge_asof(qq, cc.rename(columns={"date": "pdate"}), left_on="date", right_on="pdate", by="horse_id",
                      allow_exact_matches=False).set_index("index").reindex(d.index)
    d["c_runs"] = r.k.fillna(0)
    d["c_t3rate"] = r.k_t3 / r.k
    d["c_best_fin"] = r.best
    d["c_prev_fin"] = r.finish
    d["c_prev_ninki"] = r.ninki
    d["c_days_off"] = (d.date - r.pdate).dt.days
    d["c_dist_change"] = d.dist - r.dist
    d["c_prev_local"] = (~r.jra.astype(bool)).astype(float).where(r.k.notna())
    # 同じ馬場(芝/ダート)での走り
    cs = c.copy()
    cs["ks"] = cs.groupby(["horse_id", "surface"]).cumcount() + 1
    cs["ks_t3"] = cs.groupby(["horse_id", "surface"]).t3.cumsum()
    qs = d[["horse_id", "surface", "date"]].reset_index().sort_values("date")
    cs = cs[["horse_id", "surface", "date", "ks", "ks_t3"]].sort_values("date")
    for k in ("horse_id", "surface"):
        qs[k], cs[k] = qs[k].astype(str), cs[k].astype(str)
    rs = pd.merge_asof(qs, cs, on="date", by=["horse_id", "surface"], allow_exact_matches=False).set_index("index").reindex(d.index)
    d["c_first_surface"] = (rs.ks.isna() & (d.c_runs > 0)).astype(float)
    d["c_surf_t3rate"] = rs.ks_t3 / rs.ks
    return d
