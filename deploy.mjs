#!/usr/bin/env node
/**
 * SAYROX Cloudflare deploy kit — deploy.mjs
 *
 * Commands (package.json should map: "build": "node deploy.mjs build",
 *                                    "deploy": "node deploy.mjs deploy"):
 *   build   extract zip -> install -> build -> run tests -> add legacy DO exports -> verify
 *   deploy  make sure the build exists -> wrangler deploy
 *   test    run only the project tests (on the unpatched worker)
 *   patch   only add the legacy Durable Object exports to site/_worker.js
 *
 * ROOT CAUSE OF THE OLD FAILURE
 *   The old kit patched the worker generator BEFORE the tests ran, so site/_worker.js
 *   started with an `import ... from "../auth-worker/src/index.js"` line. 11 tests load
 *   that file with node:vm (as a plain script) or copy it to /tmp, so they crashed with
 *   "Cannot use import statement outside a module" / ERR_MODULE_NOT_FOUND.
 *   FIX: tests run against the clean worker; the legacy exports are added afterwards,
 *   only to the final file that wrangler deploys.
 *
 * Optional env vars:
 *   SAYROX_SKIP_TESTS=1         skip the test step
 *   SAYROX_ALLOW_TEST_FAILURE=1 print test failures but continue the build
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MARKER_FILE = path.join(ROOT, ".sayrox-project.json");
const SKIP_DIRS = new Set(["node_modules", ".git", ".wrangler", "site", "dist"]);
const LEGACY_DO_CLASSES = ["AccountObject", "AuthRateLimiter"];
const LEGACY_IMPORT_PATH = "../auth-worker/src/index.js";
const LEGACY_MARK = "// SAYROX-LEGACY-DO-EXPORTS";
const LIMITS = { entries: 5000, bytes: 300 * 1024 * 1024 };
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/* ------------------------------ helpers ------------------------------ */

const step = (title) => console.log(`\n=== ${title} ===`);
const info = (msg) => console.log(msg);

class KitError extends Error {}
const fail = (msg) => {
  throw new KitError(msg);
};

function run(cmd, args, { cwd = ROOT, env = {} } = {}) {
  console.log(`$ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, CI: "1", ...env },
    stdio: "inherit",
  });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

function mustRun(label, cmd, args, opts) {
  const code = run(cmd, args, opts);
  if (code !== 0) fail(`${label} failed with exit code ${code}.`);
}

const byNameDesc = (a, b) =>
  path.basename(b).localeCompare(path.basename(a), undefined, { numeric: true });

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/* ------------------------- locate / extract project ------------------------- */

function findArchive() {
  const found = [];
  const scan = (dir, depth) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (depth < 1 && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) {
          scan(path.join(dir, e.name), depth + 1);
        }
      } else if (e.isFile() && /\.zip$/i.test(e.name)) {
        found.push(path.join(dir, e.name));
      }
    }
  };
  scan(ROOT, 0);
  if (!found.length) return null;
  found.sort((a, b) => {
    const sa = /sayrox/i.test(path.basename(a)) ? 0 : 1;
    const sb = /sayrox/i.test(path.basename(b)) ? 0 : 1;
    return sa - sb || byNameDesc(a, b);
  });
  return found[0];
}

function isProject(dir) {
  return (
    existsSync(path.join(dir, "package.json")) &&
    existsSync(path.join(dir, "scripts", "build-worker.mjs"))
  );
}

function findProject() {
  const marker = readJson(MARKER_FILE);
  if (marker?.dir) {
    const d = path.resolve(ROOT, marker.dir);
    if (isProject(d)) return d;
  }
  const dirs = readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
    .map((e) => path.join(ROOT, e.name))
    .filter(isProject)
    .sort(byNameDesc);
  if (dirs.length) return dirs[0];
  if (isProject(ROOT)) return ROOT;
  return null;
}

async function extractArchive(zipPath) {
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));

  const items = [];
  let total = 0;
  for (const [rawName, data] of Object.entries(entries)) {
    const name = rawName.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
    if (!name || name.endsWith("/")) continue;
    if (name.startsWith("__MACOSX/") || name.split("/").pop() === ".DS_Store") continue;
    if (
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      name.split("/").includes("..") ||
      name.includes("\0")
    ) {
      fail(`Unsafe path inside zip: ${rawName}`);
    }
    total += data.length;
    items.push({ name, data });
    if (items.length > LIMITS.entries) fail("Zip has too many files.");
    if (total > LIMITS.bytes) fail("Zip is too large.");
  }
  if (!items.length) fail(`Zip is empty: ${zipPath}`);

  const tops = new Set(items.map((i) => i.name.split("/")[0]));
  const single = tops.size === 1 && items.every((i) => i.name.includes("/"));
  const projectName = single
    ? [...tops][0]
    : path.basename(zipPath).replace(/\.zip$/i, "");
  const target = path.join(ROOT, projectName);

  rmSync(target, { recursive: true, force: true });
  for (const { name, data } of items) {
    const out = single ? path.join(ROOT, name) : path.join(target, name);
    if (out !== target && !out.startsWith(target + path.sep)) fail(`Unsafe output path: ${name}`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  info(`Extracted ${items.length} project files safely into ${path.relative(ROOT, target) || "."}.`);

  if (!isProject(target)) {
    fail(
      `Extracted folder "${path.relative(ROOT, target)}" has no package.json + scripts/build-worker.mjs. ` +
        `Top-level entries in zip: ${[...tops].slice(0, 10).join(", ")}`
    );
  }
  return target;
}

async function ensureProject() {
  const zip = findArchive();
  if (zip) {
    info(`Project archive: ${path.relative(ROOT, zip)}`);
    const dir = await extractArchive(zip);
    writeFileSync(MARKER_FILE, JSON.stringify({ dir: path.relative(ROOT, dir) || "." }));
    return dir;
  }
  const existing = findProject();
  if (existing) {
    info(`No zip found — using already extracted project: ${path.relative(ROOT, existing) || "."}`);
    writeFileSync(MARKER_FILE, JSON.stringify({ dir: path.relative(ROOT, existing) || "." }));
    return existing;
  }
  fail(
    "Could not find the SAYROX project. Put the project .zip next to deploy.mjs " +
      "(or commit the extracted project folder)."
  );
}

/* ------------------------- legacy Durable Object exports ------------------------- */

function isExported(src, name) {
  const direct = new RegExp(
    `export\\s+(?:default\\s+)?(?:class|const|let|var|function)\\s+${name}\\b`
  );
  if (direct.test(src)) return true;
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const tokens = part.trim().split(/\s+as\s+/);
      const exported = (tokens[1] ?? tokens[0]).trim();
      if (exported === name) return true;
    }
  }
  return false;
}

function patchWorker(projectDir) {
  const file = path.join(projectDir, "site", "_worker.js");
  if (!existsSync(file)) fail("site/_worker.js was not found — run the build first.");
  const legacyFile = path.join(projectDir, "auth-worker", "src", "index.js");
  if (!existsSync(legacyFile)) fail("auth-worker/src/index.js was not found.");

  let src = readFileSync(file, "utf8");
  if (src.includes(LEGACY_MARK)) {
    info("Legacy Durable Object exports are already present in site/_worker.js.");
    return;
  }

  const legacySrc = readFileSync(legacyFile, "utf8");
  const missing = LEGACY_DO_CLASSES.filter((n) => !isExported(src, n));
  if (!missing.length) {
    info("Worker already exports the legacy Durable Object classes — nothing to add.");
    return;
  }
  for (const n of missing) {
    if (!legacySrc.includes(n)) {
      info(`Warning: auth-worker/src/index.js does not mention ${n}; deploy may fail if it is bound.`);
    }
  }

  const importLine =
    `import { ${missing.map((n) => `${n} as Legacy${n}`).join(", ")} } from "${LEGACY_IMPORT_PATH}";`;
  const exportLine = `export { ${missing.map((n) => `Legacy${n} as ${n}`).join(", ")} };`;
  src = `${LEGACY_MARK}\n${importLine}\n${src}\n${LEGACY_MARK}\n${exportLine}\n`;
  writeFileSync(file, src);
  info(`Added legacy Durable Object exports to site/_worker.js: ${missing.join(", ")}.`);
}

/* ------------------------------ build / test ------------------------------ */

function runTests(projectDir, scripts) {
  if (process.env.SAYROX_SKIP_TESTS === "1") {
    info("Tests skipped (SAYROX_SKIP_TESTS=1).");
    return;
  }
  if (!scripts.test) {
    info("No test script in the project — skipping tests.");
    return;
  }
  const code = run(NPM, ["test"], { cwd: projectDir });
  if (code !== 0) {
    if (process.env.SAYROX_ALLOW_TEST_FAILURE === "1") {
      info("WARNING: tests failed, continuing because SAYROX_ALLOW_TEST_FAILURE=1.");
    } else {
      fail(`Run all SAYROX project tests failed with exit code ${code}.`);
    }
  }
}

async function build() {
  step("Prepare SAYROX project");
  const projectDir = await ensureProject();
  const scripts = readJson(path.join(projectDir, "package.json"))?.scripts ?? {};

  step("Install SAYROX dependencies");
  mustRun("Dependency install", NPM, ["install", "--no-audit", "--no-fund"], { cwd: projectDir });

  step("Build app, Worker and same-origin voice SDK");
  mustRun("Project build", NPM, ["run", "build"], { cwd: projectDir });

  step("Run all SAYROX project tests (clean worker, before legacy exports)");
  runTests(projectDir, scripts);

  step("Retain legacy Durable Object classes");
  patchWorker(projectDir);

  if (scripts.verify) {
    step("Verify final site");
    mustRun("Final verify", NPM, ["run", "verify"], { cwd: projectDir });
  }
  info("\nBuild finished OK.");
}

/* -------------------------------- deploy -------------------------------- */

function findWranglerConfig(projectDir) {
  const names = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];
  for (const dir of [projectDir, ROOT]) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

async function deploy(extraArgs) {
  let projectDir = findProject();
  if (!projectDir || !existsSync(path.join(projectDir, "site", "_worker.js"))) {
    info("No finished build found — building first.");
    await build();
    projectDir = findProject();
  }
  if (!projectDir) fail("Project folder not found.");
  patchWorker(projectDir); // idempotent safety net

  const config = findWranglerConfig(projectDir);
  if (!config) fail("No wrangler.jsonc / wrangler.json / wrangler.toml found.");

  step("Deploy with Wrangler");
  const bin = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  const cmd = existsSync(bin) ? [bin] : ["npx", "wrangler"];
  mustRun("Wrangler deploy", cmd[0], [...cmd.slice(1), "deploy", "--config", config, ...extraArgs], {
    cwd: path.dirname(config),
  });
}

/* --------------------------------- main --------------------------------- */

async function main() {
  const [cmd = "build", ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "build":
      return build();
    case "deploy":
      return deploy(rest);
    case "test": {
      const dir = findProject() ?? (await ensureProject());
      const scripts = readJson(path.join(dir, "package.json"))?.scripts ?? {};
      return runTests(dir, scripts);
    }
    case "patch": {
      const dir = findProject();
      if (!dir) fail("Project folder not found.");
      return patchWorker(dir);
    }
    default:
      fail(`Unknown command "${cmd}". Use: build | deploy | test | patch`);
  }
}

main().catch((err) => {
  console.error(`\nSAYROX deploy kit stopped: ${err instanceof KitError ? err.message : err?.stack || err}`);
  process.exit(1);
});
