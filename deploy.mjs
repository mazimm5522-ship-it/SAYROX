import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectName = 'SAYROX-19.11.12';
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
  for (const required of ['package.json', 'wrangler.jsonc', 'site/index.html', 'site/_worker.js', 'usage-worker/wrangler.jsonc', 'tasks-worker/wrangler.jsonc']) {
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
  runNpm(['test'], 'Run all 132+ project tests');
  runNpm(['run', 'build'], 'Build app, Worker and same-origin voice SDK');
  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) {
    throw new Error('Voice SDK bundle was not generated; refusing deployment.');
  }
  console.log('\nSAYROX build complete. Voice SDK bundle is present.');
}

function deploy() {
  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) {
    throw new Error('Run the Build step successfully before deployment.');
  }
  // Preserve existing storage Workers and deploy in dependency order.
  runNpm(['run', 'deploy:usage'], 'Update existing usage storage Worker (preserves its Durable Object namespace)');
  runNpm(['run', 'deploy:tasks'], 'Create SAYROX scheduled-tasks Worker');
  runNpm(['run', 'deploy:sayrox'], 'Deploy SAYROX main Worker and static assets');
  console.log('\nAll deployment commands completed. Runtime secrets and live-provider smoke tests still need verification.');
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
