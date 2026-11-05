// 新しい狙いを2つ試す
// A) 押し目で入る：今のルールの判断が出たあと、N時間以内に値段が「抜けた場所（もみ合いの範囲の端）」まで戻ってきて、
//    そこで反発したら入る（入る値段が良くなり、損切りも近くできる）
// B) 時間帯の動き出し：日本時間の朝〜夕方（アジア時間）のもみ合いの範囲を、ロンドン時間（日本時間16時以降）に抜けたら乗る
import { loadCsv, prepare, STRATEGIES } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const I = STRATEGIES.ichimoku;
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const big = i => Math.abs(B.c[i] - B.o[i]) > 0.6 * B.atr[i];

// A) 押し目で入る
const pullback = {
  grid: { ...I.grid, win: [6, 12, 24], buf: [0.3, 0.6] },
  fn(B, i, p) {
    for (let j = i - 1; j >= i - p.win; j--) {
      const s = I.fn(B, j, p); if (!s || !big(j)) continue;
      const lvl = s.dir === 1 ? B.cloudTop[j] : B.cloudBot[j];      // 抜けた場所
      const touched = s.dir === 1 ? B.l[i] <= lvl + 0.3 * B.atr[i] : B.h[i] >= lvl - 0.3 * B.atr[i];
      const bounced = s.dir === 1 ? B.c[i] > B.o[i] && B.c[i] > lvl : B.c[i] < B.o[i] && B.c[i] < lvl;
      if (!touched || !bounced) return null;
      const sl = s.dir === 1 ? Math.min(B.l[i], lvl) - p.buf * B.atr[i] : Math.max(B.h[i], lvl) + p.buf * B.atr[i];
      const stop = Math.abs(B.c[i] - sl); if (stop <= 0) return null;
      return { dir: s.dir, stop, rr: p.rr };
    }
    return null;
  },
};
// B) アジア時間のもみ合いを、ロンドン時間に抜けたら乗る
const jh = t => new Date(t + 9 * 3600e3).getUTCHours();
const session = {
  grid: { start: [16, 17], slMult: [1, 1.5, 2], rr: [1.5, 2, 3], maxW: [3, 5, 8] },
  fn(B, i, p) {
    const h = jh(B.t[i]); if (h < p.start || h > 20) return null;
    let hh = -Infinity, ll = Infinity, n = 0;
    for (let k = i - 1; k >= i - 14 && k > 0; k--) { const hk = jh(B.t[k]); if (hk >= 8 && hk < 16) { hh = Math.max(hh, B.h[k]); ll = Math.min(ll, B.l[k]); n++; } }
    if (n < 5 || hh - ll > p.maxW * B.atr[i]) return null;          // アジア時間がもみ合っていたときだけ
    const c = B.c[i], pc = B.c[i - 1];
    if (c > hh && pc <= hh) return { dir: 1, stop: p.slMult * B.atr[i], rr: p.rr, hold: 24 };
    if (c < ll && pc >= ll) return { dir: -1, stop: p.slMult * B.atr[i], rr: p.rr, hold: 24 };
    return null;
  },
};
console.log("スプレッド0.8ドル・1回2,500円・見直しの日を4通りずらした平均");
report(B, "今のルール", compose(I, { bigBar: 0.6 }, ["minStop", "daily"]));
report(B, "A 押し目で入る", compose(pullback, {}, ["minStop", "daily"]));
report(B, "B ロンドンの動き出し", compose(session, {}, []));
report(B, "B ＋日足の流れの向きだけ", compose(session, {}, ["daily"]));
