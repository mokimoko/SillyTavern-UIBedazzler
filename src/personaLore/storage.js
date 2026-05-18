// src/personaLore/storage.js
// CRUD operations for persona lore entries in extension_settings

import { saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';

/**
 * Ensure personaLore object exists in settings
 */
function ensureStore() {
    if (!extension_settings[MODULE_NAME].personaLore) {
        extension_settings[MODULE_NAME].personaLore = {};
    }
    return extension_settings[MODULE_NAME].personaLore;
}

/**
 * Get lore entries for a persona
 * @param {string} avatarId - Persona avatar filename
 * @returns {Array} Lore entries array (or empty)
 */
export function getLoreEntries(avatarId) {
    const store = ensureStore();
    return store[avatarId]?.entries || [];
}

/**
 * Add a new lore entry to a persona
 * @param {string} avatarId - Persona avatar filename
 * @param {string} content - Lore text
 * @param {string[]} knownBy - Character avatar IDs who know this (empty = narrator only)
 * @returns {object} The created entry
 */
export function addLoreEntry(avatarId, content, knownBy = []) {
    const store = ensureStore();
    if (!store[avatarId]) {
        store[avatarId] = { entries: [] };
    }

    const entry = {
        id: `pl_${Date.now()}`,
        content,
        knownBy,
        createdAt: Date.now(),
    };

    store[avatarId].entries.push(entry);
    saveSettingsDebounced();
    return entry;
}

/**
 * Update an existing lore entry
 * @param {string} avatarId - Persona avatar filename
 * @param {string} entryId - Entry ID to update
 * @param {object} updates - Partial update { content?, knownBy? }
 * @returns {boolean} True if found and updated
 */
export function updateLoreEntry(avatarId, entryId, updates) {
    const entries = getLoreEntries(avatarId);
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return false;

    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.knownBy !== undefined) entry.knownBy = updates.knownBy;

    saveSettingsDebounced();
    return true;
}

/**
 * Delete a lore entry
 * @param {string} avatarId - Persona avatar filename
 * @param {string} entryId - Entry ID to remove
 * @returns {boolean} True if found and deleted
 */
export function deleteLoreEntry(avatarId, entryId) {
    const store = ensureStore();
    if (!store[avatarId]) return false;

    const before = store[avatarId].entries.length;
    store[avatarId].entries = store[avatarId].entries.filter(e => e.id !== entryId);

    if (store[avatarId].entries.length < before) {
        // Clean up empty persona entries
        if (store[avatarId].entries.length === 0) {
            delete store[avatarId];
        }
        saveSettingsDebounced();
        return true;
    }
    return false;
}
