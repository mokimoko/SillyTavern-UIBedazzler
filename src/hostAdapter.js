// src/hostAdapter.js — dual-target backend adapter for UIBedazzler.
//
// One codebase, two hosts:
//   • 'server' — real SillyTavern with the nebula-loader server plugin.
//                Uses the existing /api/plugins/nebula-loader/* endpoints.
//                Behavior is identical to pre-adapter UIBedazzler.
//   • 'tauri'  — TauriTavern (Rust/Tauri backend, no Node plugin host).
//                Assets are served from the extension folder; discovery uses a
//                cursors.json manifest; audio upload routes through TT's native
//                upload_user_file invoke.
//   • 'plain'  — vanilla ST without the plugin. Graceful no-op, same as today.
//
// Feature code should import `getAdapter()` and call adapter.* instead of
// hardcoding PLUGIN_BASE / ASSETS / fetch('/api/plugins/nebula-loader/...').
// The adapter is resolved once (async, cached) at first use.

const PLUGIN_BASE = '/api/plugins/nebula-loader';
const EXT_BASE = '/scripts/extensions/third-party/SillyTavern-UIBedazzler';
// Where shipped assets live once relocated into the extension. Both hosts serve
// this path, so it's the single source of truth for icon-set CSS, the Phosphor
// font, favicon, logo, and the default-Assistant image. They live in an
// assets/nebula/ subfolder so they don't collide with UIBedazzler's own assets.
const EXT_ASSETS = `${EXT_BASE}/assets/nebula`;
// The nebula-loader plugin's own asset route (used only on the 'server' host if
// you ever want to fall back to plugin-served assets instead of extension ones).
const PLUGIN_ASSETS = `${PLUGIN_BASE}/assets`;

// ---------------------------------------------------------------------------
// Host detection (run once, cached in _adapterPromise)
// ---------------------------------------------------------------------------

async function probeInfo() {
    try {
        const res = await fetch(`${PLUGIN_BASE}/info`, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

function isTauriHost() {
    // Primary: the Tauri webview injects this global before any app JS runs.
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) return true;
    // Fallback: TauriTavern ships this stylesheet into the served shell.
    try {
        return !!document.querySelector(
            'link[href*="tauritavern-embedded-runtime.css"]',
        );
    } catch {
        return false;
    }
}

async function detectHost() {
    const info = await probeInfo();
    if (info) return { host: 'server', info };
    if (isTauriHost()) return { host: 'tauri', info: null };
    return { host: 'plain', info: null };
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

// Shared helpers -----------------------------------------------------------

const UNAVAILABLE_CURSORS = Object.freeze({
    available: false, loaded: true, framesAvailable: false,
    root: 'user/files/cursors', sets: [], loose: [],
});

const LOADER_SKIN_STYLE_ID = 'bd-nebula-loader-skin';

// Runtime injection of the loading-screen skin. On the 'server' host the
// nebula-loader plugin already patches loader.css on disk, so this is a no-op
// there. On 'tauri' (and any host without that on-disk patch) we fetch the
// shipped loader-skin.css, substitute the asset base for the logo url(), and
// drop it into <head> as a <style>. Idempotent — re-inject just replaces.
async function injectLoaderSkin(assetBase) {
    try {
        if (document.getElementById(LOADER_SKIN_STYLE_ID)) return true;
        const res = await fetch(`${assetBase}/loader-skin.css`, { cache: 'no-store' });
        if (!res.ok) return false;
        let css = await res.text();
        css = css.split('__ASSET_BASE__').join(assetBase);
        const style = document.createElement('style');
        style.id = LOADER_SKIN_STYLE_ID;
        style.textContent = css;
        document.head.append(style);
        return true;
    } catch {
        return false;
    }
}

function removeLoaderSkin() {
    document.getElementById(LOADER_SKIN_STYLE_ID)?.remove();
}

// server backend: current behavior, endpoints intact -----------------------

function serverBackend(info) {
    const assetsVersion = String(info?.assetsVersion ?? '0');
    return {
        host: 'server',
        capabilities: {
            assets: true, cursors: true, frames: info?.frames === true,
            audio: true, bgm: true,
            // The plugin advertises card support under features.assistantSwap.
            assistant: !!info?.features?.assistantSwap,
        },
        features: info?.features ?? {},
        serverSkinsLoader: true, // plugin patches loader.css on disk
        // No-ops: the plugin already skinned the loader on disk at boot.
        async injectLoaderSkin() { return true; },
        removeLoaderSkin() { /* plugin-managed on server */ },
        assetsVersion,
        // Prefer extension-hosted assets even on server so there's ONE copy.
        // (Flip to `${PLUGIN_BASE}/assets` here to fall back to plugin-served.)
        assetBase: () => EXT_ASSETS,
        iconSetCssUrl: (file) => `${EXT_ASSETS}/${file}`,
        assetUrl: (name, v = assetsVersion) => `${EXT_ASSETS}/${name}?v=${v}`,

        async cursorsDiscover() {
            try {
                const res = await fetch(`${PLUGIN_BASE}/cursors/list`, { cache: 'no-store' });
                if (!res.ok) return { ...UNAVAILABLE_CURSORS };
                const data = await res.json();
                if (!data || data.ok !== true) return { ...UNAVAILABLE_CURSORS };
                return {
                    available: true, loaded: true,
                    framesAvailable: data.frames === true,
                    root: data.root || UNAVAILABLE_CURSORS.root,
                    sets: Array.isArray(data.sets) ? data.sets : [],
                    loose: Array.isArray(data.loose) ? data.loose : [],
                };
            } catch {
                return { ...UNAVAILABLE_CURSORS };
            }
        },

        async audioListFolders(root = '') {
            const res = await fetch(`${PLUGIN_BASE}/audio/folders?root=${encodeURIComponent(root)}`);
            return res.json();
        },
        async audioListTracks(dir = '') {
            const res = await fetch(`${PLUGIN_BASE}/audio/tracks?dir=${encodeURIComponent(dir)}`);
            return res.json();
        },
        async audioUpload(files) {
            const res = await fetch(`${PLUGIN_BASE}/audio/upload`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files }),
            });
            return res.json();
        },
        async bgmUpload(files) {
            const res = await fetch(`${PLUGIN_BASE}/bgm/upload`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files }),
            });
            return res.json();
        },

        async assistantStatus() {
            const res = await fetch(`${PLUGIN_BASE}/assistant/status`);
            return res.json();
        },
        async assistantApply() {
            const res = await fetch(`${PLUGIN_BASE}/assistant/apply`, { method: 'POST' });
            return res.json();
        },
        async assistantRestore() {
            const res = await fetch(`${PLUGIN_BASE}/assistant/restore`, { method: 'POST' });
            return res.json();
        },
    };
}

// tauri backend: extension-hosted assets, manifest discovery, invoke upload --

function tauriBackend() {
    return {
        host: 'tauri',
        capabilities: {
            assets: true, cursors: true, frames: false,
            audio: true, bgm: true, assistant: true, // DOM-swap fallback (below)
        },
        features: { assistantSwap: true }, // DOM-swap, so the settings row shows
        serverSkinsLoader: false, // UIBedazzler must inject the loader skin itself
        async injectLoaderSkin() { return injectLoaderSkin(EXT_ASSETS); },
        removeLoaderSkin() { removeLoaderSkin(); },
        assetsVersion: '0',
        assetBase: () => EXT_ASSETS,
        iconSetCssUrl: (file) => `${EXT_ASSETS}/${file}`,
        assetUrl: (name) => `${EXT_ASSETS}/${name}`,

        // No folder-scan endpoint on TT — read a manifest the user drops in.
        // Served statically at /user/files/cursors/cursors.json.
        async cursorsDiscover() {
            try {
                const res = await fetch('/user/files/cursors/cursors.json', { cache: 'no-store' });
                if (!res.ok) return { ...UNAVAILABLE_CURSORS };
                const data = await res.json();
                return {
                    available: true, loaded: true, framesAvailable: false,
                    root: data.root || UNAVAILABLE_CURSORS.root,
                    sets: Array.isArray(data.sets) ? data.sets : [],
                    loose: Array.isArray(data.loose) ? data.loose : [],
                };
            } catch {
                return { ...UNAVAILABLE_CURSORS };
            }
        },

        // TODO(confirm invoke signature): route to TT's upload_user_file.
        // Placeholder shape re-assembles the {ok,written,failed,results}
        // response DAR expects, so callers are host-agnostic.
        async audioListFolders(/* root */) { return { ok: false, folders: [], reason: 'tauri-todo' }; },
        async audioListTracks(/* dir */) { return { ok: false, tracks: [], reason: 'tauri-todo' }; },
        async audioUpload(files) { return this._invokeUpload(files, 'audio'); },
        async bgmUpload(files) { return this._invokeUpload(files, 'bgm'); },

        async _invokeUpload(files, kind) {
            // Pseudocode — finalize once upload_user_file args are confirmed:
            //   const invoke = window.__TAURI_INTERNALS__.invoke;
            //   for (const f of files) await invoke('upload_user_file', {...});
            const results = files.map(f => ({ name: f.name, ok: false, reason: 'tauri-todo' }));
            return { ok: false, written: 0, failed: files.length, results, kind };
        },

        // Client-side Assistant swap for TauriTavern. The server host rewrites
        // default_Assistant.png on disk (so the change is baked into the card
        // file); TT has no endpoint for that, so instead we live-swap the
        // rendered avatar image wherever the default Assistant is shown. This is
        // presentational only — it doesn't rewrite the card file — but it gives
        // the same visible result. Driven by capabilities.assistant = true.
        _assistantObserver: null,
        // Matches the default Assistant avatar as rendered by ST/TT. Both the
        // avatar thumbnail route and the raw character png are covered.
        _assistantSelector: "img[src*='default_Assistant'], .avatar img[title='Assistant']",
        _assistantSwap(img, url) {
            if (img.dataset.bdAssistantApplied) return;
            img.dataset.bdAssistantApplied = '1';
            img.dataset.bdAssistantOrig = img.getAttribute('src') || '';
            img.src = url;
        },
        _assistantRevert(img) {
            if (!img.dataset.bdAssistantApplied) return;
            if (img.dataset.bdAssistantOrig) img.src = img.dataset.bdAssistantOrig;
            delete img.dataset.bdAssistantApplied;
            delete img.dataset.bdAssistantOrig;
        },
        async assistantStatus() {
            return { applied: !!this._assistantObserver, available: true };
        },
        async assistantApply() {
            const url = `${EXT_ASSETS}/default_Assistant.png`;
            const scan = (root) => {
                if (!root || root.nodeType !== 1) return;
                if (root.matches?.(this._assistantSelector)) this._assistantSwap(root, url);
                root.querySelectorAll?.(this._assistantSelector)
                    .forEach((i) => this._assistantSwap(i, url));
            };
            scan(document.body);
            if (!this._assistantObserver) {
                this._assistantObserver = new MutationObserver((muts) => {
                    for (const m of muts) for (const n of m.addedNodes) scan(n);
                });
                this._assistantObserver.observe(document.body, { childList: true, subtree: true });
            }
            return { ok: true, applied: true };
        },
        async assistantRestore() {
            if (this._assistantObserver) {
                this._assistantObserver.disconnect();
                this._assistantObserver = null;
            }
            document.querySelectorAll(this._assistantSelector)
                .forEach((i) => this._assistantRevert(i));
            return { ok: true, applied: false };
        },
    };
}

// plain backend: vanilla ST, no plugin — everything degrades to no-op --------

function plainBackend() {
    return {
        host: 'plain',
        capabilities: {
            assets: true, cursors: false, frames: false,
            audio: false, bgm: false, assistant: false,
        },
        features: {},
        serverSkinsLoader: false,
        // Preserve today's exact behavior on vanilla ST without the plugin:
        // a full no-op, no settings section, no injected skin. (Flip these to
        // injectLoaderSkin(EXT_ASSETS) if you later want the visuals here too.)
        async injectLoaderSkin() { return false; },
        removeLoaderSkin() { removeLoaderSkin(); },
        assetsVersion: '0',
        assetBase: () => EXT_ASSETS,
        iconSetCssUrl: (file) => `${EXT_ASSETS}/${file}`,
        assetUrl: (name) => `${EXT_ASSETS}/${name}`,
        async cursorsDiscover() { return { ...UNAVAILABLE_CURSORS }; },
        async audioListFolders() { return { ok: false, folders: [] }; },
        async audioListTracks() { return { ok: false, tracks: [] }; },
        async audioUpload(files) { return { ok: false, written: 0, failed: files.length, results: [] }; },
        async bgmUpload(files) { return { ok: false, written: 0, failed: files.length, results: [] }; },
        async assistantStatus() { return { applied: false, available: false }; },
        async assistantApply() { return { ok: false }; },
        async assistantRestore() { return { ok: false }; },
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _adapterPromise = null;

/** Resolve (once) and cache the host adapter. */
export function getAdapter() {
    if (!_adapterPromise) {
        _adapterPromise = detectHost().then(({ host, info }) => {
            if (host === 'server') return serverBackend(info);
            if (host === 'tauri') return tauriBackend();
            return plainBackend();
        });
    }
    return _adapterPromise;
}

/** Force re-detection (e.g. after a plugin install without reload). */
export function resetAdapter() {
    _adapterPromise = null;
}
