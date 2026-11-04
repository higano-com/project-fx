// 「損切り幅の下限16ドル」が、たまたま16ドルだけ良いのではないか（前後の値でも良いか）と、年ごとの回数を確かめる
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, START = Date.UTC(2021, 2, 1), HOLD = Date.UTC(2026, 4, 1), END = B.t[B.n - 1] + 1, YEN = 2500;
FILTERS.ms = { opts: [0], fn: (B, i, s, v) => s.stop >= v };
function rolling(S, off) {
  const combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  const oos = [];
  for (let m = START + off * DAY; m < END; m += 30 * DAY) {
    const score = new Map(combos.map(x => [x, 0])), cnt = new Map(combos.map(x => [x, 0]));
    for (let k = 0; k < 4; k++) {
      const e = m - k * 7 * DAY, sc = new Map();
      for (const x of combos) { let n = 0, s = 0; for (const t of x.trades) if (t.t >= e - 91 * DAY && t.t < e) { n++; s += t.R; } sc.set(x, { n, s }); }
      for (const x of combos) { const me = sc.get(x); if (me.n < 4) continue; const ns = [me.s]; x.idx.forEach((v, kk) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[kk] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); })); score.set(x, score.get(x) + ns.reduce((a, b) => a + b, 0) / ns.length); cnt.set(x, cnt.get(x) + 1); }
    }
    let best = null; for (const x of combos) if (cnt.get(x) === 4 && (!best || score.get(x) > score.get(best))) best = x;
    if (best) for (const t of best.trades) if (t.t >= m && t.t < m + 30 * DAY) oos.push(t);
  }
  return oos;
}
const man = r => (r * YEN / 1e4).toFixed(1), avg = a => a.reduce((x, y) => x + y, 0) / a.length;
console.log("損切り幅の下限（ドル）ごと：損益・回数・利益÷損失・落ち込み・最新6か月 ／ 年ごとの回数と損益（0日ずらし）");
for (const v of [0, 8, 12, 14, 16, 18, 20, 24, 30]) {
  const S = compose(STRATEGIES.ichimoku, { ms: v }, ["daily"]);
  const runs = [0, 7, 14, 21].map(o => rolling(S, o));
  const A = runs.map(tr => summarize(tr)), F = runs.map(tr => summarize(tr.filter(t => t.t >= HOLD)));
  const yr = {}; for (const t of runs[0]) { const y = new Date(t.t).getUTCFullYear(); (yr[y] ||= []).push(t); }
  console.log(`  ${String(v).padStart(2)}ドル：${man(avg(A.map(s => s.sumR))).padStart(5)}万 ${String(Math.round(avg(A.map(s => s.n)))).padStart(3)}回 ${avg(A.map(s => s.pf)).toFixed(2)} 落込${man(avg(A.map(s => s.maxDDR)))}万 最新${man(avg(F.map(s => s.sumR)))}万 ｜ ${Object.entries(yr).map(([y, a]) => `${y}:${a.length}回${man(summarize(a).sumR)}`).join(" ")}`);
}
