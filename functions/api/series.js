// 足のデータを返す中継役（クラウドフレアのページ機能）
// アプリ → /api/series?symbol=XAG/USD&interval=1min|1h|1day → ツエルブデータ
// ・キーはクラウドフレアの秘密の設定 TWELVEDATA_API_KEY にだけ置き、アプリには渡さない
// ・同じ内容をしばらくためておき、無料の回数（1日800回・1分8回）を守る
// ・価格を読むだけ。注文に関わる処理はありません
const ALLOWED = new Set(["XAG/USD", "XAU/USD", "USD/JPY"]);
const INTERVALS = { "1min": [500, 60], "1h": [500, 600], "1day": [300, 3600] }; // [本数, ためておく秒数]
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export async function onRequestGet({ request, env, waitUntil }) {
  const q = new URL(request.url).searchParams;
  const symbol = q.get("symbol") || "", interval = q.get("interval") || "1h";
  if (!ALLOWED.has(symbol)) return json({ error: "bad_symbol" }, 400);
  if (!INTERVALS[interval]) return json({ error: "bad_interval" }, 400);
  const apiKey = String(env.TWELVEDATA_API_KEY || "").replace(/[^A-Za-z0-9]/g, "");
  if (!apiKey) return json({ error: "no_key" }, 500);
  const [size, ttl] = INTERVALS[interval];
  const cache = caches.default;
  const cacheKey = new Request("https://signal-cache.internal/series/" + interval + "/" + encodeURIComponent(symbol));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  let data;
  try { data = await (await fetch("https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(symbol) + "&interval=" + interval + "&outputsize=" + size + "&timezone=UTC&order=asc&apikey=" + apiKey)).json(); }
  catch (e) { return json({ error: "upstream" }, 502); }
  if (!data || data.status !== "ok" || !Array.isArray(data.values)) return json({ error: "upstream", code: data && data.code }, 502);
  const values = data.values.map(v => [Date.parse(v.datetime.replace(" ", "T") + "Z"), +v.open, +v.high, +v.low, +v.close]).filter(v => v.every(Number.isFinite));
  const res = json({ symbol, interval, fetchedAt: Date.now(), values }, 200, { "cache-control": "public, max-age=" + ttl });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
