// ===== Reels (Day1) 모듈 =====
(function() {
    'use strict';

    // --- Module Bridge 의존성 ---
    const AppState = window.AppState;
    const i18n = window.i18n;
    const auth = window._auth;
    const db = window._db;
    const getDoc = window._getDoc;
    const setDoc = window._setDoc;
    const doc = window._doc;
    const collection = window._collection;
    const query = window._query;
    const where = window._where;
    const getDocs = window._getDocs;
    const isNativePlatform = window.isNativePlatform;
    const DEFAULT_PROFILE_SVG = window.DEFAULT_PROFILE_SVG;

    // 유틸리티 함수 참조
    const sanitizeText = window.sanitizeText;
    const sanitizeURL = window.sanitizeURL;
    const sanitizeAttr = window.sanitizeAttr;
    const sanitizeInstaId = window.sanitizeInstaId;
    const sanitizeLinkedInId = window.sanitizeLinkedInId;
    const buildUserTitleBadgeHTML = window.buildUserTitleBadgeHTML;
    const getTodayKST = window.getTodayKST;

    // showToast 폴백 (미정의 시 alert 사용)
    function showToast(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
        } else if (typeof window.showInAppNotification === 'function') {
            window.showInAppNotification('', msg);
        } else {
            alert(msg);
        }
    }

    // --- ★ Day1 포스트 → 내 플래너 복사 기능 ★ ---
let _pendingCopyPost = null;
let _reelsCachedPosts = []; // 렌더링된 포스트 캐시 (복사 기능용)
let _reelsSearchQuery = ''; // Day1 검색어
let _reelsSortMode = 'latest'; // 'latest' | 'friends' | 'likes'
let _reelsCategoryFilter = 'all'; // 'all' | '러닝' | '헬스' | '독서' | '영화' | '기타'

// Day1 검색 필터 (@닉네임 → 닉네임 검색, 그 외 → 캡션 검색)
function filterReelsFeed(query) {
    _reelsSearchQuery = (query || '').trim().toLowerCase();
    const container = document.getElementById('reels-feed');
    if (!container || _reelsCachedPosts.length === 0) return;
    const lang = AppState.currentLang;
    if (_reelsSearchQuery === '') {
        // 검색어 없으면 전체 표시
        container.innerHTML = renderReelsCards(_reelsCachedPosts, lang);
        if (window.AdManager && _reelsCachedPosts.length >= window.AdManager.REELS_NATIVE_AD_POSITION && isNativePlatform) {
            setTimeout(() => { if (window.AdManager) window.AdManager.loadNativeAd('reels'); }, 300);
        }
    } else {
        const myUid = auth.currentUser?.uid;
        const isNameSearch = _reelsSearchQuery.startsWith('@');
        const keyword = isNameSearch ? _reelsSearchQuery.slice(1).trim() : _reelsSearchQuery;
        if (!keyword) {
            container.innerHTML = renderReelsCards(_reelsCachedPosts, lang);
            return;
        }
        const filtered = _reelsCachedPosts.filter(p => {
            const isMe = p.uid === myUid;
            if (isNameSearch) {
                // @닉네임 검색: 비공개 계정 비노출
                if (p.privateAccount && !isMe) return false;
                return (p.userName || '').toLowerCase().includes(keyword);
            } else {
                // 캡션 검색: 비공개 계정 게시물 비노출
                if (p.privateAccount && !isMe) return false;
                return (p.caption || '').toLowerCase().includes(keyword);
            }
        });
        if (filtered.length > 0) {
            container.innerHTML = renderReelsCards(filtered, lang);
        } else {
            container.innerHTML = `<div class="system-card" style="text-align:center; padding:30px; color:var(--text-sub);">
                <div style="font-size:2rem; margin-bottom:10px;">🔍</div>
                <div>${i18n[lang]?.reels_search_empty || '검색 결과가 없습니다.'}</div>
            </div>`;
        }
    }
};

function openCopyPlannerModal(postId) {
    const lang = AppState.currentLang;
    // 캐시된 포스트에서 해당 postId 찾기
    const post = _reelsCachedPosts.find(p => `${p.uid}_${p.timestamp}` === postId);
    if (!post) return;

    // blocks 데이터 유효성 체크
    if (!post.blocks || Object.keys(post.blocks).length === 0) {
        alert(i18n[lang]?.reels_copy_no_data || '복사할 시간표 데이터가 없습니다.');
        return;
    }

    _pendingCopyPost = post;

    // 모달 타이틀 & 본문 렌더링
    const titleEl = document.getElementById('copy-planner-modal-title');
    const bodyEl = document.getElementById('copy-planner-modal-body');
    const confirmBtn = document.getElementById('btn-copy-planner-confirm');
    const cancelBtn = document.getElementById('btn-copy-planner-cancel');

    if (titleEl) titleEl.textContent = i18n[lang]?.reels_copy_confirm_title || '⚠️ 플래너 덮어쓰기 경고';
    if (confirmBtn) confirmBtn.textContent = i18n[lang]?.reels_copy_confirm_btn || '복사하기';
    if (cancelBtn) cancelBtn.textContent = i18n[lang]?.reels_copy_cancel_btn || '취소';

    const msgTemplate = i18n[lang]?.reels_copy_confirm_msg || '현재 플래너의 우선순위 태스크와 시간표가 <b>{name}</b>님의 데이터로 덮어쓰기됩니다.<br><br>※ 우선순위 태스크는 시간표에 기록된 순서대로 자동 입력됩니다.';
    if (bodyEl) bodyEl.innerHTML = msgTemplate.replace('{name}', sanitizeText(post.userName || '헌터'));

    // 모달 열기
    const modal = document.getElementById('copyPlannerModal');
    if (modal) { modal.classList.remove('d-none'); modal.classList.add('d-flex'); }
};

function closeCopyPlannerModal() {
    _pendingCopyPost = null;
    const modal = document.getElementById('copyPlannerModal');
    if (modal) { modal.classList.add('d-none'); modal.classList.remove('d-flex'); }
};

function confirmCopyPlanner() {
    if (!_pendingCopyPost) return;
    const lang = AppState.currentLang;
    const post = _pendingCopyPost;

    // 1. blocks 객체에서 고유 태스크를 시간순으로 추출
    const blockEntries = Object.entries(post.blocks).sort(([a], [b]) => a.localeCompare(b));
    const uniqueTasks = [];
    const seen = new Set();
    blockEntries.forEach(([time, task]) => {
        if (task && !seen.has(task)) {
            seen.add(task);
            uniqueTasks.push(task);
        }
    });

    // 2. plannerTasks 생성 (시간표 순서 = 우선순위 순서)
    const newTasks = uniqueTasks.map((text, i) => ({ text, ranked: true, rankOrder: i + 1 }));
    while (newTasks.length < 6) newTasks.push({ text: '', ranked: false, rankOrder: 0 });

    // 3. localStorage diary_entries에 먼저 저장 (switchTab → loadPlannerForDate에서 읽힘)
    const dateStr = window.diarySelectedDate;
    let diaries;
    try { diaries = JSON.parse(localStorage.getItem('diary_entries') || '{}'); } catch(e) { diaries = {}; }

    const existingEntry = diaries[dateStr] || {};
    diaries[dateStr] = {
        ...existingEntry,
        blocks: post.blocks,
        tasks: newTasks,
        priorities: newTasks.filter(t => t.ranked && t.text).sort((a, b) => a.rankOrder - b.rankOrder).map(t => t.text),
        brainDump: existingEntry.brainDump || '',
        text: Object.entries(post.blocks).map(([t, v]) => `[${t}] ${v}`).join(' | ').substring(0, 500),
        timestamp: Date.now()
    };
    localStorage.setItem('diary_entries', JSON.stringify(diaries));

    // 4. 모달 닫기
    closeCopyPlannerModal();

    // 5. diary 탭으로 전환 (loadPlannerForDate가 localStorage에서 저장된 데이터를 읽어 렌더링)
    window.switchTab('diary', document.querySelector('.nav-item[data-tab="diary"]'));

    // 6. 성공 알림
    alert(i18n[lang]?.reels_copy_success || '플래너에 복사되었습니다. 플래너 탭에서 확인하세요.');
};

    // --- ★ 릴스 기능 ★ ---

function getReelsData() {
    try {
        const data = JSON.parse(localStorage.getItem('reels_posts') || '{}');
        const todayKST = getTodayKST();
        if (!data._lastDate) data._lastDate = todayKST;
        if (!data.posts) data.posts = [];
        // 24시간 경과 포스트 자동 삭제
        const now = Date.now();
        const before = data.posts.length;
        data.posts = data.posts.filter(p => (now - (p.timestamp || 0)) < 24 * 60 * 60 * 1000);
        if (data.posts.length !== before) {
            data._lastDate = todayKST;
            localStorage.setItem('reels_posts', JSON.stringify(data));
        }
        return data;
    } catch { return { _lastDate: getTodayKST(), posts: [] }; }
}

function saveReelsData(data) {
    localStorage.setItem('reels_posts', JSON.stringify(data));
}

function updateLocalReelsProfileImage() {
    if (!auth.currentUser) return;
    try {
        const data = JSON.parse(localStorage.getItem('reels_posts') || '{}');
        if (!data.posts || data.posts.length === 0) return;
        const uid = auth.currentUser.uid;
        let changed = false;
        data.posts.forEach(p => {
            if (p.uid === uid && p.userPhoto !== AppState.user.photoURL) {
                p.userPhoto = AppState.user.photoURL;
                changed = true;
            }
        });
        if (changed) localStorage.setItem('reels_posts', JSON.stringify(data));
    } catch(e) {}
}

// Firestore에 릴스 포스트 저장/로드
async function saveReelsToFirestore(post) {
    if (!auth.currentUser) return;
    try {
        const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
        let existingPosts = [];
        if (userDoc.exists() && userDoc.data().reelsStr) {
            try { existingPosts = JSON.parse(userDoc.data().reelsStr); } catch(e) {}
        }
        // 24시간 이내 포스트만 유지
        const now = Date.now();
        existingPosts = existingPosts.filter(p => (now - (p.timestamp || 0)) < 24 * 60 * 60 * 1000);
        // 기존 포스트의 프로필 이미지를 최신 값으로 갱신
        const currentPhoto = AppState.user.photoURL || null;
        existingPosts.forEach(p => { p.userPhoto = currentPhoto; });
        existingPosts.push(post);
        await setDoc(doc(db, "users", auth.currentUser.uid), {
            reelsStr: JSON.stringify(existingPosts),
            hasActiveReels: true
        }, { merge: true });
    } catch(e) { window.AppLogger && window.AppLogger.error('[Reels] Firestore 저장 실패: ' + (e.message || e)); }
}

async function fetchAllReelsPosts() {
    const now = Date.now();
    const posts = [];
    try {
        const q = query(collection(db, "users"), where("hasActiveReels", "==", true));
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
            const data = d.data();
            if (data.reelsStr) {
                try {
                    const userPosts = JSON.parse(data.reelsStr);
                    let hasValidPost = false;
                    userPosts.forEach(p => {
                        // 업로드 후 24시간 이내 포스트만 표시
                        if ((now - (p.timestamp || 0)) < 24 * 60 * 60 * 1000) {
                            hasValidPost = true;
                            // 호칭 파싱
                            let uTitle = "각성자";
                            if (data.titleHistoryStr) {
                                try { const hist = JSON.parse(data.titleHistoryStr); const last = hist[hist.length - 1].title; uTitle = typeof last === 'object' ? last[AppState.currentLang] || last.ko : last; } catch(e) {}
                            }
                            let uRareTitle = null;
                            if (data.rareTitleStr) {
                                try { const rt = JSON.parse(data.rareTitleStr); const ul = rt.unlocked || []; if (ul.length > 0) { const ro = ['uncommon','rare','epic','legendary']; const pp = {rank_global:40,rank_stat:30,streak:20,steps:10,reading:10}; uRareTitle = [...ul].sort((a,b) => { const pd = (pp[b.type]||0)-(pp[a.type]||0); return pd !== 0 ? pd : ro.indexOf(b.rarity)-ro.indexOf(a.rarity); })[0]; } } catch(e) {}
                            }
                            posts.push({
                                ...p,
                                uid: d.id,
                                userName: data.name || '헌터',
                                userPhoto: data.photoURL || null,
                                userLevel: data.level || 1,
                                userInstaId: data.instaId || '',
                                userLinkedinId: data.linkedinId || '',
                                userFriends: data.friends || [],
                                userTitle: uTitle,
                                userRareTitle: uRareTitle,
                                privateAccount: !!data.privateAccount
                            });
                        }
                    });
                    // 모든 릴스가 만료된 사용자는 hasActiveReels 리셋
                    // 다른 유저 문서 직접 수정 불가 (보안 규칙: 본인 문서만 쓰기 허용)
                    // 본인 문서만 클라이언트에서 리셋, 타인은 Cloud Functions에서 처리
                    if (!hasValidPost && d.id === auth.currentUser?.uid) {
                        setDoc(doc(db, "users", d.id), { hasActiveReels: false }, { merge: true }).catch(() => {});
                    }
                } catch(e) {}
            }
        });
    } catch(e) { window.AppLogger && window.AppLogger.error('[Reels] 피드 로드 실패: ' + (e.message || e)); }
    // 비공개 계정 필터링 (자기 게시물은 항상 표시)
    const myUid = auth.currentUser?.uid;
    const filtered = posts.filter(p => !p.privateAccount || p.uid === myUid);
    // 최신순 정렬
    filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return filtered;
}

// ===== 위치 태그 (Location Tag) =====
let _locationSearchTimer = null;
AppState.selectedLocation = null;

function openLocationModal() {
    const modal = document.getElementById('location-search-modal');
    if (!modal) return;
    modal.classList.remove('d-none');
    const input = document.getElementById('location-search-input');
    if (input) { input.value = ''; input.focus(); }
    document.getElementById('location-search-list').innerHTML = '';
}


function closeLocationModal() {
    const modal = document.getElementById('location-search-modal');
    if (modal) modal.classList.add('d-none');
}


function selectLocation(name, lat, lng) {
    AppState.selectedLocation = { name, lat, lng };
    const btn = document.getElementById('btn-location-tag');
    const result = document.getElementById('planner-location-result');
    const nameEl = document.getElementById('planner-location-name');
    if (btn) btn.classList.add('d-none');
    if (result) { result.classList.remove('d-none'); }
    if (nameEl) nameEl.textContent = '📍 ' + name;
    closeLocationModal();
}


function removeSelectedLocation() {
    AppState.selectedLocation = null;
    const btn = document.getElementById('btn-location-tag');
    const result = document.getElementById('planner-location-result');
    if (btn) btn.classList.remove('d-none');
    if (result) result.classList.add('d-none');
}


function resetLocationUI() {
    AppState.selectedLocation = null;
    const btn = document.getElementById('btn-location-tag');
    const result = document.getElementById('planner-location-result');
    if (btn) btn.classList.remove('d-none');
    if (result) result.classList.add('d-none');
}

async function searchLocationNominatim(query) {
    const lang = AppState.currentLang || 'ko';
    const acceptLang = lang === 'ja' ? 'ja' : lang === 'en' ? 'en' : 'ko';
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&accept-language=${acceptLang}&addressdetails=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'LevelUpApp/1.0' } });
    if (!res.ok) return [];
    return await res.json();
}

async function reverseGeocodeNominatim(lat, lng) {
    const lang = AppState.currentLang || 'ko';
    const acceptLang = lang === 'ja' ? 'ja' : lang === 'en' ? 'en' : 'ko';
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${acceptLang}&addressdetails=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'LevelUpApp/1.0' } });
    if (!res.ok) return null;
    return await res.json();
}

function renderLocationResults(results) {
    const lang = AppState.currentLang || 'ko';
    const list = document.getElementById('location-search-list');
    if (!list) return;
    if (!results || results.length === 0) {
        list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_no_results || 'No results found.'}</div>`;
        return;
    }
    list.innerHTML = results.map(r => {
        const name = r.name || r.display_name?.split(',')[0] || '';
        const addr = r.display_name || '';
        const lat = r.lat;
        const lng = r.lon;
        return `<div class="location-search-item" onclick="window.selectLocation('${name.replace(/'/g, "\\'")}', ${lat}, ${lng})">
            <div class="location-search-item-name">📍 ${name}</div>
            <div class="location-search-item-addr">${addr}</div>
        </div>`;
    }).join('');
}

function onLocationSearchInput(query) {
    clearTimeout(_locationSearchTimer);
    const lang = AppState.currentLang || 'ko';
    const list = document.getElementById('location-search-list');
    if (!query || query.trim().length < 2) {
        if (list) list.innerHTML = '';
        return;
    }
    if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_searching || 'Searching...'}</div>`;
    _locationSearchTimer = setTimeout(async () => {
        try {
            const results = await searchLocationNominatim(query.trim());
            renderLocationResults(results);
        } catch (e) {
            console.error('[Location] Search error:', e);
            if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_error || 'Error'}</div>`;
        }
    }, 400);
}


async function useCurrentLocation() {
    const lang = AppState.currentLang || 'ko';
    const list = document.getElementById('location-search-list');
    const btn = document.getElementById('btn-location-current');
    if (btn) btn.disabled = true;
    if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_searching || 'Searching...'}</div>`;
    try {
        const { Geolocation } = window.Capacitor?.Plugins || {};
        let lat, lng;
        if (Geolocation) {
            const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        } else if (navigator.geolocation) {
            const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }));
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        } else {
            throw new Error('No geolocation available');
        }
        const result = await reverseGeocodeNominatim(lat, lng);
        if (result) {
            const addr = result.address || {};
            const name = addr.road || addr.neighbourhood || addr.suburb || addr.city_district || result.name || result.display_name?.split(',')[0] || '';
            const area = addr.city || addr.town || addr.village || '';
            const displayName = area ? `${name}, ${area}` : name;
            selectLocation(displayName, lat, lng);
        } else {
            if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_error || 'Error'}</div>`;
        }
    } catch (e) {
        console.error('[Location] GPS error:', e);
        if (list) list.innerHTML = `<div class="location-search-status">${i18n[lang]?.location_error || 'Unable to get location.'}</div>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}


// 릴스 포스팅
async function postToReels() {
    const lang = AppState.currentLang;
    const todayKST = getTodayKST();

    // 이미 포스팅 후 24시간 이내인지 체크 (로컬 타임스탬프 검증)
    const lastPostTs = parseInt(localStorage.getItem('reels_last_post_ts') || '0', 10);
    if (lastPostTs && (Date.now() - lastPostTs) < 24 * 60 * 60 * 1000) {
        return; // 버튼이 비활성화되어 있으므로 조용히 리턴
    }

    // 오늘 타임테이블(시간표)이 있는지 체크
    const todayStr = window.getTodayStr();
    const entry = window.getDiaryEntry(todayStr);
    if (!entry || !entry.blocks || Object.keys(entry.blocks).length === 0) {
        alert(i18n[lang].reels_no_timetable);
        return;
    }

    // 사진 + 텍스트 모두 있는지 체크
    const photoData = window.plannerPhotoData || (entry.photo || null);
    const captionText = (entry.caption || document.getElementById('planner-caption')?.value || '').trim();
    if (!photoData || !captionText) {
        alert(i18n[lang].reels_no_photo);
        return;
    }

    // 즉시 버튼 비활성화 (중복 클릭 방지 + 시각 피드백)
    const postBtn = document.getElementById('btn-reels-post');
    if (postBtn) {
        postBtn.disabled = true;
        postBtn.removeAttribute('data-i18n');
        postBtn.textContent = '포스팅 중...';
        postBtn.style.background = '#333';
        postBtn.style.color = '#666';
        postBtn.style.opacity = '0.6';
        postBtn.style.cursor = 'not-allowed';
    }

    try {
        // 포스트 생성
        const caption = (entry.caption || '').trim();
        const postTimestamp = Date.now();

        // 릴스 사진을 Cloud Storage에 업로드 (압축 후)
        let finalPhotoURL = photoData;
        let uploadFailed = false;
        if (window.isBase64Image(photoData)) {
            try {
                const uid = auth.currentUser.uid;
                const reelsLang = AppState.currentLang || 'ko';
                const _reelsUploadMsg = { ko: '릴스 사진 업로드 중...', en: 'Uploading reel photo...', ja: 'リール写真をアップロード中...' };
                const reelsProgressCb = window.createUploadProgressCallback(_reelsUploadMsg[reelsLang] || _reelsUploadMsg.en);
                // 릴스 사진 압축 (최대 480px, quality 0.6) — Storage 2MB 제한 대응
                const compressedPhotoData = await window.compressBase64Image(photoData, 480, 0.6);
                finalPhotoURL = await window.uploadImageToStorage(`reels_photos/${uid}/${postTimestamp}${window.getImageExtension()}`, compressedPhotoData, reelsProgressCb);
                window.hideUploadProgress();
            } catch (e) {
                window.hideUploadProgress();
                console.error('[Reels] Storage 업로드 실패 (3회 재시도 후):', e);
                // base64 직접 저장 대신 에러 상태 기록 — Firestore 문서 비대화 방지
                finalPhotoURL = null;
                uploadFailed = true;
            }
        }

        if (uploadFailed) {
            alert(i18n[lang]?.photo_upload_fail || '사진 업로드에 실패했습니다. 네트워크 확인 후 다시 시도해주세요.');
            // 버튼 재활성화 후 중단
            updateReelsResetTimer();
            return;
        }

        const post = {
            uid: auth.currentUser.uid,
            dateKST: todayKST,
            timestamp: postTimestamp,
            photo: finalPhotoURL,
            caption: caption,
            blocks: entry.blocks,
            tasks: entry.tasks || [],
            mood: entry.mood || '',
            category: entry.category || '기타',
            userName: AppState.user.name,
            userPhoto: AppState.user.photoURL || null,
            userLevel: AppState.user.level,
            location: AppState.selectedLocation || null
        };

        // 로컬 저장
        const reelsData = getReelsData();
        reelsData.posts.push(post);
        saveReelsData(reelsData);

        // 포스팅 타임스탬프 저장 (로그아웃 후에도 비활성화 유지용)
        localStorage.setItem('reels_last_post_ts', String(postTimestamp));

        // Firestore 저장
        await saveReelsToFirestore(post);

        // 포스팅 보상: +20P & CHA +0.5 (24시간 내 중복 지급 방지)
        const lastRewardTs = parseInt(localStorage.getItem('reels_reward_ts') || '0', 10);
        const alreadyRewarded = lastRewardTs && (Date.now() - lastRewardTs) < 24 * 60 * 60 * 1000;
        if (!alreadyRewarded) {
            AppState.user.points += 20;
            AppState.user.pendingStats.cha = (AppState.user.pendingStats.cha || 0) + 0.5;
            localStorage.setItem('reels_reward_ts', String(postTimestamp));
            window.updatePointUI();
            window.drawRadarChart();
            window.AppLogger && window.AppLogger.info('[Reels] 포스팅 보상 지급: +20P, CHA +0.5');
        }

        await window.saveUserData();
        resetLocationUI();
        alert(i18n[lang].reels_posted);
        renderReelsFeed();
    } catch(e) {
        window.AppLogger && window.AppLogger.error('[Reels] 포스팅 오류: ' + (e.message || e));
    } finally {
        // 항상 타이머/버튼 상태 갱신 (에러 발생 시에도)
        updateReelsResetTimer();
    }
}

// 릴스 피드 렌더링
// _reelsFeedRendering: 중복 호출 방지 플래그
// _reelsFeedLastKey: 마지막 렌더링 데이터 키 (불필요한 DOM 교체 방지)
async function renderReelsFeed() {
    const container = document.getElementById('reels-feed');
    if (!container) return;

    // 이미 렌더링 중이면 중복 호출 방지
    if (window._reelsFeedRendering) return;
    window._reelsFeedRendering = true;

    const lang = AppState.currentLang;

    // 포스트 데이터 키 생성 (uid_timestamp 목록으로 변경 감지)
    function postsKey(posts) {
        return _reelsSortMode + ':' + _reelsCategoryFilter + ':' + posts.map(p => `${p.uid}_${p.timestamp}`).join(',');
    }

    // 로컬 캐시 먼저 표시 (단, 이전 렌더와 동일하면 스킵)
    const localData = getReelsData();
    const allLocalPosts = (localData.posts || []);
    const localPosts = _reelsCategoryFilter === 'all'
        ? allLocalPosts
        : allLocalPosts.filter(p => (p.category || '기타') === _reelsCategoryFilter);
    // 로컬 캐시: latest/friends는 동기 정렬, likes는 서버 데이터에서 처리
    if (_reelsSortMode === 'friends') {
        const myFriends = new Set(AppState.user.friends || []);
        localPosts.sort((a, b) => {
            const aF = myFriends.has(a.uid) ? 1 : 0;
            const bF = myFriends.has(b.uid) ? 1 : 0;
            if (aF !== bF) return bF - aF;
            return (b.timestamp || 0) - (a.timestamp || 0);
        });
    } else {
        localPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
    const localKey = postsKey(localPosts);

    if (localPosts.length > 0) {
        if (window._reelsFeedLastKey !== localKey) {
            container.innerHTML = renderReelsCards(localPosts, lang);
            window._reelsFeedLastKey = localKey;
            // Day1 네이티브 광고 로드 (로컬 캐시 렌더 후)
            if (window.AdManager && localPosts.length >= window.AdManager.REELS_NATIVE_AD_POSITION && isNativePlatform) {
                setTimeout(() => { if (window.AdManager) window.AdManager.loadNativeAd('reels'); }, 300);
            }
        }
    } else if (!window._reelsFeedLastKey) {
        const _loadingMsg = { ko: '로딩 중...', en: 'Loading...', ja: '読み込み中...' };
        container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-sub);">${_loadingMsg[lang] || _loadingMsg.ko}</div>`;
    }

    // Firestore에서 최신 데이터 로드 (5초 타임아웃)
    try {
        const rawPosts = await Promise.race([
            fetchAllReelsPosts(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
        const categoryFiltered = _reelsCategoryFilter === 'all'
            ? rawPosts
            : rawPosts.filter(p => (p.category || '기타') === _reelsCategoryFilter);
        const posts = await applySortToReelsPosts(categoryFiltered);
        if (posts.length === 0) {
            if (window._reelsFeedLastKey !== '') {
                container.innerHTML = `<div class="system-card" style="text-align:center; padding:30px; color:var(--text-sub);">
                    <div style="font-size:2rem; margin-bottom:10px;">🎬</div>
                    <div>${i18n[lang].reels_empty}</div>
                </div>`;
                window._reelsFeedLastKey = '';
            }
            return;
        }
        const serverKey = postsKey(posts);
        // Firestore 데이터가 로컬과 동일하면 DOM 교체 스킵 (깜빡임 방지)
        if (window._reelsFeedLastKey !== serverKey) {
            // DOM 교체 전 기존 광고 정리 (placeholder가 사라지므로)
            if (window.AdManager && window.AdManager.nativeAdActiveTab === 'reels') window.AdManager.cleanupNativeAd();
            container.innerHTML = renderReelsCards(posts, lang);
            window._reelsFeedLastKey = serverKey;
            // Day1 네이티브 광고 로드 (서버 데이터 렌더 후)
            if (window.AdManager && posts.length >= window.AdManager.REELS_NATIVE_AD_POSITION && isNativePlatform) {
                setTimeout(() => { if (window.AdManager) window.AdManager.loadNativeAd('reels'); }, 300);
            }
        }
    } catch(e) {
        // 타임아웃 또는 네트워크 오류 시 로컬 데이터 유지
        if (localPosts.length === 0 && !window._reelsFeedLastKey) {
            container.innerHTML = `<div class="system-card" style="text-align:center; padding:30px; color:var(--text-sub);">
                <div style="font-size:2rem; margin-bottom:10px;">🎬</div>
                <div>${i18n[lang].reels_empty}</div>
            </div>`;
            window._reelsFeedLastKey = '';
        }
    } finally {
        window._reelsFeedRendering = false;
        // 검색어가 있으면 필터 재적용
        if (_reelsSearchQuery) {
            filterReelsFeed(_reelsSearchQuery);
        }
    }
}

function mergeConsecutiveBlocks(blocks) {
    const entries = Object.entries(blocks || {}).sort(([a],[b]) => a.localeCompare(b));
    if (entries.length === 0) return [];
    const merged = [];
    let [startTime, currentTask] = entries[0];
    let endTime = startTime;
    for (let i = 1; i < entries.length; i++) {
        const [time, task] = entries[i];
        const [eh, em] = endTime.split(':').map(Number);
        const expectedNext = `${String(eh + (em === 30 ? 1 : 0)).padStart(2,'0')}:${em === 30 ? '00' : '30'}`;
        if (task === currentTask && time === expectedNext) {
            endTime = time;
        } else {
            const [fh, fm] = endTime.split(':').map(Number);
            const finalEnd = `${String(fh + (fm === 30 ? 1 : 0)).padStart(2,'0')}:${fm === 30 ? '00' : '30'}`;
            merged.push({ time: `${startTime}~${finalEnd}`, task: currentTask });
            startTime = time;
            currentTask = task;
            endTime = time;
        }
    }
    const [fh, fm] = endTime.split(':').map(Number);
    const finalEnd = `${String(fh + (fm === 30 ? 1 : 0)).padStart(2,'0')}:${fm === 30 ? '00' : '30'}`;
    merged.push({ time: `${startTime}~${finalEnd}`, task: currentTask });
    return merged;
}

function renderReelsCards(posts, lang) {
    _reelsCachedPosts = posts; // 포스트 캐시 업데이트
    const instaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="color:#ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;
    const linkedinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="color:#0077b5;"><path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z"/></svg>`;

    const heartOutline = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const commentIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    const copyIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const reportIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;

    // 팔로워 카운트 맵 사전 계산 (Day1)
    const reelsFollowerMap = {};
    const socialUsers = AppState.social.users || [];
    socialUsers.forEach(su => {
        if (Array.isArray(su.friends)) {
            su.friends.forEach(fid => { reelsFollowerMap[fid] = (reelsFollowerMap[fid] || 0) + 1; });
        }
    });
    // social 데이터 미로드 시 reels posts 자체 friends로도 계산
    if (socialUsers.length === 0) {
        posts.forEach(p => {
            if (Array.isArray(p.userFriends)) {
                p.userFriends.forEach(fid => { reelsFollowerMap[fid] = (reelsFollowerMap[fid] || 0) + 1; });
            }
        });
    }

    const html = posts.map((post, postIdx) => {
        const postId = getPostId(post);
        const profileSrc = post.userPhoto ? sanitizeURL(post.userPhoto) : DEFAULT_PROFILE_SVG;
        const isMe = post.uid === auth.currentUser?.uid;
        const instaLink = post.userInstaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(post.userInstaId)}', '_blank')" style="background:none; border:none; padding:0; margin-left:4px; cursor:pointer; display:inline-flex; vertical-align:middle;">${instaSvg}</button>` : '';
        const linkedinLink = post.userLinkedinId ? `<button onclick="window.openLinkedInProfile('${sanitizeLinkedInId(post.userLinkedinId)}')" style="background:none; border:none; padding:0; margin-left:4px; cursor:pointer; display:inline-flex; vertical-align:middle;">${linkedinSvg}</button>` : '';
        const reelsLang = AppState.currentLang;
        const isFollowingPost = (AppState.user.friends || []).includes(post.uid);
        const followBtn = !isMe ? `<button class="btn-reels-follow ${isFollowingPost ? 'following' : ''}" onclick="event.stopPropagation();window.toggleFriend('${sanitizeAttr(post.uid)}')">${isFollowingPost ? (i18n[reelsLang]?.btn_added || '팔로잉') : (i18n[reelsLang]?.btn_add || '팔로우')}</button>` : '';
        const postFollowingCount = isMe ? (AppState.user.friends || []).length : (post.userFriends || []).length;
        const postFollowerCount = reelsFollowerMap[post.uid] || 0;
        const reelsTitleBadgeHTML = buildUserTitleBadgeHTML({ title: post.userTitle || '각성자', rareTitle: post.userRareTitle || null, isMe }, '0.55rem');

        // 시간표 블록 (폴딩/언폴딩 지원, 연속 동일 업무 합치기)
        const mergedBlocks = mergeConsecutiveBlocks(post.blocks);
        const FOLD_LIMIT = 6;
        const blockSummary = mergedBlocks.slice(0, FOLD_LIMIT).map(({time, task}) =>
            `<div class="reels-block-item"><span class="reels-block-time">${time}</span><span class="reels-block-task">${sanitizeText(task)}</span></div>`
        ).join('');
        const blockExtra = mergedBlocks.slice(FOLD_LIMIT).map(({time, task}) =>
            `<div class="reels-block-item"><span class="reels-block-time">${time}</span><span class="reels-block-task">${sanitizeText(task)}</span></div>`
        ).join('');
        const moreCount = mergedBlocks.length > FOLD_LIMIT ? mergedBlocks.length - FOLD_LIMIT : 0;

        const cardHTML = `<div class="system-card reels-card" data-post-id="${postId}">
            <div class="reels-header">
                <img class="reels-avatar" src="${profileSrc}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(profileSrc)}','${DEFAULT_PROFILE_SVG}')" alt="" onclick="window.openProfileStatsModal('${sanitizeAttr(post.uid)}')" style="cursor:pointer;">
                <div class="reels-user-info">
                    ${reelsTitleBadgeHTML}
                    <div class="reels-username">${sanitizeText(post.userName || '헌터')}${instaLink}${linkedinLink}${followBtn}${isMe ? ' <span style="color:var(--neon-gold); font-size:0.65rem;">(나)</span>' : ''}</div>
                    <div class="profile-follow-stats" style="margin-top:2px;">
                        <span class="follow-stat-item"><strong>${(window.SocialModule?.formatFollowCount||String)(postFollowingCount)}</strong> <span>${i18n[reelsLang]?.prof_following || '팔로잉'}</span></span>
                        <span class="follow-stat-item"><strong>${(window.SocialModule?.formatFollowCount||String)(postFollowerCount)}</strong> <span>${i18n[reelsLang]?.prof_followers || '팔로워'}</span></span>
                    </div>
                    <div class="reels-user-meta">Lv.${post.userLevel} ${post.mood ? getMoodEmoji(post.mood) : ''}</div>
                    ${post.location ? `<div class="reels-location">📍 ${sanitizeText(post.location.name)}</div>` : ''}
                </div>
                <div class="reels-time">${formatReelsTime(post.timestamp)}</div>
            </div>
            ${post.photo ? `<div class="reels-photo-container"><img class="reels-photo" src="${sanitizeURL(window.getThumbnailURL(post.photo))}" onerror="this.onerror=null;if(!this.dataset.fallback){this.dataset.fallback='1';this.src='${sanitizeAttr(post.photo)}';}else{window._retryFirebaseImg(this,'${sanitizeAttr(post.photo)}');}" alt="Timetable"></div>` : ''}
            ${post.caption ? `<div class="reels-caption">${sanitizeText(post.caption).replace(/\n/g,'<br>')}</div>` : ''}
            ${(post.category && post.category !== '기타') ? `<div class="reels-category-badge">${sanitizeText(post.category)}</div>` : ''}
            <div class="reels-timetable">
                <div class="reels-timetable-title" ${moreCount > 0 ? `onclick="toggleScheduleFold('${postId}')" style="cursor:pointer;"` : ''}>
                    📋 ${i18n[lang]?.planner_tab_schedule || '시간표'}
                    ${moreCount > 0 ? `<span class="schedule-fold-icon" data-fold-icon="${postId}">▼</span>` : ''}
                </div>
                ${blockSummary}
                ${moreCount > 0 ? `<div class="reels-block-extra" data-fold-extra="${postId}">${blockExtra}</div>
                <div class="schedule-fold-toggle" onclick="toggleScheduleFold('${postId}')">
                    <span data-fold-label="${postId}">+${moreCount} more</span>
                </div>` : ''}
            </div>
            <div class="reels-actions">
                <button class="reels-like-btn" onclick="toggleReelsLike('${postId}')">${heartOutline}</button><span class="reels-like-count"></span>
                <button class="reels-comment-btn" onclick="toggleCommentsPanel('${postId}')">${commentIcon}</button><span class="reels-comment-count"></span>
                ${!isMe ? `<button class="reels-copy-btn" onclick="window.openCopyPlannerModal('${postId}')" title="${i18n[lang].reels_copy_planner || '플래너 복사'}">${copyIcon}</button>` : ''}
                ${!isMe ? `<button class="reels-report-btn" onclick="toggleReportPost('${postId}')" title="${i18n[lang].reels_report || '신고'}">${reportIcon}<span class="reels-report-label">${i18n[lang].reels_report || '신고'}</span></button>` : ''}
            </div>
            <div class="reels-report-warning" data-report-warning="${postId}" style="display:none;">
                <span class="reels-report-warning-icon">&#9888;</span>
                <span class="reels-report-warning-text">${i18n[lang].reels_report_warning || '이 게시물은 신고가 접수되었습니다. 관리자가 검토 중입니다.'}</span>
            </div>
            <div class="reels-comments-panel">
                <div class="reels-comments-list">
                    <div class="reels-comment-empty">${i18n[lang].reels_comment_empty}</div>
                </div>
                <div class="reels-comment-input-wrap">
                    <input type="text" class="reels-comment-input" placeholder="${i18n[lang].reels_comment_placeholder}" maxlength="200" onkeydown="if(event.key==='Enter'){const inp=this;addReelsComment('${postId}',inp.value);inp.value='';}">
                    <button class="reels-comment-submit" onclick="const inp=this.previousElementSibling;addReelsComment('${postId}',inp.value);inp.value='';">${i18n[lang].reels_comment_post}</button>
                </div>
            </div>
        </div>`;

        // Day1 네이티브 광고 placeholder 삽입 (N번째 포스트 뒤)
        if (window.AdManager && postIdx === window.AdManager.REELS_NATIVE_AD_POSITION - 1 && posts.length >= window.AdManager.REELS_NATIVE_AD_POSITION) {
            return cardHTML + `<div id="native-ad-placeholder-reels" class="native-ad-slot"><span class="ad-loading-text">광고</span></div>`;
        }
        return cardHTML;
    }).join('');

    // 렌더 후 각 포스트의 리액션 데이터 및 신고 상태 로드
    setTimeout(() => {
        posts.forEach(post => {
            const postId = getPostId(post);
            loadReelsReactions(postId).then(data => {
                if (data.likes && data.likes.length > 0) updateLikeUI(postId, data.likes);
                if (data.comments && data.comments.length > 0) renderCommentsSection(postId, data.comments);
            });
            loadReportStatus(postId);
        });
    }, 100);

    return html;
}

function getMoodEmoji(mood) {
    const map = { great: '😄', good: '🙂', neutral: '😐', bad: '😞', terrible: '😫' };
    return map[mood] || '';
}

function formatReelsTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const month = d.getMonth() + 1;
    const date = d.getDate();
    const day = dayNames[d.getDay()];
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${date} (${day}) ${hours}:${minutes}`;
}

// 릴스 리셋 타이머 (업로드 후 24시간 기준)
function updateReelsResetTimer() {
    const timerEl = document.getElementById('reels-reset-timer');
    if (!timerEl) return;

    function update() {
        // 저장된 포스팅 타임스탬프 기반 체크 (로그아웃 후에도 유지)
        const lastPostTs = parseInt(localStorage.getItem('reels_last_post_ts') || '0', 10);
        const now = Date.now();
        const stillCooldown = lastPostTs && (now - lastPostTs) < 24 * 60 * 60 * 1000;
        const postBtn = document.getElementById('btn-reels-post');

        if (stillCooldown) {
            // 업로드 타임스탬프 + 1일 = 다음 업로드 가능 일시 (KST 기준)
            const nextAvailMs = lastPostTs + (24 * 60 * 60 * 1000);
            // KST = UTC+9 → UTC 밀리초에 9시간 더한 뒤 UTC 메서드로 읽기
            const kstNext = new Date(nextAvailMs + 9 * 60 * 60 * 1000);
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
            const m = kstNext.getUTCMonth() + 1;
            const d = kstNext.getUTCDate();
            const dy = dayNames[kstNext.getUTCDay()];
            const h = String(kstNext.getUTCHours()).padStart(2, '0');
            const mi = String(kstNext.getUTCMinutes()).padStart(2, '0');
            timerEl.innerText = `다음 업로드: ${m}/${d} (${dy}) ${h}:${mi}`;
            // 버튼 비활성화 (룰렛 스타일)
            if (postBtn) {
                postBtn.disabled = true;
                postBtn.removeAttribute('data-i18n'); // changeLanguage()가 텍스트 덮어쓰기 방지
                postBtn.textContent = '포스팅 완료';
                postBtn.style.background = '#333';
                postBtn.style.color = '#666';
                postBtn.style.opacity = '0.6';
                postBtn.style.cursor = 'not-allowed';
            }
        } else {
            // 쿨다운 만료 → 타임스탬프 정리
            if (lastPostTs) {
                localStorage.removeItem('reels_last_post_ts');
                localStorage.removeItem('reels_reward_ts');
            }
            timerEl.innerText = `업로드 가능`;
            // 버튼 활성화
            if (postBtn) {
                postBtn.disabled = false;
                postBtn.setAttribute('data-i18n', 'reels_post_btn'); // i18n 속성 복원
                postBtn.textContent = i18n[AppState.currentLang]?.reels_post_btn || 'Day1 포스팅';
                postBtn.style.background = 'var(--neon-gold)';
                postBtn.style.color = '#000';
                postBtn.style.opacity = '1';
                postBtn.style.cursor = 'pointer';
            }
        }
    }
    update();
    // 릴스 탭 활성시 1초마다 업데이트
    if (window._reelsTimerInterval) clearInterval(window._reelsTimerInterval);
    window._reelsTimerInterval = setInterval(() => {
        const reelsActive = document.getElementById('reels').classList.contains('active');
        const diaryActive = document.getElementById('diary').classList.contains('active');
        if (reelsActive || diaryActive) {
            update();
            if (reelsActive) {
                // 24시간 경과 포스트 자동 삭제 체크
                checkReelsReset();
            }
        }
    }, 1000);
}

// 24시간 경과 포스트 자동 삭제 체크 (getReelsData에서 필터링됨)
// _reelsLastMyPostState: 이전 내 포스트 존재 여부 (변경 시에만 피드 갱신)
function checkReelsReset() {
    const reelsData = getReelsData(); // 24h 지난 포스트 자동 필터링
    const myPost = reelsData.posts.find(p => p.uid === (auth.currentUser?.uid));
    const hasMyPost = !!myPost;
    // 내 포스트 상태가 변경된 경우에만 피드 갱신 (매초 호출 방지)
    if (window._reelsLastMyPostState !== undefined && window._reelsLastMyPostState !== hasMyPost) {
        renderReelsFeed();
    }
    window._reelsLastMyPostState = hasMyPost;
}

// ===== 좋아요 / 댓글 기능 =====

// 포스트 고유 ID 생성 (uid + timestamp)
function getPostId(post) {
    return `${post.uid}_${post.timestamp}`;
}

// 좋아요/댓글 데이터 로드
async function loadReelsReactions(postId) {
    try {
        const docSnap = await getDoc(doc(db, "reels_reactions", postId));
        if (docSnap.exists()) return docSnap.data();
    } catch(e) { window.AppLogger && window.AppLogger.error('[Reels] 리액션 로드 실패: ' + (e.message || e)); }
    return { likes: [], comments: [] };
}

// 좋아요 카운트 일괄 조회 (Day1 정렬용)
async function batchFetchLikeCounts(posts) {
    const results = {};
    const promises = posts.map(async (p) => {
        const postId = getPostId(p);
        try {
            const docSnap = await getDoc(doc(db, "reels_reactions", postId));
            results[postId] = docSnap.exists() ? (docSnap.data().likes || []).length : 0;
        } catch(e) { results[postId] = 0; }
    });
    await Promise.all(promises);
    return results;
}

// Day1 정렬 적용 (latest/friends/likes)
async function applySortToReelsPosts(posts) {
    if (_reelsSortMode === 'friends') {
        const myFriends = new Set(AppState.user.friends || []);
        posts.sort((a, b) => {
            const aF = myFriends.has(a.uid) ? 1 : 0;
            const bF = myFriends.has(b.uid) ? 1 : 0;
            if (aF !== bF) return bF - aF;
            return (b.timestamp || 0) - (a.timestamp || 0);
        });
    } else if (_reelsSortMode === 'likes') {
        const likeCounts = await batchFetchLikeCounts(posts);
        posts.sort((a, b) => {
            const diff = (likeCounts[getPostId(b)] || 0) - (likeCounts[getPostId(a)] || 0);
            if (diff !== 0) return diff;
            return (b.timestamp || 0) - (a.timestamp || 0);
        });
    } else {
        posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
    return posts;
}

// 좋아요 토글 (Optimistic UI: 즉시 반영 후 서버 쓰기, 실패 시 롤백)
async function toggleReelsLike(postId) {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const reactRef = doc(db, "reels_reactions", postId);

    // 현재 UI 상태에서 좋아요 목록 추론
    const likeBtn = document.querySelector(`[data-post-id="${postId}"] .reels-like-btn`);
    const isCurrentlyLiked = likeBtn?.classList.contains('liked');
    const likeCountEl = document.querySelector(`[data-post-id="${postId}"] .reels-like-count`);
    const prevCount = parseInt(likeCountEl?.textContent) || 0;

    // Optimistic UI: 즉시 반영
    const optimisticCount = isCurrentlyLiked ? Math.max(0, prevCount - 1) : prevCount + 1;
    if (likeBtn) {
        likeBtn.classList.toggle('liked', !isCurrentlyLiked);
        likeBtn.innerHTML = !isCurrentlyLiked
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#ff3c3c"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    }
    if (likeCountEl) {
        likeCountEl.textContent = formatReactCount(optimisticCount);
    }

    // 서버 쓰기 (백그라운드)
    try {
        const docSnap = await getDoc(reactRef);
        let likes = [];
        let comments = [];
        if (docSnap.exists()) {
            likes = docSnap.data().likes || [];
            comments = docSnap.data().comments || [];
        }
        const existIdx = likes.findIndex(l => l.uid === uid);
        if (existIdx >= 0) {
            likes.splice(existIdx, 1);
        } else {
            likes.push({
                uid: uid,
                name: AppState.user.name || '헌터',
                photoURL: AppState.user.photoURL || null,
                instaId: AppState.user.instaId || '',
                timestamp: Date.now()
            });
        }
        await setDoc(reactRef, { likes, comments }, { merge: true });
        // 서버 결과로 최종 동기화
        updateLikeUI(postId, likes);
    } catch(e) {
        // 실패 시 롤백
        window.AppLogger && window.AppLogger.error('[Reels] 좋아요 실패, 롤백: ' + (e.message || e));
        if (likeBtn) {
            likeBtn.classList.toggle('liked', isCurrentlyLiked);
            likeBtn.innerHTML = isCurrentlyLiked
                ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#ff3c3c"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
                : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
        }
        if (likeCountEl) {
            likeCountEl.textContent = formatReactCount(prevCount);
        }
    }
}

// 숫자 포맷 (최대 9999, 이상은 9999+)
function formatReactCount(n) {
    if (!n || n <= 0) return '';
    return n > 9999 ? '9999+' : String(n);
}

// 좋아요 UI 업데이트
function updateLikeUI(postId, likes) {
    const uid = auth.currentUser?.uid;
    const isLiked = likes.some(l => l.uid === uid);
    const likeBtn = document.querySelector(`[data-post-id="${postId}"] .reels-like-btn`);
    const likeCount = document.querySelector(`[data-post-id="${postId}"] .reels-like-count`);
    if (likeBtn) {
        likeBtn.classList.toggle('liked', isLiked);
        likeBtn.innerHTML = isLiked
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#ff3c3c"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    }
    if (likeCount) {
        likeCount.textContent = formatReactCount(likes.length);
    }
}

// 댓글 추가
async function addReelsComment(postId, text) {
    if (!auth.currentUser || !text.trim()) return;
    const uid = auth.currentUser.uid;
    const reactRef = doc(db, "reels_reactions", postId);
    try {
        const docSnap = await getDoc(reactRef);
        let likes = [];
        let comments = [];
        if (docSnap.exists()) {
            likes = docSnap.data().likes || [];
            comments = docSnap.data().comments || [];
        }
        comments.push({
            uid: uid,
            name: AppState.user.name || '헌터',
            photoURL: AppState.user.photoURL || null,
            instaId: AppState.user.instaId || '',
            linkedinId: AppState.user.linkedinId || '',
            text: text.trim(),
            timestamp: Date.now()
        });
        await setDoc(reactRef, { likes, comments }, { merge: true });
        // UI 업데이트
        renderCommentsSection(postId, comments);
    } catch(e) { window.AppLogger && window.AppLogger.error('[Reels] 댓글 실패: ' + (e.message || e)); }
}

// 댓글 섹션 렌더링
function renderCommentsSection(postId, comments) {
    const lang = AppState.currentLang;
    const container = document.querySelector(`[data-post-id="${postId}"] .reels-comments-list`);
    const countEl = document.querySelector(`[data-post-id="${postId}"] .reels-comment-count`);
    if (!container) return;

    const instaSvgSmall = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16" style="color:#ff3c3c;"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 8 0zm0 1.44c2.136 0 2.409.01 3.264.048.789.037 1.213.15 1.494.263.372.145.639.319.918.598.28.28.453.546.598.918.113.281.226.705.263 1.494.039.855.048 1.128.048 3.264s-.01 2.409-.048 3.264c-.037.789-.15 1.213-.263 1.494-.145.372-.319.639-.598.918-.28.28-.546.453-.918.598-.281.113-.705.226-1.494.263-.855.039-1.128.048-3.264.048s-2.409-.01-3.264-.048c-.789-.037-1.213-.15-1.494-.263-.372-.145-.639-.319-.918-.598-.28-.28-.453-.546-.598-.918-.113-.281-.226-.705-.263-1.494-.039-.855-.048-1.128-.048-3.264s.01-2.409.048-3.264c.037-.789.15-1.213.263-1.494.145-.372.319-.639.598-.918.28-.28.546-.453.918-.598.281-.113.705-.226 1.494-.263.855-.039 1.128-.048 3.264-.048z"/><path d="M8 3.89a4.11 4.11 0 1 0 0 8.22 4.11 4.11 0 0 0 0-8.22zm0 1.44a2.67 2.67 0 1 1 0 5.34 2.67 2.67 0 0 1 0-5.34z"/><path d="M12.333 4.667a.96.96 0 1 0 0-1.92.96.96 0 0 0 0 1.92z"/></svg>`;
    const linkedinSvgSmall = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16" style="color:#0077b5;"><path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z"/></svg>`;

    if (comments.length === 0) {
        container.innerHTML = `<div class="reels-comment-empty">${i18n[lang].reels_comment_empty}</div>`;
    } else {
        container.innerHTML = comments.map(c => {
            const cPhoto = c.photoURL ? sanitizeURL(c.photoURL) : DEFAULT_PROFILE_SVG;
            const instaBtn = c.instaId ? `<button onclick="window.open('https://instagram.com/${sanitizeInstaId(c.instaId)}', '_blank')" class="reels-comment-insta-btn">${instaSvgSmall}</button>` : '';
            const linkedinBtn = c.linkedinId ? `<button onclick="window.openLinkedInProfile('${sanitizeLinkedInId(c.linkedinId)}')" class="reels-comment-insta-btn">${linkedinSvgSmall}</button>` : '';
            const timeAgo = getTimeAgo(c.timestamp, lang);
            return `<div class="reels-comment-item">
                <img class="reels-comment-avatar" src="${cPhoto}" referrerpolicy="no-referrer" onerror="this.onerror=null;window._retryFirebaseImg(this,'${sanitizeAttr(cPhoto)}','${DEFAULT_PROFILE_SVG}')" alt="" onclick="window.openProfileStatsModal('${sanitizeAttr(c.uid)}')" style="cursor:pointer;">
                <div class="reels-comment-body">
                    <div class="reels-comment-meta">
                        <span class="reels-comment-name" onclick="window.openProfileStatsModal('${sanitizeAttr(c.uid)}')" style="cursor:pointer;">${sanitizeText(c.name || '헌터')}</span>${instaBtn}${linkedinBtn}
                        <span class="reels-comment-time">${timeAgo}</span>
                    </div>
                    <div class="reels-comment-text">${sanitizeText(c.text).replace(/\n/g,'<br>')}</div>
                </div>
            </div>`;
        }).join('');
    }

    if (countEl) {
        countEl.textContent = formatReactCount(comments.length);
    }
}

// 시간 경과 표시
function getTimeAgo(ts, lang) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return lang === 'ko' ? '방금' : lang === 'ja' ? 'たった今' : 'now';
    if (diff < 3600) {
        const m = Math.floor(diff / 60);
        return lang === 'ko' ? `${m}분 전` : lang === 'ja' ? `${m}分前` : `${m}m`;
    }
    const h = Math.floor(diff / 3600);
    return lang === 'ko' ? `${h}시간 전` : lang === 'ja' ? `${h}時間前` : `${h}h`;
}

// 댓글 토글 (접기/펼치기)
function toggleCommentsPanel(postId) {
    const panel = document.querySelector(`[data-post-id="${postId}"] .reels-comments-panel`);
    if (panel) {
        panel.classList.toggle('open');
    }
}

// ===== 신고 기능 =====

// 신고 토글
async function toggleReportPost(postId) {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const lang = AppState.currentLang;

    const reportRef = doc(db, "post_reports", postId);
    try {
        const docSnap = await getDoc(reportRef);
        let reporters = [];
        if (docSnap.exists()) {
            reporters = docSnap.data().reporters || [];
        }
        const alreadyReported = reporters.some(r => r.uid === uid);

        if (alreadyReported) {
            showToast(i18n[lang].reels_already_reported || '이미 신고한 게시물입니다.');
            return;
        }

        // 객관식 신고 사유 모달 표시
        const reasons = i18n[lang].reels_report_reasons || [
            "혐오/차별적/생명경시/욕설 표현입니다.",
            "스팸홍보/도배입니다.",
            "청소년에게 유해한 내용입니다.",
            "불법정보를 포함하고 있습니다.",
            "음란물입니다.",
            "불쾌한 표현이 있습니다."
        ];
        const title = i18n[lang].reels_report_title || '사유선택';
        const submitText = i18n[lang].reels_report_submit || '신고하기';
        const cancelText = i18n[lang].reels_report_cancel || '취소';

        const reason = await showReportReasonModal(reasons, title, submitText, cancelText, lang);
        if (!reason) return;

        reporters.push({
            uid: uid,
            name: AppState.user.name || '헌터',
            reason: reason,
            timestamp: Date.now()
        });

        await setDoc(reportRef, {
            postId: postId,
            reporters: reporters,
            reportCount: reporters.length,
            lastReportedAt: Date.now()
        }, { merge: true });

        showToast(i18n[lang].reels_reported || '신고가 접수되었습니다.');

        const warningEl = document.querySelector(`[data-report-warning="${postId}"]`);
        if (warningEl) warningEl.style.display = 'flex';

        const reportBtn = document.querySelector(`[data-post-id="${postId}"] .reels-report-btn`);
        if (reportBtn) {
            reportBtn.classList.add('reported');
            reportBtn.disabled = true;
        }
    } catch(e) {
        window.AppLogger && window.AppLogger.error('[Reels] 신고 실패: ' + (e.message || e));
        showToast(i18n[lang].reels_report_fail || '신고 처리에 실패했습니다.');
    }
}

// 신고 사유 선택 모달
function showReportReasonModal(reasons, title, submitText, cancelText, lang) {
    return new Promise((resolve) => {
        // 기존 모달 제거
        const existing = document.getElementById('report-reason-modal');
        if (existing) existing.remove();

        // ★ 네이티브 광고 숨김 (모달 위에 겹치지 않도록)
        let _adWasVisible = false;
        if (isNativePlatform && window.AdManager && window.AdManager.nativeAdActiveTab) {
            _adWasVisible = true;
            try {
                const { NativeAd } = window.Capacitor.Plugins;
                if (NativeAd) NativeAd.hideAd();
            } catch (e) { /* 무시 */ }
        }

        const overlay = document.createElement('div');
        overlay.id = 'report-reason-modal';
        overlay.className = 'report-modal-overlay';

        const reasonItems = reasons.map((r, i) => `
            <label class="report-reason-item" for="report-reason-${i}">
                <input type="radio" name="report-reason" id="report-reason-${i}" value="${r}">
                <span class="report-reason-radio"></span>
                <span class="report-reason-text">${r}</span>
            </label>
        `).join('');

        overlay.innerHTML = `
            <div class="report-modal-content">
                <h3 class="report-modal-title">${title}</h3>
                <div class="report-reason-list">
                    ${reasonItems}
                </div>
                <div class="report-modal-actions">
                    <button class="report-modal-btn report-modal-cancel">${cancelText}</button>
                    <button class="report-modal-btn report-modal-submit">${submitText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('active'));

        const cleanup = (value) => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 200);
            // ★ 네이티브 광고 복원
            if (_adWasVisible && isNativePlatform) {
                try {
                    const { NativeAd } = window.Capacitor.Plugins;
                    if (NativeAd) NativeAd.resumeAd();
                } catch (e) { /* 무시 */ }
            }
            resolve(value);
        };

        overlay.querySelector('.report-modal-cancel').addEventListener('click', () => cleanup(null));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup(null);
        });

        overlay.querySelector('.report-modal-submit').addEventListener('click', () => {
            const selected = overlay.querySelector('input[name="report-reason"]:checked');
            if (!selected) {
                showToast(i18n[lang].reels_report_select_reason || '신고 사유를 선택해주세요.');
                return;
            }
            cleanup(selected.value);
        });
    });
}

// 신고 상태 로드
async function loadReportStatus(postId) {
    try {
        const docSnap = await getDoc(doc(db, "post_reports", postId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            const uid = auth.currentUser?.uid;
            const reporters = data.reporters || [];

            if (reporters.length > 0) {
                const warningEl = document.querySelector(`[data-report-warning="${postId}"]`);
                if (warningEl) warningEl.style.display = 'flex';
            }

            if (reporters.some(r => r.uid === uid)) {
                const reportBtn = document.querySelector(`[data-post-id="${postId}"] .reels-report-btn`);
                if (reportBtn) {
                    reportBtn.classList.add('reported');
                    reportBtn.disabled = true;
                }
            }
        }
    } catch(e) { /* skip */ }
}

// 시간표 폴딩/언폴딩 토글
function toggleScheduleFold(postId) {
    const extra = document.querySelector(`[data-fold-extra="${postId}"]`);
    const icon = document.querySelector(`[data-fold-icon="${postId}"]`);
    const label = document.querySelector(`[data-fold-label="${postId}"]`);
    if (!extra) return;
    const isOpen = extra.classList.toggle('open');
    if (icon) icon.textContent = isOpen ? '▲' : '▼';
    const lang = localStorage.getItem('lang') || 'ko';
    if (label) {
        if (isOpen) {
            label.textContent = lang === 'ko' ? '접기' : lang === 'ja' ? '折りたたむ' : 'Show less';
        } else {
            const count = extra.querySelectorAll('.reels-block-item').length;
            label.textContent = `+${count} more`;
        }
    }
}

// 전역 등록 (onclick에서 호출)







    // --- Public API (window.* 노출) ---
    window.filterReelsFeed = filterReelsFeed;
    window.openCopyPlannerModal = openCopyPlannerModal;
    window.closeCopyPlannerModal = closeCopyPlannerModal;
    window.confirmCopyPlanner = confirmCopyPlanner;
    window.renderReelsFeed = renderReelsFeed;
    window.updateReelsResetTimer = updateReelsResetTimer;
    window.postToReels = postToReels;
    window.updateLocalReelsProfileImage = updateLocalReelsProfileImage;
    window.toggleReelsLike = toggleReelsLike;
    window.addReelsComment = addReelsComment;
    window.toggleCommentsPanel = toggleCommentsPanel;
    window.toggleScheduleFold = toggleScheduleFold;
    window.toggleReportPost = toggleReportPost;
    window.openLocationModal = openLocationModal;
    window.closeLocationModal = closeLocationModal;
    window.selectLocation = selectLocation;
    window.removeSelectedLocation = removeSelectedLocation;
    window.onLocationSearchInput = onLocationSearchInput;
    window.useCurrentLocation = useCurrentLocation;
    window.mergeConsecutiveBlocks = mergeConsecutiveBlocks;
    window.formatReelsTime = formatReelsTime;
    window.getMoodEmoji = getMoodEmoji;
    // _reelsCachedPosts를 getter로 노출 (프로필 모달에서 접근)
    Object.defineProperty(window, '_reelsCachedPosts', {
        get: function() { return _reelsCachedPosts; },
        configurable: true
    });
    // _reelsSortMode를 getter/setter로 노출 (정렬 버튼에서 접근)
    Object.defineProperty(window, '_reelsSortMode', {
        get: function() { return _reelsSortMode; },
        set: function(v) { _reelsSortMode = v; },
        configurable: true
    });
    // _reelsCategoryFilter를 getter/setter로 노출 (카테고리 버튼에서 접근)
    Object.defineProperty(window, '_reelsCategoryFilter', {
        get: function() { return _reelsCategoryFilter; },
        set: function(v) { _reelsCategoryFilter = v; },
        configurable: true
    });

})();
