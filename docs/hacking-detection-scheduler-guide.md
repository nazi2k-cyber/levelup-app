# 해킹 탐지 자동 스케줄러 — 작동 방식 및 문자 발송 원리

## 1. 개요

관리자 페이지 > 보안 리포트 탭에서 조회할 수 있는 해킹 탐지 시스템이다.  
기존 `security_alerts` 컬렉션에 쌓이는 보안 이벤트를 5분마다 자동으로 읽어 점수화하고,  
임계치를 초과하면 등록된 어드민 계정으로 SMS를 자동 발송한다.

---

## 2. 관련 파일

| 파일 | 역할 |
|------|------|
| `functions/hackingDetectionScheduler.js` | 5분 주기 탐지 스케줄러 본체 |
| `functions/smsGateway.js` | NCP SENS SMS 어댑터 + 전화번호 암호화 |
| `functions/index.js` | 스케줄러 등록 및 어드민 callable API 7개 노출 |
| `www/admin/js/security-report.js` | 어드민 UI — 탐지 결과·SMS 이력·룰·연락처 |

---

## 3. 전체 작동 흐름

```
Cloud Scheduler (매 5분)
       │
       ▼
detectHackingAttempts()
       │
       ├─ [1] 분산 락 획득 (scheduler_locks/{lockName})
       │        이미 실행 중이면 → 즉시 종료 (중복 실행 방지)
       │
       ├─ [2] 탐지 룰 로드
       │        security_rules 컬렉션 조회
       │        없으면 코드 내 DEFAULT_RULES 사용
       │
       ├─ [3] 룰별 반복 처리
       │        └─ security_alerts 쿼리 (최근 N분, type 일치)
       │            └─ userId / email 기준 클러스터 그룹핑
       │                └─ 클러스터 이벤트 수 >= threshold 이면
       │                    ├─ Idempotency key 중복 확인 → 이미 있으면 skip
       │                    ├─ 위험 점수 계산
       │                    ├─ security_findings 저장
       │                    └─ SMS 발송 조건 평가 → triggerSmsIfNeeded()
       │
       └─ [4] 락 해제
```

---

## 4. 기존 이벤트 수집과의 연결

새 스케줄러는 이벤트를 직접 생성하지 않는다.  
기존 코드가 수집해 `security_alerts`에 저장한 문서를 원료로 읽는다.

```
실시간 트리거 (securityTriggers.js)
  └─ 포인트 급증     → {type: "points_spike"}
  └─ 스탯 감소       → {type: "stats_decrease"}
  └─ 어드민 클레임   → {type: "admin_claim_set"}

주기 스케줄러 (securityScheduler.js)
  └─ 매시간  : 인증 실패 10회+ → {type: "brute_force"}
  └─ 매일    : 포인트 3회 반복  → {type: "repeat_points_spike"}
  └─ 매주    : 휴면 어드민 감사 → {type: "dormant_admin"}
                │
                ▼
           security_alerts 컬렉션
                │
                ▼  (매 5분 읽음)
      hackingDetectionScheduler
                │
                ▼
           security_findings 컬렉션 (점수·위험도·SMS 여부 저장)
```

---

## 5. 탐지 룰 (DEFAULT_RULES)

| ruleId | sourceType | severity | 기본 점수 | threshold | 윈도우 | 쿨다운 |
|--------|-----------|----------|----------|-----------|--------|--------|
| `login_failure_spike` | `brute_force` | high | 70 | 10건 | 60분 | 30분 |
| `repeat_points_spike` | `repeat_points_spike` | high | 75 | 1건 | 24시간 | 60분 |
| `stats_manipulation` | `stats_decrease` | **critical** | 90 | 1건 | 24시간 | 30분 |
| `admin_claim_suspicious` | `admin_claim_set` | high | 80 | 2건 | 60분 | 60분 |
| `dormant_admin_access` | `dormant_admin` | medium | 50 | 1건 | 7일 | 7일 |

> 운영 중 `security_rules` 컬렉션에 문서를 추가하면 코드 배포 없이 임계치·점수를 조정할 수 있다.  
> 어드민 UI의 **룰 설정** 패널(master 전용)에서 저장하면 즉시 반영된다.

---

## 6. 위험 점수 계산

```
baseScore = rule.score          (룰에 설정된 기본 점수)
ratio     = (이벤트 수 - threshold) / threshold
bonus     = min(20, floor(ratio × 10))   (최대 +20점)
finalScore = min(100, baseScore + bonus)
```

### 예시

| 상황 | 계산 | 결과 |
|------|------|------|
| 브루트포스 10건 (threshold=10, score=70) | 70 + 0 | **70** — SMS 미발송 |
| 브루트포스 25건 | 70 + min(20, 15) = 85 | **85** — SMS 발송 |
| 스탯 조작 1건 (critical, score=90) | 90 + 0 | **90** — 즉시 SMS 발송 |

---

## 7. 중복 방지 (Idempotency)

같은 공격이 다음 5분 주기에 재탐지되어도 `security_findings`에 중복 저장되지 않는다.

```
idempotencyKey = SHA1(
  "{ruleId}:{clusterKey}:{슬롯번호}"
)

슬롯번호 = floor(현재시각 ms / windowMinutes×60×1000)
         → 같은 시간 윈도우 내에서는 항상 동일한 key 생성
         → DB에 이미 존재하면 저장 스킵
```

---

## 8. SMS 발송 원리

### 8-1. 발송 조건 판단 흐름

```
triggerSmsIfNeeded(finding, rule)
       │
       ├─ severity가 critical 또는 high 인지 확인
       │        medium / low → 리포트 화면에만 표시, SMS 미발송
       │
       ├─ score >= 80 인지 확인 (critical은 score 무관)
       │
       ├─ 쿨다운 확인 (security_sms_logs 조회)
       │        동일 ruleId + clusterKey로 최근 cooldownMinutes 내
       │        발송 기록 있으면 → status: "skipped_cooldown" 기록 후 종료
       │
       ├─ 일일 상한 확인
       │        오늘 "sent" 건수 >= SMS_DAILY_CAP(기본 200) → "skipped_cap" 후 종료
       │
       ├─ admin_contacts 조회 (smsEnabled=true 인 수신자)
       │        수신자 없으면 → 경고 로그 후 종료
       │
       ├─ 각 수신자마다:
       │        encryptedPhone 복호화 (AES-256-GCM)
       │        sendSms(평문번호, 메시지) 호출
       │
       └─ security_sms_logs에 결과 저장
                status: "sent" | "failed" | "skipped_cooldown" | "skipped_cap" | "dry_run"
```

### 8-2. SMS 메시지 형식

```
[보안경보] 해킹의심 탐지
규칙: 로그인 실패 폭증, 위험도: HIGH
대상: uid:abc123, 이벤트: 25건
시각: 2026-04-30 10:30:00
```

### 8-3. 심각도별 발송 정책

| Severity | 발송 조건 | 동작 |
|----------|----------|------|
| **Critical** | score 무관, 즉시 | SMS 발송 + 쿨다운 적용 |
| **High** | score ≥ 80 | SMS 발송 + 쿨다운 적용 |
| **Medium** | — | 리포트 화면에만 표시 |
| **Low** | — | 리포트 화면에만 표시 |

---

## 9. NCP SENS API 연동 원리

```
POST https://sens.apigw.ntruss.com/sms/v2/services/{serviceId}/messages

── 헤더 ──────────────────────────────────────────────
x-ncp-apigw-timestamp   : 현재 Unix 타임스탬프 (ms)
x-ncp-iam-access-key    : SMS_ACCESS_KEY
x-ncp-apigw-signature-v2: HMAC-SHA256 서명
                           서명 대상 문자열:
                           "POST /sms/v2/services/{serviceId}/messages\n
                           {timestamp}\n
                           {accessKey}"
                           서명 키: SMS_SECRET_KEY

── 바디 ──────────────────────────────────────────────
{
  "type": "SMS",
  "from": "01000000000",
  "content": "[보안경보] ...",
  "messages": [{ "to": "01012345678" }]
}

── 응답 ──────────────────────────────────────────────
202 Accepted  → 발송 요청 성공
4xx / 5xx     → 지수 백오프 재시도 (1s → 2s → 4s, 최대 3회)
```

> 환경변수(`SMS_SERVICE_ID`, `SMS_ACCESS_KEY`, `SMS_SECRET_KEY`, `SMS_SENDER_NUMBER`)가  
> 설정되지 않으면 **dry-run 모드**로 동작한다. 실제 문자는 발송되지 않고  
> `security_sms_logs`에 `status: "dry_run"` 으로 기록된다.

---

## 10. 전화번호 보안 처리

```
[등록 시]                            [발송 시]
01012345678                          encryptedPhone (DB 저장값)
      │                                    │
      ▼  AES-256-GCM 암호화                ▼  AES-256-GCM 복호화
 encryptedPhone → DB 저장            01012345678 → NCP API 전달
      │
      ▼  마스킹
 010-****-5678 → UI/로그에 표시
```

- 암호화 키: `PHONE_ENCRYPTION_KEY` 환경변수 (32바이트 hex)
- 키 미설정 시 암호화 생략, 발송 차단 (복호화 불가)
- UI 및 로그에는 마스킹 값만 노출되며 평문 번호는 발송 직전에만 메모리에 존재

---

## 11. Firestore 컬렉션 스키마

### `security_findings/{id}`
| 필드 | 타입 | 설명 |
|------|------|------|
| `ruleId` | string | 탐지 룰 ID |
| `ruleName` | string | 룰 표시 이름 |
| `severity` | string | critical / high / medium / low |
| `score` | number | 0–100 위험 점수 |
| `clusterKey` | string | `uid:abc` 또는 `email:x@y.com` |
| `eventCount` | number | 클러스터 내 이벤트 수 |
| `relatedAlertIds` | string[] | 연관 security_alerts 문서 ID (최대 20) |
| `detectedAt` | Timestamp | 탐지 시각 |
| `smsSent` | boolean | SMS 발송 여부 |
| `smsLogId` | string\|null | security_sms_logs 문서 ID |
| `idempotencyKey` | string | 중복 방지 키 |
| `schedulerRunId` | string | 실행 회차 ID |

### `security_rules/{ruleId}`
| 필드 | 타입 | 설명 |
|------|------|------|
| `enabled` | boolean | 룰 활성화 여부 |
| `severity` | string | 위험도 |
| `score` | number | 기본 점수 |
| `threshold` | number | 발동 임계 이벤트 수 |
| `windowMinutes` | number | 집계 시간 윈도우(분) |
| `cooldownMinutes` | number | SMS 쿨다운(분) |
| `updatedAt` | Timestamp | 마지막 수정 시각 |
| `updatedBy` | string | 수정한 관리자 UID |

### `security_sms_logs/{id}`
| 필드 | 타입 | 설명 |
|------|------|------|
| `findingId` | string | 연관 finding 문서 ID |
| `ruleId` | string | 룰 ID |
| `clusterKey` | string | 발송 대상 클러스터 |
| `recipients` | `[{uid, maskedPhone}]` | 수신자 목록 (마스킹) |
| `message` | string\|null | 발송 메시지 본문 |
| `status` | string | sent / failed / skipped_cooldown / skipped_cap / dry_run |
| `attempts` | number | 발송 시도 횟수 |
| `sentAt` | Timestamp\|null | 실제 발송 시각 |
| `lastAttemptAt` | Timestamp | 마지막 시도 시각 |
| `idempotencyKey` | string | 중복 방지 키 |

### `admin_contacts/{uid}`
| 필드 | 타입 | 설명 |
|------|------|------|
| `uid` | string | 어드민 Firebase UID |
| `maskedPhone` | string | `010-****-5678` (UI 표시용) |
| `encryptedPhone` | string | AES-256-GCM 암호화 전화번호 |
| `smsEnabled` | boolean | SMS 수신 여부 |
| `updatedAt` | Timestamp | 등록/수정 시각 |
| `updatedBy` | string | 등록한 관리자 UID |

### `scheduler_locks/{lockName}`
| 필드 | 타입 | 설명 |
|------|------|------|
| `lockedAt` | Timestamp | 락 획득 시각 |
| `expiresAt` | Timestamp | 락 만료 시각 (획득 후 4분) |
| `runId` | string | 실행 회차 고유 ID |

---

## 12. 어드민 Callable API 목록

| 함수명 | 권한 | 설명 |
|--------|------|------|
| `getSecurityAlerts` | admin | 기존 원시 이벤트 조회 (변경 없음) |
| `getSecurityFindings` | admin | 탐지 결과 조회 |
| `getSecurityRules` | admin | 탐지 룰 조회 |
| `updateSecurityRule` | **master** | 룰 수정 (변경 이력 audit_logs 기록) |
| `getSmsAlertLogs` | admin | SMS 발송 이력 조회 |
| `registerAdminContact` | **master** | SMS 수신 어드민 연락처 등록 |
| `getAdminContacts` | **master** | 연락처 목록 조회 |
| `removeAdminContact` | **master** | 연락처 삭제 |

---

## 13. 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `PHONE_ENCRYPTION_KEY` | 권장 | 32바이트 hex — 전화번호 AES-256 암호화 키 |
| `SMS_SERVICE_ID` | SMS 사용 시 필수 | NCP SENS 서비스 ID |
| `SMS_ACCESS_KEY` | SMS 사용 시 필수 | NCP IAM Access Key |
| `SMS_SECRET_KEY` | SMS 사용 시 필수 | NCP IAM Secret Key |
| `SMS_SENDER_NUMBER` | SMS 사용 시 필수 | 발신번호 (숫자만, 예: `01000000000`) |
| `SMS_DAILY_CAP` | 선택 | 일일 SMS 발송 상한 (기본 200) |
| `HACKING_SCAN_INTERVAL` | 선택 | 스캔 주기 cron 표현식 (기본 `*/5 * * * *`) |

---

## 14. 운영 체크리스트

### 초기 설정
- [ ] Firebase Functions 환경변수에 위 13개 항목 설정
- [ ] 어드민 UI → 보안 리포트 → **SMS 수신 어드민 연락처** 패널에서 수신자 등록 (master 계정)
- [ ] `security_rules` 컬렉션 미생성 시 DEFAULT_RULES 자동 사용 — 별도 초기화 불필요

### 모니터링
- `security_findings` 컬렉션: 탐지 건수 및 severity 분포 확인
- `security_sms_logs` 컬렉션: `status: "failed"` 비율 모니터링
- `scheduler_locks` 컬렉션: `expiresAt` 이 과거인데 문서가 남아있으면 비정상 종료 의심

### 오탐 발생 시
1. 어드민 UI → 룰 설정에서 해당 룰의 `threshold` 값 상향 조정 저장
2. `score` 값을 80 이상으로 올려 SMS 발송 기준 강화
3. 룰 자체를 비활성화하려면 `enabled` 토글 OFF 후 저장

### SMS 미발송 시 확인 순서
1. `security_sms_logs`에서 해당 finding의 `status` 확인
2. `dry_run` → 환경변수 미설정 (SMS_SERVICE_ID 등 확인)
3. `skipped_cooldown` → 쿨다운 대기 중, 정상 동작
4. `skipped_cap` → 일일 상한 초과, `SMS_DAILY_CAP` 상향 또는 내일 재확인
5. `failed` → NCP SENS API 오류, `gatewayResponse` 필드에서 상세 확인

---

## 15. 문자 수신 시 상황별 액션 플랜

### 공통 초동 절차 (모든 문자 수신 시)

```
1. 어드민 패널 접속 → 보안 리포트 탭
2. 탐지 결과(Findings) 조회로 score · eventCount 확인
3. 해당 clusterKey(uid 또는 IP)의 원시 알림 확인
4. 아래 룰별 대응 진행
```

---

### 룰별 상세 액션

#### 1. 로그인 실패 폭증 (`login_failure_spike`)
> 1시간 내 동일 계정 인증 실패 10회 이상

| score | 상황 판단 | 조치 |
|-------|----------|------|
| 70–79 | 사용자 실수 가능성 | 관찰 유지, 추가 발생 시 재검토 |
| 80–89 | Brute-force 의심 | 해당 계정 일시 잠금 (Firebase Console) |
| 90+ | 자동화 공격 확실 | 계정 잠금 + IP 차단 + 방화벽 룰 추가 |

**Firebase Console 계정 잠금 경로**
```
Firebase Console → Authentication → 해당 사용자 → Disable account
```

---

#### 2. 반복 포인트 급증 (`repeat_points_spike`)
> 24시간 내 동일 유저 포인트 급증 3회 이상

```
1. 어드민 패널 → 유저 관리 → 해당 uid 검색
2. 포인트 내역 및 퀘스트 완료 이력 확인
3. 정상 플레이 범위 초과 여부 판단
   ├─ 정상 → 오탐, 룰 threshold 상향 조정
   └─ 이상 → 포인트 롤백 + 계정 정지 + security_alerts 기록 검토
4. 반복 발생 시 해당 uid를 수동 감시 목록에 추가
```

---

#### 3. 스탯 조작 의심 (`stats_manipulation`) — Critical
> 퀘스트 완료 수 등 스탯이 감소 (데이터 직접 조작 의심)

**즉각 대응 필요**

```
1. 해당 유저 계정 즉시 비활성화
2. Firestore Console에서 해당 users/{uid} 문서 스냅샷 백업
3. user_backups 컬렉션에서 직전 정상 백업 확인
4. 조작된 필드 식별 → 정상값으로 복원
5. 어떤 경로로 조작했는지 app_error_logs 역추적
6. Firestore Rules에 해당 필드 write 차단 추가 검토
```

> score 90으로 시작하는 Critical 룰 — **수신 즉시 조치**

---

#### 4. 어드민 클레임 이상 (`admin_claim_suspicious`)
> 1시간 내 어드민 권한 부여 2건 이상

```
1. 어드민 패널 → Claim 관리 → 최근 부여 이력 확인
2. admin_audit_log 컬렉션에서 grantedBy 확인
   ├─ 본인이 의도한 작업 → 정상, 오탐 처리
   └─ 의도하지 않은 부여 → 아래 진행
3. 비정상 부여된 클레임 즉시 회수 (removeAdminClaim)
4. grantedBy 계정의 토큰 강제 만료
   Firebase Console → Authentication → Revoke all sessions
5. 해당 계정 MFA 재설정 요구
6. 어떤 함수 호출로 부여됐는지 Cloud Functions 로그 확인
```

---

#### 5. 휴면 어드민 접근 (`dormant_admin_access`)
> 90일 이상 미접속 어드민 계정 감지

```
1. 어드민 패널 → Claim 관리에서 해당 계정 확인
2. 본인 접속 여부 확인 (실제 담당자에게 직접 연락)
   ├─ 본인 접속 → 계정 활성 전환, 쿨다운 룰 적용
   └─ 본인 아님 → 아래 진행
3. 해당 계정 즉시 비활성화 + 클레임 회수
4. 접속 기기·IP 확인 (Firebase Console → Authentication → 로그인 기록)
5. 비밀번호 강제 초기화
```

---

### 대응 우선순위 매트릭스

```
                즉각 대응              30분 내 대응             업무시간 내
                ─────────────────────────────────────────────────────────
Critical    │   stats_manipulation
High        │                          login_failure (90+)      login_failure (80~89)
            │                          admin_claim_suspicious
Medium      │                                                   dormant_admin
Low         │                                                   (UI 확인만)
```

---

### 오탐 판단 기준 및 조치

| 상황 | 판단 | 조치 |
|------|------|------|
| 유저가 빠르게 반복 퀘스트 클리어 | 오탐 | `repeat_points_spike` threshold 상향 |
| 관리자가 직접 클레임 부여 중 | 오탐 | `admin_claim_suspicious` cooldown 연장 |
| 내부 테스트 계정 활동 | 오탐 | 테스트 uid를 룰 예외 처리 |
| 마이그레이션 등 대량 자동화 작업 | 오탐 | 작업 전 해당 룰 임시 비활성화 |

> 오탐 조치: 어드민 UI → 룰 설정 → threshold 또는 cooldown 조정 후 저장 (즉시 반영, 코드 배포 불필요)

---

### SMS 미수신 시 확인 순서 (재확인)

```
security_sms_logs 상태별:
  dry_run          → 환경변수 미설정 (SMS_SERVICE_ID 등)
  skipped_cooldown → 정상, 쿨다운 대기 중
  skipped_cap      → 일일 상한 초과 → 어드민 UI에서 smsDailyCap 상향
  failed           → NCP SENS 장애 → gatewayResponse 필드에서 상세 확인
```
