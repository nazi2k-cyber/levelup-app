# 약관/동의/고지 페이지 다국어(i18n) 적용 + 인앱 일원화 구현 계획

> 작성일: 2026-04-09  
> 최종 수정: 2026-04-09  
> 브랜치: `claude/update-oss-i18n-plan-GXgKC` (이전: `update-terms-consent-pages-7u2cI`, `NfmpX`)

---

## 진행 상황

| Phase | 대상 파일 | 상태 | PR |
|-------|-----------|------|-----|
| 1 | terms.html | ✅ 완료 | #717, #719, #721 |
| 2 | usage-policy.html | ✅ 완료 | - |
| 3 | privacy.html | ✅ 완료 | - |
| 4 | oss.html (신규) | ✅ 완료 | - |
| 5 | 인앱 일원화 (모달 → 독립 HTML) | ✅ 완료 | - |
| 6 | 커밋 & 푸시 | ✅ 완료 | - |

---

## 개요

독립 실행 법적 페이지(terms.html, privacy.html, usage-policy.html)에 한/영/일 다국어 지원을 추가한다.  
현재 앱 내 모달(`app.js legalContents`)과 계정 삭제 페이지(`account-deletion.html`)는 이미 3개 언어를 지원하지만, 독립 HTML 페이지는 한국어만 지원하는 상태이다.

다국어 지원 완성 후, 인앱에서는 모달 대신 독립 HTML 페이지를 호출하는 방식으로 일원화하여 콘텐츠 이중 관리를 제거한다.

### 접근법
- **언어별 전체 콘텐츠 블록** 방식 (Approach B)
- 공통 헤더/푸터는 `data-i18n`으로 전환, 본문은 `content-ko/en/ja` 블록을 show/hide
- `account-deletion.html`의 언어 전환 패턴을 재사용

---

## Phase 1: terms.html 다국어 지원 ✅ 완료

> 완료일: 2026-04-09 | 커밋: `7f01e26` (Step 1-1~1-3), `1fd0922` (Step 1-4~1-6) | PR: #717, #719, #721

### Step 1-1: CSS 추가 ✅
`<style>` 블록에 언어 전환 및 콘텐츠 블록 스타일 추가:
```css
.lang-switch { text-align: center; margin-bottom: 20px; }
.lang-switch button { background: none; border: 1px solid rgba(255,255,255,0.15); color: #888; border-radius: 6px; padding: 4px 10px; font-size: 0.75rem; cursor: pointer; margin: 0 2px; }
.lang-switch button.active { border-color: #00d9ff; color: #00d9ff; }
.content-block { display: none; }
.content-block.active { display: block; }
```

### Step 1-2: 언어 전환 버튼 삽입 ✅
`<body>` 최상단에 삽입:
```html
<div class="lang-switch">
    <button onclick="setLang('ko')" id="lang-ko" class="active">한국어</button>
    <button onclick="setLang('en')" id="lang-en">English</button>
    <button onclick="setLang('ja')" id="lang-ja">日本語</button>
</div>
```

### Step 1-3: 공통 헤더에 data-i18n 속성 추가 ✅
```html
<span class="legal-title" id="page-title">소비자 약관</span>
<div class="legal-date" id="page-date">시행일: 2025년 3월 1일 | 최종 수정: 2026년 4월 9일</div>
```

### Step 1-4: 기존 한국어 본문을 content-ko 블록으로 래핑 ✅
- 기존 `<div class="section">` 들을 `<div class="content-block active" id="content-ko">` 안에 넣기
- 푸터 면책 고지는 블록 바깥에 유지 (항상 표시)

### Step 1-5: 영어 콘텐츠 블록 추가 ✅
- `<div class="content-block" id="content-en">` 생성
- 번역 면책 배너 삽입 (참고용 번역임을 고지하는 주황색 박스)
- app.js `legalContents.terms.html.en` 내용을 기반으로 독립 페이지 수준으로 상세화
- 14개 섹션 모두 번역 (서비스 개요, 계정, 서비스 이용, 건강 면책, 위치, 광고, 푸시, 저작권, 금지행위, 정지, 책임제한, 약관변경, 준거법, 문의)

### Step 1-6: 일본어 콘텐츠 블록 추가 ✅
- `<div class="content-block" id="content-ja">` 생성
- 번역 면책 배너 삽입 (일본어)
- app.js `legalContents.terms.html.ja` 내용을 기반으로 독립 페이지 수준으로 상세화

### Step 1-7: JavaScript 삽입 ✅
```html
<script>
const TITLES = {
    ko: { title: '소비자 약관', date: '시행일: 2025년 3월 1일 | 최종 수정: 2026년 4월 9일' },
    en: { title: 'Terms of Service', date: 'Effective: March 1, 2025 | Last updated: April 9, 2026' },
    ja: { title: '利用規約', date: '施行日: 2025年3月1日 | 最終更新: 2026年4月9日' }
};
function setLang(lang) {
    const t = TITLES[lang] || TITLES.ko;
    document.getElementById('page-title').textContent = t.title;
    document.getElementById('page-date').textContent = t.date;
    document.querySelectorAll('.content-block').forEach(el => el.classList.remove('active'));
    document.getElementById('content-' + lang)?.classList.add('active');
    document.querySelectorAll('.lang-switch button').forEach(b => b.classList.remove('active'));
    document.getElementById('lang-' + lang)?.classList.add('active');
    document.documentElement.lang = lang;
    document.title = t.title + ' - BRAVECAT';
}
const browserLang = (navigator.language || 'ko').substring(0, 2);
if (['ko', 'en', 'ja'].includes(browserLang)) setLang(browserLang);
</script>
```

### Step 1-8: 날짜 업데이트 ✅
- 한국어: `최종 수정: 2026년 4월 5일` → `2026년 4월 9일`

---

## Phase 2: usage-policy.html 다국어 지원 ✅ 완료

> 완료일: 2026-04-09

### Step 2-1: CSS 추가 ✅
- Phase 1과 동일한 `.lang-switch`, `.content-block` 스타일 추가

### Step 2-2: 언어 전환 버튼 삽입 ✅
- Phase 1과 동일 구조

### Step 2-3: 공통 헤더 data-i18n 적용 ✅
- 제목: 이용 정책 / Usage Policy / 利用ポリシー
- 날짜: 3개 언어

### Step 2-4: 한국어 본문 content-ko 블록 래핑 ✅

### Step 2-5: 영어 콘텐츠 블록 추가 ✅
- app.js `legalContents['usage-policy'].html.en` 기반
- 9개 섹션 번역 (기본 원칙, 금지행위[3개 하위], 소셜, 플래너/도구, 던전/레이드, 저작권, 위반조치, 신고, 정책변경)
- `.warning` 박스 스타일 영어 번역 포함

### Step 2-6: 일본어 콘텐츠 블록 추가 ✅
- app.js `legalContents['usage-policy'].html.ja` 기반

### Step 2-7: JavaScript 삽입 ✅
- TITLES 객체에 이용 정책 제목/날짜 3개 언어

### Step 2-8: 날짜 업데이트 ✅

---

## Phase 3: privacy.html 다국어 지원

> 가장 복잡: 3개 테이블, 14개 섹션, 총 333줄
> 현재 상태: 한국어만 지원, 최종 수정일 `2026년 4월 5일`

### Step 3-1: CSS 추가
- `.lang-switch`, `.content-block` 스타일 추가 (Phase 1과 동일)
- 기존 `.data-table` 스타일 유지 (테이블 레이아웃에 필수)

### Step 3-2: 언어 전환 버튼 삽입
- `<body>` 최상단에 ko/en/ja 전환 버튼 삽입
- Phase 1과 동일 구조

### Step 3-3: 공통 헤더 data-i18n 적용
- 제목: `개인정보 처리방침` / `Privacy Policy` / `プライバシーポリシー`
- 날짜: `시행일: 2025년 3월 1일 | 최종 수정: 2026년 4월 9일` (3개 언어)
- `id="page-title"`, `id="page-date"` 속성 부여

### Step 3-4: 한국어 본문 content-ko 블록 래핑
- 기존 14개 섹션 전체를 `<div class="content-block active" id="content-ko">` 으로 래핑
- 푸터 면책 고지는 블록 바깥 유지

#### 현재 한국어 섹션 구조 (래핑 대상):
| # | 섹션명 | 줄 범위 | 특이사항 |
|---|--------|---------|----------|
| - | 서문 (회사 소개) | L34-36 | 일반 텍스트 |
| 1 | 수집하는 개인정보 항목 | L39-122 | **테이블 1**: 13행 (구분/수집항목/수집방법) |
| 2 | 개인정보의 수집 및 이용 목적 | L125-142 | 불릿 리스트 13항목 |
| 3 | 개인정보의 보유 및 이용 기간 | L145-214 | **테이블 2**: 14행 (정보유형/보유기간/비고) |
| 4 | 개인정보의 제3자 제공 | L217-224 | 불릿 리스트 3항목 |
| 5 | 개인정보 처리 위탁 | L227-250 | **테이블 3**: 3행 (수탁업체/위탁업무/보유기간) |
| 6 | 사용자의 권리와 행사 방법 | L253-263 | 불릿 리스트 5항목 |
| 7 | 개인정보의 안전성 확보 조치 | L266-273 | 불릿 리스트 3카테고리 |
| 8 | 쿠키 및 자동 수집 장치 | L276-284 | 불릿 리스트 4항목 |
| 9 | 아동의 개인정보 보호 | L287-289 | 단일 문장 |
| 10 | 국외 이전 | L292-294 | 단일 문장 |
| 11 | 개인정보 보호책임자 | L297-304 | 연락처 정보 |
| 12 | 저작권 보호 | L307-310 | 저작권 정책 |
| 13 | 개인정보 처리방침의 변경 | L313-315 | 변경 고지 정책 |
| 14 | 권익 침해 구제 방법 | L318-326 | 구제 기관 연락처 |

### Step 3-5: 영어 콘텐츠 블록 추가
- `<div class="content-block" id="content-en">` 생성
- 번역 면책 배너 삽입 (참고용 번역임을 고지하는 주황색 박스)
- app.js `legalContents.privacy.html.en` 내용 기반 + 독립 페이지 수준으로 상세화

#### 3-5a: 테이블 HTML 신규 작성 (앱 내 모달은 리스트 형식 → 독립 페이지는 테이블 형식)
- **테이블 1 — 수집 항목** (13행): Category / Collected Items / Collection Method
  - 필수정보 (이메일, 비밀번호, 닉네임 등)
  - 자동수집 (기기정보, IP, 앱 사용기록 등)
  - 선택항목 (프로필사진, 생년월일 등)
- **테이블 2 — 보유 기간** (14행): Information Type / Retention Period / Notes
  - 계정정보, 활동기록, 결제기록 등 항목별 보유기간
- **테이블 3 — 처리 위탁** (3행): Processor / Delegated Tasks / Retention Period
  - Firebase (인증/DB), Google Cloud Platform (호스팅), AdMob (광고)

#### 3-5b: 나머지 11개 섹션 영어 번역
- 섹션 2 (이용 목적): 13개 항목 번역
- 섹션 4 (제3자 제공): 3개 항목 번역
- 섹션 6 (사용자 권리): 5개 항목 번역
- 섹션 7 (안전성 조치): 3개 카테고리 번역
- 섹션 8 (쿠키): 4개 항목 번역
- 섹션 9-14: 단문 번역 + 연락처/기관명 표기

### Step 3-6: 일본어 콘텐츠 블록 추가
- `<div class="content-block" id="content-ja">` 생성
- 번역 면책 배너 삽입 (일본어)
- app.js `legalContents.privacy.html.ja` 내용 기반 + 독립 페이지 수준으로 상세화

#### 3-6a: 테이블 HTML 신규 작성 (일본어)
- **テーブル1 — 収集項目** (13行): 区分 / 収集項目 / 収集方法
- **テーブル2 — 保有期間** (14行): 情報種類 / 保有期間 / 備考
- **テーブル3 — 処理委託** (3行): 受託業者 / 委託業務 / 保有期間

#### 3-6b: 나머지 11개 섹션 일본어 번역
- Step 3-5b와 동일 구조

### Step 3-7: JavaScript 삽입
```javascript
const TITLES = {
    ko: { title: '개인정보 처리방침', date: '시행일: 2025년 3월 1일 | 최종 수정: 2026년 4월 9일' },
    en: { title: 'Privacy Policy', date: 'Effective: March 1, 2025 | Last updated: April 9, 2026' },
    ja: { title: 'プライバシーポリシー', date: '施行日: 2025年3月1日 | 最終更新: 2026年4月9日' }
};
// setLang() 함수 — Phase 1과 동일 패턴
```

### Step 3-8: 날짜 업데이트
- 한국어: `최종 수정: 2026년 4월 5일` → `2026년 4월 9일`

---

## Phase 4: oss.html 독립 HTML 생성 + 다국어 지원

> OSS(오픈소스 라이선스) 콘텐츠를 독립 HTML 페이지로 분리하여 다른 법적 페이지와 동일한 구조로 통일
> 현재 상태: `www/app.js` legalContents.oss에 한국어 HTML만 인라인 존재 (L6017-6046), 영어/일본어 미지원

### 현재 OSS 콘텐츠 구조 (app.js 내)
```javascript
oss: {
    title: { ko: '오픈소스 라이선스', en: 'Open Source Licenses', ja: 'オープンソースライセンス' },
    html: `...한국어 HTML만 존재 (string, not object)...`
}
```

#### OSS 섹션 구성 (한국어 원본):
| # | 섹션명 | 내용 |
|---|--------|------|
| 1 | 폰트 (Fonts) | Pretendard, Inter |
| 2 | Capacitor | @capacitor-community/admob, @codetrix-studio/capacitor-google-auth |
| 3 | Firebase SDK | firebase-admin (Node.js), firebase-functions (Node.js) |
| 4 | MIT License | 라이선스 전문 |
| 5 | Apache License 2.0 | 라이선스 전문 |
| 6 | SIL Open Font License 1.1 | 라이선스 전문 |

### Step 4-1: oss.html 파일 생성
- 프로젝트 루트에 `oss.html` 신규 생성
- 기존 `terms.html`, `usage-policy.html`과 동일한 HTML 골격 사용
- `<head>`: charset, viewport, title, favicon 등
- `<style>`: 기존 법적 페이지 공통 스타일 + `.lang-switch`, `.content-block`

### Step 4-2: 언어 전환 버튼 삽입
- Phase 1과 동일한 ko/en/ja 전환 UI

### Step 4-3: 공통 헤더 작성
- 제목: `오픈소스 라이선스` / `Open Source Licenses` / `オープンソースライセンス`
- 날짜: `최종 수정: 2026년 4월 9일` (3개 언어)

### Step 4-4: 한국어 콘텐츠 블록 (content-ko)
- `www/app.js` legalContents.oss.html의 기존 한국어 콘텐츠를 독립 HTML 형식으로 이전
- `<div class="content-block active" id="content-ko">` 래핑
- 6개 섹션 (폰트 2개 + Capacitor 2개 + Firebase 2개 + 라이선스 전문 3개)

### Step 4-5: 영어 콘텐츠 블록 (content-en)
- `<div class="content-block" id="content-en">` 생성
- 번역 면책 배너 삽입
- **라이선스 전문 (MIT, Apache 2.0, SIL OFL 1.1)은 원문 영어 그대로 사용** (번역 불필요)
- 섹션 헤더, 라이브러리 설명만 영어로 작성:
  - Fonts: Pretendard (SIL OFL 1.1), Inter (SIL OFL 1.1)
  - Capacitor: @capacitor-community/admob (MIT), @codetrix-studio/capacitor-google-auth (MIT)
  - Firebase SDK: firebase-admin (Apache 2.0), firebase-functions (MIT)

### Step 4-6: 일본어 콘텐츠 블록 (content-ja)
- `<div class="content-block" id="content-ja">` 생성
- 번역 면책 배너 삽입 (일본어)
- **라이선스 전문은 원문 영어 그대로 유지**
- 섹션 헤더, 라이브러리 설명만 일본어로 작성

### Step 4-7: JavaScript 삽입
```javascript
const TITLES = {
    ko: { title: '오픈소스 라이선스', date: '최종 수정: 2026년 4월 9일' },
    en: { title: 'Open Source Licenses', date: 'Last updated: April 9, 2026' },
    ja: { title: 'オープンソースライセンス', date: '最終更新: 2026年4月9日' }
};
// setLang() 함수 — Phase 1과 동일 패턴
```

### Step 4-8: www/ 디렉토리에 복사
- `oss.html` → `www/oss.html` 복사 (Capacitor 앱 내에서 접근 가능하도록)

---

## Phase 5: 인앱 법적 페이지 일원화 (모달 → 독립 HTML 호출)

> OSS 포함 4개 법적 페이지 모두 독립 HTML로 전환, 모달 제거

### Step 5-1: www/app.js `legalContents` 수정
- `legalContents` 객체에서 terms, usage-policy, privacy, **oss** 항목 모두 삭제
- `openLegalModal()` 함수를 `openLegalPage()` 로 변경:
  ```javascript
  window.openLegalPage = function(type) {
      const pages = {
          'terms': 'terms.html',
          'usage-policy': 'usage-policy.html',
          'privacy': 'privacy.html',
          'oss': 'oss.html'
      };
      const url = pages[type];
      if (url) window.open(url, '_blank');
  };
  ```

### Step 5-2: www/data.js `login_terms_html` 수정
- `login_terms_html` (ko/en/ja): `openLegalModal()` 호출 → 직접 링크(`href="terms.html"`)로 변경

### Step 5-3: www/app.html 설정 버튼 수정
- 설정 > 법적 고지 버튼 (L1002-1005): `openLegalModal('terms')` 등 → `openLegalPage('terms')` 로 변경
- **`#legalModal` 모달 HTML (L1920~) 제거** (더 이상 사용하지 않음)

### Step 5-4: 루트 파일 동기화
- `app.js`, `data.js` 루트 복사본도 동일하게 변경

### 고려사항
- 모든 법적 페이지(terms, usage-policy, privacy, oss)가 독립 HTML로 전환되므로 모달 코드 완전 제거 가능
- Capacitor 앱 내 HTML 파일 경로 확인 필요 (www/ 기준 상대 경로)
- `window.open` 동작이 Capacitor WebView에서 정상 작동하는지 테스트 필요 (대안: `Capacitor.Browser.open()` 또는 인앱 네비게이션)

---

## Phase 6: 커밋 & 푸시

### Step 6-1: 변경 파일
```
terms.html                              (Phase 1 ✅)
usage-policy.html                       (Phase 2 ✅)
privacy.html                            (Phase 3)
oss.html (신규)                          (Phase 4)
www/oss.html (신규)                      (Phase 4)
www/app.js + app.js                     (Phase 5)
www/data.js + data.js                   (Phase 5)
www/app.html                            (Phase 5)
docs/terms-consent-pages-i18n-plan.md   (문서)
```

### Step 6-2: 커밋 & 푸시
```bash
git add <files>
git commit -m "feat: 약관/동의/고지 페이지 다국어 지원 + OSS 독립 HTML + 인앱 일원화"
git push -u origin claude/update-oss-i18n-plan-GXgKC
```

---

## 참조 파일

| 파일 | 용도 |
|------|------|
| `account-deletion.html` | 언어 전환 패턴 참조 (L48-51 CSS, L55-58 버튼, L315-334 스크립트) |
| `www/app.js` L6016-6188 | `legalContents` 번역 원본 (ko/en/ja HTML) |
| `www/app.js` L6017-6046 | `legalContents.oss` — 한국어 HTML만 존재 (title은 3개 언어) |
| `www/app.js` L6190-6201 | `openLegalModal()` 함수 |
| `www/app.html` L1002-1005 | 설정 > 법적 고지 버튼 |
| `www/app.html` L1920-1928 | `#legalModal` 모달 HTML |
| `www/data.js` L225/828/1431 | `login_terms_html` i18n 키 |
| `privacy.html` L39-326 | 한국어 원본 14개 섹션 + 3개 테이블 |

## 검증 방법

1. 각 HTML 파일(terms, usage-policy, privacy, **oss**)을 브라우저에서 열어 ko/en/ja 전환 확인
2. 브라우저 언어 자동 감지 동작 확인
3. 인앱에서 약관/정책/개인정보/**OSS** 버튼 클릭 시 독립 HTML 페이지로 이동 확인
4. `#legalModal` 모달이 완전 제거되었는지 확인
5. 모든 날짜가 `2026년 4월 9일`로 통일 확인
6. `<title>` 태그가 언어에 따라 변경되는지 확인
7. OSS 라이선스 전문(MIT, Apache 2.0, SIL OFL 1.1)이 영어/일본어에서도 원문 유지되는지 확인
8. Capacitor 앱 내에서 `window.open` / 페이지 네비게이션 정상 동작 확인
