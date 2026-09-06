// Chat Design editor property-tab definitions and keyboard behavior.

const PROPERTY_TABS = Object.freeze({
    dialogue: Object.freeze([
        Object.freeze({ id: 'name', label: 'Name' }),
        Object.freeze({ id: 'message-text', label: 'Message Text' }),
        Object.freeze({ id: 'dialogue', label: 'Dialogue' }),
        Object.freeze({ id: 'sillytavern-ui', label: 'SillyTavern UI' }),
    ]),
    avatar: Object.freeze([
        Object.freeze({ id: 'avatar', label: 'Avatar' }),
        Object.freeze({ id: 'message-details', label: 'Message Details' }),
        Object.freeze({ id: 'action-buttons', label: 'Action Buttons' }),
    ]),
    generalUi: Object.freeze([
        Object.freeze({ id: 'top-bar', label: 'Top Bar', group: 'native' }),
        Object.freeze({ id: 'input-area', label: 'Input Area', group: 'native' }),
        Object.freeze({ id: 'qr-buttons', label: 'QR Buttons', group: 'native' }),
        Object.freeze({ id: 'controls', label: 'Controls', group: 'native' }),
        Object.freeze({ id: 'scrollbars', label: 'Scrollbars', group: 'native' }),
        Object.freeze({ id: 'weather-badge', label: 'Weather Badge', group: 'integrations', requiresWeatherBadge: true }),
        Object.freeze({ id: 'chat-top-bar', label: 'Chat Top Bar', group: 'integrations', requiresChatTopBar: true }),
        Object.freeze({ id: 'guided-generations', label: 'Guided Generations', group: 'integrations', requiresGuidedGenerations: true }),
    ]),
    container: Object.freeze([
        Object.freeze({ id: 'container', label: 'Container' }),
        Object.freeze({ id: 'content', label: 'Content' }),
        Object.freeze({ id: 'thinking', label: 'Thinking' }),
    ]),
});

export function getPropertyTabs(elementType, {
    weatherBadgeAvailable = false,
    chatTopBarAvailable = false,
    guidedGenerationsAvailable = false,
    group = null,
} = {}) {
    const tabs = PROPERTY_TABS[elementType] || [];
    return tabs.filter(tab => {
        if (group && tab.group !== group) return false;
        if (tab.requiresWeatherBadge && !weatherBadgeAvailable) return false;
        if (tab.requiresChatTopBar && !chatTopBarAvailable) return false;
        if (tab.requiresGuidedGenerations && !guidedGenerationsAvailable) return false;
        return true;
    });
}

export function resolvePropertyTab(tabs, requestedId) {
    if (tabs.some(tab => tab.id === requestedId)) return requestedId;
    return tabs[0]?.id || '';
}

export function renderPropertyTabBar(elementType, tabs, activeId, { forceVisible = false } = {}) {
    if (tabs.length === 0 || (tabs.length < 2 && !forceVisible)) return '';
    const label = elementType === 'avatar' ? 'Message Elements'
        : elementType === 'generalUi' ? 'General UI'
            : elementType === 'container' ? 'Container'
                : 'Fonts';
    return `
        <div class="wl-cdm-property-tabs" role="tablist" aria-label="${label} sections" aria-orientation="horizontal">
            ${tabs.map(tab => {
                const active = tab.id === activeId;
                return `
                    <button type="button" role="tab"
                            class="wl-cdm-property-tab${active ? ' wl-cdm-property-tab-active' : ''}"
                            id="wl-cdm-property-tab-${tab.id}"
                            data-property-tab="${tab.id}"
                            aria-selected="${active}"
                            aria-controls="wl-cdm-props"
                            tabindex="${active ? '0' : '-1'}">${tab.label}</button>
                `;
            }).join('')}
        </div>
    `;
}

export function wirePropertyTabBar(container, onSelect) {
    const tablist = container.querySelector('.wl-cdm-property-tabs:not(.wl-cdm-section-tabs)');
    if (!tablist) return;
    const tabs = [...tablist.querySelectorAll('.wl-cdm-property-tab')];

    tablist.addEventListener('wheel', event => {
        if (tablist.scrollWidth <= tablist.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
        event.preventDefault();
        tablist.scrollLeft += event.deltaY;
    }, { passive: false });

    const activate = tab => {
        if (!tab || tab.classList.contains('wl-cdm-property-tab-active')) return;
        tabs.forEach(candidate => {
            const active = candidate === tab;
            candidate.classList.toggle('wl-cdm-property-tab-active', active);
            candidate.setAttribute('aria-selected', String(active));
            candidate.tabIndex = active ? 0 : -1;
        });
        tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        onSelect(tab.dataset.propertyTab);
    };

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activate(tab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                    : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
            const next = tabs[nextIndex];
            activate(next);
            next?.focus();
        });
    });
}
