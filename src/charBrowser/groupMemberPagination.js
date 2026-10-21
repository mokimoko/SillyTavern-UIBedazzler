// Preserve the native member picker's page only across an Add Member refresh.
let installed = false;

export function initGroupMemberPagination(isEnabled) {
    if (installed) return;
    installed = true;
    let pendingCleanup = null;
    const cancel = () => pendingCleanup?.();

    document.addEventListener('click', event => {
        cancel();
        if (!isEnabled()) return;
        const add = event.target.closest?.('#rm_group_chats_block .group_member .right_menu_button[data-action="add"]');
        if (!add) return;
        const block = add.closest('#rm_group_chats_block');
        const pager = block.querySelector('#rm_group_add_members_pagination');
        if (!pager || typeof $ === 'undefined' || !$.fn.pagination) return;
        const pagination = $(pager);
        const previous = pagination.data('pagination');
        if (!previous?.initialized) return;
        const page = Number(pagination.pagination('getSelectedPageNum'));
        if (!Number.isFinite(page) || page <= 1) return;
        const contextKey = () => {
            const context = SillyTavern.getContext();
            return `${context.groupId ?? ''}:${context.menuType ?? ''}`;
        };
        const group = contextKey();
        const scroll = [];
        for (let element = add.parentElement; element; element = element.parentElement) {
            if (element.scrollTop) scroll.push([element, element.scrollTop]);
        }

        const observer = new MutationObserver(() => {
            const current = pagination.data('pagination');
            if (current === previous || !current?.initialized) return;
            const restore = isEnabled() && pager.isConnected && contextKey() === group;
            cleanup();
            if (!restore) return;
            // Adding the final character on the last page can remove that page.
            const lastPage = Math.max(1, Number(pagination.pagination('getTotalPage')) || 1);
            const target = Math.min(page, lastPage);
            if (Number(pagination.pagination('getSelectedPageNum')) !== target) pagination.pagination('go', target);
            for (const [element, top] of scroll) if (element.isConnected) element.scrollTop = top;
        });
        const cleanup = () => {
            observer.disconnect();
            clearTimeout(timer);
            document.removeEventListener('input', cancel, true);
            document.removeEventListener('change', cancel, true);
            pendingCleanup = null;
        };
        const timer = setTimeout(cleanup, 15000);
        pendingCleanup = cleanup;
        // Observe just this pager during the pending native update, not the roster.
        observer.observe(pager, { childList: true, subtree: true });
        document.addEventListener('input', cancel, true);
        document.addEventListener('change', cancel, true);
    }, true);
}
