// src/charBrowser/groupHub.js
// Character Browser — Groups Hub. When the nav's "Groups" item (above "Tags")
// is selected, the CENTER region flips from the character grid to this hub: a
// browsable, basic-manage view of every ST group. It's the direct counterpart
// of the Tag Hub (tagHub.js) — same shell contract (owns #wl-cb-grouphub in the
// center + writes detail into the shared #wl-cb-detail-body), same card/pager
// vocabulary (reuses the wl-cb-th-* card + wl-cb-detail-* stat classes), and the
// shell guards the grid's onSelect while this hub is active so a live-sync
// refresh can't clobber group detail with character detail.
//
// DATA: getGroupModels() (charData) over getContext().groups — a group carries
// members[avatar], a collage/custom avatar, fav, date_last_chat, chats[], and
// tags (via the shared tagMap keyed by group id). NOTHING here mutates a group's
// members/name/strategy — that's ST's native panel. This hub does the browse +
// basic-manage set the user asked for: open (a chat), favorite, delete, and — for
// a MEMBER — redirect to that character's own edit drawer (member edits are
// character edits). New Group routes to ST's native create flow via the shell.
//
// OWNERSHIP: renders into #wl-cb-grouphub (center) + #wl-cb-detail-body (right).
// All group/character text is set via textContent (no injected markup).

import {
    getGroupModels,
    sortGroups,
    setGroupFavorite,
    deleteGroupById,
    getGroupChats,
} from './charData.js';
import { buildPager, getPageSize, setPageSize, applyChipColor } from './grid.js';
import { withControlBusy } from './uiFeedback.js';

const log = () => {};

const MINI_AVATARS = 4;   // mini member-avatar strip length on cards

// Hub view state. Sort + selection persist across hub↔grid toggles within one
// browser open (like the Tag Hub); everything resets on init.
let hubState = {
    query: '',
    sort: 'name_asc',       // name_asc | name_desc | most_members | last_used
    selectedId: null,
    page: 1,
};

let hostEl = null;          // #wl-cb-grouphub
let detailBodyEl = null;    // #wl-cb-detail-body (shared with char/tag detail)
let detailEmptyEl = null;   // #wl-cb-detail-empty
let cardsEl = null;         // hub's own cards container (built per render)
let pagerEl = null;         // hub's pager row (below the cards)
let countEl = null;         // "N groups" chip in the hub header
let callbacks = {
    onOpenGroup: null,   // (model, chatId) => Promise — shell opens + closes browser
    onEditMember: null,  // (index) => void — shell edits that character in the CDE
    onNewGroup: null,    // () => void — shell triggers ST's native New Group flow
    onChanged: null,     // () => void — a group was fav'd/deleted; shell refreshes nav
};
let active = false;
let data = [];              // group view-models from charData

// ============================================================
// Lifecycle (wired by the shell)
// ============================================================

/** Bind the hub to its containers + callbacks and reset state. Called once per
 *  browser open (takeover), BEFORE any activation. Paints lazily on first
 *  activateGroupHub(). */
export function initGroupHub(opts) {
    hostEl = opts.hostEl || null;
    detailBodyEl = opts.detailBodyEl || null;
    detailEmptyEl = opts.detailEmptyEl || null;
    callbacks = {
        onOpenGroup: opts.onOpenGroup || null,
        onEditMember: opts.onEditMember || null,
        onNewGroup: opts.onNewGroup || null,
        onChanged: opts.onChanged || null,
    };
    hubState = { query: '', sort: 'name_asc', selectedId: null, page: 1 };
    active = false;
    data = [];
    cardsEl = pagerEl = countEl = null;
}

export function teardownGroupHub() {
    hostEl = detailBodyEl = detailEmptyEl = cardsEl = pagerEl = countEl = null;
    callbacks = { onOpenGroup: null, onEditMember: null, onNewGroup: null, onChanged: null };
    active = false;
    data = [];
}

/** Whether the hub currently owns the center + detail regions. The shell reads
 *  this to guard the grid's onSelect (see drawerUI). */
export function isGroupHubActive() {
    return active;
}

/** Enter hub mode: (re)build the hub chrome and paint the cards from fresh
 *  data. Selection persists across toggles when the group survives; else the
 *  first card is selected so the detail panel is never empty while groups exist. */
export function activateGroupHub() {
    if (!hostEl) return;
    active = true;
    hubState.query = '';
    hubState.page = 1;
    renderHub();
}

/** Leave hub mode. DOM is left in place (the shell hides the container); only
 *  the active flag drops so the grid's onSelect guard releases. */
export function deactivateGroupHub() {
    active = false;
}

/** Repaint from fresh data while active (live-sync refresh, or after a fav/
 *  delete). Keeps query/sort/selection where they survive; a selected group
 *  that vanished falls back to the first card. */
export function refreshGroupHub() {
    if (!active || !hostEl || !cardsEl) return;
    deriveData();
    renderCards();
    renderSelectionDetail();
}

// ============================================================
// Data + view derivation
// ============================================================

function deriveData() {
    data = getGroupModels();
}

/** The cards to show: query-filtered (name + member names) + sorted. */
function viewList() {
    const q = hubState.query.trim().toLowerCase();
    let list = data.slice();
    if (q) {
        list = list.filter(g =>
            g.name.toLowerCase().includes(q)
            || g.members.some(m => (m.name || '').toLowerCase().includes(q)));
    }
    return sortGroups(list, hubState.sort);
}

/** The hub record for a group id, or null. */
function recordFor(groupId) {
    return data.find(g => g.id === groupId) || null;
}

// ============================================================
// Group avatar (collage or custom) — shared by cards + detail
// ============================================================

/**
 * Fill `container` with a group's avatar: a single <img> when the group has a
 * custom uploaded avatar, else a 1–4 tile collage of member thumbnails (ST's own
 * group-avatar convention), else a neutral "users" placeholder. Tiles use
 * background-image so a slow/broken thumb never breaks layout.
 */
function fillGroupAvatar(container, model) {
    if (model.customAvatarUrl) {
        const img = document.createElement('img');
        img.src = model.customAvatarUrl;
        img.alt = '';
        img.loading = 'lazy';
        container.appendChild(img);
        return;
    }
    const tiles = (model.collage || []).slice(0, 4);
    if (!tiles.length) {
        container.classList.add('wl-cb-gh-noimg');
        return;
    }
    const collage = document.createElement('div');
    collage.className = 'wl-cb-gh-collage collage-' + tiles.length;
    for (const url of tiles) {
        const tile = document.createElement('span');
        tile.className = 'wl-cb-gh-tile';
        tile.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
        collage.appendChild(tile);
    }
    container.appendChild(collage);
}

// ============================================================
// Hub chrome (top bar + cards container)
// ============================================================

/** Full hub rebuild: header (title/count/New Group) + controls (search/sort) +
 *  cards. Called on activation; refreshes reuse renderCards. */
function renderHub() {
    deriveData();
    hostEl.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'wl-cb-th-head';

    const title = document.createElement('div');
    title.className = 'wl-cb-th-title';
    const ticon = document.createElement('i');
    ticon.className = 'fa-solid fa-users';
    title.appendChild(ticon);
    title.appendChild(document.createTextNode(' Groups'));
    countEl = document.createElement('span');
    countEl.className = 'wl-cb-th-count';
    title.appendChild(countEl);
    head.appendChild(title);

    // New Group — routes to ST's native create flow (hosted by the shell in the
    // detail column, same panel the top-bar New Group button uses).
    const headActions = document.createElement('div');
    headActions.className = 'wl-cb-th-head-actions';
    const createBtn = document.createElement('button');
    createBtn.className = 'wl-cb-act wl-cb-act-primary wl-cb-th-create';
    createBtn.innerHTML = '<i class="fa-solid fa-plus"></i> ';
    createBtn.appendChild(document.createTextNode('New Group'));
    createBtn.addEventListener('click', () => callbacks.onNewGroup?.());
    headActions.appendChild(createBtn);
    head.appendChild(headActions);
    hostEl.appendChild(head);

    // Controls row: group search + sort.
    const controls = document.createElement('div');
    controls.className = 'wl-cb-th-controls';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'wl-cb-th-search';
    const sicon = document.createElement('i');
    sicon.className = 'fa-solid fa-magnifying-glass';
    searchWrap.appendChild(sicon);
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search groups, members…';
    search.autocomplete = 'off';
    search.value = hubState.query;
    search.addEventListener('input', () => {
        hubState.query = search.value;
        hubState.page = 1;
        renderCards();
    });
    searchWrap.appendChild(search);
    controls.appendChild(searchWrap);

    const sort = document.createElement('select');
    sort.className = 'wl-cb-sort wl-cb-th-sort';
    sort.title = 'Sort groups';
    for (const [val, label] of [
        ['name_asc', 'A–Z'],
        ['name_desc', 'Z–A'],
        ['most_members', 'Most members'],
        ['last_used', 'Last used'],
    ]) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        sort.appendChild(opt);
    }
    sort.value = hubState.sort;
    sort.addEventListener('change', () => {
        hubState.sort = sort.value;
        hubState.page = 1;
        renderCards();
    });
    controls.appendChild(sort);
    hostEl.appendChild(controls);

    // Cards + pager.
    cardsEl = document.createElement('div');
    cardsEl.className = 'wl-cb-th-cards';
    hostEl.appendChild(cardsEl);
    pagerEl = document.createElement('div');
    pagerEl.className = 'wl-cb-pagination wl-cb-th-pagination';
    hostEl.appendChild(pagerEl);

    renderCards();

    // Default selection: survive from a previous visit, else the first card.
    if (!recordFor(hubState.selectedId)) {
        hubState.selectedId = viewList()[0]?.id || null;
    }
    renderSelectionDetail();
}

// ============================================================
// Cards
// ============================================================

/** Paint the group cards into cardsEl from the current view list, PAGINATED
 *  with the shared page-size setting, and render the matching pager below. */
function renderCards() {
    if (!cardsEl) return;
    const list = viewList();
    if (countEl) countEl.textContent = `${data.length} ${data.length === 1 ? 'group' : 'groups'}`;

    cardsEl.innerHTML = '';
    if (pagerEl) pagerEl.innerHTML = '';

    if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'wl-cb-empty';
        empty.textContent = data.length ? 'No groups match your search.' : 'No groups yet. Create one to get started.';
        cardsEl.appendChild(empty);
        return;
    }

    const size = getPageSize();
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / size));
    if (hubState.page > pages) hubState.page = pages;
    const start = (hubState.page - 1) * size;
    const slice = list.slice(start, start + size);

    for (const rec of slice) cardsEl.appendChild(buildGroupCard(rec));

    if (pagerEl) {
        pagerEl.appendChild(buildPager({
            page: hubState.page,
            pages,
            total,
            start,
            count: slice.length,
            onPage: (p) => { hubState.page = p; renderCards(); },
            onPageSize: (n) => { setPageSize(n); hubState.page = 1; renderCards(); },
        }));
    }
}

/**
 * One group card: collage/custom hero · fav star (top-right) · name · "N members"
 * · tag chips · mini member-avatar strip. Clicking selects the group (fills the
 * right panel); it does NOT open the chat — that's the panel's Open Chat, the
 * same browse-vs-open separation as characters and the Tag Hub. The star toggles
 * favorite without selecting.
 */
function buildGroupCard(rec) {
    const card = document.createElement('div');
    card.className = 'wl-cb-th-card wl-cb-gh-card';
    card.dataset.groupId = rec.id;
    if (rec.id === hubState.selectedId) card.classList.add('selected');

    const media = document.createElement('div');
    media.className = 'wl-cb-th-card-media';
    fillGroupAvatar(media, rec);
    card.appendChild(media);

    // Fav star — an <i> so Font Awesome's weight rules distinguish filled/outline
    // (same reasoning as the character card star). Click toggles without select.
    const star = document.createElement('i');
    applyStarState(star, rec.fav);
    star.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleGroupFav(rec, star);
    });
    media.appendChild(star);

    const body = document.createElement('div');
    body.className = 'wl-cb-th-card-body';

    const name = document.createElement('div');
    name.className = 'wl-cb-th-card-name';
    name.textContent = rec.name || '(unnamed group)';
    name.title = rec.name || '';
    body.appendChild(name);

    const count = document.createElement('div');
    count.className = 'wl-cb-th-card-count';
    count.textContent = `${rec.memberCount} ${rec.memberCount === 1 ? 'member' : 'members'}`;
    body.appendChild(count);

    if (rec.tagChips && rec.tagChips.length) {
        const tagRow = document.createElement('div');
        tagRow.className = 'wl-cb-gh-card-tags';
        for (const t of rec.tagChips) {
            const chip = document.createElement('span');
            chip.className = 'wl-cb-chip';
            chip.textContent = t.name;
            applyChipColor(chip, t);
            tagRow.appendChild(chip);
        }
        body.appendChild(tagRow);
    }

    body.appendChild(buildMiniAvatars(rec));
    card.appendChild(body);

    card.addEventListener('click', () => selectGroup(rec.id));
    return card;
}

/** Mini member-avatar strip: first MINI_AVATARS members + a "+N" chip. Reuses
 *  the Tag Hub's mini-avatar classes so the look matches. */
function buildMiniAvatars(rec) {
    const strip = document.createElement('div');
    strip.className = 'wl-cb-th-mini';
    const members = rec.members.filter(m => !m.missing);
    const shown = members.slice(0, MINI_AVATARS);
    for (const m of shown) {
        const dot = document.createElement('span');
        dot.className = 'wl-cb-th-mini-av';
        if (m.avatarUrl) dot.style.backgroundImage = `url("${m.avatarUrl.replace(/"/g, '%22')}")`;
        else dot.classList.add('wl-cb-th-mini-empty');
        dot.title = m.name;
        strip.appendChild(dot);
    }
    const extra = rec.memberCount - shown.length;
    if (extra > 0) {
        const more = document.createElement('span');
        more.className = 'wl-cb-th-mini-more';
        more.textContent = `+${extra}`;
        strip.appendChild(more);
    }
    return strip;
}

/** Paint a star element for a fav state (class + tooltip). Shared by card build
 *  and post-toggle repaint so they can't drift. */
function applyStarState(star, fav) {
    star.className = 'wl-cb-gh-star ' + (fav ? 'fa-solid fa-star is-fav' : 'fa-regular fa-star');
    star.title = fav ? 'Favorite' : 'Not a favorite';
}

/**
 * Toggle a group's favorite from a star element (card or detail). Optimistic:
 * flip the model + star immediately, persist via setGroupFavorite, roll back the
 * visual on failure. On success, notify the shell (onChanged) so anything keyed
 * off groups stays honest, and repaint the cards if a sort by fav-adjacent order
 * could shift (cheap; keeps the selected card's star in sync too).
 */
async function toggleGroupFav(rec, star) {
    const next = !rec.fav;
    rec.fav = next;
    applyStarState(star, next);
    const ok = await setGroupFavorite(rec.id, next);
    if (!ok) {
        rec.fav = !next;
        applyStarState(star, rec.fav);
        return;
    }
    // The clicked card star was already flipped optimistically above; a fav
    // change doesn't alter the card's position/content, so no repaint is needed.
    callbacks.onChanged?.();
}

/** Select a group: mark the card + repaint the right panel. In-place class swap
 *  (no full re-render) so scroll position holds. */
function selectGroup(groupId) {
    hubState.selectedId = groupId;
    if (cardsEl) {
        cardsEl.querySelectorAll('.wl-cb-gh-card.selected').forEach(c => c.classList.remove('selected'));
        const el = cardsEl.querySelector(`.wl-cb-gh-card[data-group-id="${cssEscape(groupId)}"]`);
        el?.classList.add('selected');
    }
    renderSelectionDetail();
}

function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/["\\\]]/g, '\\$&');
}

// ============================================================
// Right panel — group detail
// ============================================================

/**
 * Paint the selected group's detail into the SHARED right panel:
 *   hero (collage avatar + name + member count + fav star) · tag chips ·
 *   stats (Members / Last used / Chats) · Members list (each row → edit that
 *   character in the CDE) · actions (Open Chat + chat-picker · Delete).
 * Empty selection shows a gentle prompt.
 */
function renderSelectionDetail() {
    if (!detailBodyEl) return;
    const rec = recordFor(hubState.selectedId);
    if (detailEmptyEl) detailEmptyEl.style.display = 'none';
    detailBodyEl.innerHTML = '';

    if (!rec) {
        const empty = document.createElement('div');
        empty.className = 'wl-cb-empty';
        empty.textContent = 'Select a group.';
        detailBodyEl.appendChild(empty);
        return;
    }

    // Hero: avatar + name + count + fav star.
    const hero = document.createElement('div');
    hero.className = 'wl-cb-th-detail-hero';
    const av = document.createElement('div');
    av.className = 'wl-cb-gh-detail-av';
    fillGroupAvatar(av, rec);
    hero.appendChild(av);

    const htext = document.createElement('div');
    htext.className = 'wl-cb-th-detail-htext';
    const hname = document.createElement('div');
    hname.className = 'wl-cb-th-detail-name';
    hname.textContent = rec.name || '(unnamed group)';
    hname.title = rec.name || '';
    htext.appendChild(hname);
    const hcount = document.createElement('div');
    hcount.className = 'wl-cb-th-detail-count';
    hcount.textContent = `${rec.memberCount} ${rec.memberCount === 1 ? 'member' : 'members'}`;
    htext.appendChild(hcount);
    hero.appendChild(htext);
    // NOTE: no fav star in the detail hero — favoriting lives on the CARD star
    // (matching the character detail panel, which has no fav control either). An
    // earlier detail-hero star floated at the panel's top-right edge, reading as
    // a "rogue" star just right of the close button.
    detailBodyEl.appendChild(hero);

    // Tag chips (read-only in this view — groups are tagged in ST / the char
    // grid's bulk-tag path, per the scope decision).
    if (rec.tagChips && rec.tagChips.length) {
        const tags = document.createElement('div');
        tags.className = 'wl-cb-gh-detail-tags';
        for (const t of rec.tagChips) {
            const chip = document.createElement('span');
            chip.className = 'wl-cb-chip';
            chip.textContent = t.name;
            applyChipColor(chip, t);
            tags.appendChild(chip);
        }
        detailBodyEl.appendChild(tags);
    }

    // Stats — reuses the character detail's stat-row classes.
    detailBodyEl.appendChild(buildStats(rec));

    // Members section.
    detailBodyEl.appendChild(buildMembers(rec));

    // Actions: Open Chat (+ picker) and Delete.
    detailBodyEl.appendChild(buildActions(rec));
}

/** Stats block: Members, Last used, Chats. Omits rows whose value is absent. */
function buildStats(rec) {
    const box = document.createElement('div');
    box.className = 'wl-cb-detail-stats wl-cb-gh-detail-stats';
    const rows = [];
    rows.push(['Members', String(rec.memberCount)]);
    const last = formatLastUsed(rec.lastUsed);
    if (last) rows.push(['Last used', last]);
    if (rec.chats.length) rows.push(['Chats', String(rec.chats.length)]);

    for (const [label, value] of rows) {
        const row = document.createElement('div');
        row.className = 'wl-cb-stat-row';
        const l = document.createElement('span');
        l.className = 'wl-cb-stat-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.className = 'wl-cb-stat-value';
        v.textContent = value;
        v.title = value;
        row.append(l, v);
        box.appendChild(row);
    }
    return box;
}

/**
 * Members list: one row per member (avatar · name · edit pencil). The pencil
 * redirects to that CHARACTER's edit drawer (member edits are character edits,
 * per the scope decision) via the shell's onEditMember(index). A member whose
 * avatar no longer resolves to a character is shown greyed with no edit action.
 * Omitted entirely when the group has no members.
 */
function buildMembers(rec) {
    const box = document.createElement('div');
    box.className = 'wl-cb-gh-members';
    if (!rec.members.length) {
        box.style.display = 'none';
        return box;
    }

    const h = document.createElement('div');
    h.className = 'wl-cb-th-section-h';
    h.textContent = 'Members';
    box.appendChild(h);

    for (const m of rec.members) {
        const row = document.createElement('div');
        row.className = 'wl-cb-gh-member-row';
        if (m.missing) row.classList.add('wl-cb-gh-member-missing');

        const avatar = document.createElement('span');
        avatar.className = 'wl-cb-th-top-av';
        if (m.avatarUrl) avatar.style.backgroundImage = `url("${m.avatarUrl.replace(/"/g, '%22')}")`;
        else avatar.classList.add('wl-cb-th-mini-empty');
        row.appendChild(avatar);

        const name = document.createElement('div');
        name.className = 'wl-cb-gh-member-name';
        name.textContent = m.missing ? `${m.name} (missing)` : m.name;
        name.title = m.name;
        row.appendChild(name);

        // Edit → the character's own edit drawer. Only when the member resolves
        // to a real characters[] entry (we need its index to select it).
        if (!m.missing && m.index != null && typeof callbacks.onEditMember === 'function') {
            const edit = document.createElement('button');
            edit.className = 'wl-cb-gh-member-edit';
            edit.title = `Edit ${m.name}`;
            edit.setAttribute('aria-label', `Edit ${m.name}`);
            edit.innerHTML = '<i class="fa-solid fa-pen"></i>';
            edit.addEventListener('click', () => callbacks.onEditMember(m.index));
            row.appendChild(edit);
        }
        box.appendChild(row);
    }
    return box;
}

/**
 * Action block: Open Chat (primary) + a chat-picker (current-first; picking a
 * past chat opens THAT one), and a Delete button. Open Chat with the default
 * ("Current chat") opens the group's active chat. Delete confirms via ST's
 * generic popup, then deletes and refreshes the hub. Editing a group's own
 * fields (name/members/strategy) is NOT here — that stays with ST's native
 * panel; members are edited individually via the Members list.
 */
function buildActions(rec) {
    const box = document.createElement('div');
    box.className = 'wl-cb-detail-actions wl-cb-gh-detail-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'wl-cb-act wl-cb-act-primary';
    openBtn.innerHTML = '<i class="fa-solid fa-comments"></i> ';
    openBtn.appendChild(document.createTextNode('Open Chat'));

    // Chat picker: current chat first (default), then any other saved chats.
    const picker = document.createElement('select');
    picker.className = 'wl-cb-chat-picker';
    picker.title = 'Choose which chat to open';
    const chats = getGroupChats(rec);
    if (chats.length) {
        for (const chat of chats) {
            const opt = document.createElement('option');
            opt.value = chat.file;
            opt.textContent = chat.current ? `${chat.label} (current)` : chat.label;
            opt.title = chat.label;
            picker.appendChild(opt);
        }
    } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Current chat';
        picker.appendChild(opt);
    }

    openBtn.addEventListener('click', () => {
        const file = picker.value || '';
        picker.disabled = true;
        withControlBusy(openBtn, () => callbacks.onOpenGroup?.(rec, file))
            .finally(() => { if (picker.isConnected) picker.disabled = false; });
    });

    // Delete (danger) — confirm, then delete + refresh.
    const delBtn = document.createElement('button');
    delBtn.className = 'wl-cb-act wl-cb-gh-delete';
    delBtn.innerHTML = '<i class="fa-solid fa-trash"></i> ';
    delBtn.appendChild(document.createTextNode('Delete'));
    delBtn.addEventListener('click', () => confirmDelete(rec));

    box.append(openBtn, picker, delBtn);
    return box;
}

/**
 * Confirm + delete a group. Uses ST's generic confirm popup (falls back to the
 * native confirm() if that surface is unavailable). On confirm, deletes via
 * charData, drops the card, re-selects the first remaining group, and notifies
 * the shell (onChanged → nav "Groups" badge re-count).
 */
async function confirmDelete(rec) {
    const c = SillyTavern.getContext();
    let ok = false;
    try {
        if (c?.callGenericPopup && c?.POPUP_TYPE) {
            ok = await c.callGenericPopup(
                `Delete the group "${rec.name || '(unnamed)'}"? This removes the group and its chats. Member characters are not deleted.`,
                c.POPUP_TYPE.CONFIRM,
                '',
                { okButton: 'Delete', cancelButton: 'Cancel' },
            );
        } else {
            ok = window.confirm(`Delete the group "${rec.name || '(unnamed)'}"?`);
        }
    } catch (err) {
        console.warn('[BD] Char Browser: group delete confirm failed.', err);
        return;
    }
    if (!ok) return;

    const done = await deleteGroupById(rec.id);
    if (!done) return;

    // Re-derive without the deleted group; keep a sensible selection.
    deriveData();
    if (hubState.selectedId === rec.id) {
        hubState.selectedId = viewList()[0]?.id || null;
    }
    renderCards();
    renderSelectionDetail();
    callbacks.onChanged?.();
}

// ============================================================
// Formatting
// ============================================================

/** date_last_chat is epoch ms (0 = never). Absolute date, or "Never". */
function formatLastUsed(ms) {
    if (!ms) return 'Never';
    const dt = new Date(ms);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
}
