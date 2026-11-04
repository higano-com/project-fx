// データの異常を探す
import { loadCsv } from "./harness.mjs";
const x = loadCsv("data/xau_usd_1h.csv");
const f = n => n.toFixed(2), d = t => new Date(t).toISOString().slice(0,16);
let bad = [], jumps = [], gaps = {}, flat = 0;
for (let i = 0; i < x.length; i++) {
  const [t,o,h,l,c] = x[i];
  if (!(h >= Math.max(o,c) - 1e-6 && l <= Math.min(o,c) + 1e-6 && h >= l)) bad.push(i);
  if (h === l) flat++;
  if (i) {
    const pc = x[i-1][4], dt = (t - x[i-1][0]) / 3600e3;
    const k = dt === 1 ? "1h" : dt < 24 ? "<24h" : dt <= 72 ? "週末(≤72h)" : ">72h";
    gaps[k] = (gaps[k] || 0) + 1;
    const r = Math.abs(o / pc - 1), rr = (h - l) / pc;
    if (r > 0.01 || rr > 0.03) jumps.push({ t: d(t), gapH: dt, prevClose: f(pc), o: f(o), h: f(h), l: f(l), c: f(c), openJump: (r*100).toFixed(2)+"%", range: (rr*100).toFixed(2)+"%" });
  }
}
console.log("bars", x.length, "| 高安の矛盾", bad.length, "| 値動きゼロの足", flat);
console.log("前の足との間隔", gaps);
console.log("始値の飛び>1% または 1本の値幅>3% :", jumps.length);
console.table(jumps.slice(0, 25));
// 年ごとの本数
const byY = {}; for (const r of x) { const y = new Date(r[0]).getUTCFullYear(); byY[y] = (byY[y]||0)+1; } console.log(byY);
