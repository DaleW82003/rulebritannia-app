# Alpha Safety Hardening Summary

Audit and hardening of all dangerous dev/admin endpoints before invited alpha testing.

---

## Hardening Policy

| Category | Policy |
|----------|--------|
| `wipe` / `reset` / `clear` / `seed` / `initialize` / `import` / `repair` | **Disabled in production** — return `404` unless `ENABLE_DEV_SEED=true` |
| `export` / `force-logout` / `rotate-sessions` | **Admin-only** — available in production, require `admin` role |
| Normal simulation routes | **Unaffected** |

The guard logic is centralised in the `isDevSeedAllowed()` helper (`server/index.js`).  
Every production-disabled endpoint calls `isDevSeedAllowed()` as its **first** check before any auth guard.

---

## All Risky Endpoints Found

### ✅ Already Protected Before This PR (no change needed)

| Method | Path | Protection | Notes |
|--------|------|-----------|-------|
| `POST` | `/api/admin/wipe-content` | `isDevSeedAllowed()` + `requireAdmin` | Had guard already |
| `POST` | `/api/admin/wipe-with-characters` | `isDevSeedAllowed()` + `requireAdmin` | Had guard already |
| `POST` | `/api/admin/seed-demo` | `isDevSeedAllowed()` + `requireAdmin` (inside handler) | Had guard already |
| `POST` | `/api/admin/seed` | `isDevSeedAllowed()` + `requireAdmin` (inside handler) | Alias for seed-demo |
| `POST` | `/api/admin/constituencies/initialize-1997` | `isDevSeedAllowed()` + `requireAdminModOrSpeaker` | Had guard already |
| `DELETE` | `/api/admin/constituencies/clear` | `isDevSeedAllowed()` + `requireAdmin` | Had guard already |

### 🔴 Fixed in This PR — Added `isDevSeedAllowed()` Guard

| Method | Path | Before | After |
|--------|------|--------|-------|
| `POST` | `/api/admin/clear-cache` | `requireAdmin` only | `isDevSeedAllowed()` + `requireAdmin` |
| `POST` | `/api/admin/import-snapshot` | `requireAdmin` only | `isDevSeedAllowed()` + `requireAdmin` |
| `POST` | `/api/admin/repair/character-owner-pointers` | `requireAdminOrMod` only | `isDevSeedAllowed()` + `requireAdminOrMod` |
| `POST` | `/api/admin/elections/seed-1997` | `requireAdminOrMod` only | `isDevSeedAllowed()` + `requireAdminOrMod` |
| `POST` | `/api/admin/budget/seed` | `requireAdmin` only | `isDevSeedAllowed()` + `requireAdmin` |
| `POST` | `/api/admin/reset-baseline` | `requireAdmin` only | `isDevSeedAllowed()` + `requireAdmin` |

### 🟡 Admin-Only in Production (no changes needed — policy already correct)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET`  | `/api/admin/export-snapshot` | `requireAdmin` | Read-only export; safe in production |
| `POST` | `/api/admin/force-logout-all` | `requireAdmin` | Legitimate security tool |
| `POST` | `/api/admin/rotate-sessions` | `requireAdmin` | Legitimate security tool |
| `POST` | `/api/discourse/test` | `requireAdmin` | Validates Discourse credentials; no data mutation |
| `POST` | `/api/government/reset` | `requireAdminOrMod` | Legitimate game management (PM formation) |
| `POST` | `/api/opposition/reset` | `requireAdminOrMod` | Legitimate game management (LOTO formation) |

---

## How Each Endpoint Is Now Protected

### Production-Disabled Endpoints (return `404` when `NODE_ENV=production` and `ENABLE_DEV_SEED` is not `"true"`)

All of these endpoints call `isDevSeedAllowed()` **before** any auth guard:

```javascript
if (!isDevSeedAllowed()) return res.status(404).json({ error: "Not found" });
```

The function is defined once and reused:

```javascript
function isDevSeedAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_SEED === "true";
}
```

To enable on a non-production environment (e.g. staging):
```
ENABLE_DEV_SEED=true
```

**Never** set `ENABLE_DEV_SEED=true` on a real production instance.

---

## Audit / RBAC Matrix Updates

`scripts/audit/rbac-matrix.json` has been updated:

- All production-disabled endpoints now carry `"production_disabled": true` and `"dev_flag": "ENABLE_DEV_SEED"`.
- Added missing `GET /api/admin/export-snapshot` entry (admin-only, not production-disabled).
- Added missing `POST /api/admin/wipe-with-characters` entry (production-disabled).
- Fixed `POST /api/admin/seed-demo` and `POST /api/admin/seed` entries: roles corrected; `production_disabled` and `dev_flag` added.
- All entries include a `"rationale"` field explaining the protection model.

---

## Documentation Updates

- **`server/README.md`** — Added:
  - `ENABLE_DEV_SEED` environment variable to the table with a note never to set it in production.
  - "Production-Disabled Endpoints" section listing all 12 endpoints and the controlling env flag.
  - "Admin-Only Endpoints (safe in production)" section for the 3 sensitive-but-production-safe routes.

---

## Remaining Watch Items

| Item | Status |
|------|--------|
| `GET /api/admin/export-snapshot` exposes full game state JSON | Admin-only guard is the sole protection. Consider rate-limiting or IP allowlisting for extra defence in production. |
| `POST /api/government/reset` and `POST /api/opposition/reset` are admin/mod-only but destructive to game state | Intentionally kept production-accessible as they represent legitimate game events. Review before opening to a wider mod team. |
| `isDevSeedAllowed()` relies on `NODE_ENV` being set correctly | Ensure `NODE_ENV=production` is set in the Render/hosting environment. If `NODE_ENV` is unset, `isDevSeedAllowed()` returns `true` (permissive). Consider defaulting to `"production"` if the env var is absent. |

---

## Verification

After this PR:

```bash
node scripts/static-checks.js        # All 8 checks pass
node scripts/audit/feature-manifest.js --json | python3 -c "
import sys, json; d=json.load(sys.stdin)
print('rbacDriftWarnings:', d['summary']['rbacDriftWarnings'])
"
# rbacDriftWarnings: 0
```
