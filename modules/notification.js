// ===== 알림/공지사항 모듈 (모달 방식) =====
(function() {
    'use strict';

    const STORAGE_KEY = 'notification_history';
    const MAX_HISTORY = 50;

    // 외부 의존은 window.* 경유
    const AppState = window.AppState;
    const i18n = window.i18n;
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
        updateUnreadBadge();
    }

    function clearHistory() {
        localStorage.removeItem(STORAGE_KEY);
        render();
    }

    function markAllRead() {
        const list = getHistory();
        let changed = false;
        list.forEach(item => { if (!item.read) { item.read = true; changed = true; } });
        if (changed) saveHistory(list);
        updateUnreadBadge();
    }

    function getUnreadCount() {
        return getHistory().filter(item => !item.read).length;
    }

    function updateUnreadBadge() {
        const badge = document.getElementById('noti-unread-badge');
        if (!badge) return;
        const count = getUnreadCount();
        if (count > 0) {
            badge.style.display = '';
            badge.textContent = count > 9 ? '9+' : String(count);
        } else {
            badge.style.display = 'none';
        }
    }

    // --- 공지사항 로드 (Cloud Function) ---
    async function fetchAnnouncements() {
        const now = Date.now();
        if (_announcementsCache && (now - _lastFetchTime) < CACHE_TTL) {
            return _announcementsCache;
        }

        try {
            if (httpsCallable && functions) {
                const fn = httpsCallable(functions, 'ping');
                const result = await fn({ action: 'getActiveAnnouncements' });
                if (result.data && result.data.announcements) {
                    _announcementsCache = result.data.announcements;
                    _lastFetchTime = now;
                    return _announcementsCache;
                }
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

    // --- 모달 열기/닫기 ---
    function openModal() {
        const modal = document.getElementById('notification-modal');
        if (modal) {
            modal.classList.remove('d-none');
            render();
        }
    }

    function closeModal() {
        const modal = document.getElementById('notification-modal');
        if (modal) {
            modal.classList.add('d-none');
        }
        markAllRead();
    }

    // --- UI 렌더링 ---
    function render() {
        const annArea = document.getElementById('noti-announcements-area');
        const histArea = document.getElementById('noti-history-area');
        if (!annArea || !histArea) return;

        const lang = (AppState && AppState.currentLang) || 'ko';
        const t = (key) => (i18n && i18n[lang] && i18n[lang][key]) || key;

        // 공지사항 렌더링
        fetchAnnouncements().then(announcements => {
            if (!announcements || announcements.length === 0) {
                annArea.innerHTML = '<div class="noti-section-label">📢 ' + sanitizeText(t('noti_announcements')) + '</div>'
                    + '<div class="noti-empty">' + sanitizeText(t('noti_no_announcements')) + '</div>';
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
    }

    // --- 초기화 ---
    function init() {
        // 이력 지우기 버튼
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

        // 모달 뒤로가기 버튼
        const backBtn = document.getElementById('btn-noti-back');
        if (backBtn) {
            backBtn.addEventListener('click', closeModal);
        }

        // 햄버거 메뉴에서 알림 버튼
        const notiBtn = document.getElementById('btn-open-notification');
        if (notiBtn) {
            notiBtn.addEventListener('click', () => {
                // 햄버거 메뉴 닫기
                const popup = document.getElementById('hamburger-menu-popup');
                const backdrop = document.getElementById('hamburger-menu-backdrop');
                if (popup) popup.classList.add('d-none');
                if (backdrop) backdrop.classList.add('d-none');
                openModal();
            });
        }

        updateUnreadBadge();
    }

    // window에 모듈 노출
    window.NotificationModule = {
        init: init,
        render: render,
        addNotification: addNotification,
        clearHistory: clearHistory,
        openModal: openModal,
        closeModal: closeModal,
        updateBadge: updateUnreadBadge
    };

    // DOM 준비 후 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
