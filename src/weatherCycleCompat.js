// Compatibility guard for the third-party Weather Cycle extension.
//
// Weather Cycle's heat/blur renderer uploads the unchanged background image
// and resolves the same shader uniforms on every animation frame. Its heat
// shader can also render detailed backgrounds as horizontally stretched bands.
// Patch only its named WebGL canvas so invariant GPU work is reused, and let
// CSS suppress that canvas while leaving every non-canvas weather layer intact.

const WEATHER_CANVAS_ID = 'st-weather-cycle-heat-canvas';
const SAFE_BACKGROUND_CLASS = 'bd-weather-cycle-background-safe';
const STATE_KEY = Symbol.for('UIBedazzler.weatherCycleCompat.state');
const GET_CONTEXT_PATCH = Symbol.for('UIBedazzler.weatherCycleCompat.getContext');
const WEBGL_PATCH = Symbol.for('UIBedazzler.weatherCycleCompat.webgl');

function sharedState() {
    if (!globalThis[STATE_KEY]) {
        globalThis[STATE_KEY] = {
            isEnabled: () => true,
            stats: {
                contextsPatched: 0,
                textureUploadsAvoided: 0,
                uniformLookupsAvoided: 0,
            },
        };
    }
    return globalThis[STATE_KEY];
}

function enabled(state) {
    try {
        return state.isEnabled() !== false;
    } catch {
        return true;
    }
}

function syncBackgroundSafety(state) {
    document.documentElement?.classList.toggle(SAFE_BACKGROUND_CLASS, enabled(state));
}

function imageSignature(image) {
    return `${image.currentSrc || image.src || ''}\u001f${image.naturalWidth || 0}x${image.naturalHeight || 0}`;
}

function patchWeatherContext(gl, state) {
    if (!gl || gl[WEBGL_PATCH]) return gl;

    try {
        Object.defineProperty(gl, WEBGL_PATCH, { value: true });

        const nativeTexImage2D = gl.texImage2D.bind(gl);
        const nativeGetUniformLocation = gl.getUniformLocation.bind(gl);
        const uniformLocations = new WeakMap();
        let lastImage = null;
        let lastImageSignature = '';

        gl.texImage2D = function (...args) {
            const image = args.length === 6 ? args[5] : null;
            if (enabled(state) && image?.tagName === 'IMG' && image.complete) {
                const signature = imageSignature(image);
                if (image === lastImage && signature === lastImageSignature) {
                    state.stats.textureUploadsAvoided++;
                    return;
                }
                lastImage = image;
                lastImageSignature = signature;
            }
            return nativeTexImage2D(...args);
        };

        gl.getUniformLocation = function (program, name) {
            if (!enabled(state) || !program || typeof name !== 'string') {
                return nativeGetUniformLocation(program, name);
            }

            let locations = uniformLocations.get(program);
            if (!locations) {
                locations = new Map();
                uniformLocations.set(program, locations);
            }
            if (locations.has(name)) {
                state.stats.uniformLookupsAvoided++;
                return locations.get(name);
            }

            const location = nativeGetUniformLocation(program, name);
            locations.set(name, location);
            return location;
        };

        state.stats.contextsPatched++;
    } catch (error) {
        console.warn('[UIBedazzler] Could not optimize Weather Cycle WebGL.', error);
    }

    return gl;
}

export function installWeatherCycleCompat(isEnabled) {
    const state = sharedState();
    if (typeof isEnabled === 'function') state.isEnabled = isEnabled;
    syncBackgroundSafety(state);

    const prototype = globalThis.HTMLCanvasElement?.prototype;
    if (!prototype?.getContext) return false;

    if (!prototype[GET_CONTEXT_PATCH]) {
        const nativeGetContext = prototype.getContext;
        Object.defineProperty(prototype, GET_CONTEXT_PATCH, { value: nativeGetContext });

        prototype.getContext = function (type, ...args) {
            const context = nativeGetContext.call(this, type, ...args);
            if (this.id === WEATHER_CANVAS_ID && (type === 'webgl' || type === 'experimental-webgl')) {
                return patchWeatherContext(context, state);
            }
            return context;
        };
    }

    // Also covers extension hot-reloads where Weather Cycle already owns a context.
    const existingCanvas = document.getElementById(WEATHER_CANVAS_ID);
    if (existingCanvas) patchWeatherContext(existingCanvas.getContext('webgl'), state);
    return true;
}

/** Apply a live settings-toggle change without requiring a page reload. */
export function onWeatherCycleCompatToggleChanged() {
    syncBackgroundSafety(sharedState());
}

export function getWeatherCycleCompatStats() {
    return { ...sharedState().stats };
}
