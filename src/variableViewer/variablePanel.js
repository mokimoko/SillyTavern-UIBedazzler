import {
    addVariable,
    collectExpandablePaths,
    createScopeSnapshot,
    decodeStoredValue,
    deleteVariable,
    formatVariablePath,
    flushVariables,
    getVariableDescriptor,
    getVariableStore,
    getVariableValue,
    importVariables,
    matchingVariableNames,
    sortedVariableNames,
    updateVariable,
} from './variableData.js';
import { createVariableEditor } from './variableEditor.js';
import { createVariablePanelShell } from './panelShell.js';
import { createTreeRenderContext, renderVariableRoot } from './treeView.js';

const POLL_INTERVAL = 1000;

function snapshotsEqual(left, right) {
    if (!left || left.size !== right.size) return false;
    for (const [key, value] of right) if (left.get(key) !== value) return false;
    return true;
}

function emptyState(scope) {
    return {
        scope,
        query: '',
        expanded: { local: new Set(), global: new Set() },
        snapshots: { local: null, global: null },
        editor: null,
        pollTimer: null,
        searchTimer: null,
    };
}

export class VariableViewerPanel {
    constructor() {
        this.refs = null;
        this.state = emptyState('local');
        this.boundKeydown = (event) => this.onKeydown(event);
        this.boundPointerDown = (event) => this.onDocumentPointerDown(event);
        this.treeActions = {
            onToggle: (path) => this.togglePath(path),
            onEdit: (path, node) => this.openEditor('edit', path, node),
            onAdd: (path) => this.openEditor('add-child', path),
            onDelete: (path) => this.removeVariable(path),
            onCopyPath: (path) => void this.copyPath(path),
            onCopyValue: (path) => void this.copyValue(path),
        };
    }

    isOpen() {
        return Boolean(this.refs?.root?.isConnected);
    }

    toggle() {
        if (this.isOpen()) this.close();
        else this.open();
    }

    open() {
        if (this.isOpen()) return;
        this.refs = createVariablePanelShell();
        this.state = emptyState(this.state.scope || 'local');
        document.body.appendChild(this.refs.root);
        document.body.classList.add('bd-vv-open');
        this.bindShell();
        this.syncScopeTabs();
        this.refresh({ force: true });
        this.startPolling();
        document.addEventListener('keydown', this.boundKeydown);
        document.addEventListener('pointerdown', this.boundPointerDown);
        requestAnimationFrame(() => this.refs?.root?.classList.add('bd-vv-ready'));
    }

    close() {
        if (!this.refs) return;
        clearInterval(this.state.pollTimer);
        clearTimeout(this.state.searchTimer);
        document.removeEventListener('keydown', this.boundKeydown);
        document.removeEventListener('pointerdown', this.boundPointerDown);
        document.body.classList.remove('bd-vv-open');
        this.refs.root.remove();
        this.refs = null;
        this.state.editor = null;
        this.state.pollTimer = null;
    }

    onChatChanged() {
        this.state.expanded.local.clear();
        if (this.isOpen()) {
            this.cancelEditor(false);
            this.refresh({ force: true });
        } else {
            this.state.snapshots.local = null;
        }
    }

    bindShell() {
        const refs = this.refs;
        refs.closeButton.addEventListener('click', () => this.close());
        refs.localTab.addEventListener('click', () => this.setScope('local'));
        refs.globalTab.addEventListener('click', () => this.setScope('global'));
        refs.addButton.addEventListener('click', () => this.openEditor('add-root'));
        refs.menuButton.addEventListener('click', () => this.toggleActionMenu());
        refs.expandAllButton.addEventListener('click', () => {
            this.closeActionMenu();
            this.expandAll();
        });
        refs.collapseAllButton.addEventListener('click', () => {
            this.closeActionMenu();
            this.collapseAll();
        });
        refs.importButton.addEventListener('click', () => {
            this.closeActionMenu();
            void this.importScope();
        });
        refs.exportButton.addEventListener('click', () => {
            this.closeActionMenu();
            this.exportScope();
        });
        refs.flushButton.addEventListener('click', () => this.flushShownVariables());
        refs.search.addEventListener('input', () => {
            clearTimeout(this.state.searchTimer);
            this.state.searchTimer = setTimeout(() => {
                this.state.query = refs.search.value;
                this.renderActiveList();
            }, 140);
        });
    }

    onKeydown(event) {
        if (!this.isOpen()) return;
        if (event.key === 'Escape' && !this.refs.actionMenu.hidden) {
            event.preventDefault();
            this.closeActionMenu();
            this.refs.menuButton.focus();
            return;
        }
        if (event.key === 'Escape' && !this.state.editor) this.close();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            this.refs.search.focus();
            this.refs.search.select();
        }
    }

    setScope(scope) {
        if (scope === this.state.scope) return;
        this.closeActionMenu();
        this.cancelEditor(false);
        this.state.scope = scope;
        this.syncScopeTabs();
        this.renderActiveList();
        this.updateStatus();
    }

    syncScopeTabs() {
        for (const tab of [this.refs.localTab, this.refs.globalTab]) {
            const active = tab.dataset.scope === this.state.scope;
            tab.classList.toggle('bd-vv-active', active);
            tab.setAttribute('aria-selected', String(active));
        }
    }

    startPolling() {
        clearInterval(this.state.pollTimer);
        this.state.pollTimer = setInterval(() => {
            if (!document.hidden && this.isOpen()) this.refresh();
        }, POLL_INTERVAL);
    }

    refresh({ force = false } = {}) {
        if (!this.refs) return;
        const next = {
            local: createScopeSnapshot('local'),
            global: createScopeSnapshot('global'),
        };
        this.updateCounts(next);

        if (this.state.editor) {
            this.refs.status.textContent = 'Editing · live refresh paused';
            return;
        }

        const active = this.state.scope;
        const changed = !snapshotsEqual(this.state.snapshots[active], next[active]);
        if (force || changed) {
            if (force || !this.state.snapshots[active] || this.state.query) this.renderActiveList();
            else this.reconcileActiveList(this.state.snapshots[active], next[active]);
        }
        this.state.snapshots = next;
        this.updateStatus();
    }

    updateCounts(snapshots) {
        this.refs.localTab.querySelector('.bd-vv-scope-count').textContent = snapshots.local.size;
        this.refs.globalTab.querySelector('.bd-vv-scope-count').textContent = snapshots.global.size;
    }

    updateStatus(message = null) {
        if (!this.refs) return;
        if (message) {
            this.refs.status.textContent = message;
            return;
        }
        const count = Object.keys(getVariableStore(this.state.scope)).length;
        const label = this.state.scope === 'local' ? 'Local' : 'Global';
        this.refs.status.textContent = `${label} · ${count} ${count === 1 ? 'variable' : 'variables'} · live`;
    }

    renderActiveList() {
        if (!this.refs) return;
        const scrollTop = this.refs.viewport.scrollTop;
        const list = this.refs.list;
        list.replaceChildren();
        const scope = this.state.scope;
        const store = getVariableStore(scope);
        const context = createTreeRenderContext(this.state.query);
        let shown = 0;

        for (const name of this.getShownVariableNames()) {
            const value = decodeStoredValue(store[name]).value;
            const root = renderVariableRoot({
                scope,
                name,
                value,
                expanded: this.state.expanded[scope],
                actions: this.treeActions,
                context,
            });
            if (root) {
                list.appendChild(root);
                shown += 1;
            }
        }
        this.appendListMessages(shown, context.truncated);
        this.refs.viewport.scrollTop = scrollTop;
        this.syncActionMenu();
    }

    reconcileActiveList(previous, next) {
        const list = this.refs.list;
        const scope = this.state.scope;
        const store = getVariableStore(scope);
        const existing = new Map();
        for (const child of [...list.children]) {
            if (child.classList.contains('bd-vv-node-root')) existing.set(child.dataset.rootName, child);
            else child.remove();
        }

        for (const [name, node] of existing) {
            if (!next.has(name)) {
                node.remove();
                existing.delete(name);
            }
        }

        const context = createTreeRenderContext('');
        for (const name of sortedVariableNames(scope)) {
            let node = existing.get(name);
            if (!node || previous.get(name) !== next.get(name)) {
                const value = decodeStoredValue(store[name]).value;
                const replacement = renderVariableRoot({
                    scope,
                    name,
                    value,
                    expanded: this.state.expanded[scope],
                    actions: this.treeActions,
                    context,
                });
                replacement?.classList.add('bd-vv-node-changed');
                if (node && replacement) node.replaceWith(replacement);
                node = replacement;
                existing.set(name, node);
            }
            if (node) list.appendChild(node);
        }

        this.appendListMessages(next.size, context.truncated);
        this.syncActionMenu();
    }

    appendListMessages(shown, truncated) {
        this.refs.list.querySelectorAll('.bd-vv-empty, .bd-vv-limit').forEach((node) => node.remove());
        if (!shown) {
            const empty = document.createElement('li');
            empty.className = 'bd-vv-empty';
            empty.innerHTML = this.state.query
                ? '<i class="fa-solid fa-magnifying-glass"></i><strong>No matches</strong><span>Try a name, path, or value.</span>'
                : '<i class="fa-solid fa-seedling"></i><strong>No variables yet</strong><span>Add one here or set one with a slash command.</span>';
            this.refs.list.appendChild(empty);
        }
        if (truncated) {
            const limit = document.createElement('li');
            limit.className = 'bd-vv-limit';
            limit.textContent = 'Large tree paused after 1,500 visible nodes. Collapse a branch or narrow the search.';
            this.refs.list.appendChild(limit);
        }
    }

    togglePath(path) {
        const expanded = this.state.expanded[this.state.scope];
        const key = JSON.stringify(path);
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        this.renderActiveList();
    }

    expandAll() {
        const result = collectExpandablePaths(this.state.scope);
        this.state.expanded[this.state.scope] = new Set(result.paths);
        if (result.truncated) toastr?.info?.('Expanded the first 1,500 branches.');
        this.renderActiveList();
    }

    collapseAll() {
        this.state.expanded[this.state.scope].clear();
        this.renderActiveList();
    }

    getShownVariableNames() {
        return matchingVariableNames(this.state.scope, this.state.query);
    }

    toggleActionMenu() {
        const opening = this.refs.actionMenu.hidden;
        if (opening) this.syncActionMenu();
        this.refs.actionMenu.hidden = !opening;
        this.refs.menuButton.setAttribute('aria-expanded', String(opening));
    }

    closeActionMenu() {
        if (!this.refs) return;
        this.refs.actionMenu.hidden = true;
        this.refs.menuButton.setAttribute('aria-expanded', 'false');
    }

    onDocumentPointerDown(event) {
        if (!this.refs || this.refs.actionMenu.hidden) return;
        if (this.refs.actionMenu.contains(event.target) || this.refs.menuButton.contains(event.target)) return;
        this.closeActionMenu();
    }

    syncActionMenu() {
        if (!this.refs) return;
        const shown = this.getShownVariableNames();
        const expanded = this.state.expanded[this.state.scope];
        const query = this.state.query.trim();
        const noun = shown.length === 1 ? 'variable' : 'variables';
        this.refs.expandAllButton.disabled = collectExpandablePaths(this.state.scope, 1).paths.length === 0;
        this.refs.collapseAllButton.disabled = expanded.size === 0;
        this.refs.flushButton.disabled = shown.length === 0;
        this.refs.flushLabel.textContent = query
            ? `Flush ${shown.length} filtered ${noun}`
            : `Flush all ${shown.length} ${noun}`;
        this.refs.flushButton.title = query
            ? 'Flush only the variables currently shown by this search'
            : `Flush every ${this.state.scope} variable`;
    }

    openEditor(mode, path = null, anchor = null) {
        this.cancelEditor(false);
        const scope = this.state.scope;
        const descriptor = mode === 'edit' ? getVariableDescriptor(scope, path) : null;
        const parentKind = mode === 'add-child' ? getVariableDescriptor(scope, path).kind : null;
        const editor = createVariableEditor({
            mode,
            descriptor,
            parentKind,
            onCancel: () => this.cancelEditor(),
            onSave: async (draft) => {
                const savedPath = mode === 'edit'
                    ? updateVariable(scope, path, draft)
                    : addVariable(scope, mode === 'add-child' ? path : null, draft);
                if (mode === 'add-child') this.state.expanded[scope].add(JSON.stringify(path));
                this.cancelEditor(false);
                this.refresh({ force: true });
                this.revealPath(savedPath);
                toastr?.success?.(mode === 'edit' ? 'Variable updated.' : 'Variable added.');
            },
        });

        if (mode === 'add-root') this.refs.composer.appendChild(editor);
        else {
            const target = anchor || this.findPathNode(path);
            const row = target?.querySelector(':scope > .bd-vv-node-row');
            if (!row) return;
            row.insertAdjacentElement('afterend', editor);
        }
        this.state.editor = { element: editor, path, mode };
        this.refs.status.textContent = 'Editing · live refresh paused';
    }

    cancelEditor(refresh = true) {
        if (!this.state.editor) return;
        this.state.editor.element.remove();
        this.state.editor = null;
        if (refresh && this.refs) this.refresh({ force: true });
    }

    findPathNode(path) {
        const key = JSON.stringify(path);
        return [...this.refs.list.querySelectorAll('[data-path-key]')]
            .find((node) => node.dataset.pathKey === key);
    }

    revealPath(path) {
        requestAnimationFrame(() => {
            const node = this.findPathNode(path);
            node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            node?.classList.add('bd-vv-node-changed');
        });
    }

    flushShownVariables() {
        const scope = this.state.scope;
        const names = this.getShownVariableNames();
        if (!names.length) return;

        this.closeActionMenu();
        this.cancelEditor(false);
        const removed = flushVariables(scope, names);
        const flushedNames = new Set(names);
        this.state.expanded[scope] = new Set(
            [...this.state.expanded[scope]].filter((key) => {
                try {
                    return !flushedNames.has(String(JSON.parse(key)[0]));
                } catch {
                    return true;
                }
            }),
        );
        this.refresh({ force: true });
        if (removed) toastr?.success?.(`Flushed ${removed} ${removed === 1 ? 'variable' : 'variables'}.`);
        else toastr?.info?.('Those variables had already been removed.');
    }

    removeVariable(path) {
        deleteVariable(this.state.scope, path);
        this.state.expanded[this.state.scope] = new Set(
            [...this.state.expanded[this.state.scope]].filter((key) => {
                try {
                    const candidate = JSON.parse(key);
                    return !path.every((part, index) => candidate[index] === part);
                } catch {
                    return true;
                }
            }),
        );
        this.refresh({ force: true });
        toastr?.success?.('Variable deleted.');
    }

    async confirm(message) {
        try {
            const ctx = SillyTavern.getContext();
            if (ctx?.callGenericPopup && ctx.POPUP_TYPE) {
                return Boolean(await ctx.callGenericPopup(message, ctx.POPUP_TYPE.CONFIRM));
            }
        } catch { /* Fall through to the browser confirmation. */ }
        return window.confirm(message);
    }

    async writeClipboard(text, successMessage) {
        try {
            if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
            else {
                const area = document.createElement('textarea');
                area.value = text;
                area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
                document.body.appendChild(area);
                area.select();
                document.execCommand('copy');
                area.remove();
            }
            toastr?.success?.(successMessage);
        } catch {
            toastr?.error?.('Could not copy to the clipboard.');
        }
    }

    copyPath(path) {
        return this.writeClipboard(formatVariablePath(path), 'Variable path copied.');
    }

    copyValue(path) {
        const value = getVariableValue(this.state.scope, path);
        const text = value !== null && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '');
        return this.writeClipboard(text, 'Variable value copied.');
    }

    async importScope() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const values = JSON.parse(await file.text());
                const store = getVariableStore(this.state.scope);
                const collisions = Object.keys(values).filter((key) => Object.hasOwn(store, key));
                if (collisions.length) {
                    const ok = await this.confirm(`Import will replace ${collisions.length} existing ${collisions.length === 1 ? 'variable' : 'variables'}. Continue?`);
                    if (!ok) return;
                }
                const count = importVariables(this.state.scope, values);
                this.refresh({ force: true });
                toastr?.success?.(`Imported ${count} ${count === 1 ? 'variable' : 'variables'}.`);
            } catch (error) {
                toastr?.error?.(error?.message || 'Could not import that JSON file.');
            }
        }, { once: true });
        input.click();
    }

    exportScope() {
        const scope = this.state.scope;
        const json = JSON.stringify(getVariableStore(scope), null, 2);
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${scope}-variables-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        toastr?.success?.(`${scope === 'local' ? 'Local' : 'Global'} variables exported.`);
    }
}
