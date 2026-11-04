// 経済指標の発表日と、金利・ドルの強さのデータを集める（GitHub Actions で実行）
// ・公開されている無料のデータを読むだけ。保存先は非公開リポジトリの中だけ
import { writeFileSync, mkdirSync } from "node:fs";
const UA = { "user-agent": "Mozilla/5.0 (compatible; personal-research-script)" };
mkdirSync("data/raw", { recursive: true });
const log = [];
async function get(url, file) {
  try {
    const r = await fetch(url, { headers: UA });
    const t = await r.text();
    writeFileSync(file, t);
    log.push(`${r.status} ${t.length}文字 ${url}`);
  } catch (e) { log.push(`失敗 ${url} ${e.message}`); }
}
// 米セントルイス連銀（FRED）：10年国債利回り、実質金利（10年）、ドルの強さ（広い範囲）、市場の不安の大きさ
for (const id of ["DGS10", "DFII10", "DTWEXBGS", "VIXCLS"]) await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, `data/macro_${id}.csv`);
// 米連邦準備制度：金利を決める会合の日程
await get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", "data/raw/fomc_current.html");
for (const y of [2020, 2021, 2022, 2023]) await get(`https://www.federalreserve.gov/monetarypolicy/fomchistorical${y}.htm`, `data/raw/fomc_${y}.html`);
// 米労働統計局：雇用統計・物価の発表日
await get("https://www.bls.gov/bls/news-release/empsit.htm", "data/raw/bls_empsit.html");
await get("https://www.bls.gov/bls/news-release/cpi.htm", "data/raw/bls_cpi.html");
await get("https://www.bls.gov/schedule/news_release/empsit.htm", "data/raw/bls_sched_empsit.html");
await get("https://www.bls.gov/schedule/news_release/cpi.htm", "data/raw/bls_sched_cpi.html");
writeFileSync("data/raw/fetch-log.txt", log.join("\n") + "\n");
console.log(log.join("\n"));
