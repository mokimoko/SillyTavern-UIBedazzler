// Keep SuperAgents' movable Story Apps dock clear of Bedazzler top-bar layouts.

import { extension_settings } from '../../../../extensions.js';
import { subscribeBodyMutations } from './bodyMutationHub.js';

const DOCK_ID = 'sa-surface-dock';
const SUPER_AGENTS_MODULE = 'SillyTavern-SuperAgents';
const POSITION_KEY = 'storyAppsPosition';
const VIEWPORT_GAP = 8;
const HANDLE_CLEARANCE = 20;

let dockEl = null;
let detachDock = null;
let initialized = false;
let positionFrame = null;
let lastAppliedStyle = null;

function readSavedPosition() {
    const value = extension_settings[SUPER_AGENTS_MODULE]?.[POSITION_KEY];
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
    return value;
}

export function clampStoryAppsDockPosition(
    x,
    y,
    width,
    height,
    viewportWidth,
    viewportHeight,
    topBarRect = null,
    horizontalClearance = HANDLE_CLEARANCE,
) {
    const clearance = Math.max(0, Number(horizontalClearance) || 0);
    const maxX = Math.max(clearance, viewportWidth - width - clearance);
    const maxY = Math.max(0, viewportHeight - height);
    const position = {
        x: Math.max(clearance, Math.min(Number(x) || 0, maxX)),
        y: Math.max(0, Math.min(Number(y) || 0, maxY)),
    };

    if (!topBarRect || topBarRect.width <= 0 || topBarRect.height <= 0) return position;
    const overlaps = position.x - HANDLE_CLEARANCE < topBarRect.right
        && position.x + width + HANDLE_CLEARANCE > topBarRect.left
        && position.y < topBarRect.bottom
        && position.y + height > topBarRect.top;
    if (!overlaps) return position;

    const verticalRail = topBarRect.height >= viewportHeight * 0.6
        && topBarRect.width < viewportWidth * 0.35;
    if (verticalRail) {
        const beside = Math.ceil(topBarRect.right + VIEWPORT_GAP + HANDLE_CLEARANCE);
        if (beside + width + HANDLE_CLEARANCE <= viewportWidth) {
            position.x = Math.max(clearance, beside);
            return position;
        }
    }

    const below = Math.ceil(topBarRect.bottom + VIEWPORT_GAP);
    if (below + height <= viewportHeight) position.y = below;
    return position;
}

function clearInlinePosition(element) {
    element.style.left = '';
    element.style.top = '';
    element.style.right = '';
    element.style.bottom = '';
}

function applyPosition() {
    if (!dockEl || !dockEl.isConnected || dockEl.hidden) return;

    const dragging = dockEl.classList.contains('sa-surface-dock--dragging');
    const saved = dragging ? null : readSavedPosition();
    if (!dragging && !saved) clearInlinePosition(dockEl);

    const rect = dockEl.getBoundingClientRect();
    const width = rect.width || dockEl.offsetWidth || 40;
    const height = rect.height || dockEl.offsetHeight || 40;
    const topBarRect = document.getElementById('top-bar')?.getBoundingClientRect() || null;
    const position = clampStoryAppsDockPosition(
        saved?.x ?? rect.left,
        saved?.y ?? rect.top,
        width,
        height,
        window.innerWidth,
        window.innerHeight,
        topBarRect,
        dragging || saved ? HANDLE_CLEARANCE : 0,
    );

    const moved = Math.round(position.x) !== Math.round(rect.left)
        || Math.round(position.y) !== Math.round(rect.top);
    if (saved || moved) {
        dockEl.style.left = `${position.x}px`;
        dockEl.style.top = `${position.y}px`;
        dockEl.style.right = 'auto';
        dockEl.style.bottom = 'auto';
    }
    lastAppliedStyle = dockEl.style.cssText;
}

export function refreshStoryAppsDockPosition() {
    if (positionFrame !== null) return;
    positionFrame = requestAnimationFrame(() => {
        positionFrame = null;
        applyPosition();
    });
}

function attachDock(element) {
    if (!element || element === dockEl) {
        refreshStoryAppsDockPosition();
        return;
    }

    detachDock?.();
    dockEl = element;
    lastAppliedStyle = null;

    const dockObserver = new MutationObserver((mutations) => {
        const styleOnly = mutations.every(mutation => mutation.attributeName === 'style');
        if (styleOnly && dockEl?.style.cssText === lastAppliedStyle) return;
        refreshStoryAppsDockPosition();
    });
    dockObserver.observe(element, {
        attributes: true,
        attributeFilter: ['style', 'hidden', 'class'],
    });

    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(refreshStoryAppsDockPosition)
        : null;
    resizeObserver?.observe(element);
    const topBar = document.getElementById('top-bar');
    if (topBar) resizeObserver?.observe(topBar);

    const onResize = refreshStoryAppsDockPosition;
    const onPointerMove = () => {
        if (element.classList.contains('sa-surface-dock--dragging')) applyPosition();
    };
    window.addEventListener('resize', onResize);
    element.addEventListener('pointermove', onPointerMove);

    detachDock = () => {
        dockObserver.disconnect();
        resizeObserver?.disconnect();
        window.removeEventListener('resize', onResize);
        element.removeEventListener('pointermove', onPointerMove);
        if (positionFrame !== null) cancelAnimationFrame(positionFrame);
        positionFrame = null;
        if (dockEl === element) dockEl = null;
        detachDock = null;
        lastAppliedStyle = null;
    };

    refreshStoryAppsDockPosition();
}

function mutationAddsStoryAppsDock(mutation) {
    if (mutation.target?.closest?.('#chat')) return false;
    return [...(mutation.addedNodes || [])].some(node => node?.nodeType === 1
        && (node.id === DOCK_ID || node.querySelector?.(`#${DOCK_ID}`)));
}

export function initStoryAppsDockCompat() {
    if (initialized) return;
    initialized = true;

    attachDock(document.getElementById(DOCK_ID));
    subscribeBodyMutations((mutations) => {
        if (!mutations.some(mutationAddsStoryAppsDock)) return;
        attachDock(document.getElementById(DOCK_ID));
    });
}
