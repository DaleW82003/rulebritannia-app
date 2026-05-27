#!/usr/bin/env node
/**
 * scripts/convert-scenario-csv.js
 *
 * Converts a scenario's structured election CSV into the scenario's committed
 * constituencies JSON dataset. Input/output paths and validation rules come
 * from data/scenarios/<key>/manifest.json.
 *
 * Usage:
 *   node scripts/convert-scenario-csv.js
 *   node scripts/convert-scenario-csv.js 1997
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { loadScenarioManifest, resolveManifestPath, getDefaultScenarioKey } from "../server/scenario-manifest-loader.js";

// ── Party normalisation rules ─────────────────────────────────────────────────
// Canonical name for the party with the accented é.  Any ASCII/mojibake variant
// found in older CSVs or copy-paste from Windows-1252 is mapped here.
const PARTY_MAP = {
  "Sinn Fein":    "Sinn Féin",    // ASCII variant (no accent)
  "Sinn F\xe9in": "Sinn Féin",    // Latin-1 byte still present after bad decode
  "Sinn F?in":    "Sinn Féin",    // mojibake / question-mark replacement
  "UK Unionist":  "Independents", // Robert McCartney (North Down) treated as independent
  "Independent":  "Independents",
};

function normaliseParty(raw) {
  const trimmed = (raw || "").trim();
  return PARTY_MAP[trimmed] ?? trimmed;
}

// ── Nation/region rules ───────────────────────────────────────────────────────
const DEVOLVED_REGIONS = new Set(["Scotland", "Wales", "Northern Ireland"]);

function resolveNationRegion(csvRegion) {
  if (DEVOLVED_REGIONS.has(csvRegion)) {
    return { nation: csvRegion, region: csvRegion };
  }
  return { nation: "England", region: csvRegion };
}

// ── Slug helper ───────────────────────────────────────────────────────────────
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Minimal CSV parser (handles quoted fields) ────────────────────────────────
function parseCsv(text) {
  const lines  = text.split(/\r?\n/).filter(l => l && !/^\s*#/.test(l));
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\"") {
        inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        values.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    values.push(cur);
    return Object.fromEntries(header.map((h, i) => [h.trim(), (values[i] ?? "").trim()]));
  });
}

function readScenarioCsvText(csvPath) {
  const raw = readFileSync(csvPath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder("latin1").decode(raw);
  }
}

function getScenarioConstituencySeedConfig(scenarioKey = getDefaultScenarioKey()) {
  const manifest = loadScenarioManifest(scenarioKey);
  if (!manifest?.electionCsvFile) {
    const err = new Error(`Scenario manifest for key "${scenarioKey}" is missing required field "electionCsvFile".`);
    err.code = "SCENARIO_MANIFEST_MISSING_FIELD";
    throw err;
  }
  if (!manifest?.constituenciesFile) {
    const err = new Error(`Scenario manifest for key "${scenarioKey}" is missing required field "constituenciesFile".`);
    err.code = "SCENARIO_MANIFEST_MISSING_FIELD";
    throw err;
  }
  if (!Number.isInteger(manifest?.expectedConstituencyCount) || manifest.expectedConstituencyCount <= 0) {
    const err = new Error(`Scenario manifest for key "${scenarioKey}" is missing a valid numeric "expectedConstituencyCount".`);
    err.code = "SCENARIO_MANIFEST_MISSING_FIELD";
    throw err;
  }
  return {
    scenarioKey,
    csvPath: resolveManifestPath(manifest.electionCsvFile),
    outPath: resolveManifestPath(manifest.constituenciesFile),
    expectedSeats: manifest.expectedConstituencyCount,
  };
}

export function convertScenarioCsvToConstituencies(scenarioKey = getDefaultScenarioKey()) {
  const { csvPath, outPath, expectedSeats } = getScenarioConstituencySeedConfig(scenarioKey);
  const raw = readScenarioCsvText(csvPath);
  const rows = parseCsv(raw);

  const constituencies = [];
  const voteSummary = {};
  const seatBreakdown = {};
  let electorate = 0;
  let turnoutTotal = 0;

  for (const row of rows) {
    switch (row.record_type) {
      case "constituency_result": {
        const party = normaliseParty(row.party);
        const { nation, region } = resolveNationRegion(row.region);
        const name = row.constituency.trim();
        constituencies.push({
          id: toSlug(name),
          name,
          nation,
          region,
          party,
          mpType: "",
          mpName: "",
        });
        break;
      }
      case "vote_summary": {
        const party = normaliseParty(row.party);
        voteSummary[party] = {
          seats: parseInt(row.seats, 10) || 0,
          votes: parseInt(row.votes, 10) || 0,
          vote_pct: parseFloat(row.vote_pct) || 0,
        };
        break;
      }
      case "seat_breakdown": {
        const party = normaliseParty(row.party);
        seatBreakdown[party] = (seatBreakdown[party] || 0) + (parseInt(row.seats, 10) || 0);
        break;
      }
      case "overall_total": {
        electorate = parseInt(row.electorate, 10) || 0;
        turnoutTotal = parseInt(row.turnout_total, 10) || 0;
        break;
      }
      default:
        break;
    }
  }

  if (constituencies.length !== expectedSeats) {
    console.error(
      `ERROR: Scenario "${scenarioKey}" expected exactly ${expectedSeats} constituency_result rows, got ${constituencies.length}.` +
      ` Fix ${csvPath} and re-run this script.`
    );
    process.exit(1);
  }

  if (Object.keys(seatBreakdown).length > 0) {
    const derived = {};
    for (const c of constituencies) {
      derived[c.party] = (derived[c.party] || 0) + 1;
    }
    let mismatch = false;
    for (const [party, expected] of Object.entries(seatBreakdown)) {
      if (expected > 0 && derived[party] !== expected) {
        console.error(
          `ERROR: seat_breakdown mismatch for "${party}" in scenario "${scenarioKey}": ` +
          `CSV says ${expected}, derived ${derived[party] ?? 0}.`
        );
        mismatch = true;
      }
    }
    if (mismatch) {
      console.error(`Fix ${csvPath} and re-run this script.`);
      process.exit(1);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    constituencies,
    voteSummary,
    electorate,
    turnoutTotal,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`✓ Wrote ${constituencies.length} constituencies for scenario "${scenarioKey}" to ${outPath}`);
  console.log("  Parties:", Object.entries(voteSummary).map(([p, v]) => `${p}:${v.seats}`).join(", "));

  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const scenarioKey = (process.argv[2] || getDefaultScenarioKey()).trim() || getDefaultScenarioKey();
  convertScenarioCsvToConstituencies(scenarioKey);
}
