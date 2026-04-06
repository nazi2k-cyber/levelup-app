// --- D-DAY & Life Status 기능 ---
// app.js에서 분리된 dday 모듈

import { AppState } from "./core/state.js";
import { sanitizeText, sanitizeAttr } from "./core/utils.js";

// ===================== D-DAY 기능 =====================

const DDAY_MAX = 3;

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
                    <div style="font-size:0.85rem; font-weight:bold; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${sanitizeText(dd.title)}</div>
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
            <input id="dday-input-title" type="text" maxlength="20" placeholder="${_t.dday_modal_title_placeholder || '예: 시험일, 금연 시작'}" value="${isEdit ? sanitizeAttr(dd.title) : ''}"
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

    const entry = { title, date, type, pushEnabled, createdAt: Date.now() };

    if (editIdx >= 0) {
        entry.createdAt = AppState.ddays[editIdx]?.createdAt || Date.now();
        AppState.ddays[editIdx] = entry;
    } else {
        if (AppState.ddays.length >= DDAY_MAX) {
            alert((i18n[AppState.currentLang]?.dday_limit || 'D-Day는 최대 {max}개까지 설정할 수 있습니다.').replace('{max}', DDAY_MAX));
            return;
        }
        AppState.ddays.push(entry);
    }

    closeDDayModal();
    renderDDayList();
    window.saveUserData();
    scheduleDDayNotifications();
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
                if (window.AppLogger) AppLogger.info(`[D-Day] ${notifications.length}개 알림 스케줄됨`);
            }
        }
    } catch(e) {
        console.warn('[D-Day] 알림 스케줄 실패:', e);
        if (window.AppLogger) AppLogger.warn('[D-Day] 알림 스케줄 실패: ' + e.message);
    }
}

// D-Day 버튼 이벤트 바인딩
document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('btn-add-dday');
    if (addBtn) addBtn.addEventListener('click', openDDayAddModal);
    const captionCard = document.getElementById('dday-caption-card');
    if (captionCard) captionCard.addEventListener('click', openDDayCaptionEdit);
});

// D-Day 함수들을 window에 노출 (type="module" 대응)
window.openDDayAddModal = openDDayAddModal;
window.openDDayEditModal = openDDayEditModal;
window.selectDDayType = selectDDayType;
window.saveDDayFromModal = saveDDayFromModal;
window.deleteDDay = deleteDDay;
window.closeDDayModal = closeDDayModal;

// ===================== D-DAY 캡션 (목표/좌우명) =====================

function renderDDayCaption() {
    const display = document.getElementById('dday-caption-display');
    if (!display) return;
    const caption = AppState.ddayCaption || '';
    if (caption) {
        display.innerHTML = '<span class="dday-caption-text">' + sanitizeText(caption) + '</span>';
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
            <textarea id="dday-caption-input" class="dday-caption-input-field" maxlength="100" placeholder="${(i18n[AppState.currentLang] || {}).dday_caption_input_placeholder || '나의 목표 또는 좌우명을 입력하세요...'}">${sanitizeText(currentCaption)}</textarea>
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

window.openDDayCaptionEdit = openDDayCaptionEdit;
window.saveDDayCaption = saveDDayCaption;
window.closeDDayCaptionModal = closeDDayCaptionModal;
window.renderDDayCaption = renderDDayCaption;

// ===================== LIFE STATUS 기능 =====================

const LIFE_STATUS_STORAGE_KEY = 'life_status_config';

function getLifeStatusConfig() {
    try {
        const raw = localStorage.getItem(LIFE_STATUS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function saveLifeStatusConfig(config) {
    localStorage.setItem(LIFE_STATUS_STORAGE_KEY, JSON.stringify(config));
}

function renderLifeStatus() {
    const container = document.getElementById('life-status-content');
    if (!container) return;

    const config = getLifeStatusConfig();

    const _t = i18n[AppState.currentLang] || {};
    if (!config || !config.birthday) {
        container.innerHTML = `<div style="text-align:center; padding:20px 0; color:var(--text-sub); font-size:0.85rem; line-height:1.6;">
            ${_t.ls_empty || '생년월일을 설정하여 나의 인생 현황을 확인하세요.'}
            <div style="margin-top:6px; font-size:0.75rem;">${_t.ls_privacy_hint || '🔒 저장 시 개인정보 수집에 동의하게 됩니다. 자세한 내용은 [📋 개인정보] 버튼을 확인하세요.'}</div>
        </div>`;
        return;
    }

    const now = new Date();
    const birth = new Date(config.birthday);
    const expectAge = config.expectAge || 80;

    // 살아온 날
    const daysLived = Math.floor((now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));

    // 현재 나이 (만 나이)
    let currentAge = now.getFullYear() - birth.getFullYear();
    const mDiff = now.getMonth() - birth.getMonth();
    if (mDiff < 0 || (mDiff === 0 && now.getDate() < birth.getDate())) currentAge--;

    // 기대 수명 날짜
    const expectDate = new Date(birth);
    expectDate.setFullYear(expectDate.getFullYear() + expectAge);

    // 남은 시간
    const remainMs = Math.max(0, expectDate.getTime() - now.getTime());
    const remainDays = Math.floor(remainMs / (1000 * 60 * 60 * 24));
    const remainYears = Math.floor(remainDays / 365);
    const remainMonths = Math.floor((remainDays % 365) / 30);

    // 괄호 안 단위 계산
    const remainUnit = config.remainUnit || 'hours';
    let remainDetail = '';
    if (remainUnit === 'hours') {
        remainDetail = `${Math.floor(remainMs / (1000 * 60 * 60)).toLocaleString()}${_t.ls_unit_hours || '시간'}`;
    } else if (remainUnit === 'days') {
        remainDetail = `${remainDays.toLocaleString()}${_t.ls_unit_days || '일'}`;
    } else if (remainUnit === 'weeks') {
        remainDetail = `${Math.floor(remainDays / 7).toLocaleString()}${_t.ls_unit_weeks || '주'}`;
    }

    // 인생 진행률
    const totalDays = Math.floor((expectDate.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
    const progress = Math.min(100, Math.max(0, (daysLived / totalDays) * 100));

    container.innerHTML = `
        <div class="life-status-item">
            <div>
                <div class="ls-label">${_t.ls_days_lived || '📅 살아온 날'}</div>
                <div class="ls-sub">${(_t.ls_current_age || '현재 나이: {age}세').replace('{age}', currentAge)}</div>
            </div>
            <div class="ls-value blue">${daysLived.toLocaleString()}${_t.ls_unit_days || '일'}</div>
        </div>
        <div class="life-status-item">
            <div>
                <div class="ls-label">${_t.ls_remaining || '⏳ 남은 시간'}</div>
                <div class="ls-sub">${(_t.ls_based_on_age || '{age}세 기준').replace('{age}', expectAge)}</div>
            </div>
            <div style="text-align:right;">
                <div class="ls-value gold">${(_t.ls_years_months || '{years}년 {months}개월').replace('{years}', remainYears).replace('{months}', remainMonths)}</div>
                <div style="font-size:0.75rem; color:var(--neon-blue); margin-top:2px;">(${remainDetail})</div>
            </div>
        </div>
        <div class="life-status-item">
            <div style="width:100%;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="ls-label">${(_t.ls_progress || '📊 인생 진행률 ({age}세)').replace('{age}', expectAge)}</div>
                    <div class="ls-value gold" style="font-size:1rem;">${progress.toFixed(1)}%</div>
                </div>
                <div class="life-status-progress-bar">
                    <div class="life-status-progress-fill" style="width:${progress.toFixed(1)}%;"></div>
                </div>
            </div>
        </div>`;
}

function openLifeStatusSettings() {
    const config = getLifeStatusConfig() || {};
    const overlay = document.createElement('div');
    overlay.className = 'report-modal-overlay';
    overlay.id = 'life-status-modal-overlay';

    const todayStr = new Date().toISOString().split('T')[0];
    const savedBirthday = config.birthday || '';
    const savedAge = config.expectAge || 80;
    const savedUnit = config.remainUnit || 'hours';

    const _t = i18n[AppState.currentLang] || {};
    const ageSuffix = _t.ls_unit_years_suffix ?? '세';
    const ageOptions = [60,65,70,75,80,85,90,95,100].map(a =>
        `<option value="${a}" ${a === savedAge ? 'selected' : ''}>${a}${ageSuffix}</option>`
    ).join('');

    const unitOptions = [
        { value: 'hours', label: _t.ls_unit_hours || '시간' },
        { value: 'days', label: _t.ls_unit_days || '일' },
        { value: 'weeks', label: _t.ls_unit_weeks || '주' }
    ].map(u => `<option value="${u.value}" ${u.value === savedUnit ? 'selected' : ''}>${u.label}</option>`).join('');

    overlay.innerHTML = `
    <div class="report-modal-content" style="max-width:340px; padding:20px;">
        <div style="font-size:1rem; font-weight:bold; color:var(--neon-blue); margin-bottom:14px;">${_t.ls_settings_title || 'Life Status 설정'}</div>
        <div style="margin-bottom:12px;">
            <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">${_t.ls_birthday_label || '생년월일'}</label>
            <input id="ls-input-birthday" type="date" value="${savedBirthday}" max="${todayStr}"
                style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
        </div>
        <div style="margin-bottom:12px;">
            <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">${_t.ls_expect_age_label || '기대 나이'}</label>
            <select id="ls-input-expect-age"
                style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
                ${ageOptions}
            </select>
        </div>
        <div style="margin-bottom:14px;">
            <label style="font-size:0.75rem; color:var(--text-sub); display:block; margin-bottom:4px;">${_t.ls_remain_unit_label || '남은 시간 단위'}</label>
            <select id="ls-input-remain-unit"
                style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;">
                ${unitOptions}
            </select>
        </div>
        <div style="font-size:0.65rem; color:var(--text-sub); margin-bottom:10px;">${_t.ls_security_notice || '🔒 생년월일은 계정 동기화를 위해 서버에 암호화 저장됩니다.'}</div>
        <div style="margin-bottom:14px;">
            <label id="ls-consent-checkbox-label" style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.75rem; color:var(--text-main);">
                <input type="checkbox" id="ls-consent-checkbox" ${localStorage.getItem('life_status_privacy_consent') ? 'checked' : ''} style="accent-color:var(--neon-blue); width:16px; height:16px; cursor:pointer;" readonly>
                ${_t.ls_consent_label || '📋 개인정보 수집 및 이용 동의서'}
            </label>
        </div>
        <div id="ls-loading-msg" style="display:none; text-align:center; padding:8px 0; font-size:0.8rem; color:var(--neon-blue);">${_t.ls_loading || '계산 중입니다...'}</div>
        <div style="display:flex; gap:8px;">
            ${config.birthday ? `<button onclick="resetLifeStatus()" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--neon-red); background:transparent; color:var(--neon-red); font-size:0.85rem; font-weight:bold; cursor:pointer;">${_t.ls_btn_reset || '초기화'}</button>` : ''}
            <button onclick="closeLifeStatusModal()" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--border-color); background:transparent; color:var(--text-sub); font-size:0.85rem; cursor:pointer;">${_t.ls_btn_cancel || '취소'}</button>
            <button onclick="saveLifeStatusFromModal()" style="flex:1; padding:10px; border-radius:6px; border:none; background:var(--neon-blue); color:#000; font-size:0.85rem; font-weight:bold; cursor:pointer;">${_t.ls_btn_save || '저장'}</button>
        </div>
    </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    // 체크박스 클릭 시 동의 모달 호출
    const consentCheckbox = overlay.querySelector('#ls-consent-checkbox');
    if (consentCheckbox) {
        consentCheckbox.addEventListener('click', (e) => {
            e.preventDefault();
            openLifeStatusPrivacyModal();
        });
    }
}

function saveLifeStatusFromModal() {
    const birthday = document.getElementById('ls-input-birthday')?.value || '';
    const expectAge = parseInt(document.getElementById('ls-input-expect-age')?.value) || 80;
    const remainUnit = document.getElementById('ls-input-remain-unit')?.value || 'hours';

    if (!birthday) { alert(i18n[AppState.currentLang]?.birthday_required || '생년월일을 입력하세요.'); return; }

    // 개인정보 동의 여부 확인
    const hasConsent = localStorage.getItem('life_status_privacy_consent');
    if (!hasConsent) {
        alert(i18n[AppState.currentLang]?.privacy_consent_required || '개인정보 수집 및 이용에 동의해야 저장할 수 있습니다.');
        return;
    }

    _doSaveLifeStatus(birthday, expectAge, remainUnit);
}

function _doSaveLifeStatus(birthday, expectAge, remainUnit) {
    const loadingMsg = document.getElementById('ls-loading-msg');
    let loadingShown = false;

    const loadingTimer = setTimeout(() => {
        if (loadingMsg) { loadingMsg.style.display = 'block'; loadingShown = true; }
    }, 1000);

    requestAnimationFrame(() => {
        saveLifeStatusConfig({ birthday, expectAge, remainUnit });
        renderLifeStatus();
        window.saveUserData();
        clearTimeout(loadingTimer);

        if (loadingShown) {
            setTimeout(() => closeLifeStatusModal(), 500);
        } else {
            closeLifeStatusModal();
        }
    });
}

function openLifeStatusPrivacyModal(onAgreeCallback) {
    const overlay = document.createElement('div');
    overlay.className = 'report-modal-overlay';
    overlay.id = 'life-status-privacy-overlay';

    const _t = i18n[AppState.currentLang] || {};
    overlay.innerHTML = `
    <div class="report-modal-content" style="max-width:380px; padding:20px; max-height:80vh; overflow-y:auto;">
        <div style="font-size:1rem; font-weight:bold; color:var(--neon-blue); margin-bottom:14px;">${_t.ls_privacy_title || '개인정보 수집 및 이용 동의서'}</div>

        <div style="font-size:0.78rem; color:var(--text-main); line-height:1.7; margin-bottom:14px;">
            <p style="margin:0 0 10px 0; color:var(--text-sub);">
                ${_t.ls_privacy_intro || 'LevelUp은 「개인정보 보호법」에 따라 아래와 같이 개인정보를 수집·이용하고자 합니다. 내용을 확인 후 동의 여부를 결정해 주세요.'}
            </p>

            <table style="width:100%; border-collapse:collapse; font-size:0.75rem; margin-bottom:12px;">
                <thead>
                    <tr style="background:rgba(0,180,255,0.1);">
                        <th style="border:1px solid var(--border-color); padding:8px; text-align:left; color:var(--neon-blue);">${_t.ls_privacy_th_item || '항목'}</th>
                        <th style="border:1px solid var(--border-color); padding:8px; text-align:left; color:var(--neon-blue);">${_t.ls_privacy_th_content || '내용'}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border:1px solid var(--border-color); padding:8px; color:var(--text-sub); white-space:nowrap;">${_t.ls_privacy_collect_label || '수집 항목'}</td>
                        <td style="border:1px solid var(--border-color); padding:8px;">${_t.ls_privacy_collect_value || '생년월일, 기대 수명 설정값'}</td>
                    </tr>
                    <tr>
                        <td style="border:1px solid var(--border-color); padding:8px; color:var(--text-sub); white-space:nowrap;">${_t.ls_privacy_purpose_label || '수집 목적'}</td>
                        <td style="border:1px solid var(--border-color); padding:8px;">${_t.ls_privacy_purpose_value || 'Life Status(인생 현황) 기능 제공 및 기기 간 데이터 동기화'}</td>
                    </tr>
                    <tr>
                        <td style="border:1px solid var(--border-color); padding:8px; color:var(--text-sub); white-space:nowrap;">${_t.ls_privacy_period_label || '보유 기간'}</td>
                        <td style="border:1px solid var(--border-color); padding:8px;">${_t.ls_privacy_period_value || '회원 탈퇴 시 또는 이용자가 직접 초기화 시 즉시 파기'}</td>
                    </tr>
                </tbody>
            </table>

            <div style="background:var(--panel-bg); border:1px solid var(--border-color); border-radius:6px; padding:10px; margin-bottom:12px; font-size:0.72rem; color:var(--text-sub); line-height:1.6;">
                <div style="margin-bottom:4px; font-weight:bold; color:var(--text-main);">${_t.ls_privacy_notice_title || '안내 사항'}</div>
                • ${_t.ls_privacy_notice_1 || '수집된 정보는 Firebase 서버에 암호화되어 저장됩니다.'}<br>
                • ${_t.ls_privacy_notice_2 || '수집된 정보는 위 목적 외 다른 용도로 사용되지 않습니다.'}<br>
                • ${_t.ls_privacy_notice_3 || '동의를 거부할 수 있으며, 거부 시 Life Status 기능 이용이 제한됩니다.'}<br>
                • ${_t.ls_privacy_notice_4 || '설정 화면의 [초기화] 버튼으로 언제든지 정보를 삭제하고 동의를 철회할 수 있습니다.'}
            </div>
        </div>

        <div style="display:flex; gap:8px;">
            <button id="ls-privacy-disagree-btn" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--border-color); background:transparent; color:var(--text-sub); font-size:0.85rem; cursor:pointer;">${_t.ls_privacy_disagree || '동의하지 않음'}</button>
            <button id="ls-privacy-agree-btn" style="flex:1; padding:10px; border-radius:6px; border:none; background:var(--neon-blue); color:#000; font-size:0.85rem; font-weight:bold; cursor:pointer;">${_t.ls_privacy_agree || '동의'}</button>
        </div>
    </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    overlay.querySelector('#ls-privacy-agree-btn').addEventListener('click', () => {
        localStorage.setItem('life_status_privacy_consent', new Date().toISOString());
        closeLifeStatusPrivacyModal();
        const cb = document.getElementById('ls-consent-checkbox');
        if (cb) cb.checked = true;
        if (typeof onAgreeCallback === 'function') onAgreeCallback();
    });

    overlay.querySelector('#ls-privacy-disagree-btn').addEventListener('click', () => {
        // 동의하지 않음 선택 시 자동 초기화
        localStorage.removeItem(LIFE_STATUS_STORAGE_KEY);
        localStorage.removeItem('life_status_privacy_consent');
        closeLifeStatusPrivacyModal();
        const cb = document.getElementById('ls-consent-checkbox');
        if (cb) cb.checked = false;
        renderLifeStatus();
        window.saveUserData();
    });
}

function closeLifeStatusPrivacyModal() {
    const overlay = document.getElementById('life-status-privacy-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}

function resetLifeStatus() {
    if (!confirm(i18n[AppState.currentLang]?.life_status_reset_confirm || 'Life Status 정보를 초기화하시겠습니까?\n개인정보 수집 동의도 함께 철회됩니다.')) return;
    localStorage.removeItem(LIFE_STATUS_STORAGE_KEY);
    localStorage.removeItem('life_status_privacy_consent');
    closeLifeStatusModal();
    renderLifeStatus();
    window.saveUserData();
}

function closeLifeStatusModal() {
    const overlay = document.getElementById('life-status-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}

// Life Status 이벤트 바인딩
document.addEventListener('DOMContentLoaded', () => {
    const settingsBtn = document.getElementById('btn-life-status-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', openLifeStatusSettings);
    renderLifeStatus();
});

// Life Status 함수들을 window에 노출
window.openLifeStatusSettings = openLifeStatusSettings;
window.openLifeStatusPrivacyModal = openLifeStatusPrivacyModal;
window.closeLifeStatusPrivacyModal = closeLifeStatusPrivacyModal;
window.saveLifeStatusFromModal = saveLifeStatusFromModal;
window.resetLifeStatus = resetLifeStatus;
window.closeLifeStatusModal = closeLifeStatusModal;
window.renderLifeStatus = renderLifeStatus;

// app.js에서 호출하는 렌더링 함수들도 window에 등록
window.renderDDayList = renderDDayList;
window.renderDDayCaption = renderDDayCaption;
window.scheduleDDayNotifications = scheduleDDayNotifications;

