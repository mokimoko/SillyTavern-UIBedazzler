// index.js — UI Bedazzler Extension
// Entry point: settings panel in extensions drawer, feature init, toggle routing.
//
// Manages ST interface upgrades independently of any preset.
// Each feature can be toggled from the extensions drawer menu.

import { saveSettingsDebounced } from '../../../../script.js';
import { getContext, extension_settings } from '../../../extensions.js';
import * as extensionApi from '../../../extensions.js';

import { MODULE_NAME, ensureSettings, getSettings, getSetting, setSetting } from './src/settings.js';
import { isDebug } from './src/debug.js';

import {
    initPresetDrawer,
    onPresetDrawerToggleChanged,
} from './src/presetDrawer.js';
import {
    initPresetDrawerExpanded,
    onPresetDrawerExpandedToggleChanged,
} from './src/presetDrawerExpanded/index.js';
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
    initCharDrawerExpanded,
    onCharDrawerExpandedToggleChanged,
} from './src/charDrawerExpanded/index.js';
// Character Browser — the !hasCharacterContext() "hub" takeover (welcome / no
// char loaded). Build-fresh browser, counterpart to the expanded EDIT drawer.
// Phase 1: shell + takeover/restore, exercised via the /charbrowser command.
import {
    initCharBrowser,
    onCharBrowserToggleChanged,
} from './src/charBrowser/index.js';
// WI v2 — full-viewport rebuild (reference: _design/wi-v2-mockup.html).
// "Expanded World Info" toggle (worldInfoDrawerExpanded). Entry points: the
// /bdz-widrawer slash command (always registered) and an expand button injected into
// ST's native World Info drawer header. Opening is centrally gated on the
// toggle in worldInfoDrawerV2/drawerUI.js's takeoverWiV2.
import {
    initWorldInfoDrawerV2,
    onWorldInfoDrawerExpandedToggleChanged,
} from './src/worldInfoDrawerV2/index.js';
import {
    initChatDesign,
    onChatDesignToggleChanged,
} from './src/chatDesign/index.js';
import { openChatDesignModal } from './src/chatDesign/modalLoader.js';
import { initAuthorsNote } from './src/authorsNote/index.js';
import { setChatDesignEnabled, isChatDesignEnabled } from './src/chatDesign/storage.js';
import { initCuteLoader } from './src/cuteLoader.js';
import { installTauriCloak } from './src/tauriCloak.js';
import { initSideButtons, onSideButtonsToggleChanged } from './src/sideButtons.js';
import {
    applySideButtonStyleForActiveChar,
    getDefaultSideButtonStyle,
    getSideButtonStyleChoices,
    setDefaultSideButtonStyle,
} from './src/chatDesign/sideButtonStyleSwitch.js';
import { initVariableViewer } from './src/variableViewer/index.js';
// Centered Prompt Viewer — replaces ST's native raw-prompt / diff side-slide
// (in the message Prompt Itemization popup) with a centered overlay. Always-on
// listeners, live-gated on the `centeredPromptViewer` setting; no toggle handler
// needed (the interceptors read the setting at click time).
import { initNativePromptViewer } from './src/nativePromptViewer.js';
// Always-on safety net: detects the ST-core save race that wipes a character's
// alternate_greetings to [] on disk, and offers a one-click restore. Not tied
// to any toggle — it's passive (two event listeners) and protects native ST
// usage too. See src/greetingsGuard.js header for the full failure analysis.
import { initGreetingsGuard } from './src/greetingsGuard.js';

const log = () => {};

// ── TauriTavern loading cloak (must run at MODULE-EVAL, not in jQuery init) ──
// Installs window.__nebulaClaimCloak / __nebulaLiftCloak so Landing Page Redux
// can bridge its first paint without a flash of the bare TT shell. UIBedazzler's
// loading_order (0) is below LPR's (16), so this runs before LPR evaluates and
// calls the protocol. No-op unless we're on TauriTavern with LPR enabled — see
// src/tauriCloak.js for the full rationale. Kept out of jQuery(async …) on
// purpose: waiting for DOM-ready/APP_READY would be far too late to cover boot.
installTauriCloak(extension_settings, extensionApi);

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

                    <!-- ── Chat Design (top, always visible) ──── -->
                    <div class="bd-settings-section bd-chat-design-top">
                        <div class="bd-section-label">Chat Design</div>
                        <div class="bd-chat-design-section">
                            <label class="bd-toggle-row" title="Custom typography, borders, and effects on chat messages.">
                                <input type="checkbox" id="bd-chat-design-enabled">
                                <span>Enable Chat Design</span>
                                <i class="fa-solid fa-circle-info bd-info-icon"></i>
                            </label>
                            <div class="bd-chat-design-btn-row">
                                <div class="menu_button menu_button_icon bd-open-chat-design" id="bd-open-chat-design" title="Open Chat Design editor">
                                    <i class="fa-solid fa-palette"></i>
                                    <span>Open Editor</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <hr class="bd-divider">

                    <!-- ── Drawer redesigns (collapsible) ──── -->
                    <div class="bd-sec" data-bd-sec="drawers" data-open="false">
                        <div class="bd-sec-head" role="button" tabindex="0" aria-expanded="false">
                            <i class="fa-solid fa-chevron-down bd-sec-chev"></i>
                            <span class="bd-sec-label">Drawer redesigns</span>
                            <span class="bd-sec-count"></span>
                        </div>
                        <div class="bd-sec-body" style="display:none;">
                            <label class="bd-row" title="Reorganizes Chat Completion into Overview / Sections tabs.">
                                <span class="bd-row-name">Preset Drawer</span>
                                <input type="checkbox" class="bd-switch" data-bd-key="presetDrawerTakeover">
                            </label>

                            <div class="bd-rowwrap" data-bd-parent="presetDrawerExpanded">
                                <label class="bd-row" title="Full-page 3-column Chat Completion workspace (Overview | Sections | Editor). Adds an expand button to the preset drawer. Coexists with Preset Drawer: whichever is open owns the settings.">
                                    <span class="bd-row-name">Expanded Preset Drawer</span>
                                    <input type="checkbox" class="bd-switch" data-bd-key="presetDrawerExpanded">
                                </label>
                                <label class="bd-subrow" title="When the Chat Completion top-bar button is clicked, open the expanded drawer directly instead of the native panel.">
                                    <span class="bd-subrow-name">Open on top-bar click</span>
                                    <input type="checkbox" class="bd-switch bd-switch-sm" data-bd-key="presetDrawerExpandedOnClick">
                                </label>
                            </div>

                            <label class="bd-row" title="Reorganizes User Settings into Theme / App / Chat tabs.">
                                <span class="bd-row-name">User Settings</span>
                                <input type="checkbox" class="bd-switch" data-bd-key="userSettingsDrawerTakeover">
                            </label>

                            <label class="bd-row" title="Adds Narrator Lore and Design tabs to the Persona drawer.">
                                <span class="bd-row-name">Persona Drawer</span>
                                <input type="checkbox" class="bd-switch" data-bd-key="personaDrawerTakeover">
                            </label>

                            <label class="bd-row" title="Adds a Design tab to Advanced Definitions for per-character styling.">
                                <span class="bd-row-name">Advanced Definitions</span>
                                <input type="checkbox" class="bd-switch" data-bd-key="charDrawerTakeover">
                            </label>

                            <div class="bd-rowwrap" data-bd-parent="charDrawerExpanded">
                                <label class="bd-row" title="Full 3-column character workspace. Adds an expand button to the character editor. Works alongside Advanced Definitions: whichever is open owns the fields.">
                                    <span class="bd-row-name">Expanded Character Drawer</span>
                                    <input type="checkbox" class="bd-switch" data-bd-key="charDrawerExpanded">
                                </label>
                                <label class="bd-subrow" title="A full-screen 'hub' for browsing and managing characters (no character loaded). Companion to the expanded drawer: its Edit opens the drawer. Reached via the expand button on a no-character screen, the drawer's Back arrow, or /bdz-charbrowser.">
                                    <span class="bd-subrow-name">Character Browser</span>
                                    <input type="checkbox" class="bd-switch bd-switch-sm" data-bd-key="charBrowser">
                                </label>
                                <label class="bd-subrow" title="When the character top-bar button is clicked, open our expanded surfaces directly (the drawer for a loaded character, the browser for a no-character screen) instead of the native editor.">
                                    <span class="bd-subrow-name">Open on top-bar click</span>
                                    <input type="checkbox" class="bd-switch bd-switch-sm" data-bd-key="charDrawerExpandedOnClick">
                                </label>
                            </div>

                            <div class="bd-rowwrap" data-bd-parent="worldInfoDrawerExpanded">
                                <label class="bd-row" title="Full-viewport World Info workspace (rail + list + editor + simulator). Adds an expand button to the native World Info drawer; also opens via the /bdz-widrawer command.">
                                    <span class="bd-row-name">Expanded World Info</span>
                                    <input type="checkbox" class="bd-switch" data-bd-key="worldInfoDrawerExpanded">
                                </label>
                                <label class="bd-subrow" title="When the World Info top-bar button is clicked, open the expanded drawer directly.">
                                    <span class="bd-subrow-name">Open on top-bar click</span>
                                    <input type="checkbox" class="bd-switch bd-switch-sm" data-bd-key="worldInfoOpenExpanded">
                                </label>
                            </div>
                        </div>
                    </div>

                    <hr class="bd-divider">

                    <!-- ── Interface (collapsible) ─────────── -->
                    <div class="bd-sec" data-bd-sec="interface" data-open="false">
                        <div class="bd-sec-head" role="button" tabindex="0" aria-expanded="false">
                            <i class="fa-solid fa-chevron-down bd-sec-chev"></i>
                            <span class="bd-sec-label">Interface</span>
                            <span class="bd-sec-count"></span>
                        </div>
                        <div class="bd-sec-body" style="display:none;">
                            <div class="bd-rowwrap" data-bd-parent="sideButtons">
                                <label class="bd-row" title="Floating quick-access buttons on the right side for installed extensions.">
                                    <span class="bd-row-name">Side Buttons</span>
                                    <input type="checkbox" class="bd-switch" data-bd-key="sideButtons">
                                </label>
                                <label class="bd-subrow" title="Default appearance for the Side Button strip. Individual characters can override this in Chat Design.">
                                    <span class="bd-subrow-name">Button Style</span>
                                    <select class="text_pole bd-style-select" id="bd-side-button-style">
                                        ${getSideButtonStyleChoices().map(({ id, label }) => `<option value="${id}">${label}</option>`).join('')}
                                    </select>
                                </label>
                            </div>
                            <label class="bd-row" title="Replaces ST's native 'Show raw prompt' side-slide (in a message's Prompt Itemization popup) with a centered, role-separated prompt viewer — the same one used in the Expanded Preset Drawer's Test chat.">
                                <span class="bd-row-name">Centered Prompt Viewer</span>
                                <input type="checkbox" class="bd-switch" data-bd-key="centeredPromptViewer">
                            </label>
                            <!-- nebula-loader companion rows (Nebula Engine, Phosphor Icons)
                                 are injected here by src/cuteLoader.js only when the
                                 nebula-loader server plugin is detected. -->
                            <div class="bd-nebula-anchor"></div>
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

// A parent takeover row and its optional "open on top-bar click" sub-row are
// grouped in a .bd-rowwrap[data-bd-parent="<key>"]. When the parent is off,
// the sub-row is hidden and the parent name dims. Called on load and on every
// parent toggle. Safe no-op for keys that aren't wrapped (plain rows).
function syncRowWrap(parentKey) {
    const wrap = document.querySelector(`.bd-rowwrap[data-bd-parent="${parentKey}"]`);
    if (!wrap) return;
    const on = !!getSetting(parentKey);
    wrap.classList.toggle('bd-off', !on);
    // A wrap can carry MORE than one sub-row (the char-drawer wrap holds both
    // "Character Browser" and "Open on top-bar click"), so hide/show them all.
    wrap.querySelectorAll('.bd-subrow').forEach(sub => {
        sub.style.display = on ? '' : 'none';
    });
}

// Fills each section header's "on/total" count from its switches. Only the
// primary .bd-switch inputs count — the small sub-toggles are excluded.
function refreshSecCounts() {
    document.querySelectorAll('#bd-settings .bd-sec').forEach(sec => {
        const switches = [...sec.querySelectorAll('.bd-switch:not(.bd-switch-sm)')];
        const on = switches.filter(s => s.checked).length;
        const countEl = sec.querySelector('.bd-sec-count');
        if (countEl) countEl.textContent = switches.length ? `${on}/${switches.length}` : '';
    });
}

function wireSettingsEvents() {
    const container = document.getElementById('bd-settings');
    if (!container) return;

    const settings = getSettings();

    // Toggle handlers — route to feature on/off callbacks
    const TOGGLE_HANDLERS = {
        presetDrawerTakeover: onPresetDrawerToggleChanged,
        presetDrawerExpanded: onPresetDrawerExpandedToggleChanged,
        userSettingsDrawerTakeover: onUserSettingsDrawerToggleChanged,
        personaDrawerTakeover: onPersonaDrawerToggleChanged,
        charDrawerTakeover: onCharDrawerToggleChanged,
        charDrawerExpanded: onCharDrawerExpandedToggleChanged,
        charBrowser: onCharBrowserToggleChanged,
        worldInfoDrawerExpanded: onWorldInfoDrawerExpandedToggleChanged,
        sideButtons: onSideButtonsToggleChanged,
    };

    container.querySelectorAll('[data-bd-key]').forEach(checkbox => {
        const key = checkbox.dataset.bdKey;
        checkbox.checked = !!settings[key];

        checkbox.addEventListener('change', () => {
            const value = checkbox.checked;
            setSetting(key, value);

            const handler = TOGGLE_HANDLERS[key];
            if (handler) handler(value);

            // The Character Browser is a SUB of the expanded drawer: turning the
            // parent off must also stand the browser down (its runtime gate,
            // isCharBrowserEnabled, needs the parent). Reconcile it whenever the
            // parent flips — onCharBrowserToggleChanged re-reads the combined
            // gate and closes an open browser if it's no longer enabled.
            if (key === 'charDrawerExpanded') onCharBrowserToggleChanged(getSetting('charBrowser'));

            // NOTE: the classic Character Drawer and the Expanded Character
            // Drawer COEXIST (no mutual exclusivity). Both relocate
            // #character_popup's fields, but ownership is arbitrated at
            // runtime by the expanded drawer's open/close state: expanded
            // releases classic on open and invites it back on close, and
            // classic's takeover is guarded by the wl-xd-open body class.
            // See src/charDrawer/index.js (coexistence API) and
            // src/charDrawerExpanded/drawerUI.js.

            log(`Toggle: ${key} = ${value}`);

            // Parent takeover toggles reveal/hide their "open on top-bar
            // click" sub-row and dim the parent row name when off.
            syncRowWrap(key);
            refreshSecCounts();
        });
    });

    const sideButtonStyleSelect = container.querySelector('#bd-side-button-style');
    if (sideButtonStyleSelect) {
        sideButtonStyleSelect.value = getDefaultSideButtonStyle();
        sideButtonStyleSelect.addEventListener('change', () => {
            setDefaultSideButtonStyle(sideButtonStyleSelect.value);
            applySideButtonStyleForActiveChar();
        });
    }

    // ── Collapsible section headers ──────────────────────────
    // Click or Enter/Space toggles the section body; chevron rotates.
    container.querySelectorAll('.bd-sec-head').forEach(head => {
        const sec = head.closest('.bd-sec');
        const body = sec.querySelector('.bd-sec-body');
        const setOpen = (open) => {
            sec.dataset.open = open ? 'true' : 'false';
            head.setAttribute('aria-expanded', open ? 'true' : 'false');
            body.style.display = open ? '' : 'none';
        };
        head.addEventListener('click', () => setOpen(sec.dataset.open !== 'true'));
        head.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
                ev.preventDefault();
                setOpen(sec.dataset.open !== 'true');
            }
        });
    });

    // Initial sync: dim/hide sub-rows to match loaded settings, fill counts.
    container.querySelectorAll('.bd-rowwrap[data-bd-parent]').forEach(w =>
        syncRowWrap(w.dataset.bdParent));
    refreshSecCounts();

    // Expose the recount so the nebula-loader companion (src/cuteLoader.js),
    // which injects its Nebula/Phosphor rows into the Interface section
    // asynchronously after this wiring runs, can refresh that section's count
    // on inject and on each of its own toggles.
    window.bdRefreshSecCounts = refreshSecCounts;

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
    // ── Boot timing instrumentation ──────────────────────────────
    // Measures how long UI Bedazzler's init takes and where. Each init is timed
    // individually so a slow one is obvious. Silent unless debug is enabled:
    // set window.UIBedazzlerDebug = true in the console and reload to see timings.
    const _bootT0 = performance.now();
    const _time = (label, fn) => {
        const t = performance.now();
        try { return fn(); }
        finally { if (isDebug()) console.log(`[BD boot] ${label}: ${(performance.now() - t).toFixed(1)}ms`); }
    };

    _time('ensureSettings', () => ensureSettings());

    // Inject settings panel into extensions drawer
    _time('settingsPanel', () => {
        const left = document.getElementById('extensions_settings');
        const right = document.getElementById('extensions_settings2');
        const target = left && right
            ? (right.children.length > left.children.length ? left : right)
            : (left || right);
        if (!target) return;
        $(target).append(buildSettingsHTML());
        wireSettingsEvents();
        addWandMenuItem();
    });

    // Init all features (each timed)
    _time('initPresetDrawer', () => initPresetDrawer());
    _time('initPresetDrawerExpanded', () => initPresetDrawerExpanded());
    _time('initUserSettingsDrawer', () => initUserSettingsDrawer());
    _time('initPersonaLore', () => initPersonaLore());
    _time('initCharDrawer', () => initCharDrawer());
    _time('initCharDrawerExpanded', () => initCharDrawerExpanded());
    _time('initCharBrowser', () => initCharBrowser());
    _time('initWorldInfoDrawerV2', () => initWorldInfoDrawerV2());
    _time('initChatDesign', () => initChatDesign());
    _time('initAuthorsNote', () => initAuthorsNote());
    _time('initSideButtons', () => initSideButtons());
    _time('initVariableViewer', () => initVariableViewer());
    _time('initNativePromptViewer', () => initNativePromptViewer());
    _time('initGreetingsGuard', () => initGreetingsGuard());

    // Nebula-loader probe does an awaited no-store network fetch as its first
    // step; deliberately NOT awaited here so it can't block the rest of init.
    // Everything it does afterward self-guards (plugin-present + toggle-on), so
    // firing it in the background is safe. Timed separately when it resolves.
    const _cuteT0 = performance.now();
    initCuteLoader()
        .then(() => { if (isDebug()) console.log(`[BD boot] initCuteLoader (async): ${(performance.now() - _cuteT0).toFixed(1)}ms`); })
        .catch(err => console.error('[BD boot] initCuteLoader failed:', err));

    if (isDebug()) console.log(`[BD boot] synchronous init total: ${(performance.now() - _bootT0).toFixed(1)}ms`);
    log('UI Bedazzler loaded ✓');
});
