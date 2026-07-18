import fs from 'node:fs';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

// Environment variables must be set before the app is imported
process.env.API_KEY = 'test_api_key';
process.env.SESSIONS_PATH = './sessions_test';
process.env.BASE_WEBHOOK_URL = 'http://localhost:3987/localCallbackExample';
process.env.RATE_LIMIT_MAX = '2';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

const app = (await import('../src/app')).default;

afterAll(() => {
  fs.rmSync('./sessions_test', { recursive: true, force: true });
});

describe('API Rate Limiting', () => {
  it('should return 429 after RATE_LIMIT_MAX requests within the window', async () => {
    const response1 = await request(app).get('/session/status/ratelimit').set('x-api-key', 'test_api_key');
    expect(response1.status).toBe(200);

    const response2 = await request(app).get('/session/status/ratelimit').set('x-api-key', 'test_api_key');
    expect(response2.status).toBe(200);

    const response3 = await request(app).get('/session/status/ratelimit').set('x-api-key', 'test_api_key');
    expect(response3.status).toBe(429);
    expect(response3.text).toContain("You can't make any more requests at the moment");
  });
});
