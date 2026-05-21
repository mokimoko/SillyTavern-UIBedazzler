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
        injectDesignCSS();
    }

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
        injectDesignCSS();
    } else {
        teardownDrawerWatcher();
        if (isTakeoverActive()) {
            restoreDrawer();
        }
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
            log('Container lost — will re-takeover on next open');
        }
    });

    drawerObserver.observe(popup, {
        attributes: true,
        attributeFilter: ['class', 'style'],
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
        if (settings.charDrawerTakeover) {
            // Batched via cssScheduler so all CSS modules update in one frame
            scheduleCSSRebuild('charDesign', () => {
                injectDesignCSS();

                // Refresh Design tab if currently visible
                if (isTakeoverActive() && getActiveTab() === 'design') {
                    const pane = document.querySelector('.wl-cd-tab-pane[data-tab="design"]');
                    if (pane) renderDesignTab(pane);
                }
            });
        }
    });
}
