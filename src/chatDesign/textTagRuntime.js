import { DOMPurify } from '../../../../../../lib.js';
import { getContext } from '../../../../../extensions.js';
import { getTextTags, replaceTextTagElements } from './textTags.js';

let installed = false;
let selector = '';
let refreshFrame = 0;
const pendingTags = new Set();

/** One root-level sanitizer hook handles streaming, swipes, edits, and history. */
export function syncTextTagRuntime(styles, enabled) {
    if (!installed) {
        DOMPurify.addHook('beforeSanitizeElements', (node, _data, config) => {
            if (!selector || !config.MESSAGE_SANITIZE || node.nodeName !== 'BODY') return;
            replaceTextTagElements(node, selector);
        });
        installed = true;
    }
    const next = enabled ? [...new Set(styles.filter(style => style.element === 'dialogue'
        && style.enabled !== false).flatMap(style => getTextTags(style).map(entry => entry.tag)))].sort().join(',') : '';
    if (next === selector) return;
    for (const tag of `${selector},${next}`.split(',')) {
        if (tag) pendingTags.add(tag);
    }
    selector = next;
    if (refreshFrame) return;
    // Reformat only mounted messages when tag definitions change. Appearance
    // edits need only the usual CSS rebuild, with no rescans of chat history.
    refreshFrame = requestAnimationFrame(() => {
        refreshFrame = 0;
        const matcher = new RegExp(`<\\/?(?:${[...pendingTags].join('|')})(?:\\s|>)`, 'i');
        pendingTags.clear();
        const context = getContext();
        if (typeof context.updateMessageBlock !== 'function') return;
        for (const element of document.querySelectorAll('#chat .mes[mesid]')) {
            if (element.querySelector('.edit_textarea')) continue;
            const id = Number(element.getAttribute('mesid'));
            if (!Number.isInteger(id) || id < 0) continue;
            const message = context.chat?.[id];
            if (message && matcher.test(String(message.mes || ''))) context.updateMessageBlock(id, message);
        }
    });
}
