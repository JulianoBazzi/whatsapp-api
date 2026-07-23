import http from 'node:http';
import { createRequire } from 'node:module';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

// Environment variables must be set before the app is imported (config reads them on import).
// Short values keep the suite fast while still exercising the timeout/backoff paths.
process.env.BASE_WEBHOOK_URL = 'http://localhost:3988/webhook';
process.env.WEBHOOK_TIMEOUT_MS = '300';
process.env.WEBHOOK_RETRIES = '2';
process.env.WEBHOOK_RETRY_DELAY_MS = '20';

const { triggerWebhook } = require('../src/utils');

const PORT = 3988;
const WEBHOOK_URL = `http://localhost:${PORT}/webhook`;

// Set by each test to decide how the receiver answers
let respond = res => res.writeHead(200).end();
let requestCount = 0;
const pendingResponses = [];

const server = http.createServer((_req, res) => {
  requestCount++;
  pendingResponses.push(res);
  respond(res);
});

await new Promise(resolve => server.listen(PORT, resolve));

beforeEach(() => {
  requestCount = 0;
  respond = res => res.writeHead(200).end();
});

afterAll(() => {
  // Release anything still hanging so the server can actually close
  for (const res of pendingResponses) {
    res.destroy();
  }
  server.close();
});

// triggerWebhook is fire-and-forget, so assertions have to wait for the background attempts
const waitForRequests = async (expected, maxWaitMs = 3000) => {
  const start = Date.now();
  while (requestCount < expected && Date.now() - start < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  // Give a late extra attempt a chance to show up, so "exactly N" assertions are meaningful
  await new Promise(resolve => setTimeout(resolve, 150));
  return requestCount;
};

describe('Webhook delivery', () => {
  it('should deliver a payload with the expected body', async () => {
    let received;
    respond = res => {
      res.writeHead(200).end();
    };
    server.once('request', req => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        received = JSON.parse(Buffer.concat(chunks).toString());
      });
    });

    triggerWebhook(WEBHOOK_URL, 'session-1', 'qr', { qr: 'abc' });
    await waitForRequests(1);

    expect(requestCount).toBe(1);
    expect(received).toEqual({ sessionId: 'session-1', dataType: 'qr', data: { qr: 'abc' } });
  });

  it('should retry on 5xx up to WEBHOOK_RETRIES times', async () => {
    respond = res => res.writeHead(500).end();

    triggerWebhook(WEBHOOK_URL, 'session-1', 'message', { text: 'hi' });
    const attempts = await waitForRequests(3);

    // 1 initial attempt + 2 retries
    expect(attempts).toBe(3);
  });

  it('should stop retrying as soon as an attempt succeeds', async () => {
    respond = res => {
      // Fail only the first attempt
      res.writeHead(requestCount === 1 ? 500 : 200).end();
    };

    triggerWebhook(WEBHOOK_URL, 'session-1', 'message', { text: 'hi' });
    const attempts = await waitForRequests(2);

    expect(attempts).toBe(2);
  });

  it('should not retry on 4xx, since the payload was rejected', async () => {
    respond = res => res.writeHead(400).end();

    triggerWebhook(WEBHOOK_URL, 'session-1', 'message', { text: 'hi' });
    const attempts = await waitForRequests(1);

    expect(attempts).toBe(1);
  });

  it('should time out and retry when the receiver never answers', async () => {
    // Never call res.end(): without a timeout this request would hang forever
    respond = () => {};

    const startedAt = Date.now();
    triggerWebhook(WEBHOOK_URL, 'session-1', 'message', { text: 'hi' });
    const attempts = await waitForRequests(3, 5000);
    const elapsedMs = Date.now() - startedAt;

    expect(attempts).toBe(3);
    // The 3rd request only goes out after two 300ms timeouts and their backoffs (~620ms),
    // proving each attempt was cut short by the timeout instead of hanging forever
    expect(elapsedMs).toBeGreaterThanOrEqual(600);
    expect(elapsedMs).toBeLessThan(5000);
  });
});
