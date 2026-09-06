// Automatic compatibility treatment for SillyTavern's dark-oriented native UI.

import { eventSource, event_types } from '../../../../../script.js';

import { getSetting } from './settings.js';

const BODY_CLASS = 'bd-light-theme-compat';
// Matches the light/dark boundary used by ST's own theme palette generator.
const LIGHT_SURFACE_THRESHOLD = 0.30;

let initialized = false;
let themeObserver = null;
let reconcileFrame = 0;

/** Parse the RGB channels from the color formats ST writes to theme variables. */
function parseCssColor(value) {
    const source = String(value || '').trim();
    const hex = source.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
    if (hex) {
        let digits = hex[1];
        if (digits.length === 3) digits = digits.split('').map(char => char + char).join('');
        return {
            r: parseInt(digits.slice(0, 2), 16),
            g: parseInt(digits.slice(2, 4), 16),
            b: parseInt(digits.slice(4, 6), 16),
        };
    }

    const rgb = source.match(/^rgba?\(\s*([\d.]+)%?[,\s]+([\d.]+)%?[,\s]+([\d.]+)%?/i);
    if (!rgb) return null;

    const percentages = source.match(/^rgba?\(\s*[\d.]+%/i);
    const scale = percentages ? 2.55 : 1;
    return {
        r: Math.min(255, Number(rgb[1]) * scale),
        g: Math.min(255, Number(rgb[2]) * scale),
        b: Math.min(255, Number(rgb[3]) * scale),
    };
}

function srgbChannelToLinear(channel) {
    const normalized = channel / 255;
    return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance gives saturated and muted theme colors stable results. */
function relativeLuminance({ r, g, b }) {
    return (0.2126 * srgbChannelToLinear(r))
        + (0.7152 * srgbChannelToLinear(g))
        + (0.0722 * srgbChannelToLinear(b));
}

function activeThemeHasLightSurface() {
    const styles = getComputedStyle(document.documentElement);
    const tint = parseCssColor(styles.getPropertyValue('--SmartThemeBlurTintColor'));
    return tint ? relativeLuminance(tint) >= LIGHT_SURFACE_THRESHOLD : false;
}

function reconcileLightThemeCompat() {
    reconcileFrame = 0;
    const enabled = !!getSetting('lightThemeCompat');
    document.body.classList.toggle(BODY_CLASS, enabled && activeThemeHasLightSurface());
}

function scheduleReconcile() {
    if (reconcileFrame) cancelAnimationFrame(reconcileFrame);
    reconcileFrame = requestAnimationFrame(reconcileLightThemeCompat);
}

/** Apply the setting immediately when its extensions-drawer toggle changes. */
export function onLightThemeCompatToggleChanged() {
    scheduleReconcile();
}

export function initLightThemeCompat() {
    if (initialized) return;
    initialized = true;

    // Theme pickers and full theme loads both rewrite the root style attribute.
    themeObserver = new MutationObserver(scheduleReconcile);
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style'],
    });

    // Also covers custom CSS and settings flows that change computed variables
    // without directly modifying the root style attribute.
    eventSource.on(event_types.SETTINGS_UPDATED, scheduleReconcile);
    eventSource.on(event_types.CHAT_CHANGED, scheduleReconcile);

    reconcileLightThemeCompat();
}
