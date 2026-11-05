// 30分ごとの練習：毎月、直近3か月で一番良かった数字を選んで次の1か月に使う（先の値動きは使わない）
// 候補：戻しの幅 × 追いかけ始める伸び × 節目までの距離。比べるのは「決め打ち（今の数字）」
import { run, BASE, YEN, man, START, END } from "./scalpLab.mjs";
const B = { ...BASE, noWd: [6] };
const grid = []; for (const trail of [14, 16, 18, 20, 22]) for (const from of [8, 10, 12]) for (const near of [10, 12, 14, 16]) grid.push({ trail, from, near });
const monthKey = t => new Date(t).toISOString().slice(0, 7);
const months = []; for (let t = START; t < END; t += 86400e3) { const k = monthKey(t); if (!months.includes(k)) months.push(k); }
for (const [sp, sl] of [[0.8, 0.1], [1.2, 0.2]]) {
  const res = grid.map(g => { const tr = run({ ...B, trail: g.trail, from: g.from, sr: { ...B.sr, near: g.near } }, { sp, slip: sl }); const m = {}; for (const q of tr) { const k = monthKey(q.t); m[k] = (m[k] || 0) + q.usd * YEN; } return { g, m }; });
  const base = res.find(r => r.g.trail === 18 && r.g.from === 10 && r.g.near === 12);
  for (const look of [3, 6]) {
    let tot = 0, totB = 0, pk = 0, dd = 0, cum = 0, pkB = 0, ddB = 0, cumB = 0; const pick = [];
    for (let i = look; i < months.length; i++) {
      const prev = months.slice(i - look, i);
      const best = res.reduce((a, r) => { const s = prev.reduce((x, k) => x + (r.m[k] || 0), 0); return !a || s > a.s ? { r, s } : a; }, null).r;
      const v = best.m[months[i]] || 0, vb = base.m[months[i]] || 0;
      tot += v; totB += vb; cum += v; pk = Math.max(pk, cum); dd = Math.max(dd, pk - cum); cumB += vb; pkB = Math.max(pkB, cumB); ddB = Math.max(ddB, pkB - cumB);
      pick.push(`${months[i].slice(2)}:${best.g.trail}/${best.g.from}/${best.g.near}=${man(v)}`);
    }
    console.log(`\nスプレッド${sp}ドル・直近${look}か月で選ぶ（${months[look]}〜）：毎月選ぶ ${man(tot)}万（月末で見た落込${man(dd)}） ／ 決め打ち ${man(totB)}万（落込${man(ddB)}）`);
    console.log("  選んだ数字（戻し/伸び/節目）と、その月の損益：" + pick.join(" "));
  }
}
// 入る回数を減らす：1時間に1回（毎時3分だけ）
for (const [sp, sl] of [[0.8, 0.1], [1.2, 0.2]]) for (const [n, mins] of [["30分ごと", [3, 33]], ["1時間に1回（3分）", [3]], ["1時間に1回（33分）", [33]]]) {
  const tr = run({ ...B, mins }, { sp, slip: sl }); let s = 0, pk = 0, dd = 0; for (const q of tr) { s += q.usd * YEN; pk = Math.max(pk, s); dd = Math.max(dd, pk - s); }
  console.log(`スプレッド${sp}・${n}：${man(s)}万 ${tr.length}回 落込${man(dd)} 1回あたり${(s / tr.length / 1e4).toFixed(2)}万`);
}
