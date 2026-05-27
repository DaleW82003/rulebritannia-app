import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadScenarioManifest,
  loadScenarioWorldSeed,
  loadScenarioConstituenciesSeed,
  mergeScenarioSeedData,
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
