// ============================================================
//  LEVEL UP: REBOOT - APK 자동 로그 시스템 (logger.js)
//  APK 실행 시 발생하는 오류를 자동으로 수집하고 저장합니다.
// ============================================================

(function () {
    'use strict';

    const STORAGE_KEY = 'levelup_logs';
    const MAX_ENTRIES = 500;       // 최대 로그 보관 개수
    const MSG_MAX_LEN = 800;       // 메시지 최대 길이
    const STACK_MAX_LEN = 1500;    // 스택 트레이스 최대 길이

    // HTML 이스케이프 (XSS 방지)
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── 내부 헬퍼 ──────────────────────────────────────────
    function timestamp() {
        return new Date().toISOString();
    }

    function truncate(str, max) {
        if (!str) return '';
        str = String(str);
        return str.length > max ? str.substring(0, max) + '…' : str;
    }

    function getLogs() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        } catch (_) {
            return [];
        }
    }

    function saveLogs(logs) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
        } catch (_) { /* localStorage 용량 초과 등 무시 */ }
    }

    function addEntry(level, message, stack, context) {
        try {
            const logs = getLogs();
            var entry = {
                ts:    timestamp(),
                level: level,
                msg:   truncate(message, MSG_MAX_LEN),
                stack: truncate(stack, STACK_MAX_LEN) || null,
                env:   window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
                           ? 'native' : 'web'
            };
            // 구조화된 컨텍스트 메타데이터 (디버깅용)
            if (context && typeof context === 'object') {
                entry.ctx = {};
                for (var k in context) {
                    if (Object.prototype.hasOwnProperty.call(context, k)) {
                        entry.ctx[k] = truncate(String(context[k]), 300);
                    }
                }
            }
            logs.push(entry);
            // 오래된 항목 제거 (FIFO rotation)
            if (logs.length > MAX_ENTRIES) {
                logs.splice(0, logs.length - MAX_ENTRIES);
            }
            saveLogs(logs);
            // 뱃지 즉시 갱신 (로그인 전·후 화면 모두)
            if (window.AppLogger) { window.AppLogger._refreshBadge(); }
        } catch (_) { /* 로깅 자체 오류는 무시 */ }
    }

    // ── 순환 참조 안전한 직렬화 ────────────────────────────
    function safeStringify(obj) {
        try {
            var seen = new Set();
            return JSON.stringify(obj, function (_key, val) {
                if (typeof val === 'object' && val !== null) {
                    if (seen.has(val)) return '[Circular]';
                    seen.add(val);
                }
                return val;
            });
        } catch (_e) {
            return String(obj);
        }
    }

    // ── 알려진 비치명 콘솔 오류 필터 ────────────────────────
    function classifyConsoleError(args) {
        if (!Array.isArray(args) || args.length === 0) return { ignore: false };
        // Firebase Auth 로그인 전 상태에서 간헐적으로 발생하는 노이즈성 메시지
        // 예: console.error({ message: "User not logged in." })
        if (args.length === 1 && args[0] && typeof args[0] === 'object') {
            var message = String(args[0].message || '');
            if (message === 'User not logged in.') {
                return { ignore: false, level: 'INFO', prefix: '[ConsoleNoise]' };
            }
        }
        return { ignore: false };
    }

    // ── console 메서드 인터셉트 ────────────────────────────
    function interceptConsole() {
        const _error = console.error.bind(console);
        const _warn  = console.warn.bind(console);

        console.error = function (...args) {
            _error(...args);
            const classified = classifyConsoleError(args);
            if (classified.ignore) return;
            const msg = args.map(a => {
                if (a instanceof Error) return a.message;
                return typeof a === 'object' ? safeStringify(a) : String(a);
            }).join(' ');
            const stack = args.find(a => a instanceof Error)?.stack || '';
            const level = classified.level || 'ERROR';
            const prefixedMsg = classified.prefix ? (classified.prefix + ' ' + msg) : msg;
            addEntry(level, prefixedMsg, stack);
        };

        console.warn = function (...args) {
            _warn(...args);
            addEntry('WARN', args.map(a => typeof a === 'object' ? safeStringify(a) : String(a)).join(' '), '');
        };
    }

    // ── 전역 에러 핸들러 ───────────────────────────────────
    function setupGlobalHandlers() {
        // 동기 JS 오류
        window.onerror = function (message, source, lineno, colno, error) {
            const src  = source ? source.split('/').pop() : 'unknown';
            const loc  = `${src}:${lineno}:${colno}`;
            addEntry('ERROR', `[GlobalError] ${message} (${loc})`, error?.stack || '');
            return false; // 브라우저 기본 동작 유지
        };

        // 미처리 Promise rejection
        window.addEventListener('unhandledrejection', function (event) {
            const reason = event.reason;
            const msg    = reason instanceof Error ? reason.message : String(reason || 'UnhandledRejection');
            const stack  = reason instanceof Error ? (reason.stack || '') : '';
            addEntry('ERROR', `[UnhandledRejection] ${msg}`, stack);
        });

        // 네트워크/리소스 로드 오류 (이미지·스크립트 등)
        window.addEventListener('error', function (event) {
            if (event.target && event.target !== window) {
                const tag = event.target.tagName || 'unknown';
                const src = event.target.src || event.target.href || '';
                addEntry('WARN', `[ResourceError] <${tag}> 로드 실패: ${src}`, '');
            }
        }, true /* capture */);
    }

    // ── 공개 API ───────────────────────────────────────────
    const AppLogger = {
        info:  function (msg, detail) { addEntry('INFO',  msg, detail || ''); },
        warn:  function (msg, detail) { addEntry('WARN',  msg, detail || ''); },
        error: function (msg, detail) { addEntry('ERROR', msg, detail || ''); },
        debug: function (msg, detail) { addEntry('DEBUG', msg, detail || ''); },

        /**
         * 구조화된 에러 로깅 (API 오류 상세 분석용)
         * @param {string} tag   - 모듈 태그 (예: '[Movie]')
         * @param {string} msg   - 에러 메시지
         * @param {Object} ctx   - 컨텍스트 정보 {code, action, params, duration, online, ...}
         */
        errorDetail: function (tag, msg, ctx) {
            ctx = ctx || {};
            ctx.online = navigator.onLine ? 'Y' : 'N';
            addEntry('ERROR', tag + ' ' + msg, '', ctx);
        },

        /**
         * API 호출 타이머 시작 — 호출 소요 시간 자동 측정
         * @param {string} tag   - 모듈 태그 (예: '[Movie]')
         * @param {string} label - 호출 레이블 (예: 'searchMovies')
         * @returns {{ success(detail?), fail(error, extraCtx?) }}
         */
        apiCall: function (tag, label) {
            var t0 = Date.now();
            return {
                /** API 성공 시 INFO 기록 */
                success: function (detail) {
                    var ms = Date.now() - t0;
                    addEntry('INFO', tag + ' ' + label + ' 완료 (' + ms + 'ms)', '', { duration: ms + 'ms', detail: detail || '' });
                },
                /** API 실패 시 상세 ERROR 기록 */
                fail: function (error, extraCtx) {
                    var ms = Date.now() - t0;
                    var code = (error && error.code) || '';
                    var message = (error && error.message) || String(error || '');
                    var details = (error && error.details) ? safeStringify(error.details) : '';
                    var ctx = {
                        code: code,
                        duration: ms + 'ms',
                        online: navigator.onLine ? 'Y' : 'N',
                        details: details
                    };
                    if (extraCtx && typeof extraCtx === 'object') {
                        for (var k in extraCtx) {
                            if (Object.prototype.hasOwnProperty.call(extraCtx, k)) ctx[k] = extraCtx[k];
                        }
                    }
                    addEntry('ERROR', tag + ' ' + label + ' 실패 (' + ms + 'ms): ' + message, error && error.stack || '', ctx);
                }
            };
        },

        /** 최근 N개 로그를 최신순으로 반환 */
        getRecent: function (n) {
            const logs = getLogs();
            return logs.slice(-Math.min(n || 100, logs.length)).reverse();
        },

        /** 저장된 로그 수 */
        count: function () { return getLogs().length; },

        /** 로그를 .txt 파일로 다운로드 (Android APK 환경 지원) */
        export: function () {
            const logs = getLogs();
            if (!logs.length) { alert('저장된 로그가 없습니다.'); return; }

            const lines = logs.map(function (l) {
                let line = '[' + l.ts + '] [' + l.level + '] [' + l.env + '] ' + l.msg;
                if (l.ctx) {
                    var pairs = [];
                    for (var k in l.ctx) {
                        if (Object.prototype.hasOwnProperty.call(l.ctx, k) && l.ctx[k]) {
                            pairs.push(k + '=' + l.ctx[k]);
                        }
                    }
                    if (pairs.length) line += '\n    [ctx] ' + pairs.join(' | ');
                }
                if (l.stack) line += '\n    ' + l.stack.replace(/\n/g, '\n    ');
                return line;
            });

            const header = [
                '=== LEVEL UP: REBOOT - 앱 오류 로그 ===',
                '생성 시각: ' + new Date().toLocaleString('ko-KR'),
                '총 ' + logs.length + '개 항목',
                '================================================',
                ''
            ].join('\n');

            const content  = header + lines.join('\n');
            const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

            if (isNative) {
                // Android WebView는 Blob URL 다운로드를 지원하지 않음
                // → Web Share API로 공유하거나, 텍스트 모달로 표시
                if (navigator.share) {
                    navigator.share({
                        title: 'LEVEL UP 오류 로그 (' + logs.length + '개)',
                        text: content
                    }).catch(function (e) {
                        if (e.name !== 'AbortError') { AppLogger._showLogText(content); }
                    });
                } else {
                    AppLogger._showLogText(content);
                }
                AppLogger.info('[LogExport] 로그 내보내기 (' + logs.length + '개)');
            } else {
                // 웹 브라우저: 기존 Blob 다운로드 방식
                const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = 'levelup-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                AppLogger.info('[LogExport] 로그 파일 내보내기 완료 (' + logs.length + '개)');
            }
        },

        /** Android APK용 로그 텍스트 표시 모달 (복사 가능) */
        _showLogText: function (content) {
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.96);z-index:9999;display:flex;flex-direction:column;padding:15px;box-sizing:border-box;';

            var title = document.createElement('div');
            title.style.cssText = 'color:#00d9ff;font-weight:bold;margin-bottom:8px;font-size:0.85rem;flex-shrink:0;';
            title.textContent = '로그 전체 선택 후 복사하세요';

            var ta = document.createElement('textarea');
            ta.style.cssText = 'flex-grow:1;background:#111;color:#aaa;border:1px solid #333;padding:10px;font-family:monospace;font-size:0.65rem;resize:none;border-radius:6px;width:100%;box-sizing:border-box;';
            ta.readOnly = true;
            ta.value = content;

            var btn = document.createElement('button');
            btn.style.cssText = 'margin-top:10px;padding:12px;background:#333;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.85rem;flex-shrink:0;';
            btn.textContent = '닫기';
            btn.onclick = function () { document.body.removeChild(overlay); };

            overlay.appendChild(title);
            overlay.appendChild(ta);
            overlay.appendChild(btn);
            document.body.appendChild(overlay);
            // 텍스트 전체 자동 선택
            setTimeout(function () { ta.focus(); ta.select(); }, 100);
        },

        /** 로그 전체 초기화 */
        clear: function () {
            saveLogs([]);
            addEntry('INFO', '[LogClear] 로그가 초기화되었습니다.', '');
            AppLogger._refreshBadge();
        },

        /** 설정 화면 로그 뷰어 모달 열기 */
        openViewer: function () {
            const modal   = document.getElementById('logViewerModal');
            const content = document.getElementById('log-viewer-content');
            if (!modal || !content) return;

            const logs = AppLogger.getRecent(100);
            if (!logs.length) {
                content.innerHTML = '<div style="text-align:center; color:var(--text-sub); padding:20px;">수집된 로그가 없습니다.</div>';
            } else {
                content.innerHTML = logs.map(function (l) {
                    const colorMap = { ERROR: 'var(--neon-red)', WARN: 'var(--neon-gold)', INFO: 'var(--neon-blue)', DEBUG: 'var(--text-sub)' };
                    const color    = colorMap[l.level] || 'var(--text-main)';
                    const time     = l.ts.replace('T', ' ').substring(0, 19);
                    const stack    = l.stack ? '<div style="font-size:0.6rem; color:var(--text-sub); margin-top:2px; word-break:break-all;">' + escapeHtml(l.stack.substring(0, 200)) + '</div>' : '';
                    var ctxHtml = '';
                    if (l.ctx) {
                        var ctxPairs = [];
                        for (var ck in l.ctx) {
                            if (Object.prototype.hasOwnProperty.call(l.ctx, ck) && l.ctx[ck]) {
                                ctxPairs.push('<span style="color:var(--neon-gold);">' + escapeHtml(ck) + '</span>=' + escapeHtml(String(l.ctx[ck])));
                            }
                        }
                        if (ctxPairs.length) {
                            ctxHtml = '<div style="font-size:0.58rem; color:var(--text-sub); margin-top:2px; padding:3px 6px; background:rgba(255,255,255,0.03); border-radius:3px; word-break:break-all;">' + ctxPairs.join(' · ') + '</div>';
                        }
                    }
                    return '<div class="log-entry">' +
                               '<span class="log-level" style="color:' + color + ';">[' + l.level + ']</span> ' +
                               '<span class="log-time">' + time + '</span>' +
                               '<div class="log-msg">' + escapeHtml(l.msg) + '</div>' +
                               ctxHtml +
                               stack +
                           '</div>';
                }).join('');
            }

            modal.classList.remove('d-none');
            modal.style.display = 'flex';
            AppLogger._refreshBadge();
        },

        /** 로그 카운트 뱃지 갱신 (설정 화면 + 로그인 전 화면) */
        _refreshBadge: function () {
            const cnt = AppLogger.count() + '개';
            const badge = document.getElementById('log-count-badge');
            if (badge) badge.textContent = cnt;
            const loginBadge = document.getElementById('login-log-badge');
            if (loginBadge) loginBadge.textContent = cnt;
        },

        /** 초기화: 인터셉터·핸들러 설치 및 앱 시작 로그 기록 */
        init: function () {
            interceptConsole();
            setupGlobalHandlers();
            addEntry('INFO', '[AppStart] LEVEL UP: REBOOT 시작', 'UA: ' + navigator.userAgent.substring(0, 120));
        }
    };

    // 전역 노출
    window.AppLogger = AppLogger;

    // DOM 준비 후 뱃지 갱신
    document.addEventListener('DOMContentLoaded', function () {
        AppLogger._refreshBadge();
    });

    // 즉시 초기화 (스크립트 로드 시점에 핸들러 등록)
    AppLogger.init();

})();
