import { spawnSync } from "child_process";

const steps = [
  { label: "Static checks", cmd: "node", args: ["scripts/static-checks.js"] },
  { label: "RBAC manifest check", cmd: "node", args: ["scripts/audit/feature-manifest.js"] },
  { label: "Server syntax checks", cmd: "npm", args: ["--prefix", "server", "run", "check:static"] },
  { label: "Server unit tests", cmd: "npm", args: ["--prefix", "server", "run", "test:unit"] },
  {
    label: "Server DB-backed integration tests",
    cmd: "npm",
    args: ["--prefix", "server", "run", "test:integration:all"],
  },
];

const startedAt = Date.now();
console.log("\n=== Rule Britannia alpha verification ===");

for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.label}`);
  const result = spawnSync(step.cmd, step.args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\n❌ verify:alpha failed at step: ${step.label}`);
    process.exit(result.status ?? 1);
  }
  console.log(`✅ ${step.label}`);
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n🎉 verify:alpha passed in ${elapsed}s`);
console.log("Summary: static + RBAC + server syntax + unit + DB-backed integration checks all passed.");
