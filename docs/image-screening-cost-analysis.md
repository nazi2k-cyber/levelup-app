# 이미지 스크리닝 비용 분석 및 대안 검토

## 1. 개요

자동 스크리닝 시스템의 이미지 검열에 사용할 수 있는 솔루션들의 비용, 정확도, 호환성을 비교 분석합니다.
검토 결과 **NSFWJS (1차 무료) + Azure Content Safety (2차 정밀) 하이브리드 방식**을 채택하였습니다.
이 문서는 비교 분석 과정과 비용 시뮬레이션을 기록합니다.

### 기술 환경 조건

| 항목 | 사양 |
|------|------|
| 백엔드 런타임 | Firebase Cloud Functions (Node.js 20) |
| 클라우드 플랫폼 | Google Cloud Platform (asia-northeast3, Seoul) |
| 요구 감지 카테고리 | 성인물, 폭력, 선정성 (최소) |
| 예상 포스트 수 | 일 50~500건 (월 1,500~15,000건) |

---

## 2. Google Cloud Vision API 비용 분석

### 2.1 가격 체계

SafeSearch Detection은 Vision API의 일반 Feature Detection에 해당합니다.

| 월간 호출량 | 1,000건당 가격 | 비고 |
|------------|--------------|------|
| 0 ~ 1,000건 | **무료** | 매월 자동 리셋 |
| 1,001 ~ 5,000,000건 | **$1.50** | 대부분의 앱이 이 구간 |
| 5,000,001 ~ 20,000,000건 | **$1.00** | 대규모 서비스 |
| 20,000,001건 이상 | 별도 협의 | Enterprise |

> 리전별 가격 차이 없음. 네트워크 이그레스 비용은 별도.

### 2.2 예상 비용 시뮬레이션

| 시나리오 | 월간 이미지 수 | 무료 분 제외 | 월 예상 비용 | 연간 비용 |
|---------|-------------|------------|------------|----------|
| 초기 (소규모) | 500건 | 0건 | **$0** | **$0** |
| 성장기 | 1,000건 | 0건 | **$0** | **$0** |
| 활성 유저 증가 | 5,000건 | 4,000건 | **$6.00** | **$72** |
| 안정적 운영 | 10,000건 | 9,000건 | **$13.50** | **$162** |
| 대규모 성장 | 30,000건 | 29,000건 | **$43.50** | **$522** |
| 최대 예상 | 50,000건 | 49,000건 | **$73.50** | **$882** |

### 2.3 추가 비용 요소

| 항목 | 예상 비용 | 비고 |
|------|----------|------|
| Cloud Functions 실행 | ~$0.40/백만건 | 256MB 기준, 스크리닝 로직 포함 |
| 네트워크 이그레스 | 미미 | 요청/응답이 소량 JSON |
| Firestore 읽기/쓰기 | ~$0.06/10만건 | screening_results 저장 |
| **총 부대 비용** | **월 $1~5 추정** | Vision API 비용 대비 매우 적음 |

### 2.4 Vision API 감지 카테고리

| 카테고리 | 설명 | Likelihood 값 |
|---------|------|-------------|
| Adult | 성인/노출 콘텐츠 | VERY_UNLIKELY ~ VERY_LIKELY |
| Violence | 폭력적 콘텐츠 | VERY_UNLIKELY ~ VERY_LIKELY |
| Racy | 선정적 콘텐츠 | VERY_UNLIKELY ~ VERY_LIKELY |
| Medical | 의료/수술 이미지 | VERY_UNLIKELY ~ VERY_LIKELY |
| Spoof | 밈/패러디 이미지 | VERY_UNLIKELY ~ VERY_LIKELY |

---

## 3. 무료 대안 솔루션 비교

### 3.1 NSFWJS (TensorFlow.js) -- 완전 무료, 자체 호스팅

| 항목 | 내용 |
|------|------|
| **npm 패키지** | `nsfwjs` + `@tensorflow/tfjs-node` |
| **비용** | 완전 무료 (제한 없음) |
| **감지 카테고리** | Porn, Hentai, Sexy, Drawing, Neutral (5개) |
| **정확도** | 성적 콘텐츠 90~93% (폭력/의료 감지 불가) |
| **Node.js 호환** | 네이티브 지원 (`@tensorflow/tfjs-node` C++ 바인딩) |
| **모델 크기** | MobileNet v2: ~5MB / Inception v3: ~80MB |
| **추론 시간** | Warm: 100~300ms / Cold: **3~8초** (모델 로딩) |
| **필요 메모리** | Cloud Functions 최소 512MB, 권장 1GB |

**장점**
- API 호출 비용 $0, 무제한 사용
- 외부 네트워크 의존성 없음 (자체 추론)
- 안정적인 오픈소스 (GitHub 15k+ stars)

**단점**
- 콜드 스타트 3~8초 (서버리스 환경에서 치명적)
- 성적 콘텐츠만 감지 (폭력, 혐오, 마약 등 감지 불가)
- `@tensorflow/tfjs-node` 네이티브 의존성이 배포 환경에 따라 문제 가능
- Cloud Functions 메모리 증가로 인한 비용 증가 가능

**Cloud Functions에서의 콜드 스타트 완화 방법**
```
방법 1: min_instances 설정 (항상 1개 인스턴스 유지)
  → 월 ~$10~30 추가 비용 (Vision API보다 비쌀 수 있음)

방법 2: Cloud Run으로 전환 (min-instances=1)
  → 아키텍처 변경 필요

방법 3: MobileNet v2 (소형 모델) 사용
  → 콜드 스타트 3~4초로 단축, 정확도 소폭 하락
```

### 3.2 Azure Content Safety -- 월 5,000건 무료 (영구)

| 항목 | 내용 |
|------|------|
| **서비스** | Azure AI Content Safety |
| **무료 한도** | **5,000건/월** (영구 무료, F0 tier) |
| **유료 가격** | $1.00 / 1,000건 (S0 tier) |
| **감지 카테고리** | Sexual, Violence, Hate, SelfHarm (4개, 각 0~6 심각도) |
| **정확도** | 매우 높음 (심각도 세분화가 강점) |
| **Node.js 호환** | `@azure/ai-content-safety` SDK |
| **콜드 스타트** | 낮음 (API 호출, ~200~400ms) |

**장점**
- 영구 무료 5,000건은 소규모 앱에 충분
- 4단계 심각도 세분화 (0~6)가 자동 조치 임계값 설정에 유리
- Hate, SelfHarm 감지는 다른 솔루션에 없는 강점
- 안정적인 API (Microsoft Azure)

**단점**
- Azure 계정 필요 (GCP와 별도)
- Firebase/GCP 스택에 Azure 의존성 추가
- 5,000건 초과 시 유료 전환 필요
- API 키 관리가 추가됨

### 3.3 Amazon Rekognition -- 월 5,000건 무료 (12개월)

| 항목 | 내용 |
|------|------|
| **서비스** | AWS Rekognition Content Moderation |
| **무료 한도** | **5,000건/월** (최초 12개월만) |
| **유료 가격** | $1.00 / 1,000건 (1M 이하) |
| **감지 카테고리** | Nudity, Violence, Drugs, Tobacco, Alcohol, Hate, Gambling 등 (10+개) |
| **정확도** | 매우 높음 (카테고리 최다) |
| **Node.js 호환** | `@aws-sdk/client-rekognition` |
| **콜드 스타트** | 낮음 (API 호출) |

**장점**
- 업계 최다 감지 카테고리 (마약, 도박, 무기 등)
- 12개월 무료 기간 동안 충분히 테스트 가능
- 유료 전환 시에도 Google Vision보다 저렴 ($1.00 vs $1.50)

**단점**
- 무료 한도가 12개월 후 소멸
- AWS 계정 및 IAM 설정 필요
- GCP 스택에 AWS 의존성 추가

### 3.4 Clarifai -- 월 1,000건 무료 (영구)

| 항목 | 내용 |
|------|------|
| **서비스** | Clarifai Moderation Model |
| **무료 한도** | **1,000건/월** (Community plan, 영구) |
| **유료 가격** | ~$30/월 (Essential plan) |
| **감지 카테고리** | Safe, Suggestive, Explicit, Gore, Drug, Tobacco, Alcohol (7개) |
| **정확도** | 높음 (상용 수준) |
| **Node.js 호환** | `clarifai` npm SDK |
| **콜드 스타트** | 낮음 (API 호출) |

**장점**
- 영구 무료 1,000건
- 상세한 카테고리 분류 (7개)
- 간편한 SDK

**단점**
- 무료 한도가 매우 적음 (1,000건)
- 유료 전환 시 $30/월로 비용 점프가 큼

### 3.5 Sightengine -- 월 500건 무료

| 항목 | 내용 |
|------|------|
| **서비스** | Sightengine Image Moderation |
| **무료 한도** | **500건/월** |
| **유료 가격** | ~$31/월 (10,000건) |
| **감지 카테고리** | Nudity, Weapons, Drugs, Gore, Offensive, Text, Faces (10+개) |
| **정확도** | 매우 높음 (누드 감지 특히 우수) |
| **Node.js 호환** | REST API (axios/fetch로 호출) |
| **콜드 스타트** | 낮음 (API 호출, ~200~400ms) |

**장점**
- 업계 최고 수준의 누드 감지 정확도
- 텍스트 감지, 얼굴 인식 등 부가 기능
- 간편한 REST API

**단점**
- 무료 한도가 500건으로 매우 적음
- 유료 전환 시 비용이 높은 편

### 3.6 Cloudmersive -- 월 800건 무료

| 항목 | 내용 |
|------|------|
| **서비스** | Cloudmersive Content Moderation API |
| **무료 한도** | **800건/월** (전체 API 통합) |
| **유료 가격** | ~$12/월 (5,000건) |
| **감지 카테고리** | SFW/NSFW (이진 분류) |
| **정확도** | 보통 (경계 사례에 약함) |
| **Node.js 호환** | `cloudmersive-image-api-client` |

**장점**: 저렴한 유료 요금
**단점**: 이진 분류만 가능, 정확도 낮음. **프로덕션 비추천.**

---

## 4. 종합 비교표

| 솔루션 | 무료 한도 | 유료 가격 (1K건) | 감지 범위 | 정확도 | Node.js | 콜드 스타트 | 추천도 |
|--------|---------|----------------|---------|-------|---------|-----------|-------|
| **Google Vision** | 1,000/월 | $1.50 | 5개 | 높음 | SDK | 낮음 | ★★★★☆ |
| **NSFWJS** | **무제한** | $0 | 성적 콘텐츠만 | 양호 | 네이티브 | **높음** | ★★★☆☆ |
| **Azure Content Safety** | **5,000/월** | $1.00 | 4개+심각도 | 매우 높음 | SDK | 낮음 | ★★★★★ |
| **AWS Rekognition** | 5,000/월 (12개월) | $1.00 | **10+개** | 매우 높음 | SDK | 낮음 | ★★★★☆ |
| **Clarifai** | 1,000/월 | ~$30/월 | 7개 | 높음 | SDK | 낮음 | ★★★☆☆ |
| **Sightengine** | 500/월 | ~$31/월 | 10+개 | 매우 높음 | REST | 낮음 | ★★★☆☆ |
| **Cloudmersive** | 800/월 | ~$12/월 | 2개 (이진) | 보통 | SDK | 낮음 | ★★☆☆☆ |

---

## 5. 시나리오별 추천

### 시나리오 A: 월 1,000건 이하 (소규모 앱)

> **추천: Google Cloud Vision API (현재 구현 유지)**

- 무료 한도 내에서 비용 $0
- 이미 GCP/Firebase 스택에서 운영 중이므로 추가 설정 없음
- Vision API 활성화만 하면 바로 사용 가능

### 시나리오 B: 월 1,000~5,000건 (성장하는 앱)

> **추천: Azure Content Safety (영구 무료 5,000건)**

```
도입 방법:
1. Azure 계정 생성 (무료)
2. Content Safety 리소스 생성 (F0 무료 tier)
3. API 키 발급
4. functions/index.js의 screenImage() 함수에 Azure 호출 로직 추가
5. Firebase Functions 환경변수에 API 키 설정
```

- 비용 $0으로 5,000건까지 커버
- Vision API보다 심각도 세분화가 우수 (0~6 등급)
- Hate, SelfHarm 추가 감지는 커뮤니티 앱에 유용

### 시나리오 C: 비용 완전 무료 (무제한)

> **추천: NSFWJS + 텍스트 스크리닝 조합**

```
도입 방법:
1. npm install nsfwjs @tensorflow/tfjs-node
2. screenImage() 함수를 NSFWJS 추론으로 교체
3. Cloud Functions 메모리를 1GB로 증가
4. 폭력/혐오 감지는 텍스트 스크리닝으로 보완
```

| 비용 항목 | 예상 |
|----------|------|
| API 비용 | $0 |
| Cloud Functions 메모리 증가 (256MB → 1GB) | +$5~15/월 |
| min_instances=1 (콜드스타트 방지) | +$10~30/월 |
| **총 비용** | **$15~45/월** (고정) |

> 주의: 콜드스타트 문제와 성적 콘텐츠만 감지 가능한 한계가 있음

### 시나리오 D: 최고 정확도 + 넓은 감지 범위

> **추천: AWS Rekognition 또는 Google Vision + NSFWJS 하이브리드**

**옵션 1: AWS Rekognition**
- 12개월 무료 5,000건으로 시작
- 유료 전환 시 Google Vision보다 저렴 ($1.00 vs $1.50)
- 마약, 도박, 무기 등 10개+ 카테고리

**옵션 2: 하이브리드 (비용 최적화)**
```
1차: NSFWJS로 로컬 스크리닝 (무료, 빠른 필터)
  → 명확한 Porn/Hentai → 즉시 플래그 (API 호출 불필요)
  → Neutral/Drawing → 통과 (API 호출 불필요)

2차: 애매한 결과(Sexy)만 Vision API로 정밀 검사
  → API 호출 건수 60~80% 절감 가능
```

---

## 6. 하이브리드 방식 상세 설계 (비용 최적화)

NSFWJS(무료) + Google Vision API(유료)를 조합하여 비용을 최소화하는 방식입니다.

### 6.1 동작 흐름

```
이미지 업로드
    │
    ▼
NSFWJS 로컬 추론 (무료)
    │
    ├── Porn/Hentai 확률 > 80% → 즉시 HIGH 플래그 (Vision 호출 안함)
    ├── Neutral/Drawing 확률 > 90% → 통과 (Vision 호출 안함)
    │
    └── 애매한 결과 (Sexy > 30% 등)
         │
         ▼
    Google Vision SafeSearch (유료)
         │
         ├── LIKELY/VERY_LIKELY → 플래그
         └── UNLIKELY 이하 → 통과
```

### 6.2 예상 비용 절감 효과

일반적인 커뮤니티 앱에서 이미지 분포 가정:

| 이미지 유형 | 비율 | NSFWJS 처리 | Vision API 필요 |
|-----------|------|------------|----------------|
| 명확한 일반 이미지 | ~85% | Neutral/Drawing → 통과 | 불필요 |
| 명확한 부적절 이미지 | ~3% | Porn/Hentai → 플래그 | 불필요 |
| 경계선 이미지 | ~12% | Sexy/불확실 | **필요** |

| 월간 이미지 | Vision API만 | 하이브리드 (12%만 API) | 절감액 |
|-----------|------------|---------------------|-------|
| 5,000건 | $6.00 | $0.90 | **$5.10 (85%)** |
| 10,000건 | $13.50 | $1.80 | **$11.70 (87%)** |
| 50,000건 | $73.50 | $8.82 | **$64.68 (88%)** |

---

## 7. 현재 시스템 구현 (NSFWJS + Azure 하이브리드 채택)

비교 분석 결과 **NSFWJS 1차 로컬 필터 + Azure Content Safety 2차 정밀검사** 하이브리드 방식을 채택하여 구현 완료되었습니다.

### 7.1 채택 이유

단일 솔루션의 한계를 조합으로 해결:

| 기준 | NSFWJS 단독 | Azure 단독 | **하이브리드 (채택)** |
|------|-----------|-----------|---------------------|
| 비용 | $0 | F0: 5,000건/월 | **$0 (~40,000건까지)** |
| 성적 콘텐츠 감지 | 우수 | 우수 | **우수** |
| 폭력/혐오/자해 | 불가 | 가능 | **가능** (2차에서) |
| 콜드 스타트 | 3~8초 | 낮음 | 3~8초 (1차) |
| API 비용 최적화 | N/A | 100% 호출 | **~12%만 호출** |

### 7.2 현재 구현: 하이브리드 흐름

```
이미지 업로드
    │
    ▼
[1차] NSFWJS 로컬 추론 (screenImageLocal)
    │   MobileNetV2 모델, 무료, ~100-300ms (warm)
    │
    ├── Porn/Hentai > 80%
    │   → 즉시 HIGH 플래그 반환 (_source: "nsfwjs")
    │   → Azure 호출 안함 ✓
    │
    ├── Neutral/Drawing > 90%
    │   → null 반환 (안전, 플래그 없음)
    │   → Azure 호출 안함 ✓
    │
    └── 애매한 결과 (Sexy > 30% 등)
         │
         ├── [azureEnabled = true]
         │   ▼
         │   [2차] Azure Content Safety (screenImageAzure)
         │   → Sexual, Violence, Hate, SelfHarm 정밀 분석
         │   → _source: "azure", _nsfwScores 포함 반환
         │
         └── [azureEnabled = false]
             → NSFWJS 결과로 플래그 반환 (_source: "nsfwjs")
```

### 7.3 반환 형식

```javascript
{
    adult: "VERY_UNLIKELY" | "UNLIKELY" | "POSSIBLE" | "LIKELY" | "VERY_LIKELY",
    violence: "...",     // Azure 2차에서만 감지
    racy: "...",
    hate: "...",         // Azure 2차에서만 감지
    selfHarm: "...",     // Azure 2차에서만 감지
    _source: "nsfwjs" | "azure",    // 판정 소스
    _nsfwScores: {                  // NSFWJS 원본 점수 (진단용)
        porn: 0.02, sexy: 0.35, hentai: 0.01, neutral: 0.52, drawing: 0.10
    }
}
```

### 7.4 NSFWJS 판정 기준값

| 조건 | 동작 | Azure 호출 |
|------|------|-----------|
| `Porn > 0.80` 또는 `Hentai > 0.80` | 즉시 HIGH 플래그 | **안함** |
| `Neutral > 0.90` 또는 `Drawing > 0.90` | 안전 통과 | **안함** |
| `Sexy > 0.30` (Azure 꺼짐) | NSFWJS 결과로 플래그 | **안함** |
| 그 외 애매한 결과 (Azure 켜짐) | Azure 2차 검사 | **호출** |

### 7.5 환경변수 설정

```bash
# Azure 2차 정밀검사 사용 시 (선택)
AZURE_CS_ENDPOINT=https://<리소스명>.cognitiveservices.azure.com
AZURE_CS_KEY=<Azure KEY 1>

# NSFWJS는 환경변수 불필요 (npm 패키지에 모델 포함)
```

### 7.6 필요 의존성

```json
{
    "nsfwjs": "^4.1.0",
    "@tensorflow/tfjs-node": "^4.22.0",
    "@azure-rest/ai-content-safety": "^1.0.0",
    "@azure/core-auth": "^1.9.0"
}
```

> Cloud Functions 메모리: NSFWJS 모델 로딩에 **최소 512MB, 권장 1GB** 필요

---

## 8. 최종 결론

### 현재 상태: NSFWJS + Azure 하이브리드 구현 완료

- **이미지 스크리닝**: 기본 꺼짐 → 관리자 UI에서 활성화
- **1차 NSFWJS**: 이미지 스크리닝 활성화만으로 무료 사용 (무제한)
- **2차 Azure**: 별도 토글로 활성화 (F0: 5,000건/월 무료, 실제 호출은 ~12%만)
- **월 ~40,000건까지 완전 무료** (Azure F0 5,000건 ÷ 12% ≈ 41,667건)

### 단계별 운영 로드맵

```
Phase 1 (현재): 텍스트 스크리닝만 사용 — $0
    ↓ 이미지 검열 필요 발생 시
Phase 2: 이미지 스크리닝 활성화 (NSFWJS만) — $0 (무제한, 성적 콘텐츠만)
    ↓ 폭력/혐오/자해 감지 필요 시
Phase 3: Azure 2차 정밀검사 활성화 — $0 (~40,000건/월까지 무료)
    ↓ 월 40,000건 초과 시
Phase 4: Azure S0 tier 전환 — ~$1/월 (50,000건 기준, 12%만 호출)
    ↓ 대규모 성장 시
Phase 5: AWS Rekognition 전환 검토 — $1.00/1K (최다 카테고리)
```

### 핵심 요약

| 규모 | 현재 솔루션 | Azure 호출 (~12%) | 월 비용 |
|------|-----------|-----------------|--------|
| ~5,000건 | **하이브리드 (현재)** | ~600건 (F0) | **$0** |
| ~10,000건 | 하이브리드 | ~1,200건 (F0) | **$0** |
| ~30,000건 | 하이브리드 | ~3,600건 (F0) | **$0** |
| ~40,000건 | 하이브리드 | ~4,800건 (F0) | **$0** |
| ~50,000건 | 하이브리드 | ~6,000건 (S0) | **~$1** |
| ~100,000건 | 하이브리드 | ~12,000건 (S0) | **~$12** |
