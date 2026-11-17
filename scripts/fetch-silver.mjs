// 銀・ドル円の足のデータを data/silver/ に保存するだけ（クロードの定期分析用）。注文・口座接続はしない
import { writeFileSync, mkdirSync } from "node:fs";
const key = String(process.env.TWELVEDATA_API_KEY || "").replace(/[^A-Za-z0-9]/g, "");
if (!key) { console.error("キーがありません"); process.exit(1); }
mkdirSync("data/silver", { recursive: true });
const jobs = [["XAG/USD", "1min", 500], ["XAG/USD", "5min", 500], ["XAG/USD", "1h", 500], ["XAG/USD", "4h", 300], ["XAG/USD", "1day", 300], ["USD/JPY", "1h", 50]];
for (const [sym, iv, n] of jobs) {
  const r = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${iv}&outputsize=${n}&timezone=Asia/Tokyo&order=asc&apikey=${key}`);
  const d = await r.json();
  if (d.status !== "ok") { console.error(sym, iv, "失敗", d.code); continue; }
  const csv = "datetime,open,high,low,close\n" + d.values.map(v => [v.datetime, v.open, v.high, v.low, v.close].join(",")).join("\n");
  writeFileSync(`data/silver/${sym.replace("/", "")}_${iv}.csv`, csv);
  console.log(sym, iv, d.values.length, "本");
  await new Promise(s => setTimeout(s, 8000)); // 1分8回の制限を守る
}
writeFileSync("data/silver/fetched_at.txt", new Date().toISOString() + "\n");
