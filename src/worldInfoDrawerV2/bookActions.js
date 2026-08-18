// src/worldInfoDrawerV2/bookActions.js
// WI v2 — lorebook-level actions: New · Rename · Duplicate · Export · Import ·
// Delete. Every one is driven through ST's OWN native controls (setSTEditorTo +
// invokeSTBookAction — the same native-driven approach the earlier v1 drawer
// used). This module is the shared action layer behind BOTH the
// rail's right-click menu (bookMenu.js) and the topbar toolbar (topbar.js).
//
// WHY NATIVE, NOT REIMPLEMENTED (answers the rename question directly):
// ST's renameWorldInfo is NOT exported, and it does far more than a
// save-new/delete-old — it retargets character / persona / chat-binding links
// and runs its own "update primary character links?" confirm. The native
// delete / duplicate / export handlers carry the same hidden bookkeeping
// (charLore cleanup, free-name suffixing, the file download). Re-deriving all
// of that here would drift from ST as it changes. So the rule matches v1:
// point #world_editor_select at the book, then click the native button whose
// click handler ST (re)binds in displayWorldEntries. Those buttons live in ST's
// WI drawer template and are always in the DOM (hidden behind our overlay), so
// this works with the native drawer shut.
//
// New / Import need no target book: New goes through the exported
// createNewWorldInfo API (its own name popup); Import clicks ST's
// #world_import_button (→ #world_import_file picker).
//
// Structural changes are observed through #world_editor_select. That native
// signal refreshes the rail when the operation actually commits, without a
// timer or polling loop surviving a canceled dialog.

import { dropCount } from './railData.js';
import { refreshRail, requestOpenBook } from './rail.js';
import { Popup } from '../../../../../../scripts/popup.js';

const worldInfoPromise = import('../../../../../../scripts/world-info.js');

const log = () => {};

// ST native book-action buttons — the same set v1 drives.
const ST_BTN = {
    rename:    '#world_popup_name_button',
    export:    '#world_popup_export',
    duplicate: '#world_duplicate',
    delete:    '#world_popup_delete',
    import:    '#world_import_button',
};

// ============================================================
// Native-drive helpers (ports of v1's setSTEditorTo / invokeSTBookAction)
// ============================================================

/** Point ST's editor dropdown at `bookName` so the native buttons target it.
 *  Firing 'change' runs ST's onWorldInfoChange → displayWorldEntries, which
 *  (re)binds each native button's click handler to THIS book and its data. */
function setSTEditorTo(bookName) {
    if (!bookName) return false;
    const select = document.querySelector('#world_editor_select');
    if (!select) return false;
    const option = Array.from(select.options).find(o => o.textContent.trim() === bookName);
    if (!option) return false;
    select.value = option.value;
    if (typeof $ !== 'undefined') $(select).trigger('change');
    else select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

/** Select `bookName` in ST's editor, then click one of its native buttons. */
function invokeSTBookAction(bookName, stSelector) {
    if (!bookName) { log('No book — action skipped'); return false; }
    if (!setSTEditorTo(bookName)) { log(`Book "${bookName}" not in ST editor select`); return false; }
    const btn = document.querySelector(stSelector);
    if (!btn) { log(`ST button ${stSelector} not found`); return false; }
    btn.click();
    return true;
}

/** Click a native button that needs no book pre-selection (Import). */
function clickSTButton(stSelector) {
    const btn = document.querySelector(stSelector);
    if (btn) { btn.click(); return true; }
    log(`ST button ${stSelector} not found`);
    return false;
}

// ============================================================
// Public actions — one selected book name in, native control driven
// ============================================================

/** Rename via ST's own dialog (name input + link-retarget + char-link confirm). */
export function renameBook(name) {
    invokeSTBookAction(name, ST_BTN.rename);
}

/** Duplicate via ST (its own free-name input); the copy joins the library. */
export function duplicateBook(name) {
    invokeSTBookAction(name, ST_BTN.duplicate);
}

/** Export = ST downloads `<name>.json`. No structural change, so no refresh. */
export function exportBook(name) {
    invokeSTBookAction(name, ST_BTN.export);
}

/** Delete via ST's confirm (also strips the book from charLore + selections). */
export function deleteBook(name) {
    invokeSTBookAction(name, ST_BTN.delete);
}

/** Import = ST's file picker (#world_import_button → #world_import_file). */
export function importBook() {
    clickSTButton(ST_BTN.import);
}

/** New empty lorebook through the exported API, then open it in v2. */
export async function newBook() {
    try {
        const name = await Popup.show.input('New Lorebook', 'Enter a name for the new lorebook:');
        const trimmed = String(name ?? '').trim();
        if (!trimmed) return;
        const { createNewWorldInfo } = await worldInfoPromise;
        // interactive:true → ST asks before overwriting an existing name.
        const ok = await createNewWorldInfo(trimmed, { interactive: true });
        if (!ok) return;
        // createNewWorldInfo already awaited updateWorldInfoList, so world_names
        // holds the new book now: refresh the rail and open it in the editor.
        dropCount(trimmed);
        refreshRail();
        requestOpenBook(trimmed);
        log(`Created lorebook "${trimmed}"`);
    } catch (err) {
        console.error('[BD] WI v2: new lorebook failed:', err);
    }
}
