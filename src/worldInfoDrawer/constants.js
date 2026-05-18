// src/worldInfoDrawer/constants.js
// Selectors, strategy colors, field mappings for the World Info Drawer

// ============================================================
// ST DOM Selectors
// ============================================================

export const ST_SELECTORS = {
    /** The drawer wrapper that gets .openDrawer/.closedDrawer */
    drawerContent: '#WorldInfo',
    /** The drawer toggle button */
    drawerToggle: '#WIDrawerIcon',
    /** Multi-select for globally active lorebooks */
    activeBooks: '#world_info',
    /** Select for which lorebook to edit */
    editorSelect: '#world_editor_select',
    /** The holder div containing all WI content */
    wiHolder: '#wi-holder',
    /** Global WI activation settings container */
    activationSettings: '#wiActivationSettings',
    /** Pin checkbox for keeping WI drawer open */
    panelPin: '#WI_panel_pin',
    /** New entry button */
    newEntry: '#world_popup_new',
    /** Delete entry button */
    deleteEntry: '#world_popup_delete',
    /** Export button */
    exportEntries: '#world_popup_export',
    /** Sort order select */
    sortOrder: '#world_info_sort_order',
};

// ============================================================
// WL DOM IDs / Classes
// ============================================================

export const WL_PREFIX = 'wl-wid'; // world info drawer

export const WL_IDS = {
    drawerContent: `${WL_PREFIX}-drawer-content`,
    sidebar: `${WL_PREFIX}-sidebar`,
    bookList: `${WL_PREFIX}-book-list`,
    entryTable: `${WL_PREFIX}-entry-table`,
};

// ============================================================
// Strategy Colors (neutral palette — not traffic-light)
// ============================================================

export const STRATEGY_COLORS = {
    keyword: '#7a9f6e',    // green — standard keyword activation
    constant: '#5b8dba',   // blue — always active
    vectorized: '#9a7eb8', // purple — vector/embedding match
    disabled: '#555555',   // dim — entry disabled
};

/**
 * Returns the strategy color for an entry.
 * @param {object} entry - WI entry object
 * @returns {string} CSS color value
 */
export function getStrategyColor(entry) {
    if (entry.disable) return STRATEGY_COLORS.disabled;
    if (entry.constant) return STRATEGY_COLORS.constant;
    if (entry.vectorized) return STRATEGY_COLORS.vectorized;
    return STRATEGY_COLORS.keyword;
}

/**
 * Returns a human-readable strategy label for an entry.
 * @param {object} entry - WI entry object
 * @returns {string}
 */
export function getStrategyLabel(entry) {
    if (entry.disable) return 'Off';
    if (entry.constant) return 'Con';
    if (entry.vectorized) return 'Vec';
    return 'Key';
}

// ============================================================
// WI Position Enum (mirrors ST's world_info_position)
// ============================================================

export const WI_POSITION = {
    0: 'Before Char Defs',
    1: 'After Char Defs',
    2: 'Before AN',
    3: 'After AN',
    4: 'At Depth',
    5: 'Before Example Messages',
    6: 'After Example Messages',
    7: 'Top of AN',
    8: 'Bottom of AN',
    9: 'Custom Outlet',
};

// ============================================================
// WI Role Enum
// ============================================================

export const WI_ROLE = {
    0: 'System',
    1: 'User',
    2: 'Assistant',
};

// ============================================================
// Tabs
// ============================================================

export const TABS = {
    editor: { id: 'editor', label: 'Editor', icon: 'fa-pen-to-square' },
    orderHelper: { id: 'order-helper', label: 'Order', icon: 'fa-arrow-down-1-9' },
    loreSimulator: { id: 'lore-sim', label: 'Simulator', icon: 'fa-flask' },
};
