// Character-scoped styling for SillyTavern's native Toastr notifications.

function number(value, min, max, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function color(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}

function rgba(value, opacity, fallback, defaultOpacity = 1) {
    const hex = color(value, fallback);
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
    return `rgba(${channels.join(', ')}, ${number(opacity, 0, 1, defaultOpacity)})`;
}

export function buildToastStyleCSS(properties = {}, { preview = false } = {}) {
    if (properties.toastMode !== 'custom') return '';

    const toast = `body #toast-container > div.toast${preview ? '.wl-cdm-toast-preview' : ''}`;

    const surface = rgba(properties.toastSurfaceColor, properties.toastSurfaceOpacity, '#121214', 0.98);
    const border = rgba(properties.toastBorderColor, properties.toastBorderOpacity, '#ffffff', 0.14);
    const titleDivider = rgba(properties.toastTitleDividerColor, properties.toastTitleDividerOpacity, '#ffffff', 0.22);
    const shadowOpacity = number(properties.toastShadowOpacity, 0, 1, 0.4);
    const shadow = shadowOpacity === 0 ? 'none'
        : `0 ${number(properties.toastShadowOffsetY, -20, 30, 8)}px ${number(properties.toastShadowBlur, 0, 60, 16)}px ${rgba(properties.toastShadowColor, shadowOpacity, '#000000')}`;
    const dividerWidth = number(properties.toastTitleDividerWidth, 0, 4, 1);
    const divider = dividerWidth === 0 ? 'none' : `${dividerWidth}px dashed ${titleDivider}`;
    const accentWidth = number(properties.toastAccentWidth, 0, 12, 4);
    const accentOpacity = number(properties.toastAccentOpacity, 0, 1, 0.95);
    const info = rgba(properties.toastInfoAccentColor, accentOpacity, '#60a5fa');
    const success = rgba(properties.toastSuccessAccentColor, accentOpacity, '#5abe96');
    const warning = rgba(properties.toastWarningAccentColor, accentOpacity, '#f5be46');
    const error = rgba(properties.toastErrorAccentColor, accentOpacity, '#d25050');
    const titleColor = rgba(properties.toastTitleColor, properties.toastTitleOpacity, '#ffffff', 0.92);
    const messageColor = rgba(properties.toastMessageColor, properties.toastMessageOpacity, '#f5f5f5', 0.88);

    // Toastr paints its status icon as a background image on the toast itself.
    // Only change background-color; the left padding keeps both text blocks clear of that image.
    return `/* Native toasts */
${toast} {
    box-sizing: border-box !important;
    width: ${number(properties.toastWidth, 220, 560, 320)}px !important;
    max-width: calc(100vw - 24px) !important;
    background-color: ${surface} !important;
    color: ${messageColor} !important;
    border: ${number(properties.toastBorderWidth, 0, 6, 1)}px solid ${border} !important;
    border-left-width: ${accentWidth}px !important;
    border-radius: ${number(properties.toastRadius, 0, 30, 10)}px !important;
    padding: ${number(properties.toastPaddingY, 4, 24, 10)}px ${number(properties.toastPaddingRight, 6, 36, 12)}px ${number(properties.toastPaddingY, 4, 24, 10)}px ${number(properties.toastIconGutter, 40, 100, 50)}px !important;
    margin-bottom: ${number(properties.toastGap, 0, 24, 8)}px !important;
    box-shadow: ${shadow} !important;
}
${toast}.toast-info { border-left-color: ${info} !important; }
${toast}.toast-success { border-left-color: ${success} !important; }
${toast}.toast-warning { border-left-color: ${warning} !important; }
${toast}.toast-error { border-left-color: ${error} !important; }
${toast} .toast-title {
    color: ${titleColor} !important;
    font-size: ${number(properties.toastTitleSize, 10, 22, 12)}px !important;
    font-weight: ${number(properties.toastTitleWeight, 400, 800, 650)} !important;
    text-transform: ${properties.toastTitleUppercase === false ? 'none' : 'uppercase'} !important;
    letter-spacing: ${number(properties.toastTitleLetterSpacing, 0, 0.2, 0.08)}em !important;
    margin: 0 0 ${number(properties.toastTitleGap, 0, 20, 6)}px !important;
    padding: 0 0 ${number(properties.toastTitleGap, 0, 20, 6)}px !important;
    border-bottom: ${divider} !important;
}
${toast} .toast-message {
    color: ${messageColor} !important;
    font-size: ${number(properties.toastMessageSize, 10, 22, 13)}px !important;
    line-height: ${number(properties.toastMessageLineHeight, 1, 2, 1.4)} !important;
    margin-left: 0 !important;
}
${toast} .toast-close-button {
    color: ${color(properties.toastCloseColor, '#ffffff')} !important;
}`;
}
