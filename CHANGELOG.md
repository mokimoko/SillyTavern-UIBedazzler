# Changelog

Earlier releases were not recorded here.

## Unreleased

## 0.1.9 — 2026-10-13

- Fixed theme text shadows darkening custom gradient Text Tags in message text and dialogue. Explicit shadows and glows in the tag's CSS are preserved.
- Added an “Ignore surrounding text colors” checkbox for each Text Tag. Effects can bypass message/dialogue colors and gradients, using their own CSS color or the theme's text color.
- Fixed animated Text Tags disappearing inside character and persona dialogue gradients. Tags retain the gradient during Pulse, Shake, and other CSS animations, and can still supply their own colors or gradients.
- Temporarily pause Chat Design while Easthaven’s native VN is active so its eye button and extension controls stay reachable. Restore it on exit without changing the saved enable setting; watch only the VN mode class.

## 0.1.8 — 2026-10-09

- Added Fonts Text Tags with custom wrappers, scoped CSS/keyframe animations, copyable markup, starter effects, and live previews. Tags affect display only and follow Fonts style assignments.
- Fixed clicks in expanded text editors closing Advanced Definitions underneath them and preventing editor focus.
- Resolved the active persona name in shared narrator lore prompts instead of leaving `{{user}}` literal.
- Added an MIT license and started tracking project changes in this changelog.
