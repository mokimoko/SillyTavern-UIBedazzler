// Character-scoped styling for interface chrome outside individual messages.

import { resolveStyleTargets } from './storage.js';
import { cleanAvatar } from '../design/designUtils.js';
import { getAppearanceAvatar } from './chatScope.js';
import { buildControlStyleCSS } from './controlStyle.js';
import { buildInputAreaStyleCSS } from './inputAreaStyle.js';
import { buildQuickReplyStyleCSS } from './quickReplyStyle.js';
import { buildScrollbarStyleCSS } from './scrollbarStyle.js';
import { buildWeatherBadgeCSS } from './weatherBadgeStyle.js';
import { buildChatTopBarCSS } from './chatTopBarStyle.js';
import { buildGuidedGenerationsCSS } from './guidedGenerationsStyle.js';

const TOP_BAR_ICON_SELECTORS = Object.freeze([
    '#top-settings-holder .drawer-icon',
    '#top-settings-holder .custom-drawer-icon',
    '#top-settings-holder .inline-drawer-icon',
]);

function topBarIconSelectors(suffix = '') {
    return TOP_BAR_ICON_SELECTORS.map(selector => `${selector}${suffix}`).join(',\n');
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function hexToRgba(value, alpha, fallback) {
    const hex = /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
    const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(', ')}, ${clampNumber(alpha, 0, 1, 1)})`;
}

function surfaceBackground(type, primary, secondary, opacity, angle) {
    const first = hexToRgba(primary, opacity, '#171717');
    if (type !== 'gradient') return first;
    const second = hexToRgba(secondary, opacity, '#39435a');
    return `linear-gradient(${clampNumber(angle, 0, 360, 135)}deg, ${first}, ${second})`;
}

function signedPixelTerm(value) {
    const number = Math.round(Number(value) || 0);
    if (number === 0) return '';
    return number > 0 ? ` + ${number}px` : ` - ${Math.abs(number)}px`;
}

/** Build interface chrome for one resolved style. */
export function buildGeneralUiCSS(style) {
    const p = style.properties || {};
    const sections = [];
    const presetUsesCustom = Object.prototype.hasOwnProperty.call(p, 'topBarPresetUseCustom')
        ? p.topBarPresetUseCustom === true
        : !!p.topBarPreset && p.topBarPreset !== 'theme';
    const preset = presetUsesCustom ? p.topBarPreset || 'theme' : 'theme';
    const topOffset = clampNumber(p.topBarTopOffset, -16, 24, 0);
    const desktopPresetTop = preset === 'floatingFrame' ? 10 : 0;
    const mobilePresetTop = preset === 'floatingFrame' ? 6 : 0;
    const desktopTop = desktopPresetTop + topOffset;
    const mobileTop = mobilePresetTop + topOffset;
    const legacyWidth = Number(p.fullBleedWidth);
    const widthMode = p.topBarWidthMode
        ?? (preset === 'fullBleed' && Number.isFinite(legacyWidth) && legacyWidth !== 100 ? 'custom' : 'theme');

    if (preset === 'fullBleed') {
        sections.push(`@media screen and (min-width: 1001px) {
    #top-bar {
        top: 0 !important;
        width: 100vw !important;
        width: 100dvw !important;
        max-width: none !important;
        left: 0 !important;
        right: 0 !important;
        margin-inline: auto !important;
        border-radius: 0 !important;
    }
}
@media screen and (max-width: 1000px) {
    #top-bar {
        width: 100vw !important;
        width: 100dvw !important;
        max-width: none !important;
        left: 0 !important;
        right: 0 !important;
        margin-inline: auto !important;
        border-radius: 0 !important;
    }
}`);
    } else if (preset === 'softShelf') {
        sections.push(`@media screen and (min-width: 1001px) {
    #top-bar {
        top: 0 !important;
        width: 100vw !important;
        width: 100dvw !important;
        max-width: none !important;
        border-radius: 0 0 30px 30px !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28) !important;
    }
}
@media screen and (max-width: 1000px) {
    #top-bar {
        border-radius: 0 0 24px 24px !important;
    }
}`);
    } else if (preset === 'floatingFrame') {
        sections.push(`@media screen and (min-width: 1001px) {
    #top-bar {
        width: calc(100vw - 48px) !important;
        width: calc(100dvw - 48px) !important;
        max-width: none !important;
        border-radius: 28px !important;
        box-shadow: 0 15px 38px rgba(0, 0, 0, 0.34) !important;
    }
}
@media screen and (max-width: 1000px) {
    #top-bar {
        width: calc(100vw - 18px) !important;
        width: calc(100dvw - 18px) !important;
        border-radius: 22px !important;
    }
}`);
    }

    if (p.topBarSurfaceMode === 'custom') {
        const background = surfaceBackground(
            p.topBarSurfaceType,
            p.topBarSurfaceColor,
            p.topBarSurfaceSecondaryColor,
            p.topBarSurfaceOpacity,
            p.topBarSurfaceAngle,
        );
        sections.push(`#top-bar,
body.no-blur #top-bar {
    background: ${background} !important;
}`);
    }

    if (p.topBarBorderMode === 'custom') {
        const width = clampNumber(p.topBarBorderWidth, 0, 6, 1);
        const color = hexToRgba(p.topBarBorderColor, p.topBarBorderOpacity, '#ffffff');
        sections.push(`#top-bar {
    box-sizing: border-box !important;
    border: ${width}px solid ${color} !important;
}`);
    }

    if (widthMode === 'custom') {
        const width = clampNumber(p.topBarWidth ?? p.fullBleedWidth, 50, 100, 92);
        sections.push(`#top-bar {
    width: ${width}vw !important;
    width: ${width}dvw !important;
    max-width: none !important;
    left: 0 !important;
    right: 0 !important;
    margin-inline: auto !important;
}`);
    }

    // Floating Frame has its own inset; otherwise a zero offset leaves the
    // theme's vertical placement entirely alone. The icon host must travel
    // with the visible backdrop without inheriting its width.
    if (preset === 'floatingFrame' || topOffset !== 0) {
        sections.push(`@media screen and (min-width: 1001px) {
    #top-bar,
    #top-settings-holder {
        top: ${desktopTop}px !important;
    }
}
@media screen and (max-width: 1000px) {
    #top-bar,
    #top-settings-holder {
        top: calc(max(var(--tt-inset-top), 0px)${signedPixelTerm(mobileTop)}) !important;
    }
}`);
    }

    if (p.topBarHeightMode === 'custom') {
        const height = clampNumber(p.topBarHeight, 30, 56, 40);
        sections.push(`body {
    --topBarBlockSize: ${height}px !important;
}
#top-bar,
#top-settings-holder {
    height: ${height}px !important;
}`);
    }

    if (p.chatGapMode === 'custom') {
        const gap = clampNumber(p.chatGap, 0, 24, 0);
        const desktopExtra = desktopTop + gap;
        const mobileExtra = mobileTop + gap;
        sections.push(`@media screen and (min-width: 1001px) {
    body #sheld {
        top: calc(var(--topBarBlockSize)${signedPixelTerm(desktopExtra)}) !important;
        height: calc(100vh - var(--topBarBlockSize)${signedPixelTerm(-desktopExtra)} - 1px) !important;
        height: calc(100dvh - var(--topBarBlockSize)${signedPixelTerm(-desktopExtra)} - 1px) !important;
        max-height: calc(100dvh - var(--topBarBlockSize)${signedPixelTerm(-desktopExtra)} - 1px) !important;
    }
}
@media screen and (max-width: 1000px) {
    body #sheld {
        top: calc(var(--topBarBlockSize) + max(var(--tt-inset-top), 0px)${signedPixelTerm(mobileExtra)}) !important;
        height: calc(100vh - var(--topBarBlockSize) - max(var(--tt-inset-top), 0px)${signedPixelTerm(-mobileExtra)}) !important;
        height: calc(var(--tt-base-viewport-height, var(--doc-height, 100vh)) - var(--topBarBlockSize) - max(var(--tt-inset-top), 0px)${signedPixelTerm(-mobileExtra)}) !important;
        min-height: calc(var(--tt-base-viewport-height, var(--doc-height, 100vh)) - var(--topBarBlockSize) - max(var(--tt-inset-top), 0px)${signedPixelTerm(-mobileExtra)}) !important;
        max-height: calc(var(--tt-base-viewport-height, var(--doc-height, 100vh)) - var(--topBarBlockSize) - max(var(--tt-inset-top), 0px)${signedPixelTerm(-mobileExtra)}) !important;
    }
}`);
    }

    if (p.iconSizeMode === 'custom') {
        const size = clampNumber(p.iconSize, 18, 48, 30);
        sections.push(`body {
    --topBarIconSize: ${size}px !important;
}`);
    }

    if (p.iconSpacingMode === 'custom') {
        const gap = clampNumber(p.iconSpacing, 0, 32, 8);
        sections.push(`#top-settings-holder {
    gap: ${gap}px !important;
}
#top-settings-holder > .drawer {
    flex: 0 0 auto !important;
    width: auto !important;
}`);
    }

    if (p.iconColorMode === 'custom') {
        const color = /^#[0-9a-f]{6}$/i.test(p.iconColor || '') ? p.iconColor : '#d8d5df';
        const hover = /^#[0-9a-f]{6}$/i.test(p.iconHoverColor || '') ? p.iconHoverColor : '#ffffff';
        const icons = topBarIconSelectors();
        const interactiveIcons = topBarIconSelectors(':is(:hover, :focus-visible)');
        sections.push(`${icons} {
    color: ${color} !important;
}
${interactiveIcons} {
    color: ${hover} !important;
}`);
    }

    if (p.iconOpacityMode === 'custom') {
        const opacity = clampNumber(p.iconOpacity, 0.05, 1, 0.65);
        const icons = topBarIconSelectors();
        const interactiveIcons = topBarIconSelectors(':is(:hover, :focus-visible)');
        sections.push(`${icons} {
    opacity: ${opacity} !important;
}
${interactiveIcons} {
    opacity: 1 !important;
}`);
    }

    const controlStyleCSS = buildControlStyleCSS(p);
    if (controlStyleCSS) sections.push(controlStyleCSS);

    const inputAreaStyleCSS = buildInputAreaStyleCSS(p);
    if (inputAreaStyleCSS) sections.push(inputAreaStyleCSS);

    const quickReplyStyleCSS = buildQuickReplyStyleCSS(p);
    if (quickReplyStyleCSS) sections.push(quickReplyStyleCSS);

    const scrollbarStyleCSS = buildScrollbarStyleCSS(p);
    if (scrollbarStyleCSS) sections.push(scrollbarStyleCSS);

    const weatherBadgeCSS = buildWeatherBadgeCSS(p);
    if (weatherBadgeCSS) sections.push(weatherBadgeCSS);

    const chatTopBarCSS = buildChatTopBarCSS(p);
    if (chatTopBarCSS) sections.push(chatTopBarCSS);

    const guidedGenerationsCSS = buildGuidedGenerationsCSS(p);
    if (guidedGenerationsCSS) sections.push(guidedGenerationsCSS);

    return sections.join('\n\n');
}

/** Resolve character-scoped UI chrome; persona changes intentionally do not participate. */
export function buildActiveGeneralUiCSS(styles) {
    const candidates = styles.filter(style => style.element === 'generalUi');
    if (candidates.length === 0) return '';
    const activeChar = getAppearanceAvatar() || null;

    let winner = null;
    let bestScore = -1;
    for (const style of candidates) {
        let score = style.isDefault ? 0 : -1;
        if (activeChar && (style.assignedCharacters || []).some(avatar => cleanAvatar(avatar) === activeChar)) {
            score = 3;
        } else if ((style.assignedVerses || []).length > 0) {
            const inVerse = resolveStyleTargets(style)
                .some(target => target.charAvatar && cleanAvatar(target.charAvatar) === activeChar);
            if (inVerse) score = 1;
        }
        if (score > bestScore) {
            bestScore = score;
            winner = style;
        }
    }

    if (!winner) return '';
    const css = buildGeneralUiCSS(winner);
    return css ? `/* General UI: ${winner.name} */\n${css}` : '';
}
