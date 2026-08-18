// src/worldInfoDrawerV2/index.js
// World Info v2 — feature lifecycle + activation wiring.
//
// ENTRY POINTS: the `/bdz-widrawer` slash command (a power-user shortcut), an
// expand button injected into ST's native World Info drawer header, and —
// with the "Open on top-bar click" sub-toggle — a native WI-drawer open.
// Opening is centrally gated on the "Expanded World Info" toggle in
// takeoverWiV2.
//
// The slash command registers UNCONDITIONALLY at init: ST's SlashCommandParser
// has no public unregister, so a toggle couldn't cleanly remove it anyway. It
// self-gates on the toggle (opening only when Expanded World Info is on), and
// closing is always allowed so a stale overlay can't stick.

import { extension_settings } from '../../../../../extensions.js';
import { eventSource, event_types } from '../../../../../../script.js';
import { MODULE_NAME } from '../settings.js';

const log = () => {};

const ROOT_ID = 'wl-wi2-root';
let drawerModulePromise = null;
let simModulePromise = null;
let styleLink = null;

const loadDrawerModule = () => drawerModulePromise ??= import('./drawerUI.js');
const loadSimModule = () => simModulePromise ??= import('./simData.js');

function isWiV2ActiveNow() {
    return !!document.getElementById(ROOT_ID);
}

function ensureWiV2Style() {
    if (styleLink?.isConnected) return;
    const existing = document.querySelector('link[data-bd-wi-v2-style="true"]');
    if (existing) { styleLink = existing; return; }
    styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = new URL('../../worldInfoDrawerV2.css', import.meta.url).href;
    styleLink.dataset.bdWiV2Style = 'true';
    document.head.appendChild(styleLink);
}

function removeWiV2Style() {
    styleLink?.remove();
    styleLink = null;
}

async function openWiV2() {
    if (!isExpandedEnabled() || isWiV2ActiveNow()) return;
    ensureWiV2Style();
    const { takeoverWiV2 } = await loadDrawerModule();
    if (isExpandedEnabled() && !isWiV2ActiveNow()) takeoverWiV2();
}

async function closeWiV2() {
    if (!isWiV2ActiveNow()) return;
    const { restoreWiV2 } = await loadDrawerModule();
    restoreWiV2();
}

function startSimCapture() {
    loadSimModule().then(m => {
        if (isExpandedEnabled()) m.startSimCapture();
    }).catch(err => console.error('[BD] WI v2: failed to start simulator capture:', err));
}

function stopSimCapture() {
    if (!simModulePromise) return;
    simModulePromise.then(m => m.stopSimCapture())
        .catch(err => console.error('[BD] WI v2: failed to stop simulator capture:', err));
}

// ============================================================
// Public API
// ============================================================

export function initWorldInfoDrawerV2() {
    // The /bdz-widrawer slash command registers unconditionally, even with the toggle
    // off: ST's SlashCommandParser has no public unregister, so a toggle can't
    // cleanly remove it anyway. The command self-gates on the toggle.
    registerSlashCommand();

    // The rail renders chat-scoped truth (chat book, character's books, what
    // counts as "read here"), so a chat/character switch must re-read it.
    // chatSwitched re-runs §9.30's arrival chain for the NEW chat (last
    // opened there → its chat book → nothing); the rail notifies the listcol,
    // whose loadBook flushes the outgoing book's pending save (§9.31).
    // Registered once at init; the isWiV2Active() guard makes it inert while
    // the overlay is closed — and since the overlay can only open when the
    // toggle is on (takeoverWiV2 is gated), this also covers the toggle-off
    // case. Same self-guarding shape as charDrawerExpanded's refreshGreetings.
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (!isWiV2ActiveNow()) return;
        import('./rail.js').then(({ refreshRail }) => {
            if (isWiV2ActiveNow()) refreshRail({ chatSwitched: true });
        }).catch(err => console.error('[BD] WI v2: chat refresh failed:', err));
    });

    // Simulator's "last reply" capture is SESSION-scoped, not drawer-scoped:
    // a reply can only be sent with the drawer closed, so the capture must be
    // listening the whole session, not just while the panel is open. Only
    // needed when the feature is enabled; gated on the toggle here and
    // (re)started by onWorldInfoDrawerExpandedToggleChanged on enable.
    // startSimCapture() is idempotent, so a redundant call is harmless.
    if (isExpandedEnabled()) {
        ensureWiV2Style();
        startSimCapture();
    }

    // Native-drawer expand button: the manual entry into v2. Only set up when
    // v2 is enabled; the toggle handler adds/removes it live thereafter. Its
    // observer re-injects the button if ST rebuilds the drawer header.
    if (isExpandedEnabled()) setupNativeExpandButton();

    // "Open expanded on top-bar click": when BOTH Expanded-WI (v2) and the
    // "open on click" sub-toggle are on, a normal open of ST's native WI
    // drawer is redirected into v2. Set up here when both are on; the toggle
    // handler reconciles it live. Independent of the expand BUTTON above — this
    // is the click-to-open-expanded convenience layer, the button is the manual
    // affordance. The watcher self-gates on both toggles, so it's inert unless
    // both are on. See the section at the bottom of this file.
    setupOpenExpandedWatcher();

    log('Initialized');
}

/**
 * True when the Expanded World Info (v2) toggle is on. Defensive against
 * settings not being materialized yet.
 */
function isExpandedEnabled() {
    return !!extension_settings[MODULE_NAME]?.worldInfoDrawerExpanded;
}

/**
 * True when BOTH gates for "open expanded on top-bar click" are on: the base
 * Expanded-WI (v2) toggle AND its "open on click" sub-toggle. The sub-toggle
 * is meaningless without v2 (there's nothing to open into), so both must hold.
 * Defensive against settings not being materialized yet.
 */
function isOpenExpandedEnabled() {
    const s = extension_settings[MODULE_NAME];
    return !!(s?.worldInfoDrawerExpanded && s?.worldInfoOpenExpanded);
}

/**
 * Settings toggle handler for "Expanded World Info" (v2). Mirrors
 * onCharDrawerExpandedToggleChanged in src/charDrawerExpanded/index.js.
 *
 *   enable  → start the session-scoped simulator capture (idempotent).
 *   disable → if the v2 overlay is currently open, close it (restoreWiV2).
 *
 * The /bdz-widrawer command and the CHAT_CHANGED listener are always registered; both
 * self-gate (the command on this toggle, the listener on isWiV2Active), so
 * there's nothing to unwire here.
 */
export function onWorldInfoDrawerExpandedToggleChanged(enabled) {
    if (enabled) {
        ensureWiV2Style();
        startSimCapture();
        // The native-drawer expand button becomes available now.
        setupNativeExpandButton();
    } else {
        stopSimCapture();
        const close = isWiV2ActiveNow() ? closeWiV2() : Promise.resolve();
        void close.catch(err => console.error('[BD] WI v2: failed to close:', err))
            .finally(removeWiV2Style);
        // v2 off ⇒ the expand button should disappear.
        teardownNativeExpandButton();
    }
    // Reconcile the "open expanded on click" watcher with the new v2 state.
    // setupOpenExpandedWatcher installs the observer whenever v2 is on and
    // tears it down when v2 is off; while installed it self-gates per mutation
    // on isOpenExpandedEnabled() (which also reads the sub-toggle), so flipping
    // the sub-toggle alone needs no handler — the live gate covers it.
    setupOpenExpandedWatcher();
}

// ============================================================
// /bdz-widrawer slash command
// ============================================================

/**
 * Register `/bdz-widrawer` — toggles the expanded overlay.
 *
 * Uses the modern object API off getContext() (SlashCommandParser +
 * SlashCommand.fromProps, both exported by st-context.js — same surface this
 * extension already reads for /csss detection in userSettingsDrawer.js).
 * Wrapped in try/catch: if the API surface ever shifts, we log and the rest
 * of the extension is unaffected.
 */
function registerSlashCommand() {
    try {
        const ctx = SillyTavern.getContext();
        const { SlashCommandParser, SlashCommand } = ctx;
        if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) {
            console.warn('[BD] WI v2: slash command API not available — /bdz-widrawer not registered');
            return;
        }
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'bdz-widrawer',
            callback: async () => {
                // Self-gate on the toggle: /bdz-widrawer is registered unconditionally
                // (ST can't unregister commands), but the overlay must only
                // open when Expanded World Info is enabled. Closing is always
                // allowed so a stale overlay can never get stuck open.
                if (isWiV2ActiveNow()) {
                    await closeWiV2();
                } else if (isExpandedEnabled()) {
                    await openWiV2();
                } else {
                    return 'Expanded World Info is turned off (enable it in UI Bedazzler settings).';
                }
                return '';
            },
            helpString: 'Toggle the Expanded World Info drawer (UI Bedazzler).',
            returns: 'nothing',
        }));
        log('/bdz-widrawer registered');
    } catch (err) {
        console.error('[BD] WI v2: failed to register /bdz-widrawer:', err);
    }
}

// ============================================================
// Native-drawer expand button (v2's entry into itself)
// ============================================================
//
// A button injected into ST's NATIVE World Info drawer header — immediately to
// the right of the lock/pin (#WI_panel_pin_div), same size/placement — so v2
// is reachable straight from the native drawer. Gated on worldInfoDrawer
// Expanded: when v2 is off it is never injected (and is torn down live by the
// toggle handler). Styled by #wl-wi2-native-expand-btn in worldInfoDrawerV2.css.

const NATIVE_EXPAND_BTN_ID = 'wl-wi2-native-expand-btn';

let nativeExpandObserver = null;

function injectNativeExpandButton() {
    // Gate on v2 being enabled.
    if (!isExpandedEnabled()) return;

    const pinDiv = document.getElementById('WI_panel_pin_div');
    if (!pinDiv || document.getElementById(NATIVE_EXPAND_BTN_ID)) return;

    const btn = document.createElement('div');
    btn.id = NATIVE_EXPAND_BTN_ID;
    // Light, chrome-free glyph that matches the lock.
    btn.className = 'fa-solid fa-up-right-and-down-left-from-center';
    btn.title = 'Open expanded World Info drawer';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');

    const open = (e) => {
        e.preventDefault();
        e.stopPropagation();
        // takeoverWiV2 is itself gated on the toggle, so this is safe even if a
        // class/observer race ever left the button up a moment too long.
        if (!isWiV2ActiveNow()) void openWiV2();
    };
    btn.addEventListener('click', open);
    // Keyboard parity (it's a div, not a <button>): Enter / Space activate.
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') open(e);
    });

    // Right of the lock: insert directly AFTER the pin div.
    pinDiv.insertAdjacentElement('afterend', btn);
}

function removeNativeExpandButton() {
    document.getElementById(NATIVE_EXPAND_BTN_ID)?.remove();
}

/**
 * Inject + keep alive. ST rebuilds the WI header on drawer open/close and other
 * churn; a single MutationObserver on #WorldInfo re-runs injection on any of
 * that. injection self-gates (v2 on, not already present), so the observer just
 * re-adds the button whenever ST wipes it. If v2 was toggled off, the observer
 * has already been disconnected by teardown, so we never fight that.
 */
function setupNativeExpandButton() {
    teardownNativeExpandButton();
    injectNativeExpandButton();

    const host = document.getElementById('WorldInfo');
    if (!host) return;
    nativeExpandObserver = new MutationObserver(() => {
        if (isExpandedEnabled()) injectNativeExpandButton();
    });
    nativeExpandObserver.observe(host, { childList: true, subtree: true });
}

function teardownNativeExpandButton() {
    if (nativeExpandObserver) {
        nativeExpandObserver.disconnect();
        nativeExpandObserver = null;
    }
    removeNativeExpandButton();
}

// ============================================================
// "Open expanded on top-bar click" (redirect native open → v2)
// ============================================================
//
// When BOTH Expanded-WI (v2) and its "open on click" sub-toggle
// (worldInfoOpenExpanded) are on, opening ST's native World Info drawer from
// the top bar opens the v2 overlay instead. Implemented as a class observer on
// #WorldInfo, so it catches EVERY path that opens the drawer — the top-bar
// #WIDrawerIcon click, a programmatic openWorldInfoEditor(), an import
// auto-open — not just a single bound click handler.
//
// FLOW when the drawer transitions to open and both toggles hold:
//   1. Close the native drawer by triggering a click on #WIDrawerIcon. The
//      drawer is open, so ST's doNavbarIconClick toggles it back to
//      .closedDrawer — it slides shut BEHIND the v2 overlay (higher z-index),
//      so the user never sees it. This also resets ST's own open/pin state
//      cleanly, so there's no half-open native drawer lurking after v2 closes.
//   2. Open v2 (takeoverWiV2, itself toggle-gated).
//
// RE-ENTRANCY: closing the drawer in step 1 mutates #WorldInfo's class, which
// re-fires this observer. The `redirecting` flag suppresses that re-entry, and
// the .openDrawer check means the close mutation (now .closedDrawer) is a no-op
// anyway. Belt-and-braces.
//
// COEXISTENCE with the expand BUTTON: independent. The button is the manual
// affordance (always available when v2 is on); this is the automatic
// click-to-open-expanded layer (only when the sub-toggle is also on). Both
// route through takeoverWiV2, so they can't double-open (it's idempotent).

let openExpandedObserver = null;
let redirecting = false;

/**
 * Redirect a native-drawer open into v2: close the native drawer (so it doesn't
 * sit behind the overlay), then open v2. Guarded by `redirecting` so the class
 * mutation from closing can't recurse back into another redirect.
 */
function redirectNativeOpenToV2() {
    if (redirecting) return;
    redirecting = true;
    try {
        // Close the native drawer. It's currently open, so a top-bar icon click
        // toggles it shut (ST's doNavbarIconClick). Guard the element lookup —
        // if the icon isn't present for some reason, we still open v2 below so
        // the user isn't left with nothing.
        const icon = document.getElementById('WIDrawerIcon');
        if (icon && typeof $ !== 'undefined' && $(icon).trigger) {
            $(icon).trigger('click');
        } else if (icon) {
            icon.dispatchEvent(new Event('click', { bubbles: true }));
        }
        // Open v2 (idempotent + toggle-gated). Deferred a tick so ST finishes
        // its own close bookkeeping (class flips, pin restore) before the
        // overlay lands — avoids interleaving our takeover with ST's teardown.
        setTimeout(() => {
            openWiV2().finally(() => { redirecting = false; });
        }, 0);
    } catch (err) {
        console.error('[BD] WI v2: open-expanded redirect failed:', err);
        redirecting = false;
    }
}

/**
 * Install (or refresh) the observer that redirects native-drawer opens into v2.
 * Installed whenever v2 is enabled; while installed it self-gates PER MUTATION
 * on isOpenExpandedEnabled() (which also reads the sub-toggle), so flipping the
 * sub-toggle alone takes effect immediately with no handler needed. Torn down
 * when v2 is off. Idempotent: safe to call repeatedly (init + toggle handler).
 */
function setupOpenExpandedWatcher() {
    teardownOpenExpandedWatcher();
    // Only bother observing when v2 is on at all. When v2 is off the redirect
    // can never fire (isOpenExpandedEnabled would be false), so we skip the
    // observer entirely rather than run a dead one.
    if (!isExpandedEnabled()) return;

    const host = document.getElementById('WorldInfo');
    if (!host) return;

    openExpandedObserver = new MutationObserver(() => {
        // Gate on BOTH toggles live, the drawer actually being open, and v2 not
        // already up. redirecting suppresses the close-mutation re-entry.
        if (redirecting) return;
        if (!isOpenExpandedEnabled()) return;
        if (isWiV2ActiveNow()) return;
        if (host.classList.contains('openDrawer')) {
            redirectNativeOpenToV2();
        }
    });
    openExpandedObserver.observe(host, {
        attributes: true,
        attributeFilter: ['class'],
    });
}

function teardownOpenExpandedWatcher() {
    if (openExpandedObserver) {
        openExpandedObserver.disconnect();
        openExpandedObserver = null;
    }
    redirecting = false;
}
