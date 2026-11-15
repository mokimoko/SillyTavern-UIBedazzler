// Persistent pointer dragging for the floating side-button strip.

import { getSetting, setSetting } from './settings.js';
import {
    getSideButtonPositionRange, clampSideButtonToRange,
    captureSideButtonPosition, resolveSideButtonPosition,
} from './sideButtonPosition.js';

const SETTING_KEY = 'sideButtonPosition';
const VIEWPORT_GAP = 8;
const HANDLE_CLEARANCE = 20;
const MIN_SCROLLER_HEIGHT = 40;

export function clampSideButtonPosition(
    x,
    y,
    width,
    height,
    viewportWidth,
    viewportHeight,
    minimumX = VIEWPORT_GAP,
    minimumY = VIEWPORT_GAP,
) {
    const range = getSideButtonPositionRange({ width, height, minimumX, minimumY }, viewportWidth, viewportHeight);
    return clampSideButtonToRange({ x, y }, range);
}

export function calculateSideButtonScrollerHeight(viewportHeight, topBarSafeY, outerChrome = 0) {
    return Math.max(
        MIN_SCROLLER_HEIGHT,
        viewportHeight - topBarSafeY - (HANDLE_CLEARANCE * 2) - VIEWPORT_GAP - outerChrome,
    );
}

export function translateLegacyChatEdgeX(x, legacyChatRight, currentChatRight) {
    const shift = currentChatRight - legacyChatRight;
    if (shift <= 0) return x;

    const wasBesideLegacyChat = x >= legacyChatRight - VIEWPORT_GAP
        && x < currentChatRight;
    return wasBesideLegacyChat ? x + shift : x;
}

function readPosition() {
    const value = getSetting(SETTING_KEY);
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
}

function getTopBarSafeOrigin() {
    const rects = ['top-bar', 'top-settings-holder']
        .map(id => document.getElementById(id)?.getBoundingClientRect())
        .filter(rect => rect && rect.width > 0 && rect.height > 0);
    let x = VIEWPORT_GAP;
    let y = VIEWPORT_GAP;

    for (const rect of rects) {
        const verticalRail = rect.height >= window.innerHeight * 0.6
            && rect.width < window.innerWidth * 0.35;
        if (verticalRail && rect.left <= VIEWPORT_GAP) {
            x = Math.max(x, rect.right + VIEWPORT_GAP);
        } else if (rect.top <= VIEWPORT_GAP) {
            y = Math.max(y, rect.bottom + VIEWPORT_GAP);
        }
    }

    return { x, y };
}

function adjustSavedXForLeftRail(x) {
    const topBar = document.getElementById('top-bar');
    const chatShell = document.getElementById('sheld');
    if (!topBar || !chatShell) return x;

    const railRect = topBar.getBoundingClientRect();
    const verticalRail = railRect.height >= window.innerHeight * 0.6
        && railRect.width < window.innerWidth * 0.35;
    if (!verticalRail || railRect.left > VIEWPORT_GAP) return x;

    const bodyStyle = getComputedStyle(document.body);
    const railWidth = Number.parseFloat(bodyStyle.getPropertyValue('--bd-left-rail-width'));
    const railGap = Number.parseFloat(bodyStyle.getPropertyValue('--bd-left-rail-gap')) || 0;
    if (!Number.isFinite(railWidth)) return x;

    const railSpace = railWidth + railGap;
    const chatRect = chatShell.getBoundingClientRect();
    const legacyChatRight = chatRect.right - (railSpace / 2);
    return translateLegacyChatEdgeX(x, legacyChatRight, chatRect.right);
}

function updateScrollableSize(element) {
    const scroller = element.querySelector('.bd-side-buttons-scroll');
    if (!scroller) return;

    const style = getComputedStyle(element);
    const horizontal = element.classList.contains('bd-side-buttons-horizontal');
    const outerChrome = (horizontal ? [
        style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth,
    ] : [
        style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth,
    ]).reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
    const safeOrigin = getTopBarSafeOrigin();
    const maxSize = calculateSideButtonScrollerHeight(
        horizontal ? window.innerWidth : window.innerHeight,
        horizontal ? safeOrigin.x : safeOrigin.y,
        outerChrome,
    );
    const value = `${Math.floor(maxSize)}px`;
    const property = horizontal ? '--bd-side-buttons-max-width' : '--bd-side-buttons-max-height';
    if (element.style.getPropertyValue(property) !== value) {
        element.style.setProperty(property, value);
    }
}

function getDragBounds(element) {
    const rect = element.getBoundingClientRect();
    const safeOrigin = getTopBarSafeOrigin();
    const horizontal = element.classList.contains('bd-side-buttons-horizontal');
    const insetX = horizontal ? HANDLE_CLEARANCE : 0;
    const insetY = horizontal ? 0 : HANDLE_CLEARANCE;
    return {
        width: (rect.width || element.offsetWidth || 40) + insetX,
        height: (rect.height || element.offsetHeight || 40) + insetY,
        minimumX: safeOrigin.x + insetX,
        minimumY: safeOrigin.y + insetY,
    };
}

function getPositionRange(element) {
    return getSideButtonPositionRange(getDragBounds(element), window.innerWidth, window.innerHeight);
}

function applyPosition(element) {
    if (element.classList.contains('bd-side-buttons-dragging')) return;
    updateScrollableSize(element);
    const saved = readPosition();
    const range = getPositionRange(element);
    let position = resolveSideButtonPosition(saved, range);
    if (!position) {
        const rect = element.getBoundingClientRect();
        position = clampSideButtonToRange({
            x: saved ? adjustSavedXForLeftRail(saved.x) : rect.left,
            y: saved?.y ?? rect.top,
        }, range);
        // Migrate legacy coordinates once, or remember the initial/default
        // placement. Resizes only resolve this preference; they never rewrite it.
        setSetting(SETTING_KEY, captureSideButtonPosition(position, range));
    }
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
}

export function resetSideButtonPosition(element = document.getElementById('bd-side-buttons')) {
    setSetting(SETTING_KEY, null);
    if (!element) return;
    element.style.left = '';
    element.style.top = '';
    element.style.right = '';
    element.style.bottom = '';
    applyPosition(element);
}

/** Attach dedicated drag handles without interfering with toolbar buttons. */
export function attachSideButtonDrag(element, handles) {
    const dragHandles = (Array.isArray(handles) ? handles : [handles]).filter(Boolean);
    if (!element || dragHandles.length === 0) return () => {};
    let drag = null;
    let dragFrame = null;

    const flushDragPosition = () => {
        dragFrame = null;
        if (!drag?.position) return;
        const { x, y } = drag.position;
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
        element.style.right = 'auto';
        element.style.bottom = 'auto';
    };

    const onPointerDown = event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const rect = element.getBoundingClientRect();
        drag = {
            pointerId: event.pointerId,
            handle: event.currentTarget,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            ...getDragBounds(element),
            position: null,
            moved: false,
        };
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* optional browser support */ }
    };

    const onPointerMove = event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.position = clampSideButtonPosition(
            event.clientX - drag.offsetX,
            event.clientY - drag.offsetY,
            drag.width,
            drag.height,
            window.innerWidth,
            window.innerHeight,
            drag.minimumX,
            drag.minimumY,
        );
        if (dragFrame === null) dragFrame = requestAnimationFrame(flushDragPosition);
        element.classList.add('bd-side-buttons-dragging');
        drag.moved = true;
    };

    const finishDrag = event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        try { drag.handle.releasePointerCapture(event.pointerId); } catch { /* capture may already be gone */ }
        const moved = drag.moved;
        const position = drag.position;
        if (dragFrame !== null) {
            cancelAnimationFrame(dragFrame);
            dragFrame = null;
            flushDragPosition();
        }
        drag = null;
        element.classList.remove('bd-side-buttons-dragging');
        if (!moved || !position) return;
        updateScrollableSize(element);
        setSetting(SETTING_KEY, captureSideButtonPosition(position, getPositionRange(element), readPosition()));
        applyPosition(element);
    };

    const onDoubleClick = event => {
        event.preventDefault();
        resetSideButtonPosition(element);
    };
    let layoutFrame = null;
    const queuePositionCheck = () => {
        if (layoutFrame !== null) return;
        layoutFrame = requestAnimationFrame(() => {
            layoutFrame = null;
            applyPosition(element);
        });
    };
    const onResize = queuePositionCheck;

    for (const handle of dragHandles) {
        handle.addEventListener('pointerdown', onPointerDown);
        handle.addEventListener('pointermove', onPointerMove);
        handle.addEventListener('pointerup', finishDrag);
        handle.addEventListener('pointercancel', finishDrag);
        handle.addEventListener('dblclick', onDoubleClick);
    }
    window.addEventListener('resize', onResize);

    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(queuePositionCheck)
        : null;
    resizeObserver?.observe(element);
    const topBar = document.getElementById('top-bar');
    const topSettings = document.getElementById('top-settings-holder');
    if (topBar) resizeObserver?.observe(topBar);
    if (topSettings) resizeObserver?.observe(topSettings);

    // Chat Design rewrites this sheet while its sliders move. Watching it also
    // catches vertical offsets, which do not trigger ResizeObserver.
    const contextStyles = document.getElementById('wl-chat-design-context-styles');
    const styleObserver = contextStyles && typeof MutationObserver === 'function'
        ? new MutationObserver(queuePositionCheck)
        : null;
    styleObserver?.observe(contextStyles, { childList: true, characterData: true, subtree: true });
    applyPosition(element);

    return () => {
        for (const handle of dragHandles) {
            handle.removeEventListener('pointerdown', onPointerDown);
            handle.removeEventListener('pointermove', onPointerMove);
            handle.removeEventListener('pointerup', finishDrag);
            handle.removeEventListener('pointercancel', finishDrag);
            handle.removeEventListener('dblclick', onDoubleClick);
        }
        window.removeEventListener('resize', onResize);
        resizeObserver?.disconnect();
        styleObserver?.disconnect();
        if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
        if (dragFrame !== null) cancelAnimationFrame(dragFrame);
        element.classList.remove('bd-side-buttons-dragging');
    };
}
