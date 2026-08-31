import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const TEST_PORT = 3990;

// Environment variables must be set before the modules are imported
process.env.API_KEY = 'test_api_key';
process.env.SESSIONS_PATH = './sessions_test_client';
process.env.BASE_WEBHOOK_URL = `http://localhost:${TEST_PORT}/localCallbackExample`;

const app = (await import('../src/app')).default;
const { sessions } = require('../src/sessions');

const SESSION_ID = 'clienttest';
const CHAT_ID = '6281288888888@c.us';

// No Chromium: sessionValidation only needs an evaluable pupPage and a CONNECTED state
const buildClient = overrides => {
  const client = new EventEmitter();
  client.pupPage = { isClosed: () => false, evaluate: async () => 1 };
  client.getState = async () => 'CONNECTED';
  return Object.assign(client, overrides);
};

const post = (route, body = {}) => request(app).post(`/client/${route}/${SESSION_ID}`).set('x-api-key', 'test_api_key').send(body);

let server;
beforeAll(() => {
  server = app.listen(TEST_PORT);
});

afterEach(() => {
  sessions.delete(SESSION_ID);
});

afterAll(() => {
  server.close();
  fs.rmSync('./sessions_test_client', { recursive: true, force: true });
});

describe('client endpoints ported from wwebjs-api', () => {
  it('counts the devices of a contact and qualifies bare digits', async () => {
    let asked = null;
    sessions.set(
      SESSION_ID,
      buildClient({
        getContactDeviceCount: async userId => {
          asked = userId;
          return 2;
        },
      }),
    );

    const response = await post('getContactDeviceCount', { userId: '6281288888888' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, result: 2 });
    expect(asked).toBe(CHAT_ID);
  });

  it('resets the connection state', async () => {
    let called = false;
    sessions.set(
      SESSION_ID,
      buildClient({
        resetState: async () => {
          called = true;
        },
      }),
    );

    const response = await post('resetState');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(called).toBe(true);
  });

  it('requests a history sync and passes the result through', async () => {
    sessions.set(SESSION_ID, buildClient({ syncHistory: async () => false }));

    const response = await post('syncHistory', { chatId: CHAT_ID });

    expect(response.status).toBe(200);
    // false means there was nothing left to sync, which is not an error
    expect(response.body).toEqual({ success: true, result: false });
  });

  it('deletes the profile picture', async () => {
    sessions.set(SESSION_ID, buildClient({ deleteProfilePicture: async () => true }));

    const response = await post('deleteProfilePicture');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, result: true });
  });

  it.each([
    ['setAutoDownloadAudio', 'setAutoDownloadAudio'],
    ['setAutoDownloadDocuments', 'setAutoDownloadDocuments'],
    ['setAutoDownloadPhotos', 'setAutoDownloadPhotos'],
    ['setAutoDownloadVideos', 'setAutoDownloadVideos'],
    ['setBackgroundSync', 'setBackgroundSync'],
  ])('forwards the flag to %s', async (route, method) => {
    let flag = null;
    sessions.set(
      SESSION_ID,
      buildClient({
        [method]: async value => {
          flag = value;
        },
      }),
    );

    const response = await post(route, { flag: false });

    expect(response.status).toBe(200);
    expect(flag).toBe(false);
  });

  it('defaults the flag to true when the body omits it', async () => {
    let flag = null;
    sessions.set(
      SESSION_ID,
      buildClient({
        setBackgroundSync: async value => {
          flag = value;
        },
      }),
    );

    await post('setBackgroundSync');

    expect(flag).toBe(true);
  });

  it('opens a chat window through the interface controller', async () => {
    let opened = null;
    sessions.set(SESSION_ID, buildClient({ interface: { openChatWindow: async chatId => (opened = chatId) } }));

    const response = await post('openChatWindow', { chatId: CHAT_ID });

    expect(response.status).toBe(200);
    expect(opened).toBe(CHAT_ID);
  });

  it('opens a chat window at a message', async () => {
    let opened = null;
    sessions.set(SESSION_ID, buildClient({ interface: { openChatWindowAt: async msgId => (opened = msgId) } }));

    const response = await post('openChatWindowAt', { messageId: 'true_6281288888888@c.us_ABCDEF' });

    expect(response.status).toBe(200);
    expect(opened).toBe('true_6281288888888@c.us_ABCDEF');
  });

  it.each([
    ['getContactDeviceCount', 'userId is required'],
    ['syncHistory', 'chatId is required'],
    ['openChatWindow', 'chatId is required'],
    ['openChatWindowAt', 'messageId is required'],
  ])('answers 422 when %s is missing its parameter', async (route, error) => {
    sessions.set(SESSION_ID, buildClient({}));

    const response = await post(route, {});

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error });
  });
});
