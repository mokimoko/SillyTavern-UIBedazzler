import { VARIABLE_VALUE_TYPES } from './variableData.js';

const TYPE_LABELS = Object.freeze({
    string: 'Text',
    number: 'Number',
    boolean: 'Boolean',
    null: 'Null',
    json: 'JSON',
});

function fieldLabel(text, control) {
    const label = document.createElement('label');
    label.className = 'bd-vv-editor-field';
    const caption = document.createElement('span');
    caption.textContent = text;
    label.append(caption, control);
    return label;
}

export function createVariableEditor({ mode, descriptor, parentKind, onSave, onCancel }) {
    const form = document.createElement('form');
    form.className = 'bd-vv-editor';
    form.noValidate = true;

    const heading = document.createElement('div');
    heading.className = 'bd-vv-editor-heading';
    const title = document.createElement('strong');
    title.textContent = mode === 'edit' ? 'Edit value' : (parentKind === 'array' ? 'Append item' : 'Add variable');
    const hint = document.createElement('span');
    hint.textContent = mode === 'edit' ? 'Changes save to the active scope' : 'Choose a type, then enter its value';
    heading.append(title, hint);
    form.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'bd-vv-editor-grid';
    const nameInput = document.createElement('input');
    nameInput.className = 'text_pole bd-vv-editor-name';
    nameInput.type = 'text';
    nameInput.autocomplete = 'off';
    nameInput.placeholder = parentKind === 'array' ? 'New array item' : 'Variable name';
    nameInput.value = descriptor?.name ?? '';
    const showName = parentKind !== 'array' && descriptor?.renameAllowed !== false;
    if (showName) grid.appendChild(fieldLabel('Name', nameInput));

    const typeSelect = document.createElement('select');
    typeSelect.className = 'text_pole bd-vv-editor-type';
    for (const type of VARIABLE_VALUE_TYPES) {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = TYPE_LABELS[type];
        typeSelect.appendChild(option);
    }
    typeSelect.value = descriptor?.type ?? 'string';
    grid.appendChild(fieldLabel('Type', typeSelect));
    form.appendChild(grid);

    const valueInput = document.createElement('textarea');
    valueInput.className = 'text_pole bd-vv-editor-value';
    valueInput.rows = 3;
    valueInput.spellcheck = false;
    valueInput.placeholder = 'Value';
    valueInput.value = descriptor?.text ?? '';
    form.appendChild(fieldLabel('Value', valueInput));

    const error = document.createElement('div');
    error.className = 'bd-vv-editor-error';
    error.setAttribute('role', 'alert');
    form.appendChild(error);

    const actions = document.createElement('div');
    actions.className = 'bd-vv-editor-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'menu_button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', onCancel);
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'menu_button bd-vv-editor-save';
    save.innerHTML = '<i class="fa-solid fa-check"></i><span>Save</span>';
    actions.append(cancel, save);
    form.appendChild(actions);

    const syncType = () => {
        const isNull = typeSelect.value === 'null';
        valueInput.disabled = isNull;
        valueInput.closest('.bd-vv-editor-field').classList.toggle('bd-vv-field-disabled', isNull);
        if (typeSelect.value === 'boolean' && !/^(true|false)$/i.test(valueInput.value.trim())) valueInput.value = 'true';
        if (typeSelect.value === 'json' && !valueInput.value.trim()) valueInput.value = '{}';
    };
    let typeWasManuallyChanged = false;
    typeSelect.addEventListener('change', () => {
        typeWasManuallyChanged = true;
        syncType();
    });
    syncType();

    form.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            form.requestSubmit();
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.textContent = '';
        save.disabled = true;
        try {
            await onSave({
                name: showName ? nameInput.value : (descriptor?.name ?? ''),
                type: typeSelect.value,
                text: valueInput.value,
                preserveString: Boolean(descriptor?.inferredFromString && !typeWasManuallyChanged),
            });
        } catch (cause) {
            error.textContent = cause?.message || String(cause);
            save.disabled = false;
        }
    });

    requestAnimationFrame(() => (showName && !nameInput.value ? nameInput : valueInput).focus());
    return form;
}
