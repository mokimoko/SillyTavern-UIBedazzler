// src/chatDesign/storage.js
// Style CRUD and assignment resolution for Chat Design
//
// Styles are stored in extension_settings.UIBedazzler.chatDesign
// Each style targets one element type and can be assigned to characters, personas, or verses (when VM present).

import { saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings, getContext } from '../../../../../extensions.js';
import { MODULE_NAME } from '../settings.js';
import { power_user } from '../../../../../power-user.js';
import { tags as stTags, tag_map } from '../../../../../tags.js';
import { getUserAvatars } from '../../../../../personas.js';
import { cleanAvatar } from '../design/designUtils.js';

const log = () => {};

// ============================================================
// Schema & Defaults
// ============================================================

export const MESSAGE_ACTION_DEFAULTS = {
    actionButtonsEnabled: false,
    actionOffsetX: 0,
    actionOffsetY: 0,
    actionVisibility: 'dim',
    actionRestingOpacity: 0.45,
    actionButtonSize: 26,
    actionIconSize: 14,
    actionGap: 4,
    actionRadius: 5,
    actionReverse: false,
    actionSurface: 'bare',
    actionRestingIconColor: '#d8d5df',
    actionRestingSurfaceColor: '#242129',
    actionHoverIconColor: '#ffffff',
    actionHoverSurfaceColor: '#8f72bd',
    actionHoverMotion: 'color',
    actionAnimationSpeed: 'normal',
    actionShadow: 'none',
};

export const AVATAR_OVERLAY_DEFAULTS = {
    avatarOverlayEnabled: false,
    avatarOverlayType: 'solid',
    avatarOverlayPrimaryColor: '#d49a74',
    avatarOverlaySecondaryColor: '#71405b',
    avatarOverlayOpacity: 0.32,
    avatarOverlayAngle: 135,
    avatarOverlayBlendMode: 'soft-light',
    avatarOverlayVignette: 0,
};

export const THINKING_PRESETS = Object.freeze({
    native: Object.freeze({
        label: 'Native',
        description: 'Theme correction only',
    }),
    soft: Object.freeze({
        label: 'Soft Surface',
        description: 'Subtle quote-color wash',
    }),
    outline: Object.freeze({
        label: 'Accent Outline',
        description: 'Clear edge, quiet fill',
    }),
    quiet: Object.freeze({
        label: 'Quiet Line',
        description: 'Minimal left accent',
    }),
});

/**
 * Default property values per element type.
 * These define the full set of editable properties and their neutral/no-op values.
 */
export const NAME_DEFAULTS = Object.freeze({
    fontFamily: 'Default (Theme)',
    fontSize: '1em',
    fontWeight: '400',
    fontStyle: 'normal',
    textTransform: 'none',
    letterSpacing: '0px',
    textShadow: 'none',
    offsetX: 0,
    offsetY: 0,
    backgroundColor: '#000000',
    backgroundOpacity: 0,
    backgroundWidth: 0,
    backgroundHeight: 0,
    backgroundTextOffsetX: 0,
    backgroundTextOffsetY: 0,
    backgroundShape: 'rounded',
});

const prefixedDefaults = (prefix, defaults) => Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
        `${prefix}${key[0].toUpperCase()}${key.slice(1)}`,
        value,
    ]),
);

export const ELEMENT_DEFAULTS = {
    dialogue: {
        ...prefixedDefaults('name', NAME_DEFAULTS),
        fontFamilyUseCustom: false,
        fontFamily: 'Default (Theme)',
        fontSize: '1em',
        fontWeight: '400',
        fontStyle: 'normal',
        letterSpacing: '0px',
        lineHeight: 'normal',
        messageFontFamilyUseCustom: false,
        messageFontFamily: 'Default (Theme)',
        messageFontSize: '1em',
        messageFontWeight: '400',
        messageFontStyle: 'normal',
        messageLetterSpacing: '0px',
        messageLineHeight: 'normal',
        uiFontFamilyUseCustom: false,
        uiFontFamily: 'Default (Theme)',
        uiFontSize: '1em',
        uiFontWeight: '400',
        uiFontStyle: 'normal',
        uiLetterSpacing: '0px',
        uiLineHeight: 'normal',
        uiTextColorUseCustom: false,
        uiTextColor: '#142536',
    },
    banner: {
        height: 120,
        width: 100,
        offsetX: 0,
        offsetY: 0,
        paddingTop: 150,
        bannerPosition: 25,
        bottomFadeColor: '#000000',
        bottomFadeOpacity: 0,
        borderTopWidth: 0,
        borderTopStyle: 'none',
        borderTopColor: '#ffffff',
        borderTopOpacity: 1,
        borderLeftWidth: 0,
        borderLeftStyle: 'none',
        borderLeftColor: '#ffffff',
        borderLeftOpacity: 1,
        borderRightWidth: 0,
        borderRightStyle: 'none',
        borderRightColor: '#ffffff',
        borderRightOpacity: 1,
        borderBottomWidth: 0,
        borderBottomStyle: 'none',
        borderBottomColor: '#ffffff',
        borderBottomOpacity: 1,
        overlayColor: '#000000',
        overlayType: 'solid',
        overlaySecondaryColor: '#000000',
        overlayAngle: 135,
        overlayBlendMode: 'normal',
        overlayVignette: 0,
        overlayOpacity: 0,
        borderRadius: 0,
        // Diagonal bottom edge. 0 = flat (classic horizontal border). When > 0,
        // the band's bottom is cut on a diagonal that DROPS by `slant` px across
        // the width, and the Bottom Border settings render as a bold accent bar
        // running along that diagonal instead of a flat underline.
        slant: 0,
        slantDirection: 'right', // 'right' = rises to the right; 'left' = rises to the left
    },
    container: {
        borderWidth: 0,
        borderStyle: 'none',
        borderColor: '#ffffff',
        borderRadius: 0,
        boxShadow: 'none',
        marginTop: 0,
        marginBottom: 0,
        paddingExtra: 0,
        contentAreaEnabled: false,
        contentBackgroundColor: '#000000',
        contentBackgroundOpacity: 0.6,
        contentBorderWidth: 0,
        contentBorderStyle: 'solid',
        contentBorderColor: '#ffffff',
        contentBorderRadius: 0,
        contentBoxShadow: 'none',
        contentWidth: 0,
        contentMinHeight: 0,
        contentAreaOffsetX: 0,
        contentAreaOffsetY: 0,
        contentOffsetX: 0,
        contentOffsetY: 0,
        thinkingPreset: 'native',
        thinkingRadius: 5,
        thinkingAccentStrength: 60,
        thinkingBodyEnabled: true,
    },
    avatar: {
        size: 0,              // legacy combined size; new styles use width/height
        width: 0,             // 0 = use theme default
        height: 0,            // 0 = use theme default
        objectFitUseCustom: false,
        objectFit: 'theme',   // 'theme' | 'cover' | 'contain' | 'fill'
        objectPositionX: 50,
        objectPositionY: 50,
        offsetX: 0,           // horizontal nudge in px (+ right / - left)
        offsetY: 0,           // vertical nudge in px (- up into banner / + down)
        detachFromLayout: false, // true = pull avatar out of flow so text reclaims its column
        borderWidth: 0,
        borderStyle: 'none',
        borderColor: '#ffffff',
        borderRadius: -1,     // -1 = use theme default
        shapeUseCustom: false,
        shape: 'theme',       // 'theme' | 'circle' | 'square' | 'rounded' | 'rectangle'
        boxShadow: 'none',
        opacity: 1,
        edgeFade: 0,          // % of the right and bottom edges that dissolve to transparent
        detailsFollowAvatar: false,
        detailsOffsetX: 0,
        detailsOffsetY: 0,
        timestampOffsetX: 0,
        timestampOffsetY: 0,
        modelIconOffsetX: 0,
        modelIconOffsetY: 0,
        // CSS-only color treatment layered above the avatar image. It stays
        // dormant until enabled so existing styles remain visually unchanged.
        ...AVATAR_OVERLAY_DEFAULTS,
        // Message-action rules stay dormant until a preset or control is used,
        // preserving the active theme for existing and newly-created styles.
        ...MESSAGE_ACTION_DEFAULTS,
    },
    generalUi: {
        // Geometry is a stored preset because each option is deliberately
        // coordinated with TT's separate backdrop and icon/drawer host.
        // "theme" is a true no-op reset.
        topBarPresetUseCustom: false,
        topBarPreset: 'theme',
        topBarWidthMode: 'theme',
        topBarWidth: 92,
        topBarHeightMode: 'theme',
        topBarHeight: 40,
        topBarTopOffset: 0,
        chatGapMode: 'theme',
        chatGap: 0,

        // Surface and frame overrides remain independent of geometry so a
        // user can recolor the native bar without first choosing a shape.
        topBarSurfaceMode: 'theme',
        topBarSurfaceType: 'solid',
        topBarSurfaceColor: '#171717',
        topBarSurfaceSecondaryColor: '#39435a',
        topBarSurfaceAngle: 135,
        topBarSurfaceOpacity: 0.85,
        topBarBorderMode: 'theme',
        topBarBorderWidth: 1,
        topBarBorderColor: '#ffffff',
        topBarBorderOpacity: 0.18,

        // The composer stays theme-owned until one of these focused groups is
        // enabled. Quick Reply buttons are intentionally outside their scope.
        inputAreaSurfaceMode: 'theme',
        inputAreaSurfaceType: 'solid',
        inputAreaSurfaceColor: '#171717',
        inputAreaSurfaceSecondaryColor: '#39435a',
        inputAreaSurfaceAngle: 135,
        inputAreaSurfaceOpacity: 0.85,
        inputAreaBlur: 8,
        inputAreaBorderMode: 'theme',
        inputAreaBorderWidth: 1,
        inputAreaBorderStyle: 'solid',
        inputAreaBorderColor: '#ffffff',
        inputAreaBorderOpacity: 0.18,
        inputAreaRadius: 10,
        inputAreaShadow: 'none',
        inputAreaLayoutMode: 'theme',
        inputAreaPaddingX: 2,
        inputAreaPaddingY: 0,
        inputAreaGap: 5,
        inputAreaTextMode: 'theme',
        inputAreaTextColor: '#f5f2f8',
        inputAreaPlaceholderColor: '#aaa6b3',
        inputAreaFontSize: 16,
        inputAreaIconMode: 'theme',
        inputAreaIconColor: '#d8d5df',
        inputAreaIconHoverColor: '#ffffff',
        inputAreaIconOpacity: 0.7,

        // Quick Reply presentation is separate from the composer shell. Main
        // bar and popout buttons share one character-scoped style.
        qrButtonMode: 'theme',
        qrButtonSurfaceType: 'solid',
        qrButtonSurfaceColor: '#242129',
        qrButtonSurfaceSecondaryColor: '#514168',
        qrButtonSurfaceAngle: 135,
        qrButtonSurfaceOpacity: 0.82,
        qrButtonTextColor: '#f5f2f8',
        qrButtonHoverSurfaceColor: '#65517f',
        qrButtonHoverSurfaceOpacity: 0.96,
        qrButtonHoverTextColor: '#ffffff',
        qrButtonBorderWidth: 1,
        qrButtonBorderStyle: 'solid',
        qrButtonBorderColor: '#ffffff',
        qrButtonBorderOpacity: 0.18,
        qrButtonRadius: 10,
        qrButtonPaddingX: 8,
        qrButtonPaddingY: 5,
        qrButtonGap: 5,
        qrButtonFontFamilyUseCustom: false,
        qrButtonFontFamily: 'Default (Theme)',
        qrButtonFontSize: 13,
        qrButtonFontWeight: 500,
        qrButtonFontStyle: 'normal',
        qrButtonTextTransform: 'none',
        qrButtonLetterSpacing: '0px',
        qrButtonTextShadow: 'none',
        qrButtonBarOpacity: 1,
        qrButtonShadow: 'none',

        // Explicit modes keep new and untouched styles dormant. Editable values
        // are retained while Use Custom is off, so users can switch back without
        // rebuilding them.
        iconSizeMode: 'theme',
        iconSize: 30,
        iconSpacingMode: 'theme',
        iconSpacing: 8,
        iconColorMode: 'theme',
        iconColor: '#d8d5df',
        iconHoverColor: '#ffffff',
        iconOpacityMode: 'theme',
        iconOpacity: 0.65,

        // Native ST controls stay theme-owned until this palette is enabled.
        controlColorsMode: 'theme',
        checkboxSurfaceColor: '#20242c',
        checkboxTickColor: '#8fb5ff',
        checkboxBorderColor: '#667085',
        toggleOnColor: '#7aa2f7',
        toggleOffColor: '#4b5563',
        toggleKnobColor: '#f4f7fb',
        radioSurfaceColor: '#20242c',
        radioDotColor: '#7aa2f7',
        radioBorderColor: '#667085',
        sliderTrackColor: '#3f4654',
        sliderThumbColor: '#7aa2f7',
        sliderThumbBorderColor: '#dbe6ff',

        // Scrollbars remain entirely theme-owned until explicitly enabled.
        // These values cover both Chromium/WebKit and Firefox's supported API.
        scrollbarMode: 'theme',
        scrollbarWidth: 10,
        scrollbarRadius: 8,
        scrollbarInset: 2,
        scrollbarThumbColor: '#7aa2f7',
        scrollbarThumbOpacity: 0.78,
        scrollbarThumbHoverColor: '#a9c1ff',
        scrollbarThumbBorderColor: '#dbe6ff',
        scrollbarTrackColor: '#171a21',
        scrollbarTrackOpacity: 0.28,

        // Weather Cycle owns the badge content and visibility. These fields
        // only become active after a Bedazzler preset is chosen.
        weatherBadgeMode: 'extension',
        weatherBadgePalette: 'theme',
        weatherBadgeFontUseCustom: false,
        weatherBadgeFont: 'theme',
        weatherBadgeFontSize: 13,
        weatherBadgeFontWeight: 500,
        weatherBadgeLetterSpacing: 0,
        weatherBadgePaddingX: 10,
        weatherBadgePaddingY: 6,
        weatherBadgeRadius: 10,
        weatherBadgeBackgroundColor: '#1b1822',
        weatherBadgeBackgroundOpacity: 0.82,
        weatherBadgeTextColor: '#f5f2f8',
        weatherBadgeBorderColor: '#ffffff',
        weatherBadgeBorderOpacity: 0.18,
        weatherBadgeBorderWidth: 1,
        weatherBadgeBlur: 8,
        weatherBadgeShadow: 'soft',

        // Chat Top Bar remains extension-owned until individual appearance
        // groups are enabled, so theme changes keep flowing through by default.
        chatTopBarSurfaceMode: 'extension',
        chatTopBarBackgroundColor: '#171717',
        chatTopBarBackgroundOpacity: 0.85,
        chatTopBarTextMode: 'extension',
        chatTopBarTextColor: '#f5f2f8',
        chatTopBarRadiusMode: 'extension',
        chatTopBarTopRadius: 10,
        chatTopBarBottomRadius: 0,

        // Guided Generations' own theme remains authoritative until one of
        // these narrowly-scoped bottom-row button groups is enabled.
        guidedGenerationsTextMode: 'extension',
        guidedGenerationsTextColor: '#f5f2f8',
        guidedGenerationsBackgroundMode: 'extension',
        guidedGenerationsBackgroundColor: '#171717',
        guidedGenerationsBorderMode: 'extension',
        guidedGenerationsBorderWidth: 1,
        guidedGenerationsBorderStyle: 'solid',
        guidedGenerationsBorderColor: '#f5f2f8',
        guidedGenerationsRadiusMode: 'extension',
        guidedGenerationsRadius: 4,
    },
    background: {
        // ── Background image filters (applied to #bg1 / #bg_custom) ──
        blur: 0,           // px
        brightness: 100,   // %
        contrast: 100,     // %
        saturate: 100,     // %
        grayscale: 0,      // %
        sepia: 0,          // %
        hueRotate: 0,      // deg
        zoom: 100,         // % scale (overflow-hidden clips the overscan)

        // ── Base tint (linear gradient wash over the image) ──
        tintColor: '#050408',
        tintTopOpacity: 0,     // 0 = layer off
        tintBottomOpacity: 0,  // 0 = layer off
        tintAngle: 180,        // deg (180 = top → bottom)

        // ── Center highlight (radial glow) ──
        highlightColor: '#ffffff',
        highlightOpacity: 0,   // 0 = layer off
        highlightSize: 40,     // % radius to transparent

        // ── Accent glow (positionable radial) ──
        accentColor: '#785ca0',
        accentOpacity: 0,      // 0 = layer off
        accentSize: 42,        // % radius to transparent
        accentPosition: 'bottom right',

        // ── Vignette (edge darkening) ──
        vignetteColor: '#000000',
        vignetteOpacity: 0,    // 0 = layer off
        vignetteSize: 60,      // % where darkening starts

        // ── Texture / pattern overlay (cheap repeating-gradient lines) ──
        textureType: 'none',    // 'none' | 'scanlines' | 'grid'
        textureColor: '#ffffff',
        textureOpacity: 0,      // 0 = layer off
        textureScale: 3,        // px spacing between lines

        // ── Blend ──
        blendMode: 'normal',
    },
    cursor: {
        // Source mode:
        //   'set' — pick a discovered set folder (auto-maps standard cursor
        //           filenames to CSS cursor types) and/or set per-type manual
        //           overrides. Manual entries win over the set's mapping.
        //   'url' — a single cursor applied to EVERYTHING via `* { cursor }`,
        //           mirroring the classic hand-written custom-CSS approach.
        mode: 'set',

        // 'set' mode — the chosen set folder name under user/files/cursors/.
        // Empty = no set (manual overrides can still apply on their own).
        setName: '',

        // 'set' mode — per-type manual overrides. Each value is a URL
        // (https://…) or a served path (e.g. /user/files/cursors/Foo/Hand.cur).
        // Empty string = not overridden. Keys match CURSOR_TYPES in cursors.js.
        manual: {
            'default': '',
            'pointer': '',
            'text': '',
            'not-allowed': '',
            'move': '',
            'ns-resize': '',
            'ew-resize': '',
            'nwse-resize': '',
            'nesw-resize': '',
        },

        // 'url' mode — the single global cursor URL/path, plus its optional
        // hotspot (the active pixel). Hotspot is ignored for .cur/.ani, which
        // carry their own embedded hotspot; it matters for .png/.svg/.gif.
        url: '',
        hotspotX: 0,
        hotspotY: 0,

        // Max rendered size (px) for set .cur/.ico cursors. Multi-resolution
        // packs (e.g. 32/48/64/96/128 in one file) otherwise render at their
        // LARGEST size — this caps them via the plugin's sub-image picker.
        // 32 is the standard cursor size.
        maxSize: 32,
    },
};

/**
 * Human-readable labels for element types.
 */
export const ELEMENT_LABELS = {
    dialogue: 'Fonts',
    banner: 'Banner',
    container: 'Container',
    avatar: 'Message Elements',
    generalUi: 'General UI',
    background: 'Background',
    cursor: 'Cursor',
};

/**
 * All element type keys.
 */
export const ELEMENT_TYPES = Object.keys(ELEMENT_DEFAULTS);

// ============================================================
// Avatar Overlay Presets
// ============================================================

const avatarOverlay = (overrides) => ({
    ...AVATAR_OVERLAY_DEFAULTS,
    avatarOverlayEnabled: true,
    ...overrides,
});

export const AVATAR_OVERLAY_PRESETS = {
    warmFilm: {
        label: 'Warm film',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#f0a16d',
            avatarOverlaySecondaryColor: '#71364d',
            avatarOverlayOpacity: 0.34,
            avatarOverlayAngle: 145,
            avatarOverlayBlendMode: 'soft-light',
            avatarOverlayVignette: 0.22,
        }),
    },
    moonlitBlue: {
        label: 'Moonlit blue',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#16335f',
            avatarOverlaySecondaryColor: '#83c4ff',
            avatarOverlayOpacity: 0.44,
            avatarOverlayAngle: 155,
            avatarOverlayBlendMode: 'color',
            avatarOverlayVignette: 0.16,
        }),
    },
    roseGlass: {
        label: 'Rose glass',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#762a53',
            avatarOverlaySecondaryColor: '#f0a1bd',
            avatarOverlayOpacity: 0.36,
            avatarOverlayAngle: 130,
            avatarOverlayBlendMode: 'soft-light',
            avatarOverlayVignette: 0.1,
        }),
    },
    goldenHour: {
        label: 'Golden hour',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#ffd071',
            avatarOverlaySecondaryColor: '#b84e27',
            avatarOverlayOpacity: 0.3,
            avatarOverlayAngle: 175,
            avatarOverlayBlendMode: 'overlay',
            avatarOverlayVignette: 0.24,
        }),
    },
    cyberSignal: {
        label: 'Cyber signal',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#16e0c2',
            avatarOverlaySecondaryColor: '#ad3cff',
            avatarOverlayOpacity: 0.38,
            avatarOverlayAngle: 115,
            avatarOverlayBlendMode: 'color',
            avatarOverlayVignette: 0.08,
        }),
    },
    noir: {
        label: 'Noir',
        properties: avatarOverlay({
            avatarOverlayType: 'solid',
            avatarOverlayPrimaryColor: '#777777',
            avatarOverlaySecondaryColor: '#777777',
            avatarOverlayOpacity: 0.78,
            avatarOverlayAngle: 180,
            avatarOverlayBlendMode: 'color',
            avatarOverlayVignette: 0.3,
        }),
    },
    emeraldDream: {
        label: 'Emerald dream',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#0f513f',
            avatarOverlaySecondaryColor: '#d6b86a',
            avatarOverlayOpacity: 0.34,
            avatarOverlayAngle: 150,
            avatarOverlayBlendMode: 'soft-light',
            avatarOverlayVignette: 0.16,
        }),
    },
    arcticBloom: {
        label: 'Arctic bloom',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#58d9e8',
            avatarOverlaySecondaryColor: '#b88cff',
            avatarOverlayOpacity: 0.26,
            avatarOverlayAngle: 120,
            avatarOverlayBlendMode: 'screen',
            avatarOverlayVignette: 0.08,
        }),
    },
    sepiaArchive: {
        label: 'Sepia archive',
        properties: avatarOverlay({
            avatarOverlayType: 'solid',
            avatarOverlayPrimaryColor: '#9a6738',
            avatarOverlaySecondaryColor: '#9a6738',
            avatarOverlayOpacity: 0.48,
            avatarOverlayAngle: 180,
            avatarOverlayBlendMode: 'color',
            avatarOverlayVignette: 0.28,
        }),
    },
    bloodMoon: {
        label: 'Blood moon',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#1a0508',
            avatarOverlaySecondaryColor: '#c92e42',
            avatarOverlayOpacity: 0.46,
            avatarOverlayAngle: 35,
            avatarOverlayBlendMode: 'multiply',
            avatarOverlayVignette: 0.4,
        }),
    },
    celestialGold: {
        label: 'Celestial gold',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#14264f',
            avatarOverlaySecondaryColor: '#f1cf77',
            avatarOverlayOpacity: 0.32,
            avatarOverlayAngle: 160,
            avatarOverlayBlendMode: 'overlay',
            avatarOverlayVignette: 0.2,
        }),
    },
    fadedPolaroid: {
        label: 'Faded polaroid',
        properties: avatarOverlay({
            avatarOverlayType: 'gradient',
            avatarOverlayPrimaryColor: '#f5dcb2',
            avatarOverlaySecondaryColor: '#6a9b91',
            avatarOverlayOpacity: 0.22,
            avatarOverlayAngle: 140,
            avatarOverlayBlendMode: 'screen',
            avatarOverlayVignette: 0.18,
        }),
    },
};

// ============================================================
// Message Action Presets
// ============================================================

const messageActions = (overrides) => ({
    ...MESSAGE_ACTION_DEFAULTS,
    actionButtonsEnabled: true,
    ...overrides,
});

export const MESSAGE_ACTION_PRESETS = {
    quietAccent: {
        label: 'Quiet accent',
        properties: messageActions({
            actionVisibility: 'dim', actionRestingOpacity: 0.42,
            actionButtonSize: 24, actionIconSize: 15, actionGap: 7, actionRadius: 0,
            actionSurface: 'bare', actionRestingIconColor: '#e7e2ec',
            actionHoverIconColor: '#a987d8', actionHoverMotion: 'lift',
            actionAnimationSpeed: 'normal', actionShadow: 'none',
        }),
    },
    frostedSquares: {
        label: 'Frosted squares',
        properties: messageActions({
            actionVisibility: 'dim', actionRestingOpacity: 0.52,
            actionButtonSize: 29, actionIconSize: 15, actionGap: 8, actionRadius: 6,
            actionSurface: 'glass', actionRestingIconColor: '#d0d7e2',
            actionRestingSurfaceColor: '#ffffff', actionHoverIconColor: '#ffffff',
            actionHoverSurfaceColor: '#789abc', actionHoverMotion: 'pop',
            actionAnimationSpeed: 'slow', actionShadow: 'soft',
        }),
    },
    raceControl: {
        label: 'Race control',
        properties: messageActions({
            actionVisibility: 'dim', actionRestingOpacity: 0.3,
            actionButtonSize: 27, actionIconSize: 14, actionGap: 8, actionRadius: 4,
            actionReverse: true, actionSurface: 'solid',
            actionRestingIconColor: '#aaaaaa', actionRestingSurfaceColor: '#282828',
            actionHoverIconColor: '#ffffff', actionHoverSurfaceColor: '#cf1017',
            actionHoverMotion: 'snap', actionAnimationSpeed: 'fast', actionShadow: 'none',
        }),
    },
    softCircles: {
        label: 'Soft circles',
        properties: messageActions({
            actionVisibility: 'hidden', actionRestingOpacity: 0.1,
            actionButtonSize: 30, actionIconSize: 15, actionGap: 9, actionRadius: 30,
            actionReverse: true, actionSurface: 'solid',
            actionRestingIconColor: '#f49ab3', actionRestingSurfaceColor: '#422f39',
            actionHoverIconColor: '#ffffff', actionHoverSurfaceColor: '#cf6682',
            actionHoverMotion: 'tilt', actionAnimationSpeed: 'slow', actionShadow: 'soft',
        }),
    },
    reversedMinimal: {
        label: 'Reversed minimal',
        properties: messageActions({
            actionVisibility: 'always', actionButtonSize: 25, actionIconSize: 15,
            actionGap: 4, actionRadius: 0, actionReverse: true, actionSurface: 'bare',
            actionRestingIconColor: '#b8c1ba', actionHoverIconColor: '#eef1ed',
            actionHoverMotion: 'lift', actionAnimationSpeed: 'normal', actionShadow: 'none',
        }),
    },
    crispCompact: {
        label: 'Crisp compact',
        properties: messageActions({
            actionVisibility: 'dim', actionRestingOpacity: 0.46,
            actionButtonSize: 23, actionIconSize: 14, actionGap: 3, actionRadius: 0,
            actionSurface: 'bare', actionRestingIconColor: '#d9dcec',
            actionHoverIconColor: '#fff5aa', actionHoverMotion: 'color',
            actionAnimationSpeed: 'fast', actionShadow: 'none',
        }),
    },
};

// ============================================================
// Weather Badge Presets
// ============================================================

const weatherBadge = (overrides) => ({
    weatherBadgeMode: 'custom',
    weatherBadgePalette: 'theme',
    weatherBadgeFontUseCustom: false,
    weatherBadgeFont: 'theme',
    weatherBadgeFontSize: 13,
    weatherBadgeFontWeight: 500,
    weatherBadgeLetterSpacing: 0,
    weatherBadgePaddingX: 10,
    weatherBadgePaddingY: 6,
    weatherBadgeRadius: 10,
    weatherBadgeBackgroundColor: '#1b1822',
    weatherBadgeBackgroundOpacity: 0.82,
    weatherBadgeTextColor: '#f5f2f8',
    weatherBadgeBorderColor: '#ffffff',
    weatherBadgeBorderOpacity: 0.18,
    weatherBadgeBorderWidth: 1,
    weatherBadgeBlur: 8,
    weatherBadgeShadow: 'soft',
    ...overrides,
});

export const WEATHER_BADGE_PRESETS = {
    themeBlend: {
        label: 'Theme Blend',
        properties: weatherBadge({}),
    },
    glassPill: {
        label: 'Glass Pill',
        properties: weatherBadge({
            weatherBadgeBackgroundOpacity: 0.62,
            weatherBadgePaddingX: 13,
            weatherBadgePaddingY: 7,
            weatherBadgeRadius: 40,
            weatherBadgeBlur: 14,
            weatherBadgeShadow: 'float',
        }),
    },
    minimal: {
        label: 'Minimal',
        properties: weatherBadge({
            weatherBadgeBackgroundOpacity: 0,
            weatherBadgePaddingX: 4,
            weatherBadgePaddingY: 2,
            weatherBadgeRadius: 0,
            weatherBadgeBorderWidth: 0,
            weatherBadgeBlur: 0,
            weatherBadgeShadow: 'none',
            weatherBadgeFontWeight: 600,
        }),
    },
    softCard: {
        label: 'Soft Card',
        properties: weatherBadge({
            weatherBadgeBackgroundOpacity: 0.88,
            weatherBadgePaddingX: 12,
            weatherBadgePaddingY: 8,
            weatherBadgeRadius: 14,
            weatherBadgeBlur: 10,
            weatherBadgeShadow: 'float',
        }),
    },
    terminal: {
        label: 'Terminal',
        properties: weatherBadge({
            weatherBadgePalette: 'custom',
            weatherBadgeFontUseCustom: true,
            weatherBadgeFont: 'mono',
            weatherBadgeFontSize: 12,
            weatherBadgeFontWeight: 600,
            weatherBadgeLetterSpacing: 0.4,
            weatherBadgePaddingX: 10,
            weatherBadgePaddingY: 6,
            weatherBadgeRadius: 4,
            weatherBadgeBackgroundColor: '#07110b',
            weatherBadgeBackgroundOpacity: 0.94,
            weatherBadgeTextColor: '#7dff9b',
            weatherBadgeBorderColor: '#3ddd72',
            weatherBadgeBorderOpacity: 0.55,
            weatherBadgeBlur: 0,
            weatherBadgeShadow: 'glow',
        }),
    },
    quietGlass: {
        label: 'Quiet Glass',
        properties: weatherBadge({
            weatherBadgeFontSize: 12,
            weatherBadgePaddingY: 4,
            weatherBadgeRadius: 18,
            weatherBadgeBackgroundOpacity: 0.4,
            weatherBadgeBorderOpacity: 0.1,
            weatherBadgeBlur: 16,
            weatherBadgeShadow: 'none',
        }),
    },
    hairline: {
        label: 'Hairline',
        properties: weatherBadge({
            weatherBadgeFontSize: 11,
            weatherBadgeLetterSpacing: 0.2,
            weatherBadgePaddingX: 9,
            weatherBadgePaddingY: 4,
            weatherBadgeRadius: 6,
            weatherBadgeBackgroundOpacity: 0.3,
            weatherBadgeBorderOpacity: 0.2,
            weatherBadgeBlur: 10,
            weatherBadgeShadow: 'none',
        }),
    },
    softSignal: {
        label: 'Soft Signal',
        properties: weatherBadge({
            weatherBadgeFontSize: 12,
            weatherBadgeLetterSpacing: -0.1,
            weatherBadgePaddingY: 5,
            weatherBadgeBackgroundOpacity: 0.5,
            weatherBadgeBorderWidth: 0,
            weatherBadgeBorderOpacity: 0,
            weatherBadgeBlur: 18,
            weatherBadgeShadow: 'soft',
        }),
    },
    bareDatum: {
        label: 'Bare Datum',
        properties: weatherBadge({
            weatherBadgeFontSize: 11,
            weatherBadgeFontWeight: 600,
            weatherBadgeLetterSpacing: 0.3,
            weatherBadgePaddingX: 4,
            weatherBadgePaddingY: 2,
            weatherBadgeRadius: 0,
            weatherBadgeBackgroundOpacity: 0,
            weatherBadgeBorderWidth: 0,
            weatherBadgeBorderOpacity: 0,
            weatherBadgeBlur: 0,
            weatherBadgeShadow: 'none',
        }),
    },
};

// ============================================================
// Background Presets
// ============================================================

/**
 * Curated Background looks. Each preset's `properties` is a COMPLETE background
 * property set (built from the defaults + overrides) so loading one gives a
 * clean slate rather than merging onto whatever was there before. The user can
 * tweak every field afterward, or ignore presets entirely.
 *
 * Kept intentionally cheap to render: only static gradients and repeating-line
 * textures — no blur stacks, animations, or backdrop-filters.
 */
const bg = (overrides) => ({ ...ELEMENT_DEFAULTS.background, ...overrides });

export const BACKGROUND_PRESETS = {
    spooky: {
        label: 'Spooky / horror',
        properties: bg({
            brightness: 90, contrast: 105, saturate: 85,
            tintColor: '#070b09', tintTopOpacity: 0.55, tintBottomOpacity: 0.85, tintAngle: 180,
            accentColor: '#78a08c', accentOpacity: 0.18, accentSize: 60, accentPosition: 'top',
            vignetteColor: '#000000', vignetteOpacity: 0.9, vignetteSize: 42,
            textureType: 'scanlines', textureColor: '#ffffff', textureOpacity: 0.04, textureScale: 3,
        }),
    },
    cozy: {
        label: 'Warm / cozy',
        properties: bg({
            brightness: 105, saturate: 115,
            tintColor: '#3a2410', tintTopOpacity: 0.25, tintBottomOpacity: 0.5, tintAngle: 180,
            highlightColor: '#ffd696', highlightOpacity: 0.28, highlightSize: 55,
            vignetteColor: '#321905', vignetteOpacity: 0.55, vignetteSize: 60,
        }),
    },
    cyber: {
        label: 'Cool / cyber',
        properties: bg({
            contrast: 115, saturate: 130,
            tintColor: '#0a0c1e', tintTopOpacity: 0.35, tintBottomOpacity: 0.6, tintAngle: 180,
            highlightColor: '#00dcc8', highlightOpacity: 0.12, highlightSize: 45,
            accentColor: '#5a78ff', accentOpacity: 0.30, accentSize: 50, accentPosition: 'bottom right',
            textureType: 'scanlines', textureColor: '#78c8ff', textureOpacity: 0.05, textureScale: 4,
        }),
    },
    cinematic: {
        label: 'Dramatic / cinematic',
        properties: bg({
            saturate: 55, contrast: 120,
            tintColor: '#000000', tintTopOpacity: 0.3, tintBottomOpacity: 0.45, tintAngle: 180,
            vignetteColor: '#000000', vignetteOpacity: 0.85, vignetteSize: 38,
        }),
    },
    cutesy: {
        label: 'Cutesy / pink',
        properties: bg({
            brightness: 108, saturate: 115,
            tintColor: '#ff8fce', tintTopOpacity: 0.18, tintBottomOpacity: 0.32, tintAngle: 180,
            highlightColor: '#fff0f8', highlightOpacity: 0.30, highlightSize: 55,
            accentColor: '#ffb3e6', accentOpacity: 0.28, accentSize: 55, accentPosition: 'top',
            vignetteColor: '#c94f9c', vignetteOpacity: 0.30, vignetteSize: 62,
        }),
    },
    dreamy: {
        label: 'Dreamy / pastel',
        properties: bg({
            brightness: 106, contrast: 95, saturate: 92,
            tintColor: '#b8a0e8', tintTopOpacity: 0.22, tintBottomOpacity: 0.30, tintAngle: 180,
            highlightColor: '#fdf0ff', highlightOpacity: 0.28, highlightSize: 60,
            accentColor: '#a0d8ff', accentOpacity: 0.22, accentSize: 55, accentPosition: 'bottom left',
            vignetteColor: '#5a4a8a', vignetteOpacity: 0.28, vignetteSize: 62,
        }),
    },
    vaporwave: {
        label: 'Vaporwave',
        properties: bg({
            contrast: 110, saturate: 135,
            tintColor: '#2a0a3a', tintTopOpacity: 0.35, tintBottomOpacity: 0.6, tintAngle: 180,
            highlightColor: '#ff71ce', highlightOpacity: 0.20, highlightSize: 45,
            accentColor: '#01cdfe', accentOpacity: 0.30, accentSize: 52, accentPosition: 'bottom right',
            vignetteColor: '#1a0630', vignetteOpacity: 0.55, vignetteSize: 55,
            textureType: 'grid', textureColor: '#ff71ce', textureOpacity: 0.06, textureScale: 8,
        }),
    },
    ocean: {
        label: 'Ocean / underwater',
        properties: bg({
            brightness: 98, contrast: 105, saturate: 115,
            tintColor: '#063a4a', tintTopOpacity: 0.30, tintBottomOpacity: 0.6, tintAngle: 180,
            highlightColor: '#8ff0e0', highlightOpacity: 0.16, highlightSize: 50,
            accentColor: '#1d9e75', accentOpacity: 0.22, accentSize: 55, accentPosition: 'top',
            vignetteColor: '#02141a', vignetteOpacity: 0.6, vignetteSize: 48,
        }),
    },
    historical: {
        label: 'Historical / vintage',
        properties: bg({
            brightness: 102, contrast: 95, saturate: 85, sepia: 40,
            tintColor: '#4a3418', tintTopOpacity: 0.20, tintBottomOpacity: 0.4, tintAngle: 180,
            highlightColor: '#f5e6c8', highlightOpacity: 0.18, highlightSize: 55,
            vignetteColor: '#2a1c08', vignetteOpacity: 0.6, vignetteSize: 50,
        }),
    },
    dystopian: {
        label: 'Dystopian',
        properties: bg({
            brightness: 88, contrast: 115, saturate: 60,
            tintColor: '#1a1e14', tintTopOpacity: 0.45, tintBottomOpacity: 0.75, tintAngle: 180,
            accentColor: '#8a7a2a', accentOpacity: 0.20, accentSize: 60, accentPosition: 'top',
            vignetteColor: '#000000', vignetteOpacity: 0.85, vignetteSize: 42,
            textureType: 'scanlines', textureColor: '#ffffff', textureOpacity: 0.03, textureScale: 3,
        }),
    },
    wintry: {
        label: 'Wintry / frost',
        properties: bg({
            brightness: 108, contrast: 102, saturate: 80,
            tintColor: '#bcd8f0', tintTopOpacity: 0.20, tintBottomOpacity: 0.35, tintAngle: 180,
            highlightColor: '#ffffff', highlightOpacity: 0.28, highlightSize: 60,
            accentColor: '#7fb8e6', accentOpacity: 0.20, accentSize: 55, accentPosition: 'top',
            vignetteColor: '#2a3a4a', vignetteOpacity: 0.35, vignetteSize: 60,
        }),
    },
    cultivation: {
        label: 'Cultivation / cultivator',
        properties: bg({
            brightness: 104, contrast: 102, saturate: 118,
            tintColor: '#0a2a1e', tintTopOpacity: 0.22, tintBottomOpacity: 0.45, tintAngle: 180,
            highlightColor: '#d8ffe8', highlightOpacity: 0.20, highlightSize: 55,
            accentColor: '#2ec77e', accentOpacity: 0.24, accentSize: 55, accentPosition: 'bottom',
            vignetteColor: '#04140c', vignetteOpacity: 0.5, vignetteSize: 55,
        }),
    },
};

// ============================================================
// Banner Presets
// ============================================================

/**
 * Curated Banner looks. Like the Background presets, each preset's `properties`
 * is a COMPLETE banner property set (defaults + overrides) so loading one gives
 * a clean slate rather than merging onto whatever was there before. Every field
 * stays editable afterward.
 *
 * A banner sits above each AI message (and can be assigned to personas too),
 * drawing the character/persona banner image, then muting it with an overlay
 * and/or fading it into the message body. These presets only shape that band —
 * height, how far the text is pushed down, image crop, the mute/fade, and the
 * bottom edge treatment. They intentionally leave the message box border,
 * shadow and left-accent to the Container element, so presets layer cleanly on
 * top of any theme.
 */
const banner = (overrides) => ({ ...ELEMENT_DEFAULTS.banner, ...overrides });

export const BANNER_PRESETS = {
    // The user's own theme banner: a solid concrete-tinted image band held at
    // full strength (no fade) and capped with a thin rust accent underline.
    // Understated, report/dossier feel.
    dossier: {
        label: 'Dossier (muted + accent line)',
        properties: banner({
            height: 120, paddingTop: 150, bannerPosition: 20, borderRadius: 2,
            overlayColor: '#232529', overlayOpacity: 0.5,
            // No bottom fade — the image stays solid to the band's edge and is
            // capped by the accent underline, rather than ghosting out.
            bottomFadeColor: '#232529', bottomFadeOpacity: 0,
            borderBottomWidth: 1, borderBottomStyle: 'solid',
            borderBottomColor: '#a65e44', borderBottomOpacity: 1,
        }),
    },
    // Barely-there image header: short band, gentle fade into the text, no
    // overlay tint and no border. The most restrained option.
    whisper: {
        label: 'Whisper (subtle header)',
        properties: banner({
            height: 90, paddingTop: 118, bannerPosition: 25, borderRadius: 0,
            overlayOpacity: 0,
            bottomFadeColor: '#000000', bottomFadeOpacity: 0.55,
            borderBottomWidth: 0, borderBottomStyle: 'none',
        }),
    },
    // Wide letterbox strip. Tall, lightly darkened, heavy fade into the copy —
    // the image reads like a film still behind the scene.
    cinematic: {
        label: 'Cinematic (tall letterbox)',
        properties: banner({
            height: 200, paddingTop: 232, bannerPosition: 30, borderRadius: 0,
            overlayColor: '#000000', overlayOpacity: 0.18,
            bottomFadeColor: '#000000', bottomFadeOpacity: 0.85,
            borderBottomWidth: 0, borderBottomStyle: 'none',
        }),
    },
    // Image-dominant hero. Very tall, minimal muting, only a soft fade so the
    // banner art carries the message. Bold.
    fullBleed: {
        label: 'Full Bleed (image hero)',
        properties: banner({
            height: 240, paddingTop: 272, bannerPosition: 40, borderRadius: 0,
            overlayOpacity: 0,
            bottomFadeColor: '#000000', bottomFadeOpacity: 0.32,
            borderBottomWidth: 0, borderBottomStyle: 'none',
        }),
    },
    // Cyber look: cool dark wash over the image, mid fade, and a bright cyan
    // rule under the band. Bold, techy.
    neon: {
        label: 'Neon Edge (cyber underline)',
        properties: banner({
            height: 130, paddingTop: 162, bannerPosition: 25, borderRadius: 0,
            overlayType: 'gradient', overlayColor: '#0a0c1e',
            overlaySecondaryColor: '#124a52', overlayAngle: 115,
            overlayBlendMode: 'soft-light', overlayVignette: 0.16, overlayOpacity: 0.35,
            bottomFadeColor: '#000000', bottomFadeOpacity: 0.5,
            borderBottomWidth: 2, borderBottomStyle: 'solid',
            borderBottomColor: '#00dcc8', borderBottomOpacity: 0.9,
        }),
    },
    // Vintage/warm: sepia-toned overlay and a warm double rule underneath, like
    // an old book plate.
    manuscript: {
        label: 'Manuscript (vintage double rule)',
        properties: banner({
            height: 120, paddingTop: 152, bannerPosition: 25, borderRadius: 0,
            overlayType: 'gradient', overlayColor: '#4a3418',
            overlaySecondaryColor: '#9a6b35', overlayAngle: 165,
            overlayBlendMode: 'multiply', overlayVignette: 0.18, overlayOpacity: 0.3,
            bottomFadeColor: '#000000', bottomFadeOpacity: 0.5,
            borderBottomWidth: 3, borderBottomStyle: 'double',
            borderBottomColor: '#c8a878', borderBottomOpacity: 0.85,
        }),
    },
    // Soft cool frame: rounded corners, a faint icy wash, a thin light-blue
    // rule. Subtle and clean.
    frost: {
        label: 'Frost Pane (soft rounded)',
        properties: banner({
            height: 110, paddingTop: 140, bannerPosition: 25, borderRadius: 8,
            overlayType: 'gradient', overlayColor: '#bcd8f0',
            overlaySecondaryColor: '#8d86bf', overlayAngle: 135,
            overlayBlendMode: 'screen', overlayVignette: 0.08, overlayOpacity: 0.12,
            bottomFadeColor: '#000000', bottomFadeOpacity: 0.45,
            borderBottomWidth: 1, borderBottomStyle: 'solid',
            borderBottomColor: '#7fb8e6', borderBottomOpacity: 0.6,
        }),
    },
    // Gallery print: a solid rounded photo, no tint, with a soft translucent
    // white hairline underneath — a photo pinned above the message. Kept solid
    // (no fade) so it reads like an actual print rather than a vignette.
    polaroid: {
        label: 'Polaroid (light frame)',
        properties: banner({
            height: 112, paddingTop: 142, bannerPosition: 25, borderRadius: 10,
            overlayOpacity: 0,
            bottomFadeColor: '#000000', bottomFadeOpacity: 0,
            borderBottomWidth: 2, borderBottomStyle: 'solid',
            borderBottomColor: '#ffffff', borderBottomOpacity: 0.25,
        }),
    },
    // Dramatic: a heavy dark overlay and deep fade pull focus down onto the
    // text, leaving the image as a shadowed presence. No border.
    spotlight: {
        label: 'Spotlight (dramatic dark)',
        properties: banner({
            height: 150, paddingTop: 182, bannerPosition: 25, borderRadius: 0,
            overlayColor: '#000000', overlayBlendMode: 'multiply',
            overlayVignette: 0.38, overlayOpacity: 0.42,
            bottomFadeColor: '#000000', bottomFadeOpacity: 0.72,
            borderBottomWidth: 0, borderBottomStyle: 'none',
        }),
    },
    // Angled sports/esports header: the image is cut on a diagonal that rises
    // to the right, with a thick accent bar riding the slant. The Bottom Border
    // controls (width/color) drive that bar. Bold and kinetic.
    slantEdge: {
        label: 'Slant Edge (angled bold bar)',
        properties: banner({
            height: 132, paddingTop: 172, bannerPosition: 30, borderRadius: 0,
            overlayColor: '#101216', overlayOpacity: 0.22,
            bottomFadeColor: '#000000', bottomFadeOpacity: 0.28,
            slant: 26, slantDirection: 'right',
            borderBottomWidth: 6, borderBottomStyle: 'solid',
            borderBottomColor: '#ef4444', borderBottomOpacity: 1,
        }),
    },
    // Cyber console: a deep blue-black wash with a hard magenta rule beneath —
    // punchier and cooler than Neon Edge, which uses a thinner cyan line.
    cyber: {
        label: 'Cyber (deep neon rule)',
        properties: banner({
            height: 128, paddingTop: 160, bannerPosition: 25, borderRadius: 0,
            overlayType: 'gradient', overlayColor: '#06101f',
            overlaySecondaryColor: '#471442', overlayAngle: 110,
            overlayBlendMode: 'color', overlayVignette: 0.22, overlayOpacity: 0.45,
            bottomFadeColor: '#020814', bottomFadeOpacity: 0.5,
            borderBottomWidth: 3, borderBottomStyle: 'solid',
            borderBottomColor: '#ff2fb9', borderBottomOpacity: 1,
        }),
    },
    // Soft and cute: short rounded band, a pastel pink wash and a chunky
    // bubblegum underline. Gentle fade so it melts into the message.
    kawaii: {
        label: 'Kawaii (soft pastel)',
        properties: banner({
            height: 100, paddingTop: 132, bannerPosition: 25, borderRadius: 16,
            overlayType: 'gradient', overlayColor: '#ffd1ec',
            overlaySecondaryColor: '#bfe5ff', overlayAngle: 135,
            overlayBlendMode: 'soft-light', overlayVignette: 0.1, overlayOpacity: 0.22,
            bottomFadeColor: '#ffffff', bottomFadeOpacity: 0.35,
            borderBottomWidth: 4, borderBottomStyle: 'solid',
            borderBottomColor: '#ff8fce', borderBottomOpacity: 0.9,
        }),
    },
};

// ============================================================
// Settings Access
// ============================================================

/**
 * Get the chatDesign settings object, initializing if needed.
 */
export function getChatDesignSettings() {
    const settings = extension_settings[MODULE_NAME];
    if (!settings) return { enabled: false, styles: [] };
    if (!settings.chatDesign) {
        settings.chatDesign = { enabled: false, styles: [] };
    }
    migrateNameStylesIntoFonts(settings.chatDesign);
    return settings.chatDesign;
}

function normalizeStyleName(name) {
    return String(name || '').trim().toLocaleLowerCase();
}

function mergeUnique(left, right) {
    return [...new Set([...(left || []), ...(right || [])])];
}

function namePropertiesForFonts(properties = {}) {
    return Object.fromEntries(Object.keys(NAME_DEFAULTS).map(key => {
        const targetKey = `name${key[0].toUpperCase()}${key.slice(1)}`;
        return [targetKey, key in properties ? properties[key] : NAME_DEFAULTS[key]];
    }));
}

function uniqueImportedStyleName(name, usedNames) {
    const base = String(name || '').trim() || 'Imported Name';
    let candidate = `${base} (Name import)`;
    let suffix = 2;
    while (usedNames.has(normalizeStyleName(candidate))) {
        candidate = `${base} (Name import ${suffix++})`;
    }
    usedNames.add(normalizeStyleName(candidate));
    return candidate;
}

/** Fold the retired standalone Name style type into Fonts styles exactly once. */
function migrateNameStylesIntoFonts(chatDesign) {
    const styles = Array.isArray(chatDesign.styles) ? chatDesign.styles : [];
    const nameStyles = styles.filter(style => style?.element === 'name');
    if (nameStyles.length === 0) return;

    const fontStyles = styles.filter(style => style?.element === 'dialogue');
    const nameCounts = new Map();
    const fontMatches = new Map();
    const usedNames = new Set(styles.map(style => normalizeStyleName(style?.name)).filter(Boolean));

    for (const style of nameStyles) {
        const key = normalizeStyleName(style.name);
        nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    for (const style of fontStyles) {
        const key = normalizeStyleName(style.name);
        const matches = fontMatches.get(key) || [];
        matches.push(style);
        fontMatches.set(key, matches);
    }

    for (const legacy of nameStyles) {
        const key = normalizeStyleName(legacy.name);
        const matches = fontMatches.get(key) || [];
        const unambiguousMatch = key && nameCounts.get(key) === 1 && matches.length === 1
            ? matches[0]
            : null;

        if (unambiguousMatch) {
            unambiguousMatch.properties = {
                ...ELEMENT_DEFAULTS.dialogue,
                ...(unambiguousMatch.properties || {}),
                ...namePropertiesForFonts(legacy.properties),
            };
            unambiguousMatch.assignedCharacters = mergeUnique(unambiguousMatch.assignedCharacters, legacy.assignedCharacters);
            unambiguousMatch.assignedPersonas = mergeUnique(unambiguousMatch.assignedPersonas, legacy.assignedPersonas);
            unambiguousMatch.assignedVerses = mergeUnique(unambiguousMatch.assignedVerses, legacy.assignedVerses);
            unambiguousMatch.assignedVersesIncludePersonas = Boolean(
                unambiguousMatch.assignedVersesIncludePersonas || legacy.assignedVersesIncludePersonas,
            );
            unambiguousMatch.isDefault = Boolean(unambiguousMatch.isDefault || legacy.isDefault);
            unambiguousMatch.enabled = unambiguousMatch.enabled !== false || legacy.enabled !== false;
            continue;
        }

        const collides = Boolean(
            key && ((fontMatches.get(key)?.length || 0) > 0 || (nameCounts.get(key) || 0) > 1),
        );
        legacy.name = collides ? uniqueImportedStyleName(legacy.name, usedNames) : (legacy.name || 'Imported Name');
        usedNames.add(normalizeStyleName(legacy.name));
        legacy.element = 'dialogue';
        legacy.properties = {
            ...ELEMENT_DEFAULTS.dialogue,
            ...namePropertiesForFonts(legacy.properties),
        };
    }

    chatDesign.styles = styles.filter(style => style?.element !== 'name');
    saveSettingsDebounced();
}

export function getChatDesignModalSize() {
    const size = getChatDesignSettings().modalSize;
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
    return { width: size.width, height: size.height };
}

export function setChatDesignModalSize(size) {
    const settings = getChatDesignSettings();
    if (!size) {
        delete settings.modalSize;
    } else {
        settings.modalSize = {
            width: Math.round(size.width),
            height: Math.round(size.height),
        };
    }
    saveSettingsDebounced();
}

export function isChatDesignEnabled() {
    return getChatDesignSettings().enabled;
}

export function setChatDesignEnabled(enabled) {
    getChatDesignSettings().enabled = enabled;
    saveSettingsDebounced();
}

// ============================================================
// Style CRUD
// ============================================================

function generateId() {
    return 'style_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * Get all styles.
 */
export function getAllStyles() {
    return getChatDesignSettings().styles || [];
}

/**
 * Get styles for a specific element type.
 */
export function getStylesForElement(elementType) {
    return getAllStyles().filter(s => s.element === elementType);
}

/**
 * Get a style by ID.
 */
export function getStyleById(styleId) {
    return getAllStyles().find(s => s.id === styleId) || null;
}

/**
 * Create a new style with default properties.
 * @param {string} elementType - One of ELEMENT_TYPES
 * @param {string} [name] - Optional display name
 * @returns {object} The created style
 */
export function createStyle(elementType, name) {
    const style = {
        id: generateId(),
        name: name || `New ${ELEMENT_LABELS[elementType] || elementType} style`,
        element: elementType,
        enabled: true,
        // Deep clone so nested defaults (e.g. cursor.manual) aren't shared by
        // reference across styles — a shallow spread would alias the object.
        properties: JSON.parse(JSON.stringify(ELEMENT_DEFAULTS[elementType])),
        isDefault: false,
        assignedVerses: [],
        assignedVersesIncludePersonas: false,
        assignedCharacters: [],    // avatar filenames
        assignedPersonas: [],      // avatar filenames
    };
    getChatDesignSettings().styles.push(style);
    saveSettingsDebounced();
    log('Created style:', style.id, style.name);
    return style;
}

/**
 * Update a style's CSS properties.
 */
export function updateStyleProperties(styleId, properties) {
    const style = getStyleById(styleId);
    if (!style) return null;
    Object.assign(style.properties, properties);
    saveSettingsDebounced();
    return style;
}

/**
 * Update a style's metadata (name, isDefault, assignments).
 */
export function updateStyleMeta(styleId, updates) {
    const style = getStyleById(styleId);
    if (!style) return null;
    if (updates.name !== undefined) style.name = updates.name;
    if (updates.enabled !== undefined) style.enabled = updates.enabled;
    if (updates.isDefault !== undefined) style.isDefault = updates.isDefault;
    if (updates.assignedVerses !== undefined) style.assignedVerses = updates.assignedVerses;
    if (updates.assignedVersesIncludePersonas !== undefined) style.assignedVersesIncludePersonas = updates.assignedVersesIncludePersonas;
    if (updates.assignedCharacters !== undefined) style.assignedCharacters = updates.assignedCharacters;
    if (updates.assignedPersonas !== undefined) style.assignedPersonas = updates.assignedPersonas;
    saveSettingsDebounced();
    return style;
}

/**
 * Delete a style by ID.
 */
export function deleteStyle(styleId) {
    const settings = getChatDesignSettings();
    const idx = settings.styles.findIndex(s => s.id === styleId);
    if (idx === -1) return false;
    settings.styles.splice(idx, 1);
    saveSettingsDebounced();
    log('Deleted style:', styleId);
    return true;
}

/**
 * Duplicate a style (deep clone with new ID).
 */
export function duplicateStyle(styleId) {
    const original = getStyleById(styleId);
    if (!original) return null;
    const copy = {
        ...JSON.parse(JSON.stringify(original)),
        id: generateId(),
        name: original.name + ' (copy)',
    };
    getChatDesignSettings().styles.push(copy);
    saveSettingsDebounced();
    log('Duplicated style:', original.id, '→', copy.id);
    return copy;
}

// ============================================================
// Assignment Resolution
// ============================================================

/**
 * Get VerseManager metadata if VM is installed.
 * @returns {object|null} Verse metadata keyed by verse ID, or null if VM not available
 */
function getVMVerseMetadata() {
    if (!window.VerseManager?.getAllVerseMetadata) return null;
    try {
        return window.VerseManager.getAllVerseMetadata();
    } catch {
        return null;
    }
}

/**
 * Resolve which character/persona names a style applies to.
 * Returns an array of target objects:
 *   { name: string, charAvatar?: string, personaAvatar?: string }
 *
 * Default styles return [{ name: '__default__' }].
 * Otherwise resolves direct assignments + verse membership (when VM present).
 */
export function resolveStyleTargets(style) {
    if (style.isDefault) return [{ name: '__default__' }];

    const targets = new Map();
    const allChars = getContext().characters || [];

    // Build lookup map once — avoids O(n) find per assignment
    const avatarMap = new Map(allChars.map(c => [cleanAvatar(c.avatar), c]));

    // Direct character assignments
    for (const charAvatar of style.assignedCharacters || []) {
        const cleaned = cleanAvatar(charAvatar);
        const char = avatarMap.get(cleaned);
        const name = char?.name || charAvatar;
        targets.set(`char:${cleaned}`, { name, charAvatar: cleaned });
    }

    // Direct persona assignments
    for (const pAvatar of style.assignedPersonas || []) {
        const cleaned = cleanAvatar(pAvatar);
        const name = power_user.personas?.[cleaned];
        if (name) {
            targets.set(`persona:${cleaned}`, { name, personaAvatar: cleaned });
        }
    }

    // Verse assignments (only when VM is installed)
    const verses = getVMVerseMetadata();
    if (verses) {
        for (const verseId of style.assignedVerses || []) {
            const verse = verses[verseId];
            if (!verse) continue;

            // Characters in verse
            if (verse.characters) {
                for (const avatar of verse.characters) {
                    const cleaned = cleanAvatar(avatar);
                    const char = avatarMap.get(cleaned);
                    if (char?.name) {
                        targets.set(`char:${cleaned}`, { name: char.name, charAvatar: cleaned });
                    }
                }
            }

            // Personas in verse (if opted in)
            if (style.assignedVersesIncludePersonas) {
                for (const pAvatar of verse.personas || []) {
                    const cleaned = cleanAvatar(pAvatar);
                    const pName = power_user.personas?.[cleaned];
                    if (pName) {
                        targets.set(`persona:${cleaned}`, { name: pName, personaAvatar: cleaned });
                    }
                }
                // Storyline-specific preferred personas
                for (const sl of verse.storylines || []) {
                    for (const pAvatar of sl.preferredPersonas || []) {
                        const cleaned = cleanAvatar(pAvatar);
                        const pName = power_user.personas?.[cleaned];
                        if (pName) {
                            targets.set(`persona:${cleaned}`, { name: pName, personaAvatar: cleaned });
                        }
                    }
                }
            }
        }
    }

    return Array.from(targets.values());
}

/**
 * Check if VerseManager is available for verse-based assignments.
 */
export function isVMAvailable() {
    return !!window.VerseManager?.getAllVerseMetadata;
}

/**
 * Get all loaded characters (for assignment UI).
 * Returns array of { name, avatar, tags } objects.
 *   - tags: array of { id, name } for this character's ST tags. Used by the
 *           picker's tag filter. NOTE: tag_map is keyed on the RAW avatar
 *           (e.g. "Seraphina.png"), not a cleaned form — so we look up tags
 *           against c.avatar before cleaning it for the assignment key.
 */
export function getAvailableCharacters() {
    const allChars = getContext().characters || [];
    const tagById = new Map((stTags || []).map(t => [t.id, t]));
    return allChars
        .filter(c => c.avatar && c.name)
        .map(c => {
            const tagIds = Array.isArray(tag_map?.[c.avatar]) ? tag_map[c.avatar] : [];
            const tags = tagIds
                .map(id => tagById.get(id))
                .filter(Boolean)
                .map(t => ({ id: t.id, name: t.name }));
            return { name: c.name, avatar: cleanAvatar(c.avatar), tags };
        });
}

/**
 * Get all ST tags that are actually used by at least one character, sorted
 * for display. Used to populate the picker's tag filter. Returns
 * array of { id, name }.
 */
export function getCharacterTags() {
    const allChars = getContext().characters || [];
    const usedIds = new Set();
    for (const c of allChars) {
        const ids = Array.isArray(tag_map?.[c.avatar]) ? tag_map[c.avatar] : [];
        ids.forEach(id => usedIds.add(id));
    }
    return (stTags || [])
        .filter(t => usedIds.has(t.id))
        .sort((a, b) => {
            const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
            return so !== 0 ? so : (a.name || '').localeCompare(b.name || '');
        })
        .map(t => ({ id: t.id, name: t.name }));
}

/**
 * Get all personas (for assignment UI).
 * Returns a Promise for an array of { name, avatar, title } objects.
 *   - name  : persona display name (power_user.personas[avatar])
 *   - avatar: unique avatar filename (the stored assignment key)
 *   - title : per-persona title/description, used to disambiguate same-named
 *             personas in the picker. Falls back to first line of the
 *             description, then '' if neither is set.
 *
 * IMPORTANT: enumerates persona AVATAR FILES via getUserAvatars() rather than
 * Object.entries(power_user.personas). The personas object is keyed by avatar
 * filename, so two personas that share a display name are two separate keys —
 * BUT if the object is ever incompletely populated, or two entries collide on
 * a key, one is silently lost. Reading the avatar files from disk (the same
 * source ST's own persona UI uses) guarantees one row per persona.
 */
export async function getAvailablePersonas() {
    const descs = power_user?.persona_descriptions || {};
    let avatars = [];
    try {
        avatars = await getUserAvatars(false); // false = don't filter to current
    } catch {
        // Fallback to the personas object if the avatar API is unavailable.
        avatars = Object.keys(power_user?.personas || {});
    }

    return avatars
        .filter(Boolean)
        .map(avatar => {
            const cleaned = cleanAvatar(avatar);
            const name = power_user?.personas?.[avatar] || power_user?.personas?.[cleaned] || avatar;
            const entry = descs[avatar] || descs[cleaned] || {};
            let title = (entry.title || '').trim();
            if (!title && entry.description) {
                title = entry.description.trim().split('\n')[0].slice(0, 60);
            }
            return { name, avatar: cleaned, title };
        });
}

/**
 * Get all verses (for assignment UI, only when VM installed).
 * Returns array of { id, name } objects, or empty array if VM not available.
 */
export function getAvailableVerses() {
    const verses = getVMVerseMetadata();
    if (!verses) return [];
    return Object.entries(verses)
        .filter(([id, v]) => v.name)
        .map(([id, v]) => ({ id, name: v.name }));
}
