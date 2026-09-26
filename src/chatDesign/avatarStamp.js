// src/chatDesign/avatarStamp.js
// Stamps each rendered .mes element with a unique avatar identifier so Chat
// Design and Persona Design can target entities that share a display name.
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
const clients = new Map();
let observedChat = null;

function notifyClients(avatar, mes) {
    for (const callback of clients.values()) {
        try { callback?.(avatar, mes); } catch {}
    }
}

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
    notifyClients(avatar, mes);
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
 * Multiple features share one observer; repeat calls reuse it for the same chat.
 */
export function startAvatarStamping(callback = null, client = 'chatDesign') {
    const alreadyRegistered = clients.has(client);
    clients.set(client, typeof callback === 'function' ? callback : null);
    const chat = document.querySelector(CHAT_SELECTOR);
    if (!chat) {
        log('startAvatarStamping: #chat not found, deferring');
        if (retryTimer === null) {
            retryTimer = setTimeout(() => {
                retryTimer = null;
                if (clients.size) {
                    const [waitingClient, waitingCallback] = clients.entries().next().value;
                    startAvatarStamping(waitingCallback, waitingClient);
                }
            }, 200);
        }
        return;
    }

    if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    if (observer && observedChat === chat) {
        if (alreadyRegistered && typeof callback !== 'function') return;
        // A new client may need to inspect messages stamped before it joined.
        if (typeof callback === 'function') chat.querySelectorAll('.mes[data-wl-avatar]')
            .forEach(mes => { try { callback(mes.dataset.wlAvatar, mes); } catch {} });
        stampAllMessages();
        return;
    }
    observer?.disconnect();
    observer = null;
    observedChat = chat;

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
export function stopAvatarStamping(client = 'chatDesign') {
    clients.delete(client);
    if (clients.size) return;
    if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    if (observer) {
        observer.disconnect();
        observer = null;
        observedChat = null;
        log('Avatar stamping stopped');
    }
}
