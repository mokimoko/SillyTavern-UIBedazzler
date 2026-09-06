// Minimal startup boundary for hooks that must beat later extension work.

import { extension_settings, getContext } from '../../../extensions.js';
import * as extensionApi from '../../../extensions.js';
import { installTauriCloak } from './src/tauriCloak.js';
import { installWeatherCycleCompat } from './src/weatherCycleCompat.js';
import { installTauriRecentChatsFix } from './src/tauriRecentChatsFix.js';

const MODULE_NAME = 'UIBedazzler';
const BOOTSTRAP_STATE = Symbol.for('UIBedazzler.bootstrapState');

installTauriCloak(extension_settings, extensionApi);
installWeatherCycleCompat(() => extension_settings[MODULE_NAME]?.weatherCycleCompat !== false);

const tauriRecentChatsFixInstalled = installTauriRecentChatsFix({
    getCharacters: () => getContext()?.characters || [],
});

globalThis[BOOTSTRAP_STATE] = { tauriRecentChatsFixInstalled };

void import('./index.js').catch(error => {
    console.error('[UIBedazzler] Main module failed to load.', error);
});
