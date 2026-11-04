// losers.mjs で見つかった「負けが多い状態」を見送ると、本当に良くなるか（毎月見直しの中で確かめる）
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, START = Date.UTC(2021, 2, 1), HOLD = Date.UTC(2026, 4, 1), HALF = Date.UTC(2024, 0, 1), END = B.t[B.n - 1] + 1, YEN = 2500;
const jh = t => new Date(t + 9 * 3600e3).getUTCHours();
Object.assign(FILTERS, {
  noNY: { opts: [0, 1], fn: (B, i, s, v) => !v || (jh(B.t[i]) >= 8 && jh(B.t[i]) < 21) },
  bigBar: { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] },
});
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
const man = r => (r * YEN / 1e4).toFixed(1);
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
for (const [name, fixed, tuned] of [["そのまま", {}, []], ["ニューヨーク時間はいつも見送る", { noNY: 1 }, []], ["大きな足で抜けたときだけ（いつも）", { bigBar: 1.0 }, []], ["大きな足の基準を毎月選ぶ", {}, ["bigBar"]], ["両方（いつも）", { noNY: 1, bigBar: 1.0 }, []]]) {
  const S = compose(STRATEGIES.ichimoku, fixed, ["minStop", "daily", ...tuned]);
  const runs = [0, 7, 14, 21].map(o => rolling(S, o));
  const part = f => runs.map(tr => summarize(tr.filter(f)));
  const A = part(t => true), h1 = part(t => t.t < HALF), h2 = part(t => t.t >= HALF && t.t < HOLD), F = part(t => t.t >= HOLD);
  console.log(`■ ${name}：全体 平均${man(avg(A.map(s => s.sumR)))}万円（${A.map(s => man(s.sumR)).join("・")}） ${Math.round(avg(A.map(s => s.n)))}回 勝率${(avg(A.map(s => s.win)) * 100).toFixed(0)}％ 利益÷損失${avg(A.map(s => s.pf)).toFixed(2)} 落込${man(avg(A.map(s => s.maxDDR)))}万円 ｜前半${man(avg(h1.map(s => s.sumR)))} 後半${man(avg(h2.map(s => s.sumR)))} 最新6か月${man(avg(F.map(s => s.sumR)))}`);
}
