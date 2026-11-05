// 30分ごとの練習：決済を「臨機応変」にすると良くなるか（1分足で確かめる）
// 入り方は今と同じ（毎時3分・33分、直前の30分と同じ向き）。決済のしかたを変えて比べる
//  ・今のまま：損切り21.4ドル（5万円）・利確2倍・最長4時間
//  ・含み益を守る：○ドル伸びたら損切りを入った価格へ／最高値から○ドル戻したら決済（追いかける損切り）
//  ・節目（支持線・抵抗線）：利確＝近くの抵抗線（売りは支持線）の手前、損切り＝反対の節目の少し外（5万円まで）
//  ・流れが変わったら決済：30分の足が反対向きに閉じたら
// 前半で選び、後半で確かめる（後半で良くなったものだけ採用の候補）
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const m1 = gunzipSync(readFileSync("data/xau_usd_1min.csv.gz")).toString("utf8").trim().split("\n").slice(1).map(l => { const [t, o, h, lo, c] = l.split(","); return [Date.parse(t.replace(" ", "T") + ":00Z"), +o, +h, +lo, +c]; });
const SP = 0.8, SLIP = 0.1, FX = 155, QTY = 15, H = SP / 2, YEN = QTY * FX;
const STOP = 50000 / (QTY * FX) - SLIP;
const b30 = []; for (const r of m1) { const k = Math.floor(r[0] / 1800e3) * 1800e3, L = b30[b30.length - 1]; if (!L || L[0] !== k) b30.push([k, r[1], r[2], r[3], r[4]]); else { L[2] = Math.max(L[2], r[2]); L[3] = Math.min(L[3], r[3]); L[4] = r[4]; } }
const idx30 = new Map(b30.map((b, i) => [b[0], i]));
// 節目：30分足で、前後2本より高い（低い）ところ。確定は2本あと
const pivH = [], pivL = [];
for (let i = 2; i < b30.length - 2; i++) {
  if (b30[i][2] > Math.max(b30[i - 1][2], b30[i - 2][2], b30[i + 1][2], b30[i + 2][2])) pivH.push([i + 2, b30[i][2]]);
  if (b30[i][3] < Math.min(b30[i - 1][3], b30[i - 2][3], b30[i + 1][3], b30[i + 2][3])) pivL.push([i + 2, b30[i][3]]);
}
const near = (list, i, look, pred) => { let best = null; for (const [ci, v] of list) { if (ci > i) break; if (ci < i - look) continue; if (pred(v) && (best === null || Math.abs(v - pred.ref) < Math.abs(best - pred.ref))) best = v; } return best; };
const jstOpen = t => { const j = new Date(t + 9 * 3600e3), wd = j.getUTCDay(), h = j.getUTCHours(); if (h === 7 || wd === 0) return false; if (wd === 6) return h < 6; if (wd === 1) return h >= 8; return true; };
function run(o) {
  const trades = []; let pos = null;
  for (let k = 0; k < m1.length; k++) {
    const [t, op, hi, lo, c] = m1[k];
    if (pos) {
      const d = pos.dir, bid = { hi: hi - H, lo: lo - H, c: c - H }, ask = { hi: hi + H, lo: lo + H, c: c + H };
      const q = d === 1 ? bid : ask, worst = d === 1 ? q.lo : q.hi, bestP = d === 1 ? q.hi : q.lo;
      let px = null, why = "";
      if ((worst - pos.sl) * d <= 0) { px = pos.sl - d * SLIP; why = "損切り"; }
      else if (pos.tp !== null && (bestP - pos.tp) * d >= 0) { px = pos.tp; why = "利確"; }
      if (px === null) {
        pos.best = d === 1 ? Math.max(pos.best, q.hi) : Math.min(pos.best, q.lo);
        const gain = (pos.best - pos.entry) * d;
        if (o.be && gain >= o.be) pos.sl = d === 1 ? Math.max(pos.sl, pos.entry + 0.5) : Math.min(pos.sl, pos.entry - 0.5);
        if (o.trail && gain >= (o.trailFrom || 0)) { const ns = pos.best - d * o.trail; pos.sl = d === 1 ? Math.max(pos.sl, ns) : Math.min(pos.sl, ns); }
        if (o.flip && (t + 60e3) % 1800e3 === 0) { const i = idx30.get(Math.floor(t / 1800e3) * 1800e3), b = b30[i]; if (b && (b[4] - b[1]) * d < 0 && t - pos.t >= 25 * 60e3) { px = q.c; why = "流れが変わった"; } }
        if (px === null && t - pos.t >= o.hold * 60e3) { px = q.c; why = "時間切れ"; }
      }
      if (px !== null) { trades.push({ t: pos.t, usd: (px - pos.entry) * d, why }); pos = null; }
    }
    const mm = new Date(t).getUTCMinutes();
    if (!pos && (mm === 3 || mm === 33) && jstOpen(t)) {
      const i = idx30.get(Math.floor(t / 1800e3) * 1800e3) - 1; if (i < 100) continue;
      const dir = b30[i][4] > b30[i][1] ? 1 : -1, entry = c + dir * H;
      let sl = entry - dir * STOP, tp = o.rr ? entry + dir * STOP * o.rr : null;
      if (o.sr) {   // 節目で利確・損切り
        const fT = v => (v - entry) * dir > o.srMin; fT.ref = entry;
        const tgt = near(dir === 1 ? pivH : pivL, i, o.look, fT);
        if (tgt !== null) tp = tgt - dir * o.srBuf; else if (o.srSkip) continue;
        const fS = v => (entry - v) * dir > 2; fS.ref = entry;
        const sup = near(dir === 1 ? pivL : pivH, i, o.look, fS);
        if (sup !== null && o.srStop) { const s2 = sup - dir * o.srBuf; if ((entry - s2) * dir < STOP) sl = s2; }
      }
      pos = { t, dir, entry, sl, tp, best: entry };
    }
  }
  return trades;
}
const half = m1[Math.floor(m1.length / 2)][0];
const man = v => (v * YEN / 1e4).toFixed(0).padStart(4);
const show = (name, o) => {
  const tr = run(o), all = tr.reduce((a, x) => a + x.usd, 0), a = tr.filter(x => x.t < half).reduce((p, x) => p + x.usd, 0);
  const w = tr.filter(x => x.usd > 0).length, why = {}; for (const x of tr) why[x.why] = (why[x.why] || 0) + 1;
  console.log(`${name.padEnd(30, "　")} ${man(all)}万（前半${man(a)}・後半${man(all - a)}） ${tr.length}回 勝率${Math.round(w / tr.length * 100)}％ ${Object.entries(why).map(([k, v]) => k + v).join(" ")}`);
};
console.log(`1分足 2026年7月〜11月・15枚・損切り最大${STOP.toFixed(1)}ドル（5万円）・スプレッド0.8ドル込み。損益は円\n`);
show("今のまま（利確2倍・4時間）", { rr: 2, hold: 240 });
show("利確なし・4時間", { rr: 0, hold: 240 });
for (const be of [5, 10, 15]) show(`${be}ドル伸びたら損切りを入った価格へ`, { rr: 2, hold: 240, be });
for (const tr of [5, 8, 12, 16]) for (const from of [0, 5, 10]) show(`最高値から${tr}ドル戻したら決済（${from}ドル伸びてから）`, { rr: 0, hold: 240, trail: tr, trailFrom: from });
for (const tr of [8, 12]) show(`利確2倍＋${tr}ドル戻したら決済`, { rr: 2, hold: 240, trail: tr, trailFrom: 10 });
show("30分の足が反対向きなら決済", { rr: 2, hold: 240, flip: 1 });
show("反対向きで決済＋10ドルで入った価格へ", { rr: 2, hold: 240, flip: 1, be: 10 });
for (const look of [24, 48]) for (const srMin of [5, 10]) {
  show(`節目で利確（${look / 2}時間・${srMin}ドル以上先）`, { rr: 2, hold: 240, sr: 1, look, srMin, srBuf: 0.5 });
  show(`節目で利確と損切り（${look / 2}時間・${srMin}ドル以上先）`, { rr: 2, hold: 240, sr: 1, srStop: 1, look, srMin, srBuf: 0.5 });
  show(`節目がなければ見送り（${look / 2}時間・${srMin}ドル以上先）`, { rr: 2, hold: 240, sr: 1, srStop: 1, srSkip: 1, look, srMin, srBuf: 0.5 });
}
show("節目で利確＋8ドル戻したら決済", { rr: 2, hold: 240, sr: 1, look: 48, srMin: 5, srBuf: 0.5, trail: 8, trailFrom: 10 });
