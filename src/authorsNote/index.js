// src/authorsNote/index.js
// Author's Note — Bedazzler-owned floating panel.
//
// A draggable, collapsible panel that drives ST's three native Author's Note
// fields (Chat / Character / Default) as a genuine alternate UI. It does NOT
// copy state: it reads from and writes to the SAME native elements that live in
// ST's #floatingPrompt drawer, dispatching their events so ST's own save logic
// runs unchanged. Editing via the native drawer while the panel is open is
// reflected back (and vice-versa) by binding directly to the native inputs.
//
// The native AN link in the send-form menu is left untouched — this is an
// additional entry point, not a replacement.

import { makeDraggablePanel } from './draggablePanel.js';
import { makeDebug } from '../debug.js';
import { eventSource, event_types } from '../../../../../../script.js';

const log = makeDebug('[UIBedazzler:AuthorsNote]');

const PANEL_ID = 'bd-an-panel';

// ============================================================
// Field map — the three native notes
// ============================================================
// Each tab points at REAL native element IDs (verified in public/index.html).
// The panel binds to these directly; `position` lists the radio group name and
// its option values so we can render matching radios that proxy the natives.

const TABS = {
    chat: {
        label: 'Chat',
        caption: 'Unique to this chat.',
        textarea: 'extension_floating_prompt',
        counter: 'extension_floating_prompt_token_counter',
        wiScan: 'extension_floating_allow_wi_scan',       // Chat only
        positionName: 'extension_floating_position',
        positions: [
            { value: '2', label: 'Before Main Prompt / Story String' },
            { value: '0', label: 'After Main Prompt / Story String' },
            { value: '1', label: 'In-chat @ Depth', depth: true },
        ],
        depth: 'extension_floating_depth',
        role: 'extension_floating_role',
        interval: 'extension_floating_interval',          // Insertion Frequency
        liveCounter: 'extension_floating_counter',        // "inputs until next insertion"
    },
    character: {
        label: 'Character',
        caption: 'Private to this character.',   // NOT "travels with the card"
        textarea: 'extension_floating_chara',
        counter: 'extension_floating_chara_token_counter',
        enable: 'extension_use_floating_chara',   // "Use character author's note"
        // Character position is Replace/Top/Bottom RELATIVE TO THE NOTE — a
        // different axis from the standard before/after-main-prompt radios.
        positionName: 'extension_floating_char_position',
        positions: [
            { value: '0', label: 'Replace Author\'s Note' },
            { value: '1', label: 'Top of Author\'s Note' },
            { value: '2', label: 'Bottom of Author\'s Note' },
        ],
        // No WI-scan, no depth/role, no insertion-frequency for the char note.
    },
    default: {
        label: 'Default',
        caption: 'Applied to all new chats.',
        textarea: 'extension_floating_default',
        counter: 'extension_floating_default_token_counter',
        // Default's control set == Chat's minus the WI-scan checkbox.
        positionName: 'extension_default_position',
        positions: [
            { value: '2', label: 'Before Main Prompt / Story String' },
            { value: '0', label: 'After Main Prompt / Story String' },
            { value: '1', label: 'In-chat @ Depth', depth: true },
        ],
        depth: 'extension_default_depth',
        role: 'extension_default_role',
        interval: 'extension_default_interval',
    },
};

const TAB_ORDER = ['chat', 'character', 'default'];

// ============================================================
// State
// ============================================================

let panel = null;          // draggable-panel controller
let activeTab = 'chat';
let collapsed = false;
let nativeListeners = [];  // [{ el, type, fn }] — for teardown / re-sync
let nativeObservers = [];  // MutationObservers watching native token counters

// ============================================================
// Helpers
// ============================================================

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const $native = (id) => document.getElementById(id);

/**
 * Fire the events ST's own handlers listen for after we programmatically set a
 * native input's value/checked/selection. `input` + `change` covers textareas,
 * checkboxes, number fields, and selects; ST debounces its save off these.
 */
function fireNative(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Currently-selected native radio value for a radio group name. */
function getNativeRadio(name) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : null;
}

/** Set a native radio group to `value` and fire its change. */
function setNativeRadio(name, value) {
    const target = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (target && !target.checked) {
        target.checked = true;
        fireNative(target);
    }
}

// ============================================================
// DOM construction
// ============================================================

function buildTabRow() {
    return TAB_ORDER.map(key => {
        const t = TABS[key];
        const on = key === activeTab ? ' bd-an-tab-active' : '';
        return `<button type="button" class="bd-an-tab${on}" data-tab="${key}">${esc(t.label)}</button>`;
    }).join('');
}

/** Build the Advanced-section inner controls for a given tab. */
function buildAdvanced(key) {
    const t = TABS[key];
    let html = '';

    // Character: "use character author's note" enable checkbox (top of advanced).
    if (t.enable) {
        html += `
            <label class="bd-an-check">
                <input type="checkbox" data-role="enable">
                <span>Use character author's note</span>
            </label>`;
    }

    // Chat: World Info scan checkbox.
    if (t.wiScan) {
        html += `
            <label class="bd-an-check">
                <input type="checkbox" data-role="wiScan">
                <span>Include in World Info Scanning</span>
            </label>`;
    }

    // Position radios (every tab has some position axis).
    html += `<div class="bd-an-radios" data-role="positions">`;
    for (const p of t.positions) {
        html += `
            <label class="bd-an-radio">
                <input type="radio" name="bd-an-pos-${key}" value="${p.value}">
                <span>${esc(p.label)}</span>
            </label>`;
    }
    html += `</div>`;

    // Depth + role (only tabs with an In-chat @ Depth option).
    if (t.depth) {
        html += `
            <div class="bd-an-inline" data-role="depthRow">
                <label class="bd-an-mini">Depth
                    <input type="number" min="0" max="9999" data-role="depth" class="bd-an-num">
                </label>
                <label class="bd-an-mini">as
                    <select data-role="role" class="bd-an-select">
                        <option value="0">System</option>
                        <option value="1">User</option>
                        <option value="2">Assistant</option>
                    </select>
                </label>
            </div>`;
    }

    // Insertion frequency (chat + default, not character).
    if (t.interval) {
        html += `
            <div class="bd-an-inline">
                <label class="bd-an-mini bd-an-mini-grow">Insertion Frequency
                    <small>(0 = Disable, 1 = Always)</small>
                </label>
                <input type="number" min="0" max="9999" data-role="interval" class="bd-an-num">
            </div>`;
    }
    return html;
}

/** Build the whole panel element (once). */
function buildPanelDOM() {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'bd-an-panel';
    el.style.display = 'none';

    el.innerHTML = `
        <div class="bd-an-titlebar" data-role="handle">
            <i class="fa-solid fa-grip-vertical bd-an-grip"></i>
            <span class="bd-an-title">Author's Note</span>
            <button type="button" class="bd-an-tb-btn" data-role="collapse" title="Collapse">
                <i class="fa-solid fa-minus"></i>
            </button>
            <button type="button" class="bd-an-tb-btn" data-role="close" title="Close">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="bd-an-collapsible" data-role="collapsible">
            <div class="bd-an-tabs" data-role="tabs">${buildTabRow()}</div>
            <div class="bd-an-body">
                <div class="bd-an-caption" data-role="caption"></div>
                <textarea class="bd-an-textarea" data-role="textarea" rows="8"
                    placeholder="Author's Note…"></textarea>
                <div class="bd-an-counter">
                    Tokens: <span data-role="counter">0</span>
                </div>
                <div class="bd-an-advanced" data-role="advanced">
                    <button type="button" class="bd-an-adv-toggle" data-role="advToggle">
                        <i class="fa-solid fa-chevron-right bd-an-adv-chevron"></i>
                        <span>Advanced</span>
                    </button>
                    <div class="bd-an-adv-content" data-role="advContent"></div>
                </div>
            </div>
        </div>
    `;
    return el;
}

// ============================================================
// Native binding
// ============================================================

/** Track a native listener so we can remove it on tab switch / teardown. */
function bindNative(el, type, fn) {
    if (!el) return;
    el.addEventListener(type, fn);
    nativeListeners.push({ el, type, fn });
}

/** Remove all native listeners registered for the current tab. */
function unbindNatives() {
    for (const { el, type, fn } of nativeListeners) {
        el.removeEventListener(type, fn);
    }
    nativeListeners = [];
    for (const mo of nativeObservers) mo.disconnect();
    nativeObservers = [];
}

/** Refresh the panel's token counter from the native counter text. */
function syncCounter(root, t) {
    const nativeCounter = $native(t.counter);
    const panelCounter = root.querySelector('[data-role="counter"]');
    if (nativeCounter && panelCounter) {
        panelCounter.textContent = nativeCounter.textContent || '0';
    }
}

/**
 * Populate the panel body for `activeTab` and wire two-way binding to the
 * native fields. Called on open and on every tab switch. Always unbinds the
 * previous tab's native listeners first.
 */
function renderTab(root) {
    unbindNatives();
    const t = TABS[activeTab];

    // Caption
    root.querySelector('[data-role="caption"]').textContent = t.caption;

    // Advanced content (rebuilt per tab — controls differ)
    const advContent = root.querySelector('[data-role="advContent"]');
    advContent.innerHTML = buildAdvanced(activeTab);

    // ---- Textarea (two-way) ----
    const nativeTA = $native(t.textarea);
    const panelTA = root.querySelector('[data-role="textarea"]');
    if (nativeTA) {
        panelTA.value = nativeTA.value;
        panelTA.disabled = false;
        // Panel → native
        panelTA.oninput = () => {
            nativeTA.value = panelTA.value;
            fireNative(nativeTA);
            syncCounter(root, t);
        };
        // Native → panel (native drawer edited while panel open)
        bindNative(nativeTA, 'input', () => {
            if (document.activeElement !== panelTA) panelTA.value = nativeTA.value;
            syncCounter(root, t);
        });
    } else {
        panelTA.value = '';
        panelTA.disabled = true;
        panelTA.oninput = null;
    }
    syncCounter(root, t);
    // Native token counters update async; mirror them when they change.
    const nativeCounter = $native(t.counter);
    if (nativeCounter) {
        const mo = new MutationObserver(() => syncCounter(root, t));
        mo.observe(nativeCounter, { childList: true, characterData: true, subtree: true });
        nativeObservers.push(mo);
    }

    wireAdvanced(root, t);
}

/** Wire the Advanced-section controls for the active tab to their natives. */
function wireAdvanced(root, t) {
    // Checkbox proxy (enable / wiScan): panel ↔ native.
    const wireCheck = (role, nativeId) => {
        const panelCb = root.querySelector(`[data-role="${role}"]`);
        const nativeCb = $native(nativeId);
        if (!panelCb || !nativeCb) return;
        panelCb.checked = nativeCb.checked;
        panelCb.onchange = () => { nativeCb.checked = panelCb.checked; fireNative(nativeCb); };
        bindNative(nativeCb, 'change', () => { panelCb.checked = nativeCb.checked; });
    };
    if (t.enable) wireCheck('enable', t.enable);
    if (t.wiScan) wireCheck('wiScan', t.wiScan);

    // Position radios: panel ↔ native radio group.
    const panelRadios = root.querySelectorAll(`input[name="bd-an-pos-${activeTab}"]`);
    const current = getNativeRadio(t.positionName);
    panelRadios.forEach(r => {
        r.checked = (r.value === current);
        r.onchange = () => { if (r.checked) setNativeRadio(t.positionName, r.value); };
    });
    // Native → panel: if native radio changes elsewhere, reflect it.
    t.positions.forEach(p => {
        const nativeRadio = document.querySelector(`input[name="${t.positionName}"][value="${p.value}"]`);
        if (nativeRadio) {
            bindNative(nativeRadio, 'change', () => {
                const val = getNativeRadio(t.positionName);
                panelRadios.forEach(r => { r.checked = (r.value === val); });
            });
        }
    });

    // Number/select proxies (depth, role, interval).
    const wireField = (role, nativeId) => {
        const panelEl = root.querySelector(`[data-role="${role}"]`);
        const nativeEl = $native(nativeId);
        if (!panelEl || !nativeEl) return;
        panelEl.value = nativeEl.value;
        panelEl.oninput = () => { nativeEl.value = panelEl.value; fireNative(nativeEl); };
        panelEl.onchange = panelEl.oninput;
        bindNative(nativeEl, 'input', () => { panelEl.value = nativeEl.value; });
    };
    if (t.depth) wireField('depth', t.depth);
    if (t.role) wireField('role', t.role);
    if (t.interval) wireField('interval', t.interval);
}

// ============================================================
// Panel control wiring (tabs / collapse / advanced / close)
// ============================================================

function wirePanelControls(root) {
    // Tab switching
    root.querySelector('[data-role="tabs"]').addEventListener('click', (e) => {
        const btn = e.target.closest('.bd-an-tab');
        if (!btn) return;
        const key = btn.dataset.tab;
        if (!key || key === activeTab) return;
        activeTab = key;
        root.querySelectorAll('.bd-an-tab').forEach(b =>
            b.classList.toggle('bd-an-tab-active', b.dataset.tab === key));
        renderTab(root);
        panel?.reclamp();
    });

    // Advanced disclosure (folded by default)
    const advToggle = root.querySelector('[data-role="advToggle"]');
    const advContent = root.querySelector('[data-role="advContent"]');
    const advWrap = root.querySelector('[data-role="advanced"]');
    advToggle.addEventListener('click', () => {
        const open = advWrap.classList.toggle('bd-an-adv-open');
        advContent.style.display = open ? '' : 'none';
        panel?.reclamp();
    });
    advContent.style.display = 'none'; // start folded

    // Collapse (−): hide everything below the titlebar
    root.querySelector('[data-role="collapse"]').addEventListener('click', () => {
        collapsed = !collapsed;
        const collapsible = root.querySelector('[data-role="collapsible"]');
        collapsible.style.display = collapsed ? 'none' : '';
        root.classList.toggle('bd-an-collapsed', collapsed);
        panel?.reclamp();
    });

    // Close (×)
    root.querySelector('[data-role="close"]').addEventListener('click', () => {
        panel?.hide();
    });
}

// ============================================================
// Public API
// ============================================================

/** Ensure the panel DOM + controller exist (build once, reuse after). */
function ensurePanel() {
    if (panel) return panel;
    const el = buildPanelDOM();
    document.body.appendChild(el);

    panel = makeDraggablePanel(el, {
        id: PANEL_ID,
        handle: '[data-role="handle"]',
        defaultAnchor: 'center-right',
        snapToEdges: true,
    });

    wirePanelControls(el);
    return panel;
}

/**
 * Open (or toggle) the Author's Note floating panel. Triggered by the side
 * button. If it's already open, this brings focus by re-rendering the current
 * tab from the natives (in case the drawer changed things while hidden).
 */
export function openAuthorsNoteModal() {
    ensurePanel();
    const root = panel.element;

    // If collapsed from a previous session's toggle, expand on open.
    if (collapsed) {
        collapsed = false;
        root.querySelector('[data-role="collapsible"]').style.display = '';
        root.classList.remove('bd-an-collapsed');
    }

    if (panel.isOpen()) {
        // Already open — just resync from natives.
        renderTab(root);
        return;
    }
    panel.show();
    renderTab(root);
    log(`Panel opened on "${activeTab}" tab`);
}

/** Close the panel if open. */
export function closeAuthorsNoteModal() {
    if (panel?.isOpen()) panel.hide();
}

/** Init hook (panel builds lazily on first open; only the chat-switch sync is
 *  registered eagerly here). */
export function initAuthorsNote() {
    log('Author\'s Note module ready (lazy panel)');

    // Keep an OPEN panel honest across chat switches. When the active chat
    // changes, ST repopulates the native Author's Note fields (the Chat note
    // especially) by assigning their values directly — it does NOT fire the
    // `input`/`change` events our per-field bindings listen for. So without
    // this, an open panel keeps showing the PRIOR chat's notes. Re-render from
    // the natives on CHAT_CHANGED. Deferred a tick so ST's own CHAT_CHANGED
    // handler (which loads the new chat's note values into the natives) runs
    // first — we want to read the fields AFTER ST has refilled them.
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (!panel?.isOpen()) return;
        setTimeout(() => {
            if (panel?.isOpen()) renderTab(panel.element);
        }, 0);
    });
}
