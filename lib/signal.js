// 金の判断（アプリの「一目均衡表＋損切り幅の下限＋日足の流れ」と同じ計算）を、通知用に計算する
// bars：[時刻ms, 始, 高, 安, 終] の古い順。最後の1本は「まだ確定していない今の足」でもよい
const ema = (a, n) => { const k = 2 / (n + 1), o = new Float64Array(a.length); o[0] = a[0]; for (let i = 1; i < a.length; i++) o[i] = a[i] * k + o[i - 1] * (1 - k); return o; };
const rollMax = (a, n) => a.map((_, i) => { let m = -Infinity; for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.max(m, a[k]); return m; });
const rollMin = (a, n) => a.map((_, i) => { let m = Infinity; for (let k = Math.max(0, i - n + 1); k <= i; k++) m = Math.min(m, a[k]); return m; });
function usDst(t) { const y = new Date(t).getUTCFullYear(); const nth = (m, n) => { const f = new Date(Date.UTC(y, m, 1)).getUTCDay(); return Date.UTC(y, m, 1 + ((7 - f) % 7) + 7 * (n - 1)); }; return t >= nth(2, 2) + 7 * 3600e3 && t < nth(10, 1) + 6 * 3600e3; }
export function mondayFirstHour(t) { const j = new Date(t + 9 * 3600e3 + (usDst(t) ? 3600e3 : 0)); return j.getUTCDay() === 1 && j.getUTCHours() === 8; }
export function gmoOpen(t) { const j = new Date(t + 9 * 3600e3 + (usDst(t) ? 3600e3 : 0)), wd = j.getUTCDay(), h = j.getUTCHours(); if (h === 7 || wd === 0) return false; if (wd === 6) return h < 7; if (wd === 1) return h >= 8; return true; }

export function computeSignal(all, now, st) {
  const live = all[all.length - 1], done = live[0] + 3600e3 <= now ? all : all.slice(0, -1);
  const n = done.length, i = n - 1;
  if (n < 600) return { side: "wait", reason: "データが足りない" };
  const t = done.map(r => r[0]), o = done.map(r => r[1]), h = done.map(r => r[2]), l = done.map(r => r[3]), c = done.map(r => r[4]);
  // 値動きの大きさ（14本）
  const atr = new Float64Array(n); let a = h[0] - l[0]; atr[0] = a;
  for (let k = 1; k < n; k++) { const tr = Math.max(h[k] - l[k], Math.abs(h[k] - c[k - 1]), Math.abs(l[k] - c[k - 1])); a = k < 14 ? (a * k + tr) / (k + 1) : (a * 13 + tr) / 14; atr[k] = a; }
  const h9 = rollMax(h, 9), l9 = rollMin(l, 9), h26 = rollMax(h, 26), l26 = rollMin(l, 26), h52 = rollMax(h, 52), l52 = rollMin(l, 52);
  const ten = k => (h9[k] + l9[k]) / 2, kij = k => (h26[k] + l26[k]) / 2;
  const top = k => { const j = k - 26; return Math.max((ten(j) + kij(j)) / 2, (h52[j] + l52[j]) / 2); }, bot = k => { const j = k - 26; return Math.min((ten(j) + kij(j)) / 2, (h52[j] + l52[j]) / 2); };
  const daily = ema(c, 460);
  const p = st.paramsI, cost = st.cost, stop = p.slMult * atr[i];
  const wide = stop >= p.minStop, cheap = cost.spread / stop <= 0.1, open = gmoOpen(now) && !mondayFirstHour(now);
  const big = Math.abs(c[i] - o[i]) > 0.6 * atr[i];   // 抜けた足が大きいこと（アプリと同じ）
  const buy = big && c[i] > top(i) && c[i - 1] <= top(i - 1) && ten(i) > kij(i) && daily[i] > daily[i - 115] && wide && cheap;
  const sell = big && c[i] < bot(i) && c[i - 1] >= bot(i - 1) && ten(i) < kij(i) && daily[i] < daily[i - 115] && wide && cheap;
  const side = !open ? "wait" : buy ? "buy" : sell ? "sell" : "wait";
  if (side === "wait") return { side, barT: t[i] };
  const dir = side === "buy" ? 1 : -1, mid = live[4], entry = mid + dir * cost.spread / 2;
  // 数量を固定するとき：損切りの幅＝損切りの金額÷（数量×ドル円）−ずれ、利確＝その幅×決めた倍率（research/fixed15.mjs）
  const fx = st.fixed && st.fixed.on ? st.fixed : null;
  const stopU = fx ? Math.max(1, fx.loss / (fx.qty * st.fx) - cost.slip) : stop, rr = fx ? fx.rr : p.rr;
  const sl = entry - dir * stopU, tp = entry + dir * stopU * rr;
  const qty = fx ? fx.qty : Math.max(0, Math.floor(st.riskPerTrade / ((stop + cost.slip) * st.fx) / cost.step + 1e-9) * cost.step);
  const up = dir === 1, f2 = v => v.toFixed(2), jh = new Date(t[i] + 9 * 3600e3).getUTCHours();
  const basis = [
    `${jh}時台の足が、最近のもみ合いの範囲の${up ? "上の端（" + f2(top(i)) + "）を上" : "下の端（" + f2(bot(i)) + "）を下"}に抜けた（終わり ${f2(c[i])}）`,
    `抜けた足の動きが${f2(Math.abs(c[i] - o[i]))}ドルと大きい（ふだんの1時間の${(Math.abs(c[i] - o[i]) / atr[i]).toFixed(1)}倍）`,
    `ここ数日の勢いが${up ? "上" : "下"}向き`,
    `この1か月の大きな流れが${up ? "上" : "下"}向き`,
    `損切り：入る${up ? "−" : "＋"}${f2(stopU)}ドル（${fx ? fx.qty + "枚で" + Math.round(fx.loss / 1e4) + "万円" : "ふだんの値動きの" + p.slMult + "倍"}）、利確：入る${up ? "＋" : "−"}${f2(stopU * rr)}ドル（損切り幅の${rr}倍）`,
  ];
  return { side, barT: t[i], entry, sl, tp, qty: +qty.toFixed(1), basis };
}
