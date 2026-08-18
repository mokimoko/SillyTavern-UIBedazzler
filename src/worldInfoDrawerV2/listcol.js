// src/worldInfoDrawerV2/listcol.js
// WI v2 note list — the middle column. Port of the mock's renderList /
// multi-select / bulk bar (wi-v2-mockup.html ~1370-1430, ~2240-2410) with
// mock ENTRIES swapped for the open book's real data (listData.js), plus the
// three list mechanics the mock never had, taken from v1's proven models
// (entryList.js): search, sort, and pagination.
//
// Mock invariants carried over:
//  - Groups derive from THE DATA, never a fixed array (§9.24) — a note whose
//    subject isn't listed must not vanish. (Sidecar §9.4 is still deferred,
//    so today subjectOf() answers 'General' for everything and the list is
//    one flat group — exactly the state an imported v1 book is defined to
//    start in. When the sidecar lands, subjectOf() is the ONE seam.)
//  - Ticking is not opening: the checkbox cell stops propagation.
//  - Leaving multi-select clears the selection — a hidden tick that survives
//    is a selection you can't see and didn't confirm.
//  - Selection is scoped to the open book; a book switch clears it.
//  - Bulk actions are DISABLED at zero selection, not hidden.
//
// Real-data mapping (ST entry → mock note-row):
//   title      entry.comment, else first key, else untitled
//   glyph      disable→shelved · constant→always · vectorized→meaning · else topic
//   rank chip  entry.order (fmtRank)
//   timing     sticky→lingers · cooldown→rests · delay→waits
//
// §9.31: every book switch reaches this column through rail's
// onOpenBookChanged → listData.loadBook, whose first act is
// flushPendingSave() on the outgoing book. Nothing here switches books
// directly — the rail's openBookByName stays the single gate.

import { getOpenBookName, onOpenBookChanged, refreshRail, requestOpenBook } from './rail.js';
import { dropCount, getAllBookNames } from './railData.js';
import {
    getBook, getEntry, loadBook,
    createEntry, deleteEntries, transferEntries, confirmPopup, flushPendingSave,
    scheduleSave,
} from './listData.js';
import { getSubject, setSubject, subjectsInBook, onSubjectsChanged, beginNoteMetaBatch, endNoteMetaBatch } from './subjectStore.js';

const log = () => {};

// ============================================================
// State — UI state only; the book itself lives in listData
// ============================================================

let root = null;            // #wl-wi2-listCol while open
let selectedUid = null;     // string uid of the open note (editor's input)
// Sim click-through (§9.33): when the simulator asks to open a note in a book
// that isn't open yet, the switch is async (rail → onOpenBookChanged →
// loadOpenBook). We can't select the note until that load lands, so we stash
// the wanted uid here and loadOpenBook's arrival consumes it INSTEAD of
// defaulting to the book's first note. One load path, no race, no double-load.
let pendingGotoUid = null;
let bookLoadToken = 0;
// Injected by drawerUI: bring the editor tab forward (the sim lives in another
// tab, so opening a note must switch views). Set once at takeover.
let showEditorTab = null;
export function setShowEditorTab(fn) { showEditorTab = fn; }
let mselOn = false;
const picked = new Set();   // numeric uids ticked for bulk ops (v1 keys by uid)
// Shift-click range anchor: the uid of the last checkbox toggled WITHOUT shift.
// A shift-click fills every visible row between the anchor and the target to the
// target's new state (the file-manager convention). Null until the first tick;
// cleared whenever the selection is wiped so a stale anchor can't span a range
// the user can no longer see. shiftHeldNext bridges the click→change gap: the
// 'change' event carries no modifier keys, so the preceding 'click' on the cell
// records whether shift was down for the change handler to consume.
let rangeAnchorUid = null;
let shiftHeldNext = false;
// Wipe the selection AND the range anchor together — an anchor with nothing
// picked would let the next shift-click span a range from a row the user can't
// remember ticking. Every place that empties `picked` goes through here.
function clearPicked() { picked.clear(); rangeAnchorUid = null; }
let searchQuery = '';
let sortMode = 8;           // v1's sort values; 8 = Order (rank) descending
let page = 0;
const PAGE_SIZE = 50;
let isBulkOperating = false;

const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ============================================================
// Public surface — consumed by the editor pour
// ============================================================

let noteListeners = [];
export function onSelectedNoteChanged(fn) {
    noteListeners.push(fn);
}

export function getSelectedUid() {
    return selectedUid;
}

export function getSelectedEntry() {
    return selectedUid == null ? null : getEntry(selectedUid);
}

/**
 * Re-run the list pipeline and repaint. For the editor pour: edits to
 * title / mode / rank / timing change the row the list draws for the open
 * note, and the list can't know unless told.
 */
export function refreshListcol() {
    if (root) renderList();
}

function notifySelected() {
    const entry = getSelectedEntry();
    noteListeners.forEach(fn => { try { fn(selectedUid, entry); } catch { /* no-op */ } });
}

/** Select a note (string|number uid, or null). Notifies only on change. */
function selectNote(uid) {
    const next = uid == null ? null : String(uid);
    if (next === selectedUid) return;
    selectedUid = next;
    notifySelected();
}

// ============================================================
// Vocabulary — the mock's writer-facing words, verbatim
// ============================================================

const MODE_GLYPH = { always: '\u25c9', topic: '\u25cf', meaning: '\u223c', shelved: '\u25cb' };
const MODE_WORD = {
    always: 'always',
    topic: 'when its topics come up',
    meaning: 'when it feels relevant (by meaning)',
    shelved: 'never \u2014 shelved',
};

/** ST truth → the four writer-facing modes. disable wins (a shelved constant
 *  is still shelved); then constant; then vectorized; keyword is the rest. */
function modeOf(e) {
    if (e.disable) return 'shelved';
    if (e.constant) return 'always';
    if (e.vectorized) return 'meaning';
    return 'topic';
}

/** Title: comment, else first key (ST's own fallback), else untitled. */
function titleOf(e) {
    if (e.comment) return esc(e.comment);
    const keys = Array.isArray(e.key) ? e.key : [];
    if (keys.length) return esc(keys[0]);
    return '<i>untitled</i>';
}

/**
 * SIDECAR SEAM (§9.4): the subject a note files under. Now poured — reads the
 * sidecar store (book name + uid). Before the store's file resolves, or for
 * any note the writer never refiled, this answers 'General' (the store's
 * DEFAULT_SUBJECT), so the flat-book default and the async-load window are
 * both the same safe state an imported v1 book starts in. onSubjectsChanged
 * (wired in initListcol) repaints the list when a reconcile or the first load
 * shifts an answer. Grouping below still derives entirely from this function.
 */
function subjectOf(e) {
    return getSubject(getOpenBookName(), e?.uid);
}

/** Canonical subject order (mock) — matters the moment the sidecar lands. */
const SUBJECTS = ['General', 'Characters', 'Places', 'Events', 'Rules', 'Flavor'];

/** Rank formatting (mock): raw order can legitimately be 1000+. */
const fmtRank = n => {
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
};

/** Timing icons (mock): sticky=lingers, cooldown=rests, delay=waits. */
function timeIcons(e) {
    const parts = [];
    if (e.sticky > 0) parts.push(`<span title="lingers ${e.sticky}">\u29d7</span>`);
    if (e.cooldown > 0) parts.push(`<span title="rests ${e.cooldown}">\u23fe</span>`);
    if (e.delay > 0) parts.push(`<span title="waits until msg ${e.delay}">\u2933</span>`);
    return parts.length ? `<span class="wl-wi2-timeicons">${parts.join('')}</span>` : '';
}

// ============================================================
// The pipeline: entries → filter → sort → page → group
// ============================================================

/** Every entry of the open book (empty when nothing is open). */
function bookEntries() {
    const { data } = getBook();
    return data ? Object.values(data.entries) : [];
}

/** v1's search model: comment, keys, secondary keys, content. Substring,
 *  case-insensitive. */
function filterEntries(entries) {
    if (!searchQuery) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(e => {
        const comment = (e.comment || '').toLowerCase();
        const keys = (Array.isArray(e.key) ? e.key.join(' ') : '').toLowerCase();
        const sec = (Array.isArray(e.keysecondary) ? e.keysecondary.join(' ') : '').toLowerCase();
        const content = (e.content || '').toLowerCase();
        return comment.includes(q) || keys.includes(q) || sec.includes(q) || content.includes(q);
    });
}

/** v1's comparators, the subset the picker offers. Values are v1's sort-mode
 *  numbers so the two lists can never disagree about what a mode means. */
function sortEntries(entries) {
    const arr = [...entries];
    switch (sortMode) {
        case 1: return arr.sort((a, b) => (a.comment || '').localeCompare(b.comment || ''));
        case 2: return arr.sort((a, b) => (b.comment || '').localeCompare(a.comment || ''));
        case 3: return arr.sort((a, b) => (a.content || '').length - (b.content || '').length);
        case 4: return arr.sort((a, b) => (b.content || '').length - (a.content || '').length);
        case 7: return arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        case 9: return arr.sort((a, b) => (a.uid ?? 0) - (b.uid ?? 0));
        case 10: return arr.sort((a, b) => (b.uid ?? 0) - (a.uid ?? 0));
        case 8:
        default: return arr.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
    }
}

/** Writer-facing labels for the picker ("rank" is the v2 word for order). */
const SORT_OPTIONS = [
    [8, 'Rank, high first'],
    [7, 'Rank, low first'],
    [1, 'Title A\u2013Z'],
    [2, 'Title Z\u2013A'],
    [10, 'Newest first'],
    [9, 'Oldest first'],
    [4, 'Longest first'],
    [3, 'Shortest first'],
];

/** Filter+sort, memo-free (the list is ≤ a book; recompute is cheap). */
function pipeline() {
    return sortEntries(filterEntries(bookEntries()));
}

/** Subjects present in a set of entries: canonical order first, then custom
 *  alphabetically (§9.24 — derive from data, nothing can vanish). */
function subjectGroups(items) {
    const found = [...new Set(items.map(subjectOf))];
    return [...SUBJECTS.filter(s => found.includes(s)),
            ...found.filter(s => !SUBJECTS.includes(s)).sort()];
}

// ============================================================
// renderList — the mock's, with paging around the grouping
// ============================================================

const hint = msg => `<div class="wl-wi2-rail-hint" style="padding:10px 14px">${msg}</div>`;

function noteRow(e) {
    const mode = modeOf(e);
    const uid = e.uid;
    return `<div class="wl-wi2-entry ${String(uid) === selectedUid ? 'sel' : ''} ${mode === 'shelved' ? 'shelved' : ''} ${picked.has(uid) ? 'ticked' : ''}" data-uid="${uid}">
        <label class="wl-wi2-cbcell"><input type="checkbox" class="wl-wi2-rowcb" data-uid="${uid}" ${picked.has(uid) ? 'checked' : ''}></label>
        <span class="wl-wi2-glyph ${mode}" data-glyphtoggle="${uid}" role="button" tabindex="0" title="${mode === 'shelved' ? 'Shelved \u2014 click to re-enable' : MODE_WORD[mode] + ' \u2014 click to shelve'}">${MODE_GLYPH[mode]}</span>
        <span class="wl-wi2-name">${titleOf(e)}</span>
        ${timeIcons(e)}
        <span class="wl-wi2-rankchip" title="rank (order: ${e.order ?? 0})">${fmtRank(e.order ?? 0)}</span>
    </div>`;
}

/**
 * One renderList() for the whole column (mock's rule): rows, group heads,
 * bulk bar, pager — every mutation re-renders, so nothing drifts.
 *
 * Paging wraps the mock's grouping: the page is cut from the filtered+sorted
 * flat list, and the groups shown are the groups OF THAT PAGE. A group head's
 * count and its select-all therefore scope to what's listed under it — the
 * only honest scope for a heading you can see (cross-page group state would
 * be a claim about rows that aren't on screen).
 */
function renderList() {
    if (!root) return;
    const listEl = root.querySelector('#wl-wi2-entryList');
    const { name } = getBook();

    if (!name) {
        listEl.innerHTML = hint('Pick a lorebook in the rail to see its notes.');
        renderPager(0, 0);
        syncBulkBar([]);
        return;
    }

    const all = bookEntries();
    if (!all.length) {
        listEl.innerHTML = hint('No notes in this book yet. + starts one.');
        renderPager(0, 0);
        syncBulkBar([]);
        return;
    }

    const flat = pipeline();
    if (!flat.length) {
        listEl.innerHTML = hint(`No notes match \u201c${esc(searchQuery)}\u201d.`);
        renderPager(0, 0);
        syncBulkBar(flat);
        return;
    }

    const totalPages = Math.ceil(flat.length / PAGE_SIZE);
    page = Math.max(0, Math.min(page, totalPages - 1));
    const pageItems = flat.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    listEl.innerHTML = subjectGroups(pageItems).map(sub => {
        const items = pageItems.filter(e => subjectOf(e) === sub);
        if (!items.length) return '';
        const rows = items.map(noteRow).join('');
        // Per-group select-all (mock): the group's checkbox is the ONLY honest
        // scope for a heading — "select all" on a grouped list is otherwise
        // ambiguous about group vs. book. Both exist; each says which.
        const gPicked = items.filter(e => picked.has(e.uid)).length;
        const gAll = gPicked === items.length;
        return `<div class="wl-wi2-subject">
            <button class="wl-wi2-subject-head">
                <label class="wl-wi2-cbcell" title="Select all in ${esc(sub)}"><input type="checkbox" class="wl-wi2-groupcb" data-subj="${esc(sub)}" ${gAll ? 'checked' : ''}></label>
                <span class="wl-wi2-subject-chev">\u25bc</span>${esc(sub)}<span class="wl-wi2-subject-n">${items.length}</span></button>
            ${rows}</div>`;
    }).join('');

    // indeterminate is a PROPERTY, not an attribute (mock): apply post-paint,
    // and read scope back by dataset comparison — a subject is free text, so
    // building a selector from one would mean escaping it for nothing.
    for (const cb of listEl.querySelectorAll('.wl-wi2-groupcb')) {
        const items = pageItems.filter(e => subjectOf(e) === cb.dataset.subj);
        const n = items.filter(e => picked.has(e.uid)).length;
        cb.indeterminate = n > 0 && n < items.length;
    }

    renderPager(totalPages, flat.length);
    syncBulkBar(flat);
}

/** Pager: only exists when there is somewhere to go. */
function renderPager(totalPages, total) {
    const el = root.querySelector('#wl-wi2-pager');
    if (totalPages <= 1) { el.innerHTML = ''; el.classList.remove('on'); return; }
    el.classList.add('on');
    el.innerHTML = `
        <button class="wl-wi2-iconbtn" data-page="prev" title="Previous page" ${page === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
        <span class="wl-wi2-pageinfo">${page + 1}/${totalPages} \u00b7 ${total} notes</span>
        <button class="wl-wi2-iconbtn" data-page="next" title="Next page" ${page >= totalPages - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;
}

// ============================================================
// Multi-select + bulk bar
// ============================================================

/**
 * The book-wide select-all's honest scope: what the current SEARCH shows.
 * With no search that IS the whole book; with one, ticking notes the filter
 * hides would be selecting things you can't see — the same rule that clears
 * the Set on exit. (Deliberate divergence from the mock, which had no search
 * to scope against; noted in the handoff.)
 */
function selAllScope(flat) {
    return flat ?? pipeline();
}

function syncBulkBar(flat) {
    const scope = selAllScope(flat);
    const n = picked.size;
    const countEl = root.querySelector('#wl-wi2-bulkCount');
    if (countEl) countEl.textContent = `${n} selected`;
    const del = root.querySelector('#wl-wi2-bulkDelete');
    if (del) del.disabled = n === 0 || isBulkOperating;
    // Assign-subject shares Delete's gate: needs a selection, off mid-op.
    const subj = root.querySelector('#wl-wi2-bulkSubject');
    if (subj) subj.disabled = n === 0 || isBulkOperating;
    // Move / Copy — same gate (they write lorebook files; off mid-op).
    const mv = root.querySelector('#wl-wi2-bulkMove');
    if (mv) mv.disabled = n === 0 || isBulkOperating;
    const cp = root.querySelector('#wl-wi2-bulkCopy');
    if (cp) cp.disabled = n === 0 || isBulkOperating;
    // Same three states as each group's checkbox, one scope up.
    const all = root.querySelector('#wl-wi2-selAll');
    if (all) {
        const inScope = scope.filter(e => picked.has(e.uid)).length;
        all.checked = scope.length > 0 && inScope === scope.length;
        all.indeterminate = inScope > 0 && inScope < scope.length;
        all.closest('.wl-wi2-cbcell').title = searchQuery
            ? 'Select every matching note' : 'Select every note in this book';
    }
}

/** Leaving multi-select clears the selection (mock + v1's exitMultiSelect). */
function setMsel(on) {
    mselOn = on;
    if (!on) clearPicked();
    // A subject / transfer picker belongs to a selection; leaving select-mode
    // voids it. Through its own closer so the document listeners are torn down.
    bulkSubjClose?.();
    bulkXferClose?.();
    noteXferClose?.();
    root.classList.toggle('wl-wi2-msel', on);
    const b = root.querySelector('#wl-wi2-selBtn');
    // .on is the state; the icon never changes — rewriting textContent would
    // delete the <i> and the button would come back empty (mock's note).
    b.classList.toggle('on', on);
    b.title = on ? 'Done selecting' : 'Select several notes to act on at once';
    renderList();
}

/** Bulk delete — the file-writing live bulk action (v1's recipe, one
 *  confirm for the batch, one save). Selection clears on success; the mode
 *  stays on (the next thing you do is usually the next batch). */
async function onBulkDelete() {
    if (isBulkOperating || !picked.size) return;
    const { name } = getBook();
    if (!name) return;
    const n = picked.size;
    const ok = await confirmPopup('Delete notes',
        `Delete ${n} note${n === 1 ? '' : 's'} from \u201c${name}\u201d?\n\nThis cannot be undone.`,
        'Delete');
    if (!ok) return;

    isBulkOperating = true;
    syncBulkBar();
    try {
        const deleted = await deleteEntries([...picked]);
        if (deleted < 0) {
            toastr?.error?.('Bulk delete failed \u2014 check console for details.');
            return;
        }
        clearPicked();
        // The open note may have been among the dead — renderList's arrival
        // pass below re-selects; the rail's count for this book is now stale.
        toastr?.success?.(`Deleted ${deleted} note${deleted === 1 ? '' : 's'}.`);
        dropCount(name);
        refreshRail();
        ensureSelection();
        renderList();
    } finally {
        isBulkOperating = false;
        syncBulkBar();
    }
}

// ── Bulk assign-subject (§9.4 sidecar) ─────────────────────────────────────
// The editor's single-note picker (editor.js ~635), lifted to a batch: same
// CANON, same subjectsInBook customs, same class names, same "+ new" free-text
// mint, so the two paths can NEVER offer different options or look different.
// Divergences, both because a batch isn't one note:
//   - no 'cur' tick — a selection can span mixed subjects, so there is no one
//     current value to mark.
//   - commit loops setSubject over `picked`. Each setSubject fires the store's
//     onSubjectsChanged (→ our renderList), so writing N notes would repaint N
//     times mid-loop; we guard with a flag and repaint once at the end.
//   - filing CLEARS the selection, keeps the mode on (mock: the next thing you
//     do is file the next batch). Sidecar-only — no UID can move, so the
//     corruption gate this never routes through would be theatre (§ handoff).
const CANON_SUBJECTS = ['General', 'Characters', 'Places', 'Factions', 'Events', 'Secrets', 'Rules', 'Flavor'];

let bulkSubjectApplying = false;   // suppress per-write repaints during the loop
// The open picker's closer (or null). Lets the opener button toggle it shut and
// setMsel/teardown dismiss it, all through the ONE path that also removes the
// picker's document-level listeners — so nothing leaks.
let bulkSubjClose = null;
// The open MOVE/COPY target-picker's closer (or null) — same contract as
// bulkSubjClose but its own slot so the two pickers never fight over one var.
// bulkXferOpener remembers WHICH button (Move vs Copy) owns the open picker, so
// clicking the OTHER button switches pickers instead of just toggling shut.
let bulkXferClose = null;
let bulkXferOpener = null;
// The open single-note transfer picker's closer (editor move/copy icon) — its
// own slot so an editor picker and a bulk picker never clobber each other.
let noteXferClose = null;

function openBulkSubjectPicker(anchorBtn) {
    if (!picked.size) return;
    root.querySelector('#wl-wi2-bulkSubjPick')?.remove();
    const book = getBook().name;
    if (!book) return;

    const inUse = subjectsInBook(book);
    const options = [...CANON_SUBJECTS, ...inUse.filter(s => !CANON_SUBJECTS.includes(s))];

    const pop = document.createElement('div');
    pop.className = 'wl-wi2-subj-pop wl-wi2-subjpick open';
    pop.id = 'wl-wi2-bulkSubjPick';
    pop.style.cssText = 'position:absolute; z-index:40;';
    const optHTML = options.map(s =>
        `<button class="wl-wi2-subj-opt" data-subjopt="${esc(s)}">${esc(s)}</button>`).join('');
    pop.innerHTML = `<div class="wl-wi2-subjpick-list">${optHTML}</div>
        <div class="wl-wi2-subjpick-new">
            <input class="wl-wi2-subjpick-input" type="text" placeholder="new subject\u2026" autocomplete="off" spellcheck="false" maxlength="40">
        </div>`;

    // Close helpers. The outside-click/Escape listeners live on DOCUMENT (not
    // root) so no in-pane stopPropagation can starve them, and they're removed
    // the moment the pop closes so nothing leaks across opens. This is the same
    // shape the cast picker's own close uses.
    const closePop = () => {
        pop.remove();
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onDocKey, true);
        if (bulkSubjClose === closePop) bulkSubjClose = null;
    };
    const onDocDown = (dv) => {
        // A click on the pop or on the opener is handled by their own handlers.
        if (pop.contains(dv.target) || dv.target.closest?.('#wl-wi2-bulkSubject')) return;
        closePop();
    };
    const onDocKey = (kv) => { if (kv.key === 'Escape') { kv.stopPropagation(); closePop(); } };

    const commit = (subject) => {
        const s = String(subject ?? '').trim();
        if (!s) return;
        const n = picked.size;
        // One repaint for the batch, not one per note. The store batches its
        // change-notify (begin/endNoteMetaBatch) so every listener — including
        // the editor — hears ONE change; listcol additionally guards its own
        // handler (bulkSubjectApplying) and repaints explicitly below. Filing
        // clears the selection; mode stays on.
        beginNoteMetaBatch();
        bulkSubjectApplying = true;
        try {
            for (const uid of picked) setSubject(book, uid, s);
        } finally {
            // End the batch (fires the single notify) while our guard is still
            // up, so listcol's handler skips it and the editor repaints once;
            // then drop the guard and repaint the list explicitly below.
            endNoteMetaBatch();
            bulkSubjectApplying = false;
        }
        closePop();
        clearPicked();
        toastr?.success?.(`Filed ${n} note${n === 1 ? '' : 's'} under \u201c${s}\u201d.`);
        renderList();
    };

    pop.addEventListener('click', (pv) => {
        pv.stopPropagation();
        const opt = pv.target.closest('[data-subjopt]');
        if (opt) commit(opt.dataset.subjopt);
    });
    const newInput = pop.querySelector('.wl-wi2-subjpick-input');
    newInput.addEventListener('click', pv => pv.stopPropagation());
    newInput.addEventListener('keydown', (kv) => {
        if (kv.key === 'Enter') { kv.preventDefault(); commit(newInput.value); }
        else if (kv.key === 'Escape') { kv.stopPropagation(); closePop(); }
    });

    // Insert first (so it has an offsetParent to measure against), then pin it
    // under the opener in that parent's coordinate space. The bare
    // position:absolute trick the editor's picker uses doesn't hold here: the
    // bulk bar is display:flex/flex-wrap, so an out-of-flow flex sibling's
    // static position isn't under the button — it collapses to the container
    // origin (the bottom-left symptom). Measuring fixes it deterministically.
    anchorBtn.insertAdjacentElement('afterend', pop);
    const parent = pop.offsetParent || anchorBtn.offsetParent || root;
    const pr = parent.getBoundingClientRect();
    const br = anchorBtn.getBoundingClientRect();
    pop.style.left = (br.left - pr.left) + 'px';
    pop.style.top = (br.bottom - pr.top + 4) + 'px';

    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onDocKey, true);
    bulkSubjClose = closePop;   // expose the closer for the toggle / setMsel / teardown
    newInput.focus();
}

// ── Bulk move / copy ───────────────────────────────────────────────────────
// The remaining bulk pour. Move/Copy transfer the picked notes to ANOTHER book
// (any book on disk — the user's call, "like the v1 drawer"), through
// listData.transferEntries → v1's batchTransferEntries recipe (one save per
// book, self-assigned integer UIDs, corruption pre-gate). The picker reuses the
// subject-picker chrome (a subj-pop list) but lists BOOK NAMES instead of
// subjects, and there's no "+ new" mint — you move INTO an existing book.
// Divergences by mode:
//   - MOVE hides the open book (source ≠ target; a note can't move to where it
//     already is) and its rows leave the list.
//   - COPY offers every book INCLUDING the open one (copy-into-same-book is the
//     §20.3 dup-residual, allowed) and the source keeps its rows.
// Subjects follow via the reconciler (no remap here). Selection clears on
// success; mode stays on. Both books' rail counts refresh.

function openBulkTransferPicker(anchorBtn, move) {
    if (!picked.size) return;
    root.querySelector('#wl-wi2-bulkXferPick')?.remove();
    const sourceName = getBook().name;
    if (!sourceName) return;

    // MOVE excludes the source (can't move to self); COPY includes it.
    const books = getAllBookNames().filter(n => move ? n !== sourceName : true);

    const pop = document.createElement('div');
    pop.className = 'wl-wi2-subj-pop wl-wi2-subjpick open';
    pop.id = 'wl-wi2-bulkXferPick';
    pop.style.cssText = 'position:absolute; z-index:40;';
    const listHTML = books.length
        ? books.map(b =>
            `<button class="wl-wi2-subj-opt" data-xferbook="${esc(b)}">${esc(b)}${
                b === sourceName ? ' <span class="wl-wi2-subj-cur" style="opacity:.6">(this book)</span>' : ''}</button>`).join('')
        : `<div class="wl-wi2-rail-hint" style="padding:8px 12px">No other book to ${move ? 'move' : 'copy'} into.</div>`;
    pop.innerHTML = `<div class="wl-wi2-subjpick-list">${listHTML}</div>`;

    const closePop = () => {
        pop.remove();
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onDocKey, true);
        if (bulkXferClose === closePop) { bulkXferClose = null; bulkXferOpener = null; }
    };
    const openerSel = move ? '#wl-wi2-bulkMove' : '#wl-wi2-bulkCopy';
    const onDocDown = (dv) => {
        if (pop.contains(dv.target) || dv.target.closest?.(openerSel)) return;
        closePop();
    };
    const onDocKey = (kv) => { if (kv.key === 'Escape') { kv.stopPropagation(); closePop(); } };

    const commit = (targetName) => {
        closePop();
        onBulkTransfer(targetName, move);
    };

    pop.addEventListener('click', (pv) => {
        pv.stopPropagation();
        const opt = pv.target.closest('[data-xferbook]');
        if (opt) commit(opt.dataset.xferbook);
    });

    anchorBtn.insertAdjacentElement('afterend', pop);
    const parent = pop.offsetParent || anchorBtn.offsetParent || root;
    const pr = parent.getBoundingClientRect();
    const br = anchorBtn.getBoundingClientRect();
    pop.style.left = (br.left - pr.left) + 'px';
    pop.style.top = (br.bottom - pr.top + 4) + 'px';

    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onDocKey, true);
    bulkXferClose = closePop;
    bulkXferOpener = openerSel;
}

/**
 * Run a bulk move/copy to targetName. Mirrors onBulkDelete's shape: guard,
 * flip isBulkOperating (disables the whole bar), call listData.transferEntries,
 * toast the result, on success clear the selection (keep mode on) and refresh
 * BOTH books' rail counts. The corruption pre-gate lives in transferEntries;
 * a 'corrupt' return is surfaced as a blocking message, not a silent no-op.
 */
async function onBulkTransfer(targetName, move) {
    if (isBulkOperating || !picked.size || !targetName) return;
    const sourceName = getBook().name;
    if (!sourceName) return;
    const uids = [...picked];

    isBulkOperating = true;
    syncBulkBar();
    try {
        const res = await transferEntries(targetName, uids, { move });
        if (!res.ok) {
            if (res.reason === 'corrupt') {
                await confirmPopup('Can\u2019t ' + (move ? 'move' : 'copy'),
                    `\u201c${res.badBook}\u201d has corrupted entry IDs (a known ST import bug). ` +
                    `This drawer will not write on top of it. Repair or re-import the affected lorebook first.`,
                    'OK');
            } else {
                toastr?.error?.(`${move ? 'Move' : 'Copy'} failed \u2014 check console for details.`);
            }
            return;
        }
        const verb = move ? 'Moved' : 'Copied';
        toastr?.success?.(`${verb} ${res.moved} note${res.moved === 1 ? '' : 's'} to \u201c${targetName}\u201d.`);
        clearPicked();
        // Both books' counts changed (move) or the target's did (copy). Drop
        // both cached counts so the rail re-reads; the source may equal target
        // on a same-book copy (drop once, harmless).
        dropCount(targetName);
        dropCount(sourceName);
        refreshRail();
        // A move shrank the open book; a same-book copy grew it. Either way the
        // open book's data changed under us — re-arrive and repaint. (A copy to
        // a DIFFERENT book left the open book untouched; renderList is a cheap
        // no-op-ish repaint anyway.)
        ensureSelection();
        renderList();
    } finally {
        isBulkOperating = false;
        syncBulkBar();
    }
}

// ── Single-note actions (editor top-right: move/copy · duplicate · delete) ──
// The editor owns no book state — selection, arrival, and the transfer
// machinery all live here — so these three are exposed for editor.js to call
// by uid. They mirror the bulk paths (one confirm, listData does the write,
// then re-arrive + repaint), scoped to a single note. v1's per-row set
// (entryList.js deleteEntry/duplicateEntry/moveEntry), lifted to the editor.

/**
 * Delete ONE note (the open one). One themed confirm, then listData's batch
 * delete of a single uid. listcol re-arrives to the next note (ensureSelection)
 * so the editor never renders a dead uid. No-ops if already mid-op.
 * @returns {Promise<boolean>} true if a delete happened.
 */
export async function deleteNote(uid) {
    if (isBulkOperating || uid == null) return false;
    const { name } = getBook();
    const entry = getEntry(uid);
    if (!name || !entry) return false;
    const title = entry.comment || (Array.isArray(entry.key) && entry.key[0]) || 'this note';
    const ok = await confirmPopup('Delete note',
        `Delete \u201c${title}\u201d from \u201c${name}\u201d?\n\nThis cannot be undone.`, 'Delete');
    if (!ok) return false;

    isBulkOperating = true;
    syncBulkBar();
    try {
        const deleted = await deleteEntries([uid]);
        if (deleted < 0) {
            toastr?.error?.('Delete failed \u2014 check console for details.');
            return false;
        }
        // Drop the deleted uid from any live selection so a later bulk op or
        // select-all indeterminate math can't count a ghost.
        picked.delete(typeof uid === 'string' ? parseInt(uid, 10) : uid);
        if (rangeAnchorUid === uid) rangeAnchorUid = null;
        toastr?.success?.('Note deleted.');
        dropCount(name);
        refreshRail();
        ensureSelection();   // land on the next note (or null on an emptied book)
        renderList();
        return true;
    } finally {
        isBulkOperating = false;
        syncBulkBar();
    }
}

/**
 * Duplicate ONE note into the SAME book — a same-book copy is a duplicate.
 * Reuses transferEntries({move:false}); on success selects and reveals the new
 * note (v1 opened the copy). The reconciler carries the subject to the clone.
 * @returns {Promise<boolean>}
 */
export async function duplicateNote(uid) {
    if (isBulkOperating || uid == null) return false;
    const { name } = getBook();
    if (!name || !getEntry(uid)) return false;

    isBulkOperating = true;
    syncBulkBar();
    try {
        const res = await transferEntries(name, [uid], { move: false });
        if (!res.ok || !res.newUids?.length) {
            toastr?.error?.('Duplicate failed \u2014 check console for details.');
            return false;
        }
        toastr?.success?.('Note duplicated.');
        dropCount(name);
        refreshRail();
        // Open the copy: clear any stale search that would hide it, select it,
        // and page/scroll to it (revealSelected). Its uid is the one new uid.
        const newUid = res.newUids[0];
        searchQuery = '';
        const searchEl = root?.querySelector('#wl-wi2-noteSearch');
        if (searchEl) searchEl.value = '';
        selectNote(newUid);
        revealSelected();
        return true;
    } finally {
        isBulkOperating = false;
        syncBulkBar();
    }
}

/**
 * Toggle ONE note between shelved and its prior live mode — the fast on/off
 * the mode picker's four-way choice made slow. Shelving in ST is JUST the
 * `disable` flag (setMode's rule): constant/vectorized are left untouched, so
 * re-enabling doesn't need to remember anything — clearing disable lets modeOf
 * read the note's own always/meaning/topic back out. One flag, no stash.
 *
 * Same-book, no file transfer, no UID churn — so no corruption gate, no rail
 * refresh (the rail counts TOTAL entries per book, which shelving doesn't
 * change), and no ensureSelection: the row stays exactly where it is, only its
 * glyph + shelved dimming change. We repaint the list (row restyle) and — if
 * this note is the open one — notify so the editor's mode picker re-syncs to
 * the new state. Guarded by isBulkOperating like the other single-note writes.
 * @returns {boolean} the note's NEW disabled state (true = now shelved).
 */
function toggleShelved(uid) {
    if (isBulkOperating || uid == null) return false;
    const entry = getEntry(uid);
    if (!entry) return false;
    entry.disable = !entry.disable;
    scheduleSave();
    renderList();
    // If the toggled note is the one the editor has open, its mode picker is
    // now stale — notifySelected re-renders the editor against the live entry.
    if (String(uid) === selectedUid) notifySelected();
    return entry.disable;
}

// The open single-note transfer picker (openNoteTransferPicker below) uses the
// module-level `noteXferClose` declared near the bulk picker state.

/**
 * Open the MOVE/COPY target picker for ONE note, anchored under an editor
 * button. Unlike the bulk picker this offers BOTH actions per row (v1's single
 * picker had Move and Copy side by side): a book name plus a small "copy"
 * affordance. Picking the name MOVES; the copy glyph COPIES. The open book is
 * shown for COPY only (copy-into-same-book is allowed; move-to-self isn't).
 */
export function openNoteTransferPicker(uid, anchorBtn) {
    if (uid == null || !anchorBtn) return;
    const sourceName = getBook().name;
    if (!sourceName || !getEntry(uid)) return;
    // Close any already-open picker (bulk or note) first — one popover at a time.
    bulkSubjClose?.(); bulkXferClose?.(); noteXferClose?.();
    // The pop lands in the EDITOR's DOM (next to its anchor button), not
    // listcol's root — so clear any stray one by id document-wide.
    document.getElementById('wl-wi2-noteXferPick')?.remove();

    const books = getAllBookNames();

    const pop = document.createElement('div');
    pop.className = 'wl-wi2-subj-pop wl-wi2-subjpick open';
    pop.id = 'wl-wi2-noteXferPick';
    pop.style.cssText = 'position:absolute; z-index:40;';
    const rows = books.map(b => {
        const isSource = b === sourceName;
        // Source book: no "move to self" — offer copy only. Other books: the
        // name moves, the clone glyph copies.
        return `<div class="wl-wi2-notexfer-row" data-book="${esc(b)}">
            <button class="wl-wi2-subj-opt wl-wi2-notexfer-name" data-xfer="${isSource ? 'copy' : 'move'}" data-book="${esc(b)}" ${isSource ? 'disabled title="Already this book \u2014 use the copy button to duplicate here"' : 'title="Move here"'}>${esc(b)}${isSource ? ' <span class="wl-wi2-subj-cur" style="opacity:.6">(this book)</span>' : ''}</button>
            <button class="wl-wi2-notexfer-copy" data-xfer="copy" data-book="${esc(b)}" title="Copy here (keep the original)"><i class="fa-solid fa-clone"></i></button>
        </div>`;
    }).join('');
    pop.innerHTML = `<div class="wl-wi2-subjpick-list">${
        books.length ? rows : '<div class="wl-wi2-rail-hint" style="padding:8px 12px">No books on disk.</div>'
    }</div>`;

    const closePop = () => {
        pop.remove();
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onDocKey, true);
        if (noteXferClose === closePop) noteXferClose = null;
    };
    const onDocDown = (dv) => {
        if (pop.contains(dv.target) || dv.target === anchorBtn || anchorBtn.contains?.(dv.target)) return;
        closePop();
    };
    const onDocKey = (kv) => { if (kv.key === 'Escape') { kv.stopPropagation(); closePop(); } };

    pop.addEventListener('click', (pv) => {
        pv.stopPropagation();
        const btn = pv.target.closest('[data-xfer]');
        if (!btn || btn.disabled) return;
        const target = btn.dataset.book;
        const move = btn.dataset.xfer === 'move';
        closePop();
        runSingleTransfer(uid, target, move);
    });

    anchorBtn.insertAdjacentElement('afterend', pop);
    const parent = pop.offsetParent || anchorBtn.offsetParent || root;
    const pr = parent.getBoundingClientRect();
    const br = anchorBtn.getBoundingClientRect();
    // Right-align to the button (the cluster sits at the pane's right edge, so
    // a left-anchored pop would spill off; pin the pop's RIGHT to the button's).
    pop.style.top = (br.bottom - pr.top + 4) + 'px';
    pop.style.left = (br.right - pr.left) + 'px';
    pop.style.transform = 'translateX(-100%)';

    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onDocKey, true);
    noteXferClose = closePop;
}

/** Shared single-note move/copy runner — the picker's commit and any direct
 *  caller land here. Mirrors onBulkTransfer for one uid. */
async function runSingleTransfer(uid, targetName, move) {
    if (isBulkOperating || uid == null || !targetName) return;
    const sourceName = getBook().name;
    if (!sourceName || !getEntry(uid)) return;

    isBulkOperating = true;
    syncBulkBar();
    try {
        const res = await transferEntries(targetName, [uid], { move });
        if (!res.ok) {
            if (res.reason === 'corrupt') {
                await confirmPopup('Can\u2019t ' + (move ? 'move' : 'copy'),
                    `\u201c${res.badBook}\u201d has corrupted entry IDs (a known ST import bug). ` +
                    `This drawer will not write on top of it. Repair or re-import the affected lorebook first.`,
                    'OK');
            } else {
                toastr?.error?.(`${move ? 'Move' : 'Copy'} failed \u2014 check console for details.`);
            }
            return;
        }
        toastr?.success?.(`${move ? 'Moved' : 'Copied'} note to \u201c${targetName}\u201d.`);
        dropCount(targetName);
        dropCount(sourceName);
        refreshRail();
        if (move && targetName !== sourceName) {
            // The moved note left the open book — drop it from selection and
            // re-arrive to the next note.
            picked.delete(typeof uid === 'string' ? parseInt(uid, 10) : uid);
            if (rangeAnchorUid === uid) rangeAnchorUid = null;
            ensureSelection();
        }
        // A same-book copy grew the open book; open the fresh copy (v1's rule).
        if (!move && targetName === sourceName && res.newUids?.length) {
            selectNote(res.newUids[0]);
            revealSelected();
        } else {
            renderList();
        }
    } finally {
        isBulkOperating = false;
        syncBulkBar();
    }
}

// ============================================================
// Arrival — which note is open after a load / delete / create
// ============================================================

/**
 * Keep selectedUid pointing at a note that exists; else land on the first
 * of the current pipeline (mock: openBookByName picked the book's first
 * note). Null when the book is empty or nothing is open.
 */
function ensureSelection() {
    // A pending sim goto (§9.33) wins over both "keep current" and "first
    // note": the whole point of the switch was to land on THAT note. Consume
    // it once; if the uid isn't in this book after all (deleted, wrong book),
    // fall through to the normal arrival rather than selecting nothing.
    if (pendingGotoUid != null) {
        const want = pendingGotoUid;
        pendingGotoUid = null;
        if (getEntry(want)) { selectNote(want); return; }
    }
    if (selectedUid != null && getEntry(selectedUid)) return;
    const first = pipeline()[0];
    selectNote(first ? first.uid : null);
}

// ============================================================
// Book switching — the §9.31 path in action
// ============================================================

/**
 * Load whatever the rail says is open. loadBook's first act is the §9.31
 * flush of the OUTGOING book. Selection (both kinds) is book-scoped, so a
 * switch clears the ticks and re-arrives the open note; search and sort are
 * writer preferences and persist (v1's model).
 */
async function loadOpenBook() {
    const token = ++bookLoadToken;
    const requestedName = getOpenBookName();
    clearPicked();
    page = 0;
    await loadBook(requestedName);
    if (token !== bookLoadToken || !root || getOpenBookName() !== requestedName) return;
    // Selection is book-scoped, so arrival must be a fresh act — and the
    // editor must HEAR it. Without the silent clear, a same-uid entry in the
    // new book (uids are 0,1,2… in every book) makes ensureSelection early-
    // return and selectNote's own change-guard swallow the notify, leaving
    // the editor rendering the OLD book's note. Clearing first guarantees
    // exactly one notify per switch; the empty-book case (selectNote(null)
    // over an already-null selection) gets its explicit one.
    selectedUid = null;
    ensureSelection();
    if (selectedUid == null) notifySelected();
    revealSelected();   // page to + scroll to the arrived note (goto or first)
    renderList();
}

/** Put the selected note on-screen: jump to the page it sorts onto, render,
 *  scroll it into view. A no-op-ish for the common first-note arrival (it's
 *  on page 0 already); load-bearing for a §9.33 goto onto a deep note. */
function revealSelected() {
    if (selectedUid == null) { renderList(); return; }
    const idx = pipeline().findIndex(e => String(e.uid) === selectedUid);
    page = idx >= 0 ? Math.floor(idx / PAGE_SIZE) : 0;
    renderList();
    root?.querySelector('.wl-wi2-entry.sel')?.scrollIntoView({ block: 'nearest' });
}

/**
 * §9.33 click-through target: open a specific note (by book + uid) in the
 * editor. Used by the simulator's trace rows. Switches book if needed (through
 * the rail's single gate, so §9.31's flush is inherited), lands on the note,
 * and brings the editor tab forward.
 *
 * SAME-BOOK is synchronous: select + reveal now. CROSS-BOOK defers the
 * selection to the load the rail's switch kicks off — pendingGotoUid is the
 * baton loadOpenBook's ensureSelection picks up, so there's one load and one
 * arrival, not a manual reload racing the listener's.
 */
export async function gotoNoteInEditor(bookName, uid) {
    if (uid == null) return;
    showEditorTab?.();   // bring the editor forward first — the switch is visible
    const switching = requestOpenBook(bookName);
    if (switching) {
        // The rail notified; listcol's onOpenBookChanged → loadOpenBook is now
        // running (async). Hand it the target; its arrival selects + reveals.
        pendingGotoUid = String(uid);
        return;
    }
    // Same book already open: select + reveal directly.
    if (getEntry(uid)) {
        selectNote(uid);
        revealSelected();
    }
}

// ============================================================
// Markup + wiring
// ============================================================

function listcolHTML() {
    return `
        <div class="wl-wi2-listhead">
            <input class="wl-wi2-search" type="search" placeholder="Search notes\u2026" id="wl-wi2-noteSearch">
            <select class="wl-wi2-sortsel" id="wl-wi2-sortSel" title="Sort notes">
                ${SORT_OPTIONS.map(([v, label]) => `<option value="${v}" ${v === sortMode ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            <button class="wl-wi2-iconbtn" id="wl-wi2-selBtn" title="Select several notes to act on at once" aria-label="Select several notes"><i class="fa-solid fa-list-check"></i></button>
            <button class="wl-wi2-iconbtn wl-wi2-newbtn" id="wl-wi2-newBtn" title="New note" aria-label="New note"><i class="fa-solid fa-plus"></i></button>
        </div>
        <div class="wl-wi2-bulkbar" id="wl-wi2-bulkBar">
            <label class="wl-wi2-cbcell" title="Select every note in this book"><input type="checkbox" id="wl-wi2-selAll"></label>
            <span class="wl-wi2-bulkcount" id="wl-wi2-bulkCount">0 selected</span>
            <span class="wl-wi2-spacer"></span>
            <button class="wl-wi2-bulkact" id="wl-wi2-bulkSubject" disabled title="File the selected notes under a subject">Assign subject\u2026</button>
            <button class="wl-wi2-bulkact" id="wl-wi2-bulkMove" disabled title="Move the selected notes to another book">Move\u2026</button>
            <button class="wl-wi2-bulkact" id="wl-wi2-bulkCopy" disabled title="Copy the selected notes into another book">Copy\u2026</button>
            <button class="wl-wi2-bulkact danger" id="wl-wi2-bulkDelete" disabled>Delete</button>
        </div>
        <div class="wl-wi2-entries" id="wl-wi2-entryList"></div>
        <div class="wl-wi2-pager" id="wl-wi2-pager"></div>
    `;
}

function wire() {
    const listEl = root.querySelector('#wl-wi2-entryList');

    // Delegated on the list (survives re-render). Ticking is not opening:
    // both checkboxes sit INSIDE clickable things, so the cell eats the click.
    listEl.addEventListener('click', (ev) => {
        if (ev.target.closest('.wl-wi2-cbcell')) {
            // Stash shift for the 'change' that follows (change() has no
            // modifier keys). Only a row checkbox range-fills; the group
            // checkbox has its own scope, so shift is meaningless there.
            shiftHeldNext = ev.shiftKey && !!ev.target.closest('.wl-wi2-rowcb');
            ev.stopPropagation();
            return;
        }
        // The mode dot is a toggle, not an opener: clicking it shelves /
        // re-enables the note in place and SWALLOWS the click so the row
        // doesn't also open (user's call — dot toggles, row unaffected).
        const glyph = ev.target.closest('.wl-wi2-glyph');
        if (glyph && glyph.dataset.glyphtoggle != null) {
            ev.stopPropagation();
            toggleShelved(parseInt(glyph.dataset.glyphtoggle, 10));
            return;
        }
        const head = ev.target.closest('.wl-wi2-subject-head');
        if (head) { head.parentElement.classList.toggle('closed'); return; }
        const row = ev.target.closest('.wl-wi2-entry');
        if (row) { selectNote(row.dataset.uid); renderList(); }
    });

    // Keyboard parity for the mode dot (it carries role=button/tabindex=0):
    // Enter or Space toggles shelved, same as a click, without opening the row.
    listEl.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
        const glyph = ev.target.closest?.('.wl-wi2-glyph');
        if (glyph && glyph.dataset.glyphtoggle != null) {
            ev.preventDefault();
            ev.stopPropagation();
            toggleShelved(parseInt(glyph.dataset.glyphtoggle, 10));
        }
    });

    // Checkboxes report on 'change' — the click handler lets them through.
    listEl.addEventListener('change', (ev) => {
        const rowcb = ev.target.closest('.wl-wi2-rowcb');
        if (rowcb) {
            const uid = parseInt(rowcb.dataset.uid, 10);
            const want = rowcb.checked;
            const shift = shiftHeldNext;
            shiftHeldNext = false;
            if (shift && rangeAnchorUid != null && rangeAnchorUid !== uid) {
                // Range fill: every VISIBLE row between anchor and target
                // (inclusive) takes the target's new state. Visible = as drawn
                // now, in DOM order — so a collapsed group's hidden rows are
                // never silently roped in, and the span follows exactly what
                // the eye sees (grouping, sort, and page already baked into
                // the DOM). Anchor stays put so you can re-drag the range.
                const vis = [...listEl.querySelectorAll('.wl-wi2-rowcb')]
                    .filter(cb => cb.offsetParent !== null)
                    .map(cb => parseInt(cb.dataset.uid, 10));
                let a = vis.indexOf(rangeAnchorUid);
                let b = vis.indexOf(uid);
                if (a !== -1 && b !== -1) {
                    if (a > b) [a, b] = [b, a];
                    for (let i = a; i <= b; i++) {
                        if (want) picked.add(vis[i]); else picked.delete(vis[i]);
                    }
                } else {
                    // Anchor scrolled/filtered out of the visible set — treat
                    // as a plain toggle and re-anchor here.
                    if (want) picked.add(uid); else picked.delete(uid);
                }
            } else {
                if (want) picked.add(uid); else picked.delete(uid);
            }
            rangeAnchorUid = uid;   // last plain-or-range click becomes the anchor
            renderList();
            return;
        }
        const gcb = ev.target.closest('.wl-wi2-groupcb');
        if (gcb) {
            // Scope: THIS group, on THIS page (the rows under the heading).
            const flat = pipeline();
            const pageItems = flat.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
            pageItems.filter(e => subjectOf(e) === gcb.dataset.subj)
                .forEach(e => gcb.checked ? picked.add(e.uid) : picked.delete(e.uid));
            renderList();
        }
    });

    // Pager
    root.querySelector('#wl-wi2-pager').addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-page]');
        if (!btn || btn.disabled) return;
        page += btn.dataset.page === 'next' ? 1 : -1;
        renderList();
    });

    // Search — v1's model: 200ms debounce, Esc clears. (The overlay's own
    // Esc-to-close already ignores keys landing in text controls.)
    const search = root.querySelector('#wl-wi2-noteSearch');
    let searchTimer = null;
    search.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchTimer = null;
            searchQuery = search.value.trim();
            page = 0;
            renderList();
        }, 200);
    });
    search.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && search.value) {
            search.value = '';
            searchQuery = '';
            page = 0;
            renderList();
        }
    });

    // Sort
    root.querySelector('#wl-wi2-sortSel').addEventListener('change', (ev) => {
        sortMode = parseInt(ev.target.value, 10);
        page = 0;
        renderList();
    });

    // Multi-select toggle
    root.querySelector('#wl-wi2-selBtn').addEventListener('click', () => setMsel(!mselOn));

    // Book-wide (well: search-wide) select-all
    root.querySelector('#wl-wi2-selAll').addEventListener('change', (ev) => {
        clearPicked();
        if (ev.target.checked) selAllScope().forEach(e => picked.add(e.uid));
        renderList();
    });

    // Bulk delete — a live one. The two still-inert buttons (Move / Copy) have
    // no handlers: they are disabled, dashed, and say why in their titles
    // (mock's rule — marked, not faked). They land with the transfer pour.
    root.querySelector('#wl-wi2-bulkDelete').addEventListener('click', onBulkDelete);

    // Bulk assign-subject — the sidecar-only live action. Opens the picker
    // (same one the editor uses, batched) anchored under the button. The picker
    // owns its own document-level outside-click/Escape close (openBulkSubject
    // Picker), so there's no root-level closer here to fight it.
    const bulkSubjBtn = root.querySelector('#wl-wi2-bulkSubject');
    if (bulkSubjBtn) bulkSubjBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (bulkSubjBtn.disabled) return;
        // Close any open transfer picker first (only one popover up at a time).
        bulkXferClose?.();
        // Toggle: a second click on the opener closes an open picker cleanly
        // (through its own closer, so the document listeners are torn down too).
        if (bulkSubjClose) { bulkSubjClose(); return; }
        openBulkSubjectPicker(bulkSubjBtn);
    });

    // Bulk Move / Copy — the transfer pour. Each opens the target-book picker
    // (a subj-pop of book names) anchored under its button; a second click on
    // the same button toggles it shut. Opening EITHER closes the other picker
    // (subject or the sibling transfer picker) so only one popover is ever up.
    const wireXfer = (btnId, move) => {
        const btn = root.querySelector(btnId);
        if (!btn) return;
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (btn.disabled) return;
            // Clicking the button that OWNS the open picker toggles it shut;
            // clicking the sibling switches to its picker. Either way, close
            // any open picker (subject or transfer) first so only one is up.
            const ownsOpen = bulkXferOpener === btnId;
            bulkSubjClose?.();
            bulkXferClose?.();
            if (ownsOpen) return;   // toggle-shut of this button's own picker
            openBulkTransferPicker(btn, move);
        });
    };
    wireXfer('#wl-wi2-bulkMove', true);
    wireXfer('#wl-wi2-bulkCopy', false);

    // + New: a note born into the book you're looking at, via ST's own
    // createWorldInfoEntry, saved at once. No template, no invented fields —
    // ST's defaults are the only state that can't be wrong about a note
    // nobody has described yet (mock's reasoning, one layer down).
    root.querySelector('#wl-wi2-newBtn').addEventListener('click', async () => {
        const { name } = getBook();
        if (!name) { toastr?.info?.('Pick a lorebook first \u2014 a note is born into the open book.'); return; }
        const entry = await createEntry();
        if (!entry) return;
        selectNote(entry.uid);
        // Land where the note IS: clear the search if it would hide it, and
        // jump to the page it sorts onto — a + that creates something you
        // can't see reads as a button that did nothing.
        searchQuery = '';
        const searchEl = root.querySelector('#wl-wi2-noteSearch');
        if (searchEl) searchEl.value = '';
        const idx = pipeline().findIndex(e => String(e.uid) === selectedUid);
        page = idx >= 0 ? Math.floor(idx / PAGE_SIZE) : 0;
        renderList();
        root.querySelector('.wl-wi2-entry.sel')?.scrollIntoView({ block: 'nearest' });
        dropCount(name);
        refreshRail();
    });
}

// Subscribe ONCE at module load (the onSelectedNoteChanged pattern editor.js
// uses, and for the same reason): the store has no unsubscribe, so a per-init
// resub would stack repaints. renderList() no-ops while root is down, so this
// is inert between opens. Fires when the sidecar's first load resolves or a
// reconcile shifts a subject — regroups the list to match.
onSubjectsChanged(() => {
    // During a bulk assign-subject loop we suppress the store's per-write
    // notify and repaint once at the end (openBulkSubjectPicker's commit).
    if (root && !bulkSubjectApplying) renderList();
});

// ============================================================
// Public lifecycle
// ============================================================

/** Build + wire the listcol inside its region. Called from takeoverWiV2
 *  AFTER initRail, so getOpenBookName() is at worst the module-lifetime
 *  survivor; the onOpenBookChanged subscription catches the rail's async
 *  arrival (§9.30) if it lands on something else. */
export function initListcol(rootEl) {
    root = rootEl;
    root.innerHTML = listcolHTML();
    root.classList.toggle('wl-wi2-msel', mselOn);

    wire();

    // Every book switch — row click, §9.30 arrival, chat change — funnels
    // through the rail's single gate and arrives here; loadOpenBook's
    // loadBook() call is where §9.31's flush fires.
    onOpenBookChanged(() => { loadOpenBook(); });

    loadOpenBook();
    log('Listcol initialized');
}

/** Drop references on overlay close. §9.31 again: the pending save (if any)
 *  is flushed on the way out — fire-and-forget is safe because listData
 *  holds the book by module reference, not through the DOM. Multi-select
 *  resets (v1's resetMultiSelect: reopening starts with a clean slate);
 *  the selected note, search, and sort survive the session, same as the
 *  rail's openBook. */
export function teardownListcol() {
    bookLoadToken++;
    flushPendingSave();
    // Close any open bulk-subject / transfer / single-note picker through its
    // own closer so its document-level listeners are removed — otherwise they'd
    // outlive the drawer and fire against a torn-down root.
    bulkSubjClose?.();
    bulkXferClose?.();
    noteXferClose?.();
    mselOn = false;
    clearPicked();
    shiftHeldNext = false;
    root = null;
    // NOTE: noteListeners is deliberately NOT cleared. The editor subscribes
    // ONCE at module load (editor.js) precisely so its render survives every
    // open/close cycle — listcol has no unsubscribe, so a per-init resub would
    // stack renders instead. Clearing here wiped that one subscription on the
    // first close, so every REOPEN had zero listeners and the editor never
    // re-rendered on selection (frozen right pane). Matches this teardown's own
    // contract above: "the selected note … survive[s] the session."
}
