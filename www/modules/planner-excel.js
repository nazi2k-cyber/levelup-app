// ===== 플래너 Excel 내보내기/가져오기 모듈 =====
(function() {
    'use strict';

    const AppState  = window.AppState;
    const i18n      = window.i18n;
    const AppLogger = window.AppLogger;

    const XLSX_CDN = 'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js';
    let _xlsxLoaded = false;
    let _xlsxLoading = false;

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
        return new Promise((resolve, reject) => {
            if (_xlsxLoaded) { resolve(); return; }
            if (_xlsxLoading) {
                const check = setInterval(() => {
                    if (_xlsxLoaded) { clearInterval(check); resolve(); }
                }, 100);
                return;
            }
            _xlsxLoading = true;
            const s = document.createElement('script');
            s.id = 'sheetjs-cdn';
            s.src = XLSX_CDN;
            s.onload = () => { _xlsxLoaded = true; _xlsxLoading = false; resolve(); };
            s.onerror = () => { _xlsxLoading = false; reject(new Error('SheetJS load failed')); };
            document.head.appendChild(s);
        });
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

            const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
            ws['!cols'] = [
                { wch: 12 }, { wch: 10 }, { wch: 12 },
                { wch: 30 }, { wch: 35 }, { wch: 40 }
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Planner');

            const today = window.getTodayStr ? window.getTodayStr() : new Date().toISOString().slice(0, 10);
            XLSX.writeFile(wb, `levelup_planner_${today}.xlsx`);

            if (AppLogger) AppLogger.log('[PlannerExcel] exported', dates.length, 'entries');
        }).catch(err => {
            if (AppLogger) AppLogger.error('[PlannerExcel] export error', err);
            notify(t('excel_import_error'));
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
                    if (AppLogger) AppLogger.log('[PlannerExcel] imported', count, 'entries');
                } catch (err) {
                    if (AppLogger) AppLogger.error('[PlannerExcel] import parse error', err);
                    notify(t('excel_import_error'));
                }
            };
            reader.onerror = () => notify(t('excel_import_error'));
            reader.readAsArrayBuffer(file);
        }).catch(() => {
            notify(t('excel_lib_loading'));
        });
    }

    function initPlannerExcel() {
        const exportBtn = document.getElementById('btn-excel-export');
        if (exportBtn) exportBtn.addEventListener('click', exportPlannerToExcel);

        const importBtn = document.getElementById('btn-excel-import');
        const fileInput = document.getElementById('plannerExcelUpload');
        if (importBtn && fileInput) {
            importBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) { importPlannerFromExcel(file); fileInput.value = ''; }
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
})();
