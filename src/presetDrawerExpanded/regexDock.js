// src/presetDrawerExpanded/regexDock.js
// Regex tab — dock ST's NATIVE regex panel into the right column.
//
// Same philosophy as editorDock.js: rather than rebuild ST's regex UI (and
// re-implement its save path, preset handling, bulk ops, and re-render), we
// RELOCATE ST's own settings panel into the column. #regex_container is a
// static <div class="extension_container"> in core index.html that ST's regex
// extension appends its panel into once and only ever re-renders the inner
// lists of — so it's a stable, non-destructive relocate target.
//
// Because it's the SAME element (not a clone), there is only ever one source of
// truth: while the drawer is open the panel lives here; on close it returns to
// the Extensions drawer. Edits persist to extension_settings.regex either way,
// so the two "editors" can't desync — they're literally one panel.
//
// The per-script Regex Editor itself opens as ST's native modal <dialog>
// (callGenericPopup → showModal), which renders in the browser top layer above
// the overlay. Nothing to dock for it — it just works.

const DOCK_CLASS = 'wl-pe-docked-regex';
const CONTAINER_ID = 'regex_container';

let original = null; // { parent, nextSibling }

export function startRegexDock(bodyEl) {
    if (!bodyEl) return;
    const container = document.getElementById(CONTAINER_ID);
    // Regex extension not present / not yet initialized — leave the placeholder.
    if (!container) return;
    if (container.parentElement !== bodyEl) {
        if (!original) {
            original = { parent: container.parentNode, nextSibling: container.nextSibling };
        }
        container.classList.add(DOCK_CLASS);
        bodyEl.appendChild(container);
    }
    bodyEl.classList.add('wl-pe-has-regex');
}

export function stopRegexDock(bodyEl) {
    bodyEl?.classList.remove('wl-pe-has-regex');
    const container = document.getElementById(CONTAINER_ID);
    if (container) {
        container.classList.remove(DOCK_CLASS);
        if (original) {
            if (original.nextSibling && original.nextSibling.parentNode === original.parent) {
                original.parent.insertBefore(container, original.nextSibling);
            } else if (original.parent) {
                original.parent.appendChild(container);
            }
        }
    }
    original = null;
}
