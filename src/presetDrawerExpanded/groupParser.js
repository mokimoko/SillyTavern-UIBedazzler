// src/presetDrawerExpanded/groupParser.js
// Pure logic for deriving visual groups from prompt-block content.
// No DOM, no ST deps: input is the ORDERED list of blocks, output is a flat,
// non-overlapping list of groups. Unit-verified (14 cases) before wiring.
//
// Rules:
//   XML  — an OUTERMOST tag pair that is UNBALANCED within a single block
//          defines a group spanning from the block with the opening tag to the
//          block with its matching close. Inner/nested tags never surface.
//          Fully-balanced tags inside one block are just content (no group).
//          Dangling open (never closed) → no group. Close-before-open → ignored.
//          Overlapping (<1><2></1></2>) → group runs <1>…</1> (first match wins).
//   MD   — a single-'#' H1 line starts a group that runs until the next H1, the
//          start of an XML group, or the end. H1s inside an XML group are ignored
//          (XML wins). '##'/'###' etc. never start a group.

const TAG_RE = /<(\/?)([A-Za-z][\w:-]*)(?:\s[^>]*?)?(\/?)>/g;
const H1_RE = /^#(?!#)[ \t]+(\S.*?)[ \t]*$/m;

/** All tags in a string, in order: {kind:'open'|'close', name}. Self-closing ignored. */
function tokenizeTags(content) {
    const out = [];
    if (!content) return out;
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(content)) !== null) {
        const isClose = m[1] === '/';
        const selfClose = m[3] === '/';
        if (selfClose) continue;
        out.push({ kind: isClose ? 'close' : 'open', name: m[2] });
    }
    return out;
}

/**
 * Tags left UNMATCHED after cancelling balanced pairs WITHIN one block, in
 * original order. Balanced inline pairs (incl. nested) cancel and drop out, so
 * incidental inline tags never define a group.
 */
export function blockLeftoverTags(content) {
    const tags = tokenizeTags(content);
    const matched = new Array(tags.length).fill(false);
    const stack = []; // indices of open tags
    for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        if (t.kind === 'open') {
            stack.push(i);
        } else {
            if (stack.length && tags[stack[stack.length - 1]].name === t.name) {
                matched[stack.pop()] = true;
                matched[i] = true;
            }
            // else: leftover close (belongs to an earlier block) — stays unmatched
        }
    }
    const leftovers = [];
    for (let i = 0; i < tags.length; i++) if (!matched[i]) leftovers.push(tags[i]);
    return leftovers;
}

/** Outermost XML groups across the ordered blocks. */
function xmlGroups(blocks) {
    const groups = [];
    const stack = []; // { name, start }
    for (let i = 0; i < blocks.length; i++) {
        const leftovers = blockLeftoverTags(blocks[i].content || '');
        for (const t of leftovers) {
            if (t.kind === 'open') {
                stack.push({ name: t.name, start: i });
            } else {
                let j = -1;
                for (let k = stack.length - 1; k >= 0; k--) {
                    if (stack[k].name === t.name) { j = k; break; }
                }
                if (j === -1) continue; // close-before-open → ignore
                if (j === 0) {
                    groups.push({ kind: 'xml', name: stack[0].name, start: stack[0].start, end: i });
                    stack.length = 0;
                } else {
                    stack.length = j;
                }
            }
        }
    }
    return groups;
}

/** True if index i falls inside any XML group span. */
function coveredByXml(i, xml) {
    return xml.some(g => i >= g.start && i <= g.end);
}

/** Markdown H1 groups filling the gaps left by XML. */
function mdGroups(blocks, xml) {
    const groups = [];
    const h1Name = (c) => { const m = (c || '').match(H1_RE); return m ? m[1] : null; };
    let i = 0;
    while (i < blocks.length) {
        if (coveredByXml(i, xml)) { i++; continue; }
        const name = h1Name(blocks[i].content);
        if (!name) { i++; continue; }
        let end = i, j = i + 1;
        while (j < blocks.length && !coveredByXml(j, xml) && !h1Name(blocks[j].content)) {
            end = j; j++;
        }
        groups.push({ kind: 'md', name, start: i, end });
        i = j;
    }
    return groups;
}

/**
 * Manual groups — USER-DEFINED starts, highest priority. A manual anchor is a
 * marker pinned to a block (by index here; by pm-identifier at the persistence
 * layer). It behaves like an H1 the user placed by hand, but wins over auto:
 *   • It CLIPS an XML group it lands inside (XML keeps [start, anchor-1]; the
 *     anchor and the rest of that XML span become the manual group). Anchoring
 *     on an XML group's first block overrides it outright.
 *   • It ABSORBS Markdown H1s (MD only fills what nothing else claimed).
 *   • It is CAPPED at the end of the XML group it sits inside (so splitting an
 *     XML group can't bleed the manual group into unrelated blocks below), and
 *     otherwise runs until the next manual anchor / next XML start / end.
 *
 * @param {Array<{index:number, name:string}>} manualAnchors  resolved anchors
 * @param {Array} origXml  XML groups derived from content (pre-clip)
 * @param {number} len  block count
 * @returns {{xml:Array, manual:Array}}  clipped XML + manual groups
 */
function manualAndClippedXml(manualAnchors, origXml, len) {
    const manualIdx = manualAnchors.map((a) => a.index);

    // Clip each XML group at the earliest manual anchor within [start, end].
    // Anchor on the group's first block → drop it (manual owns the whole span).
    const xml = [];
    for (const g of origXml) {
        let cut = -1;
        for (const m of manualIdx) { if (m >= g.start && m <= g.end) { cut = m; break; } }
        if (cut === -1) { xml.push(g); continue; }
        if (cut > g.start) xml.push({ ...g, end: cut - 1 });
    }
    const xmlStarts = xml.map((g) => g.start);

    const manual = [];
    for (let k = 0; k < manualAnchors.length; k++) {
        const start = manualAnchors[k].index;
        const nextManual = k + 1 < manualAnchors.length ? manualAnchors[k + 1].index : Infinity;
        let nextXml = Infinity;
        for (const s of xmlStarts) { if (s > start) { nextXml = s; break; } }
        const container = origXml.find((g) => start >= g.start && start <= g.end);
        const cap = container ? container.end : len - 1;
        let end = Math.min(nextManual - 1, nextXml - 1, cap, len - 1);
        if (end < start) end = start;
        manual.push({ kind: 'manual', name: manualAnchors[k].name, start, end });
    }
    return { xml, manual };
}

/**
 * @param {Array<{id?:string, content?:string}>} blocks  ordered blocks
 * @param {{manual?:Array<{index:number,name:string}>, auto?:boolean}} [opts]
 *        manual — user-defined anchors (highest priority); auto — run XML/MD
 *        content detection (default true). `computeGroups(blocks)` is unchanged.
 * @returns {Array<{kind:'xml'|'md'|'manual', name:string, start:number, end:number}>}
 *          non-overlapping groups sorted by start index
 */
export function computeGroups(blocks, opts = {}) {
    const auto = opts.auto !== false;

    // Normalize anchors: in-range integer indices, deduped (first wins), sorted.
    const seen = new Set();
    const manualAnchors = [];
    for (const a of (Array.isArray(opts.manual) ? opts.manual : [])) {
        const i = a?.index;
        if (!Number.isInteger(i) || i < 0 || i >= blocks.length || seen.has(i)) continue;
        seen.add(i);
        manualAnchors.push({ index: i, name: String(a?.name ?? '') });
    }
    manualAnchors.sort((a, b) => a.index - b.index);

    const origXml = auto ? xmlGroups(blocks) : [];
    const { xml, manual } = manualAndClippedXml(manualAnchors, origXml, blocks.length);

    // MD fills only what XML + manual left uncovered.
    const covered = [...xml, ...manual];
    const md = auto ? mdGroups(blocks, covered) : [];

    return [...xml, ...manual, ...md].sort((a, b) => a.start - b.start);
}
