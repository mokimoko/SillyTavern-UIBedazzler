import { getContext } from '../../../../../extensions.js';
import { user_avatar } from '../../../../../personas.js';
import { saveChatDebounced } from '../../../../../../script.js';
import { cleanAvatar } from '../design/designUtils.js';

const ANCHOR_KEY = 'uibedazzlerGroupAnchor';
let allowedAvatars = new Set();
let revision = 0;

function addAvatar(avatar) {
    if (!avatar) return false;
    const key = cleanAvatar(avatar);
    if (!key || allowedAvatars.has(key)) return false;
    allowedAvatars.add(key);
    revision++;
    return true;
}

function messageAvatar(message) {
    if (message.original_avatar) return cleanAvatar(message.original_avatar);
    try {
        return new URL(message.force_avatar, 'https://tavern.invalid/').searchParams.get('file') || '';
    } catch { return ''; }
}

export function isGroupContext(context = getContext()) {
    return context.groupId != null && context.groupId !== '';
}

/** Select once from chronological chat data, never from the current speaker. */
export function ensureGroupAnchor() {
    const context = getContext();
    if (!isGroupContext(context)) return false;
    const metadata = context.chatMetadata ??= {};
    if (metadata[ANCHOR_KEY]) return false;
    const characters = new Set((context.characters || []).map(character => cleanAvatar(character.avatar)));
    for (const message of context.chat || []) {
        if (message.is_user || message.is_system) continue;
        const avatar = messageAvatar(message);
        if (!avatar || !characters.has(avatar)) continue;
        metadata[ANCHOR_KEY] = avatar;
        addAvatar(avatar);
        saveChatDebounced();
        return true;
    }
    return false;
}

/** All global appearance resolvers share this character identity. */
export function getAppearanceAvatar() {
    const context = getContext();
    if (!isGroupContext(context)) {
        return cleanAvatar(context.characters?.[context.characterId]?.avatar || '');
    }
    const anchor = context.chatMetadata?.[ANCHOR_KEY];
    return anchor && (context.characters || []).some(character => cleanAvatar(character.avatar) === anchor)
        ? anchor : '';
}

export function resetChatScope() {
    allowedAvatars = new Set();
    revision++;
    extendChatScope();
    // Read identities from loaded history once, including rows outside the DOM.
    for (const message of getContext().chat || []) addAvatar(messageAvatar(message));
    ensureGroupAnchor();
}

export function extendChatScope() {
    const before = revision;
    const context = getContext();
    if (isGroupContext(context)) {
        const group = (context.groups || []).find(item => String(item.id) === String(context.groupId));
        for (const avatar of group?.members || []) addAvatar(avatar);
        addAvatar(context.chatMetadata?.[ANCHOR_KEY]);
    } else {
        addAvatar(context.characters?.[context.characterId]?.avatar);
    }
    addAvatar(user_avatar);
    return revision !== before;
}

export function observeChatAvatar(avatar, messageElement = null) {
    const scopeChanged = addAvatar(avatar);
    const context = getContext();
    let anchorChanged = false;
    if (isGroupContext(context) && !context.chatMetadata?.[ANCHOR_KEY]) {
        const isUser = messageElement?.getAttribute?.('is_user') === 'true';
        const isSystem = messageElement?.getAttribute?.('is_system') === 'true';
        const cleaned = cleanAvatar(avatar);
        const isCharacter = (context.characters || [])
            .some(character => cleanAvatar(character.avatar) === cleaned);
        if (!isUser && !isSystem && isCharacter) {
            const metadata = context.chatMetadata ??= {};
            metadata[ANCHOR_KEY] = cleaned;
            saveChatDebounced();
            anchorChanged = true;
        }
    }
    return { scopeChanged, anchorChanged };
}

export function getChatScope() {
    return { allowedAvatars, revision };
}
