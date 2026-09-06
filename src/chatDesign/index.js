// src/chatDesign/index.js
// Chat Design — Feature lifecycle, CSS injection, event wiring
//
// Manages:
//   - CSS injection on CHAT_CHANGED and VERSE_CHANGED
//   - Enable/disable toggle
//   - Style edit refresh

import { eventSource, event_types } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { isChatDesignEnabled } from './storage.js';
import { injectChatDesignCSS, removeChatDesignCSS } from './cssGenerator.js';
import { refreshCursorDiscovery } from './cursors.js';
import { scheduleCSSRebuild } from '../cssScheduler.js';
import { startAvatarStamping, stopAvatarStamping } from './avatarStamp.js';
import { applyThemeForActiveChar } from './themeSwitch.js';
import { applyIconSetsForActiveChar } from './iconSwitch.js';
import { applySideButtonStyleForActiveChar } from './sideButtonStyleSwitch.js';
import {
    ensureGroupAnchor,
    extendChatScope,
    observeChatAvatar,
    resetChatScope,
} from './chatScope.js';

const log = () => {};
let initialized = false;

function hasActiveChatContext() {
    const context = getContext();
    return context?.characterId != null
        || context?.groupId != null
        || Boolean(document.querySelector('#chat .mes'));
}

function injectForCurrentContext(options = {}) {
    injectChatDesignCSS({
        includeMessageStyles: hasActiveChatContext(),
        ...options,
    });
}

function applyGlobalAppearance() {
    applyThemeForActiveChar();
    void applyIconSetsForActiveChar();
    applySideButtonStyleForActiveChar();
}

function discoverCursorsForActiveDesign() {
    if (!isChatDesignEnabled()) return;
    refreshCursorDiscovery()
        .then(() => {
            if (isChatDesignEnabled()) injectForCurrentContext({ refreshMessageStyles: false });
        })
        .catch(() => {});
}

function scheduleChatDesignInjection(refreshMessageStyles) {
    if (!isChatDesignEnabled()) return;
    scheduleCSSRebuild('chatDesign', () => {
        injectForCurrentContext({ refreshMessageStyles });
    });
}

function onAvatarStamped(avatar, messageElement) {
    const { scopeChanged, anchorChanged } = observeChatAvatar(avatar, messageElement);
    if (anchorChanged) applyGlobalAppearance();
    if (scopeChanged || anchorChanged) {
        scheduleChatDesignInjection(scopeChanged);
    }
}

/**
 * Initialize Chat Design.
 * Called once from root index.js during extension startup.
 */
export function initChatDesign() {
    if (initialized) return;
    initialized = true;
    resetChatScope();
    applyGlobalAppearance();

    // The welcome screen has no message UI. Keep global choices such as cursor
    // and interface typography, but defer message CSS, chat observation, and
    // chat-font loading until a character or group chat actually opens.
    if (isChatDesignEnabled()) {
        if (hasActiveChatContext()) startAvatarStamping(onAvatarStamped);
        injectForCurrentContext();
    }

    // Cursor discovery can perform a no-cache request. Defer it entirely while
    // Chat Design is off; enabling the feature below starts the same refresh.
    discoverCursorsForActiveDesign();

    // Re-inject CSS when chat changes (character switch, new chat, etc.)
    // Batched via cssScheduler so all three CSS modules update in one frame
    eventSource.on(event_types.CHAT_CHANGED, () => {
        resetChatScope();
        if (isChatDesignEnabled()) {
            if (hasActiveChatContext()) startAvatarStamping(onAvatarStamped);
            else stopAvatarStamping();
            scheduleChatDesignInjection(true);
        }

        // Per-character UI theme switching. Deliberately OUTSIDE the
        // isChatDesignEnabled() guard: auto-theming is its own feature (driven
        // by its own assignment map + default), independent of whether the
        // Chat Design CSS overrides are enabled. Self-guards internally — no-ops
        // when nothing is assigned and no default is set. This handler only runs
        // once UIBedazzler is loaded, which is what fixes the old quick-reply's
        // boot-time "/split unknown command" race.
        applyGlobalAppearance();
    });

    if (event_types.GROUP_UPDATED) {
        eventSource.on(event_types.GROUP_UPDATED, () => {
            if (!hasActiveChatContext()) return;
            resetChatScope();
            scheduleChatDesignInjection(true);
            applyGlobalAppearance();
        });
    }

    if (event_types.PERSONA_CHANGED) {
        eventSource.on(event_types.PERSONA_CHANGED, () => {
            const scopeChanged = extendChatScope();
            scheduleChatDesignInjection(scopeChanged);
        });
    }

    if (event_types.CHARACTER_MESSAGE_RENDERED) {
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
            if (!ensureGroupAnchor()) return;
            applyGlobalAppearance();
            scheduleChatDesignInjection(false);
        });
    }

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
            setTimeout(injectForCurrentContext, 150);
        }
    });

    log('Initialized');
}

/**
 * Called when the Chat Design enable toggle changes.
 */
export function onChatDesignToggleChanged(enabled) {
    if (enabled) {
        resetChatScope();
        if (hasActiveChatContext()) startAvatarStamping(onAvatarStamped);
        injectForCurrentContext();
        discoverCursorsForActiveDesign();
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
        injectForCurrentContext();
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
