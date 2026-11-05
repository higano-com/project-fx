// 30分ごとの練習：支持線・抵抗線（節目）の使い方を、くり返し改善する（1回だめでも捨てない）
// 土台＝今のやり方（直前の30分と同じ向き・最初の損切り21.4ドル・10ドル伸びたら18ドル戻しで決済・最長4時間）
// 節目の作り方：30分足・1時間足・4時間足の山と谷（前後○本より高い・低い）、キリのいい数字（10・25・50ドルごと）
// 節目の使い方：A 節目に近づいたら追いかけ幅を狭める／B 節目の手前で利確／C 損切りを反対の節目の外に置く
//               D 進む方向のすぐ先に節目があれば見送り／E 節目を抜けたら持つ時間を延ばす
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
export const m1 = gunzipSync(readFileSync(new URL("../data/xau_usd_1min.csv.gz", import.meta.url))).toString("utf8").trim().split("\n").slice(1).map(l => { const [t, o, h, lo, c] = l.split(","); return [Date.parse(t.replace(" ", "T") + ":00Z"), +o, +h, +lo, +c]; });
export const COST = { sp: 0.8, slip: 0.1 };
const FX = 155, QTY = 15; export const YEN = QTY * FX;
const STOP0 = () => 50000 / (QTY * FX) - COST.slip;
const bars = ms => { const out = []; for (const r of m1) { const k = Math.floor(r[0] / ms) * ms, L = out[out.length - 1]; if (!L || L[0] !== k) out.push([k, r[1], r[2], r[3], r[4]]); else { L[2] = Math.max(L[2], r[2]); L[3] = Math.min(L[3], r[3]); L[4] = r[4]; } } return out; };
const b30 = bars(1800e3), idx30 = new Map(b30.map((b, i) => [b[0], i]));
// 山と谷：[確定した時刻, 値]
const PIV = {};
for (const [name, ms, s] of [["30分", 1800e3, 2], ["1時間", 3600e3, 3], ["4時間", 4 * 3600e3, 2]]) {
  const B = bars(ms), hi = [], lo = [];
  for (let i = s; i < B.length - s; i++) {
    let ph = true, pl = true; for (let k = 1; k <= s; k++) { if (!(B[i][2] > B[i - k][2] && B[i][2] > B[i + k][2])) ph = false; if (!(B[i][3] < B[i - k][3] && B[i][3] < B[i + k][3])) pl = false; }
    const ct = B[i + s][0] + ms; if (ph) hi.push([ct, B[i][2]]); if (pl) lo.push([ct, B[i][3]]);
  }
  PIV[name] = { hi, lo };
}
// 進む方向で一番近い節目（minDist より先）、反対側で一番近い節目
function levels(src, t, entry, dir, look, minDist) {
  let ahead = null, behind = null;
  if (src.startsWith("キリ")) { const st = +src.slice(2); const up = Math.ceil((entry + 1e-9) / st) * st, dn = Math.floor((entry - 1e-9) / st) * st;
    const a = dir === 1 ? up : dn, b = dir === 1 ? dn : up; ahead = (a - entry) * dir > minDist ? a : a + dir * st; behind = b; return { ahead, behind }; }
  const P = PIV[src], from = t - look * 3600e3;
  for (const [ct, v] of (dir === 1 ? P.hi : P.lo)) { if (ct > t) break; if (ct < from) continue; if ((v - entry) * dir > minDist && (ahead === null || Math.abs(v - entry) < Math.abs(ahead - entry))) ahead = v; }
  for (const [ct, v] of (dir === 1 ? P.lo : P.hi)) { if (ct > t) break; if (ct < from) continue; if ((entry - v) * dir > 1 && (behind === null || Math.abs(v - entry) < Math.abs(behind - entry))) behind = v; }
  return { ahead, behind };
}
const jstOpen = t => { const j = new Date(t + 9 * 3600e3), wd = j.getUTCDay(), h = j.getUTCHours(); if (h === 7 || wd === 0) return false; if (wd === 6) return h < 6; if (wd === 1) return h >= 8; return true; };
export function run(o = {}) {
  const H = COST.sp / 2, SLIP = COST.slip, STOP = STOP0();
  const trail = o.trail ?? 18, from = o.from ?? 10, hold = o.hold ?? 240;
  const trades = []; let pos = null;
  for (let k = 0; k < m1.length; k++) {
    const [t, , hi, lo, c] = m1[k];
    if (pos) {
      const d = pos.dir, q = d === 1 ? { hi: hi - H, lo: lo - H, c: c - H } : { hi: hi + H, lo: lo + H, c: c + H };
      const worst = d === 1 ? q.lo : q.hi, bestP = d === 1 ? q.hi : q.lo; let px = null, why = "";
      if ((worst - pos.sl) * d <= 0) { px = pos.sl - d * SLIP; why = (pos.sl - pos.entry) * d > 0 ? "戻して決済" : "損切り"; }
      else if (pos.tp !== null && (bestP - pos.tp) * d >= 0) { px = pos.tp; why = "利確"; }
      if (px === null) {
        pos.best = d === 1 ? Math.max(pos.best, q.hi) : Math.min(pos.best, q.lo);
        const gain = (pos.best - pos.entry) * d;
        let tw = trail;
        if (o.A && pos.ahead !== null && (pos.best - (pos.ahead - d * o.Abuf)) * d >= 0) tw = Math.min(tw, o.A);   // 節目に届いたら狭める
        if (o.E && pos.ahead !== null && (q.c - (pos.ahead + d * 1)) * d > 0 && !pos.ext) { pos.ext = true; pos.hold += o.E; }
        if (gain >= from || (o.A && tw < trail)) { const ns = pos.best - d * tw; if ((ns - pos.sl) * d > 0) pos.sl = ns; }
        if (t - pos.t >= pos.hold * 60e3) { px = q.c; why = "時間切れ"; }
      }
      if (px !== null) { trades.push({ t: pos.t, usd: (px - pos.entry) * d, why }); pos = null; }
    }
    const mm = new Date(t).getUTCMinutes();
    if (!pos && (mm === 3 || mm === 33) && jstOpen(t)) {
      const i = idx30.get(Math.floor(t / 1800e3) * 1800e3) - 1; if (i < 100) continue;
      const dir = b30[i][4] > b30[i][1] ? 1 : -1, entry = c + dir * H;
      let sl = entry - dir * STOP, tp = null, ahead = null;
      if (o.src) {
        const L = levels(o.src, t, entry, dir, o.look ?? 24, o.minDist ?? 3); ahead = L.ahead;
        if (o.D && ahead !== null && Math.abs(ahead - entry) < o.D) continue;                          // すぐ先に節目：見送り
        if (o.Dr && L.behind !== null && Math.abs(entry - L.behind) > o.Dr) continue;                // 後ろの支えが遠い：見送り
        if (o.B && ahead !== null) tp = ahead - dir * o.B;                                            // 節目の手前で利確
        if (o.C && L.behind !== null) { const s2 = L.behind - dir * o.C; const dist = (entry - s2) * dir; if (dist < STOP && dist >= (o.Cmin ?? 5)) sl = s2; }   // 反対の節目の外に損切り
      }
      pos = { t, dir, entry, sl, tp, best: entry, ahead, hold };
    }
  }
  return trades;
}
export const half = m1[Math.floor(m1.length / 2)][0];
export function line(name, o) {
  const tr = run(o), all = tr.reduce((a, x) => a + x.usd, 0), a = tr.filter(x => x.t < half).reduce((p, x) => p + x.usd, 0), w = tr.filter(x => x.usd > 0).length;
  const man = v => (v * YEN / 1e4).toFixed(0);
  return { name, all: all * YEN, a: a * YEN, b: (all - a) * YEN, txt: `${name}：${man(all)}万（前半${man(a)}・後半${man(all - a)}）${tr.length}回 勝率${Math.round(w / tr.length * 100)}％` };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [];
  rows.push(line("土台（追いかける決済だけ）", {}));
  for (const src of ["30分", "1時間", "4時間", "キリ10", "キリ25", "キリ50"]) for (const look of src.startsWith("キリ") ? [0] : [24, 72]) {
    const L = look ? `${src}・${look}時間` : src, base = { src, look };
    for (const A of [3, 6]) rows.push(line(`A 節目で追いかけ幅${A}ドルに【${L}】`, { ...base, A, Abuf: 1 }));
    for (const B of [0.5, 2]) rows.push(line(`B 節目の${B}ドル手前で利確【${L}】`, { ...base, B, minDist: 8 }));
    for (const C of [0.5, 2]) rows.push(line(`C 損切りを反対の節目の${C}ドル外【${L}】`, { ...base, C }));
    for (const D of [5, 10]) rows.push(line(`D ${D}ドル以内に節目なら見送り【${L}】`, { ...base, D, minDist: 0 }));
    rows.push(line(`E 節目を抜けたら2時間延ばす【${L}】`, { ...base, E: 120 }));
  }
  console.log(`1分足 2026年7月〜11月・15枚・スプレッド${COST.sp}ドル。良い順（後半もプラスのものに★）\n`);
  rows.sort((p, q) => q.all - p.all).forEach(r => console.log((r.a > 0 && r.b > 0 ? "★" : "　") + r.txt));
}
