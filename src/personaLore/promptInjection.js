// src/personaLore/promptInjection.js
// Builds narrator lore XML from lore entries and injects at CHAT_COMPLETION_PROMPT_READY
// Placement: immediately after the persona description text within the prompt

import { getContext } from '../../../../../extensions.js';
import { user_avatar } from '../../../../../personas.js';
import { power_user } from '../../../../../power-user.js';
import { getLoreEntries } from './storage.js';
import { cleanAvatar } from '../design/designUtils.js';

const log = () => {};

// ============================================================
// XML Content Builder
// ============================================================

/**
 * Resolve the set of character avatars actually present in the current chat.
 *
 * Solo chats expose `characterId` (index into context.characters) with a null
 * groupId; group chats expose `groupId` with no solo characterId, and the
 * group's `members` array holds the avatar filenames. Disabled group members
 * are excluded — ST won't generate for them, so they aren't "present".
 *
 * @returns {Set<string>|null} Cleaned avatar IDs present, or null if the chat
 *   context can't be resolved (caller then skips filtering rather than
 *   silently dropping every shared entry).
 */
function getPresentCharacterAvatars() {
    const context = getContext();

    // Group chat: members are avatar filenames on the group object.
    if (context.groupId != null) {
        const group = context.groups?.find(g => String(g.id) === String(context.groupId));
        if (!group?.members) return null;

        const disabled = new Set((group.disabled_members || []).map(cleanAvatar));
        const present = group.members
            .map(cleanAvatar)
            .filter(a => !disabled.has(a));

        return new Set(present);
    }

    // Solo chat: single loaded character.
    if (context.characterId != null) {
        const char = context.characters?.[context.characterId];
        if (!char?.avatar) return null;
        return new Set([cleanAvatar(char.avatar)]);
    }

    // No resolvable chat context (welcome screen, etc.)
    return null;
}

/**
 * Build the narrator lore XML prompt from lore entries.
 * Sorts entries into narrator-only vs character-specific shared sections
 * based on each entry's knownBy list.
 *
 * Only characters present in the current chat get a <shared_context> block —
 * an absent character's knowledge is not in play. Entries whose knownBy list
 * resolves to nobody present are demoted to <narrator_context> rather than
 * dropped: the fact is still true of {{user}}, the present cast simply isn't
 * aware of it.
 *
 * @returns {string} XML block to inject, or empty string if no entries
 */
function buildNarratorLoreXML() {
    const avatarId = user_avatar;
    if (!avatarId) return '';

    const entries = getLoreEntries(avatarId);
    if (!entries.length) return '';

    // Get persona name for the root tag attribute
    const personaName = power_user.personas?.[avatarId] || '{{user}}';

    // Get current characters for resolving knownBy names
    const context = getContext();
    const allCharacters = context.characters || [];

    // Who's actually in this chat. null = couldn't resolve; treat every
    // knownBy character as present so we degrade to the old behaviour
    // instead of silently withholding lore.
    const presentAvatars = getPresentCharacterAvatars();
    const isPresent = (charAvatar) =>
        presentAvatars === null || presentAvatars.has(cleanAvatar(charAvatar));

    // Sort entries into visibility buckets
    const narratorOnly = [];
    // Map: characterName → [entries]
    const sharedByChar = new Map();

    for (const entry of entries) {
        if (!entry.knownBy || entry.knownBy.length === 0) {
            // No characters know — narrator only
            narratorOnly.push(entry.content);
            continue;
        }

        // Only characters in this chat can knowingly act on the entry.
        const knownByPresent = entry.knownBy.filter(isPresent);

        if (knownByPresent.length === 0) {
            // Everyone who knows this is absent — still true, just unknown here.
            narratorOnly.push(entry.content);
            continue;
        }

        // Group by each present character who knows this entry
        for (const charAvatar of knownByPresent) {
            const char = allCharacters.find(c => cleanAvatar(c.avatar) === cleanAvatar(charAvatar));
            const charName = char?.name || charAvatar;

            if (!sharedByChar.has(charName)) {
                sharedByChar.set(charName, []);
            }
            sharedByChar.get(charName).push(entry.content);
        }
    }

    // Build XML
    const lines = [];
    lines.push(`<narrator_lore persona="${personaName}">`);

    if (narratorOnly.length > 0) {
        lines.push('<narrator_context>');
        lines.push('These details are known only to you as the narrator.');
        narratorOnly.forEach(c => lines.push(`- ${c}`));
        lines.push('</narrator_context>');
    }

    for (const [charName, charEntries] of sharedByChar) {
        lines.push(`<shared_context character="${charName}">`);
        lines.push(`${charName} is aware of the following about {{user}}.`);
        charEntries.forEach(c => lines.push(`- ${c}`));
        lines.push('</shared_context>');
    }

    lines.push('</narrator_lore>');

    return lines.join('\n');
}

// ============================================================
// Prompt Content Injection
// ============================================================

/**
 * Resolve the persona description with macros replaced, matching
 * what ST puts in the actual prompt content.
 *
 * {{user}} resolves to the *persona* name (power_user.personas[avatar]), not
 * context.name1 — name1 is the account name, which is often something else
 * entirely. ST substitutes the persona name into the description, so matching
 * against name1 produces a string that never appears in the prompt.
 *
 * @returns {string} Resolved persona description, or empty string
 */
function getResolvedPersonaDesc() {
    const raw = power_user.persona_description?.trim();
    if (!raw) return '';

    const context = getContext();
    const avatarId = user_avatar;
    const userName = (avatarId && power_user.personas?.[avatarId]) || context.name1 || '';
    const charName = context.name2 || '';

    return raw
        .replace(/\{\{user\}\}/gi, userName)
        .replace(/\{\{char\}\}/gi, charName);
}

/**
 * Escape a string for literal use inside a RegExp.
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a RegExp that matches `text` with any run of whitespace treated as
 * interchangeable with any other run of whitespace.
 *
 * Presets interpolate the persona description into their own scaffolding, and
 * that round trip can rewrite line endings (\r\n vs \n) or reflow blank lines
 * between paragraphs. A literal includes() then fails on a description that is
 * plainly present. Matching whitespace-loosely survives that.
 */
function buildLooseRegExp(text) {
    const escaped = escapeRegExp(text.trim());
    const loose = escaped.replace(/(\\?\s)+/g, '\\s+');
    return new RegExp(loose);
}

/**
 * Locate the persona description inside a message's content.
 *
 * Tries progressively looser strategies and returns the index just past the
 * end of whatever matched, or -1. Each tier is a superset of the last, so the
 * first hit is always the tightest available:
 *
 *   1. exact substring        — the common case, cheapest
 *   2. whitespace-insensitive — survives \r\n and reflowed blank lines
 *   3. last line/paragraph    — survives a preset mangling earlier text, or an
 *                               unresolved macro up in the body
 *   4. tail sentence          — last resort; the final sentence is usually
 *                               macro-free prose
 *
 * Tiers 3-4 anchor on the *end* of the description, which is where we want to
 * land regardless — so a partial match there is still a correct insertion point.
 *
 * @param {string} content - Message content to search
 * @param {string} desc - Persona description to locate
 * @returns {number} Index just past the description, or -1 if not found
 */
function findPersonaDescEnd(content, desc) {
    const trimmed = desc.trim();
    if (!trimmed || trimmed.length <= 10) return -1;

    // Tier 1: exact
    const exactIdx = content.indexOf(trimmed);
    if (exactIdx !== -1) return exactIdx + trimmed.length;

    // Tier 2: whitespace-insensitive across the whole description
    const looseEnd = matchLoose(content, trimmed);
    if (looseEnd !== -1) return looseEnd;

    // Tier 3: anchor on the last line. Split on any line break — descriptions
    // are frequently paragraphed with single newlines, not blank lines.
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
        const lastLine = lines[lines.length - 1];
        if (lastLine.length > 20) {
            const end = matchLoose(content, lastLine);
            if (end !== -1) return end;
        }
    }

    // Tier 4: anchor on the final sentence. Catches the case where the last
    // line itself contains an unresolved macro earlier in it.
    const lastLine = lines[lines.length - 1] || trimmed;
    const sentences = lastLine.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 1) {
        const tail = sentences[sentences.length - 1];
        if (tail.length > 20) {
            const end = matchLoose(content, tail);
            if (end !== -1) return end;
        }
    }

    return -1;
}

/**
 * Whitespace-insensitive search. Returns index just past the match, or -1.
 */
function matchLoose(content, needle) {
    try {
        const m = buildLooseRegExp(needle).exec(content);
        return m ? m.index + m[0].length : -1;
    } catch {
        return -1; // pathological input → treat as no match
    }
}

/**
 * Find the persona description within the prompt array and inject
 * narrator lore XML directly after it IN THE SAME MESSAGE.
 *
 * Why content injection instead of message splicing:
 * ST's squashSystemMessages() merges consecutive system messages before
 * CHAT_COMPLETION_PROMPT_READY fires. The persona description ends up
 * embedded inside a larger system message. Splicing a new message after
 * it would place it between messages (e.g. before example dialogue),
 * not directly after the persona text. Modifying the content string
 * keeps the narrator lore glued to the persona description.
 *
 * Matching is deliberately anchored to the persona description text rather
 * than any preset-specific wrapper tag, since every preset names its blocks
 * differently — the description travels with the persona, the tags don't.
 *
 * @param {object} eventData - { chat: Array, dryRun: boolean }
 */
export function injectNarratorLore(eventData) {
    if (eventData.dryRun) return;

    const chatMessages = eventData.chat;
    if (!Array.isArray(chatMessages)) return;

    const xml = buildNarratorLoreXML();
    if (!xml) return;

    // Get both raw and resolved versions of the persona description.
    // Resolved first: after macro expansion it's what actually lands in the
    // prompt. Raw is the fallback for descriptions with macros we don't
    // resolve (anything beyond {{user}}/{{char}}).
    const rawDesc = power_user.persona_description?.trim() || '';
    const resolvedDesc = getResolvedPersonaDesc();

    let injected = false;

    // Search through system messages for the one containing persona description
    for (let i = 0; i < chatMessages.length; i++) {
        const msg = chatMessages[i];
        if (msg.role !== 'system' || !msg.content) continue;

        let descEnd = -1;
        if (resolvedDesc) descEnd = findPersonaDescEnd(msg.content, resolvedDesc);
        if (descEnd === -1 && rawDesc && rawDesc !== resolvedDesc) {
            descEnd = findPersonaDescEnd(msg.content, rawDesc);
        }

        if (descEnd !== -1) {
            // Splice our XML right after the persona description text
            msg.content = msg.content.substring(0, descEnd) +
                '\n' + xml +
                msg.content.substring(descEnd);

            log(`Injected narrator lore (${xml.length} chars) into message ${i}, after persona desc at char ${descEnd}`);
            injected = true;
            break;
        }
    }

    // Fallback: if we couldn't find the persona description at all,
    // insert as a separate system message before the last user message
    if (!injected) {
        let fallbackIdx = chatMessages.length;
        for (let i = chatMessages.length - 1; i >= 0; i--) {
            if (chatMessages[i].role === 'user') {
                fallbackIdx = i;
                break;
            }
        }

        chatMessages.splice(fallbackIdx, 0, {
            role: 'system',
            content: xml,
        });

        log(`Fallback: injected narrator lore as separate message at position ${fallbackIdx} (persona desc not found in any message)`);
    }
}

/**
 * Check if there are any lore entries for the current persona.
 * Used to gate injection — no entries means no injection.
 *
 * @returns {boolean}
 */
export function hasNarratorLoreEntries() {
    const avatarId = user_avatar;
    if (!avatarId) return false;
    return getLoreEntries(avatarId).length > 0;
}
