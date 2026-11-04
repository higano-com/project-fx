// 第4回の検証：経済指標の発表と、金利・ドルの強さ・市場の不安の大きさ
// 「毎月・直近3か月で見直し」の中で、足したほうが良いかを確かめる
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { loadEvents, loadDaily, alignDaily } from "./events.mjs";

const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, H = 3600e3, START = Date.UTC(2021, 2, 1), HOLD = Date.UTC(2026, 4, 1), HALF = Date.UTC(2024, 0, 1), END = B.t[B.n - 1] + 1;
const EV = loadEvents();
const mac = { ry: alignDaily(B, loadDaily("DFII10")), y10: alignDaily(B, loadDaily("DGS10")), usd: alignDaily(B, loadDaily("DTWEXBGS")), vix: alignDaily(B, loadDaily("VIXCLS"), 1) };

/* 発表の前後を印にする */
function blockArr(kinds, pre, post) {
  const a = new Uint8Array(B.n); let k = 0;
  for (const e of EV) {
    if (!kinds.includes(e.kind)) continue;
    while (k < B.n && B.t[k] < e.t - pre * H) k++;
    for (let i = k; i < B.n && B.t[i] < e.t + post * H; i++) a[i] = 1;
  }
  return a;
}
function flatArr(kinds) {   // 発表の1時間前に始まる足で決済
  const a = new Uint8Array(B.n);
  for (const e of EV) { if (!kinds.includes(e.kind)) continue; let j = -1; for (let i = 0; i < B.n; i++) { if (B.t[i] > e.t - H) break; j = i; } if (j >= 0 && B.t[j] > e.t - 7 * H) a[j] = 1; }
  return a;
}
const ALL = ["nfp", "cpi", "fomc"];
const BLK = { "前後1時間": blockArr(ALL, 1, 1), "前後2時間": blockArr(ALL, 2, 2), "前3時間・後1時間": blockArr(ALL, 3, 1), "前6時間・後2時間": blockArr(ALL, 6, 2), "金利の決定だけ前後3時間": blockArr(["fomc"], 3, 3), "雇用統計だけ前後2時間": blockArr(["nfp"], 2, 2) };
Object.assign(FILTERS, {
  event:  { name: "発表の前後は見送る", opts: ["なし", "前後1時間", "前後2時間", "前3時間・後1時間", "前6時間・後2時間"], fn: (B, i, s, v) => v === "なし" || !BLK[v][i] },
  eventFomc: { name: "金利の決定の前後は見送る", opts: ["なし", "金利の決定だけ前後3時間"], fn: (B, i, s, v) => v === "なし" || !BLK[v][i] },
  eventNfp: { name: "雇用統計の前後は見送る", opts: ["なし", "雇用統計だけ前後2時間"], fn: (B, i, s, v) => v === "なし" || !BLK[v][i] },
  ry:  { name: "実質金利と同じ向きだけ（下がっていれば買い）", opts: [0, 1], fn: (B, i, s, v) => !v || !isFinite(mac.ry.chg[i]) || (s.dir === 1 ? mac.ry.chg[i] < 0 : mac.ry.chg[i] > 0) },
  y10: { name: "10年金利と同じ向きだけ（下がっていれば買い）", opts: [0, 1], fn: (B, i, s, v) => !v || !isFinite(mac.y10.chg[i]) || (s.dir === 1 ? mac.y10.chg[i] < 0 : mac.y10.chg[i] > 0) },
  usd: { name: "ドルの強さと同じ向きだけ（ドル安なら買い）", opts: [0, 1], fn: (B, i, s, v) => !v || !isFinite(mac.usd.chg[i]) || (s.dir === 1 ? mac.usd.chg[i] < 0 : mac.usd.chg[i] > 0) },
  vix: { name: "市場の不安が大きすぎたら見送る", opts: [0, 30, 25], fn: (B, i, s, v) => !v || !isFinite(mac.vix.val[i]) || mac.vix.val[i] < v },
});

const BASES = {
  ichimokuF: { name: "一目均衡表＋損切り幅の下限＋日足の流れ（今のアプリ）", base: STRATEGIES.ichimoku, tuned: ["minStop", "daily"] },
  bollingerF: { name: "ボリンジャーバンド＋日足の流れ", base: STRATEGIES.bollinger, tuned: ["daily"] },
  pullbackDaily: { name: "押し目・戻り＋日足の流れ", base: STRATEGIES.pullbackDaily, tuned: [] },
};
function rollingMonthly(S, opts = {}) {
  const combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p, opts) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  const oos = [];
  for (let m = START; m < END; m += 30 * DAY) {
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
const ev = tr => ({ A: summarize(tr.filter(x => x.t < HOLD)), h1: summarize(tr.filter(x => x.t < HALF)), h2: summarize(tr.filter(x => x.t >= HALF && x.t < HOLD)), F: summarize(tr.filter(x => x.t >= HOLD)) });
const man = r => ((r * 2500) / 1e4).toFixed(1) + "万円";
const line = (label, r, base) => {
  const good = base && r.A.sumR > base.A.sumR && r.h1.sumR >= base.h1.sumR && r.h2.sumR >= base.h2.sumR;
  return `  ${base ? (good ? "○" : "×") : "　"} ${label.padEnd(24, "　")} 確認 ${man(r.A.sumR).padStart(7)}（${r.A.n}回・利益÷損失${(isFinite(r.A.pf) ? r.A.pf : 0).toFixed(2)}・落込${man(r.A.maxDDR)}） 前半${man(r.h1.sumR)} 後半${man(r.h2.sumR)} ｜最新6か月 ${man(r.F.sumR)}（${r.F.n}回）`;
};
console.log(`確認：${new Date(START).toISOString().slice(0,10)}〜2026-04-30、最新6か月：2026-05〜。毎月・直近3か月で見直し。1回2,500円で計算。○＝全体・前半・後半のすべてで良くなった`);
for (const [k, c] of Object.entries(BASES)) {
  console.log(`\n■ ${c.name}`);
  const base = ev(rollingMonthly(compose(c.base, {}, c.tuned)));
  console.log(line("そのまま", base));
  for (const fk of ["event", "eventFomc", "eventNfp", "ry", "y10", "usd", "vix"]) {
    console.log(line(`＋${FILTERS[fk].name}（毎月選ぶ）`, ev(rollingMonthly(compose(c.base, {}, [...c.tuned, fk]))), base));
  }
  // 決めうち（毎月選ばず、いつも使う）
  console.log(line("＋発表の前後2時間はいつも見送る", ev(rollingMonthly(compose(c.base, { event: "前後2時間" }, c.tuned))), base));
  console.log(line("＋発表の1時間前に決済＋前後2時間見送り", ev(rollingMonthly(compose(c.base, { event: "前後2時間" }, c.tuned), { flat: flatArr(ALL) })), base));
  console.log(line("＋実質金利と同じ向きだけ（いつも）", ev(rollingMonthly(compose(c.base, { ry: 1 }, c.tuned))), base));
  console.log(line("＋ドルの強さと同じ向きだけ（いつも）", ev(rollingMonthly(compose(c.base, { usd: 1 }, c.tuned))), base));
}

// 組み合わせ（押し目・戻り＋日足の流れ に、効果があったものを重ねる）と、1つずつ外す
console.log("\n■ 押し目・戻り＋日足の流れ：効果があったものの組み合わせ");
const pd = BASES.pullbackDaily, pdBase = ev(rollingMonthly(compose(pd.base, {}, [])));
for (const set of [["y10"], ["event", "y10"], ["event", "y10", "usd"], ["event", "y10", "ry"], ["event", "y10", "usd", "ry", "eventNfp"]]) {
  console.log(line("＋" + set.map(k => FILTERS[k].name.replace(/（.*?）/, "")).join("＋"), ev(rollingMonthly(compose(pd.base, {}, set))), pdBase));
}
