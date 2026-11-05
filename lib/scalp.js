// 30分ごとの練習の取引（スキャルピング。仮想のお金だけ。実際の注文はしない。GMOクリック証券にも接続しない）
// 見張り役が毎時3分と33分にこれを呼ぶ。持っていなければ入る。1分足の高値・安値で、損切り・利確に届いたかを確かめる
// 決め方は research/scalp30.mjs で一番マイナスが小さかったもの：
//   向き＝直前の30分が上がったら買い・下がったら売り、損切り＝数量固定の金額（15枚で5万円）、利確＝損切り幅の2倍、最長4時間
// 注意：検証では、どの決め方も今のコストではマイナスだった（成績の画面にも書く）
const DAY = 86400e3, HOLD = 4 * 3600e3, RR = 2;
const dayKey = t => new Date(t + 9 * 3600e3 - 7 * 3600e3).toISOString().slice(0, 10);   // GMOの1日（日本時間7時区切り）
// 取引できる時間（日本時間の朝7時台と日曜は休み、土曜は朝6時まで、月曜は朝8時から）
export const jstOpen = t => { const j = new Date(t + 9 * 3600e3), wd = j.getUTCDay(), h = j.getUTCHours(); if (h === 7 || wd === 0) return false; if (wd === 6) return h < 6; if (wd === 1) return h >= 8; return true; };

export function newScalp(capital, now) {
  return { startedAt: now, capital, balance: capital, peak: capital, pos: null, trades: [], dayKey: "", dayPnl: 0, halted: null, lastSlot: 0, log: [] };
}

/* m1：1分足 [時刻, 始, 高, 安, 終]（時刻の順）、price：今の価格、st：設定（fixed・fx・cost・dailyLimit） */
export function scalpStep(sc, m1, now, price, st) {
  const c = { spread: 0.8, slip: 0.1, ...(st.cost || {}) }, h = c.spread / 2, fx = st.fx || 155;
  const f = st.fixed && st.fixed.qty ? st.fixed : { qty: 15, loss: 50000 };
  const daily = st.dailyLimit || 150000, stopAmt = Math.min(daily * 2, sc.capital * 0.2);
  const events = [];
  const close = (px, why, t1) => {
    const p = sc.pos, net = Math.round((px - p.entry) * p.dir * p.qty * fx);
    const tr = { t: p.t, t1, dir: p.dir, qty: p.qty, entry: p.entry, exit: +px.toFixed(2), sl: p.sl, tp: p.tp, why, net, pips: Math.round((px - p.entry) * p.dir / 0.1) };
    sc.trades.push(tr); sc.pos = null; sc.balance += net;
    const dk = dayKey(t1); if (sc.dayKey !== dk) { sc.dayKey = dk; sc.dayPnl = 0; } sc.dayPnl += net;
    sc.peak = Math.max(sc.peak, sc.balance);
    if (!sc.halted && sc.peak - sc.balance >= stopAmt) sc.halted = { t: t1, text: `最高値から${Math.round(stopAmt / 1e4)}万円減ったので停止` };
    events.push({ kind: "close", tr });
  };
  // 1) 保有中なら、入った後の1分足で損切り・利確・時間切れを確かめる（同じ足で両方なら損切りとみなす）
  if (sc.pos) {
    const p = sc.pos;
    for (const b of m1) {
      if (b[0] < p.barFrom || b[0] + 60e3 > now) continue;   // 入った後の、確定した足だけ
      const lo = b[3] + (p.dir === 1 ? -h : h), hi = b[2] + (p.dir === 1 ? -h : h);
      if (p.dir === 1 ? lo <= p.sl : hi >= p.sl) { close(p.sl - p.dir * c.slip, "損切り", b[0] + 60e3); break; }
      if (p.dir === 1 ? hi >= p.tp : lo <= p.tp) { close(p.tp, "利確", b[0] + 60e3); break; }
      if (b[0] + 60e3 - p.t >= HOLD) { close(b[4] - p.dir * h, "時間切れ", b[0] + 60e3); break; }
    }
    // 1分足が届いていなくても、時間が過ぎていたら今の価格で決済
    if (sc.pos && now - sc.pos.t >= HOLD + 30 * 60e3 && Number.isFinite(price)) close(price - sc.pos.dir * h, "時間切れ", now);
  }
  // 2) 30分の区切りごとに1回、持っていなければ入る
  const slot = Math.floor(now / 1800e3) * 1800e3;
  if (!sc.pos && slot !== sc.lastSlot && jstOpen(now) && Number.isFinite(price)) {
    sc.lastSlot = slot;
    // 向き：直前の、確定した30分（1分足から作る）が上がったか下がったか
    const prev = m1.filter(b => b[0] >= slot - 1800e3 && b[0] < slot);
    const dp = sc.dayKey === dayKey(now) ? sc.dayPnl : 0;
    const stop = Math.max(1, f.loss / (f.qty * fx) - c.slip), risk = (stop + c.slip) * f.qty * fx;
    const maxQty = Math.floor(sc.balance * 0.5 * 20 / (price * fx) * 10) / 10;
    const why = prev.length < 10 ? "直前の30分の値動きが足りない" : sc.halted ? "停止中" : dp - risk < -daily ? "今日の損失上限" : f.qty > maxQty ? "証拠金が足りない" : null;
    if (why) events.push({ kind: "skip", why, slot });
    else {
      const dir = prev[prev.length - 1][4] > prev[0][1] ? 1 : -1, entry = price + dir * h;
      sc.pos = { t: now, barFrom: Math.floor(now / 60e3) * 60e3 + 60e3, dir, qty: f.qty, entry: +entry.toFixed(2), sl: +(entry - dir * stop).toFixed(2), tp: +(entry + dir * stop * RR).toFixed(2), risk: Math.round(risk) };
      events.push({ kind: "open", pos: sc.pos });
    }
  }
  if (sc.trades.length > 500) sc.trades = sc.trades.slice(-500);
  for (const e of events) sc.log.push({ at: now, ...e });
  if (sc.log.length > 100) sc.log = sc.log.slice(-100);
  return events;
}
