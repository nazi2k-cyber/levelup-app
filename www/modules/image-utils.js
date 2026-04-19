// ===== 이미지 유틸리티 모듈 =====
(function() {
    'use strict';

    // --- Module Bridge 의존성 ---
    const storage              = window._storage;
    const ref                  = window._ref;
    const uploadBytes          = window._uploadBytes;
    const uploadBytesResumable = window._uploadBytesResumable;
    const getDownloadURL       = window._getDownloadURL;
    const deleteObject         = window._deleteObject;
    const NetworkMonitor       = window.NetworkMonitor;

    // --- 프로필 이미지 기본값 & 안전한 로드 ---
    const DEFAULT_PROFILE_SVG = "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27%23555%27%3E%3Cpath d=%27M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%27/%3E%3C/svg%3E";

    // --- Firebase Storage 이미지 로드 헬퍼 (WebView fetch+blob 폴백) ---
    const _blobUrlCache = new Map();
    const _BLOB_CACHE_MAX = 100;

    async function _fetchAsBlobUrl(url) {
        const cached = _blobUrlCache.get(url);
        if (cached) return cached;
        try {
            const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (!resp.ok) return null;
            const blob = await resp.blob();
            if (!blob || blob.size === 0) return null;
            const blobUrl = URL.createObjectURL(blob);
            if (_blobUrlCache.size >= _BLOB_CACHE_MAX) {
                const firstKey = _blobUrlCache.keys().next().value;
                URL.revokeObjectURL(_blobUrlCache.get(firstKey));
                _blobUrlCache.delete(firstKey);
            }
            _blobUrlCache.set(url, blobUrl);
            return blobUrl;
        } catch (e) {
            return null;
        }
    }

    // 글로벌 함수: innerHTML onerror에서 호출 가능
    // fallbackSrc: 실패 시 대체 이미지 (없으면 숨김)
    // hideAndShowNext: true면 실패 시 img 숨기고 nextElementSibling 표시
    function _retryFirebaseImg(imgEl, originalUrl, fallbackSrc, hideAndShowNext) {
        _fetchAsBlobUrl(originalUrl).then(blobUrl => {
            if (blobUrl) { imgEl.src = blobUrl; }
            else if (fallbackSrc) { imgEl.src = fallbackSrc; }
            else if (hideAndShowNext) { imgEl.style.display = 'none'; if (imgEl.nextElementSibling) imgEl.nextElementSibling.style.display = ''; }
            else { imgEl.style.display = 'none'; }
        }).catch(() => {
            if (fallbackSrc) imgEl.src = fallbackSrc;
            else if (hideAndShowNext) { imgEl.style.display = 'none'; if (imgEl.nextElementSibling) imgEl.nextElementSibling.style.display = ''; }
            else imgEl.style.display = 'none';
        });
    }

    function setProfilePreview(url) {
        const el = document.getElementById('profilePreview');
        if (!el) return;
        if (!url || url === DEFAULT_PROFILE_SVG) { el.src = url || DEFAULT_PROFILE_SVG; return; }
        const cached = _blobUrlCache.get(url);
        if (cached) { el.src = cached; return; }
        el.onerror = function() {
            this.onerror = null;
            _retryFirebaseImg(this, url, DEFAULT_PROFILE_SVG);
        };
        el.src = url;
    }

    // --- Cloud Storage 헬퍼 ---
    function isBase64Image(str) {
        return typeof str === 'string' && str.startsWith('data:image/');
    }

    // 업로드 실패 재전송 큐 (로컬 메모리 + localStorage 백업)
    const _uploadRetryQueue = [];
    let _retryProcessing = false;
    function _persistRetryQueue() {
        try {
            const serializable = _uploadRetryQueue.map(item => ({
                storagePath: item.storagePath,
                timestamp: item.timestamp
            }));
            localStorage.setItem('upload_retry_queue', JSON.stringify(serializable));
        } catch (e) { /* quota exceeded 등 무시 */ }
    }
    function _addToRetryQueue(storagePath, base64str) {
        // 동일 경로 중복 방지
        const exists = _uploadRetryQueue.some(item => item.storagePath === storagePath);
        if (exists) {
            console.warn(`[UploadRetry] 이미 큐에 존재: ${storagePath}`);
            return;
        }
        _uploadRetryQueue.push({ storagePath, base64str, timestamp: Date.now() });
        _persistRetryQueue();
        console.warn(`[UploadRetry] 재전송 큐에 추가: ${storagePath} (큐 크기: ${_uploadRetryQueue.length})`);
        if (window.AppLogger) AppLogger.warn(`[UploadRetry] 큐 추가: ${storagePath}`);
    }

    // 네트워크 복구 시 재전송 큐 자동 처리
    window.addEventListener('online', () => {
        console.log('[Network] 온라인 복구 — 재전송 큐 처리');
        setTimeout(_flushRetryQueue, 3000); // 3초 대기 후 처리 (네트워크 안정화)
    });

    // 제1원칙: 재시도 큐는 온라인 복귀 시 자동으로 비워져야 한다
    let _flushingRetryQueue = false;
    async function _flushRetryQueue() {
        if (_flushingRetryQueue || _uploadRetryQueue.length === 0) return;
        if (!navigator.onLine) return;
        _flushingRetryQueue = true;
        if (window.AppLogger) AppLogger.info(`[UploadRetry] 큐 자동 재전송 시작 (${_uploadRetryQueue.length}건)`);
        const items = [..._uploadRetryQueue];
        for (const item of items) {
            if (!navigator.onLine) break; // 재전송 중 오프라인 전환 시 중단
            if (!item.base64str) continue; // base64 데이터 없으면 스킵
            // 24시간 이상 경과된 항목은 폐기
            if (Date.now() - item.timestamp > 24 * 60 * 60 * 1000) {
                const idx = _uploadRetryQueue.indexOf(item);
                if (idx >= 0) _uploadRetryQueue.splice(idx, 1);
                if (window.AppLogger) AppLogger.info(`[UploadRetry] 만료 항목 제거: ${item.storagePath}`);
                continue;
            }
            try {
                await uploadImageToStorage(item.storagePath, item.base64str);
                const idx = _uploadRetryQueue.indexOf(item);
                if (idx >= 0) _uploadRetryQueue.splice(idx, 1);
                if (window.AppLogger) AppLogger.info(`[UploadRetry] 재전송 성공: ${item.storagePath}`);
            } catch (e) {
                if (window.AppLogger) AppLogger.warn(`[UploadRetry] 재전송 실패: ${item.storagePath} — ${e.message}`);
                break; // 네트워크 문제일 수 있으므로 중단
            }
        }
        _persistRetryQueue();
        _flushingRetryQueue = false;
    }

    // 업로드 직렬화 큐 — WebView 네트워크 경합 방지 (동시 업로드 → 순차 실행)
    const _uploadQueue = [];
    let _uploadRunning = false;

    async function _processUploadQueue() {
        if (_uploadRunning) return;
        _uploadRunning = true;
        while (_uploadQueue.length > 0) {
            const { fn, resolve, reject } = _uploadQueue.shift();
            try { resolve(await fn()); }
            catch (e) { reject(e); }
        }
        _uploadRunning = false;
    }

    function enqueueUpload(fn) {
        return new Promise((resolve, reject) => {
            _uploadQueue.push({ fn, resolve, reject });
            _processUploadQueue();
        });
    }

    // WebP 포맷 지원 감지 — canvas.toDataURL('image/webp') 결과로 판별
    const _supportsWebP = (() => {
        try {
            const c = document.createElement('canvas');
            c.width = 1; c.height = 1;
            return c.toDataURL('image/webp').startsWith('data:image/webp');
        } catch (e) { return false; }
    })();

    function canvasToOptimalDataURL(canvas, quality) {
        if (_supportsWebP) return canvas.toDataURL('image/webp', quality);
        return canvas.toDataURL('image/jpeg', quality);
    }

    function getImageExtension() {
        return _supportsWebP ? '.webp' : '.jpg';
    }

    // 썸네일 URL 변환: Firebase Storage 원본 URL → thumbs/ 경로 썸네일 URL
    function getThumbnailURL(originalURL) {
        if (!originalURL || typeof originalURL !== 'string') return originalURL;
        // Firebase Storage URL 패턴: .../{prefix}%2F... (URL-encoded path)
        const prefixes = ['reels_photos', 'profile_images', 'planner_photos'];
        for (const prefix of prefixes) {
            const encoded = encodeURIComponent(prefix + '/');  // e.g. "reels_photos%2F"
            if (originalURL.includes(encoded)) {
                return originalURL.replace(encoded, encodeURIComponent('thumbs/' + prefix + '/'));
            }
        }
        return originalURL;
    }

    // base64 이미지 압축 유틸리티 (maxDim: 최대 픽셀, quality: 0~1)
    function compressBase64Image(base64str, maxDim, quality) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
                    else { w = Math.round(w * maxDim / h); h = maxDim; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvasToOptimalDataURL(canvas, quality));
            };
            img.onerror = () => resolve(base64str); // 실패 시 원본 반환
            img.src = base64str;
        });
    }

    // 파일 크기 기반 동적 타임아웃 계산 (기본 30s + MB당 60s, 최소 30s, 최대 300s)
    function _calcUploadTimeout(blobSize, networkQuality) {
        const base = Math.min(Math.max(30000, 30000 + Math.ceil(blobSize / (1024 * 1024)) * 60000), 300000);
        return networkQuality === 'weak' ? base * 2 : base;
    }

    // base64 데이터 URL → Blob 변환 헬퍼
    function dataURLtoBlob(dataURL) {
        const parts = dataURL.split(',');
        const contentType = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
        const byteString = atob(parts[1]);
        const u8arr = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) u8arr[i] = byteString.charCodeAt(i);
        return new Blob([u8arr], { type: contentType });
    }

    // 적응형 압축: 목표 크기 이하가 될 때까지 품질을 반복 조정
    async function compressToTargetSize(canvas, maxBytes, initialQuality = 0.8, minQuality = 0.1) {
        let quality = initialQuality;
        let currentCanvas = canvas;
        let dataURL, blob;

        while (true) {
            dataURL = canvasToOptimalDataURL(currentCanvas, quality);
            blob = dataURLtoBlob(dataURL);

            if (blob.size <= maxBytes) {
                return { dataURL, blob, quality, dimensions: { w: currentCanvas.width, h: currentCanvas.height } };
            }

            quality = Math.round((quality - 0.1) * 10) / 10;

            if (quality < minQuality) {
                // 품질만으로 부족 → 캔버스 크기 75%로 축소 후 재시도
                const newW = Math.round(currentCanvas.width * 0.75);
                const newH = Math.round(currentCanvas.height * 0.75);
                if (newW < 50 || newH < 50) break; // 최소 크기 보호
                const smaller = document.createElement('canvas');
                smaller.width = newW; smaller.height = newH;
                smaller.getContext('2d').drawImage(currentCanvas, 0, 0, newW, newH);
                currentCanvas = smaller;
                quality = initialQuality; // 축소 후 품질 리셋
            }
        }
        // 최종 결과 반환 (최소 크기에 도달)
        return { dataURL, blob, quality, dimensions: { w: currentCanvas.width, h: currentCanvas.height } };
    }

    // 업로드 진행률 토스트 UI 헬퍼
    let _uploadToastHideTimer = null;
    function showUploadProgress(pct, label) {
        const toast = document.getElementById('upload-progress-toast');
        if (!toast) return;
        toast.style.display = 'block';
        const bar = document.getElementById('upload-progress-bar');
        const pctEl = document.getElementById('upload-progress-pct');
        const labelEl = document.getElementById('upload-progress-label');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (labelEl && label) labelEl.textContent = label;
        if (_uploadToastHideTimer) { clearTimeout(_uploadToastHideTimer); _uploadToastHideTimer = null; }
    }
    function hideUploadProgress() {
        if (_uploadToastHideTimer) clearTimeout(_uploadToastHideTimer);
        _uploadToastHideTimer = setTimeout(() => {
            const toast = document.getElementById('upload-progress-toast');
            if (toast) toast.style.display = 'none';
            _uploadToastHideTimer = null;
        }, 800);
    }
    function createUploadProgressCallback(label) {
        const lang = window.AppState?.currentLang || 'ko';
        const defaultLabel = window.i18n?.[lang]?.upload_progress || '업로드 중...';
        return (pct) => showUploadProgress(pct, label || defaultLabel);
    }

    async function uploadImageToStorage(storagePath, base64str, onProgress) {
        return enqueueUpload(() => _uploadImageToStorageImpl(storagePath, base64str, onProgress));
    }

    async function _uploadImageToStorageImpl(storagePath, base64str, onProgress) {
        const _log = (step, msg) => { console.log(`[Upload:${step}] ${msg}`); if (window.AppLogger) AppLogger.info(`[Upload:${step}] ${msg}`); };

        // 제1원칙: 오프라인에서 업로드 시도는 배터리 낭비 — 즉시 큐에 넣고 종료
        if (!navigator.onLine) {
            _log('0-OFFLINE', 'Offline detected, queuing for later');
            _addToRetryQueue(storagePath, base64str);
            const err = new Error('Device is offline — upload queued for retry');
            err.code = 'client/offline-queued';
            throw err;
        }

        _log('1-START', `path=${storagePath}, inputLen=${base64str ? base64str.length : 'null'}, startsWithData=${base64str ? base64str.startsWith('data:') : 'N/A'}`);
        let blob, contentType;
        if (base64str.startsWith('data:')) {
            _log('2-DECODE', `base64PartLen=${base64str.length}`);
            blob = dataURLtoBlob(base64str);
            contentType = blob.type;
            _log('3-BLOB', `blobSize=${blob.size}, blobType=${blob.type}`);
        } else {
            _log('2-FETCH', 'Using fetch() for non-data URI');
            const res = await fetch(base64str);
            blob = await res.blob();
            contentType = blob.type || 'image/jpeg';
            _log('3-BLOB', `blobSize=${blob.size}, blobType=${blob.type}`);
        }

        // 업로드 전 크기 검증 — Firebase Storage 규칙 거부 방지
        const SIZE_LIMITS = { 'profile_images': 500 * 1024, 'planner_photos': 2 * 1024 * 1024, 'reels_photos': 2 * 1024 * 1024 };
        const pathPrefix = storagePath.split('/')[0];
        const limit = SIZE_LIMITS[pathPrefix];
        if (limit && blob.size > limit) {
            const err = new Error(`Image size ${blob.size} exceeds ${limit} byte limit for ${pathPrefix}`);
            err.code = 'client/image-too-large';
            _log('3-SIZE-CHECK', err.message);
            throw err;
        }
        const storageRef = ref(storage, storagePath);

        // CDN 캐싱을 위한 Cache-Control 메타데이터 설정
        const CACHE_CONTROL_MAP = {
            'reels_photos': 'public, max-age=86400',      // 24시간 (릴스 수명과 일치)
            'profile_images': 'public, max-age=604800',    // 7일 (변경 빈도 낮음)
            'planner_photos': 'private, max-age=86400'     // 비공개, 1일
        };
        const cacheControl = CACHE_CONTROL_MAP[pathPrefix] || 'no-cache';

        // 프로필 이미지: 기존 파일 삭제 후 업로드 (best-effort, 5초 타임아웃)
        if (storagePath.startsWith('profile_images/')) {
            try {
                await Promise.race([
                    deleteObject(storageRef),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('delete timeout')), 5000))
                ]);
                _log('3.5-DELETE', 'Existing profile image deleted');
            } catch (e) {
                _log('3.5-DELETE', `Delete skipped: ${e.code || e.message}`);
            }
        }

        // 네트워크 품질 기반 동적 타임아웃 계산
        const networkQuality = NetworkMonitor.getQuality();
        const uploadTimeoutMs = _calcUploadTimeout(blob.size, networkQuality);
        _log('3.9-TIMEOUT', `timeout=${uploadTimeoutMs}ms (blob=${blob.size}B, network=${networkQuality})`);

        // 지수 백오프 재시도 (최대 3회, 3s → 6s → 실패)
        const MAX_RETRIES = 3;
        const BASE_DELAY_MS = 3000;
        let lastError;
        const useSimpleUpload = blob.size < 100 * 1024; // 100KB 미만: 단일 PUT (uploadBytes)
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            // 재시도 전 네트워크 상태 재확인 — 오프라인이면 즉시 큐에 넣기
            if (attempt > 1 && !navigator.onLine) {
                _log('4-OFFLINE', 'Network lost during retries, queuing');
                _addToRetryQueue(storagePath, base64str);
                const err = new Error('Network lost during upload retries — queued');
                err.code = 'client/offline-queued';
                throw err;
            }
            try {
                if (useSimpleUpload) {
                    _log('4-UPLOAD', `Using simple uploadBytes (${blob.size}B), attempt ${attempt}/${MAX_RETRIES}`);
                    const snapshot = await Promise.race([
                        uploadBytes(storageRef, blob, { contentType, cacheControl }),
                        new Promise((_, rej) => setTimeout(() => rej(new Error(`Upload timed out after ${uploadTimeoutMs / 1000}s`)), uploadTimeoutMs))
                    ]);
                    if (onProgress) onProgress(100);
                    const downloadURL = await getDownloadURL(snapshot.ref);
                    _log('6-DONE', `downloadURL=${downloadURL.substring(0, 80)}...`);
                    return downloadURL;
                } else {
                    _log('4-UPLOAD', `Calling uploadBytesResumable... (attempt ${attempt}/${MAX_RETRIES})`);
                    const url = await new Promise((resolve, reject) => {
                        const uploadTask = uploadBytesResumable(storageRef, blob, { contentType, cacheControl });
                        let lastProgressTime = Date.now();
                        const timeout = setTimeout(() => {
                            uploadTask.cancel();
                            reject(new Error(`Upload timed out after ${uploadTimeoutMs / 1000}s`));
                        }, uploadTimeoutMs);
                        // 진행률 감시: 30초간 진행 없으면 조기 타임아웃
                        const stallCheck = setInterval(() => {
                            if (Date.now() - lastProgressTime > 30000) {
                                clearInterval(stallCheck);
                                clearTimeout(timeout);
                                uploadTask.cancel();
                                reject(new Error('Upload stalled — no progress for 30s'));
                            }
                        }, 5000);
                        uploadTask.on('state_changed',
                            (snapshot) => {
                                lastProgressTime = Date.now();
                                const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                                _log('4-PROGRESS', `${pct}% (${snapshot.bytesTransferred}/${snapshot.totalBytes})`);
                                if (onProgress) onProgress(pct);
                            },
                            (error) => {
                                clearTimeout(timeout);
                                clearInterval(stallCheck);
                                reject(error);
                            },
                            async () => {
                                clearTimeout(timeout);
                                clearInterval(stallCheck);
                                try {
                                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                                    resolve(downloadURL);
                                } catch (e) { reject(e); }
                            }
                        );
                    });
                    _log('6-DONE', `downloadURL=${url.substring(0, 80)}...`);
                    if (onProgress) onProgress(100);
                    return url;
                }
            } catch (e) {
                lastError = e;
                _log('4-RETRY', `attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}`);
                if (onProgress) onProgress(0);
                if (attempt < MAX_RETRIES) {
                    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    _log('4-WAIT', `Waiting ${delay}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        // 모든 재시도 실패 — 재전송 큐에 추가
        _addToRetryQueue(storagePath, base64str);
        throw lastError;
    }

    // Public API
    window.DEFAULT_PROFILE_SVG          = DEFAULT_PROFILE_SVG;
    window.isBase64Image                = isBase64Image;
    window.compressBase64Image          = compressBase64Image;
    window.compressToTargetSize         = compressToTargetSize;
    window.dataURLtoBlob                = dataURLtoBlob;
    window.canvasToOptimalDataURL       = canvasToOptimalDataURL;
    window._supportsWebP                = _supportsWebP;
    window.getImageExtension            = getImageExtension;
    window.getThumbnailURL              = getThumbnailURL;
    window.uploadImageToStorage         = uploadImageToStorage;
    window.showUploadProgress           = showUploadProgress;
    window.hideUploadProgress           = hideUploadProgress;
    window.createUploadProgressCallback = createUploadProgressCallback;
    window.setProfilePreview            = setProfilePreview;
    window._retryFirebaseImg            = _retryFirebaseImg;
    window._flushRetryQueue             = _flushRetryQueue;
})();
