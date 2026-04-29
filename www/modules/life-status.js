// ===== Life Status (인생 현황) 기능 모듈 =====
(function() {
    'use strict';

    const AppState = window.AppState;
    const i18n = window.i18n;

    const LIFE_STATUS_STORAGE_KEY = 'life_status_config';
    const HABIT_PROJECT_STORAGE_KEY = 'habit_project_config';
    const HABIT_DIFFICULTY_DAYS = { easy: 18, medium: 66, hard: 254 };
    const HABIT_DIFFICULTY_AGI_REWARD = { easy: 0.1, medium: 0.2, hard: 0.3 };
    const HABIT_STAGE_COLORS = {
        resistance: 'rgba(255, 107, 107, 0.6)',
        transition: 'rgba(255, 193, 7, 0.6)',
        automation: 'rgba(0, 217, 255, 0.6)'
    };

    function getLifeStatusConfig() {
        try {
            const raw = localStorage.getItem(LIFE_STATUS_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function saveLifeStatusConfig(config) {
        localStorage.setItem(LIFE_STATUS_STORAGE_KEY, JSON.stringify(config));
    }

    function getTodayStr() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function getHabitProjectConfig() {
        try {
            const raw = localStorage.getItem(HABIT_PROJECT_STORAGE_KEY);
            if (!raw) {
                return {
                    habitName: '',
                    difficulty: 'medium',
                    totalDays: HABIT_DIFFICULTY_DAYS.medium,
                    startDate: getTodayStr(),
                    checks: {}
                };
            }
            const parsed = JSON.parse(raw) || {};
            const difficulty = HABIT_DIFFICULTY_DAYS[parsed.difficulty] ? parsed.difficulty : 'medium';
            const totalDays = HABIT_DIFFICULTY_DAYS[difficulty];
            return {
                habitName: typeof parsed.habitName === 'string' ? parsed.habitName : '',
                difficulty,
                totalDays,
                startDate: (typeof parsed.startDate === 'string' && parsed.startDate) ? parsed.startDate : getTodayStr(),
                checks: (parsed.checks && typeof parsed.checks === 'object') ? parsed.checks : {}
            };
        } catch (e) {
            return {
                habitName: '',
                difficulty: 'medium',
                totalDays: HABIT_DIFFICULTY_DAYS.medium,
                startDate: getTodayStr(),
                checks: {}
            };
        }
    }

    function saveHabitProjectConfig(config) {
        localStorage.setItem(HABIT_PROJECT_STORAGE_KEY, JSON.stringify(config));
    }

    function getDifficultyEmoji(difficulty) {
        if (difficulty === 'easy') return '🌱';
        if (difficulty === 'hard') return '🚀';
        return '🔥';
    }

    function getHabitAgiRewardByDifficulty(difficulty) {
        return HABIT_DIFFICULTY_AGI_REWARD[difficulty] || HABIT_DIFFICULTY_AGI_REWARD.medium;
    }

    function formatGuideText(rawText) {
        return String(rawText || '')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('<br>');
    }

    function escapeHabitNameText(value) {
        const raw = String(value || '');
        if (typeof window.escapeHtml === 'function') {
            return window.escapeHtml(raw);
        }
        return raw
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getHabitStageRanges(totalDays) {
        const safeTotalDays = Math.max(1, Number(totalDays) || 1);
        const stage1End = Math.max(1, Math.round(safeTotalDays / 3));
        const stage2End = Math.max(stage1End + 1, Math.round((safeTotalDays * 2) / 3));
        return {
            stage1Start: 1,
            stage1End,
            stage2Start: stage1End + 1,
            stage2End,
            stage3Start: stage2End + 1,
            stage3End: safeTotalDays
        };
    }

    function getHabitElapsedDays(config) {
        const start = new Date(config.startDate);
        const today = new Date();
        start.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        const elapsedDaysRaw = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
        return Math.max(0, Math.min(config.totalDays, elapsedDaysRaw));
    }

    function buildArrowRow(rowDays, reverse, stageType, stageLabel, config, elapsedDays, _t) {
        const items = rowDays.map((day) => {
            const checked = !!config.checks[String(day)];
            const shouldFill = day <= elapsedDays;
            const fillColor = shouldFill ? HABIT_STAGE_COLORS[stageType] : 'rgba(255,255,255,0.06)';
            return `<button class="habit-day-dot ${checked ? 'checked' : ''} ${shouldFill ? 'elapsed' : ''}"
                        type="button"
                        data-day="${day}"
                        title="${(_t.habit_day_title || 'Day {day}').replace('{day}', day)}"
                        style="background:${fillColor};"
                    >${checked ? '✔' : day}</button>`;
        }).join('');

        return `
            <div class="habit-arrow-row-wrap ${stageType}">
                <div class="habit-arrow-title">${stageLabel}</div>
                <div class="habit-arrow-row ${reverse ? 'reverse' : ''} ${stageType}">
                <div class="habit-arrow-body">${items}</div>
                <div class="habit-arrow-head"></div>
                </div>
            </div>
        `;
    }

    function renderHabitProject(config, _t) {
        const start = new Date(config.startDate);
        const elapsedDays = getHabitElapsedDays(config);
        const checkedDays = Object.values(config.checks).filter(Boolean).length;
        const completionRate = config.totalDays > 0 ? (checkedDays / config.totalDays) * 100 : 0;

        const targetDate = new Date(start);
        targetDate.setDate(start.getDate() + config.totalDays - 1);
        const targetDateStr = targetDate.toISOString().split('T')[0];

        const allDays = Array.from({ length: config.totalDays }, (_, i) => i + 1);
        const ranges = getHabitStageRanges(config.totalDays);
        const row1 = allDays.slice(0, ranges.stage1End);
        const row2 = allDays.slice(ranges.stage1End, ranges.stage2End);
        const row3 = allDays.slice(ranges.stage2End);

        const stage1Label = (_t.habit_stage1_title || '저항 단계')
            + ` (${ranges.stage1Start}~${ranges.stage1End}${_t.ls_unit_days || '일'})`;
        const stage2Label = (_t.habit_stage2_title || '과도기 단계')
            + ` (${ranges.stage2Start}~${ranges.stage2End}${_t.ls_unit_days || '일'})`;
        const stage3Label = (_t.habit_stage3_title || '자동화 단계')
            + ` (${ranges.stage3Start}~${ranges.stage3End}${_t.ls_unit_days || '일'})`;

        return `
            <div class="habit-project-wrap">
                <div class="habit-project-title-row">
                    <div class="habit-project-title">${getDifficultyEmoji(config.difficulty)} ${_t.habit_project_title || '습관형성 프로젝트'}</div>
                    <div class="habit-project-actions">
                        <button type="button" class="btn-info-sm" id="btn-habit-settings">${_t.settings_btn || '설정'}</button>
                        <button type="button" class="btn-info-sm" id="btn-habit-guide">ℹ️ ${_t.habit_guide_btn || '가이드'}</button>
                    </div>
                </div>

                <div class="habit-info-row">
                    <label>${_t.habit_name_label || '원하는 습관명'}</label>
                    <div class="habit-name-view">${escapeHabitNameText(config.habitName)}</div>
                    <div class="habit-dates-row">
                        <div class="habit-date-stack">
                            <div class="habit-start-date">${(_t.habit_start_date || '시작일: {date}').replace('{date}', config.startDate)}</div>
                            <div class="habit-stat-item habit-stat-target">${(_t.habit_target_date || '달성일: {date}').replace('{date}', targetDateStr)}</div>
                        </div>
                        <div class="habit-stats-row">
                            <span class="habit-stat-item habit-stat-elapsed">${(_t.habit_elapsed_days || '경과일: {days}일').replace('{days}', elapsedDays)}</span>
                            <span class="habit-stat-item habit-stat-rate">${(_t.habit_completion_rate || '달성률: {rate}%').replace('{rate}', completionRate.toFixed(1))}</span>
                        </div>
                    </div>
                </div>

                <div class="habit-arrow-z-wrap">
                    ${buildArrowRow(row1, false, 'resistance', stage1Label, config, elapsedDays, _t)}
                    ${row2.length ? '<div class="habit-z-connector right-to-left"></div>' : ''}
                    ${row2.length ? buildArrowRow(row2, true, 'transition', stage2Label, config, elapsedDays, _t) : ''}
                    ${row3.length ? '<div class="habit-z-connector left-to-right"></div>' : ''}
                    ${row3.length ? buildArrowRow(row3, false, 'automation', stage3Label, config, elapsedDays, _t) : ''}
                </div>

            </div>
        `;
    }

    function renderLifeStatus() {
        const container = document.getElementById('life-status-content');
        if (!container) return;

        const config = getLifeStatusConfig();
        const _t = i18n[AppState.currentLang] || {};
        let lifeStatusHTML = '';

        if (!config || !config.birthday) {
            lifeStatusHTML = `<div style="text-align:center; padding:20px 0; color:var(--text-sub); font-size:0.85rem; line-height:1.6;">
                ${_t.ls_empty || '생년월일을 설정하여 나의 인생 현황을 확인하세요.'}
                <div style="margin-top:6px; font-size:0.75rem;">${_t.ls_privacy_hint || '🔒 저장 시 개인정보 수집에 동의하게 됩니다. 자세한 내용은 [📋 개인정보] 버튼을 확인하세요.'}</div>
            </div>`;
        } else {
            const now = new Date();
            const birth = new Date(config.birthday);
            const expectAge = config.expectAge || 80;

            const daysLived = Math.floor((now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));

            let currentAge = now.getFullYear() - birth.getFullYear();
            const mDiff = now.getMonth() - birth.getMonth();
            if (mDiff < 0 || (mDiff === 0 && now.getDate() < birth.getDate())) currentAge--;

            const expectDate = new Date(birth);
            expectDate.setFullYear(expectDate.getFullYear() + expectAge);

            const remainMs = Math.max(0, expectDate.getTime() - now.getTime());
            const remainDays = Math.floor(remainMs / (1000 * 60 * 60 * 24));
            const remainYears = Math.floor(remainDays / 365);
            const remainMonths = Math.floor((remainDays % 365) / 30);

            const remainUnit = config.remainUnit || 'hours';
            let remainDetail = '';
            if (remainUnit === 'hours') {
                remainDetail = `${Math.floor(remainMs / (1000 * 60 * 60)).toLocaleString()}${_t.ls_unit_hours || '시간'}`;
            } else if (remainUnit === 'days') {
                remainDetail = `${remainDays.toLocaleString()}${_t.ls_unit_days || '일'}`;
            } else if (remainUnit === 'weeks') {
                remainDetail = `${Math.floor(remainDays / 7).toLocaleString()}${_t.ls_unit_weeks || '주'}`;
            }

            const totalDays = Math.floor((expectDate.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
            const progress = Math.min(100, Math.max(0, (daysLived / totalDays) * 100));

            lifeStatusHTML = `
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

        container.innerHTML = lifeStatusHTML;
        renderHabitProjectSection();
    }

    function renderHabitProjectSection() {
        const container = document.getElementById('habit-project-content');
        if (!container) return;
        const _t = i18n[AppState.currentLang] || {};
        const habitConfig = getHabitProjectConfig();
        container.innerHTML = renderHabitProject(habitConfig, _t);
        bindHabitProjectEvents(container);
    }

    function bindHabitProjectEvents(container) {
        container.querySelectorAll('.habit-day-dot').forEach((dot) => {
            dot.addEventListener('click', () => {
                const day = Number(dot.dataset.day);
                if (!day) return;
                const cfg = getHabitProjectConfig();
                const elapsedDays = getHabitElapsedDays(cfg);
                if (day > elapsedDays) {
                    alert(i18n[AppState.currentLang]?.habit_future_check_error || '미래 날짜는 체크할 수 없습니다.');
                    return;
                }
                const wasChecked = !!cfg.checks[String(day)];
                const willCheck = !wasChecked;
                cfg.checks[String(day)] = willCheck;
                if (willCheck) {
                    const agiReward = getHabitAgiRewardByDifficulty(cfg.difficulty);
                    if (AppState.user?.pendingStats && typeof AppState.user.pendingStats.agi === 'number') {
                        AppState.user.pendingStats.agi += agiReward;
                    }
                    if (typeof window.showToast === 'function') {
                        const _t = i18n[AppState.currentLang] || {};
                        const msgTpl = _t.habit_check_reward_msg || '습관 달성! ⚡ AGI +{agi}';
                        window.showToast(msgTpl.replace('{agi}', String(agiReward)));
                    }
                }
                saveHabitProjectConfig(cfg);
                window.saveUserData?.();
                renderHabitProjectSection();
            });
        });

        const guideBtn = container.querySelector('#btn-habit-guide');
        if (guideBtn) {
            guideBtn.addEventListener('click', openHabitGuideModal);
        }
        const settingsBtn = container.querySelector('#btn-habit-settings');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', openHabitProjectSettingsModal);
        }
    }

    function openHabitGuideModal() {
        const _t = i18n[AppState.currentLang] || {};
        const overlay = document.createElement('div');
        overlay.className = 'report-modal-overlay active';
        overlay.id = 'habit-guide-modal-overlay';

        const guideText = formatGuideText(_t.habit_guide_text || '');
        const persistNote = (_t.habit_persist_note || '※ 달성 체크 기록은 로그아웃 후에도 동기화되어 유지됩니다.').trim();

        overlay.innerHTML = `
            <div class="report-modal-content habit-guide-modal">
                <div class="habit-guide-title">${_t.habit_guide_title || '습관 형성 가이드'}</div>
                <div class="habit-guide-body">${guideText}${guideText ? '<br><br>' : ''}<strong>${persistNote}</strong></div>
                <div style="display:flex; justify-content:flex-end; margin-top:12px;">
                    <button onclick="window.closeHabitGuideModal()" class="btn-info-sm">${_t.ls_btn_cancel || '닫기'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeHabitGuideModal();
        });
    }

    function closeHabitGuideModal() {
        const overlay = document.getElementById('habit-guide-modal-overlay');
        if (overlay) overlay.remove();
    }

    function openHabitProjectSettingsModal() {
        const _t = i18n[AppState.currentLang] || {};
        const cfg = getHabitProjectConfig();
        const overlay = document.createElement('div');
        overlay.className = 'report-modal-overlay active';
        overlay.id = 'habit-settings-modal-overlay';

        const difficultyOptions = ['easy', 'medium', 'hard'].map((key) =>
            `<option value="${key}" ${cfg.difficulty === key ? 'selected' : ''}>
                ${_t[`habit_difficulty_${key}`] || key} (${HABIT_DIFFICULTY_DAYS[key]}${_t.ls_unit_days || '일'})
            </option>`
        ).join('');

        overlay.innerHTML = `
            <div class="report-modal-content habit-settings-modal">
                <div class="habit-guide-title">${_t.habit_settings_title || '습관형성 프로젝트 설정'}</div>
                <div class="habit-settings-field">
                    <label for="habit-settings-name">${_t.habit_name_label || '원하는 습관명'}</label>
                    <input id="habit-settings-name" maxlength="60" value="${window.sanitizeAttr(cfg.habitName || '')}" placeholder="${_t.habit_name_placeholder || '예: 물 2L 마시기'}" />
                </div>
                <div class="habit-settings-field">
                    <label for="habit-settings-difficulty">${_t.habit_difficulty_label || '난이도'}</label>
                    <select id="habit-settings-difficulty">${difficultyOptions}</select>
                </div>
                <div class="report-modal-actions">
                    <button type="button" class="report-modal-btn report-modal-reset" onclick="window.resetHabitProjectSettingsFromModal()">${_t.ls_btn_reset || '초기화'}</button>
                    <button type="button" class="report-modal-btn report-modal-cancel" onclick="window.closeHabitProjectSettingsModal()">${_t.ls_btn_cancel || '취소'}</button>
                    <button type="button" class="report-modal-btn report-modal-submit" onclick="window.saveHabitProjectSettingsFromModal()">${_t.ls_btn_save || '저장'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeHabitProjectSettingsModal();
        });
    }

    function closeHabitProjectSettingsModal() {
        document.getElementById('habit-settings-modal-overlay')?.remove();
    }

    function saveHabitProjectSettingsFromModal() {
        const _t = i18n[AppState.currentLang] || {};
        const name = (document.getElementById('habit-settings-name')?.value || '').trim();
        const difficulty = document.getElementById('habit-settings-difficulty')?.value || 'medium';
        if (!name) {
            alert(_t.habit_name_required || '습관명을 입력해주세요.');
            return;
        }
        if (!HABIT_DIFFICULTY_DAYS[difficulty]) return;
        const cfg = getHabitProjectConfig();
        const difficultyChanged = cfg.difficulty !== difficulty;
        cfg.habitName = name;
        cfg.difficulty = difficulty;
        cfg.totalDays = HABIT_DIFFICULTY_DAYS[difficulty];
        if (difficultyChanged) {
            cfg.startDate = getTodayStr();
            cfg.checks = {};
        }
        saveHabitProjectConfig(cfg);
        window.saveUserData?.();
        closeHabitProjectSettingsModal();
        renderHabitProjectSection();
    }

    function resetHabitProjectSettingsFromModal() {
        const _t = i18n[AppState.currentLang] || {};
        const confirmed = confirm(_t.habit_reset_confirm || '습관형성 프로젝트를 초기화하시겠습니까?\n습관명/난이도/체크 기록이 모두 초기화됩니다.');
        if (!confirmed) return;
        const resetConfig = {
            habitName: '',
            difficulty: 'medium',
            totalDays: HABIT_DIFFICULTY_DAYS.medium,
            startDate: getTodayStr(),
            checks: {}
        };
        saveHabitProjectConfig(resetConfig);
        window.saveUserData?.();
        closeHabitProjectSettingsModal();
        renderHabitProjectSection();
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

        const yearOptArr = [`<option value="">${_t.ls_birthday_year_placeholder || '연도'}</option>`];
        for (let y = currentYear; y >= 1920; y--) {
            yearOptArr.push(`<option value="${y}" ${y.toString() === savedYear ? 'selected' : ''}>${y}${yearSuffix}</option>`);
        }

        const monthOptArr = [`<option value="">${_t.ls_birthday_month_placeholder || '월'}</option>`];
        for (let m = 1; m <= 12; m++) {
            monthOptArr.push(`<option value="${m}" ${m.toString() === savedMonth ? 'selected' : ''}>${m}${monthSuffix}</option>`);
        }

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

        const todayStr = new Date().toISOString().split('T')[0];
        if (birthday > todayStr) {
            alert(i18n[AppState.currentLang]?.birthday_future_error || '생년월일은 오늘 날짜보다 이전이어야 합니다.');
            return;
        }

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

    window.renderLifeStatus = renderLifeStatus;
    window.openLifeStatusSettings = openLifeStatusSettings;
    window.saveLifeStatusFromModal = saveLifeStatusFromModal;
    window.resetLifeStatus = resetLifeStatus;
    window.closeLifeStatusModal = closeLifeStatusModal;
    window.closeHabitGuideModal = closeHabitGuideModal;
    window.closeHabitProjectSettingsModal = closeHabitProjectSettingsModal;
    window.saveHabitProjectSettingsFromModal = saveHabitProjectSettingsFromModal;
    window.resetHabitProjectSettingsFromModal = resetHabitProjectSettingsFromModal;
})();
