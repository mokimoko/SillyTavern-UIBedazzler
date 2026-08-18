// src/charDrawerExpanded/index.js
// Expanded Character Drawer — feature lifecycle + activation wiring.
//
// Adds an "expand" button to ST's right-nav header (left of the character
// display-name heading). Clicking it takes over the screen with the 3-column
// expanded layout.
// The feature is OFF by default. It COEXISTS with the classic charDrawerTakeover:
// both toggles may be on; ownership of #character_popup's fields is arbitrated
// by open/close state (expanded open = ours; closed = classic's). See the
// coexistence notes in drawerUI.js and src/charDrawer/index.js.

import { extension_settings } from '../../../../../extensions.js';
import { eventSource, event_types } from '../../../../../../script.js';
import { MODULE_NAME } from '../settings.js';
import { takeoverExpanded, restoreExpanded, isExpandedActive, refreshGreetings, refreshDesignPane, refreshGallery, refreshAvatarEverywhere } from './drawerUI.js';
// Shared Design CSS lifecycle lives in the classic module (it owns designTab);
// both toggles call it so the chat styling reflects either feature being on.
import { syncDesignCSS } from '../charDrawer/index.js';
// Non-hostable states route the expand button to the Character Browser instead
// of a dead click (see expandTarget). Runtime-only usage, so the existing
// browser↔drawer import cycle stays safe.
import { takeoverCharBrowser, isCharBrowserActive, isCharBrowserEnabled } from '../charBrowser/index.js';

const log = () => {};

const EXPAND_BTN_ID = 'wl-xd-expand-btn';

let nameObserver = null;
let pendingNativeAvatarRefresh = null;
let avatarInputHintInstalled = false;

// ============================================================
// Character-context gating
// ============================================================
//
// Live getContext() readings (verified 2026-07-02, re-checked 2026-07-21):
//
//   Welcome screen : menuType 'characters',     characterId undefined, groupId null
//   Create form    : menuType 'create',         characterId undefined*, groupId null
//   Loaded char    : menuType 'character_edit',  characterId '32',      groupId null
//
//   * ONLY when no character was loaded beforehand. select_rm_create() does NOT
//     unload the current character, so entering create with a char open keeps
//     characterId set — and BACKING OUT of that create (menuType 'characters')
//     keeps it set too, while #form_create still holds the create-mode
//     leftovers. That's why `characterId != null` alone was an unsafe gate: it
//     opened an edit-layout drawer over a form NOT bound to the loaded
//     character (mostly-blank fields, mixed tag state), where a stray save
//     could scrape those blanks over the character. menuType is the honest
//     signal for what #form_create actually holds.

/**
 * Which surface the expand button should open for the CURRENT ST state:
 *
 *   'create'  — ST's create form is live (menuType 'create'): host the
 *               expanded drawer as the CREATE surface (drawerUI detects the
 *               mode itself).
 *   'edit'    — a single character is loaded AND the form is bound to it
 *               (menuType 'character_edit'): host the expanded EDIT drawer.
 *   'group'   — a GROUP is the current context (groupId set, i.e. in a group
 *               chat): the expanded drawer can't host a group, and native ST has
 *               a full group side panel for editing (members/name/strategy). So
 *               the two entry points DIVERGE here: the top-bar open-on-click
 *               redirect STANDS DOWN (native group panel opens for editing),
 *               while the expand BUTTON opens the Character Browser (the manual
 *               escape hatch). Editing individual members is a character edit,
 *               reachable from the browser's group detail or ST's own panel.
 *   'browser' — anything else (welcome list, a backed-out create, info panel):
 *               the form is not bound to a character, so there's nothing safe
 *               for the drawer to host — open the Character Browser instead
 *               (it's the "pick a character" surface anyway).
 *
 * Defensive against getContext() not being ready (→ 'browser').
 */
function expandTarget() {
    try {
        const ctx = SillyTavern.getContext();
        if (ctx?.menuType === 'create') return 'create';
        // A group is loaded → 'group' (native editing on top-bar click; browser
        // on the expand button). Checked before 'edit' since a group context has
        // groupId set (and the 'edit' gate already excludes groupId != null).
        if (ctx?.groupId != null) return 'group';
        if (ctx?.menuType === 'character_edit' && ctx?.characterId != null && ctx?.groupId == null) {
            return 'edit';
        }
    } catch { /* fall through */ }
    // Non-hostable state (welcome / no char / backed-out create; groups are
    // handled above). The Character Browser is the surface here — but ONLY when
    // it's enabled (it's a sub of this drawer). Disabled → 'disabled' so the
    // button greys out and the
    // open-on-click redirect stands down, rather than opening a turned-off
    // surface (or closing the native drawer with nothing to replace it).
    return isCharBrowserEnabled() ? 'browser' : 'disabled';
}

/**
 * Keep the button's tooltip (and greyed state) honest about where a click will
 * land. Create/edit → the expanded drawer. A no-character state → the Character
 * Browser WHEN it's enabled; when the browser is off there's nothing to open,
 * so the button greys out (wl-xd-disabled) rather than playing at an action it
 * won't perform.
 */
function updateExpandButtonState() {
    const btn = document.getElementById(EXPAND_BTN_ID);
    if (!btn) return;
    btn.classList.remove('wl-xd-disabled');
    switch (expandTarget()) {
        case 'create':
            btn.title = 'Open the expanded drawer (create character)';
            break;
        case 'edit':
            btn.title = 'Open expanded character drawer';
            break;
        case 'browser':
            btn.title = 'Open the Character Browser';
            break;
        case 'group':
            // In a group, the button opens the browser (top-bar opens native
            // group editing). Greyed when the browser sub-feature is off.
            if (isCharBrowserEnabled()) {
                btn.title = 'Open the Character Browser';
            } else {
                btn.classList.add('wl-xd-disabled');
                btn.title = 'Character Browser is off';
            }
            break;
        default: // 'disabled' — no hostable character and the browser is off
            btn.classList.add('wl-xd-disabled');
            btn.title = 'Load a character to open the expanded drawer';
            break;
    }
}

// ============================================================
// Public API
// ============================================================

export function initCharDrawerExpanded() {
    const settings = extension_settings[MODULE_NAME];
    if (settings.charDrawerExpanded) {
        setupExpandButton();
    }
    setupAvatarRefreshHint();
    setupGreetingsSync();

    // "Open expanded on top-bar click": when BOTH the Expanded Character Drawer
    // toggle AND its "open on click" sub-toggle are on, a normal open of ST's
    // native character panel (#right-nav-panel) is redirected into OUR surfaces
    // — the expanded drawer for a hostable character/create state, the Character
    // Browser otherwise (same routing as the expand button, see expandTarget).
    // Installed here when the parent toggle is on; the toggle handler reconciles
    // it live, and the watcher self-gates per mutation on BOTH toggles. Mirrors
    // WI v2's setupOpenExpandedWatcher (src/worldInfoDrawerV2/index.js).
    setupOpenExpandedWatcher();

    log('Initialized');
}

/**
 * Record actual native avatar-file changes. CHARACTER_EDITED fires for every
 * character save, so using it alone turns ordinary text/design edits into a
 * page-wide image scan plus a long-lived observer.
 */
function setupAvatarRefreshHint() {
    if (avatarInputHintInstalled) return;
    avatarInputHintInstalled = true;

    document.addEventListener('change', (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.id !== 'add_avatar_button') return;
        if (!input.files?.length) return;

        try {
            const context = SillyTavern.getContext();
            const avatar = context?.characters?.[context.characterId]?.avatar
                || String($('#avatar_url_pole').val() || '');
            if (!avatar) return;

            const marker = { avatar };
            pendingNativeAvatarRefresh = marker;
            setTimeout(() => {
                if (pendingNativeAvatarRefresh === marker) pendingNativeAvatarRefresh = null;
            }, 30000);
        } catch { /* non-fatal */ }
    }, true);
}

/**
 * Keep the Greetings tab in sync with ST's character truth. Two events:
 *
 *   CHAT_CHANGED     — user switched characters. The relocated ST fields (other
 *                      tabs) update in place for free, but the Greetings tab's
 *                      alt-greeting sub-tabs are authored chrome built from a
 *                      one-time array snapshot, so they must be rebuilt. Reset
 *                      to First Message on switch (resetSelection = true).
 *
 *   CHARACTER_EDITED — an edit-save POST just completed. ST's getOneCharacter()
 *                      REPLACES the character object wholesale, so the array we
 *                      mutated is now a stale reference. Rebuild from the fresh
 *                      object so the strip reflects exactly what persisted
 *                      (this is what makes add / delete / reorder stick reliably
 *                      instead of racing ST's debounced save + object swap).
 *
 * refreshGreetings() self-guards on the drawer being open AND the Greetings tab
 * having been built, so both handlers are safe no-ops otherwise. Registered
 * once at init (not per-toggle) to avoid duplicate subscriptions.
 */
function setupGreetingsSync() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // Character context may have changed (loaded a char, went to welcome,
        // entered a group) — grey/enable the expand button to match.
        updateExpandButtonState();
        refreshGreetings(true);
        // The Design pane is authored chrome like the Greetings strip —
        // rendered from a point-in-time read, so a character switch must
        // rebuild it (relocated ST fields update in place; rendered panes
        // don't). Self-guards on drawer-open + Design being the active tab.
        refreshDesignPane();
        // The Gallery pane is authored chrome too, fetched from a per-character
        // endpoint. On a character switch, reset its lazy-load flag (and refetch
        // if it's the active tab). Self-guards on drawer-open.
        refreshGallery();
    });
    eventSource.on(event_types.CHARACTER_EDITED, (payload) => {
        refreshGreetings(false);

        // Avatar refresh for the NATIVE avatar-file path only. ST's own
        // post-edit refresh uses
        // `img.src=''; img.src=sameUrl`, which repaints from the browser's
        // decoded-bitmap cache and silently shows the OLD avatar on a 2nd set of
        // the same (stable) filename. We run our reliable front-loaded-buster
        // refresh over the same images to fix that.
        //
        // Ordering matters: ST emits CHARACTER_EDITED from inside
        // createOrEditCharacter(), and the native `read_avatar_load` refresh
        // block runs AFTER that returns. If we refreshed synchronously here,
        // native's stale reset would clobber us. Defer to a macrotask so we get
        // the last word on the <img> src.
        try {
            // eslint-disable-next-line no-undef
            const stCtx = (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function')
                ? SillyTavern.getContext()
                : null;
            const avatarKey = payload?.detail?.character?.avatar
                || stCtx?.characters?.[payload?.detail?.id]?.avatar
                || stCtx?.characters?.[stCtx?.characterId]?.avatar;
            if (avatarKey && pendingNativeAvatarRefresh?.avatar === avatarKey) {
                pendingNativeAvatarRefresh = null;
                setTimeout(() => refreshAvatarEverywhere(avatarKey), 0);
            }
        } catch { /* non-fatal */ }
    });
}

export function onCharDrawerExpandedToggleChanged(enabled) {
    if (enabled) {
        setupExpandButton();
    } else {
        teardownExpandButton();
        if (isExpandedActive()) restoreExpanded();
    }
    // Reconcile the "open expanded on click" watcher with the new parent state.
    // setupOpenExpandedWatcher installs the observer whenever the parent is on
    // and tears it down when it's off; while installed it self-gates per mutation
    // on isOpenOnClickEnabled() (which also reads the sub-toggle), so flipping the
    // sub-toggle alone needs no handler — the live gate covers it. (That's also
    // why charDrawerExpandedOnClick has no TOGGLE_HANDLERS entry in index.js.)
    setupOpenExpandedWatcher();
    // Design chat-CSS is shared with the classic drawer — reconcile it with
    // the current state of BOTH toggles (injected if either is on).
    syncDesignCSS();
}

// ============================================================
// Expand button
// ============================================================

/**
 * Inject the expand button into ST's right-nav panel header, immediately to the
 * LEFT of the character display-name heading (#rm_button_selected_ch, the <h2>
 * that shows the selected character's name inside #right-nav-panel-tabs). We
 * author this one button (it has no ST equivalent), using an ST-standard Font
 * Awesome icon + menu_button classes so it matches native styling.
 *
 * #right-nav-panel-tabs is a flex row and #rm_button_selected_ch has flex: 1,
 * so the button (flex: 0 0 auto — see charDrawerExpanded.css) stays compact on
 * the left while the heading takes the remaining width.
 */
function injectExpandButton() {
    const nameHeading = document.getElementById('rm_button_selected_ch');
    if (!nameHeading || document.getElementById(EXPAND_BTN_ID)) return;

    const btn = document.createElement('div');
    btn.id = EXPAND_BTN_ID;
    btn.className = 'menu_button menu_button_icon fa-solid fa-up-right-and-down-left-from-center';
    btn.title = 'Open expanded character drawer';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Route by ST state (see expandTarget): hostable form states open the
        // expanded drawer (create or edit — drawerUI detects which itself); a
        // no-character state opens the Character Browser when it's enabled, and
        // is inert otherwise (the button is greyed to match).
        switch (expandTarget()) {
            case 'create':
            case 'edit':
                if (!isExpandedActive()) takeoverExpanded();
                break;
            case 'browser':
                if (!isCharBrowserActive()) takeoverCharBrowser();
                break;
            case 'group':
                // In a group chat the expand button is the way INTO the browser
                // (the top-bar click is reserved for native group editing). Only
                // when the browser sub-feature is on; off → inert (greyed).
                if (isCharBrowserEnabled() && !isCharBrowserActive()) takeoverCharBrowser();
                break;
            default: // 'disabled' — nothing hostable and the browser is off
                break;
        }
    });

    // Place the button before the display-name heading so it reads left-of-name.
    nameHeading.parentElement?.insertBefore(btn, nameHeading);

    // Sync the tooltip to the current routing target.
    updateExpandButtonState();
}

function removeExpandButton() {
    document.getElementById(EXPAND_BTN_ID)?.remove();
}

/**
 * The right-nav header is re-rendered by ST on selection changes, which can
 * wipe our button. Watch #rm_PinAndTabs (stable parent of #right-nav-panel-tabs,
 * which holds #rm_button_selected_ch) and re-inject as needed. Falls back to
 * #right-nav-panel if the inner container isn't present yet.
 */
function setupExpandButton() {
    teardownExpandButton();
    injectExpandButton();

    const header = document.getElementById('rm_PinAndTabs')
        || document.getElementById('right-nav-panel');
    if (!header) return;

    nameObserver = new MutationObserver(() => {
        // Only maintain the button while NOT already expanded (the name heading
        // stays put; the button is what we re-add if ST rebuilds the header).
        if (!isExpandedActive()) {
            injectExpandButton();        // re-add if ST wiped it
            updateExpandButtonState();   // keep greyed/enabled accurate across
                                         // create<->edit transitions that don't
                                         // fire CHAT_CHANGED
        }
    });
    nameObserver.observe(header, { childList: true, subtree: true });
}

function teardownExpandButton() {
    if (nameObserver) {
        nameObserver.disconnect();
        nameObserver = null;
    }
    removeExpandButton();
}


// ============================================================
// "Open expanded on top-bar click" (redirect native open → our surfaces)
// ============================================================
//
// When BOTH the Expanded Character Drawer toggle (charDrawerExpanded) and its
// "open on click" sub-toggle (charDrawerExpandedOnClick) are on, opening ST's
// native character panel from the top bar opens OUR surface instead:
//   • a hostable form state (character loaded / create form) → the expanded
//     drawer (takeoverExpanded);
//   • anything else (welcome list, group, backed-out create) → the Character
//     Browser (takeoverCharBrowser).
// That's exactly the expand button's routing (see expandTarget), so a click on
// the native button now lands wherever the expand button would have.
//
// Implemented as a class observer on #right-nav-panel (ST's character drawer
// content), the direct analog of WI v2's #WorldInfo watcher. Observing the
// class catches EVERY open path — the top-bar #rightNavDrawerIcon click, a
// programmatic open after import, a slash command — not just one bound handler.
//
// FLOW when the panel transitions to open and both toggles hold:
//   1. Close the native drawer by triggering a click on #rightNavDrawerIcon.
//      The drawer is open, so ST's doNavbarIconClick toggles it back to
//      .closedDrawer — it slides shut BEHIND our overlay (higher z-index), so
//      the user never sees it, and ST's own open/pin state resets cleanly.
//   2. Open our surface (routed by expandTarget; both takeovers are idempotent
//      and, for the drawer, gated on being hostable).
//
// RE-ENTRANCY: closing the drawer in step 1 mutates #right-nav-panel's class,
// re-firing this observer. The `redirecting` flag suppresses that re-entry, and
// the .openDrawer check means the close mutation (now .closedDrawer) is a no-op
// anyway. Belt-and-braces, same as WI v2.
//
// COEXISTENCE with the classic Character Drawer (charDrawerTakeover): that
// feature relocates #character_popup's fields but does NOT redirect the drawer
// open, and our redirect closes the native panel immediately, so the two don't
// fight — the user ends up looking at our overlay either way. When they want
// the native/classic drawer instead, they turn this sub-toggle off.
//
// COEXISTENCE with the expand BUTTON: independent. The button is the manual
// affordance (always available when the parent is on); this is the automatic
// click-to-open layer (only when the sub-toggle is also on). Both route through
// expandTarget → the same takeovers, so they can't double-open (idempotent).

const CHAR_PANEL_ID = 'right-nav-panel';
const CHAR_DRAWER_ICON_ID = 'rightNavDrawerIcon';

let openOnClickObserver = null;
let redirecting = false;

/**
 * True when BOTH gates for "open on top-bar click" hold: the base Expanded
 * Character Drawer toggle AND its "open on click" sub-toggle. The sub-toggle is
 * meaningless without the parent (there'd be nothing to open into), so both must
 * be on. Defensive against settings not being materialized yet.
 */
function isOpenOnClickEnabled() {
    const s = extension_settings[MODULE_NAME];
    return !!(s?.charDrawerExpanded && s?.charDrawerExpandedOnClick);
}

/**
 * Redirect a native character-panel open into our surface: close the native
 * drawer (so it doesn't sit behind the overlay), then open the routed target.
 * Guarded by `redirecting` so the class mutation from closing can't recurse.
 * Routing mirrors the expand button (expandTarget): create/edit → expanded
 * drawer, everything else → Character Browser.
 */
function redirectNativeOpenToOurs() {
    if (redirecting) return;
    redirecting = true;
    try {
        // Close the native drawer. It's currently open, so a top-bar icon click
        // toggles it shut (ST's doNavbarIconClick). Guard the element lookup —
        // if the icon isn't present, we still open our surface below so the user
        // isn't left with nothing.
        const icon = document.getElementById(CHAR_DRAWER_ICON_ID);
        if (icon && typeof $ !== 'undefined' && $(icon).trigger) {
            $(icon).trigger('click');
        } else if (icon) {
            icon.dispatchEvent(new Event('click', { bubbles: true }));
        }
        // Open our surface, deferred a tick so ST finishes its own close
        // bookkeeping (class flips, pin restore) before the overlay lands —
        // avoids interleaving our takeover with ST's teardown.
        setTimeout(() => {
            switch (expandTarget()) {
                case 'create':
                case 'edit':
                    if (!isExpandedActive()) takeoverExpanded();
                    break;
                case 'browser':
                    if (!isCharBrowserActive()) takeoverCharBrowser();
                    break;
                default: // 'disabled' — the observer gates this out, so this is
                    break; // just belt-and-braces (never close-then-open-nothing)
            }
            redirecting = false;
        }, 0);
    } catch (err) {
        console.error('[BD] Char Drawer: open-on-click redirect failed:', err);
        redirecting = false;
    }
}

/**
 * Install (or refresh) the observer that redirects native-panel opens into our
 * surfaces. Installed whenever the PARENT toggle is on; while installed it
 * self-gates PER MUTATION on isOpenOnClickEnabled() (which also reads the
 * sub-toggle), so flipping the sub-toggle alone takes effect immediately with no
 * handler. Torn down when the parent is off. Idempotent: safe to call repeatedly
 * (init + toggle handler). Mirrors WI v2's setupOpenExpandedWatcher.
 */
function setupOpenExpandedWatcher() {
    teardownOpenExpandedWatcher();
    // Only observe when the parent is on at all. When it's off the redirect can
    // never fire (isOpenOnClickEnabled would be false), so skip the observer
    // rather than run a dead one.
    if (!extension_settings[MODULE_NAME]?.charDrawerExpanded) return;

    const host = document.getElementById(CHAR_PANEL_ID);
    if (!host) return;

    openOnClickObserver = new MutationObserver(() => {
        // Gate on BOTH toggles live, the panel actually being open, our overlay
        // not already up, and no in-flight redirect. redirecting suppresses the
        // close-mutation re-entry; the .openDrawer check makes the close a no-op.
        if (redirecting) return;
        if (!isOpenOnClickEnabled()) return;
        if (isExpandedActive() || isCharBrowserActive()) return;
        // Only redirect when we actually have a surface to open AND redirecting
        // is the right call. Stand down for:
        //   'disabled' — no hostable char and the browser is off (nothing to open);
        //   'group'    — a group chat: let ST's NATIVE group side panel open so
        //                the user can edit the group. The expand button in that
        //                panel's header is the way into the browser instead.
        // In both cases we leave ST's native panel alone rather than close it.
        const target = expandTarget();
        if (target === 'disabled' || target === 'group') return;
        if (host.classList.contains('openDrawer')) {
            redirectNativeOpenToOurs();
        }
    });
    openOnClickObserver.observe(host, {
        attributes: true,
        attributeFilter: ['class'],
    });
}

function teardownOpenExpandedWatcher() {
    if (openOnClickObserver) {
        openOnClickObserver.disconnect();
        openOnClickObserver = null;
    }
    redirecting = false;
}
