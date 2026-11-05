// 第11回：取り方のいろいろ（半分利確・買い増し・高値抜けで入る・判断がないときだけロンドン）
import { loadCsv, prepare, STRATEGIES, COST, summarize } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report, rolling, HALF, HOLD, YEN } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const I = STRATEGIES.ichimoku;
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const withOpt = (extraGrid, f) => ({ grid: { ...I.grid, ...extraGrid }, fn(B, i, p) { const s = I.fn(B, i, p); return s ? f(s, p) : null; } });
const V = {
  base: ["今のルール", compose(I, { bigBar: 0.6 }, ["minStop", "daily"])],
  half: ["半分を先に利確・残りは伸ばす", compose(withOpt({ h1: [1, 1.5] }, (s, p) => ({ ...s, half: p.h1 })), { bigBar: 0.6 }, ["minStop", "daily"])],
  add: ["伸びたら買い増す", compose(withOpt({ ad: [1, 1.5] }, (s, p) => ({ ...s, add: p.ad })), { bigBar: 0.6 }, ["minStop", "daily"])],
  trig: ["判断した足の高値（安値）を抜けたら入る", compose(withOpt({ tb: [0, 0.2] }, (s, p) => ({ ...s, trigBuf: p.tb })), { bigBar: 0.6 }, ["minStop", "daily"])],
  halfAdd: ["半分利確＋買い増し", compose(withOpt({ h1: [1, 1.5], ad: [1.5] }, (s, p) => ({ ...s, half: p.h1, add: p.ad })), { bigBar: 0.6 }, ["minStop", "daily"])],
};
// ロンドンの動き出し（newaim.mjs と同じ）
const jh = t => new Date(t + 9 * 3600e3).getUTCHours();
const session = { grid: { start: [16, 17], slMult: [1, 1.5, 2], rr: [1.5, 2, 3], maxW: [3, 5, 8] }, fn(B, i, p) {
  const h = jh(B.t[i]); if (h < p.start || h > 20) return null;
  let hh = -Infinity, ll = Infinity, n = 0;
  for (let k = i - 1; k >= i - 14 && k > 0; k--) { const hk = jh(B.t[k]); if (hk >= 8 && hk < 16) { hh = Math.max(hh, B.h[k]); ll = Math.min(ll, B.l[k]); n++; } }
  if (n < 5 || hh - ll > p.maxW * B.atr[i]) return null;
  const c = B.c[i], pc = B.c[i - 1];
  if (c > hh && pc <= hh) return { dir: 1, stop: p.slMult * B.atr[i], rr: p.rr, hold: 24 };
  if (c < ll && pc >= ll) return { dir: -1, stop: p.slMult * B.atr[i], rr: p.rr, hold: 24 };
  return null; } };
for (const [sp, sl] of [[0.8, 0.1], [1.2, 0.2]]) {
  COST.spread = sp; COST.slip = sl;
  console.log(`\nスプレッド${sp}ドル・ずれ${sl}ドル（1回2,500円・見直しの日4通りの平均）`);
  for (const [n, S] of Object.values(V)) report(B, n, S);
  // 判断がないときだけロンドンの動き出し（今のルールの取引と時間が重ならないものだけ足す）
  const man = r => (r * YEN / 1e4).toFixed(1), avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const rs = [0, 7, 14, 21].map(o => { const a = rolling(B, V.base[1], o), b = rolling(B, compose(session, {}, []), o);
    const busy = a.map(t => [t.t, t.t1]); const extra = b.filter(t => !busy.some(([x, y]) => t.t < y && t.t1 > x));
    return [...a, ...extra].sort((p, q) => p.t - q.t); });
  const A = rs.map(tr => summarize(tr)), h1 = rs.map(tr => summarize(tr.filter(t => t.t < HALF))), h2 = rs.map(tr => summarize(tr.filter(t => t.t >= HALF && t.t < HOLD))), F = rs.map(tr => summarize(tr.filter(t => t.t >= HOLD)));
  console.log(`  ${"判断がないときだけロンドン".padEnd(20, "　")} ${man(avg(A.map(s => s.sumR))).padStart(5)}万 ${String(Math.round(avg(A.map(s => s.n)))).padStart(3)}回 利÷損${avg(A.map(s => s.pf)).toFixed(2)} 落込${man(avg(A.map(s => s.maxDDR)))}万 ｜前半${man(avg(h1.map(s => s.sumR)))} 後半${man(avg(h2.map(s => s.sumR)))} 最新${man(avg(F.map(s => s.sumR)))}`);
}
