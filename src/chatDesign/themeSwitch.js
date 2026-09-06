// src/chatDesign/themeSwitch.js
// Per-character UI theme switching.
//
// Replaces the old LALib quick-reply auto-theme-switcher, which fired on
// CHAT_CHANGED at BOOT before LALib had registered its slash commands (/split,
// /tag-list, …) — throwing "Unknown command" on every cold start. That was an
// ordering race the QR could never win from inside itself: the guard command it
// would need was the very thing not yet loaded.
//
// Moving the logic here fixes it structurally. This module's CHAT_CHANGED
// handler is wired during UIBedazzler init, so by definition it cannot run
// until the extension (and thus this code) is loaded. No dependency on LALib or
// any quick reply. Theme application goes through core's own /theme command via
// getContext().executeSlashCommandsWithOptions — the same path sibling
// extensions in this suite use — so it stays correct across ST updates without
// touching any core file.
//
// Data model (in extension_settings.UIBedazzler.chatDesign):
//   themeAssignments : { [charAvatar]: themeName }   one theme per character
//   themeDefault     : string   used when the active character has no
//                               assignment ('' = leave the current theme as-is)
//
// Keyed by cleaned character avatar filename (unique per card, so duplicate
// display names never collide). Storing char -> theme makes "one theme per
// character" free: reassigning overwrites the single entry. Personas are
// ignored: a persona shares the character's chat, so the character owns the
// single theme axis.

import { saveSettingsDebounced } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { power_user } from '../../../../../power-user.js';
import { getChatDesignSettings } from './storage.js';
import { cleanAvatar } from '../design/designUtils.js';
import { getAppearanceAvatar } from './chatScope.js';

const log = () => {};

// ============================================================
// Saved theme enumeration
// ============================================================

/**
 * The user's saved UI themes — the same names ST's own theme picker and the
 * /theme command use. Returns an array of theme name strings, sorted.
 *
 * SOURCE: the #themes <select>, NOT power_user.themes. In ST core the theme
 * list is a module-private `let themes = []` inside power-user.js — it is never
 * placed on the power_user object, so power_user.themes is always empty. The
 * <select id="themes"> IS populated from that private array (one <option> per
 * theme, value = theme name) and stays in sync as themes are added/deleted, so
 * its option values are the authoritative, build-agnostic list. This also picks
 * up whatever the host's own theme machinery exposes (e.g. TauriTavern's
 * day/night "dynamic theme") since those live in the same picker.
 *
 * Falls back to power_user.themes only if the select isn't in the DOM yet
 * (very early boot) and some build does happen to populate it.
 */
export function getSavedThemes() {
    const names = new Set();

    const select = document.getElementById('themes');
    if (select) {
        for (const opt of select.querySelectorAll('option')) {
            const v = (opt.value || opt.textContent || '').trim();
            if (v) names.add(v);
        }
    }

    if (names.size === 0 && Array.isArray(power_user?.themes)) {
        for (const t of power_user.themes) {
            if (t?.name) names.add(t.name);
        }
    }

    return [...names].sort((a, b) => a.localeCompare(b));
}

// ============================================================
// Assignment map access
// ============================================================

/**
 * Ensure the theme sub-keys exist on the chatDesign settings object and return
 * it. Backfills for configs created before this feature existed.
 */
function ensureThemeShape() {
    const cd = getChatDesignSettings();
    if (!cd.themeAssignments || typeof cd.themeAssignments !== 'object') {
        cd.themeAssignments = {};
    }
    if (typeof cd.themeDefault !== 'string') {
        cd.themeDefault = '';
    }
    return cd;
}

/** Get the whole { [charAvatar]: themeName } assignment map. */
export function getThemeAssignments() {
    return ensureThemeShape().themeAssignments;
}

/** Get the default theme name ('' = no default; keep the current theme). */
export function getDefaultTheme() {
    return ensureThemeShape().themeDefault;
}

/** Set the default theme name (pass '' to clear). */
export function setDefaultTheme(themeName) {
    ensureThemeShape().themeDefault = typeof themeName === 'string' ? themeName : '';
    saveSettingsDebounced();
}

/** Get the theme assigned to one character avatar, or '' if none. */
export function getThemeForCharacter(charAvatar) {
    const key = cleanAvatar(charAvatar);
    return ensureThemeShape().themeAssignments[key] || '';
}

/**
 * Assign a theme to a character. An empty/falsy themeName REMOVES the
 * assignment. Because the map is keyed by character, this inherently enforces
 * "one theme per character" — no need to unassign from any previous theme.
 */
export function setThemeForCharacter(charAvatar, themeName) {
    const cd = ensureThemeShape();
    const key = cleanAvatar(charAvatar);
    if (!key) return;
    if (themeName) {
        cd.themeAssignments[key] = themeName;
    } else {
        delete cd.themeAssignments[key];
    }
    saveSettingsDebounced();
}

// ============================================================
// Active-character resolution + apply
// ============================================================

/**
 * The theme name that should be active for the current chat:
 *   1. the active character's assigned theme, if any;
 *   2. otherwise the configured default theme;
 *   3. otherwise '' → caller leaves the current theme untouched.
 */
export function resolveThemeForCurrentChat() {
    const cd = ensureThemeShape();
    const avatar = getAppearanceAvatar();
    if (avatar && cd.themeAssignments[avatar]) {
        return cd.themeAssignments[avatar];
    }
    return cd.themeDefault || '';
}

/**
 * Apply the theme resolved for the current chat, if any. No-ops when:
 *   - nothing resolves (no assignment and no default), or
 *   - the resolved theme is already active (avoids a needless reload/flash on
 *     every chat switch), or
 *   - the resolved theme isn't in the saved-themes list (stale name — a theme
 *     was renamed/deleted after assignment; skip rather than error).
 *
 * Applies via core's /theme command. The name is wrapped in quotes so themes
 * with spaces (e.g. "Nebula Midnight") resolve; any embedded quote is stripped.
 */
export function applyThemeForActiveChar() {
    const target = resolveThemeForCurrentChat();
    if (!target) return; // nothing assigned, no default → leave current theme
    if (power_user?.theme === target) return; // already active

    // Guard against a stale assignment referencing a deleted/renamed theme —
    // /theme would toast an error otherwise.
    if (!getSavedThemes().includes(target)) {
        log('Assigned theme not found, skipping:', target);
        return;
    }

    const safe = String(target).replace(/"/g, '');
    try {
        const ctx = getContext();
        if (ctx?.executeSlashCommandsWithOptions) {
            ctx.executeSlashCommandsWithOptions(`/theme "${safe}"`);
        } else if (ctx?.executeSlashCommands) {
            ctx.executeSlashCommands(`/theme "${safe}"`);
        }
    } catch (e) {
        console.error('[BD] Failed to apply theme:', e);
    }
}
