// ─── Firestore Rules Violation Analyzer ───
import { esc } from "./utils.js";

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

let _container = null;

export function initDiagRules(containerId) {
    _container = document.getElementById(containerId);
    render();
}

function render() {
    if (!_container) return;
    _container.innerHTML = `
        <div class="card">
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

        <div class="card">
            <h2>오류 메시지 분석기</h2>
            <p class="text-sub text-sm mb-8">Firebase 오류 메시지를 붙여넣으면 원인을 분석합니다.</p>
            <textarea id="error-input" rows="3" placeholder="Firebase 오류 메시지를 입력하세요..."></textarea>
            <button class="btn btn-outline btn-sm mt-8" onclick="window._analyzeError()">분석</button>
            <div id="error-analysis" class="mt-8"></div>
        </div>
    `;
}

window._analyzeError = function() {
    const input = document.getElementById("error-input").value.trim().toLowerCase();
    const output = document.getElementById("error-analysis");
    if (!input) { output.innerHTML = ""; return; }

    const results = [];

    if (input.includes("missing or insufficient permissions") || input.includes("permission-denied")) {
        // Try to identify which collection
        for (const r of RULES_MAP) {
            const colName = r.collection.split("/")[0];
            if (input.includes(colName)) {
                results.push(`<strong>${esc(r.collection)}</strong> 관련 권한 오류:<br>` +
                    r.errors.map(e => `• <code>${e.pattern}</code>: ${esc(e.cause)}`).join("<br>"));
            }
        }
        if (results.length === 0) {
            results.push(
                `<strong>일반 권한 오류 원인:</strong><br>` +
                `• Admin claim 미설정 (진단 탭에서 확인)<br>` +
                `• 토큰 만료/stale (토큰 갱신 필요)<br>` +
                `• 다른 사용자의 문서에 쓰기 시도<br>` +
                `• 필드 검증 실패 (타입 불일치, 크기 초과)`
            );
        }
    } else if (input.includes("not-found")) {
        results.push("문서가 존재하지 않습니다. 경로를 확인하세요.");
    } else if (input.includes("unauthenticated")) {
        results.push("인증되지 않은 상태입니다. 로그인 후 다시 시도하세요.");
    } else {
        results.push("알 수 없는 오류입니다. Firebase 콘솔에서 상세 로그를 확인하세요.");
    }

    output.innerHTML = results.map(r => `<div class="card" style="background: var(--bg-input); font-size: 0.85rem;">${r}</div>`).join("");
};
