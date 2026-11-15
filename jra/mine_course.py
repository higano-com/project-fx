"""中央競馬: 複勝の回収率が上がる「狭い条件」(コース・枠・馬場・開催日・クラス・馬体重など)をデータから掘る。

ユーザーの問い: 「この競馬場はここが強い」「ここだけ見ればいい」という、期待値のある狭い条件はあるか。

回収率の数え方は jra/theories.py の load() と同じ(取消・除外は100円返還、7頭以下は2着まで)。
データは theories.load() で読む(既存ファイルは変更しない)。ネットには一切アクセスしない。

未来の情報は混ぜない:
  - 当日の着順・タイム・通過順(corner_last)・上がりは条件に使わない。
  - 脚質(先行/差し)は「その馬の前走以前の corner_last / 頭数」の平均(手元の runs.pkl にある過去走だけ)で決める。
  - 馬体重・増減・オッズ・人気は発走前に発表される情報なので使ってよい(オッズは確定オッズなので少し甘い)。

だまされないための見方:
  - 試した条件はすべて CSV に残し、件数を数える(多重検定)。
  - 期間を前半・後半に分け、両方で100%を超えるか。
  - 95%区間はレース単位のブートストラップ(同じレースの馬はまとめて引く)。
  - 「同じ人気帯の平均回収率」(基準)との差を見る。差が小さければ、人気帯の効果で説明できる=条件の効果ではない。
  - p値はブートストラップの標準誤差から正規近似で出し、Bonferroni と Benjamini-Hochberg(FDR)で補正する。

使い方: python jra/mine_course.py   → data/jra/mine_course.csv
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import norm

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "jra"))
import theories  # noqa: E402  (load() と同じ数え方を使うため)

B = 2000          # ブートストラップ回数
MIN_N = 50        # これ未満は参考扱い
RNG = np.random.default_rng(0)


# ---------------------------------------------------------------- 特徴量
def prep():
    d = theories.load().copy()
    d["pay"] = d.pay.astype(float)
    # rid = 場2桁・年4桁・回2桁・日2桁・R2桁・日付8桁
    d["kai"] = d.rid.str[6:8].astype(int)
    d["nichi"] = d.rid.str[8:10].astype(int)
    d["vs"] = d.venue + d.surface
    d["course"] = d.venue + d.surface + d.dist.astype(str)
    # 人気帯(基準を作る細かい帯)
    d["pop_fine"] = pd.cut(d.ninki, [0, 1, 2, 3, 5, 7, 9, 12, 99], labels=["1", "2", "3", "4-5", "6-7", "8-9", "10-12", "13+"])
    # 基準 = 同じ人気帯(細)の全体平均の払戻。条件の回収率からこれを引くと「人気帯で説明できない分」
    d["base"] = d.groupby("pop_fine", observed=True).pay.transform("mean")
    # 枠・馬番の位置
    d["wpos"] = np.select([d.waku <= 3, d.waku <= 6], ["内枠1-3", "中枠4-6"], "外枠7-8")
    d["umapos"] = np.select([d.umaban <= 4, d.umaban > d.n - 4], ["馬番1-4", "大外4頭"], "馬番中")
    # 馬場・天候
    d["baba3"] = d.baba.replace({"重": "重・不良", "不良": "重・不良"})
    d["baba2"] = np.where(d.baba == "良", "良", "道悪(稍重〜不良)")
    d["wx"] = d.weather.replace({"小雨": "雨・小雨", "雨": "雨・小雨"})
    # 開催日
    d["nichi_g"] = pd.cut(d.nichi, [0, 2, 4, 6, 8, 12], labels=["1-2日目", "3-4日目", "5-6日目", "7-8日目", "9-12日目"]).astype(str)
    d["nichi2"] = np.where(d.nichi <= 4, "開催前半(1-4日目)", "開催後半(5日目〜)")
    # レース条件
    d["nband"] = pd.cut(d.n, [0, 8, 12, 15, 18], labels=["8頭以下", "9-12頭", "13-15頭", "16頭以上"]).astype(str)
    d["rband"] = pd.cut(d.race_no, [0, 2, 4, 8, 10, 11, 12], labels=["1-2R", "3-4R", "5-8R", "9-10R", "11R", "12R"]).astype(str)
    d["tband"] = pd.cut(d.post_time, [0, 1059, 1259, 1459, 2400], labels=["〜10:59", "11:00-12:59", "13:00-14:59", "15:00〜"]).astype(str)
    d["hcap"] = np.where(d.handicap, "ハンデ戦", "ハンデ以外")
    d["fem"] = np.where(d.female, "牝馬限定", "牝馬限定以外")
    d["appr"] = np.where(d.apprentice.astype(bool), "減量騎手", "減量なし")
    # 斤量(レース内の平均との差)
    d["w_rel"] = d.weight - d.groupby("rid").weight.transform("mean")
    d["wrel_g"] = np.select([d.w_rel <= -1.5, d.w_rel >= 1.5], ["斤量軽め(平均-1.5kg以下)", "斤量重め(平均+1.5kg以上)"], "斤量ふつう")
    # 馬体重
    d["body_g"] = np.select([d.body < 440, d.body >= 500], ["小型(440kg未満)", "大型(500kg以上)"], "中型(440-498kg)")
    d.loc[d.body.isna(), "body_g"] = "不明"
    d["bdiff_g"] = np.select([d.body_diff <= -10, d.body_diff >= 10], ["大幅減(-10kg以下)", "大幅増(+10kg以上)"], "増減小(±8kg以内)")
    d.loc[d.body_diff.isna(), "bdiff_g"] = "不明"
    # 脚質: 前走以前(手元データ内)の「最後のコーナー順位 / 頭数」の平均。当日の通過順は使わない
    d = d.sort_values(["date", "post_time", "rid"]).reset_index(drop=True)
    d["rel_c"] = d.corner_last / d.n
    g = d.groupby("horse_id").rel_c
    d["style_n"] = g.cumcount()  # 何走ぶんの過去データがあるか(当日を含まない)
    d["style_x"] = g.transform(lambda s: s.shift(1).expanding().mean())
    d["style"] = np.select([d.style_x <= 0.3, d.style_x >= 0.6], ["先行(過去平均3割以内)", "差し・追込(6割以降)"], "中団")
    d.loc[d.style_x.isna(), "style"] = "過去走なし"
    # レース内の先行馬の数(過去走で判定できた馬だけ)
    d["n_sen"] = d.groupby("rid").style.transform(lambda s: (s == "先行(過去平均3割以内)").sum())
    d["oband"] = pd.cut(d.odds, [0, 3, 6, 10, 20, 50, 9999], labels=["〜2.9倍", "3-5.9倍", "6-9.9倍", "10-19.9倍", "20-49.9倍", "50倍〜"]).astype(str)
    d["evg"] = pd.cut(d.ev_mkt, [0, 0.8, 0.9, 0.95, 1.0, 1.1, 99], labels=["<0.8", "0.8-0.9", "0.9-0.95", "0.95-1.0", "1.0-1.1", "≧1.1"]).astype(str)
    return d


POP4 = {"全人気": None, "1-3番人気": (1, 3), "4-6番人気": (4, 6), "7番人気以下": (7, 99)}
POP5 = {"1番人気": (1, 1), "2-3番人気": (2, 3), "4-6番人気": (4, 6), "7-9番人気": (7, 9), "10番人気以下": (10, 99)}


def popmask(d, rng):
    return pd.Series(True, index=d.index) if rng is None else d.ninki.between(*rng)


# ---------------------------------------------------------------- 集計
def evaluate(d, m, h1):
    """条件 m の行について、回収率・区間・前後半・基準差・p値を返す。"""
    b = d[m]
    n = len(b)
    if n == 0:
        return None
    pay, base = b.pay.values / 100, b.base.values / 100
    ur, inv = np.unique(b.rid.values, return_inverse=True)
    s, c, sb = np.bincount(inv, pay), np.bincount(inv), np.bincount(inv, base)
    R = len(ur)
    idx = RNG.integers(0, R, (B, R))
    cs = c[idx].sum(1)
    roi_b = s[idx].sum(1) / cs
    diff_b = (s[idx].sum(1) - sb[idx].sum(1)) / cs
    roi, bas = pay.mean(), base.mean()
    se_r, se_d = roi_b.std(), (diff_b).std()
    hh = h1[m].values
    r1 = pay[hh].mean() if hh.any() else np.nan
    r2 = pay[~hh].mean() if (~hh).any() else np.nan
    return dict(n=n, races=R, hits=int(b.hit.sum()), roi=roi, lo=np.percentile(roi_b, 2.5), hi=np.percentile(roi_b, 97.5),
                n1=int(hh.sum()), r1=r1, n2=int((~hh).sum()), r2=r2, base=bas, diff=roi - bas,
                p_roi=float(norm.sf((roi - 1) / se_r)) if se_r > 0 else np.nan,
                p_diff=float(norm.sf((roi - bas) / se_d)) if se_d > 0 else np.nan)


def conditions(d):
    """(族, 名前, マスク) を全部並べる。ここに並べたものが「試した条件」。"""
    C = []
    add = lambda fam, nm, m: C.append((fam, nm, m))  # noqa: E731
    # 0. 基準(人気帯そのもの)
    for p, r in POP5.items():
        add("0_基準", p, popmask(d, r))
    # 1. コース × 枠/馬番 × 人気帯(10レース以上のコースだけ)
    rc = d.groupby("course").rid.nunique()
    courses = rc[rc >= 10].index
    for co in courses:
        mc = d.course.eq(co)
        for p, r in POP4.items():
            add("1_コース", f"{co} {p}", mc & popmask(d, r))
            for col in ("wpos", "umapos"):
                for v in sorted(d[col].unique()):
                    if v == "馬番中":
                        continue
                    add("1_コース×枠", f"{co} {v} {p}", mc & d[col].eq(v) & popmask(d, r))
    # 1b. 競馬場×芝/ダート × 枠 × 人気帯(コースより粗いのでサンプルが多い)
    for vs in sorted(d.vs.unique()):
        mv = d.vs.eq(vs)
        for p, r in POP4.items():
            add("1b_場×馬場", f"{vs} {p}", mv & popmask(d, r))
            for col in ("wpos", "umapos"):
                for v in sorted(d[col].unique()):
                    if v == "馬番中":
                        continue
                    add("1b_場×馬場×枠", f"{vs} {v} {p}", mv & d[col].eq(v) & popmask(d, r))
    # 2. 馬場状態・天候 × 芝ダ × 枠 × 人気帯
    for col, fam in (("baba3", "2_馬場状態×枠"), ("wx", "2_天候×枠")):
        for v in sorted(d[col].unique()):
            for sf in ("芝", "ダート"):
                m0 = d[col].eq(v) & d.surface.eq(sf)
                for w in sorted(d.wpos.unique()):
                    for p, r in POP4.items():
                        add(fam, f"{sf} {v} {w} {p}", m0 & d.wpos.eq(w) & popmask(d, r))
    # 2b. 脚質(前走以前の通過順) × 芝ダ × 馬場(良/道悪) × 人気帯
    for st in ("先行(過去平均3割以内)", "中団", "差し・追込(6割以降)"):
        for sf in ("芝", "ダート"):
            for bb in ("良", "道悪(稍重〜不良)"):
                m0 = d["style"].eq(st) & d.surface.eq(sf) & d.baba2.eq(bb)
                for p, r in POP4.items():
                    add("2b_脚質×馬場", f"{sf} {bb} {st} {p}", m0 & popmask(d, r))
        for p, r in POP4.items():
            add("2b_脚質", f"{st} {p}", d["style"].eq(st) & popmask(d, r))
            add("2b_脚質×先行馬少", f"先行馬2頭以下のレースの{st} {p}", d["style"].eq(st) & d.n_sen.le(2) & popmask(d, r))
    # 3. 開催日 × 芝ダ × 枠 × 人気帯
    for ng in sorted(d.nichi_g.unique()):
        for sf in ("芝", "ダート"):
            for w in sorted(d.wpos.unique()):
                for p, r in POP4.items():
                    add("3_開催日×枠", f"{sf} {ng} {w} {p}", d.nichi_g.eq(ng) & d.surface.eq(sf) & d.wpos.eq(w) & popmask(d, r))
    for n2 in sorted(d.nichi2.unique()):
        for vs in sorted(d.vs.unique()):
            for w in ("内枠1-3", "外枠7-8"):
                for p, r in POP4.items():
                    add("3_開催前後半×場×枠", f"{vs} {n2} {w} {p}", d.nichi2.eq(n2) & d.vs.eq(vs) & d.wpos.eq(w) & popmask(d, r))
        for st in ("先行(過去平均3割以内)", "差し・追込(6割以降)"):
            for sf in ("芝", "ダート"):
                add("3_開催前後半×脚質", f"{sf} {n2} {st}", d.nichi2.eq(n2) & d.surface.eq(sf) & d["style"].eq(st))
    # 4. レース条件 × 人気帯(細かい5帯)
    for col, fam in (("cls", "4_クラス"), ("sex", "4_性別"), ("age_cond", "4_年齢条件"), ("hcap", "4_ハンデ"),
                     ("fem", "4_牝馬限定"), ("nband", "4_頭数"), ("tband", "4_発走時刻"), ("rband", "4_レース番号"),
                     ("appr", "4_減量騎手"), ("venue", "4_競馬場"), ("surface", "4_芝ダ")):
        for v in sorted(d[col].dropna().astype(str).unique()):
            mv = d[col].astype(str).eq(v)
            if mv.sum() < 20:
                continue
            add(fam, f"{v} 全人気", mv)
            for p, r in POP5.items():
                add(fam, f"{v} {p}", mv & popmask(d, r))
    # 5. 斤量・馬体重・増減 × 場×芝ダ × 人気帯
    for col, fam in (("wrel_g", "5_斤量"), ("body_g", "5_馬体重"), ("bdiff_g", "5_増減")):
        for v in sorted(d[col].unique()):
            if v == "不明":
                continue
            mv = d[col].eq(v)
            for p, r in POP4.items():
                add(fam, f"{v} {p}", mv & popmask(d, r))
                for vs in sorted(d.vs.unique()):
                    add(fam + "×場", f"{vs} {v} {p}", mv & d.vs.eq(vs) & popmask(d, r))
                for sf in ("芝", "ダート"):
                    for bb in ("良", "道悪(稍重〜不良)"):
                        add(fam + "×馬場", f"{sf} {bb} {v} {p}", mv & d.surface.eq(sf) & d.baba2.eq(bb) & popmask(d, r))
    # 6. Dr.Z方式(ev_mkt≧1.0)に条件を1つ足す。しきい値を下げた版(≧0.95, ≧0.9)も見る
    single = ["venue", "surface", "vs", "baba3", "wx", "wpos", "umapos", "nichi_g", "nichi2", "cls", "nband", "rband",
              "tband", "sex", "age_cond", "hcap", "fem", "appr", "body_g", "bdiff_g", "wrel_g", "style", "oband"]
    for th in (1.0, 0.95, 0.9):
        mz = d.ev_mkt >= th
        add(f"6_DrZ≧{th}", f"DrZ≧{th} そのまま", mz)
        for p, r in POP5.items():
            add(f"6_DrZ≧{th}", f"DrZ≧{th} {p}", mz & popmask(d, r))
        for col in single:
            for v in sorted(d[col].dropna().astype(str).unique()):
                mv = mz & d[col].astype(str).eq(v)
                if mv.sum() >= 5:
                    add(f"6_DrZ≧{th}", f"DrZ≧{th} {col}={v}", mv)
                    add(f"6_DrZ≧{th}_除外", f"DrZ≧{th} {col}≠{v}", mz & ~d[col].astype(str).eq(v))
    # 6b. 期待値の帯ごとの回収率(Dr.Z のしきい値の妥当性)
    for v in sorted(d.evg.unique()):
        add("6b_期待値帯", f"ev_mkt {v}", d.evg.eq(v))
    # 7. その他: 外回り・回り・単勝オッズ帯×場、休み明け、1強レース×場
    add("7_その他", "外回りコース 全人気", d.outer.astype(bool))
    for p, r in POP4.items():
        add("7_その他", f"外回りコース {p}", d.outer.astype(bool) & popmask(d, r))
        for t in ("右", "左"):
            add("7_その他", f"{t}回り {p}", d.turn.eq(t) & popmask(d, r))
        add("7_その他", f"同じ開催で前走あり(連闘〜中数週) {p}", d.days_off.le(35) & popmask(d, r))
    for vs in sorted(d.vs.unique()):
        for ob in sorted(d.oband.unique()):
            add("7_場×単勝オッズ帯", f"{vs} 単勝{ob}", d.vs.eq(vs) & d.oband.eq(ob))
        add("7_1強×場", f"{vs} 1番人気≦1.9倍のレースの2-4番人気", d.vs.eq(vs) & d.fav_odds.le(1.9) & d.ninki.between(2, 4))
    return C


def cluster_p(pay, base, rid_codes, masks):
    """ブートストラップを使わない速い版: レース単位でまとめた標準誤差(クラスタ頑健)から、基準との差の片側p値。"""
    e = pay - base
    out = []
    for m in masks:
        r, ee = rid_codes[m], e[m]
        n = len(ee)
        mu = ee.mean()
        sr = np.bincount(r, ee - mu)
        se = np.sqrt((sr ** 2).sum()) / n
        out.append(norm.sf(mu / se) if se > 0 else np.nan)
    return np.array(out)


def null_check(d, masks, mode, n_perm=50):
    """偶然だけで p<0.05 が何個出るか。払戻は実データのまま、条件の当てはめ先だけを付け替えた「効果ゼロ」の世界で数える。
    mode="race": 各レースを同じ頭数の別レースに付け替え、同じ人気順位の馬を選ぶ(レース内のつながりは残る)。
    mode="day" : 開催日(場×日付)ごとまとめて別の開催日に付け替え、同じR番号・同じ人気順位の馬を選ぶ
                 (「荒れた日」のような開催日単位のつながりも残る。いちばん厳しい比べ方)。"""
    codes = pd.factorize(d.rid)[0]
    pay, base = d.pay.values / 100, d.base.values / 100
    real = cluster_p(pay, base, codes, masks)
    rank = d.groupby("rid").odds.rank(method="first").astype(int).values
    rid_u = pd.unique(d.rid)
    rng = np.random.default_rng(1)
    pos = {(r, k): i for i, (r, k) in enumerate(zip(d.rid.values, rank))}
    rinfo = d.drop_duplicates("rid").set_index("rid")
    dayk = (rinfo.venue + rinfo.date.astype(str))
    out = dict(p05=[], p01=[], bad=[], pmin=[])
    for _ in range(n_perm):
        if mode == "race":
            mp = {}
            for _, g in rinfo.groupby("n"):
                ids = g.index.values
                mp.update(zip(ids, rng.permutation(ids)))
        else:
            days = dayk.unique()
            dm = dict(zip(days, rng.permutation(days)))
            by = {(dayk[r], rinfo.race_no[r]): r for r in rid_u}
            mp = {r: by.get((dm[dayk[r]], rinfo.race_no[r])) for r in rid_u}
        tgt = np.array([pos.get((mp[r], k), -1) for r, k in zip(d.rid.values, rank)])
        fm = []
        for m in masks:
            t = tgt[m]
            fm.append(t[t >= 0])
        q = cluster_p(pay, base, codes, fm)
        out["p05"].append(np.nansum(q < 0.05))
        out["p01"].append(np.nansum(q < 0.01))
        out["bad"].append(np.nansum(q > 0.95))
        out["pmin"].append(np.nanmin(q))
    return real, {k: np.array(v) for k, v in out.items()}


def bh(p):
    """Benjamini-Hochberg の q値。"""
    p = np.asarray(p, float)
    o = np.argsort(p)
    q = np.empty_like(p)
    m = len(p)
    prev = 1.0
    for rank, i in reversed(list(enumerate(o, 1))):
        prev = min(prev, p[i] * m / rank)
        q[i] = prev
    return q


def main():
    d = prep()
    days = np.sort(d.date.unique())
    cut = days[len(days) // 2]
    h1 = d.date < cut
    print(f"{d.rid.nunique()}レース {len(d)}頭  全馬の複勝 {d.pay.mean():.1f}%  前半 〜{pd.Timestamp(cut):%Y-%m-%d}未満 / 後半")
    print(f"脚質を判定できた馬(過去走あり) {d.style_x.notna().sum()}頭")
    rows, kept = [], []
    seen = set()
    for fam, nm, m in conditions(d):
        key = tuple(np.flatnonzero(m.values))
        r = evaluate(d, m, h1)
        if r is None:
            continue
        r.update(family=fam, name=nm, dup=key in seen)
        seen.add(key)
        rows.append(r)
        kept.append(m.values)
    t = pd.DataFrame(rows)
    # 多重検定: 重複を除き、50頭以上で「基準との差」の p値を補正する
    t["reliable"] = t.n >= MIN_N
    t["both_halves_gt1"] = (t.r1 > 1) & (t.r2 > 1)
    ev = t.reliable & ~t.dup & ~t.family.str.startswith("0_")
    M = int(ev.sum())
    t["q_diff"] = np.nan
    t.loc[ev, "q_diff"] = bh(t.loc[ev, "p_diff"].values)
    t["q_roi"] = np.nan
    t.loc[ev, "q_roi"] = bh(t.loc[ev, "p_roi"].values)
    t["bonf_diff"] = (t.p_diff * M).clip(upper=1).where(ev)
    # Dr.Z系は「同じしきい値の Dr.Z 全体」を基準にした差も出す(条件を足して良くなったか)
    t["drz_all"] = np.nan
    for th in (1.0, 0.95, 0.9):
        f = t.family.str.startswith(f"6_DrZ≧{th}")
        t.loc[f, "drz_all"] = t.loc[t.name.eq(f"DrZ≧{th} そのまま"), "roi"].iloc[0]
    t["vs_drz"] = t.roi - t.drz_all
    cols = ["family", "name", "n", "races", "hits", "roi", "lo", "hi", "n1", "r1", "n2", "r2", "base", "diff",
            "p_roi", "p_diff", "q_roi", "q_diff", "bonf_diff", "drz_all", "vs_drz", "reliable", "both_halves_gt1", "dup"]
    t = t[cols]
    t.to_csv(ROOT / "data" / "jra" / "mine_course.csv", index=False)
    # 偶然との比較(シャッフル)
    # Dr.Z系(6_)は同じ70〜120頭を何百通りにも切っただけで、人気の基準に対しては Dr.Z そのものの効果が乗る。
    # そこで偶然との比較は「Dr.Z系を除いた条件」と「全部」に分けて数える。
    nz = ev & ~t.family.str.startswith("6_")
    for sel, lab0 in ((ev, "全条件"), (nz, "Dr.Z系を除く(コース・条件だけ)")):
        masks = [kept[i] for i in np.flatnonzero(sel.values)]
        for mode, lab in (("race", "レースを付け替え"), ("day", "開催日ごと付け替え")):
            real, o = null_check(d, masks, mode)
            print(f"\n[偶然との比較: {lab0} {len(masks)}個 / {lab} 50回] 実データ: p<0.05 {int(np.nansum(real < 0.05))}個"
                  f"・p<0.01 {int(np.nansum(real < 0.01))}個・基準より悪い p>0.95 {int(np.nansum(real > 0.95))}個・最小p {np.nanmin(real):.1e}")
            print(f"  効果ゼロの世界: p<0.05 平均{o['p05'].mean():.0f}個(95%点 {np.percentile(o['p05'], 95):.0f})・"
                  f"p<0.01 平均{o['p01'].mean():.0f}個(95%点 {np.percentile(o['p01'], 95):.0f})・"
                  f"p>0.95 平均{o['bad'].mean():.0f}個・最小pが実データ以下だった割合 {np.mean(o['pmin'] <= np.nanmin(real)):.2f}")
    print(f"\n試した条件 {len(t)}個(中身が重複するもの {int(t.dup.sum())}個)、うち50頭以上で重複なし {M}個")
    print(f"偶然でも 5% の確率で超える → 何も効果がなくても p<0.05 が約 {M * 0.05:.0f}個 出る")
    print(f"p_diff<0.05: {int((t.p_diff[ev] < 0.05).sum())}個 / Bonferroni(p<{0.05 / M:.1e})通過: {int((t.bonf_diff[ev] < 0.05).sum())}個 /"
          f" FDR q<0.1: {int((t.q_diff[ev] < 0.1).sum())}個")
    fmt = lambda r: (f"{r['name'][:44]:<44}{r.n:>5}{r.races:>4}  {r.roi:5.2f} ({r.lo:4.2f}〜{r.hi:4.2f})  "  # noqa: E731
                     f"{r.r1:5.2f}/{r.r2:5.2f}  基準{r.base:4.2f} 差{r['diff']:+5.2f}  p={r.p_diff:.3f} q={r.q_diff:.2f}")
    good = t[nz & t.both_halves_gt1 & (t["diff"] > 0)].sort_values("p_diff")
    print("\n=== 有望(Dr.Z系以外・50頭以上・前後半とも100%超)、基準との差の p値順 上位20 ===")
    print(f"{'条件':<44}{'頭':>5}{'R':>4}  回収率(95%区間)     前半/後半   基準との差")
    for _, r in good.head(20).iterrows():
        print(fmt(r))
    print("\n=== Dr.Z(ev_mkt≧1.0)に条件を足したもの(10頭以上) ===")
    z = t[t.family.str.startswith("6_DrZ≧1.0") & (t.n >= 10)].sort_values("roi", ascending=False)
    for _, r in z.iterrows():
        print(f"{r['name'][:44]:<44}{r.n:>5}{r.races:>4}  {r.roi:5.2f} ({r.lo:4.2f}〜{r.hi:4.2f})  {r.r1:5.2f}/{r.r2:5.2f}"
              f"  Dr.Z全体との差{r.vs_drz:+5.2f}")
    print("\n=== 期待値帯 ===")
    for _, r in t[t.family.eq("6b_期待値帯")].iterrows():
        print(fmt(r))
    bad = t[ev].sort_values("p_diff", ascending=False)
    print("\n=== 明らかに悪い(基準より下、50頭以上) 下位10 ===")
    for _, r in bad.head(10).iterrows():
        print(fmt(r))


if __name__ == "__main__":
    main()
