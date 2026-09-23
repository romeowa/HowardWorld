// 여행 일정 서비스워커 — 앱 셸 오프라인 캐시
// 버전을 올리면 activate에서 옛 캐시를 비우고 새 셸을 받는다.
const VERSION = "v3";
const CACHE = `trip-shell-${VERSION}`;

// 버전 없는 셸만 미리 캐시. 버전 붙는 app.js/styles.css는 실행 중 전체 URL로 캐시돼
// ?v= 를 올리면 자연히 새로 받는다(구버전 캐시 히트 방지).
const CORE = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// 같은 출처 GET만 처리. Firestore·구글맵·검색 등 외부 요청은 건드리지 않음(그대로 네트워크).
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com";

  if (!sameOrigin && !isFont) return; // 외부 API는 패스

  // 페이지 이동(네비게이션): 네트워크 우선, 실패 시 캐시된 index.html
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // 정적 자원: stale-while-revalidate, 전체 URL(쿼리 포함)로 캐시 → ?v= 바뀌면 새로 받음
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
