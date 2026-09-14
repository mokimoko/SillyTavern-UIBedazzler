// Compact per-character dialogue color editor hosted in SillyTavern's tag row.

import { eventSource, event_types } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { migrateSharedGradientBases, normalizeDesignEffects } from '../design/designEffects.js';
import { getDesignData, updateCharExtensions } from './storage.js';
import { updateCharacterDesignPreview } from './designTab.js';

const TRIGGER_ID = 'wl-cd-dialogue-picker';
const POPOVER_ID = 'wl-cd-dialogue-popover';
const DEFAULT_COLOR = '#cccccc';

let initialized = false;
let state = null;
let nativePanelObserver = null;
let ensureFrame = null;
let ensureRetry = null;

const normalizeHex = value => /^#[0-9a-f]{6}$/i.test(value || '')
    ? value.toLowerCase()
    : null;

function currentTarget() {
    const context = getContext();
    const selected = context.characters?.[context.characterId];
    const editorAvatar = String(document.getElementById('avatar_url_pole')?.value || '').trim();
    const avatarKey = value => {
        const clean = String(value || '').split(/[?#]/, 1)[0].replaceAll('\\', '/');
        const filename = clean.slice(clean.lastIndexOf('/') + 1);
        try { return decodeURIComponent(filename).toLowerCase(); } catch { return filename.toLowerCase(); }
    };
    const editorKey = avatarKey(editorAvatar);
    const character = editorKey
        ? context.characters?.find(candidate => avatarKey(candidate?.avatar) === editorKey)
        : selected;
    const resolved = character || selected;
    const avatar = resolved?.avatar || editorAvatar;
    return avatar ? { avatar, name: resolved?.name || '' } : null;
}

function gradientValue() {
    return state?.gradient
        ? { end: state.end, angle: state.angle }
        : null;
}

function fillForDesign(design) {
    const effects = normalizeDesignEffects(design);
    if (effects.dialogueGradient) {
        const gradient = effects.dialogueGradient;
        return `linear-gradient(${gradient.angle}deg, ${gradient.start}, ${gradient.end})`;
    }
    const solid = normalizeHex(design.dialogueColor);
    return solid
        ? `linear-gradient(${solid}, ${solid})`
        : 'linear-gradient(var(--SmartThemeQuoteColor, #cccccc), var(--SmartThemeQuoteColor, #cccccc))';
}

function refreshTrigger(design = null) {
    const trigger = document.getElementById(TRIGGER_ID);
    if (!trigger) return;
    const target = currentTarget();
    trigger.disabled = false;
    trigger.setAttribute('aria-disabled', String(!target));
    trigger.classList.toggle('wl-cd-dialogue-picker-disabled', !target);
    const current = design || (target ? getDesignData() : {});
    trigger.style.setProperty('--wl-dialogue-picker-fill', fillForDesign(current));
    trigger.title = normalizeDesignEffects(current).dialogueGradient
        ? 'Dialogue color (gradient)'
        : 'Dialogue color';
}

function renderPopover() {
    const popover = document.getElementById(POPOVER_ID);
    if (!popover || !state) return;
    const base = popover.querySelector('[data-wl-dialogue-base]');
    const baseHex = popover.querySelector('[data-wl-dialogue-base-hex]');
    const gradient = popover.querySelector('[data-wl-dialogue-gradient]');
    const gradientFields = popover.querySelector('[data-wl-dialogue-gradient-fields]');
    const end = popover.querySelector('[data-wl-dialogue-end]');
    const endHex = popover.querySelector('[data-wl-dialogue-end-hex]');
    const angle = popover.querySelector('[data-wl-dialogue-angle]');
    const angleOutput = popover.querySelector('[data-wl-dialogue-angle-output]');
    const baseLabel = popover.querySelector('[data-wl-dialogue-base-label]');
    const colorFields = popover.querySelector('[data-wl-dialogue-color-fields]');
    const endField = popover.querySelector('[data-wl-dialogue-end-field]');

    base.value = state.base;
    baseHex.value = state.base;
    gradient.checked = state.gradient;
    gradientFields.hidden = !state.gradient;
    endField.hidden = !state.gradient;
    colorFields.classList.toggle('wl-cd-dialogue-color-fields-gradient', state.gradient);
    end.value = state.end;
    endHex.value = state.end;
    angle.value = String(state.angle);
    angleOutput.textContent = `${state.angle}°`;
    baseLabel.textContent = state.gradient ? 'Start color' : 'Solid color';
    popover.style.setProperty('--wl-dialogue-picker-fill', state.gradient
        ? `linear-gradient(${state.angle}deg, ${state.base}, ${state.end})`
        : `linear-gradient(${state.base}, ${state.base})`);
}

function persist(updates) {
    if (!state || currentTarget()?.avatar !== state.avatar) {
        closePopover();
        return;
    }
    Object.assign(state.design, updates);
    const storedUpdates = { ...updates };
    if (Object.hasOwn(storedUpdates, 'dialogueGradient')) {
        storedUpdates['wl_design.dialogueGradient'] = storedUpdates.dialogueGradient;
        delete storedUpdates.dialogueGradient;
    }
    updateCharExtensions(storedUpdates);
    updateCharacterDesignPreview(state.design, state.avatar);
    refreshTrigger(state.design);
}

function saveBase(value) {
    const color = normalizeHex(value);
    if (!color) return false;
    state.base = color;
    persist({ dialogueColor: color });
    renderPopover();
    return true;
}

function saveEnd(value) {
    const color = normalizeHex(value);
    if (!color) return false;
    state.end = color;
    const dialogueGradient = gradientValue();
    state.design.dialogueGradient = dialogueGradient;
    persist({ dialogueGradient });
    renderPopover();
    return true;
}

function positionPopover() {
    const trigger = document.getElementById(TRIGGER_ID);
    const popover = document.getElementById(POPOVER_ID);
    if (!trigger || !popover || popover.hidden) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 7;
    const width = Math.min(380, window.innerWidth - 16);
    popover.style.width = `${width}px`;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left));
    const below = rect.bottom + gap;
    const top = below + popover.offsetHeight <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - popover.offsetHeight - gap);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

function closePopover() {
    const popover = document.getElementById(POPOVER_ID);
    const trigger = document.getElementById(TRIGGER_ID);
    if (popover) popover.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    state = null;
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', positionPopover);
    window.removeEventListener('scroll', positionPopover, true);
}

function onOutsidePointer(event) {
    if (event.target.closest(`#${TRIGGER_ID}, #${POPOVER_ID}`)) return;
    closePopover();
}

function onKeydown(event) {
    if (event.key === 'Escape') closePopover();
}

function openPopover() {
    const target = currentTarget();
    if (!target) return;
    const migration = migrateSharedGradientBases(getDesignData());
    if (Object.keys(migration.updates).length) {
        const updates = {};
        for (const [key, value] of Object.entries(migration.updates)) {
            updates[key.endsWith('Gradient') ? `wl_design.${key}` : key] = value;
        }
        updateCharExtensions(updates);
    }
    const design = migration.design;
    const effects = normalizeDesignEffects(design);
    state = {
        avatar: target.avatar,
        design,
        base: effects.dialogueGradient?.start || normalizeHex(design.dialogueColor) || DEFAULT_COLOR,
        end: effects.dialogueGradient?.end || '#b48ead',
        angle: effects.dialogueGradient?.angle ?? 90,
        gradient: !!effects.dialogueGradient,
    };

    const popover = document.getElementById(POPOVER_ID);
    const trigger = document.getElementById(TRIGGER_ID);
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    renderPopover();
    requestAnimationFrame(positionPopover);
    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
}

function createPopover() {
    if (document.getElementById(POPOVER_ID)) return;
    const popover = document.createElement('div');
    popover.id = POPOVER_ID;
    popover.className = 'wl-cd-dialogue-popover';
    popover.hidden = true;
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Dialogue color');
    popover.innerHTML = `
        <div class="wl-cd-dialogue-popover-title">
            <span class="wl-cd-dialogue-picker-icon" aria-hidden="true"></span>
            <span>Dialogue Color</span>
        </div>
        <label class="checkbox_label wl-cd-dialogue-gradient-toggle">
            <input type="checkbox" data-wl-dialogue-gradient>
            <span>Gradient</span>
        </label>
        <div class="wl-cd-dialogue-color-fields" data-wl-dialogue-color-fields>
            <label class="wl-cd-dialogue-popover-field">
                <span data-wl-dialogue-base-label>Solid color</span>
                <span class="wl-cd-dialogue-popover-color">
                    <input type="color" data-wl-dialogue-base value="${DEFAULT_COLOR}">
                    <input type="text" class="text_pole" data-wl-dialogue-base-hex value="${DEFAULT_COLOR}" maxlength="7" spellcheck="false">
                </span>
            </label>
            <label class="wl-cd-dialogue-popover-field" data-wl-dialogue-end-field hidden>
                <span>End color</span>
                <span class="wl-cd-dialogue-popover-color">
                    <input type="color" data-wl-dialogue-end value="#b48ead">
                    <input type="text" class="text_pole" data-wl-dialogue-end-hex value="#b48ead" maxlength="7" spellcheck="false">
                </span>
            </label>
        </div>
        <div class="wl-cd-dialogue-gradient-fields" data-wl-dialogue-gradient-fields hidden>
            <label class="wl-cd-dialogue-popover-field">
                <span>Direction <output data-wl-dialogue-angle-output>90°</output></span>
                <input type="range" min="0" max="360" step="1" value="90" data-wl-dialogue-angle>
            </label>
        </div>
        <button type="button" class="menu_button wl-cd-dialogue-default" data-wl-dialogue-default>
            <i class="fa-solid fa-rotate-left"></i> Use Theme Default
        </button>`;
    document.body.appendChild(popover);

    const base = popover.querySelector('[data-wl-dialogue-base]');
    const baseHex = popover.querySelector('[data-wl-dialogue-base-hex]');
    const gradient = popover.querySelector('[data-wl-dialogue-gradient]');
    const end = popover.querySelector('[data-wl-dialogue-end]');
    const endHex = popover.querySelector('[data-wl-dialogue-end-hex]');
    const angle = popover.querySelector('[data-wl-dialogue-angle]');

    base.addEventListener('input', () => saveBase(base.value));
    baseHex.addEventListener('change', () => {
        if (!saveBase(baseHex.value)) baseHex.value = state?.base || DEFAULT_COLOR;
    });
    gradient.addEventListener('change', () => {
        state.gradient = gradient.checked;
        const dialogueGradient = gradientValue();
        state.design.dialogueGradient = dialogueGradient;
        persist({ dialogueGradient });
        renderPopover();
    });
    end.addEventListener('input', () => saveEnd(end.value));
    endHex.addEventListener('change', () => {
        if (!saveEnd(endHex.value)) endHex.value = state?.end || '#b48ead';
    });
    angle.addEventListener('input', () => {
        state.angle = Math.min(360, Math.max(0, Number(angle.value) || 0));
        const dialogueGradient = gradientValue();
        state.design.dialogueGradient = dialogueGradient;
        persist({ dialogueGradient });
        renderPopover();
    });
    popover.querySelector('[data-wl-dialogue-default]').addEventListener('click', () => {
        state.gradient = false;
        state.base = DEFAULT_COLOR;
        state.design.dialogueColor = null;
        state.design.dialogueGradient = null;
        updateCharExtensions({ dialogueColor: null, 'wl_design.dialogueGradient': null });
        updateCharacterDesignPreview(state.design, state.avatar);
        refreshTrigger(state.design);
        closePopover();
    });
}

function ensureTrigger() {
    const tags = document.getElementById('tags_div');
    const tagInput = tags?.querySelector('#tagInput, input[placeholder*="tag" i]');
    const controls = tagInput?.closest('.tag_controls') || tagInput?.parentElement;
    if (!controls || !tagInput) return false;
    let trigger = document.getElementById(TRIGGER_ID);
    if (!trigger) {
        trigger = document.createElement('button');
        trigger.id = TRIGGER_ID;
        trigger.type = 'button';
        trigger.className = 'menu_button wl-cd-dialogue-picker';
        trigger.title = 'Dialogue color';
        trigger.setAttribute('aria-label', 'Dialogue color');
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.innerHTML = '<span class="wl-cd-dialogue-picker-icon" aria-hidden="true"></span>';
        trigger.addEventListener('click', () => {
            const popover = document.getElementById(POPOVER_ID);
            if (popover?.hidden) openPopover();
            else closePopover();
        });
    }
    if (trigger.parentElement !== controls || trigger.nextElementSibling !== tagInput) {
        controls.insertBefore(trigger, tagInput);
    }
    createPopover();
    refreshTrigger();
    return true;
}

function scheduleEnsure() {
    if (ensureFrame != null) cancelAnimationFrame(ensureFrame);
    if (ensureRetry != null) clearTimeout(ensureRetry);
    ensureFrame = requestAnimationFrame(() => {
        ensureFrame = null;
        if (ensureTrigger()) return;
        // The native editor can populate just after its drawer-open class flips.
        // One bounded retry avoids a broad observer over the editable form.
        ensureRetry = setTimeout(() => {
            ensureRetry = null;
            ensureTrigger();
        }, 100);
    });
}

function watchNativeCharacterDrawer() {
    const panel = document.getElementById('right-nav-panel');
    if (!panel || nativePanelObserver) return;
    nativePanelObserver = new MutationObserver(() => {
        if (panel.classList.contains('openDrawer')) scheduleEnsure();
    });
    nativePanelObserver.observe(panel, {
        attributes: true,
        attributeFilter: ['class'],
    });
}

export function initDialogueColorPicker() {
    if (initialized) return;
    initialized = true;
    const refresh = () => {
        closePopover();
        watchNativeCharacterDrawer();
        scheduleEnsure();
    };
    watchNativeCharacterDrawer();
    scheduleEnsure();
    eventSource.on(event_types.CHAT_CHANGED, refresh);
    if (event_types.CHARACTER_EDITED) eventSource.on(event_types.CHARACTER_EDITED, refresh);
    if (event_types.CHARACTER_PAGE_LOADED) eventSource.on(event_types.CHARACTER_PAGE_LOADED, refresh);
}
