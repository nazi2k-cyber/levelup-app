import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, enableNetwork, disableNetwork } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
import { getMessaging } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js';
import { getRemoteConfig } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-remote-config.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app-check.js';
import { NetworkMonitor } from '../network-monitor.js';
import { init as initConversionTracker } from '../conversion-tracker.js';
import { PerformanceMonitor } from '../performance-monitor.js';

export function bootstrapCoreServices(firebaseConfig) {
    const app = initializeApp(firebaseConfig);

    if (firebaseConfig.appCheckDebugToken) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = firebaseConfig.appCheckDebugToken;
    }

    const isNativePlatform = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    if (!isNativePlatform && firebaseConfig.appCheckSiteKey) {
        try {
            initializeAppCheck(app, {
                provider: new ReCaptchaV3Provider(firebaseConfig.appCheckSiteKey),
                isTokenAutoRefreshEnabled: true,
            });
        } catch (e) {
            console.warn('[AppCheck] 초기화 스킵:', e.message);
        }
    }

    NetworkMonitor.init(firebaseConfig.apiKey);

    const auth = getAuth(app);
    const db = initializeFirestore(app, {
        ...(isNativePlatform ? { experimentalForceLongPolling: true } : { experimentalAutoDetectLongPolling: true }),
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });

    const storage = getStorage(app);
    const functionRegions = ['asia-northeast3', 'asia-northeast1'];
    const functions = getFunctions(app, functionRegions[0]);
    const functionsByRegion = Object.fromEntries(functionRegions.map((region) => [region, getFunctions(app, region)]));

    let analytics = null;
    try {
        analytics = getAnalytics(app);
    } catch (e) {
        console.warn('[Analytics] 초기화 스킵:', e.message);
    }

    let remoteConfig = null;
    try {
        remoteConfig = getRemoteConfig(app);
        remoteConfig.settings.minimumFetchIntervalMillis = 3600000;
        remoteConfig.defaultConfig = {
            onboarding_variant: 'compact',
            login_layout: 'social_first',
        };
    } catch (e) {
        console.warn('[RemoteConfig] 초기화 스킵:', e.message);
    }

    initConversionTracker({ analytics, remoteConfig, auth, db });
    if (analytics) PerformanceMonitor.init(analytics);

    let messaging = null;
    try {
        if (!isNativePlatform) {
            messaging = getMessaging(app);
        }
    } catch (e) {
        console.warn('[FCM] Messaging 초기화 스킵:', e.message);
    }

    return { app, auth, db, storage, functions, functionsByRegion, functionRegions, analytics, remoteConfig, messaging, isNativePlatform };
}

export function attachFirestoreNetworkResilience(db) {
    window.addEventListener('online', () => {
        console.log('[Firestore] 네트워크 복구 감지 — enableNetwork 호출');
        enableNetwork(db).catch((e) => console.warn('[Firestore] enableNetwork 실패:', e.message));
    });

    window.addEventListener('offline', () => {
        console.log('[Firestore] 오프라인 전환 감지 — disableNetwork 호출');
        disableNetwork(db).catch((e) => console.warn('[Firestore] disableNetwork 실패:', e.message));
    });
}
