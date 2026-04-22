export function createQuestStatsModule(deps) {
    const { AppState, i18n, weeklyQuestData, isNativePlatform, getTodayStr, renderQuestStatsFallback } = deps;

    const state = {
        month: new Date(),
        year: new Date().getFullYear(),
        diyOnly: false,
        selectedDiyId: null,
        selectedDailyDow: null,
        selectedDailyIdx: null,
        weekOffset: 0,
        monthlyUnlocked: false,
        selectedDate: null,
    };

    function renderQstatsCalendar() { /* same */
        const container = document.getElementById('qstats-calendar-grid');
        if (!container) return;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const currentDay = today.getDay();
        const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - currentDay + (state.weekOffset * 7));
        const monthEl = document.getElementById('qstats-cal-month');
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        if (monthEl) monthEl.innerText = `${startOfWeek.getFullYear()} ${monthNames[startOfWeek.getMonth()]}`;
        const dayNames = { ko:["일","월","화","수","목","금","토"], en:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], ja:["日","月","火","水","木","金","土"] };
        const todayStr = getTodayStr();
        container.innerHTML = Array.from({ length: 7 }, (_, i) => {
            const iterDate = new Date(startOfWeek); iterDate.setDate(startOfWeek.getDate() + i); iterDate.setHours(0, 0, 0, 0);
            const dateStr = `${iterDate.getFullYear()}-${String(iterDate.getMonth() + 1).padStart(2, '0')}-${String(iterDate.getDate()).padStart(2, '0')}`;
            const isToday = dateStr === todayStr; const isFuture = iterDate > today;
            const diyCount = AppState.diyQuests.definitions.length; let count = 0, total = 12;
            if (isToday) { const s = AppState.quest.completedState[AppState.quest.currentDayOfWeek]; count = s.filter(v => v).length + Object.values(AppState.diyQuests.completedToday).filter(v => v).length; total = 12 + diyCount; }
            else if (isFuture) total = 12 + diyCount;
            else { const hist = AppState.questHistory && AppState.questHistory[dateStr]; if (hist) { count = (hist.r || 0) + (hist.d || 0); total = hist.t || 12; } }
            return `<div class="cal-day ${isToday ? 'today' : ''}"><div class="cal-name">${dayNames[AppState.currentLang][i]}</div><div class="cal-date">${iterDate.getDate()}</div><div class="cal-score">${isFuture ? '-' : count + '/' + total}</div></div>`;
        }).join('');
    }

    function getDailyQuestDoneTotal(dow, idx, rec, isToday) {
        if (isToday) {
            const stateArr = AppState.quest.completedState[AppState.quest.currentDayOfWeek] || [];
            return { done: stateArr[idx] ? 1 : 0, total: 1 };
        }
        if (!rec || !Array.isArray(rec.rc) || rec.rc[idx] === undefined) return { done: 0, total: 0 };
        return { done: rec.rc[idx] ? 1 : 0, total: 1 };
    }

    function getDiyQuestDoneTotal(questId, rec, isToday) {
        if (isToday) {
            const exists = AppState.diyQuests.definitions.some((q) => q.id === questId);
            if (!exists) return { done: 0, total: 0 };
            return { done: AppState.diyQuests.completedToday[questId] === true ? 1 : 0, total: 1 };
        }
        if (!rec || !rec.dc || !Object.prototype.hasOwnProperty.call(rec.dc, questId)) return { done: 0, total: 0 };
        return { done: rec.dc[questId] === true ? 1 : 0, total: 1 };
    }

    function renderQstatsDailyDropdown() {
        const btn = document.getElementById('qstats-daily-dropdown-btn');
        const menu = document.getElementById('qstats-daily-dropdown-menu');
        if (!btn || !menu) return;
        const lang = AppState.currentLang;
        const refDow = state.selectedDailyDow !== null ? state.selectedDailyDow : state.selectedDate ? new Date(state.selectedDate + 'T00:00:00').getDay() : new Date().getDay();
        const quests = weeklyQuestData[refDow] || [];
        const isSelected = state.selectedDailyDow !== null;
        const selectedQ = isSelected ? weeklyQuestData[state.selectedDailyDow]?.[state.selectedDailyIdx] : null;
        const rawLabel = selectedQ ? (selectedQ.title[lang] || selectedQ.title.ko) : '데일리';
        const btnLabel = rawLabel.length > 9 ? rawLabel.slice(0, 9) + '…' : rawLabel;
        btn.innerHTML = `${btnLabel} <span style="font-size:0.6em;">▾</span>`;
        btn.style.color = isSelected ? 'var(--neon-cyan)' : '';
        btn.style.borderColor = isSelected ? 'var(--neon-cyan)' : '';
        const dayNames = { ko:["일","월","화","수","목","금","토"], en:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], ja:["日","月","火","水","木","金","土"] };
        const allLabel = { ko: '전체 보기', en: 'All Daily', ja: '全て' };
        const dowName = (dayNames[lang] || dayNames.en)[refDow];
        menu.innerHTML = [
            `<div class="qstats-diy-dd-item${!isSelected ? ' active' : ''}" onclick="window.selectQstatsDailyQuest(null, null)">${allLabel[lang] || allLabel.en}</div>`,
            `<div style="padding:4px 12px; font-size:0.62rem; color:var(--text-sub); border-bottom:1px solid rgba(255,255,255,0.06);">${dowName}요일 퀘스트</div>`,
            ...quests.map((q, i) => `<div class="qstats-diy-dd-item${state.selectedDailyDow === refDow && state.selectedDailyIdx === i ? ' active' : ''}" onclick="window.selectQstatsDailyQuest(${refDow}, ${i})"><span class="quest-stat-tag" style="font-size:0.55rem; padding:1px 4px; margin-right:4px;">${q.stat}</span>${q.title[lang] || q.title.ko}</div>`)
        ].join('');
    }

    function renderQstatsDiyDropdown() {
        const defs = AppState.diyQuests.definitions;
        const wrap = document.getElementById('qstats-diy-dropdown-wrap');
        const btn = document.getElementById('qstats-diy-dropdown-btn');
        const menu = document.getElementById('qstats-diy-dropdown-menu');
        if (!wrap || !btn || !menu) return;
        wrap.style.display = defs.length > 0 ? 'block' : 'none';
        const selected = defs.find((q) => q.id === state.selectedDiyId);
        const rawLabel = selected ? selected.title : 'DIY';
        const btnLabel = rawLabel.length > 9 ? rawLabel.slice(0, 9) + '…' : rawLabel;
        btn.innerHTML = `${btnLabel} <span style="font-size:0.6em;">▾</span>`;
        btn.style.color = state.selectedDiyId ? 'var(--neon-gold)' : '';
        btn.style.borderColor = 'var(--neon-gold)';
        const lang = AppState.currentLang;
        const allLabel = { ko: '전체 보기', en: 'All DIY', ja: '全て' };
        menu.innerHTML = [`<div class="qstats-diy-dd-item${!state.selectedDiyId ? ' active' : ''}" onclick="window.selectQstatsDiyQuest(null)">${allLabel[lang] || allLabel.en}</div>`, ...defs.map((q) => `<div class="qstats-diy-dd-item${state.selectedDiyId === q.id ? ' active' : ''}" onclick="window.selectQstatsDiyQuest('${q.id}')"><span class="quest-stat-tag" style="font-size:0.55rem; padding:1px 4px; margin-right:4px;">${q.stat}</span>${q.title}</div>`)].join('');
    }

    function renderMonthlySummary(year, month, history) {
        const container = document.getElementById('qstats-monthly-summary');
        if (!container) return;
        const lang = AppState.currentLang;
        const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
        const todayStr = getTodayStr();
        const keys = Object.keys(history).filter((k) => k.startsWith(prefix));
        let activeDays = 0, totalRate = 0, perfectDays = 0;
        if (state.selectedDailyDow !== null) {
            const dow = state.selectedDailyDow, idx = state.selectedDailyIdx;
            const allKeys = [...keys];
            if (!allKeys.includes(todayStr) && todayStr.startsWith(prefix)) allKeys.push(todayStr);
            allKeys.forEach((k) => {
                const dateDow = new Date(k + 'T00:00:00').getDay();
                if (dateDow !== dow) return;
                const { done, total } = getDailyQuestDoneTotal(dow, idx, history[k], k === todayStr);
                if (total > 0) { activeDays++; totalRate += done; if (done >= total) perfectDays++; }
            });
        } else if (state.selectedDiyId) {
            keys.forEach((k) => { const { done, total } = getDiyQuestDoneTotal(state.selectedDiyId, history[k], k === todayStr); if (total > 0) { activeDays++; totalRate += done; if (done >= total) perfectDays++; } });
            if (!keys.includes(todayStr) && todayStr.startsWith(prefix)) {
                const { done, total } = getDiyQuestDoneTotal(state.selectedDiyId, null, true);
                if (total > 0) { activeDays++; totalRate += done; if (done >= total) perfectDays++; }
            }
        } else {
            activeDays = keys.length;
            keys.forEach((k) => {
                const rec = history[k];
                const done = state.diyOnly ? (rec.d || 0) : (rec.r + rec.d);
                const total = state.diyOnly ? (rec.dt != null ? rec.dt : (rec.t - 12)) : rec.t;
                const rate = done / Math.max(total, 1);
                totalRate += rate;
                if (rate >= 1 && total > 0) perfectDays++;
            });
        }
        const avgRate = activeDays > 0 ? Math.round(totalRate / activeDays * 100) : 0;
        const labels = { ko: { days:'활동일', avg:'평균 달성률', perfect:'올클리어' }, en: { days:'Active Days', avg:'Avg. Rate', perfect:'Perfect Days' }, ja: { days:'活動日数', avg:'平均達成率', perfect:'全完了日' } };
        const l = labels[lang] || labels.en;
        container.innerHTML = `<div class="qstats-summary-item"><div class="qstats-summary-val">${activeDays}</div><div class="qstats-summary-label">${l.days}</div></div><div class="qstats-summary-item"><div class="qstats-summary-val">${avgRate}%</div><div class="qstats-summary-label">${l.avg}</div></div><div class="qstats-summary-item"><div class="qstats-summary-val">${perfectDays}</div><div class="qstats-summary-label">${l.perfect}</div></div>`;
    }

    function renderMonthlyHeatmap(year, month, history) {
        const container = document.getElementById('qstats-monthly-heatmap'); if (!container) return;
        const lang = AppState.currentLang;
        const dayNames = { ko:["일","월","화","수","목","금","토"], en:["S","M","T","W","T","F","S"], ja:["日","月","火","水","木","金","土"] };
        const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate(); const todayStr = getTodayStr();
        let gridHTML = '<div class="qstats-heatmap-grid">'; for (let i = 0; i < firstDay; i++) gridHTML += '<div class="qstats-heatmap-cell empty"></div>';
        for (let d = 1; d <= daysInMonth; d++) {
            const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; const rec = history[key]; const isToday = (key === todayStr); const isFuture = (key > todayStr); const isSelected = (state.selectedDate === key);
            let level = 0, done = 0, total = 0;
            if (state.selectedDailyDow !== null && !isFuture) { const dateDow = new Date(key + 'T00:00:00').getDay(); if (dateDow === state.selectedDailyDow) { ({ done, total } = getDailyQuestDoneTotal(state.selectedDailyDow, state.selectedDailyIdx, rec, isToday)); if (total > 0) level = done > 0 ? 4 : 1; } }
            else if (state.selectedDiyId && !isFuture) { ({ done, total } = getDiyQuestDoneTotal(state.selectedDiyId, rec, isToday)); if (total > 0) level = done > 0 ? 4 : 1; }
            else if (isToday) { const diyCount = AppState.diyQuests.definitions.length; const regularDone = (AppState.quest.completedState[AppState.quest.currentDayOfWeek] || []).filter(v => v).length; const diyDone = Object.values(AppState.diyQuests.completedToday || {}).filter(v => v).length; done = state.diyOnly ? diyDone : (regularDone + diyDone); total = state.diyOnly ? diyCount : (12 + diyCount); const rate = total > 0 ? done / total * 100 : 0; level = rate >= 76 ? 4 : rate >= 51 ? 3 : rate >= 26 ? 2 : rate >= 1 ? 1 : 0; }
            else if (rec && !isFuture) { done = state.diyOnly ? (rec.d || 0) : (rec.r + rec.d); total = state.diyOnly ? (rec.dt != null ? rec.dt : (rec.t - 12)) : rec.t; const rate = done / Math.max(total, 1) * 100; level = rate >= 76 ? 4 : rate >= 51 ? 3 : rate >= 26 ? 2 : rate >= 1 ? 1 : 0; }
            const ratioHTML = (isToday ? total > 0 : (!!rec && !isFuture && total > 0)) ? `<span class="cell-ratio">${done}/${total}</span>` : '';
            gridHTML += `<div class="qstats-heatmap-cell level-${level}${isSelected ? ' selected' : ''}" onclick="window.selectQstatsDate('${key}')"><span class="cell-day">${d}</span>${ratioHTML}</div>`;
        }
        gridHTML += '</div>';
        const headerHTML = `<div class="qstats-heatmap-header">${(dayNames[lang] || dayNames.en).map((d) => `<span>${d}</span>`).join('')}</div>`;
        const legendHTML = `<div class="qstats-legend"><span>0%</span><div class="qstats-legend-cell level-0" style="background:rgba(255,255,255,0.05);"></div><div class="qstats-legend-cell level-1" style="background:rgba(0,217,255,0.15);"></div><div class="qstats-legend-cell level-2" style="background:rgba(0,217,255,0.3);"></div><div class="qstats-legend-cell level-3" style="background:rgba(0,217,255,0.5);"></div><div class="qstats-legend-cell level-4" style="background:rgba(0,217,255,0.75);"></div><span>100%</span></div>`;
        container.innerHTML = headerHTML + gridHTML + legendHTML;
    }

    function renderMonthlyDailyProgress() { /* keep lightweight */ const container = document.getElementById('qstats-daily-progress'); if (!container) return; container.innerHTML = container.innerHTML; }

    function renderAnnualChart(year, history) {
        const svg = document.getElementById('qstats-annual-chart'); if (!svg) return;
        const lang = AppState.currentLang; const monthNames = i18n[lang]?.month_names_short || ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
        const padding = { top: 20, right: 10, bottom: 30, left: 30 }; const W = 320, H = 180; const chartW = W - padding.left - padding.right; const chartH = H - padding.top - padding.bottom; const barGap = chartW / 12; const barW = barGap * 0.6;
        let svgContent = '';
        for (let pct = 0; pct <= 100; pct += 25) { const y = padding.top + chartH - (pct / 100 * chartH); svgContent += `<line x1="${padding.left}" y1="${y}" x2="${W - padding.right}" y2="${y}" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>`; }
        for (let m = 0; m < 12; m++) {
            const prefix = `${year}-${String(m + 1).padStart(2, '0')}`; const keys = Object.keys(history).filter((k) => k.startsWith(prefix));
            const avgRate = keys.length ? Math.min(100, Math.round(keys.reduce((a, k) => { const rec = history[k]; const done = state.diyOnly ? (rec.d || 0) : (rec.r + rec.d); const total = state.diyOnly ? (rec.dt != null ? rec.dt : (rec.t - 12)) : rec.t; return a + (done / Math.max(total, 1)) * 100; }, 0) / keys.length)) : 0;
            const x = padding.left + m * barGap + (barGap - barW) / 2; const barH = (avgRate / 100) * chartH; const y = padding.top + chartH - barH;
            if (barH > 0) svgContent += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="2" fill="rgba(0,217,255,0.6)"/>`;
            svgContent += `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="7">${monthNames[m]}</text>`;
        }
        svg.innerHTML = svgContent;
    }

    function render() {
        const history = AppState.questHistory || {};
        const emptyEl = document.getElementById('qstats-empty-state');
        if (emptyEl) emptyEl.classList.toggle('d-none', Object.keys(history).length > 0);
        renderQstatsCalendar(); renderQstatsDailyDropdown(); renderQstatsDiyDropdown();
        const y = state.month.getFullYear(); const m = state.month.getMonth();
        renderMonthlySummary(y, m, history); renderMonthlyHeatmap(y, m, history); renderMonthlyDailyProgress(y, m, history); renderAnnualChart(state.year, history);
        const lang = AppState.currentLang;
        const monthNames = i18n[lang]?.month_names_short || ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
        const monthLabel = document.getElementById('qstats-month-label'); if (monthLabel) monthLabel.textContent = `${y} ${monthNames[m]}`;
        const yearLabel = document.getElementById('qstats-year-label'); if (yearLabel) yearLabel.textContent = `${state.year}`;
    }

    function bindWindowHandlers() {
        window.changeQstatsWeek = (delta) => { state.weekOffset += delta; renderQstatsCalendar(); };
        window.openQstatsMonthly = async () => {
            const todayStr = getTodayStr();
            if (localStorage.getItem('qstats_monthly_ad_date') === todayStr || state.monthlyUnlocked) return showMonthly();
            if (!isNativePlatform) { state.monthlyUnlocked = true; localStorage.setItem('qstats_monthly_ad_date', todayStr); return showMonthly(); }
            if (!window.AdManager) return alert(i18n[AppState.currentLang].monthly_cal_ad_fail);
            const adShown = await window.AdManager.showRewarded({ context: 'qstatsMonthly', onSuccess: () => { state.monthlyUnlocked = true; localStorage.setItem('qstats_monthly_ad_date', todayStr); showMonthly(); }, onFail: () => alert(i18n[AppState.currentLang].monthly_cal_ad_fail) });
            if (!adShown) alert(i18n[AppState.currentLang].monthly_cal_ad_fail);
        };
        window.closeQstatsMonthly = () => { const w = document.getElementById('qstats-weekly-card'); const m = document.getElementById('qstats-monthly-card'); if (w) w.classList.remove('d-none'); if (m) m.classList.add('d-none'); renderQstatsCalendar(); };
        window.selectQstatsDate = (dateStr) => { state.selectedDate = (state.selectedDate === dateStr) ? null : dateStr; render(); };
        window.toggleQstatsDailyDropdown = () => document.getElementById('qstats-daily-dropdown-menu')?.classList.toggle('d-none');
        window.selectQstatsDailyQuest = (dow, idx) => { state.selectedDailyDow = dow; state.selectedDailyIdx = idx; state.selectedDiyId = null; state.selectedDate = null; document.getElementById('qstats-daily-dropdown-menu')?.classList.add('d-none'); render(); };
        window.toggleQstatsDiyDropdown = () => document.getElementById('qstats-diy-dropdown-menu')?.classList.toggle('d-none');
        window.selectQstatsDiyQuest = (questId) => { state.selectedDiyId = questId; state.selectedDailyDow = null; state.selectedDailyIdx = null; state.selectedDate = null; document.getElementById('qstats-diy-dropdown-menu')?.classList.add('d-none'); render(); };
    }

    function showMonthly() { const w = document.getElementById('qstats-weekly-card'); const m = document.getElementById('qstats-monthly-card'); if (w) w.classList.add('d-none'); if (m) m.classList.remove('d-none'); render(); }

    function handlePrevMonth() { state.month.setMonth(state.month.getMonth() - 1); state.selectedDate = null; render(); }
    function handleNextMonth() { state.month.setMonth(state.month.getMonth() + 1); state.selectedDate = null; render(); }
    function handlePrevYear() { state.year -= 1; render(); }
    function handleNextYear() { state.year += 1; render(); }
    function handleDiyFilterChange(e) { state.diyOnly = e.target.checked; render(); }

    return { init: bindWindowHandlers, bindWindowHandlers, render, handlePrevMonth, handleNextMonth, handlePrevYear, handleNextYear, handleDiyFilterChange, renderQstatsCalendar };
}
