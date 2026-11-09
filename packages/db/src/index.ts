export {
  createPrismaClient,
  withTenantGuard,
  type ScopedPrismaClient,
  type ScopedTransaction,
  type DatabaseOptions,
} from "./client.js";
export { assertTenantScoped, TenantScopeViolation, TENANT_SCOPED_MODELS } from "./tenant-guard.js";
export { syncBuiltInRoles } from "./roles.js";
export { bootstrapTenant, validateBootstrapInput, type BootstrapInput } from "./bootstrap.js";
export * from "./generated/prisma/client.js";
