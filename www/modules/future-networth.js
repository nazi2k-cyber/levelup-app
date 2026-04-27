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
        const { n, W_0, assets, liabilities, r, g, e, roi, inflateS,
                s_car, s_housing, s_wedding, s_edu, s_medical, s_travel } = cfg;
        if (!n || !W_0 || n <= 0 || W_0 <= 0) return null;

        const A_0   = (assets || 0) - (liabilities || 0);
        const rVal  = ((r !== undefined ? r : 2.5)) / 100;
        const gVal  = ((g !== undefined ? g : 3.0)) / 100;
        const eVal  = ((e !== undefined ? e : 70))  / 100;
        const iVal  = ((roi !== undefined ? roi : 3.5)) / 100;

        const S_non_raw = (s_car||0) + (s_housing||0) + (s_wedding||0)
                        + (s_edu||0) + (s_medical||0) + (s_travel||0);
        const inflFactor = (inflateS && rVal > 0) ? Math.pow(1 + rVal, n) : 1;
        const S_non = S_non_raw * inflFactor;

        const W_total  = gVal === 0 ? W_0 * n : W_0 * (Math.pow(1 + gVal, n) - 1) / gVal;
        const E_fixed  = W_total * eVal;

        // ROI-adjusted future value: growing annuity compounded at investment rate
        let FV_savings;
        if (iVal === 0) {
            FV_savings = W_total * (1 - eVal);
        } else if (Math.abs(gVal - iVal) < 1e-9) {
            FV_savings = W_0 * (1 - eVal) * n * Math.pow(1 + gVal, n - 1);
        } else {
            FV_savings = W_0 * (1 - eVal) * (Math.pow(1 + gVal, n) - Math.pow(1 + iVal, n)) / (gVal - iVal);
        }
        const A_0_future = A_0 * Math.pow(1 + iVal, n);
        const NW_n     = A_0_future + FV_savings - S_non;
        const NW_pv    = NW_n / Math.pow(1 + rVal, n);

        const M_save   = S_non > 0 ? S_non / (n * 12) : 0;
        const M_avail  = W_total * (1 - eVal) / (n * 12);

        return { NW_n, NW_pv, M_save, M_avail, W_total, E_fixed,
                 S_non, S_non_raw, inflFactor, A_0, A_0_future, FV_savings,
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
            const unitLang = cfg._unitLang || cfg._lang || (_app().currentLang || 'ko');
            const u   = window.i18n?.[unitLang]?.['fnw_unit_man'] ?? _t('fnw_unit_man');
            const fc  = res.feasible ? 'var(--neon-green,#00ff88)' : 'var(--neon-red,#ff4d6d)';
            const ft  = res.feasible ? _t('fnw_feasible') : _t('fnw_not_feasible');
            const nwL = _t('fnw_label_nw').replace('{n}', cfg.n);
            const inflateBadge = cfg.inflateS
                ? ` <span style="font-size:0.68rem;color:var(--neon-gold,#ffd700);">${_t('fnw_detail_inflate_badge')}</span>`
                : '';
            container.innerHTML = `
                <div class="life-status-item">
                    <div><div class="ls-label">${nwL}</div></div>
                    <div class="ls-value gold">${f(res.NW_n)}${u}</div>
                </div>
                <div class="life-status-item">
                    <div><div class="ls-label">${_t('fnw_label_nw_pv')}</div></div>
                    <div class="ls-value" style="color:var(--neon-blue,#00d9ff);">${f(res.NW_pv)}${u}</div>
                </div>
                <div class="life-status-item">
                    <div><div class="ls-label">${_t('fnw_label_m_save')}${inflateBadge}</div></div>
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
                     <div>📈 <b>누적 수입</b> = 연소득 × ((1+g)ⁿ − 1) / g</div>
                     <div>💸 <b>고정 지출</b> = 누적 수입 × 지출비율(e)</div>
                     <div>💰 <b>미래 순자산</b> = 현재 순자산×(1+i)ⁿ + W₀×(1−e)×((1+g)ⁿ−(1+i)ⁿ)/(g−i) − 비정기 지출</div>
                     <div>📉 <b>현재가치 환산</b> = 미래 순자산 ÷ (1+r)ⁿ</div>
                     <div style="margin-top:6px;">📅 <b>월 필요 저축액</b> = 비정기 지출 ÷ (n × 12)</div>
                     <div>💸 <b>월 가용 저축액</b> = 누적 수입 × (1 − e) ÷ (n × 12)</div>
                 </div>
                 <div style="font-size:0.78rem;color:var(--text-sub);line-height:1.7;">
                     <div>🔹 <b>인플레이션율(r)</b>: 한국은행 목표 물가 상승률(2~3%)</div>
                     <div>🔹 <b>명목 임금상승률(g)</b>: 평균 임금상승률(기본 3.0%), 상황에 맞게 조정</div>
                     <div>🔹 <b>투자수익률(i)</b>: 예적금 평균 금리(기본 3.5%), 자산 운용 수익률로 조정</div>
                     <div>🔹 <b>고정 지출 비율(e)</b>: 가계 평균 70%, 본인 소비 패턴에 맞게 조정</div>
                     <div>🔹 <b>목돈 지출</b>: 미래 물가 반영 가격으로 입력하면 더 정확</div>
                     <div>🔹 월 가용 저축액 ≥ 월 필요 저축액 → <span style="color:var(--neon-green,#00ff88)">✅ 목표 달성 가능</span></div>
                 </div>`,
            en: `<p style="margin:0 0 10px;color:var(--text-sub);font-size:0.8rem;line-height:1.7;">
                    Estimates <b style="color:var(--neon-blue)">net worth in n years</b> and
                    <b style="color:var(--neon-blue)">required monthly savings</b> using inflation + lifecycle expenses.
                 </p>
                 <div style="background:var(--bg-main,#0a0a0a);border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.78rem;line-height:1.9;color:var(--text-sub);">
                     <div>📈 <b>Cumul. Income</b> = Annual × ((1+g)ⁿ − 1) / g</div>
                     <div>💸 <b>Fixed Expenses</b> = Cumul. Income × Expense Ratio (e)</div>
                     <div>💰 <b>Future Net Worth</b> = NW₀×(1+i)ⁿ + W₀×(1−e)×((1+g)ⁿ−(1+i)ⁿ)/(g−i) − Lump-Sum</div>
                     <div>📉 <b>Present Value</b> = Future Net Worth ÷ (1+r)ⁿ</div>
                     <div style="margin-top:6px;">📅 <b>Monthly Savings Needed</b> = Lump-Sum ÷ (n × 12)</div>
                     <div>💸 <b>Monthly Available Savings</b> = Cumul. Income × (1 − e) ÷ (n × 12)</div>
                 </div>
                 <div style="font-size:0.78rem;color:var(--text-sub);line-height:1.7;">
                     <div>🔹 <b>Inflation (r)</b>: Central bank target (2–3%)</div>
                     <div>🔹 <b>Nominal Wage Growth (g)</b>: avg. wage growth (default 3.0%), editable</div>
                     <div>🔹 <b>Investment ROI (i)</b>: avg. deposit rate (default 3.5%), adjust to expected returns</div>
                     <div>🔹 <b>Expense Ratio (e)</b>: Avg. ~70%; adjust to your spending habits</div>
                     <div>🔹 <b>Lump-Sum items</b>: Use future prices for accuracy</div>
                     <div>🔹 Monthly Available Savings ≥ Monthly Savings Needed → <span style="color:var(--neon-green,#00ff88)">✅ Goal Achievable</span></div>
                 </div>`,
            ja: `<p style="margin:0 0 10px;color:var(--text-sub);font-size:0.8rem;line-height:1.7;">
                    インフレと生涯イベント支出を考慮し、<b style="color:var(--neon-blue)">n年後の純資産</b>と
                    <b style="color:var(--neon-blue)">月積立目標額</b>を計算します。
                 </p>
                 <div style="background:var(--bg-main,#0a0a0a);border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.78rem;line-height:1.9;color:var(--text-sub);">
                     <div>📈 <b>累積収入</b> = 年収 × ((1+g)ⁿ − 1) / g</div>
                     <div>💸 <b>固定支出</b> = 累積収入 × 支出比率(e)</div>
                     <div>💰 <b>将来純資産</b> = 現在純資産×(1+i)ⁿ + W₀×(1−e)×((1+g)ⁿ−(1+i)ⁿ)/(g−i) − 一括支出</div>
                     <div>📉 <b>現在価値換算</b> = 将来純資産 ÷ (1+r)ⁿ</div>
                     <div style="margin-top:6px;">📅 <b>月必要積立額</b> = 一括支出 ÷ (n × 12)</div>
                     <div>💸 <b>月利用可能貯蓄額</b> = 累積収入 × (1 − e) ÷ (n × 12)</div>
                 </div>
                 <div style="font-size:0.78rem;color:var(--text-sub);line-height:1.7;">
                     <div>🔹 <b>インフレ率(r)</b>: 中央銀行目標値(2〜3%)</div>
                     <div>🔹 <b>名目賃金上昇率(g)</b>: 平均賃金上昇率（初期値 3.0%）、必要に応じて調整</div>
                     <div>🔹 <b>投資収益率(i)</b>: 預金平均金利（初期値 3.5%）、期待収益率に合わせて調整</div>
                     <div>🔹 <b>支出比率(e)</b>: 家計平均70%基準、生活スタイルに合わせて調整</div>
                     <div>🔹 <b>一括支出</b>: 将来物価で入力すると精度UP</div>
                     <div>🔹 月利用可能貯蓄額 ≥ 月必要積立額 → <span style="color:var(--neon-green,#00ff88)">✅ 目標達成可能</span></div>
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

    // ── 계산 상세 모달 ────────────────────────────────────────────────────
    function openFutureNetworthDetail() {
        if (document.getElementById('fnw-detail-overlay')) return;

        const cfg = getConfig();
        const unitLang = cfg?._unitLang || cfg?._lang || (_app().currentLang || 'ko');
        const u = window.i18n?.[unitLang]?.['fnw_unit_man'] ?? _t('fnw_unit_man');
        const f = v => Math.round(v).toLocaleString();

        const overlay = document.createElement('div');
        overlay.className = 'report-modal-overlay';
        overlay.id = 'fnw-detail-overlay';

        if (!cfg?.W_0 || !cfg?.n) {
            overlay.innerHTML = `
                <div class="report-modal-content" style="max-width:340px;width:90%;padding:22px;">
                    <div style="font-size:1rem;font-weight:bold;color:var(--neon-blue);margin-bottom:14px;">
                        ${_t('fnw_detail_title')}
                    </div>
                    <div style="text-align:center;padding:20px 0;color:var(--text-sub);font-size:0.85rem;">
                        ${_t('fnw_detail_no_config')}
                    </div>
                    <button id="fnw-detail-close-btn" style="margin-top:12px;width:100%;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);cursor:pointer;font-size:0.85rem;">
                        ${_t('fnw_btn_cancel')}
                    </button>
                </div>`;
            document.body.appendChild(overlay);
            requestAnimationFrame(() => overlay.classList.add('active'));
            document.getElementById('fnw-detail-close-btn')?.addEventListener('click', closeFnwDetail);
            return;
        }

        const res = calcNetWorth(cfg);
        if (!res) return;

        const rPct = (cfg.r   !== undefined ? cfg.r   : 2.5);
        const gPct = (cfg.g   !== undefined ? cfg.g   : 3.0);
        const ePct = (cfg.e   !== undefined ? cfg.e   : 70);
        const iPct = (cfg.roi !== undefined ? cfg.roi : 3.5);
        const fc   = res.feasible ? 'var(--neon-green,#00ff88)' : 'var(--neon-red,#ff4d6d)';
        const ft   = res.feasible ? _t('fnw_feasible') : _t('fnw_not_feasible');

        const inflateBadge = cfg.inflateS
            ? ` <span style="font-size:0.72rem;color:var(--neon-gold,#ffd700);">${_t('fnw_detail_inflate_badge')}</span>`
            : '';

        const snonInflateDetail = (cfg.inflateS && res.S_non_raw > 0)
            ? `<div style="font-size:0.71rem;color:var(--text-sub);margin-top:3px;padding-left:4px;">
                   ${_t('fnw_detail_original')}: ${f(res.S_non_raw)}${u}
                   → ${_t('fnw_detail_inflated')}: ${f(res.S_non)}${u}
                   (×${res.inflFactor.toFixed(2)})
               </div>`
            : '';

        const row = (label, value, color) =>
            `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                <span style="font-size:0.78rem;color:var(--text-sub);">${label}</span>
                <span style="font-size:0.88rem;font-weight:bold;color:${color || 'var(--text-main)'};">${value}</span>
             </div>`;

        overlay.innerHTML = `
            <div class="report-modal-content" style="max-width:360px;width:90%;padding:22px;max-height:90vh;overflow-y:auto;">
                <div style="font-size:1rem;font-weight:bold;color:var(--neon-blue);margin-bottom:14px;">
                    ${_t('fnw_detail_title')}
                </div>

                <div style="font-size:0.75rem;color:var(--text-sub);margin-bottom:6px;font-weight:bold;">
                    ${_t('fnw_detail_params')}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border-color);">
                    <span style="background:rgba(0,217,255,0.1);border:1px solid rgba(0,217,255,0.3);border-radius:4px;padding:2px 8px;font-size:0.73rem;color:var(--neon-blue);">n = ${cfg.n}yr</span>
                    <span style="background:rgba(0,217,255,0.1);border:1px solid rgba(0,217,255,0.3);border-radius:4px;padding:2px 8px;font-size:0.73rem;color:var(--neon-blue);">r = ${rPct}%</span>
                    <span style="background:rgba(0,217,255,0.1);border:1px solid rgba(0,217,255,0.3);border-radius:4px;padding:2px 8px;font-size:0.73rem;color:var(--neon-blue);">g = ${gPct}%</span>
                    <span style="background:rgba(0,217,255,0.1);border:1px solid rgba(0,217,255,0.3);border-radius:4px;padding:2px 8px;font-size:0.73rem;color:var(--neon-blue);">i = ${iPct}%</span>
                    <span style="background:rgba(0,217,255,0.1);border:1px solid rgba(0,217,255,0.3);border-radius:4px;padding:2px 8px;font-size:0.73rem;color:var(--neon-blue);">e = ${ePct}%</span>
                </div>

                ${row(_t('fnw_detail_a0'),     `${f(res.A_0)}${u}`,     'var(--text-main)')}
                ${row(_t('fnw_detail_wtotal'), `${f(res.W_total)}${u}`, 'var(--neon-blue)')}
                ${row(_t('fnw_detail_efixed'), `${f(res.E_fixed)}${u}`, 'var(--neon-red,#ff4d6d)')}
                <div style="display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <span style="font-size:0.78rem;color:var(--text-sub);">${_t('fnw_detail_snon')}${inflateBadge}</span>
                    <span style="font-size:0.88rem;font-weight:bold;color:var(--neon-red,#ff4d6d);">${f(res.S_non)}${u}</span>
                </div>
                ${snonInflateDetail}
                ${row(_t('fnw_detail_nwn'),    `${f(res.NW_n)}${u}`,    'var(--neon-gold,#ffd700)')}
                ${row(_t('fnw_detail_nwn_pv'), `${f(res.NW_pv)}${u}`,  'var(--neon-blue,#00d9ff)')}

                <div style="height:8px;"></div>
                ${row(_t('fnw_detail_msave'),  `${f(res.M_save)}${u}`,  'var(--neon-blue)')}
                <div style="display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;">
                    <span style="font-size:0.78rem;color:var(--text-sub);">${_t('fnw_detail_mavail')}</span>
                    <div style="text-align:right;">
                        <div style="font-size:0.88rem;font-weight:bold;color:${fc};">${f(res.M_avail)}${u}</div>
                        <div style="font-size:0.72rem;color:${fc};">${ft}</div>
                    </div>
                </div>

                <button id="fnw-detail-close-btn" style="margin-top:16px;width:100%;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);cursor:pointer;font-size:0.85rem;">
                    ${_t('fnw_btn_cancel')}
                </button>
            </div>`;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
        document.getElementById('fnw-detail-close-btn')?.addEventListener('click', closeFnwDetail);
    }

    function closeFnwDetail() {
        const el = document.getElementById('fnw-detail-overlay');
        if (el) { el.classList.remove('active'); setTimeout(() => el.remove(), 300); }
    }

    // ── 설정 모달 ─────────────────────────────────────────────────────────
    function openFutureNetworthSettings() {
        if (document.getElementById('future-networth-modal-overlay')) return;

        const cfg    = getConfig() || {};
        // 저장 시점 언어로 화폐단위 표기 (없으면 현재 언어)
        const unitLang = cfg._unitLang || cfg._lang || (_app().currentLang || 'ko');
        const _tUnit = key => window.i18n?.[unitLang]?.[key] ?? key;
        const _currCode = unitLang === 'en' ? 'USD' : unitLang === 'ja' ? 'JPY' : 'KRW';
        const _tWithSavedUnit = key => {
            const label = _t(key);
            const unit  = _tUnit('fnw_unit_man');
            return String(label)
                .replace(/\((만원|K USD)\)/g, `(${unit})`)
                .replace(/（万円）/g, `（${unit}）`);
        };
        const iStyle = 'width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--panel-bg);color:var(--text-main);font-size:0.85rem;box-sizing:border-box;';
        const lStyle = 'display:block;font-size:0.75rem;color:var(--text-sub);margin-bottom:4px;';
        const lStyleCompact = 'display:block;font-size:0.72rem;color:var(--text-sub);margin-bottom:4px;white-space:nowrap;';
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
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <label style="font-size:0.75rem;color:var(--text-sub);">${_t('fnw_label_n')}</label>
                        <span style="font-size:0.68rem;color:var(--neon-blue);background:rgba(0,217,255,0.1);border:1px solid rgba(0,217,255,0.3);border-radius:4px;padding:1px 7px;">💰 ${_currCode} ${_tUnit('fnw_unit_man')}</span>
                    </div>
                    <input id="fnw-i-n" type="text" inputmode="numeric"
                        value="${fmtComma(cfg.n)}" placeholder="10" style="${iStyle}">
                </div>
                <div style="font-size:0.8rem;color:var(--text-sub);margin-bottom:8px;padding-top:2px;">
                    ${_t('fnw_section_income')}
                </div>
                <div style="display:grid;grid-template-columns:1.25fr 0.9fr 0.9fr;gap:8px;${fWrap}">
                    <div>
                        <label style="${lStyle}">${_tWithSavedUnit('fnw_label_w0')}</label>
                        <input id="fnw-i-w0" type="text" inputmode="numeric"
                            value="${fmtComma(cfg.W_0)}" placeholder="0" style="${iStyle}">
                    </div>
                    <div>
                        <label style="${lStyleCompact}">${_t('fnw_label_g')}</label>
                        <input id="fnw-i-g" type="number" min="0" max="20" step="0.1"
                            value="${cfg.g !== undefined ? cfg.g : 3.0}" placeholder="3.0" style="${iStyle}">
                    </div>
                    <div>
                        <label style="${lStyleCompact}">${_t('fnw_label_roi')}</label>
                        <input id="fnw-i-roi" type="number" min="0" max="30" step="0.1"
                            value="${cfg.roi !== undefined ? cfg.roi : 3.5}" placeholder="3.5" style="${iStyle}">
                    </div>
                </div>

                <div style="font-size:0.8rem;color:var(--text-sub);margin-bottom:6px;padding-top:8px;border-top:1px solid var(--border-color);">
                    ${_t('fnw_label_net_section')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px;">
                    <div>
                        <label style="${lStyle}">${_tWithSavedUnit('fnw_label_assets')}</label>
                        <input id="fnw-i-assets" type="text" inputmode="numeric"
                            value="${assetsVal}" placeholder="0" style="${iStyle}">
                    </div>
                    <div>
                        <label style="${lStyle}">${_tWithSavedUnit('fnw_label_liabilities')}</label>
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
                    ${_tWithSavedUnit('fnw_section_lump')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                    ${lumpGrid}
                </div>

                <div style="margin-bottom:12px;padding:10px 12px;background:rgba(255,200,0,0.05);border:1px solid rgba(255,200,0,0.2);border-radius:8px;">
                    <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;margin-bottom:4px;">
                        <input type="checkbox" id="fnw-inflate-checkbox" ${cfg.inflateS ? 'checked' : ''} style="margin-top:3px;flex-shrink:0;">
                        <span style="font-size:0.73rem;color:var(--text-sub);line-height:1.55;">${_t('fnw_inflate_lump')}</span>
                    </label>
                    <div id="fnw-inflate-preview" style="font-size:0.72rem;color:var(--neon-gold,#ffd700);min-height:14px;padding-left:20px;"></div>
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
                el.textContent = `${_t('fnw_label_net_auto')}: ${net.toLocaleString()}${_tUnit('fnw_unit_man')}`;
                el.style.color = net >= 0 ? 'var(--neon-green,#00ff88)' : 'var(--neon-red,#ff4d6d)';
            } else {
                el.textContent = '';
            }
        }
        document.getElementById('fnw-i-assets')?.addEventListener('input', _updateNetLabel);
        document.getElementById('fnw-i-liabilities')?.addEventListener('input', _updateNetLabel);
        _updateNetLabel();

        // 미래물가 반영 체크박스 실시간 총액 미리보기
        function _updateInflatePreview() {
            const previewEl = document.getElementById('fnw-inflate-preview');
            if (!previewEl) return;
            const checked = document.getElementById('fnw-inflate-checkbox')?.checked;
            const nRaw    = parseComma(document.getElementById('fnw-i-n')?.value);
            const rRaw    = parseFloat(document.getElementById('fnw-i-r')?.value) || 2.5;
            const rVal    = rRaw / 100;
            const S_raw   = ['fnw-i-s_car','fnw-i-s_housing','fnw-i-s_wedding',
                             'fnw-i-s_edu','fnw-i-s_medical','fnw-i-s_travel']
                .reduce((sum, id) => sum + parseComma(document.getElementById(id)?.value), 0);

            if (checked && nRaw > 0 && S_raw > 0) {
                const factor  = rVal > 0 ? Math.pow(1 + rVal, nRaw) : 1;
                const inflated = Math.round(S_raw * factor);
                previewEl.textContent =
                    `${_t('fnw_inflate_total')}: ${inflated.toLocaleString()}${_tUnit('fnw_unit_man')} (×${factor.toFixed(2)})`;
            } else {
                previewEl.textContent = '';
            }
        }
        document.getElementById('fnw-inflate-checkbox')
            ?.addEventListener('change', _updateInflatePreview);
        ['fnw-i-n','fnw-i-r',
         'fnw-i-s_car','fnw-i-s_housing','fnw-i-s_wedding',
         'fnw-i-s_edu','fnw-i-s_medical','fnw-i-s_travel']
            .forEach(id => document.getElementById(id)
                ?.addEventListener('input', _updateInflatePreview));
        _updateInflatePreview();
    }

    // ── 저장 ──────────────────────────────────────────────────────────────
    function saveFutureNetworthFromModal() {
        // 1. 입력값 읽기
        const prevCfg = getConfig() || {};
        const W_0 = parseComma(document.getElementById('fnw-i-w0')?.value);
        const n   = parseComma(document.getElementById('fnw-i-n')?.value);

        if (!W_0 || W_0 <= 0) { alert(_t('fnw_income_required')); return; }
        if (!n   || n   <= 0) { alert(_t('fnw_n_required'));       return; }

        const rRaw   = document.getElementById('fnw-i-r')?.value;
        const gRaw   = document.getElementById('fnw-i-g')?.value;
        const eRaw   = document.getElementById('fnw-i-e')?.value;
        const roiRaw = document.getElementById('fnw-i-roi')?.value;

        const cfg = {
            n, W_0,
            assets:      parseComma(document.getElementById('fnw-i-assets')?.value),
            liabilities: parseComma(document.getElementById('fnw-i-liabilities')?.value),
            r:   rRaw   !== '' && rRaw   !== null ? parseFloat(rRaw)   : 2.5,
            g:   gRaw   !== '' && gRaw   !== null ? parseFloat(gRaw)   : 3.0,
            e:   eRaw   !== '' && eRaw   !== null ? parseFloat(eRaw)   : 70,
            roi: roiRaw !== '' && roiRaw !== null ? parseFloat(roiRaw) : 3.5,
            inflateS: document.getElementById('fnw-inflate-checkbox')?.checked === true,
            s_car:     parseComma(document.getElementById('fnw-i-s_car')?.value),
            s_housing: parseComma(document.getElementById('fnw-i-s_housing')?.value),
            s_wedding: parseComma(document.getElementById('fnw-i-s_wedding')?.value),
            s_edu:     parseComma(document.getElementById('fnw-i-s_edu')?.value),
            s_medical: parseComma(document.getElementById('fnw-i-s_medical')?.value),
            s_travel:  parseComma(document.getElementById('fnw-i-s_travel')?.value),
        };

        // 2. 동의 필수 확인 — 미동의 시 저장 차단
        const consentChecked = document.getElementById('fnw-consent-checkbox')?.checked;
        if (!consentChecked) {
            alert(_t('fnw_consent_required'));
            return;
        }
        localStorage.setItem(CONSENT_KEY, '1');

        // 3. M_avail 계산 및 lang 포함하여 저장
        const res = calcNetWorth(cfg);
        if (res) cfg._M_avail = res.M_avail;
        cfg._lang = _app().currentLang || 'ko';
        cfg._unitLang = prevCfg._unitLang || prevCfg._lang || (_app().currentLang || 'ko');
        saveConfig(cfg);

        // 4. UI 갱신 + 모달 닫기 (반드시 실행)
        try { renderFutureNetworth(); } catch (e) {}
        closeFutureNetworthModal();

        // 5. Firestore 저장
        try { window.saveUserData?.(); } catch (e) {}

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
        document.getElementById('btn-future-networth-detail')
            ?.addEventListener('click', openFutureNetworthDetail);
        document.getElementById('btn-future-networth-settings')
            ?.addEventListener('click', openFutureNetworthSettings);
        renderFutureNetworth();
    }

    // Public API (외부 접근용)
    window.renderFutureNetworth        = renderFutureNetworth;
    window.openFutureNetworthSettings  = openFutureNetworthSettings;
    window.openFutureNetworthGuide     = openFutureNetworthGuide;
    window.openFutureNetworthDetail    = openFutureNetworthDetail;
    window.saveFutureNetworthFromModal = saveFutureNetworthFromModal;
    window.resetFutureNetworth         = resetFutureNetworth;
    window.closeFutureNetworthModal    = closeFutureNetworthModal;
    window.closeFnwGuide               = closeFnwGuide;
    window.closeFnwDetail              = closeFnwDetail;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFutureNetworth);
    } else {
        initFutureNetworth();
    }
})();
