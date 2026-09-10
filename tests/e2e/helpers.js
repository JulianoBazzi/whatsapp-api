import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';

// Never a julibazzi/* tag: this image is rebuilt from the working tree on every run
export const IMAGE = 'whatsapp-api:e2e';
export const LABEL = 'whatsapp-api.e2e=1';

// Native (arm64 on Apple Silicon) by default. E2E_PLATFORM=linux/amd64 builds what actually ships,
// through Rosetta — minutes instead of seconds, and the emulated Chromium may not come up.
export const PLATFORM = process.env.E2E_PLATFORM || null;
export const PLATFORM_ARGS = PLATFORM ? ['--platform', PLATFORM] : [];

// Happy path: throws on a non-zero exit, returns trimmed stdout
export const docker = (args, { timeout = 30000 } = {}) => execFileSync('docker', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout }).trim();

// For exit-code assertions: never throws
export const dockerResult = (args, { timeout = 30000 } = {}) => {
  const { status, stdout, stderr } = spawnSync('docker', args, { encoding: 'utf-8', timeout });
  return { status, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
};

// Runs a shell snippet inside a throwaway container of the image (entrypoint replaced by sh)
export const shInImage = (script, options) => dockerResult(['run', '--rm', ...PLATFORM_ARGS, '--entrypoint', 'sh', IMAGE, '-c', script], options);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Polls until the predicate returns something truthy; predicate errors are swallowed until the deadline
export const waitFor = async (predicate, { timeoutMs, intervalMs = 500, label = 'condition' }) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}${lastError ? ` (last error: ${lastError.message})` : ''}`);
};

export const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// Counted from the host through `docker top`: BusyBox has no `pgrep -c` and the image has no procps.
// The browser's root process is the `chromium` binary without `--type=` (renderer/gpu/utility children
// carry it); the two `chrome_crashpad_handler` processes it spawns are not browsers.
export const chromiumRoots = container => {
  const { status, stdout } = dockerResult(['top', container, '-eo', 'pid,args']);
  if (status !== 0) {
    return 0;
  }
  return stdout.split('\n').filter(line => line.includes('/chromium/chromium ') && !line.includes('--type=')).length;
};

export const createApi = (baseUrl, apiKey) => {
  const headers = auth => (auth ? { 'x-api-key': apiKey } : {});
  return {
    baseUrl,
    get: (path, { auth = true } = {}) => fetch(`${baseUrl}${path}`, { headers: headers(auth) }),
    post: (path, body = {}, { auth = true } = {}) =>
      fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers(auth) }, body: JSON.stringify(body) }),
  };
};
