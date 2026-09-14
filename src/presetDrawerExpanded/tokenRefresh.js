// Keeps SillyTavern's native Prompt Manager token estimates current while its
// DOM is relocated into the expanded drawer. Prompt Manager still owns the
// dry-run/tokenization; this module only asks it for a fresh pass.

import { eventSource, event_types } from '../../../../../../script.js';
import { promptManager } from '../../../../../openai.js';

const ROOT_ID = 'wl-pe-root';
const PROMPT_TOGGLE_SELECTOR = '.prompt-manager-toggle-action';

let active = false;
let refreshTimer = null;

function refreshNativeTokenEstimates() {
    refreshTimer = null;
    if (!active) return;

    // Do not call renderDebounced here. The native preset-change listener has
    // already queued that same debounced function, so doing so merely resets its
    // timer and does not guarantee a second, settled recount. render() requests
    // a real dry-run; current TauriTavern coalesces overlapping dry-runs itself.
    if (typeof promptManager?.render === 'function') promptManager.render(true);
    else promptManager?.renderDebounced?.();
}

function scheduleTokenRefresh() {
    if (!active) return;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshNativeTokenEstimates, 0);
}

function handlePromptToggle(event) {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest(PROMPT_TOGGLE_SELECTOR);
    const root = document.getElementById(ROOT_ID);
    if (!toggle || !root?.contains(toggle)) return;

    // This document-level handler runs after Prompt Manager's list handler has
    // changed the enabled state. Request one settled native recount.
    scheduleTokenRefresh();
}

export function startTokenRefresh() {
    if (active) return;
    active = true;

    if (event_types.OAI_PRESET_CHANGED_AFTER) {
        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, scheduleTokenRefresh);
    }
    document.addEventListener('click', handlePromptToggle);

    // Opening can expose counts produced before the current preset finished
    // loading, so establish one fresh native baseline for the moved manager.
    scheduleTokenRefresh();
}

export function stopTokenRefresh() {
    if (!active) return;
    active = false;

    if (event_types.OAI_PRESET_CHANGED_AFTER) {
        eventSource.removeListener(event_types.OAI_PRESET_CHANGED_AFTER, scheduleTokenRefresh);
    }
    document.removeEventListener('click', handlePromptToggle);

    if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
}
