/**
 * Social Module — 소셜 탭 기능 (IIFE)
 * app.js에서 분리된 소셜 데이터 로드, 유저 랭킹, 팔로우, 프로필 동기화 등
 */
(function() {
    'use strict';

    // --- 의존성 (Module Bridge를 통해 window에 노출된 것들) ---
    const AppState    = window.AppState;
    const i18n        = window.i18n;
    const auth        = window._auth;
    const db          = window._db;
    const getDocs     = window._getDocs;
    const collection  = window._collection;
    const setDoc      = window._setDoc;
    const doc         = window._doc;
    const arrayUnion  = window._arrayUnion;
    const arrayRemove = window._arrayRemove;

    // UI 헬퍼
    const sanitizeText      = window.sanitizeText;
    const sanitizeURL       = window.sanitizeURL;
    const sanitizeAttr      = window.sanitizeAttr;
    const sanitizeInstaId   = window.sanitizeInstaId;
    const sanitizeLinkedInId = window.sanitizeLinkedInId;
    const buildUserTitleBadgeHTML = window.buildUserTitleBadgeHTML;

    // 게임 로직
    const checkRankRareTitles = window.checkRankRareTitles;
    const switchTab           = window.switchTab;
    const renderReelsFeed     = window.renderReelsFeed;
    const isNativePlatform    = window.isNativePlatform;

    // --- 소셜 데이터 로드 ---
    async function fetchData() {
        const container = document.getElementById('user-list-container');
        if (container && AppState.social.users.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-sub); font-size:0.85rem;">데이터 로딩 중...</div>';
        }
        try {
            const snap = await getDocs(collection(db, "users"));
            AppState.social.users = snap.docs.map(d => {
                const data = d.data();
                let title = "각성자";
                if (data.titleHistoryStr) {
                    try {
                        const hist = JSON.parse(data.titleHistoryStr);
                        const last = hist[hist.length - 1].title;
                        title = typeof last === 'object' ? last[AppState.currentLang] || last.ko : last;
                    } catch(e) {}
                }
                // 희귀 호칭 파싱 (우선순위 기반 자동 선택)
                let rareTitle = null;
                if (data.rareTitleStr) {
                    try {
                        const rt = JSON.parse(data.rareTitleStr);
                        const ul = rt.unlocked || [];
                        if (ul.length > 0) {
                            const ro = ['uncommon', 'rare', 'epic', 'legendary'];
                            const pp = { rank_global: 40, rank_stat: 30, streak: 20, steps: 10, reading: 10, movies: 10 };
                            rareTitle = [...ul].sort((a, b) => { const pd = (pp[b.type]||0) - (pp[a.type]||0); return pd !== 0 ? pd : ro.indexOf(b.rarity) - ro.indexOf(a.rarity); })[0];
                        }
                    } catch(e) {}
                }
                let readBooks = 0;
                if (data.libraryStr) {
                    try { const lib = JSON.parse(data.libraryStr); readBooks = (lib.books || []).filter(b => b.category === 'read').length; } catch(e) {}
                }
                let watchedMovies = 0;
                if (data.moviesStr) {
                    try { const mov = JSON.parse(data.moviesStr); watchedMovies = (mov.items || []).filter(m => m.category === 'watched').length; } catch(e) {}
                }
                let currentStreak = 0;
                if (data.streakStr) {
                    try { const sk = JSON.parse(data.streakStr); currentStreak = Number(sk.currentStreak) || 0; } catch(e) {}
                }
                const uid = auth.currentUser?.uid;
                return { id: d.id, ...data, title, rareTitle, books: readBooks, movies: watchedMovies, streak: currentStreak, stats: data.stats || {str:0,int:0,cha:0,vit:0,wlth:0,agi:0}, stepData: data.stepData || { date: '', rewardedSteps: 0, totalSteps: 0 }, isFriend: (AppState.user.friends || []).includes(d.id), isFollower: uid && Array.isArray(data.friends) && data.friends.includes(uid), isMe: uid === d.id, privateAccount: !!data.privateAccount };
            });
            // 비공개 계정 필터링 (자기 자신은 항상 표시)
            AppState.social.users = AppState.social.users.filter(u => u.isMe || !u.privateAccount);
            // 저장 디바운스(2초) 경쟁 조건 방지: 아직 Firestore에 반영되지 않은
            // 최신 소셜 ID를 AppState.user에서 직접 덮어씀
            if (auth.currentUser) {
                const meIdx = AppState.social.users.findIndex(u => u.isMe);
                if (meIdx !== -1) {
                    AppState.social.users[meIdx].instaId = AppState.user.instaId || '';
                    AppState.social.users[meIdx].linkedinId = AppState.user.linkedinId || '';
                }
            }
            renderUsers(AppState.social.sortCriteria);
            updateFollowCounts();
            // 랭킹 기반 희귀 호칭 평가
            checkRankRareTitles();
        } catch(e) {
            console.error("소셜 로드 에러", e);
            if (window.AppLogger) window.AppLogger.error('[Social] 데이터 로드 실패', e.stack || e.message);
            if (container) {
                container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--neon-red); font-size:0.85rem;">랭킹 데이터를 불러올 수 없습니다.<br><button onclick="fetchSocialData()" style="margin-top:10px; padding:6px 16px; background:var(--neon-blue); color:#000; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">다시 시도</button></div>';
            }
        }
    }

    // --- 유저 랭킹 렌더링 ---
    function renderUsers(criteria, btn) {
        if(btn) {
            AppState.social.sortCriteria = criteria;
            document.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
        }
        const container = document.getElementById('user-list-container');
        if(!container) return;

        let list = AppState.social.users.map(u => {
            const s = u.stats;
            const total = Math.round(Number(s.str)||0) + Math.round(Number(s.int)||0) + Math.round(Number(s.cha)||0) + Math.round(Number(s.vit)||0) + Math.round(Number(s.wlth)||0) + Math.round(Number(s.agi)||0);
            const steps = Number(u.stepData?.totalSteps) || 0;
            const streak = Number(u.streak) || 0;
            return { ...u, total, str:Math.round(Number(s.str)||0), int:Math.round(Number(s.int)||0), cha:Math.round(Number(s.cha)||0), vit:Math.round(Number(s.vit)||0), wlth:Math.round(Number(s.wlth)||0), agi:Math.round(Number(s.agi)||0), steps, books: u.books || 0, movies: u.movies || 0, streak };
        });

        if(AppState.social.mode === 'friends') list = list.filter(u => u.isFriend || u.isMe);
        if(AppState.social.mode === 'followers') list = list.filter(u => u.isFollower || u.isMe);
        list.sort((a,b) => b[criteria] - a[criteria]);

        // 빈 상태 메시지 (팔로잉/팔로워 탭에서 자기 자신만 있을 때)
        const lang = AppState.currentLang;
        if ((AppState.social.mode === 'friends' || AppState.social.mode === 'followers') && list.filter(u => !u.isMe).length === 0) {
            const emptyMsg = AppState.social.mode === 'friends'
                ? (i18n[lang]?.no_friend || '팔로잉한 사용자가 없습니다.')
                : (i18n[lang]?.no_follower || '팔로워가 없습니다.');
            container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-sub); font-size:0.85rem;">${emptyMsg}</div>`;
            return;
        }

        const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: #ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;
        const linkedinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: #0077b5;"><path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z"/></svg>`;

        // 현재 유저의 팔로잉/팔로워 수 계산 (my-rank 카드용)
        const myUid = auth.currentUser?.uid;
        const myFollowingCount = (AppState.user.friends || []).length;
        const myFollowerCount = myUid ? AppState.social.users.filter(u => Array.isArray(u.friends) && u.friends.includes(myUid)).length : 0;

        // 팔로워 카운트 맵 사전 계산
        const followerCountMap = {};
        AppState.social.users.forEach(su => {
            if (Array.isArray(su.friends)) {
                su.friends.forEach(fid => { followerCountMap[fid] = (followerCountMap[fid] || 0) + 1; });
            }
        });

        container.innerHTML = list.map((u, i) => {
            const titleBadgeHTML = buildUserTitleBadgeHTML(u, '0.6rem');
            const uFollowingCount = (u.friends || []).length;
            const uFollowerCount = followerCountMap[u.id] || 0;
            let cardHTML;

            if (u.isMe) {
                // 상태창 프로필과 동일한 레이아웃
                cardHTML = `
            <div class="user-card my-rank social-my-profile">
                <div style="width:25px; font-weight:bold; color:var(--text-sub);">${i+1}</div>
                <div class="social-my-profile-inner">
                    <div class="profile-box">
                        <div class="profile-image-container" onclick="window.openProfileStatsModal('${sanitizeAttr(u.id)}')" style="cursor:pointer;">
                            ${u.photoURL ? `<img src="${sanitizeURL(u.photoURL)}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(u.photoURL)}',null,true)" class="profile-img" alt="Profile">` : ''}
                        </div>
                        <div>
                            ${titleBadgeHTML}
                            <div class="name-container">
                                <div style="font-size: 0.9rem; font-weight: bold;">${sanitizeText(u.name)}</div>
                                ${u.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(u.instaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:5px; cursor:pointer; display:inline-flex;">${instaSvg}</button>` : ''}
                                ${u.linkedinId ? `<button onclick="window.openLinkedInProfile('${sanitizeLinkedInId(u.linkedinId)}')" style="background:none; border:none; padding:0; margin-left:5px; cursor:pointer; display:inline-flex;">${linkedinSvg}</button>` : ''}
                            </div>
                            <div class="profile-follow-stats">
                                <span class="follow-stat-item" onclick="window.goToSocialTab('friends')">
                                    <strong>${formatFollowCount(myFollowingCount)}</strong> <span>${i18n[lang]?.prof_following || '팔로잉'}</span>
                                </span>
                                <span class="follow-stat-item" onclick="window.goToSocialTab('followers')">
                                    <strong>${formatFollowCount(myFollowerCount)}</strong> <span>${i18n[lang]?.prof_followers || '팔로워'}</span>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="compact-score-box">
                        ${criteria === 'total' ? `<div style="font-size: 0.65rem; color: var(--text-sub);">${i18n[lang]?.tot_score || '종합 스코어'}</div>` : criteria === 'streak' ? `<div style="font-size: 0.65rem; color: var(--text-sub);">${i18n[lang]?.streak_days || '스트릭 일수'}</div>` : ''}
                        <div class="compact-score-val">${criteria === 'streak' ? `${u.streak}<span style="font-size:0.6em; font-weight:normal; margin-left:1px;">${lang === 'en' ? 'd' : '일'}</span>` : (typeof u[criteria] === 'number' ? u[criteria] : u.total).toLocaleString()}</div>
                    </div>
                </div>
            </div>`;
            } else {
                cardHTML = `
            <div class="user-card">
                <div style="width:25px; font-weight:bold; color:var(--text-sub);">${i+1}</div>
                <div style="display:flex; align-items:center; flex-grow:1; margin-left:10px;">
                    ${u.photoURL ? `<img src="${sanitizeURL(u.photoURL)}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(u.photoURL)}',null,true)" onclick="window.openProfileStatsModal('${sanitizeAttr(u.id)}')" style="width:30px; height:30px; border-radius:50%; object-fit:cover; margin-right:8px; border:1px solid var(--neon-blue); cursor:pointer;"><div style="width:30px; height:30px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue); display:none;"></div>` : `<div onclick="window.openProfileStatsModal('${sanitizeAttr(u.id)}')" style="width:30px; height:30px; border-radius:50%; background:#444; margin-right:8px; border:1px solid var(--neon-blue); cursor:pointer;"></div>`}
                    <div class="user-info" style="margin-left:0;">
                        ${titleBadgeHTML}
                        <div style="font-size:0.9rem; display:flex; align-items:center;">
                            ${sanitizeText(u.name)} ${u.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(u.instaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:5px; cursor:pointer; display:inline-flex;">${instaSvg}</button>` : ''} ${u.linkedinId ? `<button onclick="window.openLinkedInProfile('${sanitizeLinkedInId(u.linkedinId)}')" style="background:none; border:none; padding:0; margin-left:5px; cursor:pointer; display:inline-flex;">${linkedinSvg}</button>` : ''}
                        </div>
                        <div class="profile-follow-stats" style="margin-top:2px;">
                            <span class="follow-stat-item"><strong>${formatFollowCount(uFollowingCount)}</strong> <span>${i18n[lang]?.prof_following || '팔로잉'}</span></span>
                            <span class="follow-stat-item"><strong>${formatFollowCount(uFollowerCount)}</strong> <span>${i18n[lang]?.prof_followers || '팔로워'}</span></span>
                        </div>
                    </div>
                </div>
                <div class="user-score" style="font-weight:900; color:var(--neon-blue);">${criteria === 'streak' ? `${u.streak}<span style="font-size:0.7em; font-weight:normal; margin-left:1px;">${AppState.currentLang === 'en' ? 'd' : '일'}</span>` : (typeof u[criteria] === 'number' ? u[criteria].toLocaleString() : u[criteria])}</div>
                <button class="btn-friend ${u.isFriend ? 'added' : ''}" onclick="window.toggleFriend('${sanitizeAttr(u.id)}')">${u.isFriend ? (i18n[AppState.currentLang]?.btn_added || '친구✓') : (i18n[AppState.currentLang]?.btn_add || '추가')}</button>
            </div>`;
            }

            // 네이티브 광고 placeholder 삽입 (N번째 유저 카드 뒤)
            if (window.AdManager && i === window.AdManager.NATIVE_AD_POSITION - 1 && list.length >= window.AdManager.NATIVE_AD_POSITION) {
                return cardHTML + `<div id="native-ad-placeholder-social" class="native-ad-slot"><span class="ad-loading-text">광고</span></div>`;
            }
            return cardHTML;
        }).join('');

        // 네이티브 광고 로드 (placeholder가 삽입된 경우)
        if (window.AdManager && list.length >= window.AdManager.NATIVE_AD_POSITION && isNativePlatform) {
            setTimeout(() => { if (window.AdManager) window.AdManager.loadNativeAd('social'); }, 300);
        }
    }

    // --- 프로필 동기화 ---
    function updateUserData() {
        if (!auth.currentUser) return;
        const uid = auth.currentUser.uid;
        const idx = AppState.social.users.findIndex(u => u.id === uid);
        if (idx !== -1) {
            AppState.social.users[idx].name = AppState.user.name;
            AppState.social.users[idx].photoURL = AppState.user.photoURL;
            AppState.social.users[idx].instaId = AppState.user.instaId || '';
            AppState.social.users[idx].linkedinId = AppState.user.linkedinId || '';
            AppState.social.users[idx].stats = { ...AppState.user.stats };
            renderUsers(AppState.social.sortCriteria);
        }
    }

    // --- 팔로우 토글 ---
    async function toggleFriend(id) {
        const isFriend = AppState.user.friends.includes(id);
        await setDoc(doc(db, "users", auth.currentUser.uid), { friends: isFriend ? arrayRemove(id) : arrayUnion(id) }, { merge: true });
        AppState.user.friends = isFriend ? AppState.user.friends.filter(f=>f!==id) : [...AppState.user.friends, id];
        fetchData();
        // Day1 피드에서 팔로우 버튼 상태 갱신
        if (document.getElementById('reels')?.classList.contains('active')) renderReelsFeed();
    }

    // --- 모드 전환 ---
    function toggleMode(mode, btn) {
        AppState.social.mode = mode;
        document.querySelectorAll('.social-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderUsers(AppState.social.sortCriteria);
    }

    // --- 팔로워/팔로잉 카운트 ---
    function formatFollowCount(n) {
        if (n >= 999500000) return '999m+';
        if (n >= 1000000) { const v = n / 1000000; return (v >= 10 ? Math.floor(v) : v.toFixed(1).replace(/\.0$/, '')) + 'm'; }
        if (n >= 1000) { const v = n / 1000; return (v >= 10 ? Math.floor(v) : v.toFixed(1).replace(/\.0$/, '')) + 'k'; }
        return String(n);
    }

    function updateFollowCounts() {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const followingCount = (AppState.user.friends || []).length;
        const followerCount = AppState.social.users.filter(u => Array.isArray(u.friends) && u.friends.includes(uid)).length;
        const lang = AppState.currentLang;
        const followingEl = document.getElementById('prof-following-count');
        const followerEl = document.getElementById('prof-follower-count');
        if (followingEl) followingEl.innerHTML = `<strong>${formatFollowCount(followingCount)}</strong> <span data-i18n="prof_following">${i18n[lang]?.prof_following || '팔로잉'}</span>`;
        if (followerEl) followerEl.innerHTML = `<strong>${formatFollowCount(followerCount)}</strong> <span data-i18n="prof_followers">${i18n[lang]?.prof_followers || '팔로워'}</span>`;
    }

    // --- 소셜 탭 이동 ---
    function goToTab(mode) {
        const socialNav = document.querySelector('.nav-item[data-tab="social"]');
        if (socialNav) switchTab('social', socialNav);
        const btn = document.querySelector(`.social-tab-btn[data-mode="${mode}"]`);
        if (btn) toggleMode(mode, btn);
    }

    // --- 공개 API ---
    window.SocialModule = {
        fetchData,
        renderUsers,
        updateUserData,
        toggleFriend,
        toggleMode,
        formatFollowCount,
        updateFollowCounts,
        goToTab,
    };

    // HTML onclick 호환 (기존 window 직접 부착 유지)
    window.fetchSocialData = fetchData;
    window.toggleFriend = toggleFriend;
    window.goToSocialTab = goToTab;
    window.formatFollowCount = formatFollowCount;

})();
