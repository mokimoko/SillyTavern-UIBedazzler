// Tiny coordination point for code shared with the always-on prompt viewer.
// Keeping the callback here avoids dragging the entire expanded drawer into
// the startup module graph merely to switch one of its tabs.

let rightTabActivator = null;

export const EXPANDED_STYLE_ID = 'bd-preset-expanded-style';
export const expandedStyleUrl = () => new URL('../../presetDrawerExpanded.css', import.meta.url).href;

export function registerRightTabActivator(activator) {
    rightTabActivator = activator;
}

export function activateRightTab(which) {
    rightTabActivator?.(which);
}
