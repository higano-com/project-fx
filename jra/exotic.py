"""中央競馬: 「来ない馬を消して、残った馬で連系の馬券を組む」作戦の検証。

組み合わせのオッズは持っていないが、払戻(当たった組とその金額)は全券種あるので、
「買った点数 × 100円」と「当たった組の払戻」を比べれば、作戦の回収率は正しく出せる。

消し方(レース前に分かる情報だけ。確定オッズを使うので、実際は締切5分前オッズで少しずれる):
  - 人気順で上位 m 頭だけ残す
  - 市場の3着内確率(単勝オッズ→Harville式)が p 以上の馬だけ残す
組み方: 馬連・ワイド・馬単・3連複・3連単のボックス、1頭軸の流し、3連単フォーメーション。
レースの選び方: 全レース / 堅いレース(上位 m 頭の単勝支持率の合計が大きい)/ 荒れそうなレース。

使い方: python jra/exotic.py
"""
import gzip
import itertools as it
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parse as P  # noqa: E402
from theories import boot, harville_top  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "data" / "jra" / "html"
KINDS = {"馬連": (2, False), "ワイド": (2, False), "馬単": (2, True), "3連複": (3, False), "3連単": (3, True)}


def races():
    d = pd.read_pickle(ROOT / "data" / "jra" / "runs.pkl")
    d["date"] = pd.to_datetime(d["date"])
    d = d[d.status.fillna("").eq("") & (d.odds > 0) & (d.surface != "障害")]
    files = {f.name.split("_")[0][-20:]: f for f in HTML.glob("*_r.html.gz")}  # 頭に2桁余分な番号が付いた名前もある
    out = []
    for rid, g in d.groupby("rid"):
        f = files.get(rid)
        if f is None or len(g) < 5:
            continue
        pays = {k["kind"]: {ln["num"]: ln["yen"] for ln in k["lines"]} for k in P.refunds(gzip.open(f, "rt", encoding="utf-8").read())}
        g = g.sort_values("odds")
        q = 1 / g.odds.values
        q /= q.sum()
        out.append(dict(rid=rid, date=g.date.iloc[0], n=len(g), no=g.umaban.astype(int).tolist(), q=q,
                        p3=harville_top(q, 3), pays=pays, cls=g.cls.iloc[0], surface=g.surface.iloc[0]))
    return out


def tickets(kind, keep, axis=None, form=None):
    """買い目の一覧(払戻表の書式 "a-b-c" に合わせる。順不同の券種は小さい順)。"""
    r, ordered = KINDS[kind]
    if form:  # 3連単フォーメーション: 1着候補・2着候補・3着候補
        return ["-".join(map(str, t)) for t in it.product(*form) if len(set(t)) == 3]
    combos = it.permutations(keep, r) if ordered else it.combinations(sorted(keep), r)
    out = []
    for t in combos:
        if axis is not None and axis not in t:
            continue
        out.append("-".join(map(str, t)))
    return out


def ret(race, kind, tk):
    pay = race["pays"].get(kind, {})
    return sum(pay.get(t, 0) for t in tk), len(tk) * 100


def evaluate(R, name, f):
    rows = []
    for x in R:
        r = f(x)
        if r is None:
            continue
        got, cost = r
        if cost:
            rows.append((x["rid"], x["date"], got, cost))
    if len(rows) < 20:
        return None
    t = pd.DataFrame(rows, columns=["rid", "date", "got", "cost"])
    roi = t.got.sum() / t.cost.sum()
    days = np.sort(t.date.unique())
    h = t.date < days[len(days) // 2]
    r1, r2 = t[h].got.sum() / t[h].cost.sum(), t[~h].got.sum() / t[~h].cost.sum()
    # レース単位ブートストラップ(払戻/投資の比)
    rng = np.random.default_rng(0)
    bs = [t.got.values[k].sum() / t.cost.values[k].sum() for k in (rng.integers(0, len(t), len(t)) for _ in range(1000))]
    lo, hi = np.percentile(bs, [2.5, 97.5])
    hit = (t.got > 0).mean()
    top = t.got.nlargest(3).sum()
    roi_x3 = (t.got.sum() - top) / t.cost.sum()
    return dict(name=name, races=len(t), pts=t.cost.mean() / 100, hit=hit, roi=roi, lo=lo, hi=hi, r1=r1, r2=r2, roi_x3=roi_x3)


def main():
    R = races()
    print(f"{len(R)}レース(障害を除く)\n")
    # 1) 消しの精度: 人気下位・確率の低い馬は本当に来ないか
    print("消しの精度(消した馬が3着内に来なかったレースの割合 = 残りで3連複が当たる割合)")
    for m in (4, 5, 6, 7, 8):
        ok = np.mean([set(x["pays"].get("3連複", {"": 0}).keys()).pop() in
                      tickets("3連複", x["no"][:m]) if x["pays"].get("3連複") else False for x in R])
        print(f"  人気上位{m}頭だけ残す: {ok:.0%}")
    for p in (0.05, 0.10, 0.15):
        ok, kept = [], []
        for x in R:
            keep = [n for n, pp in zip(x["no"], x["p3"]) if pp >= p]
            kept.append(len(keep))
            w = list(x["pays"].get("3連複", {}).keys())
            ok.append(bool(w) and w[0] in tickets("3連複", keep))
        print(f"  3着内確率{p:.0%}以上だけ残す: {np.mean(ok):.0%}(平均{np.mean(kept):.1f}頭)")

    res = []
    conds = {"全レース": lambda x: True,
             "堅い(上位3頭の支持率≧60%)": lambda x: x["q"][:3].sum() >= 0.60,
             "混戦(上位3頭の支持率<45%)": lambda x: x["q"][:3].sum() < 0.45,
             "1強(1番人気の支持率≧40%)": lambda x: x["q"][0] >= 0.40,
             "少頭数(〜10頭)": lambda x: x["n"] <= 10,
             "多頭数(15頭〜)": lambda x: x["n"] >= 15}
    for cn, c in conds.items():
        for m in (3, 4, 5, 6, 7):
            for kind in KINDS:
                if KINDS[kind][0] > m:
                    continue
                res.append(evaluate(R, f"{cn} | 人気上位{m}頭ボックス | {kind}",
                                    lambda x, m=m, kind=kind: ret(x, kind, tickets(kind, x["no"][:m])) if c(x) else None))
                if m >= 4:  # 1番人気を軸に流す
                    res.append(evaluate(R, f"{cn} | 1番人気軸→2〜{m}番人気 | {kind}",
                                        lambda x, m=m, kind=kind: ret(x, kind, tickets(kind, x["no"][:m], axis=x["no"][0])) if c(x) else None))
        for p in (0.10, 0.15, 0.20):
            for kind in ("ワイド", "3連複", "3連単"):
                def f(x, p=p, kind=kind):
                    keep = [n for n, pp in zip(x["no"], x["p3"]) if pp >= p]
                    return ret(x, kind, tickets(kind, keep)) if c(x) and len(keep) >= KINDS[kind][0] else None
                res.append(evaluate(R, f"{cn} | 3着内確率{p:.0%}以上ボックス | {kind}", f))
        for a, b, cc in [(1, 3, 5), (2, 4, 6), (1, 4, 7), (2, 5, 8), (3, 6, 6)]:
            res.append(evaluate(R, f"{cn} | 3連単フォーメーション 1着{a}頭・2着{b}頭・3着{cc}頭",
                                lambda x, a=a, b=b, cc=cc: ret(x, "3連単", tickets("3連単", None, form=(x["no"][:a], x["no"][:b], x["no"][:cc]))) if c(x) else None))
        # 人気馬を消して中穴だけで組む(本命が買われすぎなら効く)
        for lo_, hi_ in [(2, 6), (2, 7), (3, 8), (4, 9)]:
            for kind in ("ワイド", "馬連", "3連複"):
                res.append(evaluate(R, f"{cn} | 1番人気を消して{lo_}〜{hi_}番人気ボックス | {kind}",
                                    lambda x, a=lo_, b=hi_, kind=kind: ret(x, kind, tickets(kind, x["no"][a - 1:b])) if c(x) else None))
    t = pd.DataFrame([r for r in res if r]).sort_values("roi", ascending=False)
    t.to_csv(ROOT / "data" / "jra" / "exotic.csv", index=False)
    pd.set_option("display.width", 250)
    pd.set_option("display.max_colwidth", 70)
    print(f"\n試した作戦 {len(t)}個。回収率の高い順(上位25)。roi_x3 = 高配当3つを除いた回収率")
    print(t.head(25).to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    both = t[(t.r1 > 1) & (t.r2 > 1)]
    print(f"\n前半・後半とも100%超え: {len(both)}個")
    print(both.to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    print("\n券種ごとの平均回収率(全作戦の平均)")
    t["kind"] = t.name.str.split(" | ").str[-1]
    print(t.groupby("kind").roi.describe()[["count", "mean", "50%", "max"]].to_string(float_format=lambda v: f"{v:.2f}"))


if __name__ == "__main__":
    main()
