// 大きく動く日にもうかり、小さい日に負ける → 「今、大きく動いているか」で見送りを決められるか。経済指標の前後も
import { score, BASE, man } from "./scalpLab.mjs";
import { loadEvents } from "./events.mjs";
const B = { ...BASE, noWd: [6] }, b0 = score(B), ev = loadEvents();
const S = (n, c) => { const s = score(c); const ok = s.c8.tune.yen > b0.c8.tune.yen && s.c12.tune.yen > b0.c12.tune.yen && s.c8.check.yen > b0.c8.check.yen && s.c12.check.yen > b0.c12.check.yen;
  console.log(`${ok ? "○" : "×"} ${n.padEnd(26, "　")} 調整${man(s.c8.tune.yen).padStart(5)}(${man(s.c12.tune.yen)}) ｜確認${man(s.c8.check.yen).padStart(4)}(${man(s.c12.check.yen)}) ｜最終${man(s.c8.final.yen).padStart(4)}(${man(s.c12.final.yen)}) ｜落込${man(Math.max(s.c8.tune.dd, s.c8.check.dd, s.c8.final.dd))} ${s.c8.tune.n + s.c8.check.n + s.c8.final.n}回`); };
S("今のやり方", B);
for (const v of [5, 6, 8, 10]) S(`30分足の値動きが${v}ドル未満なら見送り`, { ...B, vol: [v, 999] });
for (const r of [40, 50, 60, 80]) S(`直近24時間の幅が${r}ドル未満なら見送り`, { ...B, rng24: r });
for (const [bf, af] of [[30, 60], [60, 120], [0, 240]]) S(`経済指標の${bf}分前〜${af}分後は入らない`, { ...B, noEv: { list: ev, before: bf, after: af } });
S("雇用統計の日だけ入らない（前後12時間）", { ...B, noEv: { list: ev.filter(e => e.kind === "nfp"), before: 720, after: 720 } });
