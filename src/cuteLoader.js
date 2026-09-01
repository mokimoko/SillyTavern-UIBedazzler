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
import { getAdapter } from './hostAdapter.js';
import { createAddedNodeBatcher } from './addedNodeBatcher.js';

// The resolved host adapter (server / tauri / plain). Set once in
// initCuteLoader before anything else runs; all URL building and backend calls
// go through it so the same code works on SillyTavern + nebula-loader and on
// TauriTavern. See hostAdapter.js.
let adapter = null;

// Asset-URL helpers, thin wrappers over the adapter so the rest of this module
// reads the same as before. adapter.assetUrl() already carries the cache-bust
// version tag on the server host.
const faviconUrl = () => adapter.assetUrl('favicon-32.png');
// logo.png is reserved for the loader-screen skin; the welcome-header swap uses
// logo2.png so the two stay independent.
const logoUrl = () => adapter.assetUrl('logo2.png');
// ---- Icon set registry -------------------------------------------------
//
// Each set is a self-contained stylesheet in nebula-loader's assets/ whose
// every rule is scoped under one body class. Applying = ensure the <link>
// exists, then put that class on <body>. Nothing else. Adding a set later
// is one entry here plus one <option> in the markup.
//
// Two independent axes. GENERAL re-skins Font Awesome wholesale; TOPBAR
// re-skins only the nav bar and chat-input buttons. They deliberately
// overlap on those elements, and the topbar stylesheets are written to
// out-specify the general ones, so a topbar choice always wins there.
//
// Note the two rendering strategies: 'phosphor' is a webfont + codepoints
// (Phosphor ships one, and a font gives crisp hinting at 14px for free),
// while everything else is CSS masks over inlined SVG. Duotone has to be
// masks — a two-tone icon isn't expressible as a single glyph, and masking
// gets the tint layer from the source SVG's own opacity, in one
// pseudo-element, with no ::after stacking to collide with ST.
const ICON_SETS = {
    general: {
        default: { label: 'Font Awesome (default)' },
        'phosphor': { label: 'Phosphor', css: 'phosphor-icons.css', bodyClass: 'phosphor-on' },
        'phosphor-duotone': { label: 'Phosphor Duotone', css: 'phosphor-duotone-icons.css', bodyClass: 'bd-icons-duotone' },
        'tabler': { label: 'Tabler', css: 'tabler-icons.css', bodyClass: 'bd-icons-tabler' },
        'lucide': { label: 'Lucide', css: 'lucide-icons.css', bodyClass: 'bd-icons-lucide' },
        'remix-line': { label: 'Remix Line', css: 'remix-line-icons.css', bodyClass: 'bd-icons-remix-line' },
        'remix-fill': { label: 'Remix Fill', css: 'remix-fill-icons.css', bodyClass: 'bd-icons-remix-fill' },
    },
    topbar: {
        default: { label: 'Match general set' },
        'pepicons': { label: 'Pepicons', css: 'topbar-pepicons.css', bodyClass: 'bd-topbar-pepicons' },
        'freehand': { label: 'Streamline Freehand', css: 'topbar-freehand.css', bodyClass: 'bd-topbar-freehand' },
        'tabler': { label: 'Tabler', css: 'topbar-tabler.css', bodyClass: 'bd-topbar-tabler' },
        'lucide': { label: 'Lucide', css: 'topbar-lucide.css', bodyClass: 'bd-topbar-lucide' },
        'remix-line': { label: 'Remix Line', css: 'topbar-remix-line.css', bodyClass: 'bd-topbar-remix-line' },
        'remix-fill': { label: 'Remix Fill', css: 'topbar-remix-fill.css', bodyClass: 'bd-topbar-remix-fill' },
        'pixel': { label: 'Pixelarticons', css: 'topbar-pixel.css', bodyClass: 'bd-topbar-pixel' },
        'cyber': { label: 'Streamline Cyber', css: 'topbar-cyber.css', bodyClass: 'bd-topbar-cyber' },
        'sl-pixel': { label: 'Streamline Pixel', css: 'topbar-sl-pixel.css', bodyClass: 'bd-topbar-sl-pixel' },
        // Colored sets — full-color artwork, no currentColor tint.
        'glyphs-poly': { label: 'Glyphs Poly (color)', css: 'topbar-glyphs-poly.css', bodyClass: 'bd-topbar-glyphs-poly' },
        'stickies': { label: 'Streamline Stickies (color)', css: 'topbar-stickies.css', bodyClass: 'bd-topbar-stickies' },
    },
};

const ICON_SETTING_KEY = { general: 'generalIconSet', topbar: 'topbarIconSet' };

// Cache-busting tag for all asset URLs. Set once from nebula-loader's /info
// (its assetsVersion = newest mtime in assets/). Stable across page loads, so
// the browser caches each asset and only re-fetches after a real file update —
// no per-load re-download, no blank-image flash. Falls back to '0' pre-probe.
let assetsVersion = '0';

// ============================================================
// Favicon swap (one-shot, with snapshot for clean revert)
// ============================================================

let originalFaviconHTML = null;

function applyFavicon() {
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
    // adapter.assetUrl already carries the cache-bust version tag.
    link.href = faviconUrl();
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
let logoMutationBatcher = null;
let currentLogoVersionTag = null;

function updateLogoImg(img) {
    if (img.dataset.cuteLogoApplied) return;
    // Claim the element synchronously so the observer can't re-enter and kick
    // off a second swap while the first is still decoding.
    img.dataset.cuteLogoApplied = '1';
    img.dataset.cuteLogoOriginalSrc = img.getAttribute('src') || 'img/logo.png';

    const url = logoUrl();
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
    stopLogoObserver();
    currentLogoVersionTag = versionTag;
    swapLogosWithin(document.body);

    logoMutationBatcher = createAddedNodeBatcher(swapLogosWithin);
    logoObserver = new MutationObserver(logoMutationBatcher);
    logoObserver.observe(document.body, { childList: true, subtree: true });
}

function stopLogoObserver() {
    if (logoObserver) {
        logoObserver.disconnect();
        logoObserver = null;
    }
    logoMutationBatcher?.cancel();
    logoMutationBatcher = null;
    document.querySelectorAll('img.welcomeHeaderLogo').forEach(revertLogoImg);
    currentLogoVersionTag = null;
}

// ============================================================
// Icon sets (stylesheet link + body class)
// ============================================================
//
// Stylesheets are linked lazily and then left in <head> for the session.
// Keeping an inactive sheet linked is free: every rule inside is scoped
// under its body class, so with the class off it matches nothing. That
// makes switching back to a previously-used set instant and flicker-free,
// which matters when someone is trying options out in the dropdown.
//
// Selecting 'default' drops the body class, so ST renders vanilla Font
// Awesome with no residue.

function linkIdFor(axis, setId) {
    return `bd-iconset-${axis}-${setId}`;
}

/**
 * Make `setId` the active set on `axis`, removing whichever set was active
 * before. Unknown ids fall through to 'default' rather than throwing — a
 * stale persisted value from a removed set should degrade to stock icons,
 * not break the settings panel on load.
 */
function applyIconSet(axis, setId, versionTag) {
    const sets = ICON_SETS[axis];
    if (!sets) return;

    // Clear every body class this axis owns before adding one back, so a
    // switch can never leave two sets fighting each other.
    for (const def of Object.values(sets)) {
        if (def?.bodyClass) document.body.classList.remove(def.bodyClass);
    }

    const def = sets[setId];
    if (!def?.css) return; // 'default', or an id we no longer ship

    const id = linkIdFor(axis, setId);
    if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        // Adapter builds the URL: plugin route on server, extension path on
        // tauri. versionTag is appended for cache-busting where meaningful.
        const base = adapter.iconSetCssUrl(def.css);
        link.href = versionTag ? `${base}?v=${versionTag}` : base;
        document.head.append(link);
    }
    document.body.classList.add(def.bodyClass);
}

/** Serializable icon choices shared by the settings drawer and Chat Design. */
export function getIconSetChoices(axis) {
    const sets = ICON_SETS[axis] || {};
    return Object.entries(sets).map(([id, def]) => ({ id, label: def.label }));
}

export function isKnownIconSet(axis, setId) {
    return Object.hasOwn(ICON_SETS[axis] || {}, setId);
}

/** Apply one axis without changing the global/default setting. */
export async function applyIconSetSelection(axis, setId) {
    if (!isKnownIconSet(axis, setId)) setId = 'default';
    if (!adapter) {
        adapter = await getAdapter();
        assetsVersion = String(adapter.assetsVersion ?? '0');
    }
    if (adapter.host === 'plain') return false;
    applyIconSet(axis, setId, assetsVersion);
    return true;
}

// ============================================================
// Server-side Assistant card (via nebula-loader endpoints)
// ============================================================

// Assistant swap goes through the adapter: on the server host it POSTs to the
// nebula-loader endpoints (rewrites the card file on disk); on tauri it does a
// live DOM swap of the rendered avatar. Callers stay host-agnostic.
async function applyAssistant() {
    if (!adapter.capabilities.assistant) return { ok: true, skipped: true };
    try {
        return await adapter.assistantApply();
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function restoreAssistant() {
    if (!adapter.capabilities.assistant) return { ok: true, skipped: true };
    try {
        return await adapter.assistantRestore();
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
        <div class="bd-nebula-section">
            <label class="bd-row" title="Apply the nebula-loader visual identity: tab favicon, welcome logo, and default Assistant character.">
                <span class="bd-row-name">Nebula Engine Integration</span>
                <input type="checkbox" class="bd-switch" id="bd-nebula-enabled">
            </label>
            ${cardLine}
            <label class="bd-row" title="Re-skin SillyTavern's Font Awesome interface icons. Independent of Nebula Engine.">
                <span class="bd-row-name">General Icons</span>
                <select class="text_pole bd-iconset-select" id="bd-iconset-general">${renderIconOptions('general')}</select>
            </label>
            <label class="bd-row" title="Re-skin only the top navigation bar and chat-input buttons. Overrides the general set on those icons.">
                <span class="bd-row-name">Top Bar Icons</span>
                <select class="text_pole bd-iconset-select" id="bd-iconset-topbar">${renderIconOptions('topbar')}</select>
            </label>
        </div>
    `;
}

function renderIconOptions(axis) {
    return getIconSetChoices(axis)
        .map(({ id, label }) => `<option value="${id}">${label}</option>`)
        .join('');
}

function injectNebulaSection(features) {
    const container = document.querySelector('#bd-settings .inline-drawer-content');
    if (!container) return null;
    if (container.querySelector('.bd-nebula-section')) {
        // Already injected (e.g. settings panel re-rendered). Just return it.
        return container.querySelector('#bd-nebula-enabled');
    }
    // Inject into the Interface collapsible (via its anchor) so Nebula + Phosphor
    // live alongside Side Buttons. Fall back to appending to the drawer content
    // if the anchor isn't present for any reason.
    const anchor = container.querySelector('.bd-nebula-anchor');
    if (anchor) {
        anchor.insertAdjacentHTML('beforebegin', buildNebulaSectionHTML(features));
    } else {
        container.insertAdjacentHTML('beforeend', buildNebulaSectionHTML(features));
    }
    // Refresh the Interface section's on/total count now that its switches grew.
    try { window.bdRefreshSecCounts?.(); } catch { /* non-fatal */ }
    return container.querySelector('#bd-nebula-enabled');
}

// ============================================================
// Combined apply / revert (drives all three swaps in concert)
// ============================================================

async function applyToggleFeatures() {
    // On hosts where the plugin didn't skin the loader on disk (tauri), inject
    // the loader-screen skin at runtime. No-op on server (plugin handles it).
    await adapter.injectLoaderSkin();
    applyFavicon();
    startLogoObserver(assetsVersion);
    await applyAssistant();
}

async function revertToggleFeatures() {
    adapter.removeLoaderSkin();
    revertFavicon();
    stopLogoObserver();
    await restoreAssistant();
}

// ============================================================
// Entry point
// ============================================================

export async function initCuteLoader() {
    // Resolve the host adapter once. 'server' = ST + nebula-loader (behaves
    // exactly as before), 'tauri' = TauriTavern (extension-hosted assets +
    // client-side swaps), 'plain' = vanilla ST without the plugin (full no-op).
    adapter = await getAdapter();
    if (adapter.host === 'plain') return; // preserve legacy no-op behavior.

    // Stable, content-based cache-bust tag for every asset URL this module
    // builds. Server reports it via /info; tauri has none, so '0'.
    assetsVersion = String(adapter.assetsVersion ?? '0');

    const checkbox = injectNebulaSection(adapter.features);
    if (!checkbox) return;

    // Restore persisted toggle state and apply if enabled.
    const enabled = !!getSetting('nebulaEngine');
    checkbox.checked = enabled;
    if (enabled) await applyToggleFeatures();

    // Wire the toggle. Each flip persists and reconciles all three swaps.
    checkbox.addEventListener('change', async () => {
        const on = checkbox.checked;
        setSetting('nebulaEngine', on);
        try { window.bdRefreshSecCounts?.(); } catch { /* non-fatal */ }
        if (on) await applyToggleFeatures();
        else await revertToggleFeatures();
    });

    // Icon sets — two independent dropdowns, same wiring for both.
    // Note these don't call bdRefreshSecCounts: that count is defined over
    // .bd-switch inputs, and a <select> isn't a switch. The Interface
    // section's "on/total" simply no longer counts icons, which is correct —
    // "default" isn't off, it's a choice.
    for (const axis of ['general', 'topbar']) {
        const select = document.querySelector(`#bd-iconset-${axis}`);
        if (!select) continue;

        const key = ICON_SETTING_KEY[axis];
        const saved = getSetting(key) || 'default';

        // Only adopt the persisted value if we still ship it; otherwise fall
        // back to default AND write that back, so the panel doesn't keep
        // showing a selection that does nothing.
        if (ICON_SETS[axis][saved] !== undefined) {
            select.value = saved;
        } else {
            select.value = 'default';
            setSetting(key, 'default');
        }

        if (select.value !== 'default') applyIconSet(axis, select.value, assetsVersion);

        select.addEventListener('change', () => {
            setSetting(key, select.value);
            applyIconSet(axis, select.value, assetsVersion);
            window.dispatchEvent(new CustomEvent('UIBEDAZZLER_ICON_DEFAULTS_CHANGED'));
        });
    }

    // Chat Design listens for this so a character override wins after the
    // asynchronous host probe applies the global defaults during startup.
    window.dispatchEvent(new CustomEvent('UIBEDAZZLER_ICON_DEFAULTS_CHANGED'));
}
