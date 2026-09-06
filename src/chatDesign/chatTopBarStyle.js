// Character-scoped presentation overrides for the optional Chat Top Bar extension.

const TOP_BAR_ID = 'extensionTopBar';

const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const validHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;

function hexToRgba(hex, alpha) {
    const value = validHex(hex, '#171717').slice(1);
    const channels = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(', ')}, ${clamp(alpha, 0, 1, 0.85)})`;
}

export function isChatTopBarAvailable() {
    return !!document.getElementById(TOP_BAR_ID);
}

/** Build only the overrides the user explicitly enabled. */
export function buildChatTopBarCSS(properties = {}) {
    const sections = [];

    if (properties.chatTopBarSurfaceMode === 'custom') {
        const background = hexToRgba(
            properties.chatTopBarBackgroundColor,
            properties.chatTopBarBackgroundOpacity,
        );
        sections.push(`#${TOP_BAR_ID} {
    background: ${background} !important;
}`);
    }

    if (properties.chatTopBarTextMode === 'custom') {
        const color = validHex(properties.chatTopBarTextColor, '#f5f2f8');
        sections.push(`#${TOP_BAR_ID},
#${TOP_BAR_ID} input,
#${TOP_BAR_ID} select,
#${TOP_BAR_ID} .right_menu_button,
#${TOP_BAR_ID} .icon-svg {
    color: ${color} !important;
}`);
    }

    if (properties.chatTopBarRadiusMode === 'custom') {
        const top = clamp(properties.chatTopBarTopRadius, 0, 40, 10);
        const bottom = clamp(properties.chatTopBarBottomRadius, 0, 40, 0);
        sections.push(`#${TOP_BAR_ID} {
    border-radius: ${top}px ${top}px ${bottom}px ${bottom}px !important;
}`);
    }

    return sections.join('\n\n');
}
