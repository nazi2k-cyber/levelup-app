/**
 * Firestore 보안 규칙 자동화 테스트
 *
 * 실행 방법:
 *   npm run test:rules
 *
 * 사전 준비:
 *   firebase emulators:start --only firestore
 */

const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    RulesTestEnvironment,
} = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, addDoc } =
    require("firebase/firestore");
const fs = require("fs");
const path = require("path");

/** @type {RulesTestEnvironment} */
let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: "levelup-reboot-test",
        firestore: {
            rules: fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"),
            host: "127.0.0.1",
            port: 8080,
        },
    });
});

afterAll(async () => {
    await testEnv.cleanup();
});

afterEach(async () => {
    await testEnv.clearFirestore();
});

// ── users 컬렉션 ──────────────────────────────────────
describe("users 컬렉션", () => {
    it("미인증 유저는 읽기 불가", async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, "users", "user-A")));
    });

    it("인증 유저는 타인 문서 읽기 가능", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "users", "user-B"), { name: "테스트", level: 1, points: 0 });
        });
        const db = testEnv.authenticatedContext("user-A").firestore();
        await assertSucceeds(getDoc(doc(db, "users", "user-B")));
    });

    it("본인 문서는 수정 가능", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "users", "user-A"), { name: "테스트", level: 1, points: 100 });
        });
        const db = testEnv.authenticatedContext("user-A").firestore();
        await assertSucceeds(updateDoc(doc(db, "users", "user-A"), { name: "변경됨" }));
    });

    it("타인 문서 수정 불가", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "users", "user-B"), { name: "테스트", level: 1, points: 0 });
        });
        const db = testEnv.authenticatedContext("user-A").firestore();
        await assertFails(updateDoc(doc(db, "users", "user-B"), { points: 9999 }));
    });

    it("포인트 50,000 초과 1회 증가 불가", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "users", "user-C"), { name: "테스트", level: 1, points: 100 });
        });
        const db = testEnv.authenticatedContext("user-C").firestore();
        await assertFails(updateDoc(doc(db, "users", "user-C"), { points: 200000 }));
    });

    it("포인트 50,000 이하 증가는 허용", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "users", "user-D"), { name: "테스트", level: 1, points: 100 });
        });
        const db = testEnv.authenticatedContext("user-D").firestore();
        await assertSucceeds(updateDoc(doc(db, "users", "user-D"), { points: 1000 }));
    });

    it("레벨 2단계 초과 급상승 불가", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "users", "user-E"), { name: "테스트", level: 1, points: 0 });
        });
        const db = testEnv.authenticatedContext("user-E").firestore();
        await assertFails(updateDoc(doc(db, "users", "user-E"), { level: 10 }));
    });

    it("레벨 1단계 증가는 허용", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "users", "user-F"), { name: "테스트", level: 1, points: 0 });
        });
        const db = testEnv.authenticatedContext("user-F").firestore();
        await assertSucceeds(updateDoc(doc(db, "users", "user-F"), { level: 2 }));
    });

    it("본인 문서 삭제 가능", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "users", "user-del"), { name: "삭제예정" });
        });
        const db = testEnv.authenticatedContext("user-del").firestore();
        await assertSucceeds(deleteDoc(doc(db, "users", "user-del")));
    });
});

// ── security_alerts 컬렉션 ────────────────────────────
describe("security_alerts 컬렉션", () => {
    it("일반 유저는 읽기 불가", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "security_alerts", "alert-1"), { type: "test" });
        });
        const db = testEnv.authenticatedContext("normal-user").firestore();
        await assertFails(getDoc(doc(db, "security_alerts", "alert-1")));
    });

    it("일반 유저는 쓰기 불가", async () => {
        const db = testEnv.authenticatedContext("normal-user").firestore();
        await assertFails(addDoc(collection(db, "security_alerts"), { type: "fake_alert" }));
    });

    it("마스터 토큰 보유자는 읽기 가능", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "security_alerts", "alert-2"), { type: "test" });
        });
        const db = testEnv.authenticatedContext("master-user", { master: true }).firestore();
        await assertSucceeds(getDoc(doc(db, "security_alerts", "alert-2")));
    });
});

// ── rate_limits 컬렉션 ───────────────────────────────
describe("rate_limits 컬렉션", () => {
    it("인증 유저도 읽기 불가 (Cloud Functions 전용)", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "rate_limits", "uid_action"), { calls: 1 });
        });
        const db = testEnv.authenticatedContext("any-user").firestore();
        await assertFails(getDoc(doc(db, "rate_limits", "uid_action")));
    });

    it("인증 유저는 쓰기 불가 (Cloud Functions 전용)", async () => {
        const db = testEnv.authenticatedContext("any-user").firestore();
        await assertFails(setDoc(doc(db, "rate_limits", "uid_action"), { calls: 1 }));
    });
});

// ── app_config 컬렉션 ────────────────────────────────
describe("app_config 컬렉션", () => {
    it("인증 유저는 읽기 가능", async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), "app_config", "settings"), { version: "1.0" });
        });
        const db = testEnv.authenticatedContext("normal-user").firestore();
        await assertSucceeds(getDoc(doc(db, "app_config", "settings")));
    });

    it("일반 유저는 쓰기 불가", async () => {
        const db = testEnv.authenticatedContext("normal-user").firestore();
        await assertFails(setDoc(doc(db, "app_config", "settings"), { evil: true }));
    });
});
