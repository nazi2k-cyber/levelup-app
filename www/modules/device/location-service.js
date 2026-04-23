function isPermissionDeniedError(error = {}) {
    const message = (error.message || '').toLowerCase();
    return message.includes('denied') || message.includes('permission');
}

function normalizeGpsErrorCode(error = {}) {
    const message = (error.message || '').toLowerCase();
    if (isPermissionDeniedError(error)) return 'denied';
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('unavailable') || message.includes('not available')) return 'unavailable';
    return 'unknown';
}

export function createLocationService(deps = {}) {
    const {
        capabilities,
        getAppState,
        saveUserData,
        getCurrentLang,
        i18n = {},
        AppLogger,
        confirm = window.confirm,
        openAppSettings,
    } = deps;

    function getLangPack() {
        const lang = typeof getCurrentLang === 'function' ? getCurrentLang() : 'ko';
        return i18n[lang] || i18n.ko || {};
    }

    function setStatus(statusDiv, html) {
        if (!statusDiv) return;
        statusDiv.style.display = 'flex';
        statusDiv.innerHTML = html;
    }

    function setToggleChecked(gpsToggle, checked) {
        if (gpsToggle) gpsToggle.checked = checked;
    }

    function disableGps({ gpsToggle, statusDiv, showOsSettingsGuide = false } = {}) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        const lang = getLangPack();

        if (appState?.user) {
            appState.user.gpsEnabled = false;
            if (typeof saveUserData === 'function') saveUserData();
        }
        setToggleChecked(gpsToggle, false);
        setStatus(statusDiv, `<span style="color:var(--text-sub);">${lang.gps_off || '위치 탐색 중지됨'}</span>`);

        if (showOsSettingsGuide && capabilities?.isNativePlatform?.()) {
            const msg = lang.gps_revoke_confirm || '위치 권한을 완전히 해제하려면 OS 설정에서 권한을 꺼야 합니다.\n앱 설정으로 이동하시겠습니까?';
            if (confirm(msg)) openAppSettings?.();
        }
    }

    async function enableGps({ gpsToggle, statusDiv } = {}) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        const lang = getLangPack();

        if (!capabilities?.supportsGps?.()) {
            setStatus(statusDiv, `<span style="color:var(--neon-red);">${lang.gps_no_support || '위치 서비스를 지원하지 않는 환경입니다. 앱에서 이용해주세요.'}</span>`);
            setToggleChecked(gpsToggle, false);
            AppLogger?.warn?.('[gps.read.failed] Native Geolocation plugin not available');
            return { ok: false, code: 'unavailable' };
        }

        const geolocation = capabilities.getGeolocationPlugin();
        setStatus(statusDiv, `<span style="color:var(--neon-gold);">${lang.gps_searching || '위치 탐색 중...'}</span>`);

        try {
            const permResult = await geolocation.requestPermissions();
            AppLogger?.info?.('[GPS] Native permission result: ' + JSON.stringify(permResult));

            if (permResult.location === 'denied') {
                setStatus(statusDiv, `<span style="color:var(--neon-red);">${lang.gps_denied || '위치 권한이 거부되었습니다. 설정에서 권한을 허용해주세요.'}</span>`);
                setToggleChecked(gpsToggle, false);
                const confirmMsg = lang.gps_denied_confirm || '위치 권한이 거부된 상태입니다.\n앱 설정에서 위치 권한을 허용하시겠습니까?';
                if (confirm(confirmMsg)) openAppSettings?.();
                AppLogger?.warn?.('[gps.read.failed] permission denied');
                return { ok: false, code: 'denied' };
            }

            const position = await geolocation.getCurrentPosition({
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 300000,
            });

            AppLogger?.info?.(`[GPS] Native location: lat=${position.coords.latitude}, lng=${position.coords.longitude}`);
            if (appState?.user) {
                appState.user.gpsEnabled = true;
                if (typeof saveUserData === 'function') saveUserData();
            }
            setToggleChecked(gpsToggle, true);
            setStatus(statusDiv, `<span style="color:var(--neon-blue);">${lang.gps_on || '위치 권한 활성화됨'}</span>`);
            return { ok: true };
        } catch (error) {
            const code = normalizeGpsErrorCode(error);
            AppLogger?.error?.('[gps.read.failed] ' + (error.message || JSON.stringify(error)));
            if (code === 'denied') {
                setStatus(statusDiv, `<span style="color:var(--neon-red);">${lang.gps_denied || '위치 권한이 거부되었습니다. 설정에서 권한을 허용해주세요.'}</span>`);
                const confirmMsg = lang.gps_denied_confirm || '위치 권한이 거부된 상태입니다.\n앱 설정에서 위치 권한을 허용하시겠습니까?';
                if (confirm(confirmMsg)) openAppSettings?.();
            } else {
                const errMsg = code === 'timeout'
                    ? (lang.gps_timeout || '위치 탐색 시간이 초과되었습니다. 다시 시도해주세요.')
                    : (lang.gps_err || '위치 정보 오류');
                setStatus(statusDiv, `<span style="color:var(--neon-red);">${errMsg}</span>`);
            }
            setToggleChecked(gpsToggle, false);
            return { ok: false, code };
        }
    }

    async function promptGpsPermissionIfNeeded({ gpsToggle, statusDiv } = {}) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        if (!capabilities?.supportsGps?.() || appState?.user?.gpsEnabled) return false;
        const geolocation = capabilities.getGeolocationPlugin();

        try {
            const status = await geolocation.checkPermissions();
            if (status.location === 'granted') return false;

            const permResult = await geolocation.requestPermissions();
            if (permResult.location === 'denied') return false;

            if (appState?.user) {
                appState.user.gpsEnabled = true;
                if (typeof saveUserData === 'function') saveUserData();
            }
            const lang = getLangPack();
            setToggleChecked(gpsToggle, true);
            setStatus(statusDiv, `<span style="color:var(--neon-blue);">${lang.gps_on || '위치 권한 활성화됨'}</span>`);
            return true;
        } catch (error) {
            AppLogger?.warn?.('[gps.read.failed] prompt failed: ' + (error.message || JSON.stringify(error)));
            return false;
        }
    }

    async function syncWithOsPermissions({ gpsToggle, statusDiv } = {}) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        if (!capabilities?.supportsGps?.() || !appState?.user) return false;

        const lang = getLangPack();
        const geolocation = capabilities.getGeolocationPlugin();

        try {
            const status = await geolocation.checkPermissions();
            const osGranted = status.location === 'granted';

            if (appState.user.gpsEnabled && !osGranted) {
                appState.user.gpsEnabled = false;
                setToggleChecked(gpsToggle, false);
                setStatus(statusDiv, `<span style="color:var(--text-sub);">${lang.gps_off_by_os || 'OS 설정에서 위치 권한이 해제되어 비활성화됨'}</span>`);
                AppLogger?.info?.('[SyncPerm] GPS disabled: OS permission not granted');
                return true;
            }

            if (!appState.user.gpsEnabled && osGranted) {
                appState.user.gpsEnabled = true;
                setToggleChecked(gpsToggle, true);
                setStatus(statusDiv, `<span style="color:var(--neon-blue);">${lang.gps_on || '위치 권한 활성화됨'}</span>`);
                AppLogger?.info?.('[SyncPerm] GPS enabled: OS permission granted');
                return true;
            }

            return false;
        } catch (error) {
            AppLogger?.warn?.('[gps.read.failed] sync failed: ' + (error.message || JSON.stringify(error)));
            return false;
        }
    }

    return {
        enableGps,
        disableGps,
        promptGpsPermissionIfNeeded,
        syncWithOsPermissions,
    };
}
