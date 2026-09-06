// Load large, surface-specific styles only when their UI is first opened.

const pendingStyles = new Map();
const featureAssetRevision = Date.now().toString(36);

/** Keep lazy assets stable within a page session, but fresh after a reload. */
export function versionFeatureAssetUrl(href) {
    const url = new URL(href, document.baseURI);
    url.searchParams.set('bdv', featureAssetRevision);
    return url.href;
}

export function ensureFeatureStyle(id, href) {
    if (pendingStyles.has(id)) return pendingStyles.get(id);
    const existing = document.getElementById(id);
    if (existing) return Promise.resolve(existing);

    const versionedHref = versionFeatureAssetUrl(href);
    const promise = new Promise((resolve) => {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = versionedHref;
        link.addEventListener('load', () => resolve(link), { once: true });
        link.addEventListener('error', () => {
            console.error(`[UIBedazzler] Failed to load feature stylesheet: ${versionedHref}`);
            resolve(link);
        }, { once: true });
        document.head.appendChild(link);
    }).finally(() => pendingStyles.delete(id));

    pendingStyles.set(id, promise);
    return promise;
}
