# Capacitor iOS 빌드/배포 구체화 가이드 (GitHub 중심)

## 목적
- Windows 중심 개발팀이 **iOS 빌드/서명/배포를 재현 가능**하게 운영할 수 있도록 절차를 표준화한다.
- GitHub Actions(macOS runner) 기반으로 수동 실수(서명/프로비저닝/버전 누락)를 줄인다.

## 범위
- 포함: iOS 앱 빌드, 코드서명, TestFlight 업로드, 운영 체크리스트
- 제외: UI/기능 개발, App Store 심사 대응 문구 작성

---

## 1) 사전 준비 체크리스트

### 1-1. Apple Developer 준비
- Apple Developer Program 팀 등록 완료
- App ID 생성 (Bundle ID 확정)
- App Store Connect 앱 레코드 생성
- 최소 1개 배포 대상(Internal TestFlight 그룹) 생성

### 1-2. 로컬/저장소 준비
- Capacitor 프로젝트에서 iOS 플랫폼 추가
  ```bash
  npm ci
  npm run build
  npx cap add ios   # 최초 1회
  npx cap sync ios
  ```
- `ios/App/App.xcodeproj`가 저장소에 포함되어 있어야 함
- `Podfile.lock` 커밋 유지(재현 가능한 의존성 고정)

### 1-3. 서명 자산 준비
- Distribution Certificate(.p12)
- Provisioning Profile(.mobileprovision)
- App Store Connect API Key (`.p8`, key id, issuer id)

---

## 2) 브랜치/릴리즈 정책

- `main`: App Store 제출 기준 브랜치
- `develop`: 통합 개발 브랜치
- `release/*`: 릴리즈 안정화 브랜치(선택)

### 태그 정책
- 태그 형식: `vMAJOR.MINOR.PATCH` (예: `v1.8.2`)
- iOS 배포 워크플로우 트리거: `workflow_dispatch` + `v*` 태그 푸시

### 버전 정책
- `CFBundleShortVersionString`: 사용자 노출 버전 (`1.8.2`)
- `CFBundleVersion`: 빌드 번호 (정수 증가)
- 권장: GitHub Actions run number 또는 날짜+증분 사용

---

## 3) GitHub Secrets/Variables 설계

### 필수 Secrets
- `IOS_P12_BASE64`: 배포 인증서(.p12) base64
- `IOS_P12_PASSWORD`: .p12 비밀번호
- `IOS_PROFILE_BASE64`: provisioning profile base64
- `KEYCHAIN_PASSWORD`: 임시 keychain 비밀번호
- `ASC_API_KEY_ID`: App Store Connect API key id
- `ASC_API_ISSUER_ID`: issuer id
- `ASC_API_PRIVATE_KEY_BASE64`: `.p8` base64

### 권장 Variables
- `IOS_WORKSPACE`: `ios/App/App.xcworkspace`
- `IOS_SCHEME`: `App`
- `IOS_EXPORT_METHOD`: `app-store`
- `BUNDLE_ID`: 예) `com.company.levelup`

---

## 4) GitHub Actions 표준 플로우

## 4-1. Build-only (PR 검증)
목적: 서명 없이 iOS 컴파일 회귀를 조기 탐지.

주요 단계:
1. `actions/checkout`
2. Node 설치 + `npm ci`
3. `npm run build`
4. `npx cap sync ios`
5. CocoaPods install
6. `xcodebuild` 시뮬레이터 대상 빌드

예시 명령:
```bash
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  build
```

## 4-2. Release (태그/수동 실행)
목적: archive/export 후 TestFlight 업로드 자동화.

주요 단계:
1. macOS runner에서 인증서/프로파일 설치
2. 임시 keychain 생성 및 codesign 설정
3. `xcodebuild archive`
4. `xcodebuild -exportArchive`
5. `xcrun altool` 또는 `iTMSTransporter`로 업로드
6. 결과 아티팩트/로그 보관

---

## 5) 권장 워크플로우 YAML 스켈레톤

```yaml
name: ios-release

on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'

jobs:
  release-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install deps
        run: npm ci

      - name: Build web
        run: npm run build

      - name: Sync iOS
        run: npx cap sync ios

      - name: Install CocoaPods
        run: |
          cd ios/App
          pod install

      - name: Setup signing assets
        run: |
          # 1) base64 decode certificate/profile
          # 2) create temporary keychain
          # 3) import certificate
          # 4) place provisioning profile
          echo "Signing setup"

      - name: Archive
        run: |
          xcodebuild -workspace ios/App/App.xcworkspace \
            -scheme App \
            -configuration Release \
            -archivePath build/App.xcarchive \
            archive

      - name: Export IPA
        run: |
          xcodebuild -exportArchive \
            -archivePath build/App.xcarchive \
            -exportPath build \
            -exportOptionsPlist ios/exportOptions.plist

      - name: Upload to TestFlight
        run: |
          echo "Upload step with App Store Connect API key"
```

> 주의: 실제 운영 시 `Setup signing assets`와 `Upload` 단계는 팀 보안정책에 맞게 구체 스크립트로 분리 권장.

---

## 6) 실패 유형별 트러블슈팅

### 6-1. Signing certificate/profile mismatch
- 증상: `No signing certificate` 또는 `Provisioning profile doesn't match`
- 조치:
  1. Bundle ID 일치 확인
  2. 프로파일 만료일 확인
  3. 인증서 재발급 후 Secrets 재등록

### 6-2. CocoaPods 해상도 실패
- 증상: `pod install` 실패
- 조치:
  1. `Podfile.lock` 변경 이력 확인
  2. Capacitor/iOS deployment target 호환성 점검

### 6-3. Build number 중복
- 증상: TestFlight 업로드 거절
- 조치:
  1. `CFBundleVersion` 자동 증가 로직 반영
  2. 태그 재발행 대신 새 패치버전 발행

---

## 7) 운영 체크리스트 (배포 당일)

1. `main` 기준 태그 생성 전 체크
   - 변경사항 승인 완료
   - CI 녹색(웹/Android/iOS build-only)
2. 릴리즈 태그 발행 (`vX.Y.Z`)
3. iOS release workflow 실행 성공 확인
4. TestFlight 빌드 배포 그룹 할당
5. 스모크 테스트
   - 로그인
   - 결제/핵심 액션
   - 푸시/딥링크(사용 시)
6. 이슈 없으면 App Store 제출

---

## 8) 역할 분담 (RACI 간소화)
- Dev: 기능 병합, 버전 업데이트, 릴리즈 노트 초안
- Release Manager: 태그 발행, 배포 워크플로우 실행/검증
- QA: TestFlight 스모크 테스트
- Owner/PM: 제출 승인

---

## 9) 완료 기준 (Definition of Done)
- 태그 1회로 iOS archive/export/TestFlight 업로드 자동 수행
- 서명 관련 민감정보가 GitHub Secrets 외부에 노출되지 않음
- 신규 담당자도 문서 기준으로 1회 릴리즈를 단독 수행 가능
