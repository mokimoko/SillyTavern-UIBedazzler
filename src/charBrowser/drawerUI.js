// src/charBrowser/drawerUI.js
// Character Browser — full-viewport takeover for the !hasCharacterContext()
// case (welcome screen / no character loaded). A build-fresh "hub" browser:
// authored cards from getContext().characters[] + a stats join, NOT a
// relocation of ST's native list. Counterpart to the expanded EDIT drawer
// (charDrawerExpanded/, wl-xd-).
//
// Namespace: wl-cb-  (edit drawer = wl-xd-; classic char drawer = wl-cd-;
// WI v2 = wl-wi2-).
//
// PHASE 1 SCOPE: 3-region shell (left nav / center grid+bar / right detail)
// as a body overlay, takeover/restore lifecycle, and the top-right ST action
// buttons RELOCATED in (New Character / Import / Import-from-URL / New Group)
// so their native handlers work for free. Grid and detail are empty scaffolds
// filled in later phases.
//
// RELOCATE-DON'T-CLONE is used ONLY where it's free (the action buttons). The
// grid itself is build-fresh (see plan): ST's card DOM doesn't expose per-card
// msg count / last-used / creator / star as authored chrome, so relocating
// would mean styling someone else's DOM and still not getting those fields.

import {
    initGrid,
    teardownGrid,
    setQuery,
    setSort,
    setFilter,
    getSort,
    refreshGrid,
    reassertSelection,
    refitTags,
    resyncPageSize,
    setMselMode,
    isMselMode,
    getPicked,
    pickRange,
    deselectAll,
} from './grid.js';
import { initCharBrowserData } from './charData.js';
import { flushSidecar } from '../sidecar.js';
import { initNav, teardownNav, setActiveFilter } from './nav.js';
import { renderDetail, clearDetail, setDetailActions } from './detail.js';
import {
    initTagHub,
    teardownTagHub,
    activateTagHub,
    deactivateTagHub,
    refreshTagHub,
    isTagHubActive,
} from './tagHub.js';
import {
    initGroupHub,
    teardownGroupHub,
    activateGroupHub,
    deactivateGroupHub,
    refreshGroupHub,
    isGroupHubActive,
} from './groupHub.js';
import { openMostRecentChat, openSpecificChat, editCharacter, openGroup } from './actions.js';
import { bulkFavorite, bulkTag, bulkDuplicate, bulkPersona, bulkDelete, teardownBulkActionWatchers } from './bulkActions.js';
import { openCardMenu, closeCardMenu } from './cardMenu.js';
// New Character → expanded drawer in CREATE mode. Same import direction
// actions.js already uses (browser → CDE), so no new cycle risk.
import { takeoverExpanded, isExpandedActive } from '../charDrawerExpanded/index.js';
// Group creation ends by OPENING the new group's chat. openGroupById isn't on
// the public context, so import it directly — same pattern as the CDE's
// script.js import (the extension lives six levels under public/).
import { openGroupById } from '../../../../../../scripts/group-chats.js';

const log = () => {};

const ROOT_ID = 'wl-cb-root';
const BODY_CLASS = 'wl-cb-open';

// ST action buttons we RELOCATE into our top bar. Each is a real ST control
// with a real click handler (create char, import file, import URL, new group);
// moving the node preserves the handler, so we must NOT rebuild their logic.
// Restored to their native home on close (via the relocation ledger).
const ACTION_BTN_IDS = [
    'rm_button_create',
    'character_import_button',
    'external_import_button',
    'rm_button_group_chats',
];

let isActive = false;
let container = null;
let escHandler = null;
let searchTimer = null;
let browserGeneration = 0;
// Live-sync bookkeeping (phase 5): the ST event listeners registered while the
// browser is open, so restore() can detach exactly what it attached. Each entry
// is { type, handler }. Plus a debounce timer so an event burst (e.g. an import
// firing CHARACTER_EDITED per card) collapses into one refresh.
let syncListeners = [];
let syncTimer = null;
// Relocation ledger — same shape as the edit drawer's: each record is either
//   { element, originalParent, originalNext }  — a moved node to put back, or
//   { element, style, original }               — an inline-style change to undo.
let relocatedElements = [];
// Group-create mode: TRUE while the native #rm_group_chats_block is hosted in
// our detail column. `groupWatchAbort` cancels an in-flight new-group poll if
// the mode (or the whole browser) closes before creation completes.
let groupCreateActive = false;
let groupWatchAbort = null;

// ============================================================
// Public state
// ============================================================

export function isCharBrowserActive() {
    return isActive;
}

// ============================================================
// Relocation helpers (mirror the edit drawer's ledger discipline)
// ============================================================

/**
 * Move a DOM element into a new parent, remembering where it came from so
 * restore() can put it back at the exact same spot.
 */
function relocate(element, newParent) {
    if (!element || !newParent) return;
    relocatedElements.push({
        element,
        originalParent: element.parentElement,
        originalNext: element.nextElementSibling,
    });
    newParent.appendChild(element);
}

// ============================================================
// Shell markup
// ============================================================

/**
 * Build the empty 3-region shell. Only structural wrappers + our own chrome
 * are authored here. Regions:
 *   .wl-cb-topbar   — search (left) + relocated ST action buttons + close
 *   .wl-cb-nav      — left hub nav (filters/views; scaffold this phase)
 *   .wl-cb-center   — chips/bulk bar + build-fresh grid + pagination (scaffold)
 *   .wl-cb-detail   — right detail panel (scaffold)
 *
 * Every id JS will target keeps a wl-cb- prefix. Regions are filled in later
 * phases (grid v1, detail v1, filters/views).
 */
function buildShell() {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
        <div class="wl-cb-topbar">
            <div class="wl-cb-search">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="search" id="wl-cb-search-input" placeholder="Search name, creator, tags…" autocomplete="off">
            </div>
            <select id="wl-cb-sort" class="wl-cb-sort" title="Sort characters">
                <option value="name_asc">A–Z</option>
                <option value="name_desc">Z–A</option>
                <option value="last_used">Last Used</option>
                <option value="most_messages">Most messages</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
            </select>
            <button class="menu_button wl-cb-msel-btn" id="wl-cb-msel-btn" title="Select multiple characters">
                <i class="fa-solid fa-list-check"></i>
            </button>
            <div class="wl-cb-topbar-actions">
                <div id="wl-cb-actions-slot"><!-- relocated ST action buttons --></div>
                <button class="wl-cb-close fa-solid fa-xmark" id="wl-cb-close" title="Close (Esc)"></button>
            </div>
        </div>
        <div class="wl-cb-body">
            <aside class="wl-cb-nav" id="wl-cb-nav">
                <!-- filters/views painted by nav.js on takeover -->
            </aside>
            <main class="wl-cb-center">
                <div class="wl-cb-center-scroll">
                    <div id="wl-cb-bulkbar" class="wl-cb-bulkbar" style="display:none">
                        <span class="wl-cb-bulk-count" id="wl-cb-bulk-count">0 selected</span>
                        <div class="wl-cb-bulk-actions">
                            <button class="wl-cb-bulk-btn" data-bulk="favorite" disabled title="Favorite the selected characters"><i class="fa-solid fa-star"></i><span>Favorite</span></button>
                            <button class="wl-cb-bulk-btn" data-bulk="tag" disabled title="Add or remove tags on the selected characters"><i class="fa-solid fa-tag"></i><span>Tag</span></button>
                            <button class="wl-cb-bulk-btn" data-bulk="duplicate" disabled title="Duplicate the selected characters"><i class="fa-solid fa-clone"></i><span>Duplicate</span></button>
                            <button class="wl-cb-bulk-btn" data-bulk="persona" disabled title="Convert the selected characters to personas"><i class="fa-solid fa-user"></i><span>Persona</span></button>
                            <button class="wl-cb-bulk-btn wl-cb-bulk-danger" data-bulk="delete" disabled title="Delete the selected characters"><i class="fa-solid fa-trash"></i><span>Delete</span></button>
                            <button class="wl-cb-bulk-btn wl-cb-bulk-deselect" id="wl-cb-bulk-deselect" disabled title="Deselect all — clear the selection but stay in multi-select"><i class="fa-solid fa-xmark"></i><span>Deselect All</span></button>
                            <button class="wl-cb-bulk-btn wl-cb-bulk-done" id="wl-cb-bulk-done" title="Done — exit multi-select"><i class="fa-solid fa-check"></i><span>Done</span></button>
                        </div>
                    </div>
                    <div id="wl-cb-grid"></div>
                    <div class="wl-cb-empty" id="wl-cb-grid-empty">No characters found.</div>
                    <div id="wl-cb-taghub" class="wl-cb-taghub" style="display:none"></div>
                    <div id="wl-cb-grouphub" class="wl-cb-grouphub" style="display:none"></div>
                </div>
                <div class="wl-cb-pagination" id="wl-cb-pagination"></div>
            </main>
            <aside class="wl-cb-detail" id="wl-cb-detail">
                <div class="wl-cb-empty" id="wl-cb-detail-empty">Select a character.</div>
                <div id="wl-cb-detail-body"></div>
            </aside>
        </div>
    `;
    return root;
}

// ============================================================
// Takeover / restore
// ============================================================

/**
 * Open the browser overlay. Idempotent: a second call while open is a no-op.
 *
 * Phase 1 relocates ONLY the top-right ST action buttons (build / import /
 * import-URL / new group) from #rm_button_bar into our action slot — their
 * native handlers ride along, so New Character / Import / etc. Just Work. The
 * grid and detail regions are authored chrome built in later phases, so there
 * is nothing else to relocate yet.
 *
 * NOTE ON COEXISTENCE: this browser is the !hasCharacterContext() overlay, so
 * no character is loaded when it opens — the classic (#character_popup) and
 * expanded EDIT (#form_create) drawers have nothing relocated in that state,
 * so there's no field-ownership arbitration to run here (unlike the edit
 * drawer's releaseCharDrawer()). If a future phase opens the browser OVER a
 * loaded char, add that arbitration then.
 *
 * @param {object} [opts]
 * @param {string} [opts.focusAvatar]  open on the page holding this character
 *        (and select it) instead of page 1 — the edit drawer's Back arrow passes
 *        the character being edited so the user returns where they left off.
 */
export function takeoverCharBrowser(opts = {}) {
    if (isActive || document.getElementById(ROOT_ID)) return;
    const generation = ++browserGeneration;

    relocatedElements = [];
    container = buildShell();
    const root = container;
    // Curtain down while we shuffle the DOM (mirrors the edit drawer).
    container.style.visibility = 'hidden';
    document.body.appendChild(container);

    relocateActionButtons();
    wireChrome();
    applyThemeClass(); // tag wl-cb-dark for the image scrim on dark themes

    document.body.classList.add(BODY_CLASS);
    isActive = true;

    requestAnimationFrame(() => {
        if (browserGeneration === generation && container === root) root.style.visibility = '';
    });

    // Register the detail-panel action callbacks BEFORE initGrid — initGrid
    // fires the first onSelect (default selection) synchronously enough that the
    // panel's Open Chat / Edit buttons must already have live handlers. Each
    // action closes the browser via restoreCharBrowser (passed as closeBrowser).
    setDetailActions({
        // Return the action promise so the detail panel's busy-spinner can
        // await it (clears when the open settles / the browser tears down).
        onOpenChat: (model, chatFile) => {
            return chatFile
                ? openSpecificChat(model, chatFile, restoreCharBrowser)
                : openMostRecentChat(model, restoreCharBrowser);
        },
        onEdit: (model) => editCharacter(model, restoreCharBrowser),
    });

    // Mount the left-nav filters BEFORE initGrid — initGrid's first paint calls
    // pushNavCounts() → nav.setCounts(), which needs the nav buttons to exist.
    // onFilter re-scopes the grid; nav owns its own active-state visuals. The
    // special 'tags-hub' id flips the CENTER into the Tag Hub instead of
    // re-scoping the grid; every other id is a normal grid filter (and must
    // first exit hub mode if we were in it). After a real filter switch, resync
    // the sort dropdown (per-filter default may differ).
    initNav({
        navEl: container.querySelector('#wl-cb-nav'),
        onFilter: (navId) => {
            if (navId === 'tags-hub') {
                enterTagHubMode();
                return;
            }
            if (navId === 'groups-hub') {
                enterGroupHubMode();
                return;
            }
            // A normal grid filter → leave whichever hub owns the center first
            // (both write into the shared detail region), then re-scope the grid.
            if (isTagHubActive()) exitTagHubMode();
            if (isGroupHubActive()) exitGroupHubMode();
            setFilter(navId);
            syncSortSelect();
        },
    });

    // Grid is build-fresh + async (stats fetch): kick it off after the shell is
    // visible so the overlay paints immediately and the cards fill in. initGrid
    // picks the default selection and fires onSelect → the detail panel. While
    // the Tag Hub owns the detail region, we SUPPRESS grid onSelect (a live-sync
    // refresh re-fires it) so it can't overwrite tag detail with character
    // detail; the hub restores character detail itself on exit.
    const detailEmpty = container.querySelector('#wl-cb-detail-empty');
    const detailBody = container.querySelector('#wl-cb-detail-body');

    // Kick off the shared sidecar load (tag-meta + page-size live there now).
    // Reads are synchronous off its cache; if it hasn't resolved yet the grid
    // paints with default page-size / empty tag-meta, then this callback fires
    // once the load lands and repaints with the real values. Guarded on isActive
    // so a load that resolves after the user already closed the browser is a
    // no-op. Idempotent + shared with the WI drawer's subject store.
    initCharBrowserData(() => {
        if (!isActive || browserGeneration !== generation || container !== root) return;
        resyncPageSize();          // adopt the stored page size (grid repaints if it changed)
        if (isTagHubActive()) refreshTagHub();
        else if (isGroupHubActive()) refreshGroupHub();
        else refreshGrid(false);   // repaint cards/detail with real tag-meta
    });

    initGrid({
        gridEl: container.querySelector('#wl-cb-grid'),
        pagerEl: container.querySelector('#wl-cb-pagination'),
        emptyEl: container.querySelector('#wl-cb-grid-empty'),
        // Open on the page holding this character (edit drawer's Back arrow).
        focusAvatar: opts.focusAvatar || null,
        onSelect: (model) => {
            // Don't paint character detail when another surface owns the shared
            // detail region: the Tag Hub, the Groups Hub, OR an in-progress
            // native group-create panel hosted in the detail column. The
            // groupCreateActive guard fixes a real bug — while creating a group,
            // a debounced live-sync refresh (fired ~250ms after a tag/member
            // interaction) would call onSelect and overwrite the create panel
            // with a character's detail ("kicked off the creation scene").
            if (isTagHubActive() || isGroupHubActive() || groupCreateActive) return;
            if (detailEmpty) detailEmpty.style.display = 'none';
            renderDetail(detailBody, model);
        },
        // Keep the bulk-bar count/enabled state live as cards are ticked.
        onMselChange: (count) => updateBulkBar(count),
        // Right-click a card → per-character context menu (Tag / Duplicate /
        // Persona / Delete). Opens at the cursor; actions route through the same
        // bulkActions path with a one-element avatar list (see runCardAction).
        onCardContextMenu: (model, e) => {
            openCardMenu(model, e.clientX, e.clientY, runCardAction);
        },
        // Shift-click a card while another is selected → jump straight into
        // multi-select with that range picked. The shell owns the transition so
        // the bulk-bar + button light correctly (enterMselMode), THEN we fill the
        // spanned range. Guarded by isTagHubActive inside enterMselMode.
        onRequestRangeSelect: (fromAvatar, toAvatar) => {
            if (isTagHubActive()) return;
            enterMselMode();
            pickRange(fromAvatar, toAvatar);
        },
    });

    // Tag Hub: init (no paint) after the grid so getModels() is populated when
    // the hub first activates. View-All-Characters jumps back to the grid scoped
    // to the tag (tag:<id>), syncing the nav's visual + the sort dropdown.
    initTagHub({
        hostEl: container.querySelector('#wl-cb-taghub'),
        detailBodyEl: detailBody,
        detailEmptyEl: detailEmpty,
        onViewCharacters: (tagId) => {
            exitTagHubMode();
            const navId = 'tag:' + tagId;
            setFilter(navId);
            setActiveFilter(navId); // visual only (no per-tag nav row to light)
            syncSortSelect();
        },
        // Clicking a Top Character opens its most-recent chat and closes the
        // browser — same as the character detail panel's Open Chat.
        onOpenCharacter: (model) => {
            // Return the promise so the Top Character row's busy-spinner awaits it.
            return openMostRecentChat(model, restoreCharBrowser);
        },
    });

    // Groups Hub: init (no paint) after the grid so getGroupModels() is ready
    // when the hub first activates. Its detail panel shares the same region as
    // char + tag detail (shell guards grid onSelect while it's active). Open
    // Chat / member-edit / New Group all route back through the shell here so
    // groupHub.js stays free of ST pipeline + relocation logic.
    initGroupHub({
        hostEl: container.querySelector('#wl-cb-grouphub'),
        detailBodyEl: detailBody,
        detailEmptyEl: detailEmpty,
        // Open the group's chat (current or a picked past chat) and close.
        onOpenGroup: (model, chatId) => openGroup(model, chatId, restoreCharBrowser),
        // A member edit IS a character edit → reuse the browser→CDE bridge with
        // that member's characters[] index (selects the char, opens the drawer).
        onEditMember: (index) => editCharacter({ index }, restoreCharBrowser),
        // New Group → drive ST's native create flow via the relocated top-bar
        // button (its native handler seeds group-create state; our slot listener
        // then hosts the panel in the detail column via enterGroupCreateMode).
        onNewGroup: () => document.getElementById('rm_button_group_chats')?.click(),
        // A fav/delete changed the group set → repaint the grid's nav badges
        // (the "Groups" count lives there). Cheap; no stats refetch.
        onChanged: () => refreshGrid(false),
    });

    // Keep the open browser in sync with changes made elsewhere (native edit
    // saves, deletes, imports, chatting) — see registerSync. Attached last so
    // the grid/detail exist before any event can fire a refresh.
    registerSync();

    log('Character Browser opened');
}

// ============================================================
// Tag Hub mode (center = hub instead of grid)
// ============================================================

/**
 * Flip the center region from the character grid to the Tag Hub. Hides the
 * grid + pagination + grid empty-state, shows the hub container, and hides the
 * top-bar sort <select> (the hub has its own sort control). Idempotent.
 */
function enterTagHubMode() {
    if (!container) return;
    // The Tag Hub and Groups Hub both own the center + shared detail — never
    // both at once. Leave the Groups Hub first if it's up.
    if (isGroupHubActive()) exitGroupHubMode();
    const grid = container.querySelector('#wl-cb-grid');
    const gridEmpty = container.querySelector('#wl-cb-grid-empty');
    const pager = container.querySelector('#wl-cb-pagination');
    const hub = container.querySelector('#wl-cb-taghub');
    const sort = container.querySelector('#wl-cb-sort');
    const search = container.querySelector('#wl-cb-search-input');
    if (grid) grid.style.display = 'none';
    if (gridEmpty) gridEmpty.style.display = 'none';
    if (pager) pager.style.display = 'none';
    if (hub) hub.style.display = '';
    if (sort) sort.style.display = 'none';
    // The top-bar search filters CHARACTERS; the hub has its own tag search, so
    // disable the character search while in the hub to avoid a dead control.
    if (search) { search.disabled = true; search.placeholder = 'Search in Tags view…'; }
    // Multi-select is a card-grid feature only. Force it off (which hides the
    // bulk-bar + clears the selection) and disable its toggle while in the hub.
    if (isMselMode()) exitMselMode();
    setMselButtonEnabled(false);
    activateTagHub();
}

/**
 * Return the center to the character grid. Restores grid/pagination/sort/search
 * visibility, deactivates the hub (releasing the onSelect guard), and hands the
 * detail panel back to the selected character. Idempotent.
 */
function exitTagHubMode() {
    if (!container) return;
    const grid = container.querySelector('#wl-cb-grid');
    const pager = container.querySelector('#wl-cb-pagination');
    const hub = container.querySelector('#wl-cb-taghub');
    const sort = container.querySelector('#wl-cb-sort');
    const search = container.querySelector('#wl-cb-search-input');
    deactivateTagHub();
    if (hub) hub.style.display = 'none';
    if (grid) grid.style.display = '';
    if (pager) pager.style.display = '';
    if (sort) sort.style.display = '';
    if (search) { search.disabled = false; search.placeholder = 'Search characters…'; }
    // Back on the card grid → multi-select is available again.
    setMselButtonEnabled(true);
    // The grid may have re-rendered while hidden (e.g. a hidden-tags save calls
    // refreshGrid under the hub), so its tag rows measured at width 0 and skipped
    // the "+N" trim. Now that it's visible, re-fit them.
    refitTags();
    // Hub wrote tag content into the shared detail panel — restore the selected
    // character's detail now that the guard is released.
    reassertSelection();
}

// ============================================================
// Groups Hub mode (center = groups instead of grid) — parallel to the Tag Hub
// ============================================================

/**
 * Flip the center region from the character grid to the Groups Hub. Same
 * treatment as enterTagHubMode: hide grid/pager/grid-empty + the top-bar sort
 * (the hub has its own), disable the character search (the hub has its own group
 * search), force multi-select off + disable its toggle (a card-grid feature),
 * and leave the Tag Hub first if it's up. Idempotent.
 */
function enterGroupHubMode() {
    if (!container) return;
    if (isTagHubActive()) exitTagHubMode();
    const grid = container.querySelector('#wl-cb-grid');
    const gridEmpty = container.querySelector('#wl-cb-grid-empty');
    const pager = container.querySelector('#wl-cb-pagination');
    const hub = container.querySelector('#wl-cb-grouphub');
    const sort = container.querySelector('#wl-cb-sort');
    const search = container.querySelector('#wl-cb-search-input');
    if (grid) grid.style.display = 'none';
    if (gridEmpty) gridEmpty.style.display = 'none';
    if (pager) pager.style.display = 'none';
    if (hub) hub.style.display = '';
    if (sort) sort.style.display = 'none';
    if (search) { search.disabled = true; search.placeholder = 'Search in Groups view…'; }
    if (isMselMode()) exitMselMode();
    setMselButtonEnabled(false);
    activateGroupHub();
}

/**
 * Return the center to the character grid from the Groups Hub. Restores grid/
 * pagination/sort/search visibility, deactivates the hub (releasing the grid's
 * onSelect guard), re-fits the grid's tag rows (they measured at width 0 while
 * hidden), and hands the detail panel back to the selected character. Idempotent.
 */
function exitGroupHubMode() {
    if (!container) return;
    const grid = container.querySelector('#wl-cb-grid');
    const pager = container.querySelector('#wl-cb-pagination');
    const hub = container.querySelector('#wl-cb-grouphub');
    const sort = container.querySelector('#wl-cb-sort');
    const search = container.querySelector('#wl-cb-search-input');
    deactivateGroupHub();
    if (hub) hub.style.display = 'none';
    if (grid) grid.style.display = '';
    if (pager) pager.style.display = '';
    if (sort) sort.style.display = '';
    if (search) { search.disabled = false; search.placeholder = 'Search characters…'; }
    setMselButtonEnabled(true);
    refitTags();
    reassertSelection();
}

// ============================================================
// Multi-select mode (card grid) — UI-only for now; the bulk ACTION buttons
// are inert placeholders (wired in a later slice). This slice delivers the
// toggle, the selection interaction (in grid.js), and the bulk-bar chrome.
// ============================================================

/**
 * Turn multi-select ON: flips the grid into pick mode, reveals the bulk-bar,
 * and lights the toggle button. Guarded so it's a no-op in the Tag Hub (which
 * disables the button anyway) and when already active.
 */
function enterMselMode() {
    if (!container || isTagHubActive() || isGroupHubActive() || isMselMode()) return;
    setMselMode(true);
    const bar = container.querySelector('#wl-cb-bulkbar');
    if (bar) bar.style.display = '';
    const btn = container.querySelector('#wl-cb-msel-btn');
    if (btn) btn.classList.add('is-active');
    updateBulkBar(0);
}

/**
 * Turn multi-select OFF: clears the selection (setMselMode(false) does that),
 * hides the bulk-bar, and un-lights the toggle. Safe to call when already off.
 */
function exitMselMode() {
    if (!container) return;
    setMselMode(false);
    const bar = container.querySelector('#wl-cb-bulkbar');
    if (bar) bar.style.display = 'none';
    const btn = container.querySelector('#wl-cb-msel-btn');
    if (btn) btn.classList.remove('is-active');
}

/** Toggle multi-select on the button / second-click. */
function toggleMselMode() {
    if (isMselMode()) exitMselMode();
    else enterMselMode();
}

/**
 * Enable/disable the top-bar multi-select toggle (disabled while the Tag Hub
 * owns the center). Purely the button's own affordance; mode state is separate.
 */
function setMselButtonEnabled(on) {
    if (!container) return;
    const btn = container.querySelector('#wl-cb-msel-btn');
    if (btn) btn.disabled = !on;
}

/**
 * Reflect the current pick count in the bulk-bar: updates the "N selected"
 * label AND enables/disables the action buttons
 * (Favorite/Tag/Duplicate/Persona/Delete) — they act on the picked SET, so
 * they're only live when at least one card is ticked. Deselect All is live only
 * with a selection (nothing to clear otherwise). Done is always live (it's the
 * exit).
 */
function updateBulkBar(count) {
    if (!container) return;
    const label = container.querySelector('#wl-cb-bulk-count');
    if (label) label.textContent = `${count} selected`;
    // Enable the wired actions only when something is selected.
    const on = count > 0;
    for (const act of ['favorite', 'tag', 'duplicate', 'persona', 'delete']) {
        const btn = container.querySelector(`.wl-cb-bulk-btn[data-bulk="${act}"]`);
        if (btn) btn.disabled = !on;
    }
    // Deselect All follows the same "needs a selection" rule but is keyed by id
    // (no data-bulk, so the delegated action listener ignores it).
    const deselectBtn = container.querySelector('#wl-cb-bulk-deselect');
    if (deselectBtn) deselectBtn.disabled = !on;
}

/**
 * Run a bulk action against the current picked set, then reconcile the UI.
 * Snapshots the picked avatars up front (the set is a live reference that a
 * post-action refresh mutates). Each action's onDone fires after ST's mutation
 * settles: we refresh the grid WITH stats (msg counts / Recents can shift on
 * duplicate/delete) and exit multi-select — except Tag, which keeps the
 * selection so the user can chain actions, and only refreshes (no stats needed
 * for a tag change; refresh re-derives tag chips + facet counts).
 *
 * Guarded so a click with nothing selected (shouldn't happen — buttons disable)
 * is a no-op. All the ST-pipeline reach lives in bulkActions.js.
 */
function runBulkAction(action) {
    if (!container || !isMselMode()) return;
    const picked = [...getPicked()];
    if (!picked.length) return;

    switch (action) {
        case 'favorite':
            bulkFavorite(picked, {
                onDone: () => { refreshGrid(true); exitMselMode(); },
            });
            break;
        case 'duplicate':
            bulkDuplicate(picked, {
                onDone: () => { refreshGrid(true); exitMselMode(); },
            });
            break;
        case 'delete':
            bulkDelete(picked, {
                onDone: () => { refreshGrid(true); exitMselMode(); },
            });
            break;
        case 'persona':
            // Persona conversion doesn't touch the character grid (it writes to
            // power_user.personas), so no stats refresh — just exit multi-select
            // like ST's own bulk path returns to browse state after.
            bulkPersona(picked, {
                onDone: () => { exitMselMode(); },
            });
            break;
        case 'tag':
            // Keep the selection live (chain-friendly); refresh on popup close so
            // tag chips + facet counts re-derive. No stats refetch needed.
            bulkTag(picked, {
                onDone: () => { refreshGrid(false); },
            });
            break;
        default:
            break;
    }
}

/**
 * Run a per-character context-menu action for ONE model (from the card
 * right-click menu). Reuses the exact bulkActions path with a one-element avatar
 * list — a single-character op is just a "bulk" of one, which is why ST's tag
 * popup handles it too. Unlike runBulkAction there's no multi-select to exit
 * (the menu is independent of pick mode); we just refresh after. Favorite is
 * intentionally NOT offered here (the card star owns it). Persona converts the
 * one character to a user persona (bulkPersona of one); it writes to
 * power_user.personas, not the grid, so it needs no refresh.
 *
 * @param {string} action  'tag' | 'duplicate' | 'persona' | 'delete'
 * @param {object} model   the character view-model (carries .avatar)
 */
function runCardAction(action, model) {
    if (!model || !model.avatar) return;
    const one = [model.avatar];

    switch (action) {
        case 'duplicate':
            bulkDuplicate(one, { onDone: () => refreshGrid(true) });
            break;
        case 'delete':
            bulkDelete(one, { onDone: () => refreshGrid(true) });
            break;
        case 'persona':
            // No grid refresh — persona conversion doesn't alter the character list.
            bulkPersona(one);
            break;
        case 'tag':
            bulkTag(one, { onDone: () => refreshGrid(false) });
            break;
        default:
            break;
    }
}

/**
 * Relocate ST's top-right action buttons into our action slot. Refs are read
 * from the document (they live in #rm_button_bar inside #rm_characters_block).
 * Any that aren't present are skipped — the browser still opens. Order in the
 * slot follows ACTION_BTN_IDS.
 */
function relocateActionButtons() {
    const slot = container.querySelector('#wl-cb-actions-slot');
    if (!slot) return;
    for (const id of ACTION_BTN_IDS) {
        const btn = document.getElementById(id);
        if (btn) relocate(btn, slot);
    }

    // DELEGATED takeover hooks for New Character / New Group. Listening on OUR
    // slot (bubble phase) means: the native handler on the button itself fires
    // FIRST (it sets up ST's create / group-create state beneath us), then ours
    // runs the Bedazzler-side takeover. The listener dies with the container,
    // so the native buttons go home clean — no manual detach needed.
    slot.addEventListener('click', (e) => {
        if (e.target.closest('#rm_button_create')) {
            onNewCharacterClick();
        } else if (e.target.closest('#rm_button_group_chats')) {
            onNewGroupClick();
        }
    });
}

/**
 * New Character (browser entry). ST's native handler — same click, already run
 * — flipped menuType to 'create' and seeded #form_create. We close the browser
 * and open the expanded drawer, which detects create mode itself and becomes
 * the create surface. Two-rAF defer so select_rm_create's DOM writes are fully
 * painted before the drawer captures/relocates those nodes (same discipline as
 * the Edit bridge in actions.js).
 */
function onNewCharacterClick() {
    restoreCharBrowser();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!isExpandedActive()) takeoverExpanded();
    }));
}

/**
 * New Group (browser entry). ST's native handler — same click — switched the
 * hidden right-menu into group-create mode and is populating
 * #rm_group_chats_block (name/avatar/strategy controls + Current Members + Add
 * Members). Instead of closing, we host that panel in OUR detail column. One
 * rAF so the native menu switch settles first; population may still be
 * in-flight, which is fine — ST writes to the nodes by id, and they resolve
 * wherever the node lives (i.e. inside our column after relocation).
 */
function onNewGroupClick() {
    requestAnimationFrame(() => enterGroupCreateMode());
}

// ============================================================
// Group-create mode (native panel hosted in the detail column)
// ============================================================

/**
 * Flip the detail column into group creation: authored header ("Create Group"
 * + X cancel) with the RELOCATED native #rm_group_chats_block beneath it.
 * Every native handler rides along — the Add Members list mutates ST's
 * newGroupMembers, the checkmark (#rm_group_submit) runs createGroup(), avatar
 * picking, tags, strategy selects, all untouched. The character detail that
 * was in the column is simply dropped; exit re-renders it via reassertSelection.
 *
 * If the Tag Hub owns the center/detail, exit it first (the hub and this mode
 * both write into the shared detail body).
 */
function enterGroupCreateMode() {
    if (!container || groupCreateActive) return;
    // The Tag Hub / Groups Hub both write into the shared detail column that
    // this mode takes over — leave whichever is active first.
    if (isTagHubActive()) exitTagHubMode();
    if (isGroupHubActive()) exitGroupHubMode();

    const detailBody = container.querySelector('#wl-cb-detail-body');
    const detailEmpty = container.querySelector('#wl-cb-detail-empty');
    const block = document.getElementById('rm_group_chats_block');
    if (!detailBody || !block) return;

    groupCreateActive = true;
    if (detailEmpty) detailEmpty.style.display = 'none';
    detailBody.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.id = 'wl-cb-groupcreate';
    wrap.innerHTML = `
        <div class="wl-cb-gc-head">
            <span class="wl-cb-gc-title"><i class="fa-solid fa-users"></i><span>Create Group</span></span>
            <button type="button" class="wl-cb-gc-cancel" title="Cancel group creation">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div id="wl-cb-gc-slot"></div>
    `;
    detailBody.appendChild(wrap);

    wrap.querySelector('.wl-cb-gc-cancel')?.addEventListener('click', () => exitGroupCreateMode(true));

    // Host the whole native panel (one node, every handler intact). Rides the
    // shared ledger, so a browser close mid-create also restores it.
    relocate(block, wrap.querySelector('#wl-cb-gc-slot'));

    // Creation watcher — delegated on OUR wrap so it dies with the mode. The
    // native handler on #rm_group_submit (same click) runs createGroup(); we
    // snapshot the group-id set synchronously (before its async POST can land)
    // and await growth. On success: leave the mode WITHOUT the native back-
    // click (ST's own post-create flow already moved the hidden menus), close
    // the browser, and open the new group's chat — "create and go". A
    // validation no-op (ST creates even nameless groups, but e.g. a server
    // error) simply times out with no side effects.
    wrap.addEventListener('click', async (e) => {
        if (!e.target.closest('#rm_group_submit')) return;
        let before;
        try {
            before = new Set((SillyTavern.getContext().groups || []).map(g => g?.id).filter(Boolean));
        } catch (err) {
            return;
        }
        const newId = await waitForNewGroup(before, 15000);
        if (!newId || !groupCreateActive) return;
        exitGroupCreateMode(false);
        restoreCharBrowser();
        try {
            await openGroupById(newId);
        } catch (err) {
            console.error('[BD] Char Browser: opening the new group failed.', err);
        }
    });
}

/**
 * Leave group-create mode: targeted-restore the native block to its home in
 * the (hidden) right nav, optionally click ST's own back button to reset the
 * native menu state (cancel path — the post-create path skips it because ST
 * already navigated), drop our authored wrap, and hand the detail column back
 * to the selected character.
 *
 * @param {boolean} clickBack  true on user cancel; false after a successful create
 */
function exitGroupCreateMode(clickBack) {
    if (!container || !groupCreateActive) return;
    groupCreateActive = false;
    if (groupWatchAbort) { groupWatchAbort(); groupWatchAbort = null; }

    // Targeted restore: pull the block's record out of the shared ledger and
    // apply it now (most-recent match wins — it's the one this mode pushed).
    const block = document.getElementById('rm_group_chats_block');
    for (let i = relocatedElements.length - 1; i >= 0; i--) {
        const r = relocatedElements[i];
        if (r.element === block && r.originalParent) {
            if (r.originalNext && r.originalNext.parentElement === r.originalParent) {
                r.originalParent.insertBefore(block, r.originalNext);
            } else {
                r.originalParent.appendChild(block);
            }
            relocatedElements.splice(i, 1);
            break;
        }
    }

    // Cancel path: reset ST's menu state through its own back button (the
    // node just went home, and its handler was never disturbed).
    if (clickBack) document.getElementById('rm_button_back_from_group')?.click();

    container.querySelector('#wl-cb-groupcreate')?.remove();
    reassertSelection();
}

/**
 * Resolve with the id of the first group NOT in `beforeSet`, polling the live
 * context every 250ms; null on timeout or abort. The abort hook lets a mode /
 * browser close cancel the poll so a late-created group can't trigger a
 * navigation out of nowhere.
 */
function waitForNewGroup(beforeSet, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now();
        let aborted = false;
        groupWatchAbort = () => { aborted = true; resolve(null); };
        const tick = () => {
            if (aborted) return;
            let groups = [];
            try {
                groups = SillyTavern.getContext().groups || [];
            } catch (err) { /* keep polling; ctx may hiccup mid-refresh */ }
            const fresh = groups.find(g => g?.id && !beforeSet.has(g.id));
            if (fresh) { groupWatchAbort = null; resolve(fresh.id); return; }
            if (Date.now() - started >= timeoutMs) { groupWatchAbort = null; resolve(null); return; }
            setTimeout(tick, 250);
        };
        tick();
    });
}

/**
 * Close the overlay and return every relocated element to its exact original
 * home. Restores in REVERSE order so originalNext references stay valid as
 * siblings return (same discipline as the edit drawer's restore). Safe to call
 * when already closed.
 */
export function restoreCharBrowser() {
    if (!isActive) return;
    browserGeneration++;

    // Group-create mode bookkeeping: the native block itself rides the shared
    // ledger home below, but the mode flag + any in-flight creation watcher
    // must drop now (a late poll firing after close could navigate the user).
    // Note: on a mid-create close, ST's menu state stays in group_create — the
    // user lands on the native group panel, exactly as if they'd clicked New
    // Group natively. Consistent, so we leave it.
    groupCreateActive = false;
    if (groupWatchAbort) { groupWatchAbort(); groupWatchAbort = null; }

    // Close any open card context menu (it lives on <body>, outside the
    // container, so it won't die with container.remove()).
    closeCardMenu();
    teardownBulkActionWatchers();
    if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = null;
    }

    if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
    }

    // Detach ST event listeners + cancel any pending debounced refresh BEFORE
    // tearing down the grid, so a late-firing event can't schedule a refresh
    // against a half-dismantled grid.
    teardownSync();

    // Grid + detail + nav + hub are authored chrome that die with the container,
    // but clear their module state so a fresh open starts clean.
    teardownGrid();
    teardownNav();
    teardownTagHub();
    teardownGroupHub();
    clearDetail();

    // Flush any pending sidecar write (a just-made tag-meta or page-size edit)
    // so it lands promptly on close rather than waiting out the debounce. The
    // sidecar keeps its cache alive for the session, so a reopen won't re-fetch.
    flushSidecar();

    for (let i = relocatedElements.length - 1; i >= 0; i--) {
        const record = relocatedElements[i];
        if (record.originalParent) {
            const { element, originalParent, originalNext } = record;
            if (originalNext && originalNext.parentElement === originalParent) {
                originalParent.insertBefore(element, originalNext);
            } else {
                originalParent.appendChild(element);
            }
        } else if (record.style) {
            record.element.style[record.style] = record.original;
        }
    }

    relocatedElements = [];
    container?.remove();
    container = null;
    document.body.classList.remove(BODY_CLASS);
    isActive = false;

    log('Character Browser restored');
}

// ============================================================
// Live sync (phase 5) — keep the open browser current with ST
// ============================================================

// How long to wait after the last event before refreshing. An import or bulk
// edit fires many events back-to-back; this collapses the storm into one paint.
const SYNC_DEBOUNCE_MS = 250;

/**
 * Schedule a debounced grid refresh. `withStats` forces a stats re-fetch (used
 * for chat/message events, where msg counts + last-used shift and Recents must
 * re-derive). Membership-only events (edit/delete/import) refresh without the
 * extra stats round-trip. If ANY pending refresh in the window asked for stats,
 * the coalesced refresh includes them (favour freshness).
 */
let syncWantsStats = false;
function scheduleSync(withStats) {
    if (!isActive) return;
    if (withStats) syncWantsStats = true;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncTimer = null;
        const wantsStats = syncWantsStats;
        syncWantsStats = false;
        // refreshGrid is async + self-guards on a torn-down grid; it also
        // re-derives the nav facets (so the Tags badge stays live). When the Tag
        // Hub owns the center, repaint IT too once the grid's models are rebuilt
        // — the hub reads grid.getModels(), so it must run after refreshGrid.
        refreshGrid(wantsStats).then(() => {
            if (isTagHubActive()) refreshTagHub();
            else if (isGroupHubActive()) refreshGroupHub();
        });
    }, SYNC_DEBOUNCE_MS);
}

/**
 * Register ST event listeners so the open browser reflects changes made
 * elsewhere (native edit drawer saves, deletes, imports, and chatting) without
 * a close/reopen or page reload. All handlers just schedule a debounced
 * refresh; the grid keeps the current selection if it survives, else re-defaults.
 *
 *   CHARACTER_EDITED / _DELETED / _DUPLICATED / _PAGE_LOADED → membership/detail
 *       may have changed → refresh models (no forced stats).
 *   CHAT_CHANGED / MESSAGE_SENT / MESSAGE_RECEIVED → counts + last-used shifted
 *       → refresh WITH stats so msg totals and Recents self-update live.
 *
 * Uses getContext().eventSource + eventTypes (falls back to event_types). Guarded
 * so a missing event surface never breaks takeover — the browser still works,
 * just without live sync (the on-open fetch still gives a fresh snapshot).
 */
function registerSync() {
    syncListeners = [];
    syncWantsStats = false;
    try {
        const c = SillyTavern.getContext();
        const es = c.eventSource;
        const et = c.eventTypes || c.event_types;
        if (!es?.on || !et) {
            console.warn('[BD] Char Browser: event surface unavailable — live sync off.');
            return;
        }
        // [eventType, forcesStatsRefetch]
        const bindings = [
            [et.CHARACTER_EDITED, false],
            [et.CHARACTER_DELETED, false],
            [et.CHARACTER_DUPLICATED, false],
            [et.CHARACTER_PAGE_LOADED, false],
            // Group edits (fav/rename/member/strategy, native or ours) shift the
            // Groups Hub — refresh models, no stats. CHARACTER_PAGE_LOADED already
            // fires after group ops reload characters, but GROUP_UPDATED catches
            // an in-place edit that doesn't reload.
            [et.GROUP_UPDATED, false],
            [et.CHAT_CHANGED, true],
            [et.MESSAGE_SENT, true],
            [et.MESSAGE_RECEIVED, true],
        ];
        for (const [type, withStats] of bindings) {
            if (!type) continue; // tolerate ST renaming/removing an event
            const handler = () => scheduleSync(withStats);
            es.on(type, handler);
            syncListeners.push({ type, handler });
        }
    } catch (err) {
        console.warn('[BD] Char Browser: live sync registration failed.', err);
    }
}

/** Detach every listener registered by registerSync and cancel any pending
 *  debounced refresh. Safe to call when none are registered. */
function teardownSync() {
    if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
    }
    syncWantsStats = false;
    try {
        const es = SillyTavern.getContext().eventSource;
        if (es?.removeListener) {
            for (const { type, handler } of syncListeners) {
                es.removeListener(type, handler);
            }
        }
    } catch (err) {
        console.warn('[BD] Char Browser: live sync teardown hiccup.', err);
    }
    syncListeners = [];
}

// ============================================================
// Chrome wiring
// ============================================================

function wireChrome() {
    // Close button → restore to normal ST view.
    const closeBtn = container.querySelector('#wl-cb-close');
    if (closeBtn) closeBtn.addEventListener('click', () => restoreCharBrowser());

    // Multi-select toggle → enter/leave pick mode. Clicking a second time (or
    // the bulk-bar's Done) exits. Disabled while the Tag Hub owns the center.
    const mselBtn = container.querySelector('#wl-cb-msel-btn');
    if (mselBtn) mselBtn.addEventListener('click', () => toggleMselMode());
    const doneBtn = container.querySelector('#wl-cb-bulk-done');
    if (doneBtn) doneBtn.addEventListener('click', () => exitMselMode());

    // Deselect All → clear the picked set but STAY in multi-select, so the user
    // can immediately start a fresh selection (e.g. tag a different batch)
    // without toggling the mode off and back on. deselectAll() drives the count
    // callback → updateBulkBar, so the bar's count + button states refresh.
    const deselectBtn = container.querySelector('#wl-cb-bulk-deselect');
    if (deselectBtn) deselectBtn.addEventListener('click', () => deselectAll());

    // Bulk action buttons (Favorite / Tag / Duplicate / Persona / Delete). Delegated off
    // the actions row so one listener covers them all; the data-bulk value picks
    // the action. Guarded
    // on :disabled so a click on a disabled button (nothing selected) no-ops.
    const bulkActions = container.querySelector('.wl-cb-bulk-actions');
    if (bulkActions) {
        bulkActions.addEventListener('click', (e) => {
            const btn = e.target.closest('.wl-cb-bulk-btn[data-bulk]');
            if (!btn || btn.disabled) return;
            const action = btn.dataset.bulk;
            runBulkAction(action);
        });
    }

    // Live name search → grid filter. Debounced (~120ms) so a burst of fast
    // typing collapses into ONE re-render after a short pause, instead of a full
    // grid rebuild + per-card tag-row re-measure on EVERY keystroke — the cost
    // that shows up at large page sizes. The delay is below the threshold of
    // feeling laggy while still coalescing a run of keystrokes. A timer left
    // pending when the drawer closes is cancelled during teardown.
    const search = container.querySelector('#wl-cb-search-input');
    if (search) {
        search.addEventListener('input', () => {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                searchTimer = null;
                setQuery(search.value);
            }, 120);
        });
    }

    // Sort dropdown → grid sort. The grid owns the source-of-truth sort (it can
    // change on filter switch), so we sync the <select> FROM the grid on open
    // and after each filter switch; here we just push user changes INTO the grid.
    const sort = container.querySelector('#wl-cb-sort');
    if (sort) {
        sort.addEventListener('change', () => setSort(sort.value));
    }
    // Reflect the grid's initial (per-filter default) sort in the dropdown.
    syncSortSelect();

    // Esc closes the overlay (document-level; detached on restore). While the
    // search box is focused with text, Esc clears the box first (native search
    // behaviour) rather than closing — so a stray Esc mid-typing doesn't dump
    // the whole browser.
    escHandler = (e) => {
        if (e.key !== 'Escape') return;
        // If ST's bulk-tag popup (or the modern generic popup) is open OVER the
        // browser, let it own Escape — don't exit multi-select or close the
        // browser out from under it. The popup handles its own dismissal.
        if (document.getElementById('bulk_tag_shadow_popup') || document.querySelector('.popup:not([hidden])')) {
            return;
        }
        if (search && document.activeElement === search && search.value) {
            // Let the input's own clear happen; re-filter next tick.
            setTimeout(() => setQuery(search.value), 0);
            return;
        }
        // In multi-select, Esc exits pick mode first rather than dumping the
        // whole browser — mirrors the search-clear guard above.
        if (isMselMode()) {
            e.preventDefault();
            exitMselMode();
            return;
        }
        e.preventDefault();
        restoreCharBrowser();
    };
    document.addEventListener('keydown', escHandler);
}

/**
 * Push the grid's current sort into the sort <select> so its displayed value
 * matches what's actually applied. Needed because the grid — not the dropdown —
 * owns the sort: it changes on filter switch (per-filter defaults) and on open.
 * Guarded on container so it's safe to call before/after teardown.
 */
function syncSortSelect() {
    if (!container) return;
    const sel = container.querySelector('#wl-cb-sort');
    if (sel) sel.value = getSort();
}

// ============================================================
// Theme (dark/light) detection
// ============================================================

// ST themes are freeform (users pick arbitrary colors) — there's no built-in
// "dark mode" flag. So we detect it the way the rest of Bedazzler reasons about
// color: sample the theme's background tint and measure its luminance. If it's
// dark, tag the root with wl-cb-dark so the CSS can add a subtle scrim over card
// / detail images. We only style the dark case for now (light gets nothing).

/**
 * Add/remove the wl-cb-dark class on the root based on the active theme's
 * background luminance. Called on open. Any parse failure falls back to "assume
 * dark", since Bedazzler's default palette is dark — that keeps the intended
 * look on the common case rather than dropping the scrim.
 */
function applyThemeClass() {
    if (!container) return;
    container.classList.toggle('wl-cb-dark', isDarkTheme());
}

/**
 * True if the current ST theme reads as dark. Samples --SmartThemeBlurTintColor
 * (the panel/blur background tint), falling back to --SmartThemeBodyColor, and
 * compares perceptual luminance against a mid threshold. Defaults to dark when
 * neither variable resolves to a parseable color.
 */
function isDarkTheme() {
    const cs = getComputedStyle(document.body);
    const raw = cs.getPropertyValue('--SmartThemeBlurTintColor').trim()
        || cs.getPropertyValue('--SmartThemeBodyColor').trim();
    const rgb = parseCssColor(raw);
    if (!rgb) return true; // unknown → assume dark (Bedazzler's default palette)
    // Rec. 601 luma, same weights designUtils uses. 0–255 scale; <128 = dark.
    const luma = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    return luma < 128;
}

/**
 * Parse a CSS color string into {r,g,b} (0–255). Handles #rgb / #rrggbb and
 * rgb()/rgba(). Alpha is ignored (we only care about the base tint's darkness).
 * Returns null for anything unrecognised (named colors, hsl) so the caller can
 * fall back.
 */
function parseCssColor(str) {
    if (!str) return null;
    const s = str.trim();
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        let h = hex[1];
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
        };
    }
    const rgb = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
    if (rgb) {
        return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
    }
    return null;
}
