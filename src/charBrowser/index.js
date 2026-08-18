// src/charBrowser/index.js
// Character Browser — feature lifecycle + activation wiring.
//
// The browser is the !hasCharacterContext() "hub" takeover (welcome screen /
// no character loaded): a build-fresh character BROWSER, counterpart to the
// expanded EDIT drawer (charDrawerExpanded/, wl-xd-). See the plan handoff
// 2026-07-19-char-select-drawer-PLAN.md.
//
// ENABLE GATE: the browser is a COMPANION of the expanded drawer (its "Edit"
// opens the drawer), so it requires BOTH the "Character Browser" toggle AND the
// expanded-drawer parent — isCharBrowserEnabled() is the single check every
// entry point routes through. Entry points: the expand button on a no-character
// screen, the drawer's Back arrow, the native top-bar click (with "Open on
// top-bar click"), and the `/bdz-charbrowser` command. The command is registered
// unconditionally (ST can't cleanly unregister commands) and self-gates on the
// enable check; closing is always allowed so a stale overlay can't stick.

import { extension_settings } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';
import { takeoverCharBrowser, restoreCharBrowser, isCharBrowserActive } from './drawerUI.js';

const log = () => {};

// ============================================================
// Enable gate
// ============================================================

/**
 * True when the Character Browser is usable. It's a COMPANION of the expanded
 * drawer — the browser's "Edit" opens the expanded drawer — so it requires BOTH
 * its own toggle AND the expanded-drawer parent. Every entry point (slash
 * command, expand button on a no-character screen, the drawer's Back arrow, the
 * open-on-click redirect) routes through this, so a single check keeps the
 * dependency honest. Defensive against settings not being materialized yet.
 */
export function isCharBrowserEnabled() {
    const s = extension_settings[MODULE_NAME];
    return !!(s?.charDrawerExpanded && s?.charBrowser);
}

// ============================================================
// Public API
// ============================================================

export function initCharBrowser() {
    registerSlashCommand();
    log('Initialized');
}

/**
 * Settings toggle handler for "Character Browser". Enabling wires nothing new
 * (the slash command is always registered and self-gates; the drawer's entry
 * points read isCharBrowserEnabled live). Disabling closes the overlay if it's
 * currently open so a now-disabled browser can't linger. Also fires when the
 * expanded-drawer PARENT is turned off (index.js calls this from that handler),
 * since the browser is inert without the parent.
 */
export function onCharBrowserToggleChanged(_enabled) {
    if (!isCharBrowserEnabled() && isCharBrowserActive()) {
        restoreCharBrowser();
    }
}

// Re-export the takeover/restore so the future open-on-click wiring (PLAN
// phase 7, in charDrawerExpanded/index.js) can route the no-character branch
// here without reaching into drawerUI.js directly.
export { takeoverCharBrowser, restoreCharBrowser, isCharBrowserActive };

// ============================================================
// /charbrowser slash command
// ============================================================

/**
 * Register `/charbrowser` — toggles the browser overlay (open if closed, close
 * if open). Uses the modern object API off getContext() (SlashCommandParser +
 * SlashCommand.fromProps), the same surface WI v2 uses for /bdz-widrawer. Wrapped in
 * try/catch so a shifting API surface can't break the rest of init.
 */
function registerSlashCommand() {
    try {
        const ctx = SillyTavern.getContext();
        const { SlashCommandParser, SlashCommand } = ctx;
        if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) {
            console.warn('[BD] Char Browser: slash command API not available — /bdz-charbrowser not registered');
            return;
        }
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'bdz-charbrowser',
            callback: () => {
                // Toggle. Closing is always allowed so a stale overlay can't get
                // stuck open. Opening self-gates on isCharBrowserEnabled (the
                // browser toggle AND its expanded-drawer parent), mirroring how
                // /bdz-widrawer gates on Expanded World Info.
                if (isCharBrowserActive()) {
                    restoreCharBrowser();
                } else if (isCharBrowserEnabled()) {
                    takeoverCharBrowser();
                } else {
                    return 'Character Browser is turned off (enable it under Expanded Character Drawer in UI Bedazzler settings).';
                }
                return '';
            },
            helpString: 'Toggle the Character Browser (UI Bedazzler).',
            returns: 'nothing',
        }));
        log('/bdz-charbrowser registered');
    } catch (err) {
        console.error('[BD] Char Browser: failed to register /bdz-charbrowser:', err);
    }
}
