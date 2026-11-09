import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@nf/contracts";

export const PUBLIC_KEY = "nf:public";
export const PERMISSION_KEY = "nf:permission";

/** Route needs no session (health, sign-in). Everything else requires one by default. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Route requires this permission in the caller's tenant. Checked centrally by SecurityGuard. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
