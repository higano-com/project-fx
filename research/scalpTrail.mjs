// scalpExit.mjs で良く見えた「○ドル伸びてから、最高値から○ドル戻したら決済」が、たまたまではないか確かめる
// まわりの数字・コスト（スプレッド1.2ドル）・持つ時間・月ごと
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("research/scalpExit.mjs", "utf8").split("const half =")[0];
for (const SPx of [0.8, 1.2]) {
  writeFileSync("/tmp/claude-0/-home-user-project-fx/09f0685d-51b9-5770-ba3c-8b8b415f8d99/scratchpad/st.mjs", src.replace("const SP = 0.8, SLIP = 0.1", `const SP = ${SPx}, SLIP = ${SPx > 1 ? 0.2 : 0.1}`).replace('from "node:fs"', 'from "node:fs"').replace("data/xau_usd_1min.csv.gz", "/home/user/project-fx/data/xau_usd_1min.csv.gz") + "\nexport { run, m1, YEN };");
  const { run, m1, YEN } = await import("/tmp/claude-0/-home-user-project-fx/09f0685d-51b9-5770-ba3c-8b8b415f8d99/scratchpad/st.mjs?" + SPx);
  const half = m1[Math.floor(m1.length / 2)][0], man = v => (v * YEN / 1e4).toFixed(0).padStart(4);
  console.log(`\nスプレッド${SPx}ドル：表は「全体（前半／後半）」万円。縦＝戻したら決済の幅、横＝伸びてから`);
  console.log("        " + [5, 8, 10, 12, 15, 20].map(f => `${f}ドル伸びて`.padStart(16)).join(""));
  for (const tr of [10, 12, 14, 16, 18, 20, 24, 30]) {
    let line = `${tr}ドル戻し`.padEnd(8, "　");
    for (const from of [5, 8, 10, 12, 15, 20]) { const t = run({ rr: 0, hold: 240, trail: tr, trailFrom: from }), all = t.reduce((a, x) => a + x.usd, 0), a = t.filter(x => x.t < half).reduce((p, x) => p + x.usd, 0); line += `${man(all)}(${man(a).trim()}/${man(all - a).trim()})`.padStart(16); }
    console.log(line);
  }
  for (const hold of [120, 240, 480]) { const t = run({ rr: 0, hold, trail: 16, trailFrom: 10 }); console.log(`16ドル戻し・10ドル伸びて・最長${hold / 60}時間：${man(t.reduce((a, x) => a + x.usd, 0))}万 ${t.length}回`); }
  const t = run({ rr: 0, hold: 240, trail: 16, trailFrom: 10 }), mon = {};
  for (const x of t) { const k = new Date(x.t).toISOString().slice(0, 7); mon[k] = (mon[k] || 0) + x.usd; }
  console.log("月ごと：" + Object.entries(mon).map(([k, v]) => `${k} ${man(v).trim()}万`).join("・"));
  const base = run({ rr: 2, hold: 240 }), mb = {}; for (const x of base) { const k = new Date(x.t).toISOString().slice(0, 7); mb[k] = (mb[k] || 0) + x.usd; }
  console.log("今のまま（月ごと）：" + Object.entries(mb).map(([k, v]) => `${k} ${man(v).trim()}万`).join("・"));
}
