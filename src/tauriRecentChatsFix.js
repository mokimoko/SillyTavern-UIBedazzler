// TauriTavern compatibility fix for duplicate character display names.

const PATCH_MARKER = Symbol.for('UIBedazzler.tauriRecentChatsIdentityFix');
const DIAGNOSTIC_KEY = '__UIBEDAZZLER_TAURI_RECENT_CHATS_FIX__';

function ensureJsonl(value) {
    const text = String(value || '');
    return text.endsWith('.jsonl') ? text : `${text}.jsonl`;
}

function stripJsonl(value) {
    const text = String(value || '');
    return text.endsWith('.jsonl') ? text.slice(0, -'.jsonl'.length) : text;
}

function avatarStem(value) {
    const text = String(value || '');
    return text.endsWith('.png') ? text.slice(0, -'.png'.length) : '';
}

function summaryFingerprint(value, recentShape) {
    return JSON.stringify([
        ensureJsonl(value?.file_name),
        Number(recentShape ? value?.last_mes : value?.date || 0),
        Number(recentShape ? value?.chat_items : value?.message_count || 0),
        String(recentShape ? value?.mes : value?.preview || ''),
    ]);
}

function buildAvatarByStorageId(characters) {
    const result = new Map();
    for (const character of Array.isArray(characters) ? characters : []) {
        const avatar = String(character?.avatar || '');
        const storageId = avatarStem(avatar);
        if (storageId) result.set(storageId, avatar);
    }
    return result;
}

/**
 * Repairs recent-chat avatars only when the backend summary fingerprint maps
 * to one unambiguous character storage directory.
 */
export function repairRecentChatAvatars(recentChats, summaries, characters) {
    if (!Array.isArray(recentChats) || !Array.isArray(summaries)) {
        return { chats: recentChats, repaired: 0 };
    }

    const storageIdsByFingerprint = new Map();
    for (const summary of summaries) {
        const storageId = String(summary?.character_name || '');
        if (!storageId) continue;
        const key = summaryFingerprint(summary, false);
        if (!storageIdsByFingerprint.has(key)) storageIdsByFingerprint.set(key, new Set());
        storageIdsByFingerprint.get(key).add(storageId);
    }

    const avatarByStorageId = buildAvatarByStorageId(characters);
    let repaired = 0;
    const chats = recentChats.map((chat) => {
        if (!chat || chat.group || !chat.avatar) return chat;
        const storageIds = storageIdsByFingerprint.get(summaryFingerprint(chat, true));
        if (!storageIds || storageIds.size !== 1) return chat;

        const [storageId] = storageIds;
        const exactAvatar = avatarByStorageId.get(storageId) || `${storageId}.png`;
        if (exactAvatar === chat.avatar) return chat;
        repaired++;
        return { ...chat, avatar: exactAvatar };
    });

    return { chats, repaired };
}

function isRecentChatsRequest(host, input, init) {
    try {
        const rawUrl = typeof input === 'string' || input instanceof URL
            ? String(input)
            : String(input?.url || '');
        const url = new URL(rawUrl, host.location?.href || 'http://localhost/');
        const method = String(init?.method || input?.method || 'GET').toUpperCase();
        return method === 'POST' && url.pathname === '/api/chats/recent';
    } catch {
        return false;
    }
}

async function readRequestBody(input, init) {
    const body = init?.body;
    if (typeof body === 'string') {
        try { return JSON.parse(body); } catch { return {}; }
    }
    if (body instanceof URLSearchParams) {
        return Object.fromEntries(body.entries());
    }
    if (input && typeof input.clone === 'function') {
        try { return await input.clone().json(); } catch { return {}; }
    }
    return {};
}

function buildPinnedCharacterRefs(pinned) {
    const refs = [];
    const seen = new Set();
    for (const entry of Array.isArray(pinned) ? pinned : []) {
        if (entry?.group) continue;
        const characterName = avatarStem(entry?.avatar);
        const fileName = stripJsonl(entry?.file_name);
        const key = `${characterName}/${fileName}`;
        if (!characterName || !fileName || seen.has(key)) continue;
        seen.add(key);
        refs.push({ character_name: characterName, file_name: fileName });
    }
    return refs;
}

async function loadExactRecentSummaries(host, query) {
    const safeInvoke = host.__TAURITAVERN__?.invoke?.safeInvoke;
    if (typeof safeInvoke !== 'function') return null;

    const pinned = buildPinnedCharacterRefs(query?.pinned);
    const args = { include_metadata: false, pinned };
    const requestedMax = Number.parseInt(query?.max, 10);
    if (Number.isFinite(requestedMax)) {
        args.max_entries = Math.max(0, requestedMax) + pinned.length;
    }
    return safeInvoke('list_recent_chat_summaries', args);
}

function createJsonResponse(host, response, value) {
    const ResponseCtor = host.Response || globalThis.Response;
    const HeadersCtor = host.Headers || globalThis.Headers;
    const headers = new HeadersCtor(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new ResponseCtor(JSON.stringify(value), {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

/** Install an idempotent, Tauri-only wrapper around the already-patched host fetch. */
export function installTauriRecentChatsFix({
    host = globalThis,
    isTauriHost = () => Boolean(host.__TAURI_INTERNALS__),
    getCharacters = () => host.SillyTavern?.getContext?.()?.characters || [],
} = {}) {
    if (!isTauriHost() || typeof host.fetch !== 'function') return false;
    if (host.fetch[PATCH_MARKER]) return true;

    const baseFetch = host.fetch;
    const state = { installed: true, repaired: 0, failures: 0 };
    const patchedFetch = async function (input, init) {
        const shouldRepair = isRecentChatsRequest(host, input, init);
        const queryPromise = shouldRepair ? readRequestBody(input, init) : null;
        const response = await baseFetch.call(this, input, init);
        if (!shouldRepair || !response?.ok) return response;

        try {
            const [query, recentChats] = await Promise.all([
                queryPromise,
                response.clone().json(),
            ]);
            const summaries = await loadExactRecentSummaries(host, query);
            const result = repairRecentChatAvatars(recentChats, summaries, getCharacters());
            if (!result.repaired) return response;
            state.repaired += result.repaired;
            return createJsonResponse(host, response, result.chats);
        } catch (error) {
            state.failures++;
            console.warn('[UIBedazzler] Tauri Recent Chats identity fix failed open.', error);
            return response;
        }
    };

    Object.defineProperty(patchedFetch, PATCH_MARKER, { value: true });
    host.fetch = patchedFetch;
    host[DIAGNOSTIC_KEY] = state;
    return true;
}
