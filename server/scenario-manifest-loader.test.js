import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadScenarioManifest,
  loadScenarioWorldSeed,
  loadScenarioConstituenciesSeed,
  mergeScenarioSeedData,
  validateScenarioManifest,
  validateScenarioWorldSeed,
  validateScenarioConstituenciesSeed,
} from "./scenario-manifest-loader.js";

test("2015-beta manifest declares 1997 as its parent scenario", () => {
  const manifest = loadScenarioManifest("2015-beta");
  assert.equal(manifest.parentScenario, "1997");
  assert.equal(manifest.inheritance.constituencies, "replace");
  assert.equal(manifest.status, "beta");
});

test("2015-beta world seed inherits omitted domains and overrides selected ones", () => {
  const seed = loadScenarioWorldSeed("2015-beta");
  assert.equal(seed.salaryScale.name, "2015 IPSA Baseline (Approximate)");
  assert.equal(seed.salaryScale.effectiveFrom.year, 2015);
  assert.equal(seed.officeSpecs.cabinet.find((row) => row.specId === "trade")?.title, "Secretary of State for Business, Innovation and Skills");
  assert.equal(seed.budget.lastYear.gdp, 1930);
});

test("2015-beta constituencies stay child-owned when inheritance mode is replace", () => {
  const seed = loadScenarioConstituenciesSeed("2015-beta");
  assert.deepEqual(seed.constituencies, []);
});

test("mergeScenarioSeedData merges keyed constituency overrides by record id", () => {
  const merged = mergeScenarioSeedData(
    {
      constituencies: [
        { id: "seat-a", name: "Seat A", party: "Labour", region: "North West", mpName: "A. Example" },
      ],
      voteSummary: {
        Labour: { seats: 1, votes: 1000, vote_pct: 50 },
      },
      electorate: 2000,
    },
    {
      constituencies: [
        { id: "seat-a", party: "Conservative" },
        { id: "seat-b", name: "Seat B", party: "Liberal Democrat", region: "South West" },
      ],
      voteSummary: {
        Conservative: { seats: 1, votes: 1200, vote_pct: 60 },
      },
      turnoutTotal: 1500,
    }
  );

  assert.equal(merged.constituencies.length, 2);
  assert.deepEqual(merged.constituencies[0], {
    id: "seat-a",
    name: "Seat A",
    party: "Conservative",
    region: "North West",
    mpName: "A. Example",
  });
  assert.equal(merged.voteSummary.Labour.seats, 1);
  assert.equal(merged.voteSummary.Conservative.votes, 1200);
  assert.equal(merged.electorate, 2000);
  assert.equal(merged.turnoutTotal, 1500);
});

test("mergeScenarioSeedData replaces arrays without explicit record-merge rules", () => {
  const merged = mergeScenarioSeedData(
    { events: [{ id: "baseline-event", status: "queued" }] },
    { events: [{ id: "child-event", status: "queued" }] }
  );
  assert.deepEqual(merged.events, [{ id: "child-event", status: "queued" }]);
});

test("validateScenarioManifest rejects missing required metadata and unsupported inheritance keys", () => {
  assert.throws(
    () => validateScenarioManifest({
      key: "bad-scenario",
      description: "Missing title",
      startDate: { month: 5, year: 2015 },
      clockDefault: { month: 8, year: 2015 },
      status: "beta",
      electionCsvFile: "assets/2015-beta_structured.csv",
      worldSeedFile: "data/scenarios/1997/world-seed.json",
      constituenciesFile: "data/scenarios/2015-beta/constituencies.json",
      expectedConstituencyCount: 650,
      playableParties: ["Conservative"],
    }, "bad-scenario"),
    (err) => err?.code === "SCENARIO_MANIFEST_INVALID_DATA" && /title/.test(err.message)
  );

  assert.throws(
    () => validateScenarioManifest({
      key: "bad-scenario",
      title: "Bad Scenario",
      description: "Invalid inheritance key",
      startDate: { month: 5, year: 2015 },
      clockDefault: { month: 8, year: 2015 },
      status: "beta",
      parentScenario: "1997",
      inheritance: { events: "merge" },
      electionCsvFile: "assets/2015-beta_structured.csv",
      worldSeedFile: "data/scenarios/1997/world-seed.json",
      constituenciesFile: "data/scenarios/2015-beta/constituencies.json",
      expectedConstituencyCount: 650,
      playableParties: ["Conservative"],
    }, "bad-scenario"),
    (err) => err?.code === "SCENARIO_MANIFEST_INVALID_INHERITANCE"
  );
});

test("validateScenarioWorldSeed rejects invalid party references and missing required ids", () => {
  const manifest = loadScenarioManifest("1997");
  assert.throws(
    () => validateScenarioWorldSeed({
      canonicalParties: [
        { slug: "Conservative", name: "Conservative" },
      ],
      officeSpecs: {
        cabinet: [{ specId: "prime-minister", title: "Prime Minister" }],
        shadow: [{ specId: "leader-opposition", title: "Leader of the Opposition" }],
      },
      salaryScale: {
        name: "Test",
        effectiveFrom: { month: 1, year: 1997 },
        legacyEffectiveFrom: { month: 8, year: 1997 },
        roles: { backbencher: 1 },
      },
      factions: [{ slug: "mystery", name: "Mystery", party_slug: "Unknown Party" }],
    }, { ...manifest, playableParties: ["Conservative"] }),
    (err) => err?.code === "SCENARIO_WORLD_SEED_INVALID_DATA" && /Unknown Party/.test(err.message)
  );

  assert.throws(
    () => validateScenarioWorldSeed({
      canonicalParties: [
        { slug: "Conservative", name: "Conservative" },
      ],
      officeSpecs: {
        cabinet: [{ title: "Prime Minister" }],
        shadow: [{ specId: "leader-opposition", title: "Leader of the Opposition" }],
      },
      salaryScale: {
        name: "Test",
        effectiveFrom: { month: 1, year: 1997 },
        legacyEffectiveFrom: { month: 8, year: 1997 },
        roles: { backbencher: 1 },
      },
    }, { ...manifest, playableParties: ["Conservative"] }),
    (err) => err?.code === "SCENARIO_WORLD_SEED_INVALID_DATA" && /identifier/.test(err.message)
  );
});

test("validateScenarioConstituenciesSeed rejects invalid constituency ids and party references", () => {
  const manifest = loadScenarioManifest("1997");
  const worldSeed = loadScenarioWorldSeed("1997");

  assert.throws(
    () => validateScenarioConstituenciesSeed({
      constituencies: [
        { id: "", name: "Seat A", nation: "England", region: "London", party: "Labour" },
      ],
    }, manifest, worldSeed),
    (err) => err?.code === "SCENARIO_CONSTITUENCIES_INVALID_DATA" && /without "id"/.test(err.message)
  );

  assert.throws(
    () => validateScenarioConstituenciesSeed({
      constituencies: [
        { id: "seat-a", name: "Seat A", nation: "England", region: "London", party: "Not A Party" },
      ],
    }, manifest, worldSeed),
    (err) => err?.code === "SCENARIO_CONSTITUENCIES_INVALID_DATA" && /Not A Party/.test(err.message)
  );
});
