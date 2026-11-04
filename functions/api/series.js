// 価格の中継役（Cloudflare Pages Functions）
// アプリ → /api/series?symbol=XAU/USD → Twelve Data
// ・APIキーはここ（Cloudflare の秘密の設定 TWELVEDATA_API_KEY）にだけ置き、アプリには渡しません。
// ・同じ内容を10分間ためておき、Twelve Data への問い合わせ回数（無料枠）を節約します。
// ・価格を読むだけです。注文に関わる処理はありません。

const ALLOWED = new Set(["XAU/USD", "XAG/USD", "USD/JPY"]);
const CACHE_SECONDS = 1800;
// 足の長さ：1時間足（判断用）、1日足（日足・週足・月足のチャート用）、1分足（3分足のチャート用）
const INTERVALS = { "1h": 1800, "1day": 21600, "1min": 180 };   // ためておく秒数   // 1時間ごとの値動きは30分ためる（今の価格は /api/price で短い間隔で取る）

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export async function onRequestGet({ request, env, waitUntil }) {
  const symbol = new URL(request.url).searchParams.get("symbol") || "";
  if (!ALLOWED.has(symbol)) return json({ error: "bad_symbol" }, 400);
  const interval = new URL(request.url).searchParams.get("interval") || "1h";
  if (!INTERVALS[interval]) return json({ error: "bad_interval" }, 400);
  // 貼り付け時に紛れ込みやすい空白・改行・見えない文字を取り除く（キーは英数字だけ）
  const apiKey = String(env.TWELVEDATA_API_KEY || "").replace(/[^A-Za-z0-9]/g, "");
  if (!apiKey) return json({ error: "no_key" }, 500);

  const cache = caches.default;
  const cacheKey = new Request("https://pfx-cache.internal/series/" + interval + "/" + encodeURIComponent(symbol));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const api = "https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(symbol) +
    "&interval=" + interval + "&outputsize=5000&timezone=UTC&order=asc&apikey=" + apiKey;
  let data;
  try {
    const r = await fetch(api);
    data = await r.json();
  } catch (e) {
    return json({ error: "upstream", message: "Twelve Data に接続できませんでした" }, 502);
  }
  if (!data || data.status !== "ok" || !Array.isArray(data.values)) {
    const msg = String((data && data.message) || "").split(apiKey).join("***");
    // キーが合っているか確かめる手がかり：文字数と、キーから作った短い識別番号（SHA-256 の先頭8文字。キーは逆算できない）
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey)));
    const keyId = Array.from(digest.slice(0, 4), b => b.toString(16).padStart(2, "0")).join("");
    return json({ error: "upstream", code: data && data.code, message: msg, keyLength: apiKey.length, keyId }, 502);
  }

  const values = data.values
    .map(v => [Date.parse(v.datetime.replace(" ", "T") + "Z"), +v.open, +v.high, +v.low, +v.close])
    .filter(v => v.every(Number.isFinite));
  const res = json({ symbol, fetchedAt: Date.now(), values }, 200, { "cache-control": "public, max-age=" + INTERVALS[interval] });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
