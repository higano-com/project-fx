// 今の価格だけを返す中継役（クラウドフレアのページ機能）
// アプリ → /api/price?symbol=XAG/USD → スイスクオートの公開の気配値（現物・売値）
// ・ツエルブデータの無料の範囲では銀が取れないため、2026/11/17 にこちらへ変えた
// ・30秒間ためておく。価格を読むだけ。注文に関わる処理はありません
const ALLOWED = { "XAG/USD": "XAG/USD", "XAU/USD": "XAU/USD", "USD/JPY": "USD/JPY" };
const CACHE_SECONDS = 30;
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export async function onRequestGet({ request, waitUntil }) {
  const symbol = new URL(request.url).searchParams.get("symbol") || "";
  if (!ALLOWED[symbol]) return json({ error: "bad_symbol" }, 400);
  const cache = caches.default;
  const cacheKey = new Request("https://signal-cache.internal/price2/" + encodeURIComponent(symbol));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  let d;
  try { d = await (await fetch("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/" + ALLOWED[symbol], { headers: { "user-agent": "Mozilla/5.0" } })).json(); }
  catch (e) { return json({ error: "upstream" }, 502); }
  const p = d && d[0] && d[0].spreadProfilePrices && d[0].spreadProfilePrices[0];
  const bid = p && +p.bid, ask = p && +p.ask;
  if (!Number.isFinite(bid)) return json({ error: "upstream" }, 502);
  const res = json({ symbol, price: bid, bid, ask, t: (d[0].ts || Date.now()) }, 200, { "cache-control": "public, max-age=" + CACHE_SECONDS });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
