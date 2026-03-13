import assert from 'node:assert/strict';
import test from '../test.ts';
import { vi } from 'vitest';
import {
  APP_SHELL_TEMPLATE,
  buildLegendTemplate,
} from '../../src/templates.ts';
import {
  GAME_COMMANDS,
  INTERACTION_UPDATES,
  INTENT_TYPES,
  UI_ACTIONS,
  gameCommandIntent,
  interactionIntent,
  uiActionIntent,
} from '../../src/runtime/intents.ts';
import {
  decodeDailyOverridesPayload,
  encodeDailyOverridesPayload,
} from '../../src/daily_pool_codec.ts';
import { mountStyles } from '../../src/styles.ts';

test('template and intent helpers preserve legacy shell output and payload shapes', () => {
  const translate = (key: string) => `t:${key}`;
  const markup = APP_SHELL_TEMPLATE(translate, [{ value: 'en', label: 'English' }], 'en');
  assert.match(markup, /id="grid"/);
  assert.match(markup, /id="levelSel"/);

  const legendHtml = buildLegendTemplate([
    { type: 'controls', badgeText: 'WASD' },
    { type: 'group', badgeIds: ['a', 'b'], iconCodes: ['x', 'dot'], htmlKey: 'legend.group' },
    { badgeId: 'c', iconCode: 'x', htmlKey: 'legend.item' },
  ], { dot: '<svg>dot</svg>' }, '<svg>x</svg>', translate);
  assert.match(legendHtml, /WASD/);
  assert.match(legendHtml, /id="a"/);
  assert.match(legendHtml, /t:legend.group/);
  assert.match(legendHtml, /<svg>x<\/svg>/);

  const gameIntent = gameCommandIntent(GAME_COMMANDS.LOAD_LEVEL, { levelIndex: 4 });
  const actionIntent = uiActionIntent(UI_ACTIONS.THEME_TOGGLE, { via: 'test' });
  const interaction = interactionIntent(INTERACTION_UPDATES.PATH_DRAG, { pathDragSide: 'end' });
  assert.deepEqual(gameIntent, {
    type: INTENT_TYPES.GAME_COMMAND,
    payload: { commandType: GAME_COMMANDS.LOAD_LEVEL, levelIndex: 4 },
  });
  assert.deepEqual(actionIntent, {
    type: INTENT_TYPES.UI_ACTION,
    payload: { actionType: UI_ACTIONS.THEME_TOGGLE, via: 'test' },
  });
  assert.deepEqual(interaction, {
    type: INTENT_TYPES.INTERACTION_UPDATE,
    payload: { updateType: INTERACTION_UPDATES.PATH_DRAG, pathDragSide: 'end' },
  });
});

test('daily override codec round-trips payloads and rejects invalid headers', () => {
  const encoded = encodeDailyOverridesPayload(new Map([[0, 0], [3, 7]]), 7);
  assert.equal(encoded.entryCount, 2);
  assert.deepEqual({ ...decodeDailyOverridesPayload(encoded.payload) }, { 0: 0, 3: 7 });

  assert.throws(() => {
    decodeDailyOverridesPayload(Uint8Array.from([0x00, 0x01, 0x02]));
  }, /daily overrides payload/i);

  assert.throws(() => {
    encodeDailyOverridesPayload({ 1: 999 }, 999);
  }, /variant width|variant/i);
  assert.throws(() => {
    decodeDailyOverridesPayload(Uint8Array.from([0x44, 0x01, 0x00]));
  }, /variant-bit width/i);
});

test('mountStyles remains a no-op wrapper', () => {
  assert.equal(mountStyles(null), undefined);
});

test('app wrapper imports app_impl', async (t) => {
  vi.resetModules();
  let imported = false;
  vi.doMock('../../src/app_impl.ts', () => {
    imported = true;
    return {};
  });
  t.after(() => {
    vi.resetModules();
    vi.doUnmock('../../src/app_impl.ts');
  });

  await import('../../src/app.ts');
  assert.equal(imported, true);
});
