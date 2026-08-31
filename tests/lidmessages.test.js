import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const TEST_PORT = 3989;

process.env.API_KEY = 'test_api_key';
process.env.SESSIONS_PATH = './sessions_test_lid';
process.env.BASE_WEBHOOK_URL = `http://localhost:${TEST_PORT}/localCallbackExample`;

const app = (await import('../src/app')).default;
const { sessions } = require('../src/sessions');

const SESSION_ID = 'lidtest';
const CHAT_ID = '137348977299632@lid';
const MESSAGE_ID = '3EB0DECF2289260445BA11';

const buildClient = overrides => {
  const client = new EventEmitter();
  client.pupPage = { isClosed: () => false, evaluate: async () => 1 };
  client.getState = async () => 'CONNECTED';
  return Object.assign(client, overrides);
};

const buildMessage = (body, extra = {}) => ({
  id: { fromMe: true, remote: CHAT_ID, id: MESSAGE_ID },
  to: CHAT_ID,
  fromMe: true,
  body,
  ...extra,
});

let server;
beforeAll(() => {
  server = app.listen(TEST_PORT);
});

afterEach(() => {
  sessions.delete(SESSION_ID);
});

afterAll(() => {
  server.close();
  fs.rmSync('./sessions_test_lid', { recursive: true, force: true });
});

describe('sendMessage on LID chats', () => {
  it('recovers the sent message from message_create when the client returns nothing', async () => {
    const client = buildClient({
      sendMessage: async (chatId, content) => {
        setImmediate(() => client.emit('message_create', buildMessage(content)));
        return undefined;
      },
    });
    sessions.set(SESSION_ID, client);

    const response = await request(app)
      .post(`/client/sendMessage/${SESSION_ID}`)
      .set('x-api-key', 'test_api_key')
      .send({ chatId: CHAT_ID, contentType: 'string', content: 'pedido recebido' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message.id.id).toBe(MESSAGE_ID);
    expect(client.listenerCount('message_create')).toBe(0);
  });

  it('ignores messages from other chats while waiting for its own', async () => {
    const client = buildClient({
      sendMessage: async (chatId, content) => {
        setImmediate(() => {
          client.emit('message_create', { id: { fromMe: true, remote: 'other@lid', id: 'OTHER' }, to: 'other@lid', body: content });
          client.emit('message_create', buildMessage('outro texto'));
          client.emit('message_create', buildMessage(content));
        });
        return undefined;
      },
    });
    sessions.set(SESSION_ID, client);

    const response = await request(app)
      .post(`/client/sendMessage/${SESSION_ID}`)
      .set('x-api-key', 'test_api_key')
      .send({ chatId: CHAT_ID, contentType: 'string', content: 'pedido recebido' });

    expect(response.status).toBe(200);
    expect(response.body.message.id.id).toBe(MESSAGE_ID);
  });

  it('keeps returning the message the client resolves, without waiting for the event', async () => {
    const client = buildClient({
      sendMessage: async (chatId, content) => buildMessage(content, { id: { fromMe: true, remote: CHAT_ID, id: 'DIRECT' } }),
    });
    sessions.set(SESSION_ID, client);

    const response = await request(app)
      .post(`/client/sendMessage/${SESSION_ID}`)
      .set('x-api-key', 'test_api_key')
      .send({ chatId: CHAT_ID, contentType: 'string', content: 'pedido recebido' });

    expect(response.status).toBe(200);
    expect(response.body.message.id.id).toBe('DIRECT');
    expect(client.listenerCount('message_create')).toBe(0);
  });
});

describe('message lookup on LID chats', () => {
  it('reacts using the serialized id when getChatById is unavailable', async () => {
    let reacted = null;
    const client = buildClient({
      getMessageById: async serializedId => {
        if (serializedId !== `true_${CHAT_ID}_${MESSAGE_ID}_out`) {
          return null;
        }
        return {
          ...buildMessage('pedido recebido'),
          react: async reaction => {
            reacted = reaction;
            return { ok: true };
          },
        };
      },
      getChatById: async () => {
        throw new Error('r');
      },
    });
    sessions.set(SESSION_ID, client);

    const response = await request(app).post(`/message/react/${SESSION_ID}`).set('x-api-key', 'test_api_key').send({ chatId: CHAT_ID, messageId: MESSAGE_ID, reaction: '👍' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(reacted).toBe('👍');
  });

  it('falls back to the chat scan when the serialized lookup finds nothing', async () => {
    const client = buildClient({
      getMessageById: async () => null,
      getChatById: async () => ({
        fetchMessages: async () => [{ ...buildMessage('pedido recebido'), react: async () => ({ ok: true }) }],
      }),
    });
    sessions.set(SESSION_ID, client);

    const response = await request(app).post(`/message/react/${SESSION_ID}`).set('x-api-key', 'test_api_key').send({ chatId: CHAT_ID, messageId: MESSAGE_ID, reaction: '👍' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('answers Message not Found when neither lookup resolves', async () => {
    const client = buildClient({
      getMessageById: async () => {
        throw new Error('Invalid serialized message id specified');
      },
      getChatById: async () => {
        throw new Error('r');
      },
    });
    sessions.set(SESSION_ID, client);

    const response = await request(app).post(`/message/react/${SESSION_ID}`).set('x-api-key', 'test_api_key').send({ chatId: CHAT_ID, messageId: MESSAGE_ID, reaction: '👍' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'Message not Found' });
  });
});
