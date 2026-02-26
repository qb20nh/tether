import { ICONS, ICON_X } from '../icons.js';
import { createLevelProvider } from '../core/level_provider.js';
import { createDefaultCore } from '../core/default_core.js';
import { createGameStateStore } from '../state/game_state_store.js';
import { createLocalStoragePersistence } from '../persistence/local_storage_persistence.js';
import { createDomRenderer } from '../renderer/dom_renderer.js';
import { createDomInputAdapter } from '../input/dom_input_adapter.js';

export function createDefaultAdapters(options = {}) {
  const levelProvider = createLevelProvider({
    cacheLimit: options.infiniteCacheLimit || 48,
  });

  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((index) => core.getLevel(index));
  const persistence = createLocalStoragePersistence({
    campaignLevelCount: core.getCampaignLevelCount(),
    maxInfiniteIndex: core.getInfiniteMaxIndex(),
    windowObj: options.windowObj,
  });

  const renderer = createDomRenderer({
    icons: options.icons || ICONS,
    iconX: options.iconX || ICON_X,
  });

  const input = createDomInputAdapter();

  return {
    core,
    state,
    persistence,
    renderer,
    input,
  };
}
