import { resolveScrollbarStyle } from './scrollbarStyle.js';
// src/chatDesign/modal.js
// Chat Design — Popup modal UI
//
// Structure:
//   - Overlay + modal container
//   - Left sidebar: Core + grouped element navigation (Fonts, Container/Banner, Message Elements)
//   - Right content: Overview (Core) or element tab (style list → inline editor)
//   - Editor: property controls, live preview, assignment panel
//   - Snapshot-based undo on cancel

import { getContext } from '../../../../../extensions.js';
import {
    getChatDesignSettings, isChatDesignEnabled, setChatDesignEnabled,
    getAllStyles, getStylesForElement, getStyleById,
    createStyle, updateStyleProperties, updateStyleMeta, deleteStyle, deleteStyles, duplicateStyle,
    ELEMENT_DEFAULTS, ELEMENT_LABELS, ELEMENT_TYPES, NAME_DEFAULTS, BACKGROUND_PRESETS, BANNER_PRESETS,
    THINKING_PRESETS,
    AVATAR_OVERLAY_PRESETS, MESSAGE_ACTION_PRESETS, WEATHER_BADGE_PRESETS,
    getAvailableCharacters, getAvailablePersonas, getAvailableVerses, getCharacterTags, isVMAvailable,
} from './storage.js';
import { renderFontPicker, wireFontPickers } from './fontPicker.js';
import { renderChatDesignPreview, wireChatDesignPreview } from './preview.js';
import {
    getPropertyTabs, renderPropertyTabBar, resolvePropertyTab, wirePropertyTabBar,
} from './propertyTabs.js';
import { clampDraggableModal, makeModalDraggable, makeModalResizable } from './draggableModal.js';
import {
    CURSOR_TYPES, EMITTABLE_CURSOR_TYPES, mapSetFiles, isAnimatedCursor,
    getCursorDiscovery, refreshCursorDiscovery, cursorFileUrl,
} from './cursors.js';
import { refreshChatDesignCSS, refreshChatDesignCSSDebounced, onChatDesignToggleChanged } from './index.js';
import {
    getSavedThemes, getDefaultTheme, setDefaultTheme,
    getThemeForCharacter, setThemeForCharacter, applyThemeForActiveChar,
} from './themeSwitch.js';
import {
    ICON_AXES, getIconChoices, getDefaultIconSet, setDefaultIconSet,
    getIconSetForCharacter, setIconSetForCharacter, applyIconSetsForActiveChar,
    getDefaultCustomTopbarSetId, setDefaultCustomTopbarSetId,
    getCustomTopbarSetForCharacter, setCustomTopbarSetForCharacter,
} from './iconSwitch.js';
import {
    getCustomTopbarSets,
} from '../customTopbarIcons.js';
import { openCustomTopbarIconEditor } from '../customTopbarIconEditor.js';
import {
    getSideButtonStyleChoices, getDefaultSideButtonStyle, setDefaultSideButtonStyle,
    getSideButtonStyleForCharacter, setSideButtonStyleForCharacter,
    applySideButtonStyleForActiveChar,
} from './sideButtonStyleSwitch.js';
import { resetSideButtonPosition } from '../sideButtonDrag.js';
import { isWeatherCycleBadgeAvailable } from '../weatherCycleBadge.js';
import { isChatTopBarAvailable } from './chatTopBarStyle.js';
import { isGuidedGenerationsAvailable } from './guidedGenerationsStyle.js';
import { uploadDesignImage } from '../design/designUtils.js';

const log = () => {};
const ASSIGNMENT_PERSONA_CACHE_MS = 60_000;
const CURSOR_UPLOAD_EXTENSIONS = ['.cur', '.ani', '.png', '.svg', '.gif', '.webp', '.ico'];
const CURSOR_UPLOAD_MAX_FILES = 200;
let assignmentPersonasCache = null;
let assignmentPersonasCachedAt = 0;
let assignmentPersonasPromise = null;

/**
 * Escape a string for safe insertion into HTML text or a double-quoted
 * attribute. Names, titles and avatar filenames are user-controlled, so they
 * must be escaped before being dropped into template strings.
 */
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderTagFilter(tags, cloudId) {
    if (tags.length === 0) return '';
    return `
        <details class="wl-cdm-tag-filter">
            <summary class="wl-cdm-tag-filter-header">
                <span class="wl-cdm-tag-filter-title">
                    Tag filters
                    <span class="wl-cdm-tag-filter-count">None selected</span>
                </span>
                <input type="text" class="wl-cdm-input wl-cdm-tag-search"
                       placeholder="Find a tag…" aria-label="Find and select a tag">
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </summary>
            <div class="wl-cdm-tag-filter-content">
                <div class="wl-cdm-tag-chips" id="${cloudId}">
                    ${tags.map(tag => `
                        <button type="button" class="wl-cdm-tag-chip"
                                data-tagid="${esc(tag.id)}" data-tagname="${esc(tag.name.toLowerCase())}">${esc(tag.name)}</button>
                    `).join('')}
                </div>
                <div class="wl-cdm-empty-small wl-cdm-tag-no-match" hidden>No matching tags</div>
            </div>
        </details>
    `;
}

function wireTagFilterControls(container, cloudSelector) {
    const cloud = container.querySelector(cloudSelector);
    const details = cloud?.closest('.wl-cdm-tag-filter');
    const search = details?.querySelector('.wl-cdm-tag-search');
    const count = details?.querySelector('.wl-cdm-tag-filter-count');
    const noMatch = details?.querySelector('.wl-cdm-tag-no-match');
    const chips = [...(cloud?.querySelectorAll('.wl-cdm-tag-chip') || [])];
    if (!details || !search || chips.length === 0) return;

    const updateCount = () => {
        const selected = chips.filter(chip => chip.classList.contains('wl-cdm-tag-chip-active')).length;
        if (count) count.textContent = selected === 0 ? 'None selected' : `${selected} selected`;
    };
    const filterTags = () => {
        const query = search.value.trim().toLowerCase();
        let visible = 0;
        for (const chip of chips) {
            const show = !query || (chip.dataset.tagname || '').includes(query);
            chip.hidden = !show;
            if (show) visible++;
        }
        if (noMatch) noMatch.hidden = visible !== 0;
        if (query) details.open = true;
    };

    // Interactive content inside <summary> needs to suppress the native toggle;
    // the field opens the cloud deliberately so typing is never interrupted.
    search.addEventListener('click', event => event.stopPropagation());
    search.addEventListener('focus', () => { details.open = true; });
    search.addEventListener('input', filterTags);
    search.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            search.value = '';
            filterTags();
            details.open = false;
            search.blur();
            return;
        }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const query = search.value.trim().toLowerCase();
        const visible = chips.filter(chip => !chip.hidden);
        const match = visible.find(chip => chip.dataset.tagname === query) || visible[0];
        if (!match) return;
        match.click();
        search.value = '';
        filterTags();
        search.focus();
    });

    chips.forEach(chip => chip.addEventListener('click', updateCount));
    updateCount();
}

// ============================================================
// State
// ============================================================

let isOpen = false;
let activeTab = 'core';         // Overview, a style element, or an interface assignment tab
let editingStyleId = null;      // Currently editing style ID, or null for list view
let editingSnapshot = null;     // Deep clone before editing (for cancel/restore)
let navigationLockedUntil = 0;  // Prevent a launcher click from landing on the newly mounted modal
let openSequence = 0;           // Invalidates a queued open animation when the modal closes
let isModalTemporarilyHidden = false;
let lastFocusedElement = null;
const activePropertyTabs = new Map();

const ICON_SECTION_TABS = Object.freeze([
    Object.freeze({ id: 'icons', label: 'Icon Sets' }),
    Object.freeze({ id: 'icons-top-bar', label: 'Top Bar Styling' }),
]);

const CONTAINER_SECTION_TABS = Object.freeze([
    Object.freeze({ id: 'container', label: 'Container' }),
    Object.freeze({ id: 'banner', label: 'Banner' }),
]);

const GENERAL_UI_SECTION_TABS = Object.freeze([
    Object.freeze({ id: 'generalUi', label: 'Native General UI' }),
    Object.freeze({ id: 'generalUi-integrations', label: 'Integrations General UI' }),
]);

const MODAL_ID = 'wl-chat-design-modal';
const OVERLAY_ID = 'wl-chat-design-overlay';
const VISIBILITY_TOGGLE_ID = 'wl-chat-design-visibility-toggle';

// ============================================================
// Open / Close
// ============================================================

/**
 * Open the Chat Design modal.
 * Creates DOM on first call, reuses it on subsequent opens.
 */
export function openChatDesignModal() {
    // Treat every open request as a fresh entrance. Tauri's soft page refresh
    // can preserve the module briefly even after the modal itself is hidden.
    // Re-rendering here prevents a stale element tab from becoming the landing view.
    const mountedModal = document.getElementById(MODAL_ID);
    const modalIsVisible = mountedModal?.classList.contains('wl-cdm-visible');
    if (isOpen && modalIsVisible) {
        // Inspection mode intentionally keeps the mounted/open class while
        // making the modal transparent. A launcher click must bring it back;
        // otherwise every opener appears permanently broken.
        if (isModalTemporarilyHidden || mountedModal.classList.contains('wl-cdm-inspecting-page')) {
            isModalTemporarilyHidden = false;
            syncTemporaryVisibility();
            clampDraggableModal(mountedModal);
        }
        return;
    }
    lastFocusedElement = document.activeElement;
    isOpen = true;
    editingStyleId = null;
    editingSnapshot = null;
    activeTab = 'core';
    isModalTemporarilyHidden = false;
    navigationLockedUntil = performance.now() + 250;
    const sequence = ++openSequence;

    ensureModalDOM();
    renderContent();

    // Animate in
    requestAnimationFrame(() => {
        if (!isOpen || sequence !== openSequence) return;
        // Chat transitions in Tauri can finish mounting in the same pointer
        // cycle as the launcher. Reassert Home before the modal becomes interactive.
        activeTab = 'core';
        editingStyleId = null;
        editingSnapshot = null;
        renderContent();
        document.getElementById(OVERLAY_ID)?.classList.add('wl-cdm-visible');
        const modal = document.getElementById(MODAL_ID);
        modal?.classList.add('wl-cdm-visible');
        syncTemporaryVisibility();
        clampDraggableModal(modal);
        modal?.querySelector('.wl-cdm-nav-active')?.focus();
    });

    log('Modal opened');
}

/**
 * Close the Chat Design modal.
 * Hides the modal and overlay without removing them from the DOM.
 */
export function closeChatDesignModal() {
    if (!isOpen) return;
    openSequence++;

    // If editing, cancel without saving
    if (editingStyleId && editingSnapshot) {
        const style = getStyleById(editingStyleId);
        if (style) {
            Object.assign(style, JSON.parse(JSON.stringify(editingSnapshot)));
        }
    }
    editingStyleId = null;
    editingSnapshot = null;
    activeTab = 'core';
    navigationLockedUntil = 0;

    const overlay = document.getElementById(OVERLAY_ID);
    const modal = document.getElementById(MODAL_ID);
    overlay?.classList.remove('wl-cdm-visible');
    modal?.classList.remove('wl-cdm-visible');

    isModalTemporarilyHidden = false;
    isOpen = false;
    syncTemporaryVisibility();
    const focusTarget = lastFocusedElement;
    lastFocusedElement = null;
    if (focusTarget?.isConnected && typeof focusTarget.focus === 'function') {
        requestAnimationFrame(() => focusTarget.focus());
    }
    log('Modal closed');
}

// ============================================================
// DOM Creation — persistent, created once and reused
// ============================================================

/**
 * Ensure the modal DOM exists. Creates it on first call, no-ops after.
 * Events are wired once and persist across open/close cycles.
 */
function ensureModalDOM() {
    if (document.getElementById(MODAL_ID)) {
        ensureVisibilityToggle();
        return;
    }

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'wl-cdm-overlay';
    overlay.addEventListener('click', closeChatDesignModal);
    document.body.appendChild(overlay);

    // Modal
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'wl-cdm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'wl-cdm-title');
    modal.tabIndex = -1;
    modal.innerHTML = `
        <div class="wl-cdm-header" title="Drag to move · Double-click to center · Drag an edge or corner to resize">
            <div class="wl-cdm-title" id="wl-cdm-title">Chat Design</div>
            <div class="wl-cdm-header-actions">
                <button type="button" class="wl-cdm-header-action" id="wl-cdm-add-pack" title="Add a built-in Style Pack"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Add Pack</span></button>
                <button type="button" class="wl-cdm-header-action" id="wl-cdm-import-pack"><i class="fa-solid fa-file-import"></i><span>Import Pack</span></button>
                <button type="button" class="wl-cdm-header-action" id="wl-cdm-export-pack"><i class="fa-solid fa-file-export"></i><span>Export Pack</span></button>
                <button type="button" class="wl-cdm-close" id="wl-cdm-close" aria-label="Close Chat Design">✕</button>
            </div>
        </div>
        <div class="wl-cdm-body">
            <div class="wl-cdm-sidebar" id="wl-cdm-sidebar"></div>
            <div class="wl-cdm-content" id="wl-cdm-content"></div>
        </div>
    `;
    document.body.appendChild(modal);
    makeModalResizable(modal);
    makeModalDraggable(modal, modal.querySelector('.wl-cdm-header'));

    // Wire persistent events (only once)
    modal.querySelector('#wl-cdm-close')?.addEventListener('click', closeChatDesignModal);
    const refreshAfterPackApply = () => {
        refreshChatDesignCSS();
        renderContent();
    };
    modal.querySelector('#wl-cdm-add-pack')?.addEventListener('click', async () => {
        try {
            const { addStylePack } = await import('./stylePackUi.js');
            await addStylePack(refreshAfterPackApply);
        } catch (error) {
            globalThis.toastr?.error(error.message || 'Built-in Style Packs could not be opened.', 'Style Packs');
        }
    });
    modal.querySelector('#wl-cdm-import-pack')?.addEventListener('click', async () => {
        try {
            const { importStylePack } = await import('./stylePackUi.js');
            importStylePack(refreshAfterPackApply);
        } catch (error) {
            globalThis.toastr?.error(error.message || 'Style Pack import could not start.', 'Style Packs');
        }
    });
    modal.querySelector('#wl-cdm-export-pack')?.addEventListener('click', async () => {
        try {
            const { exportStylePack } = await import('./stylePackUi.js');
            await exportStylePack();
        } catch (error) {
            globalThis.toastr?.error(error.message || 'Style Pack export could not start.', 'Style Packs');
        }
    });
    document.addEventListener('keydown', handleModalKeydown);

    ensureVisibilityToggle();
}

function handleModalKeydown(event) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
        closeChatDesignModal();
        return;
    }
    if (event.key !== 'Tab') return;

    const modal = document.getElementById(MODAL_ID);
    const toggle = document.getElementById(VISIBILITY_TOGGLE_ID);
    if (!modal) return;
    if (isModalTemporarilyHidden) {
        event.preventDefault();
        toggle?.focus();
        return;
    }

    const focusable = [...modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )].filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    if (toggle && !toggle.hidden) focusable.push(toggle);
    if (focusable.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function ensureVisibilityToggle() {
    if (document.getElementById(VISIBILITY_TOGGLE_ID)) return;

    const toggle = document.createElement('button');
    toggle.id = VISIBILITY_TOGGLE_ID;
    toggle.className = 'wl-cdm-visibility-toggle';
    toggle.type = 'button';
    toggle.innerHTML = '<i class="fa-solid fa-eye" aria-hidden="true"></i>';
    toggle.addEventListener('click', () => {
        if (!isOpen) return;
        isModalTemporarilyHidden = !isModalTemporarilyHidden;
        syncTemporaryVisibility();
        if (isModalTemporarilyHidden) toggle.focus();
        else document.querySelector(`#${MODAL_ID} .wl-cdm-nav-active`)?.focus();
    });
    document.body.appendChild(toggle);
}

function syncTemporaryVisibility() {
    const modal = document.getElementById(MODAL_ID);
    const overlay = document.getElementById(OVERLAY_ID);
    const toggle = document.getElementById(VISIBILITY_TOGGLE_ID);
    const isInspecting = isOpen && isModalTemporarilyHidden;

    modal?.classList.toggle('wl-cdm-inspecting-page', isInspecting);
    overlay?.classList.toggle('wl-cdm-inspecting-page', isInspecting);
    toggle?.classList.toggle('wl-cdm-visible', isOpen);
    toggle?.classList.toggle('wl-cdm-active', isInspecting);

    if (!toggle) return;
    toggle.title = isInspecting ? 'Show Chat Design' : 'Hide Chat Design and inspect the page';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-pressed', String(isInspecting));
    toggle.innerHTML = `<i class="fa-solid ${isInspecting ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>`;
}

// ============================================================
// Sidebar
// ============================================================

function renderSidebar() {
    const sidebar = document.getElementById('wl-cdm-sidebar');
    if (!sidebar) return;

    const items = [
        { id: 'core', icon: 'fa-house', label: 'Overview' },
        { id: 'dialogue', icon: 'fa-font', label: 'Fonts' },
        { id: 'container', icon: 'fa-square', label: 'Container' },
        { id: 'avatar', icon: 'fa-layer-group', label: 'Message Elements' },
        { id: 'generalUi', icon: 'fa-window-maximize', label: 'General UI' },
        { id: 'background', icon: 'fa-image', label: 'Background' },
        { id: 'cursor', icon: 'fa-arrow-pointer', label: 'Cursor' },
        { id: 'themes', icon: 'fa-palette', label: 'Themes' },
        { id: 'icons', icon: 'fa-icons', label: 'Icons' },
        { id: 'side-buttons', icon: 'fa-grip-vertical', label: 'Side Buttons' },
    ];

    sidebar.setAttribute('role', 'tablist');
    sidebar.setAttribute('aria-label', 'Chat Design sections');
    sidebar.innerHTML = items.map(item => {
        const active = item.id === activeTab
            || (item.id === 'container' && activeTab === 'banner')
            || (item.id === 'generalUi' && activeTab === 'generalUi-integrations')
            || (item.id === 'icons' && activeTab === 'icons-top-bar');
        return `
        <button type="button" role="tab" class="wl-cdm-nav-item ${active ? 'wl-cdm-nav-active' : ''}"
             data-tab="${item.id}" aria-selected="${active}" aria-controls="wl-cdm-content">
            <i class="fa-solid ${item.icon}" aria-hidden="true"></i>
            <span>${item.label}</span>
        </button>
    `;
    }).join('');

    // Wire nav clicks
    sidebar.querySelectorAll('.wl-cdm-nav-item').forEach(el => {
        el.addEventListener('click', event => {
            if (performance.now() < navigationLockedUntil) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            // Cancel any in-progress edit
            cancelEdit();
            activeTab = el.dataset.tab;
            renderSidebar();
            renderContent();
        });
        el.addEventListener('keydown', event => {
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const tabs = [...sidebar.querySelectorAll('.wl-cdm-nav-item')];
            const current = tabs.indexOf(el);
            const next = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                    : (current + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
            tabs[next]?.focus();
        });
    });
}

// ============================================================
// Content Rendering
// ============================================================

function renderContent() {
    if (activeTab === 'generalUi-integrations' && !hasGeneralUiIntegrations()) {
        activeTab = 'generalUi';
    }
    renderSidebar();
    const modal = document.getElementById(MODAL_ID);
    modal?.classList.toggle('wl-cdm-overview-mode', activeTab === 'core');
    modal?.classList.toggle('wl-cdm-editor-mode', !!editingStyleId);
    const content = document.getElementById('wl-cdm-content');
    if (!content) return;

    if (activeTab === 'core') {
        renderCoreView(content);
    } else if (activeTab === 'themes') {
        renderThemesView(content);
    } else if (activeTab === 'icons') {
        renderIconsView(content);
    } else if (activeTab === 'icons-top-bar') {
        if (editingStyleId) renderEditor(content);
        else renderElementList(content);
    } else if (activeTab === 'side-buttons') {
        renderSideButtonStylesView(content);
    } else if (editingStyleId) {
        renderEditor(content);
    } else {
        renderElementList(content);
    }
}

// ============================================================
// Themes Tab — per-character UI theme assignment
// ============================================================
//
// A lightweight tab (no style objects, no CSS): a default-theme picker plus a
// per-character theme dropdown. Reuses the existing search/tag-filter pattern
// from the assignment panel. Data lives in themeSwitch.js's assignment map;
// selection persists immediately and, if you retarget the ACTIVE character's
// theme, applies right away so you can see it.

function renderThemesView(container) {
    const themes = getSavedThemes();

    if (themes.length === 0) {
        container.innerHTML = `
            <div class="wl-cdm-core">
                <div class="wl-cdm-info-block">
                    <i class="fa-solid fa-circle-info"></i>
                    <div>
                        <strong>No saved themes found</strong>
                        <p>Create UI themes in <em>User Settings → Theme</em> first (the same themes the <code>/theme</code> command switches between). Once you have some saved, assign them to characters here.</p>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    const characters = getAvailableCharacters().sort((a, b) => a.name.localeCompare(b.name));
    const charTags = getCharacterTags();
    const currentDefault = getDefaultTheme();

    const themeOptions = (selected) =>
        `<option value="">— None —</option>` +
        themes.map(t => `<option value="${esc(t)}" ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');

    const tagChips = renderTagFilter(charTags, 'wl-cdm-th-tag-chips');

    const charRow = (c) => {
        const assigned = getThemeForCharacter(c.avatar);
        const tagIds = (c.tags || []).map(t => t.id).join(' ');
        const tagNames = (c.tags || []).map(t => t.name).join(' ');
        const search = `${c.name} ${c.avatar} ${tagNames}`.toLowerCase();
        return `
            <div class="wl-cdm-th-row wl-cdm-pickrow" data-search="${esc(search)}" data-tagids="${esc(tagIds)}">
                <div class="wl-cdm-th-charname">${esc(c.name)} <span class="wl-cdm-pick-hint">${esc(c.avatar)}</span></div>
                <select class="wl-cdm-select wl-cdm-th-charselect" data-avatar="${esc(c.avatar)}">
                    ${themeOptions(assigned)}
                </select>
            </div>
        `;
    };

    container.innerHTML = `
        <div class="wl-cdm-core">
            <div class="wl-cdm-setting-row">
                <div class="wl-cdm-setting-info">
                    <div class="wl-cdm-setting-title">Default Theme</div>
                    <div class="wl-cdm-setting-desc">Applied when the active character has no theme assigned. Leave as “None” to keep whatever theme is currently active.</div>
                </div>
                <select class="wl-cdm-select" id="wl-cdm-th-default">
                    ${themeOptions(currentDefault)}
                </select>
            </div>

            <div class="wl-cdm-divider"></div>

            <div class="wl-cdm-section-title">Per-Character Themes</div>
            <div class="wl-cdm-field-hint">Each character can have one theme. It switches automatically when you open that character's chat. Personas aren't listed — a persona shares the character's chat, so the character owns the theme.</div>

            <div class="wl-cdm-pick-filter">
                <input type="text" class="wl-cdm-input wl-cdm-pick-search" id="wl-cdm-th-search"
                       placeholder="Filter by name, tag, or file…">
                ${tagChips}
            </div>

            <div class="wl-cdm-th-list" id="wl-cdm-th-list">
                ${characters.length === 0
                    ? '<div class="wl-cdm-empty-small">No characters loaded</div>'
                    : characters.map(charRow).join('')
                }
                <div class="wl-cdm-empty-small wl-cdm-no-match" id="wl-cdm-th-nomatch" style="display:none">No matches</div>
            </div>
        </div>
    `;

    wireThemesView(container);
}

function wireThemesView(container) {
    // Default theme picker
    container.querySelector('#wl-cdm-th-default')?.addEventListener('change', (e) => {
        setDefaultTheme(e.target.value || '');
        // If the active character has no assignment, the default now governs
        // this chat — apply it so the change is visible immediately.
        applyThemeForActiveChar();
    });

    // Per-character theme pickers
    container.querySelectorAll('.wl-cdm-th-charselect').forEach(sel => {
        sel.addEventListener('change', () => {
            const avatar = sel.dataset.avatar;
            setThemeForCharacter(avatar, sel.value || '');
            // If this is the character in the current chat, reflect it now.
            applyThemeForActiveChar();
        });
    });

    // Search + tag-chip filter (pure show/hide over the rendered rows).
    const searchInput = container.querySelector('#wl-cdm-th-search');
    const chips = [...container.querySelectorAll('#wl-cdm-th-tag-chips .wl-cdm-tag-chip')];
    const rows = [...container.querySelectorAll('#wl-cdm-th-list .wl-cdm-th-row')];
    const noMatch = container.querySelector('#wl-cdm-th-nomatch');
    const activeTags = new Set();

    const apply = () => {
        const q = (searchInput?.value || '').trim().toLowerCase();
        const tagOn = activeTags.size > 0;
        let visible = 0;
        for (const row of rows) {
            const text = row.dataset.search || '';
            const rowTags = (row.dataset.tagids || '').split(' ').filter(Boolean);
            const matchText = !q || text.includes(q);
            const matchTags = !tagOn || rowTags.some(id => activeTags.has(id));
            const show = matchText && matchTags;
            row.style.display = show ? '' : 'none';
            if (show) visible++;
        }
        if (noMatch) noMatch.style.display = visible === 0 ? '' : 'none';
    };

    searchInput?.addEventListener('input', apply);
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const id = chip.dataset.tagid;
            if (activeTags.has(id)) { activeTags.delete(id); chip.classList.remove('wl-cdm-tag-chip-active'); }
            else { activeTags.add(id); chip.classList.add('wl-cdm-tag-chip-active'); }
            apply();
        });
    });
    wireTagFilterControls(container, '#wl-cdm-th-tag-chips');
}

function getEditorPropertyTabs(elementType) {
    const group = elementType === 'generalUi'
        ? (activeTab === 'generalUi-integrations' ? 'integrations' : 'native')
        : null;
    return getPropertyTabs(elementType, {
        weatherBadgeAvailable: isWeatherCycleBadgeAvailable(),
        chatTopBarAvailable: isChatTopBarAvailable(),
        guidedGenerationsAvailable: isGuidedGenerationsAvailable(),
        group,
    });
}

function hasGeneralUiIntegrations() {
    return getPropertyTabs('generalUi', {
        weatherBadgeAvailable: isWeatherCycleBadgeAvailable(),
        chatTopBarAvailable: isChatTopBarAvailable(),
        guidedGenerationsAvailable: isGuidedGenerationsAvailable(),
        group: 'integrations',
    }).length > 0;
}

function getPropertyTabStateKey(elementType) {
    if (elementType !== 'generalUi') return elementType;
    return activeTab === 'generalUi-integrations' ? 'generalUi-integrations' : 'generalUi-native';
}

function getActivePropertyTab(elementType, tabs = getEditorPropertyTabs(elementType)) {
    const stateKey = getPropertyTabStateKey(elementType);
    const activeId = resolvePropertyTab(tabs, activePropertyTabs.get(stateKey));
    if (activeId) activePropertyTabs.set(stateKey, activeId);
    return activeId;
}

// ============================================================
// Icons Tab — per-character interface icon assignment
// ============================================================

function renderIconSectionTabBar(activeId) {
    return `
        <div class="wl-cdm-property-tabs wl-cdm-section-tabs" role="tablist"
             aria-label="Icons sections" aria-orientation="horizontal">
            ${ICON_SECTION_TABS.map(tab => {
                const active = tab.id === activeId;
                return `
                    <button type="button" role="tab"
                            class="wl-cdm-property-tab${active ? ' wl-cdm-property-tab-active' : ''}"
                            data-icon-section-tab="${tab.id}"
                            aria-selected="${active}"
                            aria-controls="wl-cdm-content"
                            tabindex="${active ? '0' : '-1'}">${tab.label}</button>
                `;
            }).join('')}
        </div>
    `;
}

function wireIconSectionTabBar(container) {
    const tabs = [...container.querySelectorAll('[data-icon-section-tab]')];
    const activate = tab => {
        if (!tab || tab.dataset.iconSectionTab === activeTab) return;
        cancelEdit();
        activeTab = tab.dataset.iconSectionTab;
        renderContent();
    };

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activate(tab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                    : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
            const next = tabs[nextIndex];
            activate(next);
            next?.focus();
        });
    });
}

function renderContainerSectionTabBar(activeId) {
    return `
        <div class="wl-cdm-property-tabs wl-cdm-section-tabs" role="tablist"
             aria-label="Container sections" aria-orientation="horizontal">
            ${CONTAINER_SECTION_TABS.map(tab => {
                const active = tab.id === activeId;
                return `
                    <button type="button" role="tab"
                            class="wl-cdm-property-tab${active ? ' wl-cdm-property-tab-active' : ''}"
                            data-container-section-tab="${tab.id}"
                            aria-selected="${active}"
                            aria-controls="wl-cdm-content"
                            tabindex="${active ? '0' : '-1'}">${tab.label}</button>
                `;
            }).join('')}
        </div>
    `;
}

function wireContainerSectionTabBar(container) {
    const tabs = [...container.querySelectorAll('[data-container-section-tab]')];
    const activate = tab => {
        if (!tab || tab.dataset.containerSectionTab === activeTab) return;
        cancelEdit();
        activeTab = tab.dataset.containerSectionTab;
        renderContent();
    };

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activate(tab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                    : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
            const next = tabs[nextIndex];
            activate(next);
            next?.focus();
        });
    });
}

function renderGeneralUiSectionTabBar(activeId) {
    const tabs = GENERAL_UI_SECTION_TABS.filter(tab =>
        tab.id !== 'generalUi-integrations' || hasGeneralUiIntegrations());
    if (tabs.length < 2) return '';
    return `
        <div class="wl-cdm-property-tabs wl-cdm-section-tabs" role="tablist"
             aria-label="General UI sections" aria-orientation="horizontal">
            ${tabs.map(tab => {
                const active = tab.id === activeId;
                return `
                    <button type="button" role="tab"
                            class="wl-cdm-property-tab${active ? ' wl-cdm-property-tab-active' : ''}"
                            data-general-ui-section-tab="${tab.id}"
                            aria-selected="${active}"
                            aria-controls="wl-cdm-content"
                            tabindex="${active ? '0' : '-1'}">${tab.label}</button>
                `;
            }).join('')}
        </div>
    `;
}

function wireGeneralUiSectionTabBar(container) {
    const tabs = [...container.querySelectorAll('[data-general-ui-section-tab]')];
    const activate = tab => {
        if (!tab || tab.dataset.generalUiSectionTab === activeTab) return;
        cancelEdit();
        activeTab = tab.dataset.generalUiSectionTab;
        renderContent();
    };

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activate(tab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                    : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
            const next = tabs[nextIndex];
            activate(next);
            next?.focus();
        });
    });
}

function renderIconsView(container) {
    const characters = getAvailableCharacters().sort((a, b) => a.name.localeCompare(b.name));
    const charTags = getCharacterTags();
    const choices = Object.fromEntries(ICON_AXES.map(axis => [axis, getIconChoices(axis)]));
    const defaults = Object.fromEntries(ICON_AXES.map(axis => [axis, getDefaultIconSet(axis)]));
    const customSets = getCustomTopbarSets();
    const defaultCustomSetId = getDefaultCustomTopbarSetId();

    const options = (axis, selected, allowInherit = false) => {
        const fallback = choices[axis].find(choice => choice.id === defaults[axis])?.label || 'Default';
        const inherit = allowInherit
            ? `<option value="">— Use default (${esc(fallback)}) —</option>`
            : '';
        return inherit + choices[axis].map(choice => `
            <option value="${esc(choice.id)}" ${choice.id === selected ? 'selected' : ''}>${esc(choice.label)}</option>
        `).join('');
    };

    const customOptions = (selected, allowInherit = false) => {
        const fallback = customSets.find(set => set.id === defaultCustomSetId)?.name || 'first available set';
        const inherit = allowInherit
            ? `<option value="">— Use global custom set (${esc(fallback)}) —</option>`
            : '';
        const choicesHtml = customSets.length
            ? customSets.map(set => `<option value="${esc(set.id)}" ${set.id === selected ? 'selected' : ''}>${esc(set.name)}</option>`).join('')
            : allowInherit ? '' : '<option value="">Create a custom set first</option>';
        return inherit + choicesHtml;
    };

    const defaultField = axis => `
        <label class="wl-cdm-ic-default-field">
            <span>${axis === 'general' ? 'General Icons' : 'Top Bar Icons'}</span>
            <select class="wl-cdm-select wl-cdm-ic-default" data-axis="${axis}">
                ${options(axis, defaults[axis])}
            </select>
            ${axis === 'topbar' ? `
                <select class="wl-cdm-select wl-cdm-ic-custom-default" ${defaults.topbar === 'custom' ? '' : 'hidden'}
                        aria-label="Global custom top bar set" ${customSets.length ? '' : 'disabled'}>
                    ${customOptions(defaultCustomSetId)}
                </select>` : ''}
        </label>`;

    const tagChips = renderTagFilter(charTags, 'wl-cdm-ic-tag-chips');

    const charRow = (c) => {
        const tagIds = (c.tags || []).map(t => t.id).join(' ');
        const tagNames = (c.tags || []).map(t => t.name).join(' ');
        const search = `${c.name} ${c.avatar} ${tagNames}`.toLowerCase();
        const selectedTopbar = getIconSetForCharacter(c.avatar, 'topbar');
        return `
            <div class="wl-cdm-ic-row wl-cdm-pickrow" data-search="${esc(search)}" data-tagids="${esc(tagIds)}">
                <div class="wl-cdm-ic-charname">${esc(c.name)} <span class="wl-cdm-pick-hint">${esc(c.avatar)}</span></div>
                ${ICON_AXES.map(axis => `
                    <label class="wl-cdm-ic-field">
                        <span>${axis === 'general' ? 'General' : 'Top Bar'}</span>
                        <select class="wl-cdm-select wl-cdm-ic-charselect" data-avatar="${esc(c.avatar)}" data-axis="${axis}">
                            ${options(axis, getIconSetForCharacter(c.avatar, axis), true)}
                        </select>
                    </label>
                `).join('')}
                <select class="wl-cdm-select wl-cdm-ic-char-custom" data-avatar="${esc(c.avatar)}"
                        aria-label="Custom top bar set for ${esc(c.name)}"
                        ${selectedTopbar === 'custom' ? '' : 'hidden'} ${customSets.length ? '' : 'disabled'}>
                    ${customOptions(getCustomTopbarSetForCharacter(c.avatar), true)}
                </select>
            </div>
        `;
    };

    container.innerHTML = `
        ${renderIconSectionTabBar('icons')}
        <div class="wl-cdm-core">
            <div class="wl-cdm-section-title">Default Icons</div>
            <div class="wl-cdm-field-hint">These are the same global choices shown in UI Bedazzler's extension settings. Groups and unassigned characters use them.</div>
            <div class="wl-cdm-ic-defaults">
                ${ICON_AXES.map(defaultField).join('')}
            </div>
            <div class="wl-cdm-ic-custom-bar">
                <div>
                    <strong>Custom Top Bar Sets</strong>
                    <span class="wl-cdm-ic-custom-count">${customSets.length} reusable ${customSets.length === 1 ? 'set' : 'sets'}</span>
                </div>
                <button type="button" class="menu_button" id="wl-cdm-edit-custom-icons">
                    <i class="fa-solid fa-icons"></i> Manage custom sets…
                </button>
            </div>

            <div class="wl-cdm-divider"></div>

            <div class="wl-cdm-section-title">Per-Character Icons</div>
            <div class="wl-cdm-field-hint">Override either icon set for a character. Personas aren't listed because they share the character's interface.</div>

            <div class="wl-cdm-pick-filter">
                <input type="text" class="wl-cdm-input wl-cdm-pick-search" id="wl-cdm-ic-search"
                       placeholder="Filter by name, tag, or file…">
                ${tagChips}
            </div>

            <div class="wl-cdm-ic-list" id="wl-cdm-ic-list">
                ${characters.length === 0
                    ? '<div class="wl-cdm-empty-small">No characters loaded</div>'
                    : characters.map(charRow).join('')
                }
                <div class="wl-cdm-empty-small wl-cdm-no-match" id="wl-cdm-ic-nomatch" style="display:none">No matches</div>
            </div>
        </div>
    `;

    wireIconSectionTabBar(container);
    wireIconsView(container);
}

function wireIconsView(container) {
    container.querySelector('#wl-cdm-edit-custom-icons')?.addEventListener('click', async () => {
        await openCustomTopbarIconEditor(getIconChoices('topbar'), getDefaultCustomTopbarSetId());
        void applyIconSetsForActiveChar();
        renderIconsView(container);
    });

    container.querySelector('.wl-cdm-ic-custom-default')?.addEventListener('change', select => {
        setDefaultCustomTopbarSetId(select.currentTarget.value);
        void applyIconSetsForActiveChar();
    });

    container.querySelectorAll('.wl-cdm-ic-default').forEach(select => {
        select.addEventListener('change', () => {
            setDefaultIconSet(select.dataset.axis, select.value);
            void applyIconSetsForActiveChar();
            renderIconsView(container);
        });
    });

    container.querySelectorAll('.wl-cdm-ic-charselect').forEach(select => {
        select.addEventListener('change', () => {
            setIconSetForCharacter(select.dataset.avatar, select.dataset.axis, select.value);
            if (select.dataset.axis === 'topbar') {
                const customSelect = select.closest('.wl-cdm-ic-row')?.querySelector('.wl-cdm-ic-char-custom');
                if (customSelect) customSelect.hidden = select.value !== 'custom';
            }
            void applyIconSetsForActiveChar();
        });
    });

    container.querySelectorAll('.wl-cdm-ic-char-custom').forEach(select => {
        select.addEventListener('change', () => {
            setCustomTopbarSetForCharacter(select.dataset.avatar, select.value);
            void applyIconSetsForActiveChar();
        });
    });

    const searchInput = container.querySelector('#wl-cdm-ic-search');
    const chips = [...container.querySelectorAll('#wl-cdm-ic-tag-chips .wl-cdm-tag-chip')];
    const rows = [...container.querySelectorAll('#wl-cdm-ic-list .wl-cdm-ic-row')];
    const noMatch = container.querySelector('#wl-cdm-ic-nomatch');
    const activeTags = new Set();

    const apply = () => {
        const query = (searchInput?.value || '').trim().toLowerCase();
        let visible = 0;
        for (const row of rows) {
            const rowTags = (row.dataset.tagids || '').split(' ').filter(Boolean);
            const matchesText = !query || (row.dataset.search || '').includes(query);
            const matchesTags = activeTags.size === 0 || rowTags.some(id => activeTags.has(id));
            const show = matchesText && matchesTags;
            row.style.display = show ? '' : 'none';
            if (show) visible++;
        }
        if (noMatch) noMatch.style.display = visible === 0 ? '' : 'none';
    };

    searchInput?.addEventListener('input', apply);
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const id = chip.dataset.tagid;
            if (activeTags.has(id)) {
                activeTags.delete(id);
                chip.classList.remove('wl-cdm-tag-chip-active');
            } else {
                activeTags.add(id);
                chip.classList.add('wl-cdm-tag-chip-active');
            }
            apply();
        });
    });
    wireTagFilterControls(container, '#wl-cdm-ic-tag-chips');
}

// ============================================================
// Side Buttons Tab — global default + per-character override
// ============================================================

function renderSideButtonStylesView(container) {
    const characters = getAvailableCharacters().sort((a, b) => a.name.localeCompare(b.name));
    const charTags = getCharacterTags();
    const choices = getSideButtonStyleChoices();
    const defaultStyle = getDefaultSideButtonStyle();

    const options = (selected, allowInherit = false) => {
        const fallback = choices.find(choice => choice.id === defaultStyle)?.label || 'Default';
        const inherit = allowInherit
            ? `<option value="">— Use default (${esc(fallback)}) —</option>`
            : '';
        return inherit + choices.map(choice => `
            <option value="${esc(choice.id)}" ${choice.id === selected ? 'selected' : ''}>${esc(choice.label)}</option>
        `).join('');
    };

    const tagChips = renderTagFilter(charTags, 'wl-cdm-sb-tag-chips');

    const charRow = (character) => {
        const tagIds = (character.tags || []).map(tag => tag.id).join(' ');
        const tagNames = (character.tags || []).map(tag => tag.name).join(' ');
        const search = `${character.name} ${character.avatar} ${tagNames}`.toLowerCase();
        return `
            <div class="wl-cdm-sb-row wl-cdm-pickrow" data-search="${esc(search)}" data-tagids="${esc(tagIds)}">
                <div class="wl-cdm-sb-charname">${esc(character.name)} <span class="wl-cdm-pick-hint">${esc(character.avatar)}</span></div>
                <label class="wl-cdm-sb-field">
                    <span>Style</span>
                    <select class="wl-cdm-select wl-cdm-sb-charselect" data-avatar="${esc(character.avatar)}">
                        ${options(getSideButtonStyleForCharacter(character.avatar), true)}
                    </select>
                </label>
            </div>
        `;
    };

    container.innerHTML = `
        <div class="wl-cdm-core">
            <div class="wl-cdm-section-title">Default Side Button Style</div>
            <div class="wl-cdm-field-hint">This is the same global choice shown in UI Bedazzler's extension settings. Groups and unassigned characters use it.</div>
            <label class="wl-cdm-sb-default-field">
                <span>Button Style</span>
                <select class="wl-cdm-select" id="wl-cdm-sb-default">
                    ${options(defaultStyle)}
                </select>
            </label>
            <div class="wl-cdm-field-hint">Use the small grip beside the live strip to drag it. The strip stays below the top bar automatically.</div>
            <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-sb-reset-position">
                <i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i>
                Reset strip position
            </button>

            <div class="wl-cdm-divider"></div>

            <div class="wl-cdm-section-title">Per-Character Side Buttons</div>
            <div class="wl-cdm-field-hint">Choose a character-specific style or inherit the global default. Personas share the character's interface.</div>

            <div class="wl-cdm-pick-filter">
                <input type="text" class="wl-cdm-input wl-cdm-pick-search" id="wl-cdm-sb-search"
                       placeholder="Filter by name, tag, or file…">
                ${tagChips}
            </div>

            <div class="wl-cdm-sb-list" id="wl-cdm-sb-list">
                ${characters.length === 0
                    ? '<div class="wl-cdm-empty-small">No characters loaded</div>'
                    : characters.map(charRow).join('')
                }
                <div class="wl-cdm-empty-small wl-cdm-no-match" id="wl-cdm-sb-nomatch" style="display:none">No matches</div>
            </div>
        </div>
    `;

    wireSideButtonStylesView(container);
}

function wireSideButtonStylesView(container) {
    container.querySelector('#wl-cdm-sb-reset-position')?.addEventListener('click', () => {
        resetSideButtonPosition();
    });
    container.querySelector('#wl-cdm-sb-default')?.addEventListener('change', (event) => {
        setDefaultSideButtonStyle(event.target.value);
        applySideButtonStyleForActiveChar();
        renderSideButtonStylesView(container);
    });

    container.querySelectorAll('.wl-cdm-sb-charselect').forEach(select => {
        select.addEventListener('change', () => {
            setSideButtonStyleForCharacter(select.dataset.avatar, select.value);
            applySideButtonStyleForActiveChar();
        });
    });

    const searchInput = container.querySelector('#wl-cdm-sb-search');
    const chips = [...container.querySelectorAll('#wl-cdm-sb-tag-chips .wl-cdm-tag-chip')];
    const rows = [...container.querySelectorAll('#wl-cdm-sb-list .wl-cdm-sb-row')];
    const noMatch = container.querySelector('#wl-cdm-sb-nomatch');
    const activeTags = new Set();

    const apply = () => {
        const query = (searchInput?.value || '').trim().toLowerCase();
        let visible = 0;
        for (const row of rows) {
            const rowTags = (row.dataset.tagids || '').split(' ').filter(Boolean);
            const matchesText = !query || (row.dataset.search || '').includes(query);
            const matchesTags = activeTags.size === 0 || rowTags.some(id => activeTags.has(id));
            const show = matchesText && matchesTags;
            row.style.display = show ? '' : 'none';
            if (show) visible++;
        }
        if (noMatch) noMatch.style.display = visible === 0 ? '' : 'none';
    };

    searchInput?.addEventListener('input', apply);
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const id = chip.dataset.tagid;
            if (activeTags.has(id)) {
                activeTags.delete(id);
                chip.classList.remove('wl-cdm-tag-chip-active');
            } else {
                activeTags.add(id);
                chip.classList.add('wl-cdm-tag-chip-active');
            }
            apply();
        });
    });
    wireTagFilterControls(container, '#wl-cdm-sb-tag-chips');
}

// ── Core / Overview ──

function renderCoreView(container) {
    const enabled = isChatDesignEnabled();
    const styles = getAllStyles();
    const countByElement = {};
    for (const s of styles) {
        countByElement[s.element] = (countByElement[s.element] || 0) + 1;
    }
    const containerStyleCount = (countByElement.container || 0) + (countByElement.banner || 0);

    container.innerHTML = `
        <div class="wl-cdm-core">
            <div class="wl-cdm-setting-row">
                <div class="wl-cdm-setting-info">
                    <div class="wl-cdm-setting-title">Enable Chat Design</div>
                    <div class="wl-cdm-setting-desc">Apply custom typography, borders, and effects to chat messages</div>
                </div>
                <label class="wl-toggle">
                    <input type="checkbox" id="wl-cdm-enabled" ${enabled ? 'checked' : ''}>
                    <span class="wl-toggle-slider"></span>
                </label>
            </div>

            <div class="wl-cdm-divider"></div>

            <div class="wl-cdm-overview-title">Style Overview</div>
            <div class="wl-cdm-overview-grid">
                ${renderOverviewCard('Fonts', 'fa-font', countByElement.dialogue || 0, 'dialogue')}
                ${renderOverviewCard('Container', 'fa-square', containerStyleCount, 'container')}
                ${renderOverviewCard('Message Elements', 'fa-layer-group', countByElement.avatar || 0, 'avatar')}
                ${renderOverviewCard('General UI', 'fa-window-maximize', countByElement.generalUi || 0, 'generalUi')}
                ${renderOverviewCard('Background', 'fa-image', countByElement.background || 0, 'background')}
                ${renderOverviewCard('Cursor', 'fa-arrow-pointer', countByElement.cursor || 0, 'cursor')}
            </div>
            <div class="wl-cdm-overview-grid wl-cdm-configuration-grid" aria-label="Settings configurations">
                ${renderOverviewCard('Themes', 'fa-palette', null, 'themes', 'Settings')}
                ${renderOverviewCard('Icons', 'fa-icons', null, 'icons', 'Settings')}
                ${renderOverviewCard('Side Buttons', 'fa-grip-vertical', null, 'side-buttons', 'Settings')}
            </div>

            <div class="wl-cdm-how-it-works">
                <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                <span><strong>How it works:</strong> Create styles here and assign them to characters, personas${isVMAvailable() ? ', or verses' : ''} to customize their chat appearance.</span>
            </div>
        </div>
    `;

    // Wire enable toggle
    container.querySelector('#wl-cdm-enabled')?.addEventListener('change', (e) => {
        setChatDesignEnabled(e.target.checked);
        onChatDesignToggleChanged(e.target.checked);
    });

    // Wire overview card clicks
    container.querySelectorAll('.wl-cdm-overview-card').forEach(card => {
        card.addEventListener('click', event => {
            if (performance.now() < navigationLockedUntil) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            activeTab = card.dataset.tab;
            renderContent();
        });
    });
}

function renderOverviewCard(label, icon, count, tabId, summary = null) {
    const detail = summary ?? `${count} style${count !== 1 ? 's' : ''}`;
    return `
        <div class="wl-cdm-overview-card" data-tab="${tabId}">
            <i class="fa-solid ${icon}"></i>
            <div class="wl-cdm-overview-card-info">
                <span class="wl-cdm-overview-label">${label}</span>
                <span class="wl-cdm-overview-count">${detail}</span>
            </div>
        </div>
    `;
}

// ── Element List View ──

function renderElementList(container) {
    const isTopBarIconSection = activeTab === 'icons-top-bar';
    const isGeneralUiIntegrationSection = activeTab === 'generalUi-integrations';
    const elementType = isTopBarIconSection || isGeneralUiIntegrationSection ? 'generalUi' : activeTab;
    const uiSection = isGeneralUiIntegrationSection ? 'integrations' : 'native';
    const styles = getStylesForElement(elementType).filter(style =>
        elementType !== 'generalUi' || style.uiSection === uiSection);
    const label = isTopBarIconSection
        ? 'Top Bar Icon'
        : isGeneralUiIntegrationSection ? 'Integrations UI' : ELEMENT_LABELS[elementType] || elementType;
    const sectionTabs = isTopBarIconSection
        ? renderIconSectionTabBar(activeTab)
        : (activeTab === 'container' || activeTab === 'banner')
            ? renderContainerSectionTabBar(activeTab)
            : (activeTab === 'generalUi' || isGeneralUiIntegrationSection)
                ? renderGeneralUiSectionTabBar(activeTab)
                : '';
    const sectionHint = isTopBarIconSection
        ? 'These are the same character-scoped styles used by General UI. Creating, assigning, or deleting one here also updates the matching General UI style.'
        : isGeneralUiIntegrationSection
            ? 'Integration styles are independent from Native General UI styles. Only detected, enabled integrations appear below.'
            : '';

    container.innerHTML = `
        ${sectionTabs}
        ${sectionHint ? `<div class="wl-cdm-field-hint wl-cdm-section-tab-hint">${sectionHint}</div>` : ''}
        <div class="wl-cdm-element-header">
            <span class="wl-cdm-element-title">${label} Styles</span>
            <button class="wl-cdm-btn wl-cdm-btn-accent" id="wl-cdm-add-style">
                <i class="fa-solid fa-plus"></i> New Style
            </button>
        </div>
        <div class="wl-cdm-style-list" id="wl-cdm-style-list">
            ${styles.length === 0
                ? `<div class="wl-cdm-empty">No ${label.toLowerCase()} styles yet. Create one to get started.</div>`
                : styles.map(s => renderStyleCard(s)).join('')
            }
        </div>
    `;

    wireIconSectionTabBar(container);
    wireContainerSectionTabBar(container);
    wireGeneralUiSectionTabBar(container);

    // Wire add button
    container.querySelector('#wl-cdm-add-style')?.addEventListener('click', () => {
        const style = createStyle(elementType, undefined, { uiSection });
        startEdit(style.id);
    });

    // Wire style card actions
    container.querySelectorAll('.wl-cdm-style-card').forEach(card => {
        const styleId = card.dataset.styleId;

        card.querySelector('.wl-cdm-card-toggle')?.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        card.querySelector('.wl-cdm-card-enabled')?.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            updateStyleMeta(styleId, { enabled });
            card.classList.toggle('wl-cdm-style-card-disabled', !enabled);
            e.target.setAttribute('aria-label', `${enabled ? 'Disable' : 'Enable'} ${getStyleById(styleId)?.name || 'style'}`);
            e.target.closest('.wl-cdm-card-toggle').title = `${enabled ? 'Disable' : 'Enable'} this style`;
            refreshChatDesignCSS();
        });
        card.querySelector('.wl-cdm-card-edit')?.addEventListener('click', (e) => {
            e.stopPropagation();
            startEdit(styleId);
        });
        card.querySelector('.wl-cdm-card-dup')?.addEventListener('click', (e) => {
            e.stopPropagation();
            duplicateStyle(styleId);
            refreshChatDesignCSS();
            renderContent();
        });
        card.querySelector('.wl-cdm-card-del')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const selectedStyle = getStyleById(styleId);
            const styleName = selectedStyle?.name || 'this style';
            const matchingStyles = selectedStyle
                ? getAllStyles().filter(style => style.name === selectedStyle.name)
                : [];
            let deleted = false;
            try {
                const { callGenericPopup, POPUP_RESULT, POPUP_TYPE } = await import('../../../../../../scripts/popup.js');
                if (matchingStyles.length > 1) {
                    const categories = [...new Set(matchingStyles.map(style => ELEMENT_LABELS[style.element] || style.element))].join(', ');
                    const result = await callGenericPopup(
                        `There are ${matchingStyles.length} styles named “${esc(styleName)}” across ${esc(categories)}. Delete only this style, or delete the complete same-name set?<br><br>The saved theme and custom icon set are not affected.`,
                        POPUP_TYPE.CONFIRM,
                        '',
                        {
                            okButton: 'Delete this style',
                            cancelButton: false,
                            defaultResult: POPUP_RESULT.CANCELLED,
                            customButtons: [
                                { text: `Delete all ${matchingStyles.length} styles`, result: POPUP_RESULT.CUSTOM1, appendAtEnd: true, icon: 'fa-trash' },
                                { text: 'Cancel', result: POPUP_RESULT.CANCELLED, appendAtEnd: true },
                            ],
                        },
                    );
                    if (result === POPUP_RESULT.CUSTOM1) deleted = deleteStyles(matchingStyles.map(style => style.id)) > 0;
                    else if (result === POPUP_RESULT.AFFIRMATIVE) deleted = deleteStyle(styleId);
                } else {
                    const result = await callGenericPopup(
                        `Delete style “${esc(styleName)}”?`,
                        POPUP_TYPE.CONFIRM,
                        '',
                        { okButton: 'Delete', cancelButton: 'Cancel' },
                    );
                    if (result === POPUP_RESULT.AFFIRMATIVE) deleted = deleteStyle(styleId);
                }
            } catch {
                // Fallback if popup module unavailable
                if (matchingStyles.length > 1) {
                    if (confirm(`Delete all ${matchingStyles.length} styles named “${styleName}”?\n\nChoose Cancel to keep the set and decide whether to delete only this style.`)) {
                        deleted = deleteStyles(matchingStyles.map(style => style.id)) > 0;
                    } else if (confirm(`Delete only this “${styleName}” style?`)) {
                        deleted = deleteStyle(styleId);
                    }
                } else if (confirm(`Delete style “${styleName}”?`)) {
                    deleted = deleteStyle(styleId);
                }
            }
            if (deleted) {
                refreshChatDesignCSS();
                renderContent();
            }
        });

        card.querySelector('.wl-cdm-card-body')?.addEventListener('click', () => startEdit(styleId));
    });
}

function renderStyleCard(style) {
    const assignInfo = getAssignmentSummary(style);
    const enabled = style.enabled !== false;
    return `
        <div class="wl-cdm-style-card${enabled ? '' : ' wl-cdm-style-card-disabled'}" data-style-id="${style.id}">
            <button type="button" class="wl-cdm-card-body" aria-label="Edit ${esc(style.name)}">
                <div class="wl-cdm-card-name">${esc(style.name)}</div>
                <div class="wl-cdm-card-assign">${assignInfo}</div>
            </button>
            <div class="wl-cdm-card-actions">
                <label class="wl-cdm-card-toggle" title="${enabled ? 'Disable' : 'Enable'} this style">
                    <input class="wl-cdm-card-enabled" type="checkbox" ${enabled ? 'checked' : ''}
                           aria-label="${enabled ? 'Disable' : 'Enable'} ${esc(style.name)}">
                    <span class="wl-cdm-card-toggle-track" aria-hidden="true"></span>
                </label>
                <button type="button" class="wl-cdm-card-edit" title="Edit" aria-label="Edit ${esc(style.name)}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                <button type="button" class="wl-cdm-card-dup" title="Duplicate" aria-label="Duplicate ${esc(style.name)}"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>
                <button type="button" class="wl-cdm-card-del" title="Delete" aria-label="Delete ${esc(style.name)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
            </div>
        </div>
    `;
}

function getAssignmentSummary(style) {
    if (style.isDefault) {
        const chatScoped = style.element === 'background'
            || style.element === 'cursor'
            || style.element === 'generalUi';
        return chatScoped ? 'Default (all chats)' : 'Default (all messages)';
    }
    const parts = [];
    if (style.assignedCharacters?.length) parts.push(`${style.assignedCharacters.length} character(s)`);
    if (style.assignedPersonas?.length) parts.push(`${style.assignedPersonas.length} persona(s)`);
    if (style.assignedVerses?.length) parts.push(`${style.assignedVerses.length} verse(s)`);
    return parts.length > 0 ? parts.join(', ') : 'Unassigned';
}

// ============================================================
// Editor
// ============================================================

function startEdit(styleId) {
    const style = getStyleById(styleId);
    if (!style) return;
    editingStyleId = styleId;
    editingSnapshot = JSON.parse(JSON.stringify(style));
    renderContent();
}

function cancelEdit() {
    if (editingStyleId && editingSnapshot) {
        const style = getStyleById(editingStyleId);
        if (style) {
            // Restore snapshot
            Object.assign(style, JSON.parse(JSON.stringify(editingSnapshot)));
        }
    }
    editingStyleId = null;
    editingSnapshot = null;
}

function saveEdit() {
    editingStyleId = null;
    editingSnapshot = null;
    refreshChatDesignCSS();
}

function isTopBarIconEditor(style) {
    return activeTab === 'icons-top-bar' && style?.element === 'generalUi';
}

function isGeneralUiIntegrationEditor(style) {
    return activeTab === 'generalUi-integrations'
        && style?.element === 'generalUi'
        && style.uiSection === 'integrations';
}

function getEditorPropertyTabsForStyle(style) {
    return isTopBarIconEditor(style) ? [] : getEditorPropertyTabs(style.element);
}

function renderEditorProperties(style, activePropertyTab = '') {
    if (isTopBarIconEditor(style)) return renderGeneralUiIconProps(style.properties);
    if (isGeneralUiIntegrationEditor(style) && !activePropertyTab) {
        return '<div class="wl-cdm-empty">No supported General UI integrations are currently available.</div>';
    }
    return renderPropertiesForElement(style.element, style.properties, activePropertyTab);
}

function renderEditor(container) {
    const style = getStyleById(editingStyleId);
    if (!style) {
        editingStyleId = null;
        renderContent();
        return;
    }

    const elementType = style.element;
    const propertyTabs = getEditorPropertyTabsForStyle(style);
    const activePropertyTab = getActivePropertyTab(elementType, propertyTabs);
    const forcePropertyTabBar = isGeneralUiIntegrationEditor(style);
    const hasPropertyTabBar = propertyTabs.length > 1 || (forcePropertyTabBar && propertyTabs.length > 0);
    const propertyPanelAttrs = hasPropertyTabBar
        ? ` role="tabpanel" aria-labelledby="wl-cdm-property-tab-${activePropertyTab}"`
        : '';

    container.innerHTML = `
        <div class="wl-cdm-editor">
            <div class="wl-cdm-editor-sticky">
                <div class="wl-cdm-editor-header">
                    <button class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-back">
                        <i class="fa-solid fa-arrow-left"></i> Back
                    </button>
                    <div class="wl-cdm-editor-actions">
                        <button class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-cancel">Cancel</button>
                        <button class="wl-cdm-btn wl-cdm-btn-accent" id="wl-cdm-save">Save</button>
                    </div>
                </div>
                ${isTopBarIconEditor(style)
                    ? renderIconSectionTabBar(activeTab)
                    : style.element === 'generalUi'
                        ? renderGeneralUiSectionTabBar(activeTab)
                        : ''}
                ${isTopBarIconEditor(style)
                    ? ''
                    : renderPropertyTabBar(elementType, propertyTabs, activePropertyTab, { forceVisible: forcePropertyTabBar })}
                ${renderChatDesignPreview(elementType)}
            </div>

            <div class="wl-cdm-editor-scroll">
                <!-- Style Name -->
                <div class="wl-cdm-field-grid">
                    <div class="wl-cdm-field">
                        <label class="wl-cdm-field-label">Style Name</label>
                        <input type="text" class="wl-cdm-input" id="wl-cdm-style-name" value="${esc(style.name)}">
                    </div>
                </div>

                <div class="wl-cdm-divider"></div>

                <!-- Properties -->
                ${hasPropertyTabBar ? '' : '<div class="wl-cdm-section-title">Properties</div>'}
                <div class="wl-cdm-props" id="wl-cdm-props"${propertyPanelAttrs}>
                    ${renderEditorProperties(style, activePropertyTab)}
                </div>

                <div class="wl-cdm-divider"></div>

                <!-- Assignment -->
                <div class="wl-cdm-section-title">Assignment</div>
                <div class="wl-cdm-assignment" id="wl-cdm-assignment">
                    <div class="wl-cdm-empty-small">Loading…</div>
                </div>
            </div>
        </div>
    `;

    // Assignment panel enumerates persona avatar files asynchronously
    // (getAvailablePersonas is async), so render it into the placeholder
    // once resolved, then wire its events.
    renderAssignmentInto(container, style);

    // Cursor styles have a bespoke, discovery-driven property panel that fills
    // its placeholder asynchronously (like the assignment panel above).
    if (style.element === 'cursor') {
        renderCursorPanelInto(container, style);
    }

    wireEditorEvents(container, style);
    wireChatDesignPreview(container, style);
}

// ============================================================
// Property Renderers (per element type)
// ============================================================

function renderPropertiesForElement(elementType, props, activePropertyTab = '') {
    switch (elementType) {
        case 'dialogue': return renderFontsProps(props, activePropertyTab);
        case 'banner': return renderBannerProps(props);
        case 'container': return renderContainerProps(props, activePropertyTab);
        case 'avatar': return renderMessageElementsProps(props, activePropertyTab);
        case 'generalUi': return renderGeneralUiProps(props, activePropertyTab);
        case 'background': return renderBackgroundProps(props);
        case 'cursor': return renderCursorProps(props);
        default: return '<div class="wl-cdm-empty">Unknown element type</div>';
    }
}

function renderActivePropertySection(sections, activeId) {
    const section = sections[activeId] || Object.values(sections)[0];
    if (!section) return '';
    return `
        ${section.hint ? `<div class="wl-cdm-property-tab-hint">${section.hint}</div>` : ''}
        ${section.content}
    `;
}

function renderSelectField(label, fieldId, value, options) {
    return `
        <div class="wl-cdm-field wl-cdm-compact-field">
            <label class="wl-cdm-field-label">${label}</label>
            <select class="wl-cdm-select" id="${fieldId}">
                ${Object.entries(options).map(([val, text]) =>
                    `<option value="${val}" ${val === String(value) ? 'selected' : ''}>${text}</option>`
                ).join('')}
            </select>
        </div>
    `;
}

function renderRangeField(label, fieldId, value, min, max, step, unit = '', hint = '') {
    return `
        <div class="wl-cdm-field wl-cdm-compact-field">
            <label class="wl-cdm-field-label">${label}</label>
            <div class="wl-cdm-range-row">
                <input type="range" class="wl-cdm-range" id="${fieldId}" min="${min}" max="${max}" step="${step}" value="${value}">
                <span class="wl-cdm-range-val" id="${fieldId}-val">${value}${unit}</span>
            </div>
            ${hint ? `<div class="wl-cdm-field-hint wl-cdm-field-hint-after">${hint}</div>` : ''}
        </div>
    `;
}

function renderWidthField(label, fieldId, value, hint = '') {
    const fixedWidth = Number(value) > 0;
    const sliderValue = fixedWidth ? Number(value) : 600;
    return `
        <div class="wl-cdm-field wl-cdm-compact-field">
            <div class="wl-cdm-field-label-row">
                <label class="wl-cdm-field-label">${label}</label>
                <label class="wl-cdm-use-custom">
                    <input type="checkbox" data-wl-width-fill="${fieldId}" ${fixedWidth ? '' : 'checked'}>
                    <span>Fill available width</span>
                </label>
            </div>
            <div data-wl-width-fixed="${fieldId}" ${fixedWidth ? '' : 'hidden'}>
                <div class="wl-cdm-range-row">
                    <input type="range" class="wl-cdm-range" id="${fieldId}" min="100" max="1200" step="10" value="${sliderValue}">
                    <span class="wl-cdm-range-val" id="${fieldId}-val">${sliderValue}px</span>
                </div>
            </div>
            ${hint ? `<div class="wl-cdm-field-hint wl-cdm-field-hint-after">${hint}</div>` : ''}
        </div>
    `;
}

function renderFieldRow(fields, hint = '') {
    return `
        <div class="wl-cdm-field-grid">
            ${fields.join('')}
            ${hint ? `<div class="wl-cdm-field-hint wl-cdm-field-grid-hint">${hint}</div>` : ''}
        </div>
    `;
}

function normalizeHexColor(value) {
    let hex = String(value || '').trim();
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (/^#[a-f\d]{3}$/i.test(hex)) {
        hex = `#${[...hex.slice(1)].map(channel => channel.repeat(2)).join('')}`;
    }
    return /^#[a-f\d]{6}$/i.test(hex) ? hex.toLowerCase() : null;
}

function renderColorField(label, fieldId, value) {
    const color = normalizeHexColor(value) || '#ffffff';
    return `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">${label}</label>
            <div class="wl-cdm-color-row">
                <input type="color" class="wl-cdm-color" id="${fieldId}" value="${color}">
                <input type="text" class="wl-cdm-color-hex-input" data-wl-color-id="${fieldId}"
                       value="${color}" aria-label="${esc(label)} HEX value" spellcheck="false">
            </div>
        </div>
    `;
}

function renderShadowField(label, fieldId, value) {
    return `
        <div class="wl-cdm-field wl-cdm-compact-field">
            <label class="wl-cdm-field-label">${label}</label>
            <select class="wl-cdm-select wl-cdm-shadow-select" id="${fieldId}">
                <option value="none" ${value === 'none' || !value ? 'selected' : ''}>None</option>
                <option value="0 0 4px rgba(255,255,255,0.3)" ${value === '0 0 4px rgba(255,255,255,0.3)' ? 'selected' : ''}>Soft Glow (white)</option>
                <option value="0 0 6px rgba(180,160,140,0.5)" ${value === '0 0 6px rgba(180,160,140,0.5)' ? 'selected' : ''}>Soft Glow (warm)</option>
                <option value="0 0 8px rgba(100,150,255,0.4)" ${value === '0 0 8px rgba(100,150,255,0.4)' ? 'selected' : ''}>Soft Glow (blue)</option>
                <option value="1px 1px 2px rgba(0,0,0,0.8)" ${value === '1px 1px 2px rgba(0,0,0,0.8)' ? 'selected' : ''}>Drop Shadow</option>
                <option value="2px 2px 4px rgba(0,0,0,0.6)" ${value === '2px 2px 4px rgba(0,0,0,0.6)' ? 'selected' : ''}>Deep Shadow</option>
                <option value="0 0 10px rgba(255,100,100,0.5)" ${value === '0 0 10px rgba(255,100,100,0.5)' ? 'selected' : ''}>Neon (red)</option>
                <option value="0 0 10px rgba(100,255,100,0.5)" ${value === '0 0 10px rgba(100,255,100,0.5)' ? 'selected' : ''}>Neon (green)</option>
                <option value="0 0 10px rgba(200,100,255,0.5)" ${value === '0 0 10px rgba(200,100,255,0.5)' ? 'selected' : ''}>Neon (purple)</option>
                <option value="0 1px 0 rgba(255,255,255,0.2)" ${value === '0 1px 0 rgba(255,255,255,0.2)' ? 'selected' : ''}>Letterpress</option>
            </select>
        </div>
    `;
}

function renderInputField(label, fieldId, value, placeholder = '') {
    return `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">${label}</label>
            <input type="text" class="wl-cdm-input" id="${fieldId}" value="${value || ''}" placeholder="${placeholder}">
        </div>
    `;
}

function renderCheckboxField(label, fieldId, checked, hint = '') {
    return `
        <div class="wl-cdm-field">
            <label class="wl-cdm-checkbox-item">
                <input type="checkbox" class="wl-cdm-prop-checkbox" id="${fieldId}" ${checked ? 'checked' : ''}>
                <span>${label}</span>
            </label>
            ${hint ? `<div class="wl-cdm-field-hint">${hint}</div>` : ''}
        </div>
    `;
}

// ── Name Properties ──

function renderNameProps(p, prefix = 'name') {
    const key = property => fontProperty(prefix, property);
    for (const [property, value] of Object.entries(NAME_DEFAULTS)) {
        const propertyKey = key(property);
        if (!(propertyKey in p)) p[propertyKey] = value;
    }
    return `
        ${renderFontPicker(p[key('fontFamily')], `wl-cdm-p-${key('fontFamily')}`)}
        ${renderSelectField('Font Size', `wl-cdm-p-${key('fontSize')}`, p[key('fontSize')], {
            '0.8em': '0.8em', '0.9em': '0.9em', '1em': '1em (default)', '1.1em': '1.1em',
            '1.2em': '1.2em', '1.3em': '1.3em', '1.5em': '1.5em', '1.8em': '1.8em', '2em': '2em',
            '2.5em': '2.5em', '3em': '3em', '3.5em': '3.5em', '4em': '4em', '5em': '5em',
            '6em': '6em', '7em': '7em', '8em': '8em',
        })}
        ${renderFieldRow([
            renderSelectField('Font Weight', `wl-cdm-p-${key('fontWeight')}`, p[key('fontWeight')], {
                '300': 'Light (300)', '400': 'Regular (400)', '500': 'Medium (500)',
                '600': 'Semi-Bold (600)', '700': 'Bold (700)', '900': 'Black (900)',
            }),
            renderSelectField('Font Style', `wl-cdm-p-${key('fontStyle')}`, p[key('fontStyle')], {
                'normal': 'Normal', 'italic': 'Italic',
            }),
        ])}
        ${renderFieldRow([
            renderSelectField('Text Transform', `wl-cdm-p-${key('textTransform')}`, p[key('textTransform')], {
                'none': 'None', 'uppercase': 'UPPERCASE', 'lowercase': 'lowercase',
                'capitalize': 'Capitalize',
            }),
            renderSelectField('Letter Spacing', `wl-cdm-p-${key('letterSpacing')}`, p[key('letterSpacing')], {
                '0px': '0px (default)', '0.5px': '0.5px', '1px': '1px',
                '2px': '2px', '3px': '3px', '5px': '5px',
            }),
        ])}
        ${renderShadowField('Text Shadow', `wl-cdm-p-${key('textShadow')}`, p[key('textShadow')])}
        <div class="wl-cdm-subsection">Name Text Fill</div>
        ${renderSelectField('Fill', `wl-cdm-p-${key('fillMode')}`, p[key('fillMode')], {
            theme: 'Active theme', gradient: 'Two-color gradient',
        })}
        <div data-wl-name-fill-conditional="gradient" ${p[key('fillMode')] === 'gradient' ? '' : 'hidden'}>
            ${renderFieldRow([
                renderColorField('Start Color', `wl-cdm-p-${key('fillStartColor')}`, p[key('fillStartColor')]),
                renderColorField('End Color', `wl-cdm-p-${key('fillEndColor')}`, p[key('fillEndColor')]),
            ], 'The gradient is clipped to the visible speaker-name letters; Name Background remains independent.')}
            ${renderRangeField('Direction', `wl-cdm-p-${key('fillAngle')}`, p[key('fillAngle')], 0, 360, 1, '°', '0° runs bottom to top; 90° runs left to right.')}
        </div>
        ${renderFieldRow([
            renderSelectField('Alignment', `wl-cdm-p-${key('textAlign')}`, p[key('textAlign')], {
                left: 'Left', center: 'Center', right: 'Right',
            }),
            renderRangeField('Horizontal Offset', `wl-cdm-p-${key('offsetX')}`, p[key('offsetX')], -400, 800, 1, 'px'),
            renderRangeField('Vertical Offset', `wl-cdm-p-${key('offsetY')}`, p[key('offsetY')], -250, 250, 1, 'px'),
        ], 'Alignment positions the name cluster within its header row; offsets fine-tune it from that anchor')}
        ${renderCheckboxField('Keep name on one line', `wl-cdm-p-${key('noWrap')}`, p[key('noWrap')], 'Prevents long names from wrapping; they extend away from the selected alignment anchor instead.')}
        <div class="wl-cdm-subsection">Name Background</div>
        ${renderSelectField('Fill', `wl-cdm-p-${key('backgroundFillMode')}`, p[key('backgroundFillMode')], {
            solid: 'Solid color', gradient: 'Two-color gradient',
        })}
        ${renderFieldRow([
            renderColorField('Primary Color', `wl-cdm-p-${key('backgroundColor')}`, p[key('backgroundColor')]),
            renderRangeField('Background Opacity', `wl-cdm-p-${key('backgroundOpacity')}`, p[key('backgroundOpacity')], 0, 1, 0.05, ''),
        ])}
        <div data-wl-name-background-conditional="gradient" ${p[key('backgroundFillMode')] === 'gradient' ? '' : 'hidden'}>
            ${renderFieldRow([
                renderColorField('Secondary Color', `wl-cdm-p-${key('backgroundSecondaryColor')}`, p[key('backgroundSecondaryColor')]),
                renderRangeField('Gradient Direction', `wl-cdm-p-${key('backgroundAngle')}`, p[key('backgroundAngle')], 0, 360, 1, '°'),
            ])}
        </div>
        ${renderFieldRow([
            renderRangeField('Background Width', `wl-cdm-p-${key('backgroundWidth')}`, p[key('backgroundWidth')], 0, 400, 5, 'px'),
            renderRangeField('Background Height', `wl-cdm-p-${key('backgroundHeight')}`, p[key('backgroundHeight')], 0, 120, 2, 'px'),
        ], '0 = fit the name automatically on that axis')}
        ${renderFieldRow([
            renderRangeField('Text Horizontal Offset', `wl-cdm-p-${key('backgroundTextOffsetX')}`, p[key('backgroundTextOffsetX')], -40, 40, 1, 'px'),
            renderRangeField('Text Vertical Offset', `wl-cdm-p-${key('backgroundTextOffsetY')}`, p[key('backgroundTextOffsetY')], -20, 20, 1, 'px'),
        ], 'Moves the text within the background without moving the background itself')}
        ${renderSelectField('Background Shape', `wl-cdm-p-${key('backgroundShape')}`, p[key('backgroundShape')], {
            square: 'Square', rounded: 'Rounded', pill: 'Pill',
        })}
    `;
}

function renderThemeSelectField(label, fieldId, toggleFieldId, enabled, value, options, hint = '') {
    const entries = Object.entries(options);
    const selectedValue = Object.hasOwn(options, String(value)) ? String(value) : entries[0]?.[0] || '';
    const customKey = toggleFieldId.replace('wl-cdm-p-', '');
    return `
        <div class="wl-cdm-field wl-cdm-compact-field" data-wl-custom-field="${customKey}">
            <div class="wl-cdm-field-label-row">
                <label class="wl-cdm-field-label" for="${fieldId}">${label}</label>
                <label class="wl-cdm-use-custom">
                    <input type="checkbox" class="wl-cdm-prop-checkbox" id="${toggleFieldId}"
                           data-wl-custom-select="${fieldId}" ${enabled ? 'checked' : ''}>
                    <span>Use Custom</span>
                </label>
            </div>
            <select class="wl-cdm-select" id="${fieldId}" data-wl-custom-dependent="${customKey}" ${enabled ? '' : 'disabled'}>
                ${entries.map(([optionValue, text]) =>
                    `<option value="${optionValue}" ${optionValue === selectedValue ? 'selected' : ''}>${text}</option>`
                ).join('')}
            </select>
            ${hint ? `<div class="wl-cdm-field-hint wl-cdm-field-hint-after">${hint}</div>` : ''}
        </div>
    `;
}

function renderCustomModeToggle(label, fieldId, mode, hint = '', offValue = 'theme') {
    const enabled = mode === 'custom';
    return `
        <div class="wl-cdm-field">
            <div class="wl-cdm-field-label-row">
                <span class="wl-cdm-field-label">${label}</span>
                <label class="wl-cdm-use-custom">
                    <input type="checkbox" class="wl-cdm-mode-checkbox" id="${fieldId}"
                           data-wl-mode-off="${offValue}" ${enabled ? 'checked' : ''}>
                    <span>Use Custom</span>
                </label>
            </div>
            ${hint ? `<div class="wl-cdm-field-hint wl-cdm-field-hint-after">${hint}</div>` : ''}
        </div>
    `;
}

function renderThemeColorField(label, colorFieldId, toggleFieldId, enabled, value, hint = '') {
    const color = normalizeHexColor(value) || '#142536';
    const customKey = toggleFieldId.replace('wl-cdm-p-', '');
    return `
        <div class="wl-cdm-field" data-wl-custom-field="${customKey}">
            <div class="wl-cdm-field-label-row">
                <label class="wl-cdm-field-label" for="${colorFieldId}">${label}</label>
                <label class="wl-cdm-use-custom">
                    <input type="checkbox" class="wl-cdm-prop-checkbox" id="${toggleFieldId}" ${enabled ? 'checked' : ''}>
                    <span>Use Custom</span>
                </label>
            </div>
            <div class="wl-cdm-color-row">
                <input type="color" class="wl-cdm-color" id="${colorFieldId}" value="${color}"
                       data-wl-custom-dependent="${customKey}" ${enabled ? '' : 'disabled'}>
                <input type="text" class="wl-cdm-color-hex-input" data-wl-color-id="${colorFieldId}"
                       data-wl-custom-dependent="${customKey}" value="${color}"
                       aria-label="${esc(label)} HEX value" spellcheck="false" ${enabled ? '' : 'disabled'}>
            </div>
            ${hint ? `<div class="wl-cdm-field-hint wl-cdm-field-hint-after">${hint}</div>` : ''}
        </div>
    `;
}

function renderActionSurfaceColorField(label, fieldId, value) {
    const transparent = value === 'transparent' || /^#[0-9a-f]{6}00$/i.test(value || '');
    const fallback = ELEMENT_DEFAULTS.avatar[fieldId.replace('wl-cdm-p-', '')] || '#000000';
    const swatch = transparent ? fallback : value;
    return `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">${label}</label>
            <div class="wl-cdm-color-row">
                <input type="color" class="wl-cdm-color" id="${fieldId}" value="${swatch}" ${transparent ? 'disabled' : ''}>
                <input type="text" class="wl-cdm-color-hex-input" data-wl-color-id="${fieldId}"
                       value="${transparent ? 'transparent' : swatch}" aria-label="${esc(label)} HEX value" spellcheck="false" ${transparent ? 'disabled' : ''}>
                <label class="wl-cdm-color-transparent">
                    <input type="checkbox" data-wl-action-transparent="${fieldId}" ${transparent ? 'checked' : ''}>
                    <span>No fill</span>
                </label>
            </div>
        </div>
    `;
}

function renderPropertyGroup(label, content, open = false, hint = '') {
    return `
        <details class="wl-cdm-property-group" ${open ? 'open' : ''}>
            <summary class="wl-cdm-property-group-header">
                <span>${label}</span>
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </summary>
            <div class="wl-cdm-property-group-content">
                ${hint ? `<div class="wl-cdm-property-group-hint">${hint}</div>` : ''}
                ${content}
            </div>
        </details>
    `;
}

// ── Font Properties ──

function fontProperty(prefix, property) {
    if (!prefix) return property;
    return `${prefix}${property[0].toUpperCase()}${property.slice(1)}`;
}

function renderFontFields(p, prefix = '') {
    const key = property => fontProperty(prefix, property);
    return `
        ${renderFontPicker(p[key('fontFamily')], `wl-cdm-p-${key('fontFamily')}`, {
            useCustom: p[key('fontFamilyUseCustom')],
            useCustomFieldId: `wl-cdm-p-${key('fontFamilyUseCustom')}`,
        })}
        ${renderSelectField('Font Size', `wl-cdm-p-${key('fontSize')}`, p[key('fontSize')], {
            '0.8em': '0.8em', '0.9em': '0.9em', '1em': '1em (default)', '1.05em': '1.05em',
            '1.1em': '1.1em', '1.15em': '1.15em', '1.2em': '1.2em', '1.3em': '1.3em',
            '1.4em': '1.4em', '1.5em': '1.5em',
        })}
        ${renderFieldRow([
            renderSelectField('Font Weight', `wl-cdm-p-${key('fontWeight')}`, p[key('fontWeight')], {
                '300': 'Light (300)', '400': 'Regular (400)', '500': 'Medium (500)',
                '600': 'Semi-Bold (600)', '700': 'Bold (700)',
            }),
            renderSelectField('Font Style', `wl-cdm-p-${key('fontStyle')}`, p[key('fontStyle')], {
                'normal': 'Normal', 'italic': 'Italic',
            }),
        ])}
        ${renderFieldRow([
            renderSelectField('Letter Spacing', `wl-cdm-p-${key('letterSpacing')}`, p[key('letterSpacing')], {
                '0px': '0px (default)', '0.3px': '0.3px', '0.5px': '0.5px', '1px': '1px', '2px': '2px',
            }),
            renderSelectField('Line Height', `wl-cdm-p-${key('lineHeight')}`, p[key('lineHeight')], {
                'normal': 'Normal', '1.2': '1.2 (tight)', '1.4': '1.4', '1.6': '1.6',
                '1.8': '1.8 (spacious)', '2': '2.0',
            }),
        ])}
    `;
}

function renderAdvancedCssField(p, prefix = '') {
    const property = `${prefix || 'dialogue'}CustomCss`;
    const target = prefix === 'name' ? 'speaker name' : prefix === 'message' ? 'message text' : 'quoted dialogue';
    return `
        <div class="wl-cdm-subsection">Advanced CSS</div>
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label" for="wl-cdm-p-${property}">Custom declarations</label>
            <textarea class="wl-cdm-input wl-cdm-css-input" id="wl-cdm-p-${property}"
                maxlength="4000" spellcheck="false"
                placeholder="color: white;&#10;text-shadow: -3px 3px 5px rgba(255, 255, 255, 0.7);">${esc(p[property] || '')}</textarea>
        </div>
        <div class="wl-cdm-field-hint">Applied only to this style's ${target}. Paste declarations without a selector or braces. External URLs and at-rules are ignored.</div>
    `;
}

function renderFontsProps(p, activeSection) {
    for (const prefix of ['', 'message', 'ui']) {
        const familyKey = fontProperty(prefix, 'fontFamily');
        const customKey = fontProperty(prefix, 'fontFamilyUseCustom');
        if (!(customKey in p)) {
            p[customKey] = !!p[familyKey]
                && p[familyKey] !== 'inherit'
                && p[familyKey] !== 'Default (Theme)';
        }
    }
    for (const [k, v] of Object.entries(ELEMENT_DEFAULTS.dialogue)) {
        if (!(k in p)) p[k] = v;
    }

    return renderActivePropertySection({
        name: {
            content: `${renderNameProps(p)}${renderAdvancedCssField(p, 'name')}`,
            hint: 'Typography, position, and optional background for the visible speaker name.',
        },
        'message-text': {
            content: `${renderFontFields(p, 'message')}${renderAdvancedCssField(p, 'message')}`,
            hint: 'Base typography for user and assistant message text. Dialogue settings can override quoted text.',
        },
        dialogue: {
            content: `${renderFontFields(p)}${renderAdvancedCssField(p)}`,
            hint: 'Typography for text rendered inside dialogue/quote tags.',
        },
        'sillytavern-ui': {
            content: `
                ${renderFontFields(p, 'ui')}
                <div class="wl-cdm-subsection">Interface Colors</div>
                ${renderThemeColorField(
                    'Interface Text Color',
                    'wl-cdm-p-uiTextColor',
                    'wl-cdm-p-uiTextColorUseCustom',
                    p.uiTextColorUseCustom,
                    p.uiTextColor,
                    'Used by Light Theme Compatibility for neutral UI text, including Thinking. Muted labels and placeholders are derived automatically.',
                )}
            `,
            hint: 'Applies to the interface while this Fonts style is active. With custom controls off, the current theme remains untouched.',
        },
    }, activeSection);
}

// ── Banner Properties ──

function renderBannerBorderFields(p, side, label) {
    const prefix = `border${side}`;
    return `
        <div class="wl-cdm-field-label">${label}</div>
        ${renderFieldRow([
            renderRangeField('Border Width', `wl-cdm-p-${prefix}Width`, p[`${prefix}Width`], 0, 8, 1, 'px'),
            renderSelectField('Border Style', `wl-cdm-p-${prefix}Style`, p[`${prefix}Style`], {
                'none': 'None', 'solid': 'Solid', 'dashed': 'Dashed', 'dotted': 'Dotted', 'double': 'Double',
            }),
        ])}
        ${renderFieldRow([
            renderColorField('Border Color', `wl-cdm-p-${prefix}Color`, p[`${prefix}Color`]),
            renderRangeField('Border Opacity', `wl-cdm-p-${prefix}Opacity`, p[`${prefix}Opacity`], 0, 1, 0.1, ''),
        ])}
    `;
}

function renderBannerProps(p) {
    // Backfill keys added to the schema after this style was first created, so
    // edits to newer controls on an older style aren't silently dropped by the
    // generic property wiring (which only persists keys already present).
    for (const [k, v] of Object.entries(ELEMENT_DEFAULTS.banner)) {
        if (!(k in p)) p[k] = v;
    }
    const overlayGradientHidden = p.overlayType === 'gradient' ? '' : ' hidden';
    return `
        <div class="wl-cdm-field wl-cdm-compact-field">
            <label class="wl-cdm-field-label">Preset</label>
            <select class="wl-cdm-select" id="wl-cdm-banner-preset">
                <option value="">— Load a preset —</option>
                ${Object.entries(BANNER_PRESETS).map(([key, preset]) =>
                    `<option value="${key}">${esc(preset.label)}</option>`
                ).join('')}
            </select>
        </div>
        <div class="wl-cdm-field-hint">Fills every field below with a curated look — tweak freely afterward, or leave it and build your own.</div>

        <div class="wl-cdm-subsection">Banner Geometry</div>
        ${renderFieldRow([
            renderRangeField('Width', 'wl-cdm-p-width', p.width, 10, 200, 1, '%'),
            renderRangeField('Height', 'wl-cdm-p-height', p.height, 60, 300, 10, 'px'),
        ], 'Width stays responsive')}
        ${renderFieldRow([
            renderRangeField('Horizontal Offset', 'wl-cdm-p-offsetX', p.offsetX, -400, 400, 1, 'px'),
            renderRangeField('Vertical Offset', 'wl-cdm-p-offsetY', p.offsetY, -250, 250, 1, 'px'),
        ], 'Offsets move the artwork without moving message content · negative values move left/up')}
        ${renderRangeField('Content Padding Top', 'wl-cdm-p-paddingTop', p.paddingTop, 60, 350, 10, 'px')}
        <div class="wl-cdm-field-hint">Reserves vertical space for the message content independently of the artwork position.</div>
        ${renderFieldRow([
            renderRangeField('Image Position', 'wl-cdm-p-bannerPosition', p.bannerPosition, 0, 100, 5, '%'),
            renderRangeField('Border Radius', 'wl-cdm-p-borderRadius', p.borderRadius, 0, 24, 1, 'px'),
        ])}

        <div class="wl-cdm-subsection">Bottom Fade</div>
        ${renderColorField('Fade Color', 'wl-cdm-p-bottomFadeColor', p.bottomFadeColor)}
        ${renderRangeField('Fade Opacity', 'wl-cdm-p-bottomFadeOpacity', p.bottomFadeOpacity, 0, 1, 0.05, '')}

        <div class="wl-cdm-subsection">Overlay</div>
        ${renderSelectField('Fill', 'wl-cdm-p-overlayType', p.overlayType, {
            solid: 'Solid color', gradient: 'Two-color gradient',
        })}
        ${renderColorField('Primary Color', 'wl-cdm-p-overlayColor', p.overlayColor)}
        <div data-wl-banner-overlay-conditional="gradient"${overlayGradientHidden}>
            ${renderColorField('Secondary Color', 'wl-cdm-p-overlaySecondaryColor', p.overlaySecondaryColor)}
            ${renderRangeField('Gradient Direction', 'wl-cdm-p-overlayAngle', p.overlayAngle, 0, 360, 5, '°')}
        </div>
        ${renderFieldRow([
            renderRangeField('Overlay Opacity', 'wl-cdm-p-overlayOpacity', p.overlayOpacity, 0, 1, 0.05, ''),
            renderSelectField('Blend Mode', 'wl-cdm-p-overlayBlendMode', p.overlayBlendMode, {
                normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay',
                'soft-light': 'Soft Light', color: 'Color',
            }),
        ])}
        ${renderRangeField('Vignette', 'wl-cdm-p-overlayVignette', p.overlayVignette, 0, 0.85, 0.05, '')}
        <div class="wl-cdm-field-hint">Blend modes color-treat the artwork; vignette shades its edges. Both follow the banner fade and slant while frame borders remain crisp.</div>

        <div class="wl-cdm-subsection">Slant</div>
        ${renderFieldRow([
            renderRangeField('Slant Depth', 'wl-cdm-p-slant', p.slant, 0, 40, 1, 'px'),
            renderSelectField('Slant Direction', 'wl-cdm-p-slantDirection', p.slantDirection, {
                'right': 'Rises to the right', 'left': 'Rises to the left',
            }),
        ])}
        <div class="wl-cdm-field-hint">Cuts the band's bottom on a diagonal. When on, the Bottom Border becomes a solid accent bar riding the slant; its style and radius are ignored. Top and side borders still frame the banner body.</div>

        <div class="wl-cdm-subsection">Banner Frame</div>
        <div class="wl-cdm-field-hint">Each edge is independent. A 0px width or None style explicitly removes that edge.</div>
        ${renderBannerBorderFields(p, 'Top', 'Top Border')}
        ${renderBannerBorderFields(p, 'Left', 'Left Border')}
        ${renderBannerBorderFields(p, 'Right', 'Right Border')}
        ${renderBannerBorderFields(p, 'Bottom', 'Bottom Border')}
    `;
}

// ── Container Properties ──

function renderThinkingPresetPicker(p) {
    return `
        <div class="wl-cdm-thinking-presets" role="radiogroup" aria-label="Thinking presets">
            ${Object.entries(THINKING_PRESETS).map(([key, preset]) => {
                const active = p.thinkingPreset === key;
                return `
                    <button type="button" role="radio" aria-checked="${active}"
                            class="wl-cdm-thinking-preset${active ? ' wl-cdm-thinking-preset-active' : ''}"
                            data-thinking-preset="${key}">
                        <span class="wl-cdm-thinking-swatch wl-cdm-thinking-swatch-${key}">
                            <span>Thought for…</span><i aria-hidden="true"></i>
                        </span>
                        <span class="wl-cdm-thinking-preset-copy">
                            <strong>${preset.label}</strong>
                            <small>${preset.description}</small>
                        </span>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

function renderContainerProps(p, activeSection) {
    // Backfill layout controls into container styles created before they existed.
    if (!('contentOffsetX' in p)) p.contentOffsetX = Number(p.contentIndent) || 0;
    if (p.paddingEnabled == null) p.paddingEnabled = Number(p.paddingExtra) > 0;
    for (const [k, v] of Object.entries(ELEMENT_DEFAULTS.container)) {
        if (!(k in p)) p[k] = v;
    }
    const borderStyles = {
        'none': 'None', 'solid': 'Solid', 'dashed': 'Dashed', 'dotted': 'Dotted',
        'double': 'Double', 'ridge': 'Ridge', 'groove': 'Groove',
    };
    const sections = {
        container: {
            hint: 'Outer message shell only. Content-area and text-position controls keep their existing behavior under Content.',
            content: `
                ${renderFieldRow([
                    renderRangeField('Border Width', 'wl-cdm-p-borderWidth', p.borderWidth, 0, 8, 1, 'px'),
                    renderSelectField('Border Style', 'wl-cdm-p-borderStyle', p.borderStyle, borderStyles),
                ])}
                ${renderColorField('Border Color', 'wl-cdm-p-borderColor', p.borderColor)}
                ${renderRangeField('Border Radius', 'wl-cdm-p-borderRadius', p.borderRadius, 0, 24, 1, 'px')}
                ${renderShadowField('Box Shadow', 'wl-cdm-p-boxShadow', p.boxShadow)}
                ${renderFieldRow([
                    renderRangeField('Margin Top', 'wl-cdm-p-marginTop', p.marginTop, 0, 40, 2, 'px'),
                    renderRangeField('Margin Bottom', 'wl-cdm-p-marginBottom', p.marginBottom, 0, 40, 2, 'px'),
                ])}
                ${renderCheckboxField('Use custom padding', 'wl-cdm-p-paddingEnabled', p.paddingEnabled, 'Off follows the active theme. Turn it on to set exact spacing around the whole message.')}
                <div data-wl-custom-region="paddingEnabled"${p.paddingEnabled ? '' : ' class="wl-cdm-custom-disabled"'}>
                    ${renderRangeField('Padding', 'wl-cdm-p-paddingExtra', p.paddingExtra, 0, 200, 1, 'px', '0 removes the message padding; higher values add equal spacing on every side.')}
                </div>
            `,
        },
        content: {
            hint: 'The inner message surface, its responsive size and placement, and text/reasoning offsets.',
            content: `
                ${renderCheckboxField('Style content area', 'wl-cdm-p-contentAreaEnabled', p.contentAreaEnabled, 'Gives the text and reasoning column its own surface, independent of the full message row.')}
                ${renderColorField('Background Color', 'wl-cdm-p-contentBackgroundColor', p.contentBackgroundColor)}
                ${renderRangeField('Background Opacity', 'wl-cdm-p-contentBackgroundOpacity', p.contentBackgroundOpacity, 0, 1, 0.05, '')}
                ${renderFieldRow([
                    renderRangeField('Border Width', 'wl-cdm-p-contentBorderWidth', p.contentBorderWidth, 0, 8, 1, 'px'),
                    renderSelectField('Border Style', 'wl-cdm-p-contentBorderStyle', p.contentBorderStyle, borderStyles),
                ])}
                ${renderColorField('Border Color', 'wl-cdm-p-contentBorderColor', p.contentBorderColor)}
                ${renderRangeField('Border Radius', 'wl-cdm-p-contentBorderRadius', p.contentBorderRadius, 0, 60, 1, 'px')}
                ${renderShadowField('Box Shadow', 'wl-cdm-p-contentBoxShadow', p.contentBoxShadow)}
                ${renderFieldRow([
                    renderWidthField('Content Width', 'wl-cdm-p-contentWidth', p.contentWidth, 'Fill uses every available pixel; fixed widths still shrink on narrow screens.'),
                    renderRangeField('Minimum Height', 'wl-cdm-p-contentMinHeight', p.contentMinHeight, 0, 300, 1, 'px', '0 = fit the content automatically.'),
                ])}

                <div class="wl-cdm-subsection">Content Area Position</div>
                ${renderFieldRow([
                    renderRangeField('Area Horizontal Offset', 'wl-cdm-p-contentAreaOffsetX', p.contentAreaOffsetX, -600, 600, 1, 'px'),
                    renderRangeField('Area Vertical Offset', 'wl-cdm-p-contentAreaOffsetY', p.contentAreaOffsetY, -300, 300, 1, 'px'),
                ], 'Moves the entire styled area—surface, border, text, and reasoning—without moving the name, details, or action buttons · − left/up · + right/down')}

                <div class="wl-cdm-subsection">Inner Text Layout</div>
                ${renderFieldRow([
                    renderWidthField('Text Width', 'wl-cdm-p-contentTextWidth', p.contentTextWidth, 'Fill uses the full content width inside the message padding.'),
                    renderRangeField('Text Horizontal Offset', 'wl-cdm-p-contentOffsetX', p.contentOffsetX, -240, 240, 1, 'px'),
                    renderRangeField('Text Vertical Offset', 'wl-cdm-p-contentOffsetY', p.contentOffsetY, -120, 120, 1, 'px'),
                ], 'Moves message text and reasoning inside the content area while its surface stays fixed · − left/up · + right/down')}
            `,
        },
        thinking: {
            hint: 'Styles SillyTavern’s native reasoning summary without changing its compact full-row footprint.',
            content: `
                ${renderThinkingPresetPicker(p)}
                <div class="wl-cdm-thinking-native-note">Native keeps the active theme’s shape; Light Theme Compatibility still corrects its resting and hover surfaces.</div>
                <div data-wl-thinking-custom ${p.thinkingPreset === 'native' ? 'hidden' : ''}>
                    <div class="wl-cdm-subsection">Fine Tuning</div>
                    ${renderFieldRow([
                        renderRangeField('Summary Radius', 'wl-cdm-p-thinkingRadius', p.thinkingRadius, 0, 24, 1, 'px'),
                        renderRangeField('Accent Strength', 'wl-cdm-p-thinkingAccentStrength', p.thinkingAccentStrength, 0, 100, 5, '%'),
                    ])}
                    <div data-wl-thinking-custom-appearance ${p.thinkingPreset === 'custom' ? '' : 'hidden'}>
                        ${renderFieldRow([
                            renderColorField('Text Color', 'wl-cdm-p-thinkingTextColor', p.thinkingTextColor),
                            renderColorField('Background Color', 'wl-cdm-p-thinkingBackgroundColor', p.thinkingBackgroundColor),
                        ], 'Custom colors apply to the compact reasoning summary only.')}
                        ${renderFieldRow([
                            renderColorField('Border Color', 'wl-cdm-p-thinkingBorderColor', p.thinkingBorderColor),
                            renderRangeField('Border Width', 'wl-cdm-p-thinkingBorderWidth', p.thinkingBorderWidth, 1, 8, 1, 'px'),
                        ])}
                        ${renderSelectField('Border Style', 'wl-cdm-p-thinkingBorderStyle', p.thinkingBorderStyle, {
                            solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', double: 'Double',
                        })}
                        <div class="wl-cdm-field-hint">Custom always keeps a visible border so its chosen border color is reflected in the preview and chat.</div>
                    </div>
                    ${renderCheckboxField('Style expanded reasoning body', 'wl-cdm-p-thinkingBodyEnabled', p.thinkingBodyEnabled, 'Applies the matching theme accent to the native 2px left rule.')}
                </div>
            `,
        },
    };
    return renderActivePropertySection(sections, activeSection);
}

// ── Message Element Properties ──

function renderMessageElementsProps(p, activeSection) {
    // Older saved avatar styles predate newer controls such as edgeFade. The
    // generic input wiring only persists keys already present on the style.
    const legacySize = Math.max(0, Number(p.size) || 0);
    if (!('width' in p)) p.width = legacySize;
    if (!('height' in p)) {
        p.height = p.shape === 'rectangle' ? Math.round(legacySize * 1.4) : legacySize;
    }
    if (!('objectFitUseCustom' in p)) p.objectFitUseCustom = !!p.objectFit && p.objectFit !== 'theme';
    if (!('shapeUseCustom' in p)) p.shapeUseCustom = !!p.shape && p.shape !== 'theme';
    for (const [k, v] of Object.entries(ELEMENT_DEFAULTS.avatar)) {
        if (!(k in p)) p[k] = v;
    }
    const avatarFields = `
        <div class="wl-cdm-subsection">Avatar Frame</div>
        ${renderFieldRow([
            renderRangeField('Frame Width', 'wl-cdm-p-width', p.width, 0, 300, 1, 'px'),
            renderRangeField('Frame Height', 'wl-cdm-p-height', p.height, 0, 400, 1, 'px'),
        ], 'Set both dimensions to shape the frame independently · 0 = use the theme default for that axis')}
        ${renderThemeSelectField('Image Fit', 'wl-cdm-p-objectFit', 'wl-cdm-p-objectFitUseCustom', p.objectFitUseCustom, p.objectFit, {
            'cover': 'Cover (fill + crop)',
            'contain': 'Contain (show entire image)', 'fill': 'Fill (stretch)',
        }, 'Off follows the active theme’s image fit.')}
        <div data-wl-custom-region="objectFitUseCustom"${p.objectFitUseCustom ? '' : ' class="wl-cdm-custom-disabled"'}>
            ${renderFieldRow([
                renderRangeField('Image Position Horizontal', 'wl-cdm-p-objectPositionX', p.objectPositionX, 0, 100, 1, '%'),
                renderRangeField('Image Position Vertical', 'wl-cdm-p-objectPositionY', p.objectPositionY, 0, 100, 1, '%'),
            ], 'Choose which part of the image stays visible when Cover crops it · 0 = left/top · 100 = right/bottom')}
        </div>

        <div class="wl-cdm-subsection">Avatar Position</div>
        ${renderFieldRow([
            renderRangeField('Horizontal Offset', 'wl-cdm-p-offsetX', p.offsetX ?? 0, -50, 800, 1, 'px', '0 = default (left) · − peeks off-edge · + moves right.'),
            renderRangeField('Vertical Offset', 'wl-cdm-p-offsetY', p.offsetY ?? 0, -200, 100, 1, 'px', '− up into banner / + down · needs a banner style.'),
        ])}
        ${renderCheckboxField('Free avatar from layout', 'wl-cdm-p-detachFromLayout', p.detachFromLayout ?? false, 'Lets message text fill the space the avatar used to reserve. Use when the avatar sits in the banner.')}
        ${renderThemeSelectField('Shape', 'wl-cdm-p-shape', 'wl-cdm-p-shapeUseCustom', p.shapeUseCustom, p.shape, {
            'circle': 'Circle', 'square': 'Square',
            'rounded': 'Rounded (8px)', 'rectangle': 'Portrait Rectangle',
        }, 'Off preserves the active theme’s avatar shape.')}
        ${renderFieldRow([
            renderRangeField('Border Width', 'wl-cdm-p-borderWidth', p.borderWidth, 0, 6, 1, 'px'),
            renderSelectField('Border Style', 'wl-cdm-p-borderStyle', p.borderStyle, {
                'none': 'None', 'solid': 'Solid', 'dashed': 'Dashed', 'dotted': 'Dotted',
            }),
        ])}
        ${renderColorField('Border Color', 'wl-cdm-p-borderColor', p.borderColor)}
        ${renderShadowField('Box Shadow', 'wl-cdm-p-boxShadow', p.boxShadow)}
        ${renderFieldRow([
            renderRangeField('Opacity', 'wl-cdm-p-opacity', p.opacity, 0, 1, 0.05, ''),
            renderRangeField('Edge Fade', 'wl-cdm-p-edgeFade', p.edgeFade, 0, 80, 5, '%'),
        ], 'Edge Fade softens the right and bottom edges into transparency · 0 = off')}
    `;
    const detailFields = `
        <div class="wl-cdm-subsection">Avatar-Side Details</div>
        ${renderCheckboxField('Follow avatar position', 'wl-cdm-p-detailsFollowAvatar', p.detailsFollowAvatar ?? false, 'Moves Message #, token count, and generation time together with the avatar offsets.')}
        ${renderFieldRow([
            renderRangeField('Horizontal Offset', 'wl-cdm-p-detailsOffsetX', p.detailsOffsetX ?? 0, -200, 200, 1, 'px'),
            renderRangeField('Vertical Offset', 'wl-cdm-p-detailsOffsetY', p.detailsOffsetY ?? 0, -600, 600, 1, 'px'),
        ])}

        <div class="wl-cdm-subsection">Chat Timestamp</div>
        ${renderFieldRow([
            renderRangeField('Horizontal Offset', 'wl-cdm-p-timestampOffsetX', p.timestampOffsetX ?? 0, -200, 200, 1, 'px'),
            renderRangeField('Vertical Offset', 'wl-cdm-p-timestampOffsetY', p.timestampOffsetY ?? 0, -600, 600, 1, 'px'),
        ])}

        <div class="wl-cdm-subsection">Model Icon</div>
        ${renderFieldRow([
            renderRangeField('Horizontal Offset', 'wl-cdm-p-modelIconOffsetX', p.modelIconOffsetX ?? 0, -200, 200, 1, 'px'),
            renderRangeField('Vertical Offset', 'wl-cdm-p-modelIconOffsetY', p.modelIconOffsetY ?? 0, -600, 600, 1, 'px'),
        ])}
    `;
    const overlayGradientHidden = p.avatarOverlayType === 'gradient' ? '' : ' hidden';
    const overlayFields = `
        <div class="wl-cdm-field wl-cdm-compact-field">
            <label class="wl-cdm-field-label">Preset</label>
            <select class="wl-cdm-select" id="wl-cdm-avatar-overlay-preset">
                <option value="">— Load a preset —</option>
                ${Object.entries(AVATAR_OVERLAY_PRESETS).map(([key, preset]) =>
                    `<option value="${key}">${esc(preset.label)}</option>`
                ).join('')}
            </select>
        </div>
        <div class="wl-cdm-field-hint">Loads a complete color treatment. Every setting remains editable.</div>
        ${renderCheckboxField('Enable overlay', 'wl-cdm-p-avatarOverlayEnabled', p.avatarOverlayEnabled ?? false, 'Turn this off to return to the untouched avatar without losing your settings.')}
        ${renderSelectField('Fill', 'wl-cdm-p-avatarOverlayType', p.avatarOverlayType, {
            solid: 'Solid color', gradient: 'Two-color gradient',
        })}
        ${renderColorField('Primary Color', 'wl-cdm-p-avatarOverlayPrimaryColor', p.avatarOverlayPrimaryColor)}
        <div data-wl-avatar-overlay-conditional="gradient"${overlayGradientHidden}>
            ${renderColorField('Secondary Color', 'wl-cdm-p-avatarOverlaySecondaryColor', p.avatarOverlaySecondaryColor)}
            ${renderRangeField('Gradient Direction', 'wl-cdm-p-avatarOverlayAngle', p.avatarOverlayAngle, 0, 360, 5, '°')}
        </div>
        ${renderFieldRow([
            renderRangeField('Overlay Opacity', 'wl-cdm-p-avatarOverlayOpacity', p.avatarOverlayOpacity, 0, 1, 0.05, ''),
            renderSelectField('Blend Mode', 'wl-cdm-p-avatarOverlayBlendMode', p.avatarOverlayBlendMode, {
                normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay',
                'soft-light': 'Soft Light', color: 'Color',
            }),
        ])}
        ${renderRangeField('Vignette', 'wl-cdm-p-avatarOverlayVignette', p.avatarOverlayVignette, 0, 0.85, 0.05, '')}
        <div class="wl-cdm-field-hint">The vignette gently shades the avatar edges and follows the overlay blend.</div>
    `;
    const dimHidden = p.actionVisibility === 'dim' ? '' : ' hidden';
    const surfaceHidden = p.actionSurface === 'bare' ? ' hidden' : '';
    const speedHidden = p.actionHoverMotion === 'none' ? ' hidden' : '';
    const actionCustomizeFields = `
        ${renderSelectField('Visibility', 'wl-cdm-p-actionVisibility', p.actionVisibility, {
            always: 'Always visible', dim: 'Dim until message hover', hidden: 'Hidden until message hover',
        })}
        <div data-wl-action-conditional="dim"${dimHidden}>
            ${renderRangeField('Resting Opacity', 'wl-cdm-p-actionRestingOpacity', p.actionRestingOpacity, 0.05, 0.95, 0.05, '')}
        </div>
        ${renderFieldRow([
            renderRangeField('Button Size', 'wl-cdm-p-actionButtonSize', p.actionButtonSize, 18, 44, 1, 'px'),
            renderRangeField('Icon Size', 'wl-cdm-p-actionIconSize', p.actionIconSize, 10, 24, 1, 'px'),
        ])}
        ${renderFieldRow([
            renderRangeField('Button Spacing', 'wl-cdm-p-actionGap', p.actionGap, 0, 16, 1, 'px'),
            renderRangeField('Corner Radius', 'wl-cdm-p-actionRadius', p.actionRadius, 0, 44, 1, 'px'),
        ])}
        ${renderCheckboxField('Reverse action order', 'wl-cdm-p-actionReverse', p.actionReverse ?? false)}
        ${renderSelectField('Surface', 'wl-cdm-p-actionSurface', p.actionSurface, {
            bare: 'Bare', solid: 'Solid', outline: 'Outline', glass: 'Glass',
        })}
        ${renderColorField('Resting Icon Color', 'wl-cdm-p-actionRestingIconColor', p.actionRestingIconColor)}
        <div data-wl-action-conditional="surface"${surfaceHidden}>
            ${renderActionSurfaceColorField('Resting Surface Color', 'wl-cdm-p-actionRestingSurfaceColor', p.actionRestingSurfaceColor)}
        </div>
        ${renderColorField('Hover Icon Color', 'wl-cdm-p-actionHoverIconColor', p.actionHoverIconColor)}
        <div data-wl-action-conditional="surface"${surfaceHidden}>
            ${renderActionSurfaceColorField('Hover Surface Color', 'wl-cdm-p-actionHoverSurfaceColor', p.actionHoverSurfaceColor)}
        </div>
        ${renderSelectField('Hover Motion', 'wl-cdm-p-actionHoverMotion', p.actionHoverMotion, {
            none: 'None', color: 'Color only', lift: 'Lift', pop: 'Pop', tilt: 'Tilt', snap: 'Snap',
        })}
        <div data-wl-action-conditional="speed"${speedHidden}>
            ${renderSelectField('Animation Speed', 'wl-cdm-p-actionAnimationSpeed', p.actionAnimationSpeed, {
                slow: 'Slow', normal: 'Normal', fast: 'Fast',
            })}
        </div>
        <div data-wl-action-conditional="surface"${surfaceHidden}>
            ${renderSelectField('Shadow', 'wl-cdm-p-actionShadow', p.actionShadow, {
                none: 'None', soft: 'Soft', strong: 'Strong',
            })}
        </div>
    `;
    const actionFields = `
        <div class="wl-cdm-field wl-cdm-compact-field">
            <label class="wl-cdm-field-label">Preset</label>
            <select class="wl-cdm-select" id="wl-cdm-action-preset">
                <option value="">— Load a preset —</option>
                ${Object.entries(MESSAGE_ACTION_PRESETS).map(([key, preset]) =>
                    `<option value="${key}">${esc(preset.label)}</option>`
                ).join('')}
            </select>
        </div>
        <div class="wl-cdm-field-hint">Loads a complete starting look. Every setting remains editable.</div>
        ${renderFieldRow([
            renderRangeField('Horizontal Offset', 'wl-cdm-p-actionOffsetX', p.actionOffsetX, -400, 400, 1, 'px'),
            renderRangeField('Vertical Offset', 'wl-cdm-p-actionOffsetY', p.actionOffsetY, -250, 250, 1, 'px'),
        ])}
        ${renderPropertyGroup(
            'Customize preset',
            actionCustomizeFields,
            false,
            'Fine-tune visibility, geometry, color, motion, and depth.',
        )}
    `;

    return renderActivePropertySection({
        avatar: {
            content: `${avatarFields}
                <div class="wl-cdm-subsection">Avatar Color Overlay</div>
                <div class="wl-cdm-field-hint">Adds a non-interactive color layer that follows the avatar shape and edge fade.</div>
                ${overlayFields}`,
        },
        'message-details': {
            content: detailFields,
            hint: 'Positions avatar-side details, the chat timestamp, and the model icon independently.',
        },
        'action-buttons': {
            content: actionFields,
            hint: 'Styles standard message actions and extension actions; edit-mode controls stay theme-native.',
        },
    }, activeSection);
}

// ── General UI Properties ──

function ensureGeneralUiProperties(p) {
    // Preserve the short-lived Full Bleed-only width setting from older styles.
    if (!('topBarWidth' in p) && 'fullBleedWidth' in p) p.topBarWidth = p.fullBleedWidth;
    if (!('topBarWidthMode' in p) && p.topBarPreset === 'fullBleed' && Number(p.fullBleedWidth) !== 100) {
        p.topBarWidthMode = 'custom';
    }
    if (!('topBarPresetUseCustom' in p)) p.topBarPresetUseCustom = !!p.topBarPreset && p.topBarPreset !== 'theme';
    if (!('weatherBadgeFontUseCustom' in p)) p.weatherBadgeFontUseCustom = p.weatherBadgeFont === 'mono';
    for (const [key, value] of Object.entries(ELEMENT_DEFAULTS.generalUi)) {
        if (!(key in p)) p[key] = value;
    }
}

function syncScrollbarPreview(props) {
    const preview = props.querySelector('[data-wl-scrollbar-preview]');
    if (!preview) return;

    const properties = {};
    props.querySelectorAll('[id^="wl-cdm-p-scrollbar"]').forEach(input => {
        properties[input.id.replace('wl-cdm-p-', '')] = input.value;
    });
    const resolved = resolveScrollbarStyle(properties);
    const variables = {
        width: resolved.width + 'px', radius: resolved.radius + 'px', inset: resolved.inset + 'px',
        thumb: resolved.thumbSurface, 'thumb-hover': resolved.hoverSurface,
        'thumb-border': resolved.thumbBorder, 'thumb-hover-border': resolved.thumbHoverBorder,
        track: resolved.trackSurface,
    };
    for (const [key, value] of Object.entries(variables)) {
        preview.style.setProperty('--wl-cdm-preview-scrollbar-' + key, value);
    }

    syncScrollbarPreviewPosition(preview);
}

function syncScrollbarPreviewPosition(preview) {
    const viewport = preview.querySelector('.wl-cdm-scrollbar-preview-viewport');
    const rail = preview.querySelector('.wl-cdm-scrollbar-preview-rail');
    if (!viewport || !rail) return;

    // The production thumb occupies the complete track box; its transparent
    // border creates the visible inset. Mirror that geometry here so both the
    // thumb radius and its edge spacing match the rendered interface.
    const usableHeight = Math.max(0, rail.clientHeight);
    const visibleRatio = viewport.scrollHeight > 0 ? viewport.clientHeight / viewport.scrollHeight : 1;
    const thumbHeight = Math.min(usableHeight, Math.max(28, usableHeight * visibleRatio));
    const scrollRange = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const travel = Math.max(0, usableHeight - thumbHeight);
    const offset = scrollRange > 0 ? (viewport.scrollTop / scrollRange) * travel : 0;

    preview.style.setProperty('--wl-cdm-preview-scrollbar-thumb-height', `${thumbHeight}px`);
    preview.style.setProperty('--wl-cdm-preview-scrollbar-thumb-offset', `${offset}px`);
}

function wireScrollbarPreview(props) {
    const preview = props.querySelector('[data-wl-scrollbar-preview]');
    const viewport = preview?.querySelector('.wl-cdm-scrollbar-preview-viewport');
    if (!preview || !viewport) return;

    viewport.addEventListener('scroll', () => {
        syncScrollbarPreviewPosition(preview);
    }, { passive: true });
}

function renderGeneralUiIconProps(p) {
    ensureGeneralUiProperties(p);

    const sizeHidden = p.iconSizeMode === 'custom' ? '' : ' hidden';
    const spacingHidden = p.iconSpacingMode === 'custom' ? '' : ' hidden';
    const colorHidden = p.iconColorMode === 'custom' ? '' : ' hidden';
    const opacityHidden = p.iconOpacityMode === 'custom' ? '' : ' hidden';

    return `
        <div class="wl-cdm-property-tab-hint">Size, spacing, color, and opacity for SillyTavern/TauriTavern's top-bar icons.</div>

        <div class="wl-cdm-subsection">Icon Size</div>
        ${renderCustomModeToggle('Icon Size', 'wl-cdm-p-iconSizeMode', p.iconSizeMode)}
        <div data-wl-general-ui-conditional="size"${sizeHidden}>
            ${renderRangeField('Size', 'wl-cdm-p-iconSize', p.iconSize, 18, 48, 1, 'px')}
        </div>

        <div class="wl-cdm-subsection">Icon Layout</div>
        ${renderCustomModeToggle('Icon Layout', 'wl-cdm-p-iconSpacingMode', p.iconSpacingMode, 'Off preserves the native icon distribution and position.')}
        <div data-wl-general-ui-conditional="spacing"${spacingHidden}>
            ${renderFieldRow([
                renderRangeField('Gap', 'wl-cdm-p-iconSpacing', p.iconSpacing, 0, 80, 1, 'px'),
                renderRangeField('Horizontal Offset', 'wl-cdm-p-iconOffsetX', p.iconOffsetX, -240, 240, 1, 'px'),
            ])}
            <div class="wl-cdm-field-hint">The signed offset moves the visible icons and their clickable drawer holders together.</div>
        </div>

        <div class="wl-cdm-subsection">Icon Color</div>
        ${renderCustomModeToggle('Icon Colors', 'wl-cdm-p-iconColorMode', p.iconColorMode)}
        <div data-wl-general-ui-conditional="color"${colorHidden}>
            ${renderColorField('Icon Color', 'wl-cdm-p-iconColor', p.iconColor)}
            ${renderColorField('Hover Color', 'wl-cdm-p-iconHoverColor', p.iconHoverColor)}
        </div>

        <div class="wl-cdm-subsection">Icon Opacity</div>
        ${renderCustomModeToggle('Icon Opacity', 'wl-cdm-p-iconOpacityMode', p.iconOpacityMode)}
        <div data-wl-general-ui-conditional="opacity"${opacityHidden}>
            ${renderRangeField('Resting Opacity', 'wl-cdm-p-iconOpacity', p.iconOpacity, 0.05, 1, 0.05, '')}
            <div class="wl-cdm-field-hint">Hovering or keyboard-focusing an icon temporarily returns it to full opacity.</div>
        </div>
    `;
}

function renderGeneralUiProps(p, activeSection) {
    ensureGeneralUiProperties(p);

    const widthHidden = p.topBarWidthMode === 'custom' ? '' : ' hidden';
    const heightHidden = p.topBarHeightMode === 'custom' ? '' : ' hidden';
    const gapHidden = p.chatGapMode === 'custom' ? '' : ' hidden';
    const surfaceHidden = p.topBarSurfaceMode === 'custom' ? '' : ' hidden';
    const surfaceGradientHidden = p.topBarSurfaceType === 'gradient' ? '' : ' hidden';
    const borderHidden = p.topBarBorderMode === 'custom' ? '' : ' hidden';
    const inputSurfaceHidden = p.inputAreaSurfaceMode === 'custom' ? '' : ' hidden';
    const inputSurfaceGradientHidden = p.inputAreaSurfaceType === 'gradient' ? '' : ' hidden';
    const inputBorderHidden = p.inputAreaBorderMode === 'custom' ? '' : ' hidden';
    const inputLayoutHidden = p.inputAreaLayoutMode === 'custom' ? '' : ' hidden';
    const inputTextHidden = p.inputAreaTextMode === 'custom' ? '' : ' hidden';
    const inputIconHidden = p.inputAreaIconMode === 'custom' ? '' : ' hidden';
    const qrButtonsHidden = p.qrButtonMode === 'custom' ? '' : ' hidden';
    const qrGradientHidden = p.qrButtonSurfaceType === 'gradient' ? '' : ' hidden';
    const controlsHidden = p.controlColorsMode === 'custom' ? '' : ' hidden';
    const scrollbarsHidden = p.scrollbarMode === 'custom' ? '' : ' hidden';
    const weatherCustomHidden = p.weatherBadgeMode === 'custom' ? '' : ' hidden';
    const weatherColorsHidden = p.weatherBadgePalette === 'custom' ? '' : ' hidden';
    const chatTopBarSurfaceHidden = p.chatTopBarSurfaceMode === 'custom' ? '' : ' hidden';
    const chatTopBarTextHidden = p.chatTopBarTextMode === 'custom' ? '' : ' hidden';
    const chatTopBarRadiusHidden = p.chatTopBarRadiusMode === 'custom' ? '' : ' hidden';
    const guidedGenerationsTextHidden = p.guidedGenerationsTextMode === 'custom' ? '' : ' hidden';
    const guidedGenerationsBackgroundHidden = p.guidedGenerationsBackgroundMode === 'custom' ? '' : ' hidden';
    const guidedGenerationsBorderHidden = p.guidedGenerationsBorderMode === 'custom' ? '' : ' hidden';
    const guidedGenerationsRadiusHidden = p.guidedGenerationsRadiusMode === 'custom' ? '' : ' hidden';

    const topBarFields = `
        ${renderThemeSelectField('Shape', 'wl-cdm-p-topBarPreset', 'wl-cdm-p-topBarPresetUseCustom', p.topBarPresetUseCustom, p.topBarPreset, {
            fullBleed: 'Full Bleed',
            softShelf: 'Soft Shelf',
            floatingFrame: 'Floating Frame',
        }, 'Off keeps the theme geometry. Floating Frame moves the backdrop and icon layer together while leaving the drawer host at its native width.')}

        <div class="wl-cdm-subsection">Bar Layout</div>
        ${renderCustomModeToggle('Width', 'wl-cdm-p-topBarWidthMode', p.topBarWidthMode, 'Off follows the selected shape or active theme.')}
        <div data-wl-general-ui-conditional="width"${widthHidden}>
            ${renderRangeField('Bar Width', 'wl-cdm-p-topBarWidth', p.topBarWidth, 50, 100, 1, '% viewport')}
            <div class="wl-cdm-field-hint">Works with every shape. 100% reaches both viewport edges; lower values stay centered.</div>
        </div>
        ${renderCustomModeToggle('Height', 'wl-cdm-p-topBarHeightMode', p.topBarHeightMode)}
        <div data-wl-general-ui-conditional="height"${heightHidden}>
            ${renderRangeField('Bar Height', 'wl-cdm-p-topBarHeight', p.topBarHeight, 30, 56, 1, 'px')}
            <div class="wl-cdm-field-hint">A deliberately modest range. Very large icons may need a taller bar.</div>
        </div>
        ${renderRangeField('Top Offset', 'wl-cdm-p-topBarTopOffset', p.topBarTopOffset, -16, 24, 1, 'px')}
        <div class="wl-cdm-field-hint">− moves the bar toward the viewport edge · + adds room above it · 0 uses the preset or theme position</div>
        ${renderCustomModeToggle('Space Before Chat', 'wl-cdm-p-chatGapMode', p.chatGapMode)}
        <div data-wl-general-ui-conditional="chat-gap"${gapHidden}>
            ${renderRangeField('Bar-to-Chat Gap', 'wl-cdm-p-chatGap', p.chatGap, 0, 24, 1, 'px')}
            <div class="wl-cdm-field-hint">0 places the chat directly beneath the visible bar.</div>
        </div>

        <div class="wl-cdm-subsection">Bar Surface</div>
        ${renderCustomModeToggle('Surface', 'wl-cdm-p-topBarSurfaceMode', p.topBarSurfaceMode)}
        <div data-wl-general-ui-conditional="surface"${surfaceHidden}>
            ${renderSelectField('Fill', 'wl-cdm-p-topBarSurfaceType', p.topBarSurfaceType, {
                solid: 'Solid color', gradient: 'Two-color gradient',
            })}
            ${renderColorField('Primary Color', 'wl-cdm-p-topBarSurfaceColor', p.topBarSurfaceColor)}
            <div data-wl-general-ui-conditional="surface-gradient"${surfaceGradientHidden}>
                ${renderFieldRow([
                    renderColorField('Secondary Color', 'wl-cdm-p-topBarSurfaceSecondaryColor', p.topBarSurfaceSecondaryColor),
                    renderRangeField('Gradient Direction', 'wl-cdm-p-topBarSurfaceAngle', p.topBarSurfaceAngle, 0, 360, 5, '°'),
                ])}
            </div>
            ${renderRangeField('Surface Opacity', 'wl-cdm-p-topBarSurfaceOpacity', p.topBarSurfaceOpacity, 0, 1, 0.05, '')}
            <div class="wl-cdm-field-hint">Transparency keeps the existing backdrop blur, if the active theme provides one.</div>
        </div>

        <div class="wl-cdm-subsection">Border</div>
        ${renderCustomModeToggle('Border', 'wl-cdm-p-topBarBorderMode', p.topBarBorderMode)}
        <div data-wl-general-ui-conditional="border"${borderHidden}>
            ${renderFieldRow([
                renderRangeField('Border Width', 'wl-cdm-p-topBarBorderWidth', p.topBarBorderWidth, 0, 6, 1, 'px'),
                renderColorField('Border Color', 'wl-cdm-p-topBarBorderColor', p.topBarBorderColor),
            ])}
            ${renderRangeField('Border Opacity', 'wl-cdm-p-topBarBorderOpacity', p.topBarBorderOpacity, 0, 1, 0.05, '')}
            <div class="wl-cdm-field-hint">Set the width to 0px to explicitly remove a theme border.</div>
        </div>

    `;

    const inputAreaFields = `
        <div class="wl-cdm-subsection">Composer Surface</div>
        ${renderCustomModeToggle('Surface', 'wl-cdm-p-inputAreaSurfaceMode', p.inputAreaSurfaceMode, 'Off preserves the active theme surface and blur.')}
        <div data-wl-general-ui-conditional="input-surface"${inputSurfaceHidden}>
            ${renderSelectField('Fill', 'wl-cdm-p-inputAreaSurfaceType', p.inputAreaSurfaceType, {
                solid: 'Solid color', gradient: 'Two-color gradient',
            })}
            ${renderColorField('Primary Color', 'wl-cdm-p-inputAreaSurfaceColor', p.inputAreaSurfaceColor)}
            <div data-wl-general-ui-conditional="input-surface-gradient"${inputSurfaceGradientHidden}>
                ${renderFieldRow([
                    renderColorField('Secondary Color', 'wl-cdm-p-inputAreaSurfaceSecondaryColor', p.inputAreaSurfaceSecondaryColor),
                    renderRangeField('Gradient Direction', 'wl-cdm-p-inputAreaSurfaceAngle', p.inputAreaSurfaceAngle, 0, 360, 5, '°'),
                ])}
            </div>
            ${renderFieldRow([
                renderRangeField('Surface Opacity', 'wl-cdm-p-inputAreaSurfaceOpacity', p.inputAreaSurfaceOpacity, 0, 1, 0.05, ''),
                renderRangeField('Glass Blur', 'wl-cdm-p-inputAreaBlur', p.inputAreaBlur, 0, 24, 1, 'px'),
            ])}
        </div>

        <div class="wl-cdm-subsection">Frame</div>
        ${renderCustomModeToggle('Border & Shape', 'wl-cdm-p-inputAreaBorderMode', p.inputAreaBorderMode, 'Off keeps the theme border, corners, and shadow.')}
        <div data-wl-general-ui-conditional="input-border"${inputBorderHidden}>
            ${renderFieldRow([
                renderRangeField('Border Width', 'wl-cdm-p-inputAreaBorderWidth', p.inputAreaBorderWidth, 0, 6, 1, 'px'),
                renderSelectField('Border Style', 'wl-cdm-p-inputAreaBorderStyle', p.inputAreaBorderStyle, {
                    solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', none: 'None',
                }),
            ], 'A 0px border or None style explicitly removes the theme border.')}
            ${renderFieldRow([
                renderColorField('Border Color', 'wl-cdm-p-inputAreaBorderColor', p.inputAreaBorderColor),
                renderRangeField('Border Opacity', 'wl-cdm-p-inputAreaBorderOpacity', p.inputAreaBorderOpacity, 0, 1, 0.05, ''),
            ])}
            ${renderFieldRow([
                renderRangeField('Corner Radius', 'wl-cdm-p-inputAreaRadius', p.inputAreaRadius, 0, 40, 1, 'px'),
                renderSelectField('Shadow', 'wl-cdm-p-inputAreaShadow', p.inputAreaShadow, {
                    none: 'None', soft: 'Soft', float: 'Floating', glow: 'Glow',
                }),
            ])}
        </div>

        <div class="wl-cdm-subsection">Input Row Layout</div>
        ${renderCustomModeToggle('Spacing', 'wl-cdm-p-inputAreaLayoutMode', p.inputAreaLayoutMode, 'Only the menu, textarea, and send-side row are affected. Quick Replies keep their own layout.')}
        <div data-wl-general-ui-conditional="input-layout"${inputLayoutHidden}>
            ${renderFieldRow([
                renderRangeField('Horizontal Padding', 'wl-cdm-p-inputAreaPaddingX', p.inputAreaPaddingX, 0, 24, 1, 'px'),
                renderRangeField('Vertical Padding', 'wl-cdm-p-inputAreaPaddingY', p.inputAreaPaddingY, 0, 16, 1, 'px'),
            ])}
            ${renderRangeField('Control Gap', 'wl-cdm-p-inputAreaGap', p.inputAreaGap, 0, 24, 1, 'px')}
        </div>

        <div class="wl-cdm-subsection">Message Input</div>
        ${renderCustomModeToggle('Input Text', 'wl-cdm-p-inputAreaTextMode', p.inputAreaTextMode, 'Off inherits the active interface typography and colors.')}
        <div data-wl-general-ui-conditional="input-text"${inputTextHidden}>
            ${renderFieldRow([
                renderColorField('Text Color', 'wl-cdm-p-inputAreaTextColor', p.inputAreaTextColor),
                renderColorField('Placeholder Color', 'wl-cdm-p-inputAreaPlaceholderColor', p.inputAreaPlaceholderColor),
            ])}
            ${renderRangeField('Text Size', 'wl-cdm-p-inputAreaFontSize', p.inputAreaFontSize, 10, 28, 1, 'px')}
        </div>

        <div class="wl-cdm-subsection">Composer Controls</div>
        ${renderCustomModeToggle('Icon Styling', 'wl-cdm-p-inputAreaIconMode', p.inputAreaIconMode, 'Styles the menu and send-side controls, but never Quick Reply buttons.')}
        <div data-wl-general-ui-conditional="input-icons"${inputIconHidden}>
            ${renderFieldRow([
                renderColorField('Icon Color', 'wl-cdm-p-inputAreaIconColor', p.inputAreaIconColor),
                renderColorField('Hover Color', 'wl-cdm-p-inputAreaIconHoverColor', p.inputAreaIconHoverColor),
            ])}
            ${renderRangeField('Resting Opacity', 'wl-cdm-p-inputAreaIconOpacity', p.inputAreaIconOpacity, 0.05, 1, 0.05, '')}
        </div>
    `;

    const qrButtonFields = `
        ${renderCustomModeToggle('QR Button Styling', 'wl-cdm-p-qrButtonMode', p.qrButtonMode, 'Off leaves the main Quick Reply bar and popout buttons on their native or theme styling.')}
        <div data-wl-general-ui-conditional="qr-buttons"${qrButtonsHidden}>
            <div class="wl-cdm-subsection">Button Surface</div>
            ${renderSelectField('Fill', 'wl-cdm-p-qrButtonSurfaceType', p.qrButtonSurfaceType, {
                solid: 'Solid color', gradient: 'Two-color gradient',
            })}
            ${renderColorField('Primary Color', 'wl-cdm-p-qrButtonSurfaceColor', p.qrButtonSurfaceColor)}
            <div data-wl-general-ui-conditional="qr-gradient"${qrGradientHidden}>
                ${renderFieldRow([
                    renderColorField('Secondary Color', 'wl-cdm-p-qrButtonSurfaceSecondaryColor', p.qrButtonSurfaceSecondaryColor),
                    renderRangeField('Gradient Direction', 'wl-cdm-p-qrButtonSurfaceAngle', p.qrButtonSurfaceAngle, 0, 360, 5, '°'),
                ])}
            </div>
            ${renderRangeField('Surface Opacity', 'wl-cdm-p-qrButtonSurfaceOpacity', p.qrButtonSurfaceOpacity, 0, 1, 0.05, '')}
            ${renderColorField('Text & Icon Color', 'wl-cdm-p-qrButtonTextColor', p.qrButtonTextColor)}

            <div class="wl-cdm-subsection">Shape & Spacing</div>
            ${renderFieldRow([
                renderRangeField('Horizontal Padding', 'wl-cdm-p-qrButtonPaddingX', p.qrButtonPaddingX, 0, 24, 1, 'px'),
                renderRangeField('Vertical Padding', 'wl-cdm-p-qrButtonPaddingY', p.qrButtonPaddingY, 0, 16, 1, 'px'),
            ])}
            ${renderFieldRow([
                renderRangeField('Button Gap', 'wl-cdm-p-qrButtonGap', p.qrButtonGap, 0, 24, 1, 'px'),
                renderRangeField('Corner Radius', 'wl-cdm-p-qrButtonRadius', p.qrButtonRadius, 0, 40, 1, 'px'),
            ])}
            ${renderFieldRow([
                renderRangeField('Border Width', 'wl-cdm-p-qrButtonBorderWidth', p.qrButtonBorderWidth, 0, 6, 1, 'px'),
                renderSelectField('Border Style', 'wl-cdm-p-qrButtonBorderStyle', p.qrButtonBorderStyle, {
                    solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', none: 'None',
                }),
            ])}
            ${renderFieldRow([
                renderColorField('Border Color', 'wl-cdm-p-qrButtonBorderColor', p.qrButtonBorderColor),
                renderRangeField('Border Opacity', 'wl-cdm-p-qrButtonBorderOpacity', p.qrButtonBorderOpacity, 0, 1, 0.05, ''),
            ])}
            ${renderSelectField('Shadow', 'wl-cdm-p-qrButtonShadow', p.qrButtonShadow, {
                none: 'None', soft: 'Soft', float: 'Floating', glow: 'Glow',
            })}

            <div class="wl-cdm-subsection">Button Text</div>
            ${renderFontPicker(p.qrButtonFontFamily, 'wl-cdm-p-qrButtonFontFamily', {
                useCustom: p.qrButtonFontFamilyUseCustom,
                useCustomFieldId: 'wl-cdm-p-qrButtonFontFamilyUseCustom',
                hideWhenDisabled: true,
            })}
            ${renderFieldRow([
                renderRangeField('Text Size', 'wl-cdm-p-qrButtonFontSize', p.qrButtonFontSize, 9, 24, 1, 'px'),
                renderRangeField('Weight', 'wl-cdm-p-qrButtonFontWeight', p.qrButtonFontWeight, 300, 800, 100, ''),
            ])}
            ${renderFieldRow([
                renderSelectField('Font Style', 'wl-cdm-p-qrButtonFontStyle', p.qrButtonFontStyle, {
                    normal: 'Normal', italic: 'Italic',
                }),
                renderSelectField('Text Transform', 'wl-cdm-p-qrButtonTextTransform', p.qrButtonTextTransform, {
                    none: 'None', uppercase: 'UPPERCASE', lowercase: 'lowercase', capitalize: 'Capitalize',
                }),
            ])}
            ${renderSelectField('Letter Spacing', 'wl-cdm-p-qrButtonLetterSpacing', p.qrButtonLetterSpacing, {
                '0px': '0px (default)', '0.5px': '0.5px', '1px': '1px',
                '2px': '2px', '3px': '3px', '5px': '5px',
            })}
            ${renderShadowField('Text Shadow', 'wl-cdm-p-qrButtonTextShadow', p.qrButtonTextShadow)}
            <div class="wl-cdm-field-hint">Typography applies only to button labels. Icon-only buttons and icons beside text keep their icon font.</div>

            <div class="wl-cdm-subsection">Visibility</div>
            ${renderRangeField('QR Bar Opacity', 'wl-cdm-p-qrButtonBarOpacity', p.qrButtonBarOpacity, 0.1, 1, 0.05, '')}
            <div class="wl-cdm-field-hint">This replaces Quick Reply’s native 70% bar opacity so custom colors stay predictable.</div>

            <div class="wl-cdm-subsection">Hover</div>
            ${renderColorField('Hover Surface', 'wl-cdm-p-qrButtonHoverSurfaceColor', p.qrButtonHoverSurfaceColor)}
            ${renderRangeField('Hover Surface Opacity', 'wl-cdm-p-qrButtonHoverSurfaceOpacity', p.qrButtonHoverSurfaceOpacity, 0, 1, 0.05, '')}
            ${renderColorField('Hover Text & Icon', 'wl-cdm-p-qrButtonHoverTextColor', p.qrButtonHoverTextColor)}
        </div>
    `;

    const weatherBadgeFields = `
        ${renderCustomModeToggle('Weather Badge Styling', 'wl-cdm-p-weatherBadgeMode', p.weatherBadgeMode, 'Off leaves the extension’s presentation untouched.', 'extension')}
        <div data-wl-general-ui-conditional="weather-custom"${weatherCustomHidden}>
            <div class="wl-cdm-field wl-cdm-compact-field">
                <label class="wl-cdm-field-label">Preset</label>
                <select class="wl-cdm-select" id="wl-cdm-weather-badge-preset">
                    <option value="">— Load a preset —</option>
                    ${Object.entries(WEATHER_BADGE_PRESETS).map(([key, preset]) =>
                        `<option value="${key}">${esc(preset.label)}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="wl-cdm-field-hint">Presets fill every field below. Adjust anything afterward.</div>

            <div class="wl-cdm-subsection">Typography</div>
            ${renderThemeSelectField('Font', 'wl-cdm-p-weatherBadgeFont', 'wl-cdm-p-weatherBadgeFontUseCustom', p.weatherBadgeFontUseCustom, p.weatherBadgeFont, {
                mono: 'Monospace',
            }, 'Off inherits the active interface font.')}
            ${renderFieldRow([
                renderRangeField('Text Size', 'wl-cdm-p-weatherBadgeFontSize', p.weatherBadgeFontSize, 10, 24, 1, 'px'),
                renderRangeField('Weight', 'wl-cdm-p-weatherBadgeFontWeight', p.weatherBadgeFontWeight, 300, 800, 100, ''),
            ])}
            ${renderRangeField('Letter Spacing', 'wl-cdm-p-weatherBadgeLetterSpacing', p.weatherBadgeLetterSpacing, -0.5, 2, 0.1, 'px')}

            <div class="wl-cdm-subsection">Shape & Surface</div>
            ${renderFieldRow([
                renderRangeField('Horizontal Padding', 'wl-cdm-p-weatherBadgePaddingX', p.weatherBadgePaddingX, 0, 28, 1, 'px'),
                renderRangeField('Vertical Padding', 'wl-cdm-p-weatherBadgePaddingY', p.weatherBadgePaddingY, 0, 20, 1, 'px'),
            ])}
            ${renderFieldRow([
                renderRangeField('Corner Radius', 'wl-cdm-p-weatherBadgeRadius', p.weatherBadgeRadius, 0, 40, 1, 'px'),
                renderRangeField('Border Width', 'wl-cdm-p-weatherBadgeBorderWidth', p.weatherBadgeBorderWidth, 0, 4, 1, 'px'),
            ])}
            ${renderFieldRow([
                renderRangeField('Background Opacity', 'wl-cdm-p-weatherBadgeBackgroundOpacity', p.weatherBadgeBackgroundOpacity, 0, 1, 0.05, ''),
                renderRangeField('Border Opacity', 'wl-cdm-p-weatherBadgeBorderOpacity', p.weatherBadgeBorderOpacity, 0, 1, 0.05, ''),
            ])}
            ${renderFieldRow([
                renderRangeField('Glass Blur', 'wl-cdm-p-weatherBadgeBlur', p.weatherBadgeBlur, 0, 24, 1, 'px'),
                renderSelectField('Shadow', 'wl-cdm-p-weatherBadgeShadow', p.weatherBadgeShadow, {
                    none: 'None', soft: 'Soft', float: 'Floating', glow: 'Glow',
                }),
            ])}

            <div class="wl-cdm-subsection">Colors</div>
            ${renderCustomModeToggle('Colors', 'wl-cdm-p-weatherBadgePalette', p.weatherBadgePalette, 'Off derives the palette from the active theme.')}
            <div data-wl-general-ui-conditional="weather-colors"${weatherColorsHidden}>
                ${renderFieldRow([
                    renderColorField('Background', 'wl-cdm-p-weatherBadgeBackgroundColor', p.weatherBadgeBackgroundColor),
                    renderColorField('Text', 'wl-cdm-p-weatherBadgeTextColor', p.weatherBadgeTextColor),
                ])}
                ${renderColorField('Border', 'wl-cdm-p-weatherBadgeBorderColor', p.weatherBadgeBorderColor)}
            </div>
        </div>
    `;

    const chatTopBarFields = `
        <div class="wl-cdm-subsection">Surface</div>
        ${renderCustomModeToggle('Background Color', 'wl-cdm-p-chatTopBarSurfaceMode', p.chatTopBarSurfaceMode, 'Off leaves Chat Top Bar’s theme background untouched.', 'extension')}
        <div data-wl-general-ui-conditional="chat-top-bar-surface"${chatTopBarSurfaceHidden}>
            ${renderFieldRow([
                renderColorField('Background', 'wl-cdm-p-chatTopBarBackgroundColor', p.chatTopBarBackgroundColor),
                renderRangeField('Background Opacity', 'wl-cdm-p-chatTopBarBackgroundOpacity', p.chatTopBarBackgroundOpacity, 0, 1, 0.05, ''),
            ])}
        </div>

        <div class="wl-cdm-subsection">Typography & Icons</div>
        ${renderCustomModeToggle('Text & Icon Color', 'wl-cdm-p-chatTopBarTextMode', p.chatTopBarTextMode, 'Off keeps the extension and active theme colors.', 'extension')}
        <div data-wl-general-ui-conditional="chat-top-bar-text"${chatTopBarTextHidden}>
            ${renderColorField('Text & Icon Color', 'wl-cdm-p-chatTopBarTextColor', p.chatTopBarTextColor)}
        </div>

        <div class="wl-cdm-subsection">Corners</div>
        ${renderCustomModeToggle('Corner Rounding', 'wl-cdm-p-chatTopBarRadiusMode', p.chatTopBarRadiusMode, 'Off keeps Chat Top Bar’s native 10px top corners and straight bottom edge.', 'extension')}
        <div data-wl-general-ui-conditional="chat-top-bar-radius"${chatTopBarRadiusHidden}>
            ${renderFieldRow([
                renderRangeField('Top Corner Radius', 'wl-cdm-p-chatTopBarTopRadius', p.chatTopBarTopRadius, 0, 40, 1, 'px'),
                renderRangeField('Bottom Corner Radius', 'wl-cdm-p-chatTopBarBottomRadius', p.chatTopBarBottomRadius, 0, 40, 1, 'px'),
            ])}
        </div>
    `;

    const guidedGenerationsFields = `
        <div class="wl-cdm-subsection">Colors</div>
        ${renderCustomModeToggle('Text & Icon Color', 'wl-cdm-p-guidedGenerationsTextMode', p.guidedGenerationsTextMode, 'Off leaves Guided Generations’ foreground color untouched.', 'extension')}
        <div data-wl-general-ui-conditional="guided-generations-text"${guidedGenerationsTextHidden}>
            ${renderColorField('Text & Icon Color', 'wl-cdm-p-guidedGenerationsTextColor', p.guidedGenerationsTextColor)}
        </div>
        ${renderCustomModeToggle('Background Color', 'wl-cdm-p-guidedGenerationsBackgroundMode', p.guidedGenerationsBackgroundMode, 'Off leaves Guided Generations’ button background untouched.', 'extension')}
        <div data-wl-general-ui-conditional="guided-generations-background"${guidedGenerationsBackgroundHidden}>
            ${renderColorField('Background', 'wl-cdm-p-guidedGenerationsBackgroundColor', p.guidedGenerationsBackgroundColor)}
        </div>

        <div class="wl-cdm-subsection">Border</div>
        ${renderCustomModeToggle('Border Styling', 'wl-cdm-p-guidedGenerationsBorderMode', p.guidedGenerationsBorderMode, 'Off preserves the extension’s border.', 'extension')}
        <div data-wl-general-ui-conditional="guided-generations-border"${guidedGenerationsBorderHidden}>
            ${renderFieldRow([
                renderRangeField('Border Width', 'wl-cdm-p-guidedGenerationsBorderWidth', p.guidedGenerationsBorderWidth, 0, 6, 1, 'px'),
                renderSelectField('Border Style', 'wl-cdm-p-guidedGenerationsBorderStyle', p.guidedGenerationsBorderStyle, {
                    solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', double: 'Double', none: 'None',
                }),
            ])}
            ${renderColorField('Border Color', 'wl-cdm-p-guidedGenerationsBorderColor', p.guidedGenerationsBorderColor)}
        </div>

        <div class="wl-cdm-subsection">Shape</div>
        ${renderCustomModeToggle('Corner Rounding', 'wl-cdm-p-guidedGenerationsRadiusMode', p.guidedGenerationsRadiusMode, 'Off keeps Guided Generations’ native button corners.', 'extension')}
        <div data-wl-general-ui-conditional="guided-generations-radius"${guidedGenerationsRadiusHidden}>
            ${renderRangeField('Corner Radius', 'wl-cdm-p-guidedGenerationsRadius', p.guidedGenerationsRadius, 0, 40, 1, 'px')}
        </div>
    `;

    const controlFields = `
        ${renderCustomModeToggle('Control Colors', 'wl-cdm-p-controlColorsMode', p.controlColorsMode, 'Off leaves SillyTavern and extension controls on their active theme colors.')}
        <div data-wl-general-ui-conditional="controls"${controlsHidden}>
            <div class="wl-cdm-subsection">Checkboxes</div>
            ${renderColorField('Box Surface', 'wl-cdm-p-checkboxSurfaceColor', p.checkboxSurfaceColor)}
            ${renderColorField('Checkmark', 'wl-cdm-p-checkboxTickColor', p.checkboxTickColor)}
            ${renderColorField('Border', 'wl-cdm-p-checkboxBorderColor', p.checkboxBorderColor)}

            <div class="wl-cdm-subsection">Toggles</div>
            ${renderColorField('On', 'wl-cdm-p-toggleOnColor', p.toggleOnColor)}
            ${renderColorField('Off', 'wl-cdm-p-toggleOffColor', p.toggleOffColor)}
            ${renderColorField('Switch Knob', 'wl-cdm-p-toggleKnobColor', p.toggleKnobColor)}

            <div class="wl-cdm-subsection">Radio Buttons</div>
            ${renderColorField('Button Surface', 'wl-cdm-p-radioSurfaceColor', p.radioSurfaceColor)}
            ${renderColorField('Selected Dot', 'wl-cdm-p-radioDotColor', p.radioDotColor)}
            ${renderColorField('Border', 'wl-cdm-p-radioBorderColor', p.radioBorderColor)}

            <div class="wl-cdm-subsection">Sliders</div>
            ${renderColorField('Track', 'wl-cdm-p-sliderTrackColor', p.sliderTrackColor)}
            ${renderColorField('Thumb', 'wl-cdm-p-sliderThumbColor', p.sliderThumbColor)}
            ${renderFieldRow([
                renderSelectField('Thumb Fill', 'wl-cdm-p-scrollbarThumbFill', p.scrollbarThumbFill, { solid: 'Solid', gradient: 'Gradient' }),
                renderColorField('Gradient End', 'wl-cdm-p-scrollbarThumbEndColor', p.scrollbarThumbEndColor),
                renderRangeField('Direction', 'wl-cdm-p-scrollbarThumbAngle', p.scrollbarThumbAngle, 0, 360, 1, '°'),
            ])}
            ${renderColorField('Thumb Border', 'wl-cdm-p-sliderThumbBorderColor', p.sliderThumbBorderColor)}
        </div>
    `;

    const scrollbarFields = `
        ${renderCustomModeToggle('Scrollbar Styling', 'wl-cdm-p-scrollbarMode', p.scrollbarMode, 'Off leaves every scrollbar on its active theme styling.')}
        <div data-wl-general-ui-conditional="scrollbars"${scrollbarsHidden}>
            <div class="wl-cdm-scrollbar-preview" data-wl-scrollbar-preview>
                <div class="wl-cdm-scrollbar-preview-header">
                    <span>Live Preview</span>
                    <span>Scroll me</span>
                </div>
                <div class="wl-cdm-scrollbar-preview-stage">
                    <div class="wl-cdm-scrollbar-preview-viewport" tabindex="0" aria-label="Scrollbar style preview">
                        <div><b>01</b><span>Shape and thickness</span></div>
                        <div><b>02</b><span>Thumb color and opacity</span></div>
                        <div><b>03</b><span>Hover feedback</span></div>
                        <div><b>04</b><span>Track treatment</span></div>
                        <div><b>05</b><span>Corner radius</span></div>
                        <div><b>06</b><span>Inset spacing</span></div>
                    </div>
                    <div class="wl-cdm-scrollbar-preview-rail" aria-hidden="true">
                        <div class="wl-cdm-scrollbar-preview-thumb"></div>
                    </div>
                </div>
            </div>

            <div class="wl-cdm-subsection">Shape</div>
            ${renderFieldRow([
                renderRangeField('Thickness', 'wl-cdm-p-scrollbarWidth', p.scrollbarWidth, 4, 24, 1, 'px'),
                renderRangeField('Corner Radius', 'wl-cdm-p-scrollbarRadius', p.scrollbarRadius, 0, 20, 1, 'px'),
            ])}
            ${renderRangeField('Thumb Inset', 'wl-cdm-p-scrollbarInset', p.scrollbarInset, 0, 4, 1, 'px')}
            <div class="wl-cdm-field-hint">Inset adds transparent breathing room around the draggable thumb without widening the scrollbar.</div>

            <div class="wl-cdm-subsection">Thumb</div>
            ${renderFieldRow([
                renderColorField('Thumb Color', 'wl-cdm-p-scrollbarThumbColor', p.scrollbarThumbColor),
                renderRangeField('Thumb Opacity', 'wl-cdm-p-scrollbarThumbOpacity', p.scrollbarThumbOpacity, 0.1, 1, 0.05, ''),
            ])}
            ${renderColorField('Thumb Border', 'wl-cdm-p-scrollbarThumbBorderColor', p.scrollbarThumbBorderColor)}
            ${renderFieldRow([
                renderColorField('Hover Color', 'wl-cdm-p-scrollbarThumbHoverColor', p.scrollbarThumbHoverColor),
                renderColorField('Hover Border', 'wl-cdm-p-scrollbarThumbHoverBorderColor', p.scrollbarThumbHoverBorderColor),
            ])}

            ${renderFieldRow([
                renderSelectField('Hover Fill', 'wl-cdm-p-scrollbarThumbHoverFill', p.scrollbarThumbHoverFill, { solid: 'Solid', gradient: 'Gradient' }),
                renderColorField('Gradient End', 'wl-cdm-p-scrollbarThumbHoverEndColor', p.scrollbarThumbHoverEndColor),
                renderRangeField('Direction', 'wl-cdm-p-scrollbarThumbHoverAngle', p.scrollbarThumbHoverAngle, 0, 360, 1, '°'),
            ])}
            <div class="wl-cdm-subsection">Track</div>
            ${renderFieldRow([
                renderColorField('Track Color', 'wl-cdm-p-scrollbarTrackColor', p.scrollbarTrackColor),
                renderRangeField('Track Opacity', 'wl-cdm-p-scrollbarTrackOpacity', p.scrollbarTrackOpacity, 0, 1, 0.05, ''),
            ])}
            ${renderFieldRow([
                renderSelectField('Track Fill', 'wl-cdm-p-scrollbarTrackFill', p.scrollbarTrackFill, { solid: 'Solid', gradient: 'Gradient' }),
                renderColorField('Gradient End', 'wl-cdm-p-scrollbarTrackEndColor', p.scrollbarTrackEndColor),
                renderRangeField('Direction', 'wl-cdm-p-scrollbarTrackAngle', p.scrollbarTrackAngle, 0, 360, 1, '°'),
            ])}

        </div>
    `;

    const sections = {
        'top-bar': {
            content: topBarFields,
            hint: 'Shape, layout, surface, and border for SillyTavern/TauriTavern\'s top controls. Icon presentation is under Icons → Top Bar Styling.',
        },
        'input-area': {
            content: inputAreaFields,
            hint: 'Styles the bottom composer shell, message textarea, and its native controls. Quick Reply buttons are handled separately under QR Buttons.',
        },
        'qr-buttons': {
            content: qrButtonFields,
            hint: 'Styles Quick Reply buttons in both the composer bar and QR popout without changing their labels, actions, or set organization.',
        },
        controls: {
            content: controlFields,
            hint: 'Character-scoped colors for native checkboxes, switch-style toggles, radio buttons, and range sliders.',
        },
        scrollbars: {
            content: scrollbarFields,
            hint: 'Character-scoped styling for vertical and horizontal scrollbars throughout the interface.',
        },
    };
    if (isWeatherCycleBadgeAvailable()) {
        sections['weather-badge'] = {
            content: weatherBadgeFields,
            hint: 'Character-scoped presentation for st-weather-cycle. Weather Cycle still controls its text and visibility.',
        };
    }
    if (isChatTopBarAvailable()) {
        sections['chat-top-bar'] = {
            content: chatTopBarFields,
            hint: 'Character-scoped surface, foreground color, and corner shape for the Chat Top Bar extension.',
        };
    }
    if (isGuidedGenerationsAvailable()) {
        sections['guided-generations'] = {
            content: guidedGenerationsFields,
            hint: 'Character-scoped colors, border, and corner shape for Guided Generations’ bottom input-area buttons.',
        };
    }
    return renderActivePropertySection(sections, activeSection);
}

// ── Background Properties ──

function renderBackgroundProps(p) {
    // Backfill keys added to the schema after this style was first created
    // (e.g. the texture fields). The generic property wiring only persists a
    // field when its key already exists on the style, so without this, edits to
    // newer controls on an older style would silently no-op.
    for (const [k, v] of Object.entries(ELEMENT_DEFAULTS.background)) {
        if (!(k in p)) p[k] = v;
    }
    return `
        <div class="wl-cdm-field wl-cdm-compact-field">
            <label class="wl-cdm-field-label">Preset</label>
            <select class="wl-cdm-select" id="wl-cdm-bg-preset">
                <option value="">— Load a preset —</option>
                ${Object.entries(BACKGROUND_PRESETS).map(([key, preset]) =>
                    `<option value="${key}">${esc(preset.label)}</option>`
                ).join('')}
            </select>
        </div>
        <div class="wl-cdm-field-hint">Fills every field below with a curated look — tweak freely afterward, or leave it and build your own.</div>

        <div class="wl-cdm-subsection">Image Adjustments</div>
        <div class="wl-cdm-field-hint">Filters applied to the background image itself.</div>
        ${renderFieldRow([
            renderRangeField('Blur', 'wl-cdm-p-blur', p.blur ?? 0, 0, 30, 0.5, 'px'),
            renderRangeField('Brightness', 'wl-cdm-p-brightness', p.brightness ?? 100, 0, 200, 5, '%'),
        ])}
        ${renderFieldRow([
            renderRangeField('Contrast', 'wl-cdm-p-contrast', p.contrast ?? 100, 0, 200, 5, '%'),
            renderRangeField('Saturation', 'wl-cdm-p-saturate', p.saturate ?? 100, 0, 200, 5, '%'),
        ])}
        ${renderFieldRow([
            renderRangeField('Grayscale', 'wl-cdm-p-grayscale', p.grayscale ?? 0, 0, 100, 5, '%'),
            renderRangeField('Sepia', 'wl-cdm-p-sepia', p.sepia ?? 0, 0, 100, 5, '%'),
        ])}
        ${renderFieldRow([
            renderRangeField('Hue Rotate', 'wl-cdm-p-hueRotate', p.hueRotate ?? 0, 0, 360, 5, 'deg'),
            renderRangeField('Zoom', 'wl-cdm-p-zoom', p.zoom ?? 100, 100, 200, 1, '%', 'Zoom crops in; 100% = no zoom.'),
        ])}

        <div class="wl-cdm-subsection">Base Tint</div>
        <div class="wl-cdm-field-hint">Linear wash over the image — darkens so text pops.</div>
        ${renderColorField('Tint Color', 'wl-cdm-p-tintColor', p.tintColor)}
        ${renderFieldRow([
            renderRangeField('Top Opacity', 'wl-cdm-p-tintTopOpacity', p.tintTopOpacity ?? 0, 0, 1, 0.02, ''),
            renderRangeField('Bottom Opacity', 'wl-cdm-p-tintBottomOpacity', p.tintBottomOpacity ?? 0, 0, 1, 0.02, ''),
        ])}
        ${renderRangeField('Angle', 'wl-cdm-p-tintAngle', p.tintAngle ?? 180, 0, 360, 5, 'deg')}

        <div class="wl-cdm-subsection">Center Highlight</div>
        <div class="wl-cdm-field-hint">Soft radial glow at the center of the screen.</div>
        ${renderColorField('Highlight Color', 'wl-cdm-p-highlightColor', p.highlightColor)}
        ${renderFieldRow([
            renderRangeField('Highlight Opacity', 'wl-cdm-p-highlightOpacity', p.highlightOpacity ?? 0, 0, 1, 0.02, ''),
            renderRangeField('Highlight Size', 'wl-cdm-p-highlightSize', p.highlightSize ?? 40, 5, 100, 1, '%'),
        ])}

        <div class="wl-cdm-subsection">Accent Glow</div>
        <div class="wl-cdm-field-hint">A colored radial you can anchor to any corner or edge.</div>
        ${renderColorField('Accent Color', 'wl-cdm-p-accentColor', p.accentColor)}
        ${renderFieldRow([
            renderRangeField('Accent Opacity', 'wl-cdm-p-accentOpacity', p.accentOpacity ?? 0, 0, 1, 0.02, ''),
            renderRangeField('Accent Size', 'wl-cdm-p-accentSize', p.accentSize ?? 42, 5, 100, 1, '%'),
        ])}
        ${renderSelectField('Accent Position', 'wl-cdm-p-accentPosition', p.accentPosition, {
            'center': 'Center',
            'top': 'Top', 'bottom': 'Bottom', 'left': 'Left', 'right': 'Right',
            'top left': 'Top Left', 'top right': 'Top Right',
            'bottom left': 'Bottom Left', 'bottom right': 'Bottom Right',
        })}

        <div class="wl-cdm-subsection">Vignette</div>
        <div class="wl-cdm-field-hint">Darkens the edges, keeping the center clear.</div>
        ${renderColorField('Vignette Color', 'wl-cdm-p-vignetteColor', p.vignetteColor)}
        ${renderFieldRow([
            renderRangeField('Vignette Opacity', 'wl-cdm-p-vignetteOpacity', p.vignetteOpacity ?? 0, 0, 1, 0.02, ''),
            renderRangeField('Vignette Start', 'wl-cdm-p-vignetteSize', p.vignetteSize ?? 60, 0, 100, 1, '%'),
        ], 'Lower start values bring the darkening further toward the center.')}

        <div class="wl-cdm-subsection">Texture</div>
        <div class="wl-cdm-field-hint">A repeating line pattern over everything. Cheap to render — keep opacity low.</div>
        ${renderSelectField('Pattern', 'wl-cdm-p-textureType', p.textureType ?? 'none', {
            'none': 'None', 'scanlines': 'Scanlines', 'grid': 'Grid',
        })}
        ${renderColorField('Texture Color', 'wl-cdm-p-textureColor', p.textureColor)}
        ${renderFieldRow([
            renderRangeField('Texture Opacity', 'wl-cdm-p-textureOpacity', p.textureOpacity ?? 0, 0, 0.5, 0.01, ''),
            renderRangeField('Line Spacing', 'wl-cdm-p-textureScale', p.textureScale ?? 3, 2, 12, 1, 'px'),
        ])}

        <div class="wl-cdm-subsection">Blend</div>
        ${renderSelectField('Overlay Blend Mode', 'wl-cdm-p-blendMode', p.blendMode, {
            'normal': 'Normal', 'multiply': 'Multiply', 'screen': 'Screen',
            'overlay': 'Overlay', 'soft-light': 'Soft Light', 'hard-light': 'Hard Light',
            'color-dodge': 'Color Dodge', 'lighten': 'Lighten', 'darken': 'Darken',
        })}
    `;
}

// ── Cursor Properties ──
//
// Unlike the other element types, a cursor style stores a nested object at
// props.cursor and its "set" source depends on async server discovery. So the
// synchronous renderer returns just a placeholder panel; renderCursorPanelInto()
// (called from renderEditor after the DOM exists) fills it once discovery
// resolves and wires the inputs. Field ids use the `wl-cdm-cur-` prefix so the
// generic property wiring (which keys on `wl-cdm-p-`) never touches them.

function renderCursorProps(props) {
    // Backfill the nested shape for styles created before this schema existed.
    const cur = ensureCursorShape(props);
    void cur;
    return `
        <div class="wl-cdm-cursor" id="wl-cdm-cursor-panel">
            <div class="wl-cdm-empty-small">Loading cursor sets…</div>
        </div>
    `;
}

/** Ensure props.cursor exists with all expected keys; returns it. */
function ensureCursorShape(props) {
    if (!props.cursor || typeof props.cursor !== 'object') {
        props.cursor = { mode: 'set', setName: '', manual: {}, url: '', hotspotX: 0, hotspotY: 0, maxSize: 32 };
    }
    const c = props.cursor;
    if (c.mode !== 'url') c.mode = 'set';
    if (typeof c.setName !== 'string') c.setName = '';
    if (!c.manual || typeof c.manual !== 'object') c.manual = {};
    if (typeof c.url !== 'string') c.url = '';
    c.hotspotX = Number(c.hotspotX) || 0;
    c.hotspotY = Number(c.hotspotY) || 0;
    c.maxSize = Number(c.maxSize) || 32;
    return c;
}

/**
 * Async: refresh discovery, then render the cursor panel HTML into the
 * placeholder and wire it. Called from renderEditor for cursor styles.
 */
async function renderCursorPanelInto(container, style) {
    // A fresh scan each time the editor opens, so newly-dropped set folders
    // and files show up without restarting anything client-side.
    try { await refreshCursorDiscovery(); } catch { /* fall through to snapshot */ }

    const panel = container.querySelector('#wl-cdm-cursor-panel');
    if (!panel) return; // editor was closed/switched while we awaited
    const disc = getCursorDiscovery();
    panel.innerHTML = buildCursorPanelHTML(style, disc);
    wireCursorInputs(container, style, disc);
}

/** Build the <datalist> of all discovered cursor file paths (autocomplete). */
function buildCursorDatalist(disc) {
    const opts = [];
    for (const set of disc.sets || []) {
        for (const file of set.files || []) {
            opts.push(cursorFileUrl(set.name, file));
        }
    }
    for (const file of disc.loose || []) {
        opts.push(`/${disc.root}/${encodeURIComponent(file)}`);
    }
    if (opts.length === 0) return '';
    return `<datalist id="wl-cdm-cur-files">${
        opts.map(o => `<option value="${esc(o)}"></option>`).join('')
    }</datalist>`;
}

function buildCursorPanelHTML(style, disc) {
    const cur = ensureCursorShape(style.properties);
    const mode = cur.mode === 'url' ? 'url' : 'set';
    const datalist = buildCursorDatalist(disc);

    const modeSelect = `
        <div class="wl-cdm-field wl-cdm-compact-field">
            <label class="wl-cdm-field-label">Cursor Source</label>
            <select class="wl-cdm-select" id="wl-cdm-cur-mode">
                <option value="set" ${mode === 'set' ? 'selected' : ''}>Cursor set + per-type overrides</option>
                <option value="url" ${mode === 'url' ? 'selected' : ''}>Single cursor (applies to everything)</option>
            </select>
        </div>
        <div class="wl-cdm-field-hint">
            <i class="fa-solid fa-triangle-exclamation"></i>
            ${disc.framesAvailable
                ? 'Animated <code>.ani</code> cursors can\'t animate in SillyTavern\'s browser engine, so they\'re shown as a static first frame. <code>.cur</code>, <code>.png</code> and <code>.svg</code> are best.'
                : 'Animated <code>.ani</code> cursors won\'t animate in SillyTavern\'s browser engine and may not display (update/restart the Nebula plugin for static-frame support). <code>.cur</code>, <code>.png</code> and <code>.svg</code> are safe.'}
        </div>
    `;

    const body = mode === 'url'
        ? buildCursorUrlMode(cur)
        : buildCursorSetMode(cur, disc);

    return `${datalist}${modeSelect}${body}`;
}

function buildCursorUrlMode(cur) {
    return `
        <div class="wl-cdm-subsection">Single Cursor</div>
        <div class="wl-cdm-field-hint">One cursor for the whole UI (a <code>* { cursor }</code> rule). Paste a URL or a served path like <code>/user/files/cursors/MySet/Arrow.cur</code>.</div>
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">Cursor URL / Path</label>
            <div class="wl-cdm-cur-urlrow">
                <input type="text" class="wl-cdm-input" id="wl-cdm-cur-url"
                       list="wl-cdm-cur-files" value="${esc(cur.url || '')}"
                       placeholder="https://…  or  /user/images/cursors/…">
                <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-cur-upload">
                    <i class="fa-solid fa-upload"></i> Upload image
                </button>
                <input type="file" id="wl-cdm-cur-file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,image/*" hidden>
            </div>
        </div>
        <div class="wl-cdm-cur-hotspot">
            <div class="wl-cdm-field">
                <label class="wl-cdm-field-label">Hotspot X</label>
                <input type="number" class="wl-cdm-input" id="wl-cdm-cur-hsx" min="0" max="128" value="${Number(cur.hotspotX) || 0}">
            </div>
            <div class="wl-cdm-field">
                <label class="wl-cdm-field-label">Hotspot Y</label>
                <input type="number" class="wl-cdm-input" id="wl-cdm-cur-hsy" min="0" max="128" value="${Number(cur.hotspotY) || 0}">
            </div>
        </div>
        <div class="wl-cdm-field-hint">Hotspot = the active pixel (e.g. an arrow tip). Ignored for <code>.cur</code>/<code>.ani</code>, which carry their own; set it for <code>.png</code>/<code>.svg</code>.</div>
    `;
}

function buildCursorSetMode(cur, disc) {
    // ── Set picker (only when discovery is available) ──
    let setBlock;
    if (disc.available) {
        const sets = disc.sets || [];
        const options = ['<option value="">None</option>']
            .concat(sets.map(s => `<option value="${esc(s.name)}" ${s.name === cur.setName ? 'selected' : ''}>${esc(s.name)} (${(s.files || []).length})</option>`))
            .join('');
        const emptyNote = sets.length === 0
            ? `<div class="wl-cdm-field-hint">No sets found in <code>${esc(disc.root)}/</code>. Import a folder or upload cursor files below — or assign cursors manually.</div>`
            : '';
        setBlock = `
            <div class="wl-cdm-subsection">Cursor Set</div>
            <div class="wl-cdm-field wl-cdm-compact-field">
                <label class="wl-cdm-field-label">Set</label>
                <div class="wl-cdm-cur-setrow">
                    <select class="wl-cdm-select" id="wl-cdm-cur-set">${options}</select>
                    <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-cur-rescan" title="Re-scan the cursors folder">
                        <i class="fa-solid fa-rotate"></i>
                    </button>
                </div>
            </div>
            ${emptyNote}
            <div class="wl-cdm-field">
                <label class="wl-cdm-field-label">Upload destination</label>
                <input type="text" class="wl-cdm-input" id="wl-cdm-cur-import-name"
                       value="${esc(cur.setName || '')}" placeholder="Cursor set name">
                <div class="wl-cdm-cur-importrow">
                    <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-cur-upload-files">
                        <i class="fa-solid fa-file-arrow-up"></i> Upload files
                    </button>
                    <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-cur-import-folder">
                        <i class="fa-solid fa-folder-open"></i> Import folder
                    </button>
                    <input type="file" id="wl-cdm-cur-files-input"
                           accept=".cur,.ani,.png,.svg,.gif,.webp,.ico" multiple hidden>
                    <input type="file" id="wl-cdm-cur-folder-input"
                           accept=".cur,.ani,.png,.svg,.gif,.webp,.ico"
                           webkitdirectory directory multiple hidden>
                </div>
                <div class="wl-cdm-field-hint">Saves into <code>user/files/cursors/&lt;set name&gt;/</code>. Folder import uses the selected folder's name and keeps safe subfolders.</div>
            </div>
            ${buildCursorCoverageHTML(cur, disc)}
        `;
    } else {
        setBlock = `
            <div class="wl-cdm-subsection">Cursor Set</div>
            <div class="wl-cdm-field-hint">
                Auto-discovery of cursor sets needs the <strong>Nebula Loader</strong> server plugin (restart SillyTavern after installing/updating it). You can still assign cursors by hand below, or switch the source to a single URL.
            </div>
        `;
    }

    // ── Per-type manual overrides ──
    const rows = EMITTABLE_CURSOR_TYPES.map(t => `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">${esc(t.label)}</label>
            <div class="wl-cdm-cur-overriderow">
                <input type="text" class="wl-cdm-input wl-cdm-cur-manual" data-cur-type="${esc(t.key)}"
                       list="wl-cdm-cur-files" value="${esc((cur.manual && cur.manual[t.key]) || '')}"
                       placeholder="URL or uploaded cursor">
                ${disc.available ? `
                    <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost wl-cdm-cur-type-upload"
                            data-cur-type="${esc(t.key)}" title="Upload a cursor for ${esc(t.label)}">
                        <i class="fa-solid fa-upload"></i> Upload
                    </button>
                    <input type="file" class="wl-cdm-cur-type-file" data-cur-type="${esc(t.key)}"
                           accept=".cur,.ani,.png,.svg,.gif,.webp,.ico" hidden>
                ` : ''}
            </div>
        </div>
    `).join('');

    const sizeField = disc.framesAvailable ? `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">Max cursor size (px)</label>
            <input type="number" class="wl-cdm-input" id="wl-cdm-cur-maxsize"
                   min="8" max="128" step="1" value="${Number(cur.maxSize) || 32}">
        </div>
        <div class="wl-cdm-field-hint">Caps large multi-resolution <code>.cur</code> packs — some ship a 128px image that renders as a giant cursor. 32 is the standard size.</div>
    ` : '';

    return `
        ${setBlock}
        ${sizeField}
        <div class="wl-cdm-subsection">Per-Type Overrides</div>
        <div class="wl-cdm-field-hint">Optional. ${disc.available ? 'Click Upload on the exact cursor type you want to replace; ' : ''}That row wins over the chosen set. You can also paste an existing URL or path.</div>
        ${rows}
    `;
}

/** Small preview of what a chosen set maps to, with warnings. */
function buildCursorCoverageHTML(cur, disc) {
    if (!cur.setName) return '';
    const set = (disc.sets || []).find(s => s.name === cur.setName);
    if (!set) return '';
    const map = mapSetFiles(set.files);

    const mapped = [];
    const warnings = [];
    for (const t of CURSOR_TYPES) {
        const file = map[t.key];
        if (!file) continue;
        mapped.push(`${esc(t.label.split(' (')[0])} → ${esc(file)}`);
        if (isAnimatedCursor(file)) {
            if (!t.selectors) warnings.push(`${esc(file)} (${esc(t.key)}) has no target element in SillyTavern`);
            else if (disc.framesAvailable) warnings.push(`${esc(file)} is animated — shown as a static first frame`);
            else warnings.push(`${esc(file)} is animated (.ani) and won't display here`);
        } else if (!t.selectors) {
            warnings.push(`${esc(file)} (${esc(t.key)}) has no target element in SillyTavern`);
        }
    }

    if (mapped.length === 0) {
        return `<div class="wl-cdm-field-hint">This set has no recognizable standard cursor filenames (Arrow, Hand, IBeam, …). Use manual overrides below.</div>`;
    }
    const warnHTML = warnings.length
        ? `<div class="wl-cdm-field-hint wl-cdm-cur-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${warnings.join('; ')}.</div>`
        : '';
    return `
        <div class="wl-cdm-field-hint">Auto-mapped: ${mapped.join(', ')}.</div>
        ${warnHTML}
    `;
}

// ============================================================
// Assignment Panel
// ============================================================

async function getCachedAssignmentPersonas() {
    const cacheIsFresh = assignmentPersonasCache !== null
        && Date.now() - assignmentPersonasCachedAt < ASSIGNMENT_PERSONA_CACHE_MS;
    if (cacheIsFresh) return assignmentPersonasCache;

    if (!assignmentPersonasPromise) {
        assignmentPersonasPromise = getAvailablePersonas()
            .then(personas => {
                assignmentPersonasCache = Array.isArray(personas) ? personas : [];
                assignmentPersonasCachedAt = Date.now();
                return assignmentPersonasCache;
            })
            .catch(() => assignmentPersonasCache || [])
            .finally(() => { assignmentPersonasPromise = null; });
    }

    return assignmentPersonasPromise;
}

/**
 * Async: resolve personas (disk-based, so async), render the assignment
 * panel HTML into the #wl-cdm-assignment placeholder, then wire its events.
 * Split out from renderEditor because getAvailablePersonas() is async.
 */
async function renderAssignmentInto(container, style) {
    const personas = await getCachedAssignmentPersonas();
    if (editingStyleId !== style.id) return;

    const panel = container.querySelector('#wl-cdm-assignment');
    if (!panel) return;
    panel.innerHTML = renderAssignment(style, personas);

    // Wire assignment events now that the DOM exists.
    wireAssignmentInputs(container, style);
}

function renderAssignment(style, personas = []) {
    const characters = getAvailableCharacters().sort((a, b) => a.name.localeCompare(b.name));
    const sortedPersonas = personas.slice().sort((a, b) => a.name.localeCompare(b.name));
    const verses = getAvailableVerses();
    const charTags = getCharacterTags();

    // Global styles key off the character only: personas share the character's
    // chat background, cursor, and surrounding interface.
    const globalElement = style.element === 'background'
        || style.element === 'cursor'
        || style.element === 'generalUi';
    const showPersonas = !globalElement;
    const defaultLabel = globalElement
        ? 'Default (applies to all chats)'
        : 'Default (applies to all messages)';

    const charRow = (c) => {
        const tagIds = (c.tags || []).map(t => t.id).join(' ');
        const tagNames = (c.tags || []).map(t => t.name).join(' ');
        // data-search holds everything the text filter matches against:
        // display name, avatar filename, and tag names.
        const search = `${c.name} ${c.avatar} ${tagNames}`.toLowerCase();
        return `
            <label class="wl-cdm-checkbox-item wl-cdm-pickrow"
                   data-search="${esc(search)}" data-tagids="${esc(tagIds)}">
                <input type="checkbox" value="${esc(c.avatar)}"
                    ${(style.assignedCharacters || []).includes(c.avatar) ? 'checked' : ''}>
                <span>${esc(c.name)} <span class="wl-cdm-pick-hint">${esc(c.avatar)}</span></span>
            </label>
        `;
    };

    const personaRow = (p) => {
        const hint = p.title || p.avatar;
        const search = `${p.name} ${p.title || ''} ${p.avatar}`.toLowerCase();
        return `
            <label class="wl-cdm-checkbox-item wl-cdm-pickrow" data-search="${esc(search)}">
                <input type="checkbox" value="${esc(p.avatar)}"
                    ${(style.assignedPersonas || []).includes(p.avatar) ? 'checked' : ''}>
                <span>${esc(p.name)} <span class="wl-cdm-pick-hint">${esc(hint)}</span></span>
            </label>
        `;
    };

    const tagChips = renderTagFilter(charTags, 'wl-cdm-tag-chips');

    return `
        <div class="wl-cdm-field wl-cdm-default-row">
            <label class="wl-cdm-checkbox-item">
                <input type="checkbox" id="wl-cdm-a-default" ${style.isDefault ? 'checked' : ''}>
                <span>${defaultLabel}</span>
            </label>
        </div>

        <div class="wl-cdm-assign-targets" id="wl-cdm-assign-targets" style="${style.isDefault ? 'display:none' : ''}">

            <!-- Filter toolbar -->
            <div class="wl-cdm-pick-filter">
                <input type="text" class="wl-cdm-input wl-cdm-pick-search" id="wl-cdm-pick-search"
                       placeholder="Filter by name, tag, or file…">
                ${tagChips}
            </div>

            <!-- Characters -->
            <div class="wl-cdm-assign-group">
                <div class="wl-cdm-assign-group-heading">
                    <div class="wl-cdm-assign-group-title">Characters</div>
                    <button type="button" class="wl-cdm-toggle-all" id="wl-cdm-a-chars-toggle-all"
                            ${characters.length === 0 ? 'disabled' : ''}>Toggle all</button>
                </div>
                <div class="wl-cdm-checkbox-list" id="wl-cdm-a-chars">
                    ${characters.length === 0
                        ? '<div class="wl-cdm-empty-small">No characters loaded</div>'
                        : characters.map(charRow).join('')
                    }
                    <div class="wl-cdm-empty-small wl-cdm-no-match" id="wl-cdm-chars-nomatch" style="display:none">No matches</div>
                </div>
            </div>

            ${showPersonas ? `
            <!-- Personas -->
            <div class="wl-cdm-assign-group">
                <div class="wl-cdm-assign-group-title">Personas</div>
                <div class="wl-cdm-checkbox-list" id="wl-cdm-a-personas">
                    ${sortedPersonas.length === 0
                        ? '<div class="wl-cdm-empty-small">No personas found</div>'
                        : sortedPersonas.map(personaRow).join('')
                    }
                    <div class="wl-cdm-empty-small wl-cdm-no-match" id="wl-cdm-personas-nomatch" style="display:none">No matches</div>
                </div>
            </div>
            ` : ''}

            ${verses.length > 0 ? `
                <!-- Verses (VM integration) -->
                <div class="wl-cdm-assign-group">
                    <div class="wl-cdm-assign-group-title">Verses</div>
                    <div class="wl-cdm-checkbox-list" id="wl-cdm-a-verses">
                        ${verses.map(v => `
                            <label class="wl-cdm-checkbox-item">
                                <input type="checkbox" value="${esc(v.id)}"
                                    ${(style.assignedVerses || []).includes(v.id) ? 'checked' : ''}>
                                <span>${esc(v.name)}</span>
                            </label>
                        `).join('')}
                    </div>
                    <label class="wl-cdm-checkbox-item wl-cdm-verse-personas-toggle" ${globalElement ? 'hidden' : ''}>
                        <input type="checkbox" id="wl-cdm-a-versePersonas"
                            ${style.assignedVersesIncludePersonas ? 'checked' : ''}>
                        <span>Include verse personas</span>
                    </label>
                </div>
            ` : ''}
        </div>
    `;
}

// ============================================================
// Editor Event Wiring
// ============================================================

function wireEditorEvents(container, style) {
    // Back / Cancel / Save buttons
    container.querySelector('#wl-cdm-back')?.addEventListener('click', () => {
        cancelEdit();
        renderContent();
    });
    container.querySelector('#wl-cdm-cancel')?.addEventListener('click', () => {
        cancelEdit();
        refreshChatDesignCSS();
        renderContent();
    });
    container.querySelector('#wl-cdm-save')?.addEventListener('click', () => {
        saveEdit();
        renderContent();
    });

    // Style name
    container.querySelector('#wl-cdm-style-name')?.addEventListener('input', (e) => {
        updateStyleMeta(style.id, { name: e.target.value });
    });

    wirePropertyTabBar(container, tabId => {
        activePropertyTabs.set(getPropertyTabStateKey(style.element), tabId);
        rerenderPropertiesPanel(container, style);
    });
    wireIconSectionTabBar(container);
    wireGeneralUiSectionTabBar(container);

    // Property changes — generic wiring
    wirePropertyInputs(container, style);

    // Background preset picker (background styles only). Re-attaches itself
    // after re-rendering the props panel.
    wireBgPresetPicker(container, style);

    // Banner preset picker (banner styles only). Same one-shot fill behaviour.
    wireBannerPresetPicker(container, style);

    // Avatar overlay preset picker (Message Elements styles only).
    wireAvatarOverlayPresetPicker(container, style);

    // Message-action preset picker (Message Elements styles only).
    wireMessageActionPresetPicker(container, style);

    // Weather badge preset picker (General UI styles when Weather Cycle exists).
    wireWeatherBadgePresetPicker(container, style);

    // NOTE: assignment inputs are wired by renderAssignmentInto() after the
    // async persona list resolves and the panel HTML is injected. Wiring here
    // would find no assignment DOM yet.
}

function rerenderPropertiesPanel(container, style) {
    const props = container.querySelector('#wl-cdm-props');
    if (!props) return;
    const openGroups = [...props.querySelectorAll('details[open]')]
        .map(group => group.querySelector('summary span')?.textContent)
        .filter(Boolean);
    const propertyTabs = getEditorPropertyTabsForStyle(style);
    const activePropertyTab = getActivePropertyTab(style.element, propertyTabs);
    props.innerHTML = renderEditorProperties(style, activePropertyTab);
    if (propertyTabs.length > 1 || (isGeneralUiIntegrationEditor(style) && propertyTabs.length > 0)) {
        props.setAttribute('role', 'tabpanel');
        props.setAttribute('aria-labelledby', `wl-cdm-property-tab-${activePropertyTab}`);
    } else {
        props.removeAttribute('role');
        props.removeAttribute('aria-labelledby');
    }
    props.querySelectorAll('details').forEach(group => {
        const label = group.querySelector('summary span')?.textContent;
        if (openGroups.includes(label)) group.open = true;
    });
    wirePropertyInputs(container, style);
    wireBgPresetPicker(container, style);
    wireBannerPresetPicker(container, style);
    wireAvatarOverlayPresetPicker(container, style);
    wireMessageActionPresetPicker(container, style);
    wireWeatherBadgePresetPicker(container, style);
}

/**
 * Wire the Background "Load a preset" picker. On selection it overwrites the
 * style's properties with the preset's full set, persists, re-renders the props
 * panel so every control reflects the new values, then re-wires everything
 * (including itself). The <select> resets to the placeholder — presets are a
 * one-shot "fill the fields" action, not a stored mode, so "no preset =
 * customize freely" still holds.
 */
function wireBgPresetPicker(container, style) {
    const sel = container.querySelector('#wl-cdm-bg-preset');
    if (!sel) return; // not a background style
    sel.addEventListener('change', () => {
        const key = sel.value;
        sel.value = ''; // back to the placeholder immediately
        const preset = BACKGROUND_PRESETS[key];
        if (!preset) return;

        const next = JSON.parse(JSON.stringify(preset.properties));
        style.properties = { ...style.properties, ...next };
        updateStyleProperties(style.id, next);

        rerenderPropertiesPanel(container, style);
        refreshChatDesignCSS();
    });
}

/**
 * Wire the Banner "Load a preset" picker. Mirrors wireBgPresetPicker: on
 * selection it overwrites the style's properties with the preset's full set,
 * persists, re-renders the props panel, and re-wires everything (including
 * itself). The <select> snaps back to the placeholder — presets are a one-shot
 * fill, not a stored mode.
 */
function wireBannerPresetPicker(container, style) {
    const sel = container.querySelector('#wl-cdm-banner-preset');
    if (!sel) return; // not a banner style
    sel.addEventListener('change', () => {
        const key = sel.value;
        sel.value = ''; // back to the placeholder immediately
        const preset = BANNER_PRESETS[key];
        if (!preset) return;

        const next = JSON.parse(JSON.stringify(preset.properties));
        style.properties = { ...style.properties, ...next };
        updateStyleProperties(style.id, next);

        rerenderPropertiesPanel(container, style);
        refreshChatDesignCSS();
    });
}

/** Apply a complete avatar-overlay preset without changing the avatar frame. */
function wireAvatarOverlayPresetPicker(container, style) {
    const sel = container.querySelector('#wl-cdm-avatar-overlay-preset');
    if (!sel) return;
    sel.addEventListener('change', () => {
        const key = sel.value;
        sel.value = '';
        const preset = AVATAR_OVERLAY_PRESETS[key];
        if (!preset) return;

        const next = JSON.parse(JSON.stringify(preset.properties));
        style.properties = { ...style.properties, ...next };
        updateStyleProperties(style.id, next);
        rerenderPropertiesPanel(container, style);
        refreshChatDesignCSS();
    });
}

/**
 * Apply one of the six complete message-action studies without disturbing the
 * Avatar or Message Details settings stored on the same style.
 */
function wireMessageActionPresetPicker(container, style) {
    const sel = container.querySelector('#wl-cdm-action-preset');
    if (!sel) return;
    sel.addEventListener('change', () => {
        const key = sel.value;
        sel.value = '';
        const preset = MESSAGE_ACTION_PRESETS[key];
        if (!preset) return;

        const next = JSON.parse(JSON.stringify(preset.properties));
        style.properties = { ...style.properties, ...next };
        updateStyleProperties(style.id, next);
        rerenderPropertiesPanel(container, style);
        refreshChatDesignCSS();
    });
}

/** Apply a complete Weather Badge look while retaining General UI assignments. */
function wireWeatherBadgePresetPicker(container, style) {
    const sel = container.querySelector('#wl-cdm-weather-badge-preset');
    if (!sel) return;
    sel.addEventListener('change', () => {
        const key = sel.value;
        sel.value = '';
        const preset = WEATHER_BADGE_PRESETS[key];
        if (!preset) return;

        const next = JSON.parse(JSON.stringify(preset.properties));
        style.properties = { ...style.properties, ...next };
        updateStyleProperties(style.id, next);
        rerenderPropertiesPanel(container, style);
        refreshChatDesignCSS();
    });
}

function syncMessageActionConditionalFields(props) {
    const visibility = props.querySelector('#wl-cdm-p-actionVisibility')?.value;
    const surface = props.querySelector('#wl-cdm-p-actionSurface')?.value;
    const motion = props.querySelector('#wl-cdm-p-actionHoverMotion')?.value;
    props.querySelectorAll('[data-wl-action-conditional="dim"]').forEach(field => {
        field.hidden = visibility !== 'dim';
    });
    props.querySelectorAll('[data-wl-action-conditional="surface"]').forEach(field => {
        field.hidden = surface === 'bare';
    });
    props.querySelectorAll('[data-wl-action-conditional="speed"]').forEach(field => {
        field.hidden = motion === 'none';
    });
}

function syncAvatarOverlayConditionalFields(props) {
    const type = props.querySelector('#wl-cdm-p-avatarOverlayType')?.value;
    props.querySelectorAll('[data-wl-avatar-overlay-conditional="gradient"]').forEach(field => {
        field.hidden = type !== 'gradient';
    });
}

function syncBannerOverlayConditionalFields(props) {
    const type = props.querySelector('#wl-cdm-p-overlayType')?.value;
    props.querySelectorAll('[data-wl-banner-overlay-conditional="gradient"]').forEach(field => {
        field.hidden = type !== 'gradient';
    });
}

function syncNameFillConditionalFields(props) {
    const mode = props.querySelector('#wl-cdm-p-nameFillMode')?.value;
    props.querySelectorAll('[data-wl-name-fill-conditional="gradient"]').forEach(field => {
        field.hidden = mode !== 'gradient';
    });
    const backgroundMode = props.querySelector('#wl-cdm-p-nameBackgroundFillMode')?.value;
    props.querySelectorAll('[data-wl-name-background-conditional="gradient"]').forEach(field => {
        field.hidden = backgroundMode !== 'gradient';
    });
}

function compactPropertyFields(props) {
    const parents = new Set(
        [...props.querySelectorAll('.wl-cdm-compact-field')]
            .filter(field => !field.parentElement?.classList.contains('wl-cdm-field-grid'))
            .map(field => field.parentElement)
            .filter(Boolean),
    );

    for (const parent of parents) {
        let child = parent.firstElementChild;
        while (child) {
            if (!child.classList.contains('wl-cdm-compact-field')) {
                child = child.nextElementSibling;
                continue;
            }

            const grid = document.createElement('div');
            grid.className = 'wl-cdm-field-grid wl-cdm-auto-field-grid';
            parent.insertBefore(grid, child);
            while (child?.classList.contains('wl-cdm-compact-field')) {
                const next = child.nextElementSibling;
                grid.append(child);
                child = next;
            }
        }
    }
}

function syncGeneralUiConditionalFields(props) {
    const mode = id => {
        const control = props.querySelector(`#${id}`);
        if (!control) return '';
        return control.matches('.wl-cdm-mode-checkbox')
            ? (control.checked ? 'custom' : control.dataset.wlModeOff || 'theme')
            : control.value;
    };
    const widthMode = mode('wl-cdm-p-topBarWidthMode');
    const heightMode = mode('wl-cdm-p-topBarHeightMode');
    const gapMode = mode('wl-cdm-p-chatGapMode');
    const surfaceMode = mode('wl-cdm-p-topBarSurfaceMode');
    const surfaceType = mode('wl-cdm-p-topBarSurfaceType');
    const borderMode = mode('wl-cdm-p-topBarBorderMode');
    const inputSurfaceMode = mode('wl-cdm-p-inputAreaSurfaceMode');
    const inputSurfaceType = mode('wl-cdm-p-inputAreaSurfaceType');
    const inputBorderMode = mode('wl-cdm-p-inputAreaBorderMode');
    const inputLayoutMode = mode('wl-cdm-p-inputAreaLayoutMode');
    const inputTextMode = mode('wl-cdm-p-inputAreaTextMode');
    const inputIconMode = mode('wl-cdm-p-inputAreaIconMode');
    const qrButtonMode = mode('wl-cdm-p-qrButtonMode');
    const qrButtonSurfaceType = mode('wl-cdm-p-qrButtonSurfaceType');
    const sizeMode = mode('wl-cdm-p-iconSizeMode');
    const spacingMode = mode('wl-cdm-p-iconSpacingMode');
    const colorMode = mode('wl-cdm-p-iconColorMode');
    const opacityMode = mode('wl-cdm-p-iconOpacityMode');
    const controlsMode = mode('wl-cdm-p-controlColorsMode');
    const scrollbarMode = mode('wl-cdm-p-scrollbarMode');
    const weatherMode = mode('wl-cdm-p-weatherBadgeMode');
    const weatherPalette = mode('wl-cdm-p-weatherBadgePalette');
    const chatTopBarSurfaceMode = mode('wl-cdm-p-chatTopBarSurfaceMode');
    const chatTopBarTextMode = mode('wl-cdm-p-chatTopBarTextMode');
    const chatTopBarRadiusMode = mode('wl-cdm-p-chatTopBarRadiusMode');
    const guidedGenerationsTextMode = mode('wl-cdm-p-guidedGenerationsTextMode');
    const guidedGenerationsBackgroundMode = mode('wl-cdm-p-guidedGenerationsBackgroundMode');
    const guidedGenerationsBorderMode = mode('wl-cdm-p-guidedGenerationsBorderMode');
    const guidedGenerationsRadiusMode = mode('wl-cdm-p-guidedGenerationsRadiusMode');
    props.querySelectorAll('[data-wl-general-ui-conditional="width"]').forEach(field => {
        field.hidden = widthMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="height"]').forEach(field => {
        field.hidden = heightMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="chat-gap"]').forEach(field => {
        field.hidden = gapMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="surface"]').forEach(field => {
        field.hidden = surfaceMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="surface-gradient"]').forEach(field => {
        field.hidden = surfaceType !== 'gradient';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="border"]').forEach(field => {
        field.hidden = borderMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="input-surface"]').forEach(field => {
        field.hidden = inputSurfaceMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="input-surface-gradient"]').forEach(field => {
        field.hidden = inputSurfaceType !== 'gradient';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="input-border"]').forEach(field => {
        field.hidden = inputBorderMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="input-layout"]').forEach(field => {
        field.hidden = inputLayoutMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="input-text"]').forEach(field => {
        field.hidden = inputTextMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="input-icons"]').forEach(field => {
        field.hidden = inputIconMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="qr-buttons"]').forEach(field => {
        field.hidden = qrButtonMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="qr-gradient"]').forEach(field => {
        field.hidden = qrButtonSurfaceType !== 'gradient';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="size"]').forEach(field => {
        field.hidden = sizeMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="spacing"]').forEach(field => {
        field.hidden = spacingMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="color"]').forEach(field => {
        field.hidden = colorMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="opacity"]').forEach(field => {
        field.hidden = opacityMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="controls"]').forEach(field => {
        field.hidden = controlsMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="scrollbars"]').forEach(field => {
        field.hidden = scrollbarMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="weather-custom"]').forEach(field => {
        field.hidden = weatherMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="weather-colors"]').forEach(field => {
        field.hidden = weatherPalette !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="chat-top-bar-surface"]').forEach(field => {
        field.hidden = chatTopBarSurfaceMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="chat-top-bar-text"]').forEach(field => {
        field.hidden = chatTopBarTextMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="chat-top-bar-radius"]').forEach(field => {
        field.hidden = chatTopBarRadiusMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="guided-generations-text"]').forEach(field => {
        field.hidden = guidedGenerationsTextMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="guided-generations-background"]').forEach(field => {
        field.hidden = guidedGenerationsBackgroundMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="guided-generations-border"]').forEach(field => {
        field.hidden = guidedGenerationsBorderMode !== 'custom';
    });
    props.querySelectorAll('[data-wl-general-ui-conditional="guided-generations-radius"]').forEach(field => {
        field.hidden = guidedGenerationsRadiusMode !== 'custom';
    });
}

function syncCustomToggleFields(props) {
    props.querySelectorAll('[data-wl-font-custom-control]').forEach(control => {
        const key = control.dataset.wlFontCustomControl;
        const toggle = props.querySelector(`#wl-cdm-p-${key}`);
        control.hidden = !toggle?.checked;
    });
    props.querySelectorAll('[data-wl-custom-dependent]').forEach(control => {
        const key = control.dataset.wlCustomDependent;
        const toggle = props.querySelector(`#wl-cdm-p-${key}`);
        control.disabled = !toggle?.checked;
    });
    props.querySelectorAll('[data-wl-custom-region]').forEach(region => {
        const key = region.dataset.wlCustomRegion;
        const toggle = props.querySelector(`#wl-cdm-p-${key}`);
        const disabled = !toggle?.checked;
        region.classList.toggle('wl-cdm-custom-disabled', disabled);
        region.querySelectorAll('input, select, button').forEach(control => {
            control.disabled = disabled;
        });
    });
    props.querySelectorAll('[data-wl-custom-field]').forEach(field => {
        const key = field.dataset.wlCustomField;
        const toggle = props.querySelector(`#wl-cdm-p-${key}`);
        field.classList.toggle('wl-cdm-custom-disabled', !toggle?.checked);
        if (!toggle?.checked) {
            const panel = field.querySelector('.wl-cdm-font-panel');
            if (panel) panel.hidden = true;
        }
    });
}

function syncThinkingConditionalFields(props) {
    const preset = props.querySelector('[data-thinking-preset][aria-checked="true"]')?.dataset.thinkingPreset
        || props.querySelector('[data-thinking-preset]')?.dataset.thinkingPreset
        || 'native';
    props.querySelectorAll('[data-wl-thinking-custom]').forEach(field => {
        field.hidden = preset === 'native';
    });
    props.querySelectorAll('[data-wl-thinking-custom-appearance]').forEach(field => {
        field.hidden = preset !== 'custom';
    });
}

function wireThinkingPresetPicker(props, style) {
    props.querySelectorAll('[data-thinking-preset]').forEach(button => {
        button.addEventListener('click', () => {
            const preset = button.dataset.thinkingPreset;
            if (!preset || !(preset in THINKING_PRESETS)) return;
            props.querySelectorAll('[data-thinking-preset]').forEach(candidate => {
                const active = candidate === button;
                candidate.classList.toggle('wl-cdm-thinking-preset-active', active);
                candidate.setAttribute('aria-checked', String(active));
            });
            updateEditorProperty(style, 'thinkingPreset', preset);
            syncThinkingConditionalFields(props);
            refreshChatDesignCSSDebounced();
        });
    });
}

function updateEditorProperty(style, propKey, value) {
    style.properties[propKey] = value;
    const updates = { [propKey]: value };
    if (style.element === 'avatar'
        && propKey.startsWith('action')
        && propKey !== 'actionButtonsEnabled') {
        style.properties.actionButtonsEnabled = true;
        updates.actionButtonsEnabled = true;
    }
    if (style.element === 'avatar'
        && propKey.startsWith('avatarOverlay')
        && propKey !== 'avatarOverlayEnabled') {
        style.properties.avatarOverlayEnabled = true;
        updates.avatarOverlayEnabled = true;
    }
    updateStyleProperties(style.id, updates);
}

function wireWidthFields(props, style) {
    props.querySelectorAll('[data-wl-width-fill]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const fieldId = checkbox.dataset.wlWidthFill;
            const range = props.querySelector(`#${fieldId}`);
            const fixedControls = props.querySelector(`[data-wl-width-fixed="${fieldId}"]`);
            const propKey = fieldId?.replace('wl-cdm-p-', '');
            if (!range || !fixedControls || !propKey) return;

            fixedControls.hidden = checkbox.checked;
            if (checkbox.checked) {
                updateEditorProperty(style, propKey, 0);
            } else {
                const fixedWidth = Number(range.value) || 600;
                updateEditorProperty(style, propKey, fixedWidth);
            }
            refreshChatDesignCSSDebounced();
        });
    });
}

function wirePropertyInputs(container, style) {
    const props = container.querySelector('#wl-cdm-props');
    if (!props) return;
    compactPropertyFields(props);

    if (style.element === 'container') wireThinkingPresetPicker(props, style);

    props.querySelectorAll('.wl-cdm-mode-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const propKey = checkbox.id.replace('wl-cdm-p-', '');
            if (!propKey) return;
            updateEditorProperty(style, propKey, checkbox.checked ? 'custom' : checkbox.dataset.wlModeOff || 'theme');
            syncGeneralUiConditionalFields(props);
            syncScrollbarPreview(props);
            refreshChatDesignCSSDebounced();
        });
    });

    wireFontPickers(props, ({ fieldId, value }) => {
        const propKey = fieldId.replace('wl-cdm-p-', '');
        if (!propKey || !(propKey in style.properties)) return;
        updateEditorProperty(style, propKey, value);
        refreshChatDesignCSSDebounced();
    });
    wireWidthFields(props, style);

    // Selects (fontSize, fontWeight, etc.)
    props.querySelectorAll('.wl-cdm-select').forEach(select => {
        select.addEventListener('change', () => {
            const propKey = select.id.replace('wl-cdm-p-', '');
            if (propKey && propKey in style.properties) {
                updateEditorProperty(style, propKey, select.value);
                syncMessageActionConditionalFields(props);
                syncAvatarOverlayConditionalFields(props);
                syncBannerOverlayConditionalFields(props);
                syncNameFillConditionalFields(props);
                syncScrollbarPreview(props);
                syncGeneralUiConditionalFields(props);
                refreshChatDesignCSSDebounced();
            }
        });
    });

    // Ranges (height, opacity, padding, etc.)
    props.querySelectorAll('.wl-cdm-range').forEach(range => {
        range.addEventListener('input', () => {
            const propKey = range.id.replace('wl-cdm-p-', '');
            const valDisplay = document.getElementById(`${range.id}-val`);
            const numVal = parseFloat(range.value);

            if (valDisplay) {
                // Preserve the unit suffix from the original rendering
                const current = valDisplay.textContent;
                const unitMatch = current.match(/[a-z%]+$/i);
                const unit = unitMatch ? unitMatch[0] : '';
                valDisplay.textContent = `${numVal}${unit}`;
            }

            if (propKey && propKey in style.properties) {
                updateEditorProperty(style, propKey, numVal);
                syncScrollbarPreview(props);
                refreshChatDesignCSSDebounced();
            }
        });
    });

    // Color inputs
    props.querySelectorAll('.wl-cdm-color').forEach(input => {
        input.addEventListener('input', () => {
            if (input.disabled) return;
            const propKey = input.id.replace('wl-cdm-p-', '');
            const hexInput = input.parentElement?.querySelector(`[data-wl-color-id="${input.id}"]`);
            if (hexInput) {
                hexInput.value = input.value;
                hexInput.removeAttribute('aria-invalid');
            }

            if (propKey && propKey in style.properties) {
                updateEditorProperty(style, propKey, input.value);
                syncScrollbarPreview(props);
                refreshChatDesignCSSDebounced();
            }
        });
    });

    props.querySelectorAll('.wl-cdm-color-hex-input').forEach(input => {
        const applyHexValue = () => {
            const colorInput = props.querySelector(`#${input.dataset.wlColorId}`);
            const hex = normalizeHexColor(input.value);
            if (!colorInput || colorInput.disabled || !hex) {
                input.setAttribute('aria-invalid', 'true');
                return;
            }

            const propKey = colorInput.id.replace('wl-cdm-p-', '');
            colorInput.value = hex;
            input.value = hex;
            input.removeAttribute('aria-invalid');

            if (propKey && propKey in style.properties) {
                updateEditorProperty(style, propKey, hex);
                syncScrollbarPreview(props);
                refreshChatDesignCSSDebounced();
            }
        };

        input.addEventListener('change', applyHexValue);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyHexValue();
                input.blur();
            }
        });
    });

    props.querySelectorAll('[data-wl-action-transparent]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const fieldId = checkbox.dataset.wlActionTransparent;
            const input = props.querySelector(`#${fieldId}`);
            const propKey = fieldId?.replace('wl-cdm-p-', '');
            if (!input || !propKey || !(propKey in style.properties)) return;
            input.disabled = checkbox.checked;
            const hexInput = input.parentElement?.querySelector(`[data-wl-color-id="${fieldId}"]`);
            if (hexInput) {
                hexInput.disabled = checkbox.checked;
                hexInput.value = checkbox.checked ? 'transparent' : input.value;
                hexInput.removeAttribute('aria-invalid');
            }
            const value = checkbox.checked ? 'transparent' : input.value;
            updateEditorProperty(style, propKey, value);
            refreshChatDesignCSSDebounced();
        });
    });

    // Boolean checkboxes (e.g. detachFromLayout).
    // NOTE: we do NOT guard on `propKey in style.properties` here. Styles
    // created before this property existed won't have the key yet, and that
    // guard would silently drop the write (toggle flips in the UI but never
    // saves). Writing unconditionally backfills the key.
    props.querySelectorAll('.wl-cdm-prop-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const propKey = cb.id.replace('wl-cdm-p-', '');
            if (!propKey) return;
            updateEditorProperty(style, propKey, cb.checked);
            const linkedSelect = cb.dataset.wlCustomSelect
                ? props.querySelector(`#${cb.dataset.wlCustomSelect}`)
                : null;
            if (cb.checked && linkedSelect) {
                const valueKey = linkedSelect.id.replace('wl-cdm-p-', '');
                if (valueKey) updateEditorProperty(style, valueKey, linkedSelect.value);
            }
            syncCustomToggleFields(props);
            refreshChatDesignCSSDebounced();
        });
    });

    // Text inputs (textShadow, boxShadow)
    props.querySelectorAll('.wl-cdm-input').forEach(input => {
        if (input.id === 'wl-cdm-style-name') return; // Skip name field
        input.addEventListener('change', () => {
            const propKey = input.id.replace('wl-cdm-p-', '');
            if (propKey && propKey in style.properties) {
                const value = input.value || ELEMENT_DEFAULTS[style.element]?.[propKey] || '';
                updateEditorProperty(style, propKey, value);
                refreshChatDesignCSSDebounced();
            }
        });
    });

    syncMessageActionConditionalFields(props);
    syncAvatarOverlayConditionalFields(props);
    syncBannerOverlayConditionalFields(props);
    syncNameFillConditionalFields(props);
    syncGeneralUiConditionalFields(props);
    syncScrollbarPreview(props);
    wireScrollbarPreview(props);
    syncThinkingConditionalFields(props);
    syncCustomToggleFields(props);
}

/**
 * Wire the cursor panel's inputs. Re-entrant: mode/set/rescan changes rebuild
 * the panel HTML and re-call this. All writes update the nested props.cursor
 * object and persist via updateStyleProperties({ cursor }).
 */
function wireCursorInputs(container, style, disc) {
    const cur = ensureCursorShape(style.properties);

    const save = (immediate) => {
        updateStyleProperties(style.id, { cursor: style.properties.cursor });
        if (immediate) refreshChatDesignCSS();
        else refreshChatDesignCSSDebounced();
    };
    const rerender = () => {
        const panel = container.querySelector('#wl-cdm-cursor-panel');
        if (!panel) return;
        const fresh = getCursorDiscovery();
        panel.innerHTML = buildCursorPanelHTML(style, fresh);
        wireCursorInputs(container, style, fresh);
    };

    // Source mode — switch between set and single-URL UIs.
    container.querySelector('#wl-cdm-cur-mode')?.addEventListener('change', (e) => {
        cur.mode = e.target.value === 'url' ? 'url' : 'set';
        save(true);
        rerender();
    });

    // Single-URL mode inputs.
    container.querySelector('#wl-cdm-cur-url')?.addEventListener('input', (e) => {
        cur.url = e.target.value;
        save(false);
    });
    const cursorFileInput = container.querySelector('#wl-cdm-cur-file');
    const cursorUploadButton = container.querySelector('#wl-cdm-cur-upload');
    cursorUploadButton?.addEventListener('click', () => cursorFileInput?.click());
    cursorFileInput?.addEventListener('change', async () => {
        const file = cursorFileInput.files?.[0];
        if (!file) return;
        const oldHtml = cursorUploadButton.innerHTML;
        cursorUploadButton.disabled = true;
        cursorUploadButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
        try {
            const path = await uploadDesignImage(file, 'cursors', 'uibedazzler_cursor');
            cur.url = path;
            const urlInput = container.querySelector('#wl-cdm-cur-url');
            if (urlInput) urlInput.value = path;
            save(true);
            globalThis.toastr?.success('Cursor image uploaded.', 'Chat Design');
        } catch (error) {
            console.error('[BD] Cursor image upload failed:', error);
            globalThis.toastr?.error(error.message || 'Cursor image upload failed.', 'Chat Design');
        } finally {
            cursorUploadButton.disabled = false;
            cursorUploadButton.innerHTML = oldHtml;
            cursorFileInput.value = '';
        }
    });
    container.querySelector('#wl-cdm-cur-hsx')?.addEventListener('input', (e) => {
        cur.hotspotX = parseInt(e.target.value, 10) || 0;
        save(false);
    });
    container.querySelector('#wl-cdm-cur-hsy')?.addEventListener('input', (e) => {
        cur.hotspotY = parseInt(e.target.value, 10) || 0;
        save(false);
    });

    // Set picker — re-render to refresh the coverage preview.
    container.querySelector('#wl-cdm-cur-set')?.addEventListener('change', (e) => {
        cur.setName = e.target.value;
        save(true);
        rerender();
    });

    // Install complete cursor sets under user/files/cursors/<set name>/.
    // Plain file selection uses the destination field; folder selection uses
    // the chosen top-level folder name and preserves safe nested paths.
    const filesInput = container.querySelector('#wl-cdm-cur-files-input');
    const folderInput = container.querySelector('#wl-cdm-cur-folder-input');
    const uploadFilesButton = container.querySelector('#wl-cdm-cur-upload-files');
    const importFolderButton = container.querySelector('#wl-cdm-cur-import-folder');
    uploadFilesButton?.addEventListener('click', () => filesInput?.click());
    importFolderButton?.addEventListener('click', () => folderInput?.click());

    const uploadSelection = async (input, folderMode, activeButton) => {
        const selected = [...(input.files || [])];
        if (selected.length === 0) return;

        const destinationInput = container.querySelector('#wl-cdm-cur-import-name');
        const folderRoot = folderMode
            ? String(selected[0]?.webkitRelativePath || '').split('/')[0]
            : '';
        const requestedName = folderMode
            ? folderRoot
            : (destinationInput?.value || cur.setName || 'Imported Cursors');
        const setName = sanitizeCursorUploadSegment(requestedName);
        if (!setName) {
            globalThis.toastr?.error('Enter a valid cursor set name.', 'Chat Design');
            input.value = '';
            return;
        }

        const oldHtml = activeButton.innerHTML;
        uploadFilesButton.disabled = true;
        importFolderButton.disabled = true;
        activeButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
        try {
            const payload = await buildCursorUploadPayload(selected, folderMode);
            if (payload.length === 0) {
                throw new Error('No supported cursor files were found.');
            }
            const result = await postCursorUpload(setName, payload);
            if (!result || Number(result.written) === 0) {
                const reason = result?.results?.find(r => !r.ok)?.reason;
                throw new Error(reason || 'No cursor files were uploaded.');
            }

            cur.setName = result.setName || setName;
            save(true);
            await refreshCursorDiscovery();
            rerender();
            refreshChatDesignCSS();

            const failed = Number(result.failed) || 0;
            if (failed > 0) {
                globalThis.toastr?.warning(
                    `Uploaded ${result.written} cursor file(s); ${failed} could not be imported.`,
                    'Chat Design',
                );
            } else {
                globalThis.toastr?.success(
                    `Imported ${result.written} cursor file(s) into “${cur.setName}”.`,
                    'Chat Design',
                );
            }
        } catch (error) {
            console.error('[BD] Cursor set upload failed:', error);
            globalThis.toastr?.error(error.message || 'Cursor set upload failed.', 'Chat Design');
        } finally {
            uploadFilesButton.disabled = false;
            importFolderButton.disabled = false;
            activeButton.innerHTML = oldHtml;
            input.value = '';
        }
    };

    filesInput?.addEventListener('change', () => uploadSelection(filesInput, false, uploadFilesButton));
    folderInput?.addEventListener('change', () => uploadSelection(folderInput, true, importFolderButton));

    // Each override owns its file picker, so the clicked row—not a filename
    // guess—determines exactly which CSS cursor type receives the upload.
    container.querySelectorAll('.wl-cdm-cur-type-upload').forEach(button => {
        const type = button.dataset.curType;
        const fileInput = container.querySelector(`.wl-cdm-cur-type-file[data-cur-type="${type}"]`);
        button.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;

            const destinationInput = container.querySelector('#wl-cdm-cur-import-name');
            const setName = sanitizeCursorUploadSegment(
                destinationInput?.value || cur.setName || 'Custom Overrides',
            );
            if (!setName) {
                globalThis.toastr?.error('Enter a valid upload destination first.', 'Chat Design');
                fileInput.value = '';
                return;
            }

            const oldHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const cleanName = cursorUploadRelativePath(file, false);
                if (!cleanName || !CURSOR_UPLOAD_EXTENSIONS.some(ext => cleanName.toLowerCase().endsWith(ext))) {
                    throw new Error('Choose a supported cursor file.');
                }
                const storedName = uniqueCursorUploadName(type, cleanName);
                const result = await postCursorUpload(setName, [{
                    name: storedName,
                    data: await cursorFileToBase64(file),
                }]);
                if (!result || Number(result.written) !== 1) {
                    throw new Error(result?.results?.[0]?.reason || 'Cursor upload failed.');
                }

                const uploadedSet = result.setName || setName;
                const url = uploadedCursorUrl(uploadedSet, storedName, cur.maxSize);
                if (!cur.manual || typeof cur.manual !== 'object') cur.manual = {};
                cur.manual[type] = url;
                const valueInput = container.querySelector(`.wl-cdm-cur-manual[data-cur-type="${type}"]`);
                if (valueInput) valueInput.value = url;
                save(true);
                await refreshCursorDiscovery();
                globalThis.toastr?.success(`Uploaded ${file.name} for this cursor type.`, 'Chat Design');
            } catch (error) {
                console.error('[BD] Cursor override upload failed:', error);
                globalThis.toastr?.error(error.message || 'Cursor upload failed.', 'Chat Design');
            } finally {
                button.disabled = false;
                button.innerHTML = oldHtml;
                fileInput.value = '';
            }
        });
    });

    // Max size cap for multi-resolution .cur/.ico packs.
    container.querySelector('#wl-cdm-cur-maxsize')?.addEventListener('input', (e) => {
        cur.maxSize = Math.min(128, Math.max(8, parseInt(e.target.value, 10) || 32));
        save(false);
    });

    // Rescan the cursors folder, then rebuild the panel from fresh discovery.
    container.querySelector('#wl-cdm-cur-rescan')?.addEventListener('click', async () => {
        await refreshCursorDiscovery();
        rerender();
        refreshChatDesignCSS();
    });

    // Per-type manual overrides.
    container.querySelectorAll('.wl-cdm-cur-manual').forEach(input => {
        input.addEventListener('input', () => {
            const type = input.dataset.curType;
            if (!type) return;
            if (!cur.manual || typeof cur.manual !== 'object') cur.manual = {};
            cur.manual[type] = input.value;
            save(false);
        });
    });
}

function sanitizeCursorUploadSegment(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9 _.()\-]+/g, '_')
        .replace(/^[. ]+|[. ]+$/g, '')
        .slice(0, 120);
}

function cursorUploadRelativePath(file, folderMode) {
    const source = folderMode ? (file.webkitRelativePath || file.name) : file.name;
    const parts = String(source || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const relative = folderMode && parts.length > 1 ? parts.slice(1) : parts;
    return relative.map(sanitizeCursorUploadSegment).filter(Boolean).join('/');
}

function cursorFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const data = String(reader.result || '').split(',')[1];
            data ? resolve(data) : reject(new Error(`“${file.name}” was empty.`));
        };
        reader.onerror = () => reject(new Error(`Could not read “${file.name}”.`));
        reader.readAsDataURL(file);
    });
}

function uniqueCursorUploadName(type, fileName) {
    const dot = fileName.lastIndexOf('.');
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
    return `${sanitizeCursorUploadSegment(type)}_${Date.now().toString(36)}_${base}${ext}`;
}

function uploadedCursorUrl(setName, fileName, maxSize = 32) {
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (['.ani', '.cur', '.ico'].includes(ext)) {
        return '/api/plugins/nebula-loader/cursors/img'
            + `?set=${encodeURIComponent(setName)}`
            + `&file=${encodeURIComponent(fileName)}`
            + `&max=${encodeURIComponent(Number(maxSize) || 32)}`;
    }
    return cursorFileUrl(setName, fileName);
}

async function buildCursorUploadPayload(selected, folderMode) {
    const usable = selected.filter(file => CURSOR_UPLOAD_EXTENSIONS.some(ext =>
        String(file.name || '').toLowerCase().endsWith(ext),
    ));
    if (usable.length > CURSOR_UPLOAD_MAX_FILES) {
        throw new Error(`Choose no more than ${CURSOR_UPLOAD_MAX_FILES} cursor files at once.`);
    }

    const payload = [];
    const names = new Set();
    for (const file of usable) {
        const name = cursorUploadRelativePath(file, folderMode);
        const key = name.toLowerCase();
        if (!name || names.has(key)) continue;
        names.add(key);
        payload.push({ name, data: await cursorFileToBase64(file) });
    }
    return payload;
}

async function postCursorUpload(setName, files) {
    const response = await fetch('/api/plugins/nebula-loader/cursors/upload', {
        method: 'POST',
        headers: getContext().getRequestHeaders(),
        body: JSON.stringify({ setName, files }),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Cursor upload failed (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    return response.json();
}

function wireAssignmentInputs(container, style) {
    // Default toggle
    const defaultToggle = container.querySelector('#wl-cdm-a-default');
    const targetsDiv = container.querySelector('#wl-cdm-assign-targets');
    if (defaultToggle) {
        defaultToggle.addEventListener('change', () => {
            updateStyleMeta(style.id, { isDefault: defaultToggle.checked });
            if (targetsDiv) targetsDiv.style.display = defaultToggle.checked ? 'none' : '';
            refreshChatDesignCSS();
        });
    }

    // Character checkboxes and the bulk toggle share one persistence path so a
    // large library is still saved and refreshed only once per bulk action.
    const characterCheckboxes = [...(container.querySelector('#wl-cdm-a-chars')
        ?.querySelectorAll('input[type="checkbox"]') || [])];
    const persistCharacters = () => {
        const checked = characterCheckboxes.filter(checkbox => checkbox.checked).map(checkbox => checkbox.value);
        updateStyleMeta(style.id, { assignedCharacters: checked });
        refreshChatDesignCSS();
    };
    const toggleAllCharacters = container.querySelector('#wl-cdm-a-chars-toggle-all');
    const visibleCharacterCheckboxes = () => characterCheckboxes.filter(checkbox => {
        const row = checkbox.closest('.wl-cdm-pickrow');
        return row && !row.hidden && row.style.display !== 'none';
    });
    const syncToggleAllCharacters = () => {
        if (!toggleAllCharacters) return;
        const visible = visibleCharacterCheckboxes();
        const allChecked = visible.length > 0 && visible.every(checkbox => checkbox.checked);
        toggleAllCharacters.disabled = visible.length === 0;
        toggleAllCharacters.setAttribute('aria-pressed', String(allChecked));
        toggleAllCharacters.title = allChecked ? 'Clear visible characters' : 'Select visible characters';
    };
    characterCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            persistCharacters();
            syncToggleAllCharacters();
        });
    });
    toggleAllCharacters?.addEventListener('click', () => {
        const visible = visibleCharacterCheckboxes();
        if (visible.length === 0) return;
        const shouldCheck = !visible.every(checkbox => checkbox.checked);
        visible.forEach(checkbox => { checkbox.checked = shouldCheck; });
        persistCharacters();
        syncToggleAllCharacters();
    });
    syncToggleAllCharacters();

    // Persona checkboxes
    container.querySelector('#wl-cdm-a-personas')?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = [...container.querySelectorAll('#wl-cdm-a-personas input:checked')].map(c => c.value);
            updateStyleMeta(style.id, { assignedPersonas: checked });
            refreshChatDesignCSS();
        });
    });

    // Verse checkboxes
    container.querySelector('#wl-cdm-a-verses')?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = [...container.querySelectorAll('#wl-cdm-a-verses input:checked')].map(c => c.value);
            updateStyleMeta(style.id, { assignedVerses: checked });
            refreshChatDesignCSS();
        });
    });

    // Verse include personas toggle
    container.querySelector('#wl-cdm-a-versePersonas')?.addEventListener('change', (e) => {
        updateStyleMeta(style.id, { assignedVersesIncludePersonas: e.target.checked });
        refreshChatDesignCSS();
    });

    wirePickerFilter(container, syncToggleAllCharacters);
}

/**
 * Wire the search box + tag chips that narrow the character/persona lists.
 * Pure show/hide over already-rendered rows — never touches assignments, so
 * hidden-but-checked rows stay checked and saved.
 *
 * A row matches when BOTH conditions hold:
 *   - its data-search text contains the typed query (substring), AND
 *   - if any tag chips are active, the row carries at least one active tag.
 * Tag chips only apply to character rows (personas have no tags); when a tag
 * filter is active, the persona group is hidden entirely.
 */
function wirePickerFilter(container, onApply = null) {
    const searchInput = container.querySelector('#wl-cdm-pick-search');
    const chips = [...container.querySelectorAll('.wl-cdm-tag-chip')];
    const charRows = [...container.querySelectorAll('#wl-cdm-a-chars .wl-cdm-pickrow')];
    const personaRows = [...container.querySelectorAll('#wl-cdm-a-personas .wl-cdm-pickrow')];
    const personaGroup = container.querySelector('#wl-cdm-a-personas')?.closest('.wl-cdm-assign-group');
    const charsNoMatch = container.querySelector('#wl-cdm-chars-nomatch');
    const personasNoMatch = container.querySelector('#wl-cdm-personas-nomatch');

    const activeTags = new Set();

    const apply = () => {
        const q = (searchInput?.value || '').trim().toLowerCase();
        const tagFilterOn = activeTags.size > 0;

        let charVisible = 0;
        for (const row of charRows) {
            const text = row.dataset.search || '';
            const rowTags = (row.dataset.tagids || '').split(' ').filter(Boolean);
            const matchText = !q || text.includes(q);
            const matchTags = !tagFilterOn || rowTags.some(id => activeTags.has(id));
            const show = matchText && matchTags;
            row.style.display = show ? '' : 'none';
            if (show) charVisible++;
        }
        if (charsNoMatch) charsNoMatch.style.display = charVisible === 0 ? '' : 'none';

        // Personas: text filter applies; tag filter hides them (no persona tags).
        if (personaGroup) {
            personaGroup.style.display = tagFilterOn ? 'none' : '';
        }
        if (!tagFilterOn) {
            let pVisible = 0;
            for (const row of personaRows) {
                const text = row.dataset.search || '';
                const show = !q || text.includes(q);
                row.style.display = show ? '' : 'none';
                if (show) pVisible++;
            }
            if (personasNoMatch) personasNoMatch.style.display = pVisible === 0 ? '' : 'none';
        }
        onApply?.();
    };

    searchInput?.addEventListener('input', apply);

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const id = chip.dataset.tagid;
            if (activeTags.has(id)) {
                activeTags.delete(id);
                chip.classList.remove('wl-cdm-tag-chip-active');
            } else {
                activeTags.add(id);
                chip.classList.add('wl-cdm-tag-chip-active');
            }
            apply();
        });
    });
    wireTagFilterControls(container, '#wl-cdm-tag-chips');
}
