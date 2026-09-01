const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

const sideButtons = source('sideButtons.js');
assert.match(sideButtons, /mutation\.target\?\.closest\?\.\('#chat'\)/,
    'chat mutations must bypass late-extension scans');
assert.match(sideButtons, /mutations\.some\(mutationTouchesExtensionTriggers\)/,
    'body observer must filter for relevant extension controls');
assert.match(sideButtons, /lateExtensionScanFrame = requestAnimationFrame/,
    'late-extension scans must be frame-coalesced');

const expandedPreset = source(path.join('presetDrawerExpanded', 'index.js'));
assert.match(expandedPreset, /isExpandedActive\(\) \|\| document\.getElementById\(EXPAND_BTN_ID\)/,
    'preset panel mutations must be ignored while the button survives');
assert.match(expandedPreset, /panelRefreshFrame = requestAnimationFrame/,
    'preset button recovery must be frame-coalesced');

const cuteLoader = source('cuteLoader.js');
const hostAdapter = source('hostAdapter.js');
assert.match(cuteLoader, /createAddedNodeBatcher\(swapLogosWithin\)/,
    'logo subtree scans must be batched');
assert.match(hostAdapter, /createAddedNodeBatcher\(scan\)/,
    'assistant-avatar subtree scans must be batched');

console.log('UIBedazzler observer performance guards passed.');
