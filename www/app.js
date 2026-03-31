// --- Firebase SDK 초기화 ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithCredential, sendEmailVerification, sendPasswordResetEmail, getIdTokenResult } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, where, updateDoc, arrayUnion, arrayRemove, enableNetwork, disableNetwork } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";
import { getStorage, ref, uploadBytesResumable, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { getRemoteConfig, fetchAndActivate, getValue, getString } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-remote-config.js";
import { getAnalytics, logEvent as fbLogEvent } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyDxNjHzj7ybZNLhG-EcbA5HKp9Sg4QhAno",
    authDomain: "levelup-app-53d02.firebaseapp.com",
    projectId: "levelup-app-53d02",
    storageBucket: "levelup-app-53d02.firebasestorage.app",
    messagingSenderId: "233040099152",
    appId: "1:233040099152:web:82310514d26c8c6d52de55",
    measurementId: "G-4DBGG03CCJ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const isNativePlatform = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
const db = initializeFirestore(app, {
    ...(isNativePlatform
        ? { experimentalForceLongPolling: true }
        : { experimentalAutoDetectLongPolling: true }),
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const storage = getStorage(app);
const functions = getFunctions(app, "asia-northeast3");

// --- Firebase Analytics ---
let analytics = null;
try {
    analytics = getAnalytics(app);
} catch (e) {
    console.warn('[Analytics] 초기화 스킵:', e.message);
}

// --- Firebase Remote Config (A/B 테스트 인프라) ---
let remoteConfig = null;
try {
    remoteConfig = getRemoteConfig(app);
    remoteConfig.settings.minimumFetchIntervalMillis = 3600000; // 1시간
    remoteConfig.defaultConfig = {
        onboarding_variant: 'compact',    // 'legacy' (5단계) | 'compact' (3단계)
        login_layout: 'social_first',     // 'social_first' | 'email_first'
    };
} catch (e) {
    console.warn('[RemoteConfig] 초기화 스킵:', e.message);
}

// --- 전환율 계측 (Conversion Funnel Tracking) ---
const ConversionTracker = (() => {
    const STORAGE_KEY = 'levelup_funnel';

    function _getSession() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }
    function _setSession(data) {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
    }

    // 퍼널 이벤트 기록
    function track(eventName, params = {}) {
        const session = _getSession();
        if (session[eventName]) return; // 중복 방지
        session[eventName] = Date.now();
        _setSession(session);

        const payload = {
            ...params,
            onboarding_variant: _getVariant('onboarding_variant'),
            login_layout: _getVariant('login_layout'),
            timestamp: new Date().toISOString(),
        };

        // Firebase Analytics 로깅
        if (analytics) {
            try { fbLogEvent(analytics, eventName, payload); } catch {}
        }

        // Firestore 퍼널 로그 (선택적)
        if (window._funnelLogEnabled && auth.currentUser) {
            const logRef = doc(db, 'funnel_events', `${auth.currentUser.uid}_${eventName}_${Date.now()}`);
            setDoc(logRef, { uid: auth.currentUser.uid, event: eventName, ...payload }).catch(() => {});
        }

        if (window.AppLogger) AppLogger.info(`[Funnel] ${eventName} ` + JSON.stringify(payload));
    }

    function _getVariant(key) {
        try {
            return remoteConfig ? getString(remoteConfig, key) : (remoteConfig?.defaultConfig?.[key] || 'unknown');
        } catch { return 'unknown'; }
    }

    // 퍼널 단계 정의
    return {
        track,
        // Phase 2 핵심 퍼널 이벤트
        screenView:       ()    => track('funnel_screen_view'),
        loginStart:       (method) => track('funnel_login_start', { method }),
        loginComplete:    (method) => track('funnel_login_complete', { method }),
        signupStart:      (method) => track('funnel_signup_start', { method }),
        signupComplete:   (method) => track('funnel_signup_complete', { method }),
        emailVerified:    ()    => track('funnel_email_verified'),
        onboardingStart:  ()    => track('funnel_onboarding_start'),
        onboardingStep:   (step) => track(`funnel_onboarding_step_${step}`, { step }),
        onboardingDone:   ()    => track('funnel_onboarding_done'),
        firstSession:     ()    => track('funnel_first_session'),
        d1Return:         ()    => track('funnel_d1_return'),
    };
})();

// Remote Config 가져오기 (비동기)
async function initRemoteConfig() {
    if (!remoteConfig) return;
    try {
        await fetchAndActivate(remoteConfig);
        if (window.AppLogger) AppLogger.info('[RemoteConfig] fetch & activate 완료');
    } catch (e) {
        console.warn('[RemoteConfig] fetch 실패 (기본값 사용):', e.message);
    }
}

// A/B 테스트 변형 값 가져오기
function getExperimentVariant(key) {
    if (!remoteConfig) {
        // Remote Config 사용 불가 시 기본값 반환
        const defaults = { onboarding_variant: 'compact', login_layout: 'social_first' };
        return defaults[key] || '';
    }
    try { return getString(remoteConfig, key); } catch { return ''; }
}

// --- Firestore 네트워크 복원력 ---
// 오프라인→온라인 전환 시 Firestore 네트워크 재연결 (WebChannel 오류 복구)
window.addEventListener('online', () => {
    console.log('[Firestore] 네트워크 복구 감지 — enableNetwork 호출');
    enableNetwork(db).catch(e => console.warn('[Firestore] enableNetwork 실패:', e.message));
});
window.addEventListener('offline', () => {
    console.log('[Firestore] 오프라인 전환 감지 — disableNetwork 호출');
    disableNetwork(db).catch(e => console.warn('[Firestore] disableNetwork 실패:', e.message));
});

// Firebase Cloud Messaging 초기화 (웹 환경에서만)
let messaging = null;
try {
    if (!isNativePlatform) {
        messaging = getMessaging(app);
    }
} catch (e) {
    console.warn('[FCM] Messaging 초기화 스킵:', e.message);
}

// --- 프로필 이미지 기본값 & 안전한 로드 ---
const DEFAULT_PROFILE_SVG = "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27%23555%27%3E%3Cpath d=%27M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%27/%3E%3C/svg%3E";

// --- Firebase Storage 이미지 로드 헬퍼 (WebView fetch+blob 폴백) ---
const _blobUrlCache = new Map();
const _BLOB_CACHE_MAX = 100;

async function _fetchAsBlobUrl(url) {
    const cached = _blobUrlCache.get(url);
    if (cached) return cached;
    try {
        const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!resp.ok) return null;
        const blob = await resp.blob();
        if (!blob || blob.size === 0) return null;
        const blobUrl = URL.createObjectURL(blob);
        if (_blobUrlCache.size >= _BLOB_CACHE_MAX) {
            const firstKey = _blobUrlCache.keys().next().value;
            URL.revokeObjectURL(_blobUrlCache.get(firstKey));
            _blobUrlCache.delete(firstKey);
        }
        _blobUrlCache.set(url, blobUrl);
        return blobUrl;
    } catch (e) {
        return null;
    }
}

// 글로벌 함수: innerHTML onerror에서 호출 가능
// fallbackSrc: 실패 시 대체 이미지 (없으면 숨김)
// hideAndShowNext: true면 실패 시 img 숨기고 nextElementSibling 표시
window._retryFirebaseImg = function(imgEl, originalUrl, fallbackSrc, hideAndShowNext) {
    _fetchAsBlobUrl(originalUrl).then(blobUrl => {
        if (blobUrl) { imgEl.src = blobUrl; }
        else if (fallbackSrc) { imgEl.src = fallbackSrc; }
        else if (hideAndShowNext) { imgEl.style.display = 'none'; if (imgEl.nextElementSibling) imgEl.nextElementSibling.style.display = ''; }
        else { imgEl.style.display = 'none'; }
    }).catch(() => {
        if (fallbackSrc) imgEl.src = fallbackSrc;
        else if (hideAndShowNext) { imgEl.style.display = 'none'; if (imgEl.nextElementSibling) imgEl.nextElementSibling.style.display = ''; }
        else imgEl.style.display = 'none';
    });
};

function setProfilePreview(url) {
    const el = document.getElementById('profilePreview');
    if (!el) return;
    if (!url || url === DEFAULT_PROFILE_SVG) { el.src = url || DEFAULT_PROFILE_SVG; return; }
    const cached = _blobUrlCache.get(url);
    if (cached) { el.src = cached; return; }
    el.onerror = function() {
        this.onerror = null;
        window._retryFirebaseImg(this, url, DEFAULT_PROFILE_SVG);
    };
    el.src = url;
}

// --- 네트워크 연결 품질 모니터 (제1원칙: 연결은 이분법이 아닌 스펙트럼) ---
const NetworkMonitor = (() => {
    let _quality = 'good'; // 'good' | 'weak' | 'offline'
    let _listeners = [];
    let _lastCheck = 0;

    function getQuality() { return _quality; }
    function isUsable() { return _quality !== 'offline'; }

    async function checkNow() {
        if (!navigator.onLine) { _setQuality('offline'); return 'offline'; }
        const now = Date.now();
        if (now - _lastCheck < 5000) return _quality; // 5초 내 중복 방지
        _lastCheck = now;
        try {
            const start = performance.now();
            // Firebase Auth 엔드포인트에 HEAD 요청 — 실제 연결 품질 측정
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            await fetch('https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=' + firebaseConfig.apiKey, {
                method: 'HEAD', mode: 'no-cors', signal: controller.signal
            });
            clearTimeout(timeoutId);
            const latency = performance.now() - start;
            _setQuality(latency > 3000 ? 'weak' : 'good');
        } catch (e) {
            _setQuality(navigator.onLine ? 'weak' : 'offline');
        }
        return _quality;
    }

    function _setQuality(q) {
        if (_quality !== q) {
            const prev = _quality;
            _quality = q;
            if (window.AppLogger) AppLogger.info(`[Network] 품질 변경: ${prev} → ${q}`);
            _listeners.forEach(fn => { try { fn(q, prev); } catch(e) {} });
        }
    }

    function onQualityChange(fn) { _listeners.push(fn); }

    // navigator.connection API 활용 (지원 브라우저)
    if (navigator.connection) {
        navigator.connection.addEventListener('change', () => {
            const conn = navigator.connection;
            if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') {
                _setQuality('weak');
            } else if (!navigator.onLine) {
                _setQuality('offline');
            } else {
                _setQuality('good');
            }
        });
    }

    return { getQuality, isUsable, checkNow, onQualityChange };
})();

// --- Cloud Storage 헬퍼 ---
function isBase64Image(str) {
    return typeof str === 'string' && str.startsWith('data:image/');
}

// 업로드 실패 재전송 큐 (로컬 메모리 + localStorage 백업)
const _uploadRetryQueue = [];
let _retryProcessing = false;
function _persistRetryQueue() {
    try {
        const serializable = _uploadRetryQueue.map(item => ({
            storagePath: item.storagePath,
            timestamp: item.timestamp
        }));
        localStorage.setItem('upload_retry_queue', JSON.stringify(serializable));
    } catch (e) { /* quota exceeded 등 무시 */ }
}
function _addToRetryQueue(storagePath, base64str) {
    // 동일 경로 중복 방지
    const exists = _uploadRetryQueue.some(item => item.storagePath === storagePath);
    if (exists) {
        console.warn(`[UploadRetry] 이미 큐에 존재: ${storagePath}`);
        return;
    }
    _uploadRetryQueue.push({ storagePath, base64str, timestamp: Date.now() });
    _persistRetryQueue();
    console.warn(`[UploadRetry] 재전송 큐에 추가: ${storagePath} (큐 크기: ${_uploadRetryQueue.length})`);
    if (window.AppLogger) AppLogger.warn(`[UploadRetry] 큐 추가: ${storagePath}`);
}

// 네트워크 복구 시 재전송 큐 자동 처리
window.addEventListener('online', () => {
    console.log('[Network] 온라인 복구 — 재전송 큐 처리');
    setTimeout(_flushRetryQueue, 3000); // 3초 대기 후 처리 (네트워크 안정화)
});

// 제1원칙: 재시도 큐는 온라인 복귀 시 자동으로 비워져야 한다
let _flushingRetryQueue = false;
async function _flushRetryQueue() {
    if (_flushingRetryQueue || _uploadRetryQueue.length === 0) return;
    if (!navigator.onLine) return;
    _flushingRetryQueue = true;
    if (window.AppLogger) AppLogger.info(`[UploadRetry] 큐 자동 재전송 시작 (${_uploadRetryQueue.length}건)`);
    const items = [..._uploadRetryQueue];
    for (const item of items) {
        if (!navigator.onLine) break; // 재전송 중 오프라인 전환 시 중단
        if (!item.base64str) continue; // base64 데이터 없으면 스킵
        // 24시간 이상 경과된 항목은 폐기
        if (Date.now() - item.timestamp > 24 * 60 * 60 * 1000) {
            const idx = _uploadRetryQueue.indexOf(item);
            if (idx >= 0) _uploadRetryQueue.splice(idx, 1);
            if (window.AppLogger) AppLogger.info(`[UploadRetry] 만료 항목 제거: ${item.storagePath}`);
            continue;
        }
        try {
            await uploadImageToStorage(item.storagePath, item.base64str);
            const idx = _uploadRetryQueue.indexOf(item);
            if (idx >= 0) _uploadRetryQueue.splice(idx, 1);
            if (window.AppLogger) AppLogger.info(`[UploadRetry] 재전송 성공: ${item.storagePath}`);
        } catch (e) {
            if (window.AppLogger) AppLogger.warn(`[UploadRetry] 재전송 실패: ${item.storagePath} — ${e.message}`);
            break; // 네트워크 문제일 수 있으므로 중단
        }
    }
    _persistRetryQueue();
    _flushingRetryQueue = false;
}

// 업로드 직렬화 큐 — WebView 네트워크 경합 방지 (동시 업로드 → 순차 실행)
const _uploadQueue = [];
let _uploadRunning = false;

async function _processUploadQueue() {
    if (_uploadRunning) return;
    _uploadRunning = true;
    while (_uploadQueue.length > 0) {
        const { fn, resolve, reject } = _uploadQueue.shift();
        try { resolve(await fn()); }
        catch (e) { reject(e); }
    }
    _uploadRunning = false;
}

function enqueueUpload(fn) {
    return new Promise((resolve, reject) => {
        _uploadQueue.push({ fn, resolve, reject });
        _processUploadQueue();
    });
}

// WebP 포맷 지원 감지 — canvas.toDataURL('image/webp') 결과로 판별
const _supportsWebP = (() => {
    try {
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        return c.toDataURL('image/webp').startsWith('data:image/webp');
    } catch (e) { return false; }
})();

function canvasToOptimalDataURL(canvas, quality) {
    if (_supportsWebP) return canvas.toDataURL('image/webp', quality);
    return canvas.toDataURL('image/jpeg', quality);
}

function getImageExtension() {
    return _supportsWebP ? '.webp' : '.jpg';
}

// 썸네일 URL 변환: Firebase Storage 원본 URL → thumbs/ 경로 썸네일 URL
function getThumbnailURL(originalURL) {
    if (!originalURL || typeof originalURL !== 'string') return originalURL;
    // Firebase Storage URL 패턴: .../{prefix}%2F... (URL-encoded path)
    const prefixes = ['reels_photos', 'profile_images', 'planner_photos'];
    for (const prefix of prefixes) {
        const encoded = encodeURIComponent(prefix + '/');  // e.g. "reels_photos%2F"
        if (originalURL.includes(encoded)) {
            return originalURL.replace(encoded, encodeURIComponent('thumbs/' + prefix + '/'));
        }
    }
    return originalURL;
}

// base64 이미지 압축 유틸리티 (maxDim: 최대 픽셀, quality: 0~1)
function compressBase64Image(base64str, maxDim, quality) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > maxDim || h > maxDim) {
                if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
                else { w = Math.round(w * maxDim / h); h = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvasToOptimalDataURL(canvas, quality));
        };
        img.onerror = () => resolve(base64str); // 실패 시 원본 반환
        img.src = base64str;
    });
}

// 파일 크기 기반 동적 타임아웃 계산 (기본 30s + MB당 60s, 최소 30s, 최대 300s)
function _calcUploadTimeout(blobSize, networkQuality) {
    const base = Math.min(Math.max(30000, 30000 + Math.ceil(blobSize / (1024 * 1024)) * 60000), 300000);
    return networkQuality === 'weak' ? base * 2 : base;
}

// base64 데이터 URL → Blob 변환 헬퍼
function dataURLtoBlob(dataURL) {
    const parts = dataURL.split(',');
    const contentType = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const byteString = atob(parts[1]);
    const u8arr = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) u8arr[i] = byteString.charCodeAt(i);
    return new Blob([u8arr], { type: contentType });
}

// 적응형 압축: 목표 크기 이하가 될 때까지 품질을 반복 조정
async function compressToTargetSize(canvas, maxBytes, initialQuality = 0.8, minQuality = 0.1) {
    let quality = initialQuality;
    let currentCanvas = canvas;
    let dataURL, blob;

    while (true) {
        dataURL = canvasToOptimalDataURL(currentCanvas, quality);
        blob = dataURLtoBlob(dataURL);

        if (blob.size <= maxBytes) {
            return { dataURL, blob, quality, dimensions: { w: currentCanvas.width, h: currentCanvas.height } };
        }

        quality = Math.round((quality - 0.1) * 10) / 10;

        if (quality < minQuality) {
            // 품질만으로 부족 → 캔버스 크기 75%로 축소 후 재시도
            const newW = Math.round(currentCanvas.width * 0.75);
            const newH = Math.round(currentCanvas.height * 0.75);
            if (newW < 50 || newH < 50) break; // 최소 크기 보호
            const smaller = document.createElement('canvas');
            smaller.width = newW; smaller.height = newH;
            smaller.getContext('2d').drawImage(currentCanvas, 0, 0, newW, newH);
            currentCanvas = smaller;
            quality = initialQuality; // 축소 후 품질 리셋
        }
    }
    // 최종 결과 반환 (최소 크기에 도달)
    return { dataURL, blob, quality, dimensions: { w: currentCanvas.width, h: currentCanvas.height } };
}

// 업로드 진행률 토스트 UI 헬퍼
let _uploadToastHideTimer = null;
function showUploadProgress(pct, label) {
    const toast = document.getElementById('upload-progress-toast');
    if (!toast) return;
    toast.style.display = 'block';
    const bar = document.getElementById('upload-progress-bar');
    const pctEl = document.getElementById('upload-progress-pct');
    const labelEl = document.getElementById('upload-progress-label');
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (labelEl && label) labelEl.textContent = label;
    if (_uploadToastHideTimer) { clearTimeout(_uploadToastHideTimer); _uploadToastHideTimer = null; }
}
function hideUploadProgress() {
    if (_uploadToastHideTimer) clearTimeout(_uploadToastHideTimer);
    _uploadToastHideTimer = setTimeout(() => {
        const toast = document.getElementById('upload-progress-toast');
        if (toast) toast.style.display = 'none';
        _uploadToastHideTimer = null;
    }, 800);
}
function createUploadProgressCallback(label) {
    const lang = AppState?.currentLang || 'ko';
    const defaultLabel = lang === 'ko' ? '업로드 중...' : 'Uploading...';
    return (pct) => showUploadProgress(pct, label || defaultLabel);
}

async function uploadImageToStorage(storagePath, base64str, onProgress) {
    return enqueueUpload(() => _uploadImageToStorageImpl(storagePath, base64str, onProgress));
}

async function _uploadImageToStorageImpl(storagePath, base64str, onProgress) {
    const _log = (step, msg) => { console.log(`[Upload:${step}] ${msg}`); if (window.AppLogger) AppLogger.info(`[Upload:${step}] ${msg}`); };

    // 제1원칙: 오프라인에서 업로드 시도는 배터리 낭비 — 즉시 큐에 넣고 종료
    if (!navigator.onLine) {
        _log('0-OFFLINE', 'Offline detected, queuing for later');
        _addToRetryQueue(storagePath, base64str);
        const err = new Error('Device is offline — upload queued for retry');
        err.code = 'client/offline-queued';
        throw err;
    }

    _log('1-START', `path=${storagePath}, inputLen=${base64str ? base64str.length : 'null'}, startsWithData=${base64str ? base64str.startsWith('data:') : 'N/A'}`);
    let blob, contentType;
    if (base64str.startsWith('data:')) {
        _log('2-DECODE', `base64PartLen=${base64str.length}`);
        blob = dataURLtoBlob(base64str);
        contentType = blob.type;
        _log('3-BLOB', `blobSize=${blob.size}, blobType=${blob.type}`);
    } else {
        _log('2-FETCH', 'Using fetch() for non-data URI');
        const res = await fetch(base64str);
        blob = await res.blob();
        contentType = blob.type || 'image/jpeg';
        _log('3-BLOB', `blobSize=${blob.size}, blobType=${blob.type}`);
    }

    // 업로드 전 크기 검증 — Firebase Storage 규칙 거부 방지
    const SIZE_LIMITS = { 'profile_images': 500 * 1024, 'planner_photos': 2 * 1024 * 1024, 'reels_photos': 2 * 1024 * 1024 };
    const pathPrefix = storagePath.split('/')[0];
    const limit = SIZE_LIMITS[pathPrefix];
    if (limit && blob.size > limit) {
        const err = new Error(`Image size ${blob.size} exceeds ${limit} byte limit for ${pathPrefix}`);
        err.code = 'client/image-too-large';
        _log('3-SIZE-CHECK', err.message);
        throw err;
    }
    const storageRef = ref(storage, storagePath);

    // CDN 캐싱을 위한 Cache-Control 메타데이터 설정
    const CACHE_CONTROL_MAP = {
        'reels_photos': 'public, max-age=86400',      // 24시간 (릴스 수명과 일치)
        'profile_images': 'public, max-age=604800',    // 7일 (변경 빈도 낮음)
        'planner_photos': 'private, max-age=86400'     // 비공개, 1일
    };
    const cacheControl = CACHE_CONTROL_MAP[pathPrefix] || 'no-cache';

    // 프로필 이미지: 기존 파일 삭제 후 업로드 (best-effort, 5초 타임아웃)
    if (storagePath.startsWith('profile_images/')) {
        try {
            await Promise.race([
                deleteObject(storageRef),
                new Promise((_, rej) => setTimeout(() => rej(new Error('delete timeout')), 5000))
            ]);
            _log('3.5-DELETE', 'Existing profile image deleted');
        } catch (e) {
            _log('3.5-DELETE', `Delete skipped: ${e.code || e.message}`);
        }
    }

    // 네트워크 품질 기반 동적 타임아웃 계산
    const networkQuality = NetworkMonitor.getQuality();
    const uploadTimeoutMs = _calcUploadTimeout(blob.size, networkQuality);
    _log('3.9-TIMEOUT', `timeout=${uploadTimeoutMs}ms (blob=${blob.size}B, network=${networkQuality})`);

    // 지수 백오프 재시도 (최대 3회, 3s → 6s → 실패)
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 3000;
    let lastError;
    const useSimpleUpload = blob.size < 100 * 1024; // 100KB 미만: 단일 PUT (uploadBytes)
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // 재시도 전 네트워크 상태 재확인 — 오프라인이면 즉시 큐에 넣기
        if (attempt > 1 && !navigator.onLine) {
            _log('4-OFFLINE', 'Network lost during retries, queuing');
            _addToRetryQueue(storagePath, base64str);
            const err = new Error('Network lost during upload retries — queued');
            err.code = 'client/offline-queued';
            throw err;
        }
        try {
            if (useSimpleUpload) {
                _log('4-UPLOAD', `Using simple uploadBytes (${blob.size}B), attempt ${attempt}/${MAX_RETRIES}`);
                const snapshot = await Promise.race([
                    uploadBytes(storageRef, blob, { contentType, cacheControl }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error(`Upload timed out after ${uploadTimeoutMs / 1000}s`)), uploadTimeoutMs))
                ]);
                if (onProgress) onProgress(100);
                const downloadURL = await getDownloadURL(snapshot.ref);
                _log('6-DONE', `downloadURL=${downloadURL.substring(0, 80)}...`);
                return downloadURL;
            } else {
                _log('4-UPLOAD', `Calling uploadBytesResumable... (attempt ${attempt}/${MAX_RETRIES})`);
                const url = await new Promise((resolve, reject) => {
                    const uploadTask = uploadBytesResumable(storageRef, blob, { contentType, cacheControl });
                    let lastProgressTime = Date.now();
                    const timeout = setTimeout(() => {
                        uploadTask.cancel();
                        reject(new Error(`Upload timed out after ${uploadTimeoutMs / 1000}s`));
                    }, uploadTimeoutMs);
                    // 진행률 감시: 30초간 진행 없으면 조기 타임아웃
                    const stallCheck = setInterval(() => {
                        if (Date.now() - lastProgressTime > 30000) {
                            clearInterval(stallCheck);
                            clearTimeout(timeout);
                            uploadTask.cancel();
                            reject(new Error('Upload stalled — no progress for 30s'));
                        }
                    }, 5000);
                    uploadTask.on('state_changed',
                        (snapshot) => {
                            lastProgressTime = Date.now();
                            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                            _log('4-PROGRESS', `${pct}% (${snapshot.bytesTransferred}/${snapshot.totalBytes})`);
                            if (onProgress) onProgress(pct);
                        },
                        (error) => {
                            clearTimeout(timeout);
                            clearInterval(stallCheck);
                            reject(error);
                        },
                        async () => {
                            clearTimeout(timeout);
                            clearInterval(stallCheck);
                            try {
                                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                                resolve(downloadURL);
                            } catch (e) { reject(e); }
                        }
                    );
                });
                _log('6-DONE', `downloadURL=${url.substring(0, 80)}...`);
                if (onProgress) onProgress(100);
                return url;
            }
        } catch (e) {
            lastError = e;
            _log('4-RETRY', `attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}`);
            if (onProgress) onProgress(0);
            if (attempt < MAX_RETRIES) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
                _log('4-WAIT', `Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    // 모든 재시도 실패 — 재전송 큐에 추가
    _addToRetryQueue(storagePath, base64str);
    throw lastError;
}

const googleProvider = new GoogleAuthProvider();

// Google Fit: 네이티브 앱 플러그인(Health Connect / Google Fit SDK)만 사용
// REST API 폴백 제거됨 — 모든 건강 데이터는 네이티브 SDK를 통해 조회

// --- 상태 관리 객체 ---
function getWeekStartDate() {
    const today = new Date();
    const day = today.getDay();
    const start = new Date(today);
    start.setDate(today.getDate() - day);
    return `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
}

let AppState = getInitialAppState();

function getInitialAppState() {
    return {
        isLoginMode: true,
        currentLang: (function(){ try { return localStorage.getItem('lang') || 'ko'; } catch(e) { return 'ko'; } })(),
        user: {
            name: "신규 헌터",
            level: 1,
            points: 50,
            stats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
            pendingStats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
            titleHistory: [ { level: 1, title: { ko: "신규 각성자", en: "New Awakened", ja: "新規覚醒者" } } ],
            photoURL: null, 
            friends: [],
            syncEnabled: false,
            gpsEnabled: false,
            pushEnabled: false,
            fcmToken: null,
            stepData: { date: "", rewardedSteps: 0, totalSteps: 0 },
            instaId: "",
            streak: { currentStreak: 0, lastActiveDate: null, multiplier: 1.0 },
            nameLastChanged: null,
            rareTitle: { unlocked: [] },
            cameraEnabled: false
        },
        quest: {
            currentDayOfWeek: new Date().getDay(),
            completedState: Array.from({length: 7}, () => Array(12).fill(false)),
            weekStart: getWeekStartDate()
        },
        social: { mode: 'global', sortCriteria: 'total', users: [] },
        dungeon: { lastGeneratedDate: null, slot: 0, stationIdx: 0, maxParticipants: 5, globalParticipants: 0, globalProgress: 0, isJoined: false, hasContributed: false, targetStat: 'str', isCleared: false, bossMaxHP: 5, bossDamageDealt: 0, raidParticipants: [] },
        diyQuests: { definitions: [], completedToday: {}, lastResetDate: null },
        questHistory: {},
        ddays: [],
        ddayCaption: '',
        library: { books: [] },
    };
}

// --- 앱 초기 로드 ---
let _initializedUid = null;

// --- 탭 순서 관리 ---
const DEFAULT_NAV_ORDER = ['status', 'quests', 'dungeon', 'diary', 'reels', 'social', 'settings'];

function loadNavOrder() {
    const saved = localStorage.getItem('navTabOrder');
    if (!saved) return;
    try {
        const order = JSON.parse(saved);
        const nav = document.querySelector('nav');
        if (!nav) return;
        order.forEach(tabId => {
            const item = nav.querySelector(`[data-tab="${tabId}"]`);
            if (item) nav.appendChild(item);
        });
    } catch(e) {}
}

function saveNavOrder() {
    const order = Array.from(document.querySelectorAll('.nav-item')).map(el => el.dataset.tab);
    localStorage.setItem('navTabOrder', JSON.stringify(order));
}

let _navDragJustEnded = false;

function initNavDragReorder() {
    const nav = document.querySelector('nav');
    let dragItem = null;
    let longPressTimer = null;
    let isDragging = false;
    let wasMoved = false;

    function onTouchStart(e) {
        const item = e.currentTarget;
        longPressTimer = setTimeout(() => {
            isDragging = true;
            wasMoved = false;
            dragItem = item;
            item.classList.add('nav-dragging');
            nav.classList.add('nav-reorder-mode');
            if (navigator.vibrate) navigator.vibrate(50);
        }, 500);
    }

    function onTouchMove(e) {
        if (!isDragging || !dragItem) return;
        e.preventDefault();
        wasMoved = true;
        const touch = e.touches[0];
        const navRect = nav.getBoundingClientRect();
        const touchX = touch.clientX - navRect.left;
        const items = Array.from(nav.querySelectorAll('.nav-item'));
        const itemWidth = navRect.width / items.length;
        const targetIndex = Math.max(0, Math.min(items.length - 1, Math.floor(touchX / itemWidth)));
        const currentIndex = items.indexOf(dragItem);
        if (targetIndex !== currentIndex) {
            if (targetIndex > currentIndex) {
                nav.insertBefore(dragItem, items[targetIndex].nextSibling);
            } else {
                nav.insertBefore(dragItem, items[targetIndex]);
            }
        }
    }

    function onTouchEnd() {
        clearTimeout(longPressTimer);
        if (isDragging && dragItem) {
            dragItem.classList.remove('nav-dragging');
            nav.classList.remove('nav-reorder-mode');
            if (wasMoved) {
                saveNavOrder();
                _navDragJustEnded = true;
                setTimeout(() => { _navDragJustEnded = false; }, 300);
            }
        }
        isDragging = false;
        dragItem = null;
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('touchstart', onTouchStart, { passive: true });
        item.addEventListener('touchmove', onTouchMove, { passive: false });
        item.addEventListener('touchend', onTouchEnd);
        item.addEventListener('touchcancel', onTouchEnd);
    });
}

// --- 상태창 카드 순서 재배치 (길게 눌러 상하 이동) ---
const DEFAULT_STATUS_CARD_ORDER = ['stat-radar', 'bonus-exp', 'step-count', 'my-library', 'orm-calc', 'running-calc', 'pomodoro', 'life-status', 'dday', 'dday-caption', 'daily-quote'];

function saveStatusCardOrder() {
    const cards = Array.from(document.querySelectorAll('#status .status-reorderable'));
    const order = cards.map(el => el.dataset.cardId);
    localStorage.setItem('statusCardOrder', JSON.stringify(order));
}

function loadStatusCardOrder() {
    const saved = localStorage.getItem('statusCardOrder');
    if (!saved) return;
    try {
        const order = JSON.parse(saved);
        const section = document.getElementById('status');
        const btnMyinfo = document.getElementById('btn-myinfo');
        order.forEach(cardId => {
            const card = section.querySelector(`.status-reorderable[data-card-id="${cardId}"]`);
            if (card) section.insertBefore(card, btnMyinfo);
        });
    } catch(e) {}
}

function initStatusCardReorder() {
    const section = document.getElementById('status');
    if (!section) return;
    let dragItem = null;
    let longPressTimer = null;
    let isDragging = false;
    let wasMoved = false;
    let startY = 0;

    // Add drag handle indicator to each reorderable card
    document.querySelectorAll('#status .status-reorderable').forEach(card => {
        if (!card.querySelector('.card-drag-handle')) {
            const handle = document.createElement('span');
            handle.className = 'card-drag-handle';
            handle.textContent = '⋮⋮';
            card.appendChild(handle);
        }
    });

    function getReorderableCards() {
        return Array.from(section.querySelectorAll('.status-reorderable'));
    }

    function onTouchStart(e) {
        const card = e.currentTarget;
        startY = e.touches[0].clientY;
        longPressTimer = setTimeout(() => {
            isDragging = true;
            wasMoved = false;
            dragItem = card;
            card.classList.add('status-card-dragging');
            section.classList.add('status-reorder-mode');
            if (navigator.vibrate) navigator.vibrate(50);
        }, 500);
    }

    function onTouchMove(e) {
        // Cancel long press if finger moves too much before activation
        if (!isDragging && longPressTimer) {
            const dy = Math.abs(e.touches[0].clientY - startY);
            if (dy > 10) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            return;
        }
        if (!isDragging || !dragItem) return;
        e.preventDefault();
        wasMoved = true;
        const touch = e.touches[0];
        const cards = getReorderableCards();
        const btnMyinfo = document.getElementById('btn-myinfo');

        // Find target card by vertical position
        let targetIndex = cards.length - 1;
        for (let i = 0; i < cards.length; i++) {
            const rect = cards[i].getBoundingClientRect();
            if (touch.clientY < rect.top + rect.height / 2) {
                targetIndex = i;
                break;
            }
        }
        const currentIndex = cards.indexOf(dragItem);
        if (targetIndex !== currentIndex) {
            if (targetIndex > currentIndex) {
                const ref = cards[targetIndex].nextSibling;
                section.insertBefore(dragItem, ref);
            } else {
                section.insertBefore(dragItem, cards[targetIndex]);
            }
        }
    }

    function onTouchEnd() {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        if (isDragging && dragItem) {
            dragItem.classList.remove('status-card-dragging');
            section.classList.remove('status-reorder-mode');
            if (wasMoved) {
                saveStatusCardOrder();
            }
        }
        isDragging = false;
        dragItem = null;
    }

    document.querySelectorAll('#status .status-reorderable').forEach(card => {
        card.addEventListener('touchstart', onTouchStart, { passive: true });
        card.addEventListener('touchmove', onTouchMove, { passive: false });
        card.addEventListener('touchend', onTouchEnd);
        card.addEventListener('touchcancel', onTouchEnd);
    });
}

// --- 햄버거 메뉴 & 상태창 편집 ---
const STATUS_CARD_LABELS = {
    'step-count': { name: '걸음수', icon: '🚶' },
    'stat-radar': { name: 'STAT RADAR', icon: '📊' },
    'bonus-exp': { name: '보너스 EXP', icon: '🎬' },
    'pomodoro': { name: 'POMODORO', icon: '🍅' },
    'life-status': { name: 'LIFE STATUS', icon: '📅' },
    'dday': { name: 'D-DAY', icon: '⏰' },
    'dday-caption': { name: '목표/좌우명', icon: '💬' },
    'daily-quote': { name: '오늘의 명언', icon: '❝' },
    'my-library': { name: '내 서재', icon: '📚' },
    'running-calc': { name: '러닝 계산기', icon: '🏃' },
    'orm-calc': { name: '1RM 계산기', icon: '🏋️' }
};
const ALL_CARD_IDS = ['stat-radar', 'bonus-exp', 'step-count', 'my-library', 'orm-calc', 'running-calc', 'pomodoro', 'life-status', 'dday', 'dday-caption', 'daily-quote'];
// 삭제 불가 카드 (이동만 가능)
const NON_REMOVABLE_CARDS = ['stat-radar', 'bonus-exp'];

function getHiddenCards() {
    try {
        const saved = localStorage.getItem('statusCardHidden');
        return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
}

function saveHiddenCards(hiddenIds) {
    // 삭제 불가 카드는 숨김 목록에서 제외
    const filtered = hiddenIds.filter(id => !NON_REMOVABLE_CARDS.includes(id));
    localStorage.setItem('statusCardHidden', JSON.stringify(filtered));
}

// 기존 사용자의 카드 순서에 새 카드(orm-calc 등)가 누락된 경우 추가
function migrateCardOrder() {
    const saved = localStorage.getItem('statusCardOrder');
    if (!saved) return;
    try {
        const order = JSON.parse(saved);
        let changed = false;
        ALL_CARD_IDS.forEach(id => {
            if (!order.includes(id)) {
                // DEFAULT_STATUS_CARD_ORDER 기준으로 적절한 위치에 삽입
                const defaultIdx = DEFAULT_STATUS_CARD_ORDER.indexOf(id);
                let insertIdx = order.length;
                for (let i = defaultIdx + 1; i < DEFAULT_STATUS_CARD_ORDER.length; i++) {
                    const nextId = DEFAULT_STATUS_CARD_ORDER[i];
                    const pos = order.indexOf(nextId);
                    if (pos !== -1) { insertIdx = pos; break; }
                }
                order.splice(insertIdx, 0, id);
                changed = true;
            }
        });
        if (changed) {
            localStorage.setItem('statusCardOrder', JSON.stringify(order));
        }
    } catch(e) {}
}

function applyCardVisibility() {
    const hidden = getHiddenCards();
    ALL_CARD_IDS.forEach(cardId => {
        const card = document.querySelector(`#status .status-reorderable[data-card-id="${cardId}"]`);
        if (!card) return;
        if (hidden.includes(cardId)) {
            card.style.display = 'none';
        } else {
            // 숨김 해제 시 표시 복원 (step-count 포함)
            card.style.display = '';
        }
    });
}

function getVisibleCardIds() {
    const hidden = getHiddenCards();
    const section = document.getElementById('status');
    const cards = Array.from(section.querySelectorAll('.status-reorderable'));
    return cards.map(c => c.dataset.cardId).filter(id => !hidden.includes(id));
}

function initHamburgerMenu() {
    const btn = document.getElementById('btn-hamburger-menu');
    const popup = document.getElementById('hamburger-menu-popup');
    const backdrop = document.getElementById('hamburger-menu-backdrop');
    if (!btn || !popup || !backdrop) return;

    function closePopup() {
        popup.classList.add('d-none');
        backdrop.classList.add('d-none');
    }
    function openPopup() {
        popup.classList.remove('d-none');
        backdrop.classList.remove('d-none');
    }

    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (popup.classList.contains('d-none')) {
            openPopup();
        } else {
            closePopup();
        }
    });

    backdrop.addEventListener('click', closePopup);

    document.getElementById('btn-goto-settings').addEventListener('click', function() {
        closePopup();
        document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
        document.getElementById('settings').classList.add('active');
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    });

    document.getElementById('btn-edit-status-cards').addEventListener('click', function() {
        closePopup();
        openStatusCardEditor();
    });
}

// --- Status Card Editor ---
function openStatusCardEditor() {
    const editor = document.getElementById('status-card-editor');
    editor.classList.remove('d-none');
    renderEditorCardList();
    initEditorDragReorder();
}

function closeStatusCardEditor() {
    const editor = document.getElementById('status-card-editor');
    editor.classList.add('d-none');
    // Apply changes to main view
    applyCardVisibility();
    saveStatusCardOrder();
}

function renderEditorCardList() {
    const list = document.getElementById('editor-card-list');
    const hidden = getHiddenCards();
    const section = document.getElementById('status');
    const cards = Array.from(section.querySelectorAll('.status-reorderable'));
    const visibleCards = cards.filter(c => !hidden.includes(c.dataset.cardId));

    list.innerHTML = '';
    visibleCards.forEach(card => {
        const cardId = card.dataset.cardId;
        const info = STATUS_CARD_LABELS[cardId] || { name: cardId, icon: '📦' };
        const isFixed = NON_REMOVABLE_CARDS.includes(cardId);
        const item = document.createElement('div');
        item.className = 'editor-card-item';
        item.dataset.cardId = cardId;
        item.innerHTML = `
            <span class="editor-card-drag-handle">⋮⋮</span>
            <div class="editor-card-icon">${info.icon}</div>
            <div class="editor-card-info">
                <div class="editor-card-name">${info.name}</div>
            </div>
            ${isFixed ? '' : `<button class="editor-card-remove-btn" data-remove-card="${cardId}">−</button>`}
        `;
        list.appendChild(item);
    });

    // Bind remove buttons
    list.querySelectorAll('.editor-card-remove-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const cardId = this.dataset.removeCard;
            const hidden = getHiddenCards();
            if (!hidden.includes(cardId)) {
                hidden.push(cardId);
                saveHiddenCards(hidden);
            }
            // Remove from editor list with animation
            const item = this.closest('.editor-card-item');
            item.style.transition = 'opacity 0.2s, transform 0.2s';
            item.style.opacity = '0';
            item.style.transform = 'translateX(30px)';
            setTimeout(() => {
                item.remove();
            }, 200);
        });
    });
}

function initEditorDragReorder() {
    const list = document.getElementById('editor-card-list');
    let dragItem = null;
    let isDragging = false;
    let longPressTimer = null;
    let startY = 0;

    function getItems() {
        return Array.from(list.querySelectorAll('.editor-card-item'));
    }

    list.addEventListener('touchstart', function(e) {
        const item = e.target.closest('.editor-card-item');
        if (!item) return;
        startY = e.touches[0].clientY;
        longPressTimer = setTimeout(() => {
            isDragging = true;
            dragItem = item;
            item.classList.add('dragging');
            if (navigator.vibrate) navigator.vibrate(50);
        }, 400);
    }, { passive: true });

    list.addEventListener('touchmove', function(e) {
        if (!isDragging && longPressTimer) {
            const dy = Math.abs(e.touches[0].clientY - startY);
            if (dy > 10) { clearTimeout(longPressTimer); longPressTimer = null; }
            return;
        }
        if (!isDragging || !dragItem) return;
        e.preventDefault();
        const touch = e.touches[0];
        const items = getItems();
        let targetIndex = items.length - 1;
        for (let i = 0; i < items.length; i++) {
            const rect = items[i].getBoundingClientRect();
            if (touch.clientY < rect.top + rect.height / 2) { targetIndex = i; break; }
        }
        const currentIndex = items.indexOf(dragItem);
        if (targetIndex !== currentIndex) {
            if (targetIndex > currentIndex) {
                const ref = items[targetIndex].nextSibling;
                list.insertBefore(dragItem, ref);
            } else {
                list.insertBefore(dragItem, items[targetIndex]);
            }
        }
    }, { passive: false });

    list.addEventListener('touchend', function() {
        clearTimeout(longPressTimer); longPressTimer = null;
        if (isDragging && dragItem) {
            dragItem.classList.remove('dragging');
            // Sync editor order back to main status section
            syncEditorOrderToDOM();
        }
        isDragging = false; dragItem = null;
    });

    list.addEventListener('touchcancel', function() {
        clearTimeout(longPressTimer); longPressTimer = null;
        if (dragItem) dragItem.classList.remove('dragging');
        isDragging = false; dragItem = null;
    });
}

function syncEditorOrderToDOM() {
    const editorItems = Array.from(document.querySelectorAll('#editor-card-list .editor-card-item'));
    const section = document.getElementById('status');
    const btnMyinfo = document.getElementById('btn-myinfo');
    editorItems.forEach(item => {
        const cardId = item.dataset.cardId;
        const card = section.querySelector(`.status-reorderable[data-card-id="${cardId}"]`);
        if (card) section.insertBefore(card, btnMyinfo);
    });
    // Also move hidden cards after visible ones
    const hidden = getHiddenCards();
    hidden.forEach(cardId => {
        const card = section.querySelector(`.status-reorderable[data-card-id="${cardId}"]`);
        if (card) section.insertBefore(card, btnMyinfo);
    });
    saveStatusCardOrder();
}

// --- Card Selection Modal ---
function openCardSelectModal() {
    const modal = document.getElementById('card-select-modal');
    const list = document.getElementById('card-select-list');
    const selectAll = document.getElementById('card-select-all');
    const hidden = getHiddenCards();

    if (hidden.length === 0) {
        // No hidden cards to add
        return;
    }

    list.innerHTML = '';
    selectAll.checked = false;

    hidden.forEach(cardId => {
        const info = STATUS_CARD_LABELS[cardId] || { name: cardId, icon: '📦' };
        const item = document.createElement('label');
        item.className = 'card-select-item';
        item.innerHTML = `
            <input type="checkbox" value="${cardId}">
            <span class="card-select-item-label">${info.name}</span>
        `;
        list.appendChild(item);
    });

    modal.classList.remove('d-none');

    selectAll.onchange = function() {
        list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = selectAll.checked;
        });
    };
}

function closeCardSelectModal() {
    document.getElementById('card-select-modal').classList.add('d-none');
}

function initCardSelectModal() {
    document.getElementById('btn-editor-add').addEventListener('click', openCardSelectModal);
    document.getElementById('btn-editor-back').addEventListener('click', closeStatusCardEditor);

    document.getElementById('btn-card-select-cancel').addEventListener('click', closeCardSelectModal);
    document.getElementById('btn-card-select-done').addEventListener('click', function() {
        const list = document.getElementById('card-select-list');
        const selected = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        if (selected.length > 0) {
            let hidden = getHiddenCards();
            hidden = hidden.filter(id => !selected.includes(id));
            saveHiddenCards(hidden);
            applyCardVisibility();
            renderEditorCardList();
            initEditorDragReorder();
        }
        closeCardSelectModal();
    });
}

// --- Service Worker 등록 및 오프라인/온라인 감지 ---
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (isNative) return; // Capacitor 네이티브에서는 SW 불필요

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
            if (window.AppLogger) AppLogger.info('[SW] Service Worker 등록 완료 (scope: ' + reg.scope + ')');

            // 업데이트 감지
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                        if (window.AppLogger) AppLogger.info('[SW] 새 버전 활성화됨 — 새로고침 권장');
                    }
                });
            });
        })
        .catch((err) => {
            if (window.AppLogger) AppLogger.warn('[SW] 등록 실패: ' + err.message);
        });
}

function initOfflineDetection() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;

    function updateOnlineStatus() {
        if (navigator.onLine) {
            banner.classList.add('d-none');
            banner.classList.remove('offline-banner-show');
            if (window.AppLogger) AppLogger.info('[Network] 온라인 복귀');
            // Firestore 네트워크 복구 — 기존 끊어진 스트림을 정리하고 재연결
            enableNetwork(db).then(() => {
                if (window.AppLogger) AppLogger.info('[Firestore] 네트워크 재활성화 완료');
            }).catch((e) => {
                if (window.AppLogger) AppLogger.warn('[Firestore] 네트워크 재활성화 실패: ' + e.message);
            });
            // SW에 온라인 복귀 알림
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'ONLINE_RESTORED' });
            }
        } else {
            banner.classList.remove('d-none');
            banner.classList.add('offline-banner-show');
            if (window.AppLogger) AppLogger.warn('[Network] 오프라인 전환');
            // Firestore 네트워크 비활성화 — 불필요한 재연결 시도 방지
            disableNetwork(db).then(() => {
                if (window.AppLogger) AppLogger.info('[Firestore] 네트워크 비활성화 완료');
            }).catch((e) => {
                if (window.AppLogger) AppLogger.warn('[Firestore] 네트워크 비활성화 실패: ' + e.message);
            });
        }
    }

    window.addEventListener('online', () => {
        updateOnlineStatus();
        // 제1원칙: 온라인 복귀 즉시 대기 중인 업로드 자동 재전송
        setTimeout(() => _flushRetryQueue(), 2000); // 연결 안정화 2초 대기 후 실행
        NetworkMonitor.checkNow();
    });
    window.addEventListener('offline', () => {
        updateOnlineStatus();
        NetworkMonitor.checkNow();
    });

    // 제1원칙: WebChannel 오류는 네이티브/웹 모두에서 발생 — 플랫폼 구분 없이 처리
    let _lastNetworkRecovery = 0;
    let _webChannelErrorCount = 0;
    function _handleWebChannelError(source) {
        _webChannelErrorCount++;
        const now = Date.now();
        // 오프라인 상태면 복구 시도하지 않음 — online 이벤트에서 처리
        if (!navigator.onLine) {
            if (window.AppLogger) AppLogger.info(`[Firestore] WebChannel error #${_webChannelErrorCount} while offline — skipping recovery`);
            return;
        }
        // 동적 디바운스: 연속 오류 시 대기 시간 증가 (30초 → 60초 → 120초)
        const debounceMs = Math.min(30000 * Math.pow(2, Math.min(_webChannelErrorCount - 1, 2)), 120000);
        if (now - _lastNetworkRecovery < debounceMs) return;
        _lastNetworkRecovery = now;
        if (window.AppLogger) AppLogger.warn(`[Firestore] WebChannel error #${_webChannelErrorCount} (${source}), reconnecting (debounce: ${debounceMs}ms)...`);
        // 네트워크 품질 확인 후 복구 시도
        const doRecovery = () => {
            disableNetwork(db)
                .then(() => enableNetwork(db))
                .then(() => {
                    _webChannelErrorCount = 0; // 복구 성공 시 카운터 리셋
                    if (window.AppLogger) AppLogger.info('[Firestore] WebChannel 복구 완료');
                    // 복구 후 재전송 큐 처리
                    setTimeout(() => _flushRetryQueue(), 3000);
                })
                .catch((e) => { if (window.AppLogger) AppLogger.warn('[Firestore] WebChannel 복구 실패: ' + e.message); });
        };
        // weak 네트워크에서는 약간 대기 후 복구 시도
        if (typeof NetworkMonitor !== 'undefined' && NetworkMonitor.getQuality() === 'weak') {
            setTimeout(doRecovery, 5000);
        } else {
            doRecovery();
        }
    }
    window.addEventListener('unhandledrejection', (event) => {
        const msg = String(event.reason && event.reason.message || event.reason || '');
        if (msg.includes('transport errored') || msg.includes('WebChannel') || msg.includes('UNAVAILABLE')) {
            _handleWebChannelError('unhandledrejection');
        }
    });
    // Firebase console.warn 기반 WebChannel 오류도 감지 (warn 패치)
    const _origConsoleWarn = console.warn;
    console.warn = function(...args) {
        _origConsoleWarn.apply(console, args);
        const msg = args.map(a => String(a)).join(' ');
        if (msg.includes('transport errored') && msg.includes('WebChannelConnection')) {
            _handleWebChannelError('console.warn');
        }
    };

    // NetworkMonitor 연동: 품질 변화 시 UI/로직 반응
    NetworkMonitor.onQualityChange((quality, prev) => {
        if (quality === 'good' && prev !== 'good') {
            // 연결 품질 복구 시 재전송 큐 처리
            setTimeout(() => _flushRetryQueue(), 1000);
        }
    });

    // 초기 상태 체크
    if (!navigator.onLine) {
        updateOnlineStatus();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 메뉴 및 UI 텍스트 복사 방지 (input/textarea 제외)
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('input, textarea')) e.preventDefault();
    });
    document.addEventListener('copy', (e) => {
        if (!e.target.closest('input, textarea')) e.preventDefault();
    });

    loadNavOrder();
    migrateCardOrder();
    loadStatusCardOrder();
    applyCardVisibility();
    initHamburgerMenu();
    initCardSelectModal();
    initTheme();
    bindEvents();
    // 로그인 화면 언어 적용 (저장된 언어 설정 기반)
    changeLanguage(AppState.currentLang);
    registerServiceWorker();
    initOfflineDetection();
    initRemoteConfig(); // Phase 2: A/B 테스트 Remote Config
    ConversionTracker.screenView(); // Phase 2: 로그인 화면 조회 계측

    // 앱 시작 즉시 네이티브 푸시 알림 클릭 리스너 등록 (콜드 스타트 대응)
    registerEarlyPushListeners();

    // 안드로이드 뒤로가기(하드웨어) 버튼 핸들러 등록
    registerBackButtonHandler();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (_initializedUid === user.uid) return; // 토큰 갱신 등 재발화 시 중복 초기화 방지

            // 이메일/비밀번호 사용자의 이메일 인증 확인 (Google OAuth 등은 건너뜀)
            const isEmailUser = user.providerData.some(p => p.providerId === 'password');
            if (isEmailUser && !user.emailVerified) {
                AppLogger.info('[Auth] 미인증 이메일 사용자 차단: ' + user.email);
                const lang = AppState.currentLang || 'ko';
                alert(i18n[lang]?.verify_login_blocked || "이메일 인증을 완료해주세요. 받은편지함을 확인하세요.");
                await fbSignOut(auth);
                return;
            }

            _initializedUid = user.uid;

            AppLogger.info('[Auth] 로그인 감지: ' + (user.email || user.uid));
            ConversionTracker.firstSession();
            await loadUserDataFromDB(user);
            ConversionTracker.onboardingDone();
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('app-container').classList.remove('d-none');
            document.getElementById('app-container').classList.add('d-flex');
            const loginPanel = document.getElementById('login-log-panel');
            if (loginPanel) loginPanel.style.display = 'none';

            // 최초 로그인 시 온보딩 가이드 표시
            showOnboardingGuide();

            // 관리자/로그 표시 설정 (Custom Claims 기반)
            const tokenResult = await getIdTokenResult(user);
            const isDev = tokenResult.claims.admin === true;
            const settingsLogCard = document.getElementById('settings-log-card');
            const adminLoggerToggleCard = document.getElementById('admin-logger-toggle-card');

            // 관리자 토글 카드는 관리자만 표시
            if (adminLoggerToggleCard) adminLoggerToggleCard.style.display = isDev ? 'block' : 'none';

            // Firestore에서 로그 공개 설정 읽기
            try {
                const configSnap = await getDoc(doc(db, "app_config", "settings"));
                const loggerVisible = configSnap.exists() ? (configSnap.data().loggerVisible === true) : false;

                if (isDev) {
                    // 관리자: 항상 로그 카드 표시, 토글 상태 반영
                    if (settingsLogCard) settingsLogCard.style.display = 'block';
                    const adminToggle = document.getElementById('admin-logger-toggle');
                    if (adminToggle) {
                        adminToggle.checked = loggerVisible;
                        document.getElementById('admin-logger-toggle-status').textContent = loggerVisible ? '모든 사용자에게 표시 중' : '관리자만 표시 중';
                    }
                } else {
                    // 일반 사용자: 토글 ON일 때만 로그 카드 표시
                    if (settingsLogCard) settingsLogCard.style.display = loggerVisible ? 'block' : 'none';
                }
            } catch(e) {
                console.warn('[Config] 로그 설정 로드 실패:', e);
                if (settingsLogCard) settingsLogCard.style.display = isDev ? 'block' : 'none';
            }

            document.querySelector('main').style.overflowY = 'auto';

            changeLanguage(AppState.currentLang);
            renderCalendar();
            updatePointUI();
            drawRadarChart();
            renderDDayList();
            renderDDayCaption();
            updateDungeonStatus();
            startRaidTimer();
            renderQuestList();
            fetchSocialData();

            renderWeeklyChallenges();
            renderRoulette();
            renderBonusExp();
            updateReelsResetTimer();

            updateStepCountUI();
            if (AppState.user.syncEnabled) { syncHealthData(false); }

            // OS 권한 상태와 앱 토글 동기화 (OS에서 차단/해제된 경우 토글 off)
            // ⚠️ 반드시 initPushNotifications보다 먼저 실행해야 올바른 pushEnabled 상태로 리스너 설정
            await syncToggleWithOSPermissions();

            initPushNotifications();

            // 콜드 스타트 시 대기 중인 알림 데이터 처리 (푸시 클릭으로 앱 진입 시)
            processPendingNotification();

            // 로그인 후 권한 요청 프롬프트 표시 (온보딩 완료 후 실행)
            if (!localStorage.getItem(ONBOARDING_STORAGE_KEY)) {
                // 온보딩이 표시될 예정이면, 종료 후 권한 요청
                window._pendingPermissionPrompts = true;
            } else {
                showPermissionPrompts();
            }
        } else {
            AppLogger.info('[Auth] 로그아웃 상태');
            _initializedUid = null;
            document.getElementById('login-screen').classList.remove('d-none');
            document.getElementById('app-container').classList.add('d-none');
            // 로그아웃 시 로그 패널 숨김 (개발자 외 접근 차단)
            const loginPanel = document.getElementById('login-log-panel');
            if (loginPanel) loginPanel.style.display = 'none';
        }
    });

    setInterval(() => {
        // updateDungeonStatus() 내부에서 syncGlobalDungeon()을 이미 호출하므로 별도 호출 불필요
        updateDungeonStatus();
    }, 30000);
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.getElementById('theme-toggle').checked = true;
        document.documentElement.setAttribute('data-theme', 'light');
    }
}

function showEmailLoginFields() {
    document.getElementById('login-pw').classList.remove('d-none');
    document.getElementById('btn-login-submit').classList.remove('d-none');
    if (AppState.isLoginMode) {
        document.getElementById('forgot-pw-link').classList.remove('d-none');
    } else {
        // 회원가입 모드: 비밀번호 확인도 동시 표시 (3단계 축소)
        document.getElementById('login-pw-confirm').classList.remove('d-none');
        document.getElementById('pw-hint').classList.remove('d-none');
    }
    ConversionTracker.track('funnel_email_field_focus');
}

// --- 온보딩 가이드 (최초 1회 노출) ---
const ONBOARDING_STORAGE_KEY = 'levelup_onboarding_seen';
const ONBOARDING_TOTAL_SLIDES = 5;
let _obCurrentSlide = 0;

function showOnboardingGuide() {
    if (localStorage.getItem(ONBOARDING_STORAGE_KEY)) return;
    const guide = document.getElementById('onboarding-guide');
    if (!guide) return;
    guide.classList.remove('d-none');
    _obCurrentSlide = 0;
    // 온보딩 언어 적용 (슬라이드 업데이트 전에 텍스트 설정)
    if (typeof changeLanguage === 'function') changeLanguage(AppState.currentLang);
    // DOM 레이아웃 완료 후 슬라이드 위치 적용
    requestAnimationFrame(() => { _obUpdateSlides(); });
    _obBindEvents();
}

function dismissOnboardingGuide() {
    const guide = document.getElementById('onboarding-guide');
    if (guide) guide.classList.add('d-none');
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
    // 온보딩 종료 후 안드로이드 권한 동의 팝업 표시
    if (window._pendingPermissionPrompts) {
        window._pendingPermissionPrompts = false;
        setTimeout(() => showPermissionPrompts(), 300);
    }
}

function _obUpdateSlides() {
    const slides = document.querySelectorAll('#onboarding-slides .onboarding-slide');
    slides.forEach((slide, i) => {
        const offset = (i - _obCurrentSlide) * 100;
        slide.style.transform = `translateX(${offset}%)`;
        // 현재 + 인접 슬라이드 visible (전환 애니메이션용)
        if (Math.abs(i - _obCurrentSlide) <= 1) {
            slide.classList.add('active');
        } else {
            slide.classList.remove('active');
        }
    });
    const pageEl = document.getElementById('onboarding-page');
    if (pageEl) pageEl.textContent = `${_obCurrentSlide + 1} / ${ONBOARDING_TOTAL_SLIDES}`;
    const prevBtn = document.getElementById('onboarding-prev');
    const nextBtn = document.getElementById('onboarding-next');
    if (prevBtn) prevBtn.disabled = _obCurrentSlide === 0;
    if (nextBtn) nextBtn.disabled = _obCurrentSlide === ONBOARDING_TOTAL_SLIDES - 1;
}

function _obBindEvents() {
    const closeBtn = document.getElementById('onboarding-close');
    const prevBtn = document.getElementById('onboarding-prev');
    const nextBtn = document.getElementById('onboarding-next');
    const startBtn = document.getElementById('onboarding-start-btn');
    const slidesContainer = document.getElementById('onboarding-slides');

    if (closeBtn) closeBtn.addEventListener('click', dismissOnboardingGuide);
    if (startBtn) startBtn.addEventListener('click', dismissOnboardingGuide);
    if (prevBtn) prevBtn.addEventListener('click', () => {
        if (_obCurrentSlide > 0) { _obCurrentSlide--; _obUpdateSlides(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
        if (_obCurrentSlide < ONBOARDING_TOTAL_SLIDES - 1) { _obCurrentSlide++; _obUpdateSlides(); }
    });

    // 터치 스와이프 지원
    let touchStartX = 0;
    let touchEndX = 0;
    if (slidesContainer) {
        slidesContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        slidesContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            const diff = touchStartX - touchEndX;
            if (Math.abs(diff) > 50) {
                if (diff > 0 && _obCurrentSlide < ONBOARDING_TOTAL_SLIDES - 1) {
                    _obCurrentSlide++; _obUpdateSlides();
                } else if (diff < 0 && _obCurrentSlide > 0) {
                    _obCurrentSlide--; _obUpdateSlides();
                }
            }
        }, { passive: true });
    }
}

function bindEvents() {
    document.getElementById('btn-login-submit').addEventListener('click', simulateLogin);
    document.getElementById('btn-google-login').addEventListener('click', simulateGoogleLogin);
    document.getElementById('auth-toggle-btn').addEventListener('click', toggleAuthMode);
    document.getElementById('login-email').addEventListener('focus', showEmailLoginFields);
    document.getElementById('btn-resend-verify').addEventListener('click', resendVerificationEmail);
    document.getElementById('btn-back-login').addEventListener('click', hideEmailVerificationNotice);
    document.getElementById('forgot-pw-link').addEventListener('click', handleForgotPassword);
    document.getElementById('login-pw').addEventListener('input', function() {
        const hint = document.getElementById('pw-hint');
        if (!hint.classList.contains('d-none')) {
            hint.classList.toggle('valid', validatePassword(this.value));
        }
    });

    document.querySelectorAll('.nav-item').forEach(el => {
        el.addEventListener('click', () => { if (!_navDragJustEnded) switchTab(el.dataset.tab, el); });
    });
    initNavDragReorder();
    initStatusCardReorder();

    document.getElementById('btn-edit-name').addEventListener('click', changePlayerName);
    document.getElementById('btn-edit-insta').addEventListener('click', changeInstaId);
    document.getElementById('imageUpload').addEventListener('change', loadProfileImage); 
    
    document.getElementById('prof-title-badge').addEventListener('click', openTitleModal);
    document.getElementById('btn-history-close').addEventListener('click', closeTitleModal);
    document.getElementById('btn-status-info').addEventListener('click', openStatusInfoModal);
    document.getElementById('btn-quest-info').addEventListener('click', openQuestInfoModal);
    document.getElementById('btn-diy-quest-info').addEventListener('click', openDiyQuestInfoModal);
    document.getElementById('btn-dungeon-info').addEventListener('click', openDungeonInfoModal);
    document.getElementById('btn-planner-info').addEventListener('click', openPlannerInfoModal);
    document.getElementById('btn-day1-info').addEventListener('click', openDay1InfoModal);
    document.getElementById('btn-settings-push-guide').addEventListener('click', () => openSettingsGuideModal('push'));
    document.getElementById('btn-settings-gps-guide').addEventListener('click', () => openSettingsGuideModal('gps'));
    document.getElementById('btn-settings-fitness-guide').addEventListener('click', () => openSettingsGuideModal('fitness'));
    document.getElementById('btn-settings-delete-guide').addEventListener('click', () => openSettingsGuideModal('delete'));
    document.getElementById('btn-info-close').addEventListener('click', closeInfoModal);

    document.getElementById('btn-levelup').addEventListener('click', processLevelUp); 
    document.querySelectorAll('.social-tab-btn').forEach(btn => { btn.addEventListener('click', () => toggleSocialMode(btn.dataset.mode, btn)); });
    document.querySelectorAll('.rank-tab-btn').forEach(btn => { btn.addEventListener('click', () => renderUsers(btn.dataset.sort, btn)); });

    document.getElementById('lang-select').addEventListener('change', (e) => changeLanguage(e.target.value));

    // 로그인 화면 언어 선택 버튼
    document.querySelectorAll('#login-lang-selector .login-lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.lang;
            changeLanguage(lang);
            updateLoginLangButtons(lang);
            document.getElementById('lang-select').value = lang;
        });
    });
    updateLoginLangButtons(AppState.currentLang);
    document.getElementById('theme-toggle').addEventListener('change', changeTheme);
    document.getElementById('push-toggle').addEventListener('change', togglePushNotifications);
    document.getElementById('gps-toggle').addEventListener('change', toggleGPS);
    document.getElementById('sync-toggle').addEventListener('change', toggleHealthSync);
    document.getElementById('camera-toggle').addEventListener('change', toggleCamera);
    document.getElementById('btn-settings-camera-guide').addEventListener('click', function() {
        const lang = i18n[AppState.currentLang];
        alert(lang.cam_guide || 'ISBN 바코드 스캔을 위해 카메라 권한이 필요합니다.\n내 서재에서 책을 스캔할 때 사용됩니다.');
    });
    document.getElementById('btn-logout').addEventListener('click', logout);
    document.getElementById('btn-delete-account').addEventListener('click', deleteMyAccount);

    // 관리자 로그 공개 토글
    document.getElementById('admin-logger-toggle').addEventListener('change', async function() {
        const visible = this.checked;
        try {
            await setDoc(doc(db, "app_config", "settings"), { loggerVisible: visible }, { merge: true });
            document.getElementById('admin-logger-toggle-status').textContent = visible ? '모든 사용자에게 표시 중' : '관리자만 표시 중';
        } catch(e) {
            console.error('[Config] 로그 설정 저장 실패:', e);
            this.checked = !visible; // 롤백
        }
    });

    document.getElementById('btn-myinfo').addEventListener('click', function() {
        document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
        document.getElementById('settings').classList.add('active');
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    });
    document.getElementById('btn-back-status').addEventListener('click', function() {
        var statusTab = document.querySelector('.nav-item[data-tab="status"]');
        switchTab('status', statusTab);
    });

    document.getElementById('btn-raid-action').addEventListener('click', window.simulateRaidAction);

    // Planner tab
    document.getElementById('btn-planner-save').addEventListener('click', savePlannerEntry);
    document.getElementById('btn-add-task').addEventListener('click', window.addPlannerTask);
    document.querySelectorAll('#planner-mood-selector .diary-mood-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#planner-mood-selector .diary-mood-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
    // 플래너 탭 전환 (우선순위 / 시간표)
    document.querySelectorAll('.planner-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.planner-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.planner-tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.getAttribute('data-planner-tab');
            const target = document.getElementById('planner-tab-' + tab);
            if (target) target.classList.add('active');
            // 탭에 따라 저장 영역 표시/숨김
            const prioritySave = document.getElementById('priority-save-area');
            if (prioritySave) prioritySave.style.display = tab === 'priority' ? 'block' : 'none';
        });
    });
    // 퀘스트 서브탭 전환 (퀘스트 / 통계)
    document.querySelectorAll('.quest-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.quest-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.quest-tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.getAttribute('data-quest-tab');
            const target = document.getElementById('quest-tab-' + tab);
            if (target) target.classList.add('active');
            if (tab === 'stats') renderQuestStats();
        });
    });
    // 퀘스트 통계 월/연 네비게이션
    document.getElementById('btn-qstats-prev-month').addEventListener('click', () => { _qstatsMonth.setMonth(_qstatsMonth.getMonth() - 1); renderQuestStats(); });
    document.getElementById('btn-qstats-next-month').addEventListener('click', () => { _qstatsMonth.setMonth(_qstatsMonth.getMonth() + 1); renderQuestStats(); });
    document.getElementById('btn-qstats-prev-year').addEventListener('click', () => { _qstatsYear--; renderQuestStats(); });
    document.getElementById('btn-qstats-next-year').addEventListener('click', () => { _qstatsYear++; renderQuestStats(); });
    // DIY 전용 통계 필터
    document.getElementById('qstats-diy-filter')?.addEventListener('change', (e) => { _qstatsDiyOnly = e.target.checked; renderQuestStats(); });

    document.getElementById('btn-raid-complete').addEventListener('click', window.completeDungeon);

    // Reels tab
    document.getElementById('btn-reels-post').addEventListener('click', postToReels);
    // 우선순위 탭 저장 버튼도 같은 저장 함수 연결
    const prioritySaveBtn = document.getElementById('btn-planner-save-priority');
    if (prioritySaveBtn) prioritySaveBtn.addEventListener('click', savePlannerEntry);
    // Planner photo upload
    document.getElementById('plannerPhotoUpload').addEventListener('change', loadPlannerPhoto);
    // Planner share button
    document.getElementById('btn-planner-share').addEventListener('click', openShareModal);
}

// --- 데이터 저장/로드 ---
function getCleanDiaryStrForFirestore() {
    try {
        const diaries = JSON.parse(localStorage.getItem('diary_entries') || '{}');
        const cleaned = {};
        for (const [dateStr, entry] of Object.entries(diaries)) {
            const { photo, ...rest } = entry;
            cleaned[dateStr] = rest;
        }
        return JSON.stringify(cleaned);
    } catch(e) { return '{}'; }
}

const USER_STAT_KEYS = ['str', 'int', 'cha', 'vit', 'wlth', 'agi'];
function normalizeStatsMapForFirestore(input) {
    const source = (input && typeof input === 'object') ? input : {};
    const normalized = {};
    USER_STAT_KEYS.forEach((key) => {
        const n = Number(source[key]);
        normalized[key] = Number.isFinite(n) && n >= 0 ? n : 0;
    });
    return normalized;
}

function normalizeStringArrayForFirestore(input, maxLen) {
    if (!Array.isArray(input)) return [];
    return input
        .filter(v => typeof v === 'string' && v.length > 0)
        .slice(0, maxLen);
}

function normalizeBooleanForFirestore(input) {
    return input === true;
}

let _saveDebounceTimer = null;
let _saveInFlight = false;
let _savePendingAfterFlight = false;
let _profileUploadInFlight = false; // 프로필 업로드 중 다른 save가 photoURL을 null로 덮어쓰는 것을 방지

async function saveUserData() {
    if(!auth.currentUser) {
        if (window.AppLogger) AppLogger.warn('[SaveData] auth.currentUser is null, skipping save');
        return;
    }
    // 디바운스: 연속 호출 시 마지막 호출만 실행 (2초 대기)
    if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
    if (_saveInFlight) { _savePendingAfterFlight = true; return; }
    _saveDebounceTimer = setTimeout(() => _doSaveUserData(), 2000);
}

async function _doSaveUserData() {
    _saveDebounceTimer = null;
    if(!auth.currentUser) return;
    _saveInFlight = true;
    try {
        const normalizedName = (typeof AppState.user.name === 'string' ? AppState.user.name.trim() : '') || '신규 헌터';
        const rawLevel = Number(AppState.user.level);
        const normalizedLevel = Number.isFinite(rawLevel) ? Math.max(1, Math.min(999, Math.floor(rawLevel))) : 1;
        const rawPoints = Number(AppState.user.points);
        const normalizedPoints = Number.isFinite(rawPoints) && rawPoints >= 0 ? rawPoints : 0;
        const rawNameLastChanged = AppState.user.nameLastChanged;
        const normalizedNameLastChanged =
            (typeof rawNameLastChanged === 'number' && Number.isFinite(rawNameLastChanged))
                ? rawNameLastChanged
                : null;
        const stepData = AppState.user.stepData || {};
        const normalizedStepData = {
            date: typeof stepData.date === 'string' ? stepData.date : '',
            rewardedSteps: (typeof stepData.rewardedSteps === 'number' && Number.isFinite(stepData.rewardedSteps) && stepData.rewardedSteps >= 0)
                ? stepData.rewardedSteps
                : 0,
            totalSteps: (typeof stepData.totalSteps === 'number' && Number.isFinite(stepData.totalSteps) && stepData.totalSteps >= 0)
                ? stepData.totalSteps
                : 0
        };
        const rawLastReelsPostTs = parseInt(localStorage.getItem('reels_last_post_ts') || '0', 10);
        const normalizedLastReelsPostTs = Number.isFinite(rawLastReelsPostTs) ? rawLastReelsPostTs : 0;
        const normalizedStats = normalizeStatsMapForFirestore(AppState.user.stats);
        const normalizedPendingStats = normalizeStatsMapForFirestore(AppState.user.pendingStats);
        const normalizedFriends = normalizeStringArrayForFirestore(AppState.user.friends, 500);

        const payload = {
            name: normalizedName,
            stats: normalizedStats,
            pendingStats: normalizedPendingStats,
            level: normalizedLevel,
            points: normalizedPoints,
            titleHistoryStr: JSON.stringify(AppState.user.titleHistory),
            questStr: JSON.stringify(AppState.quest.completedState),
            questWeekStart: AppState.quest.weekStart,
            dungeonStr: JSON.stringify(AppState.dungeon),
            friends: normalizedFriends,
            photoURL: (_profileUploadInFlight || isBase64Image(AppState.user.photoURL)) ? null : (AppState.user.photoURL || null),
            syncEnabled: normalizeBooleanForFirestore(AppState.user.syncEnabled),
            gpsEnabled: normalizeBooleanForFirestore(AppState.user.gpsEnabled),
            pushEnabled: normalizeBooleanForFirestore(AppState.user.pushEnabled),
            fcmToken: AppState.user.fcmToken || null,
            stepData: normalizedStepData,
            instaId: AppState.user.instaId || "",
            nameLastChanged: normalizedNameLastChanged,
            streakStr: JSON.stringify(AppState.user.streak),
            diaryStr: getCleanDiaryStrForFirestore(),
            lastRouletteDate: localStorage.getItem('roulette_date') || '',
            lastBonusExpDate: localStorage.getItem(_bonusExpKey()) || '',
            lastReelsPostTs: normalizedLastReelsPostTs,
            diyQuestsStr: JSON.stringify(AppState.diyQuests),
            questHistoryStr: JSON.stringify(AppState.questHistory),
            rareTitleStr: JSON.stringify(AppState.user.rareTitle),
            ddaysStr: JSON.stringify(AppState.ddays || []),
            ddayCaption: AppState.ddayCaption || '',
            lifeStatusStr: localStorage.getItem('life_status_config') || '',
            libraryStr: JSON.stringify(AppState.library || { books: [] })
        };
        // 진단: 페이로드 크기 및 photoURL 상태 로그
        const payloadSize = new Blob([JSON.stringify(payload)]).size;
        const photoType = payload.photoURL ? (payload.photoURL.startsWith('data:') ? 'base64' : payload.photoURL.startsWith('http') ? 'url' : 'other') : 'null';
        const photoLen = payload.photoURL ? payload.photoURL.length : 0;
        console.log(`[SaveData] uid=${auth.currentUser.uid}, payloadSize=${payloadSize}bytes, photoURL.type=${photoType}, photoURL.len=${photoLen}`);
        if (window.AppLogger) AppLogger.info(`[SaveData] size=${payloadSize}B, photo=${photoType}(${photoLen})`);
        await setDoc(doc(db, "users", auth.currentUser.uid), payload, { merge: true });
        console.log('[SaveData] setDoc OK');
        if (window.AppLogger) AppLogger.info('[SaveData] Firestore 저장 성공');
    } catch(e) {
        console.error("DB 저장 실패:", e);
        if (window.AppLogger) AppLogger.error('[DB] 저장 실패: ' + (e.code || '') + ' ' + (e.message || ''), e.stack || '');
    } finally {
        _saveInFlight = false;
        if (_savePendingAfterFlight) {
            _savePendingAfterFlight = false;
            saveUserData(); // 대기 중이던 저장 재시도
        }
    }
}

async function loadUserDataFromDB(user) {
    try {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            if(data.stats) AppState.user.stats = data.stats;
            if(data.level) {
                const raw = Number(data.level);
                AppState.user.level = Number.isFinite(raw) ? Math.max(1, Math.min(999, Math.floor(raw))) : 1;
            }
            if(data.points) {
                const raw = Number(data.points);
                AppState.user.points = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
            }
            if(data.titleHistoryStr) {
                try { AppState.user.titleHistory = JSON.parse(data.titleHistoryStr); } catch(e) { AppState.user.titleHistory = [{level:1, title:{ko:"각성자"}}]; }
            }
            if(data.questStr) {
                const savedWeek = data.questWeekStart || "";
                if(savedWeek === getWeekStartDate()) {
                    AppState.quest.completedState = JSON.parse(data.questStr);
                }
            }
            if(data.dungeonStr) {
                AppState.dungeon = JSON.parse(data.dungeonStr);
                if(!AppState.dungeon.maxParticipants) AppState.dungeon.maxParticipants = 5;
                if(AppState.dungeon.hasContributed === undefined) AppState.dungeon.hasContributed = false;
                if(!AppState.dungeon.bossMaxHP) AppState.dungeon.bossMaxHP = isBossRush() ? 10 : 5;
                if(AppState.dungeon.bossDamageDealt === undefined) AppState.dungeon.bossDamageDealt = 0;
                AppState.dungeon.globalParticipants = 0;
                AppState.dungeon.globalProgress = 0;
            }
            if(data.diyQuestsStr) {
                try { AppState.diyQuests = JSON.parse(data.diyQuestsStr); } catch(e) { AppState.diyQuests = { definitions: [], completedToday: {}, lastResetDate: null }; }
            }
            if(data.questHistoryStr) {
                try {
                    AppState.questHistory = JSON.parse(data.questHistoryStr);
                    const cutoff = new Date();
                    cutoff.setDate(cutoff.getDate() - 400);
                    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}-${String(cutoff.getDate()).padStart(2,'0')}`;
                    Object.keys(AppState.questHistory).forEach(k => { if (k < cutoffStr) delete AppState.questHistory[k]; });
                } catch(e) { AppState.questHistory = {}; }
            }
            checkDiyDailyReset();
            if(data.pendingStats) AppState.user.pendingStats = data.pendingStats;
            if(data.friends) AppState.user.friends = data.friends;
            if(data.syncEnabled !== undefined) AppState.user.syncEnabled = data.syncEnabled;
            if(data.gpsEnabled !== undefined) AppState.user.gpsEnabled = data.gpsEnabled;
            if(data.pushEnabled !== undefined) AppState.user.pushEnabled = data.pushEnabled;
            if(data.fcmToken) AppState.user.fcmToken = data.fcmToken;
            if(data.stepData) AppState.user.stepData = data.stepData;
            if(data.instaId) AppState.user.instaId = data.instaId;
            if(data.nameLastChanged) AppState.user.nameLastChanged = data.nameLastChanged;
            if(data.streakStr) {
                try { AppState.user.streak = JSON.parse(data.streakStr); } catch(e) { AppState.user.streak = { currentStreak: 0, lastActiveDate: null, multiplier: 1.0 }; }
            }
            if(data.rareTitleStr) {
                try { const parsed = JSON.parse(data.rareTitleStr); AppState.user.rareTitle = { unlocked: parsed.unlocked || [] }; } catch(e) { AppState.user.rareTitle = { unlocked: [] }; }
            }
            if(data.ddaysStr) {
                try { AppState.ddays = JSON.parse(data.ddaysStr); } catch(e) { AppState.ddays = []; }
            }
            if(data.ddayCaption !== undefined) {
                AppState.ddayCaption = data.ddayCaption || '';
            }
            // Library (내 서재) 복원
            if (data.libraryStr) {
                try { AppState.library = JSON.parse(data.libraryStr); } catch(e) { AppState.library = { books: [] }; }
                if (!AppState.library || !Array.isArray(AppState.library.books)) AppState.library = { books: [] };
                if (!Array.isArray(AppState.library.rewardedISBNs)) AppState.library.rewardedISBNs = [];
            }
            // Life Status 복원 (로그아웃 시 localStorage.clear() 대응)
            if (data.lifeStatusStr) {
                localStorage.setItem('life_status_config', data.lifeStatusStr);
            }
            // 스트릭 계산 및 스탯 감소
            applyStreakAndDecay();
            if(data.diaryStr) {
                try {
                    // 로컬 데이터가 더 최신일 수 있으므로 타임스탬프 기준으로 병합
                    const dbDiaries = JSON.parse(data.diaryStr);
                    let localDiaries = {};
                    try { localDiaries = JSON.parse(localStorage.getItem('diary_entries') || '{}'); } catch(e) {}
                    const merged = Object.assign({}, dbDiaries);
                    Object.keys(localDiaries).forEach(d => {
                        if (!merged[d] || (localDiaries[d].timestamp || 0) > (merged[d].timestamp || 0)) {
                            merged[d] = localDiaries[d];
                        }
                    });
                    localStorage.setItem('diary_entries', JSON.stringify(merged));
                } catch(e) {}
            }
            // 룰렛 스핀 날짜 복원 (로그아웃 시 localStorage.clear() 대응)
            if (data.lastRouletteDate) {
                localStorage.setItem('roulette_date', data.lastRouletteDate);
            }
            // 보너스 EXP 수령 날짜 복원
            if (data.lastBonusExpDate) {
                localStorage.setItem(`bonus_exp_date_${user.uid}`, data.lastBonusExpDate);
            }
            // 릴스 포스팅 타임스탬프 복원 (로그아웃 후에도 비활성화 유지)
            if (data.lastReelsPostTs) {
                const elapsed = Date.now() - data.lastReelsPostTs;
                if (elapsed < 24 * 60 * 60 * 1000) {
                    localStorage.setItem('reels_last_post_ts', String(data.lastReelsPostTs));
                    localStorage.setItem('reels_reward_ts', String(data.lastReelsPostTs));
                } else {
                    localStorage.removeItem('reels_last_post_ts');
                    localStorage.removeItem('reels_reward_ts');
                }
            }
            // 릴스 포스트 데이터 복원 (Firestore → localStorage) — 24시간 이내 포스트만
            if (data.reelsStr) {
                try {
                    const now = Date.now();
                    const userPosts = JSON.parse(data.reelsStr);
                    const activePosts = userPosts.filter(p => (now - (p.timestamp || 0)) < 24 * 60 * 60 * 1000);
                    if (activePosts.length > 0) {
                        const reelsLocal = JSON.parse(localStorage.getItem('reels_posts') || '{}');
                        if (!reelsLocal.posts) reelsLocal.posts = [];
                        reelsLocal._lastDate = getTodayKST();
                        activePosts.forEach(fp => {
                            if (!reelsLocal.posts.find(lp => lp.uid === fp.uid && lp.timestamp === fp.timestamp)) {
                                reelsLocal.posts.push(fp);
                            }
                        });
                        localStorage.setItem('reels_posts', JSON.stringify(reelsLocal));
                    }
                } catch(e) {}
            }
            document.getElementById('sync-toggle').checked = AppState.user.syncEnabled;
            document.getElementById('gps-toggle').checked = AppState.user.gpsEnabled;
            updateCameraToggleUI();
            const loadedName = data.name || user.displayName || "신규 헌터";
            // ── 기존 유저 닉네임 마이그레이션: usernames 컬렉션에 예약 ──
            if (window.AppLogger) AppLogger.info(`[NameMigration] 시작: "${loadedName}" (uid: ${user.uid.substring(0, 8)}...)`);
            try {
                const nameKey = normalizeNameKey(loadedName);
                const existingClaim = await getDoc(doc(db, "usernames", nameKey));
                if (!existingClaim.exists()) {
                    // 아직 아무도 예약하지 않음 → 선점
                    await claimUsername(loadedName, user.uid);
                    AppState.user.name = loadedName;
                    if (window.AppLogger) AppLogger.info(`[NameMigration] 선점 성공: "${loadedName}"`);
                } else if (existingClaim.data().uid === user.uid) {
                    // 본인이 이미 예약함 → 그대로 사용
                    AppState.user.name = loadedName;
                    if (window.AppLogger) AppLogger.info(`[NameMigration] 이미 본인 예약됨: "${loadedName}"`);
                } else {
                    // 다른 유저가 이미 점유 → 고유 닉네임 생성
                    const occupiedBy = existingClaim.data().uid.substring(0, 8);
                    if (window.AppLogger) AppLogger.warn(`[NameMigration] 충돌! "${loadedName}" → 점유자: ${occupiedBy}...`);
                    const uniqueName = await generateUniqueName(loadedName, user.uid);
                    await claimUsername(uniqueName, user.uid);
                    AppState.user.name = uniqueName;
                    if (window.AppLogger) AppLogger.info(`[NameMigration] 변경 완료: "${loadedName}" → "${uniqueName}"`);
                    // Firestore users/{uid}에도 즉시 반영
                    await setDoc(doc(db, "users", user.uid), { name: uniqueName }, { merge: true });
                }
            } catch (e) {
                console.warn('[NameMigration] 실패 (무시):', e.message);
                if (window.AppLogger) AppLogger.error(`[NameMigration] 실패: ${e.code || ''} ${e.message || ''}`, e.stack || '');
                AppState.user.name = loadedName;
            }
            console.log(`[LoadData] photoURL in Firestore: ${data.photoURL ? (data.photoURL.startsWith('http') ? 'url' : data.photoURL.startsWith('data:') ? 'base64' : 'other') + '(' + data.photoURL.length + ')' : 'MISSING'}`);
            if (window.AppLogger) AppLogger.info(`[LoadData] photoURL=${data.photoURL ? (data.photoURL.substring(0, 60) + '...') : 'null'}`);
            if(data.photoURL) {
                AppState.user.photoURL = data.photoURL;
                setProfilePreview(data.photoURL);
                // 기존 base64 프로필 이미지를 Cloud Storage로 자동 마이그레이션
                if (isBase64Image(data.photoURL) && auth.currentUser) {
                    _profileUploadInFlight = true;
                    uploadImageToStorage(`profile_images/${auth.currentUser.uid}/profile${getImageExtension()}`, data.photoURL)
                        .then(downloadURL => {
                            AppState.user.photoURL = downloadURL;
                            setProfilePreview(downloadURL);
                            _profileUploadInFlight = false;
                            saveUserData();
                        })
                        .catch(e => {
                            console.warn('[Migration] 프로필 이미지 마이그레이션 실패:', e);
                            if (window.AppLogger) AppLogger.error('[ProfileImg:ERR] 마이그레이션 실패: ' + (e.code || '') + ' ' + (e.message || ''));
                            AppState.user.photoURL = null;
                            _profileUploadInFlight = false;
                            saveUserData();
                        });
                }
            }
        } else {
            // 신규 유저: Auth 프로필에서 이름/사진 가져오고 Firestore 문서 생성
            const baseName = user.displayName || "신규 헌터";
            if (window.AppLogger) AppLogger.info(`[NewUser] 신규 가입: baseName="${baseName}" (uid: ${user.uid.substring(0, 8)}...)`);
            const uniqueName = await generateUniqueName(baseName, user.uid);
            await claimUsername(uniqueName, user.uid);
            AppState.user.name = uniqueName;
            if (window.AppLogger) AppLogger.info(`[NewUser] 닉네임 확정: "${uniqueName}"`);
            if (user.photoURL) {
                AppState.user.photoURL = user.photoURL;
                setProfilePreview(user.photoURL);
            }
            await saveUserData();
        }
        loadPlayerName();
    } catch(e) { console.error("데이터 로드 에러:", e); AppLogger.error('[DB] 데이터 로드 실패', e.stack || e.message); }
}

// --- 스트릭 시스템 ---
function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getDaysBetween(dateStr1, dateStr2) {
    if (!dateStr1 || !dateStr2) return Infinity;
    const d1 = new Date(dateStr1); d1.setHours(0,0,0,0);
    const d2 = new Date(dateStr2); d2.setHours(0,0,0,0);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function getStreakMultiplier(streak) {
    if (streak >= 30) return 3.0;
    if (streak >= 14) return 2.0;
    if (streak >= 7) return 1.5;
    if (streak >= 3) return 1.2;
    return 1.0;
}

function applyStreakAndDecay() {
    const today = getTodayStr();
    const lastActive = AppState.user.streak.lastActiveDate;
    // lastActiveDate가 없으면(신규 유저/기존 유저 최초) 감소 없이 오늘로 설정
    if (!lastActive) {
        AppState.user.streak.lastActiveDate = today;
        AppState.user.streak.multiplier = getStreakMultiplier(AppState.user.streak.currentStreak);
        renderStreakBadge();
        return;
    }
    const gap = getDaysBetween(lastActive, today);

    if (gap > 1) {
        // 스트릭 리셋
        if (AppState.user.streak.currentStreak > 0) {
            AppState.user.streak.currentStreak = 0;
        }
        // 3일 이상 미접속 시 스탯 감소 (최대 30일분으로 제한)
        if (gap > 3) {
            const decayDays = Math.min(gap - 3, 30);
            const decayAmount = decayDays * 0.1;
            let decayed = false;
            statKeys.forEach(k => {
                if (AppState.user.stats[k] > 0) {
                    AppState.user.stats[k] = Math.max(0, Number(AppState.user.stats[k]) - decayAmount);
                    decayed = true;
                }
            });
            if (decayed) {
                AppLogger.info(`[Streak] 스탯 감소 적용: ${decayDays}일 미접속, -${decayAmount.toFixed(1)}`);
            }
        }
    }
    AppState.user.streak.multiplier = getStreakMultiplier(AppState.user.streak.currentStreak);
    renderStreakBadge();
}

function updateStreak() {
    const today = getTodayStr();
    const lastActive = AppState.user.streak.lastActiveDate;

    if (lastActive === today) return; // 이미 오늘 활동함

    const gap = getDaysBetween(lastActive, today);
    if (gap === 1) {
        AppState.user.streak.currentStreak++;
    } else if (gap > 1 || !lastActive) {
        AppState.user.streak.currentStreak = 1;
    }

    AppState.user.streak.lastActiveDate = today;
    AppState.user.streak.multiplier = getStreakMultiplier(AppState.user.streak.currentStreak);
    renderStreakBadge();
    // 스트릭 도전과제 업데이트 (현재 스트릭 값을 직접 설정)
    const chData = getWeeklyChallenges();
    const streakCh = chData.challenges.find(c => c.id === 'streak_days');
    if (streakCh && !streakCh.claimed) {
        streakCh.progress = Math.min(streakCh.target, AppState.user.streak.currentStreak);
        localStorage.setItem('weekly_challenges', JSON.stringify(chData));
    }
    // 스트릭 기반 희귀 호칭 체크
    checkStreakRareTitles();
}

function renderStreakBadge() {
    const badge = document.getElementById('streak-badge');
    const countEl = document.getElementById('streak-count');
    const dayLabel = document.getElementById('streak-day-label');
    if (!badge || !countEl) return;

    const streak = AppState.user.streak.currentStreak;
    if (streak > 0) {
        badge.classList.remove('d-none');
        badge.classList.toggle('fire', streak >= 7);
        countEl.textContent = streak;
        if (dayLabel) dayLabel.textContent = i18n[AppState.currentLang]?.streak_day || '일';
    } else {
        badge.classList.add('d-none');
    }
}

// --- ★ 희귀 호칭 시스템 ★ ---

// 우선순위: rank_global > rank_stat > streak > steps (높을수록 우선)
const _rarePriority = { rank_global: 40, rank_stat: 30, streak: 20, steps: 10, reading: 10 };

// 우선순위에 따라 자동으로 가장 높은 희귀 호칭 반환
function getBestRareTitle() {
    const unlocked = AppState.user.rareTitle.unlocked;
    if (unlocked.length === 0) return null;
    const rarityOrder = ['uncommon', 'rare', 'epic', 'legendary'];
    return [...unlocked].sort((a, b) => {
        const pDiff = (_rarePriority[b.type] || 0) - (_rarePriority[a.type] || 0);
        if (pDiff !== 0) return pDiff;
        return rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity);
    })[0] || null;
}

// 스트릭 마일스톤 달성 시 희귀 호칭 해금 체크
function checkStreakRareTitles() {
    const streak = AppState.user.streak.currentStreak;
    let newUnlock = false;
    rareStreakTitles.forEach(rt => {
        const titleId = `streak_${rt.days}`;
        if (streak >= rt.days && !AppState.user.rareTitle.unlocked.find(u => u.id === titleId)) {
            AppState.user.rareTitle.unlocked.push({
                id: titleId, type: 'streak', rarity: rt.rarity, icon: rt.icon,
                title: rt.title, unlockedAt: new Date().toISOString()
            });
            newUnlock = true;
            AppLogger.info(`[RareTitle] 스트릭 희귀 호칭 해금: ${rt.title.ko} (${rt.days}일)`);
        }
    });
    if (newUnlock) {
        saveUserData();
        updatePointUI();
        const newest = AppState.user.rareTitle.unlocked[AppState.user.rareTitle.unlocked.length - 1];
        showRareTitleNotification(newest);
    }
}

// 걸음수 마일스톤 달성 시 희귀 호칭 해금 체크
function checkStepRareTitles() {
    const steps = Number(AppState.user.stepData?.totalSteps) || 0;
    let newUnlock = false;
    rareStepTitles.forEach(rt => {
        const titleId = `steps_${rt.steps}`;
        if (steps >= rt.steps && !AppState.user.rareTitle.unlocked.find(u => u.id === titleId)) {
            AppState.user.rareTitle.unlocked.push({
                id: titleId, type: 'steps', rarity: rt.rarity, icon: rt.icon,
                title: rt.title, unlockedAt: new Date().toISOString()
            });
            newUnlock = true;
            AppLogger.info(`[RareTitle] 걸음수 희귀 호칭 해금: ${rt.title.ko} (${rt.steps}보)`);
        }
    });
    if (newUnlock) {
        saveUserData();
        updatePointUI();
        const newest = AppState.user.rareTitle.unlocked[AppState.user.rareTitle.unlocked.length - 1];
        showRareTitleNotification(newest);
    }
}

// 독서 마일스톤 달성 시 희귀 호칭 해금 체크
function checkReadingRareTitles() {
    const readCount = (AppState.library?.books || []).filter(b => b.category === 'read').length;
    let newUnlock = false;
    rareReadingTitles.forEach(rt => {
        const titleId = `reading_${rt.books}`;
        if (readCount >= rt.books && !AppState.user.rareTitle.unlocked.find(u => u.id === titleId)) {
            AppState.user.rareTitle.unlocked.push({
                id: titleId, type: 'reading', rarity: rt.rarity, icon: rt.icon,
                title: rt.title, unlockedAt: new Date().toISOString()
            });
            newUnlock = true;
            AppLogger.info(`[RareTitle] 독서 희귀 호칭 해금: ${rt.title.ko} (${rt.books}권)`);
        }
    });
    if (newUnlock) {
        saveUserData();
        updatePointUI();
        const newest = AppState.user.rareTitle.unlocked[AppState.user.rareTitle.unlocked.length - 1];
        showRareTitleNotification(newest);
    }
}

// 소셜 랭킹 기반 희귀 호칭 평가 (fetchSocialData 후 호출)
function checkRankRareTitles() {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const users = AppState.social.users.map(u => {
        const s = u.stats;
        const total = Math.round(Number(s.str)||0) + Math.round(Number(s.int)||0) + Math.round(Number(s.cha)||0) + Math.round(Number(s.vit)||0) + Math.round(Number(s.wlth)||0) + Math.round(Number(s.agi)||0);
        return { ...u, total, str:Math.round(Number(s.str)||0), int:Math.round(Number(s.int)||0), cha:Math.round(Number(s.cha)||0), vit:Math.round(Number(s.vit)||0), wlth:Math.round(Number(s.wlth)||0), agi:Math.round(Number(s.agi)||0) };
    });
    if (users.length === 0) return;

    let changed = false;

    // 글로벌 종합 순위 체크
    const globalSorted = [...users].sort((a, b) => b.total - a.total);
    const myGlobalRank = globalSorted.findIndex(u => u.id === uid) + 1;

    // 기존 글로벌 호칭 제거 후 해당 순위면 다시 추가
    const hadGlobal = AppState.user.rareTitle.unlocked.filter(u => u.type === 'rank_global');
    AppState.user.rareTitle.unlocked = AppState.user.rareTitle.unlocked.filter(u => u.type !== 'rank_global');
    const myGlobalEntry = rareRankTitles.global.find(rt => rt.rank === myGlobalRank);
    if (myGlobalEntry) {
        AppState.user.rareTitle.unlocked.push({
            id: `global_rank_${myGlobalEntry.rank}`, type: 'rank_global', rarity: myGlobalEntry.rarity, icon: myGlobalEntry.icon,
            title: myGlobalEntry.title, unlockedAt: new Date().toISOString()
        });
        if (!hadGlobal.find(h => h.id === `global_rank_${myGlobalEntry.rank}`)) changed = true;
    } else if (hadGlobal.length > 0) { changed = true; }

    // 스탯별 1위 체크
    statKeys.forEach(stat => {
        const sorted = [...users].sort((a, b) => b[stat] - a[stat]);
        const myRank = sorted.findIndex(u => u.id === uid) + 1;
        const titleId = `stat_rank_${stat}`;
        const had = AppState.user.rareTitle.unlocked.find(u => u.id === titleId);

        if (myRank === 1 && sorted[0][stat] > 0) {
            if (!had) {
                AppState.user.rareTitle.unlocked.push({
                    id: titleId, type: 'rank_stat', rarity: rareRankTitles.stat[stat].rarity,
                    icon: rareRankTitles.stat[stat].icon, title: rareRankTitles.stat[stat].title,
                    stat: stat, unlockedAt: new Date().toISOString()
                });
                changed = true;
            }
        } else if (had) {
            AppState.user.rareTitle.unlocked = AppState.user.rareTitle.unlocked.filter(u => u.id !== titleId);
            changed = true;
        }
    });

    if (changed) {
        saveUserData();
        updatePointUI();
    }
}

// 현재 표시할 호칭 텍스트와 아이콘 반환 (기존 호칭 + 최고 우선순위 희귀 호칭 자동 병렬)
function getDisplayTitle() {
    const lang = AppState.currentLang;
    const titleObj = AppState.user.titleHistory[AppState.user.titleHistory.length - 1]?.title;
    const baseText = titleObj ? (typeof titleObj === 'object' ? titleObj[lang] || titleObj.ko : titleObj) : '각성자';
    const baseIcon = getTitleIcon(baseText);
    const best = getBestRareTitle();
    if (best) {
        const rareText = best.title[lang] || best.title.ko;
        return { baseText, baseIcon, rareText, rareIcon: best.icon, rarity: best.rarity, isRare: true };
    }
    return { baseText, baseIcon, rareText: null, rareIcon: null, rarity: null, isRare: false };
}

// 희귀 호칭 해금 알림 표시
function showRareTitleNotification(rareTitle) {
    const lang = AppState.currentLang;
    const titleText = rareTitle.title[lang] || rareTitle.title.ko;
    const rarityLabel = rarityConfig[rareTitle.rarity]?.label[lang] || rareTitle.rarity;
    const msg = `${rareTitle.icon} ${i18n[lang]?.rare_title_unlocked || '희귀 호칭 획득!'}\n[${rarityLabel}] ${titleText}`;
    alert(msg);
}

// --- 크리티컬 히트 & 루트 드롭 ---
function rollCritical() {
    return Math.random() < 0.15; // 15% 확률
}

function getCriticalMultiplier() {
    return Math.random() < 0.3 ? 3 : 2; // 30%=3배, 70%=2배
}

function showCriticalFlash() {
    const flash = document.getElementById('critical-flash');
    if (!flash) return;
    flash.classList.remove('d-none', 'show');
    void flash.offsetWidth; // reflow
    flash.classList.add('show');
    setTimeout(() => { flash.classList.add('d-none'); flash.classList.remove('show'); }, 700);
}

function rollLootDrop() {
    const totalWeight = lootTable.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const item of lootTable) {
        roll -= item.weight;
        if (roll <= 0) return item;
    }
    return lootTable[0];
}

function applyLootReward(loot) {
    const lang = AppState.currentLang;
    if (loot.reward.type === 'points') {
        AppState.user.points += loot.reward.value;
    } else if (loot.reward.type === 'stat_boost') {
        if (loot.reward.stat === 'all') {
            statKeys.forEach(k => { AppState.user.pendingStats[k] += loot.reward.value; });
        } else {
            const randomStat = statKeys[Math.floor(Math.random() * statKeys.length)];
            AppState.user.pendingStats[randomStat] += loot.reward.value;
        }
    }
}

function showLootModal(loot) {
    const lang = AppState.currentLang;
    const modal = document.getElementById('lootModal');
    const tierLabel = document.getElementById('loot-tier-label');
    const nameEl = document.getElementById('loot-name');
    const descEl = document.getElementById('loot-desc');
    const iconEl = document.getElementById('loot-icon');
    if (!modal) return;

    const tierNames = { common: i18n[lang]?.loot_common || 'Common', uncommon: i18n[lang]?.loot_uncommon || 'Uncommon', rare: i18n[lang]?.loot_rare || 'Rare', legendary: i18n[lang]?.loot_legendary || 'Legendary' };
    const tierIcons = { common: '\u{1F381}', uncommon: '\u{1F48E}', rare: '\u{2728}', legendary: '\u{1F451}' };

    tierLabel.textContent = tierNames[loot.tier];
    tierLabel.className = 'loot-tier-label ' + loot.tier;
    iconEl.textContent = tierIcons[loot.tier];
    nameEl.textContent = loot.name[lang] || loot.name.ko;

    let desc = '';
    if (loot.reward.type === 'points') {
        desc = `+${loot.reward.value} P`;
    } else if (loot.reward.type === 'stat_boost') {
        desc = loot.reward.stat === 'all'
            ? `${i18n[lang]?.loot_stat_boost || 'Stat Boost'}: ALL +${loot.reward.value}`
            : `${i18n[lang]?.loot_stat_boost || 'Stat Boost'}: +${loot.reward.value}`;
    }
    descEl.textContent = desc;

    modal.classList.remove('d-none');
    modal.classList.add('d-flex');
}

function checkDailyAllClear() {
    const day = AppState.quest.currentDayOfWeek;
    const regularAllDone = AppState.quest.completedState[day].every(v => v);
    if (!regularAllDone) return;

    const diyDefs = AppState.diyQuests.definitions;
    const diyAllDone = diyDefs.length === 0 || diyDefs.every(q => AppState.diyQuests.completedToday[q.id]);
    if (!diyAllDone) return;

    // 오늘 이미 루트 받았는지 확인
    const todayKey = 'loot_' + getTodayStr();
    if (localStorage.getItem(todayKey)) return;
    localStorage.setItem(todayKey, '1');

    const loot = rollLootDrop();
    applyLootReward(loot);
    updateChallengeProgress('all_clear_days');
    saveUserData();
    updatePointUI();
    showLootModal(loot);
}

function loadPlayerName() {
    const nameEl = document.getElementById('prof-name');
    if(nameEl) {
        nameEl.textContent = AppState.user.name;
        nameEl.removeAttribute('data-i18n');
    }
}

// --- 닉네임 중복 방지 시스템 (usernames 컬렉션) ---
// usernames/{normalizedName} → { uid, name, claimedAt }
// Firestore 보안 규칙으로 원자적 유일성 보장

function normalizeNameKey(name) {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function claimUsername(name, uid) {
    const key = normalizeNameKey(name);
    if (!key) return false;
    if (window.AppLogger) AppLogger.info(`[ClaimName] 시도: "${name}" (key: "${key}", uid: ${uid.substring(0, 8)}...)`);
    try {
        await setDoc(doc(db, "usernames", key), {
            uid: uid,
            name: name.trim(),
            claimedAt: Date.now()
        });
        if (window.AppLogger) AppLogger.info(`[ClaimName] 성공: "${name}"`);
        return true;
    } catch (e) {
        if (e.code === 'permission-denied') {
            if (window.AppLogger) AppLogger.warn(`[ClaimName] 거부 (이미 점유됨): "${name}" — ${e.code}`);
            return false;
        }
        console.error("[ClaimName] 닉네임 예약 실패:", e);
        if (window.AppLogger) AppLogger.error(`[ClaimName] 예약 실패: ${e.code || ''} ${e.message || ''}`, e.stack || '');
        throw e;
    }
}

async function releaseUsername(name) {
    const key = normalizeNameKey(name);
    if (!key) return;
    if (window.AppLogger) AppLogger.info(`[ReleaseName] 해제 시도: "${name}" (key: "${key}")`);
    try {
        await deleteDoc(doc(db, "usernames", key));
        if (window.AppLogger) AppLogger.info(`[ReleaseName] 해제 성공: "${name}"`);
    } catch (e) {
        console.warn("[ReleaseName] 닉네임 해제 실패 (무시):", e.message);
        if (window.AppLogger) AppLogger.warn(`[ReleaseName] 해제 실패: "${name}" — ${e.code || ''} ${e.message || ''}`);
    }
}

async function isUsernameAvailable(name, currentUid) {
    const key = normalizeNameKey(name);
    if (!key) return false;
    try {
        const snap = await getDoc(doc(db, "usernames", key));
        if (!snap.exists()) return true;
        return snap.data().uid === currentUid;
    } catch (e) {
        console.error("[NameCheck] 닉네임 확인 실패:", e);
        return false;
    }
}

async function generateUniqueName(baseName, uid) {
    if (await isUsernameAvailable(baseName, uid)) return baseName;
    for (let i = 2; i <= 99; i++) {
        const candidate = `${baseName}#${i}`;
        if (await isUsernameAvailable(candidate, uid)) return candidate;
    }
    return `${baseName}#${uid.substring(0, 6)}`;
}

async function changePlayerName() {
    // 1개월(30일) 쿨다운 체크
    if (AppState.user.nameLastChanged) {
        const ts = typeof AppState.user.nameLastChanged === 'number'
            ? AppState.user.nameLastChanged
            : Date.parse(AppState.user.nameLastChanged);
        const lastChanged = new Date(Number.isFinite(ts) ? ts : 0);
        const now = new Date();
        const diffDays = (now - lastChanged) / (1000 * 60 * 60 * 24);
        if (diffDays < 30) {
            alert(i18n[AppState.currentLang].name_err || "명칭 변경은 1개월에 한 번만 가능합니다.");
            return;
        }
    }
    const newName = prompt(i18n[AppState.currentLang].name_prompt || "닉네임 변경", AppState.user.name);
    if (newName && newName.trim() !== "" && newName.trim() !== AppState.user.name) {
        const trimmed = newName.trim();
        if (trimmed.length > 50) {
            alert("닉네임은 50자 이내로 입력해주세요.");
            return;
        }
        try {
            const oldName = AppState.user.name;
            if (window.AppLogger) AppLogger.info(`[NameChange] 변경 시도: "${oldName}" → "${trimmed}"`);
            const claimed = await claimUsername(trimmed, auth.currentUser.uid);
            if (!claimed) {
                if (window.AppLogger) AppLogger.warn(`[NameChange] 중복 차단: "${trimmed}"`);
                alert(i18n[AppState.currentLang].name_dup || "이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.");
                return;
            }
            await releaseUsername(oldName);
            AppState.user.name = trimmed;
            AppState.user.nameLastChanged = Date.now();
            loadPlayerName();
            updateSocialUserData();
            saveUserData();
            if (window.AppLogger) AppLogger.info(`[NameChange] 변경 완료: "${oldName}" → "${trimmed}"`);
        } catch (e) {
            console.error("[NameChange] 닉네임 변경 실패:", e);
            if (window.AppLogger) AppLogger.error(`[NameChange] 실패: ${e.code || ''} ${e.message || ''}`, e.stack || '');
            alert("닉네임 변경 중 오류가 발생했습니다. 다시 시도해주세요.");
        }
    }
}

function changeInstaId() {
    const newId = prompt(i18n[AppState.currentLang].insta_prompt || "인스타 ID를 입력하세요", AppState.user.instaId);
    if (newId !== null) {
        AppState.user.instaId = newId.trim().replace('@', '');
        updateSocialUserData();
        saveUserData();
    }
}

// --- 스탯 레이더 ---
function drawRadarChart() {
    const centerX = 50, centerY = 50, radius = 33; 
    const angles = []; 
    for(let i=0; i<6; i++) angles.push(-Math.PI / 2 + (i * Math.PI / 3));
    
    const gridGroup = document.getElementById('radarGrid'); 
    const axesGroup = document.getElementById('radarAxes');
    
    if(gridGroup.innerHTML === '') { 
        let gridHtml = ''; let axesHtml = '';
        for (let level = 1; level <= 5; level++) {
            const r = radius * (level / 5); let points = "";
            for (let i = 0; i < 6; i++) points += `${centerX + r * Math.cos(angles[i])},${centerY + r * Math.sin(angles[i])} `;
            gridHtml += `<polygon points="${points.trim()}" class="radar-bg-line"></polygon>`;
        }
        for (let i = 0; i < 6; i++) axesHtml += `<line x1="50" y1="50" x2="${centerX + radius * Math.cos(angles[i])}" y2="${centerY + radius * Math.sin(angles[i])}" class="radar-bg-line"></line>`;
        gridGroup.innerHTML = gridHtml; axesGroup.innerHTML = axesHtml;
    }
    
    const pointsGroup = document.getElementById('radarPoints'); 
    const labelsGroup = document.getElementById('radarLabels');
    let pointsHtml = ''; let labelsHtml = ''; let dataPoints = ""; let totalSum = 0;
    
    for (let i = 0; i < 6; i++) {
        const key = statKeys[i]; 
        const val = Math.round(Number(AppState.user.stats[key]) || 0);
        totalSum += val;
        
        const r = radius * (val / 100); 
        const x = centerX + r * Math.cos(angles[i]); 
        const y = centerY + r * Math.sin(angles[i]);
        dataPoints += `${x},${y} `; 
        pointsHtml += `<circle cx="${x}" cy="${y}" r="1.2" class="radar-point"></circle>`;
        
        const labelRadius = radius + 9; 
        const lx = centerX + labelRadius * Math.cos(angles[i]); 
        const ly = centerY + labelRadius * Math.sin(angles[i]) + 2; 
        let anchor = "middle"; 
        if(i===1 || i===2) anchor = "start"; 
        if(i===4 || i===5) anchor = "end";   
        
        labelsHtml += `<text x="${lx}" y="${ly - 3}" text-anchor="${anchor}" class="radar-label">${i18n[AppState.currentLang][key]}</text><text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" class="radar-value">${val}</text>`;
    }
    
    pointsGroup.innerHTML = pointsHtml; 
    labelsGroup.innerHTML = labelsHtml;
    
    const playerPolygon = document.getElementById('playerPolygon');
    if(!playerPolygon.getAttribute('points')) playerPolygon.setAttribute('points', "50,50 50,50 50,50 50,50 50,50 50,50"); 
    setTimeout(() => { playerPolygon.setAttribute('points', dataPoints.trim()); }, 50);
    
    const totalScoreEl = document.getElementById('totalScore');
    if(totalScoreEl) totalScoreEl.innerHTML = `${totalSum}`;
}

// --- 퀘스트 로직 ---
function renderQuestList() {
    const container = document.getElementById('quest-list-container');
    if(!container) return;
    
    const day = AppState.quest.currentDayOfWeek;
    const quests = weeklyQuestData[day];
    
    container.innerHTML = quests.map((q, i) => {
        const isDone = AppState.quest.completedState[day][i];
        return `
            <div class="quest-row ${isDone ? 'done' : ''}" onclick="window.toggleQuest(${i})">
                <div>
                    <div class="quest-title"><span class="quest-stat-tag">${q.stat}</span>${q.title[AppState.currentLang]}</div>
                    <div class="quest-desc">${q.desc[AppState.currentLang]}</div>
                </div>
                <div class="quest-checkbox"></div>
            </div>
        `;
    }).join('');

    renderDiyQuestList();
}

// --- 퀘스트 히스토리 스냅샷 ---
function updateQuestHistory() {
    const today = getTodayKST();
    const day = AppState.quest.currentDayOfWeek;
    const regularCompleted = AppState.quest.completedState[day].filter(v => v).length;
    const diyCompleted = Object.values(AppState.diyQuests.completedToday).filter(v => v).length;
    const totalPossible = 12 + AppState.diyQuests.definitions.length;
    const diyTotal = AppState.diyQuests.definitions.length;
    AppState.questHistory[today] = { r: regularCompleted, d: diyCompleted, t: totalPossible, dt: diyTotal };
}

window.toggleQuest = (i) => {
    const day = AppState.quest.currentDayOfWeek;
    const state = AppState.quest.completedState[day];
    state[i] = !state[i];

    const q = weeklyQuestData[day][i];
    const factor = state[i] ? 1 : -1;
    const mult = AppState.user.streak.multiplier || 1.0;

    let pointReward = 20;
    let statReward = 0.5;
    let isCritical = false;

    if (state[i] && rollCritical()) {
        isCritical = true;
        const critMult = getCriticalMultiplier();
        pointReward = 20 * critMult;
        statReward = 0.5 * critMult;
        showCriticalFlash();
        updateChallengeProgress('critical_hits');
    }

    AppState.user.points += Math.floor(pointReward * mult * factor);
    AppState.user.pendingStats[q.stat.toLowerCase()] += (statReward * factor);

    if (state[i]) {
        updateStreak();
        updateChallengeProgress('quest_count');
    }

    updateQuestHistory();
    saveUserData();
    renderQuestList();
    renderCalendar();
    updatePointUI();
    renderRoulette();

    if (isCritical) {
        setTimeout(() => {
            const rows = document.querySelectorAll('.quest-row');
            if (rows[i]) rows[i].classList.add('critical-reward');
            setTimeout(() => { if (rows[i]) rows[i].classList.remove('critical-reward'); }, 1000);
        }, 50);
    }

    if (state[i]) checkDailyAllClear();
};

// --- DIY 퀘스트 ---
function checkDiyDailyReset() {
    const today = getTodayKST();
    if (AppState.diyQuests.lastResetDate !== today) {
        AppState.diyQuests.completedToday = {};
        AppState.diyQuests.lastResetDate = today;
    }
}

function renderDiyQuestList() {
    const container = document.getElementById('diy-quest-list');
    const section = document.getElementById('diy-quest-section');
    if (!container || !section) return;

    checkDiyDailyReset();
    const defs = AppState.diyQuests.definitions;

    section.style.display = (defs.length > 0) ? 'block' : 'block';

    container.innerHTML = defs.map(q => {
        const isDone = AppState.diyQuests.completedToday[q.id] || false;
        return `
            <div class="quest-row ${isDone ? 'done' : ''}" onclick="window.toggleDiyQuest('${q.id}')">
                <div>
                    <div class="quest-title"><span class="quest-stat-tag">${sanitizeText(q.stat)}</span>${sanitizeText(q.title)}</div>
                    <div class="quest-desc">${sanitizeText(q.desc)}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="diy-quest-edit" onclick="event.stopPropagation(); window.showDiyQuestModal('${q.id}')">✎</span>
                    <div class="quest-checkbox"></div>
                </div>
            </div>
        `;
    }).join('');
}

window.toggleDiyQuest = (questId) => {
    const q = AppState.diyQuests.definitions.find(d => d.id === questId);
    if (!q) return;

    const wasCompleted = AppState.diyQuests.completedToday[questId] || false;
    AppState.diyQuests.completedToday[questId] = !wasCompleted;
    const factor = wasCompleted ? -1 : 1;
    const mult = AppState.user.streak.multiplier || 1.0;

    let pointReward = 20;
    let statReward = 0.5;
    let isCritical = false;

    if (!wasCompleted && rollCritical()) {
        isCritical = true;
        const critMult = getCriticalMultiplier();
        pointReward = 20 * critMult;
        statReward = 0.5 * critMult;
        showCriticalFlash();
        updateChallengeProgress('critical_hits');
    }

    AppState.user.points += Math.floor(pointReward * mult * factor);
    AppState.user.pendingStats[q.stat.toLowerCase()] += (statReward * factor);

    if (!wasCompleted) {
        updateStreak();
        updateChallengeProgress('quest_count');
    }

    updateQuestHistory();
    saveUserData();
    renderDiyQuestList();
    renderCalendar();
    updatePointUI();
    renderRoulette();

    if (!wasCompleted) checkDailyAllClear();
};

window.showDiyQuestModal = (questId) => {
    const modal = document.getElementById('diyQuestModal');
    if (!modal) return;

    const isEdit = !!questId;
    const existing = isEdit ? AppState.diyQuests.definitions.find(d => d.id === questId) : null;

    if (!isEdit && AppState.diyQuests.definitions.length >= 6) {
        const lang = AppState.currentLang;
        alert(i18n[lang]?.diy_limit_reached || 'Max 6 custom quests');
        return;
    }

    const titleInput = document.getElementById('diy-title-input');
    const descInput = document.getElementById('diy-desc-input');
    const modalTitle = document.getElementById('diy-modal-title');
    const deleteBtn = document.getElementById('diy-btn-delete');

    if (titleInput) titleInput.value = existing ? existing.title : '';
    if (descInput) descInput.value = existing ? existing.desc : '';
    if (modalTitle) {
        const lang = AppState.currentLang;
        modalTitle.textContent = isEdit ? (i18n[lang]?.diy_modal_edit || 'Edit Quest') : (i18n[lang]?.diy_modal_create || 'Create Quest');
    }
    if (deleteBtn) deleteBtn.style.display = isEdit ? 'inline-block' : 'none';

    // 스탯 선택 초기화
    document.querySelectorAll('.diy-stat-btn').forEach(btn => {
        btn.classList.toggle('active', existing && btn.dataset.stat === existing.stat);
    });

    modal.dataset.editId = questId || '';
    modal.classList.remove('d-none');
    modal.classList.add('d-flex');
};

window.saveDiyQuest = () => {
    const modal = document.getElementById('diyQuestModal');
    const titleInput = document.getElementById('diy-title-input');
    const descInput = document.getElementById('diy-desc-input');
    const activeStatBtn = document.querySelector('.diy-stat-btn.active');

    const title = (titleInput?.value || '').trim();
    const desc = (descInput?.value || '').trim();
    const stat = activeStatBtn?.dataset.stat;

    if (!title) return;
    if (!stat) return;

    const editId = modal?.dataset.editId;
    const lang = AppState.currentLang;

    // 중복 명칭 체크
    const duplicate = AppState.diyQuests.definitions.find(d =>
        d.title.trim().toLowerCase() === title.toLowerCase() && d.id !== editId
    );
    if (duplicate) {
        alert(i18n[lang]?.diy_duplicate_name || '같은 이름의 퀘스트가 이미 존재합니다.');
        return;
    }

    if (editId) {
        const q = AppState.diyQuests.definitions.find(d => d.id === editId);
        if (q) {
            q.title = title;
            q.desc = desc;
            q.stat = stat;
        }
    } else {
        AppState.diyQuests.definitions.push({
            id: 'diy_' + Date.now(),
            title: title,
            desc: desc,
            stat: stat,
            createdAt: Date.now()
        });
    }

    saveUserData();
    renderDiyQuestList();
    renderCalendar();
    closeDiyQuestModal();
};

window.deleteDiyQuest = () => {
    const modal = document.getElementById('diyQuestModal');
    const editId = modal?.dataset.editId;
    if (!editId) return;

    const lang = AppState.currentLang;
    if (!confirm(i18n[lang]?.diy_confirm_delete || 'Delete this quest?')) return;

    AppState.diyQuests.definitions = AppState.diyQuests.definitions.filter(d => d.id !== editId);
    delete AppState.diyQuests.completedToday[editId];

    saveUserData();
    renderDiyQuestList();
    renderCalendar();
    closeDiyQuestModal();
};

window.closeDiyQuestModal = function() {
    const modal = document.getElementById('diyQuestModal');
    if (modal) {
        modal.classList.add('d-none');
        modal.classList.remove('d-flex');
    }
};

window.selectDiyStat = (btn) => {
    document.querySelectorAll('.diy-stat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
};

function renderCalendar() {
    const container = document.getElementById('calendar-grid');
    if(!container) return;
    
    const today = new Date();
    const currentDay = today.getDay(); 
    
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - currentDay);
    
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthEl = document.getElementById('cal-month');
    if(monthEl) {
        monthEl.innerText = `${startOfWeek.getFullYear()} ${monthNames[startOfWeek.getMonth()]}`;
    }
    
    const dayNames = { 
        ko: ["일","월","화","수","목","금","토"], 
        en: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], 
        ja: ["日","月","火","水","木","金","土"] 
    };
    
    container.innerHTML = AppState.quest.completedState.map((s, i) => {
        const iterDate = new Date(startOfWeek);
        iterDate.setDate(startOfWeek.getDate() + i);
        const isToday = (i === AppState.quest.currentDayOfWeek);
        const isFuture = (i > AppState.quest.currentDayOfWeek);
        const diyCount = AppState.diyQuests.definitions.length;
        const regularCount = s.filter(v=>v).length;
        const diyDoneCount = isToday ? Object.values(AppState.diyQuests.completedToday).filter(v=>v).length : 0;
        const dateStr = `${iterDate.getFullYear()}-${String(iterDate.getMonth()+1).padStart(2,'0')}-${String(iterDate.getDate()).padStart(2,'0')}`;
        const historyEntry = AppState.questHistory && AppState.questHistory[dateStr];
        const total = (isToday || isFuture) ? 12 + diyCount : (historyEntry ? historyEntry.t : 12);
        const count = regularCount + diyDoneCount + (!isToday && !isFuture && historyEntry ? historyEntry.d : 0);

        return `
            <div class="cal-day ${isToday ? 'today' : ''}">
                <div class="cal-name">${dayNames[AppState.currentLang][i]}</div>
                <div class="cal-date">${iterDate.getDate()}</div>
                <div class="cal-score">${count}/${total}</div>
            </div>
        `;
    }).join('');
}

// --- 퀘스트 통계 렌더링 ---
let _qstatsMonth = new Date();
let _qstatsYear = new Date().getFullYear();
let _qstatsDiyOnly = false;

function renderQuestStats() {
    const history = AppState.questHistory || {};
    const hasData = Object.keys(history).length > 0;
    const emptyEl = document.getElementById('qstats-empty-state');
    if (emptyEl) emptyEl.classList.toggle('d-none', hasData);

    const y = _qstatsMonth.getFullYear();
    const m = _qstatsMonth.getMonth();
    renderMonthlySummary(y, m, history);
    renderMonthlyHeatmap(y, m, history);
    renderAnnualChart(_qstatsYear, history);

    const lang = AppState.currentLang;
    const monthNames = i18n[lang]?.month_names_short || ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
    const monthLabel = document.getElementById('qstats-month-label');
    if (monthLabel) monthLabel.textContent = `${y} ${monthNames[m]}`;
    const yearLabel = document.getElementById('qstats-year-label');
    if (yearLabel) yearLabel.textContent = `${_qstatsYear}`;
}

function renderMonthlySummary(year, month, history) {
    const container = document.getElementById('qstats-monthly-summary');
    if (!container) return;
    const lang = AppState.currentLang;
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const keys = Object.keys(history).filter(k => k.startsWith(prefix));

    const activeDays = keys.length;
    let totalRate = 0, perfectDays = 0;
    keys.forEach(k => {
        const rec = history[k];
        let done, total;
        if (_qstatsDiyOnly) {
            done = rec.d || 0;
            total = rec.dt != null ? rec.dt : (rec.t - 12);
        } else {
            done = rec.r + rec.d;
            total = rec.t;
        }
        const rate = done / Math.max(total, 1);
        totalRate += rate;
        if (rate >= 1 && total > 0) perfectDays++;
    });
    const avgRate = activeDays > 0 ? Math.round(totalRate / activeDays * 100) : 0;

    const labels = {
        ko: { days: '활동일', avg: '평균 달성률', perfect: '올클리어' },
        en: { days: 'Active Days', avg: 'Avg. Rate', perfect: 'Perfect Days' },
        ja: { days: '活動日数', avg: '平均達成率', perfect: '全完了日' }
    };
    const l = labels[lang] || labels.en;

    container.innerHTML = `
        <div class="qstats-summary-item"><div class="qstats-summary-val">${activeDays}</div><div class="qstats-summary-label">${l.days}</div></div>
        <div class="qstats-summary-item"><div class="qstats-summary-val">${avgRate}%</div><div class="qstats-summary-label">${l.avg}</div></div>
        <div class="qstats-summary-item"><div class="qstats-summary-val">${perfectDays}</div><div class="qstats-summary-label">${l.perfect}</div></div>
    `;
}

function renderMonthlyHeatmap(year, month, history) {
    const container = document.getElementById('qstats-monthly-heatmap');
    if (!container) return;
    const lang = AppState.currentLang;
    const dayNames = {
        ko: ["일","월","화","수","목","금","토"],
        en: ["S","M","T","W","T","F","S"],
        ja: ["日","月","火","水","木","金","土"]
    };

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let headerHTML = '<div class="qstats-heatmap-header">';
    (dayNames[lang] || dayNames.en).forEach(d => { headerHTML += `<span>${d}</span>`; });
    headerHTML += '</div>';

    let gridHTML = '<div class="qstats-heatmap-grid">';
    for (let i = 0; i < firstDay; i++) gridHTML += '<div class="qstats-heatmap-cell empty"></div>';

    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const rec = history[key];
        let level = 0;
        if (rec) {
            let done, total;
            if (_qstatsDiyOnly) {
                done = rec.d || 0;
                total = rec.dt != null ? rec.dt : (rec.t - 12);
            } else {
                done = rec.r + rec.d;
                total = rec.t;
            }
            const rate = done / Math.max(total, 1) * 100;
            if (rate >= 76) level = 4;
            else if (rate >= 51) level = 3;
            else if (rate >= 26) level = 2;
            else if (rate >= 1) level = 1;
        }
        gridHTML += `<div class="qstats-heatmap-cell level-${level}">${d}</div>`;
    }
    gridHTML += '</div>';

    const legendHTML = `<div class="qstats-legend">
        <span>0%</span>
        <div class="qstats-legend-cell level-0" style="background:rgba(255,255,255,0.05);"></div>
        <div class="qstats-legend-cell level-1" style="background:rgba(0,217,255,0.15);"></div>
        <div class="qstats-legend-cell level-2" style="background:rgba(0,217,255,0.3);"></div>
        <div class="qstats-legend-cell level-3" style="background:rgba(0,217,255,0.5);"></div>
        <div class="qstats-legend-cell level-4" style="background:rgba(0,217,255,0.75);"></div>
        <span>100%</span>
    </div>`;

    container.innerHTML = headerHTML + gridHTML + legendHTML;
}

function renderAnnualChart(year, history) {
    const svg = document.getElementById('qstats-annual-chart');
    if (!svg) return;
    const lang = AppState.currentLang;
    const monthNames = i18n[lang]?.month_names_short || ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

    const padding = { top: 20, right: 10, bottom: 30, left: 30 };
    const W = 320, H = 180;
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;
    const barGap = chartW / 12;
    const barW = barGap * 0.6;

    let svgContent = '';

    // Gridlines
    for (let pct = 0; pct <= 100; pct += 25) {
        const y = padding.top + chartH - (pct / 100 * chartH);
        svgContent += `<line x1="${padding.left}" y1="${y}" x2="${W - padding.right}" y2="${y}" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>`;
        svgContent += `<text x="${padding.left - 4}" y="${y + 3}" text-anchor="end" fill="rgba(255,255,255,0.4)" font-size="7">${pct}%</text>`;
    }

    // Bars
    for (let m = 0; m < 12; m++) {
        const prefix = `${year}-${String(m + 1).padStart(2, '0')}`;
        const keys = Object.keys(history).filter(k => k.startsWith(prefix));
        let avgRate = 0;
        if (keys.length > 0) {
            let totalRate = 0;
            keys.forEach(k => {
                const rec = history[k];
                let done, total;
                if (_qstatsDiyOnly) {
                    done = rec.d || 0;
                    total = rec.dt != null ? rec.dt : (rec.t - 12);
                } else {
                    done = rec.r + rec.d;
                    total = rec.t;
                }
                totalRate += done / Math.max(total, 1);
            });
            avgRate = totalRate / keys.length * 100;
        }

        const x = padding.left + m * barGap + (barGap - barW) / 2;
        const barH = (avgRate / 100) * chartH;
        const y = padding.top + chartH - barH;

        if (barH > 0) {
            const opacity = 0.3 + (avgRate / 100) * 0.6;
            svgContent += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="2" fill="rgba(0,217,255,${opacity.toFixed(2)})"/>`;
            if (avgRate >= 5) {
                svgContent += `<text x="${x + barW / 2}" y="${y - 3}" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="6">${Math.round(avgRate)}%</text>`;
            }
        }

        // Month label
        svgContent += `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="7">${monthNames[m]}</text>`;
    }

    svg.innerHTML = svgContent;
}

// --- 던전 로직 ---
let raidTimerInterval = null;

// Haversine 공식: 두 GPS 좌표 간 거리(km) 계산
function getDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // 지구 반지름 (km)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 던전 위치: 6개 서울 역 중 날짜 기반 랜덤 선택, 반경 2km (근접 보너스용)
const DUNGEON_RADIUS_KM = 2;

function isBossRush() {
    const day = new Date().getDay();
    return day === 0 || day === 6; // 주말
}

function getBossRewardMultiplier() {
    return isBossRush() ? 2 : 1;
}

function getFixedDungeonData(dateStr, slot) {
    const seedStr = dateStr + "_slot" + slot;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    hash = Math.abs(hash);

    // station 선택용 별도 해시 (독립적 분포)
    const stationSeed = "station_" + dateStr + "_" + slot;
    let stationHash = 0;
    for (let i = 0; i < stationSeed.length; i++) {
        stationHash = stationSeed.charCodeAt(i) + ((stationHash << 5) - stationHash);
    }
    stationHash = Math.abs(stationHash);

    return {
        stationIdx: stationHash % seoulStations.length, // 18개 역 중 랜덤
        targetStat: statKeys[hash % statKeys.length]
    };
}

function startRaidTimer() {
    if(raidTimerInterval) clearInterval(raidTimerInterval);

    const timerEl = document.getElementById('raid-timer');
    if (!timerEl) return;

    function updateTimer() {
        const now = new Date();
        const kstOffset = 9 * 60;
        const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
        const kstMinutes = (utcMinutes + kstOffset) % (24 * 60);

        const slots = [
            { start: 360, end: 480 },   // 06:00~08:00
            { start: 690, end: 810 },   // 11:30~13:30
            { start: 1140, end: 1260 }  // 19:00~21:00
        ];

        let activeSlot = null;
        for (const s of slots) {
            if (kstMinutes >= s.start && kstMinutes < s.end) { activeSlot = s; break; }
        }

        if (activeSlot) {
            const remainMin = activeSlot.end - kstMinutes;
            const h = Math.floor(remainMin / 60);
            const m = remainMin % 60;
            timerEl.innerText = (i18n[AppState.currentLang]?.raid_deadline || '마감까지 {h}시간 {m}분').replace('{h}', h).replace('{m}', m);
        } else {
            let nextStart = null;
            for (const s of slots) {
                if (s.start > kstMinutes) { nextStart = s.start; break; }
            }
            if (!nextStart) nextStart = slots[0].start + 1440;
            const remainMin = nextStart - kstMinutes;
            const h = Math.floor(remainMin / 60);
            const m = remainMin % 60;
            timerEl.innerText = (i18n[AppState.currentLang]?.raid_next || '다음 레이드까지 {h}시간 {m}분').replace('{h}', h).replace('{m}', m);
        }
    }

    updateTimer();
    raidTimerInterval = setInterval(updateTimer, 60000);
}

window.syncGlobalDungeon = async () => {
    if (!auth.currentUser) return;
    try {
        const snap = await getDocs(collection(db, "users"));
        let realParticipants = 0;
        let totalDamage = 0;
        const participants = [];
        const targetDate = AppState.dungeon.lastGeneratedDate;
        const targetSlot = AppState.dungeon.slot;

        snap.docs.forEach(doc => {
            const data = doc.data();
            if (data.dungeonStr) {
                try {
                    const dng = JSON.parse(data.dungeonStr);
                    if (dng.lastGeneratedDate === targetDate && dng.slot === targetSlot && dng.isJoined) {
                        realParticipants++;
                        if (dng.hasContributed) totalDamage++;
                        let title = "각성자";
                        if (data.titleHistoryStr) {
                            try {
                                const hist = JSON.parse(data.titleHistoryStr);
                                const last = hist[hist.length - 1].title;
                                title = typeof last === 'object' ? last[AppState.currentLang] || last.ko : last;
                            } catch(e) {}
                        }
                        const stats = data.stats || {};
                        let rareTitle = null;
                        if (data.rareTitleStr) {
                            try {
                                const rt = JSON.parse(data.rareTitleStr);
                                const ul = rt.unlocked || [];
                                if (ul.length > 0) {
                                    const ro = ['uncommon','rare','epic','legendary'];
                                    const pp = { rank_global:40, rank_stat:30, streak:20, steps:10 };
                                    rareTitle = [...ul].sort((a,b) => { const pd=(pp[b.type]||0)-(pp[a.type]||0); return pd!==0?pd:ro.indexOf(b.rarity)-ro.indexOf(a.rarity); })[0];
                                }
                            } catch(e) {}
                        }
                        participants.push({
                            id: doc.id,
                            name: data.name || '헌터',
                            photoURL: data.photoURL || null,
                            title, rareTitle,
                            instaId: data.instaId || '',
                            hasContributed: !!dng.hasContributed,
                            statValue: Number(stats[AppState.dungeon.targetStat]) || 0,
                            isMe: auth.currentUser?.uid === doc.id
                        });
                    }
                } catch(e) {}
            }
        });

        // 보스 HP: 기본 5, 참여자 3명 추가될 때마다 +1 필요
        const baseHP = isBossRush() ? 10 : 5;
        const scaledHP = baseHP + Math.floor(Math.max(0, realParticipants - 5) / 3);

        // 로컬 기여가 서버에 아직 반영 안 된 경우 보정
        const localContributed = AppState.dungeon.hasContributed;
        const myUid = auth.currentUser?.uid;
        const myDataInServer = participants.find(p => p.id === myUid);
        if (localContributed && myDataInServer && !myDataInServer.hasContributed) {
            totalDamage++;
            myDataInServer.hasContributed = true;
        }

        const prevDmg = AppState.dungeon.bossDamageDealt || 0;
        AppState.dungeon.bossMaxHP = scaledHP;
        AppState.dungeon.bossDamageDealt = totalDamage;
        AppState.dungeon.globalParticipants = realParticipants;
        AppState.dungeon.globalProgress = Math.min(100, (totalDamage / scaledHP) * 100);
        AppState.dungeon.raidParticipants = participants.sort((a, b) => (b.hasContributed - a.hasContributed) || (b.statValue - a.statValue));

        // HP 감소 시 애니메이션 트리거
        if (totalDamage > prevDmg && document.getElementById('dungeon').classList.contains('active')) {
            triggerHPHitEffect();
        }

        if (document.getElementById('dungeon').classList.contains('active')) {
            renderDungeon();
        }
    } catch (e) {
        console.error("글로벌 동기화 에러:", e);
        AppLogger.error('[Dungeon] 글로벌 동기화 실패', e.stack || e.message);
    }
};

function getKSTDate(now) {
    // KST(UTC+9) 기준 Date 객체 생성
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000));
    return kst;
}

function getKSTDateStr(now) {
    const kst = getKSTDate(now);
    return `${kst.getFullYear()}-${String(kst.getMonth()+1).padStart(2,'0')}-${String(kst.getDate()).padStart(2,'0')}`;
}

function getCurrentRaidSlot() {
    const now = new Date();
    const kstOffset = 9 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const kstMinutes = (utcMinutes + kstOffset) % (24 * 60);
    const slots = [
        { slot: 1, start: 360, end: 480 },   // 06:00~08:00
        { slot: 2, start: 690, end: 810 },   // 11:30~13:30
        { slot: 3, start: 1140, end: 1260 }  // 19:00~21:00
    ];
    for (const s of slots) {
        if (kstMinutes >= s.start && kstMinutes < s.end) return s.slot;
    }
    return 0;
}

function updateDungeonStatus() {
    const now = new Date();
    const currentSlot = getCurrentRaidSlot();

    // KST 기준 날짜 문자열 사용 (로컬 타임존 의존 제거)
    const dateStr = getKSTDateStr(now);
    if (AppState.dungeon.lastGeneratedDate !== dateStr || AppState.dungeon.slot !== currentSlot) {
        AppState.dungeon.lastGeneratedDate = dateStr;
        AppState.dungeon.slot = currentSlot;

        const fixedData = getFixedDungeonData(dateStr, currentSlot);
        AppState.dungeon.stationIdx = fixedData.stationIdx;
        AppState.dungeon.targetStat = fixedData.targetStat;

        AppState.dungeon.maxParticipants = 5;

        AppState.dungeon.isJoined = false;
        AppState.dungeon.hasContributed = false;
        AppState.dungeon.isCleared = false;

        AppState.dungeon.globalParticipants = 0;
        AppState.dungeon.globalProgress = 0;
        AppState.dungeon.bossMaxHP = isBossRush() ? 10 : 5;
        AppState.dungeon.bossDamageDealt = 0;
        saveUserData();
    }
    renderDungeon();
    window.syncGlobalDungeon();
}

function renderRaidParticipants(participants) {
    if (!participants || participants.length === 0) return '';
    const lang = AppState.currentLang;
    const t = i18n[lang];
    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="color:#ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;

    const cards = participants.map(u => {
        const titleBadgeHTML = buildUserTitleBadgeHTML(u, '0.55rem');
        return `
        <div class="user-card ${u.isMe ? 'my-rank' : ''}" style="padding:8px;">
            <div style="display:flex; align-items:center; flex-grow:1;">
                ${u.photoURL ? `<img src="${sanitizeURL(u.photoURL)}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(u.photoURL)}',null,true)" style="width:28px; height:28px; border-radius:50%; object-fit:cover; margin-right:8px; border:1px solid var(--neon-blue);"><div style="width:28px; height:28px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue); display:none;"></div>` : `<div style="width:28px; height:28px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue);"></div>`}
                <div>
                    ${titleBadgeHTML}
                    <div style="font-size:0.8rem; display:flex; align-items:center;">
                        ${sanitizeText(u.name)} ${u.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(u.instaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:4px; cursor:pointer; display:inline-flex;">${instaSvg}</button>` : ''}
                    </div>
                </div>
            </div>
            <div class="raid-contribution-badge ${u.hasContributed ? 'contributed' : 'pending'}">
                ${u.hasContributed ? '⚔️ ' + (t.raid_contributed || '기여 완료') : '⏳ ' + (t.raid_waiting_contribute || '대기 중')}
            </div>
        </div>
    `}).join('');

    return `<div class="raid-participants-title">${t.raid_participants_title || '참여 헌터'} (${participants.length})</div>${cards}`;
}

function renderDungeon() {
    const banner = document.getElementById('dungeon-banner');
    const activeBoard = document.getElementById('dungeon-active-board');
    const timer = document.getElementById('raid-timer');
    if(!banner || !activeBoard) return;

    if (AppState.dungeon.slot === 0) {
        if(timer) timer.classList.add('d-none');
        activeBoard.classList.add('d-none');
        banner.classList.remove('d-none');

        banner.innerHTML = `<h3 style="color:var(--text-sub); margin:0; padding:20px 0;">${i18n[AppState.currentLang].raid_waiting}</h3>`;
    } else {
        const m = raidMissions[AppState.dungeon.targetStat];
        const st = seoulStations[AppState.dungeon.stationIdx];
        
        if (!AppState.dungeon.isJoined) {
            if(timer) timer.classList.add('d-none');
            activeBoard.classList.add('d-none'); 
            banner.classList.remove('d-none');
            
            const mapUrl = `https://maps.google.com/maps?q=${st.lat},${st.lng}&hl=${AppState.currentLang}&z=15&output=embed`;
            
            const joinBtnHtml = `<button onclick="window.joinDungeon()" class="btn-primary" style="background:${m.color}; border-color:${m.color}; margin-top:10px; color:black; font-weight:bold;">${i18n[AppState.currentLang]?.raid_join_btn || '작전 합류 (입장)'}</button>`;

            banner.innerHTML = `
                <div style="display:inline-block; padding:2px 6px; font-size:0.6rem; font-weight:bold; color:${m.color}; border:1px solid ${m.color}; border-radius:3px; margin-bottom:5px;">${(i18n[AppState.currentLang]?.raid_stat_required || '{stat} 요구됨').replace('{stat}', m.stat)}</div>
                <div class="raid-title-row">
                    <div class="anomaly-boss-icon ${AppState.dungeon.targetStat}">${raidAnomalyIcons[AppState.dungeon.targetStat] || ''}</div>
                    <div class="raid-title-text" style="text-align:left;">
                        <div style="font-size:0.8rem; color:var(--text-sub); margin-bottom:2px;">📍 ${st.name[AppState.currentLang]}</div>
                        <h3 class="raid-boss-title" style="color:${m.color}; font-size:1.1rem; margin:0;">${m.title[AppState.currentLang]}</h3>
                    </div>
                </div>
                <div class="map-container" style="width:100%; height:180px; border-radius:6px; overflow:hidden; margin-bottom:12px; border:1px solid var(--border-color);">
                    <iframe src="${mapUrl}" style="width:100%; height:100%; border:none;" allowfullscreen="" loading="lazy"></iframe>
                </div>
                <p style="font-size: 0.8rem; margin-bottom: 5px; color:var(--text-main); word-break:keep-all;">${m.desc1[AppState.currentLang]}</p>
                <div class="raid-reward-box" style="margin: 10px 0; text-align:left;">
                    <div class="raid-reward-header">
                        <span class="raid-reward-icon">🏆</span>
                        <span>${i18n[AppState.currentLang].raid_reward_label}</span>
                    </div>
                    <div class="raid-reward-items">
                        <div class="raid-reward-item">
                            <span class="raid-reward-key">${i18n[AppState.currentLang].raid_reward_condition}</span>
                            <span class="raid-reward-val" style="color:var(--text-main); font-family:inherit; font-size:0.7rem; max-width:60%; text-align:right; word-break:keep-all;">${m.desc2[AppState.currentLang]}</span>
                        </div>
                        <div class="raid-reward-item">
                            <span class="raid-reward-key">${i18n[AppState.currentLang].raid_reward_points}</span>
                            <span class="raid-reward-val text-gold">+${200 * getBossRewardMultiplier()} P</span>
                        </div>
                        <div class="raid-reward-item">
                            <span class="raid-reward-key">${i18n[AppState.currentLang].raid_reward_stat}</span>
                            <span class="raid-reward-val" style="color:${m.color};">${m.stat} +${(2.0 * getBossRewardMultiplier()).toFixed(1)}</span>
                        </div>
                    </div>
                </div>
                ${isBossRush() ? `<div class="boss-rush-banner">${i18n[AppState.currentLang]?.boss_rush || 'Weekend Boss Rush'} — ${i18n[AppState.currentLang]?.boss_rush_desc || 'HP x2, Rewards x2!'}</div>` : ''}
                <div class="boss-hp-bar-container">
                    <div class="boss-hp-label">
                        <span style="color:var(--neon-red); font-weight:bold;">${i18n[AppState.currentLang]?.boss_hp || 'Boss HP'}</span>
                        <span style="color:var(--text-sub);">${AppState.dungeon.bossMaxHP - (AppState.dungeon.bossDamageDealt || 0)} / ${AppState.dungeon.bossMaxHP || 5}</span>
                    </div>
                    <div class="boss-hp-bar-bg"><div class="boss-hp-bar-fill" style="width: ${Math.max(0, 100 - (AppState.dungeon.globalProgress || 0))}%;"></div></div>
                </div>
                <div style="font-size: 0.8rem; margin: 12px 0; font-weight:bold;">
                    ${i18n[AppState.currentLang].raid_part}
                    <span class="text-blue">${AppState.dungeon.globalParticipants}</span> ${i18n[AppState.currentLang]?.raid_people_unit || '명'}
                </div>
                <div class="raid-participants-list">${renderRaidParticipants(AppState.dungeon.raidParticipants)}</div>
                ${joinBtnHtml}
            `;
        } else {
            if(timer) timer.classList.remove('d-none');
            banner.classList.add('d-none'); 
            activeBoard.classList.remove('d-none'); 
            
            document.getElementById('active-stat-badge').innerText = m.stat;
            document.getElementById('active-stat-badge').style.borderColor = m.color;
            document.getElementById('active-stat-badge').style.color = m.color;
            const stationEl = document.getElementById('active-raid-station');
            if (stationEl) stationEl.innerText = `📍 ${st.name[AppState.currentLang]}`;
            document.getElementById('active-raid-title').innerText = m.title[AppState.currentLang];
            document.getElementById('active-raid-title').style.color = m.color;
            const iconEl = document.getElementById('active-anomaly-icon');
            if (iconEl) {
                iconEl.className = `anomaly-boss-icon ${AppState.dungeon.targetStat}`;
                iconEl.innerHTML = raidAnomalyIcons[AppState.dungeon.targetStat] || '';
            }
            document.getElementById('active-raid-desc').innerText = m.desc2[AppState.currentLang];

            const lang = AppState.currentLang;
            const rewardMult = getBossRewardMultiplier();
            document.getElementById('raid-reward-label').innerText = i18n[lang].raid_reward_label + (isBossRush() ? ' (x2)' : '');
            document.getElementById('raid-reward-points-label').innerText = i18n[lang].raid_reward_points;
            document.getElementById('raid-reward-stat-label').innerText = i18n[lang].raid_reward_stat;
            document.getElementById('raid-reward-stat-val').innerText = `${m.stat} +${(2.0 * rewardMult).toFixed(1)}`;
            document.getElementById('raid-reward-stat-val').style.color = m.color;

            document.getElementById('raid-part-count').innerText = `${AppState.dungeon.globalParticipants}`;

            const partListEl = document.getElementById('raid-participants-list');
            if (partListEl) {
                partListEl.innerHTML = renderRaidParticipants(AppState.dungeon.raidParticipants);
            }

            // HP 바 표시 (진행도 대신 보스 HP)
            const bossMaxHP = AppState.dungeon.bossMaxHP || 5;
            const bossDmg = AppState.dungeon.bossDamageDealt || 0;
            const hpPercent = Math.max(0, ((bossMaxHP - bossDmg) / bossMaxHP) * 100);
            document.getElementById('raid-progress-bar').style.width = `${hpPercent}%`;
            document.getElementById('raid-progress-bar').style.background = 'linear-gradient(90deg, #ff3c3c, #ff6a00)';
            document.getElementById('raid-progress-text').innerText = `${bossMaxHP - bossDmg} / ${bossMaxHP}`;
            
            const btnAction = document.getElementById('btn-raid-action');
            const btnComplete = document.getElementById('btn-raid-complete');
            
            if (bossDmg >= bossMaxHP) {
                btnAction.classList.add('d-none');
                btnComplete.classList.remove('d-none');
                
                if(AppState.dungeon.isCleared) {
                    btnComplete.innerText = i18n[AppState.currentLang]?.raid_settle_done || "정산 완료";
                    btnComplete.disabled = true;
                    btnComplete.style.background = "#444";
                    btnComplete.style.color = "#888";
                } else {
                    btnComplete.innerText = i18n[AppState.currentLang]?.raid_loot_claim || "전리품 획득";
                    btnComplete.disabled = false;
                    btnComplete.style.background = "var(--neon-gold)";
                    btnComplete.style.color = "black";
                }
            } else {
                btnAction.classList.remove('d-none');
                btnComplete.classList.add('d-none');
                
                if (AppState.dungeon.hasContributed) {
                    btnAction.innerText = i18n[AppState.currentLang]?.raid_data_sent || "데이터 전송 완료";
                    btnAction.disabled = true;
                    btnAction.style.opacity = "0.5";
                } else {
                    btnAction.innerText = m.actionText[AppState.currentLang];
                    btnAction.disabled = false;
                    btnAction.style.opacity = "1";
                }
            }
        }
    }
}

window.joinDungeon = async () => {
    // GPS 체크 제거 — 누구나 참여 가능. 근접 시 보너스만 지급
    let proximityBonus = false;
    const station = seoulStations[AppState.dungeon.stationIdx];
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
        try {
            const { Geolocation } = window.Capacitor.Plugins;
            const permResult = await Geolocation.requestPermissions();
            if (permResult.location !== 'denied') {
                const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
                const dist = getDistanceKm(position.coords.latitude, position.coords.longitude, station.lat, station.lng);
                if (dist <= DUNGEON_RADIUS_KM) {
                    proximityBonus = true;
                    AppState.user.points += 50;
                    if (window.AppLogger) AppLogger.info(`[Dungeon] 근접 보너스 지급 - 거리: ${dist.toFixed(2)}km`);
                }
            }
        } catch (e) { /* GPS 실패해도 입장은 허용 */ }
    }

    AppState.dungeon.isJoined = true;
    if (!AppState.dungeon.bossMaxHP) {
        AppState.dungeon.bossMaxHP = isBossRush() ? 10 : 5;
        AppState.dungeon.bossDamageDealt = 0;
    }
    // 로컬 상태 즉시 반영 (서버 sync 전 UI 업데이트)
    AppState.dungeon.globalParticipants = (AppState.dungeon.globalParticipants || 0) + 1;
    renderDungeon();

    await saveUserData();
    await window.syncGlobalDungeon();

    if (proximityBonus) {
        const lang = AppState.currentLang;
        alert(i18n[lang]?.proximity_bonus || '+50P Proximity Bonus!');
        updatePointUI();
    }
};

window.simulateRaidAction = async () => {
    if (AppState.dungeon.hasContributed || AppState.dungeon.globalProgress >= 100) return;

    const btn = document.getElementById('btn-raid-action');
    btn.innerText = `데이터 전송 중...`;
    btn.disabled = true;

    AppState.dungeon.hasContributed = true;
    // 로컬 상태 즉시 반영 (서버 sync 전 UI 업데이트)
    AppState.dungeon.bossDamageDealt = (AppState.dungeon.bossDamageDealt || 0) + 1;
    const bossMaxHP = AppState.dungeon.bossMaxHP || 5;
    AppState.dungeon.globalProgress = Math.min(100, (AppState.dungeon.bossDamageDealt / bossMaxHP) * 100);

    // HP 바 즉시 업데이트 (renderDungeon 전에 직접 DOM 조작)
    updateBossHPBar();
    triggerHPHitEffect();
    renderDungeon();

    await saveUserData();
    await window.syncGlobalDungeon();
};

function updateBossHPBar() {
    const bar = document.getElementById('raid-progress-bar');
    const text = document.getElementById('raid-progress-text');
    if (!bar || !text) return;
    const bossMaxHP = AppState.dungeon.bossMaxHP || 5;
    const bossDmg = AppState.dungeon.bossDamageDealt || 0;
    const hpPercent = Math.max(0, ((bossMaxHP - bossDmg) / bossMaxHP) * 100);
    bar.style.width = `${hpPercent}%`;
    text.innerText = `${Math.max(0, bossMaxHP - bossDmg)} / ${bossMaxHP}`;
}

function triggerHPHitEffect() {
    const hpBox = document.querySelector('.raid-progress-box');
    if (!hpBox) return;
    hpBox.classList.add('hp-hit-shake');
    // 데미지 숫자 팝업
    const popup = document.createElement('span');
    popup.className = 'hp-damage-popup';
    popup.innerText = '-1';
    hpBox.appendChild(popup);
    setTimeout(() => {
        hpBox.classList.remove('hp-hit-shake');
        popup.remove();
    }, 800);
}

window.completeDungeon = () => {
    if(AppState.dungeon.isCleared) return;
    const target = AppState.dungeon.targetStat;
    const rewardMult = getBossRewardMultiplier();
    const pts = 200 * rewardMult;
    const statInc = 2.0 * rewardMult;

    AppState.user.points += pts;
    AppState.user.pendingStats[target] += statInc;
    AppState.dungeon.isCleared = true;

    updateStreak();
    updateChallengeProgress('dungeon_clear');
    saveUserData();
    renderDungeon();
    updatePointUI();
    const lang = AppState.currentLang;
    alert(`[SYSTEM] ${i18n[lang]?.boss_defeated || 'Boss Defeated!'}\n+${pts} P\n${target.toUpperCase()} +${statInc}`);

    // ★ 보상형 전면 광고 — 던전 클리어 추가 보상 (일일 제한)
    if (_rewardedInterstitialReady && isNativePlatform && getRiDungeonCountToday() < RI_DUNGEON_DAILY_MAX) {
        const watchAd = confirm(i18n[lang].ri_dungeon_prompt || '광고를 시청하면 추가 보상을 받을 수 있습니다. 시청하시겠습니까?');
        if (watchAd) {
            incrementRiDungeonCount();
            showRewardedInterstitial('dungeon');
        }
    }
};

// --- 공통 UI ---
function switchTab(tabId, el) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    
    const mainEl = document.querySelector('main');
    if(tabId === 'status') {
        mainEl.style.overflowY = 'auto';
        drawRadarChart(); updatePointUI(); renderQuote(); renderDDayList(); renderDDayCaption(); renderLifeStatus(); renderBonusExp(); if (window.updateLibraryCardCount) window.updateLibraryCardCount();
    } else {
        mainEl.style.overflowY = 'auto';
    }
    
    // 네이티브 광고: 현재 활성 탭이 아닌 다른 탭으로 이동 시 정리
    if (_nativeAdActiveTab && _nativeAdActiveTab !== tabId) {
        cleanupNativeAd();
    }

    // 배너 광고: 던전 탭과 플래너 탭에서 표시
    if (tabId === 'dungeon' || tabId === 'diary') {
        showBannerAd();
    } else {
        hideBannerAd();
    }

    if(tabId === 'social') fetchSocialData();
    if(tabId === 'quests') { renderQuestList(); renderCalendar(); renderWeeklyChallenges(); renderRoulette(); }
    if(tabId === 'diary') { renderPlannerCalendar(); loadPlannerForDate(diarySelectedDate); updateReelsResetTimer(); }
    if(tabId === 'reels') { renderReelsFeed(); updateReelsResetTimer(); }
    if(tabId === 'dungeon') {
        updateDungeonStatus();
        // syncGlobalDungeon()은 updateDungeonStatus() 내부에서 이미 호출됨
    }
}

function updatePointUI() {
    const req = Math.floor(100 * Math.pow(1.5, AppState.user.level - 1));
    document.getElementById('sys-level').innerText = `Lv. ${Math.floor(AppState.user.level)}`;
    document.getElementById('display-pts').innerText = AppState.user.points;
    document.getElementById('display-req-pts').innerText = req;
    document.getElementById('btn-levelup').disabled = AppState.user.points < req;
    
    const display = getDisplayTitle();
    const badgeEl = document.getElementById('prof-title-badge');
    if (display.isRare) {
        const rarityClass = rarityConfig[display.rarity]?.class || '';
        badgeEl.className = 'title-badge-combined';
        badgeEl.innerHTML = `<span class="title-badge" style="margin-bottom:0;">${display.baseIcon} ${sanitizeText(display.baseText)}</span><span class="title-badge ${rarityClass}" style="margin-bottom:0;">${display.rareIcon} ${sanitizeText(display.rareText)}</span> ℹ️`;
    } else {
        badgeEl.className = 'title-badge';
        badgeEl.innerHTML = `${display.baseIcon} ${sanitizeText(display.baseText)} ℹ️`;
    }
}

function processLevelUp() {
    const req = Math.floor(100 * Math.pow(1.5, AppState.user.level - 1));
    if(AppState.user.points < req) return;
    AppState.user.points -= req; AppState.user.level++;
    statKeys.forEach(k => { 
        AppState.user.stats[k] = Math.min(100, (Number(AppState.user.stats[k])||0) + (Number(AppState.user.pendingStats[k])||0)); 
        AppState.user.pendingStats[k] = 0; 
    });
    const top = statKeys.map(k => ({k, v:AppState.user.stats[k]})).sort((a,b) => b.v - a.v);
    const newTitle = { 
        ko: `${titleVocab[top[0].k].ko.pre[0]} ${titleVocab[top[1].k].ko.suf[0]}`,
        en: `${titleVocab[top[0].k].en.pre[0]} ${titleVocab[top[1].k].en.suf[0]}`
    };
    AppState.user.titleHistory.push({ level: AppState.user.level, title: newTitle });
    
    AppLogger.info('[LevelUp] 레벨 ' + AppState.user.level + ' 달성');
    saveUserData(); updatePointUI(); drawRadarChart();
    alert("Level Up!");
    // 호칭 가이드 모달창 자동 표시(openTitleModal()) 삭제 완료
}

function updateLoginLangButtons(langCode) {
    document.querySelectorAll('#login-lang-selector .login-lang-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.lang === langCode);
    });
}

function changeLanguage(langCode) {
    AppState.currentLang = langCode;
    try { localStorage.setItem('lang', langCode); } catch(e) {}
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[langCode][key]) el.innerHTML = i18n[langCode][key];
    });
    // placeholder 번역
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (i18n[langCode][key]) el.placeholder = i18n[langCode][key];
    });
    updateLoginLangButtons(langCode);

    if(document.getElementById('app-container').classList.contains('d-flex')){
        drawRadarChart();
        renderUsers(AppState.social.sortCriteria);
        renderQuestList();
        renderCalendar();
        renderPlannerCalendar();
        renderQuote();
        renderDDayList();
        renderDDayCaption();
        updatePointUI();
        updateDungeonStatus();
        loadPlayerName();
        updateReelsResetTimer(); // i18n 업데이트 후 버튼 쿨다운 상태 재적용
        updateStepCountUI();
        if (document.querySelector('.quest-tab-btn[data-quest-tab="stats"].active')) renderQuestStats();
    }
}

// --- 외부 API 연동 명언 ---
async function renderQuote() {
    const quoteEl = document.getElementById('daily-quote');
    const authorEl = document.getElementById('daily-quote-author');
    if(!quoteEl || !authorEl) return;

    // 이미 명언이 표시되어 있으면 다시 로드하지 않음
    if(quoteEl.innerText && quoteEl.innerText !== "위성 통신망에서 데이터를 수신 중입니다..." && quoteEl.style.opacity !== '0') return;

    try {
        quoteEl.innerText = "위성 통신망에서 데이터를 수신 중입니다...";
        quoteEl.style.opacity = 1;
        authorEl.innerText = "";

        let apiUrl = 'https://korean-advice-open-api.vercel.app/api/advice';
        if (AppState.currentLang === 'en' || AppState.currentLang === 'ja') {
            apiUrl = 'https://dummyjson.com/quotes/random';
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error("API 통신 에러");

        const data = await response.json();
        const quoteText = data.message || data.quote;
        const quoteAuthor = data.author || "Unknown";

        quoteEl.style.opacity = 0;
        authorEl.style.opacity = 0;

        setTimeout(() => {
            quoteEl.innerText = `"${quoteText}"`;
            authorEl.innerText = `- ${quoteAuthor} -`;
            quoteEl.style.opacity = 1;
            quoteEl.style.transition = "opacity 0.5s ease-in";
            authorEl.style.opacity = 1;
            authorEl.style.transition = "opacity 0.5s ease-in";
        }, 300);

    } catch (error) {
        console.error("명언 API 호출 실패:", error);
        quoteEl.innerText = `"어떠한 시련 속에서도 꾸준함은 시스템을 지탱하는 가장 강력한 무기이다."`;
        authorEl.innerText = `- System Offline -`;
        quoteEl.style.opacity = 1;
        authorEl.style.opacity = 1;
    }
}

// --- 명언 텍스트 복사 ---
window.copyQuoteText = function() {
    const quoteEl = document.getElementById('daily-quote');
    const authorEl = document.getElementById('daily-quote-author');
    if (!quoteEl || !authorEl) return;

    const quoteText = quoteEl.innerText || '';
    const authorText = authorEl.innerText || '';
    if (!quoteText) return;

    const text = `${quoteText}\n${authorText}`;
    const lang = AppState.currentLang;
    const msgs = { ko: '명언이 클립보드에 복사되었습니다.', en: 'Quote copied to clipboard.', ja: '名言がクリップボードにコピーされました。' };

    navigator.clipboard.writeText(text).then(() => {
        alert(msgs[lang] || msgs.ko);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert(msgs[lang] || msgs.ko);
    });
};

// --- 소셜 탭 ---
async function fetchSocialData() {
    const container = document.getElementById('user-list-container');
    if (container && AppState.social.users.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-sub); font-size:0.85rem;">데이터 로딩 중...</div>';
    }
    try {
        const snap = await getDocs(collection(db, "users"));
        AppState.social.users = snap.docs.map(d => {
            const data = d.data();
            let title = "각성자";
            if (data.titleHistoryStr) {
                try {
                    const hist = JSON.parse(data.titleHistoryStr);
                    const last = hist[hist.length - 1].title;
                    title = typeof last === 'object' ? last[AppState.currentLang] || last.ko : last;
                } catch(e) {}
            }
            // 희귀 호칭 파싱 (우선순위 기반 자동 선택)
            let rareTitle = null;
            if (data.rareTitleStr) {
                try {
                    const rt = JSON.parse(data.rareTitleStr);
                    const ul = rt.unlocked || [];
                    if (ul.length > 0) {
                        const ro = ['uncommon', 'rare', 'epic', 'legendary'];
                        const pp = { rank_global: 40, rank_stat: 30, streak: 20, steps: 10, reading: 10 };
                        rareTitle = [...ul].sort((a, b) => { const pd = (pp[b.type]||0) - (pp[a.type]||0); return pd !== 0 ? pd : ro.indexOf(b.rarity) - ro.indexOf(a.rarity); })[0];
                    }
                } catch(e) {}
            }
            let readBooks = 0;
            if (data.libraryStr) {
                try { const lib = JSON.parse(data.libraryStr); readBooks = (lib.books || []).filter(b => b.category === 'read').length; } catch(e) {}
            }
            return { id: d.id, ...data, title, rareTitle, books: readBooks, stats: data.stats || {str:0,int:0,cha:0,vit:0,wlth:0,agi:0}, stepData: data.stepData || { date: '', rewardedSteps: 0, totalSteps: 0 }, isFriend: (AppState.user.friends || []).includes(d.id), isMe: auth.currentUser?.uid === d.id };
        });
        renderUsers(AppState.social.sortCriteria);
        // 랭킹 기반 희귀 호칭 평가
        checkRankRareTitles();
    } catch(e) {
        console.error("소셜 로드 에러", e);
        AppLogger.error('[Social] 데이터 로드 실패', e.stack || e.message);
        if (container) {
            container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--neon-red); font-size:0.85rem;">랭킹 데이터를 불러올 수 없습니다.<br><button onclick="fetchSocialData()" style="margin-top:10px; padding:6px 16px; background:var(--neon-blue); color:#000; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">다시 시도</button></div>';
        }
    }
}

function renderUsers(criteria, btn = null) {
    if(btn) { 
        AppState.social.sortCriteria = criteria; 
        document.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); 
    }
    const container = document.getElementById('user-list-container');
    if(!container) return;

    let list = AppState.social.users.map(u => {
        const s = u.stats;
        const total = (Number(s.str)||0) + (Number(s.int)||0) + (Number(s.cha)||0) + (Number(s.vit)||0) + (Number(s.wlth)||0) + (Number(s.agi)||0);
        const steps = Number(u.stepData?.totalSteps) || 0;
        return { ...u, total, str:Math.round(Number(s.str)||0), int:Math.round(Number(s.int)||0), cha:Math.round(Number(s.cha)||0), vit:Math.round(Number(s.vit)||0), wlth:Math.round(Number(s.wlth)||0), agi:Math.round(Number(s.agi)||0), steps, books: u.books || 0 };
    });

    if(AppState.social.mode === 'friends') list = list.filter(u => u.isFriend || u.isMe);
    list.sort((a,b) => b[criteria] - a[criteria]);

    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: #ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;

    container.innerHTML = list.map((u, i) => {
        const titleBadgeHTML = buildUserTitleBadgeHTML(u, '0.6rem');
        const cardHTML = `
        <div class="user-card ${u.isMe ? 'my-rank' : ''}">
            <div style="width:25px; font-weight:bold; color:var(--text-sub);">${i+1}</div>
            <div style="display:flex; align-items:center; flex-grow:1; margin-left:10px;">
                ${u.photoURL ? `<img src="${sanitizeURL(u.photoURL)}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(u.photoURL)}',null,true)" style="width:30px; height:30px; border-radius:50%; object-fit:cover; margin-right:8px; border:1px solid var(--neon-blue);"><div style="width:30px; height:30px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue); display:none;"></div>` : `<div style="width:30px; height:30px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue);"></div>`}
                <div class="user-info" style="margin-left:0;">
                    ${titleBadgeHTML}
                    <div style="font-size:0.9rem; display:flex; align-items:center;">
                        ${sanitizeText(u.name)} ${u.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(u.instaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:5px; cursor:pointer; display:inline-flex;">${instaSvg}</button>` : ''}
                    </div>
                </div>
            </div>
            <div class="user-score" style="font-weight:900; color:var(--neon-blue);">${typeof u[criteria] === 'number' ? u[criteria].toLocaleString() : u[criteria]}</div>
            ${!u.isMe ? `<button class="btn-friend ${u.isFriend ? 'added' : ''}" onclick="window.toggleFriend('${sanitizeAttr(u.id)}')">${u.isFriend ? (i18n[AppState.currentLang]?.btn_added || '친구✓') : (i18n[AppState.currentLang]?.btn_add || '추가')}</button>` : ''}
        </div>`;

        // 네이티브 광고 placeholder 삽입 (N번째 유저 카드 뒤)
        if (i === NATIVE_AD_POSITION - 1 && list.length >= NATIVE_AD_POSITION) {
            return cardHTML + `<div id="native-ad-placeholder-social" class="native-ad-slot"><span class="ad-loading-text">광고</span></div>`;
        }
        return cardHTML;
    }).join('');

    // 네이티브 광고 로드 (placeholder가 삽입된 경우)
    if (list.length >= NATIVE_AD_POSITION && isNativePlatform) {
        setTimeout(() => loadAndShowNativeAd('social'), 300);
    }
}

window.fetchSocialData = fetchSocialData;

// 현재 유저의 프로필 변경사항을 소셜 탭에 즉시 반영
function updateSocialUserData() {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const idx = AppState.social.users.findIndex(u => u.id === uid);
    if (idx !== -1) {
        AppState.social.users[idx].name = AppState.user.name;
        AppState.social.users[idx].photoURL = AppState.user.photoURL;
        AppState.social.users[idx].instaId = AppState.user.instaId || '';
        AppState.social.users[idx].stats = { ...AppState.user.stats };
        renderUsers(AppState.social.sortCriteria);
    }
}

window.toggleFriend = async (id) => {
    const isFriend = AppState.user.friends.includes(id);
    await setDoc(doc(db, "users", auth.currentUser.uid), { friends: isFriend ? arrayRemove(id) : arrayUnion(id) }, { merge: true });
    AppState.user.friends = isFriend ? AppState.user.friends.filter(f=>f!==id) : [...AppState.user.friends, id];
    fetchSocialData();
};

function toggleSocialMode(mode, btn) { 
    AppState.social.mode = mode; 
    document.querySelectorAll('.social-tab-btn').forEach(b => b.classList.remove('active')); 
    btn.classList.add('active'); 
    renderUsers(AppState.social.sortCriteria); 
}

// --- 로그인/인증 로직 ---
function validatePassword(pw) {
    return pw.length >= 8 && /[A-Z]/.test(pw) && (pw.match(/[^A-Za-z0-9]/g) || []).length >= 2;
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function simulateLogin() {
    const email = document.getElementById('login-email').value;
    const pw = document.getElementById('login-pw').value;
    const btn = document.getElementById('btn-login-submit');
    const lang = AppState.currentLang || 'ko';
    if(!email || !pw) { alert(i18n[lang]?.login_err_empty || "이메일과 비밀번호를 입력해주세요."); return; }
    if(!validateEmail(email)) { alert(i18n[lang]?.login_err_email || "유효한 이메일 주소를 입력해주세요."); return; }
    btn.innerText = "Processing..."; btn.disabled = true;
    try {
        if(!AppState.isLoginMode) {
            ConversionTracker.signupStart('email');
            if(!validatePassword(pw)) throw new Error(i18n[lang]?.login_err_pw_req || "비밀번호는 8자리 이상, 대문자 1개 이상, 특수문자 2개 이상 포함해야 합니다.");
            const pwConfirm = document.getElementById('login-pw-confirm').value;
            if(pw !== pwConfirm) throw new Error(i18n[lang]?.pw_mismatch || "비밀번호 불일치");
            const userCredential = await createUserWithEmailAndPassword(auth, email, pw);
            await sendEmailVerification(userCredential.user);
            ConversionTracker.signupComplete('email');
            await fbSignOut(auth);
            showEmailVerificationNotice(email);
            return;
        } else {
            ConversionTracker.loginStart('email');
            await signInWithEmailAndPassword(auth, email, pw);
            ConversionTracker.loginComplete('email');
        }
    } catch (e) { alert("인증 오류: " + e.message); }
    finally { btn.innerText = AppState.isLoginMode ? "시스템 접속" : "회원가입"; btn.disabled = false; }
}

async function handleForgotPassword() {
    const email = document.getElementById('login-email').value;
    const lang = AppState.currentLang || 'ko';
    if (!email) {
        alert(i18n[lang]?.forgot_pw_no_email || "비밀번호를 초기화할 이메일 주소를 입력해주세요.");
        document.getElementById('login-email').focus();
        return;
    }
    if (!validateEmail(email)) {
        alert(i18n[lang]?.login_err_email || "유효한 이메일 주소를 입력해주세요.");
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        alert(i18n[lang]?.forgot_pw_sent || "비밀번호 재설정 메일이 발송되었습니다. 받은편지함을 확인해주세요.");
    } catch (e) {
        AppLogger.error('[Auth] 비밀번호 재설정 실패: ' + e.message);
        alert(i18n[lang]?.forgot_pw_error || "비밀번호 재설정 메일 발송에 실패했습니다: " + e.message);
    }
}

async function simulateGoogleLogin() {
    ConversionTracker.loginStart('google');
    // Capacitor 네이티브 앱(Android/iOS) 환경인지 확인
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    if (isNative) {
        // ── 안드로이드 앱: capacitor-google-auth 플러그인 사용 ──
        try {
            const { GoogleAuth } = window.Capacitor.Plugins;
            if (!GoogleAuth) {
                alert("GoogleAuth 플러그인 없음. 'npm install @codetrix-studio/capacitor-google-auth && npx cap sync android' 실행 필요");
                return;
            }
            // v3.x requires explicit initialization before signIn()
            // Without this, GoogleSignInClient remains null → NullPointerException
            // 주의: 프로그래밍 방식에서는 'clientId'를 사용 (capacitor.config.json의 'serverClientId'와 키 이름이 다름)
            await GoogleAuth.initialize({
                clientId: '233040099152-htr1tnuqmpadikjvj9hbitf4tuh0ako5.apps.googleusercontent.com',
                scopes: ['profile', 'email'],
                grantOfflineAccess: false
            });
            // 이미 로그인한 사용자는 확인 화면 없이 자동 로그인 시도
            let googleUser;
            try {
                googleUser = await GoogleAuth.refresh();
            } catch (_) {
                // refresh 실패 시 (최초 로그인 등) 대화형 로그인 진행
                googleUser = await GoogleAuth.signIn();
            }
            const idToken = googleUser.authentication.idToken;
            const credential = GoogleAuthProvider.credential(idToken);
            const result = await signInWithCredential(auth, credential);
            ConversionTracker.loginComplete('google');
            AppLogger.info('[Auth] 앱 구글 로그인 성공: ' + result.user.email);
        } catch (e) {
            const errCode = String(e.code || (e.error && e.error.code) || '');
            const errRaw = e.message || JSON.stringify(e);
            AppLogger.error('앱 구글 로그인 실패: ' + errRaw, (e.stack || '') + '\ncode=' + errCode);
            let errMsg = errRaw;
            if (errCode === '12501') {
                // 사용자가 로그인 취소 → 알림 없이 조용히 종료
                AppLogger.info('[Auth] 구글 로그인 취소 (사용자)');
                return;
            }
            if (errCode === '10') {
                errMsg = 'DEVELOPER_ERROR (코드 10)\n\n' +
                    'APK 서명 SHA-1 지문이 Firebase에 등록되지 않았습니다.\n\n' +
                    '해결 방법:\n' +
                    '1. GitHub Actions 빌드 로그 → "SHA-1 지문 출력" 단계에서 SHA-1 확인\n' +
                    '2. Firebase Console → 프로젝트 설정 → Android 앱(com.levelup.reboot)\n' +
                    '3. "SHA 인증서 지문" 섹션에 SHA-1 추가\n' +
                    '4. google-services.json 다시 다운로드 → 저장소에 커밋 후 재빌드';
            }
            alert("Google 로그인 실패:\n" + errMsg);
        }
    } else {
        // ── 웹 브라우저: 기존 Popup 방식 유지 ──
        try {
            await signInWithPopup(auth, googleProvider);
            ConversionTracker.loginComplete('google');
        } catch (e) {
            console.error("웹 구글 로그인 실패:", e);
            alert("Google 로그인 실패: " + e.message);
        }
    }
}

async function logout() {
    AppLogger.info('[Auth] 로그아웃');
    // 네이티브 앱에서 Google 세션도 완전히 해제
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (isNative) {
        try {
            const { GoogleAuth } = window.Capacitor.Plugins;
            if (GoogleAuth) {
                await GoogleAuth.signOut();
            }
        } catch (e) {
            AppLogger.warn('[Auth] Google signOut 실패 (무시): ' + (e.message || e));
        }
    }
    await fbSignOut(auth);
    localStorage.clear();
    window.location.reload();
}

// 계정 삭제 (Google 정책 준수)
async function deleteMyAccount() {
    const t = i18n[AppState.currentLang] || i18n.ko;
    const confirmMsg = t.del_confirm || "정말로 계정을 삭제하시겠습니까?\n\n삭제된 계정은 복구할 수 없으며, 모든 게임 데이터가 영구적으로 삭제됩니다.";
    const secondConfirmMsg = t.del_confirm2 || "마지막 확인입니다.\n계정을 삭제하면 되돌릴 수 없습니다.\n\n정말 삭제하시겠습니까?";

    if (!confirm(confirmMsg)) return;
    if (!confirm(secondConfirmMsg)) return;

    try {
        const btnDelete = document.getElementById('btn-delete-account');
        if (btnDelete) {
            btnDelete.disabled = true;
            btnDelete.textContent = t.del_processing || "삭제 처리 중...";
        }

        AppLogger.info('[Auth] 계정 삭제 요청');
        const ping = httpsCallable(functions, 'ping');
        const result = await ping({ action: 'deleteMyAccount' });

        if (result.data && result.data.success) {
            AppLogger.info('[Auth] 계정 삭제 완료');
            localStorage.clear();
            alert(t.del_done || "계정이 삭제되었습니다. 이용해 주셔서 감사합니다.");
            window.location.reload();
        }
    } catch (e) {
        AppLogger.error('[Auth] 계정 삭제 실패: ' + e.message);
        alert((t.del_fail || "계정 삭제에 실패했습니다.") + "\n" + e.message);
        const btnDelete = document.getElementById('btn-delete-account');
        if (btnDelete) {
            btnDelete.disabled = false;
            btnDelete.textContent = t.set_delete_account || "계정 삭제";
        }
    }
}

function toggleAuthMode() {
    AppState.isLoginMode = !AppState.isLoginMode;
    const btnSubmit = document.getElementById('btn-login-submit');
    const toggleText = document.getElementById('auth-toggle-btn');
    const pwField = document.getElementById('login-pw');
    const pwConfirm = document.getElementById('login-pw-confirm');
    const pwHint = document.getElementById('pw-hint');
    const forgotLink = document.getElementById('forgot-pw-link');

    if (AppState.isLoginMode) {
        // 로그인 모드: 비밀번호 확인/힌트 숨김
        pwConfirm.classList.add('d-none');
        pwHint.classList.add('d-none');
        if (!pwField.classList.contains('d-none')) forgotLink.classList.remove('d-none');
    } else {
        // 회원가입 모드: 비밀번호 필드가 표시 중이면 확인/힌트도 함께 표시 (3단계 축소)
        forgotLink.classList.add('d-none');
        if (!pwField.classList.contains('d-none')) {
            pwConfirm.classList.remove('d-none');
            pwHint.classList.remove('d-none');
        }
    }
    btnSubmit.innerText = AppState.isLoginMode ? "시스템 접속" : "플레이어 등록";
    toggleText.innerText = AppState.isLoginMode ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인";
}

// --- 이메일 인증 안내 화면 ---
let _pendingVerifyEmail = '';

function showEmailVerificationNotice(email) {
    _pendingVerifyEmail = email;
    document.querySelector('#login-screen > .login-center').classList.add('d-none');
    document.getElementById('email-verify-notice').classList.remove('d-none');
    document.getElementById('verify-email-addr').textContent = email;
    const lang = AppState.currentLang || 'ko';
    alert(i18n[lang]?.verify_sent || "인증 메일이 발송되었습니다.");
}

function hideEmailVerificationNotice() {
    document.getElementById('email-verify-notice').classList.add('d-none');
    document.querySelector('#login-screen > .login-center').classList.remove('d-none');
    _pendingVerifyEmail = '';
}

async function resendVerificationEmail() {
    const lang = AppState.currentLang || 'ko';
    const email = _pendingVerifyEmail || document.getElementById('login-email').value;
    const pw = document.getElementById('login-pw').value;
    if (!email || !pw) {
        alert(i18n[lang]?.login_err_empty || "이메일과 비밀번호를 입력해주세요.");
        return;
    }
    const btn = document.getElementById('btn-resend-verify');
    btn.disabled = true;
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, pw);
        await sendEmailVerification(userCredential.user);
        await fbSignOut(auth);
        alert(i18n[lang]?.verify_resent || "인증 메일이 재발송되었습니다.");
    } catch (e) {
        alert("오류: " + e.message);
    } finally {
        btn.disabled = false;
    }
}

async function loadProfileImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!auth.currentUser) {
        const lang = AppState.currentLang || 'ko';
        alert(lang === 'ko' ? '로그인이 필요합니다.' : 'Please log in first.');
        return;
    }
    const lang = AppState.currentLang || 'ko';
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = async () => {
            const _plog = (step, msg) => { console.log(`[ProfileImg:${step}] ${msg}`); if (window.AppLogger) AppLogger.info(`[ProfileImg:${step}] ${msg}`); };
            _plog('A', `img loaded: ${img.naturalWidth}x${img.naturalHeight}`);
            const canvas = document.createElement('canvas');
            canvas.width = 150; canvas.height = 150;
            const ctx = canvas.getContext('2d');
            // 중앙 크롭: 비정방형 이미지를 stretch 대신 center-crop
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - side) / 2;
            const sy = (img.naturalHeight - side) / 2;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, 150, 150);
            // 적응형 압축: 300KB 이하 보장 (500KB 규칙에 안전 마진 + 모바일 업로드 속도 고려)
            const { dataURL: base64, quality: usedQuality } = await compressToTargetSize(canvas, 300 * 1024, 0.7, 0.2);
            _plog('B', `canvas→base64: len=${base64.length}, quality=${usedQuality}, fmt=${_supportsWebP ? 'webp' : 'jpeg'}`);
            setProfilePreview(base64);
            if (!auth.currentUser) {
                _plog('C-FAIL', 'auth.currentUser is null after canvas');
                alert(lang === 'ko' ? '로그인이 필요합니다.' : 'Please log in first.');
                return;
            }
            _plog('C', `auth OK: uid=${auth.currentUser.uid}`);
            _profileUploadInFlight = true;
            try {
                const uid = auth.currentUser.uid;
                _plog('D', 'Calling uploadImageToStorage...');
                const lang = AppState.currentLang || 'ko';
                const progressCb = createUploadProgressCallback(lang === 'ko' ? '프로필 사진 업로드 중...' : 'Uploading profile photo...');
                const downloadURL = await uploadImageToStorage(`profile_images/${uid}/profile${getImageExtension()}`, base64, progressCb);
                hideUploadProgress();
                _plog('E', `Upload OK: url=${downloadURL.substring(0, 80)}...`);
                AppState.user.photoURL = downloadURL;
                setProfilePreview(downloadURL);
            } catch (e) {
                hideUploadProgress();
                _plog('D-FAIL', `Storage 업로드 실패: ${e.code || ''} ${e.message || e}`);
                console.error('[Profile] Storage 업로드 실패 (3회 재시도 후):', e);
                // base64 직접 저장 대신 실패 플래그 기록 — Firestore 문서 비대화 방지
                AppState.user.photoURL = AppState.user.photoURL || DEFAULT_PROFILE_SVG;
                AppState.user._profileUploadFailed = true;
                alert(lang === 'ko' ? '프로필 사진 업로드에 실패했습니다. 네트워크 확인 후 다시 시도해주세요.' : 'Profile photo upload failed. Please check your network and try again.');
            } finally {
                _profileUploadInFlight = false;
            }
            _plog('F', `photoURL set to: type=${AppState.user.photoURL.startsWith('http') ? 'url' : 'base64'}, len=${AppState.user.photoURL.length}`);
            try {
                _plog('G', 'Calling saveUserData...');
                await saveUserData();
                _plog('H', 'saveUserData OK');
                // 소셜 탭에 변경된 프로필 사진 즉시 반영
                updateSocialUserData();
                // 로컬 릴스 캐시의 프로필 이미지도 갱신
                updateLocalReelsProfileImage();
                _plog('I', 'All done - profile image saved successfully');
            } catch (e) {
                _plog('G-FAIL', `saveUserData 실패: ${e.code || ''} ${e.message || e}`);
                console.error('[Profile] 프로필 사진 DB 저장 실패:', e);
                alert(lang === 'ko' ? '프로필 사진 저장에 실패했습니다. 다시 시도해주세요.' : 'Failed to save profile picture. Please try again.');
            }
        };
        img.onerror = () => {
            console.error('[Profile] 이미지 로드 실패');
            alert(lang === 'ko' ? '이미지를 불러올 수 없습니다. 다른 파일을 선택해주세요.' : 'Unable to load image. Please select a different file.');
        };
        img.src = e.target.result;
    };
    reader.onerror = () => {
        console.error('[Profile] 파일 읽기 실패');
        alert(lang === 'ko' ? '파일을 읽을 수 없습니다. 다시 시도해주세요.' : 'Unable to read file. Please try again.');
    };
    reader.readAsDataURL(file);
}

// --- ★ 호칭 캐릭터 아이콘 함수 ★ ---
function getTitleIcon(titleText) {
    if (!titleText) return '🏅';
    const words = titleText.trim().split(/\s+/);
    const suffix = words[words.length - 1];
    return titleIconMap[suffix] || '🏅';
}

// 유저 카드에 표시할 호칭 배지 HTML 생성 (기존 호칭 + 희귀 호칭 자동 병렬)
function buildUserTitleBadgeHTML(u, fontSize) {
    const lang = AppState.currentLang;
    const baseIcon = getTitleIcon(u.title);
    const baseText = u.title;
    let rareInfo = null;

    if (u.isMe) {
        const best = getBestRareTitle();
        if (best) rareInfo = { icon: best.icon, text: best.title[lang] || best.title.ko, rarity: best.rarity };
    } else if (u.rareTitle) {
        rareInfo = { icon: u.rareTitle.icon, text: u.rareTitle.title[lang] || u.rareTitle.title.ko, rarity: u.rareTitle.rarity };
    }

    if (rareInfo) {
        const rarityClass = rarityConfig[rareInfo.rarity]?.class || '';
        return `<div class="title-badge-combined"><span class="title-badge" style="margin-bottom:0;">${baseIcon} ${sanitizeText(baseText)}</span><span class="title-badge ${rarityClass}" style="margin-bottom:0;">${rareInfo.icon} ${sanitizeText(rareInfo.text)}</span></div>`;
    }
    return `<div class="title-badge">${baseIcon} ${sanitizeText(baseText)}</div>`;
}

// --- ★ 팝업 모달창 로직 (다국어 지원 호칭 표 포함) ★ ---
function closeInfoModal() { 
    const m = document.getElementById('infoModal'); 
    m.classList.add('d-none'); 
    m.classList.remove('d-flex'); 
}

function closeTitleModal() { 
    const m = document.getElementById('titleModal'); 
    m.classList.add('d-none'); 
    m.classList.remove('d-flex');
}

// 희귀 호칭 컬렉션 HTML 빌더 (장착/해제 없이 자동 우선순위)
function buildRareTitleCollectionHTML(lang) {
    const unlocked = AppState.user.rareTitle.unlocked;
    const best = getBestRareTitle();
    const li18n = i18n[lang] || i18n.ko;

    // 공통 아이템 렌더링 헬퍼
    function renderItem(rt, titleId, conditionLabel) {
        const isUnlocked = unlocked.find(u => u.id === titleId);
        const isBest = best?.id === titleId;
        const rarityLabel = rarityConfig[rt.rarity]?.label[lang] || rt.rarity;
        const titleText = rt.title[lang] || rt.title.ko;
        if (isUnlocked) {
            return `<div class="rare-title-item ${isBest ? 'equipped' : ''}">
                <span class="rt-icon">${rt.icon}</span>
                <div class="rt-info">
                    <span class="rt-name">${titleText}</span>
                    <span class="rt-rarity ${rt.rarity}">${rarityLabel}</span>
                    ${isBest ? '<span class="rt-rarity legendary" style="margin-left:3px;">★</span>' : ''}
                    <div style="font-size:0.6rem; color:var(--text-sub);">${conditionLabel}</div>
                </div>
            </div>`;
        }
        return `<div class="rare-title-item" style="opacity:0.4;">
            <span class="rt-icon">🔒</span>
            <div class="rt-info">
                <span class="rt-name" style="color:var(--text-sub);">???</span>
                <span class="rt-rarity ${rt.rarity}">${rarityLabel}</span>
                <div style="font-size:0.6rem; color:var(--text-sub);">${conditionLabel}</div>
            </div>
        </div>`;
    }

    // 순서: 종합순위 > 스탯별1위 > 스트릭 > 걸음수
    const rankGlobalHTML = rareRankTitles.global.map(rt =>
        renderItem(rt, `global_rank_${rt.rank}`, `#${rt.rank} ${li18n.rare_title_global_rank || '종합 순위'}`)
    ).join('');

    const rankStatHTML = statKeys.map(stat =>
        renderItem(rareRankTitles.stat[stat], `stat_rank_${stat}`, `${stat.toUpperCase()} #1`)
    ).join('');

    const streakHTML = rareStreakTitles.map(rt =>
        renderItem(rt, `streak_${rt.days}`, `${rt.days}${li18n.streak_day || '일'} ${li18n.streak_label || '연속'}`)
    ).join('');

    const stepHTML = rareStepTitles.map(rt =>
        renderItem(rt, `steps_${rt.steps}`, `${rt.steps.toLocaleString()}${li18n.rare_title_step_unit || '보'}`)
    ).join('');

    const readingHTML = rareReadingTitles.map(rt =>
        renderItem(rt, `reading_${rt.books}`, `${rt.books}${li18n.rare_title_reading_unit || '권'}`)
    ).join('');

    return `
        <div style="margin-top:20px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px;">
            <div style="font-size:0.9rem; font-weight:bold; color:var(--neon-gold); margin-bottom:10px;">
                ${li18n.rare_title_guide || '희귀 호칭 가이드'}
            </div>
            <div style="font-size:0.75rem; color:var(--text-sub); margin-bottom:12px; line-height:1.4;">
                ${li18n.rare_title_guide_desc || '스트릭 달성, 랭킹 상위권 진입, 걸음수·독서 마일스톤 달성 시 특별한 희귀 호칭이 부여됩니다.'}
            </div>
            <div style="font-size:0.8rem; font-weight:bold; color:var(--neon-blue); margin:10px 0 6px;">
                👑 ${li18n.rare_title_rank_section || '랭킹 호칭'} — ${li18n.rare_title_global_rank || '종합 순위'}
            </div>
            ${rankGlobalHTML}
            <div style="font-size:0.8rem; font-weight:bold; color:var(--neon-blue); margin:15px 0 6px;">
                🏆 ${li18n.rare_title_rank_section || '랭킹 호칭'} — ${li18n.rare_title_stat_rank || '스탯별 1위'}
            </div>
            ${rankStatHTML}
            <div style="font-size:0.8rem; font-weight:bold; color:var(--neon-blue); margin:15px 0 6px;">
                🔥 ${li18n.rare_title_streak_section || '스트릭 달성 호칭'}
            </div>
            ${streakHTML}
            <div style="font-size:0.8rem; font-weight:bold; color:var(--neon-blue); margin:15px 0 6px;">
                🚶 ${li18n.rare_title_step_section || '걸음수 달성 호칭'}
            </div>
            ${stepHTML}
            <div style="font-size:0.8rem; font-weight:bold; color:var(--neon-blue); margin:15px 0 6px;">
                📚 ${li18n.rare_title_reading_section || '독서 달성 호칭'}
            </div>
            ${readingHTML}
        </div>
    `;
}

function openTitleModal() {
    const container = document.getElementById('title-guide-container');
    const lang = AppState.currentLang;

    // 언어별 텍스트 데이터 정의
    const textData = {
        ko: {
            title: "호칭 시스템 가이드",
            desc: "💡 <b style='color:var(--neon-blue);'>호칭 조합 공식</b><br>레벨업 시 보유한 스탯 점수를 기준으로 <b>[1위 스탯의 접두사] + [2위 스탯의 접미사]</b>가 결합되어 고유 호칭이 부여됩니다.",
            th_stat: "스탯", th_1st: "🥇 1위 (접두사)", th_2nd: "🥈 2위 (접미사)",
            str_1: "강인한", str_2: "전사 / 호랑이",
            int_1: "예리한", int_2: "학자 / 올빼미",
            cha_1: "매혹적인", cha_2: "셀럽 / 여우",
            vit_1: "지치지 않는", vit_2: "거북이 / 곰",
            wlth_1: "부유한", wlth_2: "자본가 / 귀족",
            agi_1: "날렵한", agi_2: "그림자 / 표범",
            footer: "※ 스탯 동점 시 시스템 내부 우선순위에 따름"
        },
        en: {
            title: "Title System Guide",
            desc: "💡 <b style='color:var(--neon-blue);'>Title Combination Rule</b><br>Upon leveling up, your unique title is generated by combining <b>[Prefix of 1st Stat] + [Suffix of 2nd Stat]</b> based on your stat points.",
            th_stat: "Stat", th_1st: "🥇 1st (Prefix)", th_2nd: "🥈 2nd (Suffix)",
            str_1: "Strong", str_2: "Warrior / Tiger",
            int_1: "Sharp", int_2: "Scholar / Owl",
            cha_1: "Charming", cha_2: "Celeb / Fox",
            vit_1: "Tenacious", vit_2: "Turtle / Bear",
            wlth_1: "Wealthy", wlth_2: "Capitalist / Noble",
            agi_1: "Agile", agi_2: "Shadow / Panther",
            footer: "※ In case of a tie, internal system priority applies."
        },
        ja: {
            title: "称号システムガイド",
            desc: "💡 <b style='color:var(--neon-blue);'>称号の組み合わせルール</b><br>レベルアップ時、ステータスポイントに基づき<b>【1位の接頭辞】＋【2位の接尾辞】</b>が組み合わされ、固有の称号が付与されます。",
            th_stat: "ステータス", th_1st: "🥇 1位 (接頭辞)", th_2nd: "🥈 2位 (接尾辞)",
            str_1: "強靭な", str_2: "戦士 / 虎",
            int_1: "鋭い", int_2: "学者 / 梟",
            cha_1: "魅惑的な", cha_2: "セレブ / 狐",
            vit_1: "疲れない", vit_2: "亀 / 熊",
            wlth_1: "裕福な", wlth_2: "資本家 / 貴族",
            agi_1: "俊敏な", agi_2: "影 / 豹",
            footer: "※ 同点の場合はシステム内部の優先順位に従います。"
        }
    };

    // 현재 언어에 맞는 데이터 선택 (없으면 기본값 ko)
    const l = textData[lang] || textData.ko;

    // 모달창 상단 제목 업데이트
    const titleEl = document.getElementById('title-modal-title');
    if (titleEl) titleEl.innerText = l.title;

    // 다국어 적용 HTML 생성
    const html = `
        <div style="font-size:0.8rem; color:var(--text-main); background: rgba(0, 217, 255, 0.05); border: 1px solid var(--neon-blue); padding: 12px; border-radius: 6px; margin-bottom:15px; line-height:1.5; word-break:keep-all;">
            ${l.desc}
        </div>

        <table class="info-table">
            <thead>
                <tr>
                    <th>${l.th_stat}</th>
                    <th>${l.th_1st}</th>
                    <th>${l.th_2nd}</th>
                </tr>
            </thead>
            <tbody>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">STR</span></td><td>${l.str_1}</td><td>${statTitleIcons.str} ${l.str_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">INT</span></td><td>${l.int_1}</td><td>${statTitleIcons.int} ${l.int_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">CHA</span></td><td>${l.cha_1}</td><td>${statTitleIcons.cha} ${l.cha_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">VIT</span></td><td>${l.vit_1}</td><td>${statTitleIcons.vit} ${l.vit_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">WLTH</span></td><td>${l.wlth_1}</td><td>${statTitleIcons.wlth} ${l.wlth_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">AGI</span></td><td>${l.agi_1}</td><td>${statTitleIcons.agi} ${l.agi_2}</td></tr>
            </tbody>
        </table>
        <div style="font-size:0.7rem; color:var(--text-sub); margin-top:10px; text-align:right;">${l.footer}</div>

        ${buildRareTitleCollectionHTML(lang)}
    `;

    container.innerHTML = html;
    const m = document.getElementById('titleModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

function openStatusInfoModal() {
    const lang = AppState.currentLang;
    document.getElementById('info-modal-title').innerText = i18n[lang].modal_status_title;
    const body = document.getElementById('info-modal-body');
    let html = `<p style="font-size:0.75rem; color:var(--neon-gold); margin:0 0 8px 0;">${i18n[lang].stat_hint}</p>`;
    html += `<table class="info-table"><thead><tr><th>${i18n[lang].th_stat}</th><th>${i18n[lang].th_desc}</th></tr></thead><tbody>`;
    statKeys.forEach(k => {
        html += `<tr><td style="text-align:center"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">${k.toUpperCase()}</span><br><b style="font-size:0.75rem; color:var(--text-main); display:inline-block; margin-top:3px;">${i18n[lang][k]}</b></td><td style="color:var(--text-sub); line-height:1.5;">${i18n[lang]['desc_'+k]}</td></tr>`;
    });
    html += `</tbody></table>`;

    // P0: 스트릭 시스템 & 스탯 감소 안내
    const streakGuide = {
        ko: { title: '🔥 스트릭 시스템', desc: '매일 퀘스트를 완료하면 연속 접속일(스트릭)이 증가합니다. 스트릭에 따라 보상 배율이 상승합니다.', decay: '⚠️ 3일 이상 미접속 시 스탯이 감소합니다.', tiers: '3일 → x1.2 | 7일 → x1.5 | 14일 → x2.0 | 30일 → x3.0' },
        en: { title: '🔥 Streak System', desc: 'Complete quests daily to build your streak. Higher streaks give higher reward multipliers.', decay: '⚠️ Stats decrease after 3+ days of inactivity.', tiers: '3d → x1.2 | 7d → x1.5 | 14d → x2.0 | 30d → x3.0' },
        ja: { title: '🔥 ストリークシステム', desc: '毎日クエストを完了するとストリークが増加します。ストリークに応じて報酬倍率が上昇します。', decay: '⚠️ 3日以上未接続でステータスが減少します。', tiers: '3日 → x1.2 | 7日 → x1.5 | 14日 → x2.0 | 30日 → x3.0' }
    };
    const sg = streakGuide[lang] || streakGuide.ko;
    html += `<div style="margin-top:14px; background:rgba(255,100,0,0.06); border:1px solid rgba(255,100,0,0.3); padding:10px; border-radius:6px;">
        <div style="font-weight:bold; color:#ff6a00; margin-bottom:6px;">${sg.title}</div>
        <p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; margin:0 0 6px 0;">${sg.desc}</p>
        <div style="font-size:0.7rem; color:var(--neon-gold); font-weight:bold; margin-bottom:6px;">${sg.tiers}</div>
        <p style="font-size:0.7rem; color:var(--neon-red); margin:0;">${sg.decay}</p>
    </div>`;

    body.innerHTML = html;
    const m = document.getElementById('infoModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

function openQuestInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_quest_title || "주간 퀘스트 목록";
    const body = document.getElementById('info-modal-body');
    const dayNames = { ko: ["일","월","화","수","목","금","토"], en: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], ja: ["日","月","火","水","木","金","土"] };
    
    let html = `<p style="font-size:0.75rem; color:var(--neon-gold); margin:0 0 8px 0;">${i18n[AppState.currentLang].quest_hint}</p>`;
    html += `<table class="info-table">
        <thead>
            <tr>
                <th>${i18n[AppState.currentLang].th_day}</th>
                <th>${i18n[AppState.currentLang].th_stat}</th>
                <th>${i18n[AppState.currentLang].th_quest}</th>
            </tr>
        </thead>
        <tbody>`;
    
    weeklyQuestData.forEach((dayQuests, i) => { 
        dayQuests.forEach((q, j) => {
            const rowSpan = j === 0 ? `<td rowspan="${dayQuests.length}" style="text-align:center; vertical-align:middle; background:rgba(255,255,255,0.05);"><b>${dayNames[AppState.currentLang][i]}</b></td>` : '';
            const title = q.title[AppState.currentLang] || q.title.ko;
            const desc = q.desc[AppState.currentLang] || q.desc.ko;

            html += `<tr>
                ${rowSpan}
                <td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">${q.stat}</span></td>
                <td><b style="color:var(--text-main);">${title}</b><br><span style="font-size:0.65rem; color:var(--text-sub);">${desc}</span></td>
            </tr>`; 
        }); 
    });
    
    html += `</tbody></table>`;

    // P2: 크리티컬 히트 & 루트 드롭 안내
    const questExtra = {
        ko: { crit_title: '⚡ 크리티컬 히트', crit_desc: '퀘스트 완료 시 15% 확률로 크리티컬이 발생하여 보상이 2~3배가 됩니다.', loot_title: '🎁 일일 올클리어 보상', loot_desc: '하루 퀘스트를 모두 완료하면 랜덤 전리품이 드롭됩니다.', loot_tiers: '일반(60%) · 고급(25%) · 희귀(12%) · 전설(3%)', loot_table_header: '전리품 목록', col_tier: '등급', col_item: '아이템', col_reward: '보상', col_chance: '확률', reward_points: 'P', reward_random_stat: '랜덤 스탯', reward_all_stat: '전체 스탯' },
        en: { crit_title: '⚡ Critical Hit', crit_desc: '15% chance of critical hit on quest completion — rewards are multiplied by 2~3x.', loot_title: '🎁 Daily All-Clear Reward', loot_desc: 'Complete all daily quests to receive a random loot drop.', loot_tiers: 'Common(60%) · Uncommon(25%) · Rare(12%) · Legendary(3%)', loot_table_header: 'Loot Table', col_tier: 'Tier', col_item: 'Item', col_reward: 'Reward', col_chance: 'Rate', reward_points: 'P', reward_random_stat: 'Random Stat', reward_all_stat: 'All Stats' },
        ja: { crit_title: '⚡ クリティカルヒット', crit_desc: 'クエスト完了時に15%の確率でクリティカルが発生し、報酬が2~3倍になります。', loot_title: '🎁 デイリーオールクリア報酬', loot_desc: '1日のクエストを全て完了するとランダム戦利品がドロップします。', loot_tiers: '一般(60%) · 高級(25%) · 希少(12%) · 伝説(3%)', loot_table_header: '戦利品一覧', col_tier: '等級', col_item: 'アイテム', col_reward: '報酬', col_chance: '確率', reward_points: 'P', reward_random_stat: 'ランダムステータス', reward_all_stat: '全ステータス' }
    };
    const qe = questExtra[AppState.currentLang] || questExtra.ko;
    const lang = AppState.currentLang;
    const tierNames = { common: i18n[lang]?.loot_common || 'Common', uncommon: i18n[lang]?.loot_uncommon || 'Uncommon', rare: i18n[lang]?.loot_rare || 'Rare', legendary: i18n[lang]?.loot_legendary || 'Legendary' };
    const tierColors = { common: '#aaa', uncommon: '#4fc3f7', rare: '#ab47bc', legendary: '#ffd740' };
    const totalWeight = lootTable.reduce((sum, item) => sum + item.weight, 0);

    let lootRows = '';
    lootTable.forEach(item => {
        const tierName = tierNames[item.tier];
        const tierColor = tierColors[item.tier];
        const itemName = item.name[lang] || item.name.ko;
        const chance = ((item.weight / totalWeight) * 100).toFixed(1) + '%';
        let rewardText = '';
        if (item.reward.type === 'points') {
            rewardText = `+${item.reward.value} ${qe.reward_points}`;
        } else if (item.reward.stat === 'all') {
            rewardText = `${qe.reward_all_stat} +${item.reward.value}`;
        } else {
            rewardText = `${qe.reward_random_stat} +${item.reward.value}`;
        }
        lootRows += `<tr>
            <td style="text-align:center;"><span style="color:${tierColor}; font-weight:bold; font-size:0.65rem;">${tierName}</span></td>
            <td style="font-size:0.7rem; color:var(--text-main);">${itemName}</td>
            <td style="font-size:0.7rem; color:var(--neon-blue); text-align:center;">${rewardText}</td>
            <td style="font-size:0.65rem; color:var(--text-sub); text-align:center;">${chance}</td>
        </tr>`;
    });

    html += `<div style="margin-top:14px; background:rgba(255,220,0,0.06); border:1px solid rgba(255,220,0,0.3); padding:10px; border-radius:6px;">
        <div style="font-weight:bold; color:var(--neon-gold); margin-bottom:6px;">${qe.crit_title}</div>
        <p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; margin:0;">${qe.crit_desc}</p>
    </div>
    <div style="margin-top:8px; background:rgba(0,217,255,0.06); border:1px solid rgba(0,217,255,0.3); padding:10px; border-radius:6px;">
        <div style="font-weight:bold; color:var(--neon-blue); margin-bottom:6px;">${qe.loot_title}</div>
        <p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; margin:0 0 4px 0;">${qe.loot_desc}</p>
        <div style="font-size:0.7rem; color:var(--neon-gold); font-weight:bold; margin-bottom:8px;">${qe.loot_tiers}</div>
        <div style="font-size:0.7rem; font-weight:bold; color:var(--neon-blue); margin-bottom:4px;">${qe.loot_table_header}</div>
        <table style="width:100%; border-collapse:collapse; font-size:0.7rem;">
            <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
                <th style="padding:4px; text-align:center; color:var(--text-sub); font-size:0.65rem;">${qe.col_tier}</th>
                <th style="padding:4px; color:var(--text-sub); font-size:0.65rem;">${qe.col_item}</th>
                <th style="padding:4px; text-align:center; color:var(--text-sub); font-size:0.65rem;">${qe.col_reward}</th>
                <th style="padding:4px; text-align:center; color:var(--text-sub); font-size:0.65rem;">${qe.col_chance}</th>
            </tr></thead>
            <tbody>${lootRows}</tbody>
        </table>
    </div>`;

    // P3: 주간 도전과제 안내
    const challengeGuide = {
        ko: { title: '🏅 주간 도전과제', desc: '매주 3개의 도전과제가 랜덤으로 출현합니다. 조건을 달성하면 추가 보상(포인트+스탯)을 수령할 수 있습니다.', reset: '일요일마다 자동 초기화됩니다.' },
        en: { title: '🏅 Weekly Challenges', desc: '3 random challenges appear each week. Complete conditions to claim bonus rewards (points + stats).', reset: 'Auto-resets every Sunday.' },
        ja: { title: '🏅 週間チャレンジ', desc: '毎週3つのチャレンジがランダムで出現します。条件を達成すると追加報酬(ポイント+ステータス)を獲得できます。', reset: '毎週日曜日に自動リセットされます。' }
    };
    const cg = challengeGuide[AppState.currentLang] || challengeGuide.ko;
    html += `<div style="margin-top:8px; background:rgba(200,150,0,0.06); border:1px solid rgba(200,150,0,0.3); padding:10px; border-radius:6px;">
        <div style="font-weight:bold; color:var(--neon-gold); margin-bottom:6px;">${cg.title}</div>
        <p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; margin:0 0 4px 0;">${cg.desc}</p>
        <p style="font-size:0.7rem; color:var(--text-sub); margin:0;">${cg.reset}</p>
    </div>`;

    // P4: 일일 룰렛 안내
    const rouletteGuide = {
        ko: { title: '🎰 일일 보너스 룰렛', desc: '퀘스트를 1개 이상 완료하면 하루 1회 룰렛을 돌릴 수 있습니다. 포인트 또는 스탯 부스트가 랜덤으로 지급됩니다.' },
        en: { title: '🎰 Daily Bonus Roulette', desc: 'Complete 1+ quests to unlock a daily spin. Win random points or stat boosts.' },
        ja: { title: '🎰 デイリーボーナスルーレット', desc: 'クエストを1つ以上完了すると、1日1回ルーレットを回せます。ポイントまたはステータスブーストがランダムで付与されます。' }
    };
    const rg = rouletteGuide[AppState.currentLang] || rouletteGuide.ko;
    html += `<div style="margin-top:8px; background:rgba(180,0,255,0.06); border:1px solid rgba(180,0,255,0.3); padding:10px; border-radius:6px;">
        <div style="font-weight:bold; color:var(--neon-purple); margin-bottom:6px;">${rg.title}</div>
        <p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; margin:0;">${rg.desc}</p>
    </div>`;

    body.innerHTML = html;
    const m = document.getElementById('infoModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

function openDiyQuestInfoModal() {
    const lang = AppState.currentLang;
    document.getElementById('info-modal-title').innerText = i18n[lang].diy_guide_title || "DIY 퀘스트 가이드";
    const body = document.getElementById('info-modal-body');

    const guideData = {
        ko: {
            sections: [
                { icon: '📝', title: '나만의 퀘스트 만들기', desc: '원하는 목표를 직접 퀘스트로 등록할 수 있습니다. 제목(최대 20자), 설명(최대 40자), 연결할 스탯을 선택하세요.' },
                { icon: '🔢', title: '최대 6개 생성 가능', desc: 'DIY 퀘스트는 최대 6개까지 만들 수 있습니다. 불필요한 퀘스트는 삭제 후 새로 만들어 주세요.' },
                { icon: '🔄', title: '매일 자동 초기화', desc: '매일 자정(KST)에 완료 상태가 초기화됩니다. 시스템 퀘스트와 동일하게 매일 반복됩니다.' },
                { icon: '📊', title: '스탯 연동', desc: 'STR · INT · CHA · VIT · WLTH · AGI 중 하나를 선택하면, 완료 시 해당 스탯에 보상이 적용됩니다.' },
                { icon: '🎯', title: '보상 구조', desc: '완료 시 기본 20포인트 + 0.5 스탯이 지급되며, 연속 달성(스트릭)에 따라 배율이 증가합니다. 크리티컬 히트도 발동됩니다.' },
                { icon: '✏️', title: '수정 및 삭제', desc: '퀘스트 옆 ✎ 버튼으로 제목·설명·스탯을 수정하거나 삭제할 수 있습니다.' }
            ]
        },
        en: {
            sections: [
                { icon: '📝', title: 'Create Your Own Quest', desc: 'Register your personal goals as quests. Set a title (max 20 chars), description (max 40 chars), and choose a stat.' },
                { icon: '🔢', title: 'Up to 6 Quests', desc: 'You can create a maximum of 6 DIY quests. Delete unused quests to make room for new ones.' },
                { icon: '🔄', title: 'Daily Auto-Reset', desc: 'Completion status resets at midnight (KST) every day, just like system quests.' },
                { icon: '📊', title: 'Stat Linked', desc: 'Choose from STR · INT · CHA · VIT · WLTH · AGI. Completing the quest rewards the selected stat.' },
                { icon: '🎯', title: 'Rewards', desc: 'Earn 20 points + 0.5 stat per completion. Streak multipliers and critical hits apply.' },
                { icon: '✏️', title: 'Edit & Delete', desc: 'Tap the ✎ button next to a quest to edit its title, description, stat, or delete it.' }
            ]
        },
        ja: {
            sections: [
                { icon: '📝', title: '自分だけのクエスト作成', desc: '自分の目標をクエストとして登録できます。タイトル(最大20文字)、説明(最大40文字)、ステータスを選択してください。' },
                { icon: '🔢', title: '最大6個まで作成可能', desc: 'DIYクエストは最大6個まで作成できます。不要なクエストは削除してから新しく作成してください。' },
                { icon: '🔄', title: '毎日自動リセット', desc: '毎日深夜0時(KST)に完了状態がリセットされます。システムクエストと同様に毎日繰り返されます。' },
                { icon: '📊', title: 'ステータス連動', desc: 'STR · INT · CHA · VIT · WLTH · AGIから1つ選択すると、完了時にそのステータスに報酬が適用されます。' },
                { icon: '🎯', title: '報酬構造', desc: '完了時に基本20ポイント + 0.5ステータスが付与され、連続達成(ストリーク)で倍率が増加します。クリティカルヒットも発動します。' },
                { icon: '✏️', title: '編集と削除', desc: 'クエスト横の✎ボタンでタイトル・説明・ステータスを変更、または削除できます。' }
            ]
        }
    };

    const data = guideData[lang] || guideData.ko;
    let html = '';
    data.sections.forEach(s => {
        html += `<div style="margin-bottom:8px; background:rgba(255,204,0,0.04); border:1px solid rgba(255,204,0,0.15); padding:10px; border-radius:6px;">
            <div style="font-weight:bold; color:var(--neon-gold); margin-bottom:4px; font-size:0.8rem;">${s.icon} ${s.title}</div>
            <p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; margin:0;">${s.desc}</p>
        </div>`;
    });

    body.innerHTML = html;
    const m = document.getElementById('infoModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

function openDungeonInfoModal() {
    document.getElementById('info-modal-title').innerText = i18n[AppState.currentLang].modal_dungeon_title || "이상 현상 목록";
    const body = document.getElementById('info-modal-body');
    
    const timeLabels = {
        ko: { time_title: '🕒 레이드 개방 시간 (KST)', slot1: '1차', slot2: '2차', slot3: '3차', station_title: '📍 출현 가능 역 (18개소)' },
        en: { time_title: '🕒 Raid Hours (KST)', slot1: '1st', slot2: '2nd', slot3: '3rd', station_title: '📍 Spawn Stations (18)' },
        ja: { time_title: '🕒 レイド開放時間 (KST)', slot1: '第1回', slot2: '第2回', slot3: '第3回', station_title: '📍 出現可能駅 (18箇所)' }
    };
    const tl = timeLabels[AppState.currentLang] || timeLabels.ko;

    const timeInfoHtml = `
        <div style="background:rgba(0, 217, 255, 0.05); border:1px solid var(--neon-blue); padding:10px; border-radius:6px; margin-bottom:10px; text-align:center;">
            <div style="font-size:0.7rem; color:var(--text-sub); margin-bottom:6px;">${tl.time_title}</div>
            <div style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap;">
                <span style="background:rgba(0,217,255,0.15); padding:3px 8px; border-radius:4px; font-size:0.75rem; color:var(--neon-blue); font-weight:bold;">${tl.slot1} 06:00~08:00</span>
                <span style="background:rgba(0,217,255,0.15); padding:3px 8px; border-radius:4px; font-size:0.75rem; color:var(--neon-blue); font-weight:bold;">${tl.slot2} 11:30~13:30</span>
                <span style="background:rgba(0,217,255,0.15); padding:3px 8px; border-radius:4px; font-size:0.75rem; color:var(--neon-blue); font-weight:bold;">${tl.slot3} 19:00~21:00</span>
            </div>
        </div>
    `;

    const stationNames = seoulStations.map(s => s.name[AppState.currentLang] || s.name.ko);
    const stationInfoHtml = `
        <div style="background:rgba(0, 217, 255, 0.05); border:1px solid var(--neon-blue); padding:10px; border-radius:6px; margin-bottom:10px;">
            <div style="font-size:0.7rem; color:var(--text-sub); margin-bottom:6px; text-align:center;">${tl.station_title}</div>
            <div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:center;">
                ${stationNames.map(n => `<span style="background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:3px; font-size:0.65rem; color:var(--text-main);">${n}</span>`).join('')}
            </div>
        </div>
    `;

    let html = `<table class="info-table">
        <thead>
            <tr>
                <th>${i18n[AppState.currentLang].th_stat}</th>
                <th>${i18n[AppState.currentLang].th_raid}</th>
                <th>${i18n[AppState.currentLang].th_req}</th>
            </tr>
        </thead>
        <tbody>`;

    Object.keys(raidMissions).forEach(k => {
        const m = raidMissions[k];
        const title = m.title[AppState.currentLang] || m.title.ko;
        const reqTask = m.desc2[AppState.currentLang] || m.desc2.ko;

        html += `<tr>
            <td style="text-align:center; vertical-align:middle;"><span class="quest-stat-tag" style="border-color:${m.color}; color:${m.color};">${m.stat}</span></td>
            <td style="word-break:keep-all; font-weight:bold; color:var(--text-main);">${title}</td>
            <td style="word-break:keep-all; color:var(--text-sub); font-size:0.75rem;">${reqTask}</td>
        </tr>`;
    });

    html += `</tbody></table>`;

    // P1: 보스 HP 시스템 & 근접 보너스 안내
    const dungeonExtra = {
        ko: { boss_title: '👹 보스 HP 시스템', boss_desc: '던전에 보스 HP 바가 도입되었습니다. 참여자들이 레이드 액션으로 데미지를 입혀 보스를 처치합니다. 인원이 많을수록 클리어가 쉬워집니다.',
            open_title: '🌐 GPS 제한 해제', open_desc: '누구나 위치에 관계없이 던전에 참여할 수 있습니다. 해당 역 반경 2km 이내 접속 시 근접 보너스 +50P가 추가 지급됩니다.',
            rush_title: '🔥 주말 보스 러시', rush_desc: '토·일요일에는 보스 HP가 2배, 클리어 보상도 2배로 적용됩니다!' },
        en: { boss_title: '👹 Boss HP System', boss_desc: 'Dungeons now feature a Boss HP bar. Participants deal damage together via raid actions to defeat the boss. More allies = easier clear.',
            open_title: '🌐 GPS Lock Removed', open_desc: 'Anyone can join dungeons regardless of location. +50P proximity bonus for being within 2km of the station.',
            rush_title: '🔥 Weekend Boss Rush', rush_desc: 'On weekends, boss HP is doubled and clear rewards are doubled!' },
        ja: { boss_title: '👹 ボスHPシステム', boss_desc: 'ダンジョンにボスHPバーが導入されました。参加者がレイドアクションでダメージを与えてボスを撃破します。人数が多いほどクリアが楽になります。',
            open_title: '🌐 GPS制限解除', open_desc: '場所に関係なく誰でもダンジョンに参加できます。駅から半径2km以内で接続すると近接ボーナス+50Pが追加されます。',
            rush_title: '🔥 週末ボスラッシュ', rush_desc: '土日はボスHP2倍、クリア報酬も2倍です！' }
    };
    const de = dungeonExtra[AppState.currentLang] || dungeonExtra.ko;
    html += `<div style="margin-top:14px; background:rgba(255,60,60,0.06); border:1px solid rgba(255,60,60,0.3); padding:10px; border-radius:6px;">
        <div style="font-weight:bold; color:var(--neon-red); margin-bottom:6px;">${de.boss_title}</div>
        <p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; margin:0;">${de.boss_desc}</p>
    </div>
    <div style="margin-top:8px; background:rgba(0,217,255,0.06); border:1px solid rgba(0,217,255,0.3); padding:10px; border-radius:6px;">
        <div style="font-weight:bold; color:var(--neon-blue); margin-bottom:6px;">${de.open_title}</div>
        <p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; margin:0;">${de.open_desc}</p>
    </div>
    <div style="margin-top:8px; background:rgba(255,100,0,0.06); border:1px solid rgba(255,100,0,0.3); padding:10px; border-radius:6px;">
        <div style="font-weight:bold; color:#ff6a00; margin-bottom:6px;">${de.rush_title}</div>
        <p style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; margin:0;">${de.rush_desc}</p>
    </div>`;

    body.innerHTML = timeInfoHtml + stationInfoHtml + html;
    const m = document.getElementById('infoModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

// --- ★ 플래너 가이드 모달 ★ ---
function openPlannerInfoModal() {
    const lang = AppState.currentLang;
    const guideData = {
        ko: {
            title: '플래너 사용 가이드',
            sections: [
                { icon: '⭐', title: '우선순위 태스크', desc: '하루의 핵심 할 일을 최대 6개 입력하세요. 왼쪽 버튼을 눌러 우선순위를 매기면 자동으로 번호가 부여됩니다.' },
                { icon: '🕐', title: '시간표 (타임박스)', desc: '05:00~23:30까지 30분 단위로 할 일을 배치하세요. 우선순위 태스크에서 입력한 항목이 드롭다운에 표시됩니다.' },
                { icon: '📷', title: '사진 & 한마디', desc: '시간표 탭에서 사진을 첨부하고 오늘의 한마디를 작성하세요. Day1 포스팅 시 필수입니다.' },
                { icon: '💾', title: '저장 보상', desc: '하루 1회 저장 시 +20P & AGI +0.5 보상을 받습니다.' },
                { icon: '📤', title: 'Day1 포스팅', desc: '시간표와 사진, 텍스트를 모두 완성하면 Day1에 포스팅할 수 있습니다. 포스팅 시 +20P & CHA +0.5 보상! 24시간 후 자동 삭제됩니다.' },
                { icon: '🔗', title: '공유 기능', desc: '포스팅 버튼 옆 공유 아이콘을 눌러 플래너를 이미지로 저장하거나 요약 텍스트를 클립보드에 복사할 수 있습니다.' }
            ]
        },
        en: {
            title: 'Planner Guide',
            sections: [
                { icon: '⭐', title: 'Priority Tasks', desc: 'Enter up to 6 key tasks for the day. Tap the left button to assign priority - numbers are assigned automatically.' },
                { icon: '🕐', title: 'Schedule (Timebox)', desc: 'Assign tasks in 30-min blocks from 05:00-23:30. Tasks from Priority list appear in the dropdown.' },
                { icon: '📷', title: 'Photo & Caption', desc: 'Attach a photo and write a caption in the Schedule tab. Required for Day1 posting.' },
                { icon: '💾', title: 'Save Reward', desc: 'Save once a day to earn +20P & AGI +0.5.' },
                { icon: '📤', title: 'Day1 Posting', desc: 'Complete the schedule, photo, and caption to post to Day1. Earn +20P & CHA +0.5! Auto-deleted after 24 hours.' },
                { icon: '🔗', title: 'Sharing', desc: 'Tap the share icon next to the Post button to save your planner as an image or copy a summary to clipboard.' }
            ]
        },
        ja: {
            title: 'プランナーガイド',
            sections: [
                { icon: '⭐', title: '優先タスク', desc: '1日の重要なタスクを最大6つ入力してください。左のボタンを押すと優先順位が自動付与されます。' },
                { icon: '🕐', title: 'スケジュール (タイムボックス)', desc: '05:00〜23:30まで30分単位でタスクを配置できます。優先タスクの項目がドロップダウンに表示されます。' },
                { icon: '📷', title: '写真 & キャプション', desc: 'スケジュールタブで写真を添付し、今日の一言を書きましょう。Day1投稿に必須です。' },
                { icon: '💾', title: '保存報酬', desc: '1日1回保存で+20P & AGI +0.5の報酬を獲得できます。' },
                { icon: '📤', title: 'Day1投稿', desc: 'スケジュール・写真・テキストを完成させるとDay1に投稿できます。投稿で+20P & CHA +0.5！24時間後に自動削除されます。' },
                { icon: '🔗', title: '共有機能', desc: '投稿ボタン横の共有アイコンをタップして、プランナーを画像保存またはテキストをコピーできます。' }
            ]
        }
    };

    const g = guideData[lang] || guideData.ko;
    document.getElementById('info-modal-title').innerText = g.title;
    const body = document.getElementById('info-modal-body');

    body.innerHTML = g.sections.map(s => `
        <div style="display:flex; gap:10px; align-items:flex-start; padding:10px 0; border-bottom:1px dashed var(--border-color);">
            <span style="font-size:1.3rem; flex-shrink:0;">${s.icon}</span>
            <div>
                <div style="font-size:0.85rem; font-weight:bold; color:var(--neon-blue); margin-bottom:3px;">${s.title}</div>
                <div style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; word-break:keep-all;">${s.desc}</div>
            </div>
        </div>
    `).join('');

    const m = document.getElementById('infoModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

// --- ★ 내 서재 가이드 모달 ★ ---
window.openLibraryInfoModal = function() {
    const lang = AppState.currentLang;
    const guideData = {
        ko: {
            title: '내 서재 가이드',
            sections: [
                { icon: '📚', title: '책 등록', desc: '📷 버튼으로 ISBN 바코드를 스캔하거나, 검색창에서 직접 책을 검색하여 추가하세요.' },
                { icon: '📖', title: '카테고리', desc: '읽고있는책, 읽은책, 읽고싶은책 3가지 카테고리로 관리할 수 있습니다.' },
                { icon: '🏆', title: '독서 보상', desc: '책을 읽은책으로 등록하면 +10P & INT +0.5 보상을 받습니다! (책 당 1회)' },
                { icon: '📊', title: '통계', desc: '전체, 연간, 월간 독서량을 확인할 수 있습니다.' },
                { icon: '🗼', title: '바벨의 도서관', desc: '읽은 책을 쌓아서 바벨탑을 만들어보세요!' }
            ]
        },
        en: {
            title: 'Library Guide',
            sections: [
                { icon: '📚', title: 'Add Books', desc: 'Scan ISBN barcodes with the 📷 button or search for books directly.' },
                { icon: '📖', title: 'Categories', desc: 'Organize books into Reading, Read, and Want to Read.' },
                { icon: '🏆', title: 'Reading Reward', desc: 'Mark a book as Read to earn +10P & INT +0.5! (Once per book)' },
                { icon: '📊', title: 'Statistics', desc: 'View your reading stats by total, yearly, and monthly.' },
                { icon: '🗼', title: 'Tower of Babel', desc: 'Stack your read books to build your own Tower of Babel!' }
            ]
        },
        ja: {
            title: '書斎ガイド',
            sections: [
                { icon: '📚', title: '本の登録', desc: '📷ボタンでISBNバーコードをスキャンするか、検索で直接本を追加できます。' },
                { icon: '📖', title: 'カテゴリ', desc: '読書中、読了、読みたいの3つのカテゴリで管理できます。' },
                { icon: '🏆', title: '読書報酬', desc: '本を読了に登録すると+10P & INT +0.5の報酬！（本ごとに1回）' },
                { icon: '📊', title: '統計', desc: '全体、年間、月間の読書量を確認できます。' },
                { icon: '🗼', title: 'バベルの図書館', desc: '読んだ本を積み上げてバベルの塔を作りましょう！' }
            ]
        }
    };

    const g = guideData[lang] || guideData.ko;
    document.getElementById('info-modal-title').innerText = g.title;
    const body = document.getElementById('info-modal-body');
    body.innerHTML = g.sections.map(s => `
        <div style="display:flex; gap:10px; align-items:flex-start; padding:10px 0; border-bottom:1px dashed var(--border-color);">
            <span style="font-size:1.3rem; flex-shrink:0;">${s.icon}</span>
            <div>
                <div style="font-size:0.85rem; font-weight:bold; color:var(--neon-blue); margin-bottom:3px;">${s.title}</div>
                <div style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; word-break:keep-all;">${s.desc}</div>
            </div>
        </div>
    `).join('');

    const m = document.getElementById('infoModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
};

// --- ★ 설정 가이드 모달 (푸시/GPS/피트니스) ★ ---
function openSettingsGuideModal(type) {
    const lang = AppState.currentLang;
    const l = i18n[lang];
    const titleKey = `settings_guide_${type}_title`;
    const descKey = `settings_guide_${type}_desc`;
    const title = l[titleKey] || titleKey;
    const desc = l[descKey] || descKey;

    const colors = { push: 'var(--neon-gold)', gps: 'var(--neon-blue)', fitness: 'var(--neon-purple, #b388ff)', delete: 'var(--neon-red)' };
    const icons = { push: '🔔', gps: '📍', fitness: '🏃', delete: '⚠️' };
    const color = colors[type] || 'var(--neon-blue)';
    const icon = icons[type] || 'ℹ️';

    document.getElementById('info-modal-title').innerText = title;
    const body = document.getElementById('info-modal-body');
    body.innerHTML = `
        <div style="background:rgba(0,217,255,0.06); border:1px solid ${color}; padding:14px; border-radius:8px; text-align:center;">
            <div style="font-size:2rem; margin-bottom:8px;">${icon}</div>
            <div style="font-weight:bold; color:${color}; margin-bottom:8px; font-size:0.9rem;">${title}</div>
            <p style="font-size:0.8rem; color:var(--text-sub); line-height:1.6; margin:0;">${desc}</p>
        </div>
    `;

    const m = document.getElementById('infoModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

// --- ★ Day1 가이드 모달 ★ ---
function openDay1InfoModal() {
    const lang = AppState.currentLang;
    const l = i18n[lang];
    document.getElementById('info-modal-title').innerText = l.day1_guide_title || 'Day1 Guide';
    const body = document.getElementById('info-modal-body');
    body.innerHTML = `
        <div style="background:rgba(0,217,255,0.06); border:1px solid var(--neon-blue); padding:12px; border-radius:8px; margin-bottom:10px;">
            <div style="font-weight:bold; color:var(--neon-blue); margin-bottom:8px;">🎬 ${l.day1_guide_title || 'Day1 Guide'}</div>
            <p style="font-size:0.8rem; color:var(--text-sub); line-height:1.6; margin:0 0 8px 0;">${l.day1_guide_desc || ''}</p>
        </div>
        <div style="background:rgba(255,220,0,0.06); border:1px solid var(--neon-gold); padding:10px; border-radius:8px; margin-bottom:8px;">
            <div style="font-weight:bold; color:var(--neon-gold); margin-bottom:4px;">🎁 ${l.day1_guide_reward || ''}</div>
        </div>
        <div style="background:rgba(255,60,60,0.06); border:1px solid var(--neon-red); padding:10px; border-radius:8px; margin-bottom:8px;">
            <div style="font-weight:bold; color:var(--neon-red); margin-bottom:4px;">⏰ ${l.day1_guide_auto_delete || ''}</div>
        </div>
        <div style="background:rgba(180,0,255,0.06); border:1px solid rgba(180,0,255,0.3); padding:10px; border-radius:8px;">
            <div style="font-size:0.75rem; color:var(--text-sub);">${l.day1_guide_cooldown || ''}</div>
        </div>
    `;

    const m = document.getElementById('infoModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

// --- ★ 플래너 공유 모달 ★ ---
function openShareModal() {
    const lang = AppState.currentLang;
    const titles = { ko: '플래너 공유', en: 'Share Planner', ja: 'プランナー共有' };
    document.getElementById('share-modal-title').innerText = titles[lang] || titles.ko;
    const m = document.getElementById('shareModal');
    m.classList.remove('d-none');
    m.classList.add('d-flex');
}

// 인앱 이미지 오버레이 (공유 버튼으로 네이티브 공유 시트 호출)
function showImageOverlay(dataUrl, lang) {
    const saveLabels = { ko: '📤 공유하여 저장', en: '📤 Share to Save', ja: '📤 共有して保存' };
    const closeLabels = { ko: '닫기', en: 'Close', ja: '閉じる' };
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.95);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.cssText = 'max-width:100%;max-height:70vh;border-radius:8px;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;margin-top:16px;';

    // 공유 버튼 (네이티브 공유 시트 → 갤러리/파일에 저장 가능)
    const shareBtn = document.createElement('button');
    shareBtn.textContent = saveLabels[lang] || saveLabels.ko;
    shareBtn.style.cssText = 'padding:12px 24px;background:var(--neon-blue);color:#000;border:none;border-radius:6px;font-weight:bold;cursor:pointer;font-size:0.95rem;';
    shareBtn.onclick = async () => {
        try {
            // dataUrl → Blob → File
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const file = new File([blob], 'planner.png', { type: 'image/png' });
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file] });
            } else {
                // Share API 미지원 시 Blob 다운로드 시도
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'planner.png';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        } catch(e) {
            if (e.name !== 'AbortError') {
                AppLogger.error('[Planner] Overlay share failed: ' + e.message);
            }
        }
    };

    // 닫기 버튼
    const closeBtn = document.createElement('button');
    closeBtn.textContent = closeLabels[lang] || closeLabels.ko;
    closeBtn.style.cssText = 'padding:12px 24px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid #555;border-radius:6px;font-weight:bold;cursor:pointer;font-size:0.95rem;';
    closeBtn.onclick = () => overlay.remove();

    btnRow.appendChild(shareBtn);
    btnRow.appendChild(closeBtn);
    overlay.appendChild(img);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);
}

// 플래너를 이미지로 저장 (html2canvas 없이 캔버스 직접 생성)
window.sharePlannerAsImage = async function() {
    const lang = AppState.currentLang;
    const dateStr = diarySelectedDate;
    const entry = getDiaryEntry(dateStr);

    const blocks = (entry && entry.blocks) ? Object.entries(entry.blocks).sort(([a],[b]) => a.localeCompare(b)) : [];
    const caption = (entry && entry.caption) ? entry.caption : (document.getElementById('planner-caption')?.value || '');
    const photoSrc = _plannerPhotoBase64 || plannerPhotoData || (entry && entry.photo) || null;
    const mood = (entry && entry.mood) ? entry.mood : '';
    const moodMap = { great: '😄', good: '🙂', neutral: '😐', bad: '😞', terrible: '😫' };
    const moodEmoji = moodMap[mood] || '';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const W = 540;
    const pad = 20;
    const innerW = W - pad * 2;

    // cross-origin 이미지를 fetch→blob→objectURL로 로드 (canvas taint 방지)
    async function loadImageSafe(src) {
        if (!src) return null;
        try {
            // data: URL이나 blob: URL은 직접 로드 (taint 없음)
            if (src.startsWith('data:') || src.startsWith('blob:')) {
                return await new Promise(resolve => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => resolve(null);
                    img.src = src;
                });
            }
            // HTTP URL: fetch로 blob 변환 후 objectURL 사용
            const resp = await fetch(src);
            const blob = await resp.blob();
            const objectUrl = URL.createObjectURL(blob);
            const img = await new Promise(resolve => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => resolve(null);
                el.src = objectUrl;
            });
            URL.revokeObjectURL(objectUrl);
            return img;
        } catch(e) {
            return null;
        }
    }

    // 사진 로드 (있을 경우)
    let photoImg = null;
    let photoH = 0;
    if (photoSrc) {
        photoImg = await loadImageSafe(photoSrc);
        if (photoImg) {
            photoH = Math.round(innerW * (photoImg.height / photoImg.width));
            if (photoH > 400) photoH = 400;
        }
    }

    // 시간표 블록 (연속 동일 업무 합치기, 최대 8개 표시)
    const mergedImageBlocks = mergeConsecutiveBlocks(Object.fromEntries(blocks));
    const maxBlocks = 8;
    const displayBlocks = mergedImageBlocks.slice(0, maxBlocks);
    const moreCount = mergedImageBlocks.length > maxBlocks ? mergedImageBlocks.length - maxBlocks : 0;

    // 높이 계산
    const lineH = 24;
    const headerH = 56;
    let totalH = pad;                   // top padding
    totalH += headerH;                  // 프로필 헤더
    if (photoImg) totalH += photoH + 12; // 사진
    if (caption) totalH += 40;           // 캡션
    if (displayBlocks.length > 0) {
        totalH += 32;                    // 시간표 제목
        totalH += displayBlocks.length * lineH; // 블록 행
        if (moreCount > 0) totalH += 20; // +more
        totalH += 16;                    // 하단 여백
    }
    totalH += 36;                        // 푸터
    totalH += pad;                       // bottom padding

    canvas.width = W;
    canvas.height = totalH;

    // 배경
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, totalH);

    // 카드 영역 (system-card 스타일)
    const cardX = pad - 4, cardY = pad - 4;
    const cardW = innerW + 8, cardH = totalH - pad * 2 + 8;
    ctx.fillStyle = 'rgba(15, 25, 40, 0.95)';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(cardX + r, cardY);
    ctx.lineTo(cardX + cardW - r, cardY);
    ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + r);
    ctx.lineTo(cardX + cardW, cardY + cardH - r);
    ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - r, cardY + cardH);
    ctx.lineTo(cardX + r, cardY + cardH);
    ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - r);
    ctx.lineTo(cardX, cardY + r);
    ctx.quadraticCurveTo(cardX, cardY, cardX + r, cardY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    let y = pad;

    // --- 프로필 헤더 (reels-header 스타일) ---
    // 아바타 원형
    const avatarSize = 38;
    const avatarX = pad + 6;
    const avatarCenterY = y + headerH / 2;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarCenterY, avatarSize / 2 + 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#00d9ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#1a2332';
    ctx.fill();

    // 프로필 이미지 로드 시도
    if (AppState.user.photoURL) {
        try {
            const profImg = await loadImageSafe(AppState.user.photoURL);
            if (profImg) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(profImg, avatarX, avatarCenterY - avatarSize / 2, avatarSize, avatarSize);
                ctx.restore();
            }
        } catch(e) {}
    }

    // 유저명
    const textX = avatarX + avatarSize + 12;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Pretendard, sans-serif';
    ctx.fillText(AppState.user.name || '헌터', textX, avatarCenterY - 4);

    // Lv + 무드
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '12px Pretendard, sans-serif';
    ctx.fillText('Lv.' + Math.floor(AppState.user.level) + (moodEmoji ? ' ' + moodEmoji : ''), textX, avatarCenterY + 14);

    // 날짜 (우측)
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '11px Pretendard, sans-serif';
    const dateDisplay = formatReelsTime(Date.now());
    ctx.fillText(dateDisplay, W - pad - ctx.measureText(dateDisplay).width - 6, avatarCenterY + 2);

    y += headerH;

    // --- 사진 ---
    if (photoImg) {
        const imgX = pad;
        const imgW = innerW;
        ctx.drawImage(photoImg, imgX, y, imgW, photoH);
        y += photoH + 12;
    }

    // --- 캡션 ---
    if (caption) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '13px Pretendard, sans-serif';
        // 텍스트가 긴 경우 줄임
        let displayCaption = caption;
        if (ctx.measureText(displayCaption).width > innerW - 20) {
            while (ctx.measureText(displayCaption + '...').width > innerW - 20 && displayCaption.length > 0) {
                displayCaption = displayCaption.slice(0, -1);
            }
            displayCaption += '...';
        }
        ctx.fillText(displayCaption, pad + 10, y + 18);
        y += 40;
    }

    // --- 시간표 블록 (reels-timetable 스타일) ---
    if (displayBlocks.length > 0) {
        // 시간표 배경 박스
        const ttX = pad + 4, ttY = y;
        const ttW = innerW - 8;
        const ttH = 28 + displayBlocks.length * lineH + (moreCount > 0 ? 20 : 0) + 8;
        ctx.fillStyle = 'rgba(0, 217, 255, 0.04)';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(ttX, ttY, ttW, ttH, 6);
        ctx.fill();
        ctx.stroke();

        // 시간표 제목
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 12px Pretendard, sans-serif';
        const schedLabel = { ko: '시간표', en: 'Schedule', ja: 'スケジュール' };
        ctx.fillText('📋 ' + (schedLabel[lang] || schedLabel.ko), ttX + 10, y + 20);
        y += 32;

        // 블록 행
        displayBlocks.forEach(({time, task}) => {
            ctx.fillStyle = '#00d9ff';
            ctx.font = 'bold 12px Pretendard, monospace';
            ctx.fillText(time, ttX + 10, y + 16);
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Pretendard, sans-serif';
            // 긴 텍스트 줄임
            let displayTask = task;
            const maxTaskW = ttW - 130;
            if (ctx.measureText(displayTask).width > maxTaskW) {
                while (ctx.measureText(displayTask + '...').width > maxTaskW && displayTask.length > 0) {
                    displayTask = displayTask.slice(0, -1);
                }
                displayTask += '...';
            }
            ctx.fillText(displayTask, ttX + 110, y + 16);

            // 구분선
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(ttX + 10, y + lineH);
            ctx.lineTo(ttX + ttW - 10, y + lineH);
            ctx.stroke();

            y += lineH;
        });

        if (moreCount > 0) {
            ctx.fillStyle = '#aaa';
            ctx.font = '10px Pretendard, sans-serif';
            const moreText = `+${moreCount} more`;
            ctx.fillText(moreText, ttX + ttW - ctx.measureText(moreText).width - 10, y + 14);
            y += 20;
        }
        y += 16;
    }

    // --- 푸터 ---
    ctx.fillStyle = '#444';
    ctx.font = '10px Pretendard, sans-serif';
    const footerText = 'LEVEL UP: REBOOT | ' + dateStr;
    ctx.fillText(footerText, pad + 6, totalH - pad + 4);

    // 다운로드 (네이티브 앱 + 웹 모두 지원)
    const userName = (AppState.user && AppState.user.name) ? AppState.user.name.replace(/[^a-zA-Z0-9가-힣]/g, '') : '';
    const saveCountKey = `planner_save_count_${dateStr}_${userName}`;
    let saveCount = parseInt(localStorage.getItem(saveCountKey) || '0', 10) + 1;
    localStorage.setItem(saveCountKey, String(saveCount));
    const countSuffix = saveCount > 1 ? String(saveCount) : '';
    const fileName = `planner_${dateStr}_${userName}${countSuffix}.png`;
    const msgs = { ko: '이미지가 저장되었습니다.', en: 'Image saved.', ja: '画像を保存しました。' };
    const failMsgs = { ko: '이미지 저장에 실패했습니다.', en: 'Failed to save image.', ja: '画像の保存に失敗しました。' };

    try {
        const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('toBlob failed');

        let saved = false;

        // 네이티브 앱: Capacitor Filesystem API로 직접 로컬 저장
        if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
            const Filesystem = window.Capacitor.Plugins.Filesystem;
            const dataUrl = canvas.toDataURL('image/png');
            const base64Data = dataUrl.split(',')[1];

            try {
                // Documents → External → Cache 순서로 저장 시도
                let savedPath = null;
                const dirs = ['DOCUMENTS', 'EXTERNAL', 'CACHE'];
                for (const dir of dirs) {
                    try {
                        const result = await Filesystem.writeFile({
                            path: fileName,
                            data: base64Data,
                            directory: dir,
                            recursive: true
                        });
                        savedPath = result.uri;
                        break;
                    } catch(dirErr) {
                        AppLogger.warn('[Planner] Filesystem write failed for dir ' + dir + ': ' + dirErr.message);
                    }
                }

                if (savedPath) {
                    AppLogger.info('[Planner] Image saved: ' + savedPath);
                    saved = true;
                }
            } catch(fsErr) {
                AppLogger.warn('[Planner] Filesystem save failed: ' + fsErr.message);
            }
        }

        // Web Share API 시도 (네이티브 Filesystem 실패 시 또는 웹 브라우저)
        if (!saved && navigator.share && navigator.canShare) {
            try {
                const file = new File([blob], fileName, { type: 'image/png' });
                const shareData = { files: [file] };
                if (navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                    saved = true;
                }
            } catch(shareErr) {
                if (shareErr.name === 'AbortError') {
                    saved = true; // 사용자 취소는 정상 동작
                } else {
                    AppLogger.warn('[Planner] Share API failed: ' + shareErr.message);
                }
            }
        }

        // 네이티브 앱에서 모든 방법 실패 시 인앱 오버레이로 표시
        if (!saved && isNative) {
            const overlayDataUrl = canvas.toDataURL('image/png');
            showImageOverlay(overlayDataUrl, lang);
            saved = true;
        }

        // <a> 태그 다운로드 (데스크톱 웹 브라우저 폴백)
        if (!saved && !isNative) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 1000);
            saved = true;
        }

        if (saved) {
            alert(msgs[lang] || msgs.ko);
        } else {
            throw new Error('All save methods failed');
        }
    } catch(e) {
        AppLogger.error('[Planner] Image save error: ' + e.message);
        // 최종 폴백 - 인앱 오버레이로 이미지 표시 (외부 브라우저 열지 않음)
        try {
            const dataUrl = canvas.toDataURL('image/png');
            showImageOverlay(dataUrl, lang);
        } catch(e2) {
            alert(failMsgs[lang] || failMsgs.ko);
        }
    }

    // 모달 닫기
    const m = document.getElementById('shareModal');
    m.classList.add('d-none');
    m.classList.remove('d-flex');
};

// 플래너 요약 텍스트를 클립보드에 복사
window.sharePlannerLink = function() {
    const lang = AppState.currentLang;
    const dateStr = diarySelectedDate;
    const entry = getDiaryEntry(dateStr);

    const tasks = (entry && entry.tasks) ? entry.tasks.filter(t => t.text) : plannerTasks.filter(t => t.text);
    const blocks = (entry && entry.blocks) ? Object.entries(entry.blocks).sort(([a],[b]) => a.localeCompare(b)) : [];
    const caption = (entry && entry.caption) ? entry.caption : (document.getElementById('planner-caption')?.value || '');

    let text = `📋 LEVEL UP: REBOOT - ${dateStr}\n`;
    text += `👤 ${AppState.user.name} | Lv.${AppState.user.level}\n\n`;

    if (tasks.length > 0) {
        const taskLabel = { ko: '⭐ 우선순위 태스크', en: '⭐ Priority Tasks', ja: '⭐ 優先タスク' };
        text += (taskLabel[lang] || taskLabel.ko) + '\n';
        tasks.forEach((t, i) => {
            text += (t.ranked ? `${i + 1}. ` : '· ') + t.text + '\n';
        });
        text += '\n';
    }

    if (blocks.length > 0) {
        const schedLabel = { ko: '🕐 시간표', en: '🕐 Schedule', ja: '🕐 スケジュール' };
        text += (schedLabel[lang] || schedLabel.ko) + '\n';
        blocks.forEach(([time, task]) => {
            text += `${time} ${task}\n`;
        });
        text += '\n';
    }

    if (caption) {
        text += `💬 ${caption}\n`;
    }

    navigator.clipboard.writeText(text).then(() => {
        const msgs = { ko: '클립보드에 복사되었습니다.', en: 'Copied to clipboard.', ja: 'クリップボードにコピーしました。' };
        alert(msgs[lang] || msgs.ko);
    }).catch(() => {
        // 폴백: textarea 이용
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const msgs = { ko: '클립보드에 복사되었습니다.', en: 'Copied to clipboard.', ja: 'クリップボードにコピーしました。' };
        alert(msgs[lang] || msgs.ko);
    });

    // 모달 닫기
    const m = document.getElementById('shareModal');
    m.classList.add('d-none');
    m.classList.remove('d-flex');
};

// --- ★ 약관 모달 (인앱 표시 - 인라인) ★ ---
const legalContents = {
    oss: {
        title: '오픈소스 라이선스',
        html: `<div class="legal-date" style="font-size:0.75rem;color:#888;margin-bottom:20px;">최종 확인: 2026년 3월 26일</div>
<div class="section" style="margin-bottom:16px;"><p>본 앱은 아래의 오픈소스 소프트웨어 및 폰트를 사용합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">폰트</h2>
<h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">Pretendard</h3>
<p>Copyright (c) 2021 Kil Hyung-jin<br>License: SIL Open Font License 1.1<br>https://github.com/orioncactus/pretendard</p>
<h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">Inter</h3>
<p>Copyright (c) 2016 The Inter Project Authors (Rasmus Andersson)<br>License: SIL Open Font License 1.1<br>https://github.com/rsms/inter</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">Capacitor</h2>
<p><b>@capacitor/core, @capacitor/android, @capacitor/app, @capacitor/filesystem, @capacitor/geolocation, @capacitor/local-notifications, @capacitor/push-notifications, @capacitor/cli</b></p>
<p>Copyright (c) 2017-present Drifty Co.<br>License: MIT License<br>https://github.com/ionic-team/capacitor</p>
<h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">@capacitor-community/admob</h3>
<p>Copyright (c) Capacitor Community<br>License: MIT License<br>https://github.com/capacitor-community/admob</p>
<h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">@codetrix-studio/capacitor-google-auth</h3>
<p>Copyright (c) CodetrixStudio<br>License: MIT License<br>https://github.com/CodetrixStudio/CapacitorGoogleAuth</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">Firebase SDK</h2>
<p><b>Firebase JavaScript SDK v10.8.1</b><br>(firebase-app, firebase-auth, firebase-firestore, firebase-storage, firebase-messaging, firebase-analytics, firebase-remote-config, firebase-functions)</p>
<p>Copyright (c) Google LLC<br>License: Apache License 2.0<br>https://github.com/firebase/firebase-js-sdk</p>
<h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">firebase-admin (Node.js)</h3>
<p>Copyright (c) Google LLC<br>License: Apache License 2.0<br>https://github.com/firebase/firebase-admin-node</p>
<h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">firebase-functions (Node.js)</h3>
<p>Copyright (c) Google LLC<br>License: Apache License 2.0<br>https://github.com/firebase/firebase-functions</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">MIT License</h2>
<p style="font-size:0.75rem;color:#aaa;line-height:1.6;">Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:<br><br>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.<br><br>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">Apache License 2.0</h2>
<p style="font-size:0.75rem;color:#aaa;line-height:1.6;">Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0<br><br>Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">SIL Open Font License 1.1</h2>
<p style="font-size:0.75rem;color:#aaa;line-height:1.6;">This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is available with a FAQ at: https://openfontlicense.org</p></div>`
    },
    terms: {
        title: '소비자 약관',
        html: `<div class="legal-date" style="font-size:0.75rem;color:#888;margin-bottom:20px;">시행일: 2025년 3월 1일 | 최종 수정: 2026년 3월 16일</div>
<div class="section" style="margin-bottom:16px;"><p>본 소비자 약관(이하 "약관")은 <b>BRAVECAT</b>(이하 "회사")이 제공하는 <b>LEVEL UP: REBOOT</b> 모바일 애플리케이션(이하 "서비스")의 이용 조건을 규정합니다. 서비스를 이용함으로써 본 약관에 동의하는 것으로 간주됩니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">1. 서비스 개요</h2><p>LEVEL UP: REBOOT는 일상 생활의 자기계발 활동을 게임화(Gamification)하여 사용자의 동기 부여와 습관 형성을 돕는 모바일 애플리케이션입니다.</p><ul style="padding-left:20px;margin-bottom:10px;"><li>일일 퀘스트 시스템을 통한 자기계발 목표 관리</li><li>능력치(스탯) 시스템을 통한 성장 시각화</li><li>소셜 기능을 통한 커뮤니티 참여</li><li>글로벌 던전 레이드 시스템을 통한 협력 콘텐츠</li><li>Day1 피드를 통한 24시간 활동 공유</li><li>플래너 및 무드 트래킹을 통한 일일 관리</li><li>주간 도전과제 및 일일 보너스 룰렛</li><li>푸시 알림을 통한 퀘스트/레이드 알림</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">2. 계정 및 이용 자격</h2><h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">2.1 이용 자격</h3><p>서비스를 이용하려면 만 18세 이상이어야 합니다.</p><h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">2.2 계정 관리</h3><p>사용자는 본인의 계정 정보를 안전하게 관리할 책임이 있으며, 계정을 통해 발생하는 모든 활동에 대한 책임은 사용자 본인에게 있습니다.</p><h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">2.3 계정 생성</h3><p>계정은 이메일/비밀번호 또는 Google OAuth를 통해 생성할 수 있습니다. 하나의 자연인은 하나의 계정만 생성하여야 합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">3. 서비스 이용</h2><p>서비스의 기본 기능은 광고 기반으로 무료 제공됩니다(Google AdMob). Day1 피드 콘텐츠는 게시 후 24시간 경과 시 자동 삭제됩니다. 회사는 운영상 또는 기술상의 필요에 따라 서비스를 변경하거나 중단할 수 있습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">4. 건강 및 면책 사항</h2><p>본 서비스는 건강 보조 및 동기 부여 목적으로만 제공됩니다. 의학적 조언, 진단, 치료를 대체하지 않습니다. Google Fit / Health Connect 연동 데이터의 정확성에 대해 회사는 보증하지 않습니다. 퀘스트 수행 중 발생하는 신체적 부상이나 손해에 대해 회사는 일절 책임지지 않습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">5. 위치 정보</h2><p>던전/레이드 기능을 위해 사용자의 위치 정보를 수집할 수 있습니다. 위치 정보 수집은 사용자의 명시적 동의 하에만 이루어집니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">6. 광고</h2><p>서비스에는 Google AdMob를 통한 광고가 표시됩니다. 광고를 통해 연결되는 제3자 웹사이트나 서비스에 대해 회사는 책임을 지지 않습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">7. 푸시 알림</h2><p>서비스는 FCM을 통해 푸시 알림을 제공합니다. 사용자는 앱 내 설정에서 언제든지 비활성화할 수 있습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">8. 저작권 및 지적재산권</h2><p>서비스 내 모든 콘텐츠(디자인, 텍스트, 이미지, 아이콘, UI/UX, 게임 시스템 등)에 대한 저작권은 <b>BRAVECAT</b>에 귀속됩니다. 사용자가 업로드한 콘텐츠의 저작권은 사용자에게 귀속되나, 서비스 운영에 필요한 범위 내에서 이용을 허락한 것으로 간주됩니다. 제3자의 저작권을 침해하는 콘텐츠 업로드는 금지됩니다. 서비스의 무단 복제, 배포, 변형, 역설계는 엄격히 금지됩니다. 저작권 침해 신고: copyright@bravecat.studio</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">9. 금지 행위</h2><ul style="padding-left:20px;"><li>서비스의 정상적인 운영을 방해하는 행위</li><li>다른 사용자의 개인정보를 무단으로 수집하는 행위</li><li>자동화된 수단을 이용한 부정 이용</li><li>서비스 데이터를 임의로 조작하는 행위</li><li>타인을 사칭하거나 허위 정보를 제공하는 행위</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">10. 계정 정지 및 해지</h2><p>회사는 약관 위반 시 사전 통지 없이 서비스 이용을 제한하거나 계정을 정지 또는 삭제할 수 있습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">11. 책임 제한</h2><p>회사는 서비스를 "있는 그대로(AS IS)" 제공하며, 서비스의 완전성, 정확성, 신뢰성에 대해 보증하지 않습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">12. 약관 변경</h2><p>회사는 필요한 경우 약관을 변경할 수 있으며, 변경된 약관은 서비스 내 공지를 통해 고지합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">13. 준거법 및 분쟁 해결</h2><p>본 약관은 대한민국 법률에 따라 해석되며, 서울중앙지방법원을 제1심 관할 법원으로 합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">14. 문의</h2><p><b>BRAVECAT</b><br>이메일: support@bravecat.studio</p></div>`
    },
    'usage-policy': {
        title: '이용 정책',
        html: `<div class="legal-date" style="font-size:0.75rem;color:#888;margin-bottom:20px;">시행일: 2025년 3월 1일 | 최종 수정: 2026년 3월 16일</div>
<div class="section" style="margin-bottom:16px;"><p>본 이용 정책(이하 "정책")은 <b>BRAVECAT</b>이 운영하는 <b>LEVEL UP: REBOOT</b> 서비스(이하 "서비스")의 올바른 이용 기준을 정합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">1. 기본 이용 원칙</h2><ul style="padding-left:20px;"><li>정직하고 성실하게 서비스를 이용할 것</li><li>다른 사용자의 권리를 존중할 것</li><li>서비스의 공정한 운영에 기여할 것</li><li>관련 법률 및 규정을 준수할 것</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">2. 금지되는 행위</h2><h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">2.1 데이터 조작 및 부정 행위</h3><ul style="padding-left:20px;"><li>퀘스트 완료 데이터를 허위로 기록하는 행위</li><li>자동화 도구를 사용하여 퀘스트를 완료하거나 포인트를 획득하는 행위</li><li>Google Fit 또는 Health Connect 데이터를 조작하는 행위</li><li>GPS 위치 정보를 위조하는 행위</li><li>레이드/던전 참여를 부정하게 조작하는 행위</li></ul><h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">2.2 커뮤니티 행위 기준</h3><ul style="padding-left:20px;"><li>다른 사용자에 대한 괴롭힘, 비방, 차별적 언행</li><li>불쾌하거나 유해한 프로필 이미지 또는 닉네임 사용</li><li>스팸, 광고, 또는 상업적 목적의 메시지 전송</li><li>타인의 개인정보를 무단으로 공개하는 행위</li><li>Day1 피드에 부적절한(폭력적, 성적, 혐오적) 콘텐츠를 게시하는 행위</li><li>댓글을 통한 괴롭힘, 스팸, 광고 행위</li></ul><h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">2.3 기술적 남용</h3><ul style="padding-left:20px;"><li>서비스의 보안 시스템을 우회하는 행위</li><li>서비스 서버에 과도한 부하를 발생시키는 행위</li><li>소스 코드를 무단으로 역설계하는 행위</li><li>다중 계정을 생성하여 서비스를 남용하는 행위</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">3. 소셜 기능 이용 기준</h2><p>랭킹은 공정한 경쟁을 위해 운영됩니다. 친구 기능은 상호 존중을 기반으로 이용되어야 합니다. 인스타그램 연동은 사용자의 선택 사항입니다. Day1 피드는 1일 1회 게시 가능하며, 게시 후 24시간 경과 시 자동 삭제됩니다. 적절한 콘텐츠만 게시해야 합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">4. 던전/레이드 이용 기준</h2><p>글로벌 던전 레이드는 특정 시간대(06:00~08:00, 11:30~13:30, 19:00~21:00 KST)에 운영되는 협동 콘텐츠입니다. 허위 참여 및 데이터 조작은 금지됩니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">5. 저작권 보호</h2><ul style="padding-left:20px;"><li>제3자의 저작권을 침해하는 콘텐츠 게시 금지</li><li>타인의 사진, 이미지 등을 무단으로 사용하는 행위 금지</li><li>서비스의 콘텐츠(UI, 아이콘, 게임 시스템 등)를 무단 복제/배포하는 행위 금지</li><li>저작권 침해 신고: copyright@bravecat.studio</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">6. 위반 시 조치</h2><ol style="padding-left:20px;"><li><b>경고:</b> 경미한 위반 시 사전 경고</li><li><b>기능 제한:</b> 특정 기능 이용 일시 제한</li><li><b>데이터 초기화:</b> 부정 획득 포인트/스탯/랭킹 초기화</li><li><b>계정 정지:</b> 심각한 위반 시 계정 정지</li><li><b>영구 차단:</b> 반복/중대 위반 시 영구 삭제</li></ol></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">7. 신고 및 문의</h2><p><b>BRAVECAT</b><br>이메일: report@bravecat.studio</p></div>`
    },
    privacy: {
        title: '개인정보 처리방침',
        html: `<div class="legal-date" style="font-size:0.75rem;color:#888;margin-bottom:20px;">시행일: 2025년 3월 1일 | 최종 수정: 2026년 3월 16일</div>
<div class="section" style="margin-bottom:16px;"><p><b>BRAVECAT</b>(이하 "회사")은 <b>LEVEL UP: REBOOT</b> 서비스 이용자의 개인정보를 중요시하며, 「개인정보 보호법」 등 관련 법령을 준수합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">1. 수집하는 개인정보 항목</h2><ul style="padding-left:20px;"><li><b>필수 정보:</b> 이메일 주소, 비밀번호(암호화 저장)</li><li><b>Google 로그인:</b> Google 계정 이메일, 프로필 이름, 프로필 사진 URL</li><li><b>프로필 정보:</b> 닉네임, 프로필 사진, 인스타그램 ID</li><li><b>서비스 이용 정보:</b> 퀘스트 완료 기록, 포인트, 스탯, 레벨, 칭호 이력</li><li><b>위치 정보:</b> GPS 좌표(사용자 동의 후)</li><li><b>건강 정보:</b> 일일 걸음 수(Google Fit / Health Connect 연동 시)</li><li><b>Day1 피드:</b> 사진, 캡션, 좋아요/댓글 내용</li><li><b>플래너/무드:</b> 일일 계획, 시간표, 캡션, 사진, 기분 상태</li><li><b>푸시 알림:</b> FCM 토큰, 알림 구독 설정</li><li><b>광고 관련:</b> 광고 식별자, 광고 상호작용 데이터(Google AdMob)</li><li><b>기기 정보:</b> 기기 유형, OS 버전, 앱 버전</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">2. 수집 및 이용 목적</h2><ul style="padding-left:20px;"><li><b>서비스 제공:</b> 계정 생성 및 관리, 퀘스트 시스템 운영</li><li><b>소셜 기능:</b> 글로벌 랭킹, 친구 시스템</li><li><b>던전/레이드:</b> 위치 기반 레이드 매칭</li><li><b>건강 연동:</b> Google Fit / Health Connect 데이터를 포인트로 환산</li><li><b>Day1 피드:</b> 24시간 활동 피드 운영, 커뮤니티 소통</li><li><b>플래너:</b> 일일 계획 관리, 기분 추적, 성장 기록</li><li><b>푸시 알림:</b> 퀘스트 알림, 레이드 알림, 서비스 공지</li><li><b>광고:</b> 서비스 운영 비용 충당을 위한 광고 표시</li><li><b>서비스 개선:</b> 이용 통계 분석, 오류 진단</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">3. 보유 및 이용 기간</h2><ul style="padding-left:20px;"><li>계정 정보: 회원 탈퇴 시까지 (탈퇴 후 30일 이내 파기)</li><li>서비스 이용 기록: 최종 접속일로부터 1년</li><li>위치 정보: 수집 후 즉시 처리, 미보관</li><li>건강 데이터: 포인트 환산 완료 시 삭제</li><li>Day1 피드 콘텐츠: 게시 후 24시간 자동 삭제</li><li>플래너 데이터: 기기 로컬 저장 (로그아웃 시 삭제)</li><li>푸시 알림 토큰: 서비스 이용 기간 (로그아웃 시 삭제)</li><li>오류 로그: 수집일로부터 90일</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">4. 제3자 제공</h2><p>원칙적으로 제3자에게 제공하지 않습니다. 사용자 동의가 있거나 법적 의무가 있는 경우에만 예외로 합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">5. 처리 위탁</h2><ul style="padding-left:20px;"><li>Google Firebase: 사용자 인증, 데이터베이스 호스팅</li><li>Google Cloud Platform: 클라우드 인프라, 데이터 저장</li><li>Google AdMob: 광고 서비스 제공</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">6. 사용자의 권리</h2><ul style="padding-left:20px;"><li>열람 요구: 본인의 개인정보 처리 현황 열람</li><li>정정 요구: 부정확한 개인정보의 정정</li><li>삭제 요구: 불필요한 개인정보의 삭제</li><li>동의 철회: 위치/건강 정보 수집 동의 철회 (앱 설정에서 가능)</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">7. 안전성 확보 조치</h2><p>비밀번호 암호화 저장, SSL/TLS 암호화 통신, 데이터베이스 접근 권한 관리, Google Cloud 보안 인프라 활용 등의 조치를 취하고 있습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">8. 저작권 보호</h2><p>서비스 내 모든 콘텐츠에 대한 저작권은 <b>BRAVECAT</b>에 귀속됩니다. 사용자 업로드 콘텐츠의 저작권은 사용자에게 귀속되나, 서비스 운영에 필요한 범위 내에서 이용 허락됩니다. 제3자 저작권 침해 콘텐츠 업로드는 금지됩니다. 저작권 침해 신고: copyright@bravecat.studio</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">9. 국외 이전</h2><p>서비스는 Google Firebase(미국 소재)를 통해 데이터를 저장하므로, 미국에 위치한 서버에 이전 및 보관될 수 있습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">10. 개인정보 보호책임자</h2><p><b>BRAVECAT</b><br>이메일: privacy@bravecat.studio</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">11. 권익 침해 구제</h2><ul style="padding-left:20px;"><li>개인정보 침해신고센터 (한국인터넷진흥원): 118</li><li>개인정보 분쟁조정위원회: 1833-6972</li><li>대검찰청 사이버수사과: 1301</li><li>경찰청 사이버안전국: 182</li></ul></div>`
    }
};

window.openLegalModal = function(type) {
    const info = legalContents[type];
    if (!info) return;
    const modal = document.getElementById('legalModal');
    const title = document.getElementById('legal-modal-title');
    const body = document.getElementById('legal-modal-body');
    title.innerText = info.title;
    body.innerHTML = info.html;
    modal.classList.remove('d-none');
    modal.classList.add('d-flex');
};

// --- ★ P3: 주간 도전과제 시스템 ★ ---
const weeklyChallengeTemplates = [
    { id: 'quest_count', target: 30, reward: { points: 300, stat: 'random', statVal: 2.0 },
      name: { ko: '퀘스트 마스터', en: 'Quest Master', ja: 'クエストマスター' },
      desc: { ko: '이번 주 퀘스트 30개 완료', en: 'Complete 30 quests this week', ja: '今週クエスト30個完了' } },
    { id: 'streak_days', target: 5, reward: { points: 200, stat: 'random', statVal: 1.5 },
      name: { ko: '연속 접속 달인', en: 'Streak Champion', ja: 'ストリーク達人' },
      desc: { ko: '이번 주 5일 연속 접속', en: 'Login 5 days in a row this week', ja: '今週5日連続ログイン' } },
    { id: 'dungeon_clear', target: 3, reward: { points: 250, stat: 'random', statVal: 1.5 },
      name: { ko: '던전 헌터', en: 'Dungeon Hunter', ja: 'ダンジョンハンター' },
      desc: { ko: '이번 주 던전 3회 클리어', en: 'Clear dungeons 3 times this week', ja: '今週ダンジョン3回クリア' } },
    { id: 'planner_use', target: 4, reward: { points: 150, stat: 'agi', statVal: 1.0 },
      name: { ko: '계획의 달인', en: 'Planner Pro', ja: '計画の達人' },
      desc: { ko: '이번 주 플래너 4회 저장', en: 'Save planner 4 times this week', ja: '今週プランナー4回保存' } },
    { id: 'all_clear_days', target: 2, reward: { points: 400, stat: 'random', statVal: 3.0 },
      name: { ko: '올클리어 챔피언', en: 'All-Clear Champion', ja: 'オールクリアチャンピオン' },
      desc: { ko: '이번 주 일일 올클리어 2회', en: '2 daily all-clears this week', ja: '今週デイリーオールクリア2回' } },
    { id: 'critical_hits', target: 3, reward: { points: 200, stat: 'random', statVal: 1.0 },
      name: { ko: '행운아', en: 'Lucky Strike', ja: 'ラッキーストライク' },
      desc: { ko: '이번 주 크리티컬 히트 3회', en: '3 critical hits this week', ja: '今週クリティカルヒット3回' } }
];

function getWeeklyChallenges() {
    const weekStart = getWeekStartDate();
    const storageKey = 'weekly_challenges';
    let data;
    try { data = JSON.parse(localStorage.getItem(storageKey)); } catch(e) { data = null; }

    if (!data || data.weekStart !== weekStart) {
        // 새 주: 6개 중 랜덤 3개 선택
        const shuffled = [...weeklyChallengeTemplates].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, 3);
        data = {
            weekStart,
            challenges: selected.map(c => ({ ...c, progress: 0, claimed: false }))
        };
        localStorage.setItem(storageKey, JSON.stringify(data));
    }
    return data;
}

function updateChallengeProgress(challengeId, increment = 1) {
    const data = getWeeklyChallenges();
    const ch = data.challenges.find(c => c.id === challengeId);
    if (ch && !ch.claimed) {
        ch.progress = Math.min(ch.target, ch.progress + increment);
        localStorage.setItem('weekly_challenges', JSON.stringify(data));
    }
}

function renderWeeklyChallenges() {
    const container = document.getElementById('challenge-list');
    if (!container) return;

    const lang = AppState.currentLang;
    const data = getWeeklyChallenges();

    container.innerHTML = data.challenges.map((ch, idx) => {
        const pct = Math.min(100, Math.round((ch.progress / ch.target) * 100));
        const done = ch.progress >= ch.target;
        const name = ch.name[lang] || ch.name.ko;
        const desc = ch.desc[lang] || ch.desc.ko;

        return `<div class="challenge-item ${done ? 'done' : ''}">
            <div class="challenge-info">
                <div class="challenge-name">${name}</div>
                <div class="challenge-desc">${desc}</div>
                <div class="challenge-bar-bg">
                    <div class="challenge-bar-fill" style="width:${pct}%"></div>
                </div>
                <div class="challenge-progress-text">${ch.progress}/${ch.target}</div>
            </div>
            <div class="challenge-action">
                ${done && !ch.claimed ? `<button class="challenge-claim-btn" onclick="window.claimChallenge(${idx})">${i18n[lang].challenge_reward}</button>` : ''}
                ${ch.claimed ? `<span class="challenge-claimed">${i18n[lang].challenge_claimed}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

window.claimChallenge = function(idx) {
    const data = getWeeklyChallenges();
    const ch = data.challenges[idx];
    if (!ch || ch.claimed || ch.progress < ch.target) return;

    ch.claimed = true;
    localStorage.setItem('weekly_challenges', JSON.stringify(data));

    AppState.user.points += ch.reward.points;
    const stat = ch.reward.stat === 'random' ? statKeys[Math.floor(Math.random() * statKeys.length)] : ch.reward.stat;
    AppState.user.pendingStats[stat] += ch.reward.statVal;

    saveUserData();
    updatePointUI();
    renderWeeklyChallenges();

    const lang = AppState.currentLang;
    alert(`${ch.name[lang] || ch.name.ko} ${i18n[lang].challenge_complete}\n+${ch.reward.points}P, ${stat.toUpperCase()} +${ch.reward.statVal}`);
};

// --- ★ P4: 일일 보너스 룰렛 ★ ---
const rouletteSlots = [
    { label: { ko: '+30P', en: '+30P', ja: '+30P' }, reward: { type: 'points', value: 30 }, color: '#444' },
    { label: { ko: '+80P', en: '+80P', ja: '+80P' }, reward: { type: 'points', value: 80 }, color: '#0088ff' },
    { label: { ko: '+150P', en: '+150P', ja: '+150P' }, reward: { type: 'points', value: 150 }, color: '#ff6a00' },
    { label: { ko: 'STR+1', en: 'STR+1', ja: 'STR+1' }, reward: { type: 'stat', stat: 'str', value: 1.0 }, color: '#ff3c3c' },
    { label: { ko: 'INT+1', en: 'INT+1', ja: 'INT+1' }, reward: { type: 'stat', stat: 'int', value: 1.0 }, color: '#00d9ff' },
    { label: { ko: '+50P', en: '+50P', ja: '+50P' }, reward: { type: 'points', value: 50 }, color: '#555' },
    { label: { ko: 'ALL+0.5', en: 'ALL+0.5', ja: 'ALL+0.5' }, reward: { type: 'stat', stat: 'all', value: 0.5 }, color: '#ffcc00' },
    { label: { ko: '+200P', en: '+200P', ja: '+200P' }, reward: { type: 'points', value: 200 }, color: '#ff00ff' },
];

function canSpinRoulette() {
    const today = getTodayKST();
    if (localStorage.getItem('roulette_date') === today) return 'used';
    // 오늘 퀘스트 1개 이상 완료했는지 확인
    const day = AppState.quest.currentDayOfWeek;
    const anyDone = AppState.quest.completedState[day].some(v => v);
    return anyDone ? 'ready' : 'locked';
}

// KST 자정까지 남은 시간(ms) 계산
function getMsUntilNextKSTMidnight() {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset + now.getTimezoneOffset() * 60 * 1000);
    const kstTomorrow = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate() + 1, 0, 0, 0, 0);
    return kstTomorrow.getTime() - kstNow.getTime();
}

// 남은 시간을 HH:MM:SS 포맷으로 변환
function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

let _rouletteTimerInterval = null;

function startRouletteTimer() {
    stopRouletteTimer();
    const timerEl = document.getElementById('roulette-timer');
    if (!timerEl) return;

    function tick() {
        const ms = getMsUntilNextKSTMidnight();
        const lang = AppState.currentLang;
        timerEl.textContent = `${i18n[lang].roulette_next_spin} ${formatCountdown(ms)}`;
        timerEl.style.display = '';
        // 자정이 되면 룰렛 상태 갱신
        if (ms <= 1000) {
            stopRouletteTimer();
            setTimeout(() => renderRoulette(), 1100);
        }
    }
    tick();
    _rouletteTimerInterval = setInterval(tick, 1000);
}

function stopRouletteTimer() {
    if (_rouletteTimerInterval) {
        clearInterval(_rouletteTimerInterval);
        _rouletteTimerInterval = null;
    }
}

function renderRoulette() {
    const container = document.getElementById('roulette-container');
    if (!container) return;

    const lang = AppState.currentLang;
    const status = canSpinRoulette();
    const canvas = document.getElementById('roulette-canvas');

    // 캔버스에 룰렛 그리기
    if (canvas) drawRouletteWheel(canvas);

    const btn = document.getElementById('btn-roulette-spin');
    const statusText = document.getElementById('roulette-status');
    const timerEl = document.getElementById('roulette-timer');
    if (btn && statusText) {
        if (status === 'ready') {
            btn.disabled = false;
            btn.textContent = i18n[lang].roulette_spin;
            btn.style.opacity = '1';
            statusText.textContent = i18n[lang].roulette_desc;
            statusText.style.color = 'var(--neon-gold)';
            stopRouletteTimer();
            if (timerEl) timerEl.style.display = 'none';
        } else if (status === 'used') {
            btn.disabled = true;
            btn.textContent = i18n[lang].roulette_used;
            btn.style.opacity = '0.4';
            statusText.textContent = i18n[lang].roulette_used;
            statusText.style.color = 'var(--text-sub)';
            startRouletteTimer();
        } else {
            btn.disabled = true;
            btn.textContent = i18n[lang].roulette_spin;
            btn.style.opacity = '0.4';
            statusText.textContent = i18n[lang].roulette_locked;
            statusText.style.color = 'var(--text-sub)';
            stopRouletteTimer();
            if (timerEl) timerEl.style.display = 'none';
        }
    }
}

function drawRouletteWheel(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 4;
    const slotCount = rouletteSlots.length;
    const arc = (2 * Math.PI) / slotCount;
    const lang = AppState.currentLang;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < slotCount; i++) {
        const angle = i * arc - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, angle, angle + arc);
        ctx.closePath();
        ctx.fillStyle = rouletteSlots[i].color;
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 텍스트
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle + arc / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(rouletteSlots[i].label[lang] || rouletteSlots[i].label.ko, r * 0.6, 4);
        ctx.restore();
    }

    // 중심 원
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, 2 * Math.PI);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.strokeStyle = 'var(--neon-gold)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

window.spinRoulette = function() {
    if (canSpinRoulette() !== 'ready') return;

    const today = getTodayKST();
    localStorage.setItem('roulette_date', today);

    const canvas = document.getElementById('roulette-canvas');
    if (!canvas) return;

    // 결과 결정 (가중치 기반)
    const weights = [20, 15, 5, 12, 12, 18, 3, 5]; // 각 슬롯 확률
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalWeight;
    let resultIdx = 0;
    for (let i = 0; i < weights.length; i++) {
        roll -= weights[i];
        if (roll <= 0) { resultIdx = i; break; }
    }

    // 스핀 애니메이션
    const slotCount = rouletteSlots.length;
    const arc = 360 / slotCount;
    // 결과 슬롯 중앙을 가리키도록 회전 (상단 화살표 기준)
    const targetAngle = 360 - (resultIdx * arc + arc / 2);
    const totalRotation = 360 * 5 + targetAngle; // 5바퀴 + 결과 위치

    const btn = document.getElementById('btn-roulette-spin');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    canvas.style.transition = 'transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
    canvas.style.transform = `rotate(${totalRotation}deg)`;

    setTimeout(() => {
        // 보상 적용
        const slot = rouletteSlots[resultIdx];
        if (slot.reward.type === 'points') {
            AppState.user.points += slot.reward.value;
        } else if (slot.reward.type === 'stat') {
            if (slot.reward.stat === 'all') {
                statKeys.forEach(k => { AppState.user.pendingStats[k] += slot.reward.value; });
            } else {
                AppState.user.pendingStats[slot.reward.stat] += slot.reward.value;
            }
        }

        saveUserData();
        updatePointUI();
        renderRoulette();

        const lang = AppState.currentLang;
        const rewardText = slot.label[lang] || slot.label.ko;
        alert(`${i18n[lang].roulette_result} ${rewardText}`);

        // ★ 보상형 전면 광고 — 스핀 보상 2배 기회
        localStorage.setItem('_ri_last_spin_idx', String(resultIdx));
        if (_rewardedInterstitialReady && isNativePlatform) {
            const watchAd = confirm(i18n[lang].ri_spin_prompt || '광고를 시청하면 보상을 한 번 더 받을 수 있습니다. 시청하시겠습니까?');
            if (watchAd) {
                showRewardedInterstitial('spin');
            }
        }

        // 캔버스 리셋 (애니메이션 후 각도 유지)
        canvas.style.transition = 'none';
        canvas.style.transform = `rotate(${targetAngle}deg)`;
    }, 3200);
};

// --- ★ P5: 보상형 광고 일일 보너스 EXP (AdMob Rewarded Ad) ★ ---
const REWARDED_AD_UNIT_ID = 'ca-app-pub-6654057059754695/8552907541';
const REWARDED_AD_TEST_ID = 'ca-app-pub-3940256099942544/5224354917';
const BONUS_EXP_AMOUNT = 50;

// --- ★ P6: 배너 광고 (AdMob Banner Ad) — 던전 탭 ★ ---
const BANNER_AD_UNIT_ID = 'ca-app-pub-6654057059754695/2995161826';
const BANNER_AD_TEST_ID = 'ca-app-pub-3940256099942544/6300978111';
let _bannerAdLoaded = false;
let _bannerAdVisible = false;

// --- ★ P5-B: 보상형 전면 광고 (AdMob Rewarded Interstitial) ★ ---
const REWARDED_INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-6654057059754695/6916027284';
let _rewardedInterstitialReady = false;
let _rewardedInterstitialListenersRegistered = false;
let _riRewardEarned = false;
let _riContext = null; // 'spin' | 'dungeon'
const RI_DUNGEON_DAILY_MAX = 2;

// AdMob 초기화 상태
let _admobInitialized = false;
let _rewardedAdReady = false;
let _rewardedAdListenersRegistered = false;
let _rewardEarned = false; // 광고 시청 완료 시 true
let _rewardedAdContext = 'bonusExp'; // 'bonusExp' | 'libraryImage'
let _rewardedAdOnSuccess = null; // 광고 시청 완료 후 콜백
let _rewardedAdOnFail = null; // 광고 중도 이탈/실패 시 콜백

async function initAdMob() {
    if (_admobInitialized) return;
    if (!isNativePlatform) return;
    try {
        const { AdMob } = window.Capacitor.Plugins;
        if (!AdMob) return;

        // ★ GDPR/UMP 동의 상태 확인 및 동의 양식 표시
        try {
            const consentInfo = await AdMob.requestConsentInfo();
            if (consentInfo.status === 'REQUIRED') {
                await AdMob.showConsentForm();
                if (window.AppLogger) AppLogger.info('[AdMob] GDPR 동의 양식 표시 완료');
            }
            if (window.AppLogger) AppLogger.info('[AdMob] 동의 상태: ' + consentInfo.status);
        } catch (consentErr) {
            // 동의 확인 실패 시에도 광고 초기화는 계속 진행
            if (window.AppLogger) AppLogger.warn('[AdMob] 동의 확인 실패: ' + (consentErr.message || ''));
        }

        await AdMob.initialize({
            initializeForTesting: false,
            // ★ COPPA: 13세 미만 대상 아님 (만 18세 이상 서비스)
            tagForChildDirectedTreatment: false,
            // ★ 만 18세 미만 사용자 대상 아님
            tagForUnderAgeOfConsent: false,
            maxAdContentRating: 'G',
        });
        _admobInitialized = true;
        if (window.AppLogger) AppLogger.info('[AdMob] 초기화 완료');

        // 보상형 광고 이벤트 리스너 등록 (1회만)
        if (!_rewardedAdListenersRegistered) {
            _rewardedAdListenersRegistered = true;

            // 광고 시청 완료 → 보상 획득
            AdMob.addListener('onRewardedVideoAdReward', (reward) => {
                console.log('[AdMob] 보상 획득:', reward);
                if (window.AppLogger) AppLogger.info('[AdMob] 보상 획득: ' + JSON.stringify(reward));
                _rewardEarned = true;
            });

            // 광고 닫힘 (시청 완료 또는 중도 이탈 모두)
            AdMob.addListener('onRewardedVideoAdDismissed', () => {
                console.log('[AdMob] 광고 닫힘, 보상 획득 여부:', _rewardEarned, '컨텍스트:', _rewardedAdContext);
                if (window.AppLogger) AppLogger.info('[AdMob] 광고 닫힘, rewarded=' + _rewardEarned + ', ctx=' + _rewardedAdContext);

                _rewardedAdReady = false;
                preloadRewardedAd._retryCount = 0;
                preloadRewardedAd(); // 다음 광고 프리로드

                if (_rewardEarned) {
                    _rewardEarned = false;
                    if (_rewardedAdOnSuccess) {
                        _rewardedAdOnSuccess();
                    } else {
                        applyBonusExpReward();
                    }
                } else {
                    if (_rewardedAdOnFail) {
                        _rewardedAdOnFail();
                    } else {
                        // 기본: 보너스 EXP 중도 이탈 처리
                        localStorage.removeItem(_bonusExpKey());
                        _bonusExpInProgress = false;
                        const lang = AppState.currentLang;
                        alert(i18n[lang].bonus_exp_fail);
                        renderBonusExp();
                    }
                }
                _rewardedAdContext = 'bonusExp';
                _rewardedAdOnSuccess = null;
                _rewardedAdOnFail = null;
            });

            // 광고 표시 실패
            AdMob.addListener('onRewardedVideoAdFailedToShow', (error) => {
                console.warn('[AdMob] 광고 표시 실패:', error);
                if (window.AppLogger) AppLogger.warn('[AdMob] 표시 실패: ' + JSON.stringify(error));
                _rewardedAdReady = false;
                _rewardEarned = false;
                preloadRewardedAd._retryCount = 0;
                preloadRewardedAd();
                if (_rewardedAdOnFail) {
                    _rewardedAdOnFail();
                } else {
                    // 기본: 보너스 EXP 실패 처리
                    localStorage.removeItem(_bonusExpKey());
                    _bonusExpInProgress = false;
                    const lang = AppState.currentLang;
                    alert(i18n[lang].bonus_exp_not_ready);
                    renderBonusExp();
                }
                _rewardedAdContext = 'bonusExp';
                _rewardedAdOnSuccess = null;
                _rewardedAdOnFail = null;
            });

            // 광고 로드 완료
            AdMob.addListener('onRewardedVideoAdLoaded', () => {
                _rewardedAdReady = true;
                if (window.AppLogger) AppLogger.info('[AdMob] 보상형 광고 로드 완료');
            });

            // 광고 로드 실패
            AdMob.addListener('onRewardedVideoAdFailedToLoad', (error) => {
                _rewardedAdReady = false;
                console.warn('[AdMob] 보상형 광고 로드 실패:', error);
                if (window.AppLogger) AppLogger.warn('[AdMob] 로드 실패: ' + JSON.stringify(error));
            });
        }

        preloadRewardedAd();

        // ★ 보상형 전면 광고 리스너 등록
        if (!_rewardedInterstitialListenersRegistered) {
            _rewardedInterstitialListenersRegistered = true;

            AdMob.addListener('onRewardedInterstitialAdLoaded', () => {
                _rewardedInterstitialReady = true;
                if (window.AppLogger) AppLogger.info('[AdMob] 보상형 전면 광고 로드 완료');
            });

            AdMob.addListener('onRewardedInterstitialAdFailedToLoad', (error) => {
                _rewardedInterstitialReady = false;
                if (window.AppLogger) AppLogger.warn('[AdMob] 보상형 전면 광고 로드 실패: ' + JSON.stringify(error));
            });

            AdMob.addListener('onRewardedInterstitialAdReward', (reward) => {
                _riRewardEarned = true;
                if (window.AppLogger) AppLogger.info('[AdMob] 보상형 전면 보상 획득: ' + JSON.stringify(reward));
            });

            AdMob.addListener('onRewardedInterstitialAdDismissed', () => {
                _rewardedInterstitialReady = false;
                preloadRewardedInterstitial._retryCount = 0;
                preloadRewardedInterstitial();
                if (_riRewardEarned) {
                    _riRewardEarned = false;
                    applyRewardedInterstitialBonus(_riContext);
                }
                _riContext = null;
            });

            AdMob.addListener('onRewardedInterstitialAdFailedToShow', (error) => {
                if (window.AppLogger) AppLogger.warn('[AdMob] 보상형 전면 표시 실패: ' + JSON.stringify(error));
                _rewardedInterstitialReady = false;
                _riRewardEarned = false;
                _riContext = null;
                preloadRewardedInterstitial._retryCount = 0;
                preloadRewardedInterstitial();
            });
        }

        // ★ 배너 광고 이벤트 리스너
        AdMob.addListener('onBannerAdLoaded', () => {
            if (window.AppLogger) AppLogger.info('[AdMob] 배너 광고 로드 완료');
        });
        AdMob.addListener('onBannerAdFailedToLoad', (error) => {
            _bannerAdLoaded = false;
            _bannerAdVisible = false;
            if (window.AppLogger) AppLogger.warn('[AdMob] 배너 광고 로드 실패: ' + JSON.stringify(error));
        });

        preloadRewardedInterstitial();
    } catch (e) {
        console.warn('[AdMob] 초기화 실패:', e);
        if (window.AppLogger) AppLogger.warn('[AdMob] 초기화 실패: ' + (e.message || ''));
    }
}

async function preloadRewardedAd() {
    if (!_admobInitialized) return;
    try {
        const { AdMob } = window.Capacitor.Plugins;
        if (!AdMob) return;
        await AdMob.prepareRewardVideoAd({
            adId: REWARDED_AD_UNIT_ID,
            isTesting: false,
        });
        // _rewardedAdReady는 onRewardedVideoAdLoaded 리스너에서 설정
    } catch (e) {
        _rewardedAdReady = false;
        console.warn('[AdMob] 보상형 광고 프리로드 실패:', e);
        if (window.AppLogger) AppLogger.warn('[AdMob] 프리로드 실패: ' + (e.message || ''));
        if (!preloadRewardedAd._retryCount) preloadRewardedAd._retryCount = 0;
        if (preloadRewardedAd._retryCount < 3) {
            preloadRewardedAd._retryCount++;
            setTimeout(() => preloadRewardedAd(), 30000);
        }
    }
}

// --- 보상형 전면 광고 (Rewarded Interstitial) 함수 ---
async function preloadRewardedInterstitial() {
    if (!_admobInitialized) return;
    try {
        const { AdMob } = window.Capacitor.Plugins;
        if (!AdMob) return;
        await AdMob.prepareRewardInterstitialAd({
            adId: REWARDED_INTERSTITIAL_AD_UNIT_ID,
            isTesting: false,
        });
    } catch (e) {
        _rewardedInterstitialReady = false;
        console.warn('[AdMob] 보상형 전면 프리로드 실패:', e);
        if (window.AppLogger) AppLogger.warn('[AdMob] 보상형 전면 프리로드 실패: ' + (e.message || ''));
        if (!preloadRewardedInterstitial._retryCount) preloadRewardedInterstitial._retryCount = 0;
        if (preloadRewardedInterstitial._retryCount < 3) {
            preloadRewardedInterstitial._retryCount++;
            setTimeout(() => preloadRewardedInterstitial(), 30000);
        }
    }
}

async function showRewardedInterstitial(context) {
    if (!_rewardedInterstitialReady || !_admobInitialized) return false;
    try {
        const { AdMob } = window.Capacitor.Plugins;
        if (!AdMob) return false;
        _riContext = context;
        _riRewardEarned = false;
        await AdMob.showRewardInterstitialAd();
        return true;
    } catch (e) {
        console.warn('[AdMob] 보상형 전면 표시 실패:', e);
        _riContext = null;
        _rewardedInterstitialReady = false;
        preloadRewardedInterstitial._retryCount = 0;
        preloadRewardedInterstitial();
        return false;
    }
}

// --- 배너 광고 함수 (던전 탭 전용) ---
function _getBannerMargin() {
    // 내 서재: 헤더 높이(약 53px) + safe-area-inset-top 을 합산하여 배너가 헤더 아래(검색바 위)에 위치하도록
    const safeTop = parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)')) || 0;
    return 53 + safeTop;
}

async function showBannerAd() {
    if (!_admobInitialized || !isNativePlatform) return;
    try {
        const { AdMob } = window.Capacitor.Plugins;
        if (!AdMob) return;

        const bannerMargin = _getBannerMargin();
        if (_bannerAdLoaded) {
            await AdMob.resumeBanner();
        } else {
            await AdMob.showBanner({
                adId: BANNER_AD_UNIT_ID,
                adSize: 'ADAPTIVE_BANNER',
                position: 'TOP_CENTER',
                margin: bannerMargin,
                isTesting: false,
            });
            _bannerAdLoaded = true;
        }
        _bannerAdVisible = true;
        // 배너 스페이서 표시 (검색바 위에 공간 확보)
        var spacer = document.getElementById('library-banner-spacer');
        if (spacer) { spacer.classList.remove('d-none'); spacer.style.height = '60px'; }
        // 던전 콘텐츠가 배너에 가리지 않도록 상단 여백 추가
        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.style.paddingTop = `calc(${bannerMargin + 70}px + env(safe-area-inset-top))`;
        if (window.AppLogger) AppLogger.info('[AdMob] 배너 광고 표시');
    } catch (e) {
        console.warn('[AdMob] 배너 광고 표시 실패:', e);
        if (window.AppLogger) AppLogger.warn('[AdMob] 배너 표시 실패: ' + (e.message || ''));
    }
}

async function hideBannerAd() {
    if (!_bannerAdVisible || !_admobInitialized) return;
    try {
        const { AdMob } = window.Capacitor.Plugins;
        if (!AdMob) return;
        await AdMob.hideBanner();
        _bannerAdVisible = false;
        // 배너 스페이서 숨김
        var spacer = document.getElementById('library-banner-spacer');
        if (spacer) { spacer.classList.add('d-none'); spacer.style.height = ''; }
        // 배너 숨김 시 상단 여백 원래대로 복원
        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.style.paddingTop = '';
        if (window.AppLogger) AppLogger.info('[AdMob] 배너 광고 숨김');
    } catch (e) {
        console.warn('[AdMob] 배너 광고 숨김 실패:', e);
        if (window.AppLogger) AppLogger.warn('[AdMob] 배너 숨김 실패: ' + (e.message || ''));
    }
}

function getRiDungeonCountToday() {
    const today = getTodayKST();
    return parseInt(localStorage.getItem('_ri_dungeon_' + today) || '0');
}

function incrementRiDungeonCount() {
    const today = getTodayKST();
    const key = '_ri_dungeon_' + today;
    localStorage.setItem(key, String(getRiDungeonCountToday() + 1));
}

function applyRewardedInterstitialBonus(context) {
    const lang = AppState.currentLang;
    if (context === 'spin') {
        const lastSlotIdx = parseInt(localStorage.getItem('_ri_last_spin_idx') || '0');
        const slot = rouletteSlots[lastSlotIdx];
        if (slot) {
            if (slot.reward.type === 'points') {
                AppState.user.points += slot.reward.value;
            } else if (slot.reward.type === 'stat') {
                if (slot.reward.stat === 'all') {
                    statKeys.forEach(k => { AppState.user.pendingStats[k] += slot.reward.value; });
                } else {
                    AppState.user.pendingStats[slot.reward.stat] += slot.reward.value;
                }
            }
            saveUserData();
            updatePointUI();
            const rewardText = slot.label[lang] || slot.label.ko;
            alert(`${i18n[lang].ri_spin_bonus || '추가 보상 획득!'} ${rewardText}`);
        }
        try { fbLogEvent(analytics, 'ri_ad_spin_bonus', { slot: lastSlotIdx }); } catch {}
    } else if (context === 'dungeon') {
        const target = AppState.dungeon.targetStat;
        const rewardMult = getBossRewardMultiplier();
        const bonusPts = Math.floor(100 * rewardMult);
        const bonusStat = 1.0 * rewardMult;
        AppState.user.points += bonusPts;
        AppState.user.pendingStats[target] += bonusStat;
        saveUserData();
        updatePointUI();
        alert(`${i18n[lang].ri_dungeon_bonus || '추가 보상!'}\n+${bonusPts} P\n${target.toUpperCase()} +${bonusStat}`);
        try { fbLogEvent(analytics, 'ri_ad_dungeon_bonus', { pts: bonusPts, stat: target }); } catch {}
    }
}

function _bonusExpKey() {
    const uid = auth.currentUser ? auth.currentUser.uid : '_anon';
    return `bonus_exp_date_${uid}`;
}

function canClaimBonusExp() {
    const today = getTodayKST();
    // 인메모리 잠금 (광고 진행 중)
    if (_bonusExpInProgress) return 'used';
    // localStorage 체크 (유저별 키)
    if (localStorage.getItem(_bonusExpKey()) === today) return 'used';
    return 'ready';
}

let _bonusExpTimerInterval = null;
let _bonusExpInProgress = false; // 광고 진행 중 잠금

function startBonusExpTimer() {
    stopBonusExpTimer();
    const timerEl = document.getElementById('bonus-exp-timer');
    if (!timerEl) return;

    function tick() {
        const ms = getMsUntilNextKSTMidnight();
        const lang = AppState.currentLang;
        timerEl.textContent = `${i18n[lang].bonus_exp_next} ${formatCountdown(ms)}`;
        timerEl.style.display = '';
        if (ms <= 1000) {
            stopBonusExpTimer();
            setTimeout(() => renderBonusExp(), 1100);
        }
    }
    tick();
    _bonusExpTimerInterval = setInterval(tick, 1000);
}

function stopBonusExpTimer() {
    if (_bonusExpTimerInterval) {
        clearInterval(_bonusExpTimerInterval);
        _bonusExpTimerInterval = null;
    }
}

function renderBonusExp() {
    const btn = document.getElementById('btn-bonus-exp');
    const statusText = document.getElementById('bonus-exp-status');
    const timerEl = document.getElementById('bonus-exp-timer');
    if (!btn || !statusText) return;

    const lang = AppState.currentLang;
    const status = canClaimBonusExp();

    if (status === 'used') {
        btn.disabled = true;
        btn.textContent = i18n[lang].bonus_exp_used;
        btn.style.opacity = '0.4';
        statusText.textContent = i18n[lang].bonus_exp_used;
        statusText.style.color = 'var(--text-sub)';
        startBonusExpTimer();
    } else {
        btn.disabled = false;
        btn.textContent = i18n[lang].bonus_exp_btn;
        btn.style.opacity = '1';
        statusText.textContent = i18n[lang].bonus_exp_desc;
        statusText.style.color = 'var(--neon-gold)';
        stopBonusExpTimer();
        if (timerEl) timerEl.style.display = 'none';
    }
}

window.claimBonusExp = async function() {
    if (canClaimBonusExp() !== 'ready') return;

    const lang = AppState.currentLang;
    const btn = document.getElementById('btn-bonus-exp');

    // ★ 즉시 잠금 — 중복 클릭/이벤트 방지
    _bonusExpInProgress = true;
    if (btn) { btn.disabled = true; btn.textContent = i18n[lang].bonus_exp_loading; }

    // 네이티브가 아닌 경우 (웹 테스트) — 광고 없이 바로 보상 지급
    if (!isNativePlatform) {
        applyBonusExpReward();
        _bonusExpInProgress = false;
        return;
    }

    if (!_admobInitialized) {
        await initAdMob();
    }

    const { AdMob } = window.Capacitor.Plugins;
    if (!AdMob) {
        _bonusExpInProgress = false;
        alert(i18n[lang].bonus_exp_not_ready);
        renderBonusExp();
        return;
    }

    if (!_rewardedAdReady) {
        try {
            await AdMob.prepareRewardVideoAd({
                adId: REWARDED_AD_UNIT_ID,
                isTesting: false,
            });
            _rewardedAdReady = true;
        } catch (e) {
            _bonusExpInProgress = false;
            alert(i18n[lang].bonus_exp_not_ready);
            renderBonusExp();
            return;
        }
    }

    // ★ 광고 표시 전 localStorage에 선점 마킹 (광고 시청 중 앱 강제 종료 대비)
    const today = getTodayKST();
    localStorage.setItem(_bonusExpKey(), today);

    _rewardEarned = false;

    try {
        await AdMob.showRewardVideoAd();
        // 이후 처리는 이벤트 리스너(Rewarded, Dismissed, FailedToShow)에서 수행
    } catch (e) {
        console.warn('[AdMob] 보상형 광고 표시 실패:', e);
        if (window.AppLogger) AppLogger.warn('[AdMob] 광고 표시 실패: ' + (e.message || ''));
        // 광고 표시 실패 시 선점 마킹 롤백
        localStorage.removeItem(_bonusExpKey());
        _rewardedAdReady = false;
        _rewardEarned = false;
        _bonusExpInProgress = false;
        preloadRewardedAd._retryCount = 0;
        preloadRewardedAd();
        alert(i18n[lang].bonus_exp_fail);
        renderBonusExp();
    }
};

async function applyBonusExpReward() {
    const lang = AppState.currentLang;
    const today = getTodayKST();

    // ★ localStorage에 확정 마킹 (claimBonusExp에서 선점 마킹 이미 완료)
    localStorage.setItem(_bonusExpKey(), today);

    // EXP(포인트) +50 지급
    AppState.user.points += BONUS_EXP_AMOUNT;

    // ★ Firestore에 즉시 저장 (await — 로그아웃 전 반드시 완료)
    if (auth.currentUser) {
        try {
            await setDoc(doc(db, "users", auth.currentUser.uid), {
                lastBonusExpDate: today,
                points: AppState.user.points
            }, { merge: true });
            if (window.AppLogger) AppLogger.info('[BonusEXP] Firestore 즉시 저장 완료');
        } catch (e) {
            console.warn('[BonusEXP] Firestore 즉시 저장 실패:', e);
        }
    }

    // ★ 잠금 해제
    _bonusExpInProgress = false;

    saveUserData();
    updatePointUI();
    renderBonusExp();

    // Analytics 이벤트
    if (analytics) {
        try { fbLogEvent(analytics, 'rewarded_ad_bonus_exp', { reward: BONUS_EXP_AMOUNT }); } catch {}
    }

    alert(i18n[lang].bonus_exp_reward);
    if (window.AppLogger) AppLogger.info(`[BonusEXP] EXP +${BONUS_EXP_AMOUNT} 지급 완료`);
}

// --- ★ P6: 네이티브 광고 고급형 - 소셜탭 + Day1탭 (AdMob Native Advanced) ★ ---
const NATIVE_AD_UNIT_ID = 'ca-app-pub-6654057059754695/8612252339';
const NATIVE_AD_TEST_ID = 'ca-app-pub-3940256099942544/2247696110';
const NATIVE_AD_POSITION = 5; // 소셜탭: 5번째 유저 카드 뒤에 삽입
const REELS_NATIVE_AD_POSITION = 3; // Day1탭: 3번째 포스트 뒤에 삽입

let _nativeAdLoaded = false;
let _nativeAdVisible = false;
let _nativeAdScrollRAF = null;
let _nativeAdObserver = null;
let _nativeAdActiveTab = null; // 'social' | 'reels' | null — 현재 네이티브 광고가 활성인 탭

/**
 * 네이티브 광고 로드 및 표시 (탭 공용)
 * @param {string} tabId - 'social' | 'reels'
 */
async function loadAndShowNativeAd(tabId) {
    if (!isNativePlatform) return;

    // ★ 해당 탭이 활성 상태인지 확인 — 다른 탭에서 로드 방지
    const tabSection = document.getElementById(tabId);
    if (!tabSection || !tabSection.classList.contains('active')) {
        return;
    }

    if (!_admobInitialized) {
        await initAdMob();
    }

    const placeholderId = 'native-ad-placeholder-' + tabId;
    const placeholder = document.getElementById(placeholderId);
    if (!placeholder) return;

    // ★ 로드 시작 전 다시 한번 탭 활성 확인 (initAdMob 대기 중 탭 전환 가능)
    if (!document.getElementById(tabId)?.classList.contains('active')) {
        return;
    }

    try {
        const { NativeAd } = window.Capacitor.Plugins;
        if (!NativeAd) {
            if (window.AppLogger) AppLogger.warn('[NativeAd] 플러그인 사용 불가');
            placeholder.style.display = 'none';
            return;
        }

        // 기존 광고 정리
        await NativeAd.destroyAd().catch(() => {});

        // 광고 로드
        const result = await NativeAd.loadAd({
            adId: NATIVE_AD_UNIT_ID,
            isTesting: false,
        });

        if (result && result.loaded) {
            // ★ 로드 완료 후 탭 활성 확인 (로드 중 탭 전환 시 즉시 파괴)
            if (!document.getElementById(tabId)?.classList.contains('active')) {
                NativeAd.destroyAd().catch(() => {});
                _nativeAdLoaded = false;
                _nativeAdActiveTab = null;
                return;
            }

            _nativeAdLoaded = true;
            _nativeAdActiveTab = tabId;
            if (window.AppLogger) AppLogger.info(`[NativeAd] ${tabId}탭 네이티브 광고 로드 완료`);

            // placeholder 좌표로 오버레이 표시
            positionNativeAd(tabId);
            setupNativeAdScrollSync(tabId);
        }
    } catch (e) {
        console.warn('[NativeAd] 로드 실패:', e);
        if (window.AppLogger) AppLogger.warn('[NativeAd] 로드 실패: ' + (e.message || ''));
        _nativeAdLoaded = false;
        _nativeAdActiveTab = null;
        // 로드 실패 시 placeholder 숨김
        placeholder.style.display = 'none';
    }
}

/**
 * placeholder 좌표를 계산하여 네이티브 광고 오버레이 위치 지정 (탭 공용)
 * @param {string} tabId - 'social' | 'reels'
 */
async function positionNativeAd(tabId) {
    const placeholderId = 'native-ad-placeholder-' + tabId;
    const placeholder = document.getElementById(placeholderId);
    if (!placeholder || !_nativeAdLoaded) return;

    // ★ 해당 탭이 아니면 표시하지 않음
    if (!document.getElementById(tabId)?.classList.contains('active')) return;

    try {
        const { NativeAd } = window.Capacitor.Plugins;
        if (!NativeAd) return;

        const rect = placeholder.getBoundingClientRect();
        // 소셜탭: sticky header 기준 클리핑, Day1탭: 앱 header 기준 클리핑
        let clipTop = 0;
        if (tabId === 'social') {
            const sh = document.querySelector('.social-sticky-header');
            if (sh) clipTop = sh.getBoundingClientRect().bottom;
        } else {
            const appHeader = document.querySelector('header');
            if (appHeader) clipTop = appHeader.getBoundingClientRect().bottom;
        }
        await NativeAd.showAd({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            clipTop,
        });
        _nativeAdVisible = true;
    } catch (e) {
        console.warn('[NativeAd] 표시 실패:', e);
    }
}

/**
 * 스크롤 동기화 설정 (탭 공용)
 * main 요소의 스크롤에 맞춰 네이티브 오버레이 Y좌표를 업데이트
 * @param {string} tabId - 'social' | 'reels'
 */
function setupNativeAdScrollSync(tabId) {
    cleanupNativeAdScrollSync();

    const mainEl = document.querySelector('main');
    const placeholderId = 'native-ad-placeholder-' + tabId;
    const placeholder = document.getElementById(placeholderId);
    if (!mainEl || !placeholder) return;

    // IntersectionObserver: placeholder가 화면 밖으로 나가면 hide
    _nativeAdObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!_nativeAdLoaded) return;

        const { NativeAd } = window.Capacitor.Plugins;
        if (!NativeAd) return;

        if (entry.isIntersecting) {
            if (!_nativeAdVisible) {
                NativeAd.resumeAd().catch(() => {});
                _nativeAdVisible = true;
            }
        } else {
            if (_nativeAdVisible) {
                NativeAd.hideAd().catch(() => {});
                _nativeAdVisible = false;
            }
        }
    }, { threshold: 0.1 });
    _nativeAdObserver.observe(placeholder);

    // scroll 이벤트: requestAnimationFrame 스로틀링으로 Y좌표 동기화
    // 소셜탭: sticky header 클리핑, Day1탭: 앱 header 클리핑
    const clipRef = tabId === 'social'
        ? document.querySelector('.social-sticky-header')
        : document.querySelector('header');

    function onScroll() {
        if (_nativeAdScrollRAF) return;
        _nativeAdScrollRAF = requestAnimationFrame(() => {
            _nativeAdScrollRAF = null;
            if (!_nativeAdLoaded || !_nativeAdVisible) return;

            const rect = placeholder.getBoundingClientRect();
            const clipTop = clipRef ? clipRef.getBoundingClientRect().bottom : 0;
            const { NativeAd } = window.Capacitor.Plugins;
            if (NativeAd) {
                NativeAd.updatePosition({ y: rect.top, clipTop }).catch(() => {});
            }
        });
    }

    mainEl.addEventListener('scroll', onScroll, { passive: true });
    // 이벤트 참조 저장 (cleanup용)
    mainEl._nativeAdScrollHandler = onScroll;
}

/**
 * 스크롤 리스너 정리
 */
function cleanupNativeAdScrollSync() {
    if (_nativeAdObserver) {
        _nativeAdObserver.disconnect();
        _nativeAdObserver = null;
    }

    if (_nativeAdScrollRAF) {
        cancelAnimationFrame(_nativeAdScrollRAF);
        _nativeAdScrollRAF = null;
    }

    const mainEl = document.querySelector('main');
    if (mainEl && mainEl._nativeAdScrollHandler) {
        mainEl.removeEventListener('scroll', mainEl._nativeAdScrollHandler);
        delete mainEl._nativeAdScrollHandler;
    }
}

/**
 * 네이티브 광고 완전 정리 (탭 전환 시 호출)
 */
async function cleanupNativeAd() {
    cleanupNativeAdScrollSync();
    _nativeAdLoaded = false;
    _nativeAdVisible = false;
    _nativeAdActiveTab = null;

    if (!isNativePlatform) return;

    try {
        const { NativeAd } = window.Capacitor.Plugins;
        if (NativeAd) {
            await NativeAd.destroyAd();
        }
    } catch (e) {
        // 무시 — 이미 파괴되었을 수 있음
    }
}

// --- ★ 플래너 기능 (일론 머스크 타임박스 스타일) ★ ---
let diarySelectedDate = getTodayStr();
// plannerTasks: [{text, ranked, rankOrder}, ...] (기본 6개 슬롯)
let plannerTasks = Array(6).fill(null).map(() => ({ text: '', ranked: false, rankOrder: 0 }));

function dateToStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getDiaryEntry(dateStr) {
    try {
        const diaries = JSON.parse(localStorage.getItem('diary_entries') || '{}');
        return diaries[dateStr] || null;
    } catch { return null; }
}

function getAllDiaryEntries() {
    try {
        return JSON.parse(localStorage.getItem('diary_entries') || '{}');
    } catch { return {}; }
}

// 주간 플래너 캘린더 렌더링 (퀘스트 탭 주간 진척도 형태)
function renderPlannerCalendar() {
    const container = document.getElementById('planner-calendar-grid');
    if (!container) return;

    const today = new Date();
    const currentDay = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - currentDay);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthEl = document.getElementById('planner-cal-month');
    if (monthEl) monthEl.innerText = `${startOfWeek.getFullYear()} ${monthNames[startOfWeek.getMonth()]}`;

    const dayNames = {
        ko: ["일","월","화","수","목","금","토"],
        en: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],
        ja: ["日","月","火","水","木","金","土"]
    };

    const allEntries = getAllDiaryEntries();

    container.innerHTML = Array.from({length: 7}, (_, i) => {
        const iterDate = new Date(startOfWeek);
        iterDate.setDate(startOfWeek.getDate() + i);
        const dateStr = dateToStr(iterDate);
        const isToday = (i === currentDay);
        const isSelected = dateStr === diarySelectedDate;
        const entry = allEntries[dateStr];
        const hasEntry = entry && (entry.blocks ? Object.keys(entry.blocks).length > 0 : entry.text);

        return `
            <div class="cal-day ${isToday ? 'today' : ''} ${isSelected ? 'planner-selected' : ''}"
                 onclick="window.selectPlannerDate('${dateStr}')" style="cursor:pointer;">
                <div class="cal-name">${dayNames[AppState.currentLang][i]}</div>
                <div class="cal-date">${iterDate.getDate()}</div>
                <div class="cal-score">${hasEntry ? '✓' : '·'}</div>
            </div>
        `;
    }).join('');
}

// 선택 날짜가 미래인지 확인
function isSelectedDateFuture() {
    const today = new Date();
    today.setHours(0,0,0,0);
    const selected = new Date(diarySelectedDate + 'T00:00:00');
    return selected > today;
}

// 현재 plannerTasks에서 드롭다운 옵션 목록 생성
function getTaskOptions() {
    const ranked = plannerTasks
        .map((t, i) => ({ ...t, idx: i }))
        .filter(t => t.ranked && t.text.trim())
        .sort((a, b) => a.rankOrder - b.rankOrder);
    const unranked = plannerTasks.filter(t => !t.ranked && t.text.trim());
    let rankNum = 1;
    return [
        ...ranked.map(t => ({ text: t.text.trim(), label: `${rankNum++}. ${t.text.trim()}` })),
        ...unranked.map(t => ({ text: t.text.trim(), label: `· ${t.text.trim()}` }))
    ];
}

// 이미 렌더링된 타임박스 드롭다운의 옵션 목록만 갱신
function updateTimeboxDropdownOptions() {
    const options = getTaskOptions();
    const emptyLabel = i18n[AppState.currentLang]?.timebox_empty || '-- 없음 --';
    const optHTML = [`<option value="">${emptyLabel}</option>`,
        ...options.map(o => `<option value="${o.text.replace(/"/g,'&quot;')}">${o.label}</option>`)
    ].join('');
    document.querySelectorAll('#planner-timebox-grid .timebox-select').forEach(sel => {
        const cur = sel.value;
        sel.innerHTML = optHTML;
        if (cur) sel.value = cur;
    });
}

// 우선순위 태스크 목록 렌더링
function renderPlannerTasks() {
    const container = document.getElementById('planner-tasks-list');
    if (!container) return;
    const isFuture = isSelectedDateFuture();

    // 순위 번호 계산 (rankOrder 순서대로 1,2,3...)
    const rankedSorted = plannerTasks
        .map((t, i) => ({ ...t, idx: i }))
        .filter(t => t.ranked)
        .sort((a, b) => a.rankOrder - b.rankOrder);
    const rankMap = {};
    rankedSorted.forEach((t, i) => { rankMap[t.idx] = i + 1; });

    container.innerHTML = plannerTasks.map((task, idx) => {
        const rankNum = rankMap[idx];
        const rankLabel = rankNum ? rankNum : '·';
        const isRanked = !!rankNum;
        const canRemove = idx >= 6;
        return `<div class="planner-task-item">
            <button class="task-rank-btn${isRanked ? ' ranked' : ''}"
                    onclick="window.toggleTaskRank(${idx})"
                    ${isFuture ? 'disabled' : ''}>${rankLabel}</button>
            <input class="planner-task-input" type="text"
                   value="${task.text.replace(/"/g,'&quot;').replace(/</g,'&lt;')}"
                   placeholder="${i18n[AppState.currentLang]?.planner_task_placeholder || '할 일 입력...'}"
                   maxlength="50"
                   oninput="window.updateTaskText(${idx}, this.value)"
                   ${isFuture ? 'disabled' : ''}>
            ${canRemove ? `<button class="task-remove-btn" onclick="window.removeTask(${idx})" ${isFuture ? 'disabled' : ''}>×</button>` : ''}
        </div>`;
    }).join('');

    updateTimeboxDropdownOptions();
}

window.toggleTaskRank = function(idx) {
    if (plannerTasks[idx].ranked) {
        plannerTasks[idx].ranked = false;
        plannerTasks[idx].rankOrder = 0;
    } else {
        const maxOrder = plannerTasks.filter(t => t.ranked).reduce((m, t) => Math.max(m, t.rankOrder), 0);
        plannerTasks[idx].ranked = true;
        plannerTasks[idx].rankOrder = maxOrder + 1;
    }
    renderPlannerTasks();
};

window.updateTaskText = function(idx, val) {
    plannerTasks[idx].text = val;
    updateTimeboxDropdownOptions();
};

window.addPlannerTask = function() {
    plannerTasks.push({ text: '', ranked: false, rankOrder: 0 });
    renderPlannerTasks();
};

window.removeTask = function(idx) {
    if (idx < 6) return;
    plannerTasks.splice(idx, 1);
    renderPlannerTasks();
};

// 전일 날짜 문자열 계산
function getPrevDateStr(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 전일 플랜 복사 - 우선순위 태스크
window.copyPrevDayTasks = function(checked) {
    if (!checked) {
        // 체크 해제 시 현재 날짜 데이터로 복원
        loadPlannerForDate(diarySelectedDate);
        return;
    }
    const prevDate = getPrevDateStr(diarySelectedDate);
    const prevEntry = getDiaryEntry(prevDate);
    if (!prevEntry || !prevEntry.tasks || !Array.isArray(prevEntry.tasks)) {
        alert('전일 플랜 데이터가 없습니다.');
        document.getElementById('chk-copy-prev-tasks').checked = false;
        return;
    }
    plannerTasks = prevEntry.tasks.map(t => ({ text: t.text || '', ranked: !!t.ranked, rankOrder: t.rankOrder || 0 }));
    while (plannerTasks.length < 6) plannerTasks.push({ text: '', ranked: false, rankOrder: 0 });
    renderPlannerTasks();
};

// 전일 플랜 복사 - 시간표
window.copyPrevDaySchedule = function(checked) {
    if (!checked) {
        // 체크 해제 시 현재 날짜 데이터로 복원
        renderTimeboxGrid(diarySelectedDate);
        return;
    }
    const prevDate = getPrevDateStr(diarySelectedDate);
    const prevEntry = getDiaryEntry(prevDate);
    if (!prevEntry || !prevEntry.blocks || Object.keys(prevEntry.blocks).length === 0) {
        alert('전일 시간표 데이터가 없습니다.');
        document.getElementById('chk-copy-prev-schedule').checked = false;
        return;
    }
    // 전일 블록 데이터로 타임박스 그리드 렌더링
    const grid = document.getElementById('planner-timebox-grid');
    if (!grid) return;
    const blocks = prevEntry.blocks;
    const options = getTaskOptions();
    const isFuture = isSelectedDateFuture();
    // 전일 블록에서 사용된 값 중 현재 옵션에 없는 값 추가
    const optTexts = new Set(options.map(o => o.text));
    const extraVals = [...new Set(Object.values(blocks))].filter(v => v && !optTexts.has(v));

    const emptyLabel = i18n[AppState.currentLang]?.timebox_empty || '-- 없음 --';
    const makeOpts = (currentVal) => {
        const opts = [`<option value="">${emptyLabel}</option>`,
            ...options.map(o => `<option value="${o.text.replace(/"/g,'&quot;')}"${o.text === currentVal ? ' selected' : ''}>${o.label}</option>`),
            ...extraVals.map(v => `<option value="${v.replace(/"/g,'&quot;')}"${v === currentVal ? ' selected' : ''}>${v}</option>`)
        ].join('');
        return opts;
    };

    const rows = [];
    for (let h = 5; h < 24; h++) rows.push(h);

    grid.innerHTML = rows.map(h => {
        const t00 = `${String(h).padStart(2,'0')}:00`;
        const t30 = `${String(h).padStart(2,'0')}:30`;
        const val00 = blocks[t00] || '';
        const val30 = blocks[t30] || '';
        return `<div class="timebox-row">
            <span class="timebox-label">${String(h).padStart(2,'0')}:00</span>
            <select class="timebox-select${val00 ? ' has-content' : ''}"
                    data-time="${t00}"
                    ${isFuture ? 'disabled' : ''}
                    onchange="this.classList.toggle('has-content', this.value.length > 0)">
                ${makeOpts(val00)}
            </select>
            <select class="timebox-select${val30 ? ' has-content' : ''}"
                    data-time="${t30}"
                    ${isFuture ? 'disabled' : ''}
                    onchange="this.classList.toggle('has-content', this.value.length > 0)">
                ${makeOpts(val30)}
            </select>
        </div>`;
    }).join('');
};

// --- ★ Day1 포스트 → 내 플래너 복사 기능 ★ ---
let _pendingCopyPost = null;
let _reelsCachedPosts = []; // 렌더링된 포스트 캐시 (복사 기능용)

window.openCopyPlannerModal = function(postId) {
    const lang = AppState.currentLang;
    // 캐시된 포스트에서 해당 postId 찾기
    const post = _reelsCachedPosts.find(p => `${p.uid}_${p.timestamp}` === postId);
    if (!post) return;

    // blocks 데이터 유효성 체크
    if (!post.blocks || Object.keys(post.blocks).length === 0) {
        alert(i18n[lang]?.reels_copy_no_data || '복사할 시간표 데이터가 없습니다.');
        return;
    }

    _pendingCopyPost = post;

    // 모달 타이틀 & 본문 렌더링
    const titleEl = document.getElementById('copy-planner-modal-title');
    const bodyEl = document.getElementById('copy-planner-modal-body');
    const confirmBtn = document.getElementById('btn-copy-planner-confirm');
    const cancelBtn = document.getElementById('btn-copy-planner-cancel');

    if (titleEl) titleEl.textContent = i18n[lang]?.reels_copy_confirm_title || '⚠️ 플래너 덮어쓰기 경고';
    if (confirmBtn) confirmBtn.textContent = i18n[lang]?.reels_copy_confirm_btn || '복사하기';
    if (cancelBtn) cancelBtn.textContent = i18n[lang]?.reels_copy_cancel_btn || '취소';

    const msgTemplate = i18n[lang]?.reels_copy_confirm_msg || '현재 플래너의 우선순위 태스크와 시간표가 <b>{name}</b>님의 데이터로 덮어쓰기됩니다.<br><br>※ 우선순위 태스크는 시간표에 기록된 순서대로 자동 입력됩니다.';
    if (bodyEl) bodyEl.innerHTML = msgTemplate.replace('{name}', sanitizeText(post.userName || '헌터'));

    // 모달 열기
    const modal = document.getElementById('copyPlannerModal');
    if (modal) { modal.classList.remove('d-none'); modal.classList.add('d-flex'); }
};

window.closeCopyPlannerModal = function() {
    _pendingCopyPost = null;
    const modal = document.getElementById('copyPlannerModal');
    if (modal) { modal.classList.add('d-none'); modal.classList.remove('d-flex'); }
};

window.confirmCopyPlanner = function() {
    if (!_pendingCopyPost) return;
    const lang = AppState.currentLang;
    const post = _pendingCopyPost;

    // 1. blocks 객체에서 고유 태스크를 시간순으로 추출
    const blockEntries = Object.entries(post.blocks).sort(([a], [b]) => a.localeCompare(b));
    const uniqueTasks = [];
    const seen = new Set();
    blockEntries.forEach(([time, task]) => {
        if (task && !seen.has(task)) {
            seen.add(task);
            uniqueTasks.push(task);
        }
    });

    // 2. plannerTasks 생성 (시간표 순서 = 우선순위 순서)
    const newTasks = uniqueTasks.map((text, i) => ({ text, ranked: true, rankOrder: i + 1 }));
    while (newTasks.length < 6) newTasks.push({ text: '', ranked: false, rankOrder: 0 });

    // 3. localStorage diary_entries에 먼저 저장 (switchTab → loadPlannerForDate에서 읽힘)
    const dateStr = diarySelectedDate;
    let diaries;
    try { diaries = JSON.parse(localStorage.getItem('diary_entries') || '{}'); } catch(e) { diaries = {}; }

    const existingEntry = diaries[dateStr] || {};
    diaries[dateStr] = {
        ...existingEntry,
        blocks: post.blocks,
        tasks: newTasks,
        priorities: newTasks.filter(t => t.ranked && t.text).sort((a, b) => a.rankOrder - b.rankOrder).map(t => t.text),
        brainDump: existingEntry.brainDump || '',
        text: Object.entries(post.blocks).map(([t, v]) => `[${t}] ${v}`).join(' | ').substring(0, 500),
        timestamp: Date.now()
    };
    localStorage.setItem('diary_entries', JSON.stringify(diaries));

    // 4. 모달 닫기
    window.closeCopyPlannerModal();

    // 5. diary 탭으로 전환 (loadPlannerForDate가 localStorage에서 저장된 데이터를 읽어 렌더링)
    switchTab('diary', document.querySelector('.nav-item[data-tab="diary"]'));

    // 6. 성공 알림
    alert(i18n[lang]?.reels_copy_success || '플래너에 복사되었습니다. 플래너 탭에서 확인하세요.');
};

// 타임박스 그리드 렌더링 - 드롭다운 방식 (05:00~23:30)
function renderTimeboxGrid(dateStr) {
    const grid = document.getElementById('planner-timebox-grid');
    if (!grid) return;

    const entry = getDiaryEntry(dateStr);
    const blocks = (entry && entry.blocks) ? entry.blocks : {};
    const isFuture = isSelectedDateFuture();
    const options = getTaskOptions();

    const emptyLabel = i18n[AppState.currentLang]?.timebox_empty || '-- 없음 --';
    const makeOpts = (currentVal) => {
        const opts = [`<option value="">${emptyLabel}</option>`,
            ...options.map(o => `<option value="${o.text.replace(/"/g,'&quot;')}"${o.text === currentVal ? ' selected' : ''}>${o.label}</option>`)
        ].join('');
        return opts;
    };

    const rows = [];
    for (let h = 5; h < 24; h++) rows.push(h);

    grid.innerHTML = rows.map(h => {
        const t00 = `${String(h).padStart(2,'0')}:00`;
        const t30 = `${String(h).padStart(2,'0')}:30`;
        const val00 = blocks[t00] || '';
        const val30 = blocks[t30] || '';
        return `<div class="timebox-row">
            <span class="timebox-label">${String(h).padStart(2,'0')}:00</span>
            <select class="timebox-select${val00 ? ' has-content' : ''}"
                    data-time="${t00}"
                    ${isFuture ? 'disabled' : ''}
                    onchange="this.classList.toggle('has-content', this.value.length > 0)">
                ${makeOpts(val00)}
            </select>
            <select class="timebox-select${val30 ? ' has-content' : ''}"
                    data-time="${t30}"
                    ${isFuture ? 'disabled' : ''}
                    onchange="this.classList.toggle('has-content', this.value.length > 0)">
                ${makeOpts(val30)}
            </select>
        </div>`;
    }).join('');
}

window.selectPlannerDate = function(dateStr) {
    diarySelectedDate = dateStr;
    renderPlannerCalendar();
    loadPlannerForDate(dateStr);
};

function loadPlannerForDate(dateStr) {
    const dateDisplay = document.getElementById('planner-selected-date');
    if (dateDisplay) dateDisplay.innerText = dateStr;

    // 전일 복사 체크박스 리셋
    const chkTasks = document.getElementById('chk-copy-prev-tasks');
    if (chkTasks) chkTasks.checked = false;
    const chkSchedule = document.getElementById('chk-copy-prev-schedule');
    if (chkSchedule) chkSchedule.checked = false;

    // 무드 버튼 리셋
    document.querySelectorAll('#planner-mood-selector .diary-mood-btn').forEach(btn => btn.classList.remove('selected'));
    const saved = getDiaryEntry(dateStr);
    if (saved && saved.mood) {
        const moodBtn = document.querySelector(`#planner-mood-selector .diary-mood-btn[data-mood="${saved.mood}"]`);
        if (moodBtn) moodBtn.classList.add('selected');
    }

    // 태스크 로드 (새 형식 우선, 구 형식 마이그레이션)
    if (saved && saved.tasks && Array.isArray(saved.tasks)) {
        plannerTasks = saved.tasks.map(t => ({ text: t.text || '', ranked: !!t.ranked, rankOrder: t.rankOrder || 0 }));
        while (plannerTasks.length < 6) plannerTasks.push({ text: '', ranked: false, rankOrder: 0 });
    } else if (saved && (saved.priorities || saved.brainDump)) {
        // 구 형식 마이그레이션: priorities(3개) + brainDump 텍스트
        plannerTasks = Array(6).fill(null).map(() => ({ text: '', ranked: false, rankOrder: 0 }));
        const oldPriorities = saved.priorities || [];
        oldPriorities.forEach((p, i) => {
            if (p && i < 6) { plannerTasks[i].text = p; plannerTasks[i].ranked = true; plannerTasks[i].rankOrder = i + 1; }
        });
        // brainDump 줄 단위로 빈 슬롯에 채우기
        if (saved.brainDump) {
            saved.brainDump.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (!trimmed) return;
                const slot = plannerTasks.findIndex(t => !t.text);
                if (slot >= 0) plannerTasks[slot].text = trimmed;
                else plannerTasks.push({ text: trimmed, ranked: false, rankOrder: 0 });
            });
        }
    } else {
        plannerTasks = Array(6).fill(null).map(() => ({ text: '', ranked: false, rankOrder: 0 }));
    }

    // 캡션 복원
    const captionEl = document.getElementById('planner-caption');
    if (captionEl) {
        captionEl.value = (saved && saved.caption) ? saved.caption : '';
        window.updateCaptionCounter();
    }

    // 사진 복원
    if (saved && saved.photo) {
        plannerPhotoData = saved.photo;
        // base64 원본 보존 (URL이면 null → loadImageSafe 폴백)
        _plannerPhotoBase64 = isBase64Image(saved.photo) ? saved.photo : null;
        const preview = document.getElementById('planner-photo-preview');
        const placeholder = document.getElementById('planner-photo-placeholder');
        const removeBtn = document.getElementById('planner-photo-remove');
        if (preview) {
            if (saved.photo && saved.photo.startsWith('http')) {
                preview.onerror = function() {
                    this.onerror = null;
                    window._retryFirebaseImg(this, saved.photo);
                };
            }
            preview.src = saved.photo;
            preview.classList.remove('d-none');
        }
        if (placeholder) placeholder.classList.add('d-none');
        if (removeBtn) removeBtn.classList.remove('d-none');

        // URL 사진 → base64 캐시 (canvas export용, 백그라운드)
        if (!isBase64Image(saved.photo) && saved.photo.startsWith('http')) {
            fetch(saved.photo).then(r => r.blob()).then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => { _plannerPhotoBase64 = reader.result; };
                reader.readAsDataURL(blob);
            }).catch(() => { /* 캐시 실패 무시 — sharePlannerAsImage에서 loadImageSafe 폴백 */ });
        }

        // 기존 base64 사진 → Storage 자동 마이그레이션 (백그라운드)
        if (isBase64Image(saved.photo) && auth.currentUser) {
            const migDateStr = diarySelectedDate;
            uploadImageToStorage(
                `planner_photos/${auth.currentUser.uid}/${migDateStr}.jpg`, saved.photo
            ).then(url => {
                try {
                    const diaries = JSON.parse(localStorage.getItem('diary_entries') || '{}');
                    if (diaries[migDateStr]) {
                        diaries[migDateStr].photo = url;
                        localStorage.setItem('diary_entries', JSON.stringify(diaries));
                        plannerPhotoData = url;
                        AppLogger.info('[Planner] base64→Storage 마이그레이션 완료: ' + migDateStr);
                    }
                } catch (e) { /* 마이그레이션 실패 무시 — 다음 저장 시 재시도 */ }
            }).catch(() => { /* 백그라운드 마이그레이션 실패 무시 */ });
        }
    } else {
        plannerPhotoData = null;
        _plannerPhotoBase64 = null;
        const preview = document.getElementById('planner-photo-preview');
        const placeholder = document.getElementById('planner-photo-placeholder');
        const removeBtn = document.getElementById('planner-photo-remove');
        if (preview) { preview.classList.add('d-none'); preview.removeAttribute('src'); }
        if (placeholder) placeholder.classList.remove('d-none');
        if (removeBtn) removeBtn.classList.add('d-none');
        const fileInput = document.getElementById('plannerPhotoUpload');
        if (fileInput) fileInput.value = '';
    }

    // 태스크 목록 렌더링 (이 안에서 updateTimeboxDropdownOptions도 호출됨)
    renderPlannerTasks();

    // 타임박스 그리드 렌더링 (태스크 옵션 준비된 후)
    renderTimeboxGrid(dateStr);

    // 미래 날짜 비활성화
    const isFuture = isSelectedDateFuture();
    document.querySelectorAll('#planner-timebox-grid .timebox-select').forEach(sel => { sel.disabled = isFuture; });
    const saveBtn = document.getElementById('btn-planner-save');
    if (saveBtn) saveBtn.disabled = isFuture;
    const addBtn = document.getElementById('btn-add-task');
    if (addBtn) addBtn.disabled = isFuture;
}

let _plannerSaving = false; // 플래너 저장 진행 중 플래그

async function savePlannerEntry() {
    if (_plannerSaving) return; // 중복 저장 방지
    _plannerSaving = true;

    // 저장 중 버튼 비활성화 (저장 + Day1 포스팅)
    const saveBtn = document.getElementById('btn-planner-save');
    const savePriorityBtn = document.getElementById('btn-planner-save-priority');
    const postBtn = document.getElementById('btn-reels-post');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.6'; }
    if (savePriorityBtn) { savePriorityBtn.disabled = true; savePriorityBtn.style.opacity = '0.6'; }
    if (postBtn) { postBtn.disabled = true; postBtn.style.opacity = '0.6'; }

    const dateStr = diarySelectedDate;

    // 타임박스 드롭다운 블록 수집
    const selects = document.querySelectorAll('#planner-timebox-grid .timebox-select');
    const blocks = {};
    selects.forEach(sel => {
        const val = sel.value.trim();
        if (val) blocks[sel.dataset.time] = val;
    });

    // 태스크 데이터 수집
    const tasksData = plannerTasks.map(t => ({ text: t.text || '', ranked: !!t.ranked, rankOrder: t.rankOrder || 0 }));
    // 하위 호환 priorities 배열 (순위 지정된 항목만 순서대로)
    const rankedByOrder = tasksData
        .filter(t => t.ranked && t.text)
        .sort((a, b) => a.rankOrder - b.rankOrder)
        .map(t => t.text);
    const brainDump = '';

    const selectedMood = document.querySelector('#planner-mood-selector .diary-mood-btn.selected');
    const mood = selectedMood ? selectedMood.dataset.mood : '';

    const hasContent = Object.keys(blocks).length > 0 || tasksData.some(t => t.text);

    try {
        let diaries;
        try {
            diaries = JSON.parse(localStorage.getItem('diary_entries') || '{}');
        } catch(parseErr) {
            AppLogger.warn('[Planner] diary_entries 파싱 오류, 초기화: ' + parseErr.message);
            diaries = {};
        }

        // 보상: 하루 1회만 - diary_entries와 분리된 별도 키로 관리 (Firebase 덮어쓰기 영향 없음)
        let plannerRewards = {};
        try { plannerRewards = JSON.parse(localStorage.getItem('planner_rewards') || '{}'); } catch(e) {}
        const alreadyRewarded = plannerRewards[dateStr] === true;
        const giveReward = !alreadyRewarded && hasContent;

        const text = Object.entries(blocks).map(([t, v]) => `[${t}] ${v}`).join(' | ').substring(0, 500);

        // 플래너 사진: base64 → Cloud Storage 업로드, URL만 저장 (Firestore 문서 비대화 방지)
        let photoValue = plannerPhotoData || (diaries[dateStr]?.photo || null);
        if (isBase64Image(photoValue) && auth.currentUser) {
            try {
                const uid = auth.currentUser.uid;
                const plannerLang = AppState.currentLang || 'ko';
                const plannerProgressCb = createUploadProgressCallback(plannerLang === 'ko' ? '플래너 사진 업로드 중...' : 'Uploading planner photo...');
                const photoURL = await uploadImageToStorage(
                    `planner_photos/${uid}/${dateStr}${getImageExtension()}`, photoValue, plannerProgressCb
                );
                hideUploadProgress();
                photoValue = photoURL;
                plannerPhotoData = photoURL; // 메모리 캐시도 URL로 교체
                AppLogger.info('[Planner] 사진 Storage 업로드 완료');
            } catch (e) {
                hideUploadProgress();
                AppLogger.error('[Planner] 사진 Storage 업로드 실패: ' + (e.message || e));
                // 업로드 실패 시 사진 없이 저장 (base64 Firestore 저장 방지)
                photoValue = null;
                alert(AppState.currentLang === 'ko' ? '사진 업로드에 실패했습니다. 네트워크 확인 후 다시 시도해주세요.' : 'Photo upload failed. Please check your network and try again.');
            }
        }

        diaries[dateStr] = {
            text, mood, timestamp: Date.now(), blocks,
            tasks: tasksData,
            priorities: rankedByOrder,
            brainDump,
            photo: photoValue,
            caption: (document.getElementById('planner-caption')?.value || '').trim()
        };

        try {
            localStorage.setItem('diary_entries', JSON.stringify(diaries));
        } catch(storageErr) {
            AppLogger.error('[Planner] localStorage 저장 실패: ' + storageErr.message);
            alert('저장 공간이 부족합니다. 오래된 데이터를 정리해 주세요.');
            return;
        }

        if (giveReward) {
            plannerRewards[dateStr] = true;
            localStorage.setItem('planner_rewards', JSON.stringify(plannerRewards));
            AppState.user.points += 20;
            AppState.user.pendingStats.agi += 0.5;
            updatePointUI();
            drawRadarChart();
            updateChallengeProgress('planner_use');
            AppLogger.info('[Planner] 보상 지급: +20P, AGI +0.5');
        }

        await saveUserData();
        AppLogger.info('[Planner] 플래너 저장 완료: ' + dateStr);
    } catch(e) {
        AppLogger.error('[Planner] Save error: ' + (e.stack || e.message));
        alert('저장 중 오류가 발생했습니다: ' + e.message);
        return;
    } finally {
        // 저장 완료 후 버튼 재활성화
        _plannerSaving = false;
        const _saveBtn = document.getElementById('btn-planner-save');
        const _savePriorityBtn = document.getElementById('btn-planner-save-priority');
        if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.style.opacity = ''; }
        if (_savePriorityBtn) { _savePriorityBtn.disabled = false; _savePriorityBtn.style.opacity = ''; }
        // Day1 포스팅 버튼은 타이머 상태에 따라 복원
        updateReelsResetTimer();
    }

    renderPlannerCalendar();
    alert(i18n[AppState.currentLang].diary_saved || '플래너가 저장되었습니다.');
}

// --- ★ 플래너 사진 기능 (타임테이블 사진 필수) ★ ---
let plannerPhotoData = null; // base64 or URL
let _plannerPhotoBase64 = null; // canvas export용 base64 원본 보존 (URL 교체 후에도 유지)

let _plannerPhotoCompressing = false;
function loadPlannerPhoto(e) {
    const file = e.target.files[0];
    if (!file || _plannerPhotoCompressing) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
        const img = new Image();
        img.onload = async function() {
            _plannerPhotoCompressing = true;
            try {
                const canvas = document.createElement('canvas');
                const maxSize = 480;
                let w = img.width, h = img.height;
                if (w > maxSize || h > maxSize) {
                    if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                    else { w = Math.round(w * maxSize / h); h = maxSize; }
                }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                // 적응형 압축: 1.2MB 이하 보장 (2MB 규칙에 안전 마진 + 모바일 업로드 속도 고려)
                const { dataURL } = await compressToTargetSize(canvas, 1200 * 1024, 0.7, 0.2);
                plannerPhotoData = dataURL;
                _plannerPhotoBase64 = dataURL; // canvas export용 base64 보존
                const preview = document.getElementById('planner-photo-preview');
                const placeholder = document.getElementById('planner-photo-placeholder');
                const removeBtn = document.getElementById('planner-photo-remove');
                preview.src = plannerPhotoData;
                preview.classList.remove('d-none');
                placeholder.classList.add('d-none');
                removeBtn.classList.remove('d-none');
            } finally {
                _plannerPhotoCompressing = false;
            }
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

window.removePlannerPhoto = function() {
    plannerPhotoData = null;
    _plannerPhotoBase64 = null;
    const preview = document.getElementById('planner-photo-preview');
    const placeholder = document.getElementById('planner-photo-placeholder');
    const removeBtn = document.getElementById('planner-photo-remove');
    preview.classList.add('d-none');
    preview.removeAttribute('src');
    placeholder.classList.remove('d-none');
    removeBtn.classList.add('d-none');
    document.getElementById('plannerPhotoUpload').value = '';
};

// 캡션 글자 수 카운터 (한글 140자 / 영문 280자 제한)
// 한글(2바이트 문자)은 2로, 영문/숫자(1바이트)는 1로 계산하여 최대 280 기준
function getCaptionByteLength(str) {
    let len = 0;
    for (let i = 0; i < str.length; i++) {
        len += str.charCodeAt(i) > 127 ? 2 : 1;
    }
    return len;
}

window.updateCaptionCounter = function() {
    const textarea = document.getElementById('planner-caption');
    const counter = document.getElementById('planner-caption-counter');
    if (!textarea || !counter) return;

    let text = textarea.value;
    const byteLen = getCaptionByteLength(text);
    const maxBytes = 280;

    // 초과 시 잘라내기
    if (byteLen > maxBytes) {
        let trimmed = '';
        let currentLen = 0;
        for (let i = 0; i < text.length; i++) {
            const charLen = text.charCodeAt(i) > 127 ? 2 : 1;
            if (currentLen + charLen > maxBytes) break;
            trimmed += text[i];
            currentLen += charLen;
        }
        textarea.value = trimmed;
        text = trimmed;
    }

    const used = getCaptionByteLength(text);
    const koEquiv = Math.ceil(used / 2);
    counter.innerText = `${koEquiv} / 140`;
    counter.style.color = used >= maxBytes * 0.9 ? 'var(--neon-red)' : 'var(--text-sub)';
};

// --- ★ 릴스 기능 ★ ---

// KST 기준 오늘 날짜 문자열
function getTodayKST() {
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000));
    return `${kst.getFullYear()}-${String(kst.getMonth()+1).padStart(2,'0')}-${String(kst.getDate()).padStart(2,'0')}`;
}

// 릴스 데이터 로드 (localStorage) — 업로드 후 24시간 경과 포스트 자동 삭제
function getReelsData() {
    try {
        const data = JSON.parse(localStorage.getItem('reels_posts') || '{}');
        const todayKST = getTodayKST();
        if (!data._lastDate) data._lastDate = todayKST;
        if (!data.posts) data.posts = [];
        // 24시간 경과 포스트 자동 삭제
        const now = Date.now();
        const before = data.posts.length;
        data.posts = data.posts.filter(p => (now - (p.timestamp || 0)) < 24 * 60 * 60 * 1000);
        if (data.posts.length !== before) {
            data._lastDate = todayKST;
            localStorage.setItem('reels_posts', JSON.stringify(data));
        }
        return data;
    } catch { return { _lastDate: getTodayKST(), posts: [] }; }
}

function saveReelsData(data) {
    localStorage.setItem('reels_posts', JSON.stringify(data));
}

function updateLocalReelsProfileImage() {
    if (!auth.currentUser) return;
    try {
        const data = JSON.parse(localStorage.getItem('reels_posts') || '{}');
        if (!data.posts || data.posts.length === 0) return;
        const uid = auth.currentUser.uid;
        let changed = false;
        data.posts.forEach(p => {
            if (p.uid === uid && p.userPhoto !== AppState.user.photoURL) {
                p.userPhoto = AppState.user.photoURL;
                changed = true;
            }
        });
        if (changed) localStorage.setItem('reels_posts', JSON.stringify(data));
    } catch(e) {}
}

// Firestore에 릴스 포스트 저장/로드
async function saveReelsToFirestore(post) {
    if (!auth.currentUser) return;
    try {
        const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
        let existingPosts = [];
        if (userDoc.exists() && userDoc.data().reelsStr) {
            try { existingPosts = JSON.parse(userDoc.data().reelsStr); } catch(e) {}
        }
        // 24시간 이내 포스트만 유지
        const now = Date.now();
        existingPosts = existingPosts.filter(p => (now - (p.timestamp || 0)) < 24 * 60 * 60 * 1000);
        // 기존 포스트의 프로필 이미지를 최신 값으로 갱신
        const currentPhoto = AppState.user.photoURL || null;
        existingPosts.forEach(p => { p.userPhoto = currentPhoto; });
        existingPosts.push(post);
        await setDoc(doc(db, "users", auth.currentUser.uid), {
            reelsStr: JSON.stringify(existingPosts),
            hasActiveReels: true
        }, { merge: true });
    } catch(e) { AppLogger.error('[Reels] Firestore 저장 실패: ' + (e.message || e)); }
}

async function fetchAllReelsPosts() {
    const now = Date.now();
    const posts = [];
    try {
        const q = query(collection(db, "users"), where("hasActiveReels", "==", true));
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
            const data = d.data();
            if (data.reelsStr) {
                try {
                    const userPosts = JSON.parse(data.reelsStr);
                    let hasValidPost = false;
                    userPosts.forEach(p => {
                        // 업로드 후 24시간 이내 포스트만 표시
                        if ((now - (p.timestamp || 0)) < 24 * 60 * 60 * 1000) {
                            hasValidPost = true;
                            posts.push({
                                ...p,
                                uid: d.id,
                                userName: data.name || '헌터',
                                userPhoto: data.photoURL || null,
                                userLevel: data.level || 1,
                                userInstaId: data.instaId || ''
                            });
                        }
                    });
                    // 모든 릴스가 만료된 사용자는 hasActiveReels 리셋
                    // 다른 유저 문서 직접 수정 불가 (보안 규칙: 본인 문서만 쓰기 허용)
                    // 본인 문서만 클라이언트에서 리셋, 타인은 Cloud Functions에서 처리
                    if (!hasValidPost && d.id === auth.currentUser?.uid) {
                        setDoc(doc(db, "users", d.id), { hasActiveReels: false }, { merge: true }).catch(() => {});
                    }
                } catch(e) {}
            }
        });
    } catch(e) { AppLogger.error('[Reels] 피드 로드 실패: ' + (e.message || e)); }
    // 최신순 정렬
    posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return posts;
}

// ===== 위치 태그 (Location Tag) =====
let _locationSearchTimer = null;
AppState.selectedLocation = null;

function openLocationModal() {
    const modal = document.getElementById('location-search-modal');
    if (!modal) return;
    modal.classList.remove('d-none');
    const input = document.getElementById('location-search-input');
    if (input) { input.value = ''; input.focus(); }
    document.getElementById('location-search-list').innerHTML = '';
}
window.openLocationModal = openLocationModal;

function closeLocationModal() {
    const modal = document.getElementById('location-search-modal');
    if (modal) modal.classList.add('d-none');
}
window.closeLocationModal = closeLocationModal;

function selectLocation(name, lat, lng) {
    AppState.selectedLocation = { name, lat, lng };
    const btn = document.getElementById('btn-location-tag');
    const result = document.getElementById('planner-location-result');
    const nameEl = document.getElementById('planner-location-name');
    if (btn) btn.classList.add('d-none');
    if (result) { result.classList.remove('d-none'); }
    if (nameEl) nameEl.textContent = '📍 ' + name;
    closeLocationModal();
}
window.selectLocation = selectLocation;

function removeSelectedLocation() {
    AppState.selectedLocation = null;
    const btn = document.getElementById('btn-location-tag');
    const result = document.getElementById('planner-location-result');
    if (btn) btn.classList.remove('d-none');
    if (result) result.classList.add('d-none');
}
window.removeSelectedLocation = removeSelectedLocation;

function resetLocationUI() {
    AppState.selectedLocation = null;
    const btn = document.getElementById('btn-location-tag');
    const result = document.getElementById('planner-location-result');
    if (btn) btn.classList.remove('d-none');
    if (result) result.classList.add('d-none');
}

async function searchLocationNominatim(query) {
    const lang = AppState.currentLang || 'ko';
    const acceptLang = lang === 'ja' ? 'ja' : lang === 'en' ? 'en' : 'ko';
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&accept-language=${acceptLang}&addressdetails=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'LevelUpApp/1.0' } });
    if (!res.ok) return [];
    return await res.json();
}

async function reverseGeocodeNominatim(lat, lng) {
    const lang = AppState.currentLang || 'ko';
    const acceptLang = lang === 'ja' ? 'ja' : lang === 'en' ? 'en' : 'ko';
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${acceptLang}&addressdetails=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'LevelUpApp/1.0' } });
    if (!res.ok) return null;
    return await res.json();
}

function renderLocationResults(results) {
    const lang = AppState.currentLang || 'ko';
    const list = document.getElementById('location-search-list');
    if (!list) return;
    if (!results || results.length === 0) {
        list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_no_results || 'No results found.'}</div>`;
        return;
    }
    list.innerHTML = results.map(r => {
        const name = r.name || r.display_name?.split(',')[0] || '';
        const addr = r.display_name || '';
        const lat = r.lat;
        const lng = r.lon;
        return `<div class="location-search-item" onclick="window.selectLocation('${name.replace(/'/g, "\\'")}', ${lat}, ${lng})">
            <div class="location-search-item-name">📍 ${name}</div>
            <div class="location-search-item-addr">${addr}</div>
        </div>`;
    }).join('');
}

function onLocationSearchInput(query) {
    clearTimeout(_locationSearchTimer);
    const lang = AppState.currentLang || 'ko';
    const list = document.getElementById('location-search-list');
    if (!query || query.trim().length < 2) {
        if (list) list.innerHTML = '';
        return;
    }
    if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_searching || 'Searching...'}</div>`;
    _locationSearchTimer = setTimeout(async () => {
        try {
            const results = await searchLocationNominatim(query.trim());
            renderLocationResults(results);
        } catch (e) {
            console.error('[Location] Search error:', e);
            if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_error || 'Error'}</div>`;
        }
    }, 400);
}
window.onLocationSearchInput = onLocationSearchInput;

async function useCurrentLocation() {
    const lang = AppState.currentLang || 'ko';
    const list = document.getElementById('location-search-list');
    const btn = document.getElementById('btn-location-current');
    if (btn) btn.disabled = true;
    if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_searching || 'Searching...'}</div>`;
    try {
        const { Geolocation } = window.Capacitor?.Plugins || {};
        let lat, lng;
        if (Geolocation) {
            const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        } else if (navigator.geolocation) {
            const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }));
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        } else {
            throw new Error('No geolocation available');
        }
        const result = await reverseGeocodeNominatim(lat, lng);
        if (result) {
            const addr = result.address || {};
            const name = addr.road || addr.neighbourhood || addr.suburb || addr.city_district || result.name || result.display_name?.split(',')[0] || '';
            const area = addr.city || addr.town || addr.village || '';
            const displayName = area ? `${name}, ${area}` : name;
            selectLocation(displayName, lat, lng);
        } else {
            if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_error || 'Error'}</div>`;
        }
    } catch (e) {
        console.error('[Location] GPS error:', e);
        if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_error || 'Unable to get location.'}</div>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}
window.useCurrentLocation = useCurrentLocation;

// 릴스 포스팅
async function postToReels() {
    const lang = AppState.currentLang;
    const todayKST = getTodayKST();

    // 이미 포스팅 후 24시간 이내인지 체크 (로컬 타임스탬프 검증)
    const lastPostTs = parseInt(localStorage.getItem('reels_last_post_ts') || '0', 10);
    if (lastPostTs && (Date.now() - lastPostTs) < 24 * 60 * 60 * 1000) {
        return; // 버튼이 비활성화되어 있으므로 조용히 리턴
    }

    // 오늘 타임테이블(시간표)이 있는지 체크
    const todayStr = getTodayStr();
    const entry = getDiaryEntry(todayStr);
    if (!entry || !entry.blocks || Object.keys(entry.blocks).length === 0) {
        alert(i18n[lang].reels_no_timetable);
        return;
    }

    // 사진 + 텍스트 모두 있는지 체크
    const photoData = plannerPhotoData || (entry.photo || null);
    const captionText = (entry.caption || document.getElementById('planner-caption')?.value || '').trim();
    if (!photoData || !captionText) {
        alert(i18n[lang].reels_no_photo);
        return;
    }

    // 즉시 버튼 비활성화 (중복 클릭 방지 + 시각 피드백)
    const postBtn = document.getElementById('btn-reels-post');
    if (postBtn) {
        postBtn.disabled = true;
        postBtn.removeAttribute('data-i18n');
        postBtn.textContent = '포스팅 중...';
        postBtn.style.background = '#333';
        postBtn.style.color = '#666';
        postBtn.style.opacity = '0.6';
        postBtn.style.cursor = 'not-allowed';
    }

    try {
        // 포스트 생성
        const caption = (entry.caption || '').trim();
        const postTimestamp = Date.now();

        // 릴스 사진을 Cloud Storage에 업로드 (압축 후)
        let finalPhotoURL = photoData;
        let uploadFailed = false;
        if (isBase64Image(photoData)) {
            try {
                const uid = auth.currentUser.uid;
                const reelsLang = AppState.currentLang || 'ko';
                const reelsProgressCb = createUploadProgressCallback(reelsLang === 'ko' ? '릴스 사진 업로드 중...' : 'Uploading reel photo...');
                // 릴스 사진 압축 (최대 480px, quality 0.6) — Storage 2MB 제한 대응
                const compressedPhotoData = await compressBase64Image(photoData, 480, 0.6);
                finalPhotoURL = await uploadImageToStorage(`reels_photos/${uid}/${postTimestamp}${getImageExtension()}`, compressedPhotoData, reelsProgressCb);
                hideUploadProgress();
            } catch (e) {
                hideUploadProgress();
                console.error('[Reels] Storage 업로드 실패 (3회 재시도 후):', e);
                // base64 직접 저장 대신 에러 상태 기록 — Firestore 문서 비대화 방지
                finalPhotoURL = null;
                uploadFailed = true;
            }
        }

        if (uploadFailed) {
            alert(lang === 'ko' ? '사진 업로드에 실패했습니다. 네트워크 확인 후 다시 시도해주세요.' : 'Photo upload failed. Please check your network and try again.');
            // 버튼 재활성화 후 중단
            updateReelsResetTimer();
            return;
        }

        const post = {
            uid: auth.currentUser.uid,
            dateKST: todayKST,
            timestamp: postTimestamp,
            photo: finalPhotoURL,
            caption: caption,
            blocks: entry.blocks,
            tasks: entry.tasks || [],
            mood: entry.mood || '',
            userName: AppState.user.name,
            userPhoto: AppState.user.photoURL || null,
            userLevel: AppState.user.level,
            location: AppState.selectedLocation || null
        };

        // 로컬 저장
        const reelsData = getReelsData();
        reelsData.posts.push(post);
        saveReelsData(reelsData);

        // 포스팅 타임스탬프 저장 (로그아웃 후에도 비활성화 유지용)
        localStorage.setItem('reels_last_post_ts', String(postTimestamp));

        // Firestore 저장
        await saveReelsToFirestore(post);

        // 포스팅 보상: +20P & CHA +0.5 (24시간 내 중복 지급 방지)
        const lastRewardTs = parseInt(localStorage.getItem('reels_reward_ts') || '0', 10);
        const alreadyRewarded = lastRewardTs && (Date.now() - lastRewardTs) < 24 * 60 * 60 * 1000;
        if (!alreadyRewarded) {
            AppState.user.points += 20;
            AppState.user.pendingStats.cha = (AppState.user.pendingStats.cha || 0) + 0.5;
            localStorage.setItem('reels_reward_ts', String(postTimestamp));
            updatePointUI();
            drawRadarChart();
            AppLogger.info('[Reels] 포스팅 보상 지급: +20P, CHA +0.5');
        }

        await saveUserData();
        resetLocationUI();
        alert(i18n[lang].reels_posted);
        renderReelsFeed();
    } catch(e) {
        AppLogger.error('[Reels] 포스팅 오류: ' + (e.message || e));
    } finally {
        // 항상 타이머/버튼 상태 갱신 (에러 발생 시에도)
        updateReelsResetTimer();
    }
}

// 릴스 피드 렌더링
// _reelsFeedRendering: 중복 호출 방지 플래그
// _reelsFeedLastKey: 마지막 렌더링 데이터 키 (불필요한 DOM 교체 방지)
async function renderReelsFeed() {
    const container = document.getElementById('reels-feed');
    if (!container) return;

    // 이미 렌더링 중이면 중복 호출 방지
    if (window._reelsFeedRendering) return;
    window._reelsFeedRendering = true;

    const lang = AppState.currentLang;

    // 포스트 데이터 키 생성 (uid_timestamp 목록으로 변경 감지)
    function postsKey(posts) {
        return posts.map(p => `${p.uid}_${p.timestamp}`).join(',');
    }

    // 로컬 캐시 먼저 표시 (단, 이전 렌더와 동일하면 스킵)
    const localData = getReelsData();
    const localPosts = (localData.posts || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const localKey = postsKey(localPosts);

    if (localPosts.length > 0) {
        if (window._reelsFeedLastKey !== localKey) {
            container.innerHTML = renderReelsCards(localPosts, lang);
            window._reelsFeedLastKey = localKey;
            // Day1 네이티브 광고 로드 (로컬 캐시 렌더 후)
            if (localPosts.length >= REELS_NATIVE_AD_POSITION && isNativePlatform) {
                setTimeout(() => loadAndShowNativeAd('reels'), 300);
            }
        }
    } else if (!window._reelsFeedLastKey) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-sub);">로딩 중...</div>';
    }

    // Firestore에서 최신 데이터 로드 (5초 타임아웃)
    try {
        const posts = await Promise.race([
            fetchAllReelsPosts(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
        if (posts.length === 0) {
            if (window._reelsFeedLastKey !== '') {
                container.innerHTML = `<div class="system-card" style="text-align:center; padding:30px; color:var(--text-sub);">
                    <div style="font-size:2rem; margin-bottom:10px;">🎬</div>
                    <div>${i18n[lang].reels_empty}</div>
                </div>`;
                window._reelsFeedLastKey = '';
            }
            return;
        }
        const serverKey = postsKey(posts);
        // Firestore 데이터가 로컬과 동일하면 DOM 교체 스킵 (깜빡임 방지)
        if (window._reelsFeedLastKey !== serverKey) {
            // DOM 교체 전 기존 광고 정리 (placeholder가 사라지므로)
            if (_nativeAdActiveTab === 'reels') cleanupNativeAd();
            container.innerHTML = renderReelsCards(posts, lang);
            window._reelsFeedLastKey = serverKey;
            // Day1 네이티브 광고 로드 (서버 데이터 렌더 후)
            if (posts.length >= REELS_NATIVE_AD_POSITION && isNativePlatform) {
                setTimeout(() => loadAndShowNativeAd('reels'), 300);
            }
        }
    } catch(e) {
        // 타임아웃 또는 네트워크 오류 시 로컬 데이터 유지
        if (localPosts.length === 0 && !window._reelsFeedLastKey) {
            container.innerHTML = `<div class="system-card" style="text-align:center; padding:30px; color:var(--text-sub);">
                <div style="font-size:2rem; margin-bottom:10px;">🎬</div>
                <div>${i18n[lang].reels_empty}</div>
            </div>`;
            window._reelsFeedLastKey = '';
        }
    } finally {
        window._reelsFeedRendering = false;
    }
}

function mergeConsecutiveBlocks(blocks) {
    const entries = Object.entries(blocks || {}).sort(([a],[b]) => a.localeCompare(b));
    if (entries.length === 0) return [];
    const merged = [];
    let [startTime, currentTask] = entries[0];
    let endTime = startTime;
    for (let i = 1; i < entries.length; i++) {
        const [time, task] = entries[i];
        const [eh, em] = endTime.split(':').map(Number);
        const expectedNext = `${String(eh + (em === 30 ? 1 : 0)).padStart(2,'0')}:${em === 30 ? '00' : '30'}`;
        if (task === currentTask && time === expectedNext) {
            endTime = time;
        } else {
            const [fh, fm] = endTime.split(':').map(Number);
            const finalEnd = `${String(fh + (fm === 30 ? 1 : 0)).padStart(2,'0')}:${fm === 30 ? '00' : '30'}`;
            merged.push({ time: `${startTime}~${finalEnd}`, task: currentTask });
            startTime = time;
            currentTask = task;
            endTime = time;
        }
    }
    const [fh, fm] = endTime.split(':').map(Number);
    const finalEnd = `${String(fh + (fm === 30 ? 1 : 0)).padStart(2,'0')}:${fm === 30 ? '00' : '30'}`;
    merged.push({ time: `${startTime}~${finalEnd}`, task: currentTask });
    return merged;
}

function renderReelsCards(posts, lang) {
    _reelsCachedPosts = posts; // 포스트 캐시 업데이트
    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="color:#ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;

    const heartOutline = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const commentIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    const copyIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const reportIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;

    const html = posts.map((post, postIdx) => {
        const postId = getPostId(post);
        const profileSrc = post.userPhoto ? sanitizeURL(post.userPhoto) : DEFAULT_PROFILE_SVG;
        const isMe = post.uid === auth.currentUser?.uid;
        const instaLink = post.userInstaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(post.userInstaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:4px; cursor:pointer; display:inline-flex; vertical-align:middle;">${instaSvg}</button>` : '';

        // 시간표 블록 (폴딩/언폴딩 지원, 연속 동일 업무 합치기)
        const mergedBlocks = mergeConsecutiveBlocks(post.blocks);
        const FOLD_LIMIT = 6;
        const blockSummary = mergedBlocks.slice(0, FOLD_LIMIT).map(({time, task}) =>
            `<div class="reels-block-item"><span class="reels-block-time">${time}</span><span class="reels-block-task">${sanitizeText(task)}</span></div>`
        ).join('');
        const blockExtra = mergedBlocks.slice(FOLD_LIMIT).map(({time, task}) =>
            `<div class="reels-block-item"><span class="reels-block-time">${time}</span><span class="reels-block-task">${sanitizeText(task)}</span></div>`
        ).join('');
        const moreCount = mergedBlocks.length > FOLD_LIMIT ? mergedBlocks.length - FOLD_LIMIT : 0;

        const cardHTML = `<div class="system-card reels-card" data-post-id="${postId}">
            <div class="reels-header">
                <img class="reels-avatar" src="${profileSrc}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(profileSrc)}','${DEFAULT_PROFILE_SVG}')" alt="">
                <div class="reels-user-info">
                    <div class="reels-username">${sanitizeText(post.userName || '헌터')}${instaLink}${isMe ? ' <span style="color:var(--neon-gold); font-size:0.65rem;">(나)</span>' : ''}</div>
                    <div class="reels-user-meta">Lv.${post.userLevel} ${post.mood ? getMoodEmoji(post.mood) : ''}</div>
                    ${post.location ? `<div class="reels-location">📍 ${sanitizeText(post.location.name)}</div>` : ''}
                </div>
                <div class="reels-time">${formatReelsTime(post.timestamp)}</div>
            </div>
            ${post.photo ? `<div class="reels-photo-container"><img class="reels-photo" src="${sanitizeURL(getThumbnailURL(post.photo))}" onerror="this.onerror=null;if(!this.dataset.fallback){this.dataset.fallback='1';this.src='${sanitizeAttr(post.photo)}';}else{window._retryFirebaseImg(this,'${sanitizeAttr(post.photo)}');}" alt="Timetable"></div>` : ''}
            ${post.caption ? `<div class="reels-caption">${sanitizeText(post.caption).replace(/\n/g,'<br>')}</div>` : ''}
            <div class="reels-timetable">
                <div class="reels-timetable-title" ${moreCount > 0 ? `onclick="toggleScheduleFold('${postId}')" style="cursor:pointer;"` : ''}>
                    📋 ${i18n[lang]?.planner_tab_schedule || '시간표'}
                    ${moreCount > 0 ? `<span class="schedule-fold-icon" data-fold-icon="${postId}">▼</span>` : ''}
                </div>
                ${blockSummary}
                ${moreCount > 0 ? `<div class="reels-block-extra" data-fold-extra="${postId}">${blockExtra}</div>
                <div class="schedule-fold-toggle" onclick="toggleScheduleFold('${postId}')">
                    <span data-fold-label="${postId}">+${moreCount} more</span>
                </div>` : ''}
            </div>
            <div class="reels-actions">
                <button class="reels-like-btn" onclick="toggleReelsLike('${postId}')">${heartOutline}</button><span class="reels-like-count"></span>
                <button class="reels-comment-btn" onclick="toggleCommentsPanel('${postId}')">${commentIcon}</button><span class="reels-comment-count"></span>
                ${!isMe ? `<button class="reels-copy-btn" onclick="window.openCopyPlannerModal('${postId}')" title="${i18n[lang].reels_copy_planner || '플래너 복사'}">${copyIcon}</button>` : ''}
                ${!isMe ? `<button class="reels-report-btn" onclick="toggleReportPost('${postId}')" title="${i18n[lang].reels_report || '신고'}">${reportIcon}<span class="reels-report-label">${i18n[lang].reels_report || '신고'}</span></button>` : ''}
            </div>
            <div class="reels-report-warning" data-report-warning="${postId}" style="display:none;">
                <span class="reels-report-warning-icon">&#9888;</span>
                <span class="reels-report-warning-text">${i18n[lang].reels_report_warning || '이 게시물은 신고가 접수되었습니다. 관리자가 검토 중입니다.'}</span>
            </div>
            <div class="reels-comments-panel">
                <div class="reels-comments-list">
                    <div class="reels-comment-empty">${i18n[lang].reels_comment_empty}</div>
                </div>
                <div class="reels-comment-input-wrap">
                    <input type="text" class="reels-comment-input" placeholder="${i18n[lang].reels_comment_placeholder}" maxlength="200" onkeydown="if(event.key==='Enter'){const inp=this;addReelsComment('${postId}',inp.value);inp.value='';}">
                    <button class="reels-comment-submit" onclick="const inp=this.previousElementSibling;addReelsComment('${postId}',inp.value);inp.value='';">${i18n[lang].reels_comment_post}</button>
                </div>
            </div>
        </div>`;

        // Day1 네이티브 광고 placeholder 삽입 (N번째 포스트 뒤)
        if (postIdx === REELS_NATIVE_AD_POSITION - 1 && posts.length >= REELS_NATIVE_AD_POSITION) {
            return cardHTML + `<div id="native-ad-placeholder-reels" class="native-ad-slot"><span class="ad-loading-text">광고</span></div>`;
        }
        return cardHTML;
    }).join('');

    // 렌더 후 각 포스트의 리액션 데이터 및 신고 상태 로드
    setTimeout(() => {
        posts.forEach(post => {
            const postId = getPostId(post);
            loadReelsReactions(postId).then(data => {
                if (data.likes && data.likes.length > 0) updateLikeUI(postId, data.likes);
                if (data.comments && data.comments.length > 0) renderCommentsSection(postId, data.comments);
            });
            loadReportStatus(postId);
        });
    }, 100);

    return html;
}

function getMoodEmoji(mood) {
    const map = { great: '😄', good: '🙂', neutral: '😐', bad: '😞', terrible: '😫' };
    return map[mood] || '';
}

function formatReelsTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const month = d.getMonth() + 1;
    const date = d.getDate();
    const day = dayNames[d.getDay()];
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${date} (${day}) ${hours}:${minutes}`;
}

// 릴스 리셋 타이머 (업로드 후 24시간 기준)
function updateReelsResetTimer() {
    const timerEl = document.getElementById('reels-reset-timer');
    if (!timerEl) return;

    function update() {
        // 저장된 포스팅 타임스탬프 기반 체크 (로그아웃 후에도 유지)
        const lastPostTs = parseInt(localStorage.getItem('reels_last_post_ts') || '0', 10);
        const now = Date.now();
        const stillCooldown = lastPostTs && (now - lastPostTs) < 24 * 60 * 60 * 1000;
        const postBtn = document.getElementById('btn-reels-post');

        if (stillCooldown) {
            // 업로드 타임스탬프 + 1일 = 다음 업로드 가능 일시 (KST 기준)
            const nextAvailMs = lastPostTs + (24 * 60 * 60 * 1000);
            // KST = UTC+9 → UTC 밀리초에 9시간 더한 뒤 UTC 메서드로 읽기
            const kstNext = new Date(nextAvailMs + 9 * 60 * 60 * 1000);
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
            const m = kstNext.getUTCMonth() + 1;
            const d = kstNext.getUTCDate();
            const dy = dayNames[kstNext.getUTCDay()];
            const h = String(kstNext.getUTCHours()).padStart(2, '0');
            const mi = String(kstNext.getUTCMinutes()).padStart(2, '0');
            timerEl.innerText = `다음 업로드: ${m}/${d} (${dy}) ${h}:${mi}`;
            // 버튼 비활성화 (룰렛 스타일)
            if (postBtn) {
                postBtn.disabled = true;
                postBtn.removeAttribute('data-i18n'); // changeLanguage()가 텍스트 덮어쓰기 방지
                postBtn.textContent = '포스팅 완료';
                postBtn.style.background = '#333';
                postBtn.style.color = '#666';
                postBtn.style.opacity = '0.6';
                postBtn.style.cursor = 'not-allowed';
            }
        } else {
            // 쿨다운 만료 → 타임스탬프 정리
            if (lastPostTs) {
                localStorage.removeItem('reels_last_post_ts');
                localStorage.removeItem('reels_reward_ts');
            }
            timerEl.innerText = `업로드 가능`;
            // 버튼 활성화
            if (postBtn) {
                postBtn.disabled = false;
                postBtn.setAttribute('data-i18n', 'reels_post_btn'); // i18n 속성 복원
                postBtn.textContent = i18n[AppState.currentLang]?.reels_post_btn || 'Day1 포스팅';
                postBtn.style.background = 'var(--neon-gold)';
                postBtn.style.color = '#000';
                postBtn.style.opacity = '1';
                postBtn.style.cursor = 'pointer';
            }
        }
    }
    update();
    // 릴스 탭 활성시 1초마다 업데이트
    if (window._reelsTimerInterval) clearInterval(window._reelsTimerInterval);
    window._reelsTimerInterval = setInterval(() => {
        const reelsActive = document.getElementById('reels').classList.contains('active');
        const diaryActive = document.getElementById('diary').classList.contains('active');
        if (reelsActive || diaryActive) {
            update();
            if (reelsActive) {
                // 24시간 경과 포스트 자동 삭제 체크
                checkReelsReset();
            }
        }
    }, 1000);
}

// 24시간 경과 포스트 자동 삭제 체크 (getReelsData에서 필터링됨)
// _reelsLastMyPostState: 이전 내 포스트 존재 여부 (변경 시에만 피드 갱신)
function checkReelsReset() {
    const reelsData = getReelsData(); // 24h 지난 포스트 자동 필터링
    const myPost = reelsData.posts.find(p => p.uid === (auth.currentUser?.uid));
    const hasMyPost = !!myPost;
    // 내 포스트 상태가 변경된 경우에만 피드 갱신 (매초 호출 방지)
    if (window._reelsLastMyPostState !== undefined && window._reelsLastMyPostState !== hasMyPost) {
        renderReelsFeed();
    }
    window._reelsLastMyPostState = hasMyPost;
}

// ===== 좋아요 / 댓글 기능 =====

// 포스트 고유 ID 생성 (uid + timestamp)
function getPostId(post) {
    return `${post.uid}_${post.timestamp}`;
}

// 좋아요/댓글 데이터 로드
async function loadReelsReactions(postId) {
    try {
        const docSnap = await getDoc(doc(db, "reels_reactions", postId));
        if (docSnap.exists()) return docSnap.data();
    } catch(e) { AppLogger.error('[Reels] 리액션 로드 실패: ' + (e.message || e)); }
    return { likes: [], comments: [] };
}

// 좋아요 토글 (Optimistic UI: 즉시 반영 후 서버 쓰기, 실패 시 롤백)
async function toggleReelsLike(postId) {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const reactRef = doc(db, "reels_reactions", postId);

    // 현재 UI 상태에서 좋아요 목록 추론
    const likeBtn = document.querySelector(`[data-post-id="${postId}"] .reels-like-btn`);
    const isCurrentlyLiked = likeBtn?.classList.contains('liked');
    const likeCountEl = document.querySelector(`[data-post-id="${postId}"] .reels-like-count`);
    const prevCount = parseInt(likeCountEl?.textContent) || 0;

    // Optimistic UI: 즉시 반영
    const optimisticCount = isCurrentlyLiked ? Math.max(0, prevCount - 1) : prevCount + 1;
    if (likeBtn) {
        likeBtn.classList.toggle('liked', !isCurrentlyLiked);
        likeBtn.innerHTML = !isCurrentlyLiked
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#ff3c3c"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    }
    if (likeCountEl) {
        likeCountEl.textContent = formatReactCount(optimisticCount);
    }

    // 서버 쓰기 (백그라운드)
    try {
        const docSnap = await getDoc(reactRef);
        let likes = [];
        let comments = [];
        if (docSnap.exists()) {
            likes = docSnap.data().likes || [];
            comments = docSnap.data().comments || [];
        }
        const existIdx = likes.findIndex(l => l.uid === uid);
        if (existIdx >= 0) {
            likes.splice(existIdx, 1);
        } else {
            likes.push({
                uid: uid,
                name: AppState.user.name || '헌터',
                photoURL: AppState.user.photoURL || null,
                instaId: AppState.user.instaId || '',
                timestamp: Date.now()
            });
        }
        await setDoc(reactRef, { likes, comments }, { merge: true });
        // 서버 결과로 최종 동기화
        updateLikeUI(postId, likes);
    } catch(e) {
        // 실패 시 롤백
        AppLogger.error('[Reels] 좋아요 실패, 롤백: ' + (e.message || e));
        if (likeBtn) {
            likeBtn.classList.toggle('liked', isCurrentlyLiked);
            likeBtn.innerHTML = isCurrentlyLiked
                ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#ff3c3c"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
                : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
        }
        if (likeCountEl) {
            likeCountEl.textContent = formatReactCount(prevCount);
        }
    }
}

// 숫자 포맷 (최대 9999, 이상은 9999+)
function formatReactCount(n) {
    if (!n || n <= 0) return '';
    return n > 9999 ? '9999+' : String(n);
}

// 좋아요 UI 업데이트
function updateLikeUI(postId, likes) {
    const uid = auth.currentUser?.uid;
    const isLiked = likes.some(l => l.uid === uid);
    const likeBtn = document.querySelector(`[data-post-id="${postId}"] .reels-like-btn`);
    const likeCount = document.querySelector(`[data-post-id="${postId}"] .reels-like-count`);
    if (likeBtn) {
        likeBtn.classList.toggle('liked', isLiked);
        likeBtn.innerHTML = isLiked
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#ff3c3c"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    }
    if (likeCount) {
        likeCount.textContent = formatReactCount(likes.length);
    }
}

// 댓글 추가
async function addReelsComment(postId, text) {
    if (!auth.currentUser || !text.trim()) return;
    const uid = auth.currentUser.uid;
    const reactRef = doc(db, "reels_reactions", postId);
    try {
        const docSnap = await getDoc(reactRef);
        let likes = [];
        let comments = [];
        if (docSnap.exists()) {
            likes = docSnap.data().likes || [];
            comments = docSnap.data().comments || [];
        }
        comments.push({
            uid: uid,
            name: AppState.user.name || '헌터',
            photoURL: AppState.user.photoURL || null,
            instaId: AppState.user.instaId || '',
            text: text.trim(),
            timestamp: Date.now()
        });
        await setDoc(reactRef, { likes, comments }, { merge: true });
        // UI 업데이트
        renderCommentsSection(postId, comments);
    } catch(e) { AppLogger.error('[Reels] 댓글 실패: ' + (e.message || e)); }
}

// 댓글 섹션 렌더링
function renderCommentsSection(postId, comments) {
    const lang = AppState.currentLang;
    const container = document.querySelector(`[data-post-id="${postId}"] .reels-comments-list`);
    const countEl = document.querySelector(`[data-post-id="${postId}"] .reels-comment-count`);
    if (!container) return;

    const instaSvgSmall = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16" style="color:#ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;

    if (comments.length === 0) {
        container.innerHTML = `<div class="reels-comment-empty">${i18n[lang].reels_comment_empty}</div>`;
    } else {
        container.innerHTML = comments.map(c => {
            const cPhoto = c.photoURL ? sanitizeURL(c.photoURL) : DEFAULT_PROFILE_SVG;
            const instaBtn = c.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(c.instaId)}', '_blank')" class="reels-comment-insta-btn">${instaSvgSmall}</button>` : '';
            const timeAgo = getTimeAgo(c.timestamp, lang);
            return `<div class="reels-comment-item">
                <img class="reels-comment-avatar" src="${cPhoto}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(cPhoto)}','${DEFAULT_PROFILE_SVG}')" alt="">
                <div class="reels-comment-body">
                    <div class="reels-comment-meta">
                        <span class="reels-comment-name">${sanitizeText(c.name || '헌터')}</span>${instaBtn}
                        <span class="reels-comment-time">${timeAgo}</span>
                    </div>
                    <div class="reels-comment-text">${sanitizeText(c.text).replace(/\n/g,'<br>')}</div>
                </div>
            </div>`;
        }).join('');
    }

    if (countEl) {
        countEl.textContent = formatReactCount(comments.length);
    }
}

// 시간 경과 표시
function getTimeAgo(ts, lang) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return lang === 'ko' ? '방금' : lang === 'ja' ? 'たった今' : 'now';
    if (diff < 3600) {
        const m = Math.floor(diff / 60);
        return lang === 'ko' ? `${m}분 전` : lang === 'ja' ? `${m}分前` : `${m}m`;
    }
    const h = Math.floor(diff / 3600);
    return lang === 'ko' ? `${h}시간 전` : lang === 'ja' ? `${h}時間前` : `${h}h`;
}

// 댓글 토글 (접기/펼치기)
function toggleCommentsPanel(postId) {
    const panel = document.querySelector(`[data-post-id="${postId}"] .reels-comments-panel`);
    if (panel) {
        panel.classList.toggle('open');
    }
}

// ===== 신고 기능 =====

// 신고 토글
async function toggleReportPost(postId) {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const lang = AppState.currentLang;

    const reportRef = doc(db, "post_reports", postId);
    try {
        const docSnap = await getDoc(reportRef);
        let reporters = [];
        if (docSnap.exists()) {
            reporters = docSnap.data().reporters || [];
        }
        const alreadyReported = reporters.some(r => r.uid === uid);

        if (alreadyReported) {
            showToast(i18n[lang].reels_already_reported || '이미 신고한 게시물입니다.');
            return;
        }

        // 객관식 신고 사유 모달 표시
        const reasons = i18n[lang].reels_report_reasons || [
            "혐오/차별적/생명경시/욕설 표현입니다.",
            "스팸홍보/도배입니다.",
            "청소년에게 유해한 내용입니다.",
            "불법정보를 포함하고 있습니다.",
            "음란물입니다.",
            "불쾌한 표현이 있습니다."
        ];
        const title = i18n[lang].reels_report_title || '사유선택';
        const submitText = i18n[lang].reels_report_submit || '신고하기';
        const cancelText = i18n[lang].reels_report_cancel || '취소';

        const reason = await showReportReasonModal(reasons, title, submitText, cancelText, lang);
        if (!reason) return;

        reporters.push({
            uid: uid,
            name: AppState.user.name || '헌터',
            reason: reason,
            timestamp: Date.now()
        });

        await setDoc(reportRef, {
            postId: postId,
            reporters: reporters,
            reportCount: reporters.length,
            lastReportedAt: Date.now()
        }, { merge: true });

        showToast(i18n[lang].reels_reported || '신고가 접수되었습니다.');

        const warningEl = document.querySelector(`[data-report-warning="${postId}"]`);
        if (warningEl) warningEl.style.display = 'flex';

        const reportBtn = document.querySelector(`[data-post-id="${postId}"] .reels-report-btn`);
        if (reportBtn) {
            reportBtn.classList.add('reported');
            reportBtn.disabled = true;
        }
    } catch(e) {
        AppLogger.error('[Reels] 신고 실패: ' + (e.message || e));
        showToast(i18n[lang].reels_report_fail || '신고 처리에 실패했습니다.');
    }
}

// 신고 사유 선택 모달
function showReportReasonModal(reasons, title, submitText, cancelText, lang) {
    return new Promise((resolve) => {
        // 기존 모달 제거
        const existing = document.getElementById('report-reason-modal');
        if (existing) existing.remove();

        // ★ 네이티브 광고 숨김 (모달 위에 겹치지 않도록)
        let _adWasVisible = false;
        if (isNativePlatform && _nativeAdVisible) {
            _adWasVisible = true;
            try {
                const { NativeAd } = window.Capacitor.Plugins;
                if (NativeAd) NativeAd.hideAd();
            } catch (e) { /* 무시 */ }
        }

        const overlay = document.createElement('div');
        overlay.id = 'report-reason-modal';
        overlay.className = 'report-modal-overlay';

        const reasonItems = reasons.map((r, i) => `
            <label class="report-reason-item" for="report-reason-${i}">
                <input type="radio" name="report-reason" id="report-reason-${i}" value="${r}">
                <span class="report-reason-radio"></span>
                <span class="report-reason-text">${r}</span>
            </label>
        `).join('');

        overlay.innerHTML = `
            <div class="report-modal-content">
                <h3 class="report-modal-title">${title}</h3>
                <div class="report-reason-list">
                    ${reasonItems}
                </div>
                <div class="report-modal-actions">
                    <button class="report-modal-btn report-modal-cancel">${cancelText}</button>
                    <button class="report-modal-btn report-modal-submit">${submitText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        const cleanup = (value) => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 200);
            // ★ 네이티브 광고 복원
            if (_adWasVisible && isNativePlatform) {
                try {
                    const { NativeAd } = window.Capacitor.Plugins;
                    if (NativeAd) NativeAd.resumeAd();
                } catch (e) { /* 무시 */ }
            }
            resolve(value);
        };

        overlay.querySelector('.report-modal-cancel').addEventListener('click', () => cleanup(null));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup(null);
        });

        overlay.querySelector('.report-modal-submit').addEventListener('click', () => {
            const selected = overlay.querySelector('input[name="report-reason"]:checked');
            if (!selected) {
                showToast(i18n[lang].reels_report_select_reason || '신고 사유를 선택해주세요.');
                return;
            }
            cleanup(selected.value);
        });
    });
}

// 신고 상태 로드
async function loadReportStatus(postId) {
    try {
        const docSnap = await getDoc(doc(db, "post_reports", postId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            const uid = auth.currentUser?.uid;
            const reporters = data.reporters || [];

            if (reporters.length > 0) {
                const warningEl = document.querySelector(`[data-report-warning="${postId}"]`);
                if (warningEl) warningEl.style.display = 'flex';
            }

            if (reporters.some(r => r.uid === uid)) {
                const reportBtn = document.querySelector(`[data-post-id="${postId}"] .reels-report-btn`);
                if (reportBtn) {
                    reportBtn.classList.add('reported');
                    reportBtn.disabled = true;
                }
            }
        }
    } catch(e) { /* skip */ }
}

// 시간표 폴딩/언폴딩 토글
function toggleScheduleFold(postId) {
    const extra = document.querySelector(`[data-fold-extra="${postId}"]`);
    const icon = document.querySelector(`[data-fold-icon="${postId}"]`);
    const label = document.querySelector(`[data-fold-label="${postId}"]`);
    if (!extra) return;
    const isOpen = extra.classList.toggle('open');
    if (icon) icon.textContent = isOpen ? '▲' : '▼';
    const lang = localStorage.getItem('lang') || 'ko';
    if (label) {
        if (isOpen) {
            label.textContent = lang === 'ko' ? '접기' : lang === 'ja' ? '折りたたむ' : 'Show less';
        } else {
            const count = extra.querySelectorAll('.reels-block-item').length;
            label.textContent = `+${count} more`;
        }
    }
}

// 전역 등록 (onclick에서 호출)
window.toggleReelsLike = toggleReelsLike;
window.addReelsComment = addReelsComment;
window.toggleCommentsPanel = toggleCommentsPanel;
window.toggleScheduleFold = toggleScheduleFold;
window.toggleReportPost = toggleReportPost;

function changeTheme() {
    const light = document.getElementById('theme-toggle').checked;
    document.documentElement.setAttribute('data-theme', light ? 'light' : '');
    localStorage.setItem('theme', light ? 'light' : 'dark');
}

// --- GPS 및 건강 데이터 설정 ---

/** 앱 설정 화면 열기 (Capacitor native → Android 앱 상세 설정) */
function openAppSettings() {
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!isNative) return;

    try {
        // Capacitor Android 환경: 네이티브 브릿지를 통해 앱 설정 화면 호출
        const cap = window.Capacitor;

        // 방법 1: @capacitor/app 플러그인이 설치된 경우
        if (cap.Plugins && cap.Plugins.App && cap.Plugins.App.openUrl) {
            // Android intent URI → 앱 상세 설정 화면
            cap.Plugins.App.openUrl({ url: `package:${cap.config && cap.config.appId ? cap.config.appId : 'com.levelup.reboot'}` });
            return;
        }

        // 방법 2: Capacitor 네이티브 브릿지 직접 호출 (커스텀 플러그인 AppSettings)
        if (cap.toNative) {
            cap.toNative('AppSettings', 'open', { callbackId: 'openSettings' });
            return;
        }

        // 방법 3: 폴백 - Android intent:// scheme
        window.location.href = `intent://settings/app_detail#Intent;scheme=package;S.android.intent.extra.PACKAGE_NAME=com.levelup.reboot;end`;
    } catch (e) {
        if (window.AppLogger) AppLogger.warn('[GPS] Failed to open native settings: ' + e.message);
    }
}

// --- 로그인 시 앱 토글 off + OS 권한 미승인 항목만 순차 요청 ---
async function showPermissionPrompts() {
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!isNative) return;

    const cap = window.Capacitor;
    if (window.AppLogger) AppLogger.info('[PermPrompt] 네이티브 권한 상태 확인 시작');

    // 1) 푸시 알림 — 앱 토글 off + OS 미승인일 때만 요청
    if (!AppState.user.pushEnabled && cap.Plugins && cap.Plugins.PushNotifications) {
        try {
            const { PushNotifications } = cap.Plugins;
            const status = await PushNotifications.checkPermissions();
            if (status.receive !== 'granted') {
                const token = await requestNativePushPermission();
                if (token) {
                    AppState.user.pushEnabled = true;
                    AppState.user.fcmToken = token;
                    document.getElementById('push-toggle').checked = true;
                    const statusDiv = document.getElementById('push-status');
                    statusDiv.style.display = 'flex';
                    statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${i18n[AppState.currentLang].push_on || '푸시 알림 활성화됨'}</span>`;
                    await setupNativePushListeners();
                    saveUserData();
                }
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[PermPrompt] Push check/request error: ' + (e.message || JSON.stringify(e)));
        }
    }

    // 2) GPS 위치 — 앱 토글 off + OS 미승인일 때만 요청
    if (!AppState.user.gpsEnabled && cap.Plugins && cap.Plugins.Geolocation) {
        try {
            const { Geolocation } = cap.Plugins;
            const status = await Geolocation.checkPermissions();
            if (status.location !== 'granted') {
                const permResult = await Geolocation.requestPermissions();
                if (permResult.location !== 'denied') {
                    AppState.user.gpsEnabled = true;
                    document.getElementById('gps-toggle').checked = true;
                    const statusDiv = document.getElementById('gps-status');
                    statusDiv.style.display = 'flex';
                    statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${i18n[AppState.currentLang].gps_on || '위치 권한 활성화됨'}</span>`;
                    saveUserData();
                }
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[PermPrompt] GPS check/request error: ' + (e.message || JSON.stringify(e)));
        }
    }

    // 3) 건강 데이터 — 앱 토글 off일 때만 요청
    if (!AppState.user.syncEnabled) {
        try {
            let fitnessGranted = false;
            const { HealthConnect, GoogleFit } = cap.Plugins || {};

            if (HealthConnect) {
                const availability = await HealthConnect.isAvailable();
                if (availability.available) {
                    fitnessGranted = await requestFitnessScope();
                }
            }
            if (!fitnessGranted && GoogleFit) {
                const availability = await GoogleFit.isAvailable();
                if (availability.available && !availability.hasPermissions) {
                    fitnessGranted = await requestFitnessScope();
                }
            }

            if (fitnessGranted) {
                AppState.user.syncEnabled = true;
                document.getElementById('sync-toggle').checked = true;
                updateStepCountUI(); // 권한 승인 즉시 상태창 UI 반영
                saveUserData();
                syncHealthData(true).then(() => {
                    // 권한 직후 SDK 초기화 지연으로 데이터 조회 실패 시 재시도
                    if (!AppState.user.stepData || AppState.user.stepData.totalSteps === 0) {
                        setTimeout(() => syncHealthData(true), 2000);
                    }
                });
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[PermPrompt] Fitness check/request error: ' + (e.message || JSON.stringify(e)));
        }
    }

    // 4) 카메라 — ISBN 바코드 스캔용
    if (!AppState.user.cameraEnabled) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            stream.getTracks().forEach(track => track.stop());
            AppState.user.cameraEnabled = true;
            saveUserData();
            updateCameraToggleUI();
            if (window.AppLogger) AppLogger.info('[PermPrompt] Camera permission granted');
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[PermPrompt] Camera permission denied or unavailable: ' + (e.message || e));
            updateCameraToggleUI();
        }
    }

    if (window.AppLogger) AppLogger.info('[PermPrompt] 네이티브 권한 확인/요청 완료');
}

async function toggleGPS() {
    const gpsToggle = document.getElementById('gps-toggle');
    const isChecked = gpsToggle.checked;
    const statusDiv = document.getElementById('gps-status');
    const lang = i18n[AppState.currentLang];
    statusDiv.style.display = 'flex';

    if (!isChecked) {
        AppState.user.gpsEnabled = false;
        saveUserData();
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${lang.gps_off || '위치 탐색 중지됨'}</span>`;

        // 네이티브 앱: OS 권한 해제 안내
        const isNativeOff = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        if (isNativeOff) {
            const msg = lang.gps_revoke_confirm || '위치 권한을 완전히 해제하려면 OS 설정에서 권한을 꺼야 합니다.\n앱 설정으로 이동하시겠습니까?';
            if (confirm(msg)) {
                openAppSettings();
            }
        }
        return;
    }

    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    // 네이티브 Capacitor Geolocation 플러그인만 사용 (앱 전용)
    if (!isNative || !window.Capacitor.Plugins || !window.Capacitor.Plugins.Geolocation) {
        statusDiv.innerHTML = `<span style="color:var(--neon-red);">${lang.gps_no_support || '위치 서비스를 지원하지 않는 환경입니다. 앱에서 이용해주세요.'}</span>`;
        gpsToggle.checked = false;
        if (window.AppLogger) AppLogger.warn('[GPS] Native Geolocation plugin not available');
        return;
    }

    const { Geolocation } = window.Capacitor.Plugins;
    statusDiv.innerHTML = `<span style="color:var(--neon-gold);">${lang.gps_searching || '위치 탐색 중...'}</span>`;

    try {
        // 1단계: 네이티브 권한 요청
        const permResult = await Geolocation.requestPermissions();
        if (window.AppLogger) AppLogger.info('[GPS] Native permission result: ' + JSON.stringify(permResult));

        if (permResult.location === 'denied') {
            statusDiv.innerHTML = `<span style="color:var(--neon-red);">${lang.gps_denied || '위치 권한이 거부되었습니다. 설정에서 권한을 허용해주세요.'}</span>`;
            gpsToggle.checked = false;
            const confirmMsg = lang.gps_denied_confirm || '위치 권한이 거부된 상태입니다.\n앱 설정에서 위치 권한을 허용하시겠습니까?';
            if (confirm(confirmMsg)) {
                openAppSettings();
            }
            return;
        }

        // 2단계: 네이티브 위치 획득
        const position = await Geolocation.getCurrentPosition({
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 300000
        });

        if (window.AppLogger) AppLogger.info(`[GPS] Native location: lat=${position.coords.latitude}, lng=${position.coords.longitude}`);
        AppState.user.gpsEnabled = true;
        saveUserData();
        statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${lang.gps_on || '위치 권한 활성화됨'}</span>`;
    } catch (e) {
        if (window.AppLogger) AppLogger.error('[GPS] Native geolocation error: ' + (e.message || JSON.stringify(e)));

        if (e.message && (e.message.includes('denied') || e.message.includes('permission'))) {
            statusDiv.innerHTML = `<span style="color:var(--neon-red);">${lang.gps_denied || '위치 권한이 거부되었습니다. 설정에서 권한을 허용해주세요.'}</span>`;
            gpsToggle.checked = false;
            const confirmMsg = lang.gps_denied_confirm || '위치 권한이 거부된 상태입니다.\n앱 설정에서 위치 권한을 허용하시겠습니까?';
            if (confirm(confirmMsg)) {
                openAppSettings();
            }
            return;
        }

        // 기타 에러 (타임아웃, GPS 신호 없음 등)
        let errMsg = lang.gps_err || '위치 정보 오류';
        if (e.message && e.message.includes('timeout')) {
            errMsg = lang.gps_timeout || '위치 탐색 시간이 초과되었습니다. 다시 시도해주세요.';
        }
        statusDiv.innerHTML = `<span style="color:var(--neon-red);">${errMsg}</span>`;
        gpsToggle.checked = false;
    }
}

async function toggleHealthSync() {
    const toggle = document.getElementById('sync-toggle');
    const statusDiv = document.getElementById('sync-status');
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    if (toggle.checked) {
        // 네이티브 앱 환경 확인
        if (!isNative) {
            toggle.checked = false;
            statusDiv.style.display = 'flex';
            statusDiv.innerHTML = `<span style="color:var(--neon-red);">건강 데이터 동기화는 앱에서만 사용 가능합니다.</span>`;
            return;
        }

        // 네이티브 건강 데이터 권한 요청 (Health Connect / Google Fit SDK)
        statusDiv.style.display = 'flex';
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">건강 데이터 권한 요청 중...</span>`;
        const granted = await requestFitnessScope();
        if (!granted) {
            toggle.checked = false;
            statusDiv.innerHTML = `<span style="color:var(--neon-red);">건강 데이터 권한이 필요합니다.</span>`;
            return;
        }

        AppState.user.syncEnabled = true;
        saveUserData();
        syncHealthData(true);
    } else {
        AppState.user.syncEnabled = false;
        saveUserData();
        updateStepCountUI();
        statusDiv.style.display = 'flex';
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${i18n[AppState.currentLang].sync_off || '동기화 해제됨'}</span>`;

        // 네이티브 앱: OS 권한 해제 안내
        const isNativeOff = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        if (isNativeOff) {
            const lang = i18n[AppState.currentLang];
            const msg = lang.sync_revoke_confirm || '건강 데이터 권한을 완전히 해제하려면 OS 설정에서 권한을 꺼야 합니다.\n앱 설정으로 이동하시겠습니까?';
            if (confirm(msg)) {
                openAppSettings();
            }
        }
    }
}

// --- 카메라 권한 토글 (ISBN 바코드 스캔용) ---
async function toggleCamera() {
    const toggle = document.getElementById('camera-toggle');
    const statusDiv = document.getElementById('camera-status');
    const lang = i18n[AppState.currentLang];
    statusDiv.style.display = 'flex';

    if (toggle.checked) {
        // ON: 카메라 권한 요청
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            stream.getTracks().forEach(track => track.stop());
            AppState.user.cameraEnabled = true;
            saveUserData();
            statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${lang.cam_granted || '카메라 권한 활성화됨'}</span>`;
            if (window.AppLogger) AppLogger.info('[Camera] Permission granted via settings toggle');
        } catch (e) {
            toggle.checked = false;
            AppState.user.cameraEnabled = false;
            saveUserData();
            statusDiv.innerHTML = `<span style="color:var(--neon-red);">${lang.cam_denied || '카메라 권한이 거부되었습니다.'}</span>`;
            if (window.AppLogger) AppLogger.warn('[Camera] Permission denied: ' + (e.message || e));
            const msg = lang.cam_denied_go_settings || '카메라 권한이 거부되었습니다.\n앱 설정에서 카메라 권한을 허용하시겠습니까?';
            if (confirm(msg)) {
                openAppSettings();
            }
        }
    } else {
        // OFF: 앱 설정으로 이동 안내
        AppState.user.cameraEnabled = false;
        saveUserData();
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${lang.cam_off || '카메라 권한 해제됨'}</span>`;

        const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        if (isNative) {
            const msg = lang.cam_revoke_confirm || '카메라 권한을 완전히 해제하려면 OS 설정에서 권한을 꺼야 합니다.\n앱 설정으로 이동하시겠습니까?';
            if (confirm(msg)) {
                openAppSettings();
            }
        }
    }
}

function updateCameraToggleUI() {
    const toggle = document.getElementById('camera-toggle');
    const statusDiv = document.getElementById('camera-status');
    if (!toggle || !statusDiv) return;
    const lang = i18n[AppState.currentLang];
    toggle.checked = AppState.user.cameraEnabled;
    statusDiv.style.display = 'flex';
    if (AppState.user.cameraEnabled) {
        statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${lang.cam_granted || '카메라 권한 활성화됨'}</span>`;
    } else {
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${lang.cam_off || '카메라 권한 해제됨'}</span>`;
    }
}

// 네이티브 건강 데이터 권한 요청 (Health Connect → Google Fit SDK 순서)
async function requestFitnessScope() {
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!isNative) return false;

    try {
        // 1단계: Health Connect 권한 시도
        const { HealthConnect } = window.Capacitor.Plugins;
        if (HealthConnect) {
            const availability = await HealthConnect.isAvailable();
            if (availability.available) {
                await HealthConnect.requestPermissions();
                if (window.AppLogger) AppLogger.info('[HealthConnect] 권한 요청 완료');
                return true;
            }
        }

        // 2단계: Google Fit SDK 권한 시도 (Health Connect 미지원 기기)
        const { GoogleFit } = window.Capacitor.Plugins;
        if (GoogleFit) {
            await GoogleFit.requestPermissions();
            if (window.AppLogger) AppLogger.info('[GoogleFit] 네이티브 권한 요청 완료');
            return true;
        }

        if (window.AppLogger) AppLogger.warn('[Fitness] 네이티브 건강 데이터 플러그인을 찾을 수 없음');
        return false;
    } catch (e) {
        const errCode = String(e.code || (e.error && e.error.code) || '');
        if (errCode === '12501') return false; // 사용자 취소
        AppLogger.error('건강 데이터 권한 요청 실패: ' + (e.message || JSON.stringify(e)));
        return false;
    }
}

/**
 * Health Connect (네이티브)를 통한 걸음 수 조회 시도
 * @returns {number|null} 걸음 수 또는 null (사용 불가 시)
 */
async function tryHealthConnectSteps() {
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!isNative) return null;

    try {
        const { HealthConnect } = window.Capacitor.Plugins;
        if (!HealthConnect) return null;

        // Health Connect SDK 사용 가능 여부 확인
        const availability = await HealthConnect.isAvailable();
        if (!availability.available) {
            if (window.AppLogger) AppLogger.info('[HealthConnect] SDK not available, falling back to Google Fit SDK');
            return null;
        }

        // 걸음 수 조회
        const result = await HealthConnect.getTodaySteps();
        if (result.fallbackToRest) {
            if (window.AppLogger) AppLogger.info('[HealthConnect] Fallback: ' + (result.error || 'unknown'));
            return null;
        }

        if (window.AppLogger) AppLogger.info(`[HealthConnect] Native steps: ${result.steps} (source: ${result.source})`);
        return result.steps;
    } catch (e) {
        if (window.AppLogger) AppLogger.warn('[HealthConnect] Error: ' + (e.message || JSON.stringify(e)));
        return null;
    }
}

/**
 * Google Fit 네이티브 SDK를 통한 걸음 수 조회 시도
 * Health Connect가 사용 불가한 기기에서 Google Fit SDK (History API) 사용
 * @returns {number|null} 걸음 수 또는 null (사용 불가 시)
 */
async function tryGoogleFitNativeSteps() {
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!isNative) return null;

    try {
        const { GoogleFit } = window.Capacitor.Plugins;
        if (!GoogleFit) return null;

        // Google Fit SDK 사용 가능 여부 확인
        const availability = await GoogleFit.isAvailable();
        if (!availability.available || !availability.hasPermissions) {
            if (window.AppLogger) AppLogger.info('[GoogleFit] SDK not available or no permissions, skipping');
            return null;
        }

        // 걸음 수 조회
        const result = await GoogleFit.getTodaySteps();
        if (result.fallbackToRest) {
            if (window.AppLogger) AppLogger.info('[GoogleFit] Fallback: ' + (result.error || 'unknown'));
            return null;
        }

        if (window.AppLogger) AppLogger.info(`[GoogleFit] Native steps: ${result.steps} (source: ${result.source})`);
        return result.steps;
    } catch (e) {
        if (window.AppLogger) AppLogger.warn('[GoogleFit] Native error: ' + (e.message || JSON.stringify(e)));
        return null;
    }
}

async function syncHealthData(showMsg = false) {
    if (!AppState.user.syncEnabled) return;

    const statusDiv = document.getElementById('sync-status');
    if(showMsg) {
        statusDiv.style.display = 'flex';
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">데이터 가져오는 중...</span>`;
    }

    const now = new Date();
    const todayStr = now.toDateString();

    if (!AppState.user.stepData || AppState.user.stepData.date !== todayStr) {
        AppState.user.stepData = { date: todayStr, rewardedSteps: 0, totalSteps: 0 };
    }

    let totalStepsToday = 0;
    let dataSource = 'none';

    // 1단계: Health Connect (네이티브 Android 14+) 시도
    const nativeSteps = await tryHealthConnectSteps();
    if (nativeSteps !== null) {
        totalStepsToday = nativeSteps;
        dataSource = 'health_connect';
    }

    // 2단계: Google Fit 네이티브 SDK 시도 (Health Connect 실패 시)
    if (dataSource === 'none') {
        const fitNativeSteps = await tryGoogleFitNativeSteps();
        if (fitNativeSteps !== null) {
            totalStepsToday = fitNativeSteps;
            dataSource = 'google_fit_native';
        }
    }

    // 네이티브 SDK에서 데이터를 가져오지 못한 경우
    if (dataSource === 'none') {
        if (showMsg) statusDiv.innerHTML = `<span style="color:var(--neon-red);">건강 데이터를 가져올 수 없습니다. 앱 권한을 확인해주세요.</span>`;
        if (window.AppLogger) AppLogger.warn('[Fitness] 네이티브 SDK에서 걸음 수 데이터 조회 실패');
        updateStepCountUI(); // syncEnabled 상태를 UI에 즉시 반영
        return;
    }

    // 실제 총 걸음수 저장
    AppState.user.stepData.totalSteps = totalStepsToday;

    // 걸음수 기반 희귀 호칭 체크
    checkStepRareTitles();

    // 보상 계산
    const unrewardedSteps = totalStepsToday - AppState.user.stepData.rewardedSteps;

    if (unrewardedSteps >= 1000) {
        const rewardChunks = Math.floor(unrewardedSteps / 1000);
        const earnedPoints = rewardChunks * 10;
        const earnedStr = rewardChunks * 0.5;

        AppState.user.points += earnedPoints;
        AppState.user.pendingStats.str += earnedStr;
        AppState.user.stepData.rewardedSteps += (rewardChunks * 1000);

        if (showMsg) {
            const sourceLabel = dataSource === 'health_connect' ? 'Health Connect' : 'Google Fit';
            const _l = i18n[AppState.currentLang] || {};
            const _syncMsg = (_l.sync_complete_msg || '동기화 완료 ({source}): 총 {steps}보').replace('{source}', sourceLabel).replace('{steps}', totalStepsToday.toLocaleString());
            const _rewMsg = (_l.sync_reward_msg || '추가 보상: +{points}P, STR +{str}').replace('{points}', earnedPoints).replace('{str}', earnedStr);
            statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${_syncMsg}<br>${_rewMsg}</span>`;
        }
        updatePointUI();
        drawRadarChart();
    } else {
        if (showMsg) {
            if(totalStepsToday === 0) {
                statusDiv.innerHTML = `<span style="color:var(--neon-gold);">${i18n[AppState.currentLang]?.sync_no_steps || '걸음 수 기록이 없습니다. (0보)'}</span>`;
            } else {
                const sourceLabel = dataSource === 'health_connect' ? 'Health Connect' : 'Google Fit';
                const _l2 = i18n[AppState.currentLang] || {};
                const _syncMsg2 = (_l2.sync_complete_msg || '동기화 완료 ({source}): 총 {steps}보').replace('{source}', sourceLabel).replace('{steps}', totalStepsToday.toLocaleString());
                const _nextMsg = (_l2.sync_next_reward || '다음 보상까지 {n}보 남음').replace('{n}', 1000 - unrewardedSteps);
                statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${_syncMsg2}<br>(${_nextMsg})</span>`;
            }
        }
    }
    saveUserData();
    updateStepCountUI();
}

// --- 걸음수 상태창 UI 업데이트 ---
function updateStepCountUI() {
    const card = document.getElementById('step-count-card');
    if (!card) return;
    const lang = i18n[AppState.currentLang];
    const valueEl = document.getElementById('step-count-value');
    const infoEl = document.getElementById('step-count-info');
    const reqPanel = document.getElementById('step-req-panel');

    // 항상 표시
    card.style.display = '';

    if (!AppState.user.syncEnabled) {
        // 권한 없음 → 설명문 + 제약사항 패널 표시
        valueEl.textContent = '-';
        infoEl.textContent = lang.step_no_perm || '설정에서 피트니스 동기화를 활성화하세요';
        infoEl.style.color = 'var(--neon-red)';

        if (reqPanel) {
            reqPanel.style.display = '';
            const titleEl = document.getElementById('step-req-title');
            const listEl = document.getElementById('step-req-list');
            if (titleEl) titleEl.textContent = lang.step_req_title || '걸음수 연동 필수 조건';
            if (listEl) {
                const googleFitUrl = 'https://play.google.com/store/apps/details?id=com.google.android.apps.fitness';
                const healthConnectUrl = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';
                const req1Text = lang.step_req_1 || 'Google Fit 또는 Health Connect 앱 설치 필요';
                const req1Html = req1Text
                    .replace('Google Fit', `<a href="${googleFitUrl}" target="_blank" style="color:inherit;text-decoration:underline;">Google Fit</a>`)
                    .replace('Health Connect', `<a href="${healthConnectUrl}" target="_blank" style="color:inherit;text-decoration:underline;">Health Connect</a>`);
                const items = [
                    { icon: '📲', html: req1Html },
                    { icon: '⚙️', html: (() => {
                        const req2Text = lang.step_req_2 || '내 정보 → 구글 피트니스 앱 동기화 활성화';
                        const myInfoLabels = ['내 정보', 'My Info', 'マイ情報'];
                        let result = req2Text;
                        for (const label of myInfoLabels) {
                            if (req2Text.includes(label)) {
                                result = req2Text.replace(label, `<a href="javascript:void(0)" onclick="document.querySelectorAll('.view-section').forEach(s=>s.classList.remove('active'));document.getElementById('settings').classList.add('active');document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));" style="color:inherit;text-decoration:underline;">${label}</a>`);
                                break;
                            }
                        }
                        return result;
                    })() },
                    { icon: '🔑', html: lang.step_req_3 || 'Google 계정 로그인 및 활동 권한 허용' },
                    { icon: '🎁', html: lang.step_req_reward || '1,000보마다 +10P & STR +0.5 보상' }
                ];
                listEl.innerHTML = items.map(r =>
                    `<li style="margin-bottom:2px;">${r.icon} ${r.html}</li>`
                ).join('');
            }
        }
        return;
    }

    // 동기화 활성 → 걸음수 표시 (실제 총 걸음수) + 제약사항 패널 숨김
    if (reqPanel) reqPanel.style.display = 'none';
    const totalSteps = AppState.user.stepData?.totalSteps || 0;
    valueEl.textContent = totalSteps.toLocaleString();
    const remaining = 1000 - (totalSteps % 1000);
    infoEl.textContent = (lang.step_next_reward || '다음 보상까지 {n}보 남음').replace('{n}', remaining);
    infoEl.style.color = 'var(--neon-gold)';
}

// --- 푸시 알림 (FCM) ---

/** 앱 토글과 OS 권한 상태 양방향 동기화 — 로그인 시 호출 */
async function syncToggleWithOSPermissions() {
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!isNative) return;

    const cap = window.Capacitor;
    const lang = i18n[AppState.currentLang];
    let changed = false;

    // 1) 푸시 알림: OS 상태와 앱 토글 양방향 동기화
    if (cap.Plugins && cap.Plugins.PushNotifications) {
        try {
            const { PushNotifications } = cap.Plugins;
            const status = await PushNotifications.checkPermissions();
            const osGranted = status.receive === 'granted';

            if (AppState.user.pushEnabled && !osGranted) {
                // OS 차단 → 앱 토글 off
                AppState.user.pushEnabled = false;
                AppState.user.fcmToken = null;
                const pushToggle = document.getElementById('push-toggle');
                if (pushToggle) pushToggle.checked = false;
                const statusDiv = document.getElementById('push-status');
                if (statusDiv) {
                    statusDiv.style.display = 'flex';
                    statusDiv.innerHTML = `<span style="color:var(--text-sub);">${lang.push_off_by_os || 'OS 설정에서 알림이 차단되어 비활성화됨'}</span>`;
                }
                changed = true;
                if (window.AppLogger) AppLogger.info('[SyncPerm] Push disabled: OS permission not granted');
            } else if (!AppState.user.pushEnabled && osGranted) {
                // OS 허용 → 앱 토글 on + 리스너 설정
                const token = await requestNativePushPermission();
                if (token) {
                    AppState.user.pushEnabled = true;
                    AppState.user.fcmToken = token;
                    const pushToggle = document.getElementById('push-toggle');
                    if (pushToggle) pushToggle.checked = true;
                    const statusDiv = document.getElementById('push-status');
                    if (statusDiv) {
                        statusDiv.style.display = 'flex';
                        statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${lang.push_on || '푸시 알림 활성화됨'}</span>`;
                    }
                    await setupNativePushListeners();
                    changed = true;
                    if (window.AppLogger) AppLogger.info('[SyncPerm] Push enabled: OS permission granted');
                }
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[SyncPerm] Push check error: ' + (e.message || JSON.stringify(e)));
        }
    }

    // 2) GPS 위치: OS 상태와 앱 토글 양방향 동기화
    if (cap.Plugins && cap.Plugins.Geolocation) {
        try {
            const { Geolocation } = cap.Plugins;
            const status = await Geolocation.checkPermissions();
            const osGranted = status.location === 'granted';

            if (AppState.user.gpsEnabled && !osGranted) {
                // OS 거부 → 앱 토글 off
                AppState.user.gpsEnabled = false;
                const gpsToggle = document.getElementById('gps-toggle');
                if (gpsToggle) gpsToggle.checked = false;
                const statusDiv = document.getElementById('gps-status');
                if (statusDiv) {
                    statusDiv.style.display = 'flex';
                    statusDiv.innerHTML = `<span style="color:var(--text-sub);">${lang.gps_off_by_os || 'OS 설정에서 위치 권한이 해제되어 비활성화됨'}</span>`;
                }
                changed = true;
                if (window.AppLogger) AppLogger.info('[SyncPerm] GPS disabled: OS permission not granted');
            } else if (!AppState.user.gpsEnabled && osGranted) {
                // OS 허용 → 앱 토글 on
                AppState.user.gpsEnabled = true;
                const gpsToggle = document.getElementById('gps-toggle');
                if (gpsToggle) gpsToggle.checked = true;
                const statusDiv = document.getElementById('gps-status');
                if (statusDiv) {
                    statusDiv.style.display = 'flex';
                    statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${lang.gps_on || '위치 권한 활성화됨'}</span>`;
                }
                changed = true;
                if (window.AppLogger) AppLogger.info('[SyncPerm] GPS enabled: OS permission granted');
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[SyncPerm] GPS check error: ' + (e.message || JSON.stringify(e)));
        }
    }

    // 3) 건강 데이터: OS 상태와 앱 토글 양방향 동기화
    if (cap.Plugins) {
        try {
            let hasPermission = false;
            const { HealthConnect, GoogleFit } = cap.Plugins;

            if (HealthConnect) {
                const availability = await HealthConnect.isAvailable();
                if (availability.available && availability.hasPermissions) {
                    hasPermission = true;
                }
            }
            if (!hasPermission && GoogleFit) {
                const availability = await GoogleFit.isAvailable();
                if (availability.available && availability.hasPermissions) {
                    hasPermission = true;
                }
            }

            if (AppState.user.syncEnabled && !hasPermission) {
                // OS 해제 → 앱 토글 off
                AppState.user.syncEnabled = false;
                const syncToggle = document.getElementById('sync-toggle');
                if (syncToggle) syncToggle.checked = false;
                const statusDiv = document.getElementById('sync-status');
                if (statusDiv) {
                    statusDiv.style.display = 'flex';
                    statusDiv.innerHTML = `<span style="color:var(--text-sub);">${lang.sync_off_by_os || 'OS 설정에서 건강 데이터 권한이 해제되어 비활성화됨'}</span>`;
                }
                changed = true;
                if (window.AppLogger) AppLogger.info('[SyncPerm] Fitness disabled: OS permission not granted');
            } else if (!AppState.user.syncEnabled && hasPermission) {
                // OS 허용 → 앱 토글 on + 데이터 동기화
                AppState.user.syncEnabled = true;
                const syncToggle = document.getElementById('sync-toggle');
                if (syncToggle) syncToggle.checked = true;
                updateStepCountUI(); // 상태창 UI 즉시 반영
                syncHealthData(true);
                changed = true;
                if (window.AppLogger) AppLogger.info('[SyncPerm] Fitness enabled: OS permission granted');
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[SyncPerm] Fitness check error: ' + (e.message || JSON.stringify(e)));
        }
    }

    if (changed) {
        saveUserData();
    }
}

/** 푸시 알림 초기화 — 로그인 후 호출 */
async function initPushNotifications() {
    const pushToggle = document.getElementById('push-toggle');
    if (!pushToggle) return;

    // 저장된 상태 복원
    pushToggle.checked = AppState.user.pushEnabled;

    const statusDiv = document.getElementById('push-status');
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    // 이미 활성화된 상태라면 토큰 갱신 및 메시지 리스너 설정
    if (AppState.user.pushEnabled) {
        if (isNative) {
            await setupNativePushListeners();
        } else {
            await setupWebPushListeners();
        }
        if (statusDiv) {
            statusDiv.style.display = 'flex';
            const lang = i18n[AppState.currentLang];
            statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${lang.push_on || '푸시 알림 활성화됨'}</span>`;
        }
    }
}

/** 푸시 알림 토글 핸들러 */
async function togglePushNotifications() {
    const pushToggle = document.getElementById('push-toggle');
    const isChecked = pushToggle.checked;
    const statusDiv = document.getElementById('push-status');
    const lang = i18n[AppState.currentLang];
    statusDiv.style.display = 'flex';

    if (!isChecked) {
        // 푸시 알림 비활성화
        AppState.user.pushEnabled = false;
        AppState.user.fcmToken = null;
        saveUserData();
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${lang.push_off || '푸시 알림 중지됨'}</span>`;
        if (window.AppLogger) AppLogger.info('[FCM] 푸시 알림 비활성화');

        // 네이티브: 토픽 구독 해제 및 OS 권한 해제 안내
        const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        if (isNative) {
            await unsubscribeNativeTopics();
            const msg = lang.push_revoke_confirm || '알림 권한을 완전히 해제하려면 OS 설정에서 권한을 꺼야 합니다.\n앱 설정으로 이동하시겠습니까?';
            if (confirm(msg)) {
                openAppSettings();
            }
        }
        return;
    }

    // 푸시 알림 활성화 시도
    statusDiv.innerHTML = `<span style="color:var(--neon-gold);">${lang.push_requesting || '알림 권한 요청 중...'}</span>`;

    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    try {
        let token = null;

        if (isNative) {
            token = await requestNativePushPermission();
        } else {
            token = await requestWebPushPermission();
        }

        if (!token) {
            pushToggle.checked = false;
            statusDiv.innerHTML = `<span style="color:var(--neon-red);">${lang.push_denied || '알림 권한이 거부되었습니다.'}</span>`;
            return;
        }

        AppState.user.pushEnabled = true;
        AppState.user.fcmToken = token;
        saveUserData();

        if (window.AppLogger) AppLogger.info('[FCM] 토큰 등록 완료: ' + token.substring(0, 20) + '...');
        statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${lang.push_on || '푸시 알림 활성화됨'}</span>`;

        // 메시지 리스너 설정
        if (isNative) {
            await setupNativePushListeners();
        } else {
            await setupWebPushListeners();
        }
    } catch (e) {
        if (window.AppLogger) AppLogger.error('[FCM] 푸시 알림 설정 실패: ' + (e.message || JSON.stringify(e)));
        pushToggle.checked = false;
        statusDiv.innerHTML = `<span style="color:var(--neon-red);">${lang.push_err || '푸시 알림 설정 실패'}</span>`;
    }
}

/** 네이티브 앱: Capacitor PushNotifications 또는 커스텀 FCMPlugin으로 권한 요청 및 토큰 획득 */
async function requestNativePushPermission() {
    const cap = window.Capacitor;

    // 방법 1: @capacitor/push-notifications 플러그인
    if (cap.Plugins && cap.Plugins.PushNotifications) {
        const { PushNotifications } = cap.Plugins;

        const permResult = await PushNotifications.requestPermissions();
        if (permResult.receive !== 'granted') {
            if (window.AppLogger) AppLogger.warn('[FCM] 네이티브 알림 권한 거부: ' + JSON.stringify(permResult));
            return null;
        }

        // 기존 registration 리스너 제거 후 토큰 수신 대기 (중복 방지)
        await PushNotifications.removeAllListeners();
        return new Promise((resolve, reject) => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (!settled) { settled = true; reject(new Error('FCM 토큰 수신 타임아웃')); }
            }, 15000);

            PushNotifications.addListener('registration', (tokenData) => {
                if (settled) return; // 중복 이벤트 무시
                settled = true;
                clearTimeout(timeout);
                if (window.AppLogger) AppLogger.info('[FCM] 네이티브 토큰 수신: ' + tokenData.value.substring(0, 20) + '...');
                resolve(tokenData.value);
            });

            PushNotifications.addListener('registrationError', (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (window.AppLogger) AppLogger.error('[FCM] 네이티브 등록 실패: ' + JSON.stringify(error));
                reject(new Error(error.error || '등록 실패'));
            });

            PushNotifications.register();
        });
    }

    // 방법 2: 커스텀 FCMPlugin (네이티브 브릿지)
    if (cap.Plugins && cap.Plugins.FCMPlugin) {
        const result = await cap.Plugins.FCMPlugin.getToken();
        return result.token || null;
    }

    // 방법 3: Capacitor 네이티브 브릿지 직접 호출
    if (cap.toNative) {
        return new Promise((resolve, reject) => {
            const callbackId = 'fcm_getToken_' + Date.now();
            cap.toNative('FCMPlugin', 'getToken', { callbackId });
            // 폴백: 5초 후 타임아웃
            setTimeout(() => resolve(null), 5000);
        });
    }

    return null;
}

/** 웹 브라우저: Firebase Messaging으로 권한 요청 및 토큰 획득 */
async function requestWebPushPermission() {
    if (!messaging) {
        if (window.AppLogger) AppLogger.warn('[FCM] Firebase Messaging이 초기화되지 않았습니다.');
        return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        if (window.AppLogger) AppLogger.warn('[FCM] 웹 알림 권한 거부: ' + permission);
        return null;
    }

    // Service Worker 등록 (sw.js 에 FCM 통합)
    let swRegistration = null;
    if ('serviceWorker' in navigator) {
        swRegistration = await navigator.serviceWorker.ready;
        if (window.AppLogger) AppLogger.info('[FCM] Service Worker 준비 완료');
    }

    const token = await getToken(messaging, {
        vapidKey: 'BGAe3k0DShCc20txNmeXM-61AnHWcm7tDBzOvnQQYKJfhok7xROtvcAQjod4Dyd0V9xBEQyQDjpJr1hnwki7YRs',
        serviceWorkerRegistration: swRegistration
    });

    return token || null;
}

/** 네이티브 앱: 포그라운드 메시지 리스너 설정 (중복 호출 방지) */
let _nativePushListenersReady = false;
async function setupNativePushListeners() {
    if (_nativePushListenersReady) {
        if (window.AppLogger) AppLogger.info('[FCM] 리스너 이미 설정됨, 건너뜀');
        return;
    }
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins) return;

    // @capacitor/push-notifications 플러그인 사용
    if (cap.Plugins.PushNotifications) {
        const { PushNotifications } = cap.Plugins;

        // 포그라운드 알림 수신
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            if (window.AppLogger) AppLogger.info('[FCM] 포그라운드 알림 수신: ' + JSON.stringify(notification));
            showInAppNotification(notification.title, notification.body, notification.data);
        });

        // 알림 탭(클릭) 처리 — 앱이 백그라운드 상태일 때
        // 주의: 콜드 스타트용 얼리 리스너(registerEarlyPushListeners)가 이미 등록되어 있으므로
        // 중복 등록하지 않음 (이중 네비게이션 방지)

        // 기본 토픽 구독
        await subscribeNativeTopics();
        _nativePushListenersReady = true;
    }
}

/**
 * 앱 시작 시 즉시 푸시 알림 클릭 리스너 등록 (콜드 스타트 대응)
 * - 앱이 종료된 상태에서 푸시 알림 클릭으로 앱이 실행된 경우,
 *   auth 완료 전에 리스너가 등록되어야 알림 데이터를 놓치지 않음
 * - 앱이 아직 준비되지 않은 경우 _pendingNotificationData에 저장 후
 *   앱 초기화 완료 시 처리
 */
let _pendingNotificationData = null;
let _appNavigationReady = false;

function registerEarlyPushListeners() {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;

    // 콜드 스타트 시 플러그인이 아직 로드되지 않았을 수 있으므로 지연 재시도
    if (!cap.Plugins || !cap.Plugins.PushNotifications) {
        console.log('[FCM] 플러그인 미로드, 300ms 후 재시도');
        setTimeout(() => registerEarlyPushListeners(), 300);
        return;
    }

    const { PushNotifications } = cap.Plugins;

    // 콜드 스타트: 알림 클릭으로 앱이 열린 경우 처리
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        console.log('[FCM] 얼리 리스너 — 알림 클릭 감지:', JSON.stringify(action));
        const data = action.notification?.data;
        if (!data) return;

        if (_appNavigationReady) {
            // 앱이 이미 준비된 경우 바로 네비게이션
            handleNotificationAction(data);
        } else {
            // 앱 초기화 중 — 대기열에 저장
            _pendingNotificationData = data;
            if (window.AppLogger) AppLogger.info('[FCM] 콜드 스타트 알림 데이터 대기: ' + JSON.stringify(data));
        }
    });

    // @capacitor/app 플러그인으로 딥링크 (appUrlOpen) 처리
    if (cap.Plugins.App) {
        cap.Plugins.App.addListener('appUrlOpen', (event) => {
            console.log('[DeepLink] URL 열림:', event.url);
            if (window.AppLogger) AppLogger.info('[DeepLink] appUrlOpen: ' + event.url);

            try {
                const url = new URL(event.url);
                // levelup://tab/quests 또는 levelup://quests 형식 처리
                const pathParts = url.pathname.replace(/^\/+/, '').split('/');
                const tab = url.hostname === 'tab' ? pathParts[0] : url.hostname;

                if (tab) {
                    if (_appNavigationReady) {
                        handleNotificationAction({ tab: tab });
                    } else {
                        _pendingNotificationData = { tab: tab };
                    }
                }
            } catch (e) {
                console.warn('[DeepLink] URL 파싱 실패:', e.message);
            }
        });

        // 앱이 콜드 스타트로 열렸을 때 launch URL 확인
        cap.Plugins.App.getLaunchUrl().then((result) => {
            if (result && result.url) {
                console.log('[DeepLink] 런치 URL:', result.url);
                if (window.AppLogger) AppLogger.info('[DeepLink] getLaunchUrl: ' + result.url);

                try {
                    const url = new URL(result.url);
                    const pathParts = url.pathname.replace(/^\/+/, '').split('/');
                    const tab = url.hostname === 'tab' ? pathParts[0] : url.hostname;

                    if (tab) {
                        if (_appNavigationReady) {
                            // 이미 앱 준비 완료 — 바로 네비게이션
                            handleNotificationAction({ tab: tab });
                        } else {
                            _pendingNotificationData = { tab: tab };
                        }
                    }
                } catch (e) {
                    console.warn('[DeepLink] 런치 URL 파싱 실패:', e.message);
                }
            }
        }).catch(() => {});
    }

    console.log('[FCM] 얼리 푸시 리스너 등록 완료');
}

// --- Android 뒤로가기 버튼 처리 ---
function registerBackButtonHandler() {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
    if (!cap.Plugins || !cap.Plugins.App) return;

    cap.Plugins.App.addListener('backButton', () => {
        // 0) 동적 생성 오버레이 먼저 처리 (book-detail, book-action)
        const dynamicOverlay = document.querySelector('.book-detail-overlay, .book-action-overlay');
        if (dynamicOverlay) {
            dynamicOverlay.remove();
            return;
        }

        // 1) 열린 모달/오버레이가 있으면 닫기
        //    topmost 모달이 배열 앞쪽에 위치하도록 정렬
        //    library-overlay는 맨 뒤로 이동하여 내부 모달이 먼저 닫히도록 함
        const modalIds = [
            'hamburger-menu-popup',
            'isbn-scanner-overlay',
            'book-confirm-overlay',
            'manual-book-overlay',
            'card-select-modal',
            'titleModal',
            'logViewerModal',
            'infoModal',
            'legalModal',
            'diyQuestModal',
            'lootModal',
            'shareModal',
            'copyPlannerModal',
            'location-search-modal',
            'library-overlay'
        ];

        for (const id of modalIds) {
            const el = document.getElementById(id);
            if (!el) continue;
            const isVisible = !el.classList.contains('d-none') &&
                              (el.offsetParent !== null || el.classList.contains('d-flex'));
            if (isVisible) {
                // ISBN 스캐너는 전용 close 함수 호출 (카메라 정리 + 입력 초기화 + 내 서재로 이동)
                if (id === 'isbn-scanner-overlay') {
                    window.closeIsbnScanner();
                    return;
                }
                // 내 서재는 전용 close 함수 호출 (상태창으로 이동)
                if (id === 'library-overlay') {
                    window.closeLibraryView();
                    return;
                }
                el.classList.add('d-none');
                el.classList.remove('d-flex');
                // 햄버거 메뉴 백드롭도 닫기
                if (id === 'hamburger-menu-popup') {
                    const backdrop = document.getElementById('hamburger-backdrop');
                    if (backdrop) backdrop.classList.add('d-none');
                }
                return;
            }
        }

        // 2) 카드 에디터가 열려있으면 닫기
        const cardEditor = document.getElementById('card-editor-fullscreen');
        if (cardEditor && !cardEditor.classList.contains('d-none')) {
            cardEditor.classList.add('d-none');
            return;
        }

        // 3) 현재 탭이 status(홈)가 아니면 홈으로 이동
        const activeSection = document.querySelector('.view-section.active');
        if (activeSection && activeSection.id !== 'status') {
            const statusNav = document.querySelector('.nav-item[onclick*="status"]');
            if (statusNav) {
                switchTab('status', statusNav);
            } else {
                // nav-item을 찾지 못한 경우 직접 전환
                document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
                document.getElementById('status').classList.add('active');
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                const firstNav = document.querySelector('.nav-item');
                if (firstNav) firstNav.classList.add('active');
            }
            return;
        }

        // 4) 이미 홈 탭이면 앱 최소화
        if (cap.Plugins.App.minimizeApp) {
            cap.Plugins.App.minimizeApp();
        }
    });

    console.log('[BackButton] 안드로이드 뒤로가기 버튼 핸들러 등록 완료');
}

/** 앱 초기화 완료 후 대기 중인 알림 데이터 처리 */
function processPendingNotification() {
    _appNavigationReady = true;
    if (_pendingNotificationData) {
        if (window.AppLogger) AppLogger.info('[FCM] 대기 중인 알림 처리: ' + JSON.stringify(_pendingNotificationData));
        // 약간의 지연으로 DOM 렌더링 완료 후 탭 전환
        setTimeout(() => {
            handleNotificationAction(_pendingNotificationData);
            _pendingNotificationData = null;
        }, 500);
    }
}

/** 웹 브라우저: 포그라운드 메시지 리스너 설정 */
async function setupWebPushListeners() {
    if (!messaging) return;

    onMessage(messaging, (payload) => {
        if (window.AppLogger) AppLogger.info('[FCM] 웹 메시지 수신: ' + JSON.stringify(payload));
        showInAppNotification(
            payload.notification?.title || 'LEVEL UP',
            payload.notification?.body || '',
            payload.data
        );
    });
}

/** 네이티브 기본 토픽 구독 (레이드 알림, 일일 리마인더 등) */
async function subscribeNativeTopics() {
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.FCMPlugin) return;

    const topics = ['raid_alerts', 'daily_reminder', 'announcements'];
    for (const topic of topics) {
        try {
            await cap.Plugins.FCMPlugin.subscribeTopic({ topic });
            if (window.AppLogger) AppLogger.info('[FCM] 토픽 구독: ' + topic);
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[FCM] 토픽 구독 실패: ' + topic + ' - ' + e.message);
        }
    }
}

/** 네이티브 토픽 구독 해제 */
async function unsubscribeNativeTopics() {
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.FCMPlugin) return;

    const topics = ['raid_alerts', 'daily_reminder', 'announcements'];
    for (const topic of topics) {
        try {
            await cap.Plugins.FCMPlugin.unsubscribeTopic({ topic });
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[FCM] 토픽 해제 실패: ' + topic);
        }
    }
}

/** 인앱 알림 표시 (포그라운드 수신 시) */
function showInAppNotification(title, body, data) {
    // 기존 알림 배너가 있으면 제거
    const existing = document.getElementById('push-notification-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'push-notification-banner';
    banner.className = 'push-notification-banner';
    banner.innerHTML = `
        <div class="push-noti-content">
            <div class="push-noti-icon">🔔</div>
            <div class="push-noti-text">
                <strong>${sanitizeText(title || 'LEVEL UP')}</strong>
                <span>${sanitizeText(body || '')}</span>
            </div>
            <button class="push-noti-close" onclick="this.closest('.push-notification-banner').remove()">&times;</button>
        </div>
    `;

    // 클릭 시 해당 화면으로 이동
    banner.addEventListener('click', (e) => {
        if (e.target.classList.contains('push-noti-close')) return;
        handleNotificationAction(data);
        banner.remove();
    });

    document.body.appendChild(banner);

    // 5초 후 자동 제거
    setTimeout(() => {
        if (banner.parentNode) {
            banner.classList.add('push-noti-fadeout');
            setTimeout(() => banner.remove(), 300);
        }
    }, 5000);
}

/** 알림 데이터에 따라 해당 탭으로 이동 */
function handleNotificationAction(data, _retryCount) {
    if (!data) return;
    if (window.AppLogger) AppLogger.info('[Navigate] 알림 액션 처리: ' + JSON.stringify(data));

    // 알림 타입에 따른 탭 자동 매핑
    let tab = data.tab || data.target;
    if (!tab && data.type) {
        const typeTabMap = {
            'raid_start': 'dungeon',
            'raid_end': 'dungeon',
            'raid_alert': 'dungeon',
            'quest_reminder': 'quests',
            'daily_reminder': 'diary',
            'social_update': 'social',
            'announcement': 'status'
        };
        tab = typeTabMap[data.type] || 'status';
    }

    if (tab) {
        const tabEl = document.querySelector(`.nav-item[data-tab="${tab}"]`);
        if (tabEl) {
            switchTab(tab, tabEl);
            if (window.AppLogger) AppLogger.info('[Navigate] 탭 이동 완료: ' + tab);
        } else {
            // 콜드 스타트 시 DOM이 아직 렌더링되지 않은 경우 재시도 (최대 3회)
            const retry = _retryCount || 0;
            if (retry < 3) {
                if (window.AppLogger) AppLogger.warn('[Navigate] DOM 미준비, 재시도 ' + (retry + 1) + '/3: ' + tab);
                setTimeout(() => handleNotificationAction(data, retry + 1), 500);
            } else {
                if (window.AppLogger) AppLogger.error('[Navigate] DOM 탭 요소를 찾을 수 없음: ' + tab);
            }
        }
    }
}

// 서비스 워커에서 알림 클릭 시 postMessage로 탭 이동 처리
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
            handleNotificationAction(event.data);
        }
    });
}

// URL 해시 기반 탭 이동 (서비스 워커가 새 창을 열 때 #tab 사용)
window.addEventListener('load', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
        const tabEl = document.querySelector(`.nav-item[data-tab="${hash}"]`);
        if (tabEl) {
            // 약간의 지연으로 앱 초기화 완료 후 탭 전환
            setTimeout(() => switchTab(hash, tabEl), 300);
        }
    }
});

/** XSS 방지용 텍스트 새니타이즈 */
function sanitizeText(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** XSS 방지용 HTML 속성값 새니타이즈 */
function sanitizeAttr(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 인스타그램 ID 검증 (영문, 숫자, 밑줄, 마침표만 허용) */
function sanitizeInstaId(id) {
    if (typeof id !== 'string') return '';
    return id.replace(/[^a-zA-Z0-9._]/g, '');
}

/** URL 새니타이즈 (javascript: 프로토콜 차단) */
function sanitizeURL(url) {
    if (typeof url !== 'string' || !url) return '';
    const trimmed = url.trim().toLowerCase();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:text/html')) return '';
    return sanitizeAttr(url);
}

// ===================== D-DAY 기능 =====================

const DDAY_MAX = 3;

function renderDDayList() {
    const container = document.getElementById('dday-list');
    if (!container) return;
    const ddays = AppState.ddays || [];
    const addBtn = document.getElementById('btn-add-dday');
    if (addBtn) addBtn.style.display = ddays.length >= DDAY_MAX ? 'none' : '';

    if (ddays.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:15px 0; color:var(--text-sub); font-size:0.8rem;">
            D-Day를 추가하여 중요한 날을 관리하세요.
        </div>`;
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    container.innerHTML = ddays.map((dd, idx) => {
        const target = new Date(dd.date);
        target.setHours(0, 0, 0, 0);
        const diffMs = dd.type === 'dday'
            ? target.getTime() - today.getTime()
            : today.getTime() - target.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        let label, color;
        if (dd.type === 'dday') {
            if (diffDays > 0) { label = `D-${diffDays}`; color = 'var(--neon-blue)'; }
            else if (diffDays === 0) { label = 'D-DAY'; color = 'var(--neon-gold)'; }
            else { label = `D+${Math.abs(diffDays)}`; color = 'var(--text-sub)'; }
        } else {
            label = `D+${diffDays}`; color = 'var(--neon-purple)';
        }

        const icon = dd.type === 'dday' ? '📅' : '🔥';
        const typeLabel = dd.type === 'dday' ? 'D-Day' : 'D-Day+';
        const notify = (dd.pushEnabled && dd.type === 'dday') ? '🔔 9:00 AM' : '';

        return `<div class="dday-item" data-idx="${idx}" onclick="openDDayEditModal(${idx})">
            <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                <span style="font-size:1.1rem;">${icon}</span>
                <div style="min-width:0; flex:1;">
                    <div style="font-size:0.85rem; font-weight:bold; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${sanitizeText(dd.title)}</div>
                    <div style="font-size:0.65rem; color:var(--text-sub);">${typeLabel} · ${dd.date} ${notify}</div>
                </div>
            </div>
            <div style="font-size:1.1rem; font-weight:900; color:${color}; white-space:nowrap;">${label}</div>
        </div>`;
    }).join('');
}

function openDDayAddModal() {
    const ddays = AppState.ddays || [];
    if (ddays.length >= DDAY_MAX) {
        alert(`D-Day는 최대 ${DDAY_MAX}개까지 설정할 수 있습니다.`);
        return;
    }
    _openDDayFormModal(-1);
}

function openDDayEditModal(idx) {
    _openDDayFormModal(idx);
}

function _openDDayFormModal(editIdx) {
    const isEdit = editIdx >= 0;
    const dd = isEdit ? AppState.ddays[editIdx] : null;

    const overlay = document.createElement('div');
    overlay.className = 'report-modal-overlay';
    overlay.id = 'dday-modal-overlay';

    const todayStr = new Date().toISOString().split('T')[0];

    const isDDayPlus = isEdit && dd.type === 'ddayplus';
    const pushDisabled = isDDayPlus ? 'disabled' : '';
    const pushChecked = (isEdit && dd.pushEnabled && !isDDayPlus) ? 'checked' : '';

    overlay.innerHTML = `
    <div class="report-modal-content" style="max-width:340px; padding:20px;">
        <div style="font-size:1rem; font-weight:bold; color:var(--neon-blue); margin-bottom:14px;">${isEdit ? 'D-Day 수정' : 'D-Day 추가'}</div>
        <div style="margin-bottom:10px;">
            <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">제목</label>
            <input id="dday-input-title" type="text" maxlength="20" placeholder="예: 시험일, 금연 시작" value="${isEdit ? sanitizeAttr(dd.title) : ''}"
                style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
        </div>
        <div style="margin-bottom:10px;">
            <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">유형</label>
            <div style="display:flex; gap:8px;">
                <button class="dday-type-btn ${(!isEdit || dd.type === 'dday') ? 'active' : ''}" data-type="dday" onclick="selectDDayType('dday')" style="flex:1; padding:8px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.8rem; cursor:pointer;">📅 D-Day</button>
                <button class="dday-type-btn ${isDDayPlus ? 'active' : ''}" data-type="ddayplus" onclick="selectDDayType('ddayplus')" style="flex:1; padding:8px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.8rem; cursor:pointer;">🔥 D-Day+</button>
            </div>
            <div id="dday-type-desc" style="font-size:0.65rem; color:var(--text-sub); margin-top:4px;">${(!isEdit || dd.type === 'dday') ? '목표일까지 남은 날을 카운트합니다.' : '시작일로부터 경과한 날을 카운트합니다.'}</div>
        </div>
        <div style="margin-bottom:10px;">
            <label id="dday-date-label" style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">${isDDayPlus ? '시작 날짜' : '목표 날짜'}</label>
            <input id="dday-input-date" type="date" value="${isEdit ? dd.date : todayStr}"
                style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
        </div>
        <div id="dday-push-row" style="margin-bottom:14px; ${isDDayPlus ? 'opacity:0.4;' : ''}">
            <label style="display:flex; align-items:center; gap:8px; cursor:${isDDayPlus ? 'not-allowed' : 'pointer'};">
                <input id="dday-input-push" type="checkbox" ${pushChecked} ${pushDisabled}>
                <span style="font-size:0.8rem; color:var(--text-main);">🔔 D-Day 당일 오전 9시 푸시 알림</span>
            </label>
        </div>
        <div style="display:flex; gap:8px;">
            ${isEdit ? `<button onclick="deleteDDay(${editIdx})" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--neon-red); background:transparent; color:var(--neon-red); font-size:0.85rem; font-weight:bold; cursor:pointer;">삭제</button>` : ''}
            <button onclick="closeDDayModal()" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--border-color); background:transparent; color:var(--text-sub); font-size:0.85rem; cursor:pointer;">취소</button>
            <button onclick="saveDDayFromModal(${editIdx})" style="flex:1; padding:10px; border-radius:6px; border:none; background:var(--neon-blue); color:#000; font-size:0.85rem; font-weight:bold; cursor:pointer;">${isEdit ? '저장' : '추가'}</button>
        </div>
    </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));
}

function selectDDayType(type) {
    document.querySelectorAll('.dday-type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === type);
    });
    const desc = document.getElementById('dday-type-desc');
    const dateLabel = document.getElementById('dday-date-label');
    const pushRow = document.getElementById('dday-push-row');
    const pushInput = document.getElementById('dday-input-push');
    const isDDayPlus = type === 'ddayplus';

    if (type === 'dday') {
        if (desc) desc.textContent = '목표일까지 남은 날을 카운트합니다.';
        if (dateLabel) dateLabel.textContent = '목표 날짜';
    } else {
        if (desc) desc.textContent = '시작일로부터 경과한 날을 카운트합니다.';
        if (dateLabel) dateLabel.textContent = '시작 날짜';
    }

    // D-Day+는 특정 목표일이 없으므로 푸시 알림 비활성화
    if (pushRow) pushRow.style.opacity = isDDayPlus ? '0.4' : '1';
    if (pushInput) {
        pushInput.disabled = isDDayPlus;
        if (isDDayPlus) pushInput.checked = false;
    }
    const pushLabel = pushRow?.querySelector('label');
    if (pushLabel) pushLabel.style.cursor = isDDayPlus ? 'not-allowed' : 'pointer';
}

function saveDDayFromModal(editIdx) {
    const title = (document.getElementById('dday-input-title')?.value || '').trim();
    const date = document.getElementById('dday-input-date')?.value || '';
    const pushEnabled = document.getElementById('dday-input-push')?.checked || false;
    const typeBtn = document.querySelector('.dday-type-btn.active');
    const type = typeBtn ? typeBtn.dataset.type : 'dday';

    if (!title) { alert('제목을 입력하세요.'); return; }
    if (!date) { alert('날짜를 선택하세요.'); return; }

    if (!AppState.ddays) AppState.ddays = [];

    const entry = { title, date, type, pushEnabled, createdAt: Date.now() };

    if (editIdx >= 0) {
        entry.createdAt = AppState.ddays[editIdx]?.createdAt || Date.now();
        AppState.ddays[editIdx] = entry;
    } else {
        if (AppState.ddays.length >= DDAY_MAX) {
            alert(`D-Day는 최대 ${DDAY_MAX}개까지 설정할 수 있습니다.`);
            return;
        }
        AppState.ddays.push(entry);
    }

    closeDDayModal();
    renderDDayList();
    saveUserData();
    scheduleDDayNotifications();
}

function deleteDDay(idx) {
    if (!confirm('이 D-Day를 삭제하시겠습니까?')) return;
    AppState.ddays.splice(idx, 1);
    closeDDayModal();
    renderDDayList();
    saveUserData();
    scheduleDDayNotifications();
}

function closeDDayModal() {
    const overlay = document.getElementById('dday-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}

// D-Day 로컬 푸시 알림 스케줄링 (D-Day 당일 오전 9시)
async function scheduleDDayNotifications() {
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.LocalNotifications) {
        console.log('[D-Day] LocalNotifications 플러그인 없음, 알림 스케줄 건너뜀');
        return;
    }
    const { LocalNotifications } = cap.Plugins;

    try {
        // Android 알림 채널 생성 (없으면 알림 내용이 표시되지 않음)
        if (cap.getPlatform && cap.getPlatform() === 'android') {
            try {
                await LocalNotifications.createChannel({
                    id: 'dday-notifications',
                    name: 'D-Day 알림',
                    description: 'D-Day 당일 리마인더 알림',
                    importance: 4,
                    sound: 'default',
                    visibility: 1
                });
            } catch (chErr) {
                console.warn('[D-Day] 채널 생성 실패 (무시):', chErr);
            }
        }

        // 기존 D-Day 알림 모두 취소 (ID 범위: 9000~9002)
        const idsToCancel = [{ id: 9000 }, { id: 9001 }, { id: 9002 }];
        await LocalNotifications.cancel({ notifications: idsToCancel });

        const ddays = AppState.ddays || [];
        const notifications = [];
        const now = new Date();

        ddays.forEach((dd, idx) => {
            if (dd.type !== 'dday' || !dd.pushEnabled) return;

            // D-Day 당일 오전 9시
            const scheduleDate = new Date(dd.date + 'T09:00:00');
            if (scheduleDate <= now) return; // 이미 지난 날짜는 스케줄하지 않음

            notifications.push({
                title: '📅 D-Day 알림',
                body: `오늘은 [${dd.title}] D-Day 입니다!`,
                id: 9000 + idx,
                schedule: { at: scheduleDate },
                sound: 'default',
                channelId: 'dday-notifications',
                largeBody: `오늘은 [${dd.title}] D-Day 입니다! 목표를 향해 화이팅!`,
                summaryText: 'D-Day'
            });
        });

        if (notifications.length > 0) {
            const perm = await LocalNotifications.requestPermissions();
            if (perm.display === 'granted') {
                await LocalNotifications.schedule({ notifications });
                console.log(`[D-Day] ${notifications.length}개 알림 스케줄 완료`);
                if (window.AppLogger) AppLogger.info(`[D-Day] ${notifications.length}개 알림 스케줄됨`);
            }
        }
    } catch(e) {
        console.warn('[D-Day] 알림 스케줄 실패:', e);
        if (window.AppLogger) AppLogger.warn('[D-Day] 알림 스케줄 실패: ' + e.message);
    }
}

// D-Day 버튼 이벤트 바인딩
document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('btn-add-dday');
    if (addBtn) addBtn.addEventListener('click', openDDayAddModal);
    const captionCard = document.getElementById('dday-caption-card');
    if (captionCard) captionCard.addEventListener('click', openDDayCaptionEdit);
});

// D-Day 함수들을 window에 노출 (type="module" 대응)
window.openDDayAddModal = openDDayAddModal;
window.openDDayEditModal = openDDayEditModal;
window.selectDDayType = selectDDayType;
window.saveDDayFromModal = saveDDayFromModal;
window.deleteDDay = deleteDDay;
window.closeDDayModal = closeDDayModal;

// ===================== D-DAY 캡션 (목표/좌우명) =====================

function renderDDayCaption() {
    const display = document.getElementById('dday-caption-display');
    if (!display) return;
    const caption = AppState.ddayCaption || '';
    if (caption) {
        display.innerHTML = '<span class="dday-caption-text">' + sanitizeText(caption) + '</span>';
    } else {
        display.innerHTML = '<span class="dday-caption-placeholder">나의 목표 / 좌우명을 입력하세요</span>';
    }
}

function openDDayCaptionEdit() {
    const existing = document.getElementById('dday-caption-modal-overlay');
    if (existing) existing.remove();

    const currentCaption = AppState.ddayCaption || '';
    const overlay = document.createElement('div');
    overlay.id = 'dday-caption-modal-overlay';
    overlay.className = 'report-modal-overlay';
    overlay.innerHTML = `
        <div class="report-modal-content" style="max-width:360px; padding:24px;">
            <h3 style="margin:0 0 16px 0; font-size:1rem; color:var(--neon-blue);">목표 / 좌우명</h3>
            <textarea id="dday-caption-input" class="dday-caption-input-field" maxlength="100" placeholder="나의 목표 또는 좌우명을 입력하세요...">${sanitizeText(currentCaption)}</textarea>
            <div style="font-size:0.7rem; color:var(--text-sub); margin-top:4px; text-align:right;">
                <span id="dday-caption-char-count">${currentCaption.length}</span> / 100
            </div>
            <div style="display:flex; gap:8px; margin-top:16px;">
                <button class="btn-info-sm" style="flex:1; padding:10px;" onclick="window.closeDDayCaptionModal()">취소</button>
                <button class="btn-info-sm" style="flex:1; padding:10px; background:var(--neon-blue); color:#000; font-weight:bold;" onclick="window.saveDDayCaption()">저장</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const input = document.getElementById('dday-caption-input');
    input.focus();
    input.addEventListener('input', function() {
        document.getElementById('dday-caption-char-count').textContent = this.value.length;
    });

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeDDayCaptionModal();
    });
}

function saveDDayCaption() {
    const input = document.getElementById('dday-caption-input');
    if (!input) return;
    AppState.ddayCaption = input.value.trim();
    closeDDayCaptionModal();
    renderDDayCaption();
    saveUserData();
}

function closeDDayCaptionModal() {
    const overlay = document.getElementById('dday-caption-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}

window.openDDayCaptionEdit = openDDayCaptionEdit;
window.saveDDayCaption = saveDDayCaption;
window.closeDDayCaptionModal = closeDDayCaptionModal;
window.renderDDayCaption = renderDDayCaption;

// ===================== LIFE STATUS 기능 =====================

const LIFE_STATUS_STORAGE_KEY = 'life_status_config';

function getLifeStatusConfig() {
    try {
        const raw = localStorage.getItem(LIFE_STATUS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function saveLifeStatusConfig(config) {
    localStorage.setItem(LIFE_STATUS_STORAGE_KEY, JSON.stringify(config));
}

function renderLifeStatus() {
    const container = document.getElementById('life-status-content');
    if (!container) return;

    const config = getLifeStatusConfig();

    if (!config || !config.birthday) {
        container.innerHTML = `<div style="text-align:center; padding:20px 0; color:var(--text-sub); font-size:0.85rem; line-height:1.6;">
            생년월일을 설정하여 나의 인생 현황을 확인하세요.
            <div style="margin-top:6px; font-size:0.75rem;">🔒 저장 시 개인정보 수집에 동의하게 됩니다. 자세한 내용은 [📋 개인정보] 버튼을 확인하세요.</div>
        </div>`;
        return;
    }

    const now = new Date();
    const birth = new Date(config.birthday);
    const expectAge = config.expectAge || 80;

    // 살아온 날
    const daysLived = Math.floor((now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));

    // 현재 나이 (만 나이)
    let currentAge = now.getFullYear() - birth.getFullYear();
    const mDiff = now.getMonth() - birth.getMonth();
    if (mDiff < 0 || (mDiff === 0 && now.getDate() < birth.getDate())) currentAge--;

    // 기대 수명 날짜
    const expectDate = new Date(birth);
    expectDate.setFullYear(expectDate.getFullYear() + expectAge);

    // 남은 시간
    const remainMs = Math.max(0, expectDate.getTime() - now.getTime());
    const remainDays = Math.floor(remainMs / (1000 * 60 * 60 * 24));
    const remainYears = Math.floor(remainDays / 365);
    const remainMonths = Math.floor((remainDays % 365) / 30);

    // 괄호 안 단위 계산
    const remainUnit = config.remainUnit || 'hours';
    let remainDetail = '';
    if (remainUnit === 'hours') {
        remainDetail = `${Math.floor(remainMs / (1000 * 60 * 60)).toLocaleString()}시간`;
    } else if (remainUnit === 'days') {
        remainDetail = `${remainDays.toLocaleString()}일`;
    } else if (remainUnit === 'weeks') {
        remainDetail = `${Math.floor(remainDays / 7).toLocaleString()}주`;
    }

    // 인생 진행률
    const totalDays = Math.floor((expectDate.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
    const progress = Math.min(100, Math.max(0, (daysLived / totalDays) * 100));

    container.innerHTML = `
        <div class="life-status-item">
            <div>
                <div class="ls-label">📅 살아온 날</div>
                <div class="ls-sub">현재 나이: ${currentAge}세</div>
            </div>
            <div class="ls-value blue">${daysLived.toLocaleString()}일</div>
        </div>
        <div class="life-status-item">
            <div>
                <div class="ls-label">⏳ 남은 시간</div>
                <div class="ls-sub">${expectAge}세 기준</div>
            </div>
            <div style="text-align:right;">
                <div class="ls-value gold">${remainYears}년 ${remainMonths}개월</div>
                <div style="font-size:0.75rem; color:var(--neon-blue); margin-top:2px;">(${remainDetail})</div>
            </div>
        </div>
        <div class="life-status-item">
            <div style="width:100%;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="ls-label">📊 인생 진행률 (${expectAge}세)</div>
                    <div class="ls-value gold" style="font-size:1rem;">${progress.toFixed(1)}%</div>
                </div>
                <div class="life-status-progress-bar">
                    <div class="life-status-progress-fill" style="width:${progress.toFixed(1)}%;"></div>
                </div>
            </div>
        </div>`;
}

function openLifeStatusSettings() {
    const config = getLifeStatusConfig() || {};
    const overlay = document.createElement('div');
    overlay.className = 'report-modal-overlay';
    overlay.id = 'life-status-modal-overlay';

    const todayStr = new Date().toISOString().split('T')[0];
    const savedBirthday = config.birthday || '';
    const savedAge = config.expectAge || 80;
    const savedUnit = config.remainUnit || 'hours';

    const ageOptions = [60,65,70,75,80,85,90,95,100].map(a =>
        `<option value="${a}" ${a === savedAge ? 'selected' : ''}>${a}세</option>`
    ).join('');

    const unitOptions = [
        { value: 'hours', label: '시간' },
        { value: 'days', label: '일' },
        { value: 'weeks', label: '주' }
    ].map(u => `<option value="${u.value}" ${u.value === savedUnit ? 'selected' : ''}>${u.label}</option>`).join('');

    overlay.innerHTML = `
    <div class="report-modal-content" style="max-width:340px; padding:20px;">
        <div style="font-size:1rem; font-weight:bold; color:var(--neon-blue); margin-bottom:14px;">Life Status 설정</div>
        <div style="margin-bottom:12px;">
            <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">생년월일</label>
            <input id="ls-input-birthday" type="date" value="${savedBirthday}" max="${todayStr}"
                style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
        </div>
        <div style="margin-bottom:12px;">
            <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">기대 나이</label>
            <select id="ls-input-expect-age"
                style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
                ${ageOptions}
            </select>
        </div>
        <div style="margin-bottom:14px;">
            <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">남은 시간 단위</label>
            <select id="ls-input-remain-unit"
                style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
                ${unitOptions}
            </select>
        </div>
        <div style="font-size:0.65rem; color:var(--text-sub); margin-bottom:10px;">🔒 생년월일은 계정 동기화를 위해 서버에 암호화 저장됩니다.</div>
        <div style="margin-bottom:14px;">
            <label id="ls-consent-checkbox-label" style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.75rem; color:var(--text-main);">
                <input type="checkbox" id="ls-consent-checkbox" ${localStorage.getItem('life_status_privacy_consent') ? 'checked' : ''} style="accent-color:var(--neon-blue); width:16px; height:16px; cursor:pointer;" readonly>
                📋 개인정보 수집 및 이용 동의서
            </label>
        </div>
        <div id="ls-loading-msg" style="display:none; text-align:center; padding:8px 0; font-size:0.8rem; color:var(--neon-blue);">계산 중입니다...</div>
        <div style="display:flex; gap:8px;">
            ${config.birthday ? `<button onclick="resetLifeStatus()" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--neon-red); background:transparent; color:var(--neon-red); font-size:0.85rem; font-weight:bold; cursor:pointer;">초기화</button>` : ''}
            <button onclick="closeLifeStatusModal()" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--border-color); background:transparent; color:var(--text-sub); font-size:0.85rem; cursor:pointer;">취소</button>
            <button onclick="saveLifeStatusFromModal()" style="flex:1; padding:10px; border-radius:6px; border:none; background:var(--neon-blue); color:#000; font-size:0.85rem; font-weight:bold; cursor:pointer;">저장</button>
        </div>
    </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    // 체크박스 클릭 시 동의 모달 호출
    const consentCheckbox = overlay.querySelector('#ls-consent-checkbox');
    if (consentCheckbox) {
        consentCheckbox.addEventListener('click', (e) => {
            e.preventDefault();
            openLifeStatusPrivacyModal();
        });
    }
}

function saveLifeStatusFromModal() {
    const birthday = document.getElementById('ls-input-birthday')?.value || '';
    const expectAge = parseInt(document.getElementById('ls-input-expect-age')?.value) || 80;
    const remainUnit = document.getElementById('ls-input-remain-unit')?.value || 'hours';

    if (!birthday) { alert('생년월일을 입력하세요.'); return; }

    // 개인정보 동의 여부 확인
    const hasConsent = localStorage.getItem('life_status_privacy_consent');
    if (!hasConsent) {
        alert('개인정보 수집 및 이용에 동의해야 저장할 수 있습니다.');
        return;
    }

    _doSaveLifeStatus(birthday, expectAge, remainUnit);
}

function _doSaveLifeStatus(birthday, expectAge, remainUnit) {
    const loadingMsg = document.getElementById('ls-loading-msg');
    let loadingShown = false;

    const loadingTimer = setTimeout(() => {
        if (loadingMsg) { loadingMsg.style.display = 'block'; loadingShown = true; }
    }, 1000);

    requestAnimationFrame(() => {
        saveLifeStatusConfig({ birthday, expectAge, remainUnit });
        renderLifeStatus();
        saveUserData();
        clearTimeout(loadingTimer);

        if (loadingShown) {
            setTimeout(() => closeLifeStatusModal(), 500);
        } else {
            closeLifeStatusModal();
        }
    });
}

function openLifeStatusPrivacyModal(onAgreeCallback) {
    const overlay = document.createElement('div');
    overlay.className = 'report-modal-overlay';
    overlay.id = 'life-status-privacy-overlay';

    overlay.innerHTML = `
    <div class="report-modal-content" style="max-width:380px; padding:20px; max-height:80vh; overflow-y:auto;">
        <div style="font-size:1rem; font-weight:bold; color:var(--neon-blue); margin-bottom:14px;">개인정보 수집 및 이용 동의서</div>

        <div style="font-size:0.78rem; color:var(--text-main); line-height:1.7; margin-bottom:14px;">
            <p style="margin:0 0 10px 0; color:var(--text-sub);">
                LevelUp은 「개인정보 보호법」에 따라 아래와 같이 개인정보를 수집·이용하고자 합니다. 내용을 확인 후 동의 여부를 결정해 주세요.
            </p>

            <table style="width:100%; border-collapse:collapse; font-size:0.75rem; margin-bottom:12px;">
                <thead>
                    <tr style="background:rgba(0,180,255,0.1);">
                        <th style="border:1px solid var(--border-color); padding:8px; text-align:left; color:var(--neon-blue);">항목</th>
                        <th style="border:1px solid var(--border-color); padding:8px; text-align:left; color:var(--neon-blue);">내용</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border:1px solid var(--border-color); padding:8px; color:var(--text-sub); white-space:nowrap;">수집 항목</td>
                        <td style="border:1px solid var(--border-color); padding:8px;">생년월일, 기대 수명 설정값</td>
                    </tr>
                    <tr>
                        <td style="border:1px solid var(--border-color); padding:8px; color:var(--text-sub); white-space:nowrap;">수집 목적</td>
                        <td style="border:1px solid var(--border-color); padding:8px;">Life Status(인생 현황) 기능 제공 및 기기 간 데이터 동기화</td>
                    </tr>
                    <tr>
                        <td style="border:1px solid var(--border-color); padding:8px; color:var(--text-sub); white-space:nowrap;">보유 기간</td>
                        <td style="border:1px solid var(--border-color); padding:8px;">회원 탈퇴 시 또는 이용자가 직접 초기화 시 즉시 파기</td>
                    </tr>
                </tbody>
            </table>

            <div style="background:var(--panel-bg); border:1px solid var(--border-color); border-radius:6px; padding:10px; margin-bottom:12px; font-size:0.72rem; color:var(--text-sub); line-height:1.6;">
                <div style="margin-bottom:4px; font-weight:bold; color:var(--text-main);">안내 사항</div>
                • 수집된 정보는 Firebase 서버에 암호화되어 저장됩니다.<br>
                • 수집된 정보는 위 목적 외 다른 용도로 사용되지 않습니다.<br>
                • 동의를 거부할 수 있으며, 거부 시 Life Status 기능 이용이 제한됩니다.<br>
                • 설정 화면의 [초기화] 버튼으로 언제든지 정보를 삭제하고 동의를 철회할 수 있습니다.
            </div>
        </div>

        <div style="display:flex; gap:8px;">
            <button id="ls-privacy-disagree-btn" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--border-color); background:transparent; color:var(--text-sub); font-size:0.85rem; cursor:pointer;">동의하지 않음</button>
            <button id="ls-privacy-agree-btn" style="flex:1; padding:10px; border-radius:6px; border:none; background:var(--neon-blue); color:#000; font-size:0.85rem; font-weight:bold; cursor:pointer;">동의</button>
        </div>
    </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    overlay.querySelector('#ls-privacy-agree-btn').addEventListener('click', () => {
        localStorage.setItem('life_status_privacy_consent', new Date().toISOString());
        closeLifeStatusPrivacyModal();
        const cb = document.getElementById('ls-consent-checkbox');
        if (cb) cb.checked = true;
        if (typeof onAgreeCallback === 'function') onAgreeCallback();
    });

    overlay.querySelector('#ls-privacy-disagree-btn').addEventListener('click', () => {
        // 동의하지 않음 선택 시 자동 초기화
        localStorage.removeItem(LIFE_STATUS_STORAGE_KEY);
        localStorage.removeItem('life_status_privacy_consent');
        closeLifeStatusPrivacyModal();
        const cb = document.getElementById('ls-consent-checkbox');
        if (cb) cb.checked = false;
        renderLifeStatus();
        saveUserData();
    });
}

function closeLifeStatusPrivacyModal() {
    const overlay = document.getElementById('life-status-privacy-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}

function resetLifeStatus() {
    if (!confirm('Life Status 정보를 초기화하시겠습니까?\n개인정보 수집 동의도 함께 철회됩니다.')) return;
    localStorage.removeItem(LIFE_STATUS_STORAGE_KEY);
    localStorage.removeItem('life_status_privacy_consent');
    closeLifeStatusModal();
    renderLifeStatus();
    saveUserData();
}

function closeLifeStatusModal() {
    const overlay = document.getElementById('life-status-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}

// Life Status 이벤트 바인딩
document.addEventListener('DOMContentLoaded', () => {
    const settingsBtn = document.getElementById('btn-life-status-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', openLifeStatusSettings);
    renderLifeStatus();
});

// Life Status 함수들을 window에 노출
window.openLifeStatusSettings = openLifeStatusSettings;
window.openLifeStatusPrivacyModal = openLifeStatusPrivacyModal;
window.closeLifeStatusPrivacyModal = closeLifeStatusPrivacyModal;
window.saveLifeStatusFromModal = saveLifeStatusFromModal;
window.resetLifeStatus = resetLifeStatus;
window.closeLifeStatusModal = closeLifeStatusModal;
window.renderLifeStatus = renderLifeStatus;

// ===== 뽀모도로 타이머 =====
(function() {
    const POMO_STORAGE_KEY = 'pomo_settings';
    const POMO_CHANNEL_ID = 'pomodoro-notifications';
    const POMO_NOTIF_ID = 7700;

    let pomoState = {
        phase: 'idle', // idle, focus, break, longBreak
        secondsLeft: 0,
        totalSeconds: 0,
        completedSessions: 0,
        intervalId: null,
        isPaused: false
    };

    function getPomoSettings() {
        try {
            const saved = localStorage.getItem(POMO_STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch(e) {}
        return { focusMin: 25, breakMin: 5, longBreakMin: 15 };
    }

    function savePomoSettings(s) {
        localStorage.setItem(POMO_STORAGE_KEY, JSON.stringify(s));
    }

    function updatePomoUI() {
        const display = document.getElementById('pomo-time-display');
        const phaseLabel = document.getElementById('pomo-phase-label');
        const ring = document.getElementById('pomo-progress-ring');
        const startBtn = document.getElementById('pomo-start-btn');
        const container = document.getElementById('pomo-timer-container');
        const sessionCount = document.getElementById('pomo-session-count');
        const lang = i18n[AppState.currentLang] || i18n.ko;

        if (!display) return;

        // Time display
        const min = Math.floor(pomoState.secondsLeft / 60);
        const sec = pomoState.secondsLeft % 60;
        display.textContent = `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;

        // Phase label & color
        const isBreak = pomoState.phase === 'break' || pomoState.phase === 'longBreak';
        if (container) {
            container.classList.toggle('pomo-break', isBreak);
        }

        if (phaseLabel) {
            if (pomoState.phase === 'focus') phaseLabel.textContent = lang.pomo_focus || '집중';
            else if (pomoState.phase === 'break') phaseLabel.textContent = lang.pomo_break || '휴식';
            else if (pomoState.phase === 'longBreak') phaseLabel.textContent = lang.pomo_long_break || '긴 휴식';
            else phaseLabel.textContent = lang.pomo_focus || '집중';
        }

        // Progress ring
        if (ring) {
            const circumference = 2 * Math.PI * 90; // 565.48
            const progress = pomoState.totalSeconds > 0 ? pomoState.secondsLeft / pomoState.totalSeconds : 1;
            ring.setAttribute('stroke-dashoffset', circumference * (1 - progress));
            ring.setAttribute('stroke', isBreak ? 'var(--neon-blue)' : 'var(--neon-red)');
        }

        // Button text
        if (startBtn) {
            const btnSpan = startBtn.querySelector('span');
            if (pomoState.phase === 'idle') {
                btnSpan.textContent = lang.pomo_start || '시작';
            } else if (pomoState.isPaused) {
                btnSpan.textContent = lang.pomo_resume || '재개';
            } else {
                btnSpan.textContent = lang.pomo_pause || '일시정지';
            }
        }

        // Session count
        if (sessionCount) sessionCount.textContent = `${pomoState.completedSessions}/4`;

        // Session dots
        renderPomoDots();
    }

    function renderPomoDots() {
        const dotsContainer = document.getElementById('pomo-session-dots');
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        for (let i = 0; i < 4; i++) {
            const dot = document.createElement('div');
            dot.className = 'pomo-dot';
            if (i < pomoState.completedSessions) dot.classList.add('completed');
            if (i === pomoState.completedSessions && pomoState.phase === 'focus') dot.classList.add('active');
            dotsContainer.appendChild(dot);
        }
    }

    function startPomoPhase(phase) {
        const settings = getPomoSettings();
        pomoState.phase = phase;
        pomoState.isPaused = false;

        if (phase === 'focus') {
            pomoState.totalSeconds = settings.focusMin * 60;
        } else if (phase === 'break') {
            pomoState.totalSeconds = settings.breakMin * 60;
        } else if (phase === 'longBreak') {
            pomoState.totalSeconds = settings.longBreakMin * 60;
        }
        pomoState.secondsLeft = pomoState.totalSeconds;

        // Schedule local notification for when this phase ends
        schedulePomoNotification(phase, pomoState.totalSeconds);

        clearInterval(pomoState.intervalId);
        pomoState.intervalId = setInterval(pomoTick, 1000);
        updatePomoUI();
    }

    function pomoTick() {
        if (pomoState.isPaused) return;

        pomoState.secondsLeft--;
        if (pomoState.secondsLeft <= 0) {
            clearInterval(pomoState.intervalId);
            pomoState.intervalId = null;
            onPhaseComplete();
        }
        updatePomoUI();
    }

    function showPomoCompleteNotification(phase) {
        const lang = i18n[AppState.currentLang] || i18n.ko;
        let title, body;
        if (phase === 'focus') {
            title = lang.pomo_notif_focus_title || '🍅 집중 시간 종료!';
            body = lang.pomo_notif_focus_body || '잘했어요! 휴식 시간입니다.';
        } else if (phase === 'longBreak') {
            title = lang.pomo_notif_done_title || '🎉 뽀모도로 4세트 완료!';
            body = lang.pomo_notif_done_body || '대단해요! 긴 휴식을 가지세요.';
        } else {
            title = lang.pomo_notif_break_title || '⏰ 휴식 종료!';
            body = lang.pomo_notif_break_body || '다시 집중할 시간입니다!';
        }

        // Cancel the scheduled notification since phase already completed
        cancelPomoNotification();

        // Always show in-app banner (works in foreground)
        if (typeof showInAppNotification === 'function') {
            showInAppNotification(title, body, { tab: 'status' });
        }

        // Also fire an immediate local notification for background/lock screen
        try {
            const cap = window.Capacitor;
            if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
                const { LocalNotifications } = cap.Plugins;
                LocalNotifications.schedule({
                    notifications: [{
                        title: title,
                        body: body,
                        id: POMO_NOTIF_ID + 1,
                        channelId: POMO_CHANNEL_ID,
                        sound: 'default',
                        schedule: { at: new Date(Date.now() + 500) }
                    }]
                });
            } else if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(title, { body, icon: '/res/mipmap-xxxhdpi/ic_launcher.png' });
            }
        } catch(e) {
            console.warn('[Pomodoro] 즉시 알림 실패:', e);
        }
    }

    function onPhaseComplete() {
        const completedPhase = pomoState.phase;

        if (pomoState.phase === 'focus') {
            pomoState.completedSessions++;
            playPomoSound();
            showPomoCompleteNotification(completedPhase);

            if (pomoState.completedSessions >= 4) {
                // 4 sessions complete → long break + reward
                grantPomoReward();
                startPomoPhase('longBreak');
            } else {
                startPomoPhase('break');
            }
        } else {
            // Break or long break ended
            playPomoSound();
            showPomoCompleteNotification(completedPhase);
            if (pomoState.phase === 'longBreak') {
                // Full cycle done
                pomoState.completedSessions = 0;
                pomoState.phase = 'idle';
                pomoState.secondsLeft = getPomoSettings().focusMin * 60;
                pomoState.totalSeconds = pomoState.secondsLeft;
                updatePomoUI();
            } else {
                startPomoPhase('focus');
            }
        }
    }

    function playPomoSound() {
        try {
            // Use vibration on mobile
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200, 100, 200]);
            }
        } catch(e) {}
    }

    async function schedulePomoNotification(phase, durationSecs) {
        const cap = window.Capacitor;
        const lang = i18n[AppState.currentLang] || i18n.ko;

        // Native local notification
        if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
            const { LocalNotifications } = cap.Plugins;
            try {
                // Create channel (Android)
                if (cap.getPlatform && cap.getPlatform() === 'android') {
                    try {
                        await LocalNotifications.createChannel({
                            id: POMO_CHANNEL_ID,
                            name: '뽀모도로 알림',
                            description: '뽀모도로 타이머 알림',
                            importance: 4,
                            sound: 'default',
                            visibility: 1
                        });
                    } catch(e) {}
                }

                // Cancel previous pomo notification
                await LocalNotifications.cancel({ notifications: [{ id: POMO_NOTIF_ID }] });

                const scheduleAt = new Date(Date.now() + durationSecs * 1000);
                let title, body;
                if (phase === 'focus') {
                    title = lang.pomo_notif_focus_title || '🍅 집중 시간 종료!';
                    body = lang.pomo_notif_focus_body || '잘했어요! 휴식 시간입니다.';
                } else if (phase === 'longBreak') {
                    title = lang.pomo_notif_done_title || '🎉 뽀모도로 4세트 완료!';
                    body = lang.pomo_notif_done_body || '대단해요! 긴 휴식을 가지세요.';
                } else {
                    title = lang.pomo_notif_break_title || '⏰ 휴식 종료!';
                    body = lang.pomo_notif_break_body || '다시 집중할 시간입니다!';
                }

                const perm = await LocalNotifications.requestPermissions();
                if (perm.display === 'granted') {
                    await LocalNotifications.schedule({
                        notifications: [{
                            title: title,
                            body: body,
                            id: POMO_NOTIF_ID,
                            schedule: { at: scheduleAt },
                            sound: 'default',
                            channelId: POMO_CHANNEL_ID
                        }]
                    });
                }
            } catch(e) {
                console.warn('[Pomodoro] 로컬 알림 스케줄 실패:', e);
            }
            return;
        }

        // Web fallback: Notification API
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                await Notification.requestPermission();
            }
            if (Notification.permission === 'granted') {
                setTimeout(() => {
                    let title, body;
                    if (phase === 'focus') {
                        title = lang.pomo_notif_focus_title || '🍅 집중 시간 종료!';
                        body = lang.pomo_notif_focus_body || '잘했어요! 휴식 시간입니다.';
                    } else if (phase === 'longBreak') {
                        title = lang.pomo_notif_done_title || '🎉 뽀모도로 4세트 완료!';
                        body = lang.pomo_notif_done_body || '대단해요! 긴 휴식을 가지세요.';
                    } else {
                        title = lang.pomo_notif_break_title || '⏰ 휴식 종료!';
                        body = lang.pomo_notif_break_body || '다시 집중할 시간입니다!';
                    }
                    new Notification(title, { body, icon: '/res/mipmap-xxxhdpi/ic_launcher.png' });
                }, durationSecs * 1000);
            }
        }
    }

    async function cancelPomoNotification() {
        const cap = window.Capacitor;
        if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
            try {
                await cap.Plugins.LocalNotifications.cancel({ notifications: [{ id: POMO_NOTIF_ID }] });
            } catch(e) {}
        }
    }

    function grantPomoReward() {
        const lang = i18n[AppState.currentLang] || i18n.ko;
        const todayKST = typeof getTodayKST === 'function' ? getTodayKST() : new Date().toISOString().slice(0, 10);

        // Prevent duplicate reward per day
        if (AppState.user._pomoDoneDate === todayKST) return;
        AppState.user._pomoDoneDate = todayKST;

        // +10P & AGI +0.3
        AppState.user.points = (AppState.user.points || 0) + 10;
        AppState.user.stats.agi = Math.min(100, (AppState.user.stats.agi || 0) + 0.3);

        if (typeof saveUserData === 'function') saveUserData();
        if (typeof updatePointUI === 'function') updatePointUI();
        if (typeof drawRadarChart === 'function') drawRadarChart();

        // Show toast
        const msg = lang.pomo_reward || '4세트 완료: +10P & AGI +0.3';
        if (typeof showToast === 'function') {
            showToast(msg);
        } else {
            alert(msg);
        }
    }

    // Public API
    window.togglePomodoro = function() {
        if (pomoState.phase === 'idle') {
            startPomoPhase('focus');
        } else if (pomoState.isPaused) {
            pomoState.isPaused = false;
            // Re-schedule notification for remaining time
            schedulePomoNotification(pomoState.phase, pomoState.secondsLeft);
            pomoState.intervalId = setInterval(pomoTick, 1000);
            updatePomoUI();
        } else {
            // Pause
            pomoState.isPaused = true;
            clearInterval(pomoState.intervalId);
            pomoState.intervalId = null;
            cancelPomoNotification();
            updatePomoUI();
        }
    };

    window.resetPomodoro = function() {
        clearInterval(pomoState.intervalId);
        pomoState.intervalId = null;
        cancelPomoNotification();
        pomoState.phase = 'idle';
        pomoState.isPaused = false;
        pomoState.completedSessions = 0;
        const settings = getPomoSettings();
        pomoState.secondsLeft = settings.focusMin * 60;
        pomoState.totalSeconds = pomoState.secondsLeft;
        updatePomoUI();
    };

    // Settings modal
    window.openPomoSettings = function() {
        const lang = i18n[AppState.currentLang] || i18n.ko;
        const settings = getPomoSettings();
        const overlay = document.createElement('div');
        overlay.className = 'pomo-settings-overlay';
        overlay.id = 'pomo-settings-overlay';
        overlay.innerHTML = `
            <div class="pomo-settings-modal">
                <h3 style="margin:0 0 16px 0; font-size:1rem; color:var(--neon-red);">${lang.pomo_settings_title || '뽀모도로 설정'}</h3>
                <label><span>${lang.pomo_focus_min || '집중 시간 (분)'}</span><input type="number" id="pomo-set-focus" value="${settings.focusMin}" min="1" max="90"></label>
                <label><span>${lang.pomo_break_min || '휴식 시간 (분)'}</span><input type="number" id="pomo-set-break" value="${settings.breakMin}" min="1" max="30"></label>
                <label><span>${lang.pomo_long_break_min || '긴 휴식 (분)'}</span><input type="number" id="pomo-set-longbreak" value="${settings.longBreakMin}" min="1" max="60"></label>
                <div style="display:flex; gap:8px; margin-top:16px;">
                    <button onclick="window.savePomoSettingsFromModal()" class="btn-primary" style="flex:1; padding:10px; border-radius:8px; background:linear-gradient(135deg, var(--neon-red), #ff6b3c);">${lang.pomo_save || '저장'}</button>
                    <button onclick="window.closePomoSettings()" style="flex:1; padding:10px; border-radius:8px; background:rgba(255,255,255,0.06); border:1px solid var(--border-color); color:var(--text-sub); cursor:pointer;">✕</button>
                </div>
                <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border-color);">
                    <div style="font-size:0.75rem; font-weight:700; color:var(--neon-gold); margin-bottom:8px;">${lang.pomo_guide_title || '사용 방법'}</div>
                    <div style="font-size:0.7rem; color:var(--text-sub); line-height:1.6;">${lang.pomo_guide_body || '1. 시작 버튼을 눌러 집중 타이머를 시작하세요.<br>2. 집중 시간이 끝나면 자동으로 휴식 시간이 시작됩니다.<br>3. 4세트를 완료하면 긴 휴식이 주어집니다.<br>4. 매일 4세트 완료 시 +10P & AGI +0.3 보상!'}</div>
                </div>
            </div>
        `;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) window.closePomoSettings(); });
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
    };

    window.closePomoSettings = function() {
        const overlay = document.getElementById('pomo-settings-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        }
    };

    window.savePomoSettingsFromModal = function() {
        const focusMin = Math.max(1, Math.min(90, parseInt(document.getElementById('pomo-set-focus').value) || 25));
        const breakMin = Math.max(1, Math.min(30, parseInt(document.getElementById('pomo-set-break').value) || 5));
        const longBreakMin = Math.max(1, Math.min(60, parseInt(document.getElementById('pomo-set-longbreak').value) || 15));
        savePomoSettings({ focusMin, breakMin, longBreakMin });
        window.closePomoSettings();
        // If idle, update display with new time
        if (pomoState.phase === 'idle') {
            pomoState.secondsLeft = focusMin * 60;
            pomoState.totalSeconds = focusMin * 60;
            updatePomoUI();
        }
    };

    // Register foreground local notification listener for Pomodoro
    function initPomoLocalNotifListener() {
        try {
            const cap = window.Capacitor;
            if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
                const { LocalNotifications } = cap.Plugins;
                LocalNotifications.addListener('localNotificationReceived', (notification) => {
                    if (notification.id === POMO_NOTIF_ID || notification.id === POMO_NOTIF_ID + 1) {
                        // Show in-app banner when local notification fires while app is in foreground
                        if (typeof showInAppNotification === 'function') {
                            showInAppNotification(notification.title, notification.body, { tab: 'status' });
                        }
                    }
                });
            }
        } catch(e) {
            console.warn('[Pomodoro] 로컬 알림 리스너 등록 실패:', e);
        }
    }

    // Init on DOM ready
    document.addEventListener('DOMContentLoaded', () => {
        const settings = getPomoSettings();
        pomoState.secondsLeft = settings.focusMin * 60;
        pomoState.totalSeconds = settings.focusMin * 60;
        updatePomoUI();

        const settingsBtn = document.getElementById('btn-pomo-settings');
        if (settingsBtn) settingsBtn.addEventListener('click', window.openPomoSettings);

        initPomoLocalNotifListener();
    });
})();

// ════════════════════════════════════════════════════
//  내 서재 (My Library) — ISBN Scanner & Book Management
// ════════════════════════════════════════════════════
(function() {
    let _html5QrCode = null;
    let _pendingBook = null;
    let _ocrInterval = null;
    let _ocrProcessing = false;
    let _ocrWorker = null;
    let _ocrInitFailed = false;

    // ── ISBN Precision Tracking State ──
    var _isbnFragments = [];         // Recent OCR digit fragments for accumulation
    var _lockedCropIndex = -1;       // Region lock-on: locked crop region index (-1 = none)
    var _lockMissCount = 0;          // Consecutive misses since lock
    var _lockSubIndex = 0;           // Sub-index for cycling locked region + neighbors

    function _scannerConfig() {
        return {
            fps: 10,
            qrbox: function(viewfinderWidth, viewfinderHeight) {
                // Barcode-optimized: wide & tall scan area to catch edge-positioned barcodes
                var w = Math.floor(viewfinderWidth * 0.92);
                var h = Math.floor(viewfinderHeight * 0.65);
                if (h < 100) h = 100;
                return { width: w, height: h };
            },
            disableFlip: true,
            formatsToSupport: [
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E
            ],
            experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        };
    }

    // ── OCR Error Correction ──
    function ocrCorrectDigits(text) {
        if (!text) return text;
        // Normalize common OCR misreads of "ISBN" prefix
        var result = text.replace(/[I1l|][S5][B8][Nn]/g, 'ISBN');
        // Replace common letter↔digit confusions in numeric contexts
        // O/o → 0, l/I/| → 1, S/s → 5, B → 8, Z → 2, G → 6, q → 9
        result = result.replace(/(?<=[0-9])([OoQD])(?=[0-9\-\s])/g, '0');
        result = result.replace(/([OoQD])(?=[0-9]{2})/g, '0');
        result = result.replace(/(?<=[0-9])([Il|])(?=[0-9\-\s])/g, '1');
        result = result.replace(/([Il|])(?=[0-9]{2})/g, '1');
        result = result.replace(/(?<=[0-9])([Ss])(?=[0-9\-\s])/g, '5');
        result = result.replace(/(?<=[0-9])([B])(?=[0-9\-\s])/g, '8');
        result = result.replace(/(?<=[0-9])([Z])(?=[0-9\-\s])/g, '2');
        result = result.replace(/(?<=[0-9])([G])(?=[0-9\-\s])/g, '6');
        result = result.replace(/(?<=[0-9])([q])(?=[0-9\-\s])/g, '9');
        return result;
    }

    // ── OCR ISBN Detection (Tesseract.js fallback) ──
    function extractIsbnFromText(text) {
        if (!text) return null;
        // Remove spaces/newlines, normalize
        var cleaned = text.replace(/\s+/g, ' ');
        // Apply OCR error correction
        cleaned = ocrCorrectDigits(cleaned);
        // Normalize partial "ISBN" prefixes (OCR may drop the leading I)
        cleaned = cleaned.replace(/\bSBN\b/g, 'ISBN');
        // Pattern 1: "ISBN" followed by digits (with optional hyphens/spaces)
        var m = cleaned.match(/ISBN[\s:\-]*(?:97[89][\s\-]*(?:\d[\s\-]*){9}\d|\d[\s\-]*(?:\d[\s\-]*){8}[\dXx])/i);
        if (m) {
            var digits = m[0].replace(/[^0-9Xx]/g, '');
            if (digits.length === 13 || digits.length === 10) return digits;
        }
        // Pattern 2: Standalone 13-digit starting with 978/979
        m = cleaned.match(/\b(97[89][\s\-]*(?:\d[\s\-]*){9}\d)\b/);
        if (m) {
            var digits = m[1].replace(/[^0-9]/g, '');
            if (digits.length === 13) return digits;
        }
        // Pattern 3: Hyphenated ISBN pattern like 979-11-5784-629-0
        m = cleaned.match(/\b(\d{3}[\-\s]\d{1,5}[\-\s]\d{1,7}[\-\s]\d{1,7}[\-\s]\d)\b/);
        if (m) {
            var digits = m[1].replace(/[^0-9]/g, '');
            if (digits.length === 13 || digits.length === 10) return digits;
        }
        // Pattern 4: Standalone 10-digit ISBN (less common, last resort)
        m = cleaned.match(/\b(\d{9}[\dXx])\b/);
        if (m) {
            return m[1].replace(/x/i, 'X');
        }
        // Pattern 5: Aggressive — collect all digits near "ISBN"/"SBN" keyword
        // For cases where OCR fragments digits with noise characters
        var isbnIdx = cleaned.search(/ISBN/i);
        if (isbnIdx >= 0) {
            var after = cleaned.substring(isbnIdx + 4);
            var allDigits = after.replace(/[^0-9Xx]/g, '');
            // Try to extract 13-digit or 10-digit ISBN from the collected digits
            if (allDigits.length >= 13) {
                var candidate = allDigits.substring(0, 13);
                if (/^97[89]/.test(candidate)) return candidate;
            }
            if (allDigits.length >= 10) {
                var candidate = allDigits.substring(0, 10);
                return candidate.replace(/x/i, 'X');
            }
        }
        return null;
    }

    // ── ISBN Check Digit Validation ──
    function isValidIsbn13(isbn) {
        if (!isbn || isbn.length !== 13 || !/^\d{13}$/.test(isbn)) return false;
        var sum = 0;
        for (var i = 0; i < 13; i++) {
            sum += parseInt(isbn[i], 10) * (i % 2 === 0 ? 1 : 3);
        }
        return sum % 10 === 0;
    }

    function isValidIsbn10(isbn) {
        if (!isbn || isbn.length !== 10 || !/^\d{9}[\dXx]$/.test(isbn)) return false;
        var sum = 0;
        for (var i = 0; i < 9; i++) {
            sum += parseInt(isbn[i], 10) * (10 - i);
        }
        var last = isbn[9].toUpperCase() === 'X' ? 10 : parseInt(isbn[9], 10);
        sum += last;
        return sum % 11 === 0;
    }

    function isValidIsbn(isbn) {
        if (!isbn) return false;
        if (isbn.length === 13) return isValidIsbn13(isbn);
        if (isbn.length === 10) return isValidIsbn10(isbn);
        return false;
    }

    // ── Single-digit ISBN checksum correction ──
    function tryCorrectIsbn(isbn) {
        if (!isbn) return null;
        var digits = isbn.replace(/[^0-9Xx]/g, '');
        if (digits.length !== 13 && digits.length !== 10) return null;
        // Try substituting each digit position with 0-9
        for (var i = 0; i < digits.length; i++) {
            for (var d = 0; d <= 9; d++) {
                var candidate = digits.substring(0, i) + d + digits.substring(i + 1);
                if (candidate !== digits && isValidIsbn(candidate)) {
                    return candidate;
                }
            }
        }
        return null;
    }

    // ── ISBN-10 to ISBN-13 Conversion ──
    function isbn10to13(isbn10) {
        if (!isbn10 || isbn10.length !== 10) return null;
        var base = '978' + isbn10.substring(0, 9);
        var sum = 0;
        for (var i = 0; i < 12; i++) {
            sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
        }
        var check = (10 - (sum % 10)) % 10;
        return base + check;
    }

    // ── ISBN Candidate Voting System ──
    // Track how many times each ISBN candidate appears across frames
    var _isbnCandidateVotes = {};  // { isbn: { count: N, confidence: totalConf, firstSeen: ts } }
    var _isbnVoteThreshold = 2;   // Require 2+ sightings to accept a candidate

    function voteIsbnCandidate(isbn, confidence) {
        if (!isbn) return null;
        var now = Date.now();
        // Normalize ISBN-10 to ISBN-13 for consistent voting
        var normalizedIsbn = isbn.length === 10 ? isbn10to13(isbn) : isbn;
        if (!normalizedIsbn) normalizedIsbn = isbn;

        if (!_isbnCandidateVotes[normalizedIsbn]) {
            _isbnCandidateVotes[normalizedIsbn] = { count: 0, confidence: 0, firstSeen: now };
        }
        var entry = _isbnCandidateVotes[normalizedIsbn];
        entry.count++;
        entry.confidence += (confidence || 0);

        // Expire old candidates (>12s old with no recent votes)
        var keys = Object.keys(_isbnCandidateVotes);
        for (var i = 0; i < keys.length; i++) {
            if (now - _isbnCandidateVotes[keys[i]].firstSeen > 12000 && _isbnCandidateVotes[keys[i]].count < _isbnVoteThreshold) {
                delete _isbnCandidateVotes[keys[i]];
            }
        }

        // Check if any candidate has reached the vote threshold
        if (entry.count >= _isbnVoteThreshold && isValidIsbn(normalizedIsbn)) {
            if (window.AppLogger) AppLogger.info('[ISBN] Candidate voted in: ' + normalizedIsbn + ' (votes=' + entry.count + ', avgConf=' + Math.round(entry.confidence / entry.count) + '%)');
            return normalizedIsbn;
        }

        // Also check if the original (non-normalized) has high votes
        if (isbn !== normalizedIsbn && _isbnCandidateVotes[isbn] && _isbnCandidateVotes[isbn].count >= _isbnVoteThreshold && isValidIsbn(isbn)) {
            return isbn;
        }

        return null;
    }

    function getBestVotedCandidate() {
        var bestIsbn = null, bestCount = 0;
        var keys = Object.keys(_isbnCandidateVotes);
        for (var i = 0; i < keys.length; i++) {
            var entry = _isbnCandidateVotes[keys[i]];
            if (entry.count > bestCount && isValidIsbn(keys[i])) {
                bestCount = entry.count;
                bestIsbn = keys[i];
            }
        }
        return bestCount >= _isbnVoteThreshold ? bestIsbn : null;
    }

    // ── ISBN Fragment Accumulation ──
    // Accumulate OCR digit fragments across frames and try to reconstruct a full ISBN
    function addIsbnFragment(ocrText) {
        if (!ocrText) return;
        var corrected = ocrCorrectDigits(ocrText);
        // Extract all digit sequences (3+ digits) from the OCR text
        var digitRuns = corrected.match(/\d{3,}/g);
        if (!digitRuns || digitRuns.length === 0) return;

        // Deduplicate: skip if identical to the last fragment (prevents redundant accumulation)
        if (_isbnFragments.length > 0) {
            var lastFrag = _isbnFragments[_isbnFragments.length - 1];
            if (lastFrag.digits.join(',') === digitRuns.join(',')) return;
        }

        _isbnFragments.push({ digits: digitRuns, raw: corrected, time: Date.now() });
        // Keep only last 15 fragments (sliding window ~10.5s at 700ms interval)
        if (_isbnFragments.length > 15) _isbnFragments.shift();

        // Expire fragments older than 10 seconds
        var now = Date.now();
        while (_isbnFragments.length > 0 && now - _isbnFragments[0].time > 10000) {
            _isbnFragments.shift();
        }
    }

    function extractIsbnFromFragments() {
        if (_isbnFragments.length < 2) return null;
        // Collect all digit runs from recent fragments
        var allDigits = '';
        for (var i = 0; i < _isbnFragments.length; i++) {
            allDigits += _isbnFragments[i].digits.join('') + ' ';
        }
        // Also merge all raw corrected text
        var allRaw = '';
        for (var i = 0; i < _isbnFragments.length; i++) {
            allRaw += _isbnFragments[i].raw + ' ';
        }
        // Try extracting ISBN from merged raw text first
        var isbn = extractIsbnFromText(allRaw);
        if (isbn && isValidIsbn(isbn)) return isbn;
        if (isbn) {
            var corrected = tryCorrectIsbn(isbn);
            if (corrected) return corrected;
        }
        // Try building 13-digit ISBN from all accumulated digits
        var pureDigits = allDigits.replace(/[^0-9]/g, '');
        // Search for 978/979 prefix in the digit stream
        for (var start = 0; start <= pureDigits.length - 13; start++) {
            var candidate = pureDigits.substring(start, start + 13);
            if (/^97[89]/.test(candidate) && isValidIsbn13(candidate)) {
                return candidate;
            }
        }
        // Try with single-digit correction
        for (var start = 0; start <= pureDigits.length - 13; start++) {
            var candidate = pureDigits.substring(start, start + 13);
            if (/^97[89]/.test(candidate)) {
                var corrected = tryCorrectIsbn(candidate);
                if (corrected) return corrected;
            }
        }
        return null;
    }

    async function initOcrWorker() {
        if (_ocrWorker) return _ocrWorker;
        if (_ocrInitFailed) return null;
        // Lazy-load Tesseract.js on first OCR use
        if (typeof Tesseract === 'undefined') {
            try {
                if (window.AppLogger) AppLogger.info('[ISBN] Lazy-loading Tesseract.js');
                await new Promise(function(resolve, reject) {
                    var s = document.createElement('script');
                    s.src = 'tesseract.min.js';
                    s.onload = resolve;
                    s.onerror = reject;
                    document.head.appendChild(s);
                });
            } catch(loadErr) {
                if (window.AppLogger) AppLogger.warn('[ISBN] Tesseract.js lazy-load failed');
                _ocrInitFailed = true;
                return null;
            }
        }
        if (typeof Tesseract === 'undefined') {
            if (window.AppLogger) AppLogger.warn('[ISBN] Tesseract.js not available after load');
            _ocrInitFailed = true;
            return null;
        }
        try {
            if (window.AppLogger) AppLogger.info('[ISBN] Initializing OCR worker');
            _ocrWorker = await Tesseract.createWorker('eng', 1, {
                logger: function() {},
                workerPath: 'worker.min.js',
                corePath: 'tesseract-core/',
                langPath: 'tesseract-lang/',
                gzip: false,
                workerBlobURL: false
            });
            await _ocrWorker.setParameters({
                tessedit_pageseg_mode: '11',
                tessedit_char_whitelist: '0123456789ISBNisbn-Xx:. '
            });
            if (window.AppLogger) AppLogger.info('[ISBN] OCR worker ready');
            return _ocrWorker;
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] OCR worker init error', { message: e.message });
            console.warn('OCR worker init error:', e);
            _ocrWorker = null;
            _ocrInitFailed = true;
            stopOcrInterval();
            return null;
        }
    }

    // ── OCR Image Preprocessing (grayscale → sharpen → adaptive binarization → upscale) ──
    function preprocessForOcr(srcCanvas) {
        var w = srcCanvas.width;
        var h = srcCanvas.height;
        var ctx = srcCanvas.getContext('2d');
        var imgData = ctx.getImageData(0, 0, w, h);
        var data = imgData.data;

        // Step 1: Grayscale using max(R,G,B) — better for colored backgrounds
        // Orange bg: R=high → max=high → white; Dark text: all low → max=low → dark
        var histogram = new Array(256).fill(0);
        var minGray = 255, maxGray = 0;
        var graySum = 0;
        for (var i = 0; i < data.length; i += 4) {
            var gray = Math.max(data[i], data[i + 1], data[i + 2]);
            data[i] = data[i + 1] = data[i + 2] = gray;
            graySum += gray;
            if (gray < minGray) minGray = gray;
            if (gray > maxGray) maxGray = gray;
        }

        // Step 1a: Adaptive dark background handling
        // If mean brightness < 100, image is likely white text on dark bg → invert early
        var totalPixels = w * h;
        var meanGray = graySum / totalPixels;
        if (meanGray < 100) {
            for (var i = 0; i < data.length; i += 4) {
                var inv = 255 - data[i];
                data[i] = data[i + 1] = data[i + 2] = inv;
            }
            // Recalc actual min/max from inverted data
            minGray = 255; maxGray = 0;
            for (var i = 0; i < data.length; i += 4) {
                if (data[i] < minGray) minGray = data[i];
                if (data[i] > maxGray) maxGray = data[i];
            }
        }

        // Step 1b: Contrast stretching (normalize gray range to 0-255)
        var grayRange = maxGray - minGray;
        if (grayRange > 0 && grayRange < 200) {
            for (var i = 0; i < data.length; i += 4) {
                var stretched = Math.round(((data[i] - minGray) / grayRange) * 255);
                if (stretched < 0) stretched = 0;
                if (stretched > 255) stretched = 255;
                data[i] = data[i + 1] = data[i + 2] = stretched;
            }
        }

        // Step 1c: Unsharp mask sharpening — sharpens blurry camera text
        // kernel: center = 5, neighbors = -1 (3x3 Laplacian-based unsharp)
        ctx.putImageData(imgData, 0, 0);
        var sharpData = ctx.getImageData(0, 0, w, h);
        var sd = sharpData.data;
        var strength = 0.6; // sharpening strength (0=none, 1=full)
        for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
                var idx = (y * w + x) * 4;
                var center = data[idx];
                var neighbors = data[((y-1)*w+x)*4] + data[((y+1)*w+x)*4] +
                                data[(y*w+x-1)*4] + data[(y*w+x+1)*4];
                var sharp = center + strength * (4 * center - neighbors);
                if (sharp < 0) sharp = 0;
                if (sharp > 255) sharp = 255;
                sd[idx] = sd[idx+1] = sd[idx+2] = Math.round(sharp);
            }
        }
        ctx.putImageData(sharpData, 0, 0);
        imgData = ctx.getImageData(0, 0, w, h);
        data = imgData.data;

        // Recompute histogram after stretching + sharpening
        histogram.fill(0);
        for (var i = 0; i < data.length; i += 4) {
            histogram[data[i]]++;
        }

        // Step 2: Adaptive local thresholding with Otsu fallback
        // Use block-based local thresholding for uneven lighting (shadows, glare)
        var blockSize = Math.max(15, Math.floor(Math.min(w, h) / 8) | 1);
        if (blockSize % 2 === 0) blockSize++;
        var useLocalThreshold = false;

        // Detect uneven lighting: check if std deviation of block means is high
        var blockMeans = [];
        var bStep = Math.max(1, Math.floor(blockSize / 2));
        for (var by = 0; by < h; by += bStep) {
            for (var bx = 0; bx < w; bx += bStep) {
                var bSum = 0, bCount = 0;
                for (var dy = 0; dy < bStep && by + dy < h; dy++) {
                    for (var dx = 0; dx < bStep && bx + dx < w; dx++) {
                        bSum += data[((by+dy)*w+(bx+dx))*4];
                        bCount++;
                    }
                }
                if (bCount > 0) blockMeans.push(bSum / bCount);
            }
        }
        if (blockMeans.length > 4) {
            var bmMean = 0;
            for (var i = 0; i < blockMeans.length; i++) bmMean += blockMeans[i];
            bmMean /= blockMeans.length;
            var bmVar = 0;
            for (var i = 0; i < blockMeans.length; i++) bmVar += (blockMeans[i] - bmMean) * (blockMeans[i] - bmMean);
            var bmStd = Math.sqrt(bmVar / blockMeans.length);
            // High std deviation → uneven lighting → use local thresholding
            useLocalThreshold = bmStd > 35;
        }

        if (useLocalThreshold) {
            // Sauvola-inspired local thresholding
            var halfBlock = Math.floor(blockSize / 2);
            var localResult = new Uint8Array(w * h);
            // Build integral image for fast local mean computation
            var integral = new Float64Array((w + 1) * (h + 1));
            var integralSq = new Float64Array((w + 1) * (h + 1));
            for (var y = 0; y < h; y++) {
                var rowSum = 0, rowSumSq = 0;
                for (var x = 0; x < w; x++) {
                    var v = data[(y * w + x) * 4];
                    rowSum += v;
                    rowSumSq += v * v;
                    integral[(y+1)*(w+1)+(x+1)] = integral[y*(w+1)+(x+1)] + rowSum;
                    integralSq[(y+1)*(w+1)+(x+1)] = integralSq[y*(w+1)+(x+1)] + rowSumSq;
                }
            }
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    var x1 = Math.max(0, x - halfBlock);
                    var y1 = Math.max(0, y - halfBlock);
                    var x2 = Math.min(w - 1, x + halfBlock);
                    var y2 = Math.min(h - 1, y + halfBlock);
                    var area = (x2 - x1 + 1) * (y2 - y1 + 1);
                    var sum = integral[(y2+1)*(w+1)+(x2+1)] - integral[y1*(w+1)+(x2+1)]
                            - integral[(y2+1)*(w+1)+x1] + integral[y1*(w+1)+x1];
                    var sumSq = integralSq[(y2+1)*(w+1)+(x2+1)] - integralSq[y1*(w+1)+(x2+1)]
                              - integralSq[(y2+1)*(w+1)+x1] + integralSq[y1*(w+1)+x1];
                    var localMean = sum / area;
                    var localVar = (sumSq / area) - (localMean * localMean);
                    var localStd = Math.sqrt(Math.max(0, localVar));
                    // Sauvola threshold: T = mean * (1 + k * (std/R - 1)), k=0.2, R=128
                    var threshold = localMean * (1 + 0.2 * (localStd / 128 - 1));
                    localResult[y * w + x] = data[(y * w + x) * 4] >= threshold ? 255 : 0;
                }
            }
            var blackCount = 0;
            for (var i = 0; i < localResult.length; i++) {
                var val = localResult[i];
                data[i*4] = data[i*4+1] = data[i*4+2] = val;
                if (val === 0) blackCount++;
            }
            if (blackCount > totalPixels * 0.6) {
                for (var i = 0; i < data.length; i += 4) {
                    data[i] = data[i+1] = data[i+2] = data[i] === 0 ? 255 : 0;
                }
            }
        } else {
            // Fallback: global Otsu thresholding (uniform lighting)
            var sumAll = 0;
            for (var t = 0; t < 256; t++) sumAll += t * histogram[t];
            var sumBg = 0, weightBg = 0, maxVariance = 0, bestThreshold = 128;
            for (var t = 0; t < 256; t++) {
                weightBg += histogram[t];
                if (weightBg === 0) continue;
                var weightFg = totalPixels - weightBg;
                if (weightFg === 0) break;
                sumBg += t * histogram[t];
                var meanBg = sumBg / weightBg;
                var meanFg = (sumAll - sumBg) / weightFg;
                var variance = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg);
                if (variance > maxVariance) {
                    maxVariance = variance;
                    bestThreshold = t;
                }
            }
            if (bestThreshold < 30) bestThreshold = 30;
            if (bestThreshold > 225) bestThreshold = 225;

            var blackCount = 0;
            for (var i = 0; i < data.length; i += 4) {
                var val = data[i] >= bestThreshold ? 255 : 0;
                data[i] = data[i + 1] = data[i + 2] = val;
                if (val === 0) blackCount++;
            }
            if (blackCount > totalPixels * 0.6) {
                for (var i = 0; i < data.length; i += 4) {
                    data[i] = data[i + 1] = data[i + 2] = data[i] === 0 ? 255 : 0;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // Step 3: Morphological dilation (1px) — thicken thin digit strokes for OCR
        var binData = ctx.getImageData(0, 0, w, h);
        var bd = binData.data;
        var dilated = new Uint8Array(w * h);
        for (var i = 0; i < w * h; i++) dilated[i] = bd[i * 4]; // copy grayscale
        for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
                if (bd[(y * w + x) * 4] === 0) continue; // already white bg, skip
                // If any neighbor is black (text), this pixel becomes black too
                if (bd[((y-1)*w+x)*4] === 0 || bd[((y+1)*w+x)*4] === 0 ||
                    bd[(y*w+x-1)*4] === 0 || bd[(y*w+x+1)*4] === 0) {
                    dilated[y * w + x] = 0;
                }
            }
        }
        for (var i = 0; i < w * h; i++) {
            bd[i*4] = bd[i*4+1] = bd[i*4+2] = dilated[i];
        }
        ctx.putImageData(binData, 0, 0);

        // Step 4: 3x upscale with bilinear interpolation (cap width at 3000px)
        var scale = Math.min(3, 3000 / w);
        var upW = Math.floor(w * scale);
        var upH = Math.floor(h * scale);
        var upCanvas = document.createElement('canvas');
        upCanvas.width = upW;
        upCanvas.height = upH;
        var upCtx = upCanvas.getContext('2d');
        upCtx.imageSmoothingEnabled = true;
        upCtx.imageSmoothingQuality = 'high';
        upCtx.drawImage(srcCanvas, 0, 0, upW, upH);

        // Step 5: Add white border padding (Tesseract struggles with edge-touching text)
        var pad = 10;
        var paddedCanvas = document.createElement('canvas');
        paddedCanvas.width = upW + pad * 2;
        paddedCanvas.height = upH + pad * 2;
        var paddedCtx = paddedCanvas.getContext('2d');
        paddedCtx.fillStyle = '#FFFFFF';
        paddedCtx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
        paddedCtx.drawImage(upCanvas, pad, pad);
        return paddedCanvas;
    }

    // ── Rotate canvas 90° clockwise ──
    function rotateCanvas90CW(srcCanvas) {
        var rotCanvas = document.createElement('canvas');
        rotCanvas.width = srcCanvas.height;
        rotCanvas.height = srcCanvas.width;
        var rotCtx = rotCanvas.getContext('2d');
        rotCtx.translate(rotCanvas.width, 0);
        rotCtx.rotate(Math.PI / 2);
        rotCtx.drawImage(srcCanvas, 0, 0);
        return rotCanvas;
    }

    // ── Rotate canvas 90° counter-clockwise ──
    function rotateCanvas90CCW(srcCanvas) {
        var rotCanvas = document.createElement('canvas');
        rotCanvas.width = srcCanvas.height;
        rotCanvas.height = srcCanvas.width;
        var rotCtx = rotCanvas.getContext('2d');
        rotCtx.translate(0, rotCanvas.height);
        rotCtx.rotate(-Math.PI / 2);
        rotCtx.drawImage(srcCanvas, 0, 0);
        return rotCanvas;
    }

    // ── Rotated Barcode Detection ──
    // Html5Qrcode only detects horizontal barcodes; Korean books often have vertical barcodes
    var _rotatedScanCounter = 0;
    async function tryRotatedBarcodeScan(videoEl) {
        var w = videoEl.videoWidth;
        var h = videoEl.videoHeight;
        if (!w || !h) return null;

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, w, h);

        // Try CW and CCW rotations (skip original — Html5Qrcode live scan handles that)
        var rotations = [
            { canvas: rotateCanvas90CW(canvas), label: '90CW' },
            { canvas: rotateCanvas90CCW(canvas), label: '90CCW' }
        ];

        var scanConfig = {
            formatsToSupport: [
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E
            ]
        };

        for (var ri = 0; ri < rotations.length; ri++) {
            try {
                var rotCanvas = rotations[ri].canvas;
                var blob = await new Promise(function(resolve) {
                    rotCanvas.toBlob(function(b) { resolve(b); }, 'image/jpeg', 0.85);
                });
                if (!blob) continue;
                var file = new File([blob], 'rotated.jpg', { type: 'image/jpeg' });
                var scanner = new Html5Qrcode('isbn-rotated-scan-' + Date.now(), /* verbose= */ false);
                var result = await scanner.scanFileV2(file, /* showImage= */ false, scanConfig);
                scanner.clear();
                if (result && result.decodedText) {
                    var barcode = result.decodedText.replace(/[-\s]/g, '');
                    if (isValidIsbn(barcode)) {
                        if (window.AppLogger) AppLogger.info('[ISBN] Rotated barcode detected (' + rotations[ri].label + '): ' + barcode);
                        return barcode;
                    }
                }
            } catch(e) {
                // scanFileV2 throws when no barcode found — expected, ignore
            }
        }
        return null;
    }

    var _ocrFrameIndex = 0;

    function hasIsbnLikeSignal(text) {
        if (!text) return false;
        var compact = text.replace(/\s+/g, '');
        // e.g. ISBN..., SBN..., or long numeric sequences often seen in OCR output
        if (/I?SBN/i.test(compact)) return true;
        // Lower threshold: 5+ digits is a signal (was 8 — too strict for dark backgrounds)
        var digitCount = (compact.match(/\d/g) || []).length;
        return digitCount >= 5;
    }

    async function ocrCaptureFrame() {
        if (_ocrProcessing) return;
        _ocrProcessing = true;
        try {
            var videoEl = document.querySelector('#isbn-scanner-reader video');
            if (!videoEl || videoEl.readyState < 2) { _ocrProcessing = false; return; }

            var w = videoEl.videoWidth;
            var h = videoEl.videoHeight;

            // ── Rotated barcode detection (every 2nd frame ≈ 1.4s for Korean vertical barcodes) ──
            _rotatedScanCounter++;
            if (_rotatedScanCounter % 2 === 0) {
                var rotatedIsbn = await tryRotatedBarcodeScan(videoEl);
                if (rotatedIsbn) {
                    stopOcrInterval();
                    var statusEl = document.getElementById('isbn-scanner-status');
                    if (statusEl) statusEl.textContent = 'ISBN: ' + rotatedIsbn;
                    var field = document.getElementById('isbn-manual-field');
                    if (field) field.value = rotatedIsbn;
                    try { if (_html5QrCode) await _html5QrCode.stop(); } catch(e) {}
                    _ocrProcessing = false;
                    await onIsbnScanned(rotatedIsbn);
                    return;
                }
            }

            // ── Region selection with lock-on support ──
            var cropY, cropH, cropX, cropW, psmMode, rotation;
            var cropIndex;

            if (_lockedCropIndex >= 0) {
                // Lock-on mode: cycle through locked region + 2 neighbors
                var neighbors = [_lockedCropIndex, (_lockedCropIndex + 1) % 7, (_lockedCropIndex + 6) % 7];
                cropIndex = neighbors[_lockSubIndex % 3];
                _lockSubIndex++;
            } else {
                cropIndex = _ocrFrameIndex % 7;
            }

            // 7 high-yield OCR regions (removed low-yield middle/full-frame regions)
            cropX = 0;
            cropW = w;
            cropY = 0;
            cropH = h;
            rotation = 0; // 0 = none, 1 = 90° CW, -1 = 90° CCW
            if (cropIndex === 0) {
                // Bottom horizontal strip (most common ISBN location)
                cropY = Math.floor(h * 0.78);
                cropH = Math.floor(h * 0.20);
                psmMode = '7';
            } else if (cropIndex === 1) {
                // Center-bottom narrow strip
                cropX = Math.floor(w * 0.20);
                cropW = Math.floor(w * 0.60);
                cropY = Math.floor(h * 0.80);
                cropH = Math.floor(h * 0.16);
                psmMode = '7';
            } else if (cropIndex === 2) {
                // Lower region wider
                cropY = Math.floor(h * 0.72);
                cropH = Math.floor(h * 0.24);
                psmMode = '6';
            } else if (cropIndex === 3) {
                // Right vertical strip (Korean vertical barcodes)
                cropX = Math.floor(w * 0.85);
                cropW = Math.floor(w * 0.15);
                cropY = Math.floor(h * 0.05);
                cropH = Math.floor(h * 0.90);
                rotation = -1;
                psmMode = '6';
            } else if (cropIndex === 4) {
                // Bottom with rotation
                cropY = Math.floor(h * 0.70);
                cropH = Math.floor(h * 0.28);
                rotation = 1;
                psmMode = '6';
            } else if (cropIndex === 5) {
                // Right wider vertical strip
                cropX = Math.floor(w * 0.75);
                cropW = Math.floor(w * 0.25);
                cropY = Math.floor(h * 0.10);
                cropH = Math.floor(h * 0.80);
                rotation = -1;
                psmMode = '7';
            } else {
                // Left vertical strip
                cropX = 0;
                cropW = Math.floor(w * 0.15);
                cropY = Math.floor(h * 0.05);
                cropH = Math.floor(h * 0.90);
                rotation = 1;
                psmMode = '6';
            }
            _ocrFrameIndex++;

            var canvas = document.createElement('canvas');
            canvas.width = cropW;
            canvas.height = cropH;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

            if (rotation === 1) {
                canvas = rotateCanvas90CW(canvas);
            } else if (rotation === -1) {
                canvas = rotateCanvas90CCW(canvas);
            }

            var processed = preprocessForOcr(canvas);

            var worker = await initOcrWorker();
            if (!worker) { _ocrProcessing = false; return; }

            await worker.setParameters({
                tessedit_pageseg_mode: psmMode,
                tessedit_char_whitelist: '0123456789ISBNisbn-Xx:. '
            });

            var result = await worker.recognize(processed);
            var ocrText = result.data.text;
            var confidence = Math.round(result.data.confidence || 0);

            // ── Region lock-on management ──
            var hasSignal = hasIsbnLikeSignal(ocrText);
            if (hasSignal && _lockedCropIndex < 0) {
                _lockedCropIndex = cropIndex;
                _lockMissCount = 0;
                _lockSubIndex = 0;
                if (window.AppLogger) AppLogger.info('[ISBN] Region lock-on: cropIndex=' + cropIndex);
            } else if (hasSignal && _lockedCropIndex >= 0) {
                _lockMissCount = 0;
            } else if (!hasSignal && _lockedCropIndex >= 0) {
                _lockMissCount++;
                if (_lockMissCount >= 5) {
                    if (window.AppLogger) AppLogger.info('[ISBN] Region lock released (5 misses)');
                    _lockedCropIndex = -1;
                    _lockMissCount = 0;
                    _lockSubIndex = 0;
                }
            }

            if (confidence < 8 && !hasSignal) {
                if (window.AppLogger) AppLogger.debug('[ISBN] OCR skipped (low confidence: ' + confidence + '%)');
                _ocrProcessing = false;
                return;
            }

            // ── Fragment accumulation (always, even for low-confidence results with digits) ──
            addIsbnFragment(ocrText);

            var isbn = extractIsbnFromText(ocrText);
            if (window.AppLogger && ocrText && ocrText.trim()) {
                AppLogger.debug('[ISBN] OCR text: ' + ocrText.trim().substring(0, 100), {
                    extractedIsbn: isbn || 'none',
                    confidence: confidence,
                    cropIndex: cropIndex,
                    rotation: rotation || 0,
                    locked: _lockedCropIndex >= 0
                });
            }
            // Try checksum correction if ISBN-like but invalid
            if (isbn && !isValidIsbn(isbn)) {
                var corrected = tryCorrectIsbn(isbn);
                if (corrected) {
                    if (window.AppLogger) AppLogger.info('[ISBN] OCR checksum-corrected: ' + isbn + ' → ' + corrected);
                    isbn = corrected;
                }
            }

            // ── Candidate voting: register valid ISBNs and require 2+ sightings ──
            if (isbn && isValidIsbn(isbn)) {
                var votedIsbn = voteIsbnCandidate(isbn, confidence);
                if (!votedIsbn) {
                    // First sighting — don't act yet, wait for confirmation
                    if (window.AppLogger) AppLogger.debug('[ISBN] Candidate registered (awaiting confirmation): ' + isbn);
                    isbn = null; // suppress immediate action
                } else {
                    isbn = votedIsbn; // Use normalized (ISBN-13) version
                }
            }

            // ── Try fragment accumulation if single-frame extraction failed ──
            if (!isbn || !isValidIsbn(isbn)) {
                var fragIsbn = extractIsbnFromFragments();
                if (fragIsbn) {
                    if (window.AppLogger) AppLogger.info('[ISBN] Fragment accumulation found ISBN: ' + fragIsbn, { fragmentCount: _isbnFragments.length });
                    // Fragment results also go through voting
                    var votedFrag = voteIsbnCandidate(fragIsbn, confidence);
                    isbn = votedFrag || null;
                }
            }

            // ── Check if any candidate has enough votes even without new extraction ──
            if (!isbn) {
                isbn = getBestVotedCandidate();
            }

            if (isbn && isValidIsbn(isbn)) {
                // Normalize ISBN-10 to ISBN-13 for API compatibility
                if (isbn.length === 10) {
                    var isbn13 = isbn10to13(isbn);
                    if (isbn13) {
                        if (window.AppLogger) AppLogger.info('[ISBN] Converted ISBN-10→13: ' + isbn + ' → ' + isbn13);
                        isbn = isbn13;
                    }
                }
                if (window.AppLogger) AppLogger.info('[ISBN] OCR detected valid ISBN: ' + isbn);
                stopOcrInterval();
                var statusEl = document.getElementById('isbn-scanner-status');
                if (statusEl) statusEl.textContent = 'ISBN (OCR): ' + isbn;
                var field = document.getElementById('isbn-manual-field');
                if (field) field.value = isbn;
                try { if (_html5QrCode) await _html5QrCode.stop(); } catch(e) {}
                await onIsbnScanned(isbn);
            } else if (isbn) {
                if (window.AppLogger) AppLogger.debug('[ISBN] OCR found ISBN-like but invalid checksum: ' + isbn);
            }
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] OCR frame error', { message: e.message });
            console.warn('OCR frame error:', e);
        }
        _ocrProcessing = false;
    }

    let _ocrDelayTimer = null;

    function startOcrInterval() {
        stopOcrInterval();
        _ocrInitFailed = false;
        // Reset precision tracking state
        _isbnFragments = [];
        _lockedCropIndex = -1;
        _lockMissCount = 0;
        _lockSubIndex = 0;
        _rotatedScanCounter = 0;
        _isbnCandidateVotes = {};
        // Delay OCR start: barcode scanner is primary, OCR is fallback after a short delay
        _ocrDelayTimer = setTimeout(function() {
            _ocrDelayTimer = null;
            _ocrFrameIndex = 0;
            if (window.AppLogger) AppLogger.info('[ISBN] OCR fallback starting (barcode not detected)');
            _ocrInterval = setInterval(ocrCaptureFrame, 500);
        }, 1200);
    }

    function stopOcrInterval() {
        if (_ocrDelayTimer) { clearTimeout(_ocrDelayTimer); _ocrDelayTimer = null; }
        if (_ocrInterval) { clearInterval(_ocrInterval); _ocrInterval = null; }
        // Clear tracking state on stop
        _isbnFragments = [];
        _lockedCropIndex = -1;
        _lockMissCount = 0;
        _lockSubIndex = 0;
        _isbnCandidateVotes = {};
    }
    let _libCurrentTab = 'reading';
    let _libCurrentPeriod = 'total';
    let _libCurrentView = 'tower';
    let _libSearchQuery = '';
    let _libLocalSearch = false;  // false = API search, true = local filter
    let _libSelectedYear = new Date().getFullYear();
    let _libSelectedMonth = new Date().getMonth() + 1; // 1-12
    let _libDatePickerMode = 'yearly'; // 'yearly' or 'monthly'
    let _libPickerYear = new Date().getFullYear();
    let _libPickerMonth = new Date().getMonth() + 1;
    let _apiSearchTimer = null;
    let _apiSearchPage = 1;
    let _apiSearchHasMore = false;
    let _apiSearchQuery = '';
    let _apiSearchResults = [];

    function t(key) {
        const lang = AppState.currentLang || 'ko';
        return (i18n[lang] && i18n[lang][key]) || (i18n.ko && i18n.ko[key]) || key;
    }

    function getTodayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }

    // ── Library Card Count (status screen) — 읽은책 기준 ──
    window.updateLibraryCardCount = function() {
        const books = (AppState.library && AppState.library.books) || [];
        const year = new Date().getFullYear();
        const yearlyCount = books.filter(b => b.category === 'read' && new Date(b.addedDate).getFullYear() === year).length;
        const el = document.getElementById('lib-yearly-card-count');
        if (el) el.textContent = yearlyCount;
    };

    // ── Library View ──
    window.openLibraryView = function() {
        const overlay = document.getElementById('library-overlay');
        if (!overlay) return;
        overlay.classList.remove('d-none');
        _libCurrentTab = 'read';
        _libCurrentPeriod = 'total';
        _libCurrentView = (_libCurrentTab === 'read') ? 'tower' : 'list';
        _libSearchQuery = '';
        _libLocalSearch = false;
        _apiSearchResults = [];
        _apiSearchQuery = '';
        _apiSearchPage = 1;
        _apiSearchHasMore = false;
        const searchInput = document.getElementById('library-search-input');
        if (searchInput) searchInput.value = '';
        const localCheckbox = document.getElementById('library-local-filter');
        if (localCheckbox) localCheckbox.checked = false;
        const searchResults = document.getElementById('library-search-results');
        if (searchResults) { searchResults.classList.add('d-none'); searchResults.innerHTML = ''; }
        _libSelectedYear = new Date().getFullYear();
        _libSelectedMonth = new Date().getMonth() + 1;
        showLibraryMainContent(true);
        updateLibraryTabs();
        updateLibraryViewToggle();
        updateLibraryCounts();
        updateLibraryPeriodLabels();
        updateLibraryPeriodBtns();
        renderLibrary();
        window.updateLibraryCardCount();
        // Trigger i18n re-apply for dynamically shown overlay
        if (typeof changeLanguage === 'function') changeLanguage(AppState.currentLang);
        // 보상형 광고 프리로드 (이미지 저장 시 사용)
        preloadRewardedAd();
    };

    window.closeLibraryView = function() {
        const overlay = document.getElementById('library-overlay');
        if (overlay) overlay.classList.add('d-none');
        // (배너 광고 제거됨 — 보상형 광고로 전환)
        // 뒤로가기 시 상태창으로 이동
        const statusNav = document.querySelector('.nav-item[data-tab="status"]');
        if (statusNav) {
            switchTab('status', statusNav);
        }
    };

    window.switchLibraryTab = function(cat) {
        _libCurrentTab = cat;
        // Only 읽은책 (read) tab supports tower view
        if (cat !== 'read') {
            _libCurrentView = 'list';
        }
        updateLibraryTabs();
        updateLibraryViewToggle();
        updateLibraryCounts();
        renderLibrary();
    };

    window.switchLibraryPeriod = function(period) {
        _libCurrentPeriod = period;
        updateLibraryPeriodBtns();
        updateLibraryCounts();
        updateLibraryPeriodLabels();
        renderLibrary();
    };

    window.openLibraryDatePicker = function(mode) {
        // If already active on this period, open picker; otherwise just switch to it
        if (_libCurrentPeriod !== (mode === 'monthly' ? 'monthly' : 'yearly')) {
            _libCurrentPeriod = (mode === 'monthly') ? 'monthly' : 'yearly';
            updateLibraryPeriodBtns();
            updateLibraryCounts();
            updateLibraryPeriodLabels();
            renderLibrary();
            return;
        }
        _libDatePickerMode = mode;
        _libPickerYear = _libSelectedYear;
        _libPickerMonth = _libSelectedMonth;
        renderLibraryDatePicker();
        const overlay = document.getElementById('lib-date-picker-overlay');
        if (overlay) overlay.classList.remove('d-none');
    };

    window.closeLibraryDatePicker = function(e) {
        if (e && e.target && !e.target.classList.contains('lib-date-picker-overlay')) return;
        const overlay = document.getElementById('lib-date-picker-overlay');
        if (overlay) overlay.classList.add('d-none');
    };

    window.confirmLibraryDatePicker = function() {
        _libSelectedYear = _libPickerYear;
        _libSelectedMonth = _libPickerMonth;
        _libCurrentPeriod = _libDatePickerMode;
        updateLibraryPeriodBtns();
        updateLibraryCounts();
        updateLibraryPeriodLabels();
        renderLibrary();
        const overlay = document.getElementById('lib-date-picker-overlay');
        if (overlay) overlay.classList.add('d-none');
    };

    function getAvailableYears() {
        const books = (AppState.library && AppState.library.books) || [];
        const years = new Set();
        books.forEach(b => {
            if (b.addedDate) years.add(new Date(b.addedDate).getFullYear());
        });
        // Always include current year
        years.add(new Date().getFullYear());
        return Array.from(years).sort((a, b) => b - a);
    }

    function getAvailableMonths(year) {
        const books = (AppState.library && AppState.library.books) || [];
        const months = new Set();
        books.forEach(b => {
            if (b.addedDate) {
                const d = new Date(b.addedDate);
                if (d.getFullYear() === year) months.add(d.getMonth() + 1);
            }
        });
        // If selected year is current year, include current month
        const now = new Date();
        if (year === now.getFullYear()) months.add(now.getMonth() + 1);
        return Array.from(months).sort((a, b) => a - b);
    }

    function renderLibraryDatePicker() {
        const yearsContainer = document.getElementById('lib-date-picker-years');
        const monthsContainer = document.getElementById('lib-date-picker-months');
        if (!yearsContainer || !monthsContainer) return;

        const years = getAvailableYears();
        yearsContainer.innerHTML = years.map(y =>
            '<div class="lib-date-picker-item' + (y === _libPickerYear ? ' selected' : '') +
            '" onclick="window.selectLibraryPickerYear(' + y + ')">' + y + '년</div>'
        ).join('');

        updateLibraryPickerMonths();
    }

    function updateLibraryPickerMonths() {
        const monthsContainer = document.getElementById('lib-date-picker-months');
        if (!monthsContainer) return;

        if (_libDatePickerMode === 'yearly') {
            monthsContainer.innerHTML = '<div style="text-align:center;color:var(--text-sub);font-size:0.8rem;padding:16px;">연도별 필터</div>';
            return;
        }

        const allMonths = [1,2,3,4,5,6,7,8,9,10,11,12];
        const availableMonths = new Set(getAvailableMonths(_libPickerYear));
        monthsContainer.innerHTML = allMonths.map(m => {
            const available = availableMonths.has(m);
            return '<div class="lib-date-picker-item' +
                (m === _libPickerMonth ? ' selected' : '') +
                (!available ? ' disabled' : '') +
                '" ' + (available ? 'onclick="window.selectLibraryPickerMonth(' + m + ')"' : '') +
                ' style="' + (!available ? 'opacity:0.3;cursor:default;' : '') + '">' +
                m + '월</div>';
        }).join('');
    }

    window.selectLibraryPickerYear = function(y) {
        _libPickerYear = y;
        // If currently selected month has no data in new year, pick first available
        const availMonths = getAvailableMonths(y);
        if (availMonths.length > 0 && !availMonths.includes(_libPickerMonth)) {
            _libPickerMonth = availMonths[availMonths.length - 1]; // latest month
        }
        renderLibraryDatePicker();
    };

    window.selectLibraryPickerMonth = function(m) {
        _libPickerMonth = m;
        updateLibraryPickerMonths();
        // Update selection visual
        document.querySelectorAll('#lib-date-picker-months .lib-date-picker-item').forEach(el => {
            el.classList.toggle('selected', parseInt(el.textContent) === m);
        });
    };

    function updateLibraryPeriodLabels() {
        const yearLabel = document.getElementById('lib-label-yearly');
        const monthLabel = document.getElementById('lib-label-monthly');
        const totalLabel = document.getElementById('lib-label-total');
        if (totalLabel) totalLabel.textContent = t('lib_total');
        if (yearLabel) yearLabel.textContent = _libSelectedYear + (AppState.currentLang === 'en' ? '' : '년');
        if (monthLabel) monthLabel.textContent = _libSelectedYear + '-' + String(_libSelectedMonth).padStart(2, '0');
    }

    window.switchLibraryViewMode = function(mode) {
        // Only allow tower view for 읽은책 tab
        if (mode === 'tower' && _libCurrentTab !== 'read') return;
        _libCurrentView = mode;
        updateLibraryViewToggle();
        renderLibrary();
    };

    function updateLibraryViewToggle() {
        document.querySelectorAll('.lib-view-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === _libCurrentView);
            // Disable tower button for non-read tabs
            if (b.dataset.view === 'tower') {
                b.classList.toggle('disabled', _libCurrentTab !== 'read');
            }
        });
    }

    window.filterLibraryBooks = function(query) {
        var trimmed = (query || '').trim();
        if (_libLocalSearch) {
            // Local filter mode: filter books in library
            _libSearchQuery = trimmed.toLowerCase();
            renderLibrary();
        } else {
            // API search mode: search via server
            _libSearchQuery = '';
            if (!trimmed) {
                // Empty query: hide search results, show library
                _apiSearchResults = [];
                _apiSearchQuery = '';
                var sr = document.getElementById('library-search-results');
                if (sr) { sr.classList.add('d-none'); sr.innerHTML = ''; }
                showLibraryMainContent(true);
                return;
            }
            // Debounce API calls
            if (_apiSearchTimer) clearTimeout(_apiSearchTimer);
            _apiSearchTimer = setTimeout(function() {
                _apiSearchPage = 1;
                _apiSearchQuery = trimmed;
                searchBooksFromApi(trimmed, 1);
            }, 400);
        }
    };

    window.toggleLibrarySearchMode = function(checked) {
        _libLocalSearch = checked;
        var searchInput = document.getElementById('library-search-input');
        var currentVal = searchInput ? searchInput.value.trim() : '';
        var searchResults = document.getElementById('library-search-results');

        if (checked) {
            // Switch to local filter mode
            if (searchResults) { searchResults.classList.add('d-none'); searchResults.innerHTML = ''; }
            _apiSearchResults = [];
            showLibraryMainContent(true);
            _libSearchQuery = currentVal.toLowerCase();
            renderLibrary();
        } else {
            // Switch to API search mode
            _libSearchQuery = '';
            renderLibrary();
            if (currentVal) {
                _apiSearchPage = 1;
                _apiSearchQuery = currentVal;
                searchBooksFromApi(currentVal, 1);
            }
        }
    };

    function showLibraryMainContent(show) {
        var els = document.querySelectorAll('.library-count-bar, .library-tabs, .library-view-toggle, #library-content');
        els.forEach(function(el) {
            el.style.display = show ? '' : 'none';
        });
    }

    async function searchBooksFromApi(query, page) {
        var searchResults = document.getElementById('library-search-results');
        if (!searchResults) return;

        // Show search results area, hide library main content
        showLibraryMainContent(false);
        searchResults.classList.remove('d-none');

        if (page === 1) {
            searchResults.innerHTML = '<div class="search-loading">' + t('lib_search_api') + '</div>';
        } else {
            // Remove old "more" button
            var moreBtn = searchResults.querySelector('.search-more-btn');
            if (moreBtn) moreBtn.textContent = t('lib_search_api');
        }

        try {
            var _ping = httpsCallable(functions, 'ping');
            var result = await _ping({ action: 'searchBooks', query: query, page: page });
            var data = result.data || {};
            var books = data.books || [];
            _apiSearchHasMore = data.hasMore || false;

            if (page === 1) {
                _apiSearchResults = books;
            } else {
                _apiSearchResults = _apiSearchResults.concat(books);
            }

            renderApiSearchResults();
        } catch (e) {
            console.error('Book search error:', e);
            if (page === 1) {
                searchResults.innerHTML = '<div class="search-no-result">' + t('lib_search_no_result') + '</div>';
                showLibraryMainContent(true);
            }
        }
    }

    function renderApiSearchResults() {
        var searchResults = document.getElementById('library-search-results');
        if (!searchResults) return;

        if (_apiSearchResults.length === 0) {
            searchResults.innerHTML = '<div class="search-no-result">' + t('lib_search_no_result') + '</div>';
            showLibraryMainContent(true);
            return;
        }

        var existingIsbns = {};
        var libBooks = (AppState.library && AppState.library.books) || [];
        libBooks.forEach(function(b) { if (b.isbn) existingIsbns[b.isbn] = true; });

        var html = '';
        _apiSearchResults.forEach(function(book, idx) {
            var isAdded = book.isbn && existingIsbns[book.isbn];
            var thumbSrc = book.thumbnail || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'50\' height=\'72\' fill=\'%23555\'%3E%3Crect width=\'50\' height=\'72\' fill=\'%23222\' rx=\'4\'/%3E%3Ctext x=\'25\' y=\'40\' text-anchor=\'middle\' fill=\'%23666\' font-size=\'10\'%3E📖%3C/text%3E%3C/svg%3E';

            html += '<div class="search-result-item" data-idx="' + idx + '">'
                + '<img class="search-result-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
                + '<div class="search-result-info">'
                + '<div class="search-result-title">' + escapeHtml(book.title) + '</div>'
                + '<div class="search-result-meta">' + escapeHtml(book.author || '') + (book.publisher ? ' · ' + escapeHtml(book.publisher) : '') + '</div>'
                + '<div class="search-cat-selector" data-idx="' + idx + '">'
                + '<button class="search-cat-btn active" data-cat="reading" onclick="window.selectSearchCat(this)">' + t('lib_reading') + '</button>'
                + '<button class="search-cat-btn" data-cat="read" onclick="window.selectSearchCat(this)">' + t('lib_read') + '</button>'
                + '<button class="search-cat-btn" data-cat="wantToRead" onclick="window.selectSearchCat(this)">' + t('lib_want_to_read') + '</button>'
                + '</div>'
                + '</div>'
                + '<div class="search-result-actions">'
                + (isAdded
                    ? '<button class="search-result-add-btn added" disabled>' + '✓' + '</button>'
                    : '<button class="search-result-add-btn" onclick="window.addSearchResult(' + idx + ')">' + t('lib_add_book') + '</button>')
                + '</div>'
                + '</div>';
        });

        if (_apiSearchHasMore) {
            html += '<button class="search-more-btn" onclick="window.loadMoreSearchResults()">' + t('lib_search_more') + '</button>';
        }

        searchResults.innerHTML = html;
    }

    window.selectSearchCat = function(btn) {
        var selector = btn.closest('.search-cat-selector');
        if (!selector) return;
        selector.querySelectorAll('.search-cat-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
    };

    window.addSearchResult = function(idx) {
        if (idx < 0 || idx >= _apiSearchResults.length) return;
        var book = _apiSearchResults[idx];
        var item = document.querySelector('.search-result-item[data-idx="' + idx + '"]');
        var catSelector = item ? item.querySelector('.search-cat-selector') : null;
        var activeBtn = catSelector ? catSelector.querySelector('.search-cat-btn.active') : null;
        var category = activeBtn ? activeBtn.dataset.cat : 'reading';

        var bookInfo = {
            isbn: book.isbn || '',
            title: book.title || '',
            author: book.author || '',
            publisher: book.publisher || '',
            thumbnail: book.thumbnail || '',
            description: book.description || '',
            pubDate: book.pubDate || '',
            pages: book.pages || 0,
            price: book.price || 0,
            url: book.url || '',
            source: book.source || null
        };

        var added = window.addBookToLibrary(bookInfo, category);
        if (added) {
            // Update button to show "added"
            var addBtn = item ? item.querySelector('.search-result-add-btn') : null;
            if (addBtn) {
                addBtn.classList.add('added');
                addBtn.disabled = true;
                addBtn.textContent = '✓';
                addBtn.onclick = null;
            }
            showLibToast(t('lib_book_added'));
        }
    };

    window.loadMoreSearchResults = function() {
        if (!_apiSearchHasMore || !_apiSearchQuery) return;
        _apiSearchPage++;
        searchBooksFromApi(_apiSearchQuery, _apiSearchPage);
    };

    function updateLibraryTabs() {
        document.querySelectorAll('.lib-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.cat === _libCurrentTab);
        });
    }

    function updateLibraryPeriodBtns() {
        document.querySelectorAll('.lib-count-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.period === _libCurrentPeriod);
        });
    }

    function getFilteredBooks() {
        const books = (AppState.library && AppState.library.books) || [];
        let filtered = books.filter(b => b.category === _libCurrentTab);

        // Period filter
        if (_libCurrentPeriod === 'yearly') {
            filtered = filtered.filter(b => {
                const d = new Date(b.addedDate);
                return d.getFullYear() === _libSelectedYear;
            });
        } else if (_libCurrentPeriod === 'monthly') {
            filtered = filtered.filter(b => {
                const d = new Date(b.addedDate);
                return d.getFullYear() === _libSelectedYear && (d.getMonth() + 1) === _libSelectedMonth;
            });
        }

        // Search filter
        if (_libSearchQuery) {
            filtered = filtered.filter(b =>
                (b.title || '').toLowerCase().includes(_libSearchQuery) ||
                (b.author || '').toLowerCase().includes(_libSearchQuery)
            );
        }
        return filtered;
    }

    function updateLibraryCounts() {
        const books = (AppState.library && AppState.library.books) || [];
        const catBooks = books.filter(b => b.category === _libCurrentTab);

        const totalEl = document.getElementById('lib-count-total');
        const yearlyEl = document.getElementById('lib-count-yearly');
        const monthlyEl = document.getElementById('lib-count-monthly');

        if (totalEl) totalEl.textContent = catBooks.length;
        if (yearlyEl) yearlyEl.textContent = catBooks.filter(b => new Date(b.addedDate).getFullYear() === _libSelectedYear).length;
        if (monthlyEl) monthlyEl.textContent = catBooks.filter(b => {
            const d = new Date(b.addedDate);
            return d.getFullYear() === _libSelectedYear && (d.getMonth() + 1) === _libSelectedMonth;
        }).length;
    }

    function renderLibrary() {
        const container = document.getElementById('library-tower');
        if (!container) return;
        const books = getFilteredBooks();
        const shareBtn = document.getElementById('library-share-btn');

        if (books.length === 0) {
            container.innerHTML = '<div class="library-empty"><div class="library-empty-icon">📚</div><div>' + t('lib_empty').replace(/\n/g, '<br>') + '</div></div>';
            container.className = 'library-tower';
            if (shareBtn) shareBtn.classList.add('d-none');
            return;
        }

        if (_libCurrentView === 'tower') {
            renderTowerView(container, books);
        } else {
            renderListView(container, books);
        }
        if (shareBtn) shareBtn.classList.remove('d-none');

        // 렌더링 후 스크롤을 최하단으로 이동 (1층이 배너 바로 위에 보이도록)
        var libContent = document.getElementById('library-content');
        if (libContent) {
            requestAnimationFrame(function() {
                libContent.scrollTop = libContent.scrollHeight;
            });
        }
    }
    window.renderLibrary = renderLibrary;

    // 서재 타워를 이미지로 저장 (보상형 광고 시청 후 다운로드)
    window.shareLibraryAsImage = async function() {
        const lang = AppState.currentLang;
        const books = getFilteredBooks();
        if (books.length === 0) return;

        var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

        // 네이티브 앱에서만 보상형 광고 필수
        if (isNative && _admobInitialized) {
            if (!_rewardedAdReady) {
                // 광고가 아직 로드되지 않았으면 로드 시도
                alert(i18n[lang].lib_ad_loading || i18n[lang].bonus_exp_loading);
                try {
                    const { AdMob } = window.Capacitor.Plugins;
                    if (AdMob) {
                        await AdMob.prepareRewardVideoAd({
                            adId: REWARDED_AD_UNIT_ID,
                            isTesting: false,
                        });
                        _rewardedAdReady = true;
                    }
                } catch (e) {
                    alert(i18n[lang].lib_ad_not_ready || i18n[lang].bonus_exp_not_ready);
                    return;
                }
            }

            // 광고 시청 확인
            if (!confirm(i18n[lang].lib_ad_prompt)) return;

            // 콜백 설정: 광고 시청 완료 시 이미지 저장 실행
            _rewardedAdContext = 'libraryImage';
            _rewardEarned = false;
            _rewardedAdOnSuccess = function() {
                _executeLibraryImageSave(lang, books);
            };
            _rewardedAdOnFail = function() {
                const failLang = AppState.currentLang;
                alert(i18n[failLang].lib_ad_fail || i18n[failLang].bonus_exp_fail);
            };

            try {
                const { AdMob } = window.Capacitor.Plugins;
                await AdMob.showRewardVideoAd();
                // 이후 처리는 onRewardedVideoAdDismissed 리스너에서 콜백으로 수행
            } catch (e) {
                console.warn('[AdMob] 보상형 광고 표시 실패:', e);
                _rewardedAdReady = false;
                _rewardEarned = false;
                _rewardedAdContext = 'bonusExp';
                _rewardedAdOnSuccess = null;
                _rewardedAdOnFail = null;
                preloadRewardedAd._retryCount = 0;
                preloadRewardedAd();
                alert(i18n[lang].lib_ad_not_ready || i18n[lang].bonus_exp_not_ready);
            }
            return;
        }

        // 웹(비네이티브) 환경: 광고 없이 바로 저장
        _executeLibraryImageSave(lang, books);
    };

    // 실제 이미지 생성 및 저장 로직 (보상형 광고 완료 후 호출)
    window._executeLibraryImageSave = function(lang, books) {
        _doLibraryImageSave(lang, books);
    };

    async function _doLibraryImageSave(lang, books) {
        if (!books || books.length === 0) return;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const W = 540;
        const pad = 20;
        const innerW = W - pad * 2;
        const centerX = W / 2;

        // 스파인 색상 팔레트 (style.css nth-child 패턴과 동일)
        const spineColors = [
            ['#f2b4a8', '#eea090'], ['#f5c4b8', '#f0b0a0'],
            ['#f8d0c4', '#f4bcae'], ['#eea898', '#e89888'],
            ['#f5bcae', '#f0a898'], ['#f0c0b4', '#ecaca0'],
            ['#f8d4c8', '#f4c0b4'], ['#ecb0a0', '#e8a090']
        ];
        const darkTextIndices = [2, 6]; // color: #5a3a3a

        // 각 책 스파인 메트릭 계산
        var totalBooksH = 0;
        var bookMetrics = books.map(function(book, i) {
            var thickness = getBookThickness(book.pages);
            var paddingV = thickness * 2;
            var textH = 14;
            var itemH = paddingV + textH;
            var widthPct = getBookWidth(book.pages, i);
            var itemW = Math.min(360, (innerW * widthPct / 100));
            totalBooksH += itemH;
            return { book: book, itemH: itemH, itemW: itemW, floor: i + 1 };
        });

        // 레이아웃 높이 계산
        var hexH = 48;
        var baseH = 14;
        var baseGap = 4;
        var footerH = 36;
        var totalH = pad + totalBooksH + baseGap + baseH + hexH + footerH + pad;

        canvas.width = W;
        canvas.height = totalH;

        // 배경
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, W, totalH);

        var y = pad;

        // --- 책 스파인 육각형 (맨 위층부터 아래로) ---
        for (var i = bookMetrics.length - 1; i >= 0; i--) {
            var m = bookMetrics[i];
            var colorIdx = i % 8;
            var c = spineColors[colorIdx];
            var itemX = centerX - m.itemW / 2;
            var iw = m.itemW, ih = m.itemH;
            var inset = iw * 0.04; // 4% inset matching CSS clip-path

            // 육각형 경로
            ctx.beginPath();
            ctx.moveTo(itemX + inset, y);
            ctx.lineTo(itemX + iw - inset, y);
            ctx.lineTo(itemX + iw, y + ih / 2);
            ctx.lineTo(itemX + iw - inset, y + ih);
            ctx.lineTo(itemX + inset, y + ih);
            ctx.lineTo(itemX, y + ih / 2);
            ctx.closePath();

            // 스파인 배경 그라디언트
            var spineGrad = ctx.createLinearGradient(0, y, 0, y + ih);
            spineGrad.addColorStop(0, c[0]);
            spineGrad.addColorStop(1, c[1]);
            ctx.fillStyle = spineGrad;
            ctx.fill();

            // 제목 텍스트
            var textColor = darkTextIndices.indexOf(colorIdx) >= 0 ? '#5a3a3a' : '#3a2a2a';
            ctx.fillStyle = textColor;
            ctx.font = 'bold 10px Pretendard, sans-serif';
            var title = m.book.title.length > 20 ? m.book.title.substring(0, 18) + '…' : m.book.title;
            var titleW = ctx.measureText(title).width;
            ctx.fillText(title, centerX - titleW / 2, y + ih / 2 + 3);

            // 층수 라벨 (좌측)
            ctx.fillStyle = '#888';
            ctx.font = 'bold 8px Pretendard, sans-serif';
            ctx.fillText(m.floor + '층', itemX - 32, y + ih / 2 + 3);

            // 페이지수 (우측)
            if (m.book.pages) {
                ctx.fillStyle = textColor;
                ctx.globalAlpha = 0.6;
                ctx.font = '8px Pretendard, sans-serif';
                ctx.fillText(m.book.pages + 'p', centerX + titleW / 2 + 6, y + ih / 2 + 3);
                ctx.globalAlpha = 1.0;
            }

            y += ih;
        }

        // --- 받침대 ---
        y += baseGap;
        var baseW = Math.min(390, innerW * 0.92);
        var baseX = centerX - baseW / 2;
        var baseGrad = ctx.createLinearGradient(0, y, 0, y + baseH);
        baseGrad.addColorStop(0, '#4a4a5a');
        baseGrad.addColorStop(1, '#2a2a3a');
        ctx.fillStyle = baseGrad;
        ctx.beginPath();
        ctx.roundRect(baseX, y, baseW, baseH, [0, 0, 6, 6]);
        ctx.fill();
        y += baseH;

        // --- 바벨의 도서관 육각형 (최하단, 공백 없이) ---
        var hexW = innerW * 0.6;
        var hexX = centerX - hexW / 2;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(hexX + hexW * 0.1, y);
        ctx.lineTo(hexX + hexW * 0.9, y);
        ctx.lineTo(hexX + hexW, y + hexH / 2);
        ctx.lineTo(hexX + hexW * 0.9, y + hexH);
        ctx.lineTo(hexX + hexW * 0.1, y + hexH);
        ctx.lineTo(hexX, y + hexH / 2);
        ctx.closePath();
        var hexGrad = ctx.createLinearGradient(0, y, 0, y + hexH);
        hexGrad.addColorStop(0, '#4a4a5a');
        hexGrad.addColorStop(1, '#3a3a4a');
        ctx.fillStyle = hexGrad;
        ctx.fill();
        ctx.restore();
        // 육각형 텍스트 (2줄: 바벨의 도서관 / N층)
        ctx.fillStyle = '#00d9ff';
        ctx.font = 'bold 11px Pretendard, sans-serif';
        var hexLine1 = t('lib_babel_tower') || '바벨의 도서관';
        var hexLine2 = books.length + '층';
        var hexLine1W = ctx.measureText(hexLine1).width;
        var hexLine2W = ctx.measureText(hexLine2).width;
        ctx.fillText(hexLine1, centerX - hexLine1W / 2, y + hexH / 2 - 2);
        ctx.fillText(hexLine2, centerX - hexLine2W / 2, y + hexH / 2 + 12);
        y += hexH;

        // --- 푸터 ---
        ctx.fillStyle = '#444';
        ctx.font = '10px Pretendard, sans-serif';
        var today = new Date().toISOString().slice(0, 10);
        var footerText = 'LEVEL UP: REBOOT | ' + today;
        ctx.fillText(footerText, pad + 6, y + 12);

        // --- 저장/공유 파이프라인 (sharePlannerAsImage 패턴 재사용) ---
        var userName = (AppState.user && AppState.user.name) ? AppState.user.name.replace(/[^a-zA-Z0-9가-힣]/g, '') : '';
        var saveCountKey = 'library_save_count_' + userName;
        var saveCount = parseInt(localStorage.getItem(saveCountKey) || '0', 10) + 1;
        localStorage.setItem(saveCountKey, String(saveCount));
        var countSuffix = saveCount > 1 ? String(saveCount) : '';
        var fileName = 'library_tower_' + userName + countSuffix + '.png';
        var msgs = { ko: '이미지가 저장되었습니다.', en: 'Image saved.', ja: '画像を保存しました。' };
        var failMsgs = { ko: '이미지 저장에 실패했습니다.', en: 'Failed to save image.', ja: '画像の保存に失敗しました。' };

        try {
            var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
            var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
            if (!blob) throw new Error('toBlob failed');

            var saved = false;

            // 네이티브 앱: Capacitor Filesystem
            if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                var Filesystem = window.Capacitor.Plugins.Filesystem;
                var dataUrl = canvas.toDataURL('image/png');
                var base64Data = dataUrl.split(',')[1];
                try {
                    var savedPath = null;
                    var dirs = ['DOCUMENTS', 'EXTERNAL', 'CACHE'];
                    for (var d = 0; d < dirs.length; d++) {
                        try {
                            var result = await Filesystem.writeFile({
                                path: fileName, data: base64Data,
                                directory: dirs[d], recursive: true
                            });
                            savedPath = result.uri;
                            break;
                        } catch(dirErr) {
                            AppLogger.warn('[Library] Filesystem write failed for dir ' + dirs[d] + ': ' + dirErr.message);
                        }
                    }
                    if (savedPath) {
                        AppLogger.info('[Library] Image saved: ' + savedPath);
                        saved = true;
                    }
                } catch(fsErr) {
                    AppLogger.warn('[Library] Filesystem save failed: ' + fsErr.message);
                }
            }

            // Web Share API
            if (!saved && navigator.share && navigator.canShare) {
                try {
                    var file = new File([blob], fileName, { type: 'image/png' });
                    var shareData = { files: [file] };
                    if (navigator.canShare(shareData)) {
                        await navigator.share(shareData);
                        saved = true;
                    }
                } catch(shareErr) {
                    if (shareErr.name === 'AbortError') {
                        saved = true;
                    } else {
                        AppLogger.warn('[Library] Share API failed: ' + shareErr.message);
                    }
                }
            }

            // 인앱 오버레이 (네이티브 폴백)
            if (!saved && isNative) {
                showImageOverlay(canvas.toDataURL('image/png'), lang);
                saved = true;
            }

            // <a> 다운로드 (데스크톱 폴백)
            if (!saved && !isNative) {
                var url = URL.createObjectURL(blob);
                var link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                setTimeout(function() {
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }, 1000);
                saved = true;
            }

            if (saved) {
                alert(msgs[lang] || msgs.ko);
            } else {
                throw new Error('All save methods failed');
            }
        } catch(e) {
            AppLogger.error('[Library] Image save error: ' + e.message);
            try {
                showImageOverlay(canvas.toDataURL('image/png'), lang);
            } catch(e2) {
                alert(failMsgs[lang] || failMsgs.ko);
            }
        }
    }

    function getBookThickness(pages) {
        // Reboot: thinner spines – min 4px, max 14px
        if (!pages || pages <= 0) return 6;
        if (pages < 100) return 4;
        if (pages < 200) return 5;
        if (pages < 300) return 6;
        if (pages < 400) return 8;
        if (pages < 500) return 10;
        if (pages < 700) return 12;
        return 14;
    }

    function getBookWidth(pages, index) {
        // Varying widths based on page count + slight per-book variation
        var base;
        if (!pages || pages <= 0) base = 72;
        else if (pages < 150) base = 60;
        else if (pages < 250) base = 68;
        else if (pages < 350) base = 75;
        else if (pages < 500) base = 82;
        else base = 88;
        // Add deterministic variation using index
        var offset = ((index * 7 + 3) % 11) - 5; // -5 to +5
        return Math.min(92, Math.max(55, base + offset));
    }

    function getSourceLabel(source) {
        if (!source) return '';
        var labels = { aladin: '알라딘', kakao: '카카오', google: '구글' };
        return labels[source] || source;
    }

    function renderTowerView(container, books) {
        container.className = 'library-tower';
        // 바벨의 도서관 라벨을 최하단에 배치 (column-reverse이므로 HTML 첫 번째 = 화면 최하단)
        let html = '<div class="book-tower-top">'
            + '<div class="book-tower-top-label">' + t('lib_babel_tower') + '<br>' + books.length + '층</div>'
            + '</div>';
        // Tower base
        html += '<div class="book-tower-base"></div>';
        // Books stacked from bottom (floor 1) to top
        books.forEach((book, i) => {
            const floor = i + 1;
            const title = book.title.length > 20 ? book.title.substring(0, 18) + '…' : book.title;
            const thickness = getBookThickness(book.pages);
            const widthPct = getBookWidth(book.pages, i);
            const pageLabel = book.pages ? book.pages + 'p' : '';
            const srcLabel = getSourceLabel(book.source);
            html += '<div class="book-tower-item" style="width:' + widthPct + '%; max-width:360px; padding-top:' + thickness + 'px; padding-bottom:' + thickness + 'px;" onclick="window.openBookDetail(\'' + encodeURIComponent(book.isbn) + '\')">'
                + '<span class="book-tower-floor">' + floor + '층</span>'
                + '<span class="book-tower-title">' + escapeHtml(title) + '</span>'
                + (pageLabel ? '<span class="book-tower-pages">' + escapeHtml(pageLabel) + '</span>' : '')
                + (srcLabel ? '<span class="book-tower-source">' + escapeHtml(srcLabel) + '</span>' : '')
                + '</div>';
        });
        container.innerHTML = html;
    }

    function renderListView(container, books) {
        container.className = 'library-list';
        let html = '';
        books.forEach(book => {
            const thumbSrc = book.thumbnail || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'45\' height=\'65\' fill=\'%23555\'%3E%3Crect width=\'45\' height=\'65\' fill=\'%23222\' rx=\'4\'/%3E%3Ctext x=\'22\' y=\'36\' text-anchor=\'middle\' fill=\'%23666\' font-size=\'10\'%3E📖%3C/text%3E%3C/svg%3E';
            html += '<div class="book-list-item">'
                + '<img class="book-list-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" onerror="this.style.display=\'none\'">'
                + '<div class="book-list-info">'
                + '<div class="book-list-title">' + escapeHtml(book.title) + '</div>'
                + '<div class="book-list-author">' + escapeHtml(book.author || '') + (book.source ? ' <span class="source-badge source-' + escapeHtml(book.source) + '">' + escapeHtml({aladin:'알라딘',kakao:'카카오',google:'구글'}[book.source] || book.source) + '</span>' : '') + '</div>'
                + '<div class="book-list-date">' + escapeHtml(book.addedDate || '') + '</div>'
                + '</div>'
                + '<button class="book-list-delete" onclick="window.openBookDetail(\'' + encodeURIComponent(book.isbn) + '\')">⋯</button>'
                + '</div>';
        });
        container.innerHTML = html;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Book Action Sheet (long press / tap) ──
    window.openBookAction = function(encodedIsbn) {
        const isbn = decodeURIComponent(encodedIsbn);
        const book = (AppState.library.books || []).find(b => b.isbn === isbn);
        if (!book) return;

        const cats = ['reading', 'read', 'wantToRead'].filter(c => c !== book.category);
        const moveLabels = { reading: 'lib_move_reading', read: 'lib_move_read', wantToRead: 'lib_move_want' };

        let html = '<div class="book-action-overlay" onclick="this.remove()">'
            + '<div class="book-action-sheet" onclick="event.stopPropagation()">'
            + '<div class="book-action-title">' + escapeHtml(book.title) + '</div>';
        cats.forEach(cat => {
            html += '<button class="book-action-btn" onclick="window.changeBookCategory(\'' + isbn + '\',\'' + cat + '\'); this.closest(\'.book-action-overlay\').remove();">' + t(moveLabels[cat]) + '</button>';
        });
        html += '<button class="book-action-btn danger" onclick="window.removeBookFromLibrary(\'' + isbn + '\'); this.closest(\'.book-action-overlay\').remove();">' + t('lib_delete') + '</button>';
        html += '<button class="book-action-btn cancel" onclick="this.closest(\'.book-action-overlay\').remove();">' + t('btn_cancel') + '</button>';
        html += '</div></div>';

        document.body.insertAdjacentHTML('beforeend', html);
    };

    // ── Book Detail View (click on book) ──
    window.openBookDetail = function(encodedIsbn) {
        const isbn = decodeURIComponent(encodedIsbn);
        const book = (AppState.library.books || []).find(b => b.isbn === isbn);
        if (!book) return;

        const cats = ['reading', 'read', 'wantToRead'].filter(c => c !== book.category);
        const moveLabels = { reading: 'lib_move_reading', read: 'lib_move_read', wantToRead: 'lib_move_want' };
        const catLabels = { reading: '읽고있는책', read: '읽은책', wantToRead: '읽고싶은책' };

        const thumbSrc = book.thumbnail || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'90\' height=\'130\' fill=\'%23555\'%3E%3Crect width=\'90\' height=\'130\' fill=\'%23222\' rx=\'6\'/%3E%3Ctext x=\'45\' y=\'70\' text-anchor=\'middle\' fill=\'%23666\' font-size=\'14\'%3E📖%3C/text%3E%3C/svg%3E';

        let html = '<div class="book-detail-overlay" onclick="this.remove()">'
            + '<div class="book-detail-sheet" onclick="event.stopPropagation()">'
            + '<button class="book-detail-close" onclick="this.closest(\'.book-detail-overlay\').remove()">✕</button>'
            + '<div class="book-detail-header">'
            + '<img class="book-detail-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
            + '<div class="book-detail-meta">'
            + '<div class="book-detail-title">' + escapeHtml(book.title) + '</div>'
            + '<div class="book-detail-author">' + escapeHtml(book.author || '저자 미상') + '</div>'
            + '<div class="book-detail-publisher">' + escapeHtml(book.publisher || '') + '</div>'
            + '<div class="book-detail-isbn">ISBN: ' + escapeHtml(book.isbn) + '</div>'
            + '<div class="book-detail-date">📅 ' + escapeHtml(book.addedDate || '') + ' 등록</div>'
            + (book.source ? '<div class="book-detail-source"><span class="source-badge source-' + escapeHtml(book.source) + '">' + escapeHtml({aladin:'알라딘',kakao:'카카오',google:'구글'}[book.source] || book.source) + '</span></div>' : '')
            + '</div></div>';

        // Description
        if (book.description) {
            html += '<div class="book-detail-description">' + escapeHtml(book.description) + '</div>';
        }

        // Info grid
        html += '<div class="book-detail-info-grid">';
        html += '<div class="book-detail-info-item"><div class="book-detail-info-label">분류</div><div class="book-detail-info-value">' + (catLabels[book.category] || book.category) + '</div></div>';
        if (book.pubDate) {
            html += '<div class="book-detail-info-item"><div class="book-detail-info-label">출판일</div><div class="book-detail-info-value">' + escapeHtml(book.pubDate) + '</div></div>';
        }
        if (book.pages) {
            html += '<div class="book-detail-info-item"><div class="book-detail-info-label">페이지</div><div class="book-detail-info-value">' + book.pages + 'p</div></div>';
        }
        if (book.finishedDate) {
            html += '<div class="book-detail-info-item"><div class="book-detail-info-label">완독일</div><div class="book-detail-info-value">' + escapeHtml(book.finishedDate) + '</div></div>';
        }
        html += '</div>';

        // Actions
        html += '<div class="book-detail-actions">';
        cats.forEach(cat => {
            html += '<button class="book-action-btn" onclick="window.changeBookCategory(\'' + isbn + '\',\'' + cat + '\'); this.closest(\'.book-detail-overlay\').remove(); renderLibrary();">' + t(moveLabels[cat]) + '</button>';
        });
        html += '<button class="book-action-btn danger" onclick="window.removeBookFromLibrary(\'' + isbn + '\'); this.closest(\'.book-detail-overlay\').remove();">' + t('lib_delete') + '</button>';
        html += '</div></div></div>';

        document.body.insertAdjacentHTML('beforeend', html);

        // Try to fetch additional details from API if not already loaded
        if (!book.description && book.isbn) {
            fetchBookDetails(book.isbn);
        }
    };

    async function fetchBookDetails(isbn) {
        try {
            const _ping = httpsCallable(functions, 'ping');
            const result = await _ping({ action: 'lookupIsbn', isbn: isbn });
            if (result.data && result.data.book) {
                const apiBook = result.data.book;
                // Update stored book with additional details
                const book = (AppState.library.books || []).find(b => b.isbn === isbn);
                if (book) {
                    if (apiBook.description && !book.description) book.description = apiBook.description;
                    if (apiBook.pubDate && !book.pubDate) book.pubDate = apiBook.pubDate;
                    if (apiBook.pages && !book.pages) book.pages = apiBook.pages;
                    if (apiBook.price && !book.price) book.price = apiBook.price;
                    if (apiBook.url && !book.url) book.url = apiBook.url;
                    if (!book.source && result.data.source) book.source = result.data.source;
                    saveUserData();

                    // Update the currently open detail overlay if it's still showing this book
                    const overlay = document.querySelector('.book-detail-overlay');
                    if (overlay) {
                        const descEl = overlay.querySelector('.book-detail-description');
                        if (!descEl && book.description) {
                            const header = overlay.querySelector('.book-detail-header');
                            if (header) {
                                header.insertAdjacentHTML('afterend', '<div class="book-detail-description">' + escapeHtml(book.description) + '</div>');
                            }
                        }
                        // Update info grid with new data
                        const grid = overlay.querySelector('.book-detail-info-grid');
                        if (grid && book.pubDate && !grid.querySelector('[data-field="pubDate"]')) {
                            grid.insertAdjacentHTML('beforeend', '<div class="book-detail-info-item" data-field="pubDate"><div class="book-detail-info-label">출판일</div><div class="book-detail-info-value">' + escapeHtml(book.pubDate) + '</div></div>');
                        }
                        if (grid && book.pages && !grid.querySelector('[data-field="pages"]')) {
                            grid.insertAdjacentHTML('beforeend', '<div class="book-detail-info-item" data-field="pages"><div class="book-detail-info-label">페이지</div><div class="book-detail-info-value">' + book.pages + 'p</div></div>');
                        }
                    }
                }
            }
        } catch(e) {
            console.warn('fetchBookDetails error:', e);
        }
    }

    // ── Library Read Reward ──
    function grantReadReward(book) {
        if (book.rewardGranted) return;
        if (!AppState.library.rewardedISBNs) AppState.library.rewardedISBNs = [];
        if (book.isbn && AppState.library.rewardedISBNs.indexOf(book.isbn) !== -1) {
            book.rewardGranted = true;
            return;
        }
        book.rewardGranted = true;
        if (book.isbn) AppState.library.rewardedISBNs.push(book.isbn);
        AppState.user.points += 10;
        AppState.user.pendingStats.int += 0.5;
        if (window.AppLogger) AppLogger.info('[Library] 독서 보상 지급: +10P, INT +0.5');
        updatePointUI();
        drawRadarChart();
        const lang = AppState.currentLang;
        alert(i18n[lang].lib_read_reward || '📚 독서 완료! +10P & INT +0.5');
    }

    // ── Library CRUD ──
    window.addBookToLibrary = function(bookInfo, category) {
        if (!AppState.library) AppState.library = { books: [], rewardedISBNs: [] };
        if (!Array.isArray(AppState.library.rewardedISBNs)) AppState.library.rewardedISBNs = [];
        const existing = AppState.library.books.find(b => b.isbn === bookInfo.isbn);
        if (existing) {
            alert(t('lib_already_exists'));
            return false;
        }
        AppState.library.books.push({
            isbn: bookInfo.isbn,
            title: bookInfo.title || 'Unknown',
            author: bookInfo.author || '',
            publisher: bookInfo.publisher || '',
            thumbnail: bookInfo.thumbnail || '',
            description: bookInfo.description || '',
            pubDate: bookInfo.pubDate || '',
            pages: bookInfo.pages || 0,
            price: bookInfo.price || 0,
            url: bookInfo.url || '',
            source: bookInfo._source || bookInfo.source || null,
            category: category,
            addedDate: getTodayStr(),
            finishedDate: category === 'read' ? getTodayStr() : null
        });
        if (category === 'read') {
            grantReadReward(AppState.library.books[AppState.library.books.length - 1]);
            checkReadingRareTitles();
        }
        saveUserData();
        window.updateLibraryCardCount();
        return true;
    };

    window.removeBookFromLibrary = function(isbn) {
        if (!AppState.library) return;
        AppState.library.books = AppState.library.books.filter(b => b.isbn !== isbn);
        saveUserData();
        updateLibraryCounts();
        renderLibrary();
        window.updateLibraryCardCount();
    };

    window.changeBookCategory = function(isbn, newCategory) {
        if (!AppState.library) return;
        const book = AppState.library.books.find(b => b.isbn === isbn);
        if (!book) return;
        book.category = newCategory;
        if (newCategory === 'read' && !book.finishedDate) book.finishedDate = getTodayStr();
        if (newCategory === 'read') {
            grantReadReward(book);
            checkReadingRareTitles();
        }
        saveUserData();
        updateLibraryCounts();
        renderLibrary();
        window.updateLibraryCardCount();
    };

    // ── ISBN Manual Input Keyboard Handling ──
    var _isbnKeyboardSetup = false;
    function setupIsbnKeyboardHandling() {
        if (_isbnKeyboardSetup) return;
        _isbnKeyboardSetup = true;
        var field = document.getElementById('isbn-manual-field');
        if (!field) return;

        field.addEventListener('focus', function() {
            // Scroll input into view after keyboard appears
            setTimeout(function() {
                field.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });

        // Handle visualViewport resize (keyboard show/hide)
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', function() {
                var overlay = document.getElementById('isbn-scanner-overlay');
                if (!overlay || overlay.classList.contains('d-none')) return;
                // Set overlay height to visual viewport height to avoid keyboard overlap
                overlay.style.height = window.visualViewport.height + 'px';
            });
            window.visualViewport.addEventListener('scroll', function() {
                var overlay = document.getElementById('isbn-scanner-overlay');
                if (!overlay || overlay.classList.contains('d-none')) return;
                overlay.style.height = window.visualViewport.height + 'px';
            });
        }
    }

    // ── ISBN Scanner ──
    window.openIsbnScanner = async function() {
        if (window.AppLogger) AppLogger.info('[ISBN] Scanner opened');
        const overlay = document.getElementById('isbn-scanner-overlay');
        if (overlay) {
            overlay.classList.remove('d-none');
            // Reset height in case keyboard changed it previously
            overlay.style.height = '100%';
        }

        const statusEl = document.getElementById('isbn-scanner-status');
        if (statusEl) statusEl.textContent = t('lib_scan_hint');

        setupIsbnKeyboardHandling();

        try {
            if (_html5QrCode) {
                try { await _html5QrCode.stop(); } catch(e) {}
                _html5QrCode = null;
            }
            _html5QrCode = new Html5Qrcode('isbn-scanner-reader');
            if (window.AppLogger) AppLogger.info('[ISBN] Html5Qrcode instance created');

            var _scanHandled = false;
            var _scanAttemptCount = 0;
            var _fullFrameRetried = false;

            var _onBarcodeSuccess = async (decodedText) => {
                _scanAttemptCount++;
                if (_scanHandled) return;
                // Validate barcode: reject garbage reads
                var barcode = (decodedText || '').replace(/[-\s]/g, '');
                if (!isValidIsbn(barcode)) {
                    if (window.AppLogger) AppLogger.debug('[ISBN] Barcode rejected (invalid): ' + decodedText, {
                        raw: decodedText,
                        cleaned: barcode,
                        length: barcode.length,
                        attemptNum: _scanAttemptCount
                    });
                    return;
                }
                _scanHandled = true;
                // Normalize ISBN-10 to ISBN-13 for API compatibility
                if (barcode.length === 10) {
                    var barcode13 = isbn10to13(barcode);
                    if (barcode13) {
                        if (window.AppLogger) AppLogger.info('[ISBN] Barcode ISBN-10→13: ' + barcode + ' → ' + barcode13);
                        barcode = barcode13;
                    }
                }
                if (window.AppLogger) AppLogger.info('[ISBN] Barcode accepted: ' + barcode, { attemptNum: _scanAttemptCount });
                stopOcrInterval();
                if (statusEl) statusEl.textContent = 'ISBN: ' + barcode;
                try { await _html5QrCode.stop(); } catch(e) {}
                var field = document.getElementById('isbn-manual-field');
                if (field) field.value = barcode;
                await onIsbnScanned(barcode);
                _scanHandled = false;
            };

            var _onBarcodeError = function(errorMessage) {
                // Log scan failures periodically (every 50th failure to avoid spam)
                _scanAttemptCount++;
                if (_scanAttemptCount % 50 === 1) {
                    if (window.AppLogger) AppLogger.debug('[ISBN] Scan attempt #' + _scanAttemptCount + ' no match', { error: errorMessage });
                }
                // Full-frame fallback: after 50 failed attempts, restart without qrbox restriction
                if (_scanAttemptCount === 50 && !_fullFrameRetried && _html5QrCode) {
                    _fullFrameRetried = true;
                    if (window.AppLogger) AppLogger.info('[ISBN] Retrying with full-frame scan (no qrbox)');
                    var fullConfig = _scannerConfig();
                    delete fullConfig.qrbox;
                    _html5QrCode.stop().then(function() {
                        return _html5QrCode.start(
                            { facingMode: 'environment' },
                            fullConfig,
                            _onBarcodeSuccess,
                            function(err) {
                                _scanAttemptCount++;
                                if (_scanAttemptCount % 50 === 1) {
                                    if (window.AppLogger) AppLogger.debug('[ISBN] Scan attempt #' + _scanAttemptCount + ' no match (full-frame)', { error: err });
                                }
                            }
                        );
                    }).catch(function() {});
                }
            };

            await _html5QrCode.start(
                { facingMode: 'environment' },
                _scannerConfig(),
                _onBarcodeSuccess,
                _onBarcodeError
            );

            // Log actual camera resolution for debugging
            try {
                var videoEl = document.querySelector('#isbn-scanner-container video');
                if (videoEl && videoEl.srcObject) {
                    var track = videoEl.srcObject.getVideoTracks()[0];
                    if (track) {
                        var settings = track.getSettings();
                        if (window.AppLogger) AppLogger.info('[ISBN] Camera resolution: ' + settings.width + 'x' + settings.height);
                    }
                }
            } catch(resErr) {}

            if (window.AppLogger) AppLogger.info('[ISBN] Camera started successfully');
            AppState.user.cameraEnabled = true;
            saveUserData();
            updateCameraToggleUI();

            // Native BarcodeDetector: parallel high-performance barcode scanning
            if ('BarcodeDetector' in window) {
                try {
                    var _nativeDetector = new BarcodeDetector({
                        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
                    });
                    var _nativeVideoEl = document.querySelector('#isbn-scanner-container video');
                    var _nativeRunning = true;
                    if (window.AppLogger) AppLogger.info('[ISBN] Native BarcodeDetector enabled');

                    var _nativeScanLoop = async function() {
                        if (!_nativeRunning || _scanHandled) return;
                        try {
                            if (_nativeVideoEl && _nativeVideoEl.readyState >= 2) {
                                var barcodes = await _nativeDetector.detect(_nativeVideoEl);
                                for (var bi = 0; bi < barcodes.length; bi++) {
                                    var rawVal = (barcodes[bi].rawValue || '').replace(/[-\s]/g, '');
                                    if (isValidIsbn(rawVal)) {
                                        if (window.AppLogger) AppLogger.info('[ISBN] Native BarcodeDetector found: ' + rawVal);
                                        await _onBarcodeSuccess(rawVal);
                                        _nativeRunning = false;
                                        return;
                                    }
                                }
                            }
                        } catch(detectErr) {
                            // Silently continue on detect errors
                        }
                        if (_nativeRunning && !_scanHandled) {
                            requestAnimationFrame(_nativeScanLoop);
                        }
                    };
                    requestAnimationFrame(_nativeScanLoop);

                    // Store cleanup reference for closeIsbnScanner
                    window._nativeBarcodeCleanup = function() { _nativeRunning = false; };
                } catch(nativeErr) {
                    if (window.AppLogger) AppLogger.warn('[ISBN] Native BarcodeDetector init failed', { message: nativeErr.message });
                }
            }

            // Start OCR as fallback (activates after 5s if barcode not detected)
            startOcrInterval();
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] Scanner start error', { name: e.name, message: e.message });
            console.error('Scanner start error:', e);
            // Camera permission denied or other error
            if (e && (e.name === 'NotAllowedError' || (e.message && e.message.indexOf('Permission') >= 0))) {
                AppState.user.cameraEnabled = false;
                saveUserData();
                updateCameraToggleUI();
                if (overlay) overlay.classList.add('d-none');
                const lang = i18n[AppState.currentLang];
                const msg = lang.cam_denied_go_settings || '카메라 권한이 거부되었습니다.\n앱 설정에서 카메라 권한을 허용하시겠습니까?';
                if (confirm(msg)) {
                    openAppSettings();
                }
            } else {
                if (statusEl) statusEl.textContent = 'Scanner error: ' + (e.message || e);
            }
        }
    };

    window.closeIsbnScanner = async function() {
        if (window.AppLogger) AppLogger.info('[ISBN] Scanner closed');
        // Stop native BarcodeDetector if running
        if (window._nativeBarcodeCleanup) {
            window._nativeBarcodeCleanup();
            window._nativeBarcodeCleanup = null;
        }
        stopOcrInterval();
        if (_html5QrCode) {
            try { await _html5QrCode.stop(); } catch(e) {}
            _html5QrCode = null;
        }
        const overlay = document.getElementById('isbn-scanner-overlay');
        if (overlay) {
            overlay.classList.add('d-none');
            overlay.style.height = '';
        }
        // Clear reader
        const reader = document.getElementById('isbn-scanner-reader');
        if (reader) { reader.innerHTML = ''; reader.style.display = ''; }
        // Reset embedded result panel
        const resultPanel = document.getElementById('isbn-scan-result');
        if (resultPanel) resultPanel.classList.add('d-none');
        const manualInput = document.getElementById('isbn-manual-input');
        if (manualInput) manualInput.style.display = '';
        // ISBN 입력 필드 초기화
        const manualField = document.getElementById('isbn-manual-field');
        if (manualField) manualField.value = '';
        // 내 서재로 이동 (library-overlay가 열려있으면 유지)
        const libraryOverlay = document.getElementById('library-overlay');
        if (!libraryOverlay || libraryOverlay.classList.contains('d-none')) {
            window.openLibraryView();
        }
    };

    window.manualIsbnLookup = async function() {
        const input = document.getElementById('isbn-manual-field');
        var isbn = (input ? input.value : '').trim().replace(/[-\s]/g, '');
        if (window.AppLogger) AppLogger.info('[ISBN] Manual lookup: ' + isbn);
        if (!isbn || isbn.length < 10) {
            alert('ISBN을 정확히 입력해주세요 (10자리 또는 13자리)');
            return;
        }
        // Normalize ISBN-10 to ISBN-13 for API compatibility
        if (isbn.length === 10 && isValidIsbn10(isbn)) {
            var isbn13 = isbn10to13(isbn);
            if (isbn13) {
                if (window.AppLogger) AppLogger.info('[ISBN] Manual ISBN-10→13: ' + isbn + ' → ' + isbn13);
                isbn = isbn13;
            }
        }
        await onIsbnScanned(isbn);
    };

    async function onIsbnScanned(isbn) {
        if (window.AppLogger) AppLogger.info('[ISBN] Processing ISBN: ' + isbn, { valid: isValidIsbn(isbn) });
        const statusEl = document.getElementById('isbn-scanner-status');
        if (statusEl) statusEl.textContent = '검색 중...';

        const bookInfo = await lookupBookByIsbn(isbn);
        if (!bookInfo) {
            if (window.AppLogger) AppLogger.warn('[ISBN] Book not found for ISBN: ' + isbn);
            // Ask user if they want to enter manually
            if (confirm(t('lib_not_found'))) {
                window.closeIsbnScanner();
                showManualBookEntry(isbn);
            } else {
                if (statusEl) statusEl.textContent = t('lib_scan_hint');
                // Restart scanner + OCR
                try {
                    if (_html5QrCode) {
                        await _html5QrCode.start(
                            { facingMode: 'environment' },
                            _scannerConfig(),
                            async (text) => {
                                var barcode = (text || '').replace(/[-\s]/g, '');
                                if (!isValidIsbn(barcode)) return;
                                stopOcrInterval();
                                try { await _html5QrCode.stop(); } catch(e) {}
                                await onIsbnScanned(barcode);
                            },
                            () => {}
                        );
                        startOcrInterval();
                    }
                } catch(e) {}
            }
            return;
        }
        _pendingBook = bookInfo;
        showBookConfirm(bookInfo);
    }

    async function lookupBookByIsbn(isbn) {
        if (window.AppLogger) AppLogger.info('[ISBN] Looking up ISBN: ' + isbn);
        // 1) Server-side Korean book API proxy (알라딘 → 카카오 → 구글북스)
        try {
            const _ping = httpsCallable(functions, 'ping');
            const result = await _ping({ action: 'lookupIsbn', isbn: isbn });
            if (result.data && result.data.book) {
                if (window.AppLogger) AppLogger.info('[ISBN] Server lookup success', { title: result.data.book.title, source: result.data.source || 'server' });
                result.data.book._source = result.data.source || null;
                return result.data.book;
            }
            if (window.AppLogger) AppLogger.warn('[ISBN] Server returned no book data', { response: JSON.stringify(result.data).substring(0, 200) });
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] Server lookup error', { message: e.message, code: e.code });
            console.warn('Server ISBN lookup error:', e);
        }

        // 2) Google Books API (client-side emergency fallback — 서버 장애 시)
        try {
            if (window.AppLogger) AppLogger.info('[ISBN] Trying Google Books fallback');
            const res = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + encodeURIComponent(isbn) + '&maxResults=1');
            const data = await res.json();
            if (data.items && data.items.length > 0) {
                const vol = data.items[0].volumeInfo;
                if (window.AppLogger) AppLogger.info('[ISBN] Google Books found', { title: vol.title });
                return {
                    isbn: isbn,
                    title: vol.title || 'Unknown',
                    author: (vol.authors || []).join(', '),
                    publisher: vol.publisher || '',
                    thumbnail: (vol.imageLinks && (vol.imageLinks.thumbnail || vol.imageLinks.smallThumbnail)) || '',
                    description: vol.description || '',
                    pubDate: vol.publishedDate || '',
                    pages: vol.pageCount || 0,
                    _source: 'google'
                };
            }
            if (window.AppLogger) AppLogger.warn('[ISBN] Google Books returned no results');
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] Google Books lookup error', { message: e.message });
            console.error('Google Books lookup error:', e);
        }

        return null;
    }

    function showBookConfirm(bookInfo) {
        // Hide camera and manual input areas
        const reader = document.getElementById('isbn-scanner-reader');
        const manualInput = document.getElementById('isbn-manual-input');
        const statusEl = document.getElementById('isbn-scanner-status');
        if (reader) reader.style.display = 'none';
        if (manualInput) manualInput.style.display = 'none';
        if (statusEl) statusEl.textContent = '';

        // Populate embedded result panel inside scanner overlay
        const panel = document.getElementById('isbn-scan-result');
        if (!panel) return;

        document.getElementById('isbn-result-title').textContent = bookInfo.title;
        document.getElementById('isbn-result-author').textContent = bookInfo.author;
        document.getElementById('isbn-result-publisher').textContent = bookInfo.publisher;

        const thumb = document.getElementById('isbn-result-thumb');
        if (bookInfo.thumbnail) {
            thumb.src = bookInfo.thumbnail;
            thumb.style.display = 'block';
        } else {
            thumb.style.display = 'none';
        }

        // Reset category buttons scoped to embedded panel
        const selector = document.getElementById('isbn-result-cat-selector');
        if (selector) {
            selector.querySelectorAll('.book-cat-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.cat === 'reading');
                b.onclick = function() {
                    selector.querySelectorAll('.book-cat-btn').forEach(x => x.classList.remove('active'));
                    this.classList.add('active');
                };
            });
        }

        panel.classList.remove('d-none');
        // Apply i18n
        if (typeof changeLanguage === 'function') changeLanguage(AppState.currentLang);
    }

    window.confirmScanResult = function() {
        if (!_pendingBook) return;
        const selector = document.getElementById('isbn-result-cat-selector');
        const activeBtn = selector ? selector.querySelector('.book-cat-btn.active') : null;
        const category = activeBtn ? activeBtn.dataset.cat : 'reading';

        const added = window.addBookToLibrary(_pendingBook, category);
        if (added) {
            _pendingBook = null;
            window.closeIsbnScanner();

            // Refresh library view if open
            const libOverlay = document.getElementById('library-overlay');
            if (libOverlay && !libOverlay.classList.contains('d-none')) {
                _libCurrentTab = category;
                updateLibraryTabs();
                updateLibraryCounts();
                renderLibrary();
            }
            showLibToast(t('lib_book_added'));
        }
    };

    window.cancelScanResult = function() {
        _pendingBook = null;
        // Hide result panel, restore camera/manual input
        const panel = document.getElementById('isbn-scan-result');
        if (panel) panel.classList.add('d-none');

        const reader = document.getElementById('isbn-scanner-reader');
        const manualInput = document.getElementById('isbn-manual-input');
        if (reader) reader.style.display = '';
        if (manualInput) manualInput.style.display = '';

        // Restart scanner
        window.openIsbnScanner();
    };

    // Keep legacy functions for book-confirm-overlay (used outside scanner flow)
    window.confirmAddBook = function() {
        if (!_pendingBook) return;
        const overlay = document.getElementById('book-confirm-overlay');
        const activeBtn = overlay ? overlay.querySelector('.book-cat-btn.active') : null;
        const category = activeBtn ? activeBtn.dataset.cat : 'reading';

        const added = window.addBookToLibrary(_pendingBook, category);
        if (added) {
            if (overlay) { overlay.classList.add('d-none'); overlay.classList.remove('d-flex'); }
            window.closeIsbnScanner();
            _pendingBook = null;

            const libOverlay = document.getElementById('library-overlay');
            if (libOverlay && !libOverlay.classList.contains('d-none')) {
                _libCurrentTab = category;
                updateLibraryTabs();
                updateLibraryCounts();
                renderLibrary();
            }
            showLibToast(t('lib_book_added'));
        }
    };

    window.cancelBookConfirm = function() {
        _pendingBook = null;
        const overlay = document.getElementById('book-confirm-overlay');
        if (overlay) { overlay.classList.add('d-none'); overlay.classList.remove('d-flex'); }
        window.openIsbnScanner();
    };

    // ── Manual Book Entry ──
    function showManualBookEntry(isbn) {
        const overlay = document.getElementById('manual-book-overlay');
        if (!overlay) return;
        document.getElementById('manual-book-isbn').value = isbn;
        document.getElementById('manual-book-title').value = '';
        document.getElementById('manual-book-author').value = '';
        document.getElementById('manual-book-publisher').value = '';
        // Reset category selection
        overlay.querySelectorAll('.book-cat-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.cat === 'reading');
        });
        overlay.querySelectorAll('.book-cat-btn').forEach(b => {
            b.onclick = function() {
                overlay.querySelectorAll('.book-cat-btn').forEach(x => x.classList.remove('active'));
                this.classList.add('active');
            };
        });
        overlay.classList.remove('d-none');
        overlay.classList.add('d-flex');
        // Apply i18n
        if (typeof changeLanguage === 'function') changeLanguage(AppState.currentLang);
    }

    window.confirmManualBook = function() {
        const title = (document.getElementById('manual-book-title').value || '').trim();
        if (!title) {
            document.getElementById('manual-book-title').focus();
            return;
        }
        const isbn = document.getElementById('manual-book-isbn').value || '';
        const author = (document.getElementById('manual-book-author').value || '').trim();
        const publisher = (document.getElementById('manual-book-publisher').value || '').trim();
        const overlay = document.getElementById('manual-book-overlay');
        const activeBtn = overlay ? overlay.querySelector('.book-cat-btn.active') : null;
        const category = activeBtn ? activeBtn.dataset.cat : 'reading';

        const bookInfo = { isbn: isbn, title: title, author: author, publisher: publisher, thumbnail: '' };
        const added = window.addBookToLibrary(bookInfo, category);
        if (added) {
            if (overlay) { overlay.classList.add('d-none'); overlay.classList.remove('d-flex'); }
            // Refresh library view if open
            const libOverlay = document.getElementById('library-overlay');
            if (libOverlay && !libOverlay.classList.contains('d-none')) {
                _libCurrentTab = category;
                updateLibraryTabs();
                updateLibraryCounts();
                renderLibrary();
            }
            showLibToast(t('lib_book_added'));
        }
    };

    window.cancelManualBook = function() {
        const overlay = document.getElementById('manual-book-overlay');
        if (overlay) { overlay.classList.add('d-none'); overlay.classList.remove('d-flex'); }
    };

    function showLibToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:rgba(0,217,255,0.9); color:#fff; padding:10px 24px; border-radius:20px; font-size:0.85rem; font-weight:600; z-index:9999; animation:fadeIn 0.3s;';
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 2000);
    }
})();

// ========== Running Calculator ==========
(function() {
    'use strict';

    let _paceMode = 'pace'; // 'pace' | 'distance' | 'time'

    // --- Overlay open/close ---
    window.openRunningCalcView = function() {
        const overlay = document.getElementById('running-calc-overlay');
        if (overlay) overlay.classList.remove('d-none');
        window.calcPace();
        window.calcTreadmill();
    };
    window.closeRunningCalcView = function() {
        const overlay = document.getElementById('running-calc-overlay');
        if (overlay) overlay.classList.add('d-none');
        updateSummaryCard();
    };

    // --- Main tab switching ---
    window.switchRunningCalcTab = function(tab) {
        document.querySelectorAll('.rc-main-tab').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.rcTab === tab);
        });
        document.querySelectorAll('.rc-tab-panel').forEach(function(panel) {
            panel.classList.remove('active');
        });
        var panel = document.getElementById('rc-panel-' + tab);
        if (panel) panel.classList.add('active');
        if (tab === 'vdot') window.calcVDOT();
    };

    // --- Pace sub-tab switching ---
    window.switchPaceMode = function(mode) {
        _paceMode = mode;
        document.querySelectorAll('.rc-sub-tab').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.calcMode === mode);
        });
        var distGroup = document.getElementById('rc-pace-distance-group');
        var timeGroup = document.getElementById('rc-pace-time-group');
        var paceGroup = document.getElementById('rc-pace-pace-group');
        // Show/hide inputs based on mode
        if (mode === 'pace') {
            distGroup.classList.remove('d-none');
            timeGroup.classList.remove('d-none');
            paceGroup.classList.add('d-none');
        } else if (mode === 'distance') {
            distGroup.classList.add('d-none');
            timeGroup.classList.remove('d-none');
            paceGroup.classList.remove('d-none');
        } else { // time
            distGroup.classList.remove('d-none');
            timeGroup.classList.add('d-none');
            paceGroup.classList.remove('d-none');
        }
        window.calcPace();
    };

    // --- Input validation ---
    window.rcValidateInput = function(el, type) {
        var val = parseInt(el.value) || 0;
        if (type === 'hr' && val > 24) val = 0;
        else if (type === 'min' && val > 59) val = 0;
        else if (type === 'sec' && val > 59) val = 0;
        if (val < 0) val = 0;
        el.value = val;
        var id = el.id || '';
        if (id.indexOf('vdot') !== -1) window.calcVDOT();
        else window.calcPace();
    };

    // --- Adjust +/- buttons ---
    window.rcAdjust = function(field, delta) {
        var el = document.getElementById('rc-' + field);
        if (!el) return;
        var val = parseInt(el.value) + delta;
        // Clamp values
        if (field.indexOf('hr') !== -1) { if (val > 24) val = 0; if (val < 0) val = 24; }
        else if (field.indexOf('min') !== -1) { if (val > 59) val = 0; if (val < 0) val = 59; }
        else if (field.indexOf('sec') !== -1) { if (val > 59) val = 0; if (val < 0) val = 59; }
        el.value = val;
        // Trigger calc
        if (field.indexOf('vdot') !== -1) window.calcVDOT();
        else window.calcPace();
    };

    // --- Long-press acceleration for +/- buttons ---
    (function() {
        var holdTimer = null;
        var holdInterval = null;
        var HOLD_DELAY = 400;
        var INITIAL_SPEED = 150;
        var MIN_SPEED = 30;
        var ACCEL_STEP = 20;

        function startHold(field, delta) {
            stopHold();
            var speed = INITIAL_SPEED;
            holdTimer = setTimeout(function repeat() {
                window.rcAdjust(field, delta);
                speed = Math.max(MIN_SPEED, speed - ACCEL_STEP);
                holdInterval = setTimeout(repeat, speed);
            }, HOLD_DELAY);
        }

        function stopHold() {
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
            if (holdInterval) { clearTimeout(holdInterval); holdInterval = null; }
        }

        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.rc-time-btn[data-field]').forEach(function(btn) {
                var field = btn.getAttribute('data-field');
                var delta = parseInt(btn.getAttribute('data-delta'));

                btn.addEventListener('click', function() {
                    window.rcAdjust(field, delta);
                });
                btn.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    startHold(field, delta);
                });
                btn.addEventListener('mouseup', stopHold);
                btn.addEventListener('mouseleave', stopHold);
                btn.addEventListener('touchstart', function(e) {
                    e.preventDefault();
                    startHold(field, delta);
                }, { passive: false });
                btn.addEventListener('touchend', stopHold);
                btn.addEventListener('touchcancel', stopHold);
            });
        });
    })();

    window.rcAdjustTreadmill = function(delta) {
        var el = document.getElementById('rc-treadmill-speed');
        if (!el) return;
        var val = parseFloat(el.value) + delta;
        val = Math.max(0.1, Math.round(val * 10) / 10);
        el.value = val;
        window.calcTreadmill();
    };

    // --- Display unit state (km or mi) ---
    var _rcDisplayUnit = 'km';

    window.toggleRcDisplayUnit = function() {
        var oldUnit = _rcDisplayUnit;
        _rcDisplayUnit = (oldUnit === 'km') ? 'mi' : 'km';
        var toggleBtns = document.querySelectorAll('#rc-unit-toggle .rc-unit-toggle-btn');
        toggleBtns.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-unit') === _rcDisplayUnit);
        });

        // Update unit labels
        var unitLabel = _rcDisplayUnit;
        var el;
        el = document.getElementById('rc-pace-dist-label'); if (el) el.textContent = unitLabel;
        el = document.getElementById('rc-vdot-dist-label'); if (el) el.textContent = unitLabel;
        el = document.getElementById('rc-tm-speed-label'); if (el) el.textContent = _rcDisplayUnit === 'mi' ? 'mi/h' : 'km/h';

        // Convert treadmill speed value
        var tmEl = document.getElementById('rc-treadmill-speed');
        if (tmEl) {
            var spd = parseFloat(tmEl.value) || 0;
            if (oldUnit === 'km' && _rcDisplayUnit === 'mi') spd = spd / 1.60934;
            else if (oldUnit === 'mi' && _rcDisplayUnit === 'km') spd = spd * 1.60934;
            tmEl.value = Math.round(spd * 10) / 10;
        }

        // Show/hide secondary pace rows
        var isMi = _rcDisplayUnit === 'mi';
        var pace2Row = document.getElementById('rc-res-pace2-row');
        var tmPace2Row = document.getElementById('rc-tm-pace2-row');
        if (pace2Row) pace2Row.classList.toggle('d-none', !isMi);
        if (tmPace2Row) tmPace2Row.classList.toggle('d-none', !isMi);

        // Update primary pace label
        var paceLabel = document.getElementById('rc-res-pace-label');
        if (paceLabel) paceLabel.textContent = isMi ? 'mi 페이스' : '페이스';
        var tmPaceLabel = document.getElementById('rc-tm-pace-label');
        if (tmPaceLabel) tmPaceLabel.textContent = isMi ? 'mi 페이스' : '페이스';

        // Recalculate to update display
        window.calcPace();
        window.calcTreadmill();
        window.calcVDOT();
    };

    // --- Preset distance selection ---
    window.selectPaceDist = function(dist) {
        document.getElementById('rc-pace-distance').value = dist;
        document.querySelectorAll('.rc-preset-btn[data-dist]').forEach(function(btn) {
            btn.classList.toggle('active', parseFloat(btn.getAttribute('data-dist')) === dist);
        });
        window.calcPace();
    };

    window.onPaceDistInput = function() {
        var val = parseFloat(document.getElementById('rc-pace-distance').value);
        document.querySelectorAll('.rc-preset-btn[data-dist]').forEach(function(btn) {
            btn.classList.toggle('active', parseFloat(btn.getAttribute('data-dist')) === val);
        });
        window.calcPace();
    };

    window.selectVdotDist = function(dist) {
        document.getElementById('rc-vdot-distance').value = dist;
        document.querySelectorAll('.rc-preset-btn[data-vdist]').forEach(function(btn) {
            btn.classList.toggle('active', parseFloat(btn.getAttribute('data-vdist')) === dist);
        });
        window.calcVDOT();
    };

    window.onVdotDistInput = function() {
        var val = parseFloat(document.getElementById('rc-vdot-distance').value);
        document.querySelectorAll('.rc-preset-btn[data-vdist]').forEach(function(btn) {
            btn.classList.toggle('active', parseFloat(btn.getAttribute('data-vdist')) === val);
        });
        window.calcVDOT();
    };

    // --- Helper: distance in km (converts from mi if needed) ---
    function getDistKm(inputId) {
        var dist = parseFloat(document.getElementById(inputId).value) || 0;
        if (_rcDisplayUnit === 'mi') dist *= 1.60934;
        return dist;
    }

    // --- Helper: format pace ---
    function formatPace(totalSeconds) {
        if (!isFinite(totalSeconds) || totalSeconds <= 0) return '--:--';
        var min = Math.floor(totalSeconds / 60);
        var sec = Math.round(totalSeconds % 60);
        if (sec === 60) { min++; sec = 0; }
        return min + ':' + (sec < 10 ? '0' : '') + sec;
    }

    // --- Helper: format time HH:MM:SS ---
    function formatTime(totalSeconds) {
        if (!isFinite(totalSeconds) || totalSeconds <= 0) return '--:--:--';
        var h = Math.floor(totalSeconds / 3600);
        var m = Math.floor((totalSeconds % 3600) / 60);
        var s = Math.round(totalSeconds % 60);
        if (s === 60) { m++; s = 0; }
        if (m === 60) { h++; m = 0; }
        return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    // --- Pace Calculator ---
    window.calcPace = function() {
        var distKm, totalSec, paceSecPerKm, speedKmh;
        var isMi = _rcDisplayUnit === 'mi';

        if (_paceMode === 'pace') {
            // Calculate pace from distance + time
            distKm = getDistKm('rc-pace-distance');
            var hr = parseInt(document.getElementById('rc-pace-hr').value) || 0;
            var min = parseInt(document.getElementById('rc-pace-min-t').value) || 0;
            var sec = parseInt(document.getElementById('rc-pace-sec-t').value) || 0;
            totalSec = hr * 3600 + min * 60 + sec;
            if (distKm <= 0 || totalSec <= 0) return;
            paceSecPerKm = totalSec / distKm;
            speedKmh = distKm / (totalSec / 3600);
        } else if (_paceMode === 'distance') {
            // Calculate distance from pace + time
            // Pace input is per-mi when mi mode, per-km when km mode
            var pMin = parseInt(document.getElementById('rc-pace-min').value) || 0;
            var pSec = parseInt(document.getElementById('rc-pace-sec').value) || 0;
            var paceInput = pMin * 60 + pSec;
            paceSecPerKm = isMi ? paceInput / 1.60934 : paceInput;
            var hr2 = parseInt(document.getElementById('rc-pace-hr').value) || 0;
            var min2 = parseInt(document.getElementById('rc-pace-min-t').value) || 0;
            var sec2 = parseInt(document.getElementById('rc-pace-sec-t').value) || 0;
            totalSec = hr2 * 3600 + min2 * 60 + sec2;
            if (paceSecPerKm <= 0 || totalSec <= 0) return;
            distKm = totalSec / paceSecPerKm;
            speedKmh = distKm / (totalSec / 3600);
            // Display distance in current unit
            var distDisplay = isMi ? distKm / 1.60934 : distKm;
            document.getElementById('rc-pace-distance').value = Math.round(distDisplay * 100) / 100;
        } else { // time
            distKm = getDistKm('rc-pace-distance');
            // Pace input is per-mi when mi mode, per-km when km mode
            var pMin2 = parseInt(document.getElementById('rc-pace-min').value) || 0;
            var pSec2 = parseInt(document.getElementById('rc-pace-sec').value) || 0;
            var paceInput2 = pMin2 * 60 + pSec2;
            paceSecPerKm = isMi ? paceInput2 / 1.60934 : paceInput2;
            if (distKm <= 0 || paceSecPerKm <= 0) return;
            totalSec = paceSecPerKm * distKm;
            speedKmh = distKm / (totalSec / 3600);
            // Update time display
            var th = Math.floor(totalSec / 3600);
            var tm = Math.floor((totalSec % 3600) / 60);
            var ts = Math.round(totalSec % 60);
            document.getElementById('rc-pace-hr').value = th;
            document.getElementById('rc-pace-min-t').value = tm;
            document.getElementById('rc-pace-sec-t').value = ts;
        }

        var lap400 = Math.round(paceSecPerKm * 0.4);
        if (isMi) {
            var secPerMi = paceSecPerKm * 1.60934;
            document.getElementById('rc-res-pace').innerHTML = formatPace(secPerMi) + ' <span class="rc-result-unit">/mi</span>';
            document.getElementById('rc-res-pace2').innerHTML = formatPace(paceSecPerKm) + ' <span class="rc-result-unit">/km</span>';
            var speedMph = speedKmh / 1.60934;
            document.getElementById('rc-res-speed').innerHTML = speedMph.toFixed(1) + ' <span class="rc-result-unit">mi/h</span>';
        } else {
            document.getElementById('rc-res-pace').innerHTML = formatPace(paceSecPerKm) + ' <span class="rc-result-unit">/km</span>';
            document.getElementById('rc-res-speed').innerHTML = speedKmh.toFixed(1) + ' <span class="rc-result-unit">km/h</span>';
        }
        document.getElementById('rc-res-lap').innerHTML = lap400 + ' <span class="rc-result-unit">초</span>';
    };

    // --- Treadmill Calculator ---
    window.calcTreadmill = function() {
        var speed = parseFloat(document.getElementById('rc-treadmill-speed').value) || 0;
        if (speed <= 0) return;
        var isMi = _rcDisplayUnit === 'mi';
        // Convert to km/h if input is in mi/h
        var speedKmh = isMi ? speed * 1.60934 : speed;
        var paceSecPerKm = 3600 / speedKmh;
        var time10k = paceSecPerKm * 10;
        var timeHalf = paceSecPerKm * 21.0975;
        var timeFull = paceSecPerKm * 42.195;
        if (isMi) {
            var secPerMi = paceSecPerKm * 1.60934;
            document.getElementById('rc-tm-pace').innerHTML = formatPace(secPerMi) + ' <span class="rc-result-unit">/mi</span>';
            document.getElementById('rc-tm-pace2').innerHTML = formatPace(paceSecPerKm) + ' <span class="rc-result-unit">/km</span>';
        } else {
            document.getElementById('rc-tm-pace').innerHTML = formatPace(paceSecPerKm) + ' <span class="rc-result-unit">/km</span>';
        }
        document.getElementById('rc-tm-10k').textContent = formatTime(time10k);
        document.getElementById('rc-tm-half').textContent = formatTime(timeHalf);
        document.getElementById('rc-tm-full').textContent = formatTime(timeFull);
    };

    // --- VDOT Calculator (Jack Daniels' Running Formula) ---
    function calcVO2(velocityMPerMin) {
        // Oxygen cost of running (ml/kg/min)
        return -4.60 + 0.182258 * velocityMPerMin + 0.000104 * velocityMPerMin * velocityMPerMin;
    }

    function calcPctVO2max(timeMin) {
        // Percent of VO2max sustained for given duration
        return 0.8 + 0.1894393 * Math.exp(-0.012778 * timeMin) + 0.2989558 * Math.exp(-0.1932605 * timeMin);
    }

    function calcVDOTFromRace(distMeters, timeMin) {
        var velocity = distMeters / timeMin; // m/min
        var vo2 = calcVO2(velocity);
        var pctMax = calcPctVO2max(timeMin);
        if (pctMax <= 0) return 0;
        return vo2 / pctMax;
    }

    function velocityFromVO2(vo2) {
        // Solve: vo2 = -4.60 + 0.182258*v + 0.000104*v^2
        // 0.000104*v^2 + 0.182258*v + (-4.60 - vo2) = 0
        var a = 0.000104, b = 0.182258, c = -4.60 - vo2;
        var disc = b * b - 4 * a * c;
        if (disc < 0) return 0;
        return (-b + Math.sqrt(disc)) / (2 * a);
    }

    function paceFromVDOT(vdot, pctVelocity) {
        // Use %vVO2max: percentage of velocity at VO2max
        var vVO2max = velocityFromVO2(vdot); // velocity at VO2max (m/min)
        var velocity = vVO2max * pctVelocity;
        if (velocity <= 0) return 0;
        return 1000 / velocity * 60; // sec/km
    }

    function predictRaceTime(vdot, distMeters) {
        // Binary search for time where VDOT matches
        var lo = 1, hi = 600; // minutes
        for (var i = 0; i < 50; i++) {
            var mid = (lo + hi) / 2;
            var v = calcVDOTFromRace(distMeters, mid);
            if (v > vdot) lo = mid;  // VDOT too high → time too short → increase
            else hi = mid;            // VDOT too low → time too long → decrease
        }
        return (lo + hi) / 2; // minutes
    }

    window.calcVDOT = function() {
        var distKm = getDistKm('rc-vdot-distance');
        var hr = parseInt(document.getElementById('rc-vdot-hr').value) || 0;
        var min = parseInt(document.getElementById('rc-vdot-min').value) || 0;
        var sec = parseInt(document.getElementById('rc-vdot-sec').value) || 0;
        var totalMin = hr * 60 + min + sec / 60;
        if (distKm <= 0 || totalMin <= 0) return;

        var distM = distKm * 1000;
        var vdot = calcVDOTFromRace(distM, totalMin);
        if (vdot <= 0 || !isFinite(vdot)) return;

        document.getElementById('rc-vdot-value').textContent = vdot.toFixed(1);

        // Training paces (% of vVO2max ranges)
        var isMi = _rcDisplayUnit === 'mi';
        var paceUnit = isMi ? '/mi' : '/km';
        var paceUnitHtml = '<span class="rc-result-unit">' + paceUnit + '</span>';
        var zones = [
            { id: 'rc-vdot-easy', lo: 0.59, hi: 0.74 },
            { id: 'rc-vdot-marathon', lo: 0.75, hi: 0.84 },
            { id: 'rc-vdot-threshold', lo: 0.83, hi: 0.88 },
            { id: 'rc-vdot-interval', lo: 0.95, hi: 1.00 },
            { id: 'rc-vdot-repetition', lo: 1.05, hi: 1.10 }
        ];
        zones.forEach(function(z) {
            var paceLo = paceFromVDOT(vdot, z.hi); // faster pace (sec/km)
            var paceHi = paceFromVDOT(vdot, z.lo); // slower pace (sec/km)
            if (isMi) {
                paceLo *= 1.60934;
                paceHi *= 1.60934;
            }
            document.getElementById(z.id).innerHTML = formatPace(paceLo) + ' - ' + formatPace(paceHi) + ' ' + paceUnitHtml;
        });

        // Race predictions
        var pred10k = predictRaceTime(vdot, 10000);
        var predHalf = predictRaceTime(vdot, 21097.5);
        var predFull = predictRaceTime(vdot, 42195);

        document.getElementById('rc-vdot-pred-10k').textContent = formatTime(pred10k * 60);
        var pace10k = pred10k * 60 / 10; // sec/km
        document.getElementById('rc-vdot-pred-10k-pace').textContent = formatPace(isMi ? pace10k * 1.60934 : pace10k) + paceUnit;
        document.getElementById('rc-vdot-pred-half').textContent = formatTime(predHalf * 60);
        var paceHalfVal = predHalf * 60 / 21.0975;
        document.getElementById('rc-vdot-pred-half-pace').textContent = formatPace(isMi ? paceHalfVal * 1.60934 : paceHalfVal) + paceUnit;
        document.getElementById('rc-vdot-pred-full').textContent = formatTime(predFull * 60);
        var paceFull = predFull * 60 / 42.195;
        document.getElementById('rc-vdot-pred-full-pace').textContent = formatPace(isMi ? paceFull * 1.60934 : paceFull) + paceUnit;
    };

    // --- Update summary card on status screen ---
    function updateSummaryCard() {
        var distKm = getDistKm('rc-pace-distance');
        var hr = parseInt(document.getElementById('rc-pace-hr').value) || 0;
        var min = parseInt(document.getElementById('rc-pace-min-t').value) || 0;
        var sec = parseInt(document.getElementById('rc-pace-sec-t').value) || 0;
        var totalSec = hr * 3600 + min * 60 + sec;
        var distDisplay = parseFloat(document.getElementById('rc-pace-distance').value) || 0;

        var el1 = document.getElementById('rc-summary-dist');
        var el2 = document.getElementById('rc-summary-time');
        var el3 = document.getElementById('rc-summary-pace');
        if (el1) el1.textContent = distDisplay + ' ' + _rcDisplayUnit;
        if (el2) el2.textContent = formatTime(totalSec);
        if (distKm > 0 && totalSec > 0) {
            var pace = totalSec / distKm;
            if (el3) el3.textContent = formatPace(pace) + ' /km';
        }
    }

    // Init on page load
    document.addEventListener('DOMContentLoaded', function() {
        window.calcPace();
        window.calcTreadmill();
    });
})();

// ========== 1RM Calculator ==========
(function() {
    'use strict';

    var _ormData = { squat: null, bench: null, deadlift: null };

    // Load saved data
    try {
        var saved = localStorage.getItem('orm_data');
        if (saved) _ormData = JSON.parse(saved);
    } catch(e) {}

    function saveOrmData() {
        try { localStorage.setItem('orm_data', JSON.stringify(_ormData)); } catch(e) {}
    }

    // --- Overlay open/close ---
    window.openOrmCalcView = function() {
        var overlay = document.getElementById('orm-calc-overlay');
        if (overlay) overlay.classList.remove('d-none');
        updateTotalDisplay();
    };
    window.closeOrmCalcView = function() {
        var overlay = document.getElementById('orm-calc-overlay');
        if (overlay) overlay.classList.add('d-none');
        updateSummaryCard();
    };

    // --- 1RM Formulas ---
    function calcEpley(w, r) { return r === 1 ? w : w * (1 + r / 30); }
    function calcBrzycki(w, r) { return r === 1 ? w : w * 36 / (37 - r); }
    function calcLander(w, r) { return r === 1 ? w : (100 * w) / (101.3 - 2.67123 * r); }
    function calcLombardi(w, r) { return w * Math.pow(r, 0.10); }
    function calcOconner(w, r) { return r === 1 ? w : w * (1 + r / 40); }

    function calcAverage(w, r) {
        var vals = [calcEpley(w,r), calcBrzycki(w,r), calcLander(w,r), calcLombardi(w,r), calcOconner(w,r)];
        return vals.reduce(function(a,b){ return a+b; }, 0) / vals.length;
    }

    // RM percentage table (rep -> % of 1RM)
    var rmPct = [
        {reps:1, pct:100}, {reps:2, pct:97}, {reps:3, pct:94}, {reps:4, pct:92},
        {reps:5, pct:89}, {reps:6, pct:86}, {reps:7, pct:83}, {reps:8, pct:81},
        {reps:9, pct:78}, {reps:10, pct:75}, {reps:11, pct:73}, {reps:12, pct:71}
    ];

    // --- Main calculation ---
    window.calcOneRM = function() {
        var exercise = document.getElementById('orm-exercise').value;
        var reps = parseInt(document.getElementById('orm-reps').value) || 5;
        var weight = parseFloat(document.getElementById('orm-weight').value);
        if (!weight || weight <= 0) return;

        var epley = calcEpley(weight, reps);
        var brzycki = calcBrzycki(weight, reps);
        var lander = calcLander(weight, reps);
        var lombardi = calcLombardi(weight, reps);
        var oconner = calcOconner(weight, reps);
        var avg = (epley + brzycki + lander + lombardi + oconner) / 5;

        // Round to 1 decimal
        function r1(v) { return Math.round(v * 10) / 10; }

        document.getElementById('orm-result-1rm').textContent = r1(avg) + ' kg';
        document.getElementById('orm-res-epley').textContent = r1(epley) + ' kg';
        document.getElementById('orm-res-brzycki').textContent = r1(brzycki) + ' kg';
        document.getElementById('orm-res-lander').textContent = r1(lander) + ' kg';
        document.getElementById('orm-res-lombardi').textContent = r1(lombardi) + ' kg';
        document.getElementById('orm-res-oconner').textContent = r1(oconner) + ' kg';

        // Show results
        document.getElementById('orm-results').classList.remove('d-none');

        // Build RM percentage table
        var pctContainer = document.getElementById('orm-pct-rows');
        pctContainer.innerHTML = '';
        rmPct.forEach(function(item) {
            var estWeight = r1(avg * item.pct / 100);
            var row = document.createElement('div');
            row.className = 'rc-result-row';
            row.innerHTML = '<span class="rc-result-label">' + item.reps + 'RM (' + item.pct + '%)</span>' +
                '<span class="rc-result-value">' + estWeight + ' <span class="rc-result-unit">kg</span></span>';
            pctContainer.appendChild(row);
        });
        document.getElementById('orm-pct-table').classList.remove('d-none');

        // Save to exercise data
        _ormData[exercise] = r1(avg);
        saveOrmData();
        updateTotalDisplay();
    };

    // --- Update total display in overlay ---
    function updateTotalDisplay() {
        var sq = _ormData.squat;
        var bp = _ormData.bench;
        var dl = _ormData.deadlift;

        document.getElementById('orm-total-squat').textContent = sq ? sq + ' kg' : '- kg';
        document.getElementById('orm-total-bench').textContent = bp ? bp + ' kg' : '- kg';
        document.getElementById('orm-total-dead').textContent = dl ? dl + ' kg' : '- kg';

        var total = (sq || 0) + (bp || 0) + (dl || 0);
        document.getElementById('orm-total-sum').textContent = (sq || bp || dl) ? Math.round(total * 10) / 10 + ' kg' : '- kg';
    }

    // --- Update summary card on status screen ---
    function updateSummaryCard() {
        var sq = _ormData.squat;
        var bp = _ormData.bench;
        var dl = _ormData.deadlift;

        var el1 = document.getElementById('orm-summary-squat');
        var el2 = document.getElementById('orm-summary-bench');
        var el3 = document.getElementById('orm-summary-dead');
        var el4 = document.getElementById('orm-summary-total');

        if (el1) el1.textContent = sq ? sq + ' kg' : '- kg';
        if (el2) el2.textContent = bp ? bp + ' kg' : '- kg';
        if (el3) el3.textContent = dl ? dl + ' kg' : '- kg';

        var total = (sq || 0) + (bp || 0) + (dl || 0);
        if (el4) el4.textContent = (sq || bp || dl) ? Math.round(total * 10) / 10 + ' kg' : '- kg';
    }

    // Init on page load
    document.addEventListener('DOMContentLoaded', function() {
        updateSummaryCard();
    });
})();
