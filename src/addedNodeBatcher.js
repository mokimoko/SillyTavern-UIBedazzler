/**
 * Coalesce MutationObserver added-node scans into one animation-frame pass.
 * Large host redraws often produce several mutation batches and nested roots;
 * scanning only the surviving top-level roots avoids repeated subtree walks.
 */
export function createAddedNodeBatcher(scan, {
    schedule = callback => requestAnimationFrame(callback),
    cancel = handle => cancelAnimationFrame(handle),
    acceptNode = () => true,
} = {}) {
    const pendingRoots = new Set();
    let scheduledHandle = null;

    const flush = () => {
        scheduledHandle = null;
        const roots = [...pendingRoots];
        pendingRoots.clear();
        const rootSet = new Set(roots);

        for (const root of roots) {
            if (!root?.isConnected) continue;
            let ancestor = root.parentElement;
            let nested = false;
            while (ancestor) {
                if (rootSet.has(ancestor)) {
                    nested = true;
                    break;
                }
                ancestor = ancestor.parentElement;
            }
            if (!nested) scan(root);
        }
    };

    const enqueue = mutations => {
        for (const mutation of mutations || []) {
            for (const node of mutation.addedNodes || []) {
                if (node?.nodeType === 1 && acceptNode(node, mutation)) pendingRoots.add(node);
            }
        }
        if (pendingRoots.size === 0 || scheduledHandle !== null) return;
        scheduledHandle = schedule(flush);
    };

    enqueue.cancel = () => {
        if (scheduledHandle !== null) cancel(scheduledHandle);
        scheduledHandle = null;
        pendingRoots.clear();
    };

    return enqueue;
}
