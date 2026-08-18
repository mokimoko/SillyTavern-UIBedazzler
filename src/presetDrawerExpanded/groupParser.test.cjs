// Unit tests for groupParser.computeGroups — auto detection + manual anchors.
// Run: node src/presetDrawerExpanded/groupParser.test.cjs
// groupParser.js has no imports, so a plain dynamic import() links it directly.

const assert = require('node:assert/strict');
const path = require('node:path');

// Compact block builders.
const b = (content) => ({ content });                 // plain content block
const B = (...contents) => contents.map((c) => b(c)); // ordered list

// Normalize a group to a terse tuple for comparison.
const T = (g) => [g.kind, g.name, g.start, g.end];

(async () => {
    const { pathToFileURL } = require('node:url');
    const { computeGroups } = await import(pathToFileURL(path.join(__dirname, 'groupParser.js')).href);
    let passed = 0;
    const check = (label, actual, expected) => {
        assert.deepEqual(actual.map(T), expected, label);
        passed++;
    };

    // ── Backward compatibility: computeGroups(blocks) unchanged ──
    check('bc: single XML span',
        computeGroups(B('<sys>', 'mid', '</sys>')),
        [['xml', 'sys', 0, 2]]);

    check('bc: H1 group runs to next H1',
        computeGroups(B('# Intro', 'body', '# Rules', 'more')),
        [['md', 'Intro', 0, 1], ['md', 'Rules', 2, 3]]);

    check('bc: XML wins over H1 inside it',
        computeGroups(B('<sys>', '# Ignored', '</sys>')),
        [['xml', 'sys', 0, 2]]);

    check('bc: balanced inline tags are not a group',
        computeGroups(B('<x>hi</x>', 'plain')),
        []);

    // ── Manual anchors in ungrouped space ──
    check('manual: anchor runs to end',
        computeGroups(B('a', 'b', 'c'), { manual: [{ index: 1, name: 'Mine' }] }),
        [['manual', 'Mine', 1, 2]]);

    check('manual: two anchors bound each other',
        computeGroups(B('a', 'b', 'c', 'd'), {
            manual: [{ index: 0, name: 'One' }, { index: 2, name: 'Two' }],
        }),
        [['manual', 'One', 0, 1], ['manual', 'Two', 2, 3]]);

    // ── Manual overrides / splits XML ──
    check('manual: splits an XML group, capped at its end',
        computeGroups(B('<sys>', 'x', 'y', '</sys>', 'after'), {
            manual: [{ index: 2, name: 'Split' }],
        }),
        [['xml', 'sys', 0, 1], ['manual', 'Split', 2, 3]]);

    check('manual: anchor on XML first block overrides it entirely',
        computeGroups(B('<sys>', 'x', '</sys>'), {
            manual: [{ index: 0, name: 'Own' }],
        }),
        [['manual', 'Own', 0, 2]]);

    // ── Manual absorbs Markdown H1 ──
    check('manual: absorbs an H1 inside its span',
        computeGroups(B('start', '# Sub', 'tail'), {
            manual: [{ index: 0, name: 'Wrap' }],
        }),
        [['manual', 'Wrap', 0, 2]]);

    check('manual: bounds a preceding H1 group at its start',
        computeGroups(B('# Head', 'x', 'y'), {
            manual: [{ index: 1, name: 'Cut' }],
        }),
        [['md', 'Head', 0, 0], ['manual', 'Cut', 1, 2]]);

    // ── auto:false → only manual groups survive ──
    check('auto off: XML/MD suppressed, manual kept',
        computeGroups(B('<sys>', '# H', '</sys>', 'z'), {
            auto: false,
            manual: [{ index: 1, name: 'Only' }],
        }),
        [['manual', 'Only', 1, 3]]);

    check('auto off: no manual → nothing',
        computeGroups(B('<sys>', 'x', '</sys>'), { auto: false }),
        []);

    // ── Robustness: orphan / out-of-range / duplicate anchors ──
    check('robust: out-of-range and dup indices ignored',
        computeGroups(B('a', 'b'), {
            manual: [
                { index: -1, name: 'neg' },
                { index: 9, name: 'over' },
                { index: 0, name: 'keep' },
                { index: 0, name: 'dup' },
            ],
        }),
        [['manual', 'keep', 0, 1]]);

    // ── Hybrid: manual + surviving XML + MD fill ──
    check('hybrid: manual, then a later untouched XML, then MD gap',
        computeGroups(B('intro', '<sys>', '</sys>', '# Tail', 'end'), {
            manual: [{ index: 0, name: 'Top' }],
        }),
        [['manual', 'Top', 0, 0], ['xml', 'sys', 1, 2], ['md', 'Tail', 3, 4]]);

    console.log(`groupParser: ${passed} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
