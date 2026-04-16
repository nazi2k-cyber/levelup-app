// ===== 미래 순자산 (Future Net Worth) 모듈 =====
(function() {
    'use strict';

    const STORAGE_KEY      = 'future_networth_config';
    const WLTH_REWARD_KEY  = 'fnw_wlth_reward_date';   // 하루 1회 WLTH 보상 기록

    // AppState / i18n은 함수 내부에서 동적으로 참조 (로그아웃 상태에서도 안전)
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }

    // ── 천단위 콤마 바인딩 (type="text" 입력 필드) ──────────────────────
    function fmtComma(v) {
        const n = parseFloat(String(v ?? '').replace(/,/g, ''));
        return isNaN(n) ? '' : n.toLocaleString();
    }
    function parseComma(str) {
        return parseFloat(String(str ?? '').replace(/,/g, '')) || 0;
    }
    function bindComma(el) {
        if (!el) return;
        el.addEventListener('input', () => {
            const raw    = el.value.replace(/[^\d]/g, '');
            const cursor = el.selectionStart;
            const prevLen = el.value.length;
            el.value = raw ? Number(raw).toLocaleString() : '';
            // 커서 위치 보정 (콤마 삽입으로 길이가 변경될 때)
            const diff = el.value.length - prevLen;
            try { el.setSelectionRange(cursor + diff, cursor + diff); } catch (e) {}
        });
    }

    // ── 산식 ─────────────────────────────────────────────────────────────
    // W_total = W_0 × ((1+r)^n − 1) / r   (r=0이면 W_0 × n)
    // E_fixed = W_total × e
    // NW_n    = A_0 + (W_total − E_fixed) − S_non
    // M_save  = S_non / (n × 12)
    // M_avail = W_total × (1 − e) / (n × 12)
    function calcNetWorth(cfg) {
        const { n, W_0, assets, liabilities, r, e,
                s_car, s_housing, s_wedding, s_edu, s_medical, s_travel } = cfg;
        if (!n || !W_0 || n <= 0 || W_0 <= 0) return null;

        const A_0   = (assets || 0) - (liabilities || 0);
        const rVal  = (r !== undefined ? r : 2.5) / 100;
        const eVal  = (e !== undefined ? e : 70)  / 100;
        const S_non = (s_car || 0) + (s_housing || 0) + (s_wedding || 0)
                    + (s_edu  || 0) + (s_medical || 0) + (s_travel  || 0);

        const W_total  = rVal === 0
            ? W_0 * n
            : W_0 * (Math.pow(1 + rVal, n) - 1) / rVal;
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
        const cfg = getConfig();

        if (!cfg?.W_0 || !cfg?.n) {
            container.innerHTML = `<div style="text-align:center;padding:20px 0;color:var(--text-sub);font-size:0.85rem;line-height:1.6;">
                ${_t('fnw_empty')}</div>`;
            return;
        }

        const res = calcNetWorth(cfg);
        if (!res) {
            container.innerHTML = `<div style="text-align:center;padding:20px 0;color:var(--text-sub);font-size:0.85rem;line-height:1.6;">
                ${_t('fnw_empty')}</div>`;
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
    }

    // ── 가이드 모달 ───────────────────────────────────────────────────────
    function openFutureNetworthGuide() {
        if (document.getElementById('fnw-guide-overlay')) return;

        const lang = _app().currentLang || 'ko';

        const guideContent = {
            ko: `
                <p style="margin:0 0 10px;color:var(--text-sub);font-size:0.8rem;line-height:1.7;">
                    인플레이션과 생애주기 목돈 지출을 반영해 <b style="color:var(--neon-blue)">n년 후 예상 순자산</b>과
                    <b style="color:var(--neon-blue)">월 적립 목표액</b>을 계산합니다.
                </p>
                <div style="background:var(--bg-main,#0a0a0a);border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.78rem;line-height:1.9;color:var(--text-sub);">
                    <div>📈 <b>누적 수입</b> = 연소득 × <span style="color:var(--neon-blue)">((1+r)ⁿ − 1) / r</span></div>
                    <div>💸 <b>고정 지출</b> = 누적 수입 × 지출비율(e)</div>
                    <div>💰 <b>미래 순자산</b> = 현재 순자산 + (누적 수입 − 고정 지출) − 비정기 지출 합계</div>
                    <div style="margin-top:6px;">📅 <b>월 필요 저축액</b> = 비정기 지출 합계 ÷ (n × 12)</div>
                    <div>💸 <b>월 가용 저축력</b> = 누적 수입 × (1 − e) ÷ (n × 12)</div>
                </div>
                <div style="font-size:0.78rem;color:var(--text-sub);line-height:1.7;">
                    <div>🔹 <b>인플레이션율(r)</b>: 한국은행 목표 물가 상승률(2~3%) 또는 본인 평균 연봉 인상률 적용</div>
                    <div>🔹 <b>고정 지출 비율(e)</b>: 가계 평균 70% 기준, 본인 소비 패턴에 맞게 조정</div>
                    <div>🔹 <b>목돈 지출</b>: 미래 가격(물가 반영) 기준으로 입력하면 더 정확</div>
                    <div>🔹 월 가용 저축력 ≥ 월 필요 저축액이면 <span style="color:var(--neon-green,#00ff88)">✅ 목표 달성 가능</span></div>
                </div>`,
            en: `
                <p style="margin:0 0 10px;color:var(--text-sub);font-size:0.8rem;line-height:1.7;">
                    Estimates your <b style="color:var(--neon-blue)">net worth in n years</b> and
                    <b style="color:var(--neon-blue)">required monthly savings</b> by accounting for inflation and lifecycle expenses.
                </p>
                <div style="background:var(--bg-main,#0a0a0a);border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.78rem;line-height:1.9;color:var(--text-sub);">
                    <div>📈 <b>Cumulative Income</b> = Annual × <span style="color:var(--neon-blue)">((1+r)ⁿ − 1) / r</span></div>
                    <div>💸 <b>Fixed Expenses</b> = Cumul. Income × Expense Ratio (e)</div>
                    <div>💰 <b>Future Net Worth</b> = Current NW + (Income − Expenses) − Lump-Sum Total</div>
                    <div style="margin-top:6px;">📅 <b>Monthly Savings Needed</b> = Lump-Sum ÷ (n × 12)</div>
                    <div>💸 <b>Monthly Capacity</b> = Cumul. Income × (1 − e) ÷ (n × 12)</div>
                </div>
                <div style="font-size:0.78rem;color:var(--text-sub);line-height:1.7;">
                    <div>🔹 <b>Inflation (r)</b>: Use central bank target (2–3%) or your avg. salary growth rate</div>
                    <div>🔹 <b>Expense Ratio (e)</b>: Avg. household is ~70%; adjust to your spending habits</div>
                    <div>🔹 <b>Lump-Sum items</b>: Enter future prices (inflation-adjusted) for accuracy</div>
                    <div>🔹 Capacity ≥ Needed → <span style="color:var(--neon-green,#00ff88)">✅ Goal Achievable</span></div>
                </div>`,
            ja: `
                <p style="margin:0 0 10px;color:var(--text-sub);font-size:0.8rem;line-height:1.7;">
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
                    <div>🔹 <b>一括支出</b>: 物価上昇分を見込んだ将来価格で入力すると精度UP</div>
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
                <button onclick="closeFnwGuide()" style="margin-top:16px;width:100%;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);cursor:pointer;font-size:0.85rem;">
                    ${_t('fnw_btn_cancel')}
                </button>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function closeFnwGuide() {
        const el = document.getElementById('fnw-guide-overlay');
        if (el) { el.classList.remove('active'); setTimeout(() => el.remove(), 300); }
    }

    // ── 설정 모달 ──────────────────────────────────────────────────────────
    function openFutureNetworthSettings() {
        if (document.getElementById('future-networth-modal-overlay')) return;

        const cfg = getConfig() || {};
        const u   = _t('fnw_unit_man');

        const iStyle = 'width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--panel-bg);color:var(--text-main);font-size:0.85rem;box-sizing:border-box;';
        const lStyle = 'display:block;font-size:0.75rem;color:var(--text-sub);margin-bottom:4px;';
        const fWrap  = 'margin-bottom:10px;';

        // 현재 자산 / 부채 — A_0 이전 데이터 호환
        const assetsVal      = cfg.assets      !== undefined ? fmtComma(cfg.assets)      : (cfg.A_0 ? fmtComma(cfg.A_0) : '');
        const liabilitiesVal = cfg.liabilities !== undefined ? fmtComma(cfg.liabilities) : '';

        const lumpFields = [
            ['s_car',     _t('fnw_label_car')],
            ['s_housing', _t('fnw_label_housing')],
            ['s_wedding', _t('fnw_label_wedding')],
            ['s_edu',     _t('fnw_label_edu')],
            ['s_medical', _t('fnw_label_medical')],
            ['s_travel',  _t('fnw_label_travel')],
        ];
        const lumpGrid = lumpFields.map(([key, label]) => `
            <div>
                <label style="${lStyle}">${label}</label>
                <input id="fnw-input-${key}" type="text" inputmode="numeric"
                    value="${fmtComma(cfg[key])}" placeholder="0" style="${iStyle}">
            </div>`).join('');

        const hasConfig = !!(cfg.W_0 && cfg.n);
        const resetBtn  = hasConfig
            ? `<button onclick="resetFutureNetworth()" style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);cursor:pointer;font-size:0.85rem;">${_t('fnw_btn_reset')}</button>`
            : '';

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
                    <input id="fnw-input-n" type="text" inputmode="numeric"
                        value="${fmtComma(cfg.n)}" placeholder="10" style="${iStyle}">
                </div>
                <div style="${fWrap}">
                    <label style="${lStyle}">${_t('fnw_label_w0')}</label>
                    <input id="fnw-input-w0" type="text" inputmode="numeric"
                        value="${fmtComma(cfg.W_0)}" placeholder="0" style="${iStyle}">
                </div>

                <div style="font-size:0.8rem;color:var(--text-sub);margin-bottom:6px;padding-top:4px;">
                    ${_t('fnw_label_net_section')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px;">
                    <div>
                        <label style="${lStyle}">${_t('fnw_label_assets')}</label>
                        <input id="fnw-input-assets" type="text" inputmode="numeric"
                            value="${assetsVal}" placeholder="0" style="${iStyle}">
                    </div>
                    <div>
                        <label style="${lStyle}">${_t('fnw_label_liabilities')}</label>
                        <input id="fnw-input-liabilities" type="text" inputmode="numeric"
                            value="${liabilitiesVal}" placeholder="0" style="${iStyle}">
                    </div>
                </div>
                <div id="fnw-net-auto" style="font-size:0.75rem;color:var(--text-sub);text-align:right;margin-bottom:10px;min-height:16px;"></div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                    <div>
                        <label style="${lStyle}">${_t('fnw_label_r')}</label>
                        <input id="fnw-input-r" type="number" min="0" max="20" step="0.1"
                            value="${cfg.r !== undefined ? cfg.r : 2.5}" placeholder="2.5" style="${iStyle}">
                    </div>
                    <div>
                        <label style="${lStyle}">${_t('fnw_label_e')}</label>
                        <input id="fnw-input-e" type="number" min="0" max="100" step="1"
                            value="${cfg.e !== undefined ? cfg.e : 70}" placeholder="70" style="${iStyle}">
                    </div>
                </div>

                <div style="font-size:0.8rem;color:var(--text-sub);margin-bottom:8px;padding-top:6px;border-top:1px solid var(--border-color);">
                    ${_t('fnw_section_lump')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
                    ${lumpGrid}
                </div>

                <div style="display:flex;gap:8px;">
                    ${resetBtn}
                    <button onclick="closeFutureNetworthModal()" style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);cursor:pointer;font-size:0.85rem;">${_t('fnw_btn_cancel')}</button>
                    <button onclick="saveFutureNetworthFromModal()" style="flex:1;padding:10px;border-radius:6px;border:none;background:var(--neon-blue);color:#000;font-weight:bold;cursor:pointer;font-size:0.85rem;">${_t('fnw_btn_save')}</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        // 천단위 콤마 바인딩
        ['fnw-input-n','fnw-input-w0','fnw-input-assets','fnw-input-liabilities',
         'fnw-input-s_car','fnw-input-s_housing','fnw-input-s_wedding',
         'fnw-input-s_edu','fnw-input-s_medical','fnw-input-s_travel'
        ].forEach(id => bindComma(document.getElementById(id)));

        // 순자산 자동 계산 표시
        function updateNetAutoLabel() {
            const a = parseComma(document.getElementById('fnw-input-assets')?.value);
            const l = parseComma(document.getElementById('fnw-input-liabilities')?.value);
            const net = a - l;
            const el = document.getElementById('fnw-net-auto');
            if (el && (a || l)) {
                const u = _t('fnw_unit_man');
                el.textContent = `${_t('fnw_label_net_auto')}: ${net.toLocaleString()}${u}`;
                el.style.color = net >= 0 ? 'var(--neon-green,#00ff88)' : 'var(--neon-red,#ff4d6d)';
            } else if (el) {
                el.textContent = '';
            }
        }
        document.getElementById('fnw-input-assets')?.addEventListener('input', updateNetAutoLabel);
        document.getElementById('fnw-input-liabilities')?.addEventListener('input', updateNetAutoLabel);
        updateNetAutoLabel();
    }

    // ── 저장 ───────────────────────────────────────────────────────────────
    function saveFutureNetworthFromModal() {
        const W_0 = parseComma(document.getElementById('fnw-input-w0')?.value);
        const n   = parseComma(document.getElementById('fnw-input-n')?.value);

        if (!W_0 || W_0 <= 0) { alert(_t('fnw_income_required')); return; }
        if (!n   || n   <= 0) { alert(_t('fnw_n_required'));       return; }

        const rRaw = document.getElementById('fnw-input-r')?.value;
        const eRaw = document.getElementById('fnw-input-e')?.value;

        const cfg = {
            n,
            W_0,
            assets:      parseComma(document.getElementById('fnw-input-assets')?.value),
            liabilities: parseComma(document.getElementById('fnw-input-liabilities')?.value),
            r:  rRaw !== '' ? parseFloat(rRaw) : 2.5,
            e:  eRaw !== '' ? parseFloat(eRaw) : 70,
            s_car:     parseComma(document.getElementById('fnw-input-s_car')?.value),
            s_housing: parseComma(document.getElementById('fnw-input-s_housing')?.value),
            s_wedding: parseComma(document.getElementById('fnw-input-s_wedding')?.value),
            s_edu:     parseComma(document.getElementById('fnw-input-s_edu')?.value),
            s_medical: parseComma(document.getElementById('fnw-input-s_medical')?.value),
            s_travel:  parseComma(document.getElementById('fnw-input-s_travel')?.value),
        };

        saveConfig(cfg);

        // WLTH 인센티브 (하루 1회, 로그인 상태에서만)
        const rewarded = _grantWlthReward();

        renderFutureNetworth();
        closeFutureNetworthModal();

        // 보상 알림 토스트
        if (rewarded) _showToast(_t('fnw_wlth_reward'));
    }

    // ── WLTH 보상 (하루 1회) ──────────────────────────────────────────────
    function _grantWlthReward() {
        const appState = window.AppState;
        if (!appState?.user?.pendingStats) return false;      // 로그인 필요

        const today    = window.getTodayKST?.() || new Date().toISOString().slice(0, 10);
        const lastDate = localStorage.getItem(WLTH_REWARD_KEY);
        if (lastDate === today) return false;                  // 오늘 이미 받음

        appState.user.pendingStats.wlth = (Number(appState.user.pendingStats.wlth) || 0) + 0.5;
        appState.user.points = (Number(appState.user.points) || 0) + 10;
        localStorage.setItem(WLTH_REWARD_KEY, today);

        window.updatePointUI?.();
        window.saveUserData?.();
        return true;
    }

    // ── 토스트 알림 ────────────────────────────────────────────────────────
    function _showToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '80px', left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--neon-blue)', color: '#000',
            padding: '8px 18px', borderRadius: '20px',
            fontSize: '0.85rem', fontWeight: 'bold',
            zIndex: '9999', opacity: '0',
            transition: 'opacity 0.3s',
            whiteSpace: 'nowrap',
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; });
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // ── 초기화 / 닫기 ──────────────────────────────────────────────────────
    function resetFutureNetworth() {
        if (!confirm(_t('fnw_reset_confirm'))) return;
        localStorage.removeItem(STORAGE_KEY);
        closeFutureNetworthModal();
        renderFutureNetworth();
    }

    function closeFutureNetworthModal() {
        const el = document.getElementById('future-networth-modal-overlay');
        if (el) { el.classList.remove('active'); setTimeout(() => el.remove(), 300); }
    }

    // ── 초기화 ────────────────────────────────────────────────────────────
    function initFutureNetworth() {
        document.getElementById('btn-future-networth-guide')
            ?.addEventListener('click', openFutureNetworthGuide);
        document.getElementById('btn-future-networth-settings')
            ?.addEventListener('click', openFutureNetworthSettings);
        renderFutureNetworth();
    }

    // Public API
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
