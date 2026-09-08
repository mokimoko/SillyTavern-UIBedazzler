// Action-only SillyTavern theme export, validation, collision, and installation helpers.

import { getContext } from '../../../../../extensions.js';

export const STYLE_PACK_THEME_PATH = 'theme/theme.json';

const THEME_SCHEMA_VERSION = 1;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_THEME_NAME_LENGTH = 80;
const MAX_THEME_BYTES = 1024 * 1024;
const MAX_THEME_DEPTH = 8;
const MAX_THEME_NODES = 4096;
const MAX_THEME_KEYS = 1024;
const MAX_THEME_KEY_LENGTH = 160;
const MAX_THEME_STRING_LENGTH = 256 * 1024;
const MAX_THEME_TOTAL_STRING_LENGTH = 768 * 1024;
const MAX_THEME_ARRAY_LENGTH = 512;
const MAX_SAVED_THEMES = 2000;
const THEME_IMPORT_TIMEOUT_MS = 5 * 60 * 1000;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const textEncoder = new TextEncoder();

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cleanThemeName(value, label = 'Theme') {
    if (typeof value !== 'string') throw new Error(`${label} needs a name.`);
    const name = value.trim();
    if (!name || name.length > MAX_THEME_NAME_LENGTH) throw new Error(`${label} needs a name between 1 and ${MAX_THEME_NAME_LENGTH} characters.`);
    if (name !== value) throw new Error(`${label} names cannot start or end with whitespace.`);
    return name;
}

function cloneBoundedJson(value, state, depth = 0) {
    if (depth > MAX_THEME_DEPTH) throw new Error('The theme is nested too deeply.');
    state.nodes += 1;
    if (state.nodes > MAX_THEME_NODES) throw new Error('The theme contains too many values.');

    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('The theme contains an invalid number.');
        return value;
    }
    if (typeof value === 'string') {
        if (value.length > MAX_THEME_STRING_LENGTH) throw new Error('A theme text value is too large.');
        state.stringLength += value.length;
        if (state.stringLength > MAX_THEME_TOTAL_STRING_LENGTH) throw new Error('The theme contains too much text.');
        return value;
    }
    if (Array.isArray(value)) {
        if (value.length > MAX_THEME_ARRAY_LENGTH) throw new Error('A theme list is too large.');
        return value.map(item => cloneBoundedJson(item, state, depth + 1));
    }
    if (!isPlainObject(value)) throw new Error('The theme must contain only plain JSON values.');

    const result = {};
    for (const [key, nested] of Object.entries(value)) {
        state.keys += 1;
        if (state.keys > MAX_THEME_KEYS) throw new Error('The theme contains too many properties.');
        if (!key || key.length > MAX_THEME_KEY_LENGTH) throw new Error('The theme contains an invalid property name.');
        if (FORBIDDEN_KEYS.has(key)) throw new Error('The theme contains an unsafe property name.');
        result[key] = cloneBoundedJson(nested, state, depth + 1);
    }
    return result;
}

export function validateStylePackTheme(value) {
    if (!isPlainObject(value)) throw new Error('theme/theme.json must contain a plain JSON object.');
    const theme = cloneBoundedJson(value, { nodes: 0, keys: 0, stringLength: 0 });
    theme.name = cleanThemeName(theme.name);
    const encoded = textEncoder.encode(JSON.stringify(theme));
    if (encoded.length > MAX_THEME_BYTES) throw new Error('The theme is too large.');
    return theme;
}

export function validateThemeResourceMetadata(value) {
    if (!isPlainObject(value)) throw new Error('The Style Pack theme resource is invalid.');
    for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) throw new Error('The Style Pack theme resource contains an unsafe property name.');
        if (!['schemaVersion', 'name', 'path'].includes(key)) throw new Error(`Unsupported theme resource property: ${key}`);
    }
    if (value.schemaVersion !== THEME_SCHEMA_VERSION) throw new Error('This Style Pack theme resource version is not supported.');
    const name = cleanThemeName(value.name, 'Theme resource');
    if (value.path !== STYLE_PACK_THEME_PATH) throw new Error(`The theme resource path must be ${STYLE_PACK_THEME_PATH}.`);
    return { schemaVersion: THEME_SCHEMA_VERSION, name, path: STYLE_PACK_THEME_PATH };
}

export function prepareStylePackTheme(resource, entries) {
    const metadata = validateThemeResourceMetadata(resource);
    const bytes = entries?.get?.(STYLE_PACK_THEME_PATH);
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_THEME_BYTES) {
        throw new Error(`The archive is missing a valid ${STYLE_PACK_THEME_PATH} entry.`);
    }

    let parsed;
    try {
        parsed = JSON.parse(textDecoder.decode(bytes));
    } catch {
        throw new Error(`${STYLE_PACK_THEME_PATH} is not valid UTF-8 JSON.`);
    }
    const theme = validateStylePackTheme(parsed);
    if (theme.name !== metadata.name) throw new Error('The theme name does not match its Style Pack resource metadata.');
    return theme;
}

async function readSavedThemes() {
    const response = await fetch('/api/settings/get', {
        method: 'POST',
        headers: getContext().getRequestHeaders(),
        body: JSON.stringify({}),
        cache: 'no-cache',
    });
    if (!response.ok) throw new Error(`Saved themes could not be read (${response.status}).`);
    const payload = await response.json();
    if (!isPlainObject(payload) || !Array.isArray(payload.themes) || payload.themes.length > MAX_SAVED_THEMES) {
        throw new Error('SillyTavern returned an invalid saved theme list.');
    }
    return payload.themes;
}

function themeFilenameKey(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    let filename = `${value.trim()}.json`
        .replace(/[/?<>\\:*|"]/g, '')
        .replace(/[\u0000-\u001F\u0080-\u009F]/g, '')
        .replace(/[. ]+$/g, '');
    if (/^\.+$/.test(filename) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i.test(filename)) filename = '';
    return filename.normalize('NFKC').toLocaleLowerCase();
}

function getLoadedThemeCollision(name) {
    const key = themeFilenameKey(name);
    const select = document.querySelector('#themes');
    if (!key || !(select instanceof HTMLSelectElement)) return null;
    const option = [...select.options].find(item => themeFilenameKey(item.value) === key);
    return option ? { name: option.value, source: 'loaded' } : null;
}

/** List saved theme names for an explicit Export Pack screen. */
export async function listSavedThemeNamesForExport() {
    const themes = await readSavedThemes();
    const names = themes.flatMap(theme => {
        try {
            return isPlainObject(theme) ? [cleanThemeName(theme.name)] : [];
        } catch {
            return [];
        }
    });
    return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

/** Find a loaded theme occupying the same Windows filename namespace without rescanning settings. */
export async function findThemeCollisionByName(name) {
    const cleanName = cleanThemeName(name);
    const key = themeFilenameKey(cleanName);
    if (!key) throw new Error('That theme name cannot be saved safely.');
    return getLoadedThemeCollision(cleanName);
}

/** Read and validate one exact-name saved theme for archive export. */
export async function exportThemeForStylePack(name) {
    const exactName = cleanThemeName(name);
    const themes = await readSavedThemes();
    const matches = themes.filter(theme => isPlainObject(theme) && theme.name === exactName);
    if (matches.length !== 1) throw new Error(`No unambiguous exact-name saved theme exists for “${exactName}”.`);
    const theme = validateStylePackTheme(matches[0]);
    return {
        resource: { schemaVersion: THEME_SCHEMA_VERSION, name: exactName, path: STYLE_PACK_THEME_PATH },
        file: { path: STYLE_PACK_THEME_PATH, data: `${JSON.stringify(theme, null, 2)}\n` },
    };
}

function waitForNativeThemeImport(input, select, importedName) {
    return new Promise((resolve, reject) => {
        let clearedChecks = 0;
        let settled = false;
        const finish = (error = null) => {
            if (settled) return;
            settled = true;
            clearInterval(intervalId);
            clearTimeout(timeoutId);
            observer.disconnect();
            error ? reject(error) : resolve();
        };
        const check = () => {
            if ([...select.options].some(option => option.value === importedName)) return finish();
            if (!input.files?.length) {
                clearedChecks += 1;
                if (clearedChecks >= 2) finish(new Error('SillyTavern did not complete the theme import. It may have been cancelled or rejected.'));
            } else {
                clearedChecks = 0;
            }
        };
        const observer = new MutationObserver(check);
        observer.observe(select, { childList: true });
        const intervalId = setInterval(check, 50);
        const timeoutId = setTimeout(() => finish(new Error('Timed out waiting for SillyTavern to finish importing the theme.')), THEME_IMPORT_TIMEOUT_MS);
        check();
    });
}

async function confirmReplacementImportWarning(theme) {
    if (typeof theme.custom_css !== 'string' || !theme.custom_css.includes('@import')) return;
    const context = getContext();
    const message = 'This theme contains @import lines in the Custom CSS. Replace the saved theme anyway?';
    let accepted;
    if (context.Popup?.show?.confirm) {
        accepted = await context.Popup.show.confirm('Theme import warning', message);
    } else if (typeof context.callGenericPopup === 'function' && context.POPUP_TYPE?.CONFIRM != null) {
        accepted = await context.callGenericPopup(message, context.POPUP_TYPE.CONFIRM);
    } else {
        accepted = globalThis.confirm(message);
    }
    if (!accepted) throw new Error('Theme replacement was cancelled because its Custom CSS contains @import lines.');
}

async function importNewTheme(theme) {
    const input = document.querySelector('#ui_preset_import_file');
    const select = document.querySelector('#themes');
    if (!(input instanceof HTMLInputElement) || !(select instanceof HTMLSelectElement)) {
        throw new Error('SillyTavern theme import controls are not available.');
    }
    const previousThemeName = select.value;
    if (!previousThemeName || ![...select.options].some(option => option.value === previousThemeName)) {
        throw new Error('The active SillyTavern theme could not be preserved.');
    }

    const file = new File([`${JSON.stringify(theme, null, 2)}\n`], `${theme.name}.json`, { type: 'application/json' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    const completion = waitForNativeThemeImport(input, select, theme.name);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await completion;

    select.value = previousThemeName;
    if (select.value !== previousThemeName) throw new Error('The theme was imported, but the prior active theme could not be restored.');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
}

async function replaceSavedTheme(theme) {
    await confirmReplacementImportWarning(theme);
    const response = await fetch('/api/themes/save', {
        method: 'POST',
        headers: getContext().getRequestHeaders(),
        body: JSON.stringify(theme),
    });
    if (!response.ok) throw new Error(`The replacement theme could not be saved (${response.status}).`);
}

/** Install a renamed prepared theme without assigning or activating it. */
export async function installPreparedStylePackTheme(prepared, { name = prepared?.name || '', replace = false } = {}) {
    const themeName = cleanThemeName(name);
    const theme = validateStylePackTheme({ ...prepared, name: themeName });
    if (replace) {
        await replaceSavedTheme(theme);
        return { themeName, themeRefreshRequired: true };
    }
    await importNewTheme(theme);
    return { themeName, themeRefreshRequired: false };
}
