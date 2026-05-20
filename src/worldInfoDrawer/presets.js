// src/worldInfoDrawer/presets.js
// World Info Preset Management — saves/restores active books + global settings.
// Storage: extension_settings.UIBedazzler.wiPresets / wiActivePreset

import { getSettings, setSetting } from '../settings.js';
import { populateActiveBooks, syncGlobalSettings } from './entryList.js';
import { getSidebarElement } from './drawerUI.js';
import { WL_PREFIX } from './constants.js';
import { Popup } from '../../../../../../scripts/popup.js';

const log = (...args) => console.log('[WL WID Presets]', ...args);

/** Snapshot of active books before a preset was applied — restored when selecting "None". */
let prePresetBooks = null;

// Keys that map data-setting attr → ST's hidden control selector
const SETTINGS_MAP = {
    scanDepth:                { st: '#world_info_depth',                  type: 'number' },
    budget:                   { st: '#world_info_budget',                 type: 'number' },
    budgetCap:                { st: '#world_info_budget_cap',             type: 'number' },
    minActivations:           { st: '#world_info_min_activations',        type: 'number' },
    minActivationsDepthMax:   { st: '#world_info_min_activations_depth_max', type: 'number' },
    maxRecursionSteps:        { st: '#world_info_max_recursion_steps',    type: 'number' },
    characterStrategy:        { st: '#world_info_character_strategy',     type: 'select' },
    includeNames:             { st: '#world_info_include_names',          type: 'checkbox' },
    recursive:                { st: '#world_info_recursive',              type: 'checkbox' },
    caseSensitive:            { st: '#world_info_case_sensitive',         type: 'checkbox' },
    matchWholeWords:          { st: '#world_info_match_whole_words',      type: 'checkbox' },
    useGroupScoring:          { st: '#world_info_use_group_scoring',      type: 'checkbox' },
    overflowAlert:            { st: '#world_info_overflow_alert',         type: 'checkbox' },
};

// ============================================================
// Helpers
// ============================================================

function getPresets() {
    return getSettings().wiPresets || {};
}

function getActivePresetName() {
    return getSettings().wiActivePreset || '';
}

function setActivePresetName(name) {
    setSetting('wiActivePreset', name);
}

function savePresets(presets) {
    setSetting('wiPresets', presets);
}

/** Snapshot current active books from ST's #world_info multi-select. */
function snapshotBooks() {
    const stSelect = document.querySelector('#world_info');
    if (!stSelect) return [];
    return Array.from(stSelect.selectedOptions)
        .map(o => o.textContent.trim())
        .filter(n => n && !n.startsWith('--'));
}

/** Snapshot current global WI settings from ST's hidden controls. */
function snapshotSettings() {
    const snap = {};
    for (const [key, { st, type }] of Object.entries(SETTINGS_MAP)) {
        const el = document.querySelector(st);
        if (!el) continue;
        if (type === 'checkbox') snap[key] = !!el.checked;
        else if (type === 'number') snap[key] = parseFloat(el.value) || 0;
        else snap[key] = el.value;
    }
    return snap;
}

/** Apply a preset's books to ST's #world_info multi-select. */
function applyBooks(bookNames) {
    const stSelect = document.querySelector('#world_info');
    if (!stSelect) return;
    Array.from(stSelect.options).forEach(opt => {
        opt.selected = bookNames.includes(opt.textContent.trim());
    });
    if (typeof $ !== 'undefined') $(stSelect).trigger('change');
    else stSelect.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Apply a preset's settings to both ST's hidden controls and our sidebar fields. */
function applySettings(settings) {
    if (!settings) return;
    const sidebar = getSidebarElement();

    for (const [key, value] of Object.entries(settings)) {
        const mapping = SETTINGS_MAP[key];
        if (!mapping) continue;

        // Push to ST's hidden control
        const stEl = document.querySelector(mapping.st);
        if (stEl) {
            if (mapping.type === 'checkbox') stEl.checked = !!value;
            else stEl.value = value;
            if (typeof $ !== 'undefined') $(stEl).trigger('input').trigger('change');
            else stEl.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Push to our sidebar field
        if (sidebar) {
            const ourEl = mapping.type === 'checkbox'
                ? sidebar.querySelector(`.${WL_PREFIX}-checkbox[data-setting="${key}"]`)
                : sidebar.querySelector(`[data-setting="${key}"]`);
            if (ourEl) {
                if (mapping.type === 'checkbox') ourEl.checked = !!value;
                else ourEl.value = value;
            }
        }
    }
}

// ============================================================
// Preset Select Population
// ============================================================

function populatePresetSelect() {
    const sidebar = getSidebarElement();
    if (!sidebar) return;
    const select = sidebar.querySelector(`.${WL_PREFIX}-preset-select`);
    if (!select) return;

    const presets = getPresets();
    const active = getActivePresetName();

    select.innerHTML = '<option value="">— None —</option>' +
        Object.keys(presets).sort((a, b) => a.localeCompare(b))
            .map(n => `<option value="${n}" ${n === active ? 'selected' : ''}>${n}</option>`)
            .join('');
}

// ============================================================
// CRUD Operations
// ============================================================

async function activatePreset(name) {
    if (!name) {
        // "None" selected — restore whatever was active before the preset
        if (prePresetBooks) {
            applyBooks(prePresetBooks);
            log(`Restored pre-preset books: [${prePresetBooks.join(', ')}]`);
        } else {
            applyBooks([]);
            log('No pre-preset snapshot — cleared all books');
        }
        prePresetBooks = null;
        setActivePresetName('');
        populateActiveBooks();
        syncGlobalSettings();
        return;
    }
    const presets = getPresets();
    const preset = presets[name];
    if (!preset) return;

    // Snapshot current books before applying (only if no snapshot yet,
    // so switching between presets doesn't overwrite the original state)
    if (prePresetBooks === null) {
        prePresetBooks = snapshotBooks();
        log(`Saved pre-preset books: [${prePresetBooks.join(', ')}]`);
    }

    applyBooks(preset.books || []);
    applySettings(preset.settings);
    setActivePresetName(name);
    populateActiveBooks();
    syncGlobalSettings();
    log(`Activated preset: ${name}`);
}

async function createPreset() {
    const name = await Popup.show.input('New Preset', 'Enter a name for the new preset:');
    if (!name?.trim()) return;
    const trimmed = name.trim();

    const presets = getPresets();
    if (presets[trimmed]) {
        await Popup.show.alert(`Preset "${trimmed}" already exists.`);
        return;
    }

    presets[trimmed] = { books: snapshotBooks(), settings: snapshotSettings() };
    savePresets(presets);
    setActivePresetName(trimmed);
    populatePresetSelect();
    log(`Created preset: ${trimmed}`);
}

async function updatePreset() {
    const name = getActivePresetName();
    if (!name) { await Popup.show.alert('No preset selected to update.'); return; }

    const presets = getPresets();
    if (!presets[name]) return;

    presets[name] = { books: snapshotBooks(), settings: snapshotSettings() };
    savePresets(presets);
    log(`Updated preset: ${name}`);

    // Brief visual feedback on the save button
    const sidebar = getSidebarElement();
    const btn = sidebar?.querySelector(`[data-preset-action="save"]`);
    if (btn) {
        btn.classList.add(`${WL_PREFIX}-preset-flash`);
        setTimeout(() => btn.classList.remove(`${WL_PREFIX}-preset-flash`), 600);
    }
}

async function deletePreset() {
    const name = getActivePresetName();
    if (!name) { await Popup.show.alert('No preset selected to delete.'); return; }
    if (!await Popup.show.confirm('Delete Preset', `Delete preset "${name}"?`)) return;

    const presets = getPresets();
    delete presets[name];
    savePresets(presets);
    setActivePresetName('');
    populatePresetSelect();
    log(`Deleted preset: ${name}`);
}

async function renamePreset() {
    const oldName = getActivePresetName();
    if (!oldName) { await Popup.show.alert('No preset selected to rename.'); return; }

    const newName = await Popup.show.input('Rename Preset', 'Enter the new name:', oldName);
    if (!newName?.trim() || newName.trim() === oldName) return;
    const trimmed = newName.trim();

    const presets = getPresets();
    if (presets[trimmed]) { await Popup.show.alert(`Preset "${trimmed}" already exists.`); return; }

    presets[trimmed] = presets[oldName];
    delete presets[oldName];
    savePresets(presets);
    setActivePresetName(trimmed);
    populatePresetSelect();
    log(`Renamed preset: ${oldName} → ${trimmed}`);
}

async function exportPreset() {
    const name = getActivePresetName();
    if (!name) { await Popup.show.alert('No preset selected to export.'); return; }

    const presets = getPresets();
    const data = { [name]: presets[name] };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.wi-preset.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log(`Exported preset: ${name}`);
}

function importPreset() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const imported = JSON.parse(text);
            const presets = getPresets();

            for (const [pName, pData] of Object.entries(imported)) {
                if (presets[pName]) {
                    if (!await Popup.show.confirm('Preset Exists', `Preset "${pName}" exists. Overwrite?`)) continue;
                }
                presets[pName] = pData;
            }
            savePresets(presets);
            populatePresetSelect();
            log('Presets imported');
        } catch (err) {
            log('Import error:', err);
            await Popup.show.alert('Failed to import preset file.');
        }
    });
    input.click();
}

// ============================================================
// Overflow Menu (Rename / Import / Export)
// ============================================================

function toggleOverflowMenu(btn) {
    const existing = document.querySelector(`.${WL_PREFIX}-preset-overflow`);
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = `${WL_PREFIX}-preset-overflow`;

    const items = [
        { label: 'Rename', icon: 'fa-pen', action: renamePreset },
        { label: 'Import', icon: 'fa-file-import', action: importPreset },
        { label: 'Export', icon: 'fa-file-export', action: exportPreset },
    ];

    menu.innerHTML = items.map(({ label, icon }) =>
        `<div class="${WL_PREFIX}-preset-overflow-item" data-action="${label.toLowerCase()}">
            <i class="fa-solid ${icon}"></i> ${label}
        </div>`
    ).join('');

    // Position below the ⋮ button
    const rect = btn.getBoundingClientRect();
    const sidebar = getSidebarElement();
    const sidebarRect = sidebar?.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 2}px`;
    menu.style.left = `${sidebarRect ? sidebarRect.left + 4 : rect.left}px`;

    document.body.appendChild(menu);

    // Wire clicks
    menu.addEventListener('click', (e) => {
        const item = e.target.closest(`.${WL_PREFIX}-preset-overflow-item`);
        if (!item) return;
        menu.remove();
        const action = item.dataset.action;
        const handler = items.find(i => i.label.toLowerCase() === action);
        if (handler) handler.action();
    });

    // Close on outside click
    const closer = (e) => {
        if (!menu.contains(e.target) && e.target !== btn) {
            menu.remove();
            document.removeEventListener('mousedown', closer);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', closer), 0);
}

// ============================================================
// Public: Init + Wire
// ============================================================

/**
 * Initialize preset management — populate select, wire events.
 * Called once after sidebar DOM exists.
 */
export function initPresets() {
    const sidebar = getSidebarElement();
    if (!sidebar) return;

    // Reset stale pre-preset snapshot so "None" doesn't restore books
    // from a previous drawer session after the user changed things manually
    prePresetBooks = null;

    populatePresetSelect();

    // Guard against double-binding (sidebar persists across drawer open/close)
    if (sidebar.dataset.presetsWired) return;
    sidebar.dataset.presetsWired = 'true';

    // Select change → activate
    const select = sidebar.querySelector(`.${WL_PREFIX}-preset-select`);
    if (select) {
        select.addEventListener('change', () => activatePreset(select.value));
    }

    // Button delegation on the preset actions row
    const actionsRow = sidebar.querySelector(`.${WL_PREFIX}-preset-actions`);
    if (actionsRow) {
        actionsRow.addEventListener('click', (e) => {
            const btn = e.target.closest(`[data-preset-action]`);
            if (!btn) return;
            e.stopPropagation();
            const action = btn.dataset.presetAction;
            if (action === 'save') updatePreset();
            else if (action === 'new') createPreset();
            else if (action === 'delete') deletePreset();
            else if (action === 'more') toggleOverflowMenu(btn);
        });
    }

    log('Presets initialized');
}
