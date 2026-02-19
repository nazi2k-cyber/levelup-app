// --- 상태 관리 객체 ---
const AppState = {
    isLoginMode: true,
    currentLang: 'ko',
    user: {
        level: 1,
        points: 50,
        stats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
        pendingStats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
        titleHistory: [
            { level: 1, title: { ko: "신규 각성자", en: "New Awakened", ja: "新規覚醒者" } }
        ]
    },
    quest: {
        currentDayOfWeek: new Date().getDay(),
        completedState: Array.from({length: 7}, () => Array(12).fill(false))
    },
    social: {
        mode: 'global',
        sortCriteria: 'total',
        users: []
    },
    dungeon: { lastGeneratedDate: null, slot: 0, stationIdx: 0, participants: 4, isJoined: false },
};

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    bindEvents(); // 버튼과 기능 연결
});

// --- 초기화 및 로컬 데이터 불러오기 ---
function initApp() {
    // 1. 저장된 테마(라이트/다크) 불러오기
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.getElementById('theme-toggle').checked = true;
        document.documentElement.setAttribute('data-theme', 'light');
    }

    // 2. 저장된 유저 데이터(레벨, 포인트, 스탯) 불러오기
    const savedUser = localStorage.getItem('userData');
    if (savedUser) {
        AppState.user = JSON.parse(savedUser);
    }
    
    // 3. 저장된 퀘스트 진척도 불러오기
    const savedQuest = localStorage.getItem('questData');
    if (savedQuest) {
        AppState.quest.completedState = JSON.parse(savedQuest);
    }

    // 소셜 데이터 세팅 (나의 정보 추가)
    AppState.social.users = JSON.parse(JSON.stringify(mockSocialData));
    AppState.social.users.push({
        id: 3, 
        name: {ko:"플레이어 (나)", en:"Player (Me)", ja:"プレイヤー (私)"}, 
        title: AppState.user.titleHistory[AppState.user.titleHistory.length - 1].title, 
        str: AppState.user.stats.str, int: AppState.user.stats.int, cha: AppState.user.stats.cha, 
        vit: AppState.user.stats.vit, wlth: AppState.user.stats.wlth, agi: AppState.user.stats.agi, 
        isMe: true, isFriend: false 
    });

    changeLanguage('ko');
    checkLoginStatus();
    setInterval(updateDungeonStatus, 60000); // 던전 타이머
    
    // 저장된 프로필 이미지 로드
    const savedImage = localStorage.getItem('profileImage');
    if(savedImage) document.getElementById('profilePreview').src = savedImage;
}

// --- 이벤트 리스너 연결 (HTML 버튼들과 JS 기능 맵핑) ---
function bindEvents() {
    // 로그인/인증
    document.getElementById('btn-login-submit').addEventListener('click', simulateLogin);
    document.getElementById('btn-google-login').addEventListener('click', simulateGoogleLogin);
    document.getElementById('auth-toggle-btn').addEventListener('click', toggleAuthMode);
    
    // 네비게이션 탭
    document.querySelectorAll('.nav-item').forEach(el => {
        el.addEventListener('click', () => switchTab(el.dataset.tab, el));
    });

    // 상태창 (레벨업 포함)
    document.getElementById('btn-edit-name').addEventListener('click', changePlayerName);
    document.getElementById('prof-title-badge').addEventListener('click', openTitleModal);
    document.getElementById('btn-history-close').addEventListener('click', closeTitleModal);
    document.getElementById('btn-levelup').addEventListener('click', processLevelUp); // 레벨업 기능 연결
    document.getElementById('imageUpload').addEventListener('change', loadProfileImage);

    // 소셜
    document.querySelectorAll('.social-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleSocialMode(btn.dataset.mode, btn));
    });
    document.querySelectorAll('.rank-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => renderUsers(btn.dataset.sort, btn));
    });

    // 설정 (테마 포함)
    document.getElementById('lang-select').addEventListener('change', (e) => changeLanguage(e.target.value));
    document.getElementById('theme-toggle').addEventListener('change', changeTheme); // 라이트/다크모드 기능 연결
    document.getElementById('gps-toggle').addEventListener('change', toggleGPS);
    document.getElementById('sync-toggle').addEventListener('change', toggleHealthSync);
    document.getElementById('btn-logout').addEventListener('click', logout);
}

// --- 데이터 저장 함수 ---
function saveUserData() {
    localStorage.setItem('userData', JSON.stringify(AppState.user));
    localStorage.setItem('questData', JSON.stringify(AppState.quest.completedState));
}

// --- 프로필 이미지 로드 ---
function loadProfileImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('profilePreview').src = e.target.result;
            localStorage.setItem('profileImage', e.target.result);
        };
        reader.readAsDataURL(file);
    }
}

// --- 라이트/다크모드 변경 로직 ---
function changeTheme() {
    const isLight = document.getElementById('theme-toggle').checked;
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : '');
    
    // 선택한 테마 로컬 스토리지에 저장
    localStorage.setItem('theme', isLight ? 'light' : 'dark');

    let themeMeta = document.querySelector('meta[name="theme-color"]') || document.createElement('meta');
    themeMeta.name = "theme-color"; themeMeta.content = isLight ? "#ffffff" : "#050508";
    document.head.appendChild(themeMeta);
}

// --- 레벨업 로직 ---
function getReqPoints(level) { return Math.floor(100 * Math.pow(1.5, level - 1)); }

function processLevelUp() {
    const reqPts = getReqPoints(AppState.user.level);
    
    if(AppState.user.points >= reqPts) {
        // 포인트 차감 및 레벨 증가
        AppState.user.points -= reqPts;
        AppState.user.level++;
        
        // 대기 스탯을 실제 스탯으로 반영
        statKeys.forEach(k => {
            AppState.user.stats[k] = Math.min(100, AppState.user.stats[k] + AppState.user.pendingStats[k]);
            AppState.user.pendingStats[k] = 0; // 대기 스탯 초기화
        });

        // 새로운 칭호 생성
        let sortedStats = statKeys.map(k => ({ key: k, val: AppState.user.stats[k] })).sort((a, b) => b.val - a.val);
        const top1 = sortedStats[0].key; const top2 = sortedStats[1].key; 
        const randPre = Math.floor(Math.random() * 3); const randSuf = Math.floor(Math.random() * 3);
        const newTitleObj = {
            ko: `${titleVocab[top1].ko.pre[randPre]} ${titleVocab[top2].ko.suf[randSuf]}`,
            en: `${titleVocab[top1].en.pre[randPre]} ${titleVocab[top2].en.suf[randSuf]}`,
            ja: `${titleVocab[top1].ja.pre[randPre]} ${titleVocab[top2].ja.suf[randSuf]}`
        };

        AppState.user.titleHistory.push({ level: AppState.user.level, title: newTitleObj });

        // 변경된 유저 데이터 저장
        saveUserData();

        // UI 갱신
        updatePointUI(); 
        drawRadarChart(); 
        renderUsers(AppState.social.sortCriteria);
        
        alert(`Level Up! [Lv.${AppState.user.level}]\n새로운 칭호 획득: ${newTitleObj[AppState.currentLang]}`);
    }
}

function updatePointUI() {
    const reqPts = getReqPoints(AppState.user.level);
    document.getElementById('sys-level').innerText = `Lv. ${AppState.user.level}`;
    document.getElementById('display-pts').innerText = AppState.user.points;
    document.getElementById('display-req-pts').innerText = reqPts;
    
    const btn = document.getElementById('btn-levelup');
    if(AppState.user.points >= reqPts) {
        btn.disabled = false; btn.style.background = "var(--neon-gold)"; btn.style.color = "black"; btn.style.boxShadow = "0 0 15px var(--neon-gold)";
    } else {
        btn.disabled = true; btn.style.background = "#444"; btn.style.color = "#777"; btn.style.boxShadow = "none";
    }
    
    document.getElementById('prof-title-badge').innerText = AppState.user.titleHistory[AppState.user.titleHistory.length - 1].title[AppState.currentLang];
    
    statKeys.forEach(k => {
        const pendEl = document.getElementById(`pendVal_${k}`);
        const pVal = AppState.user.pendingStats[k];
        if (pVal > 0) pendEl.textContent = `(+${pVal.toFixed(1).replace('.0', '')})`;
        else if (pVal < 0) pendEl.textContent = `(${pVal.toFixed(1).replace('.0', '')})`;
        else pendEl.textContent = "";
    });
}

// --- 로그인/인증 로직 ---
function checkLoginStatus() {
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (isLoggedIn === 'true') {
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('app-container').classList.remove('d-none');
        document.getElementById('app-container').classList.add('d-flex');
        
        loadPlayerName(); 
        changeLanguage(AppState.currentLang); 
        renderCalendar(); 
        updatePointUI(); 
        drawRadarChart(); 
        updateDungeonStatus();
    } else {
        document.getElementById('login-screen').classList.remove('d-none');
        document.getElementById('app-container').classList.remove('d-flex');
        document.getElementById('app-container').classList.add('d-none');
    }
}

function toggleAuthMode() {
    AppState.isLoginMode = !AppState.isLoginMode;
    const btnSubmit = document.getElementById('btn-login-submit');
    const toggleText = document.getElementById('auth-toggle-btn');
    const pwConfirm = document.getElementById('login-pw-confirm');
    const pwHint = document.getElementById('pw-hint');
    const disclaimerBox = document.getElementById('disclaimer-box');
    
    if(AppState.isLoginMode) {
        btnSubmit.setAttribute('data-i18n', 'btn_login_submit');
        toggleText.setAttribute('data-i18n', 'auth_toggle_signup');
        pwConfirm.classList.add('d-none'); pwHint.classList.add('d-none'); disclaimerBox.classList.add('d-none');
    } else {
        btnSubmit.setAttribute('data-i18n', 'btn_signup_submit');
        toggleText.setAttribute('data-i18n', 'auth_toggle_login');
        pwConfirm.classList.remove('d-none'); pwHint.classList.remove('d-none'); disclaimerBox.classList.remove('d-none');
    }
    changeLanguage(AppState.currentLang); 
}

function simulateLogin() {
    const email = document.getElementById('login-email').value;
    const pw = document.getElementById('login-pw').value;
    const pwConfirm = document.getElementById('login-pw-confirm').value;

    if(!email || !pw) { alert(i18n[AppState.currentLang].login_err_empty); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(!emailRegex.test(email)) { alert(i18n[AppState.currentLang].login_err_email); return; }

    if(!AppState.isLoginMode) {
        const hasUppercase = /[A-Z]/.test(pw);
        const specialChars = pw.match(/[^a-zA-Z0-9]/g) || [];
        if(pw.length < 8 || !hasUppercase || specialChars.length < 2) {
            alert(i18n[AppState.currentLang].login_err_pw_req); return;
        }
        if(pw !== pwConfirm) { alert(i18n[AppState.currentLang].pw_mismatch); return; }
    }

    localStorage.setItem('isLoggedIn', 'true');
    checkLoginStatus();
}

function simulateGoogleLogin() {
    localStorage.setItem('isLoggedIn', 'true'); checkLoginStatus();
}

function logout() {
    localStorage.removeItem('isLoggedIn');
    document.getElementById('login-email').value = '';
    document.getElementById('login-pw').value = '';
    document.getElementById('login-pw-confirm').value = '';
    
    AppState.isLoginMode = true; 
    document.getElementById('btn-login-submit').setAttribute('data-i18n', 'btn_login_submit');
    document.getElementById('auth-toggle-btn').setAttribute('data-i18n', 'auth_toggle_signup');
    document.getElementById('login-pw-confirm').classList.add('d-none');
    document.getElementById('pw-hint').classList.add('d-none');
    document.getElementById('disclaimer-box').classList.add('d-none');
    
    changeLanguage(AppState.currentLang); checkLoginStatus();
}

// --- 공통 기능 ---
function changeLanguage(langCode) {
    AppState.currentLang = langCode;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[langCode][key]) el.innerHTML = i18n[langCode][key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (i18n[langCode][key]) el.setAttribute('placeholder', i18n[langCode][key]);
    });

    if(document.getElementById('app-container').classList.contains('d-flex')){
        drawRadarChart(); renderUsers(AppState.social.sortCriteria); renderQuestList(); updatePointUI(); updateDungeonStatus();
        if(!document.getElementById('titleModal').classList.contains('d-none')) renderHistoryModal();
        loadPlayerName();
    }
}

function switchTab(tabId, el) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    
    if(tabId === 'social') renderUsers(AppState.social.sortCriteria);
    if(tabId === 'status') { drawRadarChart(); updatePointUI(); }
    if(tabId === 'quests') { renderQuestList(); renderCalendar(); }
    if(tabId === 'dungeon') { updateDungeonStatus(); }
}

function loadPlayerName() {
    const savedName = localStorage.getItem('playerName');
    if (savedName) {
        document.getElementById('prof-name').textContent = savedName;
        document.getElementById('prof-name').removeAttribute('data-i18n'); 
    }
}

function changePlayerName() {
    const lastChanged = localStorage.getItem('lastNameChange');
    const now = new Date().getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    if (lastChanged && (now - lastChanged) < thirtyDays) {
        const remain = Math.ceil((thirtyDays - (now - lastChanged)) / (1000*60*60*24));
        alert(`${i18n[AppState.currentLang].name_err} (${remain}일 후 가능)`); return;
    }

    const newName = prompt(i18n[AppState.currentLang].name_prompt);
    if (newName && newName.trim() !== "") {
        const finalName = newName.trim();
        document.getElementById('prof-name').textContent = finalName;
        document.getElementById('prof-name').removeAttribute('data-i18n');
        localStorage.setItem('lastNameChange', now.toString());
        localStorage.setItem('playerName', finalName);
        renderUsers(AppState.social.sortCriteria);
    }
}

function openTitleModal() { renderHistoryModal(); document.getElementById('titleModal').classList.remove('d-none'); document.getElementById('titleModal').classList.add('d-flex'); }
function closeTitleModal() { document.getElementById('titleModal').classList.remove('d-flex'); document.getElementById('titleModal').classList.add('d-none'); }
function renderHistoryModal() {
    const container = document.getElementById('history-list-container'); container.innerHTML = '';
    [...AppState.user.titleHistory].reverse().forEach(hist => {
        container.innerHTML += `<div class="history-item"><span class="hist-lvl">Lv. ${hist.level}</span><span class="hist-title">${hist.title[AppState.currentLang]}</span></div>`;
    });
}

// --- 차트 및 렌더링 최적화 ---
function drawRadarChart() {
    const centerX = 50, centerY = 50, radius = 33; 
    const angles = []; for(let i=0; i<6; i++) angles.push(-Math.PI / 2 + (i * Math.PI / 3));

    const gridGroup = document.getElementById('radarGrid'); const axesGroup = document.getElementById('radarAxes');
    if(gridGroup.innerHTML === '') { 
        let gridHtml = ''; let axesHtml = '';
        for (let level = 1; level <= 5; level++) {
            const r = radius * (level / 5); let points = "";
            for (let i = 0; i < 6; i++) points += `${centerX + r * Math.cos(angles[i])},${centerY + r * Math.sin(angles[i])} `;
            gridHtml += `<polygon points="${points.trim()}" class="radar-bg-line"></polygon>`;
        }
        for (let i = 0; i < 6; i++) axesHtml += `<line x1="50" y1="50" x2="${centerX + radius * Math.cos(angles[i])}" y2="${centerY + radius * Math.sin(angles[i])}" class="radar-bg-line"></line>`;
        gridGroup.innerHTML = gridHtml; axesGroup.innerHTML = axesHtml;
    }

    const pointsGroup = document.getElementById('radarPoints'); const labelsGroup = document.getElementById('radarLabels');
    let pointsHtml = ''; let labelsHtml = ''; let dataPoints = "";
    let totalSum = 0;

    for (let i = 0; i < 6; i++) {
        const key = statKeys[i]; const val = AppState.user.stats[key]; totalSum += val;
        const r = radius * (val / 100);
        const x = centerX + r * Math.cos(angles[i]); const y = centerY + r * Math.sin(angles[i]);
        dataPoints += `${x},${y} `;
        pointsHtml += `<circle cx="${x}" cy="${y}" r="1.2" class="radar-point"></circle>`;

        const labelRadius = radius + 9; 
        const lx = centerX + labelRadius * Math.cos(angles[i]); const ly = centerY + labelRadius * Math.sin(angles[i]) + 2; 
        let anchor = "middle"; if(i===1 || i===2) anchor = "start"; if(i===4 || i===5) anchor = "end";   
        
        labelsHtml += `<text x="${lx}" y="${ly - 3}" text-anchor="${anchor}" class="radar-label">${i18n[AppState.currentLang][key]}</text>
                       <text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" class="radar-value">${val}</text>`;
                       
        const barVal = document.getElementById(`barVal_${key}`);
        if(barVal) barVal.textContent = val;
        const barFill = document.getElementById(`barFill_${key}`);
        if(barFill) setTimeout(() => { barFill.style.width = `${val}%`; }, 100);
    }
    
    pointsGroup.innerHTML = pointsHtml; labelsGroup.innerHTML = labelsHtml;
    
    const playerPolygon = document.getElementById('playerPolygon');
    if(!playerPolygon.getAttribute('points')) playerPolygon.setAttribute('points', "50,50 50,50 50,50 50,50 50,50 50,50"); 
    setTimeout(() => { playerPolygon.setAttribute('points', dataPoints.trim()); }, 50);
    document.getElementById('totalScore').innerHTML = `${totalSum}`;
}

// --- 퀘스트 로직 ---
function renderQuestList() {
    const container = document.getElementById('quest-list-container');
    const day = AppState.quest.currentDayOfWeek;
    let htmlStr = '';
    weeklyQuestData[day].forEach((q, idx) => {
        const isDone = AppState.quest.completedState[day][idx];
        htmlStr += `<div class="quest-row ${isDone ? 'done' : ''}" data-idx="${idx}">
            <div><div class="quest-title"><span class="quest-stat-tag">${q.stat}</span>${q.title[AppState.currentLang]}</div><div class="quest-desc">${q.desc[AppState.currentLang]}</div></div>
            <div class="quest-checkbox"></div></div>`;
    });
    container.innerHTML = htmlStr;
    document.querySelectorAll('.quest-row').forEach(row => {
        row.addEventListener('click', () => toggleQuest(row.dataset.idx));
    });
}

function toggleQuest(idx) {
    const day = AppState.quest.currentDayOfWeek;
    const state = AppState.quest.completedState[day];
    const q = weeklyQuestData[day][idx];
    const sKey = q.stat.toLowerCase();
    
    state[idx] = !state[idx];
    if(state[idx]) { AppState.user.points += 20; AppState.user.pendingStats[sKey] += 0.5; } 
    else { AppState.user.points -= 20; AppState.user.pendingStats[sKey] -= 0.5; }
    
    saveUserData(); // 진척도 및 포인트 로컬 저장
    renderQuestList(); renderCalendar(); updatePointUI(); 
}

function renderCalendar() {
    const calGrid = document.getElementById('calendar-grid'); 
    const today = new Date(); const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - AppState.quest.currentDayOfWeek);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    document.getElementById('cal-month').innerText = `${monthNames[startOfWeek.getMonth()]} ${startOfWeek.getFullYear()}`;
    const dayNames = { ko: ["일","월","화","수","목","금","토"], en: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], ja: ["日","月","火","水","木","金","土"] };

    let htmlStr = '';
    for (let i = 0; i < 7; i++) {
        const cDate = new Date(startOfWeek); cDate.setDate(startOfWeek.getDate() + i);
        const count = AppState.quest.completedState[i].filter(v => v).length;
        htmlStr += `<div class="cal-day ${i === AppState.quest.currentDayOfWeek ? 'today' : ''}">
            <div class="cal-name">${dayNames[AppState.currentLang][i]}</div><div class="cal-date">${cDate.getDate()}</div><div class="cal-score">${count}/12</div></div>`;
    }
    calGrid.innerHTML = htmlStr;
}

// --- 던전 로직 ---
function updateDungeonStatus() {
    const now = new Date();
    const h = now.getHours(); const m = now.getMinutes(); const timeVal = h + m / 60;
    
    let currentSlot = 0;
    if (timeVal >= 6 && timeVal < 8) currentSlot = 1;
    else if (timeVal >= 11.5 && timeVal < 13.5) currentSlot = 2;
    else if (timeVal >= 19 && timeVal < 21) currentSlot = 3;

    const dateStr = now.toDateString();
    
    if (AppState.dungeon.lastGeneratedDate !== dateStr || AppState.dungeon.slot !== currentSlot) {
        AppState.dungeon.lastGeneratedDate = dateStr; AppState.dungeon.slot = currentSlot;
        if (currentSlot > 0) {
            AppState.dungeon.stationIdx = Math.floor(Math.random() * seoulStations.length);
            AppState.dungeon.participants = Math.floor(Math.random() * 5) + 3; 
            AppState.dungeon.isJoined = false;
        }
    }
    renderDungeon();
}

function renderDungeon() {
    const banner = document.getElementById('dungeon-banner');
    if (AppState.dungeon.slot === 0) {
        banner.innerHTML = `<h3 style="color: var(--text-sub); margin: 0 0 10px 0; font-size:1.1rem;">${i18n[AppState.currentLang].raid_waiting}</h3>
                            <p style="font-size: 0.8rem; color: var(--text-sub); margin-bottom: 5px;">${i18n[AppState.currentLang].raid_time_info}</p>`;
    } else {
        const st = seoulStations[AppState.dungeon.stationIdx];
        const stName = st.name[AppState.currentLang];
        const mapUrl = `https://maps.google.com/maps?q=${st.lat},${st.lng}&z=15&output=embed`;
        
        let btnHtml = AppState.dungeon.isJoined ? 
            `<button class="btn-primary" style="background: #444; color: #888; border-color: #333; cursor: not-allowed;" disabled>${i18n[AppState.currentLang].raid_joined}</button>` : 
            `<button id="btn-raid-join" class="btn-primary" style="background:var(--neon-red); border-color:var(--neon-red);">${i18n[AppState.currentLang].raid_btn}</button>`;

        banner.innerHTML = `
            <h3 style="color: var(--neon-red); margin: 0 0 10px 0; font-size:1.1rem;">${i18n[AppState.currentLang].raid_boss}</h3>
            <div class="map-container"><iframe src="${mapUrl}" allowfullscreen="" loading="lazy"></iframe></div>
            <p style="font-size: 0.8rem; color: var(--text-main); margin-bottom: 5px;">${i18n[AppState.currentLang].raid_desc1}</p>
            <p style="font-size: 0.7rem; color: var(--text-sub);">${i18n[AppState.currentLang].raid_desc2}</p>
            <div style="font-size: 0.8rem; margin: 12px 0; font-weight:bold;">${i18n[AppState.currentLang].raid_part} <span style="color:var(--neon-blue)">${AppState.dungeon.participants}</span> / 10</div>
            ${btnHtml}
        `;
        if(!AppState.dungeon.isJoined) {
            document.getElementById('btn-raid-join').addEventListener('click', joinDungeon);
        }
    }
}

function joinDungeon() {
    if(AppState.dungeon.isJoined) return;
    const multiplier = Math.floor(Math.random() * 3) + 1;
    const pts = 100 * multiplier; const agiInc = 2.5 * multiplier;

    AppState.user.points += pts; AppState.user.pendingStats.agi += agiInc;
    AppState.dungeon.isJoined = true; AppState.dungeon.participants++;
    
    saveUserData(); // 던전 보상 저장
    renderDungeon(); updatePointUI();
    alert(`${i18n[AppState.currentLang].raid_success}\n[x${multiplier} Reward] ${pts} P / AGI +${agiInc}`);
}

// --- 소셜 로직 ---
function toggleSocialMode(mode, btn) {
    AppState.social.mode = mode;
    document.querySelectorAll('.social-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
    document.getElementById('ranking-controls').style.display = mode === 'global' ? 'flex' : 'none';
    renderUsers(AppState.social.sortCriteria);
}

function renderUsers(criteria, btn = null) {
    if(btn) {
        AppState.social.sortCriteria = criteria;
        document.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
    }
    const container = document.getElementById('user-list-container');
    
    const me = AppState.social.users.find(u => u.isMe);
    if(me) {
        statKeys.forEach(k => me[k] = AppState.user.stats[k]);
        const savedName = localStorage.getItem('playerName'); if(savedName) me.name = savedName;
        me.title = AppState.user.titleHistory[AppState.user.titleHistory.length-1].title;
    }
    AppState.social.users.forEach(u => u.total = u.str + u.int + u.cha + u.vit + u.wlth + u.agi);

    let dUsers = [...AppState.social.users];
    if(AppState.social.mode === 'friends') dUsers = dUsers.filter(u => u.isFriend);
    dUsers.sort((a, b) => b[criteria] - a[criteria]);

    if(dUsers.length === 0) { container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-sub);">${i18n[AppState.currentLang].no_friend}</div>`; return; }

    let htmlStr = '';
    dUsers.forEach((user, i) => {
        const rDisp = AppState.social.mode === 'global' ? `<div style="font-size:1.1rem; font-weight:bold; color:var(--text-sub); width:25px; text-align:center;">${i+1}</div>` : '';
        let fBtn = '';
        if(!user.isMe) fBtn = user.isFriend ? `<button class="btn-friend added" data-id="${user.id}">${i18n[AppState.currentLang].btn_added}</button>` : `<button class="btn-friend" data-id="${user.id}">${i18n[AppState.currentLang].btn_add}</button>`;
        const tDisp = typeof user.title === 'object' ? user.title[AppState.currentLang] : user.title;
        const nDisp = typeof user.name === 'object' ? user.name[AppState.currentLang] : user.name;
        htmlStr += `<div class="user-card ${user.isMe ? 'my-rank' : ''}">${rDisp}<div class="user-info"><div class="title-badge">${tDisp}</div><div style="font-size:0.95rem;">${nDisp}</div></div><div class="user-score">${user[criteria]}</div>${fBtn}</div>`;
    });
    container.innerHTML = htmlStr;
    
    document.querySelectorAll('.btn-friend').forEach(btn => {
        btn.addEventListener('click', (e) => toggleFriend(parseInt(e.target.dataset.id)));
    });
}

function toggleFriend(id) {
    const u = AppState.social.users.find(x => x.id === id); 
    if(u) { u.isFriend = !u.isFriend; renderUsers(AppState.social.sortCriteria); } 
}

// --- GPS 및 건강 연동 ---
function toggleGPS() {
    const isChecked = document.getElementById('gps-toggle').checked;
    const statusDiv = document.getElementById('gps-status'); statusDiv.style.display = 'flex';
    if(isChecked) {
        statusDiv.innerHTML = '...';
        if ("geolocation" in navigator) navigator.geolocation.getCurrentPosition(() => statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${i18n[AppState.currentLang].gps_on}</span>`, () => { statusDiv.innerHTML = `<span style="color:var(--neon-red);">${i18n[AppState.currentLang].gps_err}</span>`; document.getElementById('gps-toggle').checked = false; });
    } else statusDiv.innerHTML = `<span style="color:var(--text-sub);">${i18n[AppState.currentLang].gps_off}</span>`;
}

function toggleHealthSync() {
    const isChecked = document.getElementById('sync-toggle').checked;
    const statusDiv = document.getElementById('sync-status'); statusDiv.style.display = 'flex';
    if(isChecked) {
        statusDiv.innerHTML = `<span style="color:var(--text-sub);">${i18n[AppState.currentLang].sync_req}</span>`;
        setTimeout(() => {
            statusDiv.innerHTML = `<span style="color:var(--neon-blue);">${i18n[AppState.currentLang].sync_done}</span>`;
            AppState.user.stats.str = Math.min(100, AppState.user.stats.str + 3);
            AppState.user.stats.vit = Math.min(100, AppState.user.stats.vit + 2);
            AppState.user.points += 50; 
            saveUserData(); // 동기화 보상 저장
            updatePointUI(); drawRadarChart();
        }, 2000);
    } else statusDiv.innerHTML = `<span style="color:var(--text-sub);">${i18n[AppState.currentLang].sync_off}</span>`;
}
