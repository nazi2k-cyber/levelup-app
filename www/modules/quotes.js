// ===== 명언 (Quotes) 모듈 =====
(function() {
    'use strict';

    const AppState = window.AppState;
    const i18n = window.i18n;

    let _lastQuoteLang = null;

    async function renderQuote(forceReload) {
        const quoteEl = document.getElementById('daily-quote');
        const authorEl = document.getElementById('daily-quote-author');
        if(!quoteEl || !authorEl) return;

        const lang = AppState.currentLang;
        const _t = i18n[lang] || {};
        const loadingText = _t.quote_loading || "위성 통신망에서 데이터를 수신 중입니다...";

        // 언어가 바뀌면 강제 리로드
        if (_lastQuoteLang && _lastQuoteLang !== lang) forceReload = true;

        // 이미 명언이 표시되어 있으면 다시 로드하지 않음
        if(!forceReload && quoteEl.innerText && quoteEl.innerText !== loadingText && quoteEl.style.opacity !== '0') return;

        _lastQuoteLang = lang;

        try {
            quoteEl.innerText = loadingText;
            quoteEl.style.opacity = 1;
            authorEl.innerText = "";

            // 일본어: 명언 API (zenquotes 프록시)
            let apiUrl = 'https://korean-advice-open-api.vercel.app/api/advice';
            if (AppState.currentLang === 'en' || AppState.currentLang === 'ja') {
                apiUrl = 'https://dummyjson.com/quotes/random';
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(apiUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error("API 통신 에러");

            const data = await response.json();
            const quoteText = data.message || data.quote;
            const quoteAuthor = data.author || "Unknown";

            quoteEl.style.opacity = 0;
            authorEl.style.opacity = 0;

            setTimeout(() => {
                quoteEl.innerText = `"${quoteText}"`;
                authorEl.innerText = `- ${quoteAuthor} -`;
                quoteEl.style.opacity = 1;
                quoteEl.style.transition = "opacity 0.5s ease-in";
                authorEl.style.opacity = 1;
                authorEl.style.transition = "opacity 0.5s ease-in";
            }, 300);

        } catch (error) {
            console.error("명언 API 호출 실패:", error);
            const fallbackQuote = _t.quote_fallback || "어떠한 시련 속에서도 꾸준함은 시스템을 지탱하는 가장 강력한 무기이다.";
            const fallbackAuthor = _t.quote_fallback_author || "System Offline";
            quoteEl.innerText = `"${fallbackQuote}"`;
            authorEl.innerText = `- ${fallbackAuthor} -`;
            quoteEl.style.opacity = 1;
            authorEl.style.opacity = 1;
        }
    }

    function copyQuoteText() {
        const quoteEl = document.getElementById('daily-quote');
        const authorEl = document.getElementById('daily-quote-author');
        if (!quoteEl || !authorEl) return;

        const quoteText = quoteEl.innerText || '';
        const authorText = authorEl.innerText || '';
        if (!quoteText) return;

        const text = `${quoteText}\n${authorText}`;
        const lang = AppState.currentLang;
        const msgs = { ko: '명언이 클립보드에 복사되었습니다.', en: 'Quote copied to clipboard.', ja: '名言がクリップボードにコピーされました。' };

        navigator.clipboard.writeText(text).then(() => {
            alert(msgs[lang] || msgs.ko);
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            alert(msgs[lang] || msgs.ko);
        });
    }

    // Public API
    window.renderQuote = renderQuote;
    window.copyQuoteText = copyQuoteText;
})();
