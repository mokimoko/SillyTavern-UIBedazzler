// index.js — UI Bedazzler Extension
// Entry point: settings panel in extensions drawer, feature init, toggle routing.
//
// Manages ST interface upgrades independently of any preset.
// Each feature can be toggled from the extensions drawer menu.

import { saveSettingsDebounced } from '../../../../script.js';
import { getContext, extension_settings } from '../../../extensions.js';

import { MODULE_NAME, ensureSettings, getSettings, getSetting, setSetting } from './src/settings.js';

import {
    initPresetDrawer,
    onPresetDrawerToggleChanged,
} from './src/presetDrawer.js';
import {
    initUserSettingsDrawer,
    onUserSettingsDrawerToggleChanged,
} from './src/userSettingsDrawer.js';
import {
    initPersonaLore,
    onPersonaDrawerToggleChanged,
} from './src/personaLore/index.js';
import {
    initCharDrawer,
    onCharDrawerToggleChanged,
} from './src/charDrawer/index.js';
import {
    initWorldInfoDrawer,
    onWorldInfoDrawerToggleChanged,
} from './src/worldInfoDrawer/index.js';
import {
    initChatDesign,
    onChatDesignToggleChanged,
} from './src/chatDesign/index.js';
import { openChatDesignModal } from './src/chatDesign/modal.js';
import { setChatDesignEnabled, isChatDesignEnabled } from './src/chatDesign/storage.js';

const log = () => {};

// ============================================================
// Extension Settings Panel HTML
// ============================================================

function buildSettingsHTML() {
    return `
        <div class="bd-settings-container" id="bd-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>UI Bedazzler</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="bd-toggles">
                        <label class="bd-toggle-row" title="Reorganizes Chat Completion into Overview / Sections tabs.">
                            <input type="checkbox" data-bd-key="presetDrawerTakeover">
                            <span>Preset Drawer Tabs</span>
                            <i class="fa-solid fa-circle-info bd-info-icon"></i>
                        </label>

                        <label class="bd-toggle-row" title="Reorganizes User Settings into Theme / App / Chat tabs.">
                            <input type="checkbox" data-bd-key="userSettingsDrawerTakeover">
                            <span>User Settings Tabs</span>
                            <i class="fa-solid fa-circle-info bd-info-icon"></i>
                        </label>

                        <label class="bd-toggle-row" title="Adds Narrator Lore and Design tabs to the Persona drawer.">
                            <input type="checkbox" data-bd-key="personaDrawerTakeover">
                            <span>Persona Drawer Tabs</span>
                            <i class="fa-solid fa-circle-info bd-info-icon"></i>
                        </label>

                        <label class="bd-toggle-row" title="Adds Design tab to Advanced Definitions for per-character styling.">
                            <input type="checkbox" data-bd-key="charDrawerTakeover">
                            <span>Character Drawer Tabs</span>
                            <i class="fa-solid fa-circle-info bd-info-icon"></i>
                        </label>

                        <label class="bd-toggle-row" title="Floating editor panel alongside the World Info drawer.">
                            <input type="checkbox" data-bd-key="worldInfoDrawerTakeover">
                            <span>World Info Companion</span>
                            <i class="fa-solid fa-circle-info bd-info-icon"></i>
                        </label>
                    </div>

                    <hr class="bd-divider">

                    <div class="bd-chat-design-section">
                        <label class="bd-toggle-row" title="Custom typography, borders, and effects on chat messages.">
                            <input type="checkbox" id="bd-chat-design-enabled">
                            <span>Chat Design</span>
                            <i class="fa-solid fa-circle-info bd-info-icon"></i>
                        </label>
                        <div class="bd-chat-design-btn-row">
                            <div class="menu_button menu_button_icon bd-open-chat-design" id="bd-open-chat-design" title="Open Chat Design editor">
                                <i class="fa-solid fa-palette"></i>
                                <span>Open Chat Design</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Panel Event Wiring
// ============================================================

function wireSettingsEvents() {
    const container = document.getElementById('bd-settings');
    if (!container) return;

    const settings = getSettings();

    // Toggle handlers — route to feature on/off callbacks
    const TOGGLE_HANDLERS = {
        presetDrawerTakeover: onPresetDrawerToggleChanged,
        userSettingsDrawerTakeover: onUserSettingsDrawerToggleChanged,
        personaDrawerTakeover: onPersonaDrawerToggleChanged,
        charDrawerTakeover: onCharDrawerToggleChanged,
        worldInfoDrawerTakeover: onWorldInfoDrawerToggleChanged,
    };

    container.querySelectorAll('[data-bd-key]').forEach(checkbox => {
        const key = checkbox.dataset.bdKey;
        checkbox.checked = !!settings[key];

        checkbox.addEventListener('change', () => {
            const value = checkbox.checked;
            setSetting(key, value);

            const handler = TOGGLE_HANDLERS[key];
            if (handler) handler(value);

            log(`Toggle: ${key} = ${value}`);
        });
    });

    // Chat Design enabled toggle
    const cdToggle = container.querySelector('#bd-chat-design-enabled');
    if (cdToggle) {
        cdToggle.checked = isChatDesignEnabled();
        cdToggle.addEventListener('change', () => {
            setChatDesignEnabled(cdToggle.checked);
            onChatDesignToggleChanged(cdToggle.checked);
            log(`Chat Design: ${cdToggle.checked}`);
        });
    }

    // Open Chat Design button
    container.querySelector('#bd-open-chat-design')?.addEventListener('click', () => {
        openChatDesignModal();
    });
}

// ============================================================
// Wand Menu (Extensions menu in chat input area)
// ============================================================

function addWandMenuItem() {
    const menuItem = $(`
        <div id="bd_chat_design_wand" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-palette extensionsMenuExtensionButton"></div>
            <span>Chat Design</span>
        </div>
    `);
    $('#extensionsMenu').append(menuItem);
    menuItem.on('click', () => openChatDesignModal());
}

// ============================================================
// Init
// ============================================================

jQuery(async () => {
    ensureSettings();
    const settings = getSettings();

    // Inject settings panel into extensions drawer
    $('#extensions_settings2').append(buildSettingsHTML());
    wireSettingsEvents();
    addWandMenuItem();

    // Init all features
    initPresetDrawer();
    initUserSettingsDrawer();
    initPersonaLore();
    initCharDrawer();
    initWorldInfoDrawer();
    initChatDesign();

    log('UI Bedazzler loaded ✓');
});
