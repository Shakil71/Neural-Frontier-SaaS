"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IdentitySchema, type Identity, RoleSchema } from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Plus, ShieldOff, ShieldPlus, UserCheck, UserX, X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, SheetContent, Tooltip } from "@/components/ui/overlays";
import {
  Avatar,
  Badge,
  FieldError,
  Label,
  NativeSelect,
  Skeleton,
  Textarea,
} from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";
import { SignInSection } from "./sign-in-section";

const AssignmentsSchema = z.array(
  z.object({ id: z.string(), roleId: z.string(), createdAt: z.string(), reason: z.string() }),
);
const ReasonSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason of at least 3 characters").max(500),
});
const GrantSchema = ReasonSchema.extend({ roleId: z.string().min(1, "Choose a role") });

function errorMessage(err: unknown) {
  return err instanceof ApiRequestError ? err.message : "Something went wrong";
}

function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip content={copied ? "Copied" : "Copy ID"}>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="flex max-w-full items-center gap-2 rounded-md font-mono text-[12px] text-muted hover:text-foreground"
        aria-label="Copy identity ID"
      >
        <span className="truncate">{value}</span>
        {copied ? (
          <Check className="size-3.5 shrink-0 text-success" />
        ) : (
          <Copy className="size-3.5 shrink-0" />
        )}
      </button>
    </Tooltip>
  );
}

function StatusDialog({ identity, onDone }: { identity: Identity; onDone: () => void }) {
  const client = useQueryClient();
  const suspending = identity.status === "active";
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(ReasonSchema), defaultValues: { reason: "" } });
  const mutation = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/v1/identities/${identity.id}/status`, {
        method: "PATCH",
        body: { status: suspending ? "suspended" : "active", version: identity.version, reason },
        schema: IdentitySchema,
      }),
    onSuccess: (updated) => {
      toast.success(`${updated.displayName} ${suspending ? "suspended" : "reactivated"}`);
      void client.invalidateQueries({ queryKey: ["identities"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      form.reset();
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.code === "conflict") {
        void client.invalidateQueries({ queryKey: ["identities"] });
      }
      toast.error(errorMessage(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <D.Trigger asChild>
        <Button variant={suspending ? "danger-soft" : "secondary"} className="w-full">
          {suspending ? <UserX /> : <UserCheck />}
          {suspending ? "Suspend identity" : "Reactivate identity"}
        </Button>
      </D.Trigger>
      <DialogContent
        title={
          suspending ? `Suspend ${identity.displayName}?` : `Reactivate ${identity.displayName}?`
        }
        description={
          suspending
            ? "They are signed out everywhere immediately and can't sign in until reactivated. This is recorded in the audit log."
            : "They will be able to sign in again with their existing roles. This is recorded in the audit log."
        }
      >
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v.reason))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="status-reason">Reason</Label>
            <Textarea
              id="status-reason"
              placeholder={
                suspending ? "e.g. Left the company on 9 Nov" : "e.g. Returned from leave"
              }
              aria-invalid={!!form.formState.errors.reason}
              {...form.register("reason")}
            />
            <FieldError>{form.formState.errors.reason?.message}</FieldError>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <D.Close asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </D.Close>
            <Button
              type="submit"
              variant={suspending ? "danger" : "primary"}
              loading={mutation.isPending}
            >
              {suspending ? "Suspend" : "Reactivate"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GrantRole({
  identity,
  assignedRoleIds,
}: {
  identity: Identity;
  assignedRoleIds: Set<string>;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api("/api/v1/roles", { schema: z.array(RoleSchema) }),
  });
  const available = roles.data?.filter((r) => !assignedRoleIds.has(r.id)) ?? [];
  const form = useForm({
    resolver: zodResolver(GrantSchema),
    defaultValues: { roleId: "", reason: "" },
  });
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof GrantSchema>) =>
      api("/api/v1/role-assignments", {
        method: "POST",
        // A fresh key per submission: a network retry of this request can't double-grant.
        headers: { "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
        body: { identityId: identity.id, roleId: v.roleId, reason: v.reason },
      }),
    onSuccess: () => {
      toast.success("Role granted");
      void client.invalidateQueries({ queryKey: ["identities"] });
      void client.invalidateQueries({ queryKey: ["roles"] });
      void client.invalidateQueries({ queryKey: ["assignments", identity.id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <D.Trigger asChild>
        <Button variant="secondary" size="sm" disabled={roles.isSuccess && available.length === 0}>
          <Plus /> Grant role
        </Button>
      </D.Trigger>
      <DialogContent
        title={`Grant a role to ${identity.displayName}`}
        description="Takes effect on their next request. Recorded in the audit log."
      >
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="grant-role">Role</Label>
            <NativeSelect
              id="grant-role"
              aria-invalid={!!form.formState.errors.roleId}
              {...form.register("roleId")}
            >
              <option value="">Choose a role…</option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.permissions.length} permissions
                </option>
              ))}
            </NativeSelect>
            <FieldError>{form.formState.errors.roleId?.message}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-reason">Reason</Label>
            <Textarea
              id="grant-reason"
              placeholder="e.g. Joining the security team"
              aria-invalid={!!form.formState.errors.reason}
              {...form.register("reason")}
            />
            <FieldError>{form.formState.errors.reason?.message}</FieldError>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <D.Close asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </D.Close>
            <Button type="submit" loading={mutation.isPending}>
              <ShieldPlus /> Grant role
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeRole({
  identity,
  assignmentId,
  roleName,
}: {
  identity: Identity;
  assignmentId: string;
  roleName: string;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(ReasonSchema), defaultValues: { reason: "" } });
  const mutation = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/v1/role-assignments/${assignmentId}`, { method: "DELETE", body: { reason } }),
    onSuccess: () => {
      toast.success(`${roleName} revoked`);
      void client.invalidateQueries({ queryKey: ["identities"] });
      void client.invalidateQueries({ queryKey: ["roles"] });
      void client.invalidateQueries({ queryKey: ["assignments", identity.id] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip content={`Revoke ${roleName}`}>
        <D.Trigger asChild>
          <button
            type="button"
            className="rounded p-0.5 text-subtle hover:bg-danger-soft hover:text-danger"
            aria-label={`Revoke ${roleName}`}
          >
            <X className="size-3.5" />
          </button>
        </D.Trigger>
      </Tooltip>
      <DialogContent
        title={`Revoke ${roleName}?`}
        description={`${identity.displayName} loses this role's permissions on their next request.`}
      >
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v.reason))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="revoke-reason">Reason</Label>
            <Textarea
              id="revoke-reason"
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
              <ShieldOff /> Revoke
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IdentitySheet({
  identityId,
  onClose,
}: {
  identityId: string | null;
  onClose: () => void;
}) {
  const { can, session } = usePermissions();
  const identity = useQuery({
    queryKey: ["identities", "detail", identityId],
    queryFn: () => api(`/api/v1/identities/${identityId}`, { schema: IdentitySchema }),
    enabled: !!identityId,
  });
  const assignments = useQuery({
    queryKey: ["assignments", identityId],
    queryFn: () =>
      api(`/api/v1/identities/${identityId}/role-assignments`, { schema: AssignmentsSchema }),
    enabled: !!identityId && can("roles.read"),
  });
  const i = identity.data;
  const assignmentByRole = new Map(assignments.data?.map((a) => [a.roleId, a.id]));
  const isSelf = i?.id === session?.user.id;

  return (
    <D.Root open={!!identityId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={i?.displayName ?? "Identity"} description={i?.email}>
        {identity.isPending && (
          <div className="space-y-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-32" />
          </div>
        )}
        {identity.isError && (
          <ErrorState error={identity.error} onRetry={() => void identity.refetch()} />
        )}
        {i && (
          <div className="space-y-7 animate-fade-in">
            <div className="flex items-center gap-4">
              <Avatar name={i.displayName} seed={i.email} size={56} />
              <div className="min-w-0">
                <p className="truncate text-[17px] font-semibold tracking-tight">{i.displayName}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {i.status === "active" ? (
                    <Badge tone="success" dot>
                      Active
                    </Badge>
                  ) : (
                    <Badge tone="danger" dot>
                      Suspended
                    </Badge>
                  )}
                  {i.source === "scim" && <Badge tone="primary">Managed by SCIM</Badge>}
                  {isSelf && <Badge>You</Badge>}
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl border border-border bg-surface-sunken/50 p-4 text-[13px]">
              <div>
                <dt className="text-[11.5px] text-subtle">Last sign-in</dt>
                <dd className="mt-0.5 font-medium" title={formatDateTime(i.lastSignInAt)}>
                  {formatRelative(i.lastSignInAt)}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-subtle">Added</dt>
                <dd className="mt-0.5 font-medium">{formatDateTime(i.createdAt)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[11.5px] text-subtle">Identity ID</dt>
                <dd className="mt-0.5">
                  <CopyId value={i.id} />
                </dd>
              </div>
            </dl>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[13.5px] font-semibold">Roles</h3>
                {can("roles.assign") && (
                  <GrantRole identity={i} assignedRoleIds={new Set(i.roles.map((r) => r.id))} />
                )}
              </div>
              {i.roles.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-[13px] text-muted">
                  No roles — this person has no administrative access.
                </p>
              ) : (
                <ul className="space-y-2">
                  {i.roles.map((r) => {
                    const assignmentId = assignmentByRole.get(r.id);
                    return (
                      <li
                        key={r.id}
                        className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3.5 py-2.5"
                      >
                        <ShieldPlus className="size-4 text-primary" aria-hidden />
                        <span className="flex-1 text-[13px] font-medium">{r.name}</span>
                        {can("roles.assign") && assignmentId && (
                          <RevokeRole identity={i} assignmentId={assignmentId} roleName={r.name} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <SignInSection identityId={i.id} isSelf={isSelf} />

            {can("identities.manage") && !isSelf && (
              <section className="rounded-xl border border-danger/25 bg-danger-soft/40 p-4">
                <h3 className="text-[13.5px] font-semibold">Access</h3>
                <p className="mb-4 mt-1 text-[12.5px] leading-relaxed text-muted">
                  {i.status === "active"
                    ? "Suspending ends every active session immediately and blocks sign-in."
                    : "This identity can't sign in. Reactivating restores access with their current roles."}
                </p>
                <StatusDialog identity={i} onDone={() => void identity.refetch()} />
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </D.Root>
  );
}
