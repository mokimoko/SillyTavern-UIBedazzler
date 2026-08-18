// src/worldInfoDrawerV2/rail.js
// WI v2 rail — presets, "Read for this chat" bindings, strategy, library.
//
// Direct port of the mock's rail (wi-v2-mockup.html ~2775-3010) with mock
// state swapped for railData's ST reads. The mock's invariants carried over:
//  - ONE renderRail() — every mutation that changes what's read or what's
//    open re-renders all lists, so they can't drift (mock's rule).
//  - The dot tracks ONE fact (global membership) and is a control only where
//    it's OURS (isOurs); read-but-not-ours rows get the hollow ring.
//  - The ROW always opens the book (§9.26), in every list.
//  - globalBooks is a READ of #world_info; toggling goes through the shared
//    applyBooks write-path (railData.toggleGlobalBook).
//
// §9.30 (arrival): last-opened-for-this-chat → chat book → nothing. FULL
// chain as of the listcol pour: per-chat memory lives in chat_metadata
// (railData.get/setLastOpenedBook); only explicit opens record it.
// §9.31 (unsaved edits on switch): openBookByName stays the single gate —
// every switch notifies onOpenBookChanged, and the listcol's loadBook()
// FLUSHES the pending debounced save of the outgoing book before loading
// the next (listData.flushPendingSave — v1's model, where "unsaved" is at
// most a 400ms debounce window, so the guard is a flush, not a dialog).

import {
    getAllBookNames, getGlobalBooks, getChatBookName, getPersonaBookName,
    getCharBooks, toggleGlobalBook, getStrategyKey, setStrategyKey,
    pruneCountCache, getCachedCount, loadCounts,
    getLastOpenedBook, setLastOpenedBook,
} from './railData.js';
import { registerPresetHost, resetPrePresetSnapshot } from './presets.js';
import { refreshTopbar } from './topbar.js';
// Book-row right-click menu (bookMenu) → book-level actions (bookActions).
// bookActions imports refreshRail/requestOpenBook back from here; that cycle
// is function-level only (nothing runs at module eval), so ESM resolves it —
// the same shape as this file's mutual import with topbar.
import { openBookMenu, closeBookMenu } from './bookMenu.js';
import { renameBook, duplicateBook, exportBook, deleteBook } from './bookActions.js';
import { onBookRenamed } from './subjectStore.js';

const log = () => {};

// ============================================================
// State — refreshed from ST on open / chat change / our own writes
// ============================================================

let railEl = null;          // the .wl-wi2-rail root while open
let allBooks = [];          // every book on disk
let globalBooks = [];       // READ of #world_info at last refresh
let chatBook = null;
let personaBook = null;
let charBooks = [];         // [{name, primary}]
let strategy = 'character_first';
let openBook = null;        // §9.26/§9.30 — consumed by the listcol
let bookListObserver = null;// watches #world_editor_select for book create/delete/rename/dup/import
let countObserver = null;

const STRAT = {
    evenly:          { label: 'evenly — one pool, by rank',
                       hint: 'character + global merged into ONE list, sorted by rank' },
    character_first: { label: 'the character\u2019s, then global',
                       hint: 'read ALL of the character\u2019s books before ANY global' },
    global_first:    { label: 'global, then the character\u2019s',
                       hint: 'read ALL global books before ANY of the character\u2019s' },
};

const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function getOpenBookName() {
    return openBook;
}

export function hasOpenBookSelection() {
    return !!openBook && allBooks.includes(openBook);
}

// ============================================================
// Derived facts — straight ports of the mock's rules
// ============================================================

/** Character books lose to any other binding that already claimed them
 *  (engine ~4417) — read at that binding's spot, skipped here. */
const charBooksRead = () => charBooks
    .filter(b => !globalBooks.includes(b.name) && b.name !== chatBook && b.name !== personaBook)
    .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));

/** Is this book ours to toggle? Only selected_world_info is (§8.1). A char
 *  book that's ALSO global stays ours so it can be released — otherwise it'd
 *  be trapped: globaled, shadowed, and with no control to undo it. */
function isOurs(name) {
    if (name === chatBook || name === personaBook) return false;
    if (charBooks.some(b => b.name === name) && !globalBooks.includes(name)) return false;
    return true;
}

function bindingOf(name) {
    if (name === chatBook) return 'this chat';
    if (name === personaBook) return 'your persona';
    if (globalBooks.includes(name)) return 'global';
    if (charBooks.some(b => b.name === name)) return 'the character\u2019s';
    return null;
}

/** What's actually READ after the de-dup ladder — the folded-state summary. */
function activeBookCount() {
    const names = new Set();
    if (chatBook) names.add(chatBook);
    if (personaBook) names.add(personaBook);
    charBooksRead().forEach(b => names.add(b.name));
    globalBooks.forEach(n => names.add(n));
    return names.size;
}

// ============================================================
// Row builders — the mock's bookRow, verbatim in structure
// ============================================================

/** Count span content: cached number, or empty while the load is in flight. */
const cnt = name => {
    const n = getCachedCount(name);
    return n == null ? '' : n;
};

/** `ours` decides BOTH the dot's meaning and whether it's a control (mock). */
const bookRow = (name, ours) =>
    `<div class="wl-wi2-book on ${ours ? 'ours' : ''} ${name === openBook ? 'sel' : ''}"`
    + ` data-book="${esc(name)}" title="${esc(name === openBook ? 'Open \u2014 you\u2019re editing this book' : 'Click to open this book')}">`
    + `<span class="wl-wi2-dot ${ours ? 'lit' : ''}"${ours ? ` data-globaltoggle="${esc(name)}" title="Read as global \u2014 click to turn off"` : ''}></span>`
    + `${esc(name)}<span class="wl-wi2-cnt" data-cnt="${esc(name)}">${cnt(name)}</span></div>`;

const charRow = b => bookRow(b.name, false);
const globalRow = name => bookRow(name, true);

// ============================================================
// Renders — bindings, strategy, all-books, count; one renderRail()
// ============================================================

function renderBindings() {
    railEl.querySelector('#wl-wi2-bindChat').innerHTML =
        chatBook ? bookRow(chatBook, false)
                 : `<div class="wl-wi2-rail-hint">No lorebook bound to this chat.</div>`;
    railEl.querySelector('#wl-wi2-bindPersona').innerHTML =
        personaBook ? bookRow(personaBook, false)
                    : `<div class="wl-wi2-rail-hint">No lorebook on your persona.</div>`;
}

function renderStrategy() {
    const el = railEl.querySelector('#wl-wi2-bindStrategy');
    const chars = charBooksRead();
    const charPart = `<div class="wl-wi2-bind-sub">The character\u2019s</div>`
        + (chars.length ? chars.map(charRow).join('') : `<div class="wl-wi2-rail-hint">None attached to this character.</div>`);
    const globalPart = `<div class="wl-wi2-bind-sub">Global</div>`
        + (globalBooks.length ? globalBooks.map(globalRow).join('') : `<div class="wl-wi2-rail-hint">None turned on.</div>`);
    let body;
    if (strategy === 'evenly') {
        const pooled = [...chars.map(charRow), ...globalBooks.map(globalRow)].join('');
        body = `<div class="wl-wi2-bind-sub">Character + global \u2014 one pool, by rank</div>`
            + (pooled || `<div class="wl-wi2-rail-hint">Nothing here yet.</div>`);
    }
    else if (strategy === 'global_first') body = globalPart + charPart;
    else body = charPart + globalPart;
    el.innerHTML = `
        <div class="wl-wi2-bind-head"><span class="wl-wi2-bind-n">3</span>Then: <button class="wl-wi2-strat-btn" id="wl-wi2-stratBtn">${STRAT[strategy].label}</button></div>
        ${body}
        <div class="wl-wi2-strat-pop" id="wl-wi2-stratPop">
            ${Object.entries(STRAT).map(([k, s]) => `<button data-strat="${k}" class="${k === strategy ? 'on' : ''}">${s.label}<small>${s.hint}</small></button>`).join('')}
        </div>`;
    const btn = el.querySelector('#wl-wi2-stratBtn');
    const pop = el.querySelector('#wl-wi2-stratPop');
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); pop.classList.toggle('open'); });
    pop.addEventListener('click', ev => ev.stopPropagation());
    pop.querySelectorAll('[data-strat]').forEach(b => b.addEventListener('click', async () => {
        await setStrategyKey(b.dataset.strat);   // through ST's own control
        strategy = await getStrategyKey();       // read back — ST owns it
        renderStrategy();
    }));
}

function renderAllBooks() {
    const el = railEl.querySelector('#wl-wi2-allBooks');
    const q = (railEl.querySelector('#wl-wi2-bookFilter')?.value || '').trim().toLowerCase();
    const rows = allBooks
        .filter(name => !q || name.toLowerCase().includes(q))
        .map(name => {
            const bind = bindingOf(name);
            // TWO different facts, deliberately kept apart (mock's bug-fix):
            //   isGlobal = the thing the dot CONTROLS (selected_world_info).
            //   bind     = where it's actually READ.
            const isGlobal = globalBooks.includes(name);
            const ours = isOurs(name);
            const shadowed = charBooks.some(b => b.name === name) && bind && bind !== 'the character\u2019s';
            const bindNote = !bind ? 'not read in this chat'
                : shadowed ? `attached to this character, but read as ${bind} \u2014 it only counts once`
                : `read as ${bind}`;
            const title = `${name === openBook ? 'Open' : 'Click to open'} \u00b7 ${bindNote}`;
            return `<div class="wl-wi2-book ${bind ? 'on' : ''} ${ours ? 'ours' : ''} ${name === openBook ? 'sel' : ''}"
                data-book="${esc(name)}" title="${esc(title)}">
                <span class="wl-wi2-dot ${isGlobal ? 'lit' : ''}" data-globaltoggle="${esc(name)}"
                    title="${esc(isGlobal ? 'Read as global \u2014 click to turn off' : ours ? 'Click to turn on globally' : `Read as ${bind} \u2014 set outside this panel`)}"></span>${esc(name)}<span class="wl-wi2-cnt" data-cnt="${esc(name)}">${cnt(name)}</span></div>`;
        }).join('');
    el.innerHTML = rows || `<div class="wl-wi2-rail-hint">No lorebooks match.</div>`;
    railEl.querySelector('#wl-wi2-allCount').textContent = allBooks.length;
    observeVisibleCounts();
}

function renderActiveCount() {
    railEl.querySelector('#wl-wi2-activeCount').textContent = activeBookCount();
}

/** One re-render for the whole rail (mock's rule) — lists can't drift. */
function renderRail() {
    if (!railEl) return;
    renderBindings();
    renderStrategy();
    renderAllBooks();
    renderActiveCount();
}

function paintCount(name, count) {
    if (!railEl || count == null) return;
    railEl.querySelectorAll(`[data-cnt="${CSS.escape(name)}"]`)
        .forEach(span => { span.textContent = count; });
}

function loadCountNames(names, token = refreshToken) {
    loadCounts(names.filter(Boolean), paintCount,
        () => !!railEl && token === refreshToken);
}

/** Entry counts are decorative, so load active books immediately and defer the
 * library to rows that are actually visible in its scroll viewport. */
function observeVisibleCounts() {
    countObserver?.disconnect();
    countObserver = null;
    if (!railEl) return;
    const scroll = railEl.querySelector('#wl-wi2-allBooks');
    if (!scroll || typeof IntersectionObserver === 'undefined') return;
    const token = refreshToken;
    countObserver = new IntersectionObserver(entries => {
        const names = [];
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            countObserver?.unobserve(entry.target);
            const name = entry.target.dataset.cnt;
            if (name && getCachedCount(name) == null) names.push(name);
        }
        if (names.length) loadCountNames(names, token);
    }, { root: scroll, rootMargin: '120px 0px' });
    scroll.querySelectorAll('.wl-wi2-cnt[data-cnt]').forEach(span => {
        if (getCachedCount(span.dataset.cnt) == null) countObserver.observe(span);
    });
}

// ============================================================
// Open-book state — §9.26 gate, §9.30 memory, §9.31 wiring point
// ============================================================

let openBookListeners = [];
export function onOpenBookChanged(fn) {
    openBookListeners.push(fn);
}

/**
 * The ONE place openBook changes. Everything funnels here: explicit row
 * clicks (record=true — a choice, so §9.30 remembers it), refresh-driven
 * arrivals (record=false — a landing, not a choice), and chat switches.
 * Notifying from a single site is what lets §9.31's guard live in the
 * listcol's loadBook: every switch, whatever caused it, reaches the flush.
 */
function setOpenBook(name, { record = false } = {}) {
    if (name === openBook) return false;
    openBook = name;
    if (record && name) setLastOpenedBook(name);
    openBookListeners.forEach(fn => { try { fn(name); } catch { /* no-op */ } });
    return true;
}

/**
 * §9.26: the ROW opens the book, in every list. Explicit opens record the
 * per-chat memory (§9.30). §9.31: the switch itself is guarded downstream —
 * the listcol's onOpenBookChanged handler flushes the outgoing book's
 * pending save before loading the new one (listData.loadBook).
 */
function openBookByName(name) {
    if (!setOpenBook(name, { record: true })) return;
    renderRail();   // .sel moves wherever the book appears
}

/**
 * PUBLIC book-switch, for callers OUTSIDE the rail (the simulator's §9.33
 * click-through: a trace row names a note that may live in a book you don't
 * have open). Delegates to openBookByName so the gate stays singular — same
 * record=true, same listener notify, same §9.31 flush downstream. Returns
 * true if a switch was actually requested (the target differs from the open
 * book), so the caller knows whether to wait for the async load before it
 * selects the note.
 */
export function requestOpenBook(name) {
    if (!name || name === openBook) return false;
    openBookByName(name);
    return true;
}

// The native select emits the authoritative old/new names when a rename lands.
// Follow the renamed book without polling and preserve the user's selection.
onBookRenamed((oldName, newName) => {
    if (!railEl || openBook !== oldName) return;
    setOpenBook(newName, { record: true });
    refreshRail();
});

/**
 * §9.30 arrival chain: last-opened-for-this-chat → chat book → nothing.
 * On a plain refresh, a still-valid open book WINS (don't yank the floor out
 * from under an edit); on a chat switch, the chain re-runs for the NEW chat
 * — the rail is chat-scoped truth, and so is where you left off.
 */
function resolveArrival(chatSwitched) {
    if (!chatSwitched && openBook && allBooks.includes(openBook)) return;
    const last = getLastOpenedBook();
    const next = (last && allBooks.includes(last)) ? last
        : (chatBook && allBooks.includes(chatBook)) ? chatBook
        : null;
    setOpenBook(next);
}

// ============================================================
// State refresh + mutations
// ============================================================

// Guards against overlapping refreshes on a fast CHAT_CHANGED burst: each call
// takes a token, gathers into LOCALS across its awaits, and commits only if it's
// still the newest. A stale call (a newer one started mid-await) drops entirely,
// so an older read can never clobber a newer one or render after it.
let refreshToken = 0;

/** Re-read everything from ST, then render. Counts stream in afterwards. */
async function refreshState({ chatSwitched = false } = {}) {
    const token = ++refreshToken;
    if (chatSwitched) setOpenBook(null);

    // Gather into locals — nothing commits to module state until we know this
    // refresh is still the current one (past every await).
    const nextAllBooks = getAllBookNames();
    const nextGlobalBooks = getGlobalBooks();
    const nextChatBook = await getChatBookName();
    const nextPersonaBook = getPersonaBookName();
    const nextCharBooks = await getCharBooks();
    const nextStrategy = await getStrategyKey();

    // A newer refresh superseded us while we awaited — drop this stale one.
    if (token !== refreshToken || !railEl) return;

    allBooks = nextAllBooks;
    pruneCountCache(allBooks);
    globalBooks = nextGlobalBooks;
    chatBook = nextChatBook;
    personaBook = nextPersonaBook;
    charBooks = nextCharBooks;
    strategy = nextStrategy;

    resolveArrival(chatSwitched);

    renderRail();
    refreshTopbar();

    // Active/open books get counts immediately. Library-only books are loaded
    // lazily as their rows enter the scroll viewport.
    loadCountNames([
        openBook, chatBook, personaBook,
        ...charBooksRead().map(b => b.name),
        ...globalBooks,
    ], token);
}

function onToggleGlobal(name) {
    if (!isOurs(name)) return;      // guard lives with the mutation (mock)
    toggleGlobalBook(name);         // shared write-path; change event fires
    globalBooks = getGlobalBooks(); // jQuery trigger is sync — re-read now
    renderRail();
}

// ============================================================
// Markup + wiring
// ============================================================

function railHTML() {
    return `
        <div class="wl-wi2-preset-row">
            <select class="wl-wi2-preset-select"></select>
            <div class="wl-wi2-preset-actions">
                <button data-preset-action="save" title="Update this preset with what's on now">&#10003;</button>
                <button data-preset-action="new" title="New preset from what's on now">+</button>
                <button data-preset-action="delete" title="Delete this preset">&#10005;</button>
                <button data-preset-action="more" title="Rename &#183; Import &#183; Export">&#8942;</button>
            </div>
        </div>
        <div class="wl-wi2-rail-sep"></div>
        <button class="wl-wi2-rail-label wl-wi2-rail-label-hot" id="wl-wi2-activeHead" aria-expanded="true">
            <span class="wl-wi2-chev">&#9662;</span>Read for this chat
            <span class="wl-wi2-rail-count" id="wl-wi2-activeCount"></span>
        </button>
        <div class="wl-wi2-rail-active" id="wl-wi2-railActive">
            <div class="wl-wi2-bind-group">
                <div class="wl-wi2-bind-head"><span class="wl-wi2-bind-n">1</span>This chat</div>
                <div id="wl-wi2-bindChat"></div>
            </div>
            <div class="wl-wi2-bind-group">
                <div class="wl-wi2-bind-head"><span class="wl-wi2-bind-n">2</span>Your persona</div>
                <div id="wl-wi2-bindPersona"></div>
            </div>
            <div class="wl-wi2-bind-group" id="wl-wi2-bindStrategy"></div>
        </div>
        <div class="wl-wi2-rail-sep"></div>
        <div class="wl-wi2-rail-label">All lorebooks <span class="wl-wi2-rail-count" id="wl-wi2-allCount"></span></div>
        <input class="wl-wi2-rail-search" type="search" placeholder="Filter lorebooks\u2026" id="wl-wi2-bookFilter">
        <div class="wl-wi2-rail-scroll" id="wl-wi2-allBooks"></div>
    `;
}

// ============================================================
// Public lifecycle
// ============================================================

// ============================================================
// Book-row context menu — right-click any row (either section)
// ============================================================

/** Route a book-menu choice to the shared action layer. Every branch drives
 *  ST's own control (bookActions), which refreshes the rail afterwards. */
function onBookMenuAction(action, name) {
    switch (action) {
        case 'rename':    renameBook(name); break;
        case 'duplicate': duplicateBook(name); break;
        case 'export':    exportBook(name); break;
        case 'delete':    deleteBook(name); break;
    }
}

/** Watch ST's #world_editor_select option list for structural book changes
 *  (create / delete / rename / duplicate / import) and re-read the rail when
 *  ST actually repopulates it. This is the RELIABLE signal — unlike a fixed
 *  post-action delay, it fires exactly when the change commits, however long
 *  ST's own dialog stayed open (the rename-didn't-show-until-reopen bug).
 *  Mirrors v1's watchSTBookChanges. Selecting a book (setSTEditorTo) only
 *  changes .value, not the option list, so this never fires on a plain open. */
function watchBookList() {
    unwatchBookList();
    const sel = document.querySelector('#world_editor_select');
    if (!sel) return;
    bookListObserver = new MutationObserver(() => {
        if (!railEl) return;
        if (openBook && !getAllBookNames().includes(openBook)) setOpenBook(null);
        refreshRail();
    });
    bookListObserver.observe(sel, { childList: true });
}

function unwatchBookList() {
    if (bookListObserver) { bookListObserver.disconnect(); bookListObserver = null; }
}

/** Build + wire the rail inside its region. Called from takeoverWiV2. */
export function initRail(rootEl) {
    railEl = rootEl;
    railEl.innerHTML = railHTML();

    resetPrePresetSnapshot();

    // Delegated per-list so it survives re-render (mock's wiring, one list at
    // a time; the whole rail root would also catch preset-row clicks).
    ['wl-wi2-bindChat', 'wl-wi2-bindPersona', 'wl-wi2-bindStrategy', 'wl-wi2-allBooks'].forEach(id => {
        railEl.querySelector(`#${id}`).addEventListener('click', (ev) => {
            const dot = ev.target.closest('[data-globaltoggle]');
            if (dot) {
                ev.stopPropagation();
                onToggleGlobal(dot.dataset.globaltoggle);
                return;
            }
            const row = ev.target.closest('[data-book]');
            if (row) openBookByName(row.dataset.book);
        });
    });

    // Right-click any book row → the book context menu (Rename · Duplicate ·
    // Export · Delete). ONE delegated listener on the persistent rail root, so
    // it covers rows in BOTH sections ("Read for this chat" and "All
    // lorebooks") and survives every renderRail() (the rows are rebuilt, the
    // root isn't). preventDefault suppresses the browser's own menu.
    railEl.addEventListener('contextmenu', (ev) => {
        const row = ev.target.closest('[data-book]');
        if (!row) return;
        ev.preventDefault();
        const name = row.dataset.book;
        if (name !== openBook) openBookByName(name);
        openBookMenu(name, ev.clientX, ev.clientY, onBookMenuAction);
    });

    // Reliable book-list refresh: re-read whenever ST repopulates its editor
    // select (a rename/duplicate/delete/new/import committed), independent of
    // how long ST's dialog stayed open.
    watchBookList();

    // Collapse (§9.25). Default OPEN (§9.27) — primary navigation.
    const head = railEl.querySelector('#wl-wi2-activeHead');
    head.addEventListener('click', () => {
        const closed = railEl.classList.toggle('wl-wi2-active-closed');
        head.setAttribute('aria-expanded', String(!closed));
    });

    // Library filter — re-render just the list it narrows.
    railEl.querySelector('#wl-wi2-bookFilter')
        .addEventListener('input', () => renderAllBooks());

    // Close the strategy popover on any click that escaped it (its own
    // handlers stopPropagation, so reaching the rail root means "outside").
    railEl.addEventListener('click', () => {
        railEl.querySelector('.wl-wi2-strat-pop.open')?.classList.remove('open');
    });

    // Presets — v2 registers as a host of the SHARED module (§9.28). A preset
    // (de)activation rewrites #world_info, i.e. binding 3's global sub-group,
    // so the refresh is a full state re-read.
    registerPresetHost({
        root: railEl,
        prefix: 'wl-wi2',
        // A preset rewrites #world_info (books) AND the budget/scan globals,
        // so both the rail and the topbar re-read (§9.28: control adjacent
        // to consequence — the meter must move when a preset moves it).
        onApplied: () => { refreshState(); refreshTopbar(); },
    });

    refreshState();
    log('Rail initialized');
}

/** Re-read + re-render (chat switched, external book change). Safe when
 *  closed. Pass { chatSwitched: true } from CHAT_CHANGED so §9.30's arrival
 *  chain re-runs for the NEW chat (a plain refresh keeps the open book). */
export function refreshRail(opts) {
    if (!railEl) return;
    refreshState(opts);
}

/** Drop references on overlay close. openBook survives module-lifetime so a
 *  reopen within the session lands where you left off — and §9.30's per-chat
 *  memory (chat_metadata) now carries it across sessions too. */
export function teardownRail() {
    // Close any open book context menu so it can't outlive the overlay (its
    // own outside-click/scroll dismissal usually handles this, but a close via
    // Esc/close-button leaves no such event — belt-and-braces).
    closeBookMenu();
    unwatchBookList();
    countObserver?.disconnect();
    countObserver = null;
    refreshToken++;
    railEl = null;
    openBook = null;
    allBooks = [];
    // openBookListeners IS cleared here — and this is the OPPOSITE of
    // listcol's noteListeners, which must NOT be. The difference is who
    // subscribes and when:
    //   - listcol subscribes to openBookChanged PER-INIT (initListcol calls
    //     onOpenBookChanged every open). So the array must start empty each
    //     open, or each reopen would stack another loadOpenBook per switch.
    //     Clearing on close is what keeps it at exactly one.
    //   - the editor subscribes to noteListeners ONCE at module load and
    //     never again, so clearing THAT array on close would leave zero
    //     listeners on every reopen (the reopen-freeze bug, 2026-07-18).
    // Same array pattern, opposite teardown rule, because the subscription
    // lifetimes differ. Do not "make them consistent" — that breaks one.
    openBookListeners = [];
}
