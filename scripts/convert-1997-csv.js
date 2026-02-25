#!/usr/bin/env node
/**
 * scripts/convert-1997-csv.js
 *
 * Converts data/1997_structured.csv into data/constituencies_1997.json
 * which is consumed by the server's POST /api/admin/constituencies/initialize-1997 route.
 *
 * Usage:
 *   node scripts/convert-1997-csv.js
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const CSV_PATH  = resolve(ROOT, "data", "1997_structured.csv");
const OUT_PATH  = resolve(ROOT, "data", "constituencies_1997.json");

// ── Party normalisation rules ─────────────────────────────────────────────────
// Canonical name for the party with the accented é.  Any ASCII/mojibake variant
// found in older CSVs or copy-paste from Windows-1252 is mapped here.
const PARTY_MAP = {
  "Sinn Fein":    "Sinn Féin",   // ASCII variant (no accent)
  "Sinn F\xe9in": "Sinn Féin",   // Latin-1 byte still present after bad decode
  "Sinn F?in":    "Sinn Féin",   // mojibake / question-mark replacement
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
    .replace(/['']/g, "")        // remove smart/straight apostrophes
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric → dash
    .replace(/^-+|-+$/g, "");    // trim leading/trailing dashes
}

// ── Minimal CSV parser (handles quoted fields) ────────────────────────────────
function parseCsv(text) {
  const lines  = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  return lines.slice(1).map(line => {
    const values = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { values.push(cur); cur = ""; continue; }
      cur += ch;
    }
    values.push(cur);
    return Object.fromEntries(header.map((h, i) => [h.trim(), (values[i] ?? "").trim()]));
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
const raw    = readFileSync(CSV_PATH, "utf8");
const rows   = parseCsv(raw);

const constituencies = [];
const voteSummary    = {};
const seatBreakdown  = {};   // from seat_breakdown rows — used for validation
let   electorate     = 0;
let   turnoutTotal   = 0;

for (const row of rows) {
  switch (row.record_type) {
    case "constituency_result": {
      const party = normaliseParty(row.party);
      const { nation, region } = resolveNationRegion(row.region);
      const name = row.constituency.trim();
      constituencies.push({
        id:     toSlug(name),
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
        seats:    parseInt(row.seats,   10) || 0,
        votes:    parseInt(row.votes,   10) || 0,
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
      electorate   = parseInt(row.electorate,    10) || 0;
      turnoutTotal = parseInt(row.turnout_total, 10) || 0;
      break;
    }
    default:
      break;
  }
}

// The 1997 UK general election used 659 constituencies.
const EXPECTED_SEATS = 659;

if (constituencies.length !== EXPECTED_SEATS) {
  console.error(
    `ERROR: Expected exactly ${EXPECTED_SEATS} constituency_result rows, got ${constituencies.length}.` +
    " Fix data/1997_structured.csv and re-run this script."
  );
  process.exit(1);
}

// Cross-check: constituency_result counts must match seat_breakdown where provided.
if (Object.keys(seatBreakdown).length > 0) {
  const derived = {};
  for (const c of constituencies) {
    derived[c.party] = (derived[c.party] || 0) + 1;
  }
  let mismatch = false;
  for (const [party, expected] of Object.entries(seatBreakdown)) {
    if (expected > 0 && derived[party] !== expected) {
      console.error(
        `ERROR: seat_breakdown mismatch for "${party}": CSV says ${expected}, derived ${derived[party] ?? 0}.`
      );
      mismatch = true;
    }
  }
  if (mismatch) {
    console.error("Fix data/1997_structured.csv and re-run this script.");
    process.exit(1);
  }
}

const output = {
  generatedAt:    new Date().toISOString(),
  constituencies,
  voteSummary,
  electorate,
  turnoutTotal,
};

writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), "utf8");
console.log(`✓ Wrote ${constituencies.length} constituencies to ${OUT_PATH}`);
console.log("  Parties:", Object.entries(voteSummary).map(([p, v]) => `${p}:${v.seats}`).join(", "));
