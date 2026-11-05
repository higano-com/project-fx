// レンジ（一定の幅で行ったり来たりしている状態）を取りに行く売買
// ・直近N時間の高値と安値の幅が小さいとき＝レンジ
// ・レンジの下のほうで、上向きの足が出たら買い（上のほうで、下向きの足が出たら売り）
// ・損切りはレンジの外（少し外）、利確はレンジの反対側の手前
import { loadCsv, prepare, gridList } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));

// 1) そもそも、どれくらいレンジがあるか（直近6時間の幅が10ドル以内の時間の割合）
const byY = {};
for (let i = 6; i < B.n; i++) { let h = -Infinity, l = Infinity; for (let k = i - 5; k <= i; k++) { h = Math.max(h, B.h[k]); l = Math.min(l, B.l[k]); } const y = new Date(B.t[i]).getUTCFullYear(); const o = (byY[y] ||= { n: 0, r10: 0, r20: 0 }); o.n++; if (h - l <= 10) o.r10++; if (h - l <= 20) o.r20++; }
console.log("■ 直近6時間の値幅が小さい時間の割合");
for (const [y, o] of Object.entries(byY)) console.log(`  ${y}年：10ドル以内 ${(o.r10 / o.n * 100).toFixed(0)}％ ／ 20ドル以内 ${(o.r20 / o.n * 100).toFixed(0)}％`);

const hhN = (i, n) => { let m = -Infinity; for (let k = i - n + 1; k <= i; k++) m = Math.max(m, B.h[k]); return m; };
const llN = (i, n) => { let m = Infinity; for (let k = i - n + 1; k <= i; k++) m = Math.min(m, B.l[k]); return m; };
// レンジの決め方：mode "atr"＝ふだんの値動きの k 倍以内、"usd"＝k ドル以内
const rangeStrat = mode => ({
  grid: mode === "atr"
    ? { n: [8, 12, 24], k: [3, 4, 6], edge: [0.2, 0.3], buf: [0.2, 0.5], tgt: [0.5, 0.8], hold: [6, 12, 24] }
    : { n: [6, 12, 24], k: [10, 15, 20], edge: [0.2, 0.3], buf: [0.2, 0.5], tgt: [0.5, 0.8], hold: [6, 12, 24] },
  fn(B, i, p) {
    const hh = hhN(i - 1, p.n), ll = llN(i - 1, p.n), w = hh - ll, a = B.atr[i], c = B.c[i];   // 判断する足の前までのレンジ
    if (!(w > 0)) return null;
    if (mode === "atr" ? w > p.k * a : w > p.k) return null;
    if (c > hh || c < ll) return null;                       // もうレンジを抜けている
    const pos = (c - ll) / w;
    let dir = 0;
    if (pos <= p.edge && c > B.o[i]) dir = 1;                // 下のほうで上向きの足
    if (pos >= 1 - p.edge && c < B.o[i]) dir = -1;           // 上のほうで下向きの足
    if (!dir) return null;
    const sl = dir === 1 ? ll - p.buf * a : hh + p.buf * a;
    const tp = dir === 1 ? ll + p.tgt * w + (1 - p.tgt) * 0 + (w * 0) : hh - p.tgt * w;
    const target = dir === 1 ? ll + w * (0.2 + p.tgt * 0.8) : hh - w * (0.2 + p.tgt * 0.8);   // 反対側の手前
    const stop = Math.abs(c - sl), tpd = (target - c) * dir;
    if (tpd <= 0 || stop <= 0) return null;
    return { dir, stop, rr: tpd / stop, hold: p.hold };
  },
});
FILTERS.adxLow = { opts: [0, 20, 25], fn: (B, i, s, v) => !v || B.adx[i] < v };   // 流れが弱いときだけ
console.log("\n■ レンジを取りに行く売買（スプレッド0.8ドル・1回2,500円・見直しの日を4通りずらした平均）");
report(B, "幅をふだんの値動きの倍数で決める", compose(rangeStrat("atr"), {}, []));
report(B, "　＋流れが弱いときだけ（毎月）", compose(rangeStrat("atr"), {}, ["adxLow"]));
report(B, "幅をドルで決める（10〜20ドル）", compose(rangeStrat("usd"), {}, []));
report(B, "　＋流れが弱いときだけ（毎月）", compose(rangeStrat("usd"), {}, ["adxLow"]));
