"""中央競馬: 「複勝の期待値が上がる」と言われる説を、まとめて検証する。

説の出どころ:
  - 本命・大穴のゆがみ(favorite-longshot bias): 人気薄は買われすぎ、人気馬は買われなさすぎ(Ziemba ほか)。
  - Dr.Z方式(Hausch・Ziemba・Rubinstein 1981): 単勝の確率から見て、複勝が売れていない馬を買う。
  - 少頭数: 8頭立ては3着まで払うので当たりやすい/7頭以下は2着まで。
  - 1強レース: 抜けた1番人気がいると、2・3番手の複勝が安くなりすぎる(または高すぎる)。
  - 前走の印象: 前走1着は買われすぎ、前走大敗の実力馬は買われなさすぎ。
  - 減量騎手・休み明け・馬体重の大幅増減・外枠など、よく言われる条件。
  - 朝から確定までにオッズが下がった馬(誰かが買っている馬)の複勝(当日記録した2日分だけ)。

だまされないための見方:
  - 条件を20個も試せば、偶然100%を超えるものがいくつか出る。
  - そこで期間を前半・後半に分けて「両方で100%超え」かどうかを見る。95%区間はレース単位のブートストラップ。

使い方: python jra/theories.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent


def boot(ret, rids, n=2000):
    ur, inv = np.unique(rids, return_inverse=True)
    s, c = np.bincount(inv, ret), np.bincount(inv)
    rng = np.random.default_rng(0)
    bs = [s[k].sum() / c[k].sum() for k in (rng.integers(0, len(ur), len(ur)) for _ in range(n))]
    return np.percentile(bs, [2.5, 97.5])


def harville_top(q, k):
    q = np.asarray(q, float)
    n = len(q)
    out = np.zeros(n)
    for i in range(n):
        out[i] += q[i]
        for j in range(n):
            if j == i:
                continue
            pj = q[j] * q[i] / (1 - q[j])
            out[i] += pj
            if k == 3:
                for m in range(n):
                    if m in (i, j):
                        continue
                    out[i] += q[m] * q[j] / (1 - q[m]) * q[i] / (1 - q[m] - q[j])
    return out


def load():
    d = pd.read_pickle(ROOT / "data" / "jra" / "runs.pkl")
    d["date"] = pd.to_datetime(d["date"])
    d = d.sort_values(["date", "post_time", "rid", "umaban"]).reset_index(drop=True)
    d["ok"] = d.status.fillna("").eq("")
    d["n"] = d.groupby("rid")["umaban"].transform("count")
    d["k"] = np.where(d.n <= 7, 2, 3)
    d["hit"] = (d.finish <= d.k) & d.ok
    d["pay"] = d.fuku_pay.fillna(0).where(d.ok, 100)  # 取消・除外は返還
    # 前走(手元のデータにある分だけ)
    g = d.groupby("horse_id")
    d["prev_fin"] = g["finish"].shift(1)
    d["prev_ninki"] = g["ninki"].shift(1)
    d["days_off"] = (d.date - g["date"].shift(1)).dt.days
    # 輸送: 調教師がふだん走らせる場から所属(東/西)を推定 → 遠征かどうか
    EAST, WEST = {"中山", "東京", "福島", "新潟"}, {"京都", "阪神", "中京", "小倉"}
    reg = d.venue.map(lambda v: 1 if v in EAST else (-1 if v in WEST else 0))
    home = reg.groupby(d.trainer_id).transform("mean")
    d["travel"] = np.where(reg == 0, 2, np.where(reg * np.sign(home) < 0, 1, 0))
    d["kinryo_diff"] = d.weight - g["weight"].shift(1)
    d["same_jockey"] = d.jockey_id == g["jockey_id"].shift(1)
    gc = d.groupby(["jockey_id", "trainer_id"])
    d["combo_runs"] = gc.cumcount()
    d["combo_t3"] = (gc["hit"].cumsum() - d.hit) / d.combo_runs.replace(0, np.nan)
    # 市場から見た3着内確率と、いまのアプリの期待値
    d["ev_mkt"] = np.nan
    d["fav_odds"] = d.groupby("rid")["odds"].transform("min")
    for rid, idx in d[d.odds > 0].groupby("rid").indices.items():
        sub = d.loc[d.odds > 0].iloc[idx]
        q = 1 / sub.odds.values
        q /= q.sum()
        p = harville_top(q, int(sub.k.iloc[0]))
        d.loc[sub.index, "ev_mkt"] = p * sub.fuku_min.values
    # 競走馬情報(血統・馬主・生産者・全出走歴)。取れている馬だけ値が入る
    import sys
    sys.path.insert(0, str(ROOT / "jra"))
    import horsefeat as H
    d = H.add(d)
    # 所属(美浦/栗東)が分かる馬は、推定ではなく本当の所属で遠征を判定し直す
    east = d.center_east.map({1.0: 1, 0.0: -1})
    d["travel"] = np.where(east.notna() & (reg != 0), np.where(reg * east < 0, 1, 0), d.travel)
    return d[d.odds > 0]


def theories(d):
    ok = d.ok
    T = {}
    for a, b in [(1, 1), (2, 2), (3, 3), (4, 6), (7, 9), (10, 18)]:
        T[f"人気 {a}〜{b}番"] = d.ninki.between(a, b)
    for a, b in [(1, 3), (3, 6), (6, 10), (10, 20), (20, 50), (50, 999)]:
        T[f"単勝 {a}〜{b}倍"] = (d.odds >= a) & (d.odds < b)
    T["Dr.Z: 期待値(市場)≧1.0 = いまのアプリ"] = d.ev_mkt >= 1.0
    T["Dr.Z: 期待値(市場)≧1.1"] = d.ev_mkt >= 1.1
    T["8頭立ての1〜3番人気"] = (d.n == 8) & d.ninki.le(3)
    T["7頭以下の1〜2番人気"] = (d.n <= 7) & d.ninki.le(2)
    T["16頭以上の1番人気"] = (d.n >= 16) & d.ninki.eq(1)
    T["1強(1番人気≦1.9倍)の1番人気"] = (d.fav_odds <= 1.9) & d.ninki.eq(1)
    T["1強(1番人気≦1.9倍)の2〜4番人気"] = (d.fav_odds <= 1.9) & d.ninki.between(2, 4)
    T["混戦(1番人気≧4倍)の1〜3番人気"] = (d.fav_odds >= 4) & d.ninki.le(3)
    T["前走1着の馬"] = d.prev_fin.eq(1)
    T["前走1〜3番人気で6着以下 → 今回4〜9番人気"] = d.prev_ninki.le(3) & d.prev_fin.ge(6) & d.ninki.between(4, 9)
    T["減量騎手の1〜5番人気"] = d.apprentice.astype(bool) & d.ninki.le(5)
    T["馬体重 ±10kg以上の1〜3番人気"] = d.body_diff.abs().ge(10) & d.ninki.le(3)
    T["休み明け(90日以上)の1〜3番人気"] = d.days_off.ge(90) & d.ninki.le(3)
    T["新馬・未勝利の1〜3番人気"] = d.cls.isin(["新馬", "未勝利"]) & d.ninki.le(3)
    T["1勝クラス以上の1〜3番人気"] = ~d.cls.isin(["新馬", "未勝利"]) & d.ninki.le(3)
    T["ダートの1〜3番人気"] = d.surface.eq("ダート") & d.ninki.le(3)
    T["芝の1〜3番人気"] = d.surface.eq("芝") & d.ninki.le(3)
    T["重・不良の1〜3番人気"] = d.baba.isin(["重", "不良"]) & d.ninki.le(3)
    T["1・2枠の4〜9番人気"] = d.waku.le(2) & d.ninki.between(4, 9)
    T["7・8枠の1〜3番人気"] = d.waku.ge(7) & d.ninki.le(3)
    T["遠征馬(東の厩舎が西で/西が東で)"] = d.travel.eq(1)
    T["遠征馬の1〜5番人気"] = d.travel.eq(1) & d.ninki.le(5)
    T["遠征馬の6番人気以下"] = d.travel.eq(1) & d.ninki.ge(6)
    T["地元馬の1〜5番人気"] = d.travel.eq(0) & d.ninki.le(5)
    T["斤量が前走より2kg以上減った1〜5番人気"] = d.kinryo_diff.le(-2) & d.ninki.le(5)
    T["騎手×調教師コンビ 3着内率40%以上(3回以上)"] = d.combo_runs.ge(3) & d.combo_t3.ge(0.4)
    T["乗り替わりなし(前走と同じ騎手)の1〜5番人気"] = d.same_jockey & d.ninki.le(5)
    T["朝のレース(1〜4R)の1〜3番人気"] = d.race_no.le(4) & d.ninki.le(3)
    # ---- 競走馬情報から(血統・馬主・生産者・全出走歴) ----
    top = d.ninki.le(3)
    mid = d.ninki.between(4, 9)
    new = d.cls.eq("新馬")
    for nm, c in [("社台系生産(ノーザン・社台・追分)", d.shadai.eq(1)), ("社台系以外の生産", d.shadai.eq(0)),
                  ("クラブ馬主", d.club.eq(1)), ("個人馬主", d.club.eq(0)),
                  ("セリで買われた馬", d.sold.eq(1)), ("セレクトセール出身", d.select_sale.eq(1))]:
        T[f"{nm}の1〜3番人気"] = c & top
        T[f"{nm}の4〜9番人気"] = c & mid
    T["新馬戦: 社台系生産の4番人気以下"] = new & d.shadai.eq(1) & d.ninki.ge(4)
    T["新馬戦: 社台系以外の1〜3番人気"] = new & d.shadai.eq(0) & top
    T["新馬戦: 父の同馬場3着内率が上位(≧35%)の4〜9番人気"] = new & d.sire_t3_surf.ge(0.35) & mid
    T["新馬戦: 母の産駒成績が良い(≧40%)の4〜9番人気"] = new & d.dam_t3.ge(0.40) & mid
    T["2歳戦: 早生まれ(1〜3月)の1〜5番人気"] = d.age.eq(2) & d.birth_month.le(3) & d.ninki.le(5)
    T["2歳戦: 遅生まれ(5月以降)の1〜5番人気"] = d.age.eq(2) & d.birth_month.ge(5) & d.ninki.le(5)
    T["初ダート: 父のダート3着内率≧35%"] = d.c_first_surface.eq(1) & d.surface.eq("ダート") & d.sire_t3_surf.ge(0.35)
    T["初芝: 父の芝3着内率≧35%"] = d.c_first_surface.eq(1) & d.surface.eq("芝") & d.sire_t3_surf.ge(0.35)
    T["初めての馬場(芝⇔ダート)の4〜9番人気"] = d.c_first_surface.eq(1) & mid
    T["父の同馬場3着内率が上位(≧38%)の4〜9番人気"] = d.sire_t3_surf.ge(0.38) & mid
    T["父の同距離帯3着内率が上位(≧38%)の4〜9番人気"] = d.sire_t3_dist.ge(0.38) & mid
    T["母の父の同馬場3着内率が上位(≧38%)の4〜9番人気"] = d.damsire_t3_surf.ge(0.38) & mid
    T["生産牧場の3着内率が上位(≧35%)の4〜9番人気"] = d.breeder_t3.ge(0.35) & mid
    T["馬主の3着内率が上位(≧35%)の4〜9番人気"] = d.owner_t3.ge(0.35) & mid
    T["地方帰り(前走が地方・海外)"] = d.c_prev_local.eq(1)
    T["全成績の3着内率≧50%(5走以上)の4番人気以下"] = d.c_runs.ge(5) & d.c_t3rate.ge(0.5) & d.ninki.ge(4)
    T["同じ馬場の3着内率≧50%(3走以上)の4番人気以下"] = d.c_surf_t3rate.ge(0.5) & d.c_runs.ge(3) & d.ninki.ge(4)
    T["前走(全成績)1〜3着 → 今回4〜9番人気"] = d.c_prev_fin.le(3) & mid
    T["前走(全成績)人気より大きく負けた(人気+5着以上)→ 今回1〜5番人気"] = (d.c_prev_fin - d.c_prev_ninki).ge(5) & d.ninki.le(5)
    T["距離延長(+200m以上)の1〜5番人気"] = d.c_dist_change.ge(200) & d.ninki.le(5)
    T["距離短縮(-200m以上)の1〜5番人気"] = d.c_dist_change.le(-200) & d.ninki.le(5)
    T["中2週以内(14日以下)の1〜5番人気"] = d.c_days_off.le(14) & d.ninki.le(5)
    T["半年以上の休み明け(全成績)の1〜5番人気"] = d.c_days_off.ge(180) & d.ninki.le(5)
    T["キャリア10戦以上の古馬 1〜3番人気"] = d.c_runs.ge(10) & top
    return T


def drift():
    """当日記録した 朝→確定 の単勝オッズの動き(2日分だけ)。"""
    rows = []
    for day in sorted((ROOT / "data" / "jra" / "live").glob("2026*")):
        for f in sorted((day / "odds").glob("*_確定.json")):
            rid = f.name.split("_")[0]
            m = day / "odds" / f"{rid}_朝.json"
            r = day / f"result_{rid}.json"
            if not (m.exists() and r.exists()):
                continue
            a = {h["no"]: h for h in json.loads(m.read_text())["horses"]}
            b = json.loads(f.read_text())["horses"]
            res = json.loads(r.read_text())
            for h in b:
                h0 = a.get(h["no"])
                rr = res.get(str(h["no"]), {})
                if not h0 or not h0.get("tan") or not h.get("tan") or rr.get("status"):
                    continue
                rows.append(dict(rid=rid, ratio=h["tan"] / h0["tan"], tan=h["tan"], pay=rr.get("fuku_pay", 0) or 0))
    return pd.DataFrame(rows)


def line(name, b, rid):
    if len(b) < 10:
        return None
    lo, hi = boot(b.values / 100, rid)
    return f"{name:<38}{len(b):>5}{b.mean() / 100:>8.2f}  ({lo:.2f}〜{hi:.2f})"


def main():
    d = load()
    days = np.sort(d.date.unique())
    cut = days[len(days) // 2]
    h1, h2 = d.date < cut, d.date >= cut
    print(f"{d.rid.nunique()}レース {len(d)}頭  前半 〜{pd.Timestamp(cut):%Y-%m-%d} / 後半")
    print(f"(前走の情報がある馬 {d.prev_fin.notna().sum()}頭 — データが飛び飛びなので少ない)\n")
    print(f"{'説':<34}{'頭':>5}{'回収率':>8}  95%区間       前半   後半  判定")
    out = []
    for nm, m in theories(d).items():
        b = d[m]
        if len(b) < 10:
            print(f"{nm:<34}{len(b):>5}   (少なすぎ)")
            continue
        lo, hi = boot(b.pay.values / 100, b.rid.values)
        r1 = b[h1[m]].pay.mean() / 100 if h1[m].sum() else np.nan
        r2 = b[h2[m]].pay.mean() / 100 if h2[m].sum() else np.nan
        mark = "◎両方100%超" if r1 > 1 and r2 > 1 else ("○" if b.pay.mean() > 90 else "")
        print(f"{nm:<34}{len(b):>5}{b.pay.mean() / 100:>8.2f}  ({lo:.2f}〜{hi:.2f})  {r1:>5.2f}  {r2:>5.2f}  {mark}")
        out.append(dict(name=nm, n=len(b), roi=b.pay.mean() / 100, lo=lo, hi=hi, r1=r1, r2=r2))
    print(f"\n全体(全馬の複勝を買う){d.pay.mean() / 100:>8.2f}")

    x = drift()
    if len(x):
        print(f"\n朝→確定の単勝オッズの動き(当日記録 {x.rid.nunique()}レース)")
        for nm, m in [("大きく下がった(×0.7以下)", x.ratio <= 0.7), ("少し下がった(0.7〜0.9)", x.ratio.between(0.7, 0.9)),
                      ("ほぼ同じ(0.9〜1.1)", x.ratio.between(0.9, 1.1)), ("上がった(1.1倍以上)", x.ratio >= 1.1),
                      ("下がった × 確定20倍以下", (x.ratio <= 0.8) & (x.tan <= 20))]:
            s = line(nm, x[m].pay, x[m].rid.values)
            print(s or f"{nm}: 少なすぎ")
    pd.DataFrame(out).to_csv(ROOT / "data" / "jra" / "theories.csv", index=False)


if __name__ == "__main__":
    main()
