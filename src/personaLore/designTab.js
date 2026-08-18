// src/personaLore/designTab.js
// Design tab UI and logic — per-persona color styling, banner images, avatar color extraction
//
// Storage: extension_settings.WhiteLotus.personaDesigns[avatarId]
//   { personaName, nameColor, dialogueColor, boxColor, bannerMode, bannerUrl, bannerPosition }
//
// CSS injected via <style id="wl-persona-design-styles"> targeting
//   .mes[ch_name="PersonaName"][is_user="true"] selectors.

import { extension_settings } from '../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../script.js';
import { MODULE_NAME } from '../settings.js';
import {
    hexToRgb, rgbToHex, parseRgba,
    extractColorsFromImage, uploadBannerImage,
    escapeCSSName, injectStyleElement, clearStyleElement,
} from '../design/designUtils.js';
import { refreshChatDesignCSSDebounced } from '../chatDesign/index.js';

const log = () => {};

const STYLE_ELEMENT_ID = 'wl-persona-design-styles';

// ============================================================
// Storage Helpers
// ============================================================

/**
 * Get the current persona's avatar filename from the persona drawer.
 * @returns {string|null}
 */
function getCurrentPersonaAvatar() {
    const selected = document.querySelector('#user_avatar_block .avatar-container.selected');
    return selected?.getAttribute('data-avatar-id') || null;
}

/**
 * Get the current persona's display name from the drawer.
 * @returns {string}
 */
function getCurrentPersonaName() {
    return document.querySelector('#your_name')?.textContent?.trim() || '';
}

/**
 * Get design data for the current persona.
 * @returns {object}
 */
function getDesignData() {
    const avatar = getCurrentPersonaAvatar();
    if (!avatar) return {};
    const designs = extension_settings[MODULE_NAME]?.personaDesigns || {};
    return designs[avatar] || {};
}

/**
 * Update design data for the current persona and save.
 * @param {object} updates — key/value pairs to merge into the persona's design
 */
function updatePersonaDesign(updates) {
    const avatar = getCurrentPersonaAvatar();
    const name = getCurrentPersonaName();
    if (!avatar) return;

    const settings = extension_settings[MODULE_NAME];
    if (!settings.personaDesigns) settings.personaDesigns = {};

    const existing = settings.personaDesigns[avatar] || {};
    existing.personaName = name;

    // Handle dot-notation keys like 'bannerMode' (flat — no nesting for persona)
    for (const [key, val] of Object.entries(updates)) {
        if (val === null) {
            delete existing[key];
        } else {
            existing[key] = val;
        }
    }

    // Clean up empty design entries
    const hasDesign = existing.nameColor || existing.dialogueColor || existing.boxColor || existing.bannerMode;
    if (hasDesign) {
        settings.personaDesigns[avatar] = existing;
    } else {
        delete settings.personaDesigns[avatar];
    }

    saveSettingsDebounced();
    rebuildLiveCSS();
    // Persona banners are ALSO drawn by Chat Design, whose ::before rule uses
    // !important and therefore wins over this tab's rule. Refresh it too so
    // banner position/image edits apply live instead of only after a chat
    // reload. Debounced + self-guarding (no-op when Chat Design is disabled).
    refreshChatDesignCSSDebounced();
}

// ============================================================
// Design Tab UI
// ============================================================

/**
 * Render the Design tab content into the given pane element.
 * Reuses wl-cd- CSS classes from charDrawer.css for consistent styling.
 * @param {HTMLElement} pane
 */
export function renderDesignTab(pane) {
    if (!pane) return;

    const avatar = getCurrentPersonaAvatar();
    if (!avatar) {
        pane.innerHTML = `
            <div class="wl-pl-empty-state">
                <i class="fa-solid fa-user-slash"></i>
                <p>No persona selected</p>
                <p class="wl-pl-hint">Select a persona from the list to customize its design.</p>
            </div>
        `;
        return;
    }

    const design = getDesignData();
    const personaName = getCurrentPersonaName();

    const boxParsed = parseRgba(design.boxColor) || (design.boxColor?.startsWith('#') ? { ...hexToRgb(design.boxColor), a: 0.5 } : null);
    const boxHex = boxParsed ? rgbToHex(boxParsed.r, boxParsed.g, boxParsed.b) : '#4a4441';
    const boxOpacity = boxParsed ? boxParsed.a : 0.5;
    const bannerPos = design.bannerPosition ?? 25;

    pane.innerHTML = `
        <div class="wl-cd-design">
            <div class="wl-cd-design-section">
                <div class="wl-cd-design-section-title">
                    <i class="fa-solid fa-droplet"></i> Colors
                </div>

                <div class="wl-cd-color-grid">
                    <div class="wl-cd-color-row">
                        <label>Name</label>
                        <div class="wl-cd-color-input-wrap">
                            <input type="color" id="wl-pd-name-color" value="${design.nameColor || '#cccccc'}" />
                            <span class="wl-cd-color-hex">${design.nameColor || 'default'}</span>
                        </div>
                    </div>

                    <div class="wl-cd-color-row">
                        <label>Dialogue</label>
                        <div class="wl-cd-color-input-wrap">
                            <input type="color" id="wl-pd-dialogue-color" value="${design.dialogueColor || '#cccccc'}" />
                            <span class="wl-cd-color-hex">${design.dialogueColor || 'default'}</span>
                        </div>
                    </div>

                    <div class="wl-cd-color-row">
                        <label>Box</label>
                        <div class="wl-cd-color-input-wrap">
                            <input type="color" id="wl-pd-box-color" value="${boxHex}" />
                            <div class="wl-cd-opacity-wrap">
                                <input type="range" id="wl-pd-box-opacity" min="0" max="1" step="0.05" value="${boxOpacity}" />
                                <span class="wl-cd-opacity-label">${Math.round(boxOpacity * 100)}%</span>
                            </div>
                            <span class="wl-cd-color-hint">(all chat styles)</span>
                        </div>
                    </div>
                </div>

                <div class="wl-cd-color-actions">
                    <button id="wl-pd-extract-colors" class="menu_button" title="Extract dominant colors from the persona's avatar">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Extract from Avatar
                    </button>
                </div>
            </div>

            <div class="wl-cd-design-section">
                <div class="wl-cd-design-section-title">
                    <i class="fa-solid fa-panorama"></i> Banner
                </div>

                <div class="wl-cd-banner-mode">
                    <label class="${!design.bannerMode ? 'wl-cd-radio-active' : ''}">
                        <input type="radio" name="wl-pd-banner-mode" value="" ${!design.bannerMode ? 'checked' : ''} />
                        None
                    </label>
                    <label class="${design.bannerMode === 'avatar' ? 'wl-cd-radio-active' : ''}">
                        <input type="radio" name="wl-pd-banner-mode" value="avatar" ${design.bannerMode === 'avatar' ? 'checked' : ''} />
                        Use Avatar
                    </label>
                    <label class="${design.bannerMode === 'custom' ? 'wl-cd-radio-active' : ''}">
                        <input type="radio" name="wl-pd-banner-mode" value="custom" ${design.bannerMode === 'custom' ? 'checked' : ''} />
                        Custom Image
                    </label>
                </div>

                <div id="wl-pd-banner-custom-row" style="display: ${design.bannerMode === 'custom' ? '' : 'none'}">
                    <div class="wl-cd-banner-custom-controls">
                        <button id="wl-pd-banner-upload" class="menu_button">
                            <i class="fa-solid fa-upload"></i> Upload Image
                        </button>
                        <span class="wl-cd-banner-or">or</span>
                        <input type="text" id="wl-pd-banner-url" class="text_pole" placeholder="Paste image URL" value="${design.bannerUrl || ''}" />
                    </div>
                    <input type="file" id="wl-pd-banner-file-input" accept="image/*" style="display:none" />
                </div>

                <div id="wl-pd-banner-position-row" style="display: ${design.bannerMode ? '' : 'none'}">
                    <label>Vertical Position</label>
                    <div class="wl-cd-position-wrap">
                        <span class="wl-cd-pos-label-edge">Top</span>
                        <input type="range" id="wl-pd-banner-position" min="0" max="100" step="1" value="${bannerPos}" />
                        <span class="wl-cd-pos-label-edge">Bottom</span>
                        <span class="wl-cd-pos-value">${bannerPos}%</span>
                    </div>
                </div>
            </div>

            <div class="wl-cd-design-footer">
                <button id="wl-pd-reset-design" class="menu_button wl-cd-reset-btn" title="Clear all design settings and revert to theme defaults">
                    <i class="fa-solid fa-rotate-left"></i> Reset to Default
                </button>
            </div>
        </div>
    `;

    // --- Wire up event handlers ---

    const nameColorInput = pane.querySelector('#wl-pd-name-color');
    const dialogueColorInput = pane.querySelector('#wl-pd-dialogue-color');
    const boxColorInput = pane.querySelector('#wl-pd-box-color');
    const boxOpacityInput = pane.querySelector('#wl-pd-box-opacity');

    // Name color
    nameColorInput?.addEventListener('input', () => {
        const val = nameColorInput.value;
        pane.querySelector('#wl-pd-name-color + .wl-cd-color-hex').textContent = val;
        updatePersonaDesign({ nameColor: val });
    });

    // Dialogue color
    dialogueColorInput?.addEventListener('input', () => {
        const val = dialogueColorInput.value;
        pane.querySelector('#wl-pd-dialogue-color + .wl-cd-color-hex').textContent = val;
        updatePersonaDesign({ dialogueColor: val });
    });

    // Box color + opacity
    const syncBoxColor = () => {
        const hex = boxColorInput.value;
        const opacity = parseFloat(boxOpacityInput.value);
        const rgb = hexToRgb(hex);
        pane.querySelector('.wl-cd-opacity-label').textContent = `${Math.round(opacity * 100)}%`;
        updatePersonaDesign({ boxColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})` });
    };
    boxColorInput?.addEventListener('input', syncBoxColor);
    boxOpacityInput?.addEventListener('input', syncBoxColor);

    // Extract from Avatar
    pane.querySelector('#wl-pd-extract-colors')?.addEventListener('click', async () => {
        const avatarFile = getCurrentPersonaAvatar();
        if (!avatarFile) {
            toastr.warning('No persona avatar found.', 'Design');
            return;
        }

        const btn = pane.querySelector('#wl-pd-extract-colors');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Extracting...';

        try {
            const imgSrc = `/User Avatars/${encodeURIComponent(avatarFile)}`;
            const [nameColor, dialogueColor, boxColor] = await extractColorsFromImage(imgSrc);

            updatePersonaDesign({ nameColor, dialogueColor, boxColor });

            // Update UI
            nameColorInput.value = nameColor;
            pane.querySelector('#wl-pd-name-color + .wl-cd-color-hex').textContent = nameColor;
            dialogueColorInput.value = dialogueColor;
            pane.querySelector('#wl-pd-dialogue-color + .wl-cd-color-hex').textContent = dialogueColor;
            const bparsed = parseRgba(boxColor);
            boxColorInput.value = bparsed ? rgbToHex(bparsed.r, bparsed.g, bparsed.b) : '#4a4441';
            if (boxOpacityInput) {
                boxOpacityInput.value = bparsed ? bparsed.a : 0.5;
                pane.querySelector('.wl-cd-opacity-label').textContent = `${Math.round((bparsed?.a ?? 0.5) * 100)}%`;
            }

            toastr.success('Colors extracted from avatar.', 'Design');
        } catch (err) {
            log('Color extraction failed:', err);
            toastr.error('Could not extract colors from avatar.', 'Design');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Extract from Avatar';
        }
    });

    // Banner mode radio
    pane.querySelectorAll('input[name="wl-pd-banner-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const mode = radio.value || null;
            pane.querySelector('#wl-pd-banner-custom-row').style.display = mode === 'custom' ? '' : 'none';
            pane.querySelector('#wl-pd-banner-position-row').style.display = mode ? '' : 'none';

            pane.querySelectorAll('.wl-cd-banner-mode label').forEach(l => l.classList.remove('wl-cd-radio-active'));
            radio.closest('label')?.classList.add('wl-cd-radio-active');

            updatePersonaDesign({ bannerMode: mode });
        });
    });

    // Banner custom URL
    pane.querySelector('#wl-pd-banner-url')?.addEventListener('change', function () {
        updatePersonaDesign({ bannerUrl: this.value || null });
    });

    // Banner file upload
    const fileInput = pane.querySelector('#wl-pd-banner-file-input');
    pane.querySelector('#wl-pd-banner-upload')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        const uploadBtn = pane.querySelector('#wl-pd-banner-upload');
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';

        try {
            const name = getCurrentPersonaName() || 'persona';
            const uploadedFilename = await uploadBannerImage(file, name);
            const displayUrl = `user/images/banners/${uploadedFilename}`;

            updatePersonaDesign({ bannerUrl: displayUrl });

            const urlInput = pane.querySelector('#wl-pd-banner-url');
            if (urlInput) urlInput.value = displayUrl;

            toastr.success('Banner image uploaded.', 'Design');
        } catch (err) {
            log('Banner upload failed:', err);
            toastr.error('Failed to upload banner image.', 'Design');
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload Image';
            fileInput.value = '';
        }
    });

    // Banner position slider
    const posSlider = pane.querySelector('#wl-pd-banner-position');
    posSlider?.addEventListener('input', () => {
        const val = parseInt(posSlider.value);
        pane.querySelector('.wl-cd-pos-value').textContent = `${val}%`;
        updatePersonaDesign({ bannerPosition: val });
    });

    // Reset
    pane.querySelector('#wl-pd-reset-design')?.addEventListener('click', () => {
        const avatarKey = getCurrentPersonaAvatar();
        if (avatarKey) {
            const settings = extension_settings[MODULE_NAME];
            if (settings.personaDesigns) {
                delete settings.personaDesigns[avatarKey];
                saveSettingsDebounced();
            }
        }
        removeDesignCSS();
        renderDesignTab(pane);
        // Also refresh Chat Design so its persona banner rule drops the
        // just-removed position/image immediately.
        refreshChatDesignCSSDebounced();
        toastr.info('Design reset to theme defaults.', 'Design');
    });
}

// ============================================================
// CSS Generation & Injection
// ============================================================

/**
 * Rebuild and inject CSS for live preview.
 */
function rebuildLiveCSS() {
    const css = buildAllPersonaCSS();
    if (css) {
        injectStyleElement(STYLE_ELEMENT_ID, css);
    } else {
        clearStyleElement(STYLE_ELEMENT_ID);
    }
}

/**
 * Build CSS rules for a single persona's design data.
 * @param {string} personaName
 * @param {object} design
 * @param {string} avatarFile — for banner "Use Avatar" mode
 * @returns {string}
 */
function buildPersonaCSS(personaName, design, avatarFile) {
    if (!personaName) return '';

    const { nameColor, dialogueColor, boxColor, bannerMode, bannerUrl, bannerPosition } = design;
    const boxRgba = boxColor && (boxColor.startsWith('rgba') || boxColor.startsWith('rgb')) ? boxColor : null;
    const hasAnyColor = nameColor || dialogueColor || boxRgba;
    const hasBanner = bannerMode != null;

    if (!hasAnyColor && !hasBanner) return '';

    const escapedName = escapeCSSName(personaName);
    const selector = `.mes[ch_name="${escapedName}"][is_user="true"]`;
    const pos = bannerPosition ?? 25;
    const rules = [];

    if (dialogueColor) {
        rules.push(`${selector} q { color: ${dialogueColor}; }`);
    }
    if (nameColor) {
        rules.push(`${selector} .name_text { color: ${nameColor}; }`);
    }
    if (boxRgba) {
        rules.push(`#chat ${selector} {\n    background-color: ${boxRgba} !important;\n}`);
    }

    if (hasBanner) {
        let bannerImageUrl = '';
        if (bannerMode === 'avatar' && avatarFile) {
            bannerImageUrl = `/User Avatars/${encodeURIComponent(avatarFile)}`;
        } else if (bannerMode === 'custom' && bannerUrl) {
            bannerImageUrl = bannerUrl;
        }

        if (bannerImageUrl) {
            rules.push(`#chat ${selector} {
    position: relative !important;
    padding-top: 140px !important;
    overflow: visible !important;
    box-shadow: 0 5px 15px rgba(0,0,0,0.5);
}`);
            rules.push(`#chat ${selector}::before {
    content: "";
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 140px;
    background: url('${bannerImageUrl}') center ${pos}% / cover no-repeat;
    z-index: 1;
    pointer-events: none;
    -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.8) 30%, transparent 100%);
    mask-image: linear-gradient(to bottom, rgba(0,0,0,0.8) 30%, transparent 100%);
}`);
            rules.push(`${selector} .mes_block,
${selector} .mes_text,
${selector} .ch_name,
${selector} .mesAvatarWrapper {
    position: relative;
    z-index: 3;
}`);
        }
    }

    return rules.join('\n');
}

/**
 * Build CSS for ALL personas that have design data.
 * @returns {string}
 */
function buildAllPersonaCSS() {
    const designs = extension_settings[MODULE_NAME]?.personaDesigns || {};
    const allRules = ['/* WL Persona Design */'];

    for (const [avatarFile, design] of Object.entries(designs)) {
        const name = design.personaName;
        if (!name) continue;

        const css = buildPersonaCSS(name, design, avatarFile);
        if (css) allRules.push(css);
    }

    return allRules.length > 1 ? allRules.join('\n\n') : '';
}

/**
 * Inject design CSS for ALL personas with design data.
 * Called on CHAT_CHANGED, persona change, and feature enable.
 */
export function injectDesignCSS() {
    const css = buildAllPersonaCSS();
    if (css) {
        injectStyleElement(STYLE_ELEMENT_ID, css);
        log('Design CSS injected for all styled personas');
    } else {
        clearStyleElement(STYLE_ELEMENT_ID);
    }
}

/**
 * Remove all injected persona design CSS.
 */
export function removeDesignCSS() {
    clearStyleElement(STYLE_ELEMENT_ID);
}
