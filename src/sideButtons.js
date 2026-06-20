// src/sideButtons.js — Side button strip
// Floating toolbar for quick-access extension triggers.
// Detects installed extensions and creates matching buttons.
// Managed entirely by UI Bedazzler; other extensions need no changes.

import { eventSource, event_types } from '../../../../../script.js';
import { getSetting } from './settings.js';
import { openChatDesignModal } from './chatDesign/modal.js';
import { attachSAFlyout, destroySAFlyout } from './saFlyout.js';

const log = (...args) => console.log('[UIBedazzler:SideButtons]', ...args);

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
];

let isActive = false;
let observers = [];

// ── Build / Destroy ──────────────────────────────────────

function buildButtonStrip() {
    destroy();
    if (!isActive) return;

    const container = document.createElement('div');
    container.id = CONTAINER_ID;

    let count = 0;

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

        container.appendChild(btn);
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
    }

    if (count > 0) {
        document.body.appendChild(container);
        log(`Built strip: ${count} button(s)`);
    }

    // Hide redundant wand menu entries + watch for late additions
    hideWandMenuItems();
    observeWandMenu();
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
        if (isActive) hideWandMenuItems();
    });
    obs.observe(menu, { childList: true });
    observers.push(obs);
}

function destroy() {
    const container = document.getElementById(CONTAINER_ID);
    if (container) container.remove();

    // Tear down the Super Agents hover flyout (panel + timers)
    destroySAFlyout();

    // Restore any hidden original triggers
    document.querySelectorAll('.bd-side-btn-hidden').forEach(el => {
        el.classList.remove('bd-side-btn-hidden');
    });

    // Restore hidden wand menu entries
    showWandMenuItems();

    // Tear down observers
    observers.forEach(obs => obs.disconnect());
    observers = [];
}

// ── Public API ───────────────────────────────────────────

/**
 * Handle the settings toggle for side buttons.
 */
export function onSideButtonsToggleChanged(enabled) {
    isActive = enabled;
    if (enabled) {
        buildButtonStrip();
    } else {
        destroy();
    }
}

/**
 * Initialise the side button system.
 * Registers an APP_READY listener so buttons are built only after
 * every extension has finished loading (and exposed its globals).
 */
export function initSideButtons() {
    isActive = !!getSetting('sideButtons');
    if (!isActive) return;

    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, () => {
            setTimeout(() => { if (isActive) buildButtonStrip(); }, 300);
        });
    } else {
        // Fallback when APP_READY isn't available
        setTimeout(() => { if (isActive) buildButtonStrip(); }, 3000);
    }
}
