// Keep Weather Cycle's floating UI scoped to an active chat. The third-party
// extension still owns its settings and visibility choices inside that scope.

import { eventSource, event_types } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { subscribeBodyMutations } from './bodyMutationHub.js';

const NO_CHAT_CLASS = 'bd-weather-cycle-no-chat';
export const WEATHER_CHAT_VISIBILITY_EVENT = 'UIBEDAZZLER_WEATHER_CHAT_VISIBILITY_CHANGED';

let initialized = false;
let lastHasActiveChat = null;
let syncFrame = null;

export function hasActiveChatContext() {
    if (document.querySelector('#chat > .welcomePanel')) return false;
    if (document.querySelector('#chat .mes')) return true;

    const context = getContext();
    return context?.groupId != null
        || (context?.menuType === 'character_edit' && context?.characterId != null);
}

function closeOpenWeatherPanel() {
    const panel = document.getElementById('st-weather-cycle-panel');
    if (!panel || panel.style.display === 'none') return;
    document.getElementById('st-weather-cycle-toggle')?.click();
}

export function syncWeatherCycleChatVisibility() {
    const hasActiveChat = hasActiveChatContext();
    if (!hasActiveChat) closeOpenWeatherPanel();
    document.body?.classList.toggle(NO_CHAT_CLASS, !hasActiveChat);

    if (hasActiveChat !== lastHasActiveChat) {
        lastHasActiveChat = hasActiveChat;
        window.dispatchEvent(new CustomEvent(WEATHER_CHAT_VISIBILITY_EVENT, {
            detail: { hasActiveChat },
        }));
    }
    return hasActiveChat;
}

function queueVisibilitySync() {
    if (syncFrame !== null) return;
    syncFrame = requestAnimationFrame(() => {
        syncFrame = null;
        syncWeatherCycleChatVisibility();
    });
}

function mutationTouchesChatSurface(mutation) {
    const targetInChat = mutation.target?.id === 'chat' || mutation.target?.closest?.('#chat');
    if (!targetInChat) return false;
    return [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])].some(node =>
        node?.nodeType === 1
        && (node.matches?.('.welcomePanel, .mes') || node.querySelector?.('.welcomePanel, .mes')),
    );
}

export function initWeatherCycleVisibility() {
    if (initialized) return;
    initialized = true;

    syncWeatherCycleChatVisibility();
    eventSource.on(event_types.CHAT_CHANGED, queueVisibilitySync);
    subscribeBodyMutations((mutations) => {
        if (mutations.some(mutationTouchesChatSurface)) queueVisibilitySync();
    });
}
