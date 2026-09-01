// src/charBrowser/actions.js
// Character Browser — the ST bridge for the detail-panel action buttons
// (Open Chat / open a specific chat / Edit). This is the ONLY char-browser
// module that reaches into ST's character-selection + chat pipeline and into
// the expanded EDIT drawer (CDE). Keeping it isolated here means detail.js
// stays pure DOM and the shell stays layout-only.
//
// PHASE 3 SCOPE (PLAN): Open Chat (most-recent, closes the browser) · open a
// specific chat from the picker (closes the browser) · Edit (select the char,
// close the browser, open the CDE for it). Duplicate/Export/Delete are deferred
// per the PLAN pending feasibility.
//
// WHY select-then-act: ST has no "open chat without selecting". selectCharacterById
// loads the character AND opens characters[id].chat (its most-recent chat) as a
// side effect — that IS "Open Chat → most recent". For a specific chat we select
// first (so this_chid + the char dir are right) then openCharacterChat(file).
// For Edit we select (which loads the char + its chat behind the drawer, standard
// ST behavior) then hand off to the CDE takeover.

// The CDE takeover — same entry the native expand button uses. Importing it here
// is the browser→edit bridge the PLAN calls for.
import { takeoverExpanded, isExpandedActive } from '../charDrawerExpanded/index.js';
// Group open pipeline. openGroupById isn't on getContext() (openGroupChat is),
// so import it directly — same six-levels-up path drawerUI uses for the group-
// create flow.
import { openGroupById } from '../../../../../../scripts/group-chats.js';

const log = () => {};

function ctx() {
    return SillyTavern.getContext();
}

// ============================================================
// Open Chat
// ============================================================

/**
 * Open the character's MOST-RECENT chat and close the browser.
 *
 * selectCharacterById(index) loads the char and, via getChat(), opens
 * characters[index].chat — the last-used chat file ST already tracks. That's
 * exactly "Open Chat → most recent", so no explicit chat file is needed here.
 *
 * @param {object} model   the view-model (needs `index`)
 * @param {() => void} closeBrowser  shell's restoreCharBrowser
 */
export async function openMostRecentChat(model, closeBrowser) {
    if (!model || model.index == null) return;
    try {
        await ctx().selectCharacterById(model.index);
        closeBrowser?.();
    } catch (err) {
        console.error('[BD] Char Browser: Open Chat failed.', err);
    }
}

/**
 * Open a SPECIFIC chat (from the picker) and close the browser. We select the
 * character first so this_chid + the character directory are correct, then ask
 * ST to switch to the chosen file. `file` must be WITHOUT the .jsonl extension
 * (charData.getCharacterChats already strips it).
 *
 * If `file` is empty/falsy we fall back to most-recent (same as Open Chat) so a
 * malformed picker value can't leave the user on the wrong chat.
 *
 * @param {object} model
 * @param {string} file   chat file name, no extension
 * @param {() => void} closeBrowser
 */
export async function openSpecificChat(model, file, closeBrowser) {
    if (!model || model.index == null) return;
    try {
        const c = ctx();
        await c.selectCharacterById(model.index);
        if (file) {
            await c.openCharacterChat(file);
        }
        closeBrowser?.();
    } catch (err) {
        console.error('[BD] Char Browser: open specific chat failed.', err);
    }
}

// ============================================================
// Edit (browser → CDE)
// ============================================================

/**
 * Bridge to the expanded EDIT drawer for a character: select it (which loads
 * the char + opens its most-recent chat behind the drawer — standard ST), close
 * the browser, then open the CDE takeover.
 *
 * TIMING: selectCharacterById is async and ST populates #form_create's fields
 * (which the CDE relocates) as part of selection. We await the selection, close
 * the browser, then defer the CDE takeover to the next frame so the form is
 * fully populated before the CDE captures/relocates those nodes. Without the
 * defer the CDE could grab a half-populated form.
 *
 * @param {object} model
 * @param {() => void} closeBrowser
 */
export async function editCharacter(model, closeBrowser) {
    if (!model || model.index == null) return;
    try {
        await ctx().selectCharacterById(model.index);
        closeBrowser?.();
        // Let ST finish painting the form_create fields before the CDE relocates
        // them. rAF (two, to be safe past ST's own rAF) then open.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!isExpandedActive()) takeoverExpanded();
        }));
    } catch (err) {
        console.error('[BD] Char Browser: Edit bridge failed.', err);
    }
}

// ============================================================
// Groups — open a group chat (browser → ST group pipeline)
// ============================================================

/**
 * Open a group's chat and close the browser. With no `chatId` (or the current
 * one) we use openGroupById, which loads the group's active chat (group.chat_id)
 * — the group analogue of "Open Chat → most recent". A specific past chat routes
 * through ST's openGroupChat(groupId, chatId) (on getContext()), which switches
 * the group's active chat then loads it. Either way the browser closes on
 * success, matching the character detail panel's Open Chat.
 *
 * @param {object} model   the group view-model (needs `id`; `currentChat` used to
 *                         short-circuit a redundant switch)
 * @param {string} [chatId]  a specific chat id from the picker; omitted/empty or
 *                         equal to the current chat → open the active chat
 * @param {() => void} closeBrowser  shell's restoreCharBrowser
 */
export async function openGroup(model, chatId, closeBrowser) {
    if (!model || !model.id) return;
    try {
        const c = ctx();
        if (chatId && chatId !== model.currentChat && typeof c.openGroupChat === 'function') {
            await c.openGroupChat(model.id, chatId);
        } else {
            await openGroupById(model.id);
        }
        closeBrowser?.();
    } catch (err) {
        console.error('[BD] Char Browser: open group failed.', err);
    }
}
