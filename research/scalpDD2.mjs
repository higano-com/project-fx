// 落ち込みの原因の候補（時間帯・行ったり来たり）が、期間を分けても効くか
import { score, BASE, man } from "./scalpLab.mjs";
const B = { ...BASE, noWd: [6] }, all = [...Array(24).keys()];
const S = (n, c) => { const s = score(c); console.log(`${n.padEnd(26, "　")} 調整${man(s.c8.tune.yen).padStart(5)}(${man(s.c12.tune.yen)}) 落込${man(s.c8.tune.dd)} ｜確認${man(s.c8.check.yen).padStart(4)}(${man(s.c12.check.yen)}) 落込${man(s.c8.check.dd)} ｜最終${man(s.c8.final.yen).padStart(4)}(${man(s.c12.final.yen)}) 落込${man(s.c8.final.dd)} ｜${s.c8.tune.n + s.c8.check.n + s.c8.final.n}回`); };
S("今のやり方", B);
S("18〜21時は入らない", { ...B, hours: all.filter(h => h < 18 || h > 20) });
S("0〜3時は入らない", { ...B, hours: all.filter(h => h > 2) });
S("両方入らない", { ...B, hours: all.filter(h => h > 2 && (h < 18 || h > 20)) });
S("19〜20時だけ入らない", { ...B, hours: all.filter(h => h < 19 || h > 20) });
S("17〜21時は入らない", { ...B, hours: all.filter(h => h < 17 || h > 20) });
for (const e of [0.05, 0.1, 0.15, 0.2]) S(`進み具合${e * 10}割未満は見送り`, { ...B, minEff: e });
S("両方の時間＋進み1割", { ...B, hours: all.filter(h => h > 2 && (h < 18 || h > 20)), minEff: 0.1 });
