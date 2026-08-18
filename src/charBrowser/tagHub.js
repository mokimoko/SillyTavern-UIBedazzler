// src/charBrowser/tagHub.js
// Character Browser — Tag Hub. When the nav's "Tags" item is selected, the
// CENTER region flips from the character grid to this hub: a browsable,
// manageable view of every plain (non-folder) tag. Concept follows the user's
// mockup: top bar (title + Create Tag · tag search · sort), a grid of tag
// cards (hero image = top member's avatar · name · member count · description
// blurb · mini-avatar strip), and — on selection — the shared right panel
// showing the tag's detail: name/count/description, Edit Tag (top), Related
// Tags, Top Characters, and a single View All Characters at the bottom (which
// jumps back to the character grid scoped to that tag).
//
// DATA: per-tag member lists come from charData.getTagHubData over the grid's
// stats-joined models (grid.getModels), so counts/msg totals always agree with
// the character grid. Tag DESCRIPTION and RELATED TAGS are Bedazzler-custom
// data (ST tags have neither) persisted via charData's tag-meta store in
// extension settings. Create/rename/recolor write to ST's live tags array
// (charData.createTag/updateTag) and save through ST's own debounced path.
//
// OWNERSHIP: renders into #wl-cb-taghub (center) and #wl-cb-detail-body
// (right). The shell (drawerUI) owns MODE — showing/hiding this container vs
// the grid — and guards the grid's onSelect while the hub is active so a
// live-sync refresh can't clobber tag detail with character detail. All text
// from tags/characters is set via textContent (no injected markup).

import {
    getTagHubData,
    getTagMeta,
    setTagMeta,
    getTagById,
    createTag,
    updateTag,
    getAssignableCharacters,
    assignTagToCharacters,
    unassignTagFromCharacters,
    getHiddenTagNames,
    getHiddenTagSet,
    setHiddenTagNames,
} from './charData.js';
import { getModels, refreshGrid, buildPager, getPageSize, setPageSize } from './grid.js';
import { withControlBusy } from './uiFeedback.js';

const log = () => {};

const CARD_DESC_CAP = 90;   // card blurb truncation
const MINI_AVATARS = 4;     // mini avatar strip length on cards
const TOP_CHARS = 5;        // top-characters rows in the detail panel

// Hub view state. Sort + selection persist across hub↔grid toggles within one
// browser open (like per-filter sort memory); everything resets on init.
let hubState = {
    query: '',
    sort: 'name_asc',       // name_asc | name_desc | count_desc
    selectedId: null,
    page: 1,                // hub cards paginate too (shared page-size setting)
};

let hostEl = null;          // #wl-cb-taghub
let detailBodyEl = null;    // #wl-cb-detail-body (shared with char detail)
let detailEmptyEl = null;   // #wl-cb-detail-empty
let cardsEl = null;         // hub's own cards container (built per render)
let pagerEl = null;         // hub's pager row (below the cards)
let countEl = null;         // "N tags" chip in the hub header
let callbacks = {
    onViewCharacters: null, // (tagId) => void — shell jumps to tag-scoped grid
    onOpenCharacter: null,  // (model) => void — shell opens char's recent chat
};
let active = false;
let data = [];              // [{ id, name, color, count, members }] from charData

// ============================================================
// Lifecycle (wired by the shell)
// ============================================================

/**
 * Bind the hub to its containers + callbacks and reset state. Called once per
 * browser open (takeover), BEFORE any activation. Does not render — the hub
 * paints lazily on first activateTagHub().
 */
export function initTagHub(opts) {
    hostEl = opts.hostEl || null;
    detailBodyEl = opts.detailBodyEl || null;
    detailEmptyEl = opts.detailEmptyEl || null;
    callbacks = {
        onViewCharacters: opts.onViewCharacters || null,
        onOpenCharacter: opts.onOpenCharacter || null,
    };
    hubState = { query: '', sort: 'name_asc', selectedId: null, page: 1 };
    active = false;
    data = [];
    cardsEl = pagerEl = countEl = null;
}

export function teardownTagHub() {
    hostEl = detailBodyEl = detailEmptyEl = cardsEl = pagerEl = countEl = null;
    callbacks = { onViewCharacters: null, onOpenCharacter: null };
    active = false;
    data = [];
}

/** Whether the hub currently owns the center + detail regions. The shell reads
 *  this to guard the grid's onSelect (see drawerUI). */
export function isTagHubActive() {
    return active;
}

/**
 * Enter hub mode: (re)build the hub chrome and paint the cards from fresh
 * data. Selection persists across hub↔grid toggles when the tag survives;
 * otherwise the first card (in current sort order) is selected so the detail
 * panel is never empty while tags exist.
 */
export function activateTagHub() {
    if (!hostEl) return;
    active = true;
    hubState.query = '';
    hubState.page = 1; // fresh entry starts at the first page
    renderHub();
}

/** Leave hub mode. DOM is left in place (the shell hides the container); only
 *  the active flag drops so onSelect guards release. */
export function deactivateTagHub() {
    active = false;
}

/**
 * Repaint from fresh data while active (live-sync refresh, or after an edit).
 * Keeps query/sort/selection where they survive; a selected tag that vanished
 * (deleted elsewhere) falls back to the first card.
 */
export function refreshTagHub() {
    if (!active || !hostEl || !cardsEl) return;
    deriveData();
    renderCards();
    renderSelectionDetail();
}

// ============================================================
// Data + view derivation
// ============================================================

function deriveData() {
    const all = getTagHubData(getModels());
    // Drop tags the user has hidden from the hub (matched by name, case-
    // insensitively). Filtering here keeps them out of EVERYTHING the hub reads
    // off `data` — cards, the count chip, related-tag pickers, selection.
    const hidden = getHiddenTagSet();
    data = hidden.size ? all.filter(t => !hidden.has(t.name.toLowerCase())) : all;
}

/** The cards to show: query-filtered + sorted per the hub's own sort control. */
function viewList() {
    const q = hubState.query.trim().toLowerCase();
    let list = q ? data.filter(t => t.name.toLowerCase().includes(q)) : data.slice();
    switch (hubState.sort) {
        case 'name_desc':
            list.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));
            break;
        case 'count_desc':
            list.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
            break;
        default: // name_asc — data arrives A–Z already, but re-sort for safety
            list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }
    return list;
}

/** The hub record for a tag id, or null. */
function recordFor(tagId) {
    return data.find(t => t.id === tagId) || null;
}

// ============================================================
// Hub chrome (top bar + cards container)
// ============================================================

/** Full hub rebuild: header (title/count/create) + controls (search/sort) +
 *  cards. Called on activation; refreshes reuse renderCards. */
function renderHub() {
    deriveData();
    hostEl.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'wl-cb-th-head';

    const title = document.createElement('div');
    title.className = 'wl-cb-th-title';
    const ticon = document.createElement('i');
    ticon.className = 'fa-solid fa-tags';
    title.appendChild(ticon);
    title.appendChild(document.createTextNode(' Tags'));
    countEl = document.createElement('span');
    countEl.className = 'wl-cb-th-count';
    title.appendChild(countEl);
    head.appendChild(title);

    // Right-side head actions: settings cog (hide-tags) + Create Tag, grouped so
    // the cog sits immediately left of Create Tag while the title stays far-left.
    const headActions = document.createElement('div');
    headActions.className = 'wl-cb-th-head-actions';

    // Native tag management — opens ST's own tag-management dialog. Sits left of
    // the cog. We don't import ST's onViewTagsListClick (it isn't exported), so
    // we fire ST's delegated `.tags_view` click handler via a throwaway element.
    const manageBtn = document.createElement('button');
    manageBtn.className = 'wl-cb-act wl-cb-th-settings wl-cb-th-managetags';
    manageBtn.title = 'Manage tags — open SillyTavern’s native tag management';
    manageBtn.setAttribute('aria-label', 'Open native tag management');
    manageBtn.innerHTML = '<i class="fa-solid fa-tags"></i>';
    manageBtn.addEventListener('click', () => {
        const trigger = document.createElement('span');
        trigger.className = 'tags_view';
        trigger.style.display = 'none';
        document.body.appendChild(trigger);
        trigger.click();
        trigger.remove();
    });
    headActions.appendChild(manageBtn);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'wl-cb-act wl-cb-th-settings';
    settingsBtn.title = 'Tag view settings — hide tags from this view';
    settingsBtn.setAttribute('aria-label', 'Tag view settings');
    settingsBtn.innerHTML = '<i class="fa-solid fa-gear"></i>';
    settingsBtn.addEventListener('click', () => openHiddenTagsSettings());
    headActions.appendChild(settingsBtn);

    const createBtn = document.createElement('button');
    createBtn.className = 'wl-cb-act wl-cb-act-primary wl-cb-th-create';
    createBtn.innerHTML = '<i class="fa-solid fa-plus"></i> ';
    createBtn.appendChild(document.createTextNode('Create Tag'));
    createBtn.addEventListener('click', () => renderTagEditor(null));
    headActions.appendChild(createBtn);

    head.appendChild(headActions);

    hostEl.appendChild(head);

    // Controls row: tag search + sort.
    const controls = document.createElement('div');
    controls.className = 'wl-cb-th-controls';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'wl-cb-th-search';
    const sicon = document.createElement('i');
    sicon.className = 'fa-solid fa-magnifying-glass';
    searchWrap.appendChild(sicon);
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search tags…';
    search.autocomplete = 'off';
    search.value = hubState.query;
    search.addEventListener('input', () => {
        hubState.query = search.value;
        hubState.page = 1; // new filter → back to first page
        renderCards();
    });
    searchWrap.appendChild(search);
    controls.appendChild(searchWrap);

    const sort = document.createElement('select');
    sort.className = 'wl-cb-sort wl-cb-th-sort';
    sort.title = 'Sort tags';
    for (const [val, label] of [
        ['name_asc', 'A–Z'],
        ['name_desc', 'Z–A'],
        ['count_desc', 'Most characters'],
    ]) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        sort.appendChild(opt);
    }
    sort.value = hubState.sort;
    sort.addEventListener('change', () => {
        hubState.sort = sort.value;
        hubState.page = 1; // re-sort → back to first page
        renderCards();
    });
    controls.appendChild(sort);

    hostEl.appendChild(controls);

    // Cards container + empty-state line.
    cardsEl = document.createElement('div');
    cardsEl.className = 'wl-cb-th-cards';
    hostEl.appendChild(cardsEl);

    // Pager row (below the cards) — same control as the character grid, reading
    // the same shared page-size setting. Painted by renderCards().
    pagerEl = document.createElement('div');
    pagerEl.className = 'wl-cb-pagination wl-cb-th-pagination';
    hostEl.appendChild(pagerEl);

    renderCards();

    // Default selection: survives from a previous hub visit when possible,
    // else the first card in view order — the panel always shows something
    // while tags exist.
    if (!recordFor(hubState.selectedId)) {
        hubState.selectedId = viewList()[0]?.id || null;
    }
    renderSelectionDetail();
}

/**
 * Settings popup for the Tag Hub: a comma-separated list of tag names to HIDE
 * from this view. Intended for tags that aren't browsing categories (theme
 * markers, WIP flags, etc.). Hiding only affects the hub — the tags themselves
 * and their character assignments are untouched. On accept we persist via
 * charData and repaint so the change shows immediately.
 */
async function openHiddenTagsSettings() {
    const c = SillyTavern.getContext();
    const callGenericPopup = c?.callGenericPopup;
    const POPUP_TYPE = c?.POPUP_TYPE;
    if (!callGenericPopup || !POPUP_TYPE) return;

    const wrap = document.createElement('div');
    wrap.className = 'wl-cb-th-hide-popup';

    const h = document.createElement('h3');
    h.className = 'marginBot5';
    h.textContent = 'Hide tags from this view';
    wrap.appendChild(h);

    const hint = document.createElement('div');
    hint.className = 'wl-cb-th-hint';
    hint.textContent = 'Comma-separated tag names. Matching tags won’t appear in the Tags view. '
        + 'The tags and their character assignments are not changed.';
    wrap.appendChild(hint);

    const ta = document.createElement('textarea');
    ta.className = 'wl-cb-th-textarea wl-cb-th-hide-input';
    ta.placeholder = 'e.g. theme:dark, wip, nsfw';
    ta.value = getHiddenTagNames().join(', ');
    wrap.appendChild(ta);

    const accepted = await callGenericPopup(wrap, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Save',
        cancelButton: 'Cancel',
    });
    if (!accepted) return;

    const names = ta.value.split(',').map(s => s.trim()).filter(Boolean);
    setHiddenTagNames(names);

    // Rebuild the (hidden) character grid's models so its card + detail chips
    // re-filter against the new hide-list — otherwise the change wouldn't show on
    // the Characters view until the next refresh. Cheap: no stats refetch.
    await refreshGrid(false);

    // Repaint the hub from fresh (filtered) data. A now-hidden selected tag falls
    // back to the first surviving card via renderHub's default-selection logic.
    if (active && hostEl) renderHub();
}

// ============================================================
// Cards
// ============================================================

/** Paint the tag cards into cardsEl from the current view list, PAGINATED with
 *  the shared page-size setting, and render the matching pager below. Selection
 *  and empty-state are handled here so search/sort/page re-render is one call. */
function renderCards() {
    if (!cardsEl) return;
    const list = viewList();
    if (countEl) countEl.textContent = `${data.length} ${data.length === 1 ? 'tag' : 'tags'}`;

    cardsEl.innerHTML = '';
    if (pagerEl) pagerEl.innerHTML = '';

    if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'wl-cb-empty';
        empty.textContent = data.length ? 'No tags match your search.' : 'No tags yet. Create one to get started.';
        cardsEl.appendChild(empty);
        return;
    }

    // Paginate against the shared page size (clamp the remembered page if the
    // list shrank — e.g. a tag was deleted or a search narrowed the results).
    const size = getPageSize();
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / size));
    if (hubState.page > pages) hubState.page = pages;
    const start = (hubState.page - 1) * size;
    const slice = list.slice(start, start + size);

    for (const rec of slice) cardsEl.appendChild(buildTagCard(rec));

    // Pager (shared control): only meaningful with more than one page, but we
    // still show it single-page so the per-page selector is always reachable.
    if (pagerEl) {
        pagerEl.appendChild(buildPager({
            page: hubState.page,
            pages,
            total,
            start,
            count: slice.length,
            onPage: (p) => { hubState.page = p; renderCards(); },
            onPageSize: (n) => {
                // Shared setting: persist + re-paginate the hub. setPageSize
                // also repaints the (hidden) character grid to page 1, so the
                // two surfaces stay in lockstep.
                setPageSize(n);
                hubState.page = 1;
                renderCards();
            },
        }));
    }
}

/**
 * One tag card: hero image (top member's avatar, or a neutral block) · name ·
 * "N characters" · description blurb (custom meta) · mini-avatar strip of the
 * first members + a "+N" overflow. Clicking selects the tag (fills the right
 * panel); it does NOT jump to the character grid — that's the panel's View All
 * Characters, matching the mockup's separation of browse vs. drill-in.
 */
function buildTagCard(rec) {
    const card = document.createElement('div');
    card.className = 'wl-cb-th-card';
    card.dataset.tagId = rec.id;
    if (rec.id === hubState.selectedId) card.classList.add('selected');

    // Hero — first member's avatar (top by messages). Neutral when the tag has
    // no members or the member has no avatar.
    const media = document.createElement('div');
    media.className = 'wl-cb-th-card-media';
    const heroUrl = rec.members[0]?.avatarUrl || '';
    if (heroUrl) {
        const img = document.createElement('img');
        img.src = heroUrl;
        img.alt = '';
        img.loading = 'lazy';
        media.appendChild(img);
    } else {
        media.classList.add('wl-cb-th-card-noimg');
    }
    // Color accent bar (the tag's own color) along the media's bottom edge.
    if (rec.color) {
        const bar = document.createElement('div');
        bar.className = 'wl-cb-th-card-bar';
        bar.style.background = rec.color;
        media.appendChild(bar);
    }
    card.appendChild(media);

    const body = document.createElement('div');
    body.className = 'wl-cb-th-card-body';

    const name = document.createElement('div');
    name.className = 'wl-cb-th-card-name';
    name.textContent = rec.name;
    name.title = rec.name;
    body.appendChild(name);

    const count = document.createElement('div');
    count.className = 'wl-cb-th-card-count';
    count.textContent = `${rec.count} ${rec.count === 1 ? 'character' : 'characters'}`;
    body.appendChild(count);

    const meta = getTagMeta(rec.id);
    if (meta.description) {
        const desc = document.createElement('div');
        desc.className = 'wl-cb-th-card-desc';
        const d = meta.description;
        desc.textContent = d.length > CARD_DESC_CAP ? d.slice(0, CARD_DESC_CAP).trimEnd() + '…' : d;
        desc.title = d;
        body.appendChild(desc);
    }

    body.appendChild(buildMiniAvatars(rec));
    card.appendChild(body);

    card.addEventListener('click', () => selectTag(rec.id));
    return card;
}

/** Mini avatar strip: first MINI_AVATARS members + a "+N" chip for the rest. */
function buildMiniAvatars(rec) {
    const strip = document.createElement('div');
    strip.className = 'wl-cb-th-mini';
    const shown = rec.members.slice(0, MINI_AVATARS);
    for (const m of shown) {
        const dot = document.createElement('span');
        dot.className = 'wl-cb-th-mini-av';
        if (m.avatarUrl) {
            dot.style.backgroundImage = `url("${m.avatarUrl.replace(/"/g, '%22')}")`;
        } else {
            dot.classList.add('wl-cb-th-mini-empty');
        }
        dot.title = m.name;
        strip.appendChild(dot);
    }
    const extra = rec.count - shown.length;
    if (extra > 0) {
        const more = document.createElement('span');
        more.className = 'wl-cb-th-mini-more';
        more.textContent = `+${extra}`;
        strip.appendChild(more);
    }
    return strip;
}

/** Select a tag: mark the card + repaint the right panel. In-place class swap
 *  (no full re-render) so scroll position holds. */
function selectTag(tagId) {
    hubState.selectedId = tagId;
    if (cardsEl) {
        cardsEl.querySelectorAll('.wl-cb-th-card.selected').forEach(c => c.classList.remove('selected'));
        const el = cardsEl.querySelector(`.wl-cb-th-card[data-tag-id="${cssEscape(tagId)}"]`);
        el?.classList.add('selected');
    }
    renderSelectionDetail();
}

function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/["\\\]]/g, '\\$&');
}

// ============================================================
// Right panel — tag detail
// ============================================================

/**
 * Paint the selected tag's detail into the SHARED right panel (#wl-cb-detail-
 * body). Layout follows the mockup, minus the redundant top "View Characters":
 *   hero (color chip + name + count) · description · [Edit Tag] ·
 *   Related Tags · Top Characters · [View All Characters]
 * When no tag is selected (empty hub) the panel shows a gentle prompt.
 */
function renderSelectionDetail() {
    if (!detailBodyEl) return;
    const rec = recordFor(hubState.selectedId);
    if (detailEmptyEl) detailEmptyEl.style.display = 'none';
    detailBodyEl.innerHTML = '';

    if (!rec) {
        const empty = document.createElement('div');
        empty.className = 'wl-cb-empty';
        empty.textContent = 'Select a tag.';
        detailBodyEl.appendChild(empty);
        return;
    }

    const meta = getTagMeta(rec.id);

    // Hero: color chip glyph, name, count.
    const hero = document.createElement('div');
    hero.className = 'wl-cb-th-detail-hero';
    const chip = document.createElement('div');
    chip.className = 'wl-cb-th-detail-chip';
    chip.style.background = rec.color || 'var(--SmartThemeQuoteColor, #9b8cff)';
    const chipIcon = document.createElement('i');
    chipIcon.className = 'fa-solid fa-tag';
    // Icon glyph takes the tag's TEXT colour (color2), mirroring how ST pairs a
    // tag's background/text. Left to the CSS default when the tag has no text
    // colour set.
    if (rec.color2) chipIcon.style.color = rec.color2;
    chip.appendChild(chipIcon);
    hero.appendChild(chip);
    const htext = document.createElement('div');
    htext.className = 'wl-cb-th-detail-htext';
    const hname = document.createElement('div');
    hname.className = 'wl-cb-th-detail-name';
    hname.textContent = rec.name;
    hname.title = rec.name;
    htext.appendChild(hname);
    const hcount = document.createElement('div');
    hcount.className = 'wl-cb-th-detail-count';
    hcount.textContent = `${rec.count} ${rec.count === 1 ? 'character' : 'characters'}`;
    htext.appendChild(hcount);
    hero.appendChild(htext);
    detailBodyEl.appendChild(hero);

    // Description (custom meta) — omitted when blank.
    if (meta.description) {
        const desc = document.createElement('div');
        desc.className = 'wl-cb-th-detail-desc';
        desc.textContent = meta.description;
        detailBodyEl.appendChild(desc);
    }

    // Edit Tag (top action, per user's preferred single-action-per-end layout).
    const editRow = document.createElement('div');
    editRow.className = 'wl-cb-th-detail-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'wl-cb-act';
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> ';
    editBtn.appendChild(document.createTextNode('Edit Tag'));
    editBtn.addEventListener('click', () => renderTagEditor(rec.id));
    editRow.appendChild(editBtn);
    detailBodyEl.appendChild(editRow);

    // Related Tags (custom meta) — each links to that tag within the hub.
    detailBodyEl.appendChild(buildRelatedTags(rec, meta));

    // Top Characters (by messages) — click opens that character's chat via the
    // shell's grid path? No: the hub is a browse surface; clicking a top char
    // selects it in the (hidden) grid and jumps to the character view scoped to
    // this tag, landing on that character. Simpler + matches "drill in": we just
    // reuse View All Characters' jump. So rows here are non-interactive labels
    // plus a comment glyph, mirroring the mockup's read-only list.
    detailBodyEl.appendChild(buildTopCharacters(rec));

    // View All Characters (bottom, single) — jump to the tag-scoped grid.
    const viewRow = document.createElement('div');
    viewRow.className = 'wl-cb-th-detail-viewall';
    const viewBtn = document.createElement('button');
    viewBtn.className = 'wl-cb-act wl-cb-act-primary';
    viewBtn.innerHTML = '<i class="fa-solid fa-users"></i> ';
    viewBtn.appendChild(document.createTextNode('View All Characters'));
    viewBtn.addEventListener('click', () => callbacks.onViewCharacters?.(rec.id));
    viewRow.appendChild(viewBtn);
    detailBodyEl.appendChild(viewRow);
}

/**
 * Related Tags block from custom meta. Each related id is resolved to its live
 * hub record (so we show current name + count); ids that no longer resolve to a
 * plain tag are skipped. Clicking a related tag selects it in the hub. Omitted
 * entirely when there are no (resolvable) related tags.
 */
function buildRelatedTags(rec, meta) {
    const box = document.createElement('div');
    box.className = 'wl-cb-th-related';

    const resolved = (meta.related || [])
        .map(id => recordFor(id))
        .filter(Boolean);
    if (!resolved.length) {
        box.style.display = 'none';
        return box;
    }

    const h = document.createElement('div');
    h.className = 'wl-cb-th-section-h';
    h.textContent = 'Related Tags';
    box.appendChild(h);

    for (const r of resolved) {
        const row = document.createElement('button');
        row.className = 'wl-cb-th-related-row';
        const dot = document.createElement('span');
        dot.className = 'wl-cb-facet-dot';
        if (r.color) dot.style.background = r.color;
        else dot.classList.add('wl-cb-facet-dot-empty');
        row.appendChild(dot);
        const nm = document.createElement('span');
        nm.className = 'wl-cb-th-related-name';
        nm.textContent = r.name;
        nm.title = r.name;
        row.appendChild(nm);
        const ct = document.createElement('span');
        ct.className = 'wl-cb-nav-count';
        ct.textContent = String(r.count);
        row.appendChild(ct);
        row.addEventListener('click', () => selectTag(r.id));
        box.appendChild(row);
    }
    return box;
}

/**
 * Top Characters block: the tag's members, most-messages-first, capped. Each
 * row shows avatar · name · "by creator" · a comment glyph with the msg count.
 * Clicking a row opens that character's most-recent chat (via the shell's
 * onOpenCharacter → openMostRecentChat) and closes the browser, the same as the
 * character detail panel's Open Chat. Omitted when the tag has no members.
 */
function buildTopCharacters(rec) {
    const box = document.createElement('div');
    box.className = 'wl-cb-th-top';
    if (!rec.members.length) {
        box.style.display = 'none';
        return box;
    }

    const h = document.createElement('div');
    h.className = 'wl-cb-th-section-h';
    h.textContent = 'Top Characters';
    box.appendChild(h);

    for (const m of rec.members.slice(0, TOP_CHARS)) {
        const row = document.createElement('div');
        row.className = 'wl-cb-th-top-row';
        // Clicking a row opens that character's most-recent chat (like the
        // character detail's Open Chat) and closes the browser. Only wired when
        // the shell provided the callback and the model carries an ST index.
        const canOpen = typeof callbacks.onOpenCharacter === 'function' && m.index != null;
        if (canOpen) {
            row.classList.add('wl-cb-th-top-open');
            row.setAttribute('role', 'button');
            row.tabIndex = 0;
            row.title = `Open chat with ${m.name}`;
            // Spinner on the row until the open resolves (the browser usually
            // tears down first), so a slow select/chat-load isn't a dead click.
            const open = () => withControlBusy(row, () => callbacks.onOpenCharacter(m));
            row.addEventListener('click', open);
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
        }

        const av = document.createElement('span');
        av.className = 'wl-cb-th-top-av';
        if (m.avatarUrl) av.style.backgroundImage = `url("${m.avatarUrl.replace(/"/g, '%22')}")`;
        else av.classList.add('wl-cb-th-mini-empty');
        row.appendChild(av);

        const txt = document.createElement('div');
        txt.className = 'wl-cb-th-top-txt';
        const nm = document.createElement('div');
        nm.className = 'wl-cb-th-top-name';
        nm.textContent = m.name;
        nm.title = m.name;
        txt.appendChild(nm);
        if (m.creator) {
            const by = document.createElement('div');
            by.className = 'wl-cb-th-top-by';
            by.textContent = `by ${m.creator}`;
            by.title = m.creator;
            txt.appendChild(by);
        }
        row.appendChild(txt);

        const msg = document.createElement('span');
        msg.className = 'wl-cb-th-top-msg';
        msg.innerHTML = '<i class="fa-regular fa-comment"></i> ';
        msg.appendChild(document.createTextNode(String(m.msgCount || 0)));
        row.appendChild(msg);

        box.appendChild(row);
    }
    return box;
}

// ============================================================
// Tag editor (Create Tag + Edit Tag) — in the right panel
// ============================================================

/**
 * Render the tag create/edit form into the right panel. `tagId === null` means
 * CREATE (name required; on success the new tag is selected and the form
 * reopens in edit mode so custom meta can be added). An existing id means EDIT:
 * name + color are ST fields (charData.updateTag), description + related are
 * custom meta (charData.setTagMeta). Cancel returns to the tag's detail (or the
 * hub prompt for a cancelled create).
 *
 * This is where Bedazzler's custom tag data ("adding custom data to tags",
 * per the user) is authored: the description textarea and the related-tags
 * multi-picker have no ST equivalent — they live only in our settings store.
 */
function renderTagEditor(tagId) {
    if (!detailBodyEl) return;
    const creating = tagId == null;
    const rec = creating ? null : recordFor(tagId);
    const tag = creating ? null : getTagById(tagId);
    if (!creating && !tag) { renderSelectionDetail(); return; }
    const meta = creating ? { description: '', related: [] } : getTagMeta(tagId);

    if (detailEmptyEl) detailEmptyEl.style.display = 'none';
    detailBodyEl.innerHTML = '';

    const form = document.createElement('div');
    form.className = 'wl-cb-th-editor';

    const title = document.createElement('div');
    title.className = 'wl-cb-th-section-h';
    title.textContent = creating ? 'Create Tag' : 'Edit Tag';
    form.appendChild(title);

    // Name.
    form.appendChild(fieldLabel('Name'));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'wl-cb-th-input';
    nameInput.placeholder = 'Tag name';
    nameInput.value = tag?.name || '';
    form.appendChild(nameInput);

    // Colors (ST fields). Two swatches — Background (tag.color) and Text
    // (tag.color2) — matching ST's own tag colour model, so what we write here
    // shows up identically on ST's native chips and its tag manager (and vice
    // versa: we READ tag.color/color2, so a change made in ST loads back here).
    // Each has a "clear" to empty it (an empty field means "inherit the theme",
    // which is exactly how ST treats a blank colour). A live preview chip below
    // reflects the current pair.
    form.appendChild(fieldLabel('Colors'));

    // Background swatch.
    const colorRow = document.createElement('div');
    colorRow.className = 'wl-cb-th-color-row';
    const bgLabel = document.createElement('span');
    bgLabel.className = 'wl-cb-th-color-tag';
    bgLabel.textContent = 'Background';
    colorRow.appendChild(bgLabel);
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'wl-cb-th-color';
    colorInput.value = normalizeHex(tag?.color) || '#9b8cff';
    colorRow.appendChild(colorInput);
    let colorCleared = !tag?.color;
    const clearColor = document.createElement('button');
    clearColor.className = 'wl-cb-act wl-cb-th-color-clear';
    clearColor.textContent = colorCleared ? 'No color' : 'Clear';
    clearColor.addEventListener('click', () => {
        colorCleared = true;
        clearColor.textContent = 'No color';
        updatePreview();
    });
    colorInput.addEventListener('input', () => {
        colorCleared = false;
        clearColor.textContent = 'Clear';
        updatePreview();
    });
    colorRow.appendChild(clearColor);
    form.appendChild(colorRow);

    // Text (foreground) swatch.
    const textRow = document.createElement('div');
    textRow.className = 'wl-cb-th-color-row';
    const fgLabel = document.createElement('span');
    fgLabel.className = 'wl-cb-th-color-tag';
    fgLabel.textContent = 'Text';
    textRow.appendChild(fgLabel);
    const textInput = document.createElement('input');
    textInput.type = 'color';
    textInput.className = 'wl-cb-th-color';
    textInput.value = normalizeHex(tag?.color2) || '#ffffff';
    textRow.appendChild(textInput);
    let textCleared = !tag?.color2;
    const clearText = document.createElement('button');
    clearText.className = 'wl-cb-act wl-cb-th-color-clear';
    clearText.textContent = textCleared ? 'No color' : 'Clear';
    clearText.addEventListener('click', () => {
        textCleared = true;
        clearText.textContent = 'No color';
        updatePreview();
    });
    textInput.addEventListener('input', () => {
        textCleared = false;
        clearText.textContent = 'Clear';
        updatePreview();
    });
    textRow.appendChild(clearText);
    form.appendChild(textRow);

    // Live preview chip — shows the current bg/text pair the way it'll read on
    // a character card / detail panel. Reuses the shared .wl-cb-chip look.
    const preview = document.createElement('div');
    preview.className = 'wl-cb-th-color-preview';
    const previewChip = document.createElement('span');
    previewChip.className = 'wl-cb-chip';
    preview.appendChild(previewChip);
    form.appendChild(preview);

    /** Repaint the preview chip from the live control state (empty = theme
     *  default, mirroring ST + the card renderer). */
    function updatePreview() {
        previewChip.textContent = (nameInput.value.trim() || tag?.name || 'Sample');
        previewChip.classList.remove('wl-cb-chip-colored');
        previewChip.style.backgroundColor = '';
        previewChip.style.color = '';
        if (!colorCleared) {
            previewChip.style.backgroundColor = colorInput.value;
            previewChip.classList.add('wl-cb-chip-colored');
        }
        if (!textCleared) previewChip.style.color = textInput.value;
    }
    // Keep the preview label in sync as the name is typed.
    nameInput.addEventListener('input', updatePreview);
    updatePreview();

    // Description (custom meta).
    form.appendChild(fieldLabel('Description'));
    const descInput = document.createElement('textarea');
    descInput.className = 'wl-cb-th-textarea';
    descInput.placeholder = 'What is this tag for? (shown only in the Character Browser)';
    descInput.value = meta.description || '';
    form.appendChild(descInput);

    // Related tags (custom meta) — multi-select over the OTHER plain tags.
    form.appendChild(fieldLabel('Related Tags'));
    const relatedBox = document.createElement('div');
    relatedBox.className = 'wl-cb-th-related-pick';
    const relatedSet = new Set(meta.related || []);
    const others = data.filter(t => t.id !== tagId);
    if (!others.length) {
        const none = document.createElement('div');
        none.className = 'wl-cb-th-hint';
        none.textContent = 'No other tags to relate yet.';
        relatedBox.appendChild(none);
    }
    for (const o of others) {
        const chip = document.createElement('button');
        chip.className = 'wl-cb-th-relchip';
        chip.dataset.tagId = o.id;
        chip.textContent = o.name;
        if (relatedSet.has(o.id)) chip.classList.add('is-on');
        chip.addEventListener('click', () => {
            if (relatedSet.has(o.id)) { relatedSet.delete(o.id); chip.classList.remove('is-on'); }
            else { relatedSet.add(o.id); chip.classList.add('is-on'); }
        });
        relatedBox.appendChild(chip);
    }
    form.appendChild(relatedBox);

    // Assign to characters (CREATE and EDIT). A searchable checklist over every
    // character; checking one queues its avatar to receive this tag on save,
    // unchecking queues its removal (charData.assign/unassignTagToCharacters
    // write ST's tagMap). Same-named chars are disambiguated by their avatar
    // filename in parentheses (Chat Design convention).
    //
    // In EDIT mode the tag's CURRENT members are pre-checked so the picker is a
    // live membership editor: `originalAvatars` snapshots that starting set so
    // save can diff (checked-but-not-original → assign; original-but-unchecked →
    // unassign) instead of blindly re-writing. Membership comes from the hub
    // record's member models (rec.members), which are derived from the same
    // tagMap, so the pre-check always matches ST truth.
    const assignAvatars = new Set();
    const originalAvatars = new Set(
        creating ? [] : (rec?.members || []).map(m => m.avatar).filter(Boolean)
    );
    // Seed the working set with the current members so an untouched save is a
    // no-op diff (nothing added, nothing removed).
    for (const av of originalAvatars) assignAvatars.add(av);

    {
        form.appendChild(fieldLabel('Assign to Characters'));

        const pickSearch = document.createElement('input');
        pickSearch.type = 'search';
        pickSearch.className = 'wl-cb-th-input wl-cb-th-pick-search';
        pickSearch.placeholder = 'Search characters…';
        pickSearch.autocomplete = 'off';
        form.appendChild(pickSearch);

        const pickList = document.createElement('div');
        pickList.className = 'wl-cb-th-pick-list';
        const chars = getAssignableCharacters();
        if (!chars.length) {
            const none = document.createElement('div');
            none.className = 'wl-cb-th-hint';
            none.textContent = 'No characters to assign.';
            pickList.appendChild(none);
        }
        for (const ch of chars) {
            const row = document.createElement('label');
            row.className = 'wl-cb-th-pick-row';
            // Lowercased search haystack: name + avatar filename.
            row.dataset.search = `${ch.name} ${ch.avatar}`.toLowerCase();

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = ch.avatar;
            // Pre-check current members in edit mode.
            cb.checked = assignAvatars.has(ch.avatar);
            cb.addEventListener('change', () => {
                if (cb.checked) assignAvatars.add(ch.avatar);
                else assignAvatars.delete(ch.avatar);
            });
            row.appendChild(cb);

            const label = document.createElement('span');
            label.className = 'wl-cb-th-pick-name';
            label.textContent = ch.name;
            // Only duplicate names get the avatar-filename qualifier.
            if (ch.dupe) {
                const hint = document.createElement('span');
                hint.className = 'wl-cb-th-pick-hint';
                hint.textContent = ` (${ch.avatar})`;
                label.appendChild(hint);
            }
            row.appendChild(label);
            pickList.appendChild(row);
        }
        form.appendChild(pickList);

        // Live filter the checklist as the user types (rows kept if the query
        // is a substring of name/avatar).
        pickSearch.addEventListener('input', () => {
            const q = pickSearch.value.trim().toLowerCase();
            pickList.querySelectorAll('.wl-cb-th-pick-row').forEach(r => {
                r.style.display = (!q || r.dataset.search.includes(q)) ? '' : 'none';
            });
        });
    }

    // Error line (duplicate name, etc.).
    const err = document.createElement('div');
    err.className = 'wl-cb-th-error';
    err.style.display = 'none';
    form.appendChild(err);

    // Buttons: Save + Cancel.
    const btns = document.createElement('div');
    btns.className = 'wl-cb-th-editor-btns';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'wl-cb-act wl-cb-act-primary';
    saveBtn.textContent = creating ? 'Create' : 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'wl-cb-act';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
        if (creating) { hubState.selectedId = viewList()[0]?.id || null; }
        renderSelectionDetail();
    });
    btns.append(saveBtn, cancelBtn);
    form.appendChild(btns);

    const showErr = (msg) => { err.textContent = msg; err.style.display = ''; };

    saveBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        const color = colorCleared ? '' : colorInput.value;   // background (ST tag.color)
        const color2 = textCleared ? '' : textInput.value;    // text (ST tag.color2)
        const description = descInput.value;
        const related = [...relatedSet];

        let targetId = tagId;
        if (creating) {
            // Seed both colours at creation so a new tag lands fully coloured.
            const res = createTag(name, { color, color2 });
            if (!res.ok) { showErr(res.reason); return; }
            targetId = res.tag.id;
            // New tag: everything checked is an addition (no prior members).
            if (assignAvatars.size) {
                assignTagToCharacters(targetId, [...assignAvatars]);
            }
        } else {
            // Always write both colour fields so a "clear" actually empties the
            // ST field (passing the key with '' is how updateTag blanks it).
            const res = updateTag(targetId, { name, color, color2 });
            if (!res.ok) { showErr(res.reason); return; }
            // Membership diff: checked-but-not-original → assign; original-but-
            // now-unchecked → unassign. Computing the delta (rather than a blunt
            // re-write) means we only touch tagMap entries that actually changed,
            // and never disturb a character's OTHER tags.
            const toAdd = [...assignAvatars].filter(a => !originalAvatars.has(a));
            const toRemove = [...originalAvatars].filter(a => !assignAvatars.has(a));
            if (toAdd.length) assignTagToCharacters(targetId, toAdd);
            if (toRemove.length) unassignTagFromCharacters(targetId, toRemove);
        }
        setTagMeta(targetId, { description, related });

        // Re-read the grid's models from ST truth so the CHARACTER cards +
        // detail panel pick up the tag's new name/colours (m.tagChips is built
        // per-model, so a colour/name edit only reaches the grid via a rebuild).
        // Membership changes need it too (counts/members). Cheap — no stats
        // refetch. The grid is hidden under the hub, but reassertSelection() on
        // hub-exit then hands the (freshly rebuilt) selected model to the detail
        // panel, so colours are already current when the user leaves the hub.
        await refreshGrid(false);

        // Re-derive (name/color/membership/meta all may have changed) and land
        // on the edited/created tag's detail.
        deriveData();
        renderCards();
        hubState.selectedId = targetId;
        if (cardsEl) {
            const el = cardsEl.querySelector(`.wl-cb-th-card[data-tag-id="${cssEscape(targetId)}"]`);
            el?.classList.add('selected');
        }
        renderSelectionDetail();
    });

    detailBodyEl.appendChild(form);
    nameInput.focus();
}

function fieldLabel(text) {
    const l = document.createElement('label');
    l.className = 'wl-cb-th-flabel';
    l.textContent = text;
    return l;
}

/** Coerce an arbitrary ST color string to a #rrggbb the native color input
 *  accepts, or '' when it can't (leaves the picker at its default). */
function normalizeHex(str) {
    if (!str) return '';
    const s = String(str).trim();
    const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return '';
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return '#' + h.toLowerCase();
}
