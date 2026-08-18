// src/presetDrawerExpanded/editorDock.js
// Phase 4 — dock ST's NATIVE prompt-edit form into the right column.
//
// Rather than rebuild the editor (and re-implement ST's validation / token
// recount / save events), we relocate ST's own edit popup into the column. The
// native rows still drive it: clicking a prompt's edit opens ST's editor, which
// now appears docked on the right. Save/Close are the native controls, so the
// save path — and the group re-parse that follows — stay correct for free.
//
// IMPORTANT: we do NOT use a MutationObserver here. An earlier version observed
// document.body (subtree + attributes) and re-docked in the callback, which fed
// back into itself and the group-render observer and froze the app. Instead we
// re-dock on a debounced rAF after user CLICKS (opening / saving / closing the
// editor are all clicks) — targeted, no mutation storm.

import { activateRightTab } from './drawerUI.js';

const DOCK_CLASS = 'wl-pe-docked-editor';

// The clickables in the center column that OPEN a block's editor: the pencil,
// the inspect action, or the prompt name link. Clicking any of these should
// surface the Edit tab so the docked form is visible even when the user was on
// Test/Regex. (Toggle / detach / row background are deliberately excluded.)
const OPEN_EDITOR_SELECTOR = [
    '.prompt-manager-edit-action',
    '.prompt-manager-inspect-action',
    '.completion_prompt_manager_prompt_name a',
].join(', ');

let rightRef = null;
let clickHandler = null;
let rafPending = false;
let original = null; // { parent, nextSibling }

function findPopup() {
    const byId = document.getElementById('completion_prompt_manager_popup');
    if (byId) return byId;
    const field = document.getElementById('completion_prompt_manager_popup_entry_form_name')
        || document.querySelector('[id^="completion_prompt_manager_popup_entry_form"]');
    if (field) {
        return field.closest('dialog, .popup, [id*="completion_prompt_manager_popup"]')
            || field.closest('.range-block');
    }
    return null;
}

function isVisible(el) {
    // ST uses an inline display:none while the editor is closed. Check that
    // source state first because our dock CSS intentionally overrides display
    // while the editor is open.
    if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true' || el.style.display === 'none') {
        return false;
    }
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
}

function dock(rightEl) {
    const popup = findPopup();
    if (!popup) return false;
    if (popup.parentElement !== rightEl) {
        if (!original) original = { parent: popup.parentElement, nextSibling: popup.nextSibling };
        popup.classList.add(DOCK_CLASS);
        rightEl.appendChild(popup);
    }
    rightEl.classList.toggle('wl-pe-editing', isVisible(popup));
    return true;
}

function scheduleDock() {
    if (rafPending || !rightRef) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; dock(rightRef); });
}

export function startEditorDock(rightEl) {
    if (!rightEl) return;
    rightRef = rightEl;
    dock(rightEl); // dock now if the form already exists; otherwise on first edit-click

    // Only actions that can open or close the editor need a visibility sync.
    // Re-measuring after ordinary form-control clicks can dismiss a native
    // select menu before the user has a chance to choose an option.
    clickHandler = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        // Opening a block's editor from the center column surfaces the Edit tab,
        // so the docked form isn't hidden behind the Test/Regex view.
        if (target?.closest(OPEN_EDITOR_SELECTOR)) activateRightTab('edit');
        if (!target?.closest([
            '.completion_prompt_manager_prompt',
            '.prompt-manager-edit-action',
            '.prompt-manager-inspect-action',
            '#completion_prompt_manager_popup_entry_form_close',
            '#completion_prompt_manager_popup_entry_form_reset',
            '#completion_prompt_manager_popup_entry_form_save',
            '#completion_prompt_manager_popup_close_button',
        ].join(', '))) return;
        scheduleDock();
    };
    document.addEventListener('click', clickHandler, true);
}

export function stopEditorDock(rightEl) {
    if (clickHandler) { document.removeEventListener('click', clickHandler, true); clickHandler = null; }
    rightRef = null;
    rafPending = false;
    const popup = findPopup();
    // Let ST's own display state win before deciding whether Close is needed.
    rightEl?.classList.remove('wl-pe-editing');
    if (popup) {
        // If the native editor is open, close it through ST's own Close button
        // so it doesn't linger visible in the regular drawer after we leave.
        if (isVisible(popup)) {
            const closeBtn = document.getElementById('completion_prompt_manager_popup_entry_form_close');
            if (closeBtn) closeBtn.click();
            else popup.style.display = 'none';
        }
        popup.classList.remove(DOCK_CLASS);
        if (original) {
            if (original.nextSibling && original.nextSibling.parentNode === original.parent) {
                original.parent.insertBefore(popup, original.nextSibling);
            } else if (original.parent) {
                original.parent.appendChild(popup);
            }
        }
    }
    original = null;
}
