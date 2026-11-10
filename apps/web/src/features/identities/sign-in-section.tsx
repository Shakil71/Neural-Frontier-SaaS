"use client";

import {
  type IssuedSignInLink,
  IssuedSignInLinkSchema,
  IdentitySignInMethodsSchema,
} from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Fingerprint,
  KeyRound,
  Link2,
  Lock,
  LockOpen,
  LogOut,
  MailCheck,
  MonitorSmartphone,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Badge, FieldError, Label, Skeleton, Textarea } from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const errorMessage = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Something went wrong";

type Action = "link" | "reset-two-factor" | "unlock" | "sessions/revoke";

const ACTIONS: Record<
  Action,
  {
    title: string;
    description: string;
    button: string;
    icon: ReactNode;
    danger?: boolean;
    reason: string;
  }
> = {
  link: {
    title: "Create a sign-in link",
    description:
      "A one-time link where this person chooses a password. Share it over a channel you trust: anyone with the link can set the password.",
    button: "Create link",
    icon: <Link2 />,
    reason: "Onboarding to built-in sign-in",
  },
  "reset-two-factor": {
    title: "Reset two-step sign-in?",
    description:
      "Removes their authenticator app and recovery codes. Only do this after confirming who they are, for example on a video call. If your organisation requires two-step sign-in, they set it up again at their next sign-in.",
    button: "Reset two-step",
    icon: <ShieldOff />,
    danger: true,
    reason: "",
  },
  unlock: {
    title: "Unlock this account?",
    description: "Clears failed attempts so they can try their password again right away.",
    button: "Unlock",
    icon: <LockOpen />,
    reason: "Verified with the person",
  },
  "sessions/revoke": {
    title: "Sign out everywhere?",
    description:
      "Ends every session this person has, on every device, right away. They can sign in again unless you also suspend them or reset their password.",
    button: "Sign out everywhere",
    icon: <LogOut />,
    danger: true,
    reason: "",
  },
};

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="text-muted [&_svg]:size-4">{icon}</span>
      <span className="flex-1 text-[13px]">{label}</span>
      {children}
    </li>
  );
}

function IssuedLink({ link, onDone }: { link: IssuedSignInLink; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-3 py-2.5">
        <code className="min-w-0 flex-1 break-all font-mono text-[12px]">{link.url}</code>
        <button
          type="button"
          aria-label="Copy the link"
          className="rounded p-1 text-subtle hover:text-foreground"
          onClick={() =>
            void navigator.clipboard.writeText(link.url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      {link.emailedTo && (
        <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft/50 px-3 py-2 text-[12.5px]">
          <MailCheck className="size-4 shrink-0 text-success" aria-hidden />
          Emailed to <span className="font-medium">{link.emailedTo}</span>. Delivery shows in
          Organisation → Email delivery.
        </p>
      )}
      <p className="text-[12.5px] leading-relaxed text-muted">
        Works once, until {formatDateTime(link.expiresAt)}. It isn&apos;t shown again; creating a
        new link cancels this one.
        {link.purpose === "reset" && " When it's used, all of their sessions are signed out."}
      </p>
      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

export function SignInSection({ identityId, isSelf }: { identityId: string; isSelf: boolean }) {
  const { can } = usePermissions();
  const client = useQueryClient();
  const key = ["identities", "sign-in", identityId];
  const methods = useQuery({
    queryKey: key,
    queryFn: () =>
      api(`/api/v1/identities/${identityId}/sign-in`, { schema: IdentitySignInMethodsSchema }),
  });
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedSignInLink | null>(null);
  const [sendEmail, setSendEmail] = useState(true);

  const mutation = useMutation({
    mutationFn: async (a: Action) => {
      const res = await api(`/api/v1/identities/${identityId}/sign-in/${a}`, {
        method: "POST",
        body: a === "link" ? { reason, sendEmail: sendEmail && !!m?.emailAvailable } : { reason },
      });
      return a === "link" ? IssuedSignInLinkSchema.parse(res) : null;
    },
    onSuccess: (link, a) => {
      void client.invalidateQueries({ queryKey: key });
      if (link) setIssued(link);
      else {
        toast.success(
          a === "unlock"
            ? "Account unlocked."
            : a === "sessions/revoke"
              ? "Signed out everywhere."
              : "Two-step sign-in was reset.",
        );
        close();
      }
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const open = (a: Action) => {
    setAction(a);
    setReason(ACTIONS[a].reason);
    setError(null);
    setIssued(null);
  };
  const close = () => {
    setAction(null);
    setIssued(null);
  };

  const m = methods.data;
  const manage = can("identities.manage") && !isSelf && !!m?.manageable;
  // The API only reports lockedUntil while the lock is in force.
  const locked = !!m?.lockedUntil;

  return (
    <section>
      <h3 className="mb-3 text-[13.5px] font-semibold">Sign-in</h3>
      {methods.isPending && <Skeleton className="h-32" />}
      {methods.isError && <p className="text-[13px] text-danger">{errorMessage(methods.error)}</p>}
      {m && (
        <div className="space-y-3">
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-raised">
            <Row icon={<KeyRound />} label="Password">
              {m.password.set ? (
                <span
                  className="text-[12px] text-muted"
                  title={formatDateTime(m.password.updatedAt)}
                >
                  Set {formatRelative(m.password.updatedAt).toLowerCase()}
                </span>
              ) : m.pendingLink ? (
                <Badge tone="warning">
                  Link sent, expires {formatRelative(m.pendingLink.expiresAt).toLowerCase()}
                </Badge>
              ) : (
                <Badge>Not set</Badge>
              )}
            </Row>
            <Row icon={<Smartphone />} label="Two-step sign-in">
              {m.twoFactor.enabled ? (
                <Badge tone="success" dot>
                  On
                </Badge>
              ) : (
                <Badge>Off</Badge>
              )}
            </Row>
            <Row icon={<Fingerprint />} label="Single sign-on">
              {m.sso.linked ? (
                <span
                  className="max-w-48 truncate text-[12px] text-muted"
                  title={m.sso.issuer ?? undefined}
                >
                  Linked
                </span>
              ) : (
                <Badge>Not linked</Badge>
              )}
            </Row>
            <Row icon={<MonitorSmartphone />} label="Active sessions">
              <Badge tone={m.activeSessions > 0 ? "primary" : "neutral"}>{m.activeSessions}</Badge>
            </Row>
            {(locked || m.failedAttempts > 0) && (
              <Row
                icon={<Lock />}
                label={locked ? "Locked after failed attempts" : "Recent failed attempts"}
              >
                <Badge tone={locked ? "danger" : "warning"}>
                  {locked ? `until ${formatDateTime(m.lockedUntil)}` : m.failedAttempts}
                </Badge>
              </Row>
            )}
          </ul>

          {isSelf ? (
            <p className="text-[12.5px] text-muted">
              Manage your own sign-in in{" "}
              <Link href="/account/security" className="font-medium text-primary hover:underline">
                Security &amp; sign-in
              </Link>
              .
            </p>
          ) : can("identities.manage") && !m.manageable ? (
            <p className="text-[12.5px] leading-relaxed text-muted">
              This person has access you don&apos;t have, so you can&apos;t change how they sign in.
            </p>
          ) : (
            manage && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => open("link")}>
                  <Link2 /> {m.password.set ? "Send password reset link" : "Create sign-in link"}
                </Button>
                {m.twoFactor.enabled && (
                  <Button size="sm" variant="danger-soft" onClick={() => open("reset-two-factor")}>
                    <ShieldOff /> Reset two-step
                  </Button>
                )}
                {(locked || m.failedAttempts > 0) && (
                  <Button size="sm" variant="secondary" onClick={() => open("unlock")}>
                    <LockOpen /> Unlock
                  </Button>
                )}
                {m.activeSessions > 0 && (
                  <Button size="sm" variant="danger-soft" onClick={() => open("sessions/revoke")}>
                    <LogOut /> Sign out everywhere
                  </Button>
                )}
              </div>
            )
          )}
        </div>
      )}

      <Dialog open={action !== null} onOpenChange={(o) => !o && close()}>
        {action && (
          <DialogContent
            title={issued ? "Share this link" : ACTIONS[action].title}
            description={
              issued
                ? "Send it to the person directly, for example in a chat you trust."
                : ACTIONS[action].description
            }
          >
            {issued ? (
              <IssuedLink link={issued} onDone={close} />
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  if (reason.trim().length < 3)
                    return setError("Give a reason of at least 3 characters.");
                  mutation.mutate(action);
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="sign-in-reason">Reason (recorded in the audit log)</Label>
                  <Textarea
                    id="sign-in-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                {action === "link" &&
                  (m?.emailAvailable ? (
                    <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed">
                      <input
                        type="checkbox"
                        checked={sendEmail}
                        onChange={(e) => setSendEmail(e.target.checked)}
                        className="mt-0.5 size-4 accent-[var(--primary)]"
                      />
                      Also email it to them. You&apos;ll still see the link to copy.
                    </label>
                  ) : (
                    <p className="text-[12px] text-subtle">
                      To email links automatically, set up Organisation → Email delivery.
                    </p>
                  ))}
                <FieldError>{error}</FieldError>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant={ACTIONS[action].danger ? "danger" : "primary"}
                    loading={mutation.isPending}
                  >
                    {ACTIONS[action].icon} {ACTIONS[action].button}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
