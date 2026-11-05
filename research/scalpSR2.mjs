// 第2回：4時間足の節目で「すぐ先に節目があれば見送り（D）」「節目を抜けたら延ばす（E）」をくわしく
// まわりの数字・組み合わせ・コスト1.2ドル・月ごとで、たまたまではないか確かめる
import { run, line, COST, YEN } from "./scalpSR.mjs";
const man = v => (v / 1e4).toFixed(0);
for (const [sp, sl] of [[0.8, 0.1], [1.2, 0.2]]) {
  COST.sp = sp; COST.slip = sl;
  console.log(`\n■ スプレッド${sp}ドル。表は全体（前半／後半）万円`);
  console.log(`  土台：${line("", {}).txt.slice(1)}`);
  console.log("  D：縦＝節目までの距離（これより近ければ見送り）、横＝節目を探す時間");
  console.log("        " + [12, 24, 36, 48].map(l => `${l}時間`.padStart(14)).join(""));
  for (const D of [6, 8, 10, 12, 15, 20]) { let s = `  ${D}ドル`.padEnd(8); for (const look of [12, 24, 36, 48]) { const r = line("", { src: "4時間", look, D, minDist: 0 }); s += `${man(r.all)}(${man(r.a)}/${man(r.b)})`.padStart(14); } console.log(s); }
  for (const src of ["1時間", "4時間"]) for (const E of [60, 120, 240]) { const r = line(`  E ${src}の節目を抜けたら${E / 60}時間延ばす（24時間）`, { src, look: 24, E }); console.log(r.txt); }
  for (const D of [8, 10, 12]) { const r = line(`  D${D}ドル＋E（4時間・24時間、2時間延ばす）`, { src: "4時間", look: 24, D, minDist: 0, E: 120 }); console.log(r.txt); }
  for (const D of [8, 10, 12]) for (const C of [0.5]) { const r = line(`  D${D}ドル＋C 損切りを節目の外（4時間・24時間）`, { src: "4時間", look: 24, D, minDist: 0, C }); console.log(r.txt); }
  // 月ごと
  for (const [n, o] of [["土台", {}], ["D10（4時間・24時間）", { src: "4時間", look: 24, D: 10, minDist: 0 }]]) {
    const tr = run(o), m = {}; for (const x of tr) { const k = new Date(x.t).toISOString().slice(0, 7); m[k] = (m[k] || 0) + x.usd * YEN; }
    console.log(`  月ごと ${n}：` + Object.entries(m).map(([k, v]) => `${k.slice(5)}月 ${man(v)}万`).join("・"));
  }
}
