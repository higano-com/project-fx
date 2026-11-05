// 1時間ごとの判断（自動の練習）にも「伸びたら追いかける決済」が効くか
// 数量は固定（15枚・損切り5万円）。利確3倍（今）と、利確なし・利確を遠く＋追いかける、を比べる
// 追いかける：損切り幅の半分伸びたら、足の終わりから「ふだんの値動き×倍」戻した所へ損切りを動かす
import { loadCsv, prepare, STRATEGIES, COST } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const I = STRATEGIES.ichimoku, QTY = 15, LOSS = 50000;
const fixed = (rr, trail) => ({ grid: { ...I.grid, slMult: [1.5], rr: [rr] }, fn(B, i, p) {
  const s = I.fn(B, i, p); if (!s) return null;
  return { ...s, stop: Math.max(1, LOSS / (QTY * B.fx[i]) - COST.slip), trail };
} });
for (const [sp, sl] of [[0.8, 0.1], [1.2, 0.2]]) {
  COST.spread = sp; COST.slip = sl;
  console.log(`\nスプレッド${sp}ドル（1回2,500円で計算。5万円なら20倍）`);
  report(B, "今：利確3倍・追いかけなし", compose(fixed(3, 0), { bigBar: 0.6 }, ["daily"]));
  for (const tr of [1, 1.5, 2, 3]) report(B, `利確3倍＋値動き${tr}倍で追いかけ`, compose(fixed(3, tr), { bigBar: 0.6 }, ["daily"]));
  for (const tr of [1.5, 2, 3, 4]) report(B, `利確なし＋値動き${tr}倍で追いかけ`, compose(fixed(20, tr), { bigBar: 0.6 }, ["daily"]));
}
