// src/charBrowser/cardMenu.js
// Character Browser — per-character right-click context menu. A small floating
// menu opened from a card's contextmenu event, offering the SAME actions as the
// multi-select bulk bar but scoped to ONE character: Tag · Duplicate · Persona
// (convert to a user persona) · Delete. NOT Favorite — the card's star already
// owns that toggle (user's call).
//
// REUSE: the actions route straight back through bulkActions.js with a
// single-element avatar array ([model.avatar]) — the bulk functions already
// take an avatar LIST, so a one-char "bulk" is just a list of one. That's why
// the tag popup works for a single character too (ST's popup handles 1..N).
//
// This module owns ONLY the menu DOM (#wl-cb-cardmenu) + its dismissal
// lifecycle. It knows nothing about the grid or the ST pipeline; the shell
// injects an onAction(action, model) callback that dispatches to bulkActions
// and refreshes. One menu at a time — opening a second closes the first.

const log = () => {};

const MENU_ID = 'wl-cb-cardmenu';

// The menu items, in order. `action` is the id handed back to the shell;
// `disabled` greys it out. Favorite is intentionally absent (the card star owns it).
const ITEMS = [
    { action: 'tag',       label: 'Tag',       icon: 'fa-solid fa-tag' },
    { action: 'duplicate', label: 'Duplicate', icon: 'fa-solid fa-clone' },
    { action: 'persona',   label: 'Persona',   icon: 'fa-solid fa-user' },
    { action: 'delete',    label: 'Delete',    icon: 'fa-solid fa-trash', danger: true },
];

// Live dismissal handlers, tracked so close() detaches exactly what open()
// attached (no leaks if the menu is opened/closed rapidly).
let menuEl = null;
let dismissHandlers = null;

/**
 * Open the card context menu at (x, y) for `model`. `onAction(action, model)`
 * is called when a live item is chosen (the menu closes first). Any currently
 * open menu is closed before this one opens.
 *
 * @param {object} model   the character view-model (needs avatar + name)
 * @param {number} x        clientX (cursor)
 * @param {number} y        clientY (cursor)
 * @param {(action:string, model:object)=>void} onAction
 */
export function openCardMenu(model, x, y, onAction) {
    if (!model) return;
    closeCardMenu(); // singleton

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'wl-cb-cardmenu';
    menu.setAttribute('role', 'menu');

    // Header: which character these actions apply to (name, truncated by CSS).
    const head = document.createElement('div');
    head.className = 'wl-cb-cardmenu-head';
    head.textContent = model.name || '(unnamed)';
    head.title = model.name || '';
    menu.appendChild(head);

    for (const item of ITEMS) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'wl-cb-cardmenu-item'
            + (item.danger ? ' wl-cb-cardmenu-danger' : '');
        row.setAttribute('role', 'menuitem');
        if (item.disabled) {
            row.disabled = true;
            if (item.hint) row.title = item.hint;
        }
        const ic = document.createElement('i');
        ic.className = item.icon;
        row.appendChild(ic);
        const lbl = document.createElement('span');
        lbl.textContent = item.label;
        row.appendChild(lbl);

        if (!item.disabled) {
            row.addEventListener('click', () => {
                closeCardMenu();
                try { onAction?.(item.action, model); }
                catch (err) { console.error('[BD] Char Browser: card-menu action failed.', err); }
            });
        }
        menu.appendChild(row);
    }

    // Off-screen first so we can measure, then clamp into the viewport (same
    // idea as ST's CharacterContextMenu.show).
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);
    menuEl = menu;
    positionMenu(menu, x, y);
    menu.style.visibility = '';

    attachDismiss();
}

/** Clamp the menu inside the viewport, anchored at the cursor. Flips left/up
 *  when it would overflow the right/bottom edges. */
function positionMenu(menu, x, y) {
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw) left = Math.max(4, x - rect.width);
    if (top + rect.height > vh) top = Math.max(4, y - rect.height);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

/** Close the menu (if open) and detach its dismissal listeners. Safe anytime. */
export function closeCardMenu() {
    if (dismissHandlers) {
        const { onDown, onKey, onScroll } = dismissHandlers;
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll, true);
        dismissHandlers = null;
    }
    if (menuEl) {
        menuEl.remove();
        menuEl = null;
    }
}

/** Wire outside-click / Esc / scroll-away dismissal. Capture phase so a click
 *  that lands outside the menu closes it before other handlers run. A click
 *  INSIDE the menu is ignored here (the item's own handler closes it). */
function attachDismiss() {
    const onDown = (e) => {
        if (menuEl && !menuEl.contains(e.target)) closeCardMenu();
    };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeCardMenu(); }
    };
    // Any scroll or resize closes the menu (its anchor point is now stale).
    const onScroll = () => closeCardMenu();

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);
    dismissHandlers = { onDown, onKey, onScroll };
}

/** Whether the card menu is currently open (shell may guard on this). */
export function isCardMenuOpen() {
    return !!menuEl;
}
