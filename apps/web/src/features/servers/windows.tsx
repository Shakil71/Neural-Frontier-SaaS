"use client";

import type { AgentWindows } from "@nf/contracts";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Fingerprint,
  HardDrive,
  MonitorSmartphone,
  Network,
  ShieldHalf,
  ShieldUser,
  UserRoundX,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

type State = "good" | "bad" | "unknown";

interface Check {
  icon: typeof CircleCheck;
  label: string;
  value: string;
  sub?: string;
  /** Extra detail on hover. */
  title?: string;
  state: State;
}

const DAY_MS = 86_400_000;

const STATE_ICON: Record<State, { icon: typeof CircleCheck; className: string; label: string }> = {
  good: { icon: CircleCheck, className: "text-success", label: "OK" },
  bad: { icon: CircleAlert, className: "text-warning", label: "Needs attention" },
  unknown: { icon: CircleHelp, className: "text-subtle", label: "Not known" },
};

const BITLOCKER: Record<AgentWindows["bitlocker"], { value: string; state: State; sub?: string }> =
  {
    on: { value: "Encrypted", state: "good" },
    off: { value: "Not encrypted", state: "bad" },
    suspended: { value: "Suspended", state: "bad", sub: "Encrypted, key in the clear" },
    encrypting: { value: "Encrypting…", state: "good" },
    unavailable: { value: "Not available", state: "unknown", sub: "This edition has no BitLocker" },
    unknown: { value: "Not known", state: "unknown", sub: "The agent couldn't ask" },
  };

function flag(
  v: boolean | null,
  on: string,
  off: string,
  goodWhen: boolean,
): Pick<Check, "value" | "state"> {
  if (v === null) return { value: "Not known", state: "unknown" };
  return { value: v ? on : off, state: v === goodWhen ? "good" : "bad" };
}

function antivirus(w: AgentWindows, collectedAt: string | null): Check {
  const d = w.defender;
  const others = w.antivirus.filter((a) => a.enabled && !/defender/i.test(a.name));
  if (d && d.antivirusEnabled && d.realTimeProtection) {
    const age =
      d.signaturesUpdatedAt && collectedAt
        ? Math.floor((Date.parse(collectedAt) - Date.parse(d.signaturesUpdatedAt)) / DAY_MS)
        : null;
    return {
      icon: ShieldHalf,
      label: "Antivirus",
      value: "Microsoft Defender",
      title: d.signaturesUpdatedAt
        ? `Signatures updated ${formatDateTime(d.signaturesUpdatedAt)}`
        : undefined,
      sub:
        age === null
          ? "Real-time protection on"
          : `Signatures ${age <= 0 ? "from today" : `${age} ${age === 1 ? "day" : "days"} old`}`,
      state: age !== null && age >= 7 ? "bad" : "good",
    };
  }
  if (others.length > 0) {
    return {
      icon: ShieldHalf,
      label: "Antivirus",
      value: others.map((a) => a.name).join(", "),
      sub: others.every((a) => a.upToDate) ? "On and up to date" : "Out of date",
      state: others.every((a) => a.upToDate) ? "good" : "bad",
    };
  }
  if (!d && w.antivirus.length === 0) {
    return { icon: ShieldHalf, label: "Antivirus", value: "Not confirmed", state: "unknown" };
  }
  return {
    icon: ShieldHalf,
    label: "Antivirus",
    value: "Off",
    sub: d?.antivirusEnabled ? "Real-time protection is off" : "No active antivirus",
    state: "bad",
  };
}

/** Windows protection settings, shown on the Security tab of a Windows host. */
export function WindowsPosture({
  w,
  collectedAt,
}: {
  w: AgentWindows;
  collectedAt: string | null;
}) {
  const bitlocker = BITLOCKER[w.bitlocker];
  const checks: Check[] = [
    antivirus(w, collectedAt),
    {
      icon: HardDrive,
      label: `Disk encryption (${w.systemDrive || "system drive"})`,
      ...bitlocker,
    },
    {
      icon: MonitorSmartphone,
      label: "Remote Desktop",
      value: w.rdp.enabled ? `On, port ${w.rdp.port}` : "Off",
      sub: w.rdp.enabled
        ? w.rdp.nla === false
          ? "Without Network Level Authentication"
          : "Network Level Authentication required"
        : undefined,
      state: w.rdp.enabled && w.rdp.nla === false ? "bad" : "good",
    },
    {
      icon: Network,
      label: "SMB 1.0",
      ...flag(w.smb1, "On", "Off", false),
    },
    {
      icon: ShieldUser,
      label: "User Account Control",
      ...flag(w.uac, "On", "Off", true),
    },
    {
      icon: UserRoundX,
      label: "Guest account",
      ...flag(w.guestEnabled, "Enabled", "Disabled", false),
    },
    {
      icon: Fingerprint,
      label: "Secure Boot",
      ...flag(w.secureBoot, "On", "Off", true),
      sub: w.secureBoot === null ? "Legacy BIOS, or not readable" : undefined,
    },
  ];

  return (
    <section aria-label="Windows protection" className="space-y-3">
      <h3 className="text-[13px] font-semibold">Windows protection</h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {checks.map((c) => {
          const s = STATE_ICON[c.state];
          return (
            <li
              key={c.label}
              title={c.title}
              className="flex items-start gap-3 rounded-xl border border-border bg-surface-sunken/60 px-3.5 py-3"
            >
              <c.icon className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] text-subtle">{c.label}</p>
                <p className="truncate text-[13px] font-medium" title={c.value}>
                  {c.value}
                </p>
                {c.sub && <p className="text-[11.5px] text-muted">{c.sub}</p>}
              </div>
              <s.icon
                className={cn("mt-0.5 size-4 shrink-0", s.className)}
                aria-label={s.label}
                role="img"
              />
            </li>
          );
        })}
      </ul>

      {w.firewallProfiles.length > 0 && (
        <div className="rounded-xl border border-border">
          <p className="border-b border-border px-3.5 py-2 text-[11.5px] text-subtle">
            Firewall profiles
          </p>
          <ul className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {w.firewallProfiles.map((p) => (
              <li key={p.name} className="px-3.5 py-2.5">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium capitalize">
                  {p.name}
                  {p.active && (
                    <span className="rounded-full bg-primary-soft px-1.5 py-px text-[10.5px] font-medium normal-case text-primary">
                      connected
                    </span>
                  )}
                </p>
                <p
                  className={cn(
                    "text-[11.5px]",
                    p.enabled && !p.defaultInboundAllow ? "text-muted" : "text-warning",
                  )}
                >
                  {!p.enabled
                    ? "Off"
                    : p.defaultInboundAllow
                      ? "On, allows inbound by default"
                      : "On, blocks inbound by default"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-border px-3.5 py-2.5">
        <p className="flex items-center gap-1.5 text-[11.5px] text-subtle">
          <Users className="size-3.5" aria-hidden /> Local administrators
        </p>
        {w.admins.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-muted">Not readable on this host.</p>
        ) : (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {w.admins.map((a) => (
              <li
                key={a}
                className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11.5px]"
              >
                {a}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
