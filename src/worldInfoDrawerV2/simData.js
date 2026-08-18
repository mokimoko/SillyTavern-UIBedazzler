// src/worldInfoDrawerV2/simData.js
// WI v2 Simulator — the ENGINE BRIDGE. Turns SillyTavern's own world-info
// scan into the two datasets the mock's simulator renders: what happened on
// the last real reply, and what WOULD happen against a pasted scene.
//
// LEAF MODULE. Imports nothing from sibling v2 modules (uses getContext()
// and a lazy world-info.js import). The view (sim.js) depends on this; this
// depends on nothing of ours — same one-way rule as subjectStore.js.
//
// WHY THIS IS REAL, NOT FIXTURES (the whole point of the pour):
// The mock typed its verdicts by hand. Every one of them, it turns out, maps
// to a fact ST's engine actually produces:
//   · WORLDINFO_SCAN_DONE fires after each scan loop (events.js) carrying
//     { new:{all,successful}, activated:{entries}, sortedEntries,
//       budget:{overflowed}, timedEffects, state:{loopCount} }.
//   · checkWorldInfo(chat, maxContext, isDryRun=true, globalScanData) is
//     EXPORTED and its dry-run mode returns the same activation set without
//     firing events or mutating chat state — a real dry run of the scene.
// So "came up / chained / dropped (share full) / rolled-and-missed /
// lingering-resting-waiting / always" are all read off the engine, not
// invented. Where a signal genuinely isn't knowable, the verdict says less
// rather than guessing (the §12 rule the mock's own comments keep citing).

const wiPromise = import('../../../../../../scripts/world-info.js');
const scriptPromise = import('../../../../../../script.js');
let wiMod = null, scriptMod = null;
wiPromise.then(m => { wiMod = m; }).catch(() => {});
scriptPromise.then(m => { scriptMod = m; }).catch(() => {});

const ctx = () => SillyTavern.getContext();

// Keywords are writer-authored free text and land inside the row's `why`
// HTML, so they MUST be escaped (a key like "<queen>" or "a & b" would
// otherwise break the row or inject markup). The verdict text around them is
// ours and safe; only the interpolated keys need this.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ============================================================
// Live capture — the last real generation (§ "what happened")
// ============================================================
// PRIMARY SIGNAL: WORLD_INFO_ACTIVATED (world-info.js:902, inside
// getWorldInfoPrompt). This is the RIGHT event for "what got included on the
// last reply", and the one ST's own consumers (and Nemo's world-info-ui) use:
//   · it fires ONLY on real generations — the emit is guarded `!isDryRun`, so
//     our scene tests can NEVER pollute it (the earlier WORLDINFO_SCAN_DONE
//     approach had no such guarantee — that event fires on dry runs too);
//   · its payload is a FLAT ARRAY of the activated entries —
//     `Array.from(allActivatedEntries.values())` — each carrying world, uid,
//     comment, key, content, constant, vectorized: everything the row mapper
//     needs;
//   · it fires once per generation (after the whole recursive scan settles),
//     when size > 0.
//
// The tradeoff vs the old scan-loop accumulation: WORLD_INFO_ACTIVATED gives
// the winners cleanly but NOT the "considered but dropped" set or per-loop
// chain tags. That's the SAME limitation the dry-run path already lives with and
// handles honestly, so the live path now mirrors it: real winners, no
// fabricated dropped/chain rows.
//
// SUPPLEMENT (best-effort): WORLDINFO_SCAN_DONE still runs during a real gen
// and DOES carry per-loop tags + a live timedEffects manager. When it lands
// inside a real generation we stash the latest as `scanAux`, and the mapper
// uses it to upgrade a winner to 'chain' or add a timing suffix IF the entry
// is present there. It's purely additive — if scanAux is missing or stale,
// the winner still renders from WORLD_INFO_ACTIVATED alone. Gated by
// inGeneration so a dry scan can't seed it.

let capture = null;       // { entries:[], complete } — last real activation, or null
let captureMsgs = null;   // { latest, window } — the chat text the scan read, or null
let scanAux = null;       // { firstSeenLoop:Map, timedEffects } from the live scan, or null
let pendingAux = null;    // scanAux under construction for the in-flight REAL gen
let inGeneration = false; // true between a REAL GENERATION_STARTED and its end
let gotActivationThisGen = false; // did WORLD_INFO_ACTIVATED fire this real gen?

const keyOf = e => `${e.world}\u0000${e.uid}`;

// GENERATION_STARTED fires as (type, options, dryRun) — script.js:4240. We
// must IGNORE dry-run starts entirely: sending one message spawns several
// generations (the real reply PLUS quiet/dry passes for WIAN, impersonation,
// etc.), and each one fires GENERATION_STARTED. The old handler nulled the
// capture on every start, so a background dry pass firing AFTER the real reply
// wiped the 31 entries before the view could read them — exactly the
// "captured 31 / hasLastReply:false" split we saw. Now: dry starts are
// no-ops, and even a real start does NOT destroy the last good capture — it
// only stages a fresh scanAux. The capture itself is replaced atomically when
// the new real activation actually lands (onWorldInfoActivated).
function onGenStart(_type, _opts, dryRun) {
    if (dryRun) return;                 // dry/quiet pass — must not disturb the live capture
    pendingAux = { firstSeenLoop: new Map(), timedEffects: null };
    inGeneration = true;
    gotActivationThisGen = false;
}

// Supplementary only — enrich, never gate. Accumulate first-seen loop + the
// latest timedEffects while a REAL generation is scanning (into pendingAux).
function onScanDone(args) {
    if (!inGeneration || !pendingAux) return;   // outside a real gen → ignore
    const loop = args?.state?.loopCount ?? 0;
    for (const e of (args?.new?.all ?? [])) {
        const k = keyOf(e);
        if (!pendingAux.firstSeenLoop.has(k)) pendingAux.firstSeenLoop.set(k, loop);
    }
    if (args?.timedEffects) pendingAux.timedEffects = args.timedEffects;
}

// Snapshot the chat text the scan just read, so the "what happened" tab can
// show the message(s) that triggered it (the left column). We take this at
// activation time — the honest moment the scan resolved — reading the live
// chat the same way the scan did: newest turn = `latest`, the rest of the
// depth window (older→newer, above it) = `window`. Depth 0 means the scan
// read nothing for topics, so there's no meaningful window to show; latest
// still stands as "the turn you sent". Each message is {name, mes, isUser}
// — plain data, escaped at render time in the view.
function snapshotMessages() {
    try {
        const c = ctx();
        const chatArr = Array.isArray(c?.chat) ? c.chat : [];
        if (!chatArr.length) return null;
        const pick = m => ({ name: String(m?.name ?? ''), mes: String(m?.mes ?? ''), isUser: !!m?.is_user });
        const latest = pick(chatArr[chatArr.length - 1]);
        // The window BEHIND the latest, bounded by the scan depth. depth counts
        // the messages the scan listened to INCLUDING the latest, so the tail
        // above it is (depth - 1). Clamp to what the chat actually holds.
        const depth = scanStateFor().depth;
        const tail = Math.max(0, depth - 1);
        const start = Math.max(0, chatArr.length - 1 - tail);
        const window = chatArr.slice(start, chatArr.length - 1).map(pick);
        return { latest, window };
    } catch { return null; }
}

// PRIMARY — the real activation set for this reply. arg is a flat array of
// entries. Fires only on real gens (world-info.js:902, guarded !isDryRun), so
// reaching here means a genuine reply just resolved. Replace the capture
// atomically (old one lived until this moment) and promote its scanAux.
function onWorldInfoActivated(arg) {
    const entries = Array.isArray(arg) ? arg : [];
    capture = { entries, complete: true };
    captureMsgs = snapshotMessages();   // the text the scan read, for the left column
    scanAux = pendingAux;   // promote the aux gathered during THIS gen's scan
    gotActivationThisGen = true;
    console.debug('[BD] WI v2 sim: captured last-reply activation —', entries.length, 'entries');
}

// GENERATION_ENDED passes (chat.length) and GENERATION_STOPPED passes nothing
// — NEITHER carries a dryRun flag (script.js:3510 / 5592), so we can't read it
// here. Instead we gate on `inGeneration`, which ONLY a real GENERATION_STARTED
// sets true (dry starts early-return before setting it). So if inGeneration is
// false when an end fires, this end belongs to a dry/quiet pass → ignore it
// entirely. That keeps a dry pass ending from ever resetting the live capture.
function onGenEnd() {
    if (!inGeneration) return;   // end of a dry/quiet pass (real starts set inGeneration) → ignore
    inGeneration = false;
    pendingAux = null;
    // A real generation with ZERO activations never fires WORLD_INFO_ACTIVATED
    // (size>0 guarded). If THIS real gen produced no activation event, record
    // an explicit empty capture so the view honestly says "nothing came up"
    // — replacing any stale prior capture. If it DID fire, we keep what
    // onWorldInfoActivated set (never overwrite a fresh good capture).
    if (!gotActivationThisGen) { capture = { entries: [], complete: true }; captureMsgs = snapshotMessages(); scanAux = null; }
}

// ============================================================
// Verdict mapping — engine facts → the mock's row vocabulary
// ============================================================
// The mock's row shape: { cls, mark, id, book, uid, tt, why, tok }.
//   cls   drives colour/style: 'always' | 'hit' | 'chain' | 'dropped' | 'waitish'
//   mark  the glyph (◉ always · ● topic · ∼ meaning · ↳ chain · ✕ dropped ·
//         ⏾ rolled-missed · ○ inert). Reused from listcol's MODE_GLYPH where
//         it's a mode; the trace adds chain/dropped/miss which are OUTCOMES.
//   id/book/uid  resolve click-through (open the note in its book).
//   tt    the note's title (comment → first key → untitled, listcol's rule).
//   why   the sentence. Kept to what the engine actually tells us.
//   tok   token count if we can get it, else '—'.
//
// TENSE: past ('came up') for the live source, conditional ('would be
// included') for the dry run. One mapper, a tense flag — the mock's rule that
// a verdict can't drift from its header.

const GLYPH = { always: '\u25c9', topic: '\u25cf', meaning: '\u223c',
    chain: '\u21b3', dropped: '\u2715', miss: '\u23fe', inert: '\u25cb' };

function titleOf(e) {
    if (e?.comment) return e.comment;
    const keys = Array.isArray(e?.key) ? e.key : [];
    if (keys.length) return keys[0];
    return 'untitled';
}

// The note's mode, ST truth → glyph seed (listcol's modeOf, inlined so this
// stays a leaf). Only used for the ACTIVATED rows; outcome rows override.
function modeGlyph(e) {
    if (e?.constant) return GLYPH.always;
    if (e?.vectorized) return GLYPH.meaning;
    return GLYPH.topic;
}

async function tokensOf(e) {
    try {
        const count = ctx()?.getTokenCountAsync;
        if (typeof count !== 'function' || e?.content == null) return '\u2014';
        const n = await count(String(e.content));
        return Number.isFinite(n) ? String(n) : '\u2014';
    } catch { return '\u2014'; }
}

/** Timing suffix ('lingering' / 'resting' / 'waiting'), or '' if none / if
 *  the effects manager isn't available (dry runs don't carry one). Honest:
 *  no manager → no timing claim. */
function timingNote(e, timedEffects) {
    if (!timedEffects || typeof timedEffects.isEffectActive !== 'function') return '';
    try {
        if (timedEffects.isEffectActive('sticky', e)) return ' It\u2019s <em>lingering</em> \u2014 set to stay in for a few more messages.';
        if (timedEffects.isEffectActive('cooldown', e)) return ' It\u2019s <em>resting</em> \u2014 it won\u2019t come back for a while.';
        if (timedEffects.isEffectActive('delay', e)) return ' It\u2019s <em>waiting</em> \u2014 held back until later in the chat.';
    } catch { /* fall through */ }
    return '';
}

// ============================================================
// Keyword clauses — honest per-path, inline in the why-sentence (§ mock A)
// ============================================================
// The matched keyword is NOT on the activated entry object — the engine only
// emits it to console.debug (which WorldInfoInfo scrapes; we don't, per the
// robustness rule). So the two paths say different, each-true things:
//   · LIVE  → we can't know WHICH key fired, only what the note was LISTENING
//             for. Clause: "Listening for a, b, c" (candidate keys).
//   · SCENE → we own the passage text, so we can re-check the keys against it
//             and name the ones that actually appear. Clause: "the passage
//             mentions x, y" (real matches).
// Vectorised notes have no keys at all → an explicit "by meaning" note so the
// absence reads as a fact, not a gap. Cap at 5 shown, "+N more" for the tail.
const KW_SHOWN = 5;

// ---- Scene-tab key matcher -------------------------------------------------
// The SCENE tab owns the passage text, so it can re-check a note's keys against
// it and name the ones that REALLY appear. This used to be a plain
// case-insensitive substring (`passageLower.includes(key)`), which misfired two
// ways: it ignored ST's whole-word setting (so "art" matched "start") and it
// treated an explicit /regex/ key as a literal string. This matcher mirrors
// ST's own literal-key logic (modeled on NemoPresetExt's re-implementation,
// since ST exports the SETTINGS but no reusable matcher): honor whole-word
// boundaries and case-sensitivity (per-entry override, else the global
// setting), and run true /regex/flags keys as regexes. It is still a
// re-implementation, NOT ST's activation engine — it does not model secondary/
// selective logic, probability, groups, recursion, or vectors. The SCENE tab
// only ever claims "which primary keys appear in this passage," so that scope
// is honest. DRY-safe: a pure function of (key, entry, passage) — no gen, no
// events — which is exactly why it can run on the scene tab at all.

const escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Read ST's global match settings off the (already-loaded) world-info module,
 *  falling back to ST's shipped defaults if the module isn't ready or the
 *  exports are absent: case-insensitive matching, whole-word matching ON. */
function globalMatchSettings() {
    return {
        caseSensitive: wiMod?.world_info_case_sensitive ?? false,
        wholeWords: wiMod?.world_info_match_whole_words ?? true,
    };
}

/** Build a RegExp for one key, or null if it can't be used. Mirrors ST:
 *  a key written /pattern/flags is run as a real regex; anything else is a
 *  literal, escaped, with \b word boundaries when whole-word matching is on
 *  AND the key edge is itself a word char (so a key like "(note)" or "-ish"
 *  isn't broken by a boundary that can never match). Per-entry caseSensitive /
 *  matchWholeWords win over the global setting. Invalid regex → null (skip). */
function keyToRegExp(keyword, entry, g) {
    const key = String(keyword);
    try {
        if (key.startsWith('/') && key.lastIndexOf('/') > 0) {
            const last = key.lastIndexOf('/');
            return new RegExp(key.slice(1, last), key.slice(last + 1));
        }
        const caseSensitive = entry?.caseSensitive ?? g.caseSensitive;
        const wholeWords = entry?.matchWholeWords ?? g.wholeWords;
        const escaped = escapeRegExp(key);
        const startB = wholeWords && /^\w/.test(key) ? String.raw`\b` : '';
        const endB = wholeWords && /\w$/.test(key) ? String.raw`\b` : '';
        return new RegExp(`${startB}${escaped}${endB}`, caseSensitive ? '' : 'i');
    } catch {
        return null; // malformed /regex/ — one bad key mustn't kill the scan
    }
}

/** HTML for a keyword list, escaped, capped at KW_SHOWN with a "+N more"
 *  tail. Each shown key is wrapped in <em> (the row's accent-for-quoted-text
 *  style). Returns '' for an empty list. */
function keyListHTML(keys) {
    const list = (Array.isArray(keys) ? keys : []).map(k => String(k).trim()).filter(Boolean);
    if (!list.length) return '';
    const shown = list.slice(0, KW_SHOWN).map(k => `<em>${esc(k)}</em>`).join(', ');
    const extra = list.length - KW_SHOWN;
    return extra > 0 ? `${shown} +${extra} more` : shown;
}

/** The LIVE-path clause: what the note was listening for (candidate keys), or
 *  the by-meaning note for a vectorised entry. Leading space so it appends to
 *  the verdict. '' when there's nothing honest to add (a keyed note with no
 *  keys is possible — e.g. constant-only — and simply says nothing). */
function listeningClause(e) {
    if (e?.vectorized) return ' <span class="wl-wi2-kw-meaning">Matched by meaning, not keywords.</span>';
    const kw = keyListHTML(e?.key);
    return kw ? ` <span class="wl-wi2-kw">Listening for ${kw}.</span>` : '';
}

/** The SCENE-path clause: which of the note's keys actually appear in the
 *  text the engine scanned (real matches, because we hold the text). Uses
 *  keyToRegExp so it honors ST's whole-word + case-sensitivity settings and
 *  runs /regex/ keys as regexes — not the old plain substring, which
 *  over-matched ("art" in "start") and mis-ran regex keys as literals.
 *  Collects EVERY matched key (no early break) so the clause names them all.
 *  Vectorised → by-meaning note. Falls back to the listening-for framing if
 *  nothing matched (a keyed winner with no visible key is odd but shouldn't
 *  claim a match).
 *
 *  `scanned` is whatever text the dry run actually fed the engine for THIS
 *  scope — the passage alone in 'passage' scope, or passage + in-depth history
 *  in 'chat' scope. So the clause always describes the same text the rows were
 *  computed from: no annotation gymnastics, the scope toggle does the work. */
function mentionsClause(e, scanned) {
    if (e?.vectorized) return ' <span class="wl-wi2-kw-meaning">Would match by meaning, not keywords.</span>';
    const keys = (Array.isArray(e?.key) ? e.key : []).map(k => String(k).trim()).filter(Boolean);
    const g = globalMatchSettings();
    const hit = keys.filter(k => {
        const re = keyToRegExp(k, e, g);
        try { return re ? re.test(scanned) : false; } catch { return false; }
    });
    if (hit.length) return ` <span class="wl-wi2-kw">The passage mentions ${keyListHTML(hit)}.</span>`;
    const kw = keyListHTML(keys);
    return kw ? ` <span class="wl-wi2-kw">Listening for ${kw}.</span>` : '';
}

// ============================================================
// PASSAGE SCOPE — engine-free keyword gate (§ "this passage only")
// ============================================================
// WHY THIS EXISTS (the bug it fixes): passage scope used to call the REAL
// checkWorldInfo on a one-line chat. That was never isolated — the engine
// unconditionally folds in constant entries, persona/character globals,
// min-activations skew, and (when on) recursion, so entries whose keywords
// are NOWHERE in the passage lit up anyway (e.g. an NSFW note keyed on
// explicit words firing on two bare names, because those words rode in on a
// constant persona block). That answered "what would the whole machine do",
// which is the CHAT scope's job — not "do these words, alone, trigger it".
//
// Nemo's passage preview sidesteps this by NOT calling the engine at all: it
// loads the active books and tests keywords against the text as a pure
// function. We do the same, but go one better than Nemo's primary-only check
// — we apply the FULL primary → secondary/selective-logic gate (the same gate
// world-info.js runs: a primary must match FIRST, then AND_ANY/NOT_ALL/
// NOT_ANY/AND_ALL decides on the secondaries). No constants injected, no
// globals, no recursion, no min-activations. Pure over (passage, active
// entries). DRY-safe by construction.
//
// SCOPE HONESTY (unchanged from Nemo's disclaimer): this models keyword
// activation only. It does NOT model probability rolls, groups, vector
// activation, timed effects, or budget overflow. Constants are shown honestly
// as "always in" (they don't depend on the passage) rather than hidden.

const KEY_LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };

/** Substitute {{user}}/{{char}} (and any other macros) in a key the same way
 *  the engine does before matching, so a key like "{{user}}" resolves to the
 *  persona name. Falls back to the raw key if substituteParams isn't loaded. */
function subKey(k) {
    const s = scriptMod?.substituteParams;
    try { return typeof s === 'function' ? s(String(k)) : String(k); }
    catch { return String(k); }
}

/** Does this single key appear in the passage? Honors ST whole-word /
 *  case-sensitivity / regex via keyToRegExp, after macro substitution. */
function keyHitsPassage(k, entry, g, passage) {
    const sub = subKey(k).trim();
    if (!sub) return false;
    const re = keyToRegExp(sub, entry, g);
    try { return re ? re.test(passage) : false; } catch { return false; }
}

/** The full engine-free activation verdict for ONE entry against the passage
 *  text alone. Mirrors world-info.js's gate order exactly:
 *    disabled / @@dont_activate         → never
 *    @@activate                         → always
 *    constant                           → always (passage-independent)
 *    no primary keys                    → never (nothing to match on)
 *    no primary key in passage          → never (the engine `continue`s here)
 *    no secondary keys                  → primary match is enough
 *    else                               → selective logic over secondaries
 *  Returns { active, constant } so the caller can class constants as 'always'.
 *  Vectorised entries have no keyword path — engine-free scope can't judge a
 *  vector match, so they're reported inert (active:false) and the row-builder
 *  notes "by meaning" separately if we ever surface them. */
function passageActivates(entry, passage, g) {
    if (entry?.disable) return { active: false, constant: false };
    const decos = Array.isArray(entry?.decorators) ? entry.decorators : [];
    if (decos.includes('@@dont_activate')) return { active: false, constant: false };
    if (decos.includes('@@activate')) return { active: true, constant: false };
    if (entry?.constant) return { active: true, constant: true };
    if (entry?.vectorized) return { active: false, constant: false };

    const primary = (Array.isArray(entry?.key) ? entry.key : []).map(k => String(k).trim()).filter(Boolean);
    if (!primary.length) return { active: false, constant: false };
    const primaryHit = primary.some(k => keyHitsPassage(k, entry, g, passage));
    if (!primaryHit) return { active: false, constant: false };

    const secondary = (Array.isArray(entry?.keysecondary) ? entry.keysecondary : [])
        .map(k => String(k).trim()).filter(Boolean);
    if (!secondary.length) return { active: true, constant: false };

    const logic = entry?.selectiveLogic ?? KEY_LOGIC.AND_ANY;
    const anyMatch = secondary.some(k => keyHitsPassage(k, entry, g, passage));
    const allMatch = secondary.every(k => keyHitsPassage(k, entry, g, passage));
    let active;
    switch (logic) {
        case KEY_LOGIC.AND_ANY: active = anyMatch; break;   // primary + at least one secondary
        case KEY_LOGIC.AND_ALL: active = allMatch; break;   // primary + all secondaries
        case KEY_LOGIC.NOT_ALL: active = !allMatch; break;  // primary + a secondary MISSING
        case KEY_LOGIC.NOT_ANY: active = !anyMatch; break;  // primary + NO secondary present
        default: active = anyMatch; break;
    }
    return { active, constant: false };
}

/** Engine-free passage scan: iterate the active merged entry set (the same
 *  set checkWorldInfo would build via getSortedEntries — global + character +
 *  chat + persona lore) and keep the ones the keyword gate activates against
 *  the passage ALONE. Rows mirror the dry-run shape/vocabulary. Constants are
 *  classed 'always'; keyed winners are 'hit' with the mentions/listening
 *  clause resolved against the same passage the gate used. */
async function runPassageScene(passage) {
    if (typeof wiMod?.getSortedEntries !== 'function') {
        return { rows: [], error: 'engine-unavailable', empty: false };
    }
    const g = globalMatchSettings();
    let entries;
    try { entries = await wiMod.getSortedEntries(); }
    catch (err) { console.error('[BD] WI v2 sim: passage scan failed to load entries:', err); return { rows: [], error: 'run-failed', empty: false }; }

    const rows = [];
    for (const e of (Array.isArray(entries) ? entries : [])) {
        const { active, constant } = passageActivates(e, passage, g);
        if (!active) continue;
        let cls, mark, why;
        if (constant) {
            cls = 'always'; mark = GLYPH.always;
            why = 'would be included \u2014 always, regardless of the passage.';
        } else {
            cls = 'hit'; mark = modeGlyph(e);
            why = 'would be included \u2014 its topics match the passage.';
            why += mentionsClause(e, passage);
        }
        rows.push({ cls, mark, id: e.uid, book: e.world, uid: e.uid,
            tt: titleOf(e), why, tok: await tokensOf(e) });
    }
    return { rows, error: null, empty: false };
}

// ============================================================
// Row assembly — the captured winners → the ordered rows
// ============================================================
// The live capture is a flat array of ACTIVATED entries (the winners), in the
// engine's insertion order (the order they went into the prompt). There is no
// "considered but dropped" set here — WORLD_INFO_ACTIVATED only carries the
// winners — so, like the dry-run source, we render the winners and let the
// view append its single inert "everything else" tail. Classification:
//   · constant                         → 'always'  (◉)
//   · first-seen loop >0 (from scanAux) → 'chain'   (↳) pulled in by recursion
//   · otherwise                        → 'hit'     (● topic / ∼ meaning)
// chain + timing come from scanAux when it's available for THIS capture; when
// it isn't, the winner still renders (just without the chain/linger nuance).

async function rowsFromEntries(entries, tense, aux) {
    const past = tense === 'past';
    const te = aux?.timedEffects ?? null;
    const seen = aux?.firstSeenLoop ?? null;
    const rows = [];
    for (const e of (entries ?? [])) {
        const loop = seen?.get?.(keyOf(e)) ?? 0;
        let cls, mark, why;
        if (e.constant) {
            cls = 'always'; mark = GLYPH.always;
            why = past ? 'came up \u2014 always included, regardless of the scene.'
                       : 'would be included \u2014 always, regardless of the passage.';
        } else if (loop > 0) {
            cls = 'chain'; mark = GLYPH.chain;
            why = past ? 'pulled in by another note \u2014 something already included mentioned it (a chain).'
                       : 'would be pulled in \u2014 another matching note mentions it (a chain).';
            why += listeningClause(e);
        } else {
            cls = 'hit'; mark = modeGlyph(e);
            const how = e.vectorized ? 'by meaning \u2014 it read as relevant' : 'its topics matched the scene';
            why = past ? `came up \u2014 ${how}.` : `would be included \u2014 ${how}.`;
            why += listeningClause(e);
        }
        why += timingNote(e, te);
        rows.push({ cls, mark, id: e.uid, book: e.world, uid: e.uid,
            tt: titleOf(e), why, tok: await tokensOf(e) });
    }
    return rows;
}

// ============================================================
// Public: the two sources
// ============================================================

/** Did we capture a completed real generation this session? A COMPLETE
 *  capture counts even if nothing activated — the view has an honest
 *  "nothing came up" state for that, which is the truth, not "no reply
 *  captured" (which would hide that the capture is working). */
export function hasLastReply() {
    return !!(capture && capture.complete);
}

/** Rows for "what happened last reply" — real, from the captured activation
 *  (WORLD_INFO_ACTIVATED), enriched by the same generation's scanAux. */
export async function lastReplyRows() {
    if (!capture) return [];
    return rowsFromEntries(capture.entries, 'past', scanAux);
}

/** The chat text the last captured scan read — for the "what happened" tab's
 *  left column. `{ latest, window }` where latest is the newest turn and
 *  window is the depth-window tail behind it (older→newer), or null if no
 *  capture happened yet or the chat was empty at capture time. Each message
 *  is { name, mes, isUser }; the view escapes them. Returns a snapshot taken
 *  at scan time — it does NOT re-read the live chat, so it stays true to what
 *  the scan actually saw even if the chat has moved on since. */
export function lastReplyMessages() {
    return captureMsgs;
}

/** Dry-run a pasted scene through ST's OWN engine (isDryRun=true → no chat
 *  state mutation; NOTE it DOES still emit WORLDINFO_SCAN_DONE — the live
 *  capture fences those out via inGeneration). Returns rows in the conditional
 *  tense.
 *
 *  `scope` decides what the engine scans — the two genuinely different
 *  questions the scene tab answers (the rows themselves differ, not just the
 *  wording):
 *    · 'passage' → ONLY the pasted text. "What does this passage trigger on
 *      its own?" A note keyed on something only in prior chat won't appear.
 *    · 'chat'    → the passage prepended to the REAL chat as the newest turn,
 *      the way script.js builds it. "What would this trigger in the actual
 *      conversation?" A note can catch on an in-depth prior turn. (Default,
 *      the original behavior.)
 *
 *  Builds its own rows inline (the winners only), the conditional twin of
 *  the live path. The dry run carries no timedEffects manager we can query
 *  per-entry (it lives inside checkWorldInfo and isn't returned), so timing
 *  suffixes are simply absent here — which is correct: timing depends on real
 *  chat history, and a dry run doesn't have one. The scene legend says so. */
export async function runDryScene(text, scope = 'chat') {
    const passage = String(text || '').trim();
    if (!passage) return { rows: [], error: null, empty: true };
    // PASSAGE scope: engine-free keyword gate over the passage ALONE. Does NOT
    // call checkWorldInfo — see runPassageScene's header for why the engine
    // path leaked constants/globals/recursion into a "this text only" answer.
    if (scope === 'passage') return runPassageScene(passage);
    if (!wiMod?.checkWorldInfo) return { rows: [], error: 'engine-unavailable', empty: false };
    try {
        const c = ctx();
        const maxContext = scriptMod?.getMaxContextSize?.() ?? 4096;
        const includeNames = document.querySelector('#world_info_include_names')?.checked;
        // CHAT scope only reaches here (passage scope returned above). Real
        // chat, most-recent-first (engine wants reverse order), passage
        // prepended as the newest turn — "what would this trigger in the
        // actual conversation?"
        const priorLines = (Array.isArray(c?.chat) ? c.chat : [])
            .map(x => includeNames ? `${x.name}: ${x.mes}` : x.mes)
            .reverse();
        const chatForWI = [passage, ...priorLines];
        // The text the engine actually scanned, for mentionsClause: passage +
        // the in-depth chat tail behind it (bounded by ST's depth). Keeps the
        // clause honest to the rows.
        const depth = scanStateFor().depth;
        const scannedText = depth <= 0
            ? passage
            : chatForWI.slice(0, depth).join('\n');
        const globalScanData = {
            personaDescription: '', characterDescription: '', characterPersonality: '',
            characterDepthPrompt: '', scenario: '', creatorNotes: '', trigger: 'normal',
        };
        const res = await wiMod.checkWorldInfo(chatForWI, maxContext, true, globalScanData);
        // checkWorldInfo returns { worldInfoBefore, worldInfoAfter, allActivatedEntries, ... }.
        // CAUTION: allActivatedEntries is a Map INTERNALLY but the return
        // statement converts it — `new Set(allActivatedEntries.values())`
        // (world-info.js ~5194) — and the empty-books early-return also hands
        // back a Set. Accept Set / Map / array; anything else reads as empty.
        const raw = res?.allActivatedEntries;
        const activatedList = raw instanceof Map ? [...raw.values()]
            : raw instanceof Set ? [...raw]
            : Array.isArray(raw) ? raw : [];
        // A dry run gives us the winners cleanly; the "considered but out" set
        // isn't returned, so the scene source shows what WOULD go in (the view
        // appends a single inert "everything else" tail). Honest: we render
        // exactly what the engine handed back. Loop tags aren't preserved in
        // the returned map, so chain-vs-direct can't be split here — both read
        // as "would be included"; the distinction is a live-source luxury.
        const rows = [];
        for (const e of activatedList) {
            let cls, mark, why;
            if (e.constant) { cls = 'always'; mark = GLYPH.always; why = 'would be included \u2014 always, regardless of the passage.'; }
            else {
                cls = 'hit'; mark = modeGlyph(e);
                const how = e.vectorized ? 'by meaning \u2014 it reads as relevant' : 'its topics match the passage';
                why = `would be included \u2014 ${how}.`;
                why += mentionsClause(e, scannedText);
            }
            rows.push({ cls, mark, id: e.uid, book: e.world, uid: e.uid, tt: titleOf(e), why, tok: await tokensOf(e) });
        }
        return { rows, error: null, empty: false };
    } catch (err) {
        console.error('[BD] WI v2 sim: dry run failed:', err);
        return { rows: [], error: 'run-failed', empty: false };
    }
}

// ============================================================
// Scan state — for the view's scanLine() (§9.36). Reads ST's controls
// directly (same truth topbarData writes), so the sentence tracks the real
// depth/mode. Kept here rather than importing topbarData so simData stays a
// leaf; it's four number reads, not worth a cross-module edge.
// ============================================================
export function scanStateFor() {
    const num = sel => { const e = document.querySelector(sel); return e ? (parseFloat(e.value) || 0) : 0; };
    const minActs = num('#world_info_min_activations');
    const recursive = !!document.querySelector('#world_info_recursive')?.checked;
    return {
        depth: num('#world_info_depth'),
        mode: recursive ? 'recurse' : (minActs > 0 ? 'minact' : 'plain'),
        minActs: minActs || 3,
        minActsDepthMax: num('#world_info_min_activations_depth_max'),
    };
}

// ============================================================
// Lifecycle — SESSION-SCOPED capture (subscribe once, at extension init)
// ============================================================
// The capture MUST run independently of the drawer. Sending a message requires
// the drawer CLOSED (the overlay covers the chat), so a generation can only
// ever fire while the drawer is down. If we subscribed at drawer-open and
// unsubscribed at close (the original design), we'd be listening at exactly
// the one time no reply can happen, and never listening when one can — so the
// "what happened last reply" source could never populate. That was the bug.
//
// Subscribe once while the feature is enabled. Drawer open/close does not
// affect capture, but turning Expanded World Info off removes the listeners.
// Idempotence prevents duplicate subscriptions across toggle cycles.

let subs = [];
let captureStarted = false;
let captureWanted = false;
let captureEventSource = null;
let retryTimer = null;

/** Subscribe to the engine's generation/scan events while enabled.
 *  Idempotent. Retries if the context isn't
 *  ready yet (some ST init orders call extension init before getContext() is
 *  fully populated — a silent early-return there would leave capture dead for
 *  the whole session, which is exactly the failure we're chasing). */
export function startSimCapture(_attempt = 0) {
    captureWanted = true;
    if (captureStarted) return;
    if (_attempt === 0 && retryTimer) return;
    const c = ctx();
    const es = c?.eventSource, et = c?.event_types;
    if (!es || !et || !et.WORLD_INFO_ACTIVATED) {
        if (_attempt < 40 && captureWanted) {
            retryTimer = setTimeout(() => {
                retryTimer = null;
                if (captureWanted) startSimCapture(_attempt + 1);
            }, 250);
            return;
        }
        console.warn('[BD] WI v2 sim capture: context/events never became ready — capture disabled');
        return;
    }
    const on = (type, fn) => {
        if (!type) { console.warn('[BD] WI v2 sim capture: missing event type, one listener skipped'); return; }
        es.on(type, fn); subs.push([type, fn]);
    };
    on(et.GENERATION_STARTED, onGenStart);
    on(et.WORLD_INFO_ACTIVATED, onWorldInfoActivated);   // PRIMARY: real winners, dry-run-safe
    on(et.WORLDINFO_SCAN_DONE, onScanDone);              // supplement: chain/timing enrichment
    on(et.GENERATION_ENDED, onGenEnd);
    on(et.GENERATION_STOPPED, onGenEnd);
    captureEventSource = es;
    captureStarted = true;
    console.debug(`[BD] WI v2 sim capture armed (WORLD_INFO_ACTIVATED, r4, attempt ${_attempt}) — listeners:`, subs.length);
}

/** Stop all session listeners when Expanded World Info is disabled. Captured
 * data stays in memory so re-enabling can still show the last known reply. */
export function stopSimCapture() {
    captureWanted = false;
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    if (captureEventSource) {
        for (const [type, fn] of subs) {
            try { captureEventSource.removeListener(type, fn); } catch { /* best effort */ }
        }
    }
    subs = [];
    captureEventSource = null;
    captureStarted = false;
    inGeneration = false;
    pendingAux = null;
    gotActivationThisGen = false;
}

// Drawer close must not stop capture — replies happen while the overlay is
// down. The settings toggle calls stopSimCapture when the feature is disabled.
export function initSimData() { /* session capture owns subscriptions now */ }
export function teardownSimData() { /* capture survives drawer close on purpose */ }
