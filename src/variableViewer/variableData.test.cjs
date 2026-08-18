const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function loadVariableData() {
    const source = fs.readFileSync(path.join(__dirname, 'variableData.js'), 'utf8');
    const chatMetadata = {
        variables: {
            greeting: 'hello',
            numericText: '42',
            booleanText: 'false',
            nullText: 'null',
            state: '{"stats":{"hp":10},"party":[{"name":"Ada"},{"name":"Bea"}]}',
        },
    };
    const extensionSettings = { variables: { global: { theme: 'night' } } };
    const saves = { local: 0, global: 0 };
    const context = vm.createContext({ structuredClone });
    const module = new vm.SourceTextModule(source, { context });

    await module.link(async (specifier) => {
        if (specifier.endsWith('/script.js')) {
            return new vm.SyntheticModule(['chat_metadata', 'saveSettingsDebounced'], function init() {
                this.setExport('chat_metadata', chatMetadata);
                this.setExport('saveSettingsDebounced', () => { saves.global += 1; });
            }, { context });
        }
        if (specifier.endsWith('/extensions.js')) {
            return new vm.SyntheticModule(['extension_settings', 'saveMetadataDebounced'], function init() {
                this.setExport('extension_settings', extensionSettings);
                this.setExport('saveMetadataDebounced', () => { saves.local += 1; });
            }, { context });
        }
        throw new Error(`Unexpected import: ${specifier}`);
    });
    await module.evaluate();
    return { api: module.namespace, chatMetadata, extensionSettings, saves };
}

(async () => {
    const { api, chatMetadata, extensionSettings, saves } = await loadVariableData();

    assert.equal(api.decodeStoredValue(chatMetadata.variables.state).value.stats.hp, 10);
    assert.equal(api.getVariableDescriptor('local', ['state', 'stats', 'hp']).type, 'number');
    assert.equal(api.getVariableDescriptor('local', ['numericText']).type, 'number');
    assert.equal(api.getVariableDescriptor('local', ['numericText']).inferredFromString, true);
    assert.equal(api.getVariableDescriptor('local', ['booleanText']).type, 'boolean');
    assert.equal(api.getVariableDescriptor('local', ['nullText']).type, 'null');
    assert.equal(api.formatValuePreview(''), '');
    assert.equal(api.formatValuePreview('  hello\nthere  '), 'hello there');
    assert.equal(api.getDisplayValueKind('42'), 'number');
    assert.equal(api.getDisplayValueKind('-3.5e2'), 'number');
    assert.equal(api.getDisplayValueKind('001'), 'string');
    assert.equal(api.getDisplayValueKind('TRUE'), 'boolean');
    assert.equal(api.getDisplayValueKind(' null '), 'null');
    assert.equal(api.getDisplayValueKind(''), 'string');
    assert.equal(api.getDisplayValueKind(api.decodeStoredValue('{"ready":true}').value), 'object');

    api.updateVariable('local', ['numericText'], {
        name: 'numericText',
        type: 'number',
        text: '43',
        preserveString: true,
    });
    assert.equal(chatMetadata.variables.numericText, '43');

    api.updateVariable('local', ['state', 'stats', 'hp'], { name: 'health', type: 'number', text: '12' });
    assert.equal(JSON.parse(chatMetadata.variables.state).stats.health, 12);
    assert.equal(JSON.parse(chatMetadata.variables.state).stats.hp, undefined);

    api.deleteVariable('local', ['state', 'party', 0]);
    assert.equal(JSON.parse(chatMetadata.variables.state).party[0].name, 'Bea');

    api.addVariable('local', ['state', 'party'], { name: '', type: 'json', text: '{"name":"Cy"}' });
    assert.equal(JSON.parse(chatMetadata.variables.state).party[1].name, 'Cy');

    api.addVariable('local', null, { name: 'inventory', type: 'json', text: '["key"]' });
    assert.equal(chatMetadata.variables.inventory, '["key"]');
    api.updateVariable('local', ['greeting'], { name: 'greeting', type: 'json', text: '{"tone":"warm"}' });
    assert.equal(chatMetadata.variables.greeting, '{"tone":"warm"}');
    assert.equal(api.formatVariablePath(['odd key', 'a.b', 0]), '["odd key"]["a.b"][0]');
    assert.equal(api.variableMatchesQuery('state', api.decodeStoredValue(chatMetadata.variables.state).value, 'bea'), true);

    api.importVariables('global', { difficulty: 3 });
    assert.equal(extensionSettings.variables.global.difficulty, 3);
    assert.ok(saves.local >= 4);
    assert.equal(saves.global, 1);

    const expanded = api.collectExpandablePaths('local');
    assert.ok(expanded.paths.includes('["state","stats"]'));

    const filteredNames = api.matchingVariableNames('local', 'bea');
    assert.equal(filteredNames.join(','), 'state');
    const savesBeforeFlush = saves.local;
    assert.equal(api.flushVariables('local', filteredNames), 1);
    assert.equal(chatMetadata.variables.state, undefined);
    assert.equal(chatMetadata.variables.inventory, '["key"]');
    assert.equal(saves.local, savesBeforeFlush + 1);
    console.log('Variable data behavior: OK');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
