// ===== 미래 순자산 (Future Net Worth) 모듈 =====
(function() {
    'use strict';

    const AppState = window.AppState;
    const i18n = window.i18n;

    const STORAGE_KEY = 'future_networth_config';

    function getConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function saveConfig(config) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }

    /**
     * 미래 순자산 산식
     * W_total = W_0 * ((1+r)^n - 1) / r   (r=0이면 W_0 * n)
     * E_fixed  = W_total * e
     * NW_n     = A_0 + (W_total - E_fixed) - S_non
     * M_save   = S_non / (n * 12)
     * M_avail  = W_total * (1 - e) / (n * 12)
     */
    function calcNetWorth(config) {
        const { n, W_0, A_0, r, e, s_car, s_housing, s_wedding, s_edu, s_medical, s_travel } = config;

        if (!n || !W_0 || n <= 0 || W_0 <= 0) return null;

        const rVal = (r || 0) / 100;
        const eVal = (e || 70) / 100;
        const S_non = (s_car || 0) + (s_housing || 0) + (s_wedding || 0)
                    + (s_edu || 0) + (s_medical || 0) + (s_travel || 0);

        const W_total = rVal === 0
            ? W_0 * n
            : W_0 * (Math.pow(1 + rVal, n) - 1) / rVal;

        const E_fixed = W_total * eVal;
        const NW_n = (A_0 || 0) + (W_total - E_fixed) - S_non;
        const M_save = S_non > 0 ? S_non / (n * 12) : 0;
        const M_available = W_total * (1 - eVal) / (n * 12);
        const feasible = M_available >= M_save;

        return { NW_n, M_save, M_available, W_total, E_fixed, S_non, feasible };
    }

    function renderFutureNetworth() {
        const container = document.getElementById('future-networth-content');
        if (!container) return;

        const config = getConfig();
        const _t = i18n[AppState.currentLang] || {};

        if (!config || !config.W_0 || !config.n) {
            container.innerHTML = `<div style="text-align:center; padding:20px 0; color:var(--text-sub); font-size:0.85rem; line-height:1.6;">
                ${_t.fnw_empty || '연소득과 기간을 설정하여 미래 순자산을 예측해보세요.'}
            </div>`;
            return;
        }

        const result = calcNetWorth(config);
        if (!result) {
            container.innerHTML = `<div style="text-align:center; padding:20px 0; color:var(--text-sub); font-size:0.85rem; line-height:1.6;">
                ${_t.fnw_empty || '연소득과 기간을 설정하여 미래 순자산을 예측해보세요.'}
            </div>`;
            return;
        }

        const fmt = (v) => Math.round(v).toLocaleString();
        const unit = _t.fnw_unit_man || '만원';
        const feasibleColor = result.feasible ? 'var(--neon-green, #00ff88)' : 'var(--neon-red, #ff4d6d)';
        const feasibleText = result.feasible
            ? (_t.fnw_feasible || '✅ 목표 달성 가능')
            : (_t.fnw_not_feasible || '⚠️ 저축 부족');
        const nwLabel = (_t.fnw_label_nw || '💰 예상 순자산 ({n}년 후)').replace('{n}', config.n);

        container.innerHTML = `
            <div class="life-status-item">
                <div><div class="ls-label">${nwLabel}</div></div>
                <div class="ls-value gold">${fmt(result.NW_n)}${unit}</div>
            </div>
            <div class="life-status-item">
                <div><div class="ls-label">${_t.fnw_label_m_save || '📅 월 필요 저축액'}</div></div>
                <div class="ls-value blue">${fmt(result.M_save)}${unit}</div>
            </div>
            <div class="life-status-item">
                <div><div class="ls-label">${_t.fnw_label_m_avail || '💸 월 가용 저축력'}</div></div>
                <div class="ls-value" style="color:${feasibleColor}; font-size:0.85rem; text-align:right;">
                    ${fmt(result.M_available)}${unit}<br>
                    <span style="font-size:0.75rem;">${feasibleText}</span>
                </div>
            </div>`;
    }

    function openFutureNetworthSettings() {
        if (document.getElementById('future-networth-modal-overlay')) return;

        const config = getConfig() || {};
        const _t = i18n[AppState.currentLang] || {};

        const inputStyle = 'width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--panel-bg); color:var(--text-main); font-size:0.85rem; box-sizing:border-box;';
        const labelStyle = 'display:block; font-size:0.75rem; color:var(--text-sub); margin-bottom:4px;';
        const fieldWrap = 'margin-bottom:10px;';

        const lumpFields = [
            ['s_car',     _t.fnw_label_car     || '자동차'],
            ['s_housing', _t.fnw_label_housing  || '주거비'],
            ['s_wedding', _t.fnw_label_wedding  || '결혼'],
            ['s_edu',     _t.fnw_label_edu      || '교육비'],
            ['s_medical', _t.fnw_label_medical  || '병원비'],
            ['s_travel',  _t.fnw_label_travel   || '여행+기타'],
        ];

        const lumpGrid = lumpFields.map(([key, label]) => `
            <div>
                <label style="${labelStyle}">${label}</label>
                <input id="fnw-input-${key}" type="number" min="0" step="100"
                    value="${config[key] || ''}" placeholder="0" style="${inputStyle}">
            </div>`).join('');

        const hasConfig = !!(config.W_0 && config.n);
        const resetBtn = hasConfig
            ? `<button onclick="resetFutureNetworth()" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--border-color); background:transparent; color:var(--text-sub); cursor:pointer; font-size:0.85rem;">${_t.fnw_btn_reset || '초기화'}</button>`
            : '';

        const overlay = document.createElement('div');
        overlay.className = 'report-modal-overlay';
        overlay.id = 'future-networth-modal-overlay';
        overlay.innerHTML = `
            <div class="report-modal-content" style="max-width:360px; width:90%; padding:22px; max-height:90vh; overflow-y:auto;">
                <div style="font-size:1rem; font-weight:bold; color:var(--neon-blue); margin-bottom:16px;">
                    ${_t.fnw_settings_title || '미래 순자산 설정'}
                </div>

                <div style="${fieldWrap}">
                    <label style="${labelStyle}">${_t.fnw_label_n || '목표 기간 (년)'}</label>
                    <input id="fnw-input-n" type="number" min="1" max="60" step="1"
                        value="${config.n || ''}" placeholder="10" style="${inputStyle}">
                </div>
                <div style="${fieldWrap}">
                    <label style="${labelStyle}">${_t.fnw_label_w0 || '현재 연소득 (만원)'}</label>
                    <input id="fnw-input-w0" type="number" min="0" step="100"
                        value="${config.W_0 || ''}" placeholder="0" style="${inputStyle}">
                </div>
                <div style="${fieldWrap}">
                    <label style="${labelStyle}">${_t.fnw_label_a0 || '현재 순자산 (만원)'}</label>
                    <input id="fnw-input-a0" type="number" min="0" step="100"
                        value="${config.A_0 || ''}" placeholder="0" style="${inputStyle}">
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
                    <div>
                        <label style="${labelStyle}">${_t.fnw_label_r || '연 물가상승률 (%)'}</label>
                        <input id="fnw-input-r" type="number" min="0" max="20" step="0.1"
                            value="${config.r !== undefined ? config.r : 2.5}" placeholder="2.5" style="${inputStyle}">
                    </div>
                    <div>
                        <label style="${labelStyle}">${_t.fnw_label_e || '고정 지출 비율 (%)'}</label>
                        <input id="fnw-input-e" type="number" min="0" max="100" step="1"
                            value="${config.e !== undefined ? config.e : 70}" placeholder="70" style="${inputStyle}">
                    </div>
                </div>

                <div style="font-size:0.8rem; color:var(--text-sub); margin-bottom:8px; padding-top:6px; border-top:1px solid var(--border-color);">
                    ${_t.fnw_section_lump || '목돈 지출 항목 (만원)'}
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px;">
                    ${lumpGrid}
                </div>

                <div style="display:flex; gap:8px;">
                    ${resetBtn}
                    <button onclick="closeFutureNetworthModal()" style="flex:1; padding:10px; border-radius:6px; border:1px solid var(--border-color); background:transparent; color:var(--text-sub); cursor:pointer; font-size:0.85rem;">${_t.fnw_btn_cancel || '취소'}</button>
                    <button onclick="saveFutureNetworthFromModal()" style="flex:1; padding:10px; border-radius:6px; border:none; background:var(--neon-blue); color:#000; font-weight:bold; cursor:pointer; font-size:0.85rem;">${_t.fnw_btn_save || '저장'}</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function saveFutureNetworthFromModal() {
        const _t = i18n[AppState.currentLang] || {};

        const W_0 = parseFloat(document.getElementById('fnw-input-w0')?.value) || 0;
        const n   = parseInt(document.getElementById('fnw-input-n')?.value)   || 0;

        if (!W_0 || W_0 <= 0) {
            alert(_t.fnw_income_required || '현재 연소득을 입력하세요.');
            return;
        }
        if (!n || n <= 0) {
            alert(_t.fnw_n_required || '목표 기간을 입력하세요.');
            return;
        }

        const rRaw = document.getElementById('fnw-input-r')?.value;
        const eRaw = document.getElementById('fnw-input-e')?.value;

        const config = {
            n,
            W_0,
            A_0:       parseFloat(document.getElementById('fnw-input-a0')?.value)      || 0,
            r:         rRaw !== '' && rRaw !== undefined ? parseFloat(rRaw) : 2.5,
            e:         eRaw !== '' && eRaw !== undefined ? parseFloat(eRaw) : 70,
            s_car:     parseFloat(document.getElementById('fnw-input-s_car')?.value)     || 0,
            s_housing: parseFloat(document.getElementById('fnw-input-s_housing')?.value) || 0,
            s_wedding: parseFloat(document.getElementById('fnw-input-s_wedding')?.value) || 0,
            s_edu:     parseFloat(document.getElementById('fnw-input-s_edu')?.value)     || 0,
            s_medical: parseFloat(document.getElementById('fnw-input-s_medical')?.value) || 0,
            s_travel:  parseFloat(document.getElementById('fnw-input-s_travel')?.value)  || 0,
        };

        saveConfig(config);
        renderFutureNetworth();
        closeFutureNetworthModal();
    }

    function resetFutureNetworth() {
        const _t = i18n[AppState.currentLang] || {};
        if (!confirm(_t.fnw_reset_confirm || '미래 순자산 설정을 초기화하시겠습니까?')) return;
        localStorage.removeItem(STORAGE_KEY);
        closeFutureNetworthModal();
        renderFutureNetworth();
    }

    function closeFutureNetworthModal() {
        const overlay = document.getElementById('future-networth-modal-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        }
    }

    function initFutureNetworth() {
        const btn = document.getElementById('btn-future-networth-settings');
        if (btn) btn.addEventListener('click', openFutureNetworthSettings);
        renderFutureNetworth();
    }

    // Public API (onclick 속성 및 외부 호출용)
    window.renderFutureNetworth        = renderFutureNetworth;
    window.openFutureNetworthSettings  = openFutureNetworthSettings;
    window.saveFutureNetworthFromModal = saveFutureNetworthFromModal;
    window.resetFutureNetworth         = resetFutureNetworth;
    window.closeFutureNetworthModal    = closeFutureNetworthModal;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFutureNetworth);
    } else {
        initFutureNetworth();
    }
})();
