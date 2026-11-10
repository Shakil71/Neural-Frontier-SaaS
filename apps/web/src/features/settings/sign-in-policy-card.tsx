"use client";

import {
  MIN_PASSWORD_LENGTH_FLOOR,
  type SignInPolicy,
  SignInPolicySchema,
  SignInReadinessSchema,
  type TwoFactorPolicy,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  KeyRound,
  Save,
  ShieldEllipsis,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
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
import { formatDateTime } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const key = ["tenant", "sign-in-policy"] as const;

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-primary bg-primary-solid" : "border-border-strong bg-surface-sunken",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-[18px] rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function Setting({
  icon,
  title,
  hint,
  control,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3.5 py-4 first:pt-0">
      <span className="mt-0.5 text-muted [&_svg]:size-[18px]">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{hint}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Editor({ policy, manage }: { policy: SignInPolicy; manage: boolean }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState({
    passwordSignIn: policy.passwordSignIn,
    twoFactor: policy.twoFactor,
    minPasswordLength: policy.minPasswordLength,
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dirty =
    draft.passwordSignIn !== policy.passwordSignIn ||
    draft.twoFactor !== policy.twoFactor ||
    draft.minPasswordLength !== policy.minPasswordLength;

  const save = useMutation({
    mutationFn: () =>
      api("/api/v1/tenant/sign-in-policy", {
        method: "PUT",
        body: { ...draft, version: policy.version, reason },
        schema: SignInPolicySchema,
      }),
    onSuccess: (next) => {
      client.setQueryData(key, next);
      setReason("");
      toast.success("Sign-in policy saved.");
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Couldn't save."),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (reason.trim().length < 3) return setError("Give a reason of at least 3 characters.");
        save.mutate();
      }}
    >
      <div className="divide-y divide-border">
        <Setting
          icon={<KeyRound />}
          title="Password sign-in"
          hint="People can sign in with their email and a Neural Frontier password. Turn off to allow single sign-on only."
          control={
            <Toggle
              label="Password sign-in"
              checked={draft.passwordSignIn}
              disabled={!manage}
              onChange={(v) => setDraft((d) => ({ ...d, passwordSignIn: v }))}
            />
          }
        />
        <Setting
          icon={<Smartphone />}
          title="Require two-step sign-in"
          hint="Everyone signing in with a password must use an authenticator app. People without one set it up at their next sign-in."
          control={
            <Toggle
              label="Require two-step sign-in"
              checked={draft.twoFactor === "required"}
              disabled={!manage || !draft.passwordSignIn}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  twoFactor: (v ? "required" : "optional") as TwoFactorPolicy,
                }))
              }
            />
          }
        />
        <Setting
          icon={<ShieldEllipsis />}
          title="Minimum password length"
          hint={`Applies to new passwords. Between ${MIN_PASSWORD_LENGTH_FLOOR} and 64; 12 or more is recommended.`}
          control={
            <Input
              type="number"
              aria-label="Minimum password length"
              min={MIN_PASSWORD_LENGTH_FLOOR}
              max={64}
              disabled={!manage || !draft.passwordSignIn}
              className="w-20 text-center"
              value={draft.minPasswordLength}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  minPasswordLength: Math.min(
                    64,
                    Math.max(MIN_PASSWORD_LENGTH_FLOOR, Number(e.target.value) || 0),
                  ),
                }))
              }
            />
          }
        />
      </div>
      {manage && dirty && (
        <div className="mt-4 space-y-3 rounded-lg border border-border bg-surface-sunken/60 p-3.5 animate-fade-in">
          <div className="space-y-1.5">
            <Label htmlFor="policy-reason">Reason for the change</Label>
            <Textarea
              id="policy-reason"
              className="min-h-16"
              placeholder="e.g. Security review: require two-step sign-in"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setDraft({
                  passwordSignIn: policy.passwordSignIn,
                  twoFactor: policy.twoFactor,
                  minPasswordLength: policy.minPasswordLength,
                })
              }
            >
              Discard
            </Button>
            <Button type="submit" loading={save.isPending}>
              <Save /> Save policy
            </Button>
          </div>
        </div>
      )}
      {!manage && (
        <p className="mt-3 text-[12px] text-subtle">Only the organisation owner can change this.</p>
      )}
      {policy.updatedAt && (
        <p className="mt-3 text-[12px] text-subtle">
          Last changed {formatDateTime(policy.updatedAt)}.
        </p>
      )}
    </form>
  );
}

export function SignInPolicyCard() {
  const { can } = usePermissions();
  const policy = useQuery({
    queryKey: key,
    queryFn: () => api("/api/v1/tenant/sign-in-policy", { schema: SignInPolicySchema }),
  });
  const p = policy.data;
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Built-in sign-in"
        description="Neural Frontier's own accounts: passwords and two-step sign-in, without an external identity provider."
        action={
          p &&
          (p.passwordSignIn ? (
            <Badge tone="success" dot>
              {p.twoFactor === "required" ? "Password + two-step" : "Password"}
            </Badge>
          ) : (
            <Badge>Single sign-on only</Badge>
          ))
        }
      />
      <CardBody>
        <SignInReadiness />
        {policy.isPending && <Skeleton className="h-40" />}
        {policy.isError && (
          <ErrorState error={policy.error} onRetry={() => void policy.refetch()} />
        )}
        {/* Keyed by version so a saved policy resets the draft. */}
        {p && <Editor key={p.version} policy={p} manage={can("tenant.sso.manage")} />}
      </CardBody>
    </Card>
  );
}

function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-muted">{label}</span>
        <span className="font-medium tabular-nums">
          {value} of {total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={cn("h-full rounded-full", pct === 100 ? "bg-success" : "bg-primary")}
          style={{ width: `${Math.max(pct, value ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Who could still sign in without the deployment-wide provider (Keycloak on this server).
 * Shown while that provider is configured, so the switch-over can be planned safely.
 */
export function SignInReadiness() {
  const r = useQuery({
    queryKey: ["tenant", "sign-in-readiness"],
    queryFn: () =>
      api("/api/v1/tenant/sign-in-policy/readiness", { schema: SignInReadinessSchema }),
  });
  const d = r.data;
  if (!d || !d.sharedSsoConfigured) return null;
  const ownersReady = d.owners > 0 && d.ownersWithPassword === d.owners;
  return (
    <div className="mb-5 space-y-3 rounded-xl border border-border bg-surface-sunken/50 p-4">
      <div className="flex items-start gap-2.5">
        {ownersReady || d.ownProvider ? (
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        ) : (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        )}
        <div>
          <p className="text-[13.5px] font-medium">Ready to sign in without the shared provider?</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            {d.ownProvider
              ? "Your organisation uses its own identity provider, so retiring the shared one doesn't affect you."
              : ownersReady
                ? "Every owner can sign in with a built-in password. People without one can get a link from their Sign-in panel."
                : "Before this server's shared provider is retired, every owner should add a password in My account → Security & sign-in."}
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Meter label="Owners with a password" value={d.ownersWithPassword} total={d.owners} />
        <Meter label="People with a password" value={d.withPassword} total={d.people} />
        <Meter label="People with two-step sign-in" value={d.withTwoFactor} total={d.people} />
      </div>
    </div>
  );
}
