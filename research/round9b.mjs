// 第9回の続き：良かった2つ（4時間足の流れを毎月選ぶ・大きな足0.6）を、組み合わせとコスト増で確かめる
import { loadCsv, prepare, STRATEGIES, COST } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const I = STRATEGIES.ichimoku;
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
FILTERS.h4 = { opts: [0, 1], fn: (B, i, s, v) => !v || ((B.ema(80)[i] > B.ema(80)[i - 16]) === (s.dir === 1)) };
const V = () => [
  ["今のやり方", compose(I, {}, ["minStop", "daily"])],
  ["＋4時間足（毎月選ぶ）", compose(I, {}, ["minStop", "daily", "h4"])],
  ["＋大きな足0.6", compose(I, { bigBar: 0.6 }, ["minStop", "daily"])],
  ["＋両方", compose(I, { bigBar: 0.6 }, ["minStop", "daily", "h4"])],
];
for (const [sp, sl] of [[0.8, 0.1], [1.2, 0.2]]) {
  COST.spread = sp; COST.slip = sl;
  console.log(`\nスプレッド${sp}ドル・ずれ${sl}ドル`);
  const rows = V().map(([n, S]) => report(B, n, S));
  for (const r of rows) console.log(`    ${r.name}：見直しの日4通りの損益 ${r.spread.map(v => (v * 2500 / 1e4).toFixed(1)).join("・")}万円`);
}
