// 共通：毎月・1週間ずつずらした4回分の直近3か月で設定を選び、次の1か月に使う（見直しの日を off 日ずらす）
import { gridList, runStrategy, summarize } from "./engine.mjs";
export const DAY = 86400e3, START = Date.UTC(2021, 2, 1), HOLD = Date.UTC(2026, 4, 1), HALF = Date.UTC(2024, 0, 1), YEN = 2500;
export function rolling(B, S, off = 0, minN = 4) {
  const END = B.t[B.n - 1] + 1;
  const combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  const oos = [];
  for (let m = START + off * DAY; m < END; m += 30 * DAY) {
    const score = new Map(combos.map(x => [x, 0])), cnt = new Map(combos.map(x => [x, 0]));
    for (let k = 0; k < 4; k++) {
      const e = m - k * 7 * DAY, sc = new Map();
      for (const x of combos) { let n = 0, s = 0; for (const t of x.trades) if (t.t >= e - 91 * DAY && t.t < e) { n++; s += t.R; } sc.set(x, { n, s }); }
      for (const x of combos) { const me = sc.get(x); if (me.n < minN) continue; const ns = [me.s]; x.idx.forEach((v, kk) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[kk] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); })); score.set(x, score.get(x) + ns.reduce((a, b) => a + b, 0) / ns.length); cnt.set(x, cnt.get(x) + 1); }
    }
    let best = null; for (const x of combos) if (cnt.get(x) === 4 && (!best || score.get(x) > score.get(best))) best = x;
    if (best) for (const t of best.trades) if (t.t >= m && t.t < m + 30 * DAY) oos.push(t);
  }
  return oos;
}
const man = r => (r * YEN / 1e4).toFixed(1), avg = a => a.reduce((x, y) => x + y, 0) / a.length;
// 4通りの見直し日で評価し、1行にまとめる（年ごとの回数・損益も）
export function report(B, name, S) {
  const runs = [0, 7, 14, 21].map(o => rolling(B, S, o));
  const part = f => runs.map(tr => summarize(tr.filter(f)));
  const A = part(() => true), h1 = part(t => t.t < HALF), h2 = part(t => t.t >= HALF && t.t < HOLD), F = part(t => t.t >= HOLD);
  const yr = {}; for (const tr of runs) for (const t of tr) { const y = new Date(t.t).getUTCFullYear(); (yr[y] ||= []).push(t); }
  const r = { name, sum: avg(A.map(s => s.sumR)), n: avg(A.map(s => s.n)), pf: avg(A.map(s => s.pf)), dd: avg(A.map(s => s.maxDDR)), h1: avg(h1.map(s => s.sumR)), h2: avg(h2.map(s => s.sumR)), F: avg(F.map(s => s.sumR)), spread: A.map(s => s.sumR) };
  console.log(`  ${name.padEnd(20, "　")} ${man(r.sum).padStart(5)}万 ${String(Math.round(r.n)).padStart(3)}回 利÷損${r.pf.toFixed(2)} 落込${man(r.dd)}万 ｜前半${man(r.h1)} 後半${man(r.h2)} 最新${man(r.F)} ｜年:${Object.keys(yr).sort().map(y => `${String(y).slice(2)}年${Math.round(yr[y].length / 4)}回${man(summarize(yr[y]).sumR / 4)}`).join(" ")}`);
  return r;
}
