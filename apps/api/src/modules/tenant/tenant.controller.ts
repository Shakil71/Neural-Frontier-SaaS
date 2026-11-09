import { Body, Controller, Delete, Get, HttpCode, Patch, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SetIdpEnforcementSchema, UpsertIdentityProviderSchema } from "@nf/contracts";
import { z } from "zod";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { DatabaseService } from "../../infra/database.service.js";
import { RequirePermission } from "../authz/decorators.js";
import { OidcService } from "../auth/oidc.service.js";
import { IdentityProviderService } from "./identity-provider.service.js";

const RemoveSchema = z.object({ reason: z.string().trim().min(3).max(500) });

@ApiTags("tenant")
@Controller("v1/tenant")
export class TenantController {
  constructor(
    private readonly database: DatabaseService,
    private readonly oidc: OidcService,
    private readonly idp: IdentityProviderService,
  ) {}

  @Get()
  @RequirePermission("tenant.read")
  async get(@CurrentPrincipal() p: Principal) {
    const tenant = await this.database.system.tenant.findUniqueOrThrow({
      where: { id: p.tenantId },
    });
    const domains = await this.database.db.tenantDomain.findMany({
      where: { tenantId: p.tenantId },
      orderBy: { domain: "asc" },
    });
    const own = await this.idp.get(p.tenantId);
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      createdAt: tenant.createdAt.toISOString(),
      domains: domains.map((d) => ({ domain: d.domain, verified: d.verifiedAt !== null })),
      sso: {
        protocol: "oidc",
        configured: this.oidc.configured || own !== null,
        sharedConfigured: this.oidc.configured,
        ownProvider: own ? { issuer: own.issuer, enforcement: own.enforcement } : null,
      },
    };
  }

  /** The tenant's own OIDC provider, or null when it uses the deployment-wide one. */
  @Get("identity-provider")
  @RequirePermission("tenant.read")
  getIdp(@CurrentPrincipal() p: Principal) {
    return this.idp.get(p.tenantId);
  }

  @Put("identity-provider")
  @RequirePermission("tenant.sso.manage")
  upsertIdp(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.idp.upsert(p, parse(UpsertIdentityProviderSchema, body), meta);
  }

  @Patch("identity-provider/enforcement")
  @RequirePermission("tenant.sso.manage")
  setEnforcement(
    @CurrentPrincipal() p: Principal,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.idp.setEnforcement(p, parse(SetIdpEnforcementSchema, body), meta);
  }

  @Delete("identity-provider")
  @HttpCode(204)
  @RequirePermission("tenant.sso.manage")
  async removeIdp(
    @CurrentPrincipal() p: Principal,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    await this.idp.remove(p, parse(RemoveSchema, body).reason, meta);
  }
}
