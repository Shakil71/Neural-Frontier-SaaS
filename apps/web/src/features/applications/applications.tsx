"use client";

import {
  type Application,
  ApplicationListSchema,
  type ApplicationType,
  type IssuedApplication,
  IssuedApplicationSchema,
  ApplicationSchema,
  RoleSchema,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  Check,
  Copy,
  Globe,
  KeySquare,
  Laptop,
  Pencil,
  Plus,
  Power,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/states/states";
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
  Skeleton,
  Textarea,
} from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const key = ["applications"] as const;
const errorMessage = (err: unknown) =>
  err instanceof ApiRequestError
    ? err.details?.[0]
      ? `${err.message}: ${err.details[0].message}`
      : err.message
    : "Something went wrong";

const TYPES: Record<ApplicationType, { label: string; hint: string; icon: ReactNode }> = {
  web: {
    label: "Web app with a back end",
    hint: "Runs on a server that can keep a client secret (e.g. Node, .NET, PHP, Java).",
    icon: <Globe />,
  },
  spa: {
    label: "Single-page app",
    hint: "Runs only in the browser (React, Vue, Angular). No secret; PKCE protects it.",
    icon: <Laptop />,
  },
  native: {
    label: "Mobile or desktop app",
    hint: "Installed apps. Use a custom-scheme or loopback redirect address. No secret.",
    icon: <Smartphone />,
  },
};

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-[11.5px] font-medium text-subtle">{label}</p>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2",
          secret ? "border-warning/40 bg-warning-soft/40" : "border-border bg-surface-sunken",
        )}
      >
        <code className="min-w-0 flex-1 break-all font-mono text-[12px]">{value}</code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          className="rounded p-1 text-subtle hover:text-foreground"
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

const lines = (s: string) =>
  s
    .split(/\s*\n\s*/)
    .map((l) => l.trim())
    .filter(Boolean);

function AppForm({
  existing,
  onDone,
}: {
  existing: Application | null;
  onDone: (issued: IssuedApplication | null) => void;
}) {
  const client = useQueryClient();
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api("/api/v1/roles", { schema: z.array(RoleSchema) }),
  });
  const [type, setType] = useState<ApplicationType>(existing?.type ?? "web");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [redirects, setRedirects] = useState(existing?.redirectUris.join("\n") ?? "");
  const [logouts, setLogouts] = useState(existing?.postLogoutRedirectUris.join("\n") ?? "");
  const [restricted, setRestricted] = useState(existing?.allowedRoleIds !== null && !!existing);
  const [roleIds, setRoleIds] = useState<string[]>(existing?.allowedRoleIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        description,
        redirectUris: lines(redirects),
        postLogoutRedirectUris: lines(logouts),
        allowedRoleIds: restricted ? roleIds : null,
        enabled: existing?.enabled ?? true,
      };
      if (existing) {
        await api(`/api/v1/applications/${existing.id}`, {
          method: "PUT",
          body: { ...body, version: existing.version },
          schema: ApplicationSchema,
        });
        return null;
      }
      return api("/api/v1/applications", {
        method: "POST",
        body: { ...body, type },
        schema: IssuedApplicationSchema,
      });
    },
    onSuccess: (issued) => {
      void client.invalidateQueries({ queryKey: key });
      if (existing) toast.success("Application saved.");
      onDone(issued);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (name.trim().length < 2) return setError("Give the application a name.");
        if (!lines(redirects).length) return setError("Add at least one redirect address.");
        if (restricted && !roleIds.length)
          return setError("Choose at least one role, or allow everyone.");
        save.mutate();
      }}
    >
      {!existing && (
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[13px] font-medium">What kind of application?</legend>
          {(Object.keys(TYPES) as ApplicationType[]).map((k) => (
            <label
              key={k}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors",
                type === k
                  ? "border-primary bg-primary-soft/40"
                  : "border-border hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name="app-type"
                className="sr-only"
                checked={type === k}
                onChange={() => setType(k)}
              />
              <span className="mt-0.5 text-primary [&_svg]:size-4">{TYPES[k].icon}</span>
              <span>
                <span className="block text-[13px] font-medium">{TYPES[k].label}</span>
                <span className="block text-[12px] text-muted">{TYPES[k].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="app-name">Name</Label>
        <Input
          id="app-name"
          placeholder="e.g. Expense portal"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="app-desc">Description (optional)</Label>
        <Input id="app-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="app-redirects">Redirect addresses (one per line)</Label>
        <Textarea
          id="app-redirects"
          className="min-h-20 font-mono text-[12.5px]"
          placeholder="https://portal.example.com/auth/callback"
          value={redirects}
          onChange={(e) => setRedirects(e.target.value)}
        />
        <p className="text-[11.5px] text-subtle">
          Where people return after signing in. Must match exactly. https:// only (http:// for
          localhost).
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="app-logouts">Sign-out return addresses (optional)</Label>
        <Textarea
          id="app-logouts"
          className="min-h-14 font-mono text-[12.5px]"
          placeholder="https://portal.example.com/"
          value={logouts}
          onChange={(e) => setLogouts(e.target.value)}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-[13px] font-medium">Who can use it?</legend>
        <div className="flex gap-2">
          {[
            [false, "Everyone in the organisation"],
            [true, "Only people with chosen roles"],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={restricted === value}
              onClick={() => setRestricted(value as boolean)}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-[12.5px]",
                restricted === value
                  ? "border-primary bg-primary-soft/40 font-medium"
                  : "border-border text-muted",
              )}
            >
              {label as string}
            </button>
          ))}
        </div>
        {restricted && (
          <div className="flex flex-wrap gap-2 pt-1">
            {roles.data?.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px]"
              >
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--primary)]"
                  checked={roleIds.includes(r.id)}
                  onChange={(e) =>
                    setRoleIds((ids) =>
                      e.target.checked ? [...ids, r.id] : ids.filter((i) => i !== r.id),
                    )
                  }
                />
                {r.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <FieldError>{error}</FieldError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {existing ? <Pencil /> : <Plus />} {existing ? "Save changes" : "Register application"}
        </Button>
      </div>
    </form>
  );
}

function AppCard({
  app,
  roleNames,
  manage,
  onEdit,
  onIssued,
}: {
  app: Application;
  roleNames: Map<string, string>;
  manage: boolean;
  onEdit: () => void;
  onIssued: (i: IssuedApplication) => void;
}) {
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      api(`/api/v1/applications/${app.id}`, {
        method: "PUT",
        schema: ApplicationSchema,
        body: {
          name: app.name,
          description: app.description,
          redirectUris: app.redirectUris,
          postLogoutRedirectUris: app.postLogoutRedirectUris,
          allowedRoleIds: app.allowedRoleIds,
          enabled: !app.enabled,
          version: app.version,
        },
      }),
    onSuccess: (a) => {
      toast.success(
        a.enabled
          ? "Application turned on."
          : "Application turned off. Nobody can sign in to it now.",
      );
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rotate = useMutation({
    mutationFn: () =>
      api(`/api/v1/applications/${app.id}/secret`, {
        method: "POST",
        schema: IssuedApplicationSchema,
      }),
    onSuccess: (i) => {
      void client.invalidateQueries({ queryKey: key });
      onIssued(i);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/applications/${app.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Application deleted.");
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card className={cn(!app.enabled && "opacity-70")}>
      <CardHeader
        title={app.name}
        description={app.description || TYPES[app.type].label}
        action={
          app.enabled ? (
            <Badge tone="success" dot>
              On
            </Badge>
          ) : (
            <Badge>Off</Badge>
          )
        }
      />
      <CardBody className="space-y-4">
        <CopyField label="Client ID" value={app.clientId} />
        <dl className="grid gap-3 text-[12.5px] sm:grid-cols-2">
          <div>
            <dt className="text-[11.5px] text-subtle">Type</dt>
            <dd className="mt-0.5">{TYPES[app.type].label}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-subtle">Client secret</dt>
            <dd className="mt-0.5">
              {app.secretHint ? (
                <code className="font-mono">{app.secretHint}</code>
              ) : (
                "None (public app, PKCE)"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-subtle">Who can use it</dt>
            <dd className="mt-0.5 flex flex-wrap gap-1">
              {app.allowedRoleIds === null ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5 text-muted" /> Everyone
                </span>
              ) : (
                app.allowedRoleIds.map((id) => (
                  <Badge key={id} tone="primary">
                    {roleNames.get(id) ?? "Unknown role"}
                  </Badge>
                ))
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-subtle">Last sign-in</dt>
            <dd className="mt-0.5" title={formatDateTime(app.lastUsedAt)}>
              {formatRelative(app.lastUsedAt)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11.5px] text-subtle">Redirect addresses</dt>
            <dd className="mt-0.5 space-y-0.5 font-mono text-[11.5px]">
              {app.redirectUris.map((u) => (
                <p key={u} className="break-all">
                  {u}
                </p>
              ))}
            </dd>
          </div>
        </dl>
        {manage && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
            {app.type === "web" && (
              <Button
                size="sm"
                variant="secondary"
                loading={rotate.isPending}
                onClick={() => rotate.mutate()}
              >
                <KeySquare /> New secret
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              loading={toggle.isPending}
              onClick={() => toggle.mutate()}
            >
              <Power /> {app.enabled ? "Turn off" : "Turn on"}
            </Button>
            {confirmDelete ? (
              <Button
                size="sm"
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                <Trash2 /> Confirm delete
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function Applications() {
  const { can } = usePermissions();
  const manage = can("applications.manage");
  const list = useQuery({
    queryKey: key,
    queryFn: () => api("/api/v1/applications", { schema: ApplicationListSchema }),
    enabled: can("applications.read"),
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api("/api/v1/roles", { schema: z.array(RoleSchema) }),
    enabled: can("roles.read"),
  });
  const [editing, setEditing] = useState<Application | "new" | null>(null);
  const [issued, setIssued] = useState<IssuedApplication | null>(null);
  if (!can("applications.read")) return <ForbiddenState permission="applications.read" />;
  const roleNames = new Map(roles.data?.map((r) => [r.id, r.name]));
  const data = list.data;

  return (
    <>
      <PageHeader
        eyebrow="Identity"
        title="Applications"
        description="Let your other apps sign people in with their Neural Frontier account (OpenID Connect), including two-step sign-in and your sign-in policy."
        actions={
          manage && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Register application
            </Button>
          )
        }
      />
      {list.isError && (
        <Card>
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      )}
      {list.isPending && <Skeleton className="h-48 rounded-xl" />}
      {data && (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Connection details"
              description="Most OpenID Connect libraries only need the issuer: they discover the rest."
              action={<ShieldCheck className="size-4 text-subtle" aria-hidden />}
            />
            <CardBody className="grid gap-3 md:grid-cols-2">
              <CopyField label="Issuer" value={data.issuer} />
              <CopyField label="Discovery document" value={data.discoveryUrl} />
              <p className="text-[12px] leading-relaxed text-muted md:col-span-2">
                Flow: authorization code with PKCE (S256). Scopes: <code>openid</code>,{" "}
                <code>email</code>, <code>profile</code>, <code>roles</code>. Tokens are signed with
                ES256 and last 15 minutes.
              </p>
            </CardBody>
          </Card>
          {data.applications.length === 0 ? (
            <Card>
              <EmptyState icon={AppWindow} title="No applications yet">
                Register an app to give it &quot;Sign in with Neural Frontier&quot;.
              </EmptyState>
            </Card>
          ) : (
            <div className="grid gap-6 xl:grid-cols-2">
              {data.applications.map((a) => (
                <AppCard
                  key={a.id}
                  app={a}
                  roleNames={roleNames}
                  manage={manage}
                  onEdit={() => setEditing(a)}
                  onIssued={setIssued}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <DialogContent
            className="max-w-xl"
            title={editing === "new" ? "Register an application" : `Edit ${editing.name}`}
            description="People sign in to it with their Neural Frontier account."
          >
            <AppForm
              existing={editing === "new" ? null : editing}
              onDone={(i) => {
                setEditing(null);
                if (i) setIssued(i);
              }}
            />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        {issued && data && (
          <DialogContent
            className="max-w-xl"
            title={issued.clientSecret ? "Copy the client secret now" : "Application registered"}
            description={
              issued.clientSecret
                ? "The secret is shown only once. Store it in the application's server configuration."
                : "This app is public: it uses PKCE instead of a secret."
            }
          >
            <div className="space-y-3">
              <CopyField label="Issuer" value={data.issuer} />
              <CopyField label="Client ID" value={issued.application.clientId} />
              {issued.clientSecret && (
                <CopyField label="Client secret" value={issued.clientSecret} secret />
              )}
              <div className="flex justify-end pt-1">
                <Button onClick={() => setIssued(null)}>Done</Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
