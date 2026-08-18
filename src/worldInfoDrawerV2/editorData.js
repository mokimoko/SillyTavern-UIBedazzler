// src/worldInfoDrawerV2/editorData.js
// WI v2 editor — the ST field layer for the OPEN NOTE. Same shape as
// listData/railData: every ST truth translation in one file. The entry
// object the editor mutates is the SAME live reference listData holds
// (loadWorldInfo result), so every write here lands in the object
// saveWorldInfo serializes — one source of truth, three columns.
//
// Save model: listData's (v1's) debounce. Every writer below ends in
// scheduleSave(); §9.31's flushPendingSave() at book switch / teardown
// lands whatever is pending. Nothing here keeps its own dirty state.
//
// The writer-model ↔ ST mapping (mock's applyMechEdit, real field names):
//   title↔comment · topics↔key · clause↔keysecondary+selectiveLogic(+selective)
//   mode↔constant/vectorized/disable · rank↔order
//   placement↔position 0..7 (+depth/role/outletName)
//   timing: lingers↔sticky · rests↔cooldown · waits↔delay
//   chance↔probability(+useProbability) · alwaysFits↔ignoreBudget
//   cast↔characterFilter{isExclude,names,tags}
//   scan↔scanDepth/caseSensitive/matchWholeWords (null = inherit, audit §18)
//   alsoRead↔the six match* bools · alts↔group/groupWeight/groupOverride/
//   useGroupScoring · automationId↔automationId
//   type: NOT an ST field. Like subjects, it's v2-only metadata kept in the
//   shared sidecar (subjectStore's noteTypes section), keyed book+uid, so it
//   never touches the ST entry or an exported lorebook. setType/applyTemplate
//   write it through subjectStore; viewOf stays a pure ST projection (the
//   editor reads getType(book, uid) directly, exactly as it reads getSubject).

import { getBook, scheduleSave } from './listData.js';
// Note "type" lives in the shared sidecar (same store as subjects), NOT on the
// ST entry — so it stays out of exported lorebooks. setType/applyTemplate route
// through here; the editor reads it back with subjectStore.getType.
import { setType as setNoteType } from './subjectStore.js';
// ST tag truth for the cast picker. tag_map is keyed on the RAW avatar
// filename ("Seraphina.png"); `tags` is the global tag list. Same source
// chatDesign/storage.js reads.
import { tags as stTags, tag_map } from '../../../../../tags.js';

const wiPromise = import('../../../../../../scripts/world-info.js');
let wiMod = null;
wiPromise.then(m => { wiMod = m; }).catch(() => {});

const ctx = () => SillyTavern.getContext();

// ============================================================
// Enums — ST truth, the mock's mapping tables verbatim
// ============================================================

export const NUM_POS = { 0: 'charBefore', 1: 'charAfter', 2: 'anBefore', 3: 'anAfter', 4: 'depth', 5: 'emBefore', 6: 'emAfter', 7: 'outlet' };
export const POS_NUM = { charBefore: 0, charAfter: 1, anBefore: 2, anAfter: 3, depth: 4, emBefore: 5, emAfter: 6, outlet: 7 };
export const NUM_LOGIC = { 0: 'any', 1: 'notall', 2: 'notany', 3: 'all' };
export const LOGIC_NUM = { any: 0, notall: 1, notany: 2, all: 3 };
export const SOURCE_KEYS = [
    'matchPersonaDescription', 'matchCharacterDescription',
    'matchCharacterPersonality', 'matchCharacterDepthPrompt',
    'matchScenario', 'matchCreatorNotes',
];

// ============================================================
// Reads
// ============================================================

/** ST truth → the four writer-facing modes (same precedence as listcol). */
export function modeOf(e) {
    if (e.disable) return 'shelved';
    if (e.constant) return 'always';
    if (e.vectorized) return 'meaning';
    return 'topic';
}

/** All entries of the open book (live references). */
export function bookEntries() {
    const { data } = getBook();
    return data?.entries ? Object.values(data.entries) : [];
}

/** The open book's name (for the identity row). */
export function openBookName() {
    return getBook().name;
}

/**
 * The writer-model view of one ST entry — the shape the mock's render
 * functions read. A PROJECTION, rebuilt every render; never mutated.
 */
export function viewOf(e) {
    const timing = (e.sticky || e.cooldown || e.delay)
        ? { lingers: e.sticky || null, rests: e.cooldown || null, waits: e.delay || null }
        : null;
    // Cast surfaces when the filter is MEANINGFUL — it names characters or
    // tags, or is an active exclude. ST commonly ships entries with an empty
    // default characterFilter {isExclude:false, names:[], tags:[]}; that inert
    // shell must NOT light up the line. A freshly seeded (still-empty) filter
    // is held open by the editor's castOpenUid flag instead, checked in the
    // render layer — viewOf only reports what the data actually says.
    const cf = e.characterFilter;
    const castMeaningful = !!cf && ((cf.names?.length) || (cf.tags?.length) || cf.isExclude);
    const cast = castMeaningful
        ? { exclude: !!cf.isExclude, names: cf.names || [], tags: cf.tags || [] }
        : null;
    const scan = (e.scanDepth != null || e.caseSensitive != null || e.matchWholeWords != null)
        ? { depth: e.scanDepth ?? null, caseSensitive: e.caseSensitive ?? null, wholeWords: e.matchWholeWords ?? null }
        : null;
    const srcs = SOURCE_KEYS.filter(k => e[k]);
    // Recursion (§ST world-info ~4855-4870, ~5080). Three independent ST
    // fields that all concern the recursion pass, surfaced as one clause:
    //   excludeRecursion  — never activated BY another note's recursion
    //   preventRecursion  — its own content won't trigger further notes
    //   delayUntilRecursion — held until a recursion pass. ST stores this as
    //     false (off) | true (on, level 1) | number>=2 (on, at that level).
    // The clause is meaningful when ANY of the three is on; delay's level is
    // normalized to a number for the view (true → 1).
    const dur = e.delayUntilRecursion;
    const delayOn = dur === true || (typeof dur === 'number' && dur > 0);
    const recursion = (e.excludeRecursion || e.preventRecursion || delayOn)
        ? {
            exclude: !!e.excludeRecursion,
            prevent: !!e.preventRecursion,
            delay: delayOn,
            delayLevel: (typeof dur === 'number' && dur > 1) ? dur : (delayOn ? 1 : null),
        }
        : null;
    // Generation-type triggers (§ST ~4807). Empty array = fires on ALL types
    // (native default); a non-empty array RESTRICTS to just those. Only a
    // non-empty list is meaningful, so an empty one projects as null.
    const trg = Array.isArray(e.triggers) ? e.triggers.filter(Boolean) : [];
    const triggers = trg.length ? trg : null;
    const groups = String(e.group || '').split(',').map(s => s.trim()).filter(Boolean);
    const alts = groups.length
        ? { groups, weight: e.groupWeight ?? 100, override: !!e.groupOverride, scoring: e.useGroupScoring === true }
        : null;
    return {
        uid: e.uid,
        title: e.comment || '',
        content: e.content || '',
        topics: Array.isArray(e.key) ? e.key : [],
        clauses: (e.keysecondary?.length)
            ? [{ kind: NUM_LOGIC[e.selectiveLogic ?? 0] || 'any', terms: e.keysecondary }]
            : [],
        mode: modeOf(e),
        rank: e.order ?? 0,
        placement: NUM_POS[e.position ?? 1] || 'charAfter',
        depth: e.depth ?? 4,
        role: e.role ?? 0,
        outlet: e.outletName || '',
        timing, cast, scan,
        alsoRead: srcs.length ? srcs : null,
        recursion,
        triggers,
        chance: e.probability ?? 100,
        useProbability: e.useProbability,
        alts,
        alwaysFits: !!e.ignoreBudget,
        automationId: e.automationId ?? '',
        // NEITHER subject NOR type is here: both are v2-only sidecar metadata
        // (subjectStore), not ST fields, and viewOf stays a pure ST projection.
        // The editor reads getSubject(book, uid) / getType(book, uid) directly.
    };
}

/** Rank position among the book's non-shelved entries (mock's rankPosition). */
export function rankPosition(e) {
    if (modeOf(e) === 'shelved') return null;
    const active = bookEntries().filter(x => modeOf(x) !== 'shelved');
    const rank = e.order ?? 0;
    const higher = active.filter(x => (x.order ?? 0) > rank).length;
    const tied = active.filter(x => (x.order ?? 0) === rank).length;
    return { pos: higher + 1, total: active.length, tied: tied > 1 };
}

/** Outlets in the open book: Map outletName → note count (position 7 only). */
export function outletsOf() {
    const m = new Map();
    for (const e of bookEntries()) {
        if ((e.position ?? 1) !== 7) continue;
        const name = e.outletName || '';
        m.set(name, (m.get(name) || 0) + 1);
    }
    return m;
}

// ── Cast roster (the picker's source of truth) ──────────────────────────
// ENGINE TRUTH (world-info.js fillCharacterAndTagOptionsHelper ~3030):
//   • characterFilter.names holds the AVATAR FILENAME MINUS EXTENSION
//     (`character.avatar.replace(/\.[^/.]+$/, '')`), NOT the display name.
//     That's the value the engine matches a chat's active characters on.
//   • characterFilter.tags holds the tag ID (a string), not the tag name.
// So the picker must STORE avatar-stems / tag-ids while SHOWING friendly
// names. These readers give both halves; the writers below store the value,
// the label resolvers turn a stored value back into something readable.

/** ST's own avatar→name rule for a cast NAME value (extension stripped). */
const avatarStem = av => String(av || '').replace(/\.[^/.]+$/, '');

/**
 * The book-independent cast roster: every loaded character as a pickable
 * name, plus every tag actually in use. Shape:
 *   { names: [{ value, label, tagIds:[id] }], tags: [{ id, label }] }
 * `value` is what we store; `label` is what we show (display name, and for
 * names we disambiguate collisions by appending the stem). Empty/degenerate
 * ST state (no characters yet) yields empty arrays — the caller decides copy.
 */
export function castRoster() {
    let chars = [];
    try { chars = ctx().characters || []; } catch { chars = []; }

    // Names: dedupe by stored value; note label collisions to disambiguate.
    const byValue = new Map();
    const labelCount = new Map();
    for (const c of chars) {
        if (!c || !c.avatar) continue;
        const value = avatarStem(c.avatar);
        if (!value || byValue.has(value)) continue;
        const label = c.name || value;
        labelCount.set(label, (labelCount.get(label) || 0) + 1);
        const tagIds = Array.isArray(tag_map?.[c.avatar]) ? tag_map[c.avatar] : [];
        byValue.set(value, { value, label, tagIds });
    }
    const names = [...byValue.values()]
        .map(n => labelCount.get(n.label) > 1 ? { ...n, label: `${n.label} (${n.value})` } : n)
        .sort((a, b) => a.label.localeCompare(b.label));

    // Tags: only those attached to at least one loaded character, ST's order.
    const usedIds = new Set();
    for (const c of chars) {
        const ids = Array.isArray(tag_map?.[c?.avatar]) ? tag_map[c.avatar] : [];
        ids.forEach(id => usedIds.add(id));
    }
    const tags = (stTags || [])
        .filter(t => usedIds.has(t.id))
        .sort((a, b) => {
            const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
            return so !== 0 ? so : (a.name || '').localeCompare(b.name || '');
        })
        .map(t => ({ id: t.id, label: t.name || String(t.id) }));

    return { names, tags };
}

/** Stored cast NAME value → a readable label (falls back to the raw value,
 *  so a filter naming a since-deleted or foreign character still shows). */
export function castNameLabel(value) {
    let chars = [];
    try { chars = ctx().characters || []; } catch { chars = []; }
    const hit = chars.find(c => c && avatarStem(c.avatar) === value);
    return hit?.name ? (hit.name === value ? hit.name : `${hit.name}`) : String(value);
}

/** Stored cast TAG id → the tag's name (falls back to the raw id). */
export function castTagLabel(id) {
    const t = (stTags || []).find(x => x.id === id);
    return t?.name || String(id);
}

/** §9.5 — is vector storage reading World Info? Warn only on a positive "off". */
export function vectorsOn() {
    try { return ctx().extensionSettings?.vectors?.enabled_world_info ?? true; }
    catch { return true; }
}

/** ST's global scan depth (live binding once world-info.js resolves). */
export function globalScanDepth() {
    return wiMod?.world_info_depth ?? 2;
}

/** Honest rough token estimate (~chars/3.5) — the tilde is doing real work. */
export function tokenEstimate(text) {
    return Math.max(0, Math.round(String(text || '').length / 3.5));
}

// ============================================================
// Writers — every one mutates the live entry, then scheduleSave()
// ============================================================

export function setTitle(e, v)   { e.comment = v; scheduleSave(); }
export function setContent(e, v) { e.content = v; scheduleSave(); }
export function setType(e, v)    { setNoteType(openBookName(), e.uid, v); }

/** Write the mode triple. Shelving flips ONLY disable, so unshelving
 *  restores what the note was; picking any live mode clears all three
 *  then sets its own flag. `key` is never touched (mock's rule). */
export function setMode(e, mode) {
    if (mode === 'shelved') { e.disable = true; scheduleSave(); return; }
    e.disable = false;
    e.constant = (mode === 'always');
    e.vectorized = (mode === 'meaning');
    scheduleSave();
}

/** Condition: ST stores ONE keysecondary + ONE selectiveLogic — singular. */
export function setClause(e, kind, terms) {
    e.keysecondary = (terms && terms.length) ? terms : (e.keysecondary?.length ? e.keysecondary : ['\u2026']);
    e.selectiveLogic = LOGIC_NUM[kind] ?? 0;
    e.selective = true;   // logic only bites when this is on (ST semantics)
    scheduleSave();
}
export function clearClause(e) { e.keysecondary = []; scheduleSave(); }

// ── Editable topic / term chips (the sentence's primary + secondary keys) ──
// Primary keys live on e.key, secondary on e.keysecondary. The mechanics grid
// edits both as raw comma strings; these give the SENTENCE per-chip add /
// rename / remove without routing through a text field. Guards:
//   - PLACEHOLDER: adding a condition seeds keysecondary ['…'] (setClause),
//     and that '…' is a LIVE matching key until edited. A real add on a
//     lone-placeholder clause replaces it; renaming it away is also fine.
//   - EMPTY: removing the last term of a clause clears the clause entirely
//     (keysecondary []), rather than leaving [] with selective still armed.
//   - DEDUPE: a term already present is a no-op (matching is set-semantics).

const PLACEHOLDER = '\u2026';
const norm = v => String(v).trim();
const isLonePlaceholder = arr => arr.length === 1 && arr[0] === PLACEHOLDER;

export function addTopic(e, v) {
    const t = norm(v); if (!t) return;
    const cur = Array.isArray(e.key) ? e.key : [];
    if (cur.includes(t)) return;
    e.key = [...cur, t];
    scheduleSave();
}
export function renameTopic(e, oldV, newV) {
    const cur = Array.isArray(e.key) ? e.key : [];
    const i = cur.indexOf(oldV); if (i < 0) return;
    const t = norm(newV);
    if (!t) { e.key = cur.filter((_, j) => j !== i); scheduleSave(); return; }
    if (t !== oldV && cur.includes(t)) { e.key = cur.filter((_, j) => j !== i); } // merge dupes
    else cur[i] = t;
    e.key = [...cur];
    scheduleSave();
}
export function removeTopic(e, v) {
    const cur = Array.isArray(e.key) ? e.key : [];
    e.key = cur.filter(x => x !== v);
    scheduleSave();
}

/** Add a term to the note's single condition. Replaces a lone '…' placeholder
 *  rather than sitting beside it, so a fresh condition never keeps matching on
 *  the placeholder once the user names a real word. */
export function addTerm(e, v) {
    const t = norm(v); if (!t) return;
    const cur = e.keysecondary?.length ? e.keysecondary : [];
    if (isLonePlaceholder(cur)) { e.keysecondary = [t]; e.selective = true; scheduleSave(); return; }
    if (cur.includes(t)) return;
    e.keysecondary = [...cur, t];
    e.selective = true;
    scheduleSave();
}
export function renameTerm(e, oldV, newV) {
    const cur = e.keysecondary?.length ? [...e.keysecondary] : [];
    const i = cur.indexOf(oldV); if (i < 0) return;
    const t = norm(newV);
    if (!t) return removeTerm(e, oldV);        // cleared text = remove
    if (t !== oldV && cur.includes(t)) cur.splice(i, 1);   // merge dupes
    else cur[i] = t;
    e.keysecondary = cur;
    scheduleSave();
}
/** Remove one term; emptying the clause clears it (no armed-but-empty state). */
export function removeTerm(e, v) {
    const cur = e.keysecondary?.length ? e.keysecondary.filter(x => x !== v) : [];
    if (!cur.length) { e.keysecondary = []; scheduleSave(); return; }
    e.keysecondary = cur;
    scheduleSave();
}

// Timing trio — 0/null both mean "off" to the engine; we write null for off.
export function setSticky(e, n)   { e.sticky = n || null; scheduleSave(); }
export function setCooldown(e, n) { e.cooldown = n || null; scheduleSave(); }
export function setDelay(e, n)    { e.delay = n || null; scheduleSave(); }
export function seedTiming(e)     { if (!(e.sticky || e.cooldown || e.delay)) e.sticky = 3; scheduleSave(); }
export function clearTiming(e)    { e.sticky = null; e.cooldown = null; e.delay = null; scheduleSave(); }

/** Mirror the outlet name into extensions.outlet_name.
 *  outletName is NOT in ST's originalWIDataKeyMap (world-info.js ~2687), so
 *  saveWorldInfo won't serialize it from the top-level field — and on reload
 *  ST rebuilds entry.outletName FROM entry.extensions.outlet_name (~5647).
 *  Without this mirror the name survives the session but is lost on reload.
 *  Same fix as v1's EXTRA_ORIGINAL_KEYS and ST's own editor handler. */
function syncOutletName(e) {
    if (!e.extensions || typeof e.extensions !== 'object') e.extensions = {};
    e.extensions.outlet_name = e.outletName ?? '';
}

export function setPlacement(e, key) {
    e.position = POS_NUM[key] ?? 1;
    if (key === 'depth') { e.depth = e.depth ?? 4; e.role = e.role ?? 0; }
    if (key === 'outlet' && e.outletName == null) { e.outletName = ''; syncOutletName(e); }
    scheduleSave();
}
export function setDepth(e, n)  { e.depth = Math.max(0, n | 0); scheduleSave(); }
export function setRole(e, n)   { e.role = ((n | 0) % 3 + 3) % 3; scheduleSave(); }
export function setOutlet(e, v) { e.outletName = String(v).trim(); syncOutletName(e); scheduleSave(); }

export function setRank(e, n) { e.order = Math.trunc(Number(n) || 0); scheduleSave(); }
export function setFits(e, on) { e.ignoreBudget = !!on; scheduleSave(); }

export function seedChance(e)  { e.probability = 75; e.useProbability = true; scheduleSave(); }
/** Clamped 0–100: the input's min/max only guard the spinners, not typing.
 *  (The mech grid's probability row stays raw on purpose — raw edits win.) */
export function setChance(e, n) { e.probability = Math.min(100, Math.max(0, Math.trunc(Number(n) || 0))); scheduleSave(); }
export function clearChance(e) { e.probability = 100; e.useProbability = true; scheduleSave(); }

// Cast filter — polarity, part-removal, AND adding are all live now that the
// picker (castRoster) supplies real avatar-stems / tag-ids. A filter object
// exists only while it has at least one name or tag OR is an active exclude;
// emptying it deletes the whole thing (ST's own rule, world-info.js ~3063).
export function setCastExclude(e, on) {
    if (e.characterFilter) { e.characterFilter.isExclude = !!on; scheduleSave(); }
}
export function clearCastPart(e, part) {
    const cf = e.characterFilter;
    if (!cf) return;
    cf[part] = [];
    if (!(cf.names?.length) && !(cf.tags?.length)) delete e.characterFilter;
    scheduleSave();
}
export function clearCast(e) { delete e.characterFilter; scheduleSave(); }

/** Ensure a characterFilter object exists so the sentence surfaces the cast
 *  line (with its pickers) even before a first name/tag is chosen. Default
 *  polarity is "Only" (isExclude:false), matching ST's Object.assign seed. */
export function seedCast(e) {
    if (!e.characterFilter) e.characterFilter = { isExclude: false, names: [], tags: [] };
    scheduleSave();
}

// Add one picked character (stored as its avatar-stem) or one tag (stored as
// its id). Both create the filter if absent, dedupe, and are no-ops on empty
// input. These are the sentence's live add path; the grid's cfNames/cfTags
// comma rows still edit the same arrays.
function ensureCF(e) {
    if (!e.characterFilter) e.characterFilter = { isExclude: false, names: [], tags: [] };
    const cf = e.characterFilter;
    if (!Array.isArray(cf.names)) cf.names = [];
    if (!Array.isArray(cf.tags)) cf.tags = [];
    return cf;
}
export function addCastName(e, value) {
    const v = String(value ?? '').trim();
    if (!v) return;
    const cf = ensureCF(e);
    if (!cf.names.includes(v)) { cf.names = [...cf.names, v]; scheduleSave(); }
}
export function addCastTag(e, id) {
    if (id == null || id === '') return;
    const cf = ensureCF(e);
    if (!cf.tags.includes(id)) { cf.tags = [...cf.tags, id]; scheduleSave(); }
}
// Per-chip removal (the inverse of the one-at-a-time adds). Emptying BOTH
// arrays with no active exclude deletes the filter, same rule as clearCastPart.
function pruneCF(e) {
    const cf = e.characterFilter;
    if (cf && !(cf.names?.length) && !(cf.tags?.length) && !cf.isExclude) delete e.characterFilter;
}
export function removeCastName(e, value) {
    const cf = e.characterFilter; if (!cf?.names) return;
    cf.names = cf.names.filter(n => n !== value);
    pruneCF(e); scheduleSave();
}
export function removeCastTag(e, id) {
    const cf = e.characterFilter; if (!cf?.tags) return;
    cf.tags = cf.tags.filter(t => t !== id);
    pruneCF(e); scheduleSave();
}

// Scan overrides — null IS "inherit the global" (audit §18); a sub-field
// that is null simply isn't in the clause. Seeding depth mirrors the live
// global so the clause reads as an override you can then change.
export function seedScan(e, field) {
    if (field === 'depth') e.scanDepth = e.scanDepth ?? globalScanDepth();
    else if (field === 'wholeWords') e.matchWholeWords = e.matchWholeWords ?? true;
    else if (field === 'caseSensitive') e.caseSensitive = e.caseSensitive ?? true;
    scheduleSave();
}
export function setScanDepth(e, n) { e.scanDepth = Math.max(0, n | 0); scheduleSave(); }
export function flipScan(e, field) {
    if (field === 'wholeWords') e.matchWholeWords = !e.matchWholeWords;
    if (field === 'caseSensitive') e.caseSensitive = !e.caseSensitive;
    scheduleSave();
}
export function clearScan(e) {
    e.scanDepth = null; e.caseSensitive = null; e.matchWholeWords = null;
    scheduleSave();
}

// The six match* sources — plain bools, no inherit.
export function addSource(e, k)    { if (SOURCE_KEYS.includes(k)) { e[k] = true; scheduleSave(); } }
export function removeSource(e, k) { if (SOURCE_KEYS.includes(k)) { e[k] = false; scheduleSave(); } }
export function clearSources(e)    { for (const k of SOURCE_KEYS) e[k] = false; scheduleSave(); }

// ── Recursion (excludeRecursion · preventRecursion · delayUntilRecursion) ──
// Three ST fields shown as one clause. exclude/prevent are plain bools; delay
// is ST's tri-state false|true|number (true = level 1, number>=2 = that level).
// seedRecursion opens the clause with excludeRecursion on (a safe, common
// choice); clearRecursion turns all three off so the clause disappears.
export function seedRecursion(e) {
    if (!e.excludeRecursion && !e.preventRecursion
        && !(e.delayUntilRecursion === true || (typeof e.delayUntilRecursion === 'number' && e.delayUntilRecursion > 0))) {
        e.excludeRecursion = true;
    }
    scheduleSave();
}
export function setExcludeRecursion(e, on) { e.excludeRecursion = !!on; scheduleSave(); }
export function setPreventRecursion(e, on) { e.preventRecursion = !!on; scheduleSave(); }
/** Toggle delay on/off. On seeds level 1 (stored as `true`), off writes false. */
export function setDelayRecursion(e, on) {
    e.delayUntilRecursion = on ? (typeof e.delayUntilRecursion === 'number' && e.delayUntilRecursion > 1 ? e.delayUntilRecursion : true) : false;
    scheduleSave();
}
/** Set the delay LEVEL. Blank/1 → `true` (level 1); n>=2 → that number; only
 *  meaningful while delay is on. Never writes 0 (that's "off"). */
export function setDelayLevel(e, n) {
    const lvl = Math.max(1, Math.trunc(Number(n) || 1));
    e.delayUntilRecursion = lvl <= 1 ? true : lvl;
    scheduleSave();
}
export function clearRecursion(e) {
    e.excludeRecursion = false;
    e.preventRecursion = false;
    e.delayUntilRecursion = false;
    scheduleSave();
}

// ── Generation-type triggers ──────────────────────────────────────────────
// ST's `triggers` array. Empty = fires on ALL generation types; a non-empty
// list RESTRICTS to just those. Add/remove one at a time; clearing empties it
// back to "all". Values are validated against GENERATION_TRIGGERS.
export const GENERATION_TRIGGERS = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'];
function triggersOf(e) { return Array.isArray(e.triggers) ? e.triggers.filter(Boolean) : []; }
/** Open the clause with ALL types selected — an explicit, meaningful-but-
 *  unrestrictive start the user then narrows by removing types. (An empty
 *  list would read as "all" too, but wouldn't surface the line.) */
export function seedTriggers(e) {
    if (!triggersOf(e).length) e.triggers = [...GENERATION_TRIGGERS];
    scheduleSave();
}
export function addTrigger(e, t) {
    if (!GENERATION_TRIGGERS.includes(t)) return;
    const cur = triggersOf(e);
    if (!cur.includes(t)) { e.triggers = [...cur, t]; scheduleSave(); }
}
export function removeTrigger(e, t) {
    e.triggers = triggersOf(e).filter(x => x !== t);
    scheduleSave();
}
export function clearTriggers(e) { e.triggers = []; scheduleSave(); }

export function setAutomationId(e, v) { e.automationId = v; scheduleSave(); }
export function clearAutomationId(e)  { e.automationId = ''; scheduleSave(); }

// Alternates — group is a comma-split multi-membership string (engine truth).
function groupsOf(e) { return String(e.group || '').split(',').map(s => s.trim()).filter(Boolean); }
export function joinPool(e, name) {
    const g = groupsOf(e);
    const n = String(name).trim();
    if (!n || g.includes(n)) return;
    g.push(n);
    e.group = g.join(', ');
    if (e.groupWeight == null) e.groupWeight = 100;
    scheduleSave();
}
export function leavePool(e, name) {
    const g = groupsOf(e).filter(x => x !== name);
    e.group = g.join(', ');
    scheduleSave();
}
export function clearPools(e) { e.group = ''; scheduleSave(); }
export function toggleAltOverride(e) { e.groupOverride = !e.groupOverride; scheduleSave(); }
export function toggleAltScoring(e)  { e.useGroupScoring = e.useGroupScoring !== true; scheduleSave(); }
export function setAltWeight(e, n)   { e.groupWeight = Math.max(0, Math.trunc(Number(n) || 0)); scheduleSave(); }

// ============================================================
// Templates — starting points, not schema (language doc §7)
// ============================================================
// Applying one is the COMPLETE statement of its configuration: every
// template-owned control field resets to default first, THEN the preset
// applies. User-owned fields (title · content · topics · conditions · cast
// · takes-turns · rank · outlet NAME) are never touched.

function templateDefaults(e) {
    setModeFields(e, 'topic');
    e.ignoreBudget = false;
    e.sticky = null; e.cooldown = null; e.delay = null;
    e.probability = 100; e.useProbability = true;
    e.position = 1;   // charAfter — the placement resets; outletName survives
}
function setModeFields(e, mode) {
    if (mode === 'shelved') { e.disable = true; return; }
    e.disable = false;
    e.constant = (mode === 'always');
    e.vectorized = (mode === 'meaning');
}

export const TYPES = {
    'Core fact': { hint: 'canon that must never be forgotten \u00b7 sets: Always + never left out',
        preset: e => { setModeFields(e, 'always'); e.ignoreBudget = true; } },
    'Lore':      { hint: 'places, factions, history, items \u00b7 sets: On topic \u2014 the baseline, so applying it is also a clean reset',
        preset: () => {} },
    'Secret':    { hint: 'reveals, conditional knowledge \u00b7 sets: On topic (add conditions or a cast filter)',
        preset: () => {} },
    'Event':     { hint: 'festivals, deadlines, story arcs \u00b7 sets: On topic + waits 10, lingers 4',
        preset: e => { e.sticky = 4; e.delay = 10; } },
    'Direction': { hint: 'standing instructions to the AI \u00b7 sets: Always, slotted into the conversation as a system message',
        preset: e => { setModeFields(e, 'always'); e.position = 4; e.depth = 2; e.role = 0; } },
    'Flavor':    { hint: 'random texture, rumors, weather \u00b7 sets: On topic + 75% chance + a rest',
        preset: e => { e.probability = 75; e.useProbability = true; e.cooldown = 10; } },
};

/** Stamps the note's type (sidecar) and resets the template-owned ST fields.
 *  Re-applying the same template = reset-to-template. The type write goes to the
 *  sidecar (setNoteType); the field resets stay on the entry (scheduleSave). */
export function applyTemplate(e, t) {
    if (!TYPES[t]) return;
    setNoteType(openBookName(), e.uid, t);
    templateDefaults(e);
    TYPES[t].preset(e);
    scheduleSave();
}

// ============================================================
// Raw mechanics edits — grid keys ARE ST field names (the whole point)
// ============================================================

export function applyMechEdit(e, k, raw) {
    const numv = () => Math.trunc(Number(raw) || 0);
    const boolv = () => raw === true || raw === 'true';
    const listv = () => String(raw).split(',').map(s => s.trim()).filter(Boolean);
    switch (k) {
        case 'comment': e.comment = raw; break;
        case 'key': e.key = listv(); break;
        case 'keysecondary': {
            const terms = listv();
            e.keysecondary = terms;
            if (terms.length) e.selective = true;
            break;
        }
        case 'selectiveLogic': e.selectiveLogic = ((numv() % 4) + 4) % 4; break;
        case 'mode': setModeFields(e, raw); break;
        case 'order': e.order = numv(); break;
        case 'position': {
            const key = NUM_POS[numv()] || 'charAfter';
            e.position = POS_NUM[key];
            if (key === 'depth') { e.depth = e.depth ?? 4; e.role = e.role ?? 0; }
            if (key === 'outlet' && e.outletName == null) e.outletName = '';
            break;
        }
        case 'depth': e.depth = Math.max(0, numv()); break;
        case 'role': e.role = ((numv() % 3) + 3) % 3; break;
        case 'outletName': e.outletName = String(raw).trim(); break;
        case 'probability': e.probability = numv(); break;
        case 'useProbability': e.useProbability = boolv(); break;
        case 'sticky': e.sticky = numv() || null; break;
        case 'cooldown': e.cooldown = numv() || null; break;
        case 'delay': e.delay = numv() || null; break;
        case 'scanDepth': e.scanDepth = String(raw).trim() === '' ? null : Math.max(0, numv()); break;
        case 'caseSensitive': e.caseSensitive = raw === 'null' ? null : raw === 'true'; break;
        case 'matchWholeWords': e.matchWholeWords = raw === 'null' ? null : raw === 'true'; break;
        case 'cfNames': case 'cfTags': {
            const cf = e.characterFilter || { isExclude: false, names: [], tags: [] };
            cf[k === 'cfNames' ? 'names' : 'tags'] = listv();
            if (cf.names.length || cf.tags.length) e.characterFilter = cf;
            else delete e.characterFilter;
            break;
        }
        case 'cfExclude': if (e.characterFilter) e.characterFilter.isExclude = boolv(); break;
        case 'group': e.group = listv().join(', '); break;
        case 'groupWeight': e.groupWeight = Math.max(0, numv()); break;
        case 'groupOverride': e.groupOverride = boolv(); break;
        case 'useGroupScoring': e.useGroupScoring = raw === 'null' ? null : boolv(); break;
        case 'ignoreBudget': e.ignoreBudget = boolv(); break;
        case 'excludeRecursion': e.excludeRecursion = boolv(); break;
        case 'preventRecursion': e.preventRecursion = boolv(); break;
        case 'delayUntilRecursion': {
            // Raw tri-state: '' or 'false'/'0' → false; 'true' → true (level 1);
            // a number >= 2 → that level; 1 collapses to `true`.
            const s = String(raw).trim().toLowerCase();
            if (s === '' || s === 'false' || s === '0') e.delayUntilRecursion = false;
            else if (s === 'true') e.delayUntilRecursion = true;
            else { const n = Math.trunc(Number(raw) || 0); e.delayUntilRecursion = n <= 1 ? (n === 1 ? true : false) : n; }
            break;
        }
        case 'triggers': e.triggers = listv().filter(t => GENERATION_TRIGGERS.includes(t)); break;
        case 'automationId': e.automationId = String(raw).trim(); break;
        default: {
            if (SOURCE_KEYS.includes(k)) e[k] = boolv();
        }
    }
    scheduleSave();
}

// ============================================================
// Themed input popup — ST's, with a native fallback (v1's confirm pattern)
// ============================================================

export async function promptPopup(title, initial = '') {
    try {
        const { Popup } = ctx();
        const result = await Popup.show.input(title, null, initial);
        return (result == null || result === false) ? null : String(result);
    } catch {
        const r = prompt(title, initial);
        return r == null ? null : r;
    }
}
