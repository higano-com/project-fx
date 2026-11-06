// もっと柔軟に：持っている途中で、30分の向きが反対になったら乗りかえる・決済する
import { score, BASE, man, run, YEN } from "./scalpLab.mjs";
const B = { ...BASE, noWd: [6] }, b0 = score(B);
const S = (n, c) => { const s = score(c); const ok = s.c8.tune.yen > b0.c8.tune.yen && s.c12.tune.yen > b0.c12.tune.yen && s.c8.check.yen > b0.c8.check.yen && s.c12.check.yen > b0.c12.check.yen;
  console.log(`${ok ? "○" : "×"} ${n.padEnd(24, "　")} 調整${man(s.c8.tune.yen).padStart(5)}(${man(s.c12.tune.yen)}) ｜確認${man(s.c8.check.yen).padStart(4)}(${man(s.c12.check.yen)}) ｜最終${man(s.c8.final.yen).padStart(4)}(${man(s.c12.final.yen)}) ｜落込${man(Math.max(s.c8.tune.dd, s.c8.check.dd, s.c8.final.dd))} ${s.c8.tune.n + s.c8.check.n + s.c8.final.n}回`); };
S("今のやり方", B);
S("向きが変わったら、いつでも乗りかえ", { ...B, rev: 1 });
S("負けているときだけ乗りかえ", { ...B, rev: 2 });
S("負けているときだけ決済（乗りかえない）", { ...B, rev: 3 });
// 1日あたりの成績のばらつき（今のやり方）
const tr = run(B), day = {}; for (const q of tr) { const k = new Date(q.t + 9 * 3600e3).toISOString().slice(0, 10); day[k] = (day[k] || 0) + q.usd * YEN; }
const v = Object.values(day), plus = v.filter(x => x > 0).length;
console.log(`\n今のやり方の1日ごと：${v.length}日、プラスの日${plus}日（${Math.round(plus / v.length * 100)}％）、1日の平均${(v.reduce((a, b) => a + b, 0) / v.length / 1e4).toFixed(1)}万円、一番悪い日${man(Math.min(...v))}万円、一番良い日${man(Math.max(...v))}万円`);
let run3 = 0, worst = 0; for (const x of Object.keys(day).sort().map(k => day[k])) { run3 = x < 0 ? run3 + 1 : 0; worst = Math.max(worst, run3); }
console.log(`マイナスの日が続いた最長：${worst}日`);
