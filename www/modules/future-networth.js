// ===== 미래 순자산 (Future Net Worth) 모듈 =====
(function() {
    'use strict';

    const STORAGE_KEY     = 'future_networth_config';
    const WLTH_REWARD_KEY = 'fnw_wlth_reward_date';
    const CONSENT_KEY     = 'fnw_consent';

    // AppState / i18n 은 함수 내부에서 동적 참조 (로그아웃 상태에서도 안전)
    function _app() { return window.AppState || {}; }
    function _t(key) {
        const lang = _app().currentLang || 'ko';
        return window.i18n?.[lang]?.[key] ?? key;
    }

    // ── Storage ──────────────────────────────────────────────────────────
    function getConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function saveConfig(config) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (e) {}
    }

    // ── 천단위 콤마 ───────────────────────────────────────────────────────
    function fmtComma(v) {
        const n = parseFloat(String(v ?? '').replace(/,/g, ''));
        return isNaN(n) ? '' : n.toLocaleString();
    }
    function parseComma(str) {
        return parseFloat(String(str ?? '').replace(/,/g, '')) || 0;
    }
    function bindComma(el) {
        if (!el) return;
        el.addEventListener('input', function() {
            const raw     = this.value.replace(/[^\d]/g, '');
            const prevLen = this.value.length;
            const cursor  = this.selectionStart;
            this.value    = raw ? Number(raw).toLocaleString() : '';
            const diff    = this.value.length - prevLen;
            try { this.setSelectionRange(cursor + diff, cursor + diff); } catch (e) {}
        });
    }

    // ── 산식 ──────────────────────────────────────────────────────────────
    function calcNetWorth(cfg) {
        const { n, W_0, assets, liabilities, r, e,
                s_car, s_housing, s_wedding, s_edu, s_medical, s_travel } = cfg;
        if (!n || !W_0 || n <= 0 || W_0 <= 0) return null;

        const A_0   = (assets || 0) - (liabilities || 0);
        const rVal  = ((r !== undefined ? r : 2.5)) / 100;
        const eVal  = ((e !== undefined ? e : 70))  / 100;
        const S_non = (s_car||0) + (s_housing||0) + (s_wedding||0)
                    + (s_edu||0) + (s_medical||0) + (s_travel||0);

        const W_total  = rVal === 0 ? W_0 * n : W_0 * (Math.pow(1 + rVal, n) - 1) / rVal;
        const E_fixed  = W_total * eVal;
        const NW_n     = A_0 + (W_total - E_fixed) - S_non;
        const M_save   = S_non > 0 ? S_non / (n * 12) : 0;
        const M_avail  = W_total * (1 - eVal) / (n * 12);

        return { NW_n, M_save, M_avail, W_total, E_fixed, S_non, A_0,
                 feasible: M_avail >= M_save };
    }

    // ── 카드 렌더 ─────────────────────────────────────────────────────────
    function renderFutureNetworth() {
        const container = document.getElementById('future-networth-content');
        if (!container) return;
        try {
            const cfg = getConfig();
            if (!cfg?.W_0 || !cfg?.n) {
                container.innerHTML = `<div style="text-align:center;padding:20px 0;color:var(--text-sub);font-size:0.85rem;line-height:1.6;">${_t('fnw_empty')}</div>`;
                return;
            }
            const res = calcNetWorth(cfg);
            if (!res) {
                container.innerHTML = `<div style="text-align:center;padding:20px 0;color:var(--text-sub);font-size:0.85rem;line-height:1.6;">${_t('fnw_empty')}</div>`;
                return;
            }
            const f   = v => Math.round(v).toLocaleString();
            const u   = _t('fnw_unit_man');
            const fc  = res.feasible ? 'var(--neon-green,#00ff88)' : 'var(--neon-red,#ff4d6d)';
            const ft  = res.feasible ? _t('fnw_feasible') : _t('fnw_not_feasible');
            const nwL = _t('fnw_label_nw').replace('{n}', cfg.n);
            container.innerHTML = `
                <div class="life-status-item">
                    <div><div class="ls-label">${nwL}</div></div>
                    <div class="ls-value gold">${f(res.NW_n)}${u}</div>
                </div>
                <div class="life-status-item">
                    <div><div class="ls-label">${_t('fnw_label_m_save')}</div></div>
                    <div class="ls-value blue">${f(res.M_save)}${u}</div>
                </div>
                <div class="life-status-item">
                    <div><div class="ls-label">${_t('fnw_label_m_avail')}</div></div>
                    <div class="ls-value" style="color:${fc};font-size:0.85rem;text-align:right;">
                        ${f(res.M_avail)}${u}<br>
                        <span style="font-size:0.75rem;">${ft}</span>
                    </div>
                </div>`;
        } catch (e) {
            container.innerHTML = `<div style="text-align:center;padding:20px 0;color:var(--text-sub);font-size:0.85rem;">${_t('fnw_empty')}</div>`;
        }
    }

    // ── 가이드 모달 ───────────────────────────────────────────────────────
    function openFutureNetworthGuide() {
        if (document.getElementById('fnw-guide-overlay')) return;
        const lang = _app().currentLang || 'ko';
        const guideContent = {
            ko: `<p style="margin:0 0 10px;color:var(--text-sub);font-size:0.8rem;line-height:1.7;">
                    인플레이션과 생애주기 목돈 지출을 반영해 <b style="color:var(--neon-blue)">n년 후 예상 순자산</b>과
                    <b style="color:var(--neon-blue)">월 적립 목표액</b>을 계산합니다.
                 </p>
                 <div style="background:var(--bg-main,#0a0a0a);border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.78rem;line-height:1.9;color:var(--text-sub);">
                     <div>📈 <b>누적 수입</b> = 연소득 × <span style="color:var(--neon-blue)">((1+r)ⁿ − 1) / r</span></div>
                     <div>💸 <b>고정 지출</b> = 누적 수입 × 지출비율(e)</div>
                     <div>💰 <b>미래 순자산</b> = 현재 순자산 + (누적 수입 − 고정 지출) − 비정기 지출</div>
                     <div style="margin-top:6px;">📅 <b>월 필요 저축액</b> = 비정기 지출 ÷ (n × 12)</div>
                     <div>💸 <b>월 가용 저축력</b> = 누적 수입 × (1 − e) ÷ (n × 12)</div>
                 </div>
                 <div style="font-size:0.78rem;color:var(--text-sub);line-height:1.7;">
                     <div>🔹 <b>인플레이션율(r)</b>: 한국은행 목표 물가 상승률(2~3%) 또는 평균 연봉 인상률</div>
                     <div>🔹 <b>고정 지출 비율(e)</b>: 가계 평균 70%, 본인 소비 패턴에 맞게 조정</div>
                     <div>🔹 <b>목돈 지출</b>: 미래 물가 반영 가격으로 입력하면 더 정확</div>
                     <div>🔹 월 가용 저축력 ≥ 월 필요 저축액 → <span style="color:var(--neon-green,#00ff88)">✅ 목표 달성 가능</span></div>
                 </div>`,
            en: `<p style="margin:0 0 10px;color:var(--text-sub);font-size:0.8rem;line-height:1.7;">
                    Estimates <b style="color:var(--neon-blue)">net worth in n years</b> and
                    <b style="color:var(--neon-blue)">required monthly savings</b> using inflation + lifecycle expenses.
                 </p>
                 <div style="background:var(--bg-main,#0a0a0a);border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.78rem;line-height:1.9;color:var(--text-sub);">
                     <div>📈 <b>Cumul. Income</b> = Annual × <span style="color:var(--neon-blue)">((1+r)ⁿ − 1) / r</span></div>
                     <div>💸 <b>Fixed Expenses</b> = Cumul. Income × Expense Ratio (e)</div>
                     <div>💰 <b>Future Net Worth</b> = Current NW + (Income − Expenses) − Lump-Sum</div>
                     <div style="margin-top:6px;">📅 <b>Monthly Savings Needed</b> = Lump-Sum ÷ (n × 12)</div>
                     <div>💸 <b>Monthly Capacity</b> = Cumul. Income × (1 − e) ÷ (n × 12)</div>
                 </div>
                 <div style="font-size:0.78rem;color:var(--text-sub);line-height:1.7;">
                     <div>🔹 <b>Inflation (r)</b>: Central bank target (2–3%) or avg. salary growth</div>
                     <div>🔹 <b>Expense Ratio (e)</b>: Avg. ~70%; adjust to your spending habits</div>
                     <div>🔹 <b>Lump-Sum items</b>: Use future prices for accuracy</div>
                     <div>🔹 Capacity ≥ Needed → <span style="color:var(--neon-green,#00ff88)">✅ Goal Achievable</span></div>
                 </div>`,
            ja: `<p style="margin:0 0 10px;color:var(--text-sub);font-size:0.8rem;line-height:1.7;">
                    インフレと生涯イベント支出を考慮し、<b style="color:var(--neon-blue)">n年後の純資産</b>と
                    <b style="color:var(--neon-blue)">月積立目標額</b>を計算します。
                 </p>
                 <div style="background:var(--bg-main,#0a0a0a);border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.78rem;line-height:1.9;color:var(--text-sub);">
                     <div>📈 <b>累積収入</b> = 年収 × <span style="color:var(--neon-blue)">((1+r)ⁿ − 1) / r</span></div>
                     <div>💸 <b>固定支出</b> = 累積収入 × 支出比率(e)</div>
                     <div>💰 <b>将来純資産</b> = 現在純資産 + (収入 − 支出) − 一括支出合計</div>
                     <div style="margin-top:6px;">📅 <b>月必要積立額</b> = 一括支出 ÷ (n × 12)</div>
                     <div>💸 <b>月積立能力</b> = 累積収入 × (1 − e) ÷ (n × 12)</div>
                 </div>
                 <div style="font-size:0.78rem;color:var(--text-sub);line-height:1.7;">
                     <div>🔹 <b>インフレ率(r)</b>: 中央銀行目標値(2〜3%)または平均昇給率を適用</div>
                     <div>🔹 <b>支出比率(e)</b>: 家計平均70%基準、生活スタイルに合わせて調整</div>
                     <div>🔹 <b>一括支出</b>: 将来物価で入力すると精度UP</div>
                     <div>🔹 月積立能力 ≥ 月必要積立額 → <span style="color:var(--neon-green,#00ff88)">✅ 目標達成可能</span></div>
                 </div>`
        };

        const overlay = document.createElement('div');
        overlay.className = 'report-modal-overlay';
        overlay.id = 'fnw-guide-overlay';
        overlay.innerHTML = `
            <div class="report-modal-content" style="max-width:340px;width:90%;padding:22px;">
                <div style="font-size:1rem;font-weight:bold;color:var(--neon-blue);margin-bottom:14px;">
                    ${_t('fnw_guide_title')}
                </div>
                ${guideContent[lang] || guideContent.ko}
                <div style="margin-top:14px;padding:10px 12px;background:rgba(255,200,0,0.07);border:1px solid rgba(255,200,0,0.25);border-radius:8px;font-size:0.73rem;color:var(--text-sub);line-height:1.6;">
                    ${_t('fnw_guide_currency_warning')}
                </div>
                <button id="fnw-guide-close-btn" style="margin-top:12px;width:100%;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);cursor:pointer;font-size:0.85rem;">
                    ${_t('fnw_btn_cancel')}
                </button>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
        document.getElementById('fnw-guide-close-btn')
            ?.addEventListener('click', closeFnwGuide);
    }

    function closeFnwGuide() {
        const el = document.getElementById('fnw-guide-overlay');
        if (el) { el.classList.remove('active'); setTimeout(() => el.remove(), 300); }
    }

    // ── 설정 모달 ─────────────────────────────────────────────────────────
    function openFutureNetworthSettings() {
        if (document.getElementById('future-networth-modal-overlay')) return;

        const cfg    = getConfig() || {};
        const iStyle = 'width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--panel-bg);color:var(--text-main);font-size:0.85rem;box-sizing:border-box;';
        const lStyle = 'display:block;font-size:0.75rem;color:var(--text-sub);margin-bottom:4px;';
        const fWrap  = 'margin-bottom:10px;';

        // 구버전(A_0) 데이터 호환
        const assetsVal      = fmtComma(cfg.assets      !== undefined ? cfg.assets      : (cfg.A_0 || ''));
        const liabilitiesVal = fmtComma(cfg.liabilities !== undefined ? cfg.liabilities : '');

        const lumpFields = [
            ['s_car',     _t('fnw_label_car')],
            ['s_housing', _t('fnw_label_housing')],
            ['s_wedding', _t('fnw_label_wedding')],
            ['s_edu',     _t('fnw_label_edu')],
            ['s_medical', _t('fnw_label_medical')],
            ['s_travel',  _t('fnw_label_travel')],
        ];
        const lumpGrid = lumpFields.map(([key, label]) =>
            `<div>
                <label style="${lStyle}">${label}</label>
                <input id="fnw-i-${key}" type="text" inputmode="numeric"
                    value="${fmtComma(cfg[key])}" placeholder="0" style="${iStyle}">
             </div>`).join('');

        const hasConfig = !!(cfg.W_0 && cfg.n);

        const overlay = document.createElement('div');
        overlay.className = 'report-modal-overlay';
        overlay.id = 'future-networth-modal-overlay';
        overlay.innerHTML = `
            <div class="report-modal-content" style="max-width:360px;width:90%;padding:22px;max-height:90vh;overflow-y:auto;">
                <div style="font-size:1rem;font-weight:bold;color:var(--neon-blue);margin-bottom:16px;">
                    ${_t('fnw_settings_title')}
                </div>

                <div style="${fWrap}">
                    <label style="${lStyle}">${_t('fnw_label_n')}</label>
                    <input id="fnw-i-n" type="text" inputmode="numeric"
                        value="${fmtComma(cfg.n)}" placeholder="10" style="${iStyle}">
                </div>
                <div style="${fWrap}">
                    <label style="${lStyle}">${_t('fnw_label_w0')}</label>
                    <input id="fnw-i-w0" type="text" inputmode="numeric"
                        value="${fmtComma(cfg.W_0)}" placeholder="0" style="${iStyle}">
                </div>

                <div style="font-size:0.8rem;color:var(--text-sub);margin-bottom:6px;padding-top:4px;">
                    ${_t('fnw_label_net_section')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px;">
                    <div>
                        <label style="${lStyle}">${_t('fnw_label_assets')}</label>
                        <input id="fnw-i-assets" type="text" inputmode="numeric"
                            value="${assetsVal}" placeholder="0" style="${iStyle}">
                    </div>
                    <div>
                        <label style="${lStyle}">${_t('fnw_label_liabilities')}</label>
                        <input id="fnw-i-liabilities" type="text" inputmode="numeric"
                            value="${liabilitiesVal}" placeholder="0" style="${iStyle}">
                    </div>
                </div>
                <div id="fnw-net-auto" style="font-size:0.75rem;text-align:right;margin-bottom:10px;min-height:16px;color:var(--text-sub);"></div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                    <div>
                        <label style="${lStyle}">${_t('fnw_label_r')}</label>
                        <input id="fnw-i-r" type="number" min="0" max="20" step="0.1"
                            value="${cfg.r !== undefined ? cfg.r : 2.5}" placeholder="2.5" style="${iStyle}">
                    </div>
                    <div>
                        <label style="${lStyle}">${_t('fnw_label_e')}</label>
                        <input id="fnw-i-e" type="number" min="0" max="100" step="1"
                            value="${cfg.e !== undefined ? cfg.e : 70}" placeholder="70" style="${iStyle}">
                    </div>
                </div>

                <div style="font-size:0.8rem;color:var(--text-sub);margin-bottom:8px;padding-top:6px;border-top:1px solid var(--border-color);">
                    ${_t('fnw_section_lump')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
                    ${lumpGrid}
                </div>

                <div style="margin-bottom:14px;padding:12px;background:rgba(0,217,255,0.05);border:1px solid rgba(0,217,255,0.2);border-radius:8px;">
                    <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;">
                        <input type="checkbox" id="fnw-consent-checkbox" ${localStorage.getItem(CONSENT_KEY) ? 'checked' : ''} style="margin-top:3px;flex-shrink:0;">
                        <span style="font-size:0.72rem;color:var(--text-sub);line-height:1.55;">${_t('fnw_consent_label')}</span>
                    </label>
                    <div style="margin-top:8px;font-size:0.71rem;color:var(--neon-blue);opacity:0.85;line-height:1.5;padding-left:20px;">${_t('fnw_consent_social_notice')}</div>
                </div>

                <div style="display:flex;gap:8px;">
                    ${hasConfig ? `<button id="fnw-btn-reset" style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);cursor:pointer;font-size:0.85rem;">${_t('fnw_btn_reset')}</button>` : ''}
                    <button id="fnw-btn-cancel" style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);cursor:pointer;font-size:0.85rem;">${_t('fnw_btn_cancel')}</button>
                    <button id="fnw-btn-save" style="flex:1;padding:10px;border-radius:6px;border:none;background:var(--neon-blue);color:#000;font-weight:bold;cursor:pointer;font-size:0.85rem;">${_t('fnw_btn_save')}</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        // 버튼 이벤트 바인딩 (onclick 속성 대신 addEventListener 사용)
        document.getElementById('fnw-btn-save')?.addEventListener('click', saveFutureNetworthFromModal);
        document.getElementById('fnw-btn-cancel')?.addEventListener('click', closeFutureNetworthModal);
        if (hasConfig) {
            document.getElementById('fnw-btn-reset')?.addEventListener('click', resetFutureNetworth);
        }

        // 천단위 콤마 바인딩
        ['fnw-i-n','fnw-i-w0','fnw-i-assets','fnw-i-liabilities',
         'fnw-i-s_car','fnw-i-s_housing','fnw-i-s_wedding',
         'fnw-i-s_edu','fnw-i-s_medical','fnw-i-s_travel'
        ].forEach(id => bindComma(document.getElementById(id)));

        // 순자산 자동 계산 표시
        function _updateNetLabel() {
            const a   = parseComma(document.getElementById('fnw-i-assets')?.value);
            const l   = parseComma(document.getElementById('fnw-i-liabilities')?.value);
            const net = a - l;
            const el  = document.getElementById('fnw-net-auto');
            if (!el) return;
            if (a || l) {
                el.textContent = `${_t('fnw_label_net_auto')}: ${net.toLocaleString()}${_t('fnw_unit_man')}`;
                el.style.color = net >= 0 ? 'var(--neon-green,#00ff88)' : 'var(--neon-red,#ff4d6d)';
            } else {
                el.textContent = '';
            }
        }
        document.getElementById('fnw-i-assets')?.addEventListener('input', _updateNetLabel);
        document.getElementById('fnw-i-liabilities')?.addEventListener('input', _updateNetLabel);
        _updateNetLabel();
    }

    // ── 저장 ──────────────────────────────────────────────────────────────
    function saveFutureNetworthFromModal() {
        // 1. 입력값 읽기
        const W_0 = parseComma(document.getElementById('fnw-i-w0')?.value);
        const n   = parseComma(document.getElementById('fnw-i-n')?.value);

        if (!W_0 || W_0 <= 0) { alert(_t('fnw_income_required')); return; }
        if (!n   || n   <= 0) { alert(_t('fnw_n_required'));       return; }

        const rRaw = document.getElementById('fnw-i-r')?.value;
        const eRaw = document.getElementById('fnw-i-e')?.value;

        const cfg = {
            n, W_0,
            assets:      parseComma(document.getElementById('fnw-i-assets')?.value),
            liabilities: parseComma(document.getElementById('fnw-i-liabilities')?.value),
            r: rRaw !== '' && rRaw !== null ? parseFloat(rRaw) : 2.5,
            e: eRaw !== '' && eRaw !== null ? parseFloat(eRaw) : 70,
            s_car:     parseComma(document.getElementById('fnw-i-s_car')?.value),
            s_housing: parseComma(document.getElementById('fnw-i-s_housing')?.value),
            s_wedding: parseComma(document.getElementById('fnw-i-s_wedding')?.value),
            s_edu:     parseComma(document.getElementById('fnw-i-s_edu')?.value),
            s_medical: parseComma(document.getElementById('fnw-i-s_medical')?.value),
            s_travel:  parseComma(document.getElementById('fnw-i-s_travel')?.value),
        };

        // 2. 동의 상태 저장
        const consentChecked = document.getElementById('fnw-consent-checkbox')?.checked;
        if (consentChecked) {
            localStorage.setItem(CONSENT_KEY, '1');
        } else {
            localStorage.removeItem(CONSENT_KEY);
        }

        // 3. M_avail 계산 및 lang 포함하여 저장
        const res = calcNetWorth(cfg);
        if (res) cfg._M_avail = res.M_avail;
        cfg._lang = _app().currentLang || 'ko';
        saveConfig(cfg);

        // 4. UI 갱신 + 모달 닫기 (반드시 실행)
        try { renderFutureNetworth(); } catch (e) {}
        closeFutureNetworthModal();

        // 5. Firestore 저장 (동의 + 로그인 시)
        if (consentChecked) {
            try { window.saveUserData?.(); } catch (e) {}
        }

        // 6. 저축왕 칭호 체크
        try { window.checkSavingsRareTitles?.(); } catch (e) {}

        // 7. WLTH 보상 (로그인 필요, 독립 try-catch)
        let rewarded = false;
        try { rewarded = _grantWlthReward(); } catch (e) {}

        // 8. 보상 팝업 (별도 실행)
        if (rewarded) {
            setTimeout(() => _showRewardPopup(), 350);
        }
    }

    // ── WLTH 보상 (하루 1회) ─────────────────────────────────────────────
    function _grantWlthReward() {
        const appState = window.AppState;
        if (!appState?.user?.pendingStats) return false;   // 로그인 필요

        const today    = window.getTodayKST?.() || new Date().toISOString().slice(0, 10);
        const lastDate = localStorage.getItem(WLTH_REWARD_KEY);
        if (lastDate === today) return false;              // 오늘 이미 받음

        appState.user.pendingStats.wlth = (Number(appState.user.pendingStats.wlth) || 0) + 0.5;
        appState.user.points            = (Number(appState.user.points)            || 0) + 10;
        localStorage.setItem(WLTH_REWARD_KEY, today);

        try { window.updatePointUI?.(); } catch (e) {}
        try { window.saveUserData?.();  } catch (e) {}
        return true;
    }

    // ── WLTH 보상 팝업 모달 ───────────────────────────────────────────────
    function _showRewardPopup() {
        const existing = document.getElementById('fnw-reward-overlay');
        if (existing) existing.remove();

        const wlth = Math.round((Number(window.AppState?.user?.stats?.wlth) || 0) * 10) / 10;
        const pts  = Number(window.AppState?.user?.points) || 0;

        const overlay = document.createElement('div');
        overlay.id = 'fnw-reward-overlay';
        overlay.className = 'report-modal-overlay';
        overlay.innerHTML = `
            <div class="report-modal-content" style="max-width:280px;width:85%;padding:28px;text-align:center;">
                <div style="font-size:2rem;margin-bottom:8px;">💰</div>
                <div style="font-size:1.1rem;font-weight:bold;color:var(--neon-blue);margin-bottom:6px;">
                    ${_t('fnw_wlth_reward_title')}
                </div>
                <div style="font-size:0.85rem;color:var(--text-sub);margin-bottom:16px;line-height:1.6;">
                    ${_t('fnw_wlth_reward_desc')}
                </div>
                <div style="display:flex;justify-content:center;gap:16px;margin-bottom:18px;">
                    <div style="text-align:center;">
                        <div style="font-size:1.2rem;font-weight:bold;color:var(--neon-blue);">WLTH</div>
                        <div style="font-size:0.75rem;color:var(--text-sub);">+0.5</div>
                    </div>
                    <div style="text-align:center;">
                        <div style="font-size:1.2rem;font-weight:bold;color:var(--neon-gold,#ffd700);">P</div>
                        <div style="font-size:0.75rem;color:var(--text-sub);">+10</div>
                    </div>
                </div>
                <button id="fnw-reward-close" style="width:100%;padding:10px;border-radius:6px;border:none;background:var(--neon-blue);color:#000;font-weight:bold;cursor:pointer;font-size:0.9rem;">
                    ${_t('fnw_wlth_reward_ok')}
                </button>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
        document.getElementById('fnw-reward-close')
            ?.addEventListener('click', () => {
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 300);
            });
    }

    // ── 초기화 / 닫기 ────────────────────────────────────────────────────
    function resetFutureNetworth() {
        if (!confirm(_t('fnw_reset_confirm'))) return;
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(CONSENT_KEY);
        closeFutureNetworthModal();
        renderFutureNetworth();
        // Firestore에서도 제거 (동의 해제 상태로 빈 문자열 저장)
        try { window.saveUserData?.(); } catch (e) {}
    }

    function closeFutureNetworthModal() {
        const el = document.getElementById('future-networth-modal-overlay');
        if (el) { el.classList.remove('active'); setTimeout(() => el.remove(), 300); }
    }

    // ── 초기화 ───────────────────────────────────────────────────────────
    function initFutureNetworth() {
        document.getElementById('btn-future-networth-guide')
            ?.addEventListener('click', openFutureNetworthGuide);
        document.getElementById('btn-future-networth-reset')
            ?.addEventListener('click', resetFutureNetworth);
        document.getElementById('btn-future-networth-settings')
            ?.addEventListener('click', openFutureNetworthSettings);
        renderFutureNetworth();
    }

    // Public API (외부 접근용)
    window.renderFutureNetworth        = renderFutureNetworth;
    window.openFutureNetworthSettings  = openFutureNetworthSettings;
    window.openFutureNetworthGuide     = openFutureNetworthGuide;
    window.saveFutureNetworthFromModal = saveFutureNetworthFromModal;
    window.resetFutureNetworth         = resetFutureNetworth;
    window.closeFutureNetworthModal    = closeFutureNetworthModal;
    window.closeFnwGuide               = closeFnwGuide;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFutureNetworth);
    } else {
        initFutureNetworth();
    }
})();
