// src/charDrawerExpanded/drawerUI.js
// Expanded Character Drawer — full 3-column takeover via DOM relocation.
// Namespace: wl-xd-  (distinct from classic charDrawer's wl-cd-)
//
// Same proven relocate-don't-clone pattern as charDrawer/drawerUI.js and
// personaLore/drawerUI.js: we MOVE ST's real elements into our layout
// (preserving every event handler, token counter, and expand button), hide
// the originals' containers, and restore everything cleanly on close.
//
// PHASE 1 SCOPE: 3-column shell + left identity column + Basics(Description)
// tab + right column hosting ST's character list. Remaining center tabs
// (Additional Info / Greetings / Design / Prompts / Metadata) are scaffolded
// as empty panes and filled in later phases.

// Direct save for STRUCTURAL greeting ops (add/delete/reorder), mirroring ST's
// native alt-greetings popup (which calls createOrEditCharacter() on delete/
// reorder). SAFE ONLY because we set form="form_create" on every relocated
// named form control at relocation time — createOrEditCharacter builds its
// FormData from `new FormData(#form_create)`, which by HTML spec includes
// controls associated via the form= attribute even when they're not DOM
// descendants of the form. Without that association, relocated fields
// (Description, First Message) fall out of the scrape and get saved BLANK.
// See ensureFormAssociation() / clearFormAssociation().
import { createOrEditCharacter } from '../../../../../../script.js';

// COEXISTENCE: the classic Character Drawer takeover (wl-cd-) and this
// expanded drawer relocate the SAME #character_popup fields. Both toggles may
// now be enabled at once; ownership is arbitrated by the expanded drawer's
// open/closed state. On open we ask classic to RELEASE (restore its borrowed
// nodes to their native popup positions) BEFORE capturing any refs — so our
// restore returns fields to their true homes, never into a dead wl-cd- pane.
// On close we invite classic to RE-TAKE (no-op unless its toggle is on and the
// popup is visible; otherwise its own watcher re-takes on next popup open).
// Import direction is strictly expanded → classic; classic knows nothing about
// this module (it only checks the wl-xd-open body class as a guard).
import { releaseCharDrawer, retakeCharDrawer } from '../charDrawer/index.js';

// The Design tab is UIBedazzler's OWN UI (not a relocation): renderDesignTab()
// builds fresh, stateless markup + handlers into whatever pane it's given.
// Sharing it with classic is safe under one-owner-at-a-time: classic's pane is
// destroyed when it releases (container.remove()), and ours dies with our
// container on close — the duplicate wl-cd- IDs never coexist.
import { renderDesignTab } from '../charDrawer/designTab.js';

// Greetings-wipe tripwire coordination: when the user intentionally deletes
// the LAST alternate greeting, the guard would otherwise see "had N, now 0
// after a save" — the exact wipe fingerprint — and prompt to restore. Tell it
// the next empty state is expected. (See src/greetingsGuard.js.)
import { suppressNextGreetingsEmpty } from '../greetingsGuard.js';

// "Back to Character Browser" link (top-left of the expanded drawer). Clicking
// it closes THIS drawer (restoring every relocated ST node to its native home)
// and opens the full Character Browser takeover. We go through a full close
// first — never overlap the two takeovers — because both relocate ST DOM
// (the browser moves the top-bar action buttons; the expanded drawer moves
// #form_create fields). Sequencing close→open keeps each takeover's relocation
// ledger clean and avoids two overlays fighting over the same nodes.
import { takeoverCharBrowser, isCharBrowserActive, isCharBrowserEnabled } from '../charBrowser/index.js';

// Per-character "title" (subtitle) — a Bedazzler-only field stored in the shared
// sidecar (keyed by avatar), NOT on the card, so it never touches {{char}}. The
// expanded drawer is where it's EDITED (below the name); the browser cards show
// it read-only. ensureSidecarLoaded/onSidecarLoaded let the field fill in if the
// drawer opens before the sidecar has resolved.
import {
    getCharTitle,
    setCharTitle,
    MAX_TITLE_LEN,
    ensureSidecarLoaded as ensureTitlesLoaded,
    isSidecarLoaded as titlesLoaded,
    onSidecarLoaded as onTitlesLoaded,
} from '../charTitles.js';
import { getCharacterAvatarUrl, isTauriHost } from '../hostAdapter.js';

const log = () => {};

// ST form controls we relocate OUT of #form_create. Each must carry
// form="form_create" while relocated so createOrEditCharacter's FormData scrape
// still includes it. Restored (attribute removed) on close. This list is the
// safety-critical set: any named field we move must be here or it saves blank.
const FORM_ASSOCIATED_IDS = [
    'description_textarea',
    'firstmessage_textarea',
    // #create_button is an <input type="submit"> — ST's ENTIRE text-edit save
    // path runs through it: saveCharacterDebounced = debounce(() =>
    // $('#create_button').trigger('click')), and the actual save is bound to
    // the FORM's submit event ($('#form_create').on('submit', ... createOrEditCharacter)).
    // A submit input only fires its form's submit event via form ownership
    // (DOM ancestry OR a form= attribute). We relocate #avatar_controls — which
    // CONTAINS #create_button — out to <body>, severing that ancestry. Without
    // re-associating it, every debounced save clicks a button that submits
    // nothing: createOrEditCharacter never runs, so NOTHING reaches disk while
    // the drawer is open. (Edits only appeared to persist because the same
    // textarea DOM node still held the typed value on reopen; a page reload or
    // select_selected_character re-read from the unchanged character object and
    // reverted them.) Restoring form ownership here makes ST's native save work
    // again. NOTE: structural greeting ops were unaffected because they call
    // createOrEditCharacter() directly via saveNow(), bypassing this path.
    'create_button',
    // #character_name_pole (name="ch_name") — natively inside #name_div in
    // #form_create. In CREATE mode we relocate #name_div into the left column
    // (the h2 display name is stale there and the input is the only way to name
    // the character), severing its form ancestry — without this association the
    // create POST would carry NO NAME. In edit mode the field isn't relocated,
    // so the attribute is redundant-but-harmless (and restored off on close).
    'character_name_pole',
    // #add_avatar_button (name="avatar") — the hidden file input inside
    // #avatar_div_div, which BOTH modes relocate into the portrait slot. The
    // create/edit POST reads the picked avatar file from the FormData scrape;
    // severed ancestry silently drops it (create lands on the default avatar
    // even when the user picked an image, edits ignore a newly-picked file).
    'add_avatar_button',
];

let isActive = false;
// TRUE when this takeover is hosting ST's CREATE-CHARACTER flow (menuType ===
// 'create' at takeover time) rather than an edit session. Create mode changes
// the left column (name INPUT instead of the stale display h2), hides tabs that
// need an existing character (Gallery, Design), and adds the authored "Create
// Character" button. Captured once per takeover — the mode can't flip mid-open
// except through our own post-create handoff, which closes + reopens.
let createModeActive = false;
// Each record is either:
//   { element, originalParent, originalNext }  — a moved node to put back, or
//   { element, style, original }               — an inline-style change to undo.
let relocatedElements = [];
let container = null;

// Greetings tab state. The alt-greetings sub-tab strip is authored chrome (not
// relocated ST nodes), rebuilt from ST's data array on every mutation. We track
// which sub-tab is selected across re-renders. 0 = First Message (locked);
// 1..N map to alternate_greetings[0..N-1].
let greetActiveSub = 0;

// Gallery tab state. The grid + viewer are AUTHORED chrome (net-new markup we
// build, NOT relocated ST nodes), so they die with the container on close and
// need no ledger entries. `galleryLoaded` gates the lazy first fetch: false
// until the user opens the tab (or after a character switch resets it), true
// once the grid has rendered for the current character. `galleryMedia` caches
// the resolved media list ({name,url,type}) for the open viewer's prev/next
// navigation. `galleryViewerKeyHandler` is the ONLY document-level listener the
// gallery adds; we track it so restore()/viewer-close can detach it (everything
// else lives inside the container and dies with it).
let galleryLoaded = false;
let galleryMedia = [];
let galleryViewerKeyHandler = null;
const GALLERY_BATCH_SIZE = 36;
let galleryVisibleLimit = GALLERY_BATCH_SIZE;
let galleryLoadGeneration = 0;
let galleryAbortController = null;
// Cached list of all gallery folder names (from POST /api/images/folders),
// fetched once per takeover to feed the folder-input autocomplete dropdown.
let galleryFolderList = [];
// Delete mode: when true, clicking a tile deletes it (delete mode is the guard,
// mirroring ST's native gallery) instead of opening the viewer. Reset whenever
// the gallery reloads, the character switches, or the drawer is taken over.
let galleryDeleteMode = false;
// Set-avatar mode: when true, clicking a tile sets that image as the character's
// avatar (routed through ST's native crop -> edit-avatar flow) instead of opening
// the viewer. Mutually exclusive with delete mode. Reset on the same lifecycle
// events as delete mode (reload / character switch / drawer takeover).
let gallerySetAvatarMode = false;

// ============================================================
// Public state
// ============================================================

export function isExpandedActive() {
    return isActive;
}

// ============================================================
// Relocation helpers
// ============================================================

/**
 * SAFETY-CRITICAL. Associate every relocated named form control with
 * #form_create via the HTML `form=` attribute, so it's still included when ST
 * builds `new FormData(#form_create)` in createOrEditCharacter — even though the
 * control is no longer a DOM descendant of the form.
 *
 * Without this, relocating Description / First Message out of #form_create drops
 * them from the save scrape and ST writes BLANK over them. We record the prior
 * `form` attribute value (usually none) so restore() can put it back exactly.
 *
 * Called at the START of takeover, before any save can be triggered.
 */
function ensureFormAssociation() {
    for (const id of FORM_ASSOCIATED_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        // Record + set via the same relocatedElements ledger (attr record type).
        relocatedElements.push({ element: el, attr: 'form', original: el.getAttribute('form') });
        el.setAttribute('form', 'form_create');
    }
}

/**
 * Move a DOM element into a new parent, remembering where it came from so
 * restore() can put it back at the exact same spot.
 */
function relocate(element, newParent) {
    if (!element || !newParent) return;
    relocatedElements.push({
        element,
        originalParent: element.parentElement,
        originalNext: element.nextElementSibling,
    });
    newParent.appendChild(element);
}

/**
 * Hide an element via inline style, remembering the prior value to restore.
 */
function hideElement(element) {
    if (!element) return;
    relocatedElements.push({ element, style: 'display', original: element.style.display });
    element.style.display = 'none';
}

/**
 * Add helper classes to a relocated ST node and record them so restore() can
 * strip them, returning the node pristine. Only removes classes we added
 * (guards against removing a class ST already had by the same name).
 */
function markForClassCleanup(element, classes) {
    if (!element) return;
    const added = classes.filter(c => !element.classList.contains(c));
    added.forEach(c => element.classList.add(c));
    if (added.length) relocatedElements.push({ element, classes: added });
}

// ============================================================
// Shell markup
// ============================================================

/**
 * Build the empty 3-column shell. Columns are filled by relocation afterward.
 * Only structural wrappers + our own tab/subtab chrome are authored here —
 * every actual field/control is a relocated ST element.
 */
function buildShell() {
    const root = document.createElement('div');
    root.id = 'wl-xd-root';
    root.innerHTML = `
        <aside id="wl-xd-left">
            <div class="wl-xd-toprow">
                <button type="button" id="wl-xd-browser-link" title="Back to the Character Browser">
                    <i class="fa-solid fa-arrow-left"></i>
                </button>
                <div id="wl-xd-actions-slot" class="wl-xd-actions-row"></div>
            </div>
            <div class="wl-xd-left-header">
                <div id="wl-xd-portrait-slot" class="wl-xd-portrait-slot"></div>
                <div id="wl-xd-identity-slot" class="wl-xd-identity">
                    <div id="wl-xd-name-slot"></div>
                    <div id="wl-xd-title-slot"></div>
                    <!-- Optional host for the SillyTavern-Nicknames char editor
                         (#nickname_editor_char), relocated here in edit mode
                         when that extension is installed. Empty otherwise. -->
                    <div id="wl-xd-nickname-slot"></div>
                    <div id="wl-xd-tokens-slot"></div>
                    <div id="wl-xd-options-slot"></div>
                    <!-- The identity column deliberately ends here. The "More"
                         dropdown + tag hub + tag pills moved DOWN into
                         #wl-xd-belowavatar (below the header) per user request.
                         The gap left beside the portrait is intentionally kept
                         empty for a future feature — do NOT reflow content up
                         to fill it. -->
                </div>
            </div>
            <!-- Below-avatar strip: hosts the relocated "More" dropdown
                 (#char-management-dropdown, pulled out of #avatar_controls) and
                 the tag hub + pills (#tags_div), stacked in that order. This is
                 the space the Creator's Notes display drawer used to occupy
                 before it moved to the right column. -->
            <div id="wl-xd-belowavatar">
                <div id="wl-xd-more-slot"></div>
                <div id="wl-xd-tags-slot"></div>
            </div>
        </aside>

        <main id="wl-xd-center">
            <div id="wl-xd-tab-bar">
                <button class="wl-xd-tab active" data-tab="basics"><i class="fa-solid fa-user"></i><span>Basics</span></button>
                <button class="wl-xd-tab" data-tab="addinfo"><i class="fa-solid fa-circle-plus"></i><span>Additional Info</span></button>
                <button class="wl-xd-tab" data-tab="greetings"><i class="fa-solid fa-hand"></i><span>Greetings</span></button>
                <button class="wl-xd-tab" data-tab="design"><i class="fa-solid fa-palette"></i><span>Design</span></button>
                <button class="wl-xd-tab" data-tab="gallery"><i class="fa-solid fa-images"></i><span>Gallery</span></button>
                <button class="wl-xd-tab" data-tab="prompts"><i class="fa-solid fa-terminal"></i><span>Prompts</span></button>
                <button class="wl-xd-tab" data-tab="metadata"><i class="fa-solid fa-circle-info"></i><span>Metadata</span></button>
            </div>
            <div id="wl-xd-tab-content">
                <div class="wl-xd-pane active" data-tab="basics"></div>
                <div class="wl-xd-pane" data-tab="addinfo"></div>
                <div class="wl-xd-pane" data-tab="greetings"></div>
                <div class="wl-xd-pane" data-tab="design"></div>
                <div class="wl-xd-pane" data-tab="gallery"></div>
                <div class="wl-xd-pane" data-tab="prompts"></div>
                <div class="wl-xd-pane" data-tab="metadata"></div>
            </div>
        </main>

        <aside id="wl-xd-right">
            <div class="wl-xd-right-top">
                <button class="wl-xd-close" id="wl-xd-close" title="Close expanded drawer">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div id="wl-xd-notes-slot"></div>
        </aside>
    `;
    return root;
}

// ============================================================
// Takeover
// ============================================================

/**
 * Activate the expanded drawer. Builds the shell, appends it to <body> as a
 * full-viewport overlay, then relocates ST's real elements into it.
 *
 * Sources (see handoff DOM inventory):
 *   #rm_ch_create_block > #form_create  → left column + center tabs +
 *                                         right column (Creator's Notes)
 *   #character_popup                     → center tabs
 */
export function takeoverExpanded() {
    if (isActive) return;
    if (document.getElementById('wl-xd-root')) return;

    // HOSTABILITY GUARD (belt-and-braces; callers route already — see
    // expandTarget in index.js). #form_create is only meaningfully bound in
    // two menu states: 'create' (seeded create form) and 'character_edit'
    // (populated for the loaded character). Any other state — notably
    // 'characters' after backing out of a native create, which leaves stale
    // create leftovers in the form while a character is still loaded — must
    // never be hosted: an edit-layout takeover there could scrape those
    // leftovers into a save over the loaded character.
    const menuType = getSTContext()?.menuType;
    if (menuType !== 'create' && menuType !== 'character_edit') {
        console.warn(`[BD] Expanded drawer: refusing takeover in menuType '${menuType}' — form not bound.`);
        return;
    }

    const formCreate = document.getElementById('form_create');
    if (!formCreate) {
        log('form_create not found — aborting expanded takeover');
        return;
    }

    // COEXISTENCE — MUST RUN BEFORE ANY REF CAPTURE. If the classic takeover
    // is holding #character_popup's fields in its wl-cd- panes, restore them
    // to their native positions first, so every originalParent/originalNext we
    // record below points at the field's TRUE home. (Classic's watcher stays
    // armed, but the wl-xd-open body class we set later this same task guards
    // its observer microtask from re-grabbing.)
    releaseCharDrawer();

    relocatedElements = [];
    // CREATE vs EDIT: read ST's menu state ONCE at takeover. The New Character
    // entry (browser or native) runs select_rm_create() BEFORE we open, so
    // menuType is already 'create' and #form_create holds the seeded create
    // fields — the same nodes we relocate either way.
    createModeActive = getSTContext()?.menuType === 'create';
    // Fresh gallery state per takeover: force a lazy re-fetch on first open of
    // the Gallery tab for whatever character is loaded now.
    galleryLoaded = false;
    galleryMedia = [];
    galleryVisibleLimit = GALLERY_BATCH_SIZE;
    galleryLoadGeneration++;
    galleryAbortController?.abort();
    galleryAbortController = null;
    galleryFolderList = [];
    galleryDeleteMode = false;
    gallerySetAvatarMode = false;
    container = buildShell();
    // Curtain down while we shuffle the DOM.
    container.style.visibility = 'hidden';
    document.body.appendChild(container);

    // SAFETY FIRST: associate relocated named fields with #form_create BEFORE
    // moving anything, so any save (even one fired mid-takeover) still scrapes
    // Description / First Message instead of writing them blank.
    ensureFormAssociation();

    relocateLeftColumn(formCreate);
    relocateBasics(formCreate);
    relocateAdditionalInfo();
    relocateGreetings(formCreate);
    relocatePrompts();
    relocateMetadata();
    buildGalleryPane();
    relocateRightColumn(formCreate);

    // Create-mode chrome LAST (after relocations): hides create-inapplicable
    // tabs, swaps in the authored Create Character button. No-op in edit mode.
    if (createModeActive) applyCreateModeChrome();

    wireChrome();

    document.body.classList.add('wl-xd-open');
    isActive = true;

    requestAnimationFrame(() => {
        if (container) container.style.visibility = '';
    });

    log('Expanded takeover applied');
}

// ============================================================
// Column relocation (Phase 1)
// ============================================================

/**
 * LEFT column — identity block.
 * Portrait from #form_create, DISPLAY name from #rm_button_selected_ch (the h2
 * that already truncates), token counts from #result_info_text (Total +
 * Permanent), action buttons, options dropdown, tags, and the Creator's Notes
 * display drawer.
 *
 * The editable name input (#name_div / #character_name_pole) stays in
 * #form_create — it'll move to a center tab in a later phase.
 */

/**
 * Given the src ST sets on #avatar_load_preview, return the FULL-RESOLUTION
 * equivalent — or null if it isn't an ST avatar thumbnail we should touch.
 *
 * ST points the preview at `/thumbnail?type=avatar&file=<avatar>` (optionally
 * with a `t=<ts>` cache-buster), a small (~96px) image that looks fuzzy scaled
 * up to the 140px portrait. The full-res original lives at `/characters/<avatar>`
 * — the same path ST uses for its own zoomed-avatar view (script.js: charsPath +
 * targetAvatarImg). We reuse the exact `file=` token (already URL-encoded) so
 * encoding matches ST, and carry any `t=` buster across so a post-avatar-edit
 * refresh still busts the full-res load.
 *
 * Returns null for anything that ISN'T an avatar thumbnail — data URLs (a fresh
 * crop), `/img/` defaults, and already-upgraded `/characters/` srcs — so the
 * observer that calls this can't loop (setting a `/characters/` src yields null
 * on the next pass).
 */
function fullResPreviewSrc(src) {
    // TauriTavern has no dependable /characters/<avatar> static route. Its
    // thumbnail URL is already the host-supported representation, so leave it.
    if (isTauriHost()) return null;
    if (!src || src.indexOf('/thumbnail?') === -1) return null;
    if (!/[?&]type=avatar(?:&|$)/.test(src)) return null;
    const fileM = src.match(/[?&]file=([^&]*)/);
    if (!fileM || !fileM[1]) return null;
    const tM = src.match(/[?&]t=(\d+)/);
    let avatar = fileM[1];
    try { avatar = decodeURIComponent(avatar); } catch { /* keep encoded token */ }
    return getCharacterAvatarUrl(avatar, null, tM?.[1] ?? null);
}

/**
 * Upgrade the relocated avatar preview to full resolution and keep it that way.
 * ST re-points #avatar_load_preview at a fresh thumbnail on every character
 * switch and after each avatar edit, so a one-shot swap wouldn't hold — we watch
 * the img's `src` attribute and re-upgrade whenever ST touches it. Setting the
 * src to a `/characters/` URL doesn't re-trigger an upgrade (fullResPreviewSrc
 * returns null for non-thumbnail srcs), so there's no observer loop. The watcher
 * is scoped to the single img and torn down in restoreExpanded().
 */
function setupPortraitPreviewQuality() {
    const preview = document.getElementById('avatar_load_preview');
    if (!(preview instanceof HTMLImageElement)) return;

    const upgrade = () => {
        const better = fullResPreviewSrc(preview.getAttribute('src') || '');
        if (better && preview.getAttribute('src') !== better) preview.setAttribute('src', better);
    };

    upgrade(); // fix whatever's showing right now
    if (portraitPreviewObserver) portraitPreviewObserver.disconnect();
    portraitPreviewObserver = new MutationObserver(upgrade);
    portraitPreviewObserver.observe(preview, { attributes: true, attributeFilter: ['src'] });
}

function relocateLeftColumn(formCreate) {
    const portraitSlot = container.querySelector('#wl-xd-portrait-slot');
    const nameSlot = container.querySelector('#wl-xd-name-slot');
    const tokensSlot = container.querySelector('#wl-xd-tokens-slot');
    const actionsSlot = container.querySelector('#wl-xd-actions-slot');
    const optionsSlot = container.querySelector('#wl-xd-options-slot');
    const moreSlot = container.querySelector('#wl-xd-more-slot');
    const tagsSlot = container.querySelector('#wl-xd-tags-slot');

    // CAPTURE EVERY REF BEFORE MOVING ANYTHING. Some sources are nested
    // (#avatar_controls lives inside #avatar_div): querying after a parent
    // has been relocated returns null. This bug shipped once — the controls
    // got trapped inside the 140px portrait slot. Refs first, always.
    // NOTE: the Creator's Notes display drawer (#spoiler_free_desc) is NOT
    // handled here anymore — it now lives in the RIGHT column (where the
    // recreated character list used to be). See relocateRightColumn().
    const avatarLabel = formCreate.querySelector('#avatar_div_div');
    const avatarControls = formCreate.querySelector('#avatar_controls');
    const dupeBtn = formCreate.querySelector('#dupe_button');
    const deleteBtn = formCreate.querySelector('#delete_button');
    const tagsDiv = formCreate.querySelector('#tags_div');
    // "More…" dropdown (#char-management-dropdown). It's the <select> ST wraps
    // in a <label> inside #avatar_controls. We relocate JUST this dropdown DOWN
    // to the below-avatar strip (per user request), leaving the icon-buttons
    // block behind in #wl-xd-options-slot. Move the wrapping <label> so its
    // native styling/hit-target travels intact; fall back to the select itself
    // if ST ever drops the label wrapper. Ref captured now (golden rule);
    // #avatar_controls relocates first below, and this node rides along inside
    // it until we pull it back out into #wl-xd-more-slot.
    const moreDropdown = formCreate.querySelector('#char-management-dropdown');
    const moreWrap = moreDropdown ? (moreDropdown.closest('#avatar_controls label') || moreDropdown) : null;
    const advancedBtn = formCreate.querySelector('#advanced_div');
    const backBtn = formCreate.querySelector('#rm_button_back');

    // Display name + token counts live in #right-nav-panel-tabs (NOT in
    // #form_create). #rm_button_selected_ch holds the h2 display name (already
    // truncation-friendly). #result_info_text holds the Total/Permanent token
    // counts. We grab these from document, not formCreate.
    const selectedChName = document.getElementById('rm_button_selected_ch');
    const tokenInfo = document.getElementById('result_info_text');
    // CREATE mode: the editable name input (#name_div, holding
    // #character_name_pole) replaces the h2 — the h2 still shows the PREVIOUS
    // character (select_rm_create never touches it) and the input is the only
    // way to name the new character. Ref captured here per the golden rule;
    // relocated below only in create mode (edit keeps it hidden in the form,
    // reserved for a later center-tab phase).
    const nameDiv = formCreate.querySelector('#name_div');

    // Portrait: ONLY the avatar label (#avatar_div_div: preview img + file
    // input) — not the whole #avatar_div wrapper, whose width:100% flex-wrap
    // styling fights the fixed 140px slot.
    relocate(avatarLabel, portraitSlot);

    // ST feeds the preview a low-res avatar THUMBNAIL, which looks fuzzy blown
    // up to the 140px portrait. Upgrade it to the full-resolution image and keep
    // it upgraded across character switches / avatar edits.
    setupPortraitPreviewQuality();

    // Identity column (right of the portrait), top to bottom:
    //   name → tokens → icon buttons + dropdown → tag search/pills.
    // DISPLAY name (h2) + token counts. NOT the editable #name_div input —
    // that stays in #form_create (hidden) for a later center-tab phase.
    relocate(selectedChName, nameSlot);
    relocate(tokenInfo, tokensSlot);

    // CREATE mode name handling: hide the stale h2, bring the real name input
    // into the name slot instead. (Both ride the ledger; both restore home.)
    if (createModeActive) {
        hideElement(selectedChName);
        relocate(nameDiv, nameSlot);
    }

    // Duplicate + Delete buttons: pulled OUT of #avatar_controls and pinned to
    // the top-right actions row, above the portrait/name header. Must move
    // these before avatarControls relocates, or they'd travel along inside it.
    // (Refs captured up top, so DOM order here is all that matters.)
    relocate(dupeBtn, actionsSlot);
    relocate(deleteBtn, actionsSlot);

    // Icon buttons block (#avatar_controls). Sits in the identity column under
    // the tokens. The "More…" dropdown that natively lives inside it is pulled
    // back OUT below (into the below-avatar strip), leaving just the icon
    // buttons (.form_create_bottom_buttons_block) here.
    relocate(avatarControls, optionsSlot);

    // Export format chooser (#export_format_popup — the little PNG/JSON menu).
    // #export_button rides along inside #avatar_controls above, and ST's click
    // handler (bound to #export_button) still fires after the move. But the
    // popup it opens lives OUTSIDE #form_create, back in #templatesAndPopupsWrapper,
    // which sits UNDER our full-viewport #wl-xd-root overlay. So clicking Export
    // toggled the popup open exactly as designed — it just rendered beneath the
    // overlay and was never reachable, making the button look dead. Relocate the
    // popup INTO our overlay so it stacks above it. ST anchors the popup to the
    // button via a Popper instance created at page load; when the user clicks
    // Export, ST's handler calls exportPopper.update(), which recomputes against
    // the button's CURRENT position — so once both button and popup live in the
    // overlay, positioning just works. Relocated through the normal ledger, so
    // restore() returns it to #templatesAndPopupsWrapper on close.
    const exportPopup = document.getElementById('export_format_popup');
    if (exportPopup) relocate(exportPopup, optionsSlot);

    // Hide controls that make no sense inside the expanded drawer:
    // - #advanced_div reopens the classic Advanced Definitions popup (we ARE
    //   that popup)
    // - #rm_button_back navigates ST's right-nav, which is hidden beneath us
    hideElement(advancedBtn);
    hideElement(backBtn);

    // "More…" dropdown moves DOWN into the below-avatar strip. #avatar_controls
    // has already relocated into #wl-xd-options-slot (above), carrying the
    // dropdown with it; now pull the dropdown's wrapping <label> back out into
    // #wl-xd-more-slot. Same relocate() ledger, so restore() returns it to its
    // native parent inside #avatar_controls on close (reverse order guarantees
    // #avatar_controls is back in #form_create by the time this node restores).
    if (moreWrap) relocate(moreWrap, moreSlot);

    // Tag hub (search/management button) + pill list (#tags_div). Also moves
    // DOWN into the below-avatar strip, beneath the "More…" dropdown, into the
    // space the Creator's Notes drawer used to occupy (now in the right column).
    relocate(tagsDiv, tagsSlot);

    // Bedazzler "title" field — our OWN authored input in #wl-xd-title-slot,
    // directly under the name. EDIT mode only: create has no avatar yet to key
    // the sidecar by (the title is saved once the character exists and is
    // reopened). Dies with the container on close, so no restore ledger entry.
    if (!createModeActive) {
        renderTitleField();
        // If the SillyTavern-Nicknames extension is installed, host its
        // character nickname editor directly beneath the subtitle. No-op when
        // the extension isn't present. Edit mode only (there's no saved
        // character to nickname during create). MUST run before
        // relocateRightColumn() moves #spoiler_free_desc — see the function doc.
        relocateNicknameEditor();
    }
}

/**
 * OPTIONAL third-party integration — SillyTavern-Nicknames.
 *
 * When that extension is installed, it injects a character nickname editor
 * (#nickname_editor_char) into ST's native edit panel, immediately BEFORE the
 * Creator's Notes drawer (#spoiler_free_desc). The native drawer shows it; our
 * expanded drawer wouldn't, because we relocate the fields around it. So pull
 * that editor into the identity column, right under the subtitle, using the
 * normal relocation ledger — restore() returns it to its native spot (before
 * #spoiler_free_desc) on close, so the native drawer keeps working too.
 *
 * Feature-detected: a no-op when the extension isn't installed (the node simply
 * doesn't exist). The Nicknames extension re-renders by getElementById and wires
 * its controls through document-level event delegation, so the node stays fully
 * live after the move — including its own CHAT_CHANGED re-render.
 *
 * ORDERING: called from relocateLeftColumn(), which runs BEFORE
 * relocateRightColumn(). At this point #spoiler_free_desc is still the editor's
 * native next-sibling, so the recorded originalNext points at it — and because
 * this node is ledgered before Creator's Notes, reverse-order restore() puts
 * Creator's Notes back FIRST, leaving a valid insert-before target for the
 * editor. Net result: pixel-perfect restore to the native injection point.
 */
function relocateNicknameEditor() {
    const editor = document.getElementById('nickname_editor_char');
    if (!editor) return; // extension not installed — nothing to host
    const slot = container?.querySelector('#wl-xd-nickname-slot');
    if (!slot) return;
    relocate(editor, slot);
}

/**
 * Build the editable "title" (subtitle) input into #wl-xd-title-slot, seeded
 * with the current character's saved title and persisting edits to the sidecar
 * (keyed by avatar) — NOT to the card, so {{char}} is never touched. Because the
 * sidecar may still be loading when the drawer opens, we seed from whatever's
 * cached now and, if the load hasn't resolved, re-seed once it fires (guarded so
 * a user who's already typed isn't clobbered). Called from relocateLeftColumn in
 * edit mode; the element lives inside our container and needs no restore.
 */
function renderTitleField() {
    const slot = container?.querySelector('#wl-xd-title-slot');
    if (!slot) return;

    const stCtx = getSTContext();
    const avatar = stCtx?.characters?.[stCtx.characterId]?.avatar;
    if (!avatar || avatar === 'none') return; // nothing to key by

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'wl-xd-title-input';
    input.className = 'wl-xd-title-input text_pole';
    input.placeholder = 'Add a title…';
    input.maxLength = MAX_TITLE_LEN;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.title = 'A descriptive subtitle shown under the name (Bedazzler only — not part of the character card)';

    // Kick the sidecar load and seed from cache. `dirty` guards a late re-seed
    // from stomping text the user typed before the load landed.
    let dirty = false;
    ensureTitlesLoaded();
    input.value = getCharTitle(avatar);
    if (!titlesLoaded()) {
        const off = onTitlesLoaded(() => {
            off();
            if (!dirty && input.isConnected) input.value = getCharTitle(avatar);
        });
    }

    input.addEventListener('input', () => {
        dirty = true;
        setCharTitle(avatar, input.value);
    });
    // Enter shouldn't submit anything (there's no form here) — just blur so the
    // value is committed and the user gets feedback the edit "took".
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });

    slot.innerHTML = '';
    slot.appendChild(input);
}

/**
 * CENTER › Basics tab — Description (with its inline Ext. Media toggle) +
 * token counter. Description lives in #descriptionWrapper; the Ext. Media
 * button (#character_open_media_overrides) sits inside #description_div and
 * travels along automatically.
 */
function relocateBasics(formCreate) {
    const basicsPane = container.querySelector('.wl-xd-pane[data-tab="basics"]');
    relocate(formCreate.querySelector('#descriptionWrapper'), basicsPane);
}

/**
 * CENTER › Additional Info tab — Personality Summary, Scenario, and Examples
 * of Dialogue. Each source is a self-contained wrapper div in #character_popup
 * (label + textarea + token counter all inside), so we move the whole wrapper.
 *
 * Grabbed by ID from `document` (not scoped to the popup) so the nodes resolve
 * wherever they currently live — coexistence-ready for when the classic
 * Advanced Definitions revamp may be holding them.
 */
function relocateAdditionalInfo() {
    const pane = container.querySelector('.wl-xd-pane[data-tab="addinfo"]');

    // Refs first (golden rule), then move.
    const personalityDiv = document.getElementById('personality_div');
    const scenarioDiv = document.getElementById('scenario_div');
    const mesExampleDiv = document.getElementById('mes_example_div');

    relocate(personalityDiv, pane);
    relocate(scenarioDiv, pane);
    relocate(mesExampleDiv, pane);
}

/**
 * CENTER › Greetings tab.
 *
 * Two halves with DIFFERENT mechanics:
 *
 *   First Message — a genuine RELOCATE of #firstMessageWrapper from #form_create
 *   (label + textarea + token counter + ST's own input handler). It saves
 *   itself exactly as it does natively; we touch nothing. The .open_alternate_greetings
 *   button rides along inside it — we HIDE it (our sub-tabs replace its function)
 *   but leave it in the DOM because ST's edit-save reads its data-chid to know
 *   which character's alternate_greetings array to persist.
 *
 *   Alternate greetings — AUTHORED chrome, not relocated. ST's alt greetings
 *   have no persistent DOM (they're array-backed and cloned into a popup on
 *   demand), so per the agreed Option B we build our own textareas and bind
 *   them to the SAME array ST reads/writes:
 *     - create mode  → ctx.createCharacterData.alternate_greetings
 *     - edit mode     → ctx.characters[ctx.characterId].data.alternate_greetings
 *   On any edit we mutate that array by index, then dispatch a native 'input'
 *   on the relocated #firstmessage_textarea to trigger ST's own save path
 *   (create → mutates create_save; edit → saveCharacterDebounced → POST that
 *   rebuilds alternate_greetings straight from the array). No script.js import,
 *   no reinvented POST.
 *
 * The sub-tab strip is authored chrome, rebuilt from the array whenever it
 * changes (add / delete / reorder). First Message is the locked first sub-tab.
 */
function relocateGreetings(formCreate) {
    const pane = container.querySelector('.wl-xd-pane[data-tab="greetings"]');

    // Refs first (golden rule).
    const firstMessageWrapper = formCreate.querySelector('#firstMessageWrapper');
    const altGreetingsBtn = formCreate.querySelector('.open_alternate_greetings');

    // Hide the native "Alt. Greetings" button — our sub-tabs replace it — but
    // keep it in the DOM (its data-chid is load-bearing for ST's edit-save).
    hideElement(altGreetingsBtn);

    // Build the tab chrome: [sub-tab strip] + [greeting body host].
    // The strip and body are authored (not relocated), so they simply vanish
    // with the container on close; nothing to restore for them.
    const wrap = document.createElement('div');
    wrap.className = 'wl-xd-greet-wrap';
    wrap.innerHTML = `
        <div class="wl-xd-greet-stripwrap">
            <button class="wl-xd-greet-chev wl-xd-greet-chev-left" type="button" title="Scroll left" tabindex="-1">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <div class="wl-xd-greet-strip" role="tablist"></div>
            <button class="wl-xd-greet-chev wl-xd-greet-chev-right" type="button" title="Scroll right" tabindex="-1">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div class="wl-xd-greet-body"></div>
    `;
    pane.appendChild(wrap);

    // First Message wrapper relocates into the body host. It's shown only when
    // the First Message sub-tab is active (sub-tab 0); renderGreetings toggles
    // its visibility alongside the authored alt-greeting textareas.
    const body = wrap.querySelector('.wl-xd-greet-body');
    relocate(firstMessageWrapper, body);

    // Reset selection to First Message on each open, then render.
    greetActiveSub = 0;
    renderGreetings();

    // Wire chevrons + overflow detection.
    wireGreetChevrons(wrap);
}

/**
 * Resolve ST's live alternate_greetings array via the public context — no
 * imports from script.js. Returns the actual array reference (mutations persist
 * through ST's save path), or null if we can't resolve a target character.
 */
function getAltGreetingsArray() {
    const ctx = getSTContext();
    if (!ctx) return null;

    if (ctx.menuType === 'create') {
        const cs = ctx.createCharacterData;
        if (!cs) return null;
        if (!Array.isArray(cs.alternate_greetings)) cs.alternate_greetings = [];
        return cs.alternate_greetings;
    }

    // Resolve the character index the SAME way ST's edit-save does: it reads
    // `.open_alternate_greetings`'s jQuery data('chid'), NOT this_chid. ST
    // re-seeds that data on every character load (select_selected_character),
    // so it tracks the current character — but using it directly guarantees we
    // mutate the exact array instance ST will serialize on save, even if
    // this_chid and the button's chid ever diverge. Fall back to characterId.
    let chid = ctx.characterId;
    try {
        const btn = document.querySelector('.open_alternate_greetings');
        // eslint-disable-next-line no-undef
        if (btn && typeof jQuery !== 'undefined') {
            const dataChid = jQuery(btn).data('chid');
            if (dataChid !== undefined && dataChid !== null && dataChid !== -1) {
                chid = dataChid;
            }
        }
    } catch (e) { /* fall back to characterId */ }

    const char = ctx.characters?.[chid];
    if (!char) return null;
    if (!char.data) char.data = {};
    if (!Array.isArray(char.data.alternate_greetings)) char.data.alternate_greetings = [];
    return char.data.alternate_greetings;
}

/**
 * Get SillyTavern's public context object. Prefer the global SillyTavern.getContext()
 * (stable public API); returns null if unavailable so callers can no-op safely.
 */
function getSTContext() {
    try {
        // eslint-disable-next-line no-undef
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            return SillyTavern.getContext();
        }
    } catch (e) { /* fall through */ }
    return null;
}

/**
 * Persist array edits through ST's own save path.
 *
 * Two save mechanisms, matching how ST itself behaves:
 *
 *   nudgeSave()  — for TEXT edits. Dispatches 'input' on the relocated First
 *                  Message textarea, which ST wires to saveCharacterDebounced
 *                  (debounced → clicks #create_button → createOrEditCharacter).
 *                  Debounced is correct for typing: smooth, coalesced.
 *
 *   saveNow()    — for STRUCTURAL ops (add / delete / reorder). Calls
 *                  createOrEditCharacter() DIRECTLY and awaited, exactly like
 *                  ST's native alt-greetings popup does in its onClose handler.
 *                  This is the critical fix: the debounced button-click nudge
 *                  did NOT reliably persist a splice (the delete "didn't take"),
 *                  whereas a direct awaited save serializes the freshly-mutated
 *                  array immediately — the same call ST trusts for its own
 *                  delete/reorder. After it resolves, ST's getOneCharacter has
 *                  replaced the character object, and our CHARACTER_EDITED
 *                  listener reconciles the strip from the fresh array.
 */
function nudgeSave() {
    const firstMes = document.getElementById('firstmessage_textarea');
    if (!firstMes) return;
    firstMes.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Directly invoke ST's character save (create mode: no-op persist happens via
 * create_save mutation elsewhere; edit mode: awaited POST). Mirrors ST's own
 * structural-op save. Returns a promise so callers can await the reconcile.
 */
async function saveNow() {
    const ctx = getSTContext();
    // In create mode there's no server save — create_save already holds the
    // array (we mutate the live reference), so nothing to POST. A text nudge
    // keeps ST's other create-mode bookkeeping in sync.
    if (ctx?.menuType === 'create') {
        nudgeSave();
        return;
    }
    try {
        if (typeof createOrEditCharacter === 'function') {
            await createOrEditCharacter();
            return;
        }
    } catch (e) {
        log('saveNow: createOrEditCharacter failed, falling back to nudge', e);
    }
    // Fallback if the import ever goes missing: the debounced nudge.
    nudgeSave();
}

/**
 * Rebuild the sub-tab strip + body from the current array. Called on open and
 * after every add / delete / reorder. First Message is sub-tab 0 (locked); each
 * array entry is sub-tab 1..N with delete + up/down controls.
 */
function renderGreetings() {
    if (!container) return;
    const wrap = container.querySelector('.wl-xd-greet-wrap');
    if (!wrap) return;
    const strip = wrap.querySelector('.wl-xd-greet-strip');
    const body = wrap.querySelector('.wl-xd-greet-body');
    const arr = getAltGreetingsArray() || [];

    // Clamp selection if the array shrank (e.g. after delete of the last tab).
    if (greetActiveSub > arr.length) greetActiveSub = arr.length;
    if (greetActiveSub < 0) greetActiveSub = 0;

    // ── Rebuild the strip ────────────────────────────────────
    strip.innerHTML = '';

    // First Message tab (locked, not deletable).
    strip.appendChild(makeGreetTab({
        label: 'First Message',
        index: 0,
        locked: true,
    }));

    // One tab per alternate greeting.
    for (let i = 0; i < arr.length; i++) {
        strip.appendChild(makeGreetTab({
            label: `Alt ${i + 1}`,
            index: i + 1,
            locked: false,
        }));
    }

    // Add button (dashed +).
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'wl-xd-greet-add';
    addBtn.title = 'Add alternate greeting';
    addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    addBtn.addEventListener('click', onAddGreeting);
    strip.appendChild(addBtn);

    // ── Rebuild the body ─────────────────────────────────────
    // Remove previously-authored alt textareas (but NOT the relocated First
    // Message wrapper, which must survive to be restored on close).
    body.querySelectorAll('.wl-xd-greet-alt').forEach(el => el.remove());

    const firstMessageWrapper = body.querySelector('#firstMessageWrapper');

    if (greetActiveSub === 0) {
        // Show First Message, hide alts.
        if (firstMessageWrapper) firstMessageWrapper.style.display = '';
    } else {
        // Hide First Message; show the selected alt greeting's textarea.
        if (firstMessageWrapper) firstMessageWrapper.style.display = 'none';

        const idx = greetActiveSub - 1;
        const altBlock = makeAltGreetingBlock(idx, arr[idx] ?? '');
        body.appendChild(altBlock);
    }

    // Reflect active state on the strip tabs.
    strip.querySelectorAll('.wl-xd-greet-tab').forEach(tab => {
        tab.classList.toggle('active', Number(tab.dataset.sub) === greetActiveSub);
    });

    // Overflow chevrons may need to appear/disappear after a rebuild.
    requestAnimationFrame(() => updateGreetChevrons(wrap));
}

/**
 * Rebuild the Greetings tab from ST's current character truth. Called by the
 * index module on two events:
 *   - CHAT_CHANGED     — the user switched characters. Reset to First Message
 *                        (per design) and rebuild from the new character's array.
 *   - CHARACTER_EDITED — an edit-save POST completed. ST's getOneCharacter()
 *                        REPLACES the character object (characters[i] = fresh),
 *                        so the array instance we mutated is now stale. Re-read
 *                        to reconcile our strip with what actually persisted.
 *
 * Self-guards on isActive so it's a no-op when the drawer is closed. The
 * `resetSelection` flag distinguishes a character switch (reset to sub-tab 0)
 * from a post-save reconcile (keep the user where they are, clamped).
 */
export function refreshGreetings(resetSelection = false) {
    if (!isActive) return;
    // Only meaningful if the Greetings tab was ever built (its wrap exists).
    if (!container?.querySelector('.wl-xd-greet-wrap')) return;

    // Guard against stealing focus mid-type. CHARACTER_EDITED (resetSelection
    // = false) fires from the debounced save that the user's own keystroke
    // triggered; if we rebuild while they're typing in an alt-greeting textarea,
    // renderGreetings() replaces that textarea and the cursor is lost. When the
    // user is actively editing an alt greeting, skip the post-save reconcile —
    // the array is already correct in memory (we mutate it on input) and ST's
    // save reads that same array, so there's nothing to reconcile until they
    // move away. A character switch (resetSelection = true) always rebuilds.
    if (!resetSelection) {
        const active = document.activeElement;
        if (active && active.classList?.contains('wl-xd-greet-alt-text')) return;
    }

    if (resetSelection) greetActiveSub = 0;
    renderGreetings();
}

/**
 * Build one sub-tab button. First Message (locked) has no controls; alt
 * greetings carry inline up / down / delete controls that appear on the tab.
 */
function makeGreetTab({ label, index, locked }) {
    const tab = document.createElement('div');
    tab.className = 'wl-xd-greet-tab';
    tab.dataset.sub = String(index);
    tab.setAttribute('role', 'tab');

    const labelEl = document.createElement('span');
    labelEl.className = 'wl-xd-greet-tab-label';
    labelEl.textContent = label;
    tab.appendChild(labelEl);

    // Clicking the tab body selects it.
    tab.addEventListener('click', (e) => {
        // Ignore clicks that originated on an inline control.
        if (e.target.closest('.wl-xd-greet-tab-ctrl')) return;
        greetActiveSub = index;
        renderGreetings();
    });

    if (!locked) {
        const altIdx = index - 1; // position within the array

        const ctrls = document.createElement('span');
        ctrls.className = 'wl-xd-greet-tab-ctrls';

        const up = makeTabCtrl('fa-chevron-up', 'Move up', (e) => {
            e.stopPropagation();
            onReorderGreeting(altIdx, -1);
        });
        const down = makeTabCtrl('fa-chevron-down', 'Move down', (e) => {
            e.stopPropagation();
            onReorderGreeting(altIdx, 1);
        });
        const del = makeTabCtrl('fa-trash-alt', 'Delete', (e) => {
            e.stopPropagation();
            onDeleteGreeting(altIdx);
        });

        ctrls.appendChild(up);
        ctrls.appendChild(down);
        ctrls.appendChild(del);
        tab.appendChild(ctrls);
    }

    return tab;
}

function makeTabCtrl(icon, title, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wl-xd-greet-tab-ctrl';
    b.title = title;
    b.tabIndex = -1;
    b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    b.addEventListener('click', handler);
    return b;
}

/**
 * Build the authored alt-greeting editor block for a given array index. Mirrors
 * ST's native alt-greeting textarea markup/classes (text_pole textarea_compact
 * alternate_greeting_text mdHotkeys) so it inherits ST styling, but drives its
 * value + save through our array binding rather than ST's popup-scoped handler.
 */
function makeAltGreetingBlock(idx, value) {
    const block = document.createElement('div');
    block.className = 'wl-xd-greet-alt flex-container flexFlowColumn flex1';

    const header = document.createElement('div');
    header.className = 'wl-xd-greet-alt-header';
    header.innerHTML = `<strong>Alternate Greeting #${idx + 1}</strong>`;
    block.appendChild(header);

    const ta = document.createElement('textarea');
    ta.className = 'text_pole textarea_compact alternate_greeting_text mdHotkeys wl-xd-greet-alt-text';
    ta.setAttribute('data-macros', '');
    ta.setAttribute('name', 'alternate_greetings');
    ta.placeholder = '(This will be an additional greeting message for this character)';
    ta.value = value;

    // Live-bind edits to ST's array, then nudge ST's save path.
    ta.addEventListener('input', () => {
        const arr = getAltGreetingsArray();
        if (!arr) return;
        arr[idx] = ta.value;
        nudgeSave();
    });

    block.appendChild(ta);
    return block;
}

// ── Greeting mutations (mirror ST's array ops) ──────────────

async function onAddGreeting() {
    const arr = getAltGreetingsArray();
    if (!arr) return;
    arr.push('');
    // Select the newly added greeting so the user can type immediately.
    greetActiveSub = arr.length; // 1-based sub index of the new last entry
    // Optimistic render + focus, then direct awaited save (mirrors ST native).
    renderGreetings();
    const ta = container?.querySelector('.wl-xd-greet-alt-text');
    if (ta) ta.focus();
    await saveNow();
}

async function onDeleteGreeting(altIdx) {
    const arr = getAltGreetingsArray();
    if (!arr) return;

    // Confirm before destroying (greetings can be long). Mirror ST's confirm
    // using the context popup so it looks/feels native.
    const ctx = getSTContext();
    let ok = true;
    if (ctx && typeof ctx.callGenericPopup === 'function' && ctx.POPUP_TYPE) {
        ok = await ctx.callGenericPopup(
            'Are you sure you want to delete this alternate greeting?',
            ctx.POPUP_TYPE.CONFIRM,
        );
    } else {
        ok = window.confirm('Delete this alternate greeting?');
    }
    if (!ok) return;

    arr.splice(altIdx, 1);

    // If that was the LAST greeting, the guard's post-save check would see the
    // wipe fingerprint (N → 0). This delete is intentional — say so.
    if (arr.length === 0) suppressNextGreetingsEmpty();

    // Update selection BEFORE saving so the reconcile render (driven by the
    // CHARACTER_EDITED event that saveNow triggers) lands on the right tab.
    // If we deleted the active tab (or one before it), keep a sensible
    // selection: land on the tab now sitting at the deleted slot, or the last
    // one if we removed the tail. Falls back to First Message when empty.
    const deletedSub = altIdx + 1;
    if (greetActiveSub === deletedSub) {
        greetActiveSub = Math.min(deletedSub, arr.length); // next, or new last
    } else if (greetActiveSub > deletedSub) {
        greetActiveSub -= 1; // everything after shifted down one
    }

    // Optimistic render for instant feedback, then a direct awaited save
    // (mirrors ST's native delete). The awaited save fires CHARACTER_EDITED,
    // which reconciles the strip from the freshly-persisted array.
    renderGreetings();
    await saveNow();
}

/**
 * Move an alt greeting up (-1) or down (+1). Follows the moved greeting: the
 * selection stays on the same content after it changes position (per design).
 */
function onReorderGreeting(altIdx, direction) {
    const arr = getAltGreetingsArray();
    if (!arr) return;
    const newIdx = altIdx + direction;
    if (newIdx < 0 || newIdx >= arr.length) return; // bounds

    [arr[altIdx], arr[newIdx]] = [arr[newIdx], arr[altIdx]];

    // Follow the moved greeting (sub index is array index + 1).
    greetActiveSub = newIdx + 1;
    // Optimistic render, then direct awaited save (mirrors ST native reorder).
    renderGreetings();
    saveNow();
}

// ── Chevron overflow scrolling for the sub-tab strip ────────

function wireGreetChevrons(wrap) {
    const strip = wrap.querySelector('.wl-xd-greet-strip');
    const left = wrap.querySelector('.wl-xd-greet-chev-left');
    const right = wrap.querySelector('.wl-xd-greet-chev-right');
    if (!strip) return;

    const SCROLL_STEP = 160;
    left?.addEventListener('click', () => {
        strip.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' });
    });
    right?.addEventListener('click', () => {
        strip.scrollBy({ left: SCROLL_STEP, behavior: 'smooth' });
    });

    // Recompute chevron visibility as the strip scrolls or the window resizes.
    strip.addEventListener('scroll', () => updateGreetChevrons(wrap));
    window.addEventListener('resize', greetResizeHandler);

    updateGreetChevrons(wrap);
}

// Named so restore can detach it (window-level listener).
function greetResizeHandler() {
    const wrap = container?.querySelector('.wl-xd-greet-wrap');
    if (wrap) updateGreetChevrons(wrap);
}

/**
 * Fade chevrons in only when the strip overflows, and disable each end when
 * scrolled fully to that side.
 */
function updateGreetChevrons(wrap) {
    const strip = wrap.querySelector('.wl-xd-greet-strip');
    const left = wrap.querySelector('.wl-xd-greet-chev-left');
    const right = wrap.querySelector('.wl-xd-greet-chev-right');
    if (!strip) return;

    const overflowing = strip.scrollWidth > strip.clientWidth + 1;
    wrap.classList.toggle('wl-xd-greet-overflow', overflowing);

    if (!overflowing) return;

    const atStart = strip.scrollLeft <= 1;
    const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
    left?.classList.toggle('wl-xd-greet-chev-disabled', atStart);
    right?.classList.toggle('wl-xd-greet-chev-disabled', atEnd);
}

/**
 * CENTER › Prompts tab — Main Prompt Override, Post-History Instructions
 * Override, and the Character Note trio (text + depth + role).
 *
 * Main/Post-History textareas sit in anonymous wrapper <div>s (no IDs) inside
 * the Prompt Overrides inline-drawer; each wrapper holds the h4 label, the
 * maximize button, the textarea, and the token counter as one unit. We move
 * the textarea's parent wrapper to carry all of that along.
 *
 * The Character Note is #depth_prompt_div — a flex-container whose textarea
 * (#depth_prompt_prompt) and depth/role controls are sibling children, so
 * moving the div relocates the whole trio in one shot.
 */
function relocatePrompts() {
    const pane = container.querySelector('.wl-xd-pane[data-tab="prompts"]');

    // Refs first (golden rule). The two prompt textareas have no wrapper ID,
    // so capture their parent wrappers via the textareas themselves.
    const systemPrompt = document.getElementById('system_prompt_textarea');
    const postHistory = document.getElementById('post_history_instructions_textarea');
    const mainPromptBlock = systemPrompt?.parentElement || null;
    const postHistoryBlock = postHistory?.parentElement || null;
    const depthPromptDiv = document.getElementById('depth_prompt_div');

    // Tag the two anonymous prompt wrappers so CSS can weight their heights
    // (Main Prompt gets more room; Post-History matches the Character Note).
    // The classes are wl-xd- namespaced and land on ST's real nodes; ST never
    // references them, so leaving them after restore is harmless. We strip them
    // on restore anyway via markForClassCleanup so the nodes go back pristine.
    markForClassCleanup(mainPromptBlock, ['wl-xd-prompt-block', 'wl-xd-prompt-main']);
    markForClassCleanup(postHistoryBlock, ['wl-xd-prompt-block', 'wl-xd-prompt-posthistory']);

    relocate(mainPromptBlock, pane);
    relocate(postHistoryBlock, pane);
    relocate(depthPromptDiv, pane);
}

/**
 * CENTER › Metadata tab — Created by, Character Version, Tags to Embed, the
 * EDITABLE Creator's Notes (syncs to the left-column display via ST's own
 * handlers on the real node), and Talkativeness.
 *
 * The four text metadata fields sit in .flex1 wrapper divs (label + maximize
 * button + textarea) inside the Creator's Metadata inline-drawer; move each
 * wrapper. Talkativeness is the self-contained #talkativeness_div.
 */
function relocateMetadata() {
    const pane = container.querySelector('.wl-xd-pane[data-tab="metadata"]');

    // Refs first (golden rule). Text fields' wrappers are their .flex1 parents.
    const creator = document.getElementById('creator_textarea');
    const version = document.getElementById('character_version_textarea');
    const tagsToEmbed = document.getElementById('tags_textarea');
    const creatorNotes = document.getElementById('creator_notes_textarea');
    const creatorBlock = creator?.parentElement || null;
    const versionBlock = version?.parentElement || null;
    const tagsBlock = tagsToEmbed?.parentElement || null;
    const notesBlock = creatorNotes?.parentElement || null;
    const talkativenessDiv = document.getElementById('talkativeness_div');

    // Creator + Character Version share one row: both are short, near
    // single-line fields. We wrap them in our own row container (rather than
    // targeting the moved .flex1 wrappers by nth-child, which would be fragile
    // if field order changes) so the pairing is explicit and CSS can target
    // #wl-xd-meta-row directly.
    const metaRow = document.createElement('div');
    metaRow.id = 'wl-xd-meta-row';
    pane.appendChild(metaRow);
    relocate(creatorBlock, metaRow);
    relocate(versionBlock, metaRow);

    relocate(tagsBlock, pane);
    relocate(notesBlock, pane);
    relocate(talkativenessDiv, pane);
}

/**
 * RIGHT column — host the Creator's Notes DISPLAY drawer (#spoiler_free_desc).
 *
 * Previously this column re-hosted ST's native character list + HotSwap
 * carousel (a second, cramped character browser). Now that the full-size
 * Character Browser exists as its own takeover, that duplicate is gone: the
 * right column is dedicated to the character's Creator's Notes, expanded by
 * default and given the room to breathe.
 *
 * #spoiler_free_desc is a relocated ST node (its header carries
 * #creators_note_styles_button, the global-styles toggle — wanted; the
 * show/hide eye #spoiler_free_desc_button is pointless in a roomy panel, so we
 * hide it). It's a DISPLAY-only drawer (render target #creator_notes_spoiler):
 * expanding it triggers no save and no global-styles dialog (that fires only
 * from an explicit click on #creators_note_styles_button), so it can't collide
 * with our form-association save logic.
 */
function relocateRightColumn(formCreate) {
    const notesSlot = container.querySelector('#wl-xd-notes-slot');

    // Refs first (golden rule).
    const notesDrawer = formCreate.querySelector('#spoiler_free_desc');
    const eyeBtn = formCreate.querySelector('#spoiler_free_desc_button');
    if (!notesDrawer) return;

    // The show/hide eye is redundant in a dedicated panel — hide it.
    hideElement(eyeBtn);
    relocate(notesDrawer, notesSlot);

    // Open the Creator's Notes drawer by default. ST ships #spoiler_free_desc
    // as a standard inline-drawer that starts COLLAPSED (chevron .down, content
    // hidden). We want it expanded on open. Route through ST's OWN toggle click
    // so the chevron flip, slide, and content visibility all land in a
    // consistent native state (rather than hand-setting classes that could
    // drift from ST's drawer internals).
    //
    // Idempotent + safe: guarded on the chevron still being .down, so if ST
    // ever changes the default to open we won't toggle it back CLOSED. The
    // collapsible affordance is intentionally kept for now (user may drop it
    // later in favor of the CSS-permissions styling button).
    const notesIcon = notesDrawer.querySelector('.inline-drawer-icon');
    if (notesIcon && notesIcon.classList.contains('down')) {
        notesDrawer.querySelector('.inline-drawer-toggle')?.click();
    }
}

// ============================================================
// CENTER › Gallery tab
// ============================================================
//
// UNLIKE the other center panes, the Gallery is NOT relocated ST DOM — it's
// authored chrome we build fresh: a thumbnail grid + our own full-screen viewer
// (nicer than ST's native one). It reads the character's gallery via native ST
// endpoints (POST /api/images/list), so it needs NO CharacterLibrary install.
//
// Lifecycle: built empty in buildGalleryPane() during takeover; populated lazily
// on first tab-open via ensureGalleryLoaded(); everything lives inside the
// container so it dies on close. The lone exception is the viewer's document
// keydown listener, tracked in galleryViewerKeyHandler and detached explicitly.

// Media file-type detection — mirrors CharacterLibrary's gallery-viewer regexes
// so we accept exactly the same set ST writes into a gallery folder.
const WL_XD_MEDIA_RE = /\.(png|jpg|jpeg|webp|gif|bmp|mp4|webm|mov|avi|mkv|m4v)$/i;
const WL_XD_VIDEO_RE = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;

/**
 * Build the empty Gallery pane scaffold (called once per takeover). Lays out the
 * fixed chrome — a toolbar (folder override input + restore + Add Image), a
 * status/empty-state line, and an empty grid host — and defers the actual fetch
 * to ensureGalleryLoaded() on first tab activation.
 */
function buildGalleryPane() {
    const pane = container.querySelector('.wl-xd-pane[data-tab="gallery"]');
    if (!pane) return;

    const wrap = document.createElement('div');
    wrap.className = 'wl-xd-gallery-wrap';
    wrap.innerHTML = `
        <div class="wl-xd-gallery-toolbar">
            <div class="wl-xd-gallery-folder-field">
                <input type="text" class="text_pole wl-xd-gallery-folder-input"
                       placeholder="Gallery folder name" autocomplete="off"
                       title="Folder this character's gallery reads from. Blank or the character's name = default folder.">
                <div class="wl-xd-gallery-folder-menu" hidden></div>
            </div>
            <button type="button" class="menu_button wl-xd-gallery-folder-accept" title="Change gallery folder">
                <i class="fa-solid fa-check"></i>
            </button>
            <button type="button" class="menu_button wl-xd-gallery-folder-restore" title="Restore default folder">
                <i class="fa-solid fa-rotate-left"></i>
            </button>
            <button type="button" class="menu_button wl-xd-gallery-delete-toggle" title="Delete mode: click images to remove them" aria-pressed="false">
                <i class="fa-solid fa-trash-can"></i>
            </button>
            <button type="button" class="menu_button wl-xd-gallery-avatar-toggle" title="Set as avatar: click an image to make it this character's avatar" aria-pressed="false">
                <i class="fa-solid fa-user-pen"></i>
            </button>
            <button type="button" class="menu_button menu_button_icon wl-xd-gallery-add" title="Add image(s) to this character's gallery">
                <i class="fa-solid fa-plus"></i><span>Add Image</span>
            </button>
            <input type="file" class="wl-xd-gallery-file-input" accept="image/*,video/*" multiple hidden>
        </div>
        <div class="wl-xd-gallery-status" hidden></div>
        <div class="wl-xd-gallery-grid"></div>
        <button type="button" class="menu_button wl-xd-gallery-more" hidden>Load more</button>
    `;
    pane.appendChild(wrap);

    wireGalleryToolbar(wrap);
    wrap.querySelector('.wl-xd-gallery-more')?.addEventListener('click', () => {
        galleryVisibleLimit += GALLERY_BATCH_SIZE;
        const grid = wrap.querySelector('.wl-xd-gallery-grid');
        if (grid) renderGalleryGrid(grid);
    });
}

/**
 * Wire the gallery toolbar controls: folder change (Enter or ✔), folder restore,
 * and the Add Image file picker. All actions refetch the grid immediately.
 */
function wireGalleryToolbar(wrap) {
    const input = wrap.querySelector('.wl-xd-gallery-folder-input');
    const accept = wrap.querySelector('.wl-xd-gallery-folder-accept');
    const restore = wrap.querySelector('.wl-xd-gallery-folder-restore');
    const deleteToggle = wrap.querySelector('.wl-xd-gallery-delete-toggle');
    const avatarToggle = wrap.querySelector('.wl-xd-gallery-avatar-toggle');
    const addBtn = wrap.querySelector('.wl-xd-gallery-add');
    const fileInput = wrap.querySelector('.wl-xd-gallery-file-input');
    const menu = wrap.querySelector('.wl-xd-gallery-folder-menu');

    const applyFolder = () => {
        hideGalleryFolderMenu(menu);
        const resolved = setGalleryFolderOverride(input.value);
        if (resolved == null) {
            toastGallery('Can’t change the folder for this character.', 'error');
            return;
        }
        // Reflect the now-effective folder and refetch.
        input.value = resolved;
        reloadGalleryNow();
        toastGallery(`Gallery folder set to “${resolved}”.`);
    };

    accept?.addEventListener('click', applyFolder);
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyFolder(); }
        else if (e.key === 'Escape') { hideGalleryFolderMenu(menu); }
    });

    restore?.addEventListener('click', () => {
        hideGalleryFolderMenu(menu);
        // Passing empty clears the override → reverts to the character name.
        const resolved = setGalleryFolderOverride('');
        if (resolved == null) {
            toastGallery('Can’t restore the folder for this character.', 'error');
            return;
        }
        input.value = resolved;
        reloadGalleryNow();
        toastGallery('Gallery folder restored to default.');
    });

    deleteToggle?.addEventListener('click', () => toggleGalleryDeleteMode(deleteToggle));
    avatarToggle?.addEventListener('click', () => toggleGallerySetAvatarMode(avatarToggle));

    addBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
        const files = Array.from(fileInput.files || []);
        // Reset so selecting the same file again re-triggers change.
        fileInput.value = '';
        if (!files.length) return;
        await uploadGalleryFiles(files);
    });

    // ── Folder autocomplete dropdown ────────────────────────
    // Mirrors ST's native gallery: focusing the input drops a list of existing
    // gallery folders beneath it; typing filters; clicking one applies it. We
    // build our own lightweight menu (no jQuery-UI dependency) so it's fully
    // self-contained and matches the drawer's styling.
    const selectFolder = (name) => {
        input.value = name;
        applyFolder();
    };

    input?.addEventListener('focus', () => {
        // Select-all so typing replaces the pre-filled folder name.
        input.select();
        // Lazily fetch the folder list the first time the input is focused.
        // On focus, show ALL folders (ignore the pre-filled value as a filter).
        ensureGalleryFolderList().then(() => renderGalleryFolderMenu(menu, input, selectFolder, true));
    });
    input?.addEventListener('input', () => {
        // While typing, filter by the live text.
        renderGalleryFolderMenu(menu, input, selectFolder, false);
    });

    // Click-away closes the menu. Scoped to the container; removed with it.
    container.addEventListener('mousedown', (e) => {
        if (!menu || menu.hidden) return;
        if (e.target === input) return;
        if (menu.contains(e.target)) return;
        hideGalleryFolderMenu(menu);
    });
}

/**
 * Fetch the list of all gallery folder names once per takeover (cached in
 * galleryFolderList). Uses ST's native POST /api/images/folders with the
 * Content-Type omitted (ST calls it the same way — it's a body-less POST).
 */
async function ensureGalleryFolderList() {
    if (galleryFolderList.length) return galleryFolderList;
    try {
        const ctx = getSTContext();
        // Omit Content-Type: this POST carries no JSON body, and a declared
        // application/json with an empty body can trip the server's parser.
        const headers = ctx?.getRequestHeaders
            ? ctx.getRequestHeaders({ omitContentType: true })
            : {};
        const res = await fetch('/api/images/folders', { method: 'POST', headers });
        if (!res.ok) throw new Error(`images/folders ${res.status}`);
        const data = await res.json();
        galleryFolderList = Array.isArray(data) ? data : [];
    } catch (e) {
        log('Gallery folder list fetch failed', e);
        galleryFolderList = [];
    }
    return galleryFolderList;
}

/**
 * Render the folder dropdown. When showAll is true (on focus), the input's
 * current value is ignored and every folder is listed; otherwise (while typing)
 * the list is filtered by the input's text. Hidden when there are no matches.
 * Each row applies its folder on click.
 */
function renderGalleryFolderMenu(menu, input, onSelect, showAll = false) {
    if (!menu) return;
    const term = showAll ? '' : (input.value || '').trim().toLowerCase();
    const matches = galleryFolderList
        .filter(f => !term || f.toLowerCase().includes(term))
        .slice(0, 50);

    if (!matches.length) {
        hideGalleryFolderMenu(menu);
        return;
    }

    menu.innerHTML = '';
    for (const folder of matches) {
        const row = document.createElement('div');
        row.className = 'wl-xd-gallery-folder-option';
        row.textContent = folder;
        // mousedown (not click) so it fires before the input's blur/click-away.
        row.addEventListener('mousedown', (e) => {
            e.preventDefault();
            onSelect(folder);
        });
        menu.appendChild(row);
    }
    menu.hidden = false;
}

/** Hide + clear the folder dropdown. */
function hideGalleryFolderMenu(menu) {
    if (!menu) return;
    menu.hidden = true;
    menu.innerHTML = '';
}

/** Sync the folder input's displayed value to the current effective folder. */
function syncGalleryFolderInput() {
    const input = container?.querySelector('.wl-xd-gallery-folder-input');
    if (input) input.value = getGalleryFolderName();
}

/** Force a fresh gallery fetch + render regardless of the lazy flag. */
function reloadGalleryNow() {
    galleryLoaded = true; // it's loaded (or loading) now
    galleryVisibleLimit = GALLERY_BATCH_SIZE;
    loadGallery();
}

/**
 * Fire a toast via ST's toastr if available, else no-op (never throw). Small
 * wrapper so gallery actions get native-looking feedback without importing.
 */
function toastGallery(message, level = 'success') {
    try {
        // eslint-disable-next-line no-undef
        if (typeof toastr !== 'undefined' && toastr[level]) {
            toastr[level](message);
        }
    } catch (e) { /* no-op */ }
}

/**
 * Upload one or more files into the current character's gallery folder via ST's
 * native /api/images/upload endpoint (same shape designUtils uses), then refetch
 * the grid. Each file is sent as base64 with its own format + a unique-ish
 * filename; the server writes them under user/images/{ch_name}/.
 */
async function uploadGalleryFiles(files) {
    const folder = getGalleryFolderName();
    if (!folder) {
        toastGallery('No gallery folder resolved for this character.', 'error');
        return;
    }

    const wrap = container?.querySelector('.wl-xd-gallery-wrap');
    const status = wrap?.querySelector('.wl-xd-gallery-status');
    if (status) setGalleryStatus(status, `Uploading ${files.length} file(s)…`);

    const ctx = getSTContext();
    let okCount = 0;
    for (const file of files) {
        try {
            const base64 = await fileToBase64(file);
            const format = (file.name.split('.').pop() || 'png').toLowerCase();
            // Strip the extension for the filename field; keep it reasonably
            // unique so multiple uploads in one batch don't collide.
            const stem = file.name.replace(/\.[^.]+$/, '');
            const filename = `${stem}_${Date.now()}_${okCount}`;
            const headers = ctx?.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
            const res = await fetch('/api/images/upload', {
                method: 'POST',
                headers,
                body: JSON.stringify({ image: base64, format, filename, ch_name: folder }),
            });
            if (!res.ok) throw new Error(`upload ${res.status}`);
            okCount++;
        } catch (e) {
            log('Gallery upload failed for', file?.name, e);
        }
    }

    if (okCount === files.length) {
        toastGallery(`Added ${okCount} image(s) to the gallery.`);
    } else if (okCount > 0) {
        toastGallery(`Added ${okCount} of ${files.length}; some failed.`, 'warning');
    } else {
        toastGallery('Upload failed.', 'error');
    }

    // Refresh the grid to show the new media.
    // An upload may have created a brand-new folder (custom override name that
    // didn't exist yet), so invalidate the cached folder list — it'll refetch
    // next time the input is focused.
    if (okCount > 0) galleryFolderList = [];
    reloadGalleryNow();
}

/** Read a File as a bare base64 string (no data: prefix). */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

/**
 * Resolve the gallery folder name for the currently-open character.
 *
 * Honors ST's NATIVE custom-folder override so we're fully interoperable with
 * ST's own gallery extension (and CharacterLibrary, which reads the same store):
 * the override lives in extensionSettings.gallery.folders, keyed by the
 * character's AVATAR filename (not name). If an override is set we use it; else
 * we fall back to the character name (ST's default). This mirrors ST's own
 * getGalleryFolder(): folders[avatar] ?? name.
 *
 * The result is sanitized to match the on-disk directory (same reserved-char
 * collapse ST's server applies).
 */
function getGalleryFolderName() {
    const ctx = getSTContext();
    if (!ctx) return '';

    // Create mode has no avatar yet → name-only, no override possible.
    if (ctx.menuType === 'create') {
        return sanitizeGalleryFolder(ctx.createCharacterData?.name || '');
    }

    const char = ctx.characters?.[ctx.characterId];
    if (!char) return '';

    const override = getGalleryFolderOverride(ctx, char.avatar);
    const folder = override || char.name || '';
    return sanitizeGalleryFolder(folder);
}

/**
 * Read the raw (unsanitized) native override for an avatar, or '' if none.
 * Defensive against the gallery settings object not being initialized yet.
 */
function getGalleryFolderOverride(ctx, avatar) {
    if (!avatar) return '';
    const folders = ctx?.extensionSettings?.gallery?.folders;
    if (!folders || typeof folders !== 'object') return '';
    const val = folders[avatar];
    return typeof val === 'string' ? val : '';
}

/**
 * Set (or clear) the native custom-folder override for the current character,
 * writing straight into ST's own extensionSettings.gallery.folders store so the
 * change is visible to ST's gallery + CharacterLibrary too. Mirrors ST's
 * updateGalleryFolder / restoreGalleryFolder semantics:
 *   - empty or === character name → remove the override (revert to default)
 *   - otherwise                    → set folders[avatar] = value
 * Returns the resolved folder string now in effect (sanitized), or null if we
 * can't resolve a character (create mode / group / no avatar).
 */
function setGalleryFolderOverride(rawValue) {
    const ctx = getSTContext();
    if (!ctx || ctx.groupId != null || ctx.characterId == null) return null;

    const char = ctx.characters?.[ctx.characterId];
    const avatar = char?.avatar;
    const name = char?.name || '';
    if (!avatar) return null;

    // Ensure the settings shape exists (ST creates this on gallery init, but the
    // user may not have opened ST's gallery yet this session).
    if (!ctx.extensionSettings.gallery || typeof ctx.extensionSettings.gallery !== 'object') {
        ctx.extensionSettings.gallery = { folders: {}, sort: 'dateAsc' };
    }
    if (!ctx.extensionSettings.gallery.folders || typeof ctx.extensionSettings.gallery.folders !== 'object') {
        ctx.extensionSettings.gallery.folders = {};
    }

    const trimmed = (rawValue || '').trim();
    if (!trimmed || trimmed === name) {
        delete ctx.extensionSettings.gallery.folders[avatar];
    } else {
        ctx.extensionSettings.gallery.folders[avatar] = trimmed;
    }
    // Persist through ST's own debounced settings save.
    if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();

    return getGalleryFolderName();
}

/**
 * Match ST's folder sanitization: strip the filesystem-reserved characters and
 * trim. (Same character class CharacterLibrary uses, which in turn mirrors ST's
 * sanitize-filename behavior for these folders.)
 */
function sanitizeGalleryFolder(name) {
    if (!name) return '';
    // eslint-disable-next-line no-control-regex
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

/**
 * Lazy loader for the Gallery tab. Idempotent: fetches + renders the grid on the
 * first call after a takeover (or character switch), no-ops afterward. Safe to
 * call on every tab activation.
 */
async function ensureGalleryLoaded() {
    if (galleryLoaded) return;
    galleryLoaded = true; // set immediately so rapid re-clicks don't double-fetch
    galleryVisibleLimit = GALLERY_BATCH_SIZE;
    await loadGallery();
}

/**
 * Fetch the current character's gallery media and render the grid. Sets the
 * status line for empty / error states. Uses ST's native /api/images/list with
 * CSRF headers from the public context (same pattern as designUtils' upload).
 */
async function loadGallery() {
    galleryAbortController?.abort();
    const controller = new AbortController();
    galleryAbortController = controller;
    const requestGeneration = ++galleryLoadGeneration;
    const root = container;
    const wrap = root?.querySelector('.wl-xd-gallery-wrap');
    if (!wrap) {
        if (galleryAbortController === controller) galleryAbortController = null;
        return;
    }
    const grid = wrap.querySelector('.wl-xd-gallery-grid');
    const status = wrap.querySelector('.wl-xd-gallery-status');
    if (!grid || !status) {
        if (galleryAbortController === controller) galleryAbortController = null;
        return;
    }
    const moreButton = wrap.querySelector('.wl-xd-gallery-more');
    if (moreButton) moreButton.hidden = true;

    // Keep the folder input in sync with the effective folder every load.
    syncGalleryFolderInput();

    const folder = getGalleryFolderName();
    if (!folder) {
        if (galleryAbortController === controller) galleryAbortController = null;
        galleryMedia = [];
        grid.innerHTML = '';
        setGalleryStatus(status, 'No character loaded.');
        return;
    }

    // Loading state.
    setGalleryStatus(status, 'Loading gallery…');
    grid.innerHTML = '';

    let files = [];
    try {
        const ctx = getSTContext();
        const headers = ctx?.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
        const res = await fetch('/api/images/list', {
            method: 'POST',
            headers,
            body: JSON.stringify({ folder, type: 7, sortField: 'date', sortOrder: 'desc' }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`images/list ${res.status}`);
        files = await res.json();
    } catch (e) {
        if (e?.name === 'AbortError') return;
        if (requestGeneration !== galleryLoadGeneration || container !== root) return;
        if (galleryAbortController === controller) galleryAbortController = null;
        log('Gallery fetch failed', e);
        setGalleryStatus(status, 'Couldn’t load gallery images.');
        galleryMedia = [];
        return;
    }

    if (!isActive || requestGeneration !== galleryLoadGeneration || container !== root || getGalleryFolderName() !== folder) {
        return;
    }
    if (galleryAbortController === controller) galleryAbortController = null;

    // Filter to media and build URLs (encodeURIComponent both path segments —
    // folder names and filenames can contain spaces/@ etc.).
    const safeFolder = sanitizeGalleryFolder(folder);
    galleryMedia = (files || [])
        .filter(f => WL_XD_MEDIA_RE.test(f))
        .map(fileName => ({
            name: fileName,
            url: `/user/images/${encodeURIComponent(safeFolder)}/${encodeURIComponent(fileName)}`,
            type: WL_XD_VIDEO_RE.test(fileName) ? 'video' : 'image',
        }));

    if (galleryMedia.length === 0) {
        setGalleryStatus(status, 'No gallery images for this character yet.');
        return;
    }

    // Have media → hide status, render grid.
    setGalleryStatus(status, '');
    renderGalleryGrid(grid);
}

/** Set (or clear) the gallery status line. Empty text hides it. */
function setGalleryStatus(status, text) {
    if (!status) return;
    if (text) {
        status.textContent = text;
        status.hidden = false;
    } else {
        status.textContent = '';
        status.hidden = true;
    }
}

/**
 * Render the thumbnail grid from galleryMedia. Images get a plain <img>; videos
 * get a non-preloading <video> with a play badge overlay. The first batch is
 * rendered immediately; additional tiles are opt-in through Load more. Clicking any tile
 * opens the full-screen viewer at that index.
 */
function renderGalleryGrid(grid) {
    grid.innerHTML = '';
    // Reflect the current delete-mode on the grid for cursor/overlay styling.
    grid.classList.toggle('wl-xd-gallery-deleting', galleryDeleteMode);
    // Reflect the current set-avatar mode on the grid for cursor/overlay styling.
    grid.classList.toggle('wl-xd-gallery-picking-avatar', gallerySetAvatarMode);
    const visibleMedia = galleryMedia.slice(0, galleryVisibleLimit);
    visibleMedia.forEach((media, i) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'wl-xd-gallery-tile';
        tile.title = media.name;
        tile.dataset.index = String(i);

        if (media.type === 'video') {
            const vid = document.createElement('video');
            vid.src = media.url;
            vid.muted = true;
            vid.preload = 'none';
            vid.playsInline = true;
            tile.appendChild(vid);
            const badge = document.createElement('span');
            badge.className = 'wl-xd-gallery-playbadge';
            badge.innerHTML = '<i class="fa-solid fa-play"></i>';
            tile.appendChild(badge);
        } else {
            const img = document.createElement('img');
            img.src = media.url;
            img.loading = 'lazy';
            img.alt = media.name;
            tile.appendChild(img);
        }

        tile.addEventListener('click', () => {
            if (galleryDeleteMode) {
                deleteGalleryMedia(i);
            } else if (gallerySetAvatarMode) {
                setGalleryImageAsAvatar(i);
            } else {
                openGalleryViewer(i);
            }
        });
        grid.appendChild(tile);
    });

    const more = grid.closest('.wl-xd-gallery-wrap')?.querySelector('.wl-xd-gallery-more');
    if (more) {
        const remaining = galleryMedia.length - visibleMedia.length;
        more.hidden = remaining <= 0;
        more.textContent = remaining > 0 ? `Load more (${remaining} remaining)` : 'Load more';
    }
}

/**
 * Toggle delete mode on/off. Mirrors ST's native gallery: flip the flag, reflect
 * it on the button (aria-pressed) and the grid (cursor/overlay class), and toast
 * a hint when turning it ON. No per-image confirm — the mode itself is the guard.
 */
function toggleGalleryDeleteMode(btn) {
    galleryDeleteMode = !galleryDeleteMode;
    // Delete and set-avatar modes are mutually exclusive — turning one on
    // clears the other so a tile click always has a single unambiguous action.
    if (galleryDeleteMode) resetGallerySetAvatarMode();
    if (btn) btn.setAttribute('aria-pressed', String(galleryDeleteMode));
    const grid = container?.querySelector('.wl-xd-gallery-grid');
    if (grid) grid.classList.toggle('wl-xd-gallery-deleting', galleryDeleteMode);
    if (galleryDeleteMode) {
        toastGallery('Delete mode is ON. Click images to delete them.', 'info');
    }
}

/** Clear delete mode (used on reload / character switch / drawer close). */
function resetGalleryDeleteMode() {
    galleryDeleteMode = false;
    const btn = container?.querySelector('.wl-xd-gallery-delete-toggle');
    if (btn) btn.setAttribute('aria-pressed', 'false');
    const grid = container?.querySelector('.wl-xd-gallery-grid');
    if (grid) grid.classList.remove('wl-xd-gallery-deleting');
}

/**
 * Toggle set-avatar mode on/off. Mirrors delete mode's shape: flip the flag,
 * reflect it on the button (aria-pressed) and the grid (cursor/overlay class),
 * toast a hint when turning it ON. Mutually exclusive with delete mode.
 */
function toggleGallerySetAvatarMode(btn) {
    gallerySetAvatarMode = !gallerySetAvatarMode;
    if (gallerySetAvatarMode) resetGalleryDeleteMode();
    if (btn) btn.setAttribute('aria-pressed', String(gallerySetAvatarMode));
    const grid = container?.querySelector('.wl-xd-gallery-grid');
    if (grid) grid.classList.toggle('wl-xd-gallery-picking-avatar', gallerySetAvatarMode);
    if (gallerySetAvatarMode) {
        toastGallery('Set-avatar mode is ON. Click an image to make it the avatar.', 'info');
    }
}

/** Clear set-avatar mode (used on reload / character switch / drawer close). */
function resetGallerySetAvatarMode() {
    gallerySetAvatarMode = false;
    const btn = container?.querySelector('.wl-xd-gallery-avatar-toggle');
    if (btn) btn.setAttribute('aria-pressed', 'false');
    const grid = container?.querySelector('.wl-xd-gallery-grid');
    if (grid) grid.classList.remove('wl-xd-gallery-picking-avatar');
}

/**
 * Set the gallery image at index i as the open character's avatar, routed
 * entirely through ST's NATIVE flow so we never touch the embedded card data:
 *
 *   1. Fetch the gallery image -> base64 data URL.
 *   2. Unless power_user.never_resize_avatars is set, hand it to ST's crop
 *      dialog (Popup + POPUP_TYPE.CROP, { cropImage }) and use the cropped
 *      result. Respecting the setting mirrors ST's own uploadCharacterAvatar().
 *   3. POST the (cropped) image + the character's existing avatar filename to
 *      /api/characters/edit-avatar (multipart). The SERVER re-reads the current
 *      card chunks from the existing PNG and re-embeds them into the new image,
 *      keeping the filename stable — so no card fields can be blanked by us.
 *   4. Bust the thumbnail + character-image caches and refresh visible <img>s so
 *      the new avatar shows immediately everywhere (list, chat, drawer).
 *
 * Stays in set-avatar mode on success so the toolbar state is predictable; the
 * user toggles it off when done.
 */
async function setGalleryImageAsAvatar(i) {
    const media = galleryMedia[i];
    if (!media) return;

    // Videos can't be avatars.
    if (media.type === 'video') {
        toastGallery('Can’t use a video as an avatar. Pick an image.', 'warning');
        return;
    }

    const ctx = getSTContext();
    if (!ctx) {
        toastGallery('SillyTavern context unavailable.', 'error');
        return;
    }

    // Resolve the open character's avatar filename (ST's identity key). Create
    // mode has no saved avatar yet, so there's nothing to overwrite.
    if (ctx.menuType === 'create') {
        toastGallery('Save the character first, then set its avatar.', 'warning');
        return;
    }
    const char = ctx.characters?.[ctx.characterId];
    const avatarKey = char?.avatar;
    if (!avatarKey) {
        toastGallery('No character avatar to update.', 'error');
        return;
    }

    // Confirm, mirroring the deliberate feel of delete mode.
    let confirmed = false;
    try {
        if (ctx.Popup?.show?.confirm) {
            confirmed = await ctx.Popup.show.confirm('Set as avatar?', media.name);
        } else {
            confirmed = window.confirm(`Set "${media.name}" as ${char.name || 'this character'}'s avatar?`);
        }
    } catch (e) {
        log('Set-avatar confirm failed', e);
        return;
    }
    if (!confirmed) return;

    try {
        // 1. Gallery image -> base64 data URL. media.url is percent-encoded for
        //    <img src>, which fetch handles fine.
        const imgResp = await fetch(media.url);
        if (!imgResp.ok) throw new Error(`fetch image ${imgResp.status}`);
        const blob = await imgResp.blob();
        let imageData = await blobToDataUrl(blob);

        // 2. Crop, unless the user disabled avatar resizing (native behavior).
        const neverResize = !!ctx.powerUserSettings?.never_resize_avatars;
        if (!neverResize && ctx.Popup && ctx.POPUP_TYPE?.CROP != null) {
            const dlg = new ctx.Popup('Set the crop position of the avatar image', ctx.POPUP_TYPE.CROP, '', { cropImage: imageData });
            const cropped = await dlg.show();
            if (!cropped) return; // user cancelled the crop dialog
            imageData = String(cropped);
        }

        // 3. Upload via ST's native edit-avatar (server re-embeds the card).
        const uploadBlob = await (await fetch(imageData)).blob();
        const formData = new FormData();
        formData.append('avatar', uploadBlob, 'avatar.png');
        formData.append('avatar_url', avatarKey);

        const headers = ctx.getRequestHeaders
            ? ctx.getRequestHeaders({ omitContentType: true })
            : {};
        const upResp = await fetch('/api/characters/edit-avatar', {
            method: 'POST',
            headers,
            body: formData,
        });
        if (!upResp.ok) throw new Error(await upResp.text().catch(() => `edit-avatar ${upResp.status}`));

        // 4. Keep ST's in-memory character object in sync (native does this via
        //    getOneCharacter after edit-avatar) so anything reading characters[]
        //    sees the fresh card, then force every visible avatar image to show
        //    the new bytes. refreshAvatarEverywhere is the single shared refresh
        //    used by BOTH this Gallery path and the native CHARACTER_EDITED hook.
        try {
            await ctx.getOneCharacter?.(avatarKey);
        } catch (e) {
            log('getOneCharacter after set-avatar failed (non-fatal)', e);
        }
        refreshAvatarEverywhere(avatarKey);

        toastGallery('Avatar updated.', 'success');
    } catch (e) {
        log('Set-avatar failed', e);
        toastGallery('Couldn’t set that image as the avatar.', 'error');
    }
}

/** Read a Blob as a data: URL (used to hand an image into ST's crop dialog). */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(blob);
    });
}

// Tracks the short-lived zoom click hook so rapid avatar changes replace it.
// A click hook is much cheaper than watching every DOM mutation on <body>.
let avatarZoomClickHandler = null;
let avatarZoomObserverTimer = null;

// Watches the relocated character-editor avatar preview (#avatar_load_preview)
// and upgrades ST's low-res thumbnail src to the full-resolution character
// image, so the 140px portrait slot isn't blowing up a ~96px thumbnail (which
// looked fuzzy). Module-scoped: set up per takeover, disconnected in restore.
let portraitPreviewObserver = null;

/**
 * Force EVERY visible representation of a character's avatar to repaint with the
 * freshly-saved bytes — reliably, even on the 2nd+ set of the same (stable)
 * filename. This is the single shared refresh used by both the Gallery
 * set-avatar path and the native-edit CHARACTER_EDITED hook (see index.js).
 *
 * Why the naive approaches fail (and what we do instead):
 *
 *   The character avatar FILENAME is stable across sets, so every reference uses
 *   the SAME url string. Browsers keep a DECODED-bitmap cache keyed to that url
 *   string, separate from the HTTP cache. ST's native refresh does
 *   `img.src=''; img.src=sameUrl` — which repaints from that decoded bitmap and
 *   silently shows the OLD image on a repeat set. Our previous attempt busted to
 *   a unique url then RESTORED the clean url, which snapped right back to the
 *   stale decoded copy. The only thing that reliably defeats the decoded cache
 *   is leaving the element on a url string it has never decoded before.
 *
 *   THUMBNAILS (`/thumbnail?type=avatar&file=NAME.png`): we FRONT-LOAD the
 *   buster — `/thumbnail?t=<ts>&type=avatar&file=NAME.png` — and leave it on
 *   permanently (no restore). Unique string ⇒ guaranteed re-decode every set.
 *   Crucially this keeps ST's zoom parser happy: `.mes .avatar` derives the
 *   filename via `src.substring(src.lastIndexOf('=') + 1)`, and with the buster
 *   BEFORE `file=`, the last `=` still sits in front of `NAME.png`. (A TRAILING
 *   `&t=` was the old 404 bug — `lastIndexOf('=')` landed in the timestamp.)
 *
 *   FULL-SIZE zoom (`/characters/NAME.png`, no query): ST reads the filename off
 *   that bare url, so we can't permanently buster it. Instead we watch for ST's
 *   freshly-built `.zoomed_avatar` element to appear and, once it does, point
 *   its <img> at `/characters/NAME.png?t=<ts>` — the server ignores the query
 *   (express.static), izoomify gets fresh bytes, and ST's already-run parser is
 *   unaffected because it read the filename before we touched the src.
 *
 * @param {string} avatarKey - The character's avatar filename (ST identity key).
 */
export function refreshAvatarEverywhere(avatarKey) {
    if (!avatarKey) return;
    const ctx = getSTContext();
    const ts = Date.now();

    // --- Thumbnails: front-loaded, permanent buster on every matching <img>. ---
    try {
        // Build the canonical thumbnail url for this key so we can match against
        // the file= param (robust to any existing t= the element already carries).
        const baseThumb = ctx?.getThumbnailUrl
            ? ctx.getThumbnailUrl('avatar', avatarKey)
            : `/thumbnail?type=avatar&file=${encodeURIComponent(avatarKey)}`;
        // The encoded file token as it appears in the url, e.g. "file=Jules.png".
        const fileToken = `file=${encodeURIComponent(avatarKey)}`;

        // Refresh the HTTP-cache entry for the canonical url so the bytes behind
        // whatever the element requests are current (best-effort; non-blocking).
        fetch(baseThumb, { method: 'GET', cache: 'reload' }).catch(() => {});

        // Rewrite every avatar thumbnail <img> for this character. Match on the
        // file= token so we catch elements regardless of param order or an
        // existing buster. Rebuild as t=<ts> FIRST, then the original params.
        const imgs = document.querySelectorAll(`img[src*="${fileToken}"]`);
        imgs.forEach((im) => {
            if (!(im instanceof HTMLImageElement)) return;
            // Only touch avatar-thumbnail srcs (defensive: the selector is broad).
            if (!im.src.includes('/thumbnail?')) return;
            // Strip any existing t= param, then front-load a fresh unique one so
            // the browser must decode a url string it has never seen before.
            const query = im.src.split('?')[1] || '';
            const kept = query
                .split('&')
                .filter((kv) => kv && !/^t=\d+$/.test(kv))
                .join('&');
            im.src = `/thumbnail?t=${ts}&${kept}`;
        });

        // The character-editor avatar preview (#avatar_load_preview) is a special
        // case: after an avatar edit ST sets it to a base64 DATA URL (the cropped
        // image), NOT a /thumbnail? url — so the src-token sweep above never
        // matches it. This one element is shared by BOTH the native character
        // drawer AND our expanded drawer (we relocate it), so fixing it here
        // fixes both. Repoint it at a fresh busted thumbnail so it reflects the
        // newly-saved avatar. Guard: only when this preview belongs to the
        // character we just updated — in create mode / mid-edit the preview may
        // legitimately hold a different pending image we must not clobber.
        const preview = document.getElementById('avatar_load_preview');
        if (preview instanceof HTMLImageElement && ctx?.menuType !== 'create') {
            preview.src = `/thumbnail?t=${ts}&type=avatar&file=${encodeURIComponent(avatarKey)}`;
        }
    } catch (e) {
        log('Avatar thumbnail refresh failed (non-fatal)', e);
    }

    // --- Full-size zoom: patch ST's freshly-built .zoomed_avatar when it opens. ---
    try {
        const charname = String(avatarKey).replace(/\.png$/i, '');
        // The full-size url ST will set (no query). We append a unique buster.
        // TauriTavern's native zoom owns its host-specific media URL. Rewriting
        // it to SillyTavern's legacy /characters route is what broke portraits.
        if (isTauriHost()) return;

        const cleanFull = getCharacterAvatarUrl(avatarKey, ctx);
        const bustedFull = getCharacterAvatarUrl(avatarKey, ctx, ts);

        // Warm the full-size HTTP-cache entry now so the busted load below is a
        // fast 304-or-cached fetch when the user actually opens the zoom.
        fetch(cleanFull, { method: 'GET', cache: 'reload' }).catch(() => {});

        // Tear down any prior hook (rapid repeat set) so we never stack them.
        if (avatarZoomClickHandler) {
            document.removeEventListener('click', avatarZoomClickHandler, true);
            avatarZoomClickHandler = null;
        }
        if (avatarZoomObserverTimer) { clearTimeout(avatarZoomObserverTimer); avatarZoomObserverTimer = null; }

        const patchZoomImg = (root) => {
            // ST builds `.zoomed_avatar[forChar="<charname>"] img` and sets both
            // src and data-izoomify-url to /characters/NAME.png. Swap to busted.
            const sel = `.zoomed_avatar[forChar="${CSS.escape(charname)}"] img`;
            const el = root.matches?.(sel) ? root : root.querySelector?.(sel);
            if (el instanceof HTMLImageElement) {
                el.src = bustedFull;
                el.setAttribute('data-izoomify-url', bustedFull);
                return true;
            }
            return false;
        };

        const stopZoomClickHook = () => {
            if (avatarZoomClickHandler) {
                document.removeEventListener('click', avatarZoomClickHandler, true);
                avatarZoomClickHandler = null;
            }
            if (avatarZoomObserverTimer) clearTimeout(avatarZoomObserverTimer);
            avatarZoomObserverTimer = null;
        };

        avatarZoomClickHandler = (event) => {
            const clickedImage = event.target instanceof Element
                ? (event.target.closest('img') || event.target.closest('.avatar')?.querySelector('img'))
                : null;
            if (!(clickedImage instanceof HTMLImageElement) || !clickedImage.src.includes(`file=${encodeURIComponent(avatarKey)}`)) return;

            // ST creates the zoom from the same click. Patch after its handler has
            // built the element, without observing unrelated chat DOM churn.
            requestAnimationFrame(() => {
                const zoomRoot = document.querySelector(`.zoomed_avatar[forChar="${CSS.escape(charname)}"]`);
                if (zoomRoot && patchZoomImg(zoomRoot)) stopZoomClickHook();
            });
        };
        document.addEventListener('click', avatarZoomClickHandler, true);

        // If a zoom for this char is ALREADY open, patch it immediately too.
        let patchedExistingZoom = false;
        document.querySelectorAll(`.zoomed_avatar[forChar="${CSS.escape(charname)}"] img`).forEach((el) => {
            if (el instanceof HTMLImageElement) {
                el.src = bustedFull;
                el.setAttribute('data-izoomify-url', bustedFull);
                patchedExistingZoom = true;
            }
        });

        if (patchedExistingZoom) {
            stopZoomClickHook();
        } else {
            avatarZoomObserverTimer = setTimeout(stopZoomClickHook, 10000);
        }
    } catch (e) {
        log('Avatar zoom refresh setup failed (non-fatal)', e);
    }
}

/**
 * Delete the gallery media at index i via ST's native POST /api/images/delete
 * ({ path } = the media URL). On success, splice it out of galleryMedia and
 * re-render (staying in delete mode so multiple can be removed in a row). If the
 * grid empties, fall back to a full reload so the "no images" status shows.
 */
async function deleteGalleryMedia(i) {
    const media = galleryMedia[i];
    if (!media) return;

    // Confirm first, mirroring ST's native gallery (delete mode AND a per-image
    // confirm). Use ST's Popup for a native look; fall back to window.confirm.
    const ctx = getSTContext();
    let confirmed = false;
    try {
        if (ctx?.Popup?.show?.confirm) {
            confirmed = await ctx.Popup.show.confirm('Delete this image?', media.name);
        } else {
            confirmed = window.confirm(`Delete "${media.name}"?`);
        }
    } catch (e) {
        log('Gallery delete confirm failed', e);
        return;
    }
    if (!confirmed) return;

    try {
        const headers = ctx?.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
        // media.url is percent-encoded for use as an <img src>; the delete
        // endpoint does a raw path.join + fs lookup and does NOT decode, so an
        // encoded path (spaces as %20, etc.) misses the real file and returns
        // 404. Send the decoded on-disk path instead.
        const deletePath = decodeURIComponent(media.url);
        const res = await fetch('/api/images/delete', {
            method: 'POST',
            headers,
            body: JSON.stringify({ path: deletePath }),
        });
        if (!res.ok) throw new Error(`images/delete ${res.status}`);
    } catch (e) {
        log('Gallery delete failed', e);
        toastGallery('Couldn’t delete that image.', 'error');
        return;
    }

    galleryMedia.splice(i, 1);
    toastGallery('Image deleted.', 'success');

    if (galleryMedia.length === 0) {
        // Nothing left — reload to show the empty-state status line.
        reloadGalleryNow();
        return;
    }
    const grid = container?.querySelector('.wl-xd-gallery-grid');
    if (grid) renderGalleryGrid(grid);
}

/**
 * Rebuild the Gallery tab from the current character's gallery. Called by the
 * index module on CHAT_CHANGED (character switch): reset the lazy flag and, if
 * the Gallery tab is currently active, re-fetch immediately; otherwise let the
 * next tab-open trigger the fetch. Self-guards on the drawer being open.
 */
export function refreshGallery() {
    if (!isActive || !container) return;
    galleryAbortController?.abort();
    galleryAbortController = null;
    galleryLoadGeneration++;
    // A viewer left open from the previous character should close.
    closeGalleryViewer();
    resetGalleryDeleteMode();
    resetGallerySetAvatarMode();
    galleryLoaded = false;
    galleryMedia = [];
    galleryVisibleLimit = GALLERY_BATCH_SIZE;
    // Clear the old grid so stale thumbnails don't linger behind the new fetch.
    const grid = container.querySelector('.wl-xd-gallery-grid');
    if (grid) grid.innerHTML = '';
    const more = container.querySelector('.wl-xd-gallery-more');
    if (more) more.hidden = true;
    // If the user is looking at the Gallery right now, refetch immediately.
    if (getActiveTab() === 'gallery') {
        ensureGalleryLoaded();
    }
}

// ── Full-screen viewer (our own, nicer than ST's native) ────

/**
 * Open the full-screen viewer at a given media index. Builds a single overlay
 * inside our container (so it dies on close), wires click-out / Esc / arrow
 * navigation, and shows the selected media. Reuses one overlay instance: if it
 * already exists, just re-point it.
 */
function openGalleryViewer(index) {
    if (!container || !galleryMedia.length) return;

    let overlay = container.querySelector('.wl-xd-gallery-viewer');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'wl-xd-gallery-viewer';
        overlay.innerHTML = `
            <button class="wl-xd-gv-close" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
            <button class="wl-xd-gv-nav wl-xd-gv-prev" title="Previous (←)"><i class="fa-solid fa-chevron-left"></i></button>
            <div class="wl-xd-gv-stage"></div>
            <button class="wl-xd-gv-nav wl-xd-gv-next" title="Next (→)"><i class="fa-solid fa-chevron-right"></i></button>
            <div class="wl-xd-gv-caption"></div>
        `;
        container.appendChild(overlay);

        // Click on the backdrop (but not on the media/controls) closes.
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.classList.contains('wl-xd-gv-stage')) {
                closeGalleryViewer();
            }
        });
        overlay.querySelector('.wl-xd-gv-close').addEventListener('click', closeGalleryViewer);
        overlay.querySelector('.wl-xd-gv-prev').addEventListener('click', (e) => {
            e.stopPropagation();
            stepGalleryViewer(-1);
        });
        overlay.querySelector('.wl-xd-gv-next').addEventListener('click', (e) => {
            e.stopPropagation();
            stepGalleryViewer(1);
        });

        // Document-level key nav. Tracked so we can detach on close/restore.
        galleryViewerKeyHandler = (e) => {
            if (!container?.querySelector('.wl-xd-gallery-viewer.wl-xd-gv-open')) return;
            if (e.key === 'Escape') { e.preventDefault(); closeGalleryViewer(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); stepGalleryViewer(-1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); stepGalleryViewer(1); }
        };
        document.addEventListener('keydown', galleryViewerKeyHandler);
    }

    overlay.dataset.index = String(index);
    overlay.classList.add('wl-xd-gv-open');
    renderGalleryViewer();
}

/** Render the current viewer media (image or video) into the stage. */
function renderGalleryViewer() {
    const overlay = container?.querySelector('.wl-xd-gallery-viewer');
    if (!overlay) return;
    const stage = overlay.querySelector('.wl-xd-gv-stage');
    const caption = overlay.querySelector('.wl-xd-gv-caption');
    const idx = Number(overlay.dataset.index) || 0;
    const media = galleryMedia[idx];
    if (!media) return;

    stage.innerHTML = '';
    if (media.type === 'video') {
        const vid = document.createElement('video');
        vid.src = media.url;
        vid.controls = true;
        vid.autoplay = true;
        vid.playsInline = true;
        vid.className = 'wl-xd-gv-media';
        stage.appendChild(vid);
    } else {
        const img = document.createElement('img');
        img.src = media.url;
        img.className = 'wl-xd-gv-media';
        img.alt = media.name;
        stage.appendChild(img);
    }
    if (caption) caption.textContent = `${idx + 1} / ${galleryMedia.length} · ${media.name}`;

    // Disable nav ends when there's nowhere to go (single item).
    const prev = overlay.querySelector('.wl-xd-gv-prev');
    const next = overlay.querySelector('.wl-xd-gv-next');
    const multiple = galleryMedia.length > 1;
    if (prev) prev.style.visibility = multiple ? '' : 'hidden';
    if (next) next.style.visibility = multiple ? '' : 'hidden';
}

/** Advance the viewer by delta, wrapping around the media list. */
function stepGalleryViewer(delta) {
    const overlay = container?.querySelector('.wl-xd-gallery-viewer');
    if (!overlay || !galleryMedia.length) return;
    let idx = Number(overlay.dataset.index) || 0;
    idx = (idx + delta + galleryMedia.length) % galleryMedia.length;
    overlay.dataset.index = String(idx);
    renderGalleryViewer();
}

/**
 * Close the viewer: hide the overlay and stop any playing video by clearing the
 * stage. We keep the overlay element (and its key handler) around for reuse; the
 * handler self-guards on the .wl-xd-gv-open class so it's inert while closed.
 * Full teardown of the listener happens in restoreExpanded().
 */
function closeGalleryViewer() {
    const overlay = container?.querySelector('.wl-xd-gallery-viewer');
    if (!overlay) return;
    overlay.classList.remove('wl-xd-gv-open');
    const stage = overlay.querySelector('.wl-xd-gv-stage');
    if (stage) stage.innerHTML = ''; // stop video playback
}

// ============================================================
// Create mode (New Character hosted in the expanded drawer)
// ============================================================
//
// ST's create flow reuses #form_create wholesale: select_rm_create() (already
// run by the New Character button before we open) flips menuType to 'create',
// seeds every field from the create_save scratch object, and natively HIDES
// the edit-only controls (Delete / Duplicate / Export / chat-lorebook / media
// overrides) — all of which we relocate, so that gating rides along for free.
// What's left for us: hide the tabs that need an EXISTING character, replace
// the native checkmark with a prominent authored Create button, and hand off
// to a normal edit session once the character exists.

/**
 * Apply the create-mode adjustments to the freshly-built takeover. Called from
 * takeoverExpanded() after all relocations (so the nodes it touches are in
 * their final homes). Everything here either rides the ledger (hidden native
 * nodes) or is authored chrome that dies with the container.
 */
function applyCreateModeChrome() {
    if (!container) return;

    // Tabs that need an existing character are hidden outright:
    //   Gallery — the character's image folder doesn't exist until Create
    //             (and set-avatar/upload key off the saved avatar filename).
    //   Design  — Bedazzler design data is stored against the character's
    //             avatar key, which doesn't exist yet either.
    // The panes stay in the DOM (unreachable without their tab buttons); the
    // default active tab is Basics, so nothing can land on a hidden pane.
    for (const t of ['gallery', 'design']) {
        const tab = container.querySelector(`.wl-xd-tab[data-tab="${t}"]`);
        if (tab) tab.style.display = 'none';
    }

    // Hide the native create checkmark (#create_button_label wraps the submit
    // input) — our authored button below replaces it as the visible affordance.
    // The INPUT itself must stay clickable programmatically (it's the form
    // submit that runs createOrEditCharacter), which display:none permits.
    hideElement(document.getElementById('create_button_label'));

    // Authored "Create Character" button — bottom of the left column, below
    // the tags area (per design). Dies with the container; no ledger entry.
    const left = container.querySelector('#wl-xd-left');
    if (!left) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'wl-xd-create-btn';
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i><span>Create Character</span>';
    btn.title = 'Create this character';
    btn.addEventListener('click', onCreateCharacterClick);
    left.appendChild(btn);
}

/**
 * The authored Create button's flow:
 *   1. Snapshot the current avatar set.
 *   2. Click the NATIVE #create_button — ST's own validation ("Name is
 *      required" toast) and the entire create POST run untouched. The relocated
 *      named fields all reach the FormData scrape via form= association.
 *   3. Await the characters array growing (ST's create path ends with
 *      getCharacters(), which repopulates it). A validation failure never
 *      grows the array — we time out quietly and stay in create mode, with
 *      ST's toast having already told the user why.
 *   4. HANDOFF: on success ST has RESET every form field to blank and switched
 *      the hidden menu to an info panel — so we close this create surface,
 *      select the new character, and reopen the drawer as a normal edit
 *      session on it (Gallery/Design now unlocked). Same two-rAF defer as the
 *      browser's Edit bridge so the form is repopulated before recapture.
 */
async function onCreateCharacterClick() {
    const ctx = getSTContext();
    const nativeBtn = document.getElementById('create_button');
    if (!ctx || !nativeBtn) return;

    const before = new Set((ctx.characters || []).map(c => c?.avatar).filter(Boolean));
    nativeBtn.click();

    const newAvatar = await waitForNewCharacter(before, 15000);
    if (!newAvatar || !isActive) return; // failed/cancelled, or user closed meanwhile

    restoreExpanded();

    try {
        const fresh = getSTContext();
        const idx = (fresh?.characters || []).findIndex(c => c?.avatar === newAvatar);
        if (idx < 0) return;
        await fresh.selectCharacterById(idx);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!isActive) takeoverExpanded();
        }));
    } catch (err) {
        console.error('[BD] Expanded drawer: post-create handoff failed.', err);
    }
}

/**
 * Resolve with the avatar filename of the first character NOT in `beforeSet`,
 * polling the live context every 250ms; null on timeout. Polling (vs. a
 * one-shot event listener) is deliberate: it needs no event-name coupling and
 * a validation failure simply times out with no side effects.
 */
function waitForNewCharacter(beforeSet, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
            const chars = getSTContext()?.characters || [];
            const fresh = chars.find(c => c?.avatar && !beforeSet.has(c.avatar));
            if (fresh) { resolve(fresh.avatar); return; }
            if (Date.now() - started >= timeoutMs) { resolve(null); return; }
            setTimeout(tick, 250);
        };
        tick();
    });
}

// ============================================================
// Chrome wiring
// ============================================================

function wireChrome() {
    // Tab switching
    container.querySelectorAll('.wl-xd-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Close button → restore to normal ST view
    const closeBtn = container.querySelector('#wl-xd-close');
    if (closeBtn) closeBtn.addEventListener('click', () => restoreExpanded());

    // "Character Browser" link (top-left) → close this drawer, then open the
    // full Character Browser. Full close first so every relocated ST node is
    // home before the browser's own takeover relocates its (different) set of
    // ST nodes — the two overlays never coexist. Guard against a stale browser
    // instance already being up (shouldn't happen from here, but cheap).
    const browserLink = container.querySelector('#wl-xd-browser-link');
    if (browserLink) {
        // The Back arrow leads to the Character Browser, which is a SUB of this
        // drawer — hide it when the browser is disabled (there's nothing to go
        // back to; the drawer stands alone). The click also re-checks live in
        // case the toggle changed while the drawer was open.
        browserLink.style.display = isCharBrowserEnabled() ? '' : 'none';
        browserLink.addEventListener('click', () => {
            // Capture the character being edited BEFORE we tear down, so the
            // browser can open on the page that holds it (instead of page 1).
            const stCtx = getSTContext();
            const focusAvatar = stCtx?.characters?.[stCtx.characterId]?.avatar || null;
            restoreExpanded();
            if (isCharBrowserEnabled() && !isCharBrowserActive()) takeoverCharBrowser({ focusAvatar });
        });
    }
}

function switchTab(tabName) {
    if (!container) return;
    container.querySelectorAll('.wl-xd-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });
    container.querySelectorAll('.wl-xd-pane').forEach(p => {
        p.classList.toggle('active', p.dataset.tab === tabName);
    });

    // Design is UIBedazzler's own stateless UI — (re)render it fresh on every
    // switch, exactly like the classic drawer does. Rendering into OUR pane is
    // safe because classic released before we opened (one owner at a time), so
    // the wl-cd- IDs inside the design markup are unique in the document.
    if (tabName === 'design') {
        const designPane = container.querySelector('.wl-xd-pane[data-tab="design"]');
        if (designPane) renderDesignTab(designPane);
    }

    // Gallery is lazy: don't hit the /images/list endpoint until the user first
    // opens the tab. ensureGalleryLoaded() is idempotent — it fetches+renders on
    // the first activation and is a no-op on subsequent switches (the grid, once
    // built, survives tab hides since panes only toggle display). A character
    // switch resets the loaded flag (see refreshGallery) so the next open of the
    // tab re-fetches for the new character.
    if (tabName === 'gallery') {
        ensureGalleryLoaded();
    }
}

/**
 * Re-render the Design pane from current character data, if it's the active
 * tab. Called by the index module on CHAT_CHANGED — the design controls are
 * authored chrome rendered from a point-in-time read (like the Greetings
 * strip), so a character switch must rebuild them; relocated ST fields update
 * in place for free, but rendered panes do not. Self-guards on the drawer
 * being open, so it's a safe no-op otherwise.
 */
export function refreshDesignPane() {
    if (!isActive || !container) return;
    if (getActiveTab() !== 'design') return;
    const designPane = container.querySelector('.wl-xd-pane[data-tab="design"]');
    if (designPane) renderDesignTab(designPane);
}

export function getActiveTab() {
    return container?.querySelector('.wl-xd-tab.active')?.dataset.tab || 'basics';
}

// ============================================================
// Restore
// ============================================================

/**
 * Tear down the expanded drawer, returning every relocated element to its
 * original home and undoing inline-style changes. Restores in REVERSE order so
 * originalNext references remain valid as siblings return.
 */
export function restoreExpanded() {
    if (!isActive) return;

    galleryAbortController?.abort();
    galleryAbortController = null;
    galleryLoadGeneration++;

    // Detach the Greetings strip's window-level resize listener (the only
    // listener that outlives the container; everything else dies with it).
    window.removeEventListener('resize', greetResizeHandler);

    // Detach the Gallery viewer's document-level key handler (the other listener
    // that outlives the container). The overlay itself dies with the container.
    if (galleryViewerKeyHandler) {
        document.removeEventListener('keydown', galleryViewerKeyHandler);
        galleryViewerKeyHandler = null;
    }

    // Stop upgrading the avatar preview to full-res — it's about to return to
    // ST's native (small) editor slot, where the thumbnail is the right size.
    if (portraitPreviewObserver) {
        portraitPreviewObserver.disconnect();
        portraitPreviewObserver = null;
    }
    if (avatarZoomClickHandler) {
        document.removeEventListener('click', avatarZoomClickHandler, true);
        avatarZoomClickHandler = null;
    }
    if (avatarZoomObserverTimer) {
        clearTimeout(avatarZoomObserverTimer);
        avatarZoomObserverTimer = null;
    }

    // The Greetings tab toggles #firstMessageWrapper's inline display directly
    // (shown on the First Message sub-tab, hidden on an alt sub-tab). That's not
    // tracked as a relocation record, so clear it here — otherwise the wrapper
    // could return to #form_create still carrying display:none and vanish from
    // the native editor.
    const firstMessageWrapper = container?.querySelector('#firstMessageWrapper');
    if (firstMessageWrapper) firstMessageWrapper.style.display = '';

    for (let i = relocatedElements.length - 1; i >= 0; i--) {
        const record = relocatedElements[i];
        if (record.originalParent) {
            const { element, originalParent, originalNext } = record;
            if (originalNext && originalNext.parentElement === originalParent) {
                originalParent.insertBefore(element, originalNext);
            } else {
                originalParent.appendChild(element);
            }
        } else if (record.style) {
            record.element.style[record.style] = record.original;
        } else if (record.classes) {
            record.classes.forEach(c => record.element.classList.remove(c));
        } else if (record.attr) {
            // Restore the form= association attribute to its original value
            // (usually absent → remove it; otherwise put the old value back).
            if (record.original === null) {
                record.element.removeAttribute(record.attr);
            } else {
                record.element.setAttribute(record.attr, record.original);
            }
        }
    }

    relocatedElements = [];
    container?.remove();
    container = null;
    document.body.classList.remove('wl-xd-open');
    isActive = false;
    // Create-mode flag drops with the takeover (the authored Create button and
    // hidden-tab styling died with the container; hidden native nodes rode the
    // ledger home above).
    createModeActive = false;

    // COEXISTENCE — invite the classic takeover back now that every field is
    // home and the wl-xd-open guard is lifted. No-op unless the classic toggle
    // is on AND #character_popup is currently visible (rare at close time);
    // otherwise classic's own watcher re-takes on the popup's next open.
    retakeCharDrawer();

    log('Expanded drawer restored');
}
