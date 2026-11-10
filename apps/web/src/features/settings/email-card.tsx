"use client";

import {
  type EmailSettings,
  EmailDeliveryListSchema,
  EmailSettingsResponseSchema,
  EmailSettingsSchema,
  EmailTestResultSchema,
  type SmtpSecurity,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Mail, Pencil, Send, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  FieldError,
  Input,
  Label,
  NativeSelect,
  Skeleton,
} from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const key = ["tenant", "email"] as const;
const deliveriesKey = ["tenant", "email", "deliveries"] as const;
const errorMessage = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Something went wrong";

const SECURITY: Record<SmtpSecurity, string> = {
  starttls: "STARTTLS (usually port 587)",
  tls: "TLS from the start (usually port 465)",
  none: "None (a relay on this server only)",
};

const PRESETS = [
  { label: "Port 587 + STARTTLS", port: 587, security: "starttls" as const },
  { label: "Port 465 + TLS", port: 465, security: "tls" as const },
  { label: "Relay on this server", host: "127.0.0.1", port: 25, security: "none" as const },
];

interface Draft {
  host: string;
  port: string;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
  enabled: boolean;
}

function draftOf(s: EmailSettings | null, orgName: string): Draft {
  return {
    host: s?.host ?? "",
    port: String(s?.port ?? 587),
    security: s?.security ?? "starttls",
    username: s?.username ?? "",
    password: "",
    fromAddress: s?.fromAddress ?? "",
    fromName: s?.fromName ?? `${orgName} via Neural Frontier`,
    enabled: s?.enabled ?? true,
  };
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-[11.5px] text-subtle">{hint}</p>}
    </div>
  );
}

function SettingsDialog({
  current,
  orgName,
  open,
  onOpenChange,
}: {
  current: EmailSettings | null;
  orgName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const client = useQueryClient();
  const [d, setD] = useState<Draft>(() => draftOf(current, orgName));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api("/api/v1/tenant/email", {
        method: "PUT",
        schema: EmailSettingsSchema,
        body: {
          host: d.host.trim(),
          port: Number(d.port),
          security: d.security,
          username: d.username.trim() || null,
          // Empty keeps the stored password; removing the user name removes it.
          ...(d.password ? { password: d.password } : d.username.trim() ? {} : { password: null }),
          fromAddress: d.fromAddress.trim(),
          fromName: d.fromName.trim(),
          enabled: d.enabled,
          ...(current ? { version: current.version } : {}),
        },
      }),
    onSuccess: (saved) => {
      client.setQueryData(key, { email: saved });
      toast.success("Email settings saved. Send a test to check them.");
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        title={current ? "Email delivery settings" : "Set up email delivery"}
        description="Your organisation's own mail server (SMTP). Neural Frontier sends password resets and sign-in links through it."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!d.host.trim() || !d.fromAddress.trim())
              return setError("Enter the server and the sender address.");
            save.mutate();
          }}
        >
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() =>
                  setD((x) => ({
                    ...x,
                    port: String(p.port),
                    security: p.security,
                    ...(p.host ? { host: p.host } : {}),
                  }))
                }
                className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted hover:border-border-strong hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
            <Field label="Mail server" htmlFor="smtp-host">
              <Input
                id="smtp-host"
                placeholder="smtp.example.com"
                value={d.host}
                onChange={(e) => set("host", e.target.value)}
              />
            </Field>
            <Field label="Port" htmlFor="smtp-port">
              <Input
                id="smtp-port"
                inputMode="numeric"
                value={d.port}
                onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
          <Field label="Encryption" htmlFor="smtp-security">
            <NativeSelect
              id="smtp-security"
              value={d.security}
              onChange={(e) => set("security", e.target.value as SmtpSecurity)}
            >
              {(Object.keys(SECURITY) as SmtpSecurity[]).map((k) => (
                <option key={k} value={k}>
                  {SECURITY[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="User name"
              htmlFor="smtp-user"
              hint="Leave empty if the server doesn't need sign-in."
            >
              <Input
                id="smtp-user"
                autoComplete="off"
                value={d.username}
                onChange={(e) => set("username", e.target.value)}
              />
            </Field>
            <Field
              label="Password"
              htmlFor="smtp-pass"
              hint={
                current?.passwordHint
                  ? `Stored (${current.passwordHint}). Leave empty to keep it.`
                  : "Stored encrypted."
              }
            >
              <Input
                id="smtp-pass"
                type="password"
                autoComplete="new-password"
                value={d.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Sender address"
              htmlFor="smtp-from"
              hint="Must be allowed to send through this server."
            >
              <Input
                id="smtp-from"
                type="email"
                placeholder="no-reply@example.com"
                value={d.fromAddress}
                onChange={(e) => set("fromAddress", e.target.value)}
              />
            </Field>
            <Field label="Sender name" htmlFor="smtp-from-name">
              <Input
                id="smtp-from-name"
                value={d.fromName}
                onChange={(e) => set("fromName", e.target.value)}
              />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={d.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            Send email (turn off to pause all sending)
          </label>
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              <Mail /> Save settings
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EmailCard({ orgName }: { orgName: string }) {
  const { can } = usePermissions();
  const manage = can("tenant.manage");
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const settings = useQuery({
    queryKey: key,
    queryFn: () => api("/api/v1/tenant/email", { schema: EmailSettingsResponseSchema }),
  });
  const deliveries = useQuery({
    queryKey: deliveriesKey,
    queryFn: () => api("/api/v1/tenant/email/deliveries", { schema: EmailDeliveryListSchema }),
    enabled: !!settings.data?.email,
    refetchInterval: 15_000,
  });
  const test = useMutation({
    mutationFn: () =>
      api("/api/v1/tenant/email/test", { method: "POST", schema: EmailTestResultSchema }),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Test sent to ${r.to}. Check the inbox.`);
      else toast.error(r.message);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api("/api/v1/tenant/email", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Email delivery removed.");
      client.setQueryData(key, { email: null });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const s = settings.data?.email ?? null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Email delivery"
        description="Your own mail server sends password resets and sign-in links. Nothing goes through a third-party mail service."
        action={
          s ? (
            s.enabled ? (
              s.lastTest?.ok ? (
                <Badge tone="success" dot>
                  Working
                </Badge>
              ) : s.lastTest ? (
                <Badge tone="danger" dot>
                  Last test failed
                </Badge>
              ) : (
                <Badge tone="warning">Not tested yet</Badge>
              )
            ) : (
              <Badge>Paused</Badge>
            )
          ) : (
            <Badge>Not set up</Badge>
          )
        }
      />
      <CardBody className="space-y-5">
        {settings.isPending && <Skeleton className="h-24" />}
        {settings.isError && (
          <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
        )}
        {settings.data && !s && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border-strong px-4 py-4">
            <p className="text-[13px] text-muted">
              Without email, administrators copy sign-in links by hand and &quot;Forgot
              password?&quot; isn&apos;t offered.
            </p>
            {manage && (
              <Button onClick={() => setEditing(true)}>
                <Mail /> Set up email
              </Button>
            )}
          </div>
        )}
        {s && (
          <>
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="text-[11.5px] text-subtle">Server</dt>
                <dd className="mt-0.5 font-mono text-[12.5px]">
                  {s.host}:{s.port}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-subtle">Encryption</dt>
                <dd className="mt-0.5">{SECURITY[s.security].split(" (")[0]}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-subtle">Sends as</dt>
                <dd className="mt-0.5 truncate" title={`${s.fromName} <${s.fromAddress}>`}>
                  {s.fromName} &lt;{s.fromAddress}&gt;
                </dd>
              </div>
            </dl>
            {s.lastTest && (
              <p
                className={cn(
                  "flex gap-2 rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed",
                  s.lastTest.ok
                    ? "border-success/30 bg-success-soft/40"
                    : "border-danger/30 bg-danger-soft/40",
                )}
              >
                {s.lastTest.ok ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                )}
                <span>
                  Test {formatRelative(s.lastTest.at).toLowerCase()}: {s.lastTest.message}
                </span>
              </p>
            )}
            {manage && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={test.isPending} onClick={() => test.mutate()}>
                  <Send /> Send me a test
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  <Trash2 /> Remove
                </Button>
              </div>
            )}
            <div>
              <h4 className="mb-2 text-[12.5px] font-semibold">Recent messages</h4>
              {deliveries.data?.deliveries.length ? (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {deliveries.data.deliveries.slice(0, 8).map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{m.subject}</span>
                        <span className="text-subtle"> → {m.to}</span>
                        {m.error && <span className="block truncate text-danger">{m.error}</span>}
                      </span>
                      <span className="shrink-0 text-subtle" title={formatDateTime(m.createdAt)}>
                        {formatRelative(m.createdAt)}
                      </span>
                      <Badge
                        tone={
                          m.status === "sent"
                            ? "success"
                            : m.status === "failed"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {m.status === "queued" && m.attempts > 0
                          ? `retrying (${m.attempts})`
                          : m.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-subtle">No messages sent yet.</p>
              )}
            </div>
          </>
        )}
      </CardBody>
      {editing && (
        <SettingsDialog current={s} orgName={orgName} open={editing} onOpenChange={setEditing} />
      )}
    </Card>
  );
}
