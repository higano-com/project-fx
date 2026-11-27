// 銀の足のデータを data/silver/ に保存するだけ（クロードの定期分析用）。注文・口座接続はしない
// 足：ヤフーファイナンスの銀先物（SI=F）。今の現物の値段：スイスクオート
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("data/silver", { recursive: true });
const H = { headers: { "user-agent": "Mozilla/5.0" } };
const jst = t => new Date(t * 1000 + 9 * 36e5).toISOString().slice(0, 16).replace("T", " ");
// SI=F の分足が止まっているとき（祝日・限月の切りかえ）は、限月を直接指定したものから新しい方を使う
const SYMS = ["SI=F", "SIZ26.CMX", "SIF27.CMX", "SIH27.CMX"];
const get = async (sym, iv, range) => {
  const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&range=${range}`, H)).json();
  const r = j.chart.result[0], q = r.indicators.quote[0];
  return r.timestamp.map((t, i) => [t, q.open[i], q.high[i], q.low[i], q.close[i]]).filter(v => v.slice(1).every(x => x != null));
};
let pick = "SI=F";
try {
  let best = -1;
  for (const s of SYMS) {
    try { const r = await get(s, "1m", "1d"); const last = r.length ? r[r.length - 1][0] : 0; console.log("候補", s, r.length, "本", last ? jst(last) : "-"); if (last > best + 600) { best = last; pick = s; } } catch (e) { console.log("候補", s, "失敗"); }
  }
} catch (e) {}
console.log("使う銘柄", pick);
for (const [iv, range, name] of [["1m", "1d", "1min"], ["5m", "5d", "5min"], ["60m", "60d", "1h"], ["1d", "1y", "1day"]]) {
  try {
    const rows = (await get(iv === "1d" ? "SI=F" : pick, iv, range)).map(v => [jst(v[0]), ...v.slice(1)]);
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
