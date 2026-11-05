// 30分ごとの練習の取引（スキャルピング。仮想のお金だけ。実際の注文はしない。GMOクリック証券にも接続しない）
// 見張り役が毎時3分と33分にこれを呼ぶ。持っていなければ入る。1分足の高値・安値で、損切り・利確に届いたかを確かめる
// 向き＝直前の30分が上がったら買い・下がったら売り（research/scalp30.mjs）、最初の損切り＝数量固定の金額（15枚で5万円）、最長4時間
// 決済は臨機応変に（2026/11/5、research/scalpExit.mjs・scalpTrail.mjs）：利確は決めず、10ドル伸びたら
//   「いちばん伸びたところから18ドル戻したら決済」に損切りを動かしていく（14〜20ドル戻し×8〜15ドル伸びての広い範囲でプラス）
// 注意：1分足は4か月分だけで、全部を見てから選んだ。スプレッド1.2ドルではほぼ0。節目（支持線・抵抗線）で決める方法は後半でマイナスだった
// 節目（支持線・抵抗線）：進む方向の12ドル以内に、4時間足の山（売りなら谷）があれば見送り（research/scalpSR.mjs〜scalpSR3.mjs、
//   10〜15ドル×12〜36時間のどれでも、スプレッド1.2ドルでも土台より良かった。土台＋130万→＋209万、1.2ドルでは＋57万→＋121万）
const DAY = 86400e3, HOLD = 4 * 3600e3, TRAIL = 18, TRAIL_FROM = 10, SR_NEAR = 12, SR_LOOK = 24 * 3600e3;
// 4時間足の山と谷（前後2本より高い・低い）。確定した時刻が now より前で、直近24時間のもの
export function pivots4h(m1, now) {
  const ms = 4 * 3600e3, B = [];
  for (const r of m1) { const k = Math.floor(r[0] / ms) * ms, L = B[B.length - 1]; if (!L || L[0] !== k) B.push([k, r[1], r[2], r[3], r[4]]); else { L[2] = Math.max(L[2], r[2]); L[3] = Math.min(L[3], r[3]); L[4] = r[4]; } }
  const hi = [], lo = [];
  for (let i = 2; i < B.length - 2; i++) {
    const ct = B[i + 2][0] + ms; if (ct > now || ct < now - SR_LOOK) continue;
    if (B[i][2] > B[i - 1][2] && B[i][2] > B[i - 2][2] && B[i][2] > B[i + 1][2] && B[i][2] > B[i + 2][2]) hi.push(B[i][2]);
    if (B[i][3] < B[i - 1][3] && B[i][3] < B[i - 2][3] && B[i][3] < B[i + 1][3] && B[i][3] < B[i + 2][3]) lo.push(B[i][3]);
  }
  return { hi, lo };
}
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
      if (b[0] <= (p.seen || 0)) continue;   // 前の回で確かめた足は飛ばす
      p.seen = b[0];
      const lo = b[3] + (p.dir === 1 ? -h : h), hi = b[2] + (p.dir === 1 ? -h : h);
      if (p.dir === 1 ? lo <= p.sl : hi >= p.sl) { close(p.sl - p.dir * c.slip, (p.sl - p.entry) * p.dir > 0 ? "伸びたあと戻したので決済" : "損切り", b[0] + 60e3); break; }
      if (p.tp && (p.dir === 1 ? hi >= p.tp : lo <= p.tp)) { close(p.tp, "利確", b[0] + 60e3); break; }
      // 伸びたら、いちばん伸びたところから決まった幅だけ戻した位置へ損切りを動かす（戻す方向には動かさない）
      p.best = p.best == null ? p.entry : p.dir === 1 ? Math.max(p.best, hi) : Math.min(p.best, lo);
      if ((p.best - p.entry) * p.dir >= TRAIL_FROM) { const ns = +(p.best - p.dir * TRAIL).toFixed(2); if ((ns - p.sl) * p.dir > 0) p.sl = ns; }
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
      const o = prev[0][1], cl = prev[prev.length - 1][4], dir = cl > o ? 1 : -1, entry = price + dir * h;
      const pv = pivots4h(m1, now), ahead = (dir === 1 ? pv.hi : pv.lo).filter(v => (v - entry) * dir > 0).sort((a, b) => Math.abs(a - entry) - Math.abs(b - entry))[0];
      if (ahead !== undefined && Math.abs(ahead - entry) < SR_NEAR) {
        events.push({ kind: "skip", why: `${dir === 1 ? "買い" : "売り"}の向きだが、すぐ先（${Math.abs(ahead - entry).toFixed(1)}ドル先の${ahead.toFixed(2)}）に${dir === 1 ? "上値の節目" : "下値の節目"}があるので見送り`, slot });
      } else {
      const hm = t => { const j = new Date(t + 9 * 3600e3); return j.getUTCHours() + ":" + String(j.getUTCMinutes()).padStart(2, "0"); };
      const basis = [
        `直前の30分（${hm(slot - 1800e3)}〜${hm(slot)}）は ${o.toFixed(2)} → ${cl.toFixed(2)} と${(Math.abs(cl - o)).toFixed(2)}ドル${dir === 1 ? "上がった" : "下がった"}ので${dir === 1 ? "買い" : "売り"}`,
        `損切り：入る${dir === 1 ? "−" : "＋"}${stop.toFixed(2)}ドル（${f.qty}枚で${Math.round(f.loss / 1e4)}万円）`,
        `利確は決めない：${TRAIL_FROM}ドル伸びたら、いちばん伸びたところから${TRAIL}ドル戻した所で決済（損切りの位置を追いかけて動かす）`,
        `4時間たったら、その時の価格で決済`,
        ahead === undefined ? `進む方向の近くに節目（ここ1日の4時間足の${dir === 1 ? "山" : "谷"}）がない` : `進む方向で一番近い節目は ${ahead.toFixed(2)}（${Math.abs(ahead - entry).toFixed(1)}ドル先）。${SR_NEAR}ドルより遠いので入った`,
      ];
      sc.pos = { t: now, barFrom: Math.floor(now / 60e3) * 60e3 + 60e3, dir, qty: f.qty, entry: +entry.toFixed(2), sl: +(entry - dir * stop).toFixed(2), tp: null, best: +entry.toFixed(2), sl0: +(entry - dir * stop).toFixed(2), trail: TRAIL, trailFrom: TRAIL_FROM, risk: Math.round(risk), basis };
      events.push({ kind: "open", pos: sc.pos });
      }
    }
  }
  if (sc.trades.length > 500) sc.trades = sc.trades.slice(-500);
  for (const e of events) sc.log.push({ at: now, ...e });
  if (sc.log.length > 100) sc.log = sc.log.slice(-100);
  return events;
}
