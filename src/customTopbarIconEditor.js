// Floating editor for the named custom top-bar icon-set library.

import { getContext } from '../../../../extensions.js';
import { flushSidecar } from './sidecar.js';
import { normalizeBannerUrl, serializeCssUrl } from './design/designUtils.js';
import {
    CUSTOM_TOPBAR_HOVER_PRESETS,
    CUSTOM_TOPBAR_SLOTS,
    MAX_CUSTOM_SVG_LENGTH,
    clearCustomTopbarSet,
    createCustomTopbarSet,
    deleteCustomTopbarSet,
    getCustomTopbarSet,
    getCustomTopbarSets,
    iconifyIconUrl,
    renameCustomTopbarSet,
    resolveCustomIconUrl,
    sanitizeCustomSvg,
    setCustomTopbarBaseSet,
    setCustomTopbarHover,
    setCustomTopbarSlot,
} from './customTopbarIcons.js';

const OVERLAY_ID = 'bd-custom-topbar-overlay';
const STYLE_ID = 'bd-custom-topbar-editor-style';
const RASTER_FORMATS = new Set(['bmp', 'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp']);

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('../customTopbarIcons.css', import.meta.url).href;
    document.head.append(link);
}

async function inputPopup(title, initial = '') {
    const { Popup } = await import('../../../../../scripts/popup.js');
    const result = await Popup.show.input(title, null, initial);
    return typeof result === 'string' ? result.trim() : '';
}

async function confirmPopup(title, message) {
    const { Popup } = await import('../../../../../scripts/popup.js');
    return Boolean(await Popup.show.confirm(title, message));
}

function entrySummary(entry) {
    if (!entry) return 'Uses the base set';
    if (entry.source === 'iconify') return `Iconify · ${entry.value}`;
    if (entry.source === 'svg') return 'Pasted SVG';
    const value = String(entry.value || 'Custom image');
    return value.split('/').pop()?.split('?')[0] || value;
}

function sourcePlaceholder(source) {
    if (source === 'iconify') return 'lucide:send';
    if (source === 'svg') return '<svg viewBox="0 0 24 24">…</svg>';
    return 'https://… or /user/images/icons/…';
}

function renderSlot(slot, entry) {
    const source = entry?.source || 'url';
    const render = entry?.render || 'tint';
    return `
        <details class="bd-ci-card" data-slot="${esc(slot.id)}" data-label="${esc(slot.label.toLowerCase())}">
            <summary>
                <span class="bd-ci-preview ${entry?.render === 'original' ? 'bd-ci-original' : ''}">
                    ${entry ? '' : '<i class="fa-solid fa-arrow-rotate-left"></i>'}
                </span>
                <span class="bd-ci-card-copy">
                    <strong>${esc(slot.label)}</strong>
                    <small>${esc(entrySummary(entry))}</small>
                </span>
                <span class="bd-ci-card-state">${entry ? 'Custom' : 'Base'}</span>
                <i class="fa-solid fa-chevron-down bd-ci-chevron"></i>
            </summary>
            <div class="bd-ci-editor">
                <label>
                    <span>Source</span>
                    <select class="text_pole bd-ci-source">
                        <option value="url" ${source === 'url' ? 'selected' : ''}>URL or uploaded image</option>
                        <option value="iconify" ${source === 'iconify' ? 'selected' : ''}>Iconify name</option>
                        <option value="svg" ${source === 'svg' ? 'selected' : ''}>SVG markup</option>
                    </select>
                </label>
                <label class="bd-ci-icon-field">
                    <span>Icon</span>
                    <textarea class="text_pole bd-ci-value ${source === 'svg' ? 'bd-ci-value-svg' : ''}" rows="${source === 'svg' ? '7' : '1'}"
                              placeholder="${esc(sourcePlaceholder(source))}">${esc(entry?.value || '')}</textarea>
                </label>
                <label>
                    <span>Rendering</span>
                    <select class="text_pole bd-ci-render">
                        <option value="tint" ${render !== 'original' ? 'selected' : ''}>Theme color</option>
                        <option value="original" ${render === 'original' ? 'selected' : ''}>Original colors</option>
                    </select>
                </label>
                <div class="bd-ci-actions">
                    <button type="button" class="menu_button bd-ci-upload"><i class="fa-solid fa-upload"></i> Import image</button>
                    <button type="button" class="menu_button bd-ci-clear"><i class="fa-solid fa-arrow-rotate-left"></i> Use base</button>
                    <button type="button" class="menu_button bd-ci-apply"><i class="fa-solid fa-check"></i> Apply icon</button>
                    <input type="file" class="bd-ci-file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,image/*" hidden>
                </div>
                <div class="bd-ci-status" role="status"></div>
            </div>
        </details>`;
}

function renderGroups(set) {
    return [...new Set(CUSTOM_TOPBAR_SLOTS.map(slot => slot.group))].map(group => {
        const slots = CUSTOM_TOPBAR_SLOTS.filter(slot => slot.group === group);
        return `
            <section class="bd-ci-group">
                <div class="bd-ci-group-title"><span>${esc(group)}</span><small>${slots.length} icons</small></div>
                <div class="bd-ci-grid">${slots.map(slot => renderSlot(slot, set?.slots?.[slot.id])).join('')}</div>
            </section>`;
    }).join('');
}

function setOptions(selectedId) {
    return getCustomTopbarSets().map(set => `
        <option value="${esc(set.id)}" ${set.id === selectedId ? 'selected' : ''}>${esc(set.name)}</option>
    `).join('');
}

function baseOptions(baseChoices, selectedId) {
    return baseChoices.map(choice => `
        <option value="${esc(choice.id)}" ${choice.id === selectedId ? 'selected' : ''}>${esc(choice.label)}</option>
    `).join('');
}

function hoverOptions(selectedId) {
    return CUSTOM_TOPBAR_HOVER_PRESETS.map(preset => `
        <option value="${esc(preset.id)}" ${preset.id === selectedId ? 'selected' : ''}>${esc(preset.label)}</option>
    `).join('');
}

function editorContent(selectedId, baseChoices) {
    const sets = getCustomTopbarSets();
    const set = getCustomTopbarSet(selectedId);
    if (!set) {
        return `
            <div class="bd-ci-empty">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                <h3>Create your first custom set</h3>
                <p>Name it once, customize any number of icons, then reuse it globally or on several characters.</p>
                <button type="button" class="menu_button bd-ci-empty-create"><i class="fa-solid fa-plus"></i> Create custom set</button>
            </div>`;
    }
    return `
        <div class="bd-ci-toolbar">
            <label class="bd-ci-set-wrap">
                <span>Editing set</span>
                <select class="text_pole bd-ci-set-select">${setOptions(selectedId)}</select>
            </label>
            <div class="bd-ci-set-actions">
                <button type="button" class="menu_button bd-ci-new-set"><i class="fa-solid fa-plus"></i> New set</button>
                <button type="button" class="menu_button bd-ci-rename-set"><i class="fa-solid fa-pen"></i> Rename</button>
                <button type="button" class="menu_button bd-ci-delete-set"><i class="fa-solid fa-trash-can"></i> Delete</button>
            </div>
        </div>
        <div class="bd-ci-subtoolbar">
            <label class="bd-ci-base-wrap">
                <span>Base set for unassigned icons</span>
                <select class="text_pole bd-ci-base">${baseOptions(baseChoices, set.baseSet)}</select>
            </label>
            <label class="bd-ci-hover-wrap">
                <span>Hover effect</span>
                <select class="text_pole bd-ci-hover">${hoverOptions(set.hover)}</select>
            </label>
            <label class="bd-ci-search-wrap">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="search" class="text_pole bd-ci-search" placeholder="Find an icon…">
            </label>
            <span class="bd-ci-count">${Object.keys(set.slots).length} of ${CUSTOM_TOPBAR_SLOTS.length} customized</span>
        </div>
        <main class="bd-ci-groups">${renderGroups(set)}</main>
        <footer class="bd-ci-footer">
            <button type="button" class="menu_button bd-ci-reset-all"><i class="fa-solid fa-arrow-rotate-left"></i> Clear this set</button>
            <div class="bd-ci-legend"><span>Iconify</span><code>lucide:send</code><span>· SVG is stored in</span><code>uibedazzler_meta.json</code></div>
            <button type="button" class="menu_button bd-ci-close">Done</button>
        </footer>`;
}

function readFile(file, method) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read that file.'));
        reader[method](file);
    });
}

async function uploadRaster(file, slotId) {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    let format = (file.type.split('/')[1] || extension).toLowerCase();
    if (format === 'jpg') format = 'jpeg';
    if (!RASTER_FORMATS.has(format) && RASTER_FORMATS.has(extension)) format = extension === 'jpg' ? 'jpeg' : extension;
    if (!RASTER_FORMATS.has(format)) throw new Error('Use PNG, JPG, WebP, GIF, BMP, or SVG.');
    const dataUrl = await readFile(file, 'readAsDataURL');
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error('The selected image was empty.');

    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: getContext().getRequestHeaders(),
        body: JSON.stringify({
            image: base64,
            format,
            filename: `uibedazzler_${slotId}_${Date.now()}`,
            ch_name: 'icons',
        }),
    });
    if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
    const result = await response.json();
    return normalizeBannerUrl(result.path || '');
}

function syncSourceEditor(card) {
    const source = card.querySelector('.bd-ci-source')?.value || 'url';
    const value = card.querySelector('.bd-ci-value');
    if (!value) return;
    value.rows = source === 'svg' ? 7 : 1;
    value.classList.toggle('bd-ci-value-svg', source === 'svg');
    value.placeholder = sourcePlaceholder(source);
}

function setStatus(card, message, type = '') {
    const status = card.querySelector('.bd-ci-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.type = type;
}

function validateEntry(card) {
    const source = card.querySelector('.bd-ci-source')?.value || 'url';
    const render = card.querySelector('.bd-ci-render')?.value === 'original' ? 'original' : 'tint';
    const raw = card.querySelector('.bd-ci-value')?.value.trim() || '';
    if (!raw) return { error: 'Enter an icon first.' };
    if (source === 'iconify') {
        if (!iconifyIconUrl(raw)) return { error: 'Use an Iconify name like lucide:send.' };
        return { entry: { source, value: raw.toLowerCase(), render } };
    }
    if (source === 'svg') {
        const safe = sanitizeCustomSvg(raw);
        if (!safe) return { error: `Enter a valid SVG under ${Math.round(MAX_CUSTOM_SVG_LENGTH / 1000)} KB.` };
        return { entry: { source, value: safe, render } };
    }
    const safeUrl = normalizeBannerUrl(raw);
    if (!safeUrl) return { error: 'Use an http(s) URL or a served local path.' };
    return { entry: { source: 'url', value: safeUrl, render } };
}

function paintPreview(card, entry) {
    const preview = card.querySelector('.bd-ci-preview');
    if (!preview) return;
    preview.classList.toggle('bd-ci-original', entry?.render === 'original');
    preview.removeAttribute('style');
    preview.innerHTML = entry ? '' : '<i class="fa-solid fa-arrow-rotate-left"></i>';
    const url = resolveCustomIconUrl(entry);
    if (!url) return;
    if (entry.render === 'original') preview.style.backgroundImage = serializeCssUrl(url);
    else {
        preview.style.webkitMaskImage = serializeCssUrl(url);
        preview.style.maskImage = serializeCssUrl(url);
    }
}

function closeOtherCards(container, current) {
    container.querySelectorAll('.bd-ci-card[open]').forEach(card => {
        if (card !== current) card.open = false;
    });
}

function refreshCount(container, setId) {
    const set = getCustomTopbarSet(setId);
    const count = container.querySelector('.bd-ci-count');
    if (count) count.textContent = `${Object.keys(set?.slots || {}).length} of ${CUSTOM_TOPBAR_SLOTS.length} customized`;
}

function updateCardState(card, entry) {
    const summary = card.querySelector('.bd-ci-card-copy small');
    const state = card.querySelector('.bd-ci-card-state');
    if (summary) summary.textContent = entrySummary(entry);
    if (state) state.textContent = entry ? 'Custom' : 'Base';
    paintPreview(card, entry);
}

function wireCards(container, setId) {
    const set = getCustomTopbarSet(setId);
    container.querySelectorAll('.bd-ci-card').forEach(card => {
        paintPreview(card, set?.slots?.[card.dataset.slot]);
        card.addEventListener('toggle', () => {
            if (card.open) closeOtherCards(container, card);
        });
        card.querySelector('.bd-ci-source')?.addEventListener('change', () => syncSourceEditor(card));
        card.querySelector('.bd-ci-apply')?.addEventListener('click', () => {
            const { entry, error } = validateEntry(card);
            if (error) return setStatus(card, error, 'error');
            setCustomTopbarSlot(setId, card.dataset.slot, entry);
            setStatus(card, 'Applied.', 'success');
            updateCardState(card, entry);
            refreshCount(container, setId);
        });
        card.querySelector('.bd-ci-clear')?.addEventListener('click', () => {
            setCustomTopbarSlot(setId, card.dataset.slot, null);
            card.querySelector('.bd-ci-value').value = '';
            setStatus(card, 'Using the base set.', 'success');
            updateCardState(card, null);
            refreshCount(container, setId);
        });

        const fileInput = card.querySelector('.bd-ci-file');
        card.querySelector('.bd-ci-upload')?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const button = card.querySelector('.bd-ci-upload');
            const oldHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importing…';
            try {
                let entry;
                if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
                    const svg = sanitizeCustomSvg(await readFile(file, 'readAsText'));
                    if (!svg) throw new Error(`That SVG is invalid or larger than ${Math.round(MAX_CUSTOM_SVG_LENGTH / 1000)} KB.`);
                    entry = { source: 'svg', value: svg, render: card.querySelector('.bd-ci-render')?.value || 'tint' };
                } else {
                    const url = await uploadRaster(file, card.dataset.slot);
                    if (!url) throw new Error('SillyTavern did not return an image path.');
                    entry = { source: 'url', value: url, render: card.querySelector('.bd-ci-render')?.value || 'tint' };
                }
                setCustomTopbarSlot(setId, card.dataset.slot, entry);
                card.querySelector('.bd-ci-source').value = entry.source;
                card.querySelector('.bd-ci-value').value = entry.value;
                syncSourceEditor(card);
                setStatus(card, entry.source === 'url' ? 'Imported to user/images/icons.' : 'SVG saved in the Bedazzler sidecar.', 'success');
                updateCardState(card, entry);
                refreshCount(container, setId);
            } catch (error) {
                setStatus(card, error.message || 'Import failed.', 'error');
            } finally {
                button.disabled = false;
                button.innerHTML = oldHtml;
                fileInput.value = '';
            }
        });
    });
}

function renderEditor(shell, setId, baseChoices, selectSet) {
    shell.querySelector('.bd-ci-workspace').innerHTML = editorContent(setId, baseChoices);
    const workspace = shell.querySelector('.bd-ci-workspace');
    const set = getCustomTopbarSet(setId);

    workspace.querySelector('.bd-ci-empty-create')?.addEventListener('click', async () => {
        const name = await inputPopup('New Custom Icon Set', 'My Icon Set');
        if (!name) return;
        selectSet(createCustomTopbarSet(name));
    });
    if (!set) return;

    workspace.querySelector('.bd-ci-set-select')?.addEventListener('change', event => selectSet(event.currentTarget.value));
    workspace.querySelector('.bd-ci-new-set')?.addEventListener('click', async () => {
        const name = await inputPopup('New Custom Icon Set', 'My Icon Set');
        if (!name) return;
        selectSet(createCustomTopbarSet(name));
    });
    workspace.querySelector('.bd-ci-rename-set')?.addEventListener('click', async () => {
        const name = await inputPopup('Rename Custom Icon Set', set.name);
        if (!name || !renameCustomTopbarSet(setId, name)) return;
        renderEditor(shell, setId, baseChoices, selectSet);
    });
    workspace.querySelector('.bd-ci-delete-set')?.addEventListener('click', async () => {
        if (!await confirmPopup('Delete Custom Icon Set', `Delete “${set.name}”? Character assignments using it will fall back to the first available custom set.`)) return;
        deleteCustomTopbarSet(setId);
        selectSet(getCustomTopbarSets()[0]?.id || '');
    });
    workspace.querySelector('.bd-ci-base')?.addEventListener('change', event => {
        setCustomTopbarBaseSet(setId, event.currentTarget.value);
    });
    workspace.querySelector('.bd-ci-hover')?.addEventListener('change', event => {
        setCustomTopbarHover(setId, event.currentTarget.value);
    });
    workspace.querySelector('.bd-ci-search')?.addEventListener('input', event => {
        const query = event.currentTarget.value.trim().toLowerCase();
        workspace.querySelectorAll('.bd-ci-card').forEach(card => {
            card.hidden = Boolean(query && !card.dataset.label.includes(query));
        });
        workspace.querySelectorAll('.bd-ci-group').forEach(group => {
            group.hidden = ![...group.querySelectorAll('.bd-ci-card')].some(card => !card.hidden);
        });
    });
    workspace.querySelector('.bd-ci-reset-all')?.addEventListener('click', async () => {
        if (!await confirmPopup('Clear Custom Icon Set', `Clear every custom icon from “${set.name}”?`)) return;
        clearCustomTopbarSet(setId);
        renderEditor(shell, setId, baseChoices, selectSet);
    });
    workspace.querySelector('.bd-ci-close')?.addEventListener('click', () => closeEditor(shell.closest('.bd-ci-overlay')));
    wireCards(workspace, setId);
}

function closeEditor(overlay) {
    if (!overlay || overlay.dataset.closing) return;
    overlay.dataset.closing = 'true';
    overlay.classList.remove('bd-ci-visible');
    Promise.resolve(flushSidecar()).finally(() => {
        overlay.dispatchEvent(new Event('bd-ci-closed'));
        overlay.remove();
    });
}

/** Open the named custom-set library/editor and resolve after it closes. */
export function openCustomTopbarIconEditor(baseChoices = [], preferredSetId = '') {
    ensureStyles();
    document.getElementById(OVERLAY_ID)?.remove();
    const usableBaseChoices = baseChoices.filter(choice => choice.id !== 'custom');
    const initialSetId = getCustomTopbarSet(preferredSetId)?.id || getCustomTopbarSets()[0]?.id || '';

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'bd-ci-overlay';
    overlay.tabIndex = -1;
    overlay.innerHTML = `
        <section class="bd-ci-modal" role="dialog" aria-modal="true" aria-labelledby="bd-ci-title">
            <header class="bd-ci-header">
                <div>
                    <span class="bd-ci-kicker">Icon Sets</span>
                    <h2 id="bd-ci-title">Custom top-bar sets</h2>
                </div>
                <button type="button" class="menu_button bd-ci-header-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </header>
            <div class="bd-ci-workspace"></div>
        </section>`;
    document.body.append(overlay);

    const shell = overlay.querySelector('.bd-ci-modal');
    let selectedSetId = initialSetId;
    const selectSet = setId => {
        selectedSetId = setId;
        renderEditor(shell, selectedSetId, usableBaseChoices, selectSet);
    };
    overlay.querySelector('.bd-ci-header-close')?.addEventListener('click', () => closeEditor(overlay));
    overlay.addEventListener('click', event => {
        if (event.target === overlay) {
            closeEditor(overlay);
            return;
        }
        if (!event.target.closest('.bd-ci-card')) {
            shell.querySelectorAll('.bd-ci-card[open]').forEach(card => { card.open = false; });
        }
    });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeEditor(overlay);
    });
    renderEditor(shell, selectedSetId, usableBaseChoices, selectSet);
    requestAnimationFrame(() => {
        overlay.classList.add('bd-ci-visible');
        shell.querySelector('select, button')?.focus({ preventScroll: true });
    });

    return new Promise(resolve => overlay.addEventListener('bd-ci-closed', () => resolve(selectedSetId), { once: true }));
}
