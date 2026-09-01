// src/chatDesign/modal.js
// Chat Design — Popup modal UI
//
// Structure:
//   - Overlay + modal container
//   - Left sidebar: Core + element type nav (Name, Dialogue, Banner, Container, Avatar)
//   - Right content: Overview (Core) or element tab (style list → inline editor)
//   - Editor: property controls, live preview, assignment panel
//   - Snapshot-based undo on cancel

import {
    getChatDesignSettings, isChatDesignEnabled, setChatDesignEnabled,
    getAllStyles, getStylesForElement, getStyleById,
    createStyle, updateStyleProperties, updateStyleMeta, deleteStyle, duplicateStyle,
    ELEMENT_DEFAULTS, ELEMENT_LABELS, ELEMENT_TYPES, BACKGROUND_PRESETS, BANNER_PRESETS,
    getAvailableCharacters, getAvailablePersonas, getAvailableVerses, getCharacterTags, isVMAvailable,
} from './storage.js';
import {
    FONT_CATALOG, FONT_CATEGORIES,
    loadAllFonts, loadFont, getFontByName, getFontFamilyCSS,
} from './fonts.js';
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
} from './iconSwitch.js';
import {
    getSideButtonStyleChoices, getDefaultSideButtonStyle, setDefaultSideButtonStyle,
    getSideButtonStyleForCharacter, setSideButtonStyleForCharacter,
    applySideButtonStyleForActiveChar,
} from './sideButtonStyleSwitch.js';

const log = () => {};

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

// ============================================================
// State
// ============================================================

let isOpen = false;
let activeTab = 'core';         // Overview, a style element, or an interface assignment tab
let editingStyleId = null;      // Currently editing style ID, or null for list view
let editingSnapshot = null;     // Deep clone before editing (for cancel/restore)
let fontsLoaded = false;

const MODAL_ID = 'wl-chat-design-modal';
const OVERLAY_ID = 'wl-chat-design-overlay';

// ============================================================
// Open / Close
// ============================================================

/**
 * Open the Chat Design modal.
 * Creates DOM on first call, reuses it on subsequent opens.
 */
export function openChatDesignModal() {
    if (isOpen) return;
    isOpen = true;
    editingStyleId = null;
    editingSnapshot = null;
    activeTab = 'core';

    ensureModalDOM();
    renderContent();

    // Animate in
    requestAnimationFrame(() => {
        document.getElementById(OVERLAY_ID)?.classList.add('wl-cdm-visible');
        document.getElementById(MODAL_ID)?.classList.add('wl-cdm-visible');
    });

    log('Modal opened');
}

/**
 * Close the Chat Design modal.
 * Hides the modal and overlay without removing them from the DOM.
 */
export function closeChatDesignModal() {
    if (!isOpen) return;

    // If editing, cancel without saving
    if (editingStyleId && editingSnapshot) {
        const style = getStyleById(editingStyleId);
        if (style) {
            Object.assign(style, JSON.parse(JSON.stringify(editingSnapshot)));
        }
    }
    editingStyleId = null;
    editingSnapshot = null;

    const overlay = document.getElementById(OVERLAY_ID);
    const modal = document.getElementById(MODAL_ID);
    overlay?.classList.remove('wl-cdm-visible');
    modal?.classList.remove('wl-cdm-visible');

    isOpen = false;
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
    if (document.getElementById(MODAL_ID)) return;

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
    modal.innerHTML = `
        <div class="wl-cdm-header">
            <div class="wl-cdm-title">Chat Design</div>
            <div class="wl-cdm-close" id="wl-cdm-close">✕</div>
        </div>
        <div class="wl-cdm-body">
            <div class="wl-cdm-sidebar" id="wl-cdm-sidebar"></div>
            <div class="wl-cdm-content" id="wl-cdm-content"></div>
        </div>
    `;
    document.body.appendChild(modal);

    // Wire persistent events (only once)
    modal.querySelector('#wl-cdm-close')?.addEventListener('click', closeChatDesignModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) closeChatDesignModal();
    });
}

// ============================================================
// Sidebar
// ============================================================

function renderSidebar() {
    const sidebar = document.getElementById('wl-cdm-sidebar');
    if (!sidebar) return;

    const items = [
        { id: 'core', icon: 'fa-house', label: 'Overview' },
        { id: 'name', icon: 'fa-signature', label: 'Name' },
        { id: 'dialogue', icon: 'fa-quote-left', label: 'Dialogue' },
        { id: 'banner', icon: 'fa-flag', label: 'Banner' },
        { id: 'container', icon: 'fa-square', label: 'Container' },
        { id: 'avatar', icon: 'fa-circle-user', label: 'Avatar' },
        { id: 'background', icon: 'fa-image', label: 'Background' },
        { id: 'cursor', icon: 'fa-arrow-pointer', label: 'Cursor' },
        { id: 'themes', icon: 'fa-palette', label: 'Themes' },
        { id: 'icons', icon: 'fa-icons', label: 'Icons' },
        { id: 'side-buttons', icon: 'fa-grip-vertical', label: 'Side Buttons' },
    ];

    sidebar.innerHTML = items.map(item => `
        <div class="wl-cdm-nav-item ${item.id === activeTab ? 'wl-cdm-nav-active' : ''}"
             data-tab="${item.id}">
            <i class="fa-solid ${item.icon}"></i>
            <span>${item.label}</span>
        </div>
    `).join('');

    // Wire nav clicks
    sidebar.querySelectorAll('.wl-cdm-nav-item').forEach(el => {
        el.addEventListener('click', () => {
            // Cancel any in-progress edit
            cancelEdit();
            activeTab = el.dataset.tab;
            renderSidebar();
            renderContent();
        });
    });
}

// ============================================================
// Content Rendering
// ============================================================

function renderContent() {
    renderSidebar();
    document.getElementById(MODAL_ID)?.classList.toggle('wl-cdm-overview-mode', activeTab === 'core');
    const content = document.getElementById('wl-cdm-content');
    if (!content) return;

    if (activeTab === 'core') {
        renderCoreView(content);
    } else if (activeTab === 'themes') {
        renderThemesView(content);
    } else if (activeTab === 'icons') {
        renderIconsView(content);
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

    const tagChips = charTags.length === 0 ? '' : `
        <div class="wl-cdm-tag-chips" id="wl-cdm-th-tag-chips">
            ${charTags.map(t => `<button type="button" class="wl-cdm-tag-chip" data-tagid="${esc(t.id)}">${esc(t.name)}</button>`).join('')}
        </div>
    `;

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
}

// ============================================================
// Icons Tab — per-character interface icon assignment
// ============================================================

function renderIconsView(container) {
    const characters = getAvailableCharacters().sort((a, b) => a.name.localeCompare(b.name));
    const charTags = getCharacterTags();
    const choices = Object.fromEntries(ICON_AXES.map(axis => [axis, getIconChoices(axis)]));
    const defaults = Object.fromEntries(ICON_AXES.map(axis => [axis, getDefaultIconSet(axis)]));

    const options = (axis, selected, allowInherit = false) => {
        const fallback = choices[axis].find(choice => choice.id === defaults[axis])?.label || 'Default';
        const inherit = allowInherit
            ? `<option value="">— Use default (${esc(fallback)}) —</option>`
            : '';
        return inherit + choices[axis].map(choice => `
            <option value="${esc(choice.id)}" ${choice.id === selected ? 'selected' : ''}>${esc(choice.label)}</option>
        `).join('');
    };

    const tagChips = charTags.length === 0 ? '' : `
        <div class="wl-cdm-tag-chips" id="wl-cdm-ic-tag-chips">
            ${charTags.map(t => `<button type="button" class="wl-cdm-tag-chip" data-tagid="${esc(t.id)}">${esc(t.name)}</button>`).join('')}
        </div>
    `;

    const charRow = (c) => {
        const tagIds = (c.tags || []).map(t => t.id).join(' ');
        const tagNames = (c.tags || []).map(t => t.name).join(' ');
        const search = `${c.name} ${c.avatar} ${tagNames}`.toLowerCase();
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
            </div>
        `;
    };

    container.innerHTML = `
        <div class="wl-cdm-core">
            <div class="wl-cdm-section-title">Default Icons</div>
            <div class="wl-cdm-field-hint">These are the same global choices shown in UI Bedazzler's extension settings. Groups and unassigned characters use them.</div>
            <div class="wl-cdm-ic-defaults">
                ${ICON_AXES.map(axis => `
                    <label class="wl-cdm-ic-default-field">
                        <span>${axis === 'general' ? 'General Icons' : 'Top Bar Icons'}</span>
                        <select class="wl-cdm-select wl-cdm-ic-default" data-axis="${axis}">
                            ${options(axis, defaults[axis])}
                        </select>
                    </label>
                `).join('')}
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

    wireIconsView(container);
}

function wireIconsView(container) {
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

    const tagChips = charTags.length === 0 ? '' : `
        <div class="wl-cdm-tag-chips" id="wl-cdm-sb-tag-chips">
            ${charTags.map(tag => `<button type="button" class="wl-cdm-tag-chip" data-tagid="${esc(tag.id)}">${esc(tag.name)}</button>`).join('')}
        </div>
    `;

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
}

// ── Core / Overview ──

function renderCoreView(container) {
    const enabled = isChatDesignEnabled();
    const styles = getAllStyles();
    const countByElement = {};
    for (const s of styles) {
        countByElement[s.element] = (countByElement[s.element] || 0) + 1;
    }

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
                ${renderOverviewCard('Name', 'fa-signature', countByElement.name || 0, 'name')}
                ${renderOverviewCard('Dialogue', 'fa-quote-left', countByElement.dialogue || 0, 'dialogue')}
                ${renderOverviewCard('Banner', 'fa-flag', countByElement.banner || 0, 'banner')}
                ${renderOverviewCard('Container', 'fa-square', countByElement.container || 0, 'container')}
                ${renderOverviewCard('Avatar', 'fa-circle-user', countByElement.avatar || 0, 'avatar')}
                ${renderOverviewCard('Background', 'fa-image', countByElement.background || 0, 'background')}
                ${renderOverviewCard('Cursor', 'fa-arrow-pointer', countByElement.cursor || 0, 'cursor')}
                ${renderOverviewCard('Themes', 'fa-palette', null, 'themes', 'Settings')}
                ${renderOverviewCard('Icons', 'fa-icons', null, 'icons', 'Settings')}
                ${renderOverviewCard('Side Buttons', 'fa-grip-vertical', null, 'side-buttons', 'Settings')}
            </div>

            <div class="wl-cdm-info-block">
                <i class="fa-solid fa-circle-info"></i>
                <div>
                    <strong>How it works</strong>
                    <p>Create styles for chat elements and assign them to specific characters, personas${isVMAvailable() ? ', or verses' : ''}. Styles layer on top of your theme — colors and banner images are handled separately in the Design tab.</p>
                    <p class="wl-cdm-cascade-note"><strong>Cascade:</strong> Theme → Default → ${isVMAvailable() ? 'Verse → ' : ''}Character/Persona → Design Tab</p>
                </div>
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
        card.addEventListener('click', () => {
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
    const elementType = activeTab;
    const styles = getStylesForElement(elementType);
    const label = ELEMENT_LABELS[elementType] || elementType;

    container.innerHTML = `
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

    // Wire add button
    container.querySelector('#wl-cdm-add-style')?.addEventListener('click', () => {
        const style = createStyle(elementType);
        startEdit(style.id);
    });

    // Wire style card actions
    container.querySelectorAll('.wl-cdm-style-card').forEach(card => {
        const styleId = card.dataset.styleId;

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
            const styleName = getStyleById(styleId)?.name || 'this style';
            try {
                const { callGenericPopup, POPUP_TYPE } = await import('../../../../../../scripts/popup.js');
                const result = await callGenericPopup(`Delete style "${styleName}"?`, POPUP_TYPE.CONFIRM);
                if (result) {
                    deleteStyle(styleId);
                    refreshChatDesignCSS();
                    renderContent();
                }
            } catch {
                // Fallback if popup module unavailable
                if (confirm(`Delete style "${styleName}"?`)) {
                    deleteStyle(styleId);
                    refreshChatDesignCSS();
                    renderContent();
                }
            }
        });

        // Click card body to edit
        card.addEventListener('click', () => startEdit(styleId));
    });
}

function renderStyleCard(style) {
    const assignInfo = getAssignmentSummary(style);
    return `
        <div class="wl-cdm-style-card" data-style-id="${style.id}">
            <div class="wl-cdm-card-body">
                <div class="wl-cdm-card-name">${style.name}</div>
                <div class="wl-cdm-card-assign">${assignInfo}</div>
            </div>
            <div class="wl-cdm-card-actions">
                <button class="wl-cdm-card-edit" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="wl-cdm-card-dup" title="Duplicate"><i class="fa-solid fa-copy"></i></button>
                <button class="wl-cdm-card-del" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `;
}

function getAssignmentSummary(style) {
    if (style.isDefault) return 'Default (all messages)';
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

function renderEditor(container) {
    const style = getStyleById(editingStyleId);
    if (!style) {
        editingStyleId = null;
        renderContent();
        return;
    }

    const elementType = style.element;

    container.innerHTML = `
        <div class="wl-cdm-editor">
            <div class="wl-cdm-editor-header">
                <button class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-back">
                    <i class="fa-solid fa-arrow-left"></i> Back
                </button>
                <div class="wl-cdm-editor-actions">
                    <button class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-cancel">Cancel</button>
                    <button class="wl-cdm-btn wl-cdm-btn-accent" id="wl-cdm-save">Save</button>
                </div>
            </div>

            <!-- Style Name -->
            <div class="wl-cdm-field">
                <label class="wl-cdm-field-label">Style Name</label>
                <input type="text" class="wl-cdm-input" id="wl-cdm-style-name" value="${style.name}">
            </div>

            <div class="wl-cdm-divider"></div>

            <!-- Properties -->
            <div class="wl-cdm-section-title">Properties</div>
            <div class="wl-cdm-props" id="wl-cdm-props">
                ${renderPropertiesForElement(elementType, style.properties)}
            </div>

            <div class="wl-cdm-divider"></div>

            <!-- Assignment -->
            <div class="wl-cdm-section-title">Assignment</div>
            <div class="wl-cdm-assignment" id="wl-cdm-assignment">
                <div class="wl-cdm-empty-small">Loading…</div>
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
}

// ============================================================
// Property Renderers (per element type)
// ============================================================

function renderPropertiesForElement(elementType, props) {
    switch (elementType) {
        case 'name': return renderNameProps(props);
        case 'dialogue': return renderDialogueProps(props);
        case 'banner': return renderBannerProps(props);
        case 'container': return renderContainerProps(props);
        case 'avatar': return renderAvatarProps(props);
        case 'background': return renderBackgroundProps(props);
        case 'cursor': return renderCursorProps(props);
        default: return '<div class="wl-cdm-empty">Unknown element type</div>';
    }
}

function renderFontPicker(currentFont, fieldId) {
    return `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">Font Family</label>
            <select class="wl-cdm-select wl-cdm-font-picker" id="${fieldId}">
                ${FONT_CATEGORIES.map(cat => `
                    <optgroup label="${cat.label}">
                        ${FONT_CATALOG.filter(f => f.category === cat.id).map(f => `
                            <option value="${f.name}" ${f.name === currentFont ? 'selected' : ''}
                                    style="font-family: ${f.family}${f.fallback ? ', ' + f.fallback : ''}">
                                ${f.name}
                            </option>
                        `).join('')}
                    </optgroup>
                `).join('')}
            </select>
        </div>
    `;
}

function renderSelectField(label, fieldId, value, options) {
    return `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">${label}</label>
            <select class="wl-cdm-select" id="${fieldId}">
                ${Object.entries(options).map(([val, text]) =>
                    `<option value="${val}" ${val === String(value) ? 'selected' : ''}>${text}</option>`
                ).join('')}
            </select>
        </div>
    `;
}

function renderRangeField(label, fieldId, value, min, max, step, unit = '') {
    return `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">${label}</label>
            <div class="wl-cdm-range-row">
                <input type="range" class="wl-cdm-range" id="${fieldId}" min="${min}" max="${max}" step="${step}" value="${value}">
                <span class="wl-cdm-range-val" id="${fieldId}-val">${value}${unit}</span>
            </div>
        </div>
    `;
}

function renderColorField(label, fieldId, value) {
    return `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">${label}</label>
            <div class="wl-cdm-color-row">
                <input type="color" class="wl-cdm-color" id="${fieldId}" value="${value || '#ffffff'}">
                <span class="wl-cdm-color-hex">${value || '#ffffff'}</span>
            </div>
        </div>
    `;
}

function renderShadowField(label, fieldId, value) {
    return `
        <div class="wl-cdm-field">
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

function renderNameProps(p) {
    return `
        ${renderFontPicker(p.fontFamily, 'wl-cdm-p-fontFamily')}
        ${renderSelectField('Font Size', 'wl-cdm-p-fontSize', p.fontSize, {
            '0.8em': '0.8em', '0.9em': '0.9em', '1em': '1em (default)', '1.1em': '1.1em',
            '1.2em': '1.2em', '1.3em': '1.3em', '1.5em': '1.5em', '1.8em': '1.8em', '2em': '2em',
            '2.5em': '2.5em', '3em': '3em', '3.5em': '3.5em', '4em': '4em',
        })}
        ${renderSelectField('Font Weight', 'wl-cdm-p-fontWeight', p.fontWeight, {
            '300': 'Light (300)', '400': 'Regular (400)', '500': 'Medium (500)',
            '600': 'Semi-Bold (600)', '700': 'Bold (700)', '900': 'Black (900)',
        })}
        ${renderSelectField('Font Style', 'wl-cdm-p-fontStyle', p.fontStyle, {
            'normal': 'Normal', 'italic': 'Italic',
        })}
        ${renderSelectField('Text Transform', 'wl-cdm-p-textTransform', p.textTransform, {
            'none': 'None', 'uppercase': 'UPPERCASE', 'lowercase': 'lowercase',
            'capitalize': 'Capitalize',
        })}
        ${renderSelectField('Letter Spacing', 'wl-cdm-p-letterSpacing', p.letterSpacing, {
            '0px': '0px (default)', '0.5px': '0.5px', '1px': '1px',
            '2px': '2px', '3px': '3px', '5px': '5px',
        })}
        ${renderShadowField('Text Shadow', 'wl-cdm-p-textShadow', p.textShadow)}
    `;
}

// ── Dialogue Properties ──

function renderDialogueProps(p) {
    return `
        ${renderFontPicker(p.fontFamily, 'wl-cdm-p-fontFamily')}
        ${renderSelectField('Font Size', 'wl-cdm-p-fontSize', p.fontSize, {
            '0.8em': '0.8em', '0.9em': '0.9em', '1em': '1em (default)', '1.05em': '1.05em',
            '1.1em': '1.1em', '1.15em': '1.15em', '1.2em': '1.2em', '1.3em': '1.3em',
        })}
        ${renderSelectField('Font Weight', 'wl-cdm-p-fontWeight', p.fontWeight, {
            '300': 'Light (300)', '400': 'Regular (400)', '500': 'Medium (500)',
            '600': 'Semi-Bold (600)', '700': 'Bold (700)',
        })}
        ${renderSelectField('Font Style', 'wl-cdm-p-fontStyle', p.fontStyle, {
            'normal': 'Normal', 'italic': 'Italic',
        })}
        ${renderSelectField('Letter Spacing', 'wl-cdm-p-letterSpacing', p.letterSpacing, {
            '0px': '0px (default)', '0.3px': '0.3px', '0.5px': '0.5px', '1px': '1px', '2px': '2px',
        })}
        ${renderSelectField('Line Height', 'wl-cdm-p-lineHeight', p.lineHeight, {
            'normal': 'Normal', '1.2': '1.2 (tight)', '1.4': '1.4', '1.6': '1.6',
            '1.8': '1.8 (spacious)', '2': '2.0',
        })}
    `;
}

// ── Banner Properties ──

function renderBannerProps(p) {
    // Backfill keys added to the schema after this style was first created, so
    // edits to newer controls on an older style aren't silently dropped by the
    // generic property wiring (which only persists keys already present).
    for (const [k, v] of Object.entries(ELEMENT_DEFAULTS.banner)) {
        if (!(k in p)) p[k] = v;
    }
    return `
        <div class="wl-cdm-field">
            <label class="wl-cdm-field-label">Preset</label>
            <select class="wl-cdm-select" id="wl-cdm-banner-preset">
                <option value="">— Load a preset —</option>
                ${Object.entries(BANNER_PRESETS).map(([key, preset]) =>
                    `<option value="${key}">${esc(preset.label)}</option>`
                ).join('')}
            </select>
        </div>
        <div class="wl-cdm-field-hint">Fills every field below with a curated look — tweak freely afterward, or leave it and build your own.</div>

        ${renderRangeField('Height', 'wl-cdm-p-height', p.height, 60, 300, 10, 'px')}
        ${renderRangeField('Content Padding Top', 'wl-cdm-p-paddingTop', p.paddingTop, 60, 350, 10, 'px')}
        ${renderRangeField('Image Position', 'wl-cdm-p-bannerPosition', p.bannerPosition, 0, 100, 5, '%')}
        ${renderRangeField('Border Radius', 'wl-cdm-p-borderRadius', p.borderRadius, 0, 24, 1, 'px')}

        <div class="wl-cdm-subsection">Bottom Fade</div>
        ${renderColorField('Fade Color', 'wl-cdm-p-bottomFadeColor', p.bottomFadeColor)}
        ${renderRangeField('Fade Opacity', 'wl-cdm-p-bottomFadeOpacity', p.bottomFadeOpacity, 0, 1, 0.05, '')}

        <div class="wl-cdm-subsection">Overlay</div>
        ${renderColorField('Overlay Color', 'wl-cdm-p-overlayColor', p.overlayColor)}
        ${renderRangeField('Overlay Opacity', 'wl-cdm-p-overlayOpacity', p.overlayOpacity, 0, 1, 0.05, '')}

        <div class="wl-cdm-subsection">Slant</div>
        ${renderRangeField('Slant Depth', 'wl-cdm-p-slant', p.slant, 0, 40, 1, 'px')}
        ${renderSelectField('Slant Direction', 'wl-cdm-p-slantDirection', p.slantDirection, {
            'right': 'Rises to the right', 'left': 'Rises to the left',
        })}
        <div class="wl-cdm-field-hint">Cuts the band's bottom on a diagonal. When on, the Bottom Border below becomes a bold accent bar riding the slant (its width & color still apply; style & radius are ignored). Set to 0 for a classic flat edge.</div>

        <div class="wl-cdm-subsection">Bottom Border</div>
        ${renderRangeField('Border Width', 'wl-cdm-p-borderBottomWidth', p.borderBottomWidth, 0, 8, 1, 'px')}
        ${renderSelectField('Border Style', 'wl-cdm-p-borderBottomStyle', p.borderBottomStyle, {
            'none': 'None', 'solid': 'Solid', 'dashed': 'Dashed', 'dotted': 'Dotted', 'double': 'Double',
        })}
        ${renderColorField('Border Color', 'wl-cdm-p-borderBottomColor', p.borderBottomColor)}
        ${renderRangeField('Border Opacity', 'wl-cdm-p-borderBottomOpacity', p.borderBottomOpacity, 0, 1, 0.1, '')}
    `;
}

// ── Container Properties ──

function renderContainerProps(p) {
    return `
        ${renderRangeField('Border Width', 'wl-cdm-p-borderWidth', p.borderWidth, 0, 8, 1, 'px')}
        ${renderSelectField('Border Style', 'wl-cdm-p-borderStyle', p.borderStyle, {
            'none': 'None', 'solid': 'Solid', 'dashed': 'Dashed', 'dotted': 'Dotted',
            'double': 'Double', 'ridge': 'Ridge', 'groove': 'Groove',
        })}
        ${renderColorField('Border Color', 'wl-cdm-p-borderColor', p.borderColor)}
        ${renderRangeField('Border Radius', 'wl-cdm-p-borderRadius', p.borderRadius, 0, 24, 1, 'px')}
        ${renderShadowField('Box Shadow', 'wl-cdm-p-boxShadow', p.boxShadow)}
        ${renderRangeField('Margin Top', 'wl-cdm-p-marginTop', p.marginTop, 0, 40, 2, 'px')}
        ${renderRangeField('Margin Bottom', 'wl-cdm-p-marginBottom', p.marginBottom, 0, 40, 2, 'px')}
        ${renderRangeField('Extra Padding', 'wl-cdm-p-paddingExtra', p.paddingExtra, 0, 30, 2, 'px')}
    `;
}

// ── Avatar Properties ──

function renderAvatarProps(p) {
    return `
        ${renderRangeField('Size', 'wl-cdm-p-size', p.size, 0, 200, 5, 'px')}
        <div class="wl-cdm-field-hint">0 = use theme default</div>
        ${renderRangeField('Horizontal Offset', 'wl-cdm-p-offsetX', p.offsetX ?? 0, -50, 800, 1, 'px')}
        <div class="wl-cdm-field-hint">0 = default (left) · − peeks off-edge · + moves right across the banner</div>
        ${renderRangeField('Vertical Offset', 'wl-cdm-p-offsetY', p.offsetY ?? 0, -200, 100, 1, 'px')}
        <div class="wl-cdm-field-hint">− up into banner / + down · needs a banner style on this character</div>
        ${renderCheckboxField('Free avatar from layout', 'wl-cdm-p-detachFromLayout', p.detachFromLayout ?? false, 'Lets message text fill the space the avatar used to reserve. Use when the avatar sits in the banner.')}
        ${renderSelectField('Shape', 'wl-cdm-p-shape', p.shape, {
            'theme': 'Theme Default', 'circle': 'Circle', 'square': 'Square',
            'rounded': 'Rounded (8px)', 'rectangle': 'Portrait Rectangle',
        })}
        ${renderRangeField('Border Width', 'wl-cdm-p-borderWidth', p.borderWidth, 0, 6, 1, 'px')}
        ${renderSelectField('Border Style', 'wl-cdm-p-borderStyle', p.borderStyle, {
            'none': 'None', 'solid': 'Solid', 'dashed': 'Dashed', 'dotted': 'Dotted',
        })}
        ${renderColorField('Border Color', 'wl-cdm-p-borderColor', p.borderColor)}
        ${renderShadowField('Box Shadow', 'wl-cdm-p-boxShadow', p.boxShadow)}
        ${renderRangeField('Opacity', 'wl-cdm-p-opacity', p.opacity, 0, 1, 0.05, '')}
    `;
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
        <div class="wl-cdm-field">
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
        ${renderRangeField('Blur', 'wl-cdm-p-blur', p.blur ?? 0, 0, 30, 0.5, 'px')}
        ${renderRangeField('Brightness', 'wl-cdm-p-brightness', p.brightness ?? 100, 0, 200, 5, '%')}
        ${renderRangeField('Contrast', 'wl-cdm-p-contrast', p.contrast ?? 100, 0, 200, 5, '%')}
        ${renderRangeField('Saturation', 'wl-cdm-p-saturate', p.saturate ?? 100, 0, 200, 5, '%')}
        ${renderRangeField('Grayscale', 'wl-cdm-p-grayscale', p.grayscale ?? 0, 0, 100, 5, '%')}
        ${renderRangeField('Sepia', 'wl-cdm-p-sepia', p.sepia ?? 0, 0, 100, 5, '%')}
        ${renderRangeField('Hue Rotate', 'wl-cdm-p-hueRotate', p.hueRotate ?? 0, 0, 360, 5, 'deg')}
        ${renderRangeField('Zoom', 'wl-cdm-p-zoom', p.zoom ?? 100, 100, 200, 1, '%')}
        <div class="wl-cdm-field-hint">Zoom crops in (overscan is clipped). 100% = no zoom.</div>

        <div class="wl-cdm-subsection">Base Tint</div>
        <div class="wl-cdm-field-hint">Linear wash over the image — darkens so text pops.</div>
        ${renderColorField('Tint Color', 'wl-cdm-p-tintColor', p.tintColor)}
        ${renderRangeField('Top Opacity', 'wl-cdm-p-tintTopOpacity', p.tintTopOpacity ?? 0, 0, 1, 0.02, '')}
        ${renderRangeField('Bottom Opacity', 'wl-cdm-p-tintBottomOpacity', p.tintBottomOpacity ?? 0, 0, 1, 0.02, '')}
        ${renderRangeField('Angle', 'wl-cdm-p-tintAngle', p.tintAngle ?? 180, 0, 360, 5, 'deg')}

        <div class="wl-cdm-subsection">Center Highlight</div>
        <div class="wl-cdm-field-hint">Soft radial glow at the center of the screen.</div>
        ${renderColorField('Highlight Color', 'wl-cdm-p-highlightColor', p.highlightColor)}
        ${renderRangeField('Highlight Opacity', 'wl-cdm-p-highlightOpacity', p.highlightOpacity ?? 0, 0, 1, 0.02, '')}
        ${renderRangeField('Highlight Size', 'wl-cdm-p-highlightSize', p.highlightSize ?? 40, 5, 100, 1, '%')}

        <div class="wl-cdm-subsection">Accent Glow</div>
        <div class="wl-cdm-field-hint">A colored radial you can anchor to any corner or edge.</div>
        ${renderColorField('Accent Color', 'wl-cdm-p-accentColor', p.accentColor)}
        ${renderRangeField('Accent Opacity', 'wl-cdm-p-accentOpacity', p.accentOpacity ?? 0, 0, 1, 0.02, '')}
        ${renderRangeField('Accent Size', 'wl-cdm-p-accentSize', p.accentSize ?? 42, 5, 100, 1, '%')}
        ${renderSelectField('Accent Position', 'wl-cdm-p-accentPosition', p.accentPosition, {
            'center': 'Center',
            'top': 'Top', 'bottom': 'Bottom', 'left': 'Left', 'right': 'Right',
            'top left': 'Top Left', 'top right': 'Top Right',
            'bottom left': 'Bottom Left', 'bottom right': 'Bottom Right',
        })}

        <div class="wl-cdm-subsection">Vignette</div>
        <div class="wl-cdm-field-hint">Darkens the edges, keeping the center clear.</div>
        ${renderColorField('Vignette Color', 'wl-cdm-p-vignetteColor', p.vignetteColor)}
        ${renderRangeField('Vignette Opacity', 'wl-cdm-p-vignetteOpacity', p.vignetteOpacity ?? 0, 0, 1, 0.02, '')}
        ${renderRangeField('Vignette Start', 'wl-cdm-p-vignetteSize', p.vignetteSize ?? 60, 0, 100, 1, '%')}
        <div class="wl-cdm-field-hint">Lower = darkening reaches further toward the center.</div>

        <div class="wl-cdm-subsection">Texture</div>
        <div class="wl-cdm-field-hint">A repeating line pattern over everything. Cheap to render — keep opacity low.</div>
        ${renderSelectField('Pattern', 'wl-cdm-p-textureType', p.textureType ?? 'none', {
            'none': 'None', 'scanlines': 'Scanlines', 'grid': 'Grid',
        })}
        ${renderColorField('Texture Color', 'wl-cdm-p-textureColor', p.textureColor)}
        ${renderRangeField('Texture Opacity', 'wl-cdm-p-textureOpacity', p.textureOpacity ?? 0, 0, 0.5, 0.01, '')}
        ${renderRangeField('Line Spacing', 'wl-cdm-p-textureScale', p.textureScale ?? 3, 2, 12, 1, 'px')}

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
        <div class="wl-cdm-field">
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
            <input type="text" class="wl-cdm-input" id="wl-cdm-cur-url"
                   list="wl-cdm-cur-files" value="${esc(cur.url || '')}"
                   placeholder="https://…  or  /user/files/cursors/…">
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
            ? `<div class="wl-cdm-field-hint">No sets found in <code>${esc(disc.root)}/</code>. Drop a folder of cursor files there and press Rescan — or assign cursors manually below.</div>`
            : '';
        setBlock = `
            <div class="wl-cdm-subsection">Cursor Set</div>
            <div class="wl-cdm-field">
                <label class="wl-cdm-field-label">Set</label>
                <div class="wl-cdm-cur-setrow">
                    <select class="wl-cdm-select" id="wl-cdm-cur-set">${options}</select>
                    <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" id="wl-cdm-cur-rescan" title="Re-scan the cursors folder">
                        <i class="fa-solid fa-rotate"></i>
                    </button>
                </div>
            </div>
            ${emptyNote}
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
            <input type="text" class="wl-cdm-input wl-cdm-cur-manual" data-cur-type="${esc(t.key)}"
                   list="wl-cdm-cur-files" value="${esc((cur.manual && cur.manual[t.key]) || '')}"
                   placeholder="URL or /user/files/… — overrides the set">
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
        <div class="wl-cdm-field-hint">Optional. Anything set here wins over the chosen set for that cursor type. Leave blank to use the set (or nothing).</div>
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

/**
 * Async: resolve personas (disk-based, so async), render the assignment
 * panel HTML into the #wl-cdm-assignment placeholder, then wire its events.
 * Split out from renderEditor because getAvailablePersonas() is async.
 */
async function renderAssignmentInto(container, style) {
    let personas = [];
    try {
        personas = await getAvailablePersonas();
    } catch {
        personas = [];
    }
    // Stash for the synchronous renderAssignment() to consume.
    window.__wlCdmPersonaCache = personas;

    const panel = container.querySelector('#wl-cdm-assignment');
    if (!panel) return;
    panel.innerHTML = renderAssignment(style);

    // Wire assignment events now that the DOM exists.
    wireAssignmentInputs(container, style);
}

function renderAssignment(style) {
    const characters = getAvailableCharacters().sort((a, b) => a.name.localeCompare(b.name));
    const personas = (window.__wlCdmPersonaCache || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const verses = getAvailableVerses();
    const charTags = getCharacterTags();

    // Background and cursor styles key off the character only (a persona shares
    // the character's chat, and a cursor is a whole-UI tweak), so the Personas
    // group is hidden for them.
    const globalElement = style.element === 'background' || style.element === 'cursor';
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

    const tagChips = charTags.length === 0 ? '' : `
        <div class="wl-cdm-tag-chips" id="wl-cdm-tag-chips">
            ${charTags.map(t => `
                <button type="button" class="wl-cdm-tag-chip" data-tagid="${esc(t.id)}">${esc(t.name)}</button>
            `).join('')}
        </div>
    `;

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
                <div class="wl-cdm-assign-group-title">Characters</div>
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
                    ${personas.length === 0
                        ? '<div class="wl-cdm-empty-small">No personas found</div>'
                        : personas.map(personaRow).join('')
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
                    <label class="wl-cdm-checkbox-item wl-cdm-verse-personas-toggle">
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

    // Load fonts on first interaction with font picker
    container.querySelectorAll('.wl-cdm-font-picker').forEach(picker => {
        picker.addEventListener('focus', () => {
            if (!fontsLoaded) {
                loadAllFonts();
                fontsLoaded = true;
            }
        });
    });

    // Property changes — generic wiring
    wirePropertyInputs(container, style);

    // Background preset picker (background styles only). Re-attaches itself
    // after re-rendering the props panel.
    wireBgPresetPicker(container, style);

    // Banner preset picker (banner styles only). Same one-shot fill behaviour.
    wireBannerPresetPicker(container, style);

    // NOTE: assignment inputs are wired by renderAssignmentInto() after the
    // async persona list resolves and the panel HTML is injected. Wiring here
    // would find no assignment DOM yet.
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

        const props = container.querySelector('#wl-cdm-props');
        if (props) {
            props.innerHTML = renderPropertiesForElement(style.element, style.properties);
            wirePropertyInputs(container, style);
            wireBgPresetPicker(container, style);
            wireBannerPresetPicker(container, style);
        }
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

        const props = container.querySelector('#wl-cdm-props');
        if (props) {
            props.innerHTML = renderPropertiesForElement(style.element, style.properties);
            wirePropertyInputs(container, style);
            wireBgPresetPicker(container, style);
            wireBannerPresetPicker(container, style);
        }
        refreshChatDesignCSS();
    });
}

function wirePropertyInputs(container, style) {
    const props = container.querySelector('#wl-cdm-props');
    if (!props) return;

    // Selects (font, fontSize, fontWeight, etc.)
    props.querySelectorAll('.wl-cdm-select').forEach(select => {
        select.addEventListener('change', () => {
            const propKey = select.id.replace('wl-cdm-p-', '');
            if (propKey && propKey in style.properties) {
                style.properties[propKey] = select.value;

                // Load font if a font picker changed
                if (propKey === 'fontFamily' && select.value !== 'inherit') {
                    loadFont(select.value);
                }

                updateStyleProperties(style.id, { [propKey]: select.value });
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
                style.properties[propKey] = numVal;
                updateStyleProperties(style.id, { [propKey]: numVal });
                refreshChatDesignCSSDebounced();
            }
        });
    });

    // Color inputs
    props.querySelectorAll('.wl-cdm-color').forEach(input => {
        input.addEventListener('input', () => {
            const propKey = input.id.replace('wl-cdm-p-', '');
            const hexLabel = input.parentElement?.querySelector('.wl-cdm-color-hex');
            if (hexLabel) hexLabel.textContent = input.value;

            if (propKey && propKey in style.properties) {
                style.properties[propKey] = input.value;
                updateStyleProperties(style.id, { [propKey]: input.value });
                refreshChatDesignCSSDebounced();
            }
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
            style.properties[propKey] = cb.checked;
            updateStyleProperties(style.id, { [propKey]: cb.checked });
            refreshChatDesignCSSDebounced();
        });
    });

    // Text inputs (textShadow, boxShadow)
    props.querySelectorAll('.wl-cdm-input').forEach(input => {
        if (input.id === 'wl-cdm-style-name') return; // Skip name field
        input.addEventListener('change', () => {
            const propKey = input.id.replace('wl-cdm-p-', '');
            if (propKey && propKey in style.properties) {
                style.properties[propKey] = input.value || ELEMENT_DEFAULTS[style.element]?.[propKey] || '';
                updateStyleProperties(style.id, { [propKey]: style.properties[propKey] });
                refreshChatDesignCSSDebounced();
            }
        });
    });
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

    // Character checkboxes
    container.querySelector('#wl-cdm-a-chars')?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = [...container.querySelectorAll('#wl-cdm-a-chars input:checked')].map(c => c.value);
            updateStyleMeta(style.id, { assignedCharacters: checked });
            refreshChatDesignCSS();
        });
    });

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

    wirePickerFilter(container);
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
function wirePickerFilter(container) {
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
}
