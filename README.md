# Rule Britannia

A browser-based UK parliamentary political simulation.

## Quick Start

Serve the project directory with any static file server (no build step required):

```bash
npx serve .
```

Open `dashboard.html` in your browser.

## Architecture

- **Vanilla JavaScript** (ES2020+, native ES modules) — no framework, no bundler
- **Multi-page HTML** — 38 standalone `.html` files, one per route
- **Single CSS file** — `styles.css` with CSS custom properties for theming
- **Client-side only** — all state stored in `localStorage`, seeded from `data/demo.json`

## File Structure

```
├── data/demo.json          # Seed data (parliament, parties, economy, etc.)
├── js/
│   ├── main.js             # Entry point + data-page router
│   ├── core.js             # Boot, localStorage I/O, defaults
│   ├── ui.js               # Nav init, HTML escaping, setHTML helper
│   ├── clock.js            # Real-time → sim-time mapping
│   ├── permissions.js      # Role/office permission checks
│   ├── divisions.js        # Vote weighting and delegation
│   ├── bill-drafting.js    # Bill text parsing
│   ├── engines/
│   │   ├── core-engine.js          # Party seat maps, Sunday Roll
│   │   ├── division-engine.js      # Vote casting, tallying, results
│   │   ├── permission-engine.js    # Access control rules
│   │   └── control-panel-engine.js # Admin state mutation helpers
│   └── pages/              # One module per page (38 files)
├── *.html                  # Page files (38 routes)
├── styles.css              # Global stylesheet
└── assets/                 # Logo, icons
```

## API Base Configuration

The frontend calls the backend API (authentication, state persistence) using a base URL resolved at runtime by `js/api.js`:

1. **`window.RB_API_BASE`** — if this global is set before `js/main.js` runs, it is used as-is.
2. **Hostname inference** — if the page is served from `rulebritannia.org`, `*.rulebritannia.org`, or `rulebritannia-app.onrender.com`, the base is automatically set to `https://rulebritannia-app-backend.onrender.com`.
3. **Fallback** — all other origins (e.g. `localhost`) default to `""`, meaning API requests go to the same origin. This is the correct behaviour for local development when you also run the backend on the same host/port.

### Local development

If you are running the backend on a different port (e.g. `http://localhost:4000`), add a `<script>` tag in the relevant HTML file **before** `js/main.js`:

```html
<script>window.RB_API_BASE = "http://localhost:4000";</script>
<script type="module" src="js/main.js"></script>
```

Or set it once in your browser console before navigating to the page.

### Production (Render)

No extra configuration is needed. The hostname-inference rule in `js/api.js` automatically resolves the correct backend URL when the frontend is served from `rulebritannia.org` or `rulebritannia-app.onrender.com`.



Each HTML file has a `data-page` attribute on `<body>`. On load, `js/main.js`:

1. Calls `bootData()` to fetch `demo.json` and merge with `localStorage`
2. Reads `document.body.dataset.page`
3. Dispatches to the matching `init*Page(data)` function from the route table

## Simulation Clock

Real calendar days map to simulated months:

- Monday/Tuesday/Wednesday = 1 sim month
- Thursday/Friday/Saturday = 1 sim month
- Sunday = frozen (no advancement)

This yields **2 sim months per real week**, starting from a configurable base year (default: 1997).

## Adding a New Page

1. Create `newpage.html` with `<body data-page="newpage">`
2. Create `js/pages/newpage.js` exporting `initNewpagePage(data)`
3. Import and register in `js/main.js` route table

## Data Flow

```
demo.json → merge with localStorage → ensureDefaults() → page init(data)
         → user action → mutate data → saveData() → re-render
```
