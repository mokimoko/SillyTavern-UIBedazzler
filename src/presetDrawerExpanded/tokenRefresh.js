// Restore group-chat Prompt Manager estimates when its native preset refresh
// cannot produce a dry-run. Keep the drawer-only toggle refresh separate.

import {
    eventSource, event_types, Generate, main_api,
    this_chid, characters, name2, setCharacterId, setCharacterName,
    is_send_press,
} from '../../../../../../script.js';
import { promptManager } from '../../../../../openai.js';
import { is_group_generating, selected_group } from '../../../../../group-chats.js';
import { waitUntilCondition } from '../../../../../utils.js';

const PROMPT_TOGGLE_SELECTOR = '.prompt-manager-toggle-action';
const PRESET_EVENT = event_types.PRESET_CHANGED || event_types.OAI_PRESET_CHANGED_AFTER;

const clients = new Map();
let refreshTimer = null;
let presetTimer = null;
let presetUiTimer = null;
let presetVersion = 0;
let chatRevision = 0;
let initialized = false;

function handleChatChanged() {
    chatRevision++;
    presetVersion++;
    if (presetTimer !== null) clearTimeout(presetTimer);
    if (presetUiTimer !== null) clearTimeout(presetUiTimer);
    presetTimer = null;
    presetUiTimer = null;
}

function activeRoots() {
    return [...clients.values()]
        .map(id => document.getElementById(id))
        .filter(root => root?.contains(document.getElementById('completion_prompt_manager')));
}

function refreshNativeTokenEstimates() {
    refreshTimer = null;
    if (!activeRoots().length) return;

    // Do not call renderDebounced here. The native preset-change listener has
    // already queued that same debounced function, so doing so merely resets its
    // timer and does not guarantee a second, settled recount. render() requests
    // a real dry-run from SillyTavern's Prompt Manager.
    if (typeof promptManager?.render === 'function') promptManager.render(true);
    else promptManager?.renderDebounced?.();
}

function scheduleTokenRefresh() {
    if (!clients.size) return;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshNativeTokenEstimates, 0);
}

function expandedRootOwnsPromptManager() {
    const root = document.getElementById('wl-pe-root');
    const manager = document.getElementById('completion_prompt_manager');
    return !!root?.contains(manager);
}

function scheduleExpandedPresetRender(version) {
    if (!expandedRootOwnsPromptManager()) return;
    if (presetUiTimer !== null) clearTimeout(presetUiTimer);

    // ST 1.19 observes the native drawer chosen when Prompt Manager initializes.
    // That drawer is closed behind our overlay, so its preset-change refresh is
    // deferred as "not visible" even though the relocated manager is onscreen.
    presetUiTimer = setTimeout(() => {
        presetUiTimer = null;
        if (version !== presetVersion || main_api !== 'openai' || !expandedRootOwnsPromptManager()) return;
        promptManager?.render?.(false);
    }, 0);
}

function handlePresetChanged(event) {
    if (PRESET_EVENT === event_types.PRESET_CHANGED && event?.apiId && event.apiId !== 'openai') return;
    const version = ++presetVersion;
    scheduleExpandedPresetRender(version);
    if (presetTimer !== null) clearTimeout(presetTimer);
    if (!selected_group) {
        presetTimer = null;
        return;
    }
    const groupId = selected_group;
    // PRESET_CHANGED fires after the new settings have been applied. Core's
    // later debounced render skips the dry-run when a group has no selected
    // member, leaving tokenUsage on the previous preset.
    presetTimer = setTimeout(() => {
        presetTimer = null;
        void refreshAfterPreset(version, groupId);
    }, 0);
}

async function refreshAfterPreset(version, groupId) {
    if (version !== presetVersion || main_api !== 'openai' || selected_group !== groupId || !promptManager) return;
    if (!document.getElementById('completion_prompt_manager')) return;
    if (characters[this_chid]) return; // Native Prompt Manager can preview this case.

    try {
        await waitUntilCondition(() => !is_send_press && !is_group_generating, 30000, 100);
        if (version !== presetVersion || selected_group !== groupId) return;

        // In group chats, PromptManager.tryGenerate() resolves without a
        // preview when no member is selected. Generate's dry-run path chooses
        // an enabled member and assembles the current group context.
        const chidBefore = this_chid;
        const nameBefore = name2;
        const startingChatRevision = chatRevision;
        try {
            await Generate('normal', {}, true);
        } finally {
            if (selected_group === groupId && chatRevision === startingChatRevision) {
                setCharacterId(chidBefore);
                setCharacterName(nameBefore);
            }
        }

        if (version === presetVersion && selected_group === groupId
            && chatRevision === startingChatRevision) promptManager.render(false);
    } catch (error) {
        console.warn('[UIBedazzler] Could not refresh preset token total:', error);
    }
}

function handlePromptToggle(event) {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest(PROMPT_TOGGLE_SELECTOR);
    if (!toggle || !activeRoots().some(root => root.contains(toggle))) return;

    // This document-level handler runs after Prompt Manager's list handler has
    // changed the enabled state. Request one settled native recount.
    scheduleTokenRefresh();
}

export function startTokenRefresh(client = 'expanded', rootId = 'wl-pe-root') {
    if (clients.has(client)) return;
    const firstClient = clients.size === 0;
    clients.set(client, rootId);

    if (firstClient) {
        document.addEventListener('click', handlePromptToggle);
    }

    // Opening can expose counts produced before the current preset finished
    // loading, so establish one fresh native baseline for the moved manager.
    scheduleTokenRefresh();
}

export function stopTokenRefresh(client = 'expanded') {
    if (!clients.delete(client) || clients.size) return;

    document.removeEventListener('click', handlePromptToggle);

    if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    if (presetUiTimer !== null) {
        clearTimeout(presetUiTimer);
        presetUiTimer = null;
    }
}

export function initPresetTokenRefresh() {
    if (initialized) return;
    initialized = true;
    if (PRESET_EVENT) eventSource.on(PRESET_EVENT, handlePresetChanged);
    eventSource.on(event_types.CHAT_CHANGED, handleChatChanged);
}
