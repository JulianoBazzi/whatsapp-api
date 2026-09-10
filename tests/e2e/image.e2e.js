import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { docker, dockerResult, IMAGE, PLATFORM_ARGS, shInImage } from './helpers.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

describe('image contents', () => {
  it('carries no dotenv file', () => {
    // grep exits 1 on a zero count, so the assertion is on the count itself
    expect(shInImage('ls -A /usr/src/app | grep -c "^\\.env"').stdout).toBe('0');
  });

  it('did not download a puppeteer browser', () => {
    // the distro chromium is what runs; the old PUPPETEER_SKIP_CHROMIUM_DOWNLOAD name let this cache appear
    expect(shInImage('test ! -e /root/.cache/puppeteer').status).toBe(0);
  });

  it('carries no test files or vitest configs', () => {
    expect(shInImage('test ! -e /usr/src/app/tests && ls /usr/src/app | grep -c vitest').stdout).toBe('0');
  });

  it('reports the same version as the host package.json', () => {
    const result = dockerResult(['run', '--rm', ...PLATFORM_ARGS, '--entrypoint', 'node', IMAGE, '-p', "require('/usr/src/app/package.json').version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(pkg.version);
  });

  it('has a working chromium at $CHROME_BIN', () => {
    // $CHROME_BIN expands from the image ENV; --version also proves the binary loads on this arch
    const result = shInImage('test -x "$CHROME_BIN" && "$CHROME_BIN" --version');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Chromium \d+/);
  });

  it('does not ship git', () => {
    expect(shInImage('command -v git').status).not.toBe(0);
  });

  it('leaves no package-manager store or cache behind', () => {
    // pnpm install parks a full copy of the packages in /root/.local/share/pnpm (~100 MB) and corepack
    // caches node/pnpm in /root/.cache; both are dead weight once node_modules is linked
    expect(shInImage('test ! -e /root/.local/share/pnpm && test ! -e /root/.cache && test ! -e /root/.npm').status).toBe(0);
  });

  it('stays well under the size of the bloated beta image', () => {
    const bytes = Number(docker(['image', 'inspect', '--format', '{{.Size}}', IMAGE]));
    // Uncompressed: the apk layer alone (chromium + ffmpeg and their codec/mesa deps) is ~770 MB on
    // arm64, node_modules ~110 MB. The 7-week-old local beta weighed 2.11 GB — a stray Chrome
    // download plus .pnpm-store copied into the context — and that is the regression this catches.
    expect(bytes).toBeLessThan(1_200_000_000);
  });
});

describe('boot contract', () => {
  // docker run propagates the container exit code; pino writes JSON to stdout
  it('exits with code 1 without API_KEY', () => {
    const result = dockerResult(['run', '--rm', ...PLATFORM_ARGS, '-e', 'BASE_WEBHOOK_URL=http://127.0.0.1:3000/localCallbackExample', IMAGE]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('API_KEY environment variable is not available');
  });

  it('exits with code 1 with an invalid BASE_WEBHOOK_URL', () => {
    const result = dockerResult(['run', '--rm', ...PLATFORM_ARGS, '-e', 'API_KEY=e2e', '-e', 'BASE_WEBHOOK_URL=not-a-url', IMAGE]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('BASE_WEBHOOK_URL is not a valid URL');
  });
});

describe('docker-compose.yml parity', () => {
  it('loads and points at the image for this version', () => {
    const config = JSON.parse(docker(['compose', '-f', 'docker-compose.yml', 'config', '--format', 'json']));
    expect(config.services.app.image).toBe(`julibazzi/whatsapp-api:${pkg.version}`);
    expect(config.services.app.volumes[0].target).toBe('/usr/src/app/sessions');
  });

  it('only documents variables that .env.example knows', () => {
    // the raw file, not `compose config`: commented-out examples are exactly where a typo hides
    const compose = fs.readFileSync('docker-compose.yml', 'utf-8');
    const composeKeys = [...compose.matchAll(/^\s*#?\s*- ([A-Z0-9_]+)=/gm)].map(match => match[1]);
    const exampleKeys = new Set([...fs.readFileSync('.env.example', 'utf-8').matchAll(/^([A-Z0-9_]+)=/gm)].map(match => match[1]));

    expect(composeKeys.length).toBeGreaterThan(10);
    expect(composeKeys.filter(key => !exampleKeys.has(key))).toEqual([]);
  });
});
