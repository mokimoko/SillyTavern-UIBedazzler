// src/presetDrawerExpanded/promptViewer.js
// Test tab → "Prompt" button. A full-screen popup that shows the RAW prompt of
// the last test generation exactly as ST sent it to the model: one block per
// message, role label + content (native-prompt-viewer style, not JSON).
//
// GROUP VIEW (on by default when groups exist): tints every compiled message
// produced by a colored middle-column block. Provenance comes directly from
// SillyTavern's MessageCollections, so macro and formatting changes are exact.
//
// The compiled prompt is the OpenAI messages array prepareOpenAIMessages() emits
// and ConnectionManager sends: [{ role, content, name? }, ...].

import { getGroupsForViewer } from './groupRender.js';
import { groupForProvenance } from './promptProvenance.js';
import { blockLabelForId, openBlockInEditor } from './promptJump.js';

const OVERLAY_ID = 'wl-pe-prompt-overlay';

let escHandler = null;
let groupsOn = true;

// ============================================================
// Public entry
// ============================================================

/** Open the raw-prompt popup for a compiled messages array. */
export function openPromptViewer(compiledPrompt) {
    closePromptViewer();
    const messages = Array.isArray(compiledPrompt)
        ? compiledPrompt
        : (Array.isArray(compiledPrompt?.messages) ? compiledPrompt.messages : []);
    const provenance = Array.isArray(compiledPrompt?.provenance)
        ? compiledPrompt.provenance
        : [];

    // Ask the group layer for the current preset's groups (already colored,
    // already respecting Auto/Manual/Hidden mode). Empty when hidden or none.
    let groups = [];
    try { groups = (getGroupsForViewer()?.groups) || []; } catch { groups = []; }
    const hasGroups = groups.length > 0;
    if (!hasGroups) groupsOn = false; else groupsOn = true;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'wl-pe-prompt-overlay';
    overlay.innerHTML = shell(messages.length, hasGroups);
    document.body.appendChild(overlay);

    const body = overlay.querySelector('[data-role="pv-body"]');
    renderPromptMessages(body, messages, groups, provenance);

    // Jump-to-block: each message carries a button labeled with its source block.
    // Clicking closes the viewer, flips the right column to Edit, and opens that
    // block's native editor there. Delegated once — survives group re-renders.
    body.addEventListener('click', (e) => {
        const btn = e.target.closest('.wl-pe-pv-jump');
        if (!btn) return;
        const id = btn.dataset.srcId;
        if (!id) return;
        closePromptViewer();
        openBlockInEditor(id);
    });

    // Dismiss: backdrop click, ✕ button, Escape.
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closePromptViewer();
    });
    overlay.querySelector('[data-role="pv-close"]').addEventListener('click', closePromptViewer);

    const toggle = overlay.querySelector('[data-role="pv-groups"]');
    if (toggle) {
        toggle.addEventListener('click', () => {
            groupsOn = !groupsOn;
            toggle.classList.toggle('on', groupsOn);
            renderPromptMessages(body, messages, groups, provenance);
        });
    }

    escHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); closePromptViewer(); } };
    document.addEventListener('keydown', escHandler, true);
}

export function closePromptViewer() {
    if (escHandler) { document.removeEventListener('keydown', escHandler, true); escHandler = null; }
    document.getElementById(OVERLAY_ID)?.remove();
}

// ============================================================
// Shell markup
// ============================================================

function shell(count, hasGroups) {
    const groupsBtn = hasGroups
        ? `<button class="wl-pe-pv-groups on" data-role="pv-groups" type="button" title="Toggle group coloring">
               <i class="fa-solid fa-fill-drip"></i><span>Groups</span>
           </button>`
        : '';
    return `
        <div class="wl-pe-pv-panel" role="dialog" aria-label="Compiled prompt">
            <div class="wl-pe-pv-head">
                <span class="wl-pe-pv-title"><i class="fa-solid fa-file-code"></i> Compiled prompt</span>
                <span class="wl-pe-pv-sub">${count} message${count === 1 ? '' : 's'} · last generation</span>
                <span class="wl-pe-pv-spacer"></span>
                ${groupsBtn}
                <button class="wl-pe-pv-close" data-role="pv-close" type="button" title="Close (Esc)">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="wl-pe-pv-body" data-role="pv-body"></div>
        </div>
    `;
}

// ============================================================
// Body render
// ============================================================

const ROLE_LABEL = { system: 'System', user: 'User', assistant: 'Assistant', tool: 'Tool' };

/** Shared role-card renderer used by both Test chat and real-chat prompts. */
export function renderPromptMessages(
    body,
    messages,
    groups = [],
    provenance = [],
    emptyText = 'No prompt captured yet. Send a message in the Test tab first.',
) {
    if (!body) return;
    if (!messages.length) {
        body.innerHTML = `<div class="wl-pe-pv-empty">${escapeHtml(emptyText)}</div>`;
        return;
    }

    const groupByBlockId = new Map();
    if (groupsOn) for (const group of groups) {
        for (const block of group.blocks) groupByBlockId.set(block.id, group);
    }

    body.innerHTML = messages.map((m, index) => {
        const role = String(m.role || '').toLowerCase();
        const label = ROLE_LABEL[role] || (m.role || 'Message');
        const name = m.name ? ` · ${escapeHtml(m.name)}` : '';
        const content = normalize(m.content);
        const group = groupsOn
            ? groupForProvenance(provenance[index], groupByBlockId)
            : null;
        const escaped = escapeWithBreaks(content);
        const inner = group
            ? `<span class="wl-pe-pv-tint" style="--gc:${escapeAttr(group.color)}">${escaped}</span>`
            : escaped;

        // Jump button: label it with the block this message came from. Independent
        // of group coloring — every provenanced message that maps to a live row
        // gets one, tinted to its group when it has one.
        const srcId = String(provenance[index]?.ids?.[0] || '');
        const src = srcId ? blockLabelForId(srcId) : null;
        const jump = src
            ? `<button type="button" class="wl-pe-pv-jump" data-src-id="${escapeAttr(src.id)}"${group ? ` style="--gc:${escapeAttr(group.color)}"` : ''} title="${escapeAttr(src.editable ? `Edit “${src.label}” in the Edit tab` : `Show “${src.label}” in the list`)}"><i class="fa-solid fa-pen-to-square"></i><span>${escapeHtml(src.label)}</span></button>`
            : '';

        return `
            <div class="wl-pe-pv-msg wl-pe-pv-${escapeAttr(role || 'other')}">
                <div class="wl-pe-pv-role">${escapeHtml(label)}<span class="wl-pe-pv-name">${name}</span>${jump}</div>
                <div class="wl-pe-pv-content">${inner}</div>
            </div>`;
    }).join('');
}

/** Content can be a string or (rarely) an array of content parts. Flatten to text. */
function normalize(content) {
    let s;
    if (typeof content === 'string') s = content;
    else if (Array.isArray(content)) {
        s = content.map((p) => (typeof p === 'string' ? p : (p?.text || ''))).join('');
    } else s = String(content ?? '');
    return s.replace(/\r\n?/g, '\n');
}

// ============================================================
// Utils
// ============================================================

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeWithBreaks(s) {
    return escapeHtml(s).replace(/\n/g, '<br>');
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/\n/g, ' ');
}
