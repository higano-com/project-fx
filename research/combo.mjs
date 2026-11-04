// 有力な2つ（大きな足で抜けたときだけ・節目の損切り）を、組み合わせ・コスト増・同じ落ち込みにそろえた比べ方で確かめる
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize, COST } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, START = Date.UTC(2021, 2, 1), HOLD = Date.UTC(2026, 4, 1), HALF = Date.UTC(2024, 0, 1), END = B.t[B.n - 1] + 1, YEN = 2500;
const I = STRATEGIES.ichimoku;
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const lowN = (i, n) => { let m = Infinity; for (let k = i - n; k < i; k++) m = Math.min(m, B.l[k]); return m; };
const highN = (i, n) => { let m = -Infinity; for (let k = i - n; k < i; k++) m = Math.max(m, B.h[k]); return m; };
const swing = { grid: { ...I.grid, sn: [12, 24, 48], buf: [0.2, 0.5] }, fn(B, i, p) {
  const s = I.fn(B, i, p); if (!s) return null; const a = B.atr[i], c = B.c[i];
  const lv = s.dir === 1 ? lowN(i, p.sn) - p.buf * a : highN(i, p.sn) + p.buf * a, stop = Math.abs(c - lv);
  if (stop < 0.5 * a || stop > 6 * a) return null; return { dir: s.dir, stop, rr: s.rr }; } };
function rolling(S, off) {
  const combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  const oos = [];
  for (let m = START + off * DAY; m < END; m += 30 * DAY) {
    const score = new Map(combos.map(x => [x, 0])), cnt = new Map(combos.map(x => [x, 0]));
    for (let k = 0; k < 4; k++) {
      const e = m - k * 7 * DAY, sc = new Map();
      for (const x of combos) { let n = 0, s = 0; for (const t of x.trades) if (t.t >= e - 91 * DAY && t.t < e) { n++; s += t.R; } sc.set(x, { n, s }); }
      for (const x of combos) { const me = sc.get(x); if (me.n < 5) continue; const ns = [me.s]; x.idx.forEach((v, kk) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[kk] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); })); score.set(x, score.get(x) + ns.reduce((a, b) => a + b, 0) / ns.length); cnt.set(x, cnt.get(x) + 1); }
    }
    let best = null; for (const x of combos) if (cnt.get(x) === 4 && (!best || score.get(x) > score.get(best))) best = x;
    if (best) for (const t of best.trades) if (t.t >= m && t.t < m + 30 * DAY) oos.push(t);
  }
  return oos;
}
const man = r => (r * YEN / 1e4).toFixed(1), avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const variants = [
  ["今のやり方", compose(I, {}, ["minStop", "daily"])],
  ["大きな足だけ", compose(I, { bigBar: 1.0 }, ["minStop", "daily"])],
  ["節目の損切り", compose(swing, {}, ["minStop", "daily"])],
  ["大きな足だけ＋節目の損切り", compose(swing, { bigBar: 1.0 }, ["minStop", "daily"])],
];
for (const sp of [0.8, 1.6]) {
  COST.spread = sp;
  console.log(`\n■ スプレッド ${sp}ドル（見直しの日を4通りずらした平均、1回2,500円）`);
  console.log("  名前　　　　　　　　　　　 損益　 回数 勝率 利益÷損失 落ち込み 損益÷落ち込み ｜前半　 後半　 最新6か月");
  for (const [name, S] of variants) {
    const runs = [0, 7, 14, 21].map(o => rolling(S, o));
    const part = f => runs.map(tr => summarize(tr.filter(f)));
    const A = part(() => true), h1 = part(t => t.t < HALF), h2 = part(t => t.t >= HALF && t.t < HOLD), F = part(t => t.t >= HOLD);
    const ratio = avg(A.map(s => s.sumR / Math.max(s.maxDDR, 0.1)));
    console.log(`  ${name.padEnd(14, "　")} ${man(avg(A.map(s => s.sumR))).padStart(5)}万 ${String(Math.round(avg(A.map(s => s.n)))).padStart(4)} ${(avg(A.map(s => s.win)) * 100).toFixed(0)}％ ${avg(A.map(s => s.pf)).toFixed(2)}　　 ${man(avg(A.map(s => s.maxDDR)))}万　 ${ratio.toFixed(2)}　　　｜${man(avg(h1.map(s => s.sumR)))}　${man(avg(h2.map(s => s.sumR)))}　${man(avg(F.map(s => s.sumR)))}`);
  }
}
