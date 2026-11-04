// 通知を受け取る係（ホーム画面に追加したアプリで動く）
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "金銀シグナル検証", { body: d.body || "", tag: d.tag || "signal", icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "/" } });
    try { if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(1); } catch (_) {}
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ("focus" in w) return w.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "/");
  }));
});
