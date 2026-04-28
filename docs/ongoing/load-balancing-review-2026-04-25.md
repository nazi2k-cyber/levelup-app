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
1. 사용자 트래픽이 큰 callable 함수부터 2개 이상 리전에 배포한다.
2. 클라이언트 호출부에 리전 장애 시 대체 경로를 추가한다.
3. 리전별 오류율/지연시간 모니터링 지표를 정의한다.
4. 장애 대응 런북(수동/자동 failover)을 문서화한다.
5. 카나리 방식으로 단계 전환 후 비용/성능 비교 검증한다.
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
1. 전체 스캔 대신 증분 백업 기준(`updatedAt`/`lastBackupAt`)을 도입한다.
2. 대상 범위를 시간/UID 범위로 분할해 다중 작업으로 실행한다.
3. 실행당 최대 처리량/최대 실행시간 컷오프를 설정한다.
4. 실패 샤드만 재실행 가능한 구조를 추가한다.
5. 세션 메타데이터에 샤드별 성공/실패 통계를 저장한다.
:::

---

## 권장 우선순위
1. `ping` 분리 (서비스 간 간섭 차단)
2. 푸시 스케줄러 샤딩 (즉시 체감 성능)
3. 백업 증분화 (비용/안정성 개선)
4. 멀티리전 전략 (가용성 강화)
