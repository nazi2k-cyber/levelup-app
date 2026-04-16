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
                <div class="ls-label">${_t.ls_days_lived || '살아온 날'}</div>
                <div class="ls-sub">${(_t.ls_current_age || '현재 나이: {age}세').replace('{age}', currentAge)}</div>
            </div>
            <div class="ls-value blue">${daysLived.toLocaleString()}${_t.ls_unit_days || '일'}</div>
        </div>
        <div class="life-status-item">
            <div>
                <div class="ls-label">${_t.ls_remaining || '남은 시간'}</div>
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
                    <div class="ls-label">${(_t.ls_progress || '인생 진행률 ({age}세)').replace('{age}', expectAge)}</div>
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

        const savedBirthday = config.birthday || '';
        const savedAge = config.expectAge || 80;
        const savedUnit = config.remainUnit || 'hours';

        const _t = i18n[AppState.currentLang] || {};
        const ageSuffix = _t.ls_unit_years_suffix ?? '세';

        // 저장된 생년월일을 연/월/일로 분리
        let savedYear = '', savedMonth = '', savedDay = '';
        if (savedBirthday) {
            const parts = savedBirthday.split('-');
            if (parts.length === 3) {
                savedYear = parts[0];
                savedMonth = String(parseInt(parts[1]));
                savedDay = String(parseInt(parts[2]));
            }
        }

        const currentYear = new Date().getFullYear();
        const yearSuffix = _t.ls_year_suffix ?? '년';
        const monthSuffix = _t.ls_month_suffix ?? '월';
        const daySuffix = _t.ls_day_suffix ?? '일';

        function getDaysInMonth(year, month) {
            if (!year || !month) return 31;
            return new Date(parseInt(year), parseInt(month), 0).getDate();
        }

        // 연도 선택 옵션 (현재 연도 → 1920)
        const yearOptArr = [`<option value="">${_t.ls_birthday_year_placeholder || '연도'}</option>`];
        for (let y = currentYear; y >= 1920; y--) {
            yearOptArr.push(`<option value="${y}" ${y.toString() === savedYear ? 'selected' : ''}>${y}${yearSuffix}</option>`);
        }

        // 월 선택 옵션 (1 ~ 12)
        const monthOptArr = [`<option value="">${_t.ls_birthday_month_placeholder || '월'}</option>`];
        for (let m = 1; m <= 12; m++) {
            monthOptArr.push(`<option value="${m}" ${m.toString() === savedMonth ? 'selected' : ''}>${m}${monthSuffix}</option>`);
        }

        // 일 선택 옵션 (저장된 연/월 기준으로 초기화)
        const initMaxDays = getDaysInMonth(savedYear, savedMonth);
        const dayOptArr = [`<option value="">${_t.ls_birthday_day_placeholder || '일'}</option>`];
        for (let d = 1; d <= initMaxDays; d++) {
            dayOptArr.push(`<option value="${d}" ${d.toString() === savedDay ? 'selected' : ''}>${d}${daySuffix}</option>`);
        }
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
            <div style="display:flex; gap:6px;">
                <select id="ls-input-birth-year" style="flex:5; padding:8px 6px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box; cursor:pointer;">
                    ${yearOptArr.join('')}
                </select>
                <select id="ls-input-birth-month" style="flex:3; padding:8px 6px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box; cursor:pointer;">
                    ${monthOptArr.join('')}
                </select>
                <select id="ls-input-birth-day" style="flex:3; padding:8px 6px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box; cursor:pointer;">
                    ${dayOptArr.join('')}
                </select>
            </div>
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
            <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:var(--text-main);">
                <input type="checkbox" id="ls-consent-checkbox" ${localStorage.getItem('life_status_privacy_consent') ? 'checked' : ''} style="accent-color:var(--neon-blue); width:16px; height:16px; cursor:pointer;">
                <span id="ls-consent-link" style="cursor:pointer; text-decoration:underline; color:var(--neon-blue);">${_t.ls_consent_label || '📋 개인정보 수집 및 이용 동의서'}</span>
            </div>
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

        // 연도/월 변경 시 일(day) 옵션 동적 업데이트
        const yearSelect = overlay.querySelector('#ls-input-birth-year');
        const monthSelect = overlay.querySelector('#ls-input-birth-month');
        const daySelect = overlay.querySelector('#ls-input-birth-day');

        function updateDayOptions() {
            const year = yearSelect ? yearSelect.value : '';
            const month = monthSelect ? monthSelect.value : '';
            const prevDay = daySelect ? daySelect.value : '';
            const maxDays = getDaysInMonth(year, month);
            if (daySelect) {
                daySelect.innerHTML = `<option value="">${_t.ls_birthday_day_placeholder || '일'}</option>`;
                for (let d = 1; d <= maxDays; d++) {
                    const opt = document.createElement('option');
                    opt.value = d;
                    opt.textContent = `${d}${daySuffix}`;
                    if (d.toString() === prevDay) opt.selected = true;
                    daySelect.appendChild(opt);
                }
            }
        }

        if (yearSelect) yearSelect.addEventListener('change', updateDayOptions);
        if (monthSelect) monthSelect.addEventListener('change', updateDayOptions);

        // 체크박스 토글로 동의/철회 직접 처리
        const consentCheckbox = overlay.querySelector('#ls-consent-checkbox');
        if (consentCheckbox) {
            consentCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    localStorage.setItem('life_status_privacy_consent', new Date().toISOString());
                } else {
                    const confirmMsg = _t.ls_consent_withdraw_confirm || 'Life Status 개인정보 수집 동의를 철회하시겠습니까?\n저장된 Life Status 데이터가 삭제됩니다.';
                    if (confirm(confirmMsg)) {
                        localStorage.removeItem('life_status_privacy_consent');
                        localStorage.removeItem(LIFE_STATUS_STORAGE_KEY);
                        renderLifeStatus();
                        window.saveUserData();
                    } else {
                        e.target.checked = true;
                    }
                }
            });
        }

        // 동의서 텍스트 링크 클릭 시 HTML 페이지 열기
        const consentLink = overlay.querySelector('#ls-consent-link');
        if (consentLink) {
            consentLink.addEventListener('click', () => {
                window.openLegalPage('life-status-consent');
            });
        }
    }

    function saveLifeStatusFromModal() {
        const year = document.getElementById('ls-input-birth-year')?.value || '';
        const month = document.getElementById('ls-input-birth-month')?.value || '';
        const day = document.getElementById('ls-input-birth-day')?.value || '';
        const expectAge = parseInt(document.getElementById('ls-input-expect-age')?.value) || 80;
        const remainUnit = document.getElementById('ls-input-remain-unit')?.value || 'hours';

        if (!year || !month || !day) {
            alert(i18n[AppState.currentLang]?.birthday_required || '생년월일을 입력하세요.');
            return;
        }

        const birthday = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // 미래 날짜 검증
        const todayStr = new Date().toISOString().split('T')[0];
        if (birthday > todayStr) {
            alert(i18n[AppState.currentLang]?.birthday_future_error || '생년월일은 오늘 날짜보다 이전이어야 합니다.');
            return;
        }

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
    window.saveLifeStatusFromModal = saveLifeStatusFromModal;
    window.resetLifeStatus = resetLifeStatus;
    window.closeLifeStatusModal = closeLifeStatusModal;
})();
