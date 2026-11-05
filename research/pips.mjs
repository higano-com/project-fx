// 金額を考えず、ピプス（1ピプス＝0.1ドル）だけで今のルールの成績を見る
// ・スプレッドと損切りのずれは入っている（入る価格・出る価格に含む）。持ち越し費用は入れない
import { loadCsv, prepare, STRATEGIES } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { rolling } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const S = compose(STRATEGIES.ichimoku, { bigBar: 0.6 }, ["minStop", "daily"]);
const P = u => Math.round(u / 0.1);   // ドル → ピプス
const f = v => (v >= 0 ? "＋" : "−") + Math.abs(Math.round(v)).toLocaleString("ja-JP");
const runs = [0, 7, 14, 21].map(o => rolling(B, S, o));
console.log("今のルール。1ピプス＝0.1ドル。スプレッド0.8ドル（8ピプス）と損切りのずれを含む\n");
runs.forEach((tr, k) => {
  const pips = tr.map(t => P(t.usd)), win = pips.filter(v => v > 0), loss = pips.filter(v => v <= 0);
  let eq = 0, pk = 0, dd = 0; for (const v of pips) { eq += v; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  console.log(`■ 見直しの日${[0, 7, 14, 21][k]}日ずらし：合計 ${f(eq)}ピプス（${tr.length}回・勝率${Math.round(win.length / tr.length * 100)}％）`);
  console.log(`   1回の平均 ${f(eq / tr.length)}／勝ちの平均 ${f(win.reduce((a, b) => a + b, 0) / win.length)}／負けの平均 ${f(loss.reduce((a, b) => a + b, 0) / loss.length)}／一番の落ち込み ${f(-dd)}ピプス`);
  const yr = {}; for (const t of tr) { const y = new Date(t.t).getUTCFullYear(); (yr[y] ||= []).push(P(t.usd)); }
  console.log(`   年ごと：${Object.entries(yr).map(([y, a]) => `${y}年 ${f(a.reduce((p, q) => p + q, 0))}（${a.length}回）`).join(" ／ ")}`);
});
const tr = runs[0], mo = {};
for (const t of tr) { const k = new Date(t.t).toISOString().slice(0, 7); (mo[k] ||= []).push(P(t.usd)); }
const ms = Object.entries(mo).filter(([k]) => k >= "2025-11");
console.log(`\n■ 直近1年の月ごと（0日ずらし）：${ms.map(([k, a]) => `${k.slice(2)} ${f(a.reduce((p, q) => p + q, 0))}`).join(" ／ ")}`);
