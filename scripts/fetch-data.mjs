// 検証用の価格データを Twelve Data から取得して data/ に保存する（GitHub Actions で実行）
// ・価格を読むだけ。注文に関わる処理はありません
// ・保存先は非公開リポジトリの中だけ（個人利用。外部に公開・配布しない）
// ・無料プランの制限（1分8回）を守るため、1回ごとに9秒待つ
import { writeFileSync, mkdirSync } from "node:fs";

const KEY = String(process.env.TWELVEDATA_API_KEY || "").replace(/[^A-Za-z0-9]/g, "");
if (!KEY) {
  console.log("TWELVEDATA_API_KEY が GitHub の Secrets に設定されていないため、取得をスキップしました。");
  process.exit(0);
}
const SYMBOLS = [
  { symbol: "XAU/USD", file: "xau_usd_1h.csv" },
  { symbol: "USD/JPY", file: "usd_jpy_1h.csv" },
];
const MAX_PAGES = 10;            // 1回5000本 × 最大10回（1時間足で約7年分まで）
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = t => new Date(t).toISOString().slice(0, 16).replace("T", " ");

mkdirSync("data", { recursive: true });
const summary = {};
for (const { symbol, file } of SYMBOLS) {
  const rows = new Map();
  let end = null, note = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = "https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(symbol) +
      "&interval=1h&outputsize=5000&timezone=UTC&order=desc" + (end ? "&end_date=" + encodeURIComponent(end) : "") +
      "&apikey=" + KEY;
    let j = null;
    for (let tryNo = 0; tryNo < 4; tryNo++) {   // 「1分あたりの回数」を超えたら1分待って取り直す
      const res = await fetch(url);
      j = await res.json().catch(() => null);
      await sleep(9000);
      if (j && j.code === 429) { console.log("回数の制限に当たったので65秒待ちます"); await sleep(65000); continue; }
      break;
    }
    if (!j || j.status !== "ok" || !Array.isArray(j.values) || !j.values.length) {
      note = j && j.message ? String(j.message).split(KEY).join("***").slice(0, 200) : "no data";
      break;
    }
    let oldest = Infinity;
    for (const v of j.values) {
      const t = Date.parse(v.datetime.replace(" ", "T") + "Z");
      const o = +v.open, h = +v.high, l = +v.low, c = +v.close;
      if (![t, o, h, l, c].every(Number.isFinite)) continue;
      rows.set(t, [t, o, h, l, c]);
      oldest = Math.min(oldest, t);
    }
    console.log(`${symbol}: ${page + 1}回目 ${j.values.length}本（${fmt(oldest)} まで）`);
    if (j.values.length < 5000) { note = "これより前のデータはありません"; break; }
    end = fmt(oldest - 3600e3) + ":00";
  }
  const list = [...rows.values()].sort((a, b) => a[0] - b[0]);
  const csv = "time_utc,open,high,low,close\n" + list.map(r => [fmt(r[0]), ...r.slice(1)].join(",")).join("\n") + "\n";
  writeFileSync("data/" + file, csv);
  summary[symbol] = { bars: list.length, from: list.length ? fmt(list[0][0]) : null, to: list.length ? fmt(list[list.length - 1][0]) : null, note };
}
writeFileSync("data/summary.json", JSON.stringify({ fetchedAt: new Date().toISOString(), source: "Twelve Data (1h, UTC)", ...summary }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
