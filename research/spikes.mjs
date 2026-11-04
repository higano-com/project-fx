// 短時間の急落・急騰のあと、値段はどう動くか（そのまま続くか、戻るか）
// 急変の定義：1時間の動き（終値−始値）がふだんの値動き（ATR）の k 倍以上、または3時間の動きが m 倍以上
import { loadCsv, prepare } from "./engine.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const START = Date.UTC(2021, 0, 1), HALF = Date.UTC(2024, 0, 1);
const SPREAD = 0.8;
const H = [1, 3, 6, 12, 24];
function study(label, test) {
  const ev = [];
  let last = -99;
  for (let i = 30; i < B.n - 25; i++) {
    if (B.t[i] < START) continue;
    const d = test(i); if (!d || i - last < 6) continue;   // 6時間以内の続きは1回と数える
    last = i;
    const a = B.atr[i - 1], row = { t: B.t[i], dir: d, fwd: {} };
    for (const h of H) row.fwd[h] = ((B.c[i + h] - B.c[i]) * d) / a;   // 急変と同じ向きに何倍動いたか（＋なら続いた、−なら戻った）
    ev.push(row);
  }
  const show = (arr, tag) => {
    if (!arr.length) return;
    const cells = H.map(h => { const v = arr.map(x => x.fwd[h]); const m = v.reduce((p, q) => p + q, 0) / v.length; const cont = v.filter(x => x > 0).length / v.length; return `${h}時間後 ${m >= 0 ? "＋" : "−"}${Math.abs(m).toFixed(2)}倍（続いた${Math.round(cont * 100)}％）`; });
    console.log(`  ${tag.padEnd(8, "　")} ${String(arr.length).padStart(3)}回 ｜ ${cells.join(" ／ ")}`);
  };
  console.log(`\n■ ${label}`);
  show(ev, "全部");
  show(ev.filter(x => x.dir === -1), "急落");
  show(ev.filter(x => x.dir === 1), "急騰");
  show(ev.filter(x => x.t < HALF), "〜2023年");
  show(ev.filter(x => x.t >= HALF), "2024年〜");
  return ev;
}
const body = i => (B.c[i] - B.o[i]) / B.atr[i - 1];
for (const k of [2, 3, 4]) study(`1時間でふだんの${k}倍以上動いた`, i => Math.abs(body(i)) >= k ? Math.sign(body(i)) : 0);
for (const m of [4, 6]) study(`3時間でふだんの${m}倍以上動いた`, i => { const v = (B.c[i] - B.o[i - 2]) / B.atr[i - 3]; return Math.abs(v) >= m ? Math.sign(v) : 0; });
console.log(`\n（参考）取引のコスト：スプレッド${SPREAD}ドルは、ふだんの1時間の値動きのおよそ${(SPREAD / (B.atr.slice(-5000).reduce((p, q) => p + q, 0) / 5000)).toFixed(2)}倍（最近）`);
