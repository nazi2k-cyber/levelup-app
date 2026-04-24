export function createHealthService(deps = {}) {
    const {
        capabilities,
        getAppState,
        saveUserData,
        getCurrentLang,
        i18n = {},
        AppLogger,
        confirm = window.confirm,
        openAppSettings,
        checkStepRareTitles = () => {},
        updateStepCountUI = () => {},
        updatePointUI = () => {},
        drawRadarChart = () => {},
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

    function setToggle(toggleEl, { checked, disabled } = {}) {
        if (!toggleEl) return;
        if (typeof checked === 'boolean') toggleEl.checked = checked;
        if (typeof disabled === 'boolean') toggleEl.disabled = disabled;
    }

    function applyAvailabilityUI({ syncToggle, statusDiv } = {}) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        const lang = getLangPack();
        const healthSupport = capabilities?.getHealthSupportInfo?.() || {
            supported: !!capabilities?.supportsHealth?.(),
            reason: 'unknown',
        };
        const isSupported = !!healthSupport.supported;
        const settingRow = syncToggle?.closest?.('.setting-row');

        if (settingRow) settingRow.style.opacity = isSupported ? '' : '0.5';
        if (!isSupported) {
            setToggle(syncToggle, { checked: false, disabled: true });
            if (appState?.user) appState.user.syncEnabled = false;
            const msg = (
                healthSupport.reason === 'non_native_platform'
                    ? (lang.fitness_unsupported_web || '웹 환경에서는 피트니스 동기화를 사용할 수 없습니다. Android 앱에서 실행해주세요.')
                    : (healthSupport.reason === 'health_plugin_missing'
                        ? (lang.fitness_unsupported_plugin || '건강 연동 모듈이 포함되지 않은 빌드입니다. 앱을 최신 버전으로 업데이트해주세요.')
                        : (lang.fitness_unsupported || '건강 데이터 동기화는 지원되지 않는 환경입니다.'))
            );
            setStatus(statusDiv, `<span style="color:var(--text-sub);">${msg}</span>`);
            AppLogger?.info?.('[HealthSync] unavailable: ' + JSON.stringify({
                supportReason: healthSupport.reason,
                hasHealthConnect: !!healthSupport.hasHealthConnect,
                hasGoogleFit: !!healthSupport.hasGoogleFit,
            }));
            return false;
        }

        setToggle(syncToggle, { checked: !!appState?.user?.syncEnabled, disabled: false });
        return true;
    }

    async function requestFitnessScope() {
        if (!capabilities?.supportsHealth?.()) return false;
        const HealthConnect = capabilities?.getCapacitor?.()?.Plugins?.HealthConnect;

        try {
            if (!HealthConnect) {
                AppLogger?.warn?.('[HealthConnect] requestPermissions skipped: plugin unavailable');
                return false;
            }
            const availability = await HealthConnect.isAvailable();
            AppLogger?.info?.('[HealthConnect] isAvailable before requestPermissions: ' + JSON.stringify(availability || {}));
            if (!availability.available) {
                AppLogger?.warn?.('[HealthConnect] requestPermissions skipped: SDK unavailable');
                return false;
            }
            const perm = await HealthConnect.requestPermissions();
            const hcGranted = !!(perm && (perm.granted || perm.settingsOpened));
            AppLogger?.info?.('[HealthConnect] requestPermissions result: ' + JSON.stringify({
                granted: hcGranted,
                permissionPayload: perm || {},
            }));

            // Health Connect 권한이 확보되면 Google Fit 인증 팝업은 생략한다.
            // (이메일 로그인 사용자에게 계정 선택 팝업이 반복 노출되는 현상 방지)
            if (hcGranted) {
                AppLogger?.info?.('[HealthSync] skip GoogleFit permission request: Health Connect permission already granted');
                return true;
            }

            const GoogleFit = capabilities?.getCapacitor?.()?.Plugins?.GoogleFit;
            if (!GoogleFit) return false;

            try {
                const gfPerm = await GoogleFit.requestPermissions();
                const gfGranted = !!(gfPerm && gfPerm.granted);
                AppLogger?.info?.('[GoogleFit] requestPermissions result: ' + JSON.stringify({
                    granted: gfGranted,
                    permissionPayload: gfPerm || {},
                }));
                return gfGranted;
            } catch (gfErr) {
                AppLogger?.warn?.('[GoogleFit] requestPermissions failed: ' + JSON.stringify({
                    message: gfErr?.message || '',
                    code: gfErr?.code || gfErr?.error?.code || '',
                }));
                return false;
            }
        } catch (e) {
            const errCode = String(e?.code || e?.error?.code || '');
            if (errCode === '12501') return false;
            AppLogger?.error?.('[permission.request.failed] health: ' + JSON.stringify({
                message: e?.message || '',
                code: e?.code || e?.error?.code || '',
                stack: e?.stack || '',
                raw: e,
            }));
            return false;
        }
    }

    async function tryHealthConnectSteps() {
        if (!capabilities?.supportsHealth?.()) return null;

        try {
            const HealthConnect = capabilities?.getCapacitor?.()?.Plugins?.HealthConnect;
            if (!HealthConnect) {
                AppLogger?.warn?.('[HealthConnect] getTodaySteps skipped: plugin unavailable');
                return null;
            }

            const availability = await HealthConnect.isAvailable();
            AppLogger?.info?.('[HealthConnect] getTodaySteps availability: ' + JSON.stringify(availability || {}));
            if (!availability.available) {
                AppLogger?.info?.('[HealthConnect] SDK not available on this device, using sensor fallback');
            }

            const result = await HealthConnect.getTodaySteps();
            AppLogger?.info?.('[HealthConnect] getTodaySteps raw result: ' + JSON.stringify(result || {}));
            if (result.fallbackToRest) {
                AppLogger?.info?.('[HealthConnect] Fallback: ' + (result.error || 'unknown'));
                return await tryGoogleFitSteps();
            }

            const hcSteps = Number.isFinite(result?.steps) ? result.steps : null;
            const appearsSensorOnly = String(result?.source || '').includes('sensor');
            if ((hcSteps === null || hcSteps <= 0) && appearsSensorOnly) {
                const gfSteps = await tryGoogleFitSteps();
                if (Number.isFinite(gfSteps) && gfSteps > 0) {
                    AppLogger?.info?.(`[HealthSync] using GoogleFit steps ${gfSteps} instead of sensor-only ${hcSteps ?? 'null'}`);
                    return gfSteps;
                }
            }

            AppLogger?.info?.(`[HealthConnect] Native steps: ${hcSteps} (source: ${result.source})`);
            return hcSteps;
        } catch (e) {
            AppLogger?.warn?.('[health.sync.failed] step-read: ' + JSON.stringify({
                message: e?.message || '',
                code: e?.code || e?.error?.code || '',
                stack: e?.stack || '',
                raw: e,
            }));
            return null;
        }
    }



    async function tryGoogleFitSteps() {
        if (!capabilities?.supportsHealth?.()) return null;

        try {
            const GoogleFit = capabilities?.getCapacitor?.()?.Plugins?.GoogleFit;
            if (!GoogleFit) {
                AppLogger?.info?.('[GoogleFit] getTodaySteps skipped: plugin unavailable');
                return null;
            }

            const availability = await GoogleFit.isAvailable();
            AppLogger?.info?.('[GoogleFit] availability: ' + JSON.stringify(availability || {}));
            const result = await GoogleFit.getTodaySteps();
            AppLogger?.info?.('[GoogleFit] getTodaySteps raw result: ' + JSON.stringify(result || {}));
            if (!result || result.fallbackToRest) return null;
            return Number.isFinite(result.steps) ? result.steps : null;
        } catch (e) {
            AppLogger?.warn?.('[GoogleFit] step-read failed: ' + JSON.stringify({
                message: e?.message || '',
                code: e?.code || e?.error?.code || '',
                stack: e?.stack || '',
                raw: e,
            }));
            return null;
        }
    }

    async function enableHealthSync({ syncToggle, statusDiv, showMsg = true } = {}) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        const lang = getLangPack();

        if (!applyAvailabilityUI({ syncToggle, statusDiv })) {
            return { ok: false, code: 'unsupported' };
        }

        if (showMsg) {
            setStatus(statusDiv, `<span style="color:var(--text-sub);">${lang.sync_requesting || '건강 데이터 권한 요청 중...'}</span>`);
        }

        const granted = await requestFitnessScope();
        if (!granted) {
            setToggle(syncToggle, { checked: false });
            setStatus(statusDiv, `<span style="color:var(--neon-red);">${lang.sync_denied || '건강 데이터 권한이 필요합니다.'}</span>`);
            return { ok: false, code: 'denied' };
        }

        if (appState?.user) {
            appState.user.syncEnabled = true;
            if (typeof saveUserData === 'function') saveUserData();
        }
        setToggle(syncToggle, { checked: true });
        return { ok: true };
    }

    function disableHealthSync({ syncToggle, statusDiv, showOsSettingsGuide = true } = {}) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        const lang = getLangPack();

        if (appState?.user) {
            appState.user.syncEnabled = false;
            if (typeof saveUserData === 'function') saveUserData();
        }
        setToggle(syncToggle, { checked: false });
        updateStepCountUI();
        setStatus(statusDiv, `<span style="color:var(--text-sub);">${lang.sync_off || '동기화 해제됨'}</span>`);

        if (showOsSettingsGuide && capabilities?.isNativePlatform?.()) {
            const msg = lang.sync_revoke_confirm || '건강 데이터 권한을 완전히 해제하려면 OS 설정에서 권한을 꺼야 합니다.\n앱 설정으로 이동하시겠습니까?';
            if (confirm(msg)) openAppSettings?.();
        }
    }

    async function syncHealthData({ showMsg = false } = {}) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        if (!appState?.user?.syncEnabled) return false;
        const lang = getLangPack();

        const statusDiv = document.getElementById('sync-status');
        if (showMsg) {
            setStatus(statusDiv, `<span style="color:var(--text-sub);">데이터 가져오는 중...</span>`);
        }

        const todayStr = new Date().toDateString();
        if (!appState.user.stepData || appState.user.stepData.date !== todayStr) {
            appState.user.stepData = { date: todayStr, rewardedSteps: 0, totalSteps: 0 };
        }

        const totalStepsToday = await tryHealthConnectSteps();
        if (totalStepsToday === null) {
            if (showMsg) setStatus(statusDiv, `<span style="color:var(--neon-red);">건강 데이터를 가져올 수 없습니다. 앱 권한을 확인해주세요.</span>`);
            AppLogger?.warn?.('[health.sync.failed] no-step-data');
            updateStepCountUI();
            return false;
        }

        appState.user.stepData.totalSteps = totalStepsToday;
        checkStepRareTitles();

        const unrewardedSteps = totalStepsToday - appState.user.stepData.rewardedSteps;
        if (unrewardedSteps >= 1000) {
            const rewardChunks = Math.floor(unrewardedSteps / 1000);
            const earnedPoints = rewardChunks * 10;
            const earnedStr = rewardChunks * 0.5;

            appState.user.points += earnedPoints;
            appState.user.pendingStats.str += earnedStr;
            appState.user.stepData.rewardedSteps += (rewardChunks * 1000);

            if (showMsg) {
                const sourceLabel = 'Health Connect / Google Fit';
                const syncMsg = (lang.sync_complete_msg || '동기화 완료 ({source}): 총 {steps}보')
                    .replace('{source}', sourceLabel)
                    .replace('{steps}', totalStepsToday.toLocaleString());
                const rewardMsg = (lang.sync_reward_msg || '추가 보상: +{points}P, STR +{str}')
                    .replace('{points}', earnedPoints)
                    .replace('{str}', earnedStr);
                setStatus(statusDiv, `<span style="color:var(--neon-blue);">${syncMsg}<br>${rewardMsg}</span>`);
            }
            updatePointUI();
            drawRadarChart();
        } else if (showMsg) {
            if (totalStepsToday === 0) {
                setStatus(statusDiv, `<span style="color:var(--neon-gold);">${lang.sync_no_steps || '걸음 수 기록이 없습니다. (0보)'}</span>`);
            } else {
                const sourceLabel = 'Health Connect / Google Fit';
                const syncMsg = (lang.sync_complete_msg || '동기화 완료 ({source}): 총 {steps}보')
                    .replace('{source}', sourceLabel)
                    .replace('{steps}', totalStepsToday.toLocaleString());
                const nextMsg = (lang.sync_next_reward || '다음 보상까지 {n}보 남음')
                    .replace('{n}', 1000 - unrewardedSteps);
                setStatus(statusDiv, `<span style="color:var(--neon-blue);">${syncMsg}<br>(${nextMsg})</span>`);
            }
        }

        if (typeof saveUserData === 'function') saveUserData();
        updateStepCountUI();
        return true;
    }

    async function syncWithOsPermissions({ syncToggle, statusDiv } = {}) {
        const appState = typeof getAppState === 'function' ? getAppState() : null;
        if (!capabilities?.supportsHealth?.() || !appState?.user) return false;
        const HealthConnect = capabilities?.getCapacitor?.()?.Plugins?.HealthConnect;
        if (!HealthConnect) return false;
        const lang = getLangPack();

        try {
            const availability = await HealthConnect.isAvailable();
            const hasPermission = !!(availability.available && (availability.hasActivityRecognition || availability.hasPermissions));

            if (appState.user.syncEnabled && !hasPermission) {
                appState.user.syncEnabled = false;
                setToggle(syncToggle, { checked: false });
                setStatus(statusDiv, `<span style="color:var(--text-sub);">${lang.sync_off_by_os || 'OS 설정에서 건강 데이터 권한이 해제되어 비활성화됨'}</span>`);
                AppLogger?.info?.('[SyncPerm] Fitness disabled: OS permission not granted');
                return true;
            }

            if (!appState.user.syncEnabled && hasPermission) {
                appState.user.syncEnabled = true;
                setToggle(syncToggle, { checked: true });
                updateStepCountUI();
                AppLogger?.info?.('[SyncPerm] Fitness enabled: OS permission granted');
                return true;
            }

            return false;
        } catch (e) {
            AppLogger?.warn?.('[health.sync.failed] sync-os: ' + (e.message || JSON.stringify(e)));
            return false;
        }
    }

    return {
        applyAvailabilityUI,
        enableHealthSync,
        disableHealthSync,
        requestFitnessScope,
        tryHealthConnectSteps,
        syncHealthData,
        syncWithOsPermissions,
    };
}
