// src/userSettingsDrawer.js
// User Settings drawer takeover — reorganizes settings into tabbed layout (Theme / App / Chat)
// Pure DOM relocation — all ST event handlers remain intact.
// Ported from VerseManager, adapted for White Lotus.

import { getSetting } from './settings.js';

const log = (...args) => console.log('[WL UserSettingsDrawer]', ...args);

// ============================================================
// State
// ============================================================

let originalPositions = []; // { element, parent, nextSibling }
let isActive = false;
let activeTab = 'theme';
let drawerObserver = null;

// ============================================================
// Drawer Takeover
// ============================================================

function takeoverDrawer() {
    if (isActive) return;
    if (document.getElementById('wl-usd-container')) return;

    const blockContent = document.getElementById('user-settings-block-content');
    if (!blockContent) { log('user-settings-block-content not found'); return; }

    // --- Curtain down: hide drawer content before DOM manipulation ---
    const drawerBlock = document.getElementById('user-settings-block');
    let curtainApplied = false;
    if (drawerBlock) {
        drawerBlock.style.visibility = 'hidden';
        curtainApplied = true;
    }

    const col1 = document.querySelector('[name="UserSettingsFirstColumn"]');
    const col2 = document.querySelector('[name="UserSettingsSecondColumn"]');
    const col3 = document.querySelector('[name="UserSettingsThirdColumn"]');
    const cssBlock = document.getElementById('CustomCSS-block');

    if (!col1 || !col2 || !col3) {
        log('Could not find all columns — aborting takeover');
        return;
    }

    // Snapshot for restore
    originalPositions = [];
    if (cssBlock) {
        originalPositions.push({ element: cssBlock, parent: cssBlock.parentNode, nextSibling: cssBlock.nextSibling });
    }
    originalPositions.push(
        { element: col1, parent: blockContent, nextSibling: col1.nextSibling },
        { element: col2, parent: blockContent, nextSibling: col2.nextSibling },
        { element: col3, parent: blockContent, nextSibling: col3.nextSibling },
    );

    // Hide original layout
    blockContent.style.display = 'none';

    // Build tabbed container
    const container = document.createElement('div');
    container.id = 'wl-usd-container';
    container.innerHTML = `
        <div id="wl-usd-tab-bar">
            <button class="wl-usd-tab active" data-tab="theme">
                <i class="fa-solid fa-palette"></i> Theme
            </button>
            <button class="wl-usd-tab" data-tab="app">
                <i class="fa-solid fa-sliders"></i> App
            </button>
            <button class="wl-usd-tab" data-tab="chat">
                <i class="fa-solid fa-message"></i> Chat
            </button>
        </div>
        <div id="wl-usd-tab-content">
            <div class="wl-usd-tab-pane active" data-tab="theme">
                <div id="wl-usd-theme-top"></div>
                <div id="wl-usd-theme-toggles-row"></div>
            </div>
            <div class="wl-usd-tab-pane" data-tab="app"></div>
            <div class="wl-usd-tab-pane" data-tab="chat"></div>
        </div>
    `;

    blockContent.parentNode.insertBefore(container, blockContent.nextSibling);

    // --- Theme tab ---
    const themeTop = container.querySelector('#wl-usd-theme-top');
    themeTop.appendChild(col1);
    if (cssBlock) {
        const cssWrapper = document.createElement('div');
        cssWrapper.id = 'wl-usd-css-wrapper';
        cssWrapper.appendChild(cssBlock);
        themeTop.appendChild(cssWrapper);
    }

    // Extract themeToggles from col1 into full-width row
    const themeToggles = col1.querySelector('[name="themeToggles"]');
    const themeTogglesRow = container.querySelector('#wl-usd-theme-toggles-row');
    if (themeToggles) {
        themeTogglesRow.appendChild(themeToggles);
    }

    // --- App tab ---
    const appPane = container.querySelector('.wl-usd-tab-pane[data-tab="app"]');
    appPane.appendChild(col2);

    // --- Chat tab ---
    const chatPane = container.querySelector('.wl-usd-tab-pane[data-tab="chat"]');
    chatPane.appendChild(col3);

    // Refine layouts
    organizeLayouts();

    // Wire tab switching
    container.querySelectorAll('.wl-usd-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    if (activeTab && activeTab !== 'theme') switchTab(activeTab);

    isActive = true;

    // --- Curtain up: reveal after DOM work is complete ---
    if (curtainApplied) {
        requestAnimationFrame(() => {
            drawerBlock.style.visibility = '';
        });
    }

    log('Drawer takeover applied');
}

// ============================================================
// Layout Organization
// ============================================================

function organizeLayouts() {
    organizeThemeToggles();
    organizeAppSections();
    organizeChatDropdowns();
    organizeChatCheckboxes();
}

/**
 * Theme toggles — full-width row below the col1/CSS split, wrapped in 3-col grid.
 */
function organizeThemeToggles() {
    const themeTogglesRow = document.getElementById('wl-usd-theme-toggles-row');
    if (!themeTogglesRow) return;

    const themeToggles = themeTogglesRow.querySelector('[name="themeToggles"]');
    if (!themeToggles) return;

    const labels = [...themeToggles.querySelectorAll(':scope > label.checkbox_label')];
    if (labels.length === 0) return;

    const grid = document.createElement('div');
    grid.className = 'wl-usd-toggle-grid wl-usd-cols-3';
    themeToggles.insertBefore(grid, labels[0]);
    labels.forEach(label => grid.appendChild(label));

    log(`Theme toggles: wrapped ${labels.length} in 3-col grid`);
}

/**
 * App tab — Character Handling + Miscellaneous side by side.
 */
function organizeAppSections() {
    const col2 = document.querySelector('.wl-usd-tab-pane[data-tab="app"] [name="UserSettingsSecondColumn"]');
    if (!col2) return;

    const charSection = col2.querySelector('[name="CharacterHandlingToggles"]');
    const miscSection = col2.querySelector('[name="MiscellaneousToggles"]');
    if (!charSection || !miscSection) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'wl-usd-app-columns';
    col2.insertBefore(wrapper, charSection);
    wrapper.appendChild(charSection);
    wrapper.appendChild(miscSection);

    log('App sections: 2-column layout applied');
}

/**
 * Chat tab — three select-rows (Example Messages, Image Swipe, Enter to Send) side by side.
 */
function organizeChatDropdowns() {
    const chatSection = document.querySelector('.wl-usd-tab-pane[data-tab="chat"] [name="ChatMessageHandlingToggles"]');
    if (!chatSection) return;

    const exampleBlock = chatSection.querySelector('#examples-behavior-block');
    if (!exampleBlock) return;

    const imageSwipeBlock = exampleBlock.nextElementSibling;
    const enterToSendBlock = imageSwipeBlock?.nextElementSibling;

    if (!imageSwipeBlock || !enterToSendBlock) return;
    if (!enterToSendBlock.querySelector('select')) return;

    const row = document.createElement('div');
    row.className = 'wl-usd-dropdown-row';
    chatSection.insertBefore(row, exampleBlock);
    row.appendChild(exampleBlock);
    row.appendChild(imageSwipeBlock);
    row.appendChild(enterToSendBlock);

    log('Chat: 3 dropdowns placed in single row');
}

/**
 * Chat tab — wrap consecutive checkbox labels in a 2-col grid.
 */
function organizeChatCheckboxes() {
    const chatSection = document.querySelector('.wl-usd-tab-pane[data-tab="chat"] [name="ChatMessageHandlingToggles"]');
    if (!chatSection) return;

    const checkboxItems = [...chatSection.querySelectorAll(
        ':scope > label.checkbox_label, :scope > .checkbox-container'
    )];
    if (checkboxItems.length === 0) return;

    const grid = document.createElement('div');
    grid.className = 'wl-usd-toggle-grid wl-usd-cols-2';
    chatSection.insertBefore(grid, checkboxItems[0]);
    checkboxItems.forEach(item => grid.appendChild(item));

    log(`Chat checkboxes: wrapped ${checkboxItems.length} in 2-col grid`);
}

// ============================================================
// Tab Switching
// ============================================================

function switchTab(tabName) {
    const container = document.getElementById('wl-usd-container');
    if (!container) return;
    activeTab = tabName;
    container.querySelectorAll('.wl-usd-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    container.querySelectorAll('.wl-usd-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.tab === tabName));
}

// ============================================================
// Restore
// ============================================================

function cleanupLayouts() {
    // Put themeToggles back inside col1 before col1 is restored
    const themeToggles = document.querySelector('[name="themeToggles"]');
    if (themeToggles) {
        const col1 = document.querySelector('[name="UserSettingsFirstColumn"]');
        if (col1) col1.appendChild(themeToggles);
    }

    // Unwrap all layout wrappers
    document.querySelectorAll('.wl-usd-toggle-grid, .wl-usd-app-columns, .wl-usd-dropdown-row').forEach(wrapper => {
        const parent = wrapper.parentNode;
        while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
        wrapper.remove();
    });
}

function restoreDrawer() {
    if (!isActive) return;

    const container = document.getElementById('wl-usd-container');
    if (!container) return;

    cleanupLayouts();

    [...originalPositions].reverse().forEach(({ element, parent, nextSibling }) => {
        if (nextSibling && nextSibling.parentNode === parent) {
            parent.insertBefore(element, nextSibling);
        } else {
            parent.appendChild(element);
        }
    });

    container.remove();

    const blockContent = document.getElementById('user-settings-block-content');
    if (blockContent) blockContent.style.display = '';

    originalPositions = [];
    isActive = false;
    log('Drawer restored');
}

// ============================================================
// Drawer Watcher
// ============================================================

function setupDrawerWatcher() {
    teardownDrawerWatcher();

    const drawerContent = document.getElementById('user-settings-block');
    if (!drawerContent) {
        log('user-settings-block not found');
        return;
    }

    drawerObserver = new MutationObserver(() => {
        const isOpen = drawerContent.classList.contains('openDrawer');
        if (isOpen && !isActive) {
            takeoverDrawer();
        }
        // Recovery: if container was removed externally (ST re-render)
        if (isActive && !document.getElementById('wl-usd-container')) {
            log('Container lost — resetting for re-takeover');
            originalPositions = [];
            isActive = false;
            if (isOpen) takeoverDrawer();
        }
    });

    drawerObserver.observe(drawerContent, { attributes: true, attributeFilter: ['class'] });
    log('Drawer watcher active');
}

function teardownDrawerWatcher() {
    if (drawerObserver) {
        drawerObserver.disconnect();
        drawerObserver = null;
    }
}

function applyIfDrawerOpen() {
    const drawerContent = document.getElementById('user-settings-block');
    if (drawerContent?.classList.contains('openDrawer') && !isActive) {
        takeoverDrawer();
    }
}

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the User Settings Drawer feature.
 * Called once on startup from index.js.
 */
export function initUserSettingsDrawer() {
    if (getSetting('userSettingsDrawerTakeover')) {
        setupDrawerWatcher();
        applyIfDrawerOpen();
    }

    log('Initialized');
}

/**
 * Called when the toggle changes in WL panel.
 * @param {boolean} enabled
 */
export function onUserSettingsDrawerToggleChanged(enabled) {
    if (enabled) {
        setupDrawerWatcher();
        applyIfDrawerOpen();
    } else {
        teardownDrawerWatcher();
        if (isActive) {
            restoreDrawer();
        }
    }
}
