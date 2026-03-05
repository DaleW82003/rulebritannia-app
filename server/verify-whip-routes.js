/**
 * verify-whip-routes.js
 *
 * Lightweight static verification script for the whip-system API routes.
 *
 * Checks that every endpoint expected by the frontend (js/api.js) is
 * registered in server/index.js and that the JSON request/response shapes
 * used by the frontend match what the server handles.
 *
 * Usage (no live server or database required):
 *   cd server
 *   node verify-whip-routes.js
 *
 * Exit code 0 = all checks passed.
 * Exit code 1 = one or more checks failed.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSrc  = readFileSync(resolve(__dir, "index.js"), "utf8");
const clientSrc  = readFileSync(resolve(__dir, "../js/api.js"), "utf8");
const motionSrc  = readFileSync(resolve(__dir, "../js/pages/motion.js"), "utf8");

let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  ✓  ${description}`);
    passed++;
  } else {
    console.error(`  ✗  ${description}`);
    failed++;
  }
}

// ── 1. Route registration ──────────────────────────────────────────────────
console.log("\n[1] Whip-system route registration in server/index.js");

check(
  'POST /api/parties/:partyId/chief-whip is registered',
  serverSrc.includes('app.post("/api/parties/:partyId/chief-whip"'),
);
check(
  'GET /api/divisions/:divisionId/party-instruction/:partySlug is registered',
  serverSrc.includes('app.get("/api/divisions/:divisionId/party-instruction/:partySlug"'),
);
check(
  'POST /api/divisions/:divisionId/party-instruction is registered',
  serverSrc.includes('app.post("/api/divisions/:divisionId/party-instruction"'),
);
check(
  'GET /api/divisions/:divisionId/rebel-request is registered',
  serverSrc.includes('app.get("/api/divisions/:divisionId/rebel-request"'),
);
check(
  'POST /api/divisions/:divisionId/rebel-request is registered',
  serverSrc.includes('app.post("/api/divisions/:divisionId/rebel-request"'),
);
check(
  'POST /api/divisions/:divisionId/rebel-request/:requestId/decide is registered',
  serverSrc.includes('app.post("/api/divisions/:divisionId/rebel-request/:requestId/decide"'),
);

// ── 2. Client API helpers present in js/api.js ────────────────────────────
console.log("\n[2] Client API helpers in js/api.js");

check(
  'apiSetChiefWhip exported from js/api.js',
  clientSrc.includes('export async function apiSetChiefWhip('),
);
check(
  'apiGetPartyInstruction exported from js/api.js',
  clientSrc.includes('export async function apiGetPartyInstruction('),
);
check(
  'apiSetPartyInstruction exported from js/api.js',
  clientSrc.includes('export async function apiSetPartyInstruction('),
);
check(
  'apiGetRebelRequest exported from js/api.js',
  clientSrc.includes('export async function apiGetRebelRequest('),
);
check(
  'apiSubmitRebelRequest exported from js/api.js',
  clientSrc.includes('export async function apiSubmitRebelRequest('),
);
check(
  'apiDecideRebelRequest exported from js/api.js',
  clientSrc.includes('export async function apiDecideRebelRequest('),
);

// ── 3. Request body field names match between client and server ───────────
console.log("\n[3] Request body field name alignment (client ↔ server)");

// POST /api/parties/:partyId/chief-whip  body: { chiefWhipId, deputyWhipId }
check(
  'Client sends chiefWhipId for chief-whip endpoint',
  clientSrc.includes('chiefWhipId'),
);
check(
  'Server reads chiefWhipId from body',
  serverSrc.includes('chiefWhipId'),
);
check(
  'Client sends deputyWhipId for chief-whip endpoint',
  clientSrc.includes('deputyWhipId'),
);
check(
  'Server reads deputyWhipId from body',
  serverSrc.includes('deputyWhipId'),
);

// POST /api/divisions/:divisionId/party-instruction  body: { partySlug, position, whipLevel, note }
check(
  'Client sends partySlug for party-instruction endpoint',
  clientSrc.includes('partySlug'),
);
check(
  'Server reads partySlug from body',
  serverSrc.includes('partySlug'),
);
check(
  'Client sends whipLevel for party-instruction endpoint (motion.js)',
  motionSrc.includes('whipLevel'),
);
check(
  'Server reads whipLevel from body',
  serverSrc.includes('whipLevel'),
);

// POST /api/divisions/:divisionId/rebel-request  body: { requestedVote, message }
check(
  'Client sends requestedVote for rebel-request endpoint',
  clientSrc.includes('requestedVote'),
);
check(
  'Server reads requestedVote from body',
  serverSrc.includes('requestedVote'),
);

// POST /api/divisions/:divisionId/rebel-request/:requestId/decide  body: { status }
check(
  'Client sends status for rebel-request/decide endpoint',
  /apiDecideRebelRequest[^}]+status/.test(clientSrc),
);
check(
  'Server reads status (decision) from body in decide handler',
  serverSrc.includes('status: decision') || serverSrc.includes('{ status: decision }'),
);

// ── 4. Authorization checks present ────────────────────────────────────────
console.log("\n[4] Server-side authorisation checks");

check(
  'chief-whip handler checks party leader or admin/mod',
  serverSrc.includes('Only the party leader (or admin/mod) can assign whips'),
);
check(
  'party-instruction handler checks leader or chief whip',
  serverSrc.includes('Only the party leader or chief whip can set party instructions'),
);
check(
  'rebel-request/decide handler checks leader or chief whip',
  serverSrc.includes('Only the party leader or chief whip can decide rebel requests'),
);

// ── 5. DB tables created in ensureSchema ───────────────────────────────────
console.log("\n[5] Database table definitions in ensureSchema()");

check(
  'division_party_instructions table defined',
  serverSrc.includes('CREATE TABLE IF NOT EXISTS division_party_instructions'),
);
check(
  'division_rebel_requests table defined',
  serverSrc.includes('CREATE TABLE IF NOT EXISTS division_rebel_requests'),
);
check(
  'division_rebellion_log table defined',
  serverSrc.includes('CREATE TABLE IF NOT EXISTS division_rebellion_log'),
);
check(
  'parties.chief_whip_character_id column added',
  serverSrc.includes('ADD COLUMN IF NOT EXISTS chief_whip_character_id'),
);
check(
  'parties.deputy_whip_character_id column added',
  serverSrc.includes('ADD COLUMN IF NOT EXISTS deputy_whip_character_id'),
);

// ── 6. Unique constraint prevents duplicate instructions ───────────────────
console.log("\n[6] Uniqueness constraints");

check(
  'UNIQUE (division_id, party_slug) on division_party_instructions',
  serverSrc.includes('UNIQUE (division_id, party_slug)'),
);
check(
  'ON CONFLICT upsert used for party instructions (no duplicates)',
  serverSrc.includes('ON CONFLICT (division_id, party_slug)'),
);

// ── 7. Division integrity schema facts ─────────────────────────────────────
console.log("\n[7] Division schema integrity (outcome column, UUID id, guards)");

check(
  'divisions.id is UUID PRIMARY KEY (required for any uuid[] cast operations)',
  serverSrc.includes('id          UUID PRIMARY KEY'),
);
check(
  'divisions.outcome TEXT column added via ALTER TABLE … ADD COLUMN IF NOT EXISTS',
  serverSrc.includes("ADD COLUMN IF NOT EXISTS outcome                TEXT"),
);
check(
  'POST /api/admin/close-orphan-motion-divisions is registered',
  serverSrc.includes('app.post("/api/admin/close-orphan-motion-divisions"'),
);
check(
  'Duplicate open-division guard for motions (409) is present',
  serverSrc.includes("An open division already exists for this motion"),
);
check(
  'Motion DELETE closes open divisions before deletion',
  serverSrc.includes("DELETE FROM motions WHERE id = $1") &&
  serverSrc.includes("entity_type = 'motion' AND entity_id = $1 AND status = 'open'"),
);
check(
  'apiAdminCloseOrphanMotionDivisions exported in api.js',
  clientSrc.includes('apiAdminCloseOrphanMotionDivisions'),
);

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error("\nSome checks failed — review the output above.\n");
  process.exit(1);
} else {
  console.log("\nAll checks passed.\n");
}
