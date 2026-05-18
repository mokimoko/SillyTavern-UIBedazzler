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
    ELEMENT_DEFAULTS, ELEMENT_LABELS, ELEMENT_TYPES,
    getAvailableCharacters, getAvailablePersonas, getAvailableVerses, isVMAvailable,
} from './storage.js';
import {
    FONT_CATALOG, FONT_CATEGORIES,
    loadAllFonts, loadFont, getFontByName, getFontFamilyCSS,
} from './fonts.js';
import { refreshChatDesignCSS, refreshChatDesignCSSDebounced, onChatDesignToggleChanged } from './index.js';

const log = (...args) => console.log('[WL ChatDesign UI]', ...args);

// ============================================================
// State
// ============================================================

let isOpen = false;
let activeTab = 'core';         // 'core' | 'name' | 'dialogue' | 'banner' | 'container' | 'avatar'
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
        { id: 'banner', icon: 'fa-panorama', label: 'Banner' },
        { id: 'container', icon: 'fa-square', label: 'Container' },
        { id: 'avatar', icon: 'fa-circle-user', label: 'Avatar' },
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
    const content = document.getElementById('wl-cdm-content');
    if (!content) return;

    if (activeTab === 'core') {
        renderCoreView(content);
    } else if (editingStyleId) {
        renderEditor(content);
    } else {
        renderElementList(content);
    }
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
                ${renderOverviewCard('Banner', 'fa-panorama', countByElement.banner || 0, 'banner')}
                ${renderOverviewCard('Container', 'fa-square', countByElement.container || 0, 'container')}
                ${renderOverviewCard('Avatar', 'fa-circle-user', countByElement.avatar || 0, 'avatar')}
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

function renderOverviewCard(label, icon, count, tabId) {
    return `
        <div class="wl-cdm-overview-card" data-tab="${tabId}">
            <i class="fa-solid ${icon}"></i>
            <div class="wl-cdm-overview-card-info">
                <span class="wl-cdm-overview-label">${label}</span>
                <span class="wl-cdm-overview-count">${count} style${count !== 1 ? 's' : ''}</span>
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
                ${renderAssignment(style)}
            </div>
        </div>
    `;

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
    return `
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

// ============================================================
// Assignment Panel
// ============================================================

function renderAssignment(style) {
    const characters = getAvailableCharacters().sort((a, b) => a.name.localeCompare(b.name));
    const personas = getAvailablePersonas().sort((a, b) => a.name.localeCompare(b.name));
    const verses = getAvailableVerses();

    return `
        <div class="wl-cdm-field wl-cdm-default-row">
            <label class="wl-cdm-checkbox-item">
                <input type="checkbox" id="wl-cdm-a-default" ${style.isDefault ? 'checked' : ''}>
                <span>Default (applies to all messages)</span>
            </label>
        </div>

        <div class="wl-cdm-assign-targets" id="wl-cdm-assign-targets" style="${style.isDefault ? 'display:none' : ''}">

            <!-- Characters -->
            <div class="wl-cdm-assign-group">
                <div class="wl-cdm-assign-group-title">Characters</div>
                <div class="wl-cdm-checkbox-list" id="wl-cdm-a-chars">
                    ${characters.length === 0
                        ? '<div class="wl-cdm-empty-small">No characters loaded</div>'
                        : characters.map(c => `
                            <label class="wl-cdm-checkbox-item">
                                <input type="checkbox" value="${c.avatar}"
                                    ${(style.assignedCharacters || []).includes(c.avatar) ? 'checked' : ''}>
                                <span>${c.name}</span>
                            </label>
                        `).join('')
                    }
                </div>
            </div>

            <!-- Personas -->
            <div class="wl-cdm-assign-group">
                <div class="wl-cdm-assign-group-title">Personas</div>
                <div class="wl-cdm-checkbox-list" id="wl-cdm-a-personas">
                    ${personas.length === 0
                        ? '<div class="wl-cdm-empty-small">No personas found</div>'
                        : personas.map(p => `
                            <label class="wl-cdm-checkbox-item">
                                <input type="checkbox" value="${p.avatar}"
                                    ${(style.assignedPersonas || []).includes(p.avatar) ? 'checked' : ''}>
                                <span>${p.name}</span>
                            </label>
                        `).join('')
                    }
                </div>
            </div>

            ${verses.length > 0 ? `
                <!-- Verses (VM integration) -->
                <div class="wl-cdm-assign-group">
                    <div class="wl-cdm-assign-group-title">Verses</div>
                    <div class="wl-cdm-checkbox-list" id="wl-cdm-a-verses">
                        ${verses.map(v => `
                            <label class="wl-cdm-checkbox-item">
                                <input type="checkbox" value="${v.id}"
                                    ${(style.assignedVerses || []).includes(v.id) ? 'checked' : ''}>
                                <span>${v.name}</span>
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

    // Assignment changes
    wireAssignmentInputs(container, style);
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
}
