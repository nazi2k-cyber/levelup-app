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
        let saved = false;

        if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
            const Filesystem = window.Capacitor.Plugins.Filesystem;
            try {
                const base64Data = await blobToBase64(blob);
                const dirs = ['DOCUMENTS', 'EXTERNAL', 'CACHE'];
                for (const dir of dirs) {
                    try {
                        const result = await Filesystem.writeFile({
                            path: filename,
                            data: base64Data,
                            directory: dir,
                            recursive: true
                        });
                        if (result && result.uri) {
                            console.log('[PlannerExcel] 파일 저장 성공:', result.uri);
                        }
                        saved = true;
                        break;
                    } catch (dirErr) {
                        console.warn('[PlannerExcel] Filesystem 저장 실패:', dir, dirErr);
                    }
                }
            } catch (fsErr) {
                console.warn('[PlannerExcel] Filesystem 저장 준비 실패:', fsErr);
            }
        }

        if (!saved && navigator.share && navigator.canShare) {
            try {
                const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
                const shareData = { files: [file] };
                if (navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                    saved = true;
                }
            } catch (shareErr) {
                if (shareErr && shareErr.name === 'AbortError') {
                    saved = true;
                } else {
                    console.warn('[PlannerExcel] Share API 실패:', shareErr);
                }
            }
        }

        if (!saved) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 300);
            saved = true;
        }

        if (!saved) throw new Error('download failed');
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

    function exportPlannerToExcel() {
        const entries = window.getAllDiaryEntries ? window.getAllDiaryEntries() : {};
        const dates = Object.keys(entries).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

        if (dates.length === 0) {
            notify(t('excel_no_data'));
            return;
        }

        loadXlsx().then(() => {
            const XLSX = window.XLSX;
            const header = ['Date', 'Mood', 'Category', 'Caption', 'Tasks', 'Schedule'];
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

            const wb = buildWorkbook(header, rows, 'Planner');
            const today = window.getTodayStr ? window.getTodayStr() : new Date().toISOString().slice(0, 10);
            const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            return downloadBlob(blob, `levelup_planner_${today}.xlsx`).then(() => {
                if (AppLogger && typeof AppLogger.info === 'function') {
                    AppLogger.info(`[PlannerExcel] exported ${dates.length} entries`);
                }
            });
        }).catch(err => {
            console.error('[PlannerExcel] export error', err);
            if (AppLogger) AppLogger.error('[PlannerExcel] export error', err);
            notify(t('excel_export_error'));
        });
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
        }).catch(err => {
            console.error('[PlannerExcel] template error', err);
            if (AppLogger) AppLogger.error('[PlannerExcel] template error', err);
            notify(t('excel_export_error'));
        });
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

    function importPlannerFromExcel(file) {
        loadXlsx().then(() => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const XLSX = window.XLSX;
                    const wb = XLSX.read(e.target.result, { type: 'array' });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

                    if (rows.length < 2) { notify(t('excel_import_empty')); return; }

                    const header = rows[0].map(h => String(h).toLowerCase());
                    const colDate     = header.findIndex(h => h.includes('date'));
                    const colMood     = header.findIndex(h => h.includes('mood'));
                    const colCategory = header.findIndex(h => h.includes('category') || h.includes('cat'));
                    const colCaption  = header.findIndex(h => h.includes('caption'));
                    const colTasks    = header.findIndex(h => h.includes('task'));
                    const colSchedule = header.findIndex(h => h.includes('schedule') || h.includes('block'));

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
        if (exportBtn) exportBtn.addEventListener('click', exportPlannerToExcel);

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
                    importPlannerFromExcel(fileToImport);
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
    window.importPlannerFromExcel = importPlannerFromExcel;
    window.openExcelImportModal = openExcelImportModal;
    window.closeExcelImportModal = closeExcelImportModal;
})();
