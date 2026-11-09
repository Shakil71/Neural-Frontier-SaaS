import type { AuditAction } from "@nf/contracts";
import {
  Bot,
  Fingerprint,
  Cable,
  CircleCheck,
  CircleX,
  KeyRound,
  KeySquare,
  RefreshCw,
  Trash2,
  Unplug,
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
  "connector.created": { label: "Connector added", icon: Cable, tone: "primary" },
  "connector.updated": { label: "Connector changed", icon: Cable, tone: "warning" },
  "connector.deleted": { label: "Connector deleted", icon: Unplug, tone: "danger" },
  "connector.sync_requested": { label: "Sync requested", icon: RefreshCw, tone: "neutral" },
  "connector.sync_completed": { label: "Sync completed", icon: CircleCheck, tone: "neutral" },
  "connector.sync_failed": { label: "Sync failed", icon: CircleX, tone: "danger" },
  "service_principal.created": { label: "Service principal created", icon: Bot, tone: "primary" },
  "service_principal.updated": { label: "Service principal changed", icon: Bot, tone: "warning" },
  "service_principal.secret_created": {
    label: "Client secret issued",
    icon: KeySquare,
    tone: "warning",
  },
  "service_principal.secret_revoked": {
    label: "Client secret revoked",
    icon: Trash2,
    tone: "warning",
  },
  "service_principal.token_issued": {
    label: "Access token issued",
    icon: KeyRound,
    tone: "neutral",
  },
  "service_principal.auth_failed": {
    label: "Machine sign-in failed",
    icon: ShieldAlert,
    tone: "danger",
  },
  "tenant.idp_configured": {
    label: "Sign-in provider configured",
    icon: Fingerprint,
    tone: "warning",
  },
  "tenant.idp_removed": { label: "Sign-in provider removed", icon: Fingerprint, tone: "danger" },
  "tenant.idp_enforcement_changed": {
    label: "Sign-in provider requirement changed",
    icon: Fingerprint,
    tone: "warning",
  },
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
  idp_tenant_mismatch:
    "Your organisation's identity provider can only sign you in to your own organisation. Check the email address you entered.",
  tenant_idp_required:
    "Your organisation requires its own sign-in provider. Enter your work email above to be sent there.",
};
