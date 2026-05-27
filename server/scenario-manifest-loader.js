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

import { accessSync, readFileSync, readdirSync } from "fs";
import { resolve, dirname, isAbsolute, sep } from "path";
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
const SCENARIO_STATUSES = new Set(["default", "beta", "legacy"]);
const ALLOWED_INHERITANCE_ASSETS = new Set(["worldSeed", "constituencies"]);
const ALLOWED_BODY_TYPES = new Set(["standard", "mayors"]);
const ALLOWED_NATIONS = new Set(["England", "Scotland", "Wales", "Northern Ireland"]);
const OPTIONAL_PARTY_REFERENCES = new Set(["Others"]);

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

function assertScenario(condition, key, message, code) {
  if (!condition) {
    throw buildManifestError(key, message, code);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validateRepoRelativePath(key, fieldName, rawValue) {
  const relativePath = String(rawValue || "").trim();
  assertScenario(
    relativePath,
    key,
    `Scenario manifest for key "${key}" is missing required field "${fieldName}".`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  assertScenario(
    !isAbsolute(relativePath),
    key,
    `Scenario manifest for key "${key}" field "${fieldName}" must be repo-root-relative, not absolute.`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  const absolutePath = resolveManifestPath(relativePath);
  assertScenario(
    absolutePath === REPO_ROOT || absolutePath.startsWith(`${REPO_ROOT}${sep}`),
    key,
    `Scenario manifest for key "${key}" field "${fieldName}" must stay within the repository root.`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  try {
    accessSync(absolutePath);
  } catch (cause) {
    throw buildManifestError(
      key,
      `Scenario manifest for key "${key}" references missing file "${relativePath}" in field "${fieldName}".`,
      "SCENARIO_MANIFEST_INVALID_DATA",
      cause
    );
  }
}

function validateMonthYear(key, fieldName, value, code = "SCENARIO_MANIFEST_INVALID_DATA") {
  assertScenario(
    isPlainObject(value),
    key,
    `Scenario manifest for key "${key}" field "${fieldName}" must be an object with month/year.`,
    code
  );
  assertScenario(
    isIntegerInRange(value.month, 1, 12),
    key,
    `Scenario manifest for key "${key}" field "${fieldName}.month" must be an integer from 1 to 12.`,
    code
  );
  assertScenario(
    isPositiveInteger(value.year),
    key,
    `Scenario manifest for key "${key}" field "${fieldName}.year" must be a positive integer.`,
    code
  );
}

function validateUniqueRecords(key, values, getId, messagePrefix, code) {
  const seen = new Set();
  for (const value of values) {
    const id = String(getId(value) || "").trim();
    assertScenario(id, key, `${messagePrefix} is missing its required identifier.`, code);
    assertScenario(!seen.has(id), key, `${messagePrefix} identifier "${id}" must be unique.`, code);
    seen.add(id);
  }
}

function validatePartyReference(partySlugs, key, value, message, code) {
  const party = String(value || "").trim();
  assertScenario(party, key, message, code);
  assertScenario(
    partySlugs.has(party) || OPTIONAL_PARTY_REFERENCES.has(party),
    key,
    `${message} Received unknown party "${party}".`,
    code
  );
}

export function validateScenarioManifest(manifest, scenarioKey) {
  const key = String(scenarioKey || "").trim() || String(manifest?.key || "").trim() || "(unknown)";
  assertScenario(
    isPlainObject(manifest),
    key,
    `Scenario manifest for key "${key}" must contain a JSON object at the top level.`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  assertScenario(
    String(manifest?.key || "").trim() === key,
    key,
    `Scenario manifest for key "${key}" must declare a matching "key" field.`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  assertScenario(
    isNonEmptyString(manifest?.title),
    key,
    `Scenario manifest for key "${key}" is missing required field "title".`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  assertScenario(
    isNonEmptyString(manifest?.description),
    key,
    `Scenario manifest for key "${key}" is missing required field "description".`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  validateMonthYear(key, "startDate", manifest?.startDate);
  validateMonthYear(key, "clockDefault", manifest?.clockDefault);
  assertScenario(
    SCENARIO_STATUSES.has(manifest?.status),
    key,
    `Scenario manifest for key "${key}" field "status" must be one of: ${Array.from(SCENARIO_STATUSES).join(", ")}.`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  assertScenario(
    isPositiveInteger(manifest?.expectedConstituencyCount),
    key,
    `Scenario manifest for key "${key}" field "expectedConstituencyCount" must be a positive integer.`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  assertScenario(
    Array.isArray(manifest?.playableParties) && manifest.playableParties.length > 0,
    key,
    `Scenario manifest for key "${key}" field "playableParties" must be a non-empty array.`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  validateUniqueRecords(
    key,
    manifest.playableParties.map((party) => ({ id: party })),
    (row) => row.id,
    `Scenario manifest for key "${key}" playableParties entry`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );
  for (const party of manifest.playableParties) {
    assertScenario(
      isNonEmptyString(party),
      key,
      `Scenario manifest for key "${key}" contains an empty playable party entry.`,
      "SCENARIO_MANIFEST_INVALID_DATA"
    );
  }
  validateRepoRelativePath(key, "electionCsvFile", manifest?.electionCsvFile);
  validateRepoRelativePath(key, "worldSeedFile", manifest?.worldSeedFile);
  validateRepoRelativePath(key, "constituenciesFile", manifest?.constituenciesFile);

  if (manifest?.initialization !== undefined) {
    assertScenario(
      isPlainObject(manifest.initialization),
      key,
      `Scenario manifest for key "${key}" field "initialization" must be an object.`,
      "SCENARIO_MANIFEST_INVALID_DATA"
    );
    if (manifest.initialization.ready !== undefined) {
      assertScenario(
        typeof manifest.initialization.ready === "boolean",
        key,
        `Scenario manifest for key "${key}" field "initialization.ready" must be boolean when present.`,
        "SCENARIO_MANIFEST_INVALID_DATA"
      );
    }
    if (manifest.initialization.blockedReason !== undefined) {
      assertScenario(
        isNonEmptyString(manifest.initialization.blockedReason),
        key,
        `Scenario manifest for key "${key}" field "initialization.blockedReason" must be a non-empty string when present.`,
        "SCENARIO_MANIFEST_INVALID_DATA"
      );
    }
  }

  if (manifest?.parentScenario) {
    assertScenario(
      isNonEmptyString(manifest.parentScenario),
      key,
      `Scenario manifest for key "${key}" field "parentScenario" must be a non-empty string.`,
      "SCENARIO_MANIFEST_INVALID_DATA"
    );
  }

  if (manifest?.inheritance && Object.keys(manifest.inheritance).length > 0) {
    assertScenario(
      isNonEmptyString(manifest.parentScenario),
      key,
      `Scenario manifest for key "${key}" cannot declare inheritance modes without a parent scenario.`,
      "SCENARIO_MANIFEST_INVALID_INHERITANCE"
    );
  }

  return manifest;
}

export function validateScenarioWorldSeed(seed, manifest) {
  const key = String(manifest?.key || "(unknown)");
  const code = "SCENARIO_WORLD_SEED_INVALID_DATA";
  assertScenario(
    isPlainObject(seed),
    key,
    `Scenario world seed for key "${key}" must contain a JSON object at the top level.`,
    code
  );
  assertScenario(
    Array.isArray(seed?.canonicalParties) && seed.canonicalParties.length > 0,
    key,
    `Scenario world seed for key "${key}" must define a non-empty canonicalParties array.`,
    code
  );
  validateUniqueRecords(
    key,
    seed.canonicalParties,
    (row) => row?.slug,
    `Scenario world seed for key "${key}" canonical party`,
    code
  );
  const partySlugs = new Set();
  for (const party of seed.canonicalParties) {
    assertScenario(
      isPlainObject(party),
      key,
      `Scenario world seed for key "${key}" canonicalParties entries must be objects.`,
      code
    );
    assertScenario(
      isNonEmptyString(party?.name),
      key,
      `Scenario world seed for key "${key}" canonical party "${party?.slug || "(unknown)"}" must define "name".`,
      code
    );
    partySlugs.add(String(party.slug).trim());
  }

  for (const party of manifest?.playableParties || []) {
    validatePartyReference(
      partySlugs,
      key,
      party,
      `Scenario manifest for key "${key}" playableParties entry must reference a canonical party.`,
      code
    );
  }

  for (const partyKey of Object.keys(seed?.partyStructures || {})) {
    validatePartyReference(
      partySlugs,
      key,
      partyKey,
      `Scenario world seed for key "${key}" partyStructures key must reference a canonical party.`,
      code
    );
  }
  for (const partyKey of Object.keys(seed?.partyTreasuryCash || {})) {
    validatePartyReference(
      partySlugs,
      key,
      partyKey,
      `Scenario world seed for key "${key}" partyTreasuryCash key must reference a canonical party.`,
      code
    );
  }
  for (const partyKey of Object.keys(seed?.economy?.hqBaselineUpkeep || {})) {
    validatePartyReference(
      partySlugs,
      key,
      partyKey,
      `Scenario world seed for key "${key}" economy.hqBaselineUpkeep key must reference a canonical party.`,
      code
    );
  }

  if (seed?.factions !== undefined) {
    assertScenario(
      Array.isArray(seed.factions),
      key,
      `Scenario world seed for key "${key}" field "factions" must be an array when present.`,
      code
    );
    validateUniqueRecords(key, seed.factions, (row) => row?.slug, `Scenario world seed for key "${key}" faction`, code);
    for (const faction of seed.factions) {
      validatePartyReference(
        partySlugs,
        key,
        faction?.party_slug,
        `Scenario world seed for key "${key}" faction "${faction?.slug || "(unknown)"}" must define a valid party_slug.`,
        code
      );
      assertScenario(
        isNonEmptyString(faction?.name),
        key,
        `Scenario world seed for key "${key}" faction "${faction?.slug || "(unknown)"}" must define "name".`,
        code
      );
    }
  }

  const officeGroups = [
    ["officeSpecs.cabinet", seed?.officeSpecs?.cabinet],
    ["officeSpecs.shadow", seed?.officeSpecs?.shadow],
  ];
  for (const [label, rows] of officeGroups) {
    assertScenario(
      Array.isArray(rows) && rows.length > 0,
      key,
      `Scenario world seed for key "${key}" must define a non-empty ${label} array.`,
      code
    );
    validateUniqueRecords(key, rows, (row) => row?.specId, `Scenario world seed for key "${key}" ${label} entry`, code);
    for (const row of rows) {
      assertScenario(
        isNonEmptyString(row?.title),
        key,
        `Scenario world seed for key "${key}" ${label} entry "${row?.specId || "(unknown)"}" must define "title".`,
        code
      );
    }
  }

  assertScenario(
    isPlainObject(seed?.salaryScale),
    key,
    `Scenario world seed for key "${key}" must define "salaryScale".`,
    code
  );
  assertScenario(
    isNonEmptyString(seed.salaryScale?.name),
    key,
    `Scenario world seed for key "${key}" salaryScale must define "name".`,
    code
  );
  validateMonthYear(key, "salaryScale.effectiveFrom", seed.salaryScale?.effectiveFrom, code);
  validateMonthYear(key, "salaryScale.legacyEffectiveFrom", seed.salaryScale?.legacyEffectiveFrom, code);
  assertScenario(
    isPlainObject(seed.salaryScale?.roles) && Object.keys(seed.salaryScale.roles).length > 0,
    key,
    `Scenario world seed for key "${key}" salaryScale.roles must be a non-empty object.`,
    code
  );

  if (seed?.bodies !== undefined) {
    assertScenario(
      isPlainObject(seed.bodies),
      key,
      `Scenario world seed for key "${key}" field "bodies" must be an object when present.`,
      code
    );
    for (const [bodyKey, body] of Object.entries(seed.bodies)) {
      assertScenario(
        isPlainObject(body),
        key,
        `Scenario world seed for key "${key}" body "${bodyKey}" must be an object.`,
        code
      );
      assertScenario(
        isNonEmptyString(body?.id),
        key,
        `Scenario world seed for key "${key}" body "${bodyKey}" must define "id".`,
        code
      );
      assertScenario(
        body.id === bodyKey,
        key,
        `Scenario world seed for key "${key}" body "${bodyKey}" must use a matching "id".`,
        code
      );
      if (body.type !== undefined) {
        assertScenario(
          ALLOWED_BODY_TYPES.has(body.type),
          key,
          `Scenario world seed for key "${key}" body "${bodyKey}" has unsupported type "${body.type}".`,
          code
        );
      }
      if (body.partyBreakdown !== undefined) {
        assertScenario(
          Array.isArray(body.partyBreakdown),
          key,
          `Scenario world seed for key "${key}" body "${bodyKey}" field "partyBreakdown" must be an array when present.`,
          code
        );
      }
      for (const row of body.partyBreakdown || []) {
        validatePartyReference(
          partySlugs,
          key,
          row?.party,
          `Scenario world seed for key "${key}" body "${bodyKey}" partyBreakdown entry must reference a canonical party.`,
          code
        );
      }
      if (body.mayors !== undefined) {
        assertScenario(
          Array.isArray(body.mayors),
          key,
          `Scenario world seed for key "${key}" body "${bodyKey}" field "mayors" must be an array when present.`,
          code
        );
        validateUniqueRecords(
          key,
          body.mayors,
          (row) => row?.id ?? row?.name,
          `Scenario world seed for key "${key}" body "${bodyKey}" mayor`,
          code
        );
      }
    }
  }

  if (seed?.locals !== undefined) {
    assertScenario(
      Array.isArray(seed.locals?.countries),
      key,
      `Scenario world seed for key "${key}" locals.countries must be an array.`,
      code
    );
    validateUniqueRecords(
      key,
      seed.locals.countries,
      (row) => row?.country,
      `Scenario world seed for key "${key}" locals country`,
      code
    );
    for (const country of seed.locals.countries) {
      assertScenario(
        ALLOWED_NATIONS.has(country.country),
        key,
        `Scenario world seed for key "${key}" locals country "${country.country}" is unsupported.`,
        code
      );
      if (country.partyBreakdown !== undefined) {
        assertScenario(
          Array.isArray(country.partyBreakdown),
          key,
          `Scenario world seed for key "${key}" locals country "${country.country}" field "partyBreakdown" must be an array when present.`,
          code
        );
      }
      for (const row of country.partyBreakdown || []) {
        validatePartyReference(
          partySlugs,
          key,
          row?.party,
          `Scenario world seed for key "${key}" locals country "${country.country}" partyBreakdown entry must reference a canonical party.`,
          code
        );
      }
    }
  }

  return seed;
}

export function validateScenarioConstituenciesSeed(seed, manifest, worldSeed) {
  const key = String(manifest?.key || "(unknown)");
  const code = "SCENARIO_CONSTITUENCIES_INVALID_DATA";
  assertScenario(
    isPlainObject(seed),
    key,
    `Scenario constituencies seed for key "${key}" must contain a JSON object at the top level.`,
    code
  );
  assertScenario(
    Array.isArray(seed?.constituencies),
    key,
    `Scenario constituencies seed for key "${key}" must define a "constituencies" array.`,
    code
  );
  const partySlugs = new Set((worldSeed?.canonicalParties || []).map((party) => String(party?.slug || "").trim()).filter(Boolean));
  const seenIds = new Set();
  for (const constituency of seed.constituencies) {
    assertScenario(
      isPlainObject(constituency),
      key,
      `Scenario constituencies seed for key "${key}" entries must be objects.`,
      code
    );
    const id = String(constituency?.id || "").trim();
    assertScenario(id, key, `Scenario constituencies seed for key "${key}" contains a constituency without "id".`, code);
    assertScenario(
      !seenIds.has(id),
      key,
      `Scenario constituencies seed for key "${key}" contains duplicate constituency id "${id}".`,
      code
    );
    seenIds.add(id);
    assertScenario(
      isNonEmptyString(constituency?.name),
      key,
      `Scenario constituencies seed for key "${key}" constituency "${id}" is missing "name".`,
      code
    );
    assertScenario(
      ALLOWED_NATIONS.has(constituency?.nation),
      key,
      `Scenario constituencies seed for key "${key}" constituency "${id}" has unsupported nation "${constituency?.nation}".`,
      code
    );
    assertScenario(
      isNonEmptyString(constituency?.region),
      key,
      `Scenario constituencies seed for key "${key}" constituency "${id}" is missing "region".`,
      code
    );
    validatePartyReference(
      partySlugs,
      key,
      constituency?.party,
      `Scenario constituencies seed for key "${key}" constituency "${id}" must reference a valid canonical party slug.`,
      code
    );
  }
  if (seed?.voteSummary && isPlainObject(seed.voteSummary)) {
    for (const party of Object.keys(seed.voteSummary)) {
      validatePartyReference(
        partySlugs,
        key,
        party,
        `Scenario constituencies seed for key "${key}" voteSummary key must reference a valid canonical party slug.`,
        code
      );
    }
  }
  return seed;
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
    if (!ALLOWED_INHERITANCE_ASSETS.has(asset)) {
      throw buildManifestError(
        key,
        `Scenario manifest for key "${key}" has invalid inheritance key "${asset}". Supported keys: ${Array.from(ALLOWED_INHERITANCE_ASSETS).join(", ")}.`,
        "SCENARIO_MANIFEST_INVALID_INHERITANCE"
      );
    }
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
  assertScenario(
    isPlainObject(manifest),
    normalized,
    `Scenario manifest for key "${normalized}" must contain a JSON object at the top level.`,
    "SCENARIO_MANIFEST_INVALID_DATA"
  );

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
  validateScenarioManifest(manifest, key);

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
  validateScenarioWorldSeed(seed, manifest);

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
  validateScenarioConstituenciesSeed(seed, manifest, loadScenarioWorldSeed(key));

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
