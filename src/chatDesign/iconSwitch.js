// src/chatDesign/iconSwitch.js
// Per-character General + Top Bar icon-set switching.

import { getSetting, setSetting } from '../settings.js';
import { applyIconSetSelection, getIconSetChoices, isKnownIconSet } from '../cuteLoader.js';
import { getChatDesignSettings } from './storage.js';
import { cleanAvatar } from '../design/designUtils.js';
import { saveSettingsDebounced } from '../../../../../../script.js';
import { getAppearanceAvatar } from './chatScope.js';
import {
    getFirstCustomTopbarSetId,
    isCustomTopbarSetId,
} from '../customTopbarIcons.js';

export const ICON_AXES = Object.freeze(['general', 'topbar']);

const SETTING_KEY = Object.freeze({
    general: 'generalIconSet',
    topbar: 'topbarIconSet',
});

function ensureIconShape() {
    const cd = getChatDesignSettings();
    if (!cd.iconAssignments || typeof cd.iconAssignments !== 'object') {
        cd.iconAssignments = {};
    }
    return cd;
}

export function getIconChoices(axis) {
    return getIconSetChoices(axis);
}

export function getDefaultIconSet(axis) {
    const saved = getSetting(SETTING_KEY[axis]) || 'default';
    return isKnownIconSet(axis, saved) ? saved : 'default';
}

export function setDefaultIconSet(axis, setId) {
    if (!SETTING_KEY[axis]) return;
    const normalized = isKnownIconSet(axis, setId) ? setId : 'default';
    setSetting(SETTING_KEY[axis], normalized);

    // Keep the original extension-drawer controls truthful when defaults are
    // changed from Chat Design.
    const drawerSelect = document.querySelector(`#bd-iconset-${axis}`);
    if (drawerSelect) drawerSelect.value = normalized;
}

export function getDefaultCustomTopbarSetId() {
    const saved = getSetting('topbarCustomSetId') || '';
    return isCustomTopbarSetId(saved) ? saved : getFirstCustomTopbarSetId();
}

export function setDefaultCustomTopbarSetId(setId) {
    const normalized = isCustomTopbarSetId(setId) ? setId : getFirstCustomTopbarSetId();
    setSetting('topbarCustomSetId', normalized);
    const drawerSelect = document.querySelector('#bd-custom-icon-set');
    if (drawerSelect) drawerSelect.value = normalized;
}

export function getIconSetForCharacter(charAvatar, axis) {
    if (!ICON_AXES.includes(axis)) return '';
    const key = cleanAvatar(charAvatar);
    const assigned = ensureIconShape().iconAssignments[key]?.[axis];
    return isKnownIconSet(axis, assigned) ? assigned : '';
}

/** Empty setId removes the override; "default" explicitly chooses stock/match. */
export function setIconSetForCharacter(charAvatar, axis, setId) {
    if (!ICON_AXES.includes(axis)) return;
    const key = cleanAvatar(charAvatar);
    if (!key) return;

    const cd = ensureIconShape();
    const current = cd.iconAssignments[key] || {};
    if (setId && isKnownIconSet(axis, setId)) current[axis] = setId;
    else delete current[axis];

    if (Object.keys(current).length > 0) cd.iconAssignments[key] = current;
    else delete cd.iconAssignments[key];
    saveSettingsDebounced();
}

export function getCustomTopbarSetForCharacter(charAvatar) {
    const key = cleanAvatar(charAvatar);
    const assigned = ensureIconShape().iconAssignments[key]?.topbarCustomSetId;
    return isCustomTopbarSetId(assigned) ? assigned : '';
}

export function setCustomTopbarSetForCharacter(charAvatar, setId) {
    const key = cleanAvatar(charAvatar);
    if (!key) return;
    const cd = ensureIconShape();
    const current = cd.iconAssignments[key] || {};
    if (isCustomTopbarSetId(setId)) current.topbarCustomSetId = setId;
    else delete current.topbarCustomSetId;
    if (Object.keys(current).length > 0) cd.iconAssignments[key] = current;
    else delete cd.iconAssignments[key];
    saveSettingsDebounced();
}

export function resolveIconSetsForCurrentChat() {
    const avatar = getAppearanceAvatar();
    const assigned = avatar ? ensureIconShape().iconAssignments[avatar] || {} : {};
    const resolved = Object.fromEntries(ICON_AXES.map(axis => {
        const override = assigned[axis];
        return [axis, isKnownIconSet(axis, override) ? override : getDefaultIconSet(axis)];
    }));
    const characterCustom = isCustomTopbarSetId(assigned.topbarCustomSetId) ? assigned.topbarCustomSetId : '';
    resolved.topbarCustomSetId = resolved.topbar === 'custom'
        ? characterCustom || getDefaultCustomTopbarSetId()
        : '';
    return resolved;
}

export async function applyIconSetsForActiveChar() {
    const resolved = resolveIconSetsForCurrentChat();
    try {
        await Promise.all(ICON_AXES.map(axis => applyIconSetSelection(
            axis,
            resolved[axis],
            axis === 'topbar' ? resolved.topbarCustomSetId : '',
        )));
    } catch (error) {
        console.error('[BD] Failed to apply icon sets:', error);
    }
}
