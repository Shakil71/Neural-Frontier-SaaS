"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type FindingCounts,
  type FindingSeverity,
  type ListenerReach,
  type ServerDetail,
  type ServerFinding,
  ServerFindingSchema,
  type ServerListener,
} from "@nf/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BrickWall,
  CircleCheck,
  KeyRound,
  RadioTower,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Badge, FieldError, Label, Textarea } from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber } from "@/lib/format";

/** Query keys the exposure views invalidate after a change. */
export const exposureKeys = {
  servers: ["servers"] as const,
  findings: ["server-findings"] as const,
  updates: ["server-updates"] as const,
};

export const SEVERITY: Record<
  FindingSeverity,
  { label: string; tone: "danger" | "warning" | "primary"; bar: string }
> = {
  high: { label: "High", tone: "danger", bar: "bg-danger" },
  medium: { label: "Medium", tone: "warning", bar: "bg-warning" },
  low: { label: "Low", tone: "primary", bar: "bg-primary" },
};

const REACH: Record<
  ListenerReach,
  { label: string; tone: "neutral" | "warning" | "accent" | "primary" | "success"; hint: string }
> = {
  local: {
    label: "Local only",
    tone: "neutral",
    hint: "Bound to loopback: only this machine can connect.",
  },
  open: { label: "Open", tone: "warning", hint: "Nothing on the host filters it." },
  allowed: { label: "Allowed", tone: "accent", hint: "The firewall allows it from anywhere." },
  limited: {
    label: "Limited",
    tone: "primary",
    hint: "The firewall allows it only from some sources.",
  },
  blocked: { label: "Blocked", tone: "success", hint: "Listening, but the firewall drops it." },
  unknown: { label: "Unknown", tone: "neutral", hint: "The firewall's rules can't be read." },
};

const SCOPE: Record<ServerListener["scope"], string> = {
  loopback: "loopback",
  private: "private address",
  public: "public address",
  all: "all interfaces",
};

const FIREWALL_NAMES: Record<string, string> = {
  firewalld: "firewalld",
  ufw: "ufw",
  nftables: "nftables",
  iptables: "iptables",
  none: "None",
};

/** Compact summary of open findings for cards and lists. */
export function FindingsPill({ counts }: { counts: FindingCounts | null }) {
  if (!counts) return null;
  const total = counts.high + counts.medium + counts.low;
  if (total === 0) {
    return (
      <Badge tone="success">
        <ShieldCheck className="size-3" aria-hidden /> No open findings
      </Badge>
    );
  }
  const top: FindingSeverity = counts.high ? "high" : counts.medium ? "medium" : "low";
  const parts = (["high", "medium", "low"] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${k}`);
  return (
    <Badge tone={SEVERITY[top].tone}>
      <ShieldAlert className="size-3" aria-hidden /> {parts.join(" · ")}
    </Badge>
  );
}

const AcceptSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason of at least 3 characters").max(500),
});

function AcceptDialog({
  open,
  onOpenChange,
  serverId,
  hostname,
  finding,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  serverId: string;
  hostname: string;
  finding: ServerFinding;
}) {
  const client = useQueryClient();
  const form = useForm({ resolver: zodResolver(AcceptSchema), defaultValues: { reason: "" } });
  const accept = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/v1/servers/${serverId}/findings/${encodeURIComponent(finding.key)}/acceptance`, {
        method: "PUT",
        body: { reason },
        schema: ServerFindingSchema,
      }),
    onSuccess: () => {
      toast.success("Finding accepted. It no longer counts as open.");
      void client.invalidateQueries({ queryKey: exposureKeys.servers });
      void client.invalidateQueries({ queryKey: exposureKeys.findings });
      void client.invalidateQueries({ queryKey: exposureKeys.updates });
      onOpenChange(false);
      form.reset();
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : "Something went wrong"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Accept this risk?"
        description={`${finding.title} on ${hostname}. It stays visible, marked as accepted, and the decision is recorded in the audit log. You can reopen it at any time.`}
      >
        <form onSubmit={form.handleSubmit((v) => accept.mutate(v.reason))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`accept-${finding.key}`}>Why is this acceptable?</Label>
            <Textarea
              id={`accept-${finding.key}`}
              placeholder="e.g. Only reachable from the database subnet, protected upstream"
              {...form.register("reason")}
            />
            <FieldError>{form.formState.errors.reason?.message}</FieldError>
          </div>
          <div className="flex justify-end gap-2">
            <D.Close asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </D.Close>
            <Button type="submit" loading={accept.isPending}>
              Accept risk
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One finding with its remedy and, for administrators, accept / reopen. */
export function FindingItem({
  finding,
  serverId,
  hostname,
  canManage,
  showHost,
  onOpenServer,
}: {
  finding: ServerFinding;
  serverId: string;
  hostname: string;
  canManage: boolean;
  showHost?: boolean;
  onOpenServer?: () => void;
}) {
  const client = useQueryClient();
  const [accepting, setAccepting] = useState(false);
  const sev = SEVERITY[finding.severity];
  const reopen = useMutation({
    mutationFn: () =>
      api(`/api/v1/servers/${serverId}/findings/${encodeURIComponent(finding.key)}/acceptance`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Finding reopened");
      void client.invalidateQueries({ queryKey: exposureKeys.servers });
      void client.invalidateQueries({ queryKey: exposureKeys.findings });
      void client.invalidateQueries({ queryKey: exposureKeys.updates });
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : "Something went wrong"),
  });
  const accepted = finding.accepted;
  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-surface-raised p-4 pl-5",
        accepted && "opacity-75",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-1", accepted ? "bg-border-strong" : sev.bar)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={accepted ? "neutral" : sev.tone}>{sev.label}</Badge>
        {showHost &&
          (onOpenServer ? (
            <button
              type="button"
              onClick={onOpenServer}
              className="rounded font-mono text-[12px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {hostname}
            </button>
          ) : (
            <span className="font-mono text-[12px] font-medium">{hostname}</span>
          ))}
        {accepted && <Badge tone="neutral">Accepted</Badge>}
      </div>
      <p className="mt-2 text-[13.5px] font-semibold leading-snug">{finding.title}</p>
      <p className="mt-1 text-[12.5px] text-muted">{finding.detail}</p>
      {accepted ? (
        <p className="mt-2.5 rounded-lg bg-surface-sunken/70 px-3 py-2 text-[12px] text-muted">
          <span className="font-medium text-foreground">Accepted by {accepted.acceptedBy}</span> on{" "}
          {formatDateTime(accepted.acceptedAt)}: “{accepted.reason}”
        </p>
      ) : (
        <p className="mt-2.5 flex gap-2 text-[12px] text-muted">
          <Wrench className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <span>{finding.remedy}</span>
        </p>
      )}
      {canManage && (
        <div className="mt-3 flex justify-end">
          {accepted ? (
            <Button
              size="sm"
              variant="ghost"
              loading={reopen.isPending}
              onClick={() => reopen.mutate()}
            >
              <RotateCcw /> Reopen
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setAccepting(true)}>
              Accept risk…
            </Button>
          )}
        </div>
      )}
      {!accepted && (
        <AcceptDialog
          open={accepting}
          onOpenChange={setAccepting}
          serverId={serverId}
          hostname={hostname}
          finding={finding}
        />
      )}
    </li>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-sunken/60 p-3.5">
      <p className="flex items-center gap-1.5 text-[11.5px] text-subtle">
        <Icon className="size-3.5" aria-hidden /> {label}
      </p>
      <p
        className={cn(
          "mt-1 text-[15px] font-semibold tracking-tight",
          tone === "good" && "text-success",
          tone === "bad" && "text-warning",
        )}
      >
        {value}
      </p>
      <p className="text-[11.5px] text-muted">{sub}</p>
    </div>
  );
}

/** The Security tab of the server panel. */
export function ExposurePanel({ s, canManage }: { s: ServerDetail; canManage: boolean }) {
  const e = s.exposure;
  if (!e) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong p-5 text-center">
        <ShieldAlert className="mx-auto size-6 text-subtle" aria-hidden />
        <p className="mt-2 text-[13px] font-medium">No exposure data from this server yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted">
          {s.status === "retired"
            ? "Retired servers aren't analysed."
            : "Its agent predates network exposure reporting. Run the install command (Add server) on it again to update the agent; the next report fills this in."}
        </p>
      </div>
    );
  }
  const fw = e.firewall;
  const networked = e.listeners.filter((l) => l.scope !== "loopback");
  const open = e.findings.filter((f) => !f.accepted);
  const sshAuth =
    e.ssh.passwordAuthentication === "yes" ||
    (e.ssh.kbdInteractiveAuthentication === "yes" && e.ssh.usePam === "yes")
      ? "passwords and keys"
      : "keys only";
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          icon={BrickWall}
          label="Firewall"
          value={fw.active ? FIREWALL_NAMES[fw.kind]! : "None running"}
          sub={
            !fw.active
              ? "Nothing filters incoming traffic"
              : !fw.rulesKnown
                ? "Running; rules not readable by the agent"
                : fw.defaultAllow
                  ? "Lets everything in by default"
                  : `${formatNumber(fw.allowed.length)} allow ${fw.allowed.length === 1 ? "rule" : "rules"}${fw.zones.length ? ` · ${fw.zones.join(", ")}` : ""}`
          }
          tone={fw.active && !fw.defaultAllow ? "good" : "bad"}
        />
        <Tile
          icon={KeyRound}
          label="SSH"
          value={e.ssh.present ? `Port ${e.ssh.ports.join(", ")}` : "Not configured"}
          sub={
            e.ssh.present ? `root: ${e.ssh.permitRootLogin} · ${sshAuth}` : "No sshd_config found"
          }
        />
        <Tile
          icon={RadioTower}
          label="Listening"
          value={`${formatNumber(networked.length)} on the network`}
          sub={`${formatNumber(e.listeners.length - networked.length)} local only`}
        />
      </div>

      <section aria-label="Findings">
        <h3 className="mb-2.5 text-[13px] font-semibold">
          Findings{" "}
          <span className="font-normal text-subtle">
            {open.length ? `${open.length} open` : ""}
          </span>
        </h3>
        {e.findings.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-soft px-3.5 py-3 text-[12.5px]">
            <CircleCheck className="size-4 text-success" aria-hidden /> Nothing to fix: no sensitive
            service is reachable and SSH is locked down.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {e.findings.map((f) => (
              <FindingItem
                key={f.key}
                finding={f}
                serverId={s.id}
                hostname={s.hostname}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Listening ports">
        <h3 className="mb-2.5 text-[13px] font-semibold">Listening ports</h3>
        {e.listeners.length === 0 ? (
          <p className="text-[12.5px] text-muted">Nothing is listening.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-surface-sunken/70 text-[11px] uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Port</th>
                  <th className="px-3 py-2 font-medium">Service</th>
                  <th className="px-3 py-2 font-medium">Bound to</th>
                  <th className="px-3 py-2 font-medium">Firewall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {e.listeners.map((l) => (
                  <tr key={`${l.proto}${l.address}${l.port}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono" data-numeric>
                      {l.port}
                      <span className="text-subtle">/{l.proto}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{l.service ?? "—"}</span>
                      {(l.process || l.user) && (
                        <span className="block text-[11px] text-subtle">
                          {l.process || `user ${l.user}`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono">{l.address}</span>
                      <span className="block text-[11px] text-subtle">{SCOPE[l.scope]}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={REACH[l.reach].tone} title={REACH[l.reach].hint}>
                        {REACH[l.reach].label}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2.5 text-[11.5px] text-subtle">
          Only this host&apos;s firewall is analysed. A cloud security group or an upstream firewall
          may block more, and container runtimes such as Docker can publish ports that bypass
          firewalld.
        </p>
      </section>
    </div>
  );
}
