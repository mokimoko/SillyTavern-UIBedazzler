// Easthaven owns the chat layout while its native VN surface is active.
const ACTIVE_CLASS = 'easthaven-native-vn';
let observer = null;

export function isEasthavenChatDesignPaused() {
    return document.body?.classList.contains(ACTIVE_CLASS) === true;
}

export function observeEasthavenChatDesign(onChange) {
    if (observer || !document.body) return;
    let paused = isEasthavenChatDesignPaused();
    const updateNotice = () => {
        const notice = document.getElementById('bd-chat-design-paused');
        if (notice) notice.hidden = !paused;
    };
    updateNotice();
    observer = new MutationObserver(() => {
        const next = isEasthavenChatDesignPaused();
        if (next === paused) return;
        paused = next;
        updateNotice();
        onChange();
    });
    // Watch only the host mode flag, never streamed messages or UI subtrees.
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
