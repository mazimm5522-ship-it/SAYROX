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
const legacyMarker = '// SAYROX-LEGACY-DO-EXPORTS';
const legacyClasses = ['AccountObject', 'AuthRateLimiter'];

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
  for (const required of [
    'package.json',
    'wrangler.jsonc',
    'site/index.html',
    'site/_worker.js',
    'auth-worker/src/index.js',
    'usage-worker/wrangler.jsonc',
    'tasks-worker/wrangler.jsonc'
  ]) {
    if (!existsSync(path.join(projectDir, required))) {
      throw new Error(`Required project file is missing after extraction: ${required}`);
    }
  }
  console.log(`Extracted ${written} project files safely from ${path.basename(archivePath)}.`);
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

function hasNamedExport(source, name) {
  const direct = new RegExp(`export\\s+(?:default\\s+)?(?:class|const|let|var|function)\\s+${name}\\b`);
  if (direct.test(source)) return true;
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const tokens = part.trim().split(/\s+as\s+/);
      const exported = (tokens[1] ?? tokens[0]).trim();
      if (exported === name) return true;
    }
  }
  return false;
}

function patchLegacyDurableObjectExports() {
  const workerPath = path.join(projectDir, 'site', '_worker.js');
  const authPath = path.join(projectDir, 'auth-worker', 'src', 'index.js');
  if (!existsSync(workerPath)) throw new Error('Built site/_worker.js is missing.');
  if (!existsSync(authPath)) throw new Error('auth-worker/src/index.js is missing; cannot preserve legacy Durable Object classes.');

  let source = readFileSync(workerPath, 'utf8');
  if (source.includes(legacyMarker)) {
    const incomplete = legacyClasses.filter(name => !hasNamedExport(source, name));
    if (incomplete.length) throw new Error(`Legacy Durable Object export patch is incomplete: ${incomplete.join(', ')}.`);
    console.log('Legacy Durable Object exports are already present.');
    return;
  }

  const missing = legacyClasses.filter(name => !hasNamedExport(source, name));
  if (!missing.length) {
    console.log('Built Worker already exports both legacy Durable Object classes.');
    return;
  }

  const authSource = readFileSync(authPath, 'utf8');
  const unavailable = missing.filter(name => !hasNamedExport(authSource, name));
  if (unavailable.length) {
    throw new Error(`Cannot preserve legacy Durable Object classes; auth source does not export: ${unavailable.join(', ')}.`);
  }

  const importSpecifiers = missing.map(name => `${name} as Legacy${name}`).join(', ');
  const exportSpecifiers = missing.map(name => `Legacy${name} as ${name}`).join(', ');
  const importLine = `import { ${importSpecifiers} } from "../auth-worker/src/index.js";`;
  const exportLine = `export { ${exportSpecifiers} };`;
  source = `${legacyMarker}\n${importLine}\n${source}\n${legacyMarker}\n${exportLine}\n`;
  writeFileSync(workerPath, source);

  const finalSource = readFileSync(workerPath, 'utf8');
  const stillMissing = legacyClasses.filter(name => !hasNamedExport(finalSource, name));
  if (stillMissing.length) throw new Error(`Failed to retain legacy Durable Object exports: ${stillMissing.join(', ')}.`);
  console.log(`Preserved existing Durable Object classes without deleting or renaming namespaces: ${missing.join(', ')}.`);
}

function readProjectPackage() {
  const file = path.join(projectDir, 'package.json');
  if (!existsSync(file)) throw new Error('Extracted project package.json is missing.');
  return JSON.parse(readFileSync(file, 'utf8'));
}

function build() {
  extractProject();
  runNpm(['install', '--no-audit', '--no-fund'], 'Install SAYROX dependencies');

  // Generate the clean Worker first. Infrastructure tests compare this generated
  // file with the generator output, so compatibility exports are added only after tests.
  runNpm(['run', 'build'], 'Build app, Worker and same-origin voice SDK');
  runNpm(['test'], 'Run all SAYROX project tests');

  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) {
    throw new Error('Voice SDK bundle was not generated; refusing deployment.');
  }
  patchLegacyDurableObjectExports();
  console.log('\nSAYROX build complete. Tests passed and the legacy Durable Object exports are retained.');
}

function deploy() {
  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) {
    throw new Error('Run the Build step successfully before deployment.');
  }
  patchLegacyDurableObjectExports();

  const scripts = readProjectPackage().scripts ?? {};
  const deployment = [
    { candidates: ['deploy:auth', 'deploy:auth-storage', 'deploy:auth-worker'], label: 'Create/update SAYROX auth storage Worker', expected: 'auth storage' },
    { candidates: ['deploy:billing', 'deploy:billing-storage', 'deploy:billing-worker'], label: 'Create/update SAYROX billing storage Worker', expected: 'billing storage' },
    { candidates: ['deploy:usage', 'deploy:usage-storage', 'deploy:usage-worker'], label: 'Create/update SAYROX usage storage Worker', expected: 'usage storage' },
    { candidates: ['deploy:tasks', 'deploy:tasks-storage', 'deploy:tasks-worker'], label: 'Create/update SAYROX scheduled-tasks Worker', expected: 'tasks storage' },
    { candidates: ['deploy:sayrox', 'deploy:main', 'deploy:main-worker'], label: 'Deploy SAYROX main Worker and static assets', expected: 'main Worker' }
  ];
  const plan = deployment.map(stage => ({
    script: stage.candidates.find(candidate => Boolean(scripts[candidate])) ?? null,
    label: stage.label,
    expected: stage.expected
  }));
  const missing = plan.filter(item => !item.script).map(item => item.expected);
  if (missing.length) {
    throw new Error(`Deployment stopped before changing Cloudflare: required package scripts are missing: ${missing.join(', ')}. Available deploy scripts: ${Object.keys(scripts).filter(name => name.startsWith('deploy')).join(', ') || 'none'}.`);
  }

  // Preflight the complete deployment plan before publishing any Worker.
  for (const item of plan) {
    runNpm(['run', item.script], item.label);
  }
  console.log('\nAll five Worker deployment steps completed. Runtime secrets and live-provider smoke tests still need verification.');
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
