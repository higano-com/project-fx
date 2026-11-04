// 設定の見直しは「毎週」と「毎月」のどちらが良いか（どちらも直近3か月の値動きで選ぶ）
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize } from "./engine.mjs";
import { compose } from "./filters.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, START = Date.UTC(2021, 2, 1), HOLD = Date.UTC(2026, 4, 1), HALF = Date.UTC(2024, 0, 1), END = B.t[B.n - 1] + 1;
const CANDS = {
  ichimokuF: { name: "一目均衡表＋損切り幅の下限＋日足の流れ", S: compose(STRATEGIES.ichimoku, {}, ["minStop", "daily"]) },
  bollingerF: { name: "ボリンジャーバンド＋日足の流れ", S: compose(STRATEGIES.bollinger, {}, ["daily"]) },
  pullbackDaily: { name: "押し目・戻り＋日足の流れ", S: STRATEGIES.pullbackDaily },
};
const man = r => ((r * 2500) / 1e4).toFixed(1) + "万円";
for (const c of Object.values(CANDS)) {
  const combos = gridList(c.S.grid).map(x => ({ ...x, trades: runStrategy(B, c.S, x.p) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  console.log(`\n■ ${c.name}`);
  for (const [label, step, L] of [["毎月・直近3か月", 30, 91], ["毎週・直近3か月", 7, 91], ["毎週・直近1か月", 7, 30], ["毎週・直近半年", 7, 182]]) {
    const oos = [], minN = Math.max(4, Math.round(L / 365 * 20));
    for (let m = START; m < END; m += step * DAY) {
      let best = null; const sc = new Map();
      for (const x of combos) { let n = 0, s = 0; for (const t of x.trades) if (t.t >= m - L * DAY && t.t < m) { n++; s += t.R; } sc.set(x, { n, s }); }
      for (const x of combos) {
        const me = sc.get(x); if (me.n < minN) continue;
        const ns = [me.s]; x.idx.forEach((v, k) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[k] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); }));
        const rs = ns.reduce((a, b) => a + b, 0) / ns.length; if (!best || rs > best.rs) best = { x, rs };
      }
      if (best) for (const t of best.x.trades) if (t.t >= m && t.t < m + step * DAY) oos.push(t);
    }
    const A = summarize(oos.filter(x => x.t < HOLD)), h1 = summarize(oos.filter(x => x.t < HALF)), h2 = summarize(oos.filter(x => x.t >= HALF && x.t < HOLD)), F = summarize(oos.filter(x => x.t >= HOLD));
    console.log(`  ${label.padEnd(10, "　")} 確認 ${man(A.sumR).padStart(7)}（${A.n}回・利益÷損失${A.pf.toFixed(2)}・落ち込み${man(A.maxDDR)}） 前半${man(h1.sumR)} 後半${man(h2.sumR)} ｜最新6か月 ${man(F.sumR)}（${F.n}回）`);
  }
}
