// src/worldInfoDrawerV2/bookMenu.js
// WI v2 rail — per-lorebook right-click context menu. A small floating menu
// opened from a book row's contextmenu event (in EITHER rail section — "Read
// for this chat" and "All lorebooks"), offering the book-level actions:
// Rename · Duplicate · Export · Delete. Import/New are library-wide, so they
// live in the topbar toolbar, not here (there's no single book to hang them on).
//
// This is a direct twin of charBrowser/cardMenu.js — same singleton menu +
// dismissal lifecycle (outside-click / Esc / scroll-away), same viewport
// clamp. It owns ONLY the menu DOM (#wl-wi2-bookmenu) and its teardown; it
// knows nothing about the rail or ST. The rail injects an onAction(action,
// bookName) callback that routes to bookActions.js. One menu at a time —
// opening a second closes the first.
//
// Lives on <body> (cursor-anchored), so its CSS uses global SmartTheme* vars
// and a z-index above the v2 overlay (10000); see .wl-wi2-bookmenu in
// worldInfoDrawerV2.css.

const MENU_ID = 'wl-wi2-bookmenu';

// Menu items, in order. `action` is the id handed back to the rail; `danger`
// paints Delete red to flag destructiveness (same as the card menu).
const ITEMS = [
    { action: 'rename',    label: 'Rename',    icon: 'fa-solid fa-pen' },
    { action: 'duplicate', label: 'Duplicate', icon: 'fa-solid fa-clone' },
    { action: 'export',    label: 'Export',    icon: 'fa-solid fa-file-export' },
    { action: 'delete',    label: 'Delete',    icon: 'fa-solid fa-trash', danger: true },
];

let menuEl = null;
let dismissHandlers = null;

/**
 * Open the book context menu at (x, y) for `bookName`. `onAction(action,
 * bookName)` is called when a live item is chosen (the menu closes first).
 * Any currently open menu is closed before this one opens.
 *
 * @param {string} bookName  the lorebook the actions apply to
 * @param {number} x         clientX (cursor)
 * @param {number} y         clientY (cursor)
 * @param {(action:string, bookName:string)=>void} onAction
 */
export function openBookMenu(bookName, x, y, onAction) {
    if (!bookName) return;
    closeBookMenu(); // singleton

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'wl-wi2-bookmenu';
    menu.setAttribute('role', 'menu');

    // Header: which lorebook these actions apply to (truncated by CSS).
    const head = document.createElement('div');
    head.className = 'wl-wi2-bookmenu-head';
    head.textContent = bookName;
    head.title = bookName;
    menu.appendChild(head);

    for (const item of ITEMS) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'wl-wi2-bookmenu-item'
            + (item.danger ? ' wl-wi2-bookmenu-danger' : '');
        row.setAttribute('role', 'menuitem');

        const ic = document.createElement('i');
        ic.className = item.icon;
        row.appendChild(ic);
        const lbl = document.createElement('span');
        lbl.textContent = item.label;
        row.appendChild(lbl);

        row.addEventListener('click', () => {
            closeBookMenu();
            try { onAction?.(item.action, bookName); }
            catch (err) { console.error('[BD] WI v2: book-menu action failed.', err); }
        });
        menu.appendChild(row);
    }

    // Off-screen first so we can measure, then clamp into the viewport.
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);
    menuEl = menu;
    positionMenu(menu, x, y);
    menu.style.visibility = '';

    attachDismiss();
}

/** Clamp the menu inside the viewport, anchored at the cursor. Flips left/up
 *  when it would overflow the right/bottom edges (ST's own menu idea). */
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
export function closeBookMenu() {
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
 *  outside the menu closes it before other handlers run. A click INSIDE is
 *  ignored here (the item's own handler closes it). */
function attachDismiss() {
    const onDown = (e) => {
        if (menuEl && !menuEl.contains(e.target)) closeBookMenu();
    };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeBookMenu(); }
    };
    // Any scroll or resize closes the menu (its anchor point is now stale).
    const onScroll = () => closeBookMenu();

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);
    dismissHandlers = { onDown, onKey, onScroll };
}
