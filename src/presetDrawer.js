// src/presetDrawer.js
// Preset Drawer feature — tabbed layout for Chat Completion settings
// Reorganizes ST's existing DOM elements into Overview / Sections tabs.
//
// Detection strategy (v2 — lightweight):
//   CSS anti-flash rules in presetDrawer.css handle visual flash prevention
//   via :not(:has(#wl-pd-container)) selectors. This lets us use a cheap
//   attribute+childList observer instead of subtree scanning.
//
//   Observer watches #left-nav-panel for:
//     - class changes (closedDrawer ↔ openDrawer) → apply takeover on open
//     - direct childList changes → recover if our container is removed
//   API type changes (#main_api) trigger recovery via event listener.
//   One-shot subtree observer on body only if panel doesn't exist at init.

import { getSetting } from './settings.js';

const log = () => {};

// Track relocated elements so we can restore them
let originalPositions = []; // { element, parent, nextSibling }
let isActive = false;
let panelObserver = null;
let initObserver = null;

// ============================================================
// Drawer Takeover
// ============================================================

/**
 * Take over the Chat Completion preset drawer.
 * Relocates ST's existing DOM elements into a tabbed layout (Overview / Sections).
 *
 * Uses a "curtain" pattern: hides the drawer-content container during DOM
 * manipulation, then reveals it after layout is settled. This prevents any
 * flash of native content even if the CSS anti-flash rules are insufficient.
 */
function takeoverDrawer() {
    if (isActive) return;
    if (document.getElementById('wl-pd-container')) return;

    const rangeBlock = document.getElementById('range_block_openai');
    const openaiSettings = document.getElementById('openai_settings');
    const promptManager = document.getElementById('completion_prompt_manager');
    const promptManagerWrapper = promptManager?.closest('.range-block');

    if (!rangeBlock || !openaiSettings || !promptManager) {
        return;
    }

    // --- Curtain down: hide drawer content before DOM manipulation ---
    // This runs synchronously in the MutationObserver callback, so the
    // browser hasn't painted yet. The curtain ensures even complex DOM
    // reshuffling is invisible to the user.
    const drawerContent = rangeBlock.closest('.drawer-content');
    let curtainApplied = false;
    if (drawerContent) {
        drawerContent.style.visibility = 'hidden';
        curtainApplied = true;
    }

    // Snapshot original positions for restore
    originalPositions = [
        { element: rangeBlock, parent: rangeBlock.parentNode, nextSibling: rangeBlock.nextSibling },
        { element: openaiSettings, parent: openaiSettings.parentNode, nextSibling: openaiSettings.nextSibling },
    ];
    if (promptManagerWrapper && promptManagerWrapper !== promptManager) {
        originalPositions.push({
            element: promptManagerWrapper,
            parent: promptManagerWrapper.parentNode,
            nextSibling: promptManagerWrapper.nextSibling,
        });
    }

    // Build the tabbed container
    const container = document.createElement('div');
    container.id = 'wl-pd-container';
    container.innerHTML = `
        <div id="wl-pd-tab-bar">
            <button class="wl-pd-tab active" data-tab="overview">Overview</button>
            <button class="wl-pd-tab" data-tab="sections">Sections</button>
        </div>
        <div id="wl-pd-tab-content">
            <div class="wl-pd-tab-pane active" data-tab="overview"></div>
            <div class="wl-pd-tab-pane" data-tab="sections"></div>
        </div>
    `;

    // Insert container before the range block
    rangeBlock.parentNode.insertBefore(container, rangeBlock);

    // Relocate DOM elements into tabs
    const overviewPane = container.querySelector('.wl-pd-tab-pane[data-tab="overview"]');
    overviewPane.appendChild(rangeBlock);
    overviewPane.appendChild(openaiSettings);

    const sectionsPane = container.querySelector('.wl-pd-tab-pane[data-tab="sections"]');
    if (promptManagerWrapper && promptManagerWrapper !== promptManager) {
        sectionsPane.appendChild(promptManagerWrapper);
    } else {
        sectionsPane.appendChild(promptManager);
    }

    // Wire up tab switching
    container.querySelectorAll('.wl-pd-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    isActive = true;

    // --- Curtain up: reveal after DOM work is complete ---
    // requestAnimationFrame defers the reveal to the next paint frame,
    // guaranteeing the browser only ever renders the final layout.
    if (curtainApplied) {
        requestAnimationFrame(() => {
            drawerContent.style.visibility = '';
        });
    }

    log('Drawer takeover applied');
}

/**
 * Switch between tabs.
 * @param {string} tabName - 'overview' or 'sections'
 */
function switchTab(tabName) {
    const container = document.getElementById('wl-pd-container');
    if (!container) return;

    container.querySelectorAll('.wl-pd-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    container.querySelectorAll('.wl-pd-tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.dataset.tab === tabName);
    });
}

/**
 * Restore the preset drawer to its original state.
 */
function restoreDrawer() {
    if (!isActive) return;

    const container = document.getElementById('wl-pd-container');
    if (!container) {
        isActive = false;
        return;
    }

    for (const { element, parent, nextSibling } of originalPositions) {
        if (element && parent) {
            if (nextSibling && nextSibling.parentNode === parent) {
                parent.insertBefore(element, nextSibling);
            } else {
                parent.appendChild(element);
            }
        }
    }

    container.remove();
    originalPositions = [];
    isActive = false;
    log('Drawer restored to original state');
}

// ============================================================
// Visibility Sync
// ============================================================

/**
 * Show container only when Chat Completion (openai) is the active API.
 */
function syncContainerVisibility() {
    const container = document.getElementById('wl-pd-container');
    if (!container) return;

    const apiSelect = document.getElementById('main_api');
    const isChatCompletion = apiSelect?.value === 'openai';
    container.style.display = isChatCompletion ? '' : 'none';
}

// ============================================================
// Detection & Recovery
// ============================================================

/**
 * Check whether takeover needs to be (re-)applied.
 * Fast and idempotent — safe to call from any trigger.
 * @returns {boolean} true if takeover is active after the call
 */
function ensureTakeover() {
    if (!getSetting('presetDrawerTakeover')) return false;

    // Coexistence with the Expanded Preset Drawer: while its full-page overlay
    // is open it OWNS #range_block_openai / #openai_settings /
    // #completion_prompt_manager (relocated into the overlay). Our panel
    // observer's childList watch fires when the expanded drawer steals them,
    // so bail here rather than fight over the same nodes. On expanded close it
    // restores them to native and calls resumeAfterExpanded() → re-takeover.
    if (document.body.classList.contains('wl-pe-open')) return false;

    // Recovery: if our container was removed externally (ST re-render,
    // API switch, theme change) but we still think we're active,
    // reset state so takeoverDrawer() can re-apply cleanly.
    if (isActive && !document.getElementById('wl-pd-container')) {
        log('Container lost — resetting for re-takeover');
        originalPositions = [];
        isActive = false;
    }

    if (isActive) return true;

    takeoverDrawer();
    syncContainerVisibility();
    return isActive;
}

/**
 * Set up a lightweight observer on #left-nav-panel.
 *
 * Watches for:
 *   - class changes (closedDrawer ↔ openDrawer) → re-apply on open
 *   - direct childList changes → recover if our container is removed
 *
 * Does NOT use subtree: true. CSS anti-flash rules in presetDrawer.css
 * prevent any visual flash, so we don't need to catch every deep DOM
 * mutation before the browser paints.
 */
function setupPanelObserver(panel) {
    if (panelObserver) return;

    panelObserver = new MutationObserver(() => {
        ensureTakeover();
    });

    panelObserver.observe(panel, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,        // catches our container being removed
        subtree: false,         // ← the key difference: no subtree scanning
    });

    // Apply immediately — elements are in static HTML and may already exist
    ensureTakeover();
    log('Panel observer active (attribute + childList, no subtree)');
}

/**
 * Find #left-nav-panel and set up the observer.
 * If the panel doesn't exist yet (very early extension load), use a
 * one-shot body observer that disconnects as soon as the panel appears.
 */
function findPanelAndObserve() {
    const panel = document.getElementById('left-nav-panel');
    if (panel) {
        setupPanelObserver(panel);
        return;
    }

    // Panel not in DOM yet — one-shot body watch
    log('Waiting for #left-nav-panel...');
    initObserver = new MutationObserver(() => {
        const panel = document.getElementById('left-nav-panel');
        if (panel) {
            initObserver.disconnect();
            initObserver = null;
            setupPanelObserver(panel);
        }
    });
    initObserver.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the Preset Drawer feature.
 * Called once on startup from index.js.
 */
export function initPresetDrawer() {
    // The anti-flash CSS (presetDrawer.css) hides native CC settings whenever
    // #wl-pd-container is absent — but that must ONLY apply when this tabbed
    // takeover is enabled, otherwise it would hide the native drawer for users
    // who have this feature off. Gate it on body.bd-pd-tabbed.
    document.body.classList.toggle('bd-pd-tabbed', !!getSetting('presetDrawerTakeover'));

    if (getSetting('presetDrawerTakeover')) {
        findPanelAndObserve();
    }

    // Watch for API type changes — also triggers recovery since
    // switching API types can rebuild the drawer internals.
    const apiSelect = document.getElementById('main_api');
    if (apiSelect) {
        apiSelect.addEventListener('change', () => {
            syncContainerVisibility();
            // API switch may destroy our container — schedule recovery.
            // rAF ensures ST has finished its own DOM updates first.
            requestAnimationFrame(() => ensureTakeover());
        });
    }

    log('Initialized');
}

/**
 * Called when the toggle changes in WL panel.
 * @param {boolean} enabled
 */
export function onPresetDrawerToggleChanged(enabled) {
    // Keep the anti-flash gate in sync: only hide native CC while this feature
    // is on (see presetDrawer.css / initPresetDrawer).
    document.body.classList.toggle('bd-pd-tabbed', !!enabled);

    if (enabled) {
        findPanelAndObserve();
    } else {
        if (panelObserver) {
            panelObserver.disconnect();
            panelObserver = null;
        }
        if (initObserver) {
            initObserver.disconnect();
            initObserver = null;
        }
        if (isActive) {
            restoreDrawer();
        }
    }
}

/**
 * Check if takeover is currently active.
 * @returns {boolean}
 */
export function isPresetDrawerActive() {
    return isActive;
}

/**
 * Coexistence hook for the Expanded Preset Drawer.
 * Called when the expanded overlay is about to open: release the tabbed
 * takeover so the native elements return to their home positions, ready for
 * the overlay to relocate them. The caller sets body.wl-pe-open, so the panel
 * observer's ensureTakeover() will no-op until resume.
 */
export function suspendForExpanded() {
    if (isActive) restoreDrawer();
}

/**
 * Coexistence hook for the Expanded Preset Drawer.
 * Called after the expanded overlay closes and has restored the native
 * elements: re-apply the tabbed takeover (body.wl-pe-open is already cleared).
 */
export function resumeAfterExpanded() {
    ensureTakeover();
    syncContainerVisibility();
}
