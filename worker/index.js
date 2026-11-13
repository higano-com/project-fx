// 見張り役は停止しました（2026/11/13、利用者の希望でアプリを削除）。判断・練習・通知はしません
export class Store {
  constructor(state) { this.s = state.storage; }
  async fetch() { return new Response("停止しました", { status: 410 }); }
}
export default {
  async scheduled() {},
  async fetch() { return new Response(JSON.stringify({ 結果: "停止しました" }), { status: 410, headers: { "content-type": "application/json; charset=utf-8" } }); },
};
