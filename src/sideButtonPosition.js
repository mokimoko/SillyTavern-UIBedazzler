// Persist toolbar placement independently of viewport size and browser zoom.
const VIEWPORT_GAP = 8;
const EDGE_DISTANCE = 48;
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export function getSideButtonPositionRange(bounds, viewportWidth, viewportHeight) {
    const minX = Math.max(VIEWPORT_GAP, Number(bounds.minimumX) || 0);
    const minY = Math.max(VIEWPORT_GAP, Number(bounds.minimumY) || 0);
    return {
        minX, minY,
        maxX: Math.max(minX, viewportWidth - bounds.width - VIEWPORT_GAP),
        maxY: Math.max(minY, viewportHeight - bounds.height - VIEWPORT_GAP),
    };
}

export function clampSideButtonToRange(position, range) {
    return {
        x: clamp(Number(position.x) || 0, range.minX, range.maxX),
        y: clamp(Number(position.y) || 0, range.minY, range.maxY),
    };
}

function validAxis(axis) {
    return axis && Number.isFinite(axis.value) && axis.value >= 0
        && (axis.mode === 'start' || axis.mode === 'end' || (axis.mode === 'ratio' && axis.value <= 1));
}

function captureAxis(value, min, max, previous, defaultEdge) {
    // A full-width/height strip has no freedom on this axis. Keep its previous
    // preference so making the viewport larger restores the intended position.
    if (max <= min) return validAxis(previous) ? { ...previous } : { mode: defaultEdge, value: 0 };
    const startGap = value - min;
    const endGap = max - value;
    if (Math.min(startGap, endGap) <= EDGE_DISTANCE) {
        return startGap < endGap
            ? { mode: 'start', value: startGap }
            : { mode: 'end', value: endGap };
    }
    return { mode: 'ratio', value: startGap / (max - min) };
}

export function captureSideButtonPosition(position, range, previous = null) {
    const clamped = clampSideButtonToRange(position, range);
    return {
        version: 2,
        ...clamped,
        xAxis: captureAxis(clamped.x, range.minX, range.maxX, previous?.xAxis, 'end'),
        yAxis: captureAxis(clamped.y, range.minY, range.maxY, previous?.yAxis, 'start'),
    };
}

function resolveAxis(axis, min, max) {
    const value = axis.mode === 'start' ? min + axis.value
        : axis.mode === 'end' ? max - axis.value
            : min + (max - min) * axis.value;
    return clamp(value, min, max);
}

export function resolveSideButtonPosition(saved, range) {
    if (saved?.version !== 2 || !validAxis(saved.xAxis) || !validAxis(saved.yAxis)) return null;
    return {
        x: resolveAxis(saved.xAxis, range.minX, range.maxX),
        y: resolveAxis(saved.yAxis, range.minY, range.maxY),
    };
}
