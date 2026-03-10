import test from "node:test";
import assert from "node:assert/strict";
import { app } from "./index.js";

const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);
const API_PREFIX = "/api/";

const SIM_WRITE_EXCLUDE_PATTERNS = [
  /^\/api\/csrf-token$/,
  /^\/api\/auth\//,
  /^\/api\/health$/,
  /^\/api\/register(?:\/|$)/,
  /^\/api\/verify-email(?:\/|$)/,
  /^\/api\/admin\/sessions(?:\/|$)/,
  /^\/api\/admin\/discourse-sync(?:\/|$)/,
];

// Single source of truth for domain route ownership.
const DOMAIN_ROUTE_PATTERNS = {
  motions: [/^\/api\/motions(?:\/|$)/],
  regulations: [/^\/api\/regulations(?:\/|$)/],
  statements: [/^\/api\/statements(?:\/|$)/],
  polling: [/^\/api\/polling(?:\/|$)/],
  elections: [/^\/api\/elections(?:\/|$)/],
  parties: [/^\/api\/parties(?:\/|$)/, /^\/api\/admin\/parties(?:\/|$)/],
  fundraising: [/^\/api\/fundraising(?:\/|$)/],
  events: [/^\/api\/events(?:\/|$)/],
  online: [/^\/api\/online(?:\/|$)/],
  red_lion: [/^\/api\/redlion(?:\/|$)/],
  privy_council: [/^\/api\/privy-council(?:\/|$)/],
  question_time: [/^\/api\/questiontime-questions(?:\/|$)/],
  constituency_work: [/^\/api\/(me\/work-plan|locals)(?:\/|$)/],
  scandals: [/^\/api\/scandals(?:\/|$)/],
  personal: [/^\/api\/me\/(character|faction|work-plan)(?:\/|$)/],
  budget: [/^\/api\/budget(?:\/|$)/],
  economy: [/^\/api\/admin\/economy(?:\/|$)/],
  civil_service: [/^\/api\/civil-service(?:\/|$)/],
  user_page: [/^\/api\/users\/(?:[^/]+)\/roles(?:\/|$)/],
};

// Domains with intentionally no direct sim-write surface must be explicit.
const NO_SIM_WRITE_DOMAINS_ALLOWLIST = {
  // example_domain: { reason: "Read-only by design", owner: "team-name", revisitBy: "2026-06-01" }
};

// Rare escape hatch: admin write routes that intentionally accept broader payloads.
// These remain audited sim-write routes but are exempt from strict sanitizer-order assertions.
const ADMIN_BROAD_PAYLOAD_ALLOWLIST = {
  // "/api/admin/some-endpoint": { reason: "Trusted internal payload format", revisitBy: "2026-06-01" }
};

function shouldExclude(pathname) {
  return SIM_WRITE_EXCLUDE_PATTERNS.some((rx) => rx.test(pathname));
}

function isAuditedWriteRoute(route) {
  return (
    WRITE_METHODS.has(route.method) &&
    route.path.startsWith(API_PREFIX) &&
    !shouldExclude(route.path)
  );
}

function collectRegisteredRoutes(expressApp) {
  const stack = expressApp?._router?.stack || [];
  const routes = [];
  for (const layer of stack) {
    if (!layer?.route?.path) continue;
    const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
    routes.push({ path: String(layer.route.path), methods, layerIndex: stack.indexOf(layer) });
  }
  return routes;
}

function domainRouteMap(auditedRoutes) {
  const pairs = Object.entries(DOMAIN_ROUTE_PATTERNS);
  const out = Object.fromEntries(pairs.map(([d]) => [d, []]));
  for (const r of auditedRoutes) {
    for (const [domain, patterns] of pairs) {
      if (patterns.some((rx) => rx.test(r.path))) out[domain].push(r);
    }
  }
  return out;
}

function sanitizerCoverageFailure(route, sanitizeIndex) {
  if (ADMIN_BROAD_PAYLOAD_ALLOWLIST[route.path]) return null;
  if (sanitizeIndex < 0) return `missing-sanitizer-layer: ${route.method.toUpperCase()} ${route.path}`;
  if (!(sanitizeIndex < route.layerIndex)) return `misordered-sanitizer-layer: ${route.method.toUpperCase()} ${route.path}`;
  return null;
}

test("audited /api write routes have sanitizer ordering and domain policy coverage", () => {
  const stack = app?._router?.stack || [];
  assert.ok(stack.length > 0, "Express router stack should be populated");

  const sanitizeIndex = stack.findIndex((layer) => layer?.name === "sanitizeSimWriteBodyMiddleware");

  const auditedRoutes = collectRegisteredRoutes(app)
    .flatMap((r) => r.methods.map((method) => ({ ...r, method })))
    .filter((r) => isAuditedWriteRoute(r));

  assert.ok(auditedRoutes.length > 0, "Should discover at least one audited /api write route");

  // Global coverage invariant
  const globalCoverageFailures = auditedRoutes
    .map((r) => sanitizerCoverageFailure(r, sanitizeIndex))
    .filter(Boolean);
  assert.deepEqual(
    globalCoverageFailures,
    [],
    `sanitizeSimWriteBodyMiddleware must exist and be ordered before every audited write route. Failing routes: ${globalCoverageFailures.join("; ")}`
  );

  // Domain policy invariant (existence or explicit allowlist with rationale) + per-domain coverage.
  const byDomain = domainRouteMap(auditedRoutes);
  const allDomainPatterns = Object.values(DOMAIN_ROUTE_PATTERNS).flat();
  const unclaimedRoutes = auditedRoutes.filter((r) => !allDomainPatterns.some((rx) => rx.test(r.path)));
  if (unclaimedRoutes.length) {
    console.warn(
      `[sanitize-audit] WARN: ${unclaimedRoutes.length} audited sim-write routes are not yet mapped to a domain pattern: ${unclaimedRoutes.map((r) => `${r.method.toUpperCase()} ${r.path}`).join(", ")}`
    );
  }

  for (const [domain, patterns] of Object.entries(DOMAIN_ROUTE_PATTERNS)) {
    const matches = byDomain[domain] || [];

    if (NO_SIM_WRITE_DOMAINS_ALLOWLIST[domain] && matches.length > 0) {
      assert.fail(
        `Domain '${domain}' is allowlisted as no-sim-write but has matched write routes: ${matches.map((r) => `${r.method.toUpperCase()} ${r.path}`).join(", ")}. Remove allowlist or fix patterns.`
      );
    }

    if (matches.length === 0) {
      const allow = NO_SIM_WRITE_DOMAINS_ALLOWLIST[domain];
      assert.ok(
        allow && typeof allow.reason === "string" && allow.reason.trim().length > 0,
        `Domain '${domain}' has zero sim-write routes and is not explicitly allowlisted with rationale. patterns=${patterns.map((p) => p.toString()).join(", ")}`
      );
      continue;
    }

    const domainFailures = matches
      .map((r) => sanitizerCoverageFailure(r, sanitizeIndex))
      .filter(Boolean);
    assert.deepEqual(
      domainFailures,
      [],
      `Domain '${domain}' has sanitizer coverage failures. patterns=${patterns.map((p) => p.toString()).join(", ")} matchedRoutes=${matches.map((r) => `${r.method.toUpperCase()} ${r.path}`).join(", ")} failures=${domainFailures.join("; ")}`
    );
  }

  for (const [routePath, meta] of Object.entries(ADMIN_BROAD_PAYLOAD_ALLOWLIST)) {
    assert.ok(
      auditedRoutes.some((r) => r.path === routePath),
      `ADMIN_BROAD_PAYLOAD_ALLOWLIST entry '${routePath}' has no matching audited route`
    );
    assert.ok(
      meta && typeof meta.reason === "string" && meta.reason.trim().length > 0,
      `ADMIN_BROAD_PAYLOAD_ALLOWLIST entry '${routePath}' must include a non-empty reason`
    );
  }
});

test("sanitizeSimWriteBodyMiddleware strips authoritative fields from sim-write payloads", () => {
  const stack = app?._router?.stack || [];
  const sanitizeLayer = stack.find((layer) => layer?.name === "sanitizeSimWriteBodyMiddleware");
  assert.ok(sanitizeLayer?.handle, "sanitizeSimWriteBodyMiddleware should be registered");

  const req = {
    method: "POST",
    body: {
      reference: "PM PR999",
      reference_code: "PM PR999",
      reference_serial: 999,
      prefix: "PM",
      kind: "PR",
      serial: 999,
      author_character_id: "fake-char-id",
      npcAuthor: true,
      createdAt: "spoof",
      updatedAt: "spoof",
      subject: "Server-owned write",
      nested: { reference: "nested spoof", author: "Spoofed Name" },
    },
  };

  sanitizeLayer.handle(req, {}, () => {});

  assert.equal(req.body.subject, "Server-owned write");
  assert.equal(req.body.reference, undefined);
  assert.equal(req.body.reference_code, undefined);
  assert.equal(req.body.reference_serial, undefined);
  assert.equal(req.body.prefix, undefined);
  assert.equal(req.body.kind, undefined);
  assert.equal(req.body.serial, undefined);
  assert.equal(req.body.author_character_id, undefined);
  assert.equal(req.body.npcAuthor, undefined);
  assert.equal(req.body.createdAt, undefined);
  assert.equal(req.body.updatedAt, undefined);
  assert.deepEqual(req.body.nested, {});
});
