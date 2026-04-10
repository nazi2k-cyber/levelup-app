// ========== Running Calculator ==========
(function() {
    'use strict';

    function getDateLocale() {
        var lang = window.AppState.currentLang || 'ko';
        return lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-US' : 'ko-KR';
    }

    let _paceMode = 'pace'; // 'pace' | 'distance' | 'time'
    let _rcUserInteracted = false; // Track if user modified inputs

    // --- Overlay open/close ---
    window.openRunningCalcView = function() {
        const overlay = document.getElementById('running-calc-overlay');
        if (overlay) overlay.classList.remove('d-none');
        _rcUserInteracted = false;
        window.calcPace();
        window.calcTreadmill();
        renderRcHistory();
    };
    window.closeRunningCalcView = function() {
        const overlay = document.getElementById('running-calc-overlay');
        if (overlay) overlay.classList.add('d-none');
        // Save current calculation to history only if user interacted
        if (_rcUserInteracted && window.saveRunningCalcHistory) window.saveRunningCalcHistory();
        _rcUserInteracted = false;
        updateSummaryCard();
    };

    // --- Main tab switching ---
    window.switchRunningCalcTab = function(tab) {
        document.querySelectorAll('.rc-main-tab').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.rcTab === tab);
        });
        document.querySelectorAll('.rc-tab-panel').forEach(function(panel) {
            panel.classList.remove('active');
        });
        var panel = document.getElementById('rc-panel-' + tab);
        if (panel) panel.classList.add('active');
        if (tab === 'vdot') window.calcVDOT();
        if (tab === 'treadmill') window.calcTreadmill();
    };

    // --- Pace sub-tab switching ---
    window.switchPaceMode = function(mode) {
        _paceMode = mode;
        document.querySelectorAll('.rc-sub-tab').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.calcMode === mode);
        });
        var distGroup = document.getElementById('rc-pace-distance-group');
        var timeGroup = document.getElementById('rc-pace-time-group');
        var paceGroup = document.getElementById('rc-pace-pace-group');
        var resDistRow = document.getElementById('rc-res-distance-row');
        var resTimeRow = document.getElementById('rc-res-time-row');
        var resultsBox = document.getElementById('rc-pace-results');
        // Show/hide inputs and result rows based on mode
        if (mode === 'pace') {
            distGroup.classList.remove('d-none');
            timeGroup.classList.remove('d-none');
            paceGroup.classList.add('d-none');
            resDistRow.classList.add('d-none');
            resTimeRow.classList.add('d-none');
            resultsBox.classList.remove('d-none');
        } else if (mode === 'distance') {
            distGroup.classList.add('d-none');
            timeGroup.classList.remove('d-none');
            paceGroup.classList.remove('d-none');
            resDistRow.classList.remove('d-none');
            resTimeRow.classList.add('d-none');
            resultsBox.classList.add('d-none');
        } else { // time
            distGroup.classList.remove('d-none');
            timeGroup.classList.add('d-none');
            paceGroup.classList.remove('d-none');
            resDistRow.classList.add('d-none');
            resTimeRow.classList.remove('d-none');
            resultsBox.classList.add('d-none');
            // Reset distance to default 10 if it was modified by distance mode calc
            var distEl = document.getElementById('rc-pace-distance');
            var distVal = parseFloat(distEl.value);
            var currentPresets = _rcDisplayUnit === 'mi' ? _getRcPresetsMi() : _getRcPresetsKm();
            var isPreset = currentPresets.some(function(p) { return Math.abs(p.val - distVal) < 0.01; });
            if (!isPreset) {
                distEl.value = _rcDisplayUnit === 'mi' ? 6.2 : 10;
                window.onPaceDistInput();
            }
        }
        window.calcPace();
    };

    // --- Input validation ---
    window.rcValidateInput = function(el, type) {
        _rcUserInteracted = true;
        var val = parseInt(el.value) || 0;
        if (type === 'hr' && val > 24) val = 0;
        else if (type === 'min' && val > 59) val = 0;
        else if (type === 'sec' && val > 59) val = 0;
        if (val < 0) val = 0;
        el.value = val;
        var id = el.id || '';
        if (id.indexOf('vdot') !== -1) window.calcVDOT();
        else window.calcPace();
    };

    // --- Adjust +/- buttons ---
    window.rcAdjust = function(field, delta) {
        _rcUserInteracted = true;
        var el = document.getElementById('rc-' + field);
        if (!el) return;
        var val = parseInt(el.value) + delta;
        // Clamp values
        if (field.indexOf('hr') !== -1) { if (val > 24) val = 0; if (val < 0) val = 24; }
        else if (field.indexOf('min') !== -1) { if (val > 59) val = 0; if (val < 0) val = 59; }
        else if (field.indexOf('sec') !== -1) { if (val > 59) val = 0; if (val < 0) val = 59; }
        el.value = val;
        // Trigger calc
        if (field.indexOf('vdot') !== -1) window.calcVDOT();
        else window.calcPace();
    };

    // --- Long-press acceleration for +/- buttons (event delegation) ---
    (function() {
        var holdTimer = null;
        var holdInterval = null;
        var HOLD_DELAY = 400;
        var INITIAL_SPEED = 150;
        var MIN_SPEED = 30;
        var ACCEL_STEP = 20;

        function getFieldAndDelta(el) {
            var btn = el.closest('.rc-time-btn[data-field]');
            if (!btn) return null;
            return { field: btn.getAttribute('data-field'), delta: parseInt(btn.getAttribute('data-delta')) };
        }

        function startHold(field, delta) {
            stopHold();
            var speed = INITIAL_SPEED;
            holdTimer = setTimeout(function repeat() {
                window.rcAdjust(field, delta);
                speed = Math.max(MIN_SPEED, speed - ACCEL_STEP);
                holdInterval = setTimeout(repeat, speed);
            }, HOLD_DELAY);
        }

        function stopHold() {
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
            if (holdInterval) { clearTimeout(holdInterval); holdInterval = null; }
        }

        document.addEventListener('click', function(e) {
            var info = getFieldAndDelta(e.target);
            if (info) window.rcAdjust(info.field, info.delta);
        });
        document.addEventListener('mousedown', function(e) {
            var info = getFieldAndDelta(e.target);
            if (info) { e.preventDefault(); startHold(info.field, info.delta); }
        });
        document.addEventListener('mouseup', stopHold);
        document.addEventListener('mouseleave', stopHold);
        document.addEventListener('touchstart', function(e) {
            var info = getFieldAndDelta(e.target);
            if (info) { e.preventDefault(); startHold(info.field, info.delta); }
        }, { passive: false });
        document.addEventListener('touchend', function(e) {
            var info = getFieldAndDelta(e.target);
            if (info) {
                stopHold();
                window.rcAdjust(info.field, info.delta);
            }
        });
        document.addEventListener('touchcancel', stopHold);
    })();

    window.rcAdjustTreadmill = function(delta) {
        var el = document.getElementById('rc-treadmill-speed');
        if (!el) return;
        var val = parseFloat(el.value) + delta;
        val = Math.max(0.1, Math.round(val * 10) / 10);
        el.value = val;
        window.calcTreadmill();
    };

    // --- Display unit state (km or mi) ---
    var _rcDisplayUnit = localStorage.getItem('rc_display_unit') || 'km';

    // Preset definitions per unit (dynamically resolved via i18n)
    function _getRcPresetsKm() {
        var lang = i18n[window.AppState.currentLang] || i18n.ko;
        var half = lang.rc_half || '하프';
        var full = lang.rc_full || '풀';
        return [
            { val: 5, label: '5' },
            { val: 10, label: '10' },
            { val: 21.0975, label: half },
            { val: 42.195, label: full }
        ];
    }
    function _getRcPresetsMi() {
        var lang = i18n[window.AppState.currentLang] || i18n.ko;
        var half = lang.rc_half || '하프';
        var full = lang.rc_full || '풀';
        return [
            { val: 5, label: '5' },
            { val: 6.2, label: '10(6.2)' },
            { val: 13.1, label: half + '(13.1)' },
            { val: 26.2, label: full + '(26.2)' }
        ];
    }

    function updatePresetButtons() {
        var presets = _rcDisplayUnit === 'mi' ? _getRcPresetsMi() : _getRcPresetsKm();

        // Update pace preset buttons
        var paceBtns = document.querySelectorAll('.rc-preset-btn[data-dist]');
        paceBtns.forEach(function(btn, i) {
            if (i < presets.length) {
                btn.setAttribute('data-dist', presets[i].val);
                btn.textContent = presets[i].label;
                btn.setAttribute('onclick', 'window.selectPaceDist(' + presets[i].val + ')');
            }
        });

        // Update VDOT preset buttons
        var vdotBtns = document.querySelectorAll('.rc-preset-btn[data-vdist]');
        vdotBtns.forEach(function(btn, i) {
            if (i < presets.length) {
                btn.setAttribute('data-vdist', presets[i].val);
                btn.textContent = presets[i].label;
                btn.setAttribute('onclick', 'window.selectVdotDist(' + presets[i].val + ')');
            }
        });
    }

    window.toggleRcDisplayUnit = function() {
        var oldUnit = _rcDisplayUnit;
        _rcDisplayUnit = (oldUnit === 'km') ? 'mi' : 'km';
        localStorage.setItem('rc_display_unit', _rcDisplayUnit);
        var toggleBtns = document.querySelectorAll('#rc-unit-toggle .rc-unit-toggle-btn');
        toggleBtns.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-unit') === _rcDisplayUnit);
        });

        // Update unit labels
        var unitLabel = _rcDisplayUnit;
        var el;
        el = document.getElementById('rc-pace-dist-label'); if (el) el.textContent = unitLabel;
        el = document.getElementById('rc-vdot-dist-label'); if (el) el.textContent = unitLabel;
        el = document.getElementById('rc-tm-speed-label'); if (el) el.textContent = _rcDisplayUnit === 'mi' ? 'mi/h' : 'km/h';

        // Convert distance input values
        var distIds = ['rc-pace-distance', 'rc-vdot-distance'];
        distIds.forEach(function(id) {
            var distEl = document.getElementById(id);
            if (distEl) {
                var d = parseFloat(distEl.value) || 0;
                if (oldUnit === 'km' && _rcDisplayUnit === 'mi') d = d / 1.60934;
                else if (oldUnit === 'mi' && _rcDisplayUnit === 'km') d = d * 1.60934;
                distEl.value = Math.round(d * 10) / 10;
            }
        });

        // Convert treadmill speed value
        var tmEl = document.getElementById('rc-treadmill-speed');
        if (tmEl) {
            var spd = parseFloat(tmEl.value) || 0;
            if (oldUnit === 'km' && _rcDisplayUnit === 'mi') spd = spd / 1.60934;
            else if (oldUnit === 'mi' && _rcDisplayUnit === 'km') spd = spd * 1.60934;
            tmEl.value = Math.round(spd * 10) / 10;
        }

        // Update preset button labels and values
        updatePresetButtons();

        // Re-highlight active preset
        window.onPaceDistInput();
        window.onVdotDistInput();

        // Show/hide secondary pace rows
        var isMi = _rcDisplayUnit === 'mi';
        var pace2Row = document.getElementById('rc-res-pace2-row');
        var tmPace2Row = document.getElementById('rc-tm-pace2-row');
        if (pace2Row) pace2Row.classList.toggle('d-none', !isMi);
        if (tmPace2Row) tmPace2Row.classList.toggle('d-none', !isMi);

        // Update primary pace label
        var paceLabel = document.getElementById('rc-res-pace-label');
        if (paceLabel) paceLabel.textContent = isMi ? 'mi 페이스' : '페이스';
        var tmPaceLabel = document.getElementById('rc-tm-pace-label');
        if (tmPaceLabel) tmPaceLabel.textContent = isMi ? 'mi 페이스' : '페이스';

        // Recalculate to update display
        window.calcPace();
        window.calcTreadmill();
        window.calcVDOT();
    };

    // --- Preset distance selection ---
    window.selectPaceDist = function(dist) {
        _rcUserInteracted = true;
        document.getElementById('rc-pace-distance').value = dist;
        document.querySelectorAll('.rc-preset-btn[data-dist]').forEach(function(btn) {
            btn.classList.toggle('active', parseFloat(btn.getAttribute('data-dist')) === dist);
        });
        window.calcPace();
    };

    window.onPaceDistInput = function() {
        _rcUserInteracted = true;
        var val = parseFloat(document.getElementById('rc-pace-distance').value);
        document.querySelectorAll('.rc-preset-btn[data-dist]').forEach(function(btn) {
            btn.classList.toggle('active', parseFloat(btn.getAttribute('data-dist')) === val);
        });
        window.calcPace();
    };

    window.selectVdotDist = function(dist) {
        _rcUserInteracted = true;
        document.getElementById('rc-vdot-distance').value = dist;
        document.querySelectorAll('.rc-preset-btn[data-vdist]').forEach(function(btn) {
            btn.classList.toggle('active', parseFloat(btn.getAttribute('data-vdist')) === dist);
        });
        window.calcVDOT();
    };

    window.onVdotDistInput = function() {
        _rcUserInteracted = true;
        var val = parseFloat(document.getElementById('rc-vdot-distance').value);
        document.querySelectorAll('.rc-preset-btn[data-vdist]').forEach(function(btn) {
            btn.classList.toggle('active', parseFloat(btn.getAttribute('data-vdist')) === val);
        });
        window.calcVDOT();
    };

    // --- Helper: distance in km (converts from mi if needed) ---
    function getDistKm(inputId) {
        var dist = parseFloat(document.getElementById(inputId).value) || 0;
        if (_rcDisplayUnit === 'mi') dist *= 1.60934;
        return dist;
    }

    // --- Helper: format pace ---
    function formatPace(totalSeconds) {
        if (!isFinite(totalSeconds) || totalSeconds <= 0) return '--:--';
        var min = Math.floor(totalSeconds / 60);
        var sec = Math.round(totalSeconds % 60);
        if (sec === 60) { min++; sec = 0; }
        return min + ':' + (sec < 10 ? '0' : '') + sec;
    }

    // --- Helper: format time HH:MM:SS ---
    function formatTime(totalSeconds) {
        if (!isFinite(totalSeconds) || totalSeconds <= 0) return '--:--:--';
        var h = Math.floor(totalSeconds / 3600);
        var m = Math.floor((totalSeconds % 3600) / 60);
        var s = Math.round(totalSeconds % 60);
        if (s === 60) { m++; s = 0; }
        if (m === 60) { h++; m = 0; }
        return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    // --- Pace Calculator ---
    window.calcPace = function() {
        var distKm, totalSec, paceSecPerKm, speedKmh;
        var isMi = _rcDisplayUnit === 'mi';

        if (_paceMode === 'pace') {
            // Calculate pace from distance + time
            distKm = getDistKm('rc-pace-distance');
            var hr = parseInt(document.getElementById('rc-pace-hr').value) || 0;
            var min = parseInt(document.getElementById('rc-pace-min-t').value) || 0;
            var sec = parseInt(document.getElementById('rc-pace-sec-t').value) || 0;
            totalSec = hr * 3600 + min * 60 + sec;
            if (distKm <= 0 || totalSec <= 0) return;
            paceSecPerKm = totalSec / distKm;
            speedKmh = distKm / (totalSec / 3600);
        } else if (_paceMode === 'distance') {
            // Calculate distance from pace + time
            // Pace input is per-mi when mi mode, per-km when km mode
            var pMin = parseInt(document.getElementById('rc-pace-min').value) || 0;
            var pSec = parseInt(document.getElementById('rc-pace-sec').value) || 0;
            var paceInput = pMin * 60 + pSec;
            paceSecPerKm = isMi ? paceInput / 1.60934 : paceInput;
            var hr2 = parseInt(document.getElementById('rc-pace-hr').value) || 0;
            var min2 = parseInt(document.getElementById('rc-pace-min-t').value) || 0;
            var sec2 = parseInt(document.getElementById('rc-pace-sec-t').value) || 0;
            totalSec = hr2 * 3600 + min2 * 60 + sec2;
            if (paceSecPerKm <= 0 || totalSec <= 0) return;
            distKm = totalSec / paceSecPerKm;
            speedKmh = distKm / (totalSec / 3600);
            // Display distance in current unit
            var distDisplay = isMi ? distKm / 1.60934 : distKm;
            var distUnit = isMi ? 'mi' : 'km';
            document.getElementById('rc-res-distance').innerHTML = (Math.round(distDisplay * 100) / 100).toFixed(2) + ' <span class="rc-result-unit">' + distUnit + '</span>';
        } else { // time
            distKm = getDistKm('rc-pace-distance');
            // Pace input is per-mi when mi mode, per-km when km mode
            var pMin2 = parseInt(document.getElementById('rc-pace-min').value) || 0;
            var pSec2 = parseInt(document.getElementById('rc-pace-sec').value) || 0;
            var paceInput2 = pMin2 * 60 + pSec2;
            paceSecPerKm = isMi ? paceInput2 / 1.60934 : paceInput2;
            if (distKm <= 0 || paceSecPerKm <= 0) return;
            totalSec = paceSecPerKm * distKm;
            speedKmh = distKm / (totalSec / 3600);
            // Update time display
            var th = Math.floor(totalSec / 3600);
            var tm = Math.floor((totalSec % 3600) / 60);
            var ts = Math.round(totalSec % 60);
            document.getElementById('rc-pace-hr').value = th;
            document.getElementById('rc-pace-min-t').value = tm;
            document.getElementById('rc-pace-sec-t').value = ts;
            document.getElementById('rc-res-time').textContent = formatTime(totalSec);
        }

        var lap400 = Math.round(paceSecPerKm * 0.4);
        if (isMi) {
            var secPerMi = paceSecPerKm * 1.60934;
            document.getElementById('rc-res-pace').innerHTML = formatPace(secPerMi) + ' <span class="rc-result-unit">/mi</span>';
            document.getElementById('rc-res-pace2').innerHTML = formatPace(paceSecPerKm) + ' <span class="rc-result-unit">/km</span>';
            var speedMph = speedKmh / 1.60934;
            document.getElementById('rc-res-speed').innerHTML = speedMph.toFixed(1) + ' <span class="rc-result-unit">mi/h</span>';
        } else {
            document.getElementById('rc-res-pace').innerHTML = formatPace(paceSecPerKm) + ' <span class="rc-result-unit">/km</span>';
            document.getElementById('rc-res-speed').innerHTML = speedKmh.toFixed(1) + ' <span class="rc-result-unit">km/h</span>';
        }
        document.getElementById('rc-res-lap').innerHTML = lap400 + ' <span class="rc-result-unit">초</span>';
    };

    // --- Treadmill Calculator ---
    window.calcTreadmill = function() {
        var speed = parseFloat(document.getElementById('rc-treadmill-speed').value) || 0;
        if (speed <= 0) return;
        var isMi = _rcDisplayUnit === 'mi';
        // Convert to km/h if input is in mi/h
        var speedKmh = isMi ? speed * 1.60934 : speed;
        var paceSecPerKm = 3600 / speedKmh;
        var time10k = paceSecPerKm * 10;
        var timeHalf = paceSecPerKm * 21.0975;
        var timeFull = paceSecPerKm * 42.195;
        if (isMi) {
            var secPerMi = paceSecPerKm * 1.60934;
            document.getElementById('rc-tm-pace').innerHTML = formatPace(secPerMi) + ' <span class="rc-result-unit">/mi</span>';
            document.getElementById('rc-tm-pace2').innerHTML = formatPace(paceSecPerKm) + ' <span class="rc-result-unit">/km</span>';
        } else {
            document.getElementById('rc-tm-pace').innerHTML = formatPace(paceSecPerKm) + ' <span class="rc-result-unit">/km</span>';
        }
        document.getElementById('rc-tm-10k').textContent = formatTime(time10k);
        document.getElementById('rc-tm-half').textContent = formatTime(timeHalf);
        document.getElementById('rc-tm-full').textContent = formatTime(timeFull);
    };

    // --- VDOT Calculator (Jack Daniels' Running Formula) ---
    function calcVO2(velocityMPerMin) {
        // Oxygen cost of running (ml/kg/min)
        return -4.60 + 0.182258 * velocityMPerMin + 0.000104 * velocityMPerMin * velocityMPerMin;
    }

    function calcPctVO2max(timeMin) {
        // Percent of VO2max sustained for given duration
        return 0.8 + 0.1894393 * Math.exp(-0.012778 * timeMin) + 0.2989558 * Math.exp(-0.1932605 * timeMin);
    }

    function calcVDOTFromRace(distMeters, timeMin) {
        var velocity = distMeters / timeMin; // m/min
        var vo2 = calcVO2(velocity);
        var pctMax = calcPctVO2max(timeMin);
        if (pctMax <= 0) return 0;
        return vo2 / pctMax;
    }

    function velocityFromVO2(vo2) {
        // Solve: vo2 = -4.60 + 0.182258*v + 0.000104*v^2
        // 0.000104*v^2 + 0.182258*v + (-4.60 - vo2) = 0
        var a = 0.000104, b = 0.182258, c = -4.60 - vo2;
        var disc = b * b - 4 * a * c;
        if (disc < 0) return 0;
        return (-b + Math.sqrt(disc)) / (2 * a);
    }

    function paceFromVDOT(vdot, pctVelocity) {
        // Use %vVO2max: percentage of velocity at VO2max
        var vVO2max = velocityFromVO2(vdot); // velocity at VO2max (m/min)
        var velocity = vVO2max * pctVelocity;
        if (velocity <= 0) return 0;
        return 1000 / velocity * 60; // sec/km
    }

    function predictRaceTime(vdot, distMeters) {
        // Binary search for time where VDOT matches
        var lo = 1, hi = 600; // minutes
        for (var i = 0; i < 50; i++) {
            var mid = (lo + hi) / 2;
            var v = calcVDOTFromRace(distMeters, mid);
            if (v > vdot) lo = mid;  // VDOT too high → time too short → increase
            else hi = mid;            // VDOT too low → time too long → decrease
        }
        return (lo + hi) / 2; // minutes
    }

    window.calcVDOT = function() {
        var distKm = getDistKm('rc-vdot-distance');
        var hr = parseInt(document.getElementById('rc-vdot-hr').value) || 0;
        var min = parseInt(document.getElementById('rc-vdot-min').value) || 0;
        var sec = parseInt(document.getElementById('rc-vdot-sec').value) || 0;
        var totalMin = hr * 60 + min + sec / 60;
        if (distKm <= 0 || totalMin <= 0) return;

        var distM = distKm * 1000;
        var vdot = calcVDOTFromRace(distM, totalMin);
        if (vdot <= 0 || !isFinite(vdot)) return;

        document.getElementById('rc-vdot-value').textContent = vdot.toFixed(1);

        // Training paces (% of vVO2max ranges)
        var isMi = _rcDisplayUnit === 'mi';
        var paceUnit = isMi ? '/mi' : '/km';
        var paceUnitHtml = '<span class="rc-result-unit">' + paceUnit + '</span>';
        var zones = [
            { id: 'rc-vdot-easy', lo: 0.59, hi: 0.74 },
            { id: 'rc-vdot-marathon', lo: 0.75, hi: 0.84 },
            { id: 'rc-vdot-threshold', lo: 0.83, hi: 0.88 },
            { id: 'rc-vdot-interval', lo: 0.95, hi: 1.00 },
            { id: 'rc-vdot-repetition', lo: 1.05, hi: 1.10 }
        ];
        zones.forEach(function(z) {
            var paceLo = paceFromVDOT(vdot, z.hi); // faster pace (sec/km)
            var paceHi = paceFromVDOT(vdot, z.lo); // slower pace (sec/km)
            if (isMi) {
                paceLo *= 1.60934;
                paceHi *= 1.60934;
            }
            document.getElementById(z.id).innerHTML = formatPace(paceLo) + ' - ' + formatPace(paceHi) + ' ' + paceUnitHtml;
        });

        // Race predictions
        var pred10k = predictRaceTime(vdot, 10000);
        var predHalf = predictRaceTime(vdot, 21097.5);
        var predFull = predictRaceTime(vdot, 42195);

        document.getElementById('rc-vdot-pred-10k').textContent = formatTime(pred10k * 60);
        var pace10k = pred10k * 60 / 10; // sec/km
        document.getElementById('rc-vdot-pred-10k-pace').textContent = formatPace(isMi ? pace10k * 1.60934 : pace10k) + paceUnit;
        document.getElementById('rc-vdot-pred-half').textContent = formatTime(predHalf * 60);
        var paceHalfVal = predHalf * 60 / 21.0975;
        document.getElementById('rc-vdot-pred-half-pace').textContent = formatPace(isMi ? paceHalfVal * 1.60934 : paceHalfVal) + paceUnit;
        document.getElementById('rc-vdot-pred-full').textContent = formatTime(predFull * 60);
        var paceFull = predFull * 60 / 42.195;
        document.getElementById('rc-vdot-pred-full-pace').textContent = formatPace(isMi ? paceFull * 1.60934 : paceFull) + paceUnit;
    };

    // --- Unit conversion helpers for display ---
    function convertRecordDist(item, targetUnit) {
        var d = parseFloat(item.dist) || 0;
        var srcUnit = item.unit || 'km';
        if (srcUnit === targetUnit) return d;
        if (srcUnit === 'km' && targetUnit === 'mi') return d / 1.60934;
        if (srcUnit === 'mi' && targetUnit === 'km') return d * 1.60934;
        return d;
    }
    function convertRecordPace(item, targetUnit) {
        // pace is stored as "M:SS" in item.unit; convert to targetUnit
        if (!item.pace) return '--:--';
        var srcUnit = item.unit || 'km';
        if (srcUnit === targetUnit) return item.pace;
        // Parse pace string
        var parts = item.pace.split(':');
        var totalSec = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
        if (srcUnit === 'km' && targetUnit === 'mi') totalSec = totalSec * 1.60934;
        else if (srcUnit === 'mi' && targetUnit === 'km') totalSec = totalSec / 1.60934;
        return formatPace(totalSec);
    }

    // --- Update summary card on status screen ---
    function updateSummaryCard() {
        renderSummaryMileage();
        renderRcSummaryHistory();
    }
    // Expose for external refresh (e.g. after Firebase data restore)
    window.refreshRunningCalcSummary = function() { updateSummaryCard(); };

    function renderRcSummaryHistory() {
        var el = document.getElementById('rc-summary-history');
        if (!el) return;
        var list = loadRcHistory();
        if (list.length === 0) { el.innerHTML = ''; return; }
        var _t = i18n[window.AppState.currentLang] || {};
        var _locale = getDateLocale();
        var displayUnit = _rcDisplayUnit || 'km';
        var maxShow = Math.min(list.length, 3);
        var html = '<div style="font-size:0.6rem; color:var(--text-sub); margin-bottom:4px;">' + (_t.history_recent || '최근 기록') + '</div>';
        for (var i = 0; i < maxShow; i++) {
            var item = list[i];
            var dateStr = new Date(item.timestamp).toLocaleDateString(_locale, { month: 'short', day: 'numeric' });
            if (item.type === 'vdot') {
                var vDist = Math.round(convertRecordDist(item, displayUnit) * 10) / 10;
                html += '<div style="display:flex; justify-content:space-between; padding:3px 8px; font-size:0.72rem; color:var(--text-sub); border-top:1px solid rgba(255,255,255,0.04);">' +
                    '<span>' + dateStr + ' · ' + vDist + ' ' + displayUnit + '</span>' +
                    '<span style="color:var(--neon-cyan, #00d9ff); font-weight:700;">VDOT ' + item.vdot + '</span></div>';
            } else {
                var pDist = Math.round(convertRecordDist(item, displayUnit) * 10) / 10;
                var pPace = convertRecordPace(item, displayUnit);
                html += '<div style="display:flex; justify-content:space-between; padding:3px 8px; font-size:0.72rem; color:var(--text-sub); border-top:1px solid rgba(255,255,255,0.04);">' +
                    '<span>' + dateStr + ' · ' + pDist + ' ' + displayUnit + ' / ' + item.time + '</span>' +
                    '<span style="color:var(--neon-green, #00e676); font-weight:700;">' + pPace + ' /' + displayUnit + '</span></div>';
            }
        }
        el.innerHTML = html;
    }

    // --- Running Calc History (localStorage) ---
    var RC_HISTORY_KEY = 'running_calc_history';
    var RC_HISTORY_MAX = 10;

    function loadRcHistory() {
        try { return JSON.parse(localStorage.getItem(RC_HISTORY_KEY)) || []; }
        catch(e) { return []; }
    }
    function saveRcHistoryToStorage(list) {
        try { localStorage.setItem(RC_HISTORY_KEY, JSON.stringify(list)); } catch(e) {}
    }

    window.saveRunningCalcHistory = function() {
        var list = loadRcHistory();
        var isMi = _rcDisplayUnit === 'mi';
        var vdotPanel = document.getElementById('rc-panel-vdot');
        var isVdot = vdotPanel && vdotPanel.classList.contains('active');

        var entry;
        if (isVdot) {
            var vdotVal = (document.getElementById('rc-vdot-value').textContent || '').trim();
            if (!vdotVal || vdotVal === '0') return;
            var distVal = parseFloat(document.getElementById('rc-vdot-distance').value) || 0;
            var hr = parseInt(document.getElementById('rc-vdot-hr').value) || 0;
            var min = parseInt(document.getElementById('rc-vdot-min').value) || 0;
            var sec = parseInt(document.getElementById('rc-vdot-sec').value) || 0;
            entry = {
                type: 'vdot',
                dist: distVal,
                time: hr + ':' + (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec,
                vdot: vdotVal,
                unit: isMi ? 'mi' : 'km',
                timestamp: Date.now()
            };
        } else {
            var distKm = getDistKm('rc-pace-distance');
            var hr2 = parseInt(document.getElementById('rc-pace-hr').value) || 0;
            var min2 = parseInt(document.getElementById('rc-pace-min-t').value) || 0;
            var sec2 = parseInt(document.getElementById('rc-pace-sec-t').value) || 0;
            var totalSec = hr2 * 3600 + min2 * 60 + sec2;
            if (distKm <= 0 || totalSec <= 0) return;
            var paceSecPerKm = totalSec / distKm;
            var distDisplay = parseFloat(document.getElementById('rc-pace-distance').value) || 0;
            entry = {
                type: _paceMode,
                dist: distDisplay,
                time: hr2 + ':' + (min2 < 10 ? '0' : '') + min2 + ':' + (sec2 < 10 ? '0' : '') + sec2,
                pace: formatPace(isMi ? paceSecPerKm * 1.60934 : paceSecPerKm),
                speed: (isMi ? (distKm / 1.60934) / (totalSec / 3600) : distKm / (totalSec / 3600)).toFixed(1),
                unit: isMi ? 'mi' : 'km',
                timestamp: Date.now()
            };
        }

        list.unshift(entry);
        if (list.length > RC_HISTORY_MAX) list = list.slice(0, RC_HISTORY_MAX);
        saveRcHistoryToStorage(list);
        renderRcHistory();

        // --- Running Calculator Reward (daily limit: +10P & STR +0.5) ---
        var rcRewardDate = (typeof window.getTodayKST === 'function') ? window.getTodayKST() : new Date().toISOString().slice(0, 10);
        var rcLastReward = localStorage.getItem('rc_last_reward_date') || '';
        if (rcLastReward !== rcRewardDate) {
            localStorage.setItem('rc_last_reward_date', rcRewardDate);
            window.AppState.user.points += 10;
            window.AppState.user.pendingStats.str += 0.5;
            window.updatePointUI();
            window.drawRadarChart();
            if (window.AppLogger) AppLogger.info('[RunningCalc] 보상 지급: +10P, STR +0.5');
            var _rcLang = window.AppState.currentLang || 'ko';
            alert(i18n[_rcLang].running_calc_reward || '🏃 러닝 기록 저장! +10P & STR +0.5');
        }

        if (typeof window.saveUserData === 'function') window.saveUserData();
    };

    window.deleteRunningCalcHistory = function(idx) {
        var list = loadRcHistory();
        list.splice(idx, 1);
        saveRcHistoryToStorage(list);
        renderRcHistory();
        if (typeof window.saveUserData === 'function') window.saveUserData();
    };

    window.clearRunningCalcHistory = function(tabType) {
        var list = loadRcHistory();
        if (tabType === 'vdot') {
            list = list.filter(function(e) { return e.type !== 'vdot'; });
        } else {
            list = list.filter(function(e) { return e.type === 'vdot'; });
        }
        saveRcHistoryToStorage(list);
        renderRcHistory();
        if (typeof window.saveUserData === 'function') window.saveUserData();
    };

    function _getRecordDateStr(item) {
        var ts = new Date(item.timestamp);
        return ts.getFullYear() + '-' + String(ts.getMonth() + 1).padStart(2, '0') + '-' + String(ts.getDate()).padStart(2, '0');
    }

    function _matchesFilter(item, filterDate, calState) {
        if (!calState || !calState.open) return true; // calendar closed → show all
        var dateStr = _getRecordDateStr(item);
        if (filterDate) {
            return dateStr === filterDate; // specific date
        }
        // No date selected → show all for displayed month
        var ts = new Date(item.timestamp);
        return ts.getFullYear() === calState.year && ts.getMonth() === calState.month;
    }

    function renderRcHistory() {
        var list = loadRcHistory();
        var _t = i18n[window.AppState.currentLang] || {};
        var _locale = getDateLocale();
        var displayUnit = _rcDisplayUnit || 'km';

        var paceState = _rcCalendarState.pace;
        var vdotState = _rcCalendarState.vdot;
        var paceFilter = _rcFilterDate.pace;
        var vdotFilter = _rcFilterDate.vdot;

        var paceItems = [];
        var vdotItems = [];
        list.forEach(function(e, i) {
            if (e.type === 'vdot') {
                if (_matchesFilter(e, vdotFilter, vdotState)) vdotItems.push({ item: e, idx: i });
            } else {
                if (_matchesFilter(e, paceFilter, paceState)) paceItems.push({ item: e, idx: i });
            }
        });

        // Update history section titles
        var paceTitleEl = document.getElementById('rc-pace-history-title');
        var vdotTitleEl = document.getElementById('rc-vdot-history-title');
        if (paceTitleEl) {
            paceTitleEl.textContent = paceState.open
                ? (_t.rc_daily_monthly_history || '일별/월별 기록')
                : (_t.rc_recent_history || '최근 기록');
        }
        if (vdotTitleEl) {
            vdotTitleEl.textContent = vdotState.open
                ? (_t.rc_daily_monthly_history || '일별/월별 기록')
                : (_t.rc_recent_history || '최근 기록');
        }

        // Pace history
        var paceListEl = document.getElementById('rc-pace-history-list');
        var paceClearBtn = document.getElementById('rc-pace-history-clear');
        if (paceListEl) {
            if (paceItems.length === 0) {
                paceListEl.innerHTML = '<div class="calc-history-empty">' + (_t.history_empty || '저장된 기록이 없습니다') + '</div>';
                if (paceClearBtn) paceClearBtn.style.display = 'none';
            } else {
                if (paceClearBtn) paceClearBtn.style.display = '';
                var html = '';
                paceItems.forEach(function(obj) {
                    var item = obj.item;
                    var dateStr = new Date(item.timestamp).toLocaleDateString(_locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    var modeLabel = item.type === 'pace' ? (_t.history_mode_pace || '페이스') : item.type === 'distance' ? (_t.history_mode_distance || '거리') : (_t.history_mode_time || '시간');
                    var convDist = Math.round(convertRecordDist(item, displayUnit) * 10) / 10;
                    var convPace = convertRecordPace(item, displayUnit);
                    html += '<div class="calc-history-item">' +
                        '<div class="calc-history-info">' +
                        '<div class="calc-history-main">' + convDist + ' ' + displayUnit + ' / ' + item.time + '</div>' +
                        '<div class="calc-history-sub">' + modeLabel + ' · ' + dateStr + '</div>' +
                        '</div>' +
                        '<div class="calc-history-value" style="color:var(--neon-green, #00e676);">' + convPace + ' <span style="font-size:0.7rem;color:var(--text-sub);">/' + displayUnit + '</span></div>' +
                        '<button class="calc-history-delete" onclick="window.deleteRunningCalcHistory(' + obj.idx + ')">✕</button>' +
                        '</div>';
                });
                paceListEl.innerHTML = html;
            }
        }

        // VDOT history
        var vdotListEl = document.getElementById('rc-vdot-history-list');
        var vdotClearBtn = document.getElementById('rc-vdot-history-clear');
        if (vdotListEl) {
            if (vdotItems.length === 0) {
                vdotListEl.innerHTML = '<div class="calc-history-empty">' + (_t.history_empty || '저장된 기록이 없습니다') + '</div>';
                if (vdotClearBtn) vdotClearBtn.style.display = 'none';
            } else {
                if (vdotClearBtn) vdotClearBtn.style.display = '';
                var html2 = '';
                vdotItems.forEach(function(obj) {
                    var item = obj.item;
                    var dateStr = new Date(item.timestamp).toLocaleDateString(_locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    var convDist2 = Math.round(convertRecordDist(item, displayUnit) * 10) / 10;
                    html2 += '<div class="calc-history-item">' +
                        '<div class="calc-history-info">' +
                        '<div class="calc-history-main">' + convDist2 + ' ' + displayUnit + ' / ' + item.time + '</div>' +
                        '<div class="calc-history-sub">VDOT · ' + dateStr + '</div>' +
                        '</div>' +
                        '<div class="calc-history-value" style="color:var(--neon-cyan, #00d9ff);">' + item.vdot + '</div>' +
                        '<button class="calc-history-delete" onclick="window.deleteRunningCalcHistory(' + obj.idx + ')">✕</button>' +
                        '</div>';
                });
                vdotListEl.innerHTML = html2;
            }
        }
    }

    // --- Mileage Summary ---
    function getDistInKm(item) {
        var d = parseFloat(item.dist) || 0;
        if (item.unit === 'mi') d = d * 1.60934;
        return d;
    }

    function calcMileageTotals(list, isMi) {
        var now = new Date();
        var currentYear = now.getFullYear();
        var currentMonth = now.getMonth();
        var monthlyKm = 0, yearlyKm = 0;
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (item.type === 'vdot') continue; // only pace records count
            var ts = new Date(item.timestamp);
            var distKm = getDistInKm(item);
            if (ts.getFullYear() === currentYear) {
                yearlyKm += distKm;
                if (ts.getMonth() === currentMonth) {
                    monthlyKm += distKm;
                }
            }
        }
        if (isMi) {
            return { monthly: (monthlyKm / 1.60934).toFixed(1), yearly: (yearlyKm / 1.60934).toFixed(1), unit: 'mi' };
        }
        return { monthly: monthlyKm.toFixed(1), yearly: yearlyKm.toFixed(1), unit: 'km' };
    }

    function renderMileageSummary() {
        var list = loadRcHistory();
        var isMi = _rcDisplayUnit === 'mi';
        var totals = calcMileageTotals(list, isMi);

        // Pace tab mileage
        var monthlyEl = document.getElementById('rc-pace-monthly-km');
        var yearlyEl = document.getElementById('rc-pace-yearly-km');
        if (monthlyEl) monthlyEl.textContent = totals.monthly + ' ' + totals.unit;
        if (yearlyEl) yearlyEl.textContent = totals.yearly + ' ' + totals.unit;

        // VDOT tab mileage (same data)
        var vMonthlyEl = document.getElementById('rc-vdot-monthly-km');
        var vYearlyEl = document.getElementById('rc-vdot-yearly-km');
        if (vMonthlyEl) vMonthlyEl.textContent = totals.monthly + ' ' + totals.unit;
        if (vYearlyEl) vYearlyEl.textContent = totals.yearly + ' ' + totals.unit;
    }

    function renderSummaryMileage() {
        var el = document.getElementById('rc-summary-mileage');
        if (!el) return;
        var list = loadRcHistory();
        var displayUnit = _rcDisplayUnit || 'km';
        var totals = calcMileageTotals(list, displayUnit === 'mi');
        var _t = i18n[window.AppState.currentLang] || {};
        var titleLabel = _t.rc_mileage_title || '러닝 마일리지';
        var monthlyLabel = _t.rc_monthly_mileage || '월간';
        var yearlyLabel = _t.rc_yearly_mileage || '연간';
        var newBadge = '<span style="display:inline-block; font-size:0.5rem; font-weight:800; color:#fff; background:var(--neon-red, #ff5252); padding:1px 5px; border-radius:3px; margin-left:5px; vertical-align:middle;">NEW</span>';

        el.innerHTML = '<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:rgba(0,217,255,0.05); border-radius:8px; border:1px solid rgba(0,217,255,0.15);">' +
            '<div style="font-size:0.65rem; color:var(--text-sub);">' + titleLabel + newBadge + '</div>' +
            '<div style="display:flex; align-items:baseline; gap:12px;">' +
            '<div style="text-align:right;"><div style="font-size:0.55rem; color:var(--text-sub); margin-bottom:1px;">' + monthlyLabel + '</div>' +
            '<div style="font-size:1.1rem; font-weight:900; color:var(--neon-cyan, #00d9ff);">' + totals.monthly + ' <span style="font-size:0.65rem; font-weight:600;">' + totals.unit + '</span></div></div>' +
            '<div style="color:var(--text-sub); font-size:0.7rem;">|</div>' +
            '<div style="text-align:right;"><div style="font-size:0.55rem; color:var(--text-sub); margin-bottom:1px;">' + yearlyLabel + '</div>' +
            '<div style="font-size:1.1rem; font-weight:900; color:var(--neon-cyan, #00d9ff);">' + totals.yearly + ' <span style="font-size:0.65rem; font-weight:600;">' + totals.unit + '</span></div></div>' +
            '</div></div>';
    }

    // --- Calendar ---
    var _rcCalendarState = {
        pace: { year: new Date().getFullYear(), month: new Date().getMonth(), open: false },
        vdot: { year: new Date().getFullYear(), month: new Date().getMonth(), open: false }
    };
    var _rcFilterDate = { pace: null, vdot: null };
    var _rcCalendarAdUnlocked = false;
    var _rcCalendarPendingTab = null;

    function _rcCalendarAdKey() {
        var uid = (window._auth && window._auth.currentUser) ? window._auth.currentUser.uid : '_anon';
        return 'rc_calendar_ad_date_' + uid;
    }

    function _openRcCalendar(tab) {
        var state = _rcCalendarState[tab];
        state.open = true;
        _rcFilterDate[tab] = null;
        var calEl = document.getElementById('rc-' + tab + '-calendar');
        var toggleBtn = document.getElementById('rc-' + tab + '-calendar-toggle');
        if (calEl) calEl.classList.remove('d-none');
        if (toggleBtn) toggleBtn.classList.add('active');
        state.year = new Date().getFullYear();
        state.month = new Date().getMonth();
        renderRcCalendar(tab);
        renderRcHistory();
    }

    window.toggleRcCalendar = async function(tab) {
        var state = _rcCalendarState[tab];

        // Close path
        if (state.open) {
            state.open = false;
            var calEl = document.getElementById('rc-' + tab + '-calendar');
            var toggleBtn = document.getElementById('rc-' + tab + '-calendar-toggle');
            if (calEl) calEl.classList.add('d-none');
            if (toggleBtn) toggleBtn.classList.remove('active');
            _rcFilterDate[tab] = null;
            renderRcHistory();
            return;
        }

        // Open path — check ad gate (once per day)
        var todayStr = window.getTodayKST();
        var adDateKey = _rcCalendarAdKey();
        var adDate = localStorage.getItem(adDateKey);

        if (adDate === todayStr || _rcCalendarAdUnlocked) {
            _openRcCalendar(tab);
            return;
        }

        // Web (non-native) — skip ad
        if (!window.isNativePlatform) {
            _rcCalendarAdUnlocked = true;
            localStorage.setItem(adDateKey, todayStr);
            _openRcCalendar(tab);
            return;
        }

        // Native — show rewarded ad
        var lang = window.AppState.currentLang;
        var _t = i18n[lang] || {};

        if (!_admobInitialized) {
            await initAdMob();
        }

        var AdMobPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;
        if (!AdMobPlugin) {
            alert(_t.rc_calendar_ad_fail || '광고를 불러올 수 없습니다');
            return;
        }

        if (!_rewardedAdReady) {
            try {
                await AdMobPlugin.prepareRewardVideoAd({
                    adId: REWARDED_AD_UNIT_ID,
                    isTesting: false,
                    npa: !canShowPersonalizedAds(),
                });
                _rewardedAdReady = true;
            } catch (e) {
                alert(_t.rc_calendar_ad_fail || '광고를 불러올 수 없습니다');
                return;
            }
        }

        // Set callbacks
        _rcCalendarPendingTab = tab;
        _rewardedAdContext = 'rcCalendar';
        _rewardedAdOnSuccess = function() {
            _rcCalendarAdUnlocked = true;
            localStorage.setItem(adDateKey, todayStr);
            _openRcCalendar(_rcCalendarPendingTab || tab);
            if (window.AppLogger) AppLogger.info('[RcCalendar] 보상형 광고 시청 완료 → 달력 해제');
        };
        _rewardedAdOnFail = function() {
            alert(_t.rc_calendar_ad_fail || '광고를 불러올 수 없습니다');
        };

        try {
            await AdMobPlugin.showRewardVideoAd();
        } catch (e) {
            console.warn('[RcCalendar] 보상형 광고 표시 실패:', e);
            _rewardedAdContext = 'bonusExp';
            _rewardedAdOnSuccess = null;
            _rewardedAdOnFail = null;
            _rewardedAdReady = false;
            preloadRewardedAd._retryCount = 0;
            preloadRewardedAd();
            alert(_t.rc_calendar_ad_fail || '광고를 불러올 수 없습니다');
        }
    };

    window.changeRcCalendar = function(tab, delta) {
        var state = _rcCalendarState[tab];
        state.month += delta;
        if (state.month > 11) { state.month = 0; state.year++; }
        if (state.month < 0) { state.month = 11; state.year--; }
        _rcFilterDate[tab] = null;
        renderRcCalendar(tab);
        renderRcHistory();
    };

    window.filterRcHistoryByDate = function(tab, dateStr) {
        if (_rcFilterDate[tab] === dateStr) {
            _rcFilterDate[tab] = null;
        } else {
            _rcFilterDate[tab] = dateStr;
        }
        renderRcCalendar(tab);
        renderRcHistory();
    };

    function renderRcCalendar(tab) {
        var state = _rcCalendarState[tab];
        var gridEl = document.getElementById('rc-' + tab + '-cal-grid');
        var titleEl = document.getElementById('rc-' + tab + '-cal-title');
        if (!gridEl) return;

        var year = state.year, month = state.month;
        var lang = window.AppState.currentLang || 'ko';

        var monthNames = {
            ko: ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"],
            en: ["January","February","March","April","May","June","July","August","September","October","November","December"],
            ja: ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"]
        };
        var dayNames = {
            ko: ["일","월","화","수","목","금","토"],
            en: ["S","M","T","W","T","F","S"],
            ja: ["日","月","火","水","木","金","土"]
        };

        if (titleEl) titleEl.textContent = year + ' ' + (monthNames[lang] || monthNames.en)[month];

        // Build set of dates that have records
        var list = loadRcHistory();
        var recordDates = {};
        for (var i = 0; i < list.length; i++) {
            if (list[i].type === 'vdot') continue;
            var ts = new Date(list[i].timestamp);
            var key = ts.getFullYear() + '-' + String(ts.getMonth() + 1).padStart(2, '0') + '-' + String(ts.getDate()).padStart(2, '0');
            recordDates[key] = true;
        }

        var today = new Date();
        var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        var selectedDate = _rcFilterDate[tab];

        var firstDay = new Date(year, month, 1).getDay();
        var daysInMonth = new Date(year, month + 1, 0).getDate();

        var html = '<div class="rc-cal-header">';
        var dn = dayNames[lang] || dayNames.en;
        for (var d = 0; d < 7; d++) html += '<span>' + dn[d] + '</span>';
        html += '</div><div class="rc-cal-days">';

        for (var e = 0; e < firstDay; e++) html += '<div class="rc-cal-day empty"></div>';

        for (var day = 1; day <= daysInMonth; day++) {
            var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            var classes = 'rc-cal-day';
            if (dateStr === todayStr) classes += ' today';
            if (recordDates[dateStr]) classes += ' has-record';
            if (dateStr === selectedDate) classes += ' selected';
            html += '<div class="' + classes + '" onclick="window.filterRcHistoryByDate(\'' + tab + '\',\'' + dateStr + '\')">' + day + '</div>';
        }
        html += '</div>';
        gridEl.innerHTML = html;
    }

    // Override updateSummaryCard to include mileage
    var _origUpdateSummary = updateSummaryCard;
    updateSummaryCard = function() {
        _origUpdateSummary();
        renderSummaryMileage();
    };

    // Override renderRcHistory to also update mileage
    var _origRenderRcHistory = renderRcHistory;
    renderRcHistory = function() {
        _origRenderRcHistory();
        renderMileageSummary();
    };

    // Override toggleRcDisplayUnit to refresh mileage and re-render history with new unit
    var _origToggleUnit = window.toggleRcDisplayUnit;
    window.toggleRcDisplayUnit = function() {
        _origToggleUnit();
        renderMileageSummary();
        renderRcHistory();
        updateSummaryCard();
    };

    // Init on page load (dynamic import 대응: DOMContentLoaded 이미 발생했을 수 있음)
    function _rcInit() {
        window.calcPace();
        window.calcTreadmill();
        updateSummaryCard();
        renderRcHistory();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _rcInit);
    } else {
        _rcInit();
    }
})();

// ========== 1RM Calculator ==========
(function() {
    'use strict';

    var _ormData = { squat: null, bench: null, deadlift: null };

    // Load saved data
    try {
        var saved = localStorage.getItem('orm_data');
        if (saved) _ormData = JSON.parse(saved);
    } catch(e) {}

    // --- kg/lb unit toggle ---
    var _ormDisplayUnit = localStorage.getItem('orm_display_unit') || 'kg';
    var KG_TO_LB = 2.20462;

    function ormDisplayWeight(kgValue) {
        var v = (_ormDisplayUnit === 'lb') ? kgValue * KG_TO_LB : kgValue;
        return Math.round(v * 10) / 10;
    }
    function ormUnitLabel() { return _ormDisplayUnit; }

    function syncOrmToggleUI() {
        var toggleBtns = document.querySelectorAll('#orm-unit-toggle .rc-unit-toggle-btn');
        toggleBtns.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-unit') === _ormDisplayUnit);
        });
        var unit = ormUnitLabel();
        var _t = i18n[window.AppState.currentLang] || {};
        var labelEl = document.getElementById('orm-weight-label');
        if (labelEl) labelEl.textContent = (_t.orm_weight_label_base || '무게') + ' (' + unit + ')';
        var inputEl = document.getElementById('orm-weight');
        if (inputEl) inputEl.placeholder = (_t.orm_weight_placeholder_base || '무게') + ' (' + unit + ')';
    }

    window.toggleOrmDisplayUnit = function() {
        var oldUnit = _ormDisplayUnit;
        _ormDisplayUnit = (oldUnit === 'kg') ? 'lb' : 'kg';
        localStorage.setItem('orm_display_unit', _ormDisplayUnit);

        syncOrmToggleUI();

        // Convert current input value
        var inputEl = document.getElementById('orm-weight');
        if (inputEl) {
            var val = parseFloat(inputEl.value);
            if (val && val > 0) {
                if (oldUnit === 'kg' && _ormDisplayUnit === 'lb') val = val * KG_TO_LB;
                else if (oldUnit === 'lb' && _ormDisplayUnit === 'kg') val = val / KG_TO_LB;
                inputEl.value = Math.round(val * 10) / 10;
            }
        }

        // Re-render all displays
        updateTotalDisplay();
        updateSummaryCard();
        renderOrmHistory();

        // If results are visible, re-trigger calculation
        var resultsEl = document.getElementById('orm-results');
        if (resultsEl && !resultsEl.classList.contains('d-none')) {
            window.calcOneRM();
        }
    };

    function saveOrmData() {
        try { localStorage.setItem('orm_data', JSON.stringify(_ormData)); } catch(e) {}
    }

    // --- Overlay open/close ---
    window.openOrmCalcView = function() {
        var overlay = document.getElementById('orm-calc-overlay');
        if (overlay) overlay.classList.remove('d-none');
        syncOrmToggleUI();
        updateTotalDisplay();
        renderOrmHistory();
    };
    window.closeOrmCalcView = function() {
        var overlay = document.getElementById('orm-calc-overlay');
        if (overlay) overlay.classList.add('d-none');
        updateSummaryCard();
    };

    // --- 1RM Formulas ---
    function calcEpley(w, r) { return r === 1 ? w : w * (1 + r / 30); }
    function calcBrzycki(w, r) { return r === 1 ? w : w * 36 / (37 - r); }
    function calcLander(w, r) { return r === 1 ? w : (100 * w) / (101.3 - 2.67123 * r); }
    function calcLombardi(w, r) { return w * Math.pow(r, 0.10); }
    function calcOconner(w, r) { return r === 1 ? w : w * (1 + r / 40); }

    function calcAverage(w, r) {
        var vals = [calcEpley(w,r), calcBrzycki(w,r), calcLander(w,r), calcLombardi(w,r), calcOconner(w,r)];
        return vals.reduce(function(a,b){ return a+b; }, 0) / vals.length;
    }

    // RM percentage table (rep -> % of 1RM)
    var rmPct = [
        {reps:1, pct:100}, {reps:2, pct:97}, {reps:3, pct:94}, {reps:4, pct:92},
        {reps:5, pct:89}, {reps:6, pct:86}, {reps:7, pct:83}, {reps:8, pct:81},
        {reps:9, pct:78}, {reps:10, pct:75}, {reps:11, pct:73}, {reps:12, pct:71}
    ];

    // --- Main calculation ---
    window.calcOneRM = function() {
        var exercise = document.getElementById('orm-exercise').value;
        var reps = parseInt(document.getElementById('orm-reps').value) || 5;
        var weight = parseFloat(document.getElementById('orm-weight').value);
        if (!weight || weight <= 0) return;

        // Convert to kg for calculation if input is in lb
        var weightKg = (_ormDisplayUnit === 'lb') ? weight / KG_TO_LB : weight;

        var epley = calcEpley(weightKg, reps);
        var brzycki = calcBrzycki(weightKg, reps);
        var lander = calcLander(weightKg, reps);
        var lombardi = calcLombardi(weightKg, reps);
        var oconner = calcOconner(weightKg, reps);
        var avg = (epley + brzycki + lander + lombardi + oconner) / 5;

        // Round to 1 decimal
        function r1(v) { return Math.round(v * 10) / 10; }

        var u = ormUnitLabel();
        document.getElementById('orm-result-1rm').textContent = ormDisplayWeight(avg) + ' ' + u;
        document.getElementById('orm-res-epley').textContent = ormDisplayWeight(epley) + ' ' + u;
        document.getElementById('orm-res-brzycki').textContent = ormDisplayWeight(brzycki) + ' ' + u;
        document.getElementById('orm-res-lander').textContent = ormDisplayWeight(lander) + ' ' + u;
        document.getElementById('orm-res-lombardi').textContent = ormDisplayWeight(lombardi) + ' ' + u;
        document.getElementById('orm-res-oconner').textContent = ormDisplayWeight(oconner) + ' ' + u;

        // Show results
        document.getElementById('orm-results').classList.remove('d-none');

        // Build RM percentage table
        var pctContainer = document.getElementById('orm-pct-rows');
        pctContainer.innerHTML = '';
        rmPct.forEach(function(item) {
            var row = document.createElement('div');
            row.className = 'rc-result-row';
            row.innerHTML = '<span class="rc-result-label">' + item.reps + 'RM (' + item.pct + '%)</span>' +
                '<span class="rc-result-value">' + ormDisplayWeight(avg * item.pct / 100) + ' <span class="rc-result-unit">' + u + '</span></span>';
            pctContainer.appendChild(row);
        });
        document.getElementById('orm-pct-table').classList.remove('d-none');

        // Save to exercise data (always in kg)
        _ormData[exercise] = r1(avg);
        saveOrmData();
        updateTotalDisplay();

        // Save to history (always in kg)
        saveOrmHistory(exercise, r1(weightKg), reps, r1(avg));
    };

    // --- Update total display in overlay ---
    function updateTotalDisplay() {
        var sq = _ormData.squat;
        var bp = _ormData.bench;
        var dl = _ormData.deadlift;
        var u = ormUnitLabel();

        document.getElementById('orm-total-squat').textContent = sq ? ormDisplayWeight(sq) + ' ' + u : '- ' + u;
        document.getElementById('orm-total-bench').textContent = bp ? ormDisplayWeight(bp) + ' ' + u : '- ' + u;
        document.getElementById('orm-total-dead').textContent = dl ? ormDisplayWeight(dl) + ' ' + u : '- ' + u;

        var total = (sq || 0) + (bp || 0) + (dl || 0);
        document.getElementById('orm-total-sum').textContent = (sq || bp || dl) ? ormDisplayWeight(total) + ' ' + u : '- ' + u;
    }

    // --- Rebuild _ormData from history if localStorage orm_data is missing ---
    function rebuildOrmDataFromHistory() {
        var list = loadOrmHistory();
        if (list.length === 0) return;
        // Find latest 1RM per exercise from history
        var found = { squat: false, bench: false, deadlift: false };
        for (var i = 0; i < list.length; i++) {
            var ex = list[i].exercise;
            if (ex && !found[ex] && list[i].result1rm) {
                _ormData[ex] = list[i].result1rm;
                found[ex] = true;
            }
            if (found.squat && found.bench && found.deadlift) break;
        }
        saveOrmData();
    }

    // --- Update summary card on status screen ---
    function updateSummaryCard() {
        // If _ormData is empty but history exists, rebuild from history
        if (!_ormData.squat && !_ormData.bench && !_ormData.deadlift) {
            rebuildOrmDataFromHistory();
        }

        var sq = _ormData.squat;
        var bp = _ormData.bench;
        var dl = _ormData.deadlift;

        var el1 = document.getElementById('orm-summary-squat');
        var el2 = document.getElementById('orm-summary-bench');
        var el3 = document.getElementById('orm-summary-dead');
        var el4 = document.getElementById('orm-summary-total');

        var u = ormUnitLabel();
        if (el1) el1.textContent = sq ? ormDisplayWeight(sq) + ' ' + u : '- ' + u;
        if (el2) el2.textContent = bp ? ormDisplayWeight(bp) + ' ' + u : '- ' + u;
        if (el3) el3.textContent = dl ? ormDisplayWeight(dl) + ' ' + u : '- ' + u;

        var total = (sq || 0) + (bp || 0) + (dl || 0);
        if (el4) el4.textContent = (sq || bp || dl) ? ormDisplayWeight(total) + ' ' + u : '- ' + u;

        renderOrmSummaryHistory();
    }
    // Expose for external refresh (e.g. after Firebase data restore)
    window.refreshOrmCalcSummary = function() { updateSummaryCard(); };

    function renderOrmSummaryHistory() {
        var el = document.getElementById('orm-summary-history');
        if (!el) return;
        var list = loadOrmHistory();
        if (list.length === 0) { el.innerHTML = ''; return; }
        var _t = i18n[window.AppState.currentLang] || {};
        var _en = getExerciseNames();
        var _locale = getDateLocale();
        var repUnit = _t.history_rep_unit || '회';
        var maxShow = Math.min(list.length, 3);
        var html = '<div style="font-size:0.6rem; color:var(--text-sub); margin-bottom:4px;">' + (_t.history_recent || '최근 기록') + '</div>';
        for (var i = 0; i < maxShow; i++) {
            var item = list[i];
            var eName = _en[item.exercise] || item.exerciseName || item.exercise;
            var dateStr = new Date(item.timestamp).toLocaleDateString(_locale, { month: 'short', day: 'numeric' });
            html += '<div style="display:flex; justify-content:space-between; padding:3px 8px; font-size:0.72rem; color:var(--text-sub); border-top:1px solid rgba(255,255,255,0.04);">' +
                '<span>' + dateStr + ' · ' + eName + ' ' + ormDisplayWeight(item.weight) + ormUnitLabel() + '×' + item.reps + repUnit + '</span>' +
                '<span style="color:var(--neon-red); font-weight:700;">' + ormDisplayWeight(item.result1rm) + ' ' + ormUnitLabel() + '</span></div>';
        }
        el.innerHTML = html;
    }

    // --- 1RM Calc History ---
    var ORM_HISTORY_KEY = 'orm_calc_history';
    var ORM_HISTORY_MAX = 10;
    function getExerciseNames() {
        var _t = i18n[window.AppState.currentLang] || {};
        return { squat: _t.orm_squat || '스쿼트', bench: _t.orm_bench || '벤치프레스', deadlift: _t.orm_deadlift || '데드리프트' };
    }
    function getDateLocale() {
        var lang = window.AppState.currentLang || 'ko';
        return lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-US' : 'ko-KR';
    }

    function loadOrmHistory() {
        try { return JSON.parse(localStorage.getItem(ORM_HISTORY_KEY)) || []; }
        catch(e) { return []; }
    }
    function saveOrmHistoryToStorage(list) {
        try { localStorage.setItem(ORM_HISTORY_KEY, JSON.stringify(list)); } catch(e) {}
    }

    function saveOrmHistory(exercise, weight, reps, result1rm) {
        var list = loadOrmHistory();
        list.unshift({
            exercise: exercise,
            exerciseName: getExerciseNames()[exercise] || exercise,
            weight: weight,
            reps: reps,
            result1rm: result1rm,
            timestamp: Date.now()
        });
        if (list.length > ORM_HISTORY_MAX) list = list.slice(0, ORM_HISTORY_MAX);
        saveOrmHistoryToStorage(list);
        renderOrmHistory();

        // --- 1RM Calculator Reward (daily limit: +10P & STR +0.5) ---
        var ormRewardDate = (typeof window.getTodayKST === 'function') ? window.getTodayKST() : new Date().toISOString().slice(0, 10);
        var ormLastReward = localStorage.getItem('orm_last_reward_date') || '';
        if (ormLastReward !== ormRewardDate) {
            localStorage.setItem('orm_last_reward_date', ormRewardDate);
            window.AppState.user.points += 10;
            window.AppState.user.pendingStats.str += 0.5;
            window.updatePointUI();
            window.drawRadarChart();
            if (window.AppLogger) AppLogger.info('[ORM Calc] 보상 지급: +10P, STR +0.5');
            var _ormLang = window.AppState.currentLang || 'ko';
            alert(i18n[_ormLang].orm_calc_reward || '🏋️ 1RM 기록 저장! +10P & STR +0.5');
        }

        if (typeof window.saveUserData === 'function') window.saveUserData();
    }

    window.deleteOrmCalcHistory = function(idx) {
        var list = loadOrmHistory();
        list.splice(idx, 1);
        saveOrmHistoryToStorage(list);
        renderOrmHistory();
        if (typeof window.saveUserData === 'function') window.saveUserData();
    };

    window.clearOrmCalcHistory = function() {
        saveOrmHistoryToStorage([]);
        renderOrmHistory();
        if (typeof window.saveUserData === 'function') window.saveUserData();
    };

    function renderOrmHistory() {
        var list = loadOrmHistory();
        var listEl = document.getElementById('orm-history-list');
        var clearBtn = document.getElementById('orm-history-clear');
        if (!listEl) return;
        var _t = i18n[window.AppState.currentLang] || {};
        var _en = getExerciseNames();
        var _locale = getDateLocale();
        var repUnit = _t.history_rep_unit || '회';

        if (list.length === 0) {
            listEl.innerHTML = '<div class="calc-history-empty">' + (_t.history_empty || '저장된 기록이 없습니다') + '</div>';
            if (clearBtn) clearBtn.style.display = 'none';
            return;
        }

        if (clearBtn) clearBtn.style.display = '';
        var html = '';
        list.forEach(function(item, idx) {
            var eName = _en[item.exercise] || item.exerciseName || item.exercise;
            var dateStr = new Date(item.timestamp).toLocaleDateString(_locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            html += '<div class="calc-history-item">' +
                '<div class="calc-history-info">' +
                '<div class="calc-history-main">' + eName + ' · ' + ormDisplayWeight(item.weight) + ormUnitLabel() + ' × ' + item.reps + repUnit + '</div>' +
                '<div class="calc-history-sub">' + dateStr + '</div>' +
                '</div>' +
                '<div class="calc-history-value" style="color:var(--neon-red);">' + ormDisplayWeight(item.result1rm) + ' <span style="font-size:0.7rem;color:var(--text-sub);">' + ormUnitLabel() + '</span></div>' +
                '<button class="calc-history-delete" onclick="window.deleteOrmCalcHistory(' + idx + ')">✕</button>' +
                '</div>';
        });
        listEl.innerHTML = html;
    }

    // Init on page load (dynamic import 대응: DOMContentLoaded 이미 발생했을 수 있음)
    function _ormInit() {
        updateSummaryCard();
        renderOrmHistory();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _ormInit);
    } else {
        _ormInit();
    }
})();
