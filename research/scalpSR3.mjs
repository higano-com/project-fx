// 第3回：「4時間足の節目が進む方向の12ドル以内なら見送り（24時間で探す）」を入れたとき、追いかける決済の数字は今のままで良いか
import { line, COST } from "./scalpSR.mjs";
const man = v => (v / 1e4).toFixed(0);
for (const [sp, sl] of [[0.8, 0.1], [1.2, 0.2]]) {
  COST.sp = sp; COST.slip = sl;
  console.log(`\n■ スプレッド${sp}ドル（見送りあり）。縦＝戻したら決済の幅、横＝伸びてから。全体（前半／後半）万円`);
  console.log("        " + [5, 8, 10, 12, 15].map(f => `${f}ドル伸び`.padStart(14)).join(""));
  for (const trail of [12, 14, 16, 18, 20, 22]) { let s = `${trail}ドル戻し`.padEnd(8); for (const from of [5, 8, 10, 12, 15]) { const r = line("", { src: "4時間", look: 24, D: 12, minDist: 0, trail, from }); s += `${man(r.all)}(${man(r.a)}/${man(r.b)})`.padStart(14); } console.log(s); }
  for (const hold of [180, 240, 300, 360]) console.log(line(`  最長${hold / 60}時間`, { src: "4時間", look: 24, D: 12, minDist: 0, hold }).txt);
}
