// Text-tag validation, scoped CSS compilation, and display-only DOM conversion.

const RESERVED_TAGS = new Set(('a abbr acronym address applet area article aside audio b base basefont bdi bdo bgsound big blink blockquote body br button canvas caption center cite code col colgroup command content data datalist dd del details dfn dialog dir div dl dt em embed fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe image img input ins isindex kbd keygen label legend li link listing main map mark marquee menu meta meter nav nobr noembed noframes noscript object ol optgroup option output p param picture plaintext pre progress q rb rp rt rtc ruby s samp script search section select shadow slot small source spacer span strike strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track tt u ul var video wbr xmp svg math custom-style').split(' '));
const cache = new Map();
const TARGET = '__BDZ_TEXT_TAG__';
export const MAX_TEXT_TAGS = 24;

export function textTagError(tag) {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(String(tag || ''))) return 'Use a lowercase name starting with a letter, followed by letters, numbers, or hyphens.';
    if (RESERVED_TAGS.has(tag) || tag.startsWith('xml')) return 'Choose a custom name instead of a built-in HTML tag.';
    return '';
}

export function getTextTags(style, { includeDisabled = false } = {}) {
    const entries = style?.properties?.textTags;
    const seen = new Set();
    return Array.isArray(entries) ? entries.slice(0, MAX_TEXT_TAGS).filter(entry => {
        if (!entry || (!includeDisabled && entry.enabled === false) || textTagError(entry.tag) || seen.has(entry.tag)) return false;
        seen.add(entry.tag);
        return true;
    }) : [];
}

export function textTagClass(tag) {
    return `bdz-text-${tag}`;
}

function namespace(value) {
    let hash = 2166136261;
    for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return `bdz-tag-${(hash >>> 0).toString(36)}`;
}

/** Parse in a detached stylesheet; never insert pasted selectors into the page. */
export function compileTextTagCss(entry, styleId = '') {
    const source = String(entry.css || '').trim().slice(0, 16000).replace(/^<style>\s*([\s\S]*?)\s*<\/style>$/i, '$1');
    const key = `${styleId}\0${entry.tag}\0${source}`;
    if (cache.has(key)) return cache.get(key);
    let result;
    try {
        const sheet = new CSSStyleSheet();
        // Plain declarations and complete copied snippets share one editor.
        const firstAtRule = source.indexOf('@');
        const leading = firstAtRule < 0 ? source : source.slice(0, firstAtRule);
        const mixedDeclarations = firstAtRule >= 0 && !leading.includes('{') && /[\w-]+\s*:/.test(leading);
        sheet.replaceSync(mixedDeclarations ? `${TARGET} { ${leading} }\n${source.slice(firstAtRule)}`
            : source.includes('{') ? source : `${TARGET} { ${source} }`);
        const names = new Map();
        const prefix = namespace(`${styleId}:${entry.tag}`);
        const collect = rules => {
            for (const rule of rules) {
                if (rule.type === 7 && /^[a-z_][\w-]*$/i.test(rule.name)) names.set(rule.name, `${prefix}-${rule.name}`);
                else if (rule.type === 4) collect(rule.cssRules);
            }
        };
        collect(sheet.cssRules);
        const declarations = (style, frames = false) => {
            const values = [];
            for (let index = 0; index < style.length; index++) {
                const property = style.item(index);
                let value = style.getPropertyValue(property).trim();
                if (!value || /\b(?:url|image-set|-webkit-image-set|expression)\s*\(/i.test(value)
                    || ['behavior', '-moz-binding'].includes(property)) continue;
                if (property === 'animation' || property === 'animation-name') {
                    value = value.replace(/[a-z_][\w-]*/gi, token => names.get(token) || token);
                }
                const priority = !frames && style.getPropertyPriority(property) ? ' !important' : '';
                values.push(`${property}: ${value}${priority};`);
            }
            return values.join('\n');
        };
        let ignored = false;
        const render = rules => Array.from(rules, rule => {
            if (rule.type === 1) {
                const css = declarations(rule.style);
                return css ? `${TARGET} { ${css} }` : '';
            }
            if (rule.type === 7 && names.has(rule.name)) {
                const frames = Array.from(rule.cssRules, frame => `${frame.keyText} { ${declarations(frame.style, true)} }`).join('\n');
                return `@keyframes ${names.get(rule.name)} { ${frames} }`;
            }
            if (rule.type === 4) return `@media ${rule.conditionText} { ${render(rule.cssRules)} }`;
            ignored = true;
            return '';
        }).filter(Boolean).join('\n');
        const css = render(sheet.cssRules);
        result = { css, warning: ignored ? 'Only style rules, @keyframes, and @media are supported.'
            : source && !css ? 'No valid styling found. Check the CSS syntax.' : '' };
    } catch (error) {
        result = { css: '', warning: `Could not read this CSS: ${error.message}` };
    }
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
}

export function buildTextTagsCSS(style, selector) {
    const rules = [];
    for (const entry of getTextTags(style)) {
        // ST prefixes message classes with custom- during sanitization.
        const className = textTagClass(entry.tag);
        const target = `${selector} .mes_text :is(.${className}, .custom-${className})`;
        const { css } = compileTextTagCss(entry, style.id);
        rules.push(`${target} { display: inline-block; }`);
        if (css) rules.push(css.replaceAll(TARGET, target));
        rules.push(`@media (prefers-reduced-motion: reduce) { ${target} { animation: none !important; } }`);
    }
    return rules.join('\n');
}

/** Called on the sanitizer's root before it traverses or removes unknown tags. */
export function replaceTextTagElements(root, selector) {
    if (!selector) return;
    for (const element of root.querySelectorAll(selector)) {
        if (element.closest('pre, code, script, style, textarea, custom-style')) continue;
        const span = element.ownerDocument.createElement('span');
        span.className = textTagClass(element.localName);
        // Only children are retained; original attributes still cannot bypass
        // the host's sanitizer. Nested tags remain available in the snapshot.
        while (element.firstChild) span.appendChild(element.firstChild);
        element.replaceWith(span);
    }
}
