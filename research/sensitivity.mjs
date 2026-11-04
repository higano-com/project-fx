// 「高値・安値を抜けたら乗る」が本当に強いのかを追加で確かめる
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize, COST } from "./engine.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const S = STRATEGIES.breakout, p0 = { n: 48, slMult: 1.5, rr: 2 };
const f = s => `${s.n}回 勝率${(s.win*100).toFixed(0)}% 合計${s.sumR.toFixed(1)}R PF${s.pf.toFixed(2)} 最大落込${s.maxDDR.toFixed(1)}R`;
const all = runStrategy(B, S, p0);
console.log("真ん中の設定（48本・損切り×1.5・利確×2）全期間:", f(summarize(all)));
console.log("  買いだけ:", f(summarize(all.filter(x=>x.dir===1))), " / 売りだけ:", f(summarize(all.filter(x=>x.dir===-1))));
const y = t => new Date(t).getUTCFullYear();
console.log("  2020〜2024:", f(summarize(all.filter(x=>y(x.t)<=2024))), " / 2025〜2026:", f(summarize(all.filter(x=>y(x.t)>=2025))));
for (const sp of [0.8, 1.2, 1.6]) { COST.spread = sp; console.log(`  スプレッド${sp}ドル:`, f(summarize(runStrategy(B, S, p0)))); }
COST.spread = 0.8;
// 全27通りの設定のうち、全期間でプラスだった割合
const res = gridList(S.grid).map(c => summarize(runStrategy(B, S, c.p)));
console.log(`全${res.length}通りの設定のうちプラス: ${res.filter(s=>s.sumR>0).length}通り / PFの範囲 ${Math.min(...res.map(s=>s.pf)).toFixed(2)}〜${Math.max(...res.map(s=>s.pf)).toFixed(2)}`);
// 金の値上がりそのもの（買って持っていただけ）
console.log(`参考：金の価格 ${B.c[600].toFixed(0)}ドル（${new Date(B.t[600]).toISOString().slice(0,10)}）→ ${B.c[B.n-1].toFixed(0)}ドル`);
