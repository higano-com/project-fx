// 30分ごとの練習：大きな落ち込みはどこで起きたか（月・時間帯・値動きの大きさ・流れの強さ・向きの入れかわり）
import { run, BASE, YEN, man, m1 } from "./scalpLab.mjs";
const cfg = { ...BASE, noWd: [6] };
const tr = run(cfg);
// 1分足から30分足を作り、各取引の入った時点の値動きの大きさ・入れかわり（直近8本で向きが変わった回数）を付ける
const b30 = new Map(); for (const r of m1) { const k = Math.floor(r[0] / 1800e3) * 1800e3; const b = b30.get(k); if (!b) b30.set(k, [r[1], r[2], r[3], r[4]]); else { b[1] = Math.max(b[1], r[2]); b[2] = Math.min(b[2], r[3]); b[3] = r[4]; } }
const keys = [...b30.keys()].sort((a, b) => a - b), pos = new Map(keys.map((k, i) => [k, i]));
const info = t => { const i = pos.get(Math.floor(t / 1800e3) * 1800e3) - 1; let rng = 0, flips = 0, net = 0; for (let j = i - 7; j <= i; j++) { const b = b30.get(keys[j]), p = b30.get(keys[j - 1]); rng += b[1] - b[2]; net += b[3] - b[0]; if (p && Math.sign(b[3] - b[0]) !== Math.sign(p[3] - p[0])) flips++; } return { rng: rng / 8, flips, eff: Math.abs(net) / Math.max(1, rng) }; };
const group = (name, f, order) => { const g = {}; for (const q of tr) { const k = f(q); (g[k] = g[k] || []).push(q.usd * YEN); }
  console.log(`\n■ ${name}`); for (const k of (order || Object.keys(g).sort())) { const a = g[k]; if (!a) continue; const s = a.reduce((x, y) => x + y, 0); console.log(`  ${String(k).padEnd(14, "　")} ${man(s).padStart(5)}万 ${String(a.length).padStart(4)}回 1回あたり${(s / a.length / 1e4).toFixed(2)}万 勝率${Math.round(a.filter(x => x > 0).length / a.length * 100)}％`); } };
for (const q of tr) Object.assign(q, info(q.t));
group("時間帯（日本時間）", q => { const h = new Date(q.t + 9 * 3600e3).getUTCHours(); return `${String(Math.floor(h / 3) * 3).padStart(2, "0")}〜${String(Math.floor(h / 3) * 3 + 3).padStart(2, "0")}時`; });
group("直近4時間の30分足の平均の幅", q => q.rng < 4 ? "a 4ドル未満" : q.rng < 6 ? "b 4〜6" : q.rng < 8 ? "c 6〜8" : q.rng < 12 ? "d 8〜12" : "e 12ドル以上");
group("直近4時間で向きが入れかわった回数（8本中）", q => `${q.flips}回`);
group("直近4時間の進み具合（動いた幅のうち、一方向に進んだ割合）", q => q.eff < 0.1 ? "a 1割未満" : q.eff < 0.2 ? "b 1〜2割" : q.eff < 0.35 ? "c 2〜3.5割" : "d 3.5割以上");
group("決済の理由", q => q.why);
// 4月・5月だけ
const am = tr.filter(q => { const k = new Date(q.t).toISOString().slice(0, 7); return k === "2026-04" || k === "2026-05"; });
console.log(`\n■ 2026年4〜5月：${am.length}回 ${man(am.reduce((a, q) => a + q.usd * YEN, 0))}万 平均の幅${(am.reduce((a, q) => a + q.rng, 0) / am.length).toFixed(1)}ドル（全体は${(tr.reduce((a, q) => a + q.rng, 0) / tr.length).toFixed(1)}ドル）`);
