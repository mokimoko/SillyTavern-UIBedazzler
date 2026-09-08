// Named custom top-bar icon sets, stored in the shared Bedazzler sidecar.

import { getContext } from '../../../../extensions.js';
import {
    ensureSidecarLoaded,
    getSection,
    onSidecarLoaded,
    scheduleSave,
} from './sidecar.js';
import {
    injectStyleElement,
    normalizeBannerUrl,
    serializeCssUrl,
} from './design/designUtils.js';

export const CUSTOM_TOPBAR_SET_ID = 'custom';

export const CUSTOM_TOPBAR_HOVER_PRESETS = Object.freeze([
    Object.freeze({ id: 'none', label: 'None' }),
    Object.freeze({ id: 'soft-glow', label: 'Soft glow' }),
    Object.freeze({ id: 'gentle-lift', label: 'Gentle lift' }),
    Object.freeze({ id: 'smooth-zoom', label: 'Smooth zoom' }),
    Object.freeze({ id: 'tiny-tilt', label: 'Tiny tilt' }),
]);

export const CUSTOM_TOPBAR_SLOTS = Object.freeze([
    Object.freeze({ id: 'left-settings', group: 'Top bar', label: 'Left settings drawer', selector: '#leftNavDrawerIcon::before' }),
    Object.freeze({ id: 'api', group: 'Top bar', label: 'API connections', selector: '#API-status-top::before' }),
    Object.freeze({ id: 'formatting', group: 'Top bar', label: 'AI response formatting', selector: '.drawer-icon[title="AI Response Formatting"]::before' }),
    Object.freeze({ id: 'world-info', group: 'Top bar', label: 'World Info', selector: '#WIDrawerIcon::before' }),
    Object.freeze({ id: 'user-settings', group: 'Top bar', label: 'User settings', selector: '.drawer-icon[title="User Settings"]::before' }),
    Object.freeze({ id: 'backgrounds', group: 'Top bar', label: 'Backgrounds', selector: '#backgrounds-drawer-toggle .drawer-icon::before' }),
    Object.freeze({ id: 'extensions-drawer', group: 'Top bar', label: 'Extensions drawer', selector: '.drawer-icon[title="Extensions"]::before' }),
    Object.freeze({ id: 'persona-drawer', group: 'Top bar', label: 'Persona management', selector: '.drawer-icon[title="Persona Management"]::before' }),
    Object.freeze({ id: 'characters', group: 'Top bar', label: 'Characters', selector: '#rightNavDrawerIcon::before' }),
    Object.freeze({ id: 'extensions-menu', group: 'Composer & generation', label: 'Extensions menu', selector: '#extensionsMenuButton::before' }),
    Object.freeze({ id: 'impersonate', group: 'Composer & generation', label: 'Impersonate', selector: '#mes_impersonate::before' }),
    Object.freeze({ id: 'options', group: 'Composer & generation', label: 'More options', selector: '#options_button::before' }),
    Object.freeze({ id: 'continue', group: 'Composer & generation', label: 'Continue', selector: '#mes_continue::before' }),
    Object.freeze({ id: 'send', group: 'Composer & generation', label: 'Send', selector: '#send_but::before' }),
    Object.freeze({ id: 'script-play', group: 'Composer & generation', label: 'Script play', selector: '#stscript_continue i::before' }),
    Object.freeze({ id: 'script-pause', group: 'Composer & generation', label: 'Script pause', selector: '#stscript_pause i::before' }),
    Object.freeze({ id: 'script-stop', group: 'Composer & generation', label: 'Script stop', selector: '#stscript_stop i::before' }),
    Object.freeze({ id: 'generation-stop', group: 'Composer & generation', label: 'Generation stop', selector: '#mes_stop i::before' }),
]);

const STYLE_ID = 'bd-custom-topbar-icon-style';
const ICONIFY_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/i;
const HOVER_PRESET_IDS = new Set(CUSTOM_TOPBAR_HOVER_PRESETS.map(preset => preset.id));
const PACK_ICON_PREFIX = '/user/images/icons/';
const PACK_RASTER_FORMATS = new Set(['bmp', 'gif', 'jpeg', 'png', 'webp']);
const MAX_PACK_ICON_BYTES = 8 * 1024 * 1024;
export const MAX_CUSTOM_SVG_LENGTH = 50_000;
let initializationPromise = null;
let activeSetId = '';
const resolvedIconUrlCache = new Map();
const customTopbarCssCache = new Map();

function rawStore() {
    return getSection('customTopbarIcons');
}

function makeSetId() {
    return `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeSet(set, id) {
    const value = set && typeof set === 'object' ? set : {};
    return {
        id,
        name: String(value.name || 'Untitled Set').trim().slice(0, 80) || 'Untitled Set',
        baseSet: String(value.baseSet || 'default'),
        hover: HOVER_PRESET_IDS.has(value.hover) ? value.hover : 'none',
        slots: value.slots && typeof value.slots === 'object' && !Array.isArray(value.slots) ? value.slots : {},
    };
}

function ensureStore({ migrate = false } = {}) {
    const store = rawStore();
    if (!store.sets || typeof store.sets !== 'object' || Array.isArray(store.sets)) store.sets = {};

    // First-build compatibility: the former single global map becomes a named
    // set once the real sidecar has loaded. Nothing the user configured is lost.
    if (migrate && Object.keys(store.sets).length === 0 && store.slots && typeof store.slots === 'object') {
        const id = makeSetId();
        store.sets[id] = normalizeSet({
            name: 'My Custom Set',
            baseSet: store.baseSet || 'default',
            slots: store.slots,
        }, id);
        delete store.baseSet;
        delete store.slots;
        scheduleSave();
    }

    for (const [id, set] of Object.entries(store.sets)) store.sets[id] = normalizeSet(set, id);
    return store;
}

export function getCustomTopbarSets() {
    return Object.values(ensureStore().sets).map(set => ({
        id: set.id,
        name: set.name,
        baseSet: set.baseSet,
        hover: set.hover,
        iconCount: Object.keys(set.slots).filter(id => CUSTOM_TOPBAR_SLOTS.some(slot => slot.id === id)).length,
    }));
}

export function getFirstCustomTopbarSetId() {
    return getCustomTopbarSets()[0]?.id || '';
}

export function isCustomTopbarSetId(setId) {
    return Boolean(setId && ensureStore().sets[setId]);
}

export function getCustomTopbarSet(setId) {
    const set = ensureStore().sets[setId];
    return set ? normalizeSet(set, setId) : null;
}

export function findCustomTopbarSetByName(name) {
    const clean = String(name || '').trim().toLocaleLowerCase();
    if (!clean) return null;
    return Object.values(ensureStore().sets).find(set => set.name.toLocaleLowerCase() === clean) || null;
}

export function createCustomTopbarSet(name, baseSet = 'default') {
    const store = ensureStore();
    const id = makeSetId();
    store.sets[id] = normalizeSet({ name, baseSet, slots: {} }, id);
    scheduleSave();
    emitLibraryChanged();
    return id;
}

export function renameCustomTopbarSet(setId, name) {
    const set = ensureStore().sets[setId];
    const clean = String(name || '').trim().slice(0, 80);
    if (!set || !clean) return false;
    set.name = clean;
    scheduleSave();
    emitLibraryChanged();
    return true;
}

export function deleteCustomTopbarSet(setId) {
    const store = ensureStore();
    if (!store.sets[setId]) return false;
    delete store.sets[setId];
    if (activeSetId === setId) activeSetId = '';
    scheduleSave();
    emitLibraryChanged();
    return true;
}

export function setCustomTopbarBaseSet(setId, baseSet) {
    const set = ensureStore().sets[setId];
    if (!set) return false;
    set.baseSet = String(baseSet || 'default');
    scheduleSave();
    emitLibraryChanged();
    return true;
}

export function setCustomTopbarHover(setId, hover) {
    const set = ensureStore().sets[setId];
    if (!set || !HOVER_PRESET_IDS.has(hover)) return false;
    set.hover = hover;
    scheduleSave();
    emitLibraryChanged();
    return true;
}

export function setCustomTopbarSlot(setId, slotId, entry) {
    const set = ensureStore().sets[setId];
    if (!set || !CUSTOM_TOPBAR_SLOTS.some(slot => slot.id === slotId)) return false;
    if (entry) set.slots[slotId] = entry;
    else delete set.slots[slotId];
    scheduleSave();
    emitLibraryChanged();
    return true;
}

export function clearCustomTopbarSet(setId) {
    const set = ensureStore().sets[setId];
    if (!set) return false;
    set.slots = {};
    scheduleSave();
    emitLibraryChanged();
    return true;
}

function cleanPackRender(value) {
    return value === 'original' ? 'original' : 'tint';
}

function normalizePackIconPath(value) {
    const raw = String(value || '').trim().replace(/\\/g, '/');
    const path = raw.replace(/^\/+/, '');
    if (!path.toLocaleLowerCase().startsWith(PACK_ICON_PREFIX.slice(1))) return '';
    if (path.split('/').some(part => part === '.' || part === '..')) return '';
    return normalizeBannerUrl(`/${path}`);
}

function packRasterFormat(path, contentType = '') {
    const type = String(contentType).split(';')[0].trim().toLowerCase();
    const fromType = {
        'image/bmp': 'bmp',
        'image/gif': 'gif',
        'image/jpeg': 'jpeg',
        'image/png': 'png',
        'image/webp': 'webp',
    }[type];
    if (fromType) return fromType;
    const extension = String(path || '').split(/[?#]/)[0].split('.').pop()?.toLowerCase();
    return extension === 'jpg' || extension === 'jfif' ? 'jpeg' : (PACK_RASTER_FORMATS.has(extension) ? extension : '');
}

function sniffPackRasterFormat(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
        && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'png';
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpeg';
    if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)).match(/^GIF8[79]a$/)) return 'gif';
    if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
        && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4D) return 'bmp';
    return '';
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

async function uploadPackedRaster(bytes, format, slotId) {
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: getContext().getRequestHeaders(),
        body: JSON.stringify({
            image: bytesToBase64(bytes),
            format,
            filename: `uibedazzler_pack_${slotId}_${Date.now()}`,
            ch_name: 'icons',
        }),
    });
    if (!response.ok) throw new Error(`Icon upload failed (${response.status}).`);
    const result = await response.json();
    const path = normalizePackIconPath(result.path);
    if (!path) throw new Error('SillyTavern returned an unexpected icon path.');
    return path;
}

/** Collect one custom set and any same-origin raster files for a Style Pack. */
export async function exportCustomTopbarSetForPack(setId) {
    await ensureSidecarLoaded();
    const set = getCustomTopbarSet(setId);
    if (!set) throw new Error('That custom icon set no longer exists.');

    const resource = {
        schemaVersion: 1,
        name: set.name,
        baseSet: set.baseSet,
        hover: set.hover,
        slots: {},
    };
    const files = [];
    for (const slot of CUSTOM_TOPBAR_SLOTS) {
        const entry = set.slots[slot.id];
        if (!entry) continue;
        const render = cleanPackRender(entry.render);
        if (entry.source === 'iconify') {
            if (!iconifyIconUrl(entry.value)) throw new Error(`Invalid Iconify value in ${slot.label}.`);
            resource.slots[slot.id] = { source: 'iconify', value: String(entry.value).toLowerCase(), render };
            continue;
        }
        if (entry.source === 'svg') {
            const value = sanitizeCustomSvg(entry.value);
            if (!value) throw new Error(`Invalid SVG in ${slot.label}.`);
            resource.slots[slot.id] = { source: 'svg', value, render };
            continue;
        }
        const portableValue = normalizeBannerUrl(entry.value);
        if (/^https?:\/\//i.test(portableValue)) {
            resource.slots[slot.id] = { source: 'url', value: portableValue, render };
            continue;
        }
        const value = normalizePackIconPath(entry.value);
        if (!value) throw new Error(`${slot.label} uses a local path outside user/images/icons.`);
        const response = await fetch(value, { headers: getContext().getRequestHeaders() });
        if (!response.ok) throw new Error(`Could not read the local image for ${slot.label}.`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (!data.length || data.length > MAX_PACK_ICON_BYTES) throw new Error(`${slot.label}'s image is empty or too large.`);
        const format = packRasterFormat(value, response.headers.get('content-type'));
        const detected = sniffPackRasterFormat(data);
        if (!format || detected !== format) throw new Error(`${slot.label}'s image format could not be verified.`);
        const archivePath = `icons/${slot.id}.${format === 'jpeg' ? 'jpg' : format}`;
        resource.slots[slot.id] = { source: 'archive', path: archivePath, format, render };
        files.push({ path: archivePath, data });
    }
    return { resource, files };
}

function validatePackedIconResource(resource, entries) {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) throw new Error('The custom icon resource is invalid.');
    if (resource.schemaVersion !== 1) throw new Error('This custom icon resource version is not supported.');
    const name = String(resource.name || '').trim().slice(0, 80);
    if (!name) throw new Error('The custom icon set needs a name.');
    const baseSet = String(resource.baseSet || 'default').trim().slice(0, 80) || 'default';
    const hover = HOVER_PRESET_IDS.has(resource.hover) ? resource.hover : 'none';
    if (!resource.slots || typeof resource.slots !== 'object' || Array.isArray(resource.slots)) throw new Error('The custom icon slots are invalid.');

    const allowedSlots = new Map(CUSTOM_TOPBAR_SLOTS.map(slot => [slot.id, slot]));
    const slots = {};
    const uploads = [];
    for (const [slotId, rawEntry] of Object.entries(resource.slots)) {
        const slot = allowedSlots.get(slotId);
        if (!slot || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) throw new Error(`Invalid custom icon slot: ${slotId}`);
        const render = cleanPackRender(rawEntry.render);
        if (rawEntry.source === 'iconify') {
            if (!iconifyIconUrl(rawEntry.value)) throw new Error(`Invalid Iconify value in ${slot.label}.`);
            slots[slotId] = { source: 'iconify', value: String(rawEntry.value).toLowerCase(), render };
        } else if (rawEntry.source === 'svg') {
            const value = sanitizeCustomSvg(rawEntry.value);
            if (!value) throw new Error(`Invalid SVG in ${slot.label}.`);
            slots[slotId] = { source: 'svg', value, render };
        } else if (rawEntry.source === 'url') {
            const value = normalizeBannerUrl(rawEntry.value);
            if (!/^https?:\/\//i.test(value)) throw new Error(`${slot.label} must use a portable http(s) URL.`);
            slots[slotId] = { source: 'url', value, render };
        } else if (rawEntry.source === 'archive') {
            const path = String(rawEntry.path || '').replace(/\\/g, '/');
            if (!/^icons\/[a-z0-9][a-z0-9._-]*\.(?:bmp|gif|jpe?g|png|webp)$/i.test(path)) throw new Error(`Unsafe icon resource path in ${slot.label}.`);
            const data = entries.get(path);
            if (!(data instanceof Uint8Array) || !data.length || data.length > MAX_PACK_ICON_BYTES) throw new Error(`Missing or invalid image for ${slot.label}.`);
            const expected = packRasterFormat(path, rawEntry.format ? `image/${rawEntry.format}` : '');
            const detected = sniffPackRasterFormat(data);
            if (!expected || detected !== expected) throw new Error(`Image type mismatch in ${slot.label}.`);
            uploads.push({ slotId, data, format: detected, render });
        } else {
            throw new Error(`Unsupported icon source in ${slot.label}.`);
        }
    }
    return { name, baseSet, hover, slots, uploads };
}

/** Validate all entries first, then upload packed rasters; the sidecar is untouched. */
export async function prepareCustomTopbarSetFromPack(resource, entries) {
    const prepared = validatePackedIconResource(resource, entries);
    for (const upload of prepared.uploads) {
        const value = await uploadPackedRaster(upload.data, upload.format, upload.slotId);
        prepared.slots[upload.slotId] = { source: 'url', value, render: upload.render };
    }
    delete prepared.uploads;
    return prepared;
}

/** Install a prepared set with a fresh ID. No default or character assignment is changed. */
export async function installCustomTopbarSetFromPack(prepared, { name = '', replaceSetId = '' } = {}) {
    await ensureSidecarLoaded();
    const store = ensureStore();
    const cleanName = String(name || prepared?.name || '').trim().slice(0, 80);
    if (!cleanName || !prepared?.slots) throw new Error('The prepared custom icon set is invalid.');
    if (replaceSetId && store.sets[replaceSetId]) delete store.sets[replaceSetId];
    const id = makeSetId();
    store.sets[id] = normalizeSet({
        name: cleanName,
        baseSet: prepared.baseSet,
        hover: prepared.hover,
        slots: prepared.slots,
    }, id);
    scheduleSave();
    emitLibraryChanged();
    return id;
}

export function iconifyIconUrl(value) {
    const match = String(value || '').trim().match(ICONIFY_RE);
    return match ? `https://api.iconify.design/${match[1].toLowerCase()}/${match[2].toLowerCase()}.svg` : '';
}

export function sanitizeCustomSvg(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > MAX_CUSTOM_SVG_LENGTH) return '';
    const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml');
    const root = parsed.documentElement;
    if (!root || root.localName !== 'svg' || parsed.querySelector('parsererror')) return '';

    parsed.querySelectorAll('script, foreignObject, iframe, object, embed, audio, video, style').forEach(node => node.remove());
    parsed.querySelectorAll('*').forEach(node => {
        for (const attr of [...node.attributes]) {
            const name = attr.name.toLowerCase();
            const val = attr.value.trim();
            if (name.startsWith('on')) node.removeAttribute(attr.name);
            if ((name === 'href' || name === 'xlink:href') && val && !val.startsWith('#')) node.removeAttribute(attr.name);
            if (/url\s*\(/i.test(val) && !/^url\(\s*#[^)]+\s*\)$/i.test(val)) node.removeAttribute(attr.name);
        }
    });
    return new XMLSerializer().serializeToString(root);
}

export function resolveCustomIconUrl(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const cacheKey = `${entry.source || ''}\u0000${entry.value || ''}`;
    if (resolvedIconUrlCache.has(cacheKey)) return resolvedIconUrlCache.get(cacheKey);

    let resolved = '';
    if (entry.source === 'iconify') resolved = iconifyIconUrl(entry.value);
    if (entry.source === 'svg') {
        const safe = sanitizeCustomSvg(entry.value);
        resolved = safe ? `data:image/svg+xml,${encodeURIComponent(safe)}` : '';
    }
    if (entry.source === 'url') resolved = normalizeBannerUrl(entry.value);
    resolvedIconUrlCache.set(cacheKey, resolved);
    return resolved;
}

function entryRule(slot, entry) {
    const url = resolveCustomIconUrl(entry);
    if (!url) return '';
    // Double class makes this overlay outrank every shipped topbar set while
    // keeping the selectors limited to the same hand-picked icon slots.
    const selector = `body.bd-topbar-custom.bd-topbar-custom ${slot.selector}`;
    const image = serializeCssUrl(url);
    if (entry.render === 'original') {
        return `${selector} {
    content: "" !important;
    display: inline-block !important;
    width: 1em !important;
    height: 1em !important;
    vertical-align: -0.125em !important;
    background-color: transparent !important;
    background-image: ${image} !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
    background-size: contain !important;
    -webkit-mask: none !important;
    mask: none !important;
}`;
    }
    return `${selector} {
    content: "" !important;
    display: inline-block !important;
    width: 1em !important;
    height: 1em !important;
    vertical-align: -0.125em !important;
    background: currentColor !important;
    -webkit-mask: ${image} no-repeat center / contain !important;
    mask: ${image} no-repeat center / contain !important;
}`;
}

function hoverRules(set) {
    const effects = {
        'soft-glow': 'filter: drop-shadow(0 0 5px currentColor) brightness(1.15); transform: scale(1.06);',
        'gentle-lift': 'filter: brightness(1.12); transform: translateY(-2px);',
        'smooth-zoom': 'filter: brightness(1.08); transform: scale(1.13);',
        'tiny-tilt': 'filter: brightness(1.1); transform: rotate(-8deg) scale(1.06);',
    };
    const effect = effects[set?.hover];
    if (!effect) return '';

    const selectors = CUSTOM_TOPBAR_SLOTS
        .map(slot => `body.bd-topbar-custom.bd-topbar-custom ${slot.selector}`)
        .join(',\n');
    const hoverSelectors = CUSTOM_TOPBAR_SLOTS
        .map(slot => `body.bd-topbar-custom.bd-topbar-custom ${slot.selector.replace('::before', ':hover::before')}`)
        .join(',\n');
    return `${selectors} {
    transition: transform 160ms ease, filter 160ms ease, opacity 160ms ease !important;
    transform-origin: center !important;
}
${hoverSelectors} {
    ${effect}
}
@media (prefers-reduced-motion: reduce) {
    ${selectors} { transition: none !important; }
}`;
}

export function setActiveCustomTopbarSet(setId) {
    activeSetId = isCustomTopbarSetId(setId) ? setId : '';
    refreshCustomTopbarIcons();
}

export function refreshCustomTopbarIcons() {
    const set = getCustomTopbarSet(activeSetId);
    if (!set) {
        injectStyleElement(STYLE_ID, '');
        return;
    }

    let css = customTopbarCssCache.get(set.id);
    if (css === undefined) {
        const rules = CUSTOM_TOPBAR_SLOTS.map(slot => entryRule(slot, set.slots[slot.id])).filter(Boolean);
        rules.push(hoverRules(set));
        css = rules.filter(Boolean).join('\n\n');
        customTopbarCssCache.set(set.id, css);
    }
    injectStyleElement(STYLE_ID, css);
}

function emitLibraryChanged() {
    resolvedIconUrlCache.clear();
    customTopbarCssCache.clear();
    refreshCustomTopbarIcons();
    window.dispatchEvent(new CustomEvent('UIBEDAZZLER_CUSTOM_ICON_LIBRARY_CHANGED'));
    window.dispatchEvent(new CustomEvent('UIBEDAZZLER_ICON_DEFAULTS_CHANGED'));
}

export function initCustomTopbarIcons() {
    if (initializationPromise) return initializationPromise;
    onSidecarLoaded(() => {
        ensureStore({ migrate: true });
        emitLibraryChanged();
    });
    initializationPromise = ensureSidecarLoaded().then(() => {
        ensureStore({ migrate: true });
        refreshCustomTopbarIcons();
    });
    return initializationPromise;
}
