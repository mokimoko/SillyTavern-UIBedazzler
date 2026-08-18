// src/charDrawer/index.js
// Character Drawer feature — enhanced Advanced Definitions with tabbed layout + Design tab
//
// MutationObserver watches for #character_popup to become visible
// Takeover applied once, persists until feature toggled off
// Design CSS injected on chat change for active character styling

import { eventSource, event_types } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';
import { takeoverDrawer, restoreDrawer, isTakeoverActive, getActiveTab } from './drawerUI.js';
import { injectDesignCSS, removeDesignCSS, renderDesignTab } from './designTab.js';
import { scheduleCSSRebuild } from '../cssScheduler.js';

const log = () => {};

let drawerObserver = null;

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the Character Drawer feature.
 * Called once from root index.js at startup.
 */
export function initCharDrawer() {
    const settings = extension_settings[MODULE_NAME];

    if (settings.charDrawerTakeover) {
        setupDrawerWatcher();
    }
    // Design CSS is shared with the Expanded Character Drawer (both edit the
    // same per-character design data), so its lifecycle is gated on EITHER
    // toggle — not just the classic one.
    syncDesignCSS();

    setupChatEvents();

    log('Initialized');
}

/**
 * Called when the charDrawerTakeover toggle changes.
 * @param {boolean} enabled
 */
export function onCharDrawerToggleChanged(enabled) {
    if (enabled) {
        setupDrawerWatcher();
        applyIfPopupOpen();
    } else {
        teardownDrawerWatcher();
        if (isTakeoverActive()) {
            restoreDrawer();
        }
    }
    syncDesignCSS();
}

// ============================================================
// Coexistence API — called by the Expanded Character Drawer
// ============================================================

/**
 * Release our hold on #character_popup's fields (restore them to their native
 * popup positions). Called by the expanded drawer at the START of its takeover
 * so it captures every field at its true original home — otherwise its restore
 * would try to return fields into wl-cd- panes that no longer exist.
 *
 * The drawer watcher stays armed; the wl-xd-open body-class guard inside
 * takeoverDrawer() prevents it from re-grabbing while the expanded drawer is
 * open (including the microtask fired by this very restore removing the
 * wl-cd-active class).
 */
export function releaseCharDrawer() {
    if (isTakeoverActive()) {
        restoreDrawer();
    }
}

/**
 * Re-apply the classic takeover if warranted (feature enabled + popup visible
 * + not already active). Called by the expanded drawer at the END of its
 * restore. In the common case the popup is hidden and this no-ops — the
 * drawer watcher re-takes naturally on the popup's next open.
 */
export function retakeCharDrawer() {
    const settings = extension_settings[MODULE_NAME];
    if (!settings.charDrawerTakeover) return;
    applyIfPopupOpen();
}

/**
 * Reconcile the per-character Design CSS with the CURRENT state of both
 * character-drawer toggles: injected while either is on, removed when both
 * are off. Called from both toggle handlers and init.
 */
export function syncDesignCSS() {
    const settings = extension_settings[MODULE_NAME];
    if (settings.charDrawerTakeover || settings.charDrawerExpanded) {
        injectDesignCSS();
    } else {
        removeDesignCSS();
    }
}

// ============================================================
// Drawer Watcher
// ============================================================

function setupDrawerWatcher() {
    teardownDrawerWatcher();

    const popup = document.getElementById('character_popup');
    if (!popup) {
        log('character_popup not found — will retry on next event');
        return;
    }

    drawerObserver = new MutationObserver(() => {
        if (isPopupVisible(popup) && !isTakeoverActive()) {
            takeoverDrawer();
        }
        // Recovery: if container was removed externally
        if (isTakeoverActive() && !document.getElementById('wl-cd-container')) {
            log('Container lost — restoring relocated fields');
            restoreDrawer();
            if (isPopupVisible(popup)) queueMicrotask(() => takeoverDrawer());
        }
    });

    drawerObserver.observe(popup, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
    });

    log('Drawer watcher active');
}

function teardownDrawerWatcher() {
    if (drawerObserver) {
        drawerObserver.disconnect();
        drawerObserver = null;
    }
}

function isPopupVisible(popup) {
    if (!popup) return false;
    // Avoid getComputedStyle — it forces synchronous style recalculation
    // inside MutationObserver callbacks. Check inline style and classes instead.
    if (popup.style.display === 'none' || popup.style.visibility === 'hidden') return false;
    if (popup.classList.contains('displayNone') || popup.classList.contains('hidden')) return false;
    return true;
}

function applyIfPopupOpen() {
    const popup = document.getElementById('character_popup');
    if (popup && isPopupVisible(popup) && !isTakeoverActive()) {
        takeoverDrawer();
    }
}

// ============================================================
// Chat Events — Design CSS Lifecycle
// ============================================================

function setupChatEvents() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        const settings = extension_settings[MODULE_NAME];
        // Design CSS rebuild serves BOTH character-drawer modes (the expanded
        // drawer edits the same design data), so gate on either toggle.
        if (settings.charDrawerTakeover || settings.charDrawerExpanded) {
            // Batched via cssScheduler so all CSS modules update in one frame
            scheduleCSSRebuild('charDesign', () => {
                injectDesignCSS();

                // Refresh the CLASSIC Design tab if currently visible (the
                // expanded drawer refreshes its own Design pane in its module)
                if (isTakeoverActive() && getActiveTab() === 'design') {
                    const pane = document.querySelector('.wl-cd-tab-pane[data-tab="design"]');
                    if (pane) renderDesignTab(pane);
                }
            });
        }
    });
}
