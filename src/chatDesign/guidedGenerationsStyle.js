// Character-scoped overrides for Guided Generations' bottom input-area buttons.

const CONTAINER_ID = 'gg-action-button-container';
const BUTTON_SELECTOR = `#${CONTAINER_ID} :is(.gg-action-button, .gg-menu-button)`;
const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'none']);

const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const validHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;

export function isGuidedGenerationsAvailable() {
    return !!document.getElementById(CONTAINER_ID);
}

/** Build only the button appearance groups explicitly enabled by the user. */
export function buildGuidedGenerationsCSS(properties = {}) {
    const sections = [];

    if (properties.guidedGenerationsTextMode === 'custom') {
        sections.push(`${BUTTON_SELECTOR} {
    color: ${validHex(properties.guidedGenerationsTextColor, '#f5f2f8')} !important;
}`);
    }

    if (properties.guidedGenerationsBackgroundMode === 'custom') {
        sections.push(`${BUTTON_SELECTOR} {
    background-color: ${validHex(properties.guidedGenerationsBackgroundColor, '#171717')} !important;
}`);
    }

    if (properties.guidedGenerationsBorderMode === 'custom') {
        const width = clamp(properties.guidedGenerationsBorderWidth, 0, 6, 1);
        const requestedStyle = String(properties.guidedGenerationsBorderStyle || 'solid');
        const style = BORDER_STYLES.has(requestedStyle) ? requestedStyle : 'solid';
        const color = validHex(properties.guidedGenerationsBorderColor, '#f5f2f8');
        sections.push(`${BUTTON_SELECTOR} {
    border: ${width}px ${style} ${color} !important;
}`);
    }

    if (properties.guidedGenerationsRadiusMode === 'custom') {
        const radius = clamp(properties.guidedGenerationsRadius, 0, 40, 4);
        sections.push(`${BUTTON_SELECTOR} {
    border-radius: ${radius}px !important;
}`);
    }

    return sections.join('\n\n');
}
