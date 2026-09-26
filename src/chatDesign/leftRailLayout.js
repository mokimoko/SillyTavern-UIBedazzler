// Desktop-only layout for the native top bar as a left navigation rail.

const clampNumber = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function buildLeftRailLayoutCSS(properties = {}) {
    const railWidth = clampNumber(properties.topBarRailWidth, 44, 96, 60);
    const railRadius = clampNumber(properties.topBarRailRadius, 0, 48, 22);
    const railGap = properties.chatGapMode === 'custom'
        ? clampNumber(properties.chatGap, 0, 24, 0)
        : 10;

    return `@media screen and (min-width: 1001px) {
    body {
        --bd-left-rail-width: ${railWidth}px;
        --bd-left-rail-gap: ${railGap}px;
        --bd-left-rail-space: calc(var(--bd-left-rail-width) + var(--bd-left-rail-gap));
        --bd-left-rail-content-width: min(
            var(--sheldWidth, 50vw),
            calc(100dvw - var(--bd-left-rail-space))
        );
        --bd-vv-panel-width: max(
            0px,
            calc((100dvw - var(--bd-left-rail-space) - var(--bd-left-rail-content-width)) / 2)
        );
    }

    #top-bar {
        position: fixed !important;
        inset: 0 auto 0 0 !important;
        width: var(--bd-left-rail-width) !important;
        max-width: none !important;
        height: 100vh !important;
        height: 100dvh !important;
        margin: 0 !important;
        border-radius: 0 ${railRadius}px ${railRadius}px 0 !important;
    }

    #top-settings-holder {
        position: fixed !important;
        inset: 0 auto 0 0 !important;
        width: var(--bd-left-rail-width) !important;
        max-width: none !important;
        height: 100vh !important;
        height: 100dvh !important;
        margin: 0 !important;
        padding: max(8px, var(--tt-inset-top, 0px)) 6px 8px !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        justify-content: flex-start !important;
        gap: 6px !important;
        overflow: visible !important;
        transform: none !important;
    }

    #top-settings-holder > .drawer {
        flex: 0 0 var(--topBarBlockSize) !important;
        width: 100% !important;
        min-width: 0 !important;
        height: var(--topBarBlockSize) !important;
        min-height: var(--topBarBlockSize) !important;
        overflow: visible !important;
    }

    #top-settings-holder > .drawer > .drawer-toggle {
        width: 100% !important;
        height: 100% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
    }

    body #sheld {
        top: 0 !important;
        bottom: 0 !important;
        left: var(--bd-left-rail-space) !important;
        right: 0 !important;
        width: var(--bd-left-rail-content-width) !important;
        height: 100vh !important;
        height: 100dvh !important;
        min-height: 100px !important;
        max-height: 100dvh !important;
        margin: 0 auto !important;
    }

    body #sheld > #chat {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        max-height: none !important;
    }

    body #top-settings-holder .drawer-content {
        position: fixed !important;
        top: 0 !important;
        bottom: 0 !important;
        max-height: 100dvh !important;
        box-sizing: border-box !important;
    }

    body #top-settings-holder .drawer-content:not(.fillRight) {
        left: var(--bd-left-rail-space) !important;
        right: auto !important;
    }

    body #top-settings-holder .drawer-content:not(.fillLeft):not(.fillRight) {
        width: min(var(--sheldWidth, 50vw), calc(100dvw - var(--bd-left-rail-space))) !important;
        max-width: calc(100dvw - var(--bd-left-rail-space)) !important;
    }

    body #top-settings-holder .drawer-content.fillRight {
        left: auto !important;
        right: 0 !important;
        max-width: calc(100dvw - var(--bd-left-rail-space)) !important;
    }

    body #character_popup {
        left: var(--bd-left-rail-space) !important;
        right: 0 !important;
        width: min(var(--sheldWidth, 50vw), calc(100dvw - var(--bd-left-rail-space) - 16px)) !important;
        max-width: min(var(--sheldWidth, 50vw), calc(100dvw - var(--bd-left-rail-space) - 16px)) !important;
        margin-inline: auto !important;
    }

    #extensionTopBar,
    #extensionConnectionProfiles {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
    }

    #bd-variable-viewer {
        width: var(--bd-vv-panel-width) !important;
        max-width: calc(100dvw - var(--bd-left-rail-space)) !important;
    }
}`;
}
