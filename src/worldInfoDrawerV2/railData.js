// src/worldInfoDrawerV2/railData.js
// WI v2 rail — every ST read/write the rail needs, in one place.
//
// PRINCIPLE (handoff §12.2): state that ST already owns is READ, never
// mirrored. globalBooks IS #world_info's selection; strategy IS the hidden
// select's value; the bindings are chat_metadata / power_user / the character
// card + charLore. The only caching here is entry COUNTS (they cost a book
// load each) — and ST's own loadWorldInfo caches the underlying fetch anyway.

import { snapshotBooks, applyBooks } from './presets.js';

/** Cached world-info module — single dynamic import (same pattern as v1). */
const wiPromise = import('../../../../../../scripts/world-info.js');

const ctx = () => SillyTavern.getContext();

// ============================================================
// Books — the four bindings + the full library
// ============================================================

/** All lorebook names on disk, sorted. */
export function getAllBookNames() {
    try { return ctx().getWorldInfoNames().sort((a, b) => a.localeCompare(b)); }
    catch { return []; }
}

/** The global set — a live READ of #world_info (via the shared preset core). */
export function getGlobalBooks() {
    return snapshotBooks();
}

/** Book bound to this chat (chat_metadata[METADATA_KEY]), or null. */
export async function getChatBookName() {
    const { METADATA_KEY } = await wiPromise;
    const name = ctx().chatMetadata?.[METADATA_KEY];
    return (typeof name === 'string' && name) ? name : null;
}

/** Book on the user's persona (power_user.persona_description_lorebook), or null. */
export function getPersonaBookName() {
    const name = ctx().powerUserSettings?.persona_description_lorebook;
    return (typeof name === 'string' && name) ? name : null;
}

/**
 * The character's books: primary from the card (data.extensions.world), extras
 * from world_info.charLore keyed by the avatar filename (same lookup ST's own
 * /getcharbook uses — verified against world-info.js ~1130). Primary first,
 * order only (no sub-label in the rail — mock's rule). Empty in group chats
 * and no-character contexts for now.
 */
export async function getCharBooks() {
    const c = ctx();
    if (c.characterId == null || c.groupId != null) return [];
    const character = c.characters?.[c.characterId];
    if (!character) return [];

    const books = [];
    const primary = character.data?.extensions?.world;
    if (primary) books.push({ name: primary, primary: true });

    const fileName = (character.avatar || '').replace(/\.[^/.]+$/, '');
    const { world_info } = await wiPromise;
    const extra = world_info?.charLore?.find(e => e.name === fileName);
    for (const name of (extra?.extraBooks ?? [])) {
        if (name && !books.some(b => b.name === name)) {
            books.push({ name, primary: false });
        }
    }
    return books;
}

/** Toggle one book's membership in the global set. Routed through the shared
 *  applyBooks() so ST's change event always fires (presets and rail share
 *  the single write-path). */
export function toggleGlobalBook(name) {
    const cur = getGlobalBooks();
    applyBooks(cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]);
}

// ============================================================
// §9.30 — per-chat "last opened book" memory
// ============================================================
// Chat-scoped state belongs in chat_metadata (it travels with the chat,
// exactly like ST's own chat-book binding above). One key, one string.
// Written only by an explicit open (openBookByName) — a passive arrival is
// not a choice, so it must not overwrite one.

const LAST_BOOK_KEY = 'wl_wi2_lastBook';

/** The book last explicitly opened in THIS chat, or null. */
export function getLastOpenedBook() {
    const name = ctx().chatMetadata?.[LAST_BOOK_KEY];
    return (typeof name === 'string' && name) ? name : null;
}

/** Record an explicit open for this chat. Best-effort persist. */
export function setLastOpenedBook(name) {
    try {
        const c = ctx();
        if (!c.chatMetadata) return;
        c.chatMetadata[LAST_BOOK_KEY] = name;
        c.saveMetadata?.();
    } catch { /* non-fatal — memory is a convenience, not truth */ }
}

// ============================================================
// Strategy — read/write of ST's hidden #world_info_character_strategy
// ============================================================

/** Fallback mirrors ST's world_info_insertion_strategy; the import wins. */
const STRATEGY_FALLBACK = { evenly: 0, character_first: 1, global_first: 2 };

async function strategyMap() {
    const mod = await wiPromise;
    return mod.world_info_insertion_strategy ?? STRATEGY_FALLBACK;
}

/** Current strategy as a key: 'evenly' | 'character_first' | 'global_first'. */
export async function getStrategyKey() {
    const map = await strategyMap();
    const el = document.querySelector('#world_info_character_strategy');
    const val = parseInt(el?.value ?? '', 10);
    return Object.keys(map).find(k => map[k] === val) ?? 'character_first';
}

/** Set strategy by key, through ST's own control so its handler persists it. */
export async function setStrategyKey(key) {
    const map = await strategyMap();
    if (!(key in map)) return;
    const el = document.querySelector('#world_info_character_strategy');
    if (!el) return;
    el.value = String(map[key]);
    if (typeof $ !== 'undefined') $(el).trigger('change');
    else el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ============================================================
// Entry counts — the one thing worth caching (a load per book)
// ============================================================

/** Session cache plus in-flight de-duplication for lazy entry counts. */
const countCache = new Map();
const countLoads = new Map();
const countVersions = new Map();

export function pruneCountCache(names) {
    const keep = new Set(names);
    for (const name of countCache.keys()) {
        if (!keep.has(name)) countCache.delete(name);
    }
}

/** Forget one book's count — call after creating/deleting entries in it, so
 *  the next loadCounts pass re-reads it instead of trusting a stale number. */
export function dropCount(name) {
    countCache.delete(name);
    countLoads.delete(name);
    countVersions.set(name, (countVersions.get(name) ?? 0) + 1);
}

export function getCachedCount(name) {
    return countCache.has(name) ? countCache.get(name) : null;
}

async function loadCount(name) {
    if (countCache.has(name)) return countCache.get(name);
    const version = countVersions.get(name) ?? 0;
    const inflight = countLoads.get(name);
    if (inflight?.version === version) return inflight.promise;
    const task = (async () => {
        try {
            const data = await ctx().loadWorldInfo(name);
            const count = Object.keys(data?.entries ?? {}).length;
            if ((countVersions.get(name) ?? 0) !== version) return null;
            countCache.set(name, count);
            return count;
        } catch {
            if ((countVersions.get(name) ?? 0) === version) countCache.set(name, null);
            return null;
        } finally {
            if (countLoads.get(name)?.version === version) countLoads.delete(name);
        }
    })();
    countLoads.set(name, { version, promise: task });
    return task;
}

/**
 * Load entry counts for the given books, a few at a time, invoking
 * onOne(name, count) as each resolves so the UI can fill in live.
 * ST's loadWorldInfo caches book data, so re-runs are cheap.
 */
export async function loadCounts(names, onOne, shouldContinue = () => true) {
    const queue = [...new Set(names)].filter(n => !countCache.has(n));
    const CONCURRENCY = 4;
    const worker = async () => {
        while (queue.length && shouldContinue()) {
            const name = queue.shift();
            const count = await loadCount(name);
            if (shouldContinue()) onOne?.(name, count);
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}
