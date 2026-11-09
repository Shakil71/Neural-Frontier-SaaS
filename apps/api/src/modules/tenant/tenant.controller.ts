import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Principal } from "../../common/principal.js";
import { CurrentPrincipal } from "../../common/request.js";
import { DatabaseService } from "../../infra/database.service.js";
import { RequirePermission } from "../authz/decorators.js";
import { OidcService } from "../auth/oidc.service.js";

@ApiTags("tenant")
@Controller("v1/tenant")
export class TenantController {
  constructor(
    private readonly database: DatabaseService,
    private readonly oidc: OidcService,
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
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      createdAt: tenant.createdAt.toISOString(),
      domains: domains.map((d) => ({ domain: d.domain, verified: d.verifiedAt !== null })),
      sso: { protocol: "oidc", configured: this.oidc.configured },
    };
  }
}
