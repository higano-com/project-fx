// 金15枚（15オンス）・損切り5万円で固定したとき、利確の幅をどうするのが良いか
// 損切りの幅（ドル）＝ 5万円 ÷（15オンス × ドル円）− 損切りのずれ。利確＝損切りの幅 × 倍率（毎月、直近3か月で選ぶ／固定）
import { loadCsv, prepare, STRATEGIES, COST, summarize } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report, rolling } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const I = STRATEGIES.ichimoku, QTY = 15, LOSS = 50000;
const fixed = rrs => ({ grid: { ...I.grid, slMult: [1.5], rr: rrs }, fn(B, i, p) {
  const s = I.fn(B, i, p); if (!s) return null;
  return { ...s, stop: Math.max(1, LOSS / (QTY * B.fx[i]) - COST.slip) };
} });
const avgStop = (() => { let s = 0, n = 0; for (let i = B.n - 2000; i < B.n; i++) { s += LOSS / (QTY * B.fx[i]) - COST.slip; n++; } return s / n; })();
console.log(`損切りの幅：最近は約${avgStop.toFixed(1)}ドル（${Math.round(avgStop * 10)}ピプス）。ふだんの1時間の値動き（最近）：約${(B.atr.slice(-2000).reduce((a, b) => a + b, 0) / 2000).toFixed(1)}ドル`);
console.log("1回2,500円で計算した成績（同じ割合で、5万円なら20倍）。見直しの日を4通りずらした平均\n");
report(B, "参考：今のルール（損切りは値動きの倍数）", compose(I, { bigBar: 0.6 }, ["minStop", "daily"]));
report(B, "固定の損切り・利確は毎月選ぶ", compose(fixed([1, 1.5, 2, 3, 4, 5]), { bigBar: 0.6 }, ["daily"]));
for (const r of [1, 1.5, 2, 3, 4, 5]) report(B, `固定の損切り・利確${r}倍（${(avgStop * r).toFixed(0)}ドル）`, compose(fixed([r]), { bigBar: 0.6 }, ["daily"]));
