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

    function addEntry(level, message, stack) {
        try {
            const logs = getLogs();
            logs.push({
                ts:    timestamp(),
                level: level,
                msg:   truncate(message, MSG_MAX_LEN),
                stack: truncate(stack, STACK_MAX_LEN) || null,
                env:   window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
                           ? 'native' : 'web'
            });
            // 오래된 항목 제거 (FIFO rotation)
            if (logs.length > MAX_ENTRIES) {
                logs.splice(0, logs.length - MAX_ENTRIES);
            }
            saveLogs(logs);
        } catch (_) { /* 로깅 자체 오류는 무시 */ }
    }

    // ── console 메서드 인터셉트 ────────────────────────────
    function interceptConsole() {
        const _error = console.error.bind(console);
        const _warn  = console.warn.bind(console);

        console.error = function (...args) {
            _error(...args);
            const msg = args.map(a => {
                if (a instanceof Error) return a.message;
                return typeof a === 'object' ? JSON.stringify(a) : String(a);
            }).join(' ');
            const stack = args.find(a => a instanceof Error)?.stack || '';
            addEntry('ERROR', msg, stack);
        };

        console.warn = function (...args) {
            _warn(...args);
            addEntry('WARN', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), '');
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

        /** 최근 N개 로그를 최신순으로 반환 */
        getRecent: function (n) {
            const logs = getLogs();
            return logs.slice(-Math.min(n || 100, logs.length)).reverse();
        },

        /** 저장된 로그 수 */
        count: function () { return getLogs().length; },

        /** 로그를 .txt 파일로 다운로드 */
        export: function () {
            const logs = getLogs();
            if (!logs.length) { alert('저장된 로그가 없습니다.'); return; }

            const lines = logs.map(function (l) {
                let line = '[' + l.ts + '] [' + l.level + '] [' + l.env + '] ' + l.msg;
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

            const blob = new Blob([header + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'levelup-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            AppLogger.info('[LogExport] 로그 파일 내보내기 완료 (' + logs.length + '개)');
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
                    const stack    = l.stack ? '<div style="font-size:0.6rem; color:var(--text-sub); margin-top:2px; word-break:break-all;">' + l.stack.substring(0, 200) + '</div>' : '';
                    return '<div class="log-entry">' +
                               '<span class="log-level" style="color:' + color + ';">[' + l.level + ']</span> ' +
                               '<span class="log-time">' + time + '</span>' +
                               '<div class="log-msg">' + l.msg + '</div>' +
                               stack +
                           '</div>';
                }).join('');
            }

            modal.classList.remove('d-none');
            modal.style.display = 'flex';
            AppLogger._refreshBadge();
        },

        /** 설정 화면의 로그 카운트 뱃지 갱신 */
        _refreshBadge: function () {
            const badge = document.getElementById('log-count-badge');
            if (badge) badge.textContent = AppLogger.count() + '개';
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
