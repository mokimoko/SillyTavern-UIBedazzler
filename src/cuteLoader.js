// src/cuteLoader.js — UI Bedazzler ↔ nebula-loader server plugin integration.
//
// Detects the nebula-loader server plugin and, when present, exposes a
// "Nebula Engine Integration" toggle in UI Bedazzler's settings drawer.
// While the toggle is ON, three swaps are active in concert:
//   • browser-tab favicon  →  nebula-loader/assets/favicon-32.png  (client DOM)
//   • welcome-screen logo  →  nebula-loader/assets/logo.png         (client DOM, observed)
//   • default Assistant    →  nebula-loader/assets/default_Assistant.png  (server file)
// While the toggle is OFF, all three revert. If nebula-loader isn't installed,
// the section never appears and UI Bedazzler behaves exactly as it always has.
//
// Why this split: the first two are DOM operations and need to run client-side
// (browsers cache favicons aggressively, ST re-renders the welcome header).
// The Assistant card is a real file with embedded character JSON, so the
// swap has to happen server-side; nebula-loader exposes per-user endpoints for
// that, scoped via req.user.directories.

import { getSetting, setSetting } from './settings.js';
import { getRequestHeaders } from '../../../../../script.js';

const PLUGIN_BASE = '/api/plugins/nebula-loader';
const ASSETS = `${PLUGIN_BASE}/assets`;
const FAVICON_URL = `${ASSETS}/favicon-32.png`;
// logo.png is reserved for the loader-screen skin (consumed by skin.css);
// the welcome-header swap uses logo2.png so the two stay independent.
const LOGO_URL = `${ASSETS}/logo2.png`;
// Phosphor icon skin: a self-contained stylesheet served from assets/ that
// overrides ST's Font Awesome icon glyphs. Scoped under body.phosphor-on, so
// toggling is just adding/removing that class once the <link> is present.
const PHOSPHOR_CSS_URL = `${ASSETS}/phosphor-icons.css`;
const PHOSPHOR_LINK_ID = 'bd-phosphor-css';

// Cache-busting tag for all asset URLs. Set once from nebula-loader's /info
// (its assetsVersion = newest mtime in assets/). Stable across page loads, so
// the browser caches each asset and only re-fetches after a real file update —
// no per-load re-download, no blank-image flash. Falls back to '0' pre-probe.
let assetsVersion = '0';

// ============================================================
// Plugin presence + capability probe
// ============================================================

/**
 * Hit nebula-loader's /info endpoint. Returns the capability object on success,
 * or null if the plugin is absent / unreachable / disabled. This is the single
 * source of truth for "is nebula-loader installed?" — all gating flows from it.
 */
async function probeCuteLoader() {
    try {
        const res = await fetch(`${PLUGIN_BASE}/info`, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// ============================================================
// Favicon swap (one-shot, with snapshot for clean revert)
// ============================================================

let originalFaviconHTML = null;

function applyFavicon(versionTag) {
    if (originalFaviconHTML === null) {
        // Snapshot ST's vanilla favicon links so revert restores them exactly.
        const links = [...document.querySelectorAll(
            "link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='apple-touch-icon-precomposed']",
        )];
        originalFaviconHTML = links.map(l => l.outerHTML).join('\n');
    }
    document.querySelectorAll(
        "link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='apple-touch-icon-precomposed']",
    ).forEach(l => l.remove());

    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = `${FAVICON_URL}?v=${versionTag}`;
    document.head.append(link);
}

function revertFavicon() {
    if (originalFaviconHTML === null) return;
    document.querySelectorAll(
        "link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='apple-touch-icon-precomposed']",
    ).forEach(l => l.remove());
    const tmp = document.createElement('div');
    tmp.innerHTML = originalFaviconHTML;
    [...tmp.children].forEach(l => document.head.append(l));
}

// ============================================================
// Welcome-screen logo swap (persistent observer + revert)
// ============================================================
//
// The welcomeHeaderTitle block isn't always in the DOM at init and ST can
// re-render it on navigation. A MutationObserver catches every appearance.
// Original src is stashed on the img dataset so revert is precise.

let logoObserver = null;
let currentLogoVersionTag = null;

function updateLogoImg(img) {
    if (img.dataset.cuteLogoApplied) return;
    // Claim the element synchronously so the observer can't re-enter and kick
    // off a second swap while the first is still decoding.
    img.dataset.cuteLogoApplied = '1';
    img.dataset.cuteLogoOriginalSrc = img.getAttribute('src') || 'img/logo.png';

    const url = `${LOGO_URL}?v=${currentLogoVersionTag}`;
    // Decode the replacement off-screen before assigning it to the visible img.
    // Swapping src directly drops the painted bitmap and leaves an empty layout
    // box for a frame or two while the new image fetches+decodes — that's the
    // "chunk missing" flash. Preloading + decode() means the pixels are ready
    // before the swap, so the logo flips in cleanly with no blank frame. With a
    // warm cache (stable version tag) this resolves effectively instantly.
    const pre = new Image();
    pre.src = url;
    const swap = () => {
        // Element may have been reverted while we were decoding; re-check.
        if (img.dataset.cuteLogoApplied) img.src = url;
    };
    pre.decode().then(swap).catch(swap); // decode() can reject (e.g. odd MIME) — swap anyway
}

function revertLogoImg(img) {
    if (!img.dataset.cuteLogoApplied) return;
    const original = img.dataset.cuteLogoOriginalSrc || 'img/logo.png';
    img.src = original;
    delete img.dataset.cuteLogoApplied;
    delete img.dataset.cuteLogoOriginalSrc;
}

function swapLogosWithin(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches?.('img.welcomeHeaderLogo')) {
        updateLogoImg(root);
        return;
    }
    root.querySelectorAll?.('img.welcomeHeaderLogo').forEach(updateLogoImg);
}

function startLogoObserver(versionTag) {
    currentLogoVersionTag = versionTag;
    swapLogosWithin(document.body);

    logoObserver = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) swapLogosWithin(node);
        }
    });
    logoObserver.observe(document.body, { childList: true, subtree: true });
}

function stopLogoObserver() {
    if (logoObserver) {
        logoObserver.disconnect();
        logoObserver = null;
    }
    document.querySelectorAll('img.welcomeHeaderLogo').forEach(revertLogoImg);
    currentLogoVersionTag = null;
}

// ============================================================
// Phosphor icon skin (stylesheet link + body class toggle)
// ============================================================
//
// Two-part swap: ensure the <link> to phosphor-icons.css is in <head> (added
// once, left in place), then toggle body.phosphor-on to activate/deactivate.
// Leaving the stylesheet linked while inactive is harmless — every rule is
// scoped under .phosphor-on, so with the class off it matches nothing and ST
// renders vanilla Font Awesome. Revert removes both for a fully clean state.

function applyPhosphorIcons(versionTag) {
    if (!document.getElementById(PHOSPHOR_LINK_ID)) {
        const link = document.createElement('link');
        link.id = PHOSPHOR_LINK_ID;
        link.rel = 'stylesheet';
        link.href = `${PHOSPHOR_CSS_URL}?v=${versionTag}`;
        document.head.append(link);
    }
    document.body.classList.add('phosphor-on');
}

function revertPhosphorIcons() {
    document.body.classList.remove('phosphor-on');
    document.getElementById(PHOSPHOR_LINK_ID)?.remove();
}

// ============================================================
// Server-side Assistant card (via nebula-loader endpoints)
// ============================================================

async function applyAssistantOnServer() {
    try {
        const res = await fetch(`${PLUGIN_BASE}/assistant/apply`, {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        if (!res.ok) return { ok: false, status: res.status };
        return await res.json();
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function restoreAssistantOnServer() {
    try {
        const res = await fetch(`${PLUGIN_BASE}/assistant/restore`, {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        if (!res.ok) return { ok: false, status: res.status };
        return await res.json();
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// ============================================================
// Settings panel UI (Nebula Engine section)
// ============================================================
//
// Built and injected only when nebula-loader is detected. Lives at the bottom
// of UI Bedazzler's existing settings drawer panel. No-op when nebula-loader
// is absent — the section is never created, so nothing leaks visually.

function buildNebulaSectionHTML(features) {
    const cardSupported = !!features?.assistantSwap;
    const cardLine = cardSupported
        ? ''
        : '<div class="bd-nebula-note">No <code>default_Assistant.png</code> shipped in nebula-loader assets — only favicon and logo will swap.</div>';
    return `
        <hr class="bd-divider bd-nebula-divider">
        <div class="bd-nebula-section">
            <label class="bd-toggle-row" title="Apply the nebula-loader visual identity: tab favicon, welcome logo, and default Assistant character.">
                <input type="checkbox" id="bd-nebula-enabled">
                <span>Nebula Engine Integration</span>
                <i class="fa-solid fa-circle-info bd-info-icon"></i>
            </label>
            ${cardLine}
            <label class="bd-toggle-row" title="Replace SillyTavern's Font Awesome interface icons with the Phosphor icon set. Independent of Nebula Engine — toggle freely.">
                <input type="checkbox" id="bd-phosphor-enabled">
                <span>Phosphor Icons</span>
                <i class="fa-solid fa-circle-info bd-info-icon"></i>
            </label>
        </div>
    `;
}

function injectNebulaSection(features) {
    const container = document.querySelector('#bd-settings .inline-drawer-content');
    if (!container) return null;
    if (container.querySelector('.bd-nebula-section')) {
        // Already injected (e.g. settings panel re-rendered). Just return it.
        return container.querySelector('#bd-nebula-enabled');
    }
    container.insertAdjacentHTML('beforeend', buildNebulaSectionHTML(features));
    return container.querySelector('#bd-nebula-enabled');
}

// ============================================================
// Combined apply / revert (drives all three swaps in concert)
// ============================================================

async function applyToggleFeatures() {
    // Use the content-versioned asset tag (not Date.now()) so cached assets are
    // reused across loads and only re-fetched after a real file update.
    applyFavicon(assetsVersion);
    startLogoObserver(assetsVersion);
    await applyAssistantOnServer();
}

async function revertToggleFeatures() {
    revertFavicon();
    stopLogoObserver();
    await restoreAssistantOnServer();
}

// ============================================================
// Entry point
// ============================================================

export async function initCuteLoader() {
    const info = await probeCuteLoader();
    if (!info) return; // nebula-loader absent — full no-op, no UI section.

    // Stable, content-based cache-bust tag for every asset URL this module
    // builds. Older nebula-loader builds won't report it — fall back to '0'.
    assetsVersion = String(info.assetsVersion ?? '0');

    const checkbox = injectNebulaSection(info.features);
    if (!checkbox) return;

    // Restore persisted toggle state and apply if enabled.
    const enabled = !!getSetting('nebulaEngine');
    checkbox.checked = enabled;
    if (enabled) await applyToggleFeatures();

    // Wire the toggle. Each flip persists and reconciles all three swaps.
    checkbox.addEventListener('change', async () => {
        const on = checkbox.checked;
        setSetting('nebulaEngine', on);
        if (on) await applyToggleFeatures();
        else await revertToggleFeatures();
    });

    // Phosphor icon skin — independent toggle, its own persisted setting.
    const phosphorCheckbox = document.querySelector('#bd-phosphor-enabled');
    if (phosphorCheckbox) {
        const phosphorOn = !!getSetting('phosphorIcons');
        phosphorCheckbox.checked = phosphorOn;
        if (phosphorOn) applyPhosphorIcons(assetsVersion);

        phosphorCheckbox.addEventListener('change', () => {
            const on = phosphorCheckbox.checked;
            setSetting('phosphorIcons', on);
            if (on) applyPhosphorIcons(assetsVersion);
            else revertPhosphorIcons();
        });
    }
}
