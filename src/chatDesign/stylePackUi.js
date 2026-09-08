// On-demand Style Pack add/import/export UI.

import { ELEMENT_LABELS, getAvailableCharacters, getAvailablePersonas } from './storage.js';
import {
    applyPreparedStylePack, buildStylePackArchive, findThemeCollisionByName,
    getStylePackCollisions, getStylePackExportCandidates, listSavedThemeNamesForExport,
    prepareStylePackApplication, readStylePackFile,
} from './stylePacks.js';
import { renderStylePackPreview } from './preview.js';
import { getCustomTopbarSets } from '../customTopbarIcons.js';

const OVERLAY_ID = 'wl-style-pack-overlay';

function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function confirmPopup(title, message) {
    const { Popup } = await import('../../../../../../scripts/popup.js');
    return Boolean(await Popup.show.confirm(title, message));
}

function mountDialog(title, body, footer, dialogClass = '') {
    document.getElementById(OVERLAY_ID)?.remove();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'wl-sp-overlay';
    overlay.innerHTML = `
        <section class="wl-sp-dialog${dialogClass ? ` ${dialogClass}` : ''}" role="dialog" aria-modal="true" aria-labelledby="wl-sp-title">
            <header class="wl-sp-header">
                <div><small>Style Packs</small><h2 id="wl-sp-title">${esc(title)}</h2></div>
                <button type="button" class="wl-sp-icon-button" data-action="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </header>
            <div class="wl-sp-body">${body}</div>
            <footer class="wl-sp-footer">${footer}</footer>
        </section>`;
    document.body.append(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-action="close"], [data-action="cancel"]').forEach(button => button.addEventListener('click', close));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    return overlay;
}

function categoryChips(styles) {
    return styles.map(style => {
        const label = style.element === 'generalUi'
            ? (style.uiSection === 'integrations' ? 'Integrations General UI' : 'Native General UI')
            : (ELEMENT_LABELS[style.element] || style.element);
        return `<span class="wl-sp-chip">${esc(label)}</span>`;
    }).join('');
}

function pickerRows(items, group) {
    return items.map(item => `
        <label class="wl-sp-pick-row">
            <input type="checkbox" name="${group}" value="${esc(item.avatar)}">
            <span>${esc(item.name)}</span><small>${esc(item.avatar)}</small>
        </label>`).join('');
}

function usageInstructions(pack) {
    const instructions = [
        'Styles are assigned to every character and persona you select below. Leave both lists empty to add them unassigned.',
    ];
    if (pack.resources.theme) instructions.push('After applying, refresh SillyTavern, then choose the imported theme manually.');
    if (pack.resources.customTopbarIcons) instructions.push('Assign the imported custom icon set manually after applying.');
    return `
        <div class="wl-sp-usage">
            <strong>Using this pack</strong>
            <ul>${instructions.map(instruction => `<li>${esc(instruction)}</li>`).join('')}</ul>
        </div>
        ${pack.notes ? `<div class="wl-sp-creator-notes"><strong>Creator notes</strong><p>${esc(pack.notes)}</p></div>` : ''}
    `;
}

function collisionDecision(id, title, copy) {
    return `
        <div class="wl-sp-collision" id="${id}" hidden>
            <div><strong>${esc(title)}</strong><span>${esc(copy)}</span></div>
            <select class="text_pole" aria-label="${esc(title)} collision decision">
                <option value="rename">Rename destination</option>
                <option value="replace">Replace existing</option>
            </select>
        </div>`;
}

async function openReviewDialog(parsed, onApplied) {
    const [characters, personas] = await Promise.all([
        Promise.resolve(getAvailableCharacters().sort((a, b) => a.name.localeCompare(b.name))),
        getAvailablePersonas().then(items => items.sort((a, b) => a.name.localeCompare(b.name))),
    ]);
    const { pack } = parsed;
    const iconResource = pack.resources.customTopbarIcons;
    const themeResource = pack.resources.theme;
    const overlay = mountDialog('Review & apply', `
        <label class="wl-sp-field"><span>Destination pack name</span>
            <input class="text_pole" id="wl-sp-name" maxlength="80" value="${esc(pack.name)}">
        </label>
        <div class="wl-sp-summary"><strong>Included style categories</strong>
            <div class="wl-sp-chips">${categoryChips(pack.styles) || '<span class="wl-sp-muted">No style blocks</span>'}</div>
        </div>
        ${usageInstructions(pack)}
        <p class="wl-sp-note"><strong>Replace Style Pack</strong> removes every eligible existing style block with the destination name before adding the incoming blocks.</p>
        ${collisionDecision('wl-sp-style-collision', 'Style Pack name already exists', 'Rename the destination or explicitly replace the complete existing pack.')}
        ${themeResource ? `
            <div class="wl-sp-resource"><i class="fa-solid fa-palette"></i><div><strong>Saved theme</strong>
                <span>${esc(themeResource.name)} · imported inactive and unassigned</span></div></div>
            <label class="wl-sp-field"><span>Destination theme name</span>
                <input class="text_pole" id="wl-sp-theme-name" maxlength="80" value="${esc(themeResource.name)}">
            </label>
            ${collisionDecision('wl-sp-theme-collision', 'Theme name already exists', 'Rename the destination theme or explicitly replace the saved theme.')}
        ` : ''}
        ${iconResource ? `
            <div class="wl-sp-resource"><i class="fa-solid fa-icons"></i><div><strong>Custom top-bar icon set</strong>
                <span>${esc(iconResource.name)} · ${Object.keys(iconResource.slots || {}).length} icons · imported inactive and unassigned</span></div></div>
            <label class="wl-sp-field"><span>Destination icon-set name</span>
                <input class="text_pole" id="wl-sp-icon-name" maxlength="80" value="${esc(iconResource.name)}">
            </label>
            ${collisionDecision('wl-sp-icon-collision', 'Icon-set name already exists', 'Rename the destination icon set or explicitly replace the saved set.')}
        ` : ''}
        ${pack.styles.length ? `
            <div class="wl-sp-assignments">
                <div class="wl-sp-summary"><strong>Optional assignments</strong><span class="wl-sp-muted">Leave everything unchecked to create unassigned styles.</span></div>
                <div class="wl-sp-picker-grid">
                    <section><h3>Characters</h3><div class="wl-sp-pick-list">${pickerRows(characters, 'character') || '<span class="wl-sp-empty">No characters loaded</span>'}</div></section>
                    <section><h3>Personas</h3><div class="wl-sp-pick-list">${pickerRows(personas, 'persona') || '<span class="wl-sp-empty">No personas found</span>'}</div></section>
                </div>
            </div>` : ''}
        <div class="wl-sp-status" role="status"></div>
    `, `
        <button type="button" class="menu_button" data-action="cancel">Cancel</button>
        <button type="button" class="menu_button wl-sp-primary" data-action="apply"><i class="fa-solid fa-plus"></i> Apply Pack</button>
    `);

    const status = overlay.querySelector('.wl-sp-status');
    const applyButton = overlay.querySelector('[data-action="apply"]');
    const packNameInput = overlay.querySelector('#wl-sp-name');
    const themeNameInput = overlay.querySelector('#wl-sp-theme-name');
    const iconNameInput = overlay.querySelector('#wl-sp-icon-name');
    const styleDecision = overlay.querySelector('#wl-sp-style-collision');
    const themeDecision = overlay.querySelector('#wl-sp-theme-collision');
    const iconDecision = overlay.querySelector('#wl-sp-icon-collision');
    let collisionRevision = 0;
    let collisionState = { styles: false, theme: null, icon: null };

    const refreshCollisions = async () => {
        const revision = ++collisionRevision;
        const destinationName = packNameInput?.value.trim() || '';
        const themeName = themeNameInput?.value.trim() || '';
        const iconName = iconNameInput?.value.trim() || '';
        const styles = destinationName ? getStylePackCollisions(pack, destinationName).packStyleIds.length > 0 : false;
        let icon = null;
        if (iconResource && iconName) {
            const renamedPack = { ...pack, resources: { ...pack.resources, customTopbarIcons: { ...iconResource, name: iconName } } };
            icon = getStylePackCollisions(renamedPack, destinationName || pack.name).iconSet;
        }
        const theme = themeResource && themeName ? await findThemeCollisionByName(themeName) : null;
        if (revision !== collisionRevision || !overlay.isConnected) return;
        collisionState = { styles, theme, icon };
        if (styleDecision) styleDecision.hidden = !styles;
        if (themeDecision) themeDecision.hidden = !theme;
        if (iconDecision) iconDecision.hidden = !icon;
    };
    // Collision discovery can query saved themes, so wait for a committed edit
    // instead of making a settings request on every destination-name keystroke.
    [packNameInput, themeNameInput, iconNameInput].filter(Boolean).forEach(input => input.addEventListener('change', refreshCollisions));
    await refreshCollisions();

    applyButton.addEventListener('click', async () => {
        await refreshCollisions();
        const destinationName = packNameInput?.value.trim() || '';
        const themeName = themeNameInput?.value.trim() || '';
        const iconSetName = iconNameInput?.value.trim() || '';
        if (!destinationName) return void (status.textContent = 'Enter a destination pack name.');
        if (themeResource && !themeName) return void (status.textContent = 'Enter a destination theme name.');
        if (iconResource && !iconSetName) return void (status.textContent = 'Enter a destination icon-set name.');
        const styleChoice = styleDecision?.querySelector('select')?.value || 'rename';
        const themeChoice = themeDecision?.querySelector('select')?.value || 'rename';
        const iconChoice = iconDecision?.querySelector('select')?.value || 'rename';
        if (collisionState.styles && styleChoice === 'rename') return void (status.textContent = 'Rename the destination pack or choose Replace existing.');
        if (collisionState.theme && themeChoice === 'rename') return void (status.textContent = 'Rename the destination theme or choose Replace existing.');
        if (collisionState.icon && iconChoice === 'rename') return void (status.textContent = 'Rename the destination icon set or choose Replace existing.');
        const replaceStyles = collisionState.styles && styleChoice === 'replace';
        const replaceTheme = Boolean(collisionState.theme && themeChoice === 'replace');
        const replaceIconSetId = collisionState.icon && iconChoice === 'replace' ? collisionState.icon.id : '';
        const confirmed = await confirmPopup(
            'Apply Style Pack?',
            `Apply “${destinationName}” now? Validation and resource preparation begin only after this confirmation.${replaceStyles ? ' The existing complete Style Pack will be removed and replaced.' : ''}`,
        );
        if (!confirmed || !overlay.isConnected) return;

        applyButton.disabled = true;
        applyButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing…';
        status.textContent = 'Validating and preparing resources before changing saved styles…';
        try {
            const prepared = await prepareStylePackApplication(parsed);
            applyButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Applying…';
            const assignedCharacters = [...overlay.querySelectorAll('input[name="character"]:checked')].map(input => input.value);
            const assignedPersonas = [...overlay.querySelectorAll('input[name="persona"]:checked')].map(input => input.value);
            const result = await applyPreparedStylePack(prepared, {
                destinationName, assignedCharacters, assignedPersonas, replaceStyles,
                themeName, replaceTheme, iconSetName, replaceIconSetId,
            });
            globalThis.toastr?.success(`${result.styles.length} style blocks${result.themeName ? ' and 1 theme' : ''}${result.customTopbarSetId ? ' and 1 custom icon set' : ''} added.`, 'Style Packs');
            if (result.themeRefreshRequired) {
                globalThis.toastr?.warning('Refresh SillyTavern before the replaced theme appears in the theme list.', 'Theme refresh required', { timeOut: 12000 });
            }
            overlay.remove();
            onApplied?.(result);
        } catch (error) {
            status.textContent = error.message || 'The Style Pack could not be applied.';
            applyButton.disabled = false;
            applyButton.innerHTML = '<i class="fa-solid fa-plus"></i> Apply Pack';
        }
    });
    requestAnimationFrame(() => packNameInput?.focus());
}

/** Choose a bundled Style Pack, then open the shared review screen. */
export async function addStylePack(onApplied) {
    const { getBuiltInStylePack, getBuiltInStylePacks } = await import('./builtInStylePacks.js');
    const packs = await getBuiltInStylePacks();
    const resourceSummary = pack => {
        const resources = [];
        if (pack.resources?.theme) resources.push('saved theme');
        const iconCount = Object.keys(pack.resources?.customTopbarIcons?.slots || {}).length;
        if (iconCount) resources.push(`${iconCount} top-bar icons`);
        return resources.join(' · ');
    };
    const overlay = mountDialog('Add a built-in pack', `
        <p class="wl-sp-note">Choose a bundled starting point. You can rename it and select assignments before applying.</p>
        <div class="wl-sp-pack-browser">
            <div class="wl-sp-candidate-list wl-sp-pack-list" role="listbox" aria-label="Built-in Style Packs">
                ${packs.map((pack, index) => `
                    <button type="button" class="wl-sp-candidate wl-sp-pack-choice" data-pack-index="${index}" role="option" aria-selected="${index === 0}">
                        <span><strong>${esc(pack.name)}</strong><small>${pack.styles.length} style categories${resourceSummary(pack) ? ` · ${esc(resourceSummary(pack))}` : ''}</small></span>
                        <span class="wl-sp-chips">${categoryChips(pack.styles)}</span>
                    </button>`).join('')}
            </div>
            <section class="wl-sp-pack-preview-pane" aria-label="Selected Style Pack preview">
                <header><span><i class="fa-regular fa-eye"></i> Live Preview</span><strong id="wl-sp-preview-name"></strong></header>
                <div class="wl-sp-pack-preview-host"></div>
                <p>Rendered by Chat Design using the current chat's background and avatar. Saved themes, General UI settings, and custom top-bar icons are listed but not simulated here.</p>
            </section>
        </div>
    `, `
        <button type="button" class="menu_button" data-action="cancel">Cancel</button>
        <button type="button" class="menu_button wl-sp-primary" data-action="review"><i class="fa-solid fa-arrow-right"></i> Review &amp; apply</button>
    `, 'wl-sp-dialog-packs');
    const previewHost = overlay.querySelector('.wl-sp-pack-preview-host');
    const previewName = overlay.querySelector('#wl-sp-preview-name');
    let selectedIndex = 0;
    const selectPack = index => {
        selectedIndex = index;
        overlay.querySelectorAll('[data-pack-index]').forEach(button => {
            button.setAttribute('aria-selected', String(Number(button.dataset.packIndex) === selectedIndex));
        });
        if (previewName) previewName.textContent = packs[selectedIndex].name;
        renderStylePackPreview(previewHost, packs[selectedIndex]);
    };
    overlay.querySelectorAll('[data-pack-index]').forEach(button => button.addEventListener('click', () => {
        selectPack(Number(button.dataset.packIndex));
    }));
    overlay.querySelector('[data-action="review"]')?.addEventListener('click', async () => {
        const pack = packs[selectedIndex];
        overlay.remove();
        try {
            await openReviewDialog(await getBuiltInStylePack(pack.name), onApplied);
        } catch (error) {
            globalThis.toastr?.error(error.message || 'The built-in Style Pack could not be loaded.', 'Style Packs');
        }
    });
    selectPack(0);
}

/** Open a file picker, validate the archive, then show the shared review screen. */
export function importStylePack(onApplied) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.uibedazzler-pack,application/zip';
    input.hidden = true;
    document.body.append(input);
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        try {
            await openReviewDialog(await readStylePackFile(file), onApplied);
        } catch (error) {
            globalThis.toastr?.error(error.message || 'The Style Pack could not be read.', 'Style Packs');
        }
    }, { once: true });
    input.click();
}

/** Choose an exact-name style group and optional resources, then download an archive. */
export async function exportStylePack() {
    const candidates = getStylePackExportCandidates();
    let themeNames;
    try {
        themeNames = await listSavedThemeNamesForExport();
    } catch (error) {
        globalThis.toastr?.error(error.message || 'Saved theme names could not be loaded.', 'Style Packs');
        return;
    }
    const iconSets = getCustomTopbarSets().sort((a, b) => a.name.localeCompare(b.name));
    const overlay = mountDialog('Export a pack', `
        <div class="wl-sp-export-grid">
            <section class="wl-sp-export-pane wl-sp-export-picker">
                <label class="wl-sp-field"><span>Find a Style Pack</span>
                    <input class="text_pole" id="wl-sp-export-search" type="search" placeholder="Search saved pack names…">
                </label>
                <div class="wl-sp-candidate-list wl-sp-export-list" id="wl-sp-export-candidates">
                    ${candidates.map((candidate, index) => `
                        <label class="wl-sp-candidate" data-search="${esc(candidate.name.toLocaleLowerCase())}">
                            <input type="radio" name="export-pack" value="${index}">
                            <span><strong>${esc(candidate.name)}</strong><small>${candidate.labels.map(esc).join(' · ')}</small></span>
                        </label>`).join('') || '<span class="wl-sp-empty">No exact-name groups contain at least two unambiguous categories.</span>'}
                </div>
            </section>
            <section class="wl-sp-export-pane wl-sp-export-options">
                <label class="wl-sp-field"><span>Saved theme</span>
                    <select class="text_pole" id="wl-sp-export-theme"><option value="">None</option>
                        ${themeNames.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
                    </select>
                    <small class="wl-sp-muted">An exact-name theme is selected automatically when available; you can choose any saved theme.</small>
                </label>
                <label class="wl-sp-field"><span>Custom top-bar icon set</span>
                    <select class="text_pole" id="wl-sp-export-icons"><option value="">None</option>
                        ${iconSets.map(set => `<option value="${esc(set.id)}">${esc(set.name)} (${set.iconCount} icons)</option>`).join('')}
                    </select>
                </label>
                <label class="wl-sp-field wl-sp-export-notes"><span>Creator notes <small>(optional)</small></span>
                    <textarea class="text_pole" id="wl-sp-export-notes" rows="8" maxlength="2000" placeholder="Setup tips, recommended pairings, or other brief usage notes…"></textarea>
                    <small class="wl-sp-muted">Shown when someone reviews the pack before importing.</small>
                </label>
            </section>
        </div>
        <div class="wl-sp-status" role="status"></div>
    `, `
        <button type="button" class="menu_button" data-action="cancel">Cancel</button>
        <button type="button" class="menu_button wl-sp-primary" data-action="export" disabled><i class="fa-solid fa-file-export"></i> Export Pack</button>
    `, 'wl-sp-dialog-export');
    const search = overlay.querySelector('#wl-sp-export-search');
    const exportButton = overlay.querySelector('[data-action="export"]');
    const status = overlay.querySelector('.wl-sp-status');
    const themeSelect = overlay.querySelector('#wl-sp-export-theme');
    const selectedCandidate = () => candidates[Number(overlay.querySelector('input[name="export-pack"]:checked')?.value)];
    const syncSelection = () => {
        const candidate = selectedCandidate();
        exportButton.disabled = !candidate;
        themeSelect.value = candidate && themeNames.includes(candidate.name) ? candidate.name : '';
        status.textContent = '';
    };
    overlay.querySelectorAll('input[name="export-pack"]').forEach(radio => radio.addEventListener('change', syncSelection));
    search.addEventListener('input', () => {
        const query = search.value.trim().toLocaleLowerCase();
        overlay.querySelectorAll('#wl-sp-export-candidates .wl-sp-candidate').forEach(row => {
            row.hidden = Boolean(query && !row.dataset.search.includes(query));
        });
    });
    exportButton.addEventListener('click', async () => {
        const candidate = selectedCandidate();
        if (!candidate) return;
        exportButton.disabled = true;
        exportButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Building…';
        status.textContent = 'Building the Style Pack archive…';
        try {
            const blob = await buildStylePackArchive(candidate.name, {
                customTopbarSetId: overlay.querySelector('#wl-sp-export-icons')?.value || '',
                themeName: themeSelect.value,
                notes: overlay.querySelector('#wl-sp-export-notes')?.value || '',
            });
            const { downloadStylePack } = await import('./stylePackArchive.js');
            downloadStylePack(blob, candidate.name);
            globalThis.toastr?.success(`“${candidate.name}” was exported.`, 'Style Packs');
            overlay.remove();
        } catch (error) {
            status.textContent = error.message || 'The Style Pack could not be exported.';
            exportButton.disabled = false;
            exportButton.innerHTML = '<i class="fa-solid fa-file-export"></i> Export Pack';
        }
    });
    requestAnimationFrame(() => search.focus());
}
