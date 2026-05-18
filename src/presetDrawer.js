// src/presetDrawer.js
// Preset Drawer feature — tabbed layout for Chat Completion settings
// Reorganizes ST's existing DOM elements into Overview / Sections tabs.
//
// Uses a persistent MutationObserver (Nemo Engine pattern) for instant,
// flash-free takeover. The observer catches target elements the moment they
// appear in the DOM and applies the takeover in the same microtask — before
// the browser paints. Combined with CSS anti-flash rules in presetDrawer.css
// for belt-and-suspenders protection.

import { getSetting } from './settings.js';

const log = (...args) => console.log('[WL PresetDrawer]', ...args);

// Track relocated elements so we can restore them
let originalPositions = []; // { element, parent, nextSibling }
let isActive = false;
let panelObserver = null;

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
// MutationObserver — Nemo-inspired instant detection
// ============================================================

/**
 * Check whether takeover needs to be (re-)applied.
 * Runs on every relevant DOM mutation inside #left-nav-panel.
 * Must be fast and idempotent — the observer fires frequently.
 */
function ensureTakeover() {
    if (!getSetting('presetDrawerTakeover')) return;

    // Recovery: if our container was removed externally (ST re-render,
    // API switch, theme change) but we still think we're active,
    // reset state so takeoverDrawer() can re-apply cleanly.
    if (isActive && !document.getElementById('wl-pd-container')) {
        log('Container lost — resetting for re-takeover');
        originalPositions = [];
        isActive = false;
    }

    takeoverDrawer();
    syncContainerVisibility();
}

/**
 * Set up a persistent MutationObserver on #left-nav-panel.
 * Uses rAF coalescing — mutations within the same frame are batched
 * into a single ensureTakeover() call. This prevents the observer
 * from firing hundreds of times during heavy DOM activity (ST renders,
 * other extensions, tooltip creation, etc.) while still catching
 * element creation before the next paint.
 */
function setupPanelObserver(leftNavPanel) {
    if (panelObserver) return;

    let rafPending = false;
    panelObserver = new MutationObserver(() => {
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(() => {
                rafPending = false;
                ensureTakeover();
            });
        }
    });

    // childList + subtree catches element creation/removal.
    // rAF coalescing above prevents this from being a hot path.
    // CSS anti-flash rules + curtain pattern handle any visual gap.
    panelObserver.observe(leftNavPanel, {
        childList: true,
        subtree: true,
    });

    // Run immediately — elements may already be in the DOM
    ensureTakeover();
    log('Panel observer active');
}

/**
 * Find #left-nav-panel and set up the observer.
 * If the panel doesn't exist yet (early extension load), watch
 * document.body until it appears, then switch to the targeted observer.
 */
function findPanelAndObserve() {
    const leftNavPanel = document.querySelector('#left-nav-panel');
    if (leftNavPanel) {
        setupPanelObserver(leftNavPanel);
        return;
    }

    // Panel not in DOM yet — watch body until it appears
    log('Waiting for #left-nav-panel...');
    const bodyObs = new MutationObserver((_mutations, obs) => {
        const panel = document.querySelector('#left-nav-panel');
        if (panel) {
            obs.disconnect();
            setupPanelObserver(panel);
        }
    });
    bodyObs.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the Preset Drawer feature.
 * Called once on startup from index.js.
 */
export function initPresetDrawer() {
    if (getSetting('presetDrawerTakeover')) {
        findPanelAndObserve();
    }

    // Watch for API type changes
    const apiSelect = document.getElementById('main_api');
    if (apiSelect) {
        apiSelect.addEventListener('change', syncContainerVisibility);
    }

    log('Initialized');
}

/**
 * Called when the toggle changes in WL panel.
 * @param {boolean} enabled
 */
export function onPresetDrawerToggleChanged(enabled) {
    if (enabled) {
        findPanelAndObserve();
    } else {
        // Disconnect observer when feature is disabled
        if (panelObserver) {
            panelObserver.disconnect();
            panelObserver = null;
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
