import { eventSource, event_types } from '../../../../../../script.js';
import { VariableViewerPanel } from './variablePanel.js';

const panel = new VariableViewerPanel();
let initialized = false;

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
            callback: () => {
                panel.toggle();
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
    eventSource.on(event_types.CHAT_CHANGED, () => panel.onChatChanged());
}

export function toggleVariableViewer() {
    panel.toggle();
}
