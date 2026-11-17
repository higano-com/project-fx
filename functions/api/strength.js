// 強弱用の中継役（クラウドフレアのページ機能）
// アプリ → /api/strength → ヤフーファイナンスの主な通貨・商品の今の値段と前日の終値
// ・1分だけためておく。価格を読むだけ。注文に関わる処理はありません
const SYM = [
  ["ag", "銀", "SI=F"], ["au", "金", "GC=F"], ["pt", "プラチナ", "PL=F"], ["cu", "銅", "HG=F"], ["oil", "原油", "CL=F"],
  ["dxy", "ドル指数", "DX-Y.NYB"], ["jpy", "ドル円", "JPY=X"], ["eur", "ユーロドル", "EURUSD=X"], ["tnx", "米10年金利", "^TNX"]
];
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

async function one([k, n, s]) {
  try {
    const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=5m&range=1d`, { headers: { "user-agent": "Mozilla/5.0" } })).json();
    const m = j.chart.result[0].meta;
    const p = +m.regularMarketPrice, prev = +(m.chartPreviousClose ?? m.previousClose);
    if (!Number.isFinite(p) || !Number.isFinite(prev) || !prev) return null;
    return { k, n, p, prev };
  } catch (e) { return null; }
}

export async function onRequestGet({ waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request("https://signal-cache.internal/strength1");
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const items = (await Promise.all(SYM.map(one))).filter(Boolean);
  if (!items.length) return json({ error: "upstream" }, 502);
  const res = json({ t: Date.now(), items }, 200, { "cache-control": "public, max-age=60" });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
