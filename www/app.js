// --- Firebase SDK 초기화 ---
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithCredential, sendEmailVerification, sendPasswordResetEmail, getIdTokenResult } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";
import { ref, uploadBytesResumable, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { logEvent as fbLogEvent } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";
import { NetworkMonitor } from './modules/network-monitor.js';
import { ConversionTracker, initRemoteConfig, getExperimentVariant } from './modules/conversion-tracker.js';
import { bootstrapCoreServices, attachFirestoreNetworkResilience } from './modules/core/bootstrap.js';
import { getInitialAppState, getWeekStartDate } from './modules/core/app-state.js';
import { loadNavOrder, initNavDragReorder, wasNavDragJustEnded } from './modules/core/nav-ui.js';
import { createOnboardingModule } from './modules/domains/onboarding.js';
import { createStreakRareTitleModule } from './modules/domains/streak-rare-title.js';
import { createQuestStatsModule } from './modules/domains/quest-stats.js';
import { createAuthProfileModule } from './modules/domains/auth-profile.js';
import { createPlannerDomainModule } from './modules/domains/planner.js';
import { createPermissionService, PERMISSION_TYPES } from './modules/device/permission-service.js';
import { createPushService } from './modules/device/push-service.js';
import { createPlatformCapabilities } from './modules/device/platform-capabilities.js';
import { createLocationService } from './modules/device/location-service.js';
import { createHealthService } from './modules/device/health-service.js';

if (!self.__FIREBASE_CONFIG) {
    console.error('[App] firebase-config.js가 로드되지 않았습니다. npm run generate-config를 실행하세요.');
}
const firebaseConfig = self.__FIREBASE_CONFIG;
const APP_VERSION = '1.0.531';
window.__APP_VERSION__ = APP_VERSION;
if (window.AppLogger) {
    AppLogger.info('[AppStart] 빌드 버전: v' + APP_VERSION);
}

const {
    app,
    auth,
    db,
    storage,
    functions,
    analytics,
    remoteConfig,
    messaging,
    isNativePlatform,
} = bootstrapCoreServices(firebaseConfig);

attachFirestoreNetworkResilience(db);

const googleProvider = new GoogleAuthProvider();


// 피트니스: Health Connect 네이티브 플러그인만 사용
// REST API 폴백 제거됨 — 모든 건강 데이터는 네이티브 SDK를 통해 조회

// --- 상태 관리 객체 ---
let AppState = getInitialAppState();
let permissionService = null;
const platformCapabilities = createPlatformCapabilities(window.Capacitor);
const pushService = createPushService({
    getAppState: () => AppState,
    saveUserData: () => saveUserData(),
    getCurrentLang: () => AppState.currentLang,
    i18n,
    AppLogger,
});
const locationService = createLocationService({
    capabilities: platformCapabilities,
    getAppState: () => AppState,
    saveUserData: () => saveUserData(),
    getCurrentLang: () => AppState.currentLang,
    i18n,
    AppLogger,
    confirm: (message) => confirm(message),
    openAppSettings: () => bridgeOpenAppSettings(),
});
const healthService = createHealthService({
    capabilities: platformCapabilities,
    getAppState: () => AppState,
    saveUserData: () => saveUserData(),
    getCurrentLang: () => AppState.currentLang,
    i18n,
    AppLogger,
    confirm: (message) => confirm(message),
    openAppSettings: () => bridgeOpenAppSettings(),
    checkStepRareTitles: () => checkStepRareTitles(),
    updateStepCountUI: () => updateStepCountUI(),
    updatePointUI: () => updatePointUI(),
    drawRadarChart: () => drawRadarChart(),
});

function getPermissionService() {
    if (!permissionService) {
        permissionService = createPermissionService({
            getAppState: () => AppState,
            openAppSettings: () => openAppSettingsInternal(),
            requestPermission: (type) => requestPermissionByType(type),
            updateCameraToggleUI: () => updateCameraToggleUIInternal(),
            togglePushNotifications: (...args) => togglePushNotificationsInternal(...args),
        });
    }
    return permissionService;
}

async function requestPermissionByType(type) {
    switch (type) {
        case PERMISSION_TYPES.PUSH:
            return togglePushNotificationsInternal();
        case PERMISSION_TYPES.GPS:
            return toggleGPS();
        case PERMISSION_TYPES.HEALTH:
            return toggleHealthSync();
        default:
            if (window.AppLogger) AppLogger.warn('[PermissionService] Unknown permission type: ' + type);
            return null;
    }
}

function bridgeOpenAppSettings() {
    return getPermissionService().openAppSettings();
}

function bridgeUpdateCameraToggleUI() {
    return getPermissionService().updateCameraToggleUI();
}

async function bridgeTogglePushNotifications(...args) {
    return getPermissionService().togglePushNotifications(...args);
}

// --- 앱 초기 로드 ---

// --- 상태창 카드 순서 재배치 (길게 눌러 상하 이동) ---
const DEFAULT_STATUS_CARD_ORDER = ['step-count', 'stat-radar', 'bonus-exp', 'life-status', 'future-networth', 'big5', 'my-library', 'my-movies', 'running-calc', 'orm-calc', 'meditation', 'pomodoro', 'dday', 'dday-caption', 'daily-quote'];

function saveStatusCardOrder() {
    const cards = Array.from(document.querySelectorAll('#status .status-reorderable'));
    const order = cards.map(el => el.dataset.cardId);
    localStorage.setItem('statusCardOrder', JSON.stringify(order));
}

function loadStatusCardOrder() {
    const saved = localStorage.getItem('statusCardOrder');
    const order = saved ? JSON.parse(saved) : DEFAULT_STATUS_CARD_ORDER;
    try {
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
    'step-count': { name_key: 'card_step_count', name: '걸음수', icon: '🚶' },
    'stat-radar': { name: 'STAT RADAR', icon: '📊' },
    'bonus-exp': { name_key: 'card_bonus_exp', name: '보너스 EXP', icon: '🎬' },
    'pomodoro': { name_key: 'card_pomodoro', name: 'POMODORO', icon: '🍅' },
    'life-status': { name: 'LIFE STATUS', icon: '📅' },
    'future-networth': { name_key: 'fnw_card_title', name: '미래 순자산', icon: '💰' },
    'dday': { name: 'D-DAY', icon: '⏰' },
    'dday-caption': { name_key: 'card_dday_caption', name: '목표/좌우명', icon: '💬' },
    'daily-quote': { name_key: 'card_daily_quote', name: '오늘의 명언', icon: '❝' },
    'my-library': { name_key: 'card_my_library', name: '내 서재', icon: '📚' },
    'my-movies': { name_key: 'card_my_movies', name: '내 영화', icon: '🎬' },
    'running-calc': { name_key: 'card_running_calc', name: '러닝 계산기', icon: '🏃' },
    'orm-calc': { name_key: 'card_orm_calc', name: '1RM 계산기', icon: '🏋️' },
    'meditation': { name_key: 'card_meditation', name: '명상', icon: '🧘' },
    'big5': { name_key: 'card_big5', name: 'BIG FIVE', icon: '🧠' }
};
const ALL_CARD_IDS = ['step-count', 'stat-radar', 'bonus-exp', 'life-status', 'future-networth', 'big5', 'my-library', 'my-movies', 'running-calc', 'orm-calc', 'meditation', 'pomodoro', 'dday', 'dday-caption', 'daily-quote'];
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
    const visibleCards = cards.filter(c => {
        return !hidden.includes(c.dataset.cardId);
    });

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
                <div class="editor-card-name">${(info.name_key && i18n[AppState.currentLang]?.[info.name_key]) || info.name}</div>
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
            <span class="card-select-item-label">${(info.name_key && i18n[AppState.currentLang]?.[info.name_key]) || info.name}</span>
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
        setTimeout(() => window._flushRetryQueue?.(), 2000); // 연결 안정화 2초 대기 후 실행
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
                    setTimeout(() => window._flushRetryQueue?.(), 3000);
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
            setTimeout(() => window._flushRetryQueue?.(), 1000);
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

    // 빌드 버전 표시
    const versionEl = document.getElementById('build-version-number');
    if (versionEl) versionEl.textContent = 'v' + APP_VERSION;

    onAuthStateChanged(auth, async (user) => {
        await authProfileDomain.handleAuthStateChanged(user);
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
const onboardingDomain = createOnboardingModule({
    AppState,
    changeLanguage,
    showPermissionPrompts,
    ConversionTracker,
    consumePendingPermissionPrompt: () => pushService.consumePendingPermissionPrompt(),
});
const ONBOARDING_STORAGE_KEY = onboardingDomain.getStorageKey();

function showOnboardingGuide() { onboardingDomain.show(); }
function dismissOnboardingGuide() { onboardingDomain.dismiss(); }
const authProfileDomain = createAuthProfileModule({
    getAppState: () => AppState,
    auth,
    db,
    fbSignOut,
    isNativePlatform,
    i18n,
    AppLogger,
    ConversionTracker,
    getIdTokenResult,
    getDoc,
    doc,
    loadUserDataFromDB,
    changeLanguage,
    renderCalendar,
    updatePointUI,
    drawRadarChart,
    updateDungeonStatus,
    startRaidTimer,
    renderQuestList,
    updateStepCountUI,
    syncHealthData,
    syncToggleWithOSPermissions,
    initPushNotifications,
    processPendingNotification,
    showPermissionPrompts,
    markPermissionPromptPending: () => pushService.markPermissionPromptPending(),
    onboardingStorageKey: ONBOARDING_STORAGE_KEY,
    showOnboardingGuide,
    drawRadarChartForUser,
    buildUserTitleBadgeHTML,
    sanitizeAttr,
    sanitizeText,
    sanitizeURL,
    getTodayStr,
    getDiaryEntry,
    getTodayKST,
});
authProfileDomain.bindWindowHandlers();

function bindEvents() {
    document.getElementById('btn-login-submit').addEventListener('click', simulateLogin);
    document.getElementById('btn-google-login').addEventListener('click', simulateGoogleLogin);
    document.getElementById('auth-toggle-btn').addEventListener('click', toggleAuthMode);
    document.getElementById('login-email').addEventListener('focus', showEmailLoginFields);

    // 네이티브 앱: Android Credential Manager가 이메일 입력 시 Google 계정 팝업을 표시하는 것을 방지
    // autocomplete="email"이 Credential Manager 바텀시트를 트리거하므로 네이티브에서는 비활성화
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
        document.getElementById('login-email').setAttribute('autocomplete', 'off');
        document.getElementById('login-pw').setAttribute('autocomplete', 'off');
        document.getElementById('login-pw-confirm').setAttribute('autocomplete', 'off');
    }
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
        el.addEventListener('click', () => { if (!wasNavDragJustEnded()) switchTab(el.dataset.tab, el); });
    });
    initNavDragReorder();
    initStatusCardReorder();

    document.getElementById('btn-edit-name').addEventListener('click', changePlayerName);
    document.getElementById('btn-edit-insta').addEventListener('click', changeInstaId);
    document.getElementById('btn-edit-linkedin').addEventListener('click', changeLinkedInId);
    document.getElementById('imageUploadLabel').addEventListener('click', function(e) {
        e.preventDefault();
        showPhotoSourceSheet('imageUpload');
    });
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
    document.getElementById('btn-settings-privacy-guide').addEventListener('click', () => openSettingsGuideModal('privacy'));
    document.getElementById('btn-info-close').addEventListener('click', closeInfoModal);

    document.getElementById('btn-levelup').addEventListener('click', processLevelUp); 
    document.querySelectorAll('.social-tab-btn').forEach(btn => { btn.addEventListener('click', () => { if (window.SocialModule) window.SocialModule.toggleMode(btn.dataset.mode, btn); }); });
    document.querySelectorAll('.rank-tab-btn').forEach(btn => { btn.addEventListener('click', () => { if (window.SocialModule) window.SocialModule.renderUsers(btn.dataset.sort, btn); }); });
    document.querySelectorAll('.reels-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.reels-sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            window._reelsSortMode = btn.dataset.reelsSort;
            window._reelsFeedLastKey = null;
            if (window.renderReelsFeed) window.renderReelsFeed();
        });
    });
    document.querySelectorAll('.reels-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.reels-category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            window._reelsCategoryFilter = btn.dataset.reelsCategory;
            window._reelsFeedLastKey = null;
            if (window.renderReelsFeed) window.renderReelsFeed();
        });
    });

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
    onboardingDomain.init();
    document.getElementById('theme-toggle').addEventListener('change', changeTheme);
    document.getElementById('push-toggle').addEventListener('change', bridgeTogglePushNotifications);
    document.getElementById('gps-toggle').addEventListener('change', toggleGPS);
    document.getElementById('sync-toggle').addEventListener('change', toggleHealthSync);
    healthService.applyAvailabilityUI({
        syncToggle: document.getElementById('sync-toggle'),
        statusDiv: document.getElementById('sync-status'),
    });
    document.getElementById('camera-toggle').addEventListener('change', toggleCamera);
    document.getElementById('privacy-toggle').addEventListener('change', togglePrivateAccount);
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

    // 관리자 초기화면 하단 로그 토글
    document.getElementById('admin-login-log-toggle').addEventListener('change', async function() {
        const visible = this.checked;
        // 즉시 UI 반영 (optimistic update)
        localStorage.setItem('loginLogVisible', visible ? '1' : '0');
        document.getElementById('admin-login-log-toggle-status').textContent = visible ? '초기화면에 표시 중' : '초기화면에 숨김';
        AppLogger.info('[Config] 초기화면 로그 토글 변경: ' + (visible ? 'ON' : 'OFF'));
        try {
            await setDoc(doc(db, "app_config", "settings"), { loginLogVisible: visible }, { merge: true });
            AppLogger.info('[Config] 초기화면 로그 설정 Firestore 저장 성공');
        } catch(e) {
            AppLogger.error('[Config] 초기화면 로그 설정 저장 실패: ' + (e.message || e));
            // Firestore 실패 시 롤백
            this.checked = !visible;
            localStorage.setItem('loginLogVisible', !visible ? '1' : '0');
            document.getElementById('admin-login-log-toggle-status').textContent = !visible ? '초기화면에 표시 중' : '초기화면에 숨김';
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
    document.querySelectorAll('#planner-category-selector .planner-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#planner-category-selector .planner-category-btn').forEach(b => b.classList.remove('selected'));
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
    document.getElementById('btn-qstats-prev-month').addEventListener('click', questStatsDomain.handlePrevMonth);
    document.getElementById('btn-qstats-next-month').addEventListener('click', questStatsDomain.handleNextMonth);
    document.getElementById('btn-qstats-prev-year').addEventListener('click', questStatsDomain.handlePrevYear);
    document.getElementById('btn-qstats-next-year').addEventListener('click', questStatsDomain.handleNextYear);
    // DIY 전용 통계 필터
    document.getElementById('qstats-diy-filter')?.addEventListener('change', questStatsDomain.handleDiyFilterChange);
    // 드롭다운 외부 클릭 시 닫기
    document.addEventListener('click', function(e) {
        const diyWrap = document.getElementById('qstats-diy-dropdown-wrap');
        const diyMenu = document.getElementById('qstats-diy-dropdown-menu');
        if (diyWrap && diyMenu && !diyWrap.contains(e.target)) diyMenu.classList.add('d-none');
        const dailyWrap = document.getElementById('qstats-daily-dropdown-wrap');
        const dailyMenu = document.getElementById('qstats-daily-dropdown-menu');
        if (dailyWrap && dailyMenu && !dailyWrap.contains(e.target)) dailyMenu.classList.add('d-none');
    });

    document.getElementById('btn-raid-complete').addEventListener('click', window.completeDungeon);

    // Reels tab
    document.getElementById('btn-reels-post').addEventListener('click', () => { if (window.postToReels) window.postToReels(); });
    // 우선순위 탭 저장 버튼도 같은 저장 함수 연결
    const prioritySaveBtn = document.getElementById('btn-planner-save-priority');
    if (prioritySaveBtn) prioritySaveBtn.addEventListener('click', savePlannerEntry);
    // Planner photo upload
    document.getElementById('planner-photo-label').addEventListener('click', function(e) {
        e.preventDefault();
        showPhotoSourceSheet('plannerPhotoUpload');
    });
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

// streak 맵 정규화 — 레거시 streak 맵 필드의 extra key/잘못된 타입으로 인한 permission-denied 방지
function normalizeStreakMapForFirestore(input) {
    const s = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    return {
        currentStreak: (typeof s.currentStreak === 'number' && Number.isFinite(s.currentStreak) && s.currentStreak >= 0) ? s.currentStreak : 0,
        lastActiveDate: (typeof s.lastActiveDate === 'string') ? s.lastActiveDate : null,
        multiplier: (typeof s.multiplier === 'number' && Number.isFinite(s.multiplier) && s.multiplier >= 0) ? s.multiplier : 1.0
    };
}

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
    _saveDebounceTimer = setTimeout(() => _doSaveUserData().catch(() => {}), 2000);
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
            titleHistoryStr: JSON.stringify(AppState.user.titleHistory ?? []),
            questStr: JSON.stringify(AppState.quest?.completedState ?? {}),
            questWeekStart: AppState.quest?.weekStart || '',
            dungeonStr: JSON.stringify(AppState.dungeon ?? {}),
            friends: normalizedFriends,
            photoURL: (_profileUploadInFlight || window.isBase64Image(AppState.user.photoURL)) ? null : (AppState.user.photoURL || null),
            syncEnabled: normalizeBooleanForFirestore(AppState.user.syncEnabled),
            gpsEnabled: normalizeBooleanForFirestore(AppState.user.gpsEnabled),
            pushEnabled: normalizeBooleanForFirestore(AppState.user.pushEnabled),
            // privateAccount: 서버에 해당 필드가 존재하거나 사용자가 토글한 경우에만 전송
            // 기존 문서에 없는 상태에서 기본값(false)을 전송하면 서버 규칙 미배포 시 permission-denied 발생
            ...(AppState._privateAccountExplicit ? { privateAccount: normalizeBooleanForFirestore(AppState.user.privateAccount) } : {}),
            fcmToken: AppState.user.fcmToken || null,
            lang: AppState.currentLang || 'ko',
            stepData: normalizedStepData,
            instaId: AppState.user.instaId || "",
            linkedinId: AppState.user.linkedinId || "",
            nameLastChanged: normalizedNameLastChanged,
            streak: normalizeStreakMapForFirestore(AppState.user.streak),
            streakStr: JSON.stringify(AppState.user.streak ?? {}),
            diaryStr: getCleanDiaryStrForFirestore(),
            lastRouletteDate: localStorage.getItem('roulette_date') || '',
            lastBonusExpDate: localStorage.getItem(`bonus_exp_date_${auth.currentUser ? auth.currentUser.uid : '_anon'}`) || '',
            lastReelsPostTs: normalizedLastReelsPostTs,
            diyQuestsStr: JSON.stringify(AppState.diyQuests ?? []),
            questHistoryStr: JSON.stringify(AppState.questHistory ?? []),
            rareTitleStr: JSON.stringify(AppState.user.rareTitle ?? {}),
            ddaysStr: JSON.stringify(AppState.ddays || []),
            ddayCaption: AppState.ddayCaption || '',
            lifeStatusStr: localStorage.getItem('life_status_config') || '',
            libraryStr: JSON.stringify(AppState.library || { books: [] }),
            moviesStr: JSON.stringify(AppState.movies || { items: [], rewardedIds: [] }),
            runningCalcHistoryStr: localStorage.getItem('running_calc_history') || '[]',
            ormCalcHistoryStr: localStorage.getItem('orm_calc_history') || '[]',
            rcLastRewardDate: localStorage.getItem('rc_last_reward_date') || '',
            ormLastRewardDate: localStorage.getItem('orm_last_reward_date') || '',
            onboardingSeen: localStorage.getItem(ONBOARDING_STORAGE_KEY) || '',
            big5Str: JSON.stringify(AppState.user.big5 || null),
            futureNetworthStr: localStorage.getItem('fnw_consent') ? (localStorage.getItem('future_networth_config') || '') : ''
        };
        // Firestore 보안 규칙 크기 제한에 맞춰 클라이언트에서 사전 검증/절삭
        const _strLimits = {
            questStr: 10000, diaryStr: 500000, reelsStr: 500000,
            dungeonStr: 50000, diyQuestsStr: 50000, questHistoryStr: 200000,
            titleHistoryStr: 50000, streakStr: 5000, rareTitleStr: 10000,
            ddaysStr: 50000, ddayCaption: 200, lifeStatusStr: 1000,
            libraryStr: 50000, moviesStr: 50000, runningCalcHistoryStr: 10000, ormCalcHistoryStr: 10000,
            big5Str: 500, futureNetworthStr: 1000
        };
        const _overflowed = [];
        for (const [key, limit] of Object.entries(_strLimits)) {
            if (typeof payload[key] === 'string' && payload[key].length > limit) {
                _overflowed.push(`${key}(${payload[key].length}>${limit})`);
                // 초과 시 기본값으로 절삭 (데이터 유실보다 저장 실패 방지 우선)
                if (key === 'diaryStr' || key === 'questHistoryStr') {
                    // 대용량 필드는 이전 값 유지를 위해 payload에서 제거 (merge:true이므로 기존 값 유지)
                    delete payload[key];
                } else {
                    payload[key] = key === 'ddayCaption' ? payload[key].substring(0, limit) : '{}';
                }
            }
        }
        if (_overflowed.length > 0) {
            console.warn('[SaveData] 필드 크기 초과 감지 (절삭 적용):', _overflowed.join(', '));
            if (window.AppLogger) AppLogger.warn('[SaveData] 필드 초과: ' + _overflowed.join(', '));
        }

        // name 길이 제한 (Firestore 규칙: 1~30자)
        if (payload.name && payload.name.length > 30) {
            payload.name = payload.name.substring(0, 30);
            if (window.AppLogger) AppLogger.warn('[SaveData] name 30자 초과 → 절삭');
        }

        // 진단: 페이로드 크기 및 photoURL 상태 로그
        const payloadSize = new Blob([JSON.stringify(payload)]).size;
        const photoType = payload.photoURL ? (payload.photoURL.startsWith('data:') ? 'base64' : payload.photoURL.startsWith('http') ? 'url' : 'other') : 'null';
        const photoLen = payload.photoURL ? payload.photoURL.length : 0;
        console.log(`[SaveData] uid=${auth.currentUser.uid}, payloadSize=${payloadSize}bytes, photoURL.type=${photoType}, photoURL.len=${photoLen}`);
        if (window.AppLogger) AppLogger.info(`[SaveData] size=${payloadSize}B, photo=${photoType}(${photoLen})`);

        // ── 진단: 기존 문서 읽기 + 필드 검증 (permission-denied 원인 분석) ──
        let _diagSnap = null;
        try {
            _diagSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (_diagSnap.exists()) {
                const _existingData = _diagSnap.data();
                const _existingKeys = Object.keys(_existingData).sort();
                const _payloadKeys = Object.keys(payload).sort();
                const _allowedFields = new Set([
                    'name','level','points','photoURL','stats','pendingStats',
                    'friends','fcmToken','syncEnabled','gpsEnabled','pushEnabled',
                    'instaId','linkedinId','nameLastChanged','lastRouletteDate','lastReelsPostTs',
                    'stepData','streak','questStr','questWeekStart','diaryStr','reelsStr',
                    'dungeonStr','diyQuestsStr','questHistoryStr','titleHistoryStr',
                    'streakStr','rareTitleStr','hasActiveReels','_profileUploadFailed','privateAccount',
                    'ddaysStr','ddayCaption','lastBonusExpDate','lifeStatusStr',
                    'libraryStr','moviesStr','runningCalcHistoryStr','ormCalcHistoryStr',
                    'big5Str','futureNetworthStr'
                ]);
                // 기존 문서의 허용되지 않은 필드
                const _extraFields = _existingKeys.filter(k => !_allowedFields.has(k));
                if (_extraFields.length > 0) {
                    if (window.AppLogger) AppLogger.warn('[SaveDiag] 기존 문서에 미허용 필드 존재: ' + _extraFields.join(', '));
                }
                // 변경된 키 (affectedKeys 시뮬레이션)
                const _affectedKeys = _payloadKeys.filter(k => JSON.stringify(payload[k]) !== JSON.stringify(_existingData[k]));
                if (window.AppLogger) AppLogger.info('[SaveDiag] affectedKeys: ' + (_affectedKeys.length > 0 ? _affectedKeys.join(', ') : '(없음)'));
                // 기존 문서+payload 병합 후 각 필드 검증
                const _merged = { ..._existingData, ...payload };
                const _issues = [];
                if ('name' in _merged && (typeof _merged.name !== 'string' || _merged.name.length < 1 || _merged.name.length > 30)) _issues.push(`name(type=${typeof _merged.name},len=${_merged.name?.length})`);
                if ('level' in _merged && (typeof _merged.level !== 'number' || _merged.level < 1 || _merged.level > 999)) _issues.push(`level(${_merged.level})`);
                if ('points' in _merged && (typeof _merged.points !== 'number' || _merged.points < 0)) _issues.push(`points(${_merged.points})`);
                if ('photoURL' in _merged && _merged.photoURL !== null && (typeof _merged.photoURL !== 'string' || _merged.photoURL.length > 1024)) _issues.push(`photoURL(len=${_merged.photoURL?.length})`);
                if ('nameLastChanged' in _merged && _merged.nameLastChanged !== null && typeof _merged.nameLastChanged !== 'number') _issues.push(`nameLastChanged(type=${typeof _merged.nameLastChanged},val=${_merged.nameLastChanged})`);
                if ('lastReelsPostTs' in _merged && typeof _merged.lastReelsPostTs !== 'number') _issues.push(`lastReelsPostTs(type=${typeof _merged.lastReelsPostTs})`);
                if ('fcmToken' in _merged && _merged.fcmToken !== null && typeof _merged.fcmToken !== 'string') _issues.push(`fcmToken(type=${typeof _merged.fcmToken})`);
                if ('instaId' in _merged && (typeof _merged.instaId !== 'string' || _merged.instaId.length > 30)) _issues.push(`instaId(len=${_merged.instaId?.length})`);
                if ('linkedinId' in _merged && (typeof _merged.linkedinId !== 'string' || _merged.linkedinId.length > 100)) _issues.push(`linkedinId(len=${_merged.linkedinId?.length})`);
                // streak 맵 검증 (기존 문서에 map으로 존재할 수 있음)
                if ('streak' in _merged) {
                    const _s = _merged.streak;
                    if (typeof _s !== 'object' || _s === null || Array.isArray(_s)) _issues.push(`streak(NOT_MAP:type=${typeof _s})`);
                    else {
                        const _validStreakKeys = new Set(['currentStreak', 'lastActiveDate', 'multiplier']);
                        const _extraStreakKeys = Object.keys(_s).filter(k => !_validStreakKeys.has(k));
                        if (_extraStreakKeys.length > 0) _issues.push(`streak(extraKeys:${_extraStreakKeys.join(',')})`);
                        if ('currentStreak' in _s && (typeof _s.currentStreak !== 'number' || _s.currentStreak < 0)) _issues.push(`streak.currentStreak(${_s.currentStreak})`);
                        if ('multiplier' in _s && (typeof _s.multiplier !== 'number' || _s.multiplier < 0)) _issues.push(`streak.multiplier(${_s.multiplier})`);
                        if ('lastActiveDate' in _s && _s.lastActiveDate !== null && typeof _s.lastActiveDate !== 'string') _issues.push(`streak.lastActiveDate(type=${typeof _s.lastActiveDate})`);
                    }
                }
                // stats/pendingStats 맵 검증
                ['stats', 'pendingStats'].forEach(fk => {
                    if (fk in _merged) {
                        const _sm = _merged[fk];
                        if (typeof _sm !== 'object' || _sm === null || Array.isArray(_sm)) { _issues.push(`${fk}(NOT_MAP)`); return; }
                        const _validStatKeys = new Set(['str', 'int', 'cha', 'vit', 'wlth', 'agi']);
                        const _extraStatKeys = Object.keys(_sm).filter(k => !_validStatKeys.has(k));
                        if (_extraStatKeys.length > 0) _issues.push(`${fk}(extraKeys:${_extraStatKeys.join(',')})`);
                    }
                });
                // 불리언 필드 검증
                ['syncEnabled', 'gpsEnabled', 'pushEnabled', 'hasActiveReels', '_profileUploadFailed', 'privateAccount'].forEach(bk => {
                    if (bk in _merged && typeof _merged[bk] !== 'boolean') _issues.push(`${bk}(type=${typeof _merged[bk]})`);
                });
                // 문자열 크기 검증
                const _strChecks = {questStr:10000,diaryStr:500000,reelsStr:500000,dungeonStr:50000,diyQuestsStr:50000,questHistoryStr:200000,titleHistoryStr:50000,streakStr:5000,rareTitleStr:10000,ddaysStr:50000,ddayCaption:200,lifeStatusStr:1000,libraryStr:50000,moviesStr:50000,runningCalcHistoryStr:10000,ormCalcHistoryStr:10000,questWeekStart:10,lastRouletteDate:10,lastBonusExpDate:10,futureNetworthStr:1000};
                for (const [sk, sl] of Object.entries(_strChecks)) {
                    if (sk in _merged && (typeof _merged[sk] !== 'string' || _merged[sk].length > sl)) _issues.push(`${sk}(type=${typeof _merged[sk]},len=${_merged[sk]?.length},limit=${sl})`);
                }
                // friends 검증
                if ('friends' in _merged && (!Array.isArray(_merged.friends) || _merged.friends.length > 500)) _issues.push(`friends(len=${_merged.friends?.length})`);
                // stepData 검증
                if ('stepData' in _merged) {
                    const _sd = _merged.stepData;
                    if (typeof _sd !== 'object' || _sd === null || Array.isArray(_sd)) _issues.push('stepData(NOT_MAP)');
                    else {
                        const _validStepKeys = new Set(['date', 'rewardedSteps', 'totalSteps']);
                        const _extraStepKeys = Object.keys(_sd).filter(k => !_validStepKeys.has(k));
                        if (_extraStepKeys.length > 0) _issues.push(`stepData(extraKeys:${_extraStepKeys.join(',')})`);
                    }
                }
                if (_issues.length > 0) {
                    console.error('[SaveDiag] 검증 실패 필드:', _issues);
                    if (window.AppLogger) AppLogger.error('[SaveDiag] 검증실패: ' + _issues.join(' | '));
                } else {
                    if (window.AppLogger) AppLogger.info('[SaveDiag] 모든 필드 검증 통과 (클라이언트 기준)');
                }
                // 전체 기존 문서 키/타입 덤프
                const _keyDump = _existingKeys.map(k => {
                    const v = _existingData[k];
                    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
                    const extra = typeof v === 'string' ? `,len=${v.length}` : '';
                    return `${k}(${t}${extra})`;
                }).join(' ');
                if (window.AppLogger) AppLogger.info('[SaveDiag] 기존문서: ' + _keyDump);
                // 키 목록만 별도 로그 (truncation 방지)
                if (window.AppLogger) AppLogger.info('[SaveDiag] existingKeys(' + _existingKeys.length + '): ' + _existingKeys.join(','));
            }
        } catch(_diagErr) {
            if (window.AppLogger) AppLogger.warn('[SaveDiag] 진단 실패: ' + (_diagErr.message || _diagErr));
        }
        // ── 진단 끝 ──

        // 디바운스(2초) + 진단 getDoc 사이에 로그아웃될 수 있으므로 재확인
        if (!auth.currentUser) {
            if (window.AppLogger) AppLogger.warn('[SaveData] setDoc 직전 auth 소실 — 저장 중단');
            return;
        }
        const _userDocRef = doc(db, "users", auth.currentUser.uid);
        if (_diagSnap && _diagSnap.exists()) {
            await updateDoc(_userDocRef, payload);
        } else {
            await setDoc(_userDocRef, payload);
        }
        console.log('[SaveData] save OK');
        if (window.AppLogger) AppLogger.info('[SaveData] Firestore 저장 성공 (' + (_diagSnap && _diagSnap.exists() ? 'update' : 'create') + ')');
    } catch(e) {
        console.error("DB 저장 실패:", e);
        if (window.AppLogger) AppLogger.error('[DB] 저장 실패: ' + (e.code || '') + ' ' + (e.message || ''), e.stack || '');

        // ── permission-denied 상세 계측: payload 필드 타입/길이/키셋 덤프 ──
        if (window.AppLogger && e.code === 'permission-denied' && typeof payload === 'object' && payload) {
            try {
                const _pdKeys = Object.keys(payload).sort();
                const _fieldDescs = _pdKeys.map(k => {
                    const v = payload[k];
                    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
                    let extra = '';
                    if (typeof v === 'string') extra = ',len=' + v.length;
                    else if (Array.isArray(v)) extra = ',len=' + v.length;
                    else if (typeof v === 'object' && v !== null) extra = ',keys=' + Object.keys(v).join('/');
                    return k + '(' + t + extra + ')';
                });
                // AppLogger 800자 제한을 고려해 청크 분할 출력
                const _PD_PREFIX = '[DB:PermDenied] payload ';
                const _PD_CHUNK_LIMIT = 750;
                let _pdChunk = '';
                let _pdIdx = 1;
                for (let i = 0; i < _fieldDescs.length; i++) {
                    const _candidate = _pdChunk ? _pdChunk + ' ' + _fieldDescs[i] : _fieldDescs[i];
                    if ((_PD_PREFIX + '(' + _pdIdx + '): ' + _candidate).length > _PD_CHUNK_LIMIT && _pdChunk) {
                        AppLogger.error(_PD_PREFIX + '(' + _pdIdx + '): ' + _pdChunk);
                        _pdIdx++;
                        _pdChunk = _fieldDescs[i];
                    } else {
                        _pdChunk = _candidate;
                    }
                }
                if (_pdChunk) AppLogger.error(_PD_PREFIX + '(' + _pdIdx + '): ' + _pdChunk);
                AppLogger.error('[DB:PermDenied] keySet(' + _pdKeys.length + '): ' + _pdKeys.join(','));
            } catch (_dumpErr) {
                // 덤프 로직 자체 실패는 무시
            }
        }

        throw e; // 호출자가 에러를 감지할 수 있도록 재전파
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
            if(data.privateAccount !== undefined) { AppState.user.privateAccount = data.privateAccount; AppState._privateAccountExplicit = true; }
            if(data.fcmToken !== undefined) AppState.user.fcmToken = data.fcmToken || null;
            // 언어 설정 복원 (로그아웃 시 localStorage.clear() 대응)
            if(data.lang) {
                AppState.currentLang = data.lang;
                try { localStorage.setItem('lang', data.lang); } catch(e) {}
                const langSelect = document.getElementById('lang-select');
                if (langSelect) langSelect.value = data.lang;
            }
            if(data.stepData) AppState.user.stepData = data.stepData;
            if(data.instaId) AppState.user.instaId = data.instaId;
            if(data.linkedinId) AppState.user.linkedinId = data.linkedinId;
            if(data.nameLastChanged != null) AppState.user.nameLastChanged = data.nameLastChanged;
            if(data.streakStr) {
                try {
                    const parsed = JSON.parse(data.streakStr);
                    if (!Array.isArray(parsed.activeDates)) parsed.activeDates = [];
                    AppState.user.streak = parsed;
                } catch(e) { AppState.user.streak = { currentStreak: 0, lastActiveDate: null, multiplier: 1.0, activeDates: [] }; }
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
            // Movies (내 영화) 복원
            if (data.moviesStr) {
                try { AppState.movies = JSON.parse(data.moviesStr); } catch(e) { AppState.movies = { items: [], rewardedIds: [] }; }
                if (!AppState.movies || !Array.isArray(AppState.movies.items)) AppState.movies = { items: [], rewardedIds: [] };
                if (!Array.isArray(AppState.movies.rewardedIds)) AppState.movies.rewardedIds = [];
            }
            // Life Status 복원 (로그아웃 시 localStorage.clear() 대응)
            if (data.lifeStatusStr) {
                localStorage.setItem('life_status_config', data.lifeStatusStr);
            }
            // 미래 순자산 복원
            if (data.futureNetworthStr) {
                localStorage.setItem('future_networth_config', data.futureNetworthStr);
                localStorage.setItem('fnw_consent', '1');
            }
            window.renderFutureNetworth?.();
            // 러닝 계산기 기록 복원 (로그아웃 시 localStorage.clear() 대응)
            if (data.runningCalcHistoryStr) {
                localStorage.setItem('running_calc_history', data.runningCalcHistoryStr);
            }
            // 1RM 계산기 기록 복원 (로그아웃 시 localStorage.clear() 대응)
            if (data.ormCalcHistoryStr) {
                localStorage.setItem('orm_calc_history', data.ormCalcHistoryStr);
            }
            // 계산기 보상 날짜 복원 (재설치/로그아웃 시 무한 보상 방지)
            if (data.rcLastRewardDate) {
                localStorage.setItem('rc_last_reward_date', data.rcLastRewardDate);
            }
            if (data.ormLastRewardDate) {
                localStorage.setItem('orm_last_reward_date', data.ormLastRewardDate);
            }
            // 온보딩 완료 상태 복원 (재설치 시 재노출 방지)
            if (data.onboardingSeen) {
                localStorage.setItem(ONBOARDING_STORAGE_KEY, data.onboardingSeen);
            }
            // Big5 결과 복원
            if (data.big5Str) {
                try {
                    const parsed = JSON.parse(data.big5Str);
                    if (parsed && typeof parsed === 'object' && 'o' in parsed) {
                        AppState.user.big5 = parsed;
                    }
                } catch(e) { AppState.user.big5 = null; }
                if (typeof window.renderBig5Card === 'function') window.renderBig5Card();
            }
            // 계산기 상태창 메인 데이터 갱신 (Firebase 복원 후)
            if (typeof window.refreshRunningCalcSummary === 'function') window.refreshRunningCalcSummary();
            if (typeof window.refreshOrmCalcSummary === 'function') window.refreshOrmCalcSummary();
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
            const syncToggleEl = document.getElementById('sync-toggle');
            healthService.applyAvailabilityUI({
                syncToggle: syncToggleEl,
                statusDiv: document.getElementById('sync-status'),
            });
            document.getElementById('gps-toggle').checked = AppState.user.gpsEnabled;
            document.getElementById('privacy-toggle').checked = AppState.user.privateAccount;
            const privacyWarningEl = document.getElementById('private-account-warning');
            if (privacyWarningEl) privacyWarningEl.style.display = AppState.user.privateAccount ? 'block' : 'none';
            bridgeUpdateCameraToggleUI();
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
                window.setProfilePreview(data.photoURL);
                // 기존 base64 프로필 이미지를 Cloud Storage로 자동 마이그레이션
                if (window.isBase64Image(data.photoURL) && auth.currentUser) {
                    _profileUploadInFlight = true;
                    window.uploadImageToStorage(`profile_images/${auth.currentUser.uid}/profile${window.getImageExtension()}`, data.photoURL)
                        .then(downloadURL => {
                            AppState.user.photoURL = downloadURL;
                            window.setProfilePreview(downloadURL);
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
                window.setProfilePreview(user.photoURL);
            }
            await saveUserData();
        }
        loadPlayerName();
    } catch(e) { console.error("데이터 로드 에러:", e); AppLogger.error('[DB] 데이터 로드 실패', e.stack || e.message); }
}

// --- 스트릭/희귀 호칭 도메인 ---
const streakRareTitleDomain = createStreakRareTitleModule({
    AppState,
    i18n,
    statKeys,
    auth,
    AppLogger,
    rareStreakTitles,
    rareStepTitles,
    rareReadingTitles,
    rareMovieTitles,
    rareSavingsTitles,
    rareRankTitles,
    rarityConfig,
    saveUserData,
    updatePointUI,
    getTitleIcon,
});

function getTodayStr() { return streakRareTitleDomain.getTodayStr(); }
function applyStreakAndDecay() { return streakRareTitleDomain.applyStreakAndDecay(); }
function updateStreak() { return streakRareTitleDomain.updateStreak(); }
function renderStreakBadge() { return streakRareTitleDomain.renderStreak(); }
function getStreakStatusText() { return streakRareTitleDomain.getStreakStatusText(); }
function recordStreakActiveDate(dateStr) { return streakRareTitleDomain.recordStreakActiveDate(dateStr); }
function openStreakGuideModal() { return streakRareTitleDomain.openStreakGuideModal(); }
function checkStreakRareTitles() { return streakRareTitleDomain.checkStreakRareTitles(); }
function checkStepRareTitles() { return streakRareTitleDomain.checkStepRareTitles(); }
function checkReadingRareTitles() { return streakRareTitleDomain.checkReadingRareTitles(); }
function checkMovieRareTitles() { return streakRareTitleDomain.checkMovieRareTitles(); }
function checkSavingsRareTitles() { return streakRareTitleDomain.checkSavingsRareTitles(); }
function checkRankRareTitles() { return streakRareTitleDomain.checkRankRareTitles(); }
function getDisplayTitle() { return streakRareTitleDomain.getDisplayTitle(); }
function getBestRareTitle() { return streakRareTitleDomain.getBestRareTitle(); }

document.addEventListener('DOMContentLoaded', () => {
    streakRareTitleDomain.bindWindowHandlers();
});

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
    if (window.updateChallengeProgress) window.updateChallengeProgress('all_clear_days');
    saveUserData();
    updatePointUI();
    showLootModal(loot);
    window.RatingManager?.triggerAfterMilestone();
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
        const claim = await getDoc(doc(db, "usernames", key));
        if (!claim.exists() || claim.data().uid !== auth.currentUser.uid) {
            if (window.AppLogger) AppLogger.info(`[ReleaseName] 본인 소유 아님, 건너뜀: "${name}"`);
            return;
        }
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
    const newName = prompt(i18n[AppState.currentLang].name_prompt || "닉네임 변경", AppState.user.name);
    if (newName && newName.trim() !== "" && newName.trim() !== AppState.user.name) {
        const trimmed = newName.trim();
        if (trimmed.length > 30) {
            alert(i18n[AppState.currentLang]?.name_too_long || "닉네임은 30자 이내로 입력해주세요.");
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
            if (window.SocialModule) window.SocialModule.updateUserData();
            if (window.AppLogger) AppLogger.info(`[NameChange] 변경 완료: "${oldName}" → "${trimmed}"`);
            saveUserData();
        } catch (e) {
            console.error("[NameChange] 닉네임 변경 실패:", e);
            if (window.AppLogger) AppLogger.error(`[NameChange] 실패: ${e.code || ''} ${e.message || ''}`, e.stack || '');
            alert(i18n[AppState.currentLang]?.name_change_error || "닉네임 변경 중 오류가 발생했습니다. 다시 시도해주세요.");
        }
    }
}

function changeInstaId() {
    const newId = prompt(i18n[AppState.currentLang].insta_prompt || "인스타 ID를 입력하세요", AppState.user.instaId);
    if (newId !== null) {
        AppState.user.instaId = newId.trim().replace('@', '');
        if (window.SocialModule) window.SocialModule.updateUserData();
        saveUserData();
    }
}

function changeLinkedInId() {
    const newId = prompt(i18n[AppState.currentLang].linkedin_prompt || "링크드인 ID를 입력하세요", AppState.user.linkedinId);
    if (newId !== null) {
        AppState.user.linkedinId = newId.trim().replace('@', '');
        if (window.SocialModule) window.SocialModule.updateUserData();
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
        const val = Math.min(100, Math.max(0, Math.round(Number(AppState.user.stats[key]) || 0)));
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

function drawRadarChartForUser(stats) {
    const centerX = 50, centerY = 50, radius = 33;
    const angles = [];
    for (let i = 0; i < 6; i++) angles.push(-Math.PI / 2 + (i * Math.PI / 3));

    const gridGroup = document.getElementById('profileRadarGrid');
    const axesGroup = document.getElementById('profileRadarAxes');

    let gridHtml = '', axesHtml = '';
    for (let level = 1; level <= 5; level++) {
        const r = radius * (level / 5); let points = '';
        for (let i = 0; i < 6; i++) points += `${centerX + r * Math.cos(angles[i])},${centerY + r * Math.sin(angles[i])} `;
        gridHtml += `<polygon points="${points.trim()}" class="radar-bg-line"></polygon>`;
    }
    for (let i = 0; i < 6; i++) axesHtml += `<line x1="50" y1="50" x2="${centerX + radius * Math.cos(angles[i])}" y2="${centerY + radius * Math.sin(angles[i])}" class="radar-bg-line"></line>`;
    gridGroup.innerHTML = gridHtml;
    axesGroup.innerHTML = axesHtml;

    const pointsGroup = document.getElementById('profileRadarPoints');
    const labelsGroup = document.getElementById('profileRadarLabels');
    let pointsHtml = '', labelsHtml = '', dataPoints = '';

    for (let i = 0; i < 6; i++) {
        const key = statKeys[i];
        const val = Math.min(100, Math.max(0, Math.round(Number(stats[key]) || 0)));
        const r = radius * (val / 100);
        const x = centerX + r * Math.cos(angles[i]);
        const y = centerY + r * Math.sin(angles[i]);
        dataPoints += `${x},${y} `;
        pointsHtml += `<circle cx="${x}" cy="${y}" r="1.2" class="radar-point"></circle>`;

        const labelRadius = radius + 9;
        const lx = centerX + labelRadius * Math.cos(angles[i]);
        const ly = centerY + labelRadius * Math.sin(angles[i]) + 2;
        let anchor = 'middle';
        if (i === 1 || i === 2) anchor = 'start';
        if (i === 4 || i === 5) anchor = 'end';

        labelsHtml += `<text x="${lx}" y="${ly - 3}" text-anchor="${anchor}" class="radar-label">${i18n[AppState.currentLang][key]}</text><text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" class="radar-value">${val}</text>`;
    }

    pointsGroup.innerHTML = pointsHtml;
    labelsGroup.innerHTML = labelsHtml;

    const polygon = document.getElementById('profilePlayerPolygon');
    polygon.setAttribute('points', '50,50 50,50 50,50 50,50 50,50 50,50');
    setTimeout(() => polygon.setAttribute('points', dataPoints.trim()), 50);
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
    // 개별 DIY 퀘스트 완료 상태 스냅샷 (dc: { [questId]: boolean })
    const dc = {};
    AppState.diyQuests.definitions.forEach(q => {
        dc[q.id] = AppState.diyQuests.completedToday[q.id] === true;
    });
    // 데일리 퀘스트 완료 상태 스냅샷 (rc: boolean[12])
    const rc = [...(AppState.quest.completedState[day] || [])];
    AppState.questHistory[today] = { r: regularCompleted, d: diyCompleted, t: totalPossible, dt: diyTotal, dc, rc };
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
        if (window.updateChallengeProgress) window.updateChallengeProgress('critical_hits');
    }

    AppState.user.points += Math.floor(pointReward * mult * factor);
    AppState.user.pendingStats[q.stat.toLowerCase()] += (statReward * factor);

    if (state[i]) {
        updateStreak();
        if (window.updateChallengeProgress) window.updateChallengeProgress('quest_count');
    }

    updateQuestHistory();
    saveUserData();
    renderQuestList();
    renderCalendar();
    updatePointUI();
    if (window.renderRoulette) window.renderRoulette();

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

// 플래너 내 DIY 퀘스트를 우선순위 태스크 형태로 렌더링
function renderPlannerDiyQuests() {
    // DIY 퀘스트는 loadPlannerForDate에서 plannerTasks에 통합되므로 별도 렌더링 불필요
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
        if (window.updateChallengeProgress) window.updateChallengeProgress('critical_hits');
    }

    AppState.user.points += Math.floor(pointReward * mult * factor);
    AppState.user.pendingStats[q.stat.toLowerCase()] += (statReward * factor);

    if (!wasCompleted) {
        updateStreak();
        if (window.updateChallengeProgress) window.updateChallengeProgress('quest_count');
    }

    updateQuestHistory();
    saveUserData();
    renderDiyQuestList();
    renderPlannerTasks();
    renderCalendar();
    updatePointUI();
    if (window.renderRoulette) window.renderRoulette();

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
    renderQstatsCalendar(); // 통계 탭 주간 진척도도 함께 갱신
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

// --- 퀘스트 통계 도메인 ---
const questStatsDomain = createQuestStatsModule({
    AppState,
    i18n,
    weeklyQuestData,
    isNativePlatform,
    getTodayStr,
});
questStatsDomain.bindWindowHandlers();

function renderQuestStats() { return questStatsDomain.render(); }
function renderQstatsCalendar() { return questStatsDomain.renderQstatsCalendar(); }

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
const DUNGEON_MAP_LOCATION_CACHE_MS = 5 * 60 * 1000;

function getDungeonMapZoomByRadius(radiusKm) {
    if (radiusKm <= 1) return 16;
    if (radiusKm <= 2) return 15;
    if (radiusKm <= 4) return 14;
    return 13;
}

function getBalsanStationIndex() {
    const idx = seoulStations.findIndex((st) => st?.name?.ko === '발산역');
    return idx >= 0 ? idx : 0;
}

async function refreshDungeonMapUserLocation(force = false) {
    const now = Date.now();
    const cachedAt = AppState.dungeon?.mapUserLocation?.fetchedAt || 0;
    if (!force && now - cachedAt < DUNGEON_MAP_LOCATION_CACHE_MS) return;

    let lat = null;
    let lng = null;
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

    try {
        if (isNative && window.Capacitor.Plugins?.Geolocation) {
            const { Geolocation } = window.Capacitor.Plugins;
            const permResult = await Geolocation.requestPermissions();
            if (permResult.location === 'denied') return;
            const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
            lat = position.coords.latitude;
            lng = position.coords.longitude;
        } else if (navigator.geolocation) {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    resolve,
                    reject,
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
                );
            });
            lat = position.coords.latitude;
            lng = position.coords.longitude;
        }
    } catch (e) {
        if (window.AppLogger) AppLogger.warn('[Dungeon] 지도용 위치 조회 실패: ' + (e.message || e));
        return;
    }

    if (typeof lat === 'number' && typeof lng === 'number') {
        AppState.dungeon.mapUserLocation = { lat, lng, fetchedAt: now };
        if (document.getElementById('dungeon')?.classList.contains('active')) {
            renderDungeon();
        }
    }
}

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
                        // 비공개 계정은 참여자 목록에서 숨김 (자기 자신은 표시)
                        const isMe = auth.currentUser?.uid === doc.id;
                        if (!data.privateAccount || isMe) {
                            participants.push({
                                id: doc.id,
                                name: data.name || '헌터',
                                photoURL: data.photoURL || null,
                                title, rareTitle,
                                instaId: data.instaId || '',
                                linkedinId: data.linkedinId || '',
                                hasContributed: !!dng.hasContributed,
                                hasProximityBonus: !!dng.hasProximityBonus,
                                statValue: Number(stats[AppState.dungeon.targetStat]) || 0,
                                isMe
                            });
                        }
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
        AppState.dungeon.raidParticipants = participants.sort((a, b) => (b.hasProximityBonus - a.hasProximityBonus) || (b.hasContributed - a.hasContributed) || (b.statValue - a.statValue));

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
        AppState.dungeon.stationIdx = AppState.user?.isAdmin ? getBalsanStationIndex() : fixedData.stationIdx;
        AppState.dungeon.targetStat = fixedData.targetStat;

        AppState.dungeon.maxParticipants = 5;

        AppState.dungeon.isJoined = false;
        AppState.dungeon.hasContributed = false;
        AppState.dungeon.isCleared = false;
        AppState.dungeon.hasProximityBonus = false;

        AppState.dungeon.globalParticipants = 0;
        AppState.dungeon.globalProgress = 0;
        AppState.dungeon.bossMaxHP = isBossRush() ? 10 : 5;
        AppState.dungeon.bossDamageDealt = 0;
        saveUserData();
    }
    if (AppState.user?.isAdmin) {
        AppState.dungeon.stationIdx = getBalsanStationIndex();
    }
    refreshDungeonMapUserLocation();
    renderDungeon();
    window.syncGlobalDungeon();
}

function renderRaidParticipants(participants) {
    if (!participants || participants.length === 0) return '';
    const lang = AppState.currentLang;
    const t = i18n[lang];
    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="color:#ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;
    const linkedinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="color:#0077b5;"><path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z"/></svg>`;

    const cards = participants.map(u => {
        const titleBadgeHTML = buildUserTitleBadgeHTML(u, '0.55rem');
        return `
        <div class="user-card ${u.isMe ? 'my-rank' : ''}" style="padding:8px;">
            <div style="display:flex; align-items:center; flex-grow:1;">
                ${u.photoURL ? `<img src="${sanitizeURL(u.photoURL)}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(u.photoURL)}',null,true)" style="width:28px; height:28px; border-radius:50%; object-fit:cover; margin-right:8px; border:1px solid var(--neon-blue);"><div style="width:28px; height:28px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue); display:none;"></div>` : `<div style="width:28px; height:28px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue);"></div>`}
                <div>
                    ${titleBadgeHTML}
                    <div style="font-size:0.8rem; display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
                        ${sanitizeText(u.name)} ${u.hasProximityBonus ? `<span class="melee-bonus-badge">⚔️ 근접 보너스</span>` : ''} ${u.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(u.instaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:4px; cursor:pointer; display:inline-flex;">${instaSvg}</button>` : ''} ${u.linkedinId ? `<button onclick="window.openLinkedInProfile('${sanitizeLinkedInId(u.linkedinId)}')" style="background:none; border:none; padding:0; margin-left:4px; cursor:pointer; display:inline-flex;">${linkedinSvg}</button>` : ''}
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
            
            const mapCenter = AppState.dungeon.mapUserLocation || { lat: st.lat, lng: st.lng };
            const mapZoom = getDungeonMapZoomByRadius(DUNGEON_RADIUS_KM);
            const mapUrl = `https://maps.google.com/maps?q=${mapCenter.lat},${mapCenter.lng}&hl=${AppState.currentLang}&z=${mapZoom}&output=embed`;
            const mapCaption = AppState.dungeon.mapUserLocation
                ? (AppState.currentLang === 'en'
                    ? `📍 You (${DUNGEON_RADIUS_KM}km radius bonus range)`
                    : AppState.currentLang === 'ja'
                        ? `📍 現在地（ボーナス半径 ${DUNGEON_RADIUS_KM}km）`
                        : `📍 내 위치 (보너스 반경 ${DUNGEON_RADIUS_KM}km 기준)`)
                : `📍 ${st.name[AppState.currentLang]}`;
            
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
                <div style="font-size:0.72rem; color:var(--text-sub); margin-top:-6px; margin-bottom:10px;">${mapCaption}</div>
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
                    AppState.dungeon.hasProximityBonus = true;
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
    if (window.updateChallengeProgress) window.updateChallengeProgress('dungeon_clear');
    saveUserData();
    renderDungeon();
    updatePointUI();
    const lang = AppState.currentLang;
    alert(`[SYSTEM] ${i18n[lang]?.boss_defeated || 'Boss Defeated!'}\n+${pts} P\n${target.toUpperCase()} +${statInc}`);

    // ★ 보상형 전면 광고 — 던전 클리어 추가 보상 (일일 제한)
    if (window.AdManager && window.AdManager.isRewardedInterstitialReady() && isNativePlatform && window.AdManager.getRiDungeonCountToday() < window.AdManager.RI_DUNGEON_DAILY_MAX) {
        const watchAd = confirm(i18n[lang].ri_dungeon_prompt || '광고를 시청하면 추가 보상을 받을 수 있습니다. 시청하시겠습니까?');
        if (watchAd) {
            window.AdManager.incrementRiDungeonCount();
            window.AdManager.showRewardedInterstitial('dungeon');
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
        drawRadarChart(); updatePointUI(); window.renderQuote?.(); window.renderDDayList?.(); window.renderDDayCaption?.(); window.renderLifeStatus?.(); window.renderFutureNetworth?.(); if (window.AdManager) window.AdManager.renderBonusExp(); if (window.updateLibraryCardCount) window.updateLibraryCardCount(); if (window.updateMovieCardCount) window.updateMovieCardCount();
    } else {
        mainEl.style.overflowY = 'auto';
    }

    // 네이티브 광고: 현재 활성 탭이 아닌 다른 탭으로 이동 시 정리
    if (window.AdManager && window.AdManager.nativeAdActiveTab && window.AdManager.nativeAdActiveTab !== tabId) {
        window.AdManager.cleanupNativeAd();
    }

    // 네이티브 광고 (dungeon만 — diary는 보상형 광고로 전환)
    if (tabId === 'dungeon') {
        setTimeout(() => { if (window.AdManager) window.AdManager.loadNativeAd('dungeon'); }, 300);
    }

    if(tabId === 'social' && window.SocialModule) window.SocialModule.fetchData();
    if(tabId === 'quests') { renderQuestList(); renderCalendar(); if (window.renderWeeklyChallenges) window.renderWeeklyChallenges(); if (window.renderRoulette) window.renderRoulette(); }
    if(tabId === 'diary') { renderPlannerCalendar(); loadPlannerForDate(diarySelectedDate); if (window.updateReelsResetTimer) window.updateReelsResetTimer(); }
    if(tabId === 'reels') { if (window.renderReelsFeed) window.renderReelsFeed(); if (window.updateReelsResetTimer) window.updateReelsResetTimer(); }
    if(tabId === 'dungeon') {
        updateDungeonStatus();
        // syncGlobalDungeon()은 updateDungeonStatus() 내부에서 이미 호출됨
    }
}

function updatePointUI() {
    const req = Math.floor(100 * Math.pow(1.5, AppState.user.level - 1));
    document.getElementById('sys-level').innerText = `Lv.${Math.floor(AppState.user.level)}`;
    document.getElementById('display-pts').innerText = AppState.user.points;
    document.getElementById('display-req-pts').innerText = req;
    document.getElementById('btn-levelup').disabled = AppState.user.points < req;
    
    const display = getDisplayTitle();
    const badgeEl = document.getElementById('prof-title-badge');
    if (display.isRare) {
        const rarityClass = rarityConfig[display.rarity]?.class || '';
        badgeEl.className = 'title-badge-combined';
        badgeEl.innerHTML = `<span class="title-badge" style="margin-bottom:0;">${display.baseIcon} ${sanitizeText(display.baseText)}</span><span class="title-badge ${rarityClass}" style="margin-bottom:0;">${display.rareIcon} ${sanitizeText(display.rareText)}</span><span class="title-info-icon">ℹ️</span>`;
    } else {
        badgeEl.className = 'title-badge';
        badgeEl.innerHTML = `${display.baseIcon} ${sanitizeText(display.baseText)} <span class="title-info-icon">ℹ️</span>`;
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
        en: `${titleVocab[top[0].k].en.pre[0]} ${titleVocab[top[1].k].en.suf[0]}`,
        ja: `${titleVocab[top[0].k].ja.pre[0]} ${titleVocab[top[1].k].ja.suf[0]}`
    };
    AppState.user.titleHistory.push({ level: AppState.user.level, title: newTitle });
    
    AppLogger.info('[LevelUp] 레벨 ' + AppState.user.level + ' 달성');
    saveUserData(); updatePointUI(); drawRadarChart();
    alert("Level Up!");
    window.RatingManager?.triggerAfterMilestone();
    // 호칭 가이드 모달창 자동 표시(openTitleModal()) 삭제 완료
}

function updateLoginLangButtons(langCode) {
    document.querySelectorAll('#login-lang-selector .login-lang-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.lang === langCode);
    });
}

/** 설정 화면의 동적 상태 메시지를 현재 언어로 갱신 */
function refreshSettingsStatusMessages() {
    const lang = i18n[AppState.currentLang];
    if (!lang) return;

    // 푸시 알림 상태
    const pushStatus = document.getElementById('push-status');
    if (pushStatus && pushStatus.style.display !== 'none') {
        if (AppState.user.pushEnabled) {
            pushStatus.innerHTML = `<span style="color:var(--neon-blue);">${lang.push_on || '푸시 알림 활성화됨'}</span>`;
        } else {
            pushStatus.innerHTML = `<span style="color:var(--text-sub);">${lang.push_off || '푸시 알림 중지됨'}</span>`;
        }
    }

    // GPS 위치 상태
    const gpsStatus = document.getElementById('gps-status');
    if (gpsStatus && gpsStatus.style.display !== 'none') {
        if (AppState.user.gpsEnabled) {
            gpsStatus.innerHTML = `<span style="color:var(--neon-blue);">${lang.gps_on || '위치 권한 활성화됨'}</span>`;
        } else {
            gpsStatus.innerHTML = `<span style="color:var(--text-sub);">${lang.gps_off || '위치 탐색 중지됨'}</span>`;
        }
    }

    // 카메라 상태
    bridgeUpdateCameraToggleUI();

    // 피트니스 동기화 상태
    const syncStatus = document.getElementById('sync-status');
    if (syncStatus && syncStatus.style.display !== 'none') {
        if (AppState.user.syncEnabled) {
            const totalSteps = AppState.user.stepData?.totalSteps || 0;
            if (totalSteps === 0) {
                syncStatus.innerHTML = `<span style="color:var(--neon-gold);">${lang.sync_no_steps || '걸음 수 기록이 없습니다. (0보)'}</span>`;
            } else {
                syncStatus.innerHTML = `<span style="color:var(--neon-blue);">${lang.sync_done || '동기화 완료'}</span>`;
            }
        } else {
            syncStatus.innerHTML = `<span style="color:var(--text-sub);">${lang.sync_off || '동기화 해제됨'}</span>`;
        }
    }
}

function changeLanguage(langCode) {
    const oldLang = AppState.currentLang;
    AppState.currentLang = langCode;
    try { localStorage.setItem('lang', langCode); } catch(e) {}

    // 언어 변경 시 푸시 토픽 재구독
    if (oldLang !== langCode && AppState.user && AppState.user.pushEnabled) {
        updateTopicSubscriptionForLanguage(oldLang, langCode);
    }

    // 언어 변경 시 Firestore에 저장 (서버 측 언어별 발송에 필요)
    if (oldLang !== langCode && auth.currentUser) {
        saveUserData();
    }
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[langCode][key]) el.innerHTML = i18n[langCode][key];
    });
    // placeholder 번역
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (i18n[langCode][key]) el.placeholder = i18n[langCode][key];
    });
    // title 속성 번역
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (i18n[langCode][key]) el.title = i18n[langCode][key];
    });
    updateLoginLangButtons(langCode);

    if(document.getElementById('app-container').classList.contains('d-flex')){
        drawRadarChart();
        if (window.SocialModule) window.SocialModule.renderUsers(AppState.social.sortCriteria);
        renderQuestList();
        renderCalendar();
        renderPlannerCalendar();
        window.renderQuote?.();
        window.renderDDayList?.();
        window.renderDDayCaption?.();
        window.renderLifeStatus?.();
        window.renderFutureNetworth?.();
        updatePointUI();
        updateDungeonStatus();
        loadPlayerName();
        if (window.updateReelsResetTimer) window.updateReelsResetTimer(); // i18n 업데이트 후 버튼 쿨다운 상태 재적용
        updateStepCountUI();
        refreshSettingsStatusMessages();
        if (typeof window.refreshRunningCalcSummary === 'function') window.refreshRunningCalcSummary();
        if (typeof window.refreshOrmCalcSummary === 'function') window.refreshOrmCalcSummary();
        window._reelsFeedLastKey = null; // 언어 변경 시 리렌더 강제
        if (window.renderReelsFeed) window.renderReelsFeed();
        if (window.renderBig5Card) window.renderBig5Card();
        if (document.querySelector('.quest-tab-btn[data-quest-tab="stats"].active')) renderQuestStats();
    }
}

// --- 명언: modules/quotes.js로 분리됨 ---

// --- 소셜 탭: modules/social.js로 분리됨 ---

// --- 로그인/인증 로직 ---
function validatePassword(pw) {
    return pw.length >= 8 && /[A-Z]/.test(pw) && (pw.match(/[^A-Za-z0-9]/g) || []).length >= 2;
}

function getFirebaseErrorMessage(error, lang) {
    const t = i18n[lang || AppState.currentLang || 'ko'] || i18n.ko;
    let code = error.code || '';
    if (!code && error.message) {
        const m = error.message.match(/\(([a-z\/-]+)\)/);
        if (m) code = m[1];
    }
    const codeMap = {
        'auth/user-disabled': 'fb_err_user_disabled',
        'auth/user-not-found': 'fb_err_user_not_found',
        'auth/wrong-password': 'fb_err_wrong_password',
        'auth/invalid-credential': 'fb_err_invalid_credential',
        'auth/email-already-in-use': 'fb_err_email_in_use',
        'auth/weak-password': 'fb_err_weak_password',
        'auth/network-request-failed': 'fb_err_network',
        'auth/too-many-requests': 'fb_err_too_many_requests',
        'auth/popup-blocked': 'fb_err_popup_blocked',
        'auth/account-exists-with-different-credential': 'fb_err_account_exists',
        'auth/requires-recent-login': 'fb_err_requires_recent_login',
        'auth/unauthorized-domain': 'fb_err_unauthorized_domain',
        'auth/internal-error': 'fb_err_internal',
        'auth/invalid-email': 'fb_err_invalid_email',
        'auth/operation-not-allowed': 'fb_err_operation_not_allowed',
        'auth/expired-action-code': 'fb_err_expired_action_code',
        'auth/invalid-action-code': 'fb_err_invalid_action_code',
        'auth/user-token-expired': 'fb_err_user_token_expired',
    };
    const key = codeMap[code];
    if (key && t[key]) return t[key];
    return t.fb_err_unknown || '오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}

function showErrorModal(title, message) {
    const existing = document.getElementById('_fb-error-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = '_fb-error-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;justify-content:center;align-items:center;backdrop-filter:blur(4px);';
    overlay.innerHTML = `<div style="background:var(--panel-bg,#1a1a2e);border:1px solid #ff4757;padding:24px 20px;border-radius:12px;width:85%;max-width:380px;display:flex;flex-direction:column;gap:14px;box-shadow:0 0 24px rgba(255,71,87,0.25);">
        <div style="font-size:1.05rem;font-weight:bold;color:#ff4757;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,71,87,0.25);padding-bottom:10px;">
            &#9888; ${title}
        </div>
        <div style="color:var(--text-main,#dde);font-size:0.92rem;line-height:1.6;word-break:keep-all;">
            ${message}
        </div>
        <button id="_fb-error-ok" style="align-self:flex-end;background:rgba(255,71,87,0.12);border:1px solid #ff4757;color:#ff4757;padding:8px 28px;border-radius:6px;cursor:pointer;font-size:0.9rem;font-weight:bold;transition:background 0.15s;">OK</button>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#_fb-error-ok').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const escHandler = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
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
    } catch (e) { const _t = i18n[AppState.currentLang] || i18n.ko; showErrorModal(_t.err_modal_auth || "인증 오류", getFirebaseErrorMessage(e, AppState.currentLang)); }
    finally { const t = i18n[AppState.currentLang] || {}; btn.innerText = AppState.isLoginMode ? (t.btn_login_submit || "시스템 접속") : (t.btn_signup_submit || "회원가입"); btn.disabled = false; }
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
        showErrorModal((i18n[lang] || i18n.ko).err_modal_pw_reset || "비밀번호 재설정 오류", getFirebaseErrorMessage(e, lang));
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
                clientId: 'GOOGLE_WEB_CLIENT_ID_PLACEHOLDER',
                scopes: ['profile', 'email'],
                grantOfflineAccess: false
            });
            // 이미 로그인한 사용자는 확인 화면 없이 자동 로그인 시도
            let googleUser;
            try {
                googleUser = await GoogleAuth.refresh();
            } catch (refreshErr) {
                const refreshCode = String(refreshErr.code || (refreshErr.error && refreshErr.error.code) || '');
                if (refreshCode === '10') {
                    // DEVELOPER_ERROR는 세션 없음이 아닌 설정 오류 → signIn() 시도해도 동일 실패
                    throw refreshErr;
                }
                // refresh 실패 시 (최초 로그인, 세션 만료 등) 대화형 로그인 진행
                googleUser = await GoogleAuth.signIn();
            }
            // v3.4.x: idToken이 최상위 또는 authentication 하위에 위치할 수 있음
            const idToken = googleUser?.authentication?.idToken || googleUser?.idToken;
            if (!idToken) {
                throw new Error('Google 인증에서 idToken을 받지 못했습니다. authentication=' + JSON.stringify(googleUser?.authentication) + ', keys=' + Object.keys(googleUser || {}).join(','));
            }
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
                    '원인 (해당하는 항목 확인):\n' +
                    'A) SHA-1 등록 후 google-services.json을 재다운로드하지 않은 경우\n' +
                    'B) GOOGLE_WEB_CLIENT_ID 시크릿이 잘못 설정된 경우\n' +
                    'C) GOOGLE_SERVICES_JSON 시크릿이 구버전인 경우\n\n' +
                    '해결 방법:\n' +
                    '1. Firebase Console → 인증 → Google → 웹 클라이언트 ID 확인\n' +
                    '   → GOOGLE_WEB_CLIENT_ID 시크릿과 일치하는지 확인\n' +
                    '2. Firebase Console → 프로젝트 설정 → Android 앱\n' +
                    '   → SHA 지문 등록 확인 후 google-services.json 재다운로드\n' +
                    '3. GOOGLE_SERVICES_JSON 시크릿 업데이트\n' +
                    '4. GitHub Actions에서 APK 재빌드 후 재설치';
            }
            showErrorModal((i18n[AppState.currentLang] || i18n.ko).err_modal_google || "Google 로그인 오류", getFirebaseErrorMessage(e, AppState.currentLang));
        }
    } else {
        // ── 웹 브라우저: 기존 Popup 방식 유지 ──
        try {
            await signInWithPopup(auth, googleProvider);
            ConversionTracker.loginComplete('google');
        } catch (e) {
            console.error("웹 구글 로그인 실패:", e);
            showErrorModal((i18n[AppState.currentLang] || i18n.ko).err_modal_google || "Google 로그인 오류", getFirebaseErrorMessage(e, AppState.currentLang));
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
                await GoogleAuth.initialize({
                    clientId: 'GOOGLE_WEB_CLIENT_ID_PLACEHOLDER',
                    scopes: ['profile', 'email'],
                    grantOfflineAccess: false
                });
                await GoogleAuth.signOut();
            }
        } catch (e) {
            AppLogger.warn('[Auth] Google signOut 실패 (무시): ' + (e.message || e));
        }
    }
    await fbSignOut(auth);
    // 관리자 설정 값 및 테마 설정은 clear 전에 보존
    const _loginLogVisible = localStorage.getItem('loginLogVisible');
    const _theme = localStorage.getItem('theme');
    const _ratingDone = localStorage.getItem('levelup_rating_done');
    const _ratingAskedTs = localStorage.getItem('levelup_rating_asked_ts');
    const _ratingInstallTs = localStorage.getItem('levelup_install_ts');
    const _ratingSessionCount = localStorage.getItem('levelup_session_count');
    localStorage.clear();
    if (_loginLogVisible !== null) localStorage.setItem('loginLogVisible', _loginLogVisible);
    if (_theme !== null) localStorage.setItem('theme', _theme);
    if (_ratingDone !== null) localStorage.setItem('levelup_rating_done', _ratingDone);
    if (_ratingAskedTs !== null) localStorage.setItem('levelup_rating_asked_ts', _ratingAskedTs);
    if (_ratingInstallTs !== null) localStorage.setItem('levelup_install_ts', _ratingInstallTs);
    if (_ratingSessionCount !== null) localStorage.setItem('levelup_session_count', _ratingSessionCount);
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
            const _loginLogVisible = localStorage.getItem('loginLogVisible');
            const _theme = localStorage.getItem('theme');
            localStorage.clear();
            if (_loginLogVisible !== null) localStorage.setItem('loginLogVisible', _loginLogVisible);
            if (_theme !== null) localStorage.setItem('theme', _theme);
            alert(t.del_done || "계정이 삭제되었습니다. 이용해 주셔서 감사합니다.");
            window.location.reload();
        }
    } catch (e) {
        AppLogger.error('[Auth] 계정 삭제 실패: ' + e.message);
        showErrorModal(t.err_modal_delete || "계정 삭제 오류", getFirebaseErrorMessage(e, AppState.currentLang));
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
        showErrorModal((i18n[AppState.currentLang] || i18n.ko).err_modal_verify || "이메일 인증 오류", getFirebaseErrorMessage(e, AppState.currentLang));
    } finally {
        btn.disabled = false;
    }
}

// --- ★ 사진 소스 선택 (카메라/갤러리) 액션시트 ★ ---
function showPhotoSourceSheet(inputId) {
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    const input = document.getElementById(inputId);
    if (!isNative) {
        // 웹: 기존 동작 유지 (갤러리만)
        input.removeAttribute('capture');
        input.click();
        return;
    }
    const lang = i18n[AppState.currentLang] || i18n.ko;
    // 기존 시트가 있으면 제거
    const existing = document.getElementById('photo-source-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'photo-source-overlay';
    overlay.className = 'book-action-overlay';
    overlay.innerHTML =
        '<div class="book-action-sheet" onclick="event.stopPropagation()">'
        + '<div class="book-action-title">' + (lang.photo_source_title || '사진 추가') + '</div>'
        + '<button class="book-action-btn" id="photo-src-camera">📷 ' + (lang.photo_source_camera || '카메라로 촬영') + '</button>'
        + '<button class="book-action-btn" id="photo-src-gallery">🖼️ ' + (lang.photo_source_gallery || '갤러리에서 선택') + '</button>'
        + '<button class="book-action-btn cancel" id="photo-src-cancel">' + (lang.photo_source_cancel || '취소') + '</button>'
        + '</div>';
    document.body.appendChild(overlay);

    // ★ 광고 숨김 (팝업 위에 겹치지 않도록) — AdManager 연동부로 위임
    hideAdsForModal();

    function close() {
        overlay.remove();
        // ★ 광고 복원 — AdManager 연동부로 위임
        resumeAdsFromModal();
    }
    overlay.addEventListener('click', close);
    document.getElementById('photo-src-cancel').addEventListener('click', close);

    document.getElementById('photo-src-camera').addEventListener('click', function() {
        close();
        input.setAttribute('capture', 'environment');
        input.click();
    });
    document.getElementById('photo-src-gallery').addEventListener('click', function() {
        close();
        input.removeAttribute('capture');
        input.click();
    });
}

function hideAdsForModal() {
    if (!isNativePlatform || !window.AdManager || typeof window.AdManager.hideForModal !== 'function') return;
    window.AdManager.hideForModal().catch(() => {});
}

function resumeAdsFromModal() {
    if (!isNativePlatform || !window.AdManager || typeof window.AdManager.resumeFromModal !== 'function') return;
    window.AdManager.resumeFromModal().catch(() => {});
}

async function loadProfileImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!auth.currentUser) {
        const lang = AppState.currentLang || 'ko';
        alert(i18n[lang]?.login_required || '로그인이 필요합니다.');
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
            const { dataURL: base64, quality: usedQuality } = await window.compressToTargetSize(canvas, 300 * 1024, 0.7, 0.2);
            _plog('B', `canvas→base64: len=${base64.length}, quality=${usedQuality}, fmt=${window._supportsWebP ? 'webp' : 'jpeg'}`);
            window.setProfilePreview(base64);
            if (!auth.currentUser) {
                _plog('C-FAIL', 'auth.currentUser is null after canvas');
                alert(i18n[lang]?.login_required || '로그인이 필요합니다.');
                return;
            }
            _plog('C', `auth OK: uid=${auth.currentUser.uid}`);
            _profileUploadInFlight = true;
            try {
                const uid = auth.currentUser.uid;
                _plog('D', 'Calling uploadImageToStorage...');
                const lang = AppState.currentLang || 'ko';
                const progressCb = window.createUploadProgressCallback(i18n[lang]?.profile_photo_uploading || '프로필 사진 업로드 중...');
                const downloadURL = await window.uploadImageToStorage(`profile_images/${uid}/profile${window.getImageExtension()}`, base64, progressCb);
                window.hideUploadProgress();
                _plog('E', `Upload OK: url=${downloadURL.substring(0, 80)}...`);
                AppState.user.photoURL = downloadURL;
                window.setProfilePreview(downloadURL);
            } catch (e) {
                window.hideUploadProgress();
                _plog('D-FAIL', `Storage 업로드 실패: ${e.code || ''} ${e.message || e}`);
                console.error('[Profile] Storage 업로드 실패 (3회 재시도 후):', e);
                // base64 직접 저장 대신 실패 플래그 기록 — Firestore 문서 비대화 방지
                AppState.user.photoURL = AppState.user.photoURL || window.DEFAULT_PROFILE_SVG;
                AppState.user._profileUploadFailed = true;
                alert(i18n[lang]?.profile_upload_fail || '프로필 사진 업로드에 실패했습니다. 네트워크 확인 후 다시 시도해주세요.');
            } finally {
                _profileUploadInFlight = false;
            }
            _plog('F', `photoURL set to: type=${AppState.user.photoURL.startsWith('http') ? 'url' : 'base64'}, len=${AppState.user.photoURL.length}`);
            try {
                _plog('G', 'Calling saveUserData...');
                await saveUserData();
                _plog('H', 'saveUserData OK');
                // 소셜 탭에 변경된 프로필 사진 즉시 반영
                if (window.SocialModule) window.SocialModule.updateUserData();
                // 로컬 릴스 캐시의 프로필 이미지도 갱신
                if (window.updateLocalReelsProfileImage) window.updateLocalReelsProfileImage();
                _plog('I', 'All done - profile image saved successfully');
            } catch (e) {
                _plog('G-FAIL', `saveUserData 실패: ${e.code || ''} ${e.message || e}`);
                console.error('[Profile] 프로필 사진 DB 저장 실패:', e);
                alert(i18n[lang]?.profile_save_fail || '프로필 사진 저장에 실패했습니다. 다시 시도해주세요.');
            }
        };
        img.onerror = () => {
            console.error('[Profile] 이미지 로드 실패');
            alert(i18n[lang]?.image_load_fail || '이미지를 불러올 수 없습니다. 다른 파일을 선택해주세요.');
        };
        img.src = e.target.result;
    };
    reader.onerror = () => {
        console.error('[Profile] 파일 읽기 실패');
        alert(i18n[lang]?.file_read_fail || '파일을 읽을 수 없습니다. 다시 시도해주세요.');
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

// --- 프로필 스탯 모달 ---
function openProfileStatsModal(userId) { return authProfileDomain.openProfileStatsModal(userId); }
function closeProfileStatsModal() { return authProfileDomain.closeProfileStatsModal(); }
async function toggleProfileModalFollow(userId) { return authProfileDomain.toggleProfileModalFollow(userId); }
async function viewUserTodayPlanner(userId) { return authProfileDomain.viewUserTodayPlanner(userId); }

// --- 프로필카드 이미지 저장 (보상형 광고 연동) ---
window.saveProfileCardAsImage = async function(userId) {
    const lang = AppState.currentLang;

    // ★ 보상형 광고: 최초 및 매 10회 저장 시 (플래너 광고 조건과 동일)
    let saveCount = parseInt(localStorage.getItem('profile_card_save_count') || '0', 10);
    saveCount++;
    localStorage.setItem('profile_card_save_count', String(saveCount));
    const shouldShowAd = (saveCount === 1) || (saveCount % 10 === 0);
    if (shouldShowAd && typeof isNativePlatform !== 'undefined' && isNativePlatform && window.AdManager) {
        try { await window.AdManager.showPlannerRewardedAd(lang); } catch (e) { console.warn('[ProfileCard] Ad failed:', e); }
    }

    // 유저 데이터 가져오기
    let u = AppState.social.users.find(x => x.id === userId);
    if (!u) return;
    const isMe = userId === auth.currentUser?.uid;
    const stats = u.stats || { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 };
    const caption = isMe ? (AppState.ddayCaption || '') : (u.ddayCaption || '');
    const followingCount = (u.friends || []).length;
    let followerCount = 0;
    AppState.social.users.forEach(su => {
        if (Array.isArray(su.friends) && su.friends.includes(userId)) followerCount++;
    });

    // 호칭 텍스트
    const baseTitle = u.title || '각성자';
    let rareTitleText = '';
    if (u.isMe) {
        const best = typeof getBestRareTitle === 'function' ? getBestRareTitle() : null;
        if (best) rareTitleText = best.title[lang] || best.title.ko;
    } else if (u.rareTitle) {
        rareTitleText = u.rareTitle.title[lang] || u.rareTitle.title.ko;
    }

    // cross-origin 이미지 안전 로드
    async function loadImageSafe(src) {
        if (!src) return null;
        try {
            if (src.startsWith('data:') || src.startsWith('blob:')) {
                return await new Promise(resolve => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => resolve(null);
                    img.src = src;
                });
            }
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
        } catch (e) { return null; }
    }

    // 캔버스 설정
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const W = 400;
    const pad = 20;
    const innerW = W - pad * 2;

    // 높이 계산
    const headerH = 80;
    const followH = 24;
    const captionH = caption ? 36 : 0;
    const radarSize = 200;
    const footerH = 30;
    const totalH = pad + headerH + followH + captionH + 10 + radarSize + footerH + pad;

    canvas.width = W;
    canvas.height = totalH;

    // 배경
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, totalH);

    // 카드 영역
    const cardX = pad - 4, cardY = pad - 4;
    const cardW = innerW + 8, cardH = totalH - pad * 2 + 8;
    ctx.fillStyle = 'rgba(15, 25, 40, 0.95)';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();

    let y = pad;

    // --- 프로필 헤더 ---
    const avatarSize = 50;
    const avatarX = pad + 8;
    const avatarCenterY = y + headerH / 2;

    // 아바타 테두리
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarCenterY, avatarSize / 2 + 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#00d9ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#1a2332';
    ctx.fill();

    // 프로필 이미지
    if (u.photoURL) {
        try {
            const profImg = await loadImageSafe(u.photoURL);
            if (profImg) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(profImg, avatarX, avatarCenterY - avatarSize / 2, avatarSize, avatarSize);
                ctx.restore();
            }
        } catch (e) {}
    }

    const textX = avatarX + avatarSize + 14;

    // 호칭
    ctx.fillStyle = '#00d9ff';
    ctx.font = 'bold 11px Pretendard, sans-serif';
    let titleY = avatarCenterY - 18;
    ctx.fillText(baseTitle, textX, titleY);
    if (rareTitleText) {
        ctx.fillStyle = '#ffcc00';
        ctx.fillText(' | ' + rareTitleText, textX + ctx.measureText(baseTitle).width, titleY);
    }

    // 이름
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Pretendard, sans-serif';
    ctx.fillText(u.name || '헌터', textX, avatarCenterY + 2);

    // 레벨
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '12px Pretendard, sans-serif';
    ctx.fillText('Lv. ' + (u.level || 1), textX, avatarCenterY + 18);

    y += headerH;

    // --- 팔로잉/팔로워 ---
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '12px Pretendard, sans-serif';
    const followText = `${followingCount} ${i18n[lang]?.prof_following || '팔로잉'}    ${followerCount} ${i18n[lang]?.prof_followers || '팔로워'}`;
    ctx.fillText(followText, pad + 10, y + 16);
    y += followH;

    // --- 좌우명 ---
    if (caption) {
        ctx.fillStyle = 'rgba(0, 217, 255, 0.15)';
        ctx.beginPath();
        ctx.roundRect(pad + 6, y + 2, innerW - 12, 28, 4);
        ctx.fill();
        // 좌측 바
        ctx.fillStyle = '#00d9ff';
        ctx.fillRect(pad + 6, y + 2, 3, 28);
        // 텍스트
        ctx.fillStyle = '#aaaaaa';
        ctx.font = 'italic 11px Pretendard, sans-serif';
        let displayCaption = caption;
        const maxCaptionW = innerW - 30;
        if (ctx.measureText(displayCaption).width > maxCaptionW) {
            while (ctx.measureText(displayCaption + '...').width > maxCaptionW && displayCaption.length > 0) {
                displayCaption = displayCaption.slice(0, -1);
            }
            displayCaption += '...';
        }
        ctx.fillText(displayCaption, pad + 16, y + 20);
        y += captionH;
    }

    y += 10;

    // --- 레이더 차트 ---
    const radarCenterX = W / 2;
    const radarCenterY = y + radarSize / 2;
    const radarRadius = 70;
    const angles = [];
    for (let i = 0; i < 6; i++) angles.push(-Math.PI / 2 + (i * Math.PI / 3));

    // 그리드
    for (let level = 1; level <= 5; level++) {
        const r = radarRadius * (level / 5);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const px = radarCenterX + r * Math.cos(angles[i]);
            const py = radarCenterY + r * Math.sin(angles[i]);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // 축
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(radarCenterX, radarCenterY);
        ctx.lineTo(radarCenterX + radarRadius * Math.cos(angles[i]), radarCenterY + radarRadius * Math.sin(angles[i]));
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // 데이터 폴리곤
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const key = statKeys[i];
        const val = Math.min(Math.round(Number(stats[key]) || 0), 100);
        const r = radarRadius * (val / 100);
        const px = radarCenterX + r * Math.cos(angles[i]);
        const py = radarCenterY + r * Math.sin(angles[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 217, 255, 0.25)';
    ctx.fill();
    ctx.strokeStyle = '#00d9ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 데이터 포인트 + 라벨
    for (let i = 0; i < 6; i++) {
        const key = statKeys[i];
        const val = Math.min(Math.round(Number(stats[key]) || 0), 100);
        const r = radarRadius * (val / 100);
        const px = radarCenterX + r * Math.cos(angles[i]);
        const py = radarCenterY + r * Math.sin(angles[i]);

        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#00d9ff';
        ctx.fill();

        // 라벨
        const labelR = radarRadius + 18;
        const lx = radarCenterX + labelR * Math.cos(angles[i]);
        const ly = radarCenterY + labelR * Math.sin(angles[i]);
        ctx.font = 'bold 10px Pretendard, sans-serif';
        ctx.fillStyle = '#aaaaaa';
        ctx.textAlign = 'center';
        ctx.fillText((i18n[lang]?.[key] || key).toUpperCase(), lx, ly - 2);
        ctx.fillStyle = '#00d9ff';
        ctx.font = '10px Pretendard, sans-serif';
        ctx.fillText(String(val), lx, ly + 10);
    }
    ctx.textAlign = 'left';

    y += radarSize;

    // --- 푸터 ---
    ctx.fillStyle = '#444';
    ctx.font = '10px Pretendard, sans-serif';
    const today = new Date().toISOString().split('T')[0];
    const footerText = 'LEVEL UP: REBOOT | ' + today;
    ctx.fillText(footerText, pad + 6, totalH - pad + 4);

    // --- 이미지 저장 ---
    const userName = (u.name || '').replace(/[^a-zA-Z0-9가-힣]/g, '');
    const fileName = `profile_${userName}_${today}.png`;
    const msgs = { ko: '이미지가 저장되었습니다.', en: 'Image saved.', ja: '画像を保存しました。' };
    const failMsgs = { ko: '이미지 저장에 실패했습니다.', en: 'Failed to save image.', ja: '画像の保存に失敗しました。' };

    try {
        const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('toBlob failed');

        let saved = false;

        // 네이티브 앱: Capacitor Filesystem API
        if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
            const Filesystem = window.Capacitor.Plugins.Filesystem;
            const dataUrl = canvas.toDataURL('image/png');
            const base64Data = dataUrl.split(',')[1];
            try {
                const dirs = ['DOCUMENTS', 'EXTERNAL', 'CACHE'];
                for (const dir of dirs) {
                    try {
                        await Filesystem.writeFile({ path: fileName, data: base64Data, directory: dir, recursive: true });
                        saved = true;
                        break;
                    } catch (dirErr) { /* 다음 디렉토리 시도 */ }
                }
            } catch (fsErr) { /* Filesystem 실패 */ }
        }

        // Web Share API
        if (!saved && navigator.share && navigator.canShare) {
            try {
                const file = new File([blob], fileName, { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file] });
                    saved = true;
                }
            } catch (shareErr) {
                if (shareErr.name === 'AbortError') saved = true;
            }
        }

        // 네이티브 인앱 오버레이 폴백
        if (!saved && isNative) {
            showImageOverlay(canvas.toDataURL('image/png'), lang);
            saved = true;
        }

        // 웹 브라우저 <a> 다운로드 폴백
        if (!saved && !isNative) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 1000);
            saved = true;
        }

        if (saved) {
            alert(msgs[lang] || msgs.ko);
        } else {
            throw new Error('All save methods failed');
        }
    } catch (e) {
        try {
            showImageOverlay(canvas.toDataURL('image/png'), lang);
        } catch (e2) {
            alert(failMsgs[lang] || failMsgs.ko);
        }
    }
};

// --- ★ 팝업 모달창 로직 (다국어 지원 호칭 표 포함) ★ ---
function closeInfoModal() {
    const m = document.getElementById('infoModal');
    m.classList.add('d-none');
    m.classList.remove('d-flex');

    // ★ 광고 복원 — AdManager 연동부로 위임
    resumeAdsFromModal();
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

    const movieHTML = rareMovieTitles.map(rt =>
        renderItem(rt, `movies_${rt.movies}`, `${rt.movies}${li18n.rare_title_movie_unit || '편'}`)
    ).join('');

    const savingsHTML = rareSavingsTitles.map(rt =>
        renderItem(rt, rt.id, `${rt.threshold}% ${li18n.rare_title_savings_rate_unit || '저축률'}`)
    ).join('');

    return `
        <div style="margin-top:20px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px;">
            <div style="font-size:0.9rem; font-weight:bold; color:var(--neon-gold); margin-bottom:10px;">
                ${li18n.rare_title_guide || '희귀 호칭 가이드'}
            </div>
            <div style="font-size:0.75rem; color:var(--text-sub); margin-bottom:12px; line-height:1.4;">
                ${li18n.rare_title_guide_desc || '스트릭 달성, 랭킹 상위권 진입, 걸음수·독서·영화 마일스톤 달성 시 특별한 희귀 호칭이 부여됩니다.'}
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
            <div style="font-size:0.8rem; font-weight:bold; color:var(--neon-blue); margin:15px 0 6px;">
                🎬 ${li18n.rare_title_movie_section || '영화 시청 달성 호칭'}
            </div>
            ${movieHTML}
            <div style="font-size:0.8rem; font-weight:bold; color:var(--neon-blue); margin:15px 0 6px;">
                💰 ${li18n.rare_title_savings_section || '저축률 달성 호칭'}
            </div>
            ${savingsHTML}
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
                { icon: '✏️', title: '수정 및 삭제', desc: '퀘스트 옆 ✎ 버튼으로 제목·설명·스탯을 수정하거나 삭제할 수 있습니다.' },
                { icon: '🗓️', title: '플래너 연동', desc: '생성한 DIY 퀘스트는 플래너의 우선순위 태스크 영역에도 자동으로 표시됩니다. 퀘스트 탭과 플래너 탭 어디서든 완료 처리할 수 있으며, 완료 상태는 양쪽에 실시간으로 반영됩니다.' }
            ]
        },
        en: {
            sections: [
                { icon: '📝', title: 'Create Your Own Quest', desc: 'Register your personal goals as quests. Set a title (max 20 chars), description (max 40 chars), and choose a stat.' },
                { icon: '🔢', title: 'Up to 6 Quests', desc: 'You can create a maximum of 6 DIY quests. Delete unused quests to make room for new ones.' },
                { icon: '🔄', title: 'Daily Auto-Reset', desc: 'Completion status resets at midnight (KST) every day, just like system quests.' },
                { icon: '📊', title: 'Stat Linked', desc: 'Choose from STR · INT · CHA · VIT · WLTH · AGI. Completing the quest rewards the selected stat.' },
                { icon: '🎯', title: 'Rewards', desc: 'Earn 20 points + 0.5 stat per completion. Streak multipliers and critical hits apply.' },
                { icon: '✏️', title: 'Edit & Delete', desc: 'Tap the ✎ button next to a quest to edit its title, description, stat, or delete it.' },
                { icon: '🗓️', title: 'Planner Integration', desc: 'Your DIY quests automatically appear in the Planner\'s priority tasks section. You can mark them complete from either the Quest tab or the Planner tab — completion status syncs in real time between both.' }
            ]
        },
        ja: {
            sections: [
                { icon: '📝', title: '自分だけのクエスト作成', desc: '自分の目標をクエストとして登録できます。タイトル(最大20文字)、説明(最大40文字)、ステータスを選択してください。' },
                { icon: '🔢', title: '最大6個まで作成可能', desc: 'DIYクエストは最大6個まで作成できます。不要なクエストは削除してから新しく作成してください。' },
                { icon: '🔄', title: '毎日自動リセット', desc: '毎日深夜0時(KST)に完了状態がリセットされます。システムクエストと同様に毎日繰り返されます。' },
                { icon: '📊', title: 'ステータス連動', desc: 'STR · INT · CHA · VIT · WLTH · AGIから1つ選択すると、完了時にそのステータスに報酬が適用されます。' },
                { icon: '🎯', title: '報酬構造', desc: '完了時に基本20ポイント + 0.5ステータスが付与され、連続達成(ストリーク)で倍率が増加します。クリティカルヒットも発動します。' },
                { icon: '✏️', title: '編集と削除', desc: 'クエスト横の✎ボタンでタイトル・説明・ステータスを変更、または削除できます。' },
                { icon: '🗓️', title: 'プランナー連動', desc: '作成したDIYクエストはプランナーの優先タスクエリアにも自動表示されます。クエストタブとプランナータブのどちらからでも完了処理でき、完了状態はリアルタイムで両方に反映されます。' }
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

    // ★ 광고 숨김 (팝업 위에 겹치지 않도록) — AdManager 연동부로 위임
    hideAdsForModal();
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

    // ★ 광고 숨김 (팝업 위에 겹치지 않도록) — AdManager 연동부로 위임
    hideAdsForModal();
}

// --- ★ 설정 가이드 모달 (푸시/GPS/피트니스) ★ ---
function openSettingsGuideModal(type) {
    const lang = AppState.currentLang;
    const l = i18n[lang];
    const titleKey = `settings_guide_${type}_title`;
    const descKey = `settings_guide_${type}_desc`;
    const title = l[titleKey] || titleKey;
    const desc = l[descKey] || descKey;

    const colors = { push: 'var(--neon-gold)', gps: 'var(--neon-blue)', fitness: 'var(--neon-purple, #b388ff)', delete: 'var(--neon-red)', privacy: 'var(--neon-purple, #b388ff)' };
    const icons = { push: '🔔', gps: '📍', fitness: '🏃', delete: '⚠️', privacy: '🔒' };
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
    const mergedImageBlocks = window.mergeConsecutiveBlocks ? window.mergeConsecutiveBlocks(Object.fromEntries(blocks)) : [];
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
    const dateDisplay = window.formatReelsTime ? window.formatReelsTime(Date.now()) : '';
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

// 클립보드 쓰기 유틸 (Android 10+ WebView 포커스 제한 우회)
// 우선순위: NativeClipboard 플러그인 → navigator.clipboard → execCommand 폴백
async function _writeToClipboard(text) {
    const cap = window.Capacitor;
    // 1) 네이티브 플러그인 (ClipboardPlugin.java 등록 필요)
    if (cap && cap.isNativePlatform && cap.isNativePlatform() &&
            cap.Plugins && cap.Plugins.NativeClipboard) {
        try {
            await cap.Plugins.NativeClipboard.write({ text });
            return true;
        } catch (_) { /* fall through */ }
    }
    // 2) 모던 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) { /* fall through */ }
    }
    // 3) 레거시 execCommand 폴백
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (_) {
        return false;
    }
}

// 플래너 요약 텍스트를 클립보드에 복사
window.sharePlannerLink = async function() {
    const lang = AppState.currentLang;
    const dateStr = diarySelectedDate;
    const entry = getDiaryEntry(dateStr);

    const tasks = (entry && entry.tasks) ? entry.tasks.filter(t => t.text) : plannerTasks.filter(t => t.text);
    const blocks = (entry && entry.blocks) ? Object.entries(entry.blocks).sort(([a],[b]) => a.localeCompare(b)) : [];
    const caption = (entry && entry.caption) ? entry.caption : (document.getElementById('planner-caption')?.value || '');

    // 모달 먼저 닫기 (포커스 복귀 후 클립보드 접근)
    const m = document.getElementById('shareModal');
    m.classList.add('d-none');
    m.classList.remove('d-flex');

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

    const ok = await _writeToClipboard(text);
    const msgs = ok
        ? { ko: '클립보드에 복사되었습니다.', en: 'Copied to clipboard.', ja: 'クリップボードにコピーしました。' }
        : { ko: '복사에 실패했습니다.', en: 'Copy failed.', ja: 'コピーに失敗しました。' };
    alert(msgs[lang] || msgs.ko);
};

// --- ★ 법적 페이지 (독립 HTML 호출) ★ ---
window.openLegalPage = function(type) {
    const pages = {
        'terms': 'terms/terms.html',
        'usage-policy': 'terms/usage-policy.html',
        'privacy': 'terms/privacy.html',
        'oss': 'terms/oss.html',
        'life-status-consent': 'terms/life-status-consent.html'
    };
    const url = pages[type];
    if (url) window.open(url, '_blank');
};
// --- Challenge & Roulette: modules/challenge-roulette.js로 분리됨 ---

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

// --- ★ 광고 관련 게임 로직 콜백 (AdManager 모듈에서 호출) ★ ---
const BONUS_EXP_AMOUNT = 50;


function applyRewardedInterstitialBonus(context) {
    const lang = AppState.currentLang;
    if (context === 'spin') {
        if (window.applySpinBonus) window.applySpinBonus();
        try { fbLogEvent(analytics, 'ri_ad_spin_bonus', { slot: parseInt(localStorage.getItem('_ri_last_spin_idx') || '0') }); } catch {}
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

async function applyBonusExpReward() {
    const lang = AppState.currentLang;
    const today = getTodayKST();

    // ★ localStorage에 확정 마킹
    const uid = auth.currentUser ? auth.currentUser.uid : '_anon';
    localStorage.setItem(`bonus_exp_date_${uid}`, today);

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

    saveUserData();
    updatePointUI();
    if (window.AdManager) window.AdManager.renderBonusExp();

    // Analytics 이벤트
    if (analytics) {
        try { fbLogEvent(analytics, 'rewarded_ad_bonus_exp', { reward: BONUS_EXP_AMOUNT }); } catch {}
    }

    alert(i18n[lang].bonus_exp_reward);
    if (window.AppLogger) AppLogger.info(`[BonusEXP] EXP +${BONUS_EXP_AMOUNT} 지급 완료`);
}

// --- ★ 플래너 기능 (일론 머스크 타임박스 스타일) ★ ---
let diarySelectedDate = getTodayStr();
let plannerWeekOffset = 0; // 주간 캘린더 주 오프셋 (0 = 현재 주, -1 = 전주, 1 = 다음주)
let monthlyCalendarYear = new Date().getFullYear();
let monthlyCalendarMonth = new Date().getMonth();
let _monthlyCalendarUnlocked = false; // 오늘 보상형 광고 시청 완료 여부
let plannerPhotoData = null; // base64 or URL
let _plannerPhotoBase64 = null; // canvas export용 base64 원본 보존 (URL 교체 후에도 유지)
let _plannerPhotoCompressing = false;
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

const plannerDomain = createPlannerDomainModule({
    AppState,
    i18n,
    isNativePlatform,
    getTodayStr,
    getDiaryEntry,
    getAllDiaryEntries,
    getDiarySelectedDate: () => diarySelectedDate,
    setDiarySelectedDate: (v) => { diarySelectedDate = v; },
    getPlannerWeekOffset: () => plannerWeekOffset,
    setPlannerWeekOffset: (v) => { plannerWeekOffset = v; },
    getMonthlyCalendarYear: () => monthlyCalendarYear,
    setMonthlyCalendarYear: (v) => { monthlyCalendarYear = v; },
    getMonthlyCalendarMonth: () => monthlyCalendarMonth,
    setMonthlyCalendarMonth: (v) => { monthlyCalendarMonth = v; },
    getMonthlyCalendarUnlocked: () => _monthlyCalendarUnlocked,
    setMonthlyCalendarUnlocked: (v) => { _monthlyCalendarUnlocked = v; },
    selectPlannerDate: (dateStr) => window.selectPlannerDate(dateStr),
    loadPlannerForDate,
    updateApplyTodayButton,
    getPlannerPhotoData: () => plannerPhotoData,
    setPlannerPhotoData: (v) => { plannerPhotoData = v; },
    getPlannerPhotoBase64: () => _plannerPhotoBase64,
    setPlannerPhotoBase64: (v) => { _plannerPhotoBase64 = v; },
    getPlannerPhotoCompressing: () => _plannerPhotoCompressing,
    setPlannerPhotoCompressing: (v) => { _plannerPhotoCompressing = v; },
});
plannerDomain.bindWindowHandlers();
window.PlannerDomain = plannerDomain;

// 주간 플래너 캘린더 렌더링 (이전/다음 주 네비게이션 지원)
function renderPlannerCalendar() {
    return plannerDomain.renderPlannerCalendar();
}

// 주간 캘린더 이전/다음 주 이동
window.changePlannerWeek = function(delta) {
    return plannerDomain.changePlannerWeek(delta);
};

// --- ★ 월간 캘린더 기능 ★ ---

// 월간 캘린더 렌더링
function renderMonthlyCalendar(year, month) {
    return plannerDomain.renderMonthlyCalendar(year, month);
}

window.selectMonthlyDate = function(dateStr) {
    return plannerDomain.selectMonthlyDate(dateStr);
};

window.changeMonthlyCalendar = function(delta) {
    monthlyCalendarMonth += delta;
    if (monthlyCalendarMonth > 11) { monthlyCalendarMonth = 0; monthlyCalendarYear++; }
    if (monthlyCalendarMonth < 0) { monthlyCalendarMonth = 11; monthlyCalendarYear--; }
    return renderMonthlyCalendar(monthlyCalendarYear, monthlyCalendarMonth);
};

window.openMonthlyCalendar = async function() {
    return plannerDomain.openMonthlyCalendar ? plannerDomain.openMonthlyCalendar() : undefined;
};

function closeMonthlyCalendar() {
    return plannerDomain.closeMonthlyCalendar();
}
window.closeMonthlyCalendar = closeMonthlyCalendar;

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
        const isDiy = !!task.diyQuestId;
        const diyQuest = isDiy ? AppState.diyQuests.definitions.find(d => d.id === task.diyQuestId) : null;
        const isDiyDone = isDiy && (AppState.diyQuests.completedToday[task.diyQuestId] || false);
        const isDone = isDiy ? isDiyDone : !!task.done;

        // 스탯 태그 (DIY만)
        const statTag = (isDiy && diyQuest) ? `<span class="diy-task-stat-inline">${sanitizeText(diyQuest.stat)}</span>` : '';

        // 체크 버튼 (모든 태스크 공통)
        let checkBtn = '';
        if (isDiy) {
            checkBtn = `<button class="task-check-btn${isDone ? ' checked' : ''}" onclick="event.stopPropagation(); window.toggleDiyQuest('${task.diyQuestId}')" ${isFuture ? 'disabled' : ''}>${isDone ? '✅' : '⬜'}</button>`;
        } else {
            checkBtn = `<button class="task-check-btn${isDone ? ' checked' : ''}" onclick="event.stopPropagation(); window.toggleTaskDone(${idx})" ${isFuture ? 'disabled' : ''}>${isDone ? '✅' : '⬜'}</button>`;
        }

        return `<div class="planner-task-item${isDiy ? ' planner-diy-item' : ''}${isDone ? ' task-done' : ''}">
            <button class="task-rank-btn${isRanked ? ' ranked' : ''}"
                    onclick="window.toggleTaskRank(${idx})"
                    ${isFuture ? 'disabled' : ''}>${rankLabel}</button>
            ${statTag}<input class="planner-task-input${isDone ? ' task-done-input' : ''}" type="text"
                   value="${task.text.replace(/"/g,'&quot;').replace(/</g,'&lt;')}"
                   placeholder="${i18n[AppState.currentLang]?.planner_task_placeholder || '할 일 입력...'}"
                   maxlength="50"
                   oninput="window.updateTaskText(${idx}, this.value)"
                   ${isFuture ? 'disabled' : ''}>
            ${checkBtn}
            ${canRemove && !isDiy ? `<button class="task-remove-btn" onclick="window.removeTask(${idx})" ${isFuture ? 'disabled' : ''}>×</button>` : ''}
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

window.toggleTaskDone = function(idx) {
    if (idx < 0 || idx >= plannerTasks.length) return;
    plannerTasks[idx].done = !plannerTasks[idx].done;
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
        alert(i18n[AppState.currentLang]?.copy_prev_plan_empty || '전일 플랜 데이터가 없습니다.');
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
        alert(i18n[AppState.currentLang]?.copy_prev_schedule_empty || '전일 시간표 데이터가 없습니다.');
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

// --- ★ 선택한 날짜 플랜 → 오늘 적용 기능 ★ ---
window.openApplyTodayModal = function() {
    const lang = AppState.currentLang;
    const today = getTodayStr();

    // 당일 선택 시 무시 (버튼 비활성화 상태이지만 방어)
    if (diarySelectedDate === today) return;

    const selectedEntry = getDiaryEntry(diarySelectedDate);
    const hasBlocks = selectedEntry && selectedEntry.blocks && Object.keys(selectedEntry.blocks).length > 0;
    const hasTasks = selectedEntry && selectedEntry.tasks && Array.isArray(selectedEntry.tasks) && selectedEntry.tasks.some(t => t.text);

    if (!hasBlocks && !hasTasks) {
        alert(i18n[lang]?.apply_today_no_data || '복사할 플랜 데이터가 없습니다.');
        return;
    }

    // 모달 타이틀 & 본문 렌더링
    const titleEl = document.getElementById('apply-today-modal-title');
    const bodyEl = document.getElementById('apply-today-modal-body');
    const confirmBtn = document.getElementById('btn-apply-today-confirm');
    const cancelBtn = document.getElementById('btn-apply-today-cancel');

    if (titleEl) titleEl.textContent = i18n[lang]?.apply_today_confirm_title || '⚠️ 플래너 덮어쓰기 경고';
    if (confirmBtn) confirmBtn.textContent = i18n[lang]?.apply_today_confirm_btn || '적용하기';
    if (cancelBtn) cancelBtn.textContent = i18n[lang]?.apply_today_cancel_btn || '취소';

    const msgTemplate = i18n[lang]?.apply_today_confirm_msg || '<b>{date}</b>의 우선순위 태스크와 시간표가 오늘(<b>{today}</b>) 플래너에 덮어쓰기됩니다.';
    if (bodyEl) bodyEl.innerHTML = msgTemplate.replace('{date}', diarySelectedDate).replace('{today}', today);

    const modal = document.getElementById('applyTodayModal');
    if (modal) { modal.classList.remove('d-none'); modal.classList.add('d-flex'); }
};

window.closeApplyTodayModal = function() {
    const modal = document.getElementById('applyTodayModal');
    if (modal) { modal.classList.add('d-none'); modal.classList.remove('d-flex'); }
};

window.confirmApplyToday = function() {
    const lang = AppState.currentLang;
    const today = getTodayStr();
    const selectedEntry = getDiaryEntry(diarySelectedDate);
    if (!selectedEntry) return;

    // 오늘 기존 엔트리 로드
    let diaries;
    try { diaries = JSON.parse(localStorage.getItem('diary_entries') || '{}'); } catch(e) { diaries = {}; }
    const todayEntry = diaries[today] || {};

    // 우선순위 태스크 복사
    if (selectedEntry.tasks && Array.isArray(selectedEntry.tasks)) {
        todayEntry.tasks = selectedEntry.tasks.map(t => ({ text: t.text || '', ranked: !!t.ranked, rankOrder: t.rankOrder || 0 }));
        todayEntry.priorities = todayEntry.tasks.filter(t => t.ranked && t.text).sort((a, b) => a.rankOrder - b.rankOrder).map(t => t.text);
    }

    // 시간표 블록 복사
    if (selectedEntry.blocks && Object.keys(selectedEntry.blocks).length > 0) {
        todayEntry.blocks = { ...selectedEntry.blocks };
        todayEntry.text = Object.entries(selectedEntry.blocks).map(([t, v]) => `[${t}] ${v}`).join(' | ').substring(0, 500);
    }

    todayEntry.timestamp = Date.now();
    diaries[today] = todayEntry;
    localStorage.setItem('diary_entries', JSON.stringify(diaries));

    // 모달 닫기
    window.closeApplyTodayModal();

    // 오늘 날짜로 이동 & 렌더링
    diarySelectedDate = today;
    renderPlannerCalendar();
    loadPlannerForDate(today);

    alert(i18n[lang]?.apply_today_success || '오늘 플래너에 적용되었습니다.');
};

// 오늘 적용 버튼 활성화/비활성화 업데이트
function updateApplyTodayButton() {
    const btn = document.getElementById('btn-apply-today');
    if (!btn) return;
    const today = getTodayStr();
    btn.disabled = (diarySelectedDate === today);
}

// --- Day1 복사/필터/정렬/렌더: modules/reels.js로 분리됨 ---

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
    updateApplyTodayButton();
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

    // 카테고리 버튼 복원
    document.querySelectorAll('#planner-category-selector .planner-category-btn').forEach(btn => btn.classList.remove('selected'));
    const savedCategory = (saved && saved.category) ? saved.category : '기타';
    const catBtn = document.querySelector(`#planner-category-selector .planner-category-btn[data-category="${savedCategory}"]`);
    if (catBtn) {
        catBtn.classList.add('selected');
    } else {
        const fallbackBtn = document.querySelector('#planner-category-selector .planner-category-btn[data-category="기타"]');
        if (fallbackBtn) fallbackBtn.classList.add('selected');
    }

    // 태스크 로드 (새 형식 우선, 구 형식 마이그레이션)
    if (saved && saved.tasks && Array.isArray(saved.tasks)) {
        plannerTasks = saved.tasks.map(t => {
            const d = { text: t.text || '', ranked: !!t.ranked, rankOrder: t.rankOrder || 0, done: !!t.done };
            if (t.diyQuestId) d.diyQuestId = t.diyQuestId;
            return d;
        });
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

    // DIY 퀘스트를 빈 태스크 슬롯에 기본값으로 채우기 (오늘 날짜만)
    if (dateStr === getTodayStr()) {
        checkDiyDailyReset();
        const diyDefs = AppState.diyQuests.definitions || [];
        diyDefs.forEach(q => {
            // 이미 diyQuestId로 연결된 항목이 있으면 스킵
            const alreadyById = plannerTasks.some(t => t.diyQuestId === q.id);
            if (alreadyById) return;
            // 동일한 텍스트가 있으면 diyQuestId 연결만 추가
            const sameText = plannerTasks.find(t => t.text === q.title && !t.diyQuestId);
            if (sameText) { sameText.diyQuestId = q.id; return; }
            // 빈 슬롯 찾아서 채우기
            const emptySlot = plannerTasks.findIndex(t => !t.text.trim());
            if (emptySlot >= 0) {
                plannerTasks[emptySlot].text = q.title;
                plannerTasks[emptySlot].diyQuestId = q.id;
            } else {
                plannerTasks.push({ text: q.title, ranked: false, rankOrder: 0, diyQuestId: q.id });
            }
        });
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
        _plannerPhotoBase64 = window.isBase64Image(saved.photo) ? saved.photo : null;
        plannerDomain.applyPlannerPhotoUI(saved.photo);
        plannerDomain.syncPlannerPhotoFromSaved(saved.photo);
    } else {
        plannerPhotoData = null;
        _plannerPhotoBase64 = null;
        plannerDomain.applyPlannerPhotoUI(null);
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

    // 오늘 적용 버튼 상태 업데이트
    updateApplyTodayButton();

    // DIY 퀘스트 플래너 연동 렌더링
    renderPlannerDiyQuests();
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

    // 태스크 데이터 수집 (diyQuestId, done 포함)
    const tasksData = plannerTasks.map(t => {
        const d = { text: t.text || '', ranked: !!t.ranked, rankOrder: t.rankOrder || 0, done: !!t.done };
        if (t.diyQuestId) d.diyQuestId = t.diyQuestId;
        return d;
    });
    // 하위 호환 priorities 배열 (순위 지정된 항목만 순서대로)
    const rankedByOrder = tasksData
        .filter(t => t.ranked && t.text)
        .sort((a, b) => a.rankOrder - b.rankOrder)
        .map(t => t.text);
    const brainDump = '';

    const selectedMood = document.querySelector('#planner-mood-selector .diary-mood-btn.selected');
    const mood = selectedMood ? selectedMood.dataset.mood : '';
    const selectedCategoryBtn = document.querySelector('#planner-category-selector .planner-category-btn.selected');
    const category = selectedCategoryBtn ? selectedCategoryBtn.dataset.category : '기타';

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
        if (window.isBase64Image(photoValue) && auth.currentUser) {
            try {
                const uid = auth.currentUser.uid;
                const plannerLang = AppState.currentLang || 'ko';
                const plannerProgressCb = window.createUploadProgressCallback(plannerLang === 'ko' ? '플래너 사진 업로드 중...' : 'Uploading planner photo...');
                const photoURL = await window.uploadImageToStorage(
                    `planner_photos/${uid}/${dateStr}${window.getImageExtension()}`, photoValue, plannerProgressCb
                );
                window.hideUploadProgress();
                photoValue = photoURL;
                plannerPhotoData = photoURL; // 메모리 캐시도 URL로 교체
                AppLogger.info('[Planner] 사진 Storage 업로드 완료');
            } catch (e) {
                window.hideUploadProgress();
                AppLogger.error('[Planner] 사진 Storage 업로드 실패: ' + (e.message || e));
                // 업로드 실패 시 사진 없이 저장 (base64 Firestore 저장 방지)
                photoValue = null;
                alert(i18n[AppState.currentLang]?.photo_upload_fail || '사진 업로드에 실패했습니다. 네트워크 확인 후 다시 시도해주세요.');
            }
        }

        diaries[dateStr] = {
            text, mood, category, timestamp: Date.now(), blocks,
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
            alert(i18n[AppState.currentLang]?.storage_full || '저장 공간이 부족합니다. 오래된 데이터를 정리해 주세요.');
            return;
        }

        if (giveReward) {
            plannerRewards[dateStr] = true;
            localStorage.setItem('planner_rewards', JSON.stringify(plannerRewards));
            AppState.user.points += 20;
            AppState.user.pendingStats.agi += 0.5;
            updatePointUI();
            drawRadarChart();
            if (window.updateChallengeProgress) window.updateChallengeProgress('planner_use');
            AppLogger.info('[Planner] 보상 지급: +20P, AGI +0.5');
        }

        await saveUserData();
        AppLogger.info('[Planner] 플래너 저장 완료: ' + dateStr);
    } catch(e) {
        AppLogger.error('[Planner] Save error: ' + (e.stack || e.message));
        alert((i18n[AppState.currentLang]?.save_error || '저장 중 오류가 발생했습니다: ') + e.message);
        return;
    } finally {
        // 저장 완료 후 버튼 재활성화
        _plannerSaving = false;
        const _saveBtn = document.getElementById('btn-planner-save');
        const _savePriorityBtn = document.getElementById('btn-planner-save-priority');
        if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.style.opacity = ''; }
        if (_savePriorityBtn) { _savePriorityBtn.disabled = false; _savePriorityBtn.style.opacity = ''; }
        // Day1 포스팅 버튼은 타이머 상태에 따라 복원
        if (window.updateReelsResetTimer) window.updateReelsResetTimer();
    }

    renderPlannerCalendar();
    alert(i18n[AppState.currentLang].diary_saved || '플래너가 저장되었습니다.');
}

// --- ★ 플래너 사진 기능 (타임테이블 사진 필수) ★ ---
function loadPlannerPhoto(e) {
    return plannerDomain.loadPlannerPhoto(e);
}

window.removePlannerPhoto = function() {
    return plannerDomain.removePlannerPhoto ? plannerDomain.removePlannerPhoto() : plannerDomain.applyPlannerPhotoUI(null);
};

window.updateCaptionCounter = function() {
    return plannerDomain.updateCaptionCounter ? plannerDomain.updateCaptionCounter() : undefined;
};

// --- ★ 릴스 기능 ★ ---

// KST 기준 오늘 날짜 문자열
function getTodayKST() {
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60 * 1000));
    return `${kst.getFullYear()}-${String(kst.getMonth()+1).padStart(2,'0')}-${String(kst.getDate()).padStart(2,'0')}`;
}

// --- Reels 기능: modules/reels.js로 분리됨 ---

function changeTheme() {
    const light = document.getElementById('theme-toggle').checked;
    document.documentElement.setAttribute('data-theme', light ? 'light' : '');
    localStorage.setItem('theme', light ? 'light' : 'dark');
}

// --- GPS 및 건강 데이터 설정 ---

/** 앱 설정 화면 열기 (Capacitor native → Android 앱 상세 설정) */
function openAppSettingsInternal() {
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
    const isNative = platformCapabilities.isNativePlatform();
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
                    const pushToggle = document.getElementById('push-toggle');
                    const statusDiv = document.getElementById('push-status');
                    pushService.applyPushEnabled({ token, pushToggle, statusDiv });
                    await setupNativePushListeners();
                }
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[PermPrompt] Push check/request error: ' + (e.message || JSON.stringify(e)));
        }
    }

    // 2) GPS 위치 — 앱 토글 off + OS 미승인일 때만 요청
    await locationService.promptGpsPermissionIfNeeded({
        gpsToggle: document.getElementById('gps-toggle'),
        statusDiv: document.getElementById('gps-status'),
    });

    // 3) 건강 데이터 — 앱 토글 off일 때만 요청
    if (!AppState.user.syncEnabled) {
        try {
            const result = await healthService.enableHealthSync({
                syncToggle: document.getElementById('sync-toggle'),
                statusDiv: document.getElementById('sync-status'),
                showMsg: false,
            });
            if (result.ok) {
                updateStepCountUI(); // 권한 승인 즉시 상태창 UI 반영
                healthService.syncHealthData({ showMsg: true }).then(() => {
                    // 권한 직후 SDK 초기화 지연으로 데이터 조회 실패 시 재시도
                    if (!AppState.user.stepData || AppState.user.stepData.totalSteps === 0) {
                        setTimeout(() => healthService.syncHealthData({ showMsg: true }), 2000);
                    }
                });
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[PermPrompt] Fitness check/request error: ' + (e.message || JSON.stringify(e)));
        }
    }

    if (window.AppLogger) AppLogger.info('[PermPrompt] 네이티브 권한 확인/요청 완료');
}

async function toggleGPS() {
    const gpsToggle = document.getElementById('gps-toggle');
    const statusDiv = document.getElementById('gps-status');
    const isChecked = !!gpsToggle?.checked;

    if (!isChecked) {
        locationService.disableGps({ gpsToggle, statusDiv, showOsSettingsGuide: true });
        return;
    }

    await locationService.enableGps({ gpsToggle, statusDiv });
}

async function toggleHealthSync() {
    const toggle = document.getElementById('sync-toggle');
    const statusDiv = document.getElementById('sync-status');

    if (toggle.checked) {
        const result = await healthService.enableHealthSync({ syncToggle: toggle, statusDiv, showMsg: true });
        if (result.ok) {
            healthService.syncHealthData({ showMsg: true });
        }
    } else {
        healthService.disableHealthSync({ syncToggle: toggle, statusDiv, showOsSettingsGuide: true });
    }
}

// --- 비공개 계정 토글 ---
function togglePrivateAccount() {
    const toggle = document.getElementById('privacy-toggle');
    const warningEl = document.getElementById('private-account-warning');
    if (toggle.checked) {
        const lang = i18n[AppState.currentLang];
        const msg = lang.private_account_confirm || '비공개 계정을 활성화하시겠습니까?';
        if (!confirm(msg)) {
            toggle.checked = false;
            return;
        }
    }
    AppState.user.privateAccount = toggle.checked;
    AppState._privateAccountExplicit = true;
    if (warningEl) warningEl.style.display = toggle.checked ? 'block' : 'none';
    saveUserData();
    if (window.AppLogger) AppLogger.info('[Privacy] privateAccount set to ' + toggle.checked);
}

// --- 카메라 권한 토글 (사진 촬영 + ISBN 바코드 스캔) ---
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
                bridgeOpenAppSettings();
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
                bridgeOpenAppSettings();
            }
        }
    }
}

function updateCameraToggleUIInternal() {
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

// 네이티브 건강 데이터 권한 요청 (Health Connect 전용)
async function requestFitnessScope() {
    return healthService.requestFitnessScope();
}

/**
 * Health Connect (네이티브)를 통한 걸음 수 조회 시도
 * @returns {number|null} 걸음 수 또는 null (사용 불가 시)
 */
async function tryHealthConnectSteps() {
    return healthService.tryHealthConnectSteps();
}

async function syncHealthData(showMsg = false) {
    return healthService.syncHealthData({ showMsg });
}

// --- 걸음수 상태창 UI 업데이트 ---
function updateStepCountUI() {
    const card = document.getElementById('step-count-card');
    if (!card) return;
    const lang = i18n[AppState.currentLang];
    const valueEl = document.getElementById('step-count-value');
    const infoEl = document.getElementById('step-count-info');
    const reqPanel = document.getElementById('step-req-panel');

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
                const healthConnectUrl = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';
                const req1Text = lang.step_req_1 || 'Health Connect 앱 설치 필요';
                const req1Html = req1Text.replace('Health Connect', `<a href="${healthConnectUrl}" target="_blank" style="color:inherit;text-decoration:underline;">Health Connect</a>`);
                const items = [
                    { icon: '📲', html: req1Html },
                    { icon: '⚙️', html: (() => {
                        const req2Text = lang.step_req_2 || '내 정보 → 피트니스 동기화(Health Connect) 활성화';
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
                    { icon: '🔑', html: lang.step_req_3 || 'Google 계정 로그인 및 활동 권한 허용 (Health Connect 연동용)' },
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
    changed = (await locationService.syncWithOsPermissions({
        gpsToggle: document.getElementById('gps-toggle'),
        statusDiv: document.getElementById('gps-status'),
    })) || changed;

    // 3) 건강 데이터: OS 상태와 앱 토글 양방향 동기화
    changed = (await healthService.syncWithOsPermissions({
        syncToggle: document.getElementById('sync-toggle'),
        statusDiv: document.getElementById('sync-status'),
    })) || changed;
    if (changed && AppState.user.syncEnabled) {
        healthService.syncHealthData({ showMsg: true });
    }

    if (changed) {
        saveUserData();
    }
}

/** 푸시 알림 초기화 — 로그인 후 호출 */
async function initPushNotifications() {
    const pushToggle = document.getElementById('push-toggle');
    if (!pushToggle) return;

    const statusDiv = document.getElementById('push-status');
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    pushService.syncToggleElement(pushToggle);

    // 이미 활성화된 상태라면 토큰 갱신 및 메시지 리스너 설정
    if (AppState.user.pushEnabled) {
        try {
            let freshToken = null;
            if (isNative) {
                freshToken = await requestNativePushPermission();
            } else {
                freshToken = await requestWebPushPermission();
            }

            if (freshToken) {
                if (freshToken !== AppState.user.fcmToken) {
                    AppState.user.fcmToken = freshToken;
                    saveUserData();
                    if (window.AppLogger) AppLogger.info('[FCM] 시작 시 토큰 갱신됨');
                }
                if (isNative) {
                    await setupNativePushListeners();
                } else {
                    await setupWebPushListeners();
                }
            } else {
                // 토큰 획득 실패 — 푸시 비활성화
                pushService.applyPushDisabled(pushToggle, statusDiv);
                if (window.AppLogger) AppLogger.warn('[FCM] 시작 시 토큰 획득 실패, 푸시 비활성화');
            }
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[FCM] 시작 시 토큰 갱신 실패: ' + (e.message || ''));
        }

        // 레거시 토픽 → 언어별 토픽 마이그레이션 (1회 실행)
        if (isNative && pushService.shouldMigrateNativeTopics()) {
            const cap = window.Capacitor;
            if (cap && cap.Plugins && cap.Plugins.FCMPlugin) {
                try { await cap.Plugins.FCMPlugin.unsubscribeTopic({ topic: 'raid_alerts' }); } catch(e) {}
                try { await cap.Plugins.FCMPlugin.unsubscribeTopic({ topic: 'daily_reminder' }); } catch(e) {}
                await subscribeNativeTopics();
                if (window.AppLogger) AppLogger.info('[FCM] 레거시 토픽 → 언어별 토픽 마이그레이션 완료');
            }
            pushService.markNativeTopicsMigrated();
        }
    }
    pushService.renderPushStatus(statusDiv);
}

/** 푸시 알림 토글 핸들러 */
async function togglePushNotificationsInternal() {
    const pushToggle = document.getElementById('push-toggle');
    if (!pushToggle) return;
    const isChecked = pushToggle.checked;
    const statusDiv = document.getElementById('push-status');
    const lang = i18n[AppState.currentLang];
    if (statusDiv) statusDiv.style.display = 'flex';

    if (!isChecked) {
        // 푸시 알림 비활성화
        pushService.applyPushDisabled(pushToggle, statusDiv);
        if (window.AppLogger) AppLogger.info('[FCM] 푸시 알림 비활성화');

        // 네이티브: 토픽 구독 해제 및 OS 권한 해제 안내
        const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        if (isNative) {
            await unsubscribeNativeTopics();
            const msg = lang.push_revoke_confirm || '알림 권한을 완전히 해제하려면 OS 설정에서 권한을 꺼야 합니다.\n앱 설정으로 이동하시겠습니까?';
            if (confirm(msg)) {
                bridgeOpenAppSettings();
            }
        }
        return;
    }

    // 푸시 알림 활성화 시도
    pushService.setRequestingStatus(statusDiv);

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
            pushService.setDeniedStatus(statusDiv);
            return;
        }

        pushService.applyPushEnabled({ token, pushToggle, statusDiv });

        if (window.AppLogger) AppLogger.info('[FCM] 토큰 등록 완료: ' + token.substring(0, 20) + '...');

        // 메시지 리스너 설정
        if (isNative) {
            await setupNativePushListeners();
        } else {
            await setupWebPushListeners();
        }
    } catch (e) {
        if (window.AppLogger) AppLogger.error('[FCM] 푸시 알림 설정 실패: ' + (e.message || JSON.stringify(e)));
        pushToggle.checked = false;
        pushService.setErrorStatus(statusDiv);
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
        vapidKey: 'BGAe3k0DShCc20txNmeXM-61AnHWcm7tDBzOvnQQYKJfhok7xROtvcAQjod4Dyd0V9xBEQyQDjpJr1hnwki7YRs', // gitleaks:allow
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

        // 백그라운드 수신 알림 이력 저장
        const noti = action.notification;
        if (window.NotificationModule) {
            window.NotificationModule.addNotification(
                noti?.title || 'LEVEL UP',
                noti?.body || '',
                data?.type || 'unknown'
            );
        }

        if (_appNavigationReady) {
            // 앱이 이미 준비된 경우 바로 네비게이션
            handleNotificationAction(data);
        } else {
            // 앱 초기화 중 — 대기열에 저장 (이력 저장용 title/body 포함)
            _pendingNotificationData = { ...data, _notifTitle: noti?.title, _notifBody: noti?.body };
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

// --- 앱 종료 확인 토스트 ---
function showExitToast(msg) {
    let toast = document.getElementById('exit-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'exit-toast';
        toast.style.cssText = 'position:fixed; bottom:100px; left:50%; transform:translateX(-50%); ' +
            'background:rgba(0,0,0,0.8); color:#fff; padding:10px 24px; border-radius:20px; ' +
            'font-size:0.85rem; font-weight:600; z-index:9999; transition:opacity 0.3s;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 1800);
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

        // 2-a) 알림 모달이 열려있으면 닫기
        const notiModal = document.getElementById('notification-modal');
        if (notiModal && !notiModal.classList.contains('d-none')) {
            if (window.NotificationModule) window.NotificationModule.closeModal();
            else notiModal.classList.add('d-none');
            return;
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

        // 4) 이미 홈 탭이면 → 두 번 눌러 앱 종료
        if (!window._backPressedOnce) {
            window._backPressedOnce = true;
            showExitToast(i18n[AppState.currentLang].exit_hint || '종료하려면 다시 누르세요');
            setTimeout(() => { window._backPressedOnce = false; }, 2000);
            return;
        }
        // 두 번째 뒤로가기 → 앱 종료
        if (cap.Plugins.App.exitApp) {
            cap.Plugins.App.exitApp();
        } else if (cap.Plugins.App.minimizeApp) {
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

        // 콜드 스타트 시 저장하지 못한 알림 이력 저장
        if (window.NotificationModule && _pendingNotificationData._notifTitle) {
            window.NotificationModule.addNotification(
                _pendingNotificationData._notifTitle,
                _pendingNotificationData._notifBody || '',
                _pendingNotificationData.type || 'unknown'
            );
        }

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

/** 네이티브 기본 토픽 구독 (언어별 레이드 알림, 일일 리마인더 등) */
async function subscribeNativeTopics() {
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.FCMPlugin) return;

    const lang = AppState.currentLang || localStorage.getItem('lang') || 'ko';
    const topics = [`raid_alerts_${lang}`, `daily_reminder_${lang}`, 'announcements'];
    for (const topic of topics) {
        try {
            await cap.Plugins.FCMPlugin.subscribeTopic({ topic });
            if (window.AppLogger) AppLogger.info('[FCM] 토픽 구독: ' + topic);
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[FCM] 토픽 구독 실패: ' + topic + ' - ' + e.message);
        }
    }
}

/** 네이티브 토픽 구독 해제 (모든 언어 토픽 + 레거시 토픽 해제) */
async function unsubscribeNativeTopics() {
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.FCMPlugin) return;

    const langs = ['ko', 'en', 'ja'];
    const baseTopics = ['raid_alerts', 'daily_reminder'];
    const topics = [];
    for (const base of baseTopics) {
        for (const lang of langs) {
            topics.push(`${base}_${lang}`);
        }
    }
    topics.push('announcements');
    // 레거시 토픽도 해제
    topics.push('raid_alerts', 'daily_reminder');

    for (const topic of topics) {
        try {
            await cap.Plugins.FCMPlugin.unsubscribeTopic({ topic });
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[FCM] 토픽 해제 실패: ' + topic);
        }
    }
}

/** 언어 변경 시 푸시 토픽 재구독 (이전 언어 해제 → 새 언어 구독) */
async function updateTopicSubscriptionForLanguage(oldLang, newLang) {
    if (oldLang === newLang) return;
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.FCMPlugin) return;

    const baseTopics = ['raid_alerts', 'daily_reminder'];
    for (const base of baseTopics) {
        try { await cap.Plugins.FCMPlugin.unsubscribeTopic({ topic: `${base}_${oldLang}` }); } catch (e) {}
        try { await cap.Plugins.FCMPlugin.subscribeTopic({ topic: `${base}_${newLang}` }); } catch (e) {}
    }
    if (window.AppLogger) AppLogger.info(`[FCM] 토픽 언어 변경: ${oldLang} → ${newLang}`);
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

    // 알림 이력 저장
    if (window.NotificationModule) {
        window.NotificationModule.addNotification(title, body, data?.type || 'unknown');
    }

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
            // 백그라운드 수신 알림 이력 저장
            if (window.NotificationModule && event.data.title) {
                window.NotificationModule.addNotification(
                    event.data.title,
                    event.data.body || '',
                    event.data.data?.type || 'unknown'
                );
            }
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

/** 링크드인 ID 검증 (영문, 숫자, 하이픈만 허용) */
function sanitizeLinkedInId(id) {
    if (typeof id !== 'string') return '';
    return id.replace(/[^a-zA-Z0-9-]/g, '');
}

/** 링크드인 프로필 열기: Instagram과 동일하게 window.open(_blank)로 열어 앱을 백그라운드 유지 */
function openLinkedInProfile(linkedinId) {
    const url = 'https://www.linkedin.com/in/' + linkedinId;
    window.open(url, '_blank');
}

/** URL 새니타이즈 (javascript: 프로토콜 차단) */
function sanitizeURL(url) {
    if (typeof url !== 'string' || !url) return '';
    const trimmed = url.trim().toLowerCase();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:text/html')) return '';
    return sanitizeAttr(url);
}

// --- D-Day: modules/dday.js로 분리됨 ---

// --- Life Status: modules/life-status.js로 분리됨 ---


// --- Module Bridge: 외부 모듈에서 접근 필요한 함수/상태 노출 ---
window.AppState = AppState;
window.saveUserData = saveUserData;
window.updatePointUI = updatePointUI;
window.drawRadarChart = drawRadarChart;
window.getTodayKST = getTodayKST;
window.getWeekStartDate = getWeekStartDate;
window.statKeys = statKeys;
window.isNativePlatform = isNativePlatform;
window._auth = auth;

// 광고 모듈용 추가 노출
window._db = db;
window._setDoc = setDoc;
window._doc = doc;
window._analytics = analytics;
window._fbLogEvent = fbLogEvent;
window.i18n = i18n;
window.getMsUntilNextKSTMidnight = getMsUntilNextKSTMidnight;
window.formatCountdown = formatCountdown;
window.applyBonusExpReward = applyBonusExpReward;
window.applyRewardedInterstitialBonus = applyRewardedInterstitialBonus;

// 소셜 모듈용 추가 노출
window._getDocs = getDocs;
window._collection = collection;
window._arrayUnion = arrayUnion;
window._arrayRemove = arrayRemove;
window.switchTab = switchTab;
window.sanitizeText = sanitizeText;
window.sanitizeURL = sanitizeURL;
window.sanitizeAttr = sanitizeAttr;
window.sanitizeInstaId = sanitizeInstaId;
window.sanitizeLinkedInId = sanitizeLinkedInId;
window.openLinkedInProfile = openLinkedInProfile;
window.buildUserTitleBadgeHTML = buildUserTitleBadgeHTML;
window.checkRankRareTitles = checkRankRareTitles;

// image-utils.js 브리지 — Firebase Storage 함수 및 NetworkMonitor 노출
window._storage              = storage;
window._ref                  = ref;
window._uploadBytes          = uploadBytes;
window._uploadBytesResumable = uploadBytesResumable;
window._getDownloadURL       = getDownloadURL;
window._deleteObject         = deleteObject;
window.NetworkMonitor        = NetworkMonitor;

// 릴스 모듈용 추가 노출
window._getDoc = getDoc;
window.getDiaryEntry = getDiaryEntry;
window.getTodayStr = getTodayStr;
Object.defineProperty(window, 'plannerPhotoData', {
    get: function() { return plannerPhotoData; },
    configurable: true
});
Object.defineProperty(window, 'diarySelectedDate', {
    get: function() { return diarySelectedDate; },
    configurable: true
});

// 뽀모도로/서재 모듈용 추가 노출
window.showInAppNotification = showInAppNotification;
window.changeLanguage = changeLanguage;
window._httpsCallable = httpsCallable;
window._functions = functions;
window.checkReadingRareTitles = checkReadingRareTitles;
window.checkMovieRareTitles = checkMovieRareTitles;
window.checkSavingsRareTitles = checkSavingsRareTitles;
window.updateCameraToggleUI = bridgeUpdateCameraToggleUI;
window.openAppSettings = bridgeOpenAppSettings;
window.PermissionBridge = {
    getPermissionState: (type) => getPermissionService().getPermissionState(type),
    requestPermission: (type) => getPermissionService().requestPermission(type),
    openAppSettings: (...args) => bridgeOpenAppSettings(...args),
    updateCameraToggleUI: (...args) => bridgeUpdateCameraToggleUI(...args),
    togglePushNotifications: (...args) => bridgeTogglePushNotifications(...args),
};

// 알림 모듈용 Firestore query 노출
window._query = query;
window._where = where;
window._orderBy = orderBy;
window._limit = limit;
window._deleteDoc = deleteDoc;

// --- Image Utils 모듈 동적 로드 (다른 모듈보다 먼저) ---
import('./modules/image-utils.js').catch(e => console.error('[ImageUtils] 모듈 로드 실패:', e));

// --- Ad Manager 모듈 동적 로드 ---
import('./modules/ad-manager.js').catch(e => console.error('[AdManager] 모듈 로드 실패:', e));

// --- Social 모듈 동적 로드 ---
import('./modules/social.js').catch(e => console.error('[Social] 모듈 로드 실패:', e));

// --- Exercise Calculator 모듈 (Running + 1RM) 동적 로드 ---
import('./modules/exercise-calc.js').catch(e => console.error('[ExerciseCalc] 모듈 로드 실패:', e));

// --- Pomodoro 모듈 동적 로드 ---
import('./modules/pomodoro.js').catch(e => console.error('[Pomodoro] 모듈 로드 실패:', e));

// --- Meditation 모듈 동적 로드 ---
import('./modules/meditation.js').catch(e => console.error('[Meditation] 모듈 로드 실패:', e));

// --- Library 모듈 동적 로드 ---
import('./modules/library.js').catch(e => console.error('[Library] 모듈 로드 실패:', e));

// --- Movie 모듈 동적 로드 ---
import('./modules/movie.js').catch(e => console.error('[Movie] 모듈 로드 실패:', e));

// --- Notification 모듈 동적 로드 ---
import('./modules/notification.js').catch(e => console.error('[Notification] 모듈 로드 실패:', e));

// --- Quotes 모듈 동적 로드 ---
import('./modules/quotes.js').catch(e => console.error('[Quotes] 모듈 로드 실패:', e));

// --- D-Day 모듈 동적 로드 ---
import('./modules/dday.js').catch(e => console.error('[DDay] 모듈 로드 실패:', e));

// --- Life Status 모듈 동적 로드 ---
import('./modules/life-status.js').catch(e => console.error('[LifeStatus] 모듈 로드 실패:', e));
import('./modules/future-networth.js').catch(e => console.error('[FutureNetworth] 모듈 로드 실패:', e));

// --- Challenge & Roulette 모듈 동적 로드 ---
import('./modules/challenge-roulette.js').catch(e => console.error('[ChallengeRoulette] 모듈 로드 실패:', e));

// --- Reels (Day1) 모듈 동적 로드 ---
import('./modules/reels.js').catch(e => console.error('[Reels] 모듈 로드 실패:', e));
import('./modules/personality.js').catch(e => console.error('[Personality] 모듈 로드 실패:', e));

// --- Rating Manager 모듈 동적 로드 ---
import('./modules/rating-manager.js').catch(e => console.error('[RatingManager] 모듈 로드 실패:', e));
