// --- Firebase SDK 초기화 ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithCredential, sendEmailVerification, getIdTokenResult } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, updateDoc, arrayUnion, arrayRemove, enableNetwork, disableNetwork } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

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
        : { experimentalAutoDetectLongPolling: true })
});
const storage = getStorage(app);

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
const DEFAULT_PROFILE_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23555'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";

function setProfilePreview(url) {
    const el = document.getElementById('profilePreview');
    if (!el) return;
    el.onerror = function() {
        this.onerror = null;
        this.src = DEFAULT_PROFILE_SVG;
    };
    el.src = url;
}

// --- Cloud Storage 헬퍼 ---
function isBase64Image(str) {
    return typeof str === 'string' && str.startsWith('data:image/');
}

// 업로드 실패 재전송 큐 (로컬 메모리 + localStorage 백업)
const _uploadRetryQueue = [];
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
    _uploadRetryQueue.push({ storagePath, base64str, timestamp: Date.now() });
    _persistRetryQueue();
    console.warn(`[UploadRetry] 재전송 큐에 추가: ${storagePath} (큐 크기: ${_uploadRetryQueue.length})`);
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
    const _log = (step, msg) => { console.log(`[Upload:${step}] ${msg}`); if (window.AppLogger) AppLogger.info(`[Upload:${step}] ${msg}`); };
    _log('1-START', `path=${storagePath}, inputLen=${base64str ? base64str.length : 'null'}, startsWithData=${base64str ? base64str.startsWith('data:') : 'N/A'}`);
    let blob, contentType;
    if (base64str.startsWith('data:')) {
        const parts = base64str.split(',');
        contentType = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
        _log('2-DECODE', `contentType=${contentType}, base64PartLen=${parts[1] ? parts[1].length : 0}`);
        const byteString = atob(parts[1]);
        const u8arr = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) u8arr[i] = byteString.charCodeAt(i);
        blob = new Blob([u8arr], { type: contentType });
        _log('3-BLOB', `blobSize=${blob.size}, blobType=${blob.type}`);
    } else {
        _log('2-FETCH', 'Using fetch() for non-data URI');
        const res = await fetch(base64str);
        blob = await res.blob();
        contentType = blob.type || 'image/jpeg';
        _log('3-BLOB', `blobSize=${blob.size}, blobType=${blob.type}`);
    }
    const storageRef = ref(storage, storagePath);

    // 지수 백오프 재시도 (최대 3회, 2s → 4s → 실패)
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 2000;
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            _log('4-UPLOAD', `Calling uploadBytesResumable... (attempt ${attempt}/${MAX_RETRIES})`);
            const url = await new Promise((resolve, reject) => {
                const uploadTask = uploadBytesResumable(storageRef, blob, { contentType });
                const timeout = setTimeout(() => {
                    uploadTask.cancel();
                    reject(new Error('Upload timed out after 60s'));
                }, 60000);
                uploadTask.on('state_changed',
                    (snapshot) => {
                        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                        _log('4-PROGRESS', `${pct}% (${snapshot.bytesTransferred}/${snapshot.totalBytes})`);
                        if (onProgress) onProgress(pct);
                    },
                    (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    },
                    async () => {
                        clearTimeout(timeout);
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
googleProvider.setCustomParameters({ prompt: 'select_account' });

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
        currentLang: 'ko',
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
            stepData: { date: "", rewardedSteps: 0 },
            instaId: "",
            streak: { currentStreak: 0, lastActiveDate: null, multiplier: 1.0 },
            nameLastChanged: null
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

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // 네이티브 WebView에서 WebChannel transport error 발생 시 자동 복구
    // online/offline 이벤트 없이 Firestore 스트림이 끊어질 수 있음
    if (isNativePlatform) {
        let _lastNetworkRecovery = 0;
        window.addEventListener('unhandledrejection', (event) => {
            const msg = String(event.reason && event.reason.message || event.reason || '');
            if (msg.includes('transport errored') || msg.includes('WebChannel') || msg.includes('UNAVAILABLE')) {
                const now = Date.now();
                if (now - _lastNetworkRecovery < 30000) return; // 30초 내 중복 방지
                _lastNetworkRecovery = now;
                if (window.AppLogger) AppLogger.warn('[Firestore] WebChannel transport error detected, reconnecting...');
                disableNetwork(db)
                    .then(() => enableNetwork(db))
                    .then(() => { if (window.AppLogger) AppLogger.info('[Firestore] WebChannel 복구 완료'); })
                    .catch((e) => { if (window.AppLogger) AppLogger.warn('[Firestore] WebChannel 복구 실패: ' + e.message); });
            }
        });
    }

    // 초기 상태 체크
    if (!navigator.onLine) {
        updateOnlineStatus();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadNavOrder();
    initTheme();
    bindEvents();
    registerServiceWorker();
    initOfflineDetection();

    // 앱 시작 즉시 네이티브 푸시 알림 클릭 리스너 등록 (콜드 스타트 대응)
    registerEarlyPushListeners();

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
            await loadUserDataFromDB(user);
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('app-container').classList.remove('d-none');
            document.getElementById('app-container').classList.add('d-flex');
            const loginPanel = document.getElementById('login-log-panel');
            if (loginPanel) loginPanel.style.display = 'none';

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
            updateDungeonStatus();
            startRaidTimer();
            renderQuestList();
            fetchSocialData();

            renderWeeklyChallenges();
            renderRoulette();
            updateReelsResetTimer();

            if (AppState.user.syncEnabled) { syncHealthData(false); }

            // OS 권한 상태와 앱 토글 동기화 (OS에서 차단/해제된 경우 토글 off)
            // ⚠️ 반드시 initPushNotifications보다 먼저 실행해야 올바른 pushEnabled 상태로 리스너 설정
            await syncToggleWithOSPermissions();

            initPushNotifications();

            // 콜드 스타트 시 대기 중인 알림 데이터 처리 (푸시 클릭으로 앱 진입 시)
            processPendingNotification();

            // 로그인 후 권한 요청 프롬프트 표시 (푸시/GPS/피트니스)
            showPermissionPrompts();
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
}

function bindEvents() {
    document.getElementById('btn-login-submit').addEventListener('click', simulateLogin);
    document.getElementById('btn-google-login').addEventListener('click', simulateGoogleLogin);
    document.getElementById('auth-toggle-btn').addEventListener('click', toggleAuthMode);
    document.getElementById('login-email').addEventListener('focus', showEmailLoginFields);
    document.getElementById('btn-resend-verify').addEventListener('click', resendVerificationEmail);
    document.getElementById('btn-back-login').addEventListener('click', hideEmailVerificationNotice);
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

    document.getElementById('btn-edit-name').addEventListener('click', changePlayerName);
    document.getElementById('btn-edit-insta').addEventListener('click', changeInstaId);
    document.getElementById('imageUpload').addEventListener('change', loadProfileImage); 
    
    document.getElementById('prof-title-badge').addEventListener('click', openTitleModal);
    document.getElementById('btn-history-close').addEventListener('click', closeTitleModal);
    document.getElementById('btn-status-info').addEventListener('click', openStatusInfoModal);
    document.getElementById('btn-quest-info').addEventListener('click', openQuestInfoModal);
    document.getElementById('btn-dungeon-info').addEventListener('click', openDungeonInfoModal);
    document.getElementById('btn-planner-info').addEventListener('click', openPlannerInfoModal);
    document.getElementById('btn-day1-info').addEventListener('click', openDay1InfoModal);
    document.getElementById('btn-settings-push-guide').addEventListener('click', () => openSettingsGuideModal('push'));
    document.getElementById('btn-settings-gps-guide').addEventListener('click', () => openSettingsGuideModal('gps'));
    document.getElementById('btn-settings-fitness-guide').addEventListener('click', () => openSettingsGuideModal('fitness'));
    document.getElementById('btn-info-close').addEventListener('click', closeInfoModal);

    document.getElementById('btn-levelup').addEventListener('click', processLevelUp); 
    document.querySelectorAll('.social-tab-btn').forEach(btn => { btn.addEventListener('click', () => toggleSocialMode(btn.dataset.mode, btn)); });
    document.querySelectorAll('.rank-tab-btn').forEach(btn => { btn.addEventListener('click', () => renderUsers(btn.dataset.sort, btn)); });

    document.getElementById('lang-select').addEventListener('change', (e) => changeLanguage(e.target.value));
    document.getElementById('theme-toggle').addEventListener('change', changeTheme);
    document.getElementById('push-toggle').addEventListener('change', togglePushNotifications);
    document.getElementById('gps-toggle').addEventListener('change', toggleGPS);
    document.getElementById('sync-toggle').addEventListener('change', toggleHealthSync);
    document.getElementById('btn-logout').addEventListener('click', logout);

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
            lastReelsPostTs: normalizedLastReelsPostTs,
            diyQuestsStr: JSON.stringify(AppState.diyQuests),
            questHistoryStr: JSON.stringify(AppState.questHistory)
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
            if(data.level) AppState.user.level = data.level;
            if(data.points) AppState.user.points = data.points;
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
            AppState.user.name = data.name || user.displayName || "신규 헌터";
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
            AppState.user.name = user.displayName || "신규 헌터";
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

function changePlayerName() {
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
        AppState.user.name = newName.trim();
        AppState.user.nameLastChanged = Date.now();
        loadPlayerName();
        updateSocialUserData();
        saveUserData();
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
        const val = Number(AppState.user.stats[key]) || 0; 
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
            timerEl.innerText = `마감까지 ${h}시간 ${m}분`;
        } else {
            let nextStart = null;
            for (const s of slots) {
                if (s.start > kstMinutes) { nextStart = s.start; break; }
            }
            if (!nextStart) nextStart = slots[0].start + 1440;
            const remainMin = nextStart - kstMinutes;
            const h = Math.floor(remainMin / 60);
            const m = remainMin % 60;
            timerEl.innerText = `다음 레이드까지 ${h}시간 ${m}분`;
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
                        participants.push({
                            id: doc.id,
                            name: data.name || '헌터',
                            photoURL: data.photoURL || null,
                            title,
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
        AppState.dungeon.bossMaxHP = scaledHP;
        AppState.dungeon.bossDamageDealt = totalDamage;
        AppState.dungeon.globalParticipants = realParticipants;
        AppState.dungeon.globalProgress = Math.min(100, (totalDamage / scaledHP) * 100);
        AppState.dungeon.raidParticipants = participants.sort((a, b) => (b.hasContributed - a.hasContributed) || (b.statValue - a.statValue));

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

    const cards = participants.map(u => `
        <div class="user-card ${u.isMe ? 'my-rank' : ''}" style="padding:8px;">
            <div style="display:flex; align-items:center; flex-grow:1;">
                ${u.photoURL ? `<img src="${sanitizeURL(u.photoURL)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display=''" style="width:28px; height:28px; border-radius:50%; object-fit:cover; margin-right:8px; border:1px solid var(--neon-blue);"><div style="width:28px; height:28px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue); display:none;"></div>` : `<div style="width:28px; height:28px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue);"></div>`}
                <div>
                    <div class="title-badge" style="font-size:0.55rem;">${sanitizeText(u.title)}</div>
                    <div style="font-size:0.8rem; display:flex; align-items:center;">
                        ${sanitizeText(u.name)} ${u.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(u.instaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:4px; cursor:pointer; display:inline-flex;">${instaSvg}</button>` : ''}
                    </div>
                </div>
            </div>
            <div class="raid-contribution-badge ${u.hasContributed ? 'contributed' : 'pending'}">
                ${u.hasContributed ? '⚔️ ' + (t.raid_contributed || '기여 완료') : '⏳ ' + (t.raid_waiting_contribute || '대기 중')}
            </div>
        </div>
    `).join('');

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
            
            const joinBtnHtml = `<button onclick="window.joinDungeon()" class="btn-primary" style="background:${m.color}; border-color:${m.color}; margin-top:10px; color:black; font-weight:bold;">작전 합류 (입장)</button>`;

            banner.innerHTML = `
                <div style="display:inline-block; padding:2px 6px; font-size:0.6rem; font-weight:bold; color:${m.color}; border:1px solid ${m.color}; border-radius:3px; margin-bottom:5px;">${m.stat} 요구됨</div>
                <h3 class="raid-boss-title" style="color:${m.color}; margin: 0 0 10px 0; font-size:1.1rem;">📍 ${st.name[AppState.currentLang]} - ${m.title[AppState.currentLang]}</h3>
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
                    <span class="text-blue">${AppState.dungeon.globalParticipants}</span> 명
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
            document.getElementById('active-raid-title').innerText = m.title[AppState.currentLang];
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
                    btnComplete.innerText = "정산 완료";
                    btnComplete.disabled = true;
                    btnComplete.style.background = "#444";
                    btnComplete.style.color = "#888";
                } else {
                    btnComplete.innerText = "전리품 획득";
                    btnComplete.disabled = false;
                    btnComplete.style.background = "var(--neon-gold)";
                    btnComplete.style.color = "black";
                }
            } else {
                btnAction.classList.remove('d-none');
                btnComplete.classList.add('d-none');
                
                if (AppState.dungeon.hasContributed) {
                    btnAction.innerText = "데이터 전송 완료";
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
    renderDungeon();

    await saveUserData();
    await window.syncGlobalDungeon();
};

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
        drawRadarChart(); updatePointUI(); renderQuote();
    } else {
        mainEl.style.overflowY = 'auto';
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
    document.getElementById('sys-level').innerText = `Lv. ${AppState.user.level}`;
    document.getElementById('display-pts').innerText = AppState.user.points;
    document.getElementById('display-req-pts').innerText = req;
    document.getElementById('btn-levelup').disabled = AppState.user.points < req;
    
    const titleObj = AppState.user.titleHistory[AppState.user.titleHistory.length - 1].title;
    const titleText = typeof titleObj === 'object' ? titleObj[AppState.currentLang] || titleObj.ko : titleObj;
    document.getElementById('prof-title-badge').innerHTML = `${sanitizeText(titleText)} ℹ️`;
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

function changeLanguage(langCode) {
    AppState.currentLang = langCode;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[langCode][key]) el.innerHTML = i18n[langCode][key];
    });
    
    if(document.getElementById('app-container').classList.contains('d-flex')){
        drawRadarChart();
        renderUsers(AppState.social.sortCriteria);
        renderQuestList();
        renderCalendar();
        renderPlannerCalendar();
        renderQuote();
        updatePointUI();
        updateDungeonStatus();
        loadPlayerName();
        updateReelsResetTimer(); // i18n 업데이트 후 버튼 쿨다운 상태 재적용
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
            return { id: d.id, ...data, title, stats: data.stats || {str:0,int:0,cha:0,vit:0,wlth:0,agi:0}, isFriend: (AppState.user.friends || []).includes(d.id), isMe: auth.currentUser?.uid === d.id };
        });
        renderUsers(AppState.social.sortCriteria);
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
        return { ...u, total, str:Number(s.str)||0, int:Number(s.int)||0, cha:Number(s.cha)||0, vit:Number(s.vit)||0, wlth:Number(s.wlth)||0, agi:Number(s.agi)||0 };
    });

    if(AppState.social.mode === 'friends') list = list.filter(u => u.isFriend || u.isMe);
    list.sort((a,b) => b[criteria] - a[criteria]);

    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: #ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;

    container.innerHTML = list.map((u, i) => `
        <div class="user-card ${u.isMe ? 'my-rank' : ''}">
            <div style="width:25px; font-weight:bold; color:var(--text-sub);">${i+1}</div>
            <div style="display:flex; align-items:center; flex-grow:1; margin-left:10px;">
                ${u.photoURL ? `<img src="${sanitizeURL(u.photoURL)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display=''" style="width:30px; height:30px; border-radius:50%; object-fit:cover; margin-right:8px; border:1px solid var(--neon-blue);"><div style="width:30px; height:30px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue); display:none;"></div>` : `<div style="width:30px; height:30px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue);"></div>`}
                <div class="user-info" style="margin-left:0;">
                    <div class="title-badge" style="font-size:0.6rem;">${sanitizeText(u.title)}</div>
                    <div style="font-size:0.9rem; display:flex; align-items:center;">
                        ${sanitizeText(u.name)} ${u.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(u.instaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:5px; cursor:pointer; display:inline-flex;">${instaSvg}</button>` : ''}
                    </div>
                </div>
            </div>
            <div class="user-score" style="font-weight:900; color:var(--neon-blue);">${u[criteria]}</div>
            ${!u.isMe ? `<button class="btn-friend ${u.isFriend ? 'added' : ''}" onclick="window.toggleFriend('${sanitizeAttr(u.id)}')">${u.isFriend ? '친구✓' : '추가'}</button>` : ''}
        </div>
    `).join('');
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
            if(!validatePassword(pw)) throw new Error(i18n[lang]?.login_err_pw_req || "비밀번호는 8자리 이상, 대문자 1개 이상, 특수문자 2개 이상 포함해야 합니다.");
            const pwConfirm = document.getElementById('login-pw-confirm').value;
            if(pw !== pwConfirm) throw new Error(i18n[lang]?.pw_mismatch || "비밀번호 불일치");
            const userCredential = await createUserWithEmailAndPassword(auth, email, pw);
            await sendEmailVerification(userCredential.user);
            await fbSignOut(auth);
            showEmailVerificationNotice(email);
            return;
        } else { await signInWithEmailAndPassword(auth, email, pw); }
    } catch (e) { alert("인증 오류: " + e.message); }
    finally { btn.innerText = AppState.isLoginMode ? "시스템 접속" : "회원가입"; btn.disabled = false; }
}

async function simulateGoogleLogin() {
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
                grantOfflineAccess: true
            });
            const googleUser = await GoogleAuth.signIn();
            const idToken = googleUser.authentication.idToken;
            const credential = GoogleAuthProvider.credential(idToken);
            const result = await signInWithCredential(auth, credential);
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
        } catch (e) {
            console.error("웹 구글 로그인 실패:", e);
            alert("Google 로그인 실패: " + e.message);
        }
    }
}

async function logout() { AppLogger.info('[Auth] 로그아웃'); await fbSignOut(auth); localStorage.clear(); window.location.reload(); }

function toggleAuthMode() {
    AppState.isLoginMode = !AppState.isLoginMode;
    const btnSubmit = document.getElementById('btn-login-submit');
    const toggleText = document.getElementById('auth-toggle-btn');
    document.getElementById('login-pw-confirm').classList.toggle('d-none', AppState.isLoginMode);
    document.getElementById('pw-hint').classList.toggle('d-none', AppState.isLoginMode);
    document.getElementById('disclaimer-box').classList.toggle('d-none', AppState.isLoginMode);
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
            ctx.drawImage(img, 0, 0, 150, 150);
            const base64 = canvasToOptimalDataURL(canvas, 0.6);
            _plog('B', `canvas→base64: len=${base64.length}, fmt=${_supportsWebP ? 'webp' : 'jpeg'}, starts=${base64.substring(0, 30)}`);
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
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">STR</span></td><td>${l.str_1}</td><td>${l.str_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">INT</span></td><td>${l.int_1}</td><td>${l.int_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">CHA</span></td><td>${l.cha_1}</td><td>${l.cha_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">VIT</span></td><td>${l.vit_1}</td><td>${l.vit_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">WLTH</span></td><td>${l.wlth_1}</td><td>${l.wlth_2}</td></tr>
                <tr><td style="text-align:center;"><span class="quest-stat-tag" style="border-color:var(--neon-blue); color:var(--neon-blue);">AGI</span></td><td>${l.agi_1}</td><td>${l.agi_2}</td></tr>
            </tbody>
        </table>
        <div style="font-size:0.7rem; color:var(--text-sub); margin-top:10px; text-align:right;">${l.footer}</div>
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

// --- ★ 설정 가이드 모달 (푸시/GPS/피트니스) ★ ---
function openSettingsGuideModal(type) {
    const lang = AppState.currentLang;
    const l = i18n[lang];
    const titleKey = `settings_guide_${type}_title`;
    const descKey = `settings_guide_${type}_desc`;
    const title = l[titleKey] || titleKey;
    const desc = l[descKey] || descKey;

    const colors = { push: 'var(--neon-gold)', gps: 'var(--neon-blue)', fitness: 'var(--neon-purple, #b388ff)' };
    const icons = { push: '🔔', gps: '📍', fitness: '🏃' };
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
    const photoSrc = plannerPhotoData || (entry && entry.photo) || null;
    const mood = (entry && entry.mood) ? entry.mood : '';
    const moodMap = { great: '😄', good: '🙂', neutral: '😐', bad: '😞', terrible: '😫' };
    const moodEmoji = moodMap[mood] || '';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const W = 540;
    const pad = 20;
    const innerW = W - pad * 2;

    // 사진 로드 (있을 경우)
    let photoImg = null;
    let photoH = 0;
    if (photoSrc) {
        try {
            photoImg = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = photoSrc;
            });
            if (photoImg) {
                photoH = Math.round(innerW * (photoImg.height / photoImg.width));
                if (photoH > 400) photoH = 400;
            }
        } catch(e) { photoImg = null; }
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
            const profImg = await new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = AppState.user.photoURL;
            });
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
    ctx.fillText('Lv.' + AppState.user.level + (moodEmoji ? ' ' + moodEmoji : ''), textX, avatarCenterY + 14);

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
    terms: {
        title: '소비자 약관',
        html: `<div class="legal-date" style="font-size:0.75rem;color:#888;margin-bottom:20px;">시행일: 2025년 3월 1일 | 최종 수정: 2026년 3월 16일</div>
<div class="section" style="margin-bottom:16px;"><p>본 소비자 약관(이하 "약관")은 <b>BRAVECAT</b>(이하 "회사")이 제공하는 <b>LEVEL UP: REBOOT</b> 모바일 애플리케이션(이하 "서비스")의 이용 조건을 규정합니다. 서비스를 이용함으로써 본 약관에 동의하는 것으로 간주됩니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">1. 서비스 개요</h2><p>LEVEL UP: REBOOT는 일상 생활의 자기계발 활동을 게임화(Gamification)하여 사용자의 동기 부여와 습관 형성을 돕는 모바일 애플리케이션입니다.</p><ul style="padding-left:20px;margin-bottom:10px;"><li>일일 퀘스트 시스템을 통한 자기계발 목표 관리</li><li>능력치(스탯) 시스템을 통한 성장 시각화</li><li>소셜 기능을 통한 커뮤니티 참여</li><li>글로벌 던전 레이드 시스템을 통한 협력 콘텐츠</li><li>Day1 피드를 통한 24시간 활동 공유</li><li>플래너 및 무드 트래킹을 통한 일일 관리</li><li>주간 도전과제 및 일일 보너스 룰렛</li><li>푸시 알림을 통한 퀘스트/레이드 알림</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">2. 계정 및 이용 자격</h2><h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">2.1 이용 자격</h3><p>서비스를 이용하려면 만 18세 이상이어야 합니다.</p><h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">2.2 계정 관리</h3><p>사용자는 본인의 계정 정보를 안전하게 관리할 책임이 있으며, 계정을 통해 발생하는 모든 활동에 대한 책임은 사용자 본인에게 있습니다.</p><h3 style="font-size:0.9rem;font-weight:600;margin:12px 0 6px;">2.3 계정 생성</h3><p>계정은 이메일/비밀번호 또는 Google OAuth를 통해 생성할 수 있습니다. 하나의 자연인은 하나의 계정만 생성하여야 합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">3. 서비스 이용</h2><p>서비스의 기본 기능은 광고 기반으로 무료 제공됩니다(Google AdSense). Day1 피드 콘텐츠는 게시 후 24시간 경과 시 자동 삭제됩니다. 회사는 운영상 또는 기술상의 필요에 따라 서비스를 변경하거나 중단할 수 있습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">4. 건강 및 면책 사항</h2><p>본 서비스는 건강 보조 및 동기 부여 목적으로만 제공됩니다. 의학적 조언, 진단, 치료를 대체하지 않습니다. Google Fit / Health Connect 연동 데이터의 정확성에 대해 회사는 보증하지 않습니다. 퀘스트 수행 중 발생하는 신체적 부상이나 손해에 대해 회사는 일절 책임지지 않습니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">5. 위치 정보</h2><p>던전/레이드 기능을 위해 사용자의 위치 정보를 수집할 수 있습니다. 위치 정보 수집은 사용자의 명시적 동의 하에만 이루어집니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">6. 광고</h2><p>서비스에는 Google AdSense를 통한 광고가 표시됩니다. 광고를 통해 연결되는 제3자 웹사이트나 서비스에 대해 회사는 책임을 지지 않습니다.</p></div>
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
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">1. 수집하는 개인정보 항목</h2><ul style="padding-left:20px;"><li><b>필수 정보:</b> 이메일 주소, 비밀번호(암호화 저장)</li><li><b>Google 로그인:</b> Google 계정 이메일, 프로필 이름, 프로필 사진 URL</li><li><b>프로필 정보:</b> 닉네임, 프로필 사진, 인스타그램 ID</li><li><b>서비스 이용 정보:</b> 퀘스트 완료 기록, 포인트, 스탯, 레벨, 칭호 이력</li><li><b>위치 정보:</b> GPS 좌표(사용자 동의 후)</li><li><b>건강 정보:</b> 일일 걸음 수(Google Fit / Health Connect 연동 시)</li><li><b>Day1 피드:</b> 사진, 캡션, 좋아요/댓글 내용</li><li><b>플래너/무드:</b> 일일 계획, 시간표, 캡션, 사진, 기분 상태</li><li><b>푸시 알림:</b> FCM 토큰, 알림 구독 설정</li><li><b>광고 관련:</b> 광고 식별자, 광고 상호작용 데이터(Google AdSense)</li><li><b>기기 정보:</b> 기기 유형, OS 버전, 앱 버전</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">2. 수집 및 이용 목적</h2><ul style="padding-left:20px;"><li><b>서비스 제공:</b> 계정 생성 및 관리, 퀘스트 시스템 운영</li><li><b>소셜 기능:</b> 글로벌 랭킹, 친구 시스템</li><li><b>던전/레이드:</b> 위치 기반 레이드 매칭</li><li><b>건강 연동:</b> Google Fit / Health Connect 데이터를 포인트로 환산</li><li><b>Day1 피드:</b> 24시간 활동 피드 운영, 커뮤니티 소통</li><li><b>플래너:</b> 일일 계획 관리, 기분 추적, 성장 기록</li><li><b>푸시 알림:</b> 퀘스트 알림, 레이드 알림, 서비스 공지</li><li><b>광고:</b> 서비스 운영 비용 충당을 위한 광고 표시</li><li><b>서비스 개선:</b> 이용 통계 분석, 오류 진단</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">3. 보유 및 이용 기간</h2><ul style="padding-left:20px;"><li>계정 정보: 회원 탈퇴 시까지 (탈퇴 후 30일 이내 파기)</li><li>서비스 이용 기록: 최종 접속일로부터 1년</li><li>위치 정보: 수집 후 즉시 처리, 미보관</li><li>건강 데이터: 포인트 환산 완료 시 삭제</li><li>Day1 피드 콘텐츠: 게시 후 24시간 자동 삭제</li><li>플래너 데이터: 기기 로컬 저장 (로그아웃 시 삭제)</li><li>푸시 알림 토큰: 서비스 이용 기간 (로그아웃 시 삭제)</li><li>오류 로그: 수집일로부터 90일</li></ul></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">4. 제3자 제공</h2><p>원칙적으로 제3자에게 제공하지 않습니다. 사용자 동의가 있거나 법적 의무가 있는 경우에만 예외로 합니다.</p></div>
<div class="section" style="margin-bottom:16px;"><h2 style="font-size:1rem;font-weight:700;color:var(--neon-blue);margin:18px 0 10px;">5. 처리 위탁</h2><ul style="padding-left:20px;"><li>Google Firebase: 사용자 인증, 데이터베이스 호스팅</li><li>Google Cloud Platform: 클라우드 인프라, 데이터 저장</li><li>Google AdSense: 광고 서비스 제공</li></ul></div>
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

        // 캔버스 리셋 (애니메이션 후 각도 유지)
        canvas.style.transition = 'none';
        canvas.style.transform = `rotate(${targetAngle}deg)`;
    }, 3200);
};

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
    const optHTML = ['<option value="">-- 없음 --</option>',
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
                   placeholder="할 일 입력..."
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

// 타임박스 그리드 렌더링 - 드롭다운 방식 (05:00~23:30)
function renderTimeboxGrid(dateStr) {
    const grid = document.getElementById('planner-timebox-grid');
    if (!grid) return;

    const entry = getDiaryEntry(dateStr);
    const blocks = (entry && entry.blocks) ? entry.blocks : {};
    const isFuture = isSelectedDateFuture();
    const options = getTaskOptions();

    const makeOpts = (currentVal) => {
        const opts = ['<option value="">-- 없음 --</option>',
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
        const preview = document.getElementById('planner-photo-preview');
        const placeholder = document.getElementById('planner-photo-placeholder');
        const removeBtn = document.getElementById('planner-photo-remove');
        if (preview) { preview.src = saved.photo; preview.classList.remove('d-none'); }
        if (placeholder) placeholder.classList.add('d-none');
        if (removeBtn) removeBtn.classList.remove('d-none');

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

async function savePlannerEntry() {
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
    }

    renderPlannerCalendar();
    alert(i18n[AppState.currentLang].diary_saved || '플래너가 저장되었습니다.');
}

// --- ★ 플래너 사진 기능 (타임테이블 사진 필수) ★ ---
let plannerPhotoData = null; // base64

function loadPlannerPhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const maxSize = 600;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                else { w = Math.round(w * maxSize / h); h = maxSize; }
            }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            plannerPhotoData = canvasToOptimalDataURL(canvas, 0.7);
            const preview = document.getElementById('planner-photo-preview');
            const placeholder = document.getElementById('planner-photo-placeholder');
            const removeBtn = document.getElementById('planner-photo-remove');
            preview.src = plannerPhotoData;
            preview.classList.remove('d-none');
            placeholder.classList.add('d-none');
            removeBtn.classList.remove('d-none');
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

window.removePlannerPhoto = function() {
    plannerPhotoData = null;
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

        // 릴스 사진을 Cloud Storage에 업로드
        let finalPhotoURL = photoData;
        let uploadFailed = false;
        if (isBase64Image(photoData)) {
            try {
                const uid = auth.currentUser.uid;
                const reelsLang = AppState.currentLang || 'ko';
                const reelsProgressCb = createUploadProgressCallback(reelsLang === 'ko' ? '릴스 사진 업로드 중...' : 'Uploading reel photo...');
                finalPhotoURL = await uploadImageToStorage(`reels_photos/${uid}/${postTimestamp}${getImageExtension()}`, photoData, reelsProgressCb);
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
async function renderReelsFeed() {
    const container = document.getElementById('reels-feed');
    if (!container) return;
    const lang = AppState.currentLang;

    // 로컬 캐시 먼저 표시
    const localData = getReelsData();
    const localPosts = (localData.posts || []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (localPosts.length > 0) {
        container.innerHTML = renderReelsCards(localPosts, lang);
    } else {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-sub);">로딩 중...</div>';
    }

    // Firestore에서 최신 데이터 로드 (5초 타임아웃)
    try {
        const posts = await Promise.race([
            fetchAllReelsPosts(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
        if (posts.length === 0) {
            container.innerHTML = `<div class="system-card" style="text-align:center; padding:30px; color:var(--text-sub);">
                <div style="font-size:2rem; margin-bottom:10px;">🎬</div>
                <div>${i18n[lang].reels_empty}</div>
            </div>`;
            return;
        }
        container.innerHTML = renderReelsCards(posts, lang);
    } catch(e) {
        // 타임아웃 또는 네트워크 오류 시 로컬 데이터 유지
        if (localPosts.length === 0) {
            container.innerHTML = `<div class="system-card" style="text-align:center; padding:30px; color:var(--text-sub);">
                <div style="font-size:2rem; margin-bottom:10px;">🎬</div>
                <div>${i18n[lang].reels_empty}</div>
            </div>`;
        }
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
    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="color:#ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;

    const heartOutline = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const commentIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

    const html = posts.map(post => {
        const postId = getPostId(post);
        const profileSrc = post.userPhoto ? sanitizeURL(post.userPhoto) : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23555'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
        const isMe = post.uid === auth.currentUser?.uid;
        const instaLink = post.userInstaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(post.userInstaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:4px; cursor:pointer; display:inline-flex; vertical-align:middle;">${instaSvg}</button>` : '';

        // 시간표 블록 (폴딩/언폴딩 지원, 연속 동일 업무 합치기)
        const mergedBlocks = mergeConsecutiveBlocks(post.blocks);
        const FOLD_LIMIT = 6;
        const blockSummary = mergedBlocks.slice(0, FOLD_LIMIT).map(({time, task}) =>
            `<div class="reels-block-item"><span class="reels-block-time">${time}</span><span class="reels-block-task">${task.replace(/</g,'&lt;')}</span></div>`
        ).join('');
        const blockExtra = mergedBlocks.slice(FOLD_LIMIT).map(({time, task}) =>
            `<div class="reels-block-item"><span class="reels-block-time">${time}</span><span class="reels-block-task">${task.replace(/</g,'&lt;')}</span></div>`
        ).join('');
        const moreCount = mergedBlocks.length > FOLD_LIMIT ? mergedBlocks.length - FOLD_LIMIT : 0;

        return `<div class="system-card reels-card" data-post-id="${postId}">
            <div class="reels-header">
                <img class="reels-avatar" src="${profileSrc}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${DEFAULT_PROFILE_SVG}'" alt="">
                <div class="reels-user-info">
                    <div class="reels-username">${(post.userName || '헌터').replace(/</g,'&lt;')}${instaLink}${isMe ? ' <span style="color:var(--neon-gold); font-size:0.65rem;">(나)</span>' : ''}</div>
                    <div class="reels-user-meta">Lv.${post.userLevel} ${post.mood ? getMoodEmoji(post.mood) : ''}</div>
                    ${post.location ? `<div class="reels-location">📍 ${post.location.name.replace(/</g,'&lt;')}</div>` : ''}
                </div>
                <div class="reels-time">${formatReelsTime(post.timestamp)}</div>
            </div>
            ${post.photo ? `<div class="reels-photo-container"><img class="reels-photo" src="${sanitizeURL(post.photo)}" alt="Timetable"></div>` : ''}
            ${post.caption ? `<div class="reels-caption">${post.caption.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>` : ''}
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
    }).join('');

    // 렌더 후 각 포스트의 리액션 데이터 로드
    setTimeout(() => {
        posts.forEach(post => {
            const postId = getPostId(post);
            loadReelsReactions(postId).then(data => {
                if (data.likes && data.likes.length > 0) updateLikeUI(postId, data.likes);
                if (data.comments && data.comments.length > 0) renderCommentsSection(postId, data.comments);
            });
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
function checkReelsReset() {
    const reelsData = getReelsData(); // 24h 지난 포스트 자동 필터링
    const myPost = reelsData.posts.find(p => p.uid === (auth.currentUser?.uid));
    if (!myPost) {
        // 내 포스트가 삭제됐으면 피드 갱신
        renderReelsFeed();
    }
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
            const cPhoto = c.photoURL ? sanitizeURL(c.photoURL) : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23555'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
            const instaBtn = c.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(c.instaId)}', '_blank')" class="reels-comment-insta-btn">${instaSvgSmall}</button>` : '';
            const timeAgo = getTimeAgo(c.timestamp, lang);
            return `<div class="reels-comment-item">
                <img class="reels-comment-avatar" src="${cPhoto}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${DEFAULT_PROFILE_SVG}'" alt="">
                <div class="reels-comment-body">
                    <div class="reels-comment-meta">
                        <span class="reels-comment-name">${(c.name || '헌터').replace(/</g,'&lt;')}</span>${instaBtn}
                        <span class="reels-comment-time">${timeAgo}</span>
                    </div>
                    <div class="reels-comment-text">${c.text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
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
                saveUserData();
                syncHealthData(true);
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[PermPrompt] Fitness check/request error: ' + (e.message || JSON.stringify(e)));
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
        AppState.user.stepData = { date: todayStr, rewardedSteps: 0 };
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
        return;
    }

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
            statusDiv.innerHTML = `<span style="color:var(--neon-blue);">동기화 완료 (${sourceLabel}): 총 ${totalStepsToday.toLocaleString()}보<br>추가 보상: +${earnedPoints}P, STR +${earnedStr}</span>`;
        }
        updatePointUI();
        drawRadarChart();
    } else {
        if (showMsg) {
            if(totalStepsToday === 0) {
                statusDiv.innerHTML = `<span style="color:var(--neon-gold);">걸음 수 기록이 없습니다. (0보)</span>`;
            } else {
                const sourceLabel = dataSource === 'health_connect' ? 'Health Connect' : 'Google Fit';
                statusDiv.innerHTML = `<span style="color:var(--neon-blue);">동기화 완료 (${sourceLabel}): 총 ${totalStepsToday.toLocaleString()}보<br>(다음 보상까지 ${1000 - unrewardedSteps}보 남음)</span>`;
            }
        }
    }
    saveUserData();
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
        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            if (window.AppLogger) AppLogger.info('[FCM] 알림 탭: ' + JSON.stringify(action));
            handleNotificationAction(action.notification.data);
        });

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
    if (!cap.Plugins || !cap.Plugins.PushNotifications) return;

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

                    if (tab && !_appNavigationReady) {
                        _pendingNotificationData = { tab: tab };
                    }
                } catch (e) {
                    console.warn('[DeepLink] 런치 URL 파싱 실패:', e.message);
                }
            }
        }).catch(() => {});
    }

    console.log('[FCM] 얼리 푸시 리스너 등록 완료');
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
function handleNotificationAction(data) {
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
