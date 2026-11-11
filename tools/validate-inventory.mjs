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
// This agent release must report exposure (the schema keeps it optional for older agents).
const required = ["listeners", "firewall", "ssh", "updates"];
if (inv.os.id === "windows") required.push("windows");
for (const field of required) {
  if (inv[field] === undefined) {
    console.error(
      `::error::inventory.${field} is missing: the agent must report exposure and updates`,
    );
    process.exit(1);
  }
}
console.log(
  `valid: ${inv.hostname} · ${inv.os.prettyName} · ${inv.cpu.cores} CPUs · ` +
    `${inv.disks.length} disks · ${inv.services.length} services · ${inv.packageCount} packages (${inv.packageManager}) · ` +
    `${inv.listeners.length} listening sockets · firewall ${inv.firewall.kind}` +
    `${inv.firewall.active ? "" : " (inactive)"} · sshd ${inv.ssh.present ? `on ${inv.ssh.ports.join(",")}` : "absent"} · ` +
    `updates ${inv.updates.status}: ${inv.updates.pending.length} pending, ` +
    `${inv.updates.pending.filter((p) => p.security).length} security, reboot ${inv.updates.rebootRequired}`,
);
if (inv.windows) {
  const w = inv.windows;
  console.log(
    `windows: ${w.server ? "server" : "client"} · defender ${w.defender ? `rtp ${w.defender.realTimeProtection}` : "absent"} · ` +
      `bitlocker ${w.bitlocker} · rdp ${w.rdp.enabled ? `on (nla ${w.rdp.nla})` : "off"} · smb1 ${w.smb1} · uac ${w.uac} · ` +
      `secure boot ${w.secureBoot} · ${w.admins.length} admins · profiles ${w.firewallProfiles
        .map((p) => `${p.name}${p.active ? "*" : ""}=${p.enabled ? "on" : "off"}`)
        .join(",")} · allowed ranges ${inv.firewall.allowed.length}`,
  );
}
