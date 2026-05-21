// src/settings.js
// Settings management for UI Bedazzler extension
// Same API surface as WhiteLotus settings so moved modules work unchanged.

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

export const MODULE_NAME = 'UIBedazzler';

const log = () => {};

// ============================================================
// Default Settings
// ============================================================

const DEFAULT_SETTINGS = {
    // --- Interface Toggles ---
    presetDrawerTakeover: true,
    userSettingsDrawerTakeover: true,
    personaDrawerTakeover: true,
    charDrawerTakeover: true,
    worldInfoDrawerTakeover: true,

    // --- Persona Designs (used by personaLore/designTab) ---
    personaDesigns: {},

    // --- Chat Design ---
    chatDesign: {
        enabled: false,
        styles: [],
    },

    // --- World Info Presets ---
    wiPresets: {},
    wiActivePreset: '',

    // --- Per-Character Profiles (used by charDrawer/designTab) ---
    profiles: {},
    activeProfile: null,
};

// ============================================================
// Settings Access
// ============================================================

export function ensureSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    const s = extension_settings[MODULE_NAME];

    for (const [key, defaultVal] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in s)) {
            s[key] = typeof defaultVal === 'object' && defaultVal !== null
                ? JSON.parse(JSON.stringify(defaultVal))
                : defaultVal;
        }
    }

    return s;
}

export function getSettings() {
    return ensureSettings();
}

export function getSetting(key) {
    const s = ensureSettings();
    return s[key];
}

export function setSetting(key, value) {
    const s = ensureSettings();
    s[key] = value;
    saveSettingsDebounced();
}
