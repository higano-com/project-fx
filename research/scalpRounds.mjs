// 30分ごとの練習を、くり返し改善する（1回に1つの考えを試し、条件を満たしたものだけ残す）
// 採用の条件：調整期間でコスト0.8・1.2の両方が良くなる（0.8は5万円以上）、確認期間で10万円以上悪くならない、調整の回数が半分以下にならない
// 最終確認の期間は、すべての回が終わってから1度だけ見る
import { writeFileSync } from "node:fs";
import { score, BASE, man, START, CHECK, FINAL, END } from "./scalpLab.mjs";
const d = t => new Date(t).toISOString().slice(0, 10);
const H = (a, b) => { const o = []; for (let h = a; o.length === 0 || (h % 24 !== b % 24 && o.length < 24); h++) o.push(h % 24); return o; };   // a時〜b時の前まで
const rounds = [
  ["向きの決め方", [["直前の1時間", c => ({ ...c, dir: "prev60" })], ["30分と1時間がそろう", c => ({ ...c, dir: "both" })], ["30分の足が2本続けて同じ向き", c => ({ ...c, dir: "two30" })], ["平均線の上下", c => ({ ...c, dir: "ema" })], ["逆張り", c => ({ ...c, dir: "fade" })]]],
  ["4時間の流れとそろえる", [["そろうときだけ", c => ({ ...c, agree4h: true })]]],
  ["入る時間帯", [["欧米の時間（16時〜翌2時）", c => ({ ...c, hours: H(16, 3) })], ["東京の昼（9〜15時）を除く", c => ({ ...c, hours: H(0, 24).filter(h => h < 9 || h > 15) })], ["夜（21時〜翌2時）", c => ({ ...c, hours: H(21, 3) })], ["明け方（3〜8時）を除く", c => ({ ...c, hours: H(0, 24).filter(h => h < 3 || h > 8) })]]],
  ["直前の30分の動きの大きさ", [0.2, 0.4, 0.6].map(v => [`値動きの${v}倍以上`, c => ({ ...c, minMove: v })])],
  ["値動きが小さすぎるときは見送り", [2, 3, 4].map(v => [`30分の値動き${v}ドル未満は見送り`, c => ({ ...c, vol: [v, (c.vol || [0, 99])[1]] })])],
  ["値動きが大きすぎるときは見送り", [8, 10, 15].map(v => [`30分の値動き${v}ドル超は見送り`, c => ({ ...c, vol: [(c.vol || [0, 99])[0], v] })])],
  ["節目までの距離（ドル）", [8, 10, 14, 16].map(v => [`${v}ドル以内なら見送り`, c => ({ ...c, sr: { ...c.sr, near: v, nearAtr: 0 } })])],
  ["節目までの距離（値動きの倍数）", [1, 1.5, 2, 3].map(v => [`値動きの${v}倍以内なら見送り`, c => ({ ...c, sr: { ...c.sr, nearAtr: v } })])],
  ["節目の作り方", [["1時間足・前後3本", c => ({ ...c, sr: { ...c.sr, tf: "60", s: 3 } })], ["1時間足・前後2本", c => ({ ...c, sr: { ...c.sr, tf: "60", s: 2 } })], ["4時間足・前後3本", c => ({ ...c, sr: { ...c.sr, tf: "240", s: 3 } })], ["30分足・前後2本", c => ({ ...c, sr: { ...c.sr, tf: "30", s: 2 } })]]],
  ["節目を探す時間", [12, 36, 48].map(v => [`${v}時間`, c => ({ ...c, sr: { ...c.sr, look: v } })])],
  ["後ろの支えが遠ければ見送り", [10, 15, 20].map(v => [`${v}ドルより遠ければ見送り`, c => ({ ...c, srBehind: v })])],
  ["戻したら決済の幅", [14, 16, 20, 22].map(v => [`${v}ドル`, c => ({ ...c, trail: v, trailAtr: 0 })])],
  ["追いかけ始める伸び", [6, 8, 12, 15].map(v => [`${v}ドル`, c => ({ ...c, from: v, fromAtr: 0 })])],
  ["追いかけ方を値動きに合わせる", [[2, 2], [3, 2], [4, 3], [3, 3]].map(([a, b]) => [`戻し${a}倍・伸び${b}倍`, c => ({ ...c, trailAtr: a, fromAtr: b })])],
  ["最初の損切りを値動きに合わせる（5万円まで）", [2, 3, 4].map(v => [`値動きの${v}倍`, c => ({ ...c, stopAtr: v })])],
  ["最初の損切りを小さく", [15, 18].map(v => [`${v}ドル`, c => ({ ...c, stop: v })])],
  ["最長の時間", [180, 300, 360].map(v => [`${v / 60}時間`, c => ({ ...c, hold: v })])],
  ["時間切れのとき、伸びていれば延ばす", [60, 120].map(v => [`${v / 60}時間延ばす`, c => ({ ...c, holdWin: v })])],
  ["伸びたら損切りを入った価格へ", [5, 10, 15].map(v => [`${v}ドル伸びたら`, c => ({ ...c, be: v })])],
  ["決まった利確も置く", [30, 40, 60].map(v => [`${v}ドル`, c => ({ ...c, tp: v })])],
  ["損切りのあと少し休む", [30, 60, 120].map(v => [`${v}分`, c => ({ ...c, cool: v })])],
  ["1日の回数の上限", [4, 6, 8].map(v => [`${v}回`, c => ({ ...c, maxDay: v })])],
  ["入る分", [[[1, 31], "毎時1分・31分"], [[5, 35], "5分・35分"], [[10, 40], "10分・40分"]].map(([m, n]) => [n, c => ({ ...c, mins: m })])],
  ["入る回数を増やす（15分ごと）", [["毎時3・18・33・48分", c => ({ ...c, mins: [3, 18, 33, 48] })]]],
  ["曜日", [["月曜は入らない", c => ({ ...c, noWd: [1] })], ["金曜は入らない", c => ({ ...c, noWd: [5] })], ["土曜の朝は入らない", c => ({ ...c, noWd: [6] })]]],
];
// 2周目：変わった設定のもとで、主な項目をもう一度見直す
const again = ["向きの決め方", "入る時間帯", "節目までの距離（ドル）", "節目までの距離（値動きの倍数）", "節目を探す時間", "戻したら決済の幅", "追いかけ始める伸び", "追いかけ方を値動きに合わせる", "最初の損切りを値動きに合わせる（5万円まで）", "最長の時間", "直前の30分の動きの大きさ", "値動きが大きすぎるときは見送り", "値動きが小さすぎるときは見送り", "伸びたら損切りを入った価格へ", "損切りのあと少し休む", "1日の回数の上限", "4時間の流れとそろえる", "後ろの支えが遠ければ見送り", "時間切れのとき、伸びていれば延ばす", "決まった利確も置く", "最初の損切りを小さく", "入る分", "曜日", "節目の作り方", "入る回数を増やす（15分ごと）"];
const all = [...rounds, ...again.map(n => [n + "（2周目）", rounds.find(r => r[0] === n)[1]])];
let cur = BASE, cs = score(cur);
const fmt = s => `調整 ${man(s.c8.tune.yen)}万（1.2：${man(s.c12.tune.yen)}）${s.c8.tune.n}回 落込${man(s.c8.tune.dd)} ／ 確認 ${man(s.c8.check.yen)}万（1.2：${man(s.c12.check.yen)}）`;
const log = [`# 30分ごとの練習：くり返しの記録\n`, `期間：調整 ${d(START)}〜${d(CHECK)}、確認 〜${d(FINAL)}、最終確認 〜${d(END)}（最後にだけ見る）\n`, `スタート：${fmt(cs)}\n`];
console.log(log.join(""));
all.forEach(([name, cands], r) => {
  let best = null;
  const lines = [];
  for (const [label, f] of cands) {
    const c = f(cur), s = score(c);
    const ok = s.c8.tune.yen > cs.c8.tune.yen + 5e4 && s.c12.tune.yen > cs.c12.tune.yen && s.c8.check.yen > cs.c8.check.yen - 1e5 && s.c8.tune.n >= cs.c8.tune.n * 0.5;
    lines.push(`  ${ok ? "○" : "×"} ${label}：${fmt(s)}`);
    if (ok && (!best || s.c8.tune.yen + s.c12.tune.yen > best.s.c8.tune.yen + best.s.c12.tune.yen)) best = { label, c, s };
  }
  const head = `## 第${r + 1}回 ${name}：${best ? "採用「" + best.label + "」" : "変えない"}`;
  if (best) { cur = best.c; cs = best.s; }
  log.push(head + "\n" + lines.join("\n") + `\n  → 今の設定：${fmt(cs)}\n`);
  console.log(head + "\n" + lines.join("\n"));
});
log.push(`\n## 最後の設定\n\`${JSON.stringify(cur)}\`\n`);
const b = score(BASE);
log.push(`\n## 最終確認（${d(FINAL)}〜${d(END)}、くり返しの間は一度も見ていない期間）\n- 始めの設定：コスト0.8で${man(b.c8.final.yen)}万円・${b.c8.final.n}回（1.2で${man(b.c12.final.yen)}万円）\n- 最後の設定：コスト0.8で${man(cs.c8.final.yen)}万円・${cs.c8.final.n}回（1.2で${man(cs.c12.final.yen)}万円）\n`);
writeFileSync(new URL("./scalp-rounds.md", import.meta.url), log.join("\n"));
console.log(log.slice(-2).join("\n"));
