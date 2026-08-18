import { chat_metadata, saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../../../extensions.js';

export const VARIABLE_SCOPES = Object.freeze(['local', 'global']);
export const VARIABLE_VALUE_TYPES = Object.freeze(['string', 'number', 'boolean', 'null', 'json']);

function assertScope(scope) {
    if (!VARIABLE_SCOPES.includes(scope)) throw new Error(`Unknown variable scope: ${scope}`);
}

export function getVariableStore(scope) {
    assertScope(scope);
    if (scope === 'local') {
        chat_metadata.variables ??= {};
        return chat_metadata.variables;
    }

    extension_settings.variables ??= {};
    extension_settings.variables.global ??= {};
    return extension_settings.variables.global;
}

function persistScope(scope) {
    if (scope === 'local') saveMetadataDebounced();
    else saveSettingsDebounced();
}

function looksLikeJsonContainer(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

export function decodeStoredValue(rawValue) {
    if (looksLikeJsonContainer(rawValue)) {
        try {
            const parsed = JSON.parse(rawValue);
            if (parsed !== null && typeof parsed === 'object') {
                return { value: parsed, jsonEncoded: true };
            }
        } catch { /* A JSON-looking string is still a valid string. */ }
    }
    return { value: rawValue, jsonEncoded: false };
}

export function getValueKind(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return typeof value;
}

export function getDisplayValueKind(value) {
    const kind = getValueKind(value);
    if (kind !== 'string') return kind;

    const text = value.trim();
    if (/^(true|false)$/i.test(text)) return 'boolean';
    if (/^null$/i.test(text)) return 'null';
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return 'number';
    return 'string';
}

export function isCompositeValue(value) {
    return value !== null && typeof value === 'object';
}

export function getChildEntries(value) {
    if (Array.isArray(value)) return value.map((child, index) => [index, child]);
    if (value !== null && typeof value === 'object') {
        return Object.entries(value).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return [];
}

export function fingerprintValue(value) {
    try {
        const json = JSON.stringify(value);
        return `${typeof value}:${json === undefined ? String(value) : json}`;
    } catch {
        return `${typeof value}:${String(value)}`;
    }
}

export function createScopeSnapshot(scope) {
    const snapshot = new Map();
    for (const [name, value] of Object.entries(getVariableStore(scope))) {
        snapshot.set(name, fingerprintValue(value));
    }
    return snapshot;
}

export function sortedVariableNames(scope) {
    return Object.keys(getVariableStore(scope))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function formatValuePreview(value) {
    const kind = getValueKind(value);
    if (kind === 'array') return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
    if (kind === 'object') {
        const count = Object.keys(value).length;
        return `${count} ${count === 1 ? 'property' : 'properties'}`;
    }
    if (kind === 'string') {
        return value.replace(/\s+/g, ' ').trim();
    }
    return String(value);
}

function includesQuery(value, query, seen) {
    if (!query) return true;
    if (isCompositeValue(value)) {
        if (seen.has(value)) return false;
        seen.add(value);
        for (const [key, child] of getChildEntries(value)) {
            if (String(key).toLowerCase().includes(query) || includesQuery(child, query, seen)) return true;
        }
        return false;
    }
    return formatValuePreview(value).toLowerCase().includes(query);
}

export function variableMatchesQuery(name, value, rawQuery) {
    const query = String(rawQuery ?? '').trim().toLowerCase();
    if (!query || name.toLowerCase().includes(query)) return true;
    return includesQuery(value, query, new WeakSet());
}

export function matchingVariableNames(scope, rawQuery) {
    const store = getVariableStore(scope);
    return sortedVariableNames(scope).filter((name) => (
        variableMatchesQuery(name, decodeStoredValue(store[name]).value, rawQuery)
    ));
}

export function formatVariablePath(path) {
    if (!Array.isArray(path) || path.length === 0) return '';
    const identifier = /^[A-Za-z_$][\w$]*$/;
    let result = identifier.test(String(path[0]))
        ? String(path[0])
        : `[${JSON.stringify(String(path[0]))}]`;

    for (const part of path.slice(1)) {
        if (typeof part === 'number') result += `[${part}]`;
        else if (identifier.test(String(part))) result += `.${part}`;
        else result += `[${JSON.stringify(String(part))}]`;
    }
    return result;
}

function cloneEditableValue(value) {
    if (!isCompositeValue(value)) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function resolvePath(scope, path) {
    if (!Array.isArray(path) || path.length === 0) throw new Error('Variable path is empty.');
    const store = getVariableStore(scope);
    const rootName = String(path[0]);
    if (!Object.hasOwn(store, rootName)) throw new Error(`Variable “${rootName}” no longer exists.`);

    const decoded = decodeStoredValue(store[rootName]);
    let value = decoded.value;
    for (const part of path.slice(1)) {
        if (!isCompositeValue(value) || !Object.hasOwn(value, part)) {
            throw new Error(`Path “${formatVariablePath(path)}” no longer exists.`);
        }
        value = value[part];
    }
    return {
        store,
        rootName,
        rootValue: decoded.value,
        jsonEncoded: decoded.jsonEncoded,
        rootStoredAsString: typeof store[rootName] === 'string',
        value,
    };
}

export function getVariableDescriptor(scope, path) {
    const resolved = resolvePath(scope, path);
    const value = resolved.value;
    const kind = getValueKind(value);
    const displayKind = getDisplayValueKind(value);
    return {
        name: String(path[path.length - 1]),
        kind,
        type: displayKind === 'object' || displayKind === 'array' ? 'json' : displayKind,
        text: kind === 'object' || kind === 'array' ? JSON.stringify(value, null, 2) : (value ?? '').toString(),
        inferredFromString: kind === 'string' && displayKind !== 'string',
        parentKind: path.length > 1
            ? getValueKind(resolvePath(scope, path.slice(0, -1)).value)
            : null,
        renameAllowed: path.length === 1 || typeof path[path.length - 1] !== 'number',
        jsonEncoded: resolved.jsonEncoded,
    };
}

export function getVariableValue(scope, path) {
    return resolvePath(scope, path).value;
}

export function parseTypedValue(type, text) {
    if (!VARIABLE_VALUE_TYPES.includes(type)) throw new Error('Choose a valid value type.');
    const source = String(text ?? '');
    if (type === 'string') return source;
    if (type === 'null') return null;
    if (type === 'number') {
        if (!source.trim()) throw new Error('Enter a number.');
        const value = Number(source);
        if (!Number.isFinite(value)) throw new Error('Enter a valid finite number.');
        return value;
    }
    if (type === 'boolean') {
        const normalized = source.trim().toLowerCase();
        if (normalized !== 'true' && normalized !== 'false') throw new Error('Boolean values must be true or false.');
        return normalized === 'true';
    }

    try {
        return JSON.parse(source);
    } catch (error) {
        throw new Error(`Invalid JSON: ${error.message}`);
    }
}

function persistRoot(scope, rootName, value, jsonEncoded) {
    getVariableStore(scope)[rootName] = jsonEncoded ? JSON.stringify(value) : value;
    persistScope(scope);
}

function assertAvailableName(container, name, oldName = null) {
    const cleanName = String(name ?? '').trim();
    if (!cleanName) throw new Error('Enter a variable name.');
    if (cleanName !== oldName && Object.hasOwn(container, cleanName)) {
        throw new Error(`“${cleanName}” already exists.`);
    }
    return cleanName;
}

export function addVariable(scope, parentPath, draft) {
    const value = parseTypedValue(draft.type, draft.text);
    if (!parentPath) {
        const store = getVariableStore(scope);
        const name = assertAvailableName(store, draft.name);
        store[name] = draft.type === 'json' ? JSON.stringify(value) : value;
        persistScope(scope);
        return [name];
    }

    const resolved = resolvePath(scope, parentPath);
    const root = cloneEditableValue(resolved.rootValue);
    let parent = root;
    for (const part of parentPath.slice(1)) parent = parent[part];
    if (!isCompositeValue(parent)) throw new Error('Children can only be added to objects and arrays.');

    let childKey;
    if (Array.isArray(parent)) {
        childKey = parent.length;
        parent.push(value);
    } else {
        childKey = assertAvailableName(parent, draft.name);
        parent[childKey] = value;
    }
    persistRoot(scope, resolved.rootName, root, resolved.jsonEncoded);
    return [...parentPath, childKey];
}

export function updateVariable(scope, path, draft) {
    const resolved = resolvePath(scope, path);
    const nextValue = draft.preserveString ? String(draft.text ?? '') : parseTypedValue(draft.type, draft.text);

    if (path.length === 1) {
        const nextName = assertAvailableName(resolved.store, draft.name, resolved.rootName);
        if (nextName !== resolved.rootName) delete resolved.store[resolved.rootName];
        resolved.store[nextName] = draft.type === 'json' && resolved.rootStoredAsString
            ? JSON.stringify(nextValue)
            : nextValue;
        persistScope(scope);
        return [nextName];
    }

    const root = cloneEditableValue(resolved.rootValue);
    let parent = root;
    for (const part of path.slice(1, -1)) parent = parent[part];
    const oldKey = path[path.length - 1];

    if (Array.isArray(parent)) {
        parent[oldKey] = nextValue;
    } else {
        const nextName = assertAvailableName(parent, draft.name, String(oldKey));
        if (nextName !== String(oldKey)) delete parent[oldKey];
        parent[nextName] = nextValue;
    }
    persistRoot(scope, resolved.rootName, root, resolved.jsonEncoded);
    return [...path.slice(0, -1), Array.isArray(parent) ? oldKey : String(draft.name).trim()];
}

export function deleteVariable(scope, path) {
    const resolved = resolvePath(scope, path);
    if (path.length === 1) {
        delete resolved.store[resolved.rootName];
        persistScope(scope);
        return;
    }

    const root = cloneEditableValue(resolved.rootValue);
    let parent = root;
    for (const part of path.slice(1, -1)) parent = parent[part];
    const key = path[path.length - 1];
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
    persistRoot(scope, resolved.rootName, root, resolved.jsonEncoded);
}

export function flushVariables(scope, names) {
    const store = getVariableStore(scope);
    let removed = 0;
    for (const name of new Set(names.map(String))) {
        if (!Object.hasOwn(store, name)) continue;
        delete store[name];
        removed += 1;
    }
    if (removed) persistScope(scope);
    return removed;
}

export function importVariables(scope, values) {
    if (!values || Array.isArray(values) || typeof values !== 'object') {
        throw new Error('The import file must contain a JSON object of variable names and values.');
    }
    Object.assign(getVariableStore(scope), values);
    persistScope(scope);
    return Object.keys(values).length;
}

export function collectExpandablePaths(scope, limit = 1500) {
    const paths = [];
    const visit = (value, path) => {
        if (!isCompositeValue(value) || paths.length >= limit) return;
        paths.push(JSON.stringify(path));
        for (const [key, child] of getChildEntries(value)) visit(child, [...path, key]);
    };

    for (const name of sortedVariableNames(scope)) {
        visit(decodeStoredValue(getVariableStore(scope)[name]).value, [name]);
        if (paths.length >= limit) break;
    }
    return { paths, truncated: paths.length >= limit };
}
