// src/charBrowser/grid.js
// Character Browser — center grid. Build-fresh cards from charData's models,
// with name search, sort, pagination, and click-to-select (which populates the
// detail panel via an injected callback — clicking a card does NOT open a chat;
// that's the KEY difference from ST's native list, per the PLAN).
//
// Card anatomy (honest v1, every field real):
//   avatar image · star (fav) · name · first-N tag chips ·
//   footer: message-count (left) · "by {creator}" + "{last-used} ago" (right)
//
// This module owns view STATE (query, sort, page, selected avatar) and the DOM
// under #wl-cb-grid + #wl-cb-pagination. The shell wires the search input and
// sort control to setQuery/setSort. Selection is reported outward through the
// onSelect callback so the detail panel (phase 3) can render — grid.js knows
// nothing about the detail DOM.

import {
    ensureStats,
    getCharacterModels,
    filterBySearch,
    filterByNav,
    filterByTag,
    getViewFacets,
    sortModels,
    defaultSelection,
    setFavorite,
    NAV_FILTERS,
    getCharBrowserPageSize,
    setCharBrowserPageSize,
    getGroupCount,
} from './charData.js';
import { setCounts, setFacets } from './nav.js';

const log = () => {};

// Page size is a USER SETTING now (mockup's "24 / page" dropdown). It's shared
// across the whole browser: the character grid AND the Tag Hub read the same
// value (both import getPageSize from here), so setting it in either surface
// applies everywhere and PERSISTS across opens (charData stores it in our
// extension settings). PAGE_SIZE_OPTIONS drives the dropdown; DEFAULT_PAGE_SIZE
// is the fallback (matches the mockup's 24).
export const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];
const DEFAULT_PAGE_SIZE = 24;
const MAX_MEASURED_TAG_CHIPS = 12;

// Shared page-size state (module-level so the Tag Hub sees the same value).
// Seeded from the persisted setting on load; setPageSize writes it back through
// charData. A change re-paginates whichever surface repaints next; the caller
// that mutates it is responsible for repainting the active surface(s).
let pageSize = clampPageSize(getCharBrowserPageSize(DEFAULT_PAGE_SIZE));

/** Snap an arbitrary number to the nearest allowed option (defends against a
 *  stale/hand-edited stored value). Falls back to DEFAULT_PAGE_SIZE. */
function clampPageSize(n) {
    const v = Number(n);
    if (PAGE_SIZE_OPTIONS.includes(v)) return v;
    return DEFAULT_PAGE_SIZE;
}

/** The page size currently in effect (shared with the Tag Hub). */
export function getPageSize() {
    return pageSize;
}

/**
 * Change the shared page size. Snaps to an allowed option, persists it via
 * charData, and — because the total page count shifts — RESETS the grid to page
 * 1 and repaints. The Tag Hub, if it's the active surface, repaints itself off
 * the same value (the shell routes the dropdown to whichever surface is live).
 * Returns the value actually applied.
 */
export function setPageSize(n) {
    const v = clampPageSize(n);
    if (v === pageSize) return v;
    pageSize = v;
    setCharBrowserPageSize(v);
    state.page = 1;
    focusedAvatar = null; // explicit page-size change → drop the Back-arrow focus
    render();
    return v;
}

/**
 * Re-read the persisted page size from storage into the module state and
 * repaint if it changed. The module `pageSize` is seeded once at import (before
 * any drawer opens, so before the shared sidecar has resolved). When the sidecar
 * finishes loading — carrying a stored value that differs from the import-time
 * fallback — the shell calls this so the grid adopts the real setting without a
 * manual page-size change. No persist here (we're reading, not setting); resets
 * to page 1 only when the value actually shifts. Safe to call when the grid
 * isn't mounted (guards on gridEl inside render()).
 */
export function resyncPageSize() {
    const v = clampPageSize(getCharBrowserPageSize(DEFAULT_PAGE_SIZE));
    if (v === pageSize) return;
    pageSize = v;
    // Preserve a pending focus (edit-drawer Back arrow): the page a character
    // sits on shifts with page size, so recompute rather than snapping to 1.
    state.page = focusedAvatar ? pageForAvatar(focusedAvatar) : 1;
    render();
}

// View state (reset on each init/takeover). `filter` is the left-nav filter id
// (all/favorites/recents); it's applied BEFORE search+sort in currentView().
//
// SORT IS PER-FILTER. Each filter starts at its own default (FILTER_DEFAULT_SORT):
// All → A–Z (a stable library index), Favorites/Recents → Most Recent (those
// views are inherently about recency). Picking a sort from the dropdown changes
// it for the ACTIVE filter only and is remembered independently — so you can
// leave All at A–Z while Recents remembers Most Messages. Switching filters
// restores that filter's own remembered sort; the shell resyncs the dropdown
// via getSort(). All choices reset to defaults on a fresh open.
const FILTER_DEFAULT_SORT = {
    all: 'name_asc',
    favorites: 'last_used',
    recents: 'last_used',
};
const DEFAULT_FILTER = 'all';

// A tag/folder filter id is the facet id prefixed with 'tag:' / 'folder:'. The
// base filters (all/favorites/recents) are bare ids. These prefixes let the one
// `state.filter` string carry either kind, and the per-filter sort map key off
// the whole string so each tag/folder remembers its own sort independently.
function isFacetFilter(filter) {
    return typeof filter === 'string' && (filter.startsWith('tag:') || filter.startsWith('folder:'));
}

/** Split a facet filter id into { kind, id }, or null if it isn't one. */
function parseFacetFilter(filter) {
    if (!isFacetFilter(filter)) return null;
    const i = filter.indexOf(':');
    return { kind: filter.slice(0, i), id: filter.slice(i + 1) };
}

function defaultSortFor(filter) {
    // Tag/folder views default to A–Z, like All — they're browse-by-facet lists
    // where an alphabetical index is the most useful default.
    if (isFacetFilter(filter)) return 'name_asc';
    return FILTER_DEFAULT_SORT[filter] || 'name_asc';
}

/** Build a fresh {filterId: sortKey} map seeded with each filter's default. */
function freshSortByFilter() {
    return { ...FILTER_DEFAULT_SORT };
}

let state = {
    query: '',
    filter: DEFAULT_FILTER,
    // Per-filter sort memory. Read via sortByFilter[state.filter]; the active
    // sort is always derived from this + the current filter (see currentSort()).
    sortByFilter: freshSortByFilter(),
    page: 1,
    selectedAvatar: null,
};

/** The sort key in effect for the active filter. Facet (tag/folder) filters
 *  aren't pre-seeded in the map — they fall back to their default (A–Z) until
 *  the user picks a sort for them, which setSort() then records per-facet. */
function currentSort() {
    return state.sortByFilter[state.filter] || defaultSortFor(state.filter);
}

let gridEl = null;
let pagerEl = null;
let emptyEl = null;
let onSelect = null; // (model) => void  — injected by the shell
let models = [];     // full model list (unfiltered), refreshed from charData
// Avatar the grid was asked to FOCUS on this open (edit drawer's Back arrow).
// Kept so a page-size resync that fires after open (when the sidecar lands)
// re-lands on this character's page instead of snapping to page 1.
let focusedAvatar = null;

// ── Multi-select state ──────────────────────────────────────
// When mselMode is on, a card CLICK toggles its membership in `picked` (a Set
// of avatars) instead of selecting it for the detail panel. `onMselChange` is
// an injected callback the shell uses to keep the bulk-bar's count/enabled
// state live. Shift-click range fill mirrors the WI v2 list pattern:
// rangeAnchor is the avatar of the last card toggled WITHOUT shift, and
// mselShiftNext bridges the (modifier-less) selection call from the click that
// recorded whether Shift was down.
let mselMode = false;
let picked = new Set();
let rangeAnchor = null;
let mselShiftNext = false;
let onMselChange = null; // (count:number) => void — injected by the shell
// Right-click on a card → the shell opens a per-character context menu (Tag /
// Duplicate / Persona / Delete). Injected like onSelect so grid.js stays pure
// selection state and knows nothing about the menu DOM. (model, event) => void.
let onCardContextMenu = null;
// Shift-click on a card while another is selected (out of msel mode) asks the
// shell to enter multi-select and range-fill. Injected so grid.js stays pure
// selection state and the shell keeps sole ownership of the mode transition
// (bulk-bar reveal + button lit). (fromAvatar, toAvatar) => void.
let onRequestRangeSelect = null;
let gridLifecycleGeneration = 0;
let gridRefreshGeneration = 0;

/** True when multi-select mode is active. */
export function isMselMode() {
    return mselMode;
}

/** The set of picked avatars (live reference; callers must not mutate). */
export function getPicked() {
    return picked;
}

/** Clear the picked set AND the range anchor together — an anchor with nothing
 *  picked would let the next shift-click span from a card the user can't
 *  remember ticking. */
function clearPicked() {
    picked.clear();
    rangeAnchor = null;
}

/**
 * Clear the selection WITHOUT leaving multi-select mode — backs the bulk-bar's
 * "Deselect All". Unlike setMselMode(false), the pick affordance stays up so the
 * user can immediately start a new selection. Repaints the picked classes in
 * place (scroll preserved) and notifies the shell (count → 0) so the bulk-bar's
 * count/enabled state updates. No-op when nothing is picked.
 */
export function deselectAll() {
    if (!picked.size) return;
    clearPicked();
    if (gridEl) {
        gridEl.querySelectorAll('.wl-cb-card.is-picked')
            .forEach(c => c.classList.remove('is-picked'));
    }
    onMselChange?.(0);
}

/**
 * Enter or leave multi-select mode. Leaving always clears the selection (and
 * anchor). Repaints so cards pick up / drop the checkbox affordance and the
 * .msel-mode grid class. Notifies the shell of the new count (0 on exit).
 */
export function setMselMode(on) {
    const next = !!on;
    if (next === mselMode) return;
    mselMode = next;
    if (!mselMode) clearPicked();
    if (gridEl) gridEl.classList.toggle('msel-mode', mselMode);
    render();
    onMselChange?.(picked.size);
}

// ============================================================
// Init / teardown
// ============================================================

/**
 * Initialise the grid into the shell's grid + pagination containers. Fetches
 * stats once, reads the character models, picks the default selection (most
 * recent, else first), fires onSelect for it, and paints page 1.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.gridEl        #wl-cb-grid
 * @param {HTMLElement} opts.pagerEl       #wl-cb-pagination
 * @param {HTMLElement} opts.emptyEl       #wl-cb-grid-empty (hidden once populated)
 * @param {(model:object)=>void} opts.onSelect  detail-panel callback
 * @param {(count:number)=>void} [opts.onMselChange]  bulk-bar count callback
 * @param {(model:object, event:MouseEvent)=>void} [opts.onCardContextMenu]  right-click menu
 * @param {(fromAvatar:string, toAvatar:string)=>void} [opts.onRequestRangeSelect]  shift-click range entry
 * @param {string} [opts.focusAvatar]  open on the PAGE holding this character (and
 *        select it) instead of page 1 — used by the edit drawer's Back arrow so
 *        the user lands where they left off.
 */
export async function initGrid(opts) {
    const lifecycleGeneration = ++gridLifecycleGeneration;
    gridRefreshGeneration++;
    const targetGrid = opts.gridEl;
    gridEl = opts.gridEl;
    pagerEl = opts.pagerEl;
    emptyEl = opts.emptyEl || null;
    onSelect = opts.onSelect || null;
    onMselChange = opts.onMselChange || null;
    onCardContextMenu = opts.onCardContextMenu || null;
    onRequestRangeSelect = opts.onRequestRangeSelect || null;

    // Fresh open → multi-select starts OFF with an empty selection.
    mselMode = false;
    clearPicked();
    mselShiftNext = false;

    state = {
        query: '',
        filter: DEFAULT_FILTER,
        sortByFilter: freshSortByFilter(),
        page: 1,
        selectedAvatar: null,
    };

    // Force a fresh stats fetch on every open. Stats live in ST's stats.json,
    // which can change between opens (a chat sent elsewhere, or a manual
    // "Refresh Stat File" from the debug menu). Caching across opens meant a
    // reopened browser showed stale/empty counts until a full page reload — so
    // we re-fetch each open. (Cheap: one POST to /api/stats/get.)
    await ensureStats(true);
    if (lifecycleGeneration !== gridLifecycleGeneration || gridEl !== targetGrid) return;
    models = getCharacterModels();
    pushNavCounts();

    // Selection + starting page. Normally the default selection (most recent,
    // else first) on page 1. But if the caller asked to FOCUS a character
    // (opts.focusAvatar — the edit drawer's Back arrow), select THAT character
    // and open on the page it actually lands on under the current filter/sort,
    // so the user returns to where they were instead of page 1.
    focusedAvatar = opts.focusAvatar || null;
    const focus = focusedAvatar
        ? models.find(m => m.avatar === focusedAvatar)
        : null;
    if (focus) {
        state.selectedAvatar = focus.avatar;
        state.page = pageForAvatar(focus.avatar);
        onSelect?.(focus);
    } else {
        const def = defaultSelection(models);
        if (def) {
            state.selectedAvatar = def.avatar;
            onSelect?.(def);
        }
    }

    render();

    // When focusing, bring the selected card into view (it's on the right page
    // now, but may be below the fold in a tall grid).
    if (focus) scrollSelectedIntoView();
}

/**
 * The 1-based page number that a given avatar lands on under the CURRENT view
 * (active filter + search + sort + page size). Mirrors currentView()'s pipeline
 * but returns the page index instead of a slice. Falls back to page 1 when the
 * character isn't in the current scope (e.g. it's filtered out) so we never aim
 * at a non-existent page.
 */
function pageForAvatar(avatar) {
    const scoped = scopeByFilter();
    const filtered = sortModels(filterBySearch(scoped, state.query), currentSort());
    const idx = filtered.findIndex(m => m.avatar === avatar);
    if (idx < 0) return 1;
    return Math.floor(idx / pageSize) + 1;
}

/** Scroll the currently-selected card into view within the grid (no-op if the
 *  grid or the card isn't present). Centered so it's comfortably visible. */
function scrollSelectedIntoView() {
    if (!gridEl || !state.selectedAvatar) return;
    const el = gridEl.querySelector(`.wl-cb-card[data-avatar="${cssEscape(state.selectedAvatar)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
}

/**
 * Recompute per-filter counts over the FULL model list and push them to the
 * nav's badges, AND recompute the VIEWS facets (Folders/Tags) and push those.
 * Each base count is that filter's applied length (favorites = fav count,
 * recents = capped recency slice length, all = total). Facets carry their own
 * per-tag member counts. Called on load and after any change that shifts
 * membership (fav toggle, refresh, edit/delete/import via live sync).
 */
function pushNavCounts() {
    const counts = {};
    for (const f of NAV_FILTERS) counts[f.id] = filterByNav(models, f.id).length;
    setCounts(counts);
    // VIEWS facets are derived from the same full model list (tag membership +
    // folder flags). The Groups badge isn't model-derived (groups live in a
    // separate array), so fold its count in here alongside the tag/folder facets.
    const facets = getViewFacets(models);
    facets.groupTotal = getGroupCount();
    setFacets(facets);
}

export function teardownGrid() {
    gridLifecycleGeneration++;
    gridRefreshGeneration++;
    gridEl = pagerEl = emptyEl = onSelect = null;
    onMselChange = null;
    onCardContextMenu = null;
    onRequestRangeSelect = null;
    mselMode = false;
    clearPicked();
    mselShiftNext = false;
    models = [];
}

// ============================================================
// External control (wired by the shell)
// ============================================================

export function setQuery(q) {
    state.query = q || '';
    state.page = 1; // new filter → back to first page
    focusedAvatar = null; // user is browsing now — drop the Back-arrow focus
    render();
}

/** The sort key currently in effect (for the active filter). The shell reads
 *  this after setFilter to keep the sort <select> visually in sync. */
export function getSort() {
    return currentSort();
}

/**
 * User picked a sort from the dropdown. Applies to the ACTIVE filter only and
 * is remembered independently per filter, so switching away and back restores
 * this choice while other filters keep theirs. (All reset on a fresh open.)
 */
export function setSort(key) {
    state.sortByFilter[state.filter] = key || defaultSortFor(state.filter);
    state.page = 1;
    focusedAvatar = null; // user is browsing now — drop the Back-arrow focus
    render();
}

/**
 * Set the active left-nav filter (all/favorites/recents). Resets to page 1 and
 * repaints. Selection is intentionally NOT changed here: if the selected card
 * falls outside the new filter it simply isn't visible, but the detail panel
 * keeps showing it (matches the mockup, where the right panel is sticky). The
 * grid highlights the selection again if the user switches back to a filter
 * that includes it.
 *
 * SORT: each filter carries its own remembered sort (its default until the user
 * changes it), so switching filters restores that filter's sort. The caller
 * (shell) reads getSort() after this to resync the dropdown's displayed value.
 */
export function setFilter(navId) {
    state.filter = navId || DEFAULT_FILTER;
    state.page = 1;
    focusedAvatar = null; // user is browsing now — drop the Back-arrow focus
    render();
}

/** Re-read models from ST (e.g. after an import/edit) and repaint. If the
 *  selected character still exists, re-fire onSelect with its FRESH model so the
 *  detail panel reflects edits (name/tags/stats) without a manual reselect. If
 *  it's gone (deleted), re-default the selection. */
export async function refreshGrid(refetchStats = false) {
    if (!gridEl) return;
    const lifecycleGeneration = gridLifecycleGeneration;
    const refreshGeneration = ++gridRefreshGeneration;
    const targetGrid = gridEl;
    if (refetchStats) await ensureStats(true);
    if (lifecycleGeneration !== gridLifecycleGeneration || refreshGeneration !== gridRefreshGeneration || gridEl !== targetGrid) return;
    models = getCharacterModels();
    pushNavCounts();
    // Prune any picked avatars that no longer exist (deleted elsewhere / bulk
    // delete) so the bulk-bar count stays honest. If the anchor vanished, drop
    // it too. Notify the shell if the count changed.
    if (picked.size) {
        const live = new Set(models.map(m => m.avatar));
        let changed = false;
        for (const av of [...picked]) {
            if (!live.has(av)) { picked.delete(av); changed = true; }
        }
        if (rangeAnchor && !live.has(rangeAnchor)) rangeAnchor = null;
        if (changed) onMselChange?.(picked.size);
    }
    const stillHere = models.find(m => m.avatar === state.selectedAvatar);
    if (stillHere) {
        // Selection survived — but the model object was rebuilt from scratch by
        // getCharacterModels(), so the detail panel is holding a stale reference.
        // Re-report the fresh one to repaint it with any edited fields.
        onSelect?.(stillHere);
    } else {
        const def = defaultSelection(models);
        state.selectedAvatar = def?.avatar || null;
        if (def) onSelect?.(def);
    }
    render();
}

/** The grid's current FULL (unfiltered) model list — the stats-joined truth the
 *  Tag Hub derives its per-tag member lists from, so both surfaces always agree
 *  on counts/msg totals without a second stats fetch. Live reference; callers
 *  must not mutate. */
export function getModels() {
    return models;
}

/**
 * Re-fire onSelect for the current selection (or the default when none/gone) so
 * the detail panel repaints with a CHARACTER. Used by the shell when leaving
 * the Tag Hub: the hub wrote tag content into the shared detail region, and
 * returning to any character view must hand the panel back to the selected
 * character without waiting for a card click.
 */
export function reassertSelection() {
    if (!models.length) return;
    const cur = models.find(m => m.avatar === state.selectedAvatar);
    if (cur) {
        onSelect?.(cur);
        return;
    }
    const def = defaultSelection(models);
    state.selectedAvatar = def?.avatar || null;
    if (def) onSelect?.(def);
}

// ============================================================
// Render
// ============================================================

/** Scope the full model list by the active filter — a base nav filter
 *  (all/favorites/recents) OR a facet filter (tag:<id> / folder:<id>). Facets
 *  route to filterByTag (folders are tags too); everything else to filterByNav,
 *  which itself falls back to 'all' on an unknown id so the grid never blanks. */
function scopeByFilter() {
    const facet = parseFacetFilter(state.filter);
    if (facet) return filterByTag(models, facet.id);
    return filterByNav(models, state.filter);
}

/** Compute the filtered+sorted list and the current page's slice. Pipeline:
 *  filter (base nav OR tag/folder facet) → name-search → sort → paginate. */
function currentView() {
    const scoped = scopeByFilter();
    const filtered = sortModels(filterBySearch(scoped, state.query), currentSort());
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(state.page, pages);
    const start = (page - 1) * pageSize;
    const slice = filtered.slice(start, start + pageSize);
    return { filtered, total, pages, page, start, slice };
}

function render() {
    if (!gridEl) return;
    const view = currentView();
    state.page = view.page;

    // Empty-state placeholder toggles with results.
    if (emptyEl) emptyEl.style.display = view.total ? 'none' : '';

    gridEl.innerHTML = '';
    for (const m of view.slice) {
        gridEl.appendChild(buildCard(m));
    }
    // Cards are now in the (visible) DOM → measure each tag row and trim it to
    // what fits on one line, with an accurate "+N". Synchronous so it settles
    // before paint (no flash of the full chip list).
    fitAllTagRows();
    renderPager(view);
}

/** Re-fit every card's tag row against the current layout. */
function fitAllTagRows() {
    if (!gridEl) return;
    const rows = [...gridEl.querySelectorAll('.wl-cb-card-tags')];

    // Reset every row (writes), measure every row (reads), then trim every row
    // (writes). Keeping these phases global avoids forcing a new layout per card.
    for (const row of rows) {
        row.querySelectorAll('.wl-cb-chip-more').forEach(node => node.remove());
        for (const chip of row.children) chip.style.display = '';
    }

    const measurements = rows.map(row => {
        const chips = [...row.children];
        const total = Number(row.dataset.totalTags) || chips.length;
        if (!total || row.clientWidth === 0) return null;

        const rowWidth = row.clientWidth;
        const rowLeft = row.offsetLeft;
        const firstTop = chips[0].offsetTop;
        let fit = 0;
        let lastEdge = 0;
        for (const chip of chips) {
            if (chip.offsetTop !== firstTop) break;
            fit++;
            lastEdge = chip.offsetLeft - rowLeft + chip.offsetWidth;
        }
        if (fit === total) return { row, chips, total, visible: total };

        const badgeEstimate = 30 + String(total - fit + 1).length * 9;
        let visible = fit;
        if (rowWidth - lastEdge < badgeEstimate && visible > 1) visible--;
        return { row, chips, total, visible };
    });

    for (const measurement of measurements) {
        if (!measurement || measurement.visible === measurement.total) continue;
        const { row, chips, total, visible } = measurement;
        for (let i = visible; i < chips.length; i++) chips[i].style.display = 'none';
        const more = document.createElement('span');
        more.className = 'wl-cb-chip wl-cb-chip-more';
        more.textContent = `+${total - visible}`;
        row.appendChild(more);
    }
}

/**
 * Public re-fit hook. The shell calls this when the grid becomes visible again
 * after being hidden (e.g. leaving the Tag Hub), because a render that happened
 * while the grid was display:none measured at width 0 and skipped the "+N" trim.
 */
export function refitTags() {
    fitAllTagRows();
}

// Re-measure tag rows on viewport resize (column widths shift with the grid),
// debounced to one pass per animation frame. No-ops while the grid is torn down
// (gridEl null) or hidden, so the always-on listener is cheap.
let _refitQueued = false;
window.addEventListener('resize', () => {
    if (_refitQueued) return;
    _refitQueued = true;
    requestAnimationFrame(() => { _refitQueued = false; fitAllTagRows(); });
});

/** Human "last used" — relative days for recency, else omitted (0 = never). */
function lastUsedLabel(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 0) return '';
    const day = 86400000;
    const days = Math.floor(diff / day);
    if (days <= 0) return 'today';
    if (days === 1) return '1d ago';
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

// ============================================================
// Card
// ============================================================

/**
 * Build one card element. DOM-created (not innerHTML) so character-controlled
 * text (name, creator, tags) is set via textContent and can't inject markup.
 * Clicking the card selects it (populates the detail panel); clicking the star
 * toggles the favorite flag (persisted via charData.setFavorite) without
 * selecting the card.
 */
function buildCard(m) {
    const card = document.createElement('div');
    card.className = 'wl-cb-card';
    card.dataset.avatar = m.avatar;
    if (m.avatar === state.selectedAvatar) card.classList.add('selected');
    // In multi-select mode a picked card reads as ticked (checkbox + ring).
    if (mselMode && picked.has(m.avatar)) card.classList.add('is-picked');

    // Media (avatar) — object-fit cover; a neutral block when no avatar.
    const media = document.createElement('div');
    media.className = 'wl-cb-card-media';
    if (m.avatarUrl) {
        const img = document.createElement('img');
        img.src = m.avatarUrl;
        img.alt = '';
        img.loading = 'lazy';
        media.appendChild(img);
    } else {
        media.classList.add('wl-cb-card-noimg');
    }

    // Star (fav) — filled when fav. Clicking toggles the favorite flag (persisted
    // via setFavorite) without selecting the card. stopPropagation keeps the card's
    // own click (select) from firing too.
    // NOTE: must be an <i> (not a <div>) so Font Awesome's weight rules apply —
    // fa-star is the same glyph for solid/regular and only font-weight (900 vs
    // 400) distinguishes filled from outline; on a <div> the weight doesn't take
    // and a favorited star renders as a mere outline.
    const star = document.createElement('i');
    applyStarState(star, m.fav);
    star.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFav(m, star);
    });
    media.appendChild(star);

    // Multi-select checkbox — top-left over the media, shown only in msel mode
    // (CSS gates visibility on the grid's .msel-mode class). Non-interactive on
    // its own: the whole card is the hit target, so the box just reflects state.
    const check = document.createElement('span');
    check.className = 'wl-cb-card-check';
    check.innerHTML = '<i class="fa-solid fa-check"></i>';
    media.appendChild(check);

    card.appendChild(media);
    card.appendChild(buildCardBody(m));

    // Record Shift on the click BEFORE the (modifier-less) handler runs, so a
    // shift-click can range-fill (same bridge pattern as the WI v2 list).
    card.addEventListener('mousedown', (e) => { mselShiftNext = e.shiftKey; });
    card.addEventListener('click', () => {
        if (mselMode) { togglePick(m); return; }
        // Shift-click while a card is already selected (and NOT yet in msel
        // mode) is a shortcut into multi-select: auto-enter pick mode and range-
        // select from the currently-selected card to this one — so the user can
        // start a range without first toggling the msel button. Needs a distinct
        // anchor (shift-clicking the already-selected card is just a normal
        // select). The shell owns the mode transition (bulk-bar + button chrome),
        // then calls back into pickRange(); if no handler is wired, fall through
        // to a plain select so the click still does something.
        if (mselShiftNext && state.selectedAvatar && state.selectedAvatar !== m.avatar
            && onRequestRangeSelect) {
            mselShiftNext = false;
            onRequestRangeSelect(state.selectedAvatar, m.avatar);
            return;
        }
        selectCard(m);
    });
    // Right-click → per-character context menu (Tag / Duplicate / Persona /
    // Delete), handed to the shell. SUPPRESSED in multi-select mode: there the
    // bulk bar is the action surface, and a single-char menu over a multi-pick
    // selection is confusing. Out of msel mode we preventDefault + open the menu
    // (only when a handler is wired, so a right-click still does something
    // sensible otherwise).
    card.addEventListener('contextmenu', (e) => {
        if (mselMode || !onCardContextMenu) return; // native menu in msel mode
        e.preventDefault();
        onCardContextMenu(m, e);
    });
    return card;
}

/** Paint a star element for a given fav state (class + tooltip). Shared by the
 *  initial build and the post-toggle repaint so they can't drift. */
function applyStarState(star, fav) {
    star.className = 'wl-cb-card-star ' + (fav ? 'fa-solid fa-star is-fav' : 'fa-regular fa-star');
    star.title = fav ? 'Favorite' : 'Not a favorite';
}

/**
 * Toggle a character's favorite flag from the card star. Optimistic: flip the
 * model + star immediately (snappy), persist via setFavorite, and roll back the
 * visual if the write fails. On success we refresh the nav counts and — if the
 * Favorites filter is currently active — re-render so an un-favorited card drops
 * out of view (and the pager/counts stay honest). The `m.fav` field is the live
 * model object shared with the full `models` list, so mutating it keeps the grid
 * state consistent without a full re-read.
 */
async function toggleFav(m, star) {
    const next = !m.fav;
    m.fav = next;                 // optimistic model flip
    applyStarState(star, next);   // optimistic visual flip

    const ok = await setFavorite(m.avatar, next);
    if (!ok) {
        // Roll back on failure.
        m.fav = !next;
        applyStarState(star, m.fav);
        return;
    }

    // Counts shifted (favorites total changed) → repaint badges.
    pushNavCounts();
    // If we're viewing Favorites, a now-unfavorited card must leave the grid;
    // a full render also fixes pagination/empty-state. Otherwise the in-place
    // star flip is enough and we avoid the churn.
    if (state.filter === 'favorites') render();
}

/**
 * Apply a tag's ST colours to a chip element, matching ST's own semantics
 * (tags.js: background-color = tag.color, color = tag.color2). Each is applied
 * ONLY when non-empty, so an uncoloured tag inherits the theme's default chip
 * look (the CSS baseline) instead of being forced to a hardcoded colour. Shared
 * by the card chips (grid) and the detail-panel chips (detail.js) so the two
 * render identically. Accepts a {color, color2} record.
 */
export function applyChipColor(chip, t) {
    if (!t) return;
    if (t.color) {
        chip.style.backgroundColor = t.color;
        // A custom background replaces the translucent theme tint — drop the
        // baseline so the chosen colour is exact (ST sets a solid background too).
        chip.classList.add('wl-cb-chip-colored');
    }
    if (t.color2) chip.style.color = t.color2;
}

/** Body: name, tag chips (first-N + "+N"), and the footer stat row. */
function buildCardBody(m) {
    const body = document.createElement('div');
    body.className = 'wl-cb-card-body';

    const name = document.createElement('div');
    name.className = 'wl-cb-card-name';
    name.textContent = m.name;
    name.title = m.name;
    body.appendChild(name);

    // Bedazzler "title" (subtitle): the descriptive epithet under the name,
    // dimmer + smaller. Rendered only when set; textContent so it can't inject.
    if (m.title) {
        const title = document.createElement('div');
        title.className = 'wl-cb-card-title';
        title.textContent = m.title;
        title.title = m.title;
        body.appendChild(title);
    }

    if (m.tagChips.length) {
        const tagRow = document.createElement('div');
        tagRow.className = 'wl-cb-card-tags';
        tagRow.dataset.totalTags = String(m.tagChips.length);
        // A card can only display a handful of chips on one line. Cap the
        // measurement candidates while retaining the full count for the +N.
        for (const t of m.tagChips.slice(0, MAX_MEASURED_TAG_CHIPS)) {
            const chip = document.createElement('span');
            chip.className = 'wl-cb-chip';
            chip.textContent = t.name;
            applyChipColor(chip, t);
            tagRow.appendChild(chip);
        }
        body.appendChild(tagRow);
    }

    // Footer (concept layout): message count (left) · creator (middle,
    // truncates) · last-used (right).
    const foot = document.createElement('div');
    foot.className = 'wl-cb-card-foot';

    const msg = document.createElement('span');
    msg.className = 'wl-cb-card-msg';
    msg.innerHTML = '<i class="fa-regular fa-comment"></i>';
    const msgText = document.createElement('span');
    msgText.textContent = formatCount(m.msgCount);
    msg.appendChild(msgText);
    foot.appendChild(msg);

    const creator = document.createElement('span');
    creator.className = 'wl-cb-card-creator';
    if (m.creator) {
        creator.textContent = `by ${m.creator}`;
        creator.title = m.creator;
    }
    foot.appendChild(creator);

    const used = document.createElement('span');
    used.className = 'wl-cb-card-used';
    used.textContent = lastUsedLabel(m.lastUsed);
    foot.appendChild(used);

    body.appendChild(foot);
    return body;
}

/** Compact count: 2312 → "2.3k". */
function formatCount(n) {
    if (!n) return '0';
    if (n < 1000) return String(n);
    if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`.replace('.0k', 'k');
    return `${(n / 1000000).toFixed(1)}M`;
}

// ============================================================
// Selection
// ============================================================

/**
 * Select a card: mark it visually and report outward (detail panel). Does NOT
 * open a chat — that's the Open Chat action in the detail panel (phase 3). We
 * update the .selected class in place rather than re-rendering the whole grid,
 * so scroll position and card DOM are preserved.
 */
function selectCard(m) {
    if (state.selectedAvatar === m.avatar) {
        // Re-report anyway (cheap) so a second click still shows the panel, but
        // skip the DOM class churn.
        onSelect?.(m);
        return;
    }
    state.selectedAvatar = m.avatar;
    if (gridEl) {
        gridEl.querySelectorAll('.wl-cb-card.selected').forEach(c => c.classList.remove('selected'));
        const el = gridEl.querySelector(`.wl-cb-card[data-avatar="${cssEscape(m.avatar)}"]`);
        el?.classList.add('selected');
    }
    onSelect?.(m);
}

/**
 * Toggle one card's membership in the multi-select set. Plain click flips just
 * this card; Shift-click fills the range from the last plain-toggled card
 * (rangeAnchor) to this one, inclusive, setting every card between them to this
 * card's NEW state — file-manager style. Range order follows the live rendered
 * card order (so it respects the current sort/filter/page), and a missing
 * anchor (scrolled off the page, or none yet) falls back to a plain toggle.
 * Either way, this card becomes the new anchor so the range end can be redragged.
 */
function togglePick(m) {
    const shift = mselShiftNext;
    mselShiftNext = false;

    const want = !picked.has(m.avatar); // this card's new state drives the fill

    if (shift && rangeAnchor && rangeAnchor !== m.avatar && gridEl) {
        // Live rendered order of the CURRENT page's cards.
        const order = [...gridEl.querySelectorAll('.wl-cb-card')].map(c => c.dataset.avatar);
        const a = order.indexOf(rangeAnchor);
        const b = order.indexOf(m.avatar);
        if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) {
                if (want) picked.add(order[i]);
                else picked.delete(order[i]);
            }
        } else {
            // Anchor not on this page → plain toggle fallback.
            if (want) picked.add(m.avatar); else picked.delete(m.avatar);
        }
    } else {
        if (want) picked.add(m.avatar); else picked.delete(m.avatar);
    }

    rangeAnchor = m.avatar; // last click (plain OR range) re-anchors

    // Repaint just the affected cards' picked class in place (no full re-render,
    // to preserve scroll position). Every visible card re-reads the set.
    if (gridEl) {
        gridEl.querySelectorAll('.wl-cb-card').forEach(c => {
            c.classList.toggle('is-picked', picked.has(c.dataset.avatar));
        });
    }
    onMselChange?.(picked.size);
}

/**
 * Select the inclusive range of cards between two avatars (in current rendered
 * order) into the picked set. Used by the shell's shift-click-into-msel shortcut
 * AFTER it has entered multi-select mode, so the range the user visually spanned
 * — from the previously-selected card to the shift-clicked one — becomes the
 * initial pick. `toAvatar` becomes the new range anchor so a follow-up shift-
 * click re-drags the far end, exactly like a range built the normal way. Both
 * ends must be on the current page (the shortcut only fires for a shift-click on
 * a visible card against a visible selection); a missing end degrades to picking
 * whichever end resolves. No-op outside msel mode or without a grid.
 */
export function pickRange(fromAvatar, toAvatar) {
    if (!mselMode || !gridEl) return;
    const order = [...gridEl.querySelectorAll('.wl-cb-card')].map(c => c.dataset.avatar);
    const a = order.indexOf(fromAvatar);
    const b = order.indexOf(toAvatar);
    if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) picked.add(order[i]);
    } else {
        // Degrade: pick whichever end we can resolve.
        if (a !== -1) picked.add(fromAvatar);
        if (b !== -1) picked.add(toAvatar);
    }
    rangeAnchor = toAvatar; // shift-clicked card anchors the next range drag

    gridEl.querySelectorAll('.wl-cb-card').forEach(c => {
        c.classList.toggle('is-picked', picked.has(c.dataset.avatar));
    });
    onMselChange?.(picked.size);
}

/** Minimal CSS.escape fallback for attribute selectors (avatar filenames can
 *  contain dots/spaces). Uses native CSS.escape when present. */
function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/["\\\]]/g, '\\$&');
}

// ============================================================
// Pagination
// ============================================================

/**
 * Render the grid's pager into pagerEl using the shared buildPager (below), so
 * the character grid and the Tag Hub get the identical control. Paging here
 * mutates the grid's own page state and repaints.
 */
function renderPager(view) {
    if (!pagerEl) return;
    pagerEl.innerHTML = '';
    if (!view.total) return;
    pagerEl.appendChild(buildPager({
        page: view.page,
        pages: view.pages,
        total: view.total,
        start: view.start,
        count: view.slice.length,
        onPage: (p) => { state.page = p; focusedAvatar = null; render(); },
        onPageSize: (n) => { setPageSize(n); }, // resets to page 1 + repaints
    }));
}

/**
 * Build the mockup's pagination control as a detached fragment-in-a-div:
 *
 *   ‹  1 … 4 [5] 6 … 52  ›            12–24 of 1248   [ 24 / page ▾ ]
 *   └ arrows ┘ └ numbered pages ┘     └── info ──┘    └ per-page ┘
 *
 * SHARED by the character grid and the Tag Hub — both hand in their own paging
 * state + callbacks, so the two surfaces look and behave identically and read
 * the same page-size setting. The numbered window always shows page 1 and the
 * last page, the current page ±1, and collapses the gaps with a non-clickable
 * "…". The per-page <select> is seeded from PAGE_SIZE_OPTIONS and the live
 * getPageSize(); changing it calls onPageSize (which persists + re-paginates).
 *
 * @param {object} o
 * @param {number} o.page   current 1-based page
 * @param {number} o.pages  total page count (>=1)
 * @param {number} o.total  total item count
 * @param {number} o.start  0-based index of the first item on this page
 * @param {number} o.count  items shown on this page (for the "X–Y" range)
 * @param {(p:number)=>void} o.onPage       jump to page p
 * @param {(n:number)=>void} o.onPageSize   change items-per-page
 */
export function buildPager(o) {
    const bar = document.createElement('div');
    bar.className = 'wl-cb-pager';

    // Left cluster: prev arrow · numbered pages · next arrow.
    const nav = document.createElement('div');
    nav.className = 'wl-cb-pager-nav';

    nav.appendChild(pageButton('‹', 'wl-cb-page-arrow', o.page > 1, () => o.onPage(o.page - 1), 'Previous page'));

    for (const item of pageWindow(o.page, o.pages)) {
        if (item === '…') {
            const gap = document.createElement('span');
            gap.className = 'wl-cb-page-gap';
            gap.textContent = '…';
            nav.appendChild(gap);
        } else {
            const isCur = item === o.page;
            const b = pageButton(String(item), 'wl-cb-page-num-btn', !isCur, () => o.onPage(item));
            if (isCur) b.classList.add('is-current');
            nav.appendChild(b);
        }
    }

    nav.appendChild(pageButton('›', 'wl-cb-page-arrow', o.page < o.pages, () => o.onPage(o.page + 1), 'Next page'));
    bar.appendChild(nav);

    // Right cluster: "X–Y of N" info + the per-page select.
    const right = document.createElement('div');
    right.className = 'wl-cb-pager-right';

    const info = document.createElement('span');
    info.className = 'wl-cb-page-info';
    const from = o.total ? o.start + 1 : 0;
    const to = o.start + o.count;
    info.textContent = `${from}–${to} of ${o.total}`;
    right.appendChild(info);

    const sizeSel = document.createElement('select');
    sizeSel.className = 'wl-cb-page-size';
    sizeSel.title = 'Items per page';
    for (const n of PAGE_SIZE_OPTIONS) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = `${n} / page`;
        sizeSel.appendChild(opt);
    }
    sizeSel.value = String(getPageSize());
    sizeSel.addEventListener('change', () => o.onPageSize(Number(sizeSel.value)));
    right.appendChild(sizeSel);

    bar.appendChild(right);
    return bar;
}

/**
 * The set of page tokens to render between the arrows: always first + last, the
 * current page and its neighbours, and '…' placeholders for the collapsed runs.
 * Small page counts (<= 7) render in full with no ellipsis.
 */
function pageWindow(page, pages) {
    if (pages <= 7) {
        return Array.from({ length: pages }, (_, i) => i + 1);
    }
    const out = [];
    const push = (v) => { if (out[out.length - 1] !== v) out.push(v); };
    // Neighbours of the current page (clamped inside the interior).
    const lo = Math.max(2, page - 1);
    const hi = Math.min(pages - 1, page + 1);
    push(1);
    if (lo > 2) push('…');
    for (let p = lo; p <= hi; p++) push(p);
    if (hi < pages - 1) push('…');
    push(pages);
    return out;
}

/** A pager button (arrow or numbered). `enabled=false` renders it disabled
 *  (used for the current page and the end-stop arrows). */
function pageButton(label, cls, enabled, onClick, title) {
    const b = document.createElement('button');
    b.className = 'wl-cb-page-btn ' + cls;
    b.textContent = label;
    b.disabled = !enabled;
    if (title) b.title = title;
    if (enabled) b.addEventListener('click', onClick);
    return b;
}
