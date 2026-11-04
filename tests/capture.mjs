// 使いやすさの確認用に、いろいろな状態の画面写真を撮る
// 使い方：sh scripts/build.sh && node tests/capture.mjs 出力先フォルダ
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { startMock } from "./mock-server.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const out = process.argv[2] || "shots"; mkdirSync(out, { recursive: true });
const srv = await startMock(8795, "dist");
const browser = await chromium.launch();
const list = [];
async function shoot(name, w, h, fn) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); await p.goto("http://localhost:8795/"); await p.waitForSelector(".ticket", { timeout: 30000 }); await p.waitForTimeout(500);
  if (fn) await fn(p);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true }); list.push(`${name}.png`); await ctx.close();
}
const signal = async p => {
  await p.evaluate(() => {
    for (let i = TOTAL - 1; i > TOTAL - 1500; i--) if (signalAt("gold", i, curParams(S.cfg), S.cfg, false).side !== "wait") { S.nowIdx = i; LIVE.gold = { price: DATA.gold.c[i], t: Date.now() }; break; }
    const orig = currentDecision; currentDecision = sym => { const d = orig(sym); d.safety.forEach(x => x.ok = true); d.blocks = []; d.verdict = d.sig.side; return d; }; render();
  });
};
await shoot("01_判断_待ち", 390, 844);
await shoot("02_判断_判断が出たとき", 390, 844, signal);
await shoot("03_判断_くわしくを開いた", 390, 844, async p => { await p.click("#detail-box summary"); });
await shoot("04_判断_チャート1日", 390, 844, async p => { await p.click('[data-act="range"][data-n="24"]'); });
await shoot("05_成績", 390, 844, async p => { await p.click('[data-tab="stats"]'); });
await shoot("06_成績_練習の記録あり", 390, 844, async p => { await signal(p); await p.click("[data-act=open]"); await p.evaluate(() => { const pos = S.acct.positions[0]; if (pos) { closePos(S.acct, S.cfg, pos, pos.tp, Date.now(), "利確", fxNow()); save(); } }); await p.click('[data-tab="stats"]'); });
await shoot("07_設定", 390, 844, async p => { await p.click('[data-tab="cfg"]'); });
await shoot("08_銀", 390, 844, async p => { await p.click('[data-sym="silver"]'); });
await shoot("09_小さいiPhone_判断が出たとき", 375, 667, signal);
await shoot("10_大きいiPhone_判断が出たとき", 430, 932, signal);
await browser.close(); srv.close();
console.log(list.join("\n"));
