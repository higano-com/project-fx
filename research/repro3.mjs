import { app, sandbox, loadCsv } from "./harness.mjs";
const x = loadCsv("data/xau_usd_1h.csv"), j = loadCsv("data/usd_jpy_1h.csv");
sandbox.fetch = async (url) => { const sym = decodeURIComponent(url.split("symbol=")[1]); const v = sym==="XAU/USD"?x.slice(-5000):sym==="USD/JPY"?j.slice(-5000):null; return { ok:!!v, json: async()=> v?{values:v}:{error:"upstream",code:404,message:"plan"} }; };
await app.loadLive(); app.MODE="live"; app.initState();
for (const risk of [2500, 100000]) {
  const cfg = JSON.parse(JSON.stringify(app.S.cfg)); cfg.riskPerTrade = risk;
  const r = app.runValidation(cfg);
  console.log("1回の許容損失", risk, "| 選んだ設定", JSON.stringify(r.robust.p), "調整", r.robust.tune.n, Math.round(r.robust.tune.net), "確認", r.robust.conf.n, Math.round(r.robust.conf.net), "| 検証前", r.cur.tune.n, Math.round(r.cur.tune.net), r.cur.conf.n, Math.round(r.cur.conf.net));
}
