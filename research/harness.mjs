// 検証用の土台：アプリ（app/index.html）と同じ計算を Node で動かす
// 画面の部分は空の偽物に置き換え、判断・資金管理・過去検証の関数をそのまま使う
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const code = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/\nboot\(\);\s*$/, "\n");

const fake = () => new Proxy(function(){}, { get: (t, k) => k === Symbol.toPrimitive ? () => "" : fake(), apply: () => fake(), set: () => true });
const ctx = {
  console, Intl, Date, Math, JSON, Map, Set, Float64Array, Uint8Array, Array, Object, Number, String, Promise, setTimeout, clearTimeout, setInterval: () => 0,
  document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: fake, body: fake(), documentElement: fake(), fonts: null, hidden: false },
  window: { addEventListener() {}, devicePixelRatio: 1, scrollTo() {} },
  localStorage: { getItem: () => null, setItem() {} },
  matchMedia: () => ({ addEventListener() {} }),
  MutationObserver: class { observe() {} },
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  fetch: async () => { throw new Error("offline"); },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(code + "\n;globalThis.__api={get S(){return S}, set S(v){S=v}, get DATA(){return DATA}, set DATA(v){DATA=v}, set MODE(v){MODE=v}, get MODE(){return MODE}, set TOTAL(v){TOTAL=v}, get TOTAL(){return TOTAL}, CACHE, WARMUP, GRID, signalAt, levels, sizeFor, riskBlocks, backtest, stats, newAcct, mergeCfg, gmoOpen, runValidation, initState};", ctx);
export const app = ctx.__api;

export function loadCsv(path) {
  const lines = readFileSync(path, "utf8").trim().split("\n").slice(1);
  return lines.map(l => { const [t, o, h, lo, c] = l.split(","); return [Date.parse(t.replace(" ", "T") + ":00Z"), +o, +h, +lo, +c]; });
}
// 金・ドル円の配列をアプリの DATA の形にする（銀なし）
export function setData(xau, jpy, from = 0, to = xau.length) {
  const g = xau.slice(from, to), n = g.length;
  const mk = () => ({ t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) });
  const gold = mk(), fx = new Float64Array(n);
  let k = 0, last = jpy[0][4];
  for (let i = 0; i < n; i++) {
    const r = g[i]; gold.t[i] = r[0]; gold.o[i] = r[1]; gold.h[i] = r[2]; gold.l[i] = r[3]; gold.c[i] = r[4];
    while (k < jpy.length && jpy[k][0] <= r[0]) { last = jpy[k][4]; k++; }
    fx[i] = last;
  }
  app.MODE = "live"; app.DATA = { gold, silver: null, fx }; app.TOTAL = n;
  for (const key in app.CACHE) delete app.CACHE[key];
  app.initState();
  return n;
}
