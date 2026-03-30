# LEVEL UP: REBOOT 변경 이력

모든 주요 변경사항이 이 파일에 기록됩니다.

형식: [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/)
버전 관리: [Semantic Versioning](https://semver.org/lang/ko/)

## [1.0.37] - 2026-03-30

### 변경
- Add date filtering with year/month picker to library

## [1.0.36] - 2026-03-30

### 변경
- feat: ISBN 정밀 트래킹 기능 추가 (회전 바코드/파편 누적/영역 고정)

## [1.0.35] - 2026-03-30

### 변경
- fix: 바코드 스캐너 인식률 개선 (수평 스캔 실패 대응)

## [1.0.34] - 2026-03-30

### 변경
- Improve ISBN OCR fallback robustness for low-confidence scans

## [1.0.33] - 2026-03-30

### 변경
- fix: OCR 회전 처리 추가 — 세로 텍스트(spine/edge) 인식 지원

## [1.0.32] - 2026-03-30

### 변경
- fix: ISBN OCR 인식률 개선 — 문자 화이트리스트 + 신뢰도 필터 + ISBN 위치 특화 크롭

## [1.0.31] - 2026-03-30

### 변경
- fix: remove OCR char whitelist, use max(R,G,B) grayscale, improve crops

## [1.0.30] - 2026-03-30

### 변경
- fix: improve OCR preprocessing for colored backgrounds and ISBN extraction

## [1.0.29] - 2026-03-30

### 변경
- fix: improve ISBN barcode scanner and OCR recognition accuracy

## [1.0.28] - 2026-03-30

### 변경
- fix: 안드로이드 뒤로가기 버튼으로 모달 닫기 수정

## [1.0.27] - 2026-03-30

### 변경
- fix: 책 삭제 후 재추가 시 중복보상 방지 및 renderLibrary 미정의 오류 수정

## [1.0.26] - 2026-03-30

### 변경
- fix: 내서재 모달 z-index, 카메라 버튼 위치, INT 보상 로그 추가

## [1.0.25] - 2026-03-29

### 변경
- feat: 내 서재 독서기록 INT 보상 및 가이드 버튼 추가

## [1.0.24] - 2026-03-29

### 변경
- feat: 내 서재 검색 기능 강화 및 타워 명칭 변경

## [1.0.23] - 2026-03-29

### 변경
- feat: 서재 출처(알라딘/카카오/구글) 표기 및 쌓아보기 탑 리디자인

## [1.0.22] - 2026-03-29

### 변경
- feat: 안드로이드 하드웨어 뒤로가기 버튼 핸들러 추가

## [1.0.21] - 2026-03-29

### 변경
- fix: 알라딘 API에서 페이지 수(itemPage) 가져오도록 수정

## [1.0.20] - 2026-03-29

### 변경
- fix: use uncompressed traineddata and make OCR a delayed fallback
- fix: add missing LSTM WASM core variants for tesseract OCR
- fix: bundle tesseract.js worker, WASM core, and language data locally
- fix: bundle tesseract.js locally to fix CDN loading failure in Android WebView

## [1.0.19] - 2026-03-29

### 변경
- fix: ISBN 수동입력 키보드 가림 문제 해결 + 바코드 스캐너 AppLogger 로깅 추가

## [1.0.18] - 2026-03-29

### 변경
- fix: ISBN OCR 우선 인식 + 바코드 체크디짓 검증 추가

## [1.0.17] - 2026-03-29

### 변경
- fix: ISBN API 폴백 순서를 알라딘>카카오>구글로 변경 + 카메라 인식 개선

## [1.0.17] - 2026-03-29

### 변경
- fix: ISBN API 폴백 순서를 알라딘>카카오>구글북스로 변경
- fix: ISBN OCR 우선 인식으로 전환 — 바코드 잘못된 인식(가짜 숫자) 문제 해결
- fix: ISBN 체크디짓 검증 추가 (바코드/OCR 모두 적용)
- fix: 바코드 FPS 감소(15→5) + OCR 즉시 시작 + 인터벌 단축(2s→1.5s)

## [1.0.16] - 2026-03-29

### 변경
- fix: Android 바코드 인식 안되는 문제 수정

## [1.0.15] - 2026-03-29

### 변경
- feat: 탑 두께 페이지 반영 + OCR ISBN 자동인식 추가
- feat: 내 서재 무한의 탑 디자인 + 책 상세 정보 뷰 개선

## [1.0.14] - 2026-03-29

### 변경
- fix: ISBN 스캔 결과를 스캔화면 내부에 표시 + 카메라 인식률 개선

## [1.0.13] - 2026-03-29

### 변경
- fix: ISBN API 폴백 순서를 카카오>알라딘>구글북스로 변경

## [1.0.12] - 2026-03-29

### 변경
- fix: add libraryStr to Firestore allowed fields to fix permission-denied errors

## [1.0.11] - 2026-03-29

### 변경
- feat: 한국 도서 ISBN 검색을 위한 알라딘/카카오 API 서버 프록시 추가
- fix: 한국 도서 ISBN 검색 실패 시 Open Library 폴백 및 직접 입력 기능 추가
- fix: ISBN 바코드 인식률 개선 - HD 카메라, 반응형 스캔 영역, 네이티브 BarcodeDetector 활용

## [1.0.10] - 2026-03-29

### 변경
- fix: 카메라 권한 문제 해결 및 설정화면 카메라 토글 추가

## [1.0.9] - 2026-03-29

### 변경
- fix: auto-version 원격 태그 충돌 감지 및 커밋/태그 push 분리
- fix: auto-version 태그 충돌 시 기존 태그 삭제 후 재생성
- refactor: 내 서재 진입경로를 상태창 카드로 변경 및 카메라 권한 추가
- feat: ISBN 바코드 스캔 및 내 서재(My Library) 기능 추가
- Revert "Merge pull request #355 from nazi2k-cyber/claude/add-running-mileage-chart-K8LUv"

## [1.0.8] - 2026-03-28

### 변경
- fix: stat-radar/bonus-exp 삭제 불가 처리 및 걸음수 복원 시 표시 문제 수정
- feat: 프로필카드 햄버거 메뉴 및 상태창 편집 기능 추가

## [1.0.7] - 2026-03-28

### 변경
- fix: 플래너 복사 후 데이터 미반영 오류 수정

## [1.0.6] - 2026-03-28

### 변경
- fix: 플래너 복사 버튼 작동 오류 수정 및 UX 통일
- feat: Day1 피드에서 다른 유저의 플래너를 내 플래너로 복사하는 기능 추가

## [1.0.5] - 2026-03-28

### 변경
- fix: 플래너 탭에서 빈 planner-banner div로 인한 빨간 테두리 프레임 오류 제거

## [1.0.4] - 2026-03-28

### 변경
- fix: APK 빌드 버전을 자동 버전 관리와 일치시키도록 workflow_run 트리거 적용

## [1.0.3] - 2026-03-28

### 변경
- fix: replace sed with temp-file approach for CHANGELOG.md updates
- feat: 플래너 탭에 배너 광고 추가
- fix: Debug APK 빌드 시 versionName을 VERSION 파일과 일치시키도록 수정
- docs: 아티팩트 빌드 파라미터 버전도 1.0.1로 일치
- docs: MD 파일 버전을 1.0.1로 업데이트

## [1.0.1] - 2026-03-28

### 변경
- feat: DIY 퀘스트 가이드 모달 추가

## [1.0.0] - 2026-03-22

### 추가
- 초기 릴리즈
- RPG 게이미피케이션 기반 자기계발 앱
- Firebase 인증 (Google 로그인)
- Firestore 실시간 데이터 동기화
- 오프라인 모드 (Service Worker PWA)
- Google Fit / Health Connect 걸음 수 연동
- Firebase Cloud Messaging 푸시 알림
- 다국어 지원 (한국어/영어)
