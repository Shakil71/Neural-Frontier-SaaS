"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  IssuerUrlSchema,
  type TenantIdentityProvider,
  TenantIdentityProviderResponseSchema,
  TenantIdentityProviderSchema,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Fingerprint, Lock, LockOpen, Pencil, Plug, Trash2 } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
  Skeleton,
  Textarea,
} from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const key = ["tenant", "identity-provider"] as const;
const errorMessage = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Something went wrong";

function CopyLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{value}</code>
      <button
        type="button"
        aria-label="Copy redirect URI"
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
  );
}

function ProviderForm({
  current,
  open,
  onOpenChange,
}: {
  current: TenantIdentityProvider | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const client = useQueryClient();
  const Schema = z.object({
    issuer: IssuerUrlSchema,
    clientId: z.string().trim().min(1, "Enter the client ID").max(255),
    clientSecret: current
      ? z.string().max(1024)
      : z.string().min(1, "Enter the client secret").max(1024),
    requireEmailVerified: z.boolean(),
  });
  const form = useForm<z.infer<typeof Schema>>({
    resolver: zodResolver(Schema),
    values: {
      issuer: current?.issuer ?? "",
      clientId: current?.clientId ?? "",
      clientSecret: "",
      requireEmailVerified: current?.requireEmailVerified ?? true,
    },
  });
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof Schema>) =>
      api("/api/v1/tenant/identity-provider", {
        method: "PUT",
        body: {
          issuer: v.issuer,
          clientId: v.clientId,
          requireEmailVerified: v.requireEmailVerified,
          ...(v.clientSecret ? { clientSecret: v.clientSecret } : {}),
          ...(current ? { version: current.version } : {}),
        },
        schema: TenantIdentityProviderSchema,
      }),
    onSuccess: () => {
      toast.success("Sign-in provider saved", {
        description: "Sign out and sign in with your work email to try it.",
      });
      void client.invalidateQueries({ queryKey: ["tenant"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const e = form.formState.errors;
  const redirectUri =
    typeof window === "undefined" ? "" : `${window.location.origin}/api/v1/auth/callback`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        title={current ? "Edit sign-in provider" : "Connect your sign-in provider"}
        description="Any OpenID Connect provider: Microsoft Entra ID, Okta, Google Workspace, Keycloak, Auth0. Your people are sent there when they enter a work email on your verified domains."
      >
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">Redirect URI to register at your provider</p>
            <CopyLine value={redirectUri} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idp-issuer">Issuer URL</Label>
            <Input
              id="idp-issuer"
              placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0"
              spellCheck={false}
              className="font-mono text-[12.5px]"
              aria-invalid={!!e.issuer}
              {...form.register("issuer")}
            />
            <FieldError>{e.issuer?.message}</FieldError>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="idp-client">Client ID</Label>
              <Input
                id="idp-client"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!e.clientId}
                {...form.register("clientId")}
              />
              <FieldError>{e.clientId?.message}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idp-secret">Client secret</Label>
              <Input
                id="idp-secret"
                type="password"
                autoComplete="new-password"
                placeholder={current ? `Unchanged (${current.secretHint})` : ""}
                aria-invalid={!!e.clientSecret}
                {...form.register("clientSecret")}
              />
              <FieldError>{e.clientSecret?.message}</FieldError>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              {...form.register("requireEmailVerified")}
            />
            <span>
              Require the <code className="font-mono text-[12px]">email_verified</code> claim
              <span className="block text-[12px] text-subtle">
                Turn off only for providers that are authoritative for your domain but omit the
                claim (Microsoft Entra ID does).
              </span>
            </span>
          </label>
          <p className="text-[12px] text-subtle">
            Neural Frontier checks the provider&apos;s discovery document before saving. The secret
            is encrypted and never shown again.
          </p>
          <div className="flex justify-end gap-2">
            <D.Close asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </D.Close>
            <Button type="submit" loading={mutation.isPending}>
              <Plug /> {current ? "Save changes" : "Connect provider"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReasonAction({
  title,
  description,
  confirm,
  danger,
  open,
  onOpenChange,
  run,
}: {
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  run: (reason: string) => Promise<unknown>;
}) {
  const client = useQueryClient();
  const form = useForm({
    resolver: zodResolver(
      z.object({ reason: z.string().trim().min(3, "Give a reason of at least 3 characters") }),
    ),
    defaultValues: { reason: "" },
  });
  const mutation = useMutation({
    mutationFn: run,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["tenant"] });
      onOpenChange(false);
      form.reset();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void client.invalidateQueries({ queryKey: ["tenant"] });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v.reason))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="idp-reason">Reason</Label>
            <Textarea
              id="idp-reason"
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
            <Button
              type="submit"
              variant={danger ? "danger" : "primary"}
              loading={mutation.isPending}
            >
              {confirm}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IdentityProviderCard({ sharedConfigured }: { sharedConfigured: boolean }) {
  const { can } = usePermissions();
  const manage = can("tenant.sso.manage");
  const [dialog, setDialog] = useState<"edit" | "enforce" | "remove" | null>(null);
  const idp = useQuery({
    queryKey: key,
    queryFn: () =>
      api("/api/v1/tenant/identity-provider", {
        schema: TenantIdentityProviderResponseSchema,
      }).then((r) => r.identityProvider),
  });
  const p = idp.data ?? null;
  const required = p?.enforcement === "required";

  return (
    <Card>
      <CardHeader
        title="Single sign-on"
        description="Sign in through your organisation’s identity provider (OIDC), alongside or instead of built-in passwords."
        action={<Fingerprint className="size-4 text-subtle" aria-hidden />}
      />
      <CardBody className="space-y-4">
        {idp.isPending && <Skeleton className="h-28" />}
        {idp.isError && <ErrorState error={idp.error} onRetry={() => void idp.refetch()} />}
        {idp.isSuccess && (
          <>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div className="min-w-0 text-[13px]">
                <p className="font-medium">Deployment default provider</p>
                <p className="text-[12px] text-subtle">
                  {required
                    ? "Not accepted for your organisation (your own provider is required)."
                    : "Shared by organisations on this deployment."}
                </p>
              </div>
              <Badge tone={!sharedConfigured ? "warning" : required ? "neutral" : "success"} dot>
                {!sharedConfigured ? "Not configured" : required ? "Blocked" : "Accepted"}
              </Badge>
            </div>

            {p ? (
              <div className="rounded-lg border border-primary/40 bg-primary-soft/30 px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-[13px]">
                    <p className="font-medium">Your organisation&apos;s provider</p>
                    <p className="mt-0.5 truncate font-mono text-[12px] text-muted">{p.issuer}</p>
                    <p className="mt-1 text-[12px] text-subtle">
                      Client {p.clientId} · secret {p.secretHint} · updated{" "}
                      {formatDateTime(p.updatedAt)}
                    </p>
                  </div>
                  <Badge tone={required ? "primary" : "accent"}>
                    {required ? (
                      <>
                        <Lock className="size-3" aria-hidden /> Required
                      </>
                    ) : (
                      "Optional"
                    )}
                  </Badge>
                </div>
                {manage && (
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setDialog("edit")}>
                      <Pencil /> Edit
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setDialog("enforce")}>
                      {required ? <LockOpen /> : <Lock />}
                      {required ? "Make optional" : "Require for everyone"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDialog("remove")}>
                      <Trash2 /> Remove
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border-strong px-4 py-4 text-[13px] text-muted">
                Your organisation signs in through the deployment default provider. Connect your own
                (Entra ID, Okta, Google…) so your people use their usual work sign-in and MFA.
                {manage && (
                  <div className="mt-3">
                    <Button size="sm" onClick={() => setDialog("edit")}>
                      <Plug /> Connect your provider
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardBody>

      <ProviderForm
        current={p}
        open={dialog === "edit"}
        onOpenChange={(o) => setDialog(o ? "edit" : null)}
      />
      {p && (
        <>
          <ReasonAction
            open={dialog === "enforce"}
            onOpenChange={(o) => setDialog(o ? "enforce" : null)}
            title={required ? "Allow the default provider again?" : "Require your provider?"}
            description={
              required
                ? "People from your domains may sign in through either provider."
                : "Sign-ins through the deployment default provider are refused for your organisation. You must have signed in through your provider at least once."
            }
            confirm={required ? "Make optional" : "Require"}
            run={(reason) =>
              api("/api/v1/tenant/identity-provider/enforcement", {
                method: "PATCH",
                body: {
                  enforcement: required ? "optional" : "required",
                  version: p.version,
                  reason,
                },
              }).then(() =>
                toast.success(required ? "Provider is now optional" : "Provider is now required"),
              )
            }
          />
          <ReasonAction
            open={dialog === "remove"}
            onOpenChange={(o) => setDialog(o ? "remove" : null)}
            title="Remove your sign-in provider?"
            description="Your people go back to the deployment default provider. Accounts that moved to your provider are unlinked and re-link on their next sign-in."
            confirm="Remove provider"
            danger
            run={(reason) =>
              api("/api/v1/tenant/identity-provider", { method: "DELETE", body: { reason } }).then(
                () => toast.success("Sign-in provider removed"),
              )
            }
          />
        </>
      )}
    </Card>
  );
}
