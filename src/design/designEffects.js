// Optional Character/Persona effects. Legacy solid colors remain independent.
export const DESIGN_EFFECT_KEYS = ['nameGradient', 'boxGradient', 'nameOutlineColor', 'nameOutlineWidth'];

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

export function normalizeDesignEffects(design = {}) {
    return {
        nameGradient: gradient(design.nameGradient, '#cccccc', '#b48ead'),
        boxGradient: gradient(design.boxGradient, '#4a4441', '#252035'),
        nameOutlineColor: color(design.nameOutlineColor, '#000000'),
        nameOutlineWidth: clamp(design.nameOutlineWidth, 0, 5, 0),
    };
}

export function hasDesignEffects(design = {}) {
    const effects = normalizeDesignEffects(design);
    return !!(effects.nameGradient || effects.boxGradient || effects.nameOutlineWidth > 0);
}

function gradientCSS(value) {
    const stop = hex => {
        const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
        return `rgba(${channels.join(', ')}, ${value.opacity})`;
    };
    return `linear-gradient(${value.angle}deg, ${stop(value.start)}, ${stop(value.end)})`;
}

export function buildDesignEffectsCSS(selector, design) {
    const { nameGradient, boxGradient, nameOutlineColor, nameOutlineWidth } = normalizeDesignEffects(design);
    const rules = [];
    const name = [];
    if (nameGradient) {
        name.push(`background-image: ${gradientCSS({ ...nameGradient, opacity: 1 })} !important`,
            'background-color: transparent !important', 'background-repeat: no-repeat !important',
            'background-clip: text !important', '-webkit-background-clip: text !important',
            'color: transparent !important', '-webkit-text-fill-color: transparent !important');
    }
    if (nameOutlineWidth > 0) {
        name.push(`-webkit-text-stroke: ${nameOutlineWidth}px ${nameOutlineColor} !important`,
            'paint-order: stroke fill !important');
    }
    if (name.length) rules.push(`#chat ${selector} .name_text {\n    ${name.join(';\n    ')};\n}`);
    if (boxGradient) {
        // A transparent base avoids applying the legacy box opacity twice.
        rules.push(`#chat ${selector} {\n    background-image: ${gradientCSS(boxGradient)} !important;\n    background-color: transparent !important;\n    background-blend-mode: normal !important;\n}`);
    }
    return rules.join('\n');
}

function gradientControls(key, value, fallback, withOpacity) {
    const current = value || fallback;
    return `<div class="wl-cd-effect" data-wl-effect="${key}">
        <div class="wl-cd-color-row"><label>Gradient</label><div class="wl-cd-color-input-wrap"><label class="wl-cd-effect-toggle"><input type="checkbox" data-effect-enabled ${value ? 'checked' : ''}> Enable</label></div></div>
        <div class="wl-cd-effect-fields" ${value ? '' : 'hidden'}>
            <div class="wl-cd-effect-field wl-cd-effect-field-color"><label>Start</label><div class="wl-cd-color-input-wrap"><input type="color" data-effect-part="start" value="${current.start}"></div></div>
            <div class="wl-cd-effect-field wl-cd-effect-field-color"><label>End</label><div class="wl-cd-color-input-wrap"><input type="color" data-effect-part="end" value="${current.end}"></div></div>
            <div class="wl-cd-effect-field wl-cd-effect-field-range"><label>Direction</label><div class="wl-cd-color-input-wrap"><input type="range" min="0" max="360" step="1" data-effect-part="angle" value="${current.angle}"><output>${current.angle}°</output></div></div>
            ${withOpacity ? `<div class="wl-cd-effect-field wl-cd-effect-field-range"><label>Opacity</label><div class="wl-cd-color-input-wrap"><input type="range" min="0" max="1" step="0.05" data-effect-part="opacity" value="${current.opacity}"><output>${Math.round(current.opacity * 100)}%</output></div></div>` : ''}
        </div>
    </div>`;
}

export function renderDesignEffects(design, kind = 'name') {
    const effects = normalizeDesignEffects(design);
    const box = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(design.boxColor || '');
    const boxStart = box ? '#' + box.slice(1, 4).map(n => Math.round(clamp(n, 0, 255, 0)).toString(16).padStart(2, '0')).join('') : color(design.boxColor, '#4a4441');
    if (kind === 'box') {
        return `<div data-wl-design-effects>${gradientControls('boxGradient', effects.boxGradient, { start: boxStart, end: '#252035', angle: 135, opacity: box ? clamp(box[4] ?? 0.5, 0, 1, 0.5) : 0.5 }, true)}</div>`;
    }
    return `<div data-wl-design-effects>
        ${gradientControls('nameGradient', effects.nameGradient, { start: color(design.nameColor, '#cccccc'), end: '#b48ead', angle: 90 }, false)}
        <div class="wl-cd-outline-fields">
            <div class="wl-cd-effect-field wl-cd-effect-field-color"><label>Outline</label><div class="wl-cd-color-input-wrap"><input type="color" data-outline-color value="${effects.nameOutlineColor}"></div></div>
            <div class="wl-cd-effect-field wl-cd-effect-field-range"><label>Thickness</label><div class="wl-cd-color-input-wrap"><input type="range" data-outline-width min="0" max="5" step="0.25" value="${effects.nameOutlineWidth}"><output>${effects.nameOutlineWidth}px</output></div></div>
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
    if (!width || !outlineColor) return;
    const saveOutline = () => {
        if (!isCurrent()) return;
        width.nextElementSibling.textContent = `${width.value}px`;
        update({ nameOutlineWidth: Number(width.value), nameOutlineColor: outlineColor.value });
    };
    width.addEventListener('input', saveOutline);
    outlineColor.addEventListener('input', saveOutline);
}
