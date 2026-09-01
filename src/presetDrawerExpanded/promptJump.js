// src/presetDrawerExpanded/promptJump.js
// Bridge from the Test tab's Prompt viewer back to the source block in the
// middle column's prompt manager.
//
// Each compiled message carries provenance (promptProvenance.js): ids[0] is the
// innermost ST prompt identifier that produced it. Given that id we can:
//   • name it — read the label straight off the live prompt-manager row, so the
//     viewer's jump button matches exactly what the user sees in the list; and
//   • open it — click the row's native edit action. editorDock.js is already
//     listening for that click and relocates ST's own editor popup into the
//     right column, so we get native save/validation/token-recount for free.
//
// No ST imports here: everything is resolved off the DOM rows the group layer
// already relies on, which keeps this decoupled from openai.js versioning.

import { activateRightTab } from './drawerBridge.js';

/** The relocated prompt-manager list inside the expanded drawer's center column. */
function centerList() {
    const center = document.getElementById('wl-pe-center');
    if (!center) return null;
    return center.querySelector('.completion_prompt_manager_list')
        || center.querySelector('#completion_prompt_manager ul')
        || center.querySelector('#completion_prompt_manager ol');
}

function rowById(id) {
    const list = centerList();
    if (!list || !id) return null;
    const safe = (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '\\"');
    return list.querySelector(`li[data-pm-identifier="${safe}"]`);
}

/** The clickable action that opens ST's editor for a row: the pencil if present,
 *  otherwise the inspect link on the prompt name. Markers/system prompts have
 *  neither and return null (nothing to edit). */
function editTrigger(row) {
    return row.querySelector('.prompt-manager-edit-action')
        || row.querySelector('.completion_prompt_manager_prompt_name a')
        || null;
}

/**
 * Resolve a source block id to `{ id, label, editable }` from its live PM row,
 * or null when no such row exists (e.g. an injected prompt with no list entry).
 */
export function blockLabelForId(id) {
    const row = rowById(id);
    if (!row) return null;
    const nameEl = row.querySelector('.completion_prompt_manager_prompt_name');
    const label = ((nameEl?.querySelector('a')?.textContent) || nameEl?.textContent || '').trim();
    if (!label) return null;
    return { id: String(id), label, editable: !!editTrigger(row) };
}

/**
 * Switch to the Edit tab and open this block's native editor in the right
 * column. Returns true if an editor was opened; false if the block isn't
 * editable (in which case we just scroll its row into view and flash it).
 */
export function openBlockInEditor(id) {
    activateRightTab('edit');
    const row = rowById(id);
    if (!row) return false;

    const trigger = editTrigger(row);
    if (trigger) {
        // editorDock.js docks the popup on the click it sees bubble to document.
        trigger.click();
        row.scrollIntoView({ block: 'nearest' });
        return true;
    }

    // Not editable — surface where it lives instead of opening a blank editor.
    row.scrollIntoView({ block: 'center' });
    row.classList.add('wl-pe-jump-flash');
    setTimeout(() => row.classList.remove('wl-pe-jump-flash'), 1200);
    return false;
}
