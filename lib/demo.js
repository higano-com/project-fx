// 自動の練習の取引（仮想のお金だけ。実際の注文はしない。GMOクリック証券にも接続しない）
// 見張り役が毎時これを呼ぶ。1時間足の高値・安値で、損切り・利確に届いたかを確かめる（同じ足で両方なら損切りとみなす）
const DAY = 86400e3;
const dayKey = t => new Date(t + 9 * 3600e3 - 7 * 3600e3).toISOString().slice(0, 10);   // GMOの1日（日本時間7時区切り）
function rollovers(t0, t1) { const off = 22 * 3600e3; return Math.max(0, Math.floor((t1 - off) / DAY) - Math.floor((t0 - off) / DAY)); }

export function newDemo(capital, now) {
  return { startedAt: now, capital, balance: capital, peak: capital, pos: null, trades: [], dayKey: "", dayPnl: 0, halted: null, lastSigBar: 0, log: [] };
}

/* bars：[時刻, 始, 高, 安, 終]（最後の1本は確定していない今の足でもよい）、sig：computeSignal の結果、st：設定 */
export function demoStep(demo, bars, now, sig, st) {
  const c = { spread: 0.8, slip: 0.1, step: 0.1, swapLong: 85, swapShort: -83, ...(st.cost || {}) }, h = c.spread / 2, fx = st.fx || 155;
  const daily = st.dailyLimit || 150000, stopAmt = Math.min(daily * 2, demo.capital * 0.2);
  const events = [];
  // 1) 保有中なら、入った後の足で損切り・利確・時間切れを確かめる
  if (demo.pos) {
    const p = demo.pos;
    for (const b of bars) {
      if (b[0] < p.barFrom) continue;
      let px = null, why = null;
      if (p.dir === 1) { const o = b[1] - h, lo = b[3] - h, hi = b[2] - h;
        if (o <= p.sl) { px = o - c.slip; why = "損切り"; } else if (lo <= p.sl) { px = p.sl - c.slip; why = "損切り"; } else if (o >= p.tp) { px = o; why = "利確"; } else if (hi >= p.tp) { px = p.tp; why = "利確"; } }
      else { const o = b[1] + h, lo = b[3] + h, hi = b[2] + h;
        if (o >= p.sl) { px = o + c.slip; why = "損切り"; } else if (hi >= p.sl) { px = p.sl + c.slip; why = "損切り"; } else if (o <= p.tp) { px = o; why = "利確"; } else if (lo <= p.tp) { px = p.tp; why = "利確"; } }
      if (px === null && b[0] + 3600e3 <= now && b[0] - p.barFrom >= 120 * 3600e3) { px = b[4] - p.dir * h; why = "時間切れ"; }
      if (px !== null) {
        const t1 = Math.min(now, b[0] + 3600e3), swap = (p.dir === 1 ? c.swapLong : c.swapShort) * p.qty * rollovers(p.t, t1);
        const net = Math.round((px - p.entry) * p.dir * p.qty * fx - swap);
        const tr = { t: p.t, t1, dir: p.dir, qty: p.qty, entry: p.entry, exit: +px.toFixed(2), sl: p.sl, tp: p.tp, why, net, pips: Math.round((px - p.entry) * p.dir / 0.1) };
        demo.trades.push(tr); demo.pos = null; demo.balance += net;
        const dk = dayKey(t1); if (demo.dayKey !== dk) { demo.dayKey = dk; demo.dayPnl = 0; } demo.dayPnl += net;
        demo.peak = Math.max(demo.peak, demo.balance);
        if (!demo.halted && demo.peak - demo.balance >= stopAmt) demo.halted = { t: t1, text: `最高値から${Math.round(stopAmt / 1e4)}万円減ったので停止` };
        events.push({ kind: "close", tr });
        break;
      }
    }
  }
  // 2) 判断が出ていて、持っていなければ入る（同じ足の判断では1回だけ）
  if (!demo.pos && sig && sig.side !== "wait" && sig.barT && sig.barT !== demo.lastSigBar) {
    demo.lastSigBar = sig.barT;
    const dp = demo.dayKey === dayKey(now) ? demo.dayPnl : 0;
    const price = bars[bars.length - 1][4], maxQty = Math.floor(demo.balance * 0.5 * 20 / (price * fx) / c.step) * c.step;
    let qty = Math.min(sig.qty, maxQty); qty = +qty.toFixed(1);
    const risk = Math.abs(sig.entry - sig.sl + (sig.side === "buy" ? c.slip : -c.slip)) * qty * fx;
    const why = demo.halted ? "停止中" : dp - risk < -daily ? "今日の損失上限" : qty <= 0 ? "数量が決まらない" : null;
    if (why) events.push({ kind: "skip", why, barT: sig.barT });
    else {
      demo.pos = { t: now, barFrom: Math.floor(now / 3600e3) * 3600e3, dir: sig.side === "buy" ? 1 : -1, qty, entry: +sig.entry.toFixed(2), sl: +sig.sl.toFixed(2), tp: +sig.tp.toFixed(2), risk: Math.round(risk) };
      events.push({ kind: "open", pos: demo.pos });
    }
  }
  if (demo.trades.length > 500) demo.trades = demo.trades.slice(-500);
  for (const e of events) demo.log.push({ at: now, ...e });
  if (demo.log.length > 100) demo.log = demo.log.slice(-100);
  return events;
}
