// src/chatDesign/cssGenerator.js
// Generates CSS from Chat Design styles and injects/removes it from the page.
//
// Cascade order (low → high specificity):
//   1. Default styles → `.mes` selector
//   2. Verse styles → `.mes[ch_name="X"]` (resolved from verse membership)
//   3. Character/Persona styles → `#chat .mes[ch_name="X"]`
//   4. Design Tab overrides (handled separately — charDrawer/personaLore designTab.js)
//
// This module owns separate message and context <style> elements so ordinary
// chat changes do not force the browser to replace every assignment rule.
// Design Tab owns `wl-char-design-styles` and `wl-persona-design-styles`.

import { getAllStyles, resolveStyleTargets } from './storage.js';
import { buildActiveCursorCSS } from './cursors.js';
import { buildActiveGeneralUiCSS } from './generalUi.js';
import { getFontFamilyCSS, loadUsedFonts } from './fonts.js';
import {
    escapeCSSName, cleanAvatar, normalizeBannerUrl, serializeCssUrl,
} from '../design/designUtils.js';
import { power_user } from '../../../../../power-user.js';
import { user_avatar } from '../../../../../personas.js';
import { extension_settings, getContext } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';
import { getAppearanceAvatar, getChatScope, isGroupContext } from './chatScope.js';
import { sanitizeCustomCssDeclarations } from './customCss.js';

const log = () => {};

const MESSAGE_STYLE_ELEMENT_ID = 'wl-chat-design-message-styles';
const CONTEXT_STYLE_ELEMENT_ID = 'wl-chat-design-context-styles';
const LEGACY_STYLE_ELEMENT_ID = 'wl-chat-design-styles';

// ============================================================
// Helpers
// ============================================================

/**
 * Ensure selector has `#chat` prefix for specificity boost.
 */
function chatSel(selector) {
    return selector.trimStart().startsWith('#chat') ? selector : `#chat ${selector}`;
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 0, g: 0, b: 0 };
}

/**
 * Convert a hex color + alpha (0–1) to an rgba() string.
 */
function rgbaFromHex(hex, alpha) {
    const value = String(hex || '').trim().toLowerCase();
    if (value === 'transparent') return 'transparent';
    const eightDigit = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
    if (eightDigit) {
        const sourceAlpha = parseInt(eightDigit[4], 16) / 255;
        return `rgba(${parseInt(eightDigit[1], 16)}, ${parseInt(eightDigit[2], 16)}, ${parseInt(eightDigit[3], 16)}, ${sourceAlpha * alpha})`;
    }
    const c = hexToRgb(value);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function clampNumber(value, min, max, fallback = min) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeHexColor(value, fallback) {
    const color = String(value || '').trim();
    return /^#[a-f\d]{6}$/i.test(color) ? color : fallback;
}

/**
 * Check if a fontFamily value represents the theme default (no-op).
 */
function isDefaultFont(fontFamily) {
    return !fontFamily || fontFamily === 'inherit' || fontFamily === 'Default (Theme)';
}

// ============================================================
// CSS Generation — Per Element Type
// ============================================================

/**
 * Build the Name portion of a Fonts style.
 * Targets: `.name_text` inside the message selector.
 */
function buildNameCSS(style, selector, properties = style.properties) {
    const p = properties || {};
    const decls = [];
    const rules = [];
    const alignment = ['center', 'right'].includes(p.textAlign) ? p.textAlign : 'left';
    const flexAlignment = { left: 'flex-start', center: 'center', right: 'flex-end' }[alignment];
    const alignmentRule = alignment === 'left'
        ? `${selector} .ch_name > .flex1 {\n    justify-content: flex-start !important;\n}`
        : `${selector} .ch_name {\n` +
            '    display: grid !important;\n' +
            '    grid-template-columns: minmax(0, 1fr) !important;\n' +
            '}\n' +
            `${selector} .ch_name > .flex1,\n` +
            `${selector} .ch_name > .mes_buttons {\n` +
            '    grid-column: 1 !important;\n' +
            '    grid-row: 1 !important;\n' +
            '}\n' +
            `${selector} .ch_name > .flex1 {\n` +
            '    min-width: 0 !important;\n' +
            `    justify-content: ${flexAlignment} !important;\n` +
            '}\n' +
            `${selector} .ch_name > .mes_buttons {\n` +
            '    justify-self: end !important;\n' +
            '}';

    if (!isDefaultFont(p.fontFamily)) decls.push(`font-family: ${getFontFamilyCSS(p.fontFamily)} !important`);
    if (p.fontSize && p.fontSize !== '1em') decls.push(`font-size: ${p.fontSize} !important`);
    if (p.fontWeight && p.fontWeight !== '400') decls.push(`font-weight: ${p.fontWeight} !important`);
    if (p.fontStyle && p.fontStyle !== 'normal') decls.push(`font-style: ${p.fontStyle} !important`);
    if (p.textTransform && p.textTransform !== 'none') decls.push(`text-transform: ${p.textTransform} !important`);
    if (p.letterSpacing && p.letterSpacing !== '0px') decls.push(`letter-spacing: ${p.letterSpacing} !important`);
    if (p.textShadow && p.textShadow !== 'none') decls.push(`text-shadow: ${p.textShadow} !important`);
    if (p.noWrap === true) decls.push('white-space: nowrap !important');
    if (p.fillMode === 'gradient') {
        const startColor = safeHexColor(p.fillStartColor, '#d49a74');
        const endColor = safeHexColor(p.fillEndColor, '#71405b');
        const angle = clampNumber(p.fillAngle, 0, 360, 90);
        decls.push(`background-image: linear-gradient(${angle}deg, ${startColor}, ${endColor}) !important`);
        decls.push('background-repeat: no-repeat !important');
        decls.push('-webkit-background-clip: text !important');
        decls.push('background-clip: text !important');
        decls.push('color: transparent !important');
        decls.push('-webkit-text-fill-color: transparent !important');
    }
    const offsetX = Math.min(800, Math.max(-400, Number(p.offsetX) || 0));
    const offsetY = Math.min(250, Math.max(-250, Number(p.offsetY) || 0));
    const backgroundOpacity = Math.min(1, Math.max(0, Number(p.backgroundOpacity) || 0));
    const backgroundWidth = Math.min(400, Math.max(0, Number(p.backgroundWidth) || 0));
    const backgroundHeight = Math.min(120, Math.max(0, Number(p.backgroundHeight) || 0));
    const backgroundTextOffsetX = Math.min(40, Math.max(-40, Number(p.backgroundTextOffsetX) || 0));
    const backgroundTextOffsetY = Math.min(20, Math.max(-20, Number(p.backgroundTextOffsetY) || 0));
    const hasNameBackground = backgroundOpacity > 0 || backgroundWidth > 0 || backgroundHeight > 0;
    let nameBackgroundRule = '';
    let nameOffsetRule = '';

    if (hasNameBackground) {
        const backgroundRadius = {
            square: '0',
            rounded: '8px',
            pill: '999px',
        }[p.backgroundShape] || '8px';

        decls.push('display: inline-flex !important');
        decls.push('align-items: center !important');
        decls.push(`justify-content: ${flexAlignment} !important`);
        // Display fonts often ship with generous line-gap metrics. Center a
        // tight line box so the glyphs do not ride high or low in the badge.
        decls.push('line-height: 1 !important');
        decls.push(`text-align: ${alignment} !important`);
        decls.push('vertical-align: middle !important');
        decls.push('box-sizing: border-box !important');
        decls.push('padding: 2px 8px !important');
        const backgroundColor = rgbaFromHex(p.backgroundColor || '#000000', backgroundOpacity);
        const backgroundSurface = p.backgroundFillMode === 'gradient'
            ? `linear-gradient(${clampNumber(p.backgroundAngle, 0, 360, 90)}deg, ${backgroundColor}, ${rgbaFromHex(p.backgroundSecondaryColor || '#3b2847', backgroundOpacity)})`
            : backgroundColor;
        // Keep the badge surface on a pseudo-element in every case. A
        // character-specific gradient may add background-clip:text after this
        // rule, and painting the badge on .name_text would then clip its fill
        // to the glyphs. The pseudo-element remains a stable badge layer.
        decls.push('position: relative !important');
        decls.push('isolation: isolate !important');
        if (backgroundTextOffsetX !== 0 || backgroundTextOffsetY !== 0) {
            decls.push(`transform: translate(${backgroundTextOffsetX}px, ${backgroundTextOffsetY}px) !important`);
        }
        decls.push('background-color: transparent !important');
        nameBackgroundRule = `${selector} .name_text::before {\n` +
            '    content: "" !important;\n' +
            '    position: absolute !important;\n' +
            '    inset: 0 !important;\n' +
            '    z-index: -1 !important;\n' +
            '    pointer-events: none !important;\n' +
            `    transform: translate(${-backgroundTextOffsetX}px, ${-backgroundTextOffsetY}px) !important;\n` +
            `    background: ${backgroundSurface} !important;\n` +
            `    border-radius: ${backgroundRadius} !important;\n` +
            '}';
        decls.push(`border-radius: ${backgroundRadius} !important`);
        if (backgroundWidth > 0) {
            decls.push(`width: ${backgroundWidth}px !important`);
            decls.push('max-width: 100% !important');
        }
        if (backgroundHeight > 0) decls.push(`height: ${backgroundHeight}px !important`);
    }

    if (offsetX !== 0 || offsetY !== 0) {
        // SillyTavern keeps the hidden-message ghost and timestamp beside the
        // name. Move that native cluster together so the companions do not
        // remain behind when a styled name is offset into a banner.
        const offsetDecls = [
            'position: relative !important',
            'z-index: 4 !important',
        ];
        if (offsetX !== 0) offsetDecls.push(`left: ${offsetX}px !important`);
        if (offsetY !== 0) offsetDecls.push(`top: ${offsetY}px !important`);
        nameOffsetRule = `${selector} .name_text,\n` +
            `${selector} .mes_ghost,\n` +
            `${selector} .timestamp {\n    ${offsetDecls.join(';\n    ')};\n}`;
    }

    rules.push(alignmentRule);
    if (decls.length > 0) rules.push(`${selector} .name_text {\n    ${decls.join(';\n    ')};\n}`);
    if (nameOffsetRule) rules.push(nameOffsetRule);
    if (nameBackgroundRule) rules.push(nameBackgroundRule);

    if (offsetY !== 0) {
        // SillyTavern clips .mes_block vertically by default. Keep horizontal
        // clipping for wide message content while allowing a positioned name
        // to rise into a banner (or dip below its original header row).
        rules.push(`${selector} .mes_block {\n    overflow-x: clip !important;\n    overflow-y: visible !important;\n}`);
    }

    return rules.join('\n');
}

function fontProperty(prefix, property) {
    if (!prefix) return property;
    return `${prefix}${property[0].toUpperCase()}${property.slice(1)}`;
}

function buildFontDeclarations(properties, prefix = '') {
    const value = property => properties[fontProperty(prefix, property)];
    const decls = [];
    const customFlag = fontProperty(prefix, 'fontFamilyUseCustom');
    const familyUsesCustom = Object.prototype.hasOwnProperty.call(properties, customFlag)
        ? properties[customFlag] === true
        : !isDefaultFont(value('fontFamily'));

    if (familyUsesCustom && !isDefaultFont(value('fontFamily'))) {
        decls.push(`font-family: ${getFontFamilyCSS(value('fontFamily'))} !important`);
    }
    if (value('fontSize') && value('fontSize') !== '1em') decls.push(`font-size: ${value('fontSize')} !important`);
    if (value('fontWeight') && value('fontWeight') !== '400') decls.push(`font-weight: ${value('fontWeight')} !important`);
    if (value('fontStyle') && value('fontStyle') !== 'normal') decls.push(`font-style: ${value('fontStyle')} !important`);
    if (value('letterSpacing') && value('letterSpacing') !== '0px') decls.push(`letter-spacing: ${value('letterSpacing')} !important`);
    if (value('lineHeight') && value('lineHeight') !== 'normal') decls.push(`line-height: ${value('lineHeight')} !important`);

    return decls;
}

/**
 * Build message typography for a Fonts style. Message Text is the base layer;
 * Dialogue is a more-specific override for quoted <q> content.
 */
function buildFontsCSS(style, selector) {
    const rules = [];
    const nameProperties = Object.fromEntries([
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textTransform',
        'letterSpacing', 'textShadow', 'textAlign', 'noWrap', 'fillMode', 'fillStartColor', 'fillEndColor',
        'fillAngle', 'offsetX', 'offsetY', 'backgroundColor', 'backgroundFillMode',
        'backgroundSecondaryColor', 'backgroundAngle',
        'backgroundOpacity', 'backgroundWidth', 'backgroundHeight',
        'backgroundTextOffsetX', 'backgroundTextOffsetY', 'backgroundShape',
    ].map(property => {
        const key = `name${property[0].toUpperCase()}${property.slice(1)}`;
        return [property, style.properties?.[key]];
    }));
    const messageDecls = buildFontDeclarations(style.properties, 'message');
    const dialogueDecls = buildFontDeclarations(style.properties);
    const messageCustomCss = sanitizeCustomCssDeclarations(style.properties.messageCustomCss);
    const dialogueCustomCss = sanitizeCustomCssDeclarations(style.properties.dialogueCustomCss);

    const nameCustomCss = sanitizeCustomCssDeclarations(style.properties.nameCustomCss);
    const nameCSS = buildNameCSS(style, selector, nameProperties);
    if (nameCSS) rules.push(nameCSS);
    if (nameCustomCss) rules.push(`${selector} .name_text {\n    ${nameCustomCss};\n}`);

    const messageRules = [messageDecls.join(';\n    '), messageCustomCss].filter(Boolean);
    if (messageRules.length > 0) {
        rules.push(`${selector} .mes_text {\n    ${messageRules.join(';\n    ')};\n}`);
    }
    const dialogueRules = [dialogueDecls.join(';\n    '), dialogueCustomCss].filter(Boolean);
    if (dialogueRules.length > 0) {
        rules.push(`${selector} .mes_text q {\n    ${dialogueRules.join(';\n    ')};\n}`);
    }

    return rules.join('\n');
}

/**
 * Build CSS for a Banner style.
 *
 * Uses mask-image on both pseudo-elements so the image and overlay fade
 * together to transparent, revealing the message background underneath.
 *
 * ::before — banner image + mask-image fade
 *   Design Tab owns the background-image for characters.
 *   Chat Design sets it for personas via avatarUrl.
 *   Chat Design always sets the mask-image (!important) to control fade profile.
 *
 * ::after  — legacy solid overlay + bottom/frame borders
 *   Gradient overlays are composed with the image on ::before so both share
 *   the fade mask; ::after keeps every border crisp at the band's edges.
 */
function buildBannerCSS(style, selector, avatarUrl = null, personaBannerPos = null) {
    const p = style.properties;

    const borderFor = side => {
        const title = side[0].toUpperCase() + side.slice(1);
        const prefix = `border${title}`;
        const width = clampNumber(p[`${prefix}Width`], 0, 64, 0);
        const borderStyle = p[`${prefix}Style`] || 'none';
        const color = p[`${prefix}Color`] || '#ffffff';
        const opacity = clampNumber(p[`${prefix}Opacity`], 0, 1, 1);
        const enabled = width > 0 && borderStyle !== 'none';
        const renderedColor = opacity < 1 ? rgbaFromHex(color, opacity) : color;
        return {
            enabled,
            declaration: enabled
                ? `border-${side}: ${width}px ${borderStyle} ${renderedColor} !important`
                : `border-${side}: none !important`,
        };
    };
    const borders = {
        top: borderFor('top'),
        left: borderFor('left'),
        right: borderFor('right'),
        bottom: borderFor('bottom'),
    };
    const hasBorder = Object.values(borders).some(border => border.enabled);
    const hasBottomBorder = borders.bottom.enabled;
    const overlayOpacity = clampNumber(p.overlayOpacity, 0, 1, 0);
    const overlayType = p.overlayType === 'gradient' ? 'gradient' : 'solid';
    const overlayPrimary = p.overlayColor || '#000000';
    const overlaySecondary = p.overlaySecondaryColor || overlayPrimary;
    const overlayAngle = clampNumber(p.overlayAngle, 0, 360, 135);
    const validOverlayBlendModes = new Set(['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'color']);
    const overlayBlendMode = validOverlayBlendModes.has(p.overlayBlendMode) ? p.overlayBlendMode : 'normal';
    const overlayVignette = clampNumber(p.overlayVignette, 0, 0.85, 0);
    const hasOverlay = overlayOpacity > 0;
    const hasGradientOverlay = hasOverlay && overlayType === 'gradient';
    const overlayLayer = hasOverlay
        ? overlayType === 'gradient'
            ? `linear-gradient(${overlayAngle}deg, ${rgbaFromHex(overlayPrimary, overlayOpacity)} 0%, ${rgbaFromHex(overlaySecondary, overlayOpacity)} 100%)`
            : `linear-gradient(${rgbaFromHex(overlayPrimary, overlayOpacity)}, ${rgbaFromHex(overlayPrimary, overlayOpacity)})`
        : '';
    const hasVignette = overlayVignette > 0;
    const vignetteLayer = hasVignette
        ? `radial-gradient(ellipse at center, transparent 42%, rgba(0, 0, 0, ${overlayVignette}) 100%)`
        : '';
    // Keep the original solid/normal overlay on ::after for backwards-compatible
    // rendering. Effects that need to interact with the image are composed on
    // ::before so they share its bottom fade and slanted clip.
    const usesComposedOverlay = hasGradientOverlay || hasVignette || (hasOverlay && overlayBlendMode !== 'normal');
    const hasBottomFade = (p.bottomFadeOpacity ?? 0) > 0;
    const hasHeight = p.height && p.height !== 120;
    const hasPadding = p.paddingTop && p.paddingTop !== 150;
    const hasBorderRadius = p.borderRadius > 0;
    const hasSlant = (p.slant || 0) > 0;
    const width = clampNumber(p.width, 10, 200, 100);
    const offsetX = clampNumber(p.offsetX, -400, 400, 0);
    const offsetY = clampNumber(p.offsetY, -250, 250, 0);
    const hasGeometry = width !== 100 || offsetX !== 0 || offsetY !== 0;

    if (!hasBorder && !hasOverlay && !hasVignette && !hasBottomFade && !hasHeight && !hasPadding && !hasBorderRadius && !hasSlant && !hasGeometry && !avatarUrl) return '';

    const rules = [];
    // `is_system=true` is also used by ordinary, full-size chat rows in some
    // TauriTavern workflows. Excluding it here leaves those rows with the
    // underlying banner extension's geometry (or no banner at all), so a
    // shared Name style ends up anchored differently for personas and
    // characters. Apply the assigned banner consistently to every target row.
    const bannerSelector = selector;
    const cs = chatSel(bannerSelector);
    const height = p.height || 120;
    const bannerPos = avatarUrl
        ? (personaBannerPos ?? p.bannerPosition ?? 25)
        : (p.bannerPosition ?? 25);
    const paddingTop = p.paddingTop || 150;
    const layerGeometry = [
        `top: ${offsetY}px !important`,
        `left: ${offsetX}px !important`,
        `width: ${width}% !important`,
        `height: ${height}px !important`,
    ];
    const addBannerBackground = declarations => {
        if (usesComposedOverlay) {
            const layers = [];
            const positions = [];
            const sizes = [];
            const repeats = [];
            const blendModes = [];
            if (hasVignette) {
                layers.push(vignetteLayer);
                positions.push('center');
                sizes.push('100% 100%');
                repeats.push('no-repeat');
                blendModes.push('normal');
            }
            if (hasOverlay) {
                layers.push(overlayLayer);
                positions.push('center');
                sizes.push('100% 100%');
                repeats.push('no-repeat');
                blendModes.push(overlayBlendMode);
            }
            layers.push(avatarUrl ? serializeCssUrl(avatarUrl) : 'var(--wl-cdm-banner-image, none)');
            positions.push(avatarUrl ? `center ${bannerPos}%` : `center var(--wl-cdm-banner-position, ${bannerPos}%)`);
            sizes.push('cover');
            repeats.push('no-repeat');
            blendModes.push('normal');
            declarations.push(`background-image: ${layers.join(', ')} !important`);
            declarations.push(`background-position: ${positions.join(', ')} !important`);
            declarations.push(`background-size: ${sizes.join(', ')} !important`);
            declarations.push(`background-repeat: ${repeats.join(', ')} !important`);
            declarations.push(`background-blend-mode: ${blendModes.join(', ')} !important`);
        } else if (avatarUrl) {
            declarations.push(`background: ${serializeCssUrl(avatarUrl)} center ${bannerPos}% / cover no-repeat !important`);
        }
    };

    // Build the mask gradient used by both ::before and ::after.
    // The key: at high fade values, the mask itself starts semi-transparent
    // so the image is already ghostly from the top, not just fading at the bottom.
    //   1.0 → starts at 50% opacity, fades to transparent across full height
    //   0.5 → starts at 75% opacity, solid to 40%, fades over remaining 60%
    //   0.2 → starts at 90% opacity, solid to 64%, gentle fade in last third
    let maskCSS = '';
    if (hasBottomFade) {
        const o = p.bottomFadeOpacity ?? 0;
        const startAlpha = 1 - (o * 0.5);
        const solidEnd = Math.round((1 - o) * 80);
        const maskGradient = `linear-gradient(to bottom, rgba(0,0,0,${startAlpha}) ${solidEnd}%, transparent 100%)`;
        maskCSS = `-webkit-mask-image: ${maskGradient} !important;\n    mask-image: ${maskGradient} !important`;
    }

    // When Container padding is active, keep its original top anchor so saved
    // offsets do not move. The banner must not create unrelated bottom space.
    rules.push(`${cs} {\n    --wl-cdm-banner-padding-top: ${paddingTop}px;\n    position: relative !important;\n    overflow: visible !important;\n    padding-top: var(--wl-cdm-container-extra-padding, ${paddingTop}px) !important;\n}`);

    // Elevate content above pseudo-elements
    rules.push(
        `${bannerSelector} .mes_block,\n` +
        `${bannerSelector} .mes_text,\n` +
        `${bannerSelector} .ch_name,\n` +
        `${bannerSelector} .mesAvatarWrapper {\n    position: relative !important;\n    z-index: 3;\n}`,
    );

    // ── Slanted variant ──────────────────────────────────────────────────
    // The band's bottom is cut on a diagonal (clip-path) and the Bottom Border
    // renders as a bold accent bar riding that diagonal. Overlay is applied as
    // an inset box-shadow so it's clipped by the same diagonal; the bottom fade
    // mask still applies. This branch owns BOTH pseudo-elements, so
    // border-style / border-radius are intentionally ignored here (the bar is a
    // solid strip, corners follow the polygon).
    if (hasSlant) {
        const D = Math.round(p.slant || 0);            // diagonal drop across the width
        const B = hasBottomBorder ? clampNumber(p.borderBottomWidth, 0, 64, 0) : 0; // accent bar thickness
        const dir = p.slantDirection === 'left' ? 'left' : 'right';

        let bodyClip, barClip;
        if (dir === 'right') {
            // Higher on the right: the bottom-left corner sits D px lower.
            bodyClip = `polygon(0 0, 100% 0, 100% calc(100% - ${D}px), 0 100%)`;
            barClip = `polygon(0 100%, 100% calc(100% - ${D}px), 100% calc(100% - ${D + B}px), 0 calc(100% - ${B}px))`;
        } else {
            // Higher on the left: the bottom-right corner sits D px lower.
            bodyClip = `polygon(0 0, 100% 0, 100% 100%, 0 calc(100% - ${D}px))`;
            barClip = `polygon(0 calc(100% - ${D}px), 100% 100%, 100% calc(100% - ${B}px), 0 calc(100% - ${D + B}px))`;
        }

        // ::before — image, diagonally clipped, faded, with the overlay baked
        // in as an inset shadow (clipped by the same diagonal).
        const sBefore = [
            'content: "" !important',
            'position: absolute !important',
            ...layerGeometry,
            'box-sizing: border-box !important',
            borders.top.declaration,
            borders.left.declaration,
            borders.right.declaration,
            'border-bottom: none !important',
            'z-index: 1 !important',
            'pointer-events: none !important',
        ];
        addBannerBackground(sBefore);
        sBefore.push(maskCSS || '-webkit-mask-image: none !important;\n    mask-image: none !important');
        sBefore.push(`-webkit-clip-path: ${bodyClip} !important`);
        sBefore.push(`clip-path: ${bodyClip} !important`);
        if (hasOverlay && !usesComposedOverlay) {
            const rgb = hexToRgb(overlayPrimary);
            sBefore.push(`box-shadow: inset 0 0 0 2000px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${overlayOpacity}) !important`);
        }
        rules.push(`${cs}::before {\n    ${sBefore.join(';\n    ')};\n}`);

        // ::after — the bold accent bar: a solid strip clipped to the diagonal.
        {
            const rgb = hexToRgb(p.borderBottomColor || '#ffffff');
            const opacity = p.borderBottomOpacity ?? 1;
            const barColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
            const sAfter = [
                'content: "" !important',
                'position: absolute !important',
                ...layerGeometry,
                'box-sizing: border-box !important',
                'border: none !important',
                'z-index: 2 !important',
                'pointer-events: none !important',
            ];
            if (hasBottomBorder) {
                sAfter.push(`background: ${barColor} !important`);
                sAfter.push(`-webkit-clip-path: ${barClip} !important`);
                sAfter.push(`clip-path: ${barClip} !important`);
            } else {
                sAfter.push('background: transparent !important');
                sAfter.push('-webkit-clip-path: none !important');
                sAfter.push('clip-path: none !important');
            }
            rules.push(`${cs}::after {\n    ${sAfter.join(';\n    ')};\n}`);
        }

        return rules.join('\n');
    }

    // ::before — banner image + mask-image fade
    {
        const beforeDecls = [
            'content: "" !important',
            'position: absolute !important',
            ...layerGeometry,
            'box-sizing: border-box !important',
            'border: none !important',
            'z-index: 1 !important',
            'pointer-events: none !important',
        ];
        addBannerBackground(beforeDecls);
        // Chat Design is authoritative over the image fade. Emit an explicit
        // mask even when there's no fade: a solid banner style (Bottom Fade = 0)
        // must cancel the default fade mask that the Character Design tab always
        // stamps on ::before, otherwise the image keeps ghosting out at the
        // bottom. Styles that DO set a fade get their computed mask unchanged.
        beforeDecls.push(maskCSS || '-webkit-mask-image: none !important;\n    mask-image: none !important');
        rules.push(`${cs}::before {\n    ${beforeDecls.join(';\n    ')};\n}`);
    }

    // ::after — overlay + border.
    //
    // This layer is deliberately NOT masked. A fade mask goes transparent at
    // the bottom of the band — exactly where the bottom border sits — so
    // masking ::after erases the border (the accent underline). To still let
    // the overlay fade with the image when a Bottom Fade is set, the overlay is
    // emitted as a vertical gradient that mirrors the ::before image-mask
    // profile, instead of a solid fill + mask. The border then renders crisp.
    {
        const afterDecls = [
            'content: "" !important',
            'position: absolute !important',
            ...layerGeometry,
            'box-sizing: border-box !important',
            'z-index: 2 !important',
            'pointer-events: none !important',
        ];

        if (hasOverlay && !usesComposedOverlay) {
            const rgb = hexToRgb(overlayPrimary);
            const oOp = overlayOpacity;
            if (hasBottomFade) {
                // Gradient fade (mirrors the ::before mask) so the overlay
                // ghosts out with the image while the border below stays crisp.
                const o = p.bottomFadeOpacity ?? 0;
                const solidEnd = Math.round((1 - o) * 80);
                const solid = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${oOp})`;
                const clear = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`;
                afterDecls.push(`background: linear-gradient(to bottom, ${solid} ${solidEnd}%, ${clear} 100%) !important`);
            } else {
                afterDecls.push(`background: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${oOp}) !important`);
            }
        }

        afterDecls.push(borders.top.declaration);
        afterDecls.push(borders.left.declaration);
        afterDecls.push(borders.right.declaration);
        afterDecls.push(borders.bottom.declaration);
        if (hasBorderRadius) {
            afterDecls.push(`border-radius: ${p.borderRadius}px ${p.borderRadius}px 0 0 !important`);
        }

        rules.push(`${cs}::after {\n    ${afterDecls.join(';\n    ')};\n}`);
    }

    return rules.join('\n');
}

function buildThinkingCSS(properties, selector) {
    const preset = ['soft', 'outline', 'quiet', 'custom'].includes(properties.thinkingPreset)
        ? properties.thinkingPreset
        : 'native';
    if (preset === 'native') return '';

    const radius = clampNumber(properties.thinkingRadius, 0, 24, 5);
    const strength = clampNumber(properties.thinkingAccentStrength, 0, 100, 60);
    const fillStrength = Math.round(strength * 0.25);
    const hoverStrength = Math.min(100, fillStrength + 8);
    const edgeStrength = Math.min(100, strength + 15);
    const accent = `color-mix(in srgb, var(--SmartThemeQuoteColor, #97a7c6) ${edgeStrength}%, transparent)`;
    const nativeSurface = 'var(--grey30, rgba(128, 128, 128, 0.3))';
    const messageSelector = chatSel(selector);
    const headerSelector = `${messageSelector} .mes_reasoning_header`;
    const interactiveSelector = `${messageSelector} .mes_reasoning_summary:is(:hover, :focus-visible) .mes_reasoning_header`;
    const declarations = [`border-radius: ${radius}px !important`];
    let hoverBackground;

    if (preset === 'custom') {
        const textColor = safeHexColor(properties.thinkingTextColor, '#f5f2f8');
        const backgroundColor = safeHexColor(properties.thinkingBackgroundColor, '#242129');
        const borderColor = safeHexColor(properties.thinkingBorderColor, '#8f72bd');
        const borderWidth = clampNumber(properties.thinkingBorderWidth, 1, 8, 1);
        const borderStyle = ['solid', 'dashed', 'dotted', 'double'].includes(properties.thinkingBorderStyle)
            ? properties.thinkingBorderStyle
            : 'solid';
        declarations.push(
            `color: ${textColor} !important`,
            `background-color: ${backgroundColor} !important`,
            `border: ${borderWidth}px ${borderStyle} ${borderColor} !important`,
            'box-shadow: none !important',
        );
        hoverBackground = backgroundColor;
    } else if (preset === 'soft') {
        declarations.push(
            `background-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #97a7c6) ${fillStrength}%, ${nativeSurface}) !important`,
            `box-shadow: inset 3px 0 0 ${accent} !important`,
        );
        hoverBackground = `color-mix(in srgb, var(--SmartThemeQuoteColor, #97a7c6) ${hoverStrength}%, ${nativeSurface})`;
    } else if (preset === 'outline') {
        declarations.push(
            `background-color: color-mix(in srgb, ${nativeSurface} 45%, transparent) !important`,
            `border: 1px solid ${accent} !important`,
            'box-shadow: none !important',
        );
        hoverBackground = `color-mix(in srgb, var(--SmartThemeQuoteColor, #97a7c6) ${fillStrength}%, ${nativeSurface})`;
    } else {
        declarations.push(
            'background-color: transparent !important',
            'border: none !important',
            `border-left: 2px solid ${accent} !important`,
            'box-shadow: none !important',
            'padding-left: 12px !important',
        );
        hoverBackground = `color-mix(in srgb, var(--SmartThemeQuoteColor, #97a7c6) ${fillStrength}%, transparent)`;
    }

    const rules = [
        `${headerSelector} {\n    ${declarations.join(';\n    ')};\n}`,
        `${interactiveSelector} {\n    background-color: ${hoverBackground} !important;\n}`,
    ];
    if (properties.thinkingBodyEnabled !== false) {
        rules.push(`${messageSelector} .mes_reasoning {\n    border-left-color: ${accent} !important;\n}`);
    }
    return rules.join('\n');
}

/**
 * Build CSS for a Container (message box) style.
 */
function buildContainerCSS(style, selector) {
    const p = style.properties;
    const decls = [];
    const rules = [];
    const widthForOffset = offset => offset > 0
        ? `calc(100% - ${offset}px)`
        : offset < 0 ? `calc(100% + ${Math.abs(offset)}px)` : '100%';
    const extraPadding = clampNumber(p.paddingExtra, 0, 200, 0);
    // Styles created before paddingEnabled used any positive paddingExtra as an
    // implicit opt-in. Keep that exact behavior until each style is edited.
    const hasPaddingOverride = p.paddingEnabled === true
        || (p.paddingEnabled == null && extraPadding > 0);

    // An enabled value becomes Banner's stable top anchor. When disabled the
    // property is invalidated so Banner falls back to its own padding setting.
    decls.push(hasPaddingOverride
        ? `--wl-cdm-container-extra-padding: ${extraPadding}px`
        : '--wl-cdm-container-extra-padding: initial');
    const hasBorder = p.borderWidth > 0 && p.borderStyle !== 'none';
    decls.push(hasBorder
        ? `border: ${p.borderWidth}px ${p.borderStyle} ${p.borderColor} !important`
        : 'border: none !important');
    decls.push(`border-radius: ${clampNumber(p.borderRadius, 0, 24, 0)}px !important`);
    decls.push(p.boxShadow && p.boxShadow !== 'none'
        ? `box-shadow: ${p.boxShadow} !important`
        : 'box-shadow: none !important');
    if (p.marginTop > 0) decls.push(`margin-top: ${p.marginTop}px !important`);
    if (p.marginBottom > 0) decls.push(`margin-bottom: ${p.marginBottom}px !important`);
    if (hasPaddingOverride) {
        decls.push('--mes-right-spacing: 0px');
        decls.push(`padding-right: ${extraPadding}px !important`);
        decls.push(`padding-bottom: ${extraPadding}px !important`);
        decls.push(`padding-left: ${extraPadding}px !important`);
        decls.push(`padding-top: ${extraPadding}px !important`);
    }

    if (decls.length > 0) {
        rules.push(`${chatSel(selector)} {\n    ${decls.join(';\n    ')};\n}`);
    }

    if (hasPaddingOverride) {
        const messageSelector = chatSel(selector);
        // Make the override authoritative across SillyTavern's nested message
        // insets so 0px truly exposes the full interior of the outer border.
        rules.push(`${messageSelector} .mes_block {\n    padding-left: 0 !important;\n}`);
        rules.push(`${messageSelector} .mes_text {\n    padding-right: 0 !important;\n}`);
        rules.push(`${messageSelector} .mes_reasoning_details {\n    margin-right: 0 !important;\n}`);
    }

    if (p.contentAreaEnabled === true) {
        const contentDecls = [
            'box-sizing: border-box !important',
            `background: ${rgbaFromHex(p.contentBackgroundColor || '#000000', clampNumber(p.contentBackgroundOpacity, 0, 1, 0.6))} !important`,
        ];
        const contentBorderWidth = clampNumber(p.contentBorderWidth, 0, 8, 0);
        const contentBorderStyle = p.contentBorderStyle || 'solid';
        if (contentBorderWidth > 0 && contentBorderStyle !== 'none') {
            contentDecls.push(`border: ${contentBorderWidth}px ${contentBorderStyle} ${p.contentBorderColor || '#ffffff'} !important`);
        } else {
            contentDecls.push('border: none !important');
        }
        contentDecls.push(`border-radius: ${clampNumber(p.contentBorderRadius, 0, 60, 0)}px !important`);
        contentDecls.push(p.contentBoxShadow && p.contentBoxShadow !== 'none'
            ? `box-shadow: ${p.contentBoxShadow} !important`
            : 'box-shadow: none !important');

        const contentAreaOffsetX = clampNumber(p.contentAreaOffsetX, -600, 600, 0);
        const contentAreaOffsetY = clampNumber(p.contentAreaOffsetY, -300, 300, 0);
        const availableContentWidth = widthForOffset(contentAreaOffsetX);
        const contentWidth = clampNumber(p.contentWidth, 0, 1200, 0);
        if (contentWidth > 0) {
            contentDecls.push(`width: min(${contentWidth}px, ${availableContentWidth}) !important`);
            contentDecls.push(`flex: 0 1 ${contentWidth}px !important`);
            contentDecls.push(`max-width: ${availableContentWidth} !important`);
        } else if (contentAreaOffsetX !== 0) {
            // A negative offset reclaims space on the left, so expand by the
            // same amount to keep the right edge anchored to the container.
            contentDecls.push(`width: ${availableContentWidth} !important`);
            contentDecls.push(`max-width: ${availableContentWidth} !important`);
        }
        const contentMinHeight = clampNumber(p.contentMinHeight, 0, 300, 0);
        contentDecls.push(`min-height: ${contentMinHeight}px !important`);
        if (contentAreaOffsetX !== 0 || contentAreaOffsetY !== 0) {
            contentDecls.push('position: relative !important');
            contentDecls.push(`left: ${contentAreaOffsetX}px !important`);
            contentDecls.push(`top: ${contentAreaOffsetY}px !important`);
        }
        rules.push(`${chatSel(selector)} .mes_block {\n    ${contentDecls.join(';\n    ')};\n}`);
    }

    // Older styles stored a positive contentIndent. Treat it as the new
    // horizontal offset until that style is edited, preserving its appearance.
    const contentOffsetX = Math.min(240, Math.max(-240, Number(p.contentOffsetX ?? p.contentIndent) || 0));
    const contentOffsetY = Math.min(120, Math.max(-120, Number(p.contentOffsetY) || 0));
    const contentTextWidth = clampNumber(p.contentTextWidth, 0, 1200, 0);
    if (contentOffsetX !== 0 || contentOffsetY !== 0 || contentTextWidth > 0) {
        const contentSelector = chatSel(selector);
        const availableTextWidth = widthForOffset(contentOffsetX);
        const textDecls = [
            '    box-sizing: border-box !important',
        ];
        if (contentTextWidth > 0) {
            textDecls.push(`    width: min(${contentTextWidth}px, ${availableTextWidth}) !important`);
            textDecls.push(`    max-width: ${availableTextWidth} !important`);
        } else if (contentOffsetX !== 0) {
            textDecls.push(`    width: ${availableTextWidth} !important`);
            textDecls.push(`    max-width: ${availableTextWidth} !important`);
        }
        if (contentOffsetX !== 0 || contentOffsetY !== 0) {
            textDecls.push('    position: relative !important');
            textDecls.push(`    left: ${contentOffsetX}px !important`);
            textDecls.push(`    top: ${contentOffsetY}px !important`);
        }
        rules.push(`${contentSelector} .mes_reasoning_details,\n` +
            `${contentSelector} .mes_text {\n` +
            `${textDecls.join(';\n')};\n` +
            '}');
    }

    const thinkingCSS = buildThinkingCSS(p, selector);
    if (thinkingCSS) rules.push(thinkingCSS);

    return rules.join('\n');
}

/**
 * Build the optional message-action layer stored alongside Message Elements.
 * Edit-mode controls deliberately stay theme-native; this targets only the
 * standard action row and action divs injected into extraMesButtons.
 */
function buildMessageActionCSS(style, selector) {
    const p = style.properties || {};
    if (p.actionButtonsEnabled !== true) return '';

    const messageSelector = chatSel(selector);
    const rowList = [
        `${messageSelector} .mes_buttons`,
        `${messageSelector} .extraMesButtons`,
    ];
    const primaryRowSelector = rowList[0];
    const buttonList = [
        `${messageSelector} .mes_buttons > .mes_button`,
        `${messageSelector} .extraMesButtons > div`,
    ];
    const rowSelector = rowList.join(',\n');
    const buttonSelector = buttonList.join(',\n');
    const hoverSelector = buttonList.map(item => `${item}:is(:hover, :focus-visible)`).join(',\n');
    const iconSelector = buttonList.map(item => `${item} > :is(svg, i)`).join(',\n');

    const offsetX = clampNumber(p.actionOffsetX, -400, 400, 0);
    const offsetY = clampNumber(p.actionOffsetY, -250, 250, 0);
    const buttonSize = clampNumber(p.actionButtonSize, 18, 44, 26);
    const iconSize = clampNumber(p.actionIconSize, 10, 24, 14);
    const gap = clampNumber(p.actionGap, 0, 16, 4);
    const radius = clampNumber(p.actionRadius, 0, 44, 5);
    const visibility = ['always', 'dim', 'hidden'].includes(p.actionVisibility)
        ? p.actionVisibility
        : 'dim';
    const restingOpacity = visibility === 'hidden'
        ? 0
        : visibility === 'dim'
            ? clampNumber(p.actionRestingOpacity, 0.05, 0.95, 0.45)
            : 1;
    const surface = ['bare', 'solid', 'outline', 'glass'].includes(p.actionSurface)
        ? p.actionSurface
        : 'bare';
    const motion = ['none', 'color', 'lift', 'pop', 'tilt', 'snap'].includes(p.actionHoverMotion)
        ? p.actionHoverMotion
        : 'color';
    const speed = {
        slow: { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        normal: { duration: 180, easing: 'ease' },
        fast: { duration: 90, easing: 'linear' },
    }[p.actionAnimationSpeed] || { duration: 180, easing: 'ease' };
    const duration = motion === 'none' ? 0 : speed.duration;
    const transition = motion === 'none'
        ? 'none'
        : [
            `color ${duration}ms ${speed.easing}`,
            `background-color ${duration}ms ${speed.easing}`,
            `border-color ${duration}ms ${speed.easing}`,
            `box-shadow ${duration}ms ${speed.easing}`,
            ...(motion === 'color' ? [] : [`transform ${duration}ms ${speed.easing}`]),
        ].join(', ');
    const hoverTransform = {
        none: 'none',
        color: 'none',
        lift: 'translateY(-2px)',
        pop: 'translateY(-1px) scale(1.1)',
        tilt: 'translateY(-2px) scale(1.08) rotate(8deg)',
        snap: 'translateX(-2px)',
    }[motion];
    const shadow = {
        none: 'none',
        soft: '0 3px 10px rgba(0, 0, 0, 0.24)',
        strong: '0 6px 18px rgba(0, 0, 0, 0.46)',
    }[p.actionShadow] || 'none';
    const restingIcon = p.actionRestingIconColor || '#d8d5df';
    const restingSurface = p.actionRestingSurfaceColor || '#242129';
    const hoverIcon = p.actionHoverIconColor || '#ffffff';
    const hoverSurface = p.actionHoverSurfaceColor || '#8f72bd';

    const rowDecls = [
        'align-items: center !important',
        `gap: ${gap}px !important`,
        `flex-direction: ${p.actionReverse ? 'row-reverse' : 'row'} !important`,
        'overflow: visible !important',
    ];
    const primaryRowDecls = [
        'opacity: 1 !important',
        `transition: opacity ${duration}ms ${speed.easing} !important`,
    ];
    if (offsetX !== 0 || offsetY !== 0) {
        // Once the row is deliberately moved away from its native header
        // position, remove its width from that flex layout too. Relative
        // positioning only changes where it is painted, so expanded actions
        // would still squeeze/wrap the timestamp and model metadata.
        primaryRowDecls.push('position: absolute !important');
        primaryRowDecls.push('z-index: 4 !important');
        primaryRowDecls.push(`right: ${-offsetX}px !important`);
        primaryRowDecls.push(`top: ${offsetY}px !important`);
    }

    const buttonDecls = [
        'box-sizing: border-box !important',
        `flex: 0 0 ${buttonSize}px !important`,
        `width: ${buttonSize}px !important`,
        `height: ${buttonSize}px !important`,
        `min-width: ${buttonSize}px !important`,
        `min-height: ${buttonSize}px !important`,
        'margin: 0 !important',
        'padding: 0 !important',
        `font-size: ${iconSize}px !important`,
        `line-height: ${buttonSize}px !important`,
        'text-align: center !important',
        'vertical-align: middle !important',
        `color: ${restingIcon} !important`,
        `border-radius: ${radius}px !important`,
        `box-shadow: ${shadow} !important`,
        'filter: none !important',
        'opacity: 1 !important',
        'transform: none !important',
        `transition: ${transition} !important`,
    ];
    if (surface === 'bare') {
        buttonDecls.push('background-color: transparent !important');
        buttonDecls.push('border: 0 !important');
        buttonDecls.push('backdrop-filter: none !important');
        buttonDecls.push('-webkit-backdrop-filter: none !important');
    } else if (surface === 'outline') {
        buttonDecls.push('background-color: transparent !important');
        buttonDecls.push(`border: 1px solid ${restingSurface} !important`);
    } else if (surface === 'glass') {
        buttonDecls.push(`background-color: ${rgbaFromHex(restingSurface, 0.16)} !important`);
        buttonDecls.push('border: 1px solid rgba(255, 255, 255, 0.16) !important');
        buttonDecls.push('backdrop-filter: blur(2px) !important');
        buttonDecls.push('-webkit-backdrop-filter: blur(2px) !important');
    } else {
        buttonDecls.push(`background-color: ${restingSurface} !important`);
        buttonDecls.push('border: 0 !important');
    }

    const hoverDecls = [
        `color: ${hoverIcon} !important`,
        `transform: ${hoverTransform} !important`,
    ];
    if (surface === 'outline') {
        hoverDecls.push(`background-color: ${rgbaFromHex(hoverSurface, 0.18)} !important`);
        hoverDecls.push(`border-color: ${hoverSurface} !important`);
    } else if (surface === 'glass') {
        hoverDecls.push(`background-color: ${rgbaFromHex(hoverSurface, 0.82)} !important`);
    } else if (surface === 'solid') {
        hoverDecls.push(`background-color: ${hoverSurface} !important`);
    }

    const rules = [
        `${rowSelector} {\n    ${rowDecls.join(';\n    ')};\n}`,
        `${primaryRowSelector} {\n    ${primaryRowDecls.join(';\n    ')};\n}`,
        `${buttonSelector} {\n    ${buttonDecls.join(';\n    ')};\n}`,
        `${iconSelector} {\n    width: ${iconSize}px !important;\n    height: ${iconSize}px !important;\n    font-size: ${iconSize}px !important;\n}`,
        `${hoverSelector} {\n    ${hoverDecls.join(';\n    ')};\n}`,
    ];

    if (offsetX !== 0 || offsetY !== 0) {
        // SillyTavern clips .mes_block on both axes. Let the positioned action
        // row cross the content boundary into a banner or message gutter.
        rules.unshift(
            `${messageSelector} .mes_block,\n` +
            `${messageSelector} .ch_name {\n    overflow: visible !important;\n}\n` +
            `${messageSelector} .ch_name {\n    position: relative !important;\n}`,
        );
    }

    if (restingOpacity < 1) {
        const revealSelector = `${messageSelector}:is(:hover, :focus-within) .mes_buttons`;
        rules.push(`@media (hover: hover) and (pointer: fine) {\n${primaryRowSelector} {\n    opacity: ${restingOpacity} !important;\n}\n${revealSelector} {\n    opacity: 1 !important;\n}\n}`);
    }

    rules.push(`@media (prefers-reduced-motion: reduce) {\n${rowSelector},\n${buttonSelector} {\n    transition: none !important;\n}\n${hoverSelector} {\n    transform: none !important;\n}\n}`);
    return rules.join('\n');
}

function getAvatarEdgeFadeMask(value) {
    const edgeFade = clampNumber(value, 0, 80, 0);
    if (edgeFade <= 0) return '';
    const solidUntil = 100 - edgeFade;
    return [
        `linear-gradient(to right, #000 0%, #000 ${solidUntil}%, transparent 100%)`,
        `linear-gradient(to bottom, #000 0%, #000 ${solidUntil}%, transparent 100%)`,
    ].join(', ');
}

function effectiveAvatarShape(properties) {
    const useCustom = Object.prototype.hasOwnProperty.call(properties, 'shapeUseCustom')
        ? properties.shapeUseCustom === true
        : !!properties.shape && properties.shape !== 'theme';
    return useCustom && ['circle', 'square', 'rounded', 'rectangle'].includes(properties.shape)
        ? properties.shape
        : 'theme';
}

function avatarUsesCustomObjectFit(properties) {
    const x = Number(properties.objectPositionX);
    const y = Number(properties.objectPositionY);
    return Object.prototype.hasOwnProperty.call(properties, 'objectFitUseCustom')
        ? properties.objectFitUseCustom === true
        : (!!properties.objectFit && properties.objectFit !== 'theme')
            || (Number.isFinite(x) && x !== 50)
            || (Number.isFinite(y) && y !== 50);
}

function effectiveAvatarObjectFit(properties) {
    return avatarUsesCustomObjectFit(properties) && ['cover', 'contain', 'fill'].includes(properties.objectFit)
        ? properties.objectFit
        : 'theme';
}

/** Build the optional CSS-only tint/gradient layered above an avatar image. */
function buildAvatarOverlayCSS(p, selector) {
    if (p.avatarOverlayEnabled !== true) return '';

    const type = p.avatarOverlayType === 'gradient' ? 'gradient' : 'solid';
    const primary = /^#[0-9a-f]{6}$/i.test(p.avatarOverlayPrimaryColor || '')
        ? p.avatarOverlayPrimaryColor
        : '#d49a74';
    const secondary = /^#[0-9a-f]{6}$/i.test(p.avatarOverlaySecondaryColor || '')
        ? p.avatarOverlaySecondaryColor
        : '#71405b';
    const opacity = clampNumber(p.avatarOverlayOpacity, 0, 1, 0.32);
    const angle = clampNumber(p.avatarOverlayAngle, 0, 360, 135);
    const blendMode = [
        'normal', 'multiply', 'screen', 'overlay', 'soft-light', 'color',
    ].includes(p.avatarOverlayBlendMode)
        ? p.avatarOverlayBlendMode
        : 'soft-light';
    const vignette = clampNumber(p.avatarOverlayVignette, 0, 0.85, 0);
    const borderInset = p.borderWidth > 0 && p.borderStyle !== 'none'
        ? clampNumber(p.borderWidth, 0, 6, 0)
        : 0;
    const fill = type === 'gradient'
        ? `linear-gradient(${angle}deg, ${primary} 0%, ${secondary} 100%)`
        : primary;
    const backgrounds = [];
    if (vignette > 0) {
        backgrounds.push(`radial-gradient(circle at center, transparent 42%, rgba(0, 0, 0, ${vignette}) 100%)`);
    }
    backgrounds.push(fill);

    const shape = effectiveAvatarShape(p);
    let radius = 'inherit';
    if (shape === 'circle') radius = '50%';
    else if (shape === 'square' || shape === 'rectangle') radius = '0';
    else if (shape === 'rounded') radius = '8px';
    else if (p.borderRadius >= 0 && shape !== 'theme') radius = `${p.borderRadius}px`;

    const overlayDecls = [
        'content: "" !important',
        'position: absolute !important',
        `inset: ${borderInset}px !important`,
        'z-index: 2 !important',
        'pointer-events: none !important',
        `border-radius: ${radius} !important`,
        `background: ${backgrounds.join(', ')} !important`,
        `opacity: ${opacity} !important`,
        `mix-blend-mode: ${blendMode} !important`,
    ];
    const edgeMask = getAvatarEdgeFadeMask(p.edgeFade);
    if (edgeMask) {
        overlayDecls.push(`-webkit-mask-image: ${edgeMask} !important`);
        overlayDecls.push(`mask-image: ${edgeMask} !important`);
        overlayDecls.push('-webkit-mask-composite: source-in !important');
        overlayDecls.push('mask-composite: intersect !important');
        overlayDecls.push('-webkit-mask-repeat: no-repeat !important');
        overlayDecls.push('mask-repeat: no-repeat !important');
    }

    return `${selector} .avatar {\n    position: relative !important;\n    isolation: isolate !important;\n}\n` +
        `${selector} .avatar img {\n    position: relative !important;\n    z-index: 1 !important;\n}\n` +
        `${selector} .avatar::after {\n    ${overlayDecls.join(';\n    ')};\n}`;
}

/**
 * Build CSS for an Avatar style.
 * Targets: `.avatar img` inside the message selector.
 */
function buildAvatarCSS(style, selector) {
    const p = style.properties;
    const rules = [];
    const decls = [];
    const shape = effectiveAvatarShape(p);

    // Styles created before independent dimensions existed keep their combined
    // size (including the old rectangle ratio) until the editor backfills them.
    const legacySize = clampNumber(p.size, 0, 400, 0);
    const hasExplicitWidth = Object.prototype.hasOwnProperty.call(p, 'width');
    const hasExplicitHeight = Object.prototype.hasOwnProperty.call(p, 'height');
    const avatarWidth = hasExplicitWidth ? clampNumber(p.width, 0, 300, 0) : legacySize;
    const legacyHeight = shape === 'rectangle' ? Math.round(legacySize * 1.4) : legacySize;
    const avatarHeight = hasExplicitHeight ? clampNumber(p.height, 0, 400, 0) : legacyHeight;
    if (avatarWidth > 0) decls.push(`width: ${avatarWidth}px !important`);
    if (avatarHeight > 0) decls.push(`height: ${avatarHeight}px !important`);
    if (avatarWidth > 0 || avatarHeight > 0) decls.push('box-sizing: border-box !important');

    const objectFit = effectiveAvatarObjectFit(p);
    const objectFitUsesCustom = avatarUsesCustomObjectFit(p);
    const objectPositionX = clampNumber(p.objectPositionX, 0, 100, 50);
    const objectPositionY = clampNumber(p.objectPositionY, 0, 100, 50);
    if (objectFit !== 'theme') decls.push(`object-fit: ${objectFit} !important`);
    if (objectFitUsesCustom) {
        decls.push(`object-position: ${objectPositionX}% ${objectPositionY}% !important`);
    }
    const hasBorder = p.borderWidth > 0 && p.borderStyle !== 'none';
    decls.push(hasBorder
        ? `border: ${p.borderWidth}px ${p.borderStyle} ${p.borderColor} !important`
        : 'border: none !important');

    // Shape override
    if (shape === 'circle') decls.push('border-radius: 50% !important');
    else if (shape === 'square') decls.push('border-radius: 0 !important');
    else if (shape === 'rounded') decls.push('border-radius: 8px !important');
    else if (shape === 'rectangle') {
        decls.push('border-radius: 0 !important');
    } else if (p.borderRadius >= 0 && shape !== 'theme') {
        decls.push(`border-radius: ${p.borderRadius}px !important`);
    }

    decls.push(p.boxShadow && p.boxShadow !== 'none'
        ? `box-shadow: ${p.boxShadow} !important`
        : 'box-shadow: none !important');
    if (p.opacity < 1 && p.opacity >= 0) decls.push(`opacity: ${p.opacity} !important`);

    const mask = getAvatarEdgeFadeMask(p.edgeFade);
    if (mask) {
        decls.push(`-webkit-mask-image: ${mask} !important`);
        decls.push(`mask-image: ${mask} !important`);
        decls.push('-webkit-mask-composite: source-in !important');
        decls.push('mask-composite: intersect !important');
        decls.push('-webkit-mask-repeat: no-repeat !important');
        decls.push('mask-repeat: no-repeat !important');
    } else {
        // Edge Fade = 0 is authoritative, so theme-provided avatar masks do not
        // remain visible in the same way native borders/shadows once did.
        decls.push('-webkit-mask-image: none !important');
        decls.push('mask-image: none !important');
    }

    if (decls.length > 0) {
        rules.push(`${selector} .avatar img {\n    ${decls.join(';\n    ')};\n}`);
    }

    const overlayCSS = buildAvatarOverlayCSS(p, selector);
    if (overlayCSS) rules.push(overlayCSS);

    // Keep the layout reservation aligned with the independently-sized frame.
    if (avatarWidth > 0 || avatarHeight > 0) {
        const frameDecls = [];
        if (avatarWidth > 0) {
            frameDecls.push(`width: ${avatarWidth}px !important`);
            frameDecls.push(`min-width: ${avatarWidth}px !important`);
        }
        if (avatarHeight > 0) {
            frameDecls.push(`height: ${avatarHeight}px !important`);
            frameDecls.push(`min-height: ${avatarHeight}px !important`);
        }
        rules.push(`${selector} .avatar {\n    ${frameDecls.join(';\n    ')};\n}`);
    }

    // Offset only the visible avatar. Message metadata also lives in the avatar
    // wrapper, so moving the wrapper itself would unintentionally drag the
    // message number, token count, and generation time along with it.
    const ox = p.offsetX || 0;
    const oy = p.offsetY || 0;
    const detach = !!p.detachFromLayout;
    const reservedAvatarHeight = avatarHeight > 0 ? Math.max(0, avatarHeight + oy) : 0;
    if (ox !== 0 || oy !== 0) {
        rules.push(`${selector} .avatar {\n    position: relative !important;\n    left: ${ox}px !important;\n    top: ${oy}px !important;\n    z-index: 4 !important;\n}`);
    }

    if (oy !== 0 && avatarHeight > 0 && !detach) {
        // Relative positioning keeps the avatar's unshifted height in flex
        // layout. Reserve its visible bottom edge instead so short and long
        // message surfaces end with the same spacing.
        rules.push(`${selector} .mesAvatarWrapper {\n    height: ${reservedAvatarHeight}px !important;\n    min-height: ${reservedAvatarHeight}px !important;\n    overflow: visible !important;\n}`);
    }

    if (ox !== 0 || oy !== 0 || detach) {
        // Avatar offsets are allowed to cross the message card boundary. Both
        // ancestors must permit overflow: themes commonly clip the message,
        // while the wrapper can clip a translated avatar independently.
        rules.push(`${selector},\n${selector} .mesAvatarWrapper {\n    overflow: visible !important;\n}`);
    }

    // detachFromLayout collapses only the wrapper's column. The avatar remains
    // relatively positioned and visible, while .mes_block reclaims the space.
    if (detach) {
        const wrapDecls = [
            'position: relative !important',
            'width: 0 !important',
            'min-width: 0 !important',
            'flex: 0 0 0 !important',
        ];
        if (reservedAvatarHeight > 0) {
            wrapDecls.push(`min-height: ${reservedAvatarHeight}px !important`);
        }
        wrapDecls.push('margin: 0 !important');
        wrapDecls.push('overflow: visible !important');
        rules.push(`${selector} .mesAvatarWrapper {\n    ${wrapDecls.join(';\n    ')};\n}`);
        rules.push(`${selector} {\n    gap: 0 !important;\n}`);
    }

    const detailsX = (p.detailsOffsetX || 0) + (p.detailsFollowAvatar ? ox : 0);
    const detailsY = (p.detailsOffsetY || 0) + (p.detailsFollowAvatar ? oy : 0);
    if (detailsX !== 0 || detailsY !== 0) {
        const detailsSelector = [
            `${selector} .mes_timer`,
            `${selector} .mesIDDisplay`,
            `${selector} .tokenCounterDisplay`,
        ].join(',\n');
        rules.push(`${detailsSelector} {\n    position: relative !important;\n    left: ${detailsX}px !important;\n    top: ${detailsY}px !important;\n}`);
    }

    const timestampX = clampNumber(p.timestampOffsetX, -200, 200, 0);
    const timestampY = clampNumber(p.timestampOffsetY, -600, 600, 0);
    if (timestampX !== 0 || timestampY !== 0) {
        // `translate` composes with the name style's existing left/top offset,
        // so this remains an independent nudge instead of replacing it.
        rules.push(`${selector} .timestamp {\n    position: relative !important;\n    translate: ${timestampX}px ${timestampY}px !important;\n}`);
    }

    const modelIconX = clampNumber(p.modelIconOffsetX, -200, 200, 0);
    const modelIconY = clampNumber(p.modelIconOffsetY, -600, 600, 0);
    if (modelIconX !== 0 || modelIconY !== 0) {
        rules.push(`${selector} .timestamp-icon {\n    position: relative !important;\n    translate: ${modelIconX}px ${modelIconY}px !important;\n}`);
    }

    const messageActionCSS = buildMessageActionCSS(style, selector);
    if (messageActionCSS) rules.push(messageActionCSS);

    return rules.join('\n');
}

// ============================================================
// Style → CSS Routing
// ============================================================

const CSS_BUILDERS = {
    dialogue: buildFontsCSS,
    banner: buildBannerCSS,
    container: buildContainerCSS,
    avatar: buildAvatarCSS,
};

function buildUIFontCSS(style) {
    const properties = style.properties || {};
    const decls = buildFontDeclarations(properties, 'ui');
    const family = properties.uiFontFamily;
    const familyUsesCustom = Object.prototype.hasOwnProperty.call(properties, 'uiFontFamilyUseCustom')
        ? properties.uiFontFamilyUseCustom === true
        : !isDefaultFont(family);

    if (familyUsesCustom && !isDefaultFont(family)) {
        // SillyTavern and its extensions commonly consume this variable rather
        // than inheriting body font-family directly.
        decls.unshift(`--mainFontFamily: ${getFontFamilyCSS(family)} !important`);
    }

    if (properties.uiTextColorUseCustom === true && /^#[0-9a-f]{6}$/i.test(properties.uiTextColor || '')) {
        decls.push(
            `--bd-light-ui-text: ${properties.uiTextColor} !important`,
            `--bd-light-ui-muted: color-mix(in srgb, ${properties.uiTextColor} 58%, transparent) !important`,
        );
    }

    if (decls.length === 0) return '';
    return `body {\n    ${decls.join(';\n    ')};\n}`;
}

/**
 * Resolve the Fonts style that owns the current global interface typography.
 * Message/Dialogue rules remain per-message; only the Interface subsection is
 * resolved globally. Neutral UI settings do not mask a lower-priority style.
 */
function resolveActiveUIFontStyle(styles) {
    const fontStyles = styles.filter(style =>
        style.element === 'dialogue' && buildUIFontCSS(style).length > 0);
    if (fontStyles.length === 0) return null;

    const activeChar = getAppearanceAvatar() || null;
    const activePersona = !isGroupContext() && user_avatar ? cleanAvatar(user_avatar) : null;

    let winner = null;
    let bestScore = -1;
    for (const style of fontStyles) {
        let score = -1;
        if (style.isDefault) score = 0;

        if (activeChar && (style.assignedCharacters || []).some(a => cleanAvatar(a) === activeChar)) {
            score = 4;
        } else if (activePersona && (style.assignedPersonas || []).some(a => cleanAvatar(a) === activePersona)) {
            score = 3;
        } else if ((style.assignedVerses || []).length > 0) {
            const targets = resolveStyleTargets(style);
            const matchesActiveContext = targets.some(target =>
                (activeChar && target.charAvatar && cleanAvatar(target.charAvatar) === activeChar) ||
                (activePersona && target.personaAvatar && cleanAvatar(target.personaAvatar) === activePersona));
            if (matchesActiveContext) score = 1;
        }

        if (score > bestScore) {
            bestScore = score;
            winner = style;
        }
    }

    return winner;
}

function buildActiveUIFontCSS(styles) {
    const winner = resolveActiveUIFontStyle(styles);
    if (!winner) return '';
    const css = buildUIFontCSS(winner);
    return css ? `/* Interface Font: ${winner.name} */\n${css}` : '';
}

/**
 * Build CSS for a single style applied to a selector.
 * @param {object} style - Style object
 * @param {string} selector - CSS selector
 * @param {object} [context] - Optional: { avatarUrl, bannerPosition } for banner builder
 */
function buildStyleCSS(style, selector, context = {}) {
    const builder = CSS_BUILDERS[style.element];
    if (!builder) return '';
    if (style.element === 'banner') {
        return builder(style, selector, context.avatarUrl || null, context.bannerPosition ?? null);
    }
    return builder(style, selector);
}

// ============================================================
// Persona Banner Position Lookup
// ============================================================

/**
 * Get the banner position stored in WL's Persona Design tab for a persona avatar.
 * Falls back to null (caller uses the Chat Design style's own bannerPosition).
 */
function getPersonaBannerPosition(avatarId) {
    const designs = extension_settings[MODULE_NAME]?.personaDesigns || {};
    const pos = designs[avatarId]?.bannerPosition;
    return pos != null ? pos : null;
}

/**
 * Resolve the banner image URL a persona has chosen in WL's Persona Design tab,
 * so Chat Design draws the SAME image the drawer would (and honours "None").
 *   - bannerMode 'avatar'  → the persona's avatar
 *   - bannerMode 'custom'  → the custom URL/upload
 *   - none / unset / custom-without-url → null (no image drawn)
 * Mirrors buildPersonaCSS() in personaLore/designTab.js so the two agree.
 */
function getPersonaBannerImage(avatarId) {
    const designs = extension_settings[MODULE_NAME]?.personaDesigns || {};
    const d = designs[avatarId];
    if (!d || !d.bannerMode) return null;
    if (d.bannerMode === 'avatar') return `/User Avatars/${encodeURIComponent(avatarId)}`;
    if (d.bannerMode === 'custom' && d.bannerUrl) return normalizeBannerUrl(d.bannerUrl) || null;
    return null;
}

// ============================================================
// Background Overlay
// ============================================================
//
// Unlike the per-message element types, a Background style targets the single
// global background layers (#bg1 / #bg_custom). There is only ever ONE active
// background per chat, so these styles are NOT emitted per-.mes. Instead the
// winning style is resolved for the current chat context (see
// buildActiveBackgroundCSS) and emitted once.

/**
 * Build the CSS for one background style: a base rule on #bg1/#bg_custom
 * (positioning + image filters) plus an ::after overlay built from up to four
 * gradient layers. Returns '' if the style has no visible effect.
 */
function buildBackgroundOverlayCSS(style, options = {}) {
    const p = style.properties || {};
    const targets = Array.isArray(options.targets) && options.targets.length
        ? options.targets
        : ['#bg1', '#bg_custom'];
    const position = options.position === 'absolute' ? 'absolute' : 'fixed';
    const baseSelector = targets.join(',\n');
    const overlaySelector = targets.map(target => `${target}::after`).join(',\n');

    // ── Base element rule: positioning + image filters + zoom ──
    // Positioning is required so ::after (inset:0) covers the layer and so
    // overflow:hidden clips any blur/zoom overscan.
    const baseDecls = [
        `position: ${position} !important`,
        'inset: 0 !important',
        'overflow: hidden !important',
    ];

    const filters = [];
    if (p.blur > 0) filters.push(`blur(${p.blur}px)`);
    if (p.brightness != null && p.brightness !== 100) filters.push(`brightness(${p.brightness}%)`);
    if (p.contrast != null && p.contrast !== 100) filters.push(`contrast(${p.contrast}%)`);
    if (p.saturate != null && p.saturate !== 100) filters.push(`saturate(${p.saturate}%)`);
    if (p.grayscale > 0) filters.push(`grayscale(${p.grayscale}%)`);
    if (p.sepia > 0) filters.push(`sepia(${p.sepia}%)`);
    if (p.hueRotate) filters.push(`hue-rotate(${p.hueRotate}deg)`);
    if (filters.length) baseDecls.push(`filter: ${filters.join(' ')} !important`);
    if (p.zoom != null && p.zoom !== 100) baseDecls.push(`transform: scale(${p.zoom / 100}) !important`);

    const hasImageEffects = baseDecls.length > 3; // more than the 3 positioning decls

    // ── Overlay layers (painted top-most first in `background:`) ──
    const layers = [];
    // Texture sits on top of the glows/tint. Repeating-linear-gradients tile
    // themselves (no background-size needed), so this stays cheap to paint.
    if (p.textureType && p.textureType !== 'none' && p.textureOpacity > 0) {
        const c = rgbaFromHex(p.textureColor || '#ffffff', p.textureOpacity);
        const n = Math.max(2, p.textureScale ?? 3);
        if (p.textureType === 'scanlines') {
            layers.push(`repeating-linear-gradient(to bottom, ${c}, ${c} 1px, transparent 1px, transparent ${n}px)`);
        } else if (p.textureType === 'grid') {
            layers.push(`repeating-linear-gradient(to bottom, ${c}, ${c} 1px, transparent 1px, transparent ${n}px)`);
            layers.push(`repeating-linear-gradient(to right, ${c}, ${c} 1px, transparent 1px, transparent ${n}px)`);
        }
    }
    if (p.highlightOpacity > 0) {
        const c = rgbaFromHex(p.highlightColor || '#ffffff', p.highlightOpacity);
        layers.push(`radial-gradient(circle at center, ${c}, transparent ${p.highlightSize ?? 40}%)`);
    }
    if (p.accentOpacity > 0) {
        const c = rgbaFromHex(p.accentColor || '#785ca0', p.accentOpacity);
        const pos = p.accentPosition || 'bottom right';
        layers.push(`radial-gradient(circle at ${pos}, ${c}, transparent ${p.accentSize ?? 42}%)`);
    }
    if (p.vignetteOpacity > 0) {
        const c = rgbaFromHex(p.vignetteColor || '#000000', p.vignetteOpacity);
        layers.push(`radial-gradient(circle at center, transparent ${p.vignetteSize ?? 60}%, ${c})`);
    }
    if (p.tintTopOpacity > 0 || p.tintBottomOpacity > 0) {
        const top = rgbaFromHex(p.tintColor || '#050408', p.tintTopOpacity || 0);
        const bot = rgbaFromHex(p.tintColor || '#050408', p.tintBottomOpacity || 0);
        layers.push(`linear-gradient(${p.tintAngle ?? 180}deg, ${top}, ${bot})`);
    }

    let overlay = '';
    if (layers.length) {
        const decls = [
            'content: "" !important',
            'position: absolute !important',
            'inset: 0 !important',
            'pointer-events: none !important',
            'z-index: 1 !important',
            `background:\n        ${layers.join(',\n        ')} !important`,
        ];
        if (p.blendMode && p.blendMode !== 'normal') {
            decls.push(`mix-blend-mode: ${p.blendMode} !important`);
        }
        overlay = `${overlaySelector} {\n    ${decls.join(';\n    ')};\n}`;
    }

    // Nothing to do — neither image effects nor an overlay.
    if (!overlay && !hasImageEffects) return '';

    const base = `${baseSelector} {\n    ${baseDecls.join(';\n    ')};\n}`;
    return overlay ? `${base}\n\n${overlay}` : base;
}

/**
 * Build production rules for one isolated editor preview. The preview Shadow
 * DOM supplies a local #chat, while backgrounds use a local absolute layer so
 * preview CSS can never affect the page viewport.
 */
export function buildPreviewCSS(style, selector = '.wl-cdm-preview-message', context = {}) {
    if (!style) return '';
    if (style.element === 'background') {
        return buildBackgroundOverlayCSS(style, {
            targets: ['#wl-cdm-preview-bg'],
            position: 'absolute',
        });
    }
    const css = buildStyleCSS(style, selector, context);
    if (style.element !== 'dialogue') return css;

    const properties = style.properties || {};
    const uiDecls = buildFontDeclarations(properties, 'ui');
    if (properties.uiTextColorUseCustom === true && /^#[0-9a-f]{6}$/i.test(properties.uiTextColor || '')) {
        uiDecls.push(`color: ${properties.uiTextColor} !important`);
    }
    if (uiDecls.length === 0) return css;
    const uiCSS = `${selector} .wl-cdm-preview-ui,\n` +
        `${selector} .mes_reasoning_header {\n    ${uiDecls.join(';\n    ')};\n}`;
    return css ? `${css}\n${uiCSS}` : uiCSS;
}

/**
 * Resolve which background style applies to the CURRENT chat and return its
 * CSS. Priority (highest wins):
 *   3 — a style whose assignedCharacters includes the active character
 *   1 — a style whose verse membership includes the active character
 *   0 — a Default style
 * Personas are intentionally ignored: a persona shares the character's chat
 * background, so backgrounds key off the character only.
 */
function buildActiveBackgroundCSS(styles = getAllStyles()) {
    const bgStyles = styles.filter(s => s.enabled !== false && s.element === 'background');
    if (bgStyles.length === 0) return '';

    const activeChar = getAppearanceAvatar() || null;

    let winner = null;
    let bestScore = -1;
    for (const style of bgStyles) {
        let score = -1;
        if (style.isDefault) {
            score = 0;
        } else if (activeChar) {
            const direct = (style.assignedCharacters || []).some(a => cleanAvatar(a) === activeChar);
            if (direct) {
                score = 3;
            } else if ((style.assignedVerses || []).length > 0) {
                // Verse membership resolves to character avatars.
                const inVerse = resolveStyleTargets(style)
                    .some(t => t.charAvatar && cleanAvatar(t.charAvatar) === activeChar);
                if (inVerse) score = 1;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            winner = style;
        }
    }

    if (!winner) return '';
    const css = buildBackgroundOverlayCSS(winner);
    return css ? `/* Background: ${winner.name} */\n${css}` : '';
}

// ============================================================
// Full CSS Assembly
// ============================================================

function groupStyleTargets(style, targets) {
    const groups = new Map();
    for (const target of targets) {
        if (target.name === '__default__') continue;
        const avatar = target.personaAvatar || target.charAvatar;
        if (!avatar) continue;

        const context = style.element === 'banner' && target.personaAvatar
            ? {
                avatarUrl: getPersonaBannerImage(target.personaAvatar),
                bannerPosition: getPersonaBannerPosition(target.personaAvatar),
            }
            : { avatarUrl: null, bannerPosition: null };
        const key = style.element === 'banner'
            ? JSON.stringify([context.avatarUrl, context.bannerPosition])
            : 'shared';
        if (!groups.has(key)) groups.set(key, { avatars: [], names: [], context });
        const group = groups.get(key);
        if (!group.avatars.includes(avatar)) group.avatars.push(avatar);
        group.names.push(target.name || avatar);
    }
    return [...groups.values()];
}

function buildAssignedMessageSelector(avatars, direct = false) {
    const attributes = avatars.map(avatar => `[data-wl-avatar="${escapeCSSName(avatar)}"]`);
    if (attributes.length === 0) return '';
    const message = attributes.length === 1
        ? `.mes${attributes[0]}`
        : `.mes:is(${attributes.join(', ')})`;
    return direct ? `#chat ${message}` : message;
}

function styleMatchesChatScope(style, allowedAvatars) {
    if (typeof allowedAvatars?.has !== 'function' || style.isDefault) return true;
    const directlyAssigned = [
        ...(style.assignedCharacters || []),
        ...(style.assignedPersonas || []),
    ].some(avatar => allowedAvatars.has(cleanAvatar(avatar)));
    if (directlyAssigned) return true;
    return (style.assignedVerses || []).length > 0
        && resolveStyleTargets(style).some(target => {
            const avatar = target.personaAvatar || target.charAvatar;
            return avatar && allowedAvatars.has(cleanAvatar(avatar));
        });
}

/** Build stable per-message CSS from all active styles. */
export function buildMessageCSS(styles = getAllStyles(), options = {}) {
    const activeStyles = styles.filter(style => style.enabled !== false);
    if (activeStyles.length === 0) return '';
    const allowedAvatars = typeof options.allowedAvatars?.has === 'function'
        ? options.allowedAvatars : null;
    const targetIsAllowed = target => {
        if (!allowedAvatars) return true;
        const avatar = target.personaAvatar || target.charAvatar;
        return avatar ? allowedAvatars.has(cleanAvatar(avatar)) : false;
    };

    const sections = ['/* WL Chat Design — Messages */'];

    const defaults = [];
    const verseStyles = [];
    const charStyles = [];

    for (const style of activeStyles) {
        // Background, cursor, and General UI styles are global (not per-.mes) and are
        // resolved separately by buildContextCSS().
        if (style.element === 'background' || style.element === 'cursor' || style.element === 'generalUi') continue;
        if (style.isDefault) {
            defaults.push(style);
        } else {
            if (style.assignedVerses?.length > 0) verseStyles.push(style);
            if (style.assignedCharacters?.length > 0 || style.assignedPersonas?.length > 0) charStyles.push(style);
            // Orphaned styles (no assignments) are skipped
        }
    }

    // 1. Default styles → broad selector
    for (const style of defaults) {
        const css = buildStyleCSS(style, '.mes');
        if (css) sections.push(`/* Default: ${style.name} */\n${css}`);
    }

    // 2. Verse styles → medium specificity
    // Like direct assignments, these target data-wl-avatar so duplicate
    // display names don't collide. The `#chat` prefix is intentionally
    // omitted to keep verse styles below direct character/persona styles
    // in the cascade.
    for (const style of verseStyles) {
        const targets = resolveStyleTargets(style).filter(targetIsAllowed);
        for (const group of groupStyleTargets(style, targets)) {
            const selector = buildAssignedMessageSelector(group.avatars);
            const css = buildStyleCSS(style, selector, group.context);
            if (css) sections.push(`/* Verse (${style.name}): ${group.names.join(', ')} */\n${css}`);
        }
    }

    // 3. Direct assignment → highest specificity
    // Selectors target `data-wl-avatar` (stamped onto each .mes by
    // avatarStamp.js), NOT `ch_name`. This is what fixes duplicate display
    // names: the avatar filename is unique per character/persona, so two
    // entities sharing a name no longer collide on one selector.
    const allChars = getContext().characters || [];
    // Build lookup map once — avoids O(n) find per style assignment
    const avatarMap = new Map(allChars.map(c => [cleanAvatar(c.avatar), c]));
    for (const style of charStyles) {
        const targets = [];
        // Characters
        for (const charAvatar of style.assignedCharacters || []) {
            const cleaned = cleanAvatar(charAvatar);
            if (allowedAvatars && !allowedAvatars.has(cleaned)) continue;
            // Skip assignments whose character no longer exists.
            if (!avatarMap.has(cleaned)) continue;
            targets.push({ name: cleaned, charAvatar: cleaned });
        }
        // Personas
        for (const pAvatar of style.assignedPersonas || []) {
            const cleaned = cleanAvatar(pAvatar);
            if (allowedAvatars && !allowedAvatars.has(cleaned)) continue;
            const personaName = power_user.personas?.[cleaned];
            if (!personaName) continue;
            targets.push({ name: cleaned, personaAvatar: cleaned });
        }
        for (const group of groupStyleTargets(style, targets)) {
            const selector = buildAssignedMessageSelector(group.avatars, true);
            const css = buildStyleCSS(style, selector, group.context);
            if (css) sections.push(`/* Direct (${style.name}): ${group.names.join(', ')} */\n${css}`);
        }
    }

    return sections.length > 1 ? sections.join('\n\n') : '';
}

/** Build the small set of rules that depends on the active chat context. */
export function buildContextCSS(styles = getAllStyles()) {
    const activeStyles = styles.filter(style => style.enabled !== false);
    if (activeStyles.length === 0) return '';

    const sections = ['/* WL Chat Design — Context */'];

    // Interface font → single resolved Fonts style for current context
    const uiFontCSS = buildActiveUIFontCSS(activeStyles);
    if (uiFontCSS) sections.push(uiFontCSS);

    // Background → single resolved style for the current chat context
    const bgCSS = buildActiveBackgroundCSS(activeStyles);
    if (bgCSS) sections.push(bgCSS);

    // Cursor → single resolved style for the current chat context. Global and
    // character-keyed (personas ignored), like Background.
    const cursorCSS = buildActiveCursorCSS(activeStyles);
    if (cursorCSS) sections.push(cursorCSS);

    // Top-bar geometry and icon presentation are also character-keyed. The
    // winning style never depends on the active persona.
    const generalUiCSS = buildActiveGeneralUiCSS(activeStyles);
    if (generalUiCSS) sections.push(generalUiCSS);

    return sections.length > 1 ? sections.join('\n\n') : '';
}

/**
 * Build complete CSS for previews/tests/export-style callers. Production
 * injection keeps the two parts in separate elements via injectChatDesignCSS.
 */
export function buildAllCSS(styles = getAllStyles(), options = {}) {
    const sections = [];
    if (options.includeMessageStyles !== false) {
        const messageCSS = buildMessageCSS(styles);
        if (messageCSS) sections.push(messageCSS);
    }
    const contextCSS = buildContextCSS(styles);
    if (contextCSS) sections.push(contextCSS);
    return sections.join('\n\n');
}

// ============================================================
// Injection / Removal
// ============================================================

function updateStyleElement(styleId, css) {
    let el = document.getElementById(styleId);
    if (!css) {
        if (el && el.textContent) el.textContent = '';
        return;
    }
    if (!el) {
        el = document.createElement('style');
        el.id = styleId;
        document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
}

function clearStyleElement(styleId) {
    const el = document.getElementById(styleId);
    if (el && el.textContent) el.textContent = '';
}

/**
 * Inject or update Chat Design's stable message sheet and active-context sheet.
 * `refreshMessageStyles: false` preserves the large message sheet during an
 * ordinary chat switch, but still creates it when entering a chat from home.
 */
export function injectChatDesignCSS(options = {}) {
    const styles = getAllStyles();
    const activeStyles = styles.filter(style => style.enabled !== false);
    const includeMessageStyles = options.includeMessageStyles !== false;
    const existingMessageSheet = document.getElementById(MESSAGE_STYLE_ELEMENT_ID);
    const refreshMessageStyles = options.refreshMessageStyles !== false || !existingMessageSheet?.textContent;
    const activeUIFontStyle = resolveActiveUIFontStyle(activeStyles);
    const chatScope = getChatScope();
    const scopedMessageStyles = activeStyles.filter(style =>
        style.element !== 'background'
        && style.element !== 'cursor'
        && style.element !== 'generalUi'
        && styleMatchesChatScope(style, chatScope.allowedAvatars));
    const fontStyles = includeMessageStyles && refreshMessageStyles
        ? scopedMessageStyles
        : activeUIFontStyle ? [activeUIFontStyle] : [];
    loadUsedFonts(fontStyles);

    // Clear the pre-split sheet if this code is hot-loaded over an older build.
    clearStyleElement(LEGACY_STYLE_ELEMENT_ID);

    if (!includeMessageStyles) {
        clearStyleElement(MESSAGE_STYLE_ELEMENT_ID);
    } else if (refreshMessageStyles) {
        updateStyleElement(MESSAGE_STYLE_ELEMENT_ID, buildMessageCSS(activeStyles, chatScope));
    }

    updateStyleElement(CONTEXT_STYLE_ELEMENT_ID, buildContextCSS(activeStyles));
    log('CSS injected,', activeStyles.length, 'style(s)');
}

/** Remove/clear every Chat Design generated stylesheet. */
export function removeChatDesignCSS() {
    for (const styleId of [
        MESSAGE_STYLE_ELEMENT_ID,
        CONTEXT_STYLE_ELEMENT_ID,
        LEGACY_STYLE_ELEMENT_ID,
    ]) {
        clearStyleElement(styleId);
    }
}
