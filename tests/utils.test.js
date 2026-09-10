import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';

// Environment variables must be set before the modules are imported
process.env.API_KEY = 'test_api_key';
process.env.BASE_WEBHOOK_URL = 'http://localhost:3987/localCallbackExample';

const { phoneToChatId, isEventEnabled, sendErrorResponse, waitForNestedObject, triggerWebhook, toContactId, createLimiter } = await import('../src/utils');

const projectRoot = process.cwd(); // vitest runs from the project root

// Starts a local HTTP server on an ephemeral port that records the requests it receives
const startWebhookServer = () =>
  new Promise(resolve => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        requests.push({ headers: req.headers, body: JSON.parse(body) });
        res.end('ok');
      });
    });
    server.listen(0, () => resolve({ server, port: server.address().port, requests }));
  });

describe('phoneToChatId', () => {
  it('should normalize a brazilian mobile number', () => {
    expect(phoneToChatId('11999998888')).toBe('5511999998888@c.us');
  });

  it('should normalize a formatted phone number', () => {
    expect(phoneToChatId('(11) 99999-8888')).toBe('5511999998888@c.us');
  });

  it('should keep numbers that already have the country code', () => {
    expect(phoneToChatId('5511999998888')).toBe('5511999998888@c.us');
  });

  it('should normalize a landline number', () => {
    expect(phoneToChatId('1133334444')).toBe('551133334444@c.us');
  });

  it('should return null for an invalid phone number', () => {
    expect(phoneToChatId('123')).toBeNull();
  });

  it('should return null for empty values', () => {
    expect(phoneToChatId('')).toBeNull();
    expect(phoneToChatId(null)).toBeNull();
    expect(phoneToChatId(undefined)).toBeNull();
  });

  it('should return null for non-brazilian international numbers', () => {
    expect(phoneToChatId('6281288888888')).toBeNull();
  });
});

describe('sendMessage chatId normalization (passthrough)', () => {
  // Mirrors clientController sendMessage: BR normalizes, intl digits pass through
  const normalizeChatId = chatId => (chatId && !String(chatId).includes('@') && phoneToChatId(chatId)) || chatId;

  it('should normalize brazilian numbers without @', () => {
    expect(normalizeChatId('11999998888')).toBe('5511999998888@c.us');
  });

  it('should pass through international numbers without @', () => {
    expect(normalizeChatId('6281288888888')).toBe('6281288888888');
  });

  it('should pass through already-qualified chat ids', () => {
    expect(normalizeChatId('5511999998888@c.us')).toBe('5511999998888@c.us');
    expect(normalizeChatId('6281288888888@c.us')).toBe('6281288888888@c.us');
  });
});

describe('toContactId', () => {
  it('should keep @c.us and @lid ids', () => {
    expect(toContactId('5511999998888@c.us')).toBe('5511999998888@c.us');
    expect(toContactId('141716858364058@lid')).toBe('141716858364058@lid');
  });

  it('should append @c.us to bare digits', () => {
    expect(toContactId('5511999998888')).toBe('5511999998888@c.us');
  });

  it('should return null for empty values', () => {
    expect(toContactId('')).toBeNull();
    expect(toContactId(null)).toBeNull();
  });
});

describe('isEventEnabled', () => {
  it('should return true when the event is not disabled', () => {
    expect(isEventEnabled('message')).toBe(true);
  });

  it('should return false for events listed in DISABLED_CALLBACKS', () => {
    // config reads the environment at import time, so evaluate in a fresh node process
    const script =
      "const { isEventEnabled } = require('./src/utils'); console.log(JSON.stringify([isEventEnabled('message_ack'), isEventEnabled('unread_count'), isEventEnabled('message')]))";
    const output = execFileSync('node', ['-e', script], {
      cwd: projectRoot,
      env: { ...process.env, DISABLED_CALLBACKS: 'message_ack|unread_count' },
    })
      .toString()
      .trim();
    expect(JSON.parse(output)).toEqual([false, false, true]);
  });
});

describe('sendErrorResponse', () => {
  it('should send the error status and payload', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    sendErrorResponse(res, 404, 'some_error');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'some_error' });
  });
});

describe('waitForNestedObject', () => {
  it('should resolve when the nested property appears', async () => {
    const rootObj = {};
    setTimeout(() => {
      rootObj.pupPage = { ready: true };
    }, 100);
    await expect(waitForNestedObject(rootObj, 'pupPage', 1000, 20)).resolves.toBeUndefined();
  });

  it('should reject when the wait times out', async () => {
    await expect(waitForNestedObject({}, 'pupPage', 200, 50)).rejects.toThrow('Timeout waiting for nested object');
  });
});

describe('triggerWebhook', () => {
  it('should post the payload with the api key header', async () => {
    const { server, port, requests } = await startWebhookServer();
    try {
      triggerWebhook(`http://localhost:${port}/webhook`, 'session1', 'message', { body: 'Hello' });
      await waitForNestedObject(requests, '0', 3000, 20);
      expect(requests[0].body).toEqual({ dataType: 'message', data: { body: 'Hello' }, sessionId: 'session1' });
      expect(requests[0].headers['x-api-key']).toBe('test_api_key');
    } finally {
      server.close();
    }
  });

  it('should not throw when the webhook request fails', async () => {
    // port 1 is never listening, so the request is refused
    expect(() => triggerWebhook('http://localhost:1/webhook', 'session1', 'message')).not.toThrow();
    // let the rejection be handled by the internal catch
    await new Promise(resolve => setTimeout(resolve, 50));
  });
});

describe('createLimiter', () => {
  it('never runs more than max tasks at once and drains the queue in order', async () => {
    const limiter = createLimiter(2);
    let running = 0;
    let peak = 0;
    const finished = [];
    const task = name => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 20));
      running--;
      finished.push(name);
      return name;
    };

    const results = await Promise.all(['a', 'b', 'c', 'd'].map(name => limiter.run(task(name))));

    expect(peak).toBe(2);
    expect(results).toEqual(['a', 'b', 'c', 'd']);
    expect(finished).toEqual(['a', 'b', 'c', 'd']);
    expect(limiter.active).toBe(0);
    expect(limiter.pending).toBe(0);
  });

  it('keeps going after a task rejects', async () => {
    const limiter = createLimiter(1);

    await expect(
      limiter.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(limiter.run(async () => 'next')).resolves.toBe('next');
    expect(limiter.active).toBe(0);
  });
});
