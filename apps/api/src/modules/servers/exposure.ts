import type {
  AgentFirewall,
  AgentListener,
  AgentSsh,
  FindingCounts,
  FindingSeverity,
  ListenerReach,
  ServerFinding,
  ServerListener,
} from "@nf/contracts";

/**
 * Network exposure analysis (Phase 4a). Pure functions over what the agent reported: where each
 * listening socket can be reached from, and which findings follow. No I/O, unit-tested.
 *
 * Limits, stated in the UI too: the analysis sees the host firewall only. A cloud security
 * group or an upstream firewall may block more, and container runtimes (Docker) can publish
 * ports that bypass firewalld.
 */

type Scope = ServerListener["scope"];

const SERVICES: Record<number, string> = {
  21: "FTP",
  22: "SSH",
  23: "Telnet",
  25: "SMTP",
  53: "DNS",
  80: "HTTP",
  111: "rpcbind",
  123: "NTP",
  135: "Windows RPC",
  139: "NetBIOS",
  143: "IMAP",
  161: "SNMP",
  389: "LDAP",
  443: "HTTPS",
  445: "SMB",
  465: "SMTPS",
  587: "Mail submission",
  636: "LDAPS",
  993: "IMAPS",
  995: "POP3S",
  1433: "SQL Server",
  1521: "Oracle Database",
  2049: "NFS",
  2375: "Docker API",
  2376: "Docker API (TLS)",
  2379: "etcd",
  3306: "MySQL",
  3389: "Remote Desktop",
  5432: "PostgreSQL",
  5672: "RabbitMQ",
  5900: "VNC",
  5984: "CouchDB",
  6379: "Redis",
  6443: "Kubernetes API",
  8086: "InfluxDB",
  9092: "Kafka",
  9200: "Elasticsearch",
  10250: "Kubelet",
  11211: "Memcached",
  27017: "MongoDB",
};

/**
 * Services that should not be reachable from a network unless deliberately protected:
 * databases, caches, management APIs, file sharing and clear-text protocols.
 */
const SENSITIVE = new Set([
  21, 23, 111, 135, 139, 161, 445, 1433, 1521, 2049, 2375, 2376, 2379, 3306, 3389, 5432, 5672, 5900,
  5984, 6379, 8086, 9092, 9200, 10250, 11211, 27017,
]);

export function serviceName(port: number): string | null {
  return SERVICES[port] ?? null;
}

function ipv4(addr: string): number[] | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

/** Where an address is reachable from, by its kind. */
export function addressScope(address: string): Scope {
  const a = address.toLowerCase().replace(/%.*$/, "").split("/")[0]!;
  if (a === "0.0.0.0" || a === "::" || a === "*") return "all";
  if (a === "::1") return "loopback";
  const v4 = ipv4(a);
  if (v4) {
    const [x, y] = v4 as [number, number];
    if (x === 127) return "loopback";
    if (
      x === 10 ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 169 && y === 254)
    ) {
      return "private";
    }
    return "public";
  }
  // IPv6: unique local fc00::/7 and link-local fe80::/10 are private.
  if (/^f[cd][0-9a-f]{0,2}:/.test(a) || /^fe[89ab][0-9a-f]?:/.test(a)) return "private";
  return "public";
}

/** Whether the host has a public address on any interface (from the inventory). */
export function hasPublicAddress(interfaceAddresses: string[]): boolean {
  return interfaceAddresses.some((a) => addressScope(a) === "public");
}

/** What the host firewall does with incoming traffic to proto/port. */
export function firewallReach(
  fw: AgentFirewall,
  proto: AgentListener["proto"],
  port: number,
): Exclude<ListenerReach, "local"> {
  if (!fw.active || fw.kind === "none") return "open";
  if (!fw.rulesKnown) return "unknown";
  const matching = fw.allowed.filter((r) => r.proto === proto && port >= r.from && port <= r.to);
  if (matching.some((r) => r.scope === "any")) return "allowed";
  if (fw.defaultAllow) return "open";
  if (matching.length > 0) return "limited";
  return "blocked";
}

export function analyseListeners(listeners: AgentListener[], fw: AgentFirewall): ServerListener[] {
  return listeners.map((l) => {
    const scope = addressScope(l.address);
    return {
      ...l,
      scope,
      reach: scope === "loopback" ? "local" : firewallReach(fw, l.proto, l.port),
      service: serviceName(l.port),
    };
  });
}

type Draft = Omit<ServerFinding, "accepted">;

/**
 * Findings for one server. `publicHost` says whether the host has a public address: a socket on
 * every interface of a host with only private addresses is reachable from the private network
 * only, which lowers the severity.
 */
export function findings(input: {
  listeners: ServerListener[];
  firewall: AgentFirewall;
  ssh: AgentSsh;
  publicHost: boolean;
}): Draft[] {
  const { listeners, firewall, ssh, publicHost } = input;
  const out: Draft[] = [];
  const networked = listeners.filter((l) => l.scope !== "loopback");
  const fromInternet = (l: ServerListener) =>
    l.scope === "public" || (l.scope === "all" && publicHost);

  // Firewall
  const windows = firewall.kind === "windows";
  if ((!firewall.active || firewall.kind === "none") && networked.length > 0) {
    const services = `${networked.length} network ${networked.length === 1 ? "service accepts" : "services accept"} connections`;
    out.push({
      key: "firewall.none",
      severity: publicHost ? "high" : "medium",
      title: windows
        ? "Windows Firewall is off for the connected network"
        : "No firewall is running",
      detail: windows
        ? `The ${firewall.zones.join(" and ")} profile is off. ${services} and nothing on the host filters them.`
        : `${services} and nothing on the host filters them.`,
      remedy: windows
        ? "Turn Windows Firewall on for every profile (Windows Security → Firewall & network protection)."
        : "Turn on the distribution's firewall (firewalld or ufw) and allow only the ports that must be reachable.",
    });
  } else if (firewall.active && firewall.defaultAllow) {
    out.push({
      key: "firewall.default_allow",
      severity: "medium",
      title: "The firewall lets everything in by default",
      detail: windows
        ? `Windows Firewall allows inbound connections that no rule blocks on the ${firewall.zones.join(" and ")} profile, so it filters very little.`
        : `${firewall.kind} accepts incoming traffic that no rule blocks, so it filters very little.`,
      remedy: windows
        ? "Set inbound connections back to Block for that profile (Windows Defender Firewall → Advanced settings → Properties)."
        : "Set the default incoming policy to deny (ufw default deny incoming, or move interfaces out of the firewalld 'trusted' zone).",
    });
  }

  // Sensitive services reachable from the network (one finding per proto/port).
  const seen = new Set<string>();
  for (const l of networked) {
    if (!SENSITIVE.has(l.port) || l.reach === "blocked" || l.reach === "local") continue;
    const key = `port.exposed:${l.proto}:${l.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const wide = fromInternet(l);
    let severity: FindingSeverity;
    if (l.reach === "limited") severity = "low";
    else if (l.reach === "unknown") severity = wide ? "medium" : "low";
    else severity = wide ? "high" : "medium";
    const name = l.service ?? `Port ${l.port}`;
    const where = wide ? "the internet" : "the local network";
    const how =
      l.reach === "unknown"
        ? `The firewall's rules can't be read, so it may or may not be blocked.`
        : l.reach === "limited"
          ? "The firewall admits it only from specific source addresses."
          : l.reach === "allowed"
            ? "The firewall explicitly allows it."
            : "Nothing filters it.";
    out.push({
      key,
      severity,
      title: `${name} (${l.proto}/${l.port}) is reachable from ${where}`,
      detail: `Listening on ${l.address}${l.process ? ` (${l.process})` : l.user ? ` (user ${l.user})` : ""}. ${how}`,
      remedy: windows
        ? "Stop the service if it isn't needed, or limit its firewall rule to the addresses that need it (Remote IP address scope)."
        : "Bind the service to 127.0.0.1 or a private interface, or allow the port only from the hosts that need it.",
    });
  }

  // SSH: only when sshd actually listens on one of its configured ports.
  const sshListening =
    ssh.present && listeners.some((l) => l.proto === "tcp" && ssh.ports.includes(l.port));
  if (sshListening) {
    if (ssh.permitEmptyPasswords === "yes") {
      out.push({
        key: "ssh.empty_passwords",
        severity: "high",
        title: "SSH accepts accounts with empty passwords",
        detail: "PermitEmptyPasswords is yes.",
        remedy: `Set PermitEmptyPasswords no in ${windows ? "%ProgramData%\\ssh\\sshd_config" : "/etc/ssh/sshd_config"} and restart sshd.`,
      });
    }
    if (ssh.permitRootLogin === "yes") {
      out.push({
        key: "ssh.root_password",
        severity: "high",
        title: "root can sign in over SSH with a password",
        detail: "PermitRootLogin is yes, so the root password can be guessed over the network.",
        remedy: "Set PermitRootLogin no (or prohibit-password) and use named accounts with sudo.",
      });
    } else if (
      ssh.permitRootLogin === "prohibit-password" ||
      ssh.permitRootLogin === "forced-commands-only"
    ) {
      out.push({
        key: "ssh.root_key",
        severity: "low",
        title: "root can sign in over SSH with a key",
        detail: `PermitRootLogin is ${ssh.permitRootLogin}. Actions taken as root aren't tied to a person.`,
        remedy: "Set PermitRootLogin no and use named accounts with sudo.",
      });
    }
    const passwords = ssh.passwordAuthentication === "yes";
    const keyboard = ssh.kbdInteractiveAuthentication === "yes" && ssh.usePam === "yes";
    if (passwords || keyboard) {
      out.push({
        key: "ssh.password_auth",
        severity: "medium",
        title: "SSH accepts passwords",
        detail: passwords
          ? "PasswordAuthentication is yes, so passwords can be guessed over the network."
          : "KbdInteractiveAuthentication and UsePAM are yes, which lets PAM ask for a password.",
        remedy:
          "Use SSH keys and set PasswordAuthentication no and KbdInteractiveAuthentication no.",
      });
    }
  }

  const rank: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.key.localeCompare(b.key));
}

export function countOpen(list: ServerFinding[]): FindingCounts {
  const counts: FindingCounts = { high: 0, medium: 0, low: 0 };
  for (const f of list) if (!f.accepted) counts[f.severity]++;
  return counts;
}
