// 「負けの67％を勝ちに変えられるか」を調べる
// 1) 判断と逆に入ったら（損切り・利確の幅も入れ替える）
// 2) 負けた取引に共通する特徴はあるか（その特徴のときに見送れば、負けを減らせる）
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize } from "./engine.mjs";
import { compose } from "./filters.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, START = Date.UTC(2021, 2, 1), END = B.t[B.n - 1] + 1, YEN = 2500;
const I = STRATEGIES.ichimoku;
function rolling(S) {
  const combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  const oos = [];
  for (let m = START; m < END; m += 30 * DAY) {
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
const fmt = s => `${s.n}回 勝率${(s.win * 100).toFixed(0)}％ 損益${(s.sumR * YEN / 1e4).toFixed(1)}万円 利益÷損失${s.pf.toFixed(2)}`;

// 1) 逆に入る（損切りの幅と利確の幅を入れ替え）
const base = compose(I, {}, ["minStop", "daily"]);
const flip = { grid: base.grid, fn(B, i, p) { const s = base.fn(B, i, p); if (!s) return null; return { dir: -s.dir, stop: s.stop * s.rr, rr: 1 / s.rr }; } };
console.log("■ 1. 判断どおり：", fmt(summarize(rolling(base))));
console.log("■ 1. 判断と逆に入る：", fmt(summarize(rolling(flip))));

// 2) 負けた取引の特徴（判断どおりの取引を、入った時点の状態で分ける）
const tag = { grid: base.grid, fn(B, i, p) { const s = base.fn(B, i, p); if (!s) return null;
  const j = new Date(B.t[i] + 9 * 3600e3), h = j.getUTCHours();
  s.f = { 時間帯: h >= 8 && h < 16 ? "東京（8〜16時）" : h >= 16 && h < 21 ? "ロンドン（16〜21時）" : "ニューヨーク（21〜翌8時）",
    荒れ具合: (B.atr[i] / B.atrAvg[i]) > 1.3 ? "荒い" : (B.atr[i] / B.atrAvg[i]) < 0.8 ? "静か" : "ふつう",
    勢い: (s.dir === 1 ? B.rsi[i] > 70 : B.rsi[i] < 30) ? "行き過ぎ" : "ふつう",
    抜けの強さ: Math.abs(B.c[i] - B.o[i]) > 1.0 * B.atr[i] ? "大きな足で抜けた" : "小さな足で抜けた",
    相場: B.regime[i] };
  return s; } };
// runStrategy は f を取引に残さないので、入った時刻から特徴を引き直す
const tr = rolling(tag), idxOf = new Map(Array.from(B.t, (t, k) => [t, k]));
const feat = t => { const i = idxOf.get(t.t) - 1; const p = { slMult: 1.5, rr: 2, f_minStop: 0, f_daily: 1 }; const s = I.fn(B, i, p) || { dir: t.dir };
  const j = new Date(B.t[i] + 9 * 3600e3), h = j.getUTCHours(), vr = B.atr[i] / B.atrAvg[i];
  return { 時間帯: h >= 8 && h < 16 ? "東京（8〜16時）" : h >= 16 && h < 21 ? "ロンドン（16〜21時）" : "ニューヨーク（21〜翌8時）",
    荒れ具合: vr > 1.3 ? "荒い" : vr < 0.8 ? "静か" : "ふつう",
    勢いの行き過ぎ: (t.dir === 1 ? B.rsi[i] > 70 : B.rsi[i] < 30) ? "行き過ぎ" : "ふつう",
    抜けた足: Math.abs(B.c[i] - B.o[i]) > 1.0 * B.atr[i] ? "大きな足" : "小さな足",
    曜日: ["日", "月", "火", "水", "木", "金", "土"][j.getUTCDay()], 相場: B.regime[i] }; };
console.log("\n■ 2. 入った時点の状態ごとの成績（判断どおりの取引", tr.length, "回）");
const groups = {};
for (const t of tr) { const f = feat(t); for (const [k, v] of Object.entries(f)) ((groups[k] ||= {})[v] ||= []).push(t); }
for (const [k, g] of Object.entries(groups)) {
  console.log(`  【${k}】`);
  for (const [v, arr] of Object.entries(g).sort((a, b) => b[1].length - a[1].length)) console.log(`    ${v.padEnd(14, "　")} ${fmt(summarize(arr))}`);
}
