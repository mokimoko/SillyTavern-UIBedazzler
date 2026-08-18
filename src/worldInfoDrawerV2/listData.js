// src/worldInfoDrawerV2/listData.js
// WI v2 listcol (and, next pour, editor) — the ST read/write layer for the
// OPEN BOOK. Same shape as railData.js: every ST touch in one file, no
// mirrored state. The one object held here IS the loadWorldInfo result —
// the same live reference v1's entryList edits — so "our data" and "what
// saveWorldInfo writes" can never be two different things.
//
// §9.31 lives here. The save model is v1's, adopted after reading its save
// path (entryList.js): mutations schedule a 400ms debounced saveWorldInfo,
// lifecycle transitions FLUSH. So "unsaved edits" is at most a debounce
// window, and the guard on book-switch is flushPendingSave() at the top of
// loadBook() — a flush, not a dialog. One gate: every switch (row click,
// arrival, chat change) reaches loadBook through rail's onOpenBookChanged.

const wiPromise = import('../../../../../../scripts/world-info.js');

const ctx = () => SillyTavern.getContext();
let loadToken = 0;

let bookName = null;    // the open book's filename (null = nothing open)
let bookData = null;    // loadWorldInfo result — ST's object, not a copy

// ============================================================
// Reads
// ============================================================

/** The open book, as { name, data } (either may be null). */
export function getBook() {
    return { name: bookName, data: bookData };
}

/** One entry of the open book by uid, or null. */
export function getEntry(uid) {
    return bookData?.entries?.[uid] ?? null;
}

// ============================================================
// Open / close — §9.31's single gate
// ============================================================

/**
 * Open a book: flush the OUTGOING book's pending save (§9.31), then load.
 * Passing null closes without loading (still flushes). Returns the data,
 * or null when nothing loaded (missing book, unreadable file).
 */
export async function loadBook(name) {
    const token = ++loadToken;
    await flushPendingSave();   // outgoing edits land before anything moves
    if (token !== loadToken) return null;
    if (!name) { bookName = null; bookData = null; return null; }
    try {
        const { loadWorldInfo } = await wiPromise;
        const data = await loadWorldInfo(name);
        if (token !== loadToken) return null;
        if (!data?.entries) { bookName = null; bookData = null; return null; }
        bookName = name;
        bookData = data;
        return data;
    } catch {
        bookName = null; bookData = null;
        return null;
    }
}

// ============================================================
// Save plumbing — v1's model (entryList.js), verbatim in shape
// ============================================================

let saveTimer = null;
const SAVE_DEBOUNCE_MS = 400;

/** Schedule a debounced save — for live text/number input (editor pour). */
export function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        commitSave();
    }, SAVE_DEBOUNCE_MS);
}

/** Save the open book to disk immediately. */
export async function commitSave() {
    const name = bookName;
    const data = bookData;
    if (!name || !data) return;
    try {
        const { saveWorldInfo } = await wiPromise;
        await saveWorldInfo(name, data);
    } catch (err) {
        console.error('[BD] WI v2: save failed:', err);
    }
}

/**
 * §9.31 — the guard body. If a debounced save is pending, land it NOW.
 * A pending timer is the only "dirty" state this model has: every mutation
 * either scheduled one or committed directly, so no timer means no unsaved
 * edits and nothing to write.
 */
export async function flushPendingSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    await commitSave();
}

// ============================================================
// Mutations the listcol performs
// ============================================================

/**
 * New note, born into the open book (mock's rule). Uses ST's own
 * createWorldInfoEntry (free-UID allocation is its job, not ours), commits
 * immediately — a note that exists on screen but not on disk is a lie
 * waiting for a crash — and returns the new entry.
 */
export async function createEntry() {
    if (!bookName || !bookData) return null;
    try {
        const { createWorldInfoEntry } = await wiPromise;
        const entry = createWorldInfoEntry(bookName, bookData);
        if (!entry) return null;
        await commitSave();
        return entry;
    } catch (err) {
        console.error('[BD] WI v2: create entry failed:', err);
        return null;
    }
}

/**
 * Bulk delete, v1's recipe (entryList.js bulkDelete): work on a deep copy so
 * the deletions batch into ONE save; deleteWorldInfoEntry per uid (silent —
 * we confirm once for the batch, not once per note); save with immediate=true;
 * poke ST's native editor so its view can't go stale. Only on success does
 * the working copy become the open book's data.
 * Returns the number of entries deleted, or -1 on failure.
 */
export async function deleteEntries(uids) {
    if (!bookName || !bookData || !uids.length) return -1;
    try {
        const { deleteWorldInfoEntry, saveWorldInfo, reloadEditor } = await wiPromise;
        const work = structuredClone(bookData);
        let n = 0;
        for (const uid of uids) {
            if (work.entries[uid]) {
                await deleteWorldInfoEntry(work, uid, { silent: true });
                n++;
            }
        }
        if (!n) return 0;
        await saveWorldInfo(bookName, work, true);
        try { reloadEditor?.(bookName, false); } catch { /* view-only */ }
        bookData = work;
        return n;
    } catch (err) {
        console.error('[BD] WI v2: bulk delete failed:', err);
        return -1;
    }
}

/**
 * Bulk MOVE / COPY the selected entries FROM the open book TO another book,
 * ported from batchTransferEntries (worldInfoDrawerV2/safety.js) — one save
 * per book instead of ST's per-entry load-save loop, with SELF-ASSIGNED integer
 * UIDs in the target so we never touch ST's import-time timestamp_index
 * fallback (the `1766162331899_0` corruption source). deleteOriginal=true is a
 * move; false is a copy.
 *
 * Corruption gate: both books are pre-flight scanned (assertNoCorruption). If
 * either already shows the timestamp_index corruption we BLOCK and return
 * { ok:false, reason:'corrupt', badBook } so the caller can route to repair
 * (same policy as v1: never write on top of known corruption).
 *
 * Subjects: NOT remapped here. The §9.37 reconciler in subjectStore watches
 * WORLDINFO_UPDATED and carries each moved/copied note's subject to its new uid
 * on the next pass (see 07-19-bulk-assign-subject handoff §Blocker-dissolved).
 * We still return newUids in push order for a belt-and-suspenders remap if that
 * ever proves lossy on a fast burst.
 *
 * Ordering (v1's, load-bearing): write the TARGET first (additions), then the
 * SOURCE (removals) — an interruption between the two writes leaves the moved
 * notes present in BOTH books (recoverable dupes) rather than lost from both.
 * The open book IS the source, so on a move we swap bookData to the shrunken
 * working copy and reloadEditor, exactly like deleteEntries.
 *
 * @param {string} targetName   destination book (may equal source for a copy)
 * @param {number[]} uids       uids in the OPEN book to transfer
 * @param {{ move?: boolean }} [opts]
 * @returns {Promise<{ok:boolean, moved:number, reason?:string, badBook?:string, newUids?:number[]}>}
 */
export async function transferEntries(targetName, uids, { move = true } = {}) {
    const sourceName = bookName;
    if (!sourceName || !bookData) return { ok: false, moved: 0, reason: 'no-open-book' };
    if (!targetName) return { ok: false, moved: 0, reason: 'no-target' };
    if (move && targetName === sourceName) return { ok: false, moved: 0, reason: 'same-book' };
    if (!Array.isArray(uids) || !uids.length) return { ok: false, moved: 0, reason: 'no-entries' };

    // Land any pending edit to the source before we clone it (§9.31). Otherwise
    // a debounced title change could be lost when we overwrite bookData below.
    await flushPendingSave();

    try {
        const {
            loadWorldInfo, saveWorldInfo, reloadEditor,
            getFreeWorldEntryUid, deleteWIOriginalDataValue,
        } = await wiPromise;
        const { assertNoCorruption } = await import('./safety.js');

        // Pre-flight corruption gate — both books (skip when source===target).
        const names = sourceName === targetName ? [sourceName] : [sourceName, targetName];
        const bad = await assertNoCorruption(names);
        if (bad) return { ok: false, moved: 0, reason: 'corrupt', badBook: bad.name };

        // Source: our live open book (already loaded). Clone before mutating so
        // an aborted op never half-touches the live reference.
        const sourceData = structuredClone(bookData);
        // Target: load ONCE. Same-book copy reuses the source clone so both
        // adds and (no) removes land in one object / one save.
        let targetData;
        if (targetName === sourceName) {
            targetData = sourceData;
        } else {
            const targetLive = await loadWorldInfo(targetName);
            if (!targetLive?.entries) return { ok: false, moved: 0, reason: 'target-load-failed' };
            targetData = structuredClone(targetLive);
        }

        const newUids = [];
        let moved = 0;
        let maxDisplayIndex = Object.values(targetData.entries)
            .reduce((m, e) => Math.max(m, Number.isFinite(e?.displayIndex) ? e.displayIndex : -1), -1);

        for (const uid of uids) {
            const key = String(uid);
            const entry = sourceData.entries[key];
            if (!entry) continue;   // gone from source (raced) — skip, don't fail
            const newUid = getFreeWorldEntryUid(targetData);
            if (newUid === null) return { ok: false, moved, reason: 'no-free-uid', newUids };
            const copy = structuredClone(entry);
            copy.uid = newUid;
            copy.displayIndex = ++maxDisplayIndex;
            targetData.entries[String(newUid)] = copy;
            newUids.push(newUid);
            moved++;
            if (move && targetName !== sourceName) {
                delete sourceData.entries[key];
                try { deleteWIOriginalDataValue(sourceData, key); } catch { /* non-fatal */ }
            }
        }
        if (!moved) return { ok: false, moved: 0, reason: 'none-transferred' };

        // Persist: target first, then source (move only). Same-book copy is a
        // single write (target IS source).
        await saveWorldInfo(targetName, targetData, true);
        if (move && targetName !== sourceName) {
            await saveWorldInfo(sourceName, sourceData, true);
            // The open book shrank — adopt the working copy and refresh ST's
            // native editor so its view can't go stale (deleteEntries' rule).
            bookData = sourceData;
            try { reloadEditor?.(sourceName, false); } catch { /* view-only */ }
        } else if (targetName === sourceName) {
            // Same-book copy: the open book GREW. Adopt + reload.
            bookData = targetData;
            try { reloadEditor?.(sourceName, false); } catch { /* view-only */ }
        }
        return { ok: true, moved, newUids };
    } catch (err) {
        console.error('[BD] WI v2: transfer failed:', err);
        return { ok: false, moved: 0, reason: String(err?.message || err) };
    }
}

// ============================================================
// Themed confirm — ST's popup with a native fallback (v1's pattern)
// ============================================================

export async function confirmPopup(title, message, okButton) {
    try {
        const { Popup } = ctx();
        const result = await Popup.show.confirm(title, message,
            { okButton, cancelButton: 'Cancel' });
        return result === 1;
    } catch {
        return confirm(`${title}\n\n${message}`);
    }
}
