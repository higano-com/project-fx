// 第2回の検証：指標・時間帯・曜日を全部試してから、要らないものを捨てる
// 段階1：指標ごとの売買ルール9種類を比べる
// 段階2：上位のルールに「絞り込み」を1つずつ足して、効果があるか確かめる
// 段階3：効果があったものを全部のせ、1つずつ外して、要らないものを捨てる
// 段階4：最後の約6か月（調整に一度も使っていない期間）で最終確認
import { writeFileSync, mkdirSync } from "node:fs";
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize } from "./engine.mjs";

const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, iso = t => new Date(t).toISOString().slice(0, 10);
const HOLD = Date.UTC(2026, 4, 1);                 // ここから先は最終確認用（調整に使わない）
const HALF = Date.UTC(2024, 0, 1);                 // 前半・後半の区切り
const TRAIN = 365 * DAY, TEST = 91 * DAY;
const windows = [];
for (let a = B.t[600]; a + TRAIN < HOLD; a += TEST) windows.push({ a, b: a + TRAIN, c: a + TRAIN, d: Math.min(a + TRAIN + TEST, HOLD) });

/* 絞り込みの候補 */
const utcH = t => new Date(t).getUTCHours(), jstWd = t => new Date(t + 9 * 3600e3).getUTCDay();
export const FILTERS = {
  minStop:    { name: "損切り幅が小さすぎたら見送る（ドル）", opts: [0, 6, 10, 15], fn: (B, i, s, v) => s.stop >= v },
  adx:        { name: "トレンドの強さが弱いと見送る", opts: [0, 20, 25, 30], fn: (B, i, s, v) => B.adx[i] >= v },
  session:    { name: "時間帯", opts: ["全部", "東京を除く", "夜と早朝を除く", "ロンドンとニューヨークだけ"], fn: (B, i, s, v) => { const h = utcH(B.t[i]); return v === "全部" || (v === "東京を除く" && !(h <= 6)) || (v === "夜と早朝を除く" && h < 21) || (v === "ロンドンとニューヨークだけ" && h >= 7 && h <= 20); } },
  weekday:    { name: "曜日", opts: ["全部", "月曜を除く", "金曜を除く"], fn: (B, i, s, v) => { const w = jstWd(B.t[i]); return v === "全部" || (v === "月曜を除く" && w !== 1) || (v === "金曜を除く" && w !== 5); } },
  daily:      { name: "日足の流れと同じ向きだけ", opts: [0, 1], fn: (B, i, s, v) => !v || ((B.ema(460)[i] > B.ema(460)[i - 115]) === (s.dir === 1)) },
  macdAgree:  { name: "移動平均の収束と拡散が同じ向きだけ", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.macd[i] > B.macdSig[i] : B.macd[i] < B.macdSig[i]) },
  rsiBand:    { name: "相対力指数が行き過ぎていない", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.rsi[i] <= 70 : B.rsi[i] >= 30) },
  stochOk:    { name: "ストキャスティクスが行き過ぎていない", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.stK[i] < 80 : B.stK[i] > 20) },
  squeeze:    { name: "ボリンジャーバンドが縮んだあとだけ", opts: [0, 1], fn: (B, i, s, v) => !v || B.bbWidth[i - 1] < B.bbWidthAvg[i - 1] },
  cloud:      { name: "一目均衡表の雲と同じ側だけ", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.c[i] > B.cloudTop[i] : B.c[i] < B.cloudBot[i]) },
  cciAgree:   { name: "商品チャネル指数が同じ向きだけ", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.cci[i] > 0 : B.cci[i] < 0) },
  calm:       { name: "荒れすぎていたら見送る", opts: [0, 2, 1.5], fn: (B, i, s, v) => !v || B.atr[i] / B.atrAvg[i] < v },
};

/* 判断ルール＋絞り込みを1つの判断ルールにまとめる。fixed：決めうちの絞り込み、tuned：調整で選ぶ絞り込み */
function compose(base, fixed = {}, tuned = []) {
  const grid = { ...base.grid }; for (const k of tuned) grid["f_" + k] = FILTERS[k].opts;
  return {
    grid,
    fn(B, i, p) {
      const s = base.fn(B, i, p); if (!s) return null;
      for (const [k, v] of Object.entries(fixed)) if (!FILTERS[k].fn(B, i, s, v)) return null;
      for (const k of tuned) if (!FILTERS[k].fn(B, i, s, p["f_" + k])) return null;
      return s;
    }
  };
}

/* ウォークフォワード：毎回、調整期間で「少しずらしても崩れにくい設定」を選び、次の3か月で確かめる */
const inWin = (tr, a, b) => tr.filter(x => x.t >= a && x.t < b);
function walkForward(S) {
  const combos = gridList(S.grid).map(c => ({ ...c, trades: runStrategy(B, S, c.p) }));
  const byIdx = new Map(combos.map(c => [c.idx.join(","), c]));
  const oos = [], picks = [];
  for (const w of windows) {
    const sc = new Map(combos.map(c => { const tr = inWin(c.trades, w.a, w.b); return [c, { n: tr.length, s: tr.reduce((a, x) => a + x.R, 0) }]; }));
    let best = null;
    for (const c of combos) {
      const me = sc.get(c); if (me.n < 20) continue;
      const ns = [me.s];
      c.idx.forEach((v, k) => [-1, 1].forEach(d => { const idx = [...c.idx]; idx[k] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); }));
      const rs = ns.reduce((a, b) => a + b, 0) / ns.length;
      if (!best || rs > best.rs) best = { c, rs };
    }
    if (!best) continue;
    picks.push(best.c.p);
    oos.push(...inWin(best.c.trades, w.c, w.d));
  }
  return { oos, picks, combos, byIdx };
}
const evalOOS = oos => ({ all: summarize(oos), first: summarize(oos.filter(x => x.t < HALF)), second: summarize(oos.filter(x => x.t >= HALF)) });
const fmt = s => `${String(s.n).padStart(4)}回 勝率${(s.win * 100).toFixed(0).padStart(2)}% 合計${s.sumR.toFixed(1).padStart(6)}R 利益÷損失${(isFinite(s.pf) ? s.pf : 0).toFixed(2)} 最大落込${s.maxDDR.toFixed(1)}R`;
const mode = arr => { const m = new Map(); for (const v of arr) m.set(v, (m.get(v) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
const out = { period: { from: iso(windows[0].c), to: iso(HOLD), hold: iso(HOLD), end: iso(B.t[B.n - 1]) }, stage1: {}, stage2: {}, stage3: {}, final: {} };

console.log(`確認期間（ウォークフォワード）：${iso(windows[0].c)}〜${iso(HOLD)}（${windows.length}回）／最終確認用：${iso(HOLD)}〜${iso(B.t[B.n - 1])}`);

/* 段階1 */
console.log("\n■ 段階1：指標ごとの売買ルール");
const s1 = [];
for (const [k, S] of Object.entries(STRATEGIES)) {
  const r = walkForward(S), e = evalOOS(r.oos);
  s1.push({ k, name: S.name, e }); out.stage1[k] = { name: S.name, ...e };
  console.log(`  ${S.name.padEnd(22, "　")} ${fmt(e.all)} ｜前半 ${e.first.sumR.toFixed(1)}R 後半 ${e.second.sumR.toFixed(1)}R`);
}
const top = s1.sort((a, b) => b.e.all.sumR - a.e.all.sumR).slice(0, 3);
console.log("  → 上位3つ：", top.map(x => x.name).join("、"));

/* 段階2 */
console.log("\n■ 段階2：絞り込みを1つずつ足す（前半・後半の両方で良くなったら「効果あり」）");
const helpful = {};
for (const t of top) {
  const base = STRATEGIES[t.k]; out.stage2[t.k] = {}; helpful[t.k] = [];
  console.log(`  ［${t.name}］そのまま：${fmt(t.e.all)}`);
  for (const [fk, F] of Object.entries(FILTERS)) {
    const r = walkForward(compose(base, {}, [fk])), e = evalOOS(r.oos);
    const better = e.all.sumR > t.e.all.sumR && e.first.sumR >= t.e.first.sumR && e.second.sumR >= t.e.second.sumR && e.all.pf >= t.e.all.pf;
    const chosen = mode(r.picks.map(p => p["f_" + fk]));
    out.stage2[t.k][fk] = { name: F.name, ...e, better, chosen };
    if (better) helpful[t.k].push({ fk, chosen });
    console.log(`    ${better ? "○" : "×"} ${F.name.padEnd(20, "　")} ${fmt(e.all)} ｜前半 ${e.first.sumR.toFixed(1)}R 後半 ${e.second.sumR.toFixed(1)}R ｜よく選ばれた値 ${chosen}`);
  }
}

/* 段階3：効果があったものを全部のせ（どの値を使うかは毎回の調整で選ぶ）、1つずつ外して、外しても悪くならないものは捨てる */
console.log("\n■ 段階3：効果があったものを全部のせてから、1つずつ外す");
const finalCfg = {};
for (const t of top) {
  const base = STRATEGIES[t.k]; let keep = helpful[t.k].map(h => h.fk);
  let cur = evalOOS(walkForward(compose(base, {}, keep)).oos);
  console.log(`  ［${t.name}］全部のせ（${keep.map(k => FILTERS[k].name).join("・") || "なし"}）：${fmt(cur.all)}`);
  let changed = keep.length > 0;
  while (changed) {
    changed = false;
    for (const k of [...keep]) {
      const rest = keep.filter(x => x !== k), e = evalOOS(walkForward(compose(base, {}, rest)).oos);
      const notNeeded = e.all.sumR >= cur.all.sumR;
      console.log(`    「${FILTERS[k].name}」を外すと ${fmt(e.all)} → ${notNeeded ? "要らない（捨てる）" : "必要（残す）"}`);
      if (notNeeded) { keep = rest; cur = e; changed = true; break; }
    }
  }
  finalCfg[t.k] = keep;
  out.stage3[t.k] = { name: t.name, keep: keep.map(k => ({ k, name: FILTERS[k].name })), ...cur };
  console.log(`    → 残ったもの：${keep.map(k => FILTERS[k].name).join("、") || "なし"}　${fmt(cur.all)}`);
}

/* 段階4：最終確認（調整に一度も使っていない最後の期間）。設定は最終確認の直前1年で選ぶ */
console.log(`\n■ 段階4：最終確認（${iso(HOLD)}〜${iso(B.t[B.n - 1])}、調整に一度も使っていない期間）`);
for (const t of top) {
  for (const [label, S] of [["そのまま", STRATEGIES[t.k]], ["絞り込みあり", compose(STRATEGIES[t.k], {}, finalCfg[t.k])]]) {
    const combos = gridList(S.grid).map(c => ({ ...c, trades: runStrategy(B, S, c.p) }));
    const byIdx = new Map(combos.map(c => [c.idx.join(","), c]));
    const sc = new Map(combos.map(c => { const tr = inWin(c.trades, HOLD - TRAIN, HOLD); return [c, tr.reduce((a, x) => a + x.R, 0)]; }));
    let best = null;
    for (const c of combos) { const ns = [sc.get(c)]; c.idx.forEach((v, k) => [-1, 1].forEach(d => { const idx = [...c.idx]; idx[k] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb)); })); const rs = ns.reduce((a, b) => a + b, 0) / ns.length; if (!best || rs > best.rs) best = { c, rs }; }
    const e = summarize(inWin(best.c.trades, HOLD, Infinity));
    (out.final[t.k] ||= { name: t.name })[label] = { ...e, p: best.c.p };
    console.log(`  ［${t.name}］${label}：${fmt(e)}`);
  }
}

mkdirSync("research/out", { recursive: true });
writeFileSync("research/out/round2.json", JSON.stringify(out, null, 1));
console.log("\n保存：research/out/round2.json");
