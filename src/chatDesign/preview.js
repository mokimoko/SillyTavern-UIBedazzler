// Focused, isolated live preview for Chat Design style editors.

import { buildPreviewCSS } from './cssGenerator.js';
import { getAllStyles } from './storage.js';

const PREVIEWABLE_ELEMENTS = new Set(['dialogue', 'banner', 'container', 'avatar', 'background']);
const LINKED_PREVIEW_ORDER = ['background', 'container', 'banner', 'avatar', 'dialogue'];
const ELEMENT_LABELS = {
    dialogue: 'Fonts',
    banner: 'Banner',
    container: 'Container',
    avatar: 'Message Elements',
    background: 'Background',
};
const FALLBACK_AVATAR = '/scripts/extensions/third-party/SillyTavern-UIBedazzler/assets/nebula/default_Assistant.png';

let previewExpanded = false;
let previewRole = 'assistant';

const SHADOW_CSS = `
    :host {
        display: block;
        height: 100%;
        color: var(--bd-text, #eceaf0);
        contain: layout paint style;
    }
    * { box-sizing: border-box; }
    .wl-cdm-preview-frame {
        position: relative;
        height: 100%;
        overflow: hidden;
        background: var(--bd-surface-2, #18171d);
        isolation: isolate;
    }
    #wl-cdm-preview-bg {
        position: absolute;
        inset: 0;
        z-index: 0;
        background:
            radial-gradient(circle at 78% 22%, rgba(126, 101, 169, 0.28), transparent 42%),
            linear-gradient(145deg, #23202b, #101014 72%);
        background-position: center;
        background-size: cover;
    }
    .wl-cdm-preview-canvas {
        --wl-cdm-preview-scale: 0.74;
        position: relative;
        z-index: 2;
        width: calc(100% / var(--wl-cdm-preview-scale));
        min-height: calc(100% / var(--wl-cdm-preview-scale));
        padding: 14px;
        transform: scale(var(--wl-cdm-preview-scale));
        transform-origin: top left;
    }
    #chat {
        width: 100%;
        color: var(--bd-text, #eceaf0);
        font-family: var(--mainFontFamily, inherit);
    }
    .mes {
        position: relative;
        display: flex;
        align-items: flex-start;
        gap: 13px;
        width: 100%;
        min-height: 176px;
        padding: 15px;
        overflow: hidden;
        background: var(--SmartThemeChatTintColor, rgba(24, 23, 29, 0.88));
        border: 1px solid var(--bd-border, rgba(255, 255, 255, 0.12));
    }
    .mesAvatarWrapper {
        position: relative;
        z-index: 3;
        flex: 0 0 62px;
        width: 62px;
        min-width: 62px;
        text-align: center;
        color: var(--bd-text-faint, rgba(255, 255, 255, 0.48));
        font-size: 8px;
    }
    .avatar {
        width: 62px;
        height: 62px;
        margin-bottom: 6px;
        border-radius: 8px;
    }
    .avatar img {
        display: block;
        width: 62px;
        height: 62px;
        object-fit: cover;
        border-radius: 8px;
    }
    .wl-cdm-preview-details {
        display: flex;
        justify-content: center;
        gap: 4px;
        white-space: nowrap;
    }
    .mes_block {
        position: relative;
        z-index: 3;
        flex: 1 1 auto;
        min-width: 0;
        overflow-x: clip;
    }
    .ch_name {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        min-height: 24px;
        margin-bottom: 5px;
    }
    .wl-cdm-preview-name {
        display: flex;
        align-items: baseline;
        gap: 4px;
        min-width: 0;
        padding-top: 2px;
    }
    .name_text {
        color: var(--bd-text, #f3eff8);
        font-size: 1em;
        font-weight: 600;
    }
    .timestamp {
        color: var(--bd-text-faint, rgba(255, 255, 255, 0.48));
        font-size: 9px;
        font-weight: 400;
        white-space: nowrap;
    }
    .timestamp-icon {
        align-self: center;
        width: 12px;
        height: 12px;
        fill: currentColor;
        color: var(--bd-text-faint, rgba(255, 255, 255, 0.48));
    }
    .mes_text {
        color: var(--bd-text-dim, rgba(255, 255, 255, 0.76));
        font-size: 14px;
        line-height: 1.5;
    }
    .mes_text p { margin: 0 0 8px; }
    .mes_text q {
        quotes: none;
        display: block;
        padding-left: 10px;
        border-left: 2px solid var(--bd-accent, #967bc3);
        color: var(--SmartThemeQuoteColor, var(--bd-text, #f3eff8));
    }
    .mes_reasoning_details {
        margin-right: 0;
    }
    .mes_reasoning_summary {
        display: flex;
        align-items: flex-start;
        list-style: none;
    }
    .mes_reasoning_summary::-webkit-details-marker { display: none; }
    .mes_reasoning_summary:focus-visible { outline: none; }
    .mes_reasoning_header_block {
        display: flex;
        flex-grow: 1;
        min-width: 0;
    }
    .mes_reasoning_header {
        position: relative;
        display: flex;
        align-items: baseline;
        width: 100%;
        margin: 0.5em 2px;
        padding: 7px 31px 7px 14px;
        border-radius: 5px;
        background-color: var(--grey30, rgba(128, 128, 128, 0.3));
        font-size: calc(14px * 0.9);
        cursor: pointer;
        user-select: none;
    }
    .mes_reasoning_arrow {
        position: absolute;
        top: 50%;
        right: 7px;
        width: 9px;
        height: 9px;
        transform: translateY(-50%);
        transition: transform 140ms ease;
    }
    .mes_reasoning_arrow::before {
        content: '';
        position: absolute;
        inset: 1px;
        border-top: 1.5px solid currentColor;
        border-left: 1.5px solid currentColor;
        transform: rotate(45deg);
    }
    .mes_reasoning_details:not([open]) .mes_reasoning_arrow {
        transform: translateY(-50%) rotate(180deg);
    }
    .mes_reasoning_actions {
        display: flex;
        align-items: center;
        gap: 2px;
        margin: 0.5em 0 0.5em 6px;
    }
    .mes_reasoning_details:not([open]) .mes_reasoning_actions { display: none; }
    .mes_reasoning {
        margin-bottom: 0.5em;
        padding: 5px 5px 5px 14px;
        border-left: 2px solid var(--reasoning-body-color, var(--bd-text-faint, rgba(255, 255, 255, 0.48)));
        border-radius: 2px;
        color: var(--bd-text-dim, rgba(255, 255, 255, 0.76));
        font-size: 12px;
        line-height: 1.5;
    }
    .mes_buttons,
    .extraMesButtons {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: nowrap;
        gap: 4px;
    }
    .extraMesButtons {
        display: flex;
    }
    .mes_button,
    .extraMesButtons > div {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 2px;
        color: var(--bd-text-dim, rgba(255, 255, 255, 0.72));
        background: transparent;
        border: 0;
        border-radius: 4px;
        opacity: 0.55;
        cursor: pointer;
        transition: opacity 140ms ease, color 140ms ease, background-color 140ms ease, transform 140ms ease;
    }
    .mes_button:hover,
    .extraMesButtons > div:hover {
        opacity: 1;
    }
    .mes_button:focus-visible,
    .extraMesButtons > div:focus-visible {
        opacity: 1;
        outline: 1px solid currentColor;
        outline-offset: 1px;
    }
    .mes_button svg,
    .extraMesButtons > div svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
    }
    .wl-cdm-preview-ui {
        position: absolute;
        bottom: 10px;
        right: 10px;
        z-index: 5;
        padding: 3px 7px;
        color: var(--bd-text-dim, rgba(255, 255, 255, 0.72));
        background: var(--bd-surface, rgba(18, 17, 22, 0.84));
        border: 1px solid var(--bd-border, rgba(255, 255, 255, 0.12));
        font-size: 9px;
        letter-spacing: 0.03em;
    }
`;

function getLiveSample(role) {
    const wantsUser = role === 'user';
    const messages = [...document.querySelectorAll('#chat .mes')];
    const source = messages.reverse().find(message => {
        const raw = message.getAttribute('is_user');
        return raw === String(wantsUser) || raw === (wantsUser ? '1' : '0');
    });
    const name = source?.querySelector('.name_text')?.textContent?.trim()
        || (wantsUser ? 'You' : 'Assistant');
    const sourceImage = source?.querySelector('.avatar img');
    const avatarUrl = sourceImage?.currentSrc || sourceImage?.src || FALLBACK_AVATAR;
    let hasBanner = false;
    try {
        hasBanner = !!source
            && window.getComputedStyle(source, '::before').backgroundImage !== 'none';
    } catch { /* A missing pseudo-element simply uses the avatar fallback. */ }
    return {
        name,
        avatarUrl,
        hasBanner,
        contextCSS: buildContextCSS(source),
    };
}

function computedValue(style, property) {
    return style?.getPropertyValue(property)?.trim() || '';
}

function buildContextCSS(source) {
    const designCSS = ['wl-char-design-styles', 'wl-persona-design-styles']
        .map(id => document.getElementById(id)?.textContent || '')
        .filter(Boolean)
        .join('\n\n');
    if (!source) return designCSS;

    try {
        const message = window.getComputedStyle(source);
        const readStyle = node => node ? window.getComputedStyle(node) : null;
        const name = readStyle(source.querySelector('.name_text'));
        const text = readStyle(source.querySelector('.mes_text'));
        const quote = readStyle(source.querySelector('.mes_text q'));
        const messageDecls = [
            ['background-color', computedValue(message, 'background-color')],
            ['background-image', computedValue(message, 'background-image')],
            ['background-blend-mode', computedValue(message, 'background-blend-mode')],
            ['backdrop-filter', computedValue(message, 'backdrop-filter')],
            ['-webkit-backdrop-filter', computedValue(message, '-webkit-backdrop-filter')],
        ].filter(([, value]) => value).map(([property, value]) => `${property}: ${value}`);
        const rules = [];
        if (messageDecls.length) {
            rules.push(`.wl-cdm-preview-message { ${messageDecls.join('; ')}; }`);
        }
        const nameColor = computedValue(name, 'color');
        const textColor = computedValue(text, 'color');
        const quoteColor = computedValue(quote, 'color');
        if (nameColor) rules.push(`.wl-cdm-preview-message .name_text { color: ${nameColor}; }`);
        if (textColor) rules.push(`.wl-cdm-preview-message .mes_text { color: ${textColor}; }`);
        if (quoteColor) rules.push(`.wl-cdm-preview-message .mes_text q { color: ${quoteColor}; }`);
        return [designCSS, ...rules].filter(Boolean).join('\n\n');
    } catch {
        return designCSS;
    }
}

function getLiveBackground() {
    for (const selector of ['#bg_custom', '#bg1']) {
        const node = document.querySelector(selector);
        if (!node) continue;
        try {
            const style = window.getComputedStyle(node);
            if (style.backgroundImage && style.backgroundImage !== 'none') {
                return {
                    image: style.backgroundImage,
                    position: style.backgroundPosition,
                    size: style.backgroundSize,
                    color: style.backgroundColor,
                };
            }
        } catch { /* The atmospheric fallback remains visible. */ }
    }
    return null;
}

/**
 * Treat an exact shared style name as an opt-in preview group. The current
 * editor style wins its category; duplicate linked names use the first enabled
 * style in storage order, matching the deliberately simple authoring contract.
 */
export function resolveLinkedPreviewStyles(style, styles = getAllStyles()) {
    const sharedName = typeof style?.name === 'string' ? style.name.trim() : '';
    if (!style || !sharedName || !PREVIEWABLE_ELEMENTS.has(style.element)) return style ? [style] : [];

    const firstByElement = new Map();
    for (const candidate of styles || []) {
        if (!candidate || candidate.id === style.id || candidate.enabled === false) continue;
        if (!PREVIEWABLE_ELEMENTS.has(candidate.element) || candidate.element === style.element) continue;
        if ((candidate.name || '').trim() !== sharedName || firstByElement.has(candidate.element)) continue;
        firstByElement.set(candidate.element, candidate);
    }

    return [
        ...LINKED_PREVIEW_ORDER
            .filter(element => element !== style.element)
            .map(element => firstByElement.get(element))
            .filter(Boolean),
        style,
    ];
}

function mountPreview(host) {
    if (host.shadowRoot) return host.shadowRoot;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
        <style data-preview-base>${SHADOW_CSS}</style>
        <style data-preview-context></style>
        <style data-preview-live></style>
        <div class="wl-cdm-preview-frame">
            <div id="wl-cdm-preview-bg"></div>
            <div class="wl-cdm-preview-canvas">
                <div id="chat">
                    <div class="mes wl-cdm-preview-message" is_user="false">
                        <div class="mesAvatarWrapper">
                            <div class="avatar"><img alt=""></div>
                            <div class="wl-cdm-preview-details">
                                <span class="mesIDDisplay">#12</span>
                                <span class="tokenCounterDisplay">84t</span>
                                <span class="mes_timer">2.1s</span>
                            </div>
                        </div>
                        <div class="mes_block">
                            <div class="ch_name">
                                <div class="wl-cdm-preview-name">
                                    <span class="name_text"></span>
                                    <small class="timestamp">Today 2:14 PM</small>
                                    <svg class="icon-svg timestamp-icon" viewBox="0 0 24 24" aria-label="Model icon">
                                        <path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4L12 2.8Zm0 4.1-4.5 2.6v5.1l4.5 2.6 4.5-2.6V9.5L12 6.9Z"></path>
                                    </svg>
                                </div>
                                <div class="mes_buttons" aria-label="Message actions">
                                    <div class="mes_button extraMesButtonsHint" role="button" tabindex="0" title="Message actions" aria-label="Message actions">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>
                                    </div>
                                    <div class="extraMesButtons">
                                        <div class="mes_button mes_translate" role="button" tabindex="0" title="Translate message" aria-label="Translate message">
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7M7.5 3v2c0 4-2 7-5 9M5 10c1.5 2 3.2 3.4 5.2 4.2M13 19l4-10 4 10M14.4 16h5.2"></path></svg>
                                        </div>
                                        <div class="mes_button mes_copy" role="button" tabindex="0" title="Copy message" aria-label="Copy message">
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>
                                        </div>
                                    </div>
                                    <div class="mes_button mes_edit" role="button" tabindex="0" title="Edit message" aria-label="Edit message">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4zM13.5 6.5l4 4"></path></svg>
                                    </div>
                                </div>
                            </div>
                            <details class="mes_reasoning_details" data-has-content="true" open>
                                <summary class="mes_reasoning_summary">
                                    <div class="mes_reasoning_header_block">
                                        <div class="mes_reasoning_header">
                                            <span class="mes_reasoning_header_title">Thought for 8.4 seconds</span>
                                            <span class="mes_reasoning_arrow" aria-hidden="true"></span>
                                        </div>
                                    </div>
                                    <div class="mes_reasoning_actions" aria-label="Reasoning actions">
                                        <div class="mes_button mes_reasoning_copy" role="button" tabindex="0" title="Copy reasoning" aria-label="Copy reasoning">
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>
                                        </div>
                                        <div class="mes_button mes_reasoning_edit" role="button" tabindex="0" title="Edit reasoning" aria-label="Edit reasoning">
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4zM13.5 6.5l4 4"></path></svg>
                                        </div>
                                    </div>
                                </summary>
                                <div class="mes_reasoning">I should answer directly, while keeping the tone warm and grounded in what she already knows.</div>
                            </details>
                            <div class="mes_text">
                                <p>A small change can give the entire conversation a different rhythm.</p>
                                <p><q>This quoted line makes dialogue styling visible too.</q></p>
                            </div>
                        </div>
                        <div class="wl-cdm-preview-ui">Interface sample</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    return root;
}

function updatePreviewContent(host, previewStyles) {
    if (!host?.isConnected) return;
    const root = mountPreview(host);
    if (!host.__wlPreviewSample || host.__wlPreviewRole !== previewRole) {
        host.__wlPreviewSample = getLiveSample(previewRole);
        host.__wlPreviewRole = previewRole;
    }
    const sample = host.__wlPreviewSample;
    const message = root.querySelector('.wl-cdm-preview-message');
    const image = root.querySelector('.avatar img');
    const background = root.querySelector('#wl-cdm-preview-bg');

    message?.setAttribute('is_user', String(previewRole === 'user'));
    message?.setAttribute('ch_name', sample.name);
    const name = root.querySelector('.name_text');
    if (name) name.textContent = sample.name;
    if (image) {
        image.src = sample.avatarUrl;
        image.alt = `${sample.name} avatar`;
    }

    if (background && !background.dataset.sourceReady) {
        const liveBackground = getLiveBackground();
        if (liveBackground) {
            background.style.backgroundImage = liveBackground.image;
            background.style.backgroundPosition = liveBackground.position;
            background.style.backgroundSize = liveBackground.size;
            background.style.backgroundColor = liveBackground.color;
        }
        background.dataset.sourceReady = 'true';
    }

    const contextStyle = root.querySelector('[data-preview-context]');
    if (contextStyle && contextStyle.textContent !== sample.contextCSS) {
        contextStyle.textContent = sample.contextCSS;
    }
    const liveStyle = root.querySelector('[data-preview-live]');
    if (liveStyle) {
        const css = previewStyles.map(previewStyle => buildPreviewCSS(
            previewStyle,
            '.wl-cdm-preview-message',
            { avatarUrl: previewStyle.element === 'banner' && !sample.hasBanner ? sample.avatarUrl : null },
        )).filter(Boolean).join('\n\n');
        if (liveStyle.textContent !== css) liveStyle.textContent = css;
    }
}

function updatePreview(host, style) {
    const previewStyles = resolveLinkedPreviewStyles(style);
    updatePreviewContent(host, previewStyles);
    const kind = host.closest?.('[data-wl-cdm-preview]')?.querySelector('.wl-cdm-preview-kind');
    if (kind) {
        const label = ELEMENT_LABELS[style.element] || 'Style';
        const linkedCount = Math.max(0, previewStyles.length - 1);
        kind.textContent = linkedCount ? `${label} · ${linkedCount} linked` : label;
    }
}

/** Render a bundled pack with the same isolated preview pipeline used by the style editor. */
export function renderStylePackPreview(host, pack) {
    const styles = LINKED_PREVIEW_ORDER
        .map(element => pack?.styles?.find(style => style.element === element))
        .filter(Boolean);
    updatePreviewContent(host, styles);
}

export function renderChatDesignPreview(elementType) {
    if (!PREVIEWABLE_ELEMENTS.has(elementType)) return '';
    const label = ELEMENT_LABELS[elementType] || 'Style';
    return `
        <section class="wl-cdm-preview${previewExpanded ? ' wl-cdm-preview-expanded' : ''}"
                 data-wl-cdm-preview aria-label="Live ${label} preview">
            <div class="wl-cdm-preview-bar">
                <button type="button" class="wl-cdm-preview-toggle" aria-expanded="${previewExpanded}">
                    <i class="fa-regular fa-eye" aria-hidden="true"></i>
                    <span>Live Preview</span>
                    <span class="wl-cdm-preview-kind">${label}</span>
                    <i class="fa-solid fa-chevron-down wl-cdm-preview-chevron" aria-hidden="true"></i>
                </button>
                <div class="wl-cdm-preview-roles" role="group" aria-label="Preview message author">
                    <button type="button" data-preview-role="assistant" aria-pressed="${previewRole === 'assistant'}">Assistant</button>
                    <button type="button" data-preview-role="user" aria-pressed="${previewRole === 'user'}">User</button>
                </div>
            </div>
            <div class="wl-cdm-preview-panel" aria-hidden="${!previewExpanded}">
                <div class="wl-cdm-preview-host"></div>
            </div>
        </section>
    `;
}

export function wireChatDesignPreview(container, style) {
    const shell = container.querySelector('[data-wl-cdm-preview]');
    if (!shell) return;
    // The content container persists across editor renders. Delegate property
    // events from the disposable editor instead so old preview closures are
    // collected when renderEditor() replaces its markup.
    const eventRoot = shell.closest('.wl-cdm-editor') || shell;
    const toggle = shell.querySelector('.wl-cdm-preview-toggle');
    const panel = shell.querySelector('.wl-cdm-preview-panel');
    const host = shell.querySelector('.wl-cdm-preview-host');
    let frame = 0;

    const syncState = () => {
        shell.classList.toggle('wl-cdm-preview-expanded', previewExpanded);
        toggle?.setAttribute('aria-expanded', String(previewExpanded));
        panel?.setAttribute('aria-hidden', String(!previewExpanded));
        shell.querySelectorAll('[data-preview-role]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.previewRole === previewRole));
        });
    };
    const queueUpdate = () => {
        if (!previewExpanded || !host || frame) return;
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            if (!previewExpanded) return;
            updatePreview(host, style);
        });
    };

    toggle?.addEventListener('click', () => {
        previewExpanded = !previewExpanded;
        if (!previewExpanded && frame) {
            window.cancelAnimationFrame(frame);
            frame = 0;
        }
        syncState();
        queueUpdate();
    });
    shell.querySelectorAll('[data-preview-role]').forEach(button => {
        button.addEventListener('click', () => {
            previewRole = button.dataset.previewRole === 'user' ? 'user' : 'assistant';
            syncState();
            queueUpdate();
        });
    });

    const onPropertyEvent = event => {
        const inProperties = event.target.closest?.('#wl-cdm-props');
        const isStyleName = event.target.matches?.('#wl-cdm-style-name');
        if (!inProperties && !isStyleName) return;
        if (event.type === 'click' && !event.target.closest('.wl-cdm-font-result')) return;
        queueUpdate();
    };
    eventRoot.addEventListener('input', onPropertyEvent);
    eventRoot.addEventListener('change', onPropertyEvent);
    eventRoot.addEventListener('click', onPropertyEvent);

    syncState();
    queueUpdate();
}
