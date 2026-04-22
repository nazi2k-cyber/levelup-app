export const DEFAULT_NAV_ORDER = ['status', 'quests', 'dungeon', 'diary', 'reels', 'social', 'settings'];

let navDragJustEnded = false;

export function wasNavDragJustEnded() {
    return navDragJustEnded;
}

export function loadNavOrder() {
    const saved = localStorage.getItem('navTabOrder');
    if (!saved) return;

    try {
        const order = JSON.parse(saved);
        const nav = document.querySelector('nav');
        if (!nav) return;

        order.forEach((tabId) => {
            const item = nav.querySelector(`[data-tab="${tabId}"]`);
            if (item) nav.appendChild(item);
        });
    } catch (e) {
        // ignore
    }
}

export function saveNavOrder() {
    const order = Array.from(document.querySelectorAll('.nav-item')).map((el) => el.dataset.tab);
    localStorage.setItem('navTabOrder', JSON.stringify(order));
}

export function initNavDragReorder() {
    const nav = document.querySelector('nav');
    if (!nav) return;

    let dragItem = null;
    let longPressTimer = null;
    let isDragging = false;
    let wasMoved = false;

    function onTouchStart(e) {
        const item = e.currentTarget;
        longPressTimer = setTimeout(() => {
            isDragging = true;
            wasMoved = false;
            dragItem = item;
            item.classList.add('nav-dragging');
            nav.classList.add('nav-reorder-mode');
            if (navigator.vibrate) navigator.vibrate(50);
        }, 500);
    }

    function onTouchMove(e) {
        if (!isDragging || !dragItem) return;

        e.preventDefault();
        wasMoved = true;

        const touch = e.touches[0];
        const navRect = nav.getBoundingClientRect();
        const touchX = touch.clientX - navRect.left;
        const items = Array.from(nav.querySelectorAll('.nav-item'));
        const itemWidth = navRect.width / items.length;
        const targetIndex = Math.max(0, Math.min(items.length - 1, Math.floor(touchX / itemWidth)));
        const currentIndex = items.indexOf(dragItem);

        if (targetIndex !== currentIndex) {
            if (targetIndex > currentIndex) {
                nav.insertBefore(dragItem, items[targetIndex].nextSibling);
            } else {
                nav.insertBefore(dragItem, items[targetIndex]);
            }
        }
    }

    function onTouchEnd() {
        clearTimeout(longPressTimer);

        if (isDragging && dragItem) {
            dragItem.classList.remove('nav-dragging');
            nav.classList.remove('nav-reorder-mode');

            if (wasMoved) {
                saveNavOrder();
                navDragJustEnded = true;
                setTimeout(() => {
                    navDragJustEnded = false;
                }, 300);
            }
        }

        isDragging = false;
        dragItem = null;
    }

    document.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('touchstart', onTouchStart, { passive: true });
        item.addEventListener('touchmove', onTouchMove, { passive: false });
        item.addEventListener('touchend', onTouchEnd);
        item.addEventListener('touchcancel', onTouchEnd);
    });
}
