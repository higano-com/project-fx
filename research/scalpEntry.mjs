// 30分ごとの練習：入り方を変える（押し目で入る・抜けたら入る・大きな流れとそろえる・動きすぎたら見送り）
// 採用の条件：調整と確認の両方で、コスト0.8・1.2のどちらも良くなること
import { score, BASE, man } from "./scalpLab.mjs";
const B = { ...BASE, noWd: [6] }, b0 = score(B);
const S = (n, c) => { const s = score(c); const ok = s.c8.tune.yen > b0.c8.tune.yen && s.c12.tune.yen > b0.c12.tune.yen && s.c8.check.yen > b0.c8.check.yen && s.c12.check.yen > b0.c12.check.yen;
  console.log(`${ok ? "○" : "×"} ${n.padEnd(26, "　")} 調整${man(s.c8.tune.yen).padStart(5)}(${man(s.c12.tune.yen)}) ｜確認${man(s.c8.check.yen).padStart(4)}(${man(s.c12.check.yen)}) ｜最終${man(s.c8.final.yen).padStart(4)}(${man(s.c12.final.yen)}) ｜落込${man(Math.max(s.c8.tune.dd, s.c8.check.dd))} ${s.c8.tune.n + s.c8.check.n + s.c8.final.n}回`); };
S("今のやり方", B);
for (const pull of [1, 2, 3, 5]) for (const wait of [10, 25]) S(`押し目${pull}ドルで入る（${wait}分待つ）`, { ...B, pull, wait });
for (const brk of [0, 1]) for (const wait of [10, 25]) S(`直前30分の端を${brk}ドル抜けたら（${wait}分）`, { ...B, brk: brk || 0.01, wait });
for (const slow of [6, 12, 30]) S(`大きな流れとそろえる（4時間足${slow}本の傾き）`, { ...B, slow });
for (const mx of [1.5, 2, 3]) S(`直前30分が値動きの${mx}倍超なら見送り`, { ...B, maxMove: mx });
