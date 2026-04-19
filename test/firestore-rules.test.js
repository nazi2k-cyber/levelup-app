/**
 * Firestore Security Rules 자동화 테스트
 *
 * 실행 방법:
 *   npm run test:rules          (에뮬레이터 자동 시작 후 테스트)
 *   npm run test:security       (rules 테스트 + npm audit)
 *
 * 사전 조건:
 *   firebase-tools 설치: npm install -g firebase-tools
 *   에뮬레이터 설치: firebase setup:emulators:firestore
 */

'use strict';

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  Timestamp,
} = require('firebase/firestore');
const { readFileSync } = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// 환경 초기화
// ──────────────────────────────────────────────

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-levelup-test',
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}, 30000);

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

afterEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});

// ──────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────

function authDb(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}

function unauthDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seedDoc(collectionPath, docId, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionPath, docId), data);
  });
}

// ──────────────────────────────────────────────
// users 컬렉션
// ──────────────────────────────────────────────

describe('users 컬렉션', () => {
  const UID_A = 'user-alice';
  const UID_B = 'user-bob';

  const baseUser = { name: 'Alice', level: 1, points: 100 };

  // 읽기
  describe('읽기', () => {
    it('인증 유저는 타인 문서 읽기 가능 (소셜 기능)', async () => {
      const db = authDb(UID_A);
      await assertSucceeds(getDoc(doc(db, 'users', UID_B)));
    });

    it('비인증 유저는 읽기 불가', async () => {
      await assertFails(getDoc(doc(unauthDb(), 'users', UID_A)));
    });
  });

  // 생성
  describe('생성', () => {
    it('본인 문서 생성 가능 (유효한 필드)', async () => {
      const db = authDb(UID_A);
      await assertSucceeds(setDoc(doc(db, 'users', UID_A), baseUser));
    });

    it('타인 uid로 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(setDoc(doc(db, 'users', UID_B), baseUser));
    });

    it('name 30자 초과 시 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), { ...baseUser, name: 'A'.repeat(31) })
      );
    });

    it('name 빈 문자열 시 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), { ...baseUser, name: '' })
      );
    });

    it('level이 문자열인 경우 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), { ...baseUser, level: 'ten' })
      );
    });

    it('level이 999 초과인 경우 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), { ...baseUser, level: 1000 })
      );
    });

    it('points가 음수인 경우 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), { ...baseUser, points: -1 })
      );
    });

    it('stats 맵의 허용되지 않은 키 포함 시 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), {
          ...baseUser,
          stats: { str: 10, hax: 999 }, // hax는 허용 안 됨
        })
      );
    });

    it('stats 스탯 값 9999 초과 시 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), {
          ...baseUser,
          stats: { str: 10000 },
        })
      );
    });

    it('stats 값이 음수인 경우 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), {
          ...baseUser,
          stats: { str: -1 },
        })
      );
    });

    it('friends 배열 500개 이하 허용', async () => {
      const db = authDb(UID_A);
      await assertSucceeds(
        setDoc(doc(db, 'users', UID_A), {
          ...baseUser,
          friends: Array(500).fill('uid'),
        })
      );
    });

    it('friends 배열 500개 초과 시 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), {
          ...baseUser,
          friends: Array(501).fill('uid'),
        })
      );
    });

    it('photoURL 1024자 이하 허용', async () => {
      const db = authDb(UID_A);
      await assertSucceeds(
        setDoc(doc(db, 'users', UID_A), {
          ...baseUser,
          photoURL: 'https://example.com/' + 'x'.repeat(990),
        })
      );
    });

    it('photoURL 1024자 초과 시 생성 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        setDoc(doc(db, 'users', UID_A), {
          ...baseUser,
          photoURL: 'https://' + 'x'.repeat(1020),
        })
      );
    });
  });

  // 수정
  describe('수정', () => {
    beforeEach(async () => {
      await seedDoc('users', UID_A, { ...baseUser, points: 1000, level: 5 });
    });

    it('본인 문서 수정 가능', async () => {
      const db = authDb(UID_A);
      await assertSucceeds(
        updateDoc(doc(db, 'users', UID_A), { name: 'Alice Updated' })
      );
    });

    it('타인 문서 수정 불가', async () => {
      const db = authDb(UID_B);
      await assertFails(
        updateDoc(doc(db, 'users', UID_A), { points: 9999 })
      );
    });

    it('포인트 50,000 이하 증가 허용 (경계값 51000 = 1000 + 50000)', async () => {
      const db = authDb(UID_A);
      await assertSucceeds(
        updateDoc(doc(db, 'users', UID_A), { points: 51000 })
      );
    });

    it('포인트 50,000 초과 급증 시 수정 불가 (51001 = 1000 + 50001)', async () => {
      const db = authDb(UID_A);
      await assertFails(
        updateDoc(doc(db, 'users', UID_A), { points: 51001 })
      );
    });

    it('레벨 1 증가 허용 (5 → 6)', async () => {
      const db = authDb(UID_A);
      await assertSucceeds(
        updateDoc(doc(db, 'users', UID_A), { level: 6 })
      );
    });

    it('레벨 2 이상 급상승 시 수정 불가 (5 → 7)', async () => {
      const db = authDb(UID_A);
      await assertFails(
        updateDoc(doc(db, 'users', UID_A), { level: 7 })
      );
    });

    it('5초 이내 재업데이트 불가 (lastUpdatedAt 빈도 제한)', async () => {
      // lastUpdatedAt을 현재 시각(방금 전)으로 설정
      await seedDoc('users', UID_A, {
        ...baseUser,
        points: 1000,
        level: 5,
        lastUpdatedAt: Timestamp.now(),
      });
      const db = authDb(UID_A);
      await assertFails(
        updateDoc(doc(db, 'users', UID_A), { name: 'Too Soon' })
      );
    });

    it('lastUpdatedAt 없는 문서는 빈도 제한 없이 수정 가능 (하위호환)', async () => {
      // beforeEach에서 seedDoc이 lastUpdatedAt 없이 생성됨
      const db = authDb(UID_A);
      await assertSucceeds(
        updateDoc(doc(db, 'users', UID_A), { name: 'No Rate Limit' })
      );
    });

    it('syncEnabled가 boolean이 아닌 경우 수정 불가', async () => {
      const db = authDb(UID_A);
      await assertFails(
        updateDoc(doc(db, 'users', UID_A), { syncEnabled: 'yes' })
      );
    });
  });

  // 삭제
  describe('삭제', () => {
    beforeEach(async () => {
      await seedDoc('users', UID_A, baseUser);
    });

    it('본인 문서 삭제 가능 (Google 정책 준수)', async () => {
      const db = authDb(UID_A);
      await assertSucceeds(deleteDoc(doc(db, 'users', UID_A)));
    });

    it('타인 문서 삭제 불가', async () => {
      const db = authDb(UID_B);
      await assertFails(deleteDoc(doc(db, 'users', UID_A)));
    });
  });

  // notifications 서브컬렉션
  describe('notifications 서브컬렉션', () => {
    it('본인 알림 읽기 가능', async () => {
      const db = authDb(UID_A);
      await assertSucceeds(
        getDocs(collection(db, 'users', UID_A, 'notifications'))
      );
    });

    it('타인 알림 읽기 불가', async () => {
      const db = authDb(UID_B);
      await assertFails(
        getDocs(collection(db, 'users', UID_A, 'notifications'))
      );
    });

    it('클라이언트에서 알림 쓰기 불가 (Cloud Functions 전용)', async () => {
      const db = authDb(UID_A);
      await assertFails(
        addDoc(collection(db, 'users', UID_A, 'notifications'), {
          msg: 'hack',
        })
      );
    });
  });
});

// ──────────────────────────────────────────────
// usernames 컬렉션
// ──────────────────────────────────────────────

describe('usernames 컬렉션', () => {
  const UID_A = 'user-alice';
  const UID_B = 'user-bob';

  it('인증 유저는 읽기 가능', async () => {
    const db = authDb(UID_A);
    await assertSucceeds(getDoc(doc(db, 'usernames', 'alice')));
  });

  it('비인증 유저는 읽기 불가', async () => {
    await assertFails(getDoc(doc(unauthDb(), 'usernames', 'alice')));
  });

  it('본인 uid로 닉네임 생성 가능', async () => {
    const db = authDb(UID_A);
    await assertSucceeds(
      setDoc(doc(db, 'usernames', 'alice'), {
        uid: UID_A,
        name: 'Alice',
        claimedAt: Date.now(),
      })
    );
  });

  it('타인 uid로 닉네임 생성 불가 (스쿼팅 방지)', async () => {
    const db = authDb(UID_A);
    await assertFails(
      setDoc(doc(db, 'usernames', 'bob'), {
        uid: UID_B,
        name: 'Bob',
        claimedAt: Date.now(),
      })
    );
  });

  it('허용되지 않은 필드 포함 시 생성 불가', async () => {
    const db = authDb(UID_A);
    await assertFails(
      setDoc(doc(db, 'usernames', 'alice'), {
        uid: UID_A,
        name: 'Alice',
        claimedAt: Date.now(),
        extraField: 'bad',
      })
    );
  });

  it('name 빈 문자열 시 생성 불가', async () => {
    const db = authDb(UID_A);
    await assertFails(
      setDoc(doc(db, 'usernames', 'alice'), {
        uid: UID_A,
        name: '',
        claimedAt: Date.now(),
      })
    );
  });

  it('name 30자 초과 시 생성 불가', async () => {
    const db = authDb(UID_A);
    await assertFails(
      setDoc(doc(db, 'usernames', 'alice'), {
        uid: UID_A,
        name: 'A'.repeat(31),
        claimedAt: Date.now(),
      })
    );
  });

  it('claimedAt이 숫자가 아닌 경우 생성 불가', async () => {
    const db = authDb(UID_A);
    await assertFails(
      setDoc(doc(db, 'usernames', 'alice'), {
        uid: UID_A,
        name: 'Alice',
        claimedAt: '2026-01-01',
      })
    );
  });

  it('기존 소유자가 닉네임 수정 가능', async () => {
    await seedDoc('usernames', 'alice', {
      uid: UID_A,
      name: 'Alice',
      claimedAt: Date.now(),
    });
    const db = authDb(UID_A);
    await assertSucceeds(
      updateDoc(doc(db, 'usernames', 'alice'), { uid: UID_A, name: 'Alice2' })
    );
  });

  it('타인은 닉네임 수정 불가', async () => {
    await seedDoc('usernames', 'alice', {
      uid: UID_A,
      name: 'Alice',
      claimedAt: Date.now(),
    });
    const db = authDb(UID_B);
    await assertFails(
      updateDoc(doc(db, 'usernames', 'alice'), { uid: UID_B, name: 'Stolen' })
    );
  });

  it('기존 소유자가 닉네임 삭제 가능', async () => {
    await seedDoc('usernames', 'alice', {
      uid: UID_A,
      name: 'Alice',
      claimedAt: Date.now(),
    });
    const db = authDb(UID_A);
    await assertSucceeds(deleteDoc(doc(db, 'usernames', 'alice')));
  });

  it('타인은 닉네임 삭제 불가', async () => {
    await seedDoc('usernames', 'alice', {
      uid: UID_A,
      name: 'Alice',
      claimedAt: Date.now(),
    });
    const db = authDb(UID_B);
    await assertFails(deleteDoc(doc(db, 'usernames', 'alice')));
  });
});

// ──────────────────────────────────────────────
// push_logs 컬렉션
// ──────────────────────────────────────────────

describe('push_logs 컬렉션', () => {
  it('관리자(admin claim)는 읽기 가능', async () => {
    const db = authDb('admin-user', { admin: true });
    await assertSucceeds(getDoc(doc(db, 'push_logs', 'log-1')));
  });

  it('운영자(adminOperator claim)는 읽기 가능', async () => {
    const db = authDb('op-user', { adminOperator: true });
    await assertSucceeds(getDoc(doc(db, 'push_logs', 'log-1')));
  });

  it('일반 유저는 읽기 불가', async () => {
    await assertFails(getDoc(doc(authDb('normal-user'), 'push_logs', 'log-1')));
  });

  it('비인증 유저는 읽기 불가', async () => {
    await assertFails(getDoc(doc(unauthDb(), 'push_logs', 'log-1')));
  });

  it('클라이언트에서 쓰기 불가 (관리자 포함)', async () => {
    const db = authDb('admin-user', { admin: true });
    await assertFails(
      setDoc(doc(db, 'push_logs', 'log-new'), { msg: 'test' })
    );
  });
});

// ──────────────────────────────────────────────
// push_feedback 컬렉션
// ──────────────────────────────────────────────

describe('push_feedback 컬렉션', () => {
  const validFeedback = {
    device: 'iPhone 15',
    os: 'iOS 17',
    received: 'yes',
    type: 'notification',
    memo: '알림이 늦게 도착했습니다.',
    timestamp: Date.now(),
    reporter: 'alice',
  };

  it('인증 유저는 피드백 생성 가능', async () => {
    const db = authDb('user-test');
    await assertSucceeds(addDoc(collection(db, 'push_feedback'), validFeedback));
  });

  it('비인증 유저는 피드백 생성 불가', async () => {
    await assertFails(
      addDoc(collection(unauthDb(), 'push_feedback'), validFeedback)
    );
  });

  it('허용되지 않은 필드 포함 시 생성 불가', async () => {
    const db = authDb('user-test');
    await assertFails(
      addDoc(collection(db, 'push_feedback'), {
        ...validFeedback,
        extraField: 'bad',
      })
    );
  });

  it('memo 2000자 초과 시 생성 불가', async () => {
    const db = authDb('user-test');
    await assertFails(
      addDoc(collection(db, 'push_feedback'), {
        ...validFeedback,
        memo: 'x'.repeat(2001),
      })
    );
  });

  it('관리자는 피드백 읽기 가능', async () => {
    const db = authDb('admin-user', { admin: true });
    await assertSucceeds(getDocs(collection(db, 'push_feedback')));
  });

  it('일반 유저는 피드백 읽기 불가', async () => {
    await assertFails(
      getDocs(collection(authDb('user-test'), 'push_feedback'))
    );
  });

  it('기존 문서 수정 불가 (allow update: false)', async () => {
    // create는 허용되므로 먼저 seed한 뒤 update 시도
    await seedDoc('push_feedback', 'fb-1', validFeedback);
    const db = authDb('admin-user', { admin: true });
    await assertFails(
      updateDoc(doc(db, 'push_feedback', 'fb-1'), { memo: 'hacked' })
    );
  });

  it('기존 문서 삭제 불가 (allow delete: false)', async () => {
    await seedDoc('push_feedback', 'fb-1', validFeedback);
    const db = authDb('admin-user', { admin: true });
    await assertFails(deleteDoc(doc(db, 'push_feedback', 'fb-1')));
  });
});

// ──────────────────────────────────────────────
// reels_reactions 컬렉션
// ──────────────────────────────────────────────

describe('reels_reactions 컬렉션', () => {
  it('인증 유저는 읽기 가능', async () => {
    const db = authDb('user-test');
    await assertSucceeds(getDoc(doc(db, 'reels_reactions', 'post-1')));
  });

  it('비인증 유저는 읽기 불가', async () => {
    await assertFails(getDoc(doc(unauthDb(), 'reels_reactions', 'post-1')));
  });

  it('유효한 구조(likes + comments 배열)로 쓰기 가능', async () => {
    const db = authDb('user-test');
    await assertSucceeds(
      setDoc(doc(db, 'reels_reactions', 'post-1'), {
        likes: ['uid-a', 'uid-b'],
        comments: [{ uid: 'uid-a', text: 'good' }],
      })
    );
  });

  it('허용되지 않은 필드 포함 시 쓰기 불가', async () => {
    const db = authDb('user-test');
    await assertFails(
      setDoc(doc(db, 'reels_reactions', 'post-1'), {
        likes: [],
        comments: [],
        extraField: 'bad',
      })
    );
  });

  it('likes가 배열이 아닌 경우 쓰기 불가', async () => {
    const db = authDb('user-test');
    await assertFails(
      setDoc(doc(db, 'reels_reactions', 'post-1'), {
        likes: 'not-an-array',
        comments: [],
      })
    );
  });

  it('비인증 유저는 쓰기 불가', async () => {
    await assertFails(
      setDoc(doc(unauthDb(), 'reels_reactions', 'post-1'), {
        likes: [],
        comments: [],
      })
    );
  });
});

// ──────────────────────────────────────────────
// post_reports 컬렉션
// ──────────────────────────────────────────────

describe('post_reports 컬렉션', () => {
  const validReport = {
    postId: 'post-abc',
    reporters: ['uid-a'],
    reportCount: 1,
    lastReportedAt: Date.now(),
  };

  it('인증 유저는 읽기 가능', async () => {
    const db = authDb('user-test');
    await assertSucceeds(getDoc(doc(db, 'post_reports', 'post-abc')));
  });

  it('비인증 유저는 읽기 불가', async () => {
    await assertFails(getDoc(doc(unauthDb(), 'post_reports', 'post-abc')));
  });

  it('유효한 구조로 쓰기 가능', async () => {
    const db = authDb('user-test');
    await assertSucceeds(
      setDoc(doc(db, 'post_reports', 'post-abc'), validReport)
    );
  });

  it('허용되지 않은 필드 포함 시 쓰기 불가', async () => {
    const db = authDb('user-test');
    await assertFails(
      setDoc(doc(db, 'post_reports', 'post-abc'), {
        ...validReport,
        extraField: 'bad',
      })
    );
  });

  it('reporters가 배열이 아닌 경우 쓰기 불가', async () => {
    const db = authDb('user-test');
    await assertFails(
      setDoc(doc(db, 'post_reports', 'post-abc'), {
        ...validReport,
        reporters: 'not-array',
      })
    );
  });

  it('reportCount가 숫자가 아닌 경우 쓰기 불가', async () => {
    const db = authDb('user-test');
    await assertFails(
      setDoc(doc(db, 'post_reports', 'post-abc'), {
        ...validReport,
        reportCount: 'one',
      })
    );
  });

  it('비인증 유저는 쓰기 불가', async () => {
    await assertFails(
      setDoc(doc(unauthDb(), 'post_reports', 'post-abc'), validReport)
    );
  });
});

// ──────────────────────────────────────────────
// app_config 컬렉션
// ──────────────────────────────────────────────

describe('app_config 컬렉션', () => {
  it('인증 유저(일반)는 읽기 가능', async () => {
    const db = authDb('normal-user');
    await assertSucceeds(getDoc(doc(db, 'app_config', 'settings')));
  });

  it('비인증 유저는 읽기 불가', async () => {
    await assertFails(getDoc(doc(unauthDb(), 'app_config', 'settings')));
  });

  it('관리자(admin)는 쓰기 가능', async () => {
    const db = authDb('admin-user', { admin: true });
    await assertSucceeds(
      setDoc(doc(db, 'app_config', 'settings'), { theme: 'dark' })
    );
  });

  it('운영자(adminOperator)는 쓰기 가능', async () => {
    const db = authDb('op-user', { adminOperator: true });
    await assertSucceeds(
      setDoc(doc(db, 'app_config', 'settings'), { theme: 'light' })
    );
  });

  it('일반 유저는 쓰기 불가', async () => {
    await assertFails(
      setDoc(doc(authDb('normal-user'), 'app_config', 'settings'), {
        theme: 'dark',
      })
    );
  });
});

// ──────────────────────────────────────────────
// announcements 컬렉션
// ──────────────────────────────────────────────

describe('announcements 컬렉션', () => {
  it('인증 유저는 읽기 가능', async () => {
    const db = authDb('user-test');
    await assertSucceeds(getDoc(doc(db, 'announcements', 'ann-1')));
  });

  it('비인증 유저는 읽기 불가', async () => {
    await assertFails(getDoc(doc(unauthDb(), 'announcements', 'ann-1')));
  });

  it('클라이언트에서 쓰기 불가 (관리자 포함, Cloud Functions 전용)', async () => {
    const db = authDb('admin-user', { admin: true });
    await assertFails(
      setDoc(doc(db, 'announcements', 'ann-new'), { title: '긴급 공지' })
    );
  });
});

// ──────────────────────────────────────────────
// app_error_logs 컬렉션
// ──────────────────────────────────────────────

describe('app_error_logs 컬렉션', () => {
  const UID = 'user-test';
  const validLog = {
    uid: UID,
    category: 'auth',
    message: '로그인 실패',
    detail: 'Firebase auth/wrong-password',
    createdAt: Date.now(),
  };

  it('인증 유저는 본인 uid로 에러 로그 생성 가능', async () => {
    const db = authDb(UID);
    await assertSucceeds(addDoc(collection(db, 'app_error_logs'), validLog));
  });

  it('타인 uid를 포함한 로그 생성 불가', async () => {
    const db = authDb(UID);
    await assertFails(
      addDoc(collection(db, 'app_error_logs'), {
        ...validLog,
        uid: 'other-user',
      })
    );
  });

  it('비인증 유저는 로그 생성 불가', async () => {
    await assertFails(
      addDoc(collection(unauthDb(), 'app_error_logs'), validLog)
    );
  });

  it('허용되지 않은 필드 포함 시 생성 불가', async () => {
    const db = authDb(UID);
    await assertFails(
      addDoc(collection(db, 'app_error_logs'), {
        ...validLog,
        extraField: 'bad',
      })
    );
  });

  it('category 40자 초과 시 생성 불가', async () => {
    const db = authDb(UID);
    await assertFails(
      addDoc(collection(db, 'app_error_logs'), {
        ...validLog,
        category: 'x'.repeat(41),
      })
    );
  });

  it('message 500자 초과 시 생성 불가', async () => {
    const db = authDb(UID);
    await assertFails(
      addDoc(collection(db, 'app_error_logs'), {
        ...validLog,
        message: 'x'.repeat(501),
      })
    );
  });

  it('detail 2000자 초과 시 생성 불가', async () => {
    const db = authDb(UID);
    await assertFails(
      addDoc(collection(db, 'app_error_logs'), {
        ...validLog,
        detail: 'x'.repeat(2001),
      })
    );
  });

  it('관리자는 에러 로그 읽기 가능', async () => {
    const db = authDb('admin-user', { admin: true });
    await assertSucceeds(getDocs(collection(db, 'app_error_logs')));
  });

  it('일반 유저는 에러 로그 읽기 불가', async () => {
    await assertFails(
      getDocs(collection(authDb(UID), 'app_error_logs'))
    );
  });
});

// ──────────────────────────────────────────────
// security_alerts 컬렉션
// ──────────────────────────────────────────────

describe('security_alerts 컬렉션', () => {
  it('관리자(admin)는 읽기 가능', async () => {
    const db = authDb('admin-user', { admin: true });
    await assertSucceeds(getDocs(collection(db, 'security_alerts')));
  });

  it('운영자(adminOperator)는 읽기 가능', async () => {
    const db = authDb('op-user', { adminOperator: true });
    await assertSucceeds(getDocs(collection(db, 'security_alerts')));
  });

  it('일반 유저는 읽기 불가', async () => {
    await assertFails(
      getDocs(collection(authDb('normal-user'), 'security_alerts'))
    );
  });

  it('클라이언트에서 쓰기 불가 (관리자 포함)', async () => {
    const db = authDb('admin-user', { admin: true });
    await assertFails(
      addDoc(collection(db, 'security_alerts'), {
        type: 'points_spike',
        userId: 'hacker',
      })
    );
  });
});

// ──────────────────────────────────────────────
// rate_limits 컬렉션
// ──────────────────────────────────────────────

describe('rate_limits 컬렉션', () => {
  it('일반 유저는 읽기 불가', async () => {
    await assertFails(
      getDoc(doc(authDb('normal-user'), 'rate_limits', 'limit-1'))
    );
  });

  it('관리자도 읽기 불가 (호출 횟수 노출 방지)', async () => {
    await assertFails(
      getDoc(doc(authDb('admin-user', { admin: true }), 'rate_limits', 'limit-1'))
    );
  });

  it('일반 유저는 쓰기 불가', async () => {
    await assertFails(
      setDoc(doc(authDb('normal-user'), 'rate_limits', 'limit-1'), {
        count: 1,
      })
    );
  });

  it('관리자도 쓰기 불가', async () => {
    await assertFails(
      setDoc(
        doc(authDb('admin-user', { admin: true }), 'rate_limits', 'limit-1'),
        { count: 1 }
      )
    );
  });
});

// ──────────────────────────────────────────────
// Cloud Functions Admin SDK 전용 컬렉션
// (user_backups / screening_results / screening_config)
// ──────────────────────────────────────────────

describe('Cloud Functions 전용 컬렉션 (쓰기 불가)', () => {
  const ADMIN_DB = () => authDb('admin-user', { admin: true });
  const OP_DB = () => authDb('op-user', { adminOperator: true });
  const NORMAL_DB = () => authDb('normal-user');

  // user_backups
  it('user_backups: 관리자는 읽기 가능', async () => {
    await assertSucceeds(getDocs(collection(ADMIN_DB(), 'user_backups')));
  });

  it('user_backups: 운영자는 읽기 가능', async () => {
    await assertSucceeds(getDocs(collection(OP_DB(), 'user_backups')));
  });

  it('user_backups: 일반 유저는 읽기 불가', async () => {
    await assertFails(getDocs(collection(NORMAL_DB(), 'user_backups')));
  });

  it('user_backups: 클라이언트에서 쓰기 불가 (관리자 포함)', async () => {
    await assertFails(
      addDoc(collection(ADMIN_DB(), 'user_backups'), { data: 'backup' })
    );
  });

  // screening_results
  it('screening_results: 관리자는 읽기 가능', async () => {
    await assertSucceeds(getDocs(collection(ADMIN_DB(), 'screening_results')));
  });

  it('screening_results: 일반 유저는 읽기 불가', async () => {
    await assertFails(getDocs(collection(NORMAL_DB(), 'screening_results')));
  });

  it('screening_results: 클라이언트에서 쓰기 불가', async () => {
    await assertFails(
      addDoc(collection(ADMIN_DB(), 'screening_results'), { result: 'clean' })
    );
  });

  // screening_config
  it('screening_config: 관리자는 읽기 가능', async () => {
    await assertSucceeds(getDocs(collection(ADMIN_DB(), 'screening_config')));
  });

  it('screening_config: 일반 유저는 읽기 불가', async () => {
    await assertFails(getDocs(collection(NORMAL_DB(), 'screening_config')));
  });

  it('screening_config: 클라이언트에서 쓰기 불가', async () => {
    await assertFails(
      addDoc(collection(ADMIN_DB(), 'screening_config'), { enabled: true })
    );
  });
});
