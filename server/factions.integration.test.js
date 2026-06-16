/**
 * Integration tests: party faction management and political-state flow.
 *
 * Covers the end-to-end pathway:
 *   create/seed faction → change allocation (admin/mod pathway)
 *   → faction climate/internal-power recompute
 *   → party-facing state read
 *   → character political state reflects climate change
 *
 * Each test uses the real Express application, a real PostgreSQL database
 * (test schema created/dropped once for the suite), and Node's built-in fetch
 * exercising actual HTTP routes.
 *
 * Design notes:
 *  - Three shared users (admin, mod, regular) are created once in before() to
 *    minimise login requests and stay under the auth rate-limit (20 / 15 min).
 *  - Unique slugs / IDs are used per test to prevent interference.
 *  - Unauthenticated mutation tests receive 403 (CSRF check fires before auth).
 *
 * Run with:
 *   NODE_ENV=test \
 *   DATABASE_URL=postgresql://rb_test_user:rb_test_pw@localhost:5432/rb_test \
 *   SESSION_SECRET=test-secret \
 *   node --test server/factions.integration.test.js
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import {
  createTestSchema,
  dropTestSchema,
  seedUserAndCharacter,
  seedConstituencies,
  seedFaction,
  startTestServer,
  TestClient,
} from "./test-helpers.js";
import { app } from "./index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Global setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let baseUrl;
let closeServer;

// Shared logged-in clients (created once in before() to stay under auth rate limit).
let adminClient;
let modClient;
let regularClient;
let labourMemberClient;

before(async () => {
  await createTestSchema();
  const started = await startTestServer(app);
  baseUrl     = started.baseUrl;
  closeServer = started.close;

  // Create shared users — 4 logins total, well under the 20 / 15 min auth limit.
  const adminUser   = await seedUserAndCharacter({ roles: ["admin"], party: "Labour" });
  const modUser     = await seedUserAndCharacter({ roles: ["mod"],   party: "Labour" });
  const regularUser = await seedUserAndCharacter({ roles: [],        party: "Labour" });
  const labourUser  = await seedUserAndCharacter({ roles: [],        party: "Labour" });

  adminClient        = new TestClient(baseUrl);
  modClient          = new TestClient(baseUrl);
  regularClient      = new TestClient(baseUrl);
  labourMemberClient = new TestClient(baseUrl);

  await adminClient.login(adminUser.email, adminUser.password);
  await modClient.login(modUser.email, modUser.password);
  await regularClient.login(regularUser.email, regularUser.password);
  await labourMemberClient.login(labourUser.email, labourUser.password);
});

after(async () => {
  if (typeof closeServer === "function") {
    try { await closeServer(); } catch { /* ignore */ }
  }
  try { await dropTestSchema(); } catch { /* ignore */ }
  await pool.end();
});

/** Fresh unauthenticated client (no session). */
function anonClient() { return new TestClient(baseUrl); }

// ═════════════════════════════════════════════════════════════════════════════
// 1. Faction creation — admin pathway
// ═════════════════════════════════════════════════════════════════════════════

test("FACTION CREATION: admin can create a faction for a playable party", async () => {
  const slug = `test-left-${Date.now()}`;
  const { status, body } = await adminClient.post("/api/admin/parties/Labour/factions", {
    name:                "Test Left",
    slug,
    description:         "Integration test faction",
    colour:              "#cc0000",
    ideologyTags:        ["left", "test"],
    leadershipAlignment: "hostile",
    rebellionBias:       0.6,
    displayOrder:        99,
    active:              true,
  });

  assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.ok,  "ok flag should be true");
  assert.ok(body.id,  "id should be returned");

  // Verify the faction and its allocation row exist in DB
  const { rows: fRows } = await pool.query(
    "SELECT * FROM party_factions WHERE id = $1", [body.id]
  );
  assert.equal(fRows.length,                 1,        "faction row must exist");
  assert.equal(fRows[0].party_slug,          "Labour", "party_slug mismatch");
  assert.equal(fRows[0].slug,                slug);
  assert.equal(fRows[0].leadership_alignment,"hostile");

  const { rows: aRows } = await pool.query(
    "SELECT * FROM party_faction_allocations WHERE faction_id = $1", [body.id]
  );
  assert.equal(aRows.length,       1, "allocation row must be auto-created");
  assert.equal(aRows[0].mp_count,  0, "default mp_count must be 0");
});

test("FACTION CREATION: slug is normalised to lowercase-hyphen form", async () => {
  const { status, body } = await adminClient.post("/api/admin/parties/Conservative/factions", {
    name:                "One Nation Test",
    slug:                "One Nation Test!!",
    leadershipAlignment: "aligned",
  });

  assert.equal(status, 201, `Expected 201: ${JSON.stringify(body)}`);

  const { rows } = await pool.query(
    "SELECT slug FROM party_factions WHERE id = $1", [body.id]
  );
  assert.equal(rows[0].slug, "one-nation-test", "slug must be normalised");
});

test("FACTION CREATION: returns 409 for duplicate slug within same party", async () => {
  const uniqueSlug = `dup-test-${Date.now()}`;

  await adminClient.post("/api/admin/parties/Labour/factions", { name: "First", slug: uniqueSlug });
  const { status, body } = await adminClient.post("/api/admin/parties/Labour/factions", {
    name: "Second",
    slug: uniqueSlug,
  });

  assert.equal(status, 409, "duplicate slug within same party must return 409");
  assert.ok(body.error, "error message must be present");
});

test("FACTION CREATION: rejects unsupported party slug", async () => {
  const { status } = await adminClient.post("/api/admin/parties/Plaid Cymru/factions", {
    name: "Test",
    slug: "test",
  });

  assert.equal(status, 400, "non-playable party should return 400");
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Faction allocation update and constraint validation
// ═════════════════════════════════════════════════════════════════════════════

test("ALLOCATION: admin can update faction mp_count within party MP ceiling", async () => {
  await seedConstituencies("Labour", 50);
  const { factionId } = await seedFaction({ partySlug: "Labour", mpCount: 0 });

  const { status, body } = await adminClient.patch(`/api/admin/factions/${factionId}/allocation`, {
    mpCount: 30,
    influenceBonus: 1.0,
    notes: "Integration test allocation",
  });

  assert.equal(status, 200, `Expected 200: ${JSON.stringify(body)}`);
  assert.ok(body.ok,               "ok flag should be true");
  assert.ok(body.totalMPs  >= 50,  "totalMPs must include seeded constituencies");
  assert.ok(body.allocatedMPs >= 30, "allocatedMPs must reflect the new value");
  assert.equal(body.recompute?.type, "faction-political-state");
  assert.equal(body.recompute?.status, "deferred");
  assert.equal(body.recompute?.staleReadWindow, "until-next-freeze");

  const { rows } = await pool.query(
    "SELECT mp_count, influence_bonus FROM party_faction_allocations WHERE faction_id = $1",
    [factionId]
  );
  assert.equal(rows.length,              1,   "allocation row must exist");
  assert.equal(Number(rows[0].mp_count), 30,  "mp_count must be updated in DB");
  assert.equal(Number(rows[0].influence_bonus), 1.0, "influence_bonus must be updated in DB");
});

test("ALLOCATION: rejects allocation that would exceed party MP ceiling", async () => {
  await seedConstituencies("Conservative", 20);
  const { factionId } = await seedFaction({ partySlug: "Conservative", mpCount: 0 });

  const { status, body } = await adminClient.patch(`/api/admin/factions/${factionId}/allocation`, {
    mpCount: 999,
  });

  assert.equal(status, 400,             "over-allocation must return 400");
  assert.ok(body.error,                 "error message must be present");
  assert.ok(body.totalMPs  != null,     "totalMPs must be in error payload");
  assert.ok(body.remainingMPs != null,  "remainingMPs must be in error payload");
  assert.ok(body.totalMPs < 999,        "totalMPs must be less than proposed 999");
});

test("ALLOCATION: two factions combined cannot exceed party MP ceiling", async () => {
  await seedConstituencies("Labour", 40);
  const { factionId: f1 } = await seedFaction({ partySlug: "Labour", mpCount: 25 });
  const { factionId: f2 } = await seedFaction({ partySlug: "Labour", mpCount: 0 });

  // Read current remaining capacity for Labour
  const { body: listBody } = await adminClient.get("/api/admin/parties/Labour/factions");
  const remaining = listBody.remainingMPs;

  // One over the remaining capacity must fail
  const { status: overStatus } = await adminClient.patch(`/api/admin/factions/${f2}/allocation`, {
    mpCount: remaining + 1,
  });
  assert.equal(overStatus, 400, "allocation exceeding ceiling must return 400");

  // Exactly at the remaining capacity must succeed
  const { status: okStatus } = await adminClient.patch(`/api/admin/factions/${f2}/allocation`, {
    mpCount: remaining,
  });
  assert.equal(okStatus, 200, "allocation at exactly the ceiling should succeed");
});

test("ALLOCATION: rejects negative mp_count", async () => {
  const { factionId } = await seedFaction({ partySlug: "Labour" });

  const { status } = await adminClient.patch(`/api/admin/factions/${factionId}/allocation`, {
    mpCount: -5,
  });

  assert.equal(status, 400, "negative mp_count must return 400");
});

test("ALLOCATION: returns 404 for non-existent faction id", async () => {
  const fakeId = "00000000-0000-0000-0000-000000000000";

  const { status } = await adminClient.patch(`/api/admin/factions/${fakeId}/allocation`, {
    mpCount: 5,
  });

  assert.equal(status, 404, "unknown faction should return 404");
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Faction climate recompute — allocation change flows into GET climate
// ═════════════════════════════════════════════════════════════════════════════

test("CLIMATE RECOMPUTE: faction climate reflects allocation change for Labour", async () => {
  await seedConstituencies("Labour", 100);

  const { factionId: hostileId } = await seedFaction({
    partySlug: "Labour",
    mpCount: 0,
    leadershipAlignment: "hostile",
    rebellionBias: 0.7,
  });
  const { factionId: alignedId } = await seedFaction({
    partySlug: "Labour",
    mpCount: 0,
    leadershipAlignment: "aligned",
    rebellionBias: 0.05,
  });

  // Give hostile faction 50 MPs → leadership_pressure = clamp(40 × 1.2) = 48
  await adminClient.patch(`/api/admin/factions/${hostileId}/allocation`, { mpCount: 50 });
  // Give aligned faction 40 MPs → leadership_pressure = clamp(32 × 0.1) ≈ 3.2
  await adminClient.patch(`/api/admin/factions/${alignedId}/allocation`, { mpCount: 40 });

  const { status, body } = await regularClient.get("/api/parties/Labour/faction-climate");
  assert.equal(status, 200, `Expected 200: ${JSON.stringify(body)}`);
  assert.ok(body.ok, "ok flag must be true");

  const climate = body.climate;
  assert.ok(climate.factions.length >= 2, "climate must list at least 2 factions");
  assert.ok(typeof climate.climateScore === "number",  "climateScore must be numeric");
  assert.ok(typeof climate.climateLabel === "string",  "climateLabel must be a string");
  assert.ok(
    ["unified", "stable", "tense", "fractious"].includes(climate.climateLabel),
    `climateLabel must be a valid value, got: ${climate.climateLabel}`
  );
  assert.ok(typeof climate.partyPressureModifier  === "number", "partyPressureModifier must be numeric");
  assert.ok(typeof climate.capitalResilienceBonus === "number", "capitalResilienceBonus must be numeric");
  assert.equal(body.recomputeRead?.type, "faction-political-state");
  assert.equal(body.recomputeRead?.source, "last-completed-freeze");
  assert.ok(climate.hostilePressure > 0,           "hostile faction MPs must produce hostile pressure");
  assert.ok(climate.partyPressureModifier > 0,     "partyPressureModifier must be > 0 after hostile allocation");
});

test("CLIMATE RECOMPUTE: faction climate endpoint rejects non-playable party", async () => {
  const { status } = await regularClient.get("/api/parties/Green/faction-climate");
  assert.equal(status, 400, "non-playable party slug must return 400");
});


test("CLIMATE DEBUG: staff can request debug payload and members cannot", async () => {
  await pool.query(
    `INSERT INTO bodies_data (id, data, sort_order)
     VALUES
       ('house-of-lords', $1::jsonb, 1),
       ('european-parliament', $2::jsonb, 2),
       ('directly-elected-mayors', $3::jsonb, 3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [
      JSON.stringify({ id: 'house-of-lords', title: 'House of Lords', visible: true, partyBreakdown: [{ party: 'Labour', seats: 100 }] }),
      JSON.stringify({ id: 'european-parliament', title: 'European Parliament', visible: true, partyBreakdown: [{ party: 'Labour', seats: 20 }] }),
      JSON.stringify({ id: 'directly-elected-mayors', title: 'Directly Elected Mayors', visible: true, mayors: [{ party: 'Labour' }] }),
    ]
  );
  await pool.query(
    `INSERT INTO app_config (key, value) VALUES ('locals_data', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ countries: [
      { country: 'England', partyBreakdown: [{ party: 'Labour', councillors: 10 }] },
      { country: 'Scotland', partyBreakdown: [{ party: 'Labour', councillors: 5 }] },
      { country: 'Wales', partyBreakdown: [{ party: 'Labour', councillors: 3 }] },
      { country: 'Northern Ireland', partyBreakdown: [{ party: 'Labour', councillors: 2 }] },
    ] })]
  );

  const { factionId } = await seedFaction({ partySlug: "Labour", mpCount: 5, leadershipAlignment: "aligned" });
  await pool.query(
    `INSERT INTO other_officials_faction_allocations (arena_type, arena_id, party_slug, faction_id, official_count, updated_by)
     VALUES ('locals', 'locals_uk', 'Labour', $1, 20, 'test')
     ON CONFLICT (arena_type, arena_id, party_slug, faction_id)
     DO UPDATE SET official_count = EXCLUDED.official_count`,
    [factionId]
  );

  const staffRes = await adminClient.get('/api/parties/Labour/faction-climate?debug=1');
  assert.equal(staffRes.status, 200, `Expected 200: ${JSON.stringify(staffRes.body)}`);
  assert.ok(staffRes.body?.climate?.debug, 'debug payload must be present for staff');
  assert.equal(staffRes.body.climate.debug.computed.locals_total, 20, 'locals total should be UK-wide sum');
  assert.deepEqual(
    staffRes.body.climate.debug.arenasIncluded,
    { commons: ['commons'], bodies: ['lords', 'europarl'], locals: ['locals_uk'], dem: ['dem_uk'] },
    'debug payload should report canonical included arenas'
  );
  assert.equal(staffRes.body.climate.debug.computed.commons_total, 100, 'commons total should be included in debug computed fields');
  assert.equal(staffRes.body.climate.debug.computed.dominanceApplied, true, 'dominance should apply when aligned faction dominates active arenas');

  const memberRes = await regularClient.get('/api/parties/Labour/faction-climate?debug=1');
  assert.equal(memberRes.status, 403, 'non-staff debug request must be forbidden');
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Party-facing faction list
// ═════════════════════════════════════════════════════════════════════════════

test("PARTY-FACING LIST: authenticated player can list active factions for playable party", async () => {
  await seedConstituencies("Conservative", 30);
  await seedFaction({ partySlug: "Conservative", mpCount: 10, leadershipAlignment: "aligned" });
  await seedFaction({ partySlug: "Conservative", mpCount: 5,  leadershipAlignment: "hostile" });

  const { status, body } = await regularClient.get("/api/parties/Conservative/factions");

  assert.equal(status, 200, `Expected 200: ${JSON.stringify(body)}`);
  assert.ok(Array.isArray(body.factions),     "factions must be an array");
  assert.ok(body.factions.length >= 2,        "at least 2 factions should be listed");

  const f = body.factions[0];
  assert.ok(f.id,           "id must be present");
  assert.ok(f.name,         "name must be present");
  assert.ok(f.slug,         "slug must be present");
  assert.ok(f.mpCount != null, "mpCount must be present");
  assert.equal(body.recomputeRead?.type, "faction-political-state");
  assert.ok(typeof body.recomputeRead?.mayBeStale === "boolean", "recomputeRead.mayBeStale should be boolean");
  // Admin-only fields must not appear in the player-facing response
  assert.equal(f.leadershipAlignment, undefined, "leadershipAlignment must NOT be in player-facing list");
  assert.equal(f.rebellionBias,       undefined, "rebellionBias must NOT be in player-facing list");
});

test("PARTY-FACING LIST: inactive factions are excluded", async () => {
  const { factionId } = await seedFaction({ partySlug: "Labour", mpCount: 0 });
  await pool.query("UPDATE party_factions SET active = FALSE WHERE id = $1", [factionId]);

  const { body } = await regularClient.get("/api/parties/Labour/factions");

  const listed = body.factions ?? [];
  const hasInactive = listed.some((f) => f.id === factionId);
  assert.equal(hasInactive, false, "inactive faction must not appear in player-facing list");

  // Restore for cleanliness
  await pool.query("UPDATE party_factions SET active = TRUE WHERE id = $1", [factionId]);
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Admin faction list includes hidden fields and totals
// ═════════════════════════════════════════════════════════════════════════════

test("ADMIN LIST: includes leadershipAlignment, rebellionBias, and MP totals", async () => {
  await seedConstituencies("Liberal Democrat", 20);
  await seedFaction({
    partySlug: "Liberal Democrat",
    mpCount: 10,
    leadershipAlignment: "neutral",
    rebellionBias: 0.3,
  });

  const { status, body } = await adminClient.get("/api/admin/parties/Liberal Democrat/factions");

  assert.equal(status, 200, `Expected 200: ${JSON.stringify(body)}`);
  assert.ok(Array.isArray(body.factions),  "factions must be an array");
  assert.ok(body.totalMPs   != null,       "totalMPs must be present");
  assert.ok(body.allocatedMPs != null,     "allocatedMPs must be present");
  assert.ok(body.remainingMPs != null,     "remainingMPs must be present");

  const f = body.factions.find((x) => x.leadershipAlignment === "neutral");
  assert.ok(f,                          "admin list must include a faction with leadershipAlignment");
  assert.ok(f.rebellionBias != null,    "admin list must include rebellionBias field");
  assert.equal(f.mpCount, 10,           "mpCount must match seeded value");
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Character political state reflects faction climate
// ═════════════════════════════════════════════════════════════════════════════

test("CHARACTER POLITICAL STATE: capital_resilience_bonus appears when aligned faction has MPs", async () => {
  await seedConstituencies("Labour", 60);
  await seedFaction({
    partySlug: "Labour",
    mpCount: 50,
    influenceBonus: 1.0,
    leadershipAlignment: "aligned",
    rebellionBias: 0.05,
  });

  const { status, body } = await labourMemberClient.get("/api/me/political-state");

  assert.equal(status, 200, `Expected 200: ${JSON.stringify(body)}`);
  assert.ok(body.ok,            "ok flag must be true");
  assert.ok(body.politicalState, "politicalState object must be present");

  const ps = body.politicalState;
  assert.ok(ps.capital_current != null, "capital_current must be present");
  assert.ok(ps.momentum,                "momentum must be present");
  assert.ok(ps.reputation,              "reputation must be present");
  assert.ok(ps.party_pressure  != null, "party_pressure must be present");

  assert.ok(ps.faction_climate != null,
    "faction_climate context must be present for Labour character");
  assert.ok(typeof ps.faction_climate.climateLabel === "string",
    "faction_climate.climateLabel must be a string");
  assert.ok(ps.faction_climate.capitalResilienceBonus >= 0,
    "capitalResilienceBonus must be non-negative");
  // Aligned faction: 50 MPs → power=40 → LP=4 → bonus=4×0.10=0.4 > 0
  assert.ok(ps.faction_climate.capitalResilienceBonus > 0,
    "aligned faction with MPs must produce a positive capitalResilienceBonus");
});

test("CHARACTER POLITICAL STATE: hostile faction increases party_pressure for Conservative", async () => {
  // Create a Conservative character; log them in separately (within remaining auth budget)
  const conUser = await seedUserAndCharacter({ roles: [], party: "Conservative" });
  const conClient = new TestClient(baseUrl);
  await conClient.login(conUser.email, conUser.password);

  await seedConstituencies("Conservative", 60);
  await seedFaction({
    partySlug: "Conservative",
    mpCount: 55,
    leadershipAlignment: "hostile",
    rebellionBias: 0.8,
  });

  const { status, body } = await conClient.get("/api/me/political-state");

  assert.equal(status, 200, `Expected 200: ${JSON.stringify(body)}`);
  const ps = body.politicalState;

  assert.ok(ps.faction_climate != null,
    "faction_climate context must be present for Conservative character");
  assert.ok(ps.faction_climate.partyPressureModifier > 0,
    "hostile faction with MPs must produce positive partyPressureModifier");
  assert.notEqual(ps.faction_climate.climateLabel, "unified",
    "climate should not be unified when hostile faction dominates");
});

test("CHARACTER POLITICAL STATE: no faction_climate for non-playable party character", async () => {
  const pcUser = await seedUserAndCharacter({ roles: [], party: "Plaid Cymru" });
  const pcClient = new TestClient(baseUrl);
  await pcClient.login(pcUser.email, pcUser.password);

  const { status, body } = await pcClient.get("/api/me/political-state");

  assert.equal(status, 200);
  const ps = body.politicalState;
  assert.equal(ps.faction_climate, null,
    "faction_climate must be null for non-playable party characters");
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Permissions — authorised vs unauthorised access
// ═════════════════════════════════════════════════════════════════════════════

test("PERMISSIONS: admin can create faction and update allocation", async () => {
  await seedConstituencies("Labour", 15);
  const slug = `admin-perm-${Date.now()}`;

  const { status: createStatus, body: createBody } = await adminClient.post(
    "/api/admin/parties/Labour/factions",
    { name: "Admin Perm Test Faction", slug }
  );
  assert.equal(createStatus, 201,
    `Admin faction create must return 201: ${JSON.stringify(createBody)}`);

  const { status: patchStatus } = await adminClient.patch(
    `/api/admin/factions/${createBody.id}/allocation`,
    { mpCount: 10 }
  );
  assert.equal(patchStatus, 200, "Admin allocation update must return 200");
});

test("PERMISSIONS: mod can create faction and update allocation", async () => {
  await seedConstituencies("Labour", 15);
  const slug = `mod-perm-${Date.now()}`;

  const { status: createStatus, body: createBody } = await modClient.post(
    "/api/admin/parties/Labour/factions",
    { name: "Mod Perm Test Faction", slug }
  );
  assert.equal(createStatus, 201,
    `Mod faction create must return 201: ${JSON.stringify(createBody)}`);

  const { status: patchStatus } = await modClient.patch(
    `/api/admin/factions/${createBody.id}/allocation`,
    { mpCount: 5 }
  );
  assert.equal(patchStatus, 200, "Mod allocation update must return 200");
});

test("PERMISSIONS: regular user cannot create faction (must get 403)", async () => {
  const { status } = await regularClient.post("/api/admin/parties/Labour/factions", {
    name: "Unauthorised Faction",
    slug: `unauthorised-${Date.now()}`,
  });
  assert.equal(status, 403, "Regular user must receive 403 on faction create");
});

test("PERMISSIONS: regular user cannot update faction allocation (must get 403)", async () => {
  const { factionId } = await seedFaction({ partySlug: "Labour" });

  const { status } = await regularClient.patch(`/api/admin/factions/${factionId}/allocation`, {
    mpCount: 5,
  });
  assert.equal(status, 403, "Regular user must receive 403 on allocation update");
});

test("PERMISSIONS: unauthenticated mutation is rejected (CSRF guard returns 403)", async () => {
  // POST endpoints run verifyCsrfToken before requireAdminOrMod; no session means
  // no CSRF token, so the guard returns 403 rather than 401.
  const anon = anonClient();

  const { status } = await anon.post(
    "/api/admin/parties/Labour/factions",
    { name: "Anon Faction", slug: "anon-faction" }
  );
  assert.equal(status, 403, "Unauthenticated create must return 403 (CSRF guard)");
});

test("PERMISSIONS: unauthenticated request cannot read player-facing faction-climate (must get 401)", async () => {
  const anon = anonClient();
  const { status } = await anon.get("/api/parties/Labour/faction-climate");
  assert.equal(status, 401, "Unauthenticated climate read must return 401");
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Faction metadata update (PATCH /api/admin/factions/:id)
// ═════════════════════════════════════════════════════════════════════════════

test("METADATA UPDATE: admin can update faction name and alignment", async () => {
  const { factionId } = await seedFaction({ partySlug: "Labour", leadershipAlignment: "neutral" });

  const { status, body } = await adminClient.patch(`/api/admin/factions/${factionId}`, {
    name:                "Updated Faction Name",
    leadershipAlignment: "aligned",
    rebellionBias:       0.05,
  });

  assert.equal(status, 200, `Expected 200: ${JSON.stringify(body)}`);
  assert.ok(body.ok, "ok flag must be true");
  assert.equal(body.recompute?.type, "faction-political-state");
  assert.equal(body.recompute?.status, "deferred");

  const { rows } = await pool.query(
    "SELECT name, leadership_alignment, rebellion_bias FROM party_factions WHERE id = $1",
    [factionId]
  );
  assert.equal(rows[0].name,                   "Updated Faction Name");
  assert.equal(rows[0].leadership_alignment,   "aligned");
  assert.equal(Number(rows[0].rebellion_bias), 0.05);
});

test("METADATA UPDATE: returns 404 for non-existent faction id", async () => {
  const fakeId = "00000000-0000-0000-0000-000000000001";
  const { status } = await adminClient.patch(`/api/admin/factions/${fakeId}`, { name: "Ghost" });
  assert.equal(status, 404, "non-existent faction must return 404");
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Seed 1997 factions — idempotency
// ═════════════════════════════════════════════════════════════════════════════

test("SEED 1997: admin can seed 1997 factions idempotently", async () => {
  await seedConstituencies("Labour",            418);
  await seedConstituencies("Conservative",      165);
  await seedConstituencies("Liberal Democrat",   46);

  // First seed call — should insert factions
  const { status: s1, body: b1 } = await adminClient.post("/api/admin/seed-1997-factions", {});
  assert.equal(s1, 200, `First seed must return 200: ${JSON.stringify(b1)}`);
  assert.ok(b1.ok,                           "ok flag must be true");
  assert.ok(Array.isArray(b1.inserted),      "inserted must be an array");
  assert.ok(Array.isArray(b1.skipped),       "skipped must be an array");
  assert.ok(b1.inserted.length > 0,         "at least one faction must be inserted");

  // Second seed call — all should be skipped (idempotent)
  const { status: s2, body: b2 } = await adminClient.post("/api/admin/seed-1997-factions", {});
  assert.equal(s2, 200, `Second seed must return 200: ${JSON.stringify(b2)}`);
  assert.ok(b2.ok,                           "ok flag must be true on second call");
  assert.equal(b2.inserted.length, 0,        "second seed call must insert 0 factions");
  assert.ok(b2.skipped.length > 0,           "second seed call must report skipped factions");
});


test("APPLICATION: applying for NPC-only party fails with 400", async () => {
  const applicant = await seedUserAndCharacter({ roles: [], party: "Labour" });
  await pool.query("UPDATE characters SET is_active = FALSE WHERE id = $1", [applicant.charId]);
  await pool.query("UPDATE users SET active_character_id = NULL WHERE id = $1", [applicant.userId]);

  const client = new TestClient(baseUrl);
  await client.login(applicant.email, applicant.password);

  const { status, body } = await client.post("/api/characters/apply", {
    name: "Applicant NPC Party",
    party: "Green",
    constituency: "Test Seat NPC Party",
    date_of_birth: "1970-01-01",
    education: "University",
    career_background: "Law",
    family: "Married",
    year_first_elected: "1997",
    bio: "Bio",
    financial_background_level: 5,
    avatar_attribution: "Tester",
    faction_id: "11111111-1111-1111-1111-111111111111",
  });

  assert.equal(status, 400);
  assert.equal(body.error, "You can only create characters for Labour, Conservative, or Liberal Democrat.");
});

test("APPLICATION: regular users can submit a main character application without admin role", async () => {
  const applicant = await seedUserAndCharacter({ roles: [], party: "Labour" });
  await pool.query("UPDATE characters SET is_active = FALSE WHERE id = $1", [applicant.charId]);
  await pool.query("UPDATE users SET active_character_id = NULL WHERE id = $1", [applicant.userId]);

  const constituency = `Regular Apply Seat ${Date.now()}`;
  await pool.query(
    `INSERT INTO constituencies (name, party, mp_name, mp_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET party = EXCLUDED.party`,
    [constituency, "Labour", "", "npc"]
  );
  const { factionId } = await seedFaction({ partySlug: "Labour" });

  const client = new TestClient(baseUrl);
  await client.login(applicant.email, applicant.password);

  const { status, body } = await client.post("/api/characters/apply", {
    name: `Regular Applicant ${Date.now()}`,
    party: "Labour",
    constituency,
    faction_id: factionId,
    date_of_birth: "1970-01-01",
    education: "University",
    career_background: "Law",
    family: "Married",
    year_first_elected: "1997",
    bio: "Bio",
    financial_background_level: 5,
    avatar_attribution: "Tester",
  });

  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.application?.applicant_user_id, applicant.userId);
  assert.equal(body.application?.status, "pending");
});

test("ME FACTION: NPC-only party character returns null faction", async () => {
  const user = await seedUserAndCharacter({ roles: [], party: "Labour" });
  const { rows: npcPartyCharRows } = await pool.query(
    `INSERT INTO characters (user_id, name, party, constituency, is_active, roles, offices)
     VALUES ($1, $2, $3, $4, TRUE, '[]'::jsonb, '[]'::jsonb)
     RETURNING id`,
    [user.userId, `npc-party-${Date.now()}`, "Green", `Green Seat ${Date.now()}`]
  );
  const npcPartyCharId = npcPartyCharRows[0].id;
  await pool.query("UPDATE characters SET is_active = FALSE WHERE id = $1", [user.charId]);
  await pool.query("UPDATE users SET active_character_id = $1 WHERE id = $2", [npcPartyCharId, user.userId]);

  const client = new TestClient(baseUrl);
  await client.login(user.email, user.password);
  const { status, body } = await client.get("/api/me/faction");

  assert.equal(status, 200);
  assert.equal(body.faction, null);
});

test("APPROVE NPC APPLICATION: NPC-only party does not require faction and creates no faction membership", async () => {
  const requester = await seedUserAndCharacter({ roles: ["admin"], party: "Labour" });
  const constituency = `NPC Approval Seat ${Date.now()}`;
  await pool.query(
    `INSERT INTO constituencies (name, party, mp_name, mp_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET party = EXCLUDED.party`,
    [constituency, "Green", "", "npc"]
  );

  const { rows: appRows } = await pool.query(
    `INSERT INTO pending_character_applications
      (applicant_user_id, applicant_username, name, party, constituency,
       date_of_birth, education, career_background, family, year_first_elected,
       personal_background, bio, financial_background_level, avatar, avatar_attribution, twitter_handle,
       home, rentals, application_type, npc_reason, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, 'npc', $19, 'pending')
     RETURNING id`,
    [
      requester.userId,
      requester.username,
      `NPC Approve ${Date.now()}`,
      "Green",
      constituency,
      "1970-01-01",
      "University",
      "Law",
      "Married",
      "1997",
      "Background",
      "Bio",
      5,
      "",
      "Tester",
      "",
      JSON.stringify({}),
      JSON.stringify([]),
      "Needed for coverage",
    ]
  );

  const { status, body } = await adminClient.post(`/api/admin/characters/applications/${appRows[0].id}/approve`, {});
  assert.equal(status, 200, JSON.stringify(body));

  const { rows: membershipRows } = await pool.query(
    "SELECT id FROM character_faction_membership WHERE character_id = $1",
    [body.character.id]
  );
  assert.equal(membershipRows.length, 0);
});

test("APPLICATION: applying without faction_id defaults to Unaligned", async () => {
  const applicant = await seedUserAndCharacter({ roles: [], party: "Labour" });
  await pool.query("UPDATE characters SET is_active = FALSE WHERE id = $1", [applicant.charId]);
  await pool.query("UPDATE users SET active_character_id = NULL WHERE id = $1", [applicant.userId]);
  await seedConstituencies("Labour", 1);

  const client = new TestClient(baseUrl);
  await client.login(applicant.email, applicant.password);

  const { status, body } = await client.post("/api/characters/apply", {
    name: "Applicant No Faction",
    party: "Labour",
    constituency: "Test Seat No Faction",
    date_of_birth: "1970-01-01",
    education: "University",
    career_background: "Law",
    family: "Married",
    year_first_elected: "1997",
    bio: "Bio",
    financial_background_level: 5,
    avatar_attribution: "Tester",
  });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(String(body.application?.faction_slug || ""), "unaligned");
  assert.equal(String(body.application?.faction_name || ""), "Unaligned");
});

test("APPLICATION: applying with inactive faction falls back to Unaligned", async () => {
  const applicant = await seedUserAndCharacter({ roles: [], party: "Labour" });
  await pool.query("UPDATE characters SET is_active = FALSE WHERE id = $1", [applicant.charId]);
  await pool.query("UPDATE users SET active_character_id = NULL WHERE id = $1", [applicant.userId]);
  await seedConstituencies("Labour", 1);

  const { factionId } = await seedFaction({ partySlug: "Labour" });
  await pool.query("UPDATE party_factions SET active = FALSE WHERE id = $1", [factionId]);

  const client = new TestClient(baseUrl);
  await client.login(applicant.email, applicant.password);

  const { status } = await client.post("/api/characters/apply", {
    name: "Applicant Inactive Faction",
    party: "Labour",
    constituency: "Test Seat Inactive Faction",
    faction_id: factionId,
    date_of_birth: "1970-01-01",
    education: "University",
    career_background: "Law",
    family: "Married",
    year_first_elected: "1997",
    bio: "Bio",
    financial_background_level: 5,
    avatar_attribution: "Tester",
  });
  assert.equal(status, 201);

  const { rows: appRows } = await pool.query(
    `SELECT pf.slug AS faction_slug
       FROM pending_character_applications pca
       LEFT JOIN party_factions pf ON pf.id = pca.faction_id
      WHERE pca.applicant_user_id = $1
      ORDER BY pca.submitted_at DESC
      LIMIT 1`,
    [applicant.userId]
  );
  assert.equal(String(appRows[0]?.faction_slug || ""), "unaligned");
});


test("APPROVE APPLICATION: new MP joins chosen faction and rebalances allocation from Unaligned", async () => {
  const applicant = await seedUserAndCharacter({ roles: [], party: "Labour" });
  await pool.query("UPDATE characters SET is_active = FALSE WHERE id = $1", [applicant.charId]);
  await pool.query("UPDATE users SET active_character_id = NULL WHERE id = $1", [applicant.userId]);

  const constituency = `Approval Rebalance Seat ${Date.now()}`;
  await pool.query(
    `INSERT INTO constituencies (name, party, mp_name, mp_type)
     VALUES ($1, $2, '', 'npc')
     ON CONFLICT (name) DO UPDATE SET party = EXCLUDED.party`,
    [constituency, "Labour"]
  );

  const { factionId: majorFactionId } = await seedFaction({ partySlug: "Labour", slug: `major-${Date.now()}`, mpCount: 120 });
  await seedFaction({ partySlug: "Labour", slug: `minor-${Date.now()}`, mpCount: 20 });
  const { rows: unalignedRows } = await pool.query(
    `SELECT id FROM party_factions WHERE party_slug = 'Labour' AND slug = 'unaligned' LIMIT 1`
  );
  const unalignedFactionId = unalignedRows[0]?.id;
  assert.ok(unalignedFactionId, "unaligned faction should exist for Labour");
  await pool.query(
    `UPDATE party_faction_allocations SET mp_count = 40 WHERE faction_id = $1`,
    [unalignedFactionId]
  );

  const { rows: beforeTargetRows } = await pool.query(
    `SELECT COALESCE(a.mp_count, 0)::INT AS mp_count
      FROM party_faction_allocations a
      WHERE a.faction_id = $1`,
    [majorFactionId]
  );
  const beforeMajorMpCount = Number(beforeTargetRows[0]?.mp_count || 0);
  const { rows: beforeUnalignedRows } = await pool.query(
    `SELECT COALESCE(a.mp_count, 0)::INT AS mp_count
      FROM party_faction_allocations a
      WHERE a.faction_id = $1`,
    [unalignedFactionId]
  );
  const beforeUnalignedMpCount = Number(beforeUnalignedRows[0]?.mp_count || 0);

  const { rows: appRows } = await pool.query(
    `INSERT INTO pending_character_applications
      (applicant_user_id, applicant_username, name, party, constituency,
       date_of_birth, education, career_background, family, year_first_elected,
       personal_background, bio, financial_background_level, avatar, avatar_attribution,
       twitter_handle, home, rentals, faction_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,'pending')
     RETURNING id`,
    [
      applicant.userId,
      applicant.username,
      `Applicant ${Date.now()}`,
      "Labour",
      constituency,
      "1970-01-01",
      "University",
      "Law",
      "Married",
      "1997",
      "Background",
      "Bio",
      5,
      "",
      "Tester",
      "",
      JSON.stringify({}),
      JSON.stringify([]),
      majorFactionId,
    ]
  );

  const approve = await adminClient.post(`/api/admin/characters/applications/${appRows[0].id}/approve`, {});
  assert.equal(approve.status, 200, JSON.stringify(approve.body));

  const { rows: memberRows } = await pool.query(
    `SELECT cfm.faction_id, f.slug
       FROM character_faction_membership cfm
       JOIN party_factions f ON f.id = cfm.faction_id
      WHERE cfm.character_id = $1`,
    [approve.body.character.id]
  );
  assert.equal(String(memberRows[0]?.faction_id || ""), String(majorFactionId), "approved MPs should join their chosen faction");

  const { rows: afterRows } = await pool.query(
    `SELECT COALESCE(a.mp_count, 0)::INT AS mp_count
       FROM party_faction_allocations a
      WHERE a.faction_id = $1`,
    [majorFactionId]
  );
  const afterMajorMpCount = Number(afterRows[0]?.mp_count || 0);
  assert.equal(afterMajorMpCount, beforeMajorMpCount + 1, "chosen faction should gain one allocation slot on join");
  const { rows: afterUnalignedRows } = await pool.query(
    `SELECT COALESCE(a.mp_count, 0)::INT AS mp_count
       FROM party_faction_allocations a
      WHERE a.faction_id = $1`,
    [unalignedFactionId]
  );
  const afterUnalignedMpCount = Number(afterUnalignedRows[0]?.mp_count || 0);
  assert.equal(afterUnalignedMpCount, Math.max(0, beforeUnalignedMpCount - 1), "unaligned allocation should be reduced by one on join");
});

test("FACTION SWITCH: switch rebalances allocations and is not blocked by zero target slots", async () => {
  const actor = await seedUserAndCharacter({ roles: [], party: "Labour" });
  const client = new TestClient(baseUrl);
  await client.login(actor.email, actor.password);

  const { factionId: fromFaction } = await seedFaction({ partySlug: "Labour", slug: `switch-from-${Date.now()}`, mpCount: 20 });
  const { factionId: toFaction } = await seedFaction({ partySlug: "Labour", slug: `switch-to-${Date.now()}`, mpCount: 0 });

  await pool.query(
    `INSERT INTO character_faction_membership (character_id, faction_id, joined_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (character_id) DO UPDATE SET faction_id = EXCLUDED.faction_id, updated_at = NOW()`,
    [actor.charId, fromFaction]
  );

  await pool.query("UPDATE sim_clock SET sim_current_year = 2005 WHERE id = 'main'");
  const switched = await client.post("/api/me/faction/switch", { faction_id: toFaction });
  assert.equal(switched.status, 200, JSON.stringify(switched.body));
  assert.equal(switched.body?.recompute?.type, "character-political-state");
  assert.equal(switched.body?.recompute?.status, "queued");

  const { rows: allocationRows } = await pool.query(
    `SELECT faction_id, mp_count FROM party_faction_allocations WHERE faction_id = $1 OR faction_id = $2`,
    [fromFaction, toFaction]
  );
  const fromRow = allocationRows.find((r) => String(r.faction_id) === String(fromFaction));
  const toRow = allocationRows.find((r) => String(r.faction_id) === String(toFaction));
  assert.equal(Number(fromRow?.mp_count || 0), 19);
  assert.equal(Number(toRow?.mp_count || 0), 1);
});

test("FACTION SWITCH: once per sim year, leadership block, and audit logging", async () => {
  const actor = await seedUserAndCharacter({ roles: [], party: "Labour" });
  const client = new TestClient(baseUrl);
  await client.login(actor.email, actor.password);

  const { factionId: fromFaction } = await seedFaction({ partySlug: "Labour", slug: `from-${Date.now()}` });
  const { factionId: toFaction } = await seedFaction({ partySlug: "Labour", slug: `to-${Date.now()}` });

  const initialFaction = await client.get("/api/me/faction");
  assert.equal(initialFaction.status, 200, JSON.stringify(initialFaction.body));
  assert.equal(String(initialFaction.body?.faction?.slug || ""), "unaligned", "missing memberships should auto-seed to Unaligned");

  await pool.query("UPDATE sim_clock SET sim_current_year = 2000 WHERE id = 'main'");

  const first = await client.post("/api/me/faction/switch", { faction_id: toFaction });
  assert.equal(first.status, 200, JSON.stringify(first.body));

  const second = await client.post("/api/me/faction/switch", { faction_id: fromFaction });
  assert.equal(second.status, 400, "second switch in same sim year must fail");

  await pool.query("UPDATE sim_clock SET sim_current_year = 2001 WHERE id = 'main'");
  const third = await client.post("/api/me/faction/switch", { faction_id: fromFaction });
  assert.equal(third.status, 200, "switch should succeed in new sim year");

  await pool.query(
    `INSERT INTO parties (slug, name, treasury, leader_character_id)
     VALUES ('labour', 'Labour Party', '{}'::jsonb, $1)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, leader_character_id = EXCLUDED.leader_character_id`,
    [actor.charId]
  );

  await pool.query("UPDATE sim_clock SET sim_current_year = 2002 WHERE id = 'main'");
  const blocked = await client.post("/api/me/faction/switch", { faction_id: toFaction });
  assert.equal(blocked.status, 403, "leader/chairman/whip roles should block switching");

  const { rows: auditRows } = await pool.query(
    `SELECT action, details
       FROM audit_log
      WHERE action = 'faction.switch' AND target = $1
      ORDER BY id DESC LIMIT 1`,
    [`character:${actor.charId}`]
  );
  assert.equal(auditRows.length, 1, "switch action should be logged in audit_log");
  assert.equal(auditRows[0].action, "faction.switch");
});
