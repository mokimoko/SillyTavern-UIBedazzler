// src/worldInfoDrawerV2/presets.js
// World Info Preset Management — saves/restores active books + global settings.
// Storage: extension_settings.UIBedazzler.wiPresets / wiActivePreset
//
// HOST-REGISTRY MODULE (§9.28): the v2 rail registers as a host via
// registerPresetHost. A host is { root, prefix, onApplied }: the DOM root
// holding a `.<prefix>-preset-select` + `.<prefix>-preset-actions`, plus a
// refresh hook run after a preset (de)activation changes ST state. Preset CRUD
// refreshes every registered host. The snapshot/apply core reads and writes
// ONLY ST's own controls (#world_info + the hidden global settings) —
// books/settings state is never mirrored here.

import { getSettings, setSetting } from '../settings.js';
import { Popup } from '../../../../../../scripts/popup.js';

const log = () => {};

/** Snapshot of active books before a preset was applied — restored when selecting "None". */
let prePresetBooks = null;

/**
 * Registered UI hosts. Pruned of disconnected roots on every register, so a
 * host whose DOM was torn down (v2 overlay closed, drawer rebuilt) drops out
 * instead of accumulating.
 * @type {{root: HTMLElement, prefix: string, onApplied: () => void}[]}
 */
let hosts = [];

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

/** Snapshot current active books from ST's #world_info multi-select.
 *  EXPORTED: this is the one honest read of "which books are global" —
 *  v2's rail uses it too (globalBooks is a READ, never mirrored state). */
export function snapshotBooks() {
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

/** Apply a book set to ST's #world_info multi-select.
 *  EXPORTED: the one write-path for the global book list — presets and v2's
 *  rail toggle both go through here, so ST's change event always fires. */
export function applyBooks(bookNames) {
    const stSelect = document.querySelector('#world_info');
    if (!stSelect) return;
    Array.from(stSelect.options).forEach(opt => {
        opt.selected = bookNames.includes(opt.textContent.trim());
    });
    if (typeof $ !== 'undefined') $(stSelect).trigger('change');
    else stSelect.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Apply a preset's settings to ST's hidden controls and every host's fields.
 *  Hosts without a matching [data-setting] element (e.g. v2 before its
 *  budget/scan pours) are simply skipped by the query. */
function applySettings(settings) {
    if (!settings) return;

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

        // Push to each host's mirrored field(s)
        for (const host of hosts) {
            host.root.querySelectorAll(`[data-setting="${key}"]`).forEach(ourEl => {
                if (mapping.type === 'checkbox') ourEl.checked = !!value;
                else ourEl.value = value;
            });
        }
    }
}

// ============================================================
// Preset Select Population
// ============================================================

function populatePresetSelect() {
    const presets = getPresets();
    const active = getActivePresetName();
    const html = '<option value="">— None —</option>' +
        Object.keys(presets).sort((a, b) => a.localeCompare(b))
            .map(n => `<option value="${n}" ${n === active ? 'selected' : ''}>${n}</option>`)
            .join('');

    for (const host of hosts) {
        const select = host.root.querySelector(`.${host.prefix}-preset-select`);
        if (select) select.innerHTML = html;
    }
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
        notifyHostsApplied();
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
    notifyHostsApplied();
    log(`Activated preset: ${name}`);
}

/** Run every host's post-apply refresh (and keep their selects in sync). */
function notifyHostsApplied() {
    for (const host of hosts) {
        try { host.onApplied(); }
        catch (err) { console.error('[BD] preset host refresh failed:', err); }
    }
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

    // Brief visual feedback on the save button (every host; harmless if
    // more than one UI is open — they all just confirm the same save)
    for (const host of hosts) {
        const btn = host.root.querySelector(`[data-preset-action="save"]`);
        if (!btn) continue;
        btn.classList.add(`${host.prefix}-preset-flash`);
        setTimeout(() => btn.classList.remove(`${host.prefix}-preset-flash`), 600);
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

function toggleOverflowMenu(btn, host) {
    const cls = `${host.prefix}-preset-overflow`;
    const existing = document.querySelector(`.${cls}`);
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = cls;

    const items = [
        { label: 'Rename', icon: 'fa-pen', action: renamePreset },
        { label: 'Import', icon: 'fa-file-import', action: importPreset },
        { label: 'Export', icon: 'fa-file-export', action: exportPreset },
    ];

    menu.innerHTML = items.map(({ label, icon }) =>
        `<div class="${cls}-item" data-action="${label.toLowerCase()}">
            <i class="fa-solid ${icon}"></i> ${label}
        </div>`
    ).join('');

    // Position below the ⋮ button, left-anchored to the host panel
    const rect = btn.getBoundingClientRect();
    const hostRect = host.root.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 2}px`;
    menu.style.left = `${hostRect ? hostRect.left + 4 : rect.left}px`;

    document.body.appendChild(menu);

    // Wire clicks
    menu.addEventListener('click', (e) => {
        const item = e.target.closest(`.${cls}-item`);
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
// Public: Host registry
// ============================================================

/**
 * Register a UI host for preset management. Populates its select and wires
 * its controls (once per root — safe to call on every open). Dead hosts
 * (roots no longer in the DOM) are pruned here, so a torn-down v2 overlay
 * or rebuilt sidebar can re-register cleanly.
 *
 * @param {{root: HTMLElement, prefix: string, onApplied: () => void}} host
 */
export function registerPresetHost(host) {
    if (!host?.root) return;

    hosts = hosts.filter(h => h.root.isConnected && h.root !== host.root);
    hosts.push(host);

    populatePresetSelect();

    // Guard against double-binding (v1's sidebar persists across open/close;
    // v2's rail is fresh DOM each takeover, so its guard is always clean)
    if (host.root.dataset.presetsWired) return;
    host.root.dataset.presetsWired = 'true';

    // Select change → activate
    const select = host.root.querySelector(`.${host.prefix}-preset-select`);
    if (select) {
        select.addEventListener('change', () => activatePreset(select.value));
    }

    // Button delegation on the preset actions row
    const actionsRow = host.root.querySelector(`.${host.prefix}-preset-actions`);
    if (actionsRow) {
        actionsRow.addEventListener('click', (e) => {
            const btn = e.target.closest(`[data-preset-action]`);
            if (!btn) return;
            e.stopPropagation();
            const action = btn.dataset.presetAction;
            if (action === 'save') updatePreset();
            else if (action === 'new') createPreset();
            else if (action === 'delete') deletePreset();
            else if (action === 'more') toggleOverflowMenu(btn, host);
        });
    }

    log(`Preset host registered (${host.prefix})`);
}

/**
 * Reset the "None restores this" snapshot. Called on each UI open so a stale
 * snapshot from a previous session can't overwrite books the user has since
 * changed by hand. Shared ST truth — either UI opening resets it.
 */
export function resetPrePresetSnapshot() {
    prePresetBooks = null;
}
