// src/chatDesign/fonts.js
// Font catalog and dynamic loading for Chat Design
// Sources: Google Fonts + Fontshare + System

const log = () => {};

const GOOGLE_FONTS_BASE = 'https://fonts.googleapis.com/css2';
const FONTSHARE_BASE = 'https://api.fontshare.com/v2/css';
export const LOCAL_FONT_PREFIX = 'local:';

const loadedFontLinks = new Map(); // fontKey → <link> element

function cleanFontName(value) {
    return String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

function escapeCSSString(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

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

    // ── Added from Bunny/Google Fonts (user picks) ──
    // Sans-Serif
    { name: 'Abel', family: "'Abel'", category: 'sans', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Advent Pro', family: "'Advent Pro'", category: 'sans', source: 'google', weights: [300, 400, 500, 700], fallback: 'sans-serif' },
    { name: 'Alumni Sans', family: "'Alumni Sans'", category: 'sans', source: 'google', weights: [400, 600, 700], fallback: 'sans-serif' },
    { name: 'Armata', family: "'Armata'", category: 'sans', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Exo', family: "'Exo'", category: 'sans', source: 'google', weights: [300, 400, 600, 700], fallback: 'sans-serif' },
    { name: 'Genos', family: "'Genos'", category: 'sans', source: 'google', weights: [400, 700], fallback: 'sans-serif' },
    { name: 'Geo', family: "'Geo'", category: 'sans', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Gidole', family: "'Gidole'", category: 'sans', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Imprima', family: "'Imprima'", category: 'sans', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Inder', family: "'Inder'", category: 'sans', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Kosugi', family: "'Kosugi'", category: 'sans', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Quicksand', family: "'Quicksand'", category: 'sans', source: 'google', weights: [300, 400, 500, 700], fallback: 'sans-serif' },
    { name: 'Savate', family: "'Savate'", category: 'sans', source: 'google', weights: [400, 600, 700], fallback: 'sans-serif' },
    { name: 'Spinnaker', family: "'Spinnaker'", category: 'sans', source: 'google', weights: [400], fallback: 'sans-serif' },

    // Serif
    { name: 'Caladea', family: "'Caladea'", category: 'serif', source: 'google', weights: [400, 700], fallback: 'serif' },
    { name: 'Cherry Swash', family: "'Cherry Swash'", category: 'serif', source: 'google', weights: [400, 700], fallback: 'serif' },
    { name: 'Diphylleia', family: "'Diphylleia'", category: 'serif', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'Imbue', family: "'Imbue'", category: 'serif', source: 'google', weights: [400, 700], fallback: 'serif' },
    { name: 'Marcellus SC', family: "'Marcellus SC'", category: 'serif', source: 'google', weights: [400], fallback: 'serif' },

    // Display
    { name: 'Asimovian', family: "'Asimovian'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Bangers', family: "'Bangers'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Barrio', family: "'Barrio'", category: 'display', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Baumans', family: "'Baumans'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Black Ops One', family: "'Black Ops One'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Diplomata', family: "'Diplomata'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Faster One', family: "'Faster One'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Frijole', family: "'Frijole'", category: 'display', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Iceland', family: "'Iceland'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Medula One', family: "'Medula One'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Monofett', family: "'Monofett'", category: 'display', source: 'google', weights: [400], fallback: 'monospace' },
    { name: 'Nabla', family: "'Nabla'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Rubik 80s Fade', family: "'Rubik 80s Fade'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Rubik Glitch', family: "'Rubik Glitch'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Rye', family: "'Rye'", category: 'display', source: 'google', weights: [400], fallback: 'serif' },
    { name: 'Sekuya', family: "'Sekuya'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Taprom', family: "'Taprom'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Tourney', family: "'Tourney'", category: 'display', source: 'google', weights: [400, 700], fallback: 'sans-serif' },
    { name: 'Trade Winds', family: "'Trade Winds'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Train One', family: "'Train One'", category: 'display', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Vast Shadow', family: "'Vast Shadow'", category: 'display', source: 'google', weights: [400], fallback: 'serif' },

    // Retro & Pixel
    { name: 'Sixtyfour', family: "'Sixtyfour'", category: 'retro', source: 'google', weights: [400], fallback: 'monospace' },

    // Script & Handwriting
    { name: 'Annie Use Your Telescope', family: "'Annie Use Your Telescope'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Beau Rivage', family: "'Beau Rivage'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Borel', family: "'Borel'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Charm', family: "'Charm'", category: 'script', source: 'google', weights: [400, 700], fallback: 'cursive' },
    { name: 'Covered By Your Grace', family: "'Covered By Your Grace'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Dr Sugiyama', family: "'Dr Sugiyama'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Finger Paint', family: "'Finger Paint'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Fleur De Leah', family: "'Fleur De Leah'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Homemade Apple', family: "'Homemade Apple'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Ma Shan Zheng', family: "'Ma Shan Zheng'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Meddon', family: "'Meddon'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Montez', family: "'Montez'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Permanent Marker', family: "'Permanent Marker'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Rock Salt', family: "'Rock Salt'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Sedgwick Ave Display', family: "'Sedgwick Ave Display'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Splash', family: "'Splash'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Walter Turncoat', family: "'Walter Turncoat'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Yeon Sung', family: "'Yeon Sung'", category: 'script', source: 'google', weights: [400], fallback: 'cursive' },

    // Cute & Playful
    { name: 'Bellota', family: "'Bellota'", category: 'cute', source: 'google', weights: [300, 400, 700], fallback: 'sans-serif' },
    { name: 'Bubblegum Sans', family: "'Bubblegum Sans'", category: 'cute', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Carter One', family: "'Carter One'", category: 'cute', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Chelsea Market', family: "'Chelsea Market'", category: 'cute', source: 'google', weights: [400], fallback: 'sans-serif' },
    { name: 'Hachi Maru Pop', family: "'Hachi Maru Pop'", category: 'cute', source: 'google', weights: [400], fallback: 'cursive' },
    { name: 'Henny Penny', family: "'Henny Penny'", category: 'cute', source: 'google', weights: [400], fallback: 'cursive' },

    // Monospace
    { name: 'Courier Prime', family: "'Courier Prime'", category: 'mono', source: 'google', weights: [400, 700], fallback: 'monospace' },
    { name: 'Fira Code', family: "'Fira Code'", category: 'mono', source: 'google', weights: [300, 400, 500, 700], fallback: 'monospace' },

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
    { id: 'cute', label: 'Cute & Playful' },
    { id: 'mono', label: 'Monospace' },
];

// ============================================================
// Font Values
// ============================================================

/**
 * Local choices carry a prefix so a local font named "Inter", for example,
 * never triggers the catalog's Google Fonts loader.
 */
export function createLocalFontValue(fontName) {
    const name = cleanFontName(fontName);
    return name ? `${LOCAL_FONT_PREFIX}${name}` : 'Default (Theme)';
}

/**
 * Older saved values are plain catalog names. Unknown plain values are treated
 * as local fonts, which also keeps hand-edited settings backward compatible.
 */
export function parseFontValue(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === 'inherit' || raw === 'Default (Theme)') {
        return { kind: 'default', name: 'Default (Theme)', value: 'Default (Theme)', font: null };
    }

    if (raw.startsWith(LOCAL_FONT_PREFIX)) {
        const name = cleanFontName(raw.slice(LOCAL_FONT_PREFIX.length));
        return name
            ? { kind: 'local', name, value: `${LOCAL_FONT_PREFIX}${name}`, font: null }
            : { kind: 'default', name: 'Default (Theme)', value: 'Default (Theme)', font: null };
    }

    const font = FONT_CATALOG.find(entry => entry.name === raw) || null;
    if (font) {
        return {
            kind: font.source === 'system' ? 'system' : 'catalog',
            name: font.name,
            value: font.name,
            font,
        };
    }

    const name = cleanFontName(raw);
    return name
        ? { kind: 'local', name, value: `${LOCAL_FONT_PREFIX}${name}`, font: null }
        : { kind: 'default', name: 'Default (Theme)', value: 'Default (Theme)', font: null };
}

export function getFontDisplayName(value) {
    return parseFontValue(value).name;
}

export function getFontSourceLabel(value) {
    const parsed = parseFontValue(value);
    if (parsed.kind === 'default') return 'Uses the active SillyTavern theme';
    if (parsed.kind === 'local') return 'Local font · Must be installed on this device';
    if (parsed.kind === 'system') return 'System font';
    return parsed.font?.source === 'fontshare' ? 'Fontshare font' : 'Google Font';
}

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
    const parsed = parseFontValue(fontName);
    if (parsed.kind !== 'catalog' || loadedFontLinks.has(parsed.value)) return;

    const font = parsed.font;
    if (!font) return;

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
    link.id = `wl-font-${font.name.replace(/\s+/g, '-').toLowerCase()}`;
    document.head.appendChild(link);
    loadedFontLinks.set(parsed.value, link);
    log('Loaded font:', font.name);
}

/**
 * Load only fonts that are actively used by any style.
 * Called during CSS injection on startup / chat change.
 */
export function loadUsedFonts(styles) {
    const usedFonts = new Set();
    for (const style of styles) {
        for (const [property, fontName] of Object.entries(style.properties || {})) {
            if (!/fontFamily$/i.test(property)) continue;
            if (fontName && fontName !== 'inherit' && fontName !== 'Default (Theme)') {
                usedFonts.add(fontName);
            }
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
    const parsed = parseFontValue(name);
    return parsed.kind === 'catalog' || parsed.kind === 'system' ? parsed.font : null;
}

/**
 * Get the full CSS font-family value with fallback.
 * @param {string} fontName - Display name from the catalog
 * @returns {string} CSS font-family value (e.g. "'Cinzel', serif")
 */
export function getFontFamilyCSS(fontName) {
    const parsed = parseFontValue(fontName);
    if (parsed.kind === 'default') return 'inherit';
    const font = parsed.font;
    if (!font) return `"${escapeCSSString(parsed.name)}", sans-serif`;
    if (font.family === 'inherit') return 'inherit';
    return font.fallback ? `${font.family}, ${font.fallback}` : font.family;
}

export function supportsLocalFontAccess() {
    return typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';
}

function collectInstalledFontFamilies(faces, families) {
    for (const face of faces) {
        const family = cleanFontName(face?.family);
        if (!family) continue;
        const key = family.toLocaleLowerCase();
        if (!families.has(key)) families.set(key, family);
    }
}

/**
 * Must be called directly from a click/keyboard action because browsers require
 * transient user activation before showing the local-font permission prompt.
 */
export async function queryInstalledFontFamilies() {
    if (!supportsLocalFontAccess()) {
        throw new Error('Installed font browsing is not supported in this browser.');
    }

    const families = new Map();
    const retryDelays = [0, 250, 750, 1750];
    for (const delay of retryDelays) {
        if (delay) await new Promise(resolve => window.setTimeout(resolve, delay));
        collectInstalledFontFamilies(await window.queryLocalFonts(), families);
        // Tauri's WebView can briefly return an empty cold-start result even
        // though permission is granted. Do not present that as a complete list.
        if (families.size > 0) break;
    }

    if (families.size === 0) {
        throw new Error('Windows did not return any installed fonts. Restart the app and try again.');
    }

    return [...families.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
