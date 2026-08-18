// src/presetDrawerExpanded/testChat.js
// Expanded Preset Drawer — the "Test" tab: a throwaway dummy chat for trying the
// current preset live while you edit it. The generation engine assembles the
// selected character, persona, scene, World Info, and this module's throwaway
// history without writing messages into the real chat.
//
// Data sources are the SAME ones the sibling features already use (no guessing):
//   - characters : getAvailableCharacters()  (Chat Design)  → { name, avatar }
//   - personas   : getAvailablePersonas()    (Chat Design)  → { name, avatar, title }
//   - profiles   : /profile-list slash command (Connection Manager)
//   - samplers   : WhiteLotus SAMPLER_PRESETS (dynamic import; optional)

import { getContext } from '../../../../../extensions.js';
import { getAvailableCharacters, getAvailablePersonas } from '../chatDesign/storage.js';
import { runTestGeneration } from './testEngine.js';
import { openPromptViewer, closePromptViewer } from './promptViewer.js';
import { formatTestMessage } from './messageRender.js';

const log = () => {};

// Per-open state. Only one drawer exists at a time, so module scope is fine.
let rootEl = null;                 // the #wl-pe-view-test container
let messages = [];                 // [{ id, who: 'char'|'user'|'note', name, text, ... }]
let seq = 0;
let busy = false;                  // a generation is in flight
let samplerPresets = null;         // { key: { settings, ... } } from WhiteLotus, if present
let lastCompiledChat = null;       // last assembled prompt (for the future Prompt viewer)

// ============================================================
// Lifecycle
// ============================================================

export function startTestChat(container) {
    if (!container) return;
    rootEl = container;
    messages = [];
    seq = 0;
    busy = false;
    lastCompiledChat = null;

    container.innerHTML = buildHTML();
    wireEvents(container);
    populateDropdowns(container);
    renderChat();
    syncPromptButton();

    log('Test chat mounted');
}

export function stopTestChat(container) {
    closePromptViewer();               // dismiss the popup if the drawer closes under it
    const el = container || rootEl;
    if (el) el.innerHTML = '';
    rootEl = null;
    messages = [];
    lastCompiledChat = null;
}

// ============================================================
// Markup
// ============================================================

function buildHTML() {
    return `
        <div class="wl-pe-test">
            <div class="wl-pe-test-toolbar">
                <div class="wl-pe-ttrow wl-pe-ttrow-profiles">
                    <span class="wl-pe-tsel" title="Connection profile">
                        <i class="fa-solid fa-plug"></i>
                        <select data-role="profile"><option>Loading…</option></select>
                    </span>
                    <span class="wl-pe-tsel" title="Sampler preset">
                        <i class="fa-solid fa-sliders"></i>
                        <select data-role="sampler"><option value="">— Sampler —</option></select>
                    </span>
                </div>
                <div class="wl-pe-ttrow wl-pe-ttrow-actors">
                    <span class="wl-pe-tsel wl-pe-tsel-character" title="Character (test only)">
                        <i class="fa-solid fa-masks-theater"></i>
                        <select data-role="character"><option>Loading…</option></select>
                    </span>
                    <span class="wl-pe-tsel" title="Persona (test only)">
                        <i class="fa-solid fa-user"></i>
                        <select data-role="persona"><option>Loading…</option></select>
                    </span>
                    <span class="wl-pe-tbtns">
                        <button class="wl-pe-tbtn wl-pe-tbtn-icon" data-role="context" title="Scene context — used only to build the test prompt" aria-label="Scene context"><i class="fa-solid fa-clapperboard"></i></button>
                        <button class="wl-pe-tbtn wl-pe-tbtn-icon wl-pe-disabled" data-role="prompt" title="Send a test message first, then view the exact prompt that was sent" aria-label="View compiled prompt" disabled><i class="fa-solid fa-file-code"></i></button>
                        <button class="wl-pe-tbtn wl-pe-tbtn-icon wl-pe-danger" data-role="clear" title="Clear the dummy chat" aria-label="Clear chat"><i class="fa-solid fa-eraser"></i></button>
                    </span>
                </div>
            </div>

            <div class="wl-pe-test-context" data-role="ctxpanel" hidden>
                <label>Scene context — test only</label>
                <textarea data-role="ctxtext" placeholder="e.g. A rain-soaked rooftop at midnight; {{char}} has just realized {{user}} followed them here. (Injected only into the test prompt — never saved to the preset.)"></textarea>
            </div>

            <div class="wl-pe-test-chat" data-role="chat"></div>

            <div class="wl-pe-test-input">
                <textarea data-role="input" rows="1" placeholder="Send a message to test the preset…"></textarea>
                <button class="wl-pe-sendbtn" data-role="send" title="Send"><i class="fa-solid fa-paper-plane"></i></button>
            </div>
        </div>
    `;
}

// ============================================================
// Events
// ============================================================

function wireEvents(el) {
    el.querySelector('[data-role="context"]').addEventListener('click', () => {
        const panel = el.querySelector('[data-role="ctxpanel"]');
        const btn = el.querySelector('[data-role="context"]');
        panel.hidden = !panel.hidden;
        btn.classList.toggle('on', !panel.hidden);
        if (!panel.hidden) el.querySelector('[data-role="ctxtext"]').focus();
    });

    el.querySelector('[data-role="clear"]').addEventListener('click', () => {
        messages = [];
        renderChat();
    });

    // Prompt viewer — enabled only once a generation has produced a compiled
    // prompt. Shows the exact messages array that was sent to the model, with
    // optional group coloring.
    el.querySelector('[data-role="prompt"]').addEventListener('click', () => {
        console.log('[BD PromptBtn] click; lastCompiledChat =', lastCompiledChat);
        if (!lastCompiledChat) {
            window.toastr?.info?.('Send a test message first, then the prompt will be available.', 'No prompt yet');
            return;
        }
        try {
            openPromptViewer(lastCompiledChat);
            console.log('[BD PromptBtn] openPromptViewer returned; overlay in DOM =',
                !!document.getElementById('wl-pe-prompt-overlay'));
        } catch (err) {
            console.error('[BD PromptBtn] openPromptViewer threw:', err);
            window.toastr?.error?.(String(err?.message || err), 'Prompt viewer error');
        }
    });

    const input = el.querySelector('[data-role="input"]');
    el.querySelector('[data-role="send"]').addEventListener('click', () => sendMessage(el));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(el);
        }
    });
}

function currentCharName(el) {
    const sel = el.querySelector('[data-role="character"]');
    return sel?.selectedOptions?.[0]?.dataset?.name || 'Character';
}

function currentPersonaName(el) {
    const sel = el.querySelector('[data-role="persona"]');
    return sel?.selectedOptions?.[0]?.dataset?.name || 'You';
}

function currentSamplerOverride(el) {
    const key = el.querySelector('[data-role="sampler"]')?.value || '';
    if (!key || !samplerPresets || !samplerPresets[key]) return null;
    return samplerPresets[key].settings || null; // { temp_openai, top_p_openai, ... }
}

/** Fire one generation through the engine with the given history. */
function callEngine(el, history) {
    return runTestGeneration({
        charAvatar: el.querySelector('[data-role="character"]')?.value || '',
        personaAvatar: el.querySelector('[data-role="persona"]')?.value || '',
        sceneContext: el.querySelector('[data-role="ctxtext"]')?.value || '',
        history,
        profileName: el.querySelector('[data-role="profile"]')?.value || '',
        samplerOverride: currentSamplerOverride(el),
    });
}

/** History (char/user turns) for everything strictly before array index `stop`.
 *  `stop` defaults to the whole list. */
function historyBefore(stop = messages.length) {
    return messages
        .slice(0, stop)
        .filter((m) => m.who === 'char' || m.who === 'user')
        .map((m) => ({ who: m.who, text: m.text }));
}

async function sendMessage(el) {
    if (busy) return;
    const input = el.querySelector('[data-role="input"]');
    const text = input.value.trim();
    if (!text) return;

    const charName = currentCharName(el);
    messages.push({ id: ++seq, who: 'user', name: currentPersonaName(el), text });
    input.value = '';

    // Transient "generating" line, replaced by the reply (or an error).
    const noteId = ++seq;
    messages.push({ id: noteId, who: 'note', name: '', text: `${charName} is thinking…` });
    setBusy(el, true);
    renderChat();

    // History = the conversation so far (including the user message just pushed;
    // the trailing note is skipped by the who-filter).
    const history = historyBefore();

    try {
        const { text: reply, compiledChat, promptProvenance } = await callEngine(el, history);
        lastCompiledChat = { messages: compiledChat, provenance: promptProvenance };
        syncPromptButton();
        replaceNote(noteId, { who: 'char', name: charName, text: reply, swipes: [reply], swipeIdx: 0 });
    } catch (err) {
        replaceNote(noteId, { who: 'note', name: '', text: `⚠ ${err?.message || err}`, canRegen: true });
    } finally {
        setBusy(el, false);
        renderChat();
    }
}

function replaceNote(noteId, patch) {
    const i = messages.findIndex((m) => m.id === noteId);
    if (i !== -1) messages[i] = { id: noteId, ...patch };
}

// ── Swipes (native-ST-style) ────────────────────────────────
// A character turn stores every generated alternative in `swipes[]` with the
// visible one at `swipeIdx`; `text` mirrors the active swipe. Left/right browse;
// right past the end asks the engine for a fresh alternative.
async function onSwipe(el, id, dir) {
    if (busy) return;
    const m = messages.find((x) => x.id === id);
    if (!m || m.who !== 'char') return;
    if (!Array.isArray(m.swipes)) { m.swipes = [m.text]; m.swipeIdx = 0; }

    if (dir === 'prev') {
        if (m.swipeIdx > 0) { m.swipeIdx--; m.text = m.swipes[m.swipeIdx]; renderChat(); }
        return;
    }
    // dir === 'next'
    if (m.swipeIdx < m.swipes.length - 1) {
        m.swipeIdx++; m.text = m.swipes[m.swipeIdx];
        renderChat();
        return;
    }
    // At the last swipe → generate a new alternative for this turn.
    const idx = messages.indexOf(m);
    const history = historyBefore(idx); // context up to (not incl.) this reply
    m.gen = true;                       // show a spinner on the counter
    setBusy(el, true);
    renderChat();
    try {
        const { text: reply, compiledChat, promptProvenance } = await callEngine(el, history);
        lastCompiledChat = { messages: compiledChat, provenance: promptProvenance };
        syncPromptButton();
        m.swipes.push(reply);
        m.swipeIdx = m.swipes.length - 1;
        m.text = reply;
    } catch (err) {
        // Stay on the current swipe; surface the failure without wrecking the turn.
        window.toastr?.warning?.(err?.message || String(err), 'Swipe failed');
    } finally {
        m.gen = false;
        setBusy(el, false);
        renderChat();
    }
}

// Regenerate from an error/empty note: retry with the same context, replacing
// the note in place with the reply (or a fresh error note).
async function regenNote(el, id) {
    if (busy) return;
    const idx = messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const history = historyBefore(idx);
    const charName = currentCharName(el);

    messages[idx] = { id, who: 'note', name: '', text: `${charName} is thinking…` };
    setBusy(el, true);
    renderChat();
    try {
        const { text: reply, compiledChat, promptProvenance } = await callEngine(el, history);
        lastCompiledChat = { messages: compiledChat, provenance: promptProvenance };
        syncPromptButton();
        messages[idx] = { id, who: 'char', name: charName, text: reply, swipes: [reply], swipeIdx: 0 };
    } catch (err) {
        messages[idx] = { id, who: 'note', name: '', text: `⚠ ${err?.message || err}`, canRegen: true };
    } finally {
        setBusy(el, false);
        renderChat();
    }
}

/** Enable the Prompt button once a compiled prompt exists to show. */
function syncPromptButton() {
    const btn = rootEl?.querySelector('[data-role="prompt"]');
    if (!btn) return;
    const ready = !!lastCompiledChat;
    btn.disabled = !ready;
    btn.classList.toggle('wl-pe-disabled', !ready);
    btn.title = ready
        ? 'View the exact prompt sent to the model on the last generation'
        : 'Send a test message first, then view the exact prompt that was sent';
}

function setBusy(el, on) {
    busy = on;
    const send = el.querySelector('[data-role="send"]');
    if (send) send.disabled = on;
    el.querySelector('.wl-pe-test')?.classList.toggle('wl-pe-busy', on);
}

// ============================================================
// Chat render
// ============================================================

function renderChat() {
    if (!rootEl) return;
    const chat = rootEl.querySelector('[data-role="chat"]');
    if (!chat) return;

    if (messages.length === 0) {
        chat.innerHTML = `<div class="wl-pe-test-empty">Empty test chat.<br><span>Pick a character &amp; persona above, then send a message to try the preset.</span></div>`;
        return;
    }

    // Index of the last character message (gets the swipe control).
    let lastCharIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].who === 'char') { lastCharIdx = i; break; }
    }

    chat.innerHTML = messages.map((m, i) => {
        if (m.who === 'note') {
            const regen = m.canRegen
                ? `<button class="wl-pe-note-regen" data-act="regen" data-id="${m.id}"><i class="fa-solid fa-rotate-right"></i>Regenerate</button>`
                : '';
            return `<div class="wl-pe-msg wl-pe-msg-note"><div class="wl-pe-msg-text">${escapeHtml(m.text)}</div>${regen}</div>`;
        }
        const total = m.swipes?.length || 1;
        const cur = (m.swipeIdx ?? 0) + 1;
        const rightIcon = m.gen
            ? `<i class="fa-solid fa-spinner fa-spin"></i>`
            : `<i class="fa-solid fa-chevron-right" data-swipe="next" data-id="${m.id}" title="Next / generate new"></i>`;
        const swipe = (i === lastCharIdx)
            ? `<span class="wl-pe-swipe" title="Browse / generate alternate responses"><i class="fa-solid fa-chevron-left" data-swipe="prev" data-id="${m.id}" title="Previous"></i>${cur}&nbsp;/&nbsp;${total}${rightIcon}</span>`
            : '';
        // Render like the real chat: ST regex scripts + messageFormatting (markdown,
        // sanitize, scoped <style>). The `mes_text` class is required so embedded
        // <style> blocks — scoped to `.mes_text ` by ST — actually apply here.
        const body = formatTestMessage(m.text, { isUser: m.who === 'user', name: m.name });
        return `
            <div class="wl-pe-msg wl-pe-msg-${m.who}" data-id="${m.id}">
                <div class="wl-pe-msg-head">
                    <span class="wl-pe-who">${escapeHtml(m.name)}</span>
                    ${swipe}
                    <span class="wl-pe-msg-actions">
                        <i class="fa-solid fa-pen" data-act="edit" data-id="${m.id}" title="Edit"></i>
                        <i class="fa-solid fa-trash-can wl-pe-del" data-act="del" data-id="${m.id}" title="Delete"></i>
                    </span>
                </div>
                <div class="wl-pe-msg-text mes_text wl-pe-rendered">${body}</div>
            </div>`;
    }).join('');

    // Row actions (edit / delete).
    chat.querySelectorAll('[data-act="del"]').forEach((i) => {
        i.addEventListener('click', () => {
            messages = messages.filter((m) => m.id !== Number(i.dataset.id));
            renderChat();
        });
    });
    chat.querySelectorAll('[data-act="edit"]').forEach((i) => {
        i.addEventListener('click', () => editMessage(Number(i.dataset.id)));
    });

    // Swipes (browse / generate) on the last character turn.
    chat.querySelectorAll('[data-swipe]').forEach((i) => {
        i.addEventListener('click', () => onSwipe(rootEl, Number(i.dataset.id), i.dataset.swipe));
    });
    // Regenerate after an empty/failed response.
    chat.querySelectorAll('[data-act="regen"]').forEach((b) => {
        b.addEventListener('click', () => regenNote(rootEl, Number(b.dataset.id)));
    });

    chat.scrollTop = chat.scrollHeight;
}

function editMessage(id) {
    const msg = messages.find((m) => m.id === id);
    if (!msg || !rootEl) return;
    const row = rootEl.querySelector(`.wl-pe-msg[data-id="${id}"] .wl-pe-msg-text`);
    if (!row) return;

    const ta = document.createElement('textarea');
    ta.className = 'wl-pe-msg-edit';
    ta.value = msg.text;
    row.replaceWith(ta);

    // Grow to fit the whole message so it never collapses to a tiny box.
    const autoGrow = () => {
        ta.style.height = 'auto';
        ta.style.height = Math.max(ta.scrollHeight, 60) + 'px';
    };
    autoGrow();
    ta.focus();
    // Caret to end rather than selecting the whole message.
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('input', autoGrow);

    const commit = () => {
        msg.text = ta.value.trim() || msg.text;
        // Keep the active swipe in sync when editing a character turn.
        if (Array.isArray(msg.swipes)) msg.swipes[msg.swipeIdx ?? 0] = msg.text;
        renderChat();
    };
    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); renderChat(); }
    });
}

// ============================================================
// Dropdown population (live ST data)
// ============================================================

async function populateDropdowns(el) {
    populateCharacters(el);
    populatePersonas(el);      // async internally
    populateProfiles(el);      // async
    populateSamplers(el);      // async (optional)
}

function populateCharacters(el) {
    const sel = el.querySelector('[data-role="character"]');
    if (!sel) return;
    let chars = [];
    try { chars = getAvailableCharacters() || []; } catch (e) { log('char list failed', e); }
    chars.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    sel.innerHTML = chars.length
        ? chars.map((c) => {
            const name = String(c.name || 'Character');
            const avatar = String(c.avatar || '');
            const filename = avatarFilename(avatar);
            const fullLabel = filename ? `${name} (${filename})` : name;
            const visibleLabel = filename
                ? `${compactLabel(name)} (${compactMiddle(filename)})`
                : compactLabel(name);
            return `<option value="${escapeAttr(avatar)}" data-name="${escapeAttr(name)}" title="${escapeAttr(fullLabel)}">${escapeHtml(visibleLabel)}</option>`;
          }).join('')
        : '<option value="">No characters</option>';
}

async function populatePersonas(el) {
    const sel = el.querySelector('[data-role="persona"]');
    if (!sel) return;
    let personas = [];
    try { personas = (await getAvailablePersonas()) || []; } catch (e) { log('persona list failed', e); }
    personas.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    sel.innerHTML = personas.length
        ? personas.map((p) => {
            const label = p.title ? `${p.name} — (${p.title})` : p.name;
            return `<option value="${escapeAttr(p.avatar)}" data-name="${escapeAttr(p.name)}">${escapeHtml(label)}</option>`;
          }).join('')
        : '<option value="">No personas</option>';
}

async function populateProfiles(el) {
    const sel = el.querySelector('[data-role="profile"]');
    if (!sel) return;
    let names = [];
    try {
        const ctx = getContext();
        const result = await ctx.executeSlashCommandsWithOptions('/profile-list');
        names = JSON.parse(result.pipe);
    } catch (e) {
        log('profile list failed', e);
    }
    sel.innerHTML = (Array.isArray(names) && names.length)
        ? names.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('')
        : '<option value="">Current connection</option>';
}

async function populateSamplers(el) {
    const sel = el.querySelector('[data-role="sampler"]');
    if (!sel) return;

    let presets = null;
    try {
        // Optional dependency: the WhiteLotus sampler-preset catalog. If WL isn't
        // installed the import throws and we keep the plain default option.
        const mod = await import('../../../SillyTavern-WhiteLotus/src/samplerPresets.js');
        presets = mod.SAMPLER_PRESETS || null;
    } catch (e) {
        log('WhiteLotus sampler presets unavailable', e);
    }
    samplerPresets = presets; // remembered so Send can read the chosen preset's values
    if (!presets) return; // leave the single "— Sampler —" option

    // Group by family, preserving first-seen order (same as WL's dropdown).
    const families = [];
    const byFamily = {};
    for (const [key, p] of Object.entries(presets)) {
        const fam = p.family || 'Other';
        if (!byFamily[fam]) { byFamily[fam] = []; families.push(fam); }
        byFamily[fam].push({ key, label: p.label || key, note: p.note });
    }

    let html = '<option value="">— Sampler —</option>';
    for (const fam of families) {
        html += `<optgroup label="${escapeAttr(fam)}">`;
        for (const { key, label, note } of byFamily[fam]) {
            const t = note ? ` title="${escapeAttr(note)}"` : '';
            html += `<option value="${escapeAttr(key)}"${t}>${escapeHtml(label)}</option>`;
        }
        html += '</optgroup>';
    }
    sel.innerHTML = html;
}

// ============================================================
// Utils
// ============================================================

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function compactLabel(value, maxLength = 34) {
    const text = String(value || '');
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function avatarFilename(value) {
    const path = String(value || '').split(/[?#]/, 1)[0].replace(/\\/g, '/');
    return path.split('/').pop() || path;
}

function compactMiddle(value, maxLength = 28) {
    const text = String(value || '');
    if (text.length <= maxLength) return text;
    const tailLength = Math.min(12, Math.floor((maxLength - 1) * 0.4));
    return `${text.slice(0, maxLength - tailLength - 1)}…${text.slice(-tailLength)}`;
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/\n/g, ' ');
}
