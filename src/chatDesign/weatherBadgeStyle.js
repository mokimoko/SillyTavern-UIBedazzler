// Character-scoped presentation overrides for st-weather-cycle's status badge.

const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const validHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;

function hexToRgba(hex, alpha) {
    const value = validHex(hex, '#000000').slice(1);
    const channels = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(', ')}, ${clamp(alpha, 0, 1, 1)})`;
}

/** Build a no-op or a complete, safely bounded badge appearance. */
export function buildWeatherBadgeCSS(properties = {}) {
    if (properties.weatherBadgeMode !== 'custom') return '';

    const themePalette = properties.weatherBadgePalette !== 'custom';
    const backgroundOpacity = clamp(properties.weatherBadgeBackgroundOpacity, 0, 1, 0.82);
    const borderOpacity = clamp(properties.weatherBadgeBorderOpacity, 0, 1, 0.18);
    const customText = validHex(properties.weatherBadgeTextColor, '#f5f2f8');
    const background = themePalette
        ? `color-mix(in srgb, var(--SmartThemeBlurTintColor, #14141c) ${Math.round(backgroundOpacity * 100)}%, transparent)`
        : hexToRgba(properties.weatherBadgeBackgroundColor, backgroundOpacity);
    const color = themePalette ? 'var(--SmartThemeBodyColor, #f5f2f8)' : customText;
    const border = themePalette
        ? `color-mix(in srgb, var(--SmartThemeBorderColor, #888888) ${Math.round(borderOpacity * 100)}%, transparent)`
        : hexToRgba(properties.weatherBadgeBorderColor, borderOpacity);
    const shadow = {
        none: 'none',
        soft: '0 6px 18px rgba(0, 0, 0, 0.24)',
        float: '0 12px 30px rgba(0, 0, 0, 0.36)',
        glow: `0 0 18px color-mix(in srgb, ${color} 24%, transparent)`,
    }[properties.weatherBadgeShadow] || 'none';
    const customFont = Object.prototype.hasOwnProperty.call(properties, 'weatherBadgeFontUseCustom')
        ? properties.weatherBadgeFontUseCustom === true
        : properties.weatherBadgeFont === 'mono';
    const fontFamily = customFont && properties.weatherBadgeFont === 'mono'
        ? 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace'
        : 'inherit';

    return `#st-weather-cycle-badge {
    box-sizing: border-box !important;
    padding: ${clamp(properties.weatherBadgePaddingY, 0, 20, 6)}px ${clamp(properties.weatherBadgePaddingX, 0, 28, 10)}px !important;
    border: ${clamp(properties.weatherBadgeBorderWidth, 0, 4, 1)}px solid ${border} !important;
    border-radius: ${clamp(properties.weatherBadgeRadius, 0, 64, 10)}px !important;
    background: ${background} !important;
    color: ${color} !important;
    font-family: ${fontFamily} !important;
    font-size: ${clamp(properties.weatherBadgeFontSize, 10, 24, 13)}px !important;
    font-weight: ${clamp(properties.weatherBadgeFontWeight, 300, 800, 500)} !important;
    letter-spacing: ${clamp(properties.weatherBadgeLetterSpacing, -0.5, 2, 0)}px !important;
    line-height: 1.25 !important;
    box-shadow: ${shadow} !important;
    backdrop-filter: blur(${clamp(properties.weatherBadgeBlur, 0, 24, 8)}px) !important;
    -webkit-backdrop-filter: blur(${clamp(properties.weatherBadgeBlur, 0, 24, 8)}px) !important;
}`;
}
