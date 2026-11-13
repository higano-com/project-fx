"""地方競馬: 1着確率AIを学習し、確定単勝オッズで期待値買いを検証する。

期間の分け方:
  学習        2022-07 〜 2025-12
  補正の決定  2026-01 〜 2026-02 (早期終了と自信補正 alpha)
  混合の決定  2026-03 〜 2026-06 (AIとオッズを混ぜる重み)
  本番の検証  2026-07 〜 2026-10 (どこにも使っていない期間)
オッズは最終(確定)オッズなので、実際に買える締切前のオッズより結果が良く見える点に注意。
"""
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.optimize import minimize

sys.path.insert(0, str(Path(__file__).resolve().parent))
import features as F  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ODDS = ROOT / "data" / "nar" / "odds"


def norm(p, rid):
    return p / pd.Series(p).groupby(rid.values).transform("sum").values


def race_ll(p, won, rid):
    """1レースあたりの対数損失(勝ち馬の -log p の平均)。"""
    m = won == 1
    return float(-np.log(np.clip(p[m], 1e-9, 1)).mean())


def load_win_odds() -> pd.DataFrame:
    fs = sorted(ODDS.glob("odds_*.csv"))
    o = pd.concat([pd.read_csv(f, dtype=str) for f in fs], ignore_index=True)
    o = o[o["賭式"] == "単勝"]
    o["rid"] = o["競馬場"] + o["競走年月日"] + o["レース番号"].str.zfill(2)
    o["umaban"] = pd.to_numeric(o["番号1"])
    o["odds"] = pd.to_numeric(o["オッズ"], errors="coerce")
    return o[["rid", "umaban", "odds"]].drop_duplicates(["rid", "umaban"])


def main():
    d = F.dataset()
    d = d[d["finish"].notna()].copy()  # 取消・除外などは外す
    d["n_horses"] = d.groupby("rid")["umaban"].transform("count")
    d = d[d.groupby("rid")["won"].transform("sum") == 1]  # 1着が1頭のレースだけ(同着は外す)
    X = d[F.FEATURES]
    tr = (d["date"] >= "2022-07-01") & (d["date"] < "2026-01-01")
    va = (d["date"] >= "2026-01-01") & (d["date"] < "2026-03-01")
    te = d["date"] >= "2026-03-01"
    print(f"学習 {d[tr].rid.nunique()}R / 補正 {d[va].rid.nunique()}R / 検証 {d[te].rid.nunique()}R")

    params = dict(objective="binary", learning_rate=0.03, num_leaves=63, min_data_in_leaf=100,
                  feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
                  verbose=-1)
    dtr = lgb.Dataset(X[tr], d.loc[tr, "won"])
    dva = lgb.Dataset(X[va], d.loc[va, "won"])
    model = lgb.train(params, dtr, 3000, valid_sets=[dva],
                      callbacks=[lgb.early_stopping(100, verbose=False)])
    print("木の数", model.best_iteration)

    raw = model.predict(X, num_iteration=model.best_iteration)
    d["p0"] = norm(raw, d["rid"])
    # 自信補正: p^alpha を正規化。補正期間で対数損失が最小の alpha
    v = d[va]
    best = min(np.arange(0.6, 1.81, 0.05),
               key=lambda a: race_ll(norm(v.p0.values ** a, v.rid), v.won.values, v.rid))
    d["p_ai"] = norm(d["p0"].values ** best, d["rid"])
    print(f"自信補正 alpha={best:.2f}")

    imp = pd.Series(model.feature_importance("gain"), F.FEATURES).sort_values(ascending=False)
    print("効いている特徴量:", ", ".join(f"{k}" for k in imp.index[:12]))

    # 確定単勝オッズを付ける
    t = d[te].merge(load_win_odds(), on=["rid", "umaban"], how="inner")
    t = t[t["odds"] > 0]
    t = t[t.groupby("rid")["won"].transform("sum") == 1]
    t["n_odds"] = t.groupby("rid")["umaban"].transform("count")
    t = t[t["n_odds"] == t["n_horses"]].copy()
    inv = 1 / t["odds"]
    over = inv.groupby(t["rid"]).transform("sum")
    t["p_mkt"] = inv / over
    print(f"オッズ付き {t.rid.nunique()}R、控除から見た払戻率 {1/over.groupby(t.rid).first().mean():.3f}")

    t["month"] = t["date"].dt.strftime("%Y-%m")
    fit = t["date"] < "2026-07-01"
    hold = ~fit

    def mix(df, a, b):
        z = a * np.log(np.clip(df.p_ai.values, 1e-6, 1)) + b * np.log(df.p_mkt.values)
        return norm(np.exp(z), df["rid"])

    f = t[fit]
    res = minimize(lambda w: race_ll(mix(f, *w), f.won.values, f.rid), [0.5, 0.5], method="Nelder-Mead")
    a, b = res.x
    t["p_mix"] = mix(t, a, b)
    print(f"混合の重み AI={a:.3f} 市場={b:.3f}")

    for name, m in [("混合決定期間 3-6月", fit), ("本番検証 7-10月", hold)]:
        s = t[m]
        print(f"\n[{name}] {s.rid.nunique()}R 対数損失: AI {race_ll(s.p_ai.values, s.won.values, s.rid):.4f} / "
              f"市場 {race_ll(s.p_mkt.values, s.won.values, s.rid):.4f} / 混合 {race_ll(s.p_mix.values, s.won.values, s.rid):.4f}")
        # AI本命の成績と、市場1番人気の成績
        top_ai = s.loc[s.groupby("rid")["p_ai"].idxmax()]
        top_mk = s.loc[s.groupby("rid")["p_mkt"].idxmax()]
        print(f"  AI本命の勝率 {top_ai.won.mean():.3f} 回収率 {(top_ai.won*top_ai.odds).mean():.3f} / "
              f"1番人気の勝率 {top_mk.won.mean():.3f} 回収率 {(top_mk.won*top_mk.odds).mean():.3f}")
        print("  期待値の下限  上限オッズ  点数  的中  回収率  (95%区間)")
        for th in (1.0, 1.1, 1.2, 1.3, 1.5):
            for cap in (20, 50):
                b_ = s[(s.p_mix * s.odds >= th) & (s.odds <= cap)]
                if len(b_) == 0:
                    continue
                ret = (b_.won * b_.odds).values
                rng = np.random.default_rng(0)
                rids = b_.rid.values
                ur, inv_ = np.unique(rids, return_inverse=True)
                per = np.bincount(inv_, ret), np.bincount(inv_)
                bs = []
                for _ in range(1000):
                    k = rng.integers(0, len(ur), len(ur))
                    bs.append(per[0][k].sum() / per[1][k].sum())
                lo, hi = np.percentile(bs, [2.5, 97.5])
                print(f"  {th:>10.1f}  {cap:>9}  {len(b_):>5} {int(b_.won.sum()):>5}  {ret.mean():.3f}  ({lo:.2f}〜{hi:.2f})")
        by = s.groupby("track").apply(lambda g: pd.Series({
            "R": g.rid.nunique(),
            "AI": race_ll(g.p_ai.values, g.won.values, g.rid),
            "市場": race_ll(g.p_mkt.values, g.won.values, g.rid),
            "混合": race_ll(g.p_mix.values, g.won.values, g.rid)}), include_groups=False)
        print(by.round(4).to_string())

    out = ROOT / "data" / "nar" / "bt.pkl"
    t[["rid", "track", "date", "umaban", "won", "odds", "p_ai", "p_mkt", "p_mix", "ninki"]].to_pickle(out)
    (ROOT / "models").mkdir(exist_ok=True)
    model.save_model(str(ROOT / "models" / "nar_win_v1.txt"), num_iteration=model.best_iteration)


if __name__ == "__main__":
    main()
