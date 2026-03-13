import { ICONS, ICON_X } from '../icons.ts';
import type {
  CorePort,
  CreateDefaultAdaptersOptions,
  DefaultAdapters,
  InputPort,
  PersistencePort,
  RendererPort,
  StatePort,
} from '../contracts/ports.ts';
import { createLevelProvider } from '../core/level_provider.ts';
import { createDefaultCore } from '../core/default_core.ts';
import { createGameStateStore } from '../state/game_state_store.ts';
import { createLocalStoragePersistence } from '../persistence/local_storage_persistence.ts';
import { createDomRenderer } from '../renderer/dom_renderer.ts';
import { createDomInputAdapter } from '../input/dom_input_adapter.ts';

export function createDefaultAdapters(
  options: CreateDefaultAdaptersOptions = {},
): DefaultAdapters {
  const dailyLevel = options.dailyLevel && Array.isArray(options.dailyLevel.grid)
    ? options.dailyLevel
    : null;
  const dailyId = typeof options.dailyId === 'string' && options.dailyId.length > 0
    ? options.dailyId
    : null;

  const levelProvider = createLevelProvider({
    cacheLimit: options.infiniteCacheLimit || 24,
    dailyLevel,
    dailyId,
  });

  const core = createDefaultCore(levelProvider) as CorePort;
  const state = createGameStateStore((index: number) => core.getLevel(index)) as StatePort;
  const persistence = createLocalStoragePersistence({
    campaignLevelCount: core.getCampaignLevelCount(),
    maxInfiniteIndex: core.getInfiniteMaxIndex(),
    dailyAbsIndex: core.getDailyAbsIndex(),
    activeDailyId: core.getDailyId(),
    windowObj: options.windowObj,
  }) as PersistencePort;

  const renderer = createDomRenderer({
    icons: options.icons || ICONS,
    iconX: options.iconX || ICON_X,
  }) as RendererPort;

  const input = createDomInputAdapter() as InputPort;

  return {
    core,
    state,
    persistence,
    renderer,
    input,
  };
}
