// src/presetDrawerExpanded/messageRender.js
// Render a Test-tab message the way the REAL chat renders it, so presets that
// rely on ST regex scripts and/or embedded HTML/CSS behave exactly as they
// would in a live conversation.
//
// Real ST applies regex + formatting in two stages (see public/script.js):
//   1. "Stored" pass — getRegexedString(text, AI_OUTPUT|USER_INPUT) with no
//      isMarkdown/isPrompt flag. This runs the plain "run on all" scripts (the
//      ones most display presets use) and is applied to the message ST saves
//      (script.js: getMessage/messageText at generation & send time).
//   2. Display pass — messageFormatting(...) which internally runs the
//      markdown-only regex scripts (isMarkdown:true), converts markdown to HTML,
//      sanitizes with DOMPurify, and scopes embedded <style> blocks to
//      `.mes_text ` (decodeStyleTags). That last part is why the container the
//      HTML lands in must carry the `mes_text` class — otherwise message CSS
//      silently matches nothing.
//
// We keep the message's raw text untouched (m.text stays the editable source
// and the prompt-history source); this module only produces DISPLAY HTML.

import { messageFormatting } from '../../../../../../script.js';
import { getRegexedString, regex_placement } from '../../../../../extensions/regex/engine.js';

// A synthetic message id that never collides with the real chat[] array:
//  - `Number(messageId) === 0` guard in messageFormatting stays false, so it
//    never mutates chat[0].mes;
//  - chat[-1] is undefined, so narrator-type detection and depth calc no-op
//    (depth becomes undefined → depth-limited regex scripts simply all run,
//    which is the correct default for an isolated preview).
const TEST_MES_ID = -1;

function escapeHtmlFallback(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Produce sanitized display HTML for a test-chat message, matching real chat.
 * @param {string} rawText  The message's raw source text.
 * @param {object} opts
 * @param {boolean} opts.isUser  true → persona/user turn, false → character turn.
 * @param {string}  opts.name    Speaker name (character or persona), used as the
 *                               regex characterOverride and messageFormatting ch_name.
 * @returns {string} DOMPurify-sanitized HTML ready to inject.
 */
export function formatTestMessage(rawText, { isUser = false, name = '' } = {}) {
    const text = String(rawText ?? '');
    if (!text) return '';

    const placement = isUser ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;

    // Stage 1 — "stored" regex pass (plain, non-markdown, non-prompt scripts).
    let mes = text;
    try {
        mes = getRegexedString(mes, placement, { characterOverride: name });
    } catch (err) {
        console.warn('[BD Test] regex pass failed; using raw text', err);
        mes = text;
    }

    // Stage 2 — display formatting (markdown-regex pass + markdown → HTML +
    // sanitize + scoped <style>). isSystem=false so regex/markdown actually run.
    try {
        return messageFormatting(mes, name, /* isSystem */ false, !!isUser, TEST_MES_ID);
    } catch (err) {
        console.warn('[BD Test] messageFormatting failed; falling back to escaped text', err);
        return escapeHtmlFallback(text);
    }
}
