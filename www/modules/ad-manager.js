// ========== Ad Manager Module (AdMob 광고 관리) ==========
// IIFE 패턴 — window.AdManager 로 공개 API 노출
(function() {
    'use strict';

    // --- 광고 단위 ID ---
    const REWARDED_AD_UNIT_ID = 'ca-app-pub-6654057059754695/8552907541';
    const REWARDED_AD_TEST_ID = 'ca-app-pub-3940256099942544/5224354917';
    const BONUS_EXP_AMOUNT = 50;

    const BANNER_AD_UNIT_ID = 'ca-app-pub-6654057059754695/2995161826';
    const BANNER_AD_TEST_ID = 'ca-app-pub-3940256099942544/6300978111';

    const REWARDED_INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-6654057059754695/6916027284';
    const RI_DUNGEON_DAILY_MAX = 2;

    const NATIVE_AD_UNIT_ID = 'ca-app-pub-6654057059754695/8612252339';
    const NATIVE_AD_TEST_ID = 'ca-app-pub-3940256099942544/2247696110';
    const NATIVE_AD_POSITION = 5;
    const REELS_NATIVE_AD_POSITION = 3;

    // --- 내부 상태 ---
    let _admobInitialized = false;
    let _consentStatus = 'UNKNOWN';

    // 보상형 광고
    let _rewardedAdReady = false;
    let _rewardedAdListenersRegistered = false;
    let _rewardEarned = false;
    let _rewardedAdContext = 'bonusExp';
    let _rewardedAdOnSuccess = null;
    let _rewardedAdOnFail = null;

    // 보상형 전면 광고
    let _rewardedInterstitialReady = false;
    let _rewardedInterstitialListenersRegistered = false;
    let _riRewardEarned = false;
    let _riContext = null;

    // 배너 광고
    let _bannerAdLoaded = false;
    let _bannerAdVisible = false;

    // 네이티브 광고
    let _nativeAdLoaded = false;
    let _nativeAdVisible = false;
    let _nativeAdScrollRAF = null;
    let _nativeAdObserver = null;
    let _nativeAdActiveTab = null;
    let _nativeAdDisabled = false;
    let _nativeAdUnavailableLogged = false;
    let _nativeAdMissingCount = 0;
    let _nativeAdUsingBannerFallback = false;

    // 모달 오버레이 시 광고 일시 숨김 플래그
    let _adsHiddenForModal = false;

    // 보너스 EXP
    let _bonusExpTimerInterval = null;
    let _bonusExpInProgress = false;

    // --- 헬퍼: window 전역 참조 ---
    function _isNative() { return window.isNativePlatform; }
    function _AppState() { return window.AppState; }
    function _auth() { return window._auth; }
    function _i18n() { return window.i18n; }
    function _getNativeAdPlugin() {
        return window?.Capacitor?.Plugins?.NativeAd || null;
    }
    function _handleMissingNativeAdPlugin() {
        _nativeAdMissingCount += 1;
        if (_nativeAdMissingCount >= 3) _nativeAdDisabled = true;
        if (_nativeAdUnavailableLogged) return;
        _nativeAdUnavailableLogged = true;
        const pluginKeys = Object.keys(window?.Capacitor?.Plugins || {}).join(', ');
        if (window.AppLogger) {
            AppLogger.warn('[NativeAd] 플러그인 사용 불가 — NativeAd 미등록. available=' + (pluginKeys || '(none)'));
        }
    }

    // --- GDPR/동의 ---
    async function resetConsent() {
        if (!_isNative()) return;
        try {
            const { AdMob } = window.Capacitor.Plugins;
            if (!AdMob) return;
            await AdMob.resetConsentInfo();
            _consentStatus = 'UNKNOWN';
            if (window.AppLogger) AppLogger.info('[AdMob] 동의 상태 리셋 완료');
        } catch (e) {
            if (window.AppLogger) AppLogger.warn('[AdMob] 동의 리셋 실패: ' + (e.message || ''));
        }
    }

    function canShowPersonalizedAds() {
        return _consentStatus === 'OBTAINED' || _consentStatus === 'NOT_REQUIRED';
    }

    // --- AdMob 초기화 ---
    async function init() {
        if (_admobInitialized) return;
        if (!_isNative()) return;
        try {
            const { AdMob } = window.Capacitor.Plugins;
            if (!AdMob) return;

            // GDPR/UMP 동의 상태 확인 및 동의 양식 표시
            try {
                const consentInfo = await AdMob.requestConsentInfo();
                _consentStatus = consentInfo.status || 'UNKNOWN';
                if (window.AppLogger) AppLogger.info('[AdMob] 동의 상태: ' + _consentStatus +
                    (consentInfo.isConsentFormAvailable ? ' (양식 사용 가능)' : ' (양식 없음)'));

                if (_consentStatus === 'REQUIRED' && consentInfo.isConsentFormAvailable) {
                    try {
                        await AdMob.showConsentForm();
                        _consentStatus = 'OBTAINED';
                        if (window.AppLogger) AppLogger.info('[AdMob] GDPR 동의 양식 표시 완료');
                    } catch (formErr) {
                        const errMsg = formErr.message || formErr.errorMessage || '';
                        if (window.AppLogger) AppLogger.warn('[AdMob] 동의 양식 표시 실패: ' + errMsg);
                    }
                } else if (_consentStatus === 'REQUIRED' && !consentInfo.isConsentFormAvailable) {
                    if (window.AppLogger) AppLogger.error(
                        '[AdMob] 동의 양식 미설정 (Publisher misconfiguration 가능). ' +
                        'Firebase 콘솔 → Privacy & messaging → GDPR 에서 동의 양식을 생성하세요. ' +
                        'App ID: ca-app-pub-6654057059754695~3529972498'
                    );
                }
            } catch (consentErr) {
                const errMsg = consentErr.message || consentErr.errorMessage || '';
                const isMisconfiguration = errMsg.toLowerCase().includes('misconfigur') ||
                    errMsg.toLowerCase().includes('form unavailable') ||
                    errMsg.toLowerCase().includes('no matching form');
                if (isMisconfiguration) {
                    if (window.AppLogger) AppLogger.error(
                        '[AdMob] Publisher misconfiguration — 동의 양식이 AdMob 콘솔에 설정되지 않았습니다. ' +
                        'Firebase 콘솔 → Privacy & messaging 에서 GDPR 메시지를 생성하세요. ' +
                        'App ID: ca-app-pub-6654057059754695~3529972498'
                    );
                } else {
                    if (window.AppLogger) AppLogger.warn('[AdMob] 동의 확인 실패: ' + errMsg);
                }
            }

            await AdMob.initialize({
                initializeForTesting: false,
                tagForChildDirectedTreatment: false,
                tagForUnderAgeOfConsent: false,
                maxAdContentRating: 'G',
            });
            _admobInitialized = true;
            if (window.AppLogger) AppLogger.info('[AdMob] 초기화 완료');

            // 보상형 광고 이벤트 리스너 등록 (1회만)
            if (!_rewardedAdListenersRegistered) {
                _rewardedAdListenersRegistered = true;

                AdMob.addListener('onRewardedVideoAdReward', (reward) => {
                    console.log('[AdMob] 보상 획득:', reward);
                    if (window.AppLogger) AppLogger.info('[AdMob] 보상 획득: ' + JSON.stringify(reward));
                    _rewardEarned = true;
                });

                AdMob.addListener('onRewardedVideoAdDismissed', () => {
                    console.log('[AdMob] 광고 닫힘, 보상 획득 여부:', _rewardEarned, '컨텍스트:', _rewardedAdContext);
                    if (window.AppLogger) AppLogger.info('[AdMob] 광고 닫힘, rewarded=' + _rewardEarned + ', ctx=' + _rewardedAdContext);

                    _rewardedAdReady = false;
                    preloadRewarded._retryCount = 0;
                    preloadRewarded();

                    if (_rewardEarned) {
                        _rewardEarned = false;
                        if (_rewardedAdOnSuccess) {
                            _rewardedAdOnSuccess();
                        } else {
                            _bonusExpInProgress = false;
                            if (window.applyBonusExpReward) window.applyBonusExpReward();
                        }
                    } else {
                        if (_rewardedAdOnFail) {
                            _rewardedAdOnFail();
                        } else {
                            localStorage.removeItem(_bonusExpKey());
                            _bonusExpInProgress = false;
                            const lang = _AppState().currentLang;
                            alert(_i18n()[lang].bonus_exp_fail);
                            renderBonusExp();
                        }
                    }
                    _rewardedAdContext = 'bonusExp';
                    _rewardedAdOnSuccess = null;
                    _rewardedAdOnFail = null;
                });

                AdMob.addListener('onRewardedVideoAdFailedToShow', (error) => {
                    console.warn('[AdMob] 광고 표시 실패:', error);
                    if (window.AppLogger) AppLogger.warn('[AdMob] 표시 실패: ' + JSON.stringify(error));
                    _rewardedAdReady = false;
                    _rewardEarned = false;
                    preloadRewarded._retryCount = 0;
                    preloadRewarded();
                    if (_rewardedAdOnFail) {
                        _rewardedAdOnFail();
                    } else {
                        localStorage.removeItem(_bonusExpKey());
                        _bonusExpInProgress = false;
                        const lang = _AppState().currentLang;
                        alert(_i18n()[lang].bonus_exp_not_ready);
                        renderBonusExp();
                    }
                    _rewardedAdContext = 'bonusExp';
                    _rewardedAdOnSuccess = null;
                    _rewardedAdOnFail = null;
                });

                AdMob.addListener('onRewardedVideoAdLoaded', () => {
                    _rewardedAdReady = true;
                    if (window.AppLogger) AppLogger.info('[AdMob] 보상형 광고 로드 완료');
                });

                AdMob.addListener('onRewardedVideoAdFailedToLoad', (error) => {
                    _rewardedAdReady = false;
                    console.warn('[AdMob] 보상형 광고 로드 실패:', error);
                    if (window.AppLogger) AppLogger.warn('[AdMob] 로드 실패: ' + JSON.stringify(error));
                });
            }

            preloadRewarded();

            // 보상형 전면 광고 리스너 등록
            if (!_rewardedInterstitialListenersRegistered) {
                _rewardedInterstitialListenersRegistered = true;

                AdMob.addListener('onRewardedInterstitialAdLoaded', () => {
                    _rewardedInterstitialReady = true;
                    if (window.AppLogger) AppLogger.info('[AdMob] 보상형 전면 광고 로드 완료');
                });

                AdMob.addListener('onRewardedInterstitialAdFailedToLoad', (error) => {
                    _rewardedInterstitialReady = false;
                    if (window.AppLogger) AppLogger.warn('[AdMob] 보상형 전면 광고 로드 실패: ' + JSON.stringify(error));
                });

                AdMob.addListener('onRewardedInterstitialAdReward', (reward) => {
                    _riRewardEarned = true;
                    if (window.AppLogger) AppLogger.info('[AdMob] 보상형 전면 보상 획득: ' + JSON.stringify(reward));
                });

                AdMob.addListener('onRewardedInterstitialAdDismissed', () => {
                    _rewardedInterstitialReady = false;
                    preloadRewardedInterstitial._retryCount = 0;
                    preloadRewardedInterstitial();
                    if (_riRewardEarned) {
                        _riRewardEarned = false;
                        if (window.applyRewardedInterstitialBonus) {
                            window.applyRewardedInterstitialBonus(_riContext);
                        }
                    }
                    _riContext = null;
                });

                AdMob.addListener('onRewardedInterstitialAdFailedToShow', (error) => {
                    if (window.AppLogger) AppLogger.warn('[AdMob] 보상형 전면 표시 실패: ' + JSON.stringify(error));
                    _rewardedInterstitialReady = false;
                    _riRewardEarned = false;
                    _riContext = null;
                    preloadRewardedInterstitial._retryCount = 0;
                    preloadRewardedInterstitial();
                });
            }

            // 배너 광고 이벤트 리스너
            AdMob.addListener('onBannerAdLoaded', () => {
                if (window.AppLogger) AppLogger.info('[AdMob] 배너 광고 로드 완료');
            });
            AdMob.addListener('onBannerAdFailedToLoad', (error) => {
                _bannerAdLoaded = false;
                _bannerAdVisible = false;
                if (window.AppLogger) AppLogger.warn('[AdMob] 배너 광고 로드 실패: ' + JSON.stringify(error));
            });

            preloadRewardedInterstitial();
        } catch (e) {
            console.warn('[AdMob] 초기화 실패:', e);
            if (window.AppLogger) AppLogger.warn('[AdMob] 초기화 실패: ' + (e.message || ''));
        }
    }

    // --- 보상형 광고 ---
    async function preloadRewarded() {
        if (!_admobInitialized) return;
        try {
            const { AdMob } = window.Capacitor.Plugins;
            if (!AdMob) return;
            await AdMob.prepareRewardVideoAd({
                adId: REWARDED_AD_UNIT_ID,
                isTesting: false,
                npa: !canShowPersonalizedAds(),
            });
        } catch (e) {
            _rewardedAdReady = false;
            console.warn('[AdMob] 보상형 광고 프리로드 실패:', e);
            if (window.AppLogger) AppLogger.warn('[AdMob] 프리로드 실패: ' + (e.message || ''));
            if (!preloadRewarded._retryCount) preloadRewarded._retryCount = 0;
            if (preloadRewarded._retryCount < 3) {
                preloadRewarded._retryCount++;
                setTimeout(() => preloadRewarded(), 30000);
            }
        }
    }

    /**
     * 범용 보상형 광고 표시
     * @param {Object} opts - { context, onSuccess, onFail }
     */
    async function showRewarded(opts) {
        opts = opts || {};
        if (!_isNative()) {
            if (opts.onSuccess) opts.onSuccess();
            return true;
        }
        if (!_admobInitialized) await init();

        const { AdMob } = window.Capacitor.Plugins;
        if (!AdMob) {
            if (opts.onFail) opts.onFail();
            return false;
        }

        if (!_rewardedAdReady) {
            try {
                await AdMob.prepareRewardVideoAd({
                    adId: REWARDED_AD_UNIT_ID,
                    isTesting: false,
                    npa: !canShowPersonalizedAds(),
                });
                _rewardedAdReady = true;
            } catch (e) {
                if (opts.onFail) opts.onFail();
                return false;
            }
        }

        _rewardedAdContext = opts.context || 'generic';
        _rewardEarned = false;
        _rewardedAdOnSuccess = opts.onSuccess || null;
        _rewardedAdOnFail = opts.onFail || null;

        try {
            await AdMob.showRewardVideoAd();
            return true;
        } catch (e) {
            console.warn('[AdMob] 보상형 광고 표시 실패:', e);
            _rewardedAdContext = 'bonusExp';
            _rewardedAdOnSuccess = null;
            _rewardedAdOnFail = null;
            _rewardedAdReady = false;
            preloadRewarded._retryCount = 0;
            preloadRewarded();
            if (opts.onFail) opts.onFail();
            return false;
        }
    }

    function isRewardedReady() { return _rewardedAdReady; }

    // --- 보상형 전면 광고 ---
    async function preloadRewardedInterstitial() {
        if (!_admobInitialized) return;
        try {
            const { AdMob } = window.Capacitor.Plugins;
            if (!AdMob) return;
            await AdMob.prepareRewardInterstitialAd({
                adId: REWARDED_INTERSTITIAL_AD_UNIT_ID,
                isTesting: false,
                npa: !canShowPersonalizedAds(),
            });
        } catch (e) {
            _rewardedInterstitialReady = false;
            console.warn('[AdMob] 보상형 전면 프리로드 실패:', e);
            if (window.AppLogger) AppLogger.warn('[AdMob] 보상형 전면 프리로드 실패: ' + (e.message || ''));
            if (!preloadRewardedInterstitial._retryCount) preloadRewardedInterstitial._retryCount = 0;
            if (preloadRewardedInterstitial._retryCount < 3) {
                preloadRewardedInterstitial._retryCount++;
                setTimeout(() => preloadRewardedInterstitial(), 30000);
            }
        }
    }

    async function showRewardedInterstitial(context) {
        if (!_rewardedInterstitialReady || !_admobInitialized) return false;
        try {
            const { AdMob } = window.Capacitor.Plugins;
            if (!AdMob) return false;
            _riContext = context;
            _riRewardEarned = false;
            await AdMob.showRewardInterstitialAd();
            return true;
        } catch (e) {
            console.warn('[AdMob] 보상형 전면 표시 실패:', e);
            _riContext = null;
            _rewardedInterstitialReady = false;
            preloadRewardedInterstitial._retryCount = 0;
            preloadRewardedInterstitial();
            return false;
        }
    }

    function isRewardedInterstitialReady() { return _rewardedInterstitialReady; }

    // --- 배너 광고 ---
    function _getBannerMargin() {
        const safeTop = parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)')) || 0;
        return 53 + safeTop;
    }

    async function showBanner() {
        if (!_admobInitialized || !_isNative()) return;
        try {
            const { AdMob } = window.Capacitor.Plugins;
            if (!AdMob) return;

            const bannerMargin = _getBannerMargin();
            if (_bannerAdLoaded) {
                await AdMob.resumeBanner();
            } else {
                await AdMob.showBanner({
                    adId: BANNER_AD_UNIT_ID,
                    adSize: 'ADAPTIVE_BANNER',
                    position: 'TOP_CENTER',
                    margin: bannerMargin,
                    isTesting: false,
                    npa: !canShowPersonalizedAds(),
                });
                _bannerAdLoaded = true;
            }
            _bannerAdVisible = true;
            var spacer = document.getElementById('library-banner-spacer');
            if (spacer) { spacer.classList.remove('d-none'); spacer.style.height = '60px'; }
            const mainEl = document.querySelector('main');
            if (mainEl) mainEl.style.paddingTop = `calc(${bannerMargin + 70}px + env(safe-area-inset-top))`;
            if (window.AppLogger) AppLogger.info('[AdMob] 배너 광고 표시');
        } catch (e) {
            console.warn('[AdMob] 배너 광고 표시 실패:', e);
            if (window.AppLogger) AppLogger.warn('[AdMob] 배너 표시 실패: ' + (e.message || ''));
        }
    }

    async function hideBanner() {
        if (!_bannerAdVisible || !_admobInitialized) return;
        try {
            const { AdMob } = window.Capacitor.Plugins;
            if (!AdMob) return;
            await AdMob.hideBanner();
            _bannerAdVisible = false;
            var spacer = document.getElementById('library-banner-spacer');
            if (spacer) { spacer.classList.add('d-none'); spacer.style.height = ''; }
            const mainEl = document.querySelector('main');
            if (mainEl) mainEl.style.paddingTop = '';
            if (window.AppLogger) AppLogger.info('[AdMob] 배너 광고 숨김');
        } catch (e) {
            console.warn('[AdMob] 배너 광고 숨김 실패:', e);
            if (window.AppLogger) AppLogger.warn('[AdMob] 배너 숨김 실패: ' + (e.message || ''));
        }
    }

    // --- RI 던전 카운터 ---
    function getRiDungeonCountToday() {
        const today = window.getTodayKST();
        return parseInt(localStorage.getItem('_ri_dungeon_' + today) || '0');
    }

    function incrementRiDungeonCount() {
        const today = window.getTodayKST();
        const key = '_ri_dungeon_' + today;
        localStorage.setItem(key, String(getRiDungeonCountToday() + 1));
    }

    // --- 보너스 EXP ---
    function _bonusExpKey() {
        const uid = _auth()?.currentUser ? _auth().currentUser.uid : '_anon';
        return `bonus_exp_date_${uid}`;
    }

    function canClaimBonusExp() {
        const today = window.getTodayKST();
        if (_bonusExpInProgress) return 'used';
        if (localStorage.getItem(_bonusExpKey()) === today) return 'used';
        return 'ready';
    }

    function startBonusExpTimer() {
        stopBonusExpTimer();
        const timerEl = document.getElementById('bonus-exp-timer');
        if (!timerEl) return;

        function tick() {
            const ms = window.getMsUntilNextKSTMidnight();
            const lang = _AppState().currentLang;
            timerEl.textContent = `${_i18n()[lang].bonus_exp_next} ${window.formatCountdown(ms)}`;
            timerEl.style.display = '';
            if (ms <= 1000) {
                stopBonusExpTimer();
                setTimeout(() => renderBonusExp(), 1100);
            }
        }
        tick();
        _bonusExpTimerInterval = setInterval(tick, 1000);
    }

    function stopBonusExpTimer() {
        if (_bonusExpTimerInterval) {
            clearInterval(_bonusExpTimerInterval);
            _bonusExpTimerInterval = null;
        }
    }

    function renderBonusExp() {
        const btn = document.getElementById('btn-bonus-exp');
        const btnTitle = document.getElementById('bonus-exp-btn-title');
        const statusText = document.getElementById('bonus-exp-status');
        const timerEl = document.getElementById('bonus-exp-timer');
        const iconEl = document.getElementById('bonus-exp-icon');
        if (!btn || !statusText) return;

        const lang = _AppState().currentLang;
        const status = canClaimBonusExp();

        if (status === 'used') {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.background = 'linear-gradient(135deg, #888, #666)';
            btn.style.borderColor = 'rgba(136,136,136,0.4)';
            btn.style.boxShadow = 'none';
            btn.style.cursor = 'default';
            if (btnTitle) btnTitle.textContent = _i18n()[lang].bonus_exp_used;
            statusText.textContent = _i18n()[lang].bonus_exp_next || '';
            statusText.style.color = 'rgba(255,255,255,0.5)';
            if (iconEl) iconEl.textContent = '✅';
            startBonusExpTimer();
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.background = 'linear-gradient(135deg, #FFD700, #FFA500)';
            btn.style.borderColor = 'rgba(255,215,0,0.6)';
            btn.style.boxShadow = '0 2px 12px rgba(255,215,0,0.25)';
            btn.style.cursor = 'pointer';
            if (btnTitle) btnTitle.textContent = _i18n()[lang].bonus_exp_btn;
            statusText.textContent = _i18n()[lang].bonus_exp_desc;
            statusText.style.color = 'rgba(26,26,46,0.7)';
            if (iconEl) iconEl.textContent = '🎬';
            stopBonusExpTimer();
            if (timerEl) timerEl.style.display = 'none';
        }
    }

    async function claimBonusExp() {
        if (canClaimBonusExp() !== 'ready') return;

        const lang = _AppState().currentLang;
        const btn = document.getElementById('btn-bonus-exp');

        _bonusExpInProgress = true;
        const btnTitle = document.getElementById('bonus-exp-btn-title');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
        if (btnTitle) { btnTitle.textContent = _i18n()[lang].bonus_exp_loading; }

        if (!_isNative()) {
            if (window.applyBonusExpReward) window.applyBonusExpReward();
            _bonusExpInProgress = false;
            return;
        }

        if (!_admobInitialized) {
            await init();
        }

        const { AdMob } = window.Capacitor.Plugins;
        if (!AdMob) {
            _bonusExpInProgress = false;
            alert(_i18n()[lang].bonus_exp_not_ready);
            renderBonusExp();
            return;
        }

        if (!_rewardedAdReady) {
            try {
                await AdMob.prepareRewardVideoAd({
                    adId: REWARDED_AD_UNIT_ID,
                    isTesting: false,
                    npa: !canShowPersonalizedAds(),
                });
                _rewardedAdReady = true;
            } catch (e) {
                _bonusExpInProgress = false;
                alert(_i18n()[lang].bonus_exp_not_ready);
                renderBonusExp();
                return;
            }
        }

        const today = window.getTodayKST();
        localStorage.setItem(_bonusExpKey(), today);

        _rewardEarned = false;

        try {
            await AdMob.showRewardVideoAd();
        } catch (e) {
            console.warn('[AdMob] 보상형 광고 표시 실패:', e);
            if (window.AppLogger) AppLogger.warn('[AdMob] 광고 표시 실패: ' + (e.message || ''));
            localStorage.removeItem(_bonusExpKey());
            _rewardedAdReady = false;
            _rewardEarned = false;
            _bonusExpInProgress = false;
            preloadRewarded._retryCount = 0;
            preloadRewarded();
            alert(_i18n()[lang].bonus_exp_fail);
            renderBonusExp();
        }
    }

    // --- 플래너 보상형 광고 ---
    function showPlannerRewardedAd(lang) {
        return new Promise(async (resolve) => {
            try {
                const { AdMob } = window.Capacitor.Plugins;
                if (!AdMob) { resolve(); return; }

                if (!_rewardedAdReady) {
                    try {
                        await AdMob.prepareRewardVideoAd({
                            adId: REWARDED_AD_UNIT_ID,
                            isTesting: false,
                            npa: !canShowPersonalizedAds(),
                        });
                        _rewardedAdReady = true;
                    } catch (e) {
                        console.warn('[PlannerAd] 광고 준비 실패:', e);
                        resolve();
                        return;
                    }
                }

                _rewardedAdContext = 'plannerView';
                _rewardEarned = false;
                _rewardedAdOnSuccess = function() {
                    if (window.AppLogger) AppLogger.info('[PlannerAd] 보상형 광고 시청 완료');
                    resolve();
                };
                _rewardedAdOnFail = function() {
                    if (window.AppLogger) AppLogger.info('[PlannerAd] 보상형 광고 이탈/실패');
                    resolve();
                };

                await AdMob.showRewardVideoAd();
            } catch (e) {
                console.warn('[PlannerAd] 광고 표시 실패:', e);
                _rewardedAdContext = 'bonusExp';
                _rewardedAdOnSuccess = null;
                _rewardedAdOnFail = null;
                _rewardedAdReady = false;
                preloadRewarded._retryCount = 0;
                preloadRewarded();
                resolve();
            }
        });
    }

    // --- D-Day 저장 보상형 광고 (1일 1회) ---
    function _ddayAdKey() {
        const uid = _auth()?.currentUser ? _auth().currentUser.uid : '_anon';
        return `dday_ad_date_${uid}`;
    }

    function hasDDayAdShownToday() {
        const today = window.getTodayKST();
        return localStorage.getItem(_ddayAdKey()) === today;
    }

    function markDDayAdShown() {
        const today = window.getTodayKST();
        localStorage.setItem(_ddayAdKey(), today);
    }

    /**
     * D-Day 저장 시 보상형 광고 표시 (1일 1회)
     * @param {Function} onSuccess - 광고 시청 완료 또는 이미 시청한 경우 콜백
     * @param {Function} onFail - 광고 실패/이탈 시 콜백
     */
    async function showDDayRewardedAd(onSuccess, onFail) {
        // 오늘 이미 시청했으면 바로 성공 콜백
        if (hasDDayAdShownToday()) {
            if (onSuccess) onSuccess();
            return;
        }

        // 네이티브가 아니면 마킹만 하고 통과
        if (!_isNative()) {
            markDDayAdShown();
            if (onSuccess) onSuccess();
            return;
        }

        // 광고 표시 전에 마킹 (보너스 EXP 패턴과 동일)
        markDDayAdShown();

        const result = await showRewarded({
            context: 'ddaySave',
            onSuccess: function() {
                if (window.AppLogger) AppLogger.info('[AdMob] D-Day 저장 보상형 광고 시청 완료');
                if (onSuccess) onSuccess();
            },
            onFail: function() {
                // 광고 이탈/실패 시 마킹 제거 → 다시 시청 가능
                localStorage.removeItem(_ddayAdKey());
                if (window.AppLogger) AppLogger.info('[AdMob] D-Day 저장 보상형 광고 이탈/실패');
                if (onFail) onFail();
            }
        });

        if (!result) {
            // 광고 로드 자체가 안 된 경우 마킹 제거
            localStorage.removeItem(_ddayAdKey());
            if (onFail) onFail();
        }
    }

    // --- 네이티브 광고 ---
    async function loadNativeAd(tabId) {
        if (!_isNative()) return;
        if (_nativeAdDisabled) return;

        const tabSection = document.getElementById(tabId);
        if (!tabSection || !tabSection.classList.contains('active')) return;

        if (!_admobInitialized) {
            await init();
        }

        const placeholderId = 'native-ad-placeholder-' + tabId;
        const placeholder = document.getElementById(placeholderId);
        if (!placeholder) return;

        if (!document.getElementById(tabId)?.classList.contains('active')) return;

        try {
            const NativeAd = _getNativeAdPlugin();
            if (!NativeAd) {
                _handleMissingNativeAdPlugin();
                placeholder.style.display = 'none';
                // NativeAd 플러그인이 없는 빌드에서는 배너로 폴백해 광고 공백을 최소화
                _nativeAdUsingBannerFallback = true;
                await showBanner().catch(() => {});
                return;
            }
            if (_nativeAdUsingBannerFallback) {
                _nativeAdUsingBannerFallback = false;
                await hideBanner().catch(() => {});
            }

            await NativeAd.destroyAd().catch(() => {});

            const result = await NativeAd.loadAd({
                adId: NATIVE_AD_UNIT_ID,
                isTesting: false,
                npa: !canShowPersonalizedAds(),
            });

            if (result && result.loaded) {
                if (!document.getElementById(tabId)?.classList.contains('active')) {
                    NativeAd.destroyAd().catch(() => {});
                    _nativeAdLoaded = false;
                    _nativeAdActiveTab = null;
                    return;
                }

                _nativeAdLoaded = true;
                _nativeAdActiveTab = tabId;
                if (window.AppLogger) AppLogger.info(`[NativeAd] ${tabId}탭 네이티브 광고 로드 완료`);

                positionNativeAd(tabId);
                setupNativeAdScrollSync(tabId);
            }
        } catch (e) {
            console.warn('[NativeAd] 로드 실패:', e);
            if (window.AppLogger) AppLogger.warn('[NativeAd] 로드 실패: ' + (e.message || ''));
            _nativeAdLoaded = false;
            _nativeAdActiveTab = null;
            placeholder.style.display = 'none';
        }
    }

    async function positionNativeAd(tabId) {
        const placeholderId = 'native-ad-placeholder-' + tabId;
        const placeholder = document.getElementById(placeholderId);
        if (!placeholder || !_nativeAdLoaded) return;

        if (!document.getElementById(tabId)?.classList.contains('active')) return;

        try {
            const NativeAd = _getNativeAdPlugin();
            if (!NativeAd) return;

            const rect = placeholder.getBoundingClientRect();

            let clipTop = 0;
            if (tabId === 'social') {
                const sh = document.querySelector('.social-sticky-header');
                if (sh) clipTop = sh.getBoundingClientRect().bottom;
            } else {
                const appHeader = document.querySelector('header');
                if (appHeader) clipTop = appHeader.getBoundingClientRect().bottom;
            }
            let clipBottom = 0;
            const navEl = document.querySelector('nav');
            if (navEl) clipBottom = navEl.getBoundingClientRect().top;
            await NativeAd.showAd({
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
                clipTop,
                clipBottom,
            });
            _nativeAdVisible = true;
        } catch (e) {
            console.warn('[NativeAd] 표시 실패:', e);
        }
    }

    function setupNativeAdScrollSync(tabId) {
        cleanupNativeAdScrollSync();

        const mainEl = document.querySelector('main');
        const placeholderId = 'native-ad-placeholder-' + tabId;
        const placeholder = document.getElementById(placeholderId);
        if (!mainEl || !placeholder) return;

        _nativeAdObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (!_nativeAdLoaded) return;

            const NativeAd = _getNativeAdPlugin();
            if (!NativeAd) return;

            if (entry.isIntersecting) {
                if (!_nativeAdVisible && !_adsHiddenForModal) {
                    NativeAd.resumeAd().catch(() => {});
                    _nativeAdVisible = true;
                }
            } else {
                if (_nativeAdVisible) {
                    NativeAd.hideAd().catch(() => {});
                    _nativeAdVisible = false;
                }
            }
        }, { threshold: 0.1 });
        _nativeAdObserver.observe(placeholder);

        const clipRef = tabId === 'social'
            ? document.querySelector('.social-sticky-header')
            : document.querySelector('header');
        const navRef = document.querySelector('nav');

        function onScroll() {
            if (_nativeAdScrollRAF) return;
            _nativeAdScrollRAF = requestAnimationFrame(() => {
                _nativeAdScrollRAF = null;
                if (!_nativeAdLoaded || !_nativeAdVisible || _adsHiddenForModal) return;

                const rect = placeholder.getBoundingClientRect();
                const clipTop = clipRef ? clipRef.getBoundingClientRect().bottom : 0;
                const clipBottom = navRef ? navRef.getBoundingClientRect().top : 0;
                const NativeAd = _getNativeAdPlugin();
                if (NativeAd) {
                    NativeAd.updatePosition({ y: rect.top, clipTop, clipBottom }).catch(() => {});
                }
            });
        }

        mainEl.addEventListener('scroll', onScroll, { passive: true });
        mainEl._nativeAdScrollHandler = onScroll;
    }

    function cleanupNativeAdScrollSync() {
        if (_nativeAdObserver) {
            _nativeAdObserver.disconnect();
            _nativeAdObserver = null;
        }

        if (_nativeAdScrollRAF) {
            cancelAnimationFrame(_nativeAdScrollRAF);
            _nativeAdScrollRAF = null;
        }

        const mainEl = document.querySelector('main');
        if (mainEl && mainEl._nativeAdScrollHandler) {
            mainEl.removeEventListener('scroll', mainEl._nativeAdScrollHandler);
            delete mainEl._nativeAdScrollHandler;
        }
    }

    async function cleanupNativeAd() {
        cleanupNativeAdScrollSync();
        _nativeAdLoaded = false;
        _nativeAdVisible = false;
        _nativeAdActiveTab = null;

        if (_nativeAdUsingBannerFallback) {
            _nativeAdUsingBannerFallback = false;
            await hideBanner().catch(() => {});
        }

        if (!_isNative()) return;

        try {
            const NativeAd = _getNativeAdPlugin();
            if (NativeAd) {
                await NativeAd.destroyAd();
            }
        } catch (e) {
            // 무시 — 이미 파괴되었을 수 있음
        }
    }

    // --- 모달 오버레이 시 모든 광고 숨김/복원 ---
    async function hideForModal() {
        _adsHiddenForModal = true;
        if (!_isNative()) return;

        // 네이티브 광고 숨김
        if (_nativeAdActiveTab) {
            try {
                const NativeAd = _getNativeAdPlugin();
                if (NativeAd) await NativeAd.hideAd().catch(() => {});
            } catch (e) { /* 무시 */ }
        }

        // 배너 광고 숨김
        if (_bannerAdVisible) {
            try {
                const { AdMob } = window.Capacitor.Plugins;
                if (AdMob) await AdMob.hideBanner().catch(() => {});
            } catch (e) { /* 무시 */ }
        }
    }

    async function resumeFromModal() {
        _adsHiddenForModal = false;
        if (!_isNative()) return;

        // 네이티브 광고 복원
        if (_nativeAdActiveTab && _nativeAdLoaded) {
            try {
                const NativeAd = _getNativeAdPlugin();
                if (NativeAd) {
                    await NativeAd.resumeAd().catch(() => {});
                    _nativeAdVisible = true;
                    positionNativeAd(_nativeAdActiveTab);
                }
            } catch (e) { /* 무시 */ }
        }

        // 배너 광고 복원
        if (_bannerAdLoaded) {
            try {
                const { AdMob } = window.Capacitor.Plugins;
                if (AdMob) {
                    await AdMob.resumeBanner().catch(() => {});
                    _bannerAdVisible = true;
                }
            } catch (e) { /* 무시 */ }
        }
    }

    // --- 공개 API ---
    window.AdManager = {
        init,
        canShowPersonalizedAds,
        resetConsent,
        // 보상형
        preloadRewarded,
        showRewarded,
        isRewardedReady,
        // 보상형 전면
        preloadRewardedInterstitial,
        showRewardedInterstitial,
        isRewardedInterstitialReady,
        // 배너
        showBanner,
        hideBanner,
        // 모달 오버레이 시 광고 일괄 숨김/복원
        hideForModal,
        resumeFromModal,
        // 네이티브
        loadNativeAd,
        cleanupNativeAd,
        NATIVE_AD_POSITION,
        REELS_NATIVE_AD_POSITION,
        // 보너스 EXP
        renderBonusExp,
        canClaimBonusExp,
        claimBonusExp,
        // RI 던전 카운터
        getRiDungeonCountToday,
        incrementRiDungeonCount,
        RI_DUNGEON_DAILY_MAX,
        // 플래너 보상형
        showPlannerRewardedAd,
        // D-Day 저장 보상형
        showDDayRewardedAd,
        hasDDayAdShownToday,
        // 내부 상태 접근 (app.js 호환)
        get nativeAdActiveTab() { return _nativeAdActiveTab; },
    };

    // HTML onclick 호환
    window.claimBonusExp = claimBonusExp;

})();
