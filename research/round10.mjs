// 第10回：新しいルール（抜けた足0.6倍以上）を土台に、残りの候補を試し直す
import { loadCsv, prepare, STRATEGIES, COST } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const I = STRATEGIES.ichimoku;
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
FILTERS.h4 = { opts: [0, 1], fn: (B, i, s, v) => !v || ((B.ema(80)[i] > B.ema(80)[i - 16]) === (s.dir === 1)) };
FILTERS.closeNear = { opts: [0, 0.3], fn: (B, i, s, v) => { if (!v) return true; const r = B.h[i] - B.l[i] || 1; const pos = (B.c[i] - B.l[i]) / r; return s.dir === 1 ? pos >= 1 - v : pos <= v; } };   // 足の終わりが高値（安値）の近く
FILTERS.notFar = { opts: [0, 2, 3], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.ema(20)[i]) < v * B.atr[i] };   // 短い平均から離れすぎていない
const lowN = (i, n) => { let m = Infinity; for (let k = i - n; k < i; k++) m = Math.min(m, B.l[k]); return m; };
const highN = (i, n) => { let m = -Infinity; for (let k = i - n; k < i; k++) m = Math.max(m, B.h[k]); return m; };
const swing = { grid: { ...I.grid, sn: [12, 24, 48], buf: [0.2, 0.5] }, fn(B, i, p) {
  const s = I.fn(B, i, p); if (!s) return null; const a = B.atr[i], c = B.c[i];
  const lv = s.dir === 1 ? lowN(i, p.sn) - p.buf * a : highN(i, p.sn) + p.buf * a, stop = Math.abs(c - lv);
  if (stop < 0.5 * a || stop > 6 * a) return null; return { dir: s.dir, stop, rr: s.rr }; } };
const V = () => [
  ["新しいルール", compose(I, { bigBar: 0.6 }, ["minStop", "daily"])],
  ["＋4時間足（毎月選ぶ）", compose(I, { bigBar: 0.6 }, ["minStop", "daily", "h4"])],
  ["＋節目の損切り", compose(swing, { bigBar: 0.6 }, ["minStop", "daily"])],
  ["＋足の終わりが高値近く", compose(I, { bigBar: 0.6, closeNear: 0.3 }, ["minStop", "daily"])],
  ["＋平均から離れすぎない（毎月）", compose(I, { bigBar: 0.6 }, ["minStop", "daily", "notFar"])],
  ["＋発表の前後（毎月選ぶ）は対象外の確認用", compose(I, { bigBar: 0.6 }, ["minStop", "daily", "calm"])],
];
for (const [sp, sl] of [[0.8, 0.1], [1.2, 0.2]]) {
  COST.spread = sp; COST.slip = sl;
  console.log(`\nスプレッド${sp}ドル・ずれ${sl}ドル`);
  V().forEach(([n, S]) => report(B, n, S));
}
