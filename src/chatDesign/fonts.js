// src/chatDesign/fonts.js
// Font catalog and dynamic loading for Chat Design
// Sources: Google Fonts + Fontshare + System

const log = (...args) => console.log('[WL ChatDesign Fonts]', ...args);

const GOOGLE_FONTS_BASE = 'https://fonts.googleapis.com/css2';
const FONTSHARE_BASE = 'https://api.fontshare.com/v2/css';

const loadedFontLinks = new Map(); // fontKey → <link> element

// ============================================================
// Font Catalog
// ============================================================

/**
 * Each font entry:
 *   name      - Display name (also used as lookup key)
 *   family    - CSS font-family value (quoted for multi-word)
 *   category  - UI grouping
 *   source    - 'google' | 'fontshare' | 'system'
 *   weights   - Available weight values
 *   fallback  - CSS fallback stack
 *   slug      - URL slug (Fontshare only)
 */
export const FONT_CATALOG = [
    // ── System / Web-Safe ──
    { name: 'Default (Theme)', family: 'inherit', category: 'system', source: 'system', weights: [400], fallback: '' },
    { name: 'Georgia', family: 'Georgia', category: 'system', source: 'system', weights: [400, 700], fallback: 'serif' },
    { name: 'Palatino', family: "'Palatino Linotype', 'Book Antiqua', Palatino", category: 'system', source: 'system', weights: [400, 700], fallback: 'serif' },
    { name: 'Garamond', family: 'Garamond', category: 'system', source: 'system', weights: [400, 700], fallback: 'serif' },
    { name: 'Consolas', family: 'Consolas', category: 'system', source: 'system', weights: [400, 700], fallback: 'monospace' },
    { name: 'Trebuchet MS', family: "'Trebuchet MS'", category: 'system', source: 'system', weights: [400, 700], fallback: 'sans-serif' },

    // ── Display / Dramatic ──
    { name: 'Cinzel', family: "'Cinzel'", category: 'display', source: 'google', weights: [400, 700, 900], fallback: 'serif' },
    { name: 'Cinzel Decorative', family: "'Cinzel Decorative'", category: 'display', source: 'google', weights: [400, 700, 900], fallback: 'serif' },
    { name: 'Playfair Display', family: "'Playfair Display'", category: 'display', source: 'google', weights: [400, 700, 900], fallback: 'serif' },
    { name: 'Abril Fatface', family: "'Abril Fatface'", category: 'display', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'Berkshire Swash', family: "'Berkshire Swash'", category: 'display', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'Righteous', family: "'Righteous'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Bungee', family: "'Bungee'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Monoton', family: "'Monoton'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Rubik Moonrocks', family: "'Rubik Moonrocks'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Orbitron', family: "'Orbitron'", category: 'display', source: 'google', weights: [400, 700, 900], fallback: 'sans-serif' },
    { name: 'Audiowide', family: "'Audiowide'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Rajdhani', family: "'Rajdhani'", category: 'display', source: 'google', weights: [400, 600, 700], fallback: 'sans-serif' },
    { name: 'Poiret One', family: "'Poiret One'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Megrim', family: "'Megrim'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Julius Sans One', family: "'Julius Sans One'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },

    // ── Fantasy / Medieval / Gothic ──
    { name: 'MedievalSharp', family: "'MedievalSharp'", category: 'fantasy', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'Almendra', family: "'Almendra'", category: 'fantasy', source: 'google', weights: [400, 700], fallback: 'serif' },
    { name: 'Pirata One', family: "'Pirata One'", category: 'fantasy', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'UnifrakturMaguntia', family: "'UnifrakturMaguntia'", category: 'fantasy', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'Caesar Dressing', family: "'Caesar Dressing'", category: 'fantasy', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'Uncial Antiqua', family: "'Uncial Antiqua'", category: 'fantasy', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'Eagle Lake', family: "'Eagle Lake'", category: 'fantasy', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'Grenze Gotisch', family: "'Grenze Gotisch'", category: 'fantasy', source: 'google', weights: [400, 700, 900], fallback: 'serif' },

    // ── Horror / Edgy ──
    { name: 'Creepster', family: "'Creepster'", category: 'horror', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Nosifer', family: "'Nosifer'", category: 'horror', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Metal Mania', family: "'Metal Mania'", category: 'horror', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Eater', family: "'Eater'", category: 'horror', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Butcherman', family: "'Butcherman'", category: 'horror', source: 'google', weights: [400], fallback: 'sans-serif' },

    // ── Retro / Pixel ──
    { name: 'Press Start 2P', family: "'Press Start 2P'", category: 'retro', source: 'google', weights: [400], fallback: 'monospace' },
    { name: 'Silkscreen', family: "'Silkscreen'", category: 'retro', source: 'google', weights: [400, 700], fallback: 'monospace' },
    { name: 'VT323', family: "'VT323'", category: 'retro', source: 'google', weights: [400], fallback: 'monospace' },
    { name: 'DotGothic16', family: "'DotGothic16'", category: 'retro', source: 'google', weights: [400], fallback: 'monospace' },

    // ── Elegant Serif ──
    { name: 'Cormorant Garamond', family: "'Cormorant Garamond'", category: 'serif', source: 'google', weights: [300, 400, 600, 700], fallback: 'serif' },
    { name: 'Spectral', family: "'Spectral'", category: 'serif', source: 'google', weights: [300, 400, 600, 700], fallback: 'serif' },
    { name: 'Lora', family: "'Lora'", category: 'serif', source: 'google', weights: [400, 600, 700], fallback: 'serif' },
    { name: 'Merriweather', family: "'Merriweather'", category: 'serif', source: 'google', weights: [300, 400, 700, 900], fallback: 'serif' },
    { name: 'Crimson Text', family: "'Crimson Text'", category: 'serif', source: 'google', weights: [400, 600, 700], fallback: 'serif' },
    { name: 'Libre Baskerville', family: "'Libre Baskerville'", category: 'serif', source: 'google', weights: [400, 700], fallback: 'serif' },
    { name: 'EB Garamond', family: "'EB Garamond'", category: 'serif', source: 'google', weights: [400, 600, 700], fallback: 'serif' },
    { name: 'Noto Serif', family: "'Noto Serif'", category: 'serif', source: 'google', weights: [400, 700], fallback: 'serif' },

    // ── Modern Sans ──
    { name: 'Inter', family: "'Inter'", category: 'sans', source: 'google', weights: [300, 400, 600, 700], fallback: 'sans-serif' },
    { name: 'Montserrat', family: "'Montserrat'", category: 'sans', source: 'google', weights: [300, 400, 600, 700, 900], fallback: 'sans-serif' },
    { name: 'Poppins', family: "'Poppins'", category: 'sans', source: 'google', weights: [300, 400, 600, 700], fallback: 'sans-serif' },
    { name: 'Raleway', family: "'Raleway'", category: 'sans', source: 'google', weights: [300, 400, 600, 700], fallback: 'sans-serif' },
    { name: 'Outfit', family: "'Outfit'", category: 'sans', source: 'google', weights: [300, 400, 600, 700], fallback: 'sans-serif' },
    { name: 'Josefin Sans', family: "'Josefin Sans'", category: 'sans', source: 'google', weights: [300, 400, 600, 700], fallback: 'sans-serif' },
    { name: 'Nunito', family: "'Nunito'", category: 'sans', source: 'google', weights: [300, 400, 600, 700], fallback: 'sans-serif' },

    // ── Handwriting / Script ──
    { name: 'Dancing Script', family: "'Dancing Script'", category: 'script', source: 'google', weights: [400, 700], fallback: 'cursive' },
    { name: 'Great Vibes', family: "'Great Vibes'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Pacifico', family: "'Pacifico'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Sacramento', family: "'Sacramento'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Caveat', family: "'Caveat'", category: 'script', source: 'google', weights: [400, 700], fallback: 'cursive' },
    { name: 'Indie Flower', family: "'Indie Flower'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Satisfy', family: "'Satisfy'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Kalam', family: "'Kalam'", category: 'script', source: 'google', weights: [300, 400, 700], fallback: 'cursive' },

    // ── Fontshare ──
    { name: 'Clash Display', family: "'Clash Display'", category: 'display', source: 'fontshare', slug: 'clash-display', weights: [400, 500, 600, 700], fallback: 'sans-serif' },
    { name: 'Cabinet Grotesk', family: "'Cabinet Grotesk'", category: 'sans', source: 'fontshare', slug: 'cabinet-grotesk', weights: [400, 500, 700, 800], fallback: 'sans-serif' },
    { name: 'Satoshi', family: "'Satoshi'", category: 'sans', source: 'fontshare', slug: 'satoshi', weights: [400, 500, 700], fallback: 'sans-serif' },
    { name: 'General Sans', family: "'General Sans'", category: 'sans', source: 'fontshare', slug: 'general-sans', weights: [400, 500, 600, 700], fallback: 'sans-serif' },
    { name: 'Boska', family: "'Boska'", category: 'display', source: 'fontshare', slug: 'boska', weights: [400, 500, 700], fallback: 'serif' },
    { name: 'Zodiak', family: "'Zodiak'", category: 'display', source: 'fontshare', slug: 'zodiak', weights: [400, 700], fallback: 'serif' },
    { name: 'Erode', family: "'Erode'", category: 'serif', source: 'fontshare', slug: 'erode', weights: [400, 600, 700], fallback: 'serif' },
    { name: 'Chillax', family: "'Chillax'", category: 'display', source: 'fontshare', slug: 'chillax', weights: [400, 600, 700], fallback: 'sans-serif' },
    { name: 'Gambetta', family: "'Gambetta'", category: 'display', source: 'fontshare', slug: 'gambetta', weights: [400, 600, 700], fallback: 'serif' },
    { name: 'Panchang', family: "'Panchang'", category: 'display', source: 'fontshare', slug: 'panchang', weights: [400, 600, 700, 800], fallback: 'sans-serif' },
    { name: 'Switzer', family: "'Switzer'", category: 'sans', source: 'fontshare', slug: 'switzer', weights: [400, 500, 600, 700], fallback: 'sans-serif' },
];

export const FONT_CATEGORIES = [
    { id: 'system', label: 'System' },
    { id: 'display', label: 'Display' },
    { id: 'fantasy', label: 'Fantasy & Gothic' },
    { id: 'horror', label: 'Horror' },
    { id: 'retro', label: 'Retro & Pixel' },
    { id: 'serif', label: 'Serif' },
    { id: 'sans', label: 'Sans-Serif' },
    { id: 'script', label: 'Script & Handwriting' },
];

// ============================================================
// Font Loading
// ============================================================

/**
 * Build Google Fonts CSS URL for a batch of font entries.
 */
function buildGoogleFontsUrl(fonts) {
    const families = fonts.map(f => {
        const weights = f.weights.join(';');
        return `family=${encodeURIComponent(f.name)}:wght@${weights}`;
    });
    return `${GOOGLE_FONTS_BASE}?${families.join('&')}&display=swap`;
}

/**
 * Build Fontshare CSS URL for a single font entry.
 */
function buildFontshareUrl(font) {
    const weights = font.weights.join(',');
    return `${FONTSHARE_BASE}?f[]=${font.slug}@${weights}&display=swap`;
}

/**
 * Load a single font by injecting a <link> into <head>.
 * No-ops if already loaded.
 */
export function loadFont(fontName) {
    if (loadedFontLinks.has(fontName)) return;

    const font = FONT_CATALOG.find(f => f.name === fontName);
    if (!font || font.source === 'system') return;

    let url;
    if (font.source === 'google') {
        url = buildGoogleFontsUrl([font]);
    } else if (font.source === 'fontshare') {
        url = buildFontshareUrl(font);
    }
    if (!url) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.id = `wl-font-${fontName.replace(/\s+/g, '-').toLowerCase()}`;
    document.head.appendChild(link);
    loadedFontLinks.set(fontName, link);
    log('Loaded font:', fontName);
}

/**
 * Load all fonts in a category (for font picker preview).
 * Batches Google Fonts into a single request for efficiency.
 */
export function loadFontCategory(categoryId) {
    const fonts = FONT_CATALOG.filter(f => f.category === categoryId && f.source !== 'system');
    if (fonts.length === 0) return;

    // Batch Google Fonts
    const googleFonts = fonts.filter(f => f.source === 'google' && !loadedFontLinks.has(f.name));
    if (googleFonts.length > 0) {
        const url = buildGoogleFontsUrl(googleFonts);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.id = `wl-fonts-cat-${categoryId}`;
        document.head.appendChild(link);
        googleFonts.forEach(f => loadedFontLinks.set(f.name, link));
    }

    // Fontshare — must be loaded individually
    const fshareFonts = fonts.filter(f => f.source === 'fontshare' && !loadedFontLinks.has(f.name));
    fshareFonts.forEach(f => loadFont(f.name));
}

/**
 * Load ALL fonts (called when font picker opens for the first time).
 */
export function loadAllFonts() {
    FONT_CATEGORIES.forEach(cat => loadFontCategory(cat.id));
}

/**
 * Load only fonts that are actively used by any style.
 * Called during CSS injection on startup / chat change.
 */
export function loadUsedFonts(styles) {
    const usedFonts = new Set();
    for (const style of styles) {
        if (style.properties.fontFamily && style.properties.fontFamily !== 'inherit' && style.properties.fontFamily !== 'Default (Theme)') {
            usedFonts.add(style.properties.fontFamily);
        }
    }
    for (const fontName of usedFonts) {
        loadFont(fontName);
    }
}

/**
 * Get a font catalog entry by display name.
 */
export function getFontByName(name) {
    return FONT_CATALOG.find(f => f.name === name) || null;
}

/**
 * Get the full CSS font-family value with fallback.
 * @param {string} fontName - Display name from the catalog
 * @returns {string} CSS font-family value (e.g. "'Cinzel', serif")
 */
export function getFontFamilyCSS(fontName) {
    const font = getFontByName(fontName);
    if (!font) return fontName;
    if (font.family === 'inherit') return 'inherit';
    return font.fallback ? `${font.family}, ${font.fallback}` : font.family;
}
