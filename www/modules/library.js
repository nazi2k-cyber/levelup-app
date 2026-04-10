// ===== 내 서재 (My Library) 모듈 =====
(function() {
    'use strict';

    // 외부 의존은 window.* 경유
    const AppState = window.AppState;
    const i18n = window.i18n;

    let _html5QrCode = null;
    let _pendingBook = null;
    let _ocrInterval = null;
    let _ocrProcessing = false;
    let _ocrWorker = null;
    let _ocrInitFailed = false;

    // ── ISBN Precision Tracking State ──
    var _isbnFragments = [];         // Recent OCR digit fragments for accumulation
    var _lockedCropIndex = -1;       // Region lock-on: locked crop region index (-1 = none)
    var _lockMissCount = 0;          // Consecutive misses since lock
    var _lockSubIndex = 0;           // Sub-index for cycling locked region + neighbors

    function _scannerConfig() {
        return {
            fps: 15,
            qrbox: function(viewfinderWidth, viewfinderHeight) {
                // Focused scan area: 85% width × 40% height — reduces noise for ZXing decoder
                var w = Math.floor(viewfinderWidth * 0.85);
                var h = Math.floor(viewfinderHeight * 0.40);
                if (h < 80) h = 80;
                if (w < 200) w = 200;
                return { width: w, height: h };
            },
            disableFlip: true,
            formatsToSupport: [
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E
            ],
            experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        };
    }

    // ── OCR Error Correction ──
    function ocrCorrectDigits(text) {
        if (!text) return text;
        // Normalize common OCR misreads of "ISBN" prefix
        var result = text.replace(/[I1l|][S5][B8][Nn]/g, 'ISBN');
        // Replace common letter↔digit confusions in numeric contexts
        // O/o → 0, l/I/| → 1, S/s → 5, B → 8, Z → 2, G → 6, q → 9
        result = result.replace(/(?<=[0-9])([OoQD])(?=[0-9\-\s])/g, '0');
        result = result.replace(/([OoQD])(?=[0-9]{2})/g, '0');
        result = result.replace(/(?<=[0-9])([Il|])(?=[0-9\-\s])/g, '1');
        result = result.replace(/([Il|])(?=[0-9]{2})/g, '1');
        result = result.replace(/(?<=[0-9])([Ss])(?=[0-9\-\s])/g, '5');
        result = result.replace(/(?<=[0-9])([B])(?=[0-9\-\s])/g, '8');
        result = result.replace(/(?<=[0-9])([Z])(?=[0-9\-\s])/g, '2');
        result = result.replace(/(?<=[0-9])([G])(?=[0-9\-\s])/g, '6');
        result = result.replace(/(?<=[0-9])([q])(?=[0-9\-\s])/g, '9');
        return result;
    }

    // ── OCR ISBN Detection (Tesseract.js fallback) ──
    function extractIsbnFromText(text) {
        if (!text) return null;
        // Remove spaces/newlines, normalize
        var cleaned = text.replace(/\s+/g, ' ');
        // Apply OCR error correction
        cleaned = ocrCorrectDigits(cleaned);
        // Normalize partial "ISBN" prefixes (OCR may drop the leading I)
        cleaned = cleaned.replace(/\bSBN\b/g, 'ISBN');
        // Pattern 1: "ISBN" followed by digits (with optional hyphens/spaces)
        var m = cleaned.match(/ISBN[\s:\-]*(?:97[89][\s\-]*(?:\d[\s\-]*){9}\d|\d[\s\-]*(?:\d[\s\-]*){8}[\dXx])/i);
        if (m) {
            var digits = m[0].replace(/[^0-9Xx]/g, '');
            if (digits.length === 13 || digits.length === 10) return digits;
        }
        // Pattern 2: Standalone 13-digit starting with 978/979
        m = cleaned.match(/\b(97[89][\s\-]*(?:\d[\s\-]*){9}\d)\b/);
        if (m) {
            var digits = m[1].replace(/[^0-9]/g, '');
            if (digits.length === 13) return digits;
        }
        // Pattern 3: Hyphenated ISBN pattern like 979-11-5784-629-0
        m = cleaned.match(/\b(\d{3}[\-\s]\d{1,5}[\-\s]\d{1,7}[\-\s]\d{1,7}[\-\s]\d)\b/);
        if (m) {
            var digits = m[1].replace(/[^0-9]/g, '');
            if (digits.length === 13 || digits.length === 10) return digits;
        }
        // Pattern 4: Standalone 10-digit ISBN (less common, last resort)
        m = cleaned.match(/\b(\d{9}[\dXx])\b/);
        if (m) {
            return m[1].replace(/x/i, 'X');
        }
        // Pattern 5: Aggressive — collect all digits near "ISBN"/"SBN" keyword
        // For cases where OCR fragments digits with noise characters
        var isbnIdx = cleaned.search(/ISBN/i);
        if (isbnIdx >= 0) {
            var after = cleaned.substring(isbnIdx + 4);
            var allDigits = after.replace(/[^0-9Xx]/g, '');
            // Try to extract 13-digit or 10-digit ISBN from the collected digits
            if (allDigits.length >= 13) {
                var candidate = allDigits.substring(0, 13);
                if (/^97[89]/.test(candidate)) return candidate;
            }
            if (allDigits.length >= 10) {
                var candidate = allDigits.substring(0, 10);
                return candidate.replace(/x/i, 'X');
            }
        }
        return null;
    }

    // ── ISBN Check Digit Validation ──
    function isValidIsbn13(isbn) {
        if (!isbn || isbn.length !== 13 || !/^\d{13}$/.test(isbn)) return false;
        var sum = 0;
        for (var i = 0; i < 13; i++) {
            sum += parseInt(isbn[i], 10) * (i % 2 === 0 ? 1 : 3);
        }
        return sum % 10 === 0;
    }

    function isValidIsbn10(isbn) {
        if (!isbn || isbn.length !== 10 || !/^\d{9}[\dXx]$/.test(isbn)) return false;
        var sum = 0;
        for (var i = 0; i < 9; i++) {
            sum += parseInt(isbn[i], 10) * (10 - i);
        }
        var last = isbn[9].toUpperCase() === 'X' ? 10 : parseInt(isbn[9], 10);
        sum += last;
        return sum % 11 === 0;
    }

    function isValidIsbn(isbn) {
        if (!isbn) return false;
        if (isbn.length === 13) return isValidIsbn13(isbn);
        if (isbn.length === 10) return isValidIsbn10(isbn);
        return false;
    }

    // ── Single-digit ISBN checksum correction ──
    function tryCorrectIsbn(isbn) {
        if (!isbn) return null;
        var digits = isbn.replace(/[^0-9Xx]/g, '');
        if (digits.length !== 13 && digits.length !== 10) return null;
        // Try substituting each digit position with 0-9
        for (var i = 0; i < digits.length; i++) {
            for (var d = 0; d <= 9; d++) {
                var candidate = digits.substring(0, i) + d + digits.substring(i + 1);
                if (candidate !== digits && isValidIsbn(candidate)) {
                    return candidate;
                }
            }
        }
        return null;
    }

    // ── ISBN-10 to ISBN-13 Conversion ──
    function isbn10to13(isbn10) {
        if (!isbn10 || isbn10.length !== 10) return null;
        var base = '978' + isbn10.substring(0, 9);
        var sum = 0;
        for (var i = 0; i < 12; i++) {
            sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
        }
        var check = (10 - (sum % 10)) % 10;
        return base + check;
    }

    // ── ISBN Candidate Voting System ──
    // Track how many times each ISBN candidate appears across frames
    var _isbnCandidateVotes = {};  // { isbn: { count: N, confidence: totalConf, firstSeen: ts } }
    var _isbnVoteThreshold = 2;   // Require 2+ sightings to accept a candidate

    function voteIsbnCandidate(isbn, confidence) {
        if (!isbn) return null;
        var now = Date.now();
        // Normalize ISBN-10 to ISBN-13 for consistent voting
        var normalizedIsbn = isbn.length === 10 ? isbn10to13(isbn) : isbn;
        if (!normalizedIsbn) normalizedIsbn = isbn;

        if (!_isbnCandidateVotes[normalizedIsbn]) {
            _isbnCandidateVotes[normalizedIsbn] = { count: 0, confidence: 0, firstSeen: now };
        }
        var entry = _isbnCandidateVotes[normalizedIsbn];
        entry.count++;
        entry.confidence += (confidence || 0);

        // Expire old candidates (>12s old with no recent votes)
        var keys = Object.keys(_isbnCandidateVotes);
        for (var i = 0; i < keys.length; i++) {
            if (now - _isbnCandidateVotes[keys[i]].firstSeen > 12000 && _isbnCandidateVotes[keys[i]].count < _isbnVoteThreshold) {
                delete _isbnCandidateVotes[keys[i]];
            }
        }

        // High-confidence bypass: confidence 50%+ with valid checksum → accept immediately
        if (entry.count >= 1 && confidence >= 50 && isValidIsbn(normalizedIsbn)) {
            if (window.AppLogger) AppLogger.info('[ISBN] High-confidence bypass: ' + normalizedIsbn + ' (conf=' + confidence + '%, votes=' + entry.count + ')');
            return normalizedIsbn;
        }

        // Check if any candidate has reached the vote threshold
        if (entry.count >= _isbnVoteThreshold && isValidIsbn(normalizedIsbn)) {
            if (window.AppLogger) AppLogger.info('[ISBN] Candidate voted in: ' + normalizedIsbn + ' (votes=' + entry.count + ', avgConf=' + Math.round(entry.confidence / entry.count) + '%)');
            return normalizedIsbn;
        }

        // Also check if the original (non-normalized) has high votes
        if (isbn !== normalizedIsbn && _isbnCandidateVotes[isbn] && _isbnCandidateVotes[isbn].count >= _isbnVoteThreshold && isValidIsbn(isbn)) {
            return isbn;
        }

        return null;
    }

    function getBestVotedCandidate() {
        var bestIsbn = null, bestCount = 0;
        var keys = Object.keys(_isbnCandidateVotes);
        for (var i = 0; i < keys.length; i++) {
            var entry = _isbnCandidateVotes[keys[i]];
            if (entry.count > bestCount && isValidIsbn(keys[i])) {
                bestCount = entry.count;
                bestIsbn = keys[i];
            }
        }
        return bestCount >= _isbnVoteThreshold ? bestIsbn : null;
    }

    // ── ISBN Fragment Accumulation ──
    // Accumulate OCR digit fragments across frames and try to reconstruct a full ISBN
    function addIsbnFragment(ocrText) {
        if (!ocrText) return;
        var corrected = ocrCorrectDigits(ocrText);
        // Extract all digit sequences (3+ digits) from the OCR text
        var digitRuns = corrected.match(/\d{3,}/g);
        if (!digitRuns || digitRuns.length === 0) return;

        // Deduplicate: skip if identical to the last fragment (prevents redundant accumulation)
        if (_isbnFragments.length > 0) {
            var lastFrag = _isbnFragments[_isbnFragments.length - 1];
            if (lastFrag.digits.join(',') === digitRuns.join(',')) return;
        }

        _isbnFragments.push({ digits: digitRuns, raw: corrected, time: Date.now() });
        // Keep only last 15 fragments (sliding window ~10.5s at 700ms interval)
        if (_isbnFragments.length > 15) _isbnFragments.shift();

        // Expire fragments older than 10 seconds
        var now = Date.now();
        while (_isbnFragments.length > 0 && now - _isbnFragments[0].time > 10000) {
            _isbnFragments.shift();
        }
    }

    function extractIsbnFromFragments() {
        if (_isbnFragments.length < 2) return null;
        // Collect all digit runs from recent fragments
        var allDigits = '';
        for (var i = 0; i < _isbnFragments.length; i++) {
            allDigits += _isbnFragments[i].digits.join('') + ' ';
        }
        // Also merge all raw corrected text
        var allRaw = '';
        for (var i = 0; i < _isbnFragments.length; i++) {
            allRaw += _isbnFragments[i].raw + ' ';
        }
        // Try extracting ISBN from merged raw text first
        var isbn = extractIsbnFromText(allRaw);
        if (isbn && isValidIsbn(isbn)) return isbn;
        if (isbn) {
            var corrected = tryCorrectIsbn(isbn);
            if (corrected) return corrected;
        }
        // Try building 13-digit ISBN from all accumulated digits
        var pureDigits = allDigits.replace(/[^0-9]/g, '');
        // Search for 978/979 prefix in the digit stream
        for (var start = 0; start <= pureDigits.length - 13; start++) {
            var candidate = pureDigits.substring(start, start + 13);
            if (/^97[89]/.test(candidate) && isValidIsbn13(candidate)) {
                return candidate;
            }
        }
        // Try with single-digit correction
        for (var start = 0; start <= pureDigits.length - 13; start++) {
            var candidate = pureDigits.substring(start, start + 13);
            if (/^97[89]/.test(candidate)) {
                var corrected = tryCorrectIsbn(candidate);
                if (corrected) return corrected;
            }
        }
        return null;
    }

    async function initOcrWorker() {
        if (_ocrWorker) return _ocrWorker;
        if (_ocrInitFailed) return null;
        // Lazy-load Tesseract.js on first OCR use
        if (typeof Tesseract === 'undefined') {
            try {
                if (window.AppLogger) AppLogger.info('[ISBN] Lazy-loading Tesseract.js');
                await new Promise(function(resolve, reject) {
                    var s = document.createElement('script');
                    s.src = 'tesseract.min.js';
                    s.onload = resolve;
                    s.onerror = reject;
                    document.head.appendChild(s);
                });
            } catch(loadErr) {
                if (window.AppLogger) AppLogger.warn('[ISBN] Tesseract.js lazy-load failed');
                _ocrInitFailed = true;
                return null;
            }
        }
        if (typeof Tesseract === 'undefined') {
            if (window.AppLogger) AppLogger.warn('[ISBN] Tesseract.js not available after load');
            _ocrInitFailed = true;
            return null;
        }
        try {
            if (window.AppLogger) AppLogger.info('[ISBN] Initializing OCR worker');
            _ocrWorker = await Tesseract.createWorker('eng', 1, {
                logger: function() {},
                workerPath: 'worker.min.js',
                corePath: 'tesseract-core/',
                langPath: 'tesseract-lang/',
                gzip: false,
                workerBlobURL: false
            });
            await _ocrWorker.setParameters({
                tessedit_pageseg_mode: '11',
                tessedit_char_whitelist: '0123456789ISBNisbn-Xx:. '
            });
            if (window.AppLogger) AppLogger.info('[ISBN] OCR worker ready');
            return _ocrWorker;
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] OCR worker init error', { message: e.message });
            console.warn('OCR worker init error:', e);
            _ocrWorker = null;
            _ocrInitFailed = true;
            stopOcrInterval();
            return null;
        }
    }

    // ── Otsu inter-class variance (measures how well a histogram separates into two groups) ──
    function _otsuVariance(hist, total) {
        var sumAll = 0;
        for (var t = 0; t < 256; t++) sumAll += t * hist[t];
        var sumBg = 0, wBg = 0, maxVar = 0;
        for (var t = 0; t < 256; t++) {
            wBg += hist[t];
            if (wBg === 0) continue;
            var wFg = total - wBg;
            if (wFg === 0) break;
            sumBg += t * hist[t];
            var diff = (sumBg / wBg) - ((sumAll - sumBg) / wFg);
            var v = wBg * wFg * diff * diff;
            if (v > maxVar) maxVar = v;
        }
        return maxVar;
    }

    // ── OCR Image Preprocessing (grayscale → sharpen → adaptive binarization → upscale) ──
    function preprocessForOcr(srcCanvas) {
        var w = srcCanvas.width;
        var h = srcCanvas.height;
        var ctx = srcCanvas.getContext('2d');
        var imgData = ctx.getImageData(0, 0, w, h);
        var data = imgData.data;

        // Step 1: Grayscale using max(R,G,B) — better for warm-colored backgrounds
        // Orange bg: R=high → max=high → white; Dark text: all low → max=low → dark
        // Save original RGBA to compare with luminosity method
        var origRgba = new Uint8Array(data);
        var maxHist = new Array(256).fill(0);
        var histogram = new Array(256).fill(0);
        var minGray = 255, maxGray = 0;
        var graySum = 0;
        for (var i = 0; i < data.length; i += 4) {
            var gray = Math.max(data[i], data[i + 1], data[i + 2]);
            data[i] = data[i + 1] = data[i + 2] = gray;
            graySum += gray;
            maxHist[gray]++;
            if (gray < minGray) minGray = gray;
            if (gray > maxGray) maxGray = gray;
        }

        // Step 1 fallback: compare Otsu inter-class variance between max(RGB) and luminosity.
        // max(RGB) fails on blue/cool backgrounds where B≈high maps both background and
        // white text to similar high values. Luminosity preserves that contrast.
        // Use Otsu variance as the decision metric — it measures how well pixels
        // separate into two groups, which directly predicts binarization quality.
        var totalPixels = w * h;
        var lumHist = new Array(256).fill(0);
        var lumMin = 255, lumMax = 0, lumSum = 0;
        for (var i = 0; i < origRgba.length; i += 4) {
            var lum = Math.round(0.299 * origRgba[i] + 0.587 * origRgba[i + 1] + 0.114 * origRgba[i + 2]);
            lumHist[lum]++;
            lumSum += lum;
            if (lum < lumMin) lumMin = lum;
            if (lum > lumMax) lumMax = lum;
        }
        // Quick Otsu variance for both methods
        var maxOtsu = _otsuVariance(maxHist, totalPixels);
        var lumOtsu = _otsuVariance(lumHist, totalPixels);
        if (lumOtsu > maxOtsu) {
            // Luminosity gives better text/background separation — apply it
            minGray = lumMin; maxGray = lumMax; graySum = lumSum;
            histogram = lumHist;
            for (var i = 0; i < data.length; i += 4) {
                var lum = Math.round(0.299 * origRgba[i] + 0.587 * origRgba[i + 1] + 0.114 * origRgba[i + 2]);
                data[i] = data[i + 1] = data[i + 2] = lum;
            }
        } else {
            histogram = maxHist;
        }

        // Step 1a: Adaptive dark background handling
        // If mean brightness < 100, image is likely white text on dark bg → invert early
        var meanGray = graySum / totalPixels;
        if (meanGray < 100) {
            for (var i = 0; i < data.length; i += 4) {
                var inv = 255 - data[i];
                data[i] = data[i + 1] = data[i + 2] = inv;
            }
            // Recalc actual min/max from inverted data
            minGray = 255; maxGray = 0;
            for (var i = 0; i < data.length; i += 4) {
                if (data[i] < minGray) minGray = data[i];
                if (data[i] > maxGray) maxGray = data[i];
            }
        }

        // Step 1b: Contrast stretching (normalize gray range to 0-255)
        var grayRange = maxGray - minGray;
        if (grayRange > 0 && grayRange < 200) {
            for (var i = 0; i < data.length; i += 4) {
                var stretched = Math.round(((data[i] - minGray) / grayRange) * 255);
                if (stretched < 0) stretched = 0;
                if (stretched > 255) stretched = 255;
                data[i] = data[i + 1] = data[i + 2] = stretched;
            }
        }

        // Step 1c: Unsharp mask sharpening — sharpens blurry camera text
        // kernel: center = 5, neighbors = -1 (3x3 Laplacian-based unsharp)
        ctx.putImageData(imgData, 0, 0);
        var sharpData = ctx.getImageData(0, 0, w, h);
        var sd = sharpData.data;
        var strength = 0.6; // sharpening strength (0=none, 1=full)
        for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
                var idx = (y * w + x) * 4;
                var center = data[idx];
                var neighbors = data[((y-1)*w+x)*4] + data[((y+1)*w+x)*4] +
                                data[(y*w+x-1)*4] + data[(y*w+x+1)*4];
                var sharp = center + strength * (4 * center - neighbors);
                if (sharp < 0) sharp = 0;
                if (sharp > 255) sharp = 255;
                sd[idx] = sd[idx+1] = sd[idx+2] = Math.round(sharp);
            }
        }
        ctx.putImageData(sharpData, 0, 0);
        imgData = ctx.getImageData(0, 0, w, h);
        data = imgData.data;

        // Recompute histogram after stretching + sharpening
        histogram.fill(0);
        for (var i = 0; i < data.length; i += 4) {
            histogram[data[i]]++;
        }

        // Step 2: Adaptive local thresholding with Otsu fallback
        // Use block-based local thresholding for uneven lighting (shadows, glare)
        var blockSize = Math.max(15, Math.floor(Math.min(w, h) / 8) | 1);
        if (blockSize % 2 === 0) blockSize++;
        var useLocalThreshold = false;

        // Detect uneven lighting: check if std deviation of block means is high
        var blockMeans = [];
        var bStep = Math.max(1, Math.floor(blockSize / 2));
        for (var by = 0; by < h; by += bStep) {
            for (var bx = 0; bx < w; bx += bStep) {
                var bSum = 0, bCount = 0;
                for (var dy = 0; dy < bStep && by + dy < h; dy++) {
                    for (var dx = 0; dx < bStep && bx + dx < w; dx++) {
                        bSum += data[((by+dy)*w+(bx+dx))*4];
                        bCount++;
                    }
                }
                if (bCount > 0) blockMeans.push(bSum / bCount);
            }
        }
        if (blockMeans.length > 4) {
            var bmMean = 0;
            for (var i = 0; i < blockMeans.length; i++) bmMean += blockMeans[i];
            bmMean /= blockMeans.length;
            var bmVar = 0;
            for (var i = 0; i < blockMeans.length; i++) bmVar += (blockMeans[i] - bmMean) * (blockMeans[i] - bmMean);
            var bmStd = Math.sqrt(bmVar / blockMeans.length);
            // High std deviation → uneven lighting → use local thresholding
            useLocalThreshold = bmStd > 35;
        }

        if (useLocalThreshold) {
            // Sauvola-inspired local thresholding
            var halfBlock = Math.floor(blockSize / 2);
            var localResult = new Uint8Array(w * h);
            // Build integral image for fast local mean computation
            var integral = new Float64Array((w + 1) * (h + 1));
            var integralSq = new Float64Array((w + 1) * (h + 1));
            for (var y = 0; y < h; y++) {
                var rowSum = 0, rowSumSq = 0;
                for (var x = 0; x < w; x++) {
                    var v = data[(y * w + x) * 4];
                    rowSum += v;
                    rowSumSq += v * v;
                    integral[(y+1)*(w+1)+(x+1)] = integral[y*(w+1)+(x+1)] + rowSum;
                    integralSq[(y+1)*(w+1)+(x+1)] = integralSq[y*(w+1)+(x+1)] + rowSumSq;
                }
            }
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    var x1 = Math.max(0, x - halfBlock);
                    var y1 = Math.max(0, y - halfBlock);
                    var x2 = Math.min(w - 1, x + halfBlock);
                    var y2 = Math.min(h - 1, y + halfBlock);
                    var area = (x2 - x1 + 1) * (y2 - y1 + 1);
                    var sum = integral[(y2+1)*(w+1)+(x2+1)] - integral[y1*(w+1)+(x2+1)]
                            - integral[(y2+1)*(w+1)+x1] + integral[y1*(w+1)+x1];
                    var sumSq = integralSq[(y2+1)*(w+1)+(x2+1)] - integralSq[y1*(w+1)+(x2+1)]
                              - integralSq[(y2+1)*(w+1)+x1] + integralSq[y1*(w+1)+x1];
                    var localMean = sum / area;
                    var localVar = (sumSq / area) - (localMean * localMean);
                    var localStd = Math.sqrt(Math.max(0, localVar));
                    // Sauvola threshold: T = mean * (1 + k * (std/R - 1)), k=0.2, R=128
                    var threshold = localMean * (1 + 0.2 * (localStd / 128 - 1));
                    localResult[y * w + x] = data[(y * w + x) * 4] >= threshold ? 255 : 0;
                }
            }
            var blackCount = 0;
            for (var i = 0; i < localResult.length; i++) {
                var val = localResult[i];
                data[i*4] = data[i*4+1] = data[i*4+2] = val;
                if (val === 0) blackCount++;
            }
            if (blackCount > totalPixels * 0.6) {
                for (var i = 0; i < data.length; i += 4) {
                    data[i] = data[i+1] = data[i+2] = data[i] === 0 ? 255 : 0;
                }
            }
        } else {
            // Fallback: global Otsu thresholding (uniform lighting)
            var sumAll = 0;
            for (var t = 0; t < 256; t++) sumAll += t * histogram[t];
            var sumBg = 0, weightBg = 0, maxVariance = 0, bestThreshold = 128;
            for (var t = 0; t < 256; t++) {
                weightBg += histogram[t];
                if (weightBg === 0) continue;
                var weightFg = totalPixels - weightBg;
                if (weightFg === 0) break;
                sumBg += t * histogram[t];
                var meanBg = sumBg / weightBg;
                var meanFg = (sumAll - sumBg) / weightFg;
                var variance = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg);
                if (variance > maxVariance) {
                    maxVariance = variance;
                    bestThreshold = t;
                }
            }
            if (bestThreshold < 30) bestThreshold = 30;
            if (bestThreshold > 225) bestThreshold = 225;

            var blackCount = 0;
            for (var i = 0; i < data.length; i += 4) {
                var val = data[i] >= bestThreshold ? 255 : 0;
                data[i] = data[i + 1] = data[i + 2] = val;
                if (val === 0) blackCount++;
            }
            if (blackCount > totalPixels * 0.6) {
                for (var i = 0; i < data.length; i += 4) {
                    data[i] = data[i + 1] = data[i + 2] = data[i] === 0 ? 255 : 0;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // Step 3: 2x upscale with bilinear interpolation (cap width at 2000px)
        // Dilation removed — was distorting digit shapes more than helping
        var scale = Math.min(2, 2000 / w);
        var upW = Math.floor(w * scale);
        var upH = Math.floor(h * scale);
        var upCanvas = document.createElement('canvas');
        upCanvas.width = upW;
        upCanvas.height = upH;
        var upCtx = upCanvas.getContext('2d');
        upCtx.imageSmoothingEnabled = true;
        upCtx.imageSmoothingQuality = 'high';
        upCtx.drawImage(srcCanvas, 0, 0, upW, upH);

        // Step 5: Add white border padding (Tesseract struggles with edge-touching text)
        var pad = 10;
        var paddedCanvas = document.createElement('canvas');
        paddedCanvas.width = upW + pad * 2;
        paddedCanvas.height = upH + pad * 2;
        var paddedCtx = paddedCanvas.getContext('2d');
        paddedCtx.fillStyle = '#FFFFFF';
        paddedCtx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
        paddedCtx.drawImage(upCanvas, pad, pad);
        return paddedCanvas;
    }

    // ── Rotate canvas 90° clockwise ──
    function rotateCanvas90CW(srcCanvas) {
        var rotCanvas = document.createElement('canvas');
        rotCanvas.width = srcCanvas.height;
        rotCanvas.height = srcCanvas.width;
        var rotCtx = rotCanvas.getContext('2d');
        rotCtx.translate(rotCanvas.width, 0);
        rotCtx.rotate(Math.PI / 2);
        rotCtx.drawImage(srcCanvas, 0, 0);
        return rotCanvas;
    }

    // ── Rotate canvas 90° counter-clockwise ──
    function rotateCanvas90CCW(srcCanvas) {
        var rotCanvas = document.createElement('canvas');
        rotCanvas.width = srcCanvas.height;
        rotCanvas.height = srcCanvas.width;
        var rotCtx = rotCanvas.getContext('2d');
        rotCtx.translate(0, rotCanvas.height);
        rotCtx.rotate(-Math.PI / 2);
        rotCtx.drawImage(srcCanvas, 0, 0);
        return rotCanvas;
    }

    // ── Rotated Barcode Detection ──
    // Html5Qrcode only detects horizontal barcodes; Korean books often have vertical barcodes
    // Scans full frame + partial regions (right 30%, bottom 35%) with CW/CCW rotations
    var _rotatedScanCounter = 0;
    async function tryRotatedBarcodeScan(videoEl) {
        var w = videoEl.videoWidth;
        var h = videoEl.videoHeight;
        if (!w || !h) return null;

        // Full frame + partial regions for Korean book barcode positions
        var regions = [
            { x: 0, y: 0, w: w, h: h, label: 'full' },
            { x: Math.floor(w * 0.70), y: 0, w: Math.floor(w * 0.30), h: h, label: 'right30' },
            { x: 0, y: Math.floor(h * 0.65), w: w, h: Math.floor(h * 0.35), label: 'bottom35' }
        ];

        var scanConfig = {
            formatsToSupport: [
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E
            ]
        };

        for (var ri = 0; ri < regions.length; ri++) {
            var region = regions[ri];
            var canvas = document.createElement('canvas');
            canvas.width = region.w;
            canvas.height = region.h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(videoEl, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);

            var rotations = [
                { canvas: rotateCanvas90CW(canvas), label: '90CW-' + region.label },
                { canvas: rotateCanvas90CCW(canvas), label: '90CCW-' + region.label }
            ];

            for (var rj = 0; rj < rotations.length; rj++) {
                try {
                    var rotCanvas = rotations[rj].canvas;
                    var blob = await new Promise(function(resolve) {
                        rotCanvas.toBlob(function(b) { resolve(b); }, 'image/jpeg', 0.85);
                    });
                    if (!blob) continue;
                    var file = new File([blob], 'rotated.jpg', { type: 'image/jpeg' });
                    var scanner = new Html5Qrcode('isbn-rotated-scan-' + Date.now(), false);
                    var result = await scanner.scanFileV2(file, false, scanConfig);
                    scanner.clear();
                    if (result && result.decodedText) {
                        var barcode = result.decodedText.replace(/[-\s]/g, '');
                        if (isValidIsbn(barcode)) {
                            if (window.AppLogger) AppLogger.info('[ISBN] Rotated barcode (' + rotations[rj].label + '): ' + barcode);
                            return barcode;
                        }
                    }
                } catch(e) {
                    // scanFileV2 throws when no barcode found — expected
                }
            }
        }
        return null;
    }

    var _ocrFrameIndex = 0;

    function hasIsbnLikeSignal(text) {
        if (!text) return false;
        var compact = text.replace(/\s+/g, '');
        // e.g. ISBN..., SBN..., or long numeric sequences often seen in OCR output
        if (/I?SBN/i.test(compact)) return true;
        // Require at least one cluster of 3+ consecutive digits.
        // Scattered single digits from Korean/CJK misrecognition don't count —
        // real ISBNs always contain consecutive digit sequences (978, 979, etc.)
        var clusters = compact.match(/\d{3,}/g);
        if (!clusters) return false;
        var clusterDigits = 0;
        for (var i = 0; i < clusters.length; i++) clusterDigits += clusters[i].length;
        return clusterDigits >= 5;
    }

    async function ocrCaptureFrame() {
        if (_ocrProcessing) return;
        _ocrProcessing = true;
        try {
            var videoEl = document.querySelector('#isbn-scanner-reader video');
            if (!videoEl || videoEl.readyState < 2) { _ocrProcessing = false; return; }

            var w = videoEl.videoWidth;
            var h = videoEl.videoHeight;

            // ── Rotated barcode detection (every frame — critical for Korean vertical barcodes) ──
            _rotatedScanCounter++;
            if (true) {
                var rotatedIsbn = await tryRotatedBarcodeScan(videoEl);
                if (rotatedIsbn) {
                    stopOcrInterval();
                    var statusEl = document.getElementById('isbn-scanner-status');
                    if (statusEl) statusEl.textContent = 'ISBN: ' + rotatedIsbn;
                    var field = document.getElementById('isbn-manual-field');
                    if (field) field.value = rotatedIsbn;
                    try { if (_html5QrCode) await _html5QrCode.stop(); } catch(e) {}
                    _ocrProcessing = false;
                    await onIsbnScanned(rotatedIsbn);
                    return;
                }
            }

            // ── Region selection with lock-on support ──
            var cropY, cropH, cropX, cropW, psmMode, rotation;
            var cropIndex;

            if (_lockedCropIndex >= 0) {
                // Lock-on mode: cycle through locked region + 2 neighbors
                var neighbors = [_lockedCropIndex, (_lockedCropIndex + 1) % 4, (_lockedCropIndex + 3) % 4];
                cropIndex = neighbors[_lockSubIndex % 3];
                _lockSubIndex++;
            } else {
                cropIndex = _ocrFrameIndex % 4;
            }

            // 4 core OCR regions — faster cycle (1.6s vs 3.5s with 7 regions)
            cropX = 0;
            cropW = w;
            cropY = 0;
            cropH = h;
            rotation = 0; // 0 = none, 1 = 90° CW, -1 = 90° CCW
            if (cropIndex === 0) {
                // Bottom horizontal strip (most common ISBN location)
                cropY = Math.floor(h * 0.75);
                cropH = Math.floor(h * 0.25);
                psmMode = '7';
            } else if (cropIndex === 1) {
                // Right vertical strip (Korean vertical barcodes)
                cropX = Math.floor(w * 0.75);
                cropW = Math.floor(w * 0.25);
                cropY = Math.floor(h * 0.05);
                cropH = Math.floor(h * 0.90);
                rotation = -1;
                psmMode = '7';
            } else if (cropIndex === 2) {
                // Center-bottom wide strip (barcode text below)
                cropX = Math.floor(w * 0.10);
                cropW = Math.floor(w * 0.80);
                cropY = Math.floor(h * 0.70);
                cropH = Math.floor(h * 0.30);
                psmMode = '6';
            } else {
                // Left vertical strip
                cropX = 0;
                cropW = Math.floor(w * 0.25);
                cropY = Math.floor(h * 0.05);
                cropH = Math.floor(h * 0.90);
                rotation = 1;
                psmMode = '7';
            }
            _ocrFrameIndex++;

            var canvas = document.createElement('canvas');
            canvas.width = cropW;
            canvas.height = cropH;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

            if (rotation === 1) {
                canvas = rotateCanvas90CW(canvas);
            } else if (rotation === -1) {
                canvas = rotateCanvas90CCW(canvas);
            }

            var processed = preprocessForOcr(canvas);

            var worker = await initOcrWorker();
            if (!worker) { _ocrProcessing = false; return; }

            await worker.setParameters({
                tessedit_pageseg_mode: psmMode,
                tessedit_char_whitelist: '0123456789ISBNisbn-Xx:. '
            });

            var result = await worker.recognize(processed);
            var ocrText = result.data.text;
            var confidence = Math.round(result.data.confidence || 0);

            // ── Region lock-on management ──
            // Require minimum confidence for lock-on to avoid locking onto garbled
            // output from Korean/CJK text misrecognized as digits
            var hasSignal = hasIsbnLikeSignal(ocrText) && confidence >= 15;
            if (hasSignal && _lockedCropIndex < 0) {
                _lockedCropIndex = cropIndex;
                _lockMissCount = 0;
                _lockSubIndex = 0;
                if (window.AppLogger) AppLogger.info('[ISBN] Region lock-on: cropIndex=' + cropIndex);
            } else if (hasSignal && _lockedCropIndex >= 0) {
                _lockMissCount = 0;
            } else if (!hasSignal && _lockedCropIndex >= 0) {
                _lockMissCount++;
                if (_lockMissCount >= 5) {
                    if (window.AppLogger) AppLogger.info('[ISBN] Region lock released (5 misses)');
                    _lockedCropIndex = -1;
                    _lockMissCount = 0;
                    _lockSubIndex = 0;
                }
            }

            if (confidence < 8 && !hasSignal) {
                if (window.AppLogger) AppLogger.debug('[ISBN] OCR skipped (low confidence: ' + confidence + '%)');
                _ocrProcessing = false;
                return;
            }

            // ── Fragment accumulation (always, even for low-confidence results with digits) ──
            addIsbnFragment(ocrText);

            var isbn = extractIsbnFromText(ocrText);
            if (window.AppLogger && ocrText && ocrText.trim()) {
                AppLogger.debug('[ISBN] OCR text: ' + ocrText.trim().substring(0, 100), {
                    extractedIsbn: isbn || 'none',
                    confidence: confidence,
                    cropIndex: cropIndex,
                    rotation: rotation || 0,
                    locked: _lockedCropIndex >= 0
                });
            }
            // Try checksum correction if ISBN-like but invalid
            if (isbn && !isValidIsbn(isbn)) {
                var corrected = tryCorrectIsbn(isbn);
                if (corrected) {
                    if (window.AppLogger) AppLogger.info('[ISBN] OCR checksum-corrected: ' + isbn + ' → ' + corrected);
                    isbn = corrected;
                }
            }

            // ── Candidate voting: register valid ISBNs and require 2+ sightings ──
            if (isbn && isValidIsbn(isbn)) {
                var votedIsbn = voteIsbnCandidate(isbn, confidence);
                if (!votedIsbn) {
                    // First sighting — don't act yet, wait for confirmation
                    if (window.AppLogger) AppLogger.debug('[ISBN] Candidate registered (awaiting confirmation): ' + isbn);
                    isbn = null; // suppress immediate action
                } else {
                    isbn = votedIsbn; // Use normalized (ISBN-13) version
                }
            }

            // ── Try fragment accumulation if single-frame extraction failed ──
            if (!isbn || !isValidIsbn(isbn)) {
                var fragIsbn = extractIsbnFromFragments();
                if (fragIsbn) {
                    if (window.AppLogger) AppLogger.info('[ISBN] Fragment accumulation found ISBN: ' + fragIsbn, { fragmentCount: _isbnFragments.length });
                    // Fragment results also go through voting
                    var votedFrag = voteIsbnCandidate(fragIsbn, confidence);
                    isbn = votedFrag || null;
                }
            }

            // ── Check if any candidate has enough votes even without new extraction ──
            if (!isbn) {
                isbn = getBestVotedCandidate();
            }

            if (isbn && isValidIsbn(isbn)) {
                // Normalize ISBN-10 to ISBN-13 for API compatibility
                if (isbn.length === 10) {
                    var isbn13 = isbn10to13(isbn);
                    if (isbn13) {
                        if (window.AppLogger) AppLogger.info('[ISBN] Converted ISBN-10→13: ' + isbn + ' → ' + isbn13);
                        isbn = isbn13;
                    }
                }
                if (window.AppLogger) AppLogger.info('[ISBN] OCR detected valid ISBN: ' + isbn);
                stopOcrInterval();
                var statusEl = document.getElementById('isbn-scanner-status');
                if (statusEl) statusEl.textContent = 'ISBN (OCR): ' + isbn;
                var field = document.getElementById('isbn-manual-field');
                if (field) field.value = isbn;
                try { if (_html5QrCode) await _html5QrCode.stop(); } catch(e) {}
                await onIsbnScanned(isbn);
            } else if (isbn) {
                if (window.AppLogger) AppLogger.debug('[ISBN] OCR found ISBN-like but invalid checksum: ' + isbn);
            }
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] OCR frame error', { message: e.message });
            console.warn('OCR frame error:', e);
        }
        _ocrProcessing = false;
    }

    let _ocrDelayTimer = null;

    function startOcrInterval() {
        stopOcrInterval();
        _ocrInitFailed = false;
        // Reset precision tracking state
        _isbnFragments = [];
        _lockedCropIndex = -1;
        _lockMissCount = 0;
        _lockSubIndex = 0;
        _rotatedScanCounter = 0;
        _isbnCandidateVotes = {};
        // Delay OCR start: barcode scanner is primary, OCR is fallback after a short delay
        _ocrDelayTimer = setTimeout(function() {
            _ocrDelayTimer = null;
            _ocrFrameIndex = 0;
            if (window.AppLogger) AppLogger.info('[ISBN] OCR fallback starting (barcode not detected)');
            _ocrInterval = setInterval(ocrCaptureFrame, 400);
        }, 800);
    }

    function stopOcrInterval() {
        if (_ocrDelayTimer) { clearTimeout(_ocrDelayTimer); _ocrDelayTimer = null; }
        if (_ocrInterval) { clearInterval(_ocrInterval); _ocrInterval = null; }
        // Clear tracking state on stop
        _isbnFragments = [];
        _lockedCropIndex = -1;
        _lockMissCount = 0;
        _lockSubIndex = 0;
        _isbnCandidateVotes = {};
    }
    let _libCurrentTab = 'reading';
    let _libCurrentPeriod = 'total';
    let _libCurrentView = 'tower';
    let _libTowerTheme = localStorage.getItem('libTowerTheme') || 'dark';
    let _libSearchQuery = '';
    let _libLocalSearch = false;  // false = API search, true = local filter
    let _libSelectedYear = new Date().getFullYear();
    let _libSelectedMonth = new Date().getMonth() + 1; // 1-12
    let _libDatePickerMode = 'yearly'; // 'yearly' or 'monthly'
    let _libPickerYear = new Date().getFullYear();
    let _libPickerMonth = new Date().getMonth() + 1;
    let _apiSearchTimer = null;
    let _apiSearchPage = 1;
    let _apiSearchHasMore = false;
    let _apiSearchQuery = '';
    let _apiSearchResults = [];

    function t(key) {
        const lang = AppState.currentLang || 'ko';
        return (i18n[lang] && i18n[lang][key]) || (i18n.ko && i18n.ko[key]) || key;
    }

    function getTodayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }

    // ── Library Card Count (status screen) — 읽은책 기준 ──
    window.updateLibraryCardCount = function() {
        const books = (AppState.library && AppState.library.books) || [];
        const year = new Date().getFullYear();
        const yearlyCount = books.filter(b => b.category === 'read' && new Date(b.addedDate).getFullYear() === year).length;
        const el = document.getElementById('lib-yearly-card-count');
        if (el) el.textContent = yearlyCount;
    };

    // ── Library View ──
    window.openLibraryView = function() {
        const overlay = document.getElementById('library-overlay');
        if (!overlay) return;
        overlay.classList.remove('d-none');
        _libCurrentTab = 'read';
        _libCurrentPeriod = 'total';
        _libCurrentView = (_libCurrentTab === 'read') ? 'tower' : 'list';
        _libSearchQuery = '';
        _libLocalSearch = false;
        _apiSearchResults = [];
        _apiSearchQuery = '';
        _apiSearchPage = 1;
        _apiSearchHasMore = false;
        const searchInput = document.getElementById('library-search-input');
        if (searchInput) searchInput.value = '';
        const localCheckbox = document.getElementById('library-local-filter');
        if (localCheckbox) localCheckbox.checked = false;
        const searchResults = document.getElementById('library-search-results');
        if (searchResults) { searchResults.classList.add('d-none'); searchResults.innerHTML = ''; }
        _libSelectedYear = new Date().getFullYear();
        _libSelectedMonth = new Date().getMonth() + 1;
        showLibraryMainContent(true);
        updateLibraryTabs();
        updateLibraryViewToggle();
        updateLibraryCounts();
        updateLibraryPeriodLabels();
        updateLibraryPeriodBtns();
        renderLibrary();
        window.updateLibraryCardCount();
        // Trigger i18n re-apply for dynamically shown overlay
        if (typeof window.changeLanguage === 'function') window.changeLanguage(AppState.currentLang);
        // 보상형 광고 프리로드 (이미지 저장 시 사용)
        if (window.AdManager) window.AdManager.preloadRewarded();
    };

    window.closeLibraryView = function() {
        const overlay = document.getElementById('library-overlay');
        if (overlay) overlay.classList.add('d-none');
        // (배너 광고 제거됨 — 보상형 광고로 전환)
        // 뒤로가기 시 상태창으로 이동
        const statusNav = document.querySelector('.nav-item[data-tab="status"]');
        if (statusNav) {
            window.switchTab('status', statusNav);
        }
    };

    window.switchLibraryTab = function(cat) {
        _libCurrentTab = cat;
        // Only 읽은책 (read) tab supports tower view
        if (cat !== 'read') {
            _libCurrentView = 'list';
        }
        updateLibraryTabs();
        updateLibraryViewToggle();
        updateLibraryCounts();
        renderLibrary();
    };

    window.switchLibraryPeriod = function(period) {
        _libCurrentPeriod = period;
        updateLibraryPeriodBtns();
        updateLibraryCounts();
        updateLibraryPeriodLabels();
        renderLibrary();
    };

    window.openLibraryDatePicker = function(mode) {
        // If already active on this period, open picker; otherwise just switch to it
        if (_libCurrentPeriod !== (mode === 'monthly' ? 'monthly' : 'yearly')) {
            _libCurrentPeriod = (mode === 'monthly') ? 'monthly' : 'yearly';
            updateLibraryPeriodBtns();
            updateLibraryCounts();
            updateLibraryPeriodLabels();
            renderLibrary();
            return;
        }
        _libDatePickerMode = mode;
        _libPickerYear = _libSelectedYear;
        _libPickerMonth = _libSelectedMonth;
        renderLibraryDatePicker();
        const overlay = document.getElementById('lib-date-picker-overlay');
        if (overlay) overlay.classList.remove('d-none');
    };

    window.closeLibraryDatePicker = function(e) {
        if (e && e.target && !e.target.classList.contains('lib-date-picker-overlay')) return;
        const overlay = document.getElementById('lib-date-picker-overlay');
        if (overlay) overlay.classList.add('d-none');
    };

    window.confirmLibraryDatePicker = function() {
        _libSelectedYear = _libPickerYear;
        _libSelectedMonth = _libPickerMonth;
        _libCurrentPeriod = _libDatePickerMode;
        updateLibraryPeriodBtns();
        updateLibraryCounts();
        updateLibraryPeriodLabels();
        renderLibrary();
        const overlay = document.getElementById('lib-date-picker-overlay');
        if (overlay) overlay.classList.add('d-none');
    };

    function getAvailableYears() {
        const books = (AppState.library && AppState.library.books) || [];
        const years = new Set();
        books.forEach(b => {
            if (b.addedDate) years.add(new Date(b.addedDate).getFullYear());
        });
        // Always include current year
        years.add(new Date().getFullYear());
        return Array.from(years).sort((a, b) => b - a);
    }

    function getAvailableMonths(year) {
        const books = (AppState.library && AppState.library.books) || [];
        const months = new Set();
        books.forEach(b => {
            if (b.addedDate) {
                const d = new Date(b.addedDate);
                if (d.getFullYear() === year) months.add(d.getMonth() + 1);
            }
        });
        // If selected year is current year, include current month
        const now = new Date();
        if (year === now.getFullYear()) months.add(now.getMonth() + 1);
        return Array.from(months).sort((a, b) => a - b);
    }

    function renderLibraryDatePicker() {
        const yearsContainer = document.getElementById('lib-date-picker-years');
        const monthsContainer = document.getElementById('lib-date-picker-months');
        if (!yearsContainer || !monthsContainer) return;

        const years = getAvailableYears();
        yearsContainer.innerHTML = years.map(y =>
            '<div class="lib-date-picker-item' + (y === _libPickerYear ? ' selected' : '') +
            '" onclick="window.selectLibraryPickerYear(' + y + ')">' + y + '년</div>'
        ).join('');

        updateLibraryPickerMonths();
    }

    function updateLibraryPickerMonths() {
        const monthsContainer = document.getElementById('lib-date-picker-months');
        if (!monthsContainer) return;

        if (_libDatePickerMode === 'yearly') {
            monthsContainer.innerHTML = '<div style="text-align:center;color:var(--text-sub);font-size:0.8rem;padding:16px;">연도별 필터</div>';
            return;
        }

        const allMonths = [1,2,3,4,5,6,7,8,9,10,11,12];
        const availableMonths = new Set(getAvailableMonths(_libPickerYear));
        monthsContainer.innerHTML = allMonths.map(m => {
            const available = availableMonths.has(m);
            return '<div class="lib-date-picker-item' +
                (m === _libPickerMonth ? ' selected' : '') +
                (!available ? ' disabled' : '') +
                '" ' + (available ? 'onclick="window.selectLibraryPickerMonth(' + m + ')"' : '') +
                ' style="' + (!available ? 'opacity:0.3;cursor:default;' : '') + '">' +
                m + '월</div>';
        }).join('');
    }

    window.selectLibraryPickerYear = function(y) {
        _libPickerYear = y;
        // If currently selected month has no data in new year, pick first available
        const availMonths = getAvailableMonths(y);
        if (availMonths.length > 0 && !availMonths.includes(_libPickerMonth)) {
            _libPickerMonth = availMonths[availMonths.length - 1]; // latest month
        }
        renderLibraryDatePicker();
    };

    window.selectLibraryPickerMonth = function(m) {
        _libPickerMonth = m;
        updateLibraryPickerMonths();
        // Update selection visual
        document.querySelectorAll('#lib-date-picker-months .lib-date-picker-item').forEach(el => {
            el.classList.toggle('selected', parseInt(el.textContent) === m);
        });
    };

    function updateLibraryPeriodLabels() {
        const yearLabel = document.getElementById('lib-label-yearly');
        const monthLabel = document.getElementById('lib-label-monthly');
        const totalLabel = document.getElementById('lib-label-total');
        if (totalLabel) totalLabel.textContent = t('lib_total');
        if (yearLabel) yearLabel.textContent = _libSelectedYear + (AppState.currentLang === 'en' ? '' : '년');
        if (monthLabel) monthLabel.textContent = _libSelectedYear + '-' + String(_libSelectedMonth).padStart(2, '0');
    }

    window.switchLibraryViewMode = function(mode) {
        // Only allow tower view for 읽은책 tab
        if (mode === 'tower' && _libCurrentTab !== 'read') return;
        _libCurrentView = mode;
        updateLibraryViewToggle();
        renderLibrary();
    };

    function updateLibraryViewToggle() {
        document.querySelectorAll('.lib-view-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === _libCurrentView);
            // Disable tower button for non-read tabs
            if (b.dataset.view === 'tower') {
                b.classList.toggle('disabled', _libCurrentTab !== 'read');
            }
        });
        // Show/hide theme picker (only for tower view on read tab)
        var picker = document.getElementById('tower-theme-picker');
        if (picker) {
            picker.style.display = (_libCurrentView === 'tower' && _libCurrentTab === 'read') ? 'flex' : 'none';
            picker.querySelectorAll('.tower-theme-dot').forEach(d => {
                d.classList.toggle('active', d.dataset.theme === _libTowerTheme);
            });
        }
    }

    window.switchTowerTheme = function(theme) {
        _libTowerTheme = theme;
        localStorage.setItem('libTowerTheme', theme);
        updateLibraryViewToggle();
        renderLibrary();
    };

    window.filterLibraryBooks = function(query) {
        var trimmed = (query || '').trim();
        if (_libLocalSearch) {
            // Local filter mode: filter books in library
            _libSearchQuery = trimmed.toLowerCase();
            renderLibrary();
        } else {
            // API search mode: search via server
            _libSearchQuery = '';
            if (!trimmed) {
                // Empty query: hide search results, show library
                _apiSearchResults = [];
                _apiSearchQuery = '';
                var sr = document.getElementById('library-search-results');
                if (sr) { sr.classList.add('d-none'); sr.innerHTML = ''; }
                showLibraryMainContent(true);
                return;
            }
            // Debounce API calls
            if (_apiSearchTimer) clearTimeout(_apiSearchTimer);
            _apiSearchTimer = setTimeout(function() {
                _apiSearchPage = 1;
                _apiSearchQuery = trimmed;
                searchBooksFromApi(trimmed, 1);
            }, 400);
        }
    };

    window.toggleLibrarySearchMode = function(checked) {
        _libLocalSearch = checked;
        var searchInput = document.getElementById('library-search-input');
        var currentVal = searchInput ? searchInput.value.trim() : '';
        var searchResults = document.getElementById('library-search-results');

        if (checked) {
            // Switch to local filter mode
            if (searchResults) { searchResults.classList.add('d-none'); searchResults.innerHTML = ''; }
            _apiSearchResults = [];
            showLibraryMainContent(true);
            _libSearchQuery = currentVal.toLowerCase();
            renderLibrary();
        } else {
            // Switch to API search mode
            _libSearchQuery = '';
            renderLibrary();
            if (currentVal) {
                _apiSearchPage = 1;
                _apiSearchQuery = currentVal;
                searchBooksFromApi(currentVal, 1);
            }
        }
    };

    function showLibraryMainContent(show) {
        var els = document.querySelectorAll('.library-count-bar, .library-tabs, .library-view-toggle, #library-content');
        els.forEach(function(el) {
            el.style.display = show ? '' : 'none';
        });
    }

    async function searchBooksFromApi(query, page) {
        var searchResults = document.getElementById('library-search-results');
        if (!searchResults) return;

        // Show search results area, hide library main content
        showLibraryMainContent(false);
        searchResults.classList.remove('d-none');

        if (page === 1) {
            searchResults.innerHTML = '<div class="search-loading">' + t('lib_search_api') + '</div>';
        } else {
            // Remove old "more" button
            var moreBtn = searchResults.querySelector('.search-more-btn');
            if (moreBtn) moreBtn.textContent = t('lib_search_api');
        }

        try {
            var _ping = window._httpsCallable(window._functions, 'ping');
            var result = await _ping({ action: 'searchBooks', query: query, page: page });
            var data = result.data || {};
            var books = data.books || [];
            _apiSearchHasMore = data.hasMore || false;

            if (page === 1) {
                _apiSearchResults = books;
            } else {
                _apiSearchResults = _apiSearchResults.concat(books);
            }

            renderApiSearchResults();
        } catch (e) {
            console.error('Book search error:', e);
            if (page === 1) {
                searchResults.innerHTML = '<div class="search-no-result">' + t('lib_search_no_result') + '</div>';
                showLibraryMainContent(true);
            }
        }
    }

    function renderApiSearchResults() {
        var searchResults = document.getElementById('library-search-results');
        if (!searchResults) return;

        if (_apiSearchResults.length === 0) {
            searchResults.innerHTML = '<div class="search-no-result">' + t('lib_search_no_result') + '</div>';
            showLibraryMainContent(true);
            return;
        }

        var existingIsbns = {};
        var libBooks = (AppState.library && AppState.library.books) || [];
        libBooks.forEach(function(b) { if (b.isbn) existingIsbns[b.isbn] = true; });

        var html = '';
        _apiSearchResults.forEach(function(book, idx) {
            var isAdded = book.isbn && existingIsbns[book.isbn];
            var thumbSrc = book.thumbnail || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'50\' height=\'72\' fill=\'%23555\'%3E%3Crect width=\'50\' height=\'72\' fill=\'%23222\' rx=\'4\'/%3E%3Ctext x=\'25\' y=\'40\' text-anchor=\'middle\' fill=\'%23666\' font-size=\'10\'%3E📖%3C/text%3E%3C/svg%3E';

            html += '<div class="search-result-item" data-idx="' + idx + '">'
                + '<img class="search-result-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
                + '<div class="search-result-info">'
                + '<div class="search-result-title">' + escapeHtml(book.title) + '</div>'
                + '<div class="search-result-meta">' + escapeHtml(book.author || '') + (book.publisher ? ' · ' + escapeHtml(book.publisher) : '') + '</div>'
                + '<div class="search-cat-selector" data-idx="' + idx + '">'
                + '<button class="search-cat-btn active" data-cat="reading" onclick="window.selectSearchCat(this)">' + t('lib_reading') + '</button>'
                + '<button class="search-cat-btn" data-cat="read" onclick="window.selectSearchCat(this)">' + t('lib_read') + '</button>'
                + '<button class="search-cat-btn" data-cat="wantToRead" onclick="window.selectSearchCat(this)">' + t('lib_want_to_read') + '</button>'
                + '</div>'
                + '</div>'
                + '<div class="search-result-actions">'
                + (isAdded
                    ? '<button class="search-result-add-btn added" disabled>' + '✓' + '</button>'
                    : '<button class="search-result-add-btn" onclick="window.addSearchResult(' + idx + ')">' + t('lib_add_book') + '</button>')
                + '</div>'
                + '</div>';
        });

        if (_apiSearchHasMore) {
            html += '<button class="search-more-btn" onclick="window.loadMoreSearchResults()">' + t('lib_search_more') + '</button>';
        }

        searchResults.innerHTML = html;
    }

    window.selectSearchCat = function(btn) {
        var selector = btn.closest('.search-cat-selector');
        if (!selector) return;
        selector.querySelectorAll('.search-cat-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
    };

    window.addSearchResult = function(idx) {
        if (idx < 0 || idx >= _apiSearchResults.length) return;
        var book = _apiSearchResults[idx];
        var item = document.querySelector('.search-result-item[data-idx="' + idx + '"]');
        var catSelector = item ? item.querySelector('.search-cat-selector') : null;
        var activeBtn = catSelector ? catSelector.querySelector('.search-cat-btn.active') : null;
        var category = activeBtn ? activeBtn.dataset.cat : 'reading';

        var bookInfo = {
            isbn: book.isbn || '',
            title: book.title || '',
            author: book.author || '',
            publisher: book.publisher || '',
            thumbnail: book.thumbnail || '',
            description: book.description || '',
            pubDate: book.pubDate || '',
            pages: book.pages || 0,
            price: book.price || 0,
            url: book.url || '',
            source: book.source || null
        };

        var added = window.addBookToLibrary(bookInfo, category);
        if (added) {
            // 검색 결과 닫고 쌓아보기(최초 진입화면)로 전환
            _apiSearchResults = [];
            _apiSearchQuery = '';
            _apiSearchPage = 1;
            _apiSearchHasMore = false;
            var sr = document.getElementById('library-search-results');
            if (sr) { sr.classList.add('d-none'); sr.innerHTML = ''; }
            var searchInput = document.getElementById('library-search-input');
            if (searchInput) searchInput.value = '';
            _libSearchQuery = '';
            _libCurrentTab = 'read';
            _libCurrentView = 'tower';
            showLibraryMainContent(true);
            updateLibraryTabs();
            updateLibraryViewToggle();
            updateLibraryCounts();
            renderLibrary();
            showLibToast(t('lib_book_added'));
        }
    };

    window.loadMoreSearchResults = function() {
        if (!_apiSearchHasMore || !_apiSearchQuery) return;
        _apiSearchPage++;
        searchBooksFromApi(_apiSearchQuery, _apiSearchPage);
    };

    function updateLibraryTabs() {
        document.querySelectorAll('.lib-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.cat === _libCurrentTab);
        });
    }

    function updateLibraryPeriodBtns() {
        document.querySelectorAll('.lib-count-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.period === _libCurrentPeriod);
        });
    }

    function getFilteredBooks() {
        const books = (AppState.library && AppState.library.books) || [];
        let filtered = books.filter(b => b.category === _libCurrentTab);

        // Period filter
        if (_libCurrentPeriod === 'yearly') {
            filtered = filtered.filter(b => {
                const d = new Date(b.addedDate);
                return d.getFullYear() === _libSelectedYear;
            });
        } else if (_libCurrentPeriod === 'monthly') {
            filtered = filtered.filter(b => {
                const d = new Date(b.addedDate);
                return d.getFullYear() === _libSelectedYear && (d.getMonth() + 1) === _libSelectedMonth;
            });
        }

        // Search filter
        if (_libSearchQuery) {
            filtered = filtered.filter(b =>
                (b.title || '').toLowerCase().includes(_libSearchQuery) ||
                (b.author || '').toLowerCase().includes(_libSearchQuery)
            );
        }
        return filtered;
    }

    function updateLibraryCounts() {
        const books = (AppState.library && AppState.library.books) || [];
        const catBooks = books.filter(b => b.category === _libCurrentTab);

        const totalEl = document.getElementById('lib-count-total');
        const yearlyEl = document.getElementById('lib-count-yearly');
        const monthlyEl = document.getElementById('lib-count-monthly');

        if (totalEl) totalEl.textContent = catBooks.length;
        if (yearlyEl) yearlyEl.textContent = catBooks.filter(b => new Date(b.addedDate).getFullYear() === _libSelectedYear).length;
        if (monthlyEl) monthlyEl.textContent = catBooks.filter(b => {
            const d = new Date(b.addedDate);
            return d.getFullYear() === _libSelectedYear && (d.getMonth() + 1) === _libSelectedMonth;
        }).length;
    }

    function renderLibrary() {
        const container = document.getElementById('library-tower');
        if (!container) return;
        const books = getFilteredBooks();
        const shareBtn = document.getElementById('library-share-btn');

        if (books.length === 0) {
            container.innerHTML = '<div class="library-empty"><div class="library-empty-icon">📚</div><div>' + t('lib_empty').replace(/\n/g, '<br>') + '</div></div>';
            container.className = 'library-tower';
            if (shareBtn) shareBtn.classList.add('d-none');
            return;
        }

        if (_libCurrentView === 'tower') {
            renderTowerView(container, books);
        } else {
            renderListView(container, books);
        }
        if (shareBtn) shareBtn.classList.remove('d-none');

        // Tower view: 스크롤을 최하단으로 이동 (1층이 배너 바로 위에 보이도록)
        // List view: 스크롤을 최상단으로 (최신순이 맨 위)
        var libContent = document.getElementById('library-content');
        if (libContent) {
            requestAnimationFrame(function() {
                if (_libCurrentView === 'tower') {
                    libContent.scrollTop = libContent.scrollHeight;
                } else {
                    libContent.scrollTop = 0;
                }
            });
        }
    }
    window.renderLibrary = renderLibrary;

    // 서재 타워를 이미지로 저장 (보상형 광고 시청 후 다운로드)
    window.shareLibraryAsImage = async function() {
        const lang = AppState.currentLang;
        const books = getFilteredBooks();
        if (books.length === 0) return;

        var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

        // 네이티브 앱에서만 보상형 광고 필수
        if (isNative && window.AdManager) {
            // 광고 시청 확인
            if (!confirm(i18n[lang].lib_ad_prompt)) return;

            const adShown = await window.AdManager.showRewarded({
                context: 'libraryImage',
                onSuccess: function() {
                    _executeLibraryImageSave(lang, books);
                },
                onFail: function() {
                    const failLang = AppState.currentLang;
                    alert(i18n[failLang].lib_ad_fail || i18n[failLang].bonus_exp_fail);
                }
            });
            if (!adShown) {
                alert(i18n[lang].lib_ad_not_ready || i18n[lang].bonus_exp_not_ready);
            }
            return;
        }

        // 웹(비네이티브) 환경: 광고 없이 바로 저장
        _executeLibraryImageSave(lang, books);
    };

    // 실제 이미지 생성 및 저장 로직 (보상형 광고 완료 후 호출)
    window._executeLibraryImageSave = function(lang, books) {
        _doLibraryImageSave(lang, books);
    };

    async function _doLibraryImageSave(lang, books) {
        if (!books || books.length === 0) return;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const W = 540;
        const pad = 20;
        const innerW = W - pad * 2;
        const centerX = W / 2;

        // 스파인 색상 팔레트 (테마별)
        var themeColors = {
            dark: { colors: [['#3a3a4a','#2e2e3e'],['#404052','#343446'],['#464658','#3a3a4c'],['#383848','#2c2c3c'],['#3e3e50','#32324a'],['#424254','#363648'],['#484860','#3c3c50'],['#363646','#2a2a3a']], text: '#c0c0d0', darkText: null },
            warm: { colors: [['#f2b4a8','#eea090'],['#f5c4b8','#f0b0a0'],['#f8d0c4','#f4bcae'],['#eea898','#e89888'],['#f5bcae','#f0a898'],['#f0c0b4','#ecaca0'],['#f8d4c8','#f4c0b4'],['#ecb0a0','#e8a090']], text: '#3a2a2a', darkText: '#5a3a3a', darkTextIndices: [2,6] },
            ocean: { colors: [['#1e3a5f','#162e4f'],['#234068','#1b3458'],['#284870','#203c60'],['#1c3555','#142a45'],['#203d62','#183252'],['#254468','#1d3858'],['#2a4c72','#224062'],['#1a3250','#122640']], text: '#a8c8e0', darkText: null }
        };
        var activeTheme = themeColors[_libTowerTheme] || themeColors.dark;
        const spineColors = activeTheme.colors;
        const defaultTextColor = activeTheme.text;
        const darkTextIndices = activeTheme.darkTextIndices || [];

        // 각 책 스파인 메트릭 계산
        var totalBooksH = 0;
        var bookMetrics = books.map(function(book, i) {
            var thickness = getBookThickness(book.pages);
            var paddingV = thickness * 2;
            var textH = 14;
            var itemH = paddingV + textH;
            var widthPct = getBookWidth(book.pages, i);
            var itemW = Math.min(360, (innerW * widthPct / 100));
            totalBooksH += itemH;
            return { book: book, itemH: itemH, itemW: itemW, floor: i + 1 };
        });

        // 레이아웃 높이 계산
        var hexH = 48;
        var baseH = 14;
        var baseGap = 4;
        var footerH = 36;
        var totalH = pad + totalBooksH + baseGap + baseH + hexH + footerH + pad;

        canvas.width = W;
        canvas.height = totalH;

        // 배경
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, W, totalH);

        var y = pad;

        // --- 책 스파인 육각형 (맨 위층부터 아래로) ---
        for (var i = bookMetrics.length - 1; i >= 0; i--) {
            var m = bookMetrics[i];
            var colorIdx = i % 8;
            var c = spineColors[colorIdx];
            var itemX = centerX - m.itemW / 2;
            var iw = m.itemW, ih = m.itemH;
            var inset = iw * 0.04; // 4% inset matching CSS clip-path

            // 육각형 경로
            ctx.beginPath();
            ctx.moveTo(itemX + inset, y);
            ctx.lineTo(itemX + iw - inset, y);
            ctx.lineTo(itemX + iw, y + ih / 2);
            ctx.lineTo(itemX + iw - inset, y + ih);
            ctx.lineTo(itemX + inset, y + ih);
            ctx.lineTo(itemX, y + ih / 2);
            ctx.closePath();

            // 스파인 배경 그라디언트
            var spineGrad = ctx.createLinearGradient(0, y, 0, y + ih);
            spineGrad.addColorStop(0, c[0]);
            spineGrad.addColorStop(1, c[1]);
            ctx.fillStyle = spineGrad;
            ctx.fill();

            // 제목 텍스트
            var textColor = (activeTheme.darkText && darkTextIndices.indexOf(colorIdx) >= 0) ? activeTheme.darkText : defaultTextColor;
            ctx.fillStyle = textColor;
            ctx.font = 'bold 10px Pretendard, sans-serif';
            var title = m.book.title.length > 20 ? m.book.title.substring(0, 18) + '…' : m.book.title;
            var titleW = ctx.measureText(title).width;
            ctx.fillText(title, centerX - titleW / 2, y + ih / 2 + 3);

            // 층수 라벨 (좌측)
            ctx.fillStyle = '#888';
            ctx.font = 'bold 8px Pretendard, sans-serif';
            ctx.fillText(m.floor + '층', itemX - 32, y + ih / 2 + 3);

            // 페이지수 (우측)
            if (m.book.pages) {
                ctx.fillStyle = textColor;
                ctx.globalAlpha = 0.6;
                ctx.font = '8px Pretendard, sans-serif';
                ctx.fillText(m.book.pages + 'p', centerX + titleW / 2 + 6, y + ih / 2 + 3);
                ctx.globalAlpha = 1.0;
            }

            y += ih;
        }

        // --- 받침대 ---
        y += baseGap;
        var baseW = Math.min(390, innerW * 0.92);
        var baseX = centerX - baseW / 2;
        var baseGrad = ctx.createLinearGradient(0, y, 0, y + baseH);
        baseGrad.addColorStop(0, '#4a4a5a');
        baseGrad.addColorStop(1, '#2a2a3a');
        ctx.fillStyle = baseGrad;
        ctx.beginPath();
        ctx.roundRect(baseX, y, baseW, baseH, [0, 0, 6, 6]);
        ctx.fill();
        y += baseH;

        // --- 바벨의 도서관 육각형 (최하단, 공백 없이) ---
        var hexW = innerW * 0.6;
        var hexX = centerX - hexW / 2;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(hexX + hexW * 0.1, y);
        ctx.lineTo(hexX + hexW * 0.9, y);
        ctx.lineTo(hexX + hexW, y + hexH / 2);
        ctx.lineTo(hexX + hexW * 0.9, y + hexH);
        ctx.lineTo(hexX + hexW * 0.1, y + hexH);
        ctx.lineTo(hexX, y + hexH / 2);
        ctx.closePath();
        var hexGrad = ctx.createLinearGradient(0, y, 0, y + hexH);
        hexGrad.addColorStop(0, '#4a4a5a');
        hexGrad.addColorStop(1, '#3a3a4a');
        ctx.fillStyle = hexGrad;
        ctx.fill();
        ctx.restore();
        // 육각형 텍스트 (2줄: 바벨의 도서관 / N층)
        ctx.fillStyle = '#00d9ff';
        ctx.font = 'bold 11px Pretendard, sans-serif';
        var hexLine1 = t('lib_babel_tower') || '바벨의 도서관';
        var hexLine2 = books.length + '층';
        var hexLine1W = ctx.measureText(hexLine1).width;
        var hexLine2W = ctx.measureText(hexLine2).width;
        ctx.fillText(hexLine1, centerX - hexLine1W / 2, y + hexH / 2 - 2);
        ctx.fillText(hexLine2, centerX - hexLine2W / 2, y + hexH / 2 + 12);
        y += hexH;

        // --- 푸터 ---
        ctx.fillStyle = '#444';
        ctx.font = '10px Pretendard, sans-serif';
        var today = new Date().toISOString().slice(0, 10);
        var footerText = 'LEVEL UP: REBOOT | ' + today;
        ctx.fillText(footerText, pad + 6, y + 12);

        // --- 저장/공유 파이프라인 (sharePlannerAsImage 패턴 재사용) ---
        var userName = (AppState.user && AppState.user.name) ? AppState.user.name.replace(/[^a-zA-Z0-9가-힣]/g, '') : '';
        var saveCountKey = 'library_save_count_' + userName;
        var saveCount = parseInt(localStorage.getItem(saveCountKey) || '0', 10) + 1;
        localStorage.setItem(saveCountKey, String(saveCount));
        var countSuffix = saveCount > 1 ? String(saveCount) : '';
        var fileName = 'library_tower_' + userName + countSuffix + '.png';
        var msgs = { ko: '이미지가 저장되었습니다.', en: 'Image saved.', ja: '画像を保存しました。' };
        var failMsgs = { ko: '이미지 저장에 실패했습니다.', en: 'Failed to save image.', ja: '画像の保存に失敗しました。' };

        try {
            var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
            var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
            if (!blob) throw new Error('toBlob failed');

            var saved = false;

            // 네이티브 앱: Capacitor Filesystem
            if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                var Filesystem = window.Capacitor.Plugins.Filesystem;
                var dataUrl = canvas.toDataURL('image/png');
                var base64Data = dataUrl.split(',')[1];
                try {
                    var savedPath = null;
                    var dirs = ['DOCUMENTS', 'EXTERNAL', 'CACHE'];
                    for (var d = 0; d < dirs.length; d++) {
                        try {
                            var result = await Filesystem.writeFile({
                                path: fileName, data: base64Data,
                                directory: dirs[d], recursive: true
                            });
                            savedPath = result.uri;
                            break;
                        } catch(dirErr) {
                            AppLogger.warn('[Library] Filesystem write failed for dir ' + dirs[d] + ': ' + dirErr.message);
                        }
                    }
                    if (savedPath) {
                        AppLogger.info('[Library] Image saved: ' + savedPath);
                        saved = true;
                    }
                } catch(fsErr) {
                    AppLogger.warn('[Library] Filesystem save failed: ' + fsErr.message);
                }
            }

            // Web Share API
            if (!saved && navigator.share && navigator.canShare) {
                try {
                    var file = new File([blob], fileName, { type: 'image/png' });
                    var shareData = { files: [file] };
                    if (navigator.canShare(shareData)) {
                        await navigator.share(shareData);
                        saved = true;
                    }
                } catch(shareErr) {
                    if (shareErr.name === 'AbortError') {
                        saved = true;
                    } else {
                        AppLogger.warn('[Library] Share API failed: ' + shareErr.message);
                    }
                }
            }

            // 인앱 오버레이 (네이티브 폴백)
            if (!saved && isNative) {
                showImageOverlay(canvas.toDataURL('image/png'), lang);
                saved = true;
            }

            // <a> 다운로드 (데스크톱 폴백)
            if (!saved && !isNative) {
                var url = URL.createObjectURL(blob);
                var link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                setTimeout(function() {
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }, 1000);
                saved = true;
            }

            if (saved) {
                alert(msgs[lang] || msgs.ko);
            } else {
                throw new Error('All save methods failed');
            }
        } catch(e) {
            AppLogger.error('[Library] Image save error: ' + e.message);
            try {
                showImageOverlay(canvas.toDataURL('image/png'), lang);
            } catch(e2) {
                alert(failMsgs[lang] || failMsgs.ko);
            }
        }
    }

    function getBookThickness(pages) {
        // Reboot: thinner spines – min 4px, max 14px
        if (!pages || pages <= 0) return 6;
        if (pages < 100) return 4;
        if (pages < 200) return 5;
        if (pages < 300) return 6;
        if (pages < 400) return 8;
        if (pages < 500) return 10;
        if (pages < 700) return 12;
        return 14;
    }

    function getBookWidth(pages, index) {
        // Varying widths based on page count + slight per-book variation
        var base;
        if (!pages || pages <= 0) base = 72;
        else if (pages < 150) base = 60;
        else if (pages < 250) base = 68;
        else if (pages < 350) base = 75;
        else if (pages < 500) base = 82;
        else base = 88;
        // Add deterministic variation using index
        var offset = ((index * 7 + 3) % 11) - 5; // -5 to +5
        return Math.min(92, Math.max(55, base + offset));
    }

    function getSourceLabel(source) {
        if (!source) return '';
        var labels = { aladin: '알라딘', kakao: '카카오', google: '구글' };
        return labels[source] || source;
    }

    function renderTowerView(container, books) {
        container.className = 'library-tower tower-theme-' + _libTowerTheme;
        // 바벨의 도서관 라벨을 최하단에 배치 (column-reverse이므로 HTML 첫 번째 = 화면 최하단)
        let html = '<div class="book-tower-top">'
            + '<div class="book-tower-top-label">' + t('lib_babel_tower') + '<br>' + books.length + '층</div>'
            + '</div>';
        // Tower base
        html += '<div class="book-tower-base"></div>';
        // Books stacked from bottom (floor 1) to top
        books.forEach((book, i) => {
            const floor = i + 1;
            const title = book.title.length > 20 ? book.title.substring(0, 18) + '…' : book.title;
            const thickness = getBookThickness(book.pages);
            const widthPct = getBookWidth(book.pages, i);
            const pageLabel = book.pages ? book.pages + 'p' : '';
            html += '<div class="book-tower-item" style="width:' + widthPct + '%; max-width:360px; padding-top:' + thickness + 'px; padding-bottom:' + thickness + 'px;" onclick="window.openBookDetail(\'' + encodeURIComponent(book.isbn) + '\')">'
                + '<span class="book-tower-floor">' + floor + '층</span>'
                + '<span class="book-tower-title">' + escapeHtml(title) + '</span>'
                + (pageLabel ? '<span class="book-tower-pages">' + escapeHtml(pageLabel) + '</span>' : '')
                + '</div>';
        });
        container.innerHTML = html;
    }

    function renderListView(container, books) {
        container.className = 'library-list';
        // Sort by newest date first
        var sorted = books.slice().sort(function(a, b) {
            return (b.addedDate || '').localeCompare(a.addedDate || '');
        });
        let html = '';
        sorted.forEach(book => {
            const thumbSrc = book.thumbnail || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'45\' height=\'65\' fill=\'%23555\'%3E%3Crect width=\'45\' height=\'65\' fill=\'%23222\' rx=\'4\'/%3E%3Ctext x=\'22\' y=\'36\' text-anchor=\'middle\' fill=\'%23666\' font-size=\'10\'%3E📖%3C/text%3E%3C/svg%3E';
            html += '<div class="book-list-item">'
                + '<img class="book-list-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" onerror="this.style.display=\'none\'">'
                + '<div class="book-list-info">'
                + '<div class="book-list-title">' + escapeHtml(book.title) + '</div>'
                + '<div class="book-list-author">' + escapeHtml(book.author || '') + (book.source ? ' <span class="source-badge source-' + escapeHtml(book.source) + '">' + escapeHtml({aladin:'알라딘',kakao:'카카오',google:'구글'}[book.source] || book.source) + '</span>' : '') + '</div>'
                + '<div class="book-list-date">' + escapeHtml(book.addedDate || '') + '</div>'
                + '</div>'
                + '<button class="book-list-delete" onclick="window.openBookDetail(\'' + encodeURIComponent(book.isbn) + '\')">⋯</button>'
                + '</div>';
        });
        container.innerHTML = html;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Book Action Sheet (long press / tap) ──
    window.openBookAction = function(encodedIsbn) {
        const isbn = decodeURIComponent(encodedIsbn);
        const book = (AppState.library.books || []).find(b => b.isbn === isbn);
        if (!book) return;

        const cats = ['reading', 'read', 'wantToRead'].filter(c => c !== book.category);
        const moveLabels = { reading: 'lib_move_reading', read: 'lib_move_read', wantToRead: 'lib_move_want' };

        let html = '<div class="book-action-overlay" onclick="this.remove()">'
            + '<div class="book-action-sheet" onclick="event.stopPropagation()">'
            + '<div class="book-action-title">' + escapeHtml(book.title) + '</div>';
        cats.forEach(cat => {
            html += '<button class="book-action-btn" onclick="window.changeBookCategory(\'' + isbn + '\',\'' + cat + '\'); this.closest(\'.book-action-overlay\').remove();">' + t(moveLabels[cat]) + '</button>';
        });
        html += '<button class="book-action-btn danger" onclick="window.removeBookFromLibrary(\'' + isbn + '\'); this.closest(\'.book-action-overlay\').remove();">' + t('lib_delete') + '</button>';
        html += '<button class="book-action-btn cancel" onclick="this.closest(\'.book-action-overlay\').remove();">' + t('btn_cancel') + '</button>';
        html += '</div></div>';

        document.body.insertAdjacentHTML('beforeend', html);
    };

    // ── Book Detail View (click on book) ──
    window.openBookDetail = function(encodedIsbn) {
        const isbn = decodeURIComponent(encodedIsbn);
        const book = (AppState.library.books || []).find(b => b.isbn === isbn);
        if (!book) return;

        const cats = ['reading', 'read', 'wantToRead'].filter(c => c !== book.category);
        const moveLabels = { reading: 'lib_move_reading', read: 'lib_move_read', wantToRead: 'lib_move_want' };
        const catLabels = { reading: '읽고있는책', read: '읽은책', wantToRead: '읽고싶은책' };

        const thumbSrc = book.thumbnail || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'90\' height=\'130\' fill=\'%23555\'%3E%3Crect width=\'90\' height=\'130\' fill=\'%23222\' rx=\'6\'/%3E%3Ctext x=\'45\' y=\'70\' text-anchor=\'middle\' fill=\'%23666\' font-size=\'14\'%3E📖%3C/text%3E%3C/svg%3E';

        let html = '<div class="book-detail-overlay" onclick="this.remove()">'
            + '<div class="book-detail-sheet" onclick="event.stopPropagation()">'
            + '<button class="book-detail-close" onclick="this.closest(\'.book-detail-overlay\').remove()">✕</button>'
            + '<div class="book-detail-header">'
            + '<img class="book-detail-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
            + '<div class="book-detail-meta">'
            + '<div class="book-detail-title">' + escapeHtml(book.title) + '</div>'
            + '<div class="book-detail-author">' + escapeHtml(book.author || '저자 미상') + '</div>'
            + '<div class="book-detail-publisher">' + escapeHtml(book.publisher || '') + '</div>'
            + '<div class="book-detail-isbn">ISBN: ' + escapeHtml(book.isbn) + '</div>'
            + '<div class="book-detail-date">📅 ' + escapeHtml(book.addedDate || '') + ' 등록</div>'
            + (book.source ? '<div class="book-detail-source"><span class="source-badge source-' + escapeHtml(book.source) + '">' + escapeHtml({aladin:'알라딘',kakao:'카카오',google:'구글'}[book.source] || book.source) + '</span></div>' : '')
            + '</div></div>';

        // Description
        if (book.description) {
            html += '<div class="book-detail-description">' + escapeHtml(book.description) + '</div>';
        }

        // Info grid
        html += '<div class="book-detail-info-grid">';
        html += '<div class="book-detail-info-item"><div class="book-detail-info-label">분류</div><div class="book-detail-info-value">' + (catLabels[book.category] || book.category) + '</div></div>';
        if (book.pubDate) {
            html += '<div class="book-detail-info-item"><div class="book-detail-info-label">출판일</div><div class="book-detail-info-value">' + escapeHtml(book.pubDate) + '</div></div>';
        }
        if (book.pages) {
            html += '<div class="book-detail-info-item"><div class="book-detail-info-label">페이지</div><div class="book-detail-info-value">' + book.pages + 'p</div></div>';
        }
        if (book.finishedDate) {
            html += '<div class="book-detail-info-item"><div class="book-detail-info-label">완독일</div><div class="book-detail-info-value">' + escapeHtml(book.finishedDate) + '</div></div>';
        }
        html += '</div>';

        // Actions
        html += '<div class="book-detail-actions">';
        cats.forEach(cat => {
            html += '<button class="book-action-btn" onclick="window.changeBookCategory(\'' + isbn + '\',\'' + cat + '\'); this.closest(\'.book-detail-overlay\').remove(); renderLibrary();">' + t(moveLabels[cat]) + '</button>';
        });
        html += '<button class="book-action-btn danger" onclick="window.removeBookFromLibrary(\'' + isbn + '\'); this.closest(\'.book-detail-overlay\').remove();">' + t('lib_delete') + '</button>';
        html += '</div></div></div>';

        document.body.insertAdjacentHTML('beforeend', html);

        // Try to fetch additional details from API if not already loaded
        if (!book.description && book.isbn) {
            fetchBookDetails(book.isbn);
        }
    };

    async function fetchBookDetails(isbn) {
        try {
            const _ping = window._httpsCallable(window._functions, 'ping');
            const result = await _ping({ action: 'lookupIsbn', isbn: isbn });
            if (result.data && result.data.book) {
                const apiBook = result.data.book;
                // Update stored book with additional details
                const book = (AppState.library.books || []).find(b => b.isbn === isbn);
                if (book) {
                    if (apiBook.description && !book.description) book.description = apiBook.description;
                    if (apiBook.pubDate && !book.pubDate) book.pubDate = apiBook.pubDate;
                    if (apiBook.pages && !book.pages) book.pages = apiBook.pages;
                    if (apiBook.price && !book.price) book.price = apiBook.price;
                    if (apiBook.url && !book.url) book.url = apiBook.url;
                    if (!book.source && result.data.source) book.source = result.data.source;
                    window.saveUserData();

                    // Update the currently open detail overlay if it's still showing this book
                    const overlay = document.querySelector('.book-detail-overlay');
                    if (overlay) {
                        const descEl = overlay.querySelector('.book-detail-description');
                        if (!descEl && book.description) {
                            const header = overlay.querySelector('.book-detail-header');
                            if (header) {
                                header.insertAdjacentHTML('afterend', '<div class="book-detail-description">' + escapeHtml(book.description) + '</div>');
                            }
                        }
                        // Update info grid with new data
                        const grid = overlay.querySelector('.book-detail-info-grid');
                        if (grid && book.pubDate && !grid.querySelector('[data-field="pubDate"]')) {
                            grid.insertAdjacentHTML('beforeend', '<div class="book-detail-info-item" data-field="pubDate"><div class="book-detail-info-label">출판일</div><div class="book-detail-info-value">' + escapeHtml(book.pubDate) + '</div></div>');
                        }
                        if (grid && book.pages && !grid.querySelector('[data-field="pages"]')) {
                            grid.insertAdjacentHTML('beforeend', '<div class="book-detail-info-item" data-field="pages"><div class="book-detail-info-label">페이지</div><div class="book-detail-info-value">' + book.pages + 'p</div></div>');
                        }
                    }
                }
            }
        } catch(e) {
            console.warn('fetchBookDetails error:', e);
        }
    }

    // ── Library Read Reward ──
    function grantReadReward(book) {
        if (book.rewardGranted) return;
        if (!AppState.library.rewardedISBNs) AppState.library.rewardedISBNs = [];
        if (book.isbn && AppState.library.rewardedISBNs.indexOf(book.isbn) !== -1) {
            book.rewardGranted = true;
            return;
        }
        book.rewardGranted = true;
        if (book.isbn) AppState.library.rewardedISBNs.push(book.isbn);
        AppState.user.points += 10;
        AppState.user.pendingStats.int += 0.5;
        if (window.AppLogger) AppLogger.info('[Library] 독서 보상 지급: +10P, INT +0.5');
        window.updatePointUI();
        window.drawRadarChart();
        const lang = AppState.currentLang;
        alert(i18n[lang].lib_read_reward || '📚 독서 완료! +10P & INT +0.5');
    }

    // ── Library CRUD ──
    window.addBookToLibrary = function(bookInfo, category) {
        if (!AppState.library) AppState.library = { books: [], rewardedISBNs: [] };
        if (!Array.isArray(AppState.library.rewardedISBNs)) AppState.library.rewardedISBNs = [];
        const existing = AppState.library.books.find(b => b.isbn === bookInfo.isbn);
        if (existing) {
            alert(t('lib_already_exists'));
            return false;
        }
        AppState.library.books.push({
            isbn: bookInfo.isbn,
            title: bookInfo.title || 'Unknown',
            author: bookInfo.author || '',
            publisher: bookInfo.publisher || '',
            thumbnail: bookInfo.thumbnail || '',
            description: bookInfo.description || '',
            pubDate: bookInfo.pubDate || '',
            pages: bookInfo.pages || 0,
            price: bookInfo.price || 0,
            url: bookInfo.url || '',
            source: bookInfo._source || bookInfo.source || null,
            category: category,
            addedDate: getTodayStr(),
            finishedDate: category === 'read' ? getTodayStr() : null
        });
        if (category === 'read') {
            grantReadReward(AppState.library.books[AppState.library.books.length - 1]);
            if (typeof window.checkReadingRareTitles === 'function') window.checkReadingRareTitles();
        }
        window.saveUserData();
        window.updateLibraryCardCount();
        return true;
    };

    window.removeBookFromLibrary = function(isbn) {
        if (!AppState.library) return;
        AppState.library.books = AppState.library.books.filter(b => b.isbn !== isbn);
        window.saveUserData();
        updateLibraryCounts();
        renderLibrary();
        window.updateLibraryCardCount();
    };

    window.changeBookCategory = function(isbn, newCategory) {
        if (!AppState.library) return;
        const book = AppState.library.books.find(b => b.isbn === isbn);
        if (!book) return;
        book.category = newCategory;
        if (newCategory === 'read' && !book.finishedDate) book.finishedDate = getTodayStr();
        if (newCategory === 'read') {
            grantReadReward(book);
            if (typeof window.checkReadingRareTitles === 'function') window.checkReadingRareTitles();
        }
        window.saveUserData();
        updateLibraryCounts();
        renderLibrary();
        window.updateLibraryCardCount();
    };

    // ── ISBN Manual Input Keyboard Handling ──
    var _isbnKeyboardSetup = false;
    function setupIsbnKeyboardHandling() {
        if (_isbnKeyboardSetup) return;
        _isbnKeyboardSetup = true;
        var field = document.getElementById('isbn-manual-field');
        if (!field) return;

        field.addEventListener('focus', function() {
            // Scroll input into view after keyboard appears
            setTimeout(function() {
                field.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });

        // Handle visualViewport resize (keyboard show/hide)
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', function() {
                var overlay = document.getElementById('isbn-scanner-overlay');
                if (!overlay || overlay.classList.contains('d-none')) return;
                // Set overlay height to visual viewport height to avoid keyboard overlap
                overlay.style.height = window.visualViewport.height + 'px';
            });
            window.visualViewport.addEventListener('scroll', function() {
                var overlay = document.getElementById('isbn-scanner-overlay');
                if (!overlay || overlay.classList.contains('d-none')) return;
                overlay.style.height = window.visualViewport.height + 'px';
            });
        }
    }

    // ── ISBN Scanner ──
    window.openIsbnScanner = async function() {
        if (window.AppLogger) AppLogger.info('[ISBN] Scanner opened');
        const overlay = document.getElementById('isbn-scanner-overlay');
        if (overlay) {
            overlay.classList.remove('d-none');
            // Reset height in case keyboard changed it previously
            overlay.style.height = '100%';
        }

        const statusEl = document.getElementById('isbn-scanner-status');
        if (statusEl) statusEl.textContent = t('lib_scan_hint');

        setupIsbnKeyboardHandling();

        try {
            if (_html5QrCode) {
                try { await _html5QrCode.stop(); } catch(e) {}
                _html5QrCode = null;
            }
            _html5QrCode = new Html5Qrcode('isbn-scanner-reader');
            if (window.AppLogger) AppLogger.info('[ISBN] Html5Qrcode instance created');

            var _scanHandled = false;
            var _scanAttemptCount = 0;
            var _fullFrameRetried = false;

            var _onBarcodeSuccess = async (decodedText) => {
                _scanAttemptCount++;
                if (_scanHandled) return;
                // Validate barcode: reject garbage reads
                var barcode = (decodedText || '').replace(/[-\s]/g, '');
                if (!isValidIsbn(barcode)) {
                    if (window.AppLogger) AppLogger.debug('[ISBN] Barcode rejected (invalid): ' + decodedText, {
                        raw: decodedText,
                        cleaned: barcode,
                        length: barcode.length,
                        attemptNum: _scanAttemptCount
                    });
                    return;
                }
                _scanHandled = true;
                // Normalize ISBN-10 to ISBN-13 for API compatibility
                if (barcode.length === 10) {
                    var barcode13 = isbn10to13(barcode);
                    if (barcode13) {
                        if (window.AppLogger) AppLogger.info('[ISBN] Barcode ISBN-10→13: ' + barcode + ' → ' + barcode13);
                        barcode = barcode13;
                    }
                }
                if (window.AppLogger) AppLogger.info('[ISBN] Barcode accepted: ' + barcode, { attemptNum: _scanAttemptCount });
                stopOcrInterval();
                if (statusEl) statusEl.textContent = 'ISBN: ' + barcode;
                try { await _html5QrCode.stop(); } catch(e) {}
                var field = document.getElementById('isbn-manual-field');
                if (field) {
                    field.value = barcode;
                    field.blur(); // Dismiss keyboard
                }
                await onIsbnScanned(barcode);
                _scanHandled = false;
            };

            var _onBarcodeError = function(errorMessage) {
                // Log scan failures periodically (every 50th failure to avoid spam)
                _scanAttemptCount++;
                if (_scanAttemptCount % 50 === 1) {
                    if (window.AppLogger) AppLogger.debug('[ISBN] Scan attempt #' + _scanAttemptCount + ' no match', { error: errorMessage });
                }
                // Full-frame fallback: after 50 failed attempts, restart without qrbox restriction
                if (_scanAttemptCount === 30 && !_fullFrameRetried && _html5QrCode) {
                    _fullFrameRetried = true;
                    if (window.AppLogger) AppLogger.info('[ISBN] Retrying with full-frame scan (no qrbox)');
                    var fullConfig = _scannerConfig();
                    delete fullConfig.qrbox;
                    _html5QrCode.stop().then(function() {
                        return _html5QrCode.start(
                            { facingMode: 'environment' },
                            fullConfig,
                            _onBarcodeSuccess,
                            function(err) {
                                _scanAttemptCount++;
                                if (_scanAttemptCount % 50 === 1) {
                                    if (window.AppLogger) AppLogger.debug('[ISBN] Scan attempt #' + _scanAttemptCount + ' no match (full-frame)', { error: err });
                                }
                            }
                        );
                    }).then(function() {
                        // Re-apply HD resolution after full-frame restart
                        try {
                            var vEl = document.querySelector('#isbn-scanner-reader video');
                            if (vEl && vEl.srcObject) {
                                var trk = vEl.srcObject.getVideoTracks()[0];
                                if (trk) trk.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 } });
                            }
                        } catch(e) {}
                    }).catch(function() {});
                }
            };

            await _html5QrCode.start(
                { facingMode: 'environment' },
                _scannerConfig(),
                _onBarcodeSuccess,
                _onBarcodeError
            );

            // Request HD resolution — default WebView resolution (often 640x480) is too
            // low for barcode detection (bars become 1-2px) and OCR (text too small).
            // Uses applyConstraints on the live track since Html5Qrcode doesn't pass
            // resolution hints through its start() API.
            try {
                var videoEl = document.querySelector('#isbn-scanner-reader video');
                if (videoEl && videoEl.srcObject) {
                    var track = videoEl.srcObject.getVideoTracks()[0];
                    if (track) {
                        await track.applyConstraints({
                            width: { ideal: 1280 },
                            height: { ideal: 720 },
                            focusMode: { ideal: 'continuous' },
                            exposureMode: { ideal: 'continuous' }
                        });
                        var settings = track.getSettings();
                        if (window.AppLogger) AppLogger.info('[ISBN] Camera resolution: ' + settings.width + 'x' + settings.height);
                    }
                }
            } catch(resErr) {
                // applyConstraints may fail on some devices — log but continue with default resolution
                if (window.AppLogger) AppLogger.warn('[ISBN] HD resolution request failed: ' + (resErr.message || resErr));
                try {
                    var fallbackEl = document.querySelector('#isbn-scanner-reader video');
                    if (fallbackEl && fallbackEl.srcObject) {
                        var fbTrack = fallbackEl.srcObject.getVideoTracks()[0];
                        if (fbTrack) {
                            var fbSettings = fbTrack.getSettings();
                            if (window.AppLogger) AppLogger.info('[ISBN] Camera resolution (fallback): ' + fbSettings.width + 'x' + fbSettings.height);
                        }
                    }
                } catch(e2) {}
            }

            if (window.AppLogger) AppLogger.info('[ISBN] Camera started successfully');
            AppState.user.cameraEnabled = true;
            window.saveUserData();
            if (typeof window.updateCameraToggleUI === 'function') window.updateCameraToggleUI();

            // Native BarcodeDetector: parallel high-performance barcode scanning
            if ('BarcodeDetector' in window) {
                try {
                    var _nativeDetector = new BarcodeDetector({
                        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
                    });
                    var _nativeVideoEl = document.querySelector('#isbn-scanner-reader video');
                    var _nativeRunning = true;
                    if (window.AppLogger) AppLogger.info('[ISBN] Native BarcodeDetector enabled');

                    var _nativeFrameCount = 0;
                    var _nativeScanLoop = async function() {
                        if (!_nativeRunning || _scanHandled) return;
                        try {
                            if (_nativeVideoEl && _nativeVideoEl.readyState >= 2) {
                                // Full-frame detect
                                var barcodes = await _nativeDetector.detect(_nativeVideoEl);
                                for (var bi = 0; bi < barcodes.length; bi++) {
                                    var rawVal = (barcodes[bi].rawValue || '').replace(/[-\s]/g, '');
                                    if (isValidIsbn(rawVal)) {
                                        if (window.AppLogger) AppLogger.info('[ISBN] Native BarcodeDetector found: ' + rawVal);
                                        await _onBarcodeSuccess(rawVal);
                                        _nativeRunning = false;
                                        return;
                                    }
                                }
                                // Partial-region detect every 3rd frame (right 30% for Korean vertical barcodes)
                                _nativeFrameCount++;
                                if (_nativeFrameCount % 3 === 0) {
                                    var vw = _nativeVideoEl.videoWidth;
                                    var vh = _nativeVideoEl.videoHeight;
                                    if (vw && vh) {
                                        var partCanvas = document.createElement('canvas');
                                        partCanvas.width = Math.floor(vw * 0.30);
                                        partCanvas.height = vh;
                                        var pCtx = partCanvas.getContext('2d');
                                        pCtx.drawImage(_nativeVideoEl, Math.floor(vw * 0.70), 0, partCanvas.width, vh, 0, 0, partCanvas.width, vh);
                                        var partBarcodes = await _nativeDetector.detect(partCanvas);
                                        for (var pi = 0; pi < partBarcodes.length; pi++) {
                                            var pVal = (partBarcodes[pi].rawValue || '').replace(/[-\s]/g, '');
                                            if (isValidIsbn(pVal)) {
                                                if (window.AppLogger) AppLogger.info('[ISBN] Native BarcodeDetector (right region): ' + pVal);
                                                await _onBarcodeSuccess(pVal);
                                                _nativeRunning = false;
                                                return;
                                            }
                                        }
                                    }
                                }
                            }
                        } catch(detectErr) {
                            // Silently continue on detect errors
                        }
                        if (_nativeRunning && !_scanHandled) {
                            requestAnimationFrame(_nativeScanLoop);
                        }
                    };
                    requestAnimationFrame(_nativeScanLoop);

                    // Store cleanup reference for closeIsbnScanner
                    window._nativeBarcodeCleanup = function() { _nativeRunning = false; };
                } catch(nativeErr) {
                    if (window.AppLogger) AppLogger.warn('[ISBN] Native BarcodeDetector init failed', { message: nativeErr.message });
                }
            }

            // Start OCR as fallback (activates after 5s if barcode not detected)
            startOcrInterval();
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] Scanner start error', { name: e.name, message: e.message });
            console.error('Scanner start error:', e);
            // Camera permission denied or other error
            if (e && (e.name === 'NotAllowedError' || (e.message && e.message.indexOf('Permission') >= 0))) {
                AppState.user.cameraEnabled = false;
                window.saveUserData();
                if (typeof window.updateCameraToggleUI === 'function') window.updateCameraToggleUI();
                if (overlay) overlay.classList.add('d-none');
                const lang = i18n[AppState.currentLang];
                const msg = lang.cam_denied_go_settings || '카메라 권한이 거부되었습니다.\n앱 설정에서 카메라 권한을 허용하시겠습니까?';
                if (confirm(msg)) {
                    if (typeof window.openAppSettings === 'function') window.openAppSettings();
                }
            } else {
                if (statusEl) statusEl.textContent = 'Scanner error: ' + (e.message || e);
            }
        }
    };

    window.closeIsbnScanner = async function() {
        if (window.AppLogger) AppLogger.info('[ISBN] Scanner closed');
        // Stop native BarcodeDetector if running
        if (window._nativeBarcodeCleanup) {
            window._nativeBarcodeCleanup();
            window._nativeBarcodeCleanup = null;
        }
        stopOcrInterval();
        if (_html5QrCode) {
            try { await _html5QrCode.stop(); } catch(e) {}
            _html5QrCode = null;
        }
        const overlay = document.getElementById('isbn-scanner-overlay');
        if (overlay) {
            overlay.classList.add('d-none');
            overlay.style.height = '';
        }
        // Clear reader
        const reader = document.getElementById('isbn-scanner-reader');
        if (reader) { reader.innerHTML = ''; reader.style.display = ''; }
        // Reset embedded result panel
        const resultPanel = document.getElementById('isbn-scan-result');
        if (resultPanel) resultPanel.classList.add('d-none');
        const manualInput = document.getElementById('isbn-manual-input');
        if (manualInput) manualInput.style.display = '';
        // ISBN 입력 필드 초기화
        const manualField = document.getElementById('isbn-manual-field');
        if (manualField) manualField.value = '';
        // 내 서재로 이동 (library-overlay가 열려있으면 유지)
        const libraryOverlay = document.getElementById('library-overlay');
        if (!libraryOverlay || libraryOverlay.classList.contains('d-none')) {
            window.openLibraryView();
        }
    };

    window.manualIsbnLookup = async function() {
        const input = document.getElementById('isbn-manual-field');
        var isbn = (input ? input.value : '').trim().replace(/[-\s]/g, '');
        if (input) input.blur(); // Dismiss keyboard after retrieving value
        if (window.AppLogger) AppLogger.info('[ISBN] Manual lookup: ' + isbn);
        if (!isbn || isbn.length < 10) {
            alert(i18n[AppState.currentLang]?.isbn_invalid || 'ISBN을 정확히 입력해주세요 (10자리 또는 13자리)');
            return;
        }
        // Normalize ISBN-10 to ISBN-13 for API compatibility
        if (isbn.length === 10 && isValidIsbn10(isbn)) {
            var isbn13 = isbn10to13(isbn);
            if (isbn13) {
                if (window.AppLogger) AppLogger.info('[ISBN] Manual ISBN-10→13: ' + isbn + ' → ' + isbn13);
                isbn = isbn13;
            }
        }
        await onIsbnScanned(isbn);
    };

    async function onIsbnScanned(isbn) {
        // Dismiss keyboard to prevent it from staying visible over results
        var _isbnField = document.getElementById('isbn-manual-field');
        if (_isbnField) _isbnField.blur();
        if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();

        if (window.AppLogger) AppLogger.info('[ISBN] Processing ISBN: ' + isbn, { valid: isValidIsbn(isbn) });
        const statusEl = document.getElementById('isbn-scanner-status');
        if (statusEl) statusEl.textContent = '검색 중...';

        const bookInfo = await lookupBookByIsbn(isbn);
        if (!bookInfo) {
            if (window.AppLogger) AppLogger.warn('[ISBN] Book not found for ISBN: ' + isbn);
            // Ask user if they want to enter manually
            if (confirm(t('lib_not_found'))) {
                window.closeIsbnScanner();
                showManualBookEntry(isbn);
            } else {
                if (statusEl) statusEl.textContent = t('lib_scan_hint');
                // Restart scanner + OCR
                try {
                    if (_html5QrCode) {
                        await _html5QrCode.start(
                            { facingMode: 'environment' },
                            _scannerConfig(),
                            async (text) => {
                                var barcode = (text || '').replace(/[-\s]/g, '');
                                if (!isValidIsbn(barcode)) return;
                                stopOcrInterval();
                                try { await _html5QrCode.stop(); } catch(e) {}
                                await onIsbnScanned(barcode);
                            },
                            () => {}
                        );
                        startOcrInterval();
                    }
                } catch(e) {}
            }
            return;
        }
        _pendingBook = bookInfo;
        showBookConfirm(bookInfo);
    }

    async function lookupBookByIsbn(isbn) {
        if (window.AppLogger) AppLogger.info('[ISBN] Looking up ISBN: ' + isbn);
        // 1) Server-side Korean book API proxy (알라딘 → 카카오 → 구글북스)
        try {
            const _ping = window._httpsCallable(window._functions, 'ping');
            const result = await _ping({ action: 'lookupIsbn', isbn: isbn });
            if (result.data && result.data.book) {
                if (window.AppLogger) AppLogger.info('[ISBN] Server lookup success', { title: result.data.book.title, source: result.data.source || 'server' });
                result.data.book._source = result.data.source || null;
                return result.data.book;
            }
            if (window.AppLogger) AppLogger.warn('[ISBN] Server returned no book data', { response: JSON.stringify(result.data).substring(0, 200) });
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] Server lookup error', { message: e.message, code: e.code });
            console.warn('Server ISBN lookup error:', e);
        }

        // 2) Google Books API (client-side emergency fallback — 서버 장애 시)
        try {
            if (window.AppLogger) AppLogger.info('[ISBN] Trying Google Books fallback');
            const res = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + encodeURIComponent(isbn) + '&maxResults=1');
            const data = await res.json();
            if (data.items && data.items.length > 0) {
                const vol = data.items[0].volumeInfo;
                if (window.AppLogger) AppLogger.info('[ISBN] Google Books found', { title: vol.title });
                return {
                    isbn: isbn,
                    title: vol.title || 'Unknown',
                    author: (vol.authors || []).join(', '),
                    publisher: vol.publisher || '',
                    thumbnail: (vol.imageLinks && (vol.imageLinks.thumbnail || vol.imageLinks.smallThumbnail)) || '',
                    description: vol.description || '',
                    pubDate: vol.publishedDate || '',
                    pages: vol.pageCount || 0,
                    _source: 'google'
                };
            }
            if (window.AppLogger) AppLogger.warn('[ISBN] Google Books returned no results');
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[ISBN] Google Books lookup error', { message: e.message });
            console.error('Google Books lookup error:', e);
        }

        return null;
    }

    function showBookConfirm(bookInfo) {
        // Hide camera and manual input areas
        const reader = document.getElementById('isbn-scanner-reader');
        const manualInput = document.getElementById('isbn-manual-input');
        const statusEl = document.getElementById('isbn-scanner-status');
        if (reader) reader.style.display = 'none';
        if (manualInput) manualInput.style.display = 'none';
        if (statusEl) statusEl.textContent = '';

        // Populate embedded result panel inside scanner overlay
        const panel = document.getElementById('isbn-scan-result');
        if (!panel) return;

        document.getElementById('isbn-result-title').textContent = bookInfo.title;
        document.getElementById('isbn-result-author').textContent = bookInfo.author;
        document.getElementById('isbn-result-publisher').textContent = bookInfo.publisher;

        const thumb = document.getElementById('isbn-result-thumb');
        if (bookInfo.thumbnail) {
            thumb.src = bookInfo.thumbnail;
            thumb.style.display = 'block';
        } else {
            thumb.style.display = 'none';
        }

        // Reset category buttons scoped to embedded panel
        const selector = document.getElementById('isbn-result-cat-selector');
        if (selector) {
            selector.querySelectorAll('.book-cat-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.cat === 'reading');
                b.onclick = function() {
                    selector.querySelectorAll('.book-cat-btn').forEach(x => x.classList.remove('active'));
                    this.classList.add('active');
                };
            });
        }

        panel.classList.remove('d-none');
        // Apply i18n
        if (typeof window.changeLanguage === 'function') window.changeLanguage(AppState.currentLang);
    }

    window.confirmScanResult = function() {
        if (!_pendingBook) return;
        const selector = document.getElementById('isbn-result-cat-selector');
        const activeBtn = selector ? selector.querySelector('.book-cat-btn.active') : null;
        const category = activeBtn ? activeBtn.dataset.cat : 'reading';

        const added = window.addBookToLibrary(_pendingBook, category);
        if (added) {
            _pendingBook = null;
            window.closeIsbnScanner();

            // 쌓아보기(최초 진입화면)로 전환
            const libOverlay = document.getElementById('library-overlay');
            if (libOverlay && !libOverlay.classList.contains('d-none')) {
                _libCurrentTab = 'read';
                _libCurrentView = 'tower';
                updateLibraryTabs();
                updateLibraryViewToggle();
                updateLibraryCounts();
                renderLibrary();
            }
            showLibToast(t('lib_book_added'));
        }
    };

    window.cancelScanResult = function() {
        _pendingBook = null;
        // Hide result panel, restore camera/manual input
        const panel = document.getElementById('isbn-scan-result');
        if (panel) panel.classList.add('d-none');

        const reader = document.getElementById('isbn-scanner-reader');
        const manualInput = document.getElementById('isbn-manual-input');
        if (reader) reader.style.display = '';
        if (manualInput) manualInput.style.display = '';

        // Restart scanner
        window.openIsbnScanner();
    };

    // Keep legacy functions for book-confirm-overlay (used outside scanner flow)
    window.confirmAddBook = function() {
        if (!_pendingBook) return;
        const overlay = document.getElementById('book-confirm-overlay');
        const activeBtn = overlay ? overlay.querySelector('.book-cat-btn.active') : null;
        const category = activeBtn ? activeBtn.dataset.cat : 'reading';

        const added = window.addBookToLibrary(_pendingBook, category);
        if (added) {
            if (overlay) { overlay.classList.add('d-none'); overlay.classList.remove('d-flex'); }
            window.closeIsbnScanner();
            _pendingBook = null;

            // 쌓아보기(최초 진입화면)로 전환
            const libOverlay = document.getElementById('library-overlay');
            if (libOverlay && !libOverlay.classList.contains('d-none')) {
                _libCurrentTab = 'read';
                _libCurrentView = 'tower';
                updateLibraryTabs();
                updateLibraryViewToggle();
                updateLibraryCounts();
                renderLibrary();
            }
            showLibToast(t('lib_book_added'));
        }
    };

    window.cancelBookConfirm = function() {
        _pendingBook = null;
        const overlay = document.getElementById('book-confirm-overlay');
        if (overlay) { overlay.classList.add('d-none'); overlay.classList.remove('d-flex'); }
        window.openIsbnScanner();
    };

    // ── Manual Book Entry ──
    function showManualBookEntry(isbn) {
        const overlay = document.getElementById('manual-book-overlay');
        if (!overlay) return;
        document.getElementById('manual-book-isbn').value = isbn;
        document.getElementById('manual-book-title').value = '';
        document.getElementById('manual-book-author').value = '';
        document.getElementById('manual-book-publisher').value = '';
        // Reset category selection
        overlay.querySelectorAll('.book-cat-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.cat === 'reading');
        });
        overlay.querySelectorAll('.book-cat-btn').forEach(b => {
            b.onclick = function() {
                overlay.querySelectorAll('.book-cat-btn').forEach(x => x.classList.remove('active'));
                this.classList.add('active');
            };
        });
        overlay.classList.remove('d-none');
        overlay.classList.add('d-flex');
        // Apply i18n
        if (typeof window.changeLanguage === 'function') window.changeLanguage(AppState.currentLang);
    }

    window.confirmManualBook = function() {
        const title = (document.getElementById('manual-book-title').value || '').trim();
        if (!title) {
            document.getElementById('manual-book-title').focus();
            return;
        }
        const isbn = document.getElementById('manual-book-isbn').value || '';
        const author = (document.getElementById('manual-book-author').value || '').trim();
        const publisher = (document.getElementById('manual-book-publisher').value || '').trim();
        const overlay = document.getElementById('manual-book-overlay');
        const activeBtn = overlay ? overlay.querySelector('.book-cat-btn.active') : null;
        const category = activeBtn ? activeBtn.dataset.cat : 'reading';

        const bookInfo = { isbn: isbn, title: title, author: author, publisher: publisher, thumbnail: '' };
        const added = window.addBookToLibrary(bookInfo, category);
        if (added) {
            if (overlay) { overlay.classList.add('d-none'); overlay.classList.remove('d-flex'); }
            // 쌓아보기(최초 진입화면)로 전환
            const libOverlay = document.getElementById('library-overlay');
            if (libOverlay && !libOverlay.classList.contains('d-none')) {
                _libCurrentTab = 'read';
                _libCurrentView = 'tower';
                updateLibraryTabs();
                updateLibraryViewToggle();
                updateLibraryCounts();
                renderLibrary();
            }
            showLibToast(t('lib_book_added'));
        }
    };

    window.cancelManualBook = function() {
        const overlay = document.getElementById('manual-book-overlay');
        if (overlay) { overlay.classList.add('d-none'); overlay.classList.remove('d-flex'); }
    };

    function showLibToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:rgba(0,217,255,0.9); color:#fff; padding:10px 24px; border-radius:20px; font-size:0.85rem; font-weight:600; z-index:9999; animation:fadeIn 0.3s;';
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 2000);
    }

    // --- 내 서재 가이드 모달 ---
    window.openLibraryInfoModal = function() {
        const lang = AppState.currentLang;
        const guideData = {
            ko: {
                title: '내 서재 가이드',
                sections: [
                    { icon: '📚', title: '책 등록', desc: '📷 버튼으로 ISBN 바코드를 스캔하거나, 검색창에서 직접 책을 검색하여 추가하세요.' },
                    { icon: '📖', title: '카테고리', desc: '읽고있는책, 읽은책, 읽고싶은책 3가지 카테고리로 관리할 수 있습니다.' },
                    { icon: '🏆', title: '독서 보상', desc: '책을 읽은책으로 등록하면 +10P & INT +0.5 보상을 받습니다! (책 당 1회)' },
                    { icon: '📊', title: '통계', desc: '전체, 연간, 월간 독서량을 확인할 수 있습니다.' },
                    { icon: '🗼', title: '바벨의 도서관', desc: '읽은 책을 쌓아서 바벨탑을 만들어보세요!' }
                ]
            },
            en: {
                title: 'Library Guide',
                sections: [
                    { icon: '📚', title: 'Add Books', desc: 'Scan ISBN barcodes with the 📷 button or search for books directly.' },
                    { icon: '📖', title: 'Categories', desc: 'Organize books into Reading, Read, and Want to Read.' },
                    { icon: '🏆', title: 'Reading Reward', desc: 'Mark a book as Read to earn +10P & INT +0.5! (Once per book)' },
                    { icon: '📊', title: 'Statistics', desc: 'View your reading stats by total, yearly, and monthly.' },
                    { icon: '🗼', title: 'Tower of Babel', desc: 'Stack your read books to build your own Tower of Babel!' }
                ]
            },
            ja: {
                title: '書斎ガイド',
                sections: [
                    { icon: '📚', title: '本の登録', desc: '📷ボタンでISBNバーコードをスキャンするか、検索で直接本を追加できます。' },
                    { icon: '📖', title: 'カテゴリ', desc: '読書中、読了、読みたいの3つのカテゴリで管理できます。' },
                    { icon: '🏆', title: '読書報酬', desc: '本を読了に登録すると+10P & INT +0.5の報酬！（本ごとに1回）' },
                    { icon: '📊', title: '統計', desc: '全体、年間、月間の読書量を確認できます。' },
                    { icon: '🗼', title: 'バベルの図書館', desc: '読んだ本を積み上げてバベルの塔を作りましょう！' }
                ]
            }
        };

        const g = guideData[lang] || guideData.ko;
        document.getElementById('info-modal-title').innerText = g.title;
        const body = document.getElementById('info-modal-body');
        body.innerHTML = g.sections.map(s => `
            <div style="display:flex; gap:10px; align-items:flex-start; padding:10px 0; border-bottom:1px dashed var(--border-color);">
                <span style="font-size:1.3rem; flex-shrink:0;">${s.icon}</span>
                <div>
                    <div style="font-size:0.85rem; font-weight:bold; color:var(--neon-blue); margin-bottom:3px;">${s.title}</div>
                    <div style="font-size:0.75rem; color:var(--text-sub); line-height:1.5; word-break:keep-all;">${s.desc}</div>
                </div>
            </div>
        `).join('');

        const m = document.getElementById('infoModal');
        m.classList.remove('d-none');
        m.classList.add('d-flex');

        // 네이티브 광고 숨김 (팝업 위에 겹치지 않도록)
        if (window.isNativePlatform && window.AdManager && window.AdManager.nativeAdActiveTab) {
            try {
                const { NativeAd } = window.Capacitor.Plugins;
                if (NativeAd) NativeAd.hideAd();
            } catch (e) { /* 무시 */ }
        }
    };
})();
