// ─── Post Screening Module (Day1 포스팅 스크리닝) ───
import { functions, httpsCallable } from "./firebase-init.js";
import { tlog, tok, terror } from "./log-panel.js";

let _container = null;
let _posts = [];

const ping = httpsCallable(functions, "ping");

async function callAdmin(action, data = {}) {
    const result = await ping({ action, ...data });
    return result.data;
}

export function initPostScreening(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>Day1 포스팅 스크리닝</h2>
            <p class="text-sub text-sm mb-8">활성 Day1 포스트를 조회하고 부적절한 콘텐츠를 강제 삭제합니다.</p>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <button class="btn btn-outline btn-sm" id="btn-load-posts">포스트 목록 조회</button>
                <span class="text-sub text-sm" id="ps-post-count"></span>
            </div>
            <div id="ps-search-wrap" class="hidden" style="margin-top:12px;">
                <input type="text" id="ps-search" placeholder="작성자, 캡션으로 검색...">
                <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <label class="text-sm" style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                        <input type="checkbox" id="ps-filter-reported"> <span style="color:#ff5252;">신고된 글만 보기</span>
                    </label>
                    <input type="text" id="ps-text-screen" placeholder="텍스트 스크리닝 (캡션 내 특정 단어 필터)..." style="flex:1; min-width:200px;">
                </div>
            </div>
            <div id="ps-post-list" style="margin-top:16px;"></div>
        </div>

        <!-- 포스트 상세 / 삭제 확인 모달 -->
        <div id="ps-detail-panel" class="hidden">
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h2 id="ps-detail-title">포스트 상세</h2>
                    <button class="btn btn-outline btn-sm" id="btn-close-ps-detail">닫기</button>
                </div>
                <div id="ps-detail-content"></div>
                <div style="border-top:1px solid var(--border); padding-top:16px; margin-top:16px;">
                    <button class="btn btn-danger btn-sm" id="btn-force-delete">강제 삭제</button>
                    <span class="text-sub text-sm" style="margin-left:8px;">이 포스트를 즉시 삭제합니다 (복구 불가)</span>
                </div>
                <div id="ps-delete-result" style="margin-top:8px;"></div>
            </div>
        </div>
    `;

    document.getElementById("btn-load-posts").addEventListener("click", loadPosts);
    document.getElementById("btn-close-ps-detail").addEventListener("click", closeDetail);
    document.getElementById("btn-force-delete").addEventListener("click", forceDeletePost);
}

let _selectedPost = null;

let _reportData = {}; // { postId: { reportCount, reporters, ... } }

async function loadPosts() {
    const listEl = document.getElementById("ps-post-list");
    const countEl = document.getElementById("ps-post-count");
    listEl.innerHTML = '<p class="text-sub text-sm">로딩 중...</p>';
    countEl.textContent = "";
    tlog("Screening", "포스트 목록 로딩...");

    try {
        const result = await callAdmin("screeningListPosts");
        _posts = result.posts || [];

        // 신고 데이터 로드
        try {
            const reportResult = await callAdmin("screeningListReports");
            _reportData = {};
            for (const r of (reportResult.reports || [])) {
                _reportData[r.postId] = r;
            }
            // 포스트에 신고 수 첨부
            for (const p of _posts) {
                const pid = `${p.ownerUid}_${p.timestamp}`;
                p._reportCount = _reportData[pid]?.reportCount || 0;
            }
        } catch(e) { /* reports load fail - continue without */ }

        tok("Screening", `${_posts.length}개 활성 포스트 조회 완료`);
        countEl.textContent = `총 ${_posts.length}개`;

        if (_posts.length === 0) {
            listEl.innerHTML = '<p class="text-sub text-sm">활성 포스트가 없습니다.</p>';
            document.getElementById("ps-search-wrap").classList.add("hidden");
            return;
        }

        document.getElementById("ps-search-wrap").classList.remove("hidden");
        listEl.innerHTML = renderPostTable(_posts);
        bindPostClicks();

        // 통합 필터 함수
        function applyFilters() {
            const q = (document.getElementById("ps-search").value || "").toLowerCase();
            const reportedOnly = document.getElementById("ps-filter-reported").checked;
            const textScreen = (document.getElementById("ps-text-screen").value || "").toLowerCase();
            let filtered = _posts;
            if (q) {
                filtered = filtered.filter(p =>
                    (p.ownerName || "").toLowerCase().includes(q) ||
                    (p.caption || "").toLowerCase().includes(q)
                );
            }
            if (reportedOnly) {
                filtered = filtered.filter(p => (p._reportCount || 0) > 0);
            }
            if (textScreen) {
                const keywords = textScreen.split(/[,\s]+/).filter(Boolean);
                filtered = filtered.filter(p =>
                    keywords.some(kw => (p.caption || "").toLowerCase().includes(kw))
                );
            }
            listEl.innerHTML = renderPostTable(filtered);
            countEl.textContent = `총 ${_posts.length}개 / 필터: ${filtered.length}개`;
            bindPostClicks();
        }

        document.getElementById("ps-search").addEventListener("input", applyFilters);
        document.getElementById("ps-filter-reported").addEventListener("change", applyFilters);
        document.getElementById("ps-text-screen").addEventListener("input", applyFilters);
    } catch (e) {
        terror("Screening", "포스트 목록 로드 실패: " + e.message);
        listEl.innerHTML = `<p class="text-error text-sm">오류: ${e.message}</p>`;
    }
}

function renderPostTable(posts) {
    let html = `<table>
        <thead><tr>
            <th>작성자</th>
            <th>캡션</th>
            <th>작성일시</th>
            <th>남은 시간</th>
            <th>신고</th>
        </tr></thead>
        <tbody>`;
    for (const p of posts) {
        const dt = p.timestamp ? new Date(p.timestamp).toLocaleString("ko-KR") : "—";
        const remaining = formatRemaining(p.remainingMs);
        const captionPreview = escHtml((p.caption || "").substring(0, 40)) + (p.caption && p.caption.length > 40 ? "..." : "");
        const thumbHtml = p.photo
            ? `<img src="${escHtml(p.photo)}" class="ps-thumb" alt="" onerror="this.style.display='none'">`
            : '';
        const reportCount = p._reportCount || 0;
        const reportBadge = reportCount > 0
            ? `<span class="badge badge-fail">${reportCount}건</span>`
            : '<span class="text-sub">—</span>';

        html += `<tr class="ps-row${reportCount > 0 ? ' ps-reported' : ''}" data-owner="${p.ownerUid}" data-ts="${p.timestamp}" style="cursor:pointer;">
            <td>${escHtml(p.ownerName)}</td>
            <td class="text-sm"><span style="display:inline-flex; align-items:center; gap:8px;">${thumbHtml}${captionPreview || '<span class="text-sub">—</span>'}</span></td>
            <td class="text-sub text-sm">${dt}</td>
            <td class="text-sm">${remaining}</td>
            <td>${reportBadge}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function bindPostClicks() {
    document.querySelectorAll(".ps-row").forEach(row => {
        row.addEventListener("click", () => {
            const ownerUid = row.dataset.owner;
            const ts = parseInt(row.dataset.ts, 10);
            selectPost(ownerUid, ts);
        });
    });
}

function selectPost(ownerUid, timestamp) {
    _selectedPost = _posts.find(p => p.ownerUid === ownerUid && p.timestamp === timestamp);
    if (!_selectedPost) return;

    const panel = document.getElementById("ps-detail-panel");
    panel.classList.remove("hidden");

    document.getElementById("ps-detail-title").textContent = `${_selectedPost.ownerName}의 포스트`;
    document.getElementById("ps-delete-result").innerHTML = "";

    const dt = _selectedPost.timestamp ? new Date(_selectedPost.timestamp).toLocaleString("ko-KR") : "—";
    const remaining = formatRemaining(_selectedPost.remainingMs);

    let photoHtml = "";
    if (_selectedPost.photo) {
        photoHtml = `<div style="margin-top:12px;">
            <img src="${escHtml(_selectedPost.photo)}" alt="post photo"
                 style="max-width:100%; max-height:300px; border-radius:8px; border:1px solid var(--border);"
                 onerror="this.style.display='none'">
        </div>`;
    }

    document.getElementById("ps-detail-content").innerHTML = `
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-value text-sm">${escHtml(_selectedPost.ownerName)}</div><div class="stat-label">작성자</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${dt}</div><div class="stat-label">작성일시</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${remaining}</div><div class="stat-label">남은 시간</div></div>
            <div class="stat-card"><div class="stat-value text-sm">${escHtml(_selectedPost.mood || "—")}</div><div class="stat-label">기분</div></div>
        </div>
        <p class="text-sub text-sm">UID: ${_selectedPost.ownerUid}</p>
        <div style="margin-top:12px; padding:12px; background:var(--bg-input); border-radius:8px;">
            <p class="text-sm" style="white-space:pre-wrap;">${escHtml(_selectedPost.caption || "(캡션 없음)")}</p>
        </div>
        ${photoHtml}
    `;

    panel.scrollIntoView({ behavior: "smooth" });
}

function closeDetail() {
    document.getElementById("ps-detail-panel").classList.add("hidden");
    _selectedPost = null;
}

async function forceDeletePost() {
    if (!_selectedPost) return;
    const resultEl = document.getElementById("ps-delete-result");

    if (!confirm(`${_selectedPost.ownerName}의 포스트를 강제 삭제하시겠습니까?\n\n캡션: "${(_selectedPost.caption || "").substring(0, 50)}"\n\n이 작업은 복구할 수 없습니다.`)) return;

    tlog("Screening", `포스트 강제 삭제 중: ${_selectedPost.ownerUid}_${_selectedPost.timestamp}`);
    resultEl.innerHTML = '<p class="text-sub text-sm">삭제 중...</p>';

    try {
        const result = await callAdmin("screeningDeletePost", {
            ownerUid: _selectedPost.ownerUid,
            timestamp: _selectedPost.timestamp
        });
        tok("Screening", `포스트 삭제 완료 (남은 포스트: ${result.remainingPosts}개)`);
        resultEl.innerHTML = `<p class="text-success text-sm">삭제 완료! 남은 포스트: ${result.remainingPosts}개</p>`;

        // Remove from local list and refresh
        _posts = _posts.filter(p => !(p.ownerUid === _selectedPost.ownerUid && p.timestamp === _selectedPost.timestamp));
        document.getElementById("ps-post-count").textContent = `총 ${_posts.length}개`;
        document.getElementById("ps-post-list").innerHTML = renderPostTable(_posts);
        bindPostClicks();

        // Close detail after short delay
        setTimeout(() => {
            closeDetail();
        }, 1500);
    } catch (e) {
        terror("Screening", "포스트 삭제 실패: " + e.message);
        resultEl.innerHTML = `<p class="text-error text-sm">삭제 실패: ${e.message}</p>`;
    }
}

function formatRemaining(ms) {
    if (!ms || ms <= 0) return '<span class="text-error">만료됨</span>';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}시간 ${mins}분`;
    return `${mins}분`;
}

function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
