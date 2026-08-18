// src/worldInfoDrawerV2/sim.js
// WI v2 Simulator VIEW — the #wl-wi2-view-sim pour. Ports the mock's
// simulator (wi-v2-mockup.html #view-sim) 1:1 in structure, but its two
// datasets are REAL now: simData.js reads them off ST's engine instead of
// the mock's hand-typed TRACE/SIM arrays.
//
// Two sources, one renderer (the mock's rule — a verdict can't drift from the
// header that frames it):
//   · 'last'  → what happened on the last real reply (captured scan).
//   · 'scene' → a dry run of a pasted passage through checkWorldInfo.
//
// The row renderer (noteHTML), the scan sentence (scanLine), and the
// src-switch are the mock's, prefixed. What changed vs the mock: rows arrive
// from simData (async), 'last' can be EMPTY (no reply captured yet) and says
// so rather than faking, and the scene source actually runs the engine.

import { getOpenBookName } from './rail.js';
import {
    hasLastReply, lastReplyRows, lastReplyMessages, runDryScene, scanStateFor,
} from './simData.js';
import { gotoNoteInEditor } from './listcol.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let root = null;
let simSource = 'last';   // 'last' | 'scene'
let lastSceneText = '';   // survives a source flip so the textarea isn't wiped
let sceneScope = 'chat';  // 'chat' (passage + real history) | 'passage' (passage alone)

// ============================================================
// Shell — the mock's #view-sim markup, prefixed
// ============================================================
function shellHTML() {
    return `
      <div class="wl-wi2-sim-wrap"><div class="wl-wi2-sim-inner">
        <div class="wl-wi2-sim-cols">
          <div class="wl-wi2-sim-left" id="wl-wi2-simLeft">
            <div class="wl-wi2-src-switch" role="tablist">
              <button class="wl-wi2-src on" data-src="last" role="tab" aria-selected="true">What happened last reply</button>
              <button class="wl-wi2-src" data-src="scene" role="tab" aria-selected="false">Test a scene</button>
            </div>
            <div id="wl-wi2-simHead"></div>
            <div id="wl-wi2-sceneInput" class="wl-wi2-scene-input" hidden>
              <textarea class="wl-wi2-sim-input text_pole" placeholder="Paste a passage \u2014 a few lines of story \u2014 and see which notes would come up, and why."></textarea>
              <div class="wl-wi2-scene-scope" role="radiogroup" aria-label="What to scan">
                <button class="wl-wi2-scope on" data-scope="chat" role="radio" aria-checked="true">In the current chat</button>
                <button class="wl-wi2-scope" data-scope="passage" role="radio" aria-checked="false">This passage only</button>
              </div>
              <div class="wl-wi2-sim-row">
                <button class="wl-wi2-sim-btn menu_button" id="wl-wi2-runScene">Run the scene</button>
              </div>
            </div>
            <div id="wl-wi2-msgView" class="wl-wi2-msg-view" hidden></div>
          </div>
          <div class="wl-wi2-sim-right">
            <div id="wl-wi2-simList"></div>
            <div class="wl-wi2-trace-legend" id="wl-wi2-simLegend"></div>
          </div>
        </div>
      </div></div>`;
}

// ============================================================
// Message view — the LEFT column for the 'last' source: the actual turn the
// scan read, with the rest of the depth window folded behind a header above
// it (the interesting thing is the latest turn; the window is context). Mirrors
// the always-group collapsible so the two folds read as siblings. Its own
// module-scoped open state, defaulting closed like the always-group.
// ============================================================
let msgWindowOpen = false;

function msgHTML(m) {
    const who = m.isUser ? 'you' : (m.name || 'reply');
    return `<div class="wl-wi2-msg ${m.isUser ? 'user' : 'char'}">
        <div class="wl-wi2-msg-who">${esc(who)}</div>
        <div class="wl-wi2-msg-body">${esc(m.mes)}</div>
      </div>`;
}

/** Render the left-column message view for the 'last' source. Empty-safe: no
 *  capture yet, or a capture with no messages, shows a quiet line rather than
 *  a blank column (the row side already carries the fuller empty-state copy). */
function renderMsgView() {
    const box = root.querySelector('#wl-wi2-msgView');
    if (!box) return;
    box.hidden = (simSource !== 'last');
    if (simSource !== 'last') return;

    const msgs = lastReplyMessages();
    if (!msgs || !msgs.latest) {
        box.innerHTML = `<div class="wl-wi2-msg-none">The turn that triggered the scan will show here once a reply is captured.</div>`;
        return;
    }
    const win = Array.isArray(msgs.window) ? msgs.window : [];
    let html = '';
    if (win.length) {
        const open = msgWindowOpen;
        html += `<div class="wl-wi2-msgwin${open ? '' : ' closed'}">
            <button class="wl-wi2-msgwin-head" data-msgwin-toggle aria-expanded="${open ? 'true' : 'false'}">
              <span class="wl-wi2-msgwin-chev">\u25be</span>
              <span class="wl-wi2-msgwin-label">Earlier in the scan window</span>
              <span class="wl-wi2-msgwin-n">${win.length}</span>
            </button>
            <div class="wl-wi2-msgwin-body">${win.map(msgHTML).join('')}</div>
          </div>`;
    }
    html += `<div class="wl-wi2-msg-latest-label">The turn you sent</div>`;
    html += msgHTML(msgs.latest);
    box.innerHTML = html;
}

// ============================================================
// Row renderer — the mock's noteHTML (§9.33 click-through). A row whose note
// resolves (has book+uid) becomes a button that opens it; a category row
// ('Everything else') stays an inert span. Book comes from the ENTRY, one
// source (§9.17).
// ============================================================
function noteHTML(n) {
    const linkable = n.id != null && n.book != null && n.uid != null;
    const tt = linkable
        ? `<button class="wl-wi2-tt wl-wi2-tt-link" data-goto-uid="${esc(n.uid)}" data-goto-book="${esc(n.book)}" title="${esc('Open \u201c' + (n.tt || 'untitled') + '\u201d in ' + n.book)}">${esc(n.tt)}</button>`
        : `<span class="wl-wi2-tt">${esc(n.tt)}</span>`;
    return `<div class="wl-wi2-tnote ${esc(n.cls)}"><span class="wl-wi2-mark">${n.mark}</span>${tt}<span class="wl-wi2-why">${n.why}</span><span class="wl-wi2-tok">${esc(n.tok)}</span></div>`;
}

// ============================================================
// scanLine — how far the scan reached, stated honestly (§9.36). Port of the
// mock's, reading the REAL scan settings via simData.scanStateFor().
// ============================================================
function scanLine(tense) {
    const SCAN = scanStateFor();
    const d = SCAN.depth;
    const listened = tense === 'past' ? 'Listened to' : 'Would listen to';
    if (d === 0) {
        return tense === 'past'
            ? 'The scene wasn\u2019t read for topics \u2014 scan depth is 0.'
            : 'The scene wouldn\u2019t be read for topics \u2014 scan depth is 0.';
    }
    const base = `${listened} the last <b>${d}</b> ${d === 1 ? 'message' : 'messages'}`;
    if (SCAN.mode === 'minact') {
        const cap = SCAN.minActsDepthMax > 0 ? `${SCAN.minActsDepthMax}` : 'the whole chat';
        return `${base} \u2014 and further back for notes it went looking for, until ${SCAN.minActs} were found (no deeper than ${cap}).`;
    }
    return `${base} of the scene.`;
}

// ============================================================
// Sources — head / sub / order / legend, per the mock. `sub` is a function so
// it quotes the LIVE scan settings (the mock's rule: a frozen string is how
// "last 8 messages" became a claim nobody could edit).
// ============================================================
const SOURCES = {
    last: {
        head: 'The story of your last reply',
        sub: () => `These notes were included on your last reply, and why. ${scanLine('past')}`,
        order: 'Filled in this order: <b>this chat</b> \u2192 <b>your persona</b> \u2192 <b>the character\u2019s</b> \u2192 <b>global</b>, each by rank. Whatever the share ran out on is at the bottom.',
        legend: 'Click a note\u2019s name to open it \u2014 it opens in its own lorebook.',
    },
    scene: {
        head: 'Try a scene',
        sub: () => sceneScope === 'passage'
            ? `Paste a passage and see which notes <b>would</b> be included, checking the passage <b>on its own</b> \u2014 the rest of the chat is ignored. A dry run against your current books; nothing here has happened.`
            : `Paste a passage and see which notes <b>would</b> be included, and why. Nothing here has happened \u2014 it\u2019s a dry run against your current books. ${scanLine('conditional')}`,
        order: 'It would fill in this order: <b>this chat</b> \u2192 <b>your persona</b> \u2192 <b>the character\u2019s</b> \u2192 <b>global</b>, each by rank.',
        legend: 'A dry run: timing (lingers / rests / waits) and chance rolls depend on the real chat\u2019s history, so a live reply can differ. Click a note\u2019s name to open it.',
    },
};

// ============================================================
// Render
// ============================================================
// Two halves: the frame (head/sub/order + src-switch + input visibility) is
// synchronous and paints immediately; the LIST is async (simData reads the
// engine / tokenizes), so it shows a quiet "reading…" line and fills when the
// rows resolve. A render token guards against a source flip mid-fetch landing
// stale rows in the wrong view.

let renderToken = 0;

function renderFrame() {
    const s = SOURCES[simSource];
    root.querySelector('#wl-wi2-simHead').innerHTML =
        `<div class="wl-wi2-trace-head">${s.head}</div>
         <div class="wl-wi2-trace-sub">${s.sub()}</div>
         <div class="wl-wi2-trace-order">${s.order}</div>`;
    const leg = root.querySelector('#wl-wi2-simLegend');
    leg.innerHTML = s.legend;
    leg.hidden = !s.legend;
    root.querySelector('#wl-wi2-sceneInput').hidden = (simSource !== 'scene');
    root.querySelectorAll('.wl-wi2-src').forEach(b => {
        const on = b.dataset.src === simSource;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderMsgView();   // left column: message view (last) or hidden (scene)
}

/** The inert 'Everything else' tail — names a category, not a note, so it
 *  renders as a non-link (the mock's rule). Appended to a non-empty result. */
const EVERYTHING_ELSE = {
    cls: 'waitish', mark: '\u25cb', id: null, book: null, uid: null,
    tt: 'Everything else',
    why: 'stayed in the lorebook \u2014 no topics matched, nothing pulled them in.',
    tok: '\u2014',
};

// Always-on rows (constant notes, ◉) collapse behind a header so the
// conditional rows — the ones whose presence is actually a question — stay
// front and centre. This matches the mock's own ordering (its SIM array put
// the always-on notes at the bottom, below the conditional ones); the toggle
// just formalises that and lets them fold away. Collapsed by DEFAULT: the
// interesting rows are the conditional ones. State is module-scoped so a
// re-render (tab flip, new reply) doesn't spring it back open. Keyed by
// source so 'last' and 'scene' remember independently.
const alwaysOpen = { last: false, scene: false };

/** Build the full list HTML from a flat row array: conditional rows first,
 *  then a collapsible "Always included (N)" group, then the inert tail. The
 *  always-group is omitted entirely when there are no constant rows (no empty
 *  header). `src` keys the open/closed memory. */
function listHTML(rows, src) {
    const always = rows.filter(r => r.cls === 'always');
    const conditional = rows.filter(r => r.cls !== 'always');
    let html = conditional.map(noteHTML).join('');
    if (always.length) {
        const open = alwaysOpen[src];
        html += `<div class="wl-wi2-always-group${open ? '' : ' closed'}">
            <button class="wl-wi2-always-head" data-always-toggle="${esc(src)}" aria-expanded="${open ? 'true' : 'false'}">
              <span class="wl-wi2-always-chev">\u25be</span>
              <span class="wl-wi2-always-mark">\u25c9</span>
              <span class="wl-wi2-always-label">Always included</span>
              <span class="wl-wi2-always-n">${always.length}</span>
            </button>
            <div class="wl-wi2-always-body">${always.map(noteHTML).join('')}</div>
          </div>`;
    }
    html += noteHTML(EVERYTHING_ELSE);
    return html;
}

async function renderList() {
    const list = root.querySelector('#wl-wi2-simList');
    const token = ++renderToken;
    list.innerHTML = `<div class="wl-wi2-sim-note">reading\u2026</div>`;

    if (simSource === 'last') {
        if (!hasLastReply()) {
            list.innerHTML = `<div class="wl-wi2-sim-empty">No reply captured yet this session. Send a message in the chat, then come back \u2014 this will show exactly which notes came up, and why.</div>`;
            return;
        }
        const rows = await lastReplyRows();
        if (token !== renderToken) return;   // a flip happened; drop stale rows
        list.innerHTML = rows.length
            ? listHTML(rows, 'last')
            : `<div class="wl-wi2-sim-empty">Nothing came up on the last reply \u2014 no notes matched, and none are set to always include.</div>`;
        return;
    }

    // scene: needs a run. Until the user runs one, invite it rather than
    // showing a blank or a stale result.
    if (!lastSceneText) {
        list.innerHTML = `<div class="wl-wi2-sim-empty">Paste a passage above and run it to see what would come up.</div>`;
        return;
    }
    const { rows, error, empty } = await runDryScene(lastSceneText, sceneScope);
    if (token !== renderToken) return;
    if (error === 'engine-unavailable') {
        list.innerHTML = `<div class="wl-wi2-sim-empty">Couldn\u2019t reach the world-info engine to run the scene.</div>`;
        return;
    }
    if (error) {
        list.innerHTML = `<div class="wl-wi2-sim-empty">The scene run hit a snag. Try again, or check the console.</div>`;
        return;
    }
    if (empty) {
        list.innerHTML = `<div class="wl-wi2-sim-empty">Nothing to run \u2014 the passage is empty.</div>`;
        return;
    }
    list.innerHTML = rows.length
        ? listHTML(rows, 'scene')
        : `<div class="wl-wi2-sim-empty">Nothing would come up for that passage \u2014 no topics matched.</div>`;
}

function render() {
    if (!root) return;
    renderFrame();
    renderList();
}

// ============================================================
// Wiring
// ============================================================
function wire() {
    // Source switch.
    root.querySelectorAll('.wl-wi2-src').forEach(b => b.addEventListener('click', () => {
        if (simSource === b.dataset.src) return;
        simSource = b.dataset.src;
        render();
    }));

    // Scene textarea: remember its text across source flips (renderFrame only
    // hides it, never rebuilds it, so the value persists in the DOM — but a
    // full re-init would lose it; lastSceneText is the durable copy the run
    // reads and the reopen restores).
    const ta = root.querySelector('.wl-wi2-sim-input');
    if (ta) {
        ta.value = lastSceneText;
        ta.addEventListener('input', () => { lastSceneText = ta.value; });
    }

    // Run the scene.
    root.querySelector('#wl-wi2-runScene')?.addEventListener('click', () => {
        lastSceneText = (root.querySelector('.wl-wi2-sim-input')?.value || '').trim();
        renderList();
    });

    // Scene scope toggle: 'chat' (passage + real history) vs 'passage' (the
    // pasted text alone). Changes what the engine SCANS, so re-runs the dry
    // run — the rows genuinely differ, it's not a cosmetic filter. Only re-runs
    // when a passage has already been entered; otherwise just flips the state
    // (renderList shows the invite copy anyway).
    root.querySelectorAll('.wl-wi2-scope').forEach(b => b.addEventListener('click', () => {
        if (sceneScope === b.dataset.scope) return;
        sceneScope = b.dataset.scope;
        root.querySelectorAll('.wl-wi2-scope').forEach(x => {
            const on = x.dataset.scope === sceneScope;
            x.classList.toggle('on', on);
            x.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        renderFrame();               // sub-copy reflects the scope
        if (lastSceneText) renderList();
    }));

    // Left-column message-window fold (last source): a pure UI toggle, same
    // shape as the always-group. Delegated on the left column since the msg
    // view re-renders. Flips the class in place; no re-fetch.
    root.querySelector('#wl-wi2-simLeft').addEventListener('click', (ev) => {
        const toggle = ev.target.closest('[data-msgwin-toggle]');
        if (!toggle) return;
        msgWindowOpen = !msgWindowOpen;
        const win = toggle.closest('.wl-wi2-msgwin');
        if (win) win.classList.toggle('closed', !msgWindowOpen);
        toggle.setAttribute('aria-expanded', msgWindowOpen ? 'true' : 'false');
    });

    // Click-through (§9.33): delegated on the list (rows re-render). Opens the
    // note in the editor — switching book if needed — via listcol's public
    // path, the same one the rail's rows funnel through (so §9.31's unsaved-
    // edits guard is inherited, not duplicated). The same delegate also
    // handles the always-on group toggle: it's a pure UI fold (no re-fetch),
    // so it flips the class in place rather than re-rendering the list.
    root.querySelector('#wl-wi2-simList').addEventListener('click', (ev) => {
        const toggle = ev.target.closest('[data-always-toggle]');
        if (toggle) {
            const src = toggle.dataset.alwaysToggle;
            const open = !alwaysOpen[src];
            alwaysOpen[src] = open;
            const group = toggle.closest('.wl-wi2-always-group');
            if (group) group.classList.toggle('closed', !open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            return;
        }
        const link = ev.target.closest('[data-goto-uid]');
        if (!link) return;
        gotoNoteInEditor(link.dataset.gotoBook, link.dataset.gotoUid);
    });
}

// ============================================================
// Public lifecycle
// ============================================================
/** Build + wire the sim view inside its region (#wl-wi2-view-sim). Called
 *  once from takeoverWiV2. The rows aren't fetched until refreshSim() (on the
 *  first tab activation) so opening straight to the editor costs nothing. */
export function initSim(rootEl) {
    root = rootEl;
    root.innerHTML = shellHTML();
    wire();
    renderFrame();   // paint the frame; list fills on first refreshSim()
}

/** Re-fetch + repaint. Called when the Simulator tab becomes active (its data
 *  is a snapshot of a moving target — a new reply, changed scan settings — so
 *  every activation re-reads). Safe when closed. */
export function refreshSim() {
    if (root) render();
}

/** Drop references on overlay close. No listeners to detach — they live on
 *  nodes inside root, which drawerUI removes wholesale. simData's own
 *  teardown (event unsub) is called separately from restoreWiV2. */
export function teardownSim() {
    root = null;
    // simSource + lastSceneText survive module-lifetime on purpose: reopen the
    // drawer and you're back where you were, same as the rail's openBook.
}
