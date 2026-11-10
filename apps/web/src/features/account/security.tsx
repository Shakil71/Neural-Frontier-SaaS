"use client";

import {
  type MySecurity,
  MySecuritySchema,
  passwordProblems,
  RecoveryCodesSchema,
  type TwoFactorSetup,
  TwoFactorSetupSchema,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fingerprint,
  KeyRound,
  ListRestart,
  LogIn,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AuthenticatorSetup,
  CodeInput,
  PasswordChecklist,
  PasswordInput,
  RecoveryCodes,
} from "@/components/auth/auth-parts";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  FieldError,
  Label,
  Skeleton,
} from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useSignOut } from "@/lib/session";
import { SessionsCard } from "./sessions-card";

const key = ["me", "security"] as const;
const errorMessage = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.";

function Fact({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "success" | "neutral" | "warning";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3.5 shadow-card">
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-[18px]",
          tone === "success" && "bg-success-soft text-success",
          tone === "neutral" && "bg-surface-sunken text-muted",
          tone === "warning" && "bg-warning-soft text-warning",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11.5px] uppercase tracking-[0.12em] text-subtle">{label}</p>
        <p className="truncate text-[14px] font-medium">{value}</p>
      </div>
    </div>
  );
}

function ChangePasswordDialog({
  data,
  open,
  onOpenChange,
}: {
  data: MySecurity;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const client = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const first = !data.password.set;
  const mutation = useMutation({
    mutationFn: () =>
      api("/api/v1/me/security/password", {
        method: "PUT",
        body: first ? { newPassword: next } : { currentPassword: current, newPassword: next },
        schema: MySecuritySchema,
      }),
    onSuccess: (updated) => {
      client.setQueryData(key, updated);
      toast.success(
        first
          ? "Password set. You can now sign in with it."
          : "Password changed. Other sessions were signed out.",
      );
      onOpenChange(false);
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={first ? "Add a password" : "Change your password"}
        description={
          first
            ? "Lets you sign in with your email and a password, alongside single sign-on."
            : "You'll stay signed in here. Every other session is signed out."
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const problems = passwordProblems(next, {
              minLength: data.policy.minPasswordLength,
              email: data.email,
            });
            if (problems.length) return setError(problems[0]!);
            if (next !== confirm) return setError("The new passwords don't match.");
            mutation.mutate();
          }}
        >
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={data.email}
            readOnly
            hidden
          />
          {!first && (
            <div className="space-y-1.5">
              <Label htmlFor="pw-current">Current password</Label>
              <PasswordInput
                id="pw-current"
                autoComplete="current-password"
                className="h-10 text-sm"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">New password</Label>
            <PasswordInput
              id="pw-new"
              autoComplete="new-password"
              className="h-10 text-sm"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <PasswordChecklist
            password={next}
            minLength={data.policy.minPasswordLength}
            email={data.email}
          />
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <PasswordInput
              id="pw-confirm"
              autoComplete="new-password"
              className="h-10 text-sm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              <KeyRound /> {first ? "Add password" : "Change password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Set-up: QR → confirm a code → recovery codes. */
/**
 * Mounted outside the card on purpose: enabling refreshes the page data, which swaps the card to
 * its "on" state. The dialog (and the recovery codes in it) must survive that.
 */
function EnableTwoFactorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const client = useQueryClient();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const begin = useMutation({
    mutationFn: () =>
      api("/api/v1/me/security/two-factor/setup", { method: "POST", schema: TwoFactorSetupSchema }),
    onSuccess: setSetup,
    onError: (err) => setError(errorMessage(err)),
  });
  const { mutate: start } = begin;
  // Each time the dialog opens, ask for a fresh secret.
  useEffect(() => {
    if (open) start();
  }, [open, start]);
  const confirm = useMutation({
    mutationFn: () =>
      api("/api/v1/me/security/two-factor/enable", {
        method: "POST",
        body: { code },
        schema: RecoveryCodesSchema,
      }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const close = () => {
    onOpenChange(false);
    setSetup(null);
    setCodes(null);
    setCode("");
    setError(null);
  };
  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !codes && close()}>
        <DialogContent
          className="max-w-xl"
          title={codes ? "Save your recovery codes" : "Set up two-step sign-in"}
          description={
            codes
              ? "Two-step sign-in is on. If you lose your phone, each code signs you in once. You won't see them again."
              : "After your password, you'll enter a 6-digit code from your phone."
          }
        >
          {codes ? (
            <RecoveryCodes codes={codes} confirmLabel="Done" onConfirm={close} />
          ) : !setup ? (
            error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <Skeleton className="h-48" />
            )
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                if (!/^\d{6}$/.test(code.trim()))
                  return setError("Enter the 6-digit code from your app.");
                confirm.mutate();
              }}
            >
              <AuthenticatorSetup setup={setup} />
              <div className="space-y-1.5">
                <Label htmlFor="enable-code">6-digit code</Label>
                <CodeInput
                  id="enable-code"
                  className="h-12 text-[19px]"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                />
              </div>
              <FieldError>{error}</FieldError>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" loading={confirm.isPending}>
                  <ShieldCheck /> Turn on
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Actions that need a current code first: turning off, or replacing recovery codes. */
function CodeConfirmDialog({
  mode,
  onClose,
}: {
  mode: "disable" | "recovery" | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "disable") {
        await api("/api/v1/me/security/two-factor/disable", {
          method: "POST",
          body: { code },
          schema: MySecuritySchema,
        });
        return null;
      }
      return (
        await api("/api/v1/me/security/recovery-codes", {
          method: "POST",
          body: { code },
          schema: RecoveryCodesSchema,
        })
      ).recoveryCodes;
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: key });
      if (result) setCodes(result);
      else {
        toast.success("Two-step sign-in is off.");
        close();
      }
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const close = () => {
    onClose();
    setCode("");
    setError(null);
    setCodes(null);
  };
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && !codes && close()}>
      <DialogContent
        title={
          codes
            ? "Your new recovery codes"
            : mode === "disable"
              ? "Turn off two-step sign-in?"
              : "Replace recovery codes"
        }
        description={
          codes
            ? "Your old codes no longer work. Save these somewhere safe."
            : mode === "disable"
              ? "Your account will be protected by your password alone. Enter a current code to confirm."
              : "Your current recovery codes will stop working. Enter a code from your app to confirm."
        }
      >
        {codes ? (
          <RecoveryCodes codes={codes} confirmLabel="Done" onConfirm={close} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (!code.trim()) return setError("Enter a code.");
              mutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="confirm-code">Code from your app, or a recovery code</Label>
              <CodeInput
                id="confirm-code"
                recovery
                className="h-12 text-[18px]"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
            </div>
            <FieldError>{error}</FieldError>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={mode === "disable" ? "danger" : "primary"}
                loading={mutation.isPending}
              >
                {mode === "disable" ? <ShieldOff /> : <ListRestart />}
                {mode === "disable" ? "Turn off" : "Replace codes"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AccountSecurity() {
  const signOut = useSignOut();
  const query = useQuery({
    queryKey: key,
    queryFn: () => api("/api/v1/me/security", { schema: MySecuritySchema }),
  });
  const [pwOpen, setPwOpen] = useState(false);
  const [tfOpen, setTfOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"disable" | "recovery" | null>(null);
  const d = query.data;

  return (
    <>
      <PageHeader
        eyebrow="My account"
        title="Security & sign-in"
        description="How you sign in to Neural Frontier. Changes here apply to your account only."
      />
      {query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : !d ? (
        <div className="space-y-6">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Fact
              icon={<KeyRound />}
              label="Password"
              value={
                d.password.set
                  ? `Set ${formatRelative(d.password.updatedAt).toLowerCase()}`
                  : "Not set"
              }
              tone={d.password.set ? "success" : "neutral"}
            />
            <Fact
              icon={<Smartphone />}
              label="Two-step sign-in"
              value={
                d.twoFactor.enabled
                  ? "On"
                  : d.policy.twoFactor === "required"
                    ? "Required, not set up"
                    : "Off"
              }
              tone={
                d.twoFactor.enabled
                  ? "success"
                  : d.policy.twoFactor === "required"
                    ? "warning"
                    : "neutral"
              }
            />
            <Fact
              icon={<Fingerprint />}
              label="Single sign-on"
              value={d.sso.linked ? "Linked" : "Not linked"}
              tone={d.sso.linked ? "success" : "neutral"}
            />
            <Fact
              icon={<LogIn />}
              label="This session"
              value={
                d.signedInWith === "local"
                  ? "Signed in with password"
                  : d.signedInWith
                    ? "Signed in with SSO"
                    : "Signed in"
              }
              tone="neutral"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Password"
                description={`At least ${d.policy.minPasswordLength} characters. Stored only as a salted scrypt hash.`}
                action={<KeyRound className="size-4 text-subtle" aria-hidden />}
              />
              <CardBody className="space-y-4">
                {!d.policy.passwordSignIn ? (
                  <p className="rounded-lg border border-dashed border-border-strong px-4 py-3 text-[13px] text-muted">
                    Your organisation signs in through single sign-on only, so passwords aren&apos;t
                    used.
                  </p>
                ) : d.password.set ? (
                  <>
                    <p className="text-[13.5px] text-muted">
                      Last changed{" "}
                      <span className="text-foreground">
                        {formatDateTime(d.password.updatedAt)}
                      </span>
                      .
                    </p>
                    <Button variant="secondary" onClick={() => setPwOpen(true)}>
                      <KeyRound /> Change password
                    </Button>
                  </>
                ) : d.recentSignIn ? (
                  <>
                    <p className="text-[13.5px] leading-relaxed text-muted">
                      You sign in with single sign-on. Add a password to also sign in with your
                      email, for example if the identity provider is unavailable.
                    </p>
                    <Button onClick={() => setPwOpen(true)}>
                      <KeyRound /> Add a password
                    </Button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning-soft/50 px-3.5 py-2.5 text-[13px] leading-relaxed">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      For your security, adding a password needs a fresh sign-in (within the last 15
                      minutes).
                    </p>
                    <Button variant="secondary" onClick={() => void signOut()}>
                      <LogIn /> Sign out and sign in again
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Two-step sign-in"
                description="A 6-digit code from an authenticator app after your password."
                action={
                  d.twoFactor.enabled ? (
                    <Badge tone="success" dot>
                      On
                    </Badge>
                  ) : (
                    <Badge tone={d.policy.twoFactor === "required" ? "warning" : "neutral"}>
                      Off
                    </Badge>
                  )
                }
              />
              <CardBody className="space-y-4">
                {d.twoFactor.enabled ? (
                  <>
                    <dl className="divide-y divide-border text-[13.5px]">
                      <div className="flex justify-between py-2.5 first:pt-0">
                        <dt className="text-subtle">Turned on</dt>
                        <dd>{formatDateTime(d.twoFactor.enabledAt)}</dd>
                      </div>
                      <div className="flex justify-between py-2.5">
                        <dt className="text-subtle">Recovery codes left</dt>
                        <dd
                          className={cn(
                            "font-medium",
                            d.twoFactor.recoveryCodesRemaining <= 3 && "text-warning",
                          )}
                        >
                          {d.twoFactor.recoveryCodesRemaining} of 10
                        </dd>
                      </div>
                    </dl>
                    {d.twoFactor.recoveryCodesRemaining <= 3 && (
                      <p className="text-[12.5px] text-warning">
                        Running low: replace your recovery codes.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setConfirmMode("recovery")}>
                        <ListRestart /> Replace recovery codes
                      </Button>
                      {d.policy.twoFactor === "required" ? (
                        <p className="self-center text-[12.5px] text-subtle">
                          Required by your organisation.
                        </p>
                      ) : (
                        <Button variant="danger-soft" onClick={() => setConfirmMode("disable")}>
                          <ShieldOff /> Turn off
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[13.5px] leading-relaxed text-muted">
                      {d.password.set
                        ? "Even if someone learns your password, they can't sign in without your phone."
                        : "Two-step sign-in protects password sign-ins. Add a password first."}
                    </p>
                    <Button disabled={!d.password.set} onClick={() => setTfOpen(true)}>
                      <ShieldCheck /> Set up authenticator app
                    </Button>
                  </>
                )}
              </CardBody>
            </Card>
          </div>
          <ChangePasswordDialog data={d} open={pwOpen} onOpenChange={setPwOpen} />
          <SessionsCard />
          <EnableTwoFactorDialog open={tfOpen} onOpenChange={setTfOpen} />
          <CodeConfirmDialog mode={confirmMode} onClose={() => setConfirmMode(null)} />
        </div>
      )}
    </>
  );
}
