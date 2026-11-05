// 一方向に動いているときだけ、大きな流れとそろえる（行ったり来たりのときは、今のまま）
import { score, BASE, man } from "./scalpLab.mjs";
const B = { ...BASE, noWd: [6] }, b0 = score(B);
const S = (n, c) => { const s = score(c); const ok = s.c8.tune.yen > b0.c8.tune.yen && s.c12.tune.yen > b0.c12.tune.yen && s.c8.check.yen > b0.c8.check.yen && s.c12.check.yen > b0.c12.check.yen;
  console.log(`${ok ? "○" : "×"} ${n.padEnd(30, "　")} 調整${man(s.c8.tune.yen).padStart(5)}(${man(s.c12.tune.yen)}) ｜確認${man(s.c8.check.yen).padStart(4)}(${man(s.c12.check.yen)}) ｜最終${man(s.c8.final.yen).padStart(4)}(${man(s.c12.final.yen)}) ｜落込${man(Math.max(s.c8.tune.dd, s.c8.check.dd))}`); };
S("今のやり方", B);
for (const regN of [12, 30, 60]) for (const regMin of [0.05, 0.1, 0.15]) S(`直近${regN}本（4時間足）で進み${regMin * 100}%以上なら流れとそろえる`, { ...B, slow: 12, regN, regMin });
