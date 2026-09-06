// Searchable font picker UI for catalog and locally installed fonts.

import {
    FONT_CATALOG, FONT_CATEGORIES,
    createLocalFontValue, getFontDisplayName, getFontFamilyCSS, getFontSourceLabel,
    loadFont, parseFontValue, queryInstalledFontFamilies, supportsLocalFontAccess,
} from './fonts.js';
import { createFontResultList } from './fontResultList.js';

const RECENT_LIMIT = 5;

let installedFamilies = null;
let installedFontError = '';
const recentFontValues = [];

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function rememberFont(value) {
    const normalized = parseFontValue(value).value;
    if (parseFontValue(normalized).kind === 'default') return;
    const existing = recentFontValues.indexOf(normalized);
    if (existing !== -1) recentFontValues.splice(existing, 1);
    recentFontValues.unshift(normalized);
    recentFontValues.splice(RECENT_LIMIT);
}

function resultSource(value, recent = false) {
    if (recent) return 'Recent';
    const parsed = parseFontValue(value);
    if (parsed.kind === 'default') return 'Theme';
    if (parsed.kind === 'local') return 'Installed';
    if (parsed.kind === 'system') return 'System';
    return parsed.font?.source === 'fontshare' ? 'Fontshare' : 'Google';
}

function fontResult(value, recent = false) {
    const parsed = parseFontValue(value);
    return {
        value: parsed.value,
        name: parsed.name,
        source: resultSource(parsed.value, recent),
    };
}

export function renderFontPicker(currentFont, fieldId, options = {}) {
    const parsed = parseFontValue(currentFont);
    const panelId = `${fieldId}-panel`;
    const useCustom = options.useCustom ?? parsed.kind !== 'default';
    const useCustomFieldId = options.useCustomFieldId || '';
    const customKey = useCustomFieldId.replace('wl-cdm-p-', '');
    const hideWhenDisabled = !!options.hideWhenDisabled && !!customKey;
    const customControlAttrs = hideWhenDisabled
        ? `data-wl-font-custom-control="${esc(customKey)}" ${useCustom ? '' : 'hidden'}`
        : '';
    const displayName = parsed.kind === 'default' ? 'Choose a font…' : parsed.name;
    const sourceLabel = parsed.kind === 'default' ? 'Using theme default' : getFontSourceLabel(parsed.value);
    return `
        <div class="wl-cdm-field wl-cdm-font-field" data-font-picker
             data-font-field-id="${esc(fieldId)}" data-font-value="${esc(parsed.value)}"
             ${customKey ? `data-wl-custom-field="${esc(customKey)}"` : ''}>
            <div class="wl-cdm-field-label-row">
                <label class="wl-cdm-field-label" for="${esc(fieldId)}">Font Family</label>
                ${useCustomFieldId ? `
                    <label class="wl-cdm-use-custom">
                        <input type="checkbox" class="wl-cdm-prop-checkbox" id="${esc(useCustomFieldId)}" ${useCustom ? 'checked' : ''}>
                        <span>Use Custom</span>
                    </label>
                ` : ''}
            </div>
            <button type="button" class="wl-cdm-font-control" id="${esc(fieldId)}"
                    aria-expanded="false" aria-controls="${esc(panelId)}"
                    ${customControlAttrs}
                    ${customKey ? `data-wl-custom-dependent="${esc(customKey)}"` : ''}
                    ${useCustom ? '' : 'disabled'}>
                <span class="wl-cdm-font-control-name">${esc(displayName)}</span>
                <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
            </button>
            <div class="wl-cdm-font-meta" ${customControlAttrs}>${esc(sourceLabel)}</div>
            <div class="wl-cdm-font-panel" id="${esc(panelId)}" hidden>
                <input type="search" class="wl-cdm-input wl-cdm-font-search"
                       placeholder="Start typing to find a font…" autocomplete="off" spellcheck="false"
                       aria-label="Find or enter a font name">
                <div class="wl-cdm-font-sources" role="group" aria-label="Font source">
                    <button type="button" class="wl-cdm-font-source-active" data-font-source="all" aria-pressed="true">All</button>
                    <button type="button" data-font-source="library" aria-pressed="false">Library</button>
                    <button type="button" data-font-source="installed" aria-pressed="false">Installed</button>
                </div>
                <select class="wl-cdm-font-category" aria-label="Font category" hidden>
                    <option value="all">All categories</option>
                    ${FONT_CATEGORIES.map(category => `<option value="${esc(category.id)}">${esc(category.label)}</option>`).join('')}
                </select>
                <div class="wl-cdm-font-results" role="listbox" aria-label="Font results"></div>
                <div class="wl-cdm-font-results-note"></div>
                <div class="wl-cdm-font-preview">
                    <div class="wl-cdm-font-preview-text">The quick brown fox jumps over the lazy dog.</div>
                    <div class="wl-cdm-font-preview-source"></div>
                </div>
                <button type="button" class="wl-cdm-font-browse">Browse installed fonts…</button>
                <div class="wl-cdm-font-browse-status" aria-live="polite"></div>
            </div>
        </div>
    `;
}

function catalogResults(query, category) {
    return FONT_CATALOG
        .filter(font => font.name !== 'Default (Theme)')
        .filter(font => category === 'all' || font.category === category)
        .filter(font => !query || font.name.toLocaleLowerCase().includes(query))
        .map(font => fontResult(font.name));
}

function localResults(query) {
    if (!installedFamilies) return [];
    return installedFamilies
        .filter(name => !query || name.toLocaleLowerCase().includes(query))
        .map(name => fontResult(createLocalFontValue(name)));
}

function buildResults(state) {
    const query = state.query.trim().toLocaleLowerCase();
    let results = [];
    const current = parseFontValue(state.value);

    const currentMatchesSource = state.source === 'all'
        || (state.source === 'installed' && current.kind === 'local')
        || (state.source === 'library' && current.kind !== 'local');
    const currentMatchesCategory = state.source !== 'library'
        || state.category === 'all'
        || current.font?.category === state.category;
    if (!query && current.kind !== 'default' && currentMatchesSource && currentMatchesCategory) {
        results.push(fontResult(current.value));
    }

    if (!query && state.source === 'all') {
        results.push(...recentFontValues.map(value => fontResult(value, true)));
    }

    if (state.source !== 'installed') {
        results.push(...catalogResults(query, state.source === 'library' ? state.category : 'all'));
    }
    if (state.source !== 'library') {
        results.push(...localResults(query));
    }

    const seen = new Set();
    return results.filter(result => {
        if (seen.has(result.value)) return false;
        seen.add(result.value);
        return true;
    });
}

function localBrowseMessage(error) {
    if (!error) return '';
    if (error.name === 'NotAllowedError') return 'Installed font access was not granted. You can still type a font name manually.';
    if (error.name === 'SecurityError') return 'This app context cannot request installed fonts. Manual font names still work.';
    return error.message || 'Installed fonts could not be read. Manual font names still work.';
}

/**
 * Wire every picker inside a property panel. onChange receives the original
 * field id plus the normalized stored value.
 */
export function wireFontPickers(root, onChange) {
    root.querySelectorAll('[data-font-picker]').forEach(picker => {
        const fieldId = picker.dataset.fontFieldId;
        const control = picker.querySelector('.wl-cdm-font-control');
        const controlName = picker.querySelector('.wl-cdm-font-control-name');
        const meta = picker.querySelector('.wl-cdm-font-meta');
        const panel = picker.querySelector('.wl-cdm-font-panel');
        const search = picker.querySelector('.wl-cdm-font-search');
        const category = picker.querySelector('.wl-cdm-font-category');
        const results = picker.querySelector('.wl-cdm-font-results');
        const resultsNote = picker.querySelector('.wl-cdm-font-results-note');
        const previewText = picker.querySelector('.wl-cdm-font-preview-text');
        const previewSource = picker.querySelector('.wl-cdm-font-preview-source');
        const browse = picker.querySelector('.wl-cdm-font-browse');
        const browseStatus = picker.querySelector('.wl-cdm-font-browse-status');
        const sourceButtons = [...picker.querySelectorAll('[data-font-source]')];
        if (!control || !panel || !search || !results) return;

        const state = {
            value: parseFontValue(picker.dataset.fontValue).value,
            source: 'all',
            category: 'all',
            query: '',
            previewTimer: null,
            renderedResults: [],
            browsePending: false,
        };

        const updateBrowseControl = () => {
            if (installedFamilies) {
                browse.hidden = true;
            } else if (supportsLocalFontAccess()) {
                browse.hidden = false;
                browse.textContent = 'Browse installed fonts…';
                browse.disabled = false;
            } else {
                browse.hidden = false;
                browse.textContent = 'Installed font browsing is unavailable';
                browse.disabled = true;
            }
            browseStatus.textContent = installedFontError || (installedFamilies
                ? `${installedFamilies.length} Windows font families loaded · Restart the app after installing new fonts.`
                : '');
        };

        const showPreview = value => {
            const parsed = parseFontValue(value);
            window.clearTimeout(state.previewTimer);
            state.previewTimer = window.setTimeout(() => {
                loadFont(parsed.value);
                previewText.style.fontFamily = getFontFamilyCSS(parsed.value);
                previewSource.textContent = getFontSourceLabel(parsed.value);
            }, 140);
        };

        const choose = value => {
            const parsed = parseFontValue(value);
            state.value = parsed.value;
            picker.dataset.fontValue = parsed.value;
            controlName.textContent = parsed.name;
            controlName.style.fontFamily = getFontFamilyCSS(parsed.value);
            meta.textContent = getFontSourceLabel(parsed.value);
            loadFont(parsed.value);
            rememberFont(parsed.value);
            onChange?.({ fieldId, value: parsed.value });
            panel.hidden = true;
            control.setAttribute('aria-expanded', 'false');
            control.focus();
        };

        const resultList = createFontResultList(results, {
            onPreview: value => showPreview(value),
            onChoose: value => choose(value),
        });

        const renderResults = () => {
            const allResults = buildResults(state);
            const manualName = state.query.trim();
            const showManual = manualName && state.source !== 'library';
            state.renderedResults = showManual
                ? [...allResults, {
                    value: createLocalFontValue(manualName),
                    name: `Use “${manualName}”`,
                    source: 'Local name',
                    manual: true,
                }]
                : allResults;
            resultList.setItems(state.renderedResults, state.value);

            if (state.source === 'installed' && !installedFamilies) {
                resultsNote.textContent = 'Grant access below to browse installed fonts, or type a name manually.';
            } else if (allResults.length === 0 && !showManual) {
                resultsNote.textContent = 'No matching fonts';
            } else if (!state.query && allResults.length > 6) {
                resultsNote.textContent = state.source === 'installed'
                    ? `${allResults.length} installed families · Scroll or start typing to find one`
                    : `${allResults.length} fonts · Scroll or start typing to find one`;
            } else {
                resultsNote.textContent = '';
            }

            showPreview(state.renderedResults[0]?.value || state.value);
            updateBrowseControl();
        };

        const setSource = source => {
            state.source = source;
            category.hidden = source !== 'library';
            sourceButtons.forEach(button => {
                const active = button.dataset.fontSource === source;
                button.classList.toggle('wl-cdm-font-source-active', active);
                button.setAttribute('aria-pressed', String(active));
            });
            renderResults();
        };

        const setOpen = open => {
            panel.hidden = !open;
            control.setAttribute('aria-expanded', String(open));
            if (!open) return;
            state.query = '';
            search.value = '';
            setSource('all');
            window.requestAnimationFrame(() => search.focus());
        };

        controlName.style.fontFamily = getFontFamilyCSS(state.value);
        control.addEventListener('click', () => setOpen(panel.hidden));
        sourceButtons.forEach(button => button.addEventListener('click', () => setSource(button.dataset.fontSource)));
        category.addEventListener('change', () => {
            state.category = category.value;
            renderResults();
        });
        search.addEventListener('input', () => {
            state.query = search.value;
            renderResults();
        });
        search.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                resultList.focusFirst();
                return;
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const query = state.query.trim().toLocaleLowerCase();
            if (!query) return;
            const exact = state.renderedResults
                .find(result => getFontDisplayName(result.value).toLocaleLowerCase() === query);
            choose(exact?.value || createLocalFontValue(state.query));
        });
        browse.addEventListener('click', async () => {
            state.browsePending = true;
            browse.disabled = true;
            browseStatus.textContent = 'Waiting for installed font permission…';
            try {
                installedFamilies = await queryInstalledFontFamilies();
                installedFontError = '';
                setSource('installed');
            } catch (error) {
                installedFontError = localBrowseMessage(error);
                updateBrowseControl();
            } finally {
                // Native font permission temporarily moves focus outside the
                // picker. Restore the open panel instead of treating that as
                // the user's normal focus-away dismissal.
                state.browsePending = false;
                panel.hidden = false;
                control.setAttribute('aria-expanded', 'true');
                window.requestAnimationFrame(() => search.focus());
            }
        });
        picker.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || panel.hidden) return;
            // Keep the modal's global Escape handler from closing the entire
            // editor when the user only intended to close the font browser.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            control.focus();
        });
        picker.addEventListener('focusout', () => {
            window.requestAnimationFrame(() => {
                if (state.browsePending) return;
                if (!picker.contains(document.activeElement)) setOpen(false);
            });
        });

        showPreview(state.value);
        updateBrowseControl();
    });
}
