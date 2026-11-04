// 経済指標の発表日時と、金利・ドルの強さ（日ごと）を読み込む
import { readFileSync } from "node:fs";
function usDst(t) {
  const y = new Date(t).getUTCFullYear();
  const nthSun = (m, n) => { const f = new Date(Date.UTC(y, m, 1)).getUTCDay(); return Date.UTC(y, m, 1 + ((7 - f) % 7) + 7 * (n - 1)); };
  return t >= nthSun(2, 2) + 7 * 3600e3 && t < nthSun(10, 1) + 6 * 3600e3;
}
// 米国東部時間の「y-m-d h:mm」を世界時の時刻(ms)にする
function et(y, m, d, h, mi) { const guess = Date.UTC(y, m - 1, d, h + 5, mi); return usDst(guess) ? guess - 3600e3 : guess; }
const MON = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12, Jan: 1, Feb: 2, Mar: 3, Apr: 4, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
export function loadEvents(dir = "data/raw") {
  const ev = [];
  for (const [file, key, name] of [["bls_empsit.html", "empsit", "雇用統計"], ["bls_cpi.html", "cpi", "物価"]]) {
    const t = readFileSync(`${dir}/${file}`, "utf8");
    for (const d of new Set([...t.matchAll(new RegExp(key + "_(\\d{8})\\.(?:htm|pdf)", "g"))].map(m => m[1]))) {
      const m = +d.slice(0, 2), day = +d.slice(2, 4), y = +d.slice(4);
      if (y >= 2020) ev.push({ t: et(y, m, day, 8, 30), kind: key === "empsit" ? "nfp" : "cpi", name });
    }
  }
  // 金利の決定（会合の最終日の14:00、米国東部時間）
  const cur = readFileSync(`${dir}/fomc_current.html`, "utf8").split(/(\d{4}) FOMC Meetings/);
  for (let i = 1; i < cur.length; i += 2) {
    const y = +cur[i];
    for (const [, mon, days] of cur[i + 1].matchAll(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>.*?fomc-meeting__date[^>]*>([^<]+)</gs)) {
      if (/notation|unscheduled|cancel/i.test(days)) continue;
      const ms = mon.split("/"), endMon = MON[ms[ms.length - 1].trim()], endDay = +days.replace("*", "").split("-").pop();
      if (endMon && endDay) ev.push({ t: et(y, endMon, endDay, 14, 0), kind: "fomc", name: "金利の決定" });
    }
  }
  const h2020 = readFileSync(`${dir}/fomc_2020.html`, "utf8");
  for (const [, mon, days] of h2020.matchAll(/<h5[^>]*>(\w+) ([\d-]+) Meeting - 2020<\/h5>/g)) {
    const endDay = +days.split("-").pop(); if (MON[mon]) ev.push({ t: et(2020, MON[mon], endDay, 14, 0), kind: "fomc", name: "金利の決定" });
  }
  return ev.sort((a, b) => a.t - b.t);
}
// 日ごとのデータ（米セントルイス連銀）。その日の値が分かるのは翌日なので、使うときは「前の日まで」の値を使う
export function loadDaily(id) {
  const rows = readFileSync(`data/macro_${id}.csv`, "utf8").trim().split("\n").slice(1).map(l => l.split(",")).filter(r => r[1] && r[1] !== ".").map(r => [Date.parse(r[0] + "T00:00:00Z"), +r[1]]);
  return rows;
}
// 1時間足の各本に「前の日までの最新の値」と「その20営業日前からの変化」を割り当てる
export function alignDaily(B, rows, lookback = 20) {
  const val = new Float64Array(B.n).fill(NaN), chg = new Float64Array(B.n).fill(NaN);
  let k = -1;
  for (let i = 0; i < B.n; i++) {
    const dayStart = Math.floor(B.t[i] / 86400e3) * 86400e3;
    while (k + 1 < rows.length && rows[k + 1][0] < dayStart) k++;   // 前の日までの値だけ
    if (k >= 0) { val[i] = rows[k][1]; if (k - lookback >= 0) chg[i] = rows[k][1] - rows[k - lookback][1]; }
  }
  return { val, chg };
}
