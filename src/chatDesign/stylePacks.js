// Style Pack schema, validation, and transactional style installation.

import {
    ELEMENT_DEFAULTS,
    ELEMENT_LABELS,
    commitStyleBatch,
    getAllStyles,
} from './storage.js';
import {
    exportCustomTopbarSetForPack,
    findCustomTopbarSetByName,
    installCustomTopbarSetFromPack,
    prepareCustomTopbarSetFromPack,
} from '../customTopbarIcons.js';
import {
    exportThemeForStylePack,
    findThemeCollisionByName as findThemeCollision,
    installPreparedStylePackTheme,
    listSavedThemeNamesForExport as listSavedThemeNames,
    prepareStylePackTheme,
    validateThemeResourceMetadata,
} from './stylePackTheme.js';

export const STYLE_PACK_FORMAT = 'uibedazzler-style-pack';
export const STYLE_PACK_SCHEMA_VERSION = 2;
export const STYLE_PACK_ELEMENTS = Object.freeze(['dialogue', 'banner', 'container', 'avatar', 'generalUi', 'background']);

const STYLE_PACK_ELEMENT_SET = new Set(STYLE_PACK_ELEMENTS);
const STYLE_PACK_CATEGORIES = Object.freeze([
    Object.freeze({ element: 'dialogue' }),
    Object.freeze({ element: 'banner' }),
    Object.freeze({ element: 'container' }),
    Object.freeze({ element: 'avatar' }),
    Object.freeze({ element: 'generalUi', uiSection: 'native' }),
    Object.freeze({ element: 'generalUi', uiSection: 'integrations' }),
    Object.freeze({ element: 'background' }),
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_NAME_LENGTH = 80;
const MAX_NOTES_LENGTH = 2_000;
const MAX_CUSTOM_CSS_LENGTH = 100_000;

function normalizeName(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function cleanName(value, label = 'Style Pack') {
    const name = String(value || '').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) throw new Error(`${label} needs a name.`);
    return name;
}

function cleanNotes(value) {
    if (value == null) return '';
    if (typeof value !== 'string') throw new Error('Style Pack notes must be text.');
    const notes = value.trim();
    if (notes.length > MAX_NOTES_LENGTH) throw new Error(`Style Pack notes may be at most ${MAX_NOTES_LENGTH} characters.`);
    return notes;
}

function styleCategoryKey(style) {
    if (style.element !== 'generalUi') return style.element;
    return `generalUi:${style.uiSection === 'integrations' ? 'integrations' : 'native'}`;
}

function styleCategoryLabel(style) {
    if (style.element !== 'generalUi') return ELEMENT_LABELS[style.element] || style.element;
    return style.uiSection === 'integrations' ? 'Integrations General UI' : 'Native General UI';
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneSafeValue(value, depth = 0) {
    if (depth > 6) throw new Error('A Style Pack property is nested too deeply.');
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        if (typeof value === 'string' && value.length > MAX_CUSTOM_CSS_LENGTH) throw new Error('A Style Pack text property is too large.');
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('A Style Pack contains an invalid number.');
        return value;
    }
    if (Array.isArray(value)) {
        if (value.length > 100) throw new Error('A Style Pack property list is too large.');
        return value.map(item => cloneSafeValue(item, depth + 1));
    }
    if (!isPlainObject(value)) throw new Error('A Style Pack contains an invalid property value.');
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) throw new Error('A Style Pack contains an unsafe property name.');
        result[key] = cloneSafeValue(nested, depth + 1);
    }
    return result;
}

function cleanStyleBlock(block) {
    if (!isPlainObject(block) || !STYLE_PACK_ELEMENT_SET.has(block.element)) throw new Error('The Style Pack contains an unsupported style category.');
    if (!isPlainObject(block.properties)) throw new Error(`${ELEMENT_LABELS[block.element]} has invalid properties.`);
    const properties = {};
    for (const key of Object.keys(ELEMENT_DEFAULTS[block.element])) {
        if (Object.hasOwn(block.properties, key)) properties[key] = cloneSafeValue(block.properties[key]);
    }
    const style = {
        element: block.element,
        properties: {
            ...JSON.parse(JSON.stringify(ELEMENT_DEFAULTS[block.element])),
            ...properties,
        },
    };
    if (block.element === 'generalUi') {
        if (block.uiSection != null && !['native', 'integrations'].includes(block.uiSection)) {
            throw new Error('General UI has an invalid section.');
        }
        style.uiSection = block.uiSection === 'integrations' ? 'integrations' : 'native';
    }
    return style;
}

export function validateStylePackManifest(value) {
    if (!isPlainObject(value)) throw new Error('pack.json must contain an object.');
    if (value.format !== STYLE_PACK_FORMAT) throw new Error('This file is not a UI Bedazzler Style Pack.');
    if (![1, STYLE_PACK_SCHEMA_VERSION].includes(value.schemaVersion)) throw new Error(`Style Pack schema ${value.schemaVersion ?? '(missing)'} is not supported.`);
    const name = cleanName(value.name);
    const notes = cleanNotes(value.notes);
    const maxStyleCount = value.schemaVersion === 1 ? STYLE_PACK_ELEMENTS.length : STYLE_PACK_CATEGORIES.length;
    if (!Array.isArray(value.styles) || value.styles.length > maxStyleCount) throw new Error('The Style Pack style list is invalid.');
    const styles = value.styles.flatMap(block => {
        const style = cleanStyleBlock(block);
        if (value.schemaVersion !== 1 || block.element !== 'generalUi' || block.uiSection != null) return [style];
        return [
            style,
            {
                ...style,
                uiSection: 'integrations',
                properties: JSON.parse(JSON.stringify(style.properties)),
            },
        ];
    });
    const seen = new Set();
    for (const style of styles) {
        const category = styleCategoryKey(style);
        if (seen.has(category)) throw new Error(`The Style Pack contains more than one ${styleCategoryLabel(style)} block.`);
        seen.add(category);
    }
    const rawResources = value.resources == null ? {} : value.resources;
    if (!isPlainObject(rawResources)) throw new Error('The Style Pack resources are invalid.');
    for (const key of Object.keys(rawResources)) {
        if (FORBIDDEN_KEYS.has(key)) throw new Error('The Style Pack resources contain an unsafe property name.');
        if (!['customTopbarIcons', 'theme'].includes(key)) throw new Error(`Unsupported Style Pack resource: ${key}`);
    }
    const resources = cloneSafeValue(rawResources);
    if (resources.theme) resources.theme = validateThemeResourceMetadata(resources.theme);
    return {
        format: STYLE_PACK_FORMAT,
        schemaVersion: STYLE_PACK_SCHEMA_VERSION,
        name,
        notes,
        styles,
        resources,
    };
}

export function getStylePackExportCandidates() {
    const groups = new Map();
    for (const style of getAllStyles()) {
        if (!STYLE_PACK_ELEMENT_SET.has(style.element) || !String(style.name || '').trim()) continue;
        const key = style.name.trim();
        const group = groups.get(key) || [];
        group.push(style);
        groups.set(key, group);
    }
    return [...groups.entries()].flatMap(([name, styles]) => {
        const counts = new Map();
        for (const style of styles) {
            const category = styleCategoryKey(style);
            counts.set(category, (counts.get(category) || 0) + 1);
        }
        const categories = STYLE_PACK_CATEGORIES.filter(category => counts.get(styleCategoryKey(category)) === 1);
        const ambiguous = [...counts.values()].some(count => count > 1);
        return categories.length >= 2 && !ambiguous ? [{
            name,
            labels: categories.map(styleCategoryLabel),
        }] : [];
    }).sort((left, right) => left.name.localeCompare(right.name));
}

export async function listSavedThemeNamesForExport() {
    return listSavedThemeNames();
}

export async function findThemeCollisionByName(name) {
    return findThemeCollision(name);
}

export async function buildStylePackArchive(packName, {
    customTopbarSetId = '',
    includeMatchingTheme = false,
    themeName = '',
    notes = '',
} = {}) {
    const name = cleanName(packName);
    const cleanPackNotes = cleanNotes(notes);
    const matching = getAllStyles().filter(style => STYLE_PACK_ELEMENT_SET.has(style.element) && style.name === name);
    const counts = new Map();
    for (const style of matching) {
        const category = styleCategoryKey(style);
        counts.set(category, (counts.get(category) || 0) + 1);
    }
    if (matching.length < 2 || [...counts.values()].some(count => count !== 1)) throw new Error('Choose a name shared by at least two unambiguous style categories.');

    const manifest = {
        format: STYLE_PACK_FORMAT,
        schemaVersion: STYLE_PACK_SCHEMA_VERSION,
        name,
        styles: STYLE_PACK_CATEGORIES.flatMap(category => {
            const style = matching.find(candidate => styleCategoryKey(candidate) === styleCategoryKey(category));
            if (!style) return [];
            const block = { element: style.element, properties: cloneSafeValue(style.properties || {}) };
            if (style.element === 'generalUi') block.uiSection = style.uiSection === 'integrations' ? 'integrations' : 'native';
            return [block];
        }),
    };
    if (cleanPackNotes) manifest.notes = cleanPackNotes;
    const files = [];
    if (customTopbarSetId) {
        const iconExport = await exportCustomTopbarSetForPack(customTopbarSetId);
        manifest.resources = { customTopbarIcons: iconExport.resource };
        files.push(...iconExport.files);
    }
    const selectedThemeName = String(themeName || '').trim() || (includeMatchingTheme ? name : '');
    if (selectedThemeName) {
        const themeExport = await exportThemeForStylePack(selectedThemeName);
        manifest.resources = { ...(manifest.resources || {}), theme: themeExport.resource };
        files.push(themeExport.file);
    }
    validateStylePackManifest(manifest);
    const { createStylePackArchive } = await import('./stylePackArchive.js');
    return createStylePackArchive(manifest, files);
}

export async function readStylePackFile(file) {
    const filename = String(file?.name || '');
    if (!filename.toLowerCase().endsWith('.uibedazzler-pack')) throw new Error('Choose a .uibedazzler-pack file.');
    const { readStylePackArchive } = await import('./stylePackArchive.js');
    const archive = await readStylePackArchive(file);
    return {
        pack: validateStylePackManifest(archive.manifest),
        entries: archive.entries,
    };
}

export function getStylePackCollisions(pack, destinationName = pack.name) {
    const name = normalizeName(destinationName);
    const categorySet = new Set(pack.styles.map(styleCategoryKey));
    const styles = getAllStyles().filter(style => normalizeName(style.name) === name && STYLE_PACK_ELEMENT_SET.has(style.element));
    return {
        styleIds: styles.filter(style => categorySet.has(styleCategoryKey(style))).map(style => style.id),
        packStyleIds: styles.map(style => style.id),
        iconSet: pack.resources.customTopbarIcons
            ? findCustomTopbarSetByName(pack.resources.customTopbarIcons.name)
            : null,
    };
}

/** Prepare external resources before changing either settings store. */
export async function prepareStylePackApplication(parsed) {
    const pack = validateStylePackManifest(parsed.pack);
    const entries = parsed.entries || new Map();
    const theme = pack.resources.theme
        ? prepareStylePackTheme(pack.resources.theme, entries)
        : null;
    let customTopbarIcons = null;
    if (pack.resources.customTopbarIcons) {
        customTopbarIcons = await prepareCustomTopbarSetFromPack(pack.resources.customTopbarIcons, entries);
    }
    return { pack, customTopbarIcons, theme };
}

/** Apply a fully prepared pack. Imported styles and icon sets always get fresh IDs. */
export async function applyPreparedStylePack(prepared, {
    destinationName = prepared.pack.name,
    assignedCharacters = [],
    assignedPersonas = [],
    replaceStyles = false,
    iconSetName = prepared.customTopbarIcons?.name || '',
    replaceIconSetId = '',
    themeName = prepared.theme?.name || '',
    replaceTheme = false,
} = {}) {
    const name = cleanName(destinationName);
    const requestedThemeName = prepared.theme ? String(themeName ?? '') : '';
    const themeCollision = prepared.theme ? await findThemeCollision(requestedThemeName) : null;
    const collisions = getStylePackCollisions(prepared.pack, name);
    if (!replaceStyles && collisions.styleIds.length) throw new Error('Matching style categories already use that name. Choose Rename or Replace.');

    const iconCollision = prepared.customTopbarIcons ? findCustomTopbarSetByName(iconSetName) : null;
    if (prepared.customTopbarIcons) {
        cleanName(iconSetName, 'Custom icon set');
        if (iconCollision && iconCollision.id !== replaceIconSetId) throw new Error('A custom icon set already uses that name. Choose Rename or Replace.');
        if (!iconCollision && replaceIconSetId) throw new Error('The custom icon set changed after review. Review its collision again.');
    }
    if (themeCollision && !replaceTheme) throw new Error('A saved theme already occupies that theme name. Choose Rename or Replace.');
    if (!themeCollision && replaceTheme) throw new Error('The saved theme changed after review. Review its collision again.');

    let installedTheme = { themeName: '', themeRefreshRequired: false };
    let customTopbarSetId = '';
    if (prepared.theme) {
        installedTheme = await installPreparedStylePackTheme(prepared.theme, {
            name: requestedThemeName,
            replace: replaceTheme,
        });
    }
    try {
        if (prepared.customTopbarIcons) {
            customTopbarSetId = await installCustomTopbarSetFromPack(prepared.customTopbarIcons, {
                name: cleanName(iconSetName, 'Custom icon set'),
                replaceSetId: replaceIconSetId,
            });
        }
    } catch (error) {
        if (installedTheme.themeName) {
            throw new Error(`Theme “${installedTheme.themeName}” was installed, but the custom icon set failed. No styles were changed. ${error.message || error}`);
        }
        throw error;
    }

    let styles;
    try {
        styles = commitStyleBatch(prepared.pack.styles.map(style => ({
            name,
            element: style.element,
            uiSection: style.uiSection,
            properties: style.properties,
            assignedCharacters,
            assignedPersonas,
        })), {
            replaceStyleIds: replaceStyles ? collisions.packStyleIds : [],
        });
    } catch (error) {
        const installed = [
            installedTheme.themeName && `theme “${installedTheme.themeName}”`,
            customTopbarSetId && 'the custom icon set',
        ].filter(Boolean).join(' and ');
        if (installed) throw new Error(`${installed} was installed, but the style batch failed and may need review. ${error.message || error}`);
        throw error;
    }
    return {
        styles,
        customTopbarSetId,
        themeName: installedTheme.themeName,
        themeRefreshRequired: installedTheme.themeRefreshRequired,
    };
}
