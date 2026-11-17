// 強弱用の中継役（クラウドフレアのページ機能）
// アプリ → /api/strength → ヤフーファイナンスの主な通貨・商品の今の値段と、比べる元の値段
//   prev：前日の終値　r.m5／r.m15／r.h1／r.h4：5分前・15分前・1時間前・4時間前の値段（5分足の終値）
// ・1分だけためておく。価格を読むだけ。注文に関わる処理はありません
const SYM = [
  ["ag", "銀", "SI=F"], ["au", "金", "GC=F"], ["pt", "プラチナ", "PL=F"], ["cu", "銅", "HG=F"], ["oil", "原油", "CL=F"],
  ["dxy", "ドル指数", "DX-Y.NYB"], ["jpy", "ドル円", "JPY=X"], ["eur", "ユーロドル", "EURUSD=X"], ["tnx", "米10年金利", "^TNX"],
  // 銀に関わる国（2026/11/17 の検証で銀と一緒に動く度合いが大きかったもの＋大口の産出国・消費国）
  ["cnh", "人民元", "CNH=X"], ["sse", "上海株", "000001.SS"], ["aud", "豪ドル", "AUDUSD=X"], ["mxn", "メキシコペソ", "MXN=X"], ["inr", "インドルピー", "INR=X"]
];
const BACK = { m5: 5, m15: 15, h1: 60, h4: 240 };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

async function one([k, n, s]) {
  try {
    const get = range => fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=5m&range=${range}`, { headers: { "user-agent": "Mozilla/5.0" } }).then(r => r.json());
    // 前日の終値は1日分の chartPreviousClose（2日分だと2日前の終値になるため）。過去の値段は2日分の5分足から
    const [j1, j2] = await Promise.all([get("1d"), get("2d")]);
    const m = j1.chart.result[0].meta, res = j2.chart.result[0];
    const p = +m.regularMarketPrice;
    const prev = +(m.chartPreviousClose ?? m.previousClose);
    if (!Number.isFinite(p) || !Number.isFinite(prev) || !prev) return null;
    const ts = res.timestamp || [], cl = (res.indicators.quote[0] || {}).close || [];
    const bars = ts.map((t, i) => [t * 1000, cl[i]]).filter(b => b[1] != null && Number.isFinite(+b[1]));
    const r = {};
    if (bars.length) {
      const last = bars[bars.length - 1][0];
      for (const [key, min] of Object.entries(BACK)) {
        const want = last - min * 60000;
        let v = null;
        for (const b of bars) { if (b[0] <= want) v = +b[1]; else break; }
        if (v) r[key] = v;
      }
    }
    return { k, n, p, prev, r, t: bars.length ? bars[bars.length - 1][0] : null };
  } catch (e) { return null; }
}

export async function onRequestGet({ waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request("https://signal-cache.internal/strength3");
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const items = (await Promise.all(SYM.map(one))).filter(Boolean);
  if (!items.length) return json({ error: "upstream" }, 502);
  const res = json({ t: Date.now(), items }, 200, { "cache-control": "public, max-age=60" });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
