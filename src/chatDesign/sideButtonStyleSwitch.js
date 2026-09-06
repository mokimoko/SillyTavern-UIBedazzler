// Global + per-character Side Button style selection.

import { saveSettingsDebounced } from '../../../../../../script.js';
import { getSetting, setSetting } from '../settings.js';
import { cleanAvatar } from '../design/designUtils.js';
import { getChatDesignSettings } from './storage.js';
import { getAppearanceAvatar } from './chatScope.js';

// Add future styles here and define their body-scoped rules in style.css.
const SIDE_BUTTON_STYLES = Object.freeze({
    default: { label: 'Default', bodyClass: 'bd-side-buttons-default' },
    'quiet-rail': { label: 'Quiet Rail', bodyClass: 'bd-side-buttons-quiet-rail' },
    'edge-tabs': { label: 'Edge Tabs', bodyClass: 'bd-side-buttons-edge-tabs' },
    'soft-tiles': { label: 'Soft Tiles', bodyClass: 'bd-side-buttons-soft-tiles' },
    halo: { label: 'Halo', bodyClass: 'bd-side-buttons-halo' },
});
let appliedStyleId = null;

function ensureAssignments() {
    const chatDesign = getChatDesignSettings();
    if (!chatDesign.sideButtonStyleAssignments
        || typeof chatDesign.sideButtonStyleAssignments !== 'object') {
        chatDesign.sideButtonStyleAssignments = {};
    }
    return chatDesign.sideButtonStyleAssignments;
}

export function getSideButtonStyleChoices() {
    return Object.entries(SIDE_BUTTON_STYLES)
        .map(([id, definition]) => ({ id, label: definition.label }));
}

export function isKnownSideButtonStyle(styleId) {
    return Object.hasOwn(SIDE_BUTTON_STYLES, styleId);
}

export function getDefaultSideButtonStyle() {
    const saved = getSetting('sideButtonStyle') || 'default';
    return isKnownSideButtonStyle(saved) ? saved : 'default';
}

export function setDefaultSideButtonStyle(styleId) {
    const normalized = isKnownSideButtonStyle(styleId) ? styleId : 'default';
    setSetting('sideButtonStyle', normalized);

    const drawerSelect = document.querySelector('#bd-side-button-style');
    if (drawerSelect) drawerSelect.value = normalized;
}

export function getSideButtonStyleForCharacter(charAvatar) {
    const assigned = ensureAssignments()[cleanAvatar(charAvatar)];
    return isKnownSideButtonStyle(assigned) ? assigned : '';
}

/** Empty styleId removes the override; "default" explicitly pins stock styling. */
export function setSideButtonStyleForCharacter(charAvatar, styleId) {
    const key = cleanAvatar(charAvatar);
    if (!key) return;

    const assignments = ensureAssignments();
    if (styleId && isKnownSideButtonStyle(styleId)) assignments[key] = styleId;
    else delete assignments[key];
    saveSettingsDebounced();
}

export function resolveSideButtonStyleForCurrentChat() {
    const avatar = getAppearanceAvatar();
    const assigned = avatar ? ensureAssignments()[avatar] : '';
    return isKnownSideButtonStyle(assigned) ? assigned : getDefaultSideButtonStyle();
}

export function applySideButtonStyleForActiveChar() {
    const styleId = resolveSideButtonStyleForCurrentChat();
    const bodyClass = SIDE_BUTTON_STYLES[styleId]?.bodyClass;
    if (appliedStyleId === styleId && (!bodyClass || document.body.classList.contains(bodyClass))) {
        return styleId;
    }

    for (const definition of Object.values(SIDE_BUTTON_STYLES)) {
        if (definition.bodyClass) {
            document.body.classList.toggle(definition.bodyClass, definition.bodyClass === bodyClass);
        }
    }
    appliedStyleId = styleId;
    return styleId;
}
