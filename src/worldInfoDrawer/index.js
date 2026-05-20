// src/worldInfoDrawer/index.js
// World Info Companion — drawer takeover + floating sidebar
//
// Architecture: DOM takeover inside #WorldInfo (book list + entry table)
// plus a floating sidebar card positioned to the left of the drawer.
// MutationObserver watches #WorldInfo for .openDrawer class.
// Gated by worldInfoDrawerTakeover interface toggle.

import { extension_settings } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';
import { takeoverDrawer, restoreDrawer, isTakeoverActive, wireInteractions } from './drawerUI.js';
import { populateBookList, populateActiveBooks, syncGlobalSettings, wireGlobalSettingsSync, wireToolbarActions, watchSTBookChanges, unwatchSTBookChanges, restoreSelectedBook, resetMultiSelect } from './entryList.js';
import { initPresets } from './presets.js';

const log = (...args) => console.log('[WL WorldInfoDrawer]', ...args);

let drawerObserver = null;

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the World Info Drawer feature.
 * Called once from root index.js at startup.
 */
export function initWorldInfoDrawer() {
    const settings = extension_settings[MODULE_NAME];
    if (settings.worldInfoDrawerTakeover) {
        setupDrawerWatcher();
    }
    log('Initialized');
}
/**
 * Called when the worldInfoDrawerTakeover toggle changes.
 */
export function onWorldInfoDrawerToggleChanged(enabled) {
    if (enabled) {
        setupDrawerWatcher();
        applyIfDrawerOpen();
    } else {
        teardownDrawerWatcher();
        if (isTakeoverActive()) {
            unwatchSTBookChanges();
            restoreDrawer();
        }
    }
}

// ============================================================
// Drawer Watcher
// ============================================================

function setupDrawerWatcher() {
    teardownDrawerWatcher();
    const drawerContent = document.getElementById('WorldInfo');
    if (!drawerContent) {
        log('#WorldInfo not found — will retry on next event');
        return;
    }

    drawerObserver = new MutationObserver(() => {
        const isOpen = drawerContent.classList.contains('openDrawer');
        if (isOpen && !isTakeoverActive()) {
            takeoverDrawer();
            wireInteractions();
            populateFromST();
            log('Takeover applied — drawer opened');
        } else if (!isOpen && isTakeoverActive()) {
            unwatchSTBookChanges();
            resetMultiSelect();
            restoreDrawer();
            log('Restored — drawer closed');
        }
    });

    drawerObserver.observe(drawerContent, {
        attributes: true,
        attributeFilter: ['class'],
    });
    log('Drawer watcher active');
}

function teardownDrawerWatcher() {
    if (drawerObserver) {
        drawerObserver.disconnect();
        drawerObserver = null;
    }
}

function applyIfDrawerOpen() {
    const dc = document.getElementById('WorldInfo');
    if (dc?.classList.contains('openDrawer') && !isTakeoverActive()) {
        takeoverDrawer();
        wireInteractions();
        populateFromST();
    }
}

function populateFromST() {
    try {
        populateBookList();
        populateActiveBooks();
        syncGlobalSettings();
        wireGlobalSettingsSync();
        wireToolbarActions();
        watchSTBookChanges();
        initPresets();
        restoreSelectedBook();
    } catch (err) {
        log('Error populating from ST:', err);
    }
}
