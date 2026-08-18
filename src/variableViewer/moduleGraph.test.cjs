const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
    let registeredCommand = null;
    const listeners = new Map();
    const context = vm.createContext({
        console,
        structuredClone,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        SillyTavern: {
            getContext: () => ({
                SlashCommandParser: {
                    commands: {},
                    addCommandObject: (command) => { registeredCommand = command; },
                },
                SlashCommand: { fromProps: (props) => props },
            }),
        },
    });

    const scriptModule = new vm.SyntheticModule(
        ['chat_metadata', 'eventSource', 'event_types', 'saveSettingsDebounced'],
        function init() {
            this.setExport('chat_metadata', { variables: {} });
            this.setExport('eventSource', { on: (type, handler) => listeners.set(type, handler) });
            this.setExport('event_types', { CHAT_CHANGED: 'chat_changed' });
            this.setExport('saveSettingsDebounced', () => {});
        },
        { context },
    );
    const extensionsModule = new vm.SyntheticModule(
        ['extension_settings', 'saveMetadataDebounced'],
        function init() {
            this.setExport('extension_settings', { variables: { global: {} } });
            this.setExport('saveMetadataDebounced', () => {});
        },
        { context },
    );

    const cache = new Map();
    async function loadModule(filename) {
        const resolved = path.resolve(filename);
        if (cache.has(resolved)) return cache.get(resolved);
        const module = new vm.SourceTextModule(fs.readFileSync(resolved, 'utf8'), {
            context,
            identifier: resolved,
        });
        cache.set(resolved, module);
        await module.link(async (specifier, referencingModule) => {
            if (specifier.endsWith('/script.js')) return scriptModule;
            if (specifier.endsWith('/extensions.js')) return extensionsModule;
            if (specifier.startsWith('.')) {
                return loadModule(path.resolve(path.dirname(referencingModule.identifier), specifier));
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });
        return module;
    }

    const entry = await loadModule(path.join(__dirname, 'index.js'));
    await entry.evaluate();
    entry.namespace.initVariableViewer();

    assert.equal(registeredCommand.name, 'variables');
    assert.equal(typeof registeredCommand.callback, 'function');
    assert.equal(typeof listeners.get('chat_changed'), 'function');
    const shellSource = fs.readFileSync(path.join(__dirname, 'panelShell.js'), 'utf8');
    assert.equal(shellSource.includes('Refresh variables'), false);
    assert.equal(shellSource.includes("'Expand all'"), true);
    assert.equal(shellSource.includes("'Collapse all'"), true);
    assert.equal(shellSource.includes("'Flush all variables'"), true);
    const panelSource = fs.readFileSync(path.join(__dirname, 'variablePanel.js'), 'utf8');
    assert.equal(panelSource.includes('callGenericPopup(message, ctx.POPUP_TYPE.CONFIRM) === true'), false);
    assert.equal(panelSource.includes('await this.confirm(`Delete'), false);
    console.log('Variable Viewer module graph and command registration: OK');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
