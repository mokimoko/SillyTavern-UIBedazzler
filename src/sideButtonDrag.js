// Persistent pointer dragging for the floating side-button strip.

import { getSetting, setSetting } from './settings.js';

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
    const minX = Math.max(VIEWPORT_GAP, Number(minimumX) || 0);
    const minY = Math.max(VIEWPORT_GAP, Number(minimumY) || 0);
    return {
        x: Math.max(minX, Math.min(Number(x) || 0, Math.max(minX, viewportWidth - width - VIEWPORT_GAP))),
        y: Math.max(minY, Math.min(Number(y) || 0, Math.max(minY, viewportHeight - height - VIEWPORT_GAP))),
    };
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

function updateScrollableHeight(element) {
    const scroller = element.querySelector('.bd-side-buttons-scroll');
    if (!scroller) return;

    const style = getComputedStyle(element);
    const outerChrome = [
        style.paddingTop,
        style.paddingBottom,
        style.borderTopWidth,
        style.borderBottomWidth,
    ].reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
    const safeOrigin = getTopBarSafeOrigin();
    const maxHeight = calculateSideButtonScrollerHeight(
        window.innerHeight,
        safeOrigin.y,
        outerChrome,
    );
    const value = `${Math.floor(maxHeight)}px`;
    if (element.style.getPropertyValue('--bd-side-buttons-max-height') !== value) {
        element.style.setProperty('--bd-side-buttons-max-height', value);
    }
}

function clampForElement(x, y, element) {
    const rect = element.getBoundingClientRect();
    const safeOrigin = getTopBarSafeOrigin();
    return clampSideButtonPosition(
        x,
        y,
        rect.width || element.offsetWidth || 40,
        (rect.height || element.offsetHeight || 40) + HANDLE_CLEARANCE,
        window.innerWidth,
        window.innerHeight,
        safeOrigin.x,
        safeOrigin.y + HANDLE_CLEARANCE,
    );
}

function applyPosition(element) {
    updateScrollableHeight(element);
    const saved = readPosition();
    const rect = element.getBoundingClientRect();
    const safeOrigin = getTopBarSafeOrigin();
    const baseX = saved?.x ?? rect.left;
    const position = clampForElement(
        saved ? adjustSavedXForLeftRail(baseX) : baseX,
        saved?.y ?? Math.max(rect.top, safeOrigin.y),
        element,
    );
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
        const safeOrigin = getTopBarSafeOrigin();
        drag = {
            pointerId: event.pointerId,
            handle: event.currentTarget,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            width: rect.width || element.offsetWidth || 40,
            height: (rect.height || element.offsetHeight || 40) + HANDLE_CLEARANCE,
            minimumX: safeOrigin.x,
            minimumY: safeOrigin.y + HANDLE_CLEARANCE,
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
        setSetting(SETTING_KEY, { x: Math.round(position.x), y: Math.round(position.y) });
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
