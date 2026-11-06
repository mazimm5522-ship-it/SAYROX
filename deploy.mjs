import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectName = 'SAYROX-19.11.13';
const projectDir = path.join(root, projectName);
const archivePath = path.join(root, `${projectName}-WORKER.zip`);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function safeProjectPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '..')) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  const target = path.resolve(projectDir, normalized);
  if (target !== projectDir && !target.startsWith(`${projectDir}${path.sep}`)) {
    throw new Error(`Archive path escapes project root: ${relativePath}`);
  }
  return target;
}

function extractProject() {
  if (!existsSync(archivePath)) throw new Error(`Missing ${path.basename(archivePath)} at repository root.`);
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
  const entries = unzipSync(new Uint8Array(readFileSync(archivePath)));
  let written = 0;
  for (const [archiveName, bytes] of Object.entries(entries)) {
    const name = archiveName.replaceAll('\\', '/');
    if (!name.startsWith(`${projectName}/`) || name.endsWith('/')) continue;
    const relative = name.slice(projectName.length + 1);
    const target = safeProjectPath(relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    written++;
  }
  for (const required of ['package.json', 'wrangler.jsonc', 'site/index.html', 'site/_worker.js', 'auth-worker/wrangler.jsonc', 'billing-worker/wrangler.jsonc', 'usage-worker/wrangler.jsonc', 'tasks-worker/wrangler.jsonc']) {
    if (!existsSync(path.join(projectDir, required))) throw new Error(`Required project file is missing after extraction: ${required}`);
  }
  console.log(`Extracted ${written} project files safely.`);
}

function runNpm(args, label) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(npmCommand, args, {
    cwd: projectDir,
    env: process.env,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
}

function build() {
  extractProject();
  runNpm(['install', '--no-audit', '--no-fund'], 'Install SAYROX dependencies');
  runNpm(['test'], 'Run all SAYROX project tests');
  runNpm(['run', 'build'], 'Build app, Worker and same-origin voice SDK');
  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) {
    throw new Error('Voice SDK bundle was not generated; refusing deployment.');
  }
  console.log('\nSAYROX build complete. Voice SDK bundle is present.');
}

function deploy() {
  // Workers Builds may run build and deploy in separate clean environments; rebuild safely if artifacts are absent.
  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) build();
  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) {
    throw new Error('Build did not produce the local Live Voice SDK; refusing deployment.');
  }
  const appOrigin = String(process.env.SAYROX_APP_ORIGIN || '').trim();
  let parsedOrigin;
  try { parsedOrigin = new URL(appOrigin); } catch { throw new Error('Set SAYROX_APP_ORIGIN in the Cloudflare build environment to the exact new SAYROX workers.dev HTTPS origin (no trailing slash).'); }
  if (parsedOrigin.protocol !== 'https:' || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash || appOrigin.endsWith('/') || !parsedOrigin.hostname.endsWith('.workers.dev')) {
    throw new Error('SAYROX_APP_ORIGIN must be the exact HTTPS workers.dev origin for the new sayrox Worker, without a path or trailing slash.');
  }
  const tasksConfigPath = path.join(projectDir, 'tasks-worker/wrangler.jsonc');
  let tasksConfig = readFileSync(tasksConfigPath, 'utf8');
  const originPattern = /("APP_ORIGIN"\s*:\s*")[^"]+("\s*)/;
  if (!originPattern.test(tasksConfig)) throw new Error('tasks-worker/wrangler.jsonc is missing vars.APP_ORIGIN.');
  tasksConfig = tasksConfig.replace(originPattern, `$1${appOrigin}$2`);
  writeFileSync(tasksConfigPath, tasksConfig);

  // Fresh-account deployment: provision each new storage Worker before the main Worker binds to it.
  runNpm(['run', 'deploy:auth'], 'Create SAYROX authentication and rate-limit storage');
  runNpm(['run', 'deploy:billing'], 'Create SAYROX billing storage');
  runNpm(['run', 'deploy:usage'], 'Create SAYROX usage, memory-history and approval storage');
  runNpm(['run', 'deploy:tasks'], 'Create SAYROX scheduled-tasks storage');
  runNpm(['run', 'deploy:sayrox'], 'Deploy SAYROX main Worker and static assets');
  console.log('\nAll Workers deployed. Runtime secrets, binding checks and live-provider smoke tests still need verification.');
}

const mode = process.argv[2];
try {
  if (mode === 'build') build();
  else if (mode === 'deploy') deploy();
  else throw new Error('Use: node deploy.mjs build | deploy');
} catch (error) {
  console.error(`\nSAYROX deploy kit stopped: ${error?.message || error}`);
  process.exitCode = 1;
}
