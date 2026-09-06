// Aspect: Evolutia bridge for the Persona Drawer.
// Moves A:E's live persona controls so upstream behavior remains authoritative.

import { findExtension } from '../../../../../extensions.js';

const EXTENSION_NAME = 'st-aspect-evolutia';
const ALTER_EGO_ROW_ID = 'dsf_persona_alter_ego_row';
const DYNAMIC_FIELDS_BAR_ID = 'dsf_persona_swap_bar';

let bridge = null;

export function isAspectEvolutiaAvailable() {
    try {
        return findExtension(EXTENSION_NAME)?.enabled === true;
    } catch {
        return typeof globalThis.aspectEvolutiaGenerateInterceptor === 'function';
    }
}

function integrationMarkup() {
    return `
        <div class="wl-pl-ae-shell">
            <header class="wl-pl-ae-hero">
                <div class="wl-pl-ae-heading">
                    <div class="wl-pl-ae-eyebrow">Connected extension</div>
                    <h3>Aspect: Evolutia</h3>
                    <p>Manage alternate identities and trigger-aware persona details from this drawer.</p>
                </div>
                <div class="wl-pl-ae-status"><i class="fa-solid fa-link"></i><span>Persona integration</span></div>
            </header>

            <section class="wl-pl-ae-section wl-pl-ae-identities">
                <div class="wl-pl-ae-section-head">
                    <div class="wl-pl-ae-section-icon"><i class="fa-solid fa-masks-theater"></i></div>
                    <div>
                        <h4>Alter Ego</h4>
                        <p>Choose the active form, visual identity, and automatic swap conditions.</p>
                    </div>
                </div>
                <div id="wl-pl-ae-alter-slot"></div>
            </section>

            <section class="wl-pl-ae-section wl-pl-ae-fields-section">
                <div class="wl-pl-ae-section-head">
                    <div class="wl-pl-ae-section-icon"><i class="fa-solid fa-layer-group"></i></div>
                    <div>
                        <h4>Dynamic Fields</h4>
                        <p>Build the persona fragments A:E can inject, enable, disable, and reorder.</p>
                    </div>
                </div>
                <div id="wl-pl-ae-fields-slot"></div>
            </section>

            <div class="wl-pl-ae-waiting">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <span>Waiting for Aspect: Evolutia to mount its persona controls…</span>
            </div>
        </div>
    `;
}

function containsIntegrationNode(node) {
    if (!(node instanceof Element)) return false;
    return node.id === ALTER_EGO_ROW_ID
        || node.id === DYNAMIC_FIELDS_BAR_ID
        || Boolean(node.querySelector(`#${ALTER_EGO_ROW_ID}, #${DYNAMIC_FIELDS_BAR_ID}`));
}

function moveControlsIntoPane() {
    if (!bridge) return;

    const alterSlot = bridge.pane.querySelector('#wl-pl-ae-alter-slot');
    const fieldsSlot = bridge.pane.querySelector('#wl-pl-ae-fields-slot');
    const alterEgoRow = document.getElementById(ALTER_EGO_ROW_ID);
    const dynamicFieldsBar = document.getElementById(DYNAMIC_FIELDS_BAR_ID);

    if (alterEgoRow && !alterSlot?.contains(alterEgoRow)) alterSlot?.appendChild(alterEgoRow);
    if (dynamicFieldsBar && !fieldsSlot?.contains(dynamicFieldsBar)) fieldsSlot?.appendChild(dynamicFieldsBar);

    const ready = Boolean(alterEgoRow && dynamicFieldsBar);
    bridge.pane.querySelector('.wl-pl-ae-waiting')?.toggleAttribute('hidden', ready);
}

export function mountAspectEvolutiaIntegration(root, nativeDescriptionTarget) {
    const pane = root?.querySelector('.wl-pl-tab-pane[data-tab="integrations"]');
    if (!pane || !nativeDescriptionTarget?.parentElement) return;

    pane.innerHTML = integrationMarkup();
    bridge = {
        root,
        pane,
        nativeParent: nativeDescriptionTarget.parentElement,
        nativeDescriptionTarget,
        observer: null,
        moveQueued: false,
    };

    moveControlsIntoPane();

    // Covers a late A:E mount without polling or watching the whole document.
    bridge.observer = new MutationObserver(mutations => {
        if (!bridge || bridge.moveQueued) return;
        if (!mutations.some(mutation => [...mutation.addedNodes].some(containsIntegrationNode))) return;

        bridge.moveQueued = true;
        queueMicrotask(() => {
            if (!bridge) return;
            bridge.moveQueued = false;
            moveControlsIntoPane();
        });
    });
    bridge.observer.observe(root, { childList: true, subtree: true });
}

export function restoreAspectEvolutiaIntegration() {
    if (!bridge) return;

    const { root, nativeParent, nativeDescriptionTarget } = bridge;
    bridge.observer?.disconnect();
    const descriptionAnchor = nativeDescriptionTarget.parentElement === nativeParent
        ? nativeDescriptionTarget
        : null;

    const dynamicFieldsBar = document.getElementById(DYNAMIC_FIELDS_BAR_ID);
    if (dynamicFieldsBar && root.contains(dynamicFieldsBar)) {
        nativeParent.insertBefore(dynamicFieldsBar, descriptionAnchor);
    }

    const alterEgoRow = document.getElementById(ALTER_EGO_ROW_ID);
    if (alterEgoRow && root.contains(alterEgoRow)) {
        nativeParent.insertBefore(alterEgoRow, dynamicFieldsBar?.parentElement === nativeParent
            ? dynamicFieldsBar
            : descriptionAnchor);
    }

    bridge = null;
}
