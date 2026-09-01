const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadModule() {
    const source = fs.readFileSync(path.join(__dirname, 'addedNodeBatcher.js'), 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(url);
}

function element(parentElement = null, isConnected = true) {
    return { nodeType: 1, parentElement, isConnected };
}

(async () => {
    const { createAddedNodeBatcher } = await loadModule();
    const scanned = [];
    const scheduled = [];
    const canceled = [];
    const batch = createAddedNodeBatcher(root => scanned.push(root), {
        schedule(callback) {
            scheduled.push(callback);
            return scheduled.length;
        },
        cancel(handle) {
            canceled.push(handle);
        },
    });

    const parent = element();
    const child = element(parent);
    const sibling = element();
    const transient = element(null, false);

    batch([{ addedNodes: [parent, child] }]);
    batch([{ addedNodes: [sibling, transient] }]);
    assert.equal(scheduled.length, 1, 'mutation bursts should schedule one frame');
    assert.deepEqual(scanned, [], 'subtrees should not scan synchronously');

    scheduled[0]();
    assert.deepEqual(scanned, [parent, sibling], 'scan only surviving top-level roots');

    batch([{ addedNodes: [child] }]);
    assert.equal(scheduled.length, 2);
    batch.cancel();
    assert.deepEqual(canceled, [2]);
    scheduled[1]();
    assert.deepEqual(scanned, [parent, sibling], 'cancel should clear queued roots');

    console.log('UIBedazzler added-node batching tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
