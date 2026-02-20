import express from "express";
import cors from "cors";
import { pool } from "./db.js";

const app = express();

app.use(express.json({ limit: "2mb" }));

// ✅ IMPORTANT: CORS so your UI can call your API
// Put BOTH your Render UI URL + your custom domain (if different)
const allow = new Set([
  "https://rulebritannia.org",
  "https://www.rulebritannia.org"
  // Add your Render static site URL too if it’s different, e.g.
  // "https://rulebritannia-ui.onrender.com"
]);

app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin / server-to-server / curl
      if (!origin) return cb(null, true);
      if (allow.has(origin)) return cb(null, true);
      return cb(new Error("CORS blocked: " + origin));
    }
  })
);

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      ok: true,
      time: result.rows[0].now
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// Create table if missing (simple boot-time safety)
async function ensureSchema() {
  const sql = `
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.query(sql);
}

// Read the entire sim state (single row)
app.get("/api/state", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT data, updated_at FROM app_state WHERE id = $1",
      ["main"]
    );
    if (!rows.length) return res.status(404).json({ error: "No state yet" });
    res.json({ data: rows[0].data, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Write the entire sim state (admin-only token for now)
app.post("/api/state", async (req, res) => {
  try {
    const token = req.header("x-admin-token") || "";
    if (!process.env.ADMIN_TOKEN) {
      return res.status(500).json({ error: "ADMIN_TOKEN not set on server" });
    }
    if (token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const data = req.body?.data;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Body must be { data: <object> }" });
    }

    await pool.query(
      `
      INSERT INTO app_state (id, data)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data,
          updated_at = NOW()
      `,
      ["main", JSON.stringify(data)]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] listening on :${PORT}`);
    });
  })
  .catch((e) => {
    console.error("[server] schema init failed", e);
    process.exit(1);
  });
