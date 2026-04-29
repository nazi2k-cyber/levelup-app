export function createPermissionGuideModule({ getCurrentLang, i18n }) {
    const OVERLAY_ID = 'perm-guide-overlay';

    const TYPE_CONFIG = {
        push:   { gradientStart: '#7C8CF8', gradientEnd: '#B78CFF', iconSvg: pushSvg() },
        health: { gradientStart: '#6DD5B4', gradientEnd: '#45B7D1', iconSvg: healthSvg() },
        gps:    { gradientStart: '#FF7EB3', gradientEnd: '#FF5F6D', iconSvg: gpsSvg() },
    };

    function getLang() {
        const lang = typeof getCurrentLang === 'function' ? getCurrentLang() : 'ko';
        return i18n[lang] || i18n.ko || {};
    }

    function show(type) {
        return new Promise((resolve) => {
            const overlay = document.getElementById(OVERLAY_ID);
            if (!overlay) { resolve(true); return; }

            const t = getLang();
            const cfg = TYPE_CONFIG[type];

            const iconWrap = overlay.querySelector('.pg-icon-wrap');
            if (iconWrap && cfg) {
                iconWrap.innerHTML = cfg.iconSvg;
                iconWrap.style.background = `linear-gradient(135deg, ${cfg.gradientStart}22, ${cfg.gradientEnd}22)`;
                iconWrap.style.borderColor = `${cfg.gradientStart}44`;
            }

            setText(overlay, '.pg-title', t[`pg_title_${type}`]);
            setHtml(overlay, '.pg-desc', t[`pg_desc_${type}`]);
            setText(overlay, '.pg-feature-label', t.pg_feature_label);
            setText(overlay, '.pg-feature-icon', t[`pg_ficon_${type}`]);
            setText(overlay, '.pg-feature-name', t[`pg_fname_${type}`]);
            setText(overlay, '.pg-feature-desc', t[`pg_fdesc_${type}`]);
            setText(overlay, '.pg-allow-btn', t.pg_allow_btn || '허용하기');
            setText(overlay, '.pg-skip-btn', t.pg_skip_btn || '나중에');

            const allowBtn = overlay.querySelector('.pg-allow-btn');
            if (allowBtn && cfg) {
                allowBtn.style.background = `linear-gradient(135deg, ${cfg.gradientStart}, ${cfg.gradientEnd})`;
                allowBtn.style.boxShadow = `0 4px 20px ${cfg.gradientStart}44`;
            }

            overlay.classList.remove('d-none');
            requestAnimationFrame(() => overlay.classList.add('pg-visible'));

            const skipBtn = overlay.querySelector('.pg-skip-btn');

            function detach() {
                allowBtn?.removeEventListener('click', onAllow);
                skipBtn?.removeEventListener('click', onSkip);
            }

            // resolve는 오버레이가 완전히 사라진 뒤 호출 — 다음 show()와 타이머 충돌 방지
            function hide(result) {
                detach();
                overlay.classList.remove('pg-visible');
                setTimeout(() => { overlay.classList.add('d-none'); resolve(result); }, 320);
            }

            function onAllow() { hide(true); }
            function onSkip()  { hide(false); }

            allowBtn?.addEventListener('click', onAllow);
            skipBtn?.addEventListener('click', onSkip);
        });
    }

    function setText(root, selector, value) {
        const el = root.querySelector(selector);
        if (el && value != null) el.textContent = value;
    }

    function setHtml(root, selector, value) {
        const el = root.querySelector(selector);
        if (el && value != null) el.innerHTML = value;
    }

    return { show };
}

function pushSvg() {
    return `<svg width="52" height="52" viewBox="0 0 52 52" fill="none">
        <defs><linearGradient id="pgG1" x1="0" y1="0" x2="52" y2="52">
            <stop stop-color="#7C8CF8"/><stop offset="1" stop-color="#B78CFF"/>
        </linearGradient></defs>
        <path d="M26 7C18.3 7 12 13.3 12 21v12l-3 4.5h34L40 33V21C40 13.3 33.7 7 26 7z" fill="url(#pgG1)" opacity="0.9"/>
        <path d="M21 42.5c0 2.8 2.2 5 5 5s5-2.2 5-5" stroke="url(#pgG1)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <circle cx="37" cy="13" r="5.5" fill="#FF5F6D"/>
    </svg>`;
}

function healthSvg() {
    return `<svg width="52" height="52" viewBox="0 0 52 52" fill="none">
        <defs><linearGradient id="pgG2" x1="0" y1="0" x2="52" y2="52">
            <stop stop-color="#6DD5B4"/><stop offset="1" stop-color="#45B7D1"/>
        </linearGradient></defs>
        <path d="M8 28l5-14 5 8 4-12 4 8 5-6 5 10 4-4" stroke="url(#pgG2)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <ellipse cx="26" cy="40" rx="12" ry="3.5" fill="url(#pgG2)" opacity="0.2"/>
        <path d="M20 38c0-6 6-10 6-10s6 4 6 10" fill="url(#pgG2)" opacity="0.7"/>
        <circle cx="26" cy="34" r="3" fill="url(#pgG2)"/>
    </svg>`;
}

function gpsSvg() {
    return `<svg width="52" height="52" viewBox="0 0 52 52" fill="none">
        <defs><linearGradient id="pgG3" x1="0" y1="0" x2="52" y2="52">
            <stop stop-color="#FF7EB3"/><stop offset="1" stop-color="#FF5F6D"/>
        </linearGradient></defs>
        <path d="M26 5C17.2 5 10 12.2 10 21c0 11.8 16 27 16 27s16-15.2 16-27C42 12.2 34.8 5 26 5z" fill="url(#pgG3)" opacity="0.9"/>
        <circle cx="26" cy="21" r="6" fill="white" opacity="0.9"/>
        <circle cx="26" cy="21" r="3" fill="url(#pgG3)"/>
    </svg>`;
}
