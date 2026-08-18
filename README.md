# UI Bedazzler

Tired of the default look? UI Bedazzler is a [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that redesigns some UI elements and adds some new ones.

> **Note:** Probably not compatible with most other UI extensions.

Enjoy :) -moki

---

## Persona Lore

Adds a tab to personas so you can attach information that the narrator or specific characters should know, but that *isn't* known by other characters. This gets injected into the prompt automatically — great for secrets, backstory details, or character-specific context that shouldn't bleed across the cast.

## Design

Tabs in the persona drawer and in the character drawer's Advanced section let you assign colors to dialogue, character name, and message container, plus set a banner image. Make each character's messages visually distinct at a glance.

## Chat Design

Access from the extension's settings or the extension context menu. Create styles for various elements like banners and assign them to characters and personas.

## Variable Viewer

Run `/variables` to open a compact viewer for local and global SillyTavern variables. Search and unfold nested values, copy paths or values, edit data inline, and import or export either scope. Batch flushing follows the active tab and removes only the variables shown by the current search. The viewer is built into UI Bedazzler and does not require another extension.

## Expanded Drawers

Full-screen workspaces that replace SillyTavern's cramped native drawers. Each one adds an expand button to its native drawer, and can optionally hijack the top-bar button so a normal click opens it directly (**Open on top-bar click**). Enable them under **Drawer redesigns** in the extension settings.

- **Character** — a 3-column editor for the loaded character, plus a **Character Browser** hub for browsing and managing characters when none is loaded. Also opens via `/bdz-charbrowser`.
- **World Info** — a lorebook workspace with a library rail, grouped note list, inline editor, presets, global scan/budget controls, and a simulator for inspecting activation. Also opens via `/bdz-widrawer`.
- **Presets** — a 3-column Chat Completion workspace (Overview | Sections | Editor).

## Tabbed Drawers

Lighter touch — just tab navigation added to the native panels. 

## Installation

Use SillyTavern's built-in extension installer:

1. Open **Extensions** → **Install Extension**
2. Paste this URL:
   ```
   https://github.com/mokimoko/SillyTavern-UIBedazzler
   ```
3. Click **Install** and reload if prompted

## Credits

This was inspired by features I've liked in other extensions, like [WorldInfoPresets](https://github.com/LenAnderson/SillyTavern-WorldInfoPresets) and [AvatarBanners](https://github.com/city-unit/SillyTavern-AvatarBanners) (which was itself inspired by banner CSS by the creator of [MoonlitEchoes](https://www.chub.ai/users/MoonlitEchoes)).
