// Build the Test tab's isolated prompt from selected character/persona state.

import { oai_settings, prepareOpenAIMessages, promptManager, setOpenAIMessageExamples } from '../../../../../openai.js';
import {
    characters,
    chat,
    chat_metadata,
    depth_prompt_depth_default,
    depth_prompt_role_default,
    extension_prompt_roles,
    extension_prompt_types,
    extension_prompts,
    getExtensionPromptRoleByName,
    name1,
    name2,
    parseMesExamples,
    setCharacterId,
    setCharacterName,
    setExtensionPrompt,
    setUserName,
    substituteParams,
    this_chid,
    unshallowCharacter,
} from '../../../../../../script.js';
import { inject_ids } from '../../../../../constants.js';
import { persona_description_positions } from '../../../../../personas.js';
import { getWorldInfoPrompt, wi_anchor_position, world_info_include_names } from '../../../../../world-info.js';
import { power_user } from '../../../../../power-user.js';
import { cleanAvatar } from '../design/designUtils.js';
import { capturePromptProvenance } from './promptProvenance.js';

const PERSONA_PROMPT = 'PERSONA_DESCRIPTION';
const AUTHORS_NOTE_PROMPT = '2_floating_prompt';

function findChidByAvatar(avatar) {
    const clean = cleanAvatar(avatar || '');
    return clean ? characters.findIndex((character) => cleanAvatar(character.avatar) === clean) : -1;
}

function resolvePersona(avatar) {
    const clean = cleanAvatar(avatar || '');
    const descriptor = power_user?.persona_descriptions?.[avatar]
        || power_user?.persona_descriptions?.[clean];
    const personaName = power_user?.personas?.[avatar] || power_user?.personas?.[clean];
    if (!clean || !personaName) return null;
    return {
        name: String(personaName),
        description: String(descriptor?.description || '').trim(),
        position: Number(descriptor?.position ?? persona_description_positions.IN_PROMPT),
        depth: Number(descriptor?.depth ?? 2),
        role: Number(descriptor?.role ?? extension_prompt_roles.SYSTEM),
        lorebook: String(descriptor?.lorebook || ''),
    };
}

function macroReplace(value, charName, personaName, dynamicMacros = {}) {
    return String(substituteParams(String(value || ''), {
        name1Override: personaName,
        name2Override: charName,
        replaceCharacterCard: false,
        dynamicMacros,
    }) || '').replace(/\r/g, '');
}

// Read the card directly: getCharacterCardFields also reads chat_metadata and
// group state, which would leak the real chat into this isolated prompt.
function resolveCharacter(chid, persona) {
    const character = characters[chid];
    if (!character) return null;
    const charName = String(character.name || 'Character');
    const base = (value) => macroReplace(value, charName, persona.name);
    const cardMacros = {
        description: base(character.description),
        personality: base(character.personality),
        scenario: base(character.scenario),
        persona: persona.description,
        mesExamples: base(character.mes_example),
        mesExamplesRaw: base(character.mes_example),
        charDepthPrompt: base(character.data?.extensions?.depth_prompt?.prompt),
        creatorNotes: base(character.data?.creator_notes),
        charPrompt: base(character.data?.system_prompt),
        charInstruction: base(character.data?.post_history_instructions),
        charJailbreak: base(character.data?.post_history_instructions),
        charVersion: String(character.data?.character_version || ''),
        char_version: String(character.data?.character_version || ''),
    };
    const expand = (value) => macroReplace(value, charName, persona.name, cardMacros);
    return {
        name: charName,
        description: expand(character.description),
        personality: expand(character.personality),
        scenario: expand(character.scenario),
        mesExamples: expand(character.mes_example),
        charDepthPrompt: expand(character.data?.extensions?.depth_prompt?.prompt),
        creatorNotes: expand(character.data?.creator_notes),
        system: power_user.prefer_character_prompt ? expand(character.data?.system_prompt) : '',
        jailbreak: power_user.prefer_character_jailbreak
            ? expand(character.data?.post_history_instructions)
            : '',
        depth: Number(character.data?.extensions?.depth_prompt?.depth ?? depth_prompt_depth_default),
        depthRole: getExtensionPromptRoleByName(
            character.data?.extensions?.depth_prompt?.role ?? depth_prompt_role_default,
        ),
    };
}

function snapshotExtensionPrompts() {
    return Object.fromEntries(
        Object.entries(extension_prompts).map(([key, value]) => [key, { ...value }]),
    );
}

function clearExtensionPrompts() {
    for (const key of Object.keys(extension_prompts)) delete extension_prompts[key];
}

function blankExtensionPrompts() {
    for (const [key, value] of Object.entries(extension_prompts)) {
        extension_prompts[key] = { ...value, value: '' };
    }
    // Core persona assembly dereferences these slots even when they are empty.
    if (!extension_prompts[AUTHORS_NOTE_PROMPT]) {
        setExtensionPrompt(AUTHORS_NOTE_PROMPT, '', extension_prompt_types.IN_PROMPT, 0);
    }
    if (!extension_prompts[PERSONA_PROMPT]) {
        setExtensionPrompt(PERSONA_PROMPT, '', extension_prompt_types.IN_PROMPT, 0);
    }
}

function restoreExtensionPrompts(snapshot) {
    clearExtensionPrompts();
    for (const [key, value] of Object.entries(snapshot)) extension_prompts[key] = value;
}

function applyInjections(persona, fields, worldInfo = null) {
    const authorNotePosition = [persona_description_positions.TOP_AN,
        persona_description_positions.BOTTOM_AN].includes(persona.position);
    if (persona.description && authorNotePosition) {
        setExtensionPrompt(AUTHORS_NOTE_PROMPT, persona.description,
            extension_prompt_types.IN_CHAT, persona.depth, true, persona.role);
    }
    if (persona.description && persona.position === persona_description_positions.AT_DEPTH) {
        setExtensionPrompt(PERSONA_PROMPT, persona.description, extension_prompt_types.IN_CHAT,
            persona.depth, true, persona.role);
    }
    if (fields.charDepthPrompt) {
        setExtensionPrompt(inject_ids.DEPTH_PROMPT, fields.charDepthPrompt,
            extension_prompt_types.IN_CHAT, fields.depth, false, fields.depthRole);
    }
    for (const entry of (worldInfo?.worldInfoDepth || [])) {
        setExtensionPrompt(inject_ids.CUSTOM_WI_DEPTH_ROLE(entry.depth, entry.role),
            (entry.entries || []).join('\n'), extension_prompt_types.IN_CHAT,
            entry.depth, false, entry.role);
    }
    for (const [key, entries] of Object.entries(worldInfo?.outletEntries || {})) {
        setExtensionPrompt(inject_ids.CUSTOM_WI_OUTLET(key), (entries || []).join('\n'),
            extension_prompt_types.NONE, 0);
    }
}

function buildHistory(history, fields, persona) {
    const chronological = history
        .filter((message) => message.who === 'char' || message.who === 'user')
        .map((message) => {
            const isUser = message.who === 'user';
            const speaker = isUser ? persona.name : fields.name;
            const raw = String(message.text || '').replace(/\r/g, '');
            // names_behavior.CONTENT is 2. COMPLETION consumes `name` below.
            const content = Number(oai_settings.names_behavior) === 2 ? `${speaker}: ${raw}` : raw;
            return { role: isUser ? 'user' : 'assistant', content, name: speaker };
        });

    // prepareOpenAIMessages consumes the same newest-first history produced by
    // ST's setOpenAIMessages(). It reverses that pool while inserting it into
    // the final prompt, so passing chronological history here inverted every
    // multi-turn test and made the oldest user instruction appear last.
    return chronological.reverse();
}

function buildScopedChat(history, charName, persona) {
    return history
        .filter((message) => message.who === 'char' || message.who === 'user')
        .map((message) => ({
            is_user: message.who === 'user',
            is_system: false,
            name: message.who === 'user' ? persona.name : charName,
            mes: String(message.text || '').replace(/\r/g, ''),
            extra: {},
        }));
}

function buildWorldInfoHistory(history, fields, persona) {
    return history
        .filter((message) => message.who === 'char' || message.who === 'user')
        .map((message) => {
            const speaker = message.who === 'user' ? persona.name : fields.name;
            const text = String(message.text || '');
            return world_info_include_names ? `${speaker}: ${text}` : text;
        })
        .reverse();
}

function buildExamples(fields, persona, worldInfo) {
    const blocks = parseMesExamples(fields.mesExamples, false);
    for (const example of (worldInfo.worldInfoExamples || [])) {
        const expanded = macroReplace(example.content, fields.name, persona.name);
        const parsed = parseMesExamples(expanded, false);
        if (example.position === wi_anchor_position.before) blocks.unshift(...parsed);
        else blocks.push(...parsed);
    }
    return setOpenAIMessageExamples(blocks);
}

function cloneExtensionPrompts() {
    return Object.fromEntries(
        Object.entries(extension_prompts).map(([key, value]) => [key, { ...value }]),
    );
}

function snapshotPromptManager() {
    const counts = promptManager?.tokenHandler?.getCounts?.() || {};
    return {
        activeCharacter: promptManager?.activeCharacter,
        messages: promptManager?.messages,
        overriddenPrompts: promptManager?.overriddenPrompts,
        error: promptManager?.error,
        tokenUsage: promptManager?.tokenUsage,
        tokenCounts: { ...counts },
    };
}

function restorePromptManager(snapshot) {
    if (!promptManager || !snapshot) return;
    promptManager.activeCharacter = snapshot.activeCharacter;
    promptManager.messages = snapshot.messages;
    promptManager.overriddenPrompts = snapshot.overriddenPrompts;
    promptManager.error = snapshot.error;
    promptManager.tokenUsage = snapshot.tokenUsage;
    const counts = promptManager.tokenHandler?.getCounts?.();
    if (counts) {
        for (const key of Object.keys(counts)) delete counts[key];
        Object.assign(counts, snapshot.tokenCounts);
    }
}

function testPromptManagerCharacter(chid) {
    const config = promptManager?.configuration?.promptOrder;
    if (config?.strategy === 'global') return { id: config.dummyId };
    return { id: String(chid), ...characters[chid] };
}

/** Assemble the selected test state, restoring every temporary ST global. */
export async function compileTestPrompt({
    charAvatar,
    personaAvatar,
    sceneContext = '',
    history = [],
    profileId,
    connectionService,
}) {
    const chid = findChidByAvatar(charAvatar);
    if (chid < 0) throw new Error('Select a valid test character.');
    await unshallowCharacter(String(chid));
    const persona = resolvePersona(personaAvatar);
    if (!persona) throw new Error('Select a valid test persona.');

    const savedIdentity = { chid: this_chid, charName: name2, userName: name1 };
    const savedPersona = {
        description: power_user.persona_description,
        position: power_user.persona_description_position,
        depth: power_user.persona_description_depth,
        role: power_user.persona_description_role,
        lorebook: power_user.persona_description_lorebook,
    };
    const savedExtensionPrompts = snapshotExtensionPrompts();
    const savedPromptManager = snapshotPromptManager();
    const savedChat = [...chat];
    const savedChatMetadata = { ...chat_metadata };

    try {
        // PromptManager still resolves macros from ST globals. Scope the chosen
        // identities to assembly only; this is the missing piece that previously
        // made {{char}} resolve to "SillyTavern System" on the welcome screen.
        setCharacterId(chid);
        setCharacterName(characters[chid].name);
        setUserName(persona.name, { toastPersonaNameChange: false });
        promptManager.activeCharacter = testPromptManagerCharacter(chid);
        Object.assign(power_user, {
            persona_description: persona.description,
            persona_description_position: persona.position,
            persona_description_depth: persona.depth,
            persona_description_role: persona.role,
            persona_description_lorebook: persona.lorebook,
        });

        const selectedCharName = String(characters[chid].name || 'Character');
        chat.splice(0, chat.length, ...buildScopedChat(history, selectedCharName, persona));
        for (const key of Object.keys(chat_metadata)) delete chat_metadata[key];
        const fields = resolveCharacter(chid, persona);
        const scenario = sceneContext.trim()
            ? [fields.scenario, macroReplace(sceneContext.trim(), fields.name, persona.name)]
                .filter(Boolean).join('\n\n')
            : fields.scenario;

        // Live extension prompts contain chat-bound memory, Author's Note,
        // vectors, and plugin context. Rebuild only isolated test injections.
        blankExtensionPrompts();
        applyInjections(persona, fields);
        const worldInfo = await getWorldInfoPrompt(
            buildWorldInfoHistory(history, fields, persona),
            Number(oai_settings.openai_max_context) || 8192,
            true,
            {
                personaDescription: persona.description,
                characterDescription: fields.description,
                characterPersonality: fields.personality,
                characterDepthPrompt: fields.charDepthPrompt,
                scenario,
                creatorNotes: fields.creatorNotes,
                trigger: 'normal',
            },
        );
        applyInjections(persona, fields, worldInfo);

        const [compiledChat] = await prepareOpenAIMessages({
            name2: fields.name,
            charDescription: fields.description,
            charPersonality: fields.personality,
            scenario,
            worldInfoBefore: worldInfo.worldInfoBefore || '',
            worldInfoAfter: worldInfo.worldInfoAfter || '',
            extensionPrompts: cloneExtensionPrompts(),
            bias: '',
            type: 'normal',
            quietPrompt: '',
            quietImage: null,
            cyclePrompt: '',
            systemPromptOverride: fields.system,
            jailbreakPromptOverride: fields.jailbreak,
            messages: buildHistory(history, fields, persona),
            messageExamples: buildExamples(fields, persona, worldInfo),
        }, true);
        if (!Array.isArray(compiledChat) || !compiledChat.length) {
            throw new Error('Prompt assembly returned nothing.');
        }
        const promptProvenance = capturePromptProvenance(promptManager, compiledChat);
        const requestPrompt = typeof connectionService.constructPrompt === 'function'
            ? connectionService.constructPrompt(compiledChat, profileId)
            : compiledChat;
        return { compiledChat, promptProvenance, requestPrompt };
    } finally {
        restoreExtensionPrompts(savedExtensionPrompts);
        chat.splice(0, chat.length, ...savedChat);
        for (const key of Object.keys(chat_metadata)) delete chat_metadata[key];
        Object.assign(chat_metadata, savedChatMetadata);
        Object.assign(power_user, {
            persona_description: savedPersona.description,
            persona_description_position: savedPersona.position,
            persona_description_depth: savedPersona.depth,
            persona_description_role: savedPersona.role,
            persona_description_lorebook: savedPersona.lorebook,
        });
        setCharacterId(savedIdentity.chid);
        setCharacterName(savedIdentity.charName);
        setUserName(savedIdentity.userName, { toastPersonaNameChange: false });
        restorePromptManager(savedPromptManager);
    }
}
