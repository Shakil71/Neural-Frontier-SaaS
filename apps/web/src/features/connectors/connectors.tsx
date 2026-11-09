"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ConnectionTestSchema,
  type Connector,
  ConnectorSchema,
  CreateConnectorSchema,
  type SyncRun,
  SyncRunSchema,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cable,
  CircleCheck,
  CircleX,
  Clock,
  Ellipsis,
  KeyRound,
  Loader2,
  Pause,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
  UsersRound,
  Boxes,
} from "lucide-react";
import Link from "next/link";
import { Dialog as D } from "radix-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SheetContent,
} from "@/components/ui/overlays";
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

const keys = {
  all: ["connectors"] as const,
  runs: (id: string) => ["connectors", "runs", id] as const,
};
const RunsPageSchema = z.object({
  items: z.array(SyncRunSchema),
  nextCursor: z.string().nullable(),
});

const INTERVALS = [
  { value: 0, label: "Manual only" },
  { value: 15, label: "Every 15 minutes" },
  { value: 60, label: "Every hour" },
  { value: 240, label: "Every 4 hours" },
  { value: 1440, label: "Once a day" },
];
const intervalLabel = (m: number) =>
  INTERVALS.find((i) => i.value === m)?.label ?? `Every ${m} minutes`;

function errorMessage(err: unknown) {
  return err instanceof ApiRequestError ? err.message : "Something went wrong";
}

function RunStatus({ status }: { status: SyncRun["status"] | null }) {
  if (status === "succeeded")
    return (
      <Badge tone="success" dot>
        Healthy
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge tone="danger" dot>
        Last sync failed
      </Badge>
    );
  if (status === "running" || status === "queued")
    return (
      <Badge tone="primary">
        <Loader2 className="size-3 animate-spin" aria-hidden /> Syncing
      </Badge>
    );
  return <Badge>Not synced yet</Badge>;
}

/* ── Create ───────────────────────────────────────────────────────────── */

const FormSchema = CreateConnectorSchema.omit({ kind: true, syncIntervalMinutes: true }).extend({
  syncIntervalMinutes: z.coerce.number().int(),
});
type FormValues = z.input<typeof FormSchema>;

function NewConnector() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<FormValues, unknown, z.output<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      directoryId: "",
      clientId: "",
      clientSecret: "",
      syncIntervalMinutes: 60,
    },
  });
  const mutation = useMutation({
    mutationFn: (v: z.output<typeof FormSchema>) =>
      api("/api/v1/connectors", {
        method: "POST",
        body: { kind: "microsoft_graph", ...v },
        schema: ConnectorSchema,
      }),
    onSuccess: (c) => {
      toast.success(`${c.name} connected`, {
        description: "Run a connection test, then start the first sync.",
      });
      void client.invalidateQueries({ queryKey: keys.all });
      setOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const e = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <D.Trigger asChild>
        <Button>
          <Plus /> Connect directory
        </Button>
      </D.Trigger>
      <DialogContent
        className="max-w-xl"
        title="Connect Microsoft Entra ID"
        description="Neural Frontier reads users, groups and memberships through Microsoft Graph. It never writes to your directory."
      >
        <details className="group mb-5 rounded-lg border border-border bg-surface-sunken/60 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
          <summary className="cursor-pointer select-none font-medium text-foreground">
            How to create the app registration
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Entra admin center → App registrations → New registration (single tenant).</li>
            <li>
              API permissions → Microsoft Graph → <b>Application</b> permissions:{" "}
              <code>User.Read.All</code> and <code>GroupMember.Read.All</code> → Grant admin
              consent.
            </li>
            <li>Certificates &amp; secrets → New client secret. Copy its value.</li>
            <li>Copy the Directory (tenant) ID and Application (client) ID from Overview.</li>
          </ol>
        </details>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              placeholder="e.g. Contoso Entra ID"
              aria-invalid={!!e.name}
              {...form.register("name")}
            />
            <FieldError>{e.name?.message}</FieldError>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-dir">Directory (tenant) ID</Label>
              <Input
                id="c-dir"
                placeholder="GUID or contoso.onmicrosoft.com"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-[12.5px]"
                aria-invalid={!!e.directoryId}
                {...form.register("directoryId")}
              />
              <FieldError>{e.directoryId?.message}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-app">Application (client) ID</Label>
              <Input
                id="c-app"
                placeholder="00000000-0000-0000-0000-000000000000"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-[12.5px]"
                aria-invalid={!!e.clientId}
                {...form.register("clientId")}
              />
              <FieldError>{e.clientId?.message}</FieldError>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-secret">Client secret value</Label>
            <Input
              id="c-secret"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!e.clientSecret}
              {...form.register("clientSecret")}
            />
            <p className="text-[12px] text-subtle">
              Encrypted with AES-256-GCM before it is stored. It is never shown again.
            </p>
            <FieldError>{e.clientSecret?.message}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-interval">Automatic sync</Label>
            <NativeSelect id="c-interval" {...form.register("syncIntervalMinutes")}>
              {INTERVALS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <D.Close asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </D.Close>
            <Button type="submit" loading={mutation.isPending}>
              <Cable /> Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Actions on one connector ─────────────────────────────────────────── */

function useConnectorMutations(c: Connector) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.all });
    void client.invalidateQueries({ queryKey: ["directory"] });
  };
  const sync = useMutation({
    mutationFn: () =>
      api(`/api/v1/connectors/${c.id}/sync`, { method: "POST", schema: SyncRunSchema }),
    onSuccess: () => {
      toast.success("Sync queued", { description: "Progress appears in the sync history." });
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const test = useMutation({
    mutationFn: () =>
      api(`/api/v1/connectors/${c.id}/test`, { method: "POST", schema: ConnectionTestSchema }),
    onSuccess: (r) =>
      r.ok
        ? toast.success(r.message)
        : toast.error("Connection failed", { description: r.message }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/v1/connectors/${c.id}`, {
        method: "PATCH",
        body: { version: c.version, ...body },
        schema: ConnectorSchema,
      }),
    onSuccess: () => refresh(),
    onError: (err) => {
      toast.error(errorMessage(err));
      refresh();
    },
  });
  return { sync, test, update, refresh };
}

function RotateSecret({
  c,
  open,
  onOpenChange,
}: {
  c: Connector;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { update } = useConnectorMutations(c);
  const form = useForm({
    resolver: zodResolver(
      z.object({ clientSecret: z.string().min(8, "Paste the new secret value").max(1024) }),
    ),
    defaultValues: { clientSecret: "" },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Replace client secret"
        description="Create a new secret in the app registration first, paste it here, then delete the old one in Entra."
      >
        <form
          onSubmit={form.handleSubmit((v) =>
            update.mutate(
              { clientSecret: v.clientSecret },
              {
                onSuccess: () => {
                  toast.success("Secret replaced");
                  onOpenChange(false);
                  form.reset();
                },
              },
            ),
          )}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="rotate-secret">New client secret value</Label>
            <Input
              id="rotate-secret"
              type="password"
              autoComplete="new-password"
              {...form.register("clientSecret")}
            />
            <FieldError>{form.formState.errors.clientSecret?.message}</FieldError>
          </div>
          <div className="flex justify-end gap-2">
            <D.Close asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </D.Close>
            <Button type="submit" loading={update.isPending}>
              <KeyRound /> Replace secret
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConnector({
  c,
  open,
  onOpenChange,
}: {
  c: Connector;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const client = useQueryClient();
  const form = useForm({
    resolver: zodResolver(
      z.object({
        reason: z.string().trim().min(3, "Give a reason of at least 3 characters").max(500),
      }),
    ),
    defaultValues: { reason: "" },
  });
  const mutation = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/v1/connectors/${c.id}`, { method: "DELETE", body: { reason } }),
    onSuccess: () => {
      toast.success(`${c.name} deleted`);
      void client.invalidateQueries({ queryKey: keys.all });
      void client.invalidateQueries({ queryKey: ["directory"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Delete ${c.name}?`}
        description={`Removes the connector and the ${formatNumber(c.counts.users)} users and ${formatNumber(c.counts.groups)} groups synced through it. Your Entra directory is not touched.`}
      >
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v.reason))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="del-reason">Reason</Label>
            <Textarea
              id="del-reason"
              aria-invalid={!!form.formState.errors.reason}
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
            <Button type="submit" variant="danger" loading={mutation.isPending}>
              <Trash2 /> Delete connector
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Card ─────────────────────────────────────────────────────────────── */

function ConnectorCard({ c, index, onOpen }: { c: Connector; index: number; onOpen: () => void }) {
  const { can } = usePermissions();
  const { sync, test, update } = useConnectorMutations(c);
  const [dialog, setDialog] = useState<"rotate" | "delete" | null>(null);
  const busy = c.lastSyncStatus === "queued" || c.lastSyncStatus === "running";
  const disabled = c.status === "disabled";

  return (
    <Card
      className={cn("group relative flex flex-col overflow-hidden", disabled && "opacity-75")}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-[radial-gradient(closest-side,var(--primary-glow),transparent)] opacity-60"
      />
      <div className="relative flex items-start gap-4 p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary-soft to-accent-soft text-primary ring-1 ring-inset ring-border">
          <Cable className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold tracking-tight">{c.name}</h2>
            {disabled && <Badge tone="warning">Paused</Badge>}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-subtle">
            {c.config.directoryId}
          </p>
        </div>
        {can("connectors.manage") && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                <Ellipsis />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => test.mutate()}>
                <PlugZap /> Test connection
              </MenuItem>
              <MenuItem onSelect={() => setDialog("rotate")}>
                <KeyRound /> Replace client secret
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  update.mutate(
                    { status: disabled ? "active" : "disabled" },
                    {
                      onSuccess: () =>
                        toast.success(disabled ? "Connector resumed" : "Connector paused"),
                    },
                  )
                }
              >
                {disabled ? <Play /> : <Pause />} {disabled ? "Resume syncing" : "Pause syncing"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                className="text-danger data-[highlighted]:bg-danger-soft"
                onSelect={() => setDialog("delete")}
              >
                <Trash2 /> Delete connector
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>

      <div className="relative grid grid-cols-2 gap-px border-y border-border bg-border">
        {[
          { icon: UsersRound, label: "Users", value: c.counts.users },
          { icon: Boxes, label: "Groups", value: c.counts.groups },
        ].map((s) => (
          <div key={s.label} className="bg-surface px-5 py-3.5">
            <p className="flex items-center gap-1.5 text-[11.5px] text-subtle">
              <s.icon className="size-3.5" aria-hidden /> {s.label}
            </p>
            <p data-numeric className="mt-0.5 text-[22px] font-semibold tracking-tight">
              {formatNumber(s.value)}
            </p>
          </div>
        ))}
      </div>

      <div className="relative flex flex-1 flex-col gap-3 p-5 text-[12.5px]">
        <div className="flex items-center justify-between gap-3">
          <RunStatus status={c.lastSyncStatus} />
          <span className="text-subtle" title={formatDateTime(c.lastSyncAt)}>
            {c.lastSyncAt ? `Last sync ${formatRelative(c.lastSyncAt)}` : "Never synced"}
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-subtle">
          <Clock className="size-3.5" aria-hidden /> {intervalLabel(c.syncIntervalMinutes)}
          <span aria-hidden>·</span> Secret {c.secretHint ?? "—"}
        </p>
        <div className="mt-auto flex gap-2 pt-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onOpen}>
            Sync history
          </Button>
          {can("connectors.sync") && (
            <Button
              size="sm"
              className="flex-1"
              disabled={disabled || busy}
              loading={sync.isPending}
              onClick={() => sync.mutate()}
            >
              <RefreshCw className={cn(busy && "animate-spin")} /> {busy ? "Syncing" : "Sync now"}
            </Button>
          )}
        </div>
      </div>
      <RotateSecret
        c={c}
        open={dialog === "rotate"}
        onOpenChange={(o) => setDialog(o ? "rotate" : null)}
      />
      <DeleteConnector
        c={c}
        open={dialog === "delete"}
        onOpenChange={(o) => setDialog(o ? "delete" : null)}
      />
    </Card>
  );
}

/* ── Sync history sheet ───────────────────────────────────────────────── */

function RunRow({ run }: { run: SyncRun }) {
  const tone =
    run.status === "succeeded"
      ? "text-success bg-success-soft"
      : run.status === "failed"
        ? "text-danger bg-danger-soft"
        : "text-primary bg-primary-soft";
  const Icon =
    run.status === "succeeded" ? CircleCheck : run.status === "failed" ? CircleX : Loader2;
  const duration =
    run.startedAt && run.finishedAt
      ? Math.max(
          1,
          Math.round(
            (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
          ),
        )
      : null;
  return (
    <li className="group relative flex gap-3.5 pb-5 last:pb-0">
      <span
        aria-hidden
        className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-border group-last:hidden"
      />
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", tone)}>
        <Icon
          className={cn(
            "size-4",
            run.status !== "succeeded" && run.status !== "failed" && "animate-spin",
          )}
          aria-hidden
        />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-medium capitalize">
            {run.status === "succeeded" ? `${run.mode ?? ""} sync` : run.status}
            <span className="ml-2 text-[11.5px] font-normal normal-case text-subtle">
              {run.trigger === "schedule" ? "scheduled" : "manual"}
              {run.attempts > 1 && ` · attempt ${run.attempts}`}
            </span>
          </p>
          <time
            className="text-[11.5px] text-subtle"
            dateTime={run.createdAt}
            title={formatDateTime(run.createdAt)}
          >
            {formatRelative(run.createdAt)}
          </time>
        </div>
        {run.status === "succeeded" && (
          <p className="mt-1.5 text-[12px] text-muted">
            {formatNumber(run.usersUpserted)} users and {formatNumber(run.groupsUpserted)} groups
            updated
            {(run.usersRemoved > 0 || run.groupsRemoved > 0) &&
              `, ${formatNumber(run.usersRemoved + run.groupsRemoved)} removed`}
            {duration !== null && ` · ${duration}s`}
          </p>
        )}
        {run.error && (
          <p
            className={cn(
              "mt-1.5 text-[12px]",
              run.status === "failed" ? "text-danger" : "text-warning",
            )}
          >
            {run.error}
          </p>
        )}
      </div>
    </li>
  );
}

function HistorySheet({
  connector,
  onClose,
}: {
  connector: Connector | null;
  onClose: () => void;
}) {
  const runs = useQuery({
    queryKey: keys.runs(connector?.id ?? "none"),
    queryFn: () =>
      api(`/api/v1/connectors/${connector!.id}/runs?limit=30`, { schema: RunsPageSchema }),
    enabled: !!connector,
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.status === "queued" || r.status === "running")
        ? 3000
        : false,
  });
  return (
    <D.Root open={!!connector} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Sync history" description={connector?.name}>
        {runs.isPending && <Skeleton className="h-40" />}
        {runs.isError && <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />}
        {runs.data &&
          (runs.data.items.length === 0 ? (
            <EmptyState icon={RefreshCw} title="No syncs yet">
              Start the first sync with “Sync now”. It runs in the background worker.
            </EmptyState>
          ) : (
            <ol className="animate-fade-in">
              {runs.data.items.map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
            </ol>
          ))}
      </SheetContent>
    </D.Root>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function Connectors() {
  const { can } = usePermissions();
  const [openId, setOpenId] = useState<string | null>(null);
  const connectors = useQuery({
    queryKey: keys.all,
    queryFn: () => api("/api/v1/connectors", { schema: z.array(ConnectorSchema) }),
    enabled: can("connectors.read"),
    refetchInterval: (q) =>
      q.state.data?.some((c) => c.lastSyncStatus === "queued" || c.lastSyncStatus === "running")
        ? 3000
        : false,
  });
  if (!can("connectors.read")) return <ForbiddenState permission="connectors.read" />;
  const open = connectors.data?.find((c) => c.id === openId) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Connectors"
        description={
          <>
            Read-only links to external directories. Synced people and groups appear in the{" "}
            <Link href="/directory" className="font-medium text-primary hover:underline">
              Directory
            </Link>
            ; they can&apos;t sign in until they are also identities.
          </>
        }
        actions={can("connectors.manage") ? <NewConnector /> : undefined}
      />
      {connectors.isError ? (
        <Card>
          <ErrorState error={connectors.error} onRetry={() => void connectors.refetch()} />
        </Card>
      ) : connectors.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : connectors.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Cable}
            title="No directories connected"
            action={can("connectors.manage") ? <NewConnector /> : undefined}
          >
            Connect Microsoft Entra ID to mirror your users, groups and memberships here. Sync is
            read-only and runs in the background.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connectors.data.map((c, i) => (
            <ConnectorCard key={c.id} c={c} index={i} onOpen={() => setOpenId(c.id)} />
          ))}
        </div>
      )}
      <HistorySheet connector={open} onClose={() => setOpenId(null)} />
    </>
  );
}
