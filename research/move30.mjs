// 「1日に30ドル（300ピプス・1ピプス＝0.1ドルとして）取れる場面」がどのくらいあるか
import { loadCsv, prepare, STRATEGIES } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { rolling } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
// 1) 日本時間の1日（取引日）ごとの値幅（高値−安値）
const days = new Map();
for (let i = 0; i < B.n; i++) { const k = Math.floor((B.t[i] + 9 * 3600e3 - 7 * 3600e3) / 86400e3); const d = days.get(k) || { h: -Infinity, l: Infinity, y: new Date(B.t[i]).getUTCFullYear() }; d.h = Math.max(d.h, B.h[i]); d.l = Math.min(d.l, B.l[i]); days.set(k, d); }
const byY = {};
for (const d of days.values()) { const r = d.h - d.l; const o = (byY[d.y] ||= { n: 0, r30: 0, r60: 0, sum: 0 }); o.n++; o.sum += r; if (r >= 30) o.r30++; if (r >= 60) o.r60++; }
console.log("■ 1日の値幅（高値−安値）");
for (const [y, o] of Object.entries(byY)) console.log(`  ${y}年：${o.n}日のうち 30ドル以上 ${o.r30}日（${Math.round(o.r30 / o.n * 100)}％）・60ドル以上 ${o.r60}日 ／ 平均の値幅 ${(o.sum / o.n).toFixed(1)}ドル`);
// 2) 今のルールの判断のうち、損切りより先に「入った価格から30ドル」有利に動いたもの
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const tr = rolling(B, compose(STRATEGIES.ichimoku, { bigBar: 0.6 }, ["minStop", "daily"]), 0);
const idx = new Map(Array.from(B.t, (t, k) => [t, k]));
const yr = {};
for (const t of tr) {
  const i = idx.get(t.t), e = B.o[i] + t.dir * 0.4; let hit = false;
  for (let j = i; j < Math.min(B.n, i + 24); j++) { const fav = t.dir === 1 ? B.h[j] - e : e - B.l[j]; if (fav >= 30) { hit = true; break; } if (j > i && j - i >= t.hours) break; }
  const y = new Date(t.t).getUTCFullYear(); const o = (yr[y] ||= { n: 0, hit: 0 }); o.n++; if (hit) o.hit++;
}
console.log("\n■ 今のルールの判断のうち、決済までに「入った価格から30ドル有利」に動いたもの（24時間以内）");
for (const [y, o] of Object.entries(yr)) console.log(`  ${y}年：${o.n}回のうち ${o.hit}回（${Math.round(o.hit / o.n * 100)}％）`);
