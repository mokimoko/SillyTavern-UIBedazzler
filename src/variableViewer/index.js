import { eventSource, event_types } from '../../../../../../script.js';
import { ensureFeatureStyle } from '../featureStyles.js';

const STYLE_ID = 'bd-variable-viewer-style';
const styleUrl = () => new URL('../../variableViewer.css', import.meta.url).href;
let panel = null;
let panelPromise = null;
let initialized = false;

async function getPanel() {
    if (panel) return panel;
    if (!panelPromise) {
        panelPromise = Promise.all([
            ensureFeatureStyle(STYLE_ID, styleUrl()),
            import('./variablePanel.js'),
        ]).then(([, module]) => panel ??= new module.VariableViewerPanel());
    }
    return panelPromise;
}

function commandExists(parser, name) {
    const commands = parser?.commands;
    return Boolean(commands?.[name] || commands?.get?.(name));
}

function registerToggleCommand() {
    try {
        const ctx = SillyTavern.getContext();
        const { SlashCommandParser, SlashCommand } = ctx;
        if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) {
            console.warn('[UIBedazzler:Variables] Slash command API unavailable; /variables was not registered.');
            return;
        }

        const preferredName = 'variables';
        const commandName = commandExists(SlashCommandParser, preferredName) ? 'bdz-variables' : preferredName;
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: commandName,
            callback: async () => {
                (await getPanel()).toggle();
                return '';
            },
            helpString: 'Toggle UI Bedazzler’s local and global Variable Viewer.',
            returns: 'nothing',
        }));

        if (commandName !== preferredName) {
            console.warn('[UIBedazzler:Variables] /variables is already registered; use /bdz-variables instead.');
        }
    } catch (error) {
        console.error('[UIBedazzler:Variables] Failed to register the Variable Viewer command:', error);
    }
}

export function initVariableViewer() {
    if (initialized) return;
    initialized = true;
    registerToggleCommand();
    eventSource.on(event_types.CHAT_CHANGED, () => panel?.onChatChanged());
}

export async function toggleVariableViewer() {
    (await getPanel()).toggle();
}
