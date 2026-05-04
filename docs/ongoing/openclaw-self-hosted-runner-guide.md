# OpenClaw를 활용한 Self-Hosted Runner 구축 가이드 (상세 조사)

작성일: 2026-05-04  
대상: GitHub Actions Self-Hosted Runner를 **직접 운영**하면서, OpenClaw를 통해 운영 자동화/원격 제어를 결합하려는 팀

---

## 1) 핵심 요약

- OpenClaw는 "메시징 채널(Discord/Telegram/Slack 등) ↔ 에이전트"를 연결하는 **셀프호스트 게이트웨이**입니다.
- GitHub Self-Hosted Runner는 GitHub Actions 잡을 직접 실행하는 실행 노드입니다.
- 둘을 결합하면:
  - Runner 설치/업데이트/헬스체크/로그수집/재시작 같은 운영 작업을
  - 채팅 기반(예: Telegram)으로 원격 실행·자동화할 수 있습니다.

즉, **CI 실행 주체는 GitHub Runner**, **운영 오케스트레이션/관리는 OpenClaw** 역할로 분리하는 구조가 가장 현실적입니다.

---

## 2) 조사 근거 (공식 문서 중심)

### OpenClaw 관련
- OpenClaw 공식 소개 문서에서 self-hosted gateway, 다중 채널 연동, `openclaw onboard`, `openclaw dashboard` 흐름을 제시함.
- 요구사항으로 Node 24(권장), Node 22 LTS(22.14+) 언급.

### GitHub Actions Self-hosted Runner 관련
- GitHub 공식 문서에서 self-hosted runner 정의, 장단점, 계층(Repo/Org/Enterprise) 사용 방식을 명시.
- self-hosted runner는 인프라 비용/OS 패치/운영 책임이 사용자에게 있음을 명시.

---

## 3) 권장 아키텍처

### A안 (권장): Runner Host + OpenClaw Gateway 동거

```text
[GitHub Actions]
   -> jobs
[Self-hosted Runner VM]
   - actions runner service
   - openclaw gateway service
   - hardening/monitoring agent

[Telegram/Slack/Discord]
   <-> OpenClaw
   -> "runner 상태", "서비스 재시작", "로그 요약" 명령
```

장점:
- 운영 단순화(한 대에 집중)
- 채팅 기반 원격 유지보수 쉬움

주의:
- Runner와 OpenClaw를 동일 호스트에 둘 경우 보안 경계가 약해질 수 있어 최소권한·방화벽 필수

### B안: 분리형 (보안 강화)
- Runner Host와 OpenClaw Host 분리
- OpenClaw는 SSH jump host 또는 내부 API로만 Runner 제어

장점:
- 침해 범위 축소, 운영 감사 용이

---

## 4) 단계별 구축 절차

## 4.1 사전 결정

1. 스코프 선택: Repo-level / Org-level runner
2. OS 선택: Ubuntu 24.04 LTS 권장
3. 실행 정책:
   - 영구 러너(항시 구동)
   - 에페메랄 러너(잡 단위 폐기, 보안 우수)
4. 네트워크:
   - 아웃바운드 GitHub 접근 허용
   - 인바운드 최소화(원격 관리 채널만)

## 4.2 GitHub Self-hosted Runner 설치

1. GitHub에서 러너 등록 토큰 발급 (만료 시간 확인)
2. 러너 바이너리 다운로드 및 구성
3. 서비스 등록(`systemd`) 후 자동시작 설정
4. 라벨 부여 예시:
   - `self-hosted`, `linux`, `x64`, `prod-runner`

워크플로우 예시:

```yaml
jobs:
  build:
    runs-on: [self-hosted, linux, x64, prod-runner]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
```

## 4.3 OpenClaw 설치/초기화

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
openclaw dashboard
```

- 게이트웨이 설정 파일(`~/.openclaw/openclaw.json`)에서 허용 송신자/멘션 규칙을 먼저 잠금
- 최초 운영 채널은 Telegram 또는 Slack처럼 인증·감사가 쉬운 채널 권장

## 4.4 Runner 운영 명령을 OpenClaw에 연결

운영용 스크립트를 `/opt/runner-ops/`에 분리하고 OpenClaw가 해당 스크립트만 실행하도록 제한:

- `runner-status.sh`
- `runner-restart.sh`
- `runner-update.sh`
- `runner-tail-log.sh`

예시(상태 확인):

```bash
#!/usr/bin/env bash
set -euo pipefail
systemctl is-active actions.runner.* || true
systemctl status actions.runner.* --no-pager | head -n 40
```

권장 포인트:
- sudoers에 NOPASSWD 최소 명령만 화이트리스트
- 임의 쉘 명령 실행 금지(고정 스크립트만 허용)

## 4.5 자동 복구/알림

- Health check cron/systemd timer로 runner 온라인 여부 확인
- offline 감지 시:
  1) 서비스 재시작
  2) 실패 시 OpenClaw 채널에 경보 발송
  3) 최종적으로 VM 재부팅 플랜 실행

---

## 5) 보안 체크리스트 (중요)

1. Runner 전용 GitHub 계정/권한 최소화
2. Org runner group으로 repo 접근 제한
3. PR from fork 정책 분리(민감 시크릿 접근 차단)
4. OpenClaw 허용 발신자 allowlist 필수
5. OpenClaw 운영 채널에 2FA 강제
6. Runner host outbound destination 제한
7. 로그에 토큰/시크릿 마스킹
8. 정기 패치(커널, Node, 러너, OpenClaw)
9. 감사 로그(누가 언제 재시작/배포 명령 실행했는지)
10. 프로덕션/스테이징 러너 완전 분리

---

## 6) 운영 모델 추천

### 소규모 팀
- 영구 러너 1~2대 + OpenClaw 1대 동거
- 장애 대응: 채팅 기반 수동 복구

### 중간 규모 팀
- 러너 풀(2~5대) + 라벨 기반 워크로드 분리
- OpenClaw는 운영 전용 채널에서 승인형 명령 플로우

### 대규모/보안 민감
- 에페메랄 러너 + ARC(Kubernetes) 검토
- OpenClaw는 관제/알림/런북 자동화 중심으로 제한

---

## 7) 실무에서 자주 생기는 문제와 해결

1. **Runner가 idle인데 job을 못 받는 문제**
   - 라벨 불일치 확인
   - runner group/repo 접근권 확인

2. **업데이트 후 러너 비정상**
   - 서비스 재등록 및 work 폴더 정리
   - 자동 업데이트 비활성 여부 점검

3. **OpenClaw 명령 오남용 우려**
   - 채널 allowlist + 고정 명령 템플릿 + 승인어(예: `CONFIRM`) 2단계 적용

4. **로그가 너무 길어 채팅에서 가독성 저하**
   - 최근 200줄 요약 + 오류 키워드 하이라이트 후 원본 링크 전달

---

## 8) 구축 순서 (권장 실행 플랜)

1. GitHub self-hosted runner 단독 정상화
2. 러너 보안 하드닝(권한/네트워크/로그)
3. OpenClaw 설치 및 단일 채널 연동
4. 운영 스크립트 4종(status/restart/update/log)
5. 장애 알림/자동복구 연결
6. 월간 점검표 운영

---

## 9) 결론

OpenClaw는 self-hosted runner를 "대체"하기보다, **runner 운영 자동화 인터페이스**로 붙였을 때 가치가 큽니다.  
가장 안전한 패턴은 "GitHub Runner 실행 경로"와 "OpenClaw 운영 제어 경로"를 명확히 분리하고, OpenClaw에는 최소 권한의 고정 명령만 위임하는 구조입니다.

---

## 참고 링크

- OpenClaw docs index (GitHub): https://github.com/openclaw/openclaw/blob/main/docs/index.md
- OpenClaw 공식 사이트: https://openclaw.ai/
- GitHub Docs - Self-hosted runners (concept): https://docs.github.com/en/actions/concepts/runners/self-hosted-runners
- GitHub Docs - Adding self-hosted runners: https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners
