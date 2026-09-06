// Named custom top-bar icon sets, stored in the shared Bedazzler sidecar.

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
export const MAX_CUSTOM_SVG_LENGTH = 50_000;
let initializationPromise = null;
let activeSetId = '';

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
    if (entry.source === 'iconify') return iconifyIconUrl(entry.value);
    if (entry.source === 'svg') {
        const safe = sanitizeCustomSvg(entry.value);
        return safe ? `data:image/svg+xml,${encodeURIComponent(safe)}` : '';
    }
    if (entry.source === 'url') return normalizeBannerUrl(entry.value);
    return '';
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
    const rules = set
        ? CUSTOM_TOPBAR_SLOTS.map(slot => entryRule(slot, set.slots[slot.id])).filter(Boolean)
        : [];
    if (set) rules.push(hoverRules(set));
    injectStyleElement(STYLE_ID, rules.join('\n\n'));
}

function emitLibraryChanged() {
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
