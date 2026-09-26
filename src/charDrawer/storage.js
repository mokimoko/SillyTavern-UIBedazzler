// src/charDrawer/storage.js
// Read/write character extension data through ST's character JSON field.
//
// Design changes are reflected in the current form and character object
// immediately. Persistence uses a target-bound partial merge: each job captures
// the avatar at edit time, so changing characters during the debounce cannot
// write the previous design into the newly-selected card.

import { getContext } from '../../../../../extensions.js';

const log = () => {};

const SAVE_DEBOUNCE_MS = 2000;
const MAX_RETRY_MS = 30000;
const UNSET_SENTINEL = '__@@UNSET@@__';

/** @type {Map<string, { timer: ReturnType<typeof setTimeout> | null, patch: object, inFlight: boolean, failures: number }>} */
const pendingSaves = new Map();

let cachedRaw = null;
let cachedData = null;

// ============================================================
// JSON Data Read/Write
// ============================================================

/**
 * Parse the current character's json_data. Reuse the parsed object during
 * slider drags instead of reparsing the same hidden value on every input event.
 * @returns {object|null}
 */
function parseJsonData() {
    const context = getContext();
    const selected = context.characters?.[context.characterId];
    const raw = $('#character_json_data').val() || selected?.json_data;
    if (!raw) return null;
    if (raw === cachedRaw && cachedData) return cachedData;

    try {
        cachedRaw = raw;
        cachedData = JSON.parse(raw);
        return cachedData;
    } catch (error) {
        log('Failed to parse json_data:', error);
        cachedRaw = null;
        cachedData = null;
        return null;
    }
}

/** Merge a plain nested update into another plain object. */
function mergePatch(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
                target[key] = {};
            }
            mergePatch(target[key], value);
        } else {
            target[key] = value;
        }
    }
    return target;
}

/**
 * Serialize updated data back to ST's form and in-memory character, then queue
 * a partial server merge for the captured avatar.
 */
function writeJsonData(data, extensionPatch) {
    try {
        const serialized = JSON.stringify(data);
        cachedRaw = serialized;
        cachedData = data;

        $('#character_json_data').val(serialized);

        const context = getContext();
        const chid = context.characterId;
        const character = chid !== undefined && chid !== null ? context.characters?.[chid] : null;
        if (character) character.json_data = serialized;

        const avatar = character?.avatar || String($('#avatar_url_pole').val() || '');
        if (avatar) scheduleSave(avatar, extensionPatch);
    } catch (error) {
        log('Failed to serialize json_data:', error);
    }
}

function scheduleSave(avatar, extensionPatch) {
    let job = pendingSaves.get(avatar);
    if (!job) {
        job = { patch: {}, timer: null, inFlight: false, failures: 0 };
        pendingSaves.set(avatar, job);
    }
    mergePatch(job.patch, extensionPatch);
    if (job.timer !== null) clearTimeout(job.timer);
    job.timer = setTimeout(() => { void flushSave(avatar); }, SAVE_DEBOUNCE_MS);
}

async function flushSave(avatar) {
    const job = pendingSaves.get(avatar);
    if (!job) return;
    job.timer = null;
    if (job.inFlight) return;

    const patch = job.patch;
    job.patch = {};
    job.inFlight = true;
    try {
        await saveCharacterPatch(avatar, patch);
        job.failures = 0;
    } catch (error) {
        // An older failed patch must be replayed before any newer edits. Newer
        // values win when both patches touch the same field.
        job.patch = mergePatch(mergePatch({}, patch), job.patch);
        job.failures++;
        console.warn(`[BD] Could not save design data for ${avatar}; retrying.`, error);
    } finally {
        job.inFlight = false;
        if (Object.keys(job.patch).length === 0) {
            if (job.timer !== null) clearTimeout(job.timer);
            pendingSaves.delete(avatar);
        } else if (job.timer === null) {
            const delay = job.failures
                ? Math.min(MAX_RETRY_MS, SAVE_DEBOUNCE_MS * 2 ** Math.min(job.failures - 1, 4))
                : 0;
            job.timer = setTimeout(() => { void flushSave(avatar); }, delay);
        }
    }
}

/** Save only UIBedazzler-owned extension fields for one captured avatar. */
async function saveCharacterPatch(avatar, extensionPatch) {
    const context = getContext();
    const response = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            avatars: [avatar],
            data: { data: { extensions: extensionPatch } },
        }),
    });

    if (!response.ok) throw new Error(`merge-attributes ${response.status}`);
    const result = await response.json().catch(() => null);
    if (result?.failed?.includes(avatar)) throw new Error('server rejected character merge');
    log('Character design data saved to server');
}

// ============================================================
// Extensions Access
// ============================================================

/**
 * Get the extensions object from the current character's card data.
 * @returns {{ data: object, extensions: object }|null}
 */
export function getCharExtensions() {
    const data = parseJsonData();
    if (!data) return null;
    if (!data.data) data.data = {};
    if (!data.data.extensions) data.data.extensions = {};
    return { data, extensions: data.data.extensions };
}

/**
 * Update fields in data.extensions. Dot notation addresses nested paths;
 * null/undefined removes a key locally and sends ST's merge unset sentinel.
 * @param {object} updates
 * @returns {boolean}
 */
export function updateCharExtensions(updates) {
    const result = getCharExtensions();
    if (!result) return false;

    const { data, extensions } = result;
    const extensionPatch = {};

    for (const [key, value] of Object.entries(updates)) {
        const parts = key.split('.');

        let patchTarget = extensionPatch;
        for (let i = 0; i < parts.length - 1; i++) {
            patchTarget[parts[i]] ||= {};
            patchTarget = patchTarget[parts[i]];
        }
        patchTarget[parts[parts.length - 1]] = value === undefined || value === null
            ? UNSET_SENTINEL
            : value;

        let target = extensions;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!target[parts[i]] || typeof target[parts[i]] !== 'object') {
                target[parts[i]] = {};
            }
            target = target[parts[i]];
        }

        const lastKey = parts[parts.length - 1];
        if (value === undefined || value === null) {
            delete target[lastKey];
        } else {
            target[lastKey] = value;
        }
    }

    writeJsonData(data, extensionPatch);
    return true;
}

/**
 * Get design-specific data from character extensions.
 * @returns {object}
 */
export function getDesignData() {
    const result = getCharExtensions();
    if (!result) {
        return {
            nameColor: null, dialogueColor: null, boxColor: null,
            nameGradient: null, dialogueGradient: null, boxGradient: null,
            nameOutlineColor: null, nameOutlineWidth: null,
            dialogueOutlineColor: null, dialogueOutlineWidth: null,
            bannerMode: null, bannerUrl: null, bannerPosition: null,
        };
    }

    const ext = result.extensions;
    const wld = ext.wl_design || {};

    return {
        nameColor: ext.nameColor || null,
        dialogueColor: ext.dialogueColor || null,
        boxColor: ext.boxColor || null,
        nameGradient: wld.nameGradient || null,
        dialogueGradient: wld.dialogueGradient || null,
        boxGradient: wld.boxGradient || null,
        nameOutlineColor: wld.nameOutlineColor || null,
        nameOutlineWidth: wld.nameOutlineWidth ?? null,
        dialogueOutlineColor: wld.dialogueOutlineColor || null,
        dialogueOutlineWidth: wld.dialogueOutlineWidth ?? null,
        bannerMode: wld.bannerMode || null,
        bannerUrl: wld.bannerUrl || null,
        bannerPosition: wld.bannerPosition ?? null,
    };
}
