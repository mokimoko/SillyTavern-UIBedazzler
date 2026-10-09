import { buildPreviewCSS } from './cssGenerator.js';
import { compileTextTagCss, MAX_TEXT_TAGS, textTagClass, textTagError } from './textTags.js';

function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STARTERS = {
    bold: 'font-weight: 700;\nfont-size: 1.15em;',
    glow: 'color: #f3b7dd;\ntext-shadow: 0 0 8px currentColor;',
    pulse: 'animation: pulse 1.2s ease-in-out infinite;\n\n@keyframes pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: 0.45; }\n}',
    shake: 'animation: shake 0.35s ease-in-out 2;\n\n@keyframes shake {\n  0%, 100% { transform: translateX(0); }\n  25%, 75% { transform: translateX(-2px); }\n  50% { transform: translateX(2px); }\n}',
};

function card(entry, index) {
    const error = textTagError(entry.tag);
    return `<details class="bdz-text-tag-card" data-text-tag-index="${index}" ${index === 0 ? 'open' : ''}>
        <summary><code data-tag-heading>${esc(entry.tag ? `<${entry.tag}>` : 'New tag')}</code>
            <span class="bdz-text-tag-state" data-tag-state>${entry.enabled === false ? 'Disabled' : 'Enabled'}</span></summary>
        <div class="bdz-text-tag-body">
            <div class="bdz-text-tag-toolbar">
                <label class="wl-cdm-checkbox-item"><input type="checkbox" data-tag-field="enabled" ${entry.enabled === false ? '' : 'checked'}> Enabled</label>
                <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" data-tag-remove>Remove</button>
            </div>
            <label class="wl-cdm-field"><span class="wl-cdm-field-label">Tag name</span>
                <input class="wl-cdm-input" data-tag-field="tag" maxlength="48" value="${esc(entry.tag)}" placeholder="my-effect" spellcheck="false">
            </label>
            <div class="wl-cdm-field-hint">Enter the name without angle brackets. It applies only within messages using this Fonts style.</div>
            <label class="wl-cdm-field"><span class="wl-cdm-field-label">CSS</span>
                <textarea class="wl-cdm-input wl-cdm-css-input bdz-text-tag-css" data-tag-field="css" maxlength="16000" spellcheck="false" placeholder="color: pink;&#10;font-weight: 700;">${esc(entry.css)}</textarea>
            </label>
            <div class="wl-cdm-field-hint">Paste declarations or a complete effect snippet, including @keyframes. Each style block applies to this tag; pasted selectors are replaced. External URLs and other at-rules are ignored.</div>
            <div class="bdz-text-tag-starters"><span>Replace CSS with:</span>
                ${Object.keys(STARTERS).map(key => `<button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" data-tag-starter="${key}">${key[0].toUpperCase() + key.slice(1)}</button>`).join('')}
            </div>
            <label class="wl-cdm-field"><span class="wl-cdm-field-label">Preview text</span>
                <input class="wl-cdm-input" data-tag-field="previewText" maxlength="200" value="${esc(entry.previewText || 'Your text here')}">
            </label>
            <div class="bdz-text-tag-preview" data-tag-preview></div>
            <div class="bdz-text-tag-copy"><code data-tag-example>${esc(`<${entry.tag || 'my-effect'}>Your text here</${entry.tag || 'my-effect'}>`)}</code>
                <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" data-tag-copy="tag">Copy tag</button>
            </div>
            <div class="bdz-text-tag-copy"><code data-span-example>${esc(`<span class="${textTagClass(entry.tag || 'my-effect')}">Your text here</span>`)}</code>
                <button type="button" class="wl-cdm-btn wl-cdm-btn-ghost" data-tag-copy="span">Copy span</button>
            </div>
            <div class="bdz-text-tag-feedback" data-tag-feedback role="status">${esc(error)}</div>
        </div>
    </details>`;
}

export function renderTextTags(properties) {
    const entries = Array.isArray(properties.textTags)
        ? properties.textTags.filter(entry => entry && typeof entry === 'object').slice(0, MAX_TEXT_TAGS) : [];
    properties.textTags = entries;
    return `<div class="bdz-text-tags">
        <div class="wl-cdm-field-hint wl-cdm-field-hint-after">Wrap selected text in your tag to apply its effect. Copy the tag or span for your own prompts. Chat text and prompts are kept as written.</div>
        <div data-text-tag-list>${entries.map(card).join('')}</div>
        ${entries.length ? '' : '<div class="wl-cdm-empty-small">No text tags yet. Add a tag, then choose its appearance.</div>'}
        <button type="button" class="wl-cdm-btn wl-cdm-btn-accent" data-text-tag-add ${entries.length >= MAX_TEXT_TAGS ? 'disabled' : ''}><i class="fa-solid fa-plus" aria-hidden="true"></i> Add text tag</button>
    </div>`;
}

export function wireTextTags(container, style, { save, rerender, refresh }) {
    const panel = container.querySelector('.bdz-text-tags');
    if (!panel) return;
    const entries = style.properties.textTags;
    const persist = () => { save(entries); refresh(); };
    const updateCard = (element, entry) => {
        const duplicate = entries.some(other => other !== entry && other?.tag === entry.tag);
        const error = textTagError(entry.tag) || (duplicate ? 'This style already has a tag with that name.' : '');
        const { warning } = compileTextTagCss(entry, style.id);
        element.querySelector('[data-tag-feedback]').textContent = error || warning;
        element.querySelector('[data-tag-heading]').textContent = entry.tag ? `<${entry.tag}>` : 'New tag';
        element.querySelector('[data-tag-state]').textContent = entry.enabled === false ? 'Disabled' : 'Enabled';
        element.querySelector('[data-tag-example]').textContent = `<${entry.tag || 'my-effect'}>Your text here</${entry.tag || 'my-effect'}>`;
        element.querySelector('[data-span-example]').textContent = `<span class="${textTagClass(entry.tag || 'my-effect')}">Your text here</span>`;
        element.querySelector('[data-tag-field="tag"]').setAttribute('aria-invalid', String(Boolean(error)));
        element.querySelectorAll('[data-tag-copy]').forEach(button => { button.disabled = Boolean(error); });
        if (!element.open) return;
        const host = element.querySelector('[data-tag-preview]');
        const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
        if (!root.firstChild) {
            root.innerHTML = '<style></style><div class="bdz-tag-sample"><div class="mes_text">Ordinary text. <span></span> Ordinary text.</div></div>';
        }
        const previewStyle = { ...style, properties: { ...style.properties, textTags: error ? [] : [{ ...entry, enabled: true }] } };
        root.querySelector('style').textContent = ':host { display: block; overflow: hidden; padding: 18px 12px; } .mes_text { line-height: 1.6; }\n'
            + buildPreviewCSS(previewStyle, '.bdz-tag-sample');
        const sample = root.querySelector('span');
        sample.className = error ? '' : textTagClass(entry.tag);
        sample.textContent = entry.previewText || 'Your text here';
    };
    panel.querySelector('[data-text-tag-add]').addEventListener('click', () => {
        if (entries.length >= MAX_TEXT_TAGS) return;
        let tag = 'my-effect';
        for (let suffix = 2; entries.some(entry => entry?.tag === tag); suffix++) tag = `my-effect-${suffix}`;
        entries.push({ tag, enabled: true, css: STARTERS.bold, previewText: 'Your text here' });
        persist();
        rerender();
        const lastCard = container.querySelector('[data-text-tag-list] details:last-child');
        if (lastCard) lastCard.open = true;
        container.querySelector('[data-text-tag-list] details:last-child [data-tag-field="tag"]')?.focus();
    });
    panel.querySelectorAll('[data-text-tag-index]').forEach(element => {
        const index = Number(element.dataset.textTagIndex);
        const entry = entries[index];
        let previewFrame = 0;
        element.addEventListener('toggle', () => {
            if (element.open) updateCard(element, entry);
            else element.querySelector('[data-tag-preview]')?.shadowRoot?.replaceChildren();
        });
        element.querySelectorAll('[data-tag-field]').forEach(input => {
            const field = input.dataset.tagField;
            input.addEventListener(field === 'tag' || field === 'enabled' ? 'change' : 'input', () => {
                const value = field === 'enabled' ? input.checked : input.value;
                entry[field] = field === 'tag' ? value.trim().toLowerCase() : value;
                if (field === 'tag') input.value = entry.tag;
                persist();
                if (!previewFrame) previewFrame = requestAnimationFrame(() => {
                    previewFrame = 0;
                    if (element.isConnected) updateCard(element, entry);
                });
            });
        });
        element.querySelector('[data-tag-remove]').addEventListener('click', () => {
            entries.splice(index, 1);
            persist();
            rerender();
        });
        element.querySelectorAll('[data-tag-starter]').forEach(button => button.addEventListener('click', () => {
            entry.css = STARTERS[button.dataset.tagStarter];
            element.querySelector('[data-tag-field="css"]').value = entry.css;
            persist();
            updateCard(element, entry);
        }));
        element.querySelectorAll('[data-tag-copy]').forEach(button => button.addEventListener('click', async () => {
            const text = button.dataset.tagCopy === 'span'
                ? `<span class="${textTagClass(entry.tag)}">Your text here</span>`
                : `<${entry.tag}>Your text here</${entry.tag}>`;
            try {
                await navigator.clipboard.writeText(text);
                element.querySelector('[data-tag-feedback]').textContent = 'Copied.';
            } catch {
                element.querySelector('[data-tag-feedback]').textContent = 'Clipboard unavailable. Select and copy the example above.';
            }
        }));
        updateCard(element, entry);
    });
}
