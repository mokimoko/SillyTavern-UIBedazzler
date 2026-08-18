// src/presetDrawerExpanded/index.js
// Expanded Preset Drawer — feature lifecycle + entry point (Phase 1).
//
// Adds an "expand" button to ST's Chat Completion preset controls. Clicking it
// takes over the screen with the 3-column expanded layout (drawerUI.js).
// OFF by default. Only meaningful when the Chat Completion (openai) API is
// active, so the button self-hides for other sources.

import { extension_settings } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';
import { takeoverExpanded, restoreExpanded, isExpandedActive } from './drawerUI.js';

const log = () => {};

const EXPAND_BTN_ID = 'wl-pe-expand-btn';
let panelObserver = null;

function isEnabled() {
    return !!extension_settings[MODULE_NAME]?.presetDrawerExpanded;
}

function isChatCompletion() {
    return document.getElementById('main_api')?.value === 'openai';
}

// ============================================================
// Expand button
// ============================================================

/**
 * Anchor: the Chat Completion preset selector row. #settings_preset_openai is
 * the preset <select>; we sit our button in its control row. The row is NOT
 * relocated by the tabbed presetDrawer takeover, so it's a stable host whether
 * that feature is on or off.
 */
function anchorRow() {
    const select = document.getElementById('settings_preset_openai');
    if (!select) return null;
    return select.closest('.range-block-title, .flex-container, .range-block') || select.parentElement;
}

function injectExpandButton() {
    if (!isEnabled()) return;
    if (document.getElementById(EXPAND_BTN_ID)) { syncButtonVisibility(); return; }
    const row = anchorRow();
    if (!row) return;

    const btn = document.createElement('div');
    btn.id = EXPAND_BTN_ID;
    btn.className = 'menu_button menu_button_icon fa-solid fa-up-right-and-down-left-from-center';
    btn.title = 'Open the expanded preset drawer';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isChatCompletion() && !isExpandedActive()) takeoverExpanded();
    });
    row.appendChild(btn);
    syncButtonVisibility();
}

/** Hide the button unless Chat Completion is the active API. */
function syncButtonVisibility() {
    const btn = document.getElementById(EXPAND_BTN_ID);
    if (btn) btn.style.display = isChatCompletion() ? '' : 'none';
}

function removeExpandButton() {
    document.getElementById(EXPAND_BTN_ID)?.remove();
}

// ============================================================
// Setup / teardown
// ============================================================

function setupExpandButton() {
    teardownExpandButton();
    injectExpandButton();

    const panel = document.getElementById('left-nav-panel');
    if (!panel) return;
    // ST re-renders the preset controls on API/preset changes, which can wipe
    // our button. Re-inject (and re-sync visibility) on panel mutations.
    panelObserver = new MutationObserver(() => {
        if (!isExpandedActive()) injectExpandButton();
    });
    panelObserver.observe(panel, { childList: true, subtree: true });
}

function teardownExpandButton() {
    if (panelObserver) { panelObserver.disconnect(); panelObserver = null; }
    removeExpandButton();
}

// ============================================================
// Public API
// ============================================================

export function initPresetDrawerExpanded() {
    if (isEnabled()) setupExpandButton();
    // Watcher self-gates on the parent toggle (no-op when off), so calling it
    // unconditionally is safe and mirrors charDrawerExpanded/worldInfoDrawerV2.
    setupOpenExpandedWatcher();

    // Keep the button's visibility honest across API-source switches.
    document.getElementById('main_api')?.addEventListener('change', () => {
        syncButtonVisibility();
        if (isExpandedActive() && !isChatCompletion()) restoreExpanded();
    });

    // Console escape hatch for testing if the anchor ever fails to appear.
    window.bdOpenPresetExpanded = () => { if (isChatCompletion()) takeoverExpanded(); };

    log('Initialized');
}

export function onPresetDrawerExpandedToggleChanged(enabled) {
    if (enabled) {
        setupExpandButton();
        setupOpenExpandedWatcher();
    } else {
        teardownExpandButton();
        teardownOpenExpandedWatcher();
        if (isExpandedActive()) restoreExpanded();
    }
}

// ============================================================
// "Open expanded on top-bar click" (redirect native open → expanded)
// ============================================================
//
// When BOTH the Expanded Preset Drawer toggle (presetDrawerExpanded) and its
// "open on top-bar click" sub-toggle (presetDrawerExpandedOnClick) are on,
// opening ST's native AI Response Configuration panel from the top bar opens
// OUR expanded preset drawer instead (takeoverExpanded) — the same surface the
// manual expand button opens. Direct analog of the char/WI redirects
// (charDrawerExpanded/index.js, worldInfoDrawerV2/index.js).
//
// #left-nav-panel hosts the Chat Completion preset controls this drawer expands;
// text-completion presets live in a separate ST drawer this extension never
// touches, so hijacking every open of THIS panel is scoped to CC. We keep the
// isChatCompletion() gate regardless — the expanded drawer reads the openai
// preset, so opening it without CC active would be meaningless.
//
// Implemented as a class observer on #left-nav-panel (the direct analog of the
// char watcher on #right-nav-panel). Observing the class catches every open
// path — the top-bar #leftNavDrawerIcon click, a programmatic open, a slash
// command — not just one bound handler.
//
// FLOW when the panel opens and both toggles hold:
//   1. Close the native panel by triggering a click on #leftNavDrawerIcon. The
//      panel is open, so ST's doNavbarIconClick toggles it back to .closedDrawer
//      — it slides shut BEHIND our overlay (higher z-index), so the user never
//      sees it, and ST's own open/pin state resets cleanly.
//   2. Open the expanded drawer (takeoverExpanded; idempotent, CC-gated).
//
// RE-ENTRANCY: closing the panel in step 1 mutates #left-nav-panel's class,
// re-firing this observer. The `redirecting` flag suppresses that re-entry, and
// the .openDrawer check means the close mutation (now .closedDrawer) is a no-op.

const PRESET_PANEL_ID = 'left-nav-panel';
const PRESET_DRAWER_ICON_ID = 'leftNavDrawerIcon';

let openOnClickObserver = null;
let redirecting = false;

/**
 * True when BOTH gates hold: the base Expanded Preset Drawer toggle AND its
 * "open on top-bar click" sub-toggle. The sub-toggle is meaningless without the
 * parent (nothing to open into), so both must be on. Defensive against settings
 * not being materialized yet.
 */
function isOpenOnClickEnabled() {
    const s = extension_settings[MODULE_NAME];
    return !!(s?.presetDrawerExpanded && s?.presetDrawerExpandedOnClick);
}

/**
 * Redirect a native panel open into the expanded drawer: close the native panel
 * (so it doesn't sit behind the overlay), then take over. Guarded by
 * `redirecting` so the class mutation from closing can't recurse.
 */
function redirectNativeOpenToOurs() {
    if (redirecting) return;
    redirecting = true;
    try {
        // Close the native panel. It's currently open, so a top-bar icon click
        // toggles it shut (ST's doNavbarIconClick). Guard the element lookup —
        // if the icon isn't present, we still take over below so the user isn't
        // left with nothing.
        const icon = document.getElementById(PRESET_DRAWER_ICON_ID);
        if (icon && typeof $ !== 'undefined' && $(icon).trigger) {
            $(icon).trigger('click');
        } else if (icon) {
            icon.dispatchEvent(new Event('click', { bubbles: true }));
        }
        // Take over, deferred a tick so ST finishes its own close bookkeeping
        // (class flips, pin restore) before the overlay lands.
        setTimeout(() => {
            if (isChatCompletion() && !isExpandedActive()) takeoverExpanded();
            redirecting = false;
        }, 0);
    } catch (err) {
        console.error('[BD] Preset Drawer: open-on-click redirect failed:', err);
        redirecting = false;
    }
}

/**
 * Install (or refresh) the observer that redirects native-panel opens into the
 * expanded drawer. Installed whenever the PARENT toggle is on; while installed it
 * self-gates PER MUTATION on isOpenOnClickEnabled() (which also reads the
 * sub-toggle), so flipping the sub-toggle alone takes effect immediately with no
 * handler. Torn down when the parent is off. Idempotent.
 */
function setupOpenExpandedWatcher() {
    teardownOpenExpandedWatcher();
    // Only observe when the parent is on at all. When it's off the redirect can
    // never fire, so skip the observer rather than run a dead one.
    if (!extension_settings[MODULE_NAME]?.presetDrawerExpanded) return;

    const host = document.getElementById(PRESET_PANEL_ID);
    if (!host) return;

    openOnClickObserver = new MutationObserver(() => {
        // Gate on BOTH toggles live, Chat Completion being active, our overlay
        // not already up, the panel actually being open, and no in-flight
        // redirect. redirecting suppresses the close-mutation re-entry; the
        // .openDrawer check makes the close a no-op.
        if (redirecting) return;
        if (!isOpenOnClickEnabled()) return;
        if (!isChatCompletion()) return;
        if (isExpandedActive()) return;
        if (host.classList.contains('openDrawer')) {
            redirectNativeOpenToOurs();
        }
    });
    openOnClickObserver.observe(host, {
        attributes: true,
        attributeFilter: ['class'],
    });
}

function teardownOpenExpandedWatcher() {
    if (openOnClickObserver) {
        openOnClickObserver.disconnect();
        openOnClickObserver = null;
    }
    redirecting = false;
}

export { isExpandedActive };
