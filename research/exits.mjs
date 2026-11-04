// 損切り・利確の決め方の比べ方：今のやり方（値動きの大きさの倍数）と、チャートの節目（直前の安値・高値）を使うやり方
// 入る判断は同じ（一目均衡表＋損切り幅の下限＋日足の流れ）。毎月・1週間ずつずらした4回分の直近3か月で設定を選ぶ
import { loadCsv, prepare, STRATEGIES, gridList, runStrategy, summarize } from "./engine.mjs";
import { compose } from "./filters.mjs";

const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
const DAY = 86400e3, START = Date.UTC(2021, 2, 1), HOLD = Date.UTC(2026, 4, 1), HALF = Date.UTC(2024, 0, 1), END = B.t[B.n - 1] + 1, YEN = 2500;
const I = STRATEGIES.ichimoku;

// 直前の安値・高値（i本目より前のN本で）
const lowN = (i, n) => { let m = Infinity; for (let k = i - n; k < i; k++) m = Math.min(m, B.l[k]); return m; };
const highN = (i, n) => { let m = -Infinity; for (let k = i - n; k < i; k++) m = Math.max(m, B.h[k]); return m; };
// 今の値より先にある「前の高値（安値）」。見つからなければ null（新しい高値・安値の更新中）
const nextLevel = (i, dir, n) => {
  const c = B.c[i]; let best = null;
  for (let k = i - n; k < i - 2; k++) {
    const isPeak = dir === 1 ? B.h[k] >= B.h[k - 1] && B.h[k] >= B.h[k + 1] && B.h[k] >= B.h[k - 2] && B.h[k] >= B.h[k + 2] : B.l[k] <= B.l[k - 1] && B.l[k] <= B.l[k + 1] && B.l[k] <= B.l[k - 2] && B.l[k] <= B.l[k + 2];
    if (!isPeak) continue;
    const v = dir === 1 ? B.h[k] : B.l[k];
    if (dir === 1 ? v > c : v < c) { const d = Math.abs(v - c); if (best === null || d < best) best = d; }
  }
  return best;
};

function variant(kind) {
  const grid = { ...I.grid };
  if (kind === "swingStop" || kind === "both") { grid.sn = [12, 24, 48]; grid.buf = [0.2, 0.5]; }
  if (kind === "swingTarget" || kind === "both") { grid.tn = [48, 120, 240]; grid.front = [0.9, 1.0]; }
  if (kind === "be" || kind === "swingStopBe") grid.be = [1, 1.5, 2];
  if (kind === "trail" || kind === "swingStopTrail") { grid.trail = [2, 3, 4]; delete grid.rr; }
  if (kind === "hold") grid.hold = [24, 48, 72];
  if (kind.startsWith("swingStop") && kind !== "swingStop") { grid.sn = [12, 24, 48]; grid.buf = [0.2, 0.5]; }
  return {
    grid,
    fn(B, i, p) {
      const s = I.fn(B, i, p); if (!s) return null;
      const a = B.atr[i], c = B.c[i];
      let stop = s.stop;
      if (kind.startsWith("swingStop") || kind === "both") {
        const lv = s.dir === 1 ? lowN(i, p.sn) - p.buf * a : highN(i, p.sn) + p.buf * a;
        stop = Math.abs(c - lv);
        if (stop < 0.5 * a || stop > 6 * a) return null;      // 近すぎ・遠すぎは見送る
      }
      let rr = s.rr;
      if (kind === "swingTarget" || kind === "both") {
        const d = nextLevel(i, s.dir, p.tn);
        if (d !== null) rr = Math.max(0.5, d * p.front / stop);   // 前の高値（安値）の手前で利確
        // 見つからない（高値・安値の更新中）ときは、今のやり方の倍率のまま
      }
      const out = { dir: s.dir, stop, rr };
      if (p.be) out.be = p.be;
      if (p.trail) { out.trail = p.trail; out.rr = 20; }   // 追いかける損切りのときは、利確をほぼ置かない
      if (p.hold) out.hold = p.hold;
      return out;
    },
  };
}
function rolling(S, off) {
  const combos = gridList(S.grid).map(x => ({ ...x, trades: runStrategy(B, S, x.p) }));
  const byIdx = new Map(combos.map(x => [x.idx.join(","), x]));
  const oos = [];
  for (let m = START + off * DAY; m < END; m += 30 * DAY) {
    const score = new Map(combos.map(x => [x, 0])), cnt = new Map(combos.map(x => [x, 0]));
    for (let k = 0; k < 4; k++) {
      const e = m - k * 7 * DAY, sc = new Map();
      for (const x of combos) { let n = 0, s = 0; for (const t of x.trades) if (t.t >= e - 91 * DAY && t.t < e) { n++; s += t.R; } sc.set(x, { n, s }); }
      for (const x of combos) { const me = sc.get(x); if (me.n < 5) continue; const ns = [me.s]; x.idx.forEach((v, kk) => [-1, 1].forEach(d => { const idx = [...x.idx]; idx[kk] += d; const nb = byIdx.get(idx.join(",")); if (nb) ns.push(sc.get(nb).s); })); score.set(x, score.get(x) + ns.reduce((a, b) => a + b, 0) / ns.length); cnt.set(x, cnt.get(x) + 1); }
    }
    let best = null; for (const x of combos) if (cnt.get(x) === 4 && (!best || score.get(x) > score.get(best))) best = x;
    if (best) for (const t of best.trades) if (t.t >= m && t.t < m + 30 * DAY) oos.push(t);
  }
  return oos;
}
const man = r => (r * YEN / 1e4).toFixed(1);
const ONLY = process.argv[2] ? process.argv[2].split(",") : null;
const kindsAll = { atr: "今のやり方（値動きの大きさの倍数）", swingStop: "損切りを直前の安値（高値）の外に", swingTarget: "利確を前の高値（安値）の手前に", both: "損切り・利確の両方を節目に",
  be: "利益が出たら損切りを入った価格へ動かす", trail: "損切りを値動きに合わせて追いかける（利確は置かない）", hold: "持つ時間を短くする",
  swingStopBe: "節目の損切り＋利益が出たら入った価格へ", swingStopTrail: "節目の損切り＋追いかける損切り" };
const kinds = ONLY ? Object.fromEntries(Object.entries(kindsAll).filter(([k]) => ONLY.includes(k))) : kindsAll;
console.log("確認期間：2021年3月〜。毎月・直近3か月（4回分の平均）で設定を選ぶ。見直しの日を0・7・14・21日ずらした4通り。1回2,500円で計算（万円）\n");
for (const [k, name] of Object.entries(kinds)) {
  const S = compose(variant(k), {}, ["minStop", "daily"]);
  const runs = [0, 7, 14, 21].map(o => rolling(S, o));
  const row = f => runs.map(tr => summarize(tr.filter(f)));
  const all = row(t => t.t < END), h1 = row(t => t.t < HALF), h2 = row(t => t.t >= HALF && t.t < HOLD), F = row(t => t.t >= HOLD);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`■ ${name}`);
  console.log(`  全体 ${all.map(s => man(s.sumR)).join("・")}（平均 ${man(avg(all.map(s => s.sumR)))}）  回数 ${Math.round(avg(all.map(s => s.n)))}  勝率 ${(avg(all.map(s => s.win)) * 100).toFixed(0)}％  利益÷損失 ${avg(all.map(s => s.pf)).toFixed(2)}  一番の落ち込み ${man(avg(all.map(s => s.maxDDR)))}`);
  console.log(`  前半（〜2023）平均 ${man(avg(h1.map(s => s.sumR)))} ／ 後半（2024〜26/4）平均 ${man(avg(h2.map(s => s.sumR)))} ／ 最新6か月 ${F.map(s => man(s.sumR)).join("・")}\n`);
}
