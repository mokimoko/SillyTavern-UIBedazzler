// src/presetDrawerExpanded/drawerUI.js
// Expanded Preset Drawer — full-page takeover shell (Phase 1).
//
// Relocates ST's native Chat Completion elements into a 3-column overlay:
//   left   — Overview  (#range_block_openai + #openai_settings)
//   center — Sections  (#completion_prompt_manager, in its .range-block wrapper)
//   right  — Editor    (placeholder until Phase 4)
//
// Non-destructive: elements are MOVED (not cloned) and returned to their exact
// native positions on close. Coexists with the tabbed presetDrawer.js takeover
// via suspendForExpanded()/resumeAfterExpanded() + the body.wl-pe-open flag.

import { suspendForExpanded, resumeAfterExpanded } from '../presetDrawer.js';
import { startGroupRender, stopGroupRender } from './groupRender.js';
import { startEditorDock, stopEditorDock } from './editorDock.js';
import { startTestChat, stopTestChat } from './testChat.js';
import { startRegexDock, stopRegexDock } from './regexDock.js';

const log = () => {};

const ROOT_ID = 'wl-pe-root';
const OPEN_CLASS = 'wl-pe-open';

let isActive = false;
let originalPositions = []; // { element, parent, nextSibling }

// While the expanded drawer is open we pause the White Lotus companion extension
// (if installed) so the Test tab exercises the RAW preset — not WL's runtime,
// which otherwise takes over prompt blocks and runs separate-gen for trackers /
// scene analysis. No-op when WL isn't present. Guarded so a WL API change can
// never break the takeover.
function setWhiteLotusSuspended(on) {
    try {
        const wl = window.WhiteLotus;
        if (!wl) return;
        if (on) wl.suspend?.(); else wl.resume?.();
    } catch (e) { /* WL absent or incompatible — nothing to pause */ }
}

// ============================================================
// Takeover
// ============================================================

export function takeoverExpanded() {
    if (isActive) return;
    if (document.getElementById(ROOT_ID)) return;

    // Release the tabbed takeover first so the native elements are back in
    // their home positions before we snapshot + relocate them.
    suspendForExpanded();

    // Pause the White Lotus companion (if present) up front, so its Prompt
    // Manager ownership observer sees the unlocked state as the list relocates.
    setWhiteLotusSuspended(true);

    const rangeBlock = document.getElementById('range_block_openai');
    const openaiSettings = document.getElementById('openai_settings');
    const promptManager = document.getElementById('completion_prompt_manager');
    const promptManagerWrapper = promptManager?.closest('.range-block') || promptManager;
    // The preset control block (dropdown + update/rename/save-as/import/export/
    // delete). Prefer the enclosing .range-block so the buttons come along even
    // when they're a sibling of the <select> rather than in its parent. Guard
    // against a too-broad ancestor: if it would swallow the sampler / settings /
    // manager blocks, fall back to the tight parent row. Optional overall — if
    // ST's markup differs and nothing is found, the left column just omits it.
    const presetSelect = document.getElementById('settings_preset_openai');
    let presetRow = presetSelect?.closest('.range-block') || presetSelect?.parentElement || null;
    if (presetRow && (presetRow.contains(rangeBlock) || presetRow.contains(openaiSettings) || presetRow.contains(promptManager))) {
        presetRow = presetSelect?.parentElement || null;
    }

    if (!rangeBlock || !openaiSettings || !promptManager) {
        log('Native CC elements missing — aborting takeover');
        return;
    }

    // Snapshot home positions for an exact restore (skip a missing preset row).
    const snap = (el) => ({ element: el, parent: el.parentNode, nextSibling: el.nextSibling });
    originalPositions = [
        rangeBlock, openaiSettings, promptManagerWrapper, presetRow,
    ].filter(Boolean).map(snap);

    // Build the overlay and mark the body so presetDrawer.js stands down.
    const root = buildShell();
    document.body.appendChild(root);
    document.body.classList.add(OPEN_CLASS);

    const presetSlot = root.querySelector('#wl-pe-preset-slot');
    const overviewSlot = root.querySelector('#wl-pe-overview-slot');
    const center = root.querySelector('#wl-pe-center');

    // Relocate. Order matters if the manager wrapper is nested in openai_settings:
    // move the settings first, then extract the manager into the center column.
    if (presetRow) presetSlot.appendChild(presetRow);
    overviewSlot.appendChild(rangeBlock);
    overviewSlot.appendChild(openaiSettings);
    center.appendChild(promptManagerWrapper);

    // Paint group chrome over the relocated prompt-manager rows and keep it in
    // sync as ST re-renders the list.
    startGroupRender(center);

    // Dock ST's native prompt-edit form into the right column (native save).
    startEditorDock(root.querySelector('#wl-pe-right-body'));

    // Build the Test tab's dummy chat (populates dropdowns from live ST data).
    startTestChat(root.querySelector('#wl-pe-view-test'));

    // Dock ST's native regex panel into the Regex tab (native save path). The
    // per-script editor still opens as ST's own top-layer modal over the overlay.
    startRegexDock(root.querySelector('#wl-pe-regex-body'));

    isActive = true;
    log('Expanded takeover applied');
}

// ============================================================
// Restore
// ============================================================

export function restoreExpanded() {
    if (!isActive) return;

    // Strip group decoration + return the native editor home BEFORE the blocks
    // move, so nothing of ours rides back into the native drawer.
    const _root = document.getElementById(ROOT_ID);
    stopGroupRender(_root?.querySelector('#wl-pe-center'));
    stopEditorDock(_root?.querySelector('#wl-pe-right-body'));
    stopTestChat(_root?.querySelector('#wl-pe-view-test'));
    stopRegexDock(_root?.querySelector('#wl-pe-regex-body'));

    // Return each native element to its exact home position.
    for (const { element, parent, nextSibling } of originalPositions) {
        if (!element || !parent) continue;
        if (nextSibling && nextSibling.parentNode === parent) {
            parent.insertBefore(element, nextSibling);
        } else {
            parent.appendChild(element);
        }
    }
    originalPositions = [];

    document.getElementById(ROOT_ID)?.remove();
    document.body.classList.remove(OPEN_CLASS);
    isActive = false;

    // Prompt manager is home again — hand control back to White Lotus (it will
    // re-lock its owned rows and resume its generation hooks).
    setWhiteLotusSuspended(false);

    // Body flag is cleared — invite the tabbed takeover back.
    resumeAfterExpanded();
    log('Expanded restored');
}

export function isExpandedActive() {
    return isActive;
}

// ============================================================
// Shell
// ============================================================

function buildShell() {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    // Topbar now lives INSIDE the right column (its own header), so the left and
    // center columns extend to the very top. Kept on the right for a future tab
    // strip. The editor docks into #wl-pe-right-body (a scroll region below the
    // header) rather than the column itself.
    root.innerHTML = `
        <div class="wl-pe-main">
            <div class="wl-pe-col wl-pe-col-left" id="wl-pe-left">
                <div class="wl-pe-collabel">Preset</div>
                <div id="wl-pe-preset-slot"></div>
                <div class="wl-pe-collabel">Overview</div>
                <div id="wl-pe-overview-slot"></div>
            </div>
            <div class="wl-pe-col wl-pe-col-center" id="wl-pe-center">
                <div class="wl-pe-collabel">Sections</div>
            </div>
            <div class="wl-pe-col wl-pe-col-editor" id="wl-pe-right">
                <div class="wl-pe-topbar">
                    <div class="wl-pe-tabs">
                        <button class="wl-pe-tab active" data-tab="edit">Edit</button>
                        <button class="wl-pe-tab" data-tab="test">Test</button>
                        <button class="wl-pe-tab" data-tab="regex">Regex</button>
                    </div>
                    <button class="wl-pe-close fa-solid fa-xmark" title="Close (Esc)"></button>
                </div>
                <div class="wl-pe-rt-views">
                    <!-- EDIT view: native prompt editor docks into #wl-pe-right-body -->
                    <div class="wl-pe-rt-view" id="wl-pe-view-edit" data-view="edit">
                        <div class="wl-pe-right-body" id="wl-pe-right-body">
                            <div class="wl-pe-editor-empty">
                                <div class="wl-pe-editor-empty-text">No prompt block open — pick one in Sections.</div>
                            </div>
                        </div>
                    </div>
                    <!-- TEST view: dummy chat, built by testChat.js -->
                    <div class="wl-pe-rt-view" id="wl-pe-view-test" data-view="test" hidden></div>
                    <!-- REGEX view: ST's native regex panel docks into #wl-pe-regex-body -->
                    <div class="wl-pe-rt-view" id="wl-pe-view-regex" data-view="regex" hidden>
                        <div class="wl-pe-regex-body" id="wl-pe-regex-body">
                            <div class="wl-pe-editor-empty">
                                <div class="wl-pe-editor-empty-text">Regex panel unavailable — the native Regex extension isn't loaded.</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    root.querySelector('.wl-pe-close').addEventListener('click', restoreExpanded);

    // Edit / Test tab switch (right column). Edit is default; Test hosts the
    // dummy chat. Purely a view toggle — both views stay mounted so the docked
    // editor and the test chat keep their state when you flip between them.
    root.querySelectorAll('.wl-pe-tab').forEach((tab) => {
        tab.addEventListener('click', () => switchRightTab(root, tab.dataset.tab));
    });

    // Esc closes — registered while open, removed on restore.
    const onKey = (e) => {
        if (e.key !== 'Escape' || !isActive) return;
        // If a native ST modal is open (the regex editor, a confirm popup, …),
        // let it own Escape — don't tear the whole overlay down underneath it.
        if (document.querySelector('dialog[open]')) return;
        e.preventDefault();
        restoreExpanded();
    };
    document.addEventListener('keydown', onKey);
    root._onKey = onKey;
    // Clean the listener up when the root is removed.
    const origRemove = root.remove.bind(root);
    root.remove = () => { document.removeEventListener('keydown', onKey); origRemove(); };

    return root;
}

/** Switch the right column to a named tab ('edit' | 'test') from anywhere.
 *  No-op when the expanded drawer isn't mounted. Used by the Prompt viewer's
 *  "jump to block" button to surface the docked editor. */
export function activateRightTab(which) {
    const root = document.getElementById(ROOT_ID);
    if (root) switchRightTab(root, which);
}

// Toggle the right column between the Edit and Test views. Just flips `hidden`
// on the two view containers and the active class on the tabs; nothing is torn
// down, so both keep their state.
function switchRightTab(root, tab) {
    const TABS = ['edit', 'test', 'regex'];
    const which = TABS.includes(tab) ? tab : 'edit';
    root.querySelectorAll('.wl-pe-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === which);
    });
    // Toggle every view by its data-view key; only the active one is shown. Both
    // others stay mounted so the docked editor / test chat / regex panel keep
    // their state when you flip between tabs.
    root.querySelectorAll('.wl-pe-rt-view').forEach((v) => {
        v.hidden = (v.dataset.view !== which);
    });
}
