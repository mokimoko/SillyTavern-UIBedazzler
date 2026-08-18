// src/charDrawer/drawerUI.js
// Character drawer takeover — replaces Advanced Definitions with tabbed layout via DOM relocation
// Tabs: Character Info | Design | Prompts | Metadata
//
// Same proven pattern as personaLore/drawerUI.js:
// - Relocate, don't clone (preserves all event handlers, token counters, expand buttons)
// - Hide originals, move elements into new container
// - Restore everything cleanly when toggled off

import { renderDesignTab } from './designTab.js';

const log = () => {};

let isActive = false;
let relocatedElements = [];

// ============================================================
// Takeover
// ============================================================

/**
 * Take over the Advanced Definitions popup with a tabbed layout.
 * Relocates ST's existing DOM elements into 4 tabs:
 *   Character Info | Design | Prompts | Metadata
 */
export function takeoverDrawer() {
    // COEXISTENCE GUARD: while the Expanded Character Drawer overlay is open,
    // it owns #character_popup's fields (it relocates them into its own
    // panes). Do not take over — this is the single choke point guarding
    // every entry path (MutationObserver, applyIfPopupOpen, future callers).
    // The body class is set synchronously by the expanded takeover, so even
    // the observer microtask fired by restoreDrawer() removing wl-cd-active
    // during an expanded open sees it and no-ops.
    if (document.body.classList.contains('wl-xd-open')) return;

    const popup = document.getElementById('character_popup');
    if (!popup || isActive) return;
    if (document.getElementById('wl-cd-container')) return;

    // --- Curtain down: hide popup content before DOM manipulation ---
    const originalVisibility = popup.style.visibility;
    popup.style.visibility = 'hidden';

    // --- Identify all sections to relocate ---

    const inlineDrawers = popup.querySelectorAll(':scope > .inline-drawer');
    const promptOverridesDrawer = inlineDrawers[0] || null;
    const creatorMetadataDrawer = inlineDrawers[1] || null;

    const hrElements = popup.querySelectorAll(':scope > hr');

    const personalityDiv = popup.querySelector('#personality_div');
    const scenarioDiv = popup.querySelector('#scenario_div');
    const depthPromptDiv = popup.querySelector('#depth_prompt_div');
    const talkativenessDiv = popup.querySelector('#talkativeness_div');
    const mesExampleDiv = popup.querySelector('#mes_example_div');
    const saveButton = popup.querySelector('#character_popup_ok');

    if (!personalityDiv || !scenarioDiv) {
        log('Could not find required character popup elements — aborting takeover');
        // Lift the curtain on abort — the popup was hidden above and would
        // otherwise stay invisible (latent bug: more abort paths are reachable
        // now that the expanded drawer can be holding these fields).
        popup.style.visibility = originalVisibility;
        return;
    }

    // Build the WL container
    const container = document.createElement('div');
    container.id = 'wl-cd-container';
    container.innerHTML = `
        <div id="wl-cd-tab-bar">
            <button class="wl-cd-tab active" data-tab="char-info">
                <i class="fa-solid fa-user"></i>
                <span>Character Info</span>
            </button>
            <button class="wl-cd-tab" data-tab="design">
                <i class="fa-solid fa-palette"></i>
                <span>Design</span>
            </button>
            <button class="wl-cd-tab" data-tab="prompts">
                <i class="fa-solid fa-terminal"></i>
                <span>Prompts</span>
            </button>
            <button class="wl-cd-tab" data-tab="metadata">
                <i class="fa-solid fa-info-circle"></i>
                <span>Metadata</span>
            </button>
        </div>
        <div id="wl-cd-tab-content">
            <div class="wl-cd-tab-pane active" data-tab="char-info"></div>
            <div class="wl-cd-tab-pane" data-tab="design"></div>
            <div class="wl-cd-tab-pane" data-tab="prompts"></div>
            <div class="wl-cd-tab-pane" data-tab="metadata"></div>
        </div>
    `;

    // Insert container before the save button
    if (saveButton) {
        popup.insertBefore(container, saveButton);
    } else {
        popup.appendChild(container);
    }

    relocatedElements = [];

    // --- Character Info tab ---
    const charInfoPane = container.querySelector('.wl-cd-tab-pane[data-tab="char-info"]');
    relocate(personalityDiv, charInfoPane);
    relocate(scenarioDiv, charInfoPane);
    relocate(mesExampleDiv, charInfoPane);

    // --- Prompts tab ---
    const promptsPane = container.querySelector('.wl-cd-tab-pane[data-tab="prompts"]');
    if (promptOverridesDrawer) {
        const drawerContent = promptOverridesDrawer.querySelector('.inline-drawer-content');
        setStyle(drawerContent, 'display', '');
        const drawerHeader = promptOverridesDrawer.querySelector('.inline-drawer-header');
        setStyle(drawerHeader, 'display', 'none');
        relocate(promptOverridesDrawer, promptsPane);
    }
    relocate(depthPromptDiv, promptsPane);

    // --- Metadata tab ---
    const metadataPane = container.querySelector('.wl-cd-tab-pane[data-tab="metadata"]');
    if (creatorMetadataDrawer) {
        const drawerContent = creatorMetadataDrawer.querySelector('.inline-drawer-content');
        setStyle(drawerContent, 'display', '');
        const drawerHeader = creatorMetadataDrawer.querySelector('.inline-drawer-header');
        setStyle(drawerHeader, 'display', 'none');
        relocate(creatorMetadataDrawer, metadataPane);
    }
    relocate(talkativenessDiv, metadataPane);

    // --- Hide orphaned HR separators ---
    hrElements.forEach(hr => {
        setStyle(hr, 'display', 'none');
    });

    // --- Wire up tab switching ---
    container.querySelectorAll('.wl-cd-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Mark popup as taken over for CSS targeting
    popup.classList.add('wl-cd-active');

    isActive = true;

    // --- Curtain up: reveal after DOM work is complete ---
    requestAnimationFrame(() => {
        popup.style.visibility = originalVisibility;
    });

    log('Drawer takeover applied');
}

/**
 * Relocate a DOM element into a new parent, tracking for restore.
 */
function relocate(element, newParent) {
    if (!element || !newParent) return;
    const originalParent = element.parentElement;
    const originalNext = element.nextElementSibling;
    relocatedElements.push({ element, originalParent, originalNext });
    newParent.appendChild(element);
}

/** Change one inline style while preserving its exact original value. */
function setStyle(element, style, value) {
    if (!element) return;
    relocatedElements.push({ element, style, original: element.style[style] });
    element.style[style] = value;
}

// ============================================================
// Tab Switching
// ============================================================

/**
 * Switch to a tab by name.
 * @param {string} tabName - 'char-info', 'design', 'prompts', or 'metadata'
 */
function switchTab(tabName) {
    const container = document.getElementById('wl-cd-container');
    if (!container) return;

    container.querySelectorAll('.wl-cd-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    container.querySelectorAll('.wl-cd-tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.dataset.tab === tabName);
    });

    // Render design tab content when switching to it
    if (tabName === 'design') {
        const designPane = container.querySelector('.wl-cd-tab-pane[data-tab="design"]');
        if (designPane) renderDesignTab(designPane);
    }
}

/**
 * Get the active tab name.
 * @returns {string}
 */
export function getActiveTab() {
    const activeTab = document.querySelector('#wl-cd-container .wl-cd-tab.active');
    return activeTab?.dataset.tab || 'char-info';
}

// ============================================================
// Restore
// ============================================================

/**
 * Restore the Advanced Definitions popup to its original state.
 */
export function restoreDrawer() {
    if (!isActive) return;

    const popup = document.getElementById('character_popup');
    const container = document.getElementById('wl-cd-container');

    // Restore in reverse order so sibling anchors and nested style changes are
    // resolved after their containing drawers return home. This also recovers
    // correctly when authored chrome was removed by another extension.
    for (let i = relocatedElements.length - 1; i >= 0; i--) {
        const record = relocatedElements[i];
        if (record.originalParent) {
            if (record.originalNext && record.originalNext.parentElement === record.originalParent) {
                record.originalParent.insertBefore(record.element, record.originalNext);
            } else {
                record.originalParent.appendChild(record.element);
            }
        } else if (record.style) {
            record.element.style[record.style] = record.original;
        }
    }

    popup?.classList.remove('wl-cd-active');
    container?.remove();

    relocatedElements = [];
    isActive = false;
    log('Drawer restored to original state');
}

/**
 * Check if takeover is currently active.
 * @returns {boolean}
 */
export function isTakeoverActive() {
    return isActive;
}
