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
    // Expanded Preset Drawer — full-page 3-column takeover of the Chat
    // Completion drawer (Overview | Sections | Editor). Off by default; a large
    // optional overhaul. COEXISTS with presetDrawerTakeover (the tabbed
    // relocation): the tabbed drawer stands down while the expanded overlay is
    // open (body.wl-pe-open), the same handshake used by the char drawers.
    presetDrawerExpanded: false,
    userSettingsDrawerTakeover: true,
    personaDrawerTakeover: true,
    charDrawerTakeover: true,
    // Expanded character drawer — full 3-column takeover. Off by default; it's
    // a large optional overhaul and is mutually exclusive with charDrawerTakeover.
    charDrawerExpanded: false,
    // Character Browser — the !hasCharacterContext() "hub" surface (welcome /
    // no char loaded). A COMPANION of the expanded drawer: it's only meaningful
    // when charDrawerExpanded is also on (the browser's "Edit" opens the
    // expanded drawer), so the runtime gate is charDrawerExpanded && charBrowser
    // (see isCharBrowserEnabled in charBrowser/index.js) and the settings UI
    // nests it under the expanded-drawer parent. Off by default. Entry points:
    // the /bdz-charbrowser slash command, the expand button on a no-character
    // screen, the expanded drawer's Back arrow, and (with the sub-toggle) a
    // native top-bar click.
    charBrowser: false,
    // Expanded World Info — full-viewport v2 rebuild (#wl-wi2-root on body).
    // Off by default. Entry points: the /bdz-widrawer command and an
    // expand button injected into ST's native World Info drawer header.
    worldInfoDrawerExpanded: false,

    // --- "Open as expanded on top-bar click" behaviors ---
    // Sub-toggles of the three expanded-drawer takeovers. When both the parent
    // and its sub-toggle are on, opening ST's native panel from the top bar is
    // redirected into the expanded surface. Redirect watchers live in each
    // feature's index.js (charDrawerExpanded, worldInfoDrawerV2,
    // presetDrawerExpanded). Default off.
    charDrawerExpandedOnClick: false,
    worldInfoOpenExpanded: false,
    presetDrawerExpandedOnClick: false,

    // Expanded Preset Drawer — user-assigned group colors. Purely cosmetic and
    // NON-INVASIVE: keyed by preset name → group key ("xml:name" / "md:name") →
    // color. Never written to the preset JSON (groups themselves are derived
    // from content); lives here so nothing touches ST's data.
    presetGroupColors: {},

    // Expanded Preset Drawer — USER-DEFINED manual groups. Keyed by preset name
    // → array of { anchorId, name }, where anchorId is ST's stable prompt
    // pm-identifier (the same key ST uses for prompt_order). Resolved to a row
    // index at render time; a missing id is a deleted block and is dropped
    // (orphan handling). Like the colors above, this is the drawer's own state —
    // NEVER written to the preset JSON.
    presetGroupsManual: {},
    // Last-selected grouping mode for the expanded preset drawer. `null` lets
    // groupRender migrate the former per-preset/boolean settings on first use.
    presetGroupsMode: null,
    // Legacy per-preset switch retained only for one-time migration.
    presetGroupsAutoOff: {},

    // --- Persona Designs (used by personaLore/designTab) ---
    personaDesigns: {},

    // --- Chat Design ---
    chatDesign: {
        enabled: false,
        styles: [],
    },

    // --- Side Buttons ---
    sideButtons: true,

    // Centered Prompt Viewer — replaces ST's native "Show raw prompt" /
    // "Diff with previous" side-slide (in the message Prompt Itemization popup)
    // with a centered, role-separated overlay like the Expanded Preset Drawer's
    // Test-chat viewer. On by default; passive when off (native behavior returns).
    centeredPromptViewer: true,

    // --- World Info Presets ---
    wiPresets: {},
    wiActivePreset: '',

    // --- Per-Character Profiles (used by charDrawer/designTab) ---
    profiles: {},
    activeProfile: null,

    // --- Nebula Engine Integration (nebula-loader companion) ---
    // Controls favicon, welcome-screen logo, and default Assistant card swaps.
    // Only takes effect when the nebula-loader server plugin is detected.
    nebulaEngine: false,

    // --- Icon sets (nebula-loader companion) ---
    // Two independent choices, both served as stylesheets by nebula-loader
    // and independent of nebulaEngine.
    //
    // generalIconSet re-skins ST's Font Awesome icons wholesale:
    //   'default' | 'phosphor' | 'phosphor-duotone'
    // topbarIconSet re-skins only the top nav bar and chat-input buttons,
    // which are hand-picked rather than bulk-mapped:
    //   'default' | 'pepicons' | 'freehand'
    //
    // Split because the two have genuinely different needs: the topbar is a
    // dozen icons you curate, the general set is 156 that need coverage. A
    // set that's good at one is usually bad at the other.
    generalIconSet: 'default',
    topbarIconSet: 'default',
};

// Pre-split, a single `phosphorIcons` boolean covered the general set. Carry
// it forward once so existing users don't silently lose their icons, then
// drop the old key so this can't re-fire and stomp a later choice.
function migrateIconSettings(s) {
    if (!('phosphorIcons' in s)) return;
    if (s.phosphorIcons === true && s.generalIconSet === 'default') {
        s.generalIconSet = 'phosphor';
    }
    delete s.phosphorIcons;
}

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

    // Runs after defaults are seeded so the migration can read the new keys.
    migrateIconSettings(s);

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
