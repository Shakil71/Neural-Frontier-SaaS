"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  EnrollmentKeySchema,
  type IssuedEnrollmentKey,
  IssuedEnrollmentKeySchema,
  type ServerDetail,
  ServerDetailSchema,
  type ServerStatus,
  type ServerSummary,
  ServerSummarySchema,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Cpu,
  HardDrive,
  KeySquare,
  MemoryStick,
  Network,
  Package,
  Plus,
  Search,
  Server,
  ServerOff,
  Terminal,
  Timer,
  Trash2,
  Workflow,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useDeferredValue, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, SheetContent } from "@/components/ui/overlays";
import {
  Badge,
  Card,
  FieldError,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  Textarea,
} from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const keys = { servers: ["servers"] as const, enrollment: ["agent-enrollment-keys"] as const };
const KeysSchema = z.object({
  keys: z.array(EnrollmentKeySchema),
  agentAvailable: z.boolean(),
  certificatePin: z.string().nullable(),
});

const errorMessage = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Something went wrong";

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatUptime(s: number | null): string {
  if (s === null) return "—";
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

const STATUS: Record<
  ServerStatus,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  online: { label: "Online", tone: "success" },
  stale: { label: "Not reporting", tone: "warning" },
  offline: { label: "Offline", tone: "danger" },
  retired: { label: "Retired", tone: "neutral" },
};

function StatusBadge({ status }: { status: ServerStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone}>
      <span className="relative flex size-1.5" aria-hidden>
        {status === "online" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
        )}
        <span className="relative inline-flex size-1.5 rounded-full bg-current" />
      </span>
      {s.label}
    </Badge>
  );
}

function Meter({ value, label }: { value: number | null; label: string }) {
  const pct = value === null ? null : Math.round(value * 100);
  const tone =
    pct === null ? "bg-border" : pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warning" : "bg-primary";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11.5px]">
        <span className="text-subtle">{label}</span>
        <span data-numeric className="font-medium text-foreground">
          {pct === null ? "—" : `${pct}%`}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-700", tone)}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function memoryUse(s: ServerSummary) {
  return s.memory && s.memory.totalBytes > 0
    ? 1 - s.memory.availableBytes / s.memory.totalBytes
    : null;
}

/* ── Add server ───────────────────────────────────────────────────────── */

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative rounded-lg border border-border-strong bg-[oklch(0.13_0.026_268)] p-3.5 pr-12">
      <code className="block break-all font-mono text-[12px] leading-relaxed text-[oklch(0.9_0.02_268)]">
        <span className="select-none text-[oklch(0.7_0.15_160)]">$ </span>
        {value}
      </code>
      <button
        type="button"
        aria-label="Copy install command"
        className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-[oklch(0.75_0.02_268)] hover:bg-white/10"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

const KeyFormSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120),
  lifetimeDays: z.coerce.number().int(),
  maxUses: z.string(),
});

function AddServer({ agentAvailable }: { agentAvailable: boolean }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedEnrollmentKey | null>(null);
  const form = useForm<z.input<typeof KeyFormSchema>, unknown, z.output<typeof KeyFormSchema>>({
    resolver: zodResolver(KeyFormSchema),
    defaultValues: { name: "Server rollout", lifetimeDays: 7, maxUses: "" },
  });
  const mutation = useMutation({
    mutationFn: (v: z.output<typeof KeyFormSchema>) =>
      api("/api/v1/agent-enrollment-keys", {
        method: "POST",
        body: {
          name: v.name,
          lifetimeDays: v.lifetimeDays,
          maxUses: v.maxUses ? Number(v.maxUses) : null,
        },
        schema: IssuedEnrollmentKeySchema,
      }),
    onSuccess: (res) => {
      setIssued(res);
      void client.invalidateQueries({ queryKey: keys.enrollment });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setIssued(null);
          form.reset();
        }
      }}
    >
      <D.Trigger asChild>
        <Button>
          <Plus /> Add server
        </Button>
      </D.Trigger>
      <DialogContent
        className="max-w-2xl"
        title={issued ? "Run this on the server" : "Add a Linux server"}
        description={
          issued
            ? "As root, on each server you want to add. The key is shown only now."
            : "Creates an enrollment key. The agent is read-only: it reports inventory and accepts no commands."
        }
      >
        {issued ? (
          <div className="space-y-4">
            <CopyBlock value={issued.installCommand} />
            <ul className="grid gap-2 text-[12.5px] text-muted sm:grid-cols-3">
              {[
                ["Verifies", "the download's SHA-256 before installing"],
                ["Installs", "a hardened systemd service (no capabilities)"],
                ["Reports", "every 5 minutes; appears here within seconds"],
              ].map(([a, b]) => (
                <li key={a} className="rounded-lg border border-border bg-surface-sunken/60 p-3">
                  <span className="block font-medium text-foreground">{a}</span>
                  {b}
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-subtle">
              Supports RHEL, Oracle Linux, Rocky, Alma, Fedora, Debian and Ubuntu (x86-64 and
              ARM64). Key expires {formatDateTime(issued.enrollmentKey.expiresAt)}
              {issued.enrollmentKey.maxUses
                ? ` or after ${issued.enrollmentKey.maxUses} servers`
                : ""}
              .
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            {!agentAvailable && (
              <p className="rounded-lg border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-[12.5px]">
                This deployment has no agent build yet (Go is needed on the build host). You can
                create a key now; installation works after the next deploy.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="k-name">Key name</Label>
              <Input
                id="k-name"
                {...form.register("name")}
                aria-invalid={!!form.formState.errors.name}
              />
              <FieldError>{form.formState.errors.name?.message}</FieldError>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="k-life">Valid for</Label>
                <NativeSelect id="k-life" {...form.register("lifetimeDays")}>
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="k-uses">Servers it can add</Label>
                <NativeSelect id="k-uses" {...form.register("maxUses")}>
                  <option value="">Unlimited</option>
                  <option value="1">1 server</option>
                  <option value="10">10 servers</option>
                  <option value="100">100 servers</option>
                </NativeSelect>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <D.Close asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </D.Close>
              <Button type="submit" loading={mutation.isPending}>
                <KeySquare /> Create key
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Server card and detail ───────────────────────────────────────────── */

function ServerCard({ s, index, onOpen }: { s: ServerSummary; index: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${s.hostname}`}
      className="group text-left focus-visible:outline-none"
    >
      <Card
        className={cn(
          "relative flex h-full flex-col overflow-hidden p-5 transition-[border-color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-border-strong group-focus-visible:ring-4 group-focus-visible:ring-ring/30",
          s.status === "retired" && "opacity-60",
        )}
        style={{ animationDelay: `${index * 40}ms` }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary-soft to-accent-soft text-primary ring-1 ring-inset ring-border">
            <Server className="size-[18px]" aria-hidden />
          </span>
          <StatusBadge status={s.status} />
        </div>
        <h2 className="mt-3.5 truncate font-mono text-[14px] font-semibold tracking-tight">
          {s.hostname}
        </h2>
        <p className="truncate text-[12.5px] text-muted">
          {s.os?.prettyName ?? "Waiting for first report"}
        </p>
        <div className="mt-4 grid gap-3">
          <Meter label="Memory" value={memoryUse(s)} />
          <Meter label="Fullest disk" value={s.diskPeak} />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3.5 text-[11.5px]">
          <div>
            <dt className="text-subtle">CPU</dt>
            <dd className="font-medium">{s.cpu ? `${s.cpu.cores} cores` : "—"}</dd>
          </div>
          <div>
            <dt className="text-subtle">Load</dt>
            <dd data-numeric className="font-medium">
              {s.loadAverage ? s.loadAverage[0].toFixed(2) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Uptime</dt>
            <dd className="font-medium">{formatUptime(s.uptimeSeconds)}</dd>
          </div>
        </dl>
        <p className="mt-3 truncate text-[11.5px] text-subtle">
          {s.ipAddresses[0] ?? "—"} · seen {formatRelative(s.lastSeenAt).toLowerCase()}
        </p>
      </Card>
    </button>
  );
}

type Tab = "overview" | "disks" | "network" | "services" | "packages";

function ServerSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = usePermissions();
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [filter, setFilter] = useState("");
  const [retireOpen, setRetireOpen] = useState(false);
  const q = useDeferredValue(filter.trim().toLowerCase());
  const detail = useQuery({
    queryKey: [...keys.servers, id],
    queryFn: () => api(`/api/v1/servers/${id}`, { schema: ServerDetailSchema }),
    enabled: !!id,
    refetchInterval: 30_000,
  });
  const s: ServerDetail | undefined = detail.data;
  const form = useForm({
    resolver: zodResolver(
      z.object({ reason: z.string().trim().min(3, "Give a reason of at least 3 characters") }),
    ),
    defaultValues: { reason: "" },
  });
  const retire = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/v1/servers/${id}`, { method: "DELETE", body: { reason } }),
    onSuccess: () => {
      toast.success("Server retired. Its agent can no longer report.");
      void client.invalidateQueries({ queryKey: keys.servers });
      setRetireOpen(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const services = useMemo(
    () =>
      s?.services.filter((x) => !q || `${x.name} ${x.description}`.toLowerCase().includes(q)) ?? [],
    [s, q],
  );
  const packages = useMemo(
    () => s?.packages.filter((x) => !q || `${x.name} ${x.version}`.toLowerCase().includes(q)) ?? [],
    [s, q],
  );

  const tabs: { id: Tab; label: string; icon: typeof Server; count?: number }[] = [
    { id: "overview", label: "Overview", icon: Server },
    { id: "disks", label: "Disks", icon: HardDrive, count: s?.disks.length },
    { id: "network", label: "Network", icon: Network, count: s?.interfaces.length },
    { id: "services", label: "Services", icon: Workflow, count: s?.services.length },
    { id: "packages", label: "Packages", icon: Package, count: s?.packageCount },
  ];

  return (
    <D.Root
      open={!!id}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setTab("overview");
          setFilter("");
        }
      }}
    >
      <SheetContent title={s?.hostname ?? "Server"} description={s?.os?.prettyName}>
        {detail.isPending && <Skeleton className="h-64" />}
        {detail.isError && (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        )}
        {s && (
          <div className="space-y-5 animate-fade-in">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={s.status} />
              {s.agentVersion && <Badge>agent {s.agentVersion}</Badge>}
              <Badge>last report {formatRelative(s.lastSeenAt).toLowerCase()}</Badge>
            </div>

            <div
              role="tablist"
              aria-label="Server details"
              className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-border"
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => {
                    setTab(t.id);
                    setFilter("");
                  }}
                  className={cn(
                    "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 pb-2.5 pt-1 text-[12.5px] font-medium transition-colors [&_svg]:size-3.5",
                    tab === t.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted hover:text-foreground",
                  )}
                >
                  <t.icon aria-hidden /> {t.label}
                  {t.count !== undefined && (
                    <span className="text-subtle">{formatNumber(t.count)}</span>
                  )}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      icon: Cpu,
                      label: "Processor",
                      value: s.cpu ? `${s.cpu.cores} cores` : "—",
                      sub: s.cpu?.model,
                    },
                    {
                      icon: MemoryStick,
                      label: "Memory",
                      value: s.memory ? formatBytes(s.memory.totalBytes) : "—",
                      sub: s.memory
                        ? `${formatBytes(s.memory.availableBytes)} available`
                        : undefined,
                    },
                    {
                      icon: Timer,
                      label: "Uptime",
                      value: formatUptime(s.uptimeSeconds),
                      sub: s.loadAverage
                        ? `load ${s.loadAverage.map((l) => l.toFixed(2)).join(" · ")}`
                        : undefined,
                    },
                    {
                      icon: Terminal,
                      label: "Kernel",
                      value: s.os?.arch ?? "—",
                      sub: s.os?.kernel,
                    },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded-xl border border-border bg-surface-sunken/60 p-3.5"
                    >
                      <p className="flex items-center gap-1.5 text-[11.5px] text-subtle">
                        <m.icon className="size-3.5" aria-hidden /> {m.label}
                      </p>
                      <p className="mt-1 text-[16px] font-semibold tracking-tight">{m.value}</p>
                      {m.sub && (
                        <p className="truncate text-[11.5px] text-muted" title={m.sub}>
                          {m.sub}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <Meter label="Memory in use" value={memoryUse(s)} />
                <Meter label="Fullest disk" value={s.diskPeak} />
                <dl className="divide-y divide-border rounded-xl border border-border text-[12.5px]">
                  {[
                    ["Machine ID", s.machineId],
                    ["Package manager", s.packageManager ?? "—"],
                    ["Enrolled", formatDateTime(s.enrolledAt)],
                    ["Last report", formatDateTime(s.lastSeenAt)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 px-3.5 py-2.5">
                      <dt className="text-subtle">{k}</dt>
                      <dd className="truncate font-mono text-[12px]">{v}</dd>
                    </div>
                  ))}
                </dl>
                {can("servers.manage") && s.status !== "retired" && (
                  <Button
                    variant="danger-soft"
                    className="w-full"
                    onClick={() => setRetireOpen(true)}
                  >
                    <ServerOff /> Retire server
                  </Button>
                )}
              </div>
            )}

            {tab === "disks" && (
              <ul className="space-y-2.5">
                {s.disks.map((d) => (
                  <li
                    key={`${d.device}${d.mount}`}
                    className="rounded-xl border border-border bg-surface-raised p-3.5"
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <span className="truncate font-mono text-[12.5px] font-medium">
                        {d.mount}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-subtle">
                        {formatBytes(d.usedBytes)} of {formatBytes(d.sizeBytes)}
                      </span>
                    </div>
                    <Meter
                      label={`${d.device} · ${d.fsType}`}
                      value={d.sizeBytes ? d.usedBytes / d.sizeBytes : null}
                    />
                  </li>
                ))}
              </ul>
            )}

            {tab === "network" && (
              <ul className="space-y-2.5">
                {s.interfaces.map((i) => (
                  <li
                    key={i.name}
                    className="rounded-xl border border-border bg-surface-raised p-3.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[12.5px] font-semibold">{i.name}</span>
                      <span className="font-mono text-[11px] text-subtle">{i.mac || "—"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {i.addresses.map((a) => (
                        <Badge key={a} className="font-mono">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {(tab === "services" || tab === "packages") && (
              <div className="space-y-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
                    aria-hidden
                  />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={
                      tab === "services" ? "Filter running services" : "Filter installed packages"
                    }
                    aria-label="Filter"
                    className="pl-9"
                  />
                </div>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {(tab === "services" ? services : packages).slice(0, 300).map((x) => (
                    <li
                      key={x.name + ("version" in x ? x.version : "")}
                      className="flex items-baseline justify-between gap-3 px-3.5 py-2"
                    >
                      <span className="truncate font-mono text-[12px]">{x.name}</span>
                      <span className="truncate text-right text-[11.5px] text-subtle">
                        {"version" in x ? x.version : x.description}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11.5px] text-subtle">
                  Showing{" "}
                  {formatNumber(Math.min(300, (tab === "services" ? services : packages).length))}{" "}
                  of {formatNumber((tab === "services" ? services : packages).length)}
                  {q ? " matches" : ""}.
                </p>
              </div>
            )}
          </div>
        )}
        <Dialog open={retireOpen} onOpenChange={setRetireOpen}>
          <DialogContent
            title={`Retire ${s?.hostname ?? "server"}?`}
            description="Its agent credential stops working immediately. Uninstall the agent on the host with: systemctl disable --now nf-agent"
          >
            <form
              onSubmit={form.handleSubmit((v) => retire.mutate(v.reason))}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="retire-reason">Reason</Label>
                <Textarea id="retire-reason" {...form.register("reason")} />
                <FieldError>{form.formState.errors.reason?.message}</FieldError>
              </div>
              <div className="flex justify-end gap-2">
                <D.Close asChild>
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </D.Close>
                <Button type="submit" variant="danger" loading={retire.isPending}>
                  Retire
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </D.Root>
  );
}

/* ── Enrollment keys ──────────────────────────────────────────────────── */

function EnrollmentKeys() {
  const { can } = usePermissions();
  const client = useQueryClient();
  const list = useQuery({
    queryKey: keys.enrollment,
    queryFn: () => api("/api/v1/agent-enrollment-keys", { schema: KeysSchema }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/agent-enrollment-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Enrollment key revoked");
      void client.invalidateQueries({ queryKey: keys.enrollment });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rows = list.data?.keys ?? [];
  if (rows.length === 0) return null;
  return (
    <Card className="mt-6 p-5">
      <h2 className="text-[14px] font-semibold">Enrollment keys</h2>
      <p className="mt-0.5 text-[12.5px] text-muted">
        Keys that can add servers. Revoke them once a rollout is done.
      </p>
      <ul className="mt-4 space-y-2">
        {rows.map((k) => {
          const dead =
            !!k.revokedAt ||
            new Date(k.expiresAt).getTime() <= list.dataUpdatedAt ||
            (k.maxUses !== null && k.uses >= k.maxUses);
          return (
            <li
              key={k.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3.5 py-2.5",
                dead && "opacity-60",
              )}
            >
              <KeySquare className="size-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{k.name}</p>
                <p className="text-[11.5px] text-subtle">
                  nfe_…{k.hint} · used {k.uses}
                  {k.maxUses ? ` of ${k.maxUses}` : ""} · expires {formatDateTime(k.expiresAt)}
                </p>
              </div>
              <Badge tone={k.revokedAt ? "neutral" : dead ? "danger" : "success"}>
                {k.revokedAt ? "Revoked" : dead ? "Expired" : "Active"}
              </Badge>
              {can("servers.manage") && !dead && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Revoke ${k.name}`}
                  onClick={() => revoke.mutate(k.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function Servers() {
  const { can } = usePermissions();
  const [openId, setOpenId] = useState<string | null>(null);
  const servers = useQuery({
    queryKey: keys.servers,
    queryFn: () => api("/api/v1/servers", { schema: z.array(ServerSummarySchema) }),
    enabled: can("servers.read"),
    refetchInterval: 30_000,
  });
  const meta = useQuery({
    queryKey: keys.enrollment,
    queryFn: () => api("/api/v1/agent-enrollment-keys", { schema: KeysSchema }),
    enabled: can("servers.read"),
  });
  if (!can("servers.read")) return <ForbiddenState permission="servers.read" />;
  const data = servers.data ?? [];
  const counts = {
    total: data.filter((s) => s.status !== "retired").length,
    online: data.filter((s) => s.status === "online").length,
    attention: data.filter((s) => s.status === "stale" || s.status === "offline").length,
    full: data.filter((s) => (s.diskPeak ?? 0) >= 0.9 && s.status !== "retired").length,
  };
  const add = can("servers.manage") ? (
    <AddServer agentAvailable={meta.data?.agentAvailable ?? true} />
  ) : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Servers"
        description="Linux servers reporting through the Neural Frontier agent: hardware, disks, network, running services and installed packages. Updated every 5 minutes."
        actions={add}
      />

      {servers.isError ? (
        <Card>
          <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />
        </Card>
      ) : servers.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={Server} title="No servers yet" action={add}>
            Add a server with a one-line command. The agent is read-only and reports inventory every
            five minutes.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Servers", value: counts.total, tone: "text-foreground" },
              { label: "Online", value: counts.online, tone: "text-success" },
              {
                label: "Need attention",
                value: counts.attention,
                tone: counts.attention ? "text-warning" : "text-foreground",
              },
              {
                label: "Disk ≥ 90% full",
                value: counts.full,
                tone: counts.full ? "text-danger" : "text-foreground",
              },
            ].map((c, i) => (
              <Card key={c.label} className="p-5" style={{ animationDelay: `${i * 40}ms` }}>
                <p className="text-[12px] text-subtle">{c.label}</p>
                <p
                  data-numeric
                  className={cn("mt-1 text-[26px] font-semibold tracking-tight", c.tone)}
                >
                  {formatNumber(c.value)}
                </p>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.map((s, i) => (
              <ServerCard key={s.id} s={s} index={i} onOpen={() => setOpenId(s.id)} />
            ))}
          </div>
        </>
      )}
      <EnrollmentKeys />
      <ServerSheet id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
