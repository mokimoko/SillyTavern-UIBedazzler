import { ensureFeatureStyle, versionFeatureAssetUrl } from '../featureStyles.js';

const STYLE_ID = 'bd-chat-design-modal-style';
const styleUrl = () => new URL('../../chatDesign.css', import.meta.url).href;
let modalModulePromise = null;

function loadModalModule() {
    if (!modalModulePromise) {
        const moduleUrl = versionFeatureAssetUrl(new URL('./modal.js', import.meta.url).href);
        modalModulePromise = import(moduleUrl).catch(error => {
            modalModulePromise = null;
            throw error;
        });
    }
    return modalModulePromise;
}

export async function openChatDesignModal() {
    // Tauri can omit a cached stylesheet's load event; the sheet may finish
    // independently, but it must never hold the modal opener hostage.
    void ensureFeatureStyle(STYLE_ID, styleUrl());
    try {
        const modal = await loadModalModule();
        modal.openChatDesignModal();
    } catch (error) {
        console.error('[UIBedazzler] Failed to open Chat Design:', error);
    }
}
