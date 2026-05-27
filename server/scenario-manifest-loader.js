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
 * Scenario inheritance note: child scenarios may declare `parentScenario`
 * (or legacy alias `baseScenario`) and selectively merge supported seed files
 * instead of copying full baseline datasets.
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

/** In-process raw manifest cache: scenarioKey → parsed raw manifest object. */
const _rawManifestCache = new Map();
/** In-process manifest cache: scenarioKey → effective manifest object. */
const _manifestCache = new Map();
/** In-process world-seed cache: scenarioKey → parsed seed object. */
const _worldSeedCache = new Map();
/** In-process constituencies cache: scenarioKey → parsed seed object. */
const _constituenciesCache = new Map();

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

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildManifestError(key, message, code, cause) {
  const err = new Error(message);
  if (cause) err.cause = cause;
  err.code = code;
  err.scenarioKey = key;
  return err;
}

function readJsonFile({ absolutePath, notFoundMessage, notFoundCode, invalidMessage, invalidCode, scenarioKey }) {
  let raw;
  try {
    raw = readFileSync(absolutePath, "utf8");
  } catch (e) {
    throw buildManifestError(scenarioKey, notFoundMessage, notFoundCode, e);
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw buildManifestError(scenarioKey, invalidMessage, invalidCode, e);
  }
}

function mergeManifestValue(parentValue, childValue) {
  if (childValue === undefined) return deepClone(parentValue);
  if (parentValue === undefined) return deepClone(childValue);
  if (Array.isArray(childValue)) return deepClone(childValue);
  if (isPlainObject(parentValue) && isPlainObject(childValue)) {
    const out = deepClone(parentValue);
    for (const [key, value] of Object.entries(childValue)) {
      out[key] = mergeManifestValue(out[key], value);
    }
    return out;
  }
  return deepClone(childValue);
}

function normalizeInheritanceConfig(key, rawInheritance) {
  if (rawInheritance == null) return {};
  if (!isPlainObject(rawInheritance)) {
    throw buildManifestError(
      key,
      `Scenario manifest for key "${key}" has invalid inheritance config. Expected an object.`,
      "SCENARIO_MANIFEST_INVALID_INHERITANCE"
    );
  }
  const out = {};
  for (const [asset, mode] of Object.entries(rawInheritance)) {
    if (mode !== "merge" && mode !== "replace") {
      throw buildManifestError(
        key,
        `Scenario manifest for key "${key}" has invalid inheritance mode for "${asset}". Expected "merge" or "replace".`,
        "SCENARIO_MANIFEST_INVALID_INHERITANCE"
      );
    }
    out[asset] = mode;
  }
  return out;
}

function getRawScenarioManifest(key) {
  const normalized = String(key).trim();
  if (_rawManifestCache.has(normalized)) return _rawManifestCache.get(normalized);

  const manifestPath = resolve(SCENARIOS_DIR, normalized, "manifest.json");
  const manifest = readJsonFile({
    absolutePath: manifestPath,
    notFoundMessage:
      `Scenario manifest not found for key "${normalized}". ` +
      `Expected file: data/scenarios/${normalized}/manifest.json`,
    notFoundCode: "SCENARIO_MANIFEST_NOT_FOUND",
    invalidMessage: `Scenario manifest for key "${normalized}" contains invalid JSON.`,
    invalidCode: "SCENARIO_MANIFEST_INVALID_JSON",
    scenarioKey: normalized,
  });

  _rawManifestCache.set(normalized, manifest);
  return manifest;
}

function getParentScenarioKey(rawManifest, key) {
  const declaredParent = rawManifest?.parentScenario;
  const declaredBase = rawManifest?.baseScenario;
  if (
    declaredParent != null &&
    declaredBase != null &&
    String(declaredParent).trim() !== String(declaredBase).trim()
  ) {
    throw buildManifestError(
      key,
      `Scenario manifest for key "${key}" defines conflicting parentScenario/baseScenario values.`,
      "SCENARIO_MANIFEST_INVALID_INHERITANCE"
    );
  }

  const normalized = String(declaredParent ?? declaredBase ?? "").trim();
  if (!normalized) return null;
  if (normalized === key) {
    throw buildManifestError(
      key,
      `Scenario manifest for key "${key}" cannot inherit from itself.`,
      "SCENARIO_MANIFEST_INVALID_INHERITANCE"
    );
  }
  return normalized;
}

function getInheritanceMode(manifest, assetName) {
  if (!manifest?.parentScenario) return "replace";
  return manifest?.inheritance?.[assetName] || "merge";
}

function getRecordKeySelector(path) {
  const joined = path.join(".");
  if (joined === "constituencies") return (record) => String(record?.id || record?.name || "").trim();
  if (joined === "canonicalParties") return (record) => String(record?.slug || record?.name || "").trim();
  if (joined === "factions") return (record) => String(record?.slug || "").trim();
  if (joined === "officeSpecs.cabinet" || joined === "officeSpecs.shadow") {
    return (record) => String(record?.specId || "").trim();
  }
  if (joined === "locals.countries") return (record) => String(record?.country || "").trim();
  if (/^locals\.countries\.[^.]+\.partyBreakdown$/.test(joined)) {
    return (record) => String(record?.party || "").trim();
  }
  if (/^bodies\.[^.]+\.partyBreakdown$/.test(joined)) {
    return (record) => String(record?.party || "").trim();
  }
  if (/^bodies\.[^.]+\.compositionBreakdown$/.test(joined)) {
    return (record) => String(record?.name || "").trim();
  }
  if (/^bodies\.[^.]+\.mayors$/.test(joined)) {
    return (record) => String(record?.id || record?.name || "").trim();
  }
  return null;
}

function mergeRecordArray(parentArray, childArray, path, getKey) {
  const out = parentArray.map((record) => deepClone(record));
  const indexByKey = new Map();
  for (let i = 0; i < out.length; i += 1) {
    const key = getKey(out[i]);
    if (key) indexByKey.set(key, i);
  }

  for (const record of childArray) {
    const key = getKey(record);
    if (!key || !indexByKey.has(key)) {
      out.push(deepClone(record));
      continue;
    }
    const idx = indexByKey.get(key);
    out[idx] = mergeScenarioSeedData(out[idx], record, [...path, key]);
  }

  return out;
}

export function mergeScenarioSeedData(parentValue, childValue, path = []) {
  if (childValue === undefined) return deepClone(parentValue);
  if (parentValue === undefined) return deepClone(childValue);

  if (Array.isArray(parentValue) && Array.isArray(childValue)) {
    const getKey = getRecordKeySelector(path);
    return getKey
      ? mergeRecordArray(parentValue, childValue, path, getKey)
      : deepClone(childValue);
  }

  if (isPlainObject(parentValue) && isPlainObject(childValue)) {
    const out = deepClone(parentValue);
    for (const [key, value] of Object.entries(childValue)) {
      out[key] = mergeScenarioSeedData(out[key], value, [...path, key]);
    }
    return out;
  }

  return deepClone(childValue);
}

function loadScenarioSeedJsonFile(key, rawRelativePath, kind, notFoundCode, invalidCode) {
  const relativePath = String(rawRelativePath || "").trim();
  if (!relativePath) {
    throw buildManifestError(
      key,
      `Scenario manifest for key "${key}" does not define ${kind}.`,
      notFoundCode
    );
  }
  return readJsonFile({
    absolutePath: resolveManifestPath(relativePath),
    notFoundMessage: `Scenario ${kind} not found for key "${key}". Expected file: ${relativePath}`,
    notFoundCode,
    invalidMessage: `Scenario ${kind} for key "${key}" contains invalid JSON.`,
    invalidCode,
    scenarioKey: key,
  });
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
  return loadScenarioManifestWithAncestors(String(key).trim(), []);
}

function loadScenarioManifestWithAncestors(key, ancestry) {
  if (_manifestCache.has(key)) return _manifestCache.get(key);
  if (ancestry.includes(key)) {
    const chain = [...ancestry, key].join(" -> ");
    throw buildManifestError(
      key,
      `Scenario inheritance cycle detected: ${chain}`,
      "SCENARIO_MANIFEST_INVALID_INHERITANCE"
    );
  }

  const rawManifest = getRawScenarioManifest(key);
  const parentScenario = getParentScenarioKey(rawManifest, key);
  const normalizedInheritance = normalizeInheritanceConfig(key, rawManifest?.inheritance);

  let manifest = deepClone(rawManifest);
  if (parentScenario) {
    const parentManifest = loadScenarioManifestWithAncestors(parentScenario, [...ancestry, key]);
    manifest = mergeManifestValue(parentManifest, rawManifest);
    manifest.parentScenario = parentScenario;
  }

  manifest.key = String(rawManifest?.key || key).trim() || key;
  manifest.inheritance = normalizedInheritance;
  delete manifest.baseScenario;

  _manifestCache.set(key, manifest);
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
  const rawManifest = getRawScenarioManifest(key);
  const ownWorldSeedPath = String(rawManifest?.worldSeedFile || "").trim();

  let seed;
  if (ownWorldSeedPath) {
    seed = loadScenarioSeedJsonFile(
      key,
      ownWorldSeedPath,
      "world seed",
      "SCENARIO_WORLD_SEED_NOT_FOUND",
      "SCENARIO_WORLD_SEED_INVALID_JSON"
    );
  } else if (manifest?.parentScenario) {
    seed = loadScenarioWorldSeed(manifest.parentScenario);
  } else {
    throw buildManifestError(
      key,
      `Scenario manifest for key "${key}" does not define worldSeedFile.`,
      "SCENARIO_WORLD_SEED_MISSING"
    );
  }

  if (manifest?.parentScenario && ownWorldSeedPath && getInheritanceMode(manifest, "worldSeed") === "merge") {
    seed = mergeScenarioSeedData(loadScenarioWorldSeed(manifest.parentScenario), seed);
  }

  _worldSeedCache.set(key, seed);
  return seed;
}

/**
 * Load the parsed constituencies JSON for a scenario, applying any configured
 * parent inheritance/merge rules.
 *
 * Child scenarios may provide a partial overrides file when
 * `inheritance.constituencies` is `"merge"`. Records are merged by constituency
 * `id` (falling back to `name` if needed).
 *
 * @param {string} key - Scenario key, e.g. "1997".
 * @returns {object} Parsed constituencies seed object.
 */
export function loadScenarioConstituenciesSeed(key) {
  if (_constituenciesCache.has(key)) return _constituenciesCache.get(key);

  const manifest = loadScenarioManifest(key);
  const rawManifest = getRawScenarioManifest(key);
  const ownConstituenciesPath = String(rawManifest?.constituenciesFile || "").trim();

  let seed;
  if (ownConstituenciesPath) {
    seed = loadScenarioSeedJsonFile(
      key,
      ownConstituenciesPath,
      "constituencies seed",
      "SCENARIO_CONSTITUENCIES_NOT_FOUND",
      "SCENARIO_CONSTITUENCIES_INVALID_JSON"
    );
  } else if (manifest?.parentScenario) {
    seed = loadScenarioConstituenciesSeed(manifest.parentScenario);
  } else {
    throw buildManifestError(
      key,
      `Scenario manifest for key "${key}" does not define constituenciesFile.`,
      "SCENARIO_CONSTITUENCIES_MISSING"
    );
  }

  if (
    manifest?.parentScenario &&
    ownConstituenciesPath &&
    getInheritanceMode(manifest, "constituencies") === "merge"
  ) {
    seed = mergeScenarioSeedData(loadScenarioConstituenciesSeed(manifest.parentScenario), seed);
  }

  _constituenciesCache.set(key, seed);
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
