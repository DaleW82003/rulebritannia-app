/**
 * server/scenario-manifest-loader.js
 *
 * Lightweight loader for scenario manifests stored under data/scenarios/.
 *
 * Each scenario lives in its own subdirectory:
 *   data/scenarios/<key>/manifest.json
 *
 * The loader is the single authoritative source for:
 *   - the default scenario key
 *   - resolving scenario-relative asset paths (constituencies JSON, election CSV, world seed JSON)
 *   - any manifest field a caller needs without importing the full server module
 *
 * Manifests are cached after first read so repeated calls in a single process
 * incur only one filesystem read per scenario.
 *
 * Phase 3 note: only the "1997" scenario manifest exists.  Once additional
 * scenarios are added, listScenarioKeys() will discover them automatically.
 *
 * @module scenario-manifest-loader
 */

import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repository root (one level above server/). */
const REPO_ROOT = resolve(__dir, "..");

/** Absolute path to the directory that holds per-scenario subdirectories. */
const SCENARIOS_DIR = resolve(REPO_ROOT, "data", "scenarios");

/** In-process manifest cache: scenarioKey → parsed manifest object. */
const _cache = new Map();
/** In-process world-seed cache: scenarioKey → parsed seed object. */
const _worldSeedCache = new Map();

/**
 * The key of the scenario that is active when no explicit scenario is selected.
 * This constant is intentionally centralised here so callers across the codebase
 * import it from a single place rather than each hardcoding "1997".
 *
 * @type {string}
 */
export const DEFAULT_SCENARIO_KEY = "1997";

/**
 * Return the default scenario key.
 * Provided as a function so call-sites that already use `getDefaultScenarioKey()`
 * continue to work without modification.
 *
 * @returns {string}
 */
export function getDefaultScenarioKey() {
  return DEFAULT_SCENARIO_KEY;
}

/**
 * Load and return the parsed manifest for the given scenario key.
 *
 * Throws a descriptive error if the manifest file does not exist or contains
 * invalid JSON, so callers can surface a clear message instead of a raw
 * ENOENT / SyntaxError.
 *
 * @param {string} key - Scenario key, e.g. "1997".
 * @returns {object} Parsed manifest object.
 * @throws {Error} If the manifest cannot be found or parsed.
 */
export function loadScenarioManifest(key) {
  if (_cache.has(key)) return _cache.get(key);

  const manifestPath = resolve(SCENARIOS_DIR, String(key), "manifest.json");
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (e) {
    const err = new Error(
      `Scenario manifest not found for key "${key}". ` +
      `Expected file: data/scenarios/${key}/manifest.json`
    );
    err.cause = e;
    err.code = "SCENARIO_MANIFEST_NOT_FOUND";
    throw err;
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    const err = new Error(
      `Scenario manifest for key "${key}" contains invalid JSON.`
    );
    err.cause = e;
    err.code = "SCENARIO_MANIFEST_INVALID_JSON";
    throw err;
  }

  _cache.set(key, manifest);
  return manifest;
}

/**
 * Resolve whether a scenario is safe to initialize in admin seeding flows.
 *
 * Manifest shape:
 *   initialization.ready         (boolean, defaults to true)
 *   initialization.blockedReason (string, optional when ready=false)
 *
 * @param {string} key - Scenario key, e.g. "1997".
 * @returns {{ ready: boolean, blockedReason: string|null }}
 */
export function getScenarioInitializationStatus(key) {
  const manifest = loadScenarioManifest(key);
  const ready = manifest?.initialization?.ready !== false;
  const blockedReason = ready
    ? null
    : String(manifest?.initialization?.blockedReason || "Scenario is not initialization-ready yet.");
  return { ready, blockedReason };
}

/**
 * Load the parsed world-seed JSON for a scenario.
 *
 * The manifest must provide a `worldSeedFile` repo-root-relative path.
 *
 * @param {string} key - Scenario key, e.g. "1997".
 * @returns {object} Parsed world seed object.
 * @throws {Error} If the manifest omits the file path, the file cannot be found,
 * or the JSON is invalid.
 */
export function loadScenarioWorldSeed(key) {
  if (_worldSeedCache.has(key)) return _worldSeedCache.get(key);

  const manifest = loadScenarioManifest(key);
  const seedRelPath = String(manifest?.worldSeedFile || "").trim();
  if (!seedRelPath) {
    const err = new Error(`Scenario manifest for key "${key}" does not define worldSeedFile.`);
    err.code = "SCENARIO_WORLD_SEED_MISSING";
    throw err;
  }

  let raw;
  try {
    raw = readFileSync(resolveManifestPath(seedRelPath), "utf8");
  } catch (e) {
    const err = new Error(
      `Scenario world seed not found for key "${key}". Expected file: ${seedRelPath}`
    );
    err.cause = e;
    err.code = "SCENARIO_WORLD_SEED_NOT_FOUND";
    throw err;
  }

  let seed;
  try {
    seed = JSON.parse(raw);
  } catch (e) {
    const err = new Error(`Scenario world seed for key "${key}" contains invalid JSON.`);
    err.cause = e;
    err.code = "SCENARIO_WORLD_SEED_INVALID_JSON";
    throw err;
  }

  _worldSeedCache.set(key, seed);
  return seed;
}

/**
 * Resolve an asset path recorded in a manifest to an absolute filesystem path.
 *
 * Manifest paths are stored relative to the repository root so they are
 * portable across deployment layouts.
 *
 * @param {string} manifestRelativePath - e.g. "data/scenarios/1997/constituencies.json"
 * @returns {string} Absolute path.
 */
export function resolveManifestPath(manifestRelativePath) {
  return resolve(REPO_ROOT, manifestRelativePath);
}

/**
 * List the keys of all scenarios that have a manifest file on disk.
 *
 * The result is sorted alphabetically.  Non-directory entries and directories
 * that lack a manifest.json are silently skipped.
 *
 * @returns {string[]} Array of scenario key strings.
 */
export function listScenarioKeys() {
  let entries;
  try {
    entries = readdirSync(SCENARIOS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => {
      try {
        readFileSync(resolve(SCENARIOS_DIR, name, "manifest.json"));
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}
