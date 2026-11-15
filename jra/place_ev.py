"""中央競馬: 複勝の期待値をきちんと出す(ハウシュ=ジエンバの「Dr.Z方式」を細かくしたもの)。

いまのアプリは「Harville式の3着内確率 × 複勝オッズの下限」で、下の2つの点が粗い。
  1. Harville式は人気馬の2・3着を多めに、人気薄を少なめに見積もるクセが知られている。
     → 2着・3着の確率を q^λ で割り引く(ヘネリー/スターン型)。λ は過去データで決める。
  2. 複勝の払戻は「一緒に3着内に来た馬」で変わる(人気馬と来ると安い)。下限だけ見ると期待値を低く見すぎる。
     → 複勝オッズの下限・上限から各馬の売れ方(票数の割合)を逆算し、
        3着内の組み合わせごとの払戻を計算して、確率で重みづけした「本当の期待払戻」を出す。
JRA の複勝(8頭以上): 払戻率80%。払戻 = 1 + (0.8 - 3着内3頭の票の合計) / (3 × その馬の票)。
7頭以下は2着まで、2で割る。

使い方: python jra/place_ev.py   (data/jra/runs.pkl で λ の決定と回収率の比較)
"""
import itertools
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

ROOT = Path(__file__).resolve().parent.parent
TAKE = 0.8  # 複勝の払戻率


def orders(q: np.ndarray, k: int, lam: float = 1.0):
    """上位 k 頭の並び(順番あり)と、その確率。2着以降は q^lam で選ぶ。"""
    n = len(q)
    ql = q ** lam
    idx = np.array(list(itertools.permutations(range(n), k)))
    p = q[idx[:, 0]].copy()
    used = ql[idx[:, 0]].copy()
    tot = ql.sum()
    for j in range(1, k):
        p *= ql[idx[:, j]] / (tot - used)
        used += ql[idx[:, j]]
    return idx, p


def shares(fmin: np.ndarray, fmax: np.ndarray, k: int) -> np.ndarray:
    """複勝オッズの下限・上限から、各馬の票の割合 x を逆算する(合計1)。

    下限 = いちばん売れている k-1 頭と来た時、上限 = いちばん売れていない k-1 頭と来た時。
    全馬の下限・上限に最もよく合う x を、対数のずれの二乗和が最小になるように探す。
    """
    from scipy.optimize import least_squares

    n = len(fmin)
    lo, hi = np.log(np.maximum(fmin - 1, 0.05)), np.log(np.maximum(fmax - 1, 0.05))

    def pred(z):
        x = np.exp(z) / np.exp(z).sum()
        out_lo, out_hi = np.empty(n), np.empty(n)
        for i in range(n):
            o = np.delete(x, i)
            so = np.sort(o)
            mn = (TAKE - x[i] - so[-(k - 1):].sum()) / (k * x[i])
            mx = (TAKE - x[i] - so[: k - 1].sum()) / (k * x[i])
            out_lo[i], out_hi[i] = mn, mx
        return np.log(np.maximum(out_lo, 0.05)), np.log(np.maximum(out_hi, 0.05))

    def res(z):
        a, b = pred(z)
        w = (fmin > 1.05).astype(float) + 0.2  # 1.0〜1.1倍の元返し付近は当てにしない
        return np.concatenate([(a - lo) * w, (b - hi) * w])

    z0 = -np.log(np.maximum(fmin + fmax - 2, 0.05))
    z0 = np.clip(z0 - z0.mean(), -12, 4)
    z = least_squares(res, z0, bounds=(-15, 6), method="trf").x
    return np.exp(z) / np.exp(z).sum()


def place_ev(q: np.ndarray, fmin: np.ndarray, fmax: np.ndarray, lam: float = 1.0):
    """各馬の (3着内確率, 期待払戻倍率, 下限だけの期待値) を返す。"""
    n = len(q)
    k = 2 if n <= 7 else 3
    q = q / q.sum()
    idx, p = orders(q, k, lam)
    x = shares(fmin, fmax, k)
    prob = np.zeros(n)
    ev = np.zeros(n)
    sx = x[idx].sum(1)
    for j in range(k):
        h = idx[:, j]
        pay = 1 + (TAKE - sx) / (k * x[h])
        pay = np.floor(pay * 10) / 10           # 10円未満切り捨て
        pay = np.clip(pay, 1.0, None)
        np.add.at(prob, h, p)
        np.add.at(ev, h, p * pay)
    return prob, ev, prob * fmin


def fit_lambda(d: pd.DataFrame) -> float:
    """実際の着順(1〜3着)の尤度が最大になる λ。"""
    races = []
    for _, g in d.groupby("rid"):
        g = g[g.odds > 0]
        top = g.sort_values("finish")
        if len(g) < 8 or not (top.finish.values[:3] == [1, 2, 3]).all():
            continue
        q = (1 / g.odds.values)
        q /= q.sum()
        pos = {u: i for i, u in enumerate(g.umaban.values)}
        races.append((q, [pos[u] for u in top.umaban.values[:3]]))

    def nll(lam):
        s = 0.0
        for q, (a, b, c) in races:
            ql = q ** lam
            t = ql.sum()
            s -= np.log(ql[b] / (t - ql[a])) + np.log(ql[c] / (t - ql[a] - ql[b]))
        return s

    return minimize_scalar(nll, bounds=(0.4, 1.5), method="bounded").x


def main():
    d = pd.read_pickle(ROOT / "data" / "jra" / "runs.pkl")
    d = d[d.status.fillna("") == ""]
    d = d[d.groupby("rid")["odds"].transform(lambda s: (s > 0).all())]
    days = np.sort(d.date.unique())
    cut = days[len(days) // 2]
    lam = fit_lambda(d[d.date < cut])
    print(f"λ = {lam:.3f}  (1 なら Harville のまま。1 より小さいと、人気薄の2・3着を多めに見る)")

    rows = []
    for rid, g in d.groupby("rid"):
        if len(g) < 5 or g.fuku_min.isna().any():
            continue
        q = 1 / g.odds.values
        fmin, fmax = g.fuku_min.values.astype(float), g.fuku_max.values.astype(float)
        p1, ev1, evmin1 = place_ev(q, fmin, fmax, 1.0)
        p2, ev2, evmin2 = place_ev(q, fmin, fmax, lam)
        k = 2 if len(g) <= 7 else 3
        for i, r in enumerate(g.itertuples()):
            rows.append(dict(rid=rid, date=r.date, odds=r.odds, hit=float(r.finish <= k), pay=r.fuku_pay or 0,
                             p_h=p1[i], p_s=p2[i], ev_min=evmin1[i], ev_exact=ev1[i], ev_s=ev2[i]))
    x = pd.DataFrame(rows)
    # 3. 3着内確率の補正: 前半の期間で「Harvilleの確率・割引の確率・オッズ」から実際の3着内率を当てる
    from sklearn.linear_model import LogisticRegression

    def feats(df):
        lg = lambda v: np.log(np.clip(v, 1e-4, 1 - 1e-4) / (1 - np.clip(v, 1e-4, 1 - 1e-4)))
        return np.c_[lg(df.p_h), lg(df.p_s), np.log(df.odds)]

    fit = x[x.date < cut]
    lr = LogisticRegression(C=1.0).fit(feats(fit), fit.hit)
    x["p_c"] = lr.predict_proba(feats(x))[:, 1]
    x["ev_c"] = x.ev_exact * x.p_c / x.p_h.clip(lower=1e-6)  # 来た時の払戻の平均はそのまま、確率だけ補正
    x["ev_cmin"] = x.p_c * x.ev_min / x.p_h.clip(lower=1e-6)  # = 補正確率 × 下限
    x = x[x.date >= cut].copy()
    print(f"検証 {x.rid.nunique()}R {len(x)}頭(後半の期間)")
    print("3着内確率の当てはまり(平均の確率と実際の率, オッズ帯別)")
    x["band"] = pd.cut(x.odds, [0, 3, 6, 12, 25, 60, 999])
    print(x.groupby("band", observed=True)[["p_h", "p_s", "p_c", "hit"]].mean().round(3).to_string())
    print("\n買い方            期待値の下限  点数  的中  回収率")
    for nm, c in [("いま(下限×Harville)", "ev_min"), ("期待払戻(Harville)", "ev_exact"),
                  ("期待払戻(割引λ)", "ev_s"), ("下限×補正確率", "ev_cmin"), ("期待払戻×補正確率", "ev_c")]:
        for th in (1.0, 1.05, 1.1):
            b = x[x[c] >= th]
            if len(b):
                print(f"  {nm:<18} {th:>5.2f} {len(b):>5} {int(b.hit.sum()):>5}  {b.pay.sum() / len(b) / 100:.3f}")


if __name__ == "__main__":
    main()
