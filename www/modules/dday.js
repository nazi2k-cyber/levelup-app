// ===== D-Day 기능 모듈 =====
(function() {
    'use strict';

    const AppState = window.AppState;
    const i18n = window.i18n;

    const DDAY_MAX = 3;

    // ===================== D-DAY 기능 =====================

    function renderDDayList() {
        const container = document.getElementById('dday-list');
        if (!container) return;
        const ddays = AppState.ddays || [];
        const addBtn = document.getElementById('btn-add-dday');
        if (addBtn) addBtn.style.display = ddays.length >= DDAY_MAX ? 'none' : '';

        if (ddays.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:15px 0; color:var(--text-sub); font-size:0.8rem;">
                ${i18n[AppState.currentLang]?.dday_empty || 'D-Day를 추가하여 중요한 날을 관리하세요.'}
            </div>`;
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        container.innerHTML = ddays.map((dd, idx) => {
            const target = new Date(dd.date);
            target.setHours(0, 0, 0, 0);
            const diffMs = dd.type === 'dday'
                ? target.getTime() - today.getTime()
                : today.getTime() - target.getTime();
            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

            let label, color;
            if (dd.type === 'dday') {
                if (diffDays > 0) { label = `D-${diffDays}`; color = 'var(--neon-blue)'; }
                else if (diffDays === 0) { label = 'D-DAY'; color = 'var(--neon-gold)'; }
                else { label = `D+${Math.abs(diffDays)}`; color = 'var(--text-sub)'; }
            } else {
                label = `D+${diffDays}`; color = 'var(--neon-purple)';
            }

            const icon = dd.type === 'dday' ? '📅' : '🔥';
            const typeLabel = dd.type === 'dday' ? 'D-Day' : 'D-Day+';
            const notify = (dd.pushEnabled && dd.type === 'dday') ? '🔔 9:00 AM' : '';

            return `<div class="dday-item" data-idx="${idx}" onclick="openDDayEditModal(${idx})">
                <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                    <span style="font-size:1.1rem;">${icon}</span>
                    <div style="min-width:0; flex:1;">
                        <div style="font-size:0.85rem; font-weight:bold; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${window.sanitizeText(dd.title)}</div>
                        <div style="font-size:0.65rem; color:var(--text-sub);">${typeLabel} · ${dd.date} ${notify}</div>
                    </div>
                </div>
                <div style="font-size:1.1rem; font-weight:900; color:${color}; white-space:nowrap;">${label}</div>
            </div>`;
        }).join('');
    }

    function openDDayAddModal() {
        const ddays = AppState.ddays || [];
        if (ddays.length >= DDAY_MAX) {
            alert((i18n[AppState.currentLang]?.dday_limit || 'D-Day는 최대 {max}개까지 설정할 수 있습니다.').replace('{max}', DDAY_MAX));
            return;
        }
        _openDDayFormModal(-1);
    }

    function openDDayEditModal(idx) {
        _openDDayFormModal(idx);
    }

    function _openDDayFormModal(editIdx) {
        const isEdit = editIdx >= 0;
        const dd = isEdit ? AppState.ddays[editIdx] : null;
        const _t = i18n[AppState.currentLang] || {};

        const overlay = document.createElement('div');
        overlay.className = 'report-modal-overlay';
        overlay.id = 'dday-modal-overlay';

        const todayStr = new Date().toISOString().split('T')[0];

        const isDDayPlus = isEdit && dd.type === 'ddayplus';
        const pushDisabled = isDDayPlus ? 'disabled' : '';
        const pushChecked = (isEdit && dd.pushEnabled && !isDDayPlus) ? 'checked' : '';

        overlay.innerHTML = `
        <div class="report-modal-content" style="max-width:340px; padding:20px;">
            <div style="font-size:1rem; font-weight:bold; color:var(--neon-blue); margin-bottom:14px;">${isEdit ? 'D-Day 수정' : 'D-Day 추가'}</div>
            <div style="margin-bottom:10px;">
                <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">${_t.dday_modal_title_label || '제목'}</label>
                <input id="dday-input-title" type="text" maxlength="20" placeholder="${_t.dday_modal_title_placeholder || '예: 시험일, 금연 시작'}" value="${isEdit ? window.sanitizeAttr(dd.title) : ''}"
                    style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
            </div>
            <div style="margin-bottom:10px;">
                <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">${_t.dday_modal_type_label || '유형'}</label>
                <div style="display:flex; gap:8px;">
                    <button class="dday-type-btn ${(!isEdit || dd.type === 'dday') ? 'active' : ''}" data-type="dday" onclick="selectDDayType('dday')" style="flex:1; padding:8px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.8rem; cursor:pointer;">📅 D-Day</button>
                    <button class="dday-type-btn ${isDDayPlus ? 'active' : ''}" data-type="ddayplus" onclick="selectDDayType('ddayplus')" style="flex:1; padding:8px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.8rem; cursor:pointer;">🔥 D-Day+</button>
                </div>
                <div id="dday-type-desc" style="font-size:0.65rem; color:var(--text-sub); margin-top:4px;">${(!isEdit || dd.type === 'dday') ? (_t.dday_type_desc_dday || '목표일까지 남은 날을 카운트합니다.') : (_t.dday_type_desc_plus || '시작일로부터 경과한 날을 카운트합니다.')}</div>
            </div>
            <div style="margin-bottom:10px;">
                <label id="dday-date-label" style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">${isDDayPlus ? (_t.dday_start_date || '시작 날짜') : (_t.dday_target_date || '목표 날짜')}</label>
                <input id="dday-input-date" type="date" value="${isEdit ? dd.date : todayStr}"
                    style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
            </div>
            <div id="dday-push-row" style="margin-bottom:14px; ${isDDayPlus ? 'opacity:0.4;' : ''}">
                <label style="display:flex; align-items:center; gap:8px; cursor:${isDDayPlus ? 'not-allowed' : 'pointer'};">
                    <input id="dday-input-push" type="checkbox" ${pushChecked} ${pushDisabled}>
                    <span style="font-size:0.8rem; color:var(--text-main);">${_t.dday_push_label || '🔔 D-Day 당일 오전 9시 푸시 알림'}</span>
                </label>
            </div>
            <div style="display:flex; gap:8px;">
                ${isEdit ? `<button onclick="deleteDDay(${editIdx})" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--neon-red); background:transparent; color:var(--neon-red); font-size:0.85rem; font-weight:bold; cursor:pointer;">${_t.dday_btn_delete || '삭제'}</button>` : ''}
                <button onclick="closeDDayModal()" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--border-color); background:transparent; color:var(--text-sub); font-size:0.85rem; cursor:pointer;">${_t.dday_btn_cancel || '취소'}</button>
                <button onclick="saveDDayFromModal(${editIdx})" style="flex:1; padding:10px; border-radius:6px; border:none; background:var(--neon-blue); color:#000; font-size:0.85rem; font-weight:bold; cursor:pointer;">${isEdit ? (_t.dday_btn_save || '저장') : (_t.dday_btn_add || '추가')}</button>
            </div>
        </div>`;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function selectDDayType(type) {
        document.querySelectorAll('.dday-type-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.type === type);
        });
        const desc = document.getElementById('dday-type-desc');
        const dateLabel = document.getElementById('dday-date-label');
        const pushRow = document.getElementById('dday-push-row');
        const pushInput = document.getElementById('dday-input-push');
        const isDDayPlus = type === 'ddayplus';

        const _t = i18n[AppState.currentLang] || {};
        if (type === 'dday') {
            if (desc) desc.textContent = _t.dday_type_desc_dday || '목표일까지 남은 날을 카운트합니다.';
            if (dateLabel) dateLabel.textContent = _t.dday_target_date || '목표 날짜';
        } else {
            if (desc) desc.textContent = _t.dday_type_desc_plus || '시작일로부터 경과한 날을 카운트합니다.';
            if (dateLabel) dateLabel.textContent = _t.dday_start_date || '시작 날짜';
        }

        // D-Day+는 특정 목표일이 없으므로 푸시 알림 비활성화
        if (pushRow) pushRow.style.opacity = isDDayPlus ? '0.4' : '1';
        if (pushInput) {
            pushInput.disabled = isDDayPlus;
            if (isDDayPlus) pushInput.checked = false;
        }
        const pushLabel = pushRow?.querySelector('label');
        if (pushLabel) pushLabel.style.cursor = isDDayPlus ? 'not-allowed' : 'pointer';
    }

    function saveDDayFromModal(editIdx) {
        const title = (document.getElementById('dday-input-title')?.value || '').trim();
        const date = document.getElementById('dday-input-date')?.value || '';
        const pushEnabled = document.getElementById('dday-input-push')?.checked || false;
        const typeBtn = document.querySelector('.dday-type-btn.active');
        const type = typeBtn ? typeBtn.dataset.type : 'dday';

        if (!title) { alert(i18n[AppState.currentLang]?.dday_title_required || '제목을 입력하세요.'); return; }
        if (!date) { alert(i18n[AppState.currentLang]?.dday_date_required || '날짜를 선택하세요.'); return; }

        if (!AppState.ddays) AppState.ddays = [];

        if (editIdx < 0 && AppState.ddays.length >= DDAY_MAX) {
            alert((i18n[AppState.currentLang]?.dday_limit || 'D-Day는 최대 {max}개까지 설정할 수 있습니다.').replace('{max}', DDAY_MAX));
            return;
        }

        const entry = { title, date, type, pushEnabled, createdAt: Date.now() };
        if (editIdx >= 0) {
            entry.createdAt = AppState.ddays[editIdx]?.createdAt || Date.now();
        }

        // 저장 실행 함수
        function _doSaveDDay() {
            if (editIdx >= 0) {
                AppState.ddays[editIdx] = entry;
            } else {
                AppState.ddays.push(entry);
            }
            closeDDayModal();
            renderDDayList();
            window.saveUserData();
            scheduleDDayNotifications();
        }

        // 보상형 광고 표시 (1일 1회)
        if (window.AdManager && window.AdManager.showDDayRewardedAd) {
            // 저장 버튼 비활성화 (중복 클릭 방지)
            const saveBtn = document.querySelector('#dday-modal-overlay button:last-child');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.6'; }

            window.AdManager.showDDayRewardedAd(
                function onSuccess() {
                    _doSaveDDay();
                },
                function onFail() {
                    // 광고 실패/이탈 시 알림 후 버튼 복원
                    const lang = AppState.currentLang;
                    alert(i18n[lang]?.dday_ad_fail || '광고 시청이 완료되지 않았습니다. 다시 시도해 주세요.');
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = '1'; }
                }
            );
        } else {
            _doSaveDDay();
        }
    }

    function deleteDDay(idx) {
        if (!confirm(i18n[AppState.currentLang]?.dday_delete_confirm || '이 D-Day를 삭제하시겠습니까?')) return;
        AppState.ddays.splice(idx, 1);
        closeDDayModal();
        renderDDayList();
        window.saveUserData();
        scheduleDDayNotifications();
    }

    function closeDDayModal() {
        const overlay = document.getElementById('dday-modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        }
    }

    // D-Day 로컬 푸시 알림 스케줄링 (D-Day 당일 오전 9시)
    async function scheduleDDayNotifications() {
        const cap = window.Capacitor;
        if (!cap || !cap.Plugins || !cap.Plugins.LocalNotifications) {
            console.log('[D-Day] LocalNotifications 플러그인 없음, 알림 스케줄 건너뜀');
            return;
        }
        const { LocalNotifications } = cap.Plugins;

        try {
            // Android 알림 채널 생성 (없으면 알림 내용이 표시되지 않음)
            if (cap.getPlatform && cap.getPlatform() === 'android') {
                try {
                    await LocalNotifications.createChannel({
                        id: 'dday-notifications',
                        name: 'D-Day 알림',
                        description: 'D-Day 당일 리마인더 알림',
                        importance: 4,
                        sound: 'default',
                        visibility: 1
                    });
                } catch (chErr) {
                    console.warn('[D-Day] 채널 생성 실패 (무시):', chErr);
                }
            }

            // 기존 D-Day 알림 모두 취소 (ID 범위: 9000~9002)
            const idsToCancel = [{ id: 9000 }, { id: 9001 }, { id: 9002 }];
            await LocalNotifications.cancel({ notifications: idsToCancel });

            const ddays = AppState.ddays || [];
            const notifications = [];
            const now = new Date();

            ddays.forEach((dd, idx) => {
                if (dd.type !== 'dday' || !dd.pushEnabled) return;

                // D-Day 당일 오전 9시
                const scheduleDate = new Date(dd.date + 'T09:00:00');
                if (scheduleDate <= now) return; // 이미 지난 날짜는 스케줄하지 않음

                const _nt = i18n[AppState.currentLang] || {};
                notifications.push({
                    title: _nt.dday_notif_title || '📅 D-Day 알림',
                    body: (_nt.dday_notif_body || '오늘은 [{title}] D-Day 입니다!').replace('{title}', dd.title),
                    id: 9000 + idx,
                    schedule: { at: scheduleDate },
                    sound: 'default',
                    channelId: 'dday-notifications',
                    largeBody: (_nt.dday_notif_large || '오늘은 [{title}] D-Day 입니다! 목표를 향해 화이팅!').replace('{title}', dd.title),
                    summaryText: 'D-Day'
                });
            });

            if (notifications.length > 0) {
                const perm = await LocalNotifications.requestPermissions();
                if (perm.display === 'granted') {
                    await LocalNotifications.schedule({ notifications });
                    console.log(`[D-Day] ${notifications.length}개 알림 스케줄 완료`);
                    if (window.AppLogger) window.AppLogger.info(`[D-Day] ${notifications.length}개 알림 스케줄됨`);
                }
            }
        } catch(e) {
            console.warn('[D-Day] 알림 스케줄 실패:', e);
            if (window.AppLogger) window.AppLogger.warn('[D-Day] 알림 스케줄 실패: ' + e.message);
        }
    }

    // ===================== D-DAY 캡션 (목표/좌우명) =====================

    function renderDDayCaption() {
        const display = document.getElementById('dday-caption-display');
        if (!display) return;
        const caption = AppState.ddayCaption || '';
        if (caption) {
            display.innerHTML = '<span class="dday-caption-text">' + window.sanitizeText(caption) + '</span>';
        } else {
            const _t = i18n[AppState.currentLang] || {};
            display.innerHTML = '<span class="dday-caption-placeholder">' + (_t.dday_caption_placeholder || '나의 목표 / 좌우명을 입력하세요') + '</span>';
        }
    }

    function openDDayCaptionEdit() {
        const existing = document.getElementById('dday-caption-modal-overlay');
        if (existing) existing.remove();

        const currentCaption = AppState.ddayCaption || '';
        const overlay = document.createElement('div');
        overlay.id = 'dday-caption-modal-overlay';
        overlay.className = 'report-modal-overlay';
        overlay.innerHTML = `
            <div class="report-modal-content" style="max-width:360px; padding:24px;">
                <h3 style="margin:0 0 16px 0; font-size:1rem; color:var(--neon-blue);">${(i18n[AppState.currentLang] || {}).dday_caption_title || '목표 / 좌우명'}</h3>
                <textarea id="dday-caption-input" class="dday-caption-input-field" maxlength="100" placeholder="${(i18n[AppState.currentLang] || {}).dday_caption_input_placeholder || '나의 목표 또는 좌우명을 입력하세요...'}">${window.sanitizeText(currentCaption)}</textarea>
                <div style="font-size:0.7rem; color:var(--text-sub); margin-top:4px; text-align:right;">
                    <span id="dday-caption-char-count">${currentCaption.length}</span> / 100
                </div>
                <div style="display:flex; gap:8px; margin-top:16px;">
                    <button class="btn-info-sm" style="flex:1; padding:10px;" onclick="window.closeDDayCaptionModal()">${(i18n[AppState.currentLang] || {}).dday_btn_cancel || '취소'}</button>
                    <button class="btn-info-sm" style="flex:1; padding:10px; background:var(--neon-blue); color:#000; font-weight:bold;" onclick="window.saveDDayCaption()">${(i18n[AppState.currentLang] || {}).dday_btn_save || '저장'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        const input = document.getElementById('dday-caption-input');
        input.focus();
        input.addEventListener('input', function() {
            document.getElementById('dday-caption-char-count').textContent = this.value.length;
        });

        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeDDayCaptionModal();
        });
    }

    function saveDDayCaption() {
        const input = document.getElementById('dday-caption-input');
        if (!input) return;
        AppState.ddayCaption = input.value.trim();
        closeDDayCaptionModal();
        renderDDayCaption();
        window.saveUserData();
    }

    function closeDDayCaptionModal() {
        const overlay = document.getElementById('dday-caption-modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        }
    }

    // DOMContentLoaded 안전 처리
    function initDDay() {
        const addBtn = document.getElementById('btn-add-dday');
        if (addBtn) addBtn.addEventListener('click', openDDayAddModal);
        const captionCard = document.getElementById('dday-caption-card');
        if (captionCard) captionCard.addEventListener('click', openDDayCaptionEdit);
        // 모듈 로드 시 초기 렌더링 (app.js 초기화 호출보다 늦게 로드될 수 있으므로)
        renderDDayList();
        renderDDayCaption();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDDay);
    } else {
        initDDay();
    }

    // Public API — D-Day
    window.renderDDayList = renderDDayList;
    window.openDDayAddModal = openDDayAddModal;
    window.openDDayEditModal = openDDayEditModal;
    window.selectDDayType = selectDDayType;
    window.saveDDayFromModal = saveDDayFromModal;
    window.deleteDDay = deleteDDay;
    window.closeDDayModal = closeDDayModal;
    window.scheduleDDayNotifications = scheduleDDayNotifications;

    // Public API — D-Day Caption
    window.renderDDayCaption = renderDDayCaption;
    window.openDDayCaptionEdit = openDDayCaptionEdit;
    window.saveDDayCaption = saveDDayCaption;
    window.closeDDayCaptionModal = closeDDayCaptionModal;
})();
