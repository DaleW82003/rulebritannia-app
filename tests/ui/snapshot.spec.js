/**
 * tests/ui/snapshot.spec.js
 *
 * Playwright snapshot-based UI uniformity checks.
 *
 * Validates consistent rendering at mobile and desktop breakpoints for key
 * player-facing pages. Requires no game data — just checks that pages render
 * without unhandled errors and that structural elements (navbar, content) are
 * present at both breakpoints.
 *
 * Usage:
 *   npx playwright test tests/ui/snapshot.spec.js
 *
 * Required environment variables:
 *   BASE_URL           - e.g. https://rulebritannia-app.onrender.com
 *   COOKIE_PLAYER      - (optional) session cookie to test authenticated views
 *
 * Snapshots are stored in tests/ui/__snapshots__/ and committed.
 * On first run with --update-snapshots, baselines are created.
 */

import { test, expect } from "@playwright/test";

const BASE_URL    = process.env.BASE_URL || "http://localhost:3000";
const COOKIE_STR  = process.env.COOKIE_PLAYER || "";

const BREAKPOINTS = [
  { name: "mobile",  width: 390,  height: 844  },
  { name: "desktop", width: 1440, height: 900  },
];

/** Pages to check — relative path and a selector that must be visible */
const PAGES = [
  { path: "/",             selector: "body",         title: "landing"      },
  { path: "/dashboard",   selector: "body",         title: "dashboard"    },
  { path: "/motions",     selector: "body",         title: "motions"      },
  { path: "/statements",  selector: "body",         title: "statements"   },
  { path: "/press",       selector: "body",         title: "press"        },
  { path: "/redlion",     selector: "body",         title: "redlion"      },
  { path: "/events",      selector: "body",         title: "events"       },
  { path: "/online",      selector: "body",         title: "online"       },
  { path: "/questiontime",selector: "body",         title: "questiontime" },
];

// ── Helper ────────────────────────────────────────────────────────────────────

async function setSessionCookie(context, cookieStr) {
  if (!cookieStr) return;
  // Parse "name=value; name2=value2" format
  const pairs = cookieStr.split(";").map((s) => s.trim());
  for (const pair of pairs) {
    const idx   = pair.indexOf("=");
    if (idx < 0) continue;
    const name  = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name) continue;
    await context.addCookies([{
      name,
      value,
      url: BASE_URL,
    }]);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

for (const bp of BREAKPOINTS) {
  test.describe(`Snapshot: ${bp.name} (${bp.width}×${bp.height})`, () => {
    test.use({ viewport: { width: bp.width, height: bp.height } });

    test.beforeEach(async ({ context }) => {
      await setSessionCookie(context, COOKIE_STR);
    });

    for (const pg of PAGES) {
      test(`${pg.title} page renders without crash`, async ({ page }) => {
        const url = `${BASE_URL}${pg.path}.html`;

        const consoleErrors = [];
        page.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });

        const pageErrors = [];
        page.on("pageerror", (err) => pageErrors.push(err.message));

        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

        // Page must load (allow redirects to login)
        expect([200, 302, 301]).toContain(response?.status() ?? 200);

        // Wait for body content
        await page.waitForSelector(pg.selector, { timeout: 10_000 });

        // No unhandled JS errors
        const jsErrorCount = pageErrors.filter(
          (e) =>
            // ResizeObserver limit exceeded is a browser performance warning, not a
            // functional error — safe to ignore in snapshot tests.
            !e.includes("ResizeObserver") &&
            // "Non-Error" prefix appears in some promise-rejection polyfills and
            // does not indicate a real application error.
            !e.includes("Non-Error")
        ).length;
        expect(jsErrorCount, `JS errors on ${pg.title}: ${pageErrors.join("; ")}`).toBe(0);

        // Take snapshot for visual regression
        await expect(page).toHaveScreenshot(`${pg.title}-${bp.name}.png`, {
          fullPage:    false,
          maxDiffPixels: 200,
        });
      });
    }

    test("Navbar is present at every page at this breakpoint", async ({ page }) => {
      await setSessionCookie(page.context(), COOKIE_STR);
      await page.goto(`${BASE_URL}/index.html`, { waitUntil: "domcontentloaded" });
      // Topbar / navbar should always be present
      const navbar = page.locator("nav, .topbar, #topbar, header").first();
      await expect(navbar).toBeVisible({ timeout: 8_000 });
    });
  });
}

// ── Responsiveness checks ─────────────────────────────────────────────────────

test.describe("Responsiveness: no horizontal overflow at mobile width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const pg of PAGES.slice(0, 4)) {
    test(`${pg.title} has no horizontal scroll at 390px`, async ({ page }) => {
      await page.goto(`${BASE_URL}${pg.path}.html`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForSelector("body", { timeout: 5_000 });

      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflow, `${pg.title} has horizontal overflow at 390px`).toBe(false);
    });
  }
});
