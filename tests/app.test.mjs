// アプリの動作テスト（何度でも実行できる）
// 使い方：sh scripts/build.sh && node tests/app.test.mjs
import { createRequire } from "node:module";
import { startMock } from "./mock-server.mjs";
import { writeFileSync, readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const results = []; let failed = 0;
const check = (name, ok, detail = "") => { results.push(`${ok ? "○" : "×"} ${name}${detail ? "（" + detail + "）" : ""}`); if (!ok) failed++; };
const srv = await startMock(8790, "dist");
const browser = await chromium.launch();
const errors = [];
const page = async (url) => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); p.on("pageerror", e => errors.push(e.message)); await p.goto(url); return p; };
const visibleText = p => p.evaluate(() => document.body.innerText);
// 画面に出てよい英字（GMO）以外の英単語を探す
const englishWords = t => (t.match(/[A-Za-z]{3,}/g) || []).filter(w => !["GMO"].includes(w));
const num = s => parseFloat(String(s).replace(/[^\d.\-−]/g, "").replace("−", "-"));

// 1. 本物のデータの画面
const p = await page("http://localhost:8790/");
await p.waitForSelector(".ticket", { timeout: 30000 }); await p.waitForTimeout(500);
check("本物の価格で開く", (await p.textContent("#mode-badge")).includes("本物"));
check("タブは3つ（判断・成績・設定）", (await p.$$eval("nav.tabs button", b => b.map(x => x.textContent.trim()).join("・"))) === "判断・成績・設定");
const sell = num(await p.textContent(".q.sell .v")), buy = num(await p.textContent(".q.buy .v"));
check("買値−売値＝スプレッド0.80", Math.abs(buy - sell - 0.8) < 0.011, `${buy}−${sell}`);
check("判断の点は10個", (await p.$$(".ticket .dots i")).length === 10);
let words = englishWords(await visibleText(p)); check("判断の画面に英語がない", words.length === 0, words.slice(0, 5).join(","));

// 2. 約2分ごとの価格の更新
await p.evaluate(() => refreshPrice()); await p.waitForTimeout(300);
const after = num(await p.textContent(".q.buy .v"));
check("今の価格が更新される", after !== buy, `${buy}→${after}`);

// 3. 条件がそろったときの表示（判断が出る足に移し、安全の確認を通した状態で表示）
const shown = await p.evaluate(() => {
  for (let i = TOTAL - 1; i > TOTAL - 1500; i--) if (signalAt("gold", i, curParams(S.cfg), S.cfg, false).side !== "wait") { S.nowIdx = i; LIVE.gold = { price: DATA.gold.c[i], t: Date.now() }; return true; }
  return false;
});
if (shown) {
  await p.evaluate(() => { const orig = currentDecision; window.__orig = orig; currentDecision = sym => { const d = orig(sym); d.safety.forEach(x => x.ok = true); d.blocks = []; d.verdict = d.sig.side; return d; }; render(); });
  await p.waitForTimeout(200);
  const vals = await p.$$eval(".ticket .trow .v", e => e.map(x => parseFloat(x.textContent.replace(/,/g, ""))));
  const act = (await p.textContent(".ticket .act")).trim(), isBuy = act.startsWith("買い");
  check("判断が出ると、入る・損切り・利確・数量が出る", vals.length === 4 && vals.every(v => isFinite(v)), act.slice(0, 2));
  check("損切りと利確の向きが正しい", isBuy ? (vals[1] < vals[0] && vals[2] > vals[0]) : (vals[1] > vals[0] && vals[2] < vals[0]));
  check("損切り・利確に「入る±○ドル」が出る", (await p.$$(".ticket .dist")).length === 2);
  const lossYen = num(await p.textContent(".ticket .trow:nth-child(2) .down"));
  check("損切りの損失は1回の許容損失（2,500円）以内", Math.abs(lossYen) <= 2500, Math.abs(lossYen) + "円");
  await p.evaluate(() => { currentDecision = window.__orig; render(); });
} else check("条件がそろう足が見つかる", false);

// 4. 試算
await p.click("#detail-box summary"); await p.waitForTimeout(100);
await p.click('[data-simdir="1"]'); await p.waitForTimeout(100);
await p.fill("#sim-qty", "1"); await p.fill("#sim-entry", "4000"); await p.fill("#sim-target", "4010");
const simYen = num(await p.textContent("#sim-out .big2")), fx = await p.evaluate(() => fxNow());
check("試算：買い1オンスで10ドル上がると、10×ドル円の利益", Math.abs(simYen - 10 * fx) < 2, `${simYen}円`);

// 5. 成績：目標と取引できる日
await p.click('[data-tab="stats"]'); await p.waitForTimeout(200);
const days = await p.evaluate(() => tradingDays(Date.parse("2026-11-05T03:44:00+09:00"), Date.parse("2026-12-31T23:59:59+09:00")));
check("11/5〜12/31の取引できる日は40日", days === 40, days + "日");
words = englishWords(await visibleText(p)); check("成績の画面に英語がない", words.length === 0, words.slice(0, 5).join(","));

// 6. 設定：資金を変えると、アプリが決める値も変わる
await p.click('[data-tab="cfg"]'); await p.waitForTimeout(200);
await p.fill("#f-capital", "2000000"); await p.dispatchEvent("#f-capital", "change"); await p.waitForTimeout(200);
const risk = await p.evaluate(() => [S.cfg.riskPerTrade, S.cfg.dailyLimit]);
check("資金200万円なら1回5,000円・1日2万円", risk[0] === 5000 && risk[1] === 20000, risk.join("・"));
words = englishWords(await visibleText(p)); check("設定の画面に英語がない", words.length === 0, words.slice(0, 5).join(","));
await p.fill("#f-capital", "1000000"); await p.dispatchEvent("#f-capital", "change"); await p.waitForTimeout(100);

// 7. 銀は無料プランでは取れない → 理由を出す
await p.click('[data-tab="signal"]'); await p.waitForTimeout(100); await p.click('[data-sym="silver"]'); await p.waitForTimeout(200);
check("銀は理由を表示する", (await visibleText(p)).includes("無料プランでは受け取れません"));

// 8. サンプル（中継役がないとき）
const html = readFileSync("app/index.html", "utf8");
writeFileSync("dist/sample.html", `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`);
const q = await page("http://localhost:8790/sample.html");
await q.waitForSelector(".ticket"); await q.waitForTimeout(300);
check("中継役がないときはサンプルで開く", (await q.textContent("#mode-badge")).includes("サンプル"));
const t0 = await q.textContent(".qsub"); await q.click('[data-act="adv"][data-n="24"]'); await q.waitForTimeout(200);
check("サンプルで時間を進められる", (await q.textContent(".qsub")) !== t0);
check("画面のエラーがない", errors.length === 0, errors.slice(0, 2).join(" ／ "));

await browser.close(); srv.close();
console.log(results.join("\n"));
console.log(failed ? `\n${failed}件の失敗があります` : `\nすべて合格（${results.length}件）`);
process.exit(failed ? 1 : 0);
