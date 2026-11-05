// 利確を「入った価格から10ドル」に固定したら、成績はどうなるか（損切りは今のまま）
import { loadCsv, prepare, STRATEGIES } from "./engine.mjs";
import { FILTERS, compose } from "./filters.mjs";
import { report } from "./rolling.mjs";
const B = prepare(loadCsv("data/xau_usd_1h.csv"), loadCsv("data/usd_jpy_1h.csv"));
FILTERS.bigBar = { opts: [0, 0.6, 1.0], fn: (B, i, s, v) => !v || Math.abs(B.c[i] - B.o[i]) > v * B.atr[i] };
const I = STRATEGIES.ichimoku;
const fixedTP = usd => ({ grid: I.grid, fn(B, i, p) { const s = I.fn(B, i, p); if (!s) return null; return { ...s, rr: usd / s.stop }; } });
const fixedBoth = (tp, sl) => ({ grid: I.grid, fn(B, i, p) { const s = I.fn(B, i, p); if (!s) return null; return { ...s, stop: sl, rr: tp / sl }; } });
console.log("1回2,500円・見直しの日を4通りずらした平均");
report(B, "今のルール", compose(I, { bigBar: 0.6 }, ["minStop", "daily"]));
report(B, "利確を10ドルに固定", compose(fixedTP(10), { bigBar: 0.6 }, ["minStop", "daily"]));
report(B, "利確を30ドルに固定", compose(fixedTP(30), { bigBar: 0.6 }, ["minStop", "daily"]));
report(B, "利確10ドル・損切り10ドル", compose(fixedBoth(10, 10), { bigBar: 0.6 }, ["daily"]));
report(B, "利確10ドル・損切り5ドル", compose(fixedBoth(10, 5), { bigBar: 0.6 }, ["daily"]));
