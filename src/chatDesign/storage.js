// src/chatDesign/storage.js
// Style CRUD and assignment resolution for Chat Design
//
// Styles are stored in extension_settings.WhiteLotus.chatDesign
// Each style targets one element type and can be assigned to characters, personas, or verses (when VM present).

import { saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings, getContext } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';
import { power_user } from '../../../../../power-user.js';
import { cleanAvatar } from '../design/designUtils.js';

const log = (...args) => console.log('[WL ChatDesign Storage]', ...args);

// ============================================================
// Schema & Defaults
// ============================================================

/**
 * Default property values per element type.
 * These define the full set of editable properties and their neutral/no-op values.
 */
export const ELEMENT_DEFAULTS = {
    name: {
        fontFamily: 'Default (Theme)',
        fontSize: '1em',
        fontWeight: '400',
        fontStyle: 'normal',
        textTransform: 'none',
        letterSpacing: '0px',
        textShadow: 'none',
    },
    dialogue: {
        fontFamily: 'Default (Theme)',
        fontSize: '1em',
        fontWeight: '400',
        fontStyle: 'normal',
        letterSpacing: '0px',
        lineHeight: 'normal',
    },
    banner: {
        height: 120,
        paddingTop: 150,
        bannerPosition: 25,
        bottomFadeColor: '#000000',
        bottomFadeOpacity: 0,
        borderBottomWidth: 0,
        borderBottomStyle: 'none',
        borderBottomColor: '#ffffff',
        borderBottomOpacity: 1,
        overlayColor: '#000000',
        overlayOpacity: 0,
        borderRadius: 0,
    },
    container: {
        borderWidth: 0,
        borderStyle: 'none',
        borderColor: '#ffffff',
        borderRadius: 0,
        boxShadow: 'none',
        marginTop: 0,
        marginBottom: 0,
        paddingExtra: 0,
    },
    avatar: {
        size: 0,              // 0 = use theme default
        borderWidth: 0,
        borderStyle: 'none',
        borderColor: '#ffffff',
        borderRadius: -1,     // -1 = use theme default
        shape: 'theme',       // 'theme' | 'circle' | 'square' | 'rounded' | 'rectangle'
        boxShadow: 'none',
        opacity: 1,
    },
};

/**
 * Human-readable labels for element types.
 */
export const ELEMENT_LABELS = {
    name: 'Name',
    dialogue: 'Dialogue',
    banner: 'Banner',
    container: 'Container',
    avatar: 'Avatar',
};

/**
 * All element type keys.
 */
export const ELEMENT_TYPES = Object.keys(ELEMENT_DEFAULTS);

// ============================================================
// Settings Access
// ============================================================

/**
 * Get the chatDesign settings object, initializing if needed.
 */
export function getChatDesignSettings() {
    const settings = extension_settings[MODULE_NAME];
    if (!settings) return { enabled: false, styles: [] };
    if (!settings.chatDesign) {
        settings.chatDesign = { enabled: false, styles: [] };
    }
    return settings.chatDesign;
}

export function isChatDesignEnabled() {
    return getChatDesignSettings().enabled;
}

export function setChatDesignEnabled(enabled) {
    getChatDesignSettings().enabled = enabled;
    saveSettingsDebounced();
}

// ============================================================
// Style CRUD
// ============================================================

function generateId() {
    return 'style_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * Get all styles.
 */
export function getAllStyles() {
    return getChatDesignSettings().styles || [];
}

/**
 * Get styles for a specific element type.
 */
export function getStylesForElement(elementType) {
    return getAllStyles().filter(s => s.element === elementType);
}

/**
 * Get a style by ID.
 */
export function getStyleById(styleId) {
    return getAllStyles().find(s => s.id === styleId) || null;
}

/**
 * Create a new style with default properties.
 * @param {string} elementType - One of ELEMENT_TYPES
 * @param {string} [name] - Optional display name
 * @returns {object} The created style
 */
export function createStyle(elementType, name) {
    const style = {
        id: generateId(),
        name: name || `New ${ELEMENT_LABELS[elementType] || elementType} style`,
        element: elementType,
        properties: { ...ELEMENT_DEFAULTS[elementType] },
        isDefault: false,
        assignedVerses: [],
        assignedVersesIncludePersonas: false,
        assignedCharacters: [],    // avatar filenames
        assignedPersonas: [],      // avatar filenames
    };
    getChatDesignSettings().styles.push(style);
    saveSettingsDebounced();
    log('Created style:', style.id, style.name);
    return style;
}

/**
 * Update a style's CSS properties.
 */
export function updateStyleProperties(styleId, properties) {
    const style = getStyleById(styleId);
    if (!style) return null;
    Object.assign(style.properties, properties);
    saveSettingsDebounced();
    return style;
}

/**
 * Update a style's metadata (name, isDefault, assignments).
 */
export function updateStyleMeta(styleId, updates) {
    const style = getStyleById(styleId);
    if (!style) return null;
    if (updates.name !== undefined) style.name = updates.name;
    if (updates.isDefault !== undefined) style.isDefault = updates.isDefault;
    if (updates.assignedVerses !== undefined) style.assignedVerses = updates.assignedVerses;
    if (updates.assignedVersesIncludePersonas !== undefined) style.assignedVersesIncludePersonas = updates.assignedVersesIncludePersonas;
    if (updates.assignedCharacters !== undefined) style.assignedCharacters = updates.assignedCharacters;
    if (updates.assignedPersonas !== undefined) style.assignedPersonas = updates.assignedPersonas;
    saveSettingsDebounced();
    return style;
}

/**
 * Delete a style by ID.
 */
export function deleteStyle(styleId) {
    const settings = getChatDesignSettings();
    const idx = settings.styles.findIndex(s => s.id === styleId);
    if (idx === -1) return false;
    settings.styles.splice(idx, 1);
    saveSettingsDebounced();
    log('Deleted style:', styleId);
    return true;
}

/**
 * Duplicate a style (deep clone with new ID).
 */
export function duplicateStyle(styleId) {
    const original = getStyleById(styleId);
    if (!original) return null;
    const copy = {
        ...JSON.parse(JSON.stringify(original)),
        id: generateId(),
        name: original.name + ' (copy)',
    };
    getChatDesignSettings().styles.push(copy);
    saveSettingsDebounced();
    log('Duplicated style:', original.id, '→', copy.id);
    return copy;
}

// ============================================================
// Assignment Resolution
// ============================================================

/**
 * Get VerseManager metadata if VM is installed.
 * @returns {object|null} Verse metadata keyed by verse ID, or null if VM not available
 */
function getVMVerseMetadata() {
    if (!window.VerseManager?.getAllVerseMetadata) return null;
    try {
        return window.VerseManager.getAllVerseMetadata();
    } catch {
        return null;
    }
}

/**
 * Resolve which character/persona names a style applies to.
 * Returns an array of target objects:
 *   { name: string, charAvatar?: string, personaAvatar?: string }
 *
 * Default styles return [{ name: '__default__' }].
 * Otherwise resolves direct assignments + verse membership (when VM present).
 */
export function resolveStyleTargets(style) {
    if (style.isDefault) return [{ name: '__default__' }];

    const targets = new Map();
    const allChars = getContext().characters || [];

    // Build lookup map once — avoids O(n) find per assignment
    const avatarMap = new Map(allChars.map(c => [cleanAvatar(c.avatar), c]));

    // Direct character assignments
    for (const charAvatar of style.assignedCharacters || []) {
        const cleaned = cleanAvatar(charAvatar);
        const char = avatarMap.get(cleaned);
        const name = char?.name || charAvatar;
        targets.set(`char:${cleaned}`, { name, charAvatar: cleaned });
    }

    // Direct persona assignments
    for (const pAvatar of style.assignedPersonas || []) {
        const cleaned = cleanAvatar(pAvatar);
        const name = power_user.personas?.[cleaned];
        if (name) {
            targets.set(`persona:${cleaned}`, { name, personaAvatar: cleaned });
        }
    }

    // Verse assignments (only when VM is installed)
    const verses = getVMVerseMetadata();
    if (verses) {
        for (const verseId of style.assignedVerses || []) {
            const verse = verses[verseId];
            if (!verse) continue;

            // Characters in verse
            if (verse.characters) {
                for (const avatar of verse.characters) {
                    const cleaned = cleanAvatar(avatar);
                    const char = avatarMap.get(cleaned);
                    if (char?.name) {
                        targets.set(`char:${cleaned}`, { name: char.name, charAvatar: cleaned });
                    }
                }
            }

            // Personas in verse (if opted in)
            if (style.assignedVersesIncludePersonas) {
                for (const pAvatar of verse.personas || []) {
                    const cleaned = cleanAvatar(pAvatar);
                    const pName = power_user.personas?.[cleaned];
                    if (pName) {
                        targets.set(`persona:${cleaned}`, { name: pName, personaAvatar: cleaned });
                    }
                }
                // Storyline-specific preferred personas
                for (const sl of verse.storylines || []) {
                    for (const pAvatar of sl.preferredPersonas || []) {
                        const cleaned = cleanAvatar(pAvatar);
                        const pName = power_user.personas?.[cleaned];
                        if (pName) {
                            targets.set(`persona:${cleaned}`, { name: pName, personaAvatar: cleaned });
                        }
                    }
                }
            }
        }
    }

    return Array.from(targets.values());
}

/**
 * Check if VerseManager is available for verse-based assignments.
 */
export function isVMAvailable() {
    return !!window.VerseManager?.getAllVerseMetadata;
}

/**
 * Get all loaded characters (for assignment UI).
 * Returns array of { name, avatar } objects.
 */
export function getAvailableCharacters() {
    const allChars = getContext().characters || [];
    return allChars
        .filter(c => c.avatar && c.name)
        .map(c => ({ name: c.name, avatar: cleanAvatar(c.avatar) }));
}

/**
 * Get all personas (for assignment UI).
 * Returns array of { name, avatar } objects.
 */
export function getAvailablePersonas() {
    const personas = power_user?.personas || {};
    return Object.entries(personas)
        .filter(([avatar, name]) => avatar && name)
        .map(([avatar, name]) => ({ name, avatar: cleanAvatar(avatar) }));
}

/**
 * Get all verses (for assignment UI, only when VM installed).
 * Returns array of { id, name } objects, or empty array if VM not available.
 */
export function getAvailableVerses() {
    const verses = getVMVerseMetadata();
    if (!verses) return [];
    return Object.entries(verses)
        .filter(([id, v]) => v.name)
        .map(([id, v]) => ({ id, name: v.name }));
}
