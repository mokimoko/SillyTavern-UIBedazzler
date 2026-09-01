// Load large, surface-specific styles only when their UI is first opened.

const pendingStyles = new Map();

export function ensureFeatureStyle(id, href) {
    if (pendingStyles.has(id)) return pendingStyles.get(id);
    const existing = document.getElementById(id);
    if (existing) return Promise.resolve(existing);

    const promise = new Promise((resolve) => {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = href;
        link.addEventListener('load', () => resolve(link), { once: true });
        link.addEventListener('error', () => {
            console.error(`[UIBedazzler] Failed to load feature stylesheet: ${href}`);
            resolve(link);
        }, { once: true });
        document.head.appendChild(link);
    }).finally(() => pendingStyles.delete(id));

    pendingStyles.set(id, promise);
    return promise;
}
