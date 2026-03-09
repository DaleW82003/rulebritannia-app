import { test } from "node:test";
import assert from "node:assert/strict";
import { PREDEFINED_GUIDES, seedPredefinedGuides } from "./guides-seed.js";

class MockPool {
  constructor(initialItems = []) {
    this.items = initialItems.map((item) => ({ ...item }));
    this.nextId = this.items.reduce((maxId, item) => Math.max(maxId, item.id || 0), 0) + 1;
  }

  async query(sql, params = []) {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("SELECT title FROM guides_items")) {
      const titles = new Set(params[0]);
      const rows = this.items.filter((item) => titles.has(item.title)).map((item) => ({ title: item.title }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("UPDATE guides_items SET sort_order")) {
      const [title, sortOrder] = params;
      let changed = 0;
      this.items = this.items.map((item) => {
        if (item.title === title && item.sort_order !== sortOrder) {
          changed += 1;
          return { ...item, sort_order: sortOrder };
        }
        return item;
      });
      return { rows: [], rowCount: changed };
    }

    if (sql.startsWith("INSERT INTO guides_items")) {
      const [title, body, sortOrder] = params;
      this.items.push({ id: this.nextId++, title, body, sort_order: sortOrder });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected SQL in test mock: ${sql}`);
  }
}

test("PREDEFINED_GUIDES contains 15 entries in canonical order", () => {
  assert.equal(PREDEFINED_GUIDES.length, 15);
  assert.deepEqual(
    PREDEFINED_GUIDES.map((guide) => guide.title),
    [
      "Getting Started with a Character",
      "What to do Day to Day",
      "How Parliament Works in RB",
      "How the Press Works in RB",
      "How Activities Work in RB (Events, Fundraisers, Online)",
      "Phase 1 Breakdown and Next Phases",
      "Staff in RB",
      "Polling",
      "Elections",
      "Economy",
      "Political Capital",
      "Political Pressure",
      "Political Parties (and Their Factions)",
      "Party Shop and Modifiers",
      "MP Shop and Modifiers"
    ]
  );
});

test("seedPredefinedGuides seeds once, keeps bodies for existing guides, and is idempotent", async () => {
  const pool = new MockPool([
    { id: 1, title: "How Parliament Works in RB", body: "custom body", sort_order: 500 },
    { id: 2, title: "Player-made Guide", body: "kept", sort_order: 0 }
  ]);

  const firstRun = await seedPredefinedGuides(pool);
  assert.equal(firstRun.inserted, 14);
  assert.equal(firstRun.updated, 1);

  const secondRun = await seedPredefinedGuides(pool);
  assert.equal(secondRun.inserted, 0);
  assert.equal(secondRun.updated, 0);

  const seededTitles = PREDEFINED_GUIDES.map((guide) => guide.title);
  const canonicalItems = pool.items.filter((item) => seededTitles.includes(item.title));
  assert.equal(canonicalItems.length, 15);

  const orderedBySort = canonicalItems
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => item.title);
  assert.deepEqual(orderedBySort, seededTitles);

  const preserved = pool.items.find((item) => item.title === "How Parliament Works in RB");
  assert.equal(preserved.body, "custom body");

  const userGuide = pool.items.find((item) => item.title === "Player-made Guide");
  assert.equal(userGuide.body, "kept");
});
