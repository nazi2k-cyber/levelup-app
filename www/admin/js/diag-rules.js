// ─── Firestore Rules + AppLogger Analyzer ───
import { esc } from "./utils.js";
import { tlog, tok, twarn, terror } from "./log-panel.js";

// ─── Firestore Rules Reference ───
const RULES_MAP = [
    {
        collection: "users/{userId}",
        read: "인증된 모든 사용자",
        write: "본인 문서만 + 필드 검증",
        errors: [
            { pattern: "write", cause: "다른 사용자의 문서에 쓰기 시도 또는 필드 검증 실패" },
            { pattern: "read", cause: "인증되지 않은 상태에서 읽기 시도" }
        ],
        validations: [
            "name: string, 1~50자",
            "level: number, 1~999",
            "points: number, ≥ 0",
            "stats/pendingStats: {str, int, cha, vit, wlth, agi} — 모두 number ≥ 0",
            "friends: array, 최대 500",
            "questStr: string, ≤ 10KB",
            "diaryStr: string, ≤ 500KB",
            "reelsStr: string, ≤ 500KB",
            "dungeonStr: string, ≤ 50KB"
        ]
    },
    {
        collection: "push_logs/{logId}",
        read: "관리자만 (admin == true)",
        write: "불가 (Cloud Functions만)",
        errors: [
            { pattern: "read", cause: "Admin claim이 없는 사용자의 읽기 시도" },
            { pattern: "write", cause: "클라이언트에서 직접 쓰기 불가 (Cloud Functions Admin SDK만 가능)" }
        ],
        validations: []
    },
    {
        collection: "push_feedback/{feedbackId}",
        read: "관리자만",
        write: "인증된 사용자 생성만 (수정/삭제 불가)",
        errors: [
            { pattern: "read", cause: "Admin claim이 없는 사용자의 읽기 시도" },
            { pattern: "create", cause: "필드 타입 불일치 — received는 string 타입이어야 함" }
        ],
        validations: [
            "device: string",
            "os: string",
            "received: string (예: 'yes', 'no', 'foreground', 'background')",
            "type: string",
            "memo: string, ≤ 2000자",
            "reporter: string"
        ]
    },
    {
        collection: "reels_reactions/{postId}",
        read: "인증된 모든 사용자",
        write: "인증된 사용자 + 구조 검증",
        errors: [
            { pattern: "write", cause: "likes/comments 배열 크기 초과 또는 필드 누락" }
        ],
        validations: [
            "likes: array, 최대 1000",
            "comments: array, 최대 500"
        ]
    },
    {
        collection: "app_config/{docId}",
        read: "인증된 모든 사용자",
        write: "관리자만 (admin == true)",
        errors: [
            { pattern: "write", cause: "Admin claim이 없는 사용자의 쓰기 시도" }
        ],
        validations: []
    }
];

// ─── Known Error Patterns for Diagnosis ───
const ERROR_PATTERNS = [
    {
        match: /permission[_-]?denied|missing or insufficient permissions/i,
        severity: "critical",
        tag: "PERMISSION",
        title: "Firestore 권한 오류",
        diagnose: (entry) => {
            const msg = entry.msg.toLowerCase();
            const matched = [];
            for (const r of RULES_MAP) {
                const col = r.collection.split("/")[0];
                if (msg.includes(col)) matched.push(r);
            }
            if (matched.length > 0) {
                return {
                    cause: matched.map(r =>
                        `<strong>${esc(r.collection)}</strong>:\n` +
                        r.errors.map(e => `  • ${e.pattern}: ${esc(e.cause)}`).join("\n")
                    ).join("\n\n"),
                    fixes: [
                        "Admin claim 확인 → 진단 탭에서 권한 진단 실행",
                        "토큰 갱신 → Claim 관리 탭에서 토큰 강제 갱신",
                        "필드 검증 확인 → 아래 보안 규칙 참조 확인"
                    ]
                };
            }
            // Detect from tag
            if (msg.includes("[db]") || msg.includes("저장 실패")) {
                return {
                    cause: "Firestore users 문서 쓰기 실패.\n가능한 원인:\n  • 다른 UID의 문서에 쓰기 시도 (auth.uid ≠ docId)\n  • 필드 검증 실패 (타입 불일치, 크기 초과, 허용되지 않은 필드)\n  • level이 number가 아닌 string으로 저장 시도",
                    fixes: [
                        "saveUserData()에서 전송하는 payload 필드 타입 확인",
                        "level, points 등 숫자 필드가 Number() 변환되었는지 확인",
                        "허용 필드 목록: name, level, points, stats, pendingStats, friends 등 (firestore.rules 참조)"
                    ]
                };
            }
            return {
                cause: "정확한 컬렉션을 식별할 수 없습니다.\n일반적 원인:\n  • Admin claim 미설정\n  • 토큰 만료 (stale token)\n  • 다른 사용자 문서에 쓰기 시도\n  • 필드 검증 실패",
                fixes: [
                    "진단 탭에서 전체 진단 실행",
                    "Claim 관리 탭에서 토큰 갱신",
                    "Firebase 콘솔 > Firestore > 규칙 탭에서 시뮬레이터로 재현 테스트"
                ]
            };
        }
    },
    {
        match: /unauthenticated|auth.*null|not.*logged/i,
        severity: "critical",
        tag: "AUTH",
        title: "인증 오류",
        diagnose: () => ({
            cause: "사용자가 인증되지 않은 상태에서 Firestore 작업을 시도했습니다.\nonAuthStateChanged 콜백 전에 DB 접근이 발생했을 수 있습니다.",
            fixes: [
                "onAuthStateChanged()에서 user 확인 후 DB 작업 수행",
                "auth.currentUser가 null인 경우 early return 처리",
                "네트워크 불안정으로 인한 세션 만료 확인"
            ]
        })
    },
    {
        match: /quota[_-]?exceeded|resource[_-]?exhausted/i,
        severity: "warning",
        tag: "QUOTA",
        title: "할당량 초과",
        diagnose: () => ({
            cause: "Firestore 읽기/쓰기 할당량이 초과되었습니다.\nSpark(무료) 요금제: 일 50K reads, 20K writes.",
            fixes: [
                "Firebase 콘솔에서 사용량 확인",
                "불필요한 getDocs() 호출 캐싱 적용",
                "실시간 리스너 대신 일회성 getDoc() 사용 검토"
            ]
        })
    },
    {
        match: /network[_-]?error|failed to fetch|net::err|webchannel|offline/i,
        severity: "warning",
        tag: "NETWORK",
        title: "네트워크 오류",
        diagnose: () => ({
            cause: "네트워크 연결 문제로 Firebase 작업이 실패했습니다.\nWebChannel 전송 오류 또는 인터넷 연결 끊김.",
            fixes: [
                "네트워크 연결 상태 확인",
                "Firestore 오프라인 지속성(enablePersistence) 활성화 여부 확인",
                "재시도 로직 추가 고려"
            ]
        })
    },
    {
        match: /storage.*upload|upload.*fail|프로필.*실패|마이그레이션.*실패/i,
        severity: "warning",
        tag: "STORAGE",
        title: "Storage 업로드 오류",
        diagnose: () => ({
            cause: "Firebase Storage 파일 업로드 실패.\n이미지 크기 제한 또는 Storage 규칙 위반 가능.",
            fixes: [
                "프로필 이미지: 500KB 이하로 압축",
                "플래너 사진: 2MB 이하로 압축",
                "Storage 규칙에서 인증 확인: request.auth != null"
            ]
        })
    },
    {
        match: /reels.*실패|리액션.*실패|좋아요.*실패|피드.*실패/i,
        severity: "warning",
        tag: "REELS",
        title: "Day1/Reels 오류",
        diagnose: (entry) => {
            const msg = entry.msg.toLowerCase();
            if (msg.includes("리액션") || msg.includes("좋아요")) {
                return {
                    cause: "reels_reactions 컬렉션 쓰기 실패.\nlikes 배열 1000개 또는 comments 배열 500개 초과 가능.",
                    fixes: [
                        "reels_reactions 문서의 likes/comments 배열 크기 확인",
                        "arrayUnion/arrayRemove 사용 시 동시성 충돌 확인"
                    ]
                };
            }
            return {
                cause: "Reels 관련 작업 실패. Firestore 또는 Storage 오류 가능.",
                fixes: [
                    "reelsStr 필드 크기 500KB 제한 확인",
                    "Storage reels_photos 경로 권한 확인",
                    "24시간 자동 삭제 함수와의 타이밍 충돌 확인"
                ]
            };
        }
    },
    {
        match: /planner.*실패|diary.*실패|planner.*error/i,
        severity: "info",
        tag: "PLANNER",
        title: "플래너/다이어리 오류",
        diagnose: () => ({
            cause: "플래너 데이터 저장 또는 사진 업로드 실패.\ndiaryStr 필드 크기 제한(500KB) 초과 또는 localStorage 용량 부족 가능.",
            fixes: [
                "diaryStr 문자열 크기 확인 (최대 500KB)",
                "localStorage 용량 확인 (모바일: ~5MB 제한)",
                "플래너 사진 2MB 이하 확인"
            ]
        })
    },
    {
        match: /google.*로그인.*실패|signin.*error|auth.*error|credential/i,
        severity: "critical",
        tag: "GOOGLE_AUTH",
        title: "Google 로그인 오류",
        diagnose: (entry) => {
            const msg = entry.msg;
            const codeMatch = msg.match(/code=(\S+)/);
            const code = codeMatch ? codeMatch[1] : "";
            if (code.includes("popup") || code.includes("cancelled")) {
                return {
                    cause: "사용자가 Google 로그인 팝업을 취소했거나 팝업이 차단되었습니다.",
                    fixes: ["팝업 차단 해제 확인", "Capacitor GoogleAuth 플러그인 설정 확인"]
                };
            }
            return {
                cause: `Google 인증 실패 (code: ${code || "unknown"}).\nOAuth 설정 또는 SHA-1 인증서 문제 가능.`,
                fixes: [
                    "Firebase 콘솔 > Authentication > Sign-in method > Google 활성화 확인",
                    "Android: SHA-1/SHA-256 인증서 등록 확인",
                    "Capacitor GoogleAuth clientId 설정 확인"
                ]
            };
        }
    },
    {
        match: /fcm|push.*fail|notification.*error|messaging/i,
        severity: "info",
        tag: "FCM",
        title: "푸시 알림 오류",
        diagnose: () => ({
            cause: "FCM 토큰 등록 또는 푸시 알림 전송 실패.",
            fixes: [
                "FCM 토큰이 유효한지 확인 (30일 미사용 시 자동 정리)",
                "알림 권한 허용 여부 확인",
                "Cloud Functions 로그에서 sendNotification 오류 확인"
            ]
        })
    }
];

// ─── AppLogger Log Parser ───
const LOG_LINE_RE = /^\[([^\]]+)\]\s*\[(\w+)\]\s*\[(\w+)\]\s*(.+)$/;
const STACK_LINE_RE = /^\s+at\s/;

function parseAppLogs(rawText) {
    const lines = rawText.split("\n");
    const entries = [];
    let current = null;

    for (const line of lines) {
        // Skip header lines
        if (line.startsWith("===") || line.startsWith("생성 시각") || line.startsWith("총 ") || line.trim() === "" || line.startsWith("====")) {
            continue;
        }

        const m = line.match(LOG_LINE_RE);
        if (m) {
            if (current) entries.push(current);
            current = {
                ts: m[1],
                level: m[2].toUpperCase(),
                env: m[3],
                msg: m[4],
                stack: ""
            };
        } else if (current && STACK_LINE_RE.test(line)) {
            current.stack += (current.stack ? "\n" : "") + line;
        } else if (current) {
            // Continuation of message
            current.msg += "\n" + line.trim();
        }
    }
    if (current) entries.push(current);
    return entries;
}

// ─── Diagnosis Engine ───
function diagnoseEntry(entry) {
    for (const pattern of ERROR_PATTERNS) {
        if (pattern.match.test(entry.msg)) {
            const detail = pattern.diagnose(entry);
            return { ...pattern, ...detail };
        }
    }
    return {
        severity: "info",
        tag: "UNKNOWN",
        title: "미분류 오류",
        cause: entry.msg,
        fixes: ["Firebase 콘솔 로그에서 상세 정보 확인", "오류 메시지의 에러 코드로 Firebase 문서 검색"]
    };
}

function generatePrompt(entries, diagResults) {
    const errorEntries = entries.filter(e => e.level === "ERROR" || e.level === "WARN");
    if (errorEntries.length === 0) return "분석할 오류가 없습니다.";

    // Group by diagnosis tag
    const groups = {};
    diagResults.forEach((d, i) => {
        if (!groups[d.tag]) groups[d.tag] = [];
        groups[d.tag].push({ diag: d, entry: errorEntries[i] });
    });

    let prompt = `다음은 LEVEL UP: REBOOT 모바일 앱(Capacitor + Firebase)의 AppLogger에서 수집된 오류 로그입니다.\n각 오류를 분석하고 수정 코드를 제안해주세요.\n\n`;
    prompt += `## 앱 환경\n- Firebase project: levelup-app-53d02\n- Firestore 보안 규칙: firestore.rules\n- Cloud Functions: functions/index.js (asia-northeast3)\n- 클라이언트: www/app.js (Vanilla JS + Capacitor)\n\n`;

    prompt += `## 오류 로그 (${errorEntries.length}건)\n\n`;

    for (const [tag, items] of Object.entries(groups)) {
        prompt += `### [${tag}] ${items[0].diag.title} (${items.length}건)\n\n`;
        items.forEach((item, idx) => {
            prompt += `**오류 ${idx + 1}:**\n`;
            prompt += `\`\`\`\n[${item.entry.ts}] [${item.entry.level}] [${item.entry.env}] ${item.entry.msg}\n`;
            if (item.entry.stack) prompt += `${item.entry.stack}\n`;
            prompt += `\`\`\`\n`;
            prompt += `- 진단: ${item.diag.cause.split("\n")[0]}\n`;
        });
        prompt += `\n**수정 방향:**\n`;
        items[0].diag.fixes.forEach(f => { prompt += `- ${f}\n`; });
        prompt += `\n`;
    }

    prompt += `## 요청사항\n`;
    prompt += `1. 위 오류들의 근본 원인을 파악하고, 관련 파일(app.js, firestore.rules, functions/index.js)에서 수정이 필요한 부분을 찾아주세요.\n`;
    prompt += `2. 수정 코드를 구체적으로 제시해주세요 (변경 전 → 변경 후).\n`;
    prompt += `3. 동일 오류 재발 방지를 위한 방어 코드도 추가해주세요.\n`;

    return prompt;
}

// ─── Render ───
let _container = null;

export function initDiagRules(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
            <h2>AppLogger 오류 분석기</h2>
            <p class="text-sub text-sm mb-8">
                모바일 앱의 AppLogger 로그를 붙여넣거나 파일을 드래그하면 자동 진단 후 수정 프롬프트를 생성합니다.
            </p>
            <div class="analyzer-input-area" id="drop-zone">
                <textarea id="error-input" placeholder="AppLogger 로그를 붙여넣으세요...

예시 형식:
[2026-03-19T10:30:45.123Z] [ERROR] [web] DB 저장 실패: permission-denied Missing or insufficient permissions
    at saveUserData (app.js:779:12)

또는 로그 파일(.txt)을 여기에 드래그 & 드롭"></textarea>
                <div class="analyzer-drop-hint">파일 드래그 & 드롭 가능</div>
            </div>
            <div class="analyzer-toolbar">
                <button class="btn btn-primary btn-sm" onclick="window._analyzeAppLog()">분석 + 프롬프트 생성</button>
                <button class="btn btn-outline btn-sm" onclick="window._clearAnalysis()">초기화</button>
                <label class="btn btn-outline btn-sm" style="cursor:pointer;">
                    파일 선택
                    <input type="file" accept=".txt,.log" id="file-input" style="display:none" onchange="window._loadFile(event)">
                </label>
                <span class="text-sub text-sm" id="analyzer-status"></span>
            </div>
        </div>

        <div id="analysis-result" style="display:none;">
            <div class="card">
                <h2>분석 결과</h2>
                <div class="log-stats-bar" id="log-stats"></div>
                <div id="parsed-logs-preview"></div>
            </div>

            <div class="card">
                <h2>진단 리포트</h2>
                <div id="diag-report"></div>
            </div>

            <div class="card">
                <h2>수정 명령 프롬프트</h2>
                <p class="text-sub text-sm mb-8">아래 프롬프트를 복사하여 Claude 또는 AI 도구에 전달하세요.</p>
                <div style="position:relative;">
                    <button class="prompt-copy-btn" onclick="window._copyPrompt()">복사</button>
                    <div class="prompt-output" id="generated-prompt"></div>
                </div>
            </div>
        </div>

        <div class="card" style="margin-top: 16px;">
            <h2>Firestore 보안 규칙 참조</h2>
            <p class="text-sub text-sm mb-16">
                각 컬렉션의 접근 권한과 필드 검증 규칙을 확인합니다.
            </p>
            <div id="rules-table-wrap">
                ${RULES_MAP.map(r => `
                    <div class="card" style="background: var(--bg-input); margin-bottom: 12px;">
                        <h2 style="font-size: 0.9rem;">${esc(r.collection)}</h2>
                        <table>
                            <tr><th style="width:80px">읽기</th><td>${esc(r.read)}</td></tr>
                            <tr><th>쓰기</th><td>${esc(r.write)}</td></tr>
                        </table>
                        ${r.errors.length ? `
                            <div class="mt-8">
                                <strong class="text-sm text-error">오류 원인:</strong>
                                <ul style="margin: 4px 0 0 16px; font-size: 0.8rem;">
                                    ${r.errors.map(e => `<li><code>${e.pattern}</code> → ${esc(e.cause)}</li>`).join("")}
                                </ul>
                            </div>
                        ` : ""}
                        ${r.validations.length ? `
                            <div class="mt-8">
                                <strong class="text-sm" style="color: var(--accent);">필드 검증:</strong>
                                <ul style="margin: 4px 0 0 16px; font-size: 0.78rem; color: var(--text-sub);">
                                    ${r.validations.map(v => `<li>${esc(v)}</li>`).join("")}
                                </ul>
                            </div>
                        ` : ""}
                    </div>
                `).join("")}
            </div>
        </div>
    `;

    // Setup drag & drop
    const dropZone = document.getElementById("drop-zone");
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        const file = e.dataTransfer.files[0];
        if (file) readFile(file);
    });
}

function readFile(file) {
    const status = document.getElementById("analyzer-status");
    status.textContent = `${file.name} 로딩 중...`;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById("error-input").value = e.target.result;
        status.textContent = `${file.name} (${(file.size / 1024).toFixed(1)}KB) 로드됨`;
        tlog("Analyzer", `파일 로드: ${file.name}`);
    };
    reader.readAsText(file);
}

window._loadFile = function(event) {
    const file = event.target.files[0];
    if (file) readFile(file);
};

window._analyzeAppLog = function() {
    const raw = document.getElementById("error-input").value.trim();
    if (!raw) return;

    tlog("Analyzer", "로그 분석 시작...");
    const entries = parseAppLogs(raw);

    if (entries.length === 0) {
        document.getElementById("analyzer-status").textContent = "파싱 가능한 로그를 찾을 수 없습니다.";
        twarn("Analyzer", "No parseable log entries found");
        return;
    }

    const errors = entries.filter(e => e.level === "ERROR");
    const warns = entries.filter(e => e.level === "WARN");
    const infos = entries.filter(e => e.level !== "ERROR" && e.level !== "WARN");

    // Stats bar
    document.getElementById("log-stats").innerHTML = `
        <span>전체: <strong>${entries.length}</strong>건</span>
        <span>ERROR: <span class="count-error">${errors.length}</span></span>
        <span>WARN: <span class="count-warn">${warns.length}</span></span>
        <span>INFO/기타: ${infos.length}</span>
    `;

    // Preview parsed logs (show max 20 error/warn entries)
    const previewEntries = [...errors, ...warns].slice(0, 20);
    document.getElementById("parsed-logs-preview").innerHTML = previewEntries.map(e => `
        <div class="parsed-log">
            <span class="log-ts">[${esc(e.ts)}]</span>
            <span class="log-lv-${e.level.toLowerCase() === 'error' ? 'error' : e.level.toLowerCase() === 'warn' ? 'warn' : 'info'}">[${e.level}]</span>
            <span class="log-env">[${esc(e.env)}]</span>
            <span class="log-msg">${esc(e.msg)}</span>
            ${e.stack ? `<div class="log-stack">${esc(e.stack)}</div>` : ""}
        </div>
    `).join("") + (errors.length + warns.length > 20 ? `<p class="text-sub text-sm mt-8">... 외 ${errors.length + warns.length - 20}건</p>` : "");

    // Diagnose errors and warnings
    const targetEntries = [...errors, ...warns];
    const diagResults = targetEntries.map(e => diagnoseEntry(e));

    // Group diagnoses by tag for the report
    const grouped = {};
    diagResults.forEach((d, i) => {
        if (!grouped[d.tag]) grouped[d.tag] = { diag: d, count: 0, entries: [] };
        grouped[d.tag].count++;
        grouped[d.tag].entries.push(targetEntries[i]);
    });

    document.getElementById("diag-report").innerHTML = Object.values(grouped).map(g => `
        <div class="diag-result severity-${g.diag.severity}">
            <div class="diag-result-header">
                <span class="badge badge-${g.diag.severity === 'critical' ? 'fail' : g.diag.severity === 'warning' ? 'warn' : 'info'}">
                    ${g.diag.severity === 'critical' ? 'CRITICAL' : g.diag.severity === 'warning' ? 'WARNING' : 'INFO'}
                </span>
                <span class="diag-result-title">${esc(g.diag.title)} (${g.count}건)</span>
            </div>
            <div class="diag-result-body">
                <p>${esc(g.diag.cause || "").replace(/\n/g, "<br>")}</p>
                ${g.diag.fixes ? `
                    <ul>
                        ${g.diag.fixes.map(f => `<li>${esc(f)}</li>`).join("")}
                    </ul>
                ` : ""}
            </div>
        </div>
    `).join("");

    // Generate prompt
    const prompt = generatePrompt(entries, diagResults);
    document.getElementById("generated-prompt").textContent = prompt;

    // Show results
    document.getElementById("analysis-result").style.display = "";

    tok("Analyzer", `분석 완료: ${entries.length}건 파싱, ${errors.length} errors, ${warns.length} warns, ${Object.keys(grouped).length} 진단 그룹`);
};

window._clearAnalysis = function() {
    document.getElementById("error-input").value = "";
    document.getElementById("analysis-result").style.display = "none";
    document.getElementById("analyzer-status").textContent = "";
    tlog("Analyzer", "초기화됨");
};

window._copyPrompt = function() {
    const prompt = document.getElementById("generated-prompt").textContent;
    navigator.clipboard.writeText(prompt).then(() => {
        const btn = document.querySelector(".prompt-copy-btn");
        btn.textContent = "복사됨!";
        setTimeout(() => { btn.textContent = "복사"; }, 1500);
        tok("Analyzer", "프롬프트 클립보드 복사 완료");
    });
};
