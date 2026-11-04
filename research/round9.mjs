// 第9回：大きな足だけの年ごとの確認／長い時間足の流れとの組み合わせ／値動きの荒さで損切りの倍率を変える
import { loadCsv, prepare, STRATEGIES } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const I = STRATEGIES.ichimoku;
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
// 4時間足の流れ（4時間足の約20本＝80時間の平均線の向き）、週の流れ（約5日×23時間の平均線）
FILTERS.h4 = { opts: [0, 1], fn: (B, i, s, v) => !v || ((B.ema(80)[i] > B.ema(80)[i - 16]) === (s.dir === 1)) };
FILTERS.wk = { opts: [0, 1], fn: (B, i, s, v) => !v || ((B.ema(1150)[i] > B.ema(1150)[i - 230]) === (s.dir === 1)) };
// 値動きの荒さで損切りの倍率を変える：荒いときは狭く／広く
const adapt = mode => ({ grid: { ...I.grid, k: [0.5, 1] }, fn(B, i, p) {
  const s = I.fn(B, i, p); if (!s) return null; const vr = B.atr[i] / B.atrAvg[i];
  const f = mode === "narrow" ? Math.pow(vr, -p.k) : Math.pow(vr, p.k);   // 荒い（vr>1）とき、narrow は幅を狭く
  return { ...s, stop: s.stop * Math.min(2, Math.max(0.5, f)) }; } });
console.log("第9回（スプレッド0.8ドル・1回2,500円・見直しの日を4通りずらした平均）");
const base = report(B, "今のやり方", compose(I, {}, ["minStop", "daily"]));
report(B, "大きな足だけ", compose(I, { bigBar: 1.0 }, ["minStop", "daily"]));
report(B, "大きな足の基準を0.6に", compose(I, { bigBar: 0.6 }, ["minStop", "daily"]));
report(B, "＋4時間足の流れ（いつも）", compose(I, { h4: 1 }, ["minStop", "daily"]));
report(B, "＋4時間足の流れ（毎月選ぶ）", compose(I, {}, ["minStop", "daily", "h4"]));
report(B, "＋週の流れ（いつも）", compose(I, { wk: 1 }, ["minStop", "daily"]));
report(B, "＋週の流れ（毎月選ぶ）", compose(I, {}, ["minStop", "daily", "wk"]));
report(B, "荒いときは損切りを狭く", compose(adapt("narrow"), {}, ["minStop", "daily"]));
report(B, "荒いときは損切りを広く", compose(adapt("wide"), {}, ["minStop", "daily"]));
