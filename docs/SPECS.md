# LEVEL UP: REBOOT — 이미지 규격 비교 & 서버 작동방식

---

## 1. 이미지 규격 비교

### 한눈에 보는 비교표

| 항목 | 프로필 이미지 | 시간표(플래너) 이미지 | 포스팅(릴스) 이미지 |
|------|:---:|:---:|:---:|
| **출력 크기** | 150 × 150 px (고정, 정사각형) | 최대 600 px (긴 변 기준, 비율 유지) | 최대 600 px (긴 변 기준, 비율 유지) |
| **포맷** | JPEG | JPEG | JPEG |
| **압축 품질** | 0.6 (60%) | 0.7 (70%) | 0.7 (70%) |
| **Storage 경로** | `profile_images/{uid}/profile.jpg` | `reels_photos/{uid}/{timestamp}.jpg` | `reels_photos/{uid}/{timestamp}.jpg` |
| **용량 제한 (규칙)** | 500 KB | 2 MB | 2 MB |
| **보존 기간** | 영구 | 25시간 후 자동 삭제 | 25시간 후 자동 삭제 |
| **읽기 권한** | 인증된 사용자 전체 | 인증된 사용자 전체 | 인증된 사용자 전체 |
| **쓰기 권한** | 본인만 (`uid == userId`) | 본인만 (`uid == userId`) | 본인만 (`uid == userId`) |
| **업로드 타임아웃** | 30초 | 30초 | 30초 |
| **폴백** | base64 직접 저장 | localStorage 캐시 | base64 폴백 |

> **참고:** 시간표 이미지와 포스팅 이미지는 동일한 Storage 경로(`reels_photos/`)를 공유한다. 플래너에서 찍은 사진이 릴스로 포스팅될 때 Cloud Storage에 업로드된다.

---

### 1-1. 프로필 이미지 상세

- **소스 코드:** `app.js:2395` — `loadProfileImage()`
- **리사이즈 방식:** Canvas 150×150 고정 크롭
  ```js
  canvas.width = 150; canvas.height = 150;
  ctx.drawImage(img, 0, 0, 150, 150);
  canvas.toDataURL('image/jpeg', 0.6);
  ```
- **Storage 규칙** (`storage.rules:6-12`):
  ```
  request.resource.size < 500 * 1024  (500KB)
  request.resource.contentType.matches('image/.*')
  ```
- **Firestore 저장:** `users/{uid}.photoURL` 필드에 Cloud Storage URL 저장
- **마이그레이션:** 기존 base64 임베딩 → Cloud Storage URL로 자동 전환

### 1-2. 시간표(플래너) 이미지 상세

- **소스 코드:** `app.js:4136` — `loadPlannerPhoto()`
- **리사이즈 방식:** 긴 변 600px 기준, 비율 유지
  ```js
  const maxSize = 600;
  let w = img.width, h = img.height;
  if (w > maxSize || h > maxSize) {
      if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
      else { w = Math.round(w * maxSize / h); h = maxSize; }
  }
  canvas.toDataURL('image/jpeg', 0.7);
  ```
- **클라이언트 저장:** `plannerPhotoData` 변수(base64)로 보관 → 포스팅 시 Storage 업로드

### 1-3. 포스팅(릴스) 이미지 상세

- **소스 코드:** `app.js:4506` — 포스팅 업로드 로직
- **이미지 소스:** 플래너 사진(`plannerPhotoData`)을 그대로 사용
- **업로드 흐름:**
  1. base64 여부 확인 (`isBase64Image()`)
  2. base64이면 `uploadImageToStorage()` 호출
  3. 실패 시 base64 원본으로 폴백
- **Storage 규칙** (`storage.rules:14-20`):
  ```
  request.resource.size < 2 * 1024 * 1024  (2MB)
  request.resource.contentType.matches('image/.*')
  ```
- **자동 삭제:** Cloud Function `cleanupExpiredReelsPhotos` (매일 04:00 KST, 25시간 경과 파일 삭제)
- **24시간 피드:** 포스트는 24시간 동안만 글로벌 피드에 노출

---

## 2. 이미지 업로드 공통 플로우

```
사용자가 이미지 선택
    ↓
FileReader.readAsDataURL()  →  Data URL (base64)
    ↓
new Image() 로드  →  원본 크기 측정
    ↓
Canvas 리사이즈 (프로필: 150px / 플래너: 600px max)
    ↓
canvas.toDataURL('image/jpeg', 품질)  →  압축된 base64
    ↓
uploadImageToStorage(path, base64)
  ├─ base64 → Blob 변환
  ├─ uploadBytes() → Firebase Cloud Storage
  ├─ 타임아웃: 30초
  └─ getDownloadURL() → HTTPS URL 반환
    ↓
Firestore에 URL 저장
```

**핵심:** 모든 이미지 리사이즈/압축은 **클라이언트(브라우저)**에서 처리한다. 서버에서 별도의 이미지 처리는 없다.

---

## 3. 서버 작동방식

### 3-1. 아키텍처 개요

```
┌─────────────────────────────────────────────────────────┐
│                    클라이언트 (PWA)                        │
│  app.js + app.html   │  Capacitor (Android/iOS 래퍼)     │
│  Firebase SDK v10.8.1 │  localStorage 오프라인 캐시       │
└───────────┬─────────────────────────────────────────────┘
            │  HTTPS
            ▼
┌─────────────────────────────────────────────────────────┐
│               Firebase (BaaS — 서울 리전)                 │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   Auth    │  │  Firestore   │  │  Cloud Storage   │   │
│  │ (인증)    │  │  (데이터베이스) │  │  (이미지 저장)    │   │
│  └──────────┘  └──────────────┘  └──────────────────┘   │
│                                                          │
│  ┌──────────────────┐  ┌─────────────────────────────┐  │
│  │  Cloud Functions  │  │  Cloud Messaging (FCM)      │  │
│  │  (스케줄/Callable) │  │  (푸시 알림)                 │  │
│  └──────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- **프레임워크:** Firebase BaaS (Backend as a Service)
- **런타임:** Node.js 20 (Cloud Functions Gen 2)
- **리전:** `asia-northeast3` (서울)
- **프론트엔드:** Vanilla JS PWA + Capacitor 네이티브 래핑

### 3-2. Firebase 서비스별 역할

| 서비스 | 역할 |
|--------|------|
| **Auth** | 이메일/Google 로그인, 사용자 인증 |
| **Firestore** | 사용자 데이터, 퀘스트, 던전, 릴스 반응 등 모든 상태 저장 |
| **Cloud Storage** | 프로필 이미지, 릴스 사진 파일 저장 |
| **Cloud Functions** | 스케줄 작업(알림, 정리), 관리자 API |
| **Cloud Messaging** | 레이드 알림, 일일 리마인더, 스트릭 경고 푸시 |

### 3-3. Cloud Functions 목록

| 함수명 | 유형 | 스케줄 | 설명 |
|--------|------|--------|------|
| `ping` | Callable | — | 진단 + 관리자 API 라우터 (getTestUsers, getPushLogs, sendTestNotification, sendAnnouncement) |
| `sendRaidAlert0600` | Schedule | 매일 06:00 KST | 레이드 알림 발송 |
| `sendRaidAlert1130` | Schedule | 매일 11:30 KST | 레이드 알림 발송 |
| `sendRaidAlert1900` | Schedule | 매일 19:00 KST | 레이드 알림 발송 |
| `sendDailyReminder` | Schedule | 매일 09:00 KST | 일일 퀘스트 리마인더 |
| `sendStreakWarnings` | Schedule | 매일 21:00 KST | 2일 이상 미접속 유저에게 스트릭 위험 경고 |
| `cleanupInactiveTokens` | Schedule | 매주 일 03:00 KST | 30일 미접속 유저의 FCM 토큰 정리 |
| `cleanupExpiredReelsPhotos` | Schedule | 매일 04:00 KST | 25시간 경과 릴스 사진 Storage 삭제 |
| `sendAnnouncement` | Callable | — | 관리자 공지사항 수동 발송 |
| `sendTestNotification` | Callable | — | 관리자 테스트 푸시 |
| `getTestUsers` | Callable | — | 푸시 활성 유저 목록 조회 |
| `getPushLogs` | Callable | — | 발송 이력 조회 |

### 3-4. Firestore 컬렉션 구조

| 컬렉션 | 용도 | 읽기 | 쓰기 |
|--------|------|------|------|
| `users/{uid}` | 사용자 프로필, 레벨, 스탯, 퀘스트, 일기, 릴스 데이터 | 인증 사용자 | 본인만 |
| `push_logs/{logId}` | 푸시 발송 이력 | 관리자만 | Cloud Functions만 |
| `push_feedback/{id}` | 사용자 피드백 | 관리자만 | 인증 사용자(생성만) |
| `reels_reactions/{postId}` | 릴스 좋아요/댓글 | 인증 사용자 | 인증 사용자 |
| `app_config/{docId}` | 앱 설정 | 인증 사용자 | 관리자만 |

### 3-5. 데이터 동기화 전략

- **디바운스 저장:** `saveUserData()` 호출 시 2초 디바운스 적용 → 연속 변경 시 마지막만 Firestore에 기록
- **비행 중 잠금:** 저장 중(`_saveInFlight`)일 때 추가 저장 요청은 대기 후 재시도
- **오프라인 지원:** Firestore 오프라인 캐시 활성화, 네이티브 플랫폼에서는 Long Polling 사용
- **localStorage 캐시:** 릴스 포스트, 일기 데이터 등 로컬 캐시로 즉시 UI 반영

### 3-6. 인증 체계

- **사용자:** Firebase Auth (이메일/비밀번호 + Google 로그인)
- **관리자:** GitHub Secrets의 `ADMIN_EMAILS` 환경변수로 관리 (Firebase Custom Claims + Cloud Functions 내 검증)
- **Storage 접근:** 읽기는 인증 사용자 전체, 쓰기는 본인 경로만 허용
