import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

vi.mock('qrcode-terminal');

// Port for the webhook callbacks (an uncommon one, to avoid clashing with dev servers on 3000)
const TEST_PORT = 3987;

// Mock your application's environment variables (must be set before the app is imported)
process.env.API_KEY = 'test_api_key';
process.env.SESSIONS_PATH = './sessions_test';
process.env.ENABLE_LOCAL_CALLBACK_EXAMPLE = 'TRUE';
process.env.BASE_WEBHOOK_URL = `http://localhost:${TEST_PORT}/localCallbackExample`;

const app = (await import('../src/app')).default;
const { sessions } = require('../src/sessions');

let server;
beforeAll(() => {
  server = app.listen(TEST_PORT);
});

beforeEach(async () => {
  if (fs.existsSync('./sessions_test/message_log.txt')) {
    fs.writeFileSync('./sessions_test/message_log.txt', '');
  }
});

afterAll(() => {
  server.close();
  fs.rmSync('./sessions_test', { recursive: true, force: true });
});

// Define test cases
describe('API health checks', () => {
  it('should return the default HTML landing page', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toContain(pkg.version);
    expect(response.text).toContain('whatsapp-web.js');
    expect(response.text).toContain(pkg.dependencies['whatsapp-web.js']);
  });

  it('should return valid healthcheck', async () => {
    const response = await request(app).get('/ping');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'pong', success: true });
  });

  it('should return a valid callback', async () => {
    const response = await request(app).post('/localCallbackExample').set('x-api-key', 'test_api_key').send({ sessionId: '1', dataType: 'testDataType', data: 'testData' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    expect(fs.existsSync('./sessions_test/message_log.txt')).toBe(true);
    expect(fs.readFileSync('./sessions_test/message_log.txt', 'utf-8')).toEqual('{"sessionId":"1","dataType":"testDataType","data":"testData"}\r\n');
  });
});

describe('Boot requirements', () => {
  // server.js is never imported by the suite (it would listen and restore sessions), so the abort
  // behaviour is checked in a subprocess
  const bootWith = env =>
    spawnSync(process.execPath, ['server.js'], {
      env: { ...process.env, SESSIONS_PATH: './sessions_test', ...env },
      encoding: 'utf-8',
      timeout: 20000,
    });

  it('should refuse to boot without an API_KEY', () => {
    const result = bootWith({ API_KEY: '', BASE_WEBHOOK_URL: 'http://localhost:3987/localCallbackExample' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('API_KEY environment variable is not available');
  });

  it('should refuse to boot without a BASE_WEBHOOK_URL', () => {
    const result = bootWith({ API_KEY: 'test_api_key', BASE_WEBHOOK_URL: '' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('BASE_WEBHOOK_URL environment variable is not available');
  });
});

describe('API Authentication Tests', () => {
  it('should return 403 Forbidden for invalid API key', async () => {
    const response = await request(app).get('/session/start/1');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, error: 'Invalid API key' });
  });

  it('should return 403 when no API key is sent at all', async () => {
    const response = await request(app).post('/chat/markUnread/1').send({ chatId: '5511999998888@c.us' });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, error: 'Invalid API key' });
  });

  it('should fail invalid sessionId', async () => {
    const response = await request(app).get('/session/start/ABCD1@').set('x-api-key', 'test_api_key');
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'Session should be alphanumerical or -' });
  });

  it('should setup and terminate a client session', async () => {
    const response = await request(app).get('/session/start/1').set('x-api-key', 'test_api_key');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'Session initiated successfully' });
    expect(fs.existsSync('./sessions_test/session-1')).toBe(true);

    const response2 = await request(app).get('/session/terminate/1').set('x-api-key', 'test_api_key');
    expect(response2.status).toBe(200);
    expect(response2.body).toEqual({ success: true, message: 'Logged out successfully' });

    expect(fs.existsSync('./sessions_test/session-1')).toBe(false);
  }, 30000);

  it('should setup and flush multiple client sessions', async () => {
    const response = await request(app).get('/session/start/2').set('x-api-key', 'test_api_key');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'Session initiated successfully' });
    expect(fs.existsSync('./sessions_test/session-2')).toBe(true);

    const response2 = await request(app).get('/session/start/3').set('x-api-key', 'test_api_key');
    expect(response2.status).toBe(200);
    expect(response2.body).toEqual({ success: true, message: 'Session initiated successfully' });
    expect(fs.existsSync('./sessions_test/session-3')).toBe(true);

    const response3 = await request(app).get('/session/terminateInactive').set('x-api-key', 'test_api_key');
    expect(response3.status).toBe(200);
    expect(response3.body).toEqual({ success: true, message: 'Flush completed successfully' });

    expect(fs.existsSync('./sessions_test/session-2')).toBe(false);
    expect(fs.existsSync('./sessions_test/session-3')).toBe(false);
  }, 30000);
});

describe('API Session Validation Tests', () => {
  it('should return session_not_found status for an unknown session', async () => {
    const response = await request(app).get('/session/status/unknownsession').set('x-api-key', 'test_api_key');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: false, state: null, message: 'session_not_found' });
  });

  it('should return session_not_ready immediately when pupPage is missing', async () => {
    sessions.set('notready', {});
    const startedAt = Date.now();
    const response = await request(app).get('/session/status/notready').set('x-api-key', 'test_api_key');
    const elapsedMs = Date.now() - startedAt;
    sessions.delete('notready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: false, state: null, message: 'session_not_ready' });
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('should return 404 when sending a message to an unknown session', async () => {
    const response = await request(app)
      .post('/client/sendMessage/unknownsession')
      .set('x-api-key', 'test_api_key')
      .send({ chatId: '5511999998888@c.us', contentType: 'string', content: 'Hello' });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: 'session_not_found' });
  });

  // The routes ported from wwebjs-api all sit behind sessionValidation, so an unknown session must
  // be rejected before any of them touches the client
  it.each([
    ['/groupChat/getGroupMembershipRequests/unknownsession'],
    ['/groupChat/approveGroupMembershipRequests/unknownsession'],
    ['/groupChat/rejectGroupMembershipRequests/unknownsession'],
    ['/chat/markUnread/unknownsession'],
    ['/chat/sendSeen/unknownsession'],
    ['/chat/getLabels/unknownsession'],
    ['/chat/changeLabels/unknownsession'],
    ['/message/downloadMediaAsData/unknownsession'],
    ['/message/getContact/unknownsession'],
    ['/message/getGroupMentions/unknownsession'],
    ['/message/getReactions/unknownsession'],
    ['/message/getPollVotes/unknownsession'],
  ])('should return 404 on %s for an unknown session', async path => {
    const response = await request(app).post(path).set('x-api-key', 'test_api_key').send({ chatId: '5511999998888@g.us', messageId: 'ABC' });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: 'session_not_found' });
  });
});

describe('API Session Webhook Tests', () => {
  it('should fall back to BASE_WEBHOOK_URL when no override is set', async () => {
    const response = await request(app).get('/session/getWebhook/nooverride').set('x-api-key', 'test_api_key');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, webhookUrl: process.env.BASE_WEBHOOK_URL, source: 'env_global' });
  });

  it('should reject an invalid webhook URL', async () => {
    const response = await request(app).put('/session/setWebhook/badurl').set('x-api-key', 'test_api_key').send({ webhookUrl: 'not-a-url' });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'Invalid webhook URL: not-a-url' });
  });

  it('should set and clear a runtime webhook', async () => {
    const target = 'https://example.com/hook';

    const setResponse = await request(app).put('/session/setWebhook/runtimehook').set('x-api-key', 'test_api_key').send({ webhookUrl: target });
    expect(setResponse.status).toBe(200);
    expect(setResponse.body).toEqual({ success: true, message: 'Webhook updated', webhookUrl: target, source: 'runtime' });

    const getResponse = await request(app).get('/session/getWebhook/runtimehook').set('x-api-key', 'test_api_key');
    expect(getResponse.body).toEqual({ success: true, webhookUrl: target, source: 'runtime' });

    const clearResponse = await request(app).put('/session/setWebhook/runtimehook').set('x-api-key', 'test_api_key').send({ webhookUrl: '' });
    expect(clearResponse.status).toBe(200);
    expect(clearResponse.body).toEqual({ success: true, message: 'Webhook cleared', webhookUrl: process.env.BASE_WEBHOOK_URL, source: 'env_global' });
  });

  it('should reject an invalid webhook URL on start without leaving a session behind', async () => {
    const response = await request(app).post('/session/start/badstart').set('x-api-key', 'test_api_key').send({ webhookUrl: 'nope' });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'Invalid webhook URL: nope' });
    expect(sessions.has('badstart')).toBe(false);
  });
});

describe('API Session Management Tests', () => {
  it('should list active sessions, persist a webhook and stop without deleting credentials', async () => {
    const target = 'https://example.com/session-5';

    const listBefore = await request(app).get('/session/getSessions').set('x-api-key', 'test_api_key');
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.result).not.toContain('5');

    const startResponse = await request(app).post('/session/start/5').set('x-api-key', 'test_api_key').send({ webhookUrl: target });
    expect(startResponse.status).toBe(200);
    expect(startResponse.body).toEqual({ success: true, message: 'Session initiated successfully' });

    const listAfter = await request(app).get('/session/getSessions').set('x-api-key', 'test_api_key');
    expect(listAfter.body.result).toContain('5');

    // The override reached disk, so it survives a restart
    const configPath = './sessions_test/session-5/webhook_config.json';
    expect(fs.existsSync(configPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual({ webhookUrl: target });

    const stopResponse = await request(app).get('/session/stop/5').set('x-api-key', 'test_api_key');
    expect(stopResponse.status).toBe(200);
    expect(stopResponse.body).toEqual({ success: true, message: 'Session stopped successfully' });

    // Unlike terminate, stop keeps the credentials so the session can resume without a new QR code
    expect(fs.existsSync('./sessions_test/session-5')).toBe(true);

    const listAfterStop = await request(app).get('/session/getSessions').set('x-api-key', 'test_api_key');
    expect(listAfterStop.body.result).not.toContain('5');
  }, 30000);

  it('should return session_not_found when stopping an unknown session', async () => {
    const response = await request(app).get('/session/stop/unknownsession').set('x-api-key', 'test_api_key');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: false, message: 'session_not_found' });
  });

  it('should return session_not_found when requesting a pairing code for an unknown session', async () => {
    const response = await request(app).post('/session/requestPairingCode/unknownsession').set('x-api-key', 'test_api_key').send({ phoneNumber: '5551999998888' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: false, message: 'session_not_found' });
  });

  it('should require a phone number to request a pairing code', async () => {
    const response = await request(app).post('/session/requestPairingCode/unknownsession').set('x-api-key', 'test_api_key').send({});
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'phoneNumber is required' });
  });
});

describe('API Action Tests', () => {
  it('should setup, create at least a QR, and terminate a client session', async () => {
    const response = await request(app).get('/session/start/4').set('x-api-key', 'test_api_key');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'Session initiated successfully' });
    expect(fs.existsSync('./sessions_test/session-4')).toBe(true);

    // Wait for message_log.txt to not be empty
    const result = await waitForFileNotToBeEmpty('./sessions_test/message_log.txt')
      .then(() => {
        return true;
      })
      .catch(() => {
        return false;
      });
    expect(result).toBe(true);

    // Verify the message content
    const expectedMessage = {
      dataType: 'qr',
      data: expect.objectContaining({ qr: expect.any(String) }),
      sessionId: '4',
    };
    expect(JSON.parse(fs.readFileSync('./sessions_test/message_log.txt', 'utf-8'))).toEqual(expectedMessage);

    const response2 = await request(app).get('/session/terminate/4').set('x-api-key', 'test_api_key');
    expect(response2.status).toBe(200);
    expect(response2.body).toEqual({ success: true, message: 'Logged out successfully' });
    expect(fs.existsSync('./sessions_test/session-4')).toBe(false);
  }, 30000);
});

// Function to wait for a specific file to have content
const waitForFileNotToBeEmpty = (filePath, maxWaitTime = 10000, interval = 100) => {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const checkFile = () => {
      const filecontent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
      if (filecontent !== '') {
        // File has content, resolve the promise
        resolve();
      } else if (Date.now() - start > maxWaitTime) {
        // Maximum wait time exceeded, reject the promise
        reject(new Error('Timeout waiting for file content'));
      } else {
        // File still empty, continue waiting
        setTimeout(checkFile, interval);
      }
    };
    checkFile();
  });
};
