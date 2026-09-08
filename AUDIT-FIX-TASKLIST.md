# UI Bedazzler Audit Fix Task List

Pre-fix backup: `SillyTavern-UIBedazzler-backup-before-audit-fixes-2026-09-05`

## Correctness and data safety

- [x] Prevent sidecar mutations and saves from racing the initial asynchronous load.
- [x] Make failed sidecar saves retryable and flushable.
- [x] Keep asynchronous Persona Design operations bound to the persona that started them.
- [x] Validate and safely serialize Persona Design banner URLs.
- [x] Render editable Chat Design names without raw HTML interpolation.

## Interaction and accessibility

- [x] Give the Chat Design modal proper dialog semantics and focus management.
- [x] Replace clickable navigation and close `<div>` elements with keyboard-accessible buttons.
- [x] Make style cards keyboard accessible and label icon-only actions.
- [x] Replace the settings and extensions-menu Chat Design launchers with semantic buttons.

## Reliability and cleanup

- [x] Replace the brittle lazy-loading source-format assertions.
- [x] Stop advertising unimplemented Tauri audio/BGM capabilities.
- [x] Reconcile contradictory drawer documentation and repository metadata.
- [x] Remove dead temporary checker/import residue where safe.
- [x] Guard Chat Design initialization against duplicate listener registration.
- [x] Add focused regression tests for sidecar load/save races, persona stale results, and escaping.
- [x] Run targeted regression tests and syntax-check every edited JavaScript file.

## Follow-up refactors

- [ ] Split `chatDesign/modal.js` by editor tab and interaction responsibility.
- [ ] Split `charDrawerExpanded/drawerUI.js` into focused view/controller modules.
- [ ] Add a small, documented one-command test runner if this installed folder is also the development source of truth.
