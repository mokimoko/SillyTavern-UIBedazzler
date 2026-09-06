// Character-scoped palette overrides for SillyTavern's native form controls.

function color(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}

export function buildControlStyleCSS(properties = {}) {
    if (properties.controlColorsMode !== 'custom') return '';

    const checkboxSurface = color(properties.checkboxSurfaceColor, '#20242c');
    const checkboxTick = color(properties.checkboxTickColor, '#8fb5ff');
    const checkboxBorder = color(properties.checkboxBorderColor, '#667085');
    const toggleOn = color(properties.toggleOnColor, '#7aa2f7');
    const toggleOff = color(properties.toggleOffColor, '#4b5563');
    const toggleKnob = color(properties.toggleKnobColor, '#f4f7fb');
    const radioSurface = color(properties.radioSurfaceColor, '#20242c');
    const radioDot = color(properties.radioDotColor, '#7aa2f7');
    const radioBorder = color(properties.radioBorderColor, '#667085');
    const sliderTrack = color(properties.sliderTrackColor, '#3f4654');
    const sliderThumb = color(properties.sliderThumbColor, '#7aa2f7');
    const sliderThumbBorder = color(properties.sliderThumbBorderColor, '#dbe6ff');

    return `/* Native control palette */
input[type="checkbox"]:not(.bd-switch) {
    background-color: ${checkboxSurface} !important;
    border-color: ${checkboxBorder} !important;
    outline-color: color-mix(in srgb, ${checkboxBorder} 55%, transparent) !important;
}
input[type="checkbox"]:not(.bd-switch)::before {
    box-shadow: inset 1em 1em ${checkboxTick} !important;
}

input[type="radio"] {
    -webkit-appearance: none;
    appearance: none;
    display: inline-grid;
    place-content: center;
    width: 1em;
    height: 1em;
    flex: 0 0 auto;
    border: 1px solid ${radioBorder} !important;
    border-radius: 50%;
    background: ${radioSurface} !important;
    box-shadow: inset 0 0 2px color-mix(in srgb, ${radioBorder} 55%, transparent);
    cursor: pointer;
    transform: translateY(-0.075em);
}
input[type="radio"]::before {
    content: "";
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    background: ${radioDot};
    transform: scale(0);
    transition: transform var(--animation-duration, 0.15s) ease-in-out;
}
input[type="radio"]:checked::before {
    transform: scale(1);
}
input[type="radio"]:focus-visible {
    outline: 2px solid color-mix(in srgb, ${radioDot} 70%, transparent);
    outline-offset: 2px;
}
input[type="radio"]:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

:is(.fa-toggle-on, .toggleOn) {
    color: ${toggleOn} !important;
}
:is(.fa-toggle-off, .toggleOff) {
    color: ${toggleOff} !important;
}
.prompt_order .toggle_button::after {
    color: ${toggleOn} !important;
}
.prompt_order .disabled .toggle_button::after {
    color: ${toggleOff} !important;
}
.bd-switch {
    background: ${toggleOff} !important;
}
.bd-switch:checked {
    background: ${toggleOn} !important;
}
.bd-switch::before {
    background: ${toggleKnob} !important;
}
.wl-toggle-slider,
.wl-cdm-card-toggle-track {
    background: ${toggleOff} !important;
}
.wl-toggle-slider::before,
.wl-cdm-card-toggle-track::after {
    background: ${toggleKnob} !important;
}
.wl-toggle input:checked + .wl-toggle-slider,
.wl-cdm-card-enabled:checked + .wl-cdm-card-toggle-track {
    background: ${toggleOn} !important;
}

input[type="range"],
input[type="range"].neo-range-slider {
    background: ${sliderTrack} !important;
}
input[type="range"]::-webkit-slider-thumb {
    background: ${sliderThumb} !important;
    border-color: ${sliderThumbBorder} !important;
}
input[type="range"]::-moz-range-track {
    background: ${sliderTrack} !important;
}
input[type="range"]::-moz-range-progress {
    background: ${sliderTrack} !important;
}
input[type="range"]::-moz-range-thumb {
    background: ${sliderThumb} !important;
    border: 2px solid ${sliderThumbBorder} !important;
}`;
}
