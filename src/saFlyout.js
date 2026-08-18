// src/saFlyout.js — SuperAgents hover flyout for the side-button strip.
//
// When the user hovers the "Super Agents" side button, a panel flies out to
// the LEFT (the strip is pinned to the right edge) showing:
//   - a row of group "pills" on top (toggling a group cascades to its agents)
//   - a grid of agent icons below
// Clicking an icon toggles that agent/group on or off. Enabled = full colour;
// disabled = dimmed. Hovering an icon reveals its name via a subtle label.
//
// This lives in UI Bedazzler but drives SuperAgents through its public API
// (window.SuperAgents.agents / .groups / .ui.resolveAgentIcon). It degrades
// gracefully: if SuperAgents isn't present, nothing is attached.

import { makeDebug } from './debug.js';
const log = makeDebug('[UIBedazzler:SAFlyout]');

const FLYOUT_ID = 'bd-sa-flyout';
const CLOSE_DELAY = 220; // ms grace so moving cursor button→panel doesn't close

let closeTimer = null;
let boundBtn = null;
let runStateBound = false;

// ── SuperAgents API access (all optional / defensive) ──────────────
function SA() { return window.SuperAgents || null; }

function getAgents() {
    try { return SA()?.agents?.getAll?.() ?? []; } catch { return []; }
}
function getGroups() {
    try { return SA()?.groups?.getAll?.() ?? []; } catch { return []; }
}
function resolveAgentIcon(agent) {
    const fn = SA()?.ui?.resolveAgentIcon;
    if (typeof fn === 'function') { try { return fn(agent); } catch { /* fall through */ } }
    return agent?.icon || 'fa-puzzle-piece';
}
function resolveGroupIcon(group) {
    const fn = SA()?.ui?.resolveGroupIcon;
    if (typeof fn === 'function') { try { return fn(group); } catch { /* fall through */ } }
    return group?.icon || 'fa-layer-group';
}
function toggleAgent(id) {
    try { return SA()?.agents?.toggle?.(id); } catch { return null; }
}
function toggleGroup(id) {
    try { return SA()?.groups?.toggle?.(id); } catch { return null; }
}
// Fire an agent on the most recent assistant message. SuperAgents owns the
// "which message is last" rule and the toasts; we just call and forget.
function runAgentOnLast(id) {
    try { return SA()?.agents?.runOnLast?.(id); } catch { return null; }
}
// True while any SuperAgents run is in flight. The engine is single-flight, so
// this doubles as "is THIS agent running" for our purposes: if anything is
// running, a second play click would only be rejected anyway.
function isRunActive() {
    try { return !!SA()?.lifecycle?.isActive?.(); } catch { return false; }
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
}

// ── Group enabled-state: a group reads as "on" if any of its agents are on ──
function groupIsActive(group, agentsById) {
    const ids = group.agentIds || [];
    if (!ids.length) return !!group.enabled;
    return ids.some(id => agentsById.get(id)?.enabled);
}

// ── Build the panel's inner markup from current state ──────────────
function renderFlyoutBody(panel) {
    const agents = getAgents();
    const groups = getGroups();
    const agentsById = new Map(agents.map(a => [a.id, a]));

    const groupRow = groups.length ? `
        <div class="bd-saf-section-label">Groups</div>
        <div class="bd-saf-groups">
            ${groups.map(g => {
                const active = groupIsActive(g, agentsById);
                const icon = resolveGroupIcon(g);
                const n = (g.agentIds || []).length;
                return `
                <button type="button" class="bd-saf-pill ${active ? 'bd-saf-on' : 'bd-saf-off'}"
                        data-group-id="${esc(g.id)}" data-name="${esc(g.name || 'Group')}">
                    <i class="fa-solid ${esc(icon)}"></i>
                    <span class="bd-saf-pill-name">${esc(g.name || 'Group')}</span>
                    <span class="bd-saf-pill-count">${n}</span>
                </button>`;
            }).join('')}
        </div>` : '';

    const running = isRunActive();
    const agentGrid = agents.length ? `
        <div class="bd-saf-section-label">Agents</div>
        <div class="bd-saf-agents">
            ${agents.map(a => {
                const icon = resolveAgentIcon(a);
                const name = esc(a.name || 'Unnamed');
                return `
                <div class="bd-saf-icon ${a.enabled ? 'bd-saf-on' : 'bd-saf-off'}${running ? ' bd-saf-busy' : ''}"
                     role="button" tabindex="0"
                     data-agent-id="${esc(a.id)}" data-name="${name}">
                    <i class="fa-solid ${esc(icon)}"></i>
                    <button type="button" class="bd-saf-run" tabindex="-1"
                            data-run-id="${esc(a.id)}"
                            aria-label="Run ${name} on last message"
                            title="Run on last message">
                        <i class="fa-solid fa-play"></i>
                    </button>
                </div>`;
            }).join('')}
        </div>` : `<div class="bd-saf-empty">No agents yet.</div>`;

    panel.innerHTML = `
        ${groupRow}
        ${agentGrid}
        <div class="bd-saf-hovername" aria-hidden="true"></div>
    `;
}

// ── Position the panel to the left of the anchor button ────────────
function positionFlyout(panel, anchor) {
    const r = anchor.getBoundingClientRect();
    // Anchor by the right edge so it grows leftward, vertically aligned to btn.
    panel.style.top = `${Math.max(8, Math.round(r.top))}px`;
    panel.style.right = `${Math.round(window.innerWidth - r.left + 8)}px`;
}

// ── Keep the grid's busy/idle state honest ─────────────────────────
// When a run starts or ends, re-render the open panel so the play badges dim
// out during a run and light back up when it finishes. Subscribed once, the
// first time the panel is built. No-op if SuperAgents doesn't expose the hook.
function subscribeRunState() {
    if (runStateBound) return;
    const sub = SA()?.lifecycle?.onRunStateChange;
    if (typeof sub !== 'function') return;
    try {
        sub(() => {
            const panel = document.getElementById(FLYOUT_ID);
            if (panel && panel.classList.contains('bd-saf-visible')) {
                renderFlyoutBody(panel);
            }
        });
        runStateBound = true;
    } catch { /* hook shape changed — safe to skip, badges still work */ }
}

// ── Show / hide ────────────────────────────────────────────────────
function showFlyout(anchor) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (!SA()) return; // SuperAgents not loaded — nothing to show

    let panel = document.getElementById(FLYOUT_ID);
    if (!panel) {
        panel = document.createElement('div');
        panel.id = FLYOUT_ID;
        document.body.appendChild(panel);
        wirePanelEvents(panel);
        subscribeRunState();
    }
    renderFlyoutBody(panel);
    positionFlyout(panel, anchor);
    // next frame → enables the CSS transition from hidden→shown
    requestAnimationFrame(() => panel.classList.add('bd-saf-visible'));
}

function scheduleHide() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
        const panel = document.getElementById(FLYOUT_ID);
        if (panel) panel.classList.remove('bd-saf-visible');
    }, CLOSE_DELAY);
}

function cancelHide() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
}

// ── Panel-level event wiring (delegated; survives re-renders) ───────
function wirePanelEvents(panel) {
    panel.addEventListener('mouseenter', cancelHide);
    panel.addEventListener('mouseleave', scheduleHide);

    // Subtle name-on-hover for agent icons (the grid is icon-only).
    panel.addEventListener('mouseover', (e) => {
        const cell = e.target.closest('.bd-saf-icon');
        const label = panel.querySelector('.bd-saf-hovername');
        if (cell && label) {
            label.textContent = cell.dataset.name || '';
            label.classList.add('bd-saf-hovername-on');
        }
    });
    panel.addEventListener('mouseout', (e) => {
        const cell = e.target.closest('.bd-saf-icon');
        const label = panel.querySelector('.bd-saf-hovername');
        if (cell && label) label.classList.remove('bd-saf-hovername-on');
    });

    panel.addEventListener('click', (e) => {
        // Play badge first — it lives INSIDE the agent cell, so a badge click
        // also matches the cell. Catch it here and stop it bubbling to toggle.
        const runBtn = e.target.closest('.bd-saf-run');
        if (runBtn) {
            e.stopPropagation();
            // Single-flight: ignore the click if a run is already in progress
            // (the badge is styled disabled in that state as a visual cue).
            if (isRunActive()) return;
            runAgentOnLast(runBtn.dataset.runId);
            // Reflect the now-busy state on the grid (badges dim out).
            renderFlyoutBody(panel);
            return;
        }
        const agentCell = e.target.closest('.bd-saf-icon');
        if (agentCell) {
            toggleAgent(agentCell.dataset.agentId);
            renderFlyoutBody(panel);
            return;
        }
        const groupPill = e.target.closest('.bd-saf-pill');
        if (groupPill) {
            toggleGroup(groupPill.dataset.groupId);
            renderFlyoutBody(panel);
            return;
        }
    });
}

// ── Public: attach hover behaviour to a side button ────────────────
export function attachSAFlyout(btnEl) {
    if (!btnEl) return;
    boundBtn = btnEl;
    btnEl.addEventListener('mouseenter', () => showFlyout(btnEl));
    btnEl.addEventListener('mouseleave', scheduleHide);
    log('Flyout attached to Super Agents button');
}

// ── Public: tear down (called on strip rebuild/destroy) ────────────
export function destroySAFlyout() {
    cancelHide();
    const panel = document.getElementById(FLYOUT_ID);
    if (panel) panel.remove();
    boundBtn = null;
}
