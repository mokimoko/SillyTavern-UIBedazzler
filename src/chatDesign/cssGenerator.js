// src/chatDesign/cssGenerator.js
// Generates CSS from Chat Design styles and injects/removes it from the page.
//
// Cascade order (low → high specificity):
//   1. Default styles → `.mes` selector
//   2. Verse styles → `.mes[ch_name="X"]` (resolved from verse membership)
//   3. Character/Persona styles → `#chat .mes[ch_name="X"]`
//   4. Design Tab overrides (handled separately — charDrawer/personaLore designTab.js)
//
// This module owns `wl-chat-design-styles` <style> element.
// Design Tab owns `wl-char-design-styles` and `wl-persona-design-styles`.

import { getAllStyles, resolveStyleTargets } from './storage.js';
import { buildActiveCursorCSS } from './cursors.js';
import { getFontFamilyCSS, loadUsedFonts } from './fonts.js';
import { escapeCSSName, cleanAvatar } from '../design/designUtils.js';
import { power_user } from '../../../../../power-user.js';
import { extension_settings, getContext } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';

const log = () => {};

const STYLE_ELEMENT_ID = 'wl-chat-design-styles';

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
    const c = hexToRgb(hex);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
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
 * Build CSS for a Name style.
 * Targets: `.name_text` inside the message selector.
 */
function buildNameCSS(style, selector) {
    const p = style.properties;
    const decls = [];

    if (!isDefaultFont(p.fontFamily)) decls.push(`font-family: ${getFontFamilyCSS(p.fontFamily)} !important`);
    if (p.fontSize && p.fontSize !== '1em') decls.push(`font-size: ${p.fontSize} !important`);
    if (p.fontWeight && p.fontWeight !== '400') decls.push(`font-weight: ${p.fontWeight} !important`);
    if (p.fontStyle && p.fontStyle !== 'normal') decls.push(`font-style: ${p.fontStyle} !important`);
    if (p.textTransform && p.textTransform !== 'none') decls.push(`text-transform: ${p.textTransform} !important`);
    if (p.letterSpacing && p.letterSpacing !== '0px') decls.push(`letter-spacing: ${p.letterSpacing} !important`);
    if (p.textShadow && p.textShadow !== 'none') decls.push(`text-shadow: ${p.textShadow} !important`);

    if (decls.length === 0) return '';
    return `${selector} .name_text {\n    ${decls.join(';\n    ')};\n}`;
}

/**
 * Build CSS for a Dialogue style.
 * Targets: `q` (quote tags) inside the message selector.
 */
function buildDialogueCSS(style, selector) {
    const p = style.properties;
    const decls = [];

    if (!isDefaultFont(p.fontFamily)) decls.push(`font-family: ${getFontFamilyCSS(p.fontFamily)} !important`);
    if (p.fontSize && p.fontSize !== '1em') decls.push(`font-size: ${p.fontSize} !important`);
    if (p.fontWeight && p.fontWeight !== '400') decls.push(`font-weight: ${p.fontWeight} !important`);
    if (p.fontStyle && p.fontStyle !== 'normal') decls.push(`font-style: ${p.fontStyle} !important`);
    if (p.letterSpacing && p.letterSpacing !== '0px') decls.push(`letter-spacing: ${p.letterSpacing} !important`);
    if (p.lineHeight && p.lineHeight !== 'normal') decls.push(`line-height: ${p.lineHeight} !important`);

    if (decls.length === 0) return '';
    return `${selector} q {\n    ${decls.join(';\n    ')};\n}`;
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
 * ::after  — overlay color + matching mask-image + bottom border
 *   Overlay is a solid color (not a gradient), masked to fade with the image.
 *   Border sits at the bottom edge.
 */
function buildBannerCSS(style, selector, avatarUrl = null, personaBannerPos = null) {
    const p = style.properties;

    const hasBorder = p.borderBottomWidth > 0 && p.borderBottomStyle !== 'none';
    const hasOverlay = p.overlayOpacity > 0;
    const hasBottomFade = (p.bottomFadeOpacity ?? 0) > 0;
    const hasHeight = p.height && p.height !== 120;
    const hasPadding = p.paddingTop && p.paddingTop !== 150;
    const hasBorderRadius = p.borderRadius > 0;
    const hasSlant = (p.slant || 0) > 0;

    if (!hasBorder && !hasOverlay && !hasBottomFade && !hasHeight && !hasPadding && !hasBorderRadius && !hasSlant && !avatarUrl) return '';

    const rules = [];
    const cs = chatSel(selector);
    const height = p.height || 120;
    const bannerPos = avatarUrl
        ? (personaBannerPos ?? p.bannerPosition ?? 25)
        : (p.bannerPosition ?? 25);
    const paddingTop = p.paddingTop || 150;

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

    // Container positioning
    rules.push(`${cs} {\n    position: relative !important;\n    overflow: visible !important;\n    padding-top: ${paddingTop}px !important;\n}`);

    // Elevate content above pseudo-elements
    rules.push(
        `${selector} .mes_block,\n` +
        `${selector} .mes_text,\n` +
        `${selector} .ch_name,\n` +
        `${selector} .mesAvatarWrapper {\n    position: relative !important;\n    z-index: 3;\n}`,
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
        const B = hasBorder ? p.borderBottomWidth : 0; // accent bar thickness
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
            'top: 0 !important',
            'left: 0 !important',
            'width: 100% !important',
            `height: ${height}px !important`,
            'z-index: 1 !important',
            'pointer-events: none !important',
        ];
        if (avatarUrl) {
            sBefore.push(`background: url('${avatarUrl}') center ${bannerPos}% / cover no-repeat !important`);
        }
        sBefore.push(maskCSS || '-webkit-mask-image: none !important;\n    mask-image: none !important');
        sBefore.push(`-webkit-clip-path: ${bodyClip} !important`);
        sBefore.push(`clip-path: ${bodyClip} !important`);
        if (hasOverlay) {
            const rgb = hexToRgb(p.overlayColor || '#000000');
            sBefore.push(`box-shadow: inset 0 0 0 2000px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${p.overlayOpacity}) !important`);
        }
        rules.push(`${cs}::before {\n    ${sBefore.join(';\n    ')};\n}`);

        // ::after — the bold accent bar: a solid strip clipped to the diagonal.
        if (hasBorder) {
            const rgb = hexToRgb(p.borderBottomColor || '#ffffff');
            const opacity = p.borderBottomOpacity ?? 1;
            const barColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
            const sAfter = [
                'content: "" !important',
                'position: absolute !important',
                'top: 0 !important',
                'left: 0 !important',
                'width: 100% !important',
                `height: ${height}px !important`,
                'z-index: 2 !important',
                'pointer-events: none !important',
                `background: ${barColor} !important`,
                `-webkit-clip-path: ${barClip} !important`,
                `clip-path: ${barClip} !important`,
            ];
            rules.push(`${cs}::after {\n    ${sAfter.join(';\n    ')};\n}`);
        }

        return rules.join('\n');
    }

    // ::before — banner image + mask-image fade
    {
        const beforeDecls = [
            'content: "" !important',
            'position: absolute !important',
            'top: 0 !important',
            'left: 0 !important',
            'width: 100% !important',
            `height: ${height}px !important`,
            'z-index: 1 !important',
            'pointer-events: none !important',
        ];
        if (avatarUrl) {
            beforeDecls.push(`background: url('${avatarUrl}') center ${bannerPos}% / cover no-repeat !important`);
        }
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
    if (hasOverlay || hasBorder || hasBorderRadius) {
        const afterDecls = [
            'content: "" !important',
            'position: absolute !important',
            'top: 0 !important',
            'left: 0 !important',
            'width: 100% !important',
            `height: ${height}px !important`,
            'z-index: 2 !important',
            'pointer-events: none !important',
        ];

        if (hasOverlay) {
            const rgb = hexToRgb(p.overlayColor || '#000000');
            const oOp = p.overlayOpacity;
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

        if (hasBorder) {
            const rgb = hexToRgb(p.borderBottomColor || '#ffffff');
            const opacity = p.borderBottomOpacity ?? 1;
            const borderColor = opacity < 1
                ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`
                : (p.borderBottomColor || '#ffffff');
            afterDecls.push(`border-bottom: ${p.borderBottomWidth}px ${p.borderBottomStyle} ${borderColor} !important`);
        }
        if (hasBorderRadius) {
            afterDecls.push(`border-radius: ${p.borderRadius}px ${p.borderRadius}px 0 0 !important`);
        }

        rules.push(`${cs}::after {\n    ${afterDecls.join(';\n    ')};\n}`);
    }

    return rules.join('\n');
}

/**
 * Build CSS for a Container (message box) style.
 */
function buildContainerCSS(style, selector) {
    const p = style.properties;
    const decls = [];

    const hasBorder = p.borderWidth > 0 && p.borderStyle !== 'none';
    if (hasBorder) decls.push(`border: ${p.borderWidth}px ${p.borderStyle} ${p.borderColor} !important`);
    if (p.borderRadius > 0) decls.push(`border-radius: ${p.borderRadius}px !important`);
    if (p.boxShadow && p.boxShadow !== 'none') decls.push(`box-shadow: ${p.boxShadow} !important`);
    if (p.marginTop > 0) decls.push(`margin-top: ${p.marginTop}px !important`);
    if (p.marginBottom > 0) decls.push(`margin-bottom: ${p.marginBottom}px !important`);
    if (p.paddingExtra > 0) decls.push(`padding: ${p.paddingExtra}px !important`);

    if (decls.length === 0) return '';
    return `${chatSel(selector)} {\n    ${decls.join(';\n    ')};\n}`;
}

/**
 * Build CSS for an Avatar style.
 * Targets: `.avatar img` inside the message selector.
 */
function buildAvatarCSS(style, selector) {
    const p = style.properties;
    const rules = [];
    const decls = [];

    if (p.size > 0) {
        decls.push(`width: ${p.size}px !important`);
        decls.push(`height: ${p.size}px !important`);
    }
    const hasBorder = p.borderWidth > 0 && p.borderStyle !== 'none';
    if (hasBorder) decls.push(`border: ${p.borderWidth}px ${p.borderStyle} ${p.borderColor} !important`);

    // Shape override
    if (p.shape === 'circle') decls.push('border-radius: 50% !important');
    else if (p.shape === 'square') decls.push('border-radius: 0 !important');
    else if (p.shape === 'rounded') decls.push('border-radius: 8px !important');
    else if (p.shape === 'rectangle') {
        decls.push('border-radius: 0 !important');
        if (p.size > 0) decls.push(`height: ${Math.round(p.size * 1.4)}px !important`);
    } else if (p.borderRadius >= 0 && p.shape !== 'theme') {
        decls.push(`border-radius: ${p.borderRadius}px !important`);
    }

    if (p.boxShadow && p.boxShadow !== 'none') decls.push(`box-shadow: ${p.boxShadow} !important`);
    if (p.opacity < 1 && p.opacity >= 0) decls.push(`opacity: ${p.opacity} !important`);

    if (decls.length > 0) {
        rules.push(`${selector} .avatar img {\n    ${decls.join(';\n    ')};\n}`);
    }

    // Adjust avatar container if size changed
    if (p.size > 0) {
        const h = p.shape === 'rectangle' ? Math.round(p.size * 1.4) : p.size;
        rules.push(`${selector} .avatar {\n    width: ${p.size}px !important;\n    height: ${h}px !important;\n    min-width: ${p.size}px !important;\n}`);
    }

    // Position offset — nudge the avatar without disturbing sibling layout.
    // Applied to .mesAvatarWrapper (elevated to z-index:3 by the banner CSS),
    // so a negative Y lifts the avatar up into the banner band and X shifts it
    // left/right. transform is used instead of margins so nothing else reflows.
    //
    // detachFromLayout: collapses the wrapper's footprint (width/min-width/
    // margin → 0) so .mes_block, as the flex:1 sibling, expands to fill the row.
    // The avatar stays visible via overflow:visible and is placed by the X/Y
    // transform. We keep position:relative (NOT absolute) to avoid both the
    // ordering fight with the banner rule and text/avatar overlap.
    const ox = p.offsetX || 0;
    const oy = p.offsetY || 0;
    const detach = !!p.detachFromLayout;
    if (ox !== 0 || oy !== 0 || detach) {
        const wrapDecls = ['position: relative !important'];
        if (detach) {
            wrapDecls.push('width: 0 !important');
            wrapDecls.push('min-width: 0 !important');
            wrapDecls.push('margin: 0 !important');
            wrapDecls.push('overflow: visible !important');
        }
        if (ox !== 0 || oy !== 0) {
            wrapDecls.push(`transform: translate(${ox}px, ${oy}px) !important`);
        }
        rules.push(`${selector} .mesAvatarWrapper {\n    ${wrapDecls.join(';\n    ')};\n}`);

        // Also collapse the inner .avatar box so it doesn't hold the column
        // width open, and let the flex gap disappear on the row.
        if (detach) {
            rules.push(`${selector} .avatar {\n    position: absolute !important;\n    top: 0 !important;\n    left: 0 !important;\n}`);
            rules.push(`${selector} {\n    gap: 0 !important;\n}`);
        }
    }

    return rules.join('\n');
}

// ============================================================
// Style → CSS Routing
// ============================================================

const CSS_BUILDERS = {
    name: buildNameCSS,
    dialogue: buildDialogueCSS,
    banner: buildBannerCSS,
    container: buildContainerCSS,
    avatar: buildAvatarCSS,
};

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
    if (d.bannerMode === 'custom' && d.bannerUrl) return d.bannerUrl;
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
function buildBackgroundOverlayCSS(style) {
    const p = style.properties || {};

    // ── Base element rule: positioning + image filters + zoom ──
    // Positioning is required so ::after (inset:0) covers the layer and so
    // overflow:hidden clips any blur/zoom overscan.
    const baseDecls = [
        'position: fixed !important',
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
        overlay = `#bg1::after,\n#bg_custom::after {\n    ${decls.join(';\n    ')};\n}`;
    }

    // Nothing to do — neither image effects nor an overlay.
    if (!overlay && !hasImageEffects) return '';

    const base = `#bg1,\n#bg_custom {\n    ${baseDecls.join(';\n    ')};\n}`;
    return overlay ? `${base}\n\n${overlay}` : base;
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
function buildActiveBackgroundCSS() {
    const bgStyles = getAllStyles().filter(s => s.element === 'background');
    if (bgStyles.length === 0) return '';

    const ctx = getContext();
    const chid = ctx.characterId;
    const activeChar = (chid != null && ctx.characters?.[chid])
        ? cleanAvatar(ctx.characters[chid].avatar)
        : null;

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

/**
 * Build complete CSS from all active styles.
 * Handles specificity cascade via selector ordering:
 *   - Default styles first (broad `.mes` selector)
 *   - Verse-resolved styles (medium specificity)
 *   - Direct character/persona styles (highest specificity with #chat prefix)
 */
export function buildAllCSS(styles = getAllStyles()) {
    if (styles.length === 0) return '';

    const sections = ['/* WL Chat Design */'];

    const defaults = [];
    const verseStyles = [];
    const charStyles = [];

    for (const style of styles) {
        // Background and cursor styles are global (not per-.mes) — each is
        // resolved to a single active style separately (below).
        if (style.element === 'background' || style.element === 'cursor') continue;
        if (style.isDefault) {
            defaults.push(style);
        } else {
            if (style.assignedVerses?.length > 0) verseStyles.push(style);
            if (style.assignedCharacters?.length > 0 || style.assignedPersonas?.length > 0) charStyles.push(style);
            // Orphaned styles (no assignments) are skipped
        }
    }

    const esc = escapeCSSName;

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
        const targets = resolveStyleTargets(style);
        for (const target of targets) {
            if (target.name === '__default__') continue;
            const avatar = target.personaAvatar || target.charAvatar;
            if (!avatar) continue;
            const avatarUrl = target.personaAvatar
                ? getPersonaBannerImage(target.personaAvatar)
                : null;
            const bannerPosition = target.personaAvatar
                ? getPersonaBannerPosition(target.personaAvatar)
                : null;
            const css = buildStyleCSS(style, `.mes[data-wl-avatar="${esc(avatar)}"]`, { avatarUrl, bannerPosition });
            if (css) sections.push(`/* Verse (${style.name}): ${target.name} */\n${css}`);
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
        // Characters
        for (const charAvatar of style.assignedCharacters || []) {
            const cleaned = cleanAvatar(charAvatar);
            // Skip assignments whose character no longer exists.
            if (!avatarMap.has(cleaned)) continue;
            const css = buildStyleCSS(style, `#chat .mes[data-wl-avatar="${esc(cleaned)}"]`);
            if (css) sections.push(`/* Character (${style.name}): ${cleaned} */\n${css}`);
        }
        // Personas
        for (const pAvatar of style.assignedPersonas || []) {
            const cleaned = cleanAvatar(pAvatar);
            const personaName = power_user.personas?.[cleaned];
            if (!personaName) continue;
            const avatarUrl = getPersonaBannerImage(cleaned);
            const bannerPosition = getPersonaBannerPosition(cleaned);
            const css = buildStyleCSS(style, `#chat .mes[data-wl-avatar="${esc(cleaned)}"]`, { avatarUrl, bannerPosition });
            if (css) sections.push(`/* Persona (${style.name}): ${cleaned} */\n${css}`);
        }
    }

    // 4. Background → single resolved style for the current chat context
    const bgCSS = buildActiveBackgroundCSS();
    if (bgCSS) sections.push(bgCSS);

    // 5. Cursor → single resolved style for the current chat context.
    //    Global, character-keyed (personas ignored), like Background.
    const cursorCSS = buildActiveCursorCSS();
    if (cursorCSS) sections.push(cursorCSS);

    return sections.length > 1 ? sections.join('\n\n') : '';
}

// ============================================================
// Injection / Removal
// ============================================================

/**
 * Inject or update the Chat Design <style> element.
 * Loads used fonts before injecting CSS.
 */
export function injectChatDesignCSS() {
    const styles = getAllStyles();
    loadUsedFonts(styles);

    const css = buildAllCSS(styles);
    if (css) {
        let el = document.getElementById(STYLE_ELEMENT_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ELEMENT_ID;
            document.head.appendChild(el);
        }
        if (el.textContent !== css) el.textContent = css;
        log('CSS injected,', styles.length, 'style(s)');
    } else {
        removeChatDesignCSS();
    }
}

/**
 * Remove/clear the Chat Design <style> element content.
 */
export function removeChatDesignCSS() {
    const el = document.getElementById(STYLE_ELEMENT_ID);
    if (el) el.textContent = '';
}
