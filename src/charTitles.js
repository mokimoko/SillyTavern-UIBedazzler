// src/charTitles.js
// Per-character "title" (subtitle/epithet) — a Bedazzler-only field ST has no
// home for. Titles are the descriptive tagline people put in a card's name on
// sites like JanitorAI ("Marcus, the Knight Who Can't Stand You") but which ST
// would otherwise swallow whole into {{char}}. Storing them HERE (the shared
// sidecar, keyed by avatar) keeps the real card files untouched: {{char}} stays
// the clean name, and the title is pure display chrome the extension renders in
// the expanded drawer (editable) and on the character-browser cards (read-only).
//
// STORAGE: the sidecar's `charTitles` section — { [avatar]: "title string" }.
// Reads are synchronous off the cache and fall back to '' before the sidecar
// resolves; callers that render before load (the browser grid) already repaint
// on the sidecar-loaded callback, so a title just fills in a beat later. Writes
// go through the sidecar's debounced save (shared with tag-meta / WI subjects).

import {
    getSection,
    scheduleSave,
    ensureSidecarLoaded,
    isSidecarLoaded,
    onSidecarLoaded,
} from './sidecar.js';

// A title is a short tagline, not a bio. Cap it so it stays a subtitle and can't
// bloat the sidecar; the drawer input also enforces this via maxlength.
export const MAX_TITLE_LEN = 120;

/** Re-export the load helpers so a caller (e.g. the expanded drawer) can kick
 *  the sidecar load and subscribe for the value once it resolves, without also
 *  importing sidecar.js directly. */
export { ensureSidecarLoaded, isSidecarLoaded, onSidecarLoaded };

/** The live `charTitles` map from the sidecar (created on demand). */
function titlesStore() {
    return getSection('charTitles');
}

/**
 * The saved title for a character (by avatar filename), or '' if none. Always a
 * string. Returns '' before the sidecar has loaded (caller repaints on load).
 */
export function getCharTitle(avatar) {
    if (!avatar || avatar === 'none') return '';
    const v = titlesStore()[avatar];
    return (typeof v === 'string') ? v : '';
}

/**
 * Persist a character's title (by avatar). Trims; an empty/blank title DELETES
 * the entry so the store doesn't accumulate empties. Clamped to MAX_TITLE_LEN.
 * Saved via the sidecar's debounced write. No-op without an avatar.
 */
export function setCharTitle(avatar, title) {
    if (!avatar || avatar === 'none') return;
    try {
        const store = titlesStore();
        const clean = String(title || '').trim().slice(0, MAX_TITLE_LEN);
        if (!clean) {
            if (store[avatar] === undefined) return; // nothing to clear
            delete store[avatar];
        } else {
            if (store[avatar] === clean) return; // unchanged — skip the save
            store[avatar] = clean;
        }
        scheduleSave();
    } catch (err) {
        console.warn('[BD] charTitles: save failed.', err);
    }
}
