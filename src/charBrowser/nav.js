// src/charBrowser/nav.js
// Character Browser — left-hub nav. Renders the LIBRARY filter list (All /
// Favorites / Recents) plus a VIEWS section (Folders / Tags) into #wl-cb-nav,
// owns which filter is active, and reports changes outward through an injected
// callback so the grid can re-filter. Pure UI + selection state: the actual
// filter *rules* live in charData (NAV_FILTERS / filterByTag), so this module
// never touches ST or the model list directly — it just paints the buttons the
// data layer describes and echoes the chosen id.
//
// Filter ids: base filters are bare ('all'/'favorites'/'recents'); VIEWS facets
// are prefixed ('folder:<tagId>' / 'tag:<tagId>'). One activeId carries either
// kind, so selecting a tag deselects a base filter and vice-versa — exactly one
// active thing at a time.
//
// Counts (e.g. "Favorites 12") are optional and pushed in by the grid after it
// knows the full model list — nav.js doesn't compute them, keeping it decoupled
// from the data layer. The VIEWS facets (with their own counts) are pushed in
// the same way via setFacets().

import { NAV_FILTERS } from './charData.js';

const log = () => {};

let navEl = null;
let onFilter = null;          // (navId) => void — injected by the shell
let activeId = 'all';         // current filter id (base id OR tag:<id>/folder:<id>)
let buttons = new Map();      // id → { el, countEl }
let viewsEl = null;           // the VIEWS section container (rebuilt on facet updates)
let facetCollapsed = { folders: false, tags: false }; // per-group collapse memory

// ============================================================
// Init / teardown
// ============================================================

/**
 * Build the nav into the shell's #wl-cb-nav container. Clears the phase-1
 * scaffold placeholder and paints one button per NAV_FILTERS entry. Selects
 * 'all' by default (does NOT fire onFilter for the default — the grid already
 * starts unfiltered, so firing would be a redundant re-render on open).
 *
 * @param {object} opts
 * @param {HTMLElement} opts.navEl        #wl-cb-nav
 * @param {(navId:string)=>void} opts.onFilter  grid filter callback
 */
export function initNav(opts) {
    navEl = opts.navEl;
    onFilter = opts.onFilter || null;
    activeId = 'all';
    buttons = new Map();
    viewsEl = null;
    facetCollapsed = { folders: false, tags: false };
    if (!navEl) return;

    navEl.innerHTML = '';

    // Section: base filters. A small heading keeps the nav readable and sits
    // above the VIEWS section (Folders/Tags) appended below.
    const section = document.createElement('div');
    section.className = 'wl-cb-nav-section';
    const heading = document.createElement('div');
    heading.className = 'wl-cb-nav-heading';
    heading.textContent = 'Library';
    section.appendChild(heading);

    for (const f of NAV_FILTERS) {
        section.appendChild(buildNavItem(f));
    }
    navEl.appendChild(section);

    // VIEWS section container — its contents (Folders/Tags groups) are painted
    // by setFacets() once the grid has derived the facet list. Empty until then;
    // stays empty (and hidden) if there are no tags/folders.
    viewsEl = document.createElement('div');
    viewsEl.className = 'wl-cb-nav-section wl-cb-nav-views';
    viewsEl.style.display = 'none';
    navEl.appendChild(viewsEl);

    setActive('all');
    log('nav initialised');
}

export function teardownNav() {
    navEl = onFilter = null;
    buttons = new Map();
    activeId = 'all';
    viewsEl = null;
}

// ============================================================
// Item build
// ============================================================

/** One nav filter button: icon · label · (right-aligned) count badge. */
function buildNavItem(f) {
    const btn = document.createElement('button');
    btn.className = 'wl-cb-nav-item';
    btn.dataset.navId = f.id;

    const icon = document.createElement('i');
    icon.className = f.icon;
    btn.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'wl-cb-nav-label';
    label.textContent = f.label;
    btn.appendChild(label);

    const count = document.createElement('span');
    count.className = 'wl-cb-nav-count';
    // Populated later via setCounts; blank until then so we don't show a stale 0.
    btn.appendChild(count);

    btn.addEventListener('click', () => choose(f.id));

    buttons.set(f.id, { el: btn, countEl: count });
    return btn;
}

// ============================================================
// Selection
// ============================================================

/** Handle a click: no-op if already active, else switch + report outward.
 *  Shared by base filter buttons and VIEWS facet rows (they pass a prefixed
 *  id like 'tag:5'). */
function choose(navId) {
    if (navId === activeId) return;
    setActive(navId);
    onFilter?.(navId);
}

/**
 * Mark one item active (visual only) — used by choose() and the initial paint.
 * Clears is-active across BOTH base buttons and any VIEWS facet rows (which
 * aren't in the `buttons` map, since they're rebuilt on every setFacets), then
 * highlights the row whose data-nav-id matches. Exactly one active at a time.
 */
function setActive(navId) {
    activeId = navId;
    for (const { el } of buttons.values()) {
        el.classList.toggle('is-active', el.dataset.navId === navId);
    }
    if (viewsEl) {
        viewsEl.querySelectorAll('.wl-cb-nav-item').forEach(el => {
            el.classList.toggle('is-active', el.dataset.navId === navId);
        });
    }
}

/**
 * Update the right-aligned count badges. Called by the grid once it has the
 * full model list (and again after a fav toggle changes the Favorites count).
 * `counts` is a plain map { all: N, favorites: N, recents: N }. Missing ids
 * blank their badge rather than showing 0, so an unknown filter reads as
 * "uncounted" instead of "empty".
 */
export function setCounts(counts) {
    if (!counts) return;
    for (const [id, { countEl }] of buttons) {
        const n = counts[id];
        countEl.textContent = (typeof n === 'number') ? String(n) : '';
    }
}

// ============================================================
// VIEWS facets (Folders / Tags)
// ============================================================

/**
 * Repaint the VIEWS section from the grid-derived facets. `facets` is
 * { folders: Facet[], tags: Facet[], tagTotal } (Facet = { id, name, count,
 * color }).
 *
 * The section renders:
 *   1. A single **Tags** nav item (id 'tags-hub') that flips the center into
 *      the Tag Hub — per-tag rows were dropped by request (the hub IS the tag
 *      list now). Its badge shows tagTotal (every plain tag, even empty ones,
 *      matching the hub's own "All Tags N"). Always present: the hub is also
 *      the tag-management surface, so it's an entry point even with zero tags.
 *   2. The **Folders** collapsible group, unchanged from the first Views slice
 *      (per-folder rows filtering the character grid) — omitted when empty.
 *
 * Collapse state for Folders persists across repaints (facetCollapsed). The
 * active highlight is re-asserted after the rebuild.
 *
 * Called by the grid on open and after any refresh (membership can change tag
 * counts, or add/remove a facet entirely), mirroring how setCounts is pushed.
 */
export function setFacets(facets) {
    if (!viewsEl) return;
    const folders = facets?.folders || [];
    const tagTotal = facets?.tagTotal || 0;
    const groupTotal = facets?.groupTotal || 0;

    viewsEl.innerHTML = '';
    viewsEl.style.display = '';

    const heading = document.createElement('div');
    heading.className = 'wl-cb-nav-heading';
    heading.textContent = 'Views';
    viewsEl.appendChild(heading);

    // Groups sits ABOVE Tags (user's layout). Like the Tags item it's a single
    // nav entry that flips the CENTER into the Groups Hub (not a per-group row
    // list), and it's always present as an entry point (the hub is also where
    // New Group lives), even at zero groups.
    viewsEl.appendChild(buildGroupsHubItem(groupTotal));
    viewsEl.appendChild(buildTagsHubItem(tagTotal));
    if (folders.length) viewsEl.appendChild(buildFacetGroup('folders', 'Folders', 'fa-solid fa-folder', folders));

    // Re-assert active highlight (a row for the active id may have just been
    // rebuilt). Visual-only; doesn't re-fire onFilter.
    setActive(activeId);
}

/**
 * The single "Groups" nav item that opens the Groups Hub. Mirrors the Tags item
 * exactly (icon · label · count), with data-nav-id 'groups-hub' so choose() and
 * setActive treat it uniformly. NOT in the `buttons` map (setCounts only knows
 * base filter ids) — its badge is set here on each setFacets repaint.
 */
function buildGroupsHubItem(groupTotal) {
    const btn = document.createElement('button');
    btn.className = 'wl-cb-nav-item';
    btn.dataset.navId = 'groups-hub';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-users';
    btn.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'wl-cb-nav-label';
    label.textContent = 'Groups';
    btn.appendChild(label);

    const count = document.createElement('span');
    count.className = 'wl-cb-nav-count';
    count.textContent = String(groupTotal);
    btn.appendChild(count);

    btn.addEventListener('click', () => choose('groups-hub'));
    return btn;
}

/**
 * The single "Tags" nav item that opens the Tag Hub. Styled like a base nav
 * item (icon · label · count); its data-nav-id is 'tags-hub' so choose() and
 * setActive treat it uniformly. NOT in the `buttons` map — setCounts would
 * blank its badge (it only knows base filter ids); the count is set here on
 * each setFacets repaint instead.
 */
function buildTagsHubItem(tagTotal) {
    const btn = document.createElement('button');
    btn.className = 'wl-cb-nav-item';
    btn.dataset.navId = 'tags-hub';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-tags';
    btn.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'wl-cb-nav-label';
    label.textContent = 'Tags';
    btn.appendChild(label);

    const count = document.createElement('span');
    count.className = 'wl-cb-nav-count';
    count.textContent = String(tagTotal);
    btn.appendChild(count);

    btn.addEventListener('click', () => choose('tags-hub'));
    return btn;
}

/**
 * One collapsible facet group: a clickable sub-heading (chevron · label ·
 * total-count) that toggles the row list below it. `kind` is 'folders'|'tags'
 * — used for the filter-id prefix and collapse memory. Rows are built per facet.
 */
function buildFacetGroup(kind, label, icon, list) {
    const group = document.createElement('div');
    group.className = 'wl-cb-facet-group';

    const head = document.createElement('button');
    head.className = 'wl-cb-facet-head';
    const collapsed = !!facetCollapsed[kind];
    head.classList.toggle('is-collapsed', collapsed);

    const chev = document.createElement('i');
    chev.className = 'wl-cb-facet-chev fa-solid fa-chevron-down';
    head.appendChild(chev);

    const gicon = document.createElement('i');
    gicon.className = 'wl-cb-facet-gicon ' + icon;
    head.appendChild(gicon);

    const lbl = document.createElement('span');
    lbl.className = 'wl-cb-facet-label';
    lbl.textContent = label;
    head.appendChild(lbl);

    const gcount = document.createElement('span');
    gcount.className = 'wl-cb-facet-gcount';
    gcount.textContent = String(list.length);
    head.appendChild(gcount);

    const rows = document.createElement('div');
    rows.className = 'wl-cb-facet-rows';
    rows.style.display = collapsed ? 'none' : '';
    for (const facet of list) rows.appendChild(buildFacetRow(kind, facet));

    head.addEventListener('click', () => {
        const now = !facetCollapsed[kind];
        facetCollapsed[kind] = now;
        head.classList.toggle('is-collapsed', now);
        rows.style.display = now ? 'none' : '';
    });

    group.appendChild(head);
    group.appendChild(rows);
    return group;
}

/**
 * One facet row: a nav-item styled like the base filters, carrying a color dot
 * (the tag/folder color, if any) · name · member count. Its data-nav-id is the
 * prefixed filter id ('folder:<id>' / 'tag:<id>') so choose() and setActive can
 * treat it uniformly with the base buttons.
 */
function buildFacetRow(kind, facet) {
    const prefix = kind === 'folders' ? 'folder:' : 'tag:';
    const navId = prefix + facet.id;

    const btn = document.createElement('button');
    btn.className = 'wl-cb-nav-item wl-cb-facet-row';
    btn.dataset.navId = navId;

    const dot = document.createElement('span');
    dot.className = 'wl-cb-facet-dot';
    if (facet.color) dot.style.background = facet.color;
    else dot.classList.add('wl-cb-facet-dot-empty');
    btn.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'wl-cb-nav-label';
    name.textContent = facet.name;
    name.title = facet.name;
    btn.appendChild(name);

    const count = document.createElement('span');
    count.className = 'wl-cb-nav-count';
    count.textContent = String(facet.count);
    btn.appendChild(count);

    btn.addEventListener('click', () => choose(navId));
    return btn;
}

/** The currently active filter id (grid reads this on refresh to stay in sync). */
export function getActiveFilter() {
    return activeId;
}

/**
 * Programmatically set the active filter's VISUAL state without firing
 * onFilter (the caller has already re-scoped the grid itself). Used by the
 * shell for jumps that don't originate from a nav click — e.g. the Tag Hub's
 * "View All Characters" sets the grid to tag:<id> and calls this; since
 * per-tag rows no longer exist, nothing highlights, which honestly reflects
 * "you're in a one-off tag-scoped view" until the next nav click.
 */
export function setActiveFilter(navId) {
    setActive(navId);
}
