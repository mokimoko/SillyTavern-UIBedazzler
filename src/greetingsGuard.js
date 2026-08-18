// src/greetingsGuard.js
// Alternate-greetings wipe tripwire + restore.
//
// WHY THIS EXISTS: ST's /api/characters/edit endpoint is destructive-by-default
// for alternate greetings — the server writes [] whenever the POST body lacks
// the field (src/endpoints/characters.js, getAlternateGreetings). Client-side,
// greetings are only re-attached when, at the moment ANY edit-save fires,
// `characters[$('.open_alternate_greetings').data('chid')]?.data
// ?.alternate_greetings` is an array (public/script.js, edit branch of
// createOrEditCharacter). A stale/unseeded chid — e.g. after the characters[]
// array reindexes (rename / delete / import) while the editor is open, or a
// save racing a connection blip — silently attaches nothing and the server
// wipes the array on disk. First message survives (form scrape); greetings die
// (array attach). This module cannot fix ST core, but it can catch the wipe
// the instant it lands and offer a one-click restore from an in-memory copy.
//
// MECHANICS:
//   - Keep a per-character snapshot (keyed by avatar filename — stable across
//     characters[] reindexing, unlike numeric chid) of the last-seen greetings.
//   - Snapshot on CHAT_CHANGED (character load) and after every
//     CHARACTER_EDITED (post-save truth, emitted after getOneCharacter has
//     replaced the character object with what actually persisted).
//   - On CHARACTER_EDITED, BEFORE updating the snapshot: if the previous
//     snapshot had greetings and the fresh object has none, that's the wipe
//     fingerprint. Preserve a recovery copy (console + window.BD_lastGreetingsBackup),
//     then offer a native confirm popup to restore + re-save.
//   - Restore only re-saves through createOrEditCharacter when BOTH save-path
//     identifiers (#avatar_url_pole and .open_alternate_greetings data-chid)
//     currently resolve to the wiped character — otherwise a second save could
//     re-wipe or cross-write. If they don't match, restore in memory only and
//     tell the user how to persist.
//   - Intentional "delete the last greeting" ops call suppressNextGreetingsEmpty()
//     (drawerUI's delete handler) so they don't trip the alarm. ST's NATIVE
//     alt-greetings popup can't be hooked without patching core, so deleting
//     the last greeting there will show one (dismissible) false-positive prompt.
//
// Always on: registered once at init, passive (two event listeners + a Map),
// no DOM footprint until a wipe is actually detected.

import { eventSource, event_types, createOrEditCharacter } from '../../../../../script.js';

const log = () => {};

// ============================================================
// State
// ============================================================

/** @type {Map<string, string[]>} avatar filename → last-seen greetings copy */
const snapshots = new Map();

/** Epoch ms until which an empty-after-save is treated as intentional. */
let suppressUntil = 0;

/** Re-entrancy guard: one wipe prompt at a time (restore itself re-emits
 *  CHARACTER_EDITED via createOrEditCharacter). */
let prompting = false;

// ============================================================
// Context helpers
// ============================================================

/** ST public context or null (mirrors drawerUI's defensive accessor). */
function getSTContext() {
    try {
        // eslint-disable-next-line no-undef
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            return SillyTavern.getContext();
        }
    } catch (e) { /* fall through */ }
    return null;
}

/** Greetings array of a character object, normalized to a real array. */
function greetingsOf(char) {
    const arr = char?.data?.alternate_greetings;
    return Array.isArray(arr) ? arr : [];
}

// ============================================================
// Public API
// ============================================================

/**
 * Mark the next empty-greetings save as intentional (the user deleted the last
 * greeting on purpose). Short TTL: the delete's own save lands well inside it.
 */
export function suppressNextGreetingsEmpty() {
    suppressUntil = Date.now() + 8000;
}

export function initGreetingsGuard() {
    eventSource.on(event_types.CHAT_CHANGED, snapshotCurrentCharacter);
    eventSource.on(event_types.CHARACTER_EDITED, onCharacterEdited);
    log('Greetings guard armed');
}

/** Record the currently-loaded character's greetings as ground truth. */
function snapshotCurrentCharacter() {
    const ctx = getSTContext();
    const char = ctx?.characters?.[ctx.characterId];
    if (!char?.avatar) return;
    snapshots.set(char.avatar, greetingsOf(char).slice());
}

// ============================================================
// Detection
// ============================================================

/**
 * Post-save check. CHARACTER_EDITED is emitted AFTER getOneCharacter() has
 * replaced characters[i] with server truth, so `fresh` here is exactly what
 * hit the disk.
 */
async function onCharacterEdited(payload) {
    const ctx = getSTContext();
    if (!ctx) return;

    const id = payload?.detail?.id;
    const char = payload?.detail?.character || ctx.characters?.[id];
    const avatar = char?.avatar;
    if (!avatar) return;

    const fresh = greetingsOf(char);
    const prev = snapshots.get(avatar);

    const wiped = Array.isArray(prev) && prev.length > 0 && fresh.length === 0;
    const suppressed = Date.now() < suppressUntil;

    if (!wiped || prompting) {
        snapshots.set(avatar, fresh.slice());
        return;
    }
    if (suppressed) {
        suppressUntil = 0; // consume the one intentional empty
        snapshots.set(avatar, []);
        return;
    }

    // WIPE DETECTED. Preserve recovery copies FIRST, unconditionally — the
    // prompt can be dismissed, the tab can crash, but these survive.
    const backup = prev.slice();
    // eslint-disable-next-line no-undef
    window.BD_lastGreetingsBackup = { avatar, greetings: backup, when: new Date().toISOString() };
    console.warn(
        `[UIBedazzler greetings-guard] ${backup.length} alternate greeting(s) for "${char.name || avatar}" `
        + 'came back EMPTY from a save. Recovery copy at window.BD_lastGreetingsBackup. JSON:\n'
        + JSON.stringify(backup),
    );

    prompting = true;
    try {
        let ok = false;
        if (typeof ctx.callGenericPopup === 'function' && ctx.POPUP_TYPE) {
            ok = await ctx.callGenericPopup(
                `<h3>Alternate greetings vanished</h3>
                <p>A save for <b>${escapeHtml(char.name || avatar)}</b> just came back with
                <b>0</b> alternate greetings — it had <b>${backup.length}</b> a moment ago.
                This is the known ST save race (greetings fail to re-attach to the save
                request and the server writes an empty list).</p>
                <p>Restore the ${backup.length} greeting(s) from memory?</p>
                <small>A recovery copy is also in the browser console and at
                <code>window.BD_lastGreetingsBackup</code>.</small>`,
                ctx.POPUP_TYPE.CONFIRM,
                '',
                { okButton: 'Restore them', cancelButton: 'Leave empty' },
            );
        }
        if (ok) {
            await restoreGreetings(avatar, backup);
        } else {
            snapshots.set(avatar, []); // user accepted the empty state
        }
    } finally {
        prompting = false;
    }
}

// ============================================================
// Restore
// ============================================================

/**
 * Put the backup array onto the character and persist it — but only re-save
 * through ST when it's provably safe. ST's edit-save targets the file named by
 * #avatar_url_pole and attaches greetings from characters[data-chid]; we
 * require BOTH to resolve to the wiped character before calling
 * createOrEditCharacter(), otherwise a blind re-save could wipe again (the
 * exact failure we're recovering from) or write onto the wrong character.
 */
async function restoreGreetings(avatar, backup) {
    const ctx = getSTContext();
    const idx = ctx?.characters?.findIndex(c => c?.avatar === avatar);
    if (idx === undefined || idx === null || idx < 0) {
        // eslint-disable-next-line no-undef
        toastr.error('Could not find the character in memory. Recovery copy is at window.BD_lastGreetingsBackup.', 'Greetings guard');
        return;
    }

    const char = ctx.characters[idx];
    if (!char.data) char.data = {};
    char.data.alternate_greetings = backup.slice();
    snapshots.set(avatar, backup.slice());

    // Safety gate for the persisting re-save: both save-path identifiers must
    // point at THIS character, and we must be in edit (not create) context.
    let chidTarget;
    try {
        // eslint-disable-next-line no-undef
        chidTarget = jQuery('.open_alternate_greetings').data('chid');
    } catch (e) { /* leave undefined */ }
    const avatarPole = document.getElementById('avatar_url_pole')?.value;
    const safeToSave = ctx.menuType !== 'create'
        && ctx.characters?.[chidTarget]?.avatar === avatar
        && avatarPole === avatar;

    if (safeToSave) {
        try {
            await createOrEditCharacter();
            // eslint-disable-next-line no-undef
            toastr.success(`Restored ${backup.length} alternate greeting(s) and saved.`, 'Greetings guard');
            return;
        } catch (e) {
            console.error('[UIBedazzler greetings-guard] restore save failed', e);
        }
    }

    // In-memory restore only: the editor isn't currently pointing at this
    // character (or the save failed), so a forced save would be unsafe. The
    // restored array WILL persist with that character's next normal save.
    // eslint-disable-next-line no-undef
    toastr.warning(
        'Greetings restored in memory, but not yet saved to disk. Open this character in the editor and make any small edit to persist them.',
        'Greetings guard',
        { timeOut: 12000 },
    );
}

/** Minimal HTML escaper for the popup (character names are user data). */
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
