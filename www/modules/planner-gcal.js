// ===== 플래너 Google Calendar 연동 모듈 =====
(function() {
    'use strict';

    const AppState  = window.AppState;
    const i18n      = window.i18n;
    const AppLogger = window.AppLogger;
    const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
    const CALENDAR_API   = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const CLIENT_ID      = 'GOOGLE_WEB_CLIENT_ID_PLACEHOLDER';

    let _gcalToken  = null;
    let _gisLoaded  = false;

    function getLang() {
        return (AppState && AppState.currentLang) || 'ko';
    }

    function t(key, replacements) {
        const lang = getLang();
        let msg = (i18n[lang] && i18n[lang][key]) || key;
        if (replacements) {
            Object.keys(replacements).forEach(k => {
                msg = msg.replace('{' + k + '}', replacements[k]);
            });
        }
        return msg;
    }

    function notify(msg) {
        if (window.showInAppNotification) {
            window.showInAppNotification(msg);
        } else {
            alert(msg);
        }
    }

    function loadGisScript() {
        return new Promise((resolve, reject) => {
            if (_gisLoaded && window.google && window.google.accounts) {
                resolve();
                return;
            }
            if (document.getElementById('gis-client')) {
                // 스크립트 태그 있지만 아직 로드 완료 전일 수 있음
                const wait = () => {
                    if (window.google && window.google.accounts) { _gisLoaded = true; resolve(); }
                    else setTimeout(wait, 100);
                };
                wait();
                return;
            }
            const script = document.createElement('script');
            script.id  = 'gis-client';
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.onload = () => { _gisLoaded = true; resolve(); };
            script.onerror = () => reject(new Error('GIS 스크립트 로드 실패'));
            document.head.appendChild(script);
        });
    }

    function getTimezoneOffset() {
        const offsetMin = -new Date().getTimezoneOffset();
        const sign  = offsetMin >= 0 ? '+' : '-';
        const abs   = Math.abs(offsetMin);
        const hh    = String(Math.floor(abs / 60)).padStart(2, '0');
        const mm    = String(abs % 60).padStart(2, '0');
        return `${sign}${hh}:${mm}`;
    }

    function addThirtyMin(time) {
        const [h, m] = time.split(':').map(Number);
        const total  = h * 60 + m + 30;
        return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }

    async function getAccessTokenWeb() {
        await loadGisScript();
        return new Promise((resolve, reject) => {
            // 캐시된 토큰이 있으면 재사용
            if (_gcalToken) { resolve(_gcalToken); return; }

            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: CALENDAR_SCOPE,
                callback: (response) => {
                    if (response.error) {
                        if (response.error === 'access_denied') {
                            notify(t('gcal_denied'));
                            resolve(null);
                        } else {
                            notify(t('gcal_error', { msg: response.error }));
                            resolve(null);
                        }
                        return;
                    }
                    _gcalToken = response.access_token;
                    const expiresIn = Number(response.expires_in || 3600);
                    setTimeout(() => { _gcalToken = null; }, expiresIn * 1000);
                    resolve(_gcalToken);
                },
                error_callback: (err) => {
                    if (err && err.type === 'popup_closed') {
                        notify(t('gcal_denied'));
                    } else {
                        notify(t('gcal_error', { msg: (err && err.type) || 'unknown' }));
                    }
                    resolve(null);
                }
            });
            client.requestToken();
        });
    }

    async function getAccessTokenNative() {
        try {
            const { GoogleAuth } = window.Capacitor.Plugins;
            if (!GoogleAuth) {
                notify(t('gcal_scope_required'));
                return null;
            }
            await GoogleAuth.initialize({
                clientId: CLIENT_ID,
                scopes: [CALENDAR_SCOPE],
                grantOfflineAccess: false
            });
            const googleUser = await GoogleAuth.signIn();
            const token = googleUser && googleUser.authentication && googleUser.authentication.accessToken;
            if (!token) {
                notify(t('gcal_error', { msg: 'accessToken 없음' }));
                return null;
            }
            return token;
        } catch (e) {
            if (AppLogger) AppLogger.error('[PlannerGCal] native getAccessToken 실패', e);
            const code = String(e.code || '');
            if (code === '12501') { notify(t('gcal_denied')); }
            else { notify(t('gcal_error', { msg: e.message || code })); }
            return null;
        }
    }

    async function getAccessToken() {
        const isNative = window.isNativePlatform;
        if (isNative) return getAccessTokenNative();
        return getAccessTokenWeb();
    }

    function getTimeboxBlocks() {
        const slots = document.querySelectorAll('#planner-timebox-grid .timebox-slot');
        const blocks = [];
        slots.forEach(slot => {
            const value = (slot.dataset.value || '').trim();
            const time  = (slot.dataset.time  || '').trim();
            if (value && time) blocks.push({ time, value });
        });
        return blocks;
    }

    async function createCalendarEvent(token, dateStr, time, summary) {
        const tzOffset = getTimezoneOffset();
        const endTime  = addThirtyMin(time);
        const body = {
            summary,
            description: `LevelUp 플래너 | ${dateStr}`,
            start: { dateTime: `${dateStr}T${time}:00${tzOffset}` },
            end:   { dateTime: `${dateStr}T${endTime}:00${tzOffset}` }
        };
        const res = await fetch(CALENDAR_API, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (res.status === 401) {
            _gcalToken = null;
            throw new Error('401');
        }
        if (!res.ok) {
            const errText = await res.text().catch(() => res.status);
            throw new Error(errText);
        }
    }

    async function syncToGoogleCalendar() {
        const dateStr = window.diarySelectedDate;
        if (!dateStr) { notify(t('gcal_no_blocks')); return; }

        const blocks = getTimeboxBlocks();
        if (!blocks.length) { notify(t('gcal_no_blocks')); return; }

        notify(t('gcal_syncing'));

        let token;
        try {
            token = await getAccessToken();
        } catch (e) {
            if (AppLogger) AppLogger.error('[PlannerGCal] getAccessToken 오류', e);
            notify(t('gcal_error', { msg: e.message || String(e) }));
            return;
        }
        if (!token) return;

        let count = 0;
        try {
            for (const { time, value } of blocks) {
                await createCalendarEvent(token, dateStr, time, value);
                count++;
            }
        } catch (e) {
            if (AppLogger) AppLogger.error('[PlannerGCal] createCalendarEvent 오류', e);
            if (e.message === '401') {
                notify(t('gcal_error', { msg: '인증 만료. 다시 시도해주세요.' }));
            } else {
                notify(t('gcal_error', { msg: e.message || String(e) }));
            }
            return;
        }

        notify(t('gcal_done', { count }));
    }

    function initPlannerGCal() {
        const btn = document.getElementById('btn-gcal-sync');
        if (btn) btn.addEventListener('click', syncToGoogleCalendar);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPlannerGCal);
    } else {
        initPlannerGCal();
    }

    window.syncToGoogleCalendar = syncToGoogleCalendar;
})();
