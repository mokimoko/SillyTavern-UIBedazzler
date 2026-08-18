// src/worldInfoDrawerV2/topbar.js
// WI v2 topbar — budget meter, scan popover, engine-terms toggle. Port of
// the mock's renderMeter / renderScan / eng-toggle (wi-v2-mockup.html
// ~906-943 markup, ~3040-3160 JS) over topbarData's ST truth.
//
// Mock invariants carried over:
//  - The meter IS the control (click opens the budget popover).
//  - The scan button always states the depth — the same number the
//    simulator will quote, so control and claim are visibly one value.
//  - The interlock is a radio group, not two fields that zero each other.
//  - Depth 0 earns the one caveat (§9.13): silent no-match, said in red.
//  - "messages, not exchanges" heads off the counting misread (§9.36).
//
// DELIBERATE divergences from the mock (each an honesty upgrade, §9.33):
//  - The fill is REAL: WORLD_INFO_ACTIVATED's entries, honestly estimated
//    (~chars/3.5). Before any generation the label says "up to N tokens"
//    and the bar sits empty — the mock painted a demo 1,400.
//  - The AI's attention is the live getMaxContextSize(); when it can't be
//    read the label falls back to the % claim alone, no invented total.
//  - Popovers get a ONE-per-init document closer (the editor's pattern),
//    not the mock's page-lifetime listener.
//
// The eng toggle flips body.wl-wi2-show-eng — the class contract the
// editor pour set. It stays on the body across open/close (the selectors
// are all scoped under #wl-wi2-root, so it's inert while closed and the
// writer's choice survives the session).

import {
    scanState, setScanDepthGlobal, setScanMode, setScanField,
    budgetState, setBudgetPct, setBudgetCap, setBudgetWarn,
    attention, effectiveBudget, usedTokens,
    initTopbarData, teardownTopbarData,
} from './topbarData.js';
// Lorebook toolbar (New · Rename · Duplicate · Export · Import · Delete). The
// per-book actions target the validated rail selection; New + Import are
// library-wide.
// The rail↔topbar imports are mutual (rail pulls refreshTopbar from here) but
// function-level only, so ESM resolves the cycle.
import {
    newBook, importBook, renameBook, duplicateBook, exportBook, deleteBook,
} from './bookActions.js';
import { getOpenBookName, hasOpenBookSelection, onOpenBookChanged } from './rail.js';

const log = () => {};

let root = null;   // the .wl-wi2-meter-wrap while open

const fmt = n => Number(n).toLocaleString();

// ============================================================
// Budget meter + popover
// ============================================================

function renderMeter() {
    if (!root) return;
    const att = attention();
    const { pct, cap, warn } = budgetState();
    const eff = effectiveBudget();
    const used = usedTokens();

    // Label states, most honest phrasing that fits what we actually know:
    //   used + eff  → "~1,400 / 2,250 tokens — the notes' share"
    //   eff only    → "up to 2,250 tokens — the notes' share"
    //   neither     → "25% of the AI's attention — the notes' share"
    let label;
    if (eff != null && used != null) label = `<b>~${fmt(used)}</b> / ${fmt(eff)} tokens \u2014 the notes\u2019 share`;
    else if (eff != null) label = `up to <b>${fmt(eff)}</b> tokens \u2014 the notes\u2019 share`;
    else label = `<b>${pct}%</b> of the AI\u2019s attention \u2014 the notes\u2019 share`;
    root.querySelector('#wl-wi2-meterLabel').innerHTML = label;

    const fill = (eff != null && used != null)
        ? Math.min(100, Math.round(used / eff * 100)) : 0;
    root.querySelector('#wl-wi2-meterFill').style.width = fill + '%';

    // The popover's derived note
    const fromPct = att != null ? (Math.round(pct * att / 100) || 1) : null;
    const capped = att != null && cap > 0 && fromPct > cap;
    const note = capped
        ? `${pct}% of ${fmt(att)} would be ${fmt(fromPct)} \u2014 the limit trims it to <b>${fmt(eff)}</b>.`
        : (eff != null ? `That\u2019s <b>${fmt(eff)}</b> tokens right now.` : '');
    const attLine = att != null
        ? `<span class="wl-wi2-bp-warn">The AI\u2019s attention holds ${fmt(att)} tokens \u2014 that\u2019s your API setting, not this one. Change it and this moves with it.</span>`
        : `<span class="wl-wi2-bp-warn">The AI\u2019s attention (your API\u2019s context size) couldn\u2019t be read just now \u2014 the share still applies, it just can\u2019t be shown as a number here.</span>`;
    root.querySelector('#wl-wi2-bpNote').innerHTML = note + ' ' + attLine;

    root.querySelector('#wl-wi2-bpPct').value = pct;
    root.querySelector('#wl-wi2-bpCap').value = cap;
    root.querySelector('#wl-wi2-bpWarn').checked = warn;
}

// ============================================================
// Scan popover — mock's renderScan over the live globals
// ============================================================

const SCAN_MODES = {
    plain: {
        label: 'Just listen that far back',
        sub: 'One pass over the scene. Nothing deepens, nothing chains.',
    },
    minact: {
        label: 'If too little comes up, listen further back',
        sub: 'Keeps stepping one message deeper until enough notes are found.',
    },
    recurse: {
        label: 'Let notes pull in other notes',
        sub: 'What a note says can trigger another note, a few rounds deep.',
    },
};

function renderScan() {
    if (!root) return;
    const s = scanState();
    const d = s.depth;
    root.querySelector('#wl-wi2-scanBtnLabel').textContent =
        d === 0 ? 'listening: off' : `last ${d} ${d === 1 ? 'message' : 'messages'}`;

    const modes = Object.entries(SCAN_MODES).map(([k, m]) => {
        let sub = '';
        if (k === 'minact' && s.mode === 'minact') {
            sub = `<div class="wl-wi2-sp-sub">Until <input class="wl-wi2-slot-input" data-scan="minActs" type="number" min="1" max="50" value="${s.minActs}" style="width: 4ch"> notes are found, going no deeper than <input class="wl-wi2-slot-input" data-scan="minActsDepthMax" type="number" min="0" max="1000" value="${s.minActsDepthMax}" style="width: 5ch"> messages <span class="wl-wi2-bp-hint">(0 = as deep as the chat)</span></div>`;
        }
        if (k === 'recurse' && s.mode === 'recurse') {
            sub = `<div class="wl-wi2-sp-sub">Up to <input class="wl-wi2-slot-input" data-scan="recurseSteps" type="number" min="1" max="10" value="${s.recurseSteps}" style="width: 4ch"> rounds <span class="wl-wi2-bp-hint">(0 = no limit)</span></div>`;
        }
        return `<button class="wl-wi2-sp-mode ${s.mode === k ? 'on' : ''}" data-scanmode="${k}">
            <span class="wl-wi2-sp-radio"></span>
            <span>${m.label}<small>${m.sub}</small></span>
        </button>${sub}`;
    }).join('');

    // Only the depth-0 trap earns a caveat here (§9.13). "messages, not
    // exchanges" is the misread to head off — VERIFIED (script.js ~4565):
    // one chatForWI element per non-system message, no pairing anywhere.
    const note = d === 0
        ? `<span class="wl-wi2-sp-danger">At 0 the scene isn\u2019t read at all \u2014 no note can come up by topic. Only <b>Always</b> notes are included.</span>`
        : `That\u2019s <b>${d}</b> ${d === 1 ? 'message' : 'messages'}, not ${d === 1 ? 'one exchange' : `${d} exchanges`} \u2014 each reply counts on its own. A single note can listen differently \u2014 add <b>\u201cListen differently\u201d</b> to it from its own <b>+ add</b> menu.`;

    root.querySelector('#wl-wi2-scanPop').innerHTML = `
        <div class="wl-wi2-bp-line">Listen to the last
            <input class="wl-wi2-slot-input" data-scan="depth" type="number" min="0" max="1000" value="${d}" style="width: 5ch">
            messages of the scene<span class="wl-wi2-eng">scan depth</span></div>
        <div class="wl-wi2-bp-note">${note}</div>
        <div class="wl-wi2-sp-sep"></div>
        <div class="wl-wi2-sp-head">When the scene runs dry</div>
        <div class="wl-wi2-sp-modes">${modes}</div>
        <div class="wl-wi2-sp-sep"></div>
        <div class="wl-wi2-sp-head">What counts as a match</div>
        <div class="wl-wi2-sp-rules">
            <label class="wl-wi2-bp-check" style="border: 0; margin: 0; padding: 3px 0;"><input type="checkbox" data-scan="wholeWords" ${s.wholeWords ? 'checked' : ''}> \u201cdragon\u201d won\u2019t match \u201cdragonfly\u201d<span class="wl-wi2-eng">match whole words</span></label>
            <label class="wl-wi2-bp-check" style="border: 0; margin: 0; padding: 3px 0;"><input type="checkbox" data-scan="caseSensitive" ${s.caseSensitive ? 'checked' : ''}> Capitalization matters<span class="wl-wi2-eng">case sensitive</span></label>
            <label class="wl-wi2-bp-check" style="border: 0; margin: 0; padding: 3px 0;"><input type="checkbox" data-scan="includeNames" ${s.includeNames ? 'checked' : ''}> Speaker names count as part of the scene<span class="wl-wi2-eng">include names</span></label>
        </div>`;
}

// ============================================================
// Shell + wiring — delegated (renderScan replaces the popover's innards,
// so handlers bound to old nodes would die with them — mock's own note)
// ============================================================

function closeTopbarPops() {
    if (!root) return;
    root.querySelectorAll('.wl-wi2-budget-pop.open, .wl-wi2-scan-pop.open')
        .forEach(p => p.classList.remove('open'));
}

function docClick() { closeTopbarPops(); }

function buildTopbar() {
    root.innerHTML = `
        <button class="wl-wi2-meter-btn" id="wl-wi2-budgetBtn" title="How much room the notes get \u2014 click to change it">
            <span class="wl-wi2-meter-label" id="wl-wi2-meterLabel"></span>
            <div class="wl-wi2-meter"><div class="wl-wi2-meter-fill" id="wl-wi2-meterFill"></div></div>
        </button>
        <div class="wl-wi2-budget-pop" id="wl-wi2-budgetPop">
            <div class="wl-wi2-bp-line">The notes\u2019 share is up to
                <input class="wl-wi2-slot-input" id="wl-wi2-bpPct" type="number" min="1" max="100" style="width: 5ch">
                % of the AI\u2019s attention<span class="wl-wi2-eng">world_info_budget</span></div>
            <div class="wl-wi2-bp-line">\u2026but never more than
                <input class="wl-wi2-slot-input" id="wl-wi2-bpCap" type="number" min="0" step="50" style="width: 8ch">
                tokens <span class="wl-wi2-bp-hint">(0 = no limit)</span><span class="wl-wi2-eng">world_info_budget_cap</span></div>
            <div class="wl-wi2-bp-note" id="wl-wi2-bpNote"></div>
            <label class="wl-wi2-bp-check"><input type="checkbox" id="wl-wi2-bpWarn"> Warn me when notes don\u2019t fit<span class="wl-wi2-eng">overflow alert</span></label>
        </div>
        <button class="wl-wi2-scan-btn" id="wl-wi2-scanBtn" title="How far back it listens, and what counts as a match">
            <i class="fa-solid fa-ear-listen"></i><span id="wl-wi2-scanBtnLabel"></span>
        </button>
        <div class="wl-wi2-scan-pop" id="wl-wi2-scanPop"></div>
        <button class="wl-wi2-eng-toggle" id="wl-wi2-engToggle" title="Reveal SillyTavern\u2019s engine terms under every label">&lt;/&gt; engine terms</button>
        <div class="wl-wi2-book-actions" id="wl-wi2-bookActions">
            <button class="wl-wi2-ba-btn" data-ba-action="new" title="New lorebook"><i class="fa-solid fa-plus"></i></button>
            <button class="wl-wi2-ba-btn" data-ba-action="rename" data-needs-book title="Rename the open lorebook"><i class="fa-solid fa-pen"></i></button>
            <button class="wl-wi2-ba-btn" data-ba-action="duplicate" data-needs-book title="Duplicate the open lorebook"><i class="fa-solid fa-clone"></i></button>
            <button class="wl-wi2-ba-btn" data-ba-action="export" data-needs-book title="Export the open lorebook"><i class="fa-solid fa-file-export"></i></button>
            <button class="wl-wi2-ba-btn" data-ba-action="import" title="Import a lorebook"><i class="fa-solid fa-file-import"></i></button>
            <button class="wl-wi2-ba-btn wl-wi2-ba-danger" data-ba-action="delete" data-needs-book title="Delete the open lorebook"><i class="fa-solid fa-trash"></i></button>
        </div>
    `;
}

function wireTopbar() {
    const $id = id => root.querySelector('#' + id);
    const budgetPop = $id('wl-wi2-budgetPop');
    const scanPop = $id('wl-wi2-scanPop');

    // Openers toggle their own pop, close the other; bodies swallow clicks.
    $id('wl-wi2-budgetBtn').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const was = budgetPop.classList.contains('open');
        closeTopbarPops();
        if (!was) budgetPop.classList.add('open');
    });
    $id('wl-wi2-scanBtn').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const was = scanPop.classList.contains('open');
        closeTopbarPops();
        if (!was) scanPop.classList.add('open');
    });
    budgetPop.addEventListener('click', ev => ev.stopPropagation());
    scanPop.addEventListener('click', ev => ev.stopPropagation());

    // Budget fields — static nodes, direct handlers are fine.
    $id('wl-wi2-bpPct').addEventListener('change', function () {
        setBudgetPct(this.value); renderMeter();
    });
    $id('wl-wi2-bpCap').addEventListener('change', function () {
        setBudgetCap(this.value); renderMeter();
    });
    $id('wl-wi2-bpWarn').addEventListener('change', function () {
        setBudgetWarn(this.checked);
    });

    // Scan — delegated, the popover re-renders on every change.
    scanPop.addEventListener('click', (ev) => {
        const m = ev.target.closest('[data-scanmode]');
        if (!m) return;
        setScanMode(m.dataset.scanmode);
        renderScan();
        scanPop.classList.add('open');   // re-render must not close it
    });
    scanPop.addEventListener('change', (ev) => {
        const f = ev.target.dataset.scan;
        if (!f) return;
        if (f === 'depth') setScanDepthGlobal(ev.target.value);
        else if (ev.target.type === 'checkbox') setScanField(f, ev.target.checked);
        else setScanField(f, ev.target.value);
        renderScan();
        scanPop.classList.add('open');
    });

    // Engine terms — the body class the editor's CSS contract awaits.
    $id('wl-wi2-engToggle').addEventListener('click', () => {
        document.body.classList.toggle('wl-wi2-show-eng');
    });

    // Lorebook toolbar — delegated on the group. Per-book actions target the
    // OPEN book (getOpenBookName); New + Import are library-wide. Disabled
    // buttons are skipped here and greyed by updateBookActions().
    $id('wl-wi2-bookActions').addEventListener('click', (ev) => {
        const btn = ev.target.closest('.wl-wi2-ba-btn');
        if (!btn || btn.disabled) return;
        const name = hasOpenBookSelection() ? getOpenBookName() : null;
        switch (btn.dataset.baAction) {
            case 'new':       newBook(); break;
            case 'import':    importBook(); break;
            case 'rename':    if (name) renameBook(name); break;
            case 'duplicate': if (name) duplicateBook(name); break;
            case 'export':    if (name) exportBook(name); break;
            case 'delete':    if (name) deleteBook(name); break;
        }
    });
}

/** Enable/disable the per-book toolbar buttons by whether a book is open. New
 *  + Import (no [data-needs-book]) stay live always. Called on init, on every
 *  open-book change (subscribed in initTopbar), and from refreshTopbar. */
function updateBookActions() {
    if (!root) return;
    const hasBook = hasOpenBookSelection();
    root.querySelectorAll('.wl-wi2-ba-btn[data-needs-book]')
        .forEach(btn => { btn.disabled = !hasBook; });
}

// ============================================================
// Lifecycle
// ============================================================

/** Re-render both readouts. The preset host's onApplied calls this (a
 *  preset moves the share, §9.28); the editor may poke it later too. */
export function refreshTopbar() {
    if (!root) return;
    updateBookActions();
    renderMeter();
    renderScan();
}

export function initTopbar(rootEl) {
    root = rootEl;
    buildTopbar();
    wireTopbar();
    initTopbarData(() => renderMeter());   // an activation moves the fill
    document.addEventListener('click', docClick);
    // Toolbar reflects the open book. initRail runs before initTopbar, so read
    // the current answer now, then subscribe for later switches. rail clears
    // its listener array on teardown and re-subscribes each open (the listcol
    // pattern), so this stays at exactly one listener per session.
    updateBookActions();
    onOpenBookChanged(() => updateBookActions());
    renderMeter();
    renderScan();
    log('topbar initialized');
}

export function teardownTopbar() {
    document.removeEventListener('click', docClick);
    teardownTopbarData();
    root = null;
    // body.wl-wi2-show-eng stays on purpose (scoped selectors make it
    // inert while closed; the writer's choice survives the session).
    log('topbar torn down');
}
