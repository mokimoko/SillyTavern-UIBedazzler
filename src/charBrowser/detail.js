// src/charBrowser/detail.js
// Character Browser — right detail panel. Populated when a card is selected
// (NOT a chat opener — clicking a card fills THIS panel; opening a chat is the
// Open Chat action here). Shows the honest fields: fading avatar → name → tags
// → description blurb → real stats → action buttons.
//
// PHASE 3: added the action row — Open Chat (most-recent, closes the browser) +
// a chat-picker dropdown (choose which chat) + Edit (bridge to the expanded
// EDIT drawer). Duplicate/Export/Delete are deferred per the PLAN. The ST calls
// live in actions.js; this module only builds DOM and wires clicks to injected
// callbacks, so it stays free of ST/selection logic.
//
// DESCRIPTION = truncated creator_notes (reader-facing blurb), softened to
// plain-ish text — NOT the prompt `description` field. See charData's model.

import { getCharacterChats } from './charData.js';
import { applyChipColor } from './grid.js';
import { withControlBusy } from './uiFeedback.js';

const log = () => {};

const NOTES_CAP = 320; // hard length cap so the blurb stays a clean summary

// Action callbacks, injected once by the shell (drawerUI.wireChrome-equivalent).
// Kept at module scope so renderDetail doesn't need them threaded through every
// call — the shell sets them at init and they're stable for the panel's life.
let actions = {
    onOpenChat: null,   // (model, chatFile?) => void   chatFile omitted = most recent
    onEdit: null,       // (model) => void
};

/**
 * Register the action callbacks the panel's buttons invoke. Called by the shell
 * on takeover, before any renderDetail. Safe to call repeatedly (last wins).
 */
export function setDetailActions(next) {
    actions = { ...actions, ...(next || {}) };
}

// ============================================================
// Public API
// ============================================================

/**
 * Render the panel for a model into the given container (#wl-cb-detail-body).
 * DOM-created so character-controlled text is set via textContent. Replaces any
 * prior content (single-selection panel).
 */
export function renderDetail(host, model) {
    if (!host) return;
    host.innerHTML = '';
    if (!model) return;

    // Hero: full-width avatar filling the top, fading at the bottom, with the
    // name + tags overlaid on it (mirrors the card treatment).
    host.appendChild(buildHero(model));
    const blurb = buildBlurb(model);
    if (blurb) host.appendChild(blurb);
    host.appendChild(buildStats(model));
    // Actions last (bottom of the panel, matching the mockup): Open Chat +
    // chat-picker + Edit. Async chat list populates the picker after paint.
    host.appendChild(buildActions(model));
}

/** Clear the panel (on drawer close / no selection). */
export function clearDetail(host) {
    if (host) host.innerHTML = '';
}

// ============================================================
// Builders
// ============================================================

/**
 * Hero block: the avatar fills the top of the panel and fades at the bottom,
 * with the name and tags overlaid on the lower portion inside a scrim. Same
 * visual language as the grid cards. Character-controlled text via textContent.
 */
function buildHero(m) {
    const hero = document.createElement('div');
    hero.className = 'wl-cb-detail-hero';

    const media = document.createElement('div');
    media.className = 'wl-cb-detail-media';
    if (m.avatarUrl) {
        const img = document.createElement('img');
        // The hero is a single LARGE image, so use the full-resolution original
        // (/characters/<avatar>, the same path ST uses for its zoomed avatar)
        // instead of m.avatarUrl's 96×144 thumbnail, which looked fuzzy blown up.
        // Grid + tag-hub cards keep the light thumbnail (many images at once);
        // only this one-at-a-time hero pays the full-res cost. Falls back to the
        // thumbnail if the raw avatar filename is somehow unavailable.
        img.src = (m.avatar && m.avatar !== 'none')
            ? `/characters/${encodeURIComponent(m.avatar)}`
            : m.avatarUrl;
        img.alt = '';
        media.appendChild(img);
    } else {
        media.classList.add('wl-cb-detail-noimg');
    }
    hero.appendChild(media);

    const overlay = document.createElement('div');
    overlay.className = 'wl-cb-detail-overlay';

    const name = document.createElement('div');
    name.className = 'wl-cb-detail-name';
    name.textContent = m.name;
    name.title = m.name;
    overlay.appendChild(name);

    // Bedazzler "title" (subtitle) under the name — dimmer/smaller, display
    // only. Set in the expanded drawer; stored in the sidecar (not the card).
    if (m.title) {
        const title = document.createElement('div');
        title.className = 'wl-cb-detail-title';
        title.textContent = m.title;
        title.title = m.title;
        overlay.appendChild(title);
    }

    if (m.tagChips.length) {
        const row = document.createElement('div');
        row.className = 'wl-cb-detail-tags';
        for (const t of m.tagChips) {
            const chip = document.createElement('span');
            chip.className = 'wl-cb-chip';
            chip.textContent = t.name;
            applyChipColor(chip, t);
            row.appendChild(chip);
        }
        overlay.appendChild(row);
    }

    hero.appendChild(overlay);
    return hero;
}

/**
 * Description blurb from creator_notes: soften markdown to plain-ish text and
 * hard-cap the length so the panel stays a readable summary, never a wall of
 * formatting. Returns null when there are no notes. (No title tooltip on the
 * capped text — the native tooltip flickered on scroll; removed for now.)
 */
function buildBlurb(m) {
    // Strip HTML/CSS first so styled cards contribute only their prose, THEN
    // soften whatever markdown remains. Visual 4-line clamp lives in the CSS.
    const soft = softenMarkdown(stripNonPlaintext(m.notes || ''));
    if (!soft) return null;
    const el = document.createElement('div');
    el.className = 'wl-cb-detail-blurb';
    const capped = soft.length > NOTES_CAP ? soft.slice(0, NOTES_CAP).trimEnd() + '…' : soft;
    el.textContent = capped;
    return el;
}

/**
 * Strip everything that isn't plain prose. Creator notes frequently ship a
 * styled "card" — <style> blocks, HTML markup, raw CSS rules — none of which
 * belongs in a one-glance blurb. This removes the code and keeps the human text.
 * Conservative on purpose: the raw-CSS-block rule only fires on genuine
 * `selector { prop: value; }` shapes, so prose with a stray brace is left alone.
 */
function stripNonPlaintext(s) {
    return String(s)
        // Whole code blocks — content and all — removed wholesale.
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')                        // HTML comments
        // Raw CSS rule blocks that leak in without a <style> wrapper. Requires a
        // `prop: value;` inside the braces; the selector part stops at newlines
        // so it can't swallow a preceding sentence.
        .replace(/[^{}<>\n]*\{[^{}]*:[^{}]*;[^{}]*\}/g, '')
        // Any remaining HTML/XML tags → gone (inner text is kept).
        .replace(/<\/?[a-z][^>]*>/gi, '')
        // Decode the handful of entities that would otherwise survive as text.
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;|&apos;/gi, "'");
}

/**
 * Minimal markdown-softener: strip the common syntax so a notes blob reads as
 * plain prose. Not a full parser — just removes the noise (headings, emphasis
 * markers, list bullets, links→text, code fences, images) and collapses
 * whitespace. Deliberately conservative so it never mangles plain text.
 */
function softenMarkdown(s) {
    return String(s)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')       // images
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')     // links → text
        .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')       // code spans/fences
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')          // headings
        .replace(/^\s{0,3}>\s?/gm, '')               // blockquotes
        .replace(/^\s{0,3}[-*+]\s+/gm, '')           // bullet list markers
        .replace(/(\*\*|__|\*|_|~~)/g, '')           // emphasis markers
        .replace(/\r/g, '')
        .replace(/\n{2,}/g, '\n')                     // collapse blank lines
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

/**
 * Stats block — ONLY real, ST-tracked fields (PLAN: no invented Source/Status).
 * Rows are omitted when the underlying value is absent, so the panel never
 * shows an empty or placeholder line.
 */
function buildStats(m) {
    const box = document.createElement('div');
    box.className = 'wl-cb-detail-stats';

    const rows = [];
    if (m.creator) rows.push(['Creator', m.creator]);
    const created = formatDate(m.createDate);
    if (created) rows.push(['Created', created]);
    const lastUsed = formatLastUsed(m.lastUsed);
    if (lastUsed) rows.push(['Last used', lastUsed]);
    rows.push(['Messages', String(m.msgCount || 0)]);
    if (m.version) rows.push(['Version', m.version]);

    for (const [label, value] of rows) {
        const row = document.createElement('div');
        row.className = 'wl-cb-stat-row';
        const l = document.createElement('span');
        l.className = 'wl-cb-stat-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.className = 'wl-cb-stat-value';
        v.textContent = value;
        v.title = value;
        row.append(l, v);
        box.appendChild(row);
    }
    return box;
}

/**
 * Action block (bottom of the panel): the primary Open Chat button, a chat-
 * picker dropdown beneath it (choose WHICH chat; most-recent is the implicit
 * default when left untouched), and an Edit button. Duplicate/Export/Delete are
 * deferred per the PLAN — not rendered so the panel stays honest about what's
 * wired.
 *
 * Buttons call the injected `actions` callbacks (set by the shell). The chat
 * list is fetched async and fills the <select> after paint; until then the
 * picker shows a single "Most recent chat" option and Open Chat still works
 * (it opens most-recent by default).
 */
function buildActions(m) {
    const box = document.createElement('div');
    box.className = 'wl-cb-detail-actions';

    // Primary: Open Chat. Uses the picker's current value (most-recent when the
    // user hasn't chosen a specific chat).
    const openBtn = document.createElement('button');
    openBtn.className = 'wl-cb-act wl-cb-act-primary';
    openBtn.innerHTML = '<i class="fa-solid fa-comment"></i> ';
    openBtn.appendChild(document.createTextNode('Open Chat'));

    // Chat picker. Default option = most recent (empty value → actions.onOpenChat
    // called with no file → openMostRecentChat). Real chats fill in async.
    const picker = document.createElement('select');
    picker.className = 'wl-cb-chat-picker';
    picker.title = 'Choose which chat to open';
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = 'Most recent chat';
    picker.appendChild(defOpt);

    openBtn.addEventListener('click', () => {
        const file = picker.value || '';
        // Spinner on the button until the open resolves (the browser usually
        // tears down first). Also disables the picker so a mid-open change can't
        // race the load.
        picker.disabled = true;
        withControlBusy(openBtn, () => actions.onOpenChat?.(m, file || undefined))
            .finally(() => { if (picker.isConnected) picker.disabled = false; });
    });

    // Edit → CDE bridge.
    const editBtn = document.createElement('button');
    editBtn.className = 'wl-cb-act';
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> ';
    editBtn.appendChild(document.createTextNode('Edit'));
    // Spinner on Edit until the select-and-open-drawer bridge resolves.
    editBtn.addEventListener('click', () => withControlBusy(editBtn, () => actions.onEdit?.(m)));

    box.append(openBtn, picker, editBtn);

    // Populate the picker with the character's real chats (newest first). Guard
    // against a stale fill if the selection changed before the fetch resolved:
    // stamp the box with the avatar and bail if it no longer matches.
    box.dataset.avatar = m.avatar;
    populateChatPicker(picker, box, m);

    return box;
}

/**
 * Fetch the character's chats and append them to the picker. Newest-first; the
 * top one is the most-recent, but we leave the "Most recent chat" default
 * selected (value '') so Open Chat's default path stays "open most recent" even
 * after the list loads. Each option carries the extension-less file name as its
 * value (ready for openCharacterChat).
 */
async function populateChatPicker(picker, box, m) {
    let chats = [];
    try {
        chats = await getCharacterChats(m.avatar);
    } catch { chats = []; }
    // Selection may have moved on while we awaited — don't fill a recycled node.
    if (box.dataset.avatar !== m.avatar || !picker.isConnected) return;
    if (!chats.length) return;

    for (const chat of chats) {
        const opt = document.createElement('option');
        opt.value = chat.file;
        const count = chat.messages ? ` (${chat.messages})` : '';
        opt.textContent = chat.label + count;
        opt.title = chat.label;
        picker.appendChild(opt);
    }
}

// ============================================================
// Formatting
// ============================================================

/** ST create_date is a human string already (e.g. "2024-4-12 @14h 30m 5s ...")
 *  or a number; show a clean YYYY-MM-DD when we can parse one, else the raw
 *  leading date token, else nothing. */
function formatDate(raw) {
    if (!raw) return '';
    const str = String(raw);
    // ST's create_date often starts "YYYY-M-D" — grab that and normalise.
    const mDate = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (mDate) {
        const [, y, mo, d] = mDate;
        return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const t = Date.parse(str);
    if (!Number.isNaN(t)) {
        const dt = new Date(t);
        return dt.toISOString().slice(0, 10);
    }
    return '';
}

/** date_last_chat is epoch ms (0 = never). Show an absolute date, or "Never". */
function formatLastUsed(ms) {
    if (!ms) return 'Never';
    const dt = new Date(ms);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
}
