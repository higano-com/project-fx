// 落ち込みを小さくする：負けが続いたら休む／1日の負けが一定を超えたらその日はやめる
import { score, BASE, man } from "./scalpLab.mjs";
const B = { ...BASE, noWd: [6] };
const S = (n, c) => { const s = score(c); console.log(`${n.padEnd(24, "　")} 調整${man(s.c8.tune.yen).padStart(5)}(${man(s.c12.tune.yen)}) 落込${man(s.c8.tune.dd)} ｜確認${man(s.c8.check.yen).padStart(4)}(${man(s.c12.check.yen)}) 落込${man(s.c8.check.dd)} ｜最終${man(s.c8.final.yen).padStart(4)}(${man(s.c12.final.yen)}) 落込${man(s.c8.final.dd)}`); };
S("今のやり方", B);
for (const [n, m] of [[2, 120], [3, 120], [3, 240], [4, 240], [3, 720], [5, 720]]) S(`${n}回続けて負けたら${m / 60}時間休む`, { ...B, streak: [n, m] });
for (const v of [100000, 150000, 200000]) S(`1日${v / 1e4}万円負けたらその日はやめる`, { ...B, dayStop: v });
S("3回負けで4時間＋1日15万", { ...B, streak: [3, 240], dayStop: 150000 });
