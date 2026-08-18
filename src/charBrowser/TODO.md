# Character Browser — follow-ups

Living to-do for the Character Browser (`src/charBrowser/`). The browser now
ships as a real feature: enabled by the **Character Browser** sub-toggle under
Expanded Character Drawer (runtime gate `isCharBrowserEnabled` = parent AND
sub), reachable via the expand button on a no-character screen, the drawer's
Back arrow, the `/bdz-charbrowser` command, and (with "Open on top-bar click")
a native top-bar click.

## Deferred features

### Folders view
- Folder *filtering* works today (nav "Folders" facet group → `filterByTag` on
  `folder_type` tags).
- Missing: folder **management** (create/rename/recolor/assign), analogous to the
  Tag Hub. Consider a folder hub or folding folder CRUD into the existing Tag
  Hub editor.

## Polish / watch

- **Tag-fit badge estimate** (`grid.js` `fitAllTagRows`): the "+N" overflow badge
  now uses a single read pass with a *reserved-width estimate* (`badgeEst`)
  instead of a re-measure loop. If a "+N" badge ever visibly wraps to a second
  line, bump the estimate. Erring generous just shows one fewer chip.
- **Stale doc comments**: a couple of headers still say tag data lives in
  "extension settings" — it's the shared sidecar (`charBrowser` section) now.
  Cosmetic; clean up when touching those files (`tagHub.js`, `charData.js`).

## Done (for reference)
- **Groups view** — nav "Groups" item (Views section, ABOVE Tags) flips the
  center into a **Groups Hub** (`groupHub.js`), a browse + basic-manage surface
  parallel to the Tag Hub. Group view-models come from `getGroupModels()`
  (charData) over `getContext().groups` — collage/custom avatar, members,
  fav, `date_last_chat`, chats, and tag chips (groups ride the same `tagMap`
  keyed by group id). Cards (hero collage · name · N members · tag chips · mini-
  avatars · fav star) select into the shared detail panel: avatar + name + tags,
  stats (Members / Last used / Chats), a **Members list** (each row's pencil
  redirects to that CHARACTER's edit drawer — member edits are character edits),
  and actions (Open Chat + past-chat picker via `openGroup`/`openGroupChat`,
  favorite toggle via `setGroupFavorite`, Delete-with-confirm via
  `deleteGroupById`). New Group routes to ST's native create flow. Nav badge =
  group count (pushed through `setFacets`); live-sync refreshes the hub on
  `GROUP_UPDATED` + the existing character/page events.
  - Scope choices (this pass): card click SELECTS (not open); tags are chips-only
    (no group tag-assignment UI); group-level editing (rename / member CRUD /
    strategy) stays with ST's native panel — only per-member character edits and
    fav/delete are inline.
  - Follow-ups: group tag ASSIGNMENT (bulk-tag / card menu / Tag Hub picker don't
    yet include groups); inline group rename / add-remove members (would host the
    native `#rm_group_chats_block` in edit mode, like the create flow does);
    per-group message-count stat (groups don't expose one like the char stats
    store — omitted).
- **Group-create tag bug (fixed)** — while the native `#rm_group_chats_block` is
  hosted in the detail column (create mode), a debounced live-sync refresh fired
  the grid's `onSelect`, which repainted CHARACTER detail into the shared detail
  body — wiping the create panel mid-tag-entry ("kicked off the creation scene",
  seen on ~the second tag as the ~250ms debounce landed). Fixed by guarding grid
  `onSelect` on `groupCreateActive` (and `isGroupHubActive`), the same way it was
  already guarded for the Tag Hub.
- **Search scope** — top-bar search (`filterBySearch`) now matches NAME +
  CREATOR + TAG names (substring, case-insensitive), up from name-only. Uses the
  view-model fields already present (`m.name`, `m.creator`, `m.tags` — the full
  tag list, so a tag hidden from the display chips still matches). Stays a plain
  substring test, NOT ST's opt-in Fuse.js fuzzy search (that broader, weighted,
  fuzzy_search-gated field set — description/scenario/etc. — was left out by
  choice). Placeholder updated to "Search name, creator, tags…".
- **Persona (bulk + card menu)** — ports ST's native "Persona" action
  (`BulkEditOverlay.handleContextMenuPersona` → `convertCharacterToPersona`,
  which clones name/description/avatar into a `"{name} (Persona).png"` user
  persona). Bulk = convert each picked char (matches native, which loops the
  selection); card menu = convert the one. `convertCharacterToPersona` is NOT on
  `getContext()`, so `bulkActions.js` reaches it via a lazy `import()` of
  `personas.js` (same pattern as `deleteCharacter`); conversions run
  sequentially so the native confirm popups (name collision / macro swap) don't
  stack. Buttons enabled in `drawerUI.js` / `cardMenu.js`.
- Character Browser settings toggle + dependency on Expanded Character Drawer.
- Slash commands renamed: `/charbrowser` → `/bdz-charbrowser`,
  `/bdz-widrawer` is the expanded World Info command.
- Expand button / Back arrow / open-on-click all gated on the browser toggle.
- WI note "type" moved off ST entries into the shared sidecar (`noteTypes`),
  riding the subject reconciler (no more `wlType` in exported lorebooks).
