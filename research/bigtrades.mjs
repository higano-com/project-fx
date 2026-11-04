import { app, loadCsv, setData } from "./harness.mjs";
const x = loadCsv("data/xau_usd_1h.csv");
const jpy = [[0,0,0,0,152]];
const d = t => new Date(t).toISOString().slice(0,16);
// アプリと同じ：最近の5000本
const n = setData(x, jpy, x.length - 5000, x.length);
const cfg = app.S.cfg;
for (const label of ["今の設定（取引時間の判定あり）"]) {
  const r = app.backtest(cfg.params, cfg, app.WARMUP, n);
  const tr = r.acct.trades;
  console.log(label, "回数", tr.length, "純損益", Math.round(r.st.net));
  const big = [...tr].sort((a,b)=>Math.abs(b.net)-Math.abs(a.net)).slice(0,8);
  console.table(big.map(t=>({entryT:d(t.t), exitT:d(t.exitT), why:t.why, dir:t.dir, qty:t.qty, entry:t.entry.toFixed(2), sl:t.sl.toFixed(2), tp:t.tp.toFixed(2), exit:t.exit.toFixed(2), net:Math.round(t.net)})));
}
// 土日の足の様子
const wk = x.filter(r=>{const w=new Date(r[0]).getUTCDay(); return (w===6) && r[0]>Date.UTC(2025,0,1);});
console.log("2025年以降の土曜の足", wk.length, "例", wk.slice(0,3).map(r=>[d(r[0]),...r.slice(1).map(v=>v.toFixed(2))]));
