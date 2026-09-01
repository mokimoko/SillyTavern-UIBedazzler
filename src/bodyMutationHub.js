// One shared document-body observer for features that need to notice late UI.
// Subscribers still filter their own mutations, but streaming chat updates now
// cross the browser's MutationObserver boundary only once instead of once per
// feature.

const subscribers = new Set();
let observer = null;

function ensureObserver() {
    if (observer || !document.body) return;

    observer = new MutationObserver((mutations) => {
        for (const subscriber of [...subscribers]) {
            try {
                subscriber(mutations);
            } catch (error) {
                console.error('[UIBedazzler] Body mutation subscriber failed:', error);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export function subscribeBodyMutations(subscriber) {
    subscribers.add(subscriber);
    ensureObserver();

    let active = true;
    return {
        disconnect() {
            if (!active) return;
            active = false;
            subscribers.delete(subscriber);
            if (subscribers.size === 0 && observer) {
                observer.disconnect();
                observer = null;
            }
        },
    };
}
