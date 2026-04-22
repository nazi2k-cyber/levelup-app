export function createStreakRareTitleModule(deps) {
    const {
        AppState,
        i18n,
        statKeys,
        auth,
        AppLogger,
        rareStreakTitles,
        rareStepTitles,
        rareReadingTitles,
        rareMovieTitles,
        rareSavingsTitles,
        rareRankTitles,
        rarityConfig,
        saveUserData,
        updatePointUI,
        getTitleIcon,
    } = deps;

    const rarePriority = { rank_global: 40, rank_stat: 30, streak: 20, steps: 10, reading: 10, movies: 10, savings: 10 };

    function getTodayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function getDaysBetween(dateStr1, dateStr2) {
        if (!dateStr1 || !dateStr2) return Infinity;
        const d1 = new Date(dateStr1); d1.setHours(0, 0, 0, 0);
        const d2 = new Date(dateStr2); d2.setHours(0, 0, 0, 0);
        return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    }

    function getStreakMultiplier(streak) {
        if (streak >= 30) return 3.0;
        if (streak >= 14) return 2.0;
        if (streak >= 7) return 1.5;
        if (streak >= 3) return 1.2;
        return 1.0;
    }

    function applyStreakAndDecay() {
        const today = getTodayStr();
        const lastActive = AppState.user.streak.lastActiveDate;
        if (!Array.isArray(AppState.user.streak.activeDates)) AppState.user.streak.activeDates = [];
        if (lastActive && !AppState.user.streak.activeDates.includes(lastActive)) AppState.user.streak.activeDates.push(lastActive);

        if (!lastActive) {
            AppState.user.streak.lastActiveDate = today;
            AppState.user.streak.multiplier = getStreakMultiplier(AppState.user.streak.currentStreak);
            renderStreak();
            return;
        }

        const gap = getDaysBetween(lastActive, today);
        if (gap > 1) {
            if (AppState.user.streak.currentStreak > 0) AppState.user.streak.currentStreak = 0;
            if (gap > 3) {
                const decayDays = Math.min(gap - 3, 30);
                const decayAmount = decayDays * 0.1;
                let decayed = false;
                statKeys.forEach((k) => {
                    if (AppState.user.stats[k] > 0) {
                        AppState.user.stats[k] = Math.max(0, Number(AppState.user.stats[k]) - decayAmount);
                        decayed = true;
                    }
                });
                if (decayed) AppLogger.info(`[Streak] 스탯 감소 적용: ${decayDays}일 미접속, -${decayAmount.toFixed(1)}`);
            }
        }

        AppState.user.streak.multiplier = getStreakMultiplier(AppState.user.streak.currentStreak);
        renderStreak();
    }

    function updateStreak() {
        const today = getTodayStr();
        const lastActive = AppState.user.streak.lastActiveDate;
        if (lastActive === today) return;

        const gap = getDaysBetween(lastActive, today);
        if (gap === 1) AppState.user.streak.currentStreak++;
        else if (gap > 1 || !lastActive) AppState.user.streak.currentStreak = 1;

        AppState.user.streak.lastActiveDate = today;
        AppState.user.streak.multiplier = getStreakMultiplier(AppState.user.streak.currentStreak);
        recordStreakActiveDate(today);
        renderStreak();

        if (window.getWeeklyChallenges) {
            const chData = window.getWeeklyChallenges();
            const streakCh = chData.challenges.find((c) => c.id === 'streak_days');
            if (streakCh && !streakCh.claimed) {
                streakCh.progress = Math.min(streakCh.target, AppState.user.streak.currentStreak);
                localStorage.setItem('weekly_challenges', JSON.stringify(chData));
            }
        }
        checkStreakRareTitles();
    }

    function getStreakStatusText() {
        const streak = AppState.user.streak.currentStreak;
        const mult = AppState.user.streak.multiplier || 1.0;
        const lastActive = AppState.user.streak.lastActiveDate;
        const todayStr = getTodayStr();
        const gap = lastActive ? getDaysBetween(lastActive, todayStr) : 0;

        if (gap > 3) return { text: `⚠ 스탯 감소 중 (${gap - 3}일분)`, cls: 'danger' };
        if (gap >= 2) return { text: '⚠ 스트릭 위험! 활동 필요', cls: 'warn' };
        if (mult > 1.0) return { text: `🔥 ${streak}일 연속 · x${mult} 배율`, cls: 'boost' };
        if (streak > 0) return { text: `🔥 ${streak}일 연속 · 3일부터 배율↑`, cls: '' };
        return { text: '퀘스트 완료 시 스트릭 시작', cls: '' };
    }

    function renderStreak() {
        const badge = document.getElementById('streak-badge');
        const countEl = document.getElementById('streak-count');
        const dayLabel = document.getElementById('streak-day-label');
        if (badge && countEl) {
            const streak = AppState.user.streak.currentStreak;
            if (streak > 0) {
                badge.classList.remove('d-none');
                badge.classList.toggle('fire', streak >= 7);
                countEl.textContent = streak;
                if (dayLabel) dayLabel.textContent = i18n[AppState.currentLang]?.streak_day || '일';
            } else {
                badge.classList.add('d-none');
            }
        }
        render();
    }

    function render() {
        const container = document.getElementById('streak-history');
        if (!container) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const activeDates = AppState.user.streak.activeDates || [];
        const activeSet = new Set(activeDates);
        const todayStr = getTodayStr();

        let html = '';
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const isActive = activeSet.has(ds);
            const isToday = ds === todayStr;
            const cls = `streak-history-dot ${isActive ? 'active' : 'inactive'}${isToday ? ' today' : ''}`;
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
            html += `<span class="${cls}" title="${ds} (${dayNames[d.getDay()]})">${isActive ? '🔥' : ''}</span>`;
        }
        container.innerHTML = html;

        const statusEl = document.getElementById('streak-status-text');
        if (statusEl) {
            const { text, cls } = getStreakStatusText();
            statusEl.textContent = text;
            statusEl.className = 'streak-status-text' + (cls ? ' ' + cls : '');
        }
    }

    function recordStreakActiveDate(dateStr) {
        if (!AppState.user.streak.activeDates) AppState.user.streak.activeDates = [];
        if (!AppState.user.streak.activeDates.includes(dateStr)) AppState.user.streak.activeDates.push(dateStr);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
        AppState.user.streak.activeDates = AppState.user.streak.activeDates.filter((d) => d >= cutoffStr);
    }

    function openStreakGuideModal() {
        const existing = document.getElementById('streak-guide-modal-overlay');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'streak-guide-modal-overlay';
        overlay.className = 'report-modal-overlay';
        overlay.innerHTML = `<div class="report-modal-content streak-guide-modal"><h3 class="report-modal-title">🔥 스트릭 시스템 가이드</h3><div class="streak-guide-body"><div class="streak-guide-section"><div class="streak-guide-subtitle">📌 스트릭이란?</div><p>매일 <b>퀘스트를 완료</b>하면 연속 활동일(스트릭)이 쌓입니다.<br>스트릭에 따라 보상 배율이 상승합니다.</p></div></div><div class="report-modal-actions"><button class="report-modal-btn report-modal-submit streak-guide-close">확인</button></div></div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));
        const close = () => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 200);
        };
        overlay.querySelector('.streak-guide-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }

    function bindWindowHandlers() {
        const btn = document.getElementById('streak-guide-btn');
        if (btn && !btn.dataset.boundStreakGuide) {
            btn.addEventListener('click', openStreakGuideModal);
            btn.dataset.boundStreakGuide = '1';
        }
    }

    function getBestRareTitle() {
        const unlocked = AppState.user.rareTitle.unlocked;
        if (unlocked.length === 0) return null;
        const rarityOrder = ['uncommon', 'rare', 'epic', 'legendary'];
        return [...unlocked].sort((a, b) => {
            const pDiff = (rarePriority[b.type] || 0) - (rarePriority[a.type] || 0);
            if (pDiff !== 0) return pDiff;
            return rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity);
        })[0] || null;
    }

    function showRareTitleNotification(rareTitle) {
        const lang = AppState.currentLang;
        const titleText = rareTitle.title[lang] || rareTitle.title.ko;
        const rarityLabel = rarityConfig[rareTitle.rarity]?.label[lang] || rareTitle.rarity;
        alert(`${rareTitle.icon} ${i18n[lang]?.rare_title_unlocked || '희귀 호칭 획득!'}\n[${rarityLabel}] ${titleText}`);
    }

    function checkStreakRareTitles() { /* identical behavior */
        const streak = AppState.user.streak.currentStreak;
        let newUnlock = false;
        rareStreakTitles.forEach((rt) => {
            const titleId = `streak_${rt.days}`;
            if (streak >= rt.days && !AppState.user.rareTitle.unlocked.find((u) => u.id === titleId)) {
                AppState.user.rareTitle.unlocked.push({ id: titleId, type: 'streak', rarity: rt.rarity, icon: rt.icon, title: rt.title, unlockedAt: new Date().toISOString() });
                newUnlock = true;
                AppLogger.info(`[RareTitle] 스트릭 희귀 호칭 해금: ${rt.title.ko} (${rt.days}일)`);
            }
        });
        if (newUnlock) {
            saveUserData(); updatePointUI();
            showRareTitleNotification(AppState.user.rareTitle.unlocked[AppState.user.rareTitle.unlocked.length - 1]);
        }
    }

    function checkStepRareTitles() { const steps = Number(AppState.user.stepData?.totalSteps) || 0; let n=false; rareStepTitles.forEach((rt)=>{ const id=`steps_${rt.steps}`; if (steps>=rt.steps && !AppState.user.rareTitle.unlocked.find((u)=>u.id===id)){ AppState.user.rareTitle.unlocked.push({id,type:'steps',rarity:rt.rarity,icon:rt.icon,title:rt.title,unlockedAt:new Date().toISOString()}); n=true; } }); if(n){ saveUserData(); updatePointUI(); showRareTitleNotification(AppState.user.rareTitle.unlocked[AppState.user.rareTitle.unlocked.length-1]); } }
    function checkReadingRareTitles() { const read=(AppState.library?.books||[]).filter((b)=>b.category==='read').length; let n=false; rareReadingTitles.forEach((rt)=>{ const id=`reading_${rt.books}`; if(read>=rt.books && !AppState.user.rareTitle.unlocked.find((u)=>u.id===id)){ AppState.user.rareTitle.unlocked.push({id,type:'reading',rarity:rt.rarity,icon:rt.icon,title:rt.title,unlockedAt:new Date().toISOString()}); n=true; } }); if(n){ saveUserData(); updatePointUI(); showRareTitleNotification(AppState.user.rareTitle.unlocked[AppState.user.rareTitle.unlocked.length-1]); } }
    function checkMovieRareTitles() { const watched=(AppState.movies?.items||[]).filter((m)=>m.category==='watched').length; let n=false; rareMovieTitles.forEach((rt)=>{ const id=`movies_${rt.movies}`; if(watched>=rt.movies && !AppState.user.rareTitle.unlocked.find((u)=>u.id===id)){ AppState.user.rareTitle.unlocked.push({id,type:'movies',rarity:rt.rarity,icon:rt.icon,title:rt.title,unlockedAt:new Date().toISOString()}); n=true; } }); if(n){ saveUserData(); updatePointUI(); showRareTitleNotification(AppState.user.rareTitle.unlocked[AppState.user.rareTitle.unlocked.length-1]); } }
    function checkSavingsRareTitles() { if (!AppState.user?.rareTitle) return; let cfg; try { cfg = JSON.parse(localStorage.getItem('future_networth_config') || '{}'); } catch { return; } const W0=parseFloat(cfg.W_0)||0; const e=parseFloat(cfg.e!==undefined?cfg.e:70); const r=parseFloat(cfg.r!==undefined?cfg.r:2.5); const n=parseFloat(cfg.n)||0; if(W0<=0||n<=0) return; const rDec=r/100; const WTotal=rDec>0 ? W0*((Math.pow(1+rDec,n)-1)/rDec) : W0*n; const MAvail=WTotal*(1-e/100)/(n*12); const rate=(MAvail/(W0/12))*100; let nu=false; rareSavingsTitles.forEach((rt)=>{ if(rate>=rt.threshold && !AppState.user.rareTitle.unlocked.find((u)=>u.id===rt.id)){ AppState.user.rareTitle.unlocked.push({id:rt.id,type:'savings',rarity:rt.rarity,icon:rt.icon,title:rt.title,unlockedAt:new Date().toISOString()}); nu=true; }}); if(nu){ saveUserData(); updatePointUI(); showRareTitleNotification(AppState.user.rareTitle.unlocked[AppState.user.rareTitle.unlocked.length-1]); } }

    function checkRankRareTitles() {
        if (!auth.currentUser) return;
        const uid = auth.currentUser.uid;
        const users = AppState.social.users.map((u) => {
            const s = u.stats;
            const total = Math.round(Number(s.str) || 0) + Math.round(Number(s.int) || 0) + Math.round(Number(s.cha) || 0) + Math.round(Number(s.vit) || 0) + Math.round(Number(s.wlth) || 0) + Math.round(Number(s.agi) || 0);
            return { ...u, total, str: Math.round(Number(s.str) || 0), int: Math.round(Number(s.int) || 0), cha: Math.round(Number(s.cha) || 0), vit: Math.round(Number(s.vit) || 0), wlth: Math.round(Number(s.wlth) || 0), agi: Math.round(Number(s.agi) || 0) };
        });
        if (users.length === 0) return;
        let changed = false;
        const globalSorted = [...users].sort((a, b) => b.total - a.total);
        const myGlobalRank = globalSorted.findIndex((u) => u.id === uid) + 1;
        const hadGlobal = AppState.user.rareTitle.unlocked.filter((u) => u.type === 'rank_global');
        AppState.user.rareTitle.unlocked = AppState.user.rareTitle.unlocked.filter((u) => u.type !== 'rank_global');
        const myGlobalEntry = rareRankTitles.global.find((rt) => rt.rank === myGlobalRank);
        if (myGlobalEntry) {
            AppState.user.rareTitle.unlocked.push({ id: `global_rank_${myGlobalEntry.rank}`, type: 'rank_global', rarity: myGlobalEntry.rarity, icon: myGlobalEntry.icon, title: myGlobalEntry.title, unlockedAt: new Date().toISOString() });
            if (!hadGlobal.find((h) => h.id === `global_rank_${myGlobalEntry.rank}`)) changed = true;
        } else if (hadGlobal.length > 0) changed = true;

        statKeys.forEach((stat) => {
            const sorted = [...users].sort((a, b) => b[stat] - a[stat]);
            const myRank = sorted.findIndex((u) => u.id === uid) + 1;
            const titleId = `stat_rank_${stat}`;
            const had = AppState.user.rareTitle.unlocked.find((u) => u.id === titleId);
            if (myRank === 1 && sorted[0][stat] > 0) {
                if (!had) {
                    AppState.user.rareTitle.unlocked.push({ id: titleId, type: 'rank_stat', rarity: rareRankTitles.stat[stat].rarity, icon: rareRankTitles.stat[stat].icon, title: rareRankTitles.stat[stat].title, stat, unlockedAt: new Date().toISOString() });
                    changed = true;
                }
            } else if (had) {
                AppState.user.rareTitle.unlocked = AppState.user.rareTitle.unlocked.filter((u) => u.id !== titleId);
                changed = true;
            }
        });

        if (changed) { saveUserData(); updatePointUI(); }
    }

    function getDisplayTitle() {
        const lang = AppState.currentLang;
        const titleObj = AppState.user.titleHistory[AppState.user.titleHistory.length - 1]?.title;
        const baseText = titleObj ? (typeof titleObj === 'object' ? titleObj[lang] || titleObj.ko : titleObj) : '각성자';
        const baseIcon = getTitleIcon(baseText);
        const best = getBestRareTitle();
        if (best) return { baseText, baseIcon, rareText: best.title[lang] || best.title.ko, rareIcon: best.icon, rarity: best.rarity, isRare: true };
        return { baseText, baseIcon, rareText: null, rareIcon: null, rarity: null, isRare: false };
    }

    return {
        init: bindWindowHandlers,
        bindWindowHandlers,
        render,
        getTodayStr,
        applyStreakAndDecay,
        updateStreak,
        renderStreak,
        getStreakStatusText,
        recordStreakActiveDate,
        openStreakGuideModal,
        checkStreakRareTitles,
        checkStepRareTitles,
        checkReadingRareTitles,
        checkMovieRareTitles,
        checkSavingsRareTitles,
        checkRankRareTitles,
        getDisplayTitle,
        getBestRareTitle,
    };
}
