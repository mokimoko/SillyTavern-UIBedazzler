// src/chatDesign/avatarStamp.js
// Stamps each rendered .mes element with a unique avatar identifier so Chat
// Design CSS can target a specific character/persona even when two share a
// display name.
//
// ST renders the source avatar into the message's `.avatar img` src as a
// query param, e.g.:
//   character: /thumbnail?type=avatar&file=Zack.png
//   persona:   /thumbnail?type=persona&file=1739730627885-Joel.png
//
// The `file=` value is the raw avatar filename — unique per entity and the
// same key used by getContext().characters[].avatar and power_user.personas.
// We copy it onto the .mes as `data-wl-avatar`, which the generator targets
// via `.mes[data-wl-avatar="<file>"]`.

const log = () => {};

const CHAT_SELECTOR = '#chat';
let observer = null;
let retryTimer = null;
let stampingRequested = false;

/**
 * Extract the `file=` param from a thumbnail src and decode it.
 * @param {string} src
 * @returns {string} decoded filename, or '' if not found
 */
function avatarFromSrc(src) {
    if (!src) return '';
    try {
        return new URL(src, window.location.href).searchParams.get('file') || '';
    } catch {
        return '';
    }
}

/**
 * Stamp a single .mes element. Reads its `.avatar img` src, parses the
 * avatar filename, and writes it to `data-wl-avatar`. No-op if the img isn't
 * present yet or the filename can't be parsed (caller may retry on render).
 * @param {HTMLElement} mes
 * @returns {boolean} true if stamped
 */
export function stampMessage(mes) {
    if (!mes || mes.nodeType !== 1) return false;
    const img = mes.querySelector('.avatar img');
    if (!img) return false;
    const avatar = avatarFromSrc(img.getAttribute('src'));
    if (!avatar) return false;
    if (mes.dataset.wlAvatar !== avatar) mes.dataset.wlAvatar = avatar;
    return true;
}

/**
 * Stamp all currently-rendered messages. Safe to call repeatedly.
 */
export function stampAllMessages() {
    const chat = document.querySelector(CHAT_SELECTOR);
    if (!chat) return;
    chat.querySelectorAll('.mes:not([data-wl-avatar])').forEach(stampMessage);
}

/**
 * Start observing #chat for added/changed messages and stamp them.
 *
 * Handles three cases:
 *   1. A .mes node is added with its avatar img already populated → stamp now.
 *   2. A .mes is added but the img src is filled a tick later → the img src
 *      attribute mutation is observed and the owning .mes re-stamped.
 *   3. An existing message's avatar img src changes (swipe/edit re-render) →
 *      same attribute path re-stamps it.
 *
 * Idempotent: calling start again tears down the previous observer first.
 */
export function startAvatarStamping() {
    stampingRequested = true;
    const chat = document.querySelector(CHAT_SELECTOR);
    if (!chat) {
        log('startAvatarStamping: #chat not found, deferring');
        if (retryTimer === null) {
            retryTimer = setTimeout(() => {
                retryTimer = null;
                if (stampingRequested) startAvatarStamping();
            }, 200);
        }
        return;
    }

    if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    observer?.disconnect();
    observer = null;

    // Initial pass over anything already rendered.
    stampAllMessages();

    observer = new MutationObserver((mutations) => {
        for (const mut of mutations) {
            // Case 1/2: new nodes added to the chat subtree.
            if (mut.type === 'childList') {
                const owningMessage = mut.target.closest?.('.mes');
                if (owningMessage) {
                    // Once a message is stamped, nested Markdown/streaming DOM
                    // cannot change its identity. An initially-empty message is
                    // revisited only when its avatar subtree arrives.
                    if (!owningMessage.dataset.wlAvatar) {
                        const avatarArrived = [...mut.addedNodes].some(node =>
                            node?.nodeType === 1 && (
                                node.matches?.('.avatar, .avatar img')
                                || node.querySelector?.('.avatar img')
                            ));
                        if (avatarArrived) stampMessage(owningMessage);
                    }
                } else {
                    for (const node of mut.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        if (node.classList?.contains('mes')) {
                            stampMessage(node);
                        } else {
                            node.querySelectorAll?.('.mes').forEach(stampMessage);
                        }
                    }
                }
            }

            // Case 2/3: the avatar img's src attribute changed. Walk up to the
            // owning .mes and re-stamp.
            if (mut.type === 'attributes' && mut.target.nodeType === 1) {
                const t = mut.target;
                if (t.tagName === 'IMG' && t.closest('.avatar')) {
                    const mes = t.closest('.mes');
                    if (mes) stampMessage(mes);
                }
            }
        }
    });

    observer.observe(chat, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src'],
    });

    log('Avatar stamping started');
}

/**
 * Stop observing. Existing data-wl-avatar attributes are left in place.
 */
export function stopAvatarStamping() {
    stampingRequested = false;
    if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    if (observer) {
        observer.disconnect();
        observer = null;
        log('Avatar stamping stopped');
    }
}
