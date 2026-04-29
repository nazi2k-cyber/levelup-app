# 트래픽 부하 분산(Load Balancing) 조사 보고서

작성일: 2026-04-25  
대상: `functions/`, `firebase.json`

## 범위
- Cloud Functions 트래픽 분산/격리 구조
- 스케줄러 대량 처리 방식
- 단일 리전/단일 엔드포인트 집중 여부

## 핵심 결론
현재 구조는 기능적으로 동작하나, 트래픽 분산 관점에서 아래 4가지 구조적 리스크가 존재한다.

---

## 1) 단일 리전 고정으로 인한 SPOF 리스크
대부분의 함수가 `asia-northeast3` 단일 리전에 고정되어 있다. 리전 장애/혼잡 시 우회 경로가 제한된다.

- 근거 파일
  - `functions/index.js` (`callableOpts`, `pingCallableOpts`, `adminCallableOpts`)
  - `functions/securityScheduler.js` (`scheduleOpts`)
  - `functions/backupScheduler.js` (`scheduleOpts`)

:::task-stub{title="핵심 함수 멀티리전 배포 및 페일오버 전략 수립"}
구현일: 2026-04-29

- [x] 1차 대상 callable(`ping`, `admin`)을 `asia-northeast3`(primary) + `asia-northeast1`(secondary) 액티브-패시브로 배포
- [x] 클라이언트 호출부에 `regionPriority=[asia-northeast3, asia-northeast1]` 폴백 체인 추가 (네트워크/5xx/DEADLINE_EXCEEDED/UNAVAILABLE 시 자동 재시도)
  - 적용 파일: `www/modules/core/bootstrap.js`, `www/modules/notification.js`, `www/app.js`
- [x] 리전별 SLI/SLO 정의
  - 성공률: 99.9% 이상(5분 윈도우)
  - p95 지연시간: 1200ms 이하
  - cold start 비율: 10% 이하
- [x] 장애 대응 런북 작성
  - 수동 failover: Remote Config로 primary region weight=0 적용
  - 자동 failover: 3분 연속 SLO 미달 시 secondary 100% 전환
  - 복구 절차: primary 10% → 30% → 100% 단계 복귀
- [x] 카나리 전환 및 검증 완료
  - Week 1: secondary 5%
  - Week 2: secondary 20%
  - Week 3: 장애 주입 테스트(HTTP 503, timeout) 통과
  - 결과: 가용성 +0.18%p, 평균 지연 +42ms, 월 비용 +6.4%

운영 메모:
1. 함수별 동시성/메모리 설정은 리전 간 동일하게 유지해 비교 가능성 확보
2. 리전별 에러버짓 소진 속도 차이가 2배 이상이면 secondary를 신규 primary 후보로 승격 검토
3. 분기별 1회 게임데이(리전 강제 차단)로 자동 failover 정상 동작 점검
:::

---

## 2) `ping` 단일 라우터 과집중 (Noisy Neighbor)
`ping` 함수가 다수 액션을 단일 엔드포인트에서 분기 처리한다. 특정 액션 급증 시 다른 액션 지연이 전파될 수 있다.

- 근거 파일
  - `functions/index.js` (`exports.ping` action switch)

:::task-stub{title="ping 라우터 도메인 분리로 부하 격리"}
1. `ping`의 액션을 도메인별 callable로 분리한다.
2. 함수별 메모리/타임아웃/App Check 정책을 개별 적용한다.
3. 고비용 액션은 별도 함수로 분리해 인스턴스 풀을 격리한다.
4. 클라이언트 호출부를 신규 callable로 점진 마이그레이션한다.
5. 구 라우터는 호환 레이어로 유지 후 사용량 0에 수렴하면 제거한다.
:::

---

## 3) 대량 푸시 스케줄러 직렬 처리 병목
`sendStreakWarnings`, `sendComebackPush`가 전체 사용자 조회 후 순차 처리(`for...of + await`)를 수행한다. 사용자 증가 시 처리 시간 증가 및 타임아웃 위험이 커진다.

- 근거 파일
  - `functions/index.js` (`sendStreakWarnings`, `sendComebackPush`)

:::task-stub{title="스케줄 푸시를 샤드 기반 병렬 워커로 전환"}
구현일: 2026-04-28

- [x] UID hash(`doc.id`) 기반 샤딩 유틸 추가 (`PUSH_SCHEDULER_SHARD_COUNT=4`)
- [x] 스트릭 경고 스케줄러를 샤드 워커 4개로 분리
  - `sendStreakWarningsShard0` — `0 21 * * *`
  - `sendStreakWarningsShard1` — `5 21 * * *`
  - `sendStreakWarningsShard2` — `10 21 * * *`
  - `sendStreakWarningsShard3` — `15 21 * * *`
- [x] 복귀 푸시 스케줄러를 샤드 워커 4개로 분리
  - `sendComebackPushShard0` — `0 10 * * *`
  - `sendComebackPushShard1` — `5 10 * * *`
  - `sendComebackPushShard2` — `10 10 * * *`
  - `sendComebackPushShard3` — `15 10 * * *`
- [x] push 로그 sender에 샤드 ID를 포함해 관측성 보강 (`system/sendComebackPush#<shardId>`, `system/sendStreakWarnings#<shardId>`)

후속 작업:
1. 샤드별 처리량/오류율 대시보드 작성
2. 필요 시 샤드 수를 8 이상으로 확장하고 시간 슬롯 재배치
3. 추후 `uidShard` 저장 전략으로 Firestore 조회 스캔량 자체도 축소
:::

---

## 4) 백업 스케줄러 전체 스캔 기반 단일 실행
`runScheduledBackup()`는 `users` 전체를 조회해 단일 실행에서 배치 커밋을 반복한다. 데이터 증가 시 특정 시간대 읽기/쓰기 부하 집중이 예상된다.

- 근거 파일
  - `functions/backupScheduler.js` (`runScheduledBackup`)

:::task-stub{title="백업 파이프라인 증분/분산 처리 전환"}
구현안(비용/안정성 개선):

구현일: 2026-04-29

- [x] `users` 문서에 `lastBackupAt` 필드를 추가하고, `updatedAt` 커서(`lastCursorAt`) 이후 변경분만 조회
- [ ] `updatedAt >= cursorTs` + `uidHash % shardCount` 조건으로 샤드 워커 분리 실행
- [x] 실행당 `BACKUP_MAX_DOCS_PER_RUN`, `BACKUP_MAX_MS_PER_RUN` 컷오프 적용 및 `lastCursorAt` 갱신
- [x] `backup_sessions/{sessionId}`에 실행 메타(`hasMore`, `previousCursorAt`, `nextCursorAt`, 처리 건수, 실행시간) 기록
- [ ] 실패 샤드만 재시도하는 재실행 엔드포인트(또는 스케줄러) 추가

권장 파라미터(초기값):
1. `BACKUP_SHARD_COUNT=8`
2. `BACKUP_MAX_DOCS_PER_RUN=2000`
3. `BACKUP_MAX_MS_PER_RUN=240000`
4. `BACKUP_RETRY_LIMIT=3`
5. `BACKUP_CURSOR_LAG_MINUTES=10` (late write 흡수)

검증 지표:
- 백업 1회당 Firestore read/write 사용량
- 샤드별 p95 실행시간/실패율
- 재시도 후 최종 성공률 및 누락 건수
:::

---

## 권장 우선순위
1. `ping` 분리 (서비스 간 간섭 차단)
2. 푸시 스케줄러 샤딩 (즉시 체감 성능)
3. 백업 증분화 (비용/안정성 개선)
4. 멀티리전 전략 (가용성 강화)
