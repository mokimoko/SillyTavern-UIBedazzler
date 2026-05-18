// src/personaLore/promptInjection.js
// Builds narrator lore XML from lore entries and injects at CHAT_COMPLETION_PROMPT_READY
// Placement: immediately after the persona description text within the prompt

import { getContext } from '../../../../../extensions.js';
import { user_avatar } from '../../../../../personas.js';
import { power_user } from '../../../../../power-user.js';
import { getLoreEntries } from './storage.js';

const log = (...args) => console.log('[WL NarratorLore]', ...args);

/**
 * Strip path/query from avatar filenames for safe comparison
 * @param {string} avatar - Avatar filename or path
 * @returns {string} Clean filename
 */
function cleanAvatar(avatar) {
    if (!avatar) return '';
    return avatar.replace(/\?.*$/, '').replace(/^.*[\\/]/, '');
}

// ============================================================
// XML Content Builder
// ============================================================

/**
 * Build the narrator lore XML prompt from lore entries.
 * Sorts entries into narrator-only vs character-specific shared sections
 * based on each entry's knownBy list.
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

    // Sort entries into visibility buckets
    const narratorOnly = [];
    // Map: characterName → [entries]
    const sharedByChar = new Map();

    for (const entry of entries) {
        if (!entry.knownBy || entry.knownBy.length === 0) {
            // No characters know — narrator only
            narratorOnly.push(entry.content);
        } else {
            // Group by each character who knows this entry
            for (const charAvatar of entry.knownBy) {
                const char = allCharacters.find(c => cleanAvatar(c.avatar) === cleanAvatar(charAvatar));
                const charName = char?.name || charAvatar;

                if (!sharedByChar.has(charName)) {
                    sharedByChar.set(charName, []);
                }
                sharedByChar.get(charName).push(entry.content);
            }
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
 * @returns {string} Resolved persona description, or empty string
 */
function getResolvedPersonaDesc() {
    const raw = power_user.persona_description?.trim();
    if (!raw) return '';

    const context = getContext();
    const userName = context.name1 || '';
    const charName = context.name2 || '';

    return raw
        .replace(/\{\{user\}\}/gi, userName)
        .replace(/\{\{char\}\}/gi, charName);
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
 * @param {object} eventData - { chat: Array, dryRun: boolean }
 */
export function injectNarratorLore(eventData) {
    if (eventData.dryRun) return;

    const chatMessages = eventData.chat;
    if (!Array.isArray(chatMessages)) return;

    const xml = buildNarratorLoreXML();
    if (!xml) return;

    // Get both raw and resolved versions of the persona description
    const rawDesc = power_user.persona_description?.trim() || '';
    const resolvedDesc = getResolvedPersonaDesc();

    let injected = false;

    // Search through system messages for the one containing persona description
    for (let i = 0; i < chatMessages.length; i++) {
        const msg = chatMessages[i];
        if (msg.role !== 'system' || !msg.content) continue;

        // Try resolved first (most likely after squash), then raw
        let descText = null;
        if (resolvedDesc && msg.content.includes(resolvedDesc)) {
            descText = resolvedDesc;
        } else if (rawDesc && rawDesc.length > 10 && msg.content.includes(rawDesc)) {
            descText = rawDesc;
        }

        if (descText) {
            // Find the end of the persona description within this message
            const descEnd = msg.content.indexOf(descText) + descText.length;

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
