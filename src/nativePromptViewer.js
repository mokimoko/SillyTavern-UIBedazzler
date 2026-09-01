// src/nativePromptViewer.js
// Centered replacement for SillyTavern's native raw-prompt view.
//
// In a real chat, clicking a message's "Prompt" action button opens ST's native
// Prompt Itemization popup (token breakdown). That popup has two buttons that
// slide a panel out to the SIDE:
//   • "Show raw prompt"        (#showRawPrompt)  → the exact prompt that was sent
//   • "Diff with previous …"   (#diffPrevPrompt) → a colored diff vs the prior gen
//
// This module lets ST's native handlers populate their raw-prompt container,
// then mirrors that result into a CENTERED overlay and hides the side panel.
// This deliberately leaves prompt selection to ST instead of duplicating its
// private popup state. The overlay is styled exactly like the Expanded Preset
// Drawer's Test-chat prompt viewer
// (.wl-pe-prompt-overlay .wl-pe-pv-*, defined in presetDrawerExpanded.css and
// loaded when this viewer opens). For Chat Completion presets the raw
// prompt is an array of { role, content } and is passed to the same shared
// renderer used by Test chat. Text completion prompts render as one block.
//
// DATA: CHAT_COMPLETION_PROMPT_READY exposes the exact compiled message array.
// We pair it with MESSAGE_RECEIVED's message id and persist it for this viewer.
// ST's itemized-prompt store is retained as a legacy fallback.
//
// GATING: live-gated on the `centeredPromptViewer` setting. When off, our
// interceptors no-op and ST's native side-slide behaves as before. The capture
// listeners are installed once and are cheap; no install/teardown on toggle.
//
// STACKING: ST's popup is a native <dialog> shown with showModal(), so it sits
// in the browser top layer — a normal z-index overlay would hide behind it. We
// therefore make our overlay a <dialog> + showModal() so it stacks above.

import { DOMPurify, localforage } from '../../../../../lib.js';
import { extension_settings, getContext } from '../../../../extensions.js';
import { MODULE_NAME } from './settings.js';
import { ensureFeatureStyle } from './featureStyles.js';
import { renderPromptMessages } from './presetDrawerExpanded/promptViewer.js';
import { EXPANDED_STYLE_ID, expandedStyleUrl } from './presetDrawerExpanded/drawerBridge.js';

const OVERLAY_ID = 'wl-bd-npv-overlay';
export const NPV_SETTING_KEY = 'centeredPromptViewer';

// Flip to true (or set window.BD_NPV_DEBUG = true) to trace id capture + lookup.
const DEBUG = () => !!window.BD_NPV_DEBUG;
const dbg = (...a) => { if (DEBUG()) console.debug('[BD nativePromptViewer]', ...a); };

let installed = false;
let lastMesId = null;
let pendingCompiledPrompt = null;
const compiledPromptCache = new Map();
const promptStorage = localforage.createInstance({ name: 'SillyTavern_Prompts' });
const compiledPromptStorage = localforage.createInstance({ name: 'UIBedazzler_CompiledPrompts' });

function isEnabled() {
    return !!extension_settings?.[MODULE_NAME]?.[NPV_SETTING_KEY];
}

// ============================================================
// Install
// ============================================================

export function initNativePromptViewer() {
    if (installed) return;
    installed = true;

    const context = getContext();
    const events = context?.eventTypes || context?.event_types;

    // This is the public ST boundary where ChatCompletion.getChat() has already
    // produced the exact [{ role, content, name? }] payload sent to the model.
    context?.eventSource?.on?.(events?.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
        if (eventData?.dryRun !== false || !Array.isArray(eventData?.chat)) return;
        pendingCompiledPrompt = structuredClone(eventData.chat);
    });

    // MESSAGE_RECEIVED supplies the authoritative message id, including swipes
    // and group generations. Cache synchronously; persistence can finish later.
    context?.eventSource?.on?.(events?.MESSAGE_RECEIVED, (mesId, type) => {
        if (!pendingCompiledPrompt || type === 'quiet') return;
        const chatId = getContext()?.getCurrentChatId?.();
        if (!chatId) return;

        const prompt = pendingCompiledPrompt;
        pendingCompiledPrompt = null;
        const key = compiledPromptKey(chatId, mesId);
        compiledPromptCache.set(key, prompt);
        void compiledPromptStorage.setItem(key, prompt).catch((err) => {
            console.warn('[BD nativePromptViewer] Could not persist compiled prompt:', err);
        });
    });

    // Observe (do NOT preempt) the native Prompt button so we know which
    // message's itemized entry the popup is about. Native opens the itemization
    // popup on pointerup of `.mes_prompt`; we only record the id here.
    document.addEventListener('pointerup', (e) => {
        const btn = e.target?.closest?.('.mes_prompt');
        if (!btn) return;
        const id = btn.closest('.mes')?.getAttribute('mesid');
        if (id != null) lastMesId = Number(id);
        dbg('prompt button → mesId', id, '→ lastMesId', lastMesId);
    }, true);

    // ST registers its handlers directly on these buttons. Listen during the
    // bubble phase so those handlers run first and populate #rawPromptWrapper;
    // a microtask then mirrors the result before the browser paints the side
    // panel. When the setting is off, this listener is a complete no-op.
    document.addEventListener('click', (e) => {
        if (!isEnabled()) return;
        const target = e.target;
        if (!target?.closest) return;

        if (target.closest('#showRawPrompt')) {
            queueMicrotask(() => void openRaw());
            return;
        }
        if (target.closest('#diffPrevPrompt')) {
            queueMicrotask(() => void openDiff());
        }
    });
}

// ============================================================
// Data helpers
// ============================================================

function rawPromptForMessage(sets, mesId) {
    if (!Array.isArray(sets)) return null;
    const exact = sets.find((entry) => Number(entry?.mesId) === Number(mesId));
    if (exact?.rawPrompt != null) return exact.rawPrompt;
    return sets.findLast?.((entry) => entry?.rawPrompt != null)?.rawPrompt ?? null;
}

function compiledPromptKey(chatId, mesId) {
    return `${chatId}\u001f${Number(mesId)}`;
}

async function loadCapturedRawPrompt(mesId) {
    const chatId = getContext()?.getCurrentChatId?.();
    if (!chatId) return null;
    const key = compiledPromptKey(chatId, mesId);
    if (compiledPromptCache.has(key)) return compiledPromptCache.get(key);

    try {
        const prompt = await compiledPromptStorage.getItem(key);
        if (Array.isArray(prompt)) compiledPromptCache.set(key, prompt);
        return Array.isArray(prompt) ? prompt : null;
    } catch (err) {
        console.warn('[BD nativePromptViewer] Could not load captured prompt:', err);
        return null;
    }
}

/** Load the original structured prompt that ST saved for this real chat. */
async function loadStoredRawPrompt(mesId) {
    try {
        const chatId = getContext()?.getCurrentChatId?.();
        if (!chatId) return null;

        const sets = await promptStorage.getItem(chatId);
        return rawPromptForMessage(sets, mesId);
    } catch (err) {
        console.warn('[BD nativePromptViewer] Could not load structured prompt:', err);
        return null;
    }
}

async function loadStructuredRawPrompt(mesId) {
    return (await loadCapturedRawPrompt(mesId))
        ?? (await loadStoredRawPrompt(mesId));
}

/** A rawPrompt is either a { role, content }[] (chat completion) or a string
 *  (text completion). Flatten to plain text for copy / diff. */
function flatten(rawPrompt) {
    return Array.isArray(rawPrompt)
        ? rawPrompt.map((x) => x?.content ?? '').join('\n')
        : String(rawPrompt ?? '');
}

/** Read the result produced by ST's own button handler, then cancel and hide
 *  its side-slide animation. Reading first is important: the native wrapper is
 *  the reliable fallback when an embedded build exposes a stale module export. */
function takeNativeResult(asHtml = false) {
    const wrapper = document.getElementById('rawPromptWrapper');
    // textContent works even while the native side panel is still display:none;
    // innerText can report an empty string for hidden elements.
    const value = asHtml ? (wrapper?.innerHTML ?? '') : (wrapper?.textContent ?? '');
    const popup = document.getElementById('rawPromptPopup');

    if (popup) {
        const jq = globalThis.jQuery;
        if (jq) jq(popup).stop(true, true).hide();
        else popup.style.display = 'none';
    }

    return value;
}

// ============================================================
// Openers
// ============================================================

async function openRaw() {
    const nativeText = takeNativeResult(false);
    let rawPrompt = await loadStructuredRawPrompt(lastMesId);
    if (rawPrompt == null && nativeText) rawPrompt = nativeText;
    dbg('openRaw: mesId', lastMesId, 'structured', Array.isArray(rawPrompt));

    const messages = Array.isArray(rawPrompt)
        ? rawPrompt
        : [{ role: 'prompt', content: String(rawPrompt ?? '') }];

    const count = Array.isArray(rawPrompt) ? messages.length : 1;
    await ensureFeatureStyle(EXPANDED_STYLE_ID, expandedStyleUrl());
    openOverlay({
        title: 'Compiled prompt',
        sub: rawPrompt == null
            ? 'no prompt captured'
            : Array.isArray(rawPrompt)
                ? `${count} message${count === 1 ? '' : 's'} · as sent to the model`
                : 'legacy prompt · role boundaries unavailable',
        copyText: flatten(rawPrompt),
        render: (body) => renderPromptMessages(
            body,
            rawPrompt == null ? [] : messages,
            [],
            [],
            'No prompt was captured for this message.',
        ),
    });
}

async function openDiff() {
    // ST already calculated and sanitized the correct diff using its private
    // current/prior indices. Mirror that exact output instead of recalculating
    // it from a second lookup.
    const nativeHtml = takeNativeResult(true);
    if (!nativeHtml) return;

    await ensureFeatureStyle(EXPANDED_STYLE_ID, expandedStyleUrl());
    openOverlay({
        title: 'Prompt diff',
        sub: 'changes from the previous generation',
        render: (body) => {
            const msg = document.createElement('div');
            msg.className = 'wl-pe-pv-msg wl-bd-npv-diff';
            const content = document.createElement('div');
            content.className = 'wl-pe-pv-content';
            content.innerHTML = DOMPurify.sanitize(nativeHtml);
            msg.appendChild(content);
            body.appendChild(msg);
        },
    });
}

// ============================================================
// Overlay shell (a <dialog> so it stacks above ST's modal popup)
// ============================================================

function openOverlay({ title, sub, copyText, render }) {
    closeOverlay();

    const dlg = document.createElement('dialog');
    dlg.id = OVERLAY_ID;
    dlg.className = 'wl-pe-prompt-overlay wl-bd-npv';
    dlg.innerHTML = shell(title, sub, !!copyText);
    document.body.appendChild(dlg);

    const body = dlg.querySelector('[data-role="pv-body"]');
    try {
        render(body);
    } catch (err) {
        console.error('[BD nativePromptViewer] render failed:', err);
        body.innerHTML = `<div class="wl-pe-pv-empty">Could not render the prompt.</div>`;
    }

    if (copyText) {
        dlg.querySelector('[data-role="pv-copy"]')?.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(copyText);
                window.toastr?.info?.('Copied!');
            } catch {
                window.toastr?.error?.('Copy failed');
            }
        });
    }

    dlg.querySelector('[data-role="pv-close"]').addEventListener('click', closeOverlay);
    // Backdrop click: on a modal <dialog>, clicks outside the panel land on the
    // dialog element itself.
    dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) closeOverlay(); });
    // Native <dialog> Escape fires a 'cancel' event; take it over so we tear the
    // element down instead of leaving a closed-but-present node.
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeOverlay(); });

    dlg.showModal();
}

function closeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    try { el.close(); } catch { /* not open */ }
    el.remove();
}

function shell(title, sub, hasCopy) {
    const copyBtn = hasCopy
        ? `<button class="wl-pe-pv-copy" data-role="pv-copy" type="button" title="Copy raw prompt to clipboard">
               <i class="fa-solid fa-copy"></i><span>Copy</span>
           </button>`
        : '';
    return `
        <div class="wl-pe-pv-panel" role="dialog" aria-label="${escapeAttr(title)}">
            <div class="wl-pe-pv-head">
                <span class="wl-pe-pv-title"><i class="fa-solid fa-file-code"></i> ${escapeHtml(title)}</span>
                <span class="wl-pe-pv-sub">${escapeHtml(sub)}</span>
                <span class="wl-pe-pv-spacer"></span>
                ${copyBtn}
                <button class="wl-pe-pv-close" data-role="pv-close" type="button" title="Close (Esc)">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="wl-pe-pv-body" data-role="pv-body"></div>
        </div>
    `;
}

// ============================================================
// Utils
// ============================================================

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/\n/g, ' ');
}
