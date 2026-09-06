// src/personaLore/drawerUI.js
// Persona drawer takeover — replaces right column with tabbed layout via DOM relocation
// Tabs: Description | Narrator Lore | Advanced

import { renderLoreTab } from './loreUI.js';
import { renderDesignTab } from './designTab.js';
import {
    isAspectEvolutiaAvailable,
    mountAspectEvolutiaIntegration,
    restoreAspectEvolutiaIntegration,
} from './aspectEvolutia.js';

const log = () => {};

// Track relocated elements so we can restore them
let originalParent = null;
let isActive = false;
let tabBarResizeHandler = null;
let tabScrollHoldCleanup = null;

/**
 * Take over the persona drawer right column.
 * Relocates ST's existing DOM elements into a tabbed layout.
 */
export function takeoverDrawer() {
    const rightCol = document.querySelector('.persona_management_right_column');
    if (!rightCol || isActive) return;

    // Extra safety — don't duplicate if container already exists
    if (document.getElementById('wl-pl-container')) return;

    // --- Curtain down: hide drawer content before DOM manipulation ---
    const drawerBlock = document.getElementById('PersonaManagement');
    let curtainApplied = false;
    if (drawerBlock) {
        drawerBlock.style.visibility = 'hidden';
        curtainApplied = true;
    }

    originalParent = rightCol;

    // Grab references to the sections we'll relocate
    const currentPersona = rightCol.querySelector('.persona_management_current_persona');
    const globalSettings = rightCol.querySelector('.persona_management_global_settings');
    if (!currentPersona) {
        log('Could not find .persona_management_current_persona — aborting takeover');
        return;
    }

    // --- Identify the blocks we'll move ---

    // Persona name + control buttons (top bar — always visible)
    const personaControls = currentPersona.querySelector('#persona_controls');

    // Description block: header, textarea, token count
    const descHeader = currentPersona.querySelector('h4:has(.editor_maximize)') ||
        [...currentPersona.querySelectorAll('h4')].find(h => h.textContent.includes('Persona Description'));
    const descTextarea = currentPersona.querySelector('#persona_description');

    // Token count row
    const tokenRow = currentPersona.querySelector('.extension_token_counter')?.closest('.flex-container');

    // Position settings block
    const positionHeader = [...currentPersona.querySelectorAll('h4')].find(h => h.textContent.includes('Position'));
    const positionContainer = currentPersona.querySelector('.persona_management_description_position_container');
    const depthSettings = currentPersona.querySelector('#persona_depth_position_settings');

    // Connections block
    const connectionsHeader = [...currentPersona.querySelectorAll('h4')].find(h => h.textContent.includes('Connections'));
    const connectionsButtons = currentPersona.querySelector('#persona_connections_buttons');
    const connectionsInfoBlock = currentPersona.querySelector('#persona_connections_info_block');
    const connectionsList = currentPersona.querySelector('#persona_connections_list');

    const showIntegrations = isAspectEvolutiaAvailable();
    const integrationsTab = showIntegrations
        ? '<button class="wl-pl-tab" data-tab="integrations"><i class="fa-solid fa-plug"></i><span>Integrations</span></button>'
        : '';
    const integrationsPane = showIntegrations
        ? '<div class="wl-pl-tab-pane" data-tab="integrations"></div>'
        : '';

    // --- Build our replacement layout ---

    // Hide original content blocks (don't remove — keeps event handlers alive)
    currentPersona.style.display = 'none';
    if (globalSettings) globalSettings.style.display = 'none';

    // Create the WL takeover container
    const container = document.createElement('div');
    container.id = 'wl-pl-container';
    container.innerHTML = `
        <div id="wl-pl-top-bar"></div>
        <div id="wl-pl-tab-strip">
            <button type="button" class="wl-pl-tab-scroll wl-pl-tab-scroll-left" title="Scroll tabs left" aria-label="Scroll tabs left">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <div id="wl-pl-tab-bar">
                <button class="wl-pl-tab active" data-tab="description">Description</button>
                <button class="wl-pl-tab" data-tab="narrator-lore">Narrator Lore<span id="wl-pl-lore-badge" class="wl-pl-badge" style="display:none;"></span></button>
                <button class="wl-pl-tab" data-tab="design">
                    <i class="fa-solid fa-palette"></i>
                    Design
                </button>
                <button class="wl-pl-tab" data-tab="advanced">Advanced</button>
                ${integrationsTab}
            </div>
            <button type="button" class="wl-pl-tab-scroll wl-pl-tab-scroll-right" title="Scroll tabs right" aria-label="Scroll tabs right">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div id="wl-pl-tab-content">
            <div class="wl-pl-tab-pane active" data-tab="description"></div>
            <div class="wl-pl-tab-pane" data-tab="narrator-lore"></div>
            <div class="wl-pl-tab-pane" data-tab="design"></div>
            <div class="wl-pl-tab-pane" data-tab="advanced" id="wl-pl-advanced-content"></div>
            ${integrationsPane}
        </div>
    `;

    // Insert container into right column
    rightCol.appendChild(container);

    // Capture A:E's native parent before relocating the Description editor.
    mountAspectEvolutiaIntegration(container, descTextarea);

    // Add class to parent block for CSS targeting
    const parentBlock = rightCol.closest('#persona-management-block');
    if (parentBlock) parentBlock.classList.add('wl-pl-active');

    // --- Relocate DOM elements ---

    // Top bar: persona name + buttons
    const topBar = container.querySelector('#wl-pl-top-bar');
    if (personaControls) topBar.appendChild(personaControls);

    // Description tab: header + textarea + token count
    const descPane = container.querySelector('.wl-pl-tab-pane[data-tab="description"]');
    if (descHeader) descPane.appendChild(descHeader);
    if (descTextarea) descPane.appendChild(descTextarea);
    if (tokenRow) descPane.appendChild(tokenRow);

    // Advanced tab: position, connections, global settings
    const advContent = container.querySelector('#wl-pl-advanced-content');

    if (positionHeader) advContent.appendChild(positionHeader);
    if (positionContainer) advContent.appendChild(positionContainer);
    if (depthSettings) advContent.appendChild(depthSettings);

    if (connectionsHeader) advContent.appendChild(connectionsHeader);
    if (connectionsButtons) advContent.appendChild(connectionsButtons);
    if (connectionsInfoBlock) advContent.appendChild(connectionsInfoBlock);
    if (connectionsList) advContent.appendChild(connectionsList);

    if (globalSettings) {
        globalSettings.style.display = '';
        advContent.appendChild(globalSettings);
    }

    wireTabNavigation(container);

    isActive = true;

    // --- Curtain up: reveal after DOM work is complete ---
    if (curtainApplied) {
        requestAnimationFrame(() => {
            drawerBlock.style.visibility = '';
        });
    }

    log('Drawer takeover applied');
}

function wireTabNavigation(root) {
    const tabStrip = root.querySelector('#wl-pl-tab-strip');
    const tabBar = root.querySelector('#wl-pl-tab-bar');
    const tabScrollLeft = root.querySelector('.wl-pl-tab-scroll-left');
    const tabScrollRight = root.querySelector('.wl-pl-tab-scroll-right');
    const tabs = [...root.querySelectorAll('.wl-pl-tab')];

    const revealTab = tab => {
        if (!tabBar || !tab) return;
        const barRect = tabBar.getBoundingClientRect();
        const tabRect = tab.getBoundingClientRect();
        const edgePadding = 8;

        if (tabRect.left < barRect.left + edgePadding) {
            tabBar.scrollBy({ left: tabRect.left - barRect.left - edgePadding, behavior: 'smooth' });
        } else if (tabRect.right > barRect.right - edgePadding) {
            tabBar.scrollBy({ left: tabRect.right - barRect.right + edgePadding, behavior: 'smooth' });
        }
    };

    if (tabBar) {
        tabBar.setAttribute('role', 'tablist');
        tabBar.addEventListener('wheel', event => {
            if (tabBar.scrollWidth <= tabBar.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
            event.preventDefault();
            tabBar.scrollLeft += event.deltaY;
        }, { passive: false });

        const updateScrollControls = () => {
            const overflowing = tabBar.scrollWidth > tabBar.clientWidth + 1;
            const atStart = tabBar.scrollLeft <= 1;
            const atEnd = tabBar.scrollLeft + tabBar.clientWidth >= tabBar.scrollWidth - 1;
            tabStrip?.classList.toggle('wl-pl-tab-overflow', overflowing);
            if (tabScrollLeft) tabScrollLeft.disabled = !overflowing || atStart;
            if (tabScrollRight) tabScrollRight.disabled = !overflowing || atEnd;
        };

        const scrollByPage = direction => {
            tabBar.scrollBy({
                left: direction * Math.max(120, tabBar.clientWidth * .55),
                behavior: 'smooth',
            });
        };

        // Keep ArrowLeft/ArrowRight inside the open Persona Drawer instead of
        // letting ST's document-level handler turn them into chat swipes.
        // Editable controls retain native caret/selection behavior; elsewhere
        // the keys pan this tab strip just like the visible edge buttons.
        const handleDrawerArrow = (event, shouldScroll) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            if (event.target instanceof Element && event.target.closest('.wl-pl-tab')) return;

            event.stopPropagation();
            event.stopImmediatePropagation();

            const editing = event.target instanceof Element && Boolean(event.target.closest(
                'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
            ));
            if (editing) return;

            event.preventDefault();
            if (shouldScroll) scrollByPage(event.key === 'ArrowLeft' ? -1 : 1);
        };
        root.addEventListener('keydown', event => handleDrawerArrow(event, true));
        root.addEventListener('keyup', event => handleDrawerArrow(event, false));

        let holdDelay = null;
        let holdInterval = null;
        const stopHeldScroll = () => {
            clearTimeout(holdDelay);
            clearInterval(holdInterval);
            holdDelay = null;
            holdInterval = null;
        };
        const startHeldScroll = (button, direction, event) => {
            if (button.disabled) return;
            event.preventDefault();
            stopHeldScroll();
            scrollByPage(direction);
            button.setPointerCapture?.(event.pointerId);
            holdDelay = setTimeout(() => {
                holdInterval = setInterval(() => {
                    if (button.disabled) {
                        stopHeldScroll();
                        return;
                    }
                    tabBar.scrollBy({ left: direction * 34, behavior: 'auto' });
                }, 45);
            }, 260);
        };
        const wireScrollButton = (button, direction) => {
            if (!button) return;
            button.addEventListener('pointerdown', event => startHeldScroll(button, direction, event));
            button.addEventListener('pointerup', stopHeldScroll);
            button.addEventListener('pointercancel', stopHeldScroll);
            button.addEventListener('lostpointercapture', stopHeldScroll);
            button.addEventListener('click', event => {
                if (event.detail === 0) scrollByPage(direction);
            });
        };

        wireScrollButton(tabScrollLeft, -1);
        wireScrollButton(tabScrollRight, 1);
        tabScrollHoldCleanup = stopHeldScroll;
        tabBar.addEventListener('scroll', updateScrollControls, { passive: true });
        tabBarResizeHandler = updateScrollControls;
        window.addEventListener('resize', tabBarResizeHandler, { passive: true });
        requestAnimationFrame(updateScrollControls);
    }

    tabs.forEach((tab, index) => {
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
        tab.tabIndex = tab.classList.contains('active') ? 0 : -1;

        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
            revealTab(tab);
        });
        tab.addEventListener('focus', () => revealTab(tab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            const nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                    : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
            const next = tabs[nextIndex];
            switchTab(next.dataset.tab);
            next.focus();
            revealTab(next);
        });
        tab.addEventListener('keyup', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        });
    });
}

/**
 * Switch between tabs
 * @param {string} tabName - 'description', 'narrator-lore', or 'advanced'
 */
function switchTab(tabName) {
    const container = document.getElementById('wl-pl-container');
    if (!container) return;

    // Update tab buttons
    container.querySelectorAll('.wl-pl-tab').forEach(tab => {
        const active = tab.dataset.tab === tabName;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
    });

    // Update tab panes
    container.querySelectorAll('.wl-pl-tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.dataset.tab === tabName);
    });

    // Render content when switching to narrator lore
    if (tabName === 'narrator-lore') {
        renderLoreTab();
    }

    // Render design tab content
    if (tabName === 'design') {
        const designPane = container.querySelector('.wl-pl-tab-pane[data-tab="design"]');
        if (designPane) renderDesignTab(designPane);
    }
}

/**
 * Get the active tab name
 * @returns {string}
 */
export function getActiveTab() {
    const activeTab = document.querySelector('#wl-pl-container .wl-pl-tab.active');
    return activeTab?.dataset.tab || 'description';
}

/**
 * Get the narrator lore tab pane element (for loreUI to inject content into)
 * @returns {HTMLElement|null}
 */
export function getLoreTabPane() {
    return document.querySelector('#wl-pl-container .wl-pl-tab-pane[data-tab="narrator-lore"]');
}

/**
 * Update the lore badge count on the tab
 * @param {number} count
 */
export function updateLoreBadge(count) {
    const badge = document.getElementById('wl-pl-lore-badge');
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

/**
 * Restore the persona drawer to its original state
 */
export function restoreDrawer() {
    if (!isActive || !originalParent) return;

    const container = document.getElementById('wl-pl-container');
    if (!container) return;

    if (tabBarResizeHandler) {
        window.removeEventListener('resize', tabBarResizeHandler);
        tabBarResizeHandler = null;
    }
    tabScrollHoldCleanup?.();
    tabScrollHoldCleanup = null;

    const currentPersona = originalParent.querySelector('.persona_management_current_persona');
    const globalSettings = container.querySelector('.persona_management_global_settings');

    // Move persona controls back
    const personaControls = container.querySelector('#persona_controls');
    if (personaControls && currentPersona) {
        const targetHeader = currentPersona.querySelector('h4[data-i18n="Current Persona"]');
        if (targetHeader) {
            targetHeader.after(personaControls);
        } else {
            currentPersona.prepend(personaControls);
        }
    }

    // Move description elements back
    const descSelectors = ['h4:has(.editor_maximize)', '#persona_description', '.extension_token_counter'];
    descSelectors.forEach(sel => {
        const el = container.querySelector(sel);
        if (el) currentPersona?.appendChild(el);
    });

    // Move position settings back
    const posSelectors = ['.persona_management_description_position_container', '#persona_depth_position_settings'];
    posSelectors.forEach(sel => {
        const el = container.querySelector(sel);
        if (el) currentPersona?.appendChild(el);
    });

    // Move connection elements back
    const connSelectors = ['#persona_connections_buttons', '#persona_connections_info_block', '#persona_connections_list'];
    connSelectors.forEach(sel => {
        const el = container.querySelector(sel);
        if (el) currentPersona?.appendChild(el);
    });

    // Move global settings back
    if (globalSettings) {
        originalParent.appendChild(globalSettings);
        globalSettings.style.display = '';
    }

    // Description is home again, so A:E can return its controls immediately
    // ahead of it in the same order used by A:E's own persona mount.
    restoreAspectEvolutiaIntegration();

    // Unhide original sections
    if (currentPersona) currentPersona.style.display = '';

    // Remove active class from parent
    const parentBlock = originalParent?.closest('#persona-management-block');
    if (parentBlock) parentBlock.classList.remove('wl-pl-active');

    // Remove our container
    container.remove();

    isActive = false;
    originalParent = null;
    log('Drawer restored to original state');
}

/**
 * Check if takeover is currently active
 * @returns {boolean}
 */
export function isTakeoverActive() {
    return isActive;
}
