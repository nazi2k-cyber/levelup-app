// ===== 플래너 Excel 내보내기/가져오기 모듈 =====
(function() {
    'use strict';

    const AppState  = window.AppState;
    const i18n      = window.i18n;
    const AppLogger = window.AppLogger;

    const XLSX_CDN_URLS = [
        'lib/xlsx.full.min.js',
        'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
        'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    ];
    let _xlsxLoaded = false;
    let _xlsxLoading = false;
    let _xlsxLoadPromise = null;
    let _selectedFile = null;

    function getLang() {
        return (AppState && AppState.currentLang) || 'ko';
    }

    function t(key, replacements) {
        const lang = getLang();
        let msg = (i18n[lang] && i18n[lang][key]) || key;
        if (replacements) {
            Object.keys(replacements).forEach(k => {
                msg = msg.replace('{' + k + '}', replacements[k]);
            });
        }
        return msg;
    }

    function notify(msg) {
        if (window.showInAppNotification) {
            window.showInAppNotification(msg);
        } else {
            alert(msg);
        }
    }

    function buildNativeExportErrorMessage(logs) {
        const hasFilesystemMissing = logs.some(l => l.stage === 'filesystem' && l.code === 'MISSING');
        const hasFilesystemWriteFail = logs.some(l => l.stage === 'filesystem' && l.code === 'WRITE_FAIL');
        const hasShareMissing = logs.some(l => l.stage === 'share_plugin' && l.code === 'UNSUPPORTED');
        const hasNavigatorMissing = logs.some(l => l.stage === 'navigator_share' && l.code === 'UNSUPPORTED');
        const hasBridgeMissing = logs.some(l => l.stage === 'native_bridge' && l.code === 'UNSUPPORTED');
        const hasFsFallbackFail = logs.some(l => l.stage === 'filesystem_fallback' && l.code === 'FAIL');

        if (hasShareMissing && hasNavigatorMissing && hasBridgeMissing && hasFsFallbackFail) {
            return '모든 내보내기 방법이 실패했어요. 파일 공유 플러그인(Share/File Opener) 설치 여부와 외부 저장소 권한을 확인해주세요.';
        }
        if (hasShareMissing && hasNavigatorMissing && hasBridgeMissing) {
            return '파일 공유 플러그인(Share/File Opener)이 설치되지 않았거나 비활성화되어 있어요. 앱 설정/빌드 구성을 확인해주세요.';
        }
        if (hasFilesystemMissing || hasFilesystemWriteFail) {
            return '파일 저장소 권한 또는 Filesystem 플러그인 문제로 파일을 준비하지 못했어요. 저장소 권한과 앱 플러그인 설정을 확인해주세요.';
        }
        return '파일 내보내기에 실패했어요. 파일 공유 플러그인 설치 여부, 저장소 권한, WebView 환경(Android/iOS)을 확인해주세요.';
    }

    function handleExcelExportError(contextLabel, err) {
        const defaultMessage = t('excel_export_error');
        if (err && err.userMessage) {
            notify(err.userMessage);
            return;
        }
        console.error(`[PlannerExcel] ${contextLabel} error`, err);
        if (AppLogger) AppLogger.error(`[PlannerExcel] ${contextLabel} error`, err);
        notify(defaultMessage);
    }

    function loadXlsx() {
        if (window.XLSX) {
            _xlsxLoaded = true;
            _xlsxLoading = false;
            return Promise.resolve();
        }
        if (_xlsxLoaded) return Promise.resolve();
        if (_xlsxLoadPromise) return _xlsxLoadPromise;

        _xlsxLoading = true;
        _xlsxLoadPromise = new Promise((resolve, reject) => {
            const tryLoad = (idx) => {
                if (window.XLSX) {
                    _xlsxLoaded = true;
                    _xlsxLoading = false;
                    resolve();
                    return;
                }
                if (idx >= XLSX_CDN_URLS.length) {
                    _xlsxLoading = false;
                    _xlsxLoadPromise = null;
                    reject(new Error('SheetJS load failed from all CDNs'));
                    return;
                }

                const scriptId = `sheetjs-cdn-${idx}`;
                const stale = document.getElementById(scriptId);
                if (stale) stale.remove();

                const s = document.createElement('script');
                s.id = scriptId;
                s.src = XLSX_CDN_URLS[idx];
                s.async = true;
                console.log('[PlannerExcel] xlsx 로드 시도:', XLSX_CDN_URLS[idx]);
                if (XLSX_CDN_URLS[idx].startsWith('http')) {
                    s.crossOrigin = 'anonymous';
                }
                s.onload = () => {
                    if (window.XLSX) {
                        console.log('[PlannerExcel] xlsx 로드 성공:', XLSX_CDN_URLS[idx]);
                        _xlsxLoaded = true;
                        _xlsxLoading = false;
                        resolve();
                    } else {
                        s.remove();
                        tryLoad(idx + 1);
                    }
                };
                s.onerror = () => {
                    console.warn('[PlannerExcel] xlsx 로드 실패:', XLSX_CDN_URLS[idx]);
                    s.remove();
                    tryLoad(idx + 1);
                };
                document.head.appendChild(s);
            };

            tryLoad(0);
        });

        return _xlsxLoadPromise;
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result;
                if (typeof result !== 'string' || result.indexOf(',') === -1) {
                    reject(new Error('blobToBase64 failed'));
                    return;
                }
                resolve(result.split(',')[1]);
            };
            reader.onerror = () => reject(reader.error || new Error('blobToBase64 read error'));
            reader.readAsDataURL(blob);
        });
    }

    async function downloadBlob(blob, filename) {
        const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
        if (!isNative) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 300);
            return;
        }

        // Native(WebView): 단순 anchor 다운로드는 동작하지 않는 경우가 많음
        // 1) 앱 내부 저장소에 파일 작성 2) 공유 시트로 내보내기
        const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
        const SharePlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
        const FileOpenerPlugin = window.Capacitor && window.Capacitor.Plugins && (window.Capacitor.Plugins.FileOpener || window.Capacitor.Plugins.FileOpener2);
        let savedUri = '';
        const logs = [];

        if (Filesystem) {
            try {
                const base64Data = await blobToBase64(blob);
                const stampedName = `${Date.now()}_${filename}`;
                const result = await Filesystem.writeFile({
                    path: stampedName,
                    data: base64Data,
                    directory: 'CACHE',
                    recursive: true
                });
                savedUri = (result && result.uri) ? result.uri : '';
                logs.push({ stage: 'filesystem', code: 'SUCCESS', path: stampedName, uri: savedUri || null });
                console.log('[PlannerExcel] native export stage', logs[logs.length - 1]);
            } catch (fsErr) {
                logs.push({ stage: 'filesystem', code: 'WRITE_FAIL', reason: fsErr && fsErr.message ? fsErr.message : String(fsErr) });
                console.error('[PlannerExcel] native export stage', logs[logs.length - 1], fsErr);
            }
        } else {
            logs.push({ stage: 'filesystem', code: 'MISSING', reason: 'Filesystem plugin unavailable' });
            console.warn('[PlannerExcel] native export stage', logs[logs.length - 1]);
        }

        if (SharePlugin && typeof SharePlugin.share === 'function') {
            if (savedUri) {
                try {
                    await SharePlugin.share({
                        title: 'Planner Excel',
                        text: filename,
                        url: savedUri,
                        dialogTitle: '플래너 파일 내보내기'
                    });
                    logs.push({ stage: 'share_plugin', code: 'SUCCESS', via: 'uri' });
                    console.log('[PlannerExcel] native export stage', logs[logs.length - 1]);
                    return;
                } catch (shareErr) {
                    logs.push({ stage: 'share_plugin', code: 'SHARE_FAIL', reason: shareErr && shareErr.message ? shareErr.message : String(shareErr) });
                    console.error('[PlannerExcel] native export stage', logs[logs.length - 1], shareErr);
                }
            } else {
                logs.push({ stage: 'share_plugin', code: 'SKIP_NO_URI' });
                console.warn('[PlannerExcel] native export stage', logs[logs.length - 1]);
            }
        } else {
            logs.push({ stage: 'share_plugin', code: 'UNSUPPORTED' });
            console.warn('[PlannerExcel] native export stage', logs[logs.length - 1]);
        }

        if (FileOpenerPlugin && typeof FileOpenerPlugin.open === 'function' && savedUri) {
            try {
                await FileOpenerPlugin.open({
                    filePath: savedUri,
                    path: savedUri,
                    contentType: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                });
                logs.push({ stage: 'file_opener', code: 'SUCCESS' });
                console.log('[PlannerExcel] native export stage', logs[logs.length - 1]);
                return;
            } catch (openErr) {
                logs.push({ stage: 'file_opener', code: 'OPEN_FAIL', reason: openErr && openErr.message ? openErr.message : String(openErr) });
                console.error('[PlannerExcel] native export stage', logs[logs.length - 1], openErr);
            }
        } else if (!FileOpenerPlugin) {
            logs.push({ stage: 'file_opener', code: 'UNSUPPORTED' });
            console.warn('[PlannerExcel] native export stage', logs[logs.length - 1]);
        }

        if (navigator.share && navigator.canShare) {
            const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
            const shareData = { files: [file] };
            if (navigator.canShare(shareData)) {
                try {
                    await navigator.share(shareData);
                    logs.push({ stage: 'navigator_share', code: 'SUCCESS' });
                    console.log('[PlannerExcel] native export stage', logs[logs.length - 1]);
                    return;
                } catch (navErr) {
                    logs.push({ stage: 'navigator_share', code: 'SHARE_FAIL', reason: navErr && navErr.message ? navErr.message : String(navErr) });
                    console.error('[PlannerExcel] native export stage', logs[logs.length - 1], navErr);
                }
            }
            logs.push({ stage: 'navigator_share', code: 'CAN_SHARE_FALSE' });
            console.warn('[PlannerExcel] native export stage', logs[logs.length - 1]);
        } else {
            logs.push({ stage: 'navigator_share', code: 'UNSUPPORTED' });
            console.warn('[PlannerExcel] native export stage', logs[logs.length - 1]);
        }

        const customBridge = window.LevelUpNativeBridge || window.Android || window.webkit;
        if (customBridge) {
            try {
                if (window.LevelUpNativeBridge && typeof window.LevelUpNativeBridge.openFile === 'function') {
                    await Promise.resolve(window.LevelUpNativeBridge.openFile(savedUri || '', filename, blob.type || 'application/octet-stream'));
                    logs.push({ stage: 'native_bridge', code: 'SUCCESS', bridge: 'LevelUpNativeBridge.openFile' });
                    console.log('[PlannerExcel] native export stage', logs[logs.length - 1]);
                    return;
                }
                if (window.Android && typeof window.Android.openFile === 'function') {
                    await Promise.resolve(window.Android.openFile(savedUri || '', filename));
                    logs.push({ stage: 'native_bridge', code: 'SUCCESS', bridge: 'Android.openFile' });
                    console.log('[PlannerExcel] native export stage', logs[logs.length - 1]);
                    return;
                }
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openFile) {
                    window.webkit.messageHandlers.openFile.postMessage({ uri: savedUri || '', filename, mimeType: blob.type || 'application/octet-stream' });
                    logs.push({ stage: 'native_bridge', code: 'SUCCESS', bridge: 'webkit.messageHandlers.openFile' });
                    console.log('[PlannerExcel] native export stage', logs[logs.length - 1]);
                    return;
                }
                logs.push({ stage: 'native_bridge', code: 'UNSUPPORTED', reason: 'No callable method on detected bridge object' });
                console.warn('[PlannerExcel] native export stage', logs[logs.length - 1]);
            } catch (bridgeErr) {
                logs.push({ stage: 'native_bridge', code: 'BRIDGE_FAIL', reason: bridgeErr && bridgeErr.message ? bridgeErr.message : String(bridgeErr) });
                console.error('[PlannerExcel] native export stage', logs[logs.length - 1], bridgeErr);
            }
        } else {
            logs.push({ stage: 'native_bridge', code: 'UNSUPPORTED', reason: 'bridge object missing' });
            console.warn('[PlannerExcel] native export stage', logs[logs.length - 1]);
        }

        // Last resort: Filesystem write to a user-accessible directory.
        // Android WebView silently ignores data/blob URL anchor downloads, so we write the file
        // directly and notify the user where to find it.
        if (Filesystem) {
            let fsBase64;
            try { fsBase64 = await blobToBase64(blob); } catch (_b64) { /* fall through */ }
            if (fsBase64) {
                const fsTargets = [
                    { path: 'Download/' + filename, directory: 'EXTERNAL_STORAGE', label: '다운로드' },
                    { path: filename, directory: 'EXTERNAL', label: '파일 저장소' }
                ];
                for (const target of fsTargets) {
                    try {
                        await Filesystem.writeFile({ path: target.path, data: fsBase64, directory: target.directory, recursive: true });
                        logs.push({ stage: 'filesystem_fallback', code: 'SUCCESS', directory: target.directory });
                        console.log('[PlannerExcel] native export stage', logs[logs.length - 1]);
                        notify(target.label + '에 저장됐어요: ' + filename);
                        return;
                    } catch (fsErr) {
                        logs.push({ stage: 'filesystem_fallback', code: 'FAIL', directory: target.directory, reason: fsErr && fsErr.message ? fsErr.message : String(fsErr) });
                        console.warn('[PlannerExcel] native export stage', logs[logs.length - 1]);
                    }
                }
            }
        }

        const nativeError = new Error('native file export unavailable');
        nativeError.logs = logs;
        nativeError.userMessage = buildNativeExportErrorMessage(logs);
        throw nativeError;
    }

    function buildWorkbook(headerRow, dataRows, sheetName) {
        const XLSX = window.XLSX;
        const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
        ws['!cols'] = [
            { wch: 12 }, { wch: 10 }, { wch: 12 },
            { wch: 30 }, { wch: 35 }, { wch: 40 }
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        return wb;
    }

    function formatTasks(tasks) {
        if (!Array.isArray(tasks) || tasks.length === 0) return '';
        const ranked = tasks
            .filter(t => t.ranked)
            .sort((a, b) => (a.rankOrder || 0) - (b.rankOrder || 0));
        const unranked = tasks.filter(t => !t.ranked);
        const all = [...ranked, ...unranked];
        return all.map((t, i) => {
            const n = i + 1;
            return t.done ? `${n}. ${t.text} ✓` : `${n}. ${t.text}`;
        }).join('\n');
    }

    function formatBlocks(blocks) {
        if (!blocks || typeof blocks !== 'object') return '';
        return Object.keys(blocks)
            .sort()
            .filter(time => blocks[time] && blocks[time].trim())
            .map(time => `${time}: ${blocks[time]}`)
            .join('\n');
    }

    function getPlannerExportRows() {
        const entries = window.getAllDiaryEntries ? window.getAllDiaryEntries() : {};
        const dates = Object.keys(entries).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
        const rows = dates.map(date => {
            const e = entries[date];
            return [
                date,
                e.mood || '',
                e.category || '',
                e.caption || '',
                formatTasks(e.tasks),
                formatBlocks(e.blocks)
            ];
        });
        return { dates, rows };
    }

    function serializeCsvField(value) {
        const s = value == null ? '' : String(value);
        if (/[",\r\n]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    }

    function exportPlannerToCsv() {
        const header = ['Date', 'Mood', 'Category', 'Caption', 'Tasks', 'Schedule'];
        const { dates, rows } = getPlannerExportRows();
        if (dates.length === 0) {
            notify(t('excel_no_data'));
            return Promise.resolve(false);
        }

        const csvLines = [header, ...rows].map((row) => row.map(serializeCsvField).join(','));
        const csvContent = '\uFEFF' + csvLines.join('\r\n');
        const today = window.getTodayStr ? window.getTodayStr() : new Date().toISOString().slice(0, 10);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        return downloadBlob(blob, `levelup_planner_${today}.csv`).then(() => {
            if (AppLogger && typeof AppLogger.info === 'function') {
                AppLogger.info(`[PlannerExcel] exported ${dates.length} entries (csv)`);
            }
            return true;
        });
    }

    function exportPlannerToExcel() {
        const header = ['Date', 'Mood', 'Category', 'Caption', 'Tasks', 'Schedule'];
        const { dates, rows } = getPlannerExportRows();
        if (dates.length === 0) {
            notify(t('excel_no_data'));
            return;
        }

        loadXlsx().then(() => {
            const XLSX = window.XLSX;
            const wb = buildWorkbook(header, rows, 'Planner');
            const today = window.getTodayStr ? window.getTodayStr() : new Date().toISOString().slice(0, 10);
            const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            return downloadBlob(blob, `levelup_planner_${today}.xlsx`).then(() => {
                if (AppLogger && typeof AppLogger.info === 'function') {
                    AppLogger.info(`[PlannerExcel] exported ${dates.length} entries`);
                }
            });
        }).catch(err => handleExcelExportError('export', err));
    }

    function selectExportFormat() {
        const guide = '내보내기 형식을 선택하세요:\n1 = Excel(.xlsx)\n2 = CSV(.csv)';
        const answer = prompt(guide, '1');
        if (answer === null) return null;
        const normalized = String(answer).trim().toLowerCase();
        if (normalized === '2' || normalized === 'csv' || normalized === '.csv') return 'csv';
        return 'xlsx';
    }

    function exportPlanner() {
        const format = selectExportFormat();
        if (!format) return;
        const work = format === 'csv' ? exportPlannerToCsv() : exportPlannerToExcel();
        if (work && typeof work.catch === 'function') {
            work.catch(err => {
                console.error('[PlannerExcel] export error', err);
                if (AppLogger) AppLogger.error('[PlannerExcel] export error', err);
                notify(t('excel_export_error'));
            });
        }
    }

    function generateTemplateExcel() {
        loadXlsx().then(() => {
            const XLSX = window.XLSX;
            const header = ['Date', 'Mood', 'Category', 'Caption', 'Tasks', 'Schedule'];
            const example = [
                '2026-01-01',
                'great',
                '기타',
                '오늘 하루도 최고!',
                '1. 독서\n2. 운동 ✓',
                '09:00: 아침 루틴\n14:00: 미팅'
            ];

            const wb = buildWorkbook(header, [example], 'Planner');
            const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            return downloadBlob(blob, 'levelup_planner_template.xlsx').then(() => {
                if (AppLogger && typeof AppLogger.info === 'function') {
                    AppLogger.info('[PlannerExcel] template downloaded');
                }
            });
        }).catch(err => handleExcelExportError('template', err));
    }

    function parseTasks(cellValue) {
        if (!cellValue) return [];
        const lines = String(cellValue).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const tasks = [];
        lines.forEach((line, idx) => {
            const m = line.match(/^\d+\.\s*(.+?)(\s*✓)?$/);
            if (m) {
                tasks.push({
                    text: m[1].trim(),
                    ranked: true,
                    rankOrder: idx + 1,
                    done: !!m[2]
                });
            }
        });
        return tasks;
    }

    function parseBlocks(cellValue) {
        if (!cellValue) return {};
        const lines = String(cellValue).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const blocks = {};
        lines.forEach(line => {
            const m = line.match(/^(\d{2}:\d{2}):\s*(.+)$/);
            if (m) blocks[m[1]] = m[2].trim();
        });
        return blocks;
    }

    function parseCsvRows(csvText) {
        // RFC4180 기반 최소 규칙:
        // - 필드에 쉼표/줄바꿈/따옴표가 포함되면 반드시 쌍따옴표로 감싼다.
        // - 쌍따옴표 자체는 ""(두 개)로 이스케이프한다.
        // - 쌍따옴표 내부의 줄바꿈은 동일 필드 데이터로 유지한다.
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const next = csvText[i + 1];

            if (inQuotes) {
                if (char === '"' && next === '"') {
                    field += '"';
                    i++;
                } else if (char === '"') {
                    inQuotes = false;
                } else {
                    field += char;
                }
            } else if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                row.push(field);
                field = '';
            } else if (char === '\r') {
                if (next === '\n') i++;
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else if (char === '\n') {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else {
                field += char;
            }
        }

        row.push(field);
        rows.push(row);
        if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
            rows.pop();
        }
        return rows;
    }

    function importRows(rows) {
        if (rows.length < 2) { notify(t('excel_import_empty')); return; }

        const header = rows[0].map(h => String(h).toLowerCase().trim());
        const colDate     = header.findIndex(h => h === 'date' || h.includes('date'));
        const colMood     = header.findIndex(h => h === 'mood' || h.includes('mood'));
        const colCategory = header.findIndex(h => h === 'category' || h.includes('category') || h.includes('cat'));
        const colCaption  = header.findIndex(h => h === 'caption' || h.includes('caption'));
        const colTasks    = header.findIndex(h => h === 'tasks' || h.includes('task'));
        const colSchedule = header.findIndex(h => h === 'schedule' || h.includes('schedule') || h.includes('block'));

        if (colDate === -1) { notify(t('excel_import_error')); return; }

        let diaries = {};
        try { diaries = JSON.parse(localStorage.getItem('diary_entries') || '{}'); } catch (_) {}

        let count = 0;
        rows.slice(1).forEach(row => {
            const dateStr = String(row[colDate] || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;

            const existing = diaries[dateStr] || {};
            const newTasks  = colTasks    >= 0 ? parseTasks(row[colTasks])    : null;
            const newBlocks = colSchedule >= 0 ? parseBlocks(row[colSchedule]) : null;

            diaries[dateStr] = Object.assign({}, existing, {
                mood:     colMood     >= 0 && row[colMood]     ? String(row[colMood]).trim()     : (existing.mood || ''),
                category: colCategory >= 0 && row[colCategory] ? String(row[colCategory]).trim() : (existing.category || '기타'),
                caption:  colCaption  >= 0 && row[colCaption]  ? String(row[colCaption]).trim()  : (existing.caption || ''),
                tasks:    (newTasks  && newTasks.length  > 0) ? newTasks  : (existing.tasks  || []),
                blocks:   (newBlocks && Object.keys(newBlocks).length > 0) ? newBlocks : (existing.blocks || {}),
            });
            count++;
        });

        if (count === 0) { notify(t('excel_import_empty')); return; }

        localStorage.setItem('diary_entries', JSON.stringify(diaries));

        if (window.renderPlannerCalendar) window.renderPlannerCalendar();
        const currentDate = window.diarySelectedDate || (window.getTodayStr && window.getTodayStr());
        if (window.loadPlannerForDate && currentDate) window.loadPlannerForDate(currentDate);

        notify(t('excel_import_done', { count }));
        if (AppLogger && typeof AppLogger.info === 'function') {
            AppLogger.info(`[PlannerExcel] imported ${count} entries`);
        }
    }

    function importPlannerFromFile(file) {
        const ext = (file && file.name ? file.name.split('.').pop() : '').toLowerCase();
        if (ext === 'csv') {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    let text = String(e.target.result || '');
                    text = text.replace(/^\uFEFF/, '');
                    const rows = parseCsvRows(text);
                    importRows(rows);
                } catch (err) {
                    console.error('[PlannerExcel] csv import parse error', err);
                    if (AppLogger) AppLogger.error('[PlannerExcel] csv import parse error', err);
                    notify(t('excel_import_error'));
                }
            };
            reader.onerror = () => notify(t('excel_import_error'));
            reader.readAsText(file, 'utf-8');
            return;
        }

        loadXlsx().then(() => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const XLSX = window.XLSX;
                    const wb = XLSX.read(e.target.result, { type: 'array' });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                    importRows(rows);
                } catch (err) {
                    console.error('[PlannerExcel] import parse error', err);
                    if (AppLogger) AppLogger.error('[PlannerExcel] import parse error', err);
                    notify(t('excel_import_error'));
                }
            };
            reader.onerror = () => notify(t('excel_import_error'));
            reader.readAsArrayBuffer(file);
        }).catch(err => {
            console.error('[PlannerExcel] import library load error', err);
            if (AppLogger) AppLogger.error('[PlannerExcel] import library load error', err);
            notify(t('excel_import_error'));
        });
    }

    function openExcelImportModal() {
        const modal = document.getElementById('excel-import-modal');
        if (!modal) return;
        _selectedFile = null;
        const fileInput = document.getElementById('plannerExcelUpload');
        const filenameEl = document.getElementById('excel-import-filename');
        const confirmBtn = document.getElementById('btn-excel-import-confirm');
        if (fileInput) fileInput.value = '';
        if (filenameEl) filenameEl.textContent = '';
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.4';
            confirmBtn.style.cursor = 'not-allowed';
        }
        modal.classList.remove('d-none');
        modal.style.display = 'flex';
    }

    function closeExcelImportModal() {
        const modal = document.getElementById('excel-import-modal');
        if (!modal) return;
        modal.classList.add('d-none');
        modal.style.display = '';
        _selectedFile = null;
    }

    function initPlannerExcel() {
        loadXlsx().catch(err => {
            if (AppLogger) AppLogger.warn('[PlannerExcel] preload failed', err);
        });

        const exportBtn = document.getElementById('btn-excel-export');
        if (exportBtn) exportBtn.addEventListener('click', exportPlanner);

        const importBtn = document.getElementById('btn-excel-import');
        if (importBtn) importBtn.addEventListener('click', openExcelImportModal);

        const templateBtn = document.getElementById('btn-excel-template-download');
        if (templateBtn) templateBtn.addEventListener('click', generateTemplateExcel);

        const fileInput = document.getElementById('plannerExcelUpload');
        const filenameEl = document.getElementById('excel-import-filename');
        const confirmBtn = document.getElementById('btn-excel-import-confirm');

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) {
                    _selectedFile = file;
                    if (filenameEl) filenameEl.textContent = file.name;
                    if (confirmBtn) {
                        confirmBtn.disabled = false;
                        confirmBtn.style.opacity = '1';
                        confirmBtn.style.cursor = 'pointer';
                    }
                }
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                if (_selectedFile) {
                    const fileToImport = _selectedFile;
                    closeExcelImportModal();
                    importPlannerFromFile(fileToImport);
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPlannerExcel);
    } else {
        initPlannerExcel();
    }

    window.exportPlannerToExcel = exportPlannerToExcel;
    window.exportPlannerToCsv = exportPlannerToCsv;
    window.importPlannerFromFile = importPlannerFromFile;
    window.openExcelImportModal = openExcelImportModal;
    window.closeExcelImportModal = closeExcelImportModal;
})();
