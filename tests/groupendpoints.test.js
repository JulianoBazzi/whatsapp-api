import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const TEST_PORT = 3991;

// Environment variables must be set before the modules are imported
process.env.API_KEY = 'test_api_key';
process.env.SESSIONS_PATH = './sessions_test_group';
process.env.BASE_WEBHOOK_URL = `http://localhost:${TEST_PORT}/localCallbackExample`;

const app = (await import('../src/app')).default;
const { sessions } = require('../src/sessions');

const SESSION_ID = 'grouptest';
const GROUP_ID = '120363429297795584@g.us';

// No Chromium: sessionValidation only needs an evaluable pupPage and a CONNECTED state
const buildClient = chat => {
  const client = new EventEmitter();
  client.pupPage = { isClosed: () => false, evaluate: async () => 1 };
  client.getState = async () => 'CONNECTED';
  client.getChatById = async () => chat;
  return client;
};

const post = (route, body = {}) => request(app).post(`/groupChat/${route}/${SESSION_ID}`).set('x-api-key', 'test_api_key').send(body);

let server;
beforeAll(() => {
  server = app.listen(TEST_PORT);
});

afterEach(() => {
  sessions.delete(SESSION_ID);
});

afterAll(() => {
  server.close();
  fs.rmSync('./sessions_test_group', { recursive: true, force: true });
});

describe('removeParticipants guard', () => {
  it('removes the participants and answers with the roster', async () => {
    let asked = null;
    sessions.set(
      SESSION_ID,
      buildClient({
        isGroup: true,
        participants: [{ id: { _serialized: '5511936199574@c.us' } }],
        removeParticipants: async ids => {
          asked = ids;
          return { status: 200 };
        },
      }),
    );

    const response = await post('removeParticipants', { chatId: GROUP_ID, contactIds: ['5566981320040@c.us'] });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(asked).toEqual(['5566981320040@c.us']);
  });

  it.each([
    ['missing', undefined],
    ['empty', []],
    ['not an array', '5566981320040@c.us'],
  ])('refuses a %s contactIds with 422 before touching the chat', async (_label, contactIds) => {
    let called = false;
    sessions.set(
      SESSION_ID,
      buildClient({
        isGroup: true,
        participants: [],
        removeParticipants: async () => {
          called = true;
        },
      }),
    );

    const response = await post('removeParticipants', { chatId: GROUP_ID, contactIds });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'contactIds is required and must be a non-empty array' });
    expect(called).toBe(false);
  });

  it('translates the protobuf complaint into a 422 naming the real problem', async () => {
    // wwebjs resolves each id against the roster and passes the survivors on; a number that was only
    // invited and never joined resolves to nothing, and WhatsApp Web rejects the empty list like this
    sessions.set(
      SESSION_ID,
      buildClient({
        isGroup: true,
        participants: [],
        removeParticipants: async () => {
          throw new Error('expected at least 1 children, but found 0');
        },
      }),
    );

    const response = await post('removeParticipants', { chatId: GROUP_ID, contactIds: ['5566981320040@c.us'] });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'None of the given contactIds is a participant of this group' });
  });

  it('still reports an unrelated failure as a 500', async () => {
    sessions.set(
      SESSION_ID,
      buildClient({
        isGroup: true,
        participants: [],
        removeParticipants: async () => {
          throw new Error('Evaluation failed: not authorized');
        },
      }),
    );

    const response = await post('removeParticipants', { chatId: GROUP_ID, contactIds: ['5566981320040@c.us'] });

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });
});
