"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type IssuedScimToken,
  IssuedScimTokenSchema,
  type ScimToken,
  ScimTokenSchema,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeySquare, Plus, RefreshCcwDot, Trash2 } from "lucide-react";
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
} from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const key = ["tenant", "scim-tokens"] as const;
const ListSchema = z.object({ baseUrl: z.string(), tokens: z.array(ScimTokenSchema) });
const errorMessage = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Something went wrong";

function Copyable({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 ${secret ? "border-warning/40 bg-warning-soft/40" : "border-border bg-surface-sunken"}`}
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

function tokenState(t: ScimToken) {
  if (t.revokedAt) return { label: "Revoked", tone: "neutral" as const };
  if (new Date(t.expiresAt).getTime() <= Date.now())
    return { label: "Expired", tone: "danger" as const };
  return { label: "Active", tone: "success" as const };
}

function NewToken({ onIssued }: { onIssued: (t: IssuedScimToken) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(
      z.object({ name: z.string().trim().min(2, "At least 2 characters").max(120) }),
    ),
    defaultValues: { name: "Microsoft Entra ID provisioning" },
  });
  const mutation = useMutation({
    mutationFn: (name: string) =>
      api("/api/v1/tenant/scim-tokens", {
        method: "POST",
        body: { name },
        schema: IssuedScimTokenSchema,
      }),
    onSuccess: (issued) => {
      void client.invalidateQueries({ queryKey: key });
      setOpen(false);
      form.reset();
      onIssued(issued);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <D.Trigger asChild>
        <Button size="sm">
          <Plus /> New provisioning token
        </Button>
      </D.Trigger>
      <DialogContent
        title="New provisioning token"
        description="A SCIM 2.0 bearer token for your identity provider's automatic user provisioning. Valid for one year."
      >
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v.name))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="scim-name">Name</Label>
            <Input
              id="scim-name"
              aria-invalid={!!form.formState.errors.name}
              {...form.register("name")}
            />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </div>
          <div className="flex justify-end gap-2">
            <D.Close asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </D.Close>
            <Button type="submit" loading={mutation.isPending}>
              <KeySquare /> Create token
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProvisioningCard() {
  const { can } = usePermissions();
  const manage = can("tenant.sso.manage");
  const client = useQueryClient();
  const [issued, setIssued] = useState<IssuedScimToken | null>(null);
  const list = useQuery({
    queryKey: key,
    queryFn: () => api("/api/v1/tenant/scim-tokens", { schema: ListSchema }),
  });
  const revoke = useMutation({
    mutationFn: (t: ScimToken) =>
      api(`/api/v1/tenant/scim-tokens/${t.id}`, {
        method: "DELETE",
        body: { reason: "Revoked from the Admin Center" },
      }),
    onSuccess: () => {
      toast.success("Token revoked. The provisioning client can no longer connect with it.");
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Automatic provisioning (SCIM 2.0)"
        description="Let Entra ID, Okta or another provider create, update and deactivate people here. Deactivating someone at the source ends their sessions immediately."
        action={
          manage ? (
            <NewToken onIssued={setIssued} />
          ) : (
            <RefreshCcwDot className="size-4 text-subtle" aria-hidden />
          )
        }
      />
      <CardBody className="space-y-4">
        {list.isPending && <Skeleton className="h-24" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && (
          <>
            <Copyable label="SCIM base URL (Tenant URL in Entra ID)" value={list.data.baseUrl} />
            {list.data.tokens.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong px-4 py-4 text-[13px] text-muted">
                No provisioning tokens yet. People are added the first time they sign in.
              </p>
            ) : (
              <ul className="space-y-2">
                {list.data.tokens.map((t) => {
                  const st = tokenState(t);
                  return (
                    <li
                      key={t.id}
                      className={`flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 ${t.revokedAt ? "opacity-60" : ""}`}
                    >
                      <KeySquare className="size-4 shrink-0 text-muted" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{t.name}</p>
                        <p className="text-[11.5px] text-subtle">
                          nfscim_…{t.hint} · expires {formatDateTime(t.expiresAt)} · used{" "}
                          {formatRelative(t.lastUsedAt).toLowerCase()}
                        </p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {manage && !t.revokedAt && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Revoke ${t.name}`}
                          loading={revoke.isPending && revoke.variables?.id === t.id}
                          onClick={() => revoke.mutate(t)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </CardBody>

      <Dialog
        open={!!issued}
        onOpenChange={(o) => {
          if (!o) setIssued(null);
        }}
      >
        {issued && (
          <DialogContent
            className="max-w-xl"
            title="Copy the provisioning token now"
            description="It is shown only once. Paste both values into your identity provider's provisioning settings."
          >
            <div className="space-y-4">
              <Copyable label="Tenant URL" value={issued.baseUrl} />
              <Copyable label="Secret token" value={issued.token} secret />
              <p className="text-[12px] leading-relaxed text-subtle">
                In Entra ID: Enterprise application → Provisioning → Automatic. Map users only
                (groups aren&apos;t supported yet). userName must be a work email on your verified
                domains.
              </p>
              <div className="flex justify-end">
                <Button onClick={() => setIssued(null)}>Done</Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
