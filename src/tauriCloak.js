// src/tauriCloak.js — TauriTavern loading cloak for Landing Page Redux.
//
// WHAT THIS SOLVES
// ----------------
// Landing Page Redux (LPR) renders over ST's UI on first load. To avoid a flash
// of the bare ST/TT shell before the landing page paints, LPR speaks a "cloak"
// protocol via two globals:
//
//   • window.__nebulaClaimCloak()  — keep the full-screen cover up and cancel
//                                     any auto-lift failsafe. LPR calls this at
//                                     its module-eval and again before it renders.
//   • window.__nebulaLiftCloak()   — fade the cover out. LPR calls this the
//                                     instant the landing page is painted (and its
//                                     first images have settled). Idempotent.
//
// In real SillyTavern these globals come from the nebula-loader SERVER PLUGIN,
// which also paints the cover into the served HTML shell before any JS. In
// TauriTavern there's no plugin host AND extensions load AFTER the UI is already
// on screen — so an extension-painted cover is too late; the shell has already
// flashed. So the cover is PAINTED BY CSS instead:
//
//   /css/user.css  (served in the shell <head>, before extensions) shows a
//   full-screen cover on `html:not(.bd-cloak-done)` and includes its own
//   CSS-only failsafe fade (~6s) so it can never stick even with no JS at all.
//
// This module's ONLY job is to LIFT that CSS cover at the right moment by
// toggling classes on <html>:
//   • add `bd-cloak-lifting` → triggers the short fade-out keyframe
//   • then add `bd-cloak-done` → drops the :not() match, cover gone for good
//
// It lifts when LPR signals ready (via __nebulaLiftCloak), OR immediately if LPR
// is disabled / not installed, OR after its own JS failsafe (belt-and-suspenders
// with the CSS failsafe).
//
// SCOPE / SAFETY
// --------------
//   • tauri host only. On 'server' the plugin owns the cloak; on 'plain' ST
//     there's no landing page and no user.css cover, so this is a no-op.
//   • If LPR is enabled, we hold the cover and wait for its lift signal.
//     If LPR is disabled/absent, we lift immediately so TT reveals normally.
//   • ST loads extension settings from disk before evaluating extension modules,
//     so the enabled read is reliable at module-eval (LPR depends on this too).

// Absolute JS cap: if a claim came in but lift never did, reveal anyway. The
// CSS failsafe in user.css is the final backstop (only matters if the extension
// never ran); this JS one wins in the normal case. Bumped to 10s to comfortably
// cover slow character libraries (many sprite HEAD probes) before giving up.
const JS_FAILSAFE_MS = 10000;

// Must match the fade-out keyframe duration in user.css (bd-cloak-fadeout).
const FADE_MS = 260;

// LPR fades its landing page IN over ~400ms (the .lp-loaded opacity transition)
// starting at the same instant it calls our lift. If we start fading the cover
// immediately, both the cover AND the landing page are semi-transparent at once
// and the bare TT shell shows through the gap. So when we lift, we first HOLD
// the cover fully opaque for this long — letting LPR's page finish fading in
// underneath — THEN fade the cover out onto a fully-painted page. Slightly
// longer than LPR's 400ms for safety margin.
const LP_FADEIN_HOLD_MS = 450;
const CLOAK_MARKER_PATH = '/user/files/bd-lpr-cloak-enabled.css';

let failsafeTimer = null;
let lifted = false;

// ---------------------------------------------------------------------------
// Host + LPR gating (all synchronous, safe at module-eval)
// ---------------------------------------------------------------------------

// Mirror hostAdapter.isTauriHost() without importing it — this runs at
// module-eval and must stay synchronous (no adapter probe / network fetch).
function isTauriHost() {
    try {
        if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) return true;
        return !!document.querySelector(
            'link[href*="tauritavern-embedded-runtime.css"]',
        );
    } catch {
        return false;
    }
}

// Is Landing Page Redux installed, active, AND internally enabled? Extension
// settings can survive an uninstall, so their presence alone is not proof that
// LPR is available. Prefer ST's canonical extension lookup; retain a fallback
// for older hosts that only expose extensionNames.
function isLandingPageEnabled(extensionSettings, extensionApi) {
    try {
        let extension = null;
        if (typeof extensionApi?.findExtension === 'function') {
            extension = extensionApi.findExtension('SillyTavern-LandingPageRedux');
        } else if (Array.isArray(extensionApi?.extensionNames)) {
            const name = extensionApi.extensionNames.find((item) =>
                item === 'SillyTavern-LandingPageRedux'
                || item === 'third-party/SillyTavern-LandingPageRedux');
            if (name) {
                const disabled = extensionSettings?.disabledExtensions?.includes(name);
                extension = { name, enabled: !disabled };
            }
        }

        if (!extension?.enabled) return false;

        const es = extensionSettings
            || (typeof window !== 'undefined' && window.extension_settings)
            || globalThis.extension_settings;
        // LPR defaults to enabled on a fresh install; only an explicit false
        // suppresses the cloak once installation/activation is confirmed.
        return es?.landingPageRedux?.enabled !== false;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Lift mechanics — toggle classes on <html> to clear the CSS cover
// ---------------------------------------------------------------------------

function clearFailsafe() {
    if (failsafeTimer !== null) {
        clearTimeout(failsafeTimer);
        failsafeTimer = null;
    }
}

function armFailsafe() {
    clearFailsafe();
    // A failsafe lift means LPR never signalled — treat it like a page handoff
    // (hold through a possible in-progress fade-in) rather than an instant cut.
    failsafeTimer = setTimeout(() => liftCloak(), JS_FAILSAFE_MS);
}

// Fade the CSS cover out, then remove it entirely. Idempotent.
//
// `immediate` = true skips the LPR fade-in hold. Used when there's no landing
// page coming (LPR disabled/absent), so we don't sit on a pointless dark screen
// for 450ms. When LPR IS handing off, we hold the opaque cover through its
// fade-in first (see LP_FADEIN_HOLD_MS) so the bare TT shell never peeks through
// the moment when both cover and page are mid-transition.
function liftCloak(immediate = false) {
    if (lifted) return;
    lifted = true;
    clearFailsafe();
    const root = document.documentElement;
    if (!root) return;

    const doFade = () => {
        // Phase 1: fade (bd-cloak-lifting runs the fade-out keyframe on ::before/::after).
        root.classList.add('bd-cloak-lifting');
        // Phase 2: after the fade, drop the cover for good. bd-cloak-done breaks
        // the html:not(.bd-cloak-done) match so the pseudo-elements stop rendering.
        setTimeout(() => {
            root.classList.add('bd-cloak-done');
            root.classList.remove('bd-cloak-lifting');
        }, FADE_MS + 20);
    };

    if (immediate) {
        doFade();
    } else {
        // Hold the opaque cover while LPR's landing page fades in underneath,
        // then fade the cover onto the fully-painted page.
        setTimeout(doFade, LP_FADEIN_HOLD_MS);
    }
}

// "Claim" = LPR (or we) will lift the cover ourselves, so keep it up and just
// (re)arm the JS backstop. The cover is already painted by CSS, so there's
// nothing to paint here — this only manages the failsafe timer.
function claimCloak() {
    if (lifted) return;
    armFailsafe();
}

async function removePersistedCloakMarker() {
    const invoke = globalThis.window?.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== 'function') return;
    try {
        await invoke('delete_user_file', { path: CLOAK_MARKER_PATH });
    } catch (error) {
        if (!/not found/i.test(String(error))) {
            console.warn('[UIBedazzler] Could not remove stale TT cloak marker:', error);
        }
    }
}

// ---------------------------------------------------------------------------
// Entry point — call once, synchronously, at UIBedazzler module-eval.
// ---------------------------------------------------------------------------

export function installTauriCloak(extensionSettings, extensionApi) {
    if (window.__bdTauriCloakInstalled) return;

    // Only TauriTavern uses the user.css cover. On server the plugin owns the
    // cloak; on plain ST there's no cover to lift.
    if (!isTauriHost()) {
        // Not TT — make sure we don't leave a stray cover class around. (The
        // user.css cover only exists in TT's data dir, so this is belt-only.)
        try { document.documentElement.classList.add('bd-cloak-done'); } catch { /* */ }
        return;
    }

    // If the nebula-loader plugin already provided the protocol, defer to it.
    if (typeof window.__nebulaClaimCloak === 'function'
        || typeof window.__nebulaLiftCloak === 'function') {
        return;
    }

    window.__bdTauriCloakInstalled = true;

    // Expose the protocol LPR expects.
    window.__nebulaClaimCloak = claimCloak;
    window.__nebulaLiftCloak = liftCloak;

    if (isLandingPageEnabled(extensionSettings, extensionApi)) {
        // LPR is on: hold the CSS cover and wait for LPR to lift it (it will,
        // once its landing page paints). Arm the JS backstop meanwhile.
        armFailsafe();
    } else {
        // No landing page is coming — lift immediately (no fade-in hold) so TT
        // reveals at once instead of waiting out the CSS failsafe.
        void removePersistedCloakMarker();
        liftCloak(true);
    }
}
