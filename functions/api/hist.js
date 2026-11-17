// 検証用の過去データの中継役（クラウドフレアのページ機能）
// /api/hist?s=GC=F&i=60m&r=730d → ヤフーファイナンスの足（時刻・始値・高値・安値・終値）
// ・決めた銘柄・足・期間だけ。1時間ためておく。価格を読むだけ。注文に関わる処理はありません
const SYMS = new Set(["SI=F", "GC=F", "HG=F", "PL=F", "CL=F", "DX-Y.NYB", "JPY=X", "EURUSD=X", "^TNX",
  "AUDUSD=X", "CNH=X", "MXN=X", "INR=X", "PEN=X", "CLP=X", "000001.SS", "^NSEI"]);
const OK = { "5m": ["1d", "5d", "60d"], "60m": ["60d", "730d"], "1d": ["1y", "5y", "10y"] };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export async function onRequestGet({ request, waitUntil }) {
  const q = new URL(request.url).searchParams;
  const s = q.get("s") || "", i = q.get("i") || "60m", r = q.get("r") || "730d";
  if (!SYMS.has(s) || !OK[i] || !OK[i].includes(r)) return json({ error: "bad_request" }, 400);
  const cache = caches.default;
  const cacheKey = new Request(`https://signal-cache.internal/hist1/${encodeURIComponent(s)}/${i}/${r}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  let j;
  try { j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=${i}&range=${r}`, { headers: { "user-agent": "Mozilla/5.0" } })).json(); }
  catch (e) { return json({ error: "upstream" }, 502); }
  const res0 = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res0 || !res0.timestamp) return json({ error: "upstream" }, 502);
  const qt = res0.indicators.quote[0];
  const values = res0.timestamp.map((t, k) => [t * 1000, qt.open[k], qt.high[k], qt.low[k], qt.close[k]]).filter(v => v.every(x => x != null && Number.isFinite(+x)));
  const res = json({ s, i, r, values }, 200, { "cache-control": "public, max-age=3600" });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
