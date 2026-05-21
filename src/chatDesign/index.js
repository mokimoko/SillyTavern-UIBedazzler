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
import { scheduleCSSRebuild } from '../cssScheduler.js';

const log = () => {};

/**
 * Initialize Chat Design.
 * Called once from root index.js during extension startup.
 */
export function initChatDesign() {
    // Inject CSS if enabled on startup
    if (isChatDesignEnabled()) {
        injectChatDesignCSS();
    }

    // Re-inject CSS when chat changes (character switch, new chat, etc.)
    // Batched via cssScheduler so all three CSS modules update in one frame
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (isChatDesignEnabled()) {
            scheduleCSSRebuild('chatDesign', () => injectChatDesignCSS());
        }
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
    } else {
        removeChatDesignCSS();
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
