# 관리자 캡션/이미지 자동 스크리닝(검열) 시스템

## 1. 개요

LEVEL UP: REBOOT 앱의 Day1(릴스) 포스트에 대한 **자동 콘텐츠 검열 시스템**입니다.
기존 수동 포스트 스크리닝과 신고 관리에 더해, 금칙어 기반 텍스트 필터링과
**Azure Content Safety API** 기반 이미지 분석을 통해 부적절한 콘텐츠를 자동으로 감지하고 조치합니다.

### 해결하는 문제

| 기존 | 개선 |
|------|------|
| 관리자가 모든 포스트를 수동 검토 | 금칙어/이미지 자동 감지 |
| 신고 접수 후 사후 처리만 가능 | 사전 예방적 스크리닝 |
| 검열 기준이 코드에 하드코딩 | 관리자 UI에서 실시간 설정 변경 |
| 이미지 검열 불가 | Azure Content Safety로 성인/폭력/혐오/자해 감지 |

### 이미지 스크리닝 솔루션 선택: Azure Content Safety

| 항목 | Google Cloud Vision | **Azure Content Safety (채택)** |
|------|--------------------|---------------------------------|
| 무료 한도 | 1,000건/월 | **5,000건/월 (영구)** |
| 유료 가격 | $1.50 / 1,000건 | **$1.00 / 1,000건** |
| 감지 카테고리 | 5개 (Adult, Violence, Racy, Medical, Spoof) | **4개 + 심각도 0~6** (Sexual, Violence, Hate, SelfHarm) |
| 심각도 세분화 | 5단계 Likelihood | **7단계 (0~6)** |
| 혐오/자해 감지 | 없음 | **있음** |

> 비용 분석 상세: [docs/image-screening-cost-analysis.md](./image-screening-cost-analysis.md)

---

## 2. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                    관리자 패널                         │
│  ┌─────────────┬──────────────┬───────────────┐     │
│  │  대시보드     │  스크리닝 결과  │   설정 관리     │     │
│  │  (통계/일괄)  │  (목록/승인)   │  (금칙어/임계값) │     │
│  └──────┬──────┴──────┬───────┴───────┬───────┘     │
│         │             │               │              │
│         ▼             ▼               ▼              │
│  ┌─────────────────────────────────────────────┐    │
│  │          ping() Cloud Function               │    │
│  │  batchScreenPosts / getScreeningResults /    │    │
│  │  reviewScreenedPost / get·updateConfig /     │    │
│  │  getScreeningStats / autoScreenPost          │    │
│  └──────────────────┬──────────────────────────┘    │
│                     │                                │
│         ┌───────────┴───────────┐                    │
│         ▼                       ▼                    │
│  ┌─────────────┐   ┌────────────────────────┐       │
│  │ screenCaption│   │     screenImage         │       │
│  │ (금칙어 매칭) │   │ (Azure Content Safety)  │       │
│  └──────┬──────┘   └──────────┬─────────────┘       │
│         │                     │                      │
│         ▼                     ▼                      │
│  ┌─────────────────────────────────────────────┐    │
│  │        Firestore: screening_results          │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

## 3. 데이터 모델

### 3.1 `screening_config` 컬렉션

#### 문서: `settings`

```javascript
{
  textScreeningEnabled: true,       // 텍스트 스크리닝 활성화
  imageScreeningEnabled: false,     // 이미지 스크리닝 활성화
  azureEnabled: false,              // Azure Content Safety 사용 여부 (F0: 5,000건/월 무료)
  notifyOnFlag: true,               // 플래그 시 알림
  autoHideThreshold: "medium",      // 자동 숨김 임계값
  autoDeleteThreshold: "high"       // 자동 삭제 임계값
}
```

#### 문서: `keywords`

```javascript
{
  categories: {
    profanity: {
      keywords: ["시발", "씨발", "ㅅㅂ", "개새끼", ...],
      severity: "medium",
      enabled: true
    },
    hate: {
      keywords: ["한남충", "틀딱", "짱깨", ...],
      severity: "high",
      enabled: true
    },
    spam: {
      keywords: ["텔레그램", "부업", "재택알바", ...],
      severity: "low",
      enabled: true
    },
    nsfw: {
      keywords: ["섹스", "야동", "포르노", ...],
      severity: "high",
      enabled: true
    },
    illegal: {
      keywords: ["대포통장", "마약", "도박사이트", ...],
      severity: "high",
      enabled: true
    }
  }
}
```

### 3.2 `screening_results` 컬렉션

```javascript
{
  postId: "ownerUid_timestamp",     // 포스트 고유 ID
  ownerUid: "abc123",
  ownerName: "유저명",
  caption: "포스트 캡션 텍스트",
  photo: "https://...",             // 사진 URL

  screenedAt: 1711400000000,        // 스크리닝 시간

  // 텍스트 스크리닝 결과
  textFlags: [
    { keyword: "시발", category: "profanity", severity: "medium" }
  ],

  // 이미지 스크리닝 결과 (Azure Content Safety)
  imageFlags: {
    adult: "VERY_UNLIKELY",         // Sexual 카테고리 → adult로 매핑
    violence: "UNLIKELY",           // Violence 카테고리
    racy: "POSSIBLE",               // Sexual 카테고리 → racy로도 매핑
    hate: "VERY_UNLIKELY",          // Hate 카테고리 (Azure 전용)
    selfHarm: "VERY_UNLIKELY"       // SelfHarm 카테고리 (Azure 전용)
  },

  overallSeverity: "medium",        // 종합 심각도
  status: "pending",                // pending | approved | rejected | auto_deleted | auto_hidden
  reviewedBy: null,                 // 검토한 관리자 이메일
  reviewedAt: null                  // 검토 시간
}
```

---

## 4. 심각도 & 자동 조치

### 4.1 심각도 레벨

| 레벨 | 설명 | 기본 카테고리 |
|------|------|-------------|
| **Low** | 주의 필요, 즉각 조치 불필요 | 스팸/홍보 |
| **Medium** | 잠재적 위반, 검토 필요 | 욕설/비속어 |
| **High** | 명백한 위반, 즉각 조치 필요 | 혐오표현, 음란물, 불법정보 |

### 4.2 자동 조치 매트릭스

| 심각도 | 기본 조치 | 설명 |
|--------|---------|------|
| Low | **플래그** | `screening_results`에 기록, 관리자 검토 대기 |
| Medium | **자동 숨김** | 플래그 + 사용자 피드에서 비노출 처리 |
| High | **자동 삭제** | 포스트 즉시 삭제 (reelsStr, Storage, reactions 모두 삭제) |

> 임계값은 관리자 설정에서 조정 가능합니다.

### 4.3 이미지 스크리닝 심각도 매핑 (Azure Content Safety → Likelihood)

Azure Content Safety는 각 카테고리에 0~6 심각도를 반환합니다.
이를 시스템 내부 Likelihood 값으로 매핑:

| Azure Severity (0~6) | 내부 Likelihood | 시스템 심각도 |
|----------------------|----------------|-------------|
| 5~6 | VERY_LIKELY | **High** |
| 4 | LIKELY | **High** |
| 2~3 | POSSIBLE | **Medium** |
| 1 | UNLIKELY | **Low** |
| 0 | VERY_UNLIKELY | **Low** |

### 4.4 Azure Content Safety 감지 카테고리

| Azure 카테고리 | 내부 매핑 | 설명 |
|---------------|---------|------|
| **Sexual** | adult, racy | 성적/선정적 콘텐츠 |
| **Violence** | violence | 폭력적 콘텐츠 |
| **Hate** | hate | 혐오 표현 (Azure 전용) |
| **SelfHarm** | selfHarm | 자해/자살 관련 (Azure 전용) |

> Google Vision 대비 Hate, SelfHarm 카테고리가 추가되어 커뮤니티 앱에 더 적합합니다.

---

## 5. 백엔드 API (Cloud Functions)

모든 API는 기존 `ping()` Cloud Function의 action 라우터를 통해 호출됩니다.

### 5.1 스크리닝 실행

| Action | 설명 | 권한 |
|--------|------|------|
| `autoScreenPost` | 단일 포스트 스크리닝 | Admin/Operator |
| `batchScreenPosts` | 전체 활성 포스트 일괄 스크리닝 (이미 스크리닝된 포스트 스킵) | Admin/Operator |

### 5.2 결과 관리

| Action | 설명 | 권한 |
|--------|------|------|
| `getScreeningResults` | 스크리닝 결과 조회 (status, severity 필터) | Admin/Operator |
| `reviewScreenedPost` | 포스트 승인(approved) 또는 거부(rejected + 삭제) | Admin/Operator |
| `getScreeningStats` | 스크리닝 통계 조회 | Admin/Operator |

### 5.3 설정 관리

| Action | 설명 | 권한 |
|--------|------|------|
| `getScreeningConfig` | 현재 스크리닝 설정 조회 | Admin/Operator |
| `updateScreeningConfig` | 설정/금칙어 업데이트 | Admin/Operator |

### 5.4 핵심 유틸 함수

```
screenCaption(caption, categories)
  → 캡션 텍스트를 금칙어 목록과 대조하여 매칭 결과 반환
  → 카테고리별 enabled 체크, 대소문자 무시 매칭

screenImage(photoUrl)
  → Azure Content Safety API 호출 (이미지 URL → base64 → 분석)
  → adult, violence, racy, hate, selfHarm 결과 반환 (Likelihood로 매핑)

azureSeverityToLikelihood(severity)
  → Azure 0~6 심각도를 VERY_UNLIKELY~VERY_LIKELY로 변환

getOverallSeverity(textFlags, imageFlags)
  → 텍스트/이미지 플래그 중 최고 심각도 반환

executeScreening(post, config)
  → 텍스트 + 이미지 스크리닝 실행
  → 심각도별 자동 조치 결정 및 실행
  → screening_results에 결과 저장

performAutoDelete(ownerUid, timestamp)
  → reelsStr에서 포스트 제거
  → hasActiveReels 플래그 업데이트
  → reels_reactions 삭제
  → Storage 사진 파일 삭제
```

---

## 6. 관리자 UI

관리자 패널(`/www/admin/`)의 **"자동 스크리닝"** 탭에서 접근합니다.

### 6.1 대시보드

- **통계 카드**: 총 플래그, 검토 대기, 승인, 거부, 자동 삭제, 자동 숨김 수
- **심각도별 분포**: Low / Medium / High 바 차트
- **카테고리별 분포**: 욕설, 혐오, 스팸, 음란, 불법 바 차트
- **일괄 스크리닝 실행 버튼**: 전체 활성 포스트 일괄 스캔

### 6.2 스크리닝 결과

- **필터**: 상태(전체/검토대기/승인/거부/자동삭제/자동숨김), 심각도(전체/Low/Medium/High)
- **결과 테이블**: 작성자, 캡션 미리보기, 심각도 배지, 상태 배지, 플래그 수, 시간
- **상세 패널**:
  - 포스트 메타데이터 (작성자, 심각도, 상태, 시간)
  - 전체 캡션 텍스트
  - 포스트 이미지
  - 텍스트 플래그 태그 (키워드 + 카테고리)
  - 이미지 플래그 태그 (Azure Content Safety: 성인, 폭력, 선정, 혐오, 자해)
  - **승인/거부 버튼** (pending, auto_hidden 상태에서만 활성)

### 6.3 설정 관리

- **일반 설정**
  - 텍스트 스크리닝 활성화 토글
  - 이미지 스크리닝 활성화 토글
  - Azure Content Safety 사용 토글 (F0: 5,000건/월 무료)
  - 플래그 알림 토글
  - 자동 숨김 임계값 선택 (Low / Medium / High)
  - 자동 삭제 임계값 선택 (Low / Medium / High)

- **금칙어 관리** (카테고리별)
  - 카테고리 활성화/비활성화 토글
  - 심각도 레벨 선택
  - 키워드 태그 목록 (추가/삭제 가능)
  - 새 키워드 입력 + Enter/추가 버튼

---

## 7. 변경된 파일

| 파일 | 변경 유형 | 설명 |
|------|---------|------|
| `functions/index.js` | 수정 | 스크리닝 백엔드 로직 (Azure Content Safety 연동) |
| `functions/package.json` | 수정 | `@azure-rest/ai-content-safety`, `@azure/core-auth` 의존성 |
| `firestore.rules` | 수정 | `screening_results`, `screening_config` 보안 규칙 추가 |
| `www/admin/js/auto-screening.js` | **신규** | 관리자 UI 모듈 |
| `www/admin/css/admin-base.css` | 수정 | 스크리닝 전용 CSS 스타일 |
| `www/admin/index.html` | 수정 | "자동 스크리닝" 탭 + import 추가 |

---

## 8. Firestore 보안 규칙

```
// screening_results: Cloud Functions에서만 쓰기, 관리자만 읽기
match /screening_results/{resultId} {
  allow read: if request.auth != null && isAdminOrOperator();
  allow write: if false;
}

// screening_config: Cloud Functions에서만 쓰기, 관리자만 읽기
match /screening_config/{docId} {
  allow read: if request.auth != null && isAdminOrOperator();
  allow write: if false;
}
```

> 두 컬렉션 모두 클라이언트에서 직접 쓰기가 불가하며, Cloud Functions Admin SDK를 통해서만 데이터가 관리됩니다.

---

## 9. 배포 가이드

### 9.1 사전 요구사항

1. Firebase 프로젝트에 Cloud Functions가 Blaze(종량제) 요금제로 활성화
2. (이미지 스크리닝 사용 시) Azure Content Safety 리소스 생성:

```
Azure Portal에서 설정:

1. https://portal.azure.com 접속
2. "리소스 만들기" → "Content Safety" 검색
3. 리소스 생성:
   - 이름: levelup-content-safety
   - 지역: Korea Central (또는 East Asia)
   - 가격 책정 계층: F0 (무료, 5,000건/월)
4. 리소스 생성 완료 후 → "키 및 엔드포인트" 메뉴에서:
   - 엔드포인트 URL 복사
   - KEY 1 복사
```

3. Firebase Functions 환경변수 설정:

```bash
# Firebase Functions 환경변수에 Azure 인증 정보 추가
firebase functions:secrets:set AZURE_CS_ENDPOINT
# → Azure 엔드포인트 URL 입력 (예: https://levelup-content-safety.cognitiveservices.azure.com)

firebase functions:secrets:set AZURE_CS_KEY
# → Azure KEY 1 입력
```

또는 `.env` 파일 사용:
```bash
# functions/.env
AZURE_CS_ENDPOINT=https://levelup-content-safety.cognitiveservices.azure.com
AZURE_CS_KEY=your-azure-key-here
```

### 9.2 배포 순서

```bash
# 1. Cloud Functions 의존성 설치
cd functions
npm install

# 2. Firestore 보안 규칙 배포
firebase deploy --only firestore:rules

# 3. Cloud Functions 배포
firebase deploy --only functions

# 4. 관리자 패널 배포 (호스팅)
firebase deploy --only hosting
```

### 9.3 초기 설정

배포 후 관리자 패널에서:

1. **자동 스크리닝** 탭 클릭
2. **설정 관리** 뷰로 이동
3. **설정 로드** 버튼 클릭 (초기 기본값 자동 생성)
4. 금칙어 목록 확인/수정
5. 텍스트 스크리닝 활성화 확인
6. (선택) 이미지 스크리닝 + Azure Content Safety 활성화
7. **설정 저장** 클릭
8. **대시보드**로 이동 → **일괄 스크리닝 실행**으로 기존 포스트 스캔

---

## 10. 금칙어 기본 사전

### 욕설/비속어 (severity: medium)

```
시발, 씨발, ㅅㅂ, ㅆㅂ, 개새끼, ㄱㅅㄲ, 병신, ㅂㅅ,
지랄, ㅈㄹ, 미친놈, 미친년, 꺼져, 닥쳐, 존나, ㅈㄴ,
애미, 느금마, 좆, 보지
```

### 혐오표현 (severity: high)

```
한남충, 한녀충, 틀딱, 급식충, 맘충, 장애인놈,
흑형, 짱깨, 쪽바리, 똥남아
```

### 스팸/홍보 (severity: low)

```
텔레그램, 카톡방, 오픈채팅, 부업, 재택알바,
고수익, 일당, 투자수익, 코인추천
```

### 음란물 (severity: high)

```
섹스, 야동, 포르노, 자위, 성인방, 음란, 벗방, 누드
```

### 불법정보 (severity: high)

```
대포통장, 마약, 필로폰, 대마, 도박사이트, 불법촬영, 몰카
```

> 모든 금칙어는 관리자 UI에서 실시간으로 추가/삭제/수정 가능합니다.

---

## 11. 비용 요약

### Azure Content Safety 가격

| Tier | 한도 | 가격 | 초과 시 |
|------|------|------|--------|
| **F0 (무료)** | 5,000건/월 | $0 | 요청 거부 (429) |
| **S0 (유료)** | 무제한 | $1.00 / 1,000건 | 종량제 |

### 시나리오별 예상 비용

| 월간 이미지 수 | Azure F0 | Azure S0 | (참고) Google Vision |
|-------------|---------|---------|-------------------|
| 1,000건 | **$0** | $1.00 | $0 |
| 5,000건 | **$0** | $5.00 | $6.00 |
| 10,000건 | (한도 초과) | $10.00 | $13.50 |
| 50,000건 | (한도 초과) | $50.00 | $73.50 |

> 상세 비용 분석: [docs/image-screening-cost-analysis.md](./image-screening-cost-analysis.md)

---

## 12. 향후 개선 사항

| 항목 | 설명 | 우선순위 |
|------|------|---------|
| 정규식 패턴 지원 | 띄어쓰기 우회 감지 (예: "시 발") | 높음 |
| 자모 분해 매칭 | 초성 축약어 감지 강화 | 중간 |
| 클라이언트 연동 | 포스트 작성 시 실시간 스크리닝 호출 | 중간 |
| NSFWJS 하이브리드 | 1차 로컬 필터 → 2차 Azure (비용 85% 절감) | 중간 |
| 스크리닝 로그 | 관리자 감사 추적 전용 컬렉션 | 낮음 |
| AI 기반 텍스트 분석 | LLM API 연동으로 문맥 기반 판단 | 낮음 |
| 대량 포스트 최적화 | Batch 처리 시 병렬화 및 Rate Limiting | 낮음 |
| 사용자 알림 | 포스트 삭제/숨김 시 작성자에게 푸시 알림 | 낮음 |
