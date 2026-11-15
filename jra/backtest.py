"""中央競馬: ベンター方式の2段モデルを作って、単勝・複勝の期待値買いを検証する。

1段目: レース前の情報だけで1着確率を出すAI(LightGBM → レース内で正規化 → 自信補正)。
2段目: AIの確率と市場(単勝オッズ)の確率を log で足し合わせる(重みは別期間で決める)。
       ベンターは「AI単独より、市場と混ぜたほうがずっと当たる」ことを示した。
期間は日付順に 学習 60% / 補正 10% / 混合の重み 15% / 本番検証 15%(本番はどこにも使わない)。
オッズは確定オッズなので、実際に買える締切前より少し良く見える点に注意。

使い方: python jra/backtest.py
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


def norm(p, rid):
    return p / pd.Series(p).groupby(np.asarray(rid)).transform("sum").values


def race_ll(p, won):
    return float(-np.log(np.clip(p[won == 1], 1e-9, 1)).mean())


def harville_top(q, k):
    """1着確率 q から k 着以内に入る確率(Harville式)。"""
    n = len(q)
    out = np.zeros(n)
    q = np.asarray(q, float)

    def rec(rem, used, prob, depth):
        if depth == k:
            return
        s = 1 - q[list(used)].sum() if used else 1.0
        for i in rem:
            pi = prob * q[i] / max(s, 1e-9)
            out[i] += pi
            rec([j for j in rem if j != i], used | {i}, pi, depth + 1)

    if n <= 18 and k <= 3:
        rec(list(range(n)), set(), 1.0, 0)
    return out


def boot(ret, rids, n=1000):
    ur, inv = np.unique(rids, return_inverse=True)
    s, c = np.bincount(inv, ret), np.bincount(inv)
    rng = np.random.default_rng(0)
    bs = [s[k].sum() / c[k].sum() for k in (rng.integers(0, len(ur), len(ur)) for _ in range(n))]
    return np.percentile(bs, [2.5, 97.5])


def report(name, s, p_col, odds_col, pay):
    print(f"  {name}: 期待値の下限  点数  的中  回収率  (95%区間)")
    for th in (1.0, 1.05, 1.1, 1.2, 1.3):
        b = s[s[p_col] * s[odds_col] >= th]
        if len(b) < 5:
            continue
        ret = pay(b) / 100
        lo, hi = boot(ret, b.rid.values)
        print(f"     {th:>5.2f}  {len(b):>5} {int((ret > 0).sum()):>5}  {ret.mean():.3f}  ({lo:.2f}〜{hi:.2f})")


def main():
    d0 = F.load()
    days = np.sort(d0["date"].unique())
    cut = [days[int(len(days) * f)] for f in (0.6, 0.7, 0.85)]
    d = F.dataset(until=str(pd.Timestamp(cut[0]).date()))
    d = d[d["ok"]].copy()
    d = d[d.groupby("rid")["won"].transform("sum") == 1]
    d = d[d["odds"] > 0]
    d["n_horses"] = d.groupby("rid")["umaban"].transform("count")
    tr, va = d["date"] < cut[0], (d["date"] >= cut[0]) & (d["date"] < cut[1])
    mx, te = (d["date"] >= cut[1]) & (d["date"] < cut[2]), d["date"] >= cut[2]
    for nm, m in [("学習", tr), ("補正", va), ("混合", mx), ("本番", te)]:
        s = d[m]
        print(f"{nm}: {s.date.min():%Y-%m-%d}〜{s.date.max():%Y-%m-%d} {s.rid.nunique()}R")

    X = d[F.FEATURES]
    params = dict(objective="binary", learning_rate=0.03, num_leaves=31, min_data_in_leaf=80,
                  feature_fraction=0.7, bagging_fraction=0.8, bagging_freq=1, lambda_l2=2.0, verbose=-1)
    model = lgb.train(params, lgb.Dataset(X[tr], d.loc[tr, "won"]), 3000,
                      valid_sets=[lgb.Dataset(X[va], d.loc[va, "won"])],
                      callbacks=[lgb.early_stopping(100, verbose=False)])
    d["p0"] = norm(model.predict(X, num_iteration=model.best_iteration), d["rid"])
    v = d[va]
    alpha = min(np.arange(0.5, 2.01, 0.05), key=lambda a: race_ll(norm(v.p0.values ** a, v.rid), v.won.values))
    d["p_ai"] = norm(d["p0"].values ** alpha, d["rid"])
    imp = pd.Series(model.feature_importance("gain"), F.FEATURES).sort_values(ascending=False)
    print(f"木 {model.best_iteration} / 自信補正 {alpha:.2f} / 効く特徴量: {', '.join(imp.index[:10])}")

    inv = 1 / d["odds"]
    d["p_mkt"] = inv / inv.groupby(d["rid"]).transform("sum")

    def mix(df, a, b):
        z = a * np.log(np.clip(df.p_ai.values, 1e-6, 1)) + b * np.log(df.p_mkt.values)
        return norm(np.exp(z), df["rid"])

    f = d[mx]
    a, b = minimize(lambda w: race_ll(mix(f, *w), f.won.values), [0.3, 0.9], method="Nelder-Mead").x
    d["p_mix"] = mix(d, a, b)
    print(f"混合の重み AI={a:.3f} 市場={b:.3f}  (AIが0に近いほど、AIは市場に何も足せていない)")

    # 複勝: 3着内確率(7頭以下は2着内)
    for col in ("p_mkt", "p_mix"):
        out = np.zeros(len(d))
        for rid, idx in d.groupby("rid").indices.items():
            k = 2 if len(idx) <= 7 else 3
            out[idx] = harville_top(d[col].values[idx], k)
        d[col + "_top"] = out
    d["fuku_pay"] = d["fuku_pay"].fillna(0)

    for nm, m in [("混合を決めた期間", mx), ("本番検証", te)]:
        s = d[m]
        print(f"\n[{nm}] {s.rid.nunique()}R 対数損失 AI {race_ll(s.p_ai.values, s.won.values):.4f} / "
              f"市場 {race_ll(s.p_mkt.values, s.won.values):.4f} / 混合 {race_ll(s.p_mix.values, s.won.values):.4f}")
        report("単勝(混合)", s, "p_mix", "odds", lambda b: b.won.values * b.odds.values * 100)
        report("複勝(市場だけ, いまのアプリ)", s, "p_mkt_top", "fuku_min", lambda b: b.fuku_pay.values)
        report("複勝(混合)", s, "p_mix_top", "fuku_min", lambda b: b.fuku_pay.values)

    d[["rid", "venue", "date", "umaban", "won", "odds", "fuku_min", "fuku_pay",
       "p_ai", "p_mkt", "p_mix", "p_mkt_top", "p_mix_top"]].to_pickle(ROOT / "data" / "jra" / "bt.pkl")
    (ROOT / "models").mkdir(exist_ok=True)
    model.save_model(str(ROOT / "models" / "jra_win_v1.txt"), num_iteration=model.best_iteration)


if __name__ == "__main__":
    main()
