# Changelog

Earlier releases were not recorded here.

## Unreleased

## 0.1.12 — 2026-11-15

- Added horizontal Side Buttons with sideways scrolling and drag grips at each end. Choose the orientation in extension settings or Chat Design.
- Preserved browser zoom gestures over horizontal Side Buttons instead of treating them as sideways scrolling.
- Added saved Side Button ordering with drag handles, arrow controls, and a reset option. Orientation and order apply to all characters; unavailable extensions keep their place in saved orders.
- Kept Side Buttons in place through browser zoom and window resizing. Strips near an edge keep their gap, freely placed strips keep their relative position, and temporary screen constraints no longer overwrite the preferred placement. Existing saved positions migrate automatically.
- Kept Side Buttons visible and clickable when placed over chat messages. Weather Cycle and Super Agents panels now adapt to the strip's orientation and available screen space.
- Kept open Weather Cycle and Super Agents panels attached to their buttons while scrolling the strip or resizing the window.
- Added an Illustration Studio side button when its extension is available, initially before Sprite Variations in the button order. Its duplicate Extensions-menu entry is hidden while Side Buttons is enabled and restored when disabled.
- Added a Sprite Variations side button when the Character Expressions Local Classifier Bridge provides it.
- Fixed ST-CoPilot's floating icon reappearing when opening or minimizing its window while the replacement side button is active.
- Added clear-all controls for topic tags and condition words in expanded worldbook entries.
- Made “Read for this chat” in the expanded worldbook drawer remember whether it is collapsed after reopening the drawer or reloading the app.
- Added separate Grab and Grabbing custom-cursor support, including open/closed-hand filename recognition, without confusing them with the pointing Hand cursor.
- Expanded custom-cursor targets and manual overrides for Help, Wait, Progress, Crosshair, Zoom In/Out, and Alias. Improved coverage for cropper tools, sliders, resize handles, drag handles, sortable rows, and scrollbar thumbs.
- Added t-shirt, floppy disk, mountain/sun, home, mouse pointer, square, icons, heart, and theatre-mask mappings across all six general UI icon sets, including their Font Awesome aliases.

## 0.1.11 — 2026-11-04

- Added a Notebook side button that toggles the installed Notebook extension's editor. The original trigger is restored when Side Buttons is turned off.

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
