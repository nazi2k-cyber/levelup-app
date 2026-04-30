const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const Anthropic = require("@anthropic-ai/sdk");

let _db;
function db() {
    if (!_db) _db = getFirestore();
    return _db;
}

const TRIGGER_OPTS = { region: "asia-northeast3" };
const MODEL = "claude-haiku-4-5-20251001";

// ─── 도구 정의 ───
const TOOLS = [
    {
        name: "disable_user_account",
        description: "Firebase Auth에서 해당 사용자 계정을 비활성화합니다. 심각한 보안 위협(스탯 조작, 고위험 브루트포스)에 사용하세요.",
        input_schema: {
            type: "object",
            properties: {
                uid: { type: "string", description: "Firebase UID" },
                reason: { type: "string", description: "비활성화 사유" },
            },
            required: ["uid", "reason"],
        },
    },
    {
        name: "revoke_user_sessions",
        description: "해당 사용자의 Firebase refresh token을 강제 만료합니다. 계정 탈취 의심 시 사용하세요.",
        input_schema: {
            type: "object",
            properties: { uid: { type: "string" } },
            required: ["uid"],
        },
    },
    {
        name: "revoke_admin_claim",
        description: "해당 사용자의 admin/adminOperator 커스텀 클레임을 회수합니다. 비정상 권한 부여 시 사용하세요.",
        input_schema: {
            type: "object",
            properties: {
                uid: { type: "string" },
                reason: { type: "string" },
            },
            required: ["uid", "reason"],
        },
    },
    {
        name: "backup_user_data",
        description: "users/{uid} Firestore 문서를 ai_bot_snapshots 컬렉션에 스냅샷 저장합니다. 수정 전 반드시 먼저 호출하세요.",
        input_schema: {
            type: "object",
            properties: { uid: { type: "string" } },
            required: ["uid"],
        },
    },
    {
        name: "flag_for_review",
        description: "security_review_queue에 수동 검토 항목을 등록합니다. 자동 조치가 불충분하거나 사람의 판단이 필요한 경우 사용하세요.",
        input_schema: {
            type: "object",
            properties: {
                uid: { type: "string" },
                reason: { type: "string" },
                priority: {
                    type: "string",
                    enum: ["immediate", "within_30min", "business_hours"],
                    description: "immediate=즉각, within_30min=30분 내, business_hours=업무시간 내",
                },
            },
            required: ["uid", "reason", "priority"],
        },
    },
];

const SYSTEM_PROMPT = `당신은 보안 이벤트 자동 대응 봇입니다. Firebase 앱에서 탐지된 security_finding을 분석하고 아래 원칙에 따라 적절한 도구를 호출하세요.

## 룰별 대응 원칙

### stats_manipulation (Critical — 스탯 조작 의심)
데이터 직접 조작 증거이므로 즉각 대응합니다.
1. backup_user_data → 2. disable_user_account → 3. flag_for_review(immediate)

### login_failure_spike (High — 로그인 실패 폭증)
score에 따라 대응 강도를 조절합니다.
- score 90 이상: disable_user_account + revoke_user_sessions + flag_for_review(immediate)
- score 80~89: disable_user_account + flag_for_review(within_30min)
- score 80 미만: flag_for_review(business_hours)만 수행

### admin_claim_suspicious (High — 어드민 클레임 이상)
비정상 권한 부여이므로 클레임을 즉시 회수합니다.
1. revoke_admin_claim → 2. revoke_user_sessions → 3. flag_for_review(within_30min)

### repeat_points_spike (High — 반복 포인트 급증)
포인트 롤백은 사람이 판단해야 하므로 플래그만 등록합니다.
- flag_for_review(within_30min)만 수행

### dormant_admin_access (Medium — 휴면 어드민 접근)
어드민 계정 자동 비활성화는 금지입니다. 플래그만 등록합니다.
- flag_for_review(business_hours)만 수행

## 절대 금지 사항
- isMaster가 true인 계정에 대해 disable_user_account, revoke_admin_claim 호출 금지
- 데이터 삭제 또는 직접 수정
- backup_user_data 없이 disable_user_account 호출 (stats_manipulation 룰에서)

## 응답 형식
도구 호출 전에 한국어로 간단한 분석 텍스트를 먼저 작성하고, 그 다음 필요한 도구들을 순서대로 호출하세요.`;

// ─── Firestore + env 에서 Claude 설정 로드 ───
async function loadClaudeConfig() {
    try {
        const snap = await db().collection("admin_config").doc("ai_bot").get();
        const data = snap.exists ? snap.data() : {};
        return {
            apiKey: data.claudeApiKey || process.env.CLAUDE_API_KEY || null,
            dryRun: data.aiDryRun === true || process.env.AI_BOT_DRY_RUN === "true",
        };
    } catch {
        return {
            apiKey: process.env.CLAUDE_API_KEY || null,
            dryRun: process.env.AI_BOT_DRY_RUN === "true",
        };
    }
}

// ─── 마스터 어드민 여부 확인 ───
async function isMasterAdmin(uid) {
    try {
        const user = await getAuth().getUser(uid);
        const masterEmails = (process.env.ADMIN_MASTER_EMAIL || "").split(",").map((e) => e.trim()).filter(Boolean);
        if (masterEmails.includes(user.email)) return true;
        return !!(user.customClaims?.master);
    } catch {
        return false;
    }
}

// ─── 도구 실행 ───
async function executeTool(toolName, toolInput, findingId, isDryRun) {
    if (isDryRun) {
        console.log(`[AIBot][DryRun] ${toolName}`, JSON.stringify(toolInput));
        return { success: true, dryRun: true };
    }

    try {
        switch (toolName) {
            case "disable_user_account": {
                await getAuth().updateUser(toolInput.uid, { disabled: true });
                console.log(`[AIBot] 계정 비활성화 완료 uid=${toolInput.uid}`);
                return { success: true };
            }
            case "revoke_user_sessions": {
                await getAuth().revokeRefreshTokens(toolInput.uid);
                console.log(`[AIBot] 세션 만료 완료 uid=${toolInput.uid}`);
                return { success: true };
            }
            case "revoke_admin_claim": {
                const userRecord = await getAuth().getUser(toolInput.uid);
                const existing = userRecord.customClaims || {};
                const updated = { ...existing, admin: false, adminOperator: false };
                await getAuth().setCustomUserClaims(toolInput.uid, updated);
                console.log(`[AIBot] 어드민 클레임 회수 완료 uid=${toolInput.uid}`);
                return { success: true };
            }
            case "backup_user_data": {
                const userSnap = await db().collection("users").doc(toolInput.uid).get();
                const snapshotId = `${toolInput.uid}_${Date.now()}`;
                await db().collection("ai_bot_snapshots").doc(snapshotId).set({
                    uid: toolInput.uid,
                    findingId,
                    data: userSnap.exists ? userSnap.data() : null,
                    snapshotAt: FieldValue.serverTimestamp(),
                });
                console.log(`[AIBot] 사용자 데이터 백업 완료 uid=${toolInput.uid} snapshot=${snapshotId}`);
                return { success: true, snapshotId };
            }
            case "flag_for_review": {
                await db().collection("security_review_queue").add({
                    uid: toolInput.uid,
                    reason: toolInput.reason,
                    priority: toolInput.priority,
                    findingId,
                    createdAt: FieldValue.serverTimestamp(),
                    resolved: false,
                });
                console.log(`[AIBot] 검토 플래그 등록 uid=${toolInput.uid} priority=${toolInput.priority}`);
                return { success: true };
            }
            default:
                return { success: false, error: `알 수 없는 도구: ${toolName}` };
        }
    } catch (e) {
        console.error(`[AIBot] ${toolName} 실행 실패:`, e.message);
        return { success: false, error: e.message };
    }
}

// ─── Claude API 호출 ───
async function runClaudeAgent(finding, isMaster, apiKey) {
    const client = new Anthropic({ apiKey });

    const userMessage = `다음 보안 탐지 결과를 분석하고 적절한 조치를 취하세요.

ruleId: ${finding.ruleId}
ruleName: ${finding.ruleName}
severity: ${finding.severity}
score: ${finding.score}
clusterKey: ${finding.clusterKey}
eventCount: ${finding.eventCount}건
isMaster: ${isMaster}
탐지 시각: ${new Date().toISOString()}`;

    const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: [
            {
                type: "text",
                text: SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" },
            },
        ],
        tools: TOOLS,
        messages: [{ role: "user", content: userMessage }],
    });

    return response;
}

// ─── dry-run 시 규칙 기반 기본 액션 결정 ───
function buildDryRunActions(finding, uid) {
    const { ruleId, severity, score } = finding;
    const actions = [];

    if (ruleId === "stats_manipulation") {
        if (uid) actions.push({ name: "backup_user_data", input: { uid } });
        if (uid) actions.push({ name: "disable_user_account", input: { uid, reason: "스탯 조작 탐지 — 자동 대응" } });
        if (uid) actions.push({ name: "flag_for_review", input: { uid, reason: "스탯 조작 의심", priority: "immediate" } });
    } else if (ruleId === "login_failure_spike") {
        if (uid && score >= 90) {
            actions.push({ name: "disable_user_account", input: { uid, reason: "고강도 브루트포스 공격 탐지" } });
            actions.push({ name: "revoke_user_sessions", input: { uid } });
            actions.push({ name: "flag_for_review", input: { uid, reason: "로그인 실패 폭증 (score≥90)", priority: "immediate" } });
        } else if (uid && score >= 80) {
            actions.push({ name: "disable_user_account", input: { uid, reason: "브루트포스 의심 탐지" } });
            actions.push({ name: "flag_for_review", input: { uid, reason: "로그인 실패 폭증 (score 80-89)", priority: "within_30min" } });
        } else if (uid) {
            actions.push({ name: "flag_for_review", input: { uid, reason: "로그인 실패 폭증 관찰", priority: "business_hours" } });
        }
    } else if (ruleId === "admin_claim_suspicious") {
        if (uid) actions.push({ name: "revoke_admin_claim", input: { uid, reason: "비정상 어드민 클레임 부여 탐지" } });
        if (uid) actions.push({ name: "revoke_user_sessions", input: { uid } });
        if (uid) actions.push({ name: "flag_for_review", input: { uid, reason: "어드민 클레임 이상", priority: "within_30min" } });
    } else if (ruleId === "repeat_points_spike") {
        if (uid) actions.push({ name: "flag_for_review", input: { uid, reason: "반복 포인트 급증 — 수동 검토 필요", priority: "within_30min" } });
    } else if (ruleId === "dormant_admin_access") {
        if (uid) actions.push({ name: "flag_for_review", input: { uid, reason: "휴면 어드민 접근 감지", priority: "business_hours" } });
    }

    return actions;
}

// ─── 메인 핸들러 ───
exports.onSecurityFindingCreated = onDocumentCreated(
    { ...TRIGGER_OPTS, document: "security_findings/{findingId}" },
    async (event) => {
        const findingId = event.params.findingId;
        const finding = event.data.data();

        if (!finding) {
            console.warn(`[AIBot] finding 데이터 없음 findingId=${findingId}`);
            return;
        }

        // Idempotency: 이미 처리된 finding인지 확인
        const existingLog = await db()
            .collection("ai_bot_action_logs")
            .where("findingId", "==", findingId)
            .limit(1)
            .get();
        if (!existingLog.empty) {
            console.log(`[AIBot] 이미 처리된 finding — skip findingId=${findingId}`);
            return;
        }

        const { ruleId, severity, score, clusterKey } = finding;
        console.log(`[AIBot] 처리 시작 findingId=${findingId} ruleId=${ruleId} severity=${severity} score=${score}`);

        // clusterKey에서 uid 추출
        const uid = clusterKey?.startsWith("uid:") ? clusterKey.slice(4) : null;

        // 마스터 어드민 여부 확인
        const isMaster = uid ? await isMasterAdmin(uid) : false;
        if (isMaster) {
            console.warn(`[AIBot] 마스터 어드민 탐지 — 계정 수정 도구 제한 uid=${uid}`);
        }

        const { apiKey, dryRun: configDryRun } = await loadClaudeConfig();
        const isDryRun = !apiKey || configDryRun;

        let claudeReasoning = null;
        let actionsPlanned = [];
        let actionsExecuted = [];

        if (isDryRun) {
            claudeReasoning = "[dry-run] Claude API Key 미설정 — 규칙 기반 기본 액션 결정";
            const actions = buildDryRunActions(finding, uid);
            actionsPlanned = actions.map((a) => a.name);

            for (const action of actions) {
                if (isMaster && ["disable_user_account", "revoke_admin_claim"].includes(action.name)) {
                    actionsExecuted.push({ tool: action.name, input: action.input, result: { success: false, error: "마스터 어드민 보호됨" } });
                    continue;
                }
                const result = await executeTool(action.name, action.input, findingId, true);
                actionsExecuted.push({ tool: action.name, input: action.input, result });
            }
        } else {
            try {
                const response = await runClaudeAgent(finding, isMaster, apiKey);

                // Claude 텍스트 응답 수집
                const textBlocks = response.content.filter((b) => b.type === "text");
                claudeReasoning = textBlocks.map((b) => b.text).join("\n").trim();

                // tool_use 블록 순서대로 실행
                const toolUses = response.content.filter((b) => b.type === "tool_use");
                actionsPlanned = toolUses.map((t) => t.name);

                for (const toolUse of toolUses) {
                    const { name, input } = toolUse;

                    // 마스터 어드민 보호 가드
                    if (isMaster && ["disable_user_account", "revoke_admin_claim"].includes(name)) {
                        console.warn(`[AIBot] 마스터 어드민 보호 — ${name} 차단 uid=${uid}`);
                        actionsExecuted.push({ tool: name, input, result: { success: false, error: "마스터 어드민 보호됨" } });
                        continue;
                    }

                    const result = await executeTool(name, input, findingId, false);
                    actionsExecuted.push({ tool: name, input, result });
                }
            } catch (e) {
                console.error(`[AIBot] Claude API 호출 실패:`, e.message);
                claudeReasoning = `Claude API 오류: ${e.message}`;
            }
        }

        // ai_bot_action_logs 저장
        const logRef = await db().collection("ai_bot_action_logs").add({
            findingId,
            ruleId,
            severity,
            score,
            clusterKey,
            uid: uid || null,
            isMaster,
            claudeReasoning,
            actionsPlanned,
            actionsExecuted,
            dryRun: isDryRun,
            executedAt: FieldValue.serverTimestamp(),
        });

        // security_findings 문서에 botActionLogId 업데이트
        try {
            await db().collection("security_findings").doc(findingId).update({
                botActionLogId: logRef.id,
                botActionsExecuted: actionsExecuted.filter((a) => a.result.success).map((a) => a.tool),
            });
        } catch (e) {
            console.warn(`[AIBot] finding 업데이트 실패:`, e.message);
        }

        console.log(`[AIBot] 처리 완료 findingId=${findingId} logId=${logRef.id} actions=${actionsPlanned.join(",")} dryRun=${isDryRun}`);
    }
);
