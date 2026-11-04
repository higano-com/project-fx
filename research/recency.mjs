// 「今」を重く見るほうが良いのかを確かめる
// 1) 調整に使う期間の長さ（1か月・3か月・半年・1年）。設定は毎月見直す
// 2) 最近の値動きほど重く数える（古い値動きの影響を半分にしていく）
// 3) 毎月、直近で一番調子が良いルールに乗り換える
// どれも、その時点より前のデータだけで決める（未来は見ない）
import { writeFileSync, mkdirSync } from "node:fs";
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize } from "./engine.mjs";
import { compose } from "./filters.mjs";

const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, MONTH = 30 * DAY, iso = t => new Date(t).toISOString().slice(0, 10);
const START = Date.UTC(2021, 2, 1), HOLD = Date.UTC(2026, 4, 1), HALF = Date.UTC(2024, 0, 1), END = B.t[B.n - 1] + 1;
const YEN = 2500;   // 1回の許容損失

const CANDS = {
  ...Object.fromEntries(Object.entries(STRATEGIES).map(([k, S]) => [k, { name: S.name, S }])),
  breakoutF: { name: "高値・安値抜け＋ストキャスティクス・荒れ具合", S: compose(STRATEGIES.breakout, {}, ["stochOk", "calm"]) },
  ichimokuF: { name: "一目均衡表＋損切り幅の下限・日足の流れ", S: compose(STRATEGIES.ichimoku, {}, ["minStop", "daily"]) },
  bollingerF: { name: "ボリンジャーバンド＋日足の流れ", S: compose(STRATEGIES.bollinger, {}, ["daily"]) },
};
for (const c of Object.values(CANDS)) {
  c.combos = gridList(c.S.grid).map(x => ({ ...x, trades: runStrategy(B, c.S, x.p) }));
  c.byIdx = new Map(c.combos.map(x => [x.idx.join(","), x]));
}

const months = []; for (let m = START; m < END; m += MONTH) months.push(m);
function rolling(c, L, H) {
  const minN = Math.min(20, Math.max(4, Math.round(L / (365 * DAY) * 20)));
  const oos = [];
  for (const m of months) {
    const sc = new Map();
    for (const x of c.combos) {
      let n = 0, s = 0;
      for (const t of x.trades) { if (t.t < m - L || t.t >= m) continue; n++; s += t.R * (H ? Math.pow(0.5, (m - t.t) / H) : 1); }
      sc.set(x, { n, s });
    }
    let best = null;
    for (const x of c.combos) {
      const me = sc.get(x); if (me.n < minN) continue;
      const ns = [me.s];
      x.idx.forEach((v, k) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[k] += d; const nb = c.byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); }));
      const rs = ns.reduce((a, b) => a + b, 0) / ns.length;
      if (!best || rs > best.rs) best = { x, rs };
    }
    if (best) for (const t of best.x.trades) if (t.t >= m && t.t < m + MONTH) oos.push({ ...t, month: m });
  }
  return oos;
}
const part = (tr, a, b) => summarize(tr.filter(x => x.t >= a && x.t < b));
const man = r => (r * YEN / 1e4).toFixed(1).padStart(6) + "万円";
function row(tr) { const A = part(tr, START, HOLD), F = part(tr, HOLD, END), h1 = part(tr, START, HALF), h2 = part(tr, HALF, HOLD); return { A, F, h1, h2 }; }
const show = (label, r) => console.log(`  ${label.padEnd(26, "　")} 確認 ${man(r.A.sumR)}（${r.A.n}回・利益÷損失${(isFinite(r.A.pf) ? r.A.pf : 0).toFixed(2)}） 前半${man(r.h1.sumR)} 後半${man(r.h2.sumR)} ｜最新6か月 ${man(r.F.sumR)}（${r.F.n}回）`);

const SCHEMES = [
  { key: "L30", label: "直近1か月で調整", L: 30 * DAY, H: 0 },
  { key: "L91", label: "直近3か月で調整", L: 91 * DAY, H: 0 },
  { key: "L182", label: "直近半年で調整", L: 182 * DAY, H: 0 },
  { key: "L365", label: "直近1年で調整", L: 365 * DAY, H: 0 },
  { key: "W30", label: "1年・最近ほど重く（30日で半分）", L: 365 * DAY, H: 30 * DAY },
  { key: "W91", label: "1年・最近ほど重く（90日で半分）", L: 365 * DAY, H: 91 * DAY },
  { key: "L730", label: "直近2年で調整", L: 730 * DAY, H: 0 },
];
const out = { schemes: {}, rotation: {} };
const oosStore = {};
console.log(`確認期間 ${iso(START)}〜${iso(HOLD)}、最新6か月 ${iso(HOLD)}〜${iso(END)}。設定は毎月見直す。金額は1回の許容損失2,500円で計算`);
for (const [ck, c] of Object.entries(CANDS)) {
  console.log(`\n■ ${c.name}`);
  out.schemes[ck] = { name: c.name };
  for (const sc of SCHEMES) {
    const tr = rolling(c, sc.L, sc.H); (oosStore[ck] ||= {})[sc.key] = tr;
    const r = row(tr); out.schemes[ck][sc.key] = { label: sc.label, ...r };
    show(sc.label, r);
  }
}

/* 乗り換え：毎月、直近K日の成績（その時点までに実際に出た結果）が一番良いルールを使う。どれもマイナスなら休む */
console.log("\n■ 毎月、直近で一番調子が良いルールに乗り換える（各ルールは「直近1年で調整」を使用）");
for (const K of [30, 91, 182]) {
  for (const sk of ["L365", "L91"]) {
    const tr = [], used = {};
    for (const m of months) {
      let best = null;
      for (const ck of Object.keys(CANDS)) {
        const s = oosStore[ck][sk].filter(x => x.t >= m - K * DAY && x.t < m).reduce((a, x) => a + x.R, 0);
        if (!best || s > best.s) best = { ck, s };
      }
      if (!best || best.s <= 0) { used["休む"] = (used["休む"] || 0) + 1; continue; }
      used[CANDS[best.ck].name] = (used[CANDS[best.ck].name] || 0) + 1;
      tr.push(...oosStore[best.ck][sk].filter(x => x.t >= m && x.t < m + MONTH));
    }
    const r = row(tr); out.rotation[`K${K}_${sk}`] = { ...r, used };
    show(`直近${K}日で選ぶ（各ルール${sk === "L365" ? "1年" : "3か月"}で調整）`, r);
    console.log("     よく選ばれたもの：", Object.entries(used).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}か月`).join("、"));
  }
}
mkdirSync("research/out", { recursive: true });
writeFileSync("research/out/recency.json", JSON.stringify(out, null, 1));
console.log("\n保存：research/out/recency.json");
