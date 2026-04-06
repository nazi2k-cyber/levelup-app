// --- 뽀모도로 타이머 ---
// app.js에서 분리된 pomodoro 모듈

import { AppState } from "./core/state.js";

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
        if (typeof window.showInAppNotification === 'function') {
            window.showInAppNotification(title, body, { tab: 'status' });
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

        if (typeof window.saveUserData === 'function') window.saveUserData();
        if (typeof window.updatePointUI === 'function') window.updatePointUI();
        if (typeof window.drawRadarChart === 'function') window.drawRadarChart();

        // Show toast
        const msg = lang.pomo_reward || '4세트 완료: +10P & AGI +0.3';
        if (typeof window.showToast === 'function') {
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
                        if (typeof window.showInAppNotification === 'function') {
                            window.showInAppNotification(notification.title, notification.body, { tab: 'status' });
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
