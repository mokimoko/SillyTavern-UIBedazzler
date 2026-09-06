// src/worldInfoDrawerV2/drawerUI.js
// World Info v2 — full-viewport shell (takeover / restore lifecycle).
//
// Reference: _design/wi-v2-mockup.html (the complete design). This file is the
// REAL build: it starts as a scaffold with the mock's top-level regions —
// topbar (view tabs + budget meter + scan + engine-terms toggle), then
// rail / listcol / editor — and the mock's structure gets poured in across
// wiring sessions. Poured so far: the rail, the listcol, the editor, the
// topbar, and the simulator (both sources — last-reply trace + scene dry run).
//
// No ST fields are relocated. The rail reads and writes ST's native controls
// in place (#world_info and the strategy select), so the native drawer remains
// the owner and this workspace stays a client of the same source of truth.
// Entry: the /bdz-widrawer command.

import { extension_settings } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';
import { initRail, teardownRail, refreshRail } from './rail.js';
import { initListcol, teardownListcol, setShowEditorTab } from './listcol.js';
import { initEditor, teardownEditor } from './editor.js';
import { initTopbar, teardownTopbar } from './topbar.js';
import { initSubjectStore, teardownSubjectStore, resyncSubjects } from './subjectStore.js';
import { initSim, teardownSim, refreshSim } from './sim.js';
import { initSimData, teardownSimData } from './simData.js';
import { getOpenBookName } from './rail.js';
import { getBook } from './listData.js';
import { applyWorldInfoThemePalette } from './themePalette.js';

const log = () => {};

const ROOT_ID = 'wl-wi2-root';
const BODY_CLASS = 'wl-wi2-open';

let isActive = false;
let container = null;
let escHandler = null;

// ============================================================
// Public state
// ============================================================

export function isWiV2Active() {
    return isActive;
}

// ============================================================
// Shell
// ============================================================

/**
 * Build the v2 shell. Region map mirrors the mock 1:1 so pours are mechanical:
 *
 *   mock .topbar        → .wl-wi2-topbar    (tabs / meter-wrap; brand deleted
 *                          per the mock's own MOCK-ONLY note — a close button
 *                          takes that slot, since the real overlay needs a
 *                          way out that the mock's page didn't)
 *   mock .main          → .wl-wi2-main
 *   mock #view-editor   → #wl-wi2-view-editor  (.rail / .listcol / .editor)
 *   mock #view-sim      → #wl-wi2-view-sim     (poured by initSim: the two-
 *                          source simulator — last-reply trace + scene dry run)
 *
 * Every id from the mock that JS will target keeps its name with a wl-wi2-
 * prefix (mock #entryList → #wl-wi2-entryList), so mock JS can be ported by
 * prefixing selectors instead of re-deriving them.
 */
function buildShell() {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
        <div class="wl-wi2-topbar">
            <div class="wl-wi2-tabs">
                <button class="wl-wi2-tab active" data-view="editor">Editor</button>
                <button class="wl-wi2-tab" data-view="sim">Simulator</button>
            </div>
            <div class="wl-wi2-meter-wrap" id="wl-wi2-meterWrap"><!-- poured by initTopbar --></div>
            <button class="wl-wi2-close fa-solid fa-xmark"
                    id="wl-wi2-close" title="Close (Esc)"></button>
        </div>
        <div class="wl-wi2-main">
            <div class="wl-wi2-view active" id="wl-wi2-view-editor">
                <div class="wl-wi2-rail" id="wl-wi2-rail"></div>
                <div class="wl-wi2-listcol" id="wl-wi2-listCol"></div>
                <div class="wl-wi2-editor" id="wl-wi2-editorPane"></div>
            </div>
            <div class="wl-wi2-view" id="wl-wi2-view-sim"><!-- poured by initSim --></div>
        </div>
    `;
    return root;
}

// ============================================================
// Takeover / restore
// ============================================================

/**
 * Open the v2 overlay. Idempotent: a second call while open is a no-op.
 * Nothing is relocated from ST yet, so open/close is pure add/remove.
 * Init order matters a little: the rail first (it resolves which book is
 * open, asynchronously), then the listcol (it reads the current answer and
 * subscribes for the async one).
 */
export function takeoverWiV2() {
    if (isActive || document.getElementById(ROOT_ID)) return;

    // Central toggle gate: v2 opens only when Expanded World Info is on. Every
    // entry path routes through here (the /bdz-widrawer command and the native-drawer
    // expand button), so a single guard covers them all — no per-caller checks
    // needed.
    if (!extension_settings[MODULE_NAME]?.worldInfoDrawerExpanded) return;

    container = buildShell();
    applyWorldInfoThemePalette(container);
    document.body.appendChild(container);
    document.body.classList.add(BODY_CLASS);
    isActive = true;

    wireChrome();
    // The subject store first: it holds the sidecar the listcol's subjectOf
    // reads every paint, and its coarse resync wants the open book. Injected
    // resolvers keep the dependency one-way (store never imports rail/listData).
    // bookData answers only for the OPEN book — the resync reconciles that book
    // synchronously; other books self-heal when they next become open (§20.1).
    initSubjectStore({
        openBookName: getOpenBookName,
        bookData: (n) => (getBook().name === n ? getBook().data : null),
    });
    initRail(container.querySelector('#wl-wi2-rail'));
    initListcol(container.querySelector('#wl-wi2-listCol'));
    initEditor(container.querySelector('#wl-wi2-editorPane'));
    initTopbar(container.querySelector('#wl-wi2-meterWrap'));
    // Simulator: the data bridge subscribes to ST's scan events (so a reply
    // sent while the drawer is open is captured), and the view pours into the
    // sim region. The view fetches nothing until its tab is first shown
    // (refreshSim in wireChrome's tab handler) — opening straight to the
    // editor costs the sim nothing.
    initSimData();
    initSim(container.querySelector('#wl-wi2-view-sim'));
    // Let the listcol bring the editor tab forward for §9.33 click-through
    // (a trace row opens its note in the editor, which lives in the other tab).
    setShowEditorTab(() => showView('editor'));
    // Drawer-open is the reconciler's second trigger (§20.1): re-check the open
    // book against disk once the rail has resolved which book that is. Deferred
    // a tick so the rail's async §9.30 arrival can land first.
    setTimeout(() => resyncSubjects(), 0);
    log('WI v2 shell opened');
}

/**
 * Close the v2 overlay and remove every trace (root node, body class, key
 * handler). Safe to call when already closed. The editor tears down first
 * (it only detaches its document click handler — its pending edits are
 * listData's debounce), then the listcol, whose teardown flushes any
 * pending debounced save (§9.31); it holds the book by module reference,
 * so this stays safe as the DOM goes away.
 */
export function restoreWiV2() {
    if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
    }
    teardownTopbar();
    teardownEditor();
    teardownListcol();
    teardownRail();
    // Sim view first, then its data bridge (which detaches the ST scan
    // listeners). The captured last-reply snapshot survives in simData across
    // teardown on purpose — reopen and it's still there, like the meter.
    teardownSim();
    teardownSimData();
    // Store last: its own pending save is flushed inside teardown, and the
    // reconciler listener + rename observer are detached there.
    teardownSubjectStore();
    container?.remove();
    container = null;
    document.getElementById(ROOT_ID)?.remove(); // belt-and-braces
    document.body.classList.remove(BODY_CLASS);
    isActive = false;
    log('WI v2 shell closed');
}

// ============================================================
// Chrome (close button, Esc, view tabs)
// ============================================================

function wireChrome() {
    container.querySelector('#wl-wi2-close')
        ?.addEventListener('click', () => restoreWiV2());

    // Esc closes — registered per-open, removed on restore, so it can never
    // leak or fire while the overlay is down. Ignore Esc when a text control
    // has focus (the user is likely dismissing an autocomplete / cancelling
    // an edit, not asking to leave the whole drawer).
    escHandler = (e) => {
        if (e.key !== 'Escape') return;
        const t = e.target;
        const inText = t instanceof HTMLElement
            && (t.matches('input, textarea, select') || t.isContentEditable);
        if (inText) return;
        restoreWiV2();
    };
    document.addEventListener('keydown', escHandler);

    // Editor / Simulator view switch — same mechanism as the mock's tabs,
    // routed through showView so the §9.33 click-through (setShowEditorTab)
    // and the tab clicks share one path.
    container.querySelectorAll('.wl-wi2-tab').forEach(tab => {
        tab.addEventListener('click', () => showView(tab.dataset.view));
    });
}

/**
 * Show one view, hide the other, light its tab. The Simulator's data is a
 * snapshot of a moving target (a new reply, changed scan settings), so every
 * activation re-fetches via refreshSim — never a stale list from last time.
 */
function showView(view) {
    if (!container) return;
    container.querySelectorAll('.wl-wi2-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.view === view));
    container.querySelectorAll('.wl-wi2-view').forEach(v =>
        v.classList.toggle('active', v.id === `wl-wi2-view-${view}`));
    if (view === 'sim') refreshSim();
}
