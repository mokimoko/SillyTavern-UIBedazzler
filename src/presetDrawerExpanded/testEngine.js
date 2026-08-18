// Send an isolated Test-tab prompt through a selected connection profile.

import { getContext } from '../../../../../extensions.js';
import { oai_settings } from '../../../../../openai.js';
import { compileTestPrompt } from './testPromptContext.js';

function samplerPayloadFromOai(overrides = null) {
    const settings = oai_settings;
    const pick = (key, fallback) => (overrides && overrides[key] != null ? overrides[key] : fallback);
    const payload = {
        temperature: Number(pick('temp_openai', settings.temp_openai)),
        top_p: Number(pick('top_p_openai', settings.top_p_openai)),
        top_k: Number(pick('top_k_openai', settings.top_k_openai)),
        top_a: Number(pick('top_a_openai', settings.top_a_openai)),
        min_p: Number(pick('min_p_openai', settings.min_p_openai)),
        frequency_penalty: Number(pick('freq_pen_openai', settings.freq_pen_openai)),
        presence_penalty: Number(pick('pres_pen_openai', settings.pres_pen_openai)),
        repetition_penalty: Number(pick('repetition_penalty_openai', settings.repetition_penalty_openai)),
    };
    return Object.fromEntries(Object.entries(payload).filter(([, value]) => Number.isFinite(value)));
}

function resolveProfileId(profileName) {
    if (!profileName) return null;
    const profiles = getContext()?.extensionSettings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return null;
    const profile = profiles.find((item) => item.id === profileName
        || item.name?.toLowerCase() === String(profileName).toLowerCase());
    return profile?.id || null;
}

export async function runTestGeneration(opts) {
    const {
        charAvatar,
        personaAvatar,
        sceneContext = '',
        history = [],
        profileName = null,
        samplerOverride = null,
    } = opts || {};

    const profileId = resolveProfileId(profileName);
    if (!profileId) throw new Error('Pick a connection profile at the top of the Test tab first.');

    const connectionService = getContext()?.ConnectionManagerRequestService;
    if (!connectionService || typeof connectionService.sendRequest !== 'function') {
        throw new Error('Connection Manager is not available in this build.');
    }

    const { compiledChat, promptProvenance, requestPrompt } = await compileTestPrompt({
        charAvatar,
        personaAvatar,
        sceneContext,
        history,
        profileId,
        connectionService,
    });
    const result = await connectionService.sendRequest(
        profileId,
        requestPrompt,
        Number(oai_settings.openai_max_tokens) || 1024,
        {
            stream: false,
            extractData: true,
            // The drawer's current preset compiled this prompt. Do not layer the
            // connection profile's possibly different attached preset over it.
            includePreset: false,
            includeInstruct: true,
        },
        samplerPayloadFromOai(samplerOverride),
    );

    const text = result?.content
        || result?.choices?.[0]?.message?.content
        || result?.text
        || result?.output
        || '';
    if (!text) throw new Error('The model returned an empty response.');
    return { text: String(text).trim(), compiledChat, promptProvenance };
}
