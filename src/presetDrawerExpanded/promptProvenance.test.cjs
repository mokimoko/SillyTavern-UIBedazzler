const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const message = (identifier, role, content) => ({ identifier, role, content });
const collection = (identifier, children) => ({ identifier, getCollection: () => children });

(async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, 'promptProvenance.js')).href);
    const promptManager = { messages: collection('root', [
        collection('main', [
            message('main', 'system', 'Expanded main prompt'),
            message('authorsNote', 'system', 'An injected note'),
        ]),
        collection('chatHistory', [message('chatHistory-1', 'user', 'Only the test message')]),
    ]) };
    const compiled = [
        { role: 'system', content: 'Expanded main prompt' },
        { role: 'system', content: 'An injected note' },
        { role: 'user', content: 'Only the test message' },
    ];

    const provenance = mod.capturePromptProvenance(promptManager, compiled);
    assert.deepEqual(provenance, [
        { ids: ['main'] },
        { ids: ['authorsNote', 'main'] },
        { ids: ['chatHistory-1', 'chatHistory'] },
    ]);

    const groups = new Map([
        ['main', { name: 'Core', color: '#123456' }],
        ['chatHistory', { name: 'Conversation', color: '#abcdef' }],
    ]);
    assert.equal(mod.groupForProvenance(provenance[0], groups).name, 'Core');
    assert.equal(mod.groupForProvenance(provenance[1], groups).name, 'Core');
    assert.equal(mod.groupForProvenance(provenance[2], groups).name, 'Conversation');

    const changed = mod.capturePromptProvenance(promptManager, [
        compiled[0],
        { role: 'system', content: 'Changed by listener' },
        compiled[2],
    ]);
    assert.equal(changed[1], null);
    console.log('promptProvenance: 7 assertions passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
