// src/presetDrawerExpanded/groupRender.js
// Phase 3b/6 — decorate the native prompt-manager rows with group chrome.
//
// PURELY VISUAL for AUTO groups: reads block CONTENT from oai_settings (never
// mutates it) and the DISPLAYED order from the DOM rows, computes groups
// (groupParser.js), then paints a header + colored left spine + subtle bg over
// the run of rows. ST rebuilds its list on any change, so we re-derive on a
// debounced observer and re-apply — headers/classes are disposable decoration.
//
// MANUAL groups add the one bit of PERSISTED structure: a user drops a "group
// starts here" anchor on a block (stored by ST's stable pm-identifier, per
// preset, in Bedazzler settings — never in the preset JSON). At render we
// resolve each anchor back to its current row index, drop any whose block is
// gone (clean orphan handling), and hand them to computeGroups as top-priority
// starts. A per-preset "Auto-detect" toggle lets a preset run manual-only.

import { computeGroups } from './groupParser.js';
import { getSetting, setSetting } from '../settings.js';

// oai_settings holds the block CONTENT (the DOM only has names/tokens). Loaded
// LAZILY via dynamic import so a path/version mismatch can never break extension
// boot — worst case the import fails, oaiRef stays null, and groups just don't
// render (with a console warning).
let oaiRef = null;
let oaiLoading = null;
function ensureOai() {
    if (oaiRef) return Promise.resolve(oaiRef);
    if (!oaiLoading) {
        oaiLoading = import('../../../../../openai.js')
            .then((m) => { oaiRef = m.oai_settings || null; return oaiRef; })
            .catch((e) => { console.warn('[BD Preset Expanded] openai.js load failed; groups disabled:', e); return null; });
    }
    return oaiLoading;
}

const HEAD_CLASS = 'wl-pe-group-head';
const PALETTE = ['#97a7c6', '#8fae7d', '#a795c8', '#c4877d', '#6d9dc5', '#c9a15a', '#7fb3a0', '#b98cc4'];

let observer = null;
let rafPending = false;
let currentCenter = null;           // for re-render after a color change
const collapsed = new Set();        // group keys the user has collapsed
const colorByName = new Map();      // default (unsaved) color per group key

const keyOf = (g) => `${g.kind}:${g.name}`;

/** The active preset's name — the persistence key for colors and manual groups. */
function currentPreset() {
    const sel = document.getElementById('settings_preset_openai');
    if (!sel) return 'default';
    return sel.value || sel.selectedOptions?.[0]?.text || 'default';
}

/** Saved color (Bedazzler settings) if any, else a stable palette default. */
function colorFor(g) {
    const k = keyOf(g);
    const saved = getSetting('presetGroupColors')?.[currentPreset()]?.[k];
    if (saved) return saved;
    if (!colorByName.has(k)) colorByName.set(k, PALETTE[colorByName.size % PALETTE.length]);
    return colorByName.get(k);
}

/** Persist a color for this group under the active preset, then repaint. */
function setGroupColor(g, color) {
    const preset = currentPreset();
    const all = getSetting('presetGroupColors') || {};
    if (!all[preset]) all[preset] = {};
    all[preset][keyOf(g)] = color;
    setSetting('presetGroupColors', all);
    if (currentCenter) renderGroups(currentCenter);
}

// ── Manual group persistence (per preset, by ST pm-identifier) ──
function manualStore() { return getSetting('presetGroupsManual') || {}; }
function manualFor(preset) { return manualStore()[preset] || []; }
function saveManual(preset, arr) {
    const all = manualStore();
    if (arr.length) all[preset] = arr; else delete all[preset];
    setSetting('presetGroupsManual', all);
}
function addManual(anchorId, name) {
    const p = currentPreset();
    const arr = manualFor(p).slice();
    if (arr.some((a) => a.anchorId === anchorId)) return; // one anchor per block
    arr.push({ anchorId, name });
    saveManual(p, arr);
    if (currentCenter) renderGroups(currentCenter);
}
function renameManual(anchorId, name) {
    const p = currentPreset();
    const arr = manualFor(p).map((a) => (a.anchorId === anchorId ? { ...a, name } : a));
    saveManual(p, arr);
    if (currentCenter) renderGroups(currentCenter);
}
function removeManual(anchorId) {
    const p = currentPreset();
    saveManual(p, manualFor(p).filter((a) => a.anchorId !== anchorId));
    if (currentCenter) renderGroups(currentCenter);
}

// ── Persistent grouping MODE (tri-state) ──
//   'auto'   — content auto-detection + manual anchors (default)
//   'manual' — manual anchors only (no auto-detection)
//   'hidden' — no group chrome rendered at all (visibility only; the underlying
//              preset is untouched — our headers/groups are pure UX)
// One global value is persisted under 'presetGroupsMode', so the last choice
// remains active across presets and restarts. Older per-preset settings migrate
// from the current preset the first time this version renders the group UI.
const GROUP_MODES = ['auto', 'manual', 'hidden'];
function modeFor() {
    const saved = getSetting('presetGroupsMode');
    if (GROUP_MODES.includes(saved)) return saved;

    const preset = currentPreset();
    const oldModes = saved && typeof saved === 'object'
        ? Object.values(saved).filter((mode) => GROUP_MODES.includes(mode))
        : [];
    const perPresetMode = saved && typeof saved === 'object' ? saved[preset] : null;
    const lastStoredMode = oldModes[oldModes.length - 1];
    const legacy = getSetting('presetGroupsAutoOff') || {};
    const migrated = GROUP_MODES.includes(perPresetMode)
        ? perPresetMode
        : lastStoredMode || (legacy[preset] || Object.values(legacy).some(Boolean) ? 'manual' : 'auto');
    setSetting('presetGroupsMode', migrated);
    return migrated;
}
function setMode(mode) {
    setSetting('presetGroupsMode', mode);
    // Once the user chooses a global mode, stale per-preset flags must never
    // influence a later migration or downgrade/re-upgrade cycle.
    const legacy = getSetting('presetGroupsAutoOff') || {};
    if (Object.keys(legacy).length) setSetting('presetGroupsAutoOff', {});
    if (currentCenter) renderGroups(currentCenter);
}
function cycleMode() {
    const cur = modeFor();
    setMode(GROUP_MODES[(GROUP_MODES.indexOf(cur) + 1) % GROUP_MODES.length]);
}

// ── Color palette popover (opened from a group's swatch) ──
let paletteEl = null;
let paletteDocHandler = null;
function closePalette() {
    if (paletteDocHandler) { document.removeEventListener('click', paletteDocHandler, true); paletteDocHandler = null; }
    paletteEl?.remove();
    paletteEl = null;
}
function openPalette(swatchEl, g) {
    closePalette();
    const cur = colorFor(g);
    paletteEl = document.createElement('div');
    paletteEl.className = 'wl-pe-palette-pop';
    for (const c of PALETTE) {
        const dot = document.createElement('span');
        dot.className = 'wl-pe-pdot' + (c === cur ? ' sel' : '');
        dot.style.background = c;
        dot.addEventListener('click', (e) => { e.stopPropagation(); setGroupColor(g, c); closePalette(); });
        paletteEl.appendChild(dot);
    }
    document.body.appendChild(paletteEl);
    const r = swatchEl.getBoundingClientRect();
    paletteEl.style.left = Math.round(r.left) + 'px';
    paletteEl.style.top = Math.round(r.bottom + 4) + 'px';
    paletteDocHandler = (e) => { if (!e.target.closest('.wl-pe-palette-pop')) closePalette(); };
    setTimeout(() => document.addEventListener('click', paletteDocHandler, true), 0);
}

// ── Name popover (create / rename a manual group) ──
let namePopEl = null;
let namePopHandler = null;
function closeNamePopover() {
    if (namePopHandler) { document.removeEventListener('click', namePopHandler, true); namePopHandler = null; }
    namePopEl?.remove();
    namePopEl = null;
}
function openNamePopover(atEl, initial, onSubmit) {
    closeNamePopover();
    namePopEl = document.createElement('div');
    namePopEl.className = 'wl-pe-name-pop';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wl-pe-name-input';
    input.value = initial || '';
    input.placeholder = 'Group name';
    namePopEl.appendChild(input);
    document.body.appendChild(namePopEl);
    const r = atEl.getBoundingClientRect();
    namePopEl.style.left = Math.round(r.left) + 'px';
    namePopEl.style.top = Math.round(r.bottom + 4) + 'px';
    const submit = () => { const v = input.value.trim(); closeNamePopover(); if (v) onSubmit(v); };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeNamePopover(); }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    namePopHandler = (e) => { if (!e.target.closest('.wl-pe-name-pop')) closeNamePopover(); };
    setTimeout(() => { input.focus(); input.select(); document.addEventListener('click', namePopHandler, true); }, 0);
}

function findList(centerEl) {
    return centerEl.querySelector('.completion_prompt_manager_list')
        || centerEl.querySelector('#completion_prompt_manager ul')
        || centerEl.querySelector('#completion_prompt_manager ol');
}
function rowsOf(list) {
    let rows = [...list.querySelectorAll(':scope > li[data-pm-identifier]')];
    if (!rows.length) rows = [...list.querySelectorAll('li[data-pm-identifier]')];
    return rows;
}

function clearDecoration(list) {
    list.querySelectorAll('.' + HEAD_CLASS + ', .wl-pe-add-row, .wl-pe-groups-bar').forEach((h) => h.remove());
    list.querySelectorAll('.wl-pe-grouped').forEach((r) => {
        r.classList.remove('wl-pe-grouped', 'wl-pe-g-first', 'wl-pe-g-last', 'wl-pe-g-hidden');
        r.style.removeProperty('--gc');
        delete r.dataset.wlPeGroup;
    });
}

/** The "Groups" bar (label + tri-state mode toggle), mounted above the list.
 *  One button cycles Auto-detect → Manual → Hidden. */
function buildGroupsBar(mode) {
    const cfg = {
        auto:   { cls: 'on',     icon: 'fa-wand-magic-sparkles', label: 'Auto-detect' },
        manual: { cls: 'manual', icon: 'fa-hand-pointer',        label: 'Manual' },
        hidden: { cls: 'off',    icon: 'fa-eye-slash',           label: 'Hidden' },
    }[mode] || { cls: 'on', icon: 'fa-wand-magic-sparkles', label: 'Auto-detect' };

    const bar = document.createElement('div');
    bar.className = 'wl-pe-groups-bar';
    bar.dataset.wlPeMode = mode;
    bar.innerHTML = `
        <span class="wl-pe-gb-label">Groups</span>
        <button class="wl-pe-gb-auto ${cfg.cls}" type="button" title="Grouping mode — click to cycle: Auto-detect → Manual → Hidden">
            <i class="fa-solid ${cfg.icon}"></i><span>${cfg.label}</span>
        </button>`;
    bar.querySelector('.wl-pe-gb-auto').addEventListener('click', (e) => {
        e.stopPropagation();
        cycleMode();
    });
    return bar;
}

/** Keep the control outside ST's sortable list so native list refreshes cannot
 * discard it. Replacing it also keeps the displayed tri-state mode current. */
function syncGroupsBar(centerEl, mode) {
    const bars = [...centerEl.querySelectorAll(':scope > .wl-pe-groups-bar')];
    let bar = bars.shift() || null;
    bars.forEach((duplicate) => duplicate.remove());

    if (bar?.dataset.wlPeMode !== mode) {
        const nextBar = buildGroupsBar(mode);
        if (bar) bar.replaceWith(nextBar);
        bar = nextBar;
    }

    const label = centerEl.querySelector(':scope > .wl-pe-collabel');
    if (!bar.isConnected) {
        if (label) label.after(bar); else centerEl.prepend(bar);
    }
}

function buildHead(g, color, anchorId) {
    const head = document.createElement('div');
    head.className = HEAD_CLASS + (g.kind === 'manual' ? ' wl-pe-manual' : '');
    head.style.setProperty('--gc', color);
    const key = keyOf(g);
    head.dataset.wlPeGroupKey = key;         // source of truth for applyCollapse
    if (g.kind === 'manual') head.dataset.wlPeAnchor = anchorId;
    if (collapsed.has(key)) head.classList.add('wl-pe-collapsed');
    const kindLabel = g.kind === 'xml' ? 'XML' : g.kind === 'md' ? 'MD' : 'GROUP';
    const display = g.kind === 'xml' ? `<${g.name}>` : g.kind === 'md' ? `# ${g.name}` : g.name;
    head.innerHTML = `
        <span class="wl-pe-gh-chev"><i class="fa-solid fa-chevron-down"></i></span>
        <span class="wl-pe-gh-swatch"></span>
        <span class="wl-pe-gh-tag"></span>
        <span class="wl-pe-gh-kind">${kindLabel}</span>
        <span class="wl-pe-gh-count">${g.end - g.start + 1}</span>
        ${g.kind === 'manual' ? '<span class="wl-pe-gh-del" title="Remove group"><i class="fa-solid fa-xmark"></i></span>' : ''}
    `;
    const tagEl = head.querySelector('.wl-pe-gh-tag');
    tagEl.textContent = display; // textContent = safe (no HTML injection)
    tagEl.title = display;       // Preserve the complete label behind the ellipsis.
    head.querySelector('.wl-pe-gh-swatch').addEventListener('click', (e) => {
        e.stopPropagation();
        openPalette(e.currentTarget, g); // colors (persisted in Bedazzler settings)
    });
    if (g.kind === 'manual') {
        tagEl.title = `${display}\nDouble-click to rename`;
        tagEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            openNamePopover(tagEl, g.name, (v) => renameManual(anchorId, v));
        });
        head.querySelector('.wl-pe-gh-del').addEventListener('click', (e) => {
            e.stopPropagation();
            removeManual(anchorId);
        });
    }
    head.addEventListener('click', (e) => {
        if (e.target.closest('.wl-pe-gh-swatch, .wl-pe-gh-del')) return; // handled above
        if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
        const list = head.closest('.completion_prompt_manager_list, #completion_prompt_manager ul, #completion_prompt_manager ol') || head.parentElement;
        applyCollapse(list);
    });
    return head;
}

/** A zero-height "＋ group here" affordance inserted before a row. */
function buildAddRow(groupKey, anchorId) {
    const ar = document.createElement('div');
    ar.className = 'wl-pe-add-row';
    if (groupKey) ar.dataset.wlPeGroup = groupKey;
    const hit = document.createElement('div');
    hit.className = 'wl-pe-add-hit';
    hit.title = 'Start a group here';
    hit.addEventListener('click', (e) => {
        e.stopPropagation();
        openNamePopover(e.currentTarget, '', (name) => addManual(anchorId, name));
    });
    ar.appendChild(hit);
    return ar;
}

/** Show/hide member rows (and their add-rows) per the collapsed set. */
function applyCollapse(list) {
    list.querySelectorAll('.' + HEAD_CLASS).forEach((head) => {
        head.classList.toggle('wl-pe-collapsed', collapsed.has(head.dataset.wlPeGroupKey));
    });
    list.querySelectorAll('.wl-pe-grouped').forEach((row) => {
        row.classList.toggle('wl-pe-g-hidden', collapsed.has(row.dataset.wlPeGroup));
    });
    list.querySelectorAll('.wl-pe-add-row').forEach((ar) => {
        const k = ar.dataset.wlPeGroup;
        ar.classList.toggle('wl-pe-g-hidden', !!k && collapsed.has(k));
    });
}

export function renderGroups(centerEl) {
    if (!centerEl) return;
    currentCenter = centerEl;

    const preset = currentPreset();
    const mode = modeFor();
    syncGroupsBar(centerEl, mode);

    const list = findList(centerEl);
    if (!list) return;

    // Suspend the observer while we mutate, so our own inserts don't re-trigger
    // a render loop.
    const wasObserving = !!observer;
    if (observer) observer.disconnect();

    clearDecoration(list);
    const rows = rowsOf(list);

    // 'hidden' → no chrome at all (rows stay bare; underlying preset untouched).
    if (mode !== 'hidden' && rows.length) {
        const contentById = {};
        for (const p of (oaiRef?.prompts || [])) contentById[p.identifier] = p.content || '';
        const blocks = rows.map((r) => ({ id: r.dataset.pmIdentifier, content: contentById[r.dataset.pmIdentifier] || '' }));

        // Resolve persisted manual anchors → current indices; drop orphans
        // (block deleted since the anchor was set).
        const indexById = {};
        blocks.forEach((bl, i) => { indexById[bl.id] = i; });
        const manual = [];
        for (const a of manualFor(preset)) {
            const idx = indexById[a.anchorId];
            if (idx == null) continue;
            manual.push({ index: idx, name: a.name });
        }

        const groups = computeGroups(blocks, { manual, auto: mode === 'auto' });

        for (const g of groups) {
            const color = colorFor(g);
            const anchorId = g.kind === 'manual' ? rows[g.start].dataset.pmIdentifier : null;
            list.insertBefore(buildHead(g, color, anchorId), rows[g.start]);
            for (let i = g.start; i <= g.end; i++) {
                const row = rows[i];
                row.classList.add('wl-pe-grouped');
                if (i === g.start) row.classList.add('wl-pe-g-first');
                if (i === g.end) row.classList.add('wl-pe-g-last');
                row.style.setProperty('--gc', color);
                row.dataset.wlPeGroup = keyOf(g);
            }
        }

        // "＋ group here" affordances: before every row EXCEPT a group's first
        // block (a boundary already exists there). Grouped members carry their
        // group key so they hide with the group on collapse.
        const startSet = new Set(groups.map((g) => g.start));
        for (let i = 0; i < rows.length; i++) {
            if (startSet.has(i)) continue;
            const key = rows[i].dataset.wlPeGroup || '';
            list.insertBefore(buildAddRow(key, rows[i].dataset.pmIdentifier), rows[i]);
        }

        applyCollapse(list);
    }

    if (wasObserving) observeList(centerEl);
}

/** Re-derive (debounced) whenever ST rebuilds the prompt-manager list. */
function observeList(centerEl) {
    const manager = centerEl.querySelector('#completion_prompt_manager') || centerEl;
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => { rafPending = false; renderGroups(centerEl); });
    });
    observer.observe(manager, { childList: true, subtree: true });
}

export function startGroupRender(centerEl) {
    // Load oai_settings once, then paint. Observe immediately so we also catch
    // ST's own (re)render of the list even before the import resolves.
    ensureOai().then(() => renderGroups(centerEl));
    observeList(centerEl);
}

// ── Viewer bridge ───────────────────────────────────────────
// The Test tab's Prompt viewer reuses the SAME group computation + per-preset
// colors the middle column paints with, so the two never diverge. This reads
// the CURRENT preset's blocks (content from oai_settings, order from the DOM
// rows if the expanded drawer is mounted, else oai_settings order) and returns
// resolved groups annotated with each member block's content + color. Returns
// `{ mode, groups }`; `groups` is [] when mode is 'hidden' or nothing matches.
//
//   groups[]: { key, name, kind, color, blocks: [{ id, content }] }
//
// Pure/read-only: no DOM mutation, safe to call anytime after ensureOai().
export function getGroupsForViewer() {
    const preset = currentPreset();
    const mode = modeFor();
    if (mode === 'hidden') return { mode, groups: [] };

    // Prefer the displayed row order (matches what the user sees); fall back to
    // oai_settings' own prompt order when the list isn't mounted.
    let ordered = [];
    if (currentCenter) {
        const list = findList(currentCenter);
        if (list) ordered = rowsOf(list).map((r) => r.dataset.pmIdentifier);
    }
    const contentById = {};
    for (const p of (oaiRef?.prompts || [])) contentById[p.identifier] = p.content || '';
    if (!ordered.length) ordered = (oaiRef?.prompts || []).map((p) => p.identifier);

    const blocks = ordered.map((id) => ({ id, content: contentById[id] || '' }));
    if (!blocks.length) return { mode, groups: [] };

    const indexById = {};
    blocks.forEach((bl, i) => { indexById[bl.id] = i; });
    const manual = [];
    for (const a of manualFor(preset)) {
        const idx = indexById[a.anchorId];
        if (idx == null) continue;
        manual.push({ index: idx, name: a.name });
    }

    const raw = computeGroups(blocks, { manual, auto: mode === 'auto' });
    const groups = raw.map((g) => ({
        key: keyOf(g),
        name: g.name,
        kind: g.kind,
        color: colorFor(g),
        // Marker blocks can compile generated content (chat history, examples,
        // etc.) despite having no literal preset content of their own.
        blocks: blocks.slice(g.start, g.end + 1),
    }));
    return { mode, groups };
}

export function stopGroupRender(centerEl) {
    if (observer) { observer.disconnect(); observer = null; }
    rafPending = false;
    closePalette();
    closeNamePopover();
    currentCenter = null;
    // Strip our headers/classes so nothing rides back into the native drawer
    // when the prompt manager is returned home.
    if (centerEl) {
        const list = findList(centerEl);
        if (list) clearDecoration(list);
        centerEl.querySelectorAll(':scope > .wl-pe-groups-bar').forEach((bar) => bar.remove());
    }
}
