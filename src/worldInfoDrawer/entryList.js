// src/worldInfoDrawer/entryList.js
// Manages the book list column, active books sidebar, global settings sync,
// and entry table rendering for the World Info Drawer takeover.

import { WL_PREFIX, STRATEGY_COLORS } from './constants.js';

const log = () => {};

/** Cached world-info module — single dynamic import, resolved once. */
const worldInfoPromise = import('../../../../../../scripts/world-info.js');

/** Resolved refs for setWIOriginalDataValue + originalWIDataKeyMap (populated on first use). */
let _wiHelpers = null;
async function getWIHelpers() {
    if (!_wiHelpers) {
        const mod = await worldInfoPromise;
        _wiHelpers = {
            setOriginal: mod.setWIOriginalDataValue,
            keyMap: mod.originalWIDataKeyMap,
        };
    }
    return _wiHelpers;
}

/** Currently selected book name */
let currentBookName = null;
/** Currently loaded book data */
let currentBookData = null;
/** UID of the currently expanded entry (string, or null = none) */
let expandedEntryUid = null;
/** Pagination state */
let currentPage = 0;
const PAGE_SIZE = 50;

/** Sort mode — matches ST's sort order values. Default: Order ↘ (value=8) */
let currentSortMode = 8;

/** Search query — empty string = no filter */
let searchQuery = '';

/** Bulk selection — Set of UIDs (numbers) currently checked for bulk ops */
const selectedEntries = new Set();
/** Guard flag — prevents overlapping bulk operations */
let isBulkOperating = false;
/** Multi-select mode — when false, row checkboxes are hidden */
let multiSelectActive = false;

// ============================================================
// Public API
// ============================================================

export function getCurrentBook() { return { name: currentBookName, data: currentBookData }; }

/**
 * Flush any pending debounced save immediately.
 * Call before closing the drawer or switching to native view.
 */
export async function flushPendingSave() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    await commitSave();
}

/**
 * Reset multi-select state. Called when the drawer closes
 * so reopening starts with a clean slate.
 */
export function resetMultiSelect() {
    multiSelectActive = false;
    selectedEntries.clear();
}

/**
 * If a book was previously selected, re-render its entry table from cached data.
 * Called on drawer reopen so the user picks up where they left off.
 */
export function restoreSelectedBook() {
    if (currentBookName && currentBookData) {
        renderEntryTable(currentBookData);
    }
}

/** Watch ST's #world_editor_select for option changes (book create/delete/rename).
 *  Refreshes our book list + active list whenever ST mutates that select. */
let _editorSelectObserver = null;
export function watchSTBookChanges() {
    if (_editorSelectObserver) return; // already watching
    const editorSelect = document.querySelector('#world_editor_select');
    if (!editorSelect) return;
    _editorSelectObserver = new MutationObserver(() => {
        log('ST book list changed — refreshing');
        populateBookList();
        populateActiveBooks();
        // If our selected book was deleted, clear the entry table
        if (currentBookName) {
            const stillExists = Array.from(editorSelect.options).some(
                o => o.textContent.trim() === currentBookName
            );
            if (!stillExists) {
                currentBookName = null;
                currentBookData = null;
                expandedEntryUid = null;
                clearEntryTable();
            }
        }
    });
    _editorSelectObserver.observe(editorSelect, { childList: true });
    log('Watching ST #world_editor_select for changes');
}
export function unwatchSTBookChanges() {
    if (_editorSelectObserver) {
        _editorSelectObserver.disconnect();
        _editorSelectObserver = null;
    }
}

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
    // Set immediately so toolbar actions (delete/rename/etc.) always
    // target the book the user just clicked — even before data loads.
    currentBookName = name;

    // Proactively sync ST's editor dropdown NOW so that by the time
    // the user clicks delete/rename/export/etc., ST's internal state
    // already points at this book. Without this, invokeSTBookAction
    // would fire change + click back-to-back, and ST's async change
    // handler wouldn't finish before the action button read stale state.
    setSTEditorTo(name);

    try {
        const { loadWorldInfo } = await worldInfoPromise;
        const data = await loadWorldInfo(name);

        if (!data || !data.entries) {
            log(`Failed to load book: ${name}`);
            currentBookName = null;
            clearEntryTable();
            return;
        }

        currentBookData = data;
        expandedEntryUid = null;
        selectedEntries.clear();
        currentPage = 0;
        renderEntryTable(data);
        log(`Loaded "${name}" — ${Object.keys(data.entries).length} entries`);
    } catch (err) {
        log('Error loading book:', err);
    }
}

// ============================================================
// Sort & Search
// ============================================================

/**
 * Sort comparator based on currentSortMode.
 * Matches ST's world_info_sort_order values.
 */
function getSortedEntries(entries) {
    const arr = [...entries];
    switch (currentSortMode) {
        case 0: // Priority — complex multi-field sort matching ST's behavior
            return arr.sort((a, b) => {
                // Disabled entries go last
                if (a.disable !== b.disable) return a.disable ? 1 : -1;
                // Constant entries go first
                if (a.constant !== b.constant) return a.constant ? -1 : 1;
                // Then by order descending
                if ((b.order ?? 0) !== (a.order ?? 0)) return (b.order ?? 0) - (a.order ?? 0);
                // Then by position ascending
                if ((a.position ?? 0) !== (b.position ?? 0)) return (a.position ?? 0) - (b.position ?? 0);
                // Then by depth ascending
                if ((a.depth ?? 0) !== (b.depth ?? 0)) return (a.depth ?? 0) - (b.depth ?? 0);
                // Then by UID ascending
                return (a.uid ?? 0) - (b.uid ?? 0);
            });
        case 1: // Title A-Z
            return arr.sort((a, b) => (a.comment || '').localeCompare(b.comment || ''));
        case 2: // Title Z-A
            return arr.sort((a, b) => (b.comment || '').localeCompare(a.comment || ''));
        case 3: // Tokens ↗ (content length ascending)
            return arr.sort((a, b) => (a.content || '').length - (b.content || '').length);
        case 4: // Tokens ↘ (content length descending)
            return arr.sort((a, b) => (b.content || '').length - (a.content || '').length);
        case 5: // Depth ↗
            return arr.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
        case 6: // Depth ↘
            return arr.sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
        case 7: // Order ↗
            return arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        case 8: // Order ↘
            return arr.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
        case 9: // UID ↗
            return arr.sort((a, b) => (a.uid ?? 0) - (b.uid ?? 0));
        case 10: // UID ↘
            return arr.sort((a, b) => (b.uid ?? 0) - (a.uid ?? 0));
        case 11: // Trigger% ↗
            return arr.sort((a, b) => (a.probability ?? 100) - (b.probability ?? 100));
        case 12: // Trigger% ↘
            return arr.sort((a, b) => (b.probability ?? 100) - (a.probability ?? 100));
        default:
            return arr.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
    }
}

/**
 * Filter entries by search query. Matches against comment, keys, secondary keys, and content.
 * Case-insensitive substring match.
 */
function filterEntries(entries) {
    if (!searchQuery) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(entry => {
        const comment = (entry.comment || '').toLowerCase();
        const keys = (Array.isArray(entry.key) ? entry.key.join(' ') : '').toLowerCase();
        const secKeys = (Array.isArray(entry.keysecondary) ? entry.keysecondary.join(' ') : '').toLowerCase();
        const content = (entry.content || '').toLowerCase();
        return comment.includes(q) || keys.includes(q) || secKeys.includes(q) || content.includes(q);
    });
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

    // Filter by search, then sort
    const filtered = filterEntries(entries);

    if (filtered.length === 0) {
        container.innerHTML = `<div class="${WL_PREFIX}-placeholder-text">No entries match "${escapeHtml(searchQuery)}"</div>`;
        updatePageInfo(0, 0, 0);
        return;
    }

    const sorted = getSortedEntries(filtered);

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
            <div class="${WL_PREFIX}-entry-row ${entry.disable ? WL_PREFIX + '-entry-disabled' : ''} ${isExpanded ? WL_PREFIX + '-entry-selected' : ''} ${selectedEntries.has(entry.uid) ? WL_PREFIX + '-entry-bulk-checked' : ''}"
                 data-uid="${entry.uid}">
                <span class="${WL_PREFIX}-entry-bulk-cell">
                    <input type="checkbox" class="${WL_PREFIX}-bulk-checkbox" data-uid="${entry.uid}" ${selectedEntries.has(entry.uid) ? 'checked' : ''}>
                </span>
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
    updateBulkBar();
    syncSelectAllCheckbox();
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

    // Auto-select number input contents on focus (entry rows + detail panels)
    container.addEventListener('focusin', (e) => {
        if (e.target.type === 'number') e.target.select();
    });

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

        // Bulk checkbox — handled by change event
        if (e.target.closest(`.${WL_PREFIX}-entry-bulk-cell`)) return;

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
        // Bulk select checkbox
        const bulkCb = e.target.closest(`.${WL_PREFIX}-bulk-checkbox`);
        if (bulkCb) {
            const uid = parseInt(bulkCb.dataset.uid, 10);
            if (bulkCb.checked) {
                selectedEntries.add(uid);
            } else {
                selectedEntries.delete(uid);
            }
            // Visual highlight on the row
            const row = bulkCb.closest(`.${WL_PREFIX}-entry-row`);
            if (row) row.classList.toggle(`${WL_PREFIX}-entry-bulk-checked`, bulkCb.checked);
            updateBulkBar();
            syncSelectAllCheckbox();
            return;
        }

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
                <label class="${WL_PREFIX}-fld-label">Content <span class="${WL_PREFIX}-fld-tokens">~${charTokens} tok | UID ${entry.uid}</span></label>
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
                        <div class="${WL_PREFIX}-fld-col" style="width:70px">
                            <label class="${WL_PREFIX}-fld-label">Case</label>
                            ${buildTriStateSelect('caseSensitive', entry.caseSensitive)}
                        </div>
                        <div class="${WL_PREFIX}-fld-col" style="width:70px">
                            <label class="${WL_PREFIX}-fld-label">Whole</label>
                            ${buildTriStateSelect('matchWholeWords', entry.matchWholeWords)}
                        </div>
                        <div class="${WL_PREFIX}-fld-col" style="width:80px">
                            <label class="${WL_PREFIX}-fld-label">GrpScore</label>
                            ${buildTriStateSelect('useGroupScoring', entry.useGroupScoring)}
                        </div>
                    </div>

                    <div class="${WL_PREFIX}-fld-section-label">Recursion</div>
                    <div class="${WL_PREFIX}-fld-inline">
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="excludeRecursion" ${entry.excludeRecursion ? 'checked' : ''}><span>Non-recursable</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="preventRecursion" ${entry.preventRecursion ? 'checked' : ''}><span>Prevent further</span></label>
                        <label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="delayUntilRecursionToggle" ${entry.delayUntilRecursion ? 'checked' : ''}><span>Delay rec.</span></label>
                        <div class="${WL_PREFIX}-fld-col" style="width:55px${!entry.delayUntilRecursion ? ';display:none' : ''}">
                            <label class="${WL_PREFIX}-fld-label">Level</label>
                            <input type="number" class="${WL_PREFIX}-fld-input ${WL_PREFIX}-fld-num" data-field="delayUntilRecursionLevel" placeholder="auto" value="${typeof entry.delayUntilRecursion === 'number' ? entry.delayUntilRecursion : ''}" min="0">
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

                    <div class="${WL_PREFIX}-fld-section-label">Generation Type Triggers</div>
                    <div class="${WL_PREFIX}-fld-checkgrid">
                        ${buildTriggersCheckboxes(entry.triggers)}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Detail Panel Helpers — tri-state selects, triggers
// ============================================================

/** Generation type trigger values (must match ST's GENERATION_TYPE_TRIGGERS). */
const TRIGGER_TYPES = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'];

/** Build a tri-state <select> for nullable boolean fields (null=Global, true=Yes, false=No). */
function buildTriStateSelect(fieldName, value) {
    const isNull = value === null || value === undefined;
    const isTrue = value === true;
    const isFalse = value === false;
    return `<select class="${WL_PREFIX}-fld-tristate" data-field="${fieldName}">
        <option value="" ${isNull ? 'selected' : ''}>Global</option>
        <option value="true" ${isTrue ? 'selected' : ''}>Yes</option>
        <option value="false" ${isFalse ? 'selected' : ''}>No</option>
    </select>`;
}

/** Build trigger checkboxes from the entry's triggers array. */
function buildTriggersCheckboxes(triggers) {
    const active = Array.isArray(triggers) ? triggers : [];
    return TRIGGER_TYPES.map(t =>
        `<label class="${WL_PREFIX}-fld-check"><input type="checkbox" data-field="trigger" data-trigger-value="${t}" ${active.includes(t) ? 'checked' : ''}><span>${t}</span></label>`
    ).join('');
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
    const depthInput = pos === 4
        ? `<input type="number" class="${WL_PREFIX}-pos-depth-input" data-field="depth" value="${entry.depth ?? 4}" min="0" title="Depth">`
        : '';
    const opts = POSITION_OPTIONS.map(([v, short, long]) =>
        `<option value="${v}" ${pos === v ? 'selected' : ''}>${short} — ${long}</option>`
    ).join('');
    return `${depthInput}<span class="${WL_PREFIX}-pos-wrap" style="color:${color}" title="${getPositionLabel(pos)}${pos === 4 ? ' (depth ' + (entry.depth ?? 4) + ')' : ''}">
        <span class="${WL_PREFIX}-pos-icons">${iconHtml}</span>
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
    // sync: runtime uses 'disable', originalData uses 'enabled' (inverted boolean)
    getWIHelpers().then(({ setOriginal }) => {
        if (setOriginal) setOriginal(currentBookData, uid, 'enabled', !disabled);
    }).catch(() => {});
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
    'constant', 'vectorized', 'position', 'strategy', 'role',
    // 'depth' deliberately excluded — it's edited inline via the depth input,
    // and re-rendering on each keystroke would steal focus.
]);

/**
 * Apply a form input change to currentBookData, sync to ST's originalData, and schedule a save.
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
        syncOriginalData(uid, 'constant');
        syncOriginalData(uid, 'vectorized');
        commitSave();
        renderEntryTable(currentBookData);
        return;
    }

    // --- Virtual field: trigger checkboxes (each checkbox toggles one value in the triggers array) ---
    if (field === 'trigger') {
        const triggerValue = input.dataset?.triggerValue;
        if (!triggerValue) return;
        if (!Array.isArray(entry.triggers)) entry.triggers = [];
        if (input.checked) {
            if (!entry.triggers.includes(triggerValue)) entry.triggers.push(triggerValue);
        } else {
            entry.triggers = entry.triggers.filter(t => t !== triggerValue);
        }
        syncOriginalData(uid, 'triggers');
        scheduleSave();
        return;
    }

    // --- Virtual field: delayUntilRecursion toggle (checkbox on/off) ---
    if (field === 'delayUntilRecursionToggle') {
        const detail = input.closest(`.${WL_PREFIX}-entry-detail`);
        const levelInput = detail?.querySelector(`[data-field="delayUntilRecursionLevel"]`);
        const levelCol = levelInput?.closest(`.${WL_PREFIX}-fld-col`);
        if (input.checked) {
            entry.delayUntilRecursion = true;
            if (levelCol) levelCol.style.display = '';
        } else {
            entry.delayUntilRecursion = false;
            if (levelInput) levelInput.value = '';
            if (levelCol) levelCol.style.display = 'none';
        }
        syncOriginalData(uid, 'delayUntilRecursion');
        scheduleSave();
        return;
    }

    // --- Virtual field: delayUntilRecursion level (number input) ---
    if (field === 'delayUntilRecursionLevel') {
        const content = input.value;
        if (content === '') {
            // No specific level — use boolean true (= auto)
            entry.delayUntilRecursion = (typeof entry.delayUntilRecursion === 'boolean')
                ? entry.delayUntilRecursion : true;
        } else {
            const num = Number(content);
            entry.delayUntilRecursion = num === 1 ? true : (!isNaN(num) ? num : false);
        }
        syncOriginalData(uid, 'delayUntilRecursion');
        scheduleSave();
        return;
    }

    // --- Special-cased: characterFilter is a nested object ---
    if (field === 'characterFilterNames') {
        if (!entry.characterFilter) entry.characterFilter = { names: [], tags: [], isExclude: false };
        entry.characterFilter.names = input.value.split(',').map(s => s.trim()).filter(Boolean);
        syncOriginalData(uid, 'characterFilter', 'character_filter');
        scheduleSave();
        return;
    }
    if (field === 'characterFilterExclude') {
        if (!entry.characterFilter) entry.characterFilter = { names: [], tags: [], isExclude: false };
        entry.characterFilter.isExclude = !!input.checked;
        syncOriginalData(uid, 'characterFilter', 'character_filter');
        scheduleSave();
        return;
    }

    // --- Array fields (keys) — comma-separated input ---
    if (field === 'key' || field === 'keysecondary') {
        entry[field] = input.value.split(',').map(s => s.trim()).filter(Boolean);
        syncOriginalData(uid, field);
        scheduleSave();
        return;
    }

    // --- Tri-state selects (caseSensitive, matchWholeWords, useGroupScoring) ---
    const triStateFields = new Set(['caseSensitive', 'matchWholeWords', 'useGroupScoring']);
    if (triStateFields.has(field) && input.tagName === 'SELECT') {
        const val = input.value;
        entry[field] = val === '' ? null : val === 'true';
        syncOriginalData(uid, field);
        scheduleSave();
        return;
    }

    // --- Standard field by input type ---
    let value;
    if (input.type === 'checkbox') {
        value = input.checked;
        if (isNullable && !input.checked) value = null;
    } else if (input.type === 'number') {
        if (input.value === '' && isNullable) {
            value = null;
        } else if (input.value === '') {
            return;
        } else {
            const parsed = parseFloat(input.value);
            value = Number.isFinite(parsed) ? parsed : (entry[field] ?? 0);
        }
    } else if (input.tagName === 'SELECT') {
        const numericEnums = new Set(['position', 'role', 'selectiveLogic']);
        value = numericEnums.has(field) ? parseInt(input.value, 10) : input.value;
    } else {
        value = input.value;
    }

    entry[field] = value;

    // Position change → also manage role and depth visibility
    if (field === 'position') {
        if (value !== 4) {
            // Not @Depth — null out role
            entry.role = null;
            syncOriginalData(uid, 'role');
        } else if (entry.role === null || entry.role === undefined) {
            // Switched TO @Depth — default role to system (0)
            entry.role = 0;
            syncOriginalData(uid, 'role');
        }
        syncOriginalData(uid, 'position');
    } else {
        syncOriginalData(uid, field);
    }

    if (ROW_AFFECTING_FIELDS.has(field)) {
        commitSave();
        renderEntryTable(currentBookData);
    } else {
        scheduleSave();
    }
}

/**
 * Sync a field change to ST's originalData so native ST code sees current values.
 * Uses originalWIDataKeyMap to find the correct originalData key path.
 */

/** Supplementary key map for fields ST syncs to originalData but aren't in
 *  the exported originalWIDataKeyMap. Discovered by reading ST's native
 *  editor handlers — these use setWIOriginalDataValue with hard-coded paths. */
const EXTRA_ORIGINAL_KEYS = {
    group: 'extensions.group',
    outletName: 'extensions.outlet_name',
};

async function syncOriginalData(uid, entryKey, overrideOriginalKey) {
    if (!currentBookData) return;
    try {
        const { setOriginal, keyMap } = await getWIHelpers();
        if (!setOriginal || !keyMap) return;
        const originalKey = overrideOriginalKey || keyMap[entryKey] || EXTRA_ORIGINAL_KEYS[entryKey];
        if (!originalKey) return;
        setOriginal(currentBookData, uid, originalKey, currentBookData.entries[uid]?.[entryKey]);
    } catch (err) {
        // Non-fatal — originalData sync is a best-effort enhancement
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

// ============================================================
// Multi-Select Mode
// ============================================================

/**
 * Toggle multi-select mode on/off.
 * When entering: shows row checkboxes and bulk bar.
 * When exiting: hides everything and clears selections.
 */
function toggleMultiSelect() {
    if (multiSelectActive) {
        exitMultiSelect();
    } else {
        multiSelectActive = true;
        applyMultiSelectClass(true);
        updateBulkBar();
        log('Multi-select ON');
    }
}

/**
 * Exit multi-select mode — clear all selections and hide bulk UI.
 */
function exitMultiSelect() {
    multiSelectActive = false;
    selectedEntries.clear();
    // Uncheck all visible checkboxes
    document.querySelectorAll(`.${WL_PREFIX}-bulk-checkbox`).forEach(cb => {
        cb.checked = false;
        const row = cb.closest(`.${WL_PREFIX}-entry-row`);
        if (row) row.classList.remove(`${WL_PREFIX}-entry-bulk-checked`);
    });
    applyMultiSelectClass(false);
    updateBulkBar();
    syncSelectAllCheckbox();
    // Deactivate the toggle button highlight
    const toggleBtn = document.querySelector(`.${WL_PREFIX}-multiselect-toggle`);
    if (toggleBtn) toggleBtn.classList.remove(`${WL_PREFIX}-multiselect-active`);
    log('Multi-select OFF');
}

/**
 * Add/remove the multiselect-active class on the entry column
 * so CSS can show/hide bulk cells.
 */
function applyMultiSelectClass(active) {
    const entryCol = document.querySelector(`.${WL_PREFIX}-entry-col`);
    if (entryCol) {
        entryCol.classList.toggle(`${WL_PREFIX}-multiselect-on`, active);
    }
    const toggleBtn = document.querySelector(`.${WL_PREFIX}-multiselect-toggle`);
    if (toggleBtn) {
        toggleBtn.classList.toggle(`${WL_PREFIX}-multiselect-active`, active);
    }
}

// ============================================================
// Bulk Operations
// ============================================================

/**
 * Update the bulk action bar visibility, count, and target dropdown.
 */
function updateBulkBar() {
    const bar = document.querySelector(`.${WL_PREFIX}-bulk-bar`);
    if (!bar) return;

    const count = selectedEntries.size;
    // Show bar when multiselect mode is active (regardless of count)
    bar.style.display = multiSelectActive ? '' : 'none';

    // Update count label
    const countEl = bar.querySelector(`.${WL_PREFIX}-bulk-count`);
    if (countEl) countEl.textContent = `${count} selected`;

    // Populate target book dropdown (only when bar becomes visible)
    if (count > 0) populateBulkTargetDropdown();
}

/**
 * Sync the "select all" checkbox in the table header with current selection state.
 */
function syncSelectAllCheckbox() {
    const selectAllCb = document.querySelector(`.${WL_PREFIX}-bulk-select-all`);
    if (!selectAllCb) return;

    if (!currentBookData) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
        return;
    }

    const totalEntries = Object.keys(currentBookData.entries).length;
    const selectedCount = selectedEntries.size;

    if (selectedCount === 0) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
    } else if (selectedCount >= totalEntries) {
        selectAllCb.checked = true;
        selectAllCb.indeterminate = false;
    } else {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = true;
    }
}

/**
 * Populate the bulk target book dropdown with all lorebooks except the current one.
 */
async function populateBulkTargetDropdown() {
    const select = document.querySelector(`.${WL_PREFIX}-bulk-target`);
    if (!select) return;

    // Remember current selection
    const prevValue = select.value;

    try {
        const { world_names } = await worldInfoPromise;
        if (!world_names || !Array.isArray(world_names)) return;

        const others = world_names
            .filter(n => n !== currentBookName)
            .sort((a, b) => a.localeCompare(b));

        select.innerHTML = '<option value="">— Target book —</option>' +
            others.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');

        // Restore previous selection if still valid
        if (prevValue && others.includes(prevValue)) {
            select.value = prevValue;
        }
    } catch (err) {
        log('Failed to populate bulk target dropdown:', err);
    }
}

/**
 * Bulk copy selected entries to the target lorebook.
 * Entries remain in the source book.
 */
async function bulkCopy() {
    const target = document.querySelector(`.${WL_PREFIX}-bulk-target`)?.value;
    if (!target) {
        toastr.warning('Select a target lorebook first.');
        return;
    }
    if (!currentBookName || selectedEntries.size === 0) return;

    isBulkOperating = true;
    const uids = [...selectedEntries];
    const $toastr = toastr.info(`Copying ${uids.length} entries to "${target}"...`, 'Bulk Copy', {
        timeOut: 0, extendedTimeOut: 0, tapToDismiss: false,
    });

    try {
        const { moveWorldInfoEntry } = await worldInfoPromise;
        for (const uid of uids) {
            await moveWorldInfoEntry(currentBookName, target, uid, { deleteOriginal: false });
        }
        toastr.success(`Copied ${uids.length} entries to "${target}".`, 'Bulk Copy');
        selectedEntries.clear();
        updateBulkBar();
        syncSelectAllCheckbox();
        // Re-render to clear checkbox visual state
        if (currentBookData) renderEntryTable(currentBookData);
    } catch (err) {
        log('Bulk copy failed:', err);
        toastr.error('Bulk copy failed — check console for details.');
    } finally {
        isBulkOperating = false;
        $toastr.remove();
    }
}

/**
 * Bulk transfer (move) selected entries to the target lorebook.
 * Entries are removed from the source book.
 */
async function bulkTransfer() {
    const target = document.querySelector(`.${WL_PREFIX}-bulk-target`)?.value;
    if (!target) {
        toastr.warning('Select a target lorebook first.');
        return;
    }
    if (!currentBookName || selectedEntries.size === 0) return;

    // Confirm
    let confirmed = false;
    try {
        const { Popup } = SillyTavern.getContext();
        const result = await Popup.show.confirm(
            'Bulk Move',
            `Move ${selectedEntries.size} entries to "${target}"?\n\nThey will be removed from "${currentBookName}".`,
            { okButton: 'Move', cancelButton: 'Cancel' }
        );
        confirmed = result === 1;
    } catch {
        confirmed = confirm(`Move ${selectedEntries.size} entries to "${target}"? They will be removed from "${currentBookName}".`);
    }
    if (!confirmed) return;

    isBulkOperating = true;
    const uids = [...selectedEntries];
    const $toastr = toastr.info(`Moving ${uids.length} entries to "${target}"...`, 'Bulk Move', {
        timeOut: 0, extendedTimeOut: 0, tapToDismiss: false,
    });

    // Suppress ST's per-entry toasts during bulk
    const prevDuplicate = toastr.options.preventDuplicates;
    const prevClass = toastr.options.toastClass;
    toastr.options.preventDuplicates = true;
    toastr.options.toastClass = 'displayNone';

    try {
        const { moveWorldInfoEntry, loadWorldInfo } = await worldInfoPromise;
        for (const uid of uids) {
            await moveWorldInfoEntry(currentBookName, target, uid, { deleteOriginal: true });
        }
        toastr.success(`Moved ${uids.length} entries to "${target}".`, 'Bulk Move');
        selectedEntries.clear();

        // Reload the source book to reflect removals
        const data = await loadWorldInfo(currentBookName);
        if (data) {
            currentBookData = data;
            expandedEntryUid = null;
            renderEntryTable(data);
        }
    } catch (err) {
        log('Bulk transfer failed:', err);
        toastr.error('Bulk move failed — check console for details.');
    } finally {
        toastr.options.preventDuplicates = prevDuplicate;
        toastr.options.toastClass = prevClass;
        isBulkOperating = false;
        $toastr.remove();
    }
}

/**
 * Bulk delete selected entries from the current lorebook.
 */
async function bulkDelete() {
    if (!currentBookName || !currentBookData || selectedEntries.size === 0) return;

    // Confirm
    let confirmed = false;
    try {
        const { Popup } = SillyTavern.getContext();
        const result = await Popup.show.confirm(
            'Bulk Delete',
            `Delete ${selectedEntries.size} entries from "${currentBookName}"?\n\nThis cannot be undone.`,
            { okButton: 'Delete', cancelButton: 'Cancel' }
        );
        confirmed = result === 1;
    } catch {
        confirmed = confirm(`Delete ${selectedEntries.size} entries from "${currentBookName}"? This cannot be undone.`);
    }
    if (!confirmed) return;

    isBulkOperating = true;
    const uids = [...selectedEntries];
    const $toastr = toastr.info(`Deleting ${uids.length} entries...`, 'Bulk Delete', {
        timeOut: 0, extendedTimeOut: 0, tapToDismiss: false,
    });

    try {
        const { deleteWorldInfoEntry, saveWorldInfo, reloadEditor } = await worldInfoPromise;
        const lodash = SillyTavern.libs?.lodash;
        // Work on a deep copy to batch the deletions before saving
        const safeData = lodash ? lodash.cloneDeep(currentBookData) : JSON.parse(JSON.stringify(currentBookData));

        for (const uid of uids) {
            if (safeData.entries[uid]) {
                await deleteWorldInfoEntry(safeData, uid, { silent: true });
            }
        }

        await saveWorldInfo(currentBookName, safeData, true);
        reloadEditor(currentBookName, false);

        toastr.success(`Deleted ${uids.length} entries.`, 'Bulk Delete');

        // Update local state
        currentBookData = safeData;
        selectedEntries.clear();
        expandedEntryUid = null;
        renderEntryTable(safeData);
    } catch (err) {
        log('Bulk delete failed:', err);
        toastr.error('Bulk delete failed — check console for details.');
    } finally {
        isBulkOperating = false;
        $toastr.remove();
    }
}

function clearEntryTable() {
    const container = document.querySelector(`.${WL_PREFIX}-entry-rows`);
    if (container) {
        container.innerHTML = `<div class="${WL_PREFIX}-placeholder-text">Select a book to view entries</div>`;
    }
    selectedEntries.clear();
    updateBulkBar();
    syncSelectAllCheckbox();
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
                    // Don't clear state here — if the user cancels, the book
                    // should stay open. watchSTBookChanges will detect the
                    // option removal from #world_editor_select and clean up
                    // automatically if the deletion actually goes through.
                    refreshBookListAfterAction();
                    break;
                case 'open-st':
                    handleOpenInST();
                    break;
            }
        });
    }

    // ----- Multi-select toggle button (in table header) -----
    const msToggle = document.querySelector(`.${WL_PREFIX}-multiselect-toggle`);
    if (msToggle && !msToggle.dataset.wlWired) {
        msToggle.dataset.wlWired = 'true';
        msToggle.addEventListener('click', () => {
            toggleMultiSelect();
        });
    }

    // ----- Select All checkbox (in bulk bar) -----
    const selectAllCb = document.querySelector(`.${WL_PREFIX}-bulk-select-all`);
    if (selectAllCb && !selectAllCb.dataset.wlWired) {
        selectAllCb.dataset.wlWired = 'true';
        selectAllCb.addEventListener('change', () => {
            if (!currentBookData) return;
            const allUids = Object.values(currentBookData.entries).map(e => e.uid);
            if (selectAllCb.checked) {
                allUids.forEach(uid => selectedEntries.add(uid));
            } else {
                selectedEntries.clear();
            }
            // Update all visible checkboxes
            document.querySelectorAll(`.${WL_PREFIX}-bulk-checkbox`).forEach(cb => {
                const uid = parseInt(cb.dataset.uid, 10);
                cb.checked = selectedEntries.has(uid);
                const row = cb.closest(`.${WL_PREFIX}-entry-row`);
                if (row) row.classList.toggle(`${WL_PREFIX}-entry-bulk-checked`, cb.checked);
            });
            updateBulkBar();
            syncSelectAllCheckbox();
        });
    }

    // ----- Bulk action bar buttons -----
    const bulkBar = document.querySelector(`.${WL_PREFIX}-bulk-bar`);
    if (bulkBar && !bulkBar.dataset.wlWired) {
        bulkBar.dataset.wlWired = 'true';
        bulkBar.addEventListener('click', (e) => {
            const btn = e.target.closest(`.${WL_PREFIX}-bulk-btn`);
            if (!btn || isBulkOperating) return;
            const action = btn.dataset.bulkAction;
            switch (action) {
                case 'copy': bulkCopy(); break;
                case 'transfer': bulkTransfer(); break;
                case 'delete': bulkDelete(); break;
                case 'exit':
                    exitMultiSelect();
                    break;
            }
        });
    }

    // ----- Search input -----
    const searchInput = document.querySelector(`.${WL_PREFIX}-search-input`);
    if (searchInput && !searchInput.dataset.wlWired) {
        searchInput.dataset.wlWired = 'true';
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                searchTimer = null;
                searchQuery = searchInput.value.trim();
                currentPage = 0;
                if (currentBookData) renderEntryTable(currentBookData);
            }, 200);
        });
        // Clear search on Escape
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                searchQuery = '';
                currentPage = 0;
                if (currentBookData) renderEntryTable(currentBookData);
            }
        });
    }

    // ----- Sort dropdown -----
    const sortSelect = document.querySelector(`.${WL_PREFIX}-sort-select`);
    if (sortSelect && !sortSelect.dataset.wlWired) {
        sortSelect.dataset.wlWired = 'true';
        sortSelect.addEventListener('change', () => {
            currentSortMode = parseInt(sortSelect.value, 10);
            currentPage = 0;
            if (currentBookData) renderEntryTable(currentBookData);
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
    // Flush any pending debounced save so edits aren't lost
    await flushPendingSave();

    try {
        const { restoreDrawer } = await import('./drawerUI.js');
        restoreDrawer();
    } catch (err) {
        log('restoreDrawer failed:', err);
    }

    // Pre-select the book in ST's editor dropdown. This fires a 'change' on
    // #world_editor_select, which ST's own handler turns into
    // showWorldEditor → displayWorldEntries — so the native view loads with
    // our edits visible. Do NOT also call reloadEditor here: it just fires the
    // same 'change' a second time, and ST's displayWorldEntries pagination
    // callback is async (it awaits renderTemplateAsync + getWorldEntry before
    // appending). Two racing callbacks each clear the list while it's still
    // empty, then both append, producing duplicated header labels + entries.
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