// src/personaLore/index.js
// Persona Lore feature — drawer takeover + narrator lore injection
// Gated entirely by the personaDrawerTakeover interface toggle

import { eventSource, event_types } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';
import { takeoverDrawer, restoreDrawer, isTakeoverActive, getActiveTab } from './drawerUI.js';
import { renderLoreTab } from './loreUI.js';
import { injectNarratorLore, hasNarratorLoreEntries } from './promptInjection.js';
import { injectDesignCSS, removeDesignCSS, renderDesignTab } from './designTab.js';
import { scheduleCSSRebuild } from '../cssScheduler.js';

const log = () => {};

let drawerObserver = null;

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the Persona Lore feature.
 * Called once from root index.js at startup.
 */
export function initPersonaLore() {
    const settings = extension_settings[MODULE_NAME];

    if (settings.personaDrawerTakeover) {
        setupDrawerWatcher();
        injectDesignCSS();
    }

    setupPersonaChangeListener();
    setupPromptEvents();
    setupChatEvents();

    log('Initialized');
}

/**
 * Called when the personaDrawerTakeover toggle changes.
 * @param {boolean} enabled
 */
export function onPersonaDrawerToggleChanged(enabled) {
    if (enabled) {
        setupDrawerWatcher();
        applyIfDrawerOpen();
        injectDesignCSS();
    } else {
        teardownDrawerWatcher();
        if (isTakeoverActive()) {
            restoreDrawer();
        }
        removeDesignCSS();
    }
}

/**
 * Log the current lore state. Called internally after persona changes.
 * The actual injection is event-driven (CHAT_COMPLETION_PROMPT_READY).
 */
function syncNarratorLore() {
    const count = hasNarratorLoreEntries();
    log(count ? '✓ Lore entries present — will inject at next generation' : '✓ No lore entries — injection inactive');
}

// ============================================================
// Drawer Takeover
// ============================================================

function setupDrawerWatcher() {
    teardownDrawerWatcher();

    const drawerContent = document.getElementById('PersonaManagement');
    if (!drawerContent) {
        log('PersonaManagement element not found — will retry on next event');
        return;
    }

    drawerObserver = new MutationObserver(() => {
        const isOpen = drawerContent.classList.contains('openDrawer');
        if (isOpen && !isTakeoverActive()) {
            takeoverDrawer();
        }
        // Recovery: if container was removed externally
        if (isTakeoverActive() && !document.getElementById('wl-pl-container')) {
            log('Container lost — will re-takeover on next open');
        }
    });

    drawerObserver.observe(drawerContent, { attributes: true, attributeFilter: ['class'] });
    log('Drawer watcher active');
}

function teardownDrawerWatcher() {
    if (drawerObserver) {
        drawerObserver.disconnect();
        drawerObserver = null;
    }
}

function applyIfDrawerOpen() {
    const drawerContent = document.getElementById('PersonaManagement');
    if (drawerContent?.classList.contains('openDrawer') && !isTakeoverActive()) {
        takeoverDrawer();
    }
}

// ============================================================
// Persona Change Detection
// ============================================================

function setupPersonaChangeListener() {
    const avatarBlock = document.getElementById('user_avatar_block');
    if (!avatarBlock) return;

    avatarBlock.addEventListener('click', () => {
        // Wait for ST to process the persona switch
        setTimeout(() => {
            if (isTakeoverActive()) {
                const tab = getActiveTab();
                if (tab === 'narrator-lore') {
                    renderLoreTab();
                } else if (tab === 'design') {
                    const pane = document.querySelector('#wl-pl-container .wl-pl-tab-pane[data-tab="design"]');
                    if (pane) renderDesignTab(pane);
                }
            }
            // Re-inject design CSS after persona switch
            const settings = extension_settings[MODULE_NAME];
            if (settings.personaDrawerTakeover) {
                injectDesignCSS();
            }
        }, 150);
    });
}

// ============================================================
// Prompt Injection Events
// ============================================================

function setupPromptEvents() {
    // Inject narrator lore into the prompt at generation time
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
        const settings = extension_settings[MODULE_NAME];

        // Only inject if the persona drawer feature is toggled ON
        if (!settings.personaDrawerTakeover) return;

        // Only inject if there are actual lore entries
        if (!hasNarratorLoreEntries()) return;

        injectNarratorLore(eventData);
    });
}

// ============================================================
// Chat Events — Design CSS Lifecycle
// ============================================================

function setupChatEvents() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        const settings = extension_settings[MODULE_NAME];
        if (settings.personaDrawerTakeover) {
            // Batched via cssScheduler so all CSS modules update in one frame
            scheduleCSSRebuild('personaDesign', () => {
                injectDesignCSS();

                // Refresh Design tab if currently visible
                if (isTakeoverActive() && getActiveTab() === 'design') {
                    const pane = document.querySelector('#wl-pl-container .wl-pl-tab-pane[data-tab="design"]');
                    if (pane) renderDesignTab(pane);
                }
            });
        }
    });
}
