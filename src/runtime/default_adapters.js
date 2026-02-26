import { ICONS, ICON_X } from '../icons.js';
import { createLevelProvider } from '../core/level_provider.js';
import { createDefaultCore } from '../core/default_core.js';
import { createGameStateStore } from '../state/game_state_store.js';
import { createLocalStoragePersistence } from '../persistence/local_storage_persistence.js';
import { createDomRenderer } from '../renderer/dom_renderer.js';
import { createDomInputAdapter } from '../input/dom_input_adapter.js';

export function createDefaultAdapters(options = {}) {
  const dailyLevel = options.dailyLevel && Array.isArray(options.dailyLevel.grid)
    ? options.dailyLevel
    : null;
  const dailyId = typeof options.dailyId === 'string' && options.dailyId.length > 0
    ? options.dailyId
    : null;

  const levelProvider = createLevelProvider({
    cacheLimit: options.infiniteCacheLimit || 48,
    dailyLevel,
    dailyId,
  });

  const core = createDefaultCore(levelProvider);
  const state = createGameStateStore((index) => core.getLevel(index));
  const persistence = createLocalStoragePersistence({
    campaignLevelCount: core.getCampaignLevelCount(),
    maxInfiniteIndex: core.getInfiniteMaxIndex(),
    dailyAbsIndex: core.getDailyAbsIndex(),
    activeDailyId: core.getDailyId(),
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
