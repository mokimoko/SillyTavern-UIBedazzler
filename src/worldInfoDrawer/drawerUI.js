// src/worldInfoDrawer/drawerUI.js
// World Info Companion — two parts:
//   1. Drawer takeover: replaces #wi-holder content with book list + entry table
//   2. Floating sidebar: separate card to the LEFT of the drawer (Presets/Global/Active)
//
// Same DOM-takeover pattern as presetDrawer/charDrawer for the drawer part.
// Sidebar is a separate element on document.body, positioned via JS.

import { WL_PREFIX, WL_IDS, ST_SELECTORS } from './constants.js';
import { populateActiveBooks } from './entryList.js';

const log = (...args) => console.log('[WL WorldInfoDrawer]', ...args);

let takeoverActive = false;
let sidebarElement = null;
let wasPinned = false; // track original pin state to restore later
let resizeHandler = null; // debounced resize listener for sidebar repositioning

// ============================================================
// Public API
// ============================================================

export function isTakeoverActive() {
    return takeoverActive;
}

/** @returns {HTMLElement|null} */
export function getSidebarElement() {
    return sidebarElement;
}

/**
 * Takes over the WI drawer content and shows the floating sidebar.
 */
export function takeoverDrawer() {
    const drawerContent = document.getElementById('WorldInfo');
    if (!drawerContent || isTakeoverActive()) return;

    // Auto-pin the WI drawer so clicks on our sidebar don't close it
    pinDrawer(true);

    // Hide native WI content
    const wiHolder = drawerContent.querySelector('#wi-holder');
    if (wiHolder) wiHolder.style.display = 'none';

    // Build and insert drawer content (book list + entry table)
    const container = document.createElement('div');
    container.id = WL_IDS.drawerContent;
    container.className = `${WL_PREFIX}-drawer-content`;
    container.innerHTML = buildDrawerContentHTML();
    drawerContent.appendChild(container);

    // Build and show floating sidebar
    showSidebar(drawerContent);

    takeoverActive = true;
    log('Takeover applied + sidebar shown');
}

/**
 * Restores the native WI drawer content and hides sidebar.
 */
export function restoreDrawer() {
    // Remove our drawer content
    const container = document.getElementById(WL_IDS.drawerContent);
    if (container) container.remove();

    // Restore native content
    const drawerContent = document.getElementById('WorldInfo');
    if (drawerContent) {
        const wiHolder = drawerContent.querySelector('#wi-holder');
        if (wiHolder) wiHolder.style.display = '';
    }

    // Hide sidebar
    hideSidebar();

    // Restore original pin state
    pinDrawer(false);

    takeoverActive = false;
    log('Drawer restored + sidebar hidden');
}
// ============================================================
// Drawer Pin Management
// ============================================================

/**
 * Pin/unpin the WI drawer to prevent click-outside closure.
 * On pin: saves original state, checks the pin checkbox.
 * On unpin: restores original state.
 * Uses jQuery .trigger() to ensure ST's jQuery handlers fire.
 */
function pinDrawer(pin) {
    const pinCheckbox = document.querySelector(ST_SELECTORS.panelPin);
    if (!pinCheckbox) return;

    if (pin) {
        wasPinned = pinCheckbox.checked;
        if (!pinCheckbox.checked) {
            pinCheckbox.checked = true;
            // Use jQuery trigger if available — ST binds via jQuery
            if (typeof $ !== 'undefined' && $(pinCheckbox).trigger) {
                $(pinCheckbox).trigger('change');
            } else {
                pinCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    } else {
        if (!wasPinned && pinCheckbox.checked) {
            pinCheckbox.checked = false;
            if (typeof $ !== 'undefined' && $(pinCheckbox).trigger) {
                $(pinCheckbox).trigger('change');
            } else {
                pinCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }
}

// ============================================================
// Floating Sidebar (on document.body)
// ============================================================

function showSidebar(drawerContent) {
    if (!sidebarElement) {
        sidebarElement = document.createElement('div');
        sidebarElement.id = WL_IDS.sidebar;
        sidebarElement.className = `${WL_PREFIX}-sidebar`;
        sidebarElement.innerHTML = buildSidebarHTML();
        document.body.appendChild(sidebarElement);

        // Prevent clicks on sidebar from propagating to document-level
        // handlers (belt-and-suspenders with the auto-pin above)
        sidebarElement.addEventListener('mousedown', e => e.stopPropagation());
        sidebarElement.addEventListener('click', e => e.stopPropagation());
    }

    // Position sidebar to the left of the drawer
    positionSidebar(drawerContent);
    sidebarElement.classList.add(`${WL_PREFIX}-sidebar-visible`);

    // Reposition after drawer finishes its open transition
    // (first call may get a stale rect if the drawer is still animating)
    setTimeout(() => {
        if (sidebarElement) positionSidebar(drawerContent);
    }, 250);

    // Reposition on window resize (debounced)
    if (!resizeHandler) {
        let resizeTimer = null;
        resizeHandler = () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                resizeTimer = null;
                const dc = document.getElementById('WorldInfo');
                if (dc && sidebarElement) positionSidebar(dc);
            }, 100);
        };
        window.addEventListener('resize', resizeHandler);
    }
}

function hideSidebar() {
    if (sidebarElement) {
        sidebarElement.classList.remove(`${WL_PREFIX}-sidebar-visible`);
    }
    // Remove resize listener when sidebar is hidden
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
    }
}

function positionSidebar(drawerContent) {
    if (!sidebarElement || !drawerContent) return;

    const rect = drawerContent.getBoundingClientRect();
    const sidebarWidth = 175;
    const gap = 6;

    // Align sidebar top with drawer
    const topPos = rect.top;
    const bottomMargin = 40;
    const availableHeight = window.innerHeight - topPos - bottomMargin;

    // Use the larger of the drawer height (minus header) and a sane minimum,
    // then cap at available viewport space and a reasonable max.
    // This prevents a squished sidebar when the drawer hasn't fully expanded yet.
    const drawerBased = Math.max(rect.height - 44, 300);
    const sidebarHeight = Math.min(drawerBased, availableHeight, 780);

    // Prevent the sidebar from going off-screen to the left
    const leftPos = Math.max(4, rect.left - sidebarWidth - gap);

    sidebarElement.style.top = `${topPos}px`;
    sidebarElement.style.left = `${leftPos}px`;
    sidebarElement.style.height = `${sidebarHeight}px`;
}
// ============================================================
// HTML — Drawer Content (book list + entry table, inside drawer)
// ============================================================

function buildDrawerContentHTML() {
    return `
        <div class="${WL_PREFIX}-layout">
            <div class="${WL_PREFIX}-book-col" id="${WL_IDS.bookList}">
                <div class="${WL_PREFIX}-book-toolbar">
                    <button class="${WL_PREFIX}-tool-btn" title="Create new lorebook" data-action="new-book">
                        <i class="fa-solid fa-globe"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Open in ST editor" data-action="open-st">
                        <i class="fa-solid fa-up-right-from-square"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Rename" data-action="rename">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Import lorebook" data-action="import-book">
                        <i class="fa-solid fa-file-import"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Export lorebook" data-action="export-book">
                        <i class="fa-solid fa-file-export"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Duplicate" data-action="duplicate-book">
                        <i class="fa-solid fa-clone"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Delete" data-action="delete-book">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
                <div class="${WL_PREFIX}-book-items"></div>
            </div>
            <div class="${WL_PREFIX}-entry-col" id="${WL_IDS.entryTable}">
                <div class="${WL_PREFIX}-entry-toolbar">
                    <button class="${WL_PREFIX}-tool-btn" title="New entry" data-action="new-entry">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Refresh" data-action="refresh">
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Fill empty Memo/Titles with Keywords" data-action="fill-empty">
                        <i class="fa-solid fa-notes-medical"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Apply current sorting as Order" data-action="apply-sorting">
                        <i class="fa-solid fa-arrow-down-9-1"></i>
                    </button>
                    <div class="${WL_PREFIX}-toolbar-search">
                        <i class="fa-solid fa-search ${WL_PREFIX}-search-icon"></i>
                        <input type="search" class="${WL_PREFIX}-search-input" placeholder="Search..." data-action="search">
                    </div>
                    <select class="${WL_PREFIX}-sort-select" data-action="sort" title="Sort order">
                        <option value="0">Priority</option>
                        <option value="8" selected>Order ↘</option>
                        <option value="7">Order ↗</option>
                        <option value="1">Title A-Z</option>
                        <option value="2">Title Z-A</option>
                        <option value="3">Tokens ↗</option>
                        <option value="4">Tokens ↘</option>
                        <option value="5">Depth ↗</option>
                        <option value="6">Depth ↘</option>
                        <option value="11">Trigger% ↗</option>
                        <option value="12">Trigger% ↘</option>
                        <option value="9">UID ↗</option>
                        <option value="10">UID ↘</option>
                    </select>
                    <span class="${WL_PREFIX}-toolbar-spacer"></span>
                    <button class="${WL_PREFIX}-tool-btn" title="Previous" data-action="prev-page">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <button class="${WL_PREFIX}-tool-btn" title="Next" data-action="next-page">
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
                <div class="${WL_PREFIX}-table-header">
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-bulk">
                        <button class="${WL_PREFIX}-multiselect-toggle" title="Toggle multi-select">
                            <i class="fa-solid fa-list-check"></i>
                        </button>
                    </span>
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-expand"></span>
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-toggle"></span>
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-title">Title</span>
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-position" title="Position"><i class="fa-solid fa-layer-group" style="font-size:0.8em"></i></span>
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-role" title="Role"><i class="fa-solid fa-gear" style="font-size:0.8em"></i></span>
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-strategy" title="Strategy"><i class="fa-solid fa-bolt" style="font-size:0.8em"></i></span>
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-order" title="Order">Ord</span>
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-trigger" title="Trigger %">Trg%</span>
                    <span class="${WL_PREFIX}-th ${WL_PREFIX}-th-actions"></span>
                </div>
                <div class="${WL_PREFIX}-bulk-bar" style="display:none">
                    <label class="${WL_PREFIX}-bulk-select-all-label" title="Select / deselect all">
                        <input type="checkbox" class="${WL_PREFIX}-bulk-select-all">
                    </label>
                    <span class="${WL_PREFIX}-bulk-count">0 selected</span>
                    <select class="${WL_PREFIX}-bulk-target">
                        <option value="">— Target book —</option>
                    </select>
                    <button class="${WL_PREFIX}-bulk-btn" data-bulk-action="copy" title="Copy selected entries to target book">
                        <i class="fa-solid fa-clone"></i> Copy
                    </button>
                    <button class="${WL_PREFIX}-bulk-btn" data-bulk-action="transfer" title="Move selected entries to target book (removes from source)">
                        <i class="fa-solid fa-truck-arrow-right"></i> Move
                    </button>
                    <button class="${WL_PREFIX}-bulk-btn ${WL_PREFIX}-bulk-btn-danger" data-bulk-action="delete" title="Delete selected entries">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                    <span class="${WL_PREFIX}-toolbar-spacer"></span>
                    <button class="${WL_PREFIX}-bulk-btn ${WL_PREFIX}-bulk-btn-exit" data-bulk-action="exit" title="Exit multi-select">
                        <i class="fa-solid fa-xmark"></i> Done
                    </button>
                </div>
                <div class="${WL_PREFIX}-entry-rows">
                    <div class="${WL_PREFIX}-placeholder-text">Select a book to view entries</div>
                </div>
            </div>
        </div>
    `;
}
// ============================================================
// HTML — Floating Sidebar (Presets, Global Settings, Active)
// ============================================================

function buildSidebarHTML() {
    return `
        <div class="${WL_PREFIX}-sidebar-section">
            <div class="${WL_PREFIX}-section-label">Presets</div>
            <select class="${WL_PREFIX}-preset-select">
                <option value="">— None —</option>
            </select>
            <div class="${WL_PREFIX}-preset-actions">
                <button data-preset-action="save" title="Save current state to preset">
                    <i class="fa-solid fa-floppy-disk"></i>
                </button>
                <button data-preset-action="new" title="New preset from current state">
                    <i class="fa-solid fa-plus"></i>
                </button>
                <button data-preset-action="delete" title="Delete preset">
                    <i class="fa-solid fa-trash"></i>
                </button>
                <button data-preset-action="more" title="More actions">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
        <div class="${WL_PREFIX}-sidebar-section">
            <div class="${WL_PREFIX}-section-label ${WL_PREFIX}-collapsible" data-collapsed="true">
                Global Settings
                <i class="fa-solid fa-chevron-down ${WL_PREFIX}-collapse-chevron"></i>
            </div>
            <div class="${WL_PREFIX}-global-settings ${WL_PREFIX}-collapsed" style="display:none">
                <div class="${WL_PREFIX}-setting-row">
                    <label>Scan Depth</label>
                    <input type="number" class="${WL_PREFIX}-input-sm" data-setting="scanDepth" min="0" max="1000">
                </div>
                <div class="${WL_PREFIX}-setting-row">
                    <label>Context %</label>
                    <input type="number" class="${WL_PREFIX}-input-sm" data-setting="budget" min="1" max="100">
                </div>
                <div class="${WL_PREFIX}-setting-row">
                    <label>Budget Cap</label>
                    <input type="number" class="${WL_PREFIX}-input-sm" data-setting="budgetCap" min="0">
                </div>
                <div class="${WL_PREFIX}-setting-row">
                    <label>Min Activations</label>
                    <input type="number" class="${WL_PREFIX}-input-sm" data-setting="minActivations" min="0" max="100">
                </div>
                <div class="${WL_PREFIX}-setting-row">
                    <label>Max Depth</label>
                    <input type="number" class="${WL_PREFIX}-input-sm" data-setting="minActivationsDepthMax" min="0" max="100">
                </div>
                <div class="${WL_PREFIX}-setting-row">
                    <label>Max Recursion</label>
                    <input type="number" class="${WL_PREFIX}-input-sm" data-setting="maxRecursionSteps" min="0" max="10">
                </div>
                <div class="${WL_PREFIX}-setting-row">
                    <label>Strategy</label>
                    <select class="${WL_PREFIX}-input-sm ${WL_PREFIX}-select-sm" data-setting="characterStrategy">
                        <option value="0">Sorted Evenly</option>
                        <option value="1">Char First</option>
                        <option value="2">Global First</option>
                    </select>
                </div>
                <div class="${WL_PREFIX}-setting-checks">
                    <label class="${WL_PREFIX}-setting-check" title="Include names with each message into the context for scanning">
                        <input type="checkbox" class="${WL_PREFIX}-checkbox" data-setting="includeNames">
                        <span>Names</span>
                    </label>
                    <label class="${WL_PREFIX}-setting-check" title="Entries can activate other entries by mentioning their keywords">
                        <input type="checkbox" class="${WL_PREFIX}-checkbox" data-setting="recursive">
                        <span>Recursive</span>
                    </label>
                    <label class="${WL_PREFIX}-setting-check" title="Key lookup will respect case">
                        <input type="checkbox" class="${WL_PREFIX}-checkbox" data-setting="caseSensitive">
                        <span>Case</span>
                    </label>
                    <label class="${WL_PREFIX}-setting-check" title="Single-word keys won't match as part of other words">
                        <input type="checkbox" class="${WL_PREFIX}-checkbox" data-setting="matchWholeWords">
                        <span>Whole</span>
                    </label>
                    <label class="${WL_PREFIX}-setting-check" title="Only entries with most key matches selected for Inclusion Group filtering">
                        <input type="checkbox" class="${WL_PREFIX}-checkbox" data-setting="useGroupScoring">
                        <span>GrpScore</span>
                    </label>
                    <label class="${WL_PREFIX}-setting-check" title="Alert if world info exceeds the allocated budget">
                        <input type="checkbox" class="${WL_PREFIX}-checkbox" data-setting="overflowAlert">
                        <span>Overflow</span>
                    </label>
                </div>
            </div>
        </div>
        <div class="${WL_PREFIX}-sidebar-section ${WL_PREFIX}-active-section">
            <div class="${WL_PREFIX}-section-label">
                Active
                <button class="${WL_PREFIX}-add-active-btn" title="Attach lorebook">
                    <i class="fa-solid fa-plus"></i>
                </button>
            </div>
            <div class="${WL_PREFIX}-attach-picker" style="display:none">
                <select class="${WL_PREFIX}-attach-select">
                    <option value="">— Select book —</option>
                </select>
            </div>
            <div class="${WL_PREFIX}-active-books-list">
                <div class="${WL_PREFIX}-placeholder-text">No books active</div>
            </div>
        </div>
    `;
}
// ============================================================
// Wiring
// ============================================================

export function wireInteractions() {
    // Wire sidebar collapsibles
    if (sidebarElement) {
        sidebarElement.querySelectorAll(`.${WL_PREFIX}-collapsible`).forEach(header => {
            // Avoid double-binding
            if (header.dataset.wlWired) return;
            header.dataset.wlWired = 'true';

            header.addEventListener('click', () => {
                const isCollapsed = header.dataset.collapsed === 'true';
                header.dataset.collapsed = isCollapsed ? 'false' : 'true';
                const content = header.nextElementSibling;
                if (content) {
                    if (isCollapsed) {
                        content.classList.remove(`${WL_PREFIX}-collapsed`);
                        content.style.display = '';
                    } else {
                        content.classList.add(`${WL_PREFIX}-collapsed`);
                        content.style.display = 'none';
                    }
                }
                const icon = header.querySelector(`.${WL_PREFIX}-collapse-chevron`);
                if (icon) icon.style.transform = isCollapsed ? 'rotate(180deg)' : '';
            });
        });

        // Wire "Attach lorebook" button
        const addBtn = sidebarElement.querySelector(`.${WL_PREFIX}-add-active-btn`);
        if (addBtn && !addBtn.dataset.wlWired) {
            addBtn.dataset.wlWired = 'true';
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleAttachPicker();
            });
        }

        // Wire attach picker select
        const attachSelect = sidebarElement.querySelector(`.${WL_PREFIX}-attach-select`);
        if (attachSelect && !attachSelect.dataset.wlWired) {
            attachSelect.dataset.wlWired = 'true';
            attachSelect.addEventListener('change', (e) => {
                const bookName = e.target.value;
                if (bookName) attachBookToActive(bookName);
            });
        }
    }

    // Auto-select number input contents on focus (sidebar)
    if (sidebarElement && !sidebarElement.dataset.wlAutoSelect) {
        sidebarElement.dataset.wlAutoSelect = 'true';
        sidebarElement.addEventListener('focusin', (e) => {
            if (e.target.type === 'number') e.target.select();
        });
    }

    log('Interactions wired');
}

// ============================================================
// Attach Book to Active
// ============================================================

function toggleAttachPicker() {
    const picker = sidebarElement?.querySelector(`.${WL_PREFIX}-attach-picker`);
    if (!picker) return;

    const isVisible = picker.style.display !== 'none';
    if (isVisible) {
        picker.style.display = 'none';
        return;
    }

    // Populate the select with available (non-active) books
    const stSelect = document.querySelector('#world_info');
    if (!stSelect) return;

    const activeNames = new Set(
        Array.from(stSelect.selectedOptions).map(o => o.value).filter(Boolean)
    );

    const select = picker.querySelector(`.${WL_PREFIX}-attach-select`);
    if (!select) return;

    // Build options from all available books
    const allOptions = Array.from(stSelect.options)
        .filter(o => o.value && !activeNames.has(o.value))
        .sort((a, b) => a.textContent.localeCompare(b.textContent));

    select.innerHTML = '<option value="">— Select book —</option>' +
        allOptions.map(o => `<option value="${o.value}">${o.textContent.trim()}</option>`).join('');

    picker.style.display = '';
}

async function attachBookToActive(bookName) {
    const stSelect = document.querySelector('#world_info');
    if (!stSelect) return;

    // Find the option and select it
    const option = Array.from(stSelect.options).find(o => o.value === bookName);
    if (option) {
        option.selected = true;
        // Trigger ST's change handler
        if (typeof $ !== 'undefined') {
            $(stSelect).trigger('change');
        } else {
            stSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        log(`Attached book: ${bookName}`);
    }

    // Hide picker, refresh active list
    const picker = sidebarElement?.querySelector(`.${WL_PREFIX}-attach-picker`);
    if (picker) picker.style.display = 'none';

    // Refresh the active books display
    populateActiveBooks();
}
