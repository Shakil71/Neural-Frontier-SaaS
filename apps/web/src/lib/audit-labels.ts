import type { AuditAction } from "@nf/contracts";
import {
  KeyRound,
  LogIn,
  LogOut,
  type LucideIcon,
  ShieldAlert,
  ShieldMinus,
  ShieldPlus,
  UserCog,
  UserPlus,
} from "lucide-react";

/** Human labels for every audit action. Typed as a total map, so a new action fails the build until labelled. */
export const AUDIT_LABELS: Record<
  AuditAction,
  { label: string; icon: LucideIcon; tone: "neutral" | "primary" | "danger" | "warning" }
> = {
  "auth.sign_in": { label: "Signed in", icon: LogIn, tone: "neutral" },
  "auth.sign_in_failed": { label: "Sign-in failed", icon: KeyRound, tone: "warning" },
  "auth.sign_out": { label: "Signed out", icon: LogOut, tone: "neutral" },
  "identity.provisioned": { label: "Identity provisioned", icon: UserPlus, tone: "primary" },
  "identity.status_changed": { label: "Status changed", icon: UserCog, tone: "warning" },
  "role.assigned": { label: "Role granted", icon: ShieldPlus, tone: "primary" },
  "role.revoked": { label: "Role revoked", icon: ShieldMinus, tone: "warning" },
  "authz.denied": { label: "Access denied", icon: ShieldAlert, tone: "danger" },
};

export function auditLabel(action: string) {
  return (
    (AUDIT_LABELS as Record<string, (typeof AUDIT_LABELS)[AuditAction] | undefined>)[action] ?? {
      label: action,
      icon: ShieldAlert,
      tone: "neutral" as const,
    }
  );
}

/** Sign-in error codes from the API redirect, explained in plain language. */
export const SIGN_IN_ERRORS: Record<string, string> = {
  sso_not_configured:
    "Single sign-on hasn't been set up for this deployment yet. An administrator needs to configure the identity provider.",
  login_expired: "Your sign-in took too long or was interrupted. Please try again.",
  sso_failed: "Your identity provider didn't complete the sign-in. Please try again.",
  unknown_domain:
    "Your organisation isn't registered with Neural Frontier. Ask your administrator to add your email domain.",
  email_unverified: "Your identity provider hasn't verified your email address.",
  email_missing: "Your identity provider didn't share an email address.",
  not_provisioned:
    "You don't have an account in this organisation yet. Ask an administrator to invite you.",
  identity_suspended: "Your account is suspended. Contact your administrator.",
  tenant_suspended: "Your organisation's access is suspended.",
  subject_mismatch:
    "This email is already linked to a different sign-in account. Contact your administrator.",
};
