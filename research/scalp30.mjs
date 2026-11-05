// 30分ごとに入る短い取引（スキャルピング）を、1分足で確かめる
// ・30分ごと（毎時3分・33分）に、持っていなければ入る
// ・向き：直近の流れ（30分足の平均線の上なら買い、下なら売り）など
// ・損切り：15枚で5万円（約21ドル）、利確：その何倍か、持つ時間の上限
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const m1 = gunzipSync(readFileSync("data/xau_usd_1min.csv.gz")).toString("utf8").trim().split("\n").slice(1).map(l => { const [t, o, h, lo, c] = l.split(","); return [Date.parse(t.replace(" ", "T") + ":00Z"), +o, +h, +lo, +c]; });
const SP = 0.8, SLIP = 0.1, FX = 155, QTY = 15, H = SP / 2;
const STOP = 50000 / (QTY * FX) - SLIP;   // 約21.4ドル
// 30分足と平均線
const b30 = []; for (const r of m1) { const k = Math.floor(r[0] / 1800e3) * 1800e3, L = b30[b30.length - 1]; if (!L || L[0] !== k) b30.push([k, r[1], r[2], r[3], r[4]]); else { L[2] = Math.max(L[2], r[2]); L[3] = Math.min(L[3], r[3]); L[4] = r[4]; } }
const ema = (n) => { const k = 2 / (n + 1), o = []; let v = b30[0][4]; for (const b of b30) { v = b[4] * k + v * (1 - k); o.push(v); } return o; };
const e20 = ema(20), e100 = ema(100);
const idx30 = new Map(b30.map((b, i) => [b[0], i]));
const jstOpen = t => { const j = new Date(t + 9 * 3600e3), wd = j.getUTCDay(), h = j.getUTCHours(); if (h === 7 || wd === 0) return false; if (wd === 6) return h < 6; if (wd === 1) return h >= 8; return true; };
function run(dirFn, tpMult, holdMin) {
  const trades = []; let pos = null;
  for (let k = 0; k < m1.length; k++) {
    const [t, o, hi, lo, c] = m1[k];
    if (pos) {
      let px = null, why = "";
      if (pos.dir === 1) { if (lo - H <= pos.sl) { px = pos.sl - SLIP; why = "損切り"; } else if (hi - H >= pos.tp) { px = pos.tp; why = "利確"; } }
      else { if (hi + H >= pos.sl) { px = pos.sl + SLIP; why = "損切り"; } else if (lo + H <= pos.tp) { px = pos.tp; why = "利確"; } }
      if (px === null && t - pos.t >= holdMin * 60e3) { px = c - pos.dir * H; why = "時間切れ"; }
      if (px !== null) { trades.push({ t: pos.t, usd: (px - pos.entry) * pos.dir, why }); pos = null; }
    }
    const mm = new Date(t).getUTCMinutes();
    if (!pos && (mm === 3 || mm === 33) && jstOpen(t)) {
      const i = idx30.get(Math.floor(t / 1800e3) * 1800e3) - 1;   // 確定した直前の30分足まで
      if (i < 100) continue;
      const dir = dirFn(i); if (!dir) continue;
      const entry = c + dir * H;
      pos = { t, dir, entry, sl: entry - dir * STOP, tp: entry + dir * STOP * tpMult };
    }
  }
  return trades;
}
const dirs = {
  "短い流れに乗る（平均線の上なら買い）": i => b30[i][4] > e20[i] ? 1 : -1,
  "長い流れに乗る": i => b30[i][4] > e100[i] ? 1 : -1,
  "短い流れと長い流れがそろったときだけ": i => (b30[i][4] > e20[i] && e20[i] > e100[i]) ? 1 : (b30[i][4] < e20[i] && e20[i] < e100[i]) ? -1 : 0,
  "逆張り（平均線の上なら売り）": i => b30[i][4] > e20[i] ? -1 : 1,
  "直前の30分と同じ向き": i => b30[i][4] > b30[i][1] ? 1 : -1,
};
console.log(`1分足 ${m1.length}本（2026年7月〜11月）。15枚・損切り約${STOP.toFixed(1)}ドル（5万円）。スプレッド0.8ドルを含む。損益は15枚の円\n`);
const half = m1[Math.floor(m1.length / 2)][0];
for (const [name, fn] of Object.entries(dirs)) {
  console.log(`■ ${name}`);
  for (const tp of [0.5, 1, 2]) for (const hold of [60, 120, 240]) {
    const tr = run(fn, tp, hold), yen = tr.reduce((a, x) => a + x.usd * QTY * FX, 0), w = tr.filter(x => x.usd > 0).length;
    const a = tr.filter(x => x.t < half).reduce((p, x) => p + x.usd * QTY * FX, 0), b = yen - a;
    console.log(`   利確${tp}倍（${(STOP * tp).toFixed(0)}ドル）・最長${hold / 60}時間：${tr.length}回 勝率${Math.round(w / tr.length * 100)}％ 損益${(yen / 1e4).toFixed(0)}万円（前半${(a / 1e4).toFixed(0)}・後半${(b / 1e4).toFixed(0)}）`);
  }
}
