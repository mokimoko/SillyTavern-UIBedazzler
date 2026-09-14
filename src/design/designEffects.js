// Optional Character/Persona effects with shared solid/gradient base colors.
export const DESIGN_EFFECT_KEYS = [
    'nameGradient', 'dialogueGradient', 'boxGradient',
    'nameOutlineColor', 'nameOutlineWidth',
];

const DIALOGUE_COLOR_CUSTOM_PROPERTY = '--character-color';

/** Use Dialogue Colorizer Plus when present while retaining UIB's saved color. */
export function dialogueColorCSS(fallback) {
    return `var(${DIALOGUE_COLOR_CUSTOM_PROPERTY}, ${fallback})`;
}

/**
 * Keep clipped gradient paint slightly larger than the text box. Decorative
 * fonts can draw swashes outside their advance box, while long dialogue can
 * split one inline <q> across several line fragments.
 */
export function buildGradientTextDeclarations(backgroundImage) {
    return [
        `background-image: ${backgroundImage} !important`,
        'background-color: transparent !important',
        'background-repeat: no-repeat !important',
        'background-position: center !important',
        'background-size: calc(100% + 0.24em) calc(100% + 0.16em) !important',
        '-webkit-box-decoration-break: clone !important',
        'box-decoration-break: clone !important',
        'background-clip: text !important',
        '-webkit-background-clip: text !important',
        'text-shadow: none !important',
        'color: transparent !important',
        '-webkit-text-fill-color: transparent !important',
    ];
}

const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;

function gradient(value, start, end) {
    if (!value || typeof value !== 'object') return null;
    return {
        start: color(value.start, start), end: color(value.end, end),
        angle: clamp(value.angle, 0, 360, 90), opacity: clamp(value.opacity ?? 1, 0, 1, 1),
    };
}

function rgbaBase(value, fallbackColor = '#4a4441', fallbackOpacity = 0.5) {
    const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(value || '');
    if (!match) return { color: color(value, fallbackColor), opacity: fallbackOpacity };
    const hex = '#' + match.slice(1, 4)
        .map(channel => Math.round(clamp(channel, 0, 255, 0)).toString(16).padStart(2, '0'))
        .join('');
    return { color: hex, opacity: clamp(match[4] ?? 1, 0, 1, fallbackOpacity) };
}

export function normalizeDesignEffects(design = {}) {
    const nameBase = color(design.nameGradient?.start,
        color(design.nameColor, '#cccccc'));
    const dialogueBase = color(design.dialogueGradient?.start,
        color(design.dialogueColor, '#cccccc'));
    const boxBase = rgbaBase(design.boxColor);
    const boxStart = color(design.boxGradient?.start, boxBase.color);
    const boxOpacity = design.boxGradient && Object.hasOwn(design.boxGradient, 'opacity')
        ? clamp(design.boxGradient.opacity, 0, 1, boxBase.opacity)
        : boxBase.opacity;
    return {
        nameGradient: gradient(design.nameGradient, nameBase, '#b48ead'),
        dialogueGradient: gradient(design.dialogueGradient, dialogueBase, '#b48ead'),
        boxGradient: design.boxGradient
            ? { ...gradient(design.boxGradient, boxStart, '#252035'), opacity: boxOpacity }
            : null,
        nameOutlineColor: color(design.nameOutlineColor, '#000000'),
        nameOutlineWidth: clamp(design.nameOutlineWidth, 0, 5, 0),
    };
}

/** Fold legacy gradient-only start/opacity values into their shared solid base. */
export function migrateSharedGradientBases(design = {}) {
    const migrated = { ...design };
    const updates = {};
    const name = design.nameGradient;
    if (name && typeof name === 'object' && Object.hasOwn(name, 'start')) {
        const start = color(name.start, color(design.nameColor, '#cccccc'));
        const next = {
            end: color(name.end, '#b48ead'),
            angle: clamp(name.angle, 0, 360, 90),
        };
        migrated.nameColor = start;
        migrated.nameGradient = next;
        updates.nameColor = start;
        updates.nameGradient = next;
    }

    const dialogue = design.dialogueGradient;
    if (dialogue && typeof dialogue === 'object' && Object.hasOwn(dialogue, 'start')) {
        const start = color(dialogue.start, color(design.dialogueColor, '#cccccc'));
        const next = {
            end: color(dialogue.end, '#b48ead'),
            angle: clamp(dialogue.angle, 0, 360, 90),
        };
        migrated.dialogueColor = start;
        migrated.dialogueGradient = next;
        updates.dialogueColor = start;
        updates.dialogueGradient = next;
    }

    const box = design.boxGradient;
    if (box && typeof box === 'object' &&
        (Object.hasOwn(box, 'start') || Object.hasOwn(box, 'opacity'))) {
        const current = rgbaBase(design.boxColor);
        const start = color(box.start, current.color);
        const opacity = clamp(box.opacity, 0, 1, current.opacity);
        const rgb = [1, 3, 5].map(offset => parseInt(start.slice(offset, offset + 2), 16));
        const boxColor = `rgba(${rgb.join(', ')}, ${opacity})`;
        const next = {
            end: color(box.end, '#252035'),
            angle: clamp(box.angle, 0, 360, 135),
        };
        migrated.boxColor = boxColor;
        migrated.boxGradient = next;
        updates.boxColor = boxColor;
        updates.boxGradient = next;
    }

    return { design: migrated, updates };
}

export function hasDesignEffects(design = {}) {
    const effects = normalizeDesignEffects(design);
    return !!(effects.nameGradient || effects.dialogueGradient ||
        effects.boxGradient || effects.nameOutlineWidth > 0);
}

function gradientStop(value, hex) {
    const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(', ')}, ${value.opacity})`;
}

function gradientCSS(value, startOverride = null) {
    const start = startOverride || gradientStop(value, value.start);
    return `linear-gradient(${value.angle}deg, ${start}, ${gradientStop(value, value.end)})`;
}

export function buildDesignEffectsCSS(selector, design) {
    const {
        nameGradient, dialogueGradient, boxGradient,
        nameOutlineColor, nameOutlineWidth,
    } = normalizeDesignEffects(design);
    const rules = [];
    const name = [];
    if (nameGradient) {
        name.push(...buildGradientTextDeclarations(gradientCSS({ ...nameGradient, opacity: 1 })));
    }
    if (nameOutlineWidth > 0) {
        name.push(`-webkit-text-stroke: ${nameOutlineWidth}px ${nameOutlineColor} !important`,
            'paint-order: stroke fill !important');
    }
    if (name.length) rules.push(`#chat ${selector} .name_text {\n    ${name.join(';\n    ')};\n}`);
    if (dialogueGradient) {
        const normalized = { ...dialogueGradient, opacity: 1 };
        const fallbackStart = gradientStop(normalized, normalized.start);
        const backgroundImage = gradientCSS(normalized, dialogueColorCSS(fallbackStart));
        rules.push(`#chat ${selector} q {\n    ${buildGradientTextDeclarations(backgroundImage).join(';\n    ')};\n}`);
    }
    if (boxGradient) {
        // A transparent base avoids applying the legacy box opacity twice.
        rules.push(`#chat ${selector} {\n    background-image: ${gradientCSS(boxGradient)} !important;\n    background-color: transparent !important;\n    background-blend-mode: normal !important;\n}`);
    }
    return rules.join('\n');
}

/** Compact shared-base editor used by Dialogue and Message Background cards. */
export function renderSharedGradientCard({
    key, title, enabled, baseId, baseColor, baseTrailing = '', end, angle, footer = '',
}) {
    return `<div class="wl-cd-color-group wl-cd-gradient-card" data-wl-design-effects>
        <div class="wl-cd-effect wl-cd-effect-shared ${enabled ? 'wl-cd-effect-enabled' : ''}" data-wl-effect="${key}">
            <div class="wl-cd-color-card-head">
                <div class="wl-cd-color-group-title">${title}</div>
                <label class="wl-cd-effect-toggle"><input type="checkbox" data-effect-enabled ${enabled ? 'checked' : ''}> Gradient</label>
            </div>
            <div class="wl-cd-effect-field wl-cd-effect-field-color wl-cd-effect-base">
                <label data-wl-shared-color-label="${key}">${enabled ? 'Start' : 'Solid'}</label>
                <div class="wl-cd-color-input-wrap">
                    <input type="color" id="${baseId}" value="${baseColor}">
                    ${baseTrailing}
                </div>
            </div>
            <div class="wl-cd-effect-fields" ${enabled ? '' : 'hidden'}>
                <div class="wl-cd-effect-field wl-cd-effect-field-color">
                    <label>End</label>
                    <div class="wl-cd-color-input-wrap"><input type="color" data-effect-part="end" value="${end}"></div>
                </div>
                <div class="wl-cd-effect-field wl-cd-effect-field-range">
                    <label>Direction</label>
                    <div class="wl-cd-color-input-wrap"><input type="range" min="0" max="360" step="1" data-effect-part="angle" value="${angle}"><output>${angle}°</output></div>
                </div>
            </div>
            ${footer}
        </div>
    </div>`;
}

/** Name uses the same shared Solid/Start model while retaining outline controls. */
export function renderNameColorCard({
    baseId, baseColor, baseText, enabled, end, angle, outlineColor, outlineWidth,
}) {
    return `<div class="wl-cd-color-group" data-wl-design-effects>
        <div class="wl-cd-effect wl-cd-effect-shared wl-cd-effect-name ${enabled ? 'wl-cd-effect-enabled' : ''}" data-wl-effect="nameGradient">
            <div class="wl-cd-color-card-head">
                <div class="wl-cd-color-group-title">Name</div>
                <label class="wl-cd-effect-toggle"><input type="checkbox" data-effect-enabled ${enabled ? 'checked' : ''}> Gradient</label>
            </div>
            <div class="wl-cd-effect-field wl-cd-effect-field-color wl-cd-effect-base">
                <label data-wl-shared-color-label="nameGradient">${enabled ? 'Start' : 'Solid'}</label>
                <div class="wl-cd-color-input-wrap">
                    <input type="color" id="${baseId}" value="${baseColor}">
                    <span class="wl-cd-color-hex">${baseText}</span>
                </div>
            </div>
            <div class="wl-cd-effect-fields" ${enabled ? '' : 'hidden'}>
                <div class="wl-cd-effect-field wl-cd-effect-field-color">
                    <label>End</label>
                    <div class="wl-cd-color-input-wrap"><input type="color" data-effect-part="end" value="${end}"></div>
                </div>
                <div class="wl-cd-effect-field wl-cd-effect-field-range">
                    <label>Direction</label>
                    <div class="wl-cd-color-input-wrap"><input type="range" min="0" max="360" step="1" data-effect-part="angle" value="${angle}"><output>${angle}°</output></div>
                </div>
            </div>
            <div class="wl-cd-outline-fields">
                <div class="wl-cd-effect-field wl-cd-effect-field-color"><label>Outline</label><div class="wl-cd-color-input-wrap"><input type="color" data-outline-color value="${outlineColor}"></div></div>
                <div class="wl-cd-effect-field wl-cd-effect-field-range"><label>Thickness</label><div class="wl-cd-color-input-wrap"><input type="range" data-outline-width min="0" max="5" step="0.25" value="${outlineWidth}"><output>${outlineWidth}px</output></div></div>
            </div>
        </div>
    </div>`;
}

export function wireDesignEffects(pane, update, isCurrent = () => true) {
    const roots = pane.querySelectorAll('[data-wl-design-effects]');
    if (!roots.length) return;
    roots.forEach(root => root.querySelectorAll('[data-wl-effect]').forEach(group => {
        const enabled = group.querySelector('[data-effect-enabled]');
        const fields = group.querySelector('.wl-cd-effect-fields');
        const save = () => {
            if (!isCurrent()) return;
            fields.hidden = !enabled.checked;
            group.classList.toggle('wl-cd-effect-enabled', enabled.checked);
            const sharedLabel = pane.querySelector(`[data-wl-shared-color-label="${group.dataset.wlEffect}"]`);
            if (sharedLabel) sharedLabel.textContent = enabled.checked ? 'Start' : 'Solid';
            const value = {};
            group.querySelectorAll('[data-effect-part]').forEach(input => {
                const part = input.dataset.effectPart;
                value[part] = input.type === 'range' ? Number(input.value) : input.value;
                const output = input.nextElementSibling;
                if (output?.tagName === 'OUTPUT') output.textContent = part === 'opacity' ? `${Math.round(value[part] * 100)}%` : `${value[part]}°`;
            });
            update({ [group.dataset.wlEffect]: enabled.checked ? value : null });
        };
        enabled.addEventListener('change', save);
        fields.addEventListener('input', save);
    }));
    const width = pane.querySelector('[data-outline-width]');
    const outlineColor = pane.querySelector('[data-outline-color]');
    if (width && outlineColor) {
        const saveOutline = () => {
            if (!isCurrent()) return;
            width.nextElementSibling.textContent = `${width.value}px`;
            update({ nameOutlineWidth: Number(width.value), nameOutlineColor: outlineColor.value });
        };
        width.addEventListener('input', saveOutline);
        outlineColor.addEventListener('input', saveOutline);
    }

}
