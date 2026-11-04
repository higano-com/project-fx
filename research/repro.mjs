// 画面で出た「＋235万円」を再現する：古い版のアプリ（取引時間判定なし・スプレッド0.4）＋本物のドル円
import { readFileSync, writeFileSync } from "node:fs";
const mod = await import("./harness.mjs");
const { app, loadCsv, setData } = mod;
const x = loadCsv("data/xau_usd_1h.csv"), j = loadCsv("data/usd_jpy_1h.csv");
const d = t => new Date(t).toISOString().slice(0,16);
const n = setData(x, j, x.length - 5000, x.length);
const cfg = app.S.cfg;
const r = app.backtest(cfg.params, cfg, app.WARMUP, n);
const tr = r.acct.trades;
console.log(process.env.APP_HTML||"new", "spread", cfg.cost.gold.spread, "回数", tr.length, "純損益", Math.round(r.st.net));
console.table([...tr].sort((a,b)=>Math.abs(b.net)-Math.abs(a.net)).slice(0,5).map(t=>({entryT:d(t.t), exitT:d(t.exitT), why:t.why, qty:t.qty, entry:t.entry.toFixed(2), exit:t.exit.toFixed(2), net:Math.round(t.net)})));
const fx = app.DATA.fx; let mn=1e9,mx=0; for (const v of fx){mn=Math.min(mn,v);mx=Math.max(mx,v);} console.log("ドル円の範囲", mn, mx);
