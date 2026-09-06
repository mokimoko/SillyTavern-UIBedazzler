// Compatibility adapter for Memory Books' optional memory-boundary jump button.
// Memory Books keeps ownership of the action and its visibility setting;
// UIBedazzler only replaces the floating control's presentation.

const JUMP_BUTTON_ID = 'stmb-memory-boundary-jump';

function getJumpButton() {
    return document.getElementById(JUMP_BUTTON_ID);
}

export function isMemoryBooksJumpAvailable() {
    return !!getJumpButton();
}

export function jumpToFirstUnprocessedMessage() {
    getJumpButton()?.click();
}
