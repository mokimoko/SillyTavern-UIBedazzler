// src/worldInfoDrawerV2/topbarData.js
// WI v2 topbar — the ST field layer for the GLOBAL settings the topbar
// owns (§9.36's two categories): budget (how much room the notes get) and
// scan (how far back it listens, what counts as a match). Strategy lives
// in the rail; nine globals, three homes, nothing left over.
//
// WRITE PATH — v1's, verbatim in spirit (presets.js SETTINGS_MAP): every
// write pushes the value into ST's own hidden control and fires
// input+change, so ST's handlers persist it and update the world_info_*
// exports. We hold NO copy of these values; every read is a fresh read of
// the control (the one source of truth both UIs and the presets share).
//
// THE INTERLOCK (audit §18): ST enforces min-activations vs recursion with
// two input handlers that zero each other. We present it as one choice
// ('plain' | 'minact' | 'recurse') and derive the zeroes at the boundary:
//   plain   -> minActivations 0, recursive false, maxRecursionSteps 0
//   minact  -> minActivations N, recursive false, maxRecursionSteps 0
//   recurse -> minActivations 0, recursive true,  maxRecursionSteps N
// Zeroes are written FIRST and the target field LAST, so ST's own
// mutual-zeroing handlers fire against already-zeroed fields instead of
// clobbering the value we just set.
//
// Numbers survive mode flips in module memory (a writer who flips back
// shouldn't retype them) — memory of the UI, never a second truth: what
// ST stores is always exactly the projection above.

// getMaxContextSize is script.js's own answer to "how big is the AI's
// attention right now" (the same number world-info.js is handed as
// maxContext, audit §8). Resolved async like editorData's world-info
// import; until it lands — or if the export ever moves — attention()
// returns null and the meter says so instead of inventing a number.
const scriptPromise = import('../../../../../../script.js');
let scriptMod = null;
scriptPromise.then(m => { scriptMod = m; }).catch(() => {});

const ctx = () => SillyTavern.getContext();

// ============================================================
// ST controls — the truth we read and write (v1's SETTINGS_MAP subset)
// ============================================================

const CTL = {
    depth:           '#world_info_depth',
    budget:          '#world_info_budget',
    budgetCap:       '#world_info_budget_cap',
    minActivations:  '#world_info_min_activations',
    minActsDepthMax: '#world_info_min_activations_depth_max',
    recurseSteps:    '#world_info_max_recursion_steps',
    recursive:       '#world_info_recursive',
    caseSensitive:   '#world_info_case_sensitive',
    wholeWords:      '#world_info_match_whole_words',
    includeNames:    '#world_info_include_names',
    overflowAlert:   '#world_info_overflow_alert',
};

const el = k => document.querySelector(CTL[k]);
const readNum = k => { const e = el(k); return e ? (parseFloat(e.value) || 0) : 0; };
const readBool = k => { const e = el(k); return e ? !!e.checked : false; };

/** The one write: push into ST's control, fire its handlers (v1's path). */
function writeST(k, value, isBool) {
    const e = el(k);
    if (!e) return;
    if (isBool) e.checked = !!value; else e.value = value;
    if (typeof $ !== 'undefined') $(e).trigger('input').trigger('change');
    else {
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

// ============================================================
// Scan — one choice + its numbers
// ============================================================

// UI memory for mode flips (never a second truth — see header).
let lastMinActs = null, lastMinActsDepthMax = null, lastRecurseSteps = null;

/** Mode derivation from ST truth. Recursive wins if both are somehow set
 *  (ST's own zeroing makes that transient, but reads must still answer). */
export function scanState() {
    const minActs = readNum('minActivations');
    const recursive = readBool('recursive');
    const mode = recursive ? 'recurse' : (minActs > 0 ? 'minact' : 'plain');
    return {
        depth: readNum('depth'),
        mode,
        minActs: minActs || lastMinActs || 3,
        minActsDepthMax: readNum('minActsDepthMax') || lastMinActsDepthMax || 0,
        recurseSteps: readNum('recurseSteps') || lastRecurseSteps || 2,
        caseSensitive: readBool('caseSensitive'),
        wholeWords: readBool('wholeWords'),
        includeNames: readBool('includeNames'),
    };
}

export function setScanDepthGlobal(n) {
    writeST('depth', Math.min(1000, Math.max(0, Math.round(Number(n) || 0))));
}

/** The interlock boundary: zeroes first, target last (see header). */
export function setScanMode(mode) {
    const cur = scanState();
    if (cur.mode === 'minact') { lastMinActs = cur.minActs; lastMinActsDepthMax = cur.minActsDepthMax; }
    if (cur.mode === 'recurse') { lastRecurseSteps = cur.recurseSteps; }
    if (mode === 'plain') {
        writeST('recursive', false, true);
        writeST('recurseSteps', 0);
        writeST('minActivations', 0);
    } else if (mode === 'minact') {
        writeST('recursive', false, true);
        writeST('recurseSteps', 0);
        writeST('minActsDepthMax', cur.minActsDepthMax);
        writeST('minActivations', cur.minActs);
    } else if (mode === 'recurse') {
        writeST('minActivations', 0);
        writeST('recursive', true, true);
        writeST('recurseSteps', cur.recurseSteps);
    }
}

/** Field writes for the numbers/checks inside the scan popover. */
export function setScanField(field, value) {
    if (field === 'minActs') {
        const n = Math.min(50, Math.max(1, Math.round(Number(value) || 1)));
        lastMinActs = n;
        writeST('minActivations', n);
    } else if (field === 'minActsDepthMax') {
        const n = Math.min(1000, Math.max(0, Math.round(Number(value) || 0)));
        lastMinActsDepthMax = n;
        writeST('minActsDepthMax', n);
    } else if (field === 'recurseSteps') {
        const n = Math.min(10, Math.max(0, Math.round(Number(value) || 0)));
        lastRecurseSteps = n;
        writeST('recurseSteps', n);
    } else if (field === 'wholeWords' || field === 'caseSensitive' || field === 'includeNames') {
        writeST(field, !!value, true);
    }
}

// ============================================================
// Budget — the notes' share
// ENGINE, VERIFIED (world-info.js ~4656):
//   let budget = Math.round(world_info_budget * maxContext / 100) || 1;
//   if (cap > 0 && budget > cap) budget = cap;
// ============================================================

export function budgetState() {
    return {
        pct: readNum('budget'),
        cap: readNum('budgetCap'),
        warn: readBool('overflowAlert'),
    };
}

export function setBudgetPct(n) {
    writeST('budget', Math.min(100, Math.max(1, Math.round(Number(n) || 25))));
}
export function setBudgetCap(n) {
    writeST('budgetCap', Math.max(0, Math.round(Number(n) || 0)));
}
export function setBudgetWarn(on) { writeST('overflowAlert', !!on, true); }

/** The AI's attention — per-generation, NOT a WI setting (audit §8).
 *  null until script.js resolves (or if the export moves): honesty over
 *  an invented number. */
export function attention() {
    try { return scriptMod?.getMaxContextSize?.() ?? null; }
    catch { return null; }
}

/** ST's formula, ours only as a projection for the meter. */
export function effectiveBudget() {
    const att = attention();
    const { pct, cap } = budgetState();
    if (att == null) return cap > 0 ? cap : null;   // best honest bound
    const fromPct = Math.round(pct * att / 100) || 1;
    return (cap > 0 && fromPct > cap) ? cap : fromPct;
}

// ============================================================
// Used tokens — ST's OWN number, the one its prompt viewer shows.
//
// Every generation, ST pushes an itemized prompt set onto its exported
// `itemizedPrompts` array (script.js), keyed by mesId, and among the fields
// is `worldInfoString`: the FULL assembled WI block that actually went into
// the prompt. ST's own itemizer counts it with `worldInfoStringTokens:
// getTokenCountAsync(worldInfoString)` (itemized-prompts.js). We do the
// EXACT same thing — read the last set's worldInfoString, run ST's real
// tokenizer over it — so our meter and ST's viewer can never disagree.
//
// WHY THIS BEATS the old WORLD_INFO_ACTIVATED + per-entry-sum approach:
//  - It's ST's real tokenizer over the real assembled block (join chars,
//    separators and all), not our chars/3.5 estimate over separate entries.
//  - It needs no live event. itemizedPrompts PERSISTS on the array (and is
//    saved per chat), so the meter reads the last gen's number whenever the
//    drawer opens — the modal-drawer "you can't gen while open" problem just
//    doesn't apply. Backfill is free: open after a gen from an hour ago and
//    the number's still there.
// The total is all the meter needs; per-entry counts already live in the
// editor and in ST's native WI drawer, so there's nothing to reconstruct.
//
// getTokenCountAsync comes from the context (st-context exposes it);
// itemizedPrompts comes from the script.js module we already imported for
// getMaxContextSize. Either being unreadable → usedTokens() stays null and
// the meter honestly says "up to N" instead of inventing a fill.
// ============================================================

let lastUsedTokens = null;   // cache; null = nothing counted yet this session
let onUsedChanged = null;    // meter poke, set while the drawer is open

/** Synchronous read of the cached number (renderMeter stays sync). The
 *  cache is filled by refreshUsedTokens(), called on drawer open and after
 *  any recount. */
export function usedTokens() { return lastUsedTokens; }

/** Recompute from ST's last itemized prompt set, then poke the meter.
 *  Async (ST's tokenizer is async); safe to call and not await. */
export async function refreshUsedTokens() {
    try {
        const sets = scriptMod?.itemizedPrompts;
        const last = Array.isArray(sets) && sets.length ? sets[sets.length - 1] : null;
        const wiString = last?.worldInfoString;
        const count = ctx()?.getTokenCountAsync;
        if (wiString == null || typeof count !== 'function') {
            // No gen recorded yet, or tokenizer unreachable — honest null.
            lastUsedTokens = null;
        } else {
            const n = await count(wiString);
            lastUsedTokens = Number.isFinite(n) ? n : null;
        }
    } catch { lastUsedTokens = null; }
    onUsedChanged?.();
}

/** Drawer open: register the meter poke and kick a fresh count of the last
 *  generation's WI. The read is cheap and always current — no listener, no
 *  teardown race, no dependence on an event that can't fire while we're the
 *  active view. */
export function initTopbarData(usedChangedCb) {
    onUsedChanged = usedChangedCb || null;
    refreshUsedTokens();   // fire-and-forget; pokes the meter when it lands
}

export function teardownTopbarData() {
    onUsedChanged = null;
    // lastUsedTokens survives on purpose: reopening shows the last gen's
    // number immediately, and initTopbarData re-reads for anything newer.
}
