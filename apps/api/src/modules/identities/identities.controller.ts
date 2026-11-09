import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IdentityListQuerySchema, UpdateIdentityStatusSchema } from "@nf/contracts";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { RequirePermission } from "../authz/decorators.js";
import { IdentitiesService } from "./identities.service.js";

@ApiTags("identities")
@Controller("v1/identities")
export class IdentitiesController {
  constructor(private readonly identities: IdentitiesService) {}

  @Get()
  @RequirePermission("identities.read")
  list(@CurrentPrincipal() p: Principal, @Query() query: unknown) {
    return this.identities.list(p.tenantId, parse(IdentityListQuerySchema, query));
  }

  @Get(":id")
  @RequirePermission("identities.read")
  get(@CurrentPrincipal() p: Principal, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.identities.get(p.tenantId, id);
  }

  @Patch(":id/status")
  @RequirePermission("identities.manage")
  updateStatus(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.identities.updateStatus(p, id, parse(UpdateIdentityStatusSchema, body), meta);
  }
}
