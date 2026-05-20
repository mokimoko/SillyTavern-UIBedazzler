// src/charDrawer/designTab.js
// Design tab UI and logic — per-character color styling, banner images, avatar color extraction
//
// Colors stored in character card extensions (Marinara-compatible paths):
//   data.extensions.nameColor, dialogueColor, boxColor
// Banner config namespaced under:
//   data.extensions.wl_design.bannerMode, bannerUrl, bannerPosition
//
// CSS injected via <style id="wl-char-design-styles"> targeting [ch_name="CharName"] selectors.
// Live preview updates CSS on every picker change.

import { getContext } from '../../../../../extensions.js';
import { getDesignData, updateCharExtensions } from './storage.js';
import {
    hexToRgb, rgbToHex, parseRgba,
    extractColorsFromImage, uploadBannerImage,
    escapeCSSName, injectStyleElement, clearStyleElement,
} from '../design/designUtils.js';

const log = (...args) => console.log('[WL CharDesign]', ...args);

const STYLE_ELEMENT_ID = 'wl-char-design-styles';

// ============================================================
// Design Data Cache
// ============================================================

/**
 * Cache of extracted design data from character cards.
 * Map<avatar, { name: string, design: object }>
 *
 * Populated once by buildDesignCache() on CHAT_CHANGED / feature enable.
 * Updated for individual characters during live editing (rebuildLiveCSS).
 * Avoids JSON.parse on every character for every CSS rebuild — the parse
 * loop was the #2 performance issue, firing on every slider tick.
 */
let designCache = null;

/**
 * Rebuild the design cache from all loaded characters.
 * Parses json_data once per character — the expensive operation
 * that we cache to avoid repeating on every rebuildLiveCSS() call.
 */
function buildDesignCache() {
    const context = getContext();
    const chars = context.characters || [];
    designCache = new Map();

    for (const char of chars) {
        if (!char?.json_data) continue;

        const raw = char.json_data;
        // Quick substring check before expensive parse
        if (!raw.includes('nameColor') && !raw.includes('dialogueColor') &&
            !raw.includes('boxColor') && !raw.includes('bannerMode')) {
            continue;
        }

        try {
            const cardData = JSON.parse(raw);
            const ext = cardData?.data?.extensions || {};
            const wld = ext.wl_design || {};
            const design = {
                nameColor: ext.nameColor || null,
                dialogueColor: ext.dialogueColor || null,
                boxColor: ext.boxColor || null,
                bannerMode: wld.bannerMode || null,
                bannerUrl: wld.bannerUrl || null,
                bannerPosition: wld.bannerPosition ?? 25,
            };

            if (design.nameColor || design.dialogueColor || design.boxColor || design.bannerMode) {
                designCache.set(char.avatar, { name: char.name, design });
            }
        } catch (e) {
            // Skip unparseable characters
        }
    }

    log(`Design cache built: ${designCache.size} styled character(s)`);
    return designCache;
}

/**
 * Invalidate the design cache.
 * Call when the character list may have changed outside of the normal
 * CHAT_CHANGED → injectDesignCSS flow.
 */
export function invalidateDesignCache() {
    designCache = null;
}

// ============================================================
// Design Tab UI
// ============================================================

/**
 * Render the Design tab content into the given pane element.
 * @param {HTMLElement} pane
 */
export function renderDesignTab(pane) {
    if (!pane) return;

    const design = getDesignData();
    const avatarFile = $('#avatar_url_pole').val();

    // Box color is stored as rgba; extract hex + alpha for the two controls
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
                            <input type="color" id="wl-cd-name-color" value="${design.nameColor || '#cccccc'}" />
                            <span class="wl-cd-color-hex">${design.nameColor || 'default'}</span>
                        </div>
                    </div>

                    <div class="wl-cd-color-row">
                        <label>Dialogue</label>
                        <div class="wl-cd-color-input-wrap">
                            <input type="color" id="wl-cd-dialogue-color" value="${design.dialogueColor || '#cccccc'}" />
                            <span class="wl-cd-color-hex">${design.dialogueColor || 'default'}</span>
                        </div>
                    </div>

                    <div class="wl-cd-color-row">
                        <label>Box</label>
                        <div class="wl-cd-color-input-wrap">
                            <input type="color" id="wl-cd-box-color" value="${boxHex}" />
                            <div class="wl-cd-opacity-wrap">
                                <input type="range" id="wl-cd-box-opacity" min="0" max="1" step="0.05" value="${boxOpacity}" />
                                <span class="wl-cd-opacity-label">${Math.round(boxOpacity * 100)}%</span>
                            </div>
                            <span class="wl-cd-color-hint">(all chat styles)</span>
                        </div>
                    </div>
                </div>

                <div class="wl-cd-color-actions">
                    <button id="wl-cd-extract-colors" class="menu_button" title="Extract dominant colors from the character's avatar">
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
                        <input type="radio" name="wl-cd-banner-mode" value="" ${!design.bannerMode ? 'checked' : ''} />
                        None
                    </label>
                    <label class="${design.bannerMode === 'avatar' ? 'wl-cd-radio-active' : ''}">
                        <input type="radio" name="wl-cd-banner-mode" value="avatar" ${design.bannerMode === 'avatar' ? 'checked' : ''} />
                        Use Avatar
                    </label>
                    <label class="${design.bannerMode === 'custom' ? 'wl-cd-radio-active' : ''}">
                        <input type="radio" name="wl-cd-banner-mode" value="custom" ${design.bannerMode === 'custom' ? 'checked' : ''} />
                        Custom Image
                    </label>
                </div>

                <div id="wl-cd-banner-custom-row" style="display: ${design.bannerMode === 'custom' ? '' : 'none'}">
                    <div class="wl-cd-banner-custom-controls">
                        <button id="wl-cd-banner-upload" class="menu_button">
                            <i class="fa-solid fa-upload"></i> Upload Image
                        </button>
                        <span class="wl-cd-banner-or">or</span>
                        <input type="text" id="wl-cd-banner-url" class="text_pole" placeholder="Paste image URL" value="${design.bannerUrl || ''}" />
                    </div>
                    <input type="file" id="wl-cd-banner-file-input" accept="image/*" style="display:none" />
                </div>

                <div id="wl-cd-banner-position-row" style="display: ${design.bannerMode ? '' : 'none'}">
                    <label>Vertical Position</label>
                    <div class="wl-cd-position-wrap">
                        <span class="wl-cd-pos-label-edge">Top</span>
                        <input type="range" id="wl-cd-banner-position" min="0" max="100" step="1" value="${bannerPos}" />
                        <span class="wl-cd-pos-label-edge">Bottom</span>
                        <span class="wl-cd-pos-value">${bannerPos}%</span>
                    </div>
                </div>
            </div>

            <div class="wl-cd-design-footer">
                <button id="wl-cd-reset-design" class="menu_button wl-cd-reset-btn" title="Clear all design settings and revert to theme defaults">
                    <i class="fa-solid fa-rotate-left"></i> Reset to Default
                </button>
            </div>
        </div>
    `;

    // --- Wire up event handlers ---

    const nameColorInput = pane.querySelector('#wl-cd-name-color');
    const dialogueColorInput = pane.querySelector('#wl-cd-dialogue-color');
    const boxColorInput = pane.querySelector('#wl-cd-box-color');
    const boxOpacityInput = pane.querySelector('#wl-cd-box-opacity');

    // Name color
    nameColorInput?.addEventListener('input', () => {
        const val = nameColorInput.value;
        pane.querySelector('#wl-cd-name-color + .wl-cd-color-hex').textContent = val;
        updateCharExtensions({ nameColor: val });
        rebuildLiveCSS();
    });

    // Dialogue color
    dialogueColorInput?.addEventListener('input', () => {
        const val = dialogueColorInput.value;
        pane.querySelector('#wl-cd-dialogue-color + .wl-cd-color-hex').textContent = val;
        updateCharExtensions({ dialogueColor: val });
        rebuildLiveCSS();
    });

    // Box color + opacity
    const syncBoxColor = () => {
        const hex = boxColorInput.value;
        const opacity = parseFloat(boxOpacityInput.value);
        const rgb = hexToRgb(hex);
        pane.querySelector('.wl-cd-opacity-label').textContent = `${Math.round(opacity * 100)}%`;
        updateCharExtensions({ boxColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})` });
        rebuildLiveCSS();
    };
    boxColorInput?.addEventListener('input', syncBoxColor);
    boxOpacityInput?.addEventListener('input', syncBoxColor);

    // Extract from Avatar
    pane.querySelector('#wl-cd-extract-colors')?.addEventListener('click', async () => {
        const avatar = $('#avatar_url_pole').val();
        if (!avatar) {
            toastr.warning('No avatar set for this character.', 'Design');
            return;
        }

        const btn = pane.querySelector('#wl-cd-extract-colors');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Extracting...';

        try {
            const imgSrc = `/characters/${encodeURIComponent(avatar)}`;
            const [nameColor, dialogueColor, boxColor] = await extractColorsFromImage(imgSrc);

            updateCharExtensions({ nameColor, dialogueColor, boxColor });

            // Update UI
            nameColorInput.value = nameColor;
            pane.querySelector('#wl-cd-name-color + .wl-cd-color-hex').textContent = nameColor;
            dialogueColorInput.value = dialogueColor;
            pane.querySelector('#wl-cd-dialogue-color + .wl-cd-color-hex').textContent = dialogueColor;
            const bparsed = parseRgba(boxColor);
            boxColorInput.value = bparsed ? rgbToHex(bparsed.r, bparsed.g, bparsed.b) : '#4a4441';
            if (boxOpacityInput) {
                boxOpacityInput.value = bparsed ? bparsed.a : 0.5;
                pane.querySelector('.wl-cd-opacity-label').textContent = `${Math.round((bparsed?.a ?? 0.5) * 100)}%`;
            }

            rebuildLiveCSS();
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
    pane.querySelectorAll('input[name="wl-cd-banner-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const mode = radio.value || null;
            pane.querySelector('#wl-cd-banner-custom-row').style.display = mode === 'custom' ? '' : 'none';
            pane.querySelector('#wl-cd-banner-position-row').style.display = mode ? '' : 'none';

            pane.querySelectorAll('.wl-cd-banner-mode label').forEach(l => l.classList.remove('wl-cd-radio-active'));
            radio.closest('label')?.classList.add('wl-cd-radio-active');

            updateCharExtensions({ 'wl_design.bannerMode': mode });
            rebuildLiveCSS();
        });
    });

    // Banner custom URL
    pane.querySelector('#wl-cd-banner-url')?.addEventListener('change', function () {
        updateCharExtensions({ 'wl_design.bannerUrl': this.value || null });
        rebuildLiveCSS();
    });

    // Banner file upload
    const fileInput = pane.querySelector('#wl-cd-banner-file-input');
    pane.querySelector('#wl-cd-banner-upload')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        const uploadBtn = pane.querySelector('#wl-cd-banner-upload');
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';

        try {
            const charName = $('#character_popup-button-h3').text() || 'character';
            const uploadedFilename = await uploadBannerImage(file, charName);
            const displayUrl = `user/images/banners/${uploadedFilename}`;

            updateCharExtensions({ 'wl_design.bannerUrl': displayUrl });

            const urlInput = pane.querySelector('#wl-cd-banner-url');
            if (urlInput) urlInput.value = displayUrl;

            rebuildLiveCSS();
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
    const posSlider = pane.querySelector('#wl-cd-banner-position');
    posSlider?.addEventListener('input', () => {
        const val = parseInt(posSlider.value);
        pane.querySelector('.wl-cd-pos-value').textContent = `${val}%`;
        updateCharExtensions({ 'wl_design.bannerPosition': val });
        rebuildLiveCSS();
    });

    // Reset
    pane.querySelector('#wl-cd-reset-design')?.addEventListener('click', () => {
        updateCharExtensions({
            nameColor: null,
            dialogueColor: null,
            boxColor: null,
            'wl_design.bannerMode': null,
            'wl_design.bannerUrl': null,
            'wl_design.bannerPosition': null,
        });
        removeDesignCSS();
        renderDesignTab(pane);
        toastr.info('Design reset to theme defaults.', 'Design');
    });
}

// ============================================================
// CSS Generation & Injection
// ============================================================

/**
 * Rebuild and inject CSS for live preview (all styled characters).
 * Updates only the currently-edited character in the cache —
 * avoids re-parsing all characters' JSON on every slider tick.
 */
function rebuildLiveCSS() {
    // Update cache for the currently-edited character only.
    // getDesignData() reads from the hidden form field which
    // updateCharExtensions() has already updated.
    const context = getContext();
    const chid = context.characterId;
    if (chid != null && context.characters?.[chid]) {
        const char = context.characters[chid];
        const design = getDesignData();
        if (!designCache) designCache = new Map();

        const hasDesign = design.nameColor || design.dialogueColor ||
                          design.boxColor || design.bannerMode;
        if (hasDesign) {
            designCache.set(char.avatar, { name: char.name, design });
        } else {
            designCache.delete(char.avatar);
        }
    }

    const css = buildAllCharacterCSS();
    if (css) {
        injectStyleElement(STYLE_ELEMENT_ID, css);
    } else {
        clearStyleElement(STYLE_ELEMENT_ID);
    }
}

/**
 * Build CSS rules for a single character's design data.
 * @param {string} charName
 * @param {object} design
 * @param {string} avatarFile
 * @returns {string}
 */
function buildCharacterCSS(charName, design, avatarFile) {
    if (!charName) return '';

    const { nameColor, dialogueColor, boxColor, bannerMode, bannerUrl, bannerPosition } = design;
    const boxRgba = boxColor && (boxColor.startsWith('rgba') || boxColor.startsWith('rgb')) ? boxColor : null;
    const hasAnyColor = nameColor || dialogueColor || boxRgba;
    const hasBanner = bannerMode != null;

    if (!hasAnyColor && !hasBanner) return '';

    const escapedName = escapeCSSName(charName);
    const selector = `.mes[ch_name="${escapedName}"]`;
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
            bannerImageUrl = `/characters/${encodeURIComponent(avatarFile)}`;
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
 * Build CSS for ALL characters that have design data.
 * Reads from the design cache instead of re-parsing every
 * character's json_data string.
 * @returns {string}
 */
function buildAllCharacterCSS() {
    if (!designCache) buildDesignCache();

    const allRules = ['/* WL Character Design */'];

    for (const [avatar, entry] of designCache) {
        const css = buildCharacterCSS(entry.name, entry.design, avatar);
        if (css) allRules.push(css);
    }

    return allRules.length > 1 ? allRules.join('\n\n') : '';
}

/**
 * Inject design CSS for ALL characters with design data.
 * Called on CHAT_CHANGED and feature enable.
 * Rebuilds the design cache from scratch (character list may have changed).
 */
export function injectDesignCSS() {
    buildDesignCache();
    const css = buildAllCharacterCSS();
    if (css) {
        injectStyleElement(STYLE_ELEMENT_ID, css);
        log('Design CSS injected for all styled characters');
    } else {
        clearStyleElement(STYLE_ELEMENT_ID);
    }
}

/**
 * Remove all injected design CSS.
 */
export function removeDesignCSS() {
    clearStyleElement(STYLE_ELEMENT_ID);
}
