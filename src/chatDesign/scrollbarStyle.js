// Character-scoped scrollbar styling for Chromium/WebKit and Firefox.

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function color(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}

function rgba(value, opacity, fallback) {
    const hex = color(value, fallback);
    const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(', ')}, ${clampNumber(opacity, 0, 1, 1)})`;
}

export function resolveScrollbarStyle(properties = {}) {
    const width = Math.round(clampNumber(properties.scrollbarWidth, 4, 24, 10));
    const radius = Math.round(clampNumber(properties.scrollbarRadius, 0, 20, 8));
    const insetLimit = Math.max(0, Math.floor((width - 2) / 2));
    const inset = Math.round(clampNumber(properties.scrollbarInset, 0, Math.min(4, insetLimit), 2));
    const thumb = rgba(properties.scrollbarThumbColor, properties.scrollbarThumbOpacity, '#7aa2f7');
    const thumbHover = color(properties.scrollbarThumbHoverColor, '#a9c1ff');
    const thumbBorder = color(properties.scrollbarThumbBorderColor, '#dbe6ff');
    const thumbHoverBorder = color(properties.scrollbarThumbHoverBorderColor, '#ffffff');
    const track = rgba(properties.scrollbarTrackColor, properties.scrollbarTrackOpacity, '#171a21');
    const firefoxWidth = width <= 10 ? 'thin' : 'auto';
    const surface = (prefix, start, opacity, fallback) => properties[`${prefix}Fill`] === 'gradient'
        ? `linear-gradient(${clampNumber(properties[`${prefix}Angle`], 0, 360, 180)}deg, ${start}, ${rgba(properties[`${prefix}EndColor`], opacity, fallback)})`
        : start;
    return { width, radius, inset, thumb, thumbHover, thumbBorder, thumbHoverBorder, track, firefoxWidth,
        thumbSurface: surface('scrollbarThumb', thumb, properties.scrollbarThumbOpacity, '#b48ead'),
        hoverSurface: surface('scrollbarThumbHover', thumbHover, 1, '#d8b4fe'),
        trackSurface: surface('scrollbarTrack', track, properties.scrollbarTrackOpacity, '#343b50'),
    };
}

export function buildScrollbarStyleCSS(properties = {}) {
    if (properties.scrollbarMode !== 'custom') return '';
    const { width, radius, inset, thumb, thumbBorder, thumbHoverBorder, track, firefoxWidth,
        thumbSurface, hoverSurface, trackSurface } = resolveScrollbarStyle(properties);

    return `/* Interface scrollbars */
@supports (-moz-appearance: none) {
    :root {
        scrollbar-color: ${thumb} ${track};
        scrollbar-width: ${firefoxWidth};
    }
}
*::-webkit-scrollbar {
    width: ${width}px !important;
    height: ${width}px !important;
}
*::-webkit-scrollbar-track {
    background: ${trackSurface} !important;
    border-radius: ${radius}px !important;
}
*::-webkit-scrollbar-thumb {
    min-height: 28px !important;
    background: ${thumbSurface} !important;
    background-clip: padding-box !important;
    border: ${inset}px solid transparent !important;
    border-radius: ${radius}px !important;
    box-shadow: inset 0 0 0 1px ${thumbBorder} !important;
}
*::-webkit-scrollbar-thumb:hover {
    background: ${hoverSurface} !important;
    background-clip: padding-box !important;
    box-shadow: inset 0 0 0 1px ${thumbHoverBorder} !important;
}
*::-webkit-scrollbar-corner {
    background: ${track} !important;
}`;
}
