"""中央競馬: 「人の調子」と「得意な場」で複勝の回収率が上がる条件を掘る。

調べるもの:
  1. 騎手・調教師の最近の調子(直近N走 N=3,5,10,20 / 直近7・14・28日の3着内率・複勝回収率・市場超過)
  2. 人×場(騎手×競馬場、調教師×競馬場、騎手×芝ダ、調教師×距離帯)
  3. 騎手×調教師コンビ、乗り替わりの種類(同じ騎手/上位騎手へ/下位騎手へ)
  4. 同じ日の前のレースの結果(厩舎・騎手が今日すでに好走しているか)
  5. 馬の前走(着順・上がり3F順位・通過順)、同じレースに同じ厩舎の2頭出し

未来の情報を混ぜないためのルール:
  - 人・馬の成績は「そのレースの発走時刻より20分以上前に終わったレース」だけで数える
    (同じ日の前のレースは使ってよい。20分は結果確定までの余裕)。
  - 「上位騎手/下位騎手」も、そのレースより前の成績で比べる。

回収率の計算は jra/theories.py と同じ: 取消・除外は100円返還、7頭以下は2着まで、odds>0 の馬だけ。

だまされないための見方:
  - 試した条件の数を数え、Bonferroni と BH(FDR) の両方で補正した結果を出す。
  - 期間を前半・後半(開催日の中央値で区切る)に分けて、両方で100%超えか見る。
  - 95%区間はレース単位のブートストラップ。50頭未満は参考扱い。
  - 「同じ人気の馬の平均回収率」を基準にして差を見る(市場に織り込み済みかどうか)。

使い方: python jra/mine_people.py   → data/jra/mine_people.csv
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "jra"))
from theories import harville_top  # noqa: E402

GAP = 20  # 結果が分かるまでの余裕(分)
NB = 2000  # ブートストラップ回数


# ---------------------------------------------------------------- 読み込み
def load():
    d = pd.read_pickle(ROOT / "data" / "jra" / "runs.pkl")
    d["date"] = pd.to_datetime(d["date"])
    d = d.sort_values(["date", "post_time", "rid", "umaban"]).reset_index(drop=True)
    d["ok"] = d.status.fillna("").eq("")
    d["n"] = d.groupby("rid")["umaban"].transform("count")
    d["k"] = np.where(d.n <= 7, 2, 3)
    d["hit"] = (d.finish <= d.k) & d.ok
    d["pay"] = d.fuku_pay.fillna(0).where(d.ok, 100)  # 取消・除外は返還
    d = d[d.odds > 0].reset_index(drop=True)
    # 発走時刻(分単位の通し時刻)
    pt = d.post_time.astype(int)
    d["t"] = (d.date - pd.Timestamp("2000-01-01")).dt.days * 1440 + (pt // 100) * 60 + pt % 100
    # 市場から見た3着内(7頭以下は2着内)確率 = 単勝オッズ → Harville
    d["p3"] = np.nan
    for rid, idx in d.groupby("rid").indices.items():
        q = 1 / d.odds.values[idx]
        q /= q.sum()
        d.loc[d.index[idx], "p3"] = harville_top(q, int(d.k.values[idx[0]]))
    d["ex"] = d.hit.astype(float) - d.p3  # 市場の予想より何回多く3着内に来たか
    d["distband"] = pd.cut(d.dist, [0, 1400, 1800, 2200, 9999], labels=["短", "マイル", "中", "長"]).astype(str)
    d["day"] = d.date.dt.strftime("%Y%m%d")
    d["nk"] = d.ninki.clip(upper=12)
    return d


# ---------------------------------------------------------------- 過去成績の特徴量
def hist(d, keys, name, lastN=(), days=()):
    """keys ごとに、発走 GAP 分前までに終わった完走(ok)のレースだけで成績を数える。
    出す列: {name}_n / _t3 / _roi / _ex(全期間)、_nN{N}・_t3N{N}・_roiN{N}・_exN{N}、_nD{D}・_t3D{D}・_exD{D}"""
    out = {f"{name}_{s}": np.full(len(d), np.nan) for s in ["n", "t3", "roi", "ex"]}
    for N in lastN:
        for s in ["n", "t3", "roi", "ex"]:
            out[f"{name}_{s}N{N}"] = np.full(len(d), np.nan)
    for D in days:
        for s in ["n", "t3", "ex"]:
            out[f"{name}_{s}D{D}"] = np.full(len(d), np.nan)
    hit = d.hit.values.astype(float)
    pay = d.pay.values.astype(float)
    ex = d.ex.values.astype(float)
    ok = d.ok.values
    tt = d.t.values
    for _, idx in d.groupby(keys, sort=False).indices.items():
        idx = np.sort(idx)
        h = idx[ok[idx]]  # 履歴に使うのは完走したレースだけ
        ht = tt[h]
        ch = np.concatenate([[0], np.cumsum(hit[h])])
        cp = np.concatenate([[0], np.cumsum(pay[h])])
        ce = np.concatenate([[0], np.cumsum(ex[h])])
        p = np.searchsorted(ht + GAP, tt[idx], side="right")  # 使ってよい履歴の終わり
        n = p.astype(float)
        with np.errstate(invalid="ignore", divide="ignore"):
            out[f"{name}_n"][idx] = n
            out[f"{name}_t3"][idx] = np.where(n > 0, ch[p] / n, np.nan)
            out[f"{name}_roi"][idx] = np.where(n > 0, cp[p] / n / 100, np.nan)
            out[f"{name}_ex"][idx] = np.where(n > 0, ce[p] / n, np.nan)
            for N in lastN:
                s = np.maximum(p - N, 0)
                m = (p - s).astype(float)
                out[f"{name}_nN{N}"][idx] = m
                out[f"{name}_t3N{N}"][idx] = np.where(m > 0, (ch[p] - ch[s]) / m, np.nan)
                out[f"{name}_roiN{N}"][idx] = np.where(m > 0, (cp[p] - cp[s]) / m / 100, np.nan)
                out[f"{name}_exN{N}"][idx] = np.where(m > 0, (ce[p] - ce[s]) / m, np.nan)
            for D in days:
                s = np.minimum(np.searchsorted(ht, tt[idx] - D * 1440, side="left"), p)
                m = (p - s).astype(float)
                out[f"{name}_nD{D}"][idx] = m
                out[f"{name}_t3D{D}"][idx] = np.where(m > 0, (ch[p] - ch[s]) / m, np.nan)
                out[f"{name}_exD{D}"][idx] = np.where(m > 0, (ce[p] - ce[s]) / m, np.nan)
    for k, v in out.items():
        d[k] = v


def features(d):
    NS, DS = (3, 5, 10, 20), (7, 14, 28)
    hist(d, ["jockey_id"], "J", NS, DS)
    hist(d, ["trainer_id"], "T", NS, DS)
    hist(d, ["jockey_id", "venue"], "JV")
    hist(d, ["trainer_id", "venue"], "TV")
    hist(d, ["jockey_id", "surface"], "JS")
    hist(d, ["trainer_id", "distband"], "TB")
    hist(d, ["jockey_id", "trainer_id"], "C", (5,))
    hist(d, ["trainer_id", "day"], "Td")  # 今日のこれまで
    hist(d, ["jockey_id", "day"], "Jd")
    # 馬の前走(手元のデータにある分)。前走の上がり3F順位はそのレース内での順位
    d["l3rank"] = d.groupby("rid").last3f.rank(method="min")
    g = d.groupby("horse_id")
    for c in ["finish", "ninki", "l3rank", "corner_last", "jockey_id", "t", "n"]:
        d[f"prev_{c}"] = g[c].shift(1)
    d["prev_ok"] = g["ok"].shift(1)
    d["fin3avg"] = g["finish"].transform(lambda s: s.shift(1).rolling(3, min_periods=3).mean())
    # 前走の騎手の「今の時点での」3着内率 → 上位/下位騎手への乗り替わり
    jt3 = {}  # (jockey, row) は重いので、今回の行の時点での前騎手成績を履歴から引く
    hj = d[d.ok].sort_values("t")
    by_j = {j: (x.t.values, np.cumsum(x.hit.values)) for j, x in hj.groupby("jockey_id")}

    def rate_at(j, t):
        if j not in by_j or pd.isna(j):
            return np.nan
        ts, cs = by_j[j]
        p = np.searchsorted(ts + GAP, t, side="right")
        return cs[p - 1] / p if p >= 10 else np.nan  # 10走未満は不明扱い

    d["prevJ_t3"] = [rate_at(j, t) for j, t in zip(d.prev_jockey_id, d.t)]
    d["curJ_t3"] = np.where(d.J_n >= 10, d.J_t3, np.nan)
    d["jdiff"] = d.curJ_t3 - d.prevJ_t3
    # 同じレースに同じ厩舎が何頭いるか、その中で何番目の人気か
    d["tr_cnt"] = d.groupby(["rid", "trainer_id"]).umaban.transform("count")
    d["tr_rank"] = d.groupby(["rid", "trainer_id"]).ninki.rank(method="first")


# ---------------------------------------------------------------- 条件
def conditions(d):
    C = []  # (系統, 名前, マスク)
    th = {3: 2 / 3, 5: 0.6, 10: 0.5, 20: 0.45}
    for P, nm in [("J", "騎手"), ("T", "調教師")]:
        for N in (3, 5, 10, 20):
            full = d[f"{P}_nN{N}"].eq(N)
            C.append(("1.調子", f"{nm} 直近{N}走 3着内率≧{th[N]:.0%}", full & d[f"{P}_t3N{N}"].ge(th[N] - 1e-9)))
            C.append(("1.調子", f"{nm} 直近{N}走 複勝回収率≧120%", full & d[f"{P}_roiN{N}"].ge(1.2)))
            C.append(("1.調子", f"{nm} 直近{N}走 市場超過≧+0.15/走", full & d[f"{P}_exN{N}"].ge(0.15)))
            C.append(("1.調子", f"{nm} 直近{N}走 不調(3着内率≦10%)", full & d[f"{P}_t3N{N}"].le(0.1)))
        for D in (7, 14, 28):
            nn = d[f"{P}_nD{D}"].ge(3)
            C.append(("1.調子", f"{nm} 直近{D}日 3着内率≧50%(3走以上)", nn & d[f"{P}_t3D{D}"].ge(0.5)))
            C.append(("1.調子", f"{nm} 直近{D}日 市場超過≧+0.15/走(3走以上)", nn & d[f"{P}_exD{D}"].ge(0.15)))
            C.append(("1.調子", f"{nm} 直近{D}日 0回3着内(3走以上)", nn & d[f"{P}_t3D{D}"].eq(0)))
    for P, nm in [("JV", "騎手×競馬場"), ("TV", "調教師×競馬場"), ("JS", "騎手×芝ダ"), ("TB", "調教師×距離帯")]:
        base = P[0]
        n5 = d[f"{P}_n"].ge(5)
        C.append(("2.人×場", f"{nm} 3着内率≧40%(5走以上)", n5 & d[f"{P}_t3"].ge(0.4)))
        C.append(("2.人×場", f"{nm} 市場超過≧+0.10/走(5走以上)", n5 & d[f"{P}_ex"].ge(0.10)))
        C.append(("2.人×場", f"{nm} 本人全体より3着内率+15pt以上(5走以上)",
                  n5 & (d[f"{P}_t3"] - d[f"{base}_t3"]).ge(0.15)))
        C.append(("2.人×場", f"{nm} 0回3着内(5走以上)", n5 & d[f"{P}_t3"].eq(0)))
    C.append(("3.コンビ", "騎手×調教師 3着内率≧50%(3回以上)", d.C_n.ge(3) & d.C_t3.ge(0.5)))
    C.append(("3.コンビ", "騎手×調教師 市場超過≧+0.15/回(3回以上)", d.C_n.ge(3) & d.C_ex.ge(0.15)))
    C.append(("3.コンビ", "騎手×調教師 0回3着内(3回以上)", d.C_n.ge(3) & d.C_t3.eq(0)))
    C.append(("3.コンビ", "騎手×調教師 直近5回 3着内率≧60%", d.C_nN5.eq(5) & d.C_t3N5.ge(0.6)))
    C.append(("3.コンビ", "騎手×調教師 初コンビ(手元データで)", d.C_n.eq(0)))
    has_prev = d.prev_jockey_id.notna()
    C.append(("3.乗り替わり", "前走と同じ騎手", has_prev & d.jockey_id.eq(d.prev_jockey_id)))
    C.append(("3.乗り替わり", "乗り替わり(何でも)", has_prev & d.jockey_id.ne(d.prev_jockey_id)))
    C.append(("3.乗り替わり", "上位騎手へ(3着内率+10pt以上)", has_prev & d.jockey_id.ne(d.prev_jockey_id) & d.jdiff.ge(0.1)))
    C.append(("3.乗り替わり", "下位騎手へ(3着内率-10pt以上)", has_prev & d.jockey_id.ne(d.prev_jockey_id) & d.jdiff.le(-0.1)))
    C.append(("4.今日", "厩舎が今日すでに3着内あり", d.Td_n.ge(1) & d.Td_t3.gt(0)))
    C.append(("4.今日", "厩舎が今日すでに市場超過プラス", d.Td_n.ge(1) & d.Td_ex.gt(0)))
    C.append(("4.今日", "厩舎が今日走らせて0回3着内", d.Td_n.ge(1) & d.Td_t3.eq(0)))
    C.append(("4.今日", "騎手が今日すでに2回以上3着内", (d.Jd_t3 * d.Jd_n).ge(2)))
    C.append(("4.今日", "騎手が今日3回以上乗って0回3着内", d.Jd_n.ge(3) & d.Jd_t3.eq(0)))
    C.append(("4.今日", "騎手が今日 市場超過≧+0.2/走(2走以上)", d.Jd_n.ge(2) & d.Jd_ex.ge(0.2)))
    pv = d.prev_ok.eq(True)
    C.append(("5.馬", "前走1〜3着", pv & d.prev_finish.le(3)))
    C.append(("5.馬", "前走 人気5以内で10着以下", pv & d.prev_ninki.le(5) & d.prev_finish.ge(10)))
    C.append(("5.馬", "前走 人気より3着以上よい着順", pv & (d.prev_ninki - d.prev_finish).ge(3)))
    C.append(("5.馬", "前走 上がり3F 2位以内", pv & d.prev_l3rank.le(2)))
    C.append(("5.馬", "前走 4角8番手以下から5着以内(差して届かず)", pv & d.prev_corner_last.ge(8) & d.prev_finish.le(5)))
    C.append(("5.馬", "前走 4角3番手以内で6着以下(先行して失速)", pv & d.prev_corner_last.le(3) & d.prev_finish.ge(6)))
    C.append(("5.馬", "直近3走の平均着順≦4", d.fin3avg.le(4)))
    C.append(("5.2頭出し", "同じ厩舎の2頭以上出し(全員)", d.tr_cnt.ge(2)))
    C.append(("5.2頭出し", "2頭出しの人気上位の方", d.tr_cnt.ge(2) & d.tr_rank.eq(1)))
    C.append(("5.2頭出し", "2頭出しの人気下位の方", d.tr_cnt.ge(2) & d.tr_rank.ge(2)))
    C.append(("組合せ", "騎手も調教師も直近10走 3着内率≧50%",
              d.J_nN10.eq(10) & d.J_t3N10.ge(0.5) & d.T_nN10.eq(10) & d.T_t3N10.ge(0.5)))
    C.append(("組合せ", "騎手×競馬場と調教師×競馬場の両方 市場超過≧+0.10(5走以上)",
              d.JV_n.ge(5) & d.JV_ex.ge(0.1) & d.TV_n.ge(5) & d.TV_ex.ge(0.1)))
    bands = [("1〜3番人気", d.ninki.le(3)), ("4〜6番人気", d.ninki.between(4, 6)), ("7番人気以下", d.ninki.ge(7)),
             ("全人気", d.ninki.notna())]
    out = []
    for fam, nm, m in C:
        for bn, bm in bands:
            out.append((fam, nm, bn, (m & bm).fillna(False).values))
    return out


# ---------------------------------------------------------------- 評価
def evaluate(d, conds):
    days = np.sort(d.date.unique())
    cut = days[len(days) // 2]
    h1 = (d.date < cut).values
    # 基準 = 同じ人気(1〜11、12以下はまとめる)の馬の全体平均回収率
    d["base"] = d.groupby("nk").pay.transform("mean")
    pay, base, rid = d.pay.values / 100, d.base.values / 100, d.rid.values
    rng = np.random.default_rng(0)
    rows = []
    for fam, nm, bn, m in conds:
        n = int(m.sum())
        r = dict(family=fam, name=nm, band=bn, n=n, races=0, hits=0, roi=np.nan, lo=np.nan, hi=np.nan,
                 n1=int((m & h1).sum()), n2=int((m & ~h1).sum()), r1=np.nan, r2=np.nan, base=np.nan, diff=np.nan,
                 dlo=np.nan, dhi=np.nan, p100=np.nan, pbase=np.nan)
        if n >= 10:
            ur, inv = np.unique(rid[m], return_inverse=True)
            s = np.bincount(inv, pay[m])
            sb = np.bincount(inv, base[m])
            c = np.bincount(inv).astype(float)
            k = rng.integers(0, len(ur), (NB, len(ur)))
            cc = c[k].sum(1)
            bs = s[k].sum(1) / cc
            bd = (s[k].sum(1) - sb[k].sum(1)) / cc
            r.update(races=len(ur), hits=int(d.hit.values[m].sum()), roi=pay[m].mean(),
                     lo=np.percentile(bs, 2.5), hi=np.percentile(bs, 97.5),
                     r1=pay[m & h1].mean() if r["n1"] else np.nan, r2=pay[m & ~h1].mean() if r["n2"] else np.nan,
                     base=base[m].mean(), diff=pay[m].mean() - base[m].mean(),
                     dlo=np.percentile(bd, 2.5), dhi=np.percentile(bd, 97.5),
                     p100=(np.sum(bs <= 1.0) + 1) / (NB + 1), pbase=(np.sum(bd <= 0) + 1) / (NB + 1))
        rows.append(r)
    R = pd.DataFrame(rows)
    # 多重検定の補正(10頭以上で計算できたものだけを「試した数」に数える)
    t = R.p100.notna()
    K = int(t.sum())
    for col in ["p100", "pbase"]:
        p = R.loc[t, col].values
        o = np.argsort(p)
        q = p[o] * K / np.arange(1, K + 1)
        q = np.minimum.accumulate(q[::-1])[::-1]
        qq = np.empty(K)
        qq[o] = np.minimum(q, 1)
        R.loc[t, f"q_{col}"] = qq
        R.loc[t, f"bonf_{col}"] = np.minimum(p * K, 1)
    R["both_halves"] = (R.r1 > 1) & (R.r2 > 1)
    R["ref_only"] = R.n < 50
    return R, cut, K


def main():
    d = load()
    features(d)
    conds = conditions(d)
    R, cut, K = evaluate(d, conds)
    R.to_csv(ROOT / "data" / "jra" / "mine_people.csv", index=False)
    print(f"{d.rid.nunique()}レース {len(d)}頭  前半〜{pd.Timestamp(cut):%Y-%m-%d}未満 / 後半  全体回収率 {d.pay.mean() / 100:.3f}")
    for bn, bm in [("1〜3", d.ninki.le(3)), ("4〜6", d.ninki.between(4, 6)), ("7〜", d.ninki.ge(7))]:
        print(f"  基準 {bn}番人気: {d[bm].pay.mean() / 100:.3f} ({bm.sum()}頭)")
    print(f"条件 {len(conds)}個(うち10頭以上で計算 {K}個)\n")
    pd.set_option("display.width", 250, "display.max_colwidth", 60, "display.max_rows", 200)
    cols = ["family", "name", "band", "n", "roi", "lo", "hi", "r1", "r2", "base", "diff", "pbase", "q_pbase", "bonf_p100"]
    ok = R[(R.n >= 50)]
    print("=== 50頭以上 回収率の高い順 上位25 ===")
    print(ok.sort_values("roi", ascending=False)[cols].head(25).round(3).to_string(index=False))
    print("\n=== 50頭以上 基準との差の大きい順 上位25 ===")
    print(ok.sort_values("diff", ascending=False)[cols].head(25).round(3).to_string(index=False))
    print("\n=== 前半・後半とも100%超え(50頭以上) ===")
    print(ok[ok.both_halves].sort_values("diff", ascending=False)[cols].round(3).to_string(index=False))
    print(f"\nFDR q<0.1 (基準比): {(R.q_pbase < 0.1).sum()}個 / Bonferroni p<0.05 (100%超): {(R.bonf_p100 < 0.05).sum()}個")


if __name__ == "__main__":
    main()
