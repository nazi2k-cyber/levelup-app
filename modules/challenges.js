// --- 주간 도전과제 & 일일 보너스 룰렛 ---
// app.js에서 분리된 challenges 모듈

import { AppState, getWeekStartDate } from "./core/state.js";
import { getTodayKST, getMsUntilNextKSTMidnight, formatCountdown } from "./core/utils.js";

// --- ★ P3: 주간 도전과제 시스템 ★ ---
const weeklyChallengeTemplates = [
    { id: 'quest_count', target: 30, reward: { points: 300, stat: 'random', statVal: 2.0 },
      name: { ko: '퀘스트 마스터', en: 'Quest Master', ja: 'クエストマスター' },
      desc: { ko: '이번 주 퀘스트 30개 완료', en: 'Complete 30 quests this week', ja: '今週クエスト30個完了' } },
    { id: 'streak_days', target: 5, reward: { points: 200, stat: 'random', statVal: 1.5 },
      name: { ko: '연속 접속 달인', en: 'Streak Champion', ja: 'ストリーク達人' },
      desc: { ko: '이번 주 5일 연속 접속', en: 'Login 5 days in a row this week', ja: '今週5日連続ログイン' } },
    { id: 'dungeon_clear', target: 3, reward: { points: 250, stat: 'random', statVal: 1.5 },
      name: { ko: '던전 헌터', en: 'Dungeon Hunter', ja: 'ダンジョンハンター' },
      desc: { ko: '이번 주 던전 3회 클리어', en: 'Clear dungeons 3 times this week', ja: '今週ダンジョン3回クリア' } },
    { id: 'planner_use', target: 4, reward: { points: 150, stat: 'agi', statVal: 1.0 },
      name: { ko: '계획의 달인', en: 'Planner Pro', ja: '計画の達人' },
      desc: { ko: '이번 주 플래너 4회 저장', en: 'Save planner 4 times this week', ja: '今週プランナー4回保存' } },
    { id: 'all_clear_days', target: 2, reward: { points: 400, stat: 'random', statVal: 3.0 },
      name: { ko: '올클리어 챔피언', en: 'All-Clear Champion', ja: 'オールクリアチャンピオン' },
      desc: { ko: '이번 주 일일 올클리어 2회', en: '2 daily all-clears this week', ja: '今週デイリーオールクリア2回' } },
    { id: 'critical_hits', target: 3, reward: { points: 200, stat: 'random', statVal: 1.0 },
      name: { ko: '행운아', en: 'Lucky Strike', ja: 'ラッキーストライク' },
      desc: { ko: '이번 주 크리티컬 히트 3회', en: '3 critical hits this week', ja: '今週クリティカルヒット3回' } }
];

function getWeeklyChallenges() {
    const weekStart = getWeekStartDate();
    const storageKey = 'weekly_challenges';
    let data;
    try { data = JSON.parse(localStorage.getItem(storageKey)); } catch(e) { data = null; }

    if (!data || data.weekStart !== weekStart) {
        // 새 주: 6개 중 랜덤 3개 선택
        const shuffled = [...weeklyChallengeTemplates].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, 3);
        data = {
            weekStart,
            challenges: selected.map(c => ({ ...c, progress: 0, claimed: false }))
        };
        localStorage.setItem(storageKey, JSON.stringify(data));
    }
    return data;
}

function updateChallengeProgress(challengeId, increment = 1) {
    const data = getWeeklyChallenges();
    const ch = data.challenges.find(c => c.id === challengeId);
    if (ch && !ch.claimed) {
        ch.progress = Math.min(ch.target, ch.progress + increment);
        localStorage.setItem('weekly_challenges', JSON.stringify(data));
    }
}

function renderWeeklyChallenges() {
    const container = document.getElementById('challenge-list');
    if (!container) return;

    const lang = AppState.currentLang;
    const data = getWeeklyChallenges();

    container.innerHTML = data.challenges.map((ch, idx) => {
        const pct = Math.min(100, Math.round((ch.progress / ch.target) * 100));
        const done = ch.progress >= ch.target;
        const name = ch.name[lang] || ch.name.ko;
        const desc = ch.desc[lang] || ch.desc.ko;

        return `<div class="challenge-item ${done ? 'done' : ''}">
            <div class="challenge-info">
                <div class="challenge-name">${name}</div>
                <div class="challenge-desc">${desc}</div>
                <div class="challenge-bar-bg">
                    <div class="challenge-bar-fill" style="width:${pct}%"></div>
                </div>
                <div class="challenge-progress-text">${ch.progress}/${ch.target}</div>
            </div>
            <div class="challenge-action">
                ${done && !ch.claimed ? `<button class="challenge-claim-btn" onclick="window.claimChallenge(${idx})">${i18n[lang].challenge_reward}</button>` : ''}
                ${ch.claimed ? `<span class="challenge-claimed">${i18n[lang].challenge_claimed}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

window.claimChallenge = function(idx) {
    const data = getWeeklyChallenges();
    const ch = data.challenges[idx];
    if (!ch || ch.claimed || ch.progress < ch.target) return;

    ch.claimed = true;
    localStorage.setItem('weekly_challenges', JSON.stringify(data));

    AppState.user.points += ch.reward.points;
    const stat = ch.reward.stat === 'random' ? statKeys[Math.floor(Math.random() * statKeys.length)] : ch.reward.stat;
    AppState.user.pendingStats[stat] += ch.reward.statVal;

    window.saveUserData();
    window.updatePointUI();
    renderWeeklyChallenges();

    const lang = AppState.currentLang;
    alert(`${ch.name[lang] || ch.name.ko} ${i18n[lang].challenge_complete}\n+${ch.reward.points}P, ${stat.toUpperCase()} +${ch.reward.statVal}`);
};

// --- ★ P4: 일일 보너스 룰렛 ★ ---
const rouletteSlots = [
    { label: { ko: '+30P', en: '+30P', ja: '+30P' }, reward: { type: 'points', value: 30 }, color: '#444' },
    { label: { ko: '+80P', en: '+80P', ja: '+80P' }, reward: { type: 'points', value: 80 }, color: '#0088ff' },
    { label: { ko: '+150P', en: '+150P', ja: '+150P' }, reward: { type: 'points', value: 150 }, color: '#ff6a00' },
    { label: { ko: 'STR+1', en: 'STR+1', ja: 'STR+1' }, reward: { type: 'stat', stat: 'str', value: 1.0 }, color: '#ff3c3c' },
    { label: { ko: 'INT+1', en: 'INT+1', ja: 'INT+1' }, reward: { type: 'stat', stat: 'int', value: 1.0 }, color: '#00d9ff' },
    { label: { ko: '+50P', en: '+50P', ja: '+50P' }, reward: { type: 'points', value: 50 }, color: '#555' },
    { label: { ko: 'ALL+0.5', en: 'ALL+0.5', ja: 'ALL+0.5' }, reward: { type: 'stat', stat: 'all', value: 0.5 }, color: '#ffcc00' },
    { label: { ko: '+200P', en: '+200P', ja: '+200P' }, reward: { type: 'points', value: 200 }, color: '#ff00ff' },
];

function canSpinRoulette() {
    const today = getTodayKST();
    if (localStorage.getItem('roulette_date') === today) return 'used';
    // 오늘 퀘스트 1개 이상 완료했는지 확인
    const day = AppState.quest.currentDayOfWeek;
    const anyDone = AppState.quest.completedState[day].some(v => v);
    return anyDone ? 'ready' : 'locked';
}

// KST 자정까지 남은 시간(ms) 계산
function getMsUntilNextKSTMidnight() {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset + now.getTimezoneOffset() * 60 * 1000);
    const kstTomorrow = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate() + 1, 0, 0, 0, 0);
    return kstTomorrow.getTime() - kstNow.getTime();
}

// 남은 시간을 HH:MM:SS 포맷으로 변환
function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

let _rouletteTimerInterval = null;

function startRouletteTimer() {
    stopRouletteTimer();
    const timerEl = document.getElementById('roulette-timer');
    if (!timerEl) return;

    function tick() {
        const ms = getMsUntilNextKSTMidnight();
        const lang = AppState.currentLang;
        timerEl.textContent = `${i18n[lang].roulette_next_spin} ${formatCountdown(ms)}`;
        timerEl.style.display = '';
        // 자정이 되면 룰렛 상태 갱신
        if (ms <= 1000) {
            stopRouletteTimer();
            setTimeout(() => renderRoulette(), 1100);
        }
    }
    tick();
    _rouletteTimerInterval = setInterval(tick, 1000);
}

function stopRouletteTimer() {
    if (_rouletteTimerInterval) {
        clearInterval(_rouletteTimerInterval);
        _rouletteTimerInterval = null;
    }
}

function renderRoulette() {
    const container = document.getElementById('roulette-container');
    if (!container) return;

    const lang = AppState.currentLang;
    const status = canSpinRoulette();
    const canvas = document.getElementById('roulette-canvas');

    // 캔버스에 룰렛 그리기
    if (canvas) drawRouletteWheel(canvas);

    const btn = document.getElementById('btn-roulette-spin');
    const statusText = document.getElementById('roulette-status');
    const timerEl = document.getElementById('roulette-timer');
    if (btn && statusText) {
        if (status === 'ready') {
            btn.disabled = false;
            btn.textContent = i18n[lang].roulette_spin;
            btn.style.opacity = '1';
            statusText.textContent = i18n[lang].roulette_desc;
            statusText.style.color = 'var(--neon-gold)';
            stopRouletteTimer();
            if (timerEl) timerEl.style.display = 'none';
        } else if (status === 'used') {
            btn.disabled = true;
            btn.textContent = i18n[lang].roulette_used;
            btn.style.opacity = '0.4';
            statusText.textContent = i18n[lang].roulette_used;
            statusText.style.color = 'var(--text-sub)';
            startRouletteTimer();
        } else {
            btn.disabled = true;
            btn.textContent = i18n[lang].roulette_spin;
            btn.style.opacity = '0.4';
            statusText.textContent = i18n[lang].roulette_locked;
            statusText.style.color = 'var(--text-sub)';
            stopRouletteTimer();
            if (timerEl) timerEl.style.display = 'none';
        }
    }
}

function drawRouletteWheel(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 4;
    const slotCount = rouletteSlots.length;
    const arc = (2 * Math.PI) / slotCount;
    const lang = AppState.currentLang;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < slotCount; i++) {
        const angle = i * arc - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, angle, angle + arc);
        ctx.closePath();
        ctx.fillStyle = rouletteSlots[i].color;
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 텍스트
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle + arc / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(rouletteSlots[i].label[lang] || rouletteSlots[i].label.ko, r * 0.6, 4);
        ctx.restore();
    }

    // 중심 원
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, 2 * Math.PI);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.strokeStyle = 'var(--neon-gold)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

window.spinRoulette = function() {
    if (canSpinRoulette() !== 'ready') return;

    const today = getTodayKST();
    localStorage.setItem('roulette_date', today);

    const canvas = document.getElementById('roulette-canvas');
    if (!canvas) return;

    // 결과 결정 (가중치 기반)
    const weights = [20, 15, 5, 12, 12, 18, 3, 5]; // 각 슬롯 확률
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalWeight;
    let resultIdx = 0;
    for (let i = 0; i < weights.length; i++) {
        roll -= weights[i];
        if (roll <= 0) { resultIdx = i; break; }
    }

    // 스핀 애니메이션
    const slotCount = rouletteSlots.length;
    const arc = 360 / slotCount;
    // 결과 슬롯 중앙을 가리키도록 회전 (상단 화살표 기준)
    const targetAngle = 360 - (resultIdx * arc + arc / 2);
    const totalRotation = 360 * 5 + targetAngle; // 5바퀴 + 결과 위치

    const btn = document.getElementById('btn-roulette-spin');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    canvas.style.transition = 'transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
    canvas.style.transform = `rotate(${totalRotation}deg)`;

    setTimeout(() => {
        // 보상 적용
        const slot = rouletteSlots[resultIdx];
        if (slot.reward.type === 'points') {
            AppState.user.points += slot.reward.value;
        } else if (slot.reward.type === 'stat') {
            if (slot.reward.stat === 'all') {
                statKeys.forEach(k => { AppState.user.pendingStats[k] += slot.reward.value; });
            } else {
                AppState.user.pendingStats[slot.reward.stat] += slot.reward.value;
            }
        }

        window.saveUserData();
        window.updatePointUI();
        renderRoulette();

        const lang = AppState.currentLang;
        const rewardText = slot.label[lang] || slot.label.ko;
        alert(`${i18n[lang].roulette_result} ${rewardText}`);

        // ★ 보상형 전면 광고 — 스핀 보상 2배 기회
        localStorage.setItem('_ri_last_spin_idx', String(resultIdx));
        const isNativePlatform = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        if (window._rewardedInterstitialReady && isNativePlatform) {
            const watchAd = confirm(i18n[lang].ri_spin_prompt || '광고를 시청하면 보상을 한 번 더 받을 수 있습니다. 시청하시겠습니까?');
            if (watchAd) {
                window.showRewardedInterstitial('spin');
            }
        }

        // 캔버스 리셋 (애니메이션 후 각도 유지)
        canvas.style.transition = 'none';
        canvas.style.transform = `rotate(${targetAngle}deg)`;
    }, 3200);
};

// app.js에서 호출하는 함수들을 window에 등록
window.getWeeklyChallenges = getWeeklyChallenges;
window.renderWeeklyChallenges = renderWeeklyChallenges;
window.renderRoulette = renderRoulette;
window.formatCountdown = formatCountdown;
