// src/personaLore/loreUI.js
// Lore entry cards, inline edit, character selector for the Narrator Lore tab

import { getContext } from '../../../../../extensions.js';
import { user_avatar } from '../../../../../personas.js';
import { getLoreEntries, addLoreEntry, updateLoreEntry, deleteLoreEntry } from './storage.js';
import { getLoreTabPane, updateLoreBadge } from './drawerUI.js';

const log = (...args) => console.log('[WL NarratorLore UI]', ...args);

/**
 * Notify that lore data changed.
 * Actual injection is event-driven (CHAT_COMPLETION_PROMPT_READY),
 * so this is just logging. Avoids circular import with index.js.
 */
function onLoreDataChanged() {
    const entries = getLoreEntries(user_avatar);
    log(entries.length ? `✓ ${entries.length} lore entries — will inject at next generation` : '✓ No lore entries — injection inactive');
}

let isAddFormOpen = false;
let editingEntryId = null;

/**
 * Strip path/query from avatar filenames for safe comparison
 */
function cleanAvatar(avatar) {
    if (!avatar) return '';
    return avatar.replace(/\?.*$/, '').replace(/^.*[\\/]/, '');
}

/**
 * Render the full Narrator Lore tab content
 */
export function renderLoreTab() {
    const pane = getLoreTabPane();
    if (!pane) return;

    const avatarId = user_avatar;
    if (!avatarId) {
        pane.innerHTML = '<div class="wl-pl-empty-state"><p>No persona selected.</p></div>';
        updateLoreBadge(0);
        return;
    }

    const entries = getLoreEntries(avatarId);
    updateLoreBadge(entries.length);

    pane.innerHTML = '';

    if (entries.length === 0 && !isAddFormOpen) {
        pane.appendChild(buildEmptyState());
    } else {
        const cardList = document.createElement('div');
        cardList.className = 'wl-pl-card-list';

        entries.forEach(entry => {
            if (entry.id === editingEntryId) {
                cardList.appendChild(buildEditCard(entry, avatarId));
            } else {
                cardList.appendChild(buildEntryCard(entry, avatarId));
            }
        });

        pane.appendChild(cardList);
    }

    // Add form container
    const addContainer = document.createElement('div');
    addContainer.id = 'wl-pl-add-container';

    if (isAddFormOpen) {
        addContainer.appendChild(buildAddForm(avatarId));
    } else {
        addContainer.appendChild(buildAddButton());
    }

    pane.appendChild(addContainer);
}

// ============================================================
// Display Cards
// ============================================================

function buildEntryCard(entry, avatarId) {
    const card = document.createElement('div');
    card.className = 'wl-pl-card';
    card.dataset.entryId = entry.id;

    const content = document.createElement('div');
    content.className = 'wl-pl-card-content';
    content.textContent = entry.content;

    const footer = document.createElement('div');
    footer.className = 'wl-pl-card-footer';

    footer.appendChild(buildKnownByDisplay(entry.knownBy));
    footer.appendChild(buildCardActions(entry.id, avatarId));

    card.appendChild(content);
    card.appendChild(footer);

    return card;
}

function buildKnownByDisplay(knownBy) {
    const container = document.createElement('div');
    container.className = 'wl-pl-known-by';

    if (!knownBy || knownBy.length === 0) {
        const badge = document.createElement('span');
        badge.className = 'wl-pl-narrator-badge';
        badge.innerHTML = '<i class="fa-solid fa-lock fa-xs"></i> Narrator only';
        container.appendChild(badge);
    } else {
        const context = getContext();
        const avatarRow = document.createElement('div');
        avatarRow.className = 'wl-pl-avatar-row';

        knownBy.forEach(charAvatar => {
            const char = context.characters.find(c => cleanAvatar(c.avatar) === cleanAvatar(charAvatar));
            const thumb = document.createElement('div');
            thumb.className = 'wl-pl-char-thumb';
            thumb.title = char?.name || charAvatar;

            const img = document.createElement('img');
            img.src = `/characters/${charAvatar}`;
            img.alt = char?.name || charAvatar;
            img.onerror = () => { img.style.display = 'none'; };
            thumb.appendChild(img);
            avatarRow.appendChild(thumb);
        });

        const names = knownBy.map(av => {
            const c = context.characters.find(ch => cleanAvatar(ch.avatar) === cleanAvatar(av));
            return c?.name || av;
        });
        const label = document.createElement('span');
        label.className = 'wl-pl-known-names';
        label.textContent = knownBy.length <= 3 ? names.join(', ') : `${knownBy.length} characters`;

        container.appendChild(avatarRow);
        container.appendChild(label);
    }

    return container;
}

function buildCardActions(entryId, avatarId) {
    const actions = document.createElement('div');
    actions.className = 'wl-pl-card-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'wl-pl-action-btn';
    editBtn.title = 'Edit';
    editBtn.innerHTML = '<i class="fa-solid fa-pen fa-xs"></i>';
    editBtn.addEventListener('click', () => {
        editingEntryId = entryId;
        renderLoreTab();
        setTimeout(() => {
            const ta = document.querySelector(`.wl-pl-card[data-entry-id="${entryId}"] .wl-pl-edit-textarea`);
            if (ta) ta.focus();
        }, 50);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'wl-pl-action-btn wl-pl-action-delete';
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash fa-xs"></i>';
    deleteBtn.addEventListener('click', () => handleDelete(entryId, avatarId));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    return actions;
}

// ============================================================
// Edit Mode Card
// ============================================================

function buildEditCard(entry, avatarId) {
    const card = document.createElement('div');
    card.className = 'wl-pl-card wl-pl-card-editing';
    card.dataset.entryId = entry.id;

    const textarea = document.createElement('textarea');
    textarea.className = 'wl-pl-edit-textarea';
    textarea.value = entry.content;
    textarea.rows = 3;

    const selectedChars = [...(entry.knownBy || [])];
    const selectorEl = buildCharacterSelector(selectedChars);

    const btnRow = document.createElement('div');
    btnRow.className = 'wl-pl-edit-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'wl-pl-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
        handleEditSave(avatarId, entry.id, textarea, selectedChars);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'wl-pl-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
        editingEntryId = null;
        renderLoreTab();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            editingEntryId = null;
            renderLoreTab();
        }
    });

    card.appendChild(textarea);
    card.appendChild(selectorEl);
    card.appendChild(btnRow);

    return card;
}

function handleEditSave(avatarId, entryId, textarea, selectedChars) {
    const content = textarea.value.trim();
    if (!content) {
        textarea.focus();
        return;
    }

    updateLoreEntry(avatarId, entryId, { content, knownBy: [...selectedChars] });
    editingEntryId = null;
    renderLoreTab();
    onLoreDataChanged();
    log('Updated lore entry', entryId);
}

// ============================================================
// Character Selector Dropdown
// ============================================================

/**
 * Build a character selector trigger + dropdown.
 * Shows all available characters (not verse-scoped like VM).
 * selectedChars is a live array that gets mutated by the selector.
 */
function buildCharacterSelector(selectedChars) {
    const wrapper = document.createElement('div');
    wrapper.className = 'wl-pl-selector-wrapper';

    // Trigger button
    const trigger = document.createElement('button');
    trigger.className = 'wl-pl-selector-trigger';
    trigger.type = 'button';
    updateTriggerDisplay(trigger, selectedChars);

    // Dropdown panel
    const dropdown = document.createElement('div');
    dropdown.className = 'wl-pl-selector-dropdown';
    dropdown.style.display = 'none';

    // "Narrator only" option
    const narratorRow = document.createElement('div');
    narratorRow.className = 'wl-pl-selector-row wl-pl-selector-narrator';
    narratorRow.innerHTML = '<i class="fa-solid fa-lock fa-xs"></i> <span>Narrator only</span>';
    if (selectedChars.length === 0) narratorRow.classList.add('wl-pl-selector-active');
    narratorRow.addEventListener('click', () => {
        selectedChars.length = 0;
        refreshDropdownState(dropdown, selectedChars);
        updateTriggerDisplay(trigger, selectedChars);
    });
    dropdown.appendChild(narratorRow);

    // Divider
    const divider = document.createElement('div');
    divider.className = 'wl-pl-selector-divider';
    dropdown.appendChild(divider);

    // Character rows — show all available characters
    const availableChars = getAllCharacters();

    if (availableChars.length === 0) {
        const noChars = document.createElement('div');
        noChars.className = 'wl-pl-selector-empty';
        noChars.textContent = 'No characters available';
        dropdown.appendChild(noChars);
    } else {
        availableChars.forEach(char => {
            const avatarKey = cleanAvatar(char.avatar);
            const isSelected = selectedChars.some(a => cleanAvatar(a) === avatarKey);

            const row = document.createElement('div');
            row.className = 'wl-pl-selector-row';
            row.dataset.avatar = char.avatar;
            if (isSelected) row.classList.add('wl-pl-selector-active');

            const img = document.createElement('img');
            img.className = 'wl-pl-selector-avatar';
            img.src = `/characters/${char.avatar}`;
            img.alt = char.name;
            img.onerror = () => { img.style.display = 'none'; };

            const name = document.createElement('span');
            name.className = 'wl-pl-selector-name';
            name.textContent = char.name;

            const check = document.createElement('i');
            check.className = 'fa-solid fa-check wl-pl-selector-check';

            row.appendChild(img);
            row.appendChild(name);
            row.appendChild(check);

            row.addEventListener('click', () => {
                const idx = selectedChars.findIndex(a => cleanAvatar(a) === avatarKey);
                if (idx >= 0) {
                    selectedChars.splice(idx, 1);
                } else {
                    selectedChars.push(char.avatar);
                }
                refreshDropdownState(dropdown, selectedChars);
                updateTriggerDisplay(trigger, selectedChars);
            });

            dropdown.appendChild(row);
        });
    }

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display !== 'none';
        dropdown.style.display = isOpen ? 'none' : '';
    });

    // Close on outside click
    const closeHandler = (e) => {
        if (!wrapper.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    };
    document.addEventListener('click', closeHandler, true);

    // Cleanup listener when removed from DOM
    const observer = new MutationObserver(() => {
        if (!document.contains(wrapper)) {
            document.removeEventListener('click', closeHandler, true);
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);

    return wrapper;
}

function updateTriggerDisplay(trigger, selectedChars) {
    trigger.innerHTML = '';

    if (selectedChars.length === 0) {
        trigger.innerHTML = '<i class="fa-solid fa-lock fa-xs"></i> <span>Narrator only</span> <i class="fa-solid fa-caret-down fa-xs wl-pl-selector-caret"></i>';
        trigger.classList.remove('wl-pl-selector-has-chars');
    } else {
        const context = getContext();
        const thumbRow = document.createElement('div');
        thumbRow.className = 'wl-pl-avatar-row';

        const shown = selectedChars.slice(0, 4);
        shown.forEach(av => {
            const char = context.characters.find(c => cleanAvatar(c.avatar) === cleanAvatar(av));
            const thumb = document.createElement('div');
            thumb.className = 'wl-pl-char-thumb';
            thumb.title = char?.name || av;
            const img = document.createElement('img');
            img.src = `/characters/${av}`;
            img.alt = char?.name || av;
            img.onerror = () => { img.style.display = 'none'; };
            thumb.appendChild(img);
            thumbRow.appendChild(thumb);
        });

        trigger.appendChild(thumbRow);

        const label = document.createElement('span');
        const names = selectedChars.map(av => {
            const c = context.characters.find(ch => cleanAvatar(ch.avatar) === cleanAvatar(av));
            return c?.name || av;
        });
        label.textContent = selectedChars.length <= 3 ? names.join(', ') : `${selectedChars.length} characters`;
        label.className = 'wl-pl-selector-label';
        trigger.appendChild(label);

        const caret = document.createElement('i');
        caret.className = 'fa-solid fa-caret-down fa-xs wl-pl-selector-caret';
        trigger.appendChild(caret);

        trigger.classList.add('wl-pl-selector-has-chars');
    }
}

function refreshDropdownState(dropdown, selectedChars) {
    const narratorRow = dropdown.querySelector('.wl-pl-selector-narrator');
    if (narratorRow) {
        narratorRow.classList.toggle('wl-pl-selector-active', selectedChars.length === 0);
    }

    dropdown.querySelectorAll('.wl-pl-selector-row[data-avatar]').forEach(row => {
        const avatarKey = cleanAvatar(row.dataset.avatar);
        const isSelected = selectedChars.some(a => cleanAvatar(a) === avatarKey);
        row.classList.toggle('wl-pl-selector-active', isSelected);
    });
}

// ============================================================
// Add Lore Entry
// ============================================================

function buildAddButton() {
    const btn = document.createElement('button');
    btn.className = 'wl-pl-add-btn';
    btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Lore Entry';
    btn.addEventListener('click', () => {
        isAddFormOpen = true;
        renderLoreTab();
        setTimeout(() => {
            const ta = document.querySelector('#wl-pl-add-textarea');
            if (ta) ta.focus();
        }, 50);
    });
    return btn;
}

function buildAddForm(avatarId) {
    const form = document.createElement('div');
    form.className = 'wl-pl-add-form';

    const textarea = document.createElement('textarea');
    textarea.id = 'wl-pl-add-textarea';
    textarea.className = 'wl-pl-add-textarea';
    textarea.placeholder = 'What does the narrator know about this persona?';
    textarea.rows = 3;

    const selectedChars = [];
    const selectorEl = buildCharacterSelector(selectedChars);

    const btnRow = document.createElement('div');
    btnRow.className = 'wl-pl-add-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'wl-pl-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => handleAdd(avatarId, textarea, selectedChars));

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'wl-pl-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
        isAddFormOpen = false;
        renderLoreTab();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAdd(avatarId, textarea, selectedChars);
        }
        if (e.key === 'Escape') {
            isAddFormOpen = false;
            renderLoreTab();
        }
    });

    form.appendChild(textarea);
    form.appendChild(selectorEl);
    form.appendChild(btnRow);

    return form;
}

function buildEmptyState() {
    const el = document.createElement('div');
    el.className = 'wl-pl-empty-state';
    el.innerHTML = `
        <i class="fa-solid fa-book-open"></i>
        <p>No lore entries yet for this persona.</p>
        <p class="wl-pl-hint">Add backstory, secrets, and context that the narrator should know.</p>
    `;
    return el;
}

// ============================================================
// Handlers
// ============================================================

function handleAdd(avatarId, textarea, selectedChars) {
    const content = textarea.value.trim();
    if (!content) {
        textarea.focus();
        return;
    }

    addLoreEntry(avatarId, content, [...selectedChars]);
    isAddFormOpen = false;
    renderLoreTab();
    onLoreDataChanged();
    log('Added lore entry for', avatarId);
}

function handleDelete(entryId, avatarId) {
    const card = document.querySelector(`.wl-pl-card[data-entry-id="${entryId}"]`);
    if (!card) return;

    if (card.classList.contains('wl-pl-confirming')) {
        deleteLoreEntry(avatarId, entryId);
        editingEntryId = null;
        renderLoreTab();
        onLoreDataChanged();
        log('Deleted lore entry', entryId);
        return;
    }

    card.classList.add('wl-pl-confirming');
    const deleteBtn = card.querySelector('.wl-pl-action-delete');
    if (deleteBtn) {
        deleteBtn.title = 'Click again to confirm';
        deleteBtn.innerHTML = '<i class="fa-solid fa-check fa-xs"></i>';
    }

    setTimeout(() => {
        if (card.classList.contains('wl-pl-confirming')) {
            card.classList.remove('wl-pl-confirming');
            if (deleteBtn) {
                deleteBtn.title = 'Delete';
                deleteBtn.innerHTML = '<i class="fa-solid fa-trash fa-xs"></i>';
            }
        }
    }, 3000);
}

// ============================================================
// Helpers
// ============================================================

/**
 * Get all available characters.
 * Since WL doesn't have verses, we show all characters.
 */
function getAllCharacters() {
    const context = getContext();
    return context.characters || [];
}
