"""的中率が上がる条件を探す分析.

学習期間とテスト期間に分け、テスト期間(AIが見ていないレース)で
条件ごとに「AI本命の1着的中率」「3連単上位5点の的中率・回収率」などを比べる。
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .features import RACE_KEY, build_training_table
from .model import BoatRaceModel, race_predictions
from .venues import venue_name

MIN_RACES = 150  # これより少ない条件は参考外


def race_table(model: BoatRaceModel, test: pd.DataFrame, results: pd.DataFrame, payouts: pd.DataFrame) -> pd.DataFrame:
    """テスト期間を1行=1レースの表にする."""
    p_win = model.predict_win(test)
    preds = race_predictions(test, p_win)
    t = test.assign(p_win=p_win).merge(
        results[RACE_KEY + ["lane", "exhibit", "course"]], on=RACE_KEY + ["lane"], how="left"
    )
    t["ex_rank"] = t.groupby(RACE_KEY)["exhibit"].rank(method="min")
    pay = payouts.set_index(RACE_KEY)

    rows = []
    for key, g in t.groupby(RACE_KEY):
        if key not in pay.index or pd.isna(pay.loc[key].get("trifecta_pay", np.nan)):
            continue
        p = pay.loc[key]
        fav = g.loc[g["p_win"].idxmax()]
        l1 = g[g["lane"] == 1].iloc[0]
        top5 = set(preds[key]["trifecta"]["combo"].iloc[:5])
        rows.append(dict(
            date=key[0], venue=venue_name(key[1]), race_no=key[2],
            race_type=p.get("race_type"), weather=p.get("weather"),
            wind=p.get("wind"), wave=p.get("wave"),
            fav_lane=int(fav.lane), fav_p=float(fav.p_win), fav_hit=int(fav.win),
            fav_ex_rank=fav.ex_rank, fav_class=fav.grade,
            win_pay=p.get("win_pay"),
            lane1_win=int(l1.win), lane1_class=l1.grade, lane1_ex_rank=l1.ex_rank,
            course_change=int((g["course"].notna() & (g["course"] != g["lane"])).any()),
            top5_hit=int(p["trifecta"] in top5), trifecta_pay=int(p["trifecta_pay"]),
        ))
    return pd.DataFrame(rows)


def summarize(df: pd.DataFrame, by) -> pd.DataFrame:
    g = df.groupby(by, observed=True)
    out = pd.DataFrame({
        "レース数": g.size(),
        "AI本命の1着率": g["fav_hit"].mean(),
        "1号艇の1着率": g["lane1_win"].mean(),
        "3連単5点の的中率": g["top5_hit"].mean(),
        "3連単5点の回収率": g.apply(lambda x: (x["top5_hit"] * x["trifecta_pay"]).sum() / (len(x) * 500), include_groups=False),
        "本命単勝の回収率": g.apply(lambda x: (x["fav_hit"] * x["win_pay"].fillna(0)).sum() / (len(x) * 100), include_groups=False),
    })
    return out[out["レース数"] >= MIN_RACES]


def fmt(df: pd.DataFrame) -> str:
    d = df.copy()
    for c in d.columns:
        if c != "レース数":
            d[c] = (d[c] * 100).map(lambda v: f"{v:.1f}%")
    return d.to_string()


def report(rt: pd.DataFrame) -> str:
    rt = rt.copy()
    rt["本命の確率"] = pd.cut(rt["fav_p"], [0, .3, .4, .5, .6, .7, 1], right=False,
                          labels=["30%未満", "30-40%", "40-50%", "50-60%", "60-70%", "70%以上"])
    rt["風速"] = pd.cut(rt["wind"], [-1, 1, 3, 5, 99], labels=["0-1m", "2-3m", "4-5m", "6m以上"])
    rt["波高"] = pd.cut(rt["wave"], [-1, 2, 5, 9, 999], labels=["0-2cm", "3-5cm", "6-9cm", "10cm以上"])
    rt["本命の展示タイム順位"] = rt["fav_ex_rank"].map(lambda r: "不明" if pd.isna(r) else f"{int(r)}位")
    rt["進入"] = rt["course_change"].map({0: "枠なり", 1: "変化あり"})

    sections = [
        ("全体", summarize(rt.assign(全体="全レース"), "全体")),
        ("AI本命の確率別 (いちばん効く条件)", summarize(rt, "本命の確率")),
        ("本命の展示タイム順位別 (直前情報。今のAIは未使用)", summarize(rt, "本命の展示タイム順位")),
        ("1号艇の級別", summarize(rt, "lane1_class")),
        ("風速別", summarize(rt, "風速")),
        ("波高別", summarize(rt, "波高")),
        ("進入", summarize(rt, "進入")),
        ("レース種別", summarize(rt, "race_type")),
        ("場別 (1号艇の1着率順)", summarize(rt, "venue").sort_values("1号艇の1着率", ascending=False)),
    ]
    combo = rt[(rt["fav_p"] >= 0.6) & (rt["fav_ex_rank"] <= 2)]
    combo2 = rt[(rt["fav_p"] >= 0.6) & (rt["fav_ex_rank"] <= 2) & (rt["wind"] <= 3)]
    sections.append(("組み合わせ: 本命60%以上 かつ 展示タイム2位以内",
                     summarize(combo.assign(条件="該当"), "条件")))
    sections.append(("組み合わせ: さらに風3m以下",
                     summarize(combo2.assign(条件="該当"), "条件")))

    lines = [f"テスト期間: {rt['date'].min():%Y-%m-%d} 〜 {rt['date'].max():%Y-%m-%d}  ({len(rt)}レース)\n"]
    for title, df in sections:
        lines += [f"■ {title}", fmt(df) if len(df) else "(該当レースが少なすぎます)", ""]
    return "\n".join(lines)


def run(programs, results, payouts, test_from) -> tuple[pd.DataFrame, str]:
    table = build_training_table(programs, results)
    test_from = pd.Timestamp(test_from)
    train, test = table[table["date"] < test_from], table[table["date"] >= test_from]
    model = BoatRaceModel().fit(train)
    rt = race_table(model, test, results, payouts)
    return rt, report(rt)
