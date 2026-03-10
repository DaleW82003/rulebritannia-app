import { spawnSync } from "child_process";

const unitFiles = [
  "clock.test.js",
  "discourse.test.js",
  "identity-hardening.test.js",
  "internal-party-management.test.js",
  "parliamentary-political-state.integration.test.js",
  "rbac-helpers.test.js",
  "recompute-helpers.test.js",
  "roles.test.js",
  "service-modules.test.js",
  "state-contracts.test.js",
];

const result = spawnSync("node", ["--test", ...unitFiles], {
  stdio: "inherit",
  cwd: new URL("..", import.meta.url),
  env: process.env,
});

process.exit(result.status ?? 1);
