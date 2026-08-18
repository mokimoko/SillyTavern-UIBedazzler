// src/chatDesign/storage.js
// Style CRUD and assignment resolution for Chat Design
//
// Styles are stored in extension_settings.WhiteLotus.chatDesign
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

/**
 * Default property values per element type.
 * These define the full set of editable properties and their neutral/no-op values.
 */
export const ELEMENT_DEFAULTS = {
    name: {
        fontFamily: 'Default (Theme)',
        fontSize: '1em',
        fontWeight: '400',
        fontStyle: 'normal',
        textTransform: 'none',
        letterSpacing: '0px',
        textShadow: 'none',
    },
    dialogue: {
        fontFamily: 'Default (Theme)',
        fontSize: '1em',
        fontWeight: '400',
        fontStyle: 'normal',
        letterSpacing: '0px',
        lineHeight: 'normal',
    },
    banner: {
        height: 120,
        paddingTop: 150,
        bannerPosition: 25,
        bottomFadeColor: '#000000',
        bottomFadeOpacity: 0,
        borderBottomWidth: 0,
        borderBottomStyle: 'none',
        borderBottomColor: '#ffffff',
        borderBottomOpacity: 1,
        overlayColor: '#000000',
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
    },
    avatar: {
        size: 0,              // 0 = use theme default
        offsetX: 0,           // horizontal nudge in px (+ right / - left)
        offsetY: 0,           // vertical nudge in px (- up into banner / + down)
        detachFromLayout: false, // true = pull avatar out of flow so text reclaims its column
        borderWidth: 0,
        borderStyle: 'none',
        borderColor: '#ffffff',
        borderRadius: -1,     // -1 = use theme default
        shape: 'theme',       // 'theme' | 'circle' | 'square' | 'rounded' | 'rectangle'
        boxShadow: 'none',
        opacity: 1,
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
    name: 'Name',
    dialogue: 'Dialogue',
    banner: 'Banner',
    container: 'Container',
    avatar: 'Avatar',
    background: 'Background',
    cursor: 'Cursor',
};

/**
 * All element type keys.
 */
export const ELEMENT_TYPES = Object.keys(ELEMENT_DEFAULTS);

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
            overlayColor: '#0a0c1e', overlayOpacity: 0.35,
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
            overlayColor: '#4a3418', overlayOpacity: 0.3,
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
            overlayColor: '#bcd8f0', overlayOpacity: 0.12,
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
            overlayColor: '#000000', overlayOpacity: 0.42,
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
            overlayColor: '#06101f', overlayOpacity: 0.45,
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
            overlayColor: '#ffd1ec', overlayOpacity: 0.22,
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
    return settings.chatDesign;
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
