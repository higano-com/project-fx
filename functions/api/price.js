// 今の価格だけを返す中継役（Cloudflare Pages Functions）
// アプリ → /api/price?symbol=XAU/USD → Twelve Data /price
// ・150秒間ためておき、無料の回数（1日800回）を守る
// ・価格を読むだけ。注文に関わる処理はありません
const ALLOWED = new Set(["XAU/USD", "XAG/USD"]);
const CACHE_SECONDS = 150;
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export async function onRequestGet({ request, env, waitUntil }) {
  const symbol = new URL(request.url).searchParams.get("symbol") || "";
  if (!ALLOWED.has(symbol)) return json({ error: "bad_symbol" }, 400);
  const apiKey = String(env.TWELVEDATA_API_KEY || "").replace(/[^A-Za-z0-9]/g, "");
  if (!apiKey) return json({ error: "no_key" }, 500);
  const cache = caches.default;
  const cacheKey = new Request("https://pfx-cache.internal/price/" + encodeURIComponent(symbol));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  let data;
  try { data = await (await fetch("https://api.twelvedata.com/price?symbol=" + encodeURIComponent(symbol) + "&apikey=" + apiKey)).json(); }
  catch (e) { return json({ error: "upstream" }, 502); }
  const price = data && +data.price;
  if (!Number.isFinite(price)) return json({ error: "upstream", code: data && data.code }, 502);
  const res = json({ symbol, price, t: Date.now() }, 200, { "cache-control": "public, max-age=" + CACHE_SECONDS });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
