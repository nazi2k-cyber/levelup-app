export function createAuthProfileModule(deps) {
    const {
        getAppState,
        auth,
        db,
        fbSignOut,
        isNativePlatform,
        i18n,
        AppLogger,
        ConversionTracker,
        getIdTokenResult,
        getDoc,
        doc,
        loadUserDataFromDB,
        changeLanguage,
        renderCalendar,
        updatePointUI,
        drawRadarChart,
        updateDungeonStatus,
        startRaidTimer,
        renderQuestList,
        updateStepCountUI,
        syncHealthData,
        syncToggleWithOSPermissions,
        initPushNotifications,
        processPendingNotification,
        showPermissionPrompts,
        onboardingStorageKey,
        showOnboardingGuide,
        drawRadarChartForUser,
        buildUserTitleBadgeHTML,
        sanitizeAttr,
        sanitizeText,
        sanitizeURL,
        getTodayStr,
        getDiaryEntry,
        getTodayKST,
    } = deps;

    let initializedUid = null;

    async function handleAuthStateChanged(user) {
        const AppState = getAppState();
        if (user) {
            if (initializedUid === user.uid) return;

            const isEmailUser = user.providerData.some((p) => p.providerId === 'password');
            AppState.isEmailUser = isEmailUser;
            if (isEmailUser && !user.emailVerified) {
                AppLogger.info('[Auth] 미인증 이메일 사용자 차단: ' + user.email);
                const lang = AppState.currentLang || 'ko';
                alert(i18n[lang]?.verify_login_blocked || '이메일 인증을 완료해주세요. 받은편지함을 확인하세요.');
                await fbSignOut(auth);
                return;
            }

            initializedUid = user.uid;

            const delEmailRow = document.getElementById('delete-account-email-row');
            const delEmailEl = document.getElementById('delete-account-email');
            const delProviderIcon = document.getElementById('delete-account-provider-icon');
            if (delEmailRow && delEmailEl && delProviderIcon) {
                delEmailEl.textContent = user.email || user.displayName || 'Unknown';
                const isGoogle = user.providerData.some((p) => p.providerId === 'google.com');
                delProviderIcon.innerHTML = isGoogle
                    ? '<svg viewBox="0 0 24 24" width="20" height="20" style="vertical-align:middle;"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>'
                    : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>';
                delEmailRow.style.display = 'flex';
            }

            AppLogger.info('[Auth] 로그인 감지: ' + (user.email || user.uid));
            ConversionTracker.firstSession();
            await loadUserDataFromDB(user);
            ConversionTracker.onboardingDone();
            document.getElementById('login-screen').classList.add('d-none');
            document.getElementById('app-container').classList.remove('d-none');
            document.getElementById('app-container').classList.add('d-flex');
            const loginPanel = document.getElementById('login-log-panel');
            if (loginPanel) loginPanel.style.display = 'none';

            showOnboardingGuide();
            window.RatingManager?.initCheck();

            const tokenResult = await getIdTokenResult(user);
            const isDev = tokenResult.claims.admin === true;
            const settingsLogCard = document.getElementById('settings-log-card');
            const adminLoggerToggleCard = document.getElementById('admin-logger-toggle-card');
            if (adminLoggerToggleCard) adminLoggerToggleCard.style.display = isDev ? 'block' : 'none';

            try {
                const configSnap = await getDoc(doc(db, 'app_config', 'settings'));
                const configData = configSnap.exists() ? configSnap.data() : {};
                const loggerVisible = configData.loggerVisible === true;
                const loginLogVisible = configData.loginLogVisible === true;

                AppLogger.info('[Config] 로그 설정 로드 완료: loggerVisible=' + loggerVisible + ', loginLogVisible=' + loginLogVisible);
                localStorage.setItem('loginLogVisible', loginLogVisible ? '1' : '0');

                if (isDev) {
                    if (settingsLogCard) settingsLogCard.style.display = 'block';
                    const adminToggle = document.getElementById('admin-logger-toggle');
                    if (adminToggle) {
                        adminToggle.checked = loggerVisible;
                        document.getElementById('admin-logger-toggle-status').textContent = loggerVisible ? '모든 사용자에게 표시 중' : '관리자만 표시 중';
                    }
                    const loginLogToggle = document.getElementById('admin-login-log-toggle');
                    if (loginLogToggle) {
                        loginLogToggle.checked = loginLogVisible;
                        document.getElementById('admin-login-log-toggle-status').textContent = loginLogVisible ? '초기화면에 표시 중' : '초기화면에 숨김';
                    }
                } else if (settingsLogCard) {
                    settingsLogCard.style.display = loggerVisible ? 'block' : 'none';
                }
            } catch (e) {
                AppLogger.warn('[Config] 로그 설정 로드 실패: ' + (e.message || e));
                if (settingsLogCard) settingsLogCard.style.display = isDev ? 'block' : 'none';
                if (isDev) {
                    const cachedLoginLog = localStorage.getItem('loginLogVisible') === '1';
                    const loginLogToggle = document.getElementById('admin-login-log-toggle');
                    if (loginLogToggle) {
                        loginLogToggle.checked = cachedLoginLog;
                        document.getElementById('admin-login-log-toggle-status').textContent = cachedLoginLog ? '초기화면에 표시 중' : '초기화면에 숨김';
                    }
                }
            }

            document.querySelector('main').style.overflowY = 'auto';
            changeLanguage(AppState.currentLang);
            renderCalendar();
            updatePointUI();
            drawRadarChart();
            window.renderDDayList?.();
            window.renderDDayCaption?.();
            updateDungeonStatus();
            startRaidTimer();
            renderQuestList();
            if (window.SocialModule) window.SocialModule.fetchData();
            if (window.renderWeeklyChallenges) window.renderWeeklyChallenges();
            if (window.renderRoulette) window.renderRoulette();
            if (window.AdManager) window.AdManager.renderBonusExp();
            if (window.updateReelsResetTimer) window.updateReelsResetTimer();

            updateStepCountUI();
            if (AppState.user.syncEnabled) syncHealthData(false);
            await syncToggleWithOSPermissions();
            initPushNotifications();
            processPendingNotification();

            if (!localStorage.getItem(onboardingStorageKey)) {
                window._pendingPermissionPrompts = true;
            } else {
                showPermissionPrompts();
            }
            return;
        }

        AppLogger.info('[Auth] 로그아웃 상태');
        initializedUid = null;
        document.getElementById('login-screen').classList.remove('d-none');
        document.getElementById('app-container').classList.add('d-none');
        const loginPanel = document.getElementById('login-log-panel');
        if (loginPanel) {
            const cachedVal = localStorage.getItem('loginLogVisible');
            const showLoginLog = cachedVal === '1';
            AppLogger.info('[Config] 로그아웃 시 초기화면 로그 패널: localStorage=' + cachedVal + ', display=' + (showLoginLog ? 'flex' : 'none'));
            loginPanel.style.display = showLoginLog ? 'flex' : 'none';
        }
    }

    function openProfileStatsModal(userId) {
        const AppState = getAppState();
        let u = AppState.social.users.find((x) => x.id === userId);
        if (!u && Array.isArray(window._reelsCachedPosts)) {
            const post = window._reelsCachedPosts.find((p) => p.uid === userId);
            if (post) {
                u = { id: post.uid, name: post.userName || '헌터', photoURL: post.userPhoto || null, level: post.userLevel || 1, title: post.userTitle || '각성자', rareTitle: post.userRareTitle || null, isMe: post.uid === auth.currentUser?.uid, friends: post.userFriends || [], stats: post.userStats || { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 } };
            }
        }
        if (!u) return;

        if (isNativePlatform && window.AdManager && window.AdManager.hideForModal) window.AdManager.hideForModal();

        const lang = AppState.currentLang;
        const titleBadgeHTML = buildUserTitleBadgeHTML(u, '0.7rem');
        const followingCount = (u.friends || []).length;
        let followerCount = 0;
        AppState.social.users.forEach((su) => {
            if (Array.isArray(su.friends) && su.friends.includes(userId)) followerCount++;
        });

        const isMe = userId === auth.currentUser?.uid;
        const isFollowing = (AppState.user.friends || []).includes(userId);
        const followBtnHTML = !isMe ? `<button id="profile-modal-follow-btn" class="btn-reels-follow ${isFollowing ? 'following' : ''}" onclick="event.stopPropagation();window.toggleProfileModalFollow('${sanitizeAttr(userId)}')">${isFollowing ? (i18n[lang]?.btn_added || '팔로잉') : (i18n[lang]?.btn_add || '팔로우')}</button>` : '';
        const saveBtnHTML = isMe ? `<button class="btn-profile-save" onclick="event.stopPropagation();window.saveProfileCardAsImage('${sanitizeAttr(userId)}')">${i18n[lang]?.profile_save_btn || '저장'}</button>` : '';

        const profileHTML = `<div style="display:flex; align-items:flex-start; gap:10px;"><div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0;">${u.photoURL ? `<img src="${sanitizeURL(u.photoURL)}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(u.photoURL)}',null,true)" style="width:60px; height:60px; border-radius:50%; object-fit:cover; border:2px solid var(--neon-blue);">` : `<div style="width:60px; height:60px; border-radius:50%; background:#444; border:2px solid var(--neon-blue);"></div>`}<div style="font-size:0.75rem; color:var(--text-sub); margin-top:4px; text-align:center;">Lv. ${u.level || 1}</div></div><div style="flex:1; min-width:0;"><div style="margin-bottom:2px;">${titleBadgeHTML}</div><div style="font-size:1rem; font-weight:bold; color:var(--text-main); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${sanitizeText(u.name)}</div><div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-top:4px;">${followBtnHTML}<button class="btn-profile-planner" onclick="event.stopPropagation();window.viewUserTodayPlanner('${sanitizeAttr(userId)}')" title="${i18n[lang]?.profile_view_planner || '당일 플래너'}">${i18n[lang]?.profile_planner_btn || '플래너'}</button>${saveBtnHTML}</div><div class="profile-follow-stats" style="margin-top:4px;"><span class="follow-stat-item"><strong>${(window.SocialModule?.formatFollowCount || String)(followingCount)}</strong> <span>${i18n[lang]?.prof_following || '팔로잉'}</span></span><span class="follow-stat-item"><strong>${(window.SocialModule?.formatFollowCount || String)(followerCount)}</strong> <span>${i18n[lang]?.prof_followers || '팔로워'}</span></span></div></div></div>`;

        document.getElementById('profile-stats-user-info').innerHTML = profileHTML;
        drawRadarChartForUser(u.stats || { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 });

        if (typeof window.renderBig5ForProfile === 'function') {
            const mine = userId === auth.currentUser?.uid;
            const big5Raw = mine ? AppState.user.big5 : (u.big5Str ? (() => { try { return JSON.parse(u.big5Str); } catch (e) { return null; } })() : null);
            window.renderBig5ForProfile(big5Raw, lang);
        }

        const caption = isMe ? (AppState.ddayCaption || '') : (u.ddayCaption || '');
        const mottoEl = document.getElementById('profile-motto-section');
        if (mottoEl) {
            if (caption) {
                mottoEl.style.display = 'block';
                mottoEl.innerHTML = `<div style="padding:6px 10px; background:rgba(255,204,0,0.06); border-radius:4px; font-size:0.75rem; color:var(--text-sub); font-style:italic;">${sanitizeText(caption)}</div>`;
            } else {
                mottoEl.style.display = 'none';
                mottoEl.innerHTML = '';
            }
        }

        const m = document.getElementById('profileStatsModal');
        m.classList.remove('d-none');
        m.classList.add('d-flex');
    }

    function closeProfileStatsModal() {
        const m = document.getElementById('profileStatsModal');
        m.classList.add('d-none');
        m.classList.remove('d-flex');
        if (isNativePlatform && window.AdManager && window.AdManager.resumeFromModal) window.AdManager.resumeFromModal();
    }

    async function toggleProfileModalFollow(userId) {
        if (!auth.currentUser || userId === auth.currentUser.uid) return;
        await window.toggleFriend(userId);
        openProfileStatsModal(userId);
    }

    async function viewUserTodayPlanner(userId) {
        const AppState = getAppState();
        const lang = AppState.currentLang;
        const isMe = userId === auth.currentUser?.uid;
        let blocks = null;
        let tasks = null;

        if (isMe) {
            const todayStr = getTodayStr();
            const entry = getDiaryEntry(todayStr);
            if (entry && entry.blocks && Object.keys(entry.blocks).length > 0) {
                blocks = entry.blocks;
                tasks = entry.tasks || [];
            }
        } else {
            const todayKST = getTodayKST();
            if (Array.isArray(window._reelsCachedPosts)) {
                const post = window._reelsCachedPosts.find((p) => p.uid === userId && p.dateKST === todayKST);
                if (post && post.blocks && Object.keys(post.blocks).length > 0) {
                    blocks = post.blocks;
                    tasks = post.tasks || [];
                }
            }
        }

        const modal = document.getElementById('infoModal');
        document.getElementById('info-modal-title').textContent = i18n[lang]?.profile_view_planner || '당일 플래너';
        if (!blocks) {
            const noPlanner = i18n[lang]?.profile_no_today_plan || '당일 플랜이 없습니다.';
            document.getElementById('info-modal-body').innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-sub); font-size:0.9rem;">${noPlanner}</div>`;
            modal.classList.remove('d-none');
            modal.classList.add('d-flex');
            return;
        }

        let viewCount = parseInt(localStorage.getItem('planner_view_count') || '0', 10);
        viewCount++;
        localStorage.setItem('planner_view_count', String(viewCount));
        const shouldShowAd = (viewCount === 1) || (viewCount % 10 === 0);
        if (shouldShowAd && isNativePlatform && window.AdManager) {
            try { await window.AdManager.showPlannerRewardedAd(lang); } catch (e) { console.warn('[PlannerAd] Ad failed:', e); }
        }

        const mergedBlocks = window.mergeConsecutiveBlocks ? window.mergeConsecutiveBlocks(blocks) : [];
        const scheduleLabel = i18n[lang]?.planner_tab_schedule || '시간표';
        const scheduleHTML = mergedBlocks.map(({ time, task }) => `<div style="display:flex; gap:8px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);"><span style="color:var(--neon-blue); font-size:0.8rem; white-space:nowrap; min-width:100px;">${time}</span><span style="color:var(--text-main); font-size:0.8rem;">${sanitizeText(task)}</span></div>`).join('');
        document.getElementById('info-modal-body').innerHTML = `<div style="padding:8px 0;"><div style="font-size:0.85rem; font-weight:bold; color:var(--neon-blue); margin-bottom:8px;">📋 ${scheduleLabel}</div>${scheduleHTML}</div>`;
        modal.classList.remove('d-none');
        modal.classList.add('d-flex');
    }

    function bindWindowHandlers() {
        window.openProfileStatsModal = openProfileStatsModal;
        window.closeProfileStatsModal = closeProfileStatsModal;
        window.toggleProfileModalFollow = toggleProfileModalFollow;
        window.viewUserTodayPlanner = viewUserTodayPlanner;
    }

    return {
        handleAuthStateChanged,
        bindWindowHandlers,
        openProfileStatsModal,
        closeProfileStatsModal,
        toggleProfileModalFollow,
        viewUserTodayPlanner,
    };
}
