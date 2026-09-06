// Character-scoped styling for SillyTavern's bottom message composer.

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}

function hexToRgba(value, alpha, fallback) {
    const hex = safeColor(value, fallback);
    const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(', ')}, ${clampNumber(alpha, 0, 1, 1)})`;
}

function surfaceBackground(type, primary, secondary, opacity, angle) {
    const first = hexToRgba(primary, opacity, '#171717');
    if (type !== 'gradient') return first;
    const second = hexToRgba(secondary, opacity, '#39435a');
    return `linear-gradient(${clampNumber(angle, 0, 360, 135)}deg, ${first}, ${second})`;
}

function shadowValue(kind, accent) {
    if (kind === 'soft') return '0 8px 24px rgba(0, 0, 0, 0.24)';
    if (kind === 'float') return '0 14px 38px rgba(0, 0, 0, 0.36)';
    if (kind === 'glow') return `0 0 22px ${accent}`;
    return 'none';
}

/** Build opt-in composer rules without styling Quick Reply buttons. */
export function buildInputAreaStyleCSS(properties = {}) {
    const sections = [];
    const shell = 'body #form_sheld > #send_form';
    const inputRow = `${shell} > #nonQRFormItems`;

    if (properties.inputAreaSurfaceMode === 'custom') {
        const surface = surfaceBackground(
            properties.inputAreaSurfaceType,
            properties.inputAreaSurfaceColor,
            properties.inputAreaSurfaceSecondaryColor,
            properties.inputAreaSurfaceOpacity,
            properties.inputAreaSurfaceAngle,
        );
        const blur = clampNumber(properties.inputAreaBlur, 0, 24, 8);
        sections.push(`${shell} {
    background: ${surface} !important;
}
body:not(.no-blur) #form_sheld > #send_form {
    backdrop-filter: blur(${blur}px) !important;
    -webkit-backdrop-filter: blur(${blur}px) !important;
}`);
    }

    if (properties.inputAreaBorderMode === 'custom') {
        const width = clampNumber(properties.inputAreaBorderWidth, 0, 6, 1);
        const style = ['solid', 'dashed', 'dotted', 'none'].includes(properties.inputAreaBorderStyle)
            ? properties.inputAreaBorderStyle : 'solid';
        const border = hexToRgba(properties.inputAreaBorderColor, properties.inputAreaBorderOpacity, '#ffffff');
        const radius = clampNumber(properties.inputAreaRadius, 0, 40, 10);
        const glow = hexToRgba(properties.inputAreaBorderColor, Math.min(0.5, clampNumber(properties.inputAreaBorderOpacity, 0, 1, 0.18) + 0.14), '#ffffff');
        const shadow = shadowValue(properties.inputAreaShadow, glow);
        sections.push(`${shell} {
    box-sizing: border-box !important;
    border: ${width}px ${style} ${border} !important;
    border-radius: ${radius}px !important;
    box-shadow: ${shadow} !important;
}`);
    }

    if (properties.inputAreaLayoutMode === 'custom') {
        const paddingX = clampNumber(properties.inputAreaPaddingX, 0, 24, 2);
        const paddingY = clampNumber(properties.inputAreaPaddingY, 0, 16, 0);
        const gap = clampNumber(properties.inputAreaGap, 0, 24, 5);
        sections.push(`${inputRow} {
    box-sizing: border-box !important;
    padding: ${paddingY}px ${paddingX}px !important;
    column-gap: ${gap}px !important;
}`);
    }

    if (properties.inputAreaTextMode === 'custom') {
        const text = safeColor(properties.inputAreaTextColor, '#f5f2f8');
        const placeholder = safeColor(properties.inputAreaPlaceholderColor, '#aaa6b3');
        const size = clampNumber(properties.inputAreaFontSize, 10, 28, 16);
        sections.push(`${inputRow} > #send_textarea {
    color: ${text} !important;
    font-size: ${size}px !important;
}
${inputRow} > #send_textarea::placeholder {
    color: ${placeholder} !important;
}`);
    }

    if (properties.inputAreaIconMode === 'custom') {
        const icon = safeColor(properties.inputAreaIconColor, '#d8d5df');
        const hover = safeColor(properties.inputAreaIconHoverColor, '#ffffff');
        const opacity = clampNumber(properties.inputAreaIconOpacity, 0.05, 1, 0.7);
        const controls = `${inputRow} > :is(#leftSendForm, #rightSendForm) > div`;
        sections.push(`${controls} {
    color: ${icon} !important;
    opacity: ${opacity} !important;
}
${controls}:is(:hover, :focus-visible) {
    color: ${hover} !important;
    opacity: 1 !important;
}`);
    }

    return sections.join('\n\n');
}
