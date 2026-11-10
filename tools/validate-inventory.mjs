// Validates an inventory produced by `nf-agent once` against the API contract
// (AgentInventorySchema), so the Go agent and the TypeScript API can't drift apart.
//
//   node tools/validate-inventory.mjs inventory.json
import { readFileSync } from "node:fs";
import { AgentInventorySchema } from "@nf/contracts";

const file = process.argv[2];
if (!file) {
  console.error("usage: validate-inventory.mjs <inventory.json>");
  process.exit(2);
}
const result = AgentInventorySchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
if (!result.success) {
  for (const issue of result.error.issues) {
    console.error(`::error::inventory.${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}
const inv = result.data;
console.log(
  `valid: ${inv.hostname} · ${inv.os.prettyName} · ${inv.cpu.cores} CPUs · ` +
    `${inv.disks.length} disks · ${inv.services.length} services · ${inv.packageCount} packages (${inv.packageManager})`,
);
