// src/cssScheduler.js
// Batches CSS rebuild functions into a single requestAnimationFrame.
//
// Problem: chatDesign, charDrawer, and personaLore all listen to CHAT_CHANGED
// independently and each inject their own <style> element. When they fire
// synchronously, each DOM mutation can trigger a separate style recalculation.
//
// Solution: each module calls scheduleCSSRebuild(key, fn) instead of injecting
// directly. All pending rebuilds run together in the next animation frame —
// one paint, one recalc.

let pending = new Map();
let rafId = null;

/**
 * Schedule a CSS rebuild function to run in the next animation frame.
 * Multiple calls with different keys accumulate; same key replaces.
 *
 * @param {string} key — unique identifier (e.g. 'chatDesign', 'charDesign')
 * @param {Function} fn — the rebuild function to call
 */
export function scheduleCSSRebuild(key, fn) {
    pending.set(key, fn);
    if (!rafId) {
        rafId = requestAnimationFrame(flushRebuilds);
    }
}

function flushRebuilds() {
    rafId = null;
    const fns = [...pending.values()];
    pending.clear();
    for (const fn of fns) {
        try {
            fn();
        } catch (e) {
            console.error('[WL CSSScheduler] Rebuild error:', e);
        }
    }
}
