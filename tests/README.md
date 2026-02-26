# Rule Britannia — Automated Tests

## Overview

```
tests/
├── api/
│   ├── rbac.spec.js          Node test runner — RBAC enforcement (requires live server + session cookies)
│   ├── persistence.spec.js   Node test runner — R3: write → reload consistency (requires live server)
│   └── immutability.spec.js  Node test runner — R2: parliament items immutable by players (requires live server)
└── ui/
    └── snapshot.spec.js      Playwright — mobile + desktop breakpoint snapshots (requires live server)
scripts/
└── audit/
    ├── feature-manifest.js   Static scanner — pages × endpoints × RBAC table (no server needed)
    └── rbac-matrix.json      Declarative RBAC rules for every write endpoint
```

---

## Static checks (no server needed)

```bash
# Feature manifest + RBAC cross-check (exits 0 = clean)
node scripts/audit/feature-manifest.js

# JSON output for CI artefacts
node scripts/audit/feature-manifest.js --json > /tmp/manifest.json

# The original six static checks (credentials, auth, immutability, JSON shape)
node scripts/static-checks.js
```

---

## API tests (requires live server)

Set the following environment variables (store as Render/GitHub secrets in CI):

| Variable       | Description                                         |
|---------------|-----------------------------------------------------|
| `BASE_URL`     | Live server URL, e.g. `https://rulebritannia-app.onrender.com` |
| `COOKIE_ANON`  | Empty or omit — no session cookie                   |
| `COOKIE_PLAYER`| Session cookie for a logged-in player (non-staff)  |
| `COOKIE_MOD`   | Session cookie for a mod user                      |
| `COOKIE_ADMIN` | Session cookie for an admin user                   |

### How to get session cookies

1. Log in at the live site in a browser
2. Open DevTools → Application → Cookies
3. Copy the `rb.sid` cookie value
4. Set `COOKIE_PLAYER="rb.sid=<value>"`

### Run API tests

```bash
# RBAC enforcement
BASE_URL=https://yourapp.onrender.com \
COOKIE_PLAYER="rb.sid=..." \
COOKIE_MOD="rb.sid=..." \
COOKIE_ADMIN="rb.sid=..." \
node --test tests/api/rbac.spec.js

# R3 persistence (write → reload)
BASE_URL=https://yourapp.onrender.com \
COOKIE_PLAYER="rb.sid=..." \
node --test tests/api/persistence.spec.js

# R2 immutability (parliament items)
BASE_URL=https://yourapp.onrender.com \
COOKIE_PLAYER="rb.sid=..." \
COOKIE_MOD="rb.sid=..." \
node --test tests/api/immutability.spec.js

# All API tests together
BASE_URL=... COOKIE_PLAYER=... COOKIE_MOD=... COOKIE_ADMIN=... \
node --test tests/api/*.spec.js
```

---

## UI snapshot tests (requires Playwright)

```bash
# Install Playwright (one time)
npx playwright install --with-deps chromium

# Create baseline snapshots (first run)
BASE_URL=https://yourapp.onrender.com \
npx playwright test tests/ui/snapshot.spec.js --update-snapshots

# Run snapshot tests (compare to baseline)
BASE_URL=https://yourapp.onrender.com \
npx playwright test tests/ui/snapshot.spec.js

# View HTML report
npx playwright show-report tests/ui/__report__
```

Snapshots are stored in `tests/ui/__snapshots__/`. Commit the baseline images.  
Playwright will fail the test if pixel diff exceeds 200px.

---

## CI integration (GitHub Actions / Render)

Add a workflow `.github/workflows/static-checks.yml`:

```yaml
name: Static Checks
on: [push, pull_request]
jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node scripts/static-checks.js
      - run: node scripts/audit/feature-manifest.js
```

For API + UI tests with secrets:

```yaml
  api-tests:
    runs-on: ubuntu-latest
    env:
      BASE_URL:       ${{ secrets.BASE_URL }}
      COOKIE_PLAYER:  ${{ secrets.COOKIE_PLAYER }}
      COOKIE_MOD:     ${{ secrets.COOKIE_MOD }}
      COOKIE_ADMIN:   ${{ secrets.COOKIE_ADMIN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node --test tests/api/*.spec.js
```

---

## What each test validates

### `scripts/static-checks.js`
1. All POST/PUT/PATCH/DELETE fetch calls use `credentials:"include"`
2. All non-public GET calls use `credentials:"include"`
3. Every server write endpoint has an auth check
4. Motion/EDM/bill mutating endpoints are staff-only
5. No player-facing `saveState()` blocks lack a nearby API call
6. All server error responses use `{ error: string }` shape

### `scripts/audit/feature-manifest.js`
- Pages × API function cross-reference
- Server endpoint RBAC table (method, path, allowed roles, DB write?)
- Immutability policy summary for Parliament items
- RBAC matrix vs server drift report

### `tests/api/rbac.spec.js` (R1/R2)
- Unauthenticated requests to auth-required endpoints → 401/403
- Player (non-staff) requests to staff-only endpoints → 403
- Parliament item PUT/DELETE by player → 403

### `tests/api/persistence.spec.js` (R3)
- Red Lion post: POST → GET same post
- Online post: POST → GET same post
- QT question: POST → GET same question
- Work plan: POST → GET same hours
- Press release: POST → GET same item

### `tests/api/immutability.spec.js` (R2)
- Player cannot PUT/DELETE motions/statements/regulations/press after submit
- Staff (mod) CAN PUT parliament items
- Event PUT requires auth (author-or-staff enforced server-side)

### `tests/ui/snapshot.spec.js`
- 9 key player pages render without JS errors at mobile (390px) and desktop (1440px)
- Navbar present at all breakpoints
- No horizontal overflow at 390px
