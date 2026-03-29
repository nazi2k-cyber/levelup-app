# LEVEL UP: REBOOT 변경 이력

모든 주요 변경사항이 이 파일에 기록됩니다.

형식: [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/)
버전 관리: [Semantic Versioning](https://semver.org/lang/ko/)

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
