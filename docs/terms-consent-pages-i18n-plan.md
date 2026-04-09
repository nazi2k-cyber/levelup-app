# 약관/동의/고지 페이지 다국어(i18n) 적용 구현 계획

> 작성일: 2026-04-09  
> 최종 수정: 2026-04-09  
> 브랜치: `claude/update-terms-consent-pages-7u2cI` (이전: `NfmpX`)

---

## 진행 상황

| Phase | 대상 파일 | 상태 | PR |
|-------|-----------|------|-----|
| 1 | terms.html | ✅ 완료 | #717, #719, #721 |
| 2 | usage-policy.html | ✅ 완료 | - |
| 3 | privacy.html | ⬜ 미착수 | - |
| 4 | app.js 날짜 업데이트 | ⬜ 미착수 | - |
| 5 | 커밋 & 푸시 | ⬜ 미착수 | - |

---

## 개요

독립 실행 법적 페이지(terms.html, privacy.html, usage-policy.html)에 한/영/일 다국어 지원을 추가한다.  
현재 앱 내 모달(`app.js legalContents`)과 계정 삭제 페이지(`account-deletion.html`)는 이미 3개 언어를 지원하지만, 독립 HTML 페이지는 한국어만 지원하는 상태이다.

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

> 가장 복잡: 3개 테이블(수집 항목 15행, 보유 기간 12행, 위탁 3행), 14개 섹션

### Step 3-1: CSS 추가
- `.lang-switch`, `.content-block` + 기존 `.data-table` 스타일 유지

### Step 3-2: 언어 전환 버튼 삽입

### Step 3-3: 공통 헤더 data-i18n 적용
- 제목: 개인정보 처리방침 / Privacy Policy / プライバシーポリシー

### Step 3-4: 한국어 본문 content-ko 블록 래핑

### Step 3-5: 영어 콘텐츠 블록 추가
- app.js `legalContents.privacy.html.en` 기반
- **테이블 HTML 신규 작성** (앱 내 모달은 리스트 형식 → 독립 페이지는 테이블 형식)
- 테이블 1: 수집 항목 (15행) - Category / Collected Items / Collection Method
- 테이블 2: 보유 기간 (12행) - Information Type / Retention Period / Notes
- 테이블 3: 처리 위탁 (3행) - Processor / Delegated Tasks / Retention Period
- 나머지 11개 섹션 번역

### Step 3-6: 일본어 콘텐츠 블록 추가
- 동일하게 테이블 HTML 신규 작성 (일본어)
- app.js `legalContents.privacy.html.ja` 기반

### Step 3-7: JavaScript 삽입

### Step 3-8: 날짜 업데이트

---

## Phase 4: app.js 날짜 업데이트

### Step 4-1: www/app.js `legalContents` 날짜 변경
대상 라인 (모두 `4월 5일` → `4월 9일`):
- L6050: terms.ko 날짜
- L6066: terms.en 날짜  
- L6083: terms.ja 날짜
- L6105: usage-policy.ko 날짜
- L6116: usage-policy.en 날짜
- L6128: usage-policy.ja 날짜
- L6145: privacy.ko 날짜
- L6158: privacy.en 날짜
- L6172: privacy.ja 날짜

### Step 4-2: 루트 app.js 동일 변경
- `/home/user/levelup-app/app.js` (www/app.js와 동일 복사본)

---

## Phase 5: 커밋 & 푸시

### Step 5-1: 변경 파일 확인
```
terms.html
usage-policy.html
privacy.html
www/app.js
app.js
docs/terms-consent-pages-i18n-plan.md
```

### Step 5-2: 커밋
```bash
git add terms.html usage-policy.html privacy.html www/app.js app.js docs/terms-consent-pages-i18n-plan.md
git commit -m "feat: 약관/동의/고지 페이지 다국어(ko/en/ja) 지원 추가"
```

### Step 5-3: 푸시
```bash
git push -u origin claude/update-terms-consent-pages-7u2cI
```

---

## 참조 파일

| 파일 | 용도 |
|------|------|
| `account-deletion.html` | 언어 전환 패턴 참조 (L48-51 CSS, L55-58 버튼, L315-334 스크립트) |
| `www/app.js` L6016-6188 | `legalContents` 번역 원본 (ko/en/ja HTML) |
| `www/data.js` | i18n 키 참조 (legal_title, legal_terms 등) |

## 검증 방법

1. 각 HTML 파일을 브라우저에서 열어 ko/en/ja 전환 확인
2. 브라우저 언어 자동 감지 동작 확인
3. 앱 내 모달과 독립 페이지 간 법적 내용 일관성 확인
4. 모든 날짜가 `2026년 4월 9일`로 통일 확인
5. `<title>` 태그가 언어에 따라 변경되는지 확인
