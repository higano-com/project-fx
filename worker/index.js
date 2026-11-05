// 24時間の見張り役（クラウドフレアのワーカー）
// ・毎時、金の判断をして、「買い」か「売り」が出たら、登録したiPhoneに通知を送る
// ・価格を読むだけ。注文や口座への接続はしない
// ・登録などの記録は、このワーカー専用の保管場所（Durable Object）に置く
import { sendPush, makeVapidKeys } from "../lib/webpush.js";
import { computeSignal } from "../lib/signal.js";
import { newDemo, demoStep } from "../lib/demo.js";

const SUBJECT = "https://project-fx-24u.pages.dev";
const DEFAULT_STATE = { paramsI: { slMult: 1.5, rr: 2, minStop: 6 }, cost: { spread: 0.8, slip: 0.1, step: 0.1 }, riskPerTrade: 2500 };

export class Store {
  constructor(state) { this.s = state.storage; }
  async fetch(req) {
    const { op, key, val } = await req.json();
    if (op === "get") return Response.json((await this.s.get(key)) ?? null);
    if (op === "put") { await this.s.put(key, val); return Response.json(true); }
    return Response.json(null, { status: 400 });
  }
}
const db = env => {
  const stub = env.STORE.get(env.STORE.idFromName("main"));
  const call = body => stub.fetch("https://store/", { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  return { get: key => call({ op: "get", key }), put: (key, val) => call({ op: "put", key, val }) };
};
async function vapid(env) {
  const d = db(env); let v = await d.get("vapid");
  if (!v) { v = await makeVapidKeys(); await d.put("vapid", v); }
  return v;
}
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });

async function pushAll(env, msg) {
  const d = db(env), v = await vapid(env), subs = (await d.get("subs")) || [];
  const keep = [], results = [];
  for (const s of subs) { const r = await sendPush(s, msg, v, SUBJECT).catch(e => ({ ok: false, status: 0 })); results.push(r.status); if (!r.gone) keep.push(s); }
  if (keep.length !== subs.length) await d.put("subs", keep);
  return results;
}
const fmt = v => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function check(env, force) {
  const key = String(env.TWELVEDATA_API_KEY || "").replace(/[^A-Za-z0-9]/g, "");
  if (!key) { await db(env).put("checked", { at: Date.now(), error: "鍵（TWELVEDATA_API_KEY）が見張り役に設定されていない" }); return { error: "no_key" }; }
  const d = db(env), st = { ...DEFAULT_STATE, ...((await d.get("state")) || {}) };
  const td = async (path) => (await fetch("https://api.twelvedata.com/" + path + "&apikey=" + key)).json();
  const s = await td("time_series?symbol=XAU%2FUSD&interval=1h&outputsize=2000&timezone=UTC&order=asc");
  if (!s || s.status !== "ok") { const message = String((s && s.message) || "").split(key).join("***"); await d.put("checked", { at: Date.now(), error: "価格を受け取れなかった", message }); return { error: "upstream", message }; }
  const bars = s.values.map(v => [Date.parse(v.datetime.replace(" ", "T") + "Z"), +v.open, +v.high, +v.low, +v.close]);
  const fx = await td("price?symbol=USD%2FJPY");
  st.fx = +fx.price || 155;
  const sig = computeSignal(bars, Date.now(), st);
  // 自動の練習の取引（仮想のお金だけ。実際の注文はしない）
  let demo = await d.get("demo"); if (!demo) demo = newDemo(st.capital || 1000000, Date.now());
  const demoEvents = demoStep(demo, bars, Date.now(), sig, st);
  await d.put("demo", demo);
  // アプリと同じ停止の確認（停止中・今日の上限・保有の数がいっぱいなら通知しない）
  if (sig.side !== "wait" && st.stop && (st.stop.halted || st.stop.dayOver || st.stop.full)) { await d.put("checked", { at: Date.now(), side: "wait", reason: "停止の確認", barT: sig.barT }); return { ...sig, side: "wait", reason: "停止の確認" }; }
  const last = (await d.get("last")) || {};
  await d.put("checked", { at: Date.now(), side: sig.side, barT: sig.barT });
  if (sig.side === "wait") return sig;
  if (!force && last.barT === sig.barT && last.side === sig.side) return { ...sig, skipped: true };
  const word = sig.side === "buy" ? "買い" : "売り";
  const sgn = sig.side === "buy" ? ["−", "＋"] : ["＋", "−"];
  // 通知の文字は「シグナル通知」だけ（ほかの人が見ても中身が分からないように）。中身はアプリを開いて見る
  const msg = { title: "シグナル通知", body: "", tag: "signal", url: "/" };
  const sent = await pushAll(env, msg);
  await d.put("last", { barT: sig.barT, side: sig.side, at: Date.now(), msg });
  return { ...sig, sent };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(check(env, false).catch(async e => { await db(env).put("checked", { at: Date.now(), error: "途中で止まった", message: String(e && e.message || e) }); })); },
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const d = db(env);
    if (path === "/vapid") return json({ publicKey: (await vapid(env)).publicKey });
    if (path === "/demo") {   // 自動の練習の記録（読むだけ）
      const demo = await d.get("demo");
      if (!demo) return json({ demo: null });
      return json({ demo: { ...demo, trades: demo.trades.slice(-50), log: demo.log.slice(-20) } });
    }
    if (path === "/run") {   // 手で判断を1回動かす（無料の回数を守るため、5分に1回まで）
      const lr = (await d.get("lastRun")) || 0;
      if (Date.now() - lr < 5 * 60e3) return json({ error: "5分に1回までです", next: new Date(lr + 5 * 60e3).toISOString() }, 429);
      await d.put("lastRun", Date.now());
      try { const r = await check(env, false); return json({ ok: true, result: r, demo: !!(await d.get("demo")) }); }
      catch (e) { await d.put("checked", { at: Date.now(), error: "途中で止まった", message: String(e && e.message || e) }); return json({ error: "途中で止まった", message: String(e && e.message || e) }, 500); }
    }
    if (path === "/status") return json({ checked: await d.get("checked"), last: await d.get("last"), subs: ((await d.get("subs")) || []).length });
    if (req.method !== "POST") return json({ ok: true, name: "金銀シグナルの見張り役" });
    const body = await req.json().catch(() => ({}));
    if (path === "/subscribe") {
      const sub = body.subscription;
      if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ error: "bad_subscription" }, 400);
      const subs = ((await d.get("subs")) || []).filter(s => s.endpoint !== sub.endpoint);
      subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
      await d.put("subs", subs.slice(-5));
      // 設定を受け取るための合言葉（初めて登録したときに作る）
      let token = await d.get("token");
      if (!token) { token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""); await d.put("token", token); }
      return json({ ok: true, count: subs.length, token });
    }
    if (path === "/state") {
      const token = await d.get("token");
      if (!token || body.token !== token) return json({ error: "bad_token" }, 403);
      const p = body.paramsI || {}, c = body.cost || {}, r = +body.riskPerTrade, stop = body.stop || {};
      const okNum = (v, a, b) => Number.isFinite(+v) && +v >= a && +v <= b;
      if (!okNum(p.slMult, 0.5, 5) || !okNum(p.rr, 0.5, 6) || !okNum(p.minStop, 0, 100) || !okNum(c.spread, 0, 20) || !okNum(c.slip, 0, 20) || !okNum(c.step, 0.01, 10) || !okNum(r, 100, 1e7)) return json({ error: "bad_state" }, 400);
      await d.put("state", { paramsI: { slMult: +p.slMult, rr: +p.rr, minStop: +p.minStop }, cost: { spread: +c.spread, slip: +c.slip, step: +c.step }, riskPerTrade: r,
        capital: okNum(body.capital, 10000, 1e10) ? +body.capital : 1000000, dailyLimit: okNum(body.dailyLimit, 100, 1e9) ? +body.dailyLimit : 150000,
        fixed: body.fixed && body.fixed.on && okNum(body.fixed.qty, 0.1, 1000) && okNum(body.fixed.loss, 100, 1e8) && okNum(body.fixed.rr, 0.5, 10) ? { on: true, qty: +body.fixed.qty, loss: +body.fixed.loss, rr: +body.fixed.rr } : { on: false }, stop: { halted: !!stop.halted, dayOver: !!stop.dayOver, full: !!stop.full }, version: +body.version || 0, at: Date.now() });
      return json({ ok: true });
    }
    if (path === "/demo/reset") {   // 自動の練習を最初からやり直す（合言葉が必要）
      const token = await d.get("token");
      if (!token || body.token !== token) return json({ error: "bad_token" }, 403);
      const st = { ...DEFAULT_STATE, ...((await d.get("state")) || {}) };
      await d.put("demo", newDemo(st.capital || 1000000, Date.now()));
      // 数量の決め方が変わったら、自動の練習を最初からやり直す
      const prev = (await d.get("prevFixed")) || null, nowF = JSON.stringify((await d.get("state")).fixed || {});
      if (prev !== null && prev !== nowF) { const st2 = await d.get("state"); await d.put("demo", newDemo(st2.capital || 1000000, Date.now())); }
      await d.put("prevFixed", nowF);
      return json({ ok: true });
    }
    if (path === "/test") {
      const lastTest = (await d.get("lastTest")) || 0;
      if (Date.now() - lastTest < 30e3) return json({ error: "too_soon" }, 429);
      await d.put("lastTest", Date.now());
      return json({ sent: await pushAll(env, { title: "シグナル通知", body: "", tag: "test", url: "/" }) });
    }
    if (path === "/check") return json(await check(env, false));
    return json({ error: "not_found" }, 404);
  },
};
