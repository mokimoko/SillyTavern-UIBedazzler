// src/charBrowser/uiFeedback.js
// Tiny shared "busy" affordance for the char browser's action controls.
//
// WHY: opening a chat or the edit drawer runs ST's character-selection +
// chat-load pipeline, which on a slow machine takes a visible beat. Without
// feedback a click feels dead and invites a confused re-click. This shows an
// immediate spinner (and disables the control) the moment it's clicked, until
// the async action settles — by which point the SUCCESS path has usually torn
// the whole browser down anyway. If the action leaves the browser open (e.g. a
// failure), we restore the control so the user can retry.
//
// Used by detail.js (Open Chat / Edit buttons) and tagHub.js (Top Character
// rows). Buttons swap their label for a spinner; non-button rows get a spinner
// appended (their content is preserved).

/**
 * Toggle a "busy" spinner state on a control (a <button> or a clickable row).
 *
 * On:  guards against re-entry via a data flag, sets aria-busy + a .wl-cb-busy
 *      class, disables the element if it can be disabled, and shows a spinner —
 *      buttons cache+replace their innerHTML; other elements get an appended
 *      spinner span so their existing content survives.
 * Off: reverses all of the above. Safe to call on an element that's already
 *      idle (no-op).
 */
export function setControlBusy(el, on) {
    if (!el) return;
    if (on) {
        if (el.dataset.wlBusy === '1') return; // already busy — don't double-apply
        el.dataset.wlBusy = '1';
        el.setAttribute('aria-busy', 'true');
        el.classList.add('wl-cb-busy');
        if ('disabled' in el) el.disabled = true;
        if (el.tagName === 'BUTTON') {
            el.dataset.wlBusyHtml = el.innerHTML;
            el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        } else {
            const spin = document.createElement('span');
            spin.className = 'wl-cb-busy-spin';
            spin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            el.appendChild(spin);
        }
    } else {
        if (el.dataset.wlBusy !== '1') return;
        delete el.dataset.wlBusy;
        el.removeAttribute('aria-busy');
        el.classList.remove('wl-cb-busy');
        if ('disabled' in el) el.disabled = false;
        if (el.tagName === 'BUTTON') {
            if (el.dataset.wlBusyHtml != null) {
                el.innerHTML = el.dataset.wlBusyHtml;
                delete el.dataset.wlBusyHtml;
            }
        } else {
            el.querySelector(':scope > .wl-cb-busy-spin')?.remove();
        }
    }
}

/**
 * Run an async action with a busy state on `el`: set busy, await fn(), then
 * clear busy once it settles — but only if the element is still in the DOM (the
 * common success path tears the browser down, so the element is gone and there's
 * nothing to restore). Never throws: fn's own error handling stands; this only
 * guarantees the affordance resolves. Returns fn()'s resolved value.
 */
export async function withControlBusy(el, fn) {
    setControlBusy(el, true);
    try {
        return await fn();
    } finally {
        if (el && el.isConnected) setControlBusy(el, false);
    }
}
