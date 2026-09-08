# UI Bedazzler

Tired of the default look? UI Bedazzler is a [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that redesigns some UI elements and adds some new ones.

> **Note:** May conflict with other extensions that restyle the same parts of SillyTavern.

Enjoy! ;) - Moki

## Compatibility

- **TauriTavern** — Recent Chats keeps exact avatar identities for characters that share the same display name.
- **[Guided Generations](https://github.com/Samueras/GuidedGenerations-Extension)** — Chat Design integration.
- **[TopInfoBar](https://github.com/SillyTavern/Extension-TopInfoBar)** — Chat Design integration.
- **[MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)** — Side button support.
- **[Weather Cycle](https://github.com/nullara/st-weather-cycle)** — Side button support and a few tweaks.
- **[Aspect: Evolutia](https://github.com/Vectricity/st-aspect-evolutia)** — Character and persona drawer integration.

---

## Persona Lore

Adds a tab to personas so you can attach information that the narrator or specific characters should know, but that *isn't* known by other characters. This gets injected into the prompt automatically — great for secrets, backstory details, or character-specific context that shouldn't bleed across the cast.

## Design

Tabs in the persona drawer and in the character drawer's Advanced section let you assign colors to dialogue, character name, and message container, plus set a banner image. Make each character's messages visually distinct at a glance.

## Chat Design

Open Chat Design from the extension settings or context menu. Create reusable looks for chat text, containers, banners, avatars, backgrounds, cursors, and the surrounding UI, then assign them to characters or personas. Start with a built-in Style Pack, or import and export your own. Local fonts must be installed on every device and need a reload; themes and icon sets are character-only.

## Light Theme Compatibility

Enable **Light Theme Compatibility** under **Interface** to automatically adapt SillyTavern's native drawer headers, form fields, dropdowns, and text shadows when the active UI tint is light. Dark themes are left unchanged.

## Weather Cycle Compatibility

Enable **Protect Weather Cycle Background** under **Interface** to prevent
`st-weather-cycle`'s Heat Haze / Background Blur canvas from replacing detailed
backgrounds with stretched horizontal bands. Rain, snow, fog, lightning, tint,
controls, and the weather badge continue to work.

## Variable Viewer

Run `/variables` to open a compact viewer for local and global SillyTavern variables. Search and unfold nested values, copy paths or values, edit data inline, and import or export either scope. Batch flushing follows the active tab and removes only the variables shown by the current search. The viewer is built into UI Bedazzler and does not require another extension.

## Expanded Drawers

Full-screen workspaces that replace SillyTavern's cramped native drawers. Each one adds an expand button to its native drawer, and can optionally hijack the top-bar button so a normal click opens it directly (**Open on top-bar click**). Enable them under **Drawer redesigns** in the extension settings.

- **Character** — a 3-column editor for the loaded character, plus a **Character Browser** hub for browsing and managing characters when none is loaded. Also opens via `/bdz-charbrowser`.
- **World Info** — a lorebook workspace with a library rail, grouped note list, inline editor, presets, global scan/budget controls, and a simulator for inspecting activation. Also opens via `/bdz-widrawer`.
- **Presets** — a 3-column Chat Completion workspace (Overview | Sections | Editor).

## Screenshots

*World Info Drawer*
![World Info Drawer](https://files.catbox.moe/d219u1.png)

*Character Browser*
![Character Browser](https://files.catbox.moe/5cl4vo.png)

*Character Drawer*
![Character Drawer](https://files.catbox.moe/qdyoa1.png)

*Expanded Preset Drawer*
![Expanded Preset Drawer](https://files.catbox.moe/bjjfsk.png)

## Alternate Icons and Loading Screen

Change SillyTavern's general and top-bar icon sets independently. Custom loading screens are available with [Nebula Loader](https://github.com/mokimoko/SillyTavern-NebulaLoader).

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
