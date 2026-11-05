// 短い時間（3分足・5分足）のレンジを取りに行く売買を、1分足のデータで確かめる
// 使い方：node research/range1m.mjs
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadCsv, prepare, gridList, runStrategy, summarize, COST } from "./engine.mjs";
import { compose } from "./filters.mjs";

const text = gunzipSync(readFileSync("data/xau_usd_1min.csv.gz")).toString("utf8");
const m1 = text.trim().split("\n").slice(1).map(l => { const [t, o, h, lo, c] = l.split(","); return [Date.parse(t.replace(" ", "T") + ":00Z"), +o, +h, +lo, +c]; });
const jpy = loadCsv("data/usd_jpy_1h.csv");
const agg = (rows, ms) => { const out = []; for (const r of rows) { const k = Math.floor(r[0] / ms) * ms, L = out[out.length - 1]; if (!L || L[0] !== k) out.push([k, r[1], r[2], r[3], r[4]]); else { L[2] = Math.max(L[2], r[2]); L[3] = Math.min(L[3], r[3]); L[4] = r[4]; } } return out; };
const iso = t => new Date(t).toISOString().slice(0, 10);
console.log(`1分足：${m1.length}本（${iso(m1[0][0])}〜${iso(m1[m1.length - 1][0])}）`);

function rangeStrat(B) {
  const hhN = (i, n) => { let m = -Infinity; for (let k = i - n + 1; k <= i; k++) m = Math.max(m, B.h[k]); return m; };
  const llN = (i, n) => { let m = Infinity; for (let k = i - n + 1; k <= i; k++) m = Math.min(m, B.l[k]); return m; };
  return {
    grid: { n: [10, 20, 40], k: [8, 10, 15], edge: [0.2, 0.3], buf: [1, 2], tgt: [0.5, 0.8], hold: [10, 20, 40] },
    fn(B, i, p) {
      const hh = hhN(i - 1, p.n), ll = llN(i - 1, p.n), w = hh - ll, c = B.c[i];
      if (!(w > 0) || w > p.k || c > hh || c < ll) return null;
      const pos = (c - ll) / w; let dir = 0;
      if (pos <= p.edge && c > B.o[i]) dir = 1;
      if (pos >= 1 - p.edge && c < B.o[i]) dir = -1;
      if (!dir) return null;
      const sl = dir === 1 ? ll - p.buf : hh + p.buf, target = dir === 1 ? ll + w * (0.2 + p.tgt * 0.8) : hh - w * (0.2 + p.tgt * 0.8);
      const stop = Math.abs(c - sl), tpd = (target - c) * dir;
      if (tpd <= 0 || stop <= 0) return null;
      return { dir, stop, rr: tpd / stop, hold: p.hold };
    },
  };
}
// 調整は直前の4週間、確認は次の1週間をくり返す（データが約5か月しかないため短く）
function walk(B, S) {
  const DAY = 86400e3, combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p, { from: 60 }) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  const t0 = B.t[0] + 28 * DAY, t1 = B.t[B.n - 1], oos = [];
  for (let m = t0; m < t1; m += 7 * DAY) {
    const sc = new Map(); let best = null;
    for (const x of combos) { let n = 0, s = 0; for (const t of x.trades) if (t.t >= m - 28 * DAY && t.t < m) { n++; s += t.R; } sc.set(x, { n, s }); }
    for (const x of combos) { const me = sc.get(x); if (me.n < 10) continue; const ns = [me.s]; x.idx.forEach((v, k) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[k] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); })); const rs = ns.reduce((a, b) => a + b, 0) / ns.length; if (!best || rs > best.rs) best = { x, rs }; }
    if (best) for (const t of best.x.trades) if (t.t >= m && t.t < m + 7 * DAY) oos.push(t);
  }
  return { oos, inAll: Math.max(...combos.map(x => summarize(x.trades).sumR)) };
}
const man = r => (r * 2500 / 1e4).toFixed(1);
for (const [label, ms] of [["3分足", 180e3], ["5分足", 300e3]]) {
  const B = prepare(agg(m1, ms), jpy);
  for (const sp of [0.8, 0.4]) {
    COST.spread = sp; COST.slip = 0.1;
    const S = compose(rangeStrat(B), {}, []), r = walk(B, S), s = summarize(r.oos);
    const wk = {}; for (const t of r.oos) { const k = iso(t.t).slice(0, 7); (wk[k] ||= []).push(t); }
    console.log(`■ ${label}・スプレッド${sp}ドル：確認期間 ${s.n}回 勝率${(s.win * 100).toFixed(0)}％ 損益${man(s.sumR)}万円 利益÷損失${s.pf.toFixed(2)} 落ち込み${man(s.maxDDR)}万円（参考：全期間で一番良かった設定 ${man(r.inAll)}万円）`);
    console.log(`   月ごと：${Object.entries(wk).map(([k, a]) => `${k} ${a.length}回 ${man(summarize(a).sumR)}`).join(" ／ ")}`);
  }
}
