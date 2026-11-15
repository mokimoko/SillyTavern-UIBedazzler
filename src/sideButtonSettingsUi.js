// Shared layout controls for extension settings and Chat Design.
import { getSetting } from './settings.js';
import { getSideButtonChoices, setSideButtonOrder, setSideButtonOrientation } from './sideButtons.js';

const esc = value => String(value).replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Only connected panels participate; no global listeners retain closed modals.
const panels = new WeakMap();
function syncPanels() {
    document.querySelectorAll('.bd-side-layout-settings').forEach(host => panels.get(host)?.());
}

export function mountSideButtonLayoutSettings(host) {
    if (!host) return;
    host.classList.add('bd-side-layout-settings');
    host.innerHTML = `
        <label class="bd-side-layout-field">
            <span>Orientation</span>
            <select class="text_pole bd-side-orientation">
                <option value="vertical">Vertical</option>
                <option value="horizontal">Horizontal</option>
            </select>
        </label>
        <details class="bd-side-order-details">
            <summary>Button order</summary>
            <p class="bd-side-layout-hint">Drag a grip or use the arrows. Order runs top to bottom or left to right. Changes save immediately.</p>
            <div class="bd-side-order-list" aria-label="Side button order"></div>
            <button type="button" class="bd-small-action bd-side-order-reset">Reset button order</button>
            <span class="bd-side-order-status bd-sr-only" role="status"></span>
        </details>`;

    const orientation = host.querySelector('.bd-side-orientation');
    orientation.value = getSetting('sideButtonOrientation') === 'horizontal' ? 'horizontal' : 'vertical';
    orientation.addEventListener('change', () => {
        setSideButtonOrientation(orientation.value);
        syncPanels();
    });

    const list = host.querySelector('.bd-side-order-list');
    const status = host.querySelector('.bd-side-order-status');
    let draggedId = null;
    const renderRows = () => {
        const scrollTop = list.scrollTop;
        const choices = getSideButtonChoices();
        list.innerHTML = choices.map((choice, index) => `
            <div class="bd-side-order-row" data-id="${esc(choice.id)}">
                <button type="button" class="bd-side-order-grip" draggable="true"
                    title="Drag to reorder ${esc(choice.label)}" aria-label="Drag to reorder ${esc(choice.label)}">
                    <i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>
                </button>
                <span class="bd-side-order-name">${esc(choice.label)}${choice.available ? '' : '<small>Not available now</small>'}</span>
                <button type="button" class="bd-side-order-arrow" data-move="-1"
                    aria-label="Move ${esc(choice.label)} up" title="Move up" ${index === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
                </button>
                <button type="button" class="bd-side-order-arrow" data-move="1"
                    aria-label="Move ${esc(choice.label)} down" title="Move down" ${index === choices.length - 1 ? 'disabled' : ''}>
                    <i class="fa-solid fa-arrow-down" aria-hidden="true"></i>
                </button>
            </div>`).join('');
        list.scrollTop = scrollTop;
    };
    const saveOrder = (choices, movedId) => {
        setSideButtonOrder(choices.map(choice => choice.id));
        syncPanels();
        const index = choices.findIndex(choice => choice.id === movedId);
        if (index >= 0) status.textContent = `${choices[index].label} moved to position ${index + 1} of ${choices.length}.`;
    };
    panels.set(host, () => {
        orientation.value = getSetting('sideButtonOrientation') === 'horizontal' ? 'horizontal' : 'vertical';
        if (host.querySelector('details').open) renderRows();
    });
    // Build the list only when requested, including extensions that finish loading later.
    host.querySelector('details').addEventListener('toggle', event => {
        if (event.target.open) renderRows();
    });
    list.addEventListener('click', event => {
        const button = event.target.closest('[data-move]');
        if (!button || button.disabled) return;
        const id = button.closest('[data-id]').dataset.id;
        const choices = getSideButtonChoices();
        const from = choices.findIndex(choice => choice.id === id);
        const to = from + Number(button.dataset.move);
        if (from < 0 || to < 0 || to >= choices.length) return;
        [choices[from], choices[to]] = [choices[to], choices[from]];
        const direction = button.dataset.move;
        saveOrder(choices, id);
        const row = [...list.children].find(item => item.dataset.id === id);
        const preferred = row.querySelector(`[data-move="${direction}"]`);
        (preferred.disabled ? row.querySelector('[data-move]:not(:disabled)') : preferred)?.focus({ preventScroll: true });
        row.scrollIntoView({ block: 'nearest' });
    });
    const clearDrop = () => list.querySelectorAll('.bd-side-order-before, .bd-side-order-after').forEach(row => {
        row.classList.remove('bd-side-order-before', 'bd-side-order-after');
    });
    list.addEventListener('dragstart', event => {
        const grip = event.target.closest('.bd-side-order-grip');
        if (!grip) return;
        const row = grip.closest('[data-id]');
        draggedId = row.dataset.id;
        event.dataTransfer.setData('text/plain', draggedId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setDragImage(row, 12, row.offsetHeight / 2);
        row.classList.add('bd-side-order-dragging');
    });
    list.addEventListener('dragover', event => {
        if (!draggedId) return;
        const row = event.target.closest('.bd-side-order-row');
        clearDrop();
        if (!row || row.dataset.id === draggedId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'bd-side-order-before' : 'bd-side-order-after');
    });
    list.addEventListener('drop', event => {
        if (!draggedId) return;
        event.preventDefault();
        const row = event.target.closest('.bd-side-order-row');
        if (row && row.dataset.id !== draggedId) {
            const choices = getSideButtonChoices();
            const moved = choices.find(choice => choice.id === draggedId);
            const reordered = choices.filter(choice => choice.id !== draggedId);
            const rect = row.getBoundingClientRect();
            const after = event.clientY >= rect.top + rect.height / 2;
            const index = reordered.findIndex(choice => choice.id === row.dataset.id);
            if (moved && index >= 0) {
                reordered.splice(index + Number(after), 0, moved);
                saveOrder(reordered, draggedId);
            }
        }
        draggedId = null;
        clearDrop();
    });
    list.addEventListener('dragend', () => {
        draggedId = null;
        clearDrop();
        list.querySelector('.bd-side-order-dragging')?.classList.remove('bd-side-order-dragging');
    });
    host.querySelector('.bd-side-order-reset').addEventListener('click', () => {
        setSideButtonOrder([]);
        syncPanels();
        status.textContent = 'Default button order restored.';
    });
}
