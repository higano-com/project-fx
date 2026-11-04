// くり返しの検証：今のアプリのルール（一目均衡表＋損切り幅の下限＋日足の流れ、毎月・直近3か月で見直し）が崩れないか
// 1) コストが増えたとき 2) 見直しの日がずれたとき 3) 取引の順番がばらばらになったとき 4) 年ごと
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize, COST } from "./engine.mjs";
import { compose } from "./filters.mjs";

const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, START = Date.UTC(2021, 2, 1), END = B.t[B.n - 1] + 1, YEN = 2500;
const S = compose(STRATEGIES.ichimoku, {}, ["minStop", "daily"]);
const man = r => ((r * YEN) / 1e4).toFixed(1) + "万円";

function rolling(offsetDays = 0) {
  const combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  const oos = [];
  for (let m = START + offsetDays * DAY; m < END; m += 30 * DAY) {
    const sc = new Map(); let best = null;
    for (const x of combos) { let n = 0, s = 0; for (const t of x.trades) if (t.t >= m - 91 * DAY && t.t < m) { n++; s += t.R; } sc.set(x, { n, s }); }
    for (const x of combos) {
      const me = sc.get(x); if (me.n < 5) continue;
      const ns = [me.s]; x.idx.forEach((v, k) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[k] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); }));
      const rs = ns.reduce((a, b) => a + b, 0) / ns.length; if (!best || rs > best.rs) best = { x, rs };
    }
    if (best) for (const t of best.x.trades) if (t.t >= m && t.t < m + 30 * DAY) oos.push(t);
  }
  return oos;
}
const line = (label, tr) => { const s = summarize(tr); return `  ${label.padEnd(18, "　")} ${man(s.sumR).padStart(7)}（${s.n}回・勝率${(s.win * 100).toFixed(0)}％・利益÷損失${s.pf.toFixed(2)}・一番の落ち込み${man(s.maxDDR)}）`; };

console.log("■ 1. コストが増えたとき（2021年3月〜2026年11月・1回2,500円）");
const base = rolling();
for (const [sp, sl] of [[0.8, 0.1], [1.2, 0.1], [1.6, 0.1], [0.8, 0.3], [1.6, 0.3]]) {
  COST.spread = sp; COST.slip = sl;
  console.log(line(`スプレッド${sp}・ずれ${sl}`, sp === 0.8 && sl === 0.1 ? base : rolling()));
}
COST.spread = 0.8; COST.slip = 0.1;

console.log("\n■ 2. 毎月の見直しの日がずれたとき");
const offs = [0, 7, 14, 21].map(o => ({ o, tr: o ? rolling(o) : base }));
for (const { o, tr } of offs) console.log(line(`見直しを${o}日ずらす`, tr));

console.log("\n■ 3. 取引の順番がばらばらになったとき（実際の取引から1年分を1万回つくる）");
const perYear = Math.round(base.length / ((END - START) / (365 * DAY)));
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const finals = [], dds = []; let neg = 0, stop5 = 0;
for (let k = 0; k < 10000; k++) {
  let eq = 0, pk = 0, dd = 0;
  for (let j = 0; j < perYear; j++) { eq += base[Math.floor(rnd() * base.length)].R * YEN; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  finals.push(eq); dds.push(dd); if (eq < 0) neg++; if (dd >= 50000) stop5++;
}
finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
const q = (a, f) => a[Math.floor(a.length * f)];
console.log(`  1年あたり${perYear}回の取引として`);
console.log(`  1年の損益：真ん中 ${(q(finals, .5) / 1e4).toFixed(1)}万円、悪い方から1割 ${(q(finals, .1) / 1e4).toFixed(1)}万円、良い方から1割 ${(q(finals, .9) / 1e4).toFixed(1)}万円`);
console.log(`  1年でマイナスになる割合：${(neg / 100).toFixed(1)}％`);
console.log(`  一番の落ち込み：真ん中 ${(q(dds, .5) / 1e4).toFixed(1)}万円、悪い方から1割 ${(q(dds, .9) / 1e4).toFixed(1)}万円`);
console.log(`  1年のうちに「5％で停止」（100万円で5万円の減り）に届く割合：${(stop5 / 100).toFixed(1)}％`);

console.log("\n■ 4. 年ごと");
for (let y = 2021; y <= 2026; y++) console.log(line(`${y}年`, base.filter(t => new Date(t.t).getUTCFullYear() === y)));

// 改善案：見直しのとき、1週間ずつずらした4回分（直近3か月×4）の平均の点で選ぶ → 見直しの日によるぶれを減らす
function rollingSmooth(offsetDays = 0, looks = 4) {
  const combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  const oos = [];
  for (let m = START + offsetDays * DAY; m < END; m += 30 * DAY) {
    const score = new Map(combos.map(x => [x, 0])), cnt = new Map(combos.map(x => [x, 0]));
    for (let k = 0; k < looks; k++) {
      const e = m - k * 7 * DAY, sc = new Map();
      for (const x of combos) { let n = 0, s = 0; for (const t of x.trades) if (t.t >= e - 91 * DAY && t.t < e) { n++; s += t.R; } sc.set(x, { n, s }); }
      for (const x of combos) {
        const me = sc.get(x); if (me.n < 5) continue;
        const ns = [me.s]; x.idx.forEach((v, kk) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[kk] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); }));
        score.set(x, score.get(x) + ns.reduce((a, b) => a + b, 0) / ns.length); cnt.set(x, cnt.get(x) + 1);
      }
    }
    let best = null; for (const x of combos) if (cnt.get(x) === looks && (!best || score.get(x) > score.get(best))) best = x;
    if (best) for (const t of best.trades) if (t.t >= m && t.t < m + 30 * DAY) oos.push(t);
  }
  return oos;
}
console.log("\n■ 5. 改善案：1週間ずつずらした4回分の平均で選ぶ");
const sm = [0, 7, 14, 21].map(o => ({ o, tr: rollingSmooth(o) }));
for (const { o, tr } of sm) console.log(line(`見直しを${o}日ずらす`, tr));
const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length, sd = arr => { const m = avg(arr); return Math.sqrt(avg(arr.map(v => (v - m) ** 2))); };
const a1 = offs.map(x => summarize(x.tr).sumR * YEN / 1e4), a2 = sm.map(x => summarize(x.tr).sumR * YEN / 1e4);
console.log(`  今のやり方：平均 ${avg(a1).toFixed(1)}万円・ばらつき ${sd(a1).toFixed(1)}万円 ／ 改善案：平均 ${avg(a2).toFixed(1)}万円・ばらつき ${sd(a2).toFixed(1)}万円`);
const F = Date.UTC(2026, 4, 1);
console.log(`  最新6か月（2026年5月〜）：今のやり方 ${offs.map(x => man(summarize(x.tr.filter(t => t.t >= F)).sumR)).join("・")} ／ 改善案 ${sm.map(x => man(summarize(x.tr.filter(t => t.t >= F)).sumR)).join("・")}`);
