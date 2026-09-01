// src/chatDesign/iconSwitch.js
// Per-character General + Top Bar icon-set switching.

import { getContext } from '../../../../../extensions.js';
import { getSetting, setSetting } from '../settings.js';
import { applyIconSetSelection, getIconSetChoices, isKnownIconSet } from '../cuteLoader.js';
import { getChatDesignSettings } from './storage.js';
import { cleanAvatar } from '../design/designUtils.js';
import { saveSettingsDebounced } from '../../../../../../script.js';

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

function getActiveCharacterAvatar() {
    const ctx = getContext();
    if (ctx.groupId) return null;
    const chid = ctx.characterId;
    if (chid == null) return null;
    return cleanAvatar(ctx.characters?.[chid]?.avatar || '');
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

export function resolveIconSetsForCurrentChat() {
    const avatar = getActiveCharacterAvatar();
    const assigned = avatar ? ensureIconShape().iconAssignments[avatar] || {} : {};
    return Object.fromEntries(ICON_AXES.map(axis => {
        const override = assigned[axis];
        return [axis, isKnownIconSet(axis, override) ? override : getDefaultIconSet(axis)];
    }));
}

export async function applyIconSetsForActiveChar() {
    const resolved = resolveIconSetsForCurrentChat();
    try {
        await Promise.all(ICON_AXES.map(axis => applyIconSetSelection(axis, resolved[axis])));
    } catch (error) {
        console.error('[BD] Failed to apply icon sets:', error);
    }
}
