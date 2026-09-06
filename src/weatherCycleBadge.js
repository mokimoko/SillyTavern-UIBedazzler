// Optional draggable positioning for Weather Cycle's top-left status badge.

import { getSetting, setSetting } from './settings.js';
import { subscribeBodyMutations } from './bodyMutationHub.js';

const BADGE_ID = 'st-weather-cycle-badge';
const MOVE_THRESHOLD = 4;

let badgeEl = null;
let detachBadge = null;
let initialized = false;

export function clampWeatherBadgePosition(x, y, width, height, viewportWidth, viewportHeight) {
    return {
        x: Math.max(0, Math.min(Number(x) || 0, Math.max(0, viewportWidth - width))),
        y: Math.max(0, Math.min(Number(y) || 0, Math.max(0, viewportHeight - height))),
    };
}

function readPosition() {
    const value = getSetting('weatherBadgePosition');
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
    return value;
}

function clampToViewport(x, y, badge) {
    const rect = badge.getBoundingClientRect();
    return clampWeatherBadgePosition(
        x,
        y,
        rect.width || badge.offsetWidth || 120,
        rect.height || badge.offsetHeight || 36,
        window.innerWidth,
        window.innerHeight,
    );
}

function applyPosition() {
    if (!badgeEl) return;
    const saved = readPosition();
    if (!saved) {
        badgeEl.style.left = '';
        badgeEl.style.top = '';
        badgeEl.style.right = '';
        badgeEl.style.bottom = '';
        return;
    }

    const position = clampToViewport(saved.x, saved.y, badgeEl);
    badgeEl.style.left = `${position.x}px`;
    badgeEl.style.top = `${position.y}px`;
    badgeEl.style.right = 'auto';
    badgeEl.style.bottom = 'auto';
}

export function isWeatherCycleBadgeAvailable() {
    return !!document.getElementById(BADGE_ID);
}

export function syncWeatherCycleBadgeSettingsRow() {
    const row = document.getElementById('bd-weather-badge-position-row');
    if (row) row.hidden = !isWeatherCycleBadgeAvailable();
}

function attachBadge(badge) {
    if (!badge || badge === badgeEl) return;
    detachBadge?.();
    badgeEl = badge;
    badge.classList.add('bd-weather-cycle-badge-movable');

    let dragState = null;

    const onPointerDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const rect = badge.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            moved: false,
        };
        try { badge.setPointerCapture(event.pointerId); } catch { /* optional browser support */ }
    };

    const onPointerMove = (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        if (!dragState.moved) {
            const distance = Math.hypot(
                event.clientX - dragState.startX,
                event.clientY - dragState.startY,
            );
            if (distance < MOVE_THRESHOLD) return;
            dragState.moved = true;
            badge.classList.add('bd-weather-cycle-badge-dragging');
        }

        const position = clampToViewport(
            event.clientX - dragState.offsetX,
            event.clientY - dragState.offsetY,
            badge,
        );
        badge.style.left = `${position.x}px`;
        badge.style.top = `${position.y}px`;
        badge.style.right = 'auto';
        badge.style.bottom = 'auto';
        event.preventDefault();
    };

    const finishDrag = (event, cancelled = false) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        try { badge.releasePointerCapture(event.pointerId); } catch { /* capture may already be gone */ }
        const moved = dragState.moved;
        dragState = null;
        badge.classList.remove('bd-weather-cycle-badge-dragging');

        if (moved && !cancelled) {
            const rect = badge.getBoundingClientRect();
            const position = clampToViewport(rect.left, rect.top, badge);
            setSetting('weatherBadgePosition', {
                x: Math.round(position.x),
                y: Math.round(position.y),
            });
        } else if (moved) {
            applyPosition();
        }
    };

    const onPointerUp = event => finishDrag(event);
    const onPointerCancel = event => finishDrag(event, true);
    const onResize = () => applyPosition();

    badge.addEventListener('pointerdown', onPointerDown);
    badge.addEventListener('pointermove', onPointerMove);
    badge.addEventListener('pointerup', onPointerUp);
    badge.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('resize', onResize);

    detachBadge = () => {
        badge.removeEventListener('pointerdown', onPointerDown);
        badge.removeEventListener('pointermove', onPointerMove);
        badge.removeEventListener('pointerup', onPointerUp);
        badge.removeEventListener('pointercancel', onPointerCancel);
        window.removeEventListener('resize', onResize);
        badge.classList.remove(
            'bd-weather-cycle-badge-movable',
            'bd-weather-cycle-badge-dragging',
        );
        if (badgeEl === badge) badgeEl = null;
        detachBadge = null;
    };

    applyPosition();
    syncWeatherCycleBadgeSettingsRow();
}

function mutationAddsWeatherBadge(mutation) {
    // Streaming chat DOM can be extremely noisy and can never contain this
    // fixed, body-level badge. Reject it before walking any added subtree.
    if (mutation.target?.closest?.('#chat')) return false;
    return [...(mutation.addedNodes || [])].some(node => node?.nodeType === 1
        && (node.id === BADGE_ID || node.querySelector?.(`#${BADGE_ID}`)));
}

export function resetWeatherCycleBadgePosition() {
    setSetting('weatherBadgePosition', null);
    applyPosition();
}

export function initWeatherCycleBadge() {
    if (initialized) return;
    initialized = true;

    attachBadge(document.getElementById(BADGE_ID));
    subscribeBodyMutations((mutations) => {
        if (!mutations.some(mutationAddsWeatherBadge)) return;
        attachBadge(document.getElementById(BADGE_ID));
    });
}
