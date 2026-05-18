// src/design/designUtils.js
// Shared design utilities — color extraction, color helpers, banner upload
// Used by charDrawer/designTab, personaLore/designTab, and chatDesign modules

const log = (...args) => console.log('[WL DesignUtils]', ...args);

// ============================================================
// Color Conversion Helpers
// ============================================================

/**
 * Parse a hex color string into { r, g, b }.
 * @param {string} hex - e.g. '#4a4441' or '4a4441'
 * @returns {{ r: number, g: number, b: number }}
 */
export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 0, g: 0, b: 0 };
}

/**
 * Convert RGB values to a hex color string.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} e.g. '#4a4441'
 */
export function rgbToHex(r, g, b) {
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Parse an rgba/rgb string into { r, g, b, a }.
 * @param {string} str - e.g. 'rgba(74, 68, 65, 0.5)' or 'rgb(74, 68, 65)'
 * @returns {{ r: number, g: number, b: number, a: number } | null}
 */
export function parseRgba(str) {
    if (!str) return null;
    const match = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (!match) return null;
    return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: match[4] !== undefined ? parseFloat(match[4]) : 1,
    };
}

/**
 * Normalize a color value to hex. Handles:
 * - Already hex: '#4a4441' → '#4a4441'
 * - Legacy rgba: 'rgba(74, 68, 65, 0.25)' → '#4a4441'
 * - Null/empty → null
 * @param {string|null} val
 * @returns {string|null}
 */
export function normalizeToHex(val) {
    if (!val) return null;
    if (val.startsWith('#')) return val;
    const parsed = parseRgba(val);
    if (parsed) return rgbToHex(parsed.r, parsed.g, parsed.b);
    return null;
}

/**
 * Calculate the saturation of an [r, g, b] triplet (0–1 scale).
 * @param {number[]} rgb - [r, g, b]
 * @returns {number}
 */
function saturation([r, g, b]) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
}

// ============================================================
// Median-Cut Color Quantization
// ============================================================

/**
 * Recursive median-cut algorithm. Splits pixel arrays along the channel
 * with the widest range until the desired number of buckets is reached.
 * @param {number[][]} pixels - Array of [r, g, b] triplets
 * @param {number} depth - Number of buckets to produce
 * @returns {number[][][]} Array of pixel buckets
 */
function medianCut(pixels, depth) {
    if (depth <= 1 || pixels.length < 2) return [pixels];

    let maxRange = 0;
    let splitChannel = 0;
    for (let ch = 0; ch < 3; ch++) {
        const vals = pixels.map(px => px[ch]);
        const range = Math.max(...vals) - Math.min(...vals);
        if (range > maxRange) {
            maxRange = range;
            splitChannel = ch;
        }
    }

    pixels.sort((a, b) => a[splitChannel] - b[splitChannel]);
    const mid = Math.floor(pixels.length / 2);
    return [
        ...medianCut(pixels.slice(0, mid), depth - 1),
        ...medianCut(pixels.slice(mid), depth - 1),
    ];
}

/**
 * Extract 3 dominant colors from an image using median-cut quantization.
 * Draws the image onto a 64x64 canvas, filters extremes, and clusters into 3 buckets.
 * Returns [nameColor (hex), dialogueColor (hex), boxColor (rgba with 0.5 alpha)].
 *
 * @param {string} imgSrc - Image URL or path
 * @returns {Promise<[string, string, string]>} [nameColor, dialogueColor, boxColor]
 */
export async function extractColorsFromImage(imgSrc) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const size = 64;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas not available'));

            ctx.drawImage(img, 0, 0, size, size);
            const { data } = ctx.getImageData(0, 0, size, size);

            // Collect non-transparent, non-extreme-luminance pixels
            const pixels = [];
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                if (a < 128) continue;
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                if (lum < 15 || lum > 240) continue;
                pixels.push([r, g, b]);
            }

            if (pixels.length < 3) return reject(new Error('Not enough color data in the image'));

            // Cluster into 3 buckets, average each
            const buckets = medianCut(pixels, 3);
            const colors = buckets.map(bucket => {
                const avg = bucket.reduce(
                    (acc, px) => [acc[0] + px[0], acc[1] + px[1], acc[2] + px[2]],
                    [0, 0, 0],
                );
                return [
                    Math.round(avg[0] / bucket.length),
                    Math.round(avg[1] / bucket.length),
                    Math.round(avg[2] / bucket.length),
                ];
            });

            // Sort by saturation — most vivid color becomes name color
            colors.sort((a, b) => saturation(b) - saturation(a));

            const toHex = ([r, g, b]) => rgbToHex(r, g, b);

            const nameColor = toHex(colors[0]);
            const dialogueColor = toHex(colors[1] || colors[0]);
            const boxRgb = colors[2] || colors[1] || colors[0];
            const boxColor = `rgba(${boxRgb[0]}, ${boxRgb[1]}, ${boxRgb[2]}, 0.5)`;

            resolve([nameColor, dialogueColor, boxColor]);
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imgSrc;
    });
}

// ============================================================
// Banner Image Upload
// ============================================================

/**
 * Upload a banner image to user/images/banners/ via ST's image upload API.
 * @param {File} file - The image file to upload
 * @param {string} entityName - Character or persona name (for filename generation)
 * @returns {Promise<string>} The uploaded filename (just the filename, not the full path)
 */
export async function uploadBannerImage(file, entityName) {
    const ctx = SillyTavern.getContext();

    const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });

    const format = file.type.split('/')[1] || 'png';
    const safeName = entityName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const filename = `${safeName}_banner_${Date.now()}`;

    const headers = ctx.getRequestHeaders();

    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            image: base64,
            format,
            filename,
            ch_name: 'banners',
        }),
    });

    if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
    }

    const result = await response.json();
    const fullPath = result.path || '';
    const justFilename = fullPath.split('/').pop();

    log('Banner image uploaded:', fullPath, '→', justFilename);
    return justFilename;
}

// ============================================================
// CSS Helpers
// ============================================================

/**
 * Escape a character/persona name for use in CSS attribute selectors.
 * Handles backslashes and double-quotes.
 * @param {string} name
 * @returns {string}
 */
export function escapeCSSName(name) {
    return name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Inject a CSS string into the page via a named <style> element.
 * Creates the element if it doesn't exist; updates textContent if it does.
 * @param {string} styleId - The id for the <style> element
 * @param {string} css - CSS content
 */
export function injectStyleElement(styleId, css) {
    let el = document.getElementById(styleId);
    if (!el) {
        el = document.createElement('style');
        el.id = styleId;
        document.head.appendChild(el);
    }
    el.textContent = css;
}

/**
 * Clear the content of a named <style> element (removes all injected CSS without removing the element).
 * @param {string} styleId
 */
export function clearStyleElement(styleId) {
    const el = document.getElementById(styleId);
    if (el) el.textContent = '';
}

// ============================================================
// Avatar Helpers
// ============================================================

/**
 * Normalize an avatar filename — strip path prefixes, decode URI components.
 * Used by chatDesign, charDrawer, personaLore for consistent avatar key matching.
 * @param {string} avatar - Raw avatar string (may include path or encoding)
 * @returns {string} Cleaned filename
 */
export function cleanAvatar(avatar) {
    if (!avatar) return '';
    const name = avatar.split('/').pop().split('\\').pop();
    try { return decodeURIComponent(name); } catch { return name; }
}
