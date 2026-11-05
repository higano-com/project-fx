// ツエルブデータの無料プランで、原油などの価格が取れるか確かめる（読むだけ。鍵は表示しない）
const KEY = String(process.env.TWELVEDATA_API_KEY || "").replace(/[^A-Za-z0-9]/g, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
// 1) 商品の一覧から、原油らしいものを探す
try {
  const j = await (await fetch("https://api.twelvedata.com/commodities")).json();
  const list = (j.data || []).filter(x => /oil|crude|wti|brent/i.test(x.symbol + " " + x.name));
  out.push("■ 商品の一覧で見つかった原油：" + (list.map(x => `${x.symbol}（${x.name}）`).join("、") || "なし"));
} catch (e) { out.push("■ 商品の一覧を読めなかった"); }
// 2) 候補の記号で、1時間足を5本だけ取ってみる
for (const s of ["WTI/USD", "BRENT/USD", "XBR/USD", "XTI/USD", "CL1", "USOIL", "XAU/USD"]) {
  const j = await (await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(s)}&interval=1h&outputsize=5&apikey=${KEY}`)).json().catch(() => null);
  const ok = j && j.status === "ok" && Array.isArray(j.values);
  out.push(`■ ${s}：${ok ? "取れた（最新 " + j.values[0].datetime + " 終値 " + j.values[0].close + "）" : "取れない（" + String((j && j.message) || "応答なし").split(KEY).join("***").slice(0, 160) + "）"}`);
  await sleep(9000);
}
console.log(out.join("\n"));
