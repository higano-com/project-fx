// 30分ごとの練習：大きく負けた日に共通する点はあるか（経済指標の日・その日の値動きの幅・前の日の幅・曜日・一方向に動いた日）
import { run, BASE, YEN, man, m1 } from "./scalpLab.mjs";
import { loadEvents } from "./events.mjs";
const B = { ...BASE, noWd: [6] }, tr = run(B), ev = loadEvents();
const dk = t => new Date(t + 9 * 3600e3 - 7 * 3600e3).toISOString().slice(0, 10);   // GMOの1日（日本時間7時区切り）
const day = {}; for (const q of tr) { const k = dk(q.t); (day[k] = day[k] || { pnl: 0, n: 0 }); day[k].pnl += q.usd * YEN; day[k].n++; }
const px = {}; for (const r of m1) { const k = dk(r[0]); const d = px[k] || (px[k] = { o: r[1], h: r[2], l: r[3], c: r[4] }); d.h = Math.max(d.h, r[2]); d.l = Math.min(d.l, r[3]); d.c = r[4]; }
const keys = Object.keys(day).sort(), allK = Object.keys(px).sort();
const evDay = new Map(); for (const e of ev) { const k = dk(e.t); evDay.set(k, (evDay.get(k) ? evDay.get(k) + "・" : "") + e.name); }
const rows = keys.map(k => { const p = px[k], pk = allK[allK.indexOf(k) - 1], pp = px[pk]; return { k, ...day[k], rng: p.h - p.l, prevRng: pp ? pp.h - pp.l : 0, eff: Math.abs(p.c - p.o) / (p.h - p.l), ev: evDay.get(k) || "", wd: "日月火水木金土"[new Date(k + "T12:00:00Z").getUTCDay()] }; });
const G = (name, f, ord) => { const g = {}; for (const r of rows) { const key = f(r); (g[key] = g[key] || []).push(r.pnl); }
  console.log(`\n■ ${name}`); for (const k of ord || Object.keys(g).sort()) { const a = g[k]; if (!a) continue; const s = a.reduce((x, y) => x + y, 0); console.log(`  ${String(k).padEnd(16, "　")} ${String(a.length).padStart(3)}日 合計${man(s).padStart(5)}万 1日平均${(s / a.length / 1e4).toFixed(1).padStart(5)}万 プラスの日${Math.round(a.filter(x => x > 0).length / a.length * 100)}％`); } };
G("経済指標の日", r => r.ev ? "指標の日（" + (r.ev.includes("雇用") ? "雇用統計" : r.ev.includes("物価") ? "物価" : "金利の決定") + "）" : "ふつうの日");
G("その日の値動きの幅（高値−安値）", r => r.rng < 40 ? "a 40ドル未満" : r.rng < 60 ? "b 40〜60" : r.rng < 90 ? "c 60〜90" : r.rng < 130 ? "d 90〜130" : "e 130ドル以上");
G("前の日の値動きの幅", r => r.prevRng < 40 ? "a 40ドル未満" : r.prevRng < 60 ? "b 40〜60" : r.prevRng < 90 ? "c 60〜90" : r.prevRng < 130 ? "d 90〜130" : "e 130ドル以上");
G("その日、一方向に動いたか（始値→終値÷幅）", r => r.eff < 0.2 ? "a 行ったり来たり" : r.eff < 0.5 ? "b 中くらい" : "c 一方向");
G("曜日", r => r.wd, ["月", "火", "水", "木", "金", "土"]);
console.log("\n■ 一番悪い10日"); for (const r of [...rows].sort((a, b) => a.pnl - b.pnl).slice(0, 10)) console.log(`  ${r.k}（${r.wd}）${man(r.pnl)}万 ${r.n}回 幅${r.rng.toFixed(0)}ドル 前の日${r.prevRng.toFixed(0)}ドル ${r.eff < 0.2 ? "行ったり来たり" : r.eff < 0.5 ? "中くらい" : "一方向"} ${r.ev}`);
console.log("\n■ 一番良い10日"); for (const r of [...rows].sort((a, b) => b.pnl - a.pnl).slice(0, 10)) console.log(`  ${r.k}（${r.wd}）${man(r.pnl)}万 ${r.n}回 幅${r.rng.toFixed(0)}ドル 前の日${r.prevRng.toFixed(0)}ドル ${r.eff < 0.2 ? "行ったり来たり" : r.eff < 0.5 ? "中くらい" : "一方向"} ${r.ev}`);
