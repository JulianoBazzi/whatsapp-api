import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const TEST_PORT = 3991;
const SESSIONS_PATH = './sessions_test_lifecycle';

// Environment variables must be set before the modules are imported.
// CHROME_BIN pointing nowhere is what keeps these tests browser-free: the real setupSession still
// runs (Client created, sessions.set done synchronously) and initialize() rejects within
// milliseconds on puppeteer's executable check, after which its own catch cleans the Map up.
process.env.API_KEY = 'test_api_key';
process.env.SESSIONS_PATH = SESSIONS_PATH;
process.env.BASE_WEBHOOK_URL = `http://localhost:${TEST_PORT}/localCallbackExample`;
process.env.RECOVER_SESSIONS = 'TRUE';
process.env.CHROME_BIN = '/nonexistent/chrome';

const app = (await import('../src/app')).default;
const { sessions, initializeEvents, reloadSession } = require('../src/sessions');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessionFolder = id => `${SESSIONS_PATH}/session-${id}`;
const get = route => request(app).get(`/session/${route}`).set('x-api-key', 'test_api_key');

const buildPage = () => Object.assign(new EventEmitter(), { isClosed: () => false, evaluate: async () => 1 });
const buildClient = overrides => Object.assign(new EventEmitter(), { pupPage: buildPage(), getState: async () => 'CONNECTED', destroy: async () => {} }, overrides);

let server;
beforeAll(() => {
  server = app.listen(TEST_PORT);
});

afterEach(() => {
  sessions.clear();
  for (const entry of fs.readdirSync(SESSIONS_PATH)) {
    if (entry.startsWith('session-')) {
      fs.rmSync(`${SESSIONS_PATH}/${entry}`, { recursive: true, force: true });
    }
  }
});

afterAll(() => {
  server.close();
  fs.rmSync(SESSIONS_PATH, { recursive: true, force: true });
});

describe('page crash recovery', () => {
  it('restarts the session once when the page emits both error and close', async () => {
    const id = 'crash';
    let destroyed = 0;
    const client = buildClient({
      destroy: async () => {
        destroyed++;
        await sleep(50);
      },
    });
    sessions.set(id, client);
    initializeEvents(client, id);
    // the restart listeners are attached in a .then, one microtask after the synchronous pupPage check
    await new Promise(resolve => setImmediate(resolve));

    client.pupPage.emit('error', new Error('Page crashed!'));
    client.pupPage.emit('close');
    await sleep(300);

    expect(destroyed).toBe(1);
    expect(client.pupPage.listenerCount('close')).toBe(0);
    expect(client.pupPage.listenerCount('error')).toBe(0);
    expect(sessions.get(id)).not.toBe(client);
  });
});

describe('deleteSession', () => {
  it('drops the session even when logout fails, so the id is not wedged', async () => {
    const id = 'wedged';
    const client = buildClient({
      logout: async () => {
        throw new Error('Protocol error: Target closed');
      },
      pupBrowser: { isConnected: () => false },
    });
    sessions.set(id, client);
    fs.mkdirSync(sessionFolder(id), { recursive: true });

    const response = await get(`terminate/${id}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(sessions.has(id)).toBe(false);
    expect(fs.existsSync(sessionFolder(id))).toBe(false);

    // before the fix this stayed pinned at session_not_ready and /start answered "already exists"
    const status = await get(`status/${id}`);
    expect(status.body.message).toBe('session_not_found');
  });
});

describe('flushing sessions that only exist on disk', () => {
  it('terminateInactive keeps a stopped session, terminateAll removes it', async () => {
    const id = 'ondisk';
    fs.mkdirSync(sessionFolder(id), { recursive: true });

    const inactive = await get('terminateInactive');
    expect(inactive.status).toBe(200);
    // stopped sessions keep their credentials: that is the promise /session/stop makes
    expect(fs.existsSync(sessionFolder(id))).toBe(true);

    const all = await get('terminateAll');
    expect(all.status).toBe(200);
    expect(fs.existsSync(sessionFolder(id))).toBe(false);
  });
});

describe('reloadSession', () => {
  it('waits for the old browser to disconnect before launching the new one', async () => {
    const id = 'reload';
    let polls = 0;
    const client = buildClient({
      pupBrowser: {
        pages: async () => [],
        close: async () => {},
        isConnected: () => ++polls < 3,
        process: () => null,
      },
    });
    sessions.set(id, client);

    await reloadSession(id);

    // the buggy code never consulted isConnected at all
    expect(polls).toBeGreaterThanOrEqual(3);
    expect(sessions.get(id)).not.toBe(client);
  }, 10000);
});
