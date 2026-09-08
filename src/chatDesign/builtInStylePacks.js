// Asset-backed built-in Style Packs. This module is imported only when Add Pack is opened.

const BUILT_IN_PACKS = Object.freeze([
    Object.freeze({ name: 'Seraphina', folder: 'seraphina' }),
    Object.freeze({ name: 'Anomalous', folder: 'anomalous' }),
]);

const manifestPromises = new Map();

function assetUrl(pack, path) {
    return new URL(`../../assets/style-packs/${pack.folder}/${path}`, import.meta.url);
}

async function readAsset(pack, path) {
    const response = await fetch(assetUrl(pack, path));
    if (!response.ok) throw new Error(`Could not load the bundled ${pack.name} resource: ${path}`);
    return new Uint8Array(await response.arrayBuffer());
}

async function getManifest(pack) {
    if (!manifestPromises.has(pack.name)) {
        manifestPromises.set(pack.name, readAsset(pack, 'pack.json')
            .then(bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
            .catch(error => {
                manifestPromises.delete(pack.name);
                throw error;
            }));
    }
    return JSON.parse(JSON.stringify(await manifestPromises.get(pack.name)));
}

/** Return mutable summaries while keeping bundled assets action-only and lazy. */
export async function getBuiltInStylePacks() {
    return Promise.all(BUILT_IN_PACKS.map(getManifest));
}

/** Return one built-in in the same prepared shape as an imported archive. */
export async function getBuiltInStylePack(name) {
    const definition = BUILT_IN_PACKS.find(pack => pack.name === name);
    if (!definition) throw new Error(`Unknown built-in Style Pack: ${name}`);

    const pack = await getManifest(definition);
    const paths = new Set();
    if (pack.resources?.theme?.path) paths.add(pack.resources.theme.path);
    for (const slot of Object.values(pack.resources?.customTopbarIcons?.slots || {})) {
        if (slot.source === 'archive' && slot.path) paths.add(slot.path);
    }
    const entries = new Map(await Promise.all([...paths].map(async path => [path, await readAsset(definition, path)])));
    return { pack, entries };
}
