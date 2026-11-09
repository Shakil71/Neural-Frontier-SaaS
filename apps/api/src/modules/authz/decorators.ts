import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@nf/contracts";

export const PUBLIC_KEY = "nf:public";
export const PERMISSION_KEY = "nf:permission";

/** Route needs no session (health, sign-in). Everything else requires one by default. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Route requires this permission in the caller's tenant. Checked centrally by SecurityGuard. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

export const MACHINE_ACCESS_KEY = "nf:machine-access";

/**
 * Service principals (bearer tokens) may call this route. Every other route is for people
 * only: machine access is opt-in per route, on top of the permission check.
 */
export const MachineAccess = () => SetMetadata(MACHINE_ACCESS_KEY, true);
