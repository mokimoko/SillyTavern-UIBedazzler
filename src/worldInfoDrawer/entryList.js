// src/worldInfoDrawer/entryList.js
// Manages the book list column, active books sidebar, global settings sync,
// and entry table rendering for the World Info Drawer takeover.

import { WL_PREFIX, STRATEGY_COLORS } from './constants.js';

const log = (...args) => console.log('[WL WID EntryList]', ...args);

/** Cached world-info module — single dynamic import, resolved once. */
const worldInfoPromise = import('../../../../../../scripts/world-info.js');

/** Currently selected book name */
let currentBookName = null;
/** Currently loaded book data */
let currentBookData = null;
/** UID of the currently expanded entry (string, or null = none) */
let expandedEntryUid = null;
/** Pagination state */
let currentPage = 0;
const PAGE_SIZE = 50;

// ============================================================
// Public API
// ============================================================

export function getCurrentBook() { return { name: currentBookName, data: currentBookData }; }

/**
 * Populates the book list column from world_names.
 * Shows each lorebook as a selectable item with an X to detach.
 */
export function populateBookList() {
    const container = document.querySelector(`.${WL_PREFIX}-book-items`);
    if (!container) return;

    worldInfoPromise.then(({ world_names }) => {
        if (!world_names || !Array.isArray(world_names)) {
            log('world_names not available');
            return;
        }

        const sorted = [...world_names].sort((a, b) => a.localeCompare(b));

        if (sorted.length === 0) {
            container.innerHTML = `<div class="${WL_PREFIX}-placeholder-text">No lorebooks found</div>`;
            return;
        }

        container.innerHTML = sorted.map(name => `
            <div class="${WL_PREFIX}-book-item ${name === currentBookName ? WL_PREFIX + '-book-selected' : ''}" data-book="${escapeAttr(name)}">
                <span class="${WL_PREFIX}-book-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
            </div>
        `).join('');

        // Wire click-to-select
        container.querySelectorAll(`.${WL_PREFIX}-book-item`).forEach(item => {
            item.addEventListener('click', () => {
                const bookName = item.dataset.book;
                selectBook(bookName);

                // Update visual selection
                container.querySelectorAll(`.${WL_PREFIX}-book-item`).forEach(
                    b => b.classList.toggle(`${WL_PREFIX}-book-selected`, b === item)
                );
            });
        });

        log(`Book list populated: ${sorted.length} books`);
    }).catch(err => log('Failed to import world_names:', err));
}

/**
 * Populates the Active Books list in the sidebar.
 */
export function populateActiveBooks() {
    const listEl = document.querySelector(`.${WL_PREFIX}-active-books-list`);
    if (!listEl) return;

    const stSelect = document.querySelector('#world_info');
    if (!stSelect) {
        listEl.innerHTML = `<div class="${WL_PREFIX}-placeholder-text">—</div>`;
        return;
    }

    const selectedOptions = Array.from(stSelect.selectedOptions);
    const activeNames = selectedOptions
        .map(opt => opt.textContent.trim())
        .filter(name => name && !name.startsWith('--'));

    if (activeNames.length === 0) {
        listEl.innerHTML = `<div class="${WL_PREFIX}-placeholder-text">No books active</div>`;
        return;
    }

    listEl.innerHTML = activeNames.map(name => `
        <div class="${WL_PREFIX}-active-book-item" title="${escapeAttr(name)}">
            <span class="${WL_PREFIX}-active-book-name">${escapeHtml(name)}</span>
            <button class="${WL_PREFIX}-active-book-detach" data-book="${escapeAttr(name)}" title="Detach">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `).join('');

    // Wire detach buttons
    listEl.querySelectorAll(`.${WL_PREFIX}-active-book-detach`).forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            detachActiveBook(btn.dataset.book);
        });
    });
}

/**
 * Syncs global WI settings from ST's controls into our sidebar fields.
 */
export function syncGlobalSettings() {
    // Number inputs
    setFieldFromST('scanDepth', '#world_info_depth');
    setFieldFromST('budget', '#world_info_budget');
    setFieldFromST('budgetCap', '#world_info_budget_cap');
    setFieldFromST('minActivations', '#world_info_min_activations');
    setFieldFromST('minActivationsDepthMax', '#world_info_min_activations_depth_max');
    setFieldFromST('maxRecursionSteps', '#world_info_max_recursion_steps');

    // Select (insertion strategy)
    setSelectFromST('characterStrategy', '#world_info_character_strategy');

    // Checkboxes
    setCheckboxFromST('includeNames', '#world_info_include_names');
    setCheckboxFromST('recursive', '#world_info_recursive');
    setCheckboxFromST('caseSensitive', '#world_info_case_sensitive');
    setCheckboxFromST('matchWholeWords', '#world_info_match_whole_words');
    setCheckboxFromST('useGroupScoring', '#world_info_use_group_scoring');
    setCheckboxFromST('overflowAlert', '#world_info_overflow_alert');
}

/**
 * Wire bidirectional sync — our sidebar fields push changes back to ST's controls.
 * Called once after sidebar DOM is built.
 */
export function wireGlobalSettingsSync() {
    const sidebar = document.getElementById('wl-wid-sidebar');
    if (!sidebar || sidebar.dataset.globalWired) return;
    sidebar.dataset.globalWired = 'true';

    // Number inputs → push to ST range inputs
    const numberMap = {
        scanDepth: '#world_info_depth',
        budget: '#world_info_budget',
        budgetCap: '#world_info_budget_cap',
        minActivations: '#world_info_min_activations',
        minActivationsDepthMax: '#world_info_min_activations_depth_max',
        maxRecursionSteps: '#world_info_max_recursion_steps',
    };

    for (const [settingKey, stSelector] of Object.entries(numberMap)) {
        const ourEl = sidebar.querySelector(`.wl-wid-input-sm[data-setting="${settingKey}"]`);
        if (!ourEl) continue;
        ourEl.addEventListener('input', () => {
            const stEl = document.querySelector(stSelector);
            if (stEl) {
                stEl.value = ourEl.value;
                if (typeof $ !== 'undefined') $(stEl).trigger('input').trigger('change');
                else stEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
            // Also sync the _counter sibling if it exists
            const counter = document.querySelector(`${stSelector}_counter`);
            if (counter) counter.value = ourEl.value;
        });
    }

    // Select → push to ST select
    const stratSelect = sidebar.querySelector(`.wl-wid-select-sm[data-setting="characterStrategy"]`);
    if (stratSelect) {
        stratSelect.addEventListener('change', () => {
            const stEl = document.querySelector('#world_info_character_strategy');
            if (stEl) {
                stEl.value = stratSelect.value;
                if (typeof $ !== 'undefined') $(stEl).trigger('change');
                else stEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }

    // Checkboxes → push to ST checkboxes
    const checkMap = {
        includeNames: '#world_info_include_names',
        recursive: '#world_info_recursive',
        caseSensitive: '#world_info_case_sensitive',
        matchWholeWords: '#world_info_match_whole_words',
        useGroupScoring: '#world_info_use_group_scoring',
        overflowAlert: '#world_info_overflow_alert',
    };

    for (const [settingKey, stSelector] of Object.entries(checkMap)) {
        const ourEl = sidebar.querySelector(`.wl-wid-checkbox[data-setting="${settingKey}"]`);
        if (!ourEl) continue;
        ourEl.addEventListener('change', () => {
            const stEl = document.querySelector(stSelector);
            if (stEl) {
                stEl.checked = ourEl.checked;
                if (typeof $ !== 'undefined') $(stEl).trigger('change');
                else stEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }
}

// ============================================================
// Detach Active Book
// ============================================================

function detachActiveBook(bookName) {
    const stSelect = document.querySelector('#world_info');
    if (!stSelect) return;

    const option = Array.from(stSelect.options).find(
        o => o.textContent.trim() === bookName && o.selected
    );
    if (option) {
        option.selected = false;
        if (typeof $ !== 'undefined') {
            $(stSelect).trigger('change');
        } else {
            stSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        log(`Detached book: ${bookName}`);
        populateActiveBooks();
    }
}

// ============================================================
// Book Selection & Entry Table
// ============================================================

async function selectBook(name) {
    try {
        const { loadWorldInfo } = await worldInfoPromise;
        const data = await loadWorldInfo(name);

        if (!data || !data.entries) {
            log(`Failed to load book: ${name}`);
            clearEntryTable();
            return;
        }

        currentBookName = name;
        currentBookData = data;
        expandedEntryUid = null;
        currentPage = 0;
        renderEntryTable(data);
        log(`Loaded "${name}" — ${Object.keys(data.entries).length} entries`);
    } catch (err) {
        log('Error loading book:', err);
    }
}

/**
 * Renders entries as table rows in the right column.
 * Paginates to PAGE_SIZE entries per page.
 */
function renderEntryTable(data) {
    const container = document.querySelector(`.${WL_PREFIX}-entry-rows`);
    if (!container) return;

    const entries = Object.values(data.entries);

    if (entries.length === 0) {
        container.innerHTML = `<div class="${WL_PREFIX}-placeholder-text">No entries in this book</div>`;
        updatePageInfo(0, 0, 0);
        return;
    }

    // Sort by order descending
    const sorted = [...entries].sort((a, b) => b.order - a.order);

    // Pagination
    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    currentPage = Math.min(currentPage, totalPages - 1);
    currentPage = Math.max(currentPage, 0);
    const startIdx = currentPage * PAGE_SIZE;
    const pageEntries = sorted.slice(startIdx, startIdx + PAGE_SIZE);

    container.innerHTML = pageEntries.map(entry => {
        const memo = entry.comment || '';
        const fallbackName = getFallbackName(entry);
        const stratIcon = buildStrategyIcon(entry);
        const posDisplay = buildPositionDisplay(entry);
        const roleDisplay = buildRoleIcon(entry);
        const order = entry.order ?? 0;
        const trigger = entry.probability ?? 100;
        const isExpanded = expandedEntryUid === String(entry.uid);

        let html = `
            <div class="${WL_PREFIX}-entry-row ${entry.disable ? WL_PREFIX + '-entry-disabled' : ''} ${isExpanded ? WL_PREFIX + '-entry-selected' : ''}"
                 data-uid="${entry.uid}">
                <button class="${WL_PREFIX}-entry-expand ${isExpanded ? WL_PREFIX + '-expanded' : ''}" title="Expand" data-uid="${entry.uid}">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
                <span class="${WL_PREFIX}-entry-toggle-cell">
                    <input type="checkbox" ${entry.disable ? '' : 'checked'} data-uid="${entry.uid}">
                </span>
                <span class="${WL_PREFIX}-td ${WL_PREFIX}-td-title">
                    <input type="text" class="${WL_PREFIX}-row-title-input"
                        data-field="comment"
                        value="${escapeAttr(memo)}"
                        placeholder="${escapeAttr(fallbackName)}"
                        title="${escapeAttr(memo || fallbackName)}">
                </span>
                <span class="${WL_PREFIX}-td ${WL_PREFIX}-td-position">${posDisplay}</span>
                <span class="${WL_PREFIX}-td ${WL_PREFIX}-td-role">${roleDisplay}</span>
                <span class="${WL_PREFIX}-td ${WL_PREFIX}-td-strategy">${stratIcon}</span>
                <span class="${WL_PREFIX}-td ${WL_PREFIX}-td-order">
                    <input type="number" class="${WL_PREFIX}-row-num"
                        data-field="order" value="${order}" min="0" title="Order">
                </span>
                <span class="${WL_PREFIX}-td ${WL_PREFIX}-td-trigger">
                    <input type="number" class="${WL_PREFIX}-row-num"
                        data-field="probability" value="${trigger}" min="0" max="100" title="Trigger %">
                </span>
                <span class="${WL_PREFIX}-td ${WL_PREFIX}-td-actions">
                    <button class="${WL_PREFIX}-row-action-btn" data-action="move-entry" data-uid="${entry.uid}" title="Move to another lorebook">
                        <i class="fa-solid fa-right-left"></i>
                    </button>
                    <button class="${WL_PREFIX}-row-action-btn" data-action="duplicate-entry" data-uid="${entry.uid}" title="Duplicate">
                        <i class="fa-solid fa-clone"></i>
                    </button>
                    <button class="${WL_PREFIX}-row-action-btn ${WL_PREFIX}-row-action-danger" data-action="delete-entry" data-uid="${entry.uid}" title="Delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </span>
            </div>`;

        // Inline detail panel when expanded
        if (isExpanded) {
            html += buildEntryDetail(entry);
        }

        return html;
    }).join('');

    wireEntryInteractions(container);
    updatePageInfo(sorted.length, currentPage, totalPages);
}

/**
 * Wire entry row + detail form interactions using EVENT DELEGATION
 * on the rows container. Single listener persists across re-renders.
 * Idempotent — guarded by data attribute.
 */
function wireEntryInteractions(container) {
    if (container.dataset.wlDelegated === 'true') return;
    container.dataset.wlDelegated = 'true';

    // ----- CLICK delegation -----
    container.addEventListener('click', (e) => {
        // Advanced collapsible toggle
        const advHeader = e.target.closest(`.${WL_PREFIX}-fld-adv-header`);
        if (advHeader) {
            const collapsed = advHeader.dataset.collapsed === 'true';
            advHeader.dataset.collapsed = collapsed ? 'false' : 'true';
            const body = advHeader.nextElementSibling;
            if (body) body.style.display = collapsed ? '' : 'none';
            const chev = advHeader.querySelector(`.${WL_PREFIX}-fld-adv-chev`);
            if (chev) chev.style.transform = collapsed ? 'rotate(90deg)' : '';
            return;
        }

        // Entry action buttons (delete/duplicate/move)
        const actionBtn = e.target.closest(`button[data-action]`);
        if (actionBtn) {
            const uid = parseInt(actionBtn.dataset.uid, 10);
            const action = actionBtn.dataset.action;
            if (action === 'delete-entry') deleteEntry(uid);
            else if (action === 'duplicate-entry') duplicateEntry(uid);
            else if (action === 'move-entry') moveEntry(uid);
            return;
        }

        // Logic cycle badge — click to cycle through logic modes
        const logicBadge = e.target.closest(`.${WL_PREFIX}-logic-cycle`);
        if (logicBadge) {
            const detail = logicBadge.closest(`.${WL_PREFIX}-entry-detail`);
            if (!detail) return;
            const uid = parseInt(detail.dataset.uid, 10);
            const cur = parseInt(logicBadge.dataset.logic, 10);
            const next = LOGIC_CYCLE[cur] ?? 0;
            logicBadge.dataset.logic = next;
            logicBadge.textContent = LOGIC_LABELS[next] || 'AND ANY';
            applyFieldChange(uid, 'selectiveLogic', { value: String(next), tagName: 'SELECT' });
            return;
        }

        // Clicks inside detail panel — let them through (form interactions)
        if (e.target.closest(`.${WL_PREFIX}-entry-detail`)) return;

        // Checkbox toggle is handled by change event
        if (e.target.closest(`.${WL_PREFIX}-entry-toggle-cell`)) return;

        // Strategy icon — cycle keyword → constant → vectorized on click
        const stratIcon = e.target.closest(`.${WL_PREFIX}-strat-icon`);
        if (stratIcon) {
            const row = stratIcon.closest(`.${WL_PREFIX}-entry-row`);
            if (!row) return;
            const uid = parseInt(row.dataset.uid, 10);
            const cur = stratIcon.dataset.strategy;
            const next = cur === 'keyword' ? 'constant' : cur === 'constant' ? 'vectorized' : 'keyword';
            // Apply via the virtual strategy field handler
            applyFieldChange(uid, 'strategy', { value: next, tagName: 'SELECT' });
            return;
        }

        // Inline-editable row controls — let them work, don't expand
        if (e.target.matches('input, select, textarea')) return;

        // Row body or chevron → toggle expand
        const row = e.target.closest(`.${WL_PREFIX}-entry-row`);
        if (!row) return;
        toggleExpandEntry(row.dataset.uid);
    });

    // ----- CHANGE delegation (checkboxes, selects, blurred text inputs) -----
    container.addEventListener('change', (e) => {
        // Row disable checkbox
        const rowCb = e.target.closest(`.${WL_PREFIX}-entry-toggle-cell input`);
        if (rowCb) {
            const uid = parseInt(rowCb.dataset.uid, 10);
            toggleEntryDisable(uid, !rowCb.checked);
            return;
        }

        // Detail OR inline-row form field
        const field = e.target.dataset?.field;
        if (!field) return;

        // Detail panel first (uid on the wrapper)
        const detail = e.target.closest(`.${WL_PREFIX}-entry-detail`);
        if (detail) {
            const uid = parseInt(detail.dataset.uid, 10);
            applyFieldChange(uid, field, e.target);
            return;
        }

        // Inline row control (uid on the row)
        const row = e.target.closest(`.${WL_PREFIX}-entry-row`);
        if (row) {
            const uid = parseInt(row.dataset.uid, 10);
            applyFieldChange(uid, field, e.target);
        }
    });

    // ----- INPUT delegation (debounced live updates for text/number/textarea) -----
    container.addEventListener('input', (e) => {
        const t = e.target;
        if (!t.dataset?.field) return;
        // Skip checkboxes/radios — handled by 'change'
        if (t.type === 'checkbox' || t.type === 'radio') return;
        // Skip <select> — handled by 'change'
        if (t.tagName === 'SELECT') return;

        // Detail panel first
        const detail = t.closest(`.${WL_PREFIX}-entry-detail`);
        if (detail) {
            const uid = parseInt(detail.dataset.uid, 10);
            applyFieldChange(uid, t.dataset.field, t);
            return;
        }

        // Inline row control
        const row = t.closest(`.${WL_PREFIX}-entry-row`);
        if (row) {
            const uid = parseInt(row.dataset.uid, 10);
            applyFieldChange(uid, t.dataset.field, t);
        }
    });
}

function toggleExpandEntry(uid) {
    const uidStr = String(uid);
    const container = document.querySelector(`.${WL_PREFIX}-entry-rows`);
    if (!container || !currentBookData) return;

    // --- Collapse previously expanded entry (if any) ---
    if (expandedEntryUid) {
        const prevRow = container.querySelector(`.${WL_PREFIX}-entry-row[data-uid="${expandedEntryUid}"]`);
        const prevDetail = container.querySelector(`.${WL_PREFIX}-entry-detail[data-uid="${expandedEntryUid}"]`);
        if (prevRow) {
            prevRow.classList.remove(`${WL_PREFIX}-entry-selected`);
            const prevChev = prevRow.querySelector(`.${WL_PREFIX}-entry-expand`);
            if (prevChev) prevChev.classList.remove(`${WL_PREFIX}-expanded`);
        }
        if (prevDetail) prevDetail.remove();
    }

    // --- If toggling the same entry off, we're done ---
    if (expandedEntryUid === uidStr) {
        expandedEntryUid = null;
        return;
    }

    // --- Expand the new entry ---
    expandedEntryUid = uidStr;
    const entry = currentBookData.entries[uid];
    if (!entry) return;

    const row = container.querySelector(`.${WL_PREFIX}-entry-row[data-uid="${uidStr}"]`);
    if (!row) return;

    row.classList.add(`${WL_PREFIX}-entry-selected`);
    const chev = row.querySelector(`.${WL_PREFIX}-entry-expand`);
    if (chev) chev.classList.add(`${WL_PREFIX}-expanded`);

    // Insert detail panel after the row
    const detailHTML = buildEntryDetail(entry);
    row.insertAdjacentHTML('afterend', detailHTML);
}

/**
 * Build inline detail HTML for an expanded entry.
 * Compact layout — fields handled in the row header are NOT duplicated here.
 * Position, order, trigger%, strategy are row-only. Depth shown only when position=@ Depth.
 */
function buildEntryDetail(entry) {
    const keys = (Array.isArray(entry.key) ? entry.key : []).join(', ');
    const secKeys = (Array.isArray(entry.keysecondary) ? entry.keysecondary : []).join(', ');
    const content = entry.content || '';
    const charTokens = Math.ceil(content.length / 4);
    const charFilter = entry.characterFilter || {};
    const charFilterNames = (Array.isArray(charFilter.names) ? charFilter.names : []).join(', ');
    const isExclude = !!charFilter.isExclude;
    const logic = entry.selectiveLogic ?? 0;

    return `
        <div class="${WL_PREFIX}-entry-detail" data-uid="${entry.uid}">
            <div class="${WL_PREFIX}-fld-keyrow">
                <div class="${WL_PREFIX}-fld-col ${WL_PREFIX}-fld-grow">
                    <label class="${WL_PREFIX}-fld-label">Primary Keys</label>
                    <input type="text" class="${WL_PREFIX}-fld-input" placeholder="key1, key2, ..." data-field="key" value="${escapeAttr(keys)}">
                </div>
                <span class="${WL_PREFIX}-logic-cycle" data-logic="${logic}" title="Click to cycle: AND ANY → AND ALL → NOT ALL → NOT ANY">${LOGIC_LABELS[logic] || 'AND ANY'}</span>
                <div class="${WL_PREFIX}-fld-col ${WL_PREFIX}-fld-grow">
                    <label class="${WL_PREFIX}-fld-label">Secondary Keys</label>
                    <input type="text" class="${WL_PREFIX}-fld-input" placeholder="key1, key2, ..." data-field="keysecondary" value="${escapeAttr(secKeys)}">
                </div>
            </div>

            <div class="${WL_PREFIX}-fld-row">
                <label class="${WL_PREFIX}-fld-label">Content <span class="${WL_PREFIX}-fld-tokens">~${charTokens} tok</span></label>
                <textarea class="${WL_PREFIX}-fld-textarea" rows="10" data-field="content" placeholder="Entry content...">${escapeHtml(content)}</textarea>
            </div>

            <div class="${WL_PREFIX}-fld-inline">
                <div class="${WL_PREFIX}-fld-col" style="width:60px">
                    <label class="${WL_PREFIX}-fld-label" title="Stays active for N messages">Sticky</label>
                    <input type="number" class="${WL_PREFIX}-fld-input ${WL_PREFIX}-fld-num" data-field="sticky" data-nullable="true" placeholder="—" value="${entry.sticky ?? ''}" min="0">
                </div>
                <div class="${WL_PREFIX}-fld-col" style="width:60px">
                    <label class="${WL_PREFIX}-fld-label" title="Cooldown after activation">Cool</label>
                    <input type="number" class="${WL_PREFIX}-fld-input ${WL_PREFIX}-fld-num" data-field="cooldown" data-nullable="true" placeholder="—" value="${entry.cooldown ?? ''}" min="0">
                </div>
                <div class="${WL_PREFIX}-fld-col" style="width:60px">
                    <label class="${WL_PREFIX}-fld-label" title="Delay before eligible">Delay</label>
                    <input type="number" class="${WL_PREFIX}-fld-input ${WL_PREFIX}-fld-num" data-field="delay" data-nullable="true" placeholder="—" value="${entry.delay ?? ''}" min="0">
                </div>
                <div class="${WL_PREFIX}-fld-col ${WL_PREFIX}-fld-grow" style="min-width:80px">
                    <label class="${WL_PREFIX}-fld-label">Inclusion Group</label>
                    <input type="text" class="${WL_PREFIX}-fld-input" placeholder="group name" data-field="group" value="${escapeAttr(entry.group || '')}">
                </div>
                <div class="${WL_PREFIX}-fld-col" style="width:60px">
                    <label class="${WL_PREFIX}-fld-label">Weight</label>
                    <input type="number" class="${WL_PREFIX}-fld-input ${WL_PREFIX}-fld-num" data-field="groupWeight" value="${entry.groupWeight ?? 100}" min="0">
                </div>
                <label class="${WL_PREFIX}-fld-check">
                    <input type="checkbox" data-field="groupOverride" ${entry.groupOverride ? 'checked' : ''}>
                    <span>Priority</span>
                </label>
            </div>

            <div class="${WL_PREFIX}-fld-inline">
                <div class="${WL_PREFIX}-fld-col" style="flex:1 1 0;min-width:100px">
                    <label class="${WL_PREFIX}-fld-label">Automation ID</label>
                    <input type="text" class="${WL_PREFIX}-fld-input" placeholder="optional" data-field="automationId" value="${escapeAttr(entry.automationId || '')}">
                </div>
                <div class="${WL_PREFIX}-fld-col" style="flex:2 1 0;min-width:120px">
                    <label class="${WL_PREFIX}-fld-label">Character Filter</label>
                    <input type="text" class="${WL_PREFIX}-fld-input" placeholder="char1, char2, ..." data-field="characterFilterNames" value="${escapeAttr(charFilterNames)}">
                </div>
                <label class="${WL_PREFIX}-fld-check">
                    <input type="checkbox" data-field="characterFilterExclude" ${isExclude ? 'checked' : ''}>
                    <span>Exclude</span>
                </label>
            </div>

            <div class="${WL_PREFIX}-fld-advanced">
                <div class="${WL_PREFIX}-fld-adv-header" data-collapsed="true">
                    <i class="fa-solid fa-chevron-right ${WL_PREFIX}-fld-adv-chev"></i>
                    <span>Advanced</span>
                </div>
                <div class="${WL_PREFIX}-fld-adv-body" style="display:none">
                    <div class="${WL_PREFIX}-fld-section-label">Scan Overrides</div>
                    <div class="${WL_PREFIX}-fld-inline">
                        <div class="${WL_PREFIX}-fld-col" style="width:70px">
                            <label class="${WL_PREFIX}-fld-label">Scan Depth</label>
                            <input type="number" class="${WL_PREFIX}-fld-input ${WL_PREFIX}-fld-num" data-field="scanDepth" data-nullable="true" placeholder="global" value="${entry.scanDepth ?? ''}" min="0">
                        </div>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="caseSensitive" data-nullable="true" ${entry.caseSensitive === true ? 'checked' : ''}><span>Case</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="matchWholeWords" data-nullable="true" ${entry.matchWholeWords === true ? 'checked' : ''}><span>Whole</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="useGroupScoring" data-nullable="true" ${entry.useGroupScoring === true ? 'checked' : ''}><span>GrpScore</span></label>
                    </div>

                    <div class="${WL_PREFIX}-fld-section-label">Recursion</div>
                    <div class="${WL_PREFIX}-fld-inline">
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="excludeRecursion" ${entry.excludeRecursion ? 'checked' : ''}><span>Non-recursable</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="preventRecursion" ${entry.preventRecursion ? 'checked' : ''}><span>Prevent further</span></label>
                        <div class="${WL_PREFIX}-fld-col" style="width:70px">
                            <label class="${WL_PREFIX}-fld-label" style="white-space:nowrap">Delay until rec.</label>
                            <input type="number" class="${WL_PREFIX}-fld-input ${WL_PREFIX}-fld-num" data-field="delayUntilRecursion" value="${entry.delayUntilRecursion ?? 0}" min="0">
                        </div>
                    </div>

                    <div class="${WL_PREFIX}-fld-section-label">Match Additional Sources</div>
                    <div class="${WL_PREFIX}-fld-checkgrid">
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="matchPersonaDescription" ${entry.matchPersonaDescription ? 'checked' : ''}><span>Persona Desc</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="matchCharacterDescription" ${entry.matchCharacterDescription ? 'checked' : ''}><span>Char Desc</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="matchCharacterPersonality" ${entry.matchCharacterPersonality ? 'checked' : ''}><span>Personality</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="matchCharacterDepthPrompt" ${entry.matchCharacterDepthPrompt ? 'checked' : ''}><span>Depth Prompt</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="matchScenario" ${entry.matchScenario ? 'checked' : ''}><span>Scenario</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="matchCreatorNotes" ${entry.matchCreatorNotes ? 'checked' : ''}><span>Creator Notes</span></label>
                    </div>

                    <div class="${WL_PREFIX}-fld-section-label">Misc</div>
                    <div class="${WL_PREFIX}-fld-inline">
                        <div class="${WL_PREFIX}-fld-col" style="flex:0 1 160px;min-width:80px">
                            <label class="${WL_PREFIX}-fld-label">Outlet Name</label>
                            <input type="text" class="${WL_PREFIX}-fld-input" placeholder="outlet name" data-field="outletName" value="${escapeAttr(entry.outletName || '')}">
                        </div>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="ignoreBudget" ${entry.ignoreBudget ? 'checked' : ''}><span>Ignore Budget</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="useProbability" ${entry.useProbability !== false ? 'checked' : ''}><span>Use Prob</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="addMemo" ${entry.addMemo ? 'checked' : ''}><span>Show Memo</span></label>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Strategy & Position — Inline editable controls
// ============================================================

/**
 * Strategy icon — FA icon, click-to-cycle (keyword → constant → vectorized).
 * No native <select> — just 3 states cycled on click.
 */
function buildStrategyIcon(entry) {
    let current, icon, color, title;
    if (entry.disable) {
        current = 'keyword'; icon = 'fa-circle'; color = STRATEGY_COLORS.disabled; title = 'Disabled';
    } else if (entry.constant) {
        current = 'constant'; icon = 'fa-circle'; color = STRATEGY_COLORS.constant; title = 'Constant';
    } else if (entry.vectorized) {
        current = 'vectorized'; icon = 'fa-link'; color = STRATEGY_COLORS.vectorized; title = 'Vectorized';
    } else {
        current = 'keyword'; icon = 'fa-circle'; color = STRATEGY_COLORS.keyword; title = 'Keyword';
    }
    return `<span class="${WL_PREFIX}-strat-icon" data-strategy="${current}" title="${title}">
        <i class="fa-solid ${icon}" style="color:${color}"></i>
    </span>`;
}

/** Position badge colors — muted, category-grouped */
const POS_COLORS = {
    0: '#7a9f6e', 1: '#7a9f6e', // Before/After Char = green
    2: '#9e9070', 3: '#9e9070', 7: '#9e9070', 8: '#9e9070', // AN area = warm
    4: '#6a8aa0', // At Depth = blue
    5: '#8a7a96', 6: '#8a7a96', // Example Messages = purple
    9: '#9a7a7a', // Custom = rose
};

/** FA icon combos for each position */
const POS_ICONS = {
    0: ['fa-arrow-up',    'fa-user'],        // Before Char
    1: ['fa-arrow-down',  'fa-user'],        // After Char
    2: ['fa-arrow-up',    'fa-pen-fancy'],   // Before AN
    3: ['fa-arrow-down',  'fa-pen-fancy'],   // After AN
    4: ['fa-layer-group'],                    // @ Depth
    5: ['fa-arrow-up',    'fa-comment'],     // Before EM
    6: ['fa-arrow-down',  'fa-comment'],     // After EM
    7: ['fa-angles-up',   'fa-pen-fancy'],   // Top AN
    8: ['fa-angles-down', 'fa-pen-fancy'],   // Bottom AN
    9: ['fa-bolt'],                           // Custom
};

const POSITION_OPTIONS = [
    [0, 'BC', 'Before Char'],
    [1, 'AC', 'After Char'],
    [5, 'BE', 'Before EM'],
    [6, 'AE', 'After EM'],
    [2, 'BA', 'Before AN'],
    [3, 'AA', 'After AN'],
    [7, 'TA', 'Top AN'],
    [8, 'bA', 'Bottom AN'],
    [4, '⇣',  '@ Depth'],
    [9, '⚡',  'Custom'],
];

/**
 * Position display — FA icon combo with invisible overlay <select>.
 * When position = @ Depth (4), also shows the depth number inline.
 */
function buildPositionDisplay(entry) {
    const pos = entry.position ?? 0;
    const color = POS_COLORS[pos] || '#666';
    const icons = POS_ICONS[pos] || ['fa-question'];
    const iconHtml = icons.map(ic => `<i class="fa-solid ${ic}"></i>`).join('');
    const depthLabel = pos === 4 ? `<span class="${WL_PREFIX}-pos-depth-num">${entry.depth ?? 4}</span>` : '';
    const opts = POSITION_OPTIONS.map(([v, short, long]) =>
        `<option value="${v}" ${pos === v ? 'selected' : ''}>${short} — ${long}</option>`
    ).join('');
    return `<span class="${WL_PREFIX}-pos-wrap" style="color:${color}" title="${getPositionLabel(pos)}${pos === 4 ? ' (depth ' + (entry.depth ?? 4) + ')' : ''}">
        <span class="${WL_PREFIX}-pos-icons">${iconHtml}${depthLabel}</span>
        <select class="${WL_PREFIX}-pos-overlay" data-field="position">${opts}</select>
    </span>`;
}

/** Role icons — FA icon with invisible overlay select. */
const ROLE_ICONS = { 0: 'fa-gear', 1: 'fa-user', 2: 'fa-robot' };
const ROLE_LABELS = { 0: 'System', 1: 'User', 2: 'Assistant' };

/** Logic display labels + cycle order: 0 → 3 → 1 → 2 → 0 */
const LOGIC_LABELS = { 0: 'AND ANY', 3: 'AND ALL', 1: 'NOT ALL', 2: 'NOT ANY' };
const LOGIC_CYCLE = { 0: 3, 3: 1, 1: 2, 2: 0 };

function buildRoleIcon(entry) {
    // Role only meaningful when injected at depth — hide for all other positions
    if ((entry.position ?? 0) !== 4) return '';
    const role = entry.role ?? 0;
    const icon = ROLE_ICONS[role] || 'fa-gear';
    const label = ROLE_LABELS[role] || 'System';
    return `<span class="${WL_PREFIX}-role-wrap" title="${label}">
        <i class="fa-solid ${icon}"></i>
        <select class="${WL_PREFIX}-role-overlay" data-field="role">
            <option value="0" ${role === 0 ? 'selected' : ''}>System</option>
            <option value="1" ${role === 1 ? 'selected' : ''}>User</option>
            <option value="2" ${role === 2 ? 'selected' : ''}>Assistant</option>
        </select>
    </span>`;
}

function getPositionShort(pos) {
    const shorts = {
        0: 'BC', 1: 'AC', 2: 'BA', 3: 'AA',
        4: '⇣', 5: 'BE', 6: 'AE', 7: 'TA',
        8: 'bA', 9: '⚡',
    };
    return shorts[pos] || `${pos}`;
}

// ============================================================
// Entry Toggle
// ============================================================

async function toggleEntryDisable(uid, disabled) {
    if (!currentBookData?.entries[uid]) return;
    currentBookData.entries[uid].disable = disabled;
    try {
        const { saveWorldInfo } = await worldInfoPromise;
        await saveWorldInfo(currentBookName, currentBookData);
        renderEntryTable(currentBookData);
        log(`Entry ${uid} ${disabled ? 'disabled' : 'enabled'}`);
    } catch (err) {
        log('Error saving toggle:', err);
    }
}

// ============================================================
// Save Plumbing (debounced + immediate)
// ============================================================

let saveTimer = null;
const SAVE_DEBOUNCE_MS = 400;

/** Schedule a debounced save — for live text/number input. */
function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        commitSave();
    }, SAVE_DEBOUNCE_MS);
}

/** Save the current book to disk immediately. */
async function commitSave() {
    if (!currentBookName || !currentBookData) return;
    try {
        const { saveWorldInfo } = await worldInfoPromise;
        await saveWorldInfo(currentBookName, currentBookData);
    } catch (err) {
        log('Save failed:', err);
    }
}

// ============================================================
// Apply Field Change — central writeback dispatcher
// ============================================================

/** Fields whose change should trigger a row re-render (visible in row). */
const ROW_AFFECTING_FIELDS = new Set([
    'constant', 'vectorized', 'position', 'strategy', 'role', 'depth',
    // Re-render the row to show new badge color / dot.
    // We deliberately don't include text fields here — typing should not re-render.
]);

/**
 * Apply a form input change to currentBookData and schedule a save.
 * @param {number} uid - Entry UID
 * @param {string} field - Field name (from data-field)
 * @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} input
 */
function applyFieldChange(uid, field, input) {
    if (!currentBookData?.entries[uid]) return;
    const entry = currentBookData.entries[uid];
    const isNullable = input.dataset?.nullable === 'true';

    // --- Virtual field: strategy (maps to constant + vectorized booleans) ---
    if (field === 'strategy') {
        const val = input.value;
        entry.constant = (val === 'constant');
        entry.vectorized = (val === 'vectorized');
        // 'keyword' = both false (the default keyword-triggered strategy)
        commitSave();
        renderEntryTable(currentBookData);
        return;
    }

    // --- Special-cased: characterFilter is a nested object ---
    if (field === 'characterFilterNames') {
        if (!entry.characterFilter) entry.characterFilter = { names: [], tags: [], isExclude: false };
        entry.characterFilter.names = input.value.split(',').map(s => s.trim()).filter(Boolean);
        scheduleSave();
        return;
    }
    if (field === 'characterFilterExclude') {
        if (!entry.characterFilter) entry.characterFilter = { names: [], tags: [], isExclude: false };
        entry.characterFilter.isExclude = !!input.checked;
        scheduleSave();
        return;
    }

    // --- Array fields (keys) — comma-separated input ---
    if (field === 'key' || field === 'keysecondary') {
        entry[field] = input.value.split(',').map(s => s.trim()).filter(Boolean);
        scheduleSave();
        return;
    }

    // --- Standard field by input type ---
    let value;
    if (input.type === 'checkbox') {
        // Nullable booleans (caseSensitive, matchWholeWords, useGroupScoring):
        //   checked = true, unchecked = null (= "inherit/global default")
        value = input.checked;
        if (isNullable && !input.checked) value = null;
    } else if (input.type === 'number') {
        if (input.value === '' && isNullable) {
            value = null;
        } else if (input.value === '') {
            // Empty non-nullable number — preserve previous value, do nothing
            return;
        } else {
            const parsed = parseFloat(input.value);
            value = Number.isFinite(parsed) ? parsed : (entry[field] ?? 0);
        }
    } else if (input.tagName === 'SELECT') {
        // Numeric enums
        const numericEnums = new Set(['position', 'role', 'selectiveLogic']);
        value = numericEnums.has(field) ? parseInt(input.value, 10) : input.value;
    } else {
        // text / textarea
        value = input.value;
    }

    entry[field] = value;

    // Strategy / position changes update the row visible state — re-render
    if (ROW_AFFECTING_FIELDS.has(field)) {
        commitSave();
        renderEntryTable(currentBookData);
    } else {
        scheduleSave();
    }
}

// ============================================================
// Entry Actions: Delete / Duplicate / Move
// ============================================================

async function deleteEntry(uid) {
    if (!currentBookData?.entries[uid]) return;
    const entry = currentBookData.entries[uid];
    const name = getEntryDisplayName(entry);

    // Use ST's themed popup for confirmation (falls back to native confirm)
    try {
        const { callGenericPopup, POPUP_TYPE } = await import('../../../../../../scripts/popup.js');
        const result = await callGenericPopup(`Delete entry "${name}"?\n\nThis cannot be undone.`, POPUP_TYPE.CONFIRM);
        if (!result) return;
    } catch {
        if (!confirm(`Delete entry "${name}"?\n\nThis cannot be undone.`)) return;
    }

    delete currentBookData.entries[uid];
    if (expandedEntryUid === String(uid)) expandedEntryUid = null;
    await commitSave();
    renderEntryTable(currentBookData);
    log(`Deleted entry ${uid}`);
}

async function duplicateEntry(uid) {
    if (!currentBookData?.entries[uid]) return;
    try {
        const { createWorldInfoEntry } = await worldInfoPromise;
        const source = currentBookData.entries[uid];
        const newEntry = createWorldInfoEntry(currentBookName, currentBookData);
        if (!newEntry) {
            log('Failed to create new entry (no free UID?)');
            return;
        }
        // Deep-copy source fields onto the new entry, preserving its new UID
        const newUid = newEntry.uid;
        for (const k of Object.keys(source)) {
            if (k === 'uid') continue;
            const v = source[k];
            newEntry[k] = (v !== null && typeof v === 'object')
                ? JSON.parse(JSON.stringify(v))
                : v;
        }
        newEntry.uid = newUid;
        await commitSave();
        expandedEntryUid = String(newUid);
        renderEntryTable(currentBookData);
        log(`Duplicated entry ${uid} → ${newUid}`);
    } catch (err) {
        log('Duplicate failed:', err);
    }
}

/**
 * Move or copy an entry to another lorebook.
 * Shows an inline overlay with a lorebook picker and Move / Copy buttons.
 */
async function moveEntry(uid) {
    if (!currentBookData?.entries[uid] || !currentBookName) return;
    const entry = currentBookData.entries[uid];
    const entryName = getEntryDisplayName(entry);

    try {
        const { world_names, moveWorldInfoEntry, loadWorldInfo } = await worldInfoPromise;
        if (!world_names || !Array.isArray(world_names)) return;

        const otherBooks = world_names.filter(n => n !== currentBookName).sort((a, b) => a.localeCompare(b));
        if (otherBooks.length === 0) {
            toastr.warning('No other lorebooks available to move to.');
            return;
        }

        // Build a simple overlay
        const overlay = document.createElement('div');
        overlay.className = `${WL_PREFIX}-move-overlay`;
        overlay.innerHTML = `
            <div class="${WL_PREFIX}-move-dialog">
                <div class="${WL_PREFIX}-move-title">Move/Copy "${escapeHtml(entryName)}"</div>
                <select class="${WL_PREFIX}-move-select">
                    <option value="">— Select target lorebook —</option>
                    ${otherBooks.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('')}
                </select>
                <div class="${WL_PREFIX}-move-buttons">
                    <button class="${WL_PREFIX}-move-btn" data-mode="move">Move</button>
                    <button class="${WL_PREFIX}-move-btn" data-mode="copy">Copy</button>
                    <button class="${WL_PREFIX}-move-btn ${WL_PREFIX}-move-btn-cancel" data-mode="cancel">Cancel</button>
                </div>
            </div>`;

        // Attach to entry column so it's positioned within our drawer
        const entryCol = document.querySelector(`.${WL_PREFIX}-entry-col`);
        if (!entryCol) return;
        entryCol.appendChild(overlay);

        // Handle clicks
        const result = await new Promise(resolve => {
            overlay.addEventListener('click', (e) => {
                const btn = e.target.closest(`.${WL_PREFIX}-move-btn`);
                if (btn) {
                    resolve(btn.dataset.mode);
                    return;
                }
                // Click on backdrop = cancel
                if (e.target === overlay) resolve('cancel');
            });
        });

        const targetName = overlay.querySelector(`.${WL_PREFIX}-move-select`).value;
        overlay.remove();

        if (result === 'cancel' || !targetName) {
            if (result !== 'cancel' && !targetName) toastr.warning('Please select a target lorebook.');
            return;
        }

        const deleteOriginal = result === 'move';
        const success = await moveWorldInfoEntry(currentBookName, targetName, uid, { deleteOriginal });

        if (success) {
            toastr.success(`Entry ${deleteOriginal ? 'moved' : 'copied'} to "${targetName}"`);
            if (deleteOriginal) {
                // Refresh source book
                if (expandedEntryUid === String(uid)) expandedEntryUid = null;
                const data = await loadWorldInfo(currentBookName);
                if (data) {
                    currentBookData = data;
                    renderEntryTable(data);
                }
            }
            log(`${deleteOriginal ? 'Moved' : 'Copied'} entry ${uid} → "${targetName}"`);
        }
    } catch (err) {
        log('Move failed:', err);
    }
}

function clearEntryTable() {
    const container = document.querySelector(`.${WL_PREFIX}-entry-rows`);
    if (container) {
        container.innerHTML = `<div class="${WL_PREFIX}-placeholder-text">Select a book to view entries</div>`;
    }
    updatePageInfo(0, 0, 0);
}

// ============================================================
// Pagination
// ============================================================

/**
 * Update the page info display in the toolbar.
 */
function updatePageInfo(totalEntries, page, totalPages) {
    // Find or create the page info span in the toolbar
    let infoEl = document.querySelector(`.${WL_PREFIX}-page-info`);
    if (!infoEl) {
        // Insert between the spacer and prev button
        const spacer = document.querySelector(`.${WL_PREFIX}-toolbar-spacer`);
        if (spacer) {
            infoEl = document.createElement('span');
            infoEl.className = `${WL_PREFIX}-page-info`;
            spacer.after(infoEl);
        }
    }
    if (infoEl) {
        if (totalEntries === 0) {
            infoEl.textContent = '';
        } else if (totalPages <= 1) {
            infoEl.textContent = `${totalEntries}`;
        } else {
            infoEl.textContent = `${page + 1}/${totalPages} (${totalEntries})`;
        }
    }
}

/**
 * Wire the entry toolbar AND the book toolbar.
 * Call once after drawer content is built.
 */
export function wireToolbarActions() {
    // ----- Entry toolbar (new entry / refresh / prev / next) -----
    const entryToolbar = document.querySelector(`.${WL_PREFIX}-entry-toolbar`);
    if (entryToolbar && !entryToolbar.dataset.wlWired) {
        entryToolbar.dataset.wlWired = 'true';
        entryToolbar.addEventListener('click', (e) => {
            const btn = e.target.closest(`.${WL_PREFIX}-tool-btn`);
            if (!btn) return;
            const action = btn.dataset.action;

            switch (action) {
                case 'new-entry':
                    handleNewEntry();
                    break;
                case 'refresh':
                    if (currentBookName) selectBook(currentBookName);
                    break;
                case 'fill-empty':
                    invokeSTBookAction('#world_backfill_memos');
                    if (currentBookName) setTimeout(() => selectBook(currentBookName), 500);
                    break;
                case 'apply-sorting':
                    invokeSTBookAction('#world_apply_current_sorting');
                    if (currentBookName) setTimeout(() => selectBook(currentBookName), 500);
                    break;
                case 'prev-page':
                    if (currentPage > 0) {
                        currentPage--;
                        if (currentBookData) renderEntryTable(currentBookData);
                    }
                    break;
                case 'next-page': {
                    if (!currentBookData) break;
                    const total = Object.keys(currentBookData.entries).length;
                    const maxPage = Math.ceil(total / PAGE_SIZE) - 1;
                    if (currentPage < maxPage) {
                        currentPage++;
                        renderEntryTable(currentBookData);
                    }
                    break;
                }
            }
        });
    }

    // ----- Book toolbar (create / open-ST / rename / import / export / duplicate / delete) -----
    const bookToolbar = document.querySelector(`.${WL_PREFIX}-book-toolbar`);
    if (bookToolbar && !bookToolbar.dataset.wlWired) {
        bookToolbar.dataset.wlWired = 'true';
        bookToolbar.addEventListener('click', (e) => {
            const btn = e.target.closest(`.${WL_PREFIX}-tool-btn`);
            if (!btn) return;
            const action = btn.dataset.action;

            switch (action) {
                case 'new-book':
                    handleNewBook();
                    break;
                case 'rename':
                    invokeSTBookAction('#world_popup_name_button');
                    break;
                case 'import-book':
                    clickSTButton('#world_import_button');
                    refreshBookListAfterAction(1000);
                    break;
                case 'export-book':
                    invokeSTBookAction('#world_popup_export');
                    break;
                case 'duplicate-book':
                    invokeSTBookAction('#world_duplicate');
                    refreshBookListAfterAction();
                    break;
                case 'delete-book':
                    invokeSTBookAction('#world_popup_delete');
                    // Clear local state immediately, refresh after ST processes
                    currentBookName = null;
                    currentBookData = null;
                    expandedEntryUid = null;
                    clearEntryTable();
                    refreshBookListAfterAction();
                    break;
                case 'open-st':
                    handleOpenInST();
                    break;
            }
        });
    }

    log('Toolbar actions wired');
}

/**
 * Set ST's #world_editor_select to a given book name and fire change.
 * Used to "select" the book in ST before invoking native actions.
 * @param {string} bookName
 * @returns {boolean} true if found and switched
 */
function setSTEditorTo(bookName) {
    if (!bookName) return false;
    const select = document.querySelector('#world_editor_select');
    if (!select) return false;
    const option = Array.from(select.options).find(o => o.textContent.trim() === bookName);
    if (!option) return false;
    select.value = option.value;
    if (typeof $ !== 'undefined') $(select).trigger('change');
    else select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

/** Click an ST native book action button (rename/duplicate/delete) after
 *  setting the editor to the current book. */
function invokeSTBookAction(stSelector) {
    if (!currentBookName) {
        log('No book selected — cannot invoke action');
        return;
    }
    if (!setSTEditorTo(currentBookName)) {
        log('Could not select current book in ST editor');
        return;
    }
    const btn = document.querySelector(stSelector);
    if (btn) btn.click();
    else log(`ST button ${stSelector} not found`);
}

/** Click an ST native button directly (no book pre-selection needed). */
function clickSTButton(stSelector) {
    const btn = document.querySelector(stSelector);
    if (btn) btn.click();
    else log(`ST button ${stSelector} not found`);
}

/** Re-populate the book list after a structural change (create/duplicate/delete).
 *  Runs after an initial delay, then does a follow-up pass to catch slow operations.
 *  @param {number} [delay=500] - Initial delay in ms before first refresh
 */
function refreshBookListAfterAction(delay = 500) {
    setTimeout(() => {
        populateBookList();
        populateActiveBooks();
        // Follow-up pass catches slow disk/network operations
        setTimeout(() => {
            populateBookList();
            populateActiveBooks();
        }, 600);
    }, delay);
}

/**
 * Create a new lorebook using ST's createNewWorldInfo API.
 * Shows ST's native input popup, creates the book, refreshes list, and selects it.
 */
async function handleNewBook() {
    try {
        const { callGenericPopup, POPUP_TYPE } = await import('../../../../../../scripts/popup.js');
        const name = await callGenericPopup('Enter a name for the new lorebook:', POPUP_TYPE.INPUT, '');
        if (!name || !String(name).trim()) return;

        const trimmed = String(name).trim();
        const { createNewWorldInfo } = await worldInfoPromise;
        const success = await createNewWorldInfo(trimmed, { interactive: true });
        if (success) {
            refreshBookListAfterAction();
            // Auto-select the newly created book in our UI
            setTimeout(() => selectBook(trimmed), 300);
            log(`Created new lorebook: "${trimmed}"`);
        }
    } catch (err) {
        log('Create lorebook failed:', err);
    }
}

/**
 * Open the currently selected book in ST's native World Info editor.
 * Calls restoreDrawer() to properly reset takeover state (so sidebar
 * re-appears on next drawer open), then selects the book in ST's editor.
 */
async function handleOpenInST() {
    try {
        const { restoreDrawer } = await import('./drawerUI.js');
        restoreDrawer();
    } catch (err) {
        log('restoreDrawer failed:', err);
    }

    // Pre-select the book in ST's editor dropdown (if one is selected)
    if (currentBookName) {
        setSTEditorTo(currentBookName);
    }
    log(`Opened ST native editor${currentBookName ? ` with "${currentBookName}"` : ''}`);
}

/**
 * Create a new entry in the current book and expand it for editing.
 * Replaces the previous "route to #world_popup_new" approach so the new
 * entry shows up in our UI (not ST's hidden popup).
 */
async function handleNewEntry() {
    if (!currentBookName || !currentBookData) {
        log('No book selected — cannot create entry');
        return;
    }
    try {
        const { createWorldInfoEntry } = await worldInfoPromise;
        const newEntry = createWorldInfoEntry(currentBookName, currentBookData);
        if (!newEntry) return;
        await commitSave();
        currentPage = 0;
        expandedEntryUid = String(newEntry.uid);
        renderEntryTable(currentBookData);
        log(`Created new entry ${newEntry.uid}`);
    } catch (err) {
        log('Create entry failed:', err);
    }
}

// ============================================================
// Helpers
// ============================================================

function getEntryDisplayName(entry) {
    if (entry.comment && entry.addMemo) return entry.comment;
    const keys = Array.isArray(entry.key) ? entry.key : [];
    return keys.length > 0 ? keys[0] : `Entry #${entry.uid}`;
}

/** Fallback label when the entry has no comment — used as placeholder for the
 *  inline title input so the row never looks empty. */
function getFallbackName(entry) {
    const keys = Array.isArray(entry.key) ? entry.key : [];
    return keys.length > 0 ? keys[0] : `Entry #${entry.uid}`;
}

function getPositionLabel(pos) {
    const labels = {
        0: 'Before Char', 1: 'After Char', 2: 'Before AN', 3: 'After AN',
        4: 'At Depth', 5: 'Before Examples', 6: 'After Examples', 7: 'Top AN',
        8: 'Bottom AN', 9: 'Custom Outlet',
    };
    return labels[pos] || `Position ${pos}`;
}

function setFieldFromST(settingKey, stSelector) {
    const stEl = document.querySelector(stSelector);
    const ourEl = document.querySelector(`.${WL_PREFIX}-input-sm[data-setting="${settingKey}"]`);
    if (stEl && ourEl) ourEl.value = stEl.value;
}

function setCheckboxFromST(settingKey, stSelector) {
    const stEl = document.querySelector(stSelector);
    const ourEl = document.querySelector(`.${WL_PREFIX}-checkbox[data-setting="${settingKey}"]`);
    if (stEl && ourEl) ourEl.checked = stEl.checked;
}

function setSelectFromST(settingKey, stSelector) {
    const stEl = document.querySelector(stSelector);
    const ourEl = document.querySelector(`.${WL_PREFIX}-select-sm[data-setting="${settingKey}"]`);
    if (stEl && ourEl) ourEl.value = stEl.value;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
