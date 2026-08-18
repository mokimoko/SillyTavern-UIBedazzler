// src/charBrowser/charData.js
// Character Browser — data layer. Reads ST's character truth + the separate
// stats store, joins them by avatar, and derives the honest card/detail fields.
//
// PLAN "DATA REALITY": every field here is real ST data. No invented
// Source/Status, no fabricated subtitle. The card shows: star (fav) · name ·
// first-N tags · message count · creator · last-used. Stats come from ST's
// /api/stats/get store (keyed by avatar filename), fetched once per open.
//
// getContext() exposes: characters[], getThumbnailUrl, tags, tagMap. The stats
// helpers are NOT on the context; rather than deep-importing stats.js's
// reassigned `charStats` binding (unreliable — see the stats block below), we
// fetch /api/stats/get ourselves and own the result.

import { getSettings } from '../settings.js';
import { getCharTitle } from '../charTitles.js';
import {
    ensureSidecarLoaded,
    isSidecarLoaded,
    getSection,
    scheduleSave as sidecarScheduleSave,
    onSidecarLoaded,
} from '../sidecar.js';

const log = () => {};

// ============================================================
// Shared sidecar — the char browser's custom data lives here
// ============================================================
//
// The char browser's Bedazzler-custom data (per-tag description/related-tags,
// and the page-size choice) is persisted in the `charBrowser` SECTION of the
// shared sidecar (src/sidecar.js), NOT in ST extension settings. Section shape:
//   charBrowser: { tagMeta: { [tagId]: { description, related } }, pageSize: N }
//
// One-time migration: the first time we touch a sidecar that has no charBrowser
// data, we lift any legacy values out of extension settings (charBrowserTagMeta
// / charBrowserPageSize), write them into the section, and DELETE the settings
// copies so the migration never runs twice. Reads are synchronous off the
// cache; if the sidecar hasn't resolved yet the getters fall back to their
// defaults (empty meta / default page size), then the browser re-reads once the
// sidecar load fires (initCharBrowserData subscribes on takeover).

/** The live `charBrowser` section object from the sidecar (created on demand).
 *  Runs the settings→sidecar migration the first time it sees an empty section
 *  while the sidecar is loaded. */
function charBrowserSection() {
    const sec = getSection('charBrowser');
    if (isSidecarLoaded() && !sec.__migrated) {
        migrateCharBrowserFromSettings(sec);
    }
    return sec;
}

/** Move legacy char-browser data out of extension settings into the sidecar
 *  section, once. Marks the section `__migrated` so it's idempotent, deletes the
 *  old settings keys on success, and schedules a sidecar save if anything moved. */
function migrateCharBrowserFromSettings(sec) {
    sec.__migrated = true;
    try {
        const s = getSettings();
        let moved = false;
        if (!sec.tagMeta && s.charBrowserTagMeta && typeof s.charBrowserTagMeta === 'object') {
            sec.tagMeta = s.charBrowserTagMeta;
            delete s.charBrowserTagMeta;
            moved = true;
        }
        if (sec.pageSize == null && typeof s.charBrowserPageSize === 'number' && s.charBrowserPageSize > 0) {
            sec.pageSize = s.charBrowserPageSize;
            delete s.charBrowserPageSize;
            moved = true;
        }
        if (moved) {
            ctx().saveSettingsDebounced(); // persist the settings DELETIONS
            sidecarScheduleSave();          // persist the new sidecar section
            log('char browser data migrated settings → sidecar');
        }
    } catch (err) {
        console.warn('[BD] Char Browser: settings→sidecar migration failed.', err);
    }
}

/**
 * Ensure the shared sidecar is loading and, if a repaint callback is given,
 * fire it once the load resolves (so a browser opened before the sidecar
 * resolved repaints with real tag-meta / page-size). Called from the char
 * browser takeover. Idempotent + safe to call repeatedly.
 */
export function initCharBrowserData(onReady) {
    if (isSidecarLoaded()) {
        charBrowserSection();        // run migration now
        onReady?.();
        return;
    }
    const off = onSidecarLoaded(() => {
        off();
        charBrowserSection();        // migrate on first real load
        onReady?.();
    });
    ensureSidecarLoaded();
}

// ============================================================
// Stats store
// ============================================================

// WHY WE FETCH OUR OWN COPY (the phase-4 stats bug):
// stats.js declares `let charStats = {}` and getStats() does `charStats =
// await response.json()` — it REASSIGNS the whole object. Importing that binding
// proved unreliable: our reference didn't track the reassignment, so statsFor()
// saw the empty initial {} for most chars (0 msgs, blank last-used, dead Recents;
// only the char stats.js had already touched via its own code path showed up).
// Rather than fight the shared binding, we own the truth: hit the same endpoint
// getStats() uses (/api/stats/get) and hold the result ourselves. Keys are the
// avatar filename (confirmed: stats.js reads charStats[characters[this_chid].avatar]).
let statsStore = {};   // { [avatar]: statRecord } — our own copy
let statsReady = false;
let statsRequestGeneration = 0;

/**
 * Fetch the stats store once per open (or force a refresh). Populates our own
 * `statsStore` from /api/stats/get. Guarded so a stats failure never breaks the
 * grid: cards just fall back to "no stats" (msg count 0, never used).
 */
export async function ensureStats(force = false) {
    if (statsReady && !force) return;
    const requestGeneration = ++statsRequestGeneration;
    try {
        const c = ctx();
        const resp = await fetch('/api/stats/get', {
            method: 'POST',
            headers: c.getRequestHeaders(),
            body: JSON.stringify({}),
            cache: 'no-cache',
        });
        if (!resp.ok) throw new Error('stats fetch ' + resp.status);
        const data = await resp.json();
        if (requestGeneration !== statsRequestGeneration) return;
        statsStore = (data && typeof data === 'object') ? data : {};
        statsReady = true;
    } catch (err) {
        if (requestGeneration !== statsRequestGeneration) return;
        console.warn('[BD] Char Browser: stats fetch failed — cards show no stats.', err);
    }
}

/** Per-character stat record from our owned store, or null if none tracked. */
function statsFor(avatar) {
    return (avatar && statsStore && statsStore[avatar]) || null;
}

// ============================================================
// Character read + derive
// ============================================================

function ctx() {
    return SillyTavern.getContext();
}

/**
 * Build a reusable tag lookup for ONE getCharacterModels pass: an id→tag Map
 * plus the hidden-name Set and a tagMap handle. The three tag helpers below
 * used to each rebuild a full Map/Set of EVERY tag on EVERY call, so deriving
 * one character's tags cost O(T) and a whole library cost O(N×T) (N chars × T
 * tags) — a real hitch when opening a large library with many tags. Building
 * the index ONCE here and threading it through drops that to O(N+T). Defensive:
 * always returns a well-formed index (empty structures on failure) so the
 * per-character helpers can't throw.
 */
function buildTagIndex() {
    let tags = [];
    let tagMap = {};
    try {
        const c = ctx();
        if (Array.isArray(c.tags)) tags = c.tags;
        if (c.tagMap && typeof c.tagMap === 'object') tagMap = c.tagMap;
    } catch { /* fall through to an empty index */ }
    return {
        byId: new Map(tags.map(t => [t.id, t])),
        hidden: getHiddenTagSet(),
        tagMap,
    };
}

/**
 * Resolve a character's tag names via the pass's tag index (avatar → [tagId] →
 * tag name). Returns [] if the char carries no tags. Order follows tagMap.
 */
function tagNamesFor(avatar, idx) {
    const ids = idx.tagMap[avatar] || [];
    if (!ids.length) return [];
    return ids.map(id => idx.byId.get(id)?.name).filter(Boolean);
}

/**
 * Resolve a character's tags as COLOR-BEARING chip records:
 *   { id, name, color, color2 }   (color = background, color2 = text)
 * matching ST's own tag colour semantics (tags.js sets background-color =
 * tag.color and color = tag.color2). Order follows tagMap; only ids that still
 * resolve to a real tag survive. The card + detail chip renderers use this so a
 * tag's colours on the Characters view always match ST — because they ARE the
 * same tag object's fields. Returns [] on failure.
 */
function tagChipsFor(avatar, idx) {
    const ids = idx.tagMap[avatar] || [];
    if (!ids.length) return [];
    // Hidden tags (the Tag Hub's "hide from view" list) are dropped from the
    // DISPLAY chips only — the card + detail hero don't show them. Filtering
    // is here (not on `tags`/`tagIds`) so tag-based FILTERING still works on
    // the full set; only what's rendered changes.
    return ids
        .map(id => idx.byId.get(id))
        .filter(Boolean)
        .filter(t => !idx.hidden.has((t.name || '').toLowerCase()))
        .map(t => ({
            id: t.id,
            name: t.name || '',
            color: t.color || '',
            color2: t.color2 || '',
        }));
}

/**
 * A character's tag IDs from tagMap (avatar → [tagId]). Unlike tagNamesFor,
 * this keeps the raw ids — the stable, rename-safe handle the VIEWS section
 * filters by (a tag can be renamed; its id doesn't change). Only ids that still
 * resolve to a real tag are kept, so a stale membership entry can't match a
 * ghost facet. Returns [] on any failure.
 */
function tagIdsFor(avatar, idx) {
    const ids = idx.tagMap[avatar] || [];
    if (!ids.length) return [];
    return ids.filter(id => idx.byId.has(id));
}

/**
 * Build the view-model for one character: exactly the real fields the card and
 * detail panel render. `index` is the character's index in characters[] — the
 * stable handle ST uses for selection (this_chid) in later phases. `idx` is the
 * per-pass tag index (buildTagIndex) shared across all cards so tag derivation
 * is O(N+T), not O(N×T).
 */
function toViewModel(char, index, idx) {
    const avatar = char.avatar;
    const s = statsFor(avatar);
    const msgCount = s ? (s.user_msg_count || 0) + (s.non_user_msg_count || 0) : 0;
    // date_last_chat: 0/undefined = never chatted. Keep the raw ms for sorting;
    // the UI formats/omits as needed.
    const lastUsed = s?.date_last_chat || 0;

    let avatarUrl = '';
    try {
        avatarUrl = (avatar && avatar !== 'none')
            ? ctx().getThumbnailUrl('avatar', avatar)
            : '';
    } catch { avatarUrl = ''; }

    return {
        index,
        avatar,
        name: char.name || '',
        // Bedazzler-only display subtitle (sidecar, keyed by avatar) — NOT a
        // real card field, so it never touches {{char}}. '' until the sidecar
        // resolves; the browser repaints on the sidecar-loaded callback.
        title: getCharTitle(avatar),
        fav: !!char.fav,
        creator: char.creator || char.data?.creator || '',
        tags: tagNamesFor(avatar, idx),
        // Colour-bearing chip records ({id,name,color,color2}) for the card +
        // detail chip renderers — same order as `tags`, but carrying ST's tag
        // colours so chips match ST exactly.
        tagChips: tagChipsFor(avatar, idx),
        // Stable tag ids (rename-safe) — the VIEWS section filters on these.
        tagIds: tagIdsFor(avatar, idx),
        // Reader-facing blurb (creator_notes), NOT the prompt `description`.
        // v2 fallback → v1 fallback. Truncation/markdown-softening happens in
        // the detail renderer (phase 3), not here.
        notes: char.data?.creator_notes || char.creatorcomment || '',
        version: char.data?.character_version || '',
        createDate: char.create_date || '',
        avatarUrl,
        msgCount,
        lastUsed,
    };
}

/**
 * Full list of character view-models, in characters[] order (index preserved).
 * Groups are excluded — ST keeps them in a separate `groups` array, and the
 * edit-drawer bridge doesn't handle them (PLAN open question: Groups view is a
 * later phase). This is the base the grid filters/sorts/searches over.
 */
export function getCharacterModels() {
    try {
        const chars = ctx().characters || [];
        // Build the tag index ONCE for the whole pass (see buildTagIndex) so
        // deriving every card's tags is O(N+T) instead of O(N×T).
        const idx = buildTagIndex();
        return chars.map((c, i) => toViewModel(c, i, idx));
    } catch (err) {
        console.warn('[BD] Char Browser: could not read characters[].', err);
        return [];
    }
}

// ============================================================
// Favorite write (card star toggle)
// ============================================================

/**
 * Persist a character's favorite flag WITHOUT selecting/loading the character.
 * Mirrors ST's own list-star path (BulkEditOverlay.CharacterContextMenu.favorite):
 * a POST to /api/characters/merge-attributes that sets BOTH the top-level `fav`
 * and `data.extensions.fav` (ST keeps them in lock-step; the classic list reads
 * the former, the card data reads the latter). Keyed by avatar.
 *
 * We also patch the live characters[] entry so the in-memory truth matches
 * immediately (getCharacterModels re-reads char.fav on the next paint) — ST's
 * own path does this via a full getCharacters() refetch, but we avoid that heavy
 * reload and just mutate the one record, matching what a subsequent CHARACTER_EDITED
 * event would produce.
 *
 * @param {string} avatar  the character's avatar filename (stable key)
 * @param {boolean} fav     desired favorite state
 * @returns {Promise<boolean>} true on success (persisted), false on failure
 */
export async function setFavorite(avatar, fav) {
    if (!avatar || avatar === 'none') return false;
    try {
        const c = ctx();
        const char = (c.characters || []).find(x => x.avatar === avatar);
        const body = {
            avatars: [avatar],
            data: {
                data: { extensions: { fav: !!fav } },
                fav: !!fav,
            },
        };
        const resp = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: c.getRequestHeaders(),
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            console.warn('[BD] Char Browser: fav write rejected.', resp.status);
            return false;
        }
        const result = await resp.json().catch(() => null);
        if (result?.failed?.includes(avatar)) return false;
        // Patch in-memory truth so the next model read reflects the change without
        // a full getCharacters() reload. Keep both fields in lock-step like ST.
        if (char) {
            char.fav = !!fav;
            char.data = char.data || {};
            char.data.extensions = char.data.extensions || {};
            char.data.extensions.fav = !!fav;
        }
        return true;
    } catch (err) {
        console.warn('[BD] Char Browser: fav write failed.', err);
        return false;
    }
}

// ============================================================
// Bulk favorite + duplicate (multi-select bulk-bar)
// ============================================================

/**
 * Favorite EVERY given character (set fav=true), matching the bulk-bar's
 * "Favorite" intent — a multi-select favorite is an assertion ("make these
 * favorites"), not a per-card toggle, so we set rather than flip (idempotent:
 * already-fav chars stay fav). Reuses the single-write path (setFavorite) which
 * persists via merge-attributes AND patches the live characters[] record, so no
 * getCharacters() reload is needed. The entire selection is sent as one native
 * bulk merge; returns the count that persisted OK. `avatars` is a list of raw
 * avatar filenames (our picked set).
 */
export async function favoriteCharacters(avatars) {
    const list = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
    if (!list.length) return 0;
    try {
        const c = ctx();
        const resp = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: c.getRequestHeaders(),
            body: JSON.stringify({
                avatars: list,
                data: { data: { extensions: { fav: true } }, fav: true },
            }),
        });
        if (!resp.ok) throw new Error(`favorite batch ${resp.status}`);
        const result = await resp.json();
        const failed = new Set(result?.failed || []);
        const updated = new Set(result?.updated || list.filter(avatar => !failed.has(avatar)));
        for (const char of c.characters || []) {
            if (!updated.has(char?.avatar)) continue;
            char.fav = true;
            char.data ||= {};
            char.data.extensions ||= {};
            char.data.extensions.fav = true;
        }
        return updated.size;
    } catch (err) {
        console.warn('[BD] Char Browser: bulk favorite failed.', err);
        return 0;
    }
}

/**
 * Duplicate ONE character by avatar. Mirrors ST's own
 * CharacterContextMenu.duplicate: POST /api/characters/duplicate with the
 * avatar_url, then emit CHARACTER_DUPLICATED so the rest of ST (and our own
 * live-sync) reacts. We do NOT reload characters[] here — the caller batches
 * duplicates and does a single getCharacters() afterward (ST's bulk path does
 * the same), which our grid refresh then re-reads. Returns true on success.
 *
 * NOTE: the new copy's avatar comes back as data.path; we forward it in the
 * event payload exactly like ST so any listener keying off the new avatar works.
 */
export async function duplicateCharacter(avatar) {
    if (!avatar || avatar === 'none') return false;
    try {
        const c = ctx();
        const resp = await fetch('/api/characters/duplicate', {
            method: 'POST',
            headers: c.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar }),
        });
        if (!resp.ok) {
            console.warn('[BD] Char Browser: duplicate rejected.', resp.status);
            return false;
        }
        // Best-effort event emit (same shape ST uses). Guarded: a missing event
        // surface must not fail the duplicate itself.
        try {
            const data = await resp.json();
            const et = c.eventTypes || c.event_types;
            if (c.eventSource?.emit && et?.CHARACTER_DUPLICATED) {
                await c.eventSource.emit(et.CHARACTER_DUPLICATED, { oldAvatar: avatar, newAvatar: data?.path });
            }
        } catch { /* event emit is best-effort */ }
        return true;
    } catch (err) {
        console.warn('[BD] Char Browser: duplicate failed.', err);
        return false;
    }
}

async function runWithConcurrency(items, limit, operation) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            try {
                results[index] = { status: 'fulfilled', value: await operation(items[index]) };
            } catch (reason) {
                results[index] = { status: 'rejected', reason };
            }
        }
    }

    const workerCount = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
}

/**
 * Duplicate a SET of characters by avatar with a small concurrency cap, then
 * reload ST's characters[] ONCE via getContext().getCharacters
 * so the new copies exist in the in-memory truth the grid re-reads. Returns the
 * count that duplicated OK. The caller repaints the grid afterward.
 */
export async function duplicateCharacters(avatars) {
    const list = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
    if (!list.length) return 0;
    const results = await runWithConcurrency(list, 4, duplicateCharacter);
    const ok = results.reduce((n, r) => n + (r.status === 'fulfilled' && r.value ? 1 : 0), 0);
    // One reload after the batch so characters[] holds the new copies (each
    // duplicate created a file server-side but didn't touch the array).
    try { await ctx().getCharacters?.(); } catch { /* refreshGrid re-reads anyway */ }
    return ok;
}

/**
 * Map a set of avatar filenames to their CURRENT indices in getContext()
 * .characters[]. ST's native bulk-tag popup (which we reuse for the browser's
 * Tag action) is keyed by these numeric indices, not avatars — so this bridges
 * our avatar-based selection to what the popup expects. Indices are resolved
 * live at call time (they shift as characters[] mutates), so this must run right
 * before the popup opens. Avatars that no longer resolve are dropped. Order
 * follows the input list.
 */
export function avatarsToCharacterIds(avatars) {
    try {
        const chars = ctx().characters || [];
        const idxByAvatar = new Map(chars.map((c, i) => [c.avatar, i]));
        return (Array.isArray(avatars) ? avatars : [])
            .map(av => idxByAvatar.get(av))
            .filter(i => i != null);
    } catch (err) {
        console.warn('[BD] Char Browser: avatar→id map failed.', err);
        return [];
    }
}

// ============================================================
// Per-character chat list (for the detail chat-picker)
// ============================================================

/**
 * Fetch a character's saved chats via ST's own endpoint (`/api/characters/chats`,
 * the same one getPastCharacterChats uses — that helper isn't on getContext()).
 * Keyed by avatar filename. Returns a normalized, newest-first list:
 *
 *   [{ file: 'Name 2024-1-2 ...',  // WITHOUT .jsonl — ready for openCharacterChat
 *      label: 'Name 2024-1-2 ...', // display name (same, minus extension)
 *      messages: 42,               // chat_items
 *      lastMes: 1700000000000 }]   // ms epoch (best-effort; may be 0)
 *
 * On any failure returns [] — the picker just shows "most recent" as the sole
 * implicit option (Open Chat still works via selectCharacterById). Never throws.
 *
 * NOTE: openCharacterChat() expects the file name WITHOUT the .jsonl extension
 * (ST strips it in its own past-chats click path), so we strip it here once.
 */
export async function getCharacterChats(avatar) {
    if (!avatar || avatar === 'none') return [];
    try {
        const c = ctx();
        const resp = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: c.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar }),
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        // Server returns [] for none, or { error: true } on trouble.
        if (!Array.isArray(data)) return [];

        const list = data
            .map(row => {
                const rawName = String(row.file_name || '');
                const file = rawName.replace(/\.jsonl$/i, '');
                if (!file) return null;
                const lastMes = parseLastMes(row.last_mes);
                return {
                    file,
                    label: file,
                    messages: Number(row.chat_items) || 0,
                    lastMes,
                };
            })
            .filter(Boolean);

        // Newest first. last_mes is our best signal; fall back to name compare
        // (ST's own list reverses a name sort, which trends newest-first for
        // timestamped chat names).
        list.sort((a, b) => (b.lastMes - a.lastMes) || b.label.localeCompare(a.label));
        return list;
    } catch (err) {
        console.warn('[BD] Char Browser: chat list fetch failed.', err);
        return [];
    }
}

/** last_mes comes as an ISO string or a number (ms). Parse to ms, else 0. */
function parseLastMes(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? 0 : t;
}

// ============================================================
// Search / sort (pure helpers over a model list)
// ============================================================

/**
 * Case-insensitive substring search across a character's NAME, CREATOR, and TAG
 * names. Empty/whitespace query returns the list unchanged. A card matches when
 * the query appears in the display name, the creator string, or ANY of its tag
 * names (`m.tags` — the full list, so a tag hidden from the display CHIPS still
 * matches here). This widens the original name-only match to the fields a user
 * is most likely to type; it stays a plain substring test (NOT ST's opt-in
 * Fuse.js fuzzy search), keeping the browser's filtering simple and predictable.
 */
export function filterBySearch(models, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => {
        if (m.name && m.name.toLowerCase().includes(q)) return true;
        if (m.creator && m.creator.toLowerCase().includes(q)) return true;
        const tags = Array.isArray(m.tags) ? m.tags : [];
        return tags.some(t => String(t).toLowerCase().includes(q));
    });
}

// ============================================================
// Left-nav filters (All / Favorites / Recents)
// ============================================================

// How many characters the "Recents" filter surfaces (most-recently-used slice).
// A soft cap so the view stays a genuine shortlist, not the whole library.
const RECENTS_LIMIT = 30;

// Nav filter definitions — the base set the PLAN calls for. `id` is the nav's
// selected key; `label`/`icon` drive the nav button; `apply` reduces the full
// model list to the filtered subset. Order here is the order shown in the nav.
//   all       → everything (identity)
//   favorites → char.fav is set
//   recents   → actually-chatted chars, most-recent first, capped
// Kept here (not in nav.js) so the data rules live with the rest of the model
// logic and nav.js stays pure UI.
export const NAV_FILTERS = [
    { id: 'all',       label: 'All Characters', icon: 'fa-solid fa-users',
      apply: (models) => models },
    { id: 'favorites', label: 'Favorites',      icon: 'fa-solid fa-star',
      apply: (models) => models.filter(m => m.fav) },
    { id: 'recents',   label: 'Recents',        icon: 'fa-solid fa-clock-rotate-left',
      apply: (models) => models
          .filter(m => m.lastUsed > 0)
          .sort((a, b) => b.lastUsed - a.lastUsed)
          .slice(0, RECENTS_LIMIT) },
];

/**
 * Apply a nav filter by id to the full model list. Unknown/empty id → 'all'
 * (identity), so a stale filter can never blank the grid. Returns a NEW array
 * (never mutates the input); note 'recents' imposes its own recency order, but
 * the grid re-sorts by the active Sort dropdown afterward, so that internal
 * order is just for the slice cut, not the final display order.
 */
export function filterByNav(models, navId) {
    const f = NAV_FILTERS.find(x => x.id === navId) || NAV_FILTERS[0];
    return f.apply(models || []);
}

// ============================================================
// VIEWS facets (Tags / Folders) — derived from ST's tags + tagMap
// ============================================================

// ST models both plain tags and "folders" as entries in getContext().tags. A
// tag is a FOLDER when its folder_type is set to something other than the
// default 'NONE' (the built-in values are OPEN / CLOSED — see tags.js
// TAG_FOLDER_TYPES). Everything else is a plain tag. Membership for both lives
// in the SAME tagMap (avatar → [tagId]) the cards already read, so the whole
// VIEWS section is derivable from data we already have — no new endpoints.
const FOLDER_DEFAULT_TYPE = 'NONE';

/** True if a tag object represents a folder (has a non-default folder_type). */
function isFolderTag(tag) {
    return !!tag && tag.folder_type != null && tag.folder_type !== FOLDER_DEFAULT_TYPE;
}

/**
 * Derive the VIEWS facets from the given model list: which tags and which
 * folders exist, each with a live member count (how many of THESE models carry
 * it) and its display color. Counts are computed over the passed models so they
 * honour whatever scope the caller cares about (we pass the full list, so they
 * reflect the whole library).
 *
 * Returns { tags: Facet[], folders: Facet[], tagTotal } where
 *   Facet = { id, name, count, color } and tagTotal is the count of ALL plain
 *   (non-folder) tags including zero-member ones — the Tag Hub lists those too
 *   (it's the management surface), so the nav's "Tags" badge uses tagTotal to
 *   match the hub's own "All Tags N".
 * Both lists are sorted by name (A–Z, case-insensitive). Facets with a zero
 * count are DROPPED — an empty tag/folder isn't a useful filter and just clutters
 * the nav (it can't show anything). Guarded: any failure yields empty lists so
 * the nav simply omits the VIEWS section rather than breaking.
 */
export function getViewFacets(models) {
    try {
        const c = ctx();
        const tags = Array.isArray(c.tags) ? c.tags : [];
        if (!tags.length) return { tags: [], folders: [], tagTotal: 0 };

        // Tally membership across the given models by tag id.
        const counts = new Map();
        for (const m of (models || [])) {
            for (const id of (m.tagIds || [])) {
                counts.set(id, (counts.get(id) || 0) + 1);
            }
        }

        const tagFacets = [];
        const folderFacets = [];
        let tagTotal = 0;
        for (const t of tags) {
            const isFolder = isFolderTag(t);
            if (!isFolder) tagTotal++;
            const count = counts.get(t.id) || 0;
            if (!count) continue; // skip empty facets
            const facet = {
                id: t.id,
                name: t.name || '(unnamed)',
                count,
                color: t.color || '',
            };
            (isFolder ? folderFacets : tagFacets).push(facet);
        }

        const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        tagFacets.sort(byName);
        folderFacets.sort(byName);
        return { tags: tagFacets, folders: folderFacets, tagTotal };
    } catch (err) {
        console.warn('[BD] Char Browser: could not derive view facets.', err);
        return { tags: [], folders: [], tagTotal: 0 };
    }
}

/**
 * Filter models to those carrying a given tag/folder id (same mechanism for
 * both — a folder is just a tag). Returns a NEW array; unknown id yields [].
 * Membership is matched on the model's stable tagIds, so a renamed tag still
 * filters correctly.
 */
export function filterByTag(models, tagId) {
    if (!tagId) return [];
    return (models || []).filter(m => (m.tagIds || []).includes(tagId));
}

// ============================================================
// Tag Hub — tag meta (custom data), tag CRUD, and hub view data
// ============================================================

// ── Page size (shared user setting) ─────────────────────────
// The browser's "N / page" choice. Persisted in the shared sidecar's
// charBrowser section so it survives reloads, and shared by the character grid
// AND the Tag Hub (both read getCharBrowserPageSize). Stored as a plain number;
// readers clamp to the allowed option set themselves, so an out-of-range stored
// value can't break pagination. Before the sidecar resolves, reads fall back to
// the default (the browser re-reads on the sidecar-loaded callback).

/** Read the persisted page size (falls back to `dflt` when unset/invalid). */
export function getCharBrowserPageSize(dflt = 24) {
    try {
        const v = charBrowserSection().pageSize;
        return (typeof v === 'number' && v > 0) ? v : dflt;
    } catch {
        return dflt;
    }
}

/** Persist the page size (via the shared sidecar's debounced save). No-op on a
 *  non-positive value so a bad call can't corrupt the stored setting. */
export function setCharBrowserPageSize(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return;
    try {
        charBrowserSection().pageSize = v;
        sidecarScheduleSave();
    } catch (err) {
        console.warn('[BD] Char Browser: page-size save failed.', err);
    }
}

// Tags the user has chosen to HIDE from the Tag Hub view — organizational noise
// (theme markers, etc.) that isn't a browsing category. Stored as a list of tag
// NAMES, matched case-insensitively against the live tags, so the choice reads
// naturally in the settings popup and doesn't depend on volatile tag ids. Lives
// in the shared sidecar's charBrowser section.
// Shape: charBrowser.hiddenTags = ["theme:dark", "wip", ...]

/** The user's hidden-tag name list, exactly as stored. Always an array. */
export function getHiddenTagNames() {
    try {
        const v = charBrowserSection().hiddenTags;
        return Array.isArray(v) ? v.slice() : [];
    } catch {
        return [];
    }
}

/** The hidden tag names as a lowercased Set for fast case-insensitive lookup. */
export function getHiddenTagSet() {
    return new Set(getHiddenTagNames().map(n => String(n).toLowerCase()));
}

/**
 * Persist the hidden-tag list. Normalises the input: trims each entry, drops
 * blanks, and de-dupes case-insensitively (first spelling wins). An empty result
 * DELETES the key so the section never keeps an empty array. Saved via the
 * shared sidecar's debounced save.
 */
export function setHiddenTagNames(list) {
    try {
        const seen = new Set();
        const clean = [];
        for (const raw of (Array.isArray(list) ? list : [])) {
            const name = String(raw || '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            clean.push(name);
        }
        const sec = charBrowserSection();
        if (clean.length) sec.hiddenTags = clean;
        else delete sec.hiddenTags;
        sidecarScheduleSave();
    } catch (err) {
        console.warn('[BD] Char Browser: hidden-tags save failed.', err);
    }
}

// ST tags have NO description or "related tags" concept — those are ours.
// Custom tag data lives in the shared sidecar's charBrowser section (NOT on the
// ST tag object: ST persists its tags in settings.json and could strip unknown
// fields on its own save paths, so we don't gamble on schema tolerance; and NOT
// in extension settings anymore — it moved to the sidecar so all Bedazzler
// custom metadata shares one file).
// Shape: charBrowser.tagMeta = { [tagId]: { description, related } }
// where `related` is an array of tag IDs (rename-safe, like everything else).

/** The live tag-meta map from the sidecar section (created on first access). */
function tagMetaStore() {
    const sec = charBrowserSection();
    if (!sec.tagMeta || typeof sec.tagMeta !== 'object') {
        sec.tagMeta = {};
    }
    return sec.tagMeta;
}

/** Custom meta for one tag: { description, related: [tagId] }. Always returns
 *  a well-formed object (empty defaults), never null. */
export function getTagMeta(tagId) {
    const m = tagMetaStore()[tagId];
    return {
        description: (m && typeof m.description === 'string') ? m.description : '',
        related: (m && Array.isArray(m.related)) ? m.related.slice() : [],
    };
}

/**
 * Persist custom meta for one tag. `related` is sanitised to ids that resolve
 * to a real, OTHER tag (no self-reference, no ghosts). Empty meta (no
 * description, no related) DELETES the entry so the store doesn't accumulate
 * husks. Saved via the shared sidecar's debounced save.
 */
export function setTagMeta(tagId, meta) {
    if (!tagId) return;
    try {
        const store = tagMetaStore();
        const description = String(meta?.description || '').trim();
        const known = new Set((ctx().tags || []).map(t => t.id));
        const related = (Array.isArray(meta?.related) ? meta.related : [])
            .filter(id => id && id !== tagId && known.has(id));
        if (!description && !related.length) {
            delete store[tagId];
        } else {
            store[tagId] = { description, related };
        }
        sidecarScheduleSave();
    } catch (err) {
        console.warn('[BD] Char Browser: tag meta save failed.', err);
    }
}

/** The raw ST tag object by id, or null. */
export function getTagById(tagId) {
    try {
        return (ctx().tags || []).find(t => t.id === tagId) || null;
    } catch { return null; }
}

/**
 * Create a new ST tag with the given name. Mirrors ST's own newTag() shape
 * exactly (tags.js — id/name/folder_type/filter_state/sort_order/
 * is_hidden_on_character_card/color/color2/create_date) and pushes it onto the
 * LIVE getContext().tags array (same reference tags.js exports), then saves.
 * Optional `opts.color` (background) / `opts.color2` (text) seed the new tag's
 * ST colour fields. Duplicate names (case-insensitive, like ST's getTag lookup)
 * are refused — returns { ok:false, reason }; success returns { ok:true, tag }.
 */
export function createTag(name, opts = {}) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { ok: false, reason: 'Name is empty.' };
    try {
        const c = ctx();
        const tags = c.tags;
        if (!Array.isArray(tags)) return { ok: false, reason: 'Tag list unavailable.' };
        const clash = tags.find(t => (t.name || '').toLowerCase() === trimmed.toLowerCase());
        if (clash) return { ok: false, reason: `A tag named "${clash.name}" already exists.` };
        const tag = {
            id: c.uuidv4(),
            name: trimmed,
            folder_type: FOLDER_DEFAULT_TYPE,
            filter_state: 'UNDEFINED',
            sort_order: Math.max(0, ...tags.map(t => t.sort_order || 0)) + 1,
            is_hidden_on_character_card: false,
            color: String(opts.color || ''),
            color2: String(opts.color2 || ''),
            create_date: Date.now(),
        };
        tags.push(tag);
        c.saveSettingsDebounced();
        return { ok: true, tag };
    } catch (err) {
        console.warn('[BD] Char Browser: tag create failed.', err);
        return { ok: false, reason: 'Tag create failed.' };
    }
}

/**
 * Update an ST tag's own fields (name / color / color2) in place on the live
 * tag object and save. Only the fields present in `patch` are touched, so a
 * caller can change just the text colour without disturbing the background.
 * color = background, color2 = text (ST's own semantics). A rename to a name
 * another tag already holds (case-insensitive) is refused. Writing here IS the
 * sync with ST — it's the same tag object ST reads for its native chips and tag
 * manager. Returns { ok } / { ok:false, reason } like createTag.
 */
export function updateTag(tagId, patch) {
    try {
        const c = ctx();
        const tag = (c.tags || []).find(t => t.id === tagId);
        if (!tag) return { ok: false, reason: 'Tag not found.' };
        if (patch && 'name' in patch) {
            const trimmed = String(patch.name || '').trim();
            if (!trimmed) return { ok: false, reason: 'Name is empty.' };
            const clash = (c.tags || []).find(t => t.id !== tagId
                && (t.name || '').toLowerCase() === trimmed.toLowerCase());
            if (clash) return { ok: false, reason: `A tag named "${clash.name}" already exists.` };
            tag.name = trimmed;
        }
        if (patch && 'color' in patch) {
            tag.color = String(patch.color || '');
        }
        if (patch && 'color2' in patch) {
            tag.color2 = String(patch.color2 || '');
        }
        c.saveSettingsDebounced();
        return { ok: true };
    } catch (err) {
        console.warn('[BD] Char Browser: tag update failed.', err);
        return { ok: false, reason: 'Tag update failed.' };
    }
}

/**
 * List every character as an assignment candidate for the tag editor's
 * character picker. Returns [{ name, avatar, dupe }] sorted A–Z (then by
 * avatar for stable ordering among same-named chars). `dupe` is true when more
 * than one character shares this display name — the picker shows the avatar
 * filename in parentheses for those so they can be told apart (same convention
 * as Chat Design's assignment list). Keyed by `avatar` (unique) for writes.
 * Guarded → [] on failure.
 */
export function getAssignableCharacters() {
    try {
        const c = ctx();
        const chars = Array.isArray(c.characters) ? c.characters : [];
        const nameCount = new Map();
        for (const ch of chars) {
            if (!ch?.avatar || !ch?.name) continue;
            const k = ch.name.toLowerCase();
            nameCount.set(k, (nameCount.get(k) || 0) + 1);
        }
        return chars
            .filter(ch => ch?.avatar && ch?.name)
            .map(ch => ({
                name: ch.name,
                avatar: ch.avatar,
                dupe: (nameCount.get(ch.name.toLowerCase()) || 0) > 1,
            }))
            .sort((a, b) => a.name.localeCompare(b.name) || a.avatar.localeCompare(b.avatar));
    } catch (err) {
        console.warn('[BD] Char Browser: assignable characters read failed.', err);
        return [];
    }
}

/**
 * Assign a tag to a set of characters by pushing its id into ST's tagMap
 * (avatar → [tagId]) for each avatar, de-duped, then saving through ST's own
 * debounced path. Mirrors how ST itself stores tag membership; no new endpoint.
 * `avatars` is a list of raw avatar filenames (the picker's checkbox values).
 * A no-op (empty list) still returns ok. Guarded → { ok:false, reason }.
 */
export function assignTagToCharacters(tagId, avatars) {
    try {
        if (!tagId) return { ok: false, reason: 'No tag.' };
        const list = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
        if (!list.length) return { ok: true };
        const c = ctx();
        if (!c.tagMap || typeof c.tagMap !== 'object') return { ok: false, reason: 'Tag map unavailable.' };
        for (const avatar of list) {
            const cur = Array.isArray(c.tagMap[avatar]) ? c.tagMap[avatar] : [];
            if (!cur.includes(tagId)) cur.push(tagId);
            c.tagMap[avatar] = cur;
        }
        c.saveSettingsDebounced();
        return { ok: true };
    } catch (err) {
        console.warn('[BD] Char Browser: tag assignment failed.', err);
        return { ok: false, reason: 'Assignment failed.' };
    }
}

/**
 * Remove a tag from a set of characters — the inverse of assignTagToCharacters.
 * Filters the tag's id out of each avatar's tagMap entry (leaving an empty array
 * rather than deleting the key, matching how ST leaves untagged characters), then
 * saves through ST's own debounced path. Used by the tag editor's character
 * picker in EDIT mode when a previously-assigned character is unchecked. An empty
 * list is a no-op that still returns ok. Guarded → { ok:false, reason }.
 */
export function unassignTagFromCharacters(tagId, avatars) {
    try {
        if (!tagId) return { ok: false, reason: 'No tag.' };
        const list = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
        if (!list.length) return { ok: true };
        const c = ctx();
        if (!c.tagMap || typeof c.tagMap !== 'object') return { ok: false, reason: 'Tag map unavailable.' };
        for (const avatar of list) {
            const cur = Array.isArray(c.tagMap[avatar]) ? c.tagMap[avatar] : [];
            c.tagMap[avatar] = cur.filter(id => id !== tagId);
        }
        c.saveSettingsDebounced();
        return { ok: true };
    } catch (err) {
        console.warn('[BD] Char Browser: tag unassignment failed.', err);
        return { ok: false, reason: 'Unassignment failed.' };
    }
}

/**
 * Derive the Tag Hub's view data from the model list: one record per PLAIN tag
 * (folders are excluded — the hub is the Tags view; folders keep their nav
 * group), each carrying its live member models sorted most-messages-first (the
 * hub's "top characters" order — also what picks the card's hero image, i.e.
 * members[0]). Unlike getViewFacets, zero-member tags are KEPT: the hub is
 * also the tag-MANAGEMENT surface, so a freshly created (still unassigned) tag
 * must be visible and editable there.
 *
 * Returns [{ id, name, color, color2, count, members }] sorted A–Z (callers
 * re-sort by the hub's own sort control). color = background, color2 = text
 * (ST's own semantics). Guarded → [] on failure.
 */
export function getTagHubData(models) {
    try {
        const c = ctx();
        const tags = Array.isArray(c.tags) ? c.tags : [];
        const byMsg = (a, b) => (b.msgCount - a.msgCount) || a.name.localeCompare(b.name);
        const out = [];
        for (const t of tags) {
            if (isFolderTag(t)) continue;
            const members = (models || [])
                .filter(m => (m.tagIds || []).includes(t.id))
                .sort(byMsg);
            out.push({
                id: t.id,
                name: t.name || '(unnamed)',
                color: t.color || '',
                color2: t.color2 || '',
                count: members.length,
                members,
            });
        }
        out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        return out;
    } catch (err) {
        console.warn('[BD] Char Browser: tag hub data failed.', err);
        return [];
    }
}

// Sort comparators keyed by the mockup's "Sort:" dropdown options. Default is
// Last Used (desc) per the PLAN. "Recent" and "Last Used" are the same field.
const SORTERS = {
    last_used: (a, b) => b.lastUsed - a.lastUsed,
    name_asc: (a, b) => a.name.localeCompare(b.name),
    name_desc: (a, b) => b.name.localeCompare(a.name),
    most_messages: (a, b) => b.msgCount - a.msgCount,
    newest: (a, b) => String(b.createDate).localeCompare(String(a.createDate)),
    oldest: (a, b) => String(a.createDate).localeCompare(String(b.createDate)),
};

export function sortModels(models, key = 'last_used') {
    const cmp = SORTERS[key] || SORTERS.last_used;
    // Copy before sort so we never mutate the caller's array.
    return [...models].sort(cmp);
}

/**
 * The default detail selection per PLAN: most-recently-used character, else the
 * first in the list. Operates on an already-sorted-or-not model array; picks by
 * lastUsed regardless of current sort so the panel is stable. Returns null for
 * an empty list.
 */
export function defaultSelection(models) {
    if (!models.length) return null;
    let best = models[0];
    for (const m of models) {
        if ((m.lastUsed || 0) > (best.lastUsed || 0)) best = m;
    }
    return best;
}

// ============================================================
// GROUPS — data layer for the Groups Hub (parallel to the tag data above)
// ============================================================
//
// ST keeps groups in a SEPARATE `groups` array (getContext().groups), not in
// characters[] — which is why getCharacterModels() excludes them. A group is
// { id, name, members:[avatar], avatar_url, fav, chats:[chatId], chat_id,
// date_last_chat, disabled_members, activation_strategy, generation_mode }.
// Group tag membership lives in the SAME tagMap the characters use, keyed by
// the group's id (ST's tag_map is keyed by entity — avatar OR group id), so the
// existing tag index/chip helpers work on a group id unchanged.
//
// The Groups Hub is a BROWSE + basic-manage surface (open / favorite / delete;
// member edits redirect to the character's own edit drawer). Full group editing
// (rename / member CRUD / strategy) stays with ST's native panel — see the TODO.

/** How many groups exist (for the nav's "Groups" badge). Guarded → 0. */
export function getGroupCount() {
    try {
        return (ctx().groups || []).length;
    } catch {
        return 0;
    }
}

/** True if a group avatar_url is a real, usable image (uploaded/collage data or
 *  a user-file path) rather than an empty/placeholder value. Mirrors ST's own
 *  isValidImageUrl gate in group-chats.js. */
function isValidGroupImage(url) {
    if (!url || typeof url !== 'string') return false;
    return url.startsWith('data:') || url.startsWith('user') || url.startsWith('/user');
}

/** Thumbnail URL for one member avatar (same path the cards use). '' on failure
 *  or a 'none' avatar. */
function memberThumb(avatar) {
    try {
        return (avatar && avatar !== 'none') ? ctx().getThumbnailUrl('avatar', avatar) : '';
    } catch {
        return '';
    }
}

/**
 * Build the view-model for one group. `idx` is the shared tag index
 * (buildTagIndex), `charByAvatar` maps a member avatar → { ch, i } so member
 * rows carry the character's real name + its characters[] index (the stable
 * handle the Edit redirect needs to open the expanded EDIT drawer). Members
 * whose avatar no longer resolves to a character are kept but flagged `missing`
 * (ST shows them as "user-slash"); they don't count toward memberCount.
 */
function toGroupViewModel(g, idx, charByAvatar) {
    const memberAvatars = Array.isArray(g.members) ? g.members : [];
    const members = memberAvatars.map((av) => {
        const hit = charByAvatar.get(av);
        return {
            avatar: av,
            name: hit?.ch?.name || av,
            index: hit ? hit.i : null,
            avatarUrl: memberThumb(av),
            missing: !hit,
        };
    });
    const valid = members.filter(m => !m.missing);
    return {
        id: g.id,
        name: g.name || '',
        fav: !!g.fav,
        members,
        memberCount: valid.length,
        // Collage source: first up-to-4 resolvable member thumbnails (ST's own
        // group avatar is a 1–4 tile collage of member avatars). A group can
        // also carry a custom uploaded avatar (avatar_url) that takes priority.
        collage: valid.slice(0, 4).map(m => m.avatarUrl).filter(Boolean),
        customAvatarUrl: isValidGroupImage(g.avatar_url) ? g.avatar_url : '',
        // Tags ride the shared tagMap keyed by group id — same helpers as chars.
        tags: tagNamesFor(g.id, idx),
        tagChips: tagChipsFor(g.id, idx),
        tagIds: tagIdsFor(g.id, idx),
        lastUsed: g.date_last_chat || 0,
        chats: Array.isArray(g.chats) ? g.chats.slice() : [],
        currentChat: g.chat_id || '',
    };
}

/**
 * Full list of group view-models, in getContext().groups order. The Groups Hub
 * filters/sorts/searches over this (mirrors getCharacterModels for characters).
 * Guarded → [] so a groups read failure just yields an empty hub, never a throw.
 */
export function getGroupModels() {
    try {
        const c = ctx();
        const groups = Array.isArray(c.groups) ? c.groups : [];
        if (!groups.length) return [];
        const idx = buildTagIndex();
        const chars = Array.isArray(c.characters) ? c.characters : [];
        const charByAvatar = new Map(chars.map((ch, i) => [ch.avatar, { ch, i }]));
        return groups.map(g => toGroupViewModel(g, idx, charByAvatar));
    } catch (err) {
        console.warn('[BD] Char Browser: could not read groups[].', err);
        return [];
    }
}

// Group sort comparators — the Groups Hub's own sort control. "Members" and
// "Last used" are the group-meaningful axes; name A–Z/Z–A round it out. No
// message-count sort (groups don't track a per-group message total the way the
// character stats store does per avatar).
const GROUP_SORTERS = {
    name_asc: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    name_desc: (a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }),
    most_members: (a, b) => (b.memberCount - a.memberCount) || a.name.localeCompare(b.name),
    last_used: (a, b) => (b.lastUsed - a.lastUsed) || a.name.localeCompare(b.name),
};

/** Sort a group model list by key (copy, never mutates). Unknown key → A–Z. */
export function sortGroups(models, key = 'name_asc') {
    const cmp = GROUP_SORTERS[key] || GROUP_SORTERS.name_asc;
    return [...models].sort(cmp);
}

/**
 * Toggle/set a group's favorite flag and persist via ST's group-edit endpoint
 * (/api/groups/edit takes the WHOLE group object — the same body ST's own _save
 * posts). Patches the live groups[] entry first so the next getGroupModels read
 * reflects it immediately, and rolls the flag back if the write is rejected.
 * @returns {Promise<boolean>} true on success.
 */
export async function setGroupFavorite(groupId, fav) {
    if (!groupId) return false;
    try {
        const c = ctx();
        const group = (c.groups || []).find(g => g.id === groupId);
        if (!group) return false;
        const prev = !!group.fav;
        group.fav = !!fav; // optimistic in-memory patch
        const resp = await fetch('/api/groups/edit', {
            method: 'POST',
            headers: c.getRequestHeaders(),
            body: JSON.stringify(group),
        });
        if (!resp.ok) {
            group.fav = prev; // roll back
            console.warn('[BD] Char Browser: group fav write rejected.', resp.status);
            return false;
        }
        return true;
    } catch (err) {
        console.warn('[BD] Char Browser: group fav write failed.', err);
        return false;
    }
}

/**
 * Delete a group by id via ST's endpoint, then reconcile the in-memory truth:
 * splice it out of the live groups[] (so the hub drops the card immediately) and
 * drop its tagMap entry, then reload ST's characters/groups so any downstream
 * listener stays consistent. We do NOT call ST's own deleteGroup() — that path
 * also tears down the ACTIVE chat UI (clearChat/printMessages/select_rm_info),
 * which is wrong here: no group is loaded behind the browser overlay. A plain
 * endpoint call + local reconcile avoids those side effects.
 * @returns {Promise<boolean>} true on success.
 */
export async function deleteGroupById(groupId) {
    if (!groupId) return false;
    try {
        const c = ctx();
        const resp = await fetch('/api/groups/delete', {
            method: 'POST',
            headers: c.getRequestHeaders(),
            body: JSON.stringify({ id: groupId }),
        });
        if (!resp.ok) {
            console.warn('[BD] Char Browser: group delete rejected.', resp.status);
            return false;
        }
        // Local reconcile: remove from the live array + tagMap so the hub
        // re-derives without the deleted group even before the reload lands.
        try {
            const gi = (c.groups || []).findIndex(g => g.id === groupId);
            if (gi >= 0) c.groups.splice(gi, 1);
        } catch { /* best-effort */ }
        try { if (c.tagMap) delete c.tagMap[groupId]; } catch { /* best-effort */ }
        try { await c.getCharacters?.(); } catch { /* the local splice already covers the hub */ }
        return true;
    } catch (err) {
        console.warn('[BD] Char Browser: group delete failed.', err);
        return false;
    }
}

/**
 * A group's saved chats for the detail chat-picker. group.chats is a plain
 * array of chat ids (humanized-datetime strings); group.chat_id is the active
 * one. We DON'T fetch per-chat info here (that'd be one round-trip per chat for
 * a count we don't strictly need) — we return the ids as-is, current-first, each
 * ready to hand to ST's openGroupChat(groupId, chatId):
 *   [{ file, label, current }]
 * "Open Chat" with no pick opens the current chat (openGroupById), matching the
 * character picker's "most recent" default.
 */
export function getGroupChats(model) {
    const chats = Array.isArray(model?.chats) ? model.chats : [];
    const current = model?.currentChat || '';
    const list = chats.map(id => ({
        file: id,
        label: String(id),
        current: id === current,
    }));
    list.sort((a, b) => (b.current - a.current) || b.label.localeCompare(a.label));
    return list;
}
