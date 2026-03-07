import test from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENT_IDS } from '../../src/config.js';
import { createNotificationDialogController } from '../../src/app/notification_dialog_controller.js';
import {
  FakeElement,
  createDocumentMock,
  createWindowMock,
} from './notification_test_harness.js';

const createHarness = (translateNow = (key) => key) => {
  const documentObj = createDocumentMock();
  const windowObj = createWindowMock();

  const updateDialog = documentObj.register(ELEMENT_IDS.UPDATE_APPLY_DIALOG, new FakeElement('dialog'));
  const updateMessage = documentObj.register(ELEMENT_IDS.UPDATE_APPLY_MESSAGE, new FakeElement('div'));
  updateDialog.appendChild(updateMessage);
  const moveDialog = documentObj.register(ELEMENT_IDS.MOVE_DAILY_DIALOG, new FakeElement('dialog'));
  const moveMessage = documentObj.register(ELEMENT_IDS.MOVE_DAILY_MESSAGE, new FakeElement('div'));
  moveDialog.appendChild(moveMessage);

  const controller = createNotificationDialogController({
    elementIds: ELEMENT_IDS,
    translateNow,
    windowObj,
    documentObj,
  });

  return {
    controller,
    documentObj,
    windowObj,
    updateDialog,
    updateMessage,
    moveDialog,
    moveMessage,
  };
};

test('dialog controller falls back to window.confirm when modal APIs are unavailable', async () => {
  const { controller, windowObj } = createHarness();
  controller.bind();

  windowObj.setConfirmValue(true);
  assert.equal(await controller.requestUpdateApplyConfirmation(222), true);
  assert.equal(await controller.requestMoveDailyConfirmation(), true);

  const messages = windowObj.getConfirmMessages();
  assert.equal(messages.some((entry) => entry.includes('Install build 222?')), true);
  assert.equal(messages.some((entry) => entry.includes('Move to Daily level anyway?')), true);
});

test('dialog controller resolves modal promises based on close returnValue', async () => {
  const {
    controller,
    updateDialog,
    moveDialog,
  } = createHarness();

  updateDialog.showModal = () => {
    updateDialog.open = true;
  };
  moveDialog.showModal = () => {
    moveDialog.open = true;
  };

  controller.bind();

  const updateConfirmedPromise = controller.requestUpdateApplyConfirmation(300);
  updateDialog.returnValue = 'confirm';
  updateDialog.open = false;
  updateDialog.dispatchEvent({ type: 'close' });
  assert.equal(await updateConfirmedPromise, true);

  const updateCanceledPromise = controller.requestUpdateApplyConfirmation(301);
  updateDialog.returnValue = '';
  updateDialog.open = false;
  updateDialog.dispatchEvent({ type: 'close' });
  assert.equal(await updateCanceledPromise, false);

  const moveConfirmedPromise = controller.requestMoveDailyConfirmation();
  moveDialog.returnValue = 'confirm';
  moveDialog.open = false;
  moveDialog.dispatchEvent({ type: 'close' });
  assert.equal(await moveConfirmedPromise, true);

  const moveCanceledPromise = controller.requestMoveDailyConfirmation();
  moveDialog.returnValue = '';
  moveDialog.open = false;
  moveDialog.dispatchEvent({ type: 'close' });
  assert.equal(await moveCanceledPromise, false);
});

test('dialog controller refreshLocalizedUi updates active dialog message text', async () => {
  let locale = 'en';
  const translations = {
    en: {
      'ui.updateApplyDialogPrompt': 'Install build now?',
      'ui.moveDailyDialogPrompt': 'Move to daily now?',
    },
    ko: {
      'ui.updateApplyDialogPrompt': '지금 빌드를 설치할까요?',
      'ui.moveDailyDialogPrompt': '지금 데일리로 이동할까요?',
    },
  };

  const {
    controller,
    updateDialog,
    updateMessage,
    moveDialog,
    moveMessage,
  } = createHarness((key) => translations[locale][key] || key);

  updateDialog.showModal = () => {
    updateDialog.open = true;
  };
  moveDialog.showModal = () => {
    moveDialog.open = true;
  };

  controller.bind();
  const updatePromise = controller.requestUpdateApplyConfirmation(450);
  const movePromise = controller.requestMoveDailyConfirmation();

  assert.equal(updateMessage.textContent, 'Install build now?');
  assert.equal(moveMessage.textContent, 'Move to daily now?');

  locale = 'ko';
  controller.refreshLocalizedUi();

  assert.equal(updateMessage.textContent, '지금 빌드를 설치할까요?');
  assert.equal(moveMessage.textContent, '지금 데일리로 이동할까요?');

  updateDialog.returnValue = '';
  updateDialog.open = false;
  updateDialog.dispatchEvent({ type: 'close' });
  moveDialog.returnValue = '';
  moveDialog.open = false;
  moveDialog.dispatchEvent({ type: 'close' });

  await updatePromise;
  await movePromise;
});

test('dialog controller reports whether a target is inside an open dialog', () => {
  const { controller, updateDialog } = createHarness();
  const target = new FakeElement('button');
  updateDialog.appendChild(target);
  updateDialog.showModal = () => {
    updateDialog.open = true;
  };

  controller.bind();
  updateDialog.open = true;

  assert.equal(controller.containsOpenDialogTarget(target), true);
  assert.equal(controller.containsOpenDialogTarget(new FakeElement('span')), false);

  updateDialog.open = false;
  assert.equal(controller.containsOpenDialogTarget(target), false);
});
