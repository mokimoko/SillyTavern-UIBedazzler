// src/debug.js
// Shared debug gate for UI Bedazzler diagnostics.
//
// All non-essential console output (boot timing, "attached"/"built" traces,
// etc.) routes through here so the console stays clean by default. Genuine
// errors and safety warnings do NOT use this — they log unconditionally.
//
// To turn diagnostics ON at runtime, in the browser console:
//     window.UIBedazzlerDebug = true
// then repeat the action. No reload or settings change required.

export function isDebug() {
    return !!window.UIBedazzlerDebug;
}

// Namespaced debug logger. Prefix is prepended to every message.
// Silent unless window.UIBedazzlerDebug is truthy.
export function makeDebug(prefix) {
    return (...args) => {
        if (window.UIBedazzlerDebug) console.log(prefix, ...args);
    };
}
