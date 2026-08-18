// src/charBrowser/bulkActions.js
// Character Browser — the ST bridge for the multi-select BULK-BAR actions
// (Favorite · Tag · Duplicate · Persona · Delete). This is the ONLY browser module that
// reaches ST's character mutation pipeline for the whole picked SET, the same
// way actions.js isolates the single-character detail actions. Keeping it here
// means grid.js stays pure selection state and drawerUI stays layout/wiring.
//
// SCOPE (this slice): Favorite (favorite ALL picked), Tag (reuse ST's own bulk
// tag popup), Duplicate (duplicate ALL picked), Persona (convert ALL picked to
// user personas, reusing ST's convertCharacterToPersona), Delete (confirm +
// delete ALL picked).
//
// WHY REUSE ST'S TAG POPUP: ST's #bulk_tag_shadow_popup (built by
// characterGroupOverlay.bulkTagPopupHandler.show) already wires the whole
// tag-input / mutual-tags / import machinery against tag_map. Rebuilding that
// would duplicate a lot of tag-input plumbing that isn't on getContext(). So we
// map our picked avatars → the numeric character indices the popup expects and
// hand off. The popup is z-indexed BELOW our overlay by ST's own CSS, so the
// CSS lifts it while body.wl-cb-open is set (see charBrowser.css).
//
// WHY DYNAMIC IMPORTS FOR ST INTERNALS: characterGroupOverlay + deleteCharacter
// aren't on getContext(); we reach them via the same deep relative path the
// rest of Bedazzler uses (…/script.js). Doing it as a lazy import().then keeps
// a shifting ST module surface from breaking the browser at load — the action
// just no-ops with a warning if the symbol is unavailable.

import {
    favoriteCharacters,
    duplicateCharacters,
    avatarsToCharacterIds,
} from './charData.js';

const log = () => {};
const popupWatchCancels = new Set();

export function teardownBulkActionWatchers() {
    for (const cancel of [...popupWatchCancels]) cancel(false);
}

function ctx() {
    return SillyTavern.getContext();
}

// ── Lazy ST-core handles ────────────────────────────────────
// Resolved once, on first use. Each getter returns the symbol or null (never
// throws), so a caller can guard and degrade gracefully.
let _scriptMod = null;
let _scriptPromise = null;

function loadScriptMod() {
    if (_scriptMod) return Promise.resolve(_scriptMod);
    if (!_scriptPromise) {
        // Same depth the other Bedazzler modules use to reach public/script.js.
        _scriptPromise = import('../../../../../../script.js')
            .then(m => { _scriptMod = m; return m; })
            .catch(err => {
                console.warn('[BD] Char Browser: could not load script.js for bulk actions.', err);
                return null;
            });
    }
    return _scriptPromise;
}

// convertCharacterToPersona is NOT on getContext() — it's exported from
// personas.js. Reach it the same lazy way we reach script.js internals: import
// once on first use, degrade to null (never throw) if the symbol is gone.
let _personasMod = null;
let _personasPromise = null;

function loadPersonasMod() {
    if (_personasMod) return Promise.resolve(_personasMod);
    if (!_personasPromise) {
        // script.js is at public/script.js; personas.js sits in public/scripts/,
        // so it's one level DEEPER than the script.js path used above.
        _personasPromise = import('../../../../../../scripts/personas.js')
            .then(m => { _personasMod = m; return m; })
            .catch(err => {
                console.warn('[BD] Char Browser: could not load personas.js for the persona action.', err);
                return null;
            });
    }
    return _personasPromise;
}

// ============================================================
// Favorite (favorite ALL picked)
// ============================================================

/**
 * Favorite every picked character, then repaint. `avatars` is the live picked
 * set (array copy). `onDone(count)` reports how many persisted so the shell can
 * refresh the grid + nav counts and surface a toast. No confirm — favoriting is
 * cheap and reversible (unlike delete). Exits multi-select via the shell's
 * callback so the flow ends cleanly, matching ST's own bulk-favorite (which
 * drops back to browse state after).
 */
export async function bulkFavorite(avatars, { onDone } = {}) {
    const list = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
    if (!list.length) return;
    try {
        const n = await favoriteCharacters(list);
        toast(`Favorited ${n} character${n === 1 ? '' : 's'}.`);
        onDone?.(n);
    } catch (err) {
        console.error('[BD] Char Browser: bulk favorite failed.', err);
        onDone?.(0);
    }
}

// ============================================================
// Duplicate (duplicate ALL picked)
// ============================================================

/**
 * Duplicate every picked character, then repaint. charData.duplicateCharacters
 * reloads ST's characters[] after the batch so the new copies exist in memory;
 * we then hand back to the shell to refresh the grid (which re-reads models and
 * re-derives nav facets). `onDone(count)` reports how many copies were made.
 */
export async function bulkDuplicate(avatars, { onDone } = {}) {
    const list = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
    if (!list.length) return;
    try {
        const n = await duplicateCharacters(list);
        toast(`Duplicated ${n} character${n === 1 ? '' : 's'}.`);
        onDone?.(n);
    } catch (err) {
        console.error('[BD] Char Browser: bulk duplicate failed.', err);
        onDone?.(0);
    }
}

// ============================================================
// Persona (convert ALL picked → user personas)
// ============================================================

/**
 * Convert every picked character into a user persona — a straight port of ST's
 * native bulk "Persona" (BulkEditOverlay.handleContextMenuPersona, which loops
 * the selection and calls convertCharacterToPersona per character). That helper
 * clones the character's name + description (with an optional {{char}}/{{user}}
 * macro swap) and avatar into a new persona keyed "{name} (Persona).png",
 * registers it in power_user.personas / persona_descriptions, and refreshes the
 * persona selector — it also toasts per character and may raise a confirm popup
 * (name collision / macro swap).
 *
 * We resolve each avatar → its live characters[] index (what the helper wants)
 * and convert SEQUENTIALLY: those confirm popups can't sensibly stack, and ST's
 * own bulk path runs them one at a time too. Personas don't live in the
 * character grid, so no grid data changes here — onDone just lets the shell exit
 * multi-select. `onDone(count)` reports how many were actually created (a user
 * cancel on the confirm returns false and isn't counted).
 *
 * @param {string[]} avatars   picked avatar filenames
 * @param {object}   opts
 * @param {(count:number) => void} [opts.onDone]
 */
export async function bulkPersona(avatars, { onDone } = {}) {
    const list = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
    if (!list.length) return;

    const mod = await loadPersonasMod();
    const convert = mod?.convertCharacterToPersona;
    if (typeof convert !== 'function') {
        toast('Persona conversion is unavailable.', true);
        onDone?.(0);
        return;
    }

    let ok = 0;
    for (const avatar of list) {
        // Resolve per item — indices shift as characters[] mutates, and we want
        // the current index for THIS avatar right before the call.
        const [id] = avatarsToCharacterIds([avatar]);
        if (id == null) continue;
        try {
            const done = await convert(id);
            if (done) ok++;
        } catch (err) {
            console.error('[BD] Char Browser: persona conversion failed for', avatar, err);
        }
    }

    // convertCharacterToPersona already toasts per character ("You can now pick
    // X as a persona…"), so only add a batch summary when several succeed —
    // avoids double-toasting the single-character (card-menu) case.
    if (ok > 1) toast(`Converted ${ok} characters to personas.`);
    onDone?.(ok);
}

// ============================================================
// Tag (reuse ST's native bulk tag popup)
// ============================================================

/**
 * Open ST's own bulk-tag popup for the picked characters. We map avatars →
 * numeric character indices (what the popup expects) live, then call
 * characterGroupOverlay.bulkTagPopupHandler.show(ids). The popup edits tag_map
 * directly and calls printCharactersDebounced() on each change; it has NO
 * completion callback, so we watch for its DOM node (#bulk_tag_shadow_popup)
 * being removed and fire onDone THEN, so the browser refreshes its tag chips /
 * facet counts once the user closes it.
 *
 * The popup renders at z-index 9998 (below our 10000 overlay) by ST's CSS; the
 * lift lives in charBrowser.css (body.wl-cb-open #bulk_tag_shadow_popup), so it
 * sits above the browser while open. Multi-select is NOT exited here — the user
 * may want to run another action on the same selection; the shell decides.
 *
 * @param {string[]} avatars   picked avatar filenames
 * @param {object}   opts
 * @param {() => void} [opts.onDone]  called after the popup closes (refresh hook)
 */
export async function bulkTag(avatars, { onDone } = {}) {
    const list = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
    if (!list.length) return;

    const ids = avatarsToCharacterIds(list);
    if (!ids.length) {
        toast('None of the selected characters could be resolved.', true);
        return;
    }

    const mod = await loadScriptMod();
    const overlay = mod?.characterGroupOverlay;
    const handler = overlay?.bulkTagPopupHandler;
    if (!handler?.show) {
        toast('Tag editor is unavailable.', true);
        return;
    }

    // Open ST's popup. It appends #bulk_tag_shadow_popup to <body>.
    try {
        handler.show(ids);
    } catch (err) {
        console.error('[BD] Char Browser: bulk tag popup failed to open.', err);
        toast('Could not open the tag editor.', true);
        return;
    }

    // The popup gives no close callback. Watch <body> for its removal (Close /
    // reset / import all mutate tag_map and printCharactersDebounced, but the
    // grid only re-derives tag chips on a models refresh — so we refresh once,
    // on close). Guarded + self-disconnecting so it can't leak.
    watchPopupClose('bulk_tag_shadow_popup', () => onDone?.());
}

// ============================================================
// Delete (confirm + delete ALL picked)
// ============================================================

/**
 * Confirm, then delete every picked character via ST's own deleteCharacter
 * (which handles the whole pipeline — unshallow, /api delete, characters[]
 * reload, and event emits — for an avatar OR an array of avatars). The confirm
 * mirrors ST's bulk-delete popup: a permanent-warning + an opt-in "also delete
 * chat files" checkbox (default OFF, matching ST). On accept we delete, toast,
 * and hand back to the shell to refresh + exit multi-select.
 *
 * The confirm uses the modern callGenericPopup (.popup, z-index 29999) which
 * already sits above our overlay — no CSS lift needed for it.
 *
 * @param {string[]} avatars
 * @param {object}   opts
 * @param {(count:number) => void} [opts.onDone]  refresh + exit hook (count deleted)
 */
export async function bulkDelete(avatars, { onDone } = {}) {
    const list = Array.isArray(avatars) ? avatars.filter(Boolean) : [];
    if (!list.length) return;

    const c = ctx();
    const callGenericPopup = c.callGenericPopup;
    const POPUP_TYPE = c.POPUP_TYPE;
    if (!callGenericPopup || !POPUP_TYPE) {
        toast('Delete confirmation is unavailable.', true);
        return;
    }

    // Build the confirm body: warning + delete-chats checkbox. Plain DOM so the
    // character-count text is set safely and we can read the checkbox after.
    const wrap = document.createElement('div');
    const h = document.createElement('h3');
    h.className = 'marginBot5';
    h.textContent = `Delete ${list.length} character${list.length === 1 ? '' : 's'}?`;
    wrap.appendChild(h);

    const warn = document.createElement('div');
    warn.className = 'wl-cb-bulk-delnote';
    warn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ';
    const b = document.createElement('b');
    b.textContent = 'THIS IS PERMANENT!';
    warn.appendChild(b);
    wrap.appendChild(warn);

    const label = document.createElement('label');
    label.className = 'checkbox_label justifyCenter';
    label.style.marginTop = '1em';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const span = document.createElement('span');
    span.textContent = 'Also delete the chat files';
    label.append(cb, span);
    wrap.appendChild(label);

    const accepted = await callGenericPopup(wrap, POPUP_TYPE.CONFIRM);
    if (!accepted) return;
    const deleteChats = !!cb.checked;

    const mod = await loadScriptMod();
    const del = mod?.deleteCharacter;
    if (typeof del !== 'function') {
        toast('Delete is unavailable.', true);
        return;
    }

    // Optional ST loader for the (potentially slow) batch, best-effort.
    let loaderHandle = null;
    try {
        loaderHandle = c.loader?.show?.({
            slug: 'wl-cb-bulk-delete',
            title: 'Deleting characters',
            message: `Deleting ${list.length} character(s)…`,
            toastMode: c.loader?.ToastMode?.STATIC,
        });
    } catch { /* loader is optional */ }

    try {
        // deleteCharacter accepts an avatar array and deletes them together,
        // reloading characters[] itself.
        await del(list, { deleteChats });
        toast(`Deleted ${list.length} character${list.length === 1 ? '' : 's'}.`);
        onDone?.(list.length);
    } catch (err) {
        console.error('[BD] Char Browser: bulk delete failed.', err);
        toast('Delete failed — see console.', true);
        onDone?.(0);
    } finally {
        try { loaderHandle?.hide?.(); } catch { /* ignore */ }
    }
}

// ============================================================
// Shared helpers
// ============================================================

/**
 * Watch a popup's direct parent for its removal, firing `cb` ONCE when it goes
 * away (then self-disconnecting). Used to detect ST's bulk-tag popup close
 * (it offers no callback). If the node isn't present yet we still observe — the
 * popup is inserted synchronously by show(), so it's there by the time we run,
 * but observing is cheap and robust either way. A safety timeout disconnects a
 * stray observer after 2 minutes so it can never leak for a whole session.
 *
 * @param {string} id            element id to watch (without '#')
 * @param {() => void} cb         fired once, after the node is removed
 */
function watchPopupClose(id, cb) {
    const target = document.getElementById(id);
    let done = false;
    let observer = null;
    let safety = null;
    const finish = (notify = true) => {
        if (done) return;
        done = true;
        try { observer?.disconnect(); } catch { /* ignore */ }
        if (safety) clearTimeout(safety);
        popupWatchCancels.delete(cancel);
        if (notify) {
            try { cb?.(); } catch (err) { console.warn('[BD] Char Browser: popup-close hook threw.', err); }
        }
    };
    const cancel = (notify = false) => finish(notify);
    popupWatchCancels.add(cancel);

    observer = new MutationObserver(() => {
        // Fire as soon as the popup is no longer in the DOM.
        if (!target?.isConnected) finish();
    });
    try {
        // The popup is a direct child of this parent. Avoid a body-wide subtree
        // observer that wakes for every chat/render mutation while it is open.
        observer.observe(target?.parentNode || document.body, { childList: true });
    } catch (err) {
        console.warn('[BD] Char Browser: could not observe popup close; refreshing now.', err);
        // Fall back to an immediate-ish refresh so tag edits still land.
        setTimeout(finish, 0);
        return;
    }
    // Belt-and-suspenders: if the node was never there, don't hang forever.
    if (!target) setTimeout(() => { if (!document.getElementById(id)) finish(); }, 0);
    safety = setTimeout(finish, 2 * 60 * 1000);
}

/**
 * Best-effort toast via ST's global toastr (present in ST). Silent no-op if
 * toastr isn't available. `isError` routes to the error channel.
 */
function toast(message, isError = false) {
    try {
        const t = window.toastr;
        if (!t) return;
        if (isError) t.error(message);
        else t.success(message);
    } catch { /* toast is cosmetic */ }
}
