/* 오늘 어디가? — 서비스워커
 * - BUILD 값은 GitHub Actions 배포 때 커밋 해시로 자동 교체됩니다 (.github/workflows/pages.yml).
 * - 전략: 네트워크 우선(항상 최신) → 실패하면 캐시(오프라인). 그래서 data.js를 고쳐 올리면
 *   설치된 앱도 다음 실행 때 자동으로 새 내용을 받아옵니다.
 * - BUILD가 바뀌면 새 서비스워커가 즉시 활성화되고 앱이 "새 버전" 안내를 띄웁니다.
 */
const BUILD = '__BUILD__';
const CACHE = 'wtg-' + BUILD;
const CORE = [
  './', './index.html', './style.css', './app.js', './data.js',
  './manifest.webmanifest', './privacy.html',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png'
];
const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('wtg-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () =>
      caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'));

    const timer = setTimeout(() => {
      fromCache().then((hit) => { if (hit && !settled) { settled = true; resolve(hit); } });
    }, NETWORK_TIMEOUT);

    fetch(request, { cache: 'no-cache' })
      .then((res) => {
        clearTimeout(timer);
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        if (!settled) { settled = true; resolve(res); }
      })
      .catch(() => {
        clearTimeout(timer);
        if (settled) return;
        fromCache().then((hit) => { settled = true; resolve(hit || Response.error()); });
      });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // 지도 링크 등 외부 요청은 건드리지 않음
  if (url.pathname.indexOf('/.well-known/') !== -1) return;  // TWA 검증 파일은 항상 원본
  event.respondWith(networkFirst(req));
});
