// 深い検証：ウォークフォワード（1年で調整→次の3か月で確認、を繰り返す）、
// 相場のパターン別・年別の成績、目標（30日で+200万円、12月末までに+350万円）に届く確率
import { writeFileSync, mkdirSync } from "node:fs";
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize, REGIMES, COST } from "./engine.mjs";

const xau = loadCsv("data/xau_usd_1h.csv"), jpy = loadCsv("data/usd_jpy_1h.csv");
const B = prepare(xau, jpy);
const DAY = 86400e3, iso = t => new Date(t).toISOString().slice(0, 10);
console.log(`足 ${B.n}本（除いた取引時間外の足 ${B.removed}本）、直した飛び値 ${B.fixes.length}件`, B.fixes.map(f => `${new Date(f.t).toISOString().slice(0,16)} ${f.field} ${f.from}→${f.to.toFixed(2)}`));

const TRAIN = 365 * DAY, TEST = 91 * DAY;
const t0 = B.t[600], tEnd = B.t[B.n - 1];
const windows = [];
for (let a = t0; a + TRAIN + 30 * DAY < tEnd; a += TEST) windows.push({ trainA: a, trainB: a + TRAIN, testA: a + TRAIN, testB: Math.min(a + TRAIN + TEST, tEnd + 1) });
console.log(`ウォークフォワード：${windows.length}回（${iso(windows[0].testA)}〜${iso(tEnd)} を確認期間として使う）`);

const inWin = (tr, a, b) => tr.filter(x => x.t >= a && x.t < b);
const sumR = tr => tr.reduce((s, x) => s + x.R, 0);
const results = {};
for (const [key, S] of Object.entries(STRATEGIES)) {
  const combos = gridList(S.grid).map(c => ({ ...c, trades: runStrategy(B, S, c.p) }));
  const byIdx = new Map(combos.map(c => [c.idx.join(","), c]));
  const oos = [], oosBest = [], picks = [];
  for (const w of windows) {
    const score = new Map();
    for (const c of combos) { const tr = inWin(c.trades, w.trainA, w.trainB); score.set(c, { n: tr.length, s: sumR(tr) }); }
    let robust = null, best = null;
    for (const c of combos) {
      const me = score.get(c); if (me.n < 20) continue;
      const ns = [me.s];
      c.idx.forEach((v, k) => [-1, 1].forEach(d => { const idx = [...c.idx]; idx[k] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(score.get(nb).s); }));
      const rs = ns.reduce((a, b) => a + b, 0) / ns.length;
      if (!robust || rs > robust.rs) robust = { c, rs };
      if (!best || me.s > best.s) best = { c, s: me.s };
    }
    if (!robust) continue;
    picks.push({ test: iso(w.testA), p: robust.c.p, trainR: +score.get(robust.c).s.toFixed(1) });
    oos.push(...inWin(robust.c.trades, w.testA, w.testB));
    oosBest.push(...inWin(best.c.trades, w.testA, w.testB));
  }
  // 調整期間での成績（参考：選んだ設定の、調整に使った期間での成績の平均）
  const byRegime = Object.fromEntries(REGIMES.map(r => [r, summarize(oos.filter(x => x.regime === r))]));
  const byYear = {}; for (const x of oos) { const y = new Date(x.t).getUTCFullYear(); (byYear[y] ||= []).push(x); }
  results[key] = {
    name: S.name, oos: summarize(oos), oosBestInTrain: summarize(oosBest),
    byRegime, byYear: Object.fromEntries(Object.entries(byYear).map(([y, tr]) => [y, summarize(tr)])),
    picks, trades: oos,
    perMonth: oos.length / ((tEnd - windows[0].testA) / (30 * DAY)),
  };
  const o = results[key].oos;
  console.log(`\n■ ${S.name}：確認期間 ${o.n}回 勝率${(o.win*100).toFixed(0)}% 平均${o.avgR.toFixed(3)}R 合計${o.sumR.toFixed(1)}R PF${o.pf.toFixed(2)} 最大落込${o.maxDDR.toFixed(1)}R（月${results[key].perMonth.toFixed(1)}回）`);
  console.log(`  （参考：調整期間で一番だった設定をそのまま使った場合 合計${results[key].oosBestInTrain.sumR.toFixed(1)}R PF${results[key].oosBestInTrain.pf.toFixed(2)}）`);
  console.log("  パターン別:", REGIMES.map(r => `${r} ${byRegime[r].n}回 ${byRegime[r].sumR.toFixed(1)}R`).join(" / "));
  console.log("  年別:", Object.entries(results[key].byYear).map(([y, s]) => `${y} ${s.n}回 ${s.sumR.toFixed(1)}R`).join(" / "));
}

/* 目標に届く確率：確認期間の実際の取引の並びを、毎日ずらした開始日から当てはめる（複利。GMOのレバレッジ20倍を上限に） */
const TARGETS = [
  { key: "d30", label: "30日で+200万円（100万→300万）", days: 30, goal: 3_000_000 },
  { key: "dec", label: "12月末までに+350万円（100万→450万、残り57日）", days: 57, goal: 4_500_000 },
];
const FRACS = [0.0025, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 1];   // 1回にかける割合（1=レバレッジの上限まで）
function simulate(tr, days, goal, f) {
  if (!tr.length) return null;
  const a0 = tr[0].t, a1 = tr[tr.length - 1].t - days * DAY;
  let n = 0, hit = 0, half = 0, down20 = 0, ends = [];
  for (let s = a0; s <= a1; s += DAY) {
    let eq = 1_000_000, reached = false, mn = eq;
    for (const x of tr) {
      if (x.t < s) continue; if (x.t >= s + days * DAY) break;
      const frac = Math.min(f, 20 * x.stopFrac);     // 証拠金の上限：持てる量 ≦ 資金×20倍÷価格
      eq = Math.max(0, eq * (1 + frac * x.R));
      mn = Math.min(mn, eq); if (eq >= goal) reached = true;
    }
    n++; if (reached) hit++; if (mn <= 500_000) half++; if (mn <= 800_000) down20++; ends.push(eq);
  }
  ends.sort((a, b) => a - b);
  return { runs: n, pHit: hit / n, pHalf: half / n, pDown20: down20 / n, median: ends[Math.floor(n / 2)], p10: ends[Math.floor(n * 0.1)], p90: ends[Math.floor(n * 0.9)] };
}
const odds = {};
for (const [key, r] of Object.entries(results)) {
  odds[key] = {};
  for (const T of TARGETS) odds[key][T.key] = FRACS.map(f => ({ f, ...simulate(r.trades, T.days, T.goal, f) }));
}
console.log("\n■ 目標に届く確率（確認期間の実際の取引で、開始日を毎日ずらして試した割合）");
for (const T of TARGETS) {
  console.log(`\n${T.label}`);
  for (const [key, r] of Object.entries(results)) {
    console.log(`  ${r.name}:`);
    for (const x of odds[key][T.key]) console.log(`    1回に資金の${x.f === 1 ? "上限まで" : (x.f * 100) + "%"}: 届いた ${(x.pHit*100).toFixed(1)}% ／ 一時半分以下 ${(x.pHalf*100).toFixed(1)}% ／ 一時2割減 ${(x.pDown20*100).toFixed(1)}% ／ 最後の資金 中央値 ${Math.round(x.median/1e4)}万円（下位1割 ${Math.round(x.p10/1e4)}万・上位1割 ${Math.round(x.p90/1e4)}万）〔${x.runs}通り〕`);
  }
}

/* 参考：金そのものの値動きで、30日に動いた幅（どの方向でも完璧に当てた場合の上限の目安） */
const moves = []; for (let i = 0; i < B.n; i += 23) { let j = i; while (j < B.n && B.t[j] < B.t[i] + 30 * DAY) j++; if (j >= B.n) break; let hi = -Infinity, lo = Infinity; for (let k = i; k < j; k++) { hi = Math.max(hi, B.h[k]); lo = Math.min(lo, B.l[k]); } moves.push((hi - lo) / B.c[i]); }
moves.sort((a, b) => a - b);
const move = { median: moves[Math.floor(moves.length / 2)], p90: moves[Math.floor(moves.length * 0.9)], max: moves[moves.length - 1] };
console.log(`\n■ 30日間の金の値幅（高値−安値）：中央値 ${(move.median*100).toFixed(1)}%、上位1割 ${(move.p90*100).toFixed(1)}%、最大 ${(move.max*100).toFixed(1)}%`);
console.log(`  レバレッジ20倍で、最も良い場合に一度だけ当てたときの利益の目安：中央値 ${(move.median*20*100).toFixed(0)}%、上位1割 ${(move.p90*20*100).toFixed(0)}%`);

mkdirSync("research/out", { recursive: true });
writeFileSync("research/out/results.json", JSON.stringify({
  generatedAt: new Date().toISOString(), bars: B.n, removed: B.removed, fixes: B.fixes, cost: COST,
  period: { from: iso(B.t[0]), to: iso(tEnd), oosFrom: iso(windows[0].testA) }, windows: windows.length,
  strategies: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { ...r, trades: undefined, equity: r.trades.map(x => [x.t, +x.R.toFixed(3)]) }])),
  odds, move,
}, null, 1));
console.log("\n保存：research/out/results.json");
