// Small, fixed-height virtual list used by the font picker.

const ROW_HEIGHT = 34;
const OVERSCAN_ROWS = 4;

function createResultButton(item, index, selectedValue, itemCount, onPreview, onChoose, focusIndex) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wl-cdm-font-result';
    if (item.value === selectedValue) button.classList.add('wl-cdm-font-result-selected');
    if (item.manual) button.classList.add('wl-cdm-font-result-manual');
    if (index === itemCount - 1) button.classList.add('wl-cdm-font-result-last');
    button.dataset.fontValue = item.value;
    button.dataset.fontIndex = String(index);
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(item.value === selectedValue));
    button.setAttribute('aria-posinset', String(index + 1));
    button.setAttribute('aria-setsize', String(itemCount));
    button.style.top = `${index * ROW_HEIGHT}px`;

    const name = document.createElement('span');
    name.textContent = item.name;
    const source = document.createElement('small');
    source.textContent = item.source;
    button.append(name, source);

    button.addEventListener('mouseenter', () => onPreview(item.value));
    button.addEventListener('focus', () => onPreview(item.value));
    button.addEventListener('click', () => onChoose(item.value));
    button.addEventListener('keydown', event => {
        const moves = {
            ArrowDown: index + 1,
            ArrowUp: index - 1,
            Home: 0,
            End: itemCount - 1,
            PageDown: index + 5,
            PageUp: index - 5,
        };
        if (!(event.key in moves)) return;
        event.preventDefault();
        focusIndex(Math.max(0, Math.min(moves[event.key], itemCount - 1)));
    });
    return button;
}

/**
 * Keep the browser responsive even with thousands of installed families by
 * mounting only the rows around the visible viewport.
 */
export function createFontResultList(element, { onPreview, onChoose }) {
    const spacer = document.createElement('div');
    spacer.className = 'wl-cdm-font-results-space';
    element.replaceChildren(spacer);

    let items = [];
    let selectedValue = '';
    let frame = 0;
    let renderedStart = -1;
    let renderedEnd = -1;

    const visibleRange = () => {
        const viewportHeight = element.clientHeight || 205;
        const start = Math.max(0, Math.floor(element.scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
        const end = Math.min(items.length, Math.ceil((element.scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS);
        return { start, end };
    };

    const render = (force = false) => {
        const { start, end } = visibleRange();
        if (!force && start === renderedStart && end === renderedEnd) return;
        renderedStart = start;
        renderedEnd = end;
        spacer.replaceChildren(...items.slice(start, end).map((item, offset) => (
            createResultButton(item, start + offset, selectedValue, items.length, onPreview, onChoose, focusIndex)
        )));
    };

    const queueRender = () => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            render();
        });
    };

    const scrollToIndex = (index, focus = false) => {
        if (!items.length) return;
        const safeIndex = Math.max(0, Math.min(index, items.length - 1));
        const rowTop = safeIndex * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;
        if (rowTop < element.scrollTop) {
            element.scrollTop = rowTop;
        } else if (rowBottom > element.scrollTop + element.clientHeight) {
            element.scrollTop = rowBottom - element.clientHeight;
        }
        render(true);
        if (focus) {
            spacer.querySelector(`[data-font-index="${safeIndex}"]`)?.focus();
        }
    };

    function focusIndex(index) {
        scrollToIndex(index, true);
    }

    element.addEventListener('scroll', queueRender, { passive: true });

    return {
        setItems(nextItems, nextSelectedValue) {
            items = nextItems;
            selectedValue = nextSelectedValue;
            element.scrollTop = 0;
            spacer.style.height = `${items.length * ROW_HEIGHT}px`;
            renderedStart = -1;
            renderedEnd = -1;
            render(true);
        },
        focusFirst() {
            focusIndex(0);
        },
        scrollToIndex(index) {
            scrollToIndex(index, false);
        },
        destroy() {
            element.removeEventListener('scroll', queueRender);
            if (frame) window.cancelAnimationFrame(frame);
        },
    };
}
