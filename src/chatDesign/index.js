// src/chatDesign/index.js
// Chat Design — Feature lifecycle, CSS injection, event wiring
//
// Manages:
//   - CSS injection on CHAT_CHANGED and VERSE_CHANGED
//   - Enable/disable toggle
//   - Style edit refresh

import { eventSource, event_types } from '../../../../../../script.js';
import { isChatDesignEnabled } from './storage.js';
import { injectChatDesignCSS, removeChatDesignCSS } from './cssGenerator.js';
import { refreshCursorDiscovery } from './cursors.js';
import { scheduleCSSRebuild } from '../cssScheduler.js';
import { startAvatarStamping, stopAvatarStamping, stampAllMessages } from './avatarStamp.js';
import { applyThemeForActiveChar } from './themeSwitch.js';
import { applyIconSetsForActiveChar } from './iconSwitch.js';
import { applySideButtonStyleForActiveChar } from './sideButtonStyleSwitch.js';

const log = () => {};

/**
 * Initialize Chat Design.
 * Called once from root index.js during extension startup.
 */
export function initChatDesign() {
    applySideButtonStyleForActiveChar();

    // Inject CSS if enabled on startup
    if (isChatDesignEnabled()) {
        injectChatDesignCSS();
        startAvatarStamping();
    }

    // Cursor sets are discovered from the server (nebula-loader). Kick off one
    // scan in the background; when it resolves, re-inject so any active cursor
    // "set" style can resolve its files. Non-blocking and self-guarding — a
    // missing plugin resolves to "unavailable" and this becomes a no-op.
    refreshCursorDiscovery()
        .then(() => { if (isChatDesignEnabled()) injectChatDesignCSS(); })
        .catch(() => {});

    // Re-inject CSS when chat changes (character switch, new chat, etc.)
    // Batched via cssScheduler so all three CSS modules update in one frame
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (isChatDesignEnabled()) {
            scheduleCSSRebuild('chatDesign', () => injectChatDesignCSS());
            // New chat DOM — make sure messages carry their avatar stamp.
            // The observer catches incremental adds; this covers the bulk
            // render that happens on chat load.
            stampAllMessages();
        }

        // Per-character UI theme switching. Deliberately OUTSIDE the
        // isChatDesignEnabled() guard: auto-theming is its own feature (driven
        // by its own assignment map + default), independent of whether the
        // Chat Design CSS overrides are enabled. Self-guards internally — no-ops
        // when nothing is assigned and no default is set. This handler only runs
        // once UIBedazzler is loaded, which is what fixes the old quick-reply's
        // boot-time "/split unknown command" race.
        applyThemeForActiveChar();
        void applyIconSetsForActiveChar();
        applySideButtonStyleForActiveChar();
    });

    // cuteLoader resolves its host asynchronously. Once its icon assets and
    // global defaults are ready, re-apply the active character's overrides.
    window.addEventListener('UIBEDAZZLER_ICON_DEFAULTS_CHANGED', () => {
        void applyIconSetsForActiveChar();
    });

    // Re-inject on verse change (verse styles may target different characters)
    // VERSE_CHANGED is a custom event fired by VerseManager
    eventSource.on('VERSE_CHANGED', () => {
        if (isChatDesignEnabled()) {
            // Small delay to let verse character lists update
            setTimeout(() => injectChatDesignCSS(), 150);
        }
    });

    log('Initialized');
}

/**
 * Called when the Chat Design enable toggle changes.
 */
export function onChatDesignToggleChanged(enabled) {
    if (enabled) {
        injectChatDesignCSS();
        startAvatarStamping();
    } else {
        removeChatDesignCSS();
        stopAvatarStamping();
    }
}

/**
 * Rebuild CSS after style edits — immediate.
 * Use for save/toggle operations where delay is undesirable.
 */
export function refreshChatDesignCSS() {
    if (isChatDesignEnabled()) {
        injectChatDesignCSS();
    }
}

/**
 * Debounced CSS rebuild — coalesces rapid changes (slider drags, color
 * picker sweeps) into a single rebuild. 80ms feels instant to the user
 * while avoiding dozens of full CSS rebuilds per second.
 */
let cssDebounceTimer = null;
export function refreshChatDesignCSSDebounced() {
    if (cssDebounceTimer) clearTimeout(cssDebounceTimer);
    cssDebounceTimer = setTimeout(() => {
        cssDebounceTimer = null;
        refreshChatDesignCSS();
    }, 80);
}
