// Preserve which Prompt Manager block produced each compiled message.
// SillyTavern drops these identifiers when it flattens MessageCollections into
// the request array, so capture them immediately after prompt compilation.

function childrenOf(node) {
    if (typeof node?.getCollection === 'function') return node.getCollection();
    return Array.isArray(node?.collection) ? node.collection : null;
}

function comparableContent(content) {
    if (typeof content === 'string') return content.replace(/\r\n?/g, '\n');
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (typeof part === 'string') return part;
            if (typeof part?.text === 'string') return part.text;
            try { return JSON.stringify(part); } catch { return String(part ?? ''); }
        }).join('');
    }
    return String(content ?? '');
}

function fingerprint(message) {
    return `${String(message?.role || '')}\u0000${comparableContent(message?.content)}`;
}

function flattenNode(node, ancestors, output) {
    if (!node) return;
    const id = String(node.identifier || '').trim();
    const ids = id && !ancestors.includes(id) ? [id, ...ancestors] : ancestors;
    const children = childrenOf(node);
    if (children) {
        for (const child of children) flattenNode(child, ids, output);
        return;
    }
    if (!node.content && !node.tool_calls) return;
    output.push({ ids, fingerprint: fingerprint(node) });
}

/**
 * Return one provenance record per compiled message: `{ ids: [...] }`.
 * IDs run from the leaf message outward through its containing collections.
 */
export function capturePromptProvenance(promptManager, compiledChat) {
    const messages = Array.isArray(compiledChat) ? compiledChat : [];
    const leaves = [];
    const roots = childrenOf(promptManager?.messages) || [];
    for (const node of roots) flattenNode(node, [], leaves);

    if (leaves.length === messages.length
        && leaves.every((leaf, index) => leaf.fingerprint === fingerprint(messages[index]))) {
        return leaves.map(({ ids }) => ({ ids: [...ids] }));
    }

    // A dry-run event listener may alter the flattened output. Align only exact
    // role/content matches; an unknown message stays uncolored instead of being
    // assigned to the wrong group.
    const byFingerprint = new Map();
    for (const leaf of leaves) {
        const queue = byFingerprint.get(leaf.fingerprint) || [];
        queue.push(leaf);
        byFingerprint.set(leaf.fingerprint, queue);
    }
    return messages.map((message) => {
        const leaf = byFingerprint.get(fingerprint(message))?.shift();
        return leaf ? { ids: [...leaf.ids] } : null;
    });
}

/** Resolve the first exact source identifier owned by a visible group. */
export function groupForProvenance(provenance, groupByBlockId) {
    if (!provenance || !(groupByBlockId instanceof Map)) return null;
    for (const id of (provenance.ids || [])) {
        const group = groupByBlockId.get(id);
        if (group) return group;
    }
    return null;
}
