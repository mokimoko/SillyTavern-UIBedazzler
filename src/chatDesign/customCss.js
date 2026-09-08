// Safe, declaration-only CSS escape hatch for scoped Chat Design typography.

const MAX_LENGTH = 4_000;
const MAX_CACHE_ENTRIES = 64;
const cache = new Map();
const BLOCKED_STRUCTURE = /[{}]|(?:^|[;\s])@/i;
const BLOCKED_VALUE = /\b(?:url|image-set|-webkit-image-set|expression)\s*\(/i;
const BLOCKED_PROPERTIES = new Set(['behavior', '-moz-binding']);

function remember(source, result) {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(source, result);
    return result;
}

/** Parse declarations through the browser and make them final scoped overrides. */
export function sanitizeCustomCssDeclarations(value) {
    const source = String(value || '').trim().slice(0, MAX_LENGTH);
    if (!source) return '';
    if (cache.has(source)) return cache.get(source);
    if (BLOCKED_STRUCTURE.test(source) || typeof document === 'undefined') return remember(source, '');

    const parsed = document.createElement('span').style;
    parsed.cssText = source;
    const declarations = [];

    for (let index = 0; index < parsed.length; index++) {
        const property = parsed.item(index);
        const propertyValue = parsed.getPropertyValue(property).trim();
        if (!propertyValue || BLOCKED_PROPERTIES.has(property) || BLOCKED_VALUE.test(propertyValue)) continue;
        declarations.push(`${property}: ${propertyValue} !important`);
    }

    return remember(source, declarations.join(';\n    '));
}
