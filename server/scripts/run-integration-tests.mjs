import { readdirSync } from "fs";
import { spawnSync } from "child_process";

const entries = readdirSync(new URL("..", import.meta.url))
  .filter((name) => name.endsWith(".integration.test.js"))
  .sort();

// DB-backed but not *.integration.test.js
const extraDbBacked = ["guides-seed.test.js"];

const testFiles = [...entries, ...extraDbBacked].filter(Boolean);

if (!testFiles.length) {
  console.error("No integration test files were found.");
  process.exit(1);
}

for (const file of testFiles) {
  console.log(`\n[integration] running ${file}`);
  const result = spawnSync("node", ["--test", file], {
    stdio: "inherit",
    cwd: new URL("..", import.meta.url),
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\n[integration] completed ${testFiles.length} DB-backed test file(s).`);
