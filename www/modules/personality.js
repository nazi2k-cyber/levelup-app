(function () {
    'use strict';

    // ── 전역 참조 ──────────────────────────────────────────────────
    const AppState = window.AppState;
    const i18n = window.i18n;

    // ── 상수 ───────────────────────────────────────────────────────
    const CONSENT_KEY = 'big5_consent';   // localStorage: ISO 타임스탬프
    const PAGES = 6;
    const PER_PAGE = 5;
    const BIG5_CHA_REWARD = 3;
    const BIG5_CHA_KEY = 'big5_cha_claimed';

    // ── 모듈 상태 ──────────────────────────────────────────────────
    let _currentPage = 0;   // 0=동의, 1..6=문항, 7=결과
    let _answers = {};      // { [questionId]: 1..5 }
    let _big5IsPublic = true; // 소셜 프로필 공개 여부

    // ── 특성별 색상 / 아이콘 ───────────────────────────────────────
    const TRAIT_COLORS = {
        O: '#b08aff',
        C: '#00d9ff',
        E: '#ffcc00',
        A: '#00ff88',
        N: '#ff6b6b'
    };

    // ── 30문항 IPIP-BFI (공개 도메인) ─────────────────────────────
    const BIG5_QUESTIONS = [
        // OPENNESS (O)
        { id:  1, trait: 'O', reverse: false, ko: '나는 새로운 아이디어에 매력을 느낀다.',           en: 'I find new ideas fascinating.',                        ja: '新しいアイデアに魅力を感じる。' },
        { id:  2, trait: 'O', reverse: false, ko: '나는 풍부한 상상력을 가지고 있다.',               en: 'I have a vivid imagination.',                          ja: '豊かな想像力を持っている。' },
        { id:  3, trait: 'O', reverse: true,  ko: '나는 추상적인 개념에 흥미가 없다.',               en: 'I am not interested in abstract ideas.',               ja: '抽象的な概念に興味がない。' },
        { id:  4, trait: 'O', reverse: false, ko: '나는 예술, 음악, 문학 작품에 깊이 감동받는다.',   en: 'I am moved by art, music, or literature.',             ja: '芸術・音楽・文学に深く感動する。' },
        { id:  5, trait: 'O', reverse: false, ko: '나는 다양한 아이디어를 즐겁게 탐색한다.',         en: 'I enjoy exploring diverse ideas.',                     ja: '様々なアイデアを楽しく探索する。' },
        { id:  6, trait: 'O', reverse: true,  ko: '나는 상상력이 필요한 일을 별로 좋아하지 않는다.', en: 'I do not enjoy tasks that require imagination.',       ja: '想像力が必要な作業はあまり好きではない。' },
        // CONSCIENTIOUSNESS (C)
        { id:  7, trait: 'C', reverse: false, ko: '나는 항상 해야 할 일을 미리 준비한다.',           en: 'I always prepare for things ahead of time.',           ja: 'いつもやるべきことを事前に準備する。' },
        { id:  8, trait: 'C', reverse: false, ko: '나는 세부 사항에 주의를 기울인다.',               en: 'I pay attention to details.',                          ja: '細部に注意を払う。' },
        { id:  9, trait: 'C', reverse: true,  ko: '나는 물건을 어지럽게 놔두는 편이다.',             en: 'I tend to leave things in a mess.',                    ja: '物をごちゃごちゃに置いておく方だ。' },
        { id: 10, trait: 'C', reverse: false, ko: '나는 계획대로 일을 처리하는 것을 좋아한다.',      en: 'I like to follow a schedule.',                         ja: '予定通りに物事を進めることが好きだ。' },
        { id: 11, trait: 'C', reverse: true,  ko: '나는 의무를 쉽게 잊어버리는 편이다.',             en: 'I tend to forget my obligations.',                     ja: '義務を忘れがちだ。' },
        { id: 12, trait: 'C', reverse: false, ko: '나는 부지런하고 성실하다.',                       en: 'I am diligent and hardworking.',                       ja: '勤勉で真面目だ。' },
        // EXTRAVERSION (E)
        { id: 13, trait: 'E', reverse: false, ko: '나는 사람들과 함께 있을 때 편안함을 느낀다.',     en: 'I feel comfortable around people.',                    ja: '人と一緒にいると安心する。' },
        { id: 14, trait: 'E', reverse: false, ko: '나는 다른 사람들을 쉽게 대화에 참여시킨다.',      en: 'I draw people into conversations easily.',             ja: '他の人たちを気軽に会話に引き込める。' },
        { id: 15, trait: 'E', reverse: true,  ko: '나는 낯선 사람들과 있을 때 말을 별로 하지 않는다.', en: 'I don\'t talk a lot when among strangers.',          ja: '知らない人といるときはあまり話さない。' },
        { id: 16, trait: 'E', reverse: false, ko: '나는 다른 사람들의 주목을 받는 것을 즐긴다.',     en: 'I enjoy being the center of attention.',               ja: '他の人に注目されることを楽しむ。' },
        { id: 17, trait: 'E', reverse: true,  ko: '나는 혼자 있는 것을 즐긴다.',                    en: 'I prefer to be by myself.',                            ja: '一人でいることを楽しむ。' },
        { id: 18, trait: 'E', reverse: false, ko: '나는 에너지가 넘치고 활기차다.',                  en: 'I am full of energy and enthusiasm.',                  ja: 'エネルギーに満ちて活発だ。' },
        // AGREEABLENESS (A)
        { id: 19, trait: 'A', reverse: false, ko: '나는 다른 사람들의 감정에 쉽게 공감한다.',        en: 'I sympathize with others\' feelings easily.',          ja: '他の人の気持ちに共感しやすい。' },
        { id: 20, trait: 'A', reverse: false, ko: '나는 사람들이 원하는 것에 관심이 많다.',          en: 'I am interested in what people want.',                 ja: '人が望むものに関心が多い。' },
        { id: 21, trait: 'A', reverse: true,  ko: '나는 다른 사람들의 감정에 별로 관심이 없다.',     en: 'I am not really interested in others\' feelings.',    ja: '他の人の感情にあまり興味がない。' },
        { id: 22, trait: 'A', reverse: false, ko: '나는 도움이 필요한 사람을 보면 돕고 싶다.',       en: 'I feel the urge to help others in need.',              ja: '困っている人を見ると助けたくなる。' },
        { id: 23, trait: 'A', reverse: true,  ko: '나는 사람들의 문제에 관여하고 싶지 않다.',        en: 'I don\'t want to get involved in others\' problems.',  ja: '他の人の問題にはあまり関わりたくない。' },
        { id: 24, trait: 'A', reverse: false, ko: '나는 다른 사람의 입장을 이해하려고 노력한다.',    en: 'I try to understand others\' points of view.',        ja: '他の人の立場を理解しようと努力する。' },
        // NEUROTICISM (N)
        { id: 25, trait: 'N', reverse: false, ko: '나는 쉽게 스트레스를 받는다.',                   en: 'I get stressed out easily.',                           ja: 'ストレスを受けやすい。' },
        { id: 26, trait: 'N', reverse: false, ko: '나는 기분이 자주 변하는 편이다.',                 en: 'My mood changes a lot.',                               ja: '気分がよく変わる方だ。' },
        { id: 27, trait: 'N', reverse: true,  ko: '나는 대개 편안하고 여유가 있다.',                 en: 'I am usually relaxed and at ease.',                    ja: 'たいてい穏やかでゆとりがある。' },
        { id: 28, trait: 'N', reverse: false, ko: '나는 걱정을 많이 하는 편이다.',                   en: 'I worry about things a lot.',                          ja: '心配することが多い方だ。' },
        { id: 29, trait: 'N', reverse: false, ko: '나는 쉽게 화가 나거나 짜증이 난다.',              en: 'I get irritated easily.',                              ja: '簡単に怒ったりイライラしたりする。' },
        { id: 30, trait: 'N', reverse: true,  ko: '나는 감정적으로 안정적인 편이다.',                en: 'I am emotionally stable.',                             ja: '感情的に安定している方だ。' }
    ];

    // ── 점수 계산 ──────────────────────────────────────────────────
    function calculateScores() {
        const sums   = { O: 0, C: 0, E: 0, A: 0, N: 0 };
        const counts = { O: 0, C: 0, E: 0, A: 0, N: 0 };
        BIG5_QUESTIONS.forEach(function (q) {
            var raw = _answers[q.id];
            if (raw == null) return;
            var score = q.reverse ? (6 - raw) : raw;
            sums[q.trait]   += score;
            counts[q.trait] += 1;
        });
        var result = {};
        ['O', 'C', 'E', 'A', 'N'].forEach(function (t) {
            result[t] = counts[t] > 0 ? Math.round((sums[t] / counts[t]) * 20) : 0;
        });
        return result;
    }

    // ── SVG 바 차트 생성 ───────────────────────────────────────────
    function buildBarChartSVG(scores, traitLabels, width, scaleFactor) {
        scaleFactor = scaleFactor || 1;
        var traits  = ['O', 'C', 'E', 'A', 'N'];
        var barH    = Math.round(18 * scaleFactor);
        // 레이블 길이에 따른 동적 labelW (영문 겹침 방지)
        var maxLen = 0;
        traits.forEach(function(t) { var l = (traitLabels[t] || t).length; if (l > maxLen) maxLen = l; });
        var isLatin = /[a-zA-Z]/.test(traitLabels['O'] || '');
        var labelW  = Math.max(Math.round(52 * scaleFactor), Math.ceil(maxLen * (isLatin ? 6.5 : 10) * scaleFactor) + 6);
        var scoreW  = Math.round(26 * scaleFactor);
        var padX    = Math.round(10 * scaleFactor);
        var gapY    = Math.round(9 * scaleFactor);
        var fontSize = Math.round(11 * scaleFactor);
        var usableW = width - labelW - scoreW - padX * 2;
        var svgH    = traits.length * (barH + gapY) + 10;

        var bars = '';
        traits.forEach(function (t, i) {
            var y      = 5 + i * (barH + gapY);
            var val    = Math.max(0, Math.min(100, scores[t] || 0));
            var fillW  = Math.round((val / 100) * usableW);
            var color  = TRAIT_COLORS[t];
            var label  = traitLabels[t] || t;
            bars +=
                '<text x="' + padX + '" y="' + (y + barH - 4) + '" font-size="' + fontSize + '" fill="var(--text-sub)">' + label + '</text>' +
                '<rect x="' + (padX + labelW) + '" y="' + y + '" width="' + usableW + '" height="' + barH + '" rx="4" fill="rgba(255,255,255,0.06)"/>' +
                '<rect x="' + (padX + labelW) + '" y="' + y + '" width="' + fillW  + '" height="' + barH + '" rx="4" fill="' + color + '" opacity="0.85"/>' +
                '<text x="' + (padX + labelW + usableW + 5) + '" y="' + (y + barH - 4) + '" font-size="' + fontSize + '" fill="' + color + '" font-weight="bold">' + val + '</text>';
        });

        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + svgH + '" style="width:100%;max-width:' + width + 'px;display:block;margin:0 auto;">' + bars + '</svg>';
    }

    function getTraitLabels(lang) {
        var _t = (i18n && i18n[lang]) || (i18n && i18n.ko) || {};
        return {
            O: _t.big5_trait_O || '개방성',
            C: _t.big5_trait_C || '성실성',
            E: _t.big5_trait_E || '외향성',
            A: _t.big5_trait_A || '친화성',
            N: _t.big5_trait_N || '신경증'
        };
    }

    // ── 오버레이 열기 ──────────────────────────────────────────────
    function openPersonalityTest() {
        _currentPage = 0;
        _answers = {};
        _big5IsPublic = (AppState.user.big5 && AppState.user.big5.isPublic === false) ? false : true;

        var overlay = document.createElement('div');
        overlay.className = 'report-modal-overlay';
        overlay.id = 'big5-test-overlay';
        overlay.innerHTML =
            '<div class="report-modal-content" style="max-width:400px;width:92%;padding:0;overflow:hidden;display:flex;flex-direction:column;max-height:88vh;">' +
                '<div id="big5-test-inner" style="flex:1;overflow-y:auto;padding:20px 18px 16px;"></div>' +
            '</div>';
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.classList.add('active'); });
        renderPage();
    }
    window.openPersonalityTest = openPersonalityTest;

    function closePersonalityTest() {
        var overlay = document.getElementById('big5-test-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(function () { overlay.remove(); }, 250);
        }
    }
    window.closePersonalityTest = closePersonalityTest;

    // ── 페이지 라우터 ──────────────────────────────────────────────
    function renderPage() {
        if (_currentPage === 0)           renderConsentPage();
        else if (_currentPage <= PAGES)   renderQuestionsPage(_currentPage);
        else                              renderResultsPage();
    }

    // ── 페이지 0: 동의 ─────────────────────────────────────────────
    function renderConsentPage() {
        var lang = AppState.currentLang || 'ko';
        var _t   = (i18n && i18n[lang]) || (i18n && i18n.ko) || {};
        var alreadyConsented = !!localStorage.getItem(CONSENT_KEY);
        var inner = document.getElementById('big5-test-inner');
        if (!inner) return;

        inner.innerHTML =
            '<div style="font-size:1rem;font-weight:bold;color:var(--neon-blue);margin-bottom:14px;">' +
                (_t.big5_title || 'BIG FIVE 성격 검사') +
            '</div>' +
            '<div style="font-size:0.8rem;color:var(--text-sub);line-height:1.7;margin-bottom:14px;word-break:keep-all;">' +
                (_t.big5_consent_desc || '이 검사는 성격의 5가지 주요 특성(개방성, 성실성, 외향성, 친화성, 신경증)을 측정합니다. 총 30문항이며 약 5분 소요됩니다.') +
            '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-sub);background:rgba(0,217,255,0.05);border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:14px;">' +
                '🔒 ' + (_t.big5_storage_notice || '검사 결과는 서버에 저장되며 소셜 프로필에서 공개될 수 있습니다.') +
            '</div>' +
            '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:18px;">' +
                '<input type="checkbox" id="big5-consent-cb" style="margin-top:3px;accent-color:var(--neon-blue);width:16px;height:16px;flex-shrink:0;cursor:pointer;"' + (alreadyConsented ? ' checked' : '') + '>' +
                '<label for="big5-consent-cb" style="font-size:0.78rem;color:var(--text-main);cursor:pointer;line-height:1.5;">' +
                    (_t.big5_consent_label || '개인정보 수집 및 결과 저장에 동의합니다 (필수)') +
                '</label>' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
                '<button onclick="window.closePersonalityTest()" style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);font-size:0.85rem;cursor:pointer;">' +
                    (_t.big5_btn_cancel || '취소') +
                '</button>' +
                '<button id="big5-start-btn" onclick="window.startBig5Test()" style="flex:2;padding:10px;border-radius:6px;border:none;background:var(--neon-blue);color:#000;font-size:0.85rem;font-weight:bold;cursor:pointer;opacity:' + (alreadyConsented ? '1' : '0.4') + ';">' +
                    (_t.big5_btn_start || '검사 시작') +
                '</button>' +
            '</div>';

        var cb       = inner.querySelector('#big5-consent-cb');
        var startBtn = inner.querySelector('#big5-start-btn');
        cb.addEventListener('change', function () {
            startBtn.style.opacity = cb.checked ? '1' : '0.4';
        });
    }

    window.startBig5Test = function () {
        var cb = document.getElementById('big5-consent-cb');
        if (!cb || !cb.checked) {
            var lang = AppState.currentLang || 'ko';
            var _t   = (window.i18n && window.i18n[lang]) || (window.i18n && window.i18n.ko) || {};
            alert(_t.big5_consent_required || '검사를 시작하려면 동의가 필요합니다.');
            return;
        }
        localStorage.setItem(CONSENT_KEY, new Date().toISOString());

        function proceedToTest() {
            _currentPage = 1;
            renderPage();
        }

        if (window.AdManager) {
            window.AdManager.showRewarded({
                context: 'big5Test',
                onSuccess: proceedToTest,
                onFail: proceedToTest
            });
        } else {
            proceedToTest();
        }
    };

    // ── 페이지 1-6: 문항 ───────────────────────────────────────────
    function renderQuestionsPage(page) {
        var lang      = AppState.currentLang || 'ko';
        var _t        = (i18n && i18n[lang]) || (i18n && i18n.ko) || {};
        var startIdx  = (page - 1) * PER_PAGE;
        var questions = BIG5_QUESTIONS.slice(startIdx, startIdx + PER_PAGE);
        var pct       = Math.round(((page - 1) / PAGES) * 100);
        var inner     = document.getElementById('big5-test-inner');
        if (!inner) return;

        var qHTML = '';
        questions.forEach(function (q, i) {
            var qNum     = startIdx + i + 1;
            var qText    = q[lang] || q.ko;
            var answered = _answers[q.id];

            var btns = '';
            [1, 2, 3, 4, 5].forEach(function (v) {
                var sel   = answered === v;
                var bdr   = sel ? 'var(--neon-blue)' : 'var(--border-color)';
                var bg    = sel ? 'rgba(0,217,255,0.15)' : 'transparent';
                var color = sel ? 'var(--neon-blue)' : 'var(--text-sub)';
                var fw    = sel ? 'bold' : 'normal';
                btns +=
                    '<div onclick="window.big5Answer(' + q.id + ',' + v + ')" ' +
                         'style="flex:1;text-align:center;padding:7px 0;border-radius:6px;border:1px solid ' + bdr + ';background:' + bg + ';font-size:0.85rem;color:' + color + ';font-weight:' + fw + ';cursor:pointer;transition:all 0.15s;" ' +
                         'data-qid="' + q.id + '" data-val="' + v + '">' +
                        v +
                    '</div>';
            });

            qHTML +=
                '<div style="margin-bottom:14px;padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border-color);">' +
                    '<div style="font-size:0.82rem;color:var(--text-main);margin-bottom:10px;line-height:1.5;">' +
                        '<span style="color:var(--neon-blue);font-weight:bold;">' + qNum + '.</span> ' + qText +
                    '</div>' +
                    '<div style="display:flex;gap:4px;">' + btns + '</div>' +
                '</div>';
        });

        var prevBtn = page > 1
            ? '<button onclick="window.big5Prev()" style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);font-size:0.85rem;cursor:pointer;">' + (_t.big5_btn_prev || '이전') + '</button>'
            : '';
        var nextLabel = page < PAGES ? (_t.big5_btn_next || '다음') : (_t.big5_btn_finish || '결과 보기');

        inner.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                '<div style="font-size:0.75rem;color:var(--text-sub);">' + page + ' / ' + PAGES + '</div>' +
                '<div style="font-size:0.75rem;color:var(--neon-blue);">' + pct + '%</div>' +
            '</div>' +
            '<div style="height:3px;background:var(--border-color);border-radius:2px;margin-bottom:14px;overflow:hidden;">' +
                '<div style="height:100%;width:' + pct + '%;background:var(--neon-blue);border-radius:2px;transition:width 0.3s;"></div>' +
            '</div>' +
            '<div style="font-size:0.65rem;color:var(--text-sub);text-align:center;margin-bottom:12px;">' +
                '1 = ' + (_t.big5_likert_1 || '전혀 아니다') + ' &nbsp;·&nbsp; 3 = ' + (_t.big5_likert_3 || '보통') + ' &nbsp;·&nbsp; 5 = ' + (_t.big5_likert_5 || '매우 그렇다') +
            '</div>' +
            qHTML +
            '<div style="display:flex;gap:8px;margin-top:4px;">' +
                prevBtn +
                '<button onclick="window.big5Next()" style="flex:2;padding:10px;border-radius:6px;border:none;background:var(--neon-blue);color:#000;font-size:0.85rem;font-weight:bold;cursor:pointer;">' +
                    nextLabel +
                '</button>' +
            '</div>';
    }

    window.big5Answer = function (questionId, value) {
        _answers[questionId] = value;
        // 선택 상태 UI 즉시 갱신
        var startIdx  = (_currentPage - 1) * PER_PAGE;
        var questions = BIG5_QUESTIONS.slice(startIdx, startIdx + PER_PAGE);
        questions.forEach(function (q) {
            [1, 2, 3, 4, 5].forEach(function (v) {
                var el = document.querySelector('[data-qid="' + q.id + '"][data-val="' + v + '"]');
                if (!el) return;
                var sel   = _answers[q.id] === v;
                el.style.borderColor  = sel ? 'var(--neon-blue)' : 'var(--border-color)';
                el.style.background   = sel ? 'rgba(0,217,255,0.15)' : 'transparent';
                el.style.color        = sel ? 'var(--neon-blue)' : 'var(--text-sub)';
                el.style.fontWeight   = sel ? 'bold' : 'normal';
            });
        });
    };

    window.big5Next = function () {
        var startIdx  = (_currentPage - 1) * PER_PAGE;
        var questions = BIG5_QUESTIONS.slice(startIdx, startIdx + PER_PAGE);
        var unanswered = questions.filter(function (q) { return _answers[q.id] == null; });
        if (unanswered.length > 0) {
            var lang = AppState.currentLang || 'ko';
            var _t   = (i18n && i18n[lang]) || (i18n && i18n.ko) || {};
            alert(_t.big5_answer_required || '이 페이지의 모든 질문에 응답해주세요.');
            return;
        }
        _currentPage++;
        var inner = document.getElementById('big5-test-inner');
        if (inner) inner.scrollTop = 0;
        renderPage();
    };

    window.big5Prev = function () {
        if (_currentPage > 1) {
            _currentPage--;
            var inner = document.getElementById('big5-test-inner');
            if (inner) inner.scrollTop = 0;
            renderPage();
        }
    };

    // ── 페이지 7: 결과 ─────────────────────────────────────────────
    function renderResultsPage() {
        var scores = calculateScores();
        var lang   = AppState.currentLang || 'ko';
        var _t     = (i18n && i18n[lang]) || (i18n && i18n.ko) || {};
        var labels = getTraitLabels(lang);
        var inner  = document.getElementById('big5-test-inner');
        if (!inner) return;

        var publicChecked = _big5IsPublic ? ' checked' : '';
        inner.innerHTML =
            '<div style="font-size:1rem;font-weight:bold;color:var(--neon-blue);text-align:center;margin-bottom:4px;">' +
                (_t.big5_result_title || '검사 결과') +
            '</div>' +
            '<div style="font-size:0.72rem;color:var(--text-sub);text-align:center;margin-bottom:14px;">' +
                (_t.big5_result_subtitle || 'BIG FIVE 성격 특성') +
            '</div>' +
            buildBarChartSVG(scores, labels, 300) +
            '<div style="font-size:0.7rem;color:var(--text-sub);text-align:center;margin:10px 0 12px;">' +
                (_t.big5_result_hint || '결과는 저장 후 소셜 프로필에 표시됩니다.') +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-radius:8px;">' +
                '<input type="checkbox" id="big5-public-cb" style="accent-color:var(--neon-blue);width:15px;height:15px;flex-shrink:0;cursor:pointer;"' + publicChecked + '>' +
                '<label for="big5-public-cb" style="font-size:0.78rem;color:var(--text-main);cursor:pointer;line-height:1.4;">' +
                    (_t.big5_public_label || '소셜 프로필 공개') +
                '</label>' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
                '<button onclick="window.closePersonalityTest()" style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);font-size:0.85rem;cursor:pointer;">' +
                    (_t.big5_btn_cancel || '취소') +
                '</button>' +
                '<button onclick="window.saveBig5Results()" style="flex:2;padding:10px;border-radius:6px;border:none;background:var(--neon-blue);color:#000;font-size:0.85rem;font-weight:bold;cursor:pointer;">' +
                    (_t.big5_btn_save || '저장') +
                '</button>' +
            '</div>';

        var publicCb = inner.querySelector('#big5-public-cb');
        if (publicCb) {
            publicCb.addEventListener('change', function() { _big5IsPublic = publicCb.checked; });
        }
    }

    // ── 결과 저장 ──────────────────────────────────────────────────
    window.saveBig5Results = function () {
        if (!localStorage.getItem(CONSENT_KEY)) {
            var lang = AppState.currentLang || 'ko';
            var _t   = (window.i18n && window.i18n[lang]) || (window.i18n && window.i18n.ko) || {};
            alert(_t.big5_consent_required || '동의 후 저장할 수 있습니다.');
            return;
        }
        var isFirstCompletion = !(AppState.user.big5 && AppState.user.big5.completedAt);
        var scores = calculateScores();
        AppState.user.big5 = {
            o: scores.O,
            c: scores.C,
            e: scores.E,
            a: scores.A,
            n: scores.N,
            completedAt: new Date().toISOString(),
            isPublic: _big5IsPublic
        };
        if (typeof window.saveUserData === 'function') window.saveUserData();

        // ── CHA 보상 (최초 완료 1회) ───────────────────────────────
        var alreadyClaimed = !!localStorage.getItem(BIG5_CHA_KEY);
        if (isFirstCompletion && !alreadyClaimed) {
            localStorage.setItem(BIG5_CHA_KEY, '1');
            AppState.user.pendingStats.cha = (AppState.user.pendingStats.cha || 0) + BIG5_CHA_REWARD;
            if (typeof window.saveUserData === 'function') window.saveUserData();
            var lang = AppState.currentLang || 'ko';
            var _t   = (window.i18n && window.i18n[lang]) || (window.i18n && window.i18n.ko) || {};
            alert(_t.big5_cha_reward || 'Big5 성격 검사 완료! CHA +3');
        }

        closePersonalityTest();
        renderBig5Card();
    };

    // ── 카드 렌더링 (상태창) ───────────────────────────────────────
    function renderBig5Card() {
        var container = document.getElementById('big5-card-content');
        if (!container) return;
        var lang  = AppState.currentLang || 'ko';
        var _t    = (i18n && i18n[lang]) || (i18n && i18n.ko) || {};
        var big5  = AppState.user && AppState.user.big5;

        if (!big5 || !big5.completedAt) {
            container.innerHTML =
                '<div style="text-align:center;padding:12px 0;color:var(--text-sub);font-size:0.8rem;line-height:1.6;">' +
                    (_t.big5_card_empty || '검사를 완료하면 성격 특성이 표시됩니다.') +
                '</div>';
            return;
        }

        var scores = { O: big5.o, C: big5.c, E: big5.e, A: big5.a, N: big5.n };
        var labels = getTraitLabels(lang);
        container.innerHTML = buildBarChartSVG(scores, labels, 300);
    }
    window.renderBig5Card = renderBig5Card;

    // ── 소셜 프로필 Big5 렌더링 ────────────────────────────────────
    window.renderBig5ForProfile = function (big5Data, lang) {
        var container = document.getElementById('profile-big5-section');
        if (!container) return;
        if (!big5Data || !big5Data.completedAt || big5Data.isPublic === false) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';
        var _lang  = lang || AppState.currentLang || 'ko';
        var _t     = (i18n && i18n[_lang]) || (i18n && i18n.ko) || {};
        var labels = getTraitLabels(_lang);
        var scores = { O: big5Data.o, C: big5Data.c, E: big5Data.e, A: big5Data.a, N: big5Data.n };
        var svgHtml = buildBarChartSVG(scores, labels, 200, 0.85).replace('margin:0 auto', 'margin:0');
        container.innerHTML = svgHtml;
    };

    // ── 검사 결과 초기화 ───────────────────────────────────────────
    window.resetBig5Results = function () {
        var lang = AppState.currentLang || 'ko';
        var _t   = (window.i18n && window.i18n[lang]) || (window.i18n && window.i18n.ko) || {};
        if (!confirm(_t.big5_reset_confirm || '검사 결과를 초기화하시겠습니까?')) return;
        AppState.user.big5 = null;
        if (typeof window.saveUserData === 'function') window.saveUserData();
        renderBig5Card();
        alert(_t.big5_reset_done || '검사 결과가 초기화되었습니다.');
    };

    // ── 가이드 모달 ────────────────────────────────────────────────
    function openBig5Guide() {
        var lang = AppState.currentLang || 'ko';
        var _t   = (window.i18n && window.i18n[lang]) || (window.i18n && window.i18n.ko) || {};

        var traits = [
            { key: 'O', color: '#b08aff', title: _t.big5_guide_O_title || '개방성 (Openness)',          desc: _t.big5_guide_O_desc || '새로운 경험·아이디어에 대한 호기심.' },
            { key: 'C', color: '#00d9ff', title: _t.big5_guide_C_title || '성실성 (Conscientiousness)', desc: _t.big5_guide_C_desc || '목표 달성을 위한 자기 규율.' },
            { key: 'E', color: '#ffcc00', title: _t.big5_guide_E_title || '외향성 (Extraversion)',      desc: _t.big5_guide_E_desc || '사회적 상황에서의 활력.' },
            { key: 'A', color: '#00ff88', title: _t.big5_guide_A_title || '친화성 (Agreeableness)',     desc: _t.big5_guide_A_desc || '타인에 대한 공감과 협력.' },
            { key: 'N', color: '#ff6b6b', title: _t.big5_guide_N_title || '신경증 (Neuroticism)',       desc: _t.big5_guide_N_desc || '정서적 불안정성.' }
        ];

        var traitsHTML = traits.map(function(t) {
            return '<div style="margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,0.03);border-left:3px solid ' + t.color + ';border-radius:0 6px 6px 0;">' +
                '<div style="font-size:0.82rem;font-weight:bold;color:' + t.color + ';margin-bottom:4px;">' + t.title + '</div>' +
                '<div style="font-size:0.75rem;color:var(--text-sub);line-height:1.6;word-break:keep-all;">' + t.desc + '</div>' +
            '</div>';
        }).join('');

        var overlay = document.createElement('div');
        overlay.className = 'report-modal-overlay';
        overlay.id = 'big5-guide-overlay';
        overlay.innerHTML =
            '<div class="report-modal-content" style="max-width:400px;width:92%;padding:0;overflow:hidden;display:flex;flex-direction:column;max-height:88vh;">' +
                '<div style="flex:1;overflow-y:auto;padding:20px 18px 16px;">' +
                    '<div style="font-size:1rem;font-weight:bold;color:var(--neon-blue);margin-bottom:16px;">' +
                        (_t.big5_guide_title || 'Big5 성격검사 가이드') +
                    '</div>' +
                    traitsHTML +
                    '<div style="margin-top:14px;padding:12px;background:rgba(255,215,0,0.07);border:1px solid rgba(255,215,0,0.3);border-radius:8px;">' +
                        '<div style="font-size:0.82rem;font-weight:bold;color:var(--neon-gold, #ffd700);margin-bottom:6px;">🏆 ' +
                            (_t.big5_guide_reward_title || '보상 안내') +
                        '</div>' +
                        '<div style="font-size:0.75rem;color:var(--text-sub);line-height:1.6;word-break:keep-all;">' +
                            (_t.big5_guide_reward_desc || '최초 검사 완료 시 CHA (매력) 스탯 +3을 획득합니다.') +
                        '</div>' +
                    '</div>' +
                    '<button onclick="window.closeBig5Guide()" style="width:100%;margin-top:16px;padding:10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-sub);font-size:0.85rem;cursor:pointer;">' +
                        (_t.big5_guide_close || '닫기') +
                    '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.classList.add('active'); });
    }
    window.openBig5Guide = openBig5Guide;

    window.closeBig5Guide = function () {
        var overlay = document.getElementById('big5-guide-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(function () { overlay.remove(); }, 250);
        }
    };

    // ── 초기화 ─────────────────────────────────────────────────────
    function init() {
        var btn = document.getElementById('btn-big5-detail');
        if (btn) btn.addEventListener('click', openPersonalityTest);
        var btnGuide = document.getElementById('btn-big5-guide');
        if (btnGuide) btnGuide.addEventListener('click', openBig5Guide);
        var btnReset = document.getElementById('btn-big5-reset');
        if (btnReset) btnReset.addEventListener('click', window.resetBig5Results);
        renderBig5Card();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
