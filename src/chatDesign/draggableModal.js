// Pointer-driven positioning and sizing for the Chat Design modal.

import { getChatDesignModalSize, setChatDesignModalSize } from './storage.js';

const EDGE_MARGIN = 12;
const X_OFFSET = '--wl-cdm-drag-x';
const Y_OFFSET = '--wl-cdm-drag-y';
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;
const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'se', 'sw', 'nw'];
const viewportTrackers = new WeakMap();

function isInteractiveTarget(target) {
    return Boolean(target?.closest?.('button, input, select, textarea, a, [role="button"], [contenteditable="true"]'));
}

function readOffset(modal, property) {
    return Number.parseFloat(modal.style.getPropertyValue(property)) || 0;
}

function setOffset(modal, x, y) {
    modal.style.setProperty(X_OFFSET, `${Math.round(x)}px`);
    modal.style.setProperty(Y_OFFSET, `${Math.round(y)}px`);
}

function clampToViewport(modal) {
    if (!modal?.classList.contains('wl-cdm-visible')) return;

    const rect = modal.getBoundingClientRect();
    let x = readOffset(modal, X_OFFSET);
    let y = readOffset(modal, Y_OFFSET);

    if (rect.left < EDGE_MARGIN) x += EDGE_MARGIN - rect.left;
    if (rect.right > window.innerWidth - EDGE_MARGIN) x -= rect.right - (window.innerWidth - EDGE_MARGIN);
    if (rect.top < EDGE_MARGIN) y += EDGE_MARGIN - rect.top;
    if (rect.bottom > window.innerHeight - EDGE_MARGIN) y -= rect.bottom - (window.innerHeight - EDGE_MARGIN);

    setOffset(modal, x, y);
}

export function clampModalSize(width, height, viewportWidth, viewportHeight) {
    const maxWidth = Math.max(1, viewportWidth - (EDGE_MARGIN * 2));
    const maxHeight = Math.max(1, viewportHeight - (EDGE_MARGIN * 2));
    const minWidth = Math.min(MIN_WIDTH, maxWidth);
    const minHeight = Math.min(MIN_HEIGHT, maxHeight);
    return {
        width: Math.min(maxWidth, Math.max(minWidth, Number(width) || minWidth)),
        height: Math.min(maxHeight, Math.max(minHeight, Number(height) || minHeight)),
    };
}

function applySavedSize(modal) {
    const saved = getChatDesignModalSize();
    if (!saved) return;
    const size = clampModalSize(saved.width, saved.height, window.innerWidth, window.innerHeight);
    modal.style.width = `${Math.round(size.width)}px`;
    modal.style.height = `${Math.round(size.height)}px`;
    modal.style.maxHeight = 'none';
    modal.classList.add('wl-cdm-user-sized');
}

function ensureViewportTracking(modal) {
    if (viewportTrackers.has(modal)) return;
    let frame = null;
    let shouldApplySavedSize = false;
    const schedule = (applySize = false) => {
        shouldApplySavedSize ||= applySize;
        if (frame !== null) return;
        frame = window.requestAnimationFrame(() => {
            frame = null;
            if (shouldApplySavedSize) applySavedSize(modal);
            shouldApplySavedSize = false;
            clampToViewport(modal);
        });
    };
    const onWindowResize = () => schedule(true);
    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => schedule())
        : null;
    window.addEventListener('resize', onWindowResize);
    resizeObserver?.observe(modal);
    viewportTrackers.set(modal, { onWindowResize, resizeObserver });
}

export function resetModalSize(modal) {
    setChatDesignModalSize(null);
    if (!modal) return;
    modal.style.width = '';
    modal.style.height = '';
    modal.style.maxHeight = '';
    modal.classList.remove('wl-cdm-user-sized');
    window.requestAnimationFrame(() => clampToViewport(modal));
}

function injectResizeHandles(modal) {
    if (modal.querySelector('.wl-cdm-resize-handle')) return;
    for (const direction of RESIZE_DIRECTIONS) {
        const handle = document.createElement('div');
        handle.className = `wl-cdm-resize-handle wl-cdm-resize-${direction}`;
        handle.dataset.wlResizeDirection = direction;
        handle.setAttribute('aria-hidden', 'true');
        if (direction === 'se') {
            handle.title = 'Drag to resize · Double-click to reset size';
        }
        modal.appendChild(handle);
    }
}

export function makeModalResizable(modal) {
    if (!modal || modal.dataset.wlResizable === 'true') return;
    modal.dataset.wlResizable = 'true';
    injectResizeHandles(modal);
    applySavedSize(modal);
    ensureViewportTracking(modal);

    modal.querySelectorAll('.wl-cdm-resize-handle').forEach(handle => {
        const direction = handle.dataset.wlResizeDirection || '';
        let resize = null;
        let frame = null;
        let pending = null;

        const flush = () => {
            if (!pending) return;
            modal.style.width = `${Math.round(pending.width)}px`;
            modal.style.height = `${Math.round(pending.height)}px`;
            modal.style.maxHeight = 'none';
            modal.classList.add('wl-cdm-user-sized');
            setOffset(modal, pending.offsetX, pending.offsetY);
            pending = null;
            frame = null;
        };

        handle.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            const rect = modal.getBoundingClientRect();
            resize = {
                pointerId: event.pointerId,
                pointerX: event.clientX,
                pointerY: event.clientY,
                width: rect.width,
                height: rect.height,
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                offsetX: readOffset(modal, X_OFFSET),
                offsetY: readOffset(modal, Y_OFFSET),
                moved: false,
            };
            try { handle.setPointerCapture(event.pointerId); } catch { /* optional browser support */ }
            modal.classList.add('wl-cdm-modal-resizing');
            event.preventDefault();
            event.stopPropagation();
        });

        handle.addEventListener('pointermove', event => {
            if (!resize || event.pointerId !== resize.pointerId) return;
            const dx = event.clientX - resize.pointerX;
            const dy = event.clientY - resize.pointerY;
            const minWidth = Math.min(MIN_WIDTH, window.innerWidth - (EDGE_MARGIN * 2));
            const minHeight = Math.min(MIN_HEIGHT, window.innerHeight - (EDGE_MARGIN * 2));
            let width = resize.width;
            let height = resize.height;
            let offsetX = resize.offsetX;
            let offsetY = resize.offsetY;

            if (direction.includes('e')) {
                width = Math.min(window.innerWidth - EDGE_MARGIN - resize.left, Math.max(minWidth, resize.width + dx));
                offsetX = resize.offsetX + ((width - resize.width) / 2);
            } else if (direction.includes('w')) {
                width = Math.min(resize.right - EDGE_MARGIN, Math.max(minWidth, resize.width - dx));
                offsetX = resize.offsetX - ((width - resize.width) / 2);
            }
            if (direction.includes('s')) {
                height = Math.min(window.innerHeight - EDGE_MARGIN - resize.top, Math.max(minHeight, resize.height + dy));
                offsetY = resize.offsetY + ((height - resize.height) / 2);
            } else if (direction.includes('n')) {
                height = Math.min(resize.bottom - EDGE_MARGIN, Math.max(minHeight, resize.height - dy));
                offsetY = resize.offsetY - ((height - resize.height) / 2);
            }

            pending = { width, height, offsetX, offsetY };
            resize.moved = true;
            if (frame === null) frame = window.requestAnimationFrame(flush);
        });

        const finishResize = event => {
            if (!resize || event.pointerId !== resize.pointerId) return;
            if (frame !== null) {
                window.cancelAnimationFrame(frame);
                flush();
            }
            try { handle.releasePointerCapture(event.pointerId); } catch { /* capture may already be gone */ }
            const moved = resize.moved;
            resize = null;
            modal.classList.remove('wl-cdm-modal-resizing');
            if (!moved) return;
            const rect = modal.getBoundingClientRect();
            setChatDesignModalSize({ width: rect.width, height: rect.height });
        };

        handle.addEventListener('pointerup', finishResize);
        handle.addEventListener('pointercancel', finishResize);
        if (direction === 'se') {
            handle.addEventListener('dblclick', event => {
                event.preventDefault();
                event.stopPropagation();
                resetModalSize(modal);
            });
        }
    });

}

export function makeModalDraggable(modal, handle) {
    if (!modal || !handle || modal.dataset.wlDraggable === 'true') return;
    modal.dataset.wlDraggable = 'true';

    let drag = null;

    const endDrag = event => {
        if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
        if (handle.hasPointerCapture?.(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
        drag = null;
        modal.classList.remove('wl-cdm-modal-dragging');
    };

    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || isInteractiveTarget(event.target)) return;

        const rect = modal.getBoundingClientRect();
        const startX = readOffset(modal, X_OFFSET);
        const startY = readOffset(modal, Y_OFFSET);
        drag = {
            pointerId: event.pointerId,
            pointerX: event.clientX,
            pointerY: event.clientY,
            startX,
            startY,
            minX: startX + EDGE_MARGIN - rect.left,
            maxX: startX + window.innerWidth - EDGE_MARGIN - rect.right,
            minY: startY + EDGE_MARGIN - rect.top,
            maxY: startY + window.innerHeight - EDGE_MARGIN - rect.bottom,
        };

        handle.setPointerCapture?.(event.pointerId);
        modal.classList.add('wl-cdm-modal-dragging');
        event.preventDefault();
    });

    handle.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const x = Math.min(drag.maxX, Math.max(drag.minX, drag.startX + event.clientX - drag.pointerX));
        const y = Math.min(drag.maxY, Math.max(drag.minY, drag.startY + event.clientY - drag.pointerY));
        setOffset(modal, x, y);
    });

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('dblclick', event => {
        if (isInteractiveTarget(event.target)) return;
        setOffset(modal, 0, 0);
    });
    ensureViewportTracking(modal);
}

export function clampDraggableModal(modal) {
    clampToViewport(modal);
}
