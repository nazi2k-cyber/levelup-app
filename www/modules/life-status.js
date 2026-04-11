// ===== Life Status (인생 현황) 기능 모듈 =====
(function() {
    'use strict';

    const AppState = window.AppState;
    const i18n = window.i18n;

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

    // DOMContentLoaded 안전 처리
    function initLifeStatus() {
        const settingsBtn = document.getElementById('btn-life-status-settings');
        if (settingsBtn) settingsBtn.addEventListener('click', openLifeStatusSettings);
        renderLifeStatus();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLifeStatus);
    } else {
        initLifeStatus();
    }

    // Public API
    window.renderLifeStatus = renderLifeStatus;
    window.openLifeStatusSettings = openLifeStatusSettings;
    window.openLifeStatusPrivacyModal = openLifeStatusPrivacyModal;
    window.closeLifeStatusPrivacyModal = closeLifeStatusPrivacyModal;
    window.saveLifeStatusFromModal = saveLifeStatusFromModal;
    window.resetLifeStatus = resetLifeStatus;
    window.closeLifeStatusModal = closeLifeStatusModal;
})();
