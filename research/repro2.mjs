// ブラウザと同じ道筋（中継役→buildLive→runValidation）で再現する
import { app, sandbox, loadCsv } from "./harness.mjs";
const x = loadCsv("data/xau_usd_1h.csv"), j = loadCsv("data/usd_jpy_1h.csv");
const last = a => a.slice(-5000);
sandbox.fetch = async (url) => {
  const sym = decodeURIComponent(url.split("symbol=")[1]);
  const v = sym === "XAU/USD" ? last(x) : sym === "USD/JPY" ? last(j) : null;
  return { ok: !!v, json: async () => v ? { values: v } : { error: "upstream", code: 404, message: "This symbol is available starting with the Grow plan" } };
};
sandbox.Date = class extends Date { static now() { return Date.UTC(2026,10,4,18,30); } };
await app.loadLive(); app.MODE = "live"; app.initState();
const S = app.S; console.log("bars", app.TOTAL, "spread", S.cfg.cost.gold.spread);
const r = app.runValidation(S.cfg);
for (const k of ["robust","best","cur"]) console.log(k, JSON.stringify(r[k].p), "調整", r[k].tune.n, Math.round(r[k].tune.net), "確認", r[k].conf.n, Math.round(r[k].conf.net), "最大落込(確認)", Math.round(r[k].conf.mdd));
