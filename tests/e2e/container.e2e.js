import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromiumRoots, createApi, docker, dockerResult, freePort, IMAGE, LABEL, PLATFORM_ARGS, waitFor } from './helpers.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const API_KEY = 'e2e_api_key';
const SESSION = 'e2e';

// One long-lived container for the whole file: the tests below are ordered and share it
let name;
let sessionsDir;
let api;
let stopped = false;

const sessionFolder = () => path.join(sessionsDir, `session-${SESSION}`);
const status = async () => (await api.get(`/session/status/${SESSION}`)).json();
const waitForStatus = (message, timeoutMs = 60000) => waitFor(async () => (await status()).message === message, { timeoutMs, label: `status ${message}` });
const waitForRoots = (count, timeoutMs = 20000) => waitFor(() => chromiumRoots(name) === count, { timeoutMs, intervalMs: 1000, label: `${count} chromium root process(es)` });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

beforeAll(async () => {
  // realpath: on macOS os.tmpdir() lives under /var, which is a symlink to /private/var
  sessionsDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-api-e2e-')));
  const port = await freePort();
  name = `whatsapp-api-e2e-${process.pid}-${Date.now()}`;

  // No --rm (logs and exit code are read after docker stop) and no --init: the production compose
  // has none, so the SIGTERM path has to work without it. The webhook points at the container's own
  // /localCallbackExample, so the qr event lands in message_log.txt on the bind mount.
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--label',
    LABEL,
    ...PLATFORM_ARGS,
    '-p',
    `127.0.0.1:${port}:3000`,
    '-v',
    `${sessionsDir}:/usr/src/app/sessions`,
    '-e',
    `API_KEY=${API_KEY}`,
    '-e',
    'BASE_WEBHOOK_URL=http://127.0.0.1:3000/localCallbackExample',
    '-e',
    'ENABLE_LOCAL_CALLBACK_EXAMPLE=TRUE',
    '-e',
    'LOG_LEVEL=debug',
    '-e',
    'RECOVER_SESSIONS=TRUE',
    '-e',
    'DISABLED_CALLBACKS=message_ack|message_reaction|unread_count',
    IMAGE,
  ]);

  api = createApi(`http://127.0.0.1:${port}`, API_KEY);
  await waitFor(() => api.get('/ping', { auth: false }).then(response => response.ok), { timeoutMs: 30000, label: '/ping' });
});

afterAll(() => {
  if (name && (process.env.E2E_LOGS === '1' || !stopped)) {
    const { stdout } = dockerResult(['logs', '--tail', '200', name]);
    if (process.env.E2E_LOGS === '1') {
      console.error(stdout);
    }
  }
  try {
    if (name) {
      dockerResult(['rm', '-f', name]);
    }
  } finally {
    if (sessionsDir) {
      fs.rmSync(sessionsDir, { recursive: true, force: true });
    }
  }
});

describe('HTTP contract', () => {
  it('serves /ping without a key', async () => {
    const response = await api.get('/ping', { auth: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'pong' });
  });

  it('serves the landing page with the version', async () => {
    const response = await api.get('/', { auth: false });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/html/);
    expect(await response.text()).toContain(pkg.version);
  });

  it('refuses session routes without or with a wrong key', async () => {
    const missing = await api.get('/session/getSessions', { auth: false });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ success: false, error: 'Invalid API key' });

    const wrongKey = await fetch(`${api.baseUrl}/session/status/${SESSION}`, { headers: { 'x-api-key': 'not-the-key' } });
    expect(wrongKey.status).toBe(403);
    expect(await wrongKey.json()).toEqual({ success: false, error: 'Invalid API key' });
  });
});

describe('session up to the QR stage', () => {
  it('reports session_not_ready while the browser launches, then session_not_connected', async () => {
    // startSession answers only once pupPage exists, so session_not_ready is only visible while the
    // POST is in flight: fire it without awaiting and probe /status meanwhile
    const starting = api.post(`/session/start/${SESSION}`);
    let settled = false;
    starting.finally(() => {
      settled = true;
    });
    const seen = new Set();
    while (!settled) {
      seen.add((await status()).message);
      await sleep(50);
    }
    expect(seen.has('session_not_ready')).toBe(true);

    const response = await starting;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'Session initiated successfully' });

    await waitFor(() => fs.existsSync(sessionFolder()), { timeoutMs: 15000, label: 'session folder on the bind mount' });
    await waitForStatus('session_not_connected');
    expect(chromiumRoots(name)).toBe(1);
  }, 90000);

  it('serves the QR code as text and as PNG', async () => {
    const qr = await waitFor(
      async () => {
        const body = await (await api.get(`/session/qr/${SESSION}`)).json();
        return body.success ? body.qr : null;
      },
      { timeoutMs: 60000, label: 'qr code' },
    );
    expect(typeof qr).toBe('string');
    expect(qr.length).toBeGreaterThan(20);

    const image = await api.get(`/session/qr/${SESSION}/image`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 90000);

  it('delivers the qr webhook into the mounted volume', async () => {
    const log = path.join(sessionsDir, 'message_log.txt');
    await waitFor(
      () => {
        if (!fs.existsSync(log)) {
          return false;
        }
        const content = fs.readFileSync(log, 'utf-8');
        return content.includes('"dataType":"qr"') && content.includes(`"sessionId":"${SESSION}"`);
      },
      { timeoutMs: 30000, label: 'qr webhook in message_log.txt' },
    );
  });
});

describe('restart', () => {
  it('replaces the browser with exactly one new one and comes back to the QR stage', async () => {
    const response = await api.get(`/session/restart/${SESSION}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'Restarted successfully' });

    // the old browser must be gone before the new one appears; then hold, to catch a late second launch
    await waitForRoots(1, 30000);
    await sleep(3000);
    expect(chromiumRoots(name)).toBe(1);

    await waitForStatus('session_not_connected');
    await waitFor(async () => (await (await api.get(`/session/qr/${SESSION}`)).json()).success, { timeoutMs: 60000, label: 'a fresh qr code' });
  }, 120000);
});

describe('stop and terminateAll', () => {
  it('stop keeps the credentials on disk and leaves no browser behind', async () => {
    const response = await api.get(`/session/stop/${SESSION}`);
    expect(await response.json()).toEqual({ success: true, message: 'Session stopped successfully' });

    expect((await status()).message).toBe('session_not_found');
    expect(fs.existsSync(sessionFolder())).toBe(true);
    await waitForRoots(0, 20000);
  });

  it('terminateAll removes the stopped session from the volume', async () => {
    const response = await api.get('/session/terminateAll');
    expect(await response.json()).toEqual({ success: true, message: 'Flush completed successfully' });

    await waitFor(() => !fs.existsSync(sessionFolder()), { timeoutMs: 15000, label: 'session folder removed from the bind mount' });
    expect(chromiumRoots(name)).toBe(0);
    expect(await (await api.get('/session/getSessions')).json()).toEqual({ success: true, result: [] });
  });
});

describe('healthcheck', () => {
  // Late on purpose: without start-interval the first probe runs after `interval` (30 s), so this
  // exercises the Dockerfile HEALTHCHECK with the timings that ship, no --health-* override.
  it('reaches healthy with the shipped timings', async () => {
    const health = await waitFor(
      () => {
        const parsed = JSON.parse(docker(['inspect', '--format', '{{json .State.Health}}', name]));
        return parsed?.Status === 'healthy' ? parsed : null;
      },
      { timeoutMs: 100000, intervalMs: 2000, label: 'healthy' },
    );
    expect(health.FailingStreak).toBe(0);
    expect(health.Log.at(-1).ExitCode).toBe(0);
  }, 120000);
});

describe('shutdown', () => {
  it('docker stop finishes inside the grace period with exit code 0', async () => {
    // a live browser first, so shutdownSessions has real work to do
    await api.post(`/session/start/${SESSION}`);
    await waitForStatus('session_not_connected');
    expect(chromiumRoots(name)).toBe(1);

    const started = Date.now();
    docker(['stop', name], { timeout: 30000 });
    const elapsed = Date.now() - started;
    stopped = true;

    // 137 would mean SIGKILL after the 10 s default grace period
    expect(elapsed).toBeLessThan(10000);
    expect(docker(['inspect', '--format', '{{.State.Status}}', name])).toBe('exited');
    expect(docker(['inspect', '--format', '{{.State.ExitCode}}', name])).toBe('0');
    const logs = dockerResult(['logs', name]);
    expect(`${logs.stdout}\n${logs.stderr}`).toContain('Received SIGTERM, shutting down');
  }, 120000);
});
