import { ensureFeatureStyle } from '../featureStyles.js';

const STYLE_ID = 'bd-chat-design-modal-style';
const styleUrl = () => new URL('../../chatDesign.css', import.meta.url).href;
let modalModulePromise = null;

function loadModalModule() {
    return modalModulePromise ??= import('./modal.js');
}

export async function openChatDesignModal() {
    const [, modal] = await Promise.all([
        ensureFeatureStyle(STYLE_ID, styleUrl()),
        loadModalModule(),
    ]);
    modal.openChatDesignModal();
}
