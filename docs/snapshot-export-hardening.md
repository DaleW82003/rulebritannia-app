# Snapshot Export Hardening Summary

## Routes covered

- `GET /api/admin/export-snapshot` (primary snapshot/state export endpoint).
- Audit scope review also confirmed adjacent state tooling routes:
  - `GET /api/state` (authenticated current state read)
  - `GET /api/snapshots` (admin snapshot catalog)
  - `POST /api/snapshots` (admin snapshot creation)
  - `POST /api/snapshots/:id/restore` (admin pointer restore)
  - `POST /api/admin/import-snapshot` (admin import; dev/staff env-gated)

## Rate-limiting policy implemented

- Added dedicated `snapshotExportLimit` middleware on `GET /api/admin/export-snapshot`.
- Default limit: **12 requests/minute per actor**.
- Key strategy (in order):
  1. `session.userId` (preferred per-user enforcement)
  2. `sessionID` fallback
  3. `req.ip` fallback
- Configurable with `SNAPSHOT_EXPORT_RATE_LIMIT_MAX`.
- Exceeded requests return HTTP `429` with a clear operator-facing message.

## Audit logging added

- Added structured, searchable console log lines with prefix `[snapshot-export-audit]` for:
  - successful export
  - failed export
  - rate-limited export
- Added matching persisted `audit_log` actions:
  - `admin.export-snapshot.success`
  - `admin.export-snapshot.failed`
  - `admin.export-snapshot.rate-limited`
- Logged fields include:
  - route/action
  - actor identity (if present)
  - actor roles (if present)
  - timestamp
  - success/failure
  - reason (for failures)
  - snapshot metadata (id/label/creator/createdAt where available)
  - export size bytes estimate
- Export payload body contents are **not** written into audit logs.

## RBAC adjustments

- No RBAC broadening was made.
- `GET /api/admin/export-snapshot` remains admin-only (`requireAdmin`).
- Unauthorized attempts are still rejected with the existing 401/403 semantics.

## Backward-compatibility notes

- Core export response contract remains intact:
  - `exportedAt`, `snapshotId`, `label`, `createdAt`, `createdBy`, `data`
- Added backward-compatible metadata field:
  - `meta.exportType`
  - `meta.estimatedDataSizeBytes`
- Existing consumers that ignore unknown fields remain unaffected.

## Remaining operational caveats

- Rate limiting is process-local (`express-rate-limit` default memory store), so multi-instance deployments should move this policy to a shared store if strict global enforcement is required.
- Export remains intentionally powerful/admin-visible during alpha; monitor `[snapshot-export-audit]` and `audit_log` for unexpected frequency patterns.
