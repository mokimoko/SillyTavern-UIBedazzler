// Restyle the hosted native controls without replacing their click handlers.
export function enhanceGroupCreateControls(block) {
    const undo = [];
    const row = block.querySelector('#GroupFavDelOkBack');
    const toggles = block.querySelector('#rm_group_allow_self_responses')?.closest('label')?.parentElement;
    if (row && toggles?.parentElement === row) {
        const next = toggles.nextSibling;
        row.prepend(toggles);
        toggles.classList.add('wl-cb-gc-toggles');
        undo.push(() => {
            toggles.classList.remove('wl-cb-gc-toggles');
            row.insertBefore(toggles, next?.parentNode === row ? next : null);
        });
    }

    for (const [id, label, primary] of [
        ['group_favorite_button', 'Add to Favorites', false],
        ['rm_group_submit', 'Create', true],
    ]) {
        const control = block.querySelector(`#${id}`);
        if (!control) continue;
        const contents = [...control.childNodes];
        const attributes = new Map(['role', 'tabindex', 'aria-pressed'].map(name => [name, control.getAttribute(name)]));
        const removed = [...control.classList].filter(name => name === 'menu_button' || name.startsWith('fa-'));
        const added = ['wl-cb-act', ...(primary ? ['wl-cb-act-primary'] : [])].filter(name => !control.classList.contains(name));
        control.classList.remove(...removed);
        control.classList.add(...added);
        control.setAttribute('role', 'button');
        control.setAttribute('tabindex', '0');
        const refresh = () => {
            const favorite = !primary && control.classList.contains('fav_on');
            control.textContent = favorite ? 'Added to Favorites' : label;
            if (!primary) control.setAttribute('aria-pressed', String(favorite));
        };
        const onKey = event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            if (!event.repeat && !control.disabled && !control.classList.contains('disabled')) control.click();
        };
        refresh();
        control.addEventListener('click', refresh);
        control.addEventListener('keydown', onKey);
        undo.push(() => {
            control.removeEventListener('click', refresh);
            control.removeEventListener('keydown', onKey);
            control.replaceChildren(...contents);
            control.classList.remove(...added);
            control.classList.add(...removed);
            for (const [name, value] of attributes) {
                if (value === null) control.removeAttribute(name);
                else control.setAttribute(name, value);
            }
        });
    }

    return () => { for (const restore of undo.reverse()) restore(); };
}
