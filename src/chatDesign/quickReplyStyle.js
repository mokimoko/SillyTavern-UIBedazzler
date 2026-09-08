// Character-scoped presentation for Quick Reply buttons in the bar and popout.

import { getFontFamilyCSS } from './fonts.js';

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

function surfaceBackground(properties) {
    const first = hexToRgba(properties.qrButtonSurfaceColor, properties.qrButtonSurfaceOpacity, '#242129');
    if (properties.qrButtonSurfaceType !== 'gradient') return first;
    const second = hexToRgba(properties.qrButtonSurfaceSecondaryColor, properties.qrButtonSurfaceOpacity, '#514168');
    const angle = clampNumber(properties.qrButtonSurfaceAngle, 0, 360, 135);
    return `linear-gradient(${angle}deg, ${first}, ${second})`;
}

function shadowValue(kind, accent) {
    if (kind === 'soft') return '0 4px 12px rgba(0, 0, 0, 0.24)';
    if (kind === 'float') return '0 8px 18px rgba(0, 0, 0, 0.34)';
    if (kind === 'glow') return `0 0 14px ${accent}`;
    return 'none';
}

function safeChoice(value, choices, fallback) {
    return choices.includes(value) ? value : fallback;
}

/** Build QR button rules without touching the popout trigger or editor UI. */
export function buildQuickReplyStyleCSS(properties = {}) {
    if (properties.qrButtonMode !== 'custom') return '';

    const mainBar = 'body #form_sheld > #send_form #qr--bar';
    const popoutBody = 'body #qr--popout > .qr--body';
    const buttonSelectors = [
        `${mainBar} .qr--button.menu_button`,
        `${popoutBody} .qr--button.menu_button`,
    ];
    const buttons = buttonSelectors.join(',\n');
    const buttonContents = buttonSelectors
        .map(selector => `${selector} :is(.qr--button-icon, .qr--button-label, .qr--button-expander, i, svg)`)
        .join(',\n');
    const buttonLabels = buttonSelectors.map(selector => `${selector} .qr--button-label`).join(',\n');
    const interactiveButtons = buttonSelectors
        .map(selector => `${selector}:is(:hover, :focus-visible)`)
        .join(',\n');
    const activeButtons = buttonSelectors.map(selector => `${selector}:active`).join(',\n');
    const groups = `${mainBar},\n${mainBar} > .qr--buttons,\n${popoutBody} > .qr--buttons`;
    const nativeColorGroups = [
        `${mainBar} .qr--buttons.qr--color`,
        `${popoutBody} .qr--buttons.qr--color`,
    ].join(',\n');
    const nativeBorderGroups = [
        `${mainBar} .qr--buttons.qr--borderColor`,
        `${popoutBody} .qr--buttons.qr--borderColor`,
    ].join(',\n');
    const nativeGroupBackplates = [
        `${mainBar} .qr--buttons.qr--color .qr--button::before`,
        `${popoutBody} .qr--buttons.qr--color .qr--button::before`,
        `${mainBar} .qr--buttons.qr--borderColor::before`,
        `${mainBar} .qr--buttons.qr--borderColor::after`,
        `${popoutBody} .qr--buttons.qr--borderColor::before`,
        `${popoutBody} .qr--buttons.qr--borderColor::after`,
    ].join(',\n');
    const background = surfaceBackground(properties);
    const hoverBackground = hexToRgba(properties.qrButtonHoverSurfaceColor, properties.qrButtonHoverSurfaceOpacity, '#65517f');
    const text = safeColor(properties.qrButtonTextColor, '#f5f2f8');
    const hoverText = safeColor(properties.qrButtonHoverTextColor, '#ffffff');
    const borderWidth = clampNumber(properties.qrButtonBorderWidth, 0, 6, 1);
    const borderStyle = ['solid', 'dashed', 'dotted', 'none'].includes(properties.qrButtonBorderStyle)
        ? properties.qrButtonBorderStyle : 'solid';
    const border = hexToRgba(properties.qrButtonBorderColor, properties.qrButtonBorderOpacity, '#ffffff');
    const radius = clampNumber(properties.qrButtonRadius, 0, 40, 10);
    const paddingX = clampNumber(properties.qrButtonPaddingX, 0, 24, 8);
    const paddingY = clampNumber(properties.qrButtonPaddingY, 0, 16, 5);
    const gap = clampNumber(properties.qrButtonGap, 0, 24, 5);
    const fontSize = clampNumber(properties.qrButtonFontSize, 9, 24, 13);
    const fontWeight = Math.round(clampNumber(properties.qrButtonFontWeight, 300, 800, 500) / 100) * 100;
    const fontFamily = getFontFamilyCSS(properties.qrButtonFontFamily);
    const fontFamilyDeclaration = properties.qrButtonFontFamilyUseCustom
        ? `    font-family: ${fontFamily} !important;\n`
        : '';
    const fontStyle = safeChoice(properties.qrButtonFontStyle, ['normal', 'italic'], 'normal');
    const textTransform = safeChoice(
        properties.qrButtonTextTransform,
        ['none', 'uppercase', 'lowercase', 'capitalize'],
        'none',
    );
    const letterSpacing = safeChoice(
        properties.qrButtonLetterSpacing,
        ['0px', '0.5px', '1px', '2px', '3px', '5px'],
        '0px',
    );
    const textShadow = safeChoice(properties.qrButtonTextShadow, [
        'none',
        '0 0 4px rgba(255,255,255,0.3)',
        '0 0 6px rgba(180,160,140,0.5)',
        '0 0 8px rgba(100,150,255,0.4)',
        '1px 1px 2px rgba(0,0,0,0.8)',
        '2px 2px 4px rgba(0,0,0,0.6)',
        '0 0 10px rgba(255,100,100,0.5)',
        '0 0 10px rgba(100,255,100,0.5)',
        '0 0 10px rgba(200,100,255,0.5)',
        '0 1px 0 rgba(255,255,255,0.2)',
    ], 'none');
    const barOpacity = clampNumber(properties.qrButtonBarOpacity, 0.1, 1, 1);
    const glow = hexToRgba(properties.qrButtonBorderColor, Math.min(0.55, clampNumber(properties.qrButtonBorderOpacity, 0, 1, 0.18) + 0.18), '#ffffff');
    const shadow = shadowValue(properties.qrButtonShadow, glow);

    return `/* Quick Reply buttons */
${mainBar} {
    opacity: ${barOpacity} !important;
}
${groups} {
    gap: ${gap}px !important;
}
${nativeColorGroups} {
    background: transparent !important;
}
${nativeBorderGroups} {
    border-left-width: 0 !important;
    border-right-width: 0 !important;
}
${nativeGroupBackplates} {
    content: none !important;
    display: none !important;
}
${buttons} {
    margin: 0 !important;
    padding: ${paddingY}px ${paddingX}px !important;
    border: ${borderWidth}px ${borderStyle} ${border} !important;
    border-radius: ${radius}px !important;
    background: ${background} !important;
    color: ${text};
    box-shadow: ${shadow} !important;
}
${buttonContents} {
    color: inherit !important;
}
${buttonLabels} {
${fontFamilyDeclaration}    font-size: ${fontSize}px !important;
    font-weight: ${fontWeight} !important;
    font-style: ${fontStyle} !important;
    text-transform: ${textTransform} !important;
    letter-spacing: ${letterSpacing} !important;
    text-shadow: ${textShadow} !important;
}
${interactiveButtons} {
    background: ${hoverBackground} !important;
    color: ${hoverText};
}
${activeButtons} {
    filter: brightness(0.92) !important;
}`;
}
