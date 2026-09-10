import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { docker, dockerResult, IMAGE, LABEL, PLATFORM_ARGS } from './helpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Runs once per `pnpm test:e2e`: fail fast without a daemon, sweep containers a previous run left
// behind (Ctrl-C in the middle of a wait skips afterAll), then build the image from the working tree.
export default async function setup() {
  try {
    docker(['version', '--format', '{{.Server.Os}}/{{.Server.Arch}}']);
  } catch {
    throw new Error('Docker daemon not reachable (is OrbStack running?)');
  }

  const leftovers = docker(['ps', '-aq', '--filter', `label=${LABEL}`]);
  if (leftovers) {
    dockerResult(['rm', '-f', ...leftovers.split('\n')]);
  }

  const imageExists = dockerResult(['image', 'inspect', IMAGE]).status === 0;
  if (process.env.E2E_SKIP_BUILD === '1' && imageExists) {
    return;
  }
  // Layers are cached between runs: a rebuild after a code change takes seconds, the apk chromium
  // layer only on the first run.
  execFileSync('docker', ['build', ...PLATFORM_ARGS, '-t', IMAGE, '.'], { cwd: repoRoot, stdio: 'inherit', timeout: 600000 });
}
