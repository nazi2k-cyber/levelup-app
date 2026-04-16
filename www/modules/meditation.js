// ===== 명상 타이머 모듈 =====
(function() {
    'use strict';

    const MED_STORAGE_KEY = 'med_settings';
    const MED_CHANNEL_ID = 'meditation-notifications';
    const MED_NOTIF_ID = 7800;
    const MED_PRESETS = [5, 10, 15, 20, 30];

    let audioCtx = null;

    let medState = {
        phase: 'idle', // idle, meditating, completed
        secondsLeft: 0,
        totalSeconds: 0,
        dailySessions: 0,
        intervalId: null,
        isPaused: false
    };

    // 외부 의존은 window.* 경유
    const AppState = window.AppState;
    const i18n = window.i18n;

    function getMedSettings() {
        try {
            const saved = localStorage.getItem(MED_STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch(e) {}
        return { durationMin: 10, soundEnabled: true };
    }

    function saveMedSettings(s) {
        localStorage.setItem(MED_STORAGE_KEY, JSON.stringify(s));
    }

    function updateMedUI() {
        const display = document.getElementById('med-time-display');
        const phaseLabel = document.getElementById('med-phase-label');
        const sandTop = document.getElementById('med-sand-top');
        const sandBot = document.getElementById('med-sand-bot');
        const sandDrop = document.getElementById('med-sand-drop');
        const startBtn = document.getElementById('med-start-btn');
        const sessionCount = document.getElementById('med-session-count');
        const lang = i18n[AppState.currentLang] || i18n.ko;

        if (!display) return;

        // Time display
        const min = Math.floor(medState.secondsLeft / 60);
        const sec = medState.secondsLeft % 60;
        display.textContent = `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;

        // Phase label
        if (phaseLabel) {
            if (medState.phase === 'meditating') phaseLabel.textContent = lang.med_meditating || '명상 중';
            else if (medState.phase === 'completed') phaseLabel.textContent = lang.med_completed || '완료';
            else phaseLabel.textContent = lang.med_ready || '준비';
        }

        // Hourglass sand update
        const progress = medState.totalSeconds > 0 ? medState.secondsLeft / medState.totalSeconds : 1;
        // Top chamber: full at start (progress=1), empty at end (progress=0)
        // Sand fills bottom portion of top trapezoid (y: 10..60, span=50)
        if (sandTop) {
            sandTop.setAttribute('y', String(60 - progress * 50));
            sandTop.setAttribute('height', String(progress * 50));
        }
        // Bottom chamber: empty at start, full at end
        // Sand fills from bottom of bottom trapezoid upward (y: 60..110, span=50)
        if (sandBot) {
            sandBot.setAttribute('y', String(60 + progress * 50));
            sandBot.setAttribute('height', String((1 - progress) * 50));
        }
        // Falling particles: visible only while actively meditating
        const sandDrop2 = document.getElementById('med-sand-drop2');
        const isFlowing = medState.phase === 'meditating' && !medState.isPaused && progress > 0;
        if (sandDrop) {
            if (isFlowing) {
                sandDrop.classList.add('med-sand-falling');
            } else {
                sandDrop.classList.remove('med-sand-falling');
            }
        }
        if (sandDrop2) {
            if (isFlowing) {
                sandDrop2.classList.add('med-sand-falling2');
            } else {
                sandDrop2.classList.remove('med-sand-falling2');
            }
        }

        // Button text
        if (startBtn) {
            const btnSpan = startBtn.querySelector('span');
            if (medState.phase === 'idle' || medState.phase === 'completed') {
                btnSpan.textContent = lang.med_start || '시작';
            } else if (medState.isPaused) {
                btnSpan.textContent = lang.med_resume || '재개';
            } else {
                btnSpan.textContent = lang.med_pause || '일시정지';
            }
        }

        // Session count
        if (sessionCount) {
            const todayLabel = lang.med_sessions_today || '오늘';
            sessionCount.textContent = `${todayLabel} ${medState.dailySessions}`;
        }

        // Sound toggle button
        const soundBtn = document.getElementById('btn-med-sound');
        if (soundBtn) {
            const settings = getMedSettings();
            soundBtn.textContent = settings.soundEnabled ? '🔔' : '🔕';
        }

        // Preset chips active state
        const settings = getMedSettings();
        MED_PRESETS.forEach(m => {
            const chip = document.getElementById(`med-chip-${m}`);
            if (chip) {
                chip.classList.toggle('active', m === settings.durationMin);
            }
        });
    }

    function renderPresetChips() {
        const container = document.getElementById('med-preset-btns');
        if (!container) return;
        container.innerHTML = '';
        const settings = getMedSettings();
        MED_PRESETS.forEach(m => {
            const chip = document.createElement('button');
            chip.id = `med-chip-${m}`;
            chip.className = 'med-preset-chip' + (m === settings.durationMin ? ' active' : '');
            chip.textContent = `${m}m`;
            chip.addEventListener('click', () => window.setMedDuration(m));
            container.appendChild(chip);
        });
    }

    function startMeditation() {
        const settings = getMedSettings();
        medState.phase = 'meditating';
        medState.isPaused = false;
        medState.totalSeconds = settings.durationMin * 60;
        medState.secondsLeft = medState.totalSeconds;

        playBowlSound(); // 시작 종소리
        scheduleMedNotification(medState.totalSeconds);

        clearInterval(medState.intervalId);
        medState.intervalId = setInterval(medTick, 1000);
        updateMedUI();
    }

    function medTick() {
        if (medState.isPaused) return;

        medState.secondsLeft--;
        if (medState.secondsLeft <= 0) {
            clearInterval(medState.intervalId);
            medState.intervalId = null;
            onMedComplete();
        }
        updateMedUI();
    }

    function onMedComplete() {
        medState.phase = 'completed';
        medState.dailySessions++;
        playMedSound();
        showMedCompleteNotification();
        grantMedReward();
        updateMedUI();
    }

    // --- 티베트 종소리 합성 (Web Audio API) ---
    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function playBowlSound() {
        const settings = getMedSettings();
        if (!settings.soundEnabled) return;
        try {
            const ctx = getAudioContext();
            const now = ctx.currentTime;

            // 티베트 싱잉볼 배음 구조 (비정수배 하모닉스로 특유의 울림)
            const fundamental = 230;
            const partials = [
                { ratio: 1.00, amp: 0.35, decay: 5.0 },
                { ratio: 2.01, amp: 0.25, decay: 4.2 },
                { ratio: 3.03, amp: 0.12, decay: 3.5 },
                { ratio: 4.53, amp: 0.08, decay: 2.8 },
                { ratio: 5.56, amp: 0.04, decay: 2.2 }
            ];

            const master = ctx.createGain();
            master.gain.setValueAtTime(0.6, now);
            master.connect(ctx.destination);

            partials.forEach(p => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(fundamental * p.ratio, now);
                // 자연스러운 어택 + 긴 지수 감쇠
                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(p.amp, now + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);
                osc.connect(gain);
                gain.connect(master);
                osc.start(now);
                osc.stop(now + p.decay + 0.1);
            });
        } catch(e) {
            console.warn('[Meditation] 종소리 재생 실패:', e);
        }
    }

    function playMedSound() {
        playBowlSound();
        try {
            if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
        } catch(e) {}
    }

    function showMedCompleteNotification() {
        const lang = i18n[AppState.currentLang] || i18n.ko;
        const title = lang.med_notif_title || '🧘 명상 완료!';
        const body = lang.med_notif_body || '잘했어요! 마음이 한결 가벼워졌습니다.';

        cancelMedNotification();

        if (typeof window.showInAppNotification === 'function') {
            window.showInAppNotification(title, body, { tab: 'status' });
        }

        try {
            const cap = window.Capacitor;
            if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
                const { LocalNotifications } = cap.Plugins;
                LocalNotifications.schedule({
                    notifications: [{
                        title: title,
                        body: body,
                        id: MED_NOTIF_ID + 1,
                        channelId: MED_CHANNEL_ID,
                        sound: 'default',
                        schedule: { at: new Date(Date.now() + 500) }
                    }]
                });
            } else if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(title, { body, icon: '/res/mipmap-xxxhdpi/ic_launcher.png' });
            }
        } catch(e) {
            console.warn('[Meditation] 즉시 알림 실패:', e);
        }
    }

    function grantMedReward() {
        const lang = i18n[AppState.currentLang] || i18n.ko;
        const todayKST = typeof window.getTodayKST === 'function' ? window.getTodayKST() : new Date().toISOString().slice(0, 10);

        // Prevent duplicate reward per day
        if (AppState.user._medDoneDate === todayKST) return;
        AppState.user._medDoneDate = todayKST;

        // +10P & VIT +0.3
        AppState.user.points = (AppState.user.points || 0) + 10;
        AppState.user.stats.vit = Math.min(100, (AppState.user.stats.vit || 0) + 0.3);

        if (typeof window.saveUserData === 'function') window.saveUserData();
        if (typeof window.updatePointUI === 'function') window.updatePointUI();
        if (typeof window.drawRadarChart === 'function') window.drawRadarChart();

        const msg = lang.med_reward || '명상 완료: +10P & VIT +0.3';
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
        } else {
            alert(msg);
        }
    }

    async function scheduleMedNotification(durationSecs) {
        const cap = window.Capacitor;
        const lang = i18n[AppState.currentLang] || i18n.ko;
        const title = lang.med_notif_title || '🧘 명상 완료!';
        const body = lang.med_notif_body || '잘했어요! 마음이 한결 가벼워졌습니다.';

        if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
            const { LocalNotifications } = cap.Plugins;
            try {
                if (cap.getPlatform && cap.getPlatform() === 'android') {
                    try {
                        await LocalNotifications.createChannel({
                            id: MED_CHANNEL_ID,
                            name: '명상 알림',
                            description: '명상 타이머 알림',
                            importance: 4,
                            sound: 'default',
                            visibility: 1
                        });
                    } catch(e) {}
                }

                await LocalNotifications.cancel({ notifications: [{ id: MED_NOTIF_ID }] });

                const scheduleAt = new Date(Date.now() + durationSecs * 1000);
                const perm = await LocalNotifications.requestPermissions();
                if (perm.display === 'granted') {
                    await LocalNotifications.schedule({
                        notifications: [{
                            title: title,
                            body: body,
                            id: MED_NOTIF_ID,
                            schedule: { at: scheduleAt },
                            sound: 'default',
                            channelId: MED_CHANNEL_ID
                        }]
                    });
                }
            } catch(e) {
                console.warn('[Meditation] 로컬 알림 스케줄 실패:', e);
            }
            return;
        }

        // Web fallback
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                await Notification.requestPermission();
            }
            if (Notification.permission === 'granted') {
                setTimeout(() => {
                    new Notification(title, { body, icon: '/res/mipmap-xxxhdpi/ic_launcher.png' });
                }, durationSecs * 1000);
            }
        }
    }

    async function cancelMedNotification() {
        const cap = window.Capacitor;
        if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
            try {
                await cap.Plugins.LocalNotifications.cancel({ notifications: [{ id: MED_NOTIF_ID }] });
            } catch(e) {}
        }
    }

    // Public API
    window.toggleMeditation = function() {
        if (medState.phase === 'idle' || medState.phase === 'completed') {
            startMeditation();
        } else if (medState.isPaused) {
            medState.isPaused = false;
            scheduleMedNotification(medState.secondsLeft);
            medState.intervalId = setInterval(medTick, 1000);
            updateMedUI();
        } else {
            // Pause
            medState.isPaused = true;
            clearInterval(medState.intervalId);
            medState.intervalId = null;
            cancelMedNotification();
            updateMedUI();
        }
    };

    window.resetMeditation = function() {
        clearInterval(medState.intervalId);
        medState.intervalId = null;
        cancelMedNotification();
        medState.phase = 'idle';
        medState.isPaused = false;
        const settings = getMedSettings();
        medState.secondsLeft = settings.durationMin * 60;
        medState.totalSeconds = medState.secondsLeft;
        updateMedUI();
    };

    window.setMedDuration = function(minutes) {
        if (medState.phase === 'meditating' && !medState.isPaused) return; // Don't change during active session
        const settings = getMedSettings();
        settings.durationMin = minutes;
        saveMedSettings(settings);
        medState.phase = 'idle';
        medState.isPaused = false;
        medState.secondsLeft = minutes * 60;
        medState.totalSeconds = minutes * 60;
        clearInterval(medState.intervalId);
        medState.intervalId = null;
        cancelMedNotification();
        updateMedUI();
    };

    window.toggleMedSound = function() {
        const settings = getMedSettings();
        settings.soundEnabled = !settings.soundEnabled;
        saveMedSettings(settings);
        updateMedUI();
        // 켤 때 미리듣기
        if (settings.soundEnabled) playBowlSound();
    };

    // Settings modal
    window.openMedSettings = function() {
        const lang = i18n[AppState.currentLang] || i18n.ko;
        const settings = getMedSettings();
        const overlay = document.createElement('div');
        overlay.className = 'med-settings-overlay';
        overlay.id = 'med-settings-overlay';
        overlay.innerHTML = `
            <div class="med-settings-modal">
                <h3 style="margin:0 0 16px 0; font-size:1rem; color:#00e5a0;">${lang.med_settings_title || '명상 설정'}</h3>
                <label><span>${lang.med_duration_min || '명상 시간 (분)'}</span><input type="number" id="med-set-duration" value="${settings.durationMin}" min="1" max="60"></label>
                <label><span>${lang.med_sound || '종소리'}</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button id="med-set-sound-toggle" onclick="this.dataset.on = this.dataset.on==='true'?'false':'true'; this.textContent = this.dataset.on==='true'?'ON':'OFF'; this.style.color = this.dataset.on==='true'?'#00e5a0':'var(--text-sub)';" data-on="${settings.soundEnabled}" style="padding:4px 12px; border-radius:6px; border:1px solid var(--border-color); background:rgba(255,255,255,0.05); color:${settings.soundEnabled ? '#00e5a0' : 'var(--text-sub)'}; cursor:pointer; font-size:0.8rem; font-weight:700;">${settings.soundEnabled ? 'ON' : 'OFF'}</button>
                        <button onclick="window.previewBowlSound()" style="padding:4px 8px; border-radius:6px; border:1px solid var(--border-color); background:rgba(255,255,255,0.05); color:var(--text-sub); cursor:pointer; font-size:0.75rem;">▶ ${lang.med_sound_preview || '미리듣기'}</button>
                    </div>
                </label>
                <div style="display:flex; gap:8px; margin-top:16px;">
                    <button onclick="window.saveMedSettingsFromModal()" class="btn-primary" style="flex:1; padding:10px; border-radius:8px; background:linear-gradient(135deg, #00e5a0, #00b87a);">${lang.med_save || '저장'}</button>
                    <button onclick="window.closeMedSettings()" style="flex:1; padding:10px; border-radius:8px; background:rgba(255,255,255,0.06); border:1px solid var(--border-color); color:var(--text-sub); cursor:pointer;">✕</button>
                </div>
                <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border-color);">
                    <div style="font-size:0.75rem; font-weight:700; color:var(--neon-gold); margin-bottom:8px;">${lang.med_guide_title || '사용 방법'}</div>
                    <div style="font-size:0.7rem; color:var(--text-sub); line-height:1.6;">${lang.med_guide_body || '1. 원하는 시간을 선택하세요 (5~30분).<br>2. 시작 버튼을 눌러 명상을 시작하세요.<br>3. 타이머가 끝나면 자동으로 완료됩니다.<br>4. 매일 첫 명상 완료 시 +10P & VIT +0.3 보상!'}</div>
                </div>
            </div>
        `;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) window.closeMedSettings(); });
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
    };

    window.closeMedSettings = function() {
        const overlay = document.getElementById('med-settings-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        }
    };

    window.previewBowlSound = function() {
        // 설정 모달 내에서 미리듣기 시 임시로 soundEnabled 무시
        try {
            const ctx = getAudioContext();
            const now = ctx.currentTime;
            const fundamental = 230;
            const partials = [
                { ratio: 1.00, amp: 0.35, decay: 5.0 },
                { ratio: 2.01, amp: 0.25, decay: 4.2 },
                { ratio: 3.03, amp: 0.12, decay: 3.5 },
                { ratio: 4.53, amp: 0.08, decay: 2.8 },
                { ratio: 5.56, amp: 0.04, decay: 2.2 }
            ];
            const master = ctx.createGain();
            master.gain.setValueAtTime(0.6, now);
            master.connect(ctx.destination);
            partials.forEach(p => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(fundamental * p.ratio, now);
                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(p.amp, now + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);
                osc.connect(gain);
                gain.connect(master);
                osc.start(now);
                osc.stop(now + p.decay + 0.1);
            });
        } catch(e) {}
    };

    window.saveMedSettingsFromModal = function() {
        const durationMin = Math.max(1, Math.min(60, parseInt(document.getElementById('med-set-duration').value) || 10));
        const soundToggle = document.getElementById('med-set-sound-toggle');
        const soundEnabled = soundToggle ? soundToggle.dataset.on === 'true' : true;
        saveMedSettings({ durationMin, soundEnabled });
        window.closeMedSettings();
        if (medState.phase === 'idle' || medState.phase === 'completed') {
            medState.phase = 'idle';
            medState.secondsLeft = durationMin * 60;
            medState.totalSeconds = durationMin * 60;
            updateMedUI();
        }
    };

    // Foreground local notification listener
    function initMedLocalNotifListener() {
        try {
            const cap = window.Capacitor;
            if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
                const { LocalNotifications } = cap.Plugins;
                LocalNotifications.addListener('localNotificationReceived', (notification) => {
                    if (notification.id === MED_NOTIF_ID || notification.id === MED_NOTIF_ID + 1) {
                        if (typeof window.showInAppNotification === 'function') {
                            window.showInAppNotification(notification.title, notification.body, { tab: 'status' });
                        }
                    }
                });
            }
        } catch(e) {
            console.warn('[Meditation] 로컬 알림 리스너 등록 실패:', e);
        }
    }

    // DOMContentLoaded 안전 처리
    function initMeditation() {
        const settings = getMedSettings();
        medState.secondsLeft = settings.durationMin * 60;
        medState.totalSeconds = settings.durationMin * 60;

        renderPresetChips();
        updateMedUI();

        const settingsBtn = document.getElementById('btn-med-settings');
        if (settingsBtn) settingsBtn.addEventListener('click', window.openMedSettings);

        initMedLocalNotifListener();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMeditation);
    } else {
        initMeditation();
    }
})();
