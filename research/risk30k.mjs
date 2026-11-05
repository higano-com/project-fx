// 1回の許容損失を3万円にしたら、今のルールの成績はどうなるか
// ・損益は「R」（1回の許容損失を1としたときの倍数）× 3万円
// ・アプリと同じ停止ライン（1日の損失上限15万円の2日分、ただし口座の2割まで）に届いたら、そこで止まる
import { loadCsv, prepare, STRATEGIES, summarize } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { rolling } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const S = compose(STRATEGIES.ichimoku, { bigBar: 0.6 }, ["minStop", "daily"]);
const RISK = +(process.argv[2] || 30000), DAILY = 150000;   // 1回の許容損失（円）を引数で指定できる
const man = v => (v / 1e4).toFixed(1) + "万円";
const runs = [0, 7, 14, 21].map(o => rolling(B, S, o));
for (const cap of [1000000, 3000000, 5000000]) {
  const stopAmt = Math.min(DAILY * 2, cap * 0.2);
  console.log(`\n■ 口座${man(cap)}・1回${man(RISK)}（口座の${(RISK / cap * 100).toFixed(1)}％）・停止ライン −${man(stopAmt)}`);
  runs.forEach((tr, k) => {
    let eq = 0, pk = 0, dd = 0, streak = 0, maxStreak = 0, stopped = null;
    for (const t of tr) {
      eq += t.R * RISK; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq);
      streak = t.R < 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
      if (!stopped && pk - eq >= stopAmt) stopped = { t: t.t1, eq };
    }
    const yr = {}; for (const t of tr) { const y = new Date(t.t).getUTCFullYear(); yr[y] = (yr[y] || 0) + t.R * RISK; }
    console.log(`  見直しの日${[0, 7, 14, 21][k]}日ずらし：止めなければ ${eq >= 0 ? "＋" : "−"}${man(Math.abs(eq))}（${tr.length}回）・一番の落ち込み ${man(dd)}・連敗 最大${maxStreak}回`
      + (stopped ? ` ｜ ${new Date(stopped.t).toISOString().slice(0, 10)}に停止ラインに届く（その時点で ${stopped.eq >= 0 ? "＋" : "−"}${man(Math.abs(stopped.eq))}）` : " ｜ 停止ラインには届かない"));
    console.log(`     年ごと：${Object.entries(yr).map(([y, v]) => `${y} ${v >= 0 ? "＋" : "−"}${man(Math.abs(v))}`).join(" ／ ")}`);
  });
}
// 1年あたりの見込み（取引の順番をばらばらにして1万回）
const all = runs.flat(), perYear = Math.round(runs[0].length / 5.7);
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const fin = [], dds = [];
for (let k = 0; k < 10000; k++) { let e = 0, p = 0, d = 0; for (let j = 0; j < perYear; j++) { e += all[Math.floor(rnd() * all.length)].R * RISK; p = Math.max(p, e); d = Math.max(d, p - e); } fin.push(e); dds.push(d); }
fin.sort((a, b) => a - b); dds.sort((a, b) => a - b);
const q = (a, f) => a[Math.floor(a.length * f)];
console.log(`\n■ 1年あたり（${perYear}回の取引として1万回）`);
console.log(`  1年の損益：真ん中 ${man(q(fin, .5))}、悪い方から1割 ${man(q(fin, .1))}、良い方から1割 ${man(q(fin, .9))}`);
console.log(`  マイナスで終わる割合 ${(fin.filter(v => v < 0).length / 100).toFixed(1)}％`);
console.log(`  一番の落ち込み：真ん中 ${man(q(dds, .5))}、悪い方から1割 ${man(q(dds, .9))}`);
console.log(`  1年のうちに20万円以上落ち込む割合 ${(dds.filter(v => v >= 200000).length / 100).toFixed(1)}％、30万円以上 ${(dds.filter(v => v >= 300000).length / 100).toFixed(1)}％`);
