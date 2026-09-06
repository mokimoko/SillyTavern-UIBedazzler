// src/chatDesign/cursors.js
// Custom-cursor support for Chat Design.
//
// A "cursor" style is a GLOBAL effect (like the background element type): there
// is only ever one active cursor scheme per chat, so it is NOT emitted per-.mes.
// The winning style for the current chat is resolved by cssGenerator's
// buildActiveCursorCSS() (keyed off the active character, never the persona,
// since a cursor is a whole-UI tweak) and then handed to buildCursorCSS() here.
//
// Two source modes:
//   'set' — pick a folder under user/files/cursors/ (auto-discovered via the
//           nebula-loader server plugin). Standard Windows cursor filenames
//           (Arrow, Hand, IBeam, No, SizeAll, SizeNS/WE/NESW/NWSE…) are mapped
//           to CSS cursor types and each type gets a rule. Per-type manual
//           overrides layer on top and WIN (emitted after the set's rules).
//   'url' — one cursor for EVERYTHING via `* { cursor: url(…) }`, mirroring the
//           classic hand-written custom-CSS approach.
//
// Discovery is provided by nebula-loader's GET /api/plugins/nebula-loader/
// cursors/list. It is cached in this module (populated async) and read
// synchronously at CSS-build time. When the plugin is absent or on an older
// version without the endpoint, discovery is simply "unavailable": the set
// dropdown is hidden client-side, and manual/URL input (which need no
// discovery) keep working.

import { getAllStyles, resolveStyleTargets } from './storage.js';
import { cleanAvatar } from '../design/designUtils.js';
import { getAppearanceAvatar } from './chatScope.js';
import { getAdapter } from '../hostAdapter.js';

// Plugin route for the optional .ani/.cur/.ico image processor (server host
// only). On TauriTavern discovery reports framesAvailable:false, so cursorEmitUrl
// never builds this URL and falls through to the static served path instead.
const PLUGIN_BASE = '/api/plugins/nebula-loader';

// Client-relative base under which cursor sets live. Matches the server
// plugin's CURSORS_SUBDIR ('cursors' under the user's files/ dir). Used as a
// fallback when discovery hasn't reported its own `root` yet.
const DEFAULT_ROOT = 'user/files/cursors';

// Browser-usable cursor file extensions. .ani is accepted (it shows up in
// sets) but Chromium-based clients — which SillyTavern runs in — don't animate
// .ani; those degrade to the CSS keyword fallback. .cur/.png/.svg are safe.
const ANIMATED_EXTS = ['.ani'];

// ============================================================
// Cursor type table
// ============================================================
//
// Ordered so the UI and generated CSS read top-to-bottom in a sensible order.
// `keyword`  — the CSS fallback keyword appended after the url() (used when the
//              image fails to load, e.g. an un-animatable .ani).
// `selectors`— which DOM the type applies to. `null` means "no reliable target
//              inside SillyTavern": such a type is still recognized in a set
//              (for honest coverage display) but no CSS is emitted for it.
//
// The `default` (base) type targets `*` — the custom arrow really does apply to
// everything, matching the classic `* { cursor: url() !important }` approach.
// This is safe alongside the more specific types: `a`, `input`, `.ui-resizable-*`
// etc. all have higher selector specificity than `*`, so pointer/text/resize
// win on their elements even though every rule is `!important` (specificity is
// compared before importance among equally-important declarations).

const POINTER_SELECTORS = [
    'a[href]', 'button', '.menu_button', '.right_menu_button', '[role="button"]',
    'select', 'summary', 'label[for]',
    '.fa-solid', '.fa-regular', '.fa-brands', '.fa',
    '.interactable', '.clickable', '.avatar',
    '.mes_button', '.swipe_left', '.swipe_right',
    'input[type="checkbox"]', 'input[type="radio"]', 'input[type="range"]',
    'input[type="color"]', 'input[type="file"]', 'input[type="button"]',
    'input[type="submit"]', 'input[type="reset"]',
    '.drawer-icon', '.inline-drawer-toggle', '.select2-selection',
    '.tag', '.tag_remove',
].join(', ');

const TEXT_SELECTORS = [
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"])' +
        ':not([type="color"]):not([type="file"]):not([type="button"])' +
        ':not([type="submit"]):not([type="reset"])',
    'textarea', '[contenteditable="true"]', '[contenteditable=""]', '.editable',
].join(', ');

export const CURSOR_TYPES = [
    { key: 'default',     label: 'Default (Arrow)',        keyword: 'auto',        selectors: '*' },
    { key: 'pointer',     label: 'Pointer / Link (Hand)',  keyword: 'pointer',     selectors: POINTER_SELECTORS },
    { key: 'text',        label: 'Text (I-Beam)',          keyword: 'text',        selectors: TEXT_SELECTORS },
    { key: 'not-allowed', label: 'Disabled (No)',          keyword: 'not-allowed', selectors: '[disabled], .disabled, button:disabled, .menu_button.disabled' },
    { key: 'move',        label: 'Move (SizeAll)',         keyword: 'move',        selectors: '.drag-grabber, .ui-sortable-handle, .dragAnchor, [draggable="true"]' },
    { key: 'ns-resize',   label: 'Resize vertical (SizeNS)',    keyword: 'ns-resize',   selectors: '.ui-resizable-n, .ui-resizable-s' },
    { key: 'ew-resize',   label: 'Resize horizontal (SizeWE)',  keyword: 'ew-resize',   selectors: '.ui-resizable-e, .ui-resizable-w' },
    { key: 'nwse-resize', label: 'Resize ↘ (SizeNWSE)',    keyword: 'nwse-resize', selectors: '.ui-resizable-se, .ui-resizable-nw' },
    { key: 'nesw-resize', label: 'Resize ↙ (SizeNESW)',    keyword: 'nesw-resize', selectors: '.ui-resizable-ne, .ui-resizable-sw' },
    // Recognized in sets but no dependable ST target — shown as "no target".
    { key: 'crosshair',   label: 'Crosshair (Cross)',      keyword: 'crosshair',   selectors: null },
    { key: 'wait',        label: 'Wait (Wait)',            keyword: 'wait',        selectors: null },
    { key: 'help',        label: 'Help (Help)',            keyword: 'help',        selectors: null },
    { key: 'progress',    label: 'Progress (AppStarting)', keyword: 'progress',    selectors: null },
];

const TYPE_BY_KEY = new Map(CURSOR_TYPES.map(t => [t.key, t]));

/** Types we can actually emit CSS for (have a selector). */
export const EMITTABLE_CURSOR_TYPES = CURSOR_TYPES.filter(t => t.selectors);

/**
 * Standard cursor filename → cursor type key, matched on the collapsed
 * alnum-only key (see normKey): "SizeAll.cur", "size all.cur" and "sizeall"
 * all resolve here. Names that don't hit this map fall through to the fuzzy
 * classifier below.
 */
const FILENAME_TO_TYPE = {
    arrow: 'default', default: 'default', normal: 'default',
    // "pointer" in a Windows cursor pack is the NORMAL arrow (Windows names the
    // arrow "Pointer"), so it maps to `default`; the hand is "hand"/"link".
    hand: 'pointer', pointer: 'default', link: 'pointer',
    ibeam: 'text', beam: 'text', text: 'text',
    no: 'not-allowed', unavailable: 'not-allowed', notallowed: 'not-allowed',
    sizeall: 'move', move: 'move',
    sizens: 'ns-resize', nsresize: 'ns-resize',
    sizewe: 'ew-resize', ewresize: 'ew-resize',
    sizenwse: 'nwse-resize', nwseresize: 'nwse-resize',
    sizenesw: 'nesw-resize', neswresize: 'nesw-resize',
    cross: 'crosshair', crosshair: 'crosshair', precision: 'crosshair',
    wait: 'wait', busy: 'wait', hourglass: 'wait',
    help: 'help',
    appstarting: 'progress', working: 'progress', progress: 'progress',
};

/** Collapsed lookup key for the exact map: lowercase, no extension, alnum only
 *  ("SizeNS"→"sizens", "EWResize"→"ewresize"). */
function normKey(file) {
    return String(file || '').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Word-separated form for fuzzy matching. Splits camelCase and treats any
 *  run of non-alphanumerics as a space, so "trans-hand", "thick_link1",
 *  "NWResize" and "SizeNESW" all become clean space-delimited tokens that
 *  `\b`-anchored rules can match. */
function spacedName(file) {
    return String(file || '')
        .replace(/\.[^.]+$/, '')                        // drop extension
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')         // camelCase → words
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')      // ACRONYMWord → ACRONYM Word
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Ordered fuzzy rules, applied to the space-separated name when the exact map
 * misses. First match wins, so specific patterns come first. A `null` type is
 * "recognized but deliberately unmapped" (pen, up-arrow — no CSS equivalent):
 * it stops the search without mapping.
 *
 * Approximations for the messy real-world names cursor packs use ("normal",
 * "vert", "horz", "dgn1", "NEResize", "unavaliable" typo, "trans-hand",
 * "SR-move", …) so a set usually works without renaming every file. Most atoms
 * use a leading `\b` only (tolerating trailing digits/suffixes like "link1");
 * short ambiguous atoms ("no", "alt") are fully `\b`-bounded to avoid matching
 * inside words like "normal".
 */
const CURSOR_PATTERNS = [
    // Pen / handwriting FIRST, so "hand" in "handwriting" isn't read as pointer.
    [/\bhandwrit|\bnwpen|\bpen\b|\bpencil|\bstylus/, null],
    // Up-arrow / alternate select — not the base arrow; recognized, unmapped.
    [/\balternat|\balter\b|\balt\b|\barrowup\b|\bup arrow\b|\bupdir\b/, null],
    // Text.
    [/\bibeam|\bbeam|\btext|\bcaret|\binsert|\btyping/, 'text'],
    // Link / hand → pointer (a bare "pointer" is the arrow, handled by default).
    [/\blink|\bhand|\bfinger|\bgrab|\bclickable/, 'pointer'],
    // Unavailable / no.
    [/\bunavail|\bunavali|\bunav\b|\bnotallow|\bno drop\b|\bnodrop\b|\bforbidden|\bdenied|\bblocked|\bno\b/, 'not-allowed'],
    // Diagonal resizes (before the straight ns/we rules).
    [/\bnwse\b|\bdgn ?0*1\b|\bdiag\w* ?0*1\b|\bdiagonal ?0*1\b|\bdiag down\b|\bupper ?left\b|\buperleft\b|\b(nw|se) resize\b|\bresize (nw|se)\b|\bresize ?0*1\b/, 'nwse-resize'],
    [/\bnesw\b|\bdgn ?0*2\b|\bdiag\w* ?0*2\b|\bdiagonal ?0*2\b|\bdiag up\b|\bupper ?right\b|\b(ne|sw) resize\b|\bresize (ne|sw)\b|\bresize ?0*2\b/, 'nesw-resize'],
    // Straight resizes.
    [/\bsize ?ns\b|\bns resize\b|\bvertical|\bvert\b|\bupdown\b|\bup down\b|\bnorthsouth\b/, 'ns-resize'],
    [/\bsize ?we\b|\bwe resize\b|\bhorizontal|\bhorizonta|\bhoriz|\bhorz\b|\bleftright\b|\beast/, 'ew-resize'],
    // Move.
    [/\bsizeall\b|\bsize all\b|\bmove|\ballscroll\b|\ball scroll\b|\bfleur|\bdrag/, 'move'],
    // Crosshair / precision.
    [/\bcrosshair|\bcross|\bprecision|\breticle|\baim\b/, 'crosshair'],
    // Help.
    [/\bhelp|\bquestion|\bwhatsthis\b/, 'help'],
    // Wait / busy.
    [/\bwait|\bbusy|\bhourglass|\bloading|\bspinner/, 'wait'],
    // Working / app-starting.
    [/\bappstart|\bapp starting\b|\bworking|\bstartup|\bwork\b|\bbackground|\bprogress/, 'progress'],
    // Normal / arrow / default LAST (most generic; catches bare "pointer").
    [/\barrow|\bnormal|\bdefault|\bpointer|\bstandard|\bselect|\bcursor|\bptr\b/, 'default'],
];

/**
 * Classify a cursor filename to a type key: exact standard names first, then
 * the fuzzy rules. Returns a type key, or null/undefined when the file has no
 * usable mapping (caller skips it).
 */
export function classifyCursorFile(file) {
    const key = normKey(file);
    if (key in FILENAME_TO_TYPE) return FILENAME_TO_TYPE[key];
    const s = spacedName(file);
    for (const [re, type] of CURSOR_PATTERNS) {
        if (re.test(s)) return type; // may be null → "recognized, unmapped"
    }
    return undefined;
}

/** True if a filename is an animated cursor (won't animate in Chromium). */
export function isAnimatedCursor(file) {
    const lower = String(file || '').toLowerCase();
    return ANIMATED_EXTS.some(ext => lower.endsWith(ext));
}

/**
 * Map a set's file list to { typeKey: filename } for the FIRST file that
 * resolves to each type. Non-animated files are preferred over .ani when both
 * resolve to the same type (so a set with both Wait.cur and Wait.ani picks the
 * static one).
 */
export function mapSetFiles(files) {
    const map = {};
    for (const file of files || []) {
        const type = classifyCursorFile(file);
        if (!type) continue;
        if (!(type in map)) {
            map[type] = file;
        } else if (isAnimatedCursor(map[type]) && !isAnimatedCursor(file)) {
            map[type] = file; // upgrade to the static variant
        }
    }
    return map;
}

// ============================================================
// Discovery (nebula-loader /cursors/list)
// ============================================================

const UNAVAILABLE = Object.freeze({
    available: false, loaded: true, framesAvailable: false, root: DEFAULT_ROOT, sets: [], loose: [],
});

// Start "not loaded" so the modal knows to await a first refresh.
let _discovery = { available: false, loaded: false, framesAvailable: false, root: DEFAULT_ROOT, sets: [], loose: [] };

/** Synchronous read of the last-known discovery snapshot. */
export function getCursorDiscovery() {
    return _discovery;
}

/**
 * Refresh the cursor-set catalog and cache the result. Delegates to the host
 * adapter, which resolves discovery per host:
 *   • server — GET /cursors/list (nebula-loader scans user/files/cursors/).
 *   • tauri  — reads a cursors.json manifest at /user/files/cursors/cursors.json
 *              (no server-side folder scan on TauriTavern). See docs/cursors-manifest.md.
 *   • plain  — always "unavailable" (manual/URL cursor input still works).
 * Never throws — any failure resolves to the "unavailable" snapshot.
 */
export async function refreshCursorDiscovery() {
    try {
        const adapter = await getAdapter();
        const snap = await adapter.cursorsDiscover();
        _discovery = {
            available: !!snap.available,
            loaded: true,
            framesAvailable: !!snap.framesAvailable,
            root: snap.root || DEFAULT_ROOT,
            sets: Array.isArray(snap.sets) ? snap.sets : [],
            loose: Array.isArray(snap.loose) ? snap.loose : [],
        };
    } catch {
        _discovery = { ...UNAVAILABLE };
    }
    return _discovery;
}

/** Look up a discovered set by name; null if not present. */
export function getSetByName(setName) {
    if (!setName) return null;
    return _discovery.sets.find(s => s.name === setName) || null;
}

/**
 * Build the served URL for a file inside a set:
 *   /user/files/cursors/<set>/<file>
 * The root may contain slashes (it's a fixed relative base) so it is not
 * encoded; the set and every safe relative file segment are.
 */
export function cursorFileUrl(setName, file, root = _discovery.root || DEFAULT_ROOT) {
    const encodedFile = String(file || '').split('/').map(encodeURIComponent).join('/');
    return `/${root}/${encodeURIComponent(setName)}/${encodedFile}`;
}

/**
 * The URL to actually emit in CSS for a set file. When the plugin's image
 * processor is available, .ani/.cur/.ico are routed through /cursors/img, which
 * (a) extracts a static first frame from .ani (Chromium can't animate them) and
 * (b) caps multi-resolution .cur/.ico to a single sub-image ≤ maxSize px (so a
 * 128px pack doesn't render as a giant cursor). .png/.svg/.gif — and everything
 * when the processor is absent — use the raw served path.
 */
export function cursorEmitUrl(setName, file, maxSize = 32) {
    const ext = (String(file).split('.').pop() || '').toLowerCase();
    if (_discovery.framesAvailable && ['ani', 'cur', 'ico'].includes(ext)) {
        return `${PLUGIN_BASE}/cursors/img`
            + `?set=${encodeURIComponent(setName)}`
            + `&file=${encodeURIComponent(file)}`
            + `&max=${encodeURIComponent(maxSize)}`;
    }
    return cursorFileUrl(setName, file);
}

// ============================================================
// CSS generation
// ============================================================

/** Escape a value for safe use inside url('…') in a CSS declaration. */
function escapeCursorUrl(value) {
    return String(value || '')
        .replace(/[\r\n]+/g, '')   // no line breaks
        .replace(/\\/g, '\\\\')     // escape backslashes
        .replace(/'/g, "\\'");      // escape single quotes (we quote with ')
}

/** One `cursor:` declaration: `cursor: url('…') [hx hy], <keyword> !important;` */
function cursorDecl(url, keyword, hotspot) {
    const hs = hotspot ? ` ${hotspot}` : '';
    return `cursor: url('${escapeCursorUrl(url)}')${hs}, ${keyword} !important;`;
}

/**
 * Build the complete CSS for one resolved cursor style. Reads discovery
 * synchronously for set → file mapping. Returns '' when the style produces
 * nothing visible.
 *
 * @param {object} style A Chat Design style with element==='cursor'.
 */
export function buildCursorCSS(style) {
    const p = (style && style.properties && style.properties.cursor) || {};
    const mode = p.mode === 'url' ? 'url' : 'set';

    if (mode === 'url') {
        const url = (p.url || '').trim();
        if (!url) return '';
        const hotspot = (Number(p.hotspotX) || 0) || (Number(p.hotspotY) || 0)
            ? `${Number(p.hotspotX) || 0} ${Number(p.hotspotY) || 0}`
            : '';
        // Everything gets this cursor — the classic `* { cursor }` approach.
        return `* {\n    ${cursorDecl(url, 'auto', hotspot)}\n}`;
    }

    // ── 'set' mode ── set rules first, then manual overrides (so manual wins).
    const rules = [];
    const maxSize = Number(p.maxSize) || 32;

    const set = getSetByName(p.setName);
    if (set) {
        const map = mapSetFiles(set.files);
        for (const type of EMITTABLE_CURSOR_TYPES) {
            const file = map[type.key];
            if (!file) continue;
            // .ani/.cur/.ico route through /cursors/img (static frame + size cap).
            const url = cursorEmitUrl(set.name, file, maxSize);
            rules.push(`${type.selectors} {\n    ${cursorDecl(url, type.keyword)}\n}`);
        }
    }

    const manual = p.manual || {};
    for (const type of EMITTABLE_CURSOR_TYPES) {
        const val = (manual[type.key] || '').trim();
        if (!val) continue;
        rules.push(`${type.selectors} {\n    ${cursorDecl(val, type.keyword)}\n}`);
    }

    return rules.join('\n');
}

// ============================================================
// Active-style resolution (per current chat, character-keyed)
// ============================================================
//
// Mirrors buildActiveBackgroundCSS in cssGenerator.js: exactly one cursor
// scheme wins for the current chat. Priority (highest wins):
//   3 — a style whose assignedCharacters includes the active character
//   1 — a style whose verse membership includes the active character
//   0 — a Default style
// Personas are ignored on purpose: a cursor is a whole-UI tweak, not a
// per-message one, so it keys off the character only.

/** Resolve + build the CSS for whichever cursor style applies right now. */
export function buildActiveCursorCSS(styles = getAllStyles()) {
    const cursorStyles = styles.filter(s => s.enabled !== false && s.element === 'cursor');
    if (cursorStyles.length === 0) return '';

    const activeChar = getAppearanceAvatar() || null;

    let winner = null;
    let bestScore = -1;
    for (const style of cursorStyles) {
        let score = -1;
        if (style.isDefault) {
            score = 0;
        } else if (activeChar) {
            const direct = (style.assignedCharacters || []).some(a => cleanAvatar(a) === activeChar);
            if (direct) {
                score = 3;
            } else if ((style.assignedVerses || []).length > 0) {
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
    const css = buildCursorCSS(winner);
    return css ? `/* Cursor: ${winner.name} */\n${css}` : '';
}

// Keep an eslint-friendly reference so TYPE_BY_KEY isn't flagged unused if a
// future edit drops its only consumer; it's part of the module's public shape.
export function getCursorType(key) {
    return TYPE_BY_KEY.get(key) || null;
}
