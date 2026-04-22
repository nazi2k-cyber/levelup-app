export function createOnboardingModule({ AppState, changeLanguage, showPermissionPrompts, ConversionTracker }) {
    const ONBOARDING_STORAGE_KEY = 'levelup_onboarding_seen';
    const ONBOARDING_TOTAL_SLIDES = 7;
    let currentSlide = 0;
    let isBound = false;

    function buildDots() {
        const dotsEl = document.getElementById('ob-dots');
        if (!dotsEl) return;
        dotsEl.innerHTML = '';
        for (let i = 0; i < ONBOARDING_TOTAL_SLIDES; i++) {
            const dot = document.createElement('span');
            dot.className = 'ob-dot' + (i === 0 ? ' active' : '');
            dotsEl.appendChild(dot);
        }
    }

    function render() {
        const slides = document.querySelectorAll('#onboarding-slides .onboarding-slide');
        slides.forEach((slide, i) => {
            const offset = (i - currentSlide) * 100;
            slide.style.transform = `translateX(${offset}%)`;
            if (Math.abs(i - currentSlide) <= 1) slide.classList.add('active');
            else slide.classList.remove('active');

            if (i === currentSlide) {
                slide.classList.remove('ob-animate');
                void slide.offsetWidth;
                slide.classList.add('ob-animate');
            } else {
                slide.classList.remove('ob-animate');
            }
        });

        const dots = document.querySelectorAll('#ob-dots .ob-dot');
        dots.forEach((dot, i) => dot.classList.toggle('active', i === currentSlide));

        const prevBtn = document.getElementById('onboarding-prev');
        const nextBtn = document.getElementById('onboarding-next');
        if (prevBtn) prevBtn.disabled = currentSlide === 0;
        if (nextBtn) nextBtn.disabled = currentSlide === ONBOARDING_TOTAL_SLIDES - 1;
    }

    function dismiss() {
        const guide = document.getElementById('onboarding-guide');
        if (guide) guide.classList.add('d-none');
        localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
        if (window._pendingPermissionPrompts) {
            window._pendingPermissionPrompts = false;
            setTimeout(() => showPermissionPrompts(), 300);
        }
        ConversionTracker.track('onboarding_dismissed');
    }

    function show() {
        if (localStorage.getItem(ONBOARDING_STORAGE_KEY)) return;
        const guide = document.getElementById('onboarding-guide');
        if (!guide) return;

        guide.classList.remove('d-none');
        currentSlide = 0;
        if (typeof changeLanguage === 'function') changeLanguage(AppState.currentLang);
        buildDots();

        requestAnimationFrame(() => {
            render();
            const firstSlide = guide.querySelector('.onboarding-slide[data-slide="0"]');
            if (firstSlide) firstSlide.classList.add('ob-animate');
        });

        bindWindowHandlers();
        ConversionTracker.track('onboarding_shown');
    }

    function bindWindowHandlers() {
        if (isBound) return;
        isBound = true;

        const closeBtn = document.getElementById('onboarding-close');
        const prevBtn = document.getElementById('onboarding-prev');
        const nextBtn = document.getElementById('onboarding-next');
        const startBtn = document.getElementById('onboarding-start-btn');
        const slidesContainer = document.getElementById('onboarding-slides');

        if (closeBtn) closeBtn.addEventListener('click', dismiss);
        if (startBtn) startBtn.addEventListener('click', dismiss);

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (currentSlide > 0) {
                    currentSlide--;
                    render();
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                if (currentSlide < ONBOARDING_TOTAL_SLIDES - 1) {
                    currentSlide++;
                    render();
                }
            });
        }

        let touchStartX = 0;
        let touchEndX = 0;
        if (slidesContainer) {
            slidesContainer.addEventListener('touchstart', (e) => {
                touchStartX = e.changedTouches[0].screenX;
            }, { passive: true });

            slidesContainer.addEventListener('touchend', (e) => {
                touchEndX = e.changedTouches[0].screenX;
                const diff = touchStartX - touchEndX;
                if (Math.abs(diff) > 50) {
                    if (diff > 0 && currentSlide < ONBOARDING_TOTAL_SLIDES - 1) {
                        currentSlide++;
                        render();
                    } else if (diff < 0 && currentSlide > 0) {
                        currentSlide--;
                        render();
                    }
                }
            }, { passive: true });
        }
    }

    function getStorageKey() {
        return ONBOARDING_STORAGE_KEY;
    }

    return { init: bindWindowHandlers, bindWindowHandlers, render, show, dismiss, getStorageKey };
}
