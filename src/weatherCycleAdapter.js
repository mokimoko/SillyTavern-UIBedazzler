// Compatibility adapter for st-weather-cycle's optional floating controls.
// The extension does not expose a public API, so its native toggle remains the
// source of truth and UIBedazzler only replaces its placement/presentation.

const TOGGLE_ID = 'st-weather-cycle-toggle';
const PANEL_ID = 'st-weather-cycle-panel';
const ADAPTED_CLASS = 'bd-weather-cycle-panel-adapted';
const PANEL_GAP = 8;
const VIEWPORT_GAP = 8;

let boundButton = null;
let panelObserver = null;
let buttonClickHandler = null;
let outsidePointerHandler = null;
let resizeHandler = null;
let positionFrame = null;
let adaptedPanel = null;
let originalPanelPosition = null;
let lastDisplay = null;

function getToggle() {
    return document.getElementById(TOGGLE_ID);
}

function getPanel() {
    return document.getElementById(PANEL_ID);
}

function panelIsOpen(panel) {
    return !!panel && panel.style.display !== 'none';
}

/**
 * The native extension writes block/none directly from showWeatherButton.
 * Read the inline value because UIBedazzler's hiding class intentionally makes
 * getComputedStyle(toggle).display equal "none" while we own the control.
 */
export function isWeatherCycleControlEnabled() {
    const toggle = getToggle();
    return !!toggle && toggle.style.display !== 'none';
}

export function toggleWeatherCyclePanel() {
    getToggle()?.click();
}

function positionPanel() {
    const panel = adaptedPanel;
    const anchor = boundButton;
    if (!panelIsOpen(panel) || !anchor || !anchor.isConnected) return false;

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const left = Math.max(
        VIEWPORT_GAP,
        Math.round(anchorRect.left - panelRect.width - PANEL_GAP),
    );
    const maxTop = Math.max(
        VIEWPORT_GAP,
        window.innerHeight - panelRect.height - VIEWPORT_GAP,
    );
    const top = Math.min(Math.max(VIEWPORT_GAP, Math.round(anchorRect.top)), maxTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    return true;
}

function queuePanelPosition() {
    if (positionFrame !== null) return;
    positionFrame = requestAnimationFrame(() => {
        positionFrame = null;
        positionPanel();
    });
}

function syncPanelState() {
    if (!adaptedPanel || !boundButton) return;
    const open = panelIsOpen(adaptedPanel);
    boundButton.classList.toggle('bd-side-btn-active', open);
    // The side-button strip may still be detached while it is being rebuilt.
    // Wait one frame instead of treating a detached button's zero rect as a
    // real viewport position and sending an already-open panel to the corner.
    if (open && !positionPanel()) queuePanelPosition();
}

/** Attach the existing Weather Cycle panel to a UIBedazzler side button. */
export function attachWeatherCyclePanel(button) {
    destroyWeatherCyclePanel();

    const panel = getPanel();
    if (!button || !panel) return;

    boundButton = button;
    adaptedPanel = panel;
    originalPanelPosition = {
        left: panel.style.left,
        top: panel.style.top,
    };
    lastDisplay = panel.style.display;
    panel.classList.add(ADAPTED_CLASS);

    // sideButtons registers its native-trigger click first, so this listener
    // observes the panel after Weather Cycle has synchronously toggled it.
    buttonClickHandler = () => {
        lastDisplay = panel.style.display;
        syncPanelState();
    };
    button.addEventListener('click', buttonClickHandler);

    outsidePointerHandler = (event) => {
        if (!panelIsOpen(panel)) return;
        if (button.contains(event.target) || panel.contains(event.target)) return;

        // Let Weather Cycle close its own panel so its native behavior remains
        // the single source of truth.
        toggleWeatherCyclePanel();
        lastDisplay = panel.style.display;
        syncPanelState();
    };
    document.addEventListener('pointerdown', outsidePointerHandler, true);

    panelObserver = new MutationObserver(() => {
        // Positioning also changes the style attribute; only react when the
        // native extension actually changes display to avoid observer loops.
        if (panel.style.display === lastDisplay) return;
        lastDisplay = panel.style.display;
        syncPanelState();
    });
    panelObserver.observe(panel, { attributes: true, attributeFilter: ['style'] });

    resizeHandler = () => positionPanel();
    window.addEventListener('resize', resizeHandler);
    syncPanelState();
}

/** Restore Weather Cycle's native panel placement when side buttons turn off. */
export function destroyWeatherCyclePanel() {
    panelObserver?.disconnect();
    panelObserver = null;

    if (boundButton && buttonClickHandler) {
        boundButton.removeEventListener('click', buttonClickHandler);
        boundButton.classList.remove('bd-side-btn-active');
    }
    buttonClickHandler = null;

    if (outsidePointerHandler) {
        document.removeEventListener('pointerdown', outsidePointerHandler, true);
    }
    outsidePointerHandler = null;

    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;

    if (positionFrame !== null) cancelAnimationFrame(positionFrame);
    positionFrame = null;

    if (adaptedPanel) {
        adaptedPanel.classList.remove(ADAPTED_CLASS);
        adaptedPanel.style.left = originalPanelPosition?.left ?? '';
        adaptedPanel.style.top = originalPanelPosition?.top ?? '';
    }

    boundButton = null;
    adaptedPanel = null;
    originalPanelPosition = null;
    lastDisplay = null;
}
