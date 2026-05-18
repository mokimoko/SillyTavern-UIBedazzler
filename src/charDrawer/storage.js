// src/charDrawer/storage.js
// Read/write character extensions data via the json_data hidden field
//
// ST's character save flow:
// 1. On editor open → $('#character_json_data').val(characters[chid].json_data)
// 2. On save → form sends json_data to server, which merges form field values
// 3. charaFormatData() preserves everything in data.extensions
//
// We sync our custom fields into this hidden field AND the in-memory characters array,
// then trigger a debounced save to server so data persists across refreshes.
//
// Storage paths:
//   data.extensions.nameColor       — top-level for Marinara compatibility
//   data.extensions.dialogueColor   — same
//   data.extensions.boxColor        — same (rgba string)
//   data.extensions.wl_design.*     — banner config (bannerMode, bannerUrl, bannerPosition)

import { getContext } from '../../../../../extensions.js';

const log = (...args) => console.log('[WL CharDrawer Storage]', ...args);

let saveTimer = null;
const SAVE_DEBOUNCE_MS = 2000;

// ============================================================
// JSON Data Read/Write
// ============================================================

/**
 * Parse the character's json_data from the hidden form field.
 * @returns {object|null}
 */
function parseJsonData() {
    const raw = $('#character_json_data').val();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        log('Failed to parse json_data:', e);
        return null;
    }
}

/**
 * Serialize updated card data back to the hidden form field AND in-memory character,
 * then schedule a debounced save to server.
 * @param {object} data - The full card data object
 */
function writeJsonData(data) {
    try {
        const serialized = JSON.stringify(data);

        // 1. Update hidden form field (for ST's save flow)
        $('#character_json_data').val(serialized);

        // 2. Sync to in-memory character
        const context = getContext();
        const chid = context.characterId;
        if (chid !== undefined && chid !== null && context.characters?.[chid]) {
            context.characters[chid].json_data = serialized;
        }

        // 3. Schedule debounced save
        scheduleSave();
    } catch (e) {
        log('Failed to serialize json_data:', e);
    }
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveCharacterToServer(), SAVE_DEBOUNCE_MS);
}

/**
 * Save character data to server via the character edit API.
 */
async function saveCharacterToServer() {
    try {
        const context = getContext();
        const chid = context.characterId;
        if (chid === undefined || chid === null) return;

        const form = document.getElementById('form_create');
        if (!form) {
            log('form_create not found — cannot save');
            return;
        }

        const formData = new FormData(form);
        const headers = context.getRequestHeaders();
        delete headers['Content-Type'];

        const response = await fetch('/api/characters/edit', {
            method: 'POST',
            headers,
            body: formData,
        });

        if (response.ok) {
            log('Character design data saved to server');
        } else {
            log('Character save failed:', response.status);
        }
    } catch (e) {
        log('Failed to save character to server:', e);
    }
}

// ============================================================
// Extensions Access
// ============================================================

/**
 * Get the extensions object from the current character's card data.
 * @returns {{ data: object, extensions: object }|null}
 */
export function getCharExtensions() {
    const data = parseJsonData();
    if (!data) return null;
    if (!data.data) data.data = {};
    if (!data.data.extensions) data.data.extensions = {};
    return { data, extensions: data.data.extensions };
}

/**
 * Update fields in the character's extensions and sync back to json_data.
 * Supports dot-notation keys for nested paths (e.g. 'wl_design.bannerMode').
 * Null/undefined values delete the key.
 *
 * @param {object} updates - Key-value pairs to merge into extensions
 * @returns {boolean}
 */
export function updateCharExtensions(updates) {
    const result = getCharExtensions();
    if (!result) return false;

    const { data, extensions } = result;

    for (const [key, value] of Object.entries(updates)) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let target = extensions;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!target[parts[i]] || typeof target[parts[i]] !== 'object') {
                    target[parts[i]] = {};
                }
                target = target[parts[i]];
            }
            const lastKey = parts[parts.length - 1];
            if (value === undefined || value === null) {
                delete target[lastKey];
            } else {
                target[lastKey] = value;
            }
        } else {
            if (value === undefined || value === null) {
                delete extensions[key];
            } else {
                extensions[key] = value;
            }
        }
    }

    writeJsonData(data);
    return true;
}

/**
 * Get design-specific data from character extensions.
 * Reads colors from top-level (Marinara-compatible) and banner from wl_design namespace.
 * @returns {{ nameColor: string|null, dialogueColor: string|null, boxColor: string|null, bannerMode: string|null, bannerUrl: string|null, bannerPosition: number|null }}
 */
export function getDesignData() {
    const result = getCharExtensions();
    if (!result) {
        return { nameColor: null, dialogueColor: null, boxColor: null, bannerMode: null, bannerUrl: null, bannerPosition: null };
    }

    const ext = result.extensions;
    const wld = ext.wl_design || {};

    return {
        nameColor: ext.nameColor || null,
        dialogueColor: ext.dialogueColor || null,
        boxColor: ext.boxColor || null,
        bannerMode: wld.bannerMode || null,
        bannerUrl: wld.bannerUrl || null,
        bannerPosition: wld.bannerPosition ?? null,
    };
}
