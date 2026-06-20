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

const log = (...a) => console.log('[UIBedazzler:SAFlyout]', ...a);

const FLYOUT_ID = 'bd-sa-flyout';
const CLOSE_DELAY = 220; // ms grace so moving cursor button→panel doesn't close

let closeTimer = null;
let boundBtn = null;

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

    const agentGrid = agents.length ? `
        <div class="bd-saf-section-label">Agents</div>
        <div class="bd-saf-agents">
            ${agents.map(a => {
                const icon = resolveAgentIcon(a);
                return `
                <button type="button" class="bd-saf-icon ${a.enabled ? 'bd-saf-on' : 'bd-saf-off'}"
                        data-agent-id="${esc(a.id)}" data-name="${esc(a.name || 'Unnamed')}">
                    <i class="fa-solid ${esc(icon)}"></i>
                </button>`;
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
