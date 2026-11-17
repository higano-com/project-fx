// 足のデータを返す中継役（クラウドフレアのページ機能）
// アプリ → /api/series?symbol=XAG/USD&interval=1min|1h|1day → ヤフーファイナンスの銀先物（SI=F）の足
// ・現物とは少しずれる（先物の上乗せ分）ので、アプリ側で今の現物の値段に合わせて補正する
// ・しばらくためておく。価格を読むだけ。注文に関わる処理はありません
const IV = { "1min": ["1m", "1d", 60], "1h": ["60m", "60d", 600], "1day": ["1d", "1y", 3600] };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export async function onRequestGet({ request, waitUntil }) {
  const q = new URL(request.url).searchParams;
  if ((q.get("symbol") || "") !== "XAG/USD") return json({ error: "bad_symbol" }, 400);
  const iv = IV[q.get("interval") || "1h"];
  if (!iv) return json({ error: "bad_interval" }, 400);
  const cache = caches.default;
  const cacheKey = new Request("https://signal-cache.internal/series2/" + iv[0]);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  let j;
  try { j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=${iv[0]}&range=${iv[1]}`, { headers: { "user-agent": "Mozilla/5.0" } })).json(); }
  catch (e) { return json({ error: "upstream" }, 502); }
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) return json({ error: "upstream" }, 502);
  const qt = r.indicators.quote[0];
  const values = r.timestamp.map((t, i) => [t * 1000, qt.open[i], qt.high[i], qt.low[i], qt.close[i]]).filter(v => v.every(x => x != null && Number.isFinite(+x)));
  const res = json({ symbol: "XAG/USD", source: "SI=F", fetchedAt: Date.now(), values }, 200, { "cache-control": "public, max-age=" + iv[2] });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
