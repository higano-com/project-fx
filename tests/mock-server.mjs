// テスト用の偽の中継役：研究用の本物のデータ（data/）を、アプリの中継役と同じ形で返す
import http from "node:http";
import { readFileSync } from "node:fs";
const load = f => readFileSync(f, "utf8").trim().split("\n").slice(1).map(l => { const [t, o, h, lo, c] = l.split(","); return [Date.parse(t.replace(" ", "T") + ":00Z"), +o, +h, +lo, +c]; });
export function startMock(port, dist) {
  const S = { "XAU/USD": load("data/xau_usd_1h.csv").slice(-5000), "USD/JPY": load("data/usd_jpy_1h.csv").slice(-5000) };
  let tick = 0;
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x");
    if (u.pathname === "/api/price") { tick++; r.writeHead(200, { "content-type": "application/json" }); return r.end(JSON.stringify({ price: S["XAU/USD"].at(-1)[4] + tick, t: Date.now() })); }
    if (u.pathname === "/api/series" && u.searchParams.get("interval") === "1day") {   // 1時間足から日足を作る
      const d = []; for (const r0 of S["XAU/USD"]) { const k = Math.floor(r0[0] / 86400e3) * 86400e3, L = d[d.length - 1]; if (!L || L[0] !== k) d.push([k, r0[1], r0[2], r0[3], r0[4]]); else { L[2] = Math.max(L[2], r0[2]); L[3] = Math.min(L[3], r0[3]); L[4] = r0[4]; } }
      r.writeHead(200, { "content-type": "application/json" }); return r.end(JSON.stringify({ values: d }));
    }
    if (u.pathname === "/api/series" && u.searchParams.get("interval") === "1min") {   // 最後の80本の1時間足を1分ずつに分ける
      const m = []; for (const r0 of S["XAU/USD"].slice(-80)) for (let k = 0; k < 60; k++) { const p0 = r0[1] + (r0[4] - r0[1]) * k / 60, p1 = r0[1] + (r0[4] - r0[1]) * (k + 1) / 60; m.push([r0[0] + k * 60e3, p0, Math.max(p0, p1) + 0.3, Math.min(p0, p1) - 0.3, p1]); }
      r.writeHead(200, { "content-type": "application/json" }); return r.end(JSON.stringify({ values: m }));
    }
    if (u.pathname === "/api/series") { const v = S[u.searchParams.get("symbol")]; r.writeHead(v ? 200 : 502, { "content-type": "application/json" }); return r.end(JSON.stringify(v ? { values: v } : { error: "upstream", code: 404, message: "This symbol is available starting with the Grow plan" })); }
    const f = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
    try { r.writeHead(200); r.end(readFileSync(dist + "/" + f)); } catch (e) { r.writeHead(404); r.end(); }
  });
  return new Promise(ok => srv.listen(port, () => ok(srv)));
}
