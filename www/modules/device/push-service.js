function noop() {}

export function createPushService(deps = {}) {
    const {
        getAppState,
        saveUserData = noop,
        getCurrentLang,
        i18n = {},
        AppLogger,
    } = deps;

    let pendingPermissionPrompts = false;

    function getLangPack() {
        const lang = typeof getCurrentLang === 'function' ? getCurrentLang() : 'ko';
        return i18n[lang] || i18n.ko || {};
    }

    function syncToggleElement(pushToggle) {
        if (!pushToggle) return;
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        pushToggle.checked = !!appState?.user?.pushEnabled;
    }

    function renderPushStatus(statusDiv) {
        if (!statusDiv) return;
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        const lang = getLangPack();
        statusDiv.style.display = 'flex';
        if (appState?.user?.pushEnabled) {
            statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${lang.push_on || '푸시 알림 활성화됨'}</span>`;
            return;
        }
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${lang.push_off || '푸시 알림 중지됨'}</span>`;
    }

    function setRequestingStatus(statusDiv) {
        if (!statusDiv) return;
        const lang = getLangPack();
        statusDiv.style.display = 'flex';
        statusDiv.innerHTML = `<span style="color:var(--neon-gold);">${lang.push_requesting || '알림 권한 요청 중...'}</span>`;
    }

    function setDeniedStatus(statusDiv) {
        if (!statusDiv) return;
        const lang = getLangPack();
        statusDiv.style.display = 'flex';
        statusDiv.innerHTML = `<span style="color:var(--neon-red);">${lang.push_denied || '알림 권한이 거부되었습니다.'}</span>`;
    }

    function setErrorStatus(statusDiv) {
        if (!statusDiv) return;
        const lang = getLangPack();
        statusDiv.style.display = 'flex';
        statusDiv.innerHTML = `<span style="color:var(--neon-red);">${lang.push_err || '푸시 알림 설정 실패'}</span>`;
    }

    function applyPushDisabled(pushToggle, statusDiv) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        if (appState?.user) {
            appState.user.pushEnabled = false;
            appState.user.fcmToken = null;
            saveUserData();
        }
        if (pushToggle) pushToggle.checked = false;
        renderPushStatus(statusDiv);
    }

    function applyPushEnabled({ token, pushToggle, statusDiv }) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        if (appState?.user) {
            appState.user.pushEnabled = true;
            appState.user.fcmToken = token;
            saveUserData();
        }
        if (pushToggle) pushToggle.checked = true;
        renderPushStatus(statusDiv);
    }

    function shouldMigrateNativeTopics(storage = window.localStorage) {
        try {
            return storage.getItem('push_topic_v2') !== '1';
        } catch (e) {
            AppLogger?.warn?.('[PushService] push_topic_v2 조회 실패: ' + (e.message || e));
            return false;
        }
    }

    function markNativeTopicsMigrated(storage = window.localStorage) {
        try {
            storage.setItem('push_topic_v2', '1');
        } catch (e) {
            AppLogger?.warn?.('[PushService] push_topic_v2 저장 실패: ' + (e.message || e));
        }
    }

    function markPermissionPromptPending() {
        pendingPermissionPrompts = true;
    }

    function consumePendingPermissionPrompt() {
        if (!pendingPermissionPrompts) return false;
        pendingPermissionPrompts = false;
        return true;
    }

    return {
        syncToggleElement,
        renderPushStatus,
        setRequestingStatus,
        setDeniedStatus,
        setErrorStatus,
        applyPushDisabled,
        applyPushEnabled,
        shouldMigrateNativeTopics,
        markNativeTopicsMigrated,
        markPermissionPromptPending,
        consumePendingPermissionPrompt,
    };
}
