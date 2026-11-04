// アプリの「届く見込み」に使う数字：調整に使っていない期間（毎月の見直しの次の1か月）の取引だけから作る
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };   // アプリと同じ（抜けた足が0.6倍以上）
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, START = Date.UTC(2021, 2, 1), END = B.t[B.n - 1] + 1;
const S = compose(STRATEGIES.ichimoku, { bigBar: 0.6 }, ["minStop", "daily"]);
const combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p) }));
const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
const all = [];
for (const off of [0, 7, 14, 21]) for (let m = START + off * DAY; m < END; m += 30 * DAY) {
  const score = new Map(combos.map(x => [x, 0])), cnt = new Map(combos.map(x => [x, 0]));
  for (let k = 0; k < 4; k++) {
    const e = m - k * 7 * DAY, sc = new Map();
    for (const x of combos) { let n = 0, s = 0; for (const t of x.trades) if (t.t >= e - 91 * DAY && t.t < e) { n++; s += t.R; } sc.set(x, { n, s }); }
    for (const x of combos) { const me = sc.get(x); if (me.n < 5) continue; const ns = [me.s]; x.idx.forEach((v, kk) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[kk] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); })); score.set(x, score.get(x) + ns.reduce((a, b) => a + b, 0) / ns.length); cnt.set(x, cnt.get(x) + 1); }
  }
  let best = null; for (const x of combos) if (cnt.get(x) === 4 && (!best || score.get(x) > score.get(best))) best = x;
  if (best) for (const t of best.trades) if (t.t >= m && t.t < m + 30 * DAY) all.push(t.R);
}
const n = all.length, mean = all.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
let td = 0; for (let t = START; t < END; t += DAY) { const w = new Date(t + 9 * 3600e3).getUTCDay(); if (w >= 1 && w <= 5) td++; }
console.log(JSON.stringify({ trades: n / 4, meanR: +mean.toFixed(4), sdR: +sd.toFixed(4), tradesPerTradingDay: +((n / 4) / td).toFixed(4), period: "2021-03〜2026-11", note: "見直しの日を0・7・14・21日ずらした4通りの平均" }));
