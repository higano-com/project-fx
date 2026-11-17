// 銀の足のデータを data/silver/ に保存するだけ（クロードの定期分析用）。注文・口座接続はしない
// 足：ヤフーファイナンスの銀先物（SI=F）。今の現物の値段：スイスクオート
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("data/silver", { recursive: true });
const H = { headers: { "user-agent": "Mozilla/5.0" } };
const jst = t => new Date(t * 1000 + 9 * 36e5).toISOString().slice(0, 16).replace("T", " ");
for (const [iv, range, name] of [["1m", "1d", "1min"], ["5m", "5d", "5min"], ["60m", "60d", "1h"], ["1d", "1y", "1day"]]) {
  try {
    const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=${iv}&range=${range}`, H)).json();
    const r = j.chart.result[0], q = r.indicators.quote[0];
    const rows = r.timestamp.map((t, i) => [jst(t), q.open[i], q.high[i], q.low[i], q.close[i]]).filter(v => v.slice(1).every(x => x != null));
    writeFileSync(`data/silver/SI_${name}.csv`, "datetime_jst,open,high,low,close\n" + rows.map(v => v.join(",")).join("\n"));
    console.log("足", name, rows.length, "本");
  } catch (e) { console.log("足", name, "失敗", e.message); }
}
const spot = {};
for (const s of ["XAG/USD", "USD/JPY"]) {
  try { const d = await (await fetch("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/" + s, H)).json(); spot[s] = d[0].spreadProfilePrices[0]; } catch (e) { spot[s] = null; }
}
writeFileSync("data/silver/spot.json", JSON.stringify({ at: new Date().toISOString(), spot }, null, 1));
console.log("現物", JSON.stringify(spot));
