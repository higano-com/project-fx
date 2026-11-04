// 急変のデータを使う2つの方法を、毎月見直しの中で確かめる
// A) 急落・急騰のあとの戻りを狙う売買（新しい入り方）
// B) 今のルールで、急変の直後は見送る
import { loadCsv, prepare, STRATEGIES } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const I = STRATEGIES.ichimoku;
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const body = i => (B.c[i] - B.o[i]) / B.atr[i - 1];
const spikeWithin = (i, n, k) => { for (let j = i - n; j <= i - 1; j++) if (Math.abs(body(j)) >= k) return true; return false; };
FILTERS.afterSpike = { opts: [0, 3, 6, 12], fn: (B, i, s, v) => !v || !spikeWithin(i, v, 3) };
const revert = {
  grid: { k: [2.5, 3, 4], slMult: [1, 1.5, 2], rr: [1, 1.5, 2], hold: [6, 12, 24], side: [0, 1, 2] },   // side 0=両方 1=急落の後の買いだけ 2=急騰の後の売りだけ
  fn(B, i, p) {
    const b = body(i); if (Math.abs(b) < p.k) return null;
    const dir = -Math.sign(b); if ((p.side === 1 && dir !== 1) || (p.side === 2 && dir !== -1)) return null;
    return { dir, stop: p.slMult * B.atr[i], rr: p.rr, hold: p.hold };
  },
};
const follow = {
  grid: { k: [2.5, 3, 4], slMult: [1, 1.5, 2], rr: [1.5, 2, 3], hold: [12, 24, 48] },
  fn(B, i, p) { const b = body(i); if (Math.abs(b) < p.k) return null; return { dir: Math.sign(b), stop: p.slMult * B.atr[i], rr: p.rr, hold: p.hold }; },
};
console.log("スプレッド0.8ドル・1回2,500円・見直しの日を4通りずらした平均");
report(B, "今のルール", compose(I, { bigBar: 0.6 }, ["minStop", "daily"]));
report(B, "今のルール＋急変の直後は見送る（毎月）", compose(I, { bigBar: 0.6 }, ["minStop", "daily", "afterSpike"]));
report(B, "急変のあとの戻りを狙う", compose(revert, {}, []));
report(B, "急変のあとの戻り＋日足の流れの向きだけ", compose(revert, {}, ["daily"]));
report(B, "急変と同じ向きに乗る", compose(follow, {}, []));
report(B, "急変と同じ向き＋日足の流れの向きだけ", compose(follow, {}, ["daily"]));
