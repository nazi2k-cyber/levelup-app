export function createPlannerDomainModule(deps) {
    const {
        AppState,
        i18n,
        isNativePlatform,
        getTodayStr,
        getDiaryEntry,
        getAllDiaryEntries,
        getDiarySelectedDate,
        setDiarySelectedDate,
        getPlannerWeekOffset,
        setPlannerWeekOffset,
        getMonthlyCalendarYear,
        setMonthlyCalendarYear,
        getMonthlyCalendarMonth,
        setMonthlyCalendarMonth,
        getMonthlyCalendarUnlocked,
        setMonthlyCalendarUnlocked,
        selectPlannerDate,
        loadPlannerForDate,
        updateApplyTodayButton,
        getPlannerPhotoData,
        setPlannerPhotoData,
        getPlannerPhotoBase64,
        setPlannerPhotoBase64,
        getPlannerPhotoCompressing,
        setPlannerPhotoCompressing,
    } = deps;

    function dateToStr(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function renderPlannerCalendar() {
        const container = document.getElementById('planner-calendar-grid');
        if (!container) return;

        const today = new Date();
        const todayStr = dateToStr(today);
        const currentDay = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - currentDay + (getPlannerWeekOffset() * 7));

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthEl = document.getElementById('planner-cal-month');
        if (monthEl) monthEl.innerText = `${startOfWeek.getFullYear()} ${monthNames[startOfWeek.getMonth()]}`;

        const dayNames = {
            ko: ['일', '월', '화', '수', '목', '금', '토'],
            en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            ja: ['日', '月', '火', '水', '木', '金', '土'],
        };

        const allEntries = getAllDiaryEntries();
        const selectedDate = getDiarySelectedDate();

        container.innerHTML = Array.from({ length: 7 }, (_, i) => {
            const iterDate = new Date(startOfWeek);
            iterDate.setDate(startOfWeek.getDate() + i);
            const dateStr = dateToStr(iterDate);
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const entry = allEntries[dateStr];
            const hasEntry = entry && (entry.blocks ? Object.keys(entry.blocks).length > 0 : entry.text);

            return `
                <div class="cal-day ${isToday ? 'today' : ''} ${isSelected ? 'planner-selected' : ''}"
                     onclick="window.selectPlannerDate('${dateStr}')" style="cursor:pointer;">
                    <div class="cal-name">${dayNames[AppState.currentLang][i]}</div>
                    <div class="cal-date">${iterDate.getDate()}</div>
                    <div class="cal-score">${hasEntry ? '✓' : '·'}</div>
                </div>
            `;
        }).join('');
    }

    function changePlannerWeek(delta) {
        setPlannerWeekOffset(getPlannerWeekOffset() + delta);
        renderPlannerCalendar();
    }

    function renderMonthlyCalendar(year, month) {
        const container = document.getElementById('monthly-calendar-grid');
        if (!container) return;

        const lang = AppState.currentLang;
        const today = new Date();
        const todayStr = dateToStr(today);

        const monthNames = {
            ko: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
            en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
            ja: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
        };
        const dayNames = {
            ko: ['일', '월', '화', '수', '목', '금', '토'],
            en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
            ja: ['日', '月', '火', '水', '木', '金', '土'],
        };

        const titleEl = document.getElementById('monthly-cal-title');
        if (titleEl) titleEl.innerText = `${year} ${(monthNames[lang] || monthNames.en)[month]}`;

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const allEntries = getAllDiaryEntries();
        const selectedDate = getDiarySelectedDate();

        let headerHTML = '<div class="monthly-cal-header">';
        (dayNames[lang] || dayNames.en).forEach((d) => { headerHTML += `<span>${d}</span>`; });
        headerHTML += '</div>';

        let gridHTML = '<div class="monthly-cal-grid">';
        for (let i = 0; i < firstDay; i++) gridHTML += '<div class="monthly-cal-day empty"></div>';

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const entry = allEntries[dateStr];
            const hasEntry = entry && (entry.blocks ? Object.keys(entry.blocks).length > 0 : entry.text);
            const classes = ['monthly-cal-day'];
            if (isToday) classes.push('today');
            if (isSelected) classes.push('selected');
            if (hasEntry) classes.push('has-entry');
            gridHTML += `<div class="${classes.join(' ')}" onclick="window.selectMonthlyDate('${dateStr}')">${d}</div>`;
        }

        gridHTML += '</div>';
        container.innerHTML = headerHTML + gridHTML;
    }

    function selectMonthlyDate(dateStr) {
        const selected = new Date(`${dateStr}T00:00:00`);
        const today = new Date();
        const todayStart = new Date(today);
        todayStart.setDate(today.getDate() - today.getDay());
        todayStart.setHours(0, 0, 0, 0);

        const selectedStart = new Date(selected);
        selectedStart.setDate(selected.getDate() - selected.getDay());
        selectedStart.setHours(0, 0, 0, 0);
        const diffDays = Math.round((selectedStart - todayStart) / (1000 * 60 * 60 * 24));

        setPlannerWeekOffset(Math.round(diffDays / 7));
        selectPlannerDate(dateStr);
        renderMonthlyCalendar(getMonthlyCalendarYear(), getMonthlyCalendarMonth());
    }

    function changeMonthlyCalendar(delta) {
        let month = getMonthlyCalendarMonth() + delta;
        let year = getMonthlyCalendarYear();
        if (month > 11) { month = 0; year += 1; }
        if (month < 0) { month = 11; year -= 1; }
        setMonthlyCalendarMonth(month);
        setMonthlyCalendarYear(year);
        renderMonthlyCalendar(year, month);
    }

    function _showMonthlyCalendar() {
        const now = new Date();
        setMonthlyCalendarYear(now.getFullYear());
        setMonthlyCalendarMonth(now.getMonth());
        renderMonthlyCalendar(getMonthlyCalendarYear(), getMonthlyCalendarMonth());

        const weeklyCard = document.getElementById('weekly-calendar-card');
        const monthlyCard = document.getElementById('monthly-calendar-card');
        if (weeklyCard) weeklyCard.classList.add('d-none');
        if (monthlyCard) monthlyCard.classList.remove('d-none');
    }

    async function openMonthlyCalendar() {
        const lang = AppState.currentLang;
        const todayStr = getTodayStr();
        const adDate = localStorage.getItem('monthly_cal_ad_date');
        if (adDate === todayStr || getMonthlyCalendarUnlocked()) {
            _showMonthlyCalendar();
            return;
        }

        if (!isNativePlatform) {
            setMonthlyCalendarUnlocked(true);
            localStorage.setItem('monthly_cal_ad_date', todayStr);
            _showMonthlyCalendar();
            return;
        }

        if (!window.AdManager) {
            alert(i18n[lang].monthly_cal_ad_fail);
            return;
        }

        const adShown = await window.AdManager.showRewarded({
            context: 'monthlyCalendar',
            onSuccess: () => {
                setMonthlyCalendarUnlocked(true);
                localStorage.setItem('monthly_cal_ad_date', todayStr);
                _showMonthlyCalendar();
                if (window.AppLogger) window.AppLogger.info('[MonthlyCalendar] 보상형 광고 시청 완료 → 월간 캘린더 해제');
            },
            onFail: () => alert(i18n[lang].monthly_cal_ad_fail),
        });
        if (!adShown) alert(i18n[lang].monthly_cal_ad_fail);
    }

    function closeMonthlyCalendar() {
        const weeklyCard = document.getElementById('weekly-calendar-card');
        const monthlyCard = document.getElementById('monthly-calendar-card');
        if (weeklyCard) weeklyCard.classList.remove('d-none');
        if (monthlyCard) monthlyCard.classList.add('d-none');
        renderPlannerCalendar();
    }

    async function syncPlannerPhotoFromSaved(savedPhoto) {
        if (!savedPhoto) return;

        if (!window.isBase64Image(savedPhoto) && savedPhoto.startsWith('http')) {
            fetch(savedPhoto).then((r) => r.blob()).then((blob) => {
                const reader = new FileReader();
                reader.onloadend = () => setPlannerPhotoBase64(reader.result);
                reader.readAsDataURL(blob);
            }).catch(() => {});
        }

        if (window.isBase64Image(savedPhoto) && window._auth?.currentUser) {
            const migDateStr = getDiarySelectedDate();
            window.uploadImageToStorage(`planner_photos/${window._auth.currentUser.uid}/${migDateStr}.jpg`, savedPhoto)
                .then((url) => {
                    try {
                        const diaries = JSON.parse(localStorage.getItem('diary_entries') || '{}');
                        if (diaries[migDateStr]) {
                            diaries[migDateStr].photo = url;
                            localStorage.setItem('diary_entries', JSON.stringify(diaries));
                            setPlannerPhotoData(url);
                            if (window.AppLogger) window.AppLogger.info('[Planner] base64→Storage 마이그레이션 완료: ' + migDateStr);
                        }
                    } catch (e) {}
                })
                .catch(() => {});
        }
    }

    function applyPlannerPhotoUI(photoSrc) {
        const preview = document.getElementById('planner-photo-preview');
        const placeholder = document.getElementById('planner-photo-placeholder');
        const removeBtn = document.getElementById('planner-photo-remove');

        if (photoSrc) {
            if (preview) {
                if (photoSrc.startsWith('http')) {
                    preview.onerror = function() {
                        this.onerror = null;
                        window._retryFirebaseImg(this, photoSrc);
                    };
                }
                preview.src = photoSrc;
                preview.classList.remove('d-none');
            }
            if (placeholder) placeholder.classList.add('d-none');
            if (removeBtn) removeBtn.classList.remove('d-none');
            return;
        }

        if (preview) {
            preview.classList.add('d-none');
            preview.removeAttribute('src');
        }
        if (placeholder) placeholder.classList.remove('d-none');
        if (removeBtn) removeBtn.classList.add('d-none');

        const fileInput = document.getElementById('plannerPhotoUpload');
        if (fileInput) fileInput.value = '';
    }

    function loadPlannerPhoto(e) {
        const file = e.target.files[0];
        if (!file || getPlannerPhotoCompressing()) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = async () => {
                setPlannerPhotoCompressing(true);
                try {
                    const canvas = document.createElement('canvas');
                    const maxSize = 480;
                    let w = img.width;
                    let h = img.height;
                    if (w > maxSize || h > maxSize) {
                        if (w > h) {
                            h = Math.round((h * maxSize) / w);
                            w = maxSize;
                        } else {
                            w = Math.round((w * maxSize) / h);
                            h = maxSize;
                        }
                    }
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    const { dataURL } = await window.compressToTargetSize(canvas, 1200 * 1024, 0.7, 0.2);
                    setPlannerPhotoData(dataURL);
                    setPlannerPhotoBase64(dataURL);
                    applyPlannerPhotoUI(dataURL);
                } finally {
                    setPlannerPhotoCompressing(false);
                }
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    function removePlannerPhoto() {
        setPlannerPhotoData(null);
        setPlannerPhotoBase64(null);
        applyPlannerPhotoUI(null);
    }

    function getCaptionByteLength(str) {
        let len = 0;
        for (let i = 0; i < str.length; i++) len += str.charCodeAt(i) > 127 ? 2 : 1;
        return len;
    }

    function updateCaptionCounter() {
        const textarea = document.getElementById('planner-caption');
        const counter = document.getElementById('planner-caption-counter');
        if (!textarea || !counter) return;

        let text = textarea.value;
        const maxBytes = 280;
        if (getCaptionByteLength(text) > maxBytes) {
            let trimmed = '';
            let currentLen = 0;
            for (let i = 0; i < text.length; i++) {
                const charLen = text.charCodeAt(i) > 127 ? 2 : 1;
                if (currentLen + charLen > maxBytes) break;
                trimmed += text[i];
                currentLen += charLen;
            }
            textarea.value = trimmed;
            text = trimmed;
        }

        const used = getCaptionByteLength(text);
        const koEquiv = Math.ceil(used / 2);
        counter.innerText = `${koEquiv} / 140`;
        counter.style.color = used >= maxBytes * 0.9 ? 'var(--neon-red)' : 'var(--text-sub)';
    }

    function bindWindowHandlers() {
        window.changePlannerWeek = changePlannerWeek;
        window.selectMonthlyDate = selectMonthlyDate;
        window.changeMonthlyCalendar = changeMonthlyCalendar;
        window.openMonthlyCalendar = openMonthlyCalendar;
        window.closeMonthlyCalendar = closeMonthlyCalendar;
        window.removePlannerPhoto = removePlannerPhoto;
        window.updateCaptionCounter = updateCaptionCounter;
    }

    return {
        bindWindowHandlers,
        renderPlannerCalendar,
        changePlannerWeek,
        renderMonthlyCalendar,
        selectMonthlyDate,
        changeMonthlyCalendar,
        openMonthlyCalendar,
        closeMonthlyCalendar,
        loadPlannerPhoto,
        removePlannerPhoto,
        updateCaptionCounter,
        applyPlannerPhotoUI,
        syncPlannerPhotoFromSaved,
    };
}
