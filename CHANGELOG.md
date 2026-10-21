# Changelog

Earlier releases were not recorded here.

## Unreleased

## 0.1.10 — 2026-10-21

- Kept the Groups gallery visible when creating a group from Groups in the expanded character browser. Cancel restores the selected group's details and preserves the gallery's search, sorting, and page.
- Kept the Add Members list on its current page after adding a group member when Character Browser is enabled, including in the native group panel. If the last page becomes empty, the picker moves to the nearest remaining page.
- Closed the restored character drawer on startup when no chat is active and Character Browser plus Open on top-bar click are enabled. The top-bar button still opens the browser on request.
- Made group creation clearer in the expanded character browser: settings toggles come first, followed by text buttons for Add to Favorites and Create. Hid the redundant Back button in this view.
- Fixed dialogue gradients turning black or disappearing inside animated spans added by regex scripts. Spans retain their animations and can still provide their own colors or gradients.

## 0.1.9 — 2026-10-13

- Fixed theme text shadows darkening custom gradient Text Tags in message text and dialogue. Explicit shadows and glows in the tag's CSS are preserved.
- Added an “Ignore surrounding text colors” checkbox for each Text Tag. Effects can bypass message/dialogue colors and gradients, using their own CSS color or the theme's text color.
- Fixed animated Text Tags disappearing inside character and persona dialogue gradients. Tags retain the gradient during Pulse, Shake, and other CSS animations, and can still supply their own colors or gradients.

## 0.1.8 — 2026-10-09

- Added Fonts Text Tags with custom wrappers, scoped CSS/keyframe animations, copyable markup, starter effects, and live previews. Tags affect display only and follow Fonts style assignments.
- Fixed clicks in expanded text editors closing Advanced Definitions underneath them and preventing editor focus.
- Resolved the active persona name in shared narrator lore prompts instead of leaving `{{user}}` literal.
- Added an MIT license and started tracking project changes in this changelog.
