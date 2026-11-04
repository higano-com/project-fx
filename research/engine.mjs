// 研究用の検証エンジン（アプリとは別。複数の判断ルールを公平に比べるため）
// ・価格を読むだけ。注文や口座接続はしない
// ・損益は「R」（1回の許容損失を1としたときの倍数）で記録し、あとで金額に換算する
import { readFileSync } from "node:fs";

export function loadCsv(path) {
  return readFileSync(path, "utf8").trim().split("\n").slice(1).map(l => {
    const [t, o, h, lo, c] = l.split(",");
    return [Date.parse(t.replace(" ", "T") + ":00Z"), +o, +h, +lo, +c];
  });
}

/* GMOクリック証券 金スポットの取引時間（日本時間 月8:00〜土7:00、毎日7:00〜8:00休み。米夏時間は1時間早い） */
function usDst(t) {
  const y = new Date(t).getUTCFullYear();
  const nthSun = (m, n) => { const f = new Date(Date.UTC(y, m, 1)).getUTCDay(); return Date.UTC(y, m, 1 + ((7 - f) % 7) + 7 * (n - 1)); };
  return t >= nthSun(2, 2) + 7 * 3600e3 && t < nthSun(10, 1) + 6 * 3600e3;
}
export function gmoOpen(t) {
  const j = new Date(t + 9 * 3600e3 + (usDst(t) ? 3600e3 : 0));
  const wd = j.getUTCDay(), h = j.getUTCHours();
  if (h === 7 || wd === 0) return false;
  if (wd === 6) return h < 7;
  if (wd === 1) return h >= 8;
  return true;
}

/* データの準備：飛んだ値を直し、GMOの取引時間外の足を除き、ドル円を合わせる */
export function prepare(xau, jpy) {
  const fixes = [];
  const x = xau.map(r => r.slice());
  for (let i = 1; i < x.length - 1; i++) {
    const [t, o, h, l, c] = x[i], body = [Math.min(o, c), Math.max(o, c)];
    const nbLow = Math.min(x[i - 1][3], x[i + 1][3]), nbHigh = Math.max(x[i - 1][2], x[i + 1][2]);
    if (l < body[0] * 0.96 && l < nbLow * 0.96) { fixes.push({ t, field: "low", from: l, to: body[0] }); x[i][3] = body[0]; }
    if (h > body[1] * 1.04 && h > nbHigh * 1.04) { fixes.push({ t, field: "high", from: h, to: body[1] }); x[i][2] = body[1]; }
  }
  const kept = x.filter(r => gmoOpen(r[0]));
  const n = kept.length;
  const B = { n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), fx: new Float64Array(n), fixes, removed: x.length - n };
  let k = 0, last = jpy[0][4];
  for (let i = 0; i < n; i++) {
    const r = kept[i];
    B.t[i] = r[0]; B.o[i] = r[1]; B.h[i] = r[2]; B.l[i] = r[3]; B.c[i] = r[4];
    while (k < jpy.length && jpy[k][0] <= r[0]) { last = jpy[k][4]; k++; }
    B.fx[i] = last;
  }
  addIndicators(B);
  return B;
}

function ema(a, n) { const k = 2 / (n + 1), o = new Float64Array(a.length); o[0] = a[0]; for (let i = 1; i < a.length; i++) o[i] = a[i] * k + o[i - 1] * (1 - k); return o; }
function sma(a, n) { const o = new Float64Array(a.length); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; o[i] = s / Math.min(i + 1, n); } return o; }
function rsi(c, n) { const o = new Float64Array(c.length).fill(50); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; } if (i >= n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; }
function atr(B, n) { const o = new Float64Array(B.n); let a = B.h[0] - B.l[0]; o[0] = a; for (let i = 1; i < B.n; i++) { const tr = Math.max(B.h[i] - B.l[i], Math.abs(B.h[i] - B.c[i - 1]), Math.abs(B.l[i] - B.c[i - 1])); a = i < n ? (a * i + tr) / (i + 1) : (a * (n - 1) + tr) / n; o[i] = a; } return o; }
function rollMax(a, n) { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) { let m = -Infinity; for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.max(m, a[k]); o[i] = m; } return o; }
function rollMin(a, n) { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) { let m = Infinity; for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.min(m, a[k]); o[i] = m; } return o; }

function addIndicators(B) {
  B._ema = {}; B._hh = {}; B._ll = {};
  B.ema = n => B._ema[n] || (B._ema[n] = ema(B.c, n));
  B.hh = n => B._hh[n] || (B._hh[n] = rollMax(B.h, n));
  B.ll = n => B._ll[n] || (B._ll[n] = rollMin(B.l, n));
  B.rsi = rsi(B.c, 14);
  B.atr = atr(B, 14);
  B.atrAvg = sma(B.atr, 100);
  B.regime = regimes(B);
  addOscillators(B);
}

/* 金でよく使われる指標 */
function addOscillators(B) {
  const n = B.n, hh14 = B.hh(14), ll14 = B.ll(14);
  // ストキャスティクス（14本、平均3本）
  const k = new Float64Array(n); for (let i = 0; i < n; i++) { const r = hh14[i] - ll14[i]; k[i] = r > 0 ? (B.c[i] - ll14[i]) / r * 100 : 50; }
  B.stK = k; B.stD = sma(k, 3);
  // 移動平均の収束と拡散（12・26・9）
  const e12 = ema(B.c, 12), e26 = ema(B.c, 26), m = new Float64Array(n); for (let i = 0; i < n; i++) m[i] = e12[i] - e26[i];
  B.macd = m; B.macdSig = ema(m, 9);
  // ボリンジャーバンド（20本）
  const mid = sma(B.c, 20), sd = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = Math.max(0, i - 19); j <= i; j++) { s += (B.c[j] - mid[i]) ** 2; c++; } sd[i] = Math.sqrt(s / c); }
  B.bbMid = mid; B.bbSd = sd;
  const width = new Float64Array(n); for (let i = 0; i < n; i++) width[i] = 4 * sd[i] / mid[i];
  B.bbWidth = width; B.bbWidthAvg = sma(width, 200);
  // トレンドの強さ（14本）
  const adx = new Float64Array(n); let trS = 0, pS = 0, mS = 0, ax = 0;
  for (let i = 1; i < n; i++) {
    const up = B.h[i] - B.h[i - 1], dn = B.l[i - 1] - B.l[i];
    const pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(B.h[i] - B.l[i], Math.abs(B.h[i] - B.c[i - 1]), Math.abs(B.l[i] - B.c[i - 1]));
    trS = trS - trS / 14 + tr; pS = pS - pS / 14 + pdm; mS = mS - mS / 14 + mdm;
    const pdi = trS ? 100 * pS / trS : 0, mdi = trS ? 100 * mS / trS : 0, dx = pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0;
    ax = i < 28 ? dx : (ax * 13 + dx) / 14; adx[i] = ax;
  }
  B.adx = adx;
  // 商品チャネル指数（20本）
  const tp = new Float64Array(n); for (let i = 0; i < n; i++) tp[i] = (B.h[i] + B.l[i] + B.c[i]) / 3;
  const tpm = sma(tp, 20), cci = new Float64Array(n);
  for (let i = 0; i < n; i++) { let md = 0, c = 0; for (let j = Math.max(0, i - 19); j <= i; j++) { md += Math.abs(tp[j] - tpm[i]); c++; } md /= c; cci[i] = md ? (tp[i] - tpm[i]) / (0.015 * md) : 0; }
  B.cci = cci;
  // 一目均衡表（9・26・52、雲は26本前に計算した値）
  const h9 = B.hh(9), l9 = B.ll(9), h26 = B.hh(26), l26 = B.ll(26), h52 = B.hh(52), l52 = B.ll(52);
  const ten = new Float64Array(n), kij = new Float64Array(n), cloudTop = new Float64Array(n), cloudBot = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ten[i] = (h9[i] + l9[i]) / 2; kij[i] = (h26[i] + l26[i]) / 2;
    const j = i - 26; if (j >= 0) { const a = ((h9[j] + l9[j]) / 2 + (h26[j] + l26[j]) / 2) / 2, b = (h52[j] + l52[j]) / 2; cloudTop[i] = Math.max(a, b); cloudBot[i] = Math.min(a, b); }
  }
  B.ten = ten; B.kij = kij; B.cloudTop = cloudTop; B.cloudBot = cloudBot;
}

/* 相場のパターン（取引を始めた時点で、それまでの値動きから決める。先の値動きは見ない） */
export const REGIMES = ["暴落", "暴落後の反発", "急騰", "強い上昇", "強い下落", "荒れた相場", "横ばい", "ふつう"];
function regimes(B) {
  const out = new Array(B.n).fill("ふつう");
  const D5 = 115, D20 = 460;   // 取引時間で約5日・約20日
  let lastCrash = -Infinity;
  for (let i = D20; i < B.n; i++) {
    const r5 = B.c[i] / B.c[i - D5] - 1, r20 = B.c[i] / B.c[i - D20] - 1, vr = B.atr[i] / B.atrAvg[i];
    if (r5 <= -0.05) { out[i] = "暴落"; lastCrash = i; continue; }
    if (i - lastCrash <= 2 * D5 && r5 >= 0.02) { out[i] = "暴落後の反発"; continue; }
    if (r5 >= 0.05) { out[i] = "急騰"; continue; }
    if (r20 >= 0.06) { out[i] = "強い上昇"; continue; }
    if (r20 <= -0.06) { out[i] = "強い下落"; continue; }
    if (vr >= 1.6) { out[i] = "荒れた相場"; continue; }
    if (Math.abs(r20) < 0.015) { out[i] = "横ばい"; continue; }
  }
  return out;
}

/* 判断のルール（i本目の足が確定した時点で判断。dir: 1=買い, -1=売り） */
export const STRATEGIES = {
  // 今のアプリのルール：大きな流れの方向に、押し目・戻りから平均線を抜け直したら乗る
  pullback: {
    name: "押し目・戻り（今のルール）",
    grid: { fast: [10, 20, 30], slow: [50, 100, 150], slMult: [1, 1.5, 2], rr: [1.5, 2, 3] },
    fn(B, i, p) {
      const ef = B.ema(p.fast), es = B.ema(p.slow), c = B.c[i], r = B.rsi[i], vr = B.atr[i] / B.atrAvg[i];
      if (vr >= 1.8) return null;
      if (es[i] > es[i - 24] && c > es[i] && B.c[i - 1] <= ef[i - 1] && c > ef[i] && r >= 40 && r <= 70) return { dir: 1, stop: p.slMult * B.atr[i], rr: p.rr };
      if (es[i] < es[i - 24] && c < es[i] && B.c[i - 1] >= ef[i - 1] && c < ef[i] && r >= 30 && r <= 60) return { dir: -1, stop: p.slMult * B.atr[i], rr: p.rr };
      return null;
    }
  },
  // 今のルール＋日足の流れ（約20日の平均線の向き）と同じ方向だけ
  pullbackDaily: {
    name: "押し目・戻り＋日足の流れ",
    grid: { fast: [10, 20, 30], slow: [50, 100, 150], slMult: [1, 1.5, 2], rr: [1.5, 2, 3] },
    fn(B, i, p) {
      const s = STRATEGIES.pullback.fn(B, i, p); if (!s) return null;
      const d = B.ema(460); const up = d[i] > d[i - 115];
      return (s.dir === 1) === up ? s : null;
    }
  },
  // 直近N本の高値・安値を抜けたら、その方向に乗る
  breakout: {
    name: "高値・安値を抜けたら乗る",
    grid: { n: [24, 48, 96], slMult: [1, 1.5, 2], rr: [1.5, 2, 3] },
    fn(B, i, p) {
      const hh = B.hh(p.n), ll = B.ll(p.n), c = B.c[i], vr = B.atr[i] / B.atrAvg[i];
      if (vr >= 2.5) return null;
      if (c > hh[i - 1] && B.c[i - 1] <= hh[i - 2]) return { dir: 1, stop: p.slMult * B.atr[i], rr: p.rr };
      if (c < ll[i - 1] && B.c[i - 1] >= ll[i - 2]) return { dir: -1, stop: p.slMult * B.atr[i], rr: p.rr };
      return null;
    }
  },
  // 急に下がり（上がり）すぎたら、戻りを狙う
  reversal: {
    name: "行き過ぎの戻りを狙う",
    grid: { lo: [20, 25, 30], k: [2, 3, 4], slMult: [1, 1.5, 2], rr: [1, 1.5, 2] },
    fn(B, i, p) {
      const es = B.ema(50), c = B.c[i], o = B.o[i], r = B.rsi[i], a = B.atr[i];
      if (r <= p.lo && c < es[i] - p.k * a && c > o) return { dir: 1, stop: p.slMult * a, rr: p.rr };
      if (r >= 100 - p.lo && c > es[i] + p.k * a && c < o) return { dir: -1, stop: p.slMult * a, rr: p.rr };
      return null;
    }
  },
  // ストキャスティクス：流れの方向に、売られすぎ（買われすぎ）から戻ったら乗る
  stoch: {
    name: "ストキャスティクス（流れの方向に）",
    grid: { slow: [50, 100, 150], lv: [20, 30], slMult: [1, 1.5, 2], rr: [1.5, 2, 3] },
    fn(B, i, p) {
      const es = B.ema(p.slow), a = B.atr[i];
      const crossUp = B.stK[i - 1] <= B.stD[i - 1] && B.stK[i] > B.stD[i], crossDn = B.stK[i - 1] >= B.stD[i - 1] && B.stK[i] < B.stD[i];
      if (es[i] > es[i - 24] && crossUp && B.stK[i - 1] < p.lv) return { dir: 1, stop: p.slMult * a, rr: p.rr };
      if (es[i] < es[i - 24] && crossDn && B.stK[i - 1] > 100 - p.lv) return { dir: -1, stop: p.slMult * a, rr: p.rr };
      return null;
    }
  },
  // 移動平均の収束と拡散：流れの方向に、線が交わったら乗る
  macd: {
    name: "移動平均の収束と拡散（流れの方向に）",
    grid: { slow: [50, 100, 150], slMult: [1, 1.5, 2], rr: [1.5, 2, 3] },
    fn(B, i, p) {
      const es = B.ema(p.slow), a = B.atr[i], m = B.macd, s = B.macdSig;
      if (es[i] > es[i - 24] && m[i - 1] <= s[i - 1] && m[i] > s[i]) return { dir: 1, stop: p.slMult * a, rr: p.rr };
      if (es[i] < es[i - 24] && m[i - 1] >= s[i - 1] && m[i] < s[i]) return { dir: -1, stop: p.slMult * a, rr: p.rr };
      return null;
    }
  },
  // ボリンジャーバンド：帯の外に飛び出したら、その方向に乗る
  bollinger: {
    name: "ボリンジャーバンドの外に出たら乗る",
    grid: { k: [2, 2.5, 3], slMult: [1, 1.5, 2], rr: [1.5, 2, 3] },
    fn(B, i, p) {
      const up = B.bbMid[i] + p.k * B.bbSd[i], lo = B.bbMid[i] - p.k * B.bbSd[i], upP = B.bbMid[i - 1] + p.k * B.bbSd[i - 1], loP = B.bbMid[i - 1] - p.k * B.bbSd[i - 1], a = B.atr[i];
      if (B.c[i] > up && B.c[i - 1] <= upP) return { dir: 1, stop: p.slMult * a, rr: p.rr };
      if (B.c[i] < lo && B.c[i - 1] >= loP) return { dir: -1, stop: p.slMult * a, rr: p.rr };
      return null;
    }
  },
  // 一目均衡表：雲の上に抜けて、転換線が基準線より上なら買い（逆なら売り）
  ichimoku: {
    name: "一目均衡表（雲抜け）",
    grid: { slMult: [1, 1.5, 2, 2.5], rr: [1.5, 2, 3] },
    fn(B, i, p) {
      const a = B.atr[i];
      if (B.c[i] > B.cloudTop[i] && B.c[i - 1] <= B.cloudTop[i - 1] && B.ten[i] > B.kij[i]) return { dir: 1, stop: p.slMult * a, rr: p.rr };
      if (B.c[i] < B.cloudBot[i] && B.c[i - 1] >= B.cloudBot[i - 1] && B.ten[i] < B.kij[i]) return { dir: -1, stop: p.slMult * a, rr: p.rr };
      return null;
    }
  },
  // 商品チャネル指数：流れの方向に、行き過ぎから戻ったら乗る
  cci: {
    name: "商品チャネル指数（流れの方向に）",
    grid: { slow: [50, 100, 150], lv: [100, 150], slMult: [1, 1.5, 2], rr: [1.5, 2, 3] },
    fn(B, i, p) {
      const es = B.ema(p.slow), a = B.atr[i];
      if (es[i] > es[i - 24] && B.cci[i - 1] < -p.lv && B.cci[i] >= -p.lv) return { dir: 1, stop: p.slMult * a, rr: p.rr };
      if (es[i] < es[i - 24] && B.cci[i - 1] > p.lv && B.cci[i] <= p.lv) return { dir: -1, stop: p.slMult * a, rr: p.rr };
      return null;
    }
  },
};

export function gridList(grid) {
  const keys = Object.keys(grid); let out = [{ p: {}, idx: [] }];
  for (const k of keys) out = out.flatMap(x => grid[k].map((v, j) => ({ p: { ...x.p, [k]: v }, idx: [...x.idx, j] })));
  return out;
}

/* 1つの判断ルールを全期間で動かし、取引ごとの R を記録する（同時に1つまで） */
export const COST = { spread: 0.80, slip: 0.10, swapLong: 85, swapShort: -83 };   // GMO 金スポット（2026/11/04 の画面）
const RISK = 10000;   // R を計算するための仮の金額（円）
function rollovers(t0, t1) { const day = 86400e3, off = 22 * 3600e3; return Math.max(0, Math.floor((t1 - off) / day) - Math.floor((t0 - off) / day)); }
export function runStrategy(B, strat, p, { from = 500, to = B.n, maxHold = 120, flat = null } = {}) {
  const trades = []; let pos = null, pend = null;
  const h = COST.spread / 2;
  for (let i = from; i < to; i++) {
    if (pend) {
      const entry = B.o[i] + pend.dir * h, qty = RISK / ((pend.stop + COST.slip) * B.fx[i]);
      pos = { i, t: B.t[i], dir: pend.dir, entry, sl: entry - pend.dir * pend.stop, tp: entry + pend.dir * pend.stop * pend.rr, qty, stopFrac: pend.stop / entry, regime: B.regime[pend.i] };
      pend = null;
    }
    if (pos && flat && flat[i] && i > pos.i) {   // 発表の前に決済（その足の始値で）
      const px = B.o[i] - pos.dir * h, days = rollovers(pos.t, B.t[i]);
      const swap = (pos.dir === 1 ? COST.swapLong : COST.swapShort) * pos.qty * days;
      trades.push({ t: pos.t, t1: B.t[i], dir: pos.dir, R: ((px - pos.entry) * pos.dir * pos.qty * B.fx[i] - swap) / RISK, why: "発表前に決済", regime: pos.regime, stopFrac: pos.stopFrac, hours: i - pos.i });
      pos = null;
    }
    if (pos) {
      let px = null, why = null;
      if (pos.dir === 1) {
        const o = B.o[i] - h, lo = B.l[i] - h, hi = B.h[i] - h;
        if (o <= pos.sl) { px = o - COST.slip; why = "損切り"; } else if (lo <= pos.sl) { px = pos.sl - COST.slip; why = "損切り"; }
        else if (o >= pos.tp) { px = o; why = "利確"; } else if (hi >= pos.tp) { px = pos.tp; why = "利確"; }
      } else {
        const o = B.o[i] + h, lo = B.l[i] + h, hi = B.h[i] + h;
        if (o >= pos.sl) { px = o + COST.slip; why = "損切り"; } else if (hi >= pos.sl) { px = pos.sl + COST.slip; why = "損切り"; }
        else if (o <= pos.tp) { px = o; why = "利確"; } else if (lo <= pos.tp) { px = pos.tp; why = "利確"; }
      }
      if (!px && i - pos.i >= maxHold) { px = B.c[i] - pos.dir * h; why = "時間切れ"; }
      if (px !== null) {
        const days = rollovers(pos.t, B.t[i]);
        const swap = (pos.dir === 1 ? COST.swapLong : COST.swapShort) * pos.qty * days;
        const net = (px - pos.entry) * pos.dir * pos.qty * B.fx[i] - swap;
        trades.push({ t: pos.t, t1: B.t[i], dir: pos.dir, R: net / RISK, why, regime: pos.regime, stopFrac: pos.stopFrac, hours: i - pos.i });
        pos = null;
      }
    }
    if (!pos && !pend && i < to - 1) {
      if (COST.spread > 0) {
        const s = strat.fn(B, i, p);
        if (s && COST.spread <= 0.1 * s.stop) pend = { ...s, i };
      }
    }
  }
  return trades;
}

export function summarize(tr) {
  const n = tr.length; if (!n) return { n: 0, win: 0, avgR: 0, sumR: 0, pf: 0, maxDDR: 0 };
  let w = 0, gp = 0, gl = 0, eq = 0, pk = 0, dd = 0;
  for (const x of tr) { if (x.R > 0) { w++; gp += x.R; } else gl -= x.R; eq += x.R; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  return { n, win: w / n, avgR: (gp - gl) / n, sumR: gp - gl, pf: gl ? gp / gl : Infinity, maxDDR: dd };
}
