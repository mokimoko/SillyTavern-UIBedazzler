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

import { lastReplyCapture } from './simData.js';

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
// Used tokens — count the activated entries from the last real reply with
// ST's tokenizer. The session capture includes every insertion position;
// itemizedPrompts.worldInfoString only contains before/after entries, so it
// can be empty even when depth/example/outlet entries were included. The
// persisted itemized prompt is a useful fallback when no session capture is
// available. Wait for script.js before reading either source: on first open
// its dynamic import may still be pending.
// ============================================================

let lastUsedTokens = null;   // cache; null = nothing counted yet this session
let onUsedChanged = null;    // meter poke, set while the drawer is open
let usedRefreshId = 0;

/** Synchronous read of the cached number (renderMeter stays sync). The
 *  cache is filled by refreshUsedTokens(), called on drawer open and after
 *  any recount. */
export function usedTokens() { return lastUsedTokens; }

/** Recompute from ST's last itemized prompt set, then poke the meter.
 *  Async (ST's tokenizer is async); safe to call and not await. */
export async function refreshUsedTokens() {
    const refreshId = ++usedRefreshId;
    let next = null;
    try {
        const script = await scriptPromise;
        const c = ctx();
        const count = c?.getTokenCountAsync;
        if (typeof count === 'function') {
            const live = lastReplyCapture();
            if (live?.complete && live.chatId != null && String(live.chatId) === String(c.chatId)) {
                // One tokenizer call keeps this cheap even with many entries.
                const contents = live.entries.map(entry => String(entry.content ?? '')).filter(Boolean).join('\n');
                const n = await count(contents);
                next = Number.isFinite(n) ? n : null;
            } else {
                const sets = script.itemizedPrompts;
                const chat = Array.isArray(c.chat) ? c.chat : [];
                const last = Array.isArray(sets) ? sets.findLast(set => {
                    const id = Number(set?.mesId);
                    return Number.isInteger(id) && id >= 0 && id < chat.length
                        && !chat[id]?.is_user && !chat[id]?.is_system;
                }) : null;
                // An empty before/after string does not prove that no notes
                // were used; they may all have gone to other positions.
                if (last?.worldInfoString) {
                    const n = await count(last.worldInfoString);
                    next = Number.isFinite(n) ? n : null;
                }
            }
        }
    } catch { /* no reliable count available */ }
    if (refreshId !== usedRefreshId) return;
    lastUsedTokens = next;
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
