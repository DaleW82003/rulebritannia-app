# RBAC Cleanup Summary

This document records the repository-wide role-based access control (RBAC)
cleanup pass performed against `server/index.js`.

---

## What changed

### New utility module: `server/rbac-helpers.js`

Three pure, side-effect-free helpers are now exported from this module:

| Export | Signature | Purpose |
|--------|-----------|---------|
| `getSessionRoles` | `(req) → string[]` | Returns `req.session.roles` safely (empty array if missing or non-array). Handles both `req.session.roles` and `req.session?.roles` call sites. |
| `hasAdminOrMod` | `(req) → boolean` | `true` when the session has the **admin** or **mod** role. |
| `hasAdminModOrSpeaker` | `(req) → boolean` | `true` when the session has the **admin**, **mod**, or **speaker** role. |

These complement (but do not replace) the existing middleware helpers defined
in `server/index.js`:

| Existing helper | Behaviour |
|-----------------|-----------|
| `requireAuth` | Sends 401 and returns `false` if not logged in |
| `requireAdmin` | Sends 403 and returns `false` if role ≠ `admin` |
| `requireAdminOrMod` | Sends 403 and returns `false` if role ∉ `{admin, mod}` |
| `requireAdminModOrSpeaker` | Sends 403 and returns `false` if role ∉ `{admin, mod, speaker}` |

The new boolean helpers are intended for **compound permission checks** where
staff authority is one of several acceptable reasons to act (e.g. a route that
also accepts a party leader). They are used like:

```js
const isStaff = hasAdminOrMod(req);
let canAct = isStaff;
if (!canAct) { /* additional check (party leader, bill author, etc.) */ }
if (!canAct) return res.status(403).json({ error: "..." });
```

---

## Duplicated checks removed

The two-line boilerplate pattern:

```js
const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
const isStaff      = sessionRoles.includes("admin") || sessionRoles.includes("mod");
```

and its variants (optional chaining, `roles` local variable, `isAdminOrMod` /
`isPrivileged` / `canCreate` / `canClose` / `canSet` variable names, `.some()`
form, speaker-inclusive form) were replaced with single-line helper calls.

**Total instances consolidated: 58** across the following route groups:

| Route group | Pattern | Replacement |
|-------------|---------|-------------|
| Parliamentary bills (first-reading, withdraw, amendment) | admin \| mod | `hasAdminOrMod` |
| Press / press conference entries | admin \| mod \| speaker | `hasAdminModOrSpeaker` |
| Character profiles (extended fields) | admin \| mod | `hasAdminOrMod` |
| NPC character request | admin \| mod | `hasAdminOrMod` |
| Whip-authority helper (`getWhipAuthority`) | admin \| mod | `hasAdminOrMod` |
| Whip requests (list / approve / deny) | admin \| mod | `hasAdminOrMod` |
| Party whip / chairman assignment | admin \| mod | `hasAdminOrMod` |
| Party structure / treasury endpoints | admin \| mod | `hasAdminOrMod` |
| Privy Council (`hasPrivyCouncilAccess`) | admin \| mod \| speaker | `hasAdminModOrSpeaker` |
| Privy Council posts (get / create) | admin \| mod \| speaker | `hasAdminModOrSpeaker` |
| Character shop purchase refund | admin \| mod \| speaker | `hasAdminModOrSpeaker` |
| Finance / faction routes (13 000–16 000 line range) | admin \| mod | `hasAdminOrMod` |
| Divisions (create / close / vote) | admin \| mod \| speaker | `hasAdminModOrSpeaker` |
| Question Time / parliamentary-state routes | admin \| mod \| speaker | `hasAdminModOrSpeaker` |
| News comment delete | admin \| mod \| speaker | `hasAdminModOrSpeaker` |
| Paper article comment delete | admin \| mod | `hasAdminOrMod` |
| Paper submissions list | admin \| mod | `hasAdminOrMod` |
| Audit log endpoint | admin \| mod | `hasAdminOrMod` |
| Press NPC-author guard | admin \| mod \| speaker | `hasAdminModOrSpeaker` |
| `isReplyEligible` helper | (office roles) | `getSessionRoles` |
| `requireAdminOrMod` middleware | internal | `getSessionRoles` |
| `requireAdminModOrSpeaker` middleware | internal | `getSessionRoles` |

---

## New helper utilities introduced

`server/rbac-helpers.js` — three exports described above.

Tests: `server/rbac-helpers.test.js` — 28 unit tests covering all helpers under
normal, edge-case, and missing-session scenarios.

---

## Routes intentionally left with inline checks

The following routes retain their current form because replacement would obscure
important logic or because the check is genuinely distinct from the simple
admin/mod/speaker split:

| Route / context | Reason left inline |
|-----------------|--------------------|
| `requireAdmin` middleware body | Already minimal; uses `!Array.isArray(req.session.roles) \|\| !req.session.roles.includes("admin")` guard — single-function context, no duplication. |
| Admin-only guards (lines ~5523–5919) | Each uses `!Array.isArray(req.session.roles) \|\| !req.session.roles.includes("admin")` — structurally correct and not duplicated across routes. |
| State-write guard (line ~5688) | Uses `ALLOWED_STATE_WRITE_ROLES.has(r)` from `state-contracts.js` — a purpose-specific Set that should remain tied to that module's contract. |
| `isReplyEligible` (line ~21114) | Checks office roles (`office:prime_minister` etc.), not system roles; uses `getSessionRoles` now but the logic itself is feature-specific. |
| `press/:id/mark` speaker-Sunday guard | Speaker Sunday restriction requires `isSpeakerRole` AND day-of-week check — compound logic that would be obscured by a helper. |
| `getWhipAuthority` leader/whip logic | Party-leader and chief-whip lookups require async DB calls — cannot be expressed as a pure synchronous boolean helper. |

---

## Remaining edge cases

- **`requireAdmin` internal guard** still uses `Array.isArray(req.session.roles)`
  directly rather than `getSessionRoles`. This is intentional: `requireAdmin` is
  a standalone function that runs before `requireAdminOrMod` and it would be
  unusual to introduce a circular dependency on the helpers module for a single
  check.

- **`ALLOWED_STATE_WRITE_ROLES`** in `state-contracts.js` overlaps with the
  `{admin, mod, speaker}` set checked by `hasAdminModOrSpeaker`. These remain
  separate: `ALLOWED_STATE_WRITE_ROLES` is the authoritative source for state
  write access per `state-contracts.js`; `hasAdminModOrSpeaker` is a convenience
  helper for route-level guards.

- **No PERMISSION_MAP integration** on the server side. The `PERMISSION_MAP`
  exported from `server/roles.js` is currently used only by the frontend. Wiring
  it into server-side route guards would require a more invasive refactor (each
  of the 44 named actions would need mapping to the routes that use them). This
  is left as a future improvement.
