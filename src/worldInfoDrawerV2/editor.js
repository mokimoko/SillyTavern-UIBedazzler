// src/worldInfoDrawerV2/editor.js
// WI v2 editor pane — the sentence view. Port of the mock's renderEditor /
// sentenceHTML / placementLineHTML / diagramHTML / mechHTML / wireEditor
// (wi-v2-mockup.html ~1474-1786, ~1786-2065, ~2437-2760) with the mock's
// in-memory entry swapped for the open note's REAL ST entry (listcol's
// getSelectedEntry → the live loadWorldInfo reference) and every mutation
// routed through editorData's writers → listData's debounced save (§9.31).
//
// Mock invariants carried over:
//  - The sentence is a VIEW of the raw fields, not a cage (§6): the
//    mechanics grid below writes the SAME entry, and both re-render.
//  - Switching mode never touches the topic list; the sentence just stops
//    showing topics when they play no part.
//  - A condition is singular: ST stores ONE keysecondary + ONE logic value.
//  - Templates reset template-owned fields completely, then preset; the
//    writer's words (title, content, topics, conditions, rank…) survive.
//  - §9.5: "By meaning" says vector storage is off rather than silently
//    behaving like keyword.
//
// DELIBERATE divergences from the mock (each an honesty upgrade, §9.33):
//  - .ed-content and .ed-title write live (mock left content unwired —
//    known wonk; a real editor that can't edit content isn't one).
//  - Timing numbers / chance are editable inputs, and their ✕ removes are
//    wired (the mock's were painted).
//  - Cast filter is LIVE (picker poured 2026-07-18): "+ by card"/"+ by tag"
//    open a real character/tag picker over ST's roster; polarity, per-chip
//    removal, and grid editing are live too.
//  - The subject picker is LIVE (§9.4 sidecar poured 2026-07-18): the
//    "filed under" button opens a picker over the sidecar store, the same
//    seam listcol's subjectOf now reads. Writes go to subjectStore, not ST.
//  - "+ join another pool" and "+ new outlet…" prompt for a name (the mock
//    hardcoded demo pools/outlets).
//  - Popover close-on-click-away is ONE persistent document handler, not a
//    fresh document listener per render (the mock leaked one per repaint).

import {
    onSelectedNoteChanged, getSelectedEntry, refreshListcol,
    deleteNote, duplicateNote, openNoteTransferPicker,
} from './listcol.js';
import { refreshTopbar } from './topbar.js';
import {
    getSubject, setSubject, subjectsInBook, DEFAULT_SUBJECT, onSubjectsChanged,
    getType,
} from './subjectStore.js';
import {
    viewOf, modeOf, rankPosition, outletsOf, vectorsOn, globalScanDepth,
    tokenEstimate, openBookName, bookEntries,
    NUM_LOGIC, LOGIC_NUM, POS_NUM, SOURCE_KEYS,
    setTitle, setContent, setType, setMode,
    setClause, clearClause,
    addTopic, renameTopic, removeTopic,
    addTerm, renameTerm, removeTerm,
    setSticky, setCooldown, setDelay, seedTiming, clearTiming,
    setPlacement, setDepth, setRole, setOutlet,
    setRank, setFits, seedChance, setChance, clearChance,
    setCastExclude, clearCastPart, clearCast,
    seedCast, addCastName, addCastTag, removeCastName, removeCastTag,
    castRoster, castNameLabel, castTagLabel,
    seedScan, setScanDepth, flipScan, clearScan,
    addSource, removeSource, clearSources,
    seedRecursion, setExcludeRecursion, setPreventRecursion,
    setDelayRecursion, setDelayLevel, clearRecursion,
    GENERATION_TRIGGERS, seedTriggers, addTrigger, removeTrigger, clearTriggers,
    setAutomationId, clearAutomationId,
    joinPool, leavePool, clearPools, toggleAltOverride, toggleAltScoring, setAltWeight,
    TYPES, applyTemplate, applyMechEdit, promptPopup,
} from './editorData.js';

const log = () => {};

const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ============================================================
// State — UI-only; the note itself lives in listData's book object
// ============================================================

let root = null;          // #wl-wi2-editorPane while open
let showMech = false;     // mechanics grid flip (session-lifetime, mock's)
let autoOpenUid = null;   // uid whose empty automation clause was just added
                          // (ST entries default automationId:'' — presence
                          // can't be `!= null` like the mock's, so a fresh
                          // empty clause is held open by this flag instead)
let castOpenUid = null;   // uid whose cast filter was just seeded empty via
                          // the add-menu/template. ST ships an inert default
                          // characterFilter on many entries, so "object
                          // exists" can't mean "show the line" — an explicit
                          // seed is held open by this flag until a pick lands
                          // (which makes the filter meaningful on its own).
let recOpenUid = null;    // uid whose recursion clause is held open. All three
                          // ST switches (exclude/prevent/delayUntil) can be off
                          // at once — viewOf then reports recursion:null — but
                          // once the user adds the clause we keep it visible so
                          // toggling the last switch off doesn't collapse the
                          // whole line out from under them. Cleared only by the
                          // explicit ✕ remove, note change, or editor reset.

// ============================================================
// Vocabulary — the mock's writer-facing words, verbatim
// ============================================================

const MODE_GLYPH = { always: '\u25c9', topic: '\u25cf', meaning: '\u223c', shelved: '\u25cb' };
const MODE_WORD = {
    always: 'always',
    topic: 'when its topics come up',
    meaning: 'when it feels relevant (by meaning)',
    shelved: 'never \u2014 shelved',
};
const MODE_ENG = { always: 'constant', topic: 'keyword', meaning: 'vectorized', shelved: 'disabled' };
const MODE_HINT = {
    always:  'Core canon, never forgotten. It costs its room every single reply.',
    topic:   'The usual choice. It comes up when the scene mentions one of its topics.',
    meaning: 'Matched by meaning rather than exact words \u2014 no topic list needed.',
    shelved: 'Kept in the lorebook, never included. Nothing else about it changes.',
};
const CLAUSE_WORD = { any: 'and at least one of', all: 'and all of', notall: 'unless ALL of these appear', notany: 'but never if any of' };
const CLAUSE_ENG  = { any: 'AND ANY', all: 'AND ALL', notall: 'NOT ALL', notany: 'NOT ANY' };
const SOURCE_WORD = {
    matchPersonaDescription:    'your persona\u2019s description',
    matchCharacterDescription:  'the character\u2019s description',
    matchCharacterPersonality:  'the character\u2019s personality',
    matchCharacterDepthPrompt:  'the character\u2019s depth prompt',
    matchScenario:              'the scenario',
    matchCreatorNotes:          'the creator\u2019s notes',
};
// Writer-facing labels for the six generation-type triggers (ST's raw enum
// values → friendly words). An empty selection means "fires on every type".
const TRIGGER_WORD = {
    normal:      'normal replies',
    continue:    'continues',
    impersonate: 'impersonations',
    swipe:       'swipes',
    regenerate:  'regenerations',
    quiet:       'background prompts',
};
const PLACEMENTS = {
    charBefore: 'just before the character\u2019s info',
    charAfter:  'just after the character\u2019s info',
    emBefore:   'just before the example messages',
    emAfter:    'just after the example messages',
    anBefore:   'just before the Author\u2019s Note',
    anAfter:    'just after the Author\u2019s Note',
    depth:      'into the conversation itself',
    outlet:     'nowhere \u2014 held for an outlet',
};
const PLACE_ENG = {
    charBefore: 'position 0 \u00b7 before \u00b7 \u2191Char',
    charAfter:  'position 1 \u00b7 after \u00b7 \u2193Char',
    emBefore:   'position 5 \u00b7 EMTop \u00b7 \u2191EM',
    emAfter:    'position 6 \u00b7 EMBottom \u00b7 \u2193EM',
    anBefore:   'position 2 \u00b7 ANTop \u00b7 \u2191AT',
    anAfter:    'position 3 \u00b7 ANBottom \u00b7 \u2193AT',
    depth:      'position 4 \u00b7 atDepth',
    outlet:     'position 7 \u00b7 outlet',
};
const ANCHORS = [
    { id: 'char',  label: 'The character\u2019s info', sub: 'description, personality, scenario', eng: 'char defs' },
    { id: 'em',    label: 'The example messages',   sub: 'sample dialogue block',              eng: 'EM' },
    { id: 'an',    label: 'The Author\u2019s Note',  sub: 'your standing note',                 eng: 'AN' },
    { id: 'depth', label: 'Into the conversation',  sub: 'slots in among the messages, with a voice', eng: 'atDepth' },
    { id: 'outlet',label: 'Held for an outlet',     sub: 'you place it yourself with a macro',  eng: 'outlet' },
];
const ROLES = { 0: 'as a system message', 1: 'in the user\u2019s voice', 2: 'in the character\u2019s voice' };
const ROLE_ENG = { 0: 'role 0 \u00b7 system', 1: 'role 1 \u00b7 user', 2: 'role 2 \u00b7 assistant' };

function anchorOf(p) {
    if (p === 'depth' || p === 'outlet') return p;
    return p.startsWith('char') ? 'char' : p.startsWith('em') ? 'em' : 'an';
}
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

function chipList(terms, cls) {
    return terms.map(t => `<span class="wl-wi2-chip ${cls || ''}">${esc(t)}</span>`).join(' ');
}

// Editable chips for the sentence's word lists (topics = primary keys,
// terms = a condition's secondary keys). Each chip renames in place on click
// and removes on its ✕; a trailing inline input commits a new chip on Enter
// (or comma), so several can be typed in a row without a dialog. `group` is
// 'topic' | 'term' and rides on the data attributes the wiring reads back.
// The '…' placeholder (a fresh condition's seed) renders muted so it reads as
// "fill me in", not a real word.
function editChips(terms, group, cls) {
    const chips = terms.map(t => {
        const placeholder = t === '\u2026';
        return `<span class="wl-wi2-chip wl-wi2-chip-edit ${cls || ''} ${placeholder ? 'wl-wi2-chip-ph' : ''}"
            data-chip="${group}" data-val="${esc(t)}" tabindex="0"
            title="Click to rename \u00b7 \u2715 to remove">${esc(t)}<button class="wl-wi2-chip-x"
            data-chiprm="${group}" data-val="${esc(t)}" title="Remove">\u2715</button></span>`;
    }).join(' ');
    const hint = group === 'topic' ? 'add a topic\u2026' : 'add a word\u2026';
    const input = `<input class="wl-wi2-chip-input" data-chipadd="${group}" type="text"
        placeholder="${hint}" title="Type and press Enter to add \u00b7 comma also adds"
        autocomplete="off" spellcheck="false">`;
    return chips + ' ' + input;
}

// ============================================================
// Sentence view — the mock's sentenceHTML, reading the projection `v`
// (viewOf) instead of the mock entry. All classes carry the wl-wi2- prefix.
// ============================================================

function modePopHTML(v) {
    // §9.5: when vector storage is off, "By meaning" says so rather than
    // silently behaving like keyword. It stays visible and stays selectable
    // if the note ALREADY uses it.
    const von = vectorsOn();
    const opts = Object.keys(MODE_WORD).map(k => {
        const dead = k === 'meaning' && !von && v.mode !== 'meaning';
        const warn = k === 'meaning' && !von
            ? `<span class="wl-wi2-mode-warn"> \u2014 needs vector storage, currently off</span>` : '';
        return `<button class="wl-wi2-mode-opt ${k === v.mode ? 'cur' : ''} ${dead ? 'off' : ''}" data-mode="${k}">
            <span class="wl-wi2-mode-g ${k}">${MODE_GLYPH[k]}</span>
            <span>${MODE_WORD[k]}${warn}<small>${MODE_HINT[k]}<span class="wl-wi2-eng"> \u00b7 ${MODE_ENG[k]}</span></small></span>
        </button>`;
    }).join('');
    return `<div class="wl-wi2-mode-pop" id="wl-wi2-modePop">${opts}</div>`;
}

function sentenceHTML(v) {
    const lines = [];
    lines.push(`<div class="wl-wi2-s-line"><b>Include this note</b>
        <button class="wl-wi2-slot mode" id="wl-wi2-modeBtn" data-popopen="wl-wi2-modePop">${MODE_WORD[v.mode]}<span class="wl-wi2-eng">${MODE_ENG[v.mode]}</span></button>
        ${v.mode === 'topic' ? 'topics: ' + editChips(v.topics, 'topic') + '<span class="wl-wi2-eng">key</span>' : ''}
        ${v.mode === 'meaning' && !vectorsOn() ? '<span class="wl-wi2-mode-warn">\u2014 vector storage is off, so this note never comes up</span>' : ''}
        ${modePopHTML(v)}</div>`);

    for (const c of v.clauses) {
        const neg = (c.kind === 'notany' || c.kind === 'notall') ? 'neg' : '';
        lines.push(`<div class="wl-wi2-s-line">\u2026<button class="wl-wi2-slot" data-swap="kind">${CLAUSE_WORD[c.kind]}<span class="wl-wi2-eng">${CLAUSE_ENG[c.kind]}</span></button>:
            ${editChips(c.terms, 'term', neg)}<span class="wl-wi2-eng">keysecondary</span><button class="wl-wi2-s-remove" data-condrm="1" title="Remove condition (clears secondary keys)">\u2715 remove</button></div>`);
    }
    if (v.timing) {
        const t = [];
        const num = (field, val) => `<input class="wl-wi2-slot-input" type="number" min="0" value="${val}" data-timing="${field}" style="width: ${Math.max(4, String(val).length + 2)}ch">`;
        if (v.timing.waits) t.push(`it waits until message ${num('delay', v.timing.waits)}<span class="wl-wi2-eng">delay</span>`);
        if (v.timing.lingers) t.push(`once shown, it lingers ${num('sticky', v.timing.lingers)} messages<span class="wl-wi2-eng">sticky</span>`);
        if (v.timing.rests) t.push(`then rests ${num('cooldown', v.timing.rests)}<span class="wl-wi2-eng">cooldown</span>`);
        const adds = [];
        if (!v.timing.waits) adds.push(`<button class="wl-wi2-slot mini" data-timingadd="delay">+ waits</button>`);
        if (!v.timing.lingers) adds.push(`<button class="wl-wi2-slot mini" data-timingadd="sticky">+ lingers</button>`);
        if (!v.timing.rests) adds.push(`<button class="wl-wi2-slot mini" data-timingadd="cooldown">+ rests</button>`);
        const both = v.timing.lingers && v.timing.rests
            ? ` <span class="wl-wi2-s-caveat">Its rest is paused while it lingers.</span>` : '';
        lines.push(`<div class="wl-wi2-s-line"><b>Timing:</b> ${t.join(', ')}.${both} ${adds.join(' ')}<button class="wl-wi2-s-remove" data-timingrm="1">\u2715 remove</button></div>`);
    }
    // Cast shows when the filter is meaningful (v.cast) OR when it was just
    // seeded empty this session (castOpenUid) — the latter renders as the
    // empty pick-a-cast prompt, so the line is never conjured by ST's inert
    // default filter, only by real data or an explicit add.
    const castHeld = !v.cast && castOpenUid === String(v.uid);
    const cast = v.cast || (castHeld ? { exclude: false, names: [], tags: [] } : null);
    if (cast) {
        // ENGINE TRUTH (~4735): names and tags are two independent if-blocks
        // sharing ONE isExclude flag — both must pass when both are set. The
        // stored values are avatar-stems (names) and tag-ids (tags); we show
        // the friendly labels but each chip carries its raw value for removal.
        const verb = cast.exclude ? 'Never' : 'Only';
        const hasNames = cast.names.length > 0;
        const hasTags = cast.tags.length > 0;
        // A per-chip ✕ removes just that entry (the inverse of the one-at-a-
        // time picker adds); the group can still be cleared wholesale below.
        const nameChips = cast.names.map(val =>
            `<span class="wl-wi2-chip cast" title="${esc(val)}">${esc(castNameLabel(val))}<button class="wl-wi2-chip-x" data-castnamerm="${esc(val)}" title="Remove this character">\u2715</button></span>`).join(' ');
        const tagChips = cast.tags.map(id =>
            `<span class="wl-wi2-chip cast" title="tag ${esc(id)}">${esc(castTagLabel(id))}<button class="wl-wi2-chip-x" data-casttagrm="${esc(id)}" title="Remove this tag">\u2715</button></span>`).join(' ');
        // Filled parts read as clauses joined by "and" (their real engine
        // meaning: names AND tags both constrain). A part with chips ends in
        // a small "+ …" to add another; a still-empty part is just its opener.
        const filled = [];
        if (hasNames) filled.push(`when playing ${nameChips} <button class="wl-wi2-slot mini" data-castadd="names">+ card</button>`);
        if (hasTags) filled.push(`for characters tagged ${tagChips} <button class="wl-wi2-slot mini" data-castadd="tags">+ tag</button>`);
        // Openers for whichever parts are still empty — offered plainly, not
        // stitched in with "and" (there's nothing yet for them to join).
        const openers = [];
        if (!hasNames) openers.push(`<button class="wl-wi2-slot mini" data-castadd="names">+ by card</button>`);
        if (!hasTags) openers.push(`<button class="wl-wi2-slot mini" data-castadd="tags">+ by tag</button>`);
        const caveat = hasNames && hasTags
            ? ` <span class="wl-wi2-s-caveat">Both must pass.</span>` : '';
        // Empty seeded filter (no parts yet): a gentle lead-in before the openers.
        const body = filled.length
            ? filled.join(' <b>and</b> ') + (openers.length ? ' ' + openers.join(' ') : '')
            : `<span class="wl-wi2-s-caveat">a cast you pick:</span> ${openers.join(' ')}`;
        lines.push(`<div class="wl-wi2-s-line"><b><button class="wl-wi2-slot" data-cycle="castpol">${verb}</button></b> ${body}<span class="wl-wi2-eng">characterFilter</span>${caveat}
            <button class="wl-wi2-s-remove" data-castrm="all" title="Remove the whole cast filter">\u2715 remove</button></div>`);
    }
    // ── Matching (§handoff 2a): per-entry scan overrides. Inherit IS the
    // absence — a null sub-field simply isn't in the clause (audit §18).
    if (v.scan) {
        const bits = [];
        if (v.scan.depth != null)
            bits.push(`listen back <input class="wl-wi2-slot-input" type="number" min="0" max="1000" value="${v.scan.depth}" data-edit="scandepth" style="width: ${Math.max(4, String(v.scan.depth).length + 2)}ch"> messages<span class="wl-wi2-eng">scanDepth</span>`);
        if (v.scan.wholeWords != null)
            bits.push(`<button class="wl-wi2-slot" data-scanflip="wholeWords">${v.scan.wholeWords ? 'matching whole words' : 'matching partial words too'}</button><span class="wl-wi2-eng">matchWholeWords</span>`);
        if (v.scan.caseSensitive != null)
            bits.push(`<button class="wl-wi2-slot" data-scanflip="caseSensitive">${v.scan.caseSensitive ? 'case-sensitive' : 'ignoring case'}</button><span class="wl-wi2-eng">caseSensitive</span>`);
        if (bits.length) {
            const adds = [];
            if (v.scan.depth == null)         adds.push(`<button class="wl-wi2-slot mini" data-scanadd="depth">+ depth</button>`);
            if (v.scan.wholeWords == null)    adds.push(`<button class="wl-wi2-slot mini" data-scanadd="wholeWords">+ whole words</button>`);
            if (v.scan.caseSensitive == null) adds.push(`<button class="wl-wi2-slot mini" data-scanadd="caseSensitive">+ case</button>`);
            lines.push(`<div class="wl-wi2-s-line"><b>For this note,</b> ${bits.join(', ')} ${adds.join(' ')}
                <button class="wl-wi2-s-remove" data-scanrm="all" title="Back to the global listening settings">\u2715 remove</button></div>`);
        }
    }
    if (v.alsoRead && v.alsoRead.length) {
        const srcChips = v.alsoRead.map(k =>
            `<span class="wl-wi2-chip cast" title="${esc(k)}">${SOURCE_WORD[k]}<button class="wl-wi2-chip-x" data-srcrm="${k}" title="Stop reading against this">\u2715</button></span>`).join(' ');
        const canAdd = SOURCE_KEYS.some(k => !v.alsoRead.includes(k));
        const addBtn = canAdd ? `<button class="wl-wi2-slot mini" data-srcadd="1">+ add source</button>` : '';
        lines.push(`<div class="wl-wi2-s-line"><b>Also read</b> its topics against: ${srcChips} ${addBtn}<span class="wl-wi2-eng">match\u2026</span>
            <button class="wl-wi2-s-remove" data-srcrm="all" title="Read against the scene only">\u2715 remove</button></div>`);
    }
    // Recursion (excludeRecursion · preventRecursion · delayUntilRecursion).
    // ST models three independent switches around the recursion pass; the
    // clause shows them together with plain-language toggles. delay carries an
    // optional level input (blank = level 1).
    // Recursion shows when any switch is on (v.recursion) OR when the clause
    // was explicitly added this session and is being held open (recOpenUid) —
    // the latter renders with all toggles in their off state so flipping the
    // last switch off doesn't make the whole line vanish.
    const recHeld = !v.recursion && recOpenUid === String(v.uid);
    const rec = v.recursion || (recHeld ? { exclude: false, prevent: false, delay: false, delayLevel: null } : null);
    if (rec) {
        const r = rec;
        const bits = [];
        bits.push(`it <button class="wl-wi2-slot" data-recflip="exclude">${r.exclude ? 'can\u2019t be pulled in by other notes' : 'can be pulled in by other notes'}</button><span class="wl-wi2-eng">excludeRecursion</span>`);
        bits.push(`and once included it <button class="wl-wi2-slot" data-recflip="prevent">${r.prevent ? 'won\u2019t pull in others' : 'can pull in others'}</button><span class="wl-wi2-eng">preventRecursion</span>`);
        // Delay: a toggle plus, when on, an editable level.
        if (r.delay) {
            bits.push(`and it\u2019s <button class="wl-wi2-slot" data-recflip="delay">held until recursion</button> level <input class="wl-wi2-slot-input" type="number" min="1" max="99" value="${r.delayLevel ?? 1}" data-reclevel="1" style="width: ${Math.max(4, String(r.delayLevel ?? 1).length + 2)}ch"><span class="wl-wi2-eng">delayUntilRecursion</span>`);
        } else {
            bits.push(`and it\u2019s <button class="wl-wi2-slot" data-recflip="delay">included on the first pass</button><span class="wl-wi2-eng">delayUntilRecursion</span>`);
        }
        lines.push(`<div class="wl-wi2-s-line"><b>Recursion:</b> ${bits.join(', ')}.
            <button class="wl-wi2-s-remove" data-recrm="1" title="Back to default recursion behavior">\u2715 remove</button></div>`);
    }
    // Generation-type triggers. A non-empty list RESTRICTS the note to only
    // those generation types; empty = every type (so the line only shows when
    // restricted). Chips remove one type; the add picker offers the rest.
    if (v.triggers && v.triggers.length) {
        const trgChips = v.triggers.map(t =>
            `<span class="wl-wi2-chip cast" title="${esc(t)}">${TRIGGER_WORD[t] || esc(t)}<button class="wl-wi2-chip-x" data-trgrm="${esc(t)}" title="Stop restricting to this type">\u2715</button></span>`).join(' ');
        const canAdd = GENERATION_TRIGGERS.some(t => !v.triggers.includes(t));
        const addBtn = canAdd ? `<button class="wl-wi2-slot mini" data-trgadd="1">+ add type</button>` : '';
        lines.push(`<div class="wl-wi2-s-line"><b>Only on</b> ${trgChips} ${addBtn}<span class="wl-wi2-eng">triggers</span>
            <button class="wl-wi2-s-remove" data-trgrm="all" title="Fire on every generation type">\u2715 remove</button></div>`);
    }
    if (String(v.automationId).trim() !== '' || autoOpenUid === String(v.uid)) {
        lines.push(`<div class="wl-wi2-s-line"><b>Runs automation</b>
            <input class="wl-wi2-slot-input" type="text" value="${esc(v.automationId)}" data-edit="automationid"
                placeholder="quick-reply id" style="width: 16ch; text-align: left;">
            <span class="wl-wi2-s-caveat">when this note is included.</span><span class="wl-wi2-eng">automationId</span>
            <button class="wl-wi2-s-remove" data-autorm="1" title="Remove the automation hook">\u2715 remove</button></div>`);
    }
    if (v.chance < 100 || v.useProbability === false) {
        const stickyNote = v.timing?.lingers
            ? ` It rolls <b>once</b> \u2014 while it lingers, the roll is skipped.` : '';
        lines.push(`<div class="wl-wi2-s-line"><b>When triggered,</b> it appears <input class="wl-wi2-slot-input" type="number" min="0" max="100" value="${v.chance}" data-edit="chance" style="width: ${Math.max(4, String(v.chance).length + 2)}ch">% of the time.<span class="wl-wi2-eng">probability</span>${stickyNote}<button class="wl-wi2-s-remove" data-chancerm="1">\u2715 remove</button></div>`);
    }
    if (v.alts) {
        // ENGINE (~5303, ~5333): comma-split multi-membership; weight IS
        // raffle tickets (cumulative-weight roll), not a percent.
        const a = v.alts;
        const groupChips = a.groups.map(g => `<span class="wl-wi2-chip alt">${esc(g)}<button class="wl-wi2-chip-x" data-altrm="${esc(g)}" title="Leave this pool">\u2715</button></span>`).join(' ');
        lines.push(`<div class="wl-wi2-s-line"><b>Takes turns:</b> when this note and others in ${groupChips} come up on the same reply, only one is shown.
            <button class="wl-wi2-slot mini" data-altadd="1">+ join another pool</button><span class="wl-wi2-eng">group</span>
            <button class="wl-wi2-s-remove" data-altrm="all">\u2715 remove</button></div>`);
        const winner = a.override
            ? `<button class="wl-wi2-slot" data-alttoggle="override">always this one</button><span class="wl-wi2-eng">groupOverride</span>.
               <span class="wl-wi2-s-caveat">Higher rank wins if two are set this way.</span>`
            : `<button class="wl-wi2-slot" data-alttoggle="override">drawn by tickets</button><span class="wl-wi2-eng">groupWeight</span>
               \u2014 this note holds <input class="wl-wi2-slot-input" type="number" min="0" step="10" value="${a.weight}" data-edit="altweight" style="width: ${Math.max(4, String(a.weight).length + 2)}ch">.
               <span class="wl-wi2-s-caveat">Twice another note\u2019s tickets = shown twice as often.</span>`;
        lines.push(`<div class="wl-wi2-s-line s-sub">The winner is ${winner}</div>`);
        lines.push(`<div class="wl-wi2-s-line s-sub">Weak matches <button class="wl-wi2-slot" data-alttoggle="scoring">${a.scoring ? 'sit out' : 'join the draw'}</button>.<span class="wl-wi2-eng">useGroupScoring</span></div>`);
    }
    // Rank. ENGINE, VERIFIED (~4973): an ignoreBudget entry never tests the
    // budget — its content still consumes room, pushing overflow earlier for
    // everything after it; (~4930) post-overflow, normal entries are skipped
    // only while ignoreBudget entries remain ahead.
    const entry = getSelectedEntry();
    const rp = entry ? rankPosition(entry) : null;
    const rankInput = `<input class="wl-wi2-slot-input" type="number" step="1" value="${v.rank}" data-edit="rank"
        style="width: ${Math.max(4, String(v.rank).length + 2)}ch">`;
    const posNote = rp
        ? ` \u2014 read <b>${rp.tied ? 'tied ' : ''}${ord(rp.pos)}</b> of ${rp.total} notes` : '';
    const fitsLine = v.alwaysFits
        ? `When the notes' share is full, this note is <button class="wl-wi2-slot" data-fits="0">still included</button><span class="wl-wi2-eng">ignoreBudget</span>
           \u2014 <span class="wl-wi2-s-caveat">it takes its room from the notes below it.</span>`
        : `When the notes' share is full, this note is <button class="wl-wi2-slot" data-fits="1">skipped</button><span class="wl-wi2-eng">ignoreBudget</span>.`;
    lines.push(`<div class="wl-wi2-s-line"><b>Rank:</b> ${rankInput}<span class="wl-wi2-eng">order</span>${posNote}. ${fitsLine}</div>`);
    lines.push(placementLineHTML(v));
    return lines.join('');
}

// ============================================================
// Placement line + the two-step picker (opens upward)
// ============================================================

function placementLineHTML(v) {
    const a = anchorOf(v.placement);
    let tail = '';
    if (a === 'depth') {
        tail = ` \u2014 <input class="wl-wi2-slot-input" type="number" min="0" max="999" value="${v.depth}" data-edit="depth"> messages from the end<span class="wl-wi2-eng">depth \u00b7 default 4</span>,
            <button class="wl-wi2-slot" data-cycle="role">${ROLES[v.role ?? 0]}<span class="wl-wi2-eng">${ROLE_ENG[v.role ?? 0]}</span></button>`;
    } else if (a === 'outlet') {
        tail = v.outlet
            ? ` \u2014 collected under <span class="wl-wi2-chip out">{{outlet::${esc(v.outlet)}}}</span><span class="wl-wi2-eng">outletName</span>`
            : ` \u2014 <span class="wl-wi2-mode-warn">no outlet name yet \u2014 the note would be silently skipped</span><span class="wl-wi2-eng">outletName</span>`;
    }
    return `<div class="wl-wi2-s-line"><b>Placement:</b>
        <button class="wl-wi2-slot" id="wl-wi2-placeBtn" data-popopen="wl-wi2-placePop">${PLACEMENTS[v.placement]}<span class="wl-wi2-eng">${PLACE_ENG[v.placement]}</span></button>${tail}
        ${diagramHTML(v)}</div>`;
}

function diagramHTML(v) {
    const cur = anchorOf(v.placement);
    const anchors = ANCHORS.map(a => `
        <button class="wl-wi2-pp-anchor ${a.id === cur ? 'on' : ''}" data-anchor="${a.id}">
            <span class="wl-wi2-pp-a-label">${a.label}<span class="wl-wi2-eng">${a.eng}</span></span>
            <span class="wl-wi2-pp-a-sub">${a.sub}</span>
        </button>`).join('');

    let step2 = '';
    if (cur === 'depth') {
        // The ladder is a picture of RELATIVE POSITION, not a census of the
        // chat. Fixed 7-row budget; the middle ELIDES above it (the mock's
        // own fix — depth 50 must not draw 52 rows). Anatomy read off the
        // verified render: the mark sits BELOW message -d.
        const d = v.depth ?? 4;
        const rows = [];
        const msg = (i) => `<div class="wl-wi2-pp-msg${i === 0 ? ' wl-wi2-pp-latest' : ''}">${i === 0 ? 'the newest message' : 'message \u2212' + i}</div>`;
        const here = `<div class="wl-wi2-pp-here">\u25c0 this note lands here <span class="wl-wi2-pp-d">depth ${d}</span></div>`;
        const LEAD = 2, TAIL = 3;
        if (d <= TAIL + 1) {
            for (let i = d + LEAD - 1; i >= d; i--) rows.push(msg(i));
            rows.push(here);
            for (let i = d - 1; i >= 0; i--) rows.push(msg(i));
        } else {
            rows.push(msg(d + 1), msg(d));
            rows.push(here);
            rows.push(msg(d - 1));
            const hidden = d - 3;
            rows.push(`<div class="wl-wi2-pp-elide">\u22ef ${hidden} more message${hidden === 1 ? '' : 's'} \u22ef</div>`);
            rows.push(msg(1), msg(0));
        }
        step2 = `<div class="wl-wi2-pp-step2">
            <div class="wl-wi2-pp-s2-label">How deep, and in whose voice?</div>
            <div class="wl-wi2-pp-depth-viz">${rows.join('')}</div>
            <div class="wl-wi2-pp-roles">
                ${Object.entries(ROLES).map(([k, w]) => `<button class="wl-wi2-pp-role ${Number(k) === (v.role ?? 0) ? 'on' : ''}" data-role="${k}">${w}<span class="wl-wi2-eng">${ROLE_ENG[k]}</span></button>`).join('')}
            </div>
        </div>`;
    } else if (cur === 'outlet') {
        // REAL outlets: derived from the open book's position-7 entries, not
        // the mock's demo list. The unnamed group ('') renders as a warning
        // count rather than an outlet you could pick.
        const outlets = outletsOf();
        const named = [...outlets.entries()].filter(([name]) => name);
        const chips = named.map(([name, n]) => `
            <button class="wl-wi2-pp-out ${name === v.outlet ? 'on' : ''}" data-out="${esc(name)}">${esc(name)} <span class="wl-wi2-pp-out-n">${n} note${n === 1 ? '' : 's'}</span></button>`).join('');
        const macroName = v.outlet || (named[0]?.[0] ?? 'name');
        const macroCount = v.outlet ? (outlets.get(v.outlet) || 0) : 0;
        step2 = `<div class="wl-wi2-pp-step2">
            <div class="wl-wi2-pp-s2-label">Which outlet?</div>
            <div class="wl-wi2-pp-outlet-note">Outlet notes are <b>never inserted automatically</b>. Everything sharing an outlet is collected together, and you drop the whole batch wherever you like with the macro \u2014 usually in your prompt or preset.</div>
            <div class="wl-wi2-pp-outlets">
                ${chips}
                <button class="wl-wi2-pp-out wl-wi2-pp-out-new" data-outnew="1">+ new outlet\u2026</button>
            </div>
            <div class="wl-wi2-pp-macro">Paste where you want them: <code>{{outlet::${esc(macroName)}}}</code> <span class="wl-wi2-pp-macro-hint">\u2014 emits ${v.outlet ? `all ${macroCount} note${macroCount === 1 ? '' : 's'}` : 'its notes'}, in rank order</span></div>
        </div>`;
    } else {
        const label = cur === 'char' ? 'the character\u2019s info' : cur === 'em' ? 'the example messages' : 'the Author\u2019s Note';
        const beforeId = cur + 'Before', afterId = cur + 'After';
        step2 = `<div class="wl-wi2-pp-step2">
            <div class="wl-wi2-pp-s2-label">Before it, or after it?</div>
            <div class="wl-wi2-pp-ba">
                <button class="wl-wi2-pp-ba-slot ${v.placement === beforeId ? 'on' : ''}" data-place="${beforeId}">just before<span class="wl-wi2-eng">${PLACE_ENG[beforeId]}</span></button>
                <div class="wl-wi2-pp-ba-block">${label}</div>
                <button class="wl-wi2-pp-ba-slot ${v.placement === afterId ? 'on' : ''}" data-place="${afterId}">just after<span class="wl-wi2-eng">${PLACE_ENG[afterId]}</span></button>
            </div>
        </div>`;
    }

    return `<div class="wl-wi2-placement-pop" id="wl-wi2-placePop">
        <div class="wl-wi2-pp-inner">
            <div class="wl-wi2-pp-step1"><div class="wl-wi2-pp-s1-label">Anchor it to\u2026</div>${anchors}</div>
            ${step2}
        </div>
    </div>`;
}

// ============================================================
// Mechanics grid — EDITABLE, TWO-WAY (§handoff 2b). Grid keys ARE ST field
// names; every write goes through editorData.applyMechEdit onto the SAME
// live entry the sentence reads. characterFilter's names/tags edit as flat
// comma lists (an honesty upgrade on the mock's read-only row — the mock
// had no live path to them at all; here the grid IS the cast-edit path
// until the real picker lands).
// ============================================================

function triBool(k, val) {
    const cur = val == null ? 'null' : String(val);
    return `<select class="wl-wi2-mech-sel" data-mech="${k}">
        <option value="null" ${cur === 'null' ? 'selected' : ''}>null \u2014 inherit</option>
        <option value="true" ${cur === 'true' ? 'selected' : ''}>true</option>
        <option value="false" ${cur === 'false' ? 'selected' : ''}>false</option>
    </select>`;
}

function mechHTML(e, v) {
    const rows = [];
    const esc2 = s => esc(String(s));
    const txt = (k, val, w) => `<input class="wl-wi2-mech-in" data-mech="${k}" value="${esc2(val)}" style="width:${w || 22}ch">`;
    const num = (k, val, w) => `<input class="wl-wi2-mech-in" data-mech="${k}" type="number" value="${val}" style="width:${w || 7}ch">`;
    const bool = (k, val) => `<label class="wl-wi2-mech-bool"><input type="checkbox" class="wl-wi2-mech-cb" data-mech="${k}" ${val ? 'checked' : ''}> ${val}</label>`;
    const ro = (val) => `<span class="wl-wi2-mech-ro">${esc2(val)}</span>`;
    const add = (k, val) => rows.push(`<span class="k">${k}</span><span class="v">${val}</span>`);

    add('comment', txt('comment', v.title, 26));
    add('key', txt('key', v.topics.join(', '), 26));
    add('keysecondary', txt('keysecondary', v.clauses[0] ? v.clauses[0].terms.join(', ') : '', 26));
    add('selectiveLogic', v.clauses[0]
        ? `${num('selectiveLogic', LOGIC_NUM[v.clauses[0].kind], 4)} <span class="wl-wi2-mech-hint">${CLAUSE_ENG[v.clauses[0].kind]}</span>`
        : ro('0 (AND_ANY, unused \u2014 no keysecondary)'));
    add('state', `<select class="wl-wi2-mech-sel" data-mech="mode">
        ${['topic', 'always', 'meaning', 'shelved'].map(m => `<option value="${m}" ${v.mode === m ? 'selected' : ''}>${m} \u00b7 ${MODE_ENG[m]}</option>`).join('')}
    </select>`);
    add('order', num('order', v.rank, 7));
    add('position', `${num('position', POS_NUM[v.placement], 4)} <span class="wl-wi2-mech-hint">${v.placement}</span>`);
    if (v.placement === 'depth') { add('depth', num('depth', v.depth ?? 4, 5)); add('role', num('role', v.role ?? 0, 4)); }
    if (v.placement === 'outlet') add('outletName', `${txt('outletName', v.outlet || '', 18)} ${v.outlet ? '' : '<span class="wl-wi2-mech-hint wl-wi2-sp-danger">EMPTY \u2014 note would be silently skipped</span>'}`);
    add('probability', num('probability', v.chance, 5));
    add('useProbability', bool('useProbability', v.useProbability === true || (v.useProbability == null && true)));
    add('sticky', num('sticky', v.timing?.lingers ?? 0, 5));
    add('cooldown', num('cooldown', v.timing?.rests ?? 0, 5));
    add('delay', num('delay', v.timing?.waits ?? 0, 5));
    add('scanDepth', `${txt('scanDepth', v.scan?.depth ?? '', 5)} <span class="wl-wi2-mech-hint">${v.scan?.depth == null ? 'null \u2014 inherit' : ''}</span>`);
    add('caseSensitive', triBool('caseSensitive', v.scan?.caseSensitive ?? null));
    add('matchWholeWords', triBool('matchWholeWords', v.scan?.wholeWords ?? null));
    for (const k of SOURCE_KEYS) add(k, bool(k, !!(v.alsoRead && v.alsoRead.includes(k))));
    // characterFilter — flat comma lists + the shared polarity, the grid's
    // live path to the cast filter until the sentence gets a real picker.
    const cf = e.characterFilter;
    add('characterFilter.names', txt('cfNames', cf?.names?.join(', ') ?? '', 24));
    add('characterFilter.tags', txt('cfTags', cf?.tags?.join(', ') ?? '', 24));
    add('characterFilter.isExclude', cf ? bool('cfExclude', !!cf.isExclude) : ro('null (no filter)'));
    add('group', txt('group', v.alts ? v.alts.groups.join(', ') : '', 20));
    add('groupWeight', num('groupWeight', v.alts ? v.alts.weight : (e.groupWeight ?? 100), 6));
    add('groupOverride', bool('groupOverride', v.alts ? v.alts.override : !!e.groupOverride));
    add('useGroupScoring', triBool('useGroupScoring', e.useGroupScoring ?? null));
    add('ignoreBudget', bool('ignoreBudget', v.alwaysFits));
    add('excludeRecursion', bool('excludeRecursion', !!e.excludeRecursion));
    add('preventRecursion', bool('preventRecursion', !!e.preventRecursion));
    // delayUntilRecursion is ST's tri-state (false | true | number>=2). Shown
    // raw as text so all three states are reachable: '', 'true', or a number.
    add('delayUntilRecursion', `${txt('delayUntilRecursion', e.delayUntilRecursion === true ? 'true' : (e.delayUntilRecursion || ''), 8)} <span class="wl-wi2-mech-hint">false / true / level#</span>`);
    add('triggers', `${txt('triggers', Array.isArray(e.triggers) ? e.triggers.join(', ') : '', 24)} <span class="wl-wi2-mech-hint">${Array.isArray(e.triggers) && e.triggers.length ? '' : 'empty \u2014 all types'}</span>`);
    add('automationId', txt('automationId', v.automationId || '', 18));

    return `<div class="wl-wi2-mech-grid">
        <span class="wl-wi2-mech-caveat">These are the raw saved fields, and editing them here writes straight to the note \u2014 the sentence above re-reads from them. Raw edits win: a few fields (placement, conditions, timing) are a compressed view of a longer clause, so an odd raw value can reach a state the sentence can\u2019t fully phrase back.</span>
        ${rows.join('')}
    </div>`;
}

// ============================================================
// The pane — mock's renderEditor over the REAL selected entry
// ============================================================

function render() {
    if (!root) return;
    const e = getSelectedEntry();
    // A book can be empty (or its last note deleted, or nothing open at
    // all). The empty state is real, not hypothetical.
    if (!e) {
        const name = openBookName();
        root.innerHTML = `<div class="wl-wi2-edhead"><div class="wl-wi2-ed-sub">${name
            ? `${esc(name)} \u2014 no notes yet. Use <b>+ New</b> to write one.`
            : 'No book open \u2014 pick one in the rail.'}</div></div>`;
        return;
    }
    const v = viewOf(e);
    // Subject is v2-only sidecar metadata, not an ST field — read it straight
    // from the store here rather than through viewOf (which stays a pure ST
    // projection). openBookName()+uid is the store's key.
    const subj = getSubject(openBookName(), e.uid);
    // Type is sidecar metadata too (noteTypes section), read directly like the
    // subject — viewOf no longer carries it (it stays a pure ST projection).
    const noteType = getType(openBookName(), e.uid);
    root.innerHTML = `
        <div class="wl-wi2-edhead">
            <div class="wl-wi2-idrow">
                <input class="wl-wi2-type-chip" id="wl-wi2-typeChip" value="${esc(noteType)}" placeholder="+ type" spellcheck="false"
                    size="${Math.max(6, noteType.length + 2)}"
                    title="What kind of note this is \u2014 your word, free to rename. Applying a template stamps its name here; nothing else ever changes it.">
                <span class="wl-wi2-id-sep">filed under</span>
                <span class="wl-wi2-subj-wrap">
                    <button class="wl-wi2-subj-pick" id="wl-wi2-subjBtn"
                        title="Where this note is filed in the list \u2014 a v2 grouping, kept in UI Bedazzler\u2019s own file (it doesn\u2019t travel with an exported lorebook).">${esc(subj)}<span class="wl-wi2-subj-caret">\u25be</span></button>
                </span>
                <span class="wl-wi2-ed-actions">
                    <button class="wl-wi2-iconbtn" id="wl-wi2-noteMove" title="Move or copy this note to another book" aria-label="Move or copy this note"><i class="fa-solid fa-right-left"></i></button>
                    <button class="wl-wi2-iconbtn" id="wl-wi2-noteDup" title="Duplicate this note" aria-label="Duplicate this note"><i class="fa-solid fa-clone"></i></button>
                    <button class="wl-wi2-iconbtn wl-wi2-iconbtn-danger" id="wl-wi2-noteDel" title="Delete this note" aria-label="Delete this note"><i class="fa-solid fa-trash"></i></button>
                </span>
            </div>
            <input class="wl-wi2-ed-title" value="${esc(v.title)}" placeholder="Untitled note">
            <div class="wl-wi2-ed-sub">~${tokenEstimate(v.content)} tokens \u00b7 uid ${esc(v.uid)} \u00b7 ${esc(openBookName() ?? '')}</div>
        </div>
        <div class="wl-wi2-ed-body">
            <textarea class="wl-wi2-ed-content">${esc(v.content)}</textarea>
            <div class="wl-wi2-sentence-card">${sentenceHTML(v)}
                <div class="wl-wi2-addrow">
                    <div class="wl-wi2-addmenu" id="wl-wi2-addMenu">
                        <div class="wl-wi2-addmenu-label">Condition <span class="wl-wi2-addmenu-sub">(one per note)</span></div>
                        <button data-add="any" data-cond="1">\u2026and at least one of \u2026<small>a second word list that must also match \u00b7 AND ANY</small></button>
                        <button data-add="all" data-cond="1">\u2026and all of \u2026<small>every word in the second list must match \u00b7 AND ALL</small></button>
                        <button data-add="notany" data-cond="1">\u2026but never if any of \u2026<small>any of these words vetoes it \u00b7 NOT ANY</small></button>
                        <button data-add="notall" data-cond="1">\u2026unless ALL of these appear<small>only vetoed when every word is present \u00b7 NOT ALL</small></button>
                        <div class="wl-wi2-addmenu-label">Behavior</div>
                        <button data-add="timing">Timing<small>waits \u00b7 lingers \u00b7 rests</small></button>
                        <button data-add="cast">Cast filter<small>only / never \u2014 by character card, by tag, or both</small></button>
                        <button data-add="chance">Chance<small>appears N% of the time when triggered</small></button>
                        <button data-add="alts">Takes turns<small>when several notes in a pool come up at once, only one is shown \u00b7 inclusion group</small></button>
                        <button data-add="automation">Runs automation<small>fire a Quick Reply / STscript when this note is included \u00b7 automationId</small></button>
                        <button data-add="recursion">Recursion<small>whether it can be pulled in by / pull in other notes, or wait for a recursion pass \u00b7 excludeRecursion / preventRecursion / delayUntilRecursion</small></button>
                        <button data-add="triggers">Only on certain generations<small>restrict to normal / continue / impersonate / swipe / regenerate / quiet \u00b7 triggers</small></button>
                        <div class="wl-wi2-addmenu-label">Matching <span class="wl-wi2-addmenu-sub">(how this note looks for its topics)</span></div>
                        <button data-add="scan">Listen differently<small>for this note only: how far back, whole words, case \u00b7 scanDepth / matchWholeWords / caseSensitive</small></button>
                        <button data-add="alsoRead">Also read beyond the scene<small>check topics against the persona, character, scenario\u2026 as well \u00b7 match*</small></button>
                    </div>
                    <div class="wl-wi2-addmenu wl-wi2-typemenu" id="wl-wi2-typeMenu">
                        <div class="wl-wi2-addmenu-label">Apply a template <span class="wl-wi2-addmenu-sub">(a starting point, not a category \u2014 it resets the control fields and stamps the chip; your words, conditions, and rank stay)</span></div>
                        ${Object.entries(TYPES).map(([t, d]) => `<button data-type="${esc(t)}" ${t === noteType ? 'class="cur"' : ''}>${esc(t)}<small>${d.hint}</small></button>`).join('')}
                    </div>
                    <button class="wl-wi2-addbtn" id="wl-wi2-addClause" data-popopen="wl-wi2-addMenu">+ add a condition or behavior</button>
                    <button class="wl-wi2-addbtn" id="wl-wi2-typeBtn" data-popopen="wl-wi2-typeMenu">\u2726 apply a template</button>
                </div>
            </div>
            ${showMech ? mechHTML(e, v) : ''}
            <button class="wl-wi2-mech-flip" id="wl-wi2-mechBtn">\u2699 ${showMech ? 'hide mechanics' : 'view mechanics (raw fields)'}</button>
        </div>`;
    wireEditor();
}

/** Re-render + tell the list its rows may have changed. */
function rerender({ list = false, refocus = null } = {}) {
    render();
    if (list) refreshListcol();
    // refocus: after a full repaint the old node is gone, so restore the
    // caret to the fresh chip-input for that group (keeps the type-Enter-
    // type-Enter flow going without re-clicking). Caret to end.
    if (refocus && root) {
        const inp = root.querySelector(`.wl-wi2-chip-input[data-chipadd="${refocus}"]`);
        if (inp) { inp.focus(); const n = inp.value.length; inp.setSelectionRange(n, n); }
    }
}

// ============================================================
// Wiring — per-render listeners live on pane elements (they die with the
// innerHTML); the ONLY document-level handler is the persistent popover
// closer registered once in initEditor (the mock re-registered one per
// render, which leaks). Openers and popover bodies stopPropagation; any
// click that bubbles to document closes every open popover in the pane.
// ============================================================

function closeAllPops() {
    if (!root) return;
    root.querySelectorAll('.wl-wi2-mode-pop.open, .wl-wi2-placement-pop.open, .wl-wi2-addmenu.open')
        .forEach(p => p.classList.remove('open'));
    root.querySelector('#wl-wi2-srcPick')?.remove();
    root.querySelector('#wl-wi2-castPick')?.remove();
    root.querySelector('#wl-wi2-subjPick')?.remove();
}

function docClick() { closeAllPops(); }

// Decide whether an opened popover should grow UP or DOWN from its trigger,
// based on the room available in the editor's scroll viewport — so a pop near
// the top edge doesn't clip off the top (the old always-upward placement pop),
// and a pop near the bottom doesn't leave dead space or clip below.
//
// The pop is already .open (measurable) when this runs. We add one of two
// marker classes the CSS anchors on (wl-wi2-pop-up / -down), overriding each
// pop's default direction only when the default side lacks room. We also cap
// the pop's height to the chosen side's available space via a CSS var, so the
// rare too-tall case scrolls inside the pop instead of overflowing the pane.
const POP_MARGIN = 10;   // breathing room from the viewport edge
function flipPopIntoView(trigger, pop) {
    // The scroll viewport the pop must stay inside: the editor pane if we're in
    // one, else the window. getBoundingClientRect on the pane gives its visible
    // box even when its content scrolls.
    const pane = pop.closest('.wl-wi2-editor');
    const view = pane
        ? pane.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
    const tr = trigger.getBoundingClientRect();
    const spaceBelow = view.bottom - tr.bottom - POP_MARGIN;
    const spaceAbove = tr.top - view.top - POP_MARGIN;

    // The pop's natural height. It's display:block/flex now; scrollHeight is the
    // content height regardless of any max-height we've previously set.
    const popH = pop.scrollHeight;

    // Which default does THIS pop have? Placement and the add/template menus
    // open UP; the mode picker opens DOWN. We only flip away from the default
    // when the default side can't fit and the other side has strictly more room.
    const defaultUp = pop.classList.contains('wl-wi2-placement-pop')
        || pop.classList.contains('wl-wi2-addmenu');
    let up;
    if (defaultUp) {
        up = !(spaceAbove < popH && spaceBelow > spaceAbove);
    } else {
        up = (spaceBelow < popH && spaceAbove > spaceBelow);
    }

    pop.classList.toggle('wl-wi2-pop-up', up);
    pop.classList.toggle('wl-wi2-pop-down', !up);
    // Cap to the chosen side so an over-tall pop scrolls internally rather than
    // spilling past the pane edge. Floor at a usable minimum so we never cap it
    // to a sliver.
    const avail = Math.max(120, Math.floor(up ? spaceAbove : spaceBelow));
    pop.style.setProperty('--wl-wi2-pop-maxh', avail + 'px');
}


function wireEditor() {
    const e = getSelectedEntry();
    if (!e) return;
    const $ = sel => root.querySelector(sel);
    const $$ = sel => root.querySelectorAll(sel);

    // ── Popover openers (mode / placement / add / template) ──
    $$('[data-popopen]').forEach(btn => btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const pop = $('#' + btn.dataset.popopen);
        if (!pop) return;
        const wasOpen = pop.classList.contains('open');
        closeAllPops();
        if (!wasOpen) { pop.classList.add('open'); flipPopIntoView(btn, pop); }
    }));
    // Popover bodies swallow clicks so they don't self-close; controls
    // inside them still fire their own handlers first.
    $$('.wl-wi2-mode-pop, .wl-wi2-placement-pop, .wl-wi2-addmenu').forEach(p =>
        p.addEventListener('click', ev => ev.stopPropagation()));

    // The placement two-step stays open across a step's rerender. Reopening
    // must re-run the flip against the (rebuilt) trigger — otherwise the fresh
    // pop falls back to its CSS default direction and can clip near an edge.
    const reopenPlacePop = () => {
        const pop = $('#wl-wi2-placePop');
        const btn = $('#wl-wi2-placeBtn');
        if (!pop) return;
        pop.classList.add('open');
        if (btn) flipPopIntoView(btn, pop);
    };

    // ── Identity row + prose ──
    const typeChip = $('#wl-wi2-typeChip');
    if (typeChip) typeChip.addEventListener('change', () => {
        setType(e, typeChip.value.trim());   // renaming is free: no fields move
        rerender();                          // refresh chip width + menu's cur marker
    });

    // ── Subject picker (§9.4 sidecar) — a downward popover over the store ──
    // Canonical subjects are always offered; customs already used in this book
    // surface too (reuse without retyping); a free-text field mints a new one.
    // Picking writes subjectStore and refreshes both panes (the list regroups).
    const subjBtn = $('#wl-wi2-subjBtn');
    if (subjBtn) subjBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        $('#wl-wi2-subjPick')?.remove();
        const book = openBookName();
        const current = getSubject(book, e.uid);
        // Canonical first (mirrors listcol's SUBJECTS), then any custom in use.
        const CANON = ['General', 'Characters', 'Places', 'Factions', 'Events', 'Secrets', 'Rules', 'Flavor'];
        const inUse = subjectsInBook(book);
        const options = [...CANON, ...inUse.filter(s => !CANON.includes(s))];

        const pop = document.createElement('div');
        pop.className = 'wl-wi2-subj-pop wl-wi2-subjpick open';
        pop.id = 'wl-wi2-subjPick';
        pop.style.cssText = 'position:absolute; z-index:40; margin-top:4px;';
        const optHTML = options.map(s =>
            `<button class="wl-wi2-subj-opt${s === current ? ' cur' : ''}" data-subjopt="${esc(s)}">${esc(s)}${
                s === current ? '<span class="wl-wi2-subj-cur">\u2713</span>' : ''}</button>`).join('');
        pop.innerHTML = `<div class="wl-wi2-subjpick-list">${optHTML}</div>
            <div class="wl-wi2-subjpick-new">
                <input class="wl-wi2-subjpick-input" type="text" placeholder="new subject\u2026" autocomplete="off" spellcheck="false" maxlength="40">
            </div>`;

        const commit = (subject) => {
            const s = String(subject ?? '').trim();
            if (!s) return;
            setSubject(book, e.uid, s);      // 'General' is stored as absence by the store
            pop.remove();
            rerender();                      // editor head repaints; list regroups via onSubjectsChanged
            refreshListcol();
        };

        pop.addEventListener('click', (pv) => {
            pv.stopPropagation();
            const opt = pv.target.closest('[data-subjopt]');
            if (opt) commit(opt.dataset.subjopt);
        });
        const newInput = pop.querySelector('.wl-wi2-subjpick-input');
        newInput.addEventListener('click', pv => pv.stopPropagation());
        newInput.addEventListener('keydown', (kv) => {
            if (kv.key === 'Enter') { kv.preventDefault(); commit(newInput.value); }
            else if (kv.key === 'Escape') { kv.stopPropagation(); pop.remove(); }
        });

        subjBtn.insertAdjacentElement('afterend', pop);
    });

    // ── Single-note actions (top-right cluster): move/copy · duplicate · delete ──
    // Each delegates to listcol (which owns selection, arrival, and the transfer
    // machinery) by the open note's uid. Delete + duplicate are one click;
    // move/copy opens listcol's target-book picker anchored under the button.
    // closeAllPops() first so an open subject/mode/placement pop doesn't linger.
    const moveBtn = $('#wl-wi2-noteMove');
    if (moveBtn) moveBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeAllPops();
        openNoteTransferPicker(e.uid, moveBtn);
    });
    const dupBtn = $('#wl-wi2-noteDup');
    if (dupBtn) dupBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeAllPops();
        duplicateNote(e.uid);   // listcol selects + reveals the copy → editor re-renders
    });
    const delBtn = $('#wl-wi2-noteDel');
    if (delBtn) delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeAllPops();
        deleteNote(e.uid);      // listcol confirms, deletes, re-arrives → editor re-renders
    });

    const titleInput = $('.wl-wi2-ed-title');
    if (titleInput) {
        titleInput.addEventListener('input', () => setTitle(e, titleInput.value));
        titleInput.addEventListener('change', () => {
            setTitle(e, titleInput.value.trim());
            refreshListcol();                // the row's name tracks the title
        });
    }
    const content = $('.wl-wi2-ed-content');
    if (content) content.addEventListener('input', () => setContent(e, content.value));

    // ── Mode picker ──
    $$('#wl-wi2-modePop [data-mode]').forEach(b => b.addEventListener('click', () => {
        if (b.classList.contains('off')) return;   // §9.5 — unavailable, not silently equivalent
        setMode(e, b.dataset.mode);
        rerender({ list: true });                  // the row glyph tracks the mode
    }));

    // ── Condition: cycle the four logic modes; remove clears keysecondary ──
    const swap = $('[data-swap="kind"]');
    if (swap) {
        const CYCLE = ['any', 'all', 'notany', 'notall'];
        swap.addEventListener('click', () => {
            const cur = NUM_LOGIC[e.selectiveLogic ?? 0] || 'any';
            setClause(e, CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]);
            rerender();
        });
    }
    const condRm = $('[data-condrm]');
    if (condRm) condRm.addEventListener('click', () => { clearClause(e); rerender(); });

    // ── Editable topic / term chips (primary key · condition secondary key) ──
    // Add via the inline input (Enter or comma commits a chip, and the caret
    // stays put so you can rattle off several); rename an existing chip by
    // clicking it; remove on the ✕. 'topic' routes to key, 'term' to
    // keysecondary; addTerm/removeTerm handle the '…' placeholder and the
    // empty-clause collapse in the data layer.
    const chipAdd = (group, val) => group === 'topic' ? addTopic(e, val) : addTerm(e, val);
    const chipRename = (group, oldV, newV) =>
        group === 'topic' ? renameTopic(e, oldV, newV) : renameTerm(e, oldV, newV);
    const chipRemove = (group, val) =>
        group === 'topic' ? removeTopic(e, val) : removeTerm(e, val);

    $$('[data-chiprm]').forEach(x => x.addEventListener('click', ev => {
        ev.stopPropagation();                     // don't also trigger rename
        chipRemove(x.dataset.chiprm, x.dataset.val);
        rerender();
    }));
    $$('[data-chip]').forEach(chip => chip.addEventListener('click', async () => {
        const group = chip.dataset.chip, cur = chip.dataset.val;
        const next = await promptPopup('Edit word', cur === '\u2026' ? '' : cur);
        if (next == null) return;                 // cancelled — leave as-is
        chipRename(group, cur, next);
        rerender();
    }));
    // Inline add-input: commit the typed word(s) and re-render, restoring
    // focus to the fresh input of the same group. A committed value can
    // contain commas (paste "a, b, c") — each piece becomes its own chip.
    // Enter with an empty field is a no-op (doesn't steal the keystroke).
    const commitChipInput = (inp, { keepFocus }) => {
        const group = inp.dataset.chipadd;
        const pieces = inp.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!pieces.length) return false;
        pieces.forEach(p => chipAdd(group, p));
        rerender(keepFocus ? { refocus: group } : {});
        return true;
    };
    $$('.wl-wi2-chip-input').forEach(inp => {
        inp.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' || ev.key === ',') {
                ev.preventDefault();
                commitChipInput(inp, { keepFocus: true });
            } else if (ev.key === 'Escape') {
                inp.value = '';
                inp.blur();
            }
        });
        // Blur commits too, so a typed-but-unentered word isn't silently lost
        // when the user clicks away. No refocus on blur — they left on purpose.
        inp.addEventListener('blur', () => { commitChipInput(inp, { keepFocus: false }); });
    });

    // ── Timing: live numbers, per-field adds, whole-clause remove ──
    $$('[data-timing]').forEach(inp => inp.addEventListener('change', () => {
        const n = Math.max(0, Number(inp.value) || 0);
        if (inp.dataset.timing === 'sticky') setSticky(e, n);
        if (inp.dataset.timing === 'cooldown') setCooldown(e, n);
        if (inp.dataset.timing === 'delay') setDelay(e, n);
        rerender({ list: true });               // timing icons live on the row
    }));
    $$('[data-timingadd]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.timingadd;
        if (k === 'sticky') setSticky(e, e.sticky || 3);
        if (k === 'cooldown') setCooldown(e, e.cooldown || 10);
        if (k === 'delay') setDelay(e, e.delay || 10);
        rerender({ list: true });
    }));
    const timingRm = $('[data-timingrm]');
    if (timingRm) timingRm.addEventListener('click', () => { clearTiming(e); rerender({ list: true }); });

    // ── Placement picker (two-step) + inline role/depth ──
    $$('#wl-wi2-placePop [data-anchor]').forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.anchor;
        setPlacement(e, (a === 'depth' || a === 'outlet') ? a : a + 'After');
        rerender();
        reopenPlacePop();   // stay open for step 2
    }));
    $$('#wl-wi2-placePop [data-place]').forEach(b => b.addEventListener('click', () => {
        setPlacement(e, b.dataset.place);
        rerender();
        reopenPlacePop();
    }));
    $$('#wl-wi2-placePop [data-role]').forEach(b => b.addEventListener('click', () => {
        setRole(e, Number(b.dataset.role));
        rerender();
        reopenPlacePop();
    }));
    $$('#wl-wi2-placePop [data-out]').forEach(b => b.addEventListener('click', () => {
        setOutlet(e, b.dataset.out);
        rerender();
        reopenPlacePop();
    }));
    const outNew = $('#wl-wi2-placePop [data-outnew]');
    if (outNew) outNew.addEventListener('click', async () => {
        const name = await promptPopup('New outlet name', '');
        if (name && name.trim()) {
            setOutlet(e, name.trim());
            rerender();
            reopenPlacePop();
        }
    });
    const roleCycle = $('[data-cycle="role"]');
    if (roleCycle) roleCycle.addEventListener('click', () => {
        setRole(e, (e.role ?? 0) + 1);
        rerender();
    });
    const depthInput = $('[data-edit="depth"]');
    if (depthInput) depthInput.addEventListener('change', () => {
        const wasOpen = $('#wl-wi2-placePop')?.classList.contains('open');
        setDepth(e, Number(depthInput.value) || 0);
        rerender();
        if (wasOpen) reopenPlacePop();
    });

    // ── Cast filter: polarity, per-chip + whole removes, and a REAL picker ──
    const castPol = $('[data-cycle="castpol"]');
    if (castPol) castPol.addEventListener('click', () => {
        setCastExclude(e, !e.characterFilter?.isExclude);
        rerender();
    });
    // Whole-filter clear (data-castrm="all"); the old part-clears are gone
    // from the sentence in favour of per-chip ✕, but the handler still
    // honours a "names"/"tags" value defensively (grid path, future callers).
    $$('[data-castrm]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.castrm === 'all') { clearCast(e); castOpenUid = null; }  // gone means gone
        else clearCastPart(e, b.dataset.castrm);
        rerender();
    }));
    $$('[data-castnamerm]').forEach(x => x.addEventListener('click', ev => {
        ev.stopPropagation();
        removeCastName(e, x.dataset.castnamerm);
        rerender();
    }));
    $$('[data-casttagrm]').forEach(x => x.addEventListener('click', ev => {
        ev.stopPropagation();
        removeCastTag(e, x.dataset.casttagrm);
        rerender();
    }));
    // The picker: an on-demand popover anchored under the opener (same shape
    // as the also-read source picker), but with a live text filter because a
    // roster can be long. 'names' lists characters (stored by avatar-stem);
    // 'tags' lists in-use tags (stored by id). Already-picked entries are
    // hidden. Picking commits immediately and re-renders (which drops the
    // popover — the roster shrank by one, and a fresh pick reopens cleanly).
    $$('[data-castadd]').forEach(btn => btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        $('#wl-wi2-castPick')?.remove();
        const kind = btn.dataset.castadd;               // 'names' | 'tags'
        const roster = castRoster();
        const cf = e.characterFilter || { names: [], tags: [] };
        const taken = new Set(kind === 'names' ? (cf.names || []) : (cf.tags || []));
        const items = (kind === 'names' ? roster.names : roster.tags)
            .filter(it => !taken.has(kind === 'names' ? it.value : it.id));

        const pop = document.createElement('div');
        pop.className = 'wl-wi2-subj-pop wl-wi2-castpick wl-wi2-castpick-up open';
        pop.id = 'wl-wi2-castPick';
        // Open ABOVE the opener. The pop is inserted as the button's next
        // sibling and positioned within the nearest positioned ancestor
        // (the sentence line is the offsetParent here); anchoring its bottom
        // to the button's top edge makes it grow upward. `bottom`/`left` are
        // set after insertion once layout is known (below).
        pop.style.cssText = 'position:absolute; z-index:40;';

        // Position the pop so its bottom sits just above the opener's top,
        // left-aligned to it, measured in the offsetParent's coordinate space.
        const placeAbove = () => {
            const parent = pop.offsetParent || btn.offsetParent || root;
            const pr = parent.getBoundingClientRect();
            const br = btn.getBoundingClientRect();
            pop.style.left = (br.left - pr.left) + 'px';
            pop.style.bottom = (pr.bottom - br.top + 4) + 'px';
        };

        if (!items.length) {
            // Honest empty state: nothing loaded, or every candidate is taken.
            const none = (kind === 'names' ? roster.names : roster.tags).length === 0;
            pop.innerHTML = `<div class="wl-wi2-castpick-empty">${none
                ? (kind === 'names'
                    ? 'No characters are loaded to pick from. You can still type a name into the mechanics grid\u2019s characterFilter.names row.'
                    : 'No tags are in use to pick from. You can still type one into the grid\u2019s characterFilter.tags row.')
                : (kind === 'names' ? 'Every loaded character is already listed.' : 'Every in-use tag is already listed.')}</div>`;
            btn.insertAdjacentElement('afterend', pop);
            placeAbove();
            pop.addEventListener('click', pv => pv.stopPropagation());
            return;
        }

        const rowHTML = it => kind === 'names'
            ? `<button class="wl-wi2-subj-opt" data-castopt="${esc(it.value)}">${esc(it.label)}<span class="wl-wi2-eng" style="display:inline; margin-left:6px;"> \u00b7 ${esc(it.value)}</span></button>`
            : `<button class="wl-wi2-subj-opt" data-castopt="${esc(it.id)}">${esc(it.label)}</button>`;
        const listHTML = items.map(rowHTML).join('');
        pop.innerHTML = `<input class="wl-wi2-castpick-filter" type="text" placeholder="${kind === 'names' ? 'filter characters\u2026' : 'filter tags\u2026'}" autocomplete="off" spellcheck="false">
            <div class="wl-wi2-castpick-list">${listHTML}</div>`;

        // Text filter: substring over the visible label (and, for names, the
        // stored stem too — so you can find by either).
        const filterInput = pop.querySelector('.wl-wi2-castpick-filter');
        const listBox = pop.querySelector('.wl-wi2-castpick-list');
        const applyFilter = () => {
            const q = filterInput.value.trim().toLowerCase();
            listBox.querySelectorAll('[data-castopt]').forEach(opt => {
                const hay = opt.textContent.toLowerCase();
                opt.style.display = (!q || hay.includes(q)) ? '' : 'none';
            });
            placeAbove();   // list height changes as it filters; keep the
                            // bottom edge pinned above the opener as it grows.
        };
        filterInput.addEventListener('input', applyFilter);
        filterInput.addEventListener('keydown', kv => {
            if (kv.key === 'Escape') { kv.stopPropagation(); pop.remove(); }
            else if (kv.key === 'Enter') {
                // Enter commits the single visible match, if exactly one.
                const shown = [...listBox.querySelectorAll('[data-castopt]')].filter(o => o.style.display !== 'none');
                if (shown.length === 1) { kv.preventDefault(); shown[0].click(); }
            }
        });

        pop.addEventListener('click', pv => {
            pv.stopPropagation();
            const opt = pv.target.closest('[data-castopt]');
            if (!opt) return;
            if (kind === 'names') addCastName(e, opt.dataset.castopt);
            else addCastTag(e, opt.dataset.castopt);
            rerender();
        });
        btn.insertAdjacentElement('afterend', pop);
        placeAbove();
        filterInput.focus();
    }));

    // ── Scan overrides ──
    const scanDepthInput = $('[data-edit="scandepth"]');
    if (scanDepthInput) scanDepthInput.addEventListener('change', () => {
        setScanDepth(e, Number(scanDepthInput.value) || 0);
        rerender();
    });
    $$('[data-scanflip]').forEach(b => b.addEventListener('click', () => {
        flipScan(e, b.dataset.scanflip);
        rerender();
    }));
    $$('[data-scanadd]').forEach(b => b.addEventListener('click', () => {
        seedScan(e, b.dataset.scanadd);
        rerender();
    }));
    $$('[data-scanrm]').forEach(b => b.addEventListener('click', () => {
        clearScan(e);
        rerender();
    }));

    // ── Automation: live write on input (no caret fight); remove clears ──
    const autoInput = $('[data-edit="automationid"]');
    if (autoInput) autoInput.addEventListener('input', () => setAutomationId(e, autoInput.value));
    const autoRm = $('[data-autorm]');
    if (autoRm) autoRm.addEventListener('click', () => {
        clearAutomationId(e);
        if (autoOpenUid === String(e.uid)) autoOpenUid = null;
        rerender();
    });

    // ── Also-read sources: chips + an on-demand picker (delegated) ──
    const srcAdd = $('[data-srcadd]');
    if (srcAdd) srcAdd.addEventListener('click', (ev) => {
        ev.stopPropagation();
        $('#wl-wi2-srcPick')?.remove();
        const have = SOURCE_KEYS.filter(k => e[k]);
        const avail = SOURCE_KEYS.filter(k => !have.includes(k));
        if (!avail.length) return;
        const pop = document.createElement('div');
        pop.className = 'wl-wi2-subj-pop open';
        pop.id = 'wl-wi2-srcPick';
        pop.style.cssText = 'position:absolute; z-index:40; margin-top:4px;';
        pop.innerHTML = avail.map(k =>
            `<button class="wl-wi2-subj-opt" data-srcopt="${k}">${SOURCE_WORD[k]}<span class="wl-wi2-eng" style="display:inline; margin-left:6px;"> \u00b7 ${k}</span></button>`).join('');
        pop.addEventListener('click', (pv) => {
            pv.stopPropagation();
            const opt = pv.target.closest('[data-srcopt]');
            if (!opt) return;
            addSource(e, opt.dataset.srcopt);
            rerender();
        });
        srcAdd.insertAdjacentElement('afterend', pop);
    });
    $$('[data-srcrm]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.srcrm === 'all') clearSources(e);
        else removeSource(e, b.dataset.srcrm);
        rerender();
    }));

    // ── Recursion: three flips, an editable delay level, and a whole-remove ──
    $$('[data-recflip]').forEach(b => b.addEventListener('click', () => {
        const f = b.dataset.recflip;
        // Read live ST fields, not viewOf — viewOf collapses recursion to null
        // when all three switches are off, which would make an off→on flip read
        // its current state as an all-false stub and mis-toggle. The clause is
        // held open by recOpenUid, so toggling the last switch off is fine.
        const dur = e.delayUntilRecursion;
        const delayOn = dur === true || (typeof dur === 'number' && dur > 0);
        if (f === 'exclude') setExcludeRecursion(e, !e.excludeRecursion);
        else if (f === 'prevent') setPreventRecursion(e, !e.preventRecursion);
        else if (f === 'delay') setDelayRecursion(e, !delayOn);
        recOpenUid = String(e.uid);   // keep the clause visible after the flip
        rerender();
    }));
    const recLevel = $('[data-reclevel]');
    if (recLevel) recLevel.addEventListener('change', () => {
        setDelayLevel(e, recLevel.value);
        rerender();
    });
    const recRm = $('[data-recrm]');
    if (recRm) recRm.addEventListener('click', () => { clearRecursion(e); recOpenUid = null; rerender(); });

    // ── Generation-type triggers: chip removes + an on-demand add picker ──
    $$('[data-trgrm]').forEach(b => b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (b.dataset.trgrm === 'all') clearTriggers(e);
        else removeTrigger(e, b.dataset.trgrm);
        rerender();
    }));
    const trgAdd = $('[data-trgadd]');
    if (trgAdd) trgAdd.addEventListener('click', (ev) => {
        ev.stopPropagation();
        $('#wl-wi2-trgPick')?.remove();
        const have = Array.isArray(e.triggers) ? e.triggers : [];
        const avail = GENERATION_TRIGGERS.filter(t => !have.includes(t));
        if (!avail.length) return;
        const pop = document.createElement('div');
        pop.className = 'wl-wi2-subj-pop open';
        pop.id = 'wl-wi2-trgPick';
        pop.style.cssText = 'position:absolute; z-index:40; margin-top:4px;';
        pop.innerHTML = avail.map(t =>
            `<button class="wl-wi2-subj-opt" data-trgopt="${esc(t)}">${TRIGGER_WORD[t] || esc(t)}<span class="wl-wi2-eng" style="display:inline; margin-left:6px;"> \u00b7 ${esc(t)}</span></button>`).join('');
        pop.addEventListener('click', (pv) => {
            pv.stopPropagation();
            const opt = pv.target.closest('[data-trgopt]');
            if (!opt) return;
            addTrigger(e, opt.dataset.trgopt);
            rerender();
        });
        trgAdd.insertAdjacentElement('afterend', pop);
    });

    // ── Chance ──
    const chanceInput = $('[data-edit="chance"]');
    if (chanceInput) chanceInput.addEventListener('change', () => {
        setChance(e, chanceInput.value);
        rerender();
    });
    const chanceRm = $('[data-chancerm]');
    if (chanceRm) chanceRm.addEventListener('click', () => { clearChance(e); rerender(); });

    // ── Alternates ──
    const altAdd = $('[data-altadd]');
    if (altAdd) altAdd.addEventListener('click', async () => {
        const name = await promptPopup('Pool name (notes sharing it take turns)', '');
        if (name && name.trim()) { joinPool(e, name); rerender(); }
    });
    $$('[data-altrm]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.altrm === 'all') clearPools(e);
        else leavePool(e, b.dataset.altrm);
        rerender();
    }));
    $$('[data-alttoggle]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.alttoggle === 'override') toggleAltOverride(e);
        else toggleAltScoring(e);
        rerender();
    }));
    const altWeight = $('[data-edit="altweight"]');
    if (altWeight) altWeight.addEventListener('change', () => {
        setAltWeight(e, altWeight.value);
        rerender();
    });

    // ── Rank + budget ──
    const rankInput = $('[data-edit="rank"]');
    if (rankInput) rankInput.addEventListener('change', () => {
        setRank(e, rankInput.value);
        rerender({ list: true });               // the rank chip lives on the row
    });
    $$('[data-fits]').forEach(b => b.addEventListener('click', () => {
        setFits(e, b.dataset.fits === '1');
        rerender();
        refreshTopbar();   // ignoreBudget changes what the budget counts (§9.28 seam) — poke the meter so a post-generation reading isn't stale
    }));

    // ── Templates ──
    $$('#wl-wi2-typeMenu button[data-type]').forEach(b => b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        applyTemplate(e, b.dataset.type);
        closeAllPops();
        rerender({ list: true });
    }));

    // ── Add-menu ──
    $$('#wl-wi2-addMenu button[data-add]').forEach(b => b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (b.disabled) return;
        const k = b.dataset.add;
        if (b.dataset.cond) setClause(e, k);         // singular: replaces, never appends
        else if (k === 'timing') seedTiming(e);
        else if (k === 'cast') { seedCast(e); castOpenUid = String(e.uid); }  // hold the empty line open until a pick
        else if (k === 'chance') seedChance(e);
        else if (k === 'automation') { if (!String(e.automationId ?? '').trim()) autoOpenUid = String(e.uid); }
        else if (k === 'scan') seedScan(e, 'depth');
        else if (k === 'alsoRead') { if (!SOURCE_KEYS.some(s => e[s])) addSource(e, 'matchPersonaDescription'); }
        else if (k === 'recursion') { seedRecursion(e); recOpenUid = String(e.uid); }
        else if (k === 'triggers') seedTriggers(e);
        else if (k === 'alts') {
            closeAllPops();
            promptPopup('Pool name (notes sharing it take turns)', '').then(name => {
                if (name && name.trim()) { joinPool(e, name); rerender(); }
            });
            return;
        }
        closeAllPops();
        rerender({ list: true });
    }));

    // ── Mechanics flip + the delegated two-way grid ──
    const mechBtn = $('#wl-wi2-mechBtn');
    if (mechBtn) mechBtn.addEventListener('click', () => { showMech = !showMech; rerender(); });
    const mechGrid = $('.wl-wi2-mech-grid');
    if (mechGrid) mechGrid.addEventListener('change', (ev) => {
        const f = ev.target.closest('[data-mech]');
        if (!f) return;
        const raw = f.type === 'checkbox' ? f.checked : f.value;
        applyMechEdit(e, f.dataset.mech, raw);
        rerender({ list: true });               // title/mode/rank edits change the row
    });
}

// ============================================================
// Lifecycle
// ============================================================

// Subscribed ONCE at module load — listcol's listener list has no
// unsubscribe, so a per-init subscription would stack a render per
// open/close cycle. render() itself no-ops while the pane is down.
onSelectedNoteChanged(() => { autoOpenUid = null; castOpenUid = null; recOpenUid = null; render(); });

// The open note's subject can change from OUTSIDE the editor — bulk
// assign-subject in the list writes the store directly, which is not a
// selection change, so onSelectedNoteChanged never fires. Without this the
// editor's "filed under" chip stayed stale until you switched entries (and
// would keep serving the old subject to any edit you made meanwhile). render()
// re-reads getSubject fresh, so one re-paint on any store change re-syncs it.
// Subscribed once at module load, same reasoning as above (the store DOES
// return an unsubscribe, but the editor lives for the module's lifetime and
// render() is inert while root is null). A redundant repaint of the single
// open note when some OTHER note's subject changes is cheap.
onSubjectsChanged(() => { render(); });

export function initEditor(rootEl) {
    root = rootEl;
    document.addEventListener('click', docClick);
    render();
    log('editor initialized');
}

export function teardownEditor() {
    document.removeEventListener('click', docClick);
    // Pending debounced saves are listData's; listcol's teardown flushes
    // them (§9.31). Nothing here holds save state of its own.
    root = null;
    autoOpenUid = null;
    castOpenUid = null;
    recOpenUid = null;
    log('editor torn down');
}
