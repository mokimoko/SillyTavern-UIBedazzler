// src/sidecar.js
// Shared Bedazzler sidecar — ONE JSON file in the user's files holding every
// piece of Bedazzler-custom metadata that has no home on an ST object.
//
// WHY THIS EXISTS: two features grew their own custom-data needs. WI v2 needs
// per-note "subjects" (ST has no field for them); the Character Browser needs
// per-tag descriptions / related-tags and its page-size choice. Originally each
// stored separately — WI in its own sidecar (uibedazzler_wi_meta.json), the char
// browser in ST extension settings. This module unifies both into a single
// generalized sidecar (uibedazzler_meta.json) so there's one file-IO path, one
// debounce, one unload flush, and one cache shared across the whole session.
//
// DOCUMENT SHAPE on disk:
//   {
//     version: 2,
//     lastModified: <iso>,
//     subjects:   { "<book>": { "<uid>": subject } },   // WI v2 (subjectStore)
//     charBrowser:{ tagMeta: { "<tagId>": {...} }, pageSize: <n> }  // char browser
//   }
// Top-level keys are SECTIONS owned by their feature module. This module knows
// nothing about their inner shape — it just loads, caches, and persists the
// whole document, exposing generic section get/set. The feature modules
// (subjectStore.js, charData.js) layer their own semantics on top.
//
// STORAGE MECHANISM (unchanged from the proven WI path): POST /api/files/upload
// (base64) to write, GET /user/files/<name> to read, 404 → empty, debounced
// saves, sendBeacon flush on unload, in-memory cache. This is the exact pattern
// Simple Summarizer's fileStore.js established on this install.
//
// MIGRATION (one-time, on first load): if uibedazzler_meta.json 404s, we look
// for the OLD WI file (uibedazzler_wi_meta.json) and adopt its `subjects` into
// the new document, then DELETE the old file. Separately, charData.js runs its
// own settings→sidecar migration for tagMeta/pageSize the first time it reads a
// sidecar that has no charBrowser section (see migrateCharBrowserFromSettings).
//
// CONCURRENCY: the two drawers are full-viewport takeovers and never open at
// once, but either may open first in a session and the other second. The cache
// + debounce timer are module singletons, so whichever opens first triggers the
// load; the second reuses the cache. Saves from both sections merge into the one
// document (last-write-wins per key, which is fine — they touch disjoint keys).

const ctx = () => SillyTavern.getContext();
const getHeaders = () => ctx().getRequestHeaders();

const log = () => {};
const logError = (...a) => console.error('[BD] sidecar:', ...a);

const FILENAME = 'uibedazzler_meta.json';
const FILE_URL = `/user/files/${FILENAME}`;
const OLD_WI_FILENAME = 'uibedazzler_wi_meta.json';
const OLD_WI_URL = `/user/files/${OLD_WI_FILENAME}`;
const DEBOUNCE_MS = 1500;
const SCHEMA_VERSION = 2;

// ============================================================
// Module state (singletons)
// ============================================================

let doc = null;        // in-memory cache of the whole document, null until loaded
let loadPromise = null; // the in-flight (or settled) load, so callers can await once
let loaded = false;

let saveTimer = null;
let pendingData = null;
let unloadHandler = null;

// Subscribers notified when the async load resolves (so a feature that read an
// empty cache synchronously can repaint once the real data arrives).
const listeners = new Set();

export function onSidecarLoaded(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emitLoaded() { for (const cb of listeners) { try { cb(); } catch (e) { logError('listener', e); } } }

// ============================================================
// Document shape
// ============================================================

function emptyDoc() {
    return { version: SCHEMA_VERSION, lastModified: new Date().toISOString(), subjects: {}, noteTypes: {}, charBrowser: {}, charTitles: {} };
}

/** Normalize an arbitrary parsed object into a well-formed document, tolerating
 *  the old v1 WI shape ({ version:1, subjects }) which simply lacks charBrowser. */
function normalizeDoc(raw) {
    const d = (raw && typeof raw === 'object') ? raw : {};
    return {
        version: SCHEMA_VERSION,
        lastModified: d.lastModified || new Date().toISOString(),
        subjects: (d.subjects && typeof d.subjects === 'object') ? d.subjects : {},
        // WI v2 note "type" (the template chip), keyed book → uid, alongside
        // subjects. Kept a distinct section (not merged into subjects) so the
        // existing subjects data on users' disks needs no migration.
        noteTypes: (d.noteTypes && typeof d.noteTypes === 'object') ? d.noteTypes : {},
        charBrowser: (d.charBrowser && typeof d.charBrowser === 'object') ? d.charBrowser : {},
        charTitles: (d.charTitles && typeof d.charTitles === 'object') ? d.charTitles : {},
    };
}

// ============================================================
// File API (mirrors Simple Summarizer's fileStore.js)
// ============================================================

async function uploadJSON(name, data) {
    const json = JSON.stringify(data, null, 2);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name, data: base64 }),
    });
    if (!res.ok) throw new Error(`upload failed: ${await res.text()}`);
    return (await res.json()).path;
}

async function downloadJSON(url) {
    const res = await fetch(url, { method: 'GET', headers: getHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`download failed: ${await res.text()}`);
    const text = await res.text();
    // Normally the file is plain JSON. On some ST installs the upload endpoint
    // stores our base64 payload VERBATIM instead of decoding it, so the file on
    // disk is base64-encoded JSON (starts like "ewog..." = "{\n  "). Parsing
    // that as JSON throws "Unexpected token 'e'". Fall back to base64-decoding
    // once before giving up, so we transparently read BOTH shapes (and any file
    // we ourselves wrote base64 keeps loading). UTF-8 aware: atob → bytes →
    // TextDecoder, mirroring the encode path in uploadJSON.
    try {
        return JSON.parse(text);
    } catch (parseErr) {
        try {
            const binary = atob(text.trim());
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const decoded = new TextDecoder().decode(bytes);
            return JSON.parse(decoded);
        } catch {
            // Not base64 either — surface the ORIGINAL JSON error (the honest one).
            throw parseErr;
        }
    }
}

/** Best-effort delete of a user file (used to clean up the old WI sidecar after
 *  migration). ST exposes /api/files/delete on this install; a failure is
 *  non-fatal (the file just lingers harmlessly and won't be read again). */
async function deleteFile(name) {
    try {
        const res = await fetch('/api/files/delete', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name }),
        });
        if (!res.ok) log('old-file delete non-ok', name, res.status);
    } catch (e) {
        log('old-file delete failed', name, e?.message);
    }
}

// ============================================================
// Load (with one-time WI-file migration)
// ============================================================

/**
 * Load the sidecar once, resolving the shared cache. Idempotent: concurrent or
 * repeat callers get the same in-flight promise, and a settled load resolves
 * immediately. On a fresh install (both files 404) the cache becomes an empty
 * document. If the NEW file is absent but the OLD WI file exists, we adopt its
 * subjects into the new document, persist it under the new name, and delete the
 * old file (clean migration).
 *
 * Always resolves (never rejects) so a load failure degrades to an empty cache
 * rather than breaking a drawer; the error is logged.
 */
export function ensureSidecarLoaded() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        try {
            const fresh = await downloadJSON(FILE_URL);
            if (fresh) {
                doc = normalizeDoc(fresh);
            } else {
                // New file absent — try migrating the old WI sidecar.
                const old = await downloadJSON(OLD_WI_URL).catch(() => null);
                if (old && old.subjects && typeof old.subjects === 'object') {
                    doc = normalizeDoc({ subjects: old.subjects });
                    // Persist under the new name, then remove the old file so we
                    // never migrate twice.
                    try {
                        await uploadJSON(FILENAME, doc);
                        await deleteFile(OLD_WI_FILENAME);
                        log('migrated WI sidecar → shared sidecar');
                    } catch (e) {
                        logError('WI migration persist failed', e?.message);
                    }
                } else {
                    doc = emptyDoc();
                }
            }
        } catch (e) {
            logError('load', e?.message);
            doc = emptyDoc();
        } finally {
            loaded = true;
            armUnloadFlush();
            emitLoaded();
        }
        return doc;
    })();
    return loadPromise;
}

/** True once the async load has settled (cache is populated). */
export function isSidecarLoaded() { return loaded; }

// ============================================================
// Section access — synchronous off the cache
// ============================================================

/**
 * Read a top-level section object (e.g. 'subjects', 'charBrowser'). Returns the
 * LIVE object from the cache (callers may mutate it in place, then call
 * scheduleSave() to persist). Before the load resolves — or on any miss — an
 * empty object is created and stored so the caller always gets a live handle it
 * can write into; the write persists once the load has populated siblings.
 */
export function getSection(key) {
    if (!doc) doc = emptyDoc();
    if (!doc[key] || typeof doc[key] !== 'object') doc[key] = {};
    return doc[key];
}

/** Replace a top-level section wholesale and schedule a save. Rarely needed —
 *  most callers mutate the live object from getSection and call scheduleSave. */
export function setSection(key, value) {
    if (!doc) doc = emptyDoc();
    doc[key] = value;
    scheduleSave();
}

// ============================================================
// Debounced persistence
// ============================================================

/** Schedule a debounced write of the whole document. Safe to call before the
 *  load resolves: it stamps lastModified and coalesces rapid writes; the actual
 *  upload carries whatever the cache holds when the timer fires. */
export function scheduleSave() {
    if (!doc) return;
    doc.lastModified = new Date().toISOString();
    pendingData = doc;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        const data = pendingData;
        pendingData = null;
        try { await uploadJSON(FILENAME, data); }
        catch (e) { logError('debounced save', e?.message); pendingData = data; }
    }, DEBOUNCE_MS);
}

/** Flush a pending save immediately (best-effort, async). Used by feature
 *  teardowns that want their write on disk without waiting out the debounce. */
export function flushSidecar() {
    if (!saveTimer || !pendingData) return;
    clearTimeout(saveTimer); saveTimer = null;
    const data = pendingData; pendingData = null;
    return uploadJSON(FILENAME, data).catch(e => logError('flush', e?.message));
}

function armUnloadFlush() {
    if (unloadHandler) return;
    unloadHandler = () => {
        if (!pendingData) return;
        try {
            const json = JSON.stringify(pendingData);
            const bytes = new TextEncoder().encode(json);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const payload = JSON.stringify({ name: FILENAME, data: btoa(binary) });
            if (payload.length < 64000) {
                navigator.sendBeacon('/api/files/upload',
                    new Blob([payload], { type: 'application/json' }));
            }
        } catch (e) { logError('unload flush', e); }
        pendingData = null;
    };
    window.addEventListener('beforeunload', unloadHandler);
}
