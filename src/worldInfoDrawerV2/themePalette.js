// Theme-derived semantic colors for the expanded World Info drawer.

const MIN_TEXT_CONTRAST = 4.5;

function parseCssColor(value) {
    const source = String(value || '').trim();
    const hex = source.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
    if (hex) {
        let digits = hex[1];
        if (digits.length === 3) digits = digits.split('').map(char => char + char).join('');
        return {
            r: parseInt(digits.slice(0, 2), 16),
            g: parseInt(digits.slice(2, 4), 16),
            b: parseInt(digits.slice(4, 6), 16),
            a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
        };
    }

    const rgb = source.match(/^rgba?\(\s*([\d.]+)%?[,\s]+([\d.]+)%?[,\s]+([\d.]+)%?(?:\s*[,/]\s*([\d.]+)%?)?/i);
    if (!rgb) return null;

    const percentages = source.match(/^rgba?\(\s*[\d.]+%/i);
    const scale = percentages ? 2.55 : 1;
    const alphaIsPercent = rgb[4] && source.match(/[,/]\s*[\d.]+%\s*\)$/);
    return {
        r: Math.min(255, Number(rgb[1]) * scale),
        g: Math.min(255, Number(rgb[2]) * scale),
        b: Math.min(255, Number(rgb[3]) * scale),
        a: rgb[4] === undefined ? 1 : Math.min(1, Number(rgb[4]) / (alphaIsPercent ? 100 : 1)),
    };
}

function srgbToLinear(channel) {
    const normalized = channel / 255;
    return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }) {
    return (0.2126 * srgbToLinear(r))
        + (0.7152 * srgbToLinear(g))
        + (0.0722 * srgbToLinear(b));
}

function contrastRatio(a, b) {
    const lighter = Math.max(luminance(a), luminance(b));
    const darker = Math.min(luminance(a), luminance(b));
    return (lighter + 0.05) / (darker + 0.05);
}

function mixRgb(from, to, amount) {
    return {
        r: from.r + (to.r - from.r) * amount,
        g: from.g + (to.g - from.g) * amount,
        b: from.b + (to.b - from.b) * amount,
    };
}

function rgbToHsl({ r, g, b }) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    const delta = max - min;
    if (delta === 0) return { h: 0, s: 0, l: lightness };

    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    let hue;
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * (((blue - red) / delta) + 2);
    else hue = 60 * (((red - green) / delta) + 4);
    return { h: hue < 0 ? hue + 360 : hue, s: saturation, l: lightness };
}

function hslToRgb({ h, s, l }) {
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const sector = h / 60;
    const x = chroma * (1 - Math.abs((sector % 2) - 1));
    const [r1, g1, b1] = sector < 1 ? [chroma, x, 0]
        : sector < 2 ? [x, chroma, 0]
            : sector < 3 ? [0, chroma, x]
                : sector < 4 ? [0, x, chroma]
                    : sector < 5 ? [x, 0, chroma]
                        : [chroma, 0, x];
    const match = l - chroma / 2;
    return { r: (r1 + match) * 255, g: (g1 + match) * 255, b: (b1 + match) * 255 };
}

function ensureContrast(color, surface, preferredText) {
    if (contrastRatio(color, surface) >= MIN_TEXT_CONTRAST) return color;
    const fallback = luminance(surface) >= 0.3
        ? { r: 0, g: 0, b: 0 }
        : { r: 255, g: 255, b: 255 };
    const target = preferredText && contrastRatio(preferredText, surface) >= MIN_TEXT_CONTRAST
        ? preferredText
        : fallback;

    for (let amount = 0.08; amount <= 1; amount += 0.04) {
        const candidate = mixRgb(color, target, amount);
        if (contrastRatio(candidate, surface) >= MIN_TEXT_CONTRAST) return candidate;
    }
    return target;
}

function toCssRgb(color) {
    return `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`;
}

function visibleSurface(color) {
    return color.a >= 1 ? color : mixRgb({ r: 0, g: 0, b: 0 }, color, color.a);
}

export function applyWorldInfoThemePalette(root) {
    if (!root) return;
    const styles = getComputedStyle(document.documentElement);
    const quote = parseCssColor(styles.getPropertyValue('--SmartThemeQuoteColor'))
        || { r: 151, g: 167, b: 198, a: 1 };
    const surface = visibleSurface(parseCssColor(styles.getPropertyValue('--SmartThemeBlurTintColor'))
        || { r: 18, g: 18, b: 22, a: 1 });
    const body = parseCssColor(styles.getPropertyValue('--SmartThemeBodyColor'));

    const quoteHsl = rgbToHsl(quote);
    const complement = hslToRgb({
        h: (quoteHsl.h + 180) % 360,
        // A restrained complement stays harmonious instead of becoming neon.
        s: quoteHsl.s < 0.08 ? 0.12 : Math.min(0.52, Math.max(0.22, quoteHsl.s * 0.72)),
        l: quoteHsl.l,
    });
    const danger = luminance(surface) >= 0.3
        ? { r: 154, g: 48, b: 48 }
        : { r: 224, g: 108, b: 108 };

    root.style.setProperty('--wi2-accent', toCssRgb(ensureContrast(quote, surface, body)));
    root.style.setProperty('--wi2-complement', toCssRgb(ensureContrast(complement, surface, body)));
    root.style.setProperty('--wi2-danger', toCssRgb(ensureContrast(danger, surface, body)));
}
