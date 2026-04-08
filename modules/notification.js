// ===== 알림/공지사항 모듈 =====
(function() {
    'use strict';

    const STORAGE_KEY = 'notification_history';
    const MAX_HISTORY = 50;

    // 외부 의존은 window.* 경유
    const AppState = window.AppState;
    const i18n = window.i18n;
    const db = window._db;
    const collection = window._collection;
    const getDocs = window._getDocs;
    const query = window._query;
    const where = window._where;
    const orderBy = window._orderBy;
    const sanitizeText = window.sanitizeText;
    const httpsCallable = window._httpsCallable;
    const functions = window._functions;

    let _announcementsCache = null;
    let _lastFetchTime = 0;
    const CACHE_TTL = 5 * 60 * 1000; // 5분

    // --- 알림 이력 관리 (localStorage) ---
    function getHistory() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch(e) { return []; }
    }

    function saveHistory(list) {
        try {
            if (list.length > MAX_HISTORY) {
                list = list.slice(0, MAX_HISTORY);
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch(e) {
            if (window.AppLogger) window.AppLogger.warn('[Notification] 이력 저장 실패: ' + e.message);
        }
    }

    function addNotification(title, body, type) {
        const list = getHistory();
        list.unshift({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            title: title || '',
            body: body || '',
            type: type || 'unknown',
            timestamp: Date.now(),
            read: false
        });
        saveHistory(list);
    }

    function clearHistory() {
        localStorage.removeItem(STORAGE_KEY);
        renderNotificationCard();
    }

    function markAllRead() {
        const list = getHistory();
        let changed = false;
        list.forEach(item => { if (!item.read) { item.read = true; changed = true; } });
        if (changed) saveHistory(list);
    }

    // --- 공지사항 로드 (Firestore 또는 Cloud Function) ---
    async function fetchAnnouncements() {
        const now = Date.now();
        if (_announcementsCache && (now - _lastFetchTime) < CACHE_TTL) {
            return _announcementsCache;
        }

        try {
            // Cloud Function 경유 (Firestore 보안 규칙 우회 불필요)
            if (httpsCallable && functions) {
                const fn = httpsCallable(functions, 'ping');
                const result = await fn({ action: 'getActiveAnnouncements' });
                if (result.data && result.data.announcements) {
                    _announcementsCache = result.data.announcements;
                    _lastFetchTime = now;
                    return _announcementsCache;
                }
            }

            // Firestore 직접 쿼리 (폴백)
            if (db && collection && getDocs && query && where && orderBy) {
                const q = query(
                    collection(db, 'announcements'),
                    where('active', '==', true),
                    orderBy('createdAt', 'desc')
                );
                const snap = await getDocs(q);
                const list = [];
                snap.forEach(doc => {
                    const d = doc.data();
                    list.push({
                        id: doc.id,
                        title: d.title,
                        body: d.body,
                        pinned: d.pinned || false,
                        createdAt: d.createdAt ? d.createdAt.toMillis() : 0
                    });
                });
                _announcementsCache = list;
                _lastFetchTime = now;
                return list;
            }
        } catch(e) {
            if (window.AppLogger) window.AppLogger.warn('[Notification] 공지사항 로드 실패: ' + e.message);
        }
        return _announcementsCache || [];
    }

    // --- 타입별 아이콘 ---
    function getTypeIcon(type) {
        const icons = {
            'raid_start': '⚔️', 'raid_end': '⚔️', 'raid_alert': '⚔️',
            'daily_reminder': '📅', 'quest_reminder': '📜',
            'streak_warning': '🔥', 'streak_broken': '💔',
            'comeback_24h': '👋', 'comeback_72h': '👋', 'comeback_7d': '👋',
            'announcement': '📢', 'unknown': '🔔'
        };
        return icons[type] || '🔔';
    }

    // --- 시간 포맷 ---
    function formatTime(ts) {
        const diff = Date.now() - ts;
        const min = Math.floor(diff / 60000);
        const hour = Math.floor(diff / 3600000);
        const day = Math.floor(diff / 86400000);

        if (min < 1) return 'now';
        if (min < 60) return min + 'm';
        if (hour < 24) return hour + 'h';
        if (day < 7) return day + 'd';

        const d = new Date(ts);
        return (d.getMonth() + 1) + '/' + d.getDate();
    }

    // --- UI 렌더링 ---
    function renderNotificationCard() {
        const annArea = document.getElementById('noti-announcements-area');
        const histArea = document.getElementById('noti-history-area');
        if (!annArea || !histArea) return;

        const lang = (AppState && AppState.currentLang) || 'ko';
        const t = (key) => (i18n && i18n[lang] && i18n[lang][key]) || key;

        // 공지사항 렌더링
        fetchAnnouncements().then(announcements => {
            if (!announcements || announcements.length === 0) {
                annArea.innerHTML = '';
                return;
            }

            // pinned 우선 정렬
            const sorted = [...announcements].sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return (b.createdAt || 0) - (a.createdAt || 0);
            });

            let html = '<div class="noti-section-label">📢 ' + sanitizeText(t('noti_announcements')) + '</div>';
            sorted.forEach(ann => {
                const title = (ann.title && typeof ann.title === 'object') ? (ann.title[lang] || ann.title.ko || '') : (ann.title || '');
                const body = (ann.body && typeof ann.body === 'object') ? (ann.body[lang] || ann.body.ko || '') : (ann.body || '');
                const pinnedBadge = ann.pinned ? '<span class="noti-badge-pinned">📌 ' + sanitizeText(t('noti_pinned')) + '</span>' : '';

                html += '<div class="noti-announcement-item">'
                    + '<div class="noti-ann-header">'
                    + pinnedBadge
                    + '<span class="noti-ann-title">' + sanitizeText(title) + '</span>'
                    + '</div>'
                    + '<div class="noti-ann-body">' + sanitizeText(body) + '</div>'
                    + '</div>';
            });
            annArea.innerHTML = html;
        });

        // 푸시 이력 렌더링
        const history = getHistory();
        if (history.length === 0) {
            histArea.innerHTML = '<div class="noti-section-label">🔔 ' + sanitizeText(t('noti_push_history')) + '</div>'
                + '<div class="noti-empty">' + sanitizeText(t('noti_no_history')) + '</div>';
            return;
        }

        let html = '<div class="noti-section-label">🔔 ' + sanitizeText(t('noti_push_history')) + '</div>';
        history.forEach(item => {
            const unreadClass = item.read ? '' : ' noti-unread';
            const newBadge = item.read ? '' : '<span class="noti-badge-new">' + sanitizeText(t('noti_new_badge')) + '</span>';
            html += '<div class="noti-history-item' + unreadClass + '">'
                + '<div class="noti-history-icon">' + getTypeIcon(item.type) + '</div>'
                + '<div class="noti-history-body">'
                + '<div class="noti-history-title">' + sanitizeText(item.title || 'LEVEL UP') + newBadge + '</div>'
                + '<div class="noti-history-text">' + sanitizeText(item.body || '') + '</div>'
                + '<div class="noti-time">' + formatTime(item.timestamp) + '</div>'
                + '</div>'
                + '</div>';
        });
        histArea.innerHTML = html;

        // 렌더 후 읽음 처리
        markAllRead();
    }

    // --- 초기화 ---
    function init() {
        const clearBtn = document.getElementById('btn-noti-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                const lang = (AppState && AppState.currentLang) || 'ko';
                const t = (key) => (i18n && i18n[lang] && i18n[lang][key]) || key;
                if (confirm(t('noti_clear_confirm'))) {
                    clearHistory();
                }
            });
        }
        renderNotificationCard();
    }

    // window에 모듈 노출
    window.NotificationModule = {
        init: init,
        render: renderNotificationCard,
        addNotification: addNotification,
        clearHistory: clearHistory
    };

    // DOM 준비 후 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
