// 銀のデータの取り先を試すだけ
const U = {
  swissquote: "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAG/USD",
  yahoo_SI_1m: "https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=1m&range=1d",
  yahoo_XAG_1m: "https://query1.finance.yahoo.com/v8/finance/chart/XAGUSD=X?interval=1m&range=1d",
  yahoo_XAG_1h: "https://query1.finance.yahoo.com/v8/finance/chart/XAGUSD=X?interval=60m&range=60d",
  stooq_5: "https://stooq.com/q/d/l/?s=xagusd&i=5",
  stooq_d: "https://stooq.com/q/d/l/?s=xagusd&i=d",
};
for (const [k, u] of Object.entries(U)) {
  try { const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } }); const t = await r.text();
    let info = t.slice(0, 160).replace(/\s+/g, " ");
    try { const j = JSON.parse(t); const res = j.chart && j.chart.result && j.chart.result[0]; if (res) { const q = res.indicators.quote[0]; info = `本数${res.timestamp.length} 最後${q.close.filter(x=>x!=null).slice(-1)[0]} meta価格${res.meta.regularMarketPrice}`; } } catch {}
    console.log("結果", k, r.status, info);
  } catch (e) { console.log("結果", k, "エラー", e.message); }
}
