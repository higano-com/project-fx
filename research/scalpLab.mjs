// 30分ごとの練習の「実験台」：決め方を1つの設定（cfg）で表し、期間を分けて成績を出す
// 期間：調整（最初〜確認の前）／確認（その次の3か月）／最終確認（最後の45日。50回のくり返しが終わるまで見ない）
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
export const m1 = gunzipSync(readFileSync(new URL("../data/xau_usd_1min.csv.gz", import.meta.url))).toString("utf8").trim().split("\n").slice(1).map(l => { const [t, o, h, lo, c] = l.split(","); return [Date.parse(t.replace(" ", "T") + ":00Z"), +o, +h, +lo, +c]; });
const N = m1.length, T = new Float64Array(N), O = new Float64Array(N), Hh = new Float64Array(N), Ll = new Float64Array(N), C = new Float64Array(N);
m1.forEach((r, i) => { T[i] = r[0]; O[i] = r[1]; Hh[i] = r[2]; Ll[i] = r[3]; C[i] = r[4]; });
export const END = T[N - 1], FINAL = END - 45 * 86400e3, CHECK = FINAL - 91 * 86400e3, START = T[0];
const FX = 155, QTY = 15; export const YEN = QTY * FX;
// 足を作る
function bars(ms) { const B = []; for (let i = 0; i < N; i++) { const k = Math.floor(T[i] / ms) * ms, L = B[B.length - 1]; if (!L || L.t !== k) B.push({ t: k, o: O[i], h: Hh[i], l: Ll[i], c: C[i] }); else { if (Hh[i] > L.h) L.h = Hh[i]; if (Ll[i] < L.l) L.l = Ll[i]; L.c = C[i]; } } return B; }
const TF = {}; for (const [n, ms] of [["30", 1800e3], ["60", 3600e3], ["240", 14400e3]]) { const B = bars(ms); const idx = new Map(B.map((b, i) => [b.t, i]));
  // 値動きの大きさ（14本）と平均線
  let a = B[0].h - B[0].l; const atr = [], e20 = [], e50 = []; let v20 = B[0].c, v50 = B[0].c;
  B.forEach((b, i) => { const tr = i ? Math.max(b.h - b.l, Math.abs(b.h - B[i - 1].c), Math.abs(b.l - B[i - 1].c)) : b.h - b.l; a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14; atr.push(a); v20 = b.c * 2 / 21 + v20 * 19 / 21; v50 = b.c * 2 / 51 + v50 * 49 / 51; e20.push(v20); e50.push(v50); });
  TF[n] = { B, idx, ms, atr, e20, e50 }; }
// 山と谷（前後s本）：[確定した時刻, 値]
const PIVC = {};
function piv(tf, s) { const k = tf + ":" + s; if (PIVC[k]) return PIVC[k]; const { B, ms } = TF[tf], hi = [], lo = [];
  for (let i = s; i < B.length - s; i++) { let ph = true, pl = true; for (let j = 1; j <= s; j++) { if (!(B[i].h > B[i - j].h && B[i].h > B[i + j].h)) ph = false; if (!(B[i].l < B[i - j].l && B[i].l < B[i + j].l)) pl = false; } const ct = B[i + s].t + ms; if (ph) hi.push([ct, B[i].h]); if (pl) lo.push([ct, B[i].l]); }
  return PIVC[k] = { hi, lo }; }
function nearest(list, t, look, entry, dir) { let best; for (let i = list.length - 1; i >= 0; i--) { const [ct, v] = list[i]; if (ct > t) continue; if (ct < t - look) break; if ((v - entry) * dir > 0 && (best === undefined || Math.abs(v - entry) < Math.abs(best - entry))) best = v; } return best; }
const jstOpen = t => { const j = new Date(t + 9 * 3600e3), wd = j.getUTCDay(), h = j.getUTCHours(); if (h === 7 || wd === 0) return false; if (wd === 6) return h < 6; if (wd === 1) return h >= 8; return true; };
const jh = t => new Date(t + 9 * 3600e3).getUTCHours();
export const BASE = { dir: "prev30", stop: 21.4, trail: 18, from: 10, hold: 240, sr: { tf: "240", s: 2, look: 24, near: 12 } };
/* 設定（cfg）の項目
  dir：向き（prev30＝直前の30分、prev60＝直前の1時間、both＝直前30分と1時間がそろう、ema＝30分足の平均線の上下、agree4h＝直前30分と4時間足の流れがそろう）
  stop：最初の損切り（ドル、21.4が5万円）／stopAtr：30分足の値動き×倍（21.4まで）
  trail・from：○ドル伸びたら、いちばん伸びた所から○ドル戻したら決済（trailAtr・fromAtr＝値動きの倍数）
  hold：最長（分）／holdWin：伸びていれば延ばす（分）
  sr：節目 {tf, s, look（時間）, near（ドル）, nearAtr}／srBehind：後ろの節目がこれより遠ければ見送り
  hours：入る時間（日本時間の時の配列）／minMove：直前30分の動き（値動きの倍）以上／vol：[下限, 上限]（30分足の値動き、ドル）
  be：○ドル伸びたら損切りを入った価格へ／tp：利確（ドル）／cool：損切りのあと○分は入らない／maxDay：1日の回数の上限 */
export function run(cfg, cost = { sp: 0.8, slip: 0.1 }) {
  const H = cost.sp / 2, SLIP = cost.slip, tr = [];
  const P = cfg.sr ? piv(cfg.sr.tf, cfg.sr.s) : null, T30 = TF["30"], T60 = TF["60"], T240 = TF["240"];
  let pend = null;   // 押し目・抜けを待っている注文
  let pos = null, coolUntil = 0, dayK = "", dayN = 0, streak = 0, dayLoss = 0, lossDay = "";
  for (let k = 0; k < N; k++) {
    const t = T[k];
    if (pos) {
      const d = pos.dir, hi = Hh[k] - d * H, lo = Ll[k] - d * H, c = C[k] - d * H, worst = d === 1 ? lo : hi, bestP = d === 1 ? hi : lo;
      let px = null, why = "";
      if ((worst - pos.sl) * d <= 0) { px = pos.sl - d * SLIP; why = (pos.sl - pos.entry) * d > 0 ? "戻し" : "損切り"; }
      else if (pos.tp !== null && (bestP - pos.tp) * d >= 0) { px = pos.tp; why = "利確"; }
      if (px === null) {
        if ((bestP - pos.best) * d > 0) pos.best = bestP;
        const gain = (pos.best - pos.entry) * d;
        if (cfg.be && gain >= cfg.be) { const ns = pos.entry + d * 0.5; if ((ns - pos.sl) * d > 0) pos.sl = ns; }
        if (gain >= pos.from) { const ns = pos.best - d * pos.trail; if ((ns - pos.sl) * d > 0) pos.sl = ns; }
        if (t - pos.t >= pos.hold * 60e3) {
          if (cfg.holdWin && !pos.ext && (c - pos.entry) * d > 0) { pos.ext = true; pos.hold += cfg.holdWin; }
          else { px = c; why = "時間切れ"; }
        }
      }
      if (px !== null) { const usd = (px - pos.entry) * d; tr.push({ t: pos.t, usd, why }); if (why === "損切り" && cfg.cool) coolUntil = t + cfg.cool * 60e3;
        streak = usd < 0 ? streak + 1 : 0; if (cfg.streak && streak >= cfg.streak[0]) { coolUntil = Math.max(coolUntil, t + cfg.streak[1] * 60e3); streak = 0; }
        const lk = new Date(t + 2 * 3600e3).toISOString().slice(0, 10); if (lk !== lossDay) { lossDay = lk; dayLoss = 0; } dayLoss += usd * YEN;
        if (cfg.dayStop && dayLoss <= -cfg.dayStop) coolUntil = Math.max(coolUntil, (Math.floor((t + 2 * 3600e3) / 86400e3) + 1) * 86400e3 - 2 * 3600e3);
        pos = null; }
    }
    if (pos) continue;
    if (pend) {   // 待っている注文：届いたら入る、時間が過ぎたら取り消す
      const L = pend.level, d = pend.dir; let fill = false;
      if (pend.kind === "pull") fill = d === 1 ? Ll[k] <= L : Hh[k] >= L; else fill = d === 1 ? Hh[k] >= L : Ll[k] <= L;
      if (fill) { const entry = L + d * H + (pend.kind === "brk" ? d * SLIP : 0); pos = { ...pend.pos, t, entry, sl: entry - d * pend.stop, tp: pend.tpD ? entry + d * pend.tpD : null, best: entry }; pend = null; dayN++; continue; }
      if (t >= pend.until) pend = null; else continue;
    }
    const mm = new Date(t).getUTCMinutes();
    if (!((cfg.mins || [3, 33]).includes(mm)) || !jstOpen(t) || t < coolUntil) continue;
    if (cfg.hours && !cfg.hours.includes(jh(t))) continue;
    const i = T30.idx.get(Math.floor(t / 1800e3) * 1800e3) - 1; if (!(i >= 120)) continue;
    const b = T30.B[i], atr = T30.atr[i];
    let dir = b.c > b.o ? 1 : -1;
    if (cfg.dir === "prev60") { const j = T60.idx.get(Math.floor(t / 3600e3) * 3600e3) - 1, bb = T60.B[j]; if (!bb) continue; dir = bb.c > bb.o ? 1 : -1; }
    else if (cfg.dir === "both") { const j = T60.idx.get(Math.floor(t / 3600e3) * 3600e3) - 1, bb = T60.B[j]; if (!bb || (bb.c > bb.o ? 1 : -1) !== dir) continue; }
    else if (cfg.dir === "ema") dir = b.c > T30.e20[i] ? 1 : -1;
    else if (cfg.dir === "agree4h") { const j = T240.idx.get(Math.floor(t / 14400e3) * 14400e3) - 1; if (!(j >= 50)) continue; if ((T240.B[j].c > T240.e20[j] ? 1 : -1) !== dir) continue; }
    else if (cfg.dir === "fade") dir = -dir;
    else if (cfg.dir === "two30") { const p2 = T30.B[i - 1]; if ((p2.c > p2.o ? 1 : -1) !== dir) continue; }
    else if (cfg.dir === "agree1h") { const j = T60.idx.get(Math.floor(t / 3600e3) * 3600e3) - 1; if (!(j >= 50)) continue; if ((T60.B[j].c > T60.e20[j] ? 1 : -1) !== dir) continue; }
    if (cfg.agree4h && !cfg.dir.startsWith("agree")) { const j = T240.idx.get(Math.floor(t / 14400e3) * 14400e3) - 1; if (!(j >= 50)) continue; if ((T240.B[j].c > T240.e20[j] ? 1 : -1) !== dir) continue; }
    if (cfg.noWd && cfg.noWd.includes(new Date(t + 9 * 3600e3).getUTCDay())) continue;
    if (cfg.minMove && Math.abs(b.c - b.o) < cfg.minMove * atr) continue;
    if (cfg.maxMove && Math.abs(b.c - b.o) > cfg.maxMove * atr) continue;
    if (cfg.slow) { const j = T240.idx.get(Math.floor(t / 14400e3) * 14400e3) - 1; if (!(j >= 60)) continue;
      // 切り替え：直近 regN 本の4時間足が一方向に動いているとき（進んだ割合が regMin 以上）だけ、流れとそろえる
      let use = true; if (cfg.regN) { let rng = 0; for (let q = j - cfg.regN + 1; q <= j; q++) rng += T240.B[q].h - T240.B[q].l; use = Math.abs(T240.B[j].c - T240.B[j - cfg.regN + 1].o) / rng >= cfg.regMin; }
      if (use && (T240.e50[j] > T240.e50[j - cfg.slow] ? 1 : -1) !== dir) continue; }   // 大きな流れ（4時間足の長い平均線の傾き）
    if (cfg.minEff) { let rng = 0; for (let j = i - 7; j <= i; j++) rng += T30.B[j].h - T30.B[j].l; const eff = Math.abs(b.c - T30.B[i - 7].o) / Math.max(1, rng / 8 * 8); if (eff < cfg.minEff) continue; }   // 直近4時間の進み具合
    if (cfg.vol && (atr < cfg.vol[0] || atr > cfg.vol[1])) continue;
    const dk = new Date(t + 2 * 3600e3).toISOString().slice(0, 10); if (dk !== dayK) { dayK = dk; dayN = 0; }
    if (cfg.maxDay && dayN >= cfg.maxDay) continue;
    const entry = C[k] + dir * H;
    if (P) {
      const look = cfg.sr.look * 3600e3, near = cfg.sr.nearAtr ? cfg.sr.nearAtr * atr : cfg.sr.near;
      const ah = nearest(dir === 1 ? P.hi : P.lo, t, look, entry, dir);
      if (ah !== undefined && Math.abs(ah - entry) < near) continue;
      if (cfg.srBehind) { const bh = nearest(dir === 1 ? P.lo : P.hi, t, look, entry, -dir); if (bh === undefined || Math.abs(entry - bh) > cfg.srBehind) continue; }
    }
    let stop = cfg.stopAtr ? Math.min(cfg.stop, cfg.stopAtr * atr) : cfg.stop;
    const trail = cfg.trailAtr ? cfg.trailAtr * atr : cfg.trail, from = cfg.fromAtr ? cfg.fromAtr * atr : cfg.from;
    if (cfg.pull || cfg.brk) {
      const mid = C[k], level = cfg.pull ? mid - dir * cfg.pull : (dir === 1 ? b.h : b.l) + dir * (cfg.brk || 0);
      pend = { kind: cfg.pull ? "pull" : "brk", dir, level, until: t + (cfg.wait || 15) * 60e3, stop, tpD: cfg.tp || 0, pos: { dir, trail, from, hold: cfg.hold } };
      if (cfg.brk && (dir === 1 ? mid >= level : mid <= level)) pend.level = mid;   // もう抜けていれば、今の価格で
      continue;
    }
    pos = { t, dir, entry, sl: entry - dir * stop, tp: cfg.tp ? entry + dir * cfg.tp : null, best: entry, trail, from, hold: cfg.hold };
    dayN++;
  }
  return tr;
}
export function score(cfg) {
  const out = {};
  for (const [nm, cost] of [["c8", { sp: 0.8, slip: 0.1 }], ["c12", { sp: 1.2, slip: 0.2 }]]) {
    const tr = run(cfg, cost), S = (a, b) => { const x = tr.filter(q => q.t >= a && q.t < b); let s = 0, pk = 0, dd = 0; for (const q of x) { s += q.usd; pk = Math.max(pk, s); dd = Math.max(dd, pk - s); } return { yen: s * YEN, n: x.length, dd: dd * YEN, win: x.filter(q => q.usd > 0).length / Math.max(1, x.length) }; };
    out[nm] = { tune: S(START, CHECK), check: S(CHECK, FINAL), final: S(FINAL, Infinity) };
  }
  return out;
}
export const man = v => (v / 1e4).toFixed(0);
