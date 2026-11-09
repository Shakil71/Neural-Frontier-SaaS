import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuditQuerySchema } from "@nf/contracts";
import type { Principal } from "../../common/principal.js";
import { CurrentPrincipal } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { RequirePermission } from "../authz/decorators.js";
import { AuditService } from "./audit.service.js";

@ApiTags("audit")
@Controller("v1/audit-events")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission("audit.read")
  list(@CurrentPrincipal() p: Principal, @Query() query: unknown) {
    return this.audit.list(p.tenantId, parse(AuditQuerySchema, query));
  }
}
