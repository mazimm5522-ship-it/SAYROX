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

function patchLegacyDurableObjectExports() {
  const generatorPath = path.join(projectDir, 'scripts/build-worker.mjs');
  const authSourcePath = path.join(projectDir, 'auth-worker/src/index.js');
  if (!existsSync(generatorPath) || !existsSync(authSourcePath)) {
    throw new Error('Cannot preserve legacy Durable Object exports: required Worker build/auth source files are missing.');
  }

  const authSource = readFileSync(authSourcePath, 'utf8');
  for (const className of ['AccountObject', 'AuthRateLimiter']) {
    if (!new RegExp(`export\\s+class\\s+${className}\\b`).test(authSource)) {
      throw new Error(`Auth Worker source does not export the expected legacy class ${className}; refusing an unsafe compatibility patch.`);
    }
  }

  let generator = readFileSync(generatorPath, 'utf8');
  const marker = 'const LEGACY_DO_IMPORTS =';
  if (generator.includes(marker)) {
    const expectedExports = [
      'export class AccountObject extends LegacyAccountObject {}',
      'export class AuthRateLimiter extends LegacyAuthRateLimiter {}'
    ];
    if (!generator.includes('LegacyAccountObject') || !generator.includes('LegacyAuthRateLimiter') ||
        !expectedExports.every(line => generator.includes(line))) {
      throw new Error('Legacy Durable Object patch is incomplete; refusing to continue.');
    }
    console.log('Legacy Durable Object exports are already preserved in the Worker build generator.');
    return;
  }

  const anchor = String.raw`const output = HEADER + modules.join(',\n') + FOOTER;`;
  if (generator.split(anchor).length !== 2) {
    throw new Error('Unexpected scripts/build-worker.mjs structure; refusing to patch an unknown build generator.');
  }

  const replacement = String.raw`const LEGACY_DO_IMPORTS = 'import { AccountObject as LegacyAccountObject, AuthRateLimiter as LegacyAuthRateLimiter } from "../auth-worker/src/index.js";\n';
const LEGACY_DO_EXPORTS = '\nexport class AccountObject extends LegacyAccountObject {}\nexport class AuthRateLimiter extends LegacyAuthRateLimiter {}\n';
const output = LEGACY_DO_IMPORTS + HEADER + modules.join(',\n') + FOOTER + LEGACY_DO_EXPORTS;`;
  generator = generator.replace(anchor, replacement);
  writeFileSync(generatorPath, generator);

  const verified = readFileSync(generatorPath, 'utf8');
  if (!verified.includes('import { AccountObject as LegacyAccountObject, AuthRateLimiter as LegacyAuthRateLimiter } from "../auth-worker/src/index.js";') ||
      !verified.includes('export class AccountObject extends LegacyAccountObject {}') ||
      !verified.includes('export class AuthRateLimiter extends LegacyAuthRateLimiter {}')) {
    throw new Error('Legacy Durable Object export patch verification failed.');
  }
  console.log('Patched Worker build generator to retain the legacy Durable Object classes as named class exports.');
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
  for (const required of ['package.json', 'wrangler.jsonc', 'site/index.html', 'site/_worker.js', 'scripts/build-worker.mjs', 'auth-worker/src/index.js', 'auth-worker/wrangler.jsonc', 'billing-worker/wrangler.jsonc', 'usage-worker/wrangler.jsonc', 'tasks-worker/wrangler.jsonc']) {
    if (!existsSync(path.join(projectDir, required))) throw new Error(`Required project file is missing after extraction: ${required}`);
  }
  patchLegacyDurableObjectExports();
  console.log(`Extracted ${written} project files safely.`);
}

function runNpm(args, label) {
  console.log(`\n=== ${label} ===`);

  // Workers Builds injects the connected Worker's name/tag into its environment.
  // This deploy kit publishes multiple differently named Workers, so child
  // Wrangler processes must use the names declared in each Worker config.
  const childEnv = { ...process.env };
  delete childEnv.WRANGLER_CI_OVERRIDE_NAME;
  delete childEnv.WRANGLER_CI_MATCH_TAG;

  const result = spawnSync(npmCommand, args, {
    cwd: projectDir,
    env: childEnv,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
}

function build() {
  extractProject();
  runNpm(['install', '--no-audit', '--no-fund'], 'Install SAYROX dependencies');
  // Build generated assets before tests that verify the committed output is in sync.
  runNpm(['run', 'build'], 'Build app, Worker and same-origin voice SDK');
  runNpm(['test'], 'Run all SAYROX project tests');
  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) {
    throw new Error('Voice SDK bundle was not generated; refusing deployment.');
  }
  console.log('\nSAYROX build complete. Voice SDK bundle is present; all tests passed.');
}

function deploy() {
  // Workers Builds may run build and deploy in separate clean environments; rebuild safely if artifacts are absent.
  const workerGeneratorExists = existsSync(path.join(projectDir, 'scripts/build-worker.mjs'));
  const voiceSdkExists = existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'));
  if (!workerGeneratorExists || !voiceSdkExists) build();
  else patchLegacyDurableObjectExports();
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
