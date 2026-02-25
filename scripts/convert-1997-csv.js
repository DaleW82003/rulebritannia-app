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
const PARTY_MAP = {
  "Sinn Fein":   "Sinn Féin",
  "UK Unionist": "Independents",
  "Independent": "Independents",
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
    case "overall_total": {
      electorate   = parseInt(row.electorate,    10) || 0;
      turnoutTotal = parseInt(row.turnout_total, 10) || 0;
      break;
    }
    default:
      break;
  }
}

if (constituencies.length !== 650) {
  console.error(
    `ERROR: Expected exactly 650 constituency_result rows, got ${constituencies.length}.` +
    " Fix data/1997_structured.csv and re-run this script."
  );
  process.exit(1);
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
