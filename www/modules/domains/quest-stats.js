export function createQuestStatsModule(deps) {
    const { AppState, i18n, weeklyQuestData, isNativePlatform, getTodayStr } = deps;

    const state = {
        month: new Date(),
        diyOnly: false,
        selectedDiyId: null,
        selectedDailyDow: null,
        selectedDailyIdx: null,
        selectedDailyKeys: [],
        selectedDiyIds: [],
        weekOffset: 0,
        monthlyUnlocked: false,
        selectedDate: null,
        chartRange: 'weekly',
    };

    function syncSingleSelectionFromMulti() {
        if (state.selectedDailyKeys.length > 0) {
            const [dowStr, idxStr] = state.selectedDailyKeys[0].split(':');
            state.selectedDailyDow = Number(dowStr);
            state.selectedDailyIdx = Number(idxStr);
            state.selectedDiyId = null;
            return;
        }
        if (state.selectedDiyIds.length > 0) {
            state.selectedDiyId = state.selectedDiyIds[0];
            state.selectedDailyDow = null;
            state.selectedDailyIdx = null;
            return;
        }
        state.selectedDailyDow = null;
        state.selectedDailyIdx = null;
        state.selectedDiyId = null;
    }

    function renderQstatsCalendar() {
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

    function toggleMultiSelection(list, value) {
        const idx = list.indexOf(value);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(value);
    }

    function renderQstatsDailyDropdown() {
        const btn = document.getElementById('qstats-daily-dropdown-btn');
        const menu = document.getElementById('qstats-daily-dropdown-menu');
        if (!btn || !menu) return;
        const lang = AppState.currentLang;
        const refDow = state.selectedDate ? new Date(state.selectedDate + 'T00:00:00').getDay() : new Date().getDay();
        const quests = weeklyQuestData[refDow] || [];
        const selectedCount = state.selectedDailyKeys.length;
        const baseLabel = { ko: '일반 퀘스트', en: 'General Quest', ja: '一般クエスト' };
        const label = selectedCount > 0 ? `${baseLabel[lang] || baseLabel.en} ${selectedCount}` : (baseLabel[lang] || baseLabel.en);
        btn.innerHTML = `${label} <span style="font-size:0.6em;">▾</span>`;
        btn.style.color = selectedCount > 0 ? 'var(--neon-cyan)' : '';
        btn.style.borderColor = selectedCount > 0 ? 'var(--neon-cyan)' : '';

        const dayNames = { ko:["일","월","화","수","목","금","토"], en:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], ja:["日","月","火","水","木","金","土"] };
        const selectAllLabel = { ko: '전체', en: 'All', ja: '全体' };
        const dowName = (dayNames[lang] || dayNames.en)[refDow];
        const isAllSelected = state.selectedDailyKeys.length === 0;
        menu.innerHTML = [
            `<label class="qstats-diy-dd-item" style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ${isAllSelected ? 'checked' : ''} onchange="window.toggleQstatsDailyAll(this.checked)">${selectAllLabel[lang] || selectAllLabel.en}</label>`,
            `<div style="padding:4px 12px; font-size:0.62rem; color:var(--text-sub); border-bottom:1px solid rgba(255,255,255,0.06);">${dowName}요일 퀘스트 (멀티 선택)</div>`,
            ...quests.map((q, i) => {
                const key = `${refDow}:${i}`;
                const isItemActive = isAllSelected || state.selectedDailyKeys.includes(key);
                const active = isItemActive ? ' active' : '';
                return `<div class="qstats-diy-dd-item${active}" onclick="window.toggleQstatsDailyQuest(${refDow}, ${i})"><span style="margin-right:6px;">${isItemActive ? '☑' : '☐'}</span><span class="quest-stat-tag" style="font-size:0.55rem; padding:1px 4px; margin-right:4px;">${q.stat}</span>${q.title[lang] || q.title.ko}</div>`;
            })
        ].join('');
    }

    function renderQstatsDiyDropdown() {
        const defs = AppState.diyQuests.definitions;
        const wrap = document.getElementById('qstats-diy-dropdown-wrap');
        const btn = document.getElementById('qstats-diy-dropdown-btn');
        const menu = document.getElementById('qstats-diy-dropdown-menu');
        if (!wrap || !btn || !menu) return;
        wrap.style.display = defs.length > 0 ? 'block' : 'none';
        const selectedCount = state.selectedDiyIds.length;
        const lang = AppState.currentLang;
        const baseLabel = { ko: 'DIY퀘스트', en: 'DIY Quest', ja: 'DIYクエスト' };
        const label = selectedCount > 0 ? `${baseLabel[lang] || baseLabel.en} ${selectedCount}` : (baseLabel[lang] || baseLabel.en);
        btn.innerHTML = `${label} <span style="font-size:0.6em;">▾</span>`;
        btn.style.color = selectedCount > 0 ? 'var(--neon-gold)' : '';
        btn.style.borderColor = 'var(--neon-gold)';

        const selectAllLabel = { ko: '전체', en: 'All', ja: '全体' };
        const isAllSelected = state.selectedDiyIds.length === 0;
        menu.innerHTML = [
            `<label class="qstats-diy-dd-item" style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ${isAllSelected ? 'checked' : ''} onchange="window.toggleQstatsDiyAll(this.checked)">${selectAllLabel[lang] || selectAllLabel.en}</label>`,
            ...defs.map((q) => {
                const isItemActive = isAllSelected || state.selectedDiyIds.includes(q.id);
                const active = isItemActive ? ' active' : '';
                return `<div class="qstats-diy-dd-item${active}" onclick="window.toggleQstatsDiyQuest('${q.id}')"><span style="margin-right:6px;">${isItemActive ? '☑' : '☐'}</span><span class="quest-stat-tag" style="font-size:0.55rem; padding:1px 4px; margin-right:4px;">${q.stat}</span>${q.title}</div>`;
            })
        ].join('');
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

    function getChartSeries(history, labels) {
        const todayStr = getTodayStr();
        const series = [];
        const selectedDaily = state.selectedDailyKeys.map((key) => {
            const [dow, idx] = key.split(':').map(Number);
            const q = weeklyQuestData[dow]?.[idx];
            return q ? { key, dow, idx, name: q.title[AppState.currentLang] || q.title.ko, color: '#00d9ff' } : null;
        }).filter(Boolean);
        const selectedDiy = state.selectedDiyIds.map((id) => {
            const q = AppState.diyQuests.definitions.find((x) => x.id === id);
            return q ? { id, name: q.title, color: '#ffcb2f' } : null;
        }).filter(Boolean);

        if (selectedDaily.length === 0 && selectedDiy.length === 0) {
            series.push({
                name: state.diyOnly ? 'DIY' : 'ALL',
                color: '#00d9ff',
                values: labels.map((k) => {
                    const rec = history[k];
                    if (!rec && k !== todayStr) return null;
                    if (k === todayStr) {
                        const regularDone = (AppState.quest.completedState[AppState.quest.currentDayOfWeek] || []).filter(v => v).length;
                        const diyDone = Object.values(AppState.diyQuests.completedToday || {}).filter(v => v).length;
                        return state.diyOnly ? diyDone : (regularDone + diyDone);
                    }
                    return state.diyOnly ? (rec.d || 0) : ((rec.r || 0) + (rec.d || 0));
                })
            });
        }

        const CHART_PALETTE = ['#00d9ff', '#ffcb2f', '#ff6b6b', '#69f0ae', '#ce93d8', '#ffab40', '#26c6da', '#f06292'];
        let colorIdx = 0;

        selectedDaily.forEach((item) => {
            series.push({
                name: item.name,
                color: CHART_PALETTE[colorIdx++ % CHART_PALETTE.length],
                values: labels.map((k) => {
                    const isToday = k === todayStr;
                    const dow = new Date(k + 'T00:00:00').getDay();
                    if (dow !== item.dow) return null;
                    const { done, total } = getDailyQuestDoneTotal(item.dow, item.idx, history[k], isToday);
                    return total > 0 ? (done ? 1 : 0) : null;
                })
            });
        });

        selectedDiy.forEach((item) => {
            series.push({
                name: item.name,
                color: CHART_PALETTE[colorIdx++ % CHART_PALETTE.length],
                values: labels.map((k) => {
                    const isToday = k === todayStr;
                    const { done, total } = getDiyQuestDoneTotal(item.id, history[k], isToday);
                    return total > 0 ? (done ? 1 : 0) : null;
                })
            });
        });

        return series;
    }

    function renderTrendChart(history) {
        const svg = document.getElementById('qstats-annual-chart');
        const legend = document.getElementById('qstats-chart-legend');
        const rangeLabel = document.getElementById('qstats-chart-range-label');
        if (!svg) return;

        const now = new Date();
        const labels = [];
        if (state.chartRange === 'weekly') {
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(now.getDate() - i);
                labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
            }
        } else {
            const y = state.month.getFullYear();
            const m = state.month.getMonth();
            const days = new Date(y, m + 1, 0).getDate();
            for (let d = 1; d <= days; d++) labels.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
        }

        if (rangeLabel) rangeLabel.textContent = state.chartRange === 'weekly' ? '최근 7일' : '이번 달';
        const series = getChartSeries(history, labels);

        const diyCount = AppState.diyQuests.definitions.length;
        const hasSpecificSelection = state.selectedDailyKeys.length > 0 || state.selectedDiyIds.length > 0;
        let maxY;
        if (hasSpecificSelection) {
            maxY = 1;
        } else if (state.diyOnly) {
            maxY = Math.max(diyCount, 1);
        } else {
            maxY = Math.max(12 + diyCount, 1);
        }

        const padding = { top: 16, right: 8, bottom: 24, left: 26 };
        const W = 320, H = 180;
        const chartW = W - padding.left - padding.right;
        const chartH = H - padding.top - padding.bottom;

        const toX = (idx) => padding.left + (labels.length === 1 ? 0 : (idx / (labels.length - 1)) * chartW);
        const toY = (v) => padding.top + chartH - (v / maxY) * chartH;

        let svgContent = '';
        const gridVals = [...new Set([0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * maxY)))];
        gridVals.forEach((val) => {
            const y = toY(val);
            svgContent += `<line x1="${padding.left}" y1="${y}" x2="${W - padding.right}" y2="${y}" stroke="rgba(255,255,255,0.12)" stroke-width="0.6"/>`;
            svgContent += `<text x="${padding.left - 4}" y="${y + 3}" text-anchor="end" fill="rgba(255,255,255,0.5)" font-size="8">${val}</text>`;
        });

        series.forEach((s) => {
            let path = '';
            s.values.forEach((v, idx) => {
                if (v == null) return;
                const cmd = path ? 'L' : 'M';
                path += `${cmd}${toX(idx)} ${toY(v)} `;
            });
            if (path) svgContent += `<path d="${path.trim()}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
            s.values.forEach((v, idx) => {
                if (v == null) return;
                svgContent += `<circle cx="${toX(idx)}" cy="${toY(v)}" r="2" fill="${s.color}"/>`;
            });
        });

        const tickIndexes = state.chartRange === 'weekly'
            ? labels.map((_, i) => i)
            : labels.reduce((acc, _, i) => { const day = i + 1; if (day === 1 || day % 5 === 0) acc.push(i); return acc; }, []);

        tickIndexes.forEach((idx) => {
            const d = new Date(labels[idx] + 'T00:00:00');
            const txt = state.chartRange === 'weekly' ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getDate()}일`;
            svgContent += `<text x="${toX(idx)}" y="${H - 8}" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="8">${txt}</text>`;
        });

        svg.innerHTML = svgContent;
        if (legend) {
            legend.innerHTML = series.map((s) => `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${s.color};display:inline-block;"></span>${s.name}</span>`).join('');
        }
    }

    function render() {
        const history = AppState.questHistory || {};
        syncSingleSelectionFromMulti();
        const emptyEl = document.getElementById('qstats-empty-state');
        if (emptyEl) emptyEl.classList.toggle('d-none', Object.keys(history).length > 0);
        renderQstatsCalendar(); renderQstatsDailyDropdown(); renderQstatsDiyDropdown();
        const y = state.month.getFullYear(); const m = state.month.getMonth();
        renderMonthlySummary(y, m, history); renderMonthlyHeatmap(y, m, history); renderTrendChart(history);
        const lang = AppState.currentLang;
        const monthNames = i18n[lang]?.month_names_short || ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
        const monthLabel = document.getElementById('qstats-month-label'); if (monthLabel) monthLabel.textContent = `${y} ${monthNames[m]}`;
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
        window.closeQstatsMonthly = () => { const w = document.getElementById('qstats-weekly-card'); const m = document.getElementById('qstats-monthly-card'); if (w) w.classList.remove('d-none'); if (m) m.classList.add('d-none'); state.chartRange = 'weekly'; renderQstatsCalendar(); renderTrendChart(AppState.questHistory || {}); };
        window.selectQstatsDate = (dateStr) => { state.selectedDate = (state.selectedDate === dateStr) ? null : dateStr; render(); };
        window.toggleQstatsDailyDropdown = () => document.getElementById('qstats-daily-dropdown-menu')?.classList.toggle('d-none');
        window.toggleQstatsDailyQuest = (dow, idx) => {
            const key = `${dow}:${idx}`;
            if (state.selectedDailyKeys.length === 0) {
                const quests = weeklyQuestData[dow] || [];
                state.selectedDailyKeys = quests.map((_, i) => `${dow}:${i}`).filter(k => k !== key);
            } else {
                toggleMultiSelection(state.selectedDailyKeys, key);
                const quests = weeklyQuestData[dow] || [];
                const allKeys = quests.map((_, i) => `${dow}:${i}`);
                if (allKeys.length > 0 && allKeys.every(k => state.selectedDailyKeys.includes(k))) state.selectedDailyKeys = [];
            }
            state.selectedDate = null; state.selectedDiyIds = []; render();
        };
        window.clearQstatsDailySelection = () => { state.selectedDailyKeys = []; state.selectedDate = null; render(); };
        window.toggleQstatsDailyAll = (checked) => { if (checked) state.selectedDailyKeys = []; state.selectedDate = null; render(); };

        window.toggleQstatsDiyDropdown = () => document.getElementById('qstats-diy-dropdown-menu')?.classList.toggle('d-none');
        window.toggleQstatsDiyQuest = (questId) => {
            if (state.selectedDiyIds.length === 0) {
                const defs = AppState.diyQuests.definitions;
                state.selectedDiyIds = defs.map(q => q.id).filter(id => id !== questId);
            } else {
                toggleMultiSelection(state.selectedDiyIds, questId);
                const defs = AppState.diyQuests.definitions;
                if (defs.length > 0 && defs.every(q => state.selectedDiyIds.includes(q.id))) state.selectedDiyIds = [];
            }
            state.selectedDate = null; state.selectedDailyKeys = []; render();
        };
        window.clearQstatsDiySelection = () => { state.selectedDiyIds = []; state.selectedDate = null; render(); };
        window.toggleQstatsDiyAll = (checked) => { if (checked) state.selectedDiyIds = []; state.selectedDate = null; render(); };
        window.setQstatsChartRange = (range) => { state.chartRange = range === 'weekly' ? 'weekly' : 'monthly'; render(); };
    }

    function showMonthly() { const w = document.getElementById('qstats-weekly-card'); const m = document.getElementById('qstats-monthly-card'); if (w) w.classList.add('d-none'); if (m) m.classList.remove('d-none'); state.chartRange = 'monthly'; render(); }

    function handlePrevMonth() { state.month.setMonth(state.month.getMonth() - 1); state.selectedDate = null; render(); }
    function handleNextMonth() { state.month.setMonth(state.month.getMonth() + 1); state.selectedDate = null; render(); }
    function handleDiyFilterChange(e) { state.diyOnly = e.target.checked; render(); }

    return { init: bindWindowHandlers, bindWindowHandlers, render, handlePrevMonth, handleNextMonth, handleDiyFilterChange, renderQstatsCalendar };
}
