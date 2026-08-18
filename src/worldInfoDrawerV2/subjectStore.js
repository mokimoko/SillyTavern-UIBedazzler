// WI v2 subject store — the §9.4 subjects layer. Subjects are v2's own metadata
// (what a note IS, for list grouping); ST has no field for them, so they
// live in the shared Bedazzler sidecar, keyed by BOOK NAME + UID.
//
// STORAGE (§9.4): the subjects live in the `subjects` SECTION of the shared
// sidecar (src/sidecar.js — user/files/uibedazzler_meta.json), which owns the
// file IO (upload/download/debounce/unload flush/cache) and the one-time
// migration from the old WI-only file (uibedazzler_wi_meta.json). This module
// keeps ALL the subject semantics + the reconciler and simply reads/writes the
// subjects section through the sidecar: `store` below is a thin view whose
// `.subjects` IS the sidecar's live section object, so every existing
// store.subjects[...] access is unchanged. Reads are synchronous off the cache
// (render calls subjectOf every paint); the sidecar resolves async and we
// subscribe (onSidecarLoaded) to fire onSubjectsChanged so the list repaints
// with real subjects once loaded. Until then every note reads 'General', the
// safe floor and the exact state an imported v1 book starts in.
//
// THE RECONCILER (§9.37 / audit §19–20): a uid key is only safe if it's
// kept honest as ST shuffles uids. getFreeWorldEntryUid reuses the lowest
// free uid (audit §19.4), so a deleted note's uid — and its subject — is
// handed to the NEXT new note: a silent mis-attach, live in vanilla ST with
// no move involved. We watch WORLDINFO_UPDATED, diff each book against a
// snapshot, and reconcile: move → shift the key, copy → duplicate, delete →
// REAP (the load-bearing one), rename → handled by the select-observer, not
// here (audit §20.2: deleteWorldInfo is silent, so the reconciler sees only
// the arrival). The event is a lossy hint (audit §20.1: one shared debounce
// timer drops saves across books within 1 s), so it self-heals — the payload
// is the whole book — and a COARSE RESYNC re-checks the OPEN book on any WI
// event / drawer-open, backstopping a dropped last-in-burst save.
//
// Snapshot key is hash(content) + displayIndex (audit §20.3): identical-
// content dupes only collide while both content AND list position match,
// which the sort/save reindex dissolves; the residual swap is a visible
// mis-file the user corrects, never corruption.

import {
    ensureSidecarLoaded,
    isSidecarLoaded,
    getSection,
    scheduleSave as sidecarScheduleSave,
    flushSidecar,
    onSidecarLoaded,
} from '../sidecar.js';

const ctx = () => SillyTavern.getContext();

const log = () => {};
const logError = (...a) => console.error('[BD] WI v2 subjects:', ...a);

export const DEFAULT_SUBJECT = 'General';

// ============================================================
// Module state
// ============================================================

// `store` is a thin VIEW over the shared sidecar: store.subjects IS the
// sidecar's live `subjects` section object, so every store.subjects[...] access
// below is unchanged from the pre-sidecar version. It's null until the sidecar
// load resolves (bindStore), matching the old "null cache → safe floor" reads.
let store = null;          // { subjects } view, null until the sidecar resolves
// Unsubscribe handle for the sidecar-loaded subscription.
let sidecarUnsub = null;
const pendingRenames = [];

/** Bind `store` onto the sidecar's subjects section once the sidecar is loaded.
 *  Idempotent. Delegated scheduleSave writes the whole shared document. */
function bindStore() {
    // store.subjects and store.types are the sidecar's live section objects.
    // Both are per-note metadata keyed book → uid; they ride the SAME reconciler
    // (a uid shuffle moves each note's subject AND type together).
    store = { subjects: getSection('subjects'), types: getSection('noteTypes') };
    let changed = false;
    while (pendingRenames.length) {
        const [oldName, newName] = pendingRenames.shift();
        changed = renameBookMeta(oldName, newName) || changed;
    }
    if (changed) sidecarScheduleSave();
}

/** Schedule a save of the shared sidecar (subjects live inside it). Kept as a
 *  local name so the many call sites below read unchanged. */
function scheduleSave() {
    if (!store) return;
    sidecarScheduleSave();
}

// Per-book snapshots for the reconciler: book -> { uid: snapKey }.
// A snapshot mirrors the last state we reconciled FROM DISK; the event is a
// hint to re-diff, never trusted as a delta (audit §20.1).
const snapshots = new Map();

// Subscribers (the listcol) — notified when a reconcile or async load changes
// what subjectOf would answer, so the grouped list repaints.
const listeners = new Set();
const renameListeners = new Set();

// Reconciler wiring, held for teardown. (Debounced-save + unload-flush state
// now lives in the shared sidecar; this module no longer owns a timer.)
let wiHandler = null;

// A book-name resolver injected at init (rail owns "which book is open"),
// so the coarse resync knows which book to re-check without importing rail
// (keeps the dependency one-directional: rail/listcol → store, never back).
let openBookNameFn = () => null;
let bookDataFn = () => null;   // (name) -> ST data object { entries } | null

// ============================================================
// Notify
// ============================================================

export function onSubjectsChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emitChanged() { for (const cb of listeners) { try { cb(); } catch (e) { logError('listener', e); } } }
export function onBookRenamed(cb) { renameListeners.add(cb); return () => renameListeners.delete(cb); }
function emitBookRenamed(oldName, newName) {
    for (const cb of renameListeners) {
        try { cb(oldName, newName); } catch (e) { logError('rename listener', e); }
    }
}

// Batch coalescing. While a batch is open, setSubject defers its change notify
// and fires exactly ONE at the end — so a bulk assign-subject repaints every
// listener (the editor AND the list) once, not once per note. Reentrant via a
// depth counter; a dirty flag remembers whether anything actually changed.
let batchDepth = 0;
let batchDirty = false;
export function beginNoteMetaBatch() { batchDepth++; }
export function endNoteMetaBatch() {
    if (batchDepth > 0) batchDepth--;
    if (batchDepth === 0 && batchDirty) { batchDirty = false; emitChanged(); }
}
function notifyChanged() {
    if (batchDepth > 0) { batchDirty = true; return; }
    emitChanged();
}

// (File IO, debounced persistence, and unload flush now live in the shared
// sidecar module — src/sidecar.js. This module keeps only the subject semantics
// and the reconciler, delegating every write through the local scheduleSave()
// wrapper defined above.)

// ============================================================
// Public reads / writes — synchronous off the cache
// ============================================================

/** The subject a note is filed under. Empty cache → the safe floor. */
export function getSubject(bookName, uid) {
    if (!store || !bookName) return DEFAULT_SUBJECT;
    const book = store.subjects[bookName];
    const v = book && book[uid];
    return (typeof v === 'string' && v.trim()) ? v : DEFAULT_SUBJECT;
}

/** File a note under a subject. 'General' is the floor → stored as absence,
 *  so the sidecar only ever holds deliberate departures from the default
 *  (keeps the file small and makes a reaped/mis-attached key harmless). */
export function setSubject(bookName, uid, subject) {
    if (!store || !bookName) return;
    const subj = String(subject ?? '').trim();
    let book = store.subjects[bookName];
    if (subj && subj !== DEFAULT_SUBJECT) {
        if (!book) book = store.subjects[bookName] = {};
        book[uid] = subj;
    } else if (book && (uid in book)) {
        delete book[uid];
        if (!Object.keys(book).length) delete store.subjects[bookName];
    } else {
        return;   // no-op: already the default
    }
    // A subject write never changes snapKey (identity is content + list
    // position), so the reconciler won't mistake it for a shift — nothing to
    // shadow. Persist and notify (deferred to once-per-batch under a bulk op).
    scheduleSave();
    notifyChanged();
}

/** Every subject currently in use in a book, for the picker's "existing"
 *  list. Canonical names always offered; customs the writer already made
 *  surface too, so a subject is reusable without retyping. */
export function subjectsInBook(bookName) {
    const used = new Set();
    const book = bookName && store?.subjects[bookName];
    if (book) for (const uid in book) { const s = book[uid]; if (s) used.add(s); }
    return [...used];
}

/** The note's "type" (the editor's template chip), or '' when unset. Same
 *  sidecar-backed, uid-keyed shape as getSubject — stored in the noteTypes
 *  section so it never touches the ST entry (and never rides into an exported
 *  lorebook). Empty cache / unset → ''. */
export function getType(bookName, uid) {
    if (!store || !bookName) return '';
    const book = store.types[bookName];
    const v = book && book[uid];
    return (typeof v === 'string' && v.trim()) ? v : '';
}

/** Set a note's type. An empty/blank value CLEARS it (stored as absence), so
 *  the section only holds notes the writer actually typed or templated — a
 *  reaped/mis-attached key is harmless. Mirrors setSubject exactly. No
 *  emitChanged: type isn't shown in the list (only the editor, which repaints
 *  itself after a type edit), so there's nothing else to notify. */
export function setType(bookName, uid, type) {
    if (!store || !bookName) return;
    const t = String(type ?? '').trim();
    let book = store.types[bookName];
    if (t) {
        if (!book) book = store.types[bookName] = {};
        book[uid] = t;
    } else if (book && (uid in book)) {
        delete book[uid];
        if (!Object.keys(book).length) delete store.types[bookName];
    } else {
        return;   // no-op: already unset
    }
    scheduleSave();
}

// ============================================================
// Snapshot key — hash(content) + displayIndex (audit §20.3)
// ============================================================

// cyrb53 — a small, fast, well-distributed 53-bit string hash (public domain).
function hash53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Identity of an entry independent of its uid: what a moved/copied note
 *  keeps. content + comment + keys, tied to list position to split dupes. */
function snapKey(e) {
    const di = e.displayIndex ?? e.uid ?? 0;
    const body = `${e.content ?? ''}\u0000${e.comment ?? ''}\u0000${(e.key ?? []).join(',')}`;
    return `${hash53(body)}:${di}`;
}

function takeSnapshot(data) {
    const snap = {};
    if (data?.entries) for (const uid in data.entries) snap[uid] = snapKey(data.entries[uid]);
    return snap;
}

// ============================================================
// Reconcile — diff one book against its snapshot, fix the sidecar
// ============================================================

// Given a book's current entries and our last snapshot of it, derive what
// happened to each uid and remap the sidecar's subject keys accordingly.
// Rules (§9.37 table):
//   uid present before, snapKey unchanged           → nothing
//   uid present before, snapKey CHANGED             → the note at this uid was
//       replaced (delete+reuse, audit §19.4) — treat as a reap of the OLD
//       subject at this uid, then (below) see if the old note reappeared
//   uid gone, its old snapKey now lives at uid' that had no subject → MOVE
//       (shift the key uid → uid')
//   uid gone, old snapKey lives at uid' AND uid also still has that content →
//       COPY (duplicate) — handled implicitly: the source uid keeps its key,
//       the arrival uid' claims a duplicate
//   uid gone, old snapKey nowhere                   → DELETE (reap)
//
// Everything routes through "who owns each old subject now", computed from
// the snapKey correspondence, so move/copy/delete fall out of one pass.
function reconcileBook(bookName, data) {
    if (!bookName || !store) return false;
    const prevSnap = snapshots.get(bookName);
    const curSnap = takeSnapshot(data);

    // First observation of this book (drawer just opened, or a book we've
    // never diffed): adopt the snapshot, touch nothing. We only ACT on a
    // transition we can see both sides of.
    if (!prevSnap) { snapshots.set(bookName, curSnap); return false; }

    // Per-note metadata this book carries: subjects (list grouping) AND types
    // (the template chip). BOTH are uid-keyed and BOTH must stay honest as ST
    // shuffles uids — otherwise a deleted note's uid, reused by the next new
    // note, would inherit its subject/type. Identity (snapKey) doesn't depend on
    // the metadata, so the uid landing is computed ONCE and each map is remapped
    // against it (remapByIdentity).
    const subjBook = store.subjects[bookName];
    const typeBook = store.types[bookName];
    const hasSubj = subjBook && Object.keys(subjBook).length;
    const hasType = typeBook && Object.keys(typeBook).length;
    // Nothing filed for this book → nothing a shuffle could mis-attach. Still
    // refresh the snapshot so a later fill has a clean baseline.
    if (!hasSubj && !hasType) {
        snapshots.set(bookName, curSnap);
        return false;
    }

    // Reverse map of the CURRENT book: snapKey -> [uids now holding it].
    // (Only "after" is needed — we walk our filed notes and ask where each
    // one's note went.) A copy lands one snapKey at two uids; both inherit.
    const afterByKey = new Map();
    for (const uid in curSnap) {
        const k = curSnap[uid];
        if (!afterByKey.has(k)) afterByKey.set(k, []);
        afterByKey.get(k).push(uid);
    }

    let changed = false;
    if (hasSubj) {
        const res = remapByIdentity(subjBook, prevSnap, curSnap, afterByKey);
        if (res.changed) {
            if (Object.keys(res.next).length) store.subjects[bookName] = res.next;
            else delete store.subjects[bookName];
            changed = true;
        }
    }
    if (hasType) {
        const res = remapByIdentity(typeBook, prevSnap, curSnap, afterByKey);
        if (res.changed) {
            if (Object.keys(res.next).length) store.types[bookName] = res.next;
            else delete store.types[bookName];
            changed = true;
        }
    }

    snapshots.set(bookName, curSnap);
    return changed;
}

// Remap ONE uid-keyed metadata map (subjects OR types) across a uid shuffle,
// using the snapshot correspondence. Two passes so a MOVE never clobbers a note
// that STAYED:
//   pass 1 — every filed note still at its uid with unchanged identity keeps
//            its value (the overwhelmingly common case, exact).
//   pass 2 — for each filed note whose identity left its old uid, carry its
//            value to the uid(s) now holding that identity, but only where pass
//            1 didn't already claim them (a stationary note wins its uid;
//            identical-content dupes fall through to the accepted §20.3 residual
//            — a visible mis-file, never corruption). A value nowhere in `after`
//            is a DELETE, reaped by omission.
// Pure: reads the maps, returns { next, changed } — never touches the store.
function remapByIdentity(oldMap, prevSnap, curSnap, afterByKey) {
    const next = {};
    let changed = false;
    const moved = [];

    for (const oldUid in oldMap) {
        // A uid STILL PRESENT in the current book is the same note the user is
        // working on — keep its subject, even if its content hash changed. A
        // live content edit (typing in the body) changes snapKey but NOT the
        // uid; the old test compared snapKey and so read an edit as a departure,
        // reaping the subject mid-keystroke (→ note fell back to 'General').
        // Identity-by-content is only needed to CHASE a uid that genuinely left
        // (move / copy / delete), so route to pass 2 only when oldUid is gone.
        if (oldUid in curSnap) {
            next[oldUid] = oldMap[oldUid];      // stays put (same uid = same note)
        } else {
            moved.push(oldUid);
        }
    }

    for (const oldUid of moved) {
        const val = oldMap[oldUid];
        const key = prevSnap[oldUid];
        const landedAt = key !== undefined ? (afterByKey.get(key) ?? []) : [];
        const free = landedAt.filter(u => !(u in next));
        if (free.length) {
            for (const newUid of free) next[newUid] = val;   // MOVE / COPY / reuse
        }
        changed = true;
    }

    return { next, changed };
}

// ============================================================
// Coarse resync — the WI-event driver (audit §20.1)
// ============================================================

// The event names a book, but the debounce closure is lossy across books, so
// we don't trust it as a delta. We re-check the OPEN book against disk on any
// WI event (and drawer-open). A dropped last-in-burst save self-heals here on
// the next event that touches the drawer.
function resyncOpenBook() {
    if (!store) return;                      // file not loaded yet — nothing to protect
    const name = openBookNameFn();
    if (!name) return;
    const data = bookDataFn(name);
    if (!data) return;
    const changed = reconcileBook(name, data);
    if (changed) { scheduleSave(); emitChanged(); }
}

// ============================================================
// Rename remap — move a book's per-note metadata across a rename
// ============================================================

/** Move a book's per-note metadata (subjects + types) AND its reconciler
 *  snapshot from oldName → newName. Each section moves only when the source has
 *  it and the target doesn't, so this is idempotent across the observer's and
 *  the explicit path's double-fire. Returns true if anything moved. The sidecar
 *  is keyed by book name, so a rename must carry both maps or they'd orphan. */
function renameBookMeta(oldName, newName) {
    let moved = false;
    if (store.subjects[oldName] && !store.subjects[newName]) {
        store.subjects[newName] = store.subjects[oldName];
        delete store.subjects[oldName];
        moved = true;
    }
    if (store.types[oldName] && !store.types[newName]) {
        store.types[newName] = store.types[oldName];
        delete store.types[oldName];
        moved = true;
    }
    if (moved && snapshots.has(oldName)) {
        snapshots.set(newName, snapshots.get(oldName));
        snapshots.delete(oldName);
    }
    return moved;
}

// ============================================================
// Rename observer (audit §20.2) — the ONLY hook that sees a rename, because
// deleteWorldInfo is silent. Watches #world_editor_select's option text flip
// under a stable selected index and remaps that one book's sidecar keys.
// ============================================================

let selObserver = null;
let lastSelName = null;

function wireRenameObserver() {
    const sel = document.getElementById('world_editor_select');
    if (!sel) return;
    const selName = () => {
        const opt = sel.options[sel.selectedIndex];
        // The empty-value option is ST's "— pick to edit —" placeholder, never
        // a real book. Treat landing on it as "no book" (null), NOT as a name.
        return (opt && opt.value !== '') ? (opt.text ?? null) : null;
    };
    lastSelName = selName();
    const onChange = () => {
        const now = selName();
        // IGNORE the placeholder blip. ST's renameWorldInfo doesn't fire one
        // clean old→new change: deleteWorldInfo(oldName) fires an INTERMEDIATE
        // change first, with the selection dropped to the placeholder (nothing
        // selected), BEFORE the final change to the new name. If we let that
        // through, `before` (the old name) gets remapped onto the placeholder
        // and the subjects are lost. Skipping it here (without touching
        // lastSelName) keeps the old name as `before` so the final change to
        // the new name is recognised as the rename it is.
        if (now === null) return;
        const before = lastSelName;
        lastSelName = now;
        // A rename fires change with the SAME selected index but new text and
        // the old name gone from every option. A plain book-switch changes the
        // index and keeps the old name present elsewhere — not a rename.
        if (!before || !now || before === now) return;
        const stillListed = [...sel.options].some(o => o.text === before);
        if (stillListed) return;             // book-switch, not a rename
        if (store) {
            if (renameBookMeta(before, now)) {
                scheduleSave();
                emitChanged();
                log('note meta remapped on rename', before, '→', now);
            }
        } else {
            pendingRenames.push([before, now]);
        }
        emitBookRenamed(before, now);
    };
    sel.addEventListener('change', onChange);
    selObserver = () => sel.removeEventListener('change', onChange);
}

// ============================================================
// Lifecycle
// ============================================================

/** Load the shared sidecar and arm the reconciler. `deps` injects the open-book
 *  resolvers so the store never imports rail/listcol (one-way dependency). The
 *  sidecar load is idempotent (shared with the char browser), so this is safe to
 *  call whether or not the other drawer already triggered the load this session. */
export function initSubjectStore({ openBookName, bookData } = {}) {
    if (typeof openBookName === 'function') openBookNameFn = openBookName;
    if (typeof bookData === 'function') bookDataFn = bookData;

    // A quick open/close may unsubscribe before the asynchronous load finishes.
    // Re-check on every init so reopening always binds or subscribes again.
    if (isSidecarLoaded()) {
        const firstBind = !store;
        bindStore();
        resyncOpenBook();
        if (firstBind) emitChanged();
    } else {
        if (sidecarUnsub) sidecarUnsub();
        sidecarUnsub = onSidecarLoaded(() => {
            bindStore();
            resyncOpenBook();
            emitChanged();
        });
        ensureSidecarLoaded();
    }

    const { eventSource, event_types } = ctx();
    wiHandler = () => resyncOpenBook();
    eventSource.on(event_types.WORLDINFO_UPDATED, wiHandler);

    wireRenameObserver();
    log('subject store initialized');
}

/** Called on drawer-open too (via init) — the coarse resync's second trigger.
 *  Safe to call any time the open book may have shifted under us. */
export function resyncSubjects() { resyncOpenBook(); }

export function teardownSubjectStore() {
    if (wiHandler) {
        try { const { eventSource, event_types } = ctx(); eventSource.removeListener(event_types.WORLDINFO_UPDATED, wiHandler); }
        catch (e) { logError('teardown wi', e); }
        wiHandler = null;
    }
    if (sidecarUnsub) { sidecarUnsub(); sidecarUnsub = null; }
    if (selObserver) { selObserver(); selObserver = null; }
    // Flush any pending sidecar save (best effort). The sidecar keeps its cache
    // + unload flush alive for the rest of the session, so a reopen (or the char
    // browser) doesn't re-fetch and an unsaved edit still lands on unload.
    flushSidecar();
    log('subject store torn down');
}
