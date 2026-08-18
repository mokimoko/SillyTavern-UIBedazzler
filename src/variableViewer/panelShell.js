function toolbarButton(icon, label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bd-vv-tool-btn';
    button.dataset.action = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    const glyph = document.createElement('i');
    glyph.className = `fa-solid ${icon}`;
    button.appendChild(glyph);
    return button;
}

function menuItem(icon, label, action, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `bd-vv-menu-item${danger ? ' bd-vv-menu-danger' : ''}`;
    button.dataset.action = action;
    button.setAttribute('role', 'menuitem');
    const glyph = document.createElement('i');
    glyph.className = `fa-solid ${icon}`;
    const text = document.createElement('span');
    text.className = 'bd-vv-menu-label';
    text.textContent = label;
    button.append(glyph, text);
    return button;
}

function menuSeparator() {
    const separator = document.createElement('div');
    separator.className = 'bd-vv-menu-separator';
    separator.setAttribute('role', 'separator');
    return separator;
}

function scopeTab(scope, icon, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bd-vv-scope-tab';
    button.dataset.scope = scope;
    button.setAttribute('role', 'tab');
    const glyph = document.createElement('i');
    glyph.className = `fa-solid ${icon}`;
    const text = document.createElement('span');
    text.textContent = label;
    const count = document.createElement('span');
    count.className = 'bd-vv-scope-count';
    count.textContent = '0';
    button.append(glyph, text, count);
    return button;
}

export function createVariablePanelShell() {
    const root = document.createElement('aside');
    root.id = 'bd-variable-viewer';
    root.className = 'bd-vv-panel';
    root.setAttribute('aria-label', 'Variable Viewer');

    const toolbar = document.createElement('div');
    toolbar.className = 'bd-vv-toolbar';
    const searchWrap = document.createElement('label');
    searchWrap.className = 'bd-vv-search';
    searchWrap.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search variables…';
    search.autocomplete = 'off';
    search.setAttribute('aria-label', 'Search variables');
    searchWrap.appendChild(search);
    toolbar.appendChild(searchWrap);

    const tools = document.createElement('div');
    tools.className = 'bd-vv-tools';
    const addButton = toolbarButton('fa-plus', 'Add variable', 'add');
    const menuWrap = document.createElement('div');
    menuWrap.className = 'bd-vv-menu-wrap';
    const menuButton = toolbarButton('fa-ellipsis-vertical', 'Variable actions', 'menu');
    menuButton.setAttribute('aria-haspopup', 'menu');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-controls', 'bd-vv-action-menu');

    const actionMenu = document.createElement('div');
    actionMenu.id = 'bd-vv-action-menu';
    actionMenu.className = 'bd-vv-action-menu';
    actionMenu.setAttribute('role', 'menu');
    actionMenu.hidden = true;
    const expandAllButton = menuItem('fa-angles-down', 'Expand all', 'expand-all');
    const collapseAllButton = menuItem('fa-angles-up', 'Collapse all', 'collapse-all');
    const importButton = menuItem('fa-file-import', 'Import variables…', 'import');
    const exportButton = menuItem('fa-file-export', 'Export variables', 'export');
    const flushButton = menuItem('fa-trash-can', 'Flush all variables', 'flush', true);
    actionMenu.append(
        expandAllButton,
        collapseAllButton,
        menuSeparator(),
        importButton,
        exportButton,
        menuSeparator(),
        flushButton,
    );
    menuWrap.append(menuButton, actionMenu);

    const closeButton = toolbarButton('fa-xmark', 'Close Variable Viewer', 'close');
    closeButton.classList.add('bd-vv-close');
    tools.append(addButton, menuWrap, closeButton);
    toolbar.appendChild(tools);
    root.appendChild(toolbar);

    const tabs = document.createElement('div');
    tabs.className = 'bd-vv-scope-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Variable scope');
    const localTab = scopeTab('local', 'fa-message', 'Local');
    const globalTab = scopeTab('global', 'fa-globe', 'Global');
    tabs.append(localTab, globalTab);
    root.appendChild(tabs);

    const composer = document.createElement('div');
    composer.className = 'bd-vv-composer';
    root.appendChild(composer);

    const meta = document.createElement('div');
    meta.className = 'bd-vv-meta';
    const status = document.createElement('span');
    status.className = 'bd-vv-status';
    status.textContent = 'Reading variables…';
    const shortcut = document.createElement('span');
    shortcut.className = 'bd-vv-shortcut';
    shortcut.textContent = '/variables';
    meta.append(status, shortcut);
    root.appendChild(meta);

    const viewport = document.createElement('div');
    viewport.className = 'bd-vv-viewport';
    const list = document.createElement('ul');
    list.className = 'bd-vv-list';
    list.setAttribute('role', 'tree');
    viewport.appendChild(list);
    root.appendChild(viewport);

    const footer = document.createElement('footer');
    footer.className = 'bd-vv-footer';
    footer.innerHTML = '<span>Double-click groups to unfold</span><span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> saves</span>';
    root.appendChild(footer);

    return {
        root,
        search,
        list,
        viewport,
        composer,
        status,
        localTab,
        globalTab,
        closeButton,
        addButton,
        menuButton,
        actionMenu,
        expandAllButton,
        collapseAllButton,
        importButton,
        exportButton,
        flushButton,
        flushLabel: flushButton.querySelector('.bd-vv-menu-label'),
    };
}
