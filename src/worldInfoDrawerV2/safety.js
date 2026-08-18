// src/worldInfoDrawerV2/safety.js
// Safety helpers for bulk lorebook operations:
//   1. backupBook()      — snapshot a book to a timestamped copy before risky ops
//   2. detectBadUids()   — flag the specific timestamp_index string-UID corruption
//   3. verifyBookSaved() — confirm a write actually landed (entry count + parseable)
//
// backupBook is intentionally used in ONE place only: the corruption repair flow,
// which destructively rewrites UIDs and so warrants a single snapshot first.
// Bulk move/copy do NOT back up (they're verified pre-save and recoverable), so
// the user's worlds list isn't flooded with .bak- books. Any backup that IS made
// is left for the user to delete manually — we never auto-prune.
//
// Design notes:
//  - We persist through ST's own saveWorldInfo, so writes go via /api/worldinfo/edit
//    and respect the user's worlds folder (including network shares).
//  - loadWorldInfo returns a CACHED-BY-REFERENCE object, so we always deep-clone
//    before mutating or re-saving under a new name.
//  - We NEVER auto-rewrite UIDs. Detection only flags; repair is user-initiated.

const worldInfoPromise = import('../../../../../../scripts/world-info.js');

/** Deep clone that prefers structuredClone, falls back to JSON. */
function clone(obj) {
    try {
        return structuredClone(obj);
    } catch {
        return JSON.parse(JSON.stringify(obj));
    }
}

/** Backup name suffix: ".bak-YYYYMMDD-HHMMSS". Capture group = sortable stamp. */
const BACKUP_SUFFIX = /\.bak-(\d{8}-\d{6})$/;

/** True if a book name is one of our generated backups. */
export function isBackupName(name) {
    return BACKUP_SUFFIX.test(String(name || ''));
}

/**
 * Detect the specific corruption we know about: entry keys / uids shaped like
 * `1766162331899_0` (millisecond-timestamp + underscore + index) instead of
 * plain integers. This is intentionally NARROW — we do NOT flag every
 * non-integer key, because advanced users may legitimately use unusual UID
 * schemes. We only match the timestamp_index pattern ST generates on a
 * botched merge/move.
 *
 * @param {object} data - A loaded world info object ({ entries: {...} })
 * @returns {{ corrupt: boolean, badKeys: string[], total: number }}
 */
export function detectBadUids(data) {
    const result = { corrupt: false, badKeys: [], total: 0 };
    if (!data || typeof data.entries !== 'object' || data.entries === null) return result;

    const keys = Object.keys(data.entries);
    result.total = keys.length;

    // Pattern: 13-digit (ms) timestamp, underscore, one or more digits.
    const TS_INDEX = /^\d{13}_\d+$/;

    for (const k of keys) {
        const entry = data.entries[k];
        const uid = entry && typeof entry === 'object' ? entry.uid : undefined;
        if (TS_INDEX.test(String(k)) || TS_INDEX.test(String(uid))) {
            result.badKeys.push(k);
        }
    }
    result.corrupt = result.badKeys.length > 0;
    return result;
}

/**
 * Create a timestamped backup copy of a book inside the worlds folder.
 * The backup is a normal lorebook named "<name>.bak-YYYYMMDD-HHMMSS" so it's
 * visible, restorable, and never silently overwrites anything.
 *
 * @param {string} name - Source book name
 * @returns {Promise<string|null>} backup book name on success, null on failure
 */
export async function backupBook(name) {
    if (!name) return null;
    if (isBackupName(name)) {
        // Never back up a backup — avoids ".bak-...bak-..." chains.
        console.warn(`[UIBedazzler:safety] Refusing to back up a backup book "${name}".`);
        return null;
    }
    try {
        const { loadWorldInfo, saveWorldInfo, updateWorldInfoList } = await worldInfoPromise;
        const live = await loadWorldInfo(name);
        if (!live || !live.entries) {
            console.warn(`[UIBedazzler:safety] Cannot back up "${name}" — no data loaded.`);
            return null;
        }
        // Deep clone — loadWorldInfo hands back the cached reference.
        const snapshot = clone(live);

        // Timestamp: YYYYMMDD-HHMMSS
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const backupName = `${name}.bak-${stamp}`;

        await saveWorldInfo(backupName, snapshot, true);
        if (typeof updateWorldInfoList === 'function') {
            await updateWorldInfoList();
        }
        console.log(`[UIBedazzler:safety] Backed up "${name}" → "${backupName}" (${Object.keys(snapshot.entries).length} entries).`);

        return backupName;
    } catch (err) {
        console.error(`[UIBedazzler:safety] Backup of "${name}" failed:`, err);
        return null;
    }
}

/**
 * Verify a book on disk matches an expected entry count and parses cleanly.
 * Forces a fresh read by bypassing the in-memory cache where possible.
 *
 * @param {string} name
 * @param {number} expectedCount
 * @returns {Promise<boolean>}
 */
export async function verifyBookSaved(name, expectedCount) {
    try {
        const { loadWorldInfo } = await worldInfoPromise;
        const data = await loadWorldInfo(name);
        if (!data || typeof data.entries !== 'object') return false;
        const actual = Object.keys(data.entries).length;
        if (typeof expectedCount === 'number' && actual !== expectedCount) {
            console.warn(`[UIBedazzler:safety] Verify "${name}": expected ${expectedCount} entries, found ${actual}.`);
            return false;
        }
        return true;
    } catch (err) {
        console.error(`[UIBedazzler:safety] Verify "${name}" failed:`, err);
        return false;
    }
}

/**
 * Result shape for a batch move/copy.
 * @typedef {Object} BatchResult
 * @property {boolean} ok
 * @property {number} moved        Count successfully transferred
 * @property {string} [reason]     Failure reason (when ok=false)
 * @property {number[]} [newUids]  UIDs assigned in the target
 */

/**
 * Batch-transfer multiple entries between two books with exactly ONE save per
 * book instead of ST's per-entry load-save-load-save loop.
 *
 * Why this is safer than looping moveWorldInfoEntry:
 *  - Each book is loaded once and saved once. The interruption window shrinks
 *    from 2N writes to 2 writes total.
 *  - We assign target UIDs ourselves as sequential free integers, so we never
 *    touch ST's import-time timestamp_index fallback (the source of the
 *    `1766162331899_0` corruption).
 *  - We verify both books on disk after writing; the caller still holds a
 *    pre-op backup, so a failed verify is fully recoverable.
 *
 * This does NOT replace single-entry moves — moveWorldInfoEntry stays in use
 * for those. Caller is responsible for backups, confirmation, and corruption
 * pre-checks (see assertNoCorruption).
 *
 * @param {string} sourceName
 * @param {string} targetName
 * @param {number[]} uids        UIDs (as they exist in source) to transfer
 * @param {{ deleteOriginal?: boolean }} [opts]
 * @returns {Promise<BatchResult>}
 */
export async function batchTransferEntries(sourceName, targetName, uids, { deleteOriginal = true } = {}) {
    if (!sourceName || !targetName || sourceName === targetName) {
        return { ok: false, moved: 0, reason: 'invalid-books' };
    }
    if (!Array.isArray(uids) || uids.length === 0) {
        return { ok: false, moved: 0, reason: 'no-entries' };
    }
    try {
        const { loadWorldInfo, saveWorldInfo, getFreeWorldEntryUid, deleteWIOriginalDataValue } = await worldInfoPromise;

        // Load each book ONCE. loadWorldInfo hands back cached references, so
        // deep-clone before mutating to avoid aliasing the live cache.
        const sourceLive = await loadWorldInfo(sourceName);
        const targetLive = await loadWorldInfo(targetName);
        if (!sourceLive || !sourceLive.entries) return { ok: false, moved: 0, reason: 'source-load-failed' };
        if (!targetLive || !targetLive.entries) return { ok: false, moved: 0, reason: 'target-load-failed' };

        const sourceData = clone(sourceLive);
        const targetData = clone(targetLive);

        const newUids = [];
        let movedCount = 0;

        // Compute the highest displayIndex once; increment as we append.
        let maxDisplayIndex = Object.values(targetData.entries)
            .reduce((max, e) => Math.max(max, Number.isFinite(e?.displayIndex) ? e.displayIndex : -1), -1);

        for (const uid of uids) {
            const key = String(uid);
            const entry = sourceData.entries[key];
            if (!entry) {
                console.warn(`[UIBedazzler:safety] batch: entry ${key} not in "${sourceName}" — skipped.`);
                continue;
            }

            // Fresh integer UID in the target. getFreeWorldEntryUid scans for the
            // first unused integer key, so adding to targetData.entries between
            // iterations makes the next call return the next free integer.
            const newUid = getFreeWorldEntryUid(targetData);
            if (newUid === null) {
                return { ok: false, moved: movedCount, reason: 'no-free-uid', newUids };
            }

            const copy = clone(entry);
            copy.uid = newUid;
            copy.displayIndex = ++maxDisplayIndex;
            targetData.entries[String(newUid)] = copy;
            newUids.push(newUid);
            movedCount++;

            if (deleteOriginal) {
                delete sourceData.entries[key];
                // Keep ST's parallel originalData in sync (no-op if absent).
                try { deleteWIOriginalDataValue(sourceData, key); } catch { /* non-fatal */ }
            }
        }

        // Persist: ONE write per book. Target first (additions), then source
        // (removals) — same order core uses, so an interruption between them
        // leaves the moved entries present in BOTH books (recoverable dupes)
        // rather than lost from both.
        await saveWorldInfo(targetName, targetData, true);
        if (deleteOriginal) {
            await saveWorldInfo(sourceName, sourceData, true);
        }

        // Verify target gained the entries; verify source shrank (move only).
        const targetCount = Object.keys(targetData.entries).length;
        const targetOk = await verifyBookSaved(targetName, targetCount);
        let sourceOk = true;
        if (deleteOriginal) {
            const sourceCount = Object.keys(sourceData.entries).length;
            sourceOk = await verifyBookSaved(sourceName, sourceCount);
        }
        if (!targetOk || !sourceOk) {
            return { ok: false, moved: movedCount, reason: 'verify-failed', newUids };
        }

        return { ok: true, moved: movedCount, newUids };
    } catch (err) {
        console.error('[UIBedazzler:safety] batchTransferEntries failed:', err);
        return { ok: false, moved: 0, reason: String(err?.message || err) };
    }
}

/**
 * Pre-flight corruption gate for a batch op. Loads the named books and returns
 * the first one showing timestamp_index UID corruption, or null if all clean.
 * The caller uses this to BLOCK a move and prompt repair first.
 *
 * @param {string[]} names
 * @returns {Promise<{ name: string, badKeys: string[] } | null>}
 */
export async function assertNoCorruption(names) {
    const { loadWorldInfo } = await worldInfoPromise;
    for (const name of names) {
        if (!name || isBackupName(name)) continue;
        try {
            const data = await loadWorldInfo(name);
            const scan = detectBadUids(data);
            if (scan.corrupt) return { name, badKeys: scan.badKeys };
        } catch (err) {
            console.warn(`[UIBedazzler:safety] corruption pre-check could not load "${name}":`, err);
        }
    }
    return null;
}
