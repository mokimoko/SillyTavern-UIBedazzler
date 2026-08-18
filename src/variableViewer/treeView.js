import {
    formatValuePreview,
    formatVariablePath,
    getChildEntries,
    getDisplayValueKind,
    isCompositeValue,
    variableMatchesQuery,
} from './variableData.js';

function iconButton(icon, label, onClick, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `bd-vv-icon-btn ${extraClass}`.trim();
    button.title = label;
    button.setAttribute('aria-label', label);
    const glyph = document.createElement('i');
    glyph.className = `fa-solid ${icon}`;
    button.appendChild(glyph);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return button;
}

export function createTreeRenderContext(query, maxNodes = 1500) {
    return { query: String(query ?? '').trim(), remaining: maxNodes, truncated: false };
}

function renderNode({ scope, path, label, value, depth, expanded, actions, context, filterQuery = context.query, root = false }) {
    if (context.remaining <= 0) {
        context.truncated = true;
        return null;
    }
    context.remaining -= 1;

    const composite = isCompositeValue(value);
    const pathKey = JSON.stringify(path);
    const ownNameMatches = Boolean(filterQuery && String(label).toLowerCase().includes(filterQuery.toLowerCase()));
    const childQuery = ownNameMatches ? '' : filterQuery;
    const forcedOpen = Boolean(filterQuery && composite && !ownNameMatches);
    const isOpen = forcedOpen || expanded.has(pathKey);
    const item = document.createElement('li');
    item.className = `bd-vv-node${root ? ' bd-vv-node-root' : ''}`;
    item.setAttribute('role', 'treeitem');
    item.dataset.pathKey = pathKey;
    item.style.setProperty('--bd-vv-depth', String(depth));
    if (root) item.dataset.rootName = String(path[0]);
    if (composite) item.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) item.classList.add('bd-vv-node-open');

    const row = document.createElement('div');
    row.className = 'bd-vv-node-row';
    row.title = formatVariablePath(path);

    const expander = document.createElement('button');
    expander.type = 'button';
    expander.className = 'bd-vv-expander';
    expander.tabIndex = composite ? 0 : -1;
    expander.disabled = !composite;
    expander.setAttribute('aria-label', isOpen ? 'Collapse variable' : 'Expand variable');
    expander.setAttribute('aria-expanded', String(isOpen));
    if (composite) {
        const chevron = document.createElement('i');
        chevron.className = 'fa-solid fa-chevron-right';
        expander.appendChild(chevron);
        expander.addEventListener('click', (event) => {
            event.stopPropagation();
            actions.onToggle(path);
        });
    }
    row.appendChild(expander);

    const identity = document.createElement('div');
    identity.className = 'bd-vv-node-identity';
    const name = document.createElement('span');
    name.className = 'bd-vv-node-name';
    name.textContent = String(label);
    identity.appendChild(name);

    const kind = getDisplayValueKind(value);
    if (kind !== 'string') {
        const type = document.createElement('span');
        type.className = 'bd-vv-type';
        type.dataset.kind = kind;
        type.textContent = kind;
        identity.appendChild(type);
    }
    row.appendChild(identity);

    const preview = document.createElement('span');
    preview.className = 'bd-vv-preview';
    preview.dataset.kind = kind;
    preview.textContent = formatValuePreview(value);
    row.appendChild(preview);

    const controls = document.createElement('div');
    controls.className = 'bd-vv-node-actions';
    controls.append(
        iconButton('fa-link', 'Copy variable path', () => actions.onCopyPath(path)),
        iconButton('fa-copy', 'Copy value', () => actions.onCopyValue(path)),
    );
    if (composite) controls.appendChild(iconButton('fa-plus', 'Add child', () => actions.onAdd(path)));
    controls.append(
        iconButton('fa-pen', 'Edit variable', () => actions.onEdit(path, item)),
        iconButton('fa-trash', 'Delete variable', () => actions.onDelete(path), 'bd-vv-danger'),
    );
    row.appendChild(controls);

    if (composite) {
        row.addEventListener('dblclick', (event) => {
            if (!event.target.closest('button')) actions.onToggle(path);
        });
    }
    item.appendChild(row);

    if (composite && isOpen) {
        const children = document.createElement('ul');
        children.className = 'bd-vv-children';
        children.setAttribute('role', 'group');
        for (const [childKey, childValue] of getChildEntries(value)) {
            if (childQuery && !variableMatchesQuery(String(childKey), childValue, childQuery)) continue;
            const child = renderNode({
                scope,
                path: [...path, childKey],
                label: childKey,
                value: childValue,
                depth: depth + 1,
                expanded,
                actions,
                context,
                filterQuery: childQuery,
            });
            if (child) children.appendChild(child);
        }
        item.appendChild(children);
    }

    return item;
}

export function renderVariableRoot({ scope, name, value, expanded, actions, context }) {
    return renderNode({
        scope,
        path: [name],
        label: name,
        value,
        depth: 0,
        expanded,
        actions,
        context,
        filterQuery: context.query,
        root: true,
    });
}
