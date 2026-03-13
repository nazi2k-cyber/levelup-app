// Firebase Cloud Messaging Service Worker
// 백그라운드 푸시 알림 처리

importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyDxNjHzj7ybZNLhG-EcbA5HKp9Sg4QhAno",
    authDomain: "levelup-app-53d02.firebaseapp.com",
    projectId: "levelup-app-53d02",
    storageBucket: "levelup-app-53d02.firebasestorage.app",
    messagingSenderId: "233040099152",
    appId: "1:233040099152:web:82310514d26c8c6d52de55"
});

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

// 알림 클릭 처리
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] 알림 클릭:', event);
    event.notification.close();

    const targetTab = event.notification.data?.tab || '';
    const urlToOpen = '/app.html' + (targetTab ? '#' + targetTab : '');

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // 이미 열린 창이 있으면 포커스
            for (const client of clientList) {
                if (client.url.includes('app.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            // 열린 창이 없으면 새 창 열기
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
