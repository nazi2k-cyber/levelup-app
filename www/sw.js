// LEVEL UP: REBOOT — Service Worker (오프라인 모드 + FCM)
const CACHE_VERSION = 'levelup-v1.0.379';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE = 'storage-images-v1';

// 앱 셸 (App Shell) — 오프라인에서 반드시 필요한 정적 리소스
const APP_SHELL = [
    '/',
    '/app.html',
    '/app.js',
    '/data.js',
    '/style.css',
    '/logger.js',
    '/play_store_512.png',
    '/manifest.json'
];

// Firebase SDK CDN — 캐시할 외부 리소스
const FIREBASE_CDN = [
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js'
];

// --- Firebase Cloud Messaging (기존 firebase-messaging-sw.js 기능 통합) ---
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');
try { importScripts('./firebase-config.js'); } catch (e) {
    console.warn('[SW] firebase-config.js 로드 실패 — FCM 비활성화');
}

const __fbConfig = self.__FIREBASE_CONFIG;
firebase.initializeApp(__fbConfig);

const messaging = firebase.messaging();

// 백그라운드 메시지 처리
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] 백그라운드 메시지 수신:', payload);

    const notificationTitle = payload.notification?.title || 'LEVEL UP: REBOOT';
    const notificationOptions = {
        body: payload.notification?.body || '',
        icon: '/play_store_512.png',
        badge: '/play_store_512.png',
        tag: payload.data?.tag || 'levelup-notification',
        data: payload.data || {},
        actions: [
            { action: 'open', title: '열기' }
        ],
        vibrate: [200, 100, 200]
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// --- Service Worker 라이프사이클 ---

// Install: 앱 셸 프리캐시
self.addEventListener('install', (event) => {
    console.log('[SW] Install — 캐시 버전:', CACHE_VERSION);
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            console.log('[SW] 앱 셸 프리캐시 중...');
            return cache.addAll(APP_SHELL);
        }).then(() => {
            // Firebase SDK CDN도 프리캐시 (실패해도 설치는 계속)
            return caches.open(STATIC_CACHE).then((cache) => {
                return Promise.allSettled(
                    FIREBASE_CDN.map(url => cache.add(url).catch(err => {
                        console.warn('[SW] CDN 캐시 실패 (무시):', url, err.message);
                    }))
                );
            });
        }).then(() => self.skipWaiting())
    );
});

// Activate: 이전 캐시 정리 + 즉시 활성화
self.addEventListener('activate', (event) => {
    console.log('[SW] Activate — 이전 캐시 정리');
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(
                keyList.map((key) => {
                    if (key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== IMAGE_CACHE) {
                        console.log('[SW] 이전 캐시 삭제:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: 캐싱 전략
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // POST 요청이나 WebSocket은 캐싱하지 않음
    if (request.method !== 'GET') return;

    // chrome-extension 등 비표준 스키마 무시
    if (!url.protocol.startsWith('http')) return;

    // Firebase Auth/Firestore API → Network Only (인증/데이터는 항상 최신)
    if (url.hostname.includes('firebaseio.com') ||
        url.hostname === 'firestore.googleapis.com' ||
        url.hostname === 'identitytoolkit.googleapis.com' ||
        url.hostname === 'securetoken.googleapis.com') {
        return;
    }

    // Firebase Storage 이미지 → Cache First (24시간 만료, 최대 150개)
    if (url.hostname.includes('firebasestorage.googleapis.com') ||
        url.hostname.includes('firebasestorage.app')) {
        event.respondWith(storageImageCacheFirst(request));
        return;
    }

    // Google AdMob → 네트워크 전용 (광고는 캐싱 불가)
    if (url.hostname.includes('googleadservices.com') ||
        url.hostname.includes('doubleclick.net')) {
        return;
    }

    // Firebase SDK CDN → Cache First (버전 고정이므로 캐시 우선)
    if (url.hostname === 'www.gstatic.com' && url.pathname.includes('firebasejs')) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // 앱 셸 리소스 (같은 origin) → Stale While Revalidate
    if (url.origin === self.location.origin) {
        // HTML 네비게이션 요청 → Network First (최신 HTML 우선, 오프라인 시 캐시)
        if (request.mode === 'navigate' || request.destination === 'document') {
            event.respondWith(networkFirst(request));
            return;
        }
        // JS/CSS/이미지 → Stale While Revalidate
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    // 기타 외부 리소스 → Network First
    event.respondWith(networkFirst(request));
});

// --- 캐싱 전략 함수 ---

// Cache First: 캐시에 있으면 즉시 반환, 없으면 네트워크
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

// Network First: 네트워크 우선, 실패 시 캐시, 둘 다 없으면 오프라인 폴백
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;

        // HTML 요청이면 오프라인 폴백 (캐시된 app.html)
        if (request.mode === 'navigate' || request.destination === 'document') {
            const fallback = await caches.match('/app.html');
            if (fallback) return fallback;
        }

        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

// Stale While Revalidate: 캐시 즉시 반환 + 백그라운드에서 네트워크 갱신
async function staleWhileRevalidate(request) {
    const cached = await caches.match(request);

    const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
            caches.open(STATIC_CACHE).then((cache) => {
                cache.put(request, response.clone());
            });
        }
        return response;
    }).catch(() => {
        // 네트워크 실패 시 무시 (이미 캐시 반환됨)
        return cached || new Response('Offline', { status: 503 });
    });

    return cached || fetchPromise;
}

// Storage Image Cache First: 캐시 우선 + 24시간 만료 + 최대 150개
const IMAGE_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24시간
const IMAGE_CACHE_MAX_ENTRIES = 150;

async function storageImageCacheFirst(request) {
    const cache = await caches.open(IMAGE_CACHE);
    const cached = await cache.match(request);

    if (cached) {
        const cachedAt = cached.headers.get('sw-cached-at');
        if (cachedAt && (Date.now() - parseInt(cachedAt)) < IMAGE_CACHE_MAX_AGE) {
            return cached;
        }
    }

    try {
        // Capacitor WebView(https://localhost)에서 원본 request 모드로 fetch 시도
        const response = await fetch(request);
        if (response.ok) {
            try {
                const headers = new Headers(response.headers);
                headers.set('sw-cached-at', String(Date.now()));
                const timestamped = new Response(await response.clone().blob(), {
                    status: response.status,
                    headers
                });
                cache.put(request, timestamped);
                trimCache(IMAGE_CACHE, IMAGE_CACHE_MAX_ENTRIES);
            } catch (cacheErr) {
                // 캐시 저장 실패 무시 — 응답은 반환
            }
        }
        return response;
    } catch (err) {
        // 원본 fetch 실패 시, no-cors 모드로 재시도 (CORS 차단 우회)
        try {
            const noCorsResponse = await fetch(request.url, { mode: 'no-cors', credentials: 'omit' });
            return noCorsResponse;
        } catch (noCorsErr) {
            // no-cors도 실패 — 캐시 반환 또는 네트워크 에러 전파
            if (cached) return cached;
            // 503 대신 네트워크 에러를 그대로 전파하여 클라이언트 onerror가 정상 동작하도록 함
            throw err;
        }
    }
}

async function trimCache(cacheName, maxEntries) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
        for (let i = 0; i < keys.length - maxEntries; i++) {
            await cache.delete(keys[i]);
        }
    }
}

// --- 알림 클릭 처리 ---
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] 알림 클릭:', event);
    event.notification.close();

    const data = event.notification.data || {};
    const targetTab = data.tab || '';
    const urlToOpen = '/app.html' + (targetTab ? '#' + targetTab : '');

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('app.html') && 'focus' in client) {
                    client.postMessage({ type: 'NOTIFICATION_CLICK', tab: targetTab, data: data, title: event.notification.title, body: event.notification.body });
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

// --- 오프라인 큐 (Firestore 쓰기 작업 대기열) ---
const OFFLINE_QUEUE_KEY = 'offline-queue';

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    // 클라이언트에서 온라인 복귀 알림 수신
    if (event.data && event.data.type === 'ONLINE_RESTORED') {
        console.log('[SW] 온라인 복귀 감지 — 캐시 갱신 예약');
    }

    // 캐시 버전 조회
    if (event.data && event.data.type === 'GET_CACHE_VERSION') {
        event.ports[0].postMessage({ version: CACHE_VERSION });
    }
});
