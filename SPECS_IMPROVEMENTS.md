# LEVEL UP: REBOOT — 최적 통합 개선안

> SPECS.md 기준 코드베이스 실사 → Gemini/Codex 제안 비교 분석 → 최적 방안 도출

---

## 제안 비교 분석표

| # | 개선 항목 | Gemini | Codex | 최종 판정 | 근거 |
|---|----------|--------|-------|-----------|------|
| 1 | **이미지 포맷 현대화 (WebP)** | 서버 sharp+WebP/AVIF | 클라이언트 WebP+JPEG fallback | **Codex ✓** | 서버 sharp는 CF 비용↑ + cold start↑. `canvas.toDataURL('image/webp')` 클라이언트 처리가 현 아키텍처에 부합 |
| 2 | **서버 자동 리사이징/썸네일** | CF + sharp (200px, 800px) | — | **기각** | 릴스 24시간 휘발, 프로필 150px 고정. 썸네일 생성 ROI 낮음 |
| 3 | **LQIP (블러 플레이스홀더)** | 도입 | — | **P2 격하** | 이미지 이미 600px 이하, 24시간 피드 특성상 체감 개선 미미 |
| 4 | **클라이언트 크롭 UI** | react-easy-crop | — | **기각** | React 라이브러리 사용 불가 (Vanilla JS). 프로필은 이미 Canvas 150x150 처리 중 |
| 5 | **Storage 경로 분리** | — | planner_photos/ vs reels_photos/ | **Codex ✓** | 동일 경로로 수명주기 정책 혼재. 분리 시 운영 안정성↑ |
| 6 | **관리자 Custom Claims** | — | Custom Claims 전환 | **Codex ✓** | `nazi2k@gmail.com` 하드코딩 7곳+. Claims 전환으로 확장성/보안↑ |
| 7 | **base64 폴백 축소** | — | 재시도+백오프, 실패 큐 | **Codex ✓** | base64 폴백이 Firestore 문서 비대화 유발 |
| 8 | **uploadBytesResumable** | — | 전환 + 진행률 UI | **Codex ✓** | 모바일 30s 타임아웃 단일 업로드 실패율↑ |
| 9 | **Lifecycle Rule 정리** | — | 메타데이터 + Lifecycle | **Codex ✓ (변형)** | CF 완전 대체 대신 이중 안전망 |
| 10 | **데이터 비정규화** | posts에 author 정보 중복 | — | **이미 구현됨** | `reelsStr`에 이미 `userName, userPhoto, userLevel` 포함 (app.js:4522-4534). 추가 작업 불필요 |
| 11 | **분산 카운터** | 도입 | — | **기각** | likes[] 배열 관리, 현재 규모에서 과잉 설계 |
| 12 | **복합 인덱스** | 최적화 | — | **Gemini ✓** | `firestore.indexes.json` 현재 비어 있음 |
| 13 | **Firestore Rules 필드 검증** | 필드 타입/길이 강제 | — | **Gemini ✓** | 현재 인증 여부만 확인. 필드 레벨 검증 필요 |
| 14 | **Functions 멱등성** | 이벤트 ID 기록 | — | **P2 채택** | 중복 가능성 존재하나 현재 심각하지 않음 |
| 15 | **minInstances** | 적용 | — | **기각** | Callable은 ping 하나뿐. 비용 대비 효과 없음 |
| 16 | **Optimistic UI** | 좋아요 즉시 반영 | — | **Gemini ✓** | 구현 간단, UX 개선 효과 큼 |
| 17 | **onSnapshot 확장** | 댓글/트렌딩 | — | **P2 격하** | Firestore 읽기 비용 증가 우려 |
| 18 | **Web Worker 이미지 처리** | — | OffscreenCanvas | **P2 채택** | 저사양 단말 UX 개선, 구현 복잡도↑ |
| 19 | **데이터 모델 분리 (핫/콜드)** | — | subcollection 분리 | **Codex ✓** | `users/{uid}` 단일 문서 JSON 20개+. 분리 시 성능/확장성↑ |
| 20 | **Observability** | — | 구조화 로그 + 대시보드 | **Codex ✓** | 현재 `console.log` 의존 |

**요약:** Gemini 10개 중 3개 채택 / Codex 9개 중 8개 채택 / 6개 기각 (1개 이미 구현)

---

## Phase 0 (P0) — 즉시 적용 (1주차)

### P0-1. 관리자 권한 Custom Claims 전환 ✅ 구현 완료

**출처:** Codex #2 | **복잡도:** 중 | **임팩트:** 보안↑, 유연성↑

~~현재 `nazi2k@gmail.com` 문자열이 7곳 이상에 하드코딩되어 있다.~~ Firebase Auth Custom Claims (`admin: true`)로 전환 완료.

**구현 내역:**
| 파일 | 변경 내용 | 상태 |
|------|-----------|------|
| `functions/index.js` | `assertAdmin()` — Custom Claims 우선 확인 + 이메일 폴백(자동 복구) | ✅ |
| `functions/index.js` | `setAdminClaim(uid)` callable 함수 추가 | ✅ |
| `firestore.rules` | `request.auth.token.admin == true` 전환 완료 | ✅ |
| `app.js` | `getIdTokenResult()` claims 기반 관리자 UI 분기 | ✅ |

### P0-2. 이미지 업로드 재시도 로직 (base64 폴백 축소) ✅ 구현 완료

**출처:** Codex #3 | **복잡도:** 낮 | **임팩트:** 문서 크기↓, 일관성↑

~~현재 업로드 실패 시 base64를 Firestore에 직접 저장하여 문서가 비대해진다.~~ 지수 백오프 재시도(3회) 적용 완료. 최종 실패 시 에러 상태를 기록하고 base64 저장을 차단한다.

**구현 내역:**
| 파일 | 변경 내용 | 상태 |
|------|-----------|------|
| `app.js` | `uploadImageToStorage()` — 3회 지수 백오프(2s→4s) + localStorage 재전송 큐 | ✅ |
| `app.js` | 프로필 폴백: `_profileUploadFailed` 플래그, base64 저장 차단 | ✅ |
| `app.js` | 릴스 폴백: `uploadFailed` 플래그, `finalPhotoURL = null` 처리 | ✅ |

### P0-3. Storage 경로 분리 + 플래너 사진 Storage 업로드 ✅ 구현 완료

**출처:** Codex #1 | **복잡도:** 낮 | **임팩트:** 운영 명확성↑, 문서 크기↓↓

플래너/릴스/프로필 이미지의 Storage 경로 분리 완료. 플래너 사진을 base64 대신 Cloud Storage에 업로드하여 Firestore 문서 비대화 방지.

**구현 내역:**
| 파일 | 변경 내용 | 상태 |
|------|-----------|------|
| `storage.rules` | `planner_photos/{userId}/` 경로 규칙 추가 (2MB, image/*) | ✅ |
| `app.js` `savePlannerEntry()` | 저장 시 base64 → Storage 업로드, download URL만 diary에 기록 | ✅ |
| `app.js` 사진 복원 | 기존 base64 사진 로드 시 백그라운드 Storage 자동 마이그레이션 | ✅ |
| Storage 경로 체계 | `profile_images/`, `planner_photos/`, `reels_photos/` 3분리 | ✅ |

---

## Phase 1 (P1) — 단기 개선 (2주차)

### P1-1. WebP 포맷 클라이언트 전환

**출처:** Codex #5 | **복잡도:** 낮 | **임팩트:** 용량 25-35%↓

서버 sharp 처리(Gemini 제안) 대신 클라이언트 `canvas.toDataURL('image/webp')`로 전환. 미지원 브라우저는 JPEG fallback.

**변경 대상:**
| 파일 | 위치 | 변경 내용 |
|------|------|-----------|
| `app.js` | L2420 | 프로필: `toDataURL('image/jpeg', 0.6)` → WebP 우선 |
| `app.js` | L4157 | 플래너: `toDataURL('image/jpeg', 0.7)` → WebP 우선 |
| `storage.rules` | 전체 | `contentType.matches('image/.*')` — 이미 WebP 포함 |

**WebP 지원 감지:**
```js
function supportsWebP() {
    const c = document.createElement('canvas');
    return c.toDataURL('image/webp').startsWith('data:image/webp');
}
```

### P1-2. uploadBytesResumable 전환

**출처:** Codex #4 | **복잡도:** 중 | **임팩트:** 업로드 성공률↑, UX↑

`uploadBytes` → `uploadBytesResumable` 전환으로 모바일 네트워크 대응.

**변경 대상:**
| 파일 | 위치 | 변경 내용 |
|------|------|-----------|
| `app.js` | L56-88 | `uploadBytes()` → `uploadBytesResumable()` + 진행률 콜백 |
| `app.js` | 신규 | 업로드 진행률 토스트 UI 컴포넌트 |
| `app.html` | 신규 | 프로그레스바 마크업 |

### P1-3. Firestore Rules 필드 검증 강화

**출처:** Gemini #6 | **복잡도:** 중 | **임팩트:** 보안↑, 무결성↑

현재 인증 여부만 검사하는 규칙에 필드 레벨 검증을 추가한다.

**변경 대상:** `firestore.rules`
```
// users 컬렉션 쓰기 규칙 예시
allow write: if request.auth != null
  && request.auth.uid == userId
  && request.resource.data.name is string
  && request.resource.data.name.size() < 50
  && request.resource.data.level is int
  && request.resource.data.level >= 1
  && request.resource.data.level <= 999;
```

### P1-4. Optimistic UI (좋아요)

**출처:** Gemini #9 | **복잡도:** 낮 | **임팩트:** 체감 반응성↑↑

서버 응답 전 UI를 먼저 변경하고, 실패 시 롤백한다.

**변경 대상:**
| 파일 | 위치 | 변경 내용 |
|------|------|-----------|
| `app.js` | L4831-4854 | `toggleLike()` → UI 즉시 반영 후 Firestore 쓰기, catch 시 롤백 |

### P1-5. 릴스 피드 쿼리 최적화

**출처:** 코드 실사 발견 | **복잡도:** 낮 | **임팩트:** Firestore 읽기 90%↓↓

현재 `fetchAllReelsPosts()` (app.js:4288)가 **전체 `users` 컬렉션을 스캔**하여 `reelsStr`을 추출한다. 모든 사용자의 전체 데이터(stats, diary, quests 등)를 다운로드하는 극심한 비효율.

**해결:** `hasActiveReels: true` 필드를 추가하여 릴스 활성 사용자만 쿼리.

**변경 대상:**
| 파일 | 위치 | 변경 내용 |
|------|------|-----------|
| `app.js` | L4267 | `saveReelsToFirestore()` — `hasActiveReels: true` 필드 추가 |
| `app.js` | L4288 | `fetchAllReelsPosts()` — `where("hasActiveReels", "==", true)` 쿼리로 변경 |
| `app.js` | 릴스 만료 시 | `hasActiveReels: false` 리셋 |
| `firestore.indexes.json` | 신규 | `hasActiveReels` + 관련 복합 인덱스 |

---

## Phase 2 (P2) — 중기 개선 (3-4주차)

### P2-1. 데이터 모델 분리 (핫/콜드)

**출처:** Codex #8 + Gemini #3 통합 | **복잡도:** 높 | **임팩트:** 읽기 비용↓↓, 확장성↑↑

`users/{uid}` 단일 문서(JSON 문자열 20개+)를 분리:
- `users/{uid}` — 프로필/핵심 상태만
- `users/{uid}/daily/{date}` — 일일 퀘스트/일기
- `reels/{postId}` — 릴스 전용 (author 정보 비정규화 포함)

### P2-2. Observability 강화

**출처:** Codex #9 | **복잡도:** 중

`functions/index.js`의 `console.log` → 구조화 JSON 로깅 전환. Cloud Monitoring 대시보드 설정.

### P2-3. Cloud Storage Lifecycle Rule

**출처:** Codex #6 | **복잡도:** 낮

GCS 버킷에 Lifecycle Rule + 객체 메타데이터 `expireAt`. 기존 `cleanupExpiredReelsPhotos` CF는 보조 역할로 유지.

### P2-4. Web Worker 이미지 처리

**출처:** Codex #7 | **복잡도:** 높

`image-worker.js` 신규 생성 → OffscreenCanvas 리사이즈/압축. 미지원 브라우저 fallback 포함.

### P2-5. Functions 멱등성

**출처:** Gemini #7 | **복잡도:** 중

알림 발송 함수에 이벤트 ID 기록 → 중복 실행 방지.

---

## 기각 항목

| 항목 | 출처 | 기각 사유 |
|------|------|-----------|
| 서버 sharp 리사이징/썸네일 | Gemini 1.1 | 24시간 휘발 릴스에 서버 처리 비용 과다. 이미 클라이언트에서 600px 리사이즈 |
| react-easy-crop | Gemini 1.2 | Vanilla JS 프로젝트에 React 라이브러리 도입 불가 |
| 분산 카운터 | Gemini 2.2 | 현재 규모에서 과잉 설계. likes[] 배열로 충분 |
| minInstances | Gemini 3.3 | Callable은 ping 하나뿐. 비용 대비 효과 없음 |
| AVIF 포맷 | Gemini 1.1 | 브라우저 호환성 부족, Canvas `toDataURL('image/avif')` 미지원 |
| 데이터 비정규화 | Gemini 2.1 | **이미 구현됨.** `reelsStr`에 `userName, userPhoto, userLevel` 이미 포함 (app.js:4522-4534) |
| onSnapshot 확장 | Gemini 4.2 | 24시간 휘발 콘텐츠에 persistent WebSocket은 Firestore 읽기 비용 과다 |

---

## 성공 지표 (KPI)

| 지표 | 목표 | 측정 방법 |
|------|------|-----------|
| 이미지 업로드 실패율 | **현재 대비 50%↓** | Firebase Console Storage 에러 로그 |
| 평균 이미지 용량 | **현재 대비 30%↓** | WebP 전환 후 Storage 평균 파일 크기 |
| Firestore 문서 평균 크기 | **현재 대비 40%↓** | base64 제거 + 데이터 분리 후 측정 |
| 만료 이미지 정리 누락률 | **0%** | Lifecycle Rule + CF 이중 안전망 |
| 관리자 권한 변경 소요시간 | **코드 배포 불필요** | Custom Claims CLI 설정만으로 완료 |

---

## 2주 액션 플랜

### 1주차 (P0)
1. Custom Claims 설정 함수 구현 → 기존 이메일 비교 7곳 전환
2. `uploadImageToStorage()`에 지수 백오프 재시도 추가
3. Storage 경로 분리 스키마 적용

### 2주차 (P1)
1. WebP 우선 인코딩 도입 + JPEG fallback
2. `uploadBytesResumable` 전환 + 진행률 UI
3. Firestore Rules 필드 검증 강화
4. Optimistic UI (좋아요) 구현

---

## 배포 순서 및 의존성

```
P0-1 (Admin Claims) ──────────────────────────── 독립, 최우선 배포
  ⚠️ 배포 순서: (1) Claims 설정 → (2) Functions 배포 → (3) Rules 배포
  (순서 어기면 관리자 잠김)

P0-2 (업로드 재시도) ──→ P1-2 (Resumable 업로드)
P0-3 (경로 분리 + 플래너 Storage) ──→ P2-1 (데이터 모델 분리)

P1-1 (WebP) ────────────────────────────────── 독립
P1-3 (Rules 강화) ──────────────────────────── 독립
P1-4 (Optimistic UI) ──────────────────────── 독립
P1-5 (릴스 쿼리 최적화) ──→ P2-1 (데이터 모델 분리)

P2-4 (Web Worker) ──────────────────────────── 독립
```

> **핵심:** P0-1은 보안 수정으로 가장 예측 가능한 범위이므로 **가장 먼저 배포**한다. P1-5(릴스 쿼리 최적화)는 **노력 대비 임팩트가 가장 큰 단일 항목**이므로 P1 내에서 우선 진행한다.

---

**작성일:** 2026-03-18
**분석 기준:** SPECS.md, SPECS_IMPROVEMENTS(Gemini).md, SPECS_IMPROVEMENTS(Codex).md
**대상 프로젝트:** LEVEL UP: REBOOT
