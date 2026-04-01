# AppLogger 장애 분석 (2026-04-01 ~ 2026-04-02)

## 요약

로그의 치명도 기준으로 보면, 실제 사용자 영향이 큰 문제는 아래 2가지입니다.

1. `users/{uid}` 문서 저장 시 `permission-denied` 반복
2. AdMob UMP 동의 양식 미설정으로 `Publisher misconfiguration` 발생

나머지 항목(`api.js/gtag.js` 로드 실패, Google 로그인 취소 `12501`, Firestore WebChannel 1회 에러 후 즉시 복구)은 비치명 또는 정상 동작 범주입니다.

---

## 1) Firestore 저장 실패: `Missing or insufficient permissions`

### 관측 로그
- `SaveDiag`에서 변경 키(`affectedKeys`)는 제한된 일부 필드로 확인됨
- 직후 `DB 저장 실패: Missing or insufficient permissions.` 발생
- 동일 증상이 닉네임 변경 후 재저장 시점에도 재발

### 해석
현재 클라이언트 진단 로그상 "페이로드 구조" 자체는 대부분 정상입니다. 따라서 우선순위는 **보안 규칙 배포 버전 불일치** 또는 **프로젝트/앱 환경 불일치(다른 Firebase 프로젝트에 연결)** 입니다.

특히 아래 케이스에서 같은 오류가 자주 발생합니다.

- 로컬 `firestore.rules`에는 허용된 필드가 있으나, 실제 배포된 Rules가 과거 버전인 경우
- 앱이 예상과 다른 Firebase 프로젝트(예: debug/staging)로 연결되어 Rules가 다른 경우
- 기존 문서에 레거시 비정상 타입이 포함되어, 전체 문서 검증에서 차단되는 경우

### 즉시 조치 (우선순위 순)
1. **Firestore Rules 재배포**
   - 명령: `firebase deploy --only firestore:rules --project <실사용-project-id>`
2. **앱이 바라보는 Firebase projectId 확인**
   - Android 네이티브(`google-services.json`)와 웹 SDK 초기화값이 동일한지 확인
3. **문제 사용자 문서 단건 점검** (`users/fMuS1yJb...`)
   - 콘솔에서 `stats/pendingStats/streak/stepData` 타입과 키를 직접 검증
4. **permission-denied 상세 계측 추가**
   - 저장 실패 시 payload 각 필드 타입/길이/키셋을 AppLogger에 별도 출력하도록 강화

### 운영 팁
- 이번 로그처럼 `SaveDiag` 통과인데 Rules에서 차단되면, 대개 "클라이언트 가정"과 "서버 Rules 실제 상태"가 다릅니다.
- QA 체크리스트에 "Rules 배포 시각 + 앱 번들 빌드 시각"을 함께 기록하면 재발 방지에 효과적입니다.

---

## 2) AdMob: `Publisher misconfiguration`

### 관측 로그
- `Publisher misconfiguration: ... no form(s) configured for the input app ID`
- 같은 시점에 앱에서 원인 안내 로그 출력

### 해석
광고 SDK 자체 초기화는 완료되었지만, UMP/GDPR 동의 양식이 해당 App ID에 연결되지 않은 상태입니다.

### 즉시 조치
1. AdMob 콘솔 → **Privacy & messaging**에서 동의 메시지 생성/게시
2. 메시지 대상 앱에 `ca-app-pub-6654057059754695~3529972498` 포함 확인
3. 반영 후 앱 재시작하여 `requestConsentInfo` 재검증

---

## 3) 비치명 로그 (모니터링 대상)

### 외부 스크립트 로드 실패
- `https://apis.google.com/js/api.js`
- `https://www.googletagmanager.com/gtag/js`

Android WebView/네트워크 정책/광고차단 환경에서 간헐적으로 발생 가능. 핵심 기능 장애로 연결되지 않으면 경고 수준 유지 권장.

### Google 로그인 `12501`
- 사용자 취소 코드로 정상 흐름

### Firestore WebChannel transport error 후 복구
- 1회성 네트워크 흔들림으로 판단
- "30초 디바운스 + 복구 완료" 로그가 있어 현재 방어 로직은 동작 중

---

## 권장 후속 액션 체크리스트

- [ ] Firestore Rules를 실서비스 프로젝트에 재배포
- [ ] Android/Web Firebase 설정의 projectId 일치 검증
- [ ] 실패한 uid 문서 타입 점검(특히 map 내부 키/타입)
- [ ] 배포 후 같은 계정으로 저장 재시도(재현 로그 수집)
- [ ] AdMob Privacy & messaging 메시지 게시 상태 확인

