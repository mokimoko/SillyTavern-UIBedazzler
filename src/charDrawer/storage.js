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
const UNSET_SENTINEL = '__@@UNSET@@__';

/** @type {Map<string, { timer: ReturnType<typeof setTimeout>, patch: object }>} */
const pendingSaves = new Map();
/** @type {Map<string, Promise<void>>} */
const saveChains = new Map();

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
    const raw = $('#character_json_data').val();
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
    const existing = pendingSaves.get(avatar);
    if (existing) {
        clearTimeout(existing.timer);
        mergePatch(existing.patch, extensionPatch);
        existing.timer = setTimeout(() => enqueueSave(avatar), SAVE_DEBOUNCE_MS);
        return;
    }

    const job = { patch: mergePatch({}, extensionPatch), timer: null };
    job.timer = setTimeout(() => enqueueSave(avatar), SAVE_DEBOUNCE_MS);
    pendingSaves.set(avatar, job);
}

function enqueueSave(avatar) {
    const job = pendingSaves.get(avatar);
    if (!job) return;
    pendingSaves.delete(avatar);

    // Preserve request order for a character if the server is slow while more
    // edits are made. A stale request can never land after its newer successor.
    const previous = saveChains.get(avatar) || Promise.resolve();
    const next = previous
        .catch(() => {})
        .then(() => saveCharacterPatch(avatar, job.patch))
        .finally(() => {
            if (saveChains.get(avatar) === next) saveChains.delete(avatar);
        });
    saveChains.set(avatar, next);
}

/** Save only UIBedazzler-owned extension fields for one captured avatar. */
async function saveCharacterPatch(avatar, extensionPatch) {
    try {
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
    } catch (error) {
        console.warn(`[BD] Could not save design data for ${avatar}.`, error);
    }
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
            nameGradient: null, boxGradient: null,
            nameOutlineColor: null, nameOutlineWidth: null,
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
        boxGradient: wld.boxGradient || null,
        nameOutlineColor: wld.nameOutlineColor || null,
        nameOutlineWidth: wld.nameOutlineWidth ?? null,
        bannerMode: wld.bannerMode || null,
        bannerUrl: wld.bannerUrl || null,
        bannerPosition: wld.bannerPosition ?? null,
    };
}
