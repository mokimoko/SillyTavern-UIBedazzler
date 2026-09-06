// src/sideButtons.js — Side button strip
// Floating toolbar for quick-access extension triggers.
// Detects installed extensions and creates matching buttons.
// Managed entirely by UI Bedazzler; other extensions need no changes.

import { eventSource, event_types } from '../../../../../script.js';
import { getSetting } from './settings.js';
import { openChatDesignModal } from './chatDesign/modalLoader.js';
import { openAuthorsNoteModal } from './authorsNote/index.js';
import { attachSAFlyout, destroySAFlyout } from './saFlyout.js';
import {
    attachWeatherCyclePanel,
    destroyWeatherCyclePanel,
    isWeatherCycleControlEnabled,
    toggleWeatherCyclePanel,
} from './weatherCycleAdapter.js';
import {
    isMemoryBooksJumpAvailable,
    jumpToFirstUnprocessedMessage,
} from './memoryBooksAdapter.js';
import { makeDebug } from './debug.js';
import { subscribeBodyMutations } from './bodyMutationHub.js';
import { attachSideButtonDrag } from './sideButtonDrag.js';
import {
    hasActiveChatContext,
    WEATHER_CHAT_VISIBILITY_EVENT,
} from './weatherCycleVisibility.js';

const log = makeDebug('[UIBedazzler:SideButtons]');

const CONTAINER_ID = 'bd-side-buttons';

// ── Button Registry ──────────────────────────────────────
// Order = array position = vertical stack order (top → bottom).
// detect()  → truthy when the extension is loaded and ready.
// trigger() → opens the extension's primary UI.

const BUTTON_REGISTRY = [
    {
        id: 'white-lotus',
        label: 'White Lotus',
        icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                 stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 13.5c0 1.5.5 3 1.5 3.5" opacity="0.4"/>
            <path d="M21 13.5c0 1.5-.5 3-1.5 3.5" opacity="0.4"/>
            <path d="M4.5 11c-.3 2 .3 4.5 2 6 .5.5 1.5.8 2.5.3"/>
            <path d="M19.5 11c.3 2-.3 4.5-2 6-.5.5-1.5.8-2.5.3"/>
            <path d="M7 7.5c-.6 2.5-.3 5.5 1.5 7.5.7.7 1.8 1 3.5.5"/>
            <path d="M17 7.5c.6 2.5.3 5.5-1.5 7.5-.7.7-1.8 1-3.5.5"/>
            <path d="M12 4c-2 3-3 6-3 8.5S11 16 12 16s3-1 3-3.5S14 7 12 4z"
                  fill="currentColor" fill-opacity="0.15"/>
            <circle cx="12" cy="11" r="1.2" fill="currentColor"
                    fill-opacity="0.5" stroke="none"/>
            <path d="M12 20v-4"/>
        </svg>`,
        detect: () => document.getElementById('wl-trigger-btn'),
        trigger: () => document.getElementById('wl-trigger-btn')?.click(),
        hideOriginal: '#wl-trigger-btn',
        wandMenuLabel: 'White Lotus',
    },
    {
        id: 'chat-design',
        label: 'Chat Design',
        icon: '<i class="fa-solid fa-palette"></i>',
        detect: () => true,
        trigger: () => openChatDesignModal(),
        hideOriginal: null,
        wandMenuLabel: 'Chat Design',
    },
    {
        id: 'super-agents',
        label: 'Super Agents',
        icon: '<i class="fa-solid fa-people-group"></i>',
        detect: () => window.SuperAgents,
        trigger: () => window.SuperAgents?.ui?.openModal(),
        hideOriginal: null,
        wandMenuLabel: 'SuperAgents',
    },
    {
        id: 'weather-cycle',
        label: 'Weather Cycle',
        icon: '<i class="fa-solid fa-cloud-sun"></i>',
        // Weather Cycle creates this control only after it mounts. Its inline
        // display value mirrors the extension's own "Show Weather Button"
        // setting, including changes made through /wc showbutton.
        detect: () => hasActiveChatContext() && isWeatherCycleControlEnabled(),
        trigger: () => toggleWeatherCyclePanel(),
        hideOriginal: '#st-weather-cycle-toggle',
        // Weather Cycle has no Extensions/wand-menu entry.
        wandMenuLabel: null,
    },
    {
        id: 'dynamic-events',
        label: 'Dynamic Events',
        icon: '<i class="fa-solid fa-bolt"></i>',
        detect: () => window.DynamicEvents?.ui?.openPopup,
        trigger: () => window.DynamicEvents?.ui?.openPopup(),
        hideOriginal: null,
        wandMenuLabel: 'Dynamic Events',
    },
    {
        id: 'simple-summarizer',
        label: 'Simple Summarizer',
        icon: '<i class="fa-solid fa-scroll"></i>',
        detect: () => window.Summarizer,
        trigger: () => window.Summarizer?.openModal(),
        hideOriginal: null,
        wandMenuLabel: 'Summarizer',
    },
    {
        id: 'story-manager',
        label: 'Story Manager',
        icon: '<i class="fa-solid fa-book-open"></i>',
        detect: () => window.StoryManager,
        trigger: () => window.StoryManager?.openSidebar(),
        hideOriginal: null,
        wandMenuLabel: 'Story Manager',
    },
    {
        id: 'scenario-crafter',
        label: 'Scenario Crafter',
        icon: '<i class="fa-solid fa-wand-magic-sparkles"></i>',
        detect: () => window.ScenarioCrafter,
        trigger: () => window.ScenarioCrafter?.openModal(),
        hideOriginal: null,
        wandMenuLabel: 'Scenario Crafter',
    },
    {
        id: 'audio-library',
        label: 'Audio Library',
        icon: '<i class="fa-solid fa-headphones-simple"></i>',
        detect: () => document.getElementById('audio_open_modal_btn'),
        trigger: () => document.getElementById('audio_open_modal_btn')?.click(),
        hideOriginal: null,
        wandMenuLabel: 'Audio Library',
    },
    {
        id: 'st-copilot',
        label: 'ST-Copilot',
        icon: '<i class="fa-solid fa-robot"></i>',
        detect: () => document.getElementById('scp-dock-icon'),
        trigger: () => document.getElementById('scp-wand-btn')?.click(),
        hideOriginal: '#scp-dock-icon',
        // No wandMenuLabel — Copilot's wand menu entry stays visible
    },
    {
        id: 'authors-note',
        label: 'Author\'s Note',
        icon: '<i class="fa-solid fa-note-sticky"></i>',
        // Native Author's Note is always present in ST, so always show.
        detect: () => true,
        trigger: () => openAuthorsNoteModal(),
        // Leave the native AN link (send-form menu) alone.
        hideOriginal: null,
        // No wandMenuLabel — AN's native entry is the send-form link, not a
        // wand-menu item, so there's nothing to hide there.
    },
    {
        id: 'memory-books-jump',
        label: 'Memory Books: Jump to first unprocessed message',
        icon: '<i class="fa-solid fa-angles-up"></i>',
        // Memory Books creates or removes this control according to its own
        // Memory boundary indicator setting. Keep that setting authoritative.
        detect: () => isMemoryBooksJumpAvailable(),
        trigger: () => jumpToFirstUnprocessedMessage(),
        hideOriginal: '#stmb-memory-boundary-jump',
        // This navigation action does not replace Memory Books' full settings
        // entry in the Extensions menu.
        wandMenuLabel: null,
    },
];

let isActive = false;
let observers = [];
let detachSideButtonDrag = null;

// Startup reconciliation state. Extensions boot on their own async schedules
// (each exposes its global / DOM trigger whenever it finishes), so a single
// timed build inevitably races some of them — that's the "only ~5 buttons
// until I toggle off/on" bug. Re-detect with widening delays through the
// startup window, then keep a cheap DOM observer for later trigger changes.
let startupPollTimer = null;
let startupPollIndex = 0;
let detectedSignature = '';
let lateExtensionScanFrame = null;
let chatVisibilityListenerInstalled = false;
const STARTUP_POLL_DELAYS = [250, 500, 1000, 2000, 4000, 8000, 16000, 30000];
const EXTENSION_TRIGGER_SELECTOR = '#wl-trigger-btn, #st-weather-cycle-toggle, #stmb-memory-boundary-jump, #audio_open_modal_btn, #scp-dock-icon, #extensionsMenu';

/** Return a stable key for the registry entries currently available. */
function getDetectedSignature() {
    const ids = [];
    for (const def of BUTTON_REGISTRY) {
        try {
            if (def.detect()) ids.push(def.id);
        } catch { /* detect() may touch not-yet-ready globals */ }
    }
    return ids.join('|');
}

function queueLateExtensionScan() {
    if (lateExtensionScanFrame !== null) return;
    lateExtensionScanFrame = requestAnimationFrame(() => {
        lateExtensionScanFrame = null;
        if (!isActive) return;
        const nextSignature = getDetectedSignature();
        if (nextSignature !== detectedSignature) buildButtonStrip();
    });
}

function mutationTouchesExtensionTriggers(mutation) {
    if (mutation.target?.closest?.('#chat')) return false;
    for (const node of [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])]) {
        if (node?.nodeType !== 1) continue;
        if (node.matches?.(EXTENSION_TRIGGER_SELECTOR)
            || node.querySelector?.(EXTENSION_TRIGGER_SELECTOR)) return true;
    }
    return false;
}

/**
 * Build now, then re-check with exponential-ish backoff for about one minute.
 * This still catches slow global-only extensions without waking twice a second
 * for the entire startup window. Idempotent; replaces any in-flight schedule.
 */
function scheduleStartupBuilds() {
    if (startupPollTimer) {
        clearTimeout(startupPollTimer);
        startupPollTimer = null;
    }
    if (!isActive) return;

    buildButtonStrip();
    startupPollIndex = 0;

    const scan = () => {
        startupPollTimer = null;
        if (!isActive) return;
        const nextSignature = getDetectedSignature();
        if (nextSignature !== detectedSignature) buildButtonStrip();
        if (startupPollIndex >= STARTUP_POLL_DELAYS.length) return;
        startupPollTimer = setTimeout(scan, STARTUP_POLL_DELAYS[startupPollIndex++]);
    };
    startupPollTimer = setTimeout(scan, STARTUP_POLL_DELAYS[startupPollIndex++]);
}

// ── Build / Destroy ──────────────────────────────────────

function buildButtonStrip() {
    destroy();
    if (!isActive) return;

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    const dragHandles = ['top', 'bottom'].map(edge => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = `bd-side-buttons-drag-handle bd-side-buttons-drag-handle-${edge}`;
        handle.title = 'Drag side buttons · Double-click to reset position';
        handle.setAttribute('aria-label', handle.title);
        handle.innerHTML = '<i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>';
        container.appendChild(handle);
        return handle;
    });
    const scroller = document.createElement('div');
    scroller.className = 'bd-side-buttons-scroll';
    container.appendChild(scroller);

    let count = 0;
    let weatherButton = null;

    for (const def of BUTTON_REGISTRY) {
        if (!def.detect()) continue;

        const btn = document.createElement('div');
        btn.className = 'bd-side-btn';
        btn.dataset.id = def.id;
        btn.title = def.label;
        btn.innerHTML = def.icon;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            def.trigger();
        });

        scroller.appendChild(btn);
        count++;

        // Hide extension's own floating trigger when we provide one
        if (def.hideOriginal) {
            const orig = document.querySelector(def.hideOriginal);
            if (orig) orig.classList.add('bd-side-btn-hidden');
        }

        // Mirror White Lotus preset-active indicator
        if (def.id === 'white-lotus') {
            mirrorWLActiveState(btn);
        }

        // Super Agents: hovering the button reveals a quick enable/disable
        // flyout (groups + per-agent icon toggles). Clicking still opens the
        // full manager via def.trigger().
        if (def.id === 'super-agents') {
            attachSAFlyout(btn);
        }

        // Weather Cycle: retain its own panel and event handlers, but anchor
        // that panel to the left of our replacement side button.
        if (def.id === 'weather-cycle') {
            weatherButton = btn;
        }
    }

    if (count > 0) {
        document.body.appendChild(container);
        detachSideButtonDrag = attachSideButtonDrag(container, dragHandles);
        // The anchor must be mounted before the adapter measures its viewport
        // rect. This matters when the strip rebuilds while the panel is open.
        if (weatherButton) attachWeatherCyclePanel(weatherButton);
        log(`Built strip: ${count} button(s)`);
    }

    detectedSignature = getDetectedSignature();

    // Hide redundant wand menu entries + watch for late additions
    hideWandMenuItems();
    observeWandMenu();
    observeLateExtensions();
    observeWeatherCycleSetting();
}

/**
 * Observe the original WL trigger's .wl-active class
 * and mirror it onto the side button for visual parity.
 */
function mirrorWLActiveState(sideBtn) {
    const orig = document.getElementById('wl-trigger-btn');
    if (!orig) return;

    const sync = () => {
        sideBtn.classList.toggle('bd-side-btn-active',
            orig.classList.contains('wl-active'));
    };
    sync();

    const obs = new MutationObserver(sync);
    obs.observe(orig, { attributes: true, attributeFilter: ['class'] });
    observers.push(obs);
}

// ── Wand Menu (Extensions Menu) Management ───────────────
// When side buttons are active, hide redundant wand menu entries
// for our own extensions. Copilot (no wandMenuLabel) stays visible.

/**
 * Collect the labels we should hide from the wand menu —
 * only for registry entries that are actually detected AND have a label.
 */
function getWandLabelsToHide() {
    return BUTTON_REGISTRY
        .filter(def => def.wandMenuLabel && def.detect())
        .map(def => def.wandMenuLabel.toLowerCase());
}

/**
 * Scan #extensionsMenu for items matching our extensions and hide them.
 */
function hideWandMenuItems() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;

    const labels = getWandLabelsToHide();
    if (!labels.length) return;

    menu.querySelectorAll('.list-group-item').forEach(item => {
        const text = item.textContent.trim().toLowerCase();
        if (labels.some(label => text.includes(label))) {
            item.classList.add('bd-wand-hidden');
        }
    });
}

/**
 * Restore all hidden wand menu entries.
 */
function showWandMenuItems() {
    document.querySelectorAll('.bd-wand-hidden').forEach(el => {
        el.classList.remove('bd-wand-hidden');
    });
}

/**
 * Watch #extensionsMenu for late-added items (extensions that
 * register their wand entry after side buttons are already built).
 */
function observeWandMenu() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;

    const obs = new MutationObserver(() => {
        if (!isActive) return;
        hideWandMenuItems();
        queueLateExtensionScan();
    });
    obs.observe(menu, { childList: true });
    observers.push(obs);
}

/**
 * Keep the strip in sync with extensions that add or replace DOM triggers
 * after the startup poll. Ignore ordinary chat/profile redraws and coalesce a
 * relevant burst into one animation-frame scan.
 */
function observeLateExtensions() {
    if (!document.body) return;

    const obs = subscribeBodyMutations((mutations) => {
        if (!isActive || !mutations.some(mutationTouchesExtensionTriggers)) return;
        queueLateExtensionScan();
    });
    observers.push(obs);
}

/**
 * Weather Cycle keeps its settings in localStorage and reflects the
 * showWeatherButton value through the native toggle's inline display style.
 * Observe that one attribute so both its settings checkbox and slash command
 * add/remove our replacement button immediately.
 */
function observeWeatherCycleSetting() {
    const toggle = document.getElementById('st-weather-cycle-toggle');
    if (!toggle) return;

    const obs = new MutationObserver(queueLateExtensionScan);
    obs.observe(toggle, { attributes: true, attributeFilter: ['style'] });
    observers.push(obs);
}

function destroy() {
    // Do not clear startupPollTimer here: buildButtonStrip() calls destroy()
    // during normal refreshes and the startup scan must survive those rebuilds.
    detachSideButtonDrag?.();
    detachSideButtonDrag = null;
    const container = document.getElementById(CONTAINER_ID);
    if (container) container.remove();

    // Tear down the Super Agents hover flyout (panel + timers)
    destroySAFlyout();
    destroyWeatherCyclePanel();

    // Restore any hidden original triggers
    document.querySelectorAll('.bd-side-btn-hidden').forEach(el => {
        el.classList.remove('bd-side-btn-hidden');
    });

    // Restore hidden wand menu entries
    showWandMenuItems();

    // Tear down observers
    observers.forEach(obs => obs.disconnect());
    observers = [];
    if (lateExtensionScanFrame !== null) {
        cancelAnimationFrame(lateExtensionScanFrame);
        lateExtensionScanFrame = null;
    }
}

// ── Public API ───────────────────────────────────────────

/**
 * Handle the settings toggle for side buttons.
 */
export function onSideButtonsToggleChanged(enabled) {
    isActive = enabled;
    if (enabled) {
        scheduleStartupBuilds();
    } else {
        if (startupPollTimer) {
            clearTimeout(startupPollTimer);
            startupPollTimer = null;
        }
        destroy();
    }
}

/**
 * Initialise the side button system.
 * Builds immediately and restarts its reconciliation window at APP_READY.
 */
export function initSideButtons() {
    if (!chatVisibilityListenerInstalled) {
        window.addEventListener(WEATHER_CHAT_VISIBILITY_EVENT, queueLateExtensionScan);
        chatVisibilityListenerInstalled = true;
    }

    isActive = !!getSetting('sideButtons');
    if (!isActive) return;

    // Start immediately. This also covers hosts where APP_READY fired before
    // this extension's jQuery callback had a chance to attach its listener.
    scheduleStartupBuilds();

    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, () => {
            // Restart the full startup window after APP_READY because other
            // extensions may begin or continue async initialization from it.
            setTimeout(() => { if (isActive) scheduleStartupBuilds(); }, 300);
        });
    } else {
        setTimeout(() => { if (isActive) scheduleStartupBuilds(); }, 3000);
    }
}
