# Firebase Storage 업로드 오류 수정 이력

> LEVEL UP: REBOOT (Capacitor + Firebase)
> 최종 업데이트: 2026-03-20

---

## 1. 오류 현황 요약 (2026-03-20 수집, 총 24건)

| 분류 | 건수 | 핵심 오류 |
|------|------|-----------|
| STORAGE | 4 | `enableIndexedDbPersistence()` deprecated 경고, WebChannel transport error |
| UNKNOWN | 11 | Storage 업로드 타임아웃 (60s), 재전송 큐 누적, 오프라인 전환 |
| NETWORK | 9 | WebChannel 스트림 연결 끊김, 재전송 큐 자동 재전송 실패 |

### 반복 패턴

- `Upload timed out after 60s` — 프로필/플래너/릴스 사진 모두에서 발생
- `WebChannelConnection RPC 'Listen' stream transport errored` — Firestore 실시간 리스너 연결 불안정
- `[UploadRetry] 재전송 큐에 추가` — 큐 크기 1→2→3→4로 지속 증가, 자동 재전송 실패
- `[Network] 오프라인 전환` — 모바일 네트워크 불안정으로 빈번한 오프라인 전환

---

## 2. 근본 원인 분석

### 원인 1: `enableIndexedDbPersistence()` deprecated API 사용
- **위치**: `www/app.js:29`
- **증상**: Firebase SDK가 매 초기화마다 경고 로그 출력
- **영향**: 기능 자체는 동작하나, 향후 SDK 업데이트 시 제거될 예정

### 원인 2: 고정 60초 타임아웃
- **위치**: `www/app.js:353` (uploadBytes), `www/app.js:365` (uploadBytesResumable)
- **증상**: 모바일 네트워크에서 대용량 이미지 업로드 시 60초 내 완료 불가
- **영향**: 3회 재시도 후 모두 타임아웃 → 재전송 큐에 누적

### 원인 3: 네트워크 품질 무시
- **위치**: `www/app.js:284`
- **증상**: `navigator.onLine`만 확인, 실제 연결 품질(weak/good) 미고려
- **영향**: 약한 네트워크에서 업로드 시작 → 타임아웃 → 배터리/데이터 낭비

### 원인 4: Reels 사진 압축 누락
- **위치**: `www/app.js:4983`
- **증상**: 프로필(450KB), 플래너(1.8MB)는 압축 적용되나 릴스는 원본 그대로 업로드
- **영향**: 카메라 원본 사이즈(3-8MB)가 2MB Storage 규칙 제한에 걸림

### 원인 5: Resumable 업로드 stall 미감지
- **위치**: `www/app.js:360-388`
- **증상**: 전체 타임아웃만 존재, 진행이 멈춘 업로드 감지 불가
- **영향**: 네트워크 전환 시 진행 없이 60초까지 대기 → 다른 업로드 차단 (직렬 큐)

---

## 3. 수정 이력 (커밋 순서)

### 3.1 기반 인프라 구축

| 커밋 | 날짜 | 내용 | 상태 |
|------|------|------|------|
| `3cc571f` | 2026-03-19 | 적응형 이미지 압축 (`compressToTargetSize`) 도입 | 반영됨 |
| `875c299` | 2026-03-18 | 지수 백오프 재시도 로직 (3회, 2s→4s) + 재전송 큐 | 반영됨 |
| `d581ee5` | - | 업로드 직렬화 큐 + 소형 파일 `uploadBytes` 분기 | 반영됨 |
| `8996462` | 2026-03-20 | `app_error_logs` Firestore 컬렉션 + 에러 진단 인프라 | 반영됨 |

### 3.2 시도되었으나 미반영된 수정

| 커밋 | 날짜 | 의도한 수정 | 미반영 원인 |
|------|------|-------------|-------------|
| `d70436f` | 2026-03-19 | 적응형 타임아웃(30s-180s), 압축 강화, stall 감지 | 코드 충돌로 되돌려짐 |
| `890d4f1` | 2026-03-20 | persistence API 마이그레이션, 동적 타임아웃, WebChannel 복구 개선 | 머지 시 덮어씌워짐 |
| `89fec8c` | 2026-03-20 | 동적 타임아웃(크기 기반), 압축 목표 축소(300KB/1.2MB) | 병합 충돌로 누락 |

### 3.3 최종 수정 (현재 커밋)

| # | 수정 내용 | 파일:라인 | 변경 사항 |
|---|----------|-----------|-----------|
| 1 | Persistence API 마이그레이션 | `app.js:4, 21-27` | `enableIndexedDbPersistence` → `persistentLocalCache` + `persistentMultipleTabManager` |
| 2 | 동적 타임아웃 | `app.js:280-285` | `_calcUploadTimeout()`: 30초 기본 + 60초/MB, 최대 300초, weak 네트워크 2배 |
| 3 | Stall detection | `app.js:360-395` | 30초간 `bytesTransferred` 변화 없으면 업로드 취소 |
| 4 | Reels 사진 압축 | `app.js:5004-5025` | 업로드 전 1080px 리사이즈 + `compressToTargetSize(1.8MB)` 적용 |
| 5 | 네트워크 품질 확인 | `app.js:290-298` | `NetworkMonitor.getQuality()` 확인 추가, 재시도 전 네트워크 재확인 |

---

## 4. 아키텍처 다이어그램

```
사용자 이미지 선택
        │
        ▼
  ┌─────────────────┐
  │ compressToTarget │  프로필: 450KB, 플래너/릴스: 1.8MB
  │    Size()        │  품질 반복 조정 + 캔버스 축소
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ enqueueUpload() │  직렬화 큐 (동시 업로드 방지)
  └────────┬────────┘
           │
           ▼
  ┌─────────────────────────────────────────────┐
  │ _uploadImageToStorageImpl()                  │
  │                                              │
  │  1. 네트워크 품질 확인 (offline → 큐)         │
  │  2. Blob 변환 + 크기 검증                     │
  │  3. 동적 타임아웃 계산                         │
  │     30s + 60s/MB, max 300s, weak×2           │
  │  4. 업로드 (< 100KB: uploadBytes,             │
  │            ≥ 100KB: uploadBytesResumable)     │
  │  5. Stall detection (30s 무진행 → 취소)        │
  │  6. 재시도 (3회, 2s→4s→8s 백오프)             │
  │  7. 모든 실패 → 재전송 큐                      │
  └────────┬────────────────────────────────────┘
           │ 실패 시
           ▼
  ┌─────────────────┐
  │ _addToRetryQueue │  localStorage 백업
  └────────┬────────┘
           │ 온라인 복귀 시
           ▼
  ┌─────────────────┐
  │ _flushRetryQueue │  24시간 만료 체크 → 자동 재전송
  └─────────────────┘
```

---

## 5. Firebase Storage 규칙 (참고)

```
profile_images/{userId}/**  → 인증 필수, 본인만 쓰기, 500KB 제한
planner_photos/{userId}/**  → 인증 필수, 본인만 쓰기, 2MB 제한
reels_photos/{userId}/**    → 인증 필수, 본인만 쓰기, 2MB 제한
```

---

## 6. 검증 체크리스트

- [ ] `enableIndexedDbPersistence` 문자열이 코드에 없는지 확인
- [ ] 업로드 타임아웃 로그에 동적 시간(예: `timeout=90s`)이 표시되는지 확인
- [ ] Stall detection 로그(`Upload stalled`)가 무진행 시 출력되는지 확인
- [ ] Reels 포스팅 시 압축 로그 출력 확인
- [ ] 오프라인 → 온라인 전환 시 재전송 큐 자동 처리 확인
- [ ] WebChannel 에러 후 Firestore 자동 복구 확인
