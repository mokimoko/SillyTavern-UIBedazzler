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

    if (!hasBorder && !hasOverlay && !hasBottomFade && !hasHeight && !hasPadding && !hasBorderRadius && !avatarUrl) return '';

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
        if (maskCSS) beforeDecls.push(maskCSS);
        rules.push(`${cs}::before {\n    ${beforeDecls.join(';\n    ')};\n}`);
    }

    // ::after — overlay + border (with matching mask so overlay fades with image)
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
            const rgba = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${p.overlayOpacity})`;
            afterDecls.push(`background: ${rgba} !important`);
        }

        // Same mask as ::before — overlay fades in lockstep with the image
        if (maskCSS) afterDecls.push(maskCSS);

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
export function buildAllCSS() {
    const styles = getAllStyles();
    if (styles.length === 0) return '';

    const sections = ['/* WL Chat Design */'];

    const defaults = [];
    const verseStyles = [];
    const charStyles = [];

    for (const style of styles) {
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
                ? `User Avatars/${target.personaAvatar}`
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
            const avatarUrl = `User Avatars/${cleaned}`;
            const bannerPosition = getPersonaBannerPosition(cleaned);
            const css = buildStyleCSS(style, `#chat .mes[data-wl-avatar="${esc(cleaned)}"]`, { avatarUrl, bannerPosition });
            if (css) sections.push(`/* Persona (${style.name}): ${cleaned} */\n${css}`);
        }
    }

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

    const css = buildAllCSS();
    if (css) {
        let el = document.getElementById(STYLE_ELEMENT_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ELEMENT_ID;
            document.head.appendChild(el);
        }
        el.textContent = css;
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
