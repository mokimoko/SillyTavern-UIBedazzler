// Shared ordering and viewport geometry for the floating toolbar.

export function orderSideButtons(entries, savedOrder) {
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const ordered = [];
    for (const id of Array.isArray(savedOrder) ? savedOrder : []) {
        if (!byId.has(id)) continue;
        ordered.push(byId.get(id));
        byId.delete(id);
    }
    for (const entry of byId.values()) {
        const before = entry.defaultBefore ? ordered.findIndex(item => item.id === entry.defaultBefore) : -1;
        if (before >= 0) ordered.splice(before, 0, entry);
        else ordered.push(entry);
    }
    return ordered;
}

export function getSideButtonPanelPosition(anchor, width, height, viewportWidth, viewportHeight, horizontal) {
    const gap = 8;
    let left;
    let top;
    if (horizontal) {
        left = anchor.left;
        top = anchor.bottom + gap;
        if (top + height > viewportHeight - gap) top = anchor.top - height - gap;
    } else {
        left = anchor.left - width - gap;
        if (left < gap) left = anchor.right + gap;
        top = anchor.top;
    }
    return {
        left: Math.round(Math.max(gap, Math.min(left, viewportWidth - width - gap))),
        top: Math.round(Math.max(gap, Math.min(top, viewportHeight - height - gap))),
    };
}
