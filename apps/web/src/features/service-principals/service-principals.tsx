"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type IssuedSecret,
  IssuedSecretSchema,
  MACHINE_PERMISSIONS,
  type MachinePermission,
  PERMISSIONS,
  type ServicePrincipal,
  ServicePrincipalSchema,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  Copy,
  KeyRound,
  KeySquare,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { formatDateTime, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const keys = { all: ["service-principals"] as const };
const LIFETIMES = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 365, label: "1 year" },
];

function errorMessage(err: unknown) {
  return err instanceof ApiRequestError ? err.message : "Something went wrong";
}

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2.5",
          secret ? "border-warning/40 bg-warning-soft/40" : "border-border bg-surface-sunken",
        )}
      >
        <code className="min-w-0 flex-1 break-all font-mono text-[12.5px]">{value}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy ${label}`}
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

/** Shows a freshly issued secret exactly once. */
function SecretReveal({ issued, onClose }: { issued: IssuedSecret | null; onClose: () => void }) {
  const [ack, setAck] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Dialog
      open={!!issued}
      onOpenChange={(o) => {
        if (!o && ack) {
          setAck(false);
          onClose();
        }
      }}
    >
      {issued && (
        <DialogContent
          className="max-w-xl"
          title="Copy the client secret now"
          description="This is the only time it will be shown. Neural Frontier stores only a hash of it."
        >
          <div className="space-y-4">
            <CopyField label="Client ID" value={issued.clientId} />
            <CopyField label="Client secret" value={issued.clientSecret} secret />
            <div className="rounded-lg border border-border bg-surface-sunken/60 p-3.5">
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted">
                <TerminalSquare className="size-3.5" aria-hidden /> Get an access token (valid 15
                minutes)
              </p>
              <pre className="scrollbar-thin overflow-x-auto font-mono text-[11.5px] leading-relaxed text-foreground">
                {`curl -s ${origin}/api/v1/oauth/token \\
  -u "$CLIENT_ID:$CLIENT_SECRET" \\
  -d grant_type=client_credentials`}
              </pre>
            </div>
            <p className="text-[12px] text-subtle">Expires {formatDateTime(issued.expiresAt)}.</p>
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              I have stored the secret somewhere safe
            </label>
            <div className="flex justify-end">
              <Button
                disabled={!ack}
                onClick={() => {
                  setAck(false);
                  onClose();
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

const CreateFormSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120),
  description: z.string().trim().max(500),
  permissions: z.array(z.enum(MACHINE_PERMISSIONS)).min(1, "Choose at least one permission"),
  secretLifetimeDays: z.coerce.number().int(),
});

function NewServicePrincipal({ onIssued }: { onIssued: (s: IssuedSecret) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<
    z.input<typeof CreateFormSchema>,
    unknown,
    z.output<typeof CreateFormSchema>
  >({
    resolver: zodResolver(CreateFormSchema),
    defaultValues: {
      name: "",
      description: "",
      permissions: ["directory.read"],
      secretLifetimeDays: 180,
    },
  });
  const mutation = useMutation({
    mutationFn: (v: z.output<typeof CreateFormSchema>) =>
      api("/api/v1/service-principals", { method: "POST", body: v, schema: IssuedSecretSchema }),
    onSuccess: (issued) => {
      void client.invalidateQueries({ queryKey: keys.all });
      setOpen(false);
      form.reset();
      onIssued(issued);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const selected = useWatch({ control: form.control, name: "permissions" });
  const e = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <D.Trigger asChild>
        <Button>
          <Plus /> New service principal
        </Button>
      </D.Trigger>
      <DialogContent
        className="max-w-xl"
        title="New service principal"
        description="A machine identity for scripts and integrations. It can read and trigger syncs, but can never change roles, identities or settings."
      >
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
              <Label htmlFor="sp-name">Name</Label>
              <Input
                id="sp-name"
                placeholder="e.g. SIEM export"
                aria-invalid={!!e.name}
                {...form.register("name")}
              />
              <FieldError>{e.name?.message}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-life">Secret lifetime</Label>
              <NativeSelect id="sp-life" {...form.register("secretLifetimeDays")}>
                {LIFETIMES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-desc">Description</Label>
            <Textarea
              id="sp-desc"
              className="min-h-16"
              placeholder="What uses it, and who owns it"
              {...form.register("description")}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-[13px] font-medium">Permissions</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {MACHINE_PERMISSIONS.map((p) => {
                const on = selected?.includes(p) ?? false;
                return (
                  <label
                    key={p}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                      on
                        ? "border-primary/50 bg-primary-soft/50"
                        : "border-border hover:bg-surface-sunken",
                    )}
                  >
                    <input
                      type="checkbox"
                      value={p}
                      className="mt-0.5 size-4 accent-[var(--primary)]"
                      {...form.register("permissions")}
                    />
                    <span className="min-w-0">
                      <span className="block font-mono text-[11.5px] text-foreground">{p}</span>
                      <span className="block text-[11.5px] leading-snug text-subtle">
                        {PERMISSIONS[p]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <FieldError>{e.permissions?.message}</FieldError>
          </fieldset>
          <div className="flex justify-end gap-2 pt-1">
            <D.Close asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </D.Close>
            <Button type="submit" loading={mutation.isPending}>
              <KeySquare /> Create and issue secret
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  danger,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
  pending: boolean;
  onConfirm: (reason: string) => void;
}) {
  const form = useForm({
    resolver: zodResolver(
      z.object({
        reason: z.string().trim().min(3, "Give a reason of at least 3 characters").max(500),
      }),
    ),
    defaultValues: { reason: "" },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <form onSubmit={form.handleSubmit((v) => onConfirm(v.reason))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
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
            <Button type="submit" variant={danger ? "danger" : "primary"} loading={pending}>
              {confirm}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function secretState(s: ServicePrincipal["secrets"][number]) {
  if (s.revokedAt) return { label: "Revoked", tone: "neutral" as const };
  const ms = new Date(s.expiresAt).getTime() - Date.now();
  if (ms <= 0) return { label: "Expired", tone: "danger" as const };
  if (ms < 14 * 86_400_000) return { label: "Expires soon", tone: "warning" as const };
  return { label: "Active", tone: "success" as const };
}

function PrincipalSheet({
  sp,
  onClose,
  onIssued,
}: {
  sp: ServicePrincipal | null;
  onClose: () => void;
  onIssued: (s: IssuedSecret) => void;
}) {
  const { can } = usePermissions();
  const client = useQueryClient();
  const [dialog, setDialog] = useState<
    { kind: "status" } | { kind: "revoke"; secretId: string; hint: string } | null
  >(null);
  const refresh = () => void client.invalidateQueries({ queryKey: keys.all });

  const rotate = useMutation({
    mutationFn: () =>
      api(`/api/v1/service-principals/${sp!.id}/secrets`, {
        method: "POST",
        body: {},
        schema: IssuedSecretSchema,
      }),
    onSuccess: (issued) => {
      refresh();
      onIssued(issued);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const revoke = useMutation({
    mutationFn: ({ secretId, reason }: { secretId: string; reason: string }) =>
      api(`/api/v1/service-principals/${sp!.id}/secrets/${secretId}`, {
        method: "DELETE",
        body: { reason },
      }),
    onSuccess: () => {
      toast.success("Secret revoked. Tokens issued with it stopped working.");
      refresh();
      setDialog(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const status = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/v1/service-principals/${sp!.id}`, {
        method: "PATCH",
        body: {
          version: sp!.version,
          status: sp!.status === "active" ? "disabled" : "active",
          reason,
        },
        schema: ServicePrincipalSchema,
      }),
    onSuccess: (u) => {
      toast.success(u.status === "active" ? `${u.name} enabled` : `${u.name} disabled`);
      refresh();
      setDialog(null);
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      refresh();
    },
  });

  const manage = can("service_principals.manage");
  return (
    <D.Root open={!!sp} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={sp?.name ?? "Service principal"}
        description={sp?.description || undefined}
      >
        {sp && (
          <div className="space-y-7 animate-fade-in">
            <div className="flex flex-wrap items-center gap-2">
              {sp.status === "active" ? (
                <Badge tone="success" dot>
                  Active
                </Badge>
              ) : (
                <Badge tone="danger" dot>
                  Disabled
                </Badge>
              )}
              <Badge>Last used {formatRelative(sp.lastUsedAt).toLowerCase()}</Badge>
            </div>
            <CopyField label="Client ID" value={sp.clientId} />

            <section>
              <h3 className="mb-3 text-[13.5px] font-semibold">Permissions</h3>
              <ul className="space-y-1.5">
                {sp.permissions.map((p: MachinePermission) => (
                  <li key={p} className="flex items-start gap-2.5 text-[12.5px]">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      <span className="font-mono text-[11.5px]">{p}</span>
                      <span className="block text-subtle">{PERMISSIONS[p]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[13.5px] font-semibold">Client secrets</h3>
                {manage && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={rotate.isPending}
                    onClick={() => rotate.mutate()}
                  >
                    <KeyRound /> New secret
                  </Button>
                )}
              </div>
              <p className="mb-3 text-[12px] leading-relaxed text-subtle">
                To rotate without downtime: issue a new secret, deploy it, then revoke the old one.
                Revoking takes effect immediately.
              </p>
              <ul className="space-y-2">
                {sp.secrets.map((s) => {
                  const st = secretState(s);
                  return (
                    <li
                      key={s.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3.5 py-2.5",
                        s.revokedAt && "opacity-60",
                      )}
                    >
                      <KeySquare className="size-4 shrink-0 text-muted" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[12.5px]">nfs_…{s.hint}</p>
                        <p className="text-[11.5px] text-subtle">
                          {s.revokedAt
                            ? `Revoked ${formatRelative(s.revokedAt)}`
                            : `Expires ${formatDateTime(s.expiresAt)} · used ${formatRelative(s.lastUsedAt).toLowerCase()}`}
                        </p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {manage && !s.revokedAt && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Revoke secret ending ${s.hint}`}
                          onClick={() =>
                            setDialog({ kind: "revoke", secretId: s.id, hint: s.hint })
                          }
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {manage && (
              <Button
                variant={sp.status === "active" ? "danger-soft" : "secondary"}
                className="w-full"
                onClick={() => setDialog({ kind: "status" })}
              >
                {sp.status === "active" ? <Pause /> : <Play />}
                {sp.status === "active" ? "Disable service principal" : "Enable service principal"}
              </Button>
            )}
          </div>
        )}
        {sp && (
          <>
            <ReasonDialog
              open={dialog?.kind === "status"}
              onOpenChange={(o) => !o && setDialog(null)}
              title={sp.status === "active" ? `Disable ${sp.name}?` : `Enable ${sp.name}?`}
              description={
                sp.status === "active"
                  ? "Every token it holds stops working immediately and it can't get new ones."
                  : "It can request access tokens again with its active secrets."
              }
              confirm={sp.status === "active" ? "Disable" : "Enable"}
              danger={sp.status === "active"}
              pending={status.isPending}
              onConfirm={(reason) => status.mutate(reason)}
            />
            <ReasonDialog
              open={dialog?.kind === "revoke"}
              onOpenChange={(o) => !o && setDialog(null)}
              title={`Revoke secret ending ${dialog?.kind === "revoke" ? dialog.hint : ""}?`}
              description="Anything using this secret, and every token issued with it, stops working immediately."
              confirm="Revoke secret"
              danger
              pending={revoke.isPending}
              onConfirm={(reason) =>
                dialog?.kind === "revoke" && revoke.mutate({ secretId: dialog.secretId, reason })
              }
            />
          </>
        )}
      </SheetContent>
    </D.Root>
  );
}

export function ServicePrincipals() {
  const { can } = usePermissions();
  const [openId, setOpenId] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedSecret | null>(null);
  const list = useQuery({
    queryKey: keys.all,
    queryFn: () => api("/api/v1/service-principals", { schema: z.array(ServicePrincipalSchema) }),
    enabled: can("service_principals.read"),
  });
  if (!can("service_principals.read"))
    return <ForbiddenState permission="service_principals.read" />;
  const open = list.data?.find((s) => s.id === openId) ?? null;
  const manage = can("service_principals.manage");

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Service principals"
        description="Machine identities for automation, using OAuth 2.0 client credentials. Tokens last 15 minutes and are re-checked on every request, so revoking is instant."
        actions={manage ? <NewServicePrincipal onIssued={setIssued} /> : undefined}
      />
      {list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : list.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : list.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bot}
            title="No service principals"
            action={manage ? <NewServicePrincipal onIssued={setIssued} /> : undefined}
          >
            Create one for each script or integration, with only the permissions it needs.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((sp, i) => {
            const live = sp.secrets.filter(
              (s) => secretState(s).label !== "Revoked" && secretState(s).label !== "Expired",
            );
            const expiring = live.some((s) => secretState(s).label === "Expires soon");
            return (
              <button
                key={sp.id}
                type="button"
                onClick={() => setOpenId(sp.id)}
                className="group text-left focus-visible:outline-none"
                aria-label={`Open ${sp.name}`}
              >
                <Card
                  className="flex h-full flex-col p-5 transition-[border-color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-border-strong group-focus-visible:ring-4 group-focus-visible:ring-ring/30"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
                      <Bot className="size-[18px]" aria-hidden />
                    </span>
                    {sp.status === "active" ? (
                      expiring ? (
                        <Badge tone="warning">
                          <TriangleAlert className="size-3" aria-hidden /> Secret expiring
                        </Badge>
                      ) : (
                        <Badge tone="success" dot>
                          Active
                        </Badge>
                      )
                    ) : (
                      <Badge tone="danger" dot>
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <h2 className="mt-4 truncate text-[15px] font-semibold tracking-tight">
                    {sp.name}
                  </h2>
                  <p className="mt-1 line-clamp-2 flex-1 text-[12.5px] leading-relaxed text-muted">
                    {sp.description || "No description"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {sp.permissions.slice(0, 3).map((p) => (
                      <Badge key={p} className="font-mono text-[10.5px]">
                        {p}
                      </Badge>
                    ))}
                    {sp.permissions.length > 3 && <Badge>+{sp.permissions.length - 3}</Badge>}
                  </div>
                  <p className="mt-4 border-t border-border pt-3 text-[12px] text-subtle">
                    {live.length} active {live.length === 1 ? "secret" : "secrets"} · last used{" "}
                    {formatRelative(sp.lastUsedAt).toLowerCase()}
                  </p>
                </Card>
              </button>
            );
          })}
        </div>
      )}
      <PrincipalSheet sp={open} onClose={() => setOpenId(null)} onIssued={setIssued} />
      <SecretReveal issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}
