// 絞り込みの候補と、判断ルールへの組み込み（lab.mjs・recency.mjs で共通）
/* 絞り込みの候補 */
const utcH = t => new Date(t).getUTCHours(), jstWd = t => new Date(t + 9 * 3600e3).getUTCDay();
export const FILTERS = {
  minStop:    { name: "損切り幅が小さすぎたら見送る（ドル）", opts: [0, 6, 10, 15], fn: (B, i, s, v) => s.stop >= v },
  adx:        { name: "トレンドの強さが弱いと見送る", opts: [0, 20, 25, 30], fn: (B, i, s, v) => B.adx[i] >= v },
  session:    { name: "時間帯", opts: ["全部", "東京を除く", "夜と早朝を除く", "ロンドンとニューヨークだけ"], fn: (B, i, s, v) => { const h = utcH(B.t[i]); return v === "全部" || (v === "東京を除く" && !(h <= 6)) || (v === "夜と早朝を除く" && h < 21) || (v === "ロンドンとニューヨークだけ" && h >= 7 && h <= 20); } },
  weekday:    { name: "曜日", opts: ["全部", "月曜を除く", "金曜を除く"], fn: (B, i, s, v) => { const w = jstWd(B.t[i]); return v === "全部" || (v === "月曜を除く" && w !== 1) || (v === "金曜を除く" && w !== 5); } },
  daily:      { name: "日足の流れと同じ向きだけ", opts: [0, 1], fn: (B, i, s, v) => !v || ((B.ema(460)[i] > B.ema(460)[i - 115]) === (s.dir === 1)) },
  macdAgree:  { name: "移動平均の収束と拡散が同じ向きだけ", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.macd[i] > B.macdSig[i] : B.macd[i] < B.macdSig[i]) },
  rsiBand:    { name: "相対力指数が行き過ぎていない", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.rsi[i] <= 70 : B.rsi[i] >= 30) },
  stochOk:    { name: "ストキャスティクスが行き過ぎていない", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.stK[i] < 80 : B.stK[i] > 20) },
  squeeze:    { name: "ボリンジャーバンドが縮んだあとだけ", opts: [0, 1], fn: (B, i, s, v) => !v || B.bbWidth[i - 1] < B.bbWidthAvg[i - 1] },
  cloud:      { name: "一目均衡表の雲と同じ側だけ", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.c[i] > B.cloudTop[i] : B.c[i] < B.cloudBot[i]) },
  cciAgree:   { name: "商品チャネル指数が同じ向きだけ", opts: [0, 1], fn: (B, i, s, v) => !v || (s.dir === 1 ? B.cci[i] > 0 : B.cci[i] < 0) },
  calm:       { name: "荒れすぎていたら見送る", opts: [0, 2, 1.5], fn: (B, i, s, v) => !v || B.atr[i] / B.atrAvg[i] < v },
};

/* 判断ルール＋絞り込みを1つの判断ルールにまとめる。fixed：決めうちの絞り込み、tuned：調整で選ぶ絞り込み */
export function compose(base, fixed = {}, tuned = []) {
  const grid = { ...base.grid }; for (const k of tuned) grid["f_" + k] = FILTERS[k].opts;
  return {
    grid,
    fn(B, i, p) {
      const s = base.fn(B, i, p); if (!s) return null;
      for (const [k, v] of Object.entries(fixed)) if (!FILTERS[k].fn(B, i, s, v)) return null;
      for (const k of tuned) if (!FILTERS[k].fn(B, i, s, p["f_" + k])) return null;
      return s;
    }
  };
}

