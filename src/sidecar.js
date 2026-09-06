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
//     charBrowser:{ tagMeta: { "<tagId>": {...} }, pageSize: <n> }, // char browser
//     customTopbarIcons:{ sets: { [id]: { name, baseSet, slots } } } // named custom icon sets
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
const MAX_RETRY_MS = 30000;
const SCHEMA_VERSION = 2;

// ============================================================
// Module state (singletons)
// ============================================================

let doc = null;        // in-memory cache of the whole document, null until loaded
let loadPromise = null; // the in-flight (or settled) load, so callers can await once
let loaded = false;

let saveTimer = null;
let pendingData = null;
let saveInFlight = null;
let retryDelayMs = DEBOUNCE_MS;
let unloadHandler = null;
const preloadReplacedSections = new Set();

// Subscribers notified when the async load resolves (so a feature that read an
// empty cache synchronously can repaint once the real data arrives).
const listeners = new Set();

export function onSidecarLoaded(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emitLoaded() { for (const cb of listeners) { try { cb(); } catch (e) { logError('listener', e); } } }

// ============================================================
// Document shape
// ============================================================

function emptyDoc() {
    return {
        version: SCHEMA_VERSION,
        lastModified: new Date().toISOString(),
        subjects: {},
        noteTypes: {},
        charBrowser: {},
        charTitles: {},
        customTopbarIcons: {},
    };
}

/** Normalize an arbitrary parsed object into a well-formed document, tolerating
 *  the old v1 WI shape ({ version:1, subjects }) which simply lacks charBrowser. */
function normalizeDoc(raw) {
    const d = (raw && typeof raw === 'object') ? raw : {};
    return {
        ...d,
        version: SCHEMA_VERSION,
        lastModified: d.lastModified || new Date().toISOString(),
        subjects: (d.subjects && typeof d.subjects === 'object') ? d.subjects : {},
        // WI v2 note "type" (the template chip), keyed book → uid, alongside
        // subjects. Kept a distinct section (not merged into subjects) so the
        // existing subjects data on users' disks needs no migration.
        noteTypes: (d.noteTypes && typeof d.noteTypes === 'object') ? d.noteTypes : {},
        charBrowser: (d.charBrowser && typeof d.charBrowser === 'object') ? d.charBrowser : {},
        charTitles: (d.charTitles && typeof d.charTitles === 'object') ? d.charTitles : {},
        customTopbarIcons: (d.customTopbarIcons && typeof d.customTopbarIcons === 'object') ? d.customTopbarIcons : {},
    };
}

function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
    }
    return value;
}

function mergeMissingValues(live, loadedValue) {
    for (const [key, value] of Object.entries(loadedValue || {})) {
        if (!(key in live)) {
            live[key] = cloneValue(value);
        } else if (
            live[key] && typeof live[key] === 'object' && !Array.isArray(live[key])
            && value && typeof value === 'object' && !Array.isArray(value)
        ) {
            mergeMissingValues(live[key], value);
        }
    }
}

/** Hydrate a cache that may already have live section handles. Local values win;
 * downloaded values fill only missing keys, so an early edit cannot erase disk
 * data and callers do not lose the object references returned by getSection(). */
function mergeLoadedDocument(raw) {
    const loadedDoc = normalizeDoc(raw);
    if (!doc) {
        doc = loadedDoc;
        return;
    }

    const hadPendingWrite = Boolean(pendingData);
    for (const [key, value] of Object.entries(loadedDoc)) {
        if (key === 'version' || key === 'lastModified') continue;
        if (preloadReplacedSections.has(key)) continue;
        if (!doc[key] || typeof doc[key] !== 'object' || Array.isArray(doc[key])) {
            doc[key] = cloneValue(value);
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            mergeMissingValues(doc[key], value);
        }
    }
    doc.version = SCHEMA_VERSION;
    if (!hadPendingWrite) doc.lastModified = loadedDoc.lastModified;
    if (pendingData) pendingData = doc;
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
                mergeLoadedDocument(fresh);
            } else {
                // New file absent — try migrating the old WI sidecar.
                const old = await downloadJSON(OLD_WI_URL).catch(() => null);
                if (old && old.subjects && typeof old.subjects === 'object') {
                    mergeLoadedDocument({ subjects: old.subjects });
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
                    mergeLoadedDocument(emptyDoc());
                }
            }
        } catch (e) {
            logError('load', e?.message);
            mergeLoadedDocument(emptyDoc());
        } finally {
            loaded = true;
            preloadReplacedSections.clear();
            armUnloadFlush();
            if (pendingData) {
                pendingData = doc;
                queueSave();
            }
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
    if (!loaded) preloadReplacedSections.add(key);
    scheduleSave();
}

// ============================================================
// Debounced persistence
// ============================================================

function queueSave(delay = DEBOUNCE_MS) {
    if (!loaded || !pendingData) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void persistPending();
    }, delay);
}

async function persistPending() {
    if (!loaded || !pendingData) return saveInFlight || undefined;
    if (saveInFlight) {
        try { await saveInFlight; } catch { /* the owning save path schedules retry */ }
        return pendingData ? persistPending() : undefined;
    }

    const data = pendingData;
    pendingData = null;
    let failed = false;
    saveInFlight = uploadJSON(FILENAME, data);
    try {
        await saveInFlight;
        retryDelayMs = DEBOUNCE_MS;
    } catch (e) {
        failed = true;
        logError('save', e?.message);
        if (!pendingData) pendingData = data;
    } finally {
        saveInFlight = null;
    }

    if (pendingData) {
        const delay = failed ? retryDelayMs : DEBOUNCE_MS;
        if (failed) retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_MS);
        queueSave(delay);
    }
}

/** Schedule a debounced write of the whole document. Calls made during startup
 * remain pending until the initial load has merged in all existing sections. */
export function scheduleSave() {
    if (!doc) return;
    doc.lastModified = new Date().toISOString();
    pendingData = doc;
    if (!loaded) {
        void ensureSidecarLoaded();
        return;
    }
    queueSave();
}

/** Flush a pending save immediately (best-effort, async). Used by feature
 *  teardowns that want their write on disk without waiting out the debounce. */
export function flushSidecar() {
    if (!pendingData) return saveInFlight?.catch(() => undefined);
    if (!loaded) return ensureSidecarLoaded().then(() => flushSidecar());
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    return persistPending();
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
